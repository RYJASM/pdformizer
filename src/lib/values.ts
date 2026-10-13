import type { Condition, FieldDef, FieldType, Form, FormSet, Mapping, Scope, Section, Values } from './types';
import { renderTemplate, todayIso, type TemplateContext } from './template';
import { isTruthy } from './util';

export function allFields(form: Form): FieldDef[] {
  return form.sections.flatMap((s) => s.fields);
}

export function fieldMap(form: Form): Map<string, FieldDef> {
  return new Map(allFields(form).map((f) => [f.key, f]));
}

export function fieldTypes(form: Form): Record<string, FieldType> {
  const t: Record<string, FieldType> = {};
  for (const f of allFields(form)) t[f.key] = f.type;
  return t;
}

export function storeFor(scope: Scope, form: Form, set: FormSet | undefined): Values | undefined {
  if (scope === 'global') return form.globalValues;
  if (!set) return undefined;
  return scope === 'set' ? set.values : set.loadValues;
}

/** Raw values for every field, pulled from the store that matches each field's scope. */
export function rawValues(form: Form, set: FormSet | undefined): Values {
  const out: Values = {};
  for (const f of allFields(form)) out[f.key] = storeFor(f.scope, form, set)?.[f.key] ?? '';
  return out;
}

export function testCondition(c: Condition | undefined, values: Values): boolean {
  if (!c || !c.field) return true;
  const v = (values[c.field] ?? '').trim();
  const target = (c.value ?? '').trim().toLowerCase();
  switch (c.op) {
    case 'equals': return v.toLowerCase() === target;
    case 'notEquals': return v.toLowerCase() !== target;
    case 'contains': return v.toLowerCase().includes(target);
    case 'isChecked': return isTruthy(v);
    case 'isNotChecked': return !isTruthy(v);
    case 'isFilled': return v.length > 0;
    case 'isEmpty': return v.length === 0;
  }
}

/** Keys of fields that are currently visible (conditions may chain, so iterate to a fixed point). */
export function visibleKeys(form: Form, values: Values): Set<string> {
  let visible = new Set(allFields(form).map((f) => f.key));
  for (let pass = 0; pass < 6; pass++) {
    const masked: Values = {};
    for (const [k, v] of Object.entries(values)) masked[k] = visible.has(k) ? v : '';
    const next = new Set<string>();
    for (const s of form.sections) {
      if (!testCondition(s.showIf, masked)) continue;
      for (const f of s.fields) if (testCondition(f.showIf, masked)) next.add(f.key);
    }
    if (next.size === visible.size && [...next].every((k) => visible.has(k))) return next;
    visible = next;
  }
  return visible;
}

export function sectionVisible(s: Section, values: Values, visible: Set<string>): boolean {
  if (!testCondition(s.showIf, values)) return false;
  return s.fields.some((f) => visible.has(f.key));
}

/** Values actually used for filling: hidden fields are blanked. */
export function effectiveValues(form: Form, set: FormSet | undefined): Values {
  const raw = rawValues(form, set);
  const vis = visibleKeys(form, raw);
  for (const k of Object.keys(raw)) if (!vis.has(k)) raw[k] = '';
  return raw;
}

export function sampleFor(f: FieldDef): string {
  if (f.sample) return f.sample;
  switch (f.type) {
    case 'date': return todayIso();
    case 'number': return '1234';
    case 'phone': return '(555) 010-2030';
    case 'email': return 'name@example.com';
    case 'checkbox': return 'true';
    case 'select':
    case 'radio': return f.options?.[0] ?? 'Option';
    case 'textarea': return `${f.label} line 1\n${f.label} line 2`;
    case 'signature': return '';
    default: return f.label;
  }
}

export function sampleValues(form: Form, real?: Values): Values {
  const out: Values = {};
  for (const f of allFields(form)) out[f.key] = real?.[f.key] || sampleFor(f);
  return out;
}

export function templateContext(form: Form, values: Values, set?: FormSet): TemplateContext {
  return {
    values,
    types: fieldTypes(form),
    extra: { set_name: set?.name ?? '', form_name: form.name },
  };
}

export function mappingText(m: Mapping, ctx: TemplateContext): string {
  let s = renderTemplate(m.source, ctx);
  if (m.style.uppercase) s = s.toUpperCase();
  return s;
}

export function mappingChecked(m: Mapping, ctx: TemplateContext): boolean {
  const v = renderTemplate(m.source, { ...ctx, types: {} });
  const rule = m.check ?? { op: 'truthy' };
  const a = v.trim().toLowerCase();
  const b = (rule.value ?? '').trim().toLowerCase();
  switch (rule.op) {
    case 'equals': return a === b;
    case 'notEquals': return a !== b;
    case 'contains': return a.includes(b);
    default: return isTruthy(v);
  }
}

export function mappingImage(m: Mapping, ctx: TemplateContext): string {
  const v = renderTemplate(m.source, { ...ctx, types: {} }).trim();
  return v.startsWith('data:image/') ? v : '';
}

/** Defaults applied to load-scope fields when a new load starts. */
export function loadDefaults(form: Form): Values {
  const out: Values = {};
  for (const f of allFields(form)) {
    if (f.scope !== 'load' || !f.defaultValue) continue;
    out[f.key] = f.defaultValue === '{today}' ? todayIso() : f.defaultValue;
  }
  return out;
}
