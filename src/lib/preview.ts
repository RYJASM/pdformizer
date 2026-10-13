// Turns mappings + values into per-page drawable items for the on-screen preview.
import type { AcroField, Mapping, PdfDoc, Rect, TextStyle } from './types';
import type { TemplateContext } from './template';
import { mappingChecked, mappingImage, mappingText } from './values';

export interface DrawItem {
  mappingId: string;
  page: number;
  rect: Rect;
  style: TextStyle;
  kind: 'text' | 'check' | 'image';
  text?: string;
  checked?: boolean;
  image?: string;
  cover?: boolean; // paint a white box first (PDF field already shows a default value)
  multiline?: boolean;
}

export function targetRects(m: Mapping, acro: Map<string, AcroField>): { page: number; rect: Rect; exportValue?: string }[] {
  if (m.target.kind === 'overlay') return [{ page: m.target.page, rect: m.target.rect }];
  const f = acro.get(m.target.field);
  return f ? f.widgets.map((w) => ({ page: w.page, rect: w.rect, exportValue: w.exportValue })) : [];
}

export function buildDrawItems(doc: PdfDoc, ctx: TemplateContext, override?: Map<string, Mapping>): DrawItem[][] {
  const pages: DrawItem[][] = doc.pages.map(() => []);
  const acro = new Map(doc.acroFields.map((f) => [f.name, f]));
  for (const base of doc.mappings) {
    const m = override?.get(base.id) ?? base;
    const field = m.target.kind === 'acro' ? acro.get(m.target.field) : undefined;
    const rects = targetRects(m, acro);
    if (!rects.length) continue;
    const cover = !!field?.hasValue;
    if (m.render === 'image') {
      const image = mappingImage(m, ctx);
      for (const r of rects) pages[r.page]?.push({ mappingId: m.id, page: r.page, rect: r.rect, style: m.style, kind: 'image', image, cover });
    } else if (m.render === 'check' || field?.kind === 'checkbox') {
      const checked = m.render === 'check' ? mappingChecked(m, ctx) : !!mappingText(m, ctx).trim();
      // a real PDF checkbox draws its own "on" look — most use a ✓
      const style = field?.kind === 'checkbox' ? { ...m.style, checkMark: 'check' as const } : m.style;
      for (const r of rects) pages[r.page]?.push({ mappingId: m.id, page: r.page, rect: r.rect, style, kind: 'check', checked, cover });
    } else if (field?.kind === 'radio') {
      const v = mappingText(m, ctx).trim().toLowerCase();
      for (const r of rects)
        pages[r.page]?.push({ mappingId: m.id, page: r.page, rect: r.rect, style: { ...m.style, checkMark: 'dot' }, kind: 'check', checked: !!v && (r.exportValue ?? '').toLowerCase() === v, cover });
    } else {
      let text = mappingText(m, ctx);
      if (field?.maxLen && text.length > field.maxLen) text = text.slice(0, field.maxLen);
      // a text field shows the same value in every widget
      for (const r of rects)
        pages[r.page]?.push({ mappingId: m.id, page: r.page, rect: r.rect, style: m.style, kind: 'text', text, cover, multiline: m.style.multiline || !!field?.multiline });
    }
  }
  return pages;
}
