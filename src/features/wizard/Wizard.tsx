import { useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, Clock, FileText, LayoutTemplate, Package, Thermometer, Truck, User, Workflow } from 'lucide-react';
import { useStore } from '../../lib/store';
import { navigate, routes } from '../../lib/router';
import { TRUCKING_BLOCKS, buildBlankForm, buildTruckingForm } from '../../lib/starter';
import { SET_COLORS, type PdfDoc } from '../../lib/types';
import { rawValues } from '../../lib/values';
import { importPdf } from '../../lib/importPdf';
import { ColorPicker, Dropzone, Spinner, cx, toast } from '../../components/ui';
import { Thumb } from '../../components/PdfView';
import { DataForm } from '../fill/DataForm';

const ICONS: Record<string, React.ReactNode> = {
  user: <User />,
  building: <Building2 />,
  truck: <Truck />,
  package: <Package />,
  thermometer: <Thermometer />,
  clock: <Clock />,
};

const STEPS = ['Your form', 'About you', 'First set', 'Your PDFs', 'Ready'];

export function Wizard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('My paperwork');
  const [template, setTemplate] = useState<'trucking' | 'blank'>('trucking');
  const [blocks, setBlocks] = useState<string[]>(TRUCKING_BLOCKS.filter((b) => b.recommended).map((b) => b.id));
  const [formId, setFormId] = useState<string | null>(null);
  const [setName_, setSetName] = useState('');
  const [color, setColor] = useState(SET_COLORS[0]);
  const [setId, setSetId] = useState<string | null>(null);
  const [imported, setImported] = useState<{ doc: PdfDoc; auto: number; fillable: number }[]>([]);
  const [busy, setBusy] = useState(0);

  const form = useStore((s) => s.forms.find((f) => f.id === formId));
  const set = useStore((s) => s.sets.find((x) => x.id === setId));
  const { addForm, addSet, updateSet, setValue, addDoc, updateForm } = useStore.getState();

  const next = () => {
    if (step === 0) {
      if (!formId) {
        const f = template === 'trucking' ? buildTruckingForm(name.trim() || 'My paperwork', blocks) : buildBlankForm(name.trim() || 'My paperwork');
        addForm(f);
        setFormId(f.id);
      } else if (form && form.name !== name) {
        updateForm(form.id, (f) => ({ ...f, name }));
      }
    }
    if (step === 2 && form) {
      const n = setName_.trim() || 'My first set';
      if (!setId) setSetId(addSet(form.id, n, color).id);
      else updateSet(setId, { name: n, color });
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const onFiles = async (files: File[]) => {
    if (!form || !set) return;
    for (const file of files) {
      setBusy((n) => n + 1);
      try {
        const r = await importPdf(file, useStore.getState().forms.find((f) => f.id === form.id)!);
        addDoc(r.doc, [set.id]);
        setImported((x) => [...x, { doc: r.doc, auto: r.autoMapped, fillable: r.fillable }]);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), 'error');
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const values = form ? rawValues(form, set) : {};

  return (
    <div className="wizard">
      <div className="wiz-steps">
        {STEPS.map((s, i) => (
          <div key={s} className={cx('wiz-step', i === step && 'on', i < step && 'done')}>
            <span className="wiz-num">{i < step ? <Check size={13} /> : i + 1}</span>
            <span className="hide-sm">{s}</span>
          </div>
        ))}
      </div>

      <div className="wiz-card card" key={step}>
        {step === 0 && (
          <>
            <h2>Let's build your form</h2>
            <p className="muted">This is the set of info you'll reuse across all your PDFs. You can add, remove and rearrange fields any time.</p>
            <div className="field" style={{ marginTop: 18 }}>
              <label>Form name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus disabled={!!formId} />
            </div>
            <div className="tmpl-grid">
              <button className={cx('tmpl', template === 'trucking' && 'on')} onClick={() => setTemplate('trucking')} disabled={!!formId}>
                <Truck />
                <div>
                  <strong>Trucking starter</strong>
                  <span>Driver, carrier, equipment and load fields — already named so most BOLs auto-map.</span>
                </div>
                <span className="badge badge-accent">Recommended</span>
              </button>
              <button className={cx('tmpl', template === 'blank' && 'on')} onClick={() => setTemplate('blank')} disabled={!!formId}>
                <LayoutTemplate />
                <div>
                  <strong>Start simple</strong>
                  <span>Name, signature and a date. Add your own fields as you map PDFs.</span>
                </div>
              </button>
            </div>
            {template === 'trucking' && !formId && (
              <>
                <div className="section-title" style={{ margin: '18px 0 8px' }}>
                  Include
                </div>
                <div className="block-grid">
                  {TRUCKING_BLOCKS.map((b) => {
                    const on = blocks.includes(b.id);
                    return (
                      <button key={b.id} className={cx('block-opt', on && 'on')} onClick={() => setBlocks((x) => (on ? x.filter((y) => y !== b.id) : [...x, b.id]))}>
                        <span className="block-icon">{ICONS[b.icon]}</span>
                        <div className="grow">
                          <strong>{b.title}</strong>
                          <span>{b.description}</span>
                        </div>
                        <span className={cx('block-check', on && 'on')}>{on && <Check size={13} />}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {step === 1 && form && (
          <>
            <h2>About you</h2>
            <p className="muted">These stay the same on every form, for every employer. Skip anything you'd rather fill later.</p>
            <div style={{ marginTop: 16 }}>
              <DataForm form={form} values={values} onChange={(k, v) => setValue(form.id, undefined, k, v)} scopes={['global']} />
            </div>
          </>
        )}

        {step === 2 && form && (
          <>
            <h2>Create your first set</h2>
            <p className="muted">
              A set is one job setup — an employer, a truck, a regular customer — with its own info and its own PDFs. You can add more sets later, like <em>Employer B · Truck 7</em>.
            </p>
            <div className="field" style={{ marginTop: 18 }}>
              <label>Set name</label>
              <input className="input" value={setName_} onChange={(e) => setSetName(e.target.value)} placeholder="e.g. Employer A · Truck 12" autoFocus />
            </div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Color</label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </>
        )}

        {step === 3 && form && set && (
          <>
            <h2>Add the PDFs for “{set.name}”</h2>
            <p className="muted">Bills of lading, rate confirmations, trip sheets, carrier packets… Fillable PDFs get auto-matched; flat ones get text boxes you place once.</p>
            <div style={{ marginTop: 16 }}>
              <Dropzone onFiles={onFiles} title={busy ? 'Reading PDFs…' : 'Drop PDFs here'} />
            </div>
            {(imported.length > 0 || busy > 0) && (
              <div className="wiz-docs">
                {imported.map(({ doc, auto, fillable }) => (
                  <div key={doc.id} className="wiz-doc">
                    <Thumb doc={doc} width={44} />
                    <div className="grow">
                      <strong className="truncate">{doc.name}</strong>
                      <span className="small muted">
                        {fillable ? `${fillable} fillable fields · ${auto} matched automatically` : 'No fillable fields — you’ll place text boxes'}
                      </span>
                    </div>
                    <CheckCircle2 className="ok-text" size={18} />
                  </div>
                ))}
                {busy > 0 && (
                  <div className="wiz-doc">
                    <Spinner /> <span className="small muted">Reading…</span>
                  </div>
                )}
              </div>
            )}
            <p className="tiny faint" style={{ marginTop: 12 }}>
              No PDFs handy? Skip — you can drop them on the Fill screen any time.
            </p>
          </>
        )}

        {step === 4 && form && set && (
          <div className="wiz-done">
            <div className="done-badge">
              <CheckCircle2 size={30} />
            </div>
            <h2>You're set up</h2>
            <p className="muted">
              {imported.length
                ? `“${set.name}” has ${imported.length} PDF${imported.length > 1 ? 's' : ''}. Check where each field lands, then fill your first load.`
                : `Add your PDFs on the Fill screen, then map them once.`}
            </p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
              {imported[0] && (
                <button className="btn btn-lg" onClick={() => navigate(routes.map(imported[0].doc.id, set.id))}>
                  <Workflow /> Review mapping
                </button>
              )}
              <button className="btn btn-primary btn-lg" onClick={() => navigate(routes.fill(set.id))}>
                <FileText /> Start filling
              </button>
            </div>
          </div>
        )}

        {step < 4 && (
          <div className="wiz-foot">
            {step > 0 ? (
              <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                <ArrowLeft /> Back
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => navigate(routes.home())}>
                Cancel
              </button>
            )}
            <div className="spacer" />
            {(step === 1 || step === 3) && (
              <button className="btn btn-ghost" onClick={next}>
                Skip
              </button>
            )}
            <button className="btn btn-primary" onClick={next} disabled={(step === 0 && template === 'trucking' && !blocks.length && !formId) || busy > 0}>
              Continue <ArrowRight />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
