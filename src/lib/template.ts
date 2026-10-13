// Mapping templates: "{driver_name}", "{city}, {state} {zip}", "{pickup_date|date:MM/DD/YY}", "{name|upper}".
import type { FieldType, Values } from './types';
import { isTruthy } from './util';

export interface TemplateContext {
  values: Values;
  types?: Record<string, FieldType>;
  now?: Date;
  extra?: Record<string, string>; // set_name, form_name …
}

const TOKEN = /\{([a-zA-Z0-9_.]+)((?:\|[^{}|]+)*)\}/g;

export function tokensIn(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(TOKEN)) out.push(m[1]);
  return out;
}

export function singleToken(template: string): string | null {
  const m = /^\{([a-zA-Z0-9_.]+)(?:\|[^{}]*)?\}$/.exec(template.trim());
  return m ? m[1] : null;
}

export function parseDate(v: string): Date | null {
  const s = v.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return new Date(y, +m[1] - 1, +m[2]);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatDate(d: Date, fmt = 'MM/DD/YYYY'): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|hh|mm|A/g, (t) => {
    switch (t) {
      case 'YYYY': return String(d.getFullYear());
      case 'YY': return String(d.getFullYear()).slice(-2);
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'DD': return pad(d.getDate());
      case 'D': return String(d.getDate());
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'HH': return pad(d.getHours());
      case 'hh': return pad(((d.getHours() + 11) % 12) + 1);
      case 'mm': return pad(d.getMinutes());
      case 'A': return d.getHours() < 12 ? 'AM' : 'PM';
      default: return t;
    }
  });
}

export const todayIso = (d = new Date()) => formatDate(d, 'YYYY-MM-DD');

function applyFilter(value: string, name: string, arg: string | undefined, type: FieldType | undefined): string {
  switch (name) {
    case 'upper': return value.toUpperCase();
    case 'lower': return value.toLowerCase();
    case 'title': return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    case 'date': {
      const d = parseDate(value);
      return d ? formatDate(d, arg || 'MM/DD/YYYY') : value;
    }
    case 'default': return value.trim() ? value : (arg ?? '');
    case 'first': return value.slice(0, Number(arg) || 1);
    case 'last': return value.slice(-(Number(arg) || 1));
    case 'digits': return value.replace(/\D+/g, '');
    case 'line': return value.split(/\r?\n/)[(Number(arg) || 1) - 1] ?? '';
    case 'oneline': return value.replace(/\s*\r?\n\s*/g, arg ?? ', ');
    case 'yesno': return isTruthy(value) ? 'Yes' : 'No';
    case 'x': return isTruthy(value) ? 'X' : '';
    case 'phone': {
      const d = value.replace(/\D+/g, '');
      if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
      if (d.length === 11 && d[0] === '1') return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
      return value;
    }
    case 'money': {
      const n = parseFloat(value.replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? value : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    case 'number': {
      const n = parseFloat(value.replace(/[^0-9.-]/g, ''));
      return isNaN(n) ? value : n.toLocaleString('en-US');
    }
    default:
      void type;
      return value;
  }
}

/** Default rendering for a raw value of a given field type (no explicit filter). */
function defaultFormat(value: string, type: FieldType | undefined): string {
  if (!value) return value;
  if (type === 'date') {
    const d = parseDate(value);
    return d ? formatDate(d, 'MM/DD/YYYY') : value;
  }
  if (type === 'checkbox') return isTruthy(value) ? 'Yes' : '';
  return value;
}

export function resolveToken(key: string, ctx: TemplateContext): string {
  if (key === 'today') return todayIso(ctx.now);
  if (key === 'now') return formatDate(ctx.now ?? new Date(), 'MM/DD/YYYY hh:mm A');
  if (ctx.extra && key in ctx.extra) return ctx.extra[key];
  return ctx.values[key] ?? '';
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  if (!template) return '';
  let anyFilled = false;
  let anyToken = false;
  const out = template.replace(TOKEN, (_m, key: string, filters: string) => {
    anyToken = true;
    const type = key === 'today' ? 'date' : ctx.types?.[key];
    let v = resolveToken(key, ctx);
    const parts = filters ? filters.split('|').filter(Boolean) : [];
    if (parts.length === 0) v = defaultFormat(v, type);
    for (const p of parts) {
      const i = p.indexOf(':');
      const name = (i < 0 ? p : p.slice(0, i)).trim();
      const arg = i < 0 ? undefined : p.slice(i + 1);
      v = applyFilter(v, name, arg, type);
    }
    if (v) anyFilled = true;
    return v;
  });
  // A template whose tokens are all empty renders empty (so "{city}, {state}" doesn't print a lone comma).
  if (anyToken && !anyFilled) return '';
  return out.replace(/\\n/g, '\n');
}

/** Rename {old} tokens to {new} in a template, preserving filters. */
export function renameToken(template: string, from: string, to: string): string {
  return template.replace(TOKEN, (m, key: string, filters: string) => (key === from ? `{${to}${filters ?? ''}}` : m));
}

export const FILTER_HELP: { name: string; example: string; desc: string }[] = [
  { name: 'date:MM/DD/YYYY', example: '{pickup_date|date:MM/DD/YY}', desc: 'Date format (YYYY, YY, MM, M, DD, D, MMM, ddd)' },
  { name: 'upper', example: '{name|upper}', desc: 'UPPERCASE' },
  { name: 'title', example: '{name|title}', desc: 'Title Case' },
  { name: 'phone', example: '{phone|phone}', desc: '(555) 123-4567' },
  { name: 'money', example: '{rate|money}', desc: '1,250.00' },
  { name: 'oneline', example: '{address|oneline}', desc: 'Join lines with commas' },
  { name: 'line:2', example: '{address|line:2}', desc: 'Pick one line' },
  { name: 'default:N/A', example: '{seal|default:N/A}', desc: 'Fallback when empty' },
  { name: 'yesno', example: '{hazmat|yesno}', desc: 'Checkbox → Yes / No' },
  { name: 'x', example: '{hazmat|x}', desc: 'Checkbox → X' },
];
