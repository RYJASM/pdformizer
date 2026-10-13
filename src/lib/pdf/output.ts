// Main-thread side of PDF generation: builds jobs, talks to the worker, saves / prints / opens results.
import type { Form, FormSet, PdfDoc, Values } from '../types';
import type { FillJob } from './fill';
import { getFile } from '../db';
import { mappingChecked, mappingImage, mappingText, templateContext } from '../values';
import { renderTemplate } from '../template';
import { sanitizeFileName } from '../util';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./fill.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; bytes?: Uint8Array; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.ok && e.data.bytes) p.resolve(e.data.bytes);
      else p.reject(new Error(e.data.error || 'PDF generation failed'));
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || 'PDF worker crashed'));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return worker;
}

function call(msg: { type: 'fill'; job: FillJob } | { type: 'merge'; jobs: FillJob[] }): Promise<Uint8Array> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...msg });
  });
}

export async function buildJob(doc: PdfDoc, form: Form, values: Values, set: FormSet | undefined, flatten: boolean): Promise<FillJob> {
  const ctx = templateContext(form, values, set);
  const items = doc.mappings.map((m) => ({
    mapping: m,
    text: m.render === 'text' ? mappingText(m, ctx) : undefined,
    checked: m.render === 'check' ? mappingChecked(m, ctx) : undefined,
    image: m.render === 'image' ? mappingImage(m, ctx) : undefined,
  }));
  return { bytes: await getFile(doc.fileId), pages: doc.pages, acroFields: doc.acroFields, items, flatten };
}

export async function generate(doc: PdfDoc, form: Form, values: Values, set: FormSet | undefined, flatten: boolean) {
  return call({ type: 'fill', job: await buildJob(doc, form, values, set, flatten) });
}

export async function generateMerged(docs: PdfDoc[], form: Form, values: Values, set: FormSet | undefined) {
  const jobs = await Promise.all(docs.map((d) => buildJob(d, form, values, set, true)));
  return call({ type: 'merge', jobs });
}

export function outputFileName(doc: PdfDoc, form: Form, values: Values, set: FormSet | undefined, template?: string): string {
  const ctx = templateContext(form, values, set);
  ctx.extra = { ...ctx.extra, doc_name: doc.name };
  const name = renderTemplate(template ?? (doc.outputName || '{doc_name}'), ctx).replace(/\s*\n\s*/g, ' ');
  return sanitizeFileName(name || doc.name) + '.pdf';
}

export function folderName(template: string, form: Form, values: Values, set: FormSet | undefined): string {
  if (!template.trim()) return '';
  const ctx = templateContext(form, values, set);
  return template
    .split('/')
    .map((part) => sanitizeFileName(renderTemplate(part, ctx)))
    .filter((p) => p && p !== 'document')
    .join('/');
}

function blobUrl(bytes: Uint8Array) {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
}

export async function saveBytes(bytes: Uint8Array, fileName: string, folder = ''): Promise<void> {
  const url = blobUrl(bytes);
  const filename = folder ? `${folder}/${fileName}` : fileName;
  try {
    if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
      await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // back-to-back downloads get dropped by some browsers without a short gap
      await new Promise((r) => setTimeout(r, 350));
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function printBytes(bytes: Uint8Array): void {
  const url = blobUrl(bytes);
  const old = document.getElementById('print-frame');
  old?.remove();
  const iframe = document.createElement('iframe');
  iframe.id = 'print-frame';
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  iframe.src = url;
  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        window.open(url, '_blank');
      }
    }, 250);
  };
  document.body.appendChild(iframe);
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}

export function openBytes(bytes: Uint8Array): void {
  const url = blobUrl(bytes);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}
