// Signature extraction from a photo of ink on paper.
//
// Pipeline (standard "document scan" approach):
//   1. luminance
//   2. estimate the paper brightness locally (coarse max-pool grid, smoothed, bilinear) — this
//      removes shadows, vignetting and uneven lighting from phone photos
//   3. normalize: L / background → paper ≈ 1.0 everywhere, ink stays dark
//   4. ink = 1 - normalized; Otsu's method picks an automatic cut-off
//   5. alpha = soft ramp around the cut-off (keeps anti-aliased edges instead of a harsh, blown-out mask)
//   6. optional despeckle (drop tiny specks), then trim to the ink's bounding box
// The result is a transparent PNG in a chosen ink color, so it sits naturally on any form.

export interface SigOptions {
  threshold: number; // 0..1 — cut-off on the "ink darkness" scale (higher = more cleanup)
  softness: number; // 0..0.5 — width of the edge ramp
  boost: number; // 0.4..3 — ink darkness (alpha gamma)
  color: string; // ink color hex
  despeckle: boolean;
}

export interface Prepared {
  w: number;
  h: number;
  ink: Float32Array; // 0 (paper) .. 1 (darkest ink)
  auto: number; // suggested cut-off: just above the paper's noise floor
  autoSoft: number; // suggested ramp: reaches full ink around the Otsu split
}

export function prepare(img: ImageData): Prepared {
  const { width: w, height: h, data } = img;
  const L = new Float32Array(w * h);
  for (let i = 0, p = 0; i < L.length; i++, p += 4) {
    L[i] = (0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2]) / 255;
  }

  // background estimate on a coarse grid (max of each cell ≈ local paper brightness)
  const cell = Math.max(8, Math.round(Math.min(w, h) / 20));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      // 95th percentile instead of max so a single hot pixel doesn't skew it
      const vals: number[] = [];
      const y1 = Math.min(h, (gy + 1) * cell);
      const x1 = Math.min(w, (gx + 1) * cell);
      for (let y = gy * cell; y < y1; y += 2) for (let x = gx * cell; x < x1; x += 2) vals.push(L[y * w + x]);
      vals.sort((a, b) => a - b);
      grid[gy * gw + gx] = vals[Math.floor(vals.length * 0.95)] ?? 1;
    }
  }
  // smooth grid (3×3 mean, twice)
  let g = grid;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float32Array(g.length);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
            s += g[yy * gw + xx];
            n++;
          }
        out[y * gw + x] = s / n;
      }
    g = out;
  }

  const ink = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, y / cell - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(gh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, x / cell - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(gw - 1, x0 + 1);
      const tx = fx - x0;
      const bg =
        (g[y0 * gw + x0] * (1 - tx) + g[y0 * gw + x1] * tx) * (1 - ty) + (g[y1 * gw + x0] * (1 - tx) + g[y1 * gw + x1] * tx) * ty;
      const n = Math.min(1, L[y * w + x] / Math.max(0.08, bg));
      ink[y * w + x] = 1 - n;
    }
  }
  // Otsu splits paper from ink; the cut-off itself sits just above the paper's own noise so
  // anti-aliased stroke edges and faint lines survive instead of looking thin and broken.
  const split = otsu(ink);
  const hist = new Uint32Array(256);
  let paper = 0;
  for (let i = 0; i < ink.length; i++) {
    if (ink[i] >= split) continue;
    hist[Math.min(255, Math.max(0, Math.round(ink[i] * 255)))]++;
    paper++;
  }
  let acc = 0;
  let noise = 0;
  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (acc >= paper * 0.985) {
      noise = b / 255;
      break;
    }
  }
  const auto = Math.min(split * 0.8, Math.max(0.04, noise + 0.02));
  return { w, h, ink, auto, autoSoft: Math.max(0.06, Math.min(0.4, split - auto)) };
}

/** Otsu's method on a 256-bin histogram of ink darkness. */
export function otsu(v: Float32Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < v.length; i++) hist[Math.min(255, Math.max(0, Math.round(v[i] * 255)))]++;
  const total = v.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 64;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  // Otsu on a mostly-blank page lands low; keep a sensible floor so paper grain is removed
  return Math.min(0.6, Math.max(0.08, thr / 255));
}

function despeckle(alpha: Float32Array, w: number, h: number) {
  const minArea = Math.max(6, Math.round(w * h * 0.00004));
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const comp: number[] = [];
  for (let i = 0; i < alpha.length; i++) {
    if (seen[i] || alpha[i] < 0.25) continue;
    comp.length = 0;
    let count = 0;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    while (sp) {
      const p = stack[--sp];
      if (++count < minArea) comp.push(p); // only small components need their pixels remembered
      const x = p % w;
      const y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const q = yy * w + xx;
          if (!seen[q] && alpha[q] >= 0.25) {
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
    }
    if (count < minArea) for (const p of comp) alpha[p] = 0;
  }
}

export function render(prep: Prepared, o: SigOptions): ImageData {
  const { w, h, ink } = prep;
  const alpha = new Float32Array(w * h);
  const soft = Math.max(0.01, o.softness);
  const lo = o.threshold;
  for (let i = 0; i < ink.length; i++) {
    let a = (ink[i] - lo) / soft;
    a = a <= 0 ? 0 : a >= 1 ? 1 : a * a * (3 - 2 * a); // smoothstep
    if (a > 0) a = 1 - Math.pow(1 - a, o.boost);
    alpha[i] = a;
  }
  if (o.despeckle) despeckle(alpha, w, h);
  const out = new ImageData(w, h);
  const c = o.color.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    out.data[p] = r;
    out.data[p + 1] = g;
    out.data[p + 2] = b;
    out.data[p + 3] = Math.round(alpha[i] * 255);
  }
  return out;
}

/** Crop a canvas to its non-transparent content (+ padding). Returns null if empty. */
export function trimCanvas(src: HTMLCanvasElement, pad = 6): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!;
  const { width: w, height: h } = src;
  const d = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad);
  y1 = Math.min(h - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Downscale a canvas so its longest side is ≤ max. */
export function limitSize(c: HTMLCanvasElement, max = 900): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(c.width, c.height));
  if (s === 1) return c;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.width * s));
  out.height = Math.max(1, Math.round(c.height * s));
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

export async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
