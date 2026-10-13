import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ArrowLeft,
  Cable,
  FileText,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Search,
  SquareDashed,
  Undo2,
  Wand2,
} from 'lucide-react';
import { useDoc, useStore } from '../../lib/store';
import { navigate, routes } from '../../lib/router';
import type { AcroField, AcroWidget, FieldDef, FieldType, Mapping, PdfDoc, Rect } from '../../lib/types';
import { DEFAULT_STYLE } from '../../lib/types';
import { allFields, effectiveValues, sampleValues, templateContext } from '../../lib/values';
import { tokensIn } from '../../lib/template';
import { buildDrawItems } from '../../lib/preview';
import { defaultMappingFor, suggestMappings, type Suggestion } from '../../lib/automap';
import { sampleSignature } from '../../lib/sampleSignature';
import { clamp, uid } from '../../lib/util';
import { Modal, Segmented, cx, toast } from '../../components/ui';
import { PageCanvas, ValueLayer, useFitScale } from '../../components/PdfView';
import { FieldTypeIcon, NewFieldDialog, useFieldColors } from './shared';
import { AcroInspector, DocInspector, MappingInspector } from './Inspector';
import { LinkPainter } from './Links';

type Sel = { kind: 'mapping'; id: string } | { kind: 'acro'; name: string } | null;
type Mode = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const DRAG_TYPE = 'application/x-afpdf-field';

const DEFAULT_SIZE: Record<FieldType, [number, number]> = {
  text: [150, 14],
  textarea: [200, 40],
  number: [70, 14],
  date: [80, 14],
  phone: [100, 14],
  email: [150, 14],
  select: [100, 14],
  radio: [100, 14],
  checkbox: [10, 10],
  signature: [140, 36],
};

function renderFor(type: FieldType | undefined): Mapping['render'] {
  return type === 'signature' ? 'image' : type === 'checkbox' ? 'check' : 'text';
}

function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

// ------------------------------------------------------------------ left panel
const FieldChip = memo(function FieldChip({
  field,
  color,
  count,
  value,
  onEnter,
  onLeave,
  onClick,
}: {
  field: FieldDef;
  color: string;
  count: number;
  value: string;
  onEnter: (k: string) => void;
  onLeave: () => void;
  onClick: (k: string) => void;
}) {
  return (
    <div
      className={cx('chip', count > 0 && 'mapped')}
      data-chip-key={field.key}
      style={{ ['--c' as string]: color }}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, field.key);
        e.dataTransfer.setData('text/plain', `{${field.key}}`);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onMouseEnter={() => onEnter(field.key)}
      onMouseLeave={onLeave}
      onClick={() => onClick(field.key)}
      title="Drag onto the PDF"
    >
      <span className="chip-bar" />
      <FieldTypeIcon type={field.type} />
      <div className="chip-text">
        <span className="truncate">{field.label}</span>
        {field.type === 'signature' ? (
          <span className="chip-val faint">{value ? 'signature on file' : 'no signature yet'}</span>
        ) : (
          <span className="chip-val truncate">{value ? value.replace(/\n/g, ' · ') : '—'}</span>
        )}
      </div>
      {count > 0 && <span className="chip-count">{count}</span>}
    </div>
  );
});

// ------------------------------------------------------------------ page overlay
interface PageProps {
  doc: PdfDoc;
  page: number;
  scale: number;
  widgets: { field: AcroField; w: AcroWidget }[];
  overlays: Mapping[];
  acroMap: Map<string, Mapping>;
  sel: Sel;
  hotKey: string | null;
  colors: Map<string, string>;
  labels: Map<string, string>;
  dropHint: { page: number; acro?: string } | null;
  tool: 'select' | 'box';
  items: ReturnType<typeof buildDrawItems>[number];
  onBgDown: (page: number, e: React.PointerEvent) => void;
  onBgDouble: (page: number, e: React.MouseEvent) => void;
  onAcroDown: (name: string, e: React.PointerEvent) => void;
  onBoxDown: (m: Mapping, mode: Mode, e: React.PointerEvent) => void;
  onDragOver: (page: number, e: React.DragEvent) => void;
  onDrop: (page: number, e: React.DragEvent) => void;
  rubber: { page: number; r: Rect } | null;
}

function keyColor(m: Mapping | undefined, colors: Map<string, string>) {
  const k = m ? tokensIn(m.source)[0] : undefined;
  return (k && colors.get(k)) || '#5b5bd6';
}

const PageOverlay = memo(function PageOverlay(p: PageProps) {
  const meta = p.doc.pages[p.page];
  const s = p.scale;
  const box = (r: Rect) => ({ left: r[0] * s, top: r[1] * s, width: r[2] * s, height: r[3] * s });
  return (
    <div
      className={cx('ix-layer', p.tool === 'box' && 'tool-box')}
      onPointerDown={(e) => e.target === e.currentTarget && p.onBgDown(p.page, e)}
      onDoubleClick={(e) => e.target === e.currentTarget && p.onBgDouble(p.page, e)}
      onDragOver={(e) => p.onDragOver(p.page, e)}
      onDrop={(e) => p.onDrop(p.page, e)}
    >
      <ValueLayer items={p.items} width={meta.width} height={meta.height} scale={s} />
      {p.widgets.map(({ field, w }, i) => {
        const m = p.acroMap.get(field.name);
        const selected = (p.sel?.kind === 'acro' && p.sel.name === field.name) || (p.sel?.kind === 'mapping' && m?.id === p.sel.id);
        const hot = !!m && !!p.hotKey && tokensIn(m.source).includes(p.hotKey);
        const drop = p.dropHint?.page === p.page && p.dropHint.acro === field.name;
        return (
          <div
            key={field.name + i}
            className={cx('acro-box', m ? 'mapped' : 'unmapped', selected && 'selected', hot && 'hot', drop && 'drop', field.kind === 'checkbox' && 'is-check')}
            style={{ ...box(w.rect), ['--c' as string]: keyColor(m, p.colors) }}
            data-mid={m?.id}
            data-acro={field.name}
            onPointerDown={(e) => p.onAcroDown(field.name, e)}
            title={m ? `${field.name} ← ${m.source}` : `${field.name} (not mapped)`}
          >
            {(selected || drop) && <span className="box-tag">{m ? p.labels.get(m.id) : field.name}</span>}
          </div>
        );
      })}
      {p.overlays.map((m) => {
        const r = (m.target as { rect: Rect }).rect;
        const selected = p.sel?.kind === 'mapping' && p.sel.id === m.id;
        const hot = !!p.hotKey && tokensIn(m.source).includes(p.hotKey);
        return (
          <div
            key={m.id}
            className={cx('ov-box', selected && 'selected', hot && 'hot', !m.source && 'empty')}
            style={{ ...box(r), ['--c' as string]: keyColor(m, p.colors) }}
            data-mid={m.id}
            onPointerDown={(e) => p.onBoxDown(m, 'move', e)}
          >
            {!m.source && <span className="ov-empty">Pick a field →</span>}
            {selected && (
              <>
                <span className="box-tag">{p.labels.get(m.id)}</span>
                {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as Mode[]).map((k) => (
                  <span key={k} className={`h h-${k}`} onPointerDown={(e) => p.onBoxDown(m, k, e)} />
                ))}
              </>
            )}
          </div>
        );
      })}
      {p.rubber?.page === p.page && <div className="rubber" style={box(p.rubber.r)} />}
    </div>
  );
});

// ------------------------------------------------------------------ auto-map dialog
function AutoMapDialog({ open, onClose, suggestions, onApply }: { open: boolean; onClose: () => void; suggestions: Suggestion[]; onApply: (s: Suggestion[]) => void }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  useEffect(() => setOff(new Set()), [suggestions]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Auto-map by name"
      description={suggestions.length ? `Found ${suggestions.length} likely matches. Untick any that look wrong.` : 'No confident matches for the remaining PDF fields. Map them by dragging fields onto the page.'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!suggestions.length} onClick={() => onApply(suggestions.filter((s) => !off.has(s.acro.name)))}>
            Map {suggestions.length - off.size} fields
          </button>
        </>
      }
    >
      {suggestions.length > 0 && (
        <div className="automap-list">
          {suggestions.map((s) => (
            <label key={s.acro.name} className="automap-row">
              <input
                type="checkbox"
                checked={!off.has(s.acro.name)}
                onChange={() =>
                  setOff((x) => {
                    const n = new Set(x);
                    if (n.has(s.acro.name)) n.delete(s.acro.name);
                    else n.add(s.acro.name);
                    return n;
                  })
                }
              />
              <span className="mono truncate">{s.acro.name}</span>
              <span className="faint">→</span>
              <span className="truncate" style={{ fontWeight: 550 }}>
                {s.field.label}
              </span>
              <span className={cx('badge', s.score > 0.85 ? 'badge-success' : 'badge-warn')}>{Math.round(s.score * 100)}%</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ main
export function Mapper({ docId, setId }: { docId: string; setId?: string }) {
  const doc = useDoc(docId);
  const form = useStore((s) => s.forms.find((f) => f.id === doc?.formId));
  const allSets = useStore((s) => s.sets);
  const showLinks = useStore((s) => s.settings.showLinks);
  const { updateDoc, setSettings } = useStore.getState();
  const formSets = useMemo(() => allSets.filter((s) => s.formId === doc?.formId), [allSets, doc?.formId]);

  const [dataSrc, setDataSrc] = useState<string>(() => setId ?? formSets.find((s) => s.docIds.includes(docId))?.id ?? 'sample');
  const set = formSets.find((s) => s.id === dataSrc);
  const [sel, setSel] = useState<Sel>(null);
  const [tool, setTool] = useState<'select' | 'box'>('select');
  const [zoom, setZoom] = useState<number | null>(null);
  const [draft, setDraft] = useState<Mapping | null>(null);
  const [hotKey, setHotKey] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ page: number; acro?: string } | null>(null);
  const [rubber, setRubber] = useState<{ page: number; r: Rect } | null>(null);
  const [leftTab, setLeftTab] = useState<'form' | 'pdf'>('form');
  const [search, setSearch] = useState('');
  const [newField, setNewField] = useState<{ seed?: { label?: string; type?: FieldType; options?: string[] }; then?: (f: FieldDef) => void } | null>(null);
  const [auto, setAuto] = useState<Suggestion[] | null>(null);
  const past = useRef<Mapping[][]>([]);
  const future = useRef<Mapping[][]>([]);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const hostRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const painter = useRef<LinkPainter | null>(null);

  const colors = useFieldColors(form);
  const fit = useFitScale(canvasRef, doc?.pages[0]?.width ?? 612, 80, 1.8);
  const scale = zoom ?? fit;

  useEffect(() => {
    if (!doc) navigate(routes.home(), true);
  }, [doc]);

  // ---------- values for live preview ----------
  const sampleSig = useMemo(() => sampleSignature(), []);
  const values = useMemo(() => {
    if (!form) return {};
    if (set) return effectiveValues(form, set);
    const v = sampleValues(form);
    for (const f of allFields(form)) if (f.type === 'signature') v[f.key] = form.globalValues[f.key] || sampleSig;
    return v;
  }, [form, set, sampleSig]);
  const ctx = useMemo(() => (form ? templateContext(form, values, set) : null), [form, values, set]);

  const mappings = useMemo(() => (doc ? (draft ? doc.mappings.map((m) => (m.id === draft.id ? draft : m)) : doc.mappings) : []), [doc, draft]);
  const docView = useMemo(() => (doc ? { ...doc, mappings } : null), [doc, mappings]);
  const items = useMemo(() => (docView && ctx ? buildDrawItems(docView, ctx) : []), [docView, ctx]);
  const acroMap = useMemo(() => new Map(mappings.flatMap((m) => (m.target.kind === 'acro' ? [[m.target.field, m] as const] : []))), [mappings]);
  const widgetsByPage = useMemo(() => {
    const pages: { field: AcroField; w: AcroWidget }[][] = doc ? doc.pages.map(() => []) : [];
    for (const f of doc?.acroFields ?? []) for (const w of f.widgets) pages[w.page]?.push({ field: f, w });
    return pages;
  }, [doc]);
  const overlaysByPage = useMemo(() => {
    const pages: Mapping[][] = doc ? doc.pages.map(() => []) : [];
    for (const m of mappings) if (m.target.kind === 'overlay') pages[m.target.page]?.push(m);
    return pages;
  }, [doc, mappings]);
  const fieldsByKey = useMemo(() => new Map(form ? allFields(form).map((f) => [f.key, f]) : []), [form]);
  const labels = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of mappings) {
      const keys = tokensIn(x.source);
      m.set(x.id, keys.length ? keys.map((k) => fieldsByKey.get(k)?.label ?? k).join(' + ') : x.source ? 'Fixed text' : 'Unassigned');
    }
    return m;
  }, [mappings, fieldsByKey]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of mappings) for (const k of new Set(tokensIn(m.source))) c.set(k, (c.get(k) ?? 0) + 1);
    return c;
  }, [mappings]);

  // ---------- history ----------
  const docRef = useLatest(doc);
  const commit = useCallback(
    (next: Mapping[]) => {
      const d = docRef.current;
      if (!d) return;
      past.current.push(d.mappings);
      if (past.current.length > 150) past.current.shift();
      future.current = [];
      updateDoc(d.id, (x) => ({ ...x, mappings: next }));
      bump();
    },
    [docRef, updateDoc],
  );
  const undo = useCallback(() => {
    const d = docRef.current;
    const prev = past.current.pop();
    if (!d || !prev) return;
    future.current.push(d.mappings);
    updateDoc(d.id, (x) => ({ ...x, mappings: prev }));
    bump();
  }, [docRef, updateDoc]);
  const redo = useCallback(() => {
    const d = docRef.current;
    const next = future.current.pop();
    if (!d || !next) return;
    past.current.push(d.mappings);
    updateDoc(d.id, (x) => ({ ...x, mappings: next }));
    bump();
  }, [docRef, updateDoc]);

  // ---------- mapping operations ----------
  const mapAcro = useCallback(
    (name: string, f: FieldDef) => {
      const d = docRef.current;
      const acro = d?.acroFields.find((a) => a.name === name);
      if (!d || !acro) return;
      const existing = d.mappings.find((m) => m.target.kind === 'acro' && m.target.field === name);
      let id: string;
      if (existing) {
        id = existing.id;
        commit(d.mappings.map((m) => (m.id === existing.id ? { ...m, source: `{${f.key}}`, render: f.type === 'signature' ? 'image' : acro.kind === 'checkbox' ? 'check' : 'text' } : m)));
      } else {
        const m = defaultMappingFor(acro, f.key, f.type);
        id = m.id;
        commit([...d.mappings, m]);
      }
      setSel({ kind: 'mapping', id });
    },
    [docRef, commit],
  );

  const addOverlay = useCallback(
    (page: number, at: { x: number; y: number }, f?: FieldDef, size?: [number, number], exact?: Rect) => {
      const d = docRef.current;
      if (!d) return;
      const meta = d.pages[page];
      const [w, h] = size ?? DEFAULT_SIZE[f?.type ?? 'text'];
      const rect: Rect = exact ?? [clamp(at.x - 4, 0, meta.width - w), clamp(at.y - h / 2, 0, meta.height - h), w, h];
      const m: Mapping = {
        id: uid('m'),
        target: { kind: 'overlay', page, rect },
        source: f ? `{${f.key}}` : '',
        render: renderFor(f?.type),
        style: { ...DEFAULT_STYLE, multiline: f?.type === 'textarea' },
      };
      commit([...d.mappings, m]);
      setSel({ kind: 'mapping', id: m.id });
    },
    [docRef, commit],
  );

  const removeMapping = useCallback(
    (id: string) => {
      const d = docRef.current;
      if (!d) return;
      const m = d.mappings.find((x) => x.id === id);
      commit(d.mappings.filter((x) => x.id !== id));
      setSel(m?.target.kind === 'acro' ? { kind: 'acro', name: m.target.field } : null);
    },
    [docRef, commit],
  );

  const updateMapping = useCallback(
    (m: Mapping) => {
      const d = docRef.current;
      if (!d) return;
      commit(d.mappings.map((x) => (x.id === m.id ? m : x)));
    },
    [docRef, commit],
  );

  // ---------- pointer → page points ----------
  const pagePoint = (page: number, clientX: number, clientY: number) => {
    const el = canvasRef.current?.querySelector<HTMLElement>(`.page[data-page="${page}"]`);
    const r = el!.getBoundingClientRect();
    return { x: (clientX - r.left) / scaleRef.current, y: (clientY - r.top) / scaleRef.current };
  };
  const scaleRef = useLatest(scale);

  const hitAcro = (page: number, pt: { x: number; y: number }) => {
    let best: { name: string; area: number } | null = null;
    for (const { field, w } of widgetsByPage[page] ?? []) {
      const [x, y, ww, hh] = w.rect;
      if (pt.x >= x - 1 && pt.x <= x + ww + 1 && pt.y >= y - 1 && pt.y <= y + hh + 1) {
        const area = ww * hh;
        if (!best || area < best.area) best = { name: field.name, area };
      }
    }
    return best?.name;
  };

  const onDragOver = useCallback(
    (page: number, e: React.DragEvent) => {
      if (![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const pt = pagePoint(page, e.clientX, e.clientY);
      const acro = hitAcro(page, pt);
      setDropHint((h) => (h?.page === page && h.acro === acro ? h : { page, acro }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [widgetsByPage],
  );

  const onDrop = useCallback(
    (page: number, e: React.DragEvent) => {
      const key = e.dataTransfer.getData(DRAG_TYPE);
      setDropHint(null);
      if (!key) return;
      e.preventDefault();
      const f = fieldsByKey.get(key);
      if (!f) return;
      const pt = pagePoint(page, e.clientX, e.clientY);
      const acro = hitAcro(page, pt);
      if (acro) mapAcro(acro, f);
      else addOverlay(page, pt, f);
      setTool('select');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fieldsByKey, mapAcro, addOverlay, widgetsByPage],
  );

  useEffect(() => {
    const clear = () => setDropHint(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  const onBgDown = useCallback(
    (page: number, e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (tool !== 'box') {
        setSel(null);
        return;
      }
      e.preventDefault();
      const start = pagePoint(page, e.clientX, e.clientY);
      const meta = docRef.current!.pages[page];
      let r: Rect = [start.x, start.y, 0, 0];
      const move = (ev: PointerEvent) => {
        const p = pagePoint(page, ev.clientX, ev.clientY);
        const x = clamp(Math.min(start.x, p.x), 0, meta.width);
        const y = clamp(Math.min(start.y, p.y), 0, meta.height);
        r = [x, y, Math.min(meta.width - x, Math.abs(p.x - start.x)), Math.min(meta.height - y, Math.abs(p.y - start.y))];
        setRubber({ page, r });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setRubber(null);
        setTool('select');
        if (r[2] < 4 || r[3] < 4) addOverlay(page, start);
        else addOverlay(page, start, undefined, undefined, r);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tool, addOverlay],
  );

  const onBgDouble = useCallback(
    (page: number, e: React.MouseEvent) => addOverlay(page, pagePoint(page, e.clientX, e.clientY)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [addOverlay],
  );

  const onAcroDown = useCallback(
    (name: string, e: React.PointerEvent) => {
      e.stopPropagation();
      const m = docRef.current?.mappings.find((x) => x.target.kind === 'acro' && x.target.field === name);
      setSel(m ? { kind: 'mapping', id: m.id } : { kind: 'acro', name });
    },
    [docRef],
  );

  const draftRef = useRef<Mapping | null>(null);
  const onBoxDown = useCallback(
    (m: Mapping, mode: Mode, e: React.PointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      setSel({ kind: 'mapping', id: m.id });
      if (m.target.kind !== 'overlay') return;
      const t = m.target;
      const meta = docRef.current!.pages[t.page];
      const sx = e.clientX;
      const sy = e.clientY;
      const [x0, y0, w0, h0] = t.rect;
      let moved = false;
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - sx) / scaleRef.current;
        const dy = (ev.clientY - sy) / scaleRef.current;
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
        moved = true;
        const snap = (v: number) => (ev.altKey ? v : Math.round(v * 2) / 2);
        let [x, y, w, h] = [x0, y0, w0, h0];
        if (mode === 'move') {
          x = clamp(snap(x0 + dx), 0, meta.width - w0);
          y = clamp(snap(y0 + dy), 0, meta.height - h0);
        } else {
          if (mode.includes('w')) {
            x = clamp(snap(x0 + dx), 0, x0 + w0 - 3);
            w = x0 + w0 - x;
          }
          if (mode.includes('e')) w = clamp(snap(w0 + dx), 3, meta.width - x0);
          if (mode.includes('n')) {
            y = clamp(snap(y0 + dy), 0, y0 + h0 - 3);
            h = y0 + h0 - y;
          }
          if (mode.includes('s')) h = clamp(snap(h0 + dy), 3, meta.height - y0);
        }
        const next = { ...m, target: { ...t, rect: [x, y, w, h] as Rect } };
        draftRef.current = next;
        setDraft(next);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const d = draftRef.current;
        draftRef.current = null;
        setDraft(null);
        if (moved && d) updateMapping(d);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [docRef, scaleRef, updateMapping],
  );

  // ---------- selection helpers ----------
  const scrollToMapping = (id: string) => {
    requestAnimationFrame(() => canvasRef.current?.querySelector(`[data-mid="${id}"]`)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }));
  };
  const cycleRef = useRef<Record<string, number>>({});
  const onChipClick = useCallback(
    (key: string) => {
      const list = mappings.filter((m) => tokensIn(m.source).includes(key));
      if (!list.length) {
        toast('Drag this field onto the PDF to place it.', 'info');
        return;
      }
      const i = ((cycleRef.current[key] ?? -1) + 1) % list.length;
      cycleRef.current[key] = i;
      setSel({ kind: 'mapping', id: list[i].id });
      scrollToMapping(list[i].id);
    },
    [mappings],
  );
  const selectAcro = (name: string) => {
    const m = acroMap.get(name);
    setSel(m ? { kind: 'mapping', id: m.id } : { kind: 'acro', name });
    requestAnimationFrame(() => canvasRef.current?.querySelector(`[data-acro="${CSS.escape(name)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };
  const onHover = useCallback((k: string) => setHotKey(k), []);
  const onLeave = useCallback(() => setHotKey(null), []);

  // ---------- keyboard ----------
  const keyState = useLatest({ sel, mappings, doc });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable], .modal')) return;
      const { sel: s, mappings: ms, doc: d } = keyState.current;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setZoom((z) => Math.min(4, (z ?? scaleRef.current) * 1.15));
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        setZoom((z) => Math.max(0.3, (z ?? scaleRef.current) / 1.15));
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        setZoom(null);
        return;
      }
      if (e.key === 'Escape') {
        setSel(null);
        setTool('select');
        return;
      }
      if (!mod && e.key.toLowerCase() === 't') return setTool('box');
      if (!mod && e.key.toLowerCase() === 'v') return setTool('select');
      if (!s || s.kind !== 'mapping' || !d) return;
      const m = ms.find((x) => x.id === s.id);
      if (!m) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeMapping(m.id);
        return;
      }
      if (m.target.kind !== 'overlay') return;
      const t2 = m.target;
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const meta = d.pages[t2.page];
        const [x, y, w, h] = t2.rect;
        const copy: Mapping = { ...m, id: uid('m'), target: { ...t2, rect: [x, clamp(y + h + 4, 0, meta.height - h), w, h] } };
        commit([...d.mappings, copy]);
        setSel({ kind: 'mapping', id: copy.id });
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const dd = delta[e.key];
      if (dd) {
        e.preventDefault();
        const [x, y, w, h] = t2.rect;
        updateMapping({ ...m, target: { ...t2, rect: [x + dd[0], y + dd[1], w, h] } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keyState, undo, redo, removeMapping, commit, updateMapping, scaleRef]);

  // ---------- ctrl+wheel zoom anchored at the pointer ----------
  const anchor = useRef<{ x: number; y: number; ox: number; oy: number; from: number } | null>(null);
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      const from = scaleRef.current;
      const to = clamp(from * Math.exp(-e.deltaY * 0.0022), 0.3, 4);
      anchor.current = { x: el.scrollLeft + ox, y: el.scrollTop + oy, ox, oy, from };
      setZoom(to);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scaleRef]);
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = canvasRef.current;
    if (!a || !el) return;
    anchor.current = null;
    const k = scale / a.from;
    el.scrollLeft = a.x * k - a.ox;
    el.scrollTop = a.y * k - a.oy;
  }, [scale]);

  // ---------- link wires ----------
  useEffect(() => {
    if (!hostRef.current || !svgRef.current) return;
    const p = new LinkPainter(hostRef.current, svgRef.current, () => listRef.current, () => canvasRef.current);
    painter.current = p;
    const ro = new ResizeObserver(p.schedule);
    ro.observe(hostRef.current);
    window.addEventListener('resize', p.schedule);
    return () => {
      p.destroy();
      ro.disconnect();
      window.removeEventListener('resize', p.schedule);
    };
  }, []);
  const selMappingId = sel?.kind === 'mapping' ? sel.id : null;
  useEffect(() => {
    painter.current?.update({ mappings, colors, hotKey, hotMapping: selMappingId, enabled: showLinks && leftTab === 'form' });
  }, [mappings, colors, hotKey, selMappingId, showLinks, leftTab, scale, search]);
  // pages re-layout after zoom settles
  useEffect(() => {
    const t = setTimeout(() => painter.current?.schedule(), 60);
    return () => clearTimeout(t);
  }, [scale]);

  if (!doc || !form || !ctx) return null;

  const selMapping = selMappingId ? mappings.find((m) => m.id === selMappingId) : undefined;
  const selAcro =
    sel?.kind === 'acro'
      ? doc.acroFields.find((a) => a.name === sel.name)
      : selMapping?.target.kind === 'acro'
        ? doc.acroFields.find((a) => a.name === (selMapping.target as { field: string }).field)
        : undefined;
  const q = search.trim().toLowerCase();
  const back = set ? routes.fill(set.id) : formSets[0] ? routes.fill(formSets[0].id) : routes.home();

  return (
    <div className="mapper">
      <div className="mapper-bar">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(back)}>
          <ArrowLeft /> Done
        </button>
        <div className="mapper-title">
          <FileText size={16} />
          <span className="truncate">{doc.name}</span>
          <span className="badge">
            {doc.pages.length} page{doc.pages.length > 1 ? 's' : ''}
          </span>
          {form.isSample && <span className="badge badge-accent">Sample</span>}
        </div>
        <div className="spacer" />
        <Segmented
          value={tool}
          onChange={setTool}
          options={[
            { value: 'select', label: '', icon: <MousePointer2 />, tip: 'Select & move (V)' },
            { value: 'box', label: 'Text box', icon: <SquareDashed />, tip: 'Draw a text box (T)' },
          ]}
        />
        <div className="bar-sep" />
        <button className="btn btn-ghost btn-icon btn-sm" onClick={undo} disabled={!past.current.length} data-tip="Undo (Ctrl+Z)">
          <Undo2 />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={redo} disabled={!future.current.length} data-tip="Redo (Ctrl+Y)">
          <Redo2 />
        </button>
        <div className="bar-sep" />
        {doc.acroFields.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAuto(suggestMappings(form, doc.acroFields, doc.mappings))}>
            <Wand2 /> Auto-map
          </button>
        )}
        <button className={cx('btn btn-ghost btn-sm', showLinks && 'active')} onClick={() => setSettings({ showLinks: !showLinks })} data-tip="Show connection lines">
          <Cable /> Lines
        </button>
        <div className="bar-sep" />
        <div className="zoom">
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(Math.max(0.3, scale / 1.15))} aria-label="Zoom out">
            <Minus />
          </button>
          <button className="zoom-val" onClick={() => setZoom(null)} data-tip="Fit width (Ctrl+0)">
            {Math.round(scale * 100)}%
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setZoom(Math.min(4, scale * 1.15))} aria-label="Zoom in">
            <Plus />
          </button>
        </div>
        <div className="bar-sep" />
        <label className="row small muted data-src">
          Preview
          <select className="select select-sm" value={dataSrc} onChange={(e) => setDataSrc(e.target.value)}>
            <option value="sample">Sample data</option>
            {formSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mapper-body" ref={hostRef}>
        <aside className="mapper-left">
          <div className="ml-head">
            <Segmented
              block
              value={leftTab}
              onChange={setLeftTab}
              options={[
                { value: 'form', label: 'Your fields' },
                { value: 'pdf', label: `PDF fields${doc.acroFields.length ? ` (${doc.acroFields.length})` : ''}` },
              ]}
            />
            <div className="input-group">
              <Search />
              <input className="input input-sm" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div className="ml-list" ref={listRef} onScroll={() => painter.current?.schedule()}>
            {leftTab === 'form' ? (
              <>
                <p className="tiny faint ml-hint">Drag a field onto a box or anywhere on the page.</p>
                {form.sections.map((s) => {
                  const fields = s.fields.filter((f) => !q || f.label.toLowerCase().includes(q) || f.key.includes(q));
                  if (!fields.length) return null;
                  return (
                    <div key={s.id} className="ml-section">
                      <div className="ml-section-title">{s.title}</div>
                      {fields.map((f) => (
                        <FieldChip
                          key={f.id}
                          field={f}
                          color={colors.get(f.key) ?? '#5b5bd6'}
                          count={counts.get(f.key) ?? 0}
                          value={values[f.key] ?? ''}
                          onEnter={onHover}
                          onLeave={onLeave}
                          onClick={onChipClick}
                        />
                      ))}
                    </div>
                  );
                })}
                <button className="btn btn-ghost btn-sm btn-block" onClick={() => setNewField({})}>
                  <Plus /> New field
                </button>
              </>
            ) : doc.acroFields.length === 0 ? (
              <p className="small muted" style={{ padding: 12 }}>
                This PDF has no fillable fields. Drag your fields onto the page — they become text boxes you can move and resize.
              </p>
            ) : (
              [...doc.acroFields]
                .filter((a) => !q || a.name.toLowerCase().includes(q))
                .sort((a, b) => Number(acroMap.has(a.name)) - Number(acroMap.has(b.name)))
                .map((a) => {
                  const m = acroMap.get(a.name);
                  const active = (sel?.kind === 'acro' && sel.name === a.name) || (m && m.id === selMappingId);
                  return (
                    <button key={a.name} className={cx('acro-row', active && 'active', m && 'mapped')} onClick={() => selectAcro(a.name)}>
                      <span className="dot" style={{ background: m ? keyColor(m, colors) : 'var(--border-strong)' }} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="truncate mono">{a.name}</div>
                        <div className="tiny faint truncate">{m ? labels.get(m.id) : `${a.kind} · not mapped`}</div>
                      </div>
                    </button>
                  );
                })
            )}
          </div>
        </aside>

        <div className="mapper-canvas" ref={canvasRef} onScroll={() => painter.current?.schedule()}>
          <div className="page-stack">
            {doc.pages.map((p, i) => (
              <div key={i} className="page" data-page={i} style={{ width: p.width * scale, height: p.height * scale }}>
                <PageCanvas fileId={doc.fileId} index={i} scale={scale} width={p.width} height={p.height} />
                <PageOverlay
                  doc={doc}
                  page={i}
                  scale={scale}
                  widgets={widgetsByPage[i]}
                  overlays={overlaysByPage[i]}
                  acroMap={acroMap}
                  sel={sel}
                  hotKey={hotKey}
                  colors={colors}
                  labels={labels}
                  dropHint={dropHint}
                  tool={tool}
                  items={items[i] ?? []}
                  onBgDown={onBgDown}
                  onBgDouble={onBgDouble}
                  onAcroDown={onAcroDown}
                  onBoxDown={onBoxDown}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  rubber={rubber}
                />
                {doc.pages.length > 1 && <div className="page-num">{i + 1}</div>}
              </div>
            ))}
          </div>
        </div>

        <aside className="mapper-right">
          {selMapping ? (
            <MappingInspector
              key={selMapping.id}
              form={form}
              doc={doc}
              mapping={selMapping}
              acro={selAcro}
              ctx={ctx}
              colors={colors}
              onChange={updateMapping}
              onDelete={() => removeMapping(selMapping.id)}
            />
          ) : selAcro ? (
            <AcroInspector
              key={selAcro.name}
              form={form}
              acro={selAcro}
              colors={colors}
              onPick={(f) => mapAcro(selAcro.name, f)}
              onCreate={(seed) => setNewField({ seed, then: (f) => mapAcro(selAcro.name, f) })}
              onFixedText={() => {
                const m = { ...defaultMappingFor(selAcro, ''), source: 'N/A' };
                commit([...doc.mappings, m]);
                setSel({ kind: 'mapping', id: m.id });
              }}
            />
          ) : (
            <DocInspector
              form={form}
              doc={doc}
              ctx={ctx}
              onRename={(name) => updateDoc(doc.id, (d) => ({ ...d, name }))}
              onOutputName={(outputName) => updateDoc(doc.id, (d) => ({ ...d, outputName }))}
              onAutoMap={() => setAuto(suggestMappings(form, doc.acroFields, doc.mappings))}
              onSelectAcro={selectAcro}
            />
          )}
        </aside>
        <svg ref={svgRef} className="link-layer" aria-hidden />
      </div>

      <AutoMapDialog
        open={!!auto}
        suggestions={auto ?? []}
        onClose={() => setAuto(null)}
        onApply={(list) => {
          commit([...doc.mappings, ...list.map((s) => s.mapping)]);
          setAuto(null);
          toast(`Mapped ${list.length} field${list.length === 1 ? '' : 's'}`, 'success');
        }}
      />
      <NewFieldDialog
        open={!!newField}
        onClose={() => setNewField(null)}
        form={form}
        seed={newField?.seed}
        onCreated={(f) => {
          const then = newField?.then;
          // wait a tick so the store has the new field before mapping to it
          setTimeout(() => then?.(f), 0);
          toast(`Created “${f.label}”`, 'success');
        }}
      />
    </div>
  );
}

