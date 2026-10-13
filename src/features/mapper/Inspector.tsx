import { useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Check,
  Circle,
  FileText,
  Image as ImageIcon,
  Keyboard,
  Plus,
  Sparkles,
  SquareDashed,
  Trash2,
  Type,
  Wand2,
  X,
} from 'lucide-react';
import type { AcroField, FieldDef, Form, Mapping, PdfDoc, RenderMode, TextStyle } from '../../lib/types';
import type { TemplateContext } from '../../lib/template';
import { FILTER_HELP, tokensIn } from '../../lib/template';
import { allFields, mappingChecked, mappingText } from '../../lib/values';
import { outputFileName } from '../../lib/pdf/output';
import { Popover, Segmented, Switch, cx, usePopover } from '../../components/ui';
import { FieldPickerButton, FieldPickerList, TYPE_META, guessType, humanize } from './shared';

const DATE_FORMATS = ['MM/DD/YYYY', 'MM/DD/YY', 'M/D/YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MMM D, YYYY', 'MMMM D, YYYY', 'ddd MMM D'];
const TEXT_FORMATS: { v: string; label: string }[] = [
  { v: '', label: 'As typed' },
  { v: 'upper', label: 'UPPERCASE' },
  { v: 'title', label: 'Title Case' },
  { v: 'oneline', label: 'Single line' },
  { v: 'phone', label: 'Phone (555) 123-4567' },
  { v: 'money', label: 'Money 1,250.00' },
  { v: 'number', label: 'Number 38,500' },
];

function parseSingle(source: string): { key: string; filter: string } | null {
  const m = /^\{([a-zA-Z0-9_.]+)((?:\|[^{}|]+)*)\}$/.exec(source.trim());
  return m ? { key: m[1], filter: m[2].replace(/^\|/, '') } : null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="insp-row">
      <span className="insp-label">{label}</span>
      <div className="grow">{children}</div>
    </div>
  );
}

export function MappingInspector({
  form,
  doc,
  mapping,
  acro,
  ctx,
  colors,
  onChange,
  onDelete,
}: {
  form: Form;
  doc: PdfDoc;
  mapping: Mapping;
  acro?: AcroField;
  ctx: TemplateContext;
  colors: Map<string, string>;
  onChange: (m: Mapping) => void;
  onDelete: () => void;
}) {
  const fields = allFields(form);
  const single = parseSingle(mapping.source);
  const [mode, setMode] = useState<'field' | 'custom'>(single || !mapping.source ? 'field' : 'custom');
  const effectiveMode = mode === 'field' && !single && mapping.source ? 'custom' : mode;
  const srcField = single ? fields.find((f) => f.key === single.key) : fields.find((f) => tokensIn(mapping.source).includes(f.key));
  const insertPop = usePopover();
  const helpPop = usePopover();
  const ta = useRef<HTMLTextAreaElement>(null);
  const isAcro = mapping.target.kind === 'acro';
  const acroKind = acro?.kind;
  const style = mapping.style;
  const setStyle = (p: Partial<TextStyle>) => onChange({ ...mapping, style: { ...style, ...p } });

  const pickField = (f: FieldDef) => {
    const render: RenderMode = f.type === 'signature' ? 'image' : acroKind === 'checkbox' ? 'check' : mapping.render === 'image' ? 'text' : mapping.render;
    onChange({ ...mapping, source: `{${f.key}}`, render });
  };
  const setFilter = (filter: string) => single && onChange({ ...mapping, source: `{${single.key}${filter ? '|' + filter : ''}}` });

  const preview =
    mapping.render === 'check' ? (mappingChecked(mapping, ctx) ? '✓ checked' : '☐ not checked') : mapping.render === 'image' ? '' : mappingText(mapping, ctx);

  return (
    <div className="insp">
      <div className="insp-head">
        <div className="insp-target">
          {isAcro ? <FileText size={16} /> : <SquareDashed size={16} />}
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tiny faint">{isAcro ? `PDF ${acroKind ?? 'field'}` : `Text box · page ${(mapping.target as { page: number }).page + 1}`}</div>
            <div className="truncate insp-title">{isAcro ? (mapping.target as { field: string }).field : srcField?.label ?? 'Unassigned box'}</div>
          </div>
          <button className="btn btn-ghost btn-icon btn-sm btn-danger" onClick={onDelete} data-tip={isAcro ? 'Unmap' : 'Delete box'}>
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="insp-sec">
        <div className="row">
          <span className="section-title grow">Fill with</span>
          <Segmented
            value={effectiveMode}
            onChange={(m) => setMode(m)}
            options={[
              { value: 'field', label: 'Field' },
              { value: 'custom', label: 'Combine' },
            ]}
          />
        </div>
        {effectiveMode === 'field' ? (
          <>
            <FieldPickerButton form={form} value={single?.key} colors={colors} onPick={pickField} />
            {single && srcField?.type === 'date' && (
              <Row label="Format">
                <select className="select select-sm" value={single.filter.replace(/^date:/, '') || 'MM/DD/YYYY'} onChange={(e) => setFilter(e.target.value === 'MM/DD/YYYY' ? '' : `date:${e.target.value}`)}>
                  {DATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </Row>
            )}
            {single && srcField && !['date', 'signature', 'checkbox'].includes(srcField.type) && mapping.render === 'text' && (
              <Row label="Format">
                <select className="select select-sm" value={TEXT_FORMATS.some((t) => t.v === single.filter) ? single.filter : ''} onChange={(e) => setFilter(e.target.value)}>
                  {TEXT_FORMATS.map((t) => (
                    <option key={t.v} value={t.v}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </Row>
            )}
          </>
        ) : (
          <>
            <textarea
              ref={ta}
              className="textarea mono"
              rows={3}
              value={mapping.source}
              placeholder="{shipper_name}, {shipper_city}"
              onChange={(e) => onChange({ ...mapping, source: e.target.value })}
            />
            <div className="row">
              <button className="btn btn-sm" onClick={(e) => insertPop.toggle(e.currentTarget)}>
                <Plus /> Insert field
              </button>
              <button className="btn btn-ghost btn-sm" onClick={(e) => helpPop.toggle(e.currentTarget)}>
                <Wand2 /> Formats
              </button>
            </div>
            <Popover anchor={insertPop.anchor} onClose={insertPop.close} width={290}>
              <FieldPickerList
                form={form}
                colors={colors}
                onPick={(f) => {
                  insertPop.close();
                  const el = ta.current;
                  const token = `{${f.key}}`;
                  const s = el?.selectionStart ?? mapping.source.length;
                  const e2 = el?.selectionEnd ?? s;
                  onChange({ ...mapping, source: mapping.source.slice(0, s) + token + mapping.source.slice(e2) });
                }}
              />
            </Popover>
            <Popover anchor={helpPop.anchor} onClose={helpPop.close} width={320}>
              <div className="menu-label">Add after a field name with |</div>
              {FILTER_HELP.map((h) => (
                <div key={h.name} className="filter-help">
                  <code>{h.example}</code>
                  <span className="tiny muted">{h.desc}</span>
                </div>
              ))}
              <div className="filter-help">
                <code>{'{today}'}</code>
                <span className="tiny muted">Today's date. Type \n for a new line.</span>
              </div>
            </Popover>
          </>
        )}
        {preview && (
          <div className="insp-preview">
            <span className="tiny faint">Shows</span>
            <div className="insp-preview-val">{preview}</div>
          </div>
        )}
      </div>

      <div className="insp-sec">
        <span className="section-title">Draw as</span>
        <Segmented
          block
          value={mapping.render}
          onChange={(r) => onChange({ ...mapping, render: r, check: r === 'check' ? mapping.check ?? { op: 'truthy' } : mapping.check })}
          options={[
            { value: 'text', label: 'Text', icon: <Type /> },
            { value: 'check', label: 'Check', icon: <Check /> },
            { value: 'image', label: 'Image', icon: <ImageIcon /> },
          ]}
        />
        {mapping.render === 'check' && (
          <>
            <Row label="Check when">
              <select
                className="select select-sm"
                value={mapping.check?.op ?? 'truthy'}
                onChange={(e) => onChange({ ...mapping, check: { ...mapping.check, op: e.target.value as 'truthy' } })}
              >
                <option value="truthy">is checked / filled</option>
                <option value="equals">equals</option>
                <option value="notEquals">doesn't equal</option>
                <option value="contains">contains</option>
              </select>
            </Row>
            {mapping.check && mapping.check.op !== 'truthy' && (
              <Row label="Value">
                {srcField?.options?.length ? (
                  <select className="select select-sm" value={mapping.check.value ?? ''} onChange={(e) => onChange({ ...mapping, check: { ...mapping.check!, value: e.target.value } })}>
                    <option value="">Choose…</option>
                    {srcField.options.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input className="input input-sm" value={mapping.check.value ?? ''} onChange={(e) => onChange({ ...mapping, check: { ...mapping.check!, value: e.target.value } })} />
                )}
              </Row>
            )}
            {(!isAcro || acroKind !== 'checkbox') && (
              <Row label="Mark">
                <Segmented
                  value={style.checkMark ?? 'x'}
                  onChange={(v) => setStyle({ checkMark: v })}
                  options={[
                    { value: 'x', label: <X size={14} /> },
                    { value: 'check', label: <Check size={14} /> },
                    { value: 'dot', label: <Circle size={12} fill="currentColor" /> },
                  ]}
                />
              </Row>
            )}
          </>
        )}
        {mapping.render === 'image' && <p className="tiny muted">Fits inside the box, keeping its shape. Use it for signatures or initials.</p>}
      </div>

      {mapping.render !== 'check' && (
        <div className="insp-sec">
          <span className="section-title">Style</span>
          {mapping.render === 'text' && (
            <>
              <Row label="Font">
                <select className="select select-sm" value={style.font} onChange={(e) => setStyle({ font: e.target.value as TextStyle['font'] })}>
                  <option value="helvetica">Helvetica</option>
                  <option value="helvetica-bold">Helvetica Bold</option>
                  <option value="times">Times</option>
                  <option value="courier">Courier</option>
                </select>
              </Row>
              <Row label="Size">
                <div className="row">
                  <label className="row small">
                    <Switch checked={!style.size} onChange={(v) => setStyle({ size: v ? 0 : 10 })} /> Auto
                  </label>
                  {!!style.size && (
                    <input className="input input-sm" type="number" min={4} max={72} step={0.5} value={style.size} onChange={(e) => setStyle({ size: Math.max(4, +e.target.value || 10) })} style={{ width: 70 }} />
                  )}
                </div>
              </Row>
            </>
          )}
          <Row label="Align">
            <Segmented
              value={style.align}
              onChange={(v) => setStyle({ align: v })}
              options={[
                { value: 'left', label: <AlignLeft size={14} /> },
                { value: 'center', label: <AlignCenter size={14} /> },
                { value: 'right', label: <AlignRight size={14} /> },
              ]}
            />
          </Row>
          {mapping.render === 'text' && (
            <>
              {!isAcro && (
                <Row label="Color">
                  <div className="row">
                    {['#111111', '#1d3fae', '#b42318'].map((c) => (
                      <button key={c} className={cx('ink-swatch', style.color === c && 'on')} style={{ background: c }} onClick={() => setStyle({ color: c })} aria-label={c} />
                    ))}
                    <input type="color" className="color-input" value={style.color} onChange={(e) => setStyle({ color: e.target.value })} />
                  </div>
                </Row>
              )}
              <Row label="Lines">
                <label className="row small">
                  <Switch checked={style.multiline} onChange={(v) => setStyle({ multiline: v })} /> Wrap onto several lines
                </label>
              </Row>
              <Row label="Case">
                <label className="row small">
                  <Switch checked={!!style.uppercase} onChange={(v) => setStyle({ uppercase: v })} /> ALL CAPS
                </label>
              </Row>
            </>
          )}
        </div>
      )}

      {mapping.target.kind === 'overlay' && (
        <div className="insp-sec">
          <span className="section-title">Position (points)</span>
          <div className="xywh">
            {(['X', 'Y', 'W', 'H'] as const).map((l, i) => (
              <label key={l}>
                <span>{l}</span>
                <input
                  className="input input-sm"
                  type="number"
                  step={0.5}
                  value={Math.round((mapping.target as { rect: number[] }).rect[i] * 10) / 10}
                  onChange={(e) => {
                    const t = mapping.target as Extract<Mapping['target'], { kind: 'overlay' }>;
                    const rect = [...t.rect] as typeof t.rect;
                    rect[i] = i >= 2 ? Math.max(2, +e.target.value || 0) : +e.target.value || 0;
                    onChange({ ...mapping, target: { ...t, rect } });
                  }}
                />
              </label>
            ))}
          </div>
          {doc.pages.length > 1 && (
            <Row label="Page">
              <select
                className="select select-sm"
                value={(mapping.target as { page: number }).page}
                onChange={(e) => onChange({ ...mapping, target: { ...(mapping.target as Extract<Mapping['target'], { kind: 'overlay' }>), page: +e.target.value } })}
              >
                {doc.pages.map((_, i) => (
                  <option key={i} value={i}>
                    Page {i + 1}
                  </option>
                ))}
              </select>
            </Row>
          )}
          <p className="tiny faint">Drag to move · arrows nudge · Ctrl+D duplicates one row down</p>
        </div>
      )}
    </div>
  );
}

export function AcroInspector({
  form,
  acro,
  colors,
  onPick,
  onCreate,
  onFixedText,
}: {
  form: Form;
  acro: AcroField;
  colors: Map<string, string>;
  onPick: (f: FieldDef) => void;
  onCreate: (seed: { label: string; type: FieldDef['type']; options?: string[] }) => void;
  onFixedText: () => void;
}) {
  const type = guessType(acro);
  return (
    <div className="insp">
      <div className="insp-head">
        <div className="insp-target">
          <FileText size={16} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="tiny faint">Unmapped PDF {acro.kind}</div>
            <div className="truncate insp-title">{acro.name}</div>
          </div>
        </div>
        {acro.label && <p className="tiny muted" style={{ marginTop: 6 }}>“{acro.label}”</p>}
        {acro.options && (
          <div className="opt-list">
            {acro.options.slice(0, 8).map((o) => (
              <span key={o} className="badge">
                {o}
              </span>
            ))}
            {acro.options.length > 8 && <span className="badge">+{acro.options.length - 8}</span>}
          </div>
        )}
      </div>
      <div className="insp-sec">
        <span className="section-title">Fill it with</span>
        <div className="inline-picker">
          <FieldPickerList form={form} colors={colors} onPick={onPick} />
        </div>
      </div>
      <div className="insp-sec">
        <button className="btn btn-soft btn-block" onClick={() => onCreate({ label: humanize(acro.label || acro.name), type, options: acro.options })}>
          <Sparkles /> New field “{humanize(acro.label || acro.name).slice(0, 22)}”
        </button>
        <button className="btn btn-ghost btn-block btn-sm" onClick={onFixedText}>
          <Type /> Fixed text instead
        </button>
        <p className="tiny faint">
          New field type: <strong>{TYPE_META[type].label}</strong>
        </p>
      </div>
    </div>
  );
}

export function DocInspector({
  form,
  doc,
  ctx,
  onRename,
  onOutputName,
  onAutoMap,
  onSelectAcro,
}: {
  form: Form;
  doc: PdfDoc;
  ctx: TemplateContext;
  onRename: (n: string) => void;
  onOutputName: (n: string) => void;
  onAutoMap: () => void;
  onSelectAcro: (name: string) => void;
}) {
  const mappedAcro = new Set(doc.mappings.flatMap((m) => (m.target.kind === 'acro' ? [m.target.field] : [])));
  const unmapped = doc.acroFields.filter((f) => !mappedAcro.has(f.name));
  const overlays = doc.mappings.filter((m) => m.target.kind === 'overlay').length;
  const fname = outputFileName(doc, form, ctx.values, undefined);
  return (
    <div className="insp">
      <div className="insp-sec">
        <span className="section-title">Document</span>
        <div className="field">
          <label>Name</label>
          <input className="input input-sm" value={doc.name} onChange={(e) => onRename(e.target.value)} />
        </div>
        <div className="field">
          <label>Saved file name</label>
          <input className="input input-sm mono" value={doc.outputName} onChange={(e) => onOutputName(e.target.value)} />
          <div className="field-help truncate">→ {fname}</div>
        </div>
      </div>
      <div className="insp-sec">
        <span className="section-title">Mapping</span>
        <div className="stat-grid">
          <div>
            <strong>{doc.acroFields.length}</strong>
            <span>PDF fields</span>
          </div>
          <div>
            <strong>{doc.acroFields.length - unmapped.length}</strong>
            <span>mapped</span>
          </div>
          <div>
            <strong>{overlays}</strong>
            <span>text boxes</span>
          </div>
        </div>
        {doc.acroFields.length > 0 && (
          <button className="btn btn-soft btn-block" onClick={onAutoMap} disabled={!unmapped.length}>
            <Wand2 /> Auto-map by name
          </button>
        )}
        {doc.acroFields.length === 0 && (
          <p className="small muted">
            This PDF has no fillable fields. Drag a field from the left onto the page, or press <span className="kbd">T</span> and draw a box.
          </p>
        )}
        {unmapped.length > 0 && (
          <details className="unmapped">
            <summary className="small">{unmapped.length} unmapped PDF fields</summary>
            <div className="unmapped-list">
              {unmapped.map((f) => (
                <button key={f.name} className="menu-item" onClick={() => onSelectAcro(f.name)}>
                  <span className="truncate mono">{f.name}</span>
                  <span className="hint">{f.kind}</span>
                </button>
              ))}
            </div>
          </details>
        )}
      </div>
      <div className="insp-sec">
        <span className="section-title row">
          <Keyboard size={13} /> Shortcuts
        </span>
        <ul className="shortcuts">
          <li>
            <span>Draw a text box</span>
            <span className="kbd">T</span>
          </li>
          <li>
            <span>Select / move</span>
            <span className="kbd">V</span>
          </li>
          <li>
            <span>Nudge</span>
            <span>
              <span className="kbd">←</span> <span className="kbd">Shift</span>
            </span>
          </li>
          <li>
            <span>Duplicate down</span>
            <span className="kbd">Ctrl D</span>
          </li>
          <li>
            <span>Undo / redo</span>
            <span className="kbd">Ctrl Z / Y</span>
          </li>
          <li>
            <span>Delete</span>
            <span className="kbd">Del</span>
          </li>
          <li>
            <span>Zoom</span>
            <span className="kbd">Ctrl + wheel</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

