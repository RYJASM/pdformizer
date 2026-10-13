// Suggests mappings from a PDF's fillable fields to form fields by fuzzy name matching.
import type { AcroField, FieldDef, Form, Mapping } from './types';
import { DEFAULT_STYLE } from './types';
import { allFields } from './values';
import { uid } from './util';

const SYN: Record<string, string> = {
  bl: 'bol', billoflading: 'bol', lading: 'bol', wt: 'weight', lbs: 'weight', lb: 'weight', gross: 'weight',
  qty: 'quantity', pcs: 'pieces', pc: 'pieces', count: 'quantity', no: 'number', num: 'number', nbr: 'number', nr: 'number', id: 'number',
  tel: 'phone', ph: 'phone', telephone: 'phone', mobile: 'phone', cell: 'phone', addr: 'address', street: 'address',
  dt: 'date', sig: 'signature', sign: 'signature', signed: 'signature', tractor: 'truck', unit: 'truck', power: 'truck',
  receiver: 'consignee', shipto: 'consignee', destination: 'consignee', dest: 'consignee', origin: 'shipper', shipfrom: 'shipper',
  st: 'state', postal: 'zip', zipcode: 'zip', postcode: 'zip', lic: 'license', licence: 'license', dl: 'license',
  co: 'company', carrier: 'carrier', mc: 'mc', usdot: 'dot', vin: 'vin', plate: 'plate', tag: 'plate', ref: 'reference',
  commodity: 'description', desc: 'description', item: 'description', pu: 'pickup', del: 'delivery', deliver: 'delivery',
  temp: 'temperature', reefer: 'temperature', trl: 'trailer', trlr: 'trailer', drv: 'driver', operator: 'driver', email: 'email', mail: 'email',
  eta: 'delivery', appt: 'appointment', amt: 'amount', rate: 'rate', pay: 'rate', haz: 'hazmat', hazardous: 'hazmat', hm: 'hazmat',
};

const ROLES = ['shipper', 'consignee', 'driver', 'carrier', 'broker', 'dispatch'];

const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'info', 'information', 'field', 'text', 'txt', 's', 'af', 'your', 'enter', 'here', 'to', 'for', 'row', 'box', 'line']);

export interface NormName {
  tokens: string[];
  index: number | null;
}

export function normalizeName(raw: string): NormName {
  let s = raw
    .replace(/_af_date$/i, ' date')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    .toLowerCase()
    .replace(/b\s*\/\s*l/g, ' bol ')
    .replace(/p\s*\/\s*o/g, ' po ')
    .replace(/#/g, ' number ')
    .replace(/&/g, ' and ');
  s = s.replace(/bill of lading/g, 'bol').replace(/ship to/g, 'shipto').replace(/ship from/g, 'shipfrom');
  const raws = s.split(/[^a-z0-9]+/).filter(Boolean);
  let index: number | null = null;
  const tokens: string[] = [];
  raws.forEach((t, i) => {
    if (/^\d+$/.test(t)) {
      if (i === raws.length - 1 || i === raws.length - 2) index = Number(t);
      return;
    }
    if (STOP.has(t)) return;
    tokens.push(SYN[t] ?? t);
  });
  return { tokens: [...new Set(tokens)], index };
}

function dice(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  let hit = 0;
  for (const t of a) if (sb.has(t)) hit++;
  return (2 * hit) / (a.length + b.length);
}

function candidateNames(f: FieldDef): string[] {
  return [f.label, f.key, ...(f.aliases ?? [])];
}

export interface Suggestion {
  acro: AcroField;
  field: FieldDef;
  score: number;
  mapping: Mapping;
}

function compatible(acro: AcroField, f: FieldDef, nameTokens: string[]): boolean {
  const wantsSig = acro.kind === 'signature' || nameTokens.includes('signature');
  if (f.type === 'signature') return wantsSig && acro.kind !== 'checkbox';
  if (wantsSig && acro.kind === 'text' && !nameTokens.includes('date') && !nameTokens.includes('name')) return false;
  if (acro.kind === 'checkbox') return f.type === 'checkbox';
  // choice lists hold codes ("BOX", "PLT"), not counts or dates
  if (acro.kind === 'dropdown' || acro.kind === 'list' || acro.kind === 'radio') return ['select', 'radio', 'text'].includes(f.type);
  return true;
}

export function suggestMappings(form: Form, acroFields: AcroField[], existing: Mapping[] = []): Suggestion[] {
  const mapped = new Set(existing.flatMap((m) => (m.target.kind === 'acro' ? [m.target.field] : [])));
  const fields = allFields(form);
  const prepared = fields.map((f) => ({ f, names: candidateNames(f).map(normalizeName) }));
  const out: Suggestion[] = [];

  for (const acro of acroFields) {
    if (mapped.has(acro.name) || acro.readOnly) continue;
    const names = [normalizeName(acro.name), ...(acro.label ? [normalizeName(acro.label)] : [])];
    const idx = names[0].index;
    if (idx !== null && idx > 1) continue; // table rows 2+ are left for the user
    const allTokens = names.flatMap((n) => n.tokens);
    let best: { f: FieldDef; score: number } | null = null;
    for (const { f, names: fnames } of prepared) {
      if (!compatible(acro, f, allTokens)) continue;
      let score = 0;
      for (const a of names) for (const b of fnames) score = Math.max(score, dice(a.tokens, b.tokens) + (a.tokens.join(' ') === b.tokens.join(' ') ? 0.2 : 0));
      // dates: prefer date fields for "date" names and vice-versa
      const isDateName = allTokens.includes('date');
      if (isDateName !== (f.type === 'date')) score -= 0.15;
      // roles: "Shipper signature" must not land on the driver's signature
      const fieldTokens = fnames.flatMap((n) => n.tokens);
      const acroRoles = ROLES.filter((r) => allTokens.includes(r));
      const fieldRoles = ROLES.filter((r) => fieldTokens.includes(r));
      if (acroRoles.length && fieldRoles.length && !acroRoles.some((r) => fieldRoles.includes(r))) score -= 0.4;
      if (!best || score > best.score) best = { f, score };
    }
    if (!best || best.score < 0.55) continue;
    const f = best.f;
    const render = f.type === 'signature' ? 'image' : acro.kind === 'checkbox' ? 'check' : 'text';
    out.push({
      acro,
      field: f,
      score: Math.min(1, best.score),
      mapping: {
        id: uid('m'),
        target: { kind: 'acro', field: acro.name },
        source: `{${f.key}}`,
        render,
        style: { ...DEFAULT_STYLE, align: acro.align ?? 'left', multiline: !!acro.multiline, ...(render === 'image' ? { align: 'left' as const } : {}) },
      },
    });
  }
  return out;
}

export function defaultMappingFor(acro: AcroField, key: string, fieldType?: FieldDef['type']): Mapping {
  const render = fieldType === 'signature' ? 'image' : acro.kind === 'checkbox' ? 'check' : 'text';
  return {
    id: uid('m'),
    target: { kind: 'acro', field: acro.name },
    source: key ? `{${key}}` : '',
    render,
    style: { ...DEFAULT_STYLE, align: acro.align ?? 'left', multiline: !!acro.multiline },
  };
}
