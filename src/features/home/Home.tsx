import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Copy,
  FileStack,
  History,
  ListChecks,
  MoreHorizontal,
  Palette,
  Pencil,
  PenLine,
  Plus,
  Printer,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  Workflow,
} from 'lucide-react';
import { useStore } from '../../lib/store';
import { navigate, routes } from '../../lib/router';
import { parseBundle, restoreBackupFiles } from '../../lib/bundle';
import type { FormSet } from '../../lib/types';
import { SET_COLORS } from '../../lib/types';
import { timeAgo } from '../../lib/util';
import { ColorPicker, Modal, MenuItem, Popover, Spinner, confirmDialog, cx, pickFile, promptDialog, toast, usePopover } from '../../components/ui';
import { Thumb } from '../../components/PdfView';
import { Logo } from '../../components/Logo';

export async function openSample() {
  const s = useStore.getState();
  const existing = s.forms.find((f) => f.isSample);
  if (existing) {
    const set = s.sets.find((x) => x.formId === existing.id);
    const doc = s.docs.find((d) => d.formId === existing.id);
    if (doc && set) return navigate(routes.map(doc.id, set.id));
  }
  const { buildSampleWorkspace } = await import('../../lib/sample');
  const { form, sets, docs } = await buildSampleWorkspace();
  s.addForm(form);
  for (const d of docs) s.addDoc(d);
  s.insertSets(sets);
  s.setSettings({ activeFormId: form.id, activeSetId: sets[0].id, seenSample: true });
  navigate(routes.map(docs[0].id, sets[0].id));
}

function Welcome() {
  const [busy, setBusy] = useState(false);
  const importBackup = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const b = parseBundle(await file.text());
      if (b.kind !== 'backup') {
        navigate(routes.data());
        toast('That is a form template — import it from the Data page.', 'info');
        return;
      }
      await restoreBackupFiles(b.files);
      useStore.getState().replaceWorkspace(b.workspace);
      toast('Backup restored', 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };
  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-inner">
        <Logo size={56} />
        <h1>
          Your paperwork,
          <br />
          <span className="grad">filled in seconds.</span>
        </h1>
        <p className="lead">
          Enter your info once. Map it onto any PDF — bills of lading, rate cons, trip sheets, carrier packets — then fill, sign, save and print
          for every load.
        </p>
        <div className="start-cards">
          <button className="start-card primary" onClick={() => navigate(routes.wizard())}>
            <div className="start-icon">
              <Wand2 />
            </div>
            <div className="grow">
              <h3>Set up my forms</h3>
              <p>A 2-minute guided setup with trucking-ready fields. Bring your own PDFs.</p>
            </div>
            <ArrowRight className="start-arrow" />
          </button>
          <button
            className="start-card"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await openSample();
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e), 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="start-icon alt">{busy ? <Spinner /> : <Sparkles />}</div>
            <div className="grow">
              <h3>Explore the sample</h3>
              <p>A filled Bill of Lading and trip sheet with live mapping lines you can play with.</p>
            </div>
            <ArrowRight className="start-arrow" />
          </button>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={importBackup}>
          <Upload /> Restore from a backup file
        </button>
        <div className="feature-row">
          <div>
            <Workflow />
            <strong>Map once</strong>
            <span>Drag fields onto any PDF — fillable or not.</span>
          </div>
          <div>
            <FileStack />
            <strong>Sets for every job</strong>
            <span>Employer A · Truck 12, Employer B · Truck 7…</span>
          </div>
          <div>
            <PenLine />
            <strong>Sign & print</strong>
            <span>Draw or photograph your signature.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SetCard({ set }: { set: FormSet }) {
  const docs = useStore((s) => s.docs);
  const updateSet = useStore((s) => s.updateSet);
  const deleteSet = useStore((s) => s.deleteSet);
  const addSet = useStore((s) => s.addSet);
  const menu = usePopover();
  const [colorOpen, setColorOpen] = useState(false);
  const mine = set.docIds.map((id) => docs.find((d) => d.id === id)).filter(Boolean) as typeof docs;
  const loadNo = set.loadValues.load_number || set.loadValues.bol_number;

  return (
    <div className="set-card" style={{ ['--set' as string]: set.color }}>
      <div className="set-card-top" onClick={() => navigate(routes.fill(set.id))}>
        <div className="set-thumbs">
          {mine.slice(0, 3).map((d, i) => (
            <div key={d.id} className="set-thumb" style={{ transform: `translateX(${i * 26}px) rotate(${(i - 1) * 4}deg)`, zIndex: 3 - i }}>
              <Thumb doc={d} width={78} />
            </div>
          ))}
          {mine.length === 0 && (
            <div className="set-thumb-empty">
              <Plus size={18} />
              Add PDFs
            </div>
          )}
        </div>
      </div>
      <div className="set-card-body">
        <div className="row">
          <span className="dot" style={{ background: set.color }} />
          <h3 className="grow truncate">{set.name}</h3>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => menu.toggle(e.currentTarget)} aria-label="Set options">
            <MoreHorizontal />
          </button>
        </div>
        <div className="row small muted">
          <span>
            {mine.length} document{mine.length === 1 ? '' : 's'}
          </span>
          <span className="faint">·</span>
          <span>{set.lastUsedAt ? `used ${timeAgo(set.lastUsedAt)}` : 'not used yet'}</span>
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          {loadNo ? <span className="badge badge-accent">Load {loadNo}</span> : <span className="badge">No load yet</span>}
          <div className="spacer" />
          <button className="btn btn-primary btn-sm" onClick={() => navigate(routes.fill(set.id))}>
            Fill <ArrowRight />
          </button>
        </div>
      </div>
      <Popover anchor={menu.anchor} onClose={menu.close} align="end">
        <MenuItem
          icon={<Pencil />}
          onClick={async () => {
            menu.close();
            const name = await promptDialog({ title: 'Rename set', value: set.name });
            if (name) updateSet(set.id, { name });
          }}
        >
          Rename
        </MenuItem>
        <MenuItem
          icon={<Palette />}
          onClick={() => {
            menu.close();
            setColorOpen(true);
          }}
        >
          Change color
        </MenuItem>
        <MenuItem
          icon={<Copy />}
          onClick={() => {
            menu.close();
            const copy = addSet(set.formId, `${set.name} (copy)`, SET_COLORS[(SET_COLORS.indexOf(set.color) + 1) % SET_COLORS.length], set.id);
            toast(`Duplicated as "${copy.name}"`, 'success');
          }}
        >
          Duplicate
        </MenuItem>
        <div className="menu-sep" />
        <MenuItem
          danger
          icon={<Trash2 />}
          onClick={async () => {
            menu.close();
            if (await confirmDialog({ title: `Delete "${set.name}"?`, message: 'Its saved values and load history are removed. PDFs stay in your library.', confirm: 'Delete', danger: true }))
              deleteSet(set.id);
          }}
        >
          Delete set
        </MenuItem>
      </Popover>
      <Modal open={colorOpen} onClose={() => setColorOpen(false)} title="Set color">
        <ColorPicker
          value={set.color}
          onChange={(c) => {
            updateSet(set.id, { color: c });
            setColorOpen(false);
          }}
        />
      </Modal>
    </div>
  );
}

function Dashboard() {
  const forms = useStore((s) => s.forms);
  const sets = useStore((s) => s.sets);
  const history = useStore((s) => s.history);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const addSet = useStore((s) => s.addSet);
  const restore = useStore((s) => s.restoreHistory);
  const deleteForm = useStore((s) => s.deleteForm);

  const form = forms.find((f) => f.id === settings.activeFormId) ?? forms[0];
  const formSets = useMemo(
    () => sets.filter((s) => s.formId === form?.id).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)),
    [sets, form?.id],
  );
  const recent = history.filter((h) => h.formId === form?.id).slice(0, 8);
  const firstName = (form?.globalValues.driver_name || form?.globalValues.full_name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const newSet = async () => {
    if (!form) return;
    const name = await promptDialog({ title: 'New set', label: 'Name it after the job — employer, truck, customer…', placeholder: 'e.g. Employer B · Truck 7', confirm: 'Create set' });
    if (!name) return;
    const st = addSet(form.id, name);
    navigate(routes.fill(st.id));
  };

  if (!form) return null;
  return (
    <div className="dash">
      {form.isSample && (
        <div className="sample-banner">
          <Sparkles size={18} />
          <div className="grow">
            <strong>You're exploring the sample.</strong> <span className="muted">Edit anything — when you're ready, set up your own forms.</span>
          </div>
          <button className="btn btn-sm" onClick={() => navigate(routes.wizard())}>
            Start my setup
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              if (await confirmDialog({ title: 'Remove the sample?', message: 'The sample form, its sets and PDFs will be deleted.', confirm: 'Remove', danger: true })) deleteForm(form.id);
            }}
          >
            Remove sample
          </button>
        </div>
      )}
      <div className="dash-head">
        <div className="grow">
          <h1>
            {greet}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="muted">Pick a set to fill today's paperwork.</p>
        </div>
        {forms.length > 1 && (
          <select className="select" style={{ width: 'auto' }} value={form.id} onChange={(e) => setSettings({ activeFormId: e.target.value, activeSetId: undefined })}>
            {forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn" onClick={() => navigate(routes.form(form.id))}>
          <ListChecks /> Edit form
        </button>
        <button className="btn" onClick={() => navigate(routes.wizard())}>
          <Plus /> New form
        </button>
      </div>

      <div className="set-grid">
        {formSets.map((s) => (
          <SetCard key={s.id} set={s} />
        ))}
        <button className="set-card add" onClick={newSet}>
          <Plus size={22} />
          <strong>New set</strong>
          <span className="small muted">Another employer, truck or customer</span>
        </button>
      </div>

      <div className="dash-cols">
        <section className="card dash-panel">
          <div className="row panel-head">
            <History size={16} />
            <h3>Recent loads</h3>
          </div>
          {recent.length === 0 ? (
            <p className="small muted" style={{ padding: '6px 2px 4px' }}>
              When you start a <strong>New load</strong>, the previous one is saved here so you can reprint it later.
            </p>
          ) : (
            <ul className="history-list">
              {recent.map((h) => {
                const st = sets.find((s) => s.id === h.setId);
                return (
                  <li key={h.id}>
                    <span className="dot" style={{ background: st?.color ?? '#999' }} />
                    <div className="grow">
                      <div className="truncate" style={{ fontWeight: 550 }}>
                        {h.label}
                      </div>
                      <div className="tiny faint">
                        {st?.name ?? 'Deleted set'} · {timeAgo(h.createdAt)}
                      </div>
                    </div>
                    {st && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          if (
                            await confirmDialog({
                              title: `Reopen "${h.label}"?`,
                              message: `This replaces the current load in "${st.name}". Start a New load first if you want to keep it.`,
                              confirm: 'Reopen',
                            })
                          ) {
                            restore(h.id);
                            navigate(routes.fill(st.id));
                          }
                        }}
                      >
                        <RotateCcw /> Reopen
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card dash-panel tips">
          <div className="row panel-head">
            <Printer size={16} />
            <h3>Daily flow</h3>
          </div>
          <ol>
            <li>
              Open a set and press <strong>New load</strong>.
            </li>
            <li>Type the load details — every PDF updates live.</li>
            <li>
              <strong>Print</strong> or <strong>Save</strong> one PDF or the whole packet.
            </li>
            <li>New paperwork? Drop the PDF on the Fill screen and map it once.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}

export function Home() {
  const hasForms = useStore((s) => s.forms.length > 0);
  return <div className={cx('page-wrap', !hasForms && 'center')}>{hasForms ? <Dashboard /> : <Welcome />}</div>;
}
