// Human-editable data files. Designed to survive hand editing in Notepad:
//   key: value          (":" or "=" both work; keys are case-insensitive; labels work too)
//     indented lines    continue the previous value (multi-line text)
//   # comment           ignored
//   [Shared] / [Set: name] / [Load: name]   say where values go (optional)
import type { FieldDef, Form, FormSet, Values } from './types';
import { allFields, storeFor } from './values';
import { formatDate, parseDate, todayIso } from './template';
import { isTruthy, slugify } from './util';

export function exportDataText(form: Form, sets: FormSet[]): string {
  const L: string[] = [];
  const fields = allFields(form);
  L.push('# Autofill My PDF — data file');
  L.push(`# Form: ${form.name}`);
  L.push(`# Saved: ${formatDate(new Date(), 'MMM D, YYYY')}`);
  L.push('#');
  L.push('# HOW TO EDIT');
  L.push('#   • Change the text after the colon. Keep the name before the colon as it is.');
  L.push('#   • Leave a value empty to clear it. Lines starting with # are notes and are ignored.');
  L.push('#   • Checkboxes: yes or no.   Dates: 2026-10-13 or 10/13/2026.');
  L.push('#   • More than one line? Put the extra lines underneath, indented with two spaces.');
  L.push('#   • Signatures stay in the app and are not written to this file.');
  L.push('');

  const block = (title: string, scope: FieldDef['scope'], set?: FormSet) => {
    const scoped = fields.filter((f) => f.scope === scope && f.type !== 'signature');
    if (!scoped.length) return;
    L.push(`[${title}]`);
    const store = storeFor(scope, form, set) ?? {};
    for (const s of form.sections) {
      const fs = s.fields.filter((f) => scoped.includes(f));
      if (!fs.length) continue;
      L.push(`# — ${s.title} —`);
      for (const f of fs) {
        if ((f.type === 'select' || f.type === 'radio') && f.options?.length) L.push(`# ${f.label}: ${f.options.join(' / ')}`);
        else if (f.type === 'checkbox') L.push(`# ${f.label}: yes / no`);
        let v = store[f.key] ?? '';
        if (f.type === 'checkbox') v = isTruthy(v) ? 'yes' : 'no';
        const lines = v.split(/\r?\n/);
        L.push(`${f.key}: ${lines[0]}`.trimEnd());
        for (const extra of lines.slice(1)) L.push(`  ${extra}`);
      }
    }
    L.push('');
  };

  block('Shared — same in every set', 'global');
  for (const s of sets) {
    block(`Set: ${s.name}`, 'set', s);
    block(`Load: ${s.name}`, 'load', s);
  }
  return L.join('\n');
}

export interface DataChange {
  key: string;
  label: string;
  target: 'global' | { setName: string; setId?: string };
  from: string;
  to: string;
}

export interface ParsedData {
  changes: DataChange[];
  warnings: string[];
  newSets: string[];
}

function normalizeValue(f: FieldDef, raw: string, warn: (m: string) => void): string {
  const v = raw.trim();
  switch (f.type) {
    case 'checkbox':
      return isTruthy(v) ? 'true' : '';
    case 'date': {
      if (!v) return '';
      if (/^today$/i.test(v)) return todayIso();
      const d = parseDate(v);
      if (!d) {
        warn(`"${f.label}": couldn't read the date "${v}" — kept as typed.`);
        return v;
      }
      return formatDate(d, 'YYYY-MM-DD');
    }
    case 'select':
    case 'radio': {
      if (!v) return '';
      const hit = f.options?.find((o) => o.toLowerCase() === v.toLowerCase());
      if (!hit) warn(`"${f.label}": "${v}" isn't one of the choices (${f.options?.join(', ')}) — kept anyway.`);
      return hit ?? v;
    }
    default:
      return raw.replace(/\s+$/g, '');
  }
}

/** Parse a data file against a form. `fallbackSet` receives values when the file has no [Set:] headers. */
export function parseDataText(text: string, form: Form, sets: FormSet[], fallbackSet?: FormSet): ParsedData {
  const fields = allFields(form);
  const byKey = new Map<string, FieldDef>();
  for (const f of fields) {
    byKey.set(f.key.toLowerCase(), f);
    byKey.set(slugify(f.label), f);
    byKey.set(f.label.toLowerCase(), f);
  }
  const warnings: string[] = [];
  const newSets = new Set<string>();
  const pending = new Map<string, { f: FieldDef; target: DataChange['target']; value: string; line: number }>();

  type Ctx = { kind: 'global' } | { kind: 'set' | 'load'; name: string } | { kind: 'none' };
  let ctx: Ctx = { kind: 'none' };
  let last: { key: string } | null = null;

  const setNamed = (name: string) => sets.find((s) => s.name.trim().toLowerCase() === name.trim().toLowerCase());

  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const n = i + 1;
    if (!line.trim() || /^\s*(#|\/\/|;)/.test(line)) return;

    // continuation of a multi-line value
    const looksLikeKey = (() => {
      const m = /^\s*([^:=]+?)\s*[:=]/.exec(line);
      return !!m && (byKey.has(m[1].trim().toLowerCase()) || byKey.has(slugify(m[1])));
    })();
    if (/^(\s{2,}|\t)/.test(line) && last && !looksLikeKey) {
      const p = pending.get(last.key)!;
      p.value += '\n' + line.replace(/^(\s{2}|\t)/, '');
      return;
    }

    const head = /^\s*\[(.+)\]\s*$/.exec(line);
    if (head) {
      last = null;
      const h = head[1].trim();
      const m = /^(set|load|current load|this load)\s*[:\-–—]\s*(.+)$/i.exec(h);
      if (/^(shared|global|everywhere|all sets)/i.test(h)) ctx = { kind: 'global' };
      else if (m) {
        const name = m[2].trim();
        ctx = { kind: /load/i.test(m[1]) ? 'load' : 'set', name };
        if (!setNamed(name)) newSets.add(name);
      } else {
        warnings.push(`Line ${n}: didn't recognise the heading [${h}] — use [Shared], [Set: name] or [Load: name].`);
        ctx = { kind: 'none' };
      }
      return;
    }

    const kv = /^\s*([^:=]+?)\s*[:=]\s?(.*)$/.exec(line);
    if (!kv) {
      warnings.push(`Line ${n}: couldn't read "${line.trim().slice(0, 40)}" — expected name: value.`);
      return;
    }
    const rawKey = kv[1].trim();
    const f = byKey.get(rawKey.toLowerCase()) ?? byKey.get(slugify(rawKey));
    if (!f) {
      warnings.push(`Line ${n}: "${rawKey}" isn't a field in this form — skipped.`);
      last = null;
      return;
    }
    if (f.type === 'signature' && !kv[2].trim().startsWith('data:image/')) {
      last = null;
      return;
    }

    let target: DataChange['target'];
    if (f.scope === 'global') target = 'global';
    else if (ctx.kind === 'set' || ctx.kind === 'load') target = { setName: ctx.name, setId: setNamed(ctx.name)?.id };
    else if (fallbackSet) target = { setName: fallbackSet.name, setId: fallbackSet.id };
    else {
      warnings.push(`Line ${n}: "${f.label}" belongs to a set — put it under a [Set: name] heading.`);
      last = null;
      return;
    }
    const id = `${typeof target === 'string' ? 'g' : target.setName.toLowerCase()}::${f.key}`;
    if (pending.has(id)) warnings.push(`Line ${n}: "${f.label}" appears twice — using the last one.`);
    pending.set(id, { f, target, value: kv[2], line: n });
    last = { key: id };
  });

  const changes: DataChange[] = [];
  for (const { f, target, value } of pending.values()) {
    const to = normalizeValue(f, value, (m) => warnings.push(m));
    let from = '';
    if (target === 'global') from = form.globalValues[f.key] ?? '';
    else {
      const s = target.setId ? sets.find((x) => x.id === target.setId) : undefined;
      from = (s && storeFor(f.scope, form, s)?.[f.key]) ?? '';
    }
    if (from === to) continue;
    changes.push({ key: f.key, label: f.label, target, from, to });
  }
  return { changes, warnings, newSets: [...newSets] };
}

export function groupChanges(changes: DataChange[]): Map<string, DataChange[]> {
  const g = new Map<string, DataChange[]>();
  for (const c of changes) {
    const k = c.target === 'global' ? 'Shared' : c.target.setName;
    g.set(k, [...(g.get(k) ?? []), c]);
  }
  return g;
}

export type { Values };
