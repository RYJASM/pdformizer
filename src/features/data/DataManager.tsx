import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, Download, FileJson, FileText, HardDrive, Pencil, Settings2, Trash2, Upload } from 'lucide-react';
import { useStore, emptyWorkspace } from '../../lib/store';
import type { FormSet } from '../../lib/types';
import { exportDataText, groupChanges, parseDataText, type ParsedData } from '../../lib/textdata';
import { downloadText, exportBackup, exportFormTemplate, instantiateFormBundle, parseBundle, restoreBackupFiles } from '../../lib/bundle';
import { allFileIds, deleteFile } from '../../lib/db';
import { formatBytes, sanitizeFileName } from '../../lib/util';
import { formatDate } from '../../lib/template';
import { IS_WEB } from '../../lib/platform';
import { Modal, Segmented, Switch, confirmDialog, pickFile, toast } from '../../components/ui';

function ImportPreview({ parsed, onClose, onApply }: { parsed: ParsedData | null; onClose: () => void; onApply: () => void }) {
  if (!parsed) return null;
  const groups = groupChanges(parsed.changes);
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Review changes"
      description={parsed.changes.length ? `${parsed.changes.length} value${parsed.changes.length === 1 ? '' : 's'} will change.` : 'Nothing in this file differs from what you have.'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!parsed.changes.length} onClick={onApply}>
            Apply {parsed.changes.length} change{parsed.changes.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {parsed.newSets.length > 0 && (
        <div className="notice">
          New set{parsed.newSets.length > 1 ? 's' : ''} will be created: <strong>{parsed.newSets.join(', ')}</strong>
        </div>
      )}
      {parsed.warnings.length > 0 && (
        <div className="notice warn">
          <AlertTriangle size={16} />
          <ul>
            {parsed.warnings.slice(0, 12).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
            {parsed.warnings.length > 12 && <li>…and {parsed.warnings.length - 12} more</li>}
          </ul>
        </div>
      )}
      {[...groups.entries()].map(([title, list]) => (
        <div key={title} className="diff-group">
          <h4>{title}</h4>
          <table className="diff">
            <tbody>
              {list.map((c) => (
                <tr key={c.key + title}>
                  <td className="diff-label">{c.label}</td>
                  <td className="diff-from">{c.from || <span className="faint">empty</span>}</td>
                  <td className="faint">→</td>
                  <td className="diff-to">{c.to || <span className="faint">empty</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </Modal>
  );
}

export function DataManager() {
  const forms = useStore((s) => s.forms);
  const sets = useStore((s) => s.sets);
  const docs = useStore((s) => s.docs);
  const settings = useStore((s) => s.settings);
  const { setSettings, setValues, addSet, addForm, addDoc, replaceWorkspace } = useStore.getState();

  const [formId, setFormId] = useState(settings.activeFormId ?? forms[0]?.id);
  const form = forms.find((f) => f.id === formId) ?? forms[0];
  const formSets = useMemo(() => sets.filter((s) => s.formId === form?.id), [sets, form?.id]);
  const [parsed, setParsed] = useState<ParsedData | null>(null);
  const [editor, setEditor] = useState<string | null>(null);
  const [withPdfs, setWithPdfs] = useState(true);
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null);

  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => setUsage({ used: e.usage ?? 0, quota: e.quota ?? 0 }));
  }, [docs.length]);

  const stamp = formatDate(new Date(), 'YYYY-MM-DD');

  const parse = (text: string) => {
    if (!form) return;
    const active = formSets.find((s) => s.id === settings.activeSetId) ?? formSets[0];
    setParsed(parseDataText(text, form, formSets, active));
  };

  const apply = () => {
    if (!form || !parsed) return;
    const created = new Map<string, FormSet>();
    for (const name of parsed.newSets) created.set(name.toLowerCase(), addSet(form.id, name));
    const global: Record<string, string> = {};
    const perSet = new Map<string, Record<string, string>>();
    for (const c of parsed.changes) {
      if (c.target === 'global') global[c.key] = c.to;
      else {
        const id = c.target.setId ?? created.get(c.target.setName.toLowerCase())?.id;
        if (!id) continue;
        perSet.set(id, { ...(perSet.get(id) ?? {}), [c.key]: c.to });
      }
    }
    if (Object.keys(global).length) setValues(form.id, undefined, global);
    for (const [id, v] of perSet) setValues(form.id, id, v);
    toast(`Applied ${parsed.changes.length} change${parsed.changes.length === 1 ? '' : 's'}`, 'success');
    setParsed(null);
    setEditor(null);
  };

  if (!form) {
    return (
      <div className="page-wrap">
        <div className="data-page">
          <h1>Data</h1>
          <p className="muted">Nothing here yet — create a form first, or restore a backup below.</p>
          <BackupCard />
        </div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="data-page">
        <div className="row" style={{ marginBottom: 6 }}>
          <h1 className="grow">Data & backup</h1>
          {forms.length > 1 && (
            <select className="select" style={{ width: 'auto' }} value={form.id} onChange={(e) => setFormId(e.target.value)}>
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="muted" style={{ marginBottom: 20 }}>
          Everything is stored privately in this browser{IS_WEB ? ' (for this exact address — keep using the same one)' : ''}. Export regularly so you never lose your setup.
        </p>

        <div className="data-grid">
          <section className="card data-card">
            <div className="dc-icon">
              <FileText />
            </div>
            <h3>Your info as a text file</h3>
            <p className="small muted">
              All values for <strong>{form.name}</strong> — shared, per set and current loads — in a simple <code>name: value</code> file you can edit in Notepad.
              Mistakes won't break anything: you'll see a preview before anything changes.
            </p>
            <div className="row wrap">
              <button className="btn btn-primary btn-sm" onClick={() => downloadText(exportDataText(form, formSets), `${sanitizeFileName(form.name)} data ${stamp}.txt`)}>
                <Download /> Export .txt
              </button>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const f = await pickFile('.txt,text/plain');
                  if (f) parse(await f.text());
                }}
              >
                <Upload /> Import .txt
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditor(exportDataText(form, formSets))}>
                <Pencil /> Edit as text
              </button>
            </div>
          </section>

          <section className="card data-card">
            <div className="dc-icon">
              <FileJson />
            </div>
            <h3>Form template</h3>
            <p className="small muted">The fields, PDFs and mappings — without your personal info. Share it with another driver or reuse it for a new company.</p>
            <label className="row small">
              <Switch checked={withPdfs} onChange={setWithPdfs} /> Include the PDFs ({docs.filter((d) => d.formId === form.id).length})
            </label>
            <div className="row wrap">
              <button
                className="btn btn-primary btn-sm"
                onClick={async () =>
                  downloadText(
                    await exportFormTemplate(form, docs.filter((d) => d.formId === form.id), withPdfs),
                    `${sanitizeFileName(form.name)} template.json`,
                    'application/json',
                  )
                }
              >
                <Download /> Export template
              </button>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  const f = await pickFile('.json,application/json');
                  if (!f) return;
                  try {
                    const b = parseBundle(await f.text());
                    if (b.kind !== 'form') return toast('That is a full backup — use “Restore backup” below.', 'info');
                    const raw = JSON.parse(await f.text()).docs ?? [];
                    const { form: nf, docs: nd } = await instantiateFormBundle(b, raw);
                    addForm(nf);
                    const st = addSet(nf.id, 'My set');
                    for (const d of nd) addDoc(d, [st.id]);
                    setFormId(nf.id);
                    toast(`Imported “${nf.name}” with ${nd.length} PDF${nd.length === 1 ? '' : 's'}`, 'success');
                  } catch (e) {
                    toast(e instanceof Error ? e.message : String(e), 'error');
                  }
                }}
              >
                <Upload /> Import template
              </button>
            </div>
          </section>

          <BackupCard />

          <section className="card data-card">
            <div className="dc-icon">
              <Settings2 />
            </div>
            <h3>Preferences</h3>
            <div className="field">
              <label>Theme</label>
              <Segmented
                value={settings.theme}
                onChange={(theme) => setSettings({ theme })}
                options={[
                  { value: 'system', label: 'Auto' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </div>
            {!IS_WEB && (
            <div className="field">
              <label>Save PDFs into Downloads/</label>
              <input className="input input-sm mono" value={settings.downloadFolder} onChange={(e) => setSettings({ downloadFolder: e.target.value })} placeholder="Autofill My PDF/{set_name}" />
              <div className="field-help">Use / for sub-folders. Tokens like {'{set_name}'} or {'{load_number}'} work. Leave blank for Downloads itself.</div>
            </div>
            )}
            <label className="row small">
              <Switch checked={settings.flattenOnSave} onChange={(v) => setSettings({ flattenOnSave: v })} /> Lock fields in saved PDFs by default
            </label>
          </section>
        </div>

        <section className="card danger-card">
          <HardDrive size={18} />
          <div className="grow">
            <strong>Storage</strong>
            <div className="small muted">
              {usage ? `${formatBytes(usage.used)} used on this computer` : '…'} · {forms.length} form{forms.length === 1 ? '' : 's'}, {sets.length} set
              {sets.length === 1 ? '' : 's'}, {docs.length} PDF{docs.length === 1 ? '' : 's'}
            </div>
          </div>
          <button
            className="btn btn-sm btn-danger"
            onClick={async () => {
              if (
                !(await confirmDialog({
                  title: 'Erase everything?',
                  message: 'Deletes all forms, sets, values, PDFs and history from this browser. This cannot be undone — export a backup first.',
                  confirm: 'Erase all',
                  danger: true,
                }))
              )
                return;
              for (const id of await allFileIds()) await deleteFile(id);
              replaceWorkspace(emptyWorkspace());
              toast('All data erased', 'success');
            }}
          >
            <Trash2 /> Erase all data
          </button>
        </section>
      </div>

      <ImportPreview parsed={parsed} onClose={() => setParsed(null)} onApply={apply} />
      <Modal
        open={editor !== null && !parsed}
        onClose={() => setEditor(null)}
        wide
        title="Edit your info as text"
        description="Change values after the colons. Lines starting with # are notes."
        footer={
          <>
            <button className="btn" onClick={() => setEditor(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => editor !== null && parse(editor)}>
              Review changes
            </button>
          </>
        }
      >
        <textarea className="textarea mono text-editor" value={editor ?? ''} onChange={(e) => setEditor(e.target.value)} spellCheck={false} />
      </Modal>
    </div>
  );
}

function BackupCard() {
  const replaceWorkspace = useStore((s) => s.replaceWorkspace);
  return (
    <section className="card data-card">
      <div className="dc-icon">
        <Archive />
      </div>
      <h3>Full backup</h3>
      <p className="small muted">Everything — forms, sets, values, signatures, PDFs, mappings and load history — in one file. Use it to move to a new computer.</p>
      <div className="row wrap">
        <button
          className="btn btn-primary btn-sm"
          onClick={async () => {
            const s = useStore.getState();
            const ws = { version: 1 as const, forms: s.forms, sets: s.sets, docs: s.docs, history: s.history, settings: s.settings };
            downloadText(await exportBackup(ws), `Autofill My PDF backup ${formatDate(new Date(), 'YYYY-MM-DD')}.json`, 'application/json');
          }}
        >
          <Download /> Download backup
        </button>
        <button
          className="btn btn-sm"
          onClick={async () => {
            const f = await pickFile('.json,application/json');
            if (!f) return;
            try {
              const b = parseBundle(await f.text());
              if (b.kind !== 'backup') return toast('That is a form template — use “Import template”.', 'info');
              if (!(await confirmDialog({ title: 'Restore this backup?', message: 'Your current data will be replaced by the backup.', confirm: 'Restore', danger: true }))) return;
              await restoreBackupFiles(b.files);
              replaceWorkspace(b.workspace);
              toast('Backup restored', 'success');
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), 'error');
            }
          }}
        >
          <Upload /> Restore backup
        </button>
      </div>
    </section>
  );
}

