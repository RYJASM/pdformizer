import { memo, useMemo, useState } from 'react';
import { Globe2, Layers, PenLine, Truck, X } from 'lucide-react';
import type { FieldDef, Form, Scope, Values } from '../../lib/types';
import { sectionVisible, visibleKeys } from '../../lib/values';
import { isTruthy } from '../../lib/util';
import { SignatureDialog } from '../signature/SignatureDialog';
import { cx } from '../../components/ui';

export const SCOPE_META: Record<Scope, { label: string; short: string; icon: React.ReactNode; desc: string }> = {
  global: { label: 'Everywhere', short: 'All sets', icon: <Globe2 />, desc: 'Same value in every set (your name, CDL, signature)' },
  set: { label: 'This set', short: 'Set', icon: <Layers />, desc: 'Each set keeps its own value (employer, truck)' },
  load: { label: 'Each load', short: 'Load', icon: <Truck />, desc: 'Changes every trip; cleared by New load' },
};

export function FieldInput({
  field,
  value,
  onChange,
  id,
}: {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  id: string;
}) {
  const [sigOpen, setSigOpen] = useState(false);
  switch (field.type) {
    case 'textarea':
      return <textarea id={id} className="textarea" rows={2} value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return <input id={id} className="input" inputMode="decimal" value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input id={id} className="input" type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'phone':
      return <input id={id} className="input" type="tel" value={value} placeholder={field.placeholder ?? '(555) 555-5555'} onChange={(e) => onChange(e.target.value)} />;
    case 'email':
      return <input id={id} className="input" type="email" value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{field.placeholder ?? 'Choose…'}</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          {value && !field.options?.includes(value) && <option value={value}>{value}</option>}
        </select>
      );
    case 'radio':
      return (
        <div className="radio-pills" role="radiogroup" id={id}>
          {field.options?.map((o) => (
            <button type="button" key={o} role="radio" aria-checked={value === o} className={cx('pill', value === o && 'on')} onClick={() => onChange(value === o ? '' : o)}>
              {o}
            </button>
          ))}
        </div>
      );
    case 'checkbox':
      return (
        <label className="check check-box-field">
          <input id={id} type="checkbox" checked={isTruthy(value)} onChange={(e) => onChange(e.target.checked ? 'true' : '')} />
          <span>{field.placeholder || 'Yes'}</span>
        </label>
      );
    case 'signature':
      return (
        <>
          <div className={cx('sig-field', value && 'has')} onClick={() => setSigOpen(true)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setSigOpen(true)}>
            {value ? (
              <>
                <img src={value} alt="Signature" />
                <button
                  className="btn btn-ghost btn-icon btn-sm sig-clear"
                  aria-label="Remove signature"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange('');
                  }}
                >
                  <X />
                </button>
              </>
            ) : (
              <span className="row muted">
                <PenLine size={16} /> Add signature — draw, photo or type
              </span>
            )}
          </div>
          <SignatureDialog open={sigOpen} onClose={() => setSigOpen(false)} onSave={(url) => onChange(url)} />
        </>
      );
    default:
      return <input id={id} className="input" value={value} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

const FieldRow = memo(function FieldRow({
  field,
  value,
  onChange,
  showScope,
  missing,
}: {
  field: FieldDef;
  value: string;
  onChange: (key: string, v: string) => void;
  showScope: boolean;
  missing: boolean;
}) {
  const id = `fld-${field.key}`;
  return (
    <div className={cx('field', `w-${field.width ?? 'full'}`, missing && 'missing')} data-field={field.key}>
      <label htmlFor={id}>
        <span className="truncate">{field.label}</span>
        {field.required && <span className="req">*</span>}
        {showScope && (
          <span className={cx('scope-tag', `scope-${field.scope}`)} data-tip={SCOPE_META[field.scope].desc}>
            {SCOPE_META[field.scope].icon}
          </span>
        )}
      </label>
      <FieldInput field={field} value={value} id={id} onChange={(v) => onChange(field.key, v)} />
      {field.help && <div className="field-help">{field.help}</div>}
    </div>
  );
});

export function DataForm({
  form,
  values,
  onChange,
  scopes,
  showScope = false,
  highlightMissing = false,
  usedKeys,
}: {
  form: Form;
  values: Values;
  onChange: (key: string, v: string) => void;
  scopes?: Scope[];
  showScope?: boolean;
  highlightMissing?: boolean;
  usedKeys?: Set<string>;
}) {
  const visible = useMemo(() => visibleKeys(form, values), [form, values]);
  const sections = form.sections
    .map((s) => ({ s, fields: s.fields.filter((f) => visible.has(f.key) && (!scopes || scopes.includes(f.scope))) }))
    .filter(({ s, fields }) => fields.length > 0 && sectionVisible(s, values, visible));

  if (!sections.length) {
    return <p className="muted small" style={{ padding: '24px 4px' }}>No fields here.</p>;
  }
  return (
    <div className="data-form">
      {sections.map(({ s, fields }) => (
        <section key={s.id} className="df-section">
          <div className="df-section-head">
            <h3>{s.title}</h3>
            {s.description && <p className="small faint">{s.description}</p>}
          </div>
          <div className="df-grid">
            {fields.map((f) => (
              <FieldRow
                key={f.id}
                field={f}
                value={values[f.key] ?? ''}
                onChange={onChange}
                showScope={showScope}
                missing={highlightMissing && !(values[f.key] ?? '').trim() && (!!f.required || !!usedKeys?.has(f.key))}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
