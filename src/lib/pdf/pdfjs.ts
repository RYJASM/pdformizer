// pdf.js setup, document cache, page analysis and cached page rendering.
import { AnnotationMode, GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { AcroField, AcroKind, DocPage, Rect } from '../types';
import { getFile } from '../db';

GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (p: string) => new URL(`./pdfjs/${p}`, document.baseURI).href;

const tasks = new WeakMap<PDFDocumentProxy, { destroy(): Promise<void> }>();

/** pdf.js v6 destroys documents through their loading task. */
export function closePdf(pdf: PDFDocumentProxy): void {
  void tasks.get(pdf)?.destroy().catch(() => {});
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const task = getDocument({
    data: bytes.slice(), // pdf.js transfers (detaches) the buffer it is given
    cMapUrl: asset('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts/'),
    wasmUrl: asset('wasm/'),
    iccUrl: asset('iccs/'),
    enableXfa: false,
  });
  const pdf = await task.promise;
  tasks.set(pdf, task);
  return pdf;
}

const docCache = new Map<string, Promise<PDFDocumentProxy>>();

export function pdfFor(fileId: string): Promise<PDFDocumentProxy> {
  let p = docCache.get(fileId);
  if (!p) {
    p = getFile(fileId).then(openPdf);
    p.catch(() => docCache.delete(fileId));
    docCache.set(fileId, p);
  }
  return p;
}

export function forgetPdf(fileId: string) {
  const p = docCache.get(fileId);
  docCache.delete(fileId);
  p?.then(closePdf).catch(() => {});
  for (const k of [...bitmapCache.keys()]) if (k.startsWith(fileId + ':')) dropBitmap(k);
}

function normRect(r: number[]): Rect {
  const x = Math.min(r[0], r[2]);
  const y = Math.min(r[1], r[3]);
  return [x, y, Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])];
}

interface PdfjsAnnotation {
  subtype: string;
  fieldName?: string;
  fieldType?: string;
  rect: number[];
  fieldValue?: unknown;
  exportValue?: string;
  buttonValue?: string;
  options?: { exportValue: string; displayValue: string }[];
  multiLine?: boolean;
  maxLen?: number;
  readOnly?: boolean;
  checkBox?: boolean;
  radioButton?: boolean;
  pushButton?: boolean;
  combo?: boolean;
  hidden?: boolean;
  alternativeText?: string;
  textAlignment?: number | null;
}

function kindOf(a: PdfjsAnnotation): AcroKind {
  switch (a.fieldType) {
    case 'Tx': return 'text';
    case 'Ch': return a.combo ? 'dropdown' : 'list';
    case 'Sig': return 'signature';
    case 'Btn': return a.checkBox ? 'checkbox' : a.radioButton ? 'radio' : 'button';
    default: return 'text';
  }
}

function hasValue(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x).trim());
  if (v == null) return false;
  const s = String(v).trim();
  return !!s && s !== 'Off';
}

export async function analyzePdf(pdf: PDFDocumentProxy): Promise<{ pages: DocPage[]; acroFields: AcroField[] }> {
  const pages: DocPage[] = [];
  const fields = new Map<string, AcroField>();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ width: vp.width, height: vp.height, rotate: page.rotate % 360, view: page.view as DocPage['view'] });
    const anns = (await page.getAnnotations({ intent: 'display' })) as PdfjsAnnotation[];
    for (const a of anns) {
      if (a.subtype !== 'Widget' || !a.fieldName || a.hidden) continue;
      const kind = kindOf(a);
      if (kind === 'button') continue;
      const [x1, y1] = vp.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
      const [x2, y2] = vp.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
      const rect = normRect([x1, y1, x2, y2]);
      if (rect[2] < 1 || rect[3] < 1) continue;
      let f = fields.get(a.fieldName);
      if (!f) {
        f = { name: a.fieldName, kind, widgets: [] };
        if (a.alternativeText) f.label = a.alternativeText;
        if (a.options?.length) f.options = a.options.map((o) => o.displayValue ?? o.exportValue).filter((o) => o.trim());
        if (a.multiLine) f.multiline = true;
        if (a.maxLen) f.maxLen = a.maxLen;
        if (a.readOnly) f.readOnly = true;
        if (hasValue(a.fieldValue)) f.hasValue = true;
        if (a.textAlignment === 1) f.align = 'center';
        else if (a.textAlignment === 2) f.align = 'right';
        fields.set(a.fieldName, f);
      }
      f.widgets.push({
        page: i - 1,
        rect,
        ...(kind === 'checkbox' && a.exportValue ? { exportValue: a.exportValue } : {}),
        ...(kind === 'radio' && a.buttonValue ? { exportValue: String(a.buttonValue) } : {}),
      });
    }
    page.cleanup();
  }
  return { pages, acroFields: [...fields.values()] };
}

// ---------- rendering with a small bitmap cache ----------
const bitmapCache = new Map<string, ImageBitmap>();
let cachedPixels = 0;
const MAX_PIXELS = 48_000_000; // ≈190 MB of RGBA

function dropBitmap(k: string) {
  const b = bitmapCache.get(k);
  if (!b) return;
  cachedPixels -= b.width * b.height;
  b.close();
  bitmapCache.delete(k);
}

function remember(k: string, b: ImageBitmap) {
  bitmapCache.set(k, b);
  cachedPixels += b.width * b.height;
  for (const key of bitmapCache.keys()) {
    if (cachedPixels <= MAX_PIXELS || key === k) break;
    dropBitmap(key);
  }
}

export interface RenderHandle {
  promise: Promise<void>;
  cancel(): void;
}

/** Render page `index` of `fileId` into `canvas` at `scale` (CSS px per pt) × devicePixelRatio. */
export function renderPage(fileId: string, index: number, scale: number, canvas: HTMLCanvasElement): RenderHandle {
  let cancelled = false;
  let task: { cancel(): void } | null = null;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const px = Math.round(scale * dpr * 100) / 100;
  const key = `${fileId}:${index}:${px}`;

  const draw = (b: ImageBitmap) => {
    canvas.width = b.width;
    canvas.height = b.height;
    canvas.getContext('2d')!.drawImage(b, 0, 0);
  };

  const promise = (async () => {
    const hit = bitmapCache.get(key);
    if (hit) {
      bitmapCache.delete(key); // refresh LRU order
      bitmapCache.set(key, hit);
      draw(hit);
      return;
    }
    const pdf = await pdfFor(fileId);
    if (cancelled) return;
    const page = await pdf.getPage(index + 1);
    if (cancelled) return;
    const vp = page.getViewport({ scale: px });
    const off = document.createElement('canvas');
    off.width = Math.ceil(vp.width);
    off.height = Math.ceil(vp.height);
    const rt = page.render({ canvas: off, viewport: vp, annotationMode: AnnotationMode.ENABLE, background: '#ffffff' });
    task = rt;
    try {
      await rt.promise;
    } catch (e) {
      if (cancelled) return;
      throw e;
    }
    if (cancelled) return;
    const bmp = await createImageBitmap(off);
    remember(key, bmp);
    if (!cancelled) draw(bmp);
  })();

  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}
