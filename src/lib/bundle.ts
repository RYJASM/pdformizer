// JSON bundles: form templates (fields + PDFs + mappings, no personal data) and full backups.
import type { Form, PdfDoc, Workspace } from './types';
import { getFile, putFile } from './db';
import { base64ToBytes, bytesToBase64, uid } from './util';

const FORM_KIND = 'autofill-my-pdf/form';
const BACKUP_KIND = 'autofill-my-pdf/backup';

interface FormBundle {
  kind: typeof FORM_KIND;
  version: 1;
  exportedAt: string;
  form: Form;
  docs: (PdfDoc & { pdf?: string })[];
}

interface BackupBundle {
  kind: typeof BACKUP_KIND;
  version: 1;
  exportedAt: string;
  workspace: Workspace;
  files: Record<string, string>;
}

export async function exportFormTemplate(form: Form, docs: PdfDoc[], includePdfs: boolean): Promise<string> {
  const bundle: FormBundle = {
    kind: FORM_KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    form: { ...form, globalValues: {}, isSample: undefined },
    docs: [],
  };
  if (includePdfs) {
    for (const d of docs) bundle.docs.push({ ...d, pdf: bytesToBase64(await getFile(d.fileId)) });
  }
  return JSON.stringify(bundle, null, 2);
}

export async function exportBackup(ws: Workspace): Promise<string> {
  const files: Record<string, string> = {};
  for (const d of ws.docs) {
    if (files[d.fileId]) continue;
    try {
      files[d.fileId] = bytesToBase64(await getFile(d.fileId));
    } catch {
      /* missing file — skip */
    }
  }
  const bundle: BackupBundle = { kind: BACKUP_KIND, version: 1, exportedAt: new Date().toISOString(), workspace: ws, files };
  return JSON.stringify(bundle);
}

export type ParsedBundle =
  | { kind: 'form'; form: Form; docs: PdfDoc[]; pdfCount: number }
  | { kind: 'backup'; workspace: Workspace; files: Record<string, string> };

export function parseBundle(text: string): ParsedBundle {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a valid Autofill My PDF export (it isn't readable JSON).");
  }
  const d = (data ?? {}) as { kind?: string; workspace?: Workspace; files?: Record<string, string>; form?: Form; docs?: (PdfDoc & { pdf?: string })[] };
  if (d.kind === BACKUP_KIND && d.workspace) {
    return { kind: 'backup', workspace: d.workspace, files: d.files ?? {} };
  }
  if (d.kind === FORM_KIND && d.form && Array.isArray(d.form.sections)) {
    return { kind: 'form', form: d.form, docs: d.docs ?? [], pdfCount: (d.docs ?? []).filter((x) => x.pdf).length };
  }
  throw new Error("This file isn't a form template or backup from Autofill My PDF.");
}

/** Materialise a form template with fresh ids; stores embedded PDFs. */
export async function instantiateFormBundle(b: Extract<ParsedBundle, { kind: 'form' }>, rawDocs: (PdfDoc & { pdf?: string })[]) {
  const now = Date.now();
  const form: Form = {
    ...b.form,
    id: uid('form'),
    globalValues: {},
    createdAt: now,
    updatedAt: now,
    sections: b.form.sections.map((s) => ({ ...s, id: uid('s'), fields: s.fields.map((f) => ({ ...f, id: uid('f') })) })),
  };
  const docs: PdfDoc[] = [];
  for (const rd of rawDocs) {
    if (!rd.pdf) continue;
    const fileId = uid('file');
    await putFile(fileId, base64ToBytes(rd.pdf));
    const { pdf: _pdf, ...rest } = rd;
    void _pdf;
    docs.push({ ...rest, id: uid('doc'), formId: form.id, fileId, createdAt: now, updatedAt: now, mappings: rest.mappings.map((m) => ({ ...m, id: uid('m') })) });
  }
  return { form, docs };
}

export async function restoreBackupFiles(files: Record<string, string>) {
  for (const [id, b64] of Object.entries(files)) await putFile(id, base64ToBytes(b64));
}

export function downloadText(text: string, fileName: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
