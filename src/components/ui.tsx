import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { AlertTriangle, CheckCircle2, Info, Upload, X } from 'lucide-react';
import { SET_COLORS } from '../lib/types';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

// ---------------- Switch / Segmented ----------------
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  block,
}: {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode; tip?: string }[];
  onChange: (v: T) => void;
  block?: boolean;
}) {
  return (
    <div className={cx('seg', block && 'seg-block')} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx(o.value === value && 'on')} onClick={() => onChange(o.value)} data-tip={o.tip}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="color-swatches">
      {SET_COLORS.map((c) => (
        <button key={c} type="button" className={cx(c === value && 'on')} style={{ background: c }} onClick={() => onChange(c)} aria-label={`Color ${c}`} />
      ))}
    </div>
  );
}

// ---------------- Modal ----------------
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  icon,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  icon?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button.btn-primary');
      el?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('modal', wide && 'modal-wide')} ref={ref} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon && <div className="modal-icon">{icon}</div>}
          <div className="grow">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <X />
          </button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---------------- Confirm (promise based) ----------------
interface ConfirmOpts {
  title: string;
  message?: ReactNode;
  confirm?: string;
  cancel?: string;
  danger?: boolean;
}
const useConfirmStore = create<{ opts: ConfirmOpts | null; resolve: ((v: boolean) => void) | null }>(() => ({ opts: null, resolve: null }));

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.setState({ opts, resolve }));
}

export function ConfirmHost() {
  const { opts, resolve } = useConfirmStore();
  const close = useCallback(
    (v: boolean) => {
      resolve?.(v);
      useConfirmStore.setState({ opts: null, resolve: null });
    },
    [resolve],
  );
  const onClose = useCallback(() => close(false), [close]);
  return (
    <Modal
      open={!!opts}
      onClose={onClose}
      title={opts?.title}
      description={opts?.message}
      footer={
        <>
          <button className="btn" onClick={() => close(false)}>
            {opts?.cancel ?? 'Cancel'}
          </button>
          <button className={cx('btn', opts?.danger ? 'btn-primary danger-fill' : 'btn-primary')} onClick={() => close(true)} autoFocus>
            {opts?.confirm ?? 'OK'}
          </button>
        </>
      }
    />
  );
}

// ---------------- Prompt ----------------
interface PromptOpts {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirm?: string;
}
const usePromptStore = create<{ opts: PromptOpts | null; resolve: ((v: string | null) => void) | null }>(() => ({ opts: null, resolve: null }));
export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => usePromptStore.setState({ opts, resolve }));
}
export function PromptHost() {
  const { opts, resolve } = usePromptStore();
  const [v, setV] = useState('');
  useEffect(() => setV(opts?.value ?? ''), [opts]);
  const close = useCallback(
    (val: string | null) => {
      resolve?.(val);
      usePromptStore.setState({ opts: null, resolve: null });
    },
    [resolve],
  );
  const onClose = useCallback(() => close(null), [close]);
  return (
    <Modal
      open={!!opts}
      onClose={onClose}
      title={opts?.title}
      footer={
        <>
          <button className="btn" onClick={() => close(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!v.trim()} onClick={() => close(v.trim())}>
            {opts?.confirm ?? 'Save'}
          </button>
        </>
      }
    >
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) close(v.trim());
        }}
      >
        {opts?.label && <label>{opts.label}</label>}
        <input className="input" value={v} placeholder={opts?.placeholder} onChange={(e) => setV(e.target.value)} autoFocus />
      </form>
    </Modal>
  );
}

// ---------------- Toasts ----------------
type ToastKind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: ToastKind;
  text: ReactNode;
  action?: { label: string; run: () => void };
}
const useToasts = create<{ list: Toast[] }>(() => ({ list: [] }));
let toastSeq = 0;
export function toast(text: ReactNode, kind: ToastKind = 'info', action?: Toast['action'], ms = 3800) {
  const id = ++toastSeq;
  useToasts.setState((s) => ({ list: [...s.list.slice(-3), { id, kind, text, action }] }));
  setTimeout(() => useToasts.setState((s) => ({ list: s.list.filter((t) => t.id !== id) })), ms);
}
export function ToastHost() {
  const list = useToasts((s) => s.list);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('toast', t.kind)}>
          {t.kind === 'success' ? <CheckCircle2 /> : t.kind === 'error' ? <AlertTriangle /> : <Info />}
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                useToasts.setState((s) => ({ list: s.list.filter((x) => x.id !== t.id) }));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

// ---------------- Popover menu ----------------
export function usePopover() {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = (el: HTMLElement) => setAnchor(el.getBoundingClientRect());
  const close = () => setAnchor(null);
  return { anchor, open, close, toggle: (el: HTMLElement) => (anchor ? close() : open(el)) };
}

export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  width,
}: {
  anchor: DOMRect | null;
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    let left = align === 'end' ? anchor.right - r.width : anchor.left;
    left = Math.max(8, Math.min(window.innerWidth - r.width - 8, left));
    let top = anchor.bottom + 6;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, anchor.top - r.height - 6);
    setPos({ left, top });
  }, [anchor, align]);
  useEffect(() => {
    if (!anchor) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const t = setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);
  if (!anchor) return null;
  return createPortal(
    <div ref={ref} className="popover" style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, width }} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({ icon, children, onClick, danger, hint }: { icon?: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; hint?: ReactNode }) {
  return (
    <button type="button" className={cx('menu-item', danger && 'danger')} onClick={onClick}>
      {icon}
      <span className="grow truncate">{children}</span>
      {hint && <span className="hint">{hint}</span>}
    </button>
  );
}

// ---------------- Dropzone ----------------
export function Dropzone({
  onFiles,
  accept = 'application/pdf,.pdf',
  multiple = true,
  title = 'Drop PDFs here',
  hint = 'or click to browse',
  compact,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={cx('dropzone', over && 'over')}
      style={compact ? { padding: 16 } : undefined}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
    >
      {!compact && (
        <div className="dz-icon">
          <Upload size={20} />
        </div>
      )}
      <strong>{title}</strong>
      <span className="small">{hint}</span>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.onchange = () => resolve(i.files?.[0] ?? null);
    i.click();
  });
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="small" style={{ maxWidth: 380 }}>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" />;
}
