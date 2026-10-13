import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FilePlus2,
  Files,
  History,
  Library,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  Truck,
  Workflow,
  X,
} from 'lucide-react';
import { useStore, useSet } from '../../lib/store';
import { navigate, routes } from '../../lib/router';
import type { PdfDoc, Scope } from '../../lib/types';
import { allFields, effectiveValues, rawValues, templateContext, visibleKeys } from '../../lib/values';
import { tokensIn } from '../../lib/template';
import { buildDrawItems } from '../../lib/preview';
import { importPdf } from '../../lib/importPdf';
import { folderName, generate, generateMerged, openBytes, outputFileName, printBytes, saveBytes } from '../../lib/pdf/output';
import { MenuItem, Popover, Segmented, Spinner, Switch, confirmDialog, cx, promptDialog, toast, usePopover } from '../../components/ui';
import { PageStack, Thumb, ValueLayer, useFitScale } from '../../components/PdfView';
import { DataForm } from './DataForm';
import { timeAgo } from '../../lib/util';
import { IS_WEB, onLaunchFiles, takeLaunchFiles } from '../../lib/platform';

type DataTab = 'load' | 'saved' | 'all';

export function usePdfDropImport(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
      if (files.length) onFiles(files);
      else toast('Only PDF files can be added here.', 'error');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, [onFiles]);
  return over;
}

export function FillView({ setId }: { setId: string }) {
  const set = useSet(setId);
  const form = useStore((s) => s.forms.find((f) => f.id === set?.formId));
  const allDocs = useStore((s) => s.docs);
  const sets = useStore((s) => s.sets);
  const history = useStore((s) => s.history);
  const settings = useStore((s) => s.settings);
  const { setValue, touchSet, newLoad, restoreHistory, addDoc, updateSet, updateDoc, deleteDoc, setSettings } = useStore.getState();

  const [tab, setTab] = useState<DataTab>('load');
  const [docId, setDocId] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const setMenu = usePopover();
  const histMenu = usePopover();
  const printMenu = usePopover();
  const saveMenu = usePopover();
  const docMenu = usePopover();
  const libMenu = usePopover();
  const [menuDoc, setMenuDoc] = useState<PdfDoc | null>(null);

  useEffect(() => {
    if (set) touchSet(set.id);
  }, [set?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!set) navigate(routes.home(), true);
  }, [set]);

  const docs = useMemo(() => (set ? (set.docIds.map((id) => allDocs.find((d) => d.id === id)).filter(Boolean) as PdfDoc[]) : []), [set, allDocs]);
  const doc = docs.find((d) => d.id === docId) ?? docs[0];
  const raw = useMemo(() => (form && set ? rawValues(form, set) : {}), [form, set]);
  const eff = useMemo(() => (form && set ? effectiveValues(form, set) : {}), [form, set]);
  const visible = useMemo(() => (form ? visibleKeys(form, raw) : new Set<string>()), [form, raw]);
  const ctx = useMemo(() => (form ? templateContext(form, eff, set) : null), [form, eff, set]);
  const items = useMemo(() => (doc && ctx ? buildDrawItems(doc, ctx) : []), [doc, ctx]);
  const fit = useFitScale(previewRef, doc?.pages[0]?.width ?? 612, 56, 1.6);
  const scale = zoom ?? fit;

  const hasLoadFields = useMemo(() => !!form && allFields(form).some((f) => f.scope === 'load'), [form]);
  useEffect(() => {
    if (!hasLoadFields) setTab('all');
  }, [hasLoadFields]);

  // which fields each doc uses → missing counts
  const usedByDoc = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const d of docs) m.set(d.id, new Set(d.mappings.flatMap((x) => tokensIn(x.source))));
    return m;
  }, [docs]);
  const missingFor = useCallback(
    (d: PdfDoc) => {
      const used = usedByDoc.get(d.id) ?? new Set<string>();
      const keys = form ? allFields(form).filter((f) => used.has(f.key)) : [];
      // hidden-by-condition fields are blank on purpose
      return keys.filter((f) => visible.has(f.key) && !(eff[f.key] ?? '').trim() && f.type !== 'checkbox');
    },
    [usedByDoc, form, eff, visible],
  );
  const usedKeys = useMemo(() => new Set([...usedByDoc.values()].flatMap((s) => [...s])), [usedByDoc]);

  const onFiles = useCallback(
    async (files: File[]) => {
      if (!form || !set) return;
      for (const file of files) {
        setImporting((n) => n + 1);
        try {
          const { doc: d, autoMapped, fillable } = await importPdf(file, form);
          addDoc(d, [set.id]);
          setDocId(d.id);
          const msg = fillable
            ? `Added "${d.name}" — ${autoMapped} of ${fillable} fillable fields matched automatically.`
            : `Added "${d.name}" — no fillable fields, so you'll place text boxes on it.`;
          toast(msg, 'success', { label: 'Map now', run: () => navigate(routes.map(d.id, set.id)) }, 7000);
        } catch (e) {
          toast(e instanceof Error ? e.message : String(e), 'error', undefined, 6000);
        } finally {
          setImporting((n) => n - 1);
        }
      }
    },
    [form, set, addDoc],
  );
  const dragOver = usePdfDropImport(onFiles);
  useEffect(() => {
    const pull = () => {
      const files = takeLaunchFiles();
      if (files.length) void onFiles(files);
    };
    pull();
    return onLaunchFiles(pull);
  }, [onFiles]);

  if (!set || !form) return null;

  const onChange = (key: string, v: string) => setValue(form.id, set.id, key, v);
  const included = docs.filter((d) => !excluded.has(d.id));
  const folder = folderName(settings.downloadFolder, form, eff, set);
  const setHistory = history.filter((h) => h.setId === set.id);
  const scopes: Scope[] | undefined = tab === 'load' ? ['load'] : tab === 'saved' ? ['global', 'set'] : undefined;
  const library = allDocs.filter((d) => d.formId === form.id && !set.docIds.includes(d.id));

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error', undefined, 6000);
    } finally {
      setBusy(null);
    }
  };

  const warnMissing = async (list: PdfDoc[]) => {
    const missing = [...new Set(list.flatMap((d) => missingFor(d).map((f) => f.label)))];
    if (!missing.length) return true;
    return confirmDialog({
      title: `${missing.length} field${missing.length === 1 ? ' is' : 's are'} empty`,
      message: (
        <>
          These will print blank: <strong>{missing.slice(0, 8).join(', ')}</strong>
          {missing.length > 8 ? ` and ${missing.length - 8} more` : ''}.
        </>
      ),
      confirm: 'Continue anyway',
      cancel: 'Go back',
    });
  };

  const saveOne = (d: PdfDoc) =>
    run('save', async () => {
      if (!(await warnMissing([d]))) return;
      const bytes = await generate(d, form, eff, set, settings.flattenOnSave);
      const name = outputFileName(d, form, eff, set);
      await saveBytes(bytes, name, folder);
      toast(`Saved ${name}`, 'success');
    });
  const saveEach = () =>
    run('save', async () => {
      if (!included.length || !(await warnMissing(included))) return;
      for (const d of included) await saveBytes(await generate(d, form, eff, set, settings.flattenOnSave), outputFileName(d, form, eff, set), folder);
      toast(`Saved ${included.length} PDF${included.length === 1 ? '' : 's'}${folder && !IS_WEB ? ` to Downloads/${folder}` : ''}`, 'success');
    });
  const saveMerged = () =>
    run('save', async () => {
      if (!included.length || !(await warnMissing(included))) return;
      const bytes = await generateMerged(included, form, eff, set);
      const name = outputFileName(included[0], form, eff, set, `{set_name} packet {load_number}`);
      await saveBytes(bytes, name, folder);
      toast(`Saved ${name}`, 'success');
    });
  const printDocs = (list: PdfDoc[]) =>
    run('print', async () => {
      if (!list.length || !(await warnMissing(list))) return;
      printBytes(await generateMerged(list, form, eff, set));
    });
  const openDoc = (d: PdfDoc) => run('open', async () => openBytes(await generate(d, form, eff, set, settings.flattenOnSave)));

  const startNewLoad = async () => {
    const hasData = Object.values(set.loadValues).some((v) => v);
    if (hasData && !(await confirmDialog({ title: 'Start a new load?', message: 'The current load is saved to history so you can reopen or reprint it later. Load fields will be cleared.', confirm: 'New load' })))
      return;
    newLoad(set.id);
    setTab('load');
    const latest = useStore.getState().history.find((h) => h.setId === set.id);
    toast('New load started', 'success', latest && hasData ? { label: 'Undo', run: () => restoreHistory(latest.id) } : undefined);
  };

  return (
    <div className="fill">
      <div className="fill-head">
        <button className="set-switch" onClick={(e) => setMenu.toggle(e.currentTarget)}>
          <span className="dot" style={{ background: set.color }} />
          <span className="truncate">{set.name}</span>
          <ChevronDown size={16} />
        </button>
        <span className="small faint truncate hide-sm">{form.name}</span>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={(e) => histMenu.toggle(e.currentTarget)} disabled={!setHistory.length}>
          <History /> History{setHistory.length ? ` (${setHistory.length})` : ''}
        </button>
        {hasLoadFields && (
          <button className="btn btn-soft btn-sm" onClick={startNewLoad}>
            <Truck /> New load
          </button>
        )}
      </div>

      <div className="fill-body">
        <aside className="fill-left">
          <div className="fill-left-head">
            <Segmented
              block
              value={tab}
              onChange={setTab}
              options={[
                ...(hasLoadFields ? [{ value: 'load' as const, label: 'This load' }] : []),
                { value: 'saved' as const, label: 'Saved info' },
                { value: 'all' as const, label: 'Everything' },
              ]}
            />
          </div>
          <div className="fill-left-scroll">
            <DataForm form={form} values={raw} onChange={onChange} scopes={scopes} showScope={tab === 'all'} highlightMissing usedKeys={usedKeys} />
            <button className="btn btn-ghost btn-sm edit-form-link" onClick={() => navigate(routes.form(form.id))}>
              <Pencil /> Add or change fields
            </button>
          </div>
        </aside>

        <section className="fill-right">
          <div className="doc-strip">
            {docs.map((d) => {
              const miss = missingFor(d).length;
              const on = !excluded.has(d.id);
              return (
                <div key={d.id} className={cx('doc-tab', d.id === doc?.id && 'active', !on && 'off')} onClick={() => setDocId(d.id)}>
                  <input
                    type="checkbox"
                    className="doc-include"
                    checked={on}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() =>
                      setExcluded((x) => {
                        const n = new Set(x);
                        if (n.has(d.id)) n.delete(d.id);
                        else n.add(d.id);
                        return n;
                      })
                    }
                    data-tip="Include when printing / saving all"
                  />
                  <div className="doc-tab-thumb">
                    <Thumb doc={d} width={30} />
                  </div>
                  <div className="doc-tab-text">
                    <span className="truncate">{d.name}</span>
                    {d.mappings.length === 0 ? (
                      <span className="tiny warn-text">Not mapped yet</span>
                    ) : miss ? (
                      <span className="tiny warn-text">
                        <AlertCircle size={11} /> {miss} empty
                      </span>
                    ) : (
                      <span className="tiny ok-text">
                        <CheckCircle2 size={11} /> Ready
                      </span>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost btn-icon btn-sm doc-tab-menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuDoc(d);
                      docMenu.toggle(e.currentTarget);
                    }}
                    aria-label="Document options"
                  >
                    <MoreHorizontal />
                  </button>
                </div>
              );
            })}
            <label className="doc-add">
              {importing ? <Spinner /> : <FilePlus2 size={16} />}
              <span>Add PDF</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                multiple
                hidden
                onChange={(e) => {
                  const f = [...(e.target.files ?? [])];
                  e.target.value = '';
                  void onFiles(f);
                }}
              />
            </label>
            {library.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={(e) => libMenu.toggle(e.currentTarget)}>
                <Library /> From library
              </button>
            )}
          </div>

          <div className="preview-area" ref={previewRef}>
            {doc ? (
              <>
                <div className="preview-tools">
                  <button className="btn btn-sm" onClick={() => navigate(routes.map(doc.id, set.id))}>
                    <Workflow /> Edit mapping
                  </button>
                  <div className="zoom">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(Math.max(0.4, scale - 0.15))} aria-label="Zoom out">
                      <Minus />
                    </button>
                    <button className="zoom-val" onClick={() => setZoom(null)} data-tip="Fit width">
                      {Math.round(scale * 100)}%
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(Math.min(3, scale + 0.15))} aria-label="Zoom in">
                      <Plus />
                    </button>
                  </div>
                </div>
                <PageStack
                  doc={doc}
                  scale={scale}
                  overlay={(i) => <ValueLayer items={items[i] ?? []} width={doc.pages[i].width} height={doc.pages[i].height} scale={scale} />}
                />
                {doc.mappings.length === 0 && (
                  <div className="preview-callout">
                    <Workflow size={18} />
                    <div className="grow">
                      <strong>This PDF isn't mapped yet.</strong>
                      <div className="small muted">Tell it where each piece of your data goes — it only takes a minute, once.</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={() => navigate(routes.map(doc.id, set.id))}>
                      Map it
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="preview-empty">
                <div className="empty-icon">
                  <Files size={24} />
                </div>
                <h3>Add the PDFs for this set</h3>
                <p className="small muted">Drop your BOL, rate confirmation, trip sheet or any form here. Fillable or not — both work.</p>
                <label className="btn btn-primary">
                  <FilePlus2 /> Choose PDFs
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    hidden
                    onChange={(e) => {
                      const f = [...(e.target.files ?? [])];
                      e.target.value = '';
                      void onFiles(f);
                    }}
                  />
                </label>
              </div>
            )}
          </div>

          {docs.length > 0 && (
            <div className="action-bar">
              <label className="row small muted" data-tip="Flattened PDFs can't be edited by whoever receives them" data-tip-pos="top">
                <Switch checked={settings.flattenOnSave} onChange={(v) => setSettings({ flattenOnSave: v })} />
                Lock fields when saving
              </label>
              <div className="spacer" />
              {doc && (
                <button className="btn btn-ghost" onClick={() => openDoc(doc)} disabled={!!busy} data-tip="Open the filled PDF in a new tab" data-tip-pos="top">
                  {busy === 'open' ? <Spinner /> : <ExternalLink />}
                </button>
              )}
              <div className="split-btn">
                <button className="btn" onClick={() => doc && printDocs([doc])} disabled={!!busy || !doc}>
                  {busy === 'print' ? <Spinner /> : <Printer />} Print
                </button>
                <button className="btn btn-icon" onClick={(e) => printMenu.toggle(e.currentTarget)} disabled={!!busy} aria-label="More print options">
                  <ChevronDown />
                </button>
              </div>
              <div className="split-btn">
                <button className="btn btn-primary" onClick={() => doc && saveOne(doc)} disabled={!!busy || !doc}>
                  {busy === 'save' ? <Spinner /> : <Download />} Save PDF
                </button>
                <button className="btn btn-primary btn-icon" onClick={(e) => saveMenu.toggle(e.currentTarget)} disabled={!!busy} aria-label="More save options">
                  <ChevronDown />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {dragOver && (
        <div className="global-drop">
          <div>
            <FilePlus2 /> Drop to add to “{set.name}”
          </div>
        </div>
      )}

      <Popover anchor={setMenu.anchor} onClose={setMenu.close} width={280}>
        <div className="menu-label">Switch set</div>
        {sets
          .filter((s) => s.formId === form.id)
          .map((s) => (
            <MenuItem
              key={s.id}
              icon={<span className="dot" style={{ background: s.color }} />}
              onClick={() => {
                setMenu.close();
                navigate(routes.fill(s.id));
              }}
              hint={s.id === set.id ? 'current' : undefined}
            >
              {s.name}
            </MenuItem>
          ))}
        <div className="menu-sep" />
        <MenuItem
          icon={<Pencil />}
          onClick={async () => {
            setMenu.close();
            const name = await promptDialog({ title: 'Rename set', value: set.name });
            if (name) updateSet(set.id, { name });
          }}
        >
          Rename this set
        </MenuItem>
        <MenuItem
          icon={<Plus />}
          onClick={async () => {
            setMenu.close();
            const name = await promptDialog({ title: 'New set', label: 'Copies this set’s saved info and PDFs — then change what differs.', placeholder: 'e.g. Employer B · Truck 7', confirm: 'Create' });
            if (name) navigate(routes.fill(useStore.getState().addSet(form.id, name, undefined, set.id).id));
          }}
        >
          New set from this one
        </MenuItem>
      </Popover>

      <Popover anchor={histMenu.anchor} onClose={histMenu.close} align="end" width={300}>
        <div className="menu-label">Previous loads</div>
        {setHistory.map((h) => (
          <MenuItem
            key={h.id}
            icon={<RotateCcw />}
            hint={timeAgo(h.createdAt)}
            onClick={async () => {
              histMenu.close();
              if (await confirmDialog({ title: `Reopen "${h.label}"?`, message: 'It replaces the load currently on screen. Start a New load first to keep the current one.', confirm: 'Reopen' }))
                restoreHistory(h.id);
            }}
          >
            {h.label}
          </MenuItem>
        ))}
      </Popover>

      <Popover anchor={printMenu.anchor} onClose={printMenu.close} align="end">
        <MenuItem
          icon={<Printer />}
          onClick={() => {
            printMenu.close();
            if (doc) void printDocs([doc]);
          }}
        >
          Print “{doc?.name}”
        </MenuItem>
        <MenuItem
          icon={<Files />}
          onClick={() => {
            printMenu.close();
            void printDocs(included);
          }}
          hint={`${included.length}`}
        >
          Print all checked
        </MenuItem>
      </Popover>

      <Popover anchor={saveMenu.anchor} onClose={saveMenu.close} align="end">
        <MenuItem
          icon={<Download />}
          onClick={() => {
            saveMenu.close();
            if (doc) void saveOne(doc);
          }}
        >
          Save “{doc?.name}”
        </MenuItem>
        <MenuItem
          icon={<Files />}
          onClick={() => {
            saveMenu.close();
            void saveEach();
          }}
          hint={`${included.length}`}
        >
          Save all checked (separate files)
        </MenuItem>
        <MenuItem
          icon={<Files />}
          onClick={() => {
            saveMenu.close();
            void saveMerged();
          }}
        >
          Save all checked as one PDF
        </MenuItem>
        <div className="menu-sep" />
        <div className="menu-label">{IS_WEB ? 'Saves to your browser’s download folder' : `Saves to Downloads/${folder || '…'}`}</div>
      </Popover>

      <Popover anchor={docMenu.anchor} onClose={docMenu.close} align="end">
        {menuDoc && (
          <>
            <MenuItem
              icon={<Workflow />}
              onClick={() => {
                docMenu.close();
                navigate(routes.map(menuDoc.id, set.id));
              }}
            >
              Edit mapping
            </MenuItem>
            <MenuItem
              icon={<Pencil />}
              onClick={async () => {
                docMenu.close();
                const name = await promptDialog({ title: 'Rename document', value: menuDoc.name });
                if (name) updateDoc(menuDoc.id, (d) => ({ ...d, name }));
              }}
            >
              Rename
            </MenuItem>
            <MenuItem
              icon={<X />}
              onClick={() => {
                docMenu.close();
                updateSet(set.id, { docIds: set.docIds.filter((x) => x !== menuDoc.id) });
                toast(`Removed "${menuDoc.name}" from this set (still in your library)`, 'info', {
                  label: 'Undo',
                  run: () => updateSet(set.id, { docIds: [...useStore.getState().sets.find((s) => s.id === set.id)!.docIds, menuDoc.id] }),
                });
              }}
            >
              Remove from this set
            </MenuItem>
            <div className="menu-sep" />
            <MenuItem
              danger
              icon={<Trash2 />}
              onClick={async () => {
                docMenu.close();
                const usedElsewhere = sets.filter((s) => s.id !== set.id && s.docIds.includes(menuDoc.id)).length;
                if (
                  await confirmDialog({
                    title: `Delete "${menuDoc.name}"?`,
                    message: usedElsewhere ? `It's also used by ${usedElsewhere} other set${usedElsewhere > 1 ? 's' : ''}. The PDF and its mapping are deleted everywhere.` : 'The PDF and its mapping are deleted.',
                    confirm: 'Delete',
                    danger: true,
                  })
                )
                  deleteDoc(menuDoc.id);
              }}
            >
              Delete PDF
            </MenuItem>
          </>
        )}
      </Popover>

      <Popover anchor={libMenu.anchor} onClose={libMenu.close} width={300}>
        <div className="menu-label">Add a PDF you already mapped</div>
        {library.map((d) => (
          <MenuItem
            key={d.id}
            icon={<FilePlus2 />}
            hint={`${d.mappings.length} mapped`}
            onClick={() => {
              libMenu.close();
              updateSet(set.id, { docIds: [...set.docIds, d.id] });
              setDocId(d.id);
            }}
          >
            {d.name}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
