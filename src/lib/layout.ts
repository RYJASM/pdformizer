// Shared text layout so the on-screen preview and the generated PDF place text identically.
import type { TextStyle } from './types';

export type Measure = (text: string, size: number) => number; // width in points

export interface LaidLine {
  text: string;
  x: number; // from rect left
  baseline: number; // from rect top
  width: number;
}

export interface TextLayout {
  size: number;
  lines: LaidLine[];
  overflow: boolean;
}

export const PAD = 2;
export const LINE_HEIGHT = 1.15;
export const ASCENT = 0.78;
const MAX_AUTO = 12;
const MIN_SIZE = 4;

function wrap(text: string, maxW: number, size: number, measure: Measure): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const candidate = line ? line + ' ' + word : word;
      if (measure(candidate, size) <= maxW) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      line = '';
      if (measure(word, size) <= maxW) {
        line = word;
        continue;
      }
      // a single word wider than the box: hard-break it
      for (const ch of word) {
        if (line && measure(line + ch, size) > maxW) {
          out.push(line);
          line = ch;
        } else line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

export function layoutText(text: string, w: number, h: number, style: TextStyle, measure: Measure): TextLayout {
  const innerW = Math.max(1, w - PAD * 2);
  const innerH = Math.max(1, h - PAD * 2);
  const multiline = style.multiline || text.includes('\n');
  let size = style.size;
  let lines: string[];

  if (!multiline) {
    const flat = text;
    if (!size) {
      size = Math.min(MAX_AUTO, innerH / LINE_HEIGHT + 0.5, h * 0.8);
      const w1 = measure(flat, 1);
      if (w1 > 0) size = Math.min(size, innerW / w1);
      size = Math.max(MIN_SIZE, Math.floor(size * 4) / 4);
    }
    lines = [flat];
  } else if (!size) {
    size = Math.min(MAX_AUTO, Math.max(MIN_SIZE, innerH / LINE_HEIGHT));
    for (;;) {
      lines = wrap(text, innerW, size, measure);
      if (lines.length * size * LINE_HEIGHT <= innerH + 0.5 || size <= MIN_SIZE) break;
      size = Math.max(MIN_SIZE, size - 0.5);
    }
  } else {
    lines = wrap(text, innerW, size, measure);
  }

  const laid: LaidLine[] = [];
  const lh = size * LINE_HEIGHT;
  const firstBaseline = multiline ? PAD + size * ASCENT : h / 2 + size * 0.34;
  lines.forEach((t, i) => {
    const width = measure(t, size);
    let x = PAD;
    if (style.align === 'center') x = (w - width) / 2;
    else if (style.align === 'right') x = w - PAD - width;
    laid.push({ text: t, x, baseline: firstBaseline + i * lh, width });
  });
  const overflow =
    (multiline && lines.length * lh > innerH + 1) || laid.some((l) => l.width > innerW + 0.5);
  return { size, lines: laid, overflow };
}

export function fitImage(imgW: number, imgH: number, w: number, h: number, align: TextStyle['align']) {
  const s = Math.min(w / imgW, h / imgH);
  const dw = imgW * s;
  const dh = imgH * s;
  const x = align === 'left' ? 0 : align === 'right' ? w - dw : (w - dw) / 2;
  return { x, y: (h - dh) / 2, w: dw, h: dh };
}

// ---- Browser-side measurement (Arial/Helvetica share metrics) ----
const CSS_FONT: Record<TextStyle['font'], string> = {
  helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
  'helvetica-bold': 'Helvetica, Arial, "Liberation Sans", sans-serif',
  times: '"Times New Roman", Times, "Liberation Serif", serif',
  courier: '"Courier New", Courier, "Liberation Mono", monospace',
};
export const cssFontFamily = (f: TextStyle['font']) => CSS_FONT[f];
export const cssFontWeight = (f: TextStyle['font']) => (f === 'helvetica-bold' ? 700 : 400);

let ctx2d: CanvasRenderingContext2D | null = null;
const cache = new Map<string, number>();
export function browserMeasure(font: TextStyle['font']): Measure {
  return (text, size) => {
    const k = font + '\u0000' + text;
    let w1 = cache.get(k);
    if (w1 === undefined) {
      ctx2d ??= document.createElement('canvas').getContext('2d');
      if (!ctx2d) return text.length * size * 0.5;
      ctx2d.font = `${cssFontWeight(font)} 100px ${CSS_FONT[font]}`;
      w1 = ctx2d.measureText(text).width / 100;
      if (cache.size > 5000) cache.clear();
      cache.set(k, w1);
    }
    return w1 * size;
  };
}
