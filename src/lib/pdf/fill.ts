// Generates filled PDFs with pdf-lib. Runs inside a Web Worker (see fill.worker.ts) — no DOM here.
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFArray,
  PDFName,
  PDFOptionList,
  PDFRef,
  PDFStream,
  PDFRadioGroup,
  PDFTextField,
  StandardFonts,
  TextAlignment,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { AcroField, DocPage, FontName, Mapping, Rect } from '../types';
import { fitImage, layoutText } from '../layout';
import { dataUrlToBytes, hexToRgb } from '../util';

export interface FillItem {
  mapping: Mapping;
  text?: string;
  checked?: boolean;
  image?: string; // data URL
}

export interface FillJob {
  bytes: Uint8Array;
  pages: DocPage[];
  acroFields: AcroField[];
  items: FillItem[];
  flatten: boolean;
}

const FONT_FILES: Record<FontName, StandardFonts> = {
  helvetica: StandardFonts.Helvetica,
  'helvetica-bold': StandardFonts.HelveticaBold,
  times: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
};

/** Display-space point (top-left origin, rotation applied) → PDF user-space point. */
export function toPdfPoint(p: DocPage, dx: number, dy: number): [number, number] {
  const [x0, y0, x1, y1] = p.view;
  switch (((p.rotate % 360) + 360) % 360) {
    case 90: return [x0 + dy, y0 + dx];
    case 180: return [x1 - dx, y0 + dy];
    case 270: return [x1 - dy, y1 - dx];
    default: return [x0 + dx, y1 - dy];
  }
}

class Ctx {
  fonts = new Map<FontName, PDFFont>();
  charsets = new Map<FontName, Set<number>>();
  images = new Map<string, PDFImage>();
  constructor(public pdf: PDFDocument, public pages: DocPage[]) {}

  async font(name: FontName) {
    let f = this.fonts.get(name);
    if (!f) {
      f = await this.pdf.embedFont(FONT_FILES[name]);
      this.fonts.set(name, f);
      this.charsets.set(name, new Set(f.getCharacterSet()));
    }
    return f;
  }

  /** Standard PDF fonts only cover WinAnsi; swap anything else for a close ASCII stand-in. */
  clean(name: FontName, s: string) {
    const cs = this.charsets.get(name);
    if (!cs) return s;
    let out = '';
    for (const ch of s.normalize('NFC')) {
      const c = ch.codePointAt(0)!;
      if (ch === '\n' || cs.has(c)) out += ch;
      else if (ch === '\t') out += '    ';
      else if (ch === '✓' || ch === '✔') out += 'X';
      else {
        const base = ch.normalize('NFKD').replace(/\p{M}/gu, '');
        out += base && [...base].every((b) => cs.has(b.codePointAt(0)!)) ? base : '?';
      }
    }
    return out;
  }

  async image(url: string) {
    let img = this.images.get(url);
    if (!img) {
      const { bytes, mime } = dataUrlToBytes(url);
      img = mime.includes('png') ? await this.pdf.embedPng(bytes) : await this.pdf.embedJpg(bytes);
      this.images.set(url, img);
    }
    return img;
  }

  page(i: number): PDFPage | undefined {
    return this.pdf.getPages()[i];
  }
}

async function drawTextBox(ctx: Ctx, pageIndex: number, rect: Rect, text: string, m: Mapping) {
  const page = ctx.page(pageIndex);
  const meta = ctx.pages[pageIndex];
  if (!page || !meta || !text) return;
  const font = await ctx.font(m.style.font);
  const clean = ctx.clean(m.style.font, text);
  const lay = layoutText(clean, rect[2], rect[3], m.style, (t, s) => font.widthOfTextAtSize(t, s));
  const [r, g, b] = hexToRgb(m.style.color || '#000000');
  for (const line of lay.lines) {
    if (!line.text) continue;
    const [x, y] = toPdfPoint(meta, rect[0] + line.x, rect[1] + line.baseline);
    page.drawText(line.text, { x, y, size: lay.size, font, color: rgb(r, g, b), rotate: degrees(meta.rotate) });
  }
}

async function drawImageBox(ctx: Ctx, pageIndex: number, rect: Rect, url: string, m: Mapping) {
  const page = ctx.page(pageIndex);
  const meta = ctx.pages[pageIndex];
  if (!page || !meta || !url) return;
  const img = await ctx.image(url);
  const fit = fitImage(img.width, img.height, rect[2], rect[3], m.style.align);
  const [x, y] = toPdfPoint(meta, rect[0] + fit.x, rect[1] + fit.y + fit.h);
  page.drawImage(img, { x, y, width: fit.w, height: fit.h, rotate: degrees(meta.rotate) });
}

function drawCheckMark(ctx: Ctx, pageIndex: number, rect: Rect, m: Mapping) {
  const page = ctx.page(pageIndex);
  const meta = ctx.pages[pageIndex];
  if (!page || !meta) return;
  const s = Math.min(rect[2], rect[3]) * 0.72;
  const cx = rect[0] + rect[2] / 2;
  const cy = rect[1] + rect[3] / 2;
  const [r, g, b] = hexToRgb(m.style.color || '#000000');
  const color = rgb(r, g, b);
  const pt = (dx: number, dy: number) => {
    const [x, y] = toPdfPoint(meta, cx + dx * s, cy + dy * s);
    return { x, y };
  };
  const thickness = Math.max(0.8, s * 0.12);
  const mark = m.style.checkMark ?? 'x';
  if (mark === 'dot') {
    const c = pt(0, 0);
    page.drawCircle({ x: c.x, y: c.y, size: s * 0.32, color });
  } else if (mark === 'check') {
    page.drawLine({ start: pt(-0.42, 0.02), end: pt(-0.12, 0.34), thickness, color });
    page.drawLine({ start: pt(-0.12, 0.34), end: pt(0.45, -0.36), thickness, color });
  } else {
    page.drawLine({ start: pt(-0.4, -0.4), end: pt(0.4, 0.4), thickness, color });
    page.drawLine({ start: pt(-0.4, 0.4), end: pt(0.4, -0.4), thickness, color });
  }
}

const ALIGN: Record<string, TextAlignment> = { left: TextAlignment.Left, center: TextAlignment.Center, right: TextAlignment.Right };

async function fillAcro(ctx: Ctx, acro: AcroField | undefined, name: string, item: FillItem): Promise<void> {
  const m = item.mapping;
  const form = ctx.pdf.getForm();
  const widgets = acro?.widgets ?? [];

  // Signatures (and any image) are stamped over the field's widget boxes.
  if (m.render === 'image') {
    if (item.image) for (const w of widgets) await drawImageBox(ctx, w.page, w.rect, item.image, m);
    return;
  }

  const fallback = async () => {
    if (m.render === 'check') {
      if (item.checked) for (const w of widgets) drawCheckMark(ctx, w.page, w.rect, m);
    } else if (item.text) {
      const w = widgets[0];
      if (w) await drawTextBox(ctx, w.page, w.rect, item.text, m);
    }
  };

  let field;
  try {
    field = form.getField(name);
  } catch {
    return fallback();
  }

  try {
    if (field instanceof PDFTextField) {
      const font = await ctx.font(m.style.font);
      let text = ctx.clean(m.style.font, item.text ?? '');
      const max = field.getMaxLength();
      if (max !== undefined && text.length > max) text = text.slice(0, max);
      if (m.render === 'check') text = item.checked ? 'X' : '';
      if (text.includes('\n') && !field.isMultiline()) field.enableMultiline();
      field.setAlignment(ALIGN[m.style.align] ?? TextAlignment.Left);
      const w = widgets[0];
      if (w && text) {
        const size = m.style.size || layoutText(text, w.rect[2], w.rect[3], { ...m.style, multiline: m.style.multiline || field.isMultiline() }, (t, s) => font.widthOfTextAtSize(t, s)).size;
        field.setFontSize(size);
      }
      field.setText(text || undefined);
      field.updateAppearances(font);
    } else if (field instanceof PDFCheckBox) {
      const on = m.render === 'check' ? !!item.checked : !!item.text?.trim();
      if (on) field.check();
      else field.uncheck();
    } else if (field instanceof PDFRadioGroup) {
      const want = (m.render === 'check' ? (item.checked ? m.check?.value ?? '' : '') : item.text ?? '').trim().toLowerCase();
      const opt = field.getOptions().find((o) => o.trim().toLowerCase() === want);
      if (opt) field.select(opt);
      else if (!want) field.clear();
    } else if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
      const want = (item.text ?? '').trim();
      if (!want) {
        field.clear();
      } else {
        const opt = field.getOptions().find((o) => o.trim().toLowerCase() === want.toLowerCase());
        if (!opt) field.addOptions(ctx.clean('helvetica', want));
        field.select(opt ?? ctx.clean('helvetica', want));
      }
    } else {
      await fallback();
    }
  } catch (e) {
    console.warn('[autofill] field fill failed, drawing instead:', name, e);
    try {
      const f = form.getField(name);
      if (f instanceof PDFTextField) f.setText(undefined);
    } catch {
      /* ignore */
    }
    await fallback();
  }
}

/** pdf-lib's flatten() can leave page /Annots pointing at widget objects it deleted; drop those refs. */
function pruneDanglingAnnots(pdf: PDFDocument) {
  for (const page of pdf.getPages()) {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const ref = annots.get(i);
      if (ref instanceof PDFRef && !pdf.context.lookup(ref)) annots.remove(i);
    }
    if (annots.size() === 0) page.node.delete(PDFName.of('Annots'));
  }
}

/** Flattening turns widget appearance streams into page XObjects; some PDFs omit their /Subtype /Form. */
function tagAppearanceXObjects(pdf: PDFDocument) {
  const SUBTYPE = PDFName.of('Subtype');
  for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFStream)) continue;
    const d = obj.dict;
    if (d.has(PDFName.of('BBox')) && !d.has(SUBTYPE)) {
      d.set(PDFName.of('Type'), PDFName.of('XObject'));
      d.set(SUBTYPE, PDFName.of('Form'));
    }
  }
}

async function fillOne(job: FillJob): Promise<PDFDocument> {
  const pdf = await PDFDocument.load(job.bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = new Ctx(pdf, job.pages);
  const acroByName = new Map(job.acroFields.map((f) => [f.name, f]));
  let touchedForm = false;

  for (const item of job.items) {
    const m = item.mapping;
    if (m.target.kind === 'acro') {
      touchedForm = true;
      await fillAcro(ctx, acroByName.get(m.target.field), m.target.field, item);
    } else {
      const { page, rect } = m.target;
      if (m.render === 'image') {
        if (item.image) await drawImageBox(ctx, page, rect, item.image, m);
      } else if (m.render === 'check') {
        if (item.checked) drawCheckMark(ctx, page, rect, m);
      } else if (item.text) {
        await drawTextBox(ctx, page, rect, item.text, m);
      }
    }
  }

  if (touchedForm) {
    const form = pdf.getForm();
    try {
      form.deleteXFA(); // XFA data would otherwise override what we filled in some viewers
    } catch {
      /* ignore */
    }
    try {
      const helv = await ctx.font('helvetica');
      form.updateFieldAppearances(helv);
    } catch (e) {
      console.warn('[autofill] updateFieldAppearances failed', e);
    }
  }
  if (job.flatten) {
    try {
      pdf.getForm().flatten({ updateFieldAppearances: false });
      pruneDanglingAnnots(pdf);
      tagAppearanceXObjects(pdf);
    } catch (e) {
      console.warn('[autofill] flatten failed; leaving fields editable', e);
    }
  }
  return pdf;
}

export async function fillPdf(job: FillJob): Promise<Uint8Array> {
  const pdf = await fillOne(job);
  return pdf.save();
}

/** Fill several jobs and merge them into one (flattened) PDF — used for "print all" / "save as one file". */
export async function fillAndMerge(jobs: FillJob[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const job of jobs) {
    const filled = await fillOne({ ...job, flatten: true });
    const copied = await out.copyPages(filled, filled.getPageIndices());
    for (const p of copied) out.addPage(p);
  }
  return out.save();
}
