import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Eraser, ImageUp, PenLine, RotateCw, Type, Undo2, Wand2 } from 'lucide-react';
import { Modal, Segmented, Switch, cx, toast } from '../../components/ui';
import { limitSize, loadImage, prepare, render, trimCanvas, type Prepared, type SigOptions } from '../../lib/signature';

type Tab = 'draw' | 'photo' | 'type';
const INKS = [
  { c: '#111111', name: 'Black' },
  { c: '#1b3a8c', name: 'Blue' },
];

function finish(c: HTMLCanvasElement): string | null {
  const t = trimCanvas(c, 8);
  if (!t) return null;
  return limitSize(t, 900).toDataURL('image/png');
}

// ---------------- Draw ----------------
interface Pt {
  x: number;
  y: number;
  w: number;
}
function DrawPad({ ink, canvasRef }: { ink: string; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const strokes = useRef<Pt[][]>([]);
  const current = useRef<Pt[] | null>(null);
  const last = useRef<{ x: number; y: number; t: number } | null>(null);
  const [count, setCount] = useState(0);

  const ctx = () => canvasRef.current!.getContext('2d')!;
  const setup = useCallback(() => {
    const c = canvasRef.current!;
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round';
    g.lineJoin = 'round';
  }, [canvasRef]);

  const drawStroke = useCallback(
    (pts: Pt[], from = 1) => {
      const g = ctx();
      g.strokeStyle = ink;
      g.fillStyle = ink;
      if (pts.length === 1) {
        g.beginPath();
        g.arc(pts[0].x, pts[0].y, pts[0].w / 2, 0, Math.PI * 2);
        g.fill();
        return;
      }
      for (let i = Math.max(1, from); i < pts.length; i++) {
        const p0 = pts[i - 2] ?? pts[i - 1];
        const p1 = pts[i - 1];
        const p2 = pts[i];
        const m0 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        const m1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        g.lineWidth = (p1.w + p2.w) / 2;
        g.beginPath();
        g.moveTo(m0.x, m0.y);
        g.quadraticCurveTo(p1.x, p1.y, m1.x, m1.y);
        g.stroke();
      }
    },
    [ink], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const redraw = useCallback(() => {
    const c = canvasRef.current!;
    ctx().clearRect(0, 0, c.width, c.height);
    for (const s of strokes.current) drawStroke(s);
  }, [canvasRef, drawStroke]);

  useEffect(() => {
    setup();
    redraw();
    const ro = new ResizeObserver(() => {
      setup();
      redraw();
    });
    ro.observe(canvasRef.current!);
    return () => ro.disconnect();
  }, [setup, redraw, canvasRef]);

  const point = (e: React.PointerEvent | PointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const t = performance.now();
    let w = 3.2;
    if (e.pointerType === 'pen' && e.pressure > 0) w = 1.2 + e.pressure * 4;
    else if (last.current) {
      const v = Math.hypot(x - last.current.x, y - last.current.y) / Math.max(1, t - last.current.t); // px/ms
      w = Math.max(1.3, Math.min(4.2, 4.4 - v * 1.6));
      const prev = current.current?.[current.current.length - 1];
      if (prev) w = prev.w * 0.6 + w * 0.4; // smooth width changes
    }
    last.current = { x, y, t };
    return { x, y, w };
  };

  return (
    <div className="draw-wrap">
      <canvas
        ref={canvasRef}
        className="draw-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          last.current = null;
          current.current = [point(e)];
          drawStroke(current.current);
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          const events = (e.nativeEvent as PointerEvent).getCoalescedEvents?.() ?? [e.nativeEvent];
          for (const ev of events) {
            const p = point(ev);
            const prev = current.current[current.current.length - 1];
            if (Math.hypot(p.x - prev.x, p.y - prev.y) < 0.8) continue;
            current.current.push(p);
            drawStroke(current.current, current.current.length - 1);
          }
        }}
        onPointerUp={() => {
          if (current.current) strokes.current.push(current.current);
          current.current = null;
          setCount(strokes.current.length);
        }}
      />
      <div className="draw-guide">
        <span>✕</span>
      </div>
      {count === 0 && <div className="draw-hint">Sign here with your mouse, trackpad or finger</div>}
      <div className="draw-tools">
        <button
          className="btn btn-ghost btn-sm"
          disabled={!count}
          onClick={() => {
            strokes.current.pop();
            setCount(strokes.current.length);
            redraw();
          }}
        >
          <Undo2 /> Undo
        </button>
        <button
          className="btn btn-ghost btn-sm"
          disabled={!count}
          onClick={() => {
            strokes.current = [];
            setCount(0);
            redraw();
          }}
        >
          <Eraser /> Clear
        </button>
      </div>
    </div>
  );
}

// ---------------- Photo ----------------
interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
} // fractions of the image

function PhotoTab({ ink, outRef }: { ink: string; outRef: React.RefObject<HTMLCanvasElement | null> }) {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  const [crop, setCrop] = useState<Crop>({ x: 0.04, y: 0.08, w: 0.92, h: 0.84 });
  const [prep, setPrep] = useState<Prepared | null>(null);
  const [opts, setOpts] = useState<Omit<SigOptions, 'color'>>({ threshold: 0.2, softness: 0.12, boost: 1.4, despeckle: true });
  const autoApplied = useRef(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cropBox = useRef<HTMLDivElement>(null);

  const load = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast('Please choose a photo (JPG, PNG, HEIC exported as JPG…)', 'error');
    try {
      const img = await loadImage(file);
      const c = document.createElement('canvas');
      const s = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * s);
      c.height = Math.round(img.naturalHeight * s);
      const g = c.getContext('2d')!;
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
      autoApplied.current = false;
      setSrc(c);
      setCrop({ x: 0.04, y: 0.08, w: 0.92, h: 0.84 });
    } catch {
      toast("Couldn't read that image.", 'error');
    }
  };

  const rotate = () => {
    if (!src) return;
    const c = document.createElement('canvas');
    c.width = src.height;
    c.height = src.width;
    const g = c.getContext('2d')!;
    g.translate(c.width, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(src, 0, 0);
    setSrc(c);
  };

  // re-prepare when the crop settles
  useEffect(() => {
    if (!src) return;
    const t = setTimeout(() => {
      const x = Math.round(crop.x * src.width);
      const y = Math.round(crop.y * src.height);
      const w = Math.max(8, Math.round(crop.w * src.width));
      const h = Math.max(8, Math.round(crop.h * src.height));
      const data = src.getContext('2d')!.getImageData(x, y, w, h);
      const p = prepare(data);
      setPrep(p);
      if (!autoApplied.current) {
        autoApplied.current = true;
        setOpts((o) => ({ ...o, threshold: p.auto, softness: p.autoSoft }));
      }
    }, 120);
    return () => clearTimeout(t);
  }, [src, crop]);

  useEffect(() => {
    if (!prep || !outRef.current) return;
    const c = outRef.current;
    c.width = prep.w;
    c.height = prep.h;
    c.getContext('2d')!.putImageData(render(prep, { ...opts, color: ink }), 0, 0);
  }, [prep, opts, ink, outRef]);

  const startDrag = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const box = cropBox.current!.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY, c: crop };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / box.width;
      const dy = (ev.clientY - start.y) / box.height;
      let { x, y, w, h } = start.c;
      if (mode === 'move') {
        x = Math.min(1 - w, Math.max(0, x + dx));
        y = Math.min(1 - h, Math.max(0, y + dy));
      } else {
        if (mode.includes('w')) {
          const nx = Math.min(x + w - 0.05, Math.max(0, x + dx));
          w += x - nx;
          x = nx;
        }
        if (mode.includes('e')) w = Math.min(1 - x, Math.max(0.05, w + dx));
        if (mode.includes('n')) {
          const ny = Math.min(y + h - 0.05, Math.max(0, y + dy));
          h += y - ny;
          y = ny;
        }
        if (mode.includes('s')) h = Math.min(1 - y, Math.max(0.05, h + dy));
      }
      setCrop({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (!src) {
    return (
      <div
        className={cx('photo-drop', dragOver && 'over')}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
      >
        <div className="dz-icon">
          <Camera size={22} />
        </div>
        <strong>Upload a photo of your signature</strong>
        <span className="small muted">Sign on plain white paper with a dark pen. Fill the frame, avoid harsh shadows.</span>
        <button className="btn btn-soft btn-sm" type="button">
          <ImageUp /> Choose photo
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void load(f);
          }}
        />
      </div>
    );
  }

  return (
    <div className="photo-tab">
      <div className="photo-cols">
        <div>
          <div className="row small muted" style={{ marginBottom: 6 }}>
            <span className="grow">1 · Drag the box around your signature</span>
            <button className="btn btn-ghost btn-sm" onClick={rotate}>
              <RotateCw /> Rotate
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSrc(null)}>
              Change
            </button>
          </div>
          <div className="crop-stage" ref={cropBox}>
            <img src={src.toDataURL('image/jpeg', 0.85)} alt="" draggable={false} />
            <div
              className="crop-rect"
              style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              onPointerDown={startDrag('move')}
            >
              {(['nw', 'ne', 'sw', 'se'] as const).map((k) => (
                <span key={k} className={`crop-h ${k}`} onPointerDown={startDrag(k)} />
              ))}
            </div>
          </div>
        </div>
        <div>
          <div className="row small muted" style={{ marginBottom: 6 }}>
            <span className="grow">2 · Adjust until the ink is crisp</span>
            <button className="btn btn-ghost btn-sm" onClick={() => prep && setOpts({ threshold: prep.auto, softness: prep.autoSoft, boost: 1.4, despeckle: true })}>
              <Wand2 /> Auto
            </button>
          </div>
          <div className="sig-preview checker">
            <canvas ref={outRef} />
          </div>
          <div className="sliders">
            <label>
              <span>Clean up background</span>
              <input type="range" min={0.02} max={0.7} step={0.005} value={opts.threshold} onChange={(e) => setOpts({ ...opts, threshold: +e.target.value })} />
            </label>
            <label>
              <span>Ink darkness</span>
              <input type="range" min={0.5} max={3} step={0.05} value={opts.boost} onChange={(e) => setOpts({ ...opts, boost: +e.target.value })} />
            </label>
            <label>
              <span>Edge smoothness</span>
              <input type="range" min={0.01} max={0.4} step={0.005} value={opts.softness} onChange={(e) => setOpts({ ...opts, softness: +e.target.value })} />
            </label>
            <div className="row small">
              <span className="grow muted">Remove specks</span>
              <Switch checked={opts.despeckle} onChange={(v) => setOpts({ ...opts, despeckle: v })} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Type ----------------
function TypeTab({ ink, canvasRef }: { ink: string; canvasRef: React.RefObject<HTMLCanvasElement | null> }) {
  const [name, setName] = useState('');
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let alive = true;
    void document.fonts.load('96px "Great Vibes"').then(() => {
      if (!alive) return;
      c.width = 1200;
      c.height = 260;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = ink;
      let size = 120;
      g.font = `${size}px "Great Vibes", cursive`;
      while (g.measureText(name).width > c.width - 60 && size > 30) {
        size -= 4;
        g.font = `${size}px "Great Vibes", cursive`;
      }
      g.textBaseline = 'middle';
      g.fillText(name, 30, c.height / 2 + 8);
    });
    return () => {
      alive = false;
    };
  }, [name, ink, canvasRef]);
  return (
    <div className="col">
      <input className="input" placeholder="Type your full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <div className="sig-preview type-preview">
        <canvas ref={canvasRef} />
      </div>
      <p className="tiny faint">Typed signatures are fine for most carrier paperwork; some shippers require a hand-drawn one.</p>
    </div>
  );
}

export function SignatureDialog({ open, onClose, onSave }: { open: boolean; onClose: () => void; onSave: (dataUrl: string) => void }) {
  const [tab, setTab] = useState<Tab>('draw');
  const [ink, setInk] = useState(INKS[0].c);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const photoRef = useRef<HTMLCanvasElement>(null);
  const typeRef = useRef<HTMLCanvasElement>(null);

  const save = () => {
    const c = tab === 'draw' ? drawRef.current : tab === 'photo' ? photoRef.current : typeRef.current;
    const url = c ? finish(c) : null;
    if (!url) return toast(tab === 'photo' ? 'No ink found — adjust "Clean up background".' : 'Nothing to save yet.', 'error');
    onSave(url);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Your signature"
      description="It's stored only on this computer and placed wherever you map it."
      footer={
        <>
          <div className="row grow">
            <span className="small muted">Ink</span>
            {INKS.map((i) => (
              <button key={i.c} className={cx('ink-swatch', ink === i.c && 'on')} style={{ background: i.c }} onClick={() => setInk(i.c)} aria-label={i.name} data-tip={i.name} data-tip-pos="top" />
            ))}
          </div>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Use signature
          </button>
        </>
      }
    >
      <div className="col" style={{ gap: 14 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'draw', label: 'Draw', icon: <PenLine /> },
            { value: 'photo', label: 'Photo', icon: <Camera /> },
            { value: 'type', label: 'Type', icon: <Type /> },
          ]}
        />
        {open && tab === 'draw' && <DrawPad ink={ink} canvasRef={drawRef} />}
        {open && tab === 'photo' && <PhotoTab ink={ink} outRef={photoRef} />}
        {open && tab === 'type' && <TypeTab ink={ink} canvasRef={typeRef} />}
      </div>
    </Modal>
  );
}
