import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowLeft, Copy, Eye, FolderPlus, GitBranch, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useForm, useStore } from '../../lib/store';
import { navigate, routes } from '../../lib/router';
import type { Condition, ConditionOp, FieldDef, FieldType, Form, Scope, Section, Values } from '../../lib/types';
import { allFields, sampleValues } from '../../lib/values';
import { tokensIn } from '../../lib/template';
import { slugify, uid, uniqueKey } from '../../lib/util';
import { newField, newSection } from '../../lib/starter';
import { Popover, MenuItem, Segmented, Switch, confirmDialog, cx, toast, usePopover } from '../../components/ui';
import { DataForm, SCOPE_META } from '../fill/DataForm';
import { TYPE_META, FieldTypeIcon } from '../mapper/shared';

type Item = { kind: 'section'; id: string; section: Section } | { kind: 'field'; id: string; field: FieldDef };

function flatten(sections: Section[], collapsed: boolean): Item[] {
  const out: Item[] = [];
  for (const s of sections) {
    out.push({ kind: 'section', id: s.id, section: s });
    if (!collapsed) for (const f of s.fields) out.push({ kind: 'field', id: f.id, field: f });
  }
  return out;
}

function rebuild(items: Item[], sections: Section[]): Section[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const out: Section[] = [];
  const orphan: FieldDef[] = [];
  for (const it of items) {
    if (it.kind === 'section') out.push({ ...byId.get(it.id)!, fields: [] });
    else if (out.length) out[out.length - 1].fields.push(it.field);
    else orphan.push(it.field);
  }
  if (orphan.length && out.length) out[0].fields.unshift(...orphan);
  return out;
}

function OutlineRow({ item, selected, onSelect, onAddField }: { item: Item; selected: boolean; onSelect: () => void; onAddField?: (el: HTMLElement) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  if (item.kind === 'section') {
    return (
      <div ref={setNodeRef} style={style} className={cx('ol-section', selected && 'selected', isDragging && 'dragging')} onClick={onSelect}>
        <span className="grip" {...attributes} {...listeners}>
          <GripVertical size={14} />
        </span>
        <span className="grow truncate">{item.section.title}</span>
        {item.section.showIf && <GitBranch size={13} className="faint" />}
        <span className="tiny faint">{item.section.fields.length}</span>
        <button
          className="btn btn-ghost btn-icon btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            onAddField?.(e.currentTarget);
          }}
          data-tip="Add field"
        >
          <Plus />
        </button>
      </div>
    );
  }
  const f = item.field;
  return (
    <div ref={setNodeRef} style={style} className={cx('ol-field', selected && 'selected', isDragging && 'dragging')} onClick={onSelect}>
      <span className="grip" {...attributes} {...listeners}>
        <GripVertical size={14} />
      </span>
      <FieldTypeIcon type={f.type} />
      <span className="grow truncate">
        {f.label}
        {f.required && <span className="req"> *</span>}
      </span>
      {f.showIf && <GitBranch size={13} className="faint" />}
      <span className={cx('scope-tag', `scope-${f.scope}`)} data-tip={SCOPE_META[f.scope].label}>
        {SCOPE_META[f.scope].icon}
      </span>
    </div>
  );
}

const OPS: { v: ConditionOp; label: string; needs: boolean }[] = [
  { v: 'equals', label: 'is', needs: true },
  { v: 'notEquals', label: 'is not', needs: true },
  { v: 'contains', label: 'contains', needs: true },
  { v: 'isChecked', label: 'is checked', needs: false },
  { v: 'isNotChecked', label: 'is not checked', needs: false },
  { v: 'isFilled', label: 'is filled in', needs: false },
  { v: 'isEmpty', label: 'is empty', needs: false },
];

function ConditionEditor({ form, value, onChange, exclude }: { form: Form; value?: Condition; onChange: (c?: Condition) => void; exclude?: string }) {
  const fields = allFields(form).filter((f) => f.key !== exclude && f.type !== 'signature');
  const src = fields.find((f) => f.key === value?.field);
  const op = OPS.find((o) => o.v === value?.op);
  return (
    <div className="cond">
      <label className="row small">
        <Switch
          checked={!!value}
          onChange={(on) => onChange(on ? { field: fields[0]?.key ?? '', op: fields[0]?.type === 'checkbox' ? 'isChecked' : 'equals', value: fields[0]?.options?.[0] ?? '' } : undefined)}
        />
        Only show when…
      </label>
      {value && (
        <div className="cond-row">
          <select className="select select-sm" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value })}>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select className="select select-sm" value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as ConditionOp })}>
            {OPS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
          {op?.needs &&
            (src?.options?.length ? (
              <select className="select select-sm" value={value.value ?? ''} onChange={(e) => onChange({ ...value, value: e.target.value })}>
                {src.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input className="input input-sm" value={value.value ?? ''} onChange={(e) => onChange({ ...value, value: e.target.value })} placeholder="value" />
            ))}
        </div>
      )}
    </div>
  );
}

function FieldInspector({ form, field }: { form: Form; field: FieldDef }) {
  const updateSections = useStore((s) => s.updateSections);
  const renameKey = useStore((s) => s.renameFieldKey);
  const changeScope = useStore((s) => s.changeFieldScope);
  const docs = useStore((s) => s.docs);
  const [keyDraft, setKeyDraft] = useState(field.key);
  const [optDraft, setOptDraft] = useState((field.options ?? []).join('\n'));
  const [aliasDraft, setAliasDraft] = useState((field.aliases ?? []).join(', '));

  const patch = (p: Partial<FieldDef>) =>
    updateSections(form.id, (secs) => secs.map((s) => ({ ...s, fields: s.fields.map((f) => (f.id === field.id ? { ...f, ...p } : f)) })));
  const usage = docs.filter((d) => d.formId === form.id).reduce((n, d) => n + d.mappings.filter((m) => tokensIn(m.source).includes(field.key)).length, 0);

  const commitKey = () => {
    const k = slugify(keyDraft);
    if (k === field.key) return setKeyDraft(field.key);
    if (allFields(form).some((f) => f.key === k)) {
      toast(`"${k}" is already used by another field.`, 'error');
      return setKeyDraft(field.key);
    }
    renameKey(form.id, field.key, k);
    setKeyDraft(k);
    toast(usage ? `Renamed — ${usage} mapping${usage > 1 ? 's' : ''} updated.` : 'Key renamed.', 'success');
  };

  return (
    <div className="bi">
      <div className="field">
        <label>Label</label>
        <input className="input" value={field.label} onChange={(e) => patch({ label: e.target.value })} autoFocus />
      </div>
      <div className="field">
        <label>Type</label>
        <div className="type-grid">
          {(Object.keys(TYPE_META) as FieldType[]).map((t) => (
            <button
              type="button"
              key={t}
              className={cx('type-opt', t === field.type && 'on')}
              onClick={() => patch({ type: t, ...((t === 'select' || t === 'radio') && !field.options?.length ? { options: ['Option 1', 'Option 2'] } : {}) })}
            >
              {TYPE_META[t].icon}
              {TYPE_META[t].label}
            </button>
          ))}
        </div>
      </div>
      {(field.type === 'select' || field.type === 'radio') && (
        <div className="field">
          <label>Choices (one per line)</label>
          <textarea
            className="textarea"
            rows={4}
            value={optDraft}
            onChange={(e) => setOptDraft(e.target.value)}
            onBlur={() => patch({ options: [...new Set(optDraft.split('\n').map((s) => s.trim()).filter(Boolean))] })}
          />
        </div>
      )}
      <div className="field">
        <label>Value is kept</label>
        <Segmented
          block
          value={field.scope}
          onChange={(s: Scope) => changeScope(form.id, field.key, s)}
          options={(Object.keys(SCOPE_META) as Scope[]).map((s) => ({ value: s, label: SCOPE_META[s].label, icon: SCOPE_META[s].icon }))}
        />
        <div className="field-help">{SCOPE_META[field.scope].desc}</div>
      </div>
      <div className="bi-2col">
        <div className="field">
          <label>Width</label>
          <Segmented
            block
            value={field.width ?? 'full'}
            onChange={(w) => patch({ width: w })}
            options={[
              { value: 'full', label: 'Full' },
              { value: 'half', label: '½' },
              { value: 'third', label: '⅓' },
            ]}
          />
        </div>
        <div className="field">
          <label>Required</label>
          <label className="row small" style={{ height: 34 }}>
            <Switch checked={!!field.required} onChange={(v) => patch({ required: v })} /> Warn if empty when printing
          </label>
        </div>
      </div>
      {field.type !== 'signature' && field.type !== 'checkbox' && (
        <div className="bi-2col">
          <div className="field">
            <label>Placeholder</label>
            <input className="input input-sm" value={field.placeholder ?? ''} onChange={(e) => patch({ placeholder: e.target.value || undefined })} />
          </div>
          <div className="field">
            <label>Sample value</label>
            <input className="input input-sm" value={field.sample ?? ''} onChange={(e) => patch({ sample: e.target.value || undefined })} placeholder="Shown while mapping" />
          </div>
        </div>
      )}
      {field.scope === 'load' && field.type !== 'signature' && (
        <div className="field">
          <label>Starts each new load with</label>
          <input
            className="input input-sm"
            value={field.defaultValue ?? ''}
            onChange={(e) => patch({ defaultValue: e.target.value || undefined })}
            placeholder={field.type === 'date' ? '{today}' : 'blank'}
          />
          {field.type === 'date' && <div className="field-help">Use {'{today}'} for the day you start the load.</div>}
        </div>
      )}
      <div className="field">
        <label>Help text</label>
        <input className="input input-sm" value={field.help ?? ''} onChange={(e) => patch({ help: e.target.value || undefined })} />
      </div>
      <ConditionEditor form={form} value={field.showIf} exclude={field.key} onChange={(c) => patch({ showIf: c })} />
      <details className="advanced">
        <summary>Advanced</summary>
        <div className="field">
          <label>Field key</label>
          <input className="input input-sm mono" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} onBlur={commitKey} onKeyDown={(e) => e.key === 'Enter' && commitKey()} />
          <div className="field-help">
            Used in mappings as {'{'}
            {field.key}
            {'}'} and in data files. {usage ? `Used ${usage}× in your PDFs.` : 'Not used in any PDF yet.'}
          </div>
        </div>
        <div className="field">
          <label>Also known as (for auto-map)</label>
          <input
            className="input input-sm"
            value={aliasDraft}
            onChange={(e) => setAliasDraft(e.target.value)}
            onBlur={() => patch({ aliases: aliasDraft.split(',').map((s) => s.trim()).filter(Boolean) })}
            placeholder="e.g. B/L, bill of lading #"
          />
        </div>
      </details>
    </div>
  );
}

function SectionInspector({ form, section }: { form: Form; section: Section }) {
  const updateSections = useStore((s) => s.updateSections);
  const patch = (p: Partial<Section>) => updateSections(form.id, (secs) => secs.map((s) => (s.id === section.id ? { ...s, ...p } : s)));
  return (
    <div className="bi">
      <div className="field">
        <label>Section title</label>
        <input className="input" value={section.title} onChange={(e) => patch({ title: e.target.value })} autoFocus />
      </div>
      <div className="field">
        <label>Description</label>
        <input className="input input-sm" value={section.description ?? ''} onChange={(e) => patch({ description: e.target.value || undefined })} />
      </div>
      <ConditionEditor form={form} value={section.showIf} onChange={(c) => patch({ showIf: c })} />
    </div>
  );
}

export function FormBuilder({ formId }: { formId: string }) {
  const form = useForm(formId);
  const sets = useStore((s) => s.sets);
  const docs = useStore((s) => s.docs);
  const { updateSections, updateForm, deleteForm } = useStore.getState();
  const [selId, setSelId] = useState<string | null>(null);
  const [dragSection, setDragSection] = useState(false);
  const [test, setTest] = useState<Values | null>(null);
  const addMenu = usePopover();
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const items = useMemo(() => (form ? flatten(form.sections, dragSection) : []), [form, dragSection]);
  const testValues = useMemo(() => test ?? (form ? sampleValues(form, { ...form.globalValues }) : {}), [test, form]);

  useEffect(() => {
    if (!form) navigate(routes.home(), true);
  }, [form]);
  if (!form) return null;
  const sel = items.find((i) => i.id === selId) ?? (selId ? flatten(form.sections, false).find((i) => i.id === selId) : undefined);
  const firstSet = sets.find((s) => s.formId === form.id);

  const onDragStart = (e: DragStartEvent) => {
    const it = items.find((i) => i.id === e.active.id);
    if (it?.kind === 'section') setDragSection(true);
  };
  const onDragEnd = (e: DragEndEvent) => {
    const wasSection = dragSection;
    setDragSection(false);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const list = flatten(form.sections, wasSection);
    const from = list.findIndex((i) => i.id === active.id);
    const to = list.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    const moved = arrayMove(list, from, to);
    if (wasSection) {
      const order = moved.map((i) => i.id);
      updateSections(form.id, (secs) => [...secs].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)));
    } else {
      updateSections(form.id, (secs) => rebuild(moved, secs));
    }
  };

  const addField = (type: FieldType, sectionId?: string) => {
    const taken = new Set(allFields(form).map((f) => f.key));
    const label = `New ${TYPE_META[type].label.toLowerCase()}`;
    const f = newField(type, label, uniqueKey(slugify(label), taken), type === 'signature' ? 'global' : 'set');
    const target = sectionId ?? (sel?.kind === 'section' ? sel.id : form.sections.find((s) => s.fields.some((x) => x.id === selId))?.id) ?? form.sections[form.sections.length - 1]?.id;
    updateSections(form.id, (secs) => {
      if (!secs.length) return [{ ...newSection('Fields'), fields: [f] }];
      return secs.map((s) => (s.id === target ? { ...s, fields: [...s.fields, f] } : s));
    });
    setSelId(f.id);
  };
  const addSection = () => {
    const s = newSection();
    updateSections(form.id, (secs) => [...secs, s]);
    setSelId(s.id);
  };
  const duplicate = () => {
    if (sel?.kind !== 'field') return;
    const taken = new Set(allFields(form).map((f) => f.key));
    const copy = { ...sel.field, id: uid('f'), key: uniqueKey(sel.field.key, taken), label: sel.field.label + ' (copy)' };
    updateSections(form.id, (secs) => secs.map((s) => ({ ...s, fields: s.fields.flatMap((f) => (f.id === sel.field.id ? [f, copy] : [f])) })));
    setSelId(copy.id);
  };
  const remove = async () => {
    if (!sel) return;
    if (sel.kind === 'field') {
      const usage = docs.filter((d) => d.formId === form.id).reduce((n, d) => n + d.mappings.filter((m) => tokensIn(m.source).includes(sel.field.key)).length, 0);
      if (usage && !(await confirmDialog({ title: `Delete “${sel.field.label}”?`, message: `It's used in ${usage} place${usage > 1 ? 's' : ''} on your PDFs — those spots will print blank.`, confirm: 'Delete', danger: true })))
        return;
      updateSections(form.id, (secs) => secs.map((s) => ({ ...s, fields: s.fields.filter((f) => f.id !== sel.field.id) })));
    } else {
      if (sel.section.fields.length && !(await confirmDialog({ title: `Delete section “${sel.section.title}”?`, message: `Its ${sel.section.fields.length} fields are deleted too.`, confirm: 'Delete', danger: true })))
        return;
      updateSections(form.id, (secs) => secs.filter((s) => s.id !== sel.id));
    }
    setSelId(null);
  };

  return (
    <div className="builder">
      <div className="builder-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(firstSet ? routes.fill(firstSet.id) : routes.home())}>
          <ArrowLeft /> Back
        </button>
        <input className="title-input" value={form.name} onChange={(e) => updateForm(form.id, (f) => ({ ...f, name: e.target.value }))} aria-label="Form name" />
        <div className="spacer" />
        <span className="small faint hide-sm">{allFields(form).length} fields · changes save automatically</span>
        <button
          className="btn btn-ghost btn-sm btn-danger"
          onClick={async () => {
            if (
              await confirmDialog({
                title: `Delete “${form.name}”?`,
                message: 'Deletes this form with all of its sets, saved values, PDFs and mappings. Export a backup first if unsure.',
                confirm: 'Delete form',
                danger: true,
              })
            ) {
              deleteForm(form.id);
              navigate(routes.home());
            }
          }}
        >
          <Trash2 /> Delete form
        </button>
      </div>
      <div className="builder-body">
        <aside className="builder-outline">
          <div className="row bo-head">
            <span className="section-title grow">Outline</span>
            <button className="btn btn-ghost btn-sm" onClick={addSection}>
              <FolderPlus /> Section
            </button>
            <button
              className="btn btn-soft btn-sm"
              onClick={(e) => {
                setAddTarget(null);
                addMenu.toggle(e.currentTarget);
              }}
            >
              <Plus /> Field
            </button>
          </div>
          <div className="bo-list">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragSection(false)}>
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {items.map((it) => (
                  <OutlineRow
                    key={it.id}
                    item={it}
                    selected={selId === it.id}
                    onSelect={() => setSelId(it.id)}
                    onAddField={
                      it.kind === 'section'
                        ? (el) => {
                            setAddTarget(it.id);
                            addMenu.open(el);
                          }
                        : undefined
                    }
                  />
                ))}
              </SortableContext>
            </DndContext>
            {!form.sections.length && <p className="small muted" style={{ padding: 12 }}>Add a section to get started.</p>}
          </div>
        </aside>

        <section className="builder-inspector">
          {sel ? (
            <>
              <div className="row bi-head">
                <span className="section-title grow">{sel.kind === 'field' ? 'Field' : 'Section'}</span>
                {sel.kind === 'field' && (
                  <button className="btn btn-ghost btn-sm" onClick={duplicate}>
                    <Copy /> Duplicate
                  </button>
                )}
                <button className="btn btn-ghost btn-sm btn-danger" onClick={remove}>
                  <Trash2 /> Delete
                </button>
              </div>
              {sel.kind === 'field' ? <FieldInspector key={sel.id} form={form} field={sel.field} /> : <SectionInspector key={sel.id} form={form} section={sel.section} />}
            </>
          ) : (
            <div className="empty">
              <div className="empty-icon">
                <GitBranch size={22} />
              </div>
              <h3>Select a field to edit it</h3>
              <p className="small" style={{ maxWidth: 360 }}>
                Drag the handles to reorder. Use <strong>Value is kept</strong> to decide what stays the same everywhere, per set, or changes every load. Add conditions to show fields only
                when they're needed.
              </p>
            </div>
          )}
        </section>

        <aside className="builder-preview">
          <div className="row bp-head">
            <Eye size={15} />
            <span className="section-title grow">Live preview</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setTest(null)} data-tip="Reset test values">
              <RotateCcw />
            </button>
          </div>
          <div className="bp-scroll">
            <DataForm form={form} values={testValues} onChange={(k, v) => setTest({ ...testValues, [k]: v })} showScope />
          </div>
        </aside>
      </div>

      <Popover anchor={addMenu.anchor} onClose={addMenu.close} width={220}>
        <div className="menu-label">Add field</div>
        {(Object.keys(TYPE_META) as FieldType[]).map((t) => (
          <MenuItem
            key={t}
            icon={TYPE_META[t].icon}
            onClick={() => {
              addMenu.close();
              addField(t, addTarget ?? undefined);
            }}
          >
            {TYPE_META[t].label}
          </MenuItem>
        ))}
      </Popover>
    </div>
  );
}
