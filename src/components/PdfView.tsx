import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PdfDoc } from '../lib/types';
import { renderPage } from '../lib/pdf/pdfjs';
import { cssFontFamily, cssFontWeight, browserMeasure, fitImage, layoutText } from '../lib/layout';
import type { DrawItem } from '../lib/preview';

/** One rendered PDF page canvas; renders lazily when near the viewport, re-renders when the zoom settles. */
export const PageCanvas = memo(function PageCanvas({ fileId, index, scale, width, height }: { fileId: string; index: number; scale: number; width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [settled, setSettled] = useState(scale);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // debounce zoom so ctrl+wheel stays smooth (old bitmap is CSS-scaled meanwhile)
  useEffect(() => {
    const t = setTimeout(() => setSettled(scale), 140);
    return () => clearTimeout(t);
  }, [scale]);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    const h = renderPage(fileId, index, settled, canvas.current);
    h.promise.then(() => setError(null)).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => h.cancel();
  }, [fileId, index, settled, visible]);

  return (
    <div ref={holder} className="page-canvas" style={{ width: width * scale, height: height * scale }}>
      <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
      {error && <div className="page-error">Couldn't render this page: {error}</div>}
    </div>
  );
});

/** SVG layer that paints values exactly where the PDF writer will put them. */
export const ValueLayer = memo(function ValueLayer({
  items,
  width,
  height,
  scale,
  hideIds,
}: {
  items: DrawItem[];
  width: number;
  height: number;
  scale: number;
  hideIds?: Set<string>;
}) {
  return (
    <svg className="value-layer" width={width * scale} height={height * scale} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {items.map((it, i) => (hideIds?.has(it.mappingId) ? null : <Item key={it.mappingId + ':' + i} it={it} />))}
    </svg>
  );
});

function Item({ it }: { it: DrawItem }) {
  const [x, y, w, h] = it.rect;
  const cover = it.cover ? <rect x={x} y={y} width={w} height={h} fill="#fff" /> : null;
  if (it.kind === 'image') {
    if (!it.image) return cover;
    return (
      <>
        {cover}
        <SvgImage href={it.image} x={x} y={y} w={w} h={h} align={it.style.align} />
      </>
    );
  }
  if (it.kind === 'check') {
    if (!it.checked) return cover;
    const s = Math.min(w, h) * 0.72;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const color = it.style.color || '#000';
    const sw = Math.max(0.8, s * 0.12);
    const mark = it.style.checkMark ?? 'x';
    return (
      <g stroke={color} strokeWidth={sw} strokeLinecap="round" fill="none">
        {cover}
        {mark === 'dot' ? (
          <circle cx={cx} cy={cy} r={s * 0.32} fill={color} stroke="none" />
        ) : mark === 'check' ? (
          <polyline points={`${cx - 0.42 * s},${cy + 0.02 * s} ${cx - 0.12 * s},${cy + 0.34 * s} ${cx + 0.45 * s},${cy - 0.36 * s}`} />
        ) : (
          <>
            <line x1={cx - 0.4 * s} y1={cy - 0.4 * s} x2={cx + 0.4 * s} y2={cy + 0.4 * s} />
            <line x1={cx - 0.4 * s} y1={cy + 0.4 * s} x2={cx + 0.4 * s} y2={cy - 0.4 * s} />
          </>
        )}
      </g>
    );
  }
  if (!it.text) return cover;
  return (
    <>
      {cover}
      <TextLines it={it} />
    </>
  );
}

function TextLines({ it }: { it: DrawItem }) {
  const [x, y, w, h] = it.rect;
  const style = useMemo(() => ({ ...it.style, multiline: !!it.multiline }), [it.style, it.multiline]);
  const lay = useMemo(() => layoutText(it.text!, w, h, style, browserMeasure(style.font)), [it.text, w, h, style]);
  return (
    <text
      fontFamily={cssFontFamily(style.font)}
      fontWeight={cssFontWeight(style.font)}
      fontSize={lay.size}
      fill={style.color || '#111'}
      style={{ whiteSpace: 'pre' }}
    >
      {lay.lines.map((l, i) => (
        <tspan key={i} x={x + l.x} y={y + l.baseline}>
          {l.text}
        </tspan>
      ))}
    </text>
  );
}

function SvgImage({ href, x, y, w, h, align }: { href: string; x: number; y: number; w: number; h: number; align: 'left' | 'center' | 'right' }) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => alive && setDims({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = href;
    return () => {
      alive = false;
    };
  }, [href]);
  if (!dims) return null;
  const f = fitImage(dims.w, dims.h, w, h, align);
  return <image href={href} x={x + f.x} y={y + f.y} width={f.w} height={f.h} preserveAspectRatio="none" />;
}

/** Scrollable stack of pages with an overlay slot per page. */
export function PageStack({
  doc,
  scale,
  overlay,
  className,
  scrollRef,
  onScroll,
}: {
  doc: PdfDoc;
  scale: number;
  overlay?: (page: number) => ReactNode;
  className?: string;
  scrollRef?: React.Ref<HTMLDivElement>;
  onScroll?: () => void;
}) {
  return (
    <div className={'page-scroll ' + (className ?? '')} ref={scrollRef} onScroll={onScroll}>
      <div className="page-stack">
        {doc.pages.map((p, i) => (
          <div key={i} className="page" data-page={i} style={{ width: p.width * scale, height: p.height * scale }}>
            <PageCanvas fileId={doc.fileId} index={i} scale={scale} width={p.width} height={p.height} />
            {overlay?.(i)}
            {doc.pages.length > 1 && <div className="page-num">{i + 1}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Small first-page thumbnail. */
export function Thumb({ doc, width = 120 }: { doc: PdfDoc; width?: number }) {
  const p = doc.pages[0];
  if (!p) return null;
  const scale = width / p.width;
  return (
    <div className="thumb" style={{ width, height: p.height * scale }}>
      <PageCanvas fileId={doc.fileId} index={0} scale={scale} width={p.width} height={p.height} />
    </div>
  );
}

export function useFitScale(container: React.RefObject<HTMLElement | null>, pageWidth: number, pad = 64, max = 2.2) {
  const [fit, setFit] = useState(1);
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - pad;
      if (w > 0 && pageWidth > 0) setFit(Math.min(max, Math.max(0.3, w / pageWidth)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [container, pageWidth, pad, max]);
  return fit;
}
