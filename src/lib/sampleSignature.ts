// A plausible hand-drawn signature for the sample workspace and mapping previews.
export function sampleSignature(): string {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 200;
  const ctx = c.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1b2a5c';
  const stroke = (pts: [number, number][], w: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
    ctx.stroke();
  };
  // "A"
  stroke([[40, 160], [62, 110], [84, 52], [96, 34], [104, 60], [116, 118], [128, 160]], 5);
  stroke([[58, 118], [92, 112], [140, 104]], 4);
  // cursive body: a trochoid gives natural loops
  const pts: [number, number][] = [];
  for (let t = 0; t <= Math.PI * 13; t += 0.18) {
    const x = 160 + t * 21 - 12 * Math.sin(t);
    const y = 122 - 26 * Math.cos(t) * (0.75 + 0.25 * Math.sin(t * 0.37)) - t * 1.2;
    pts.push([x, y]);
  }
  stroke(pts, 4);
  // flourish underline
  stroke([[150, 172], [260, 168], [380, 160], [520, 150], [600, 140]], 3);
  return c.toDataURL('image/png');
}
