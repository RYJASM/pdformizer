import { useMemo, useState } from 'react';
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Hash,
  List,
  Mail,
  PenLine,
  Phone,
  Search,
  Text,
  TextCursorInput,
} from 'lucide-react';
import type { AcroField, FieldDef, FieldType, Form, Scope } from '../../lib/types';
import { allFields } from '../../lib/values';
import { slugify, uniqueKey } from '../../lib/util';
import { newField } from '../../lib/starter';
import { useStore } from '../../lib/store';
import { Modal, Popover, Segmented, cx, usePopover } from '../../components/ui';
import { SCOPE_META } from '../fill/DataForm';

export const SECTION_PALETTE = ['#5b5bd6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444', '#64748b'];

export function useFieldColors(form: Form | undefined) {
  return useMemo(() => {
    const m = new Map<string, string>();
    form?.sections.forEach((s, i) => s.fields.forEach((f) => m.set(f.key, SECTION_PALETTE[i % SECTION_PALETTE.length])));
    return m;
  }, [form]);
}

export const TYPE_META: Record<FieldType, { label: string; icon: React.ReactNode }> = {
  text: { label: 'Text', icon: <TextCursorInput /> },
  textarea: { label: 'Long text', icon: <Text /> },
  number: { label: 'Number', icon: <Hash /> },
  date: { label: 'Date', icon: <Calendar /> },
  phone: { label: 'Phone', icon: <Phone /> },
  email: { label: 'Email', icon: <Mail /> },
  select: { label: 'Dropdown', icon: <List /> },
  radio: { label: 'Choice', icon: <CircleDot /> },
  checkbox: { label: 'Checkbox', icon: <CheckSquare /> },
  signature: { label: 'Signature', icon: <PenLine /> },
};

export function FieldTypeIcon({ type }: { type: FieldType }) {
  return <span className="ftype-icon">{TYPE_META[type].icon}</span>;
}

/** Searchable field list in a popover. */
export function FieldPickerList({ form, onPick, colors, filter }: { form: Form; onPick: (f: FieldDef) => void; colors: Map<string, string>; filter?: (f: FieldDef) => boolean }) {
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  return (
    <div className="picker">
      <div className="input-group">
        <Search />
        <input className="input input-sm" placeholder="Find a field…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div className="picker-list">
        {form.sections.map((s) => {
          const fields = s.fields.filter((f) => (!filter || filter(f)) && (!ql || f.label.toLowerCase().includes(ql) || f.key.includes(ql)));
          if (!fields.length) return null;
          return (
            <div key={s.id}>
              <div className="menu-label">{s.title}</div>
              {fields.map((f) => (
                <button key={f.id} className="menu-item" onClick={() => onPick(f)}>
                  <span className="dot" style={{ background: colors.get(f.key) }} />
                  <span className="grow truncate">{f.label}</span>
                  <span className="hint">{TYPE_META[f.type].icon}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FieldPickerButton({
  form,
  value,
  onPick,
  colors,
  placeholder = 'Choose a field…',
  filter,
}: {
  form: Form;
  value?: string;
  onPick: (f: FieldDef) => void;
  colors: Map<string, string>;
  placeholder?: string;
  filter?: (f: FieldDef) => boolean;
}) {
  const pop = usePopover();
  const f = value ? allFields(form).find((x) => x.key === value) : undefined;
  return (
    <>
      <button className={cx('picker-btn', !f && 'empty')} onClick={(e) => pop.toggle(e.currentTarget)}>
        {f ? <span className="dot" style={{ background: colors.get(f.key) }} /> : null}
        <span className="grow truncate">{f ? f.label : placeholder}</span>
        <ChevronDown size={15} />
      </button>
      <Popover anchor={pop.anchor} onClose={pop.close} width={290}>
        <FieldPickerList
          form={form}
          colors={colors}
          filter={filter}
          onPick={(x) => {
            pop.close();
            onPick(x);
          }}
        />
      </Popover>
    </>
  );
}

export function humanize(name: string): string {
  return (
    name
      .replace(/_af_date$/i, ' date')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_.]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase()) || 'New field'
  );
}

export function guessType(acro?: AcroField): FieldType {
  if (!acro) return 'text';
  const n = acro.name.toLowerCase();
  if (acro.kind === 'checkbox') return 'checkbox';
  if (acro.kind === 'signature' || /signature|sign\b/.test(n)) return 'signature';
  if (acro.kind === 'dropdown' || acro.kind === 'list' || acro.kind === 'radio') return 'select';
  if (/date|_af_date/.test(n)) return 'date';
  if (/phone|tel|fax/.test(n)) return 'phone';
  if (/e-?mail/.test(n)) return 'email';
  if (/weight|qty|quantity|pieces|count|amount|total/.test(n)) return 'number';
  if (acro.multiline) return 'textarea';
  return 'text';
}

/** Create a field in the form; resolves with the new field. */
export function NewFieldDialog({
  open,
  onClose,
  form,
  seed,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  form: Form;
  seed?: { label?: string; type?: FieldType; options?: string[] };
  onCreated: (f: FieldDef) => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [scope, setScope] = useState<Scope>('load');
  const [sectionId, setSectionId] = useState('');
  const updateSections = useStore((s) => s.updateSections);

  const [lastSeed, setLastSeed] = useState<typeof seed | null>(null);
  if (open && seed !== lastSeed) {
    setLastSeed(seed);
    setLabel(seed?.label ?? '');
    setType(seed?.type ?? 'text');
    setScope(seed?.type === 'signature' ? 'global' : 'load');
    setSectionId(form.sections[form.sections.length - 1]?.id ?? '');
  }

  const create = () => {
    const taken = new Set(allFields(form).map((f) => f.key));
    const key = uniqueKey(slugify(label), taken);
    const f = newField(type, label.trim(), key, scope);
    if (seed?.options?.length && (type === 'select' || type === 'radio')) f.options = seed.options;
    updateSections(form.id, (sections) => {
      if (!sections.length) return [{ id: 's_' + key, title: 'Fields', fields: [f] }];
      const target = sections.find((s) => s.id === sectionId) ?? sections[sections.length - 1];
      return sections.map((s) => (s.id === target.id ? { ...s, fields: [...s.fields, f] } : s));
    });
    onCreated(f);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New field"
      description="Adds a field to your form. Every set and PDF can use it."
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!label.trim()} onClick={create}>
            Create field
          </button>
        </>
      }
    >
      <form
        className="col"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) create();
        }}
      >
        <div className="field">
          <label>Label</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Trailer seal #" autoFocus />
        </div>
        <div className="field">
          <label>Type</label>
          <div className="type-grid">
            {(Object.keys(TYPE_META) as FieldType[]).map((t) => (
              <button type="button" key={t} className={cx('type-opt', t === type && 'on')} onClick={() => setType(t)}>
                {TYPE_META[t].icon}
                {TYPE_META[t].label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Value is kept</label>
          <Segmented
            block
            value={scope}
            onChange={setScope}
            options={(Object.keys(SCOPE_META) as Scope[]).map((s) => ({ value: s, label: SCOPE_META[s].label, icon: SCOPE_META[s].icon }))}
          />
          <div className="field-help">{SCOPE_META[scope].desc}</div>
        </div>
        {form.sections.length > 1 && (
          <div className="field">
            <label>Section</label>
            <select className="select" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              {form.sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
        )}
      </form>
    </Modal>
  );
}
