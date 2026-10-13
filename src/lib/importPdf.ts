import type { Form, PdfDoc } from './types';
import { putFile } from './db';
import { analyzePdf, closePdf, openPdf } from './pdf/pdfjs';
import { suggestMappings } from './automap';
import { uid } from './util';

export interface ImportResult {
  doc: PdfDoc;
  autoMapped: number;
  fillable: number;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF" may be preceded by a little junk; check the first KB
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF');
}

export async function importPdf(file: File | { name: string; bytes: Uint8Array }, form: Form, autoMap = true): Promise<ImportResult> {
  const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  if (!looksLikePdf(bytes)) throw new Error(`"${file.name}" doesn't look like a PDF.`);
  let pdf;
  try {
    pdf = await openPdf(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new Error(`"${file.name}" is password-protected. Remove the password and try again.`);
    throw new Error(`Couldn't open "${file.name}": ${msg}`);
  }
  const { pages, acroFields } = await analyzePdf(pdf);
  closePdf(pdf);
  const fileId = uid('file');
  await putFile(fileId, bytes);
  const name = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document';
  const doc: PdfDoc = {
    id: uid('doc'),
    formId: form.id,
    name,
    fileId,
    fileName: file.name,
    fileSize: bytes.byteLength,
    pages,
    acroFields,
    mappings: [],
    outputName: `{doc_name} {load_number}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (autoMap) doc.mappings = suggestMappings(form, acroFields).map((s) => s.mapping);
  return { doc, autoMapped: doc.mappings.length, fillable: acroFields.length };
}
