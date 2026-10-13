// Draws curved "wires" from form-field chips (left panel) to their boxes on the PDF.
// Runs outside React: reads DOM positions in a rAF and writes one SVG's innerHTML.
import type { Mapping } from '../../lib/types';
import { tokensIn } from '../../lib/template';

export interface LinkState {
  mappings: Mapping[];
  colors: Map<string, string>;
  hotKey: string | null;
  hotMapping: string | null;
  enabled: boolean;
}

export class LinkPainter {
  private raf = 0;
  private state: LinkState | null = null;
  constructor(
    private host: HTMLElement,
    private svg: SVGSVGElement,
    private list: () => HTMLElement | null,
    private canvas: () => HTMLElement | null,
  ) {}

  update(s: LinkState) {
    this.state = s;
    this.schedule();
  }

  schedule = () => {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paint();
    });
  };

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  private paint() {
    const s = this.state;
    const list = this.list();
    const canvas = this.canvas();
    if (!s || !list || !canvas || !s.enabled) {
      this.svg.innerHTML = '';
      return;
    }
    const host = this.host.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    this.svg.setAttribute('width', String(host.width));
    this.svg.setAttribute('height', String(host.height));

    const chips = new Map<string, DOMRect>();
    list.querySelectorAll<HTMLElement>('[data-chip-key]').forEach((el) => chips.set(el.dataset.chipKey!, el.getBoundingClientRect()));

    const boxes = new Map<string, DOMRect[]>();
    canvas.querySelectorAll<HTMLElement>('[data-mid]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < cr.top - 40 || r.top > cr.bottom + 40) return;
      const id = el.dataset.mid!;
      boxes.set(id, [...(boxes.get(id) ?? []), r]);
    });

    let cold = '';
    let hot = '';
    let dots = '';
    for (const m of s.mappings) {
      const rects = boxes.get(m.id);
      if (!rects) continue;
      const keys = [...new Set(tokensIn(m.source))];
      for (const key of keys) {
        const chip = chips.get(key);
        if (!chip) continue;
        const color = s.colors.get(key) ?? '#5b5bd6';
        const isHot = s.hotKey === key || s.hotMapping === m.id;
        for (const r of rects) {
          // clamp the start to the visible list area
          const cy = Math.min(lr.bottom - 6, Math.max(lr.top + 6, chip.top + chip.height / 2));
          const offList = cy !== chip.top + chip.height / 2;
          if (offList && !isHot) continue; // scrolled out of the list: only show when highlighted
          const x1 = Math.min(lr.right, chip.right) - host.left;
          const y1 = cy - host.top;
          const bx = Math.max(cr.left, r.left);
          const x2 = bx - host.left;
          const y2 = Math.min(cr.bottom, Math.max(cr.top, r.top + r.height / 2)) - host.top;
          const dx = Math.max(40, (x2 - x1) * 0.45);
          const d = `M${x1.toFixed(1)},${y1.toFixed(1)} C${(x1 + dx).toFixed(1)},${y1.toFixed(1)} ${(x2 - dx).toFixed(1)},${y2.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
          const op = isHot ? 0.95 : 0.34;
          const path = `<path d="${d}" stroke="${color}" stroke-opacity="${op}" stroke-width="${isHot ? 2 : 1.25}" fill="none"${isHot ? ' class="hot"' : ''}/>`;
          if (isHot) {
            hot += path;
            dots += `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3.5" fill="${color}"/><circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="3" fill="${color}"/>`;
          } else cold += path;
        }
      }
    }
    this.svg.innerHTML = cold + hot + dots;
  }
}
