// Pen ink. The curve fitting is adapted from signature_pad by Szymon Nowak
// (MIT, see vendor/signature-pad-LICENSE.txt): every new sample adds one cubic
// Bezier segment through its neighbours, so a stroke is built incrementally and
// a saved stroke replays to exactly the same shape. Width comes from Pencil
// pressure instead of signature_pad's velocity.

const QUANT = 0.05; // width step in page units; runs of equal width share one path

// Stroke width (diameter, page units) for a pressure in 0..1.
export function inkWidth(item, p) {
  if (!item.pressure) return item.pen === 'brush' ? item.width * 1.2 : item.width;
  switch (item.pen) {
    case 'ball': return item.width * (0.85 + 0.3 * p);
    case 'brush': return item.width * (0.15 + 2.1 * Math.pow(p, 1.15));
    default: return item.width * (0.42 + 1.25 * Math.pow(p, 0.8));
  }
}

function controls(s1, s2, s3) {
  const m1x = (s1[0] + s2[0]) / 2, m1y = (s1[1] + s2[1]) / 2;
  const m2x = (s2[0] + s3[0]) / 2, m2y = (s2[1] + s3[1]) / 2;
  const l1 = Math.hypot(s1[0] - s2[0], s1[1] - s2[1]);
  const l2 = Math.hypot(s2[0] - s3[0], s2[1] - s3[1]);
  const k = l1 + l2 === 0 ? 0 : l2 / (l1 + l2);
  const cmx = m2x + (m1x - m2x) * k, cmy = m2y + (m1y - m2y) * k;
  const tx = s2[0] - cmx, ty = s2[1] - cmy;
  return [[m1x + tx, m1y + ty], [m2x + tx, m2y + ty]];
}

// Turns samples into Bezier segments one at a time: segment i ends at sample i,
// and is emitted once sample i+1 is known (finish() emits the last one).
export class InkBuilder {
  constructor(item) {
    this.item = item;
    this.win = [];
    this.w = null;
    this.n = 0;
  }

  push(p) {
    const win = this.win;
    win.push(p);
    this.n++;
    const raw = inkWidth(this.item, p[2] ?? 0.5);
    if (this.w === null) this.w = raw;
    if (win.length < 3) return null;
    if (win.length === 3) win.unshift(win[0]);
    const [a, b, c, d] = win;
    const c2 = controls(a, b, c)[1];
    const c1 = controls(b, c, d)[0];
    const start = this.w;
    this.w = this.w * 0.6 + raw * 0.4;
    // Brush strokes start from a point.
    const ramp = this.item.pen === 'brush' ? Math.min(1, this.n / 8) : 1;
    const w = Math.max(QUANT, Math.round(((start + this.w) / 2) * ramp / QUANT) * QUANT);
    win.shift();
    return { x0: b[0], y0: b[1], c1, c2, x1: c[0], y1: c[1], w };
  }

  finish() {
    const win = this.win;
    if (!win.length) return null;
    return this.push(win[win.length - 1]);
  }
}

// Draws one segment straight onto a context (used live, while writing).
export function strokeSegment(ctx, s, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s.x0, s.y0);
  ctx.bezierCurveTo(s.c2[0], s.c2[1], s.c1[0], s.c1[1], s.x1, s.y1);
  ctx.stroke();
}

const cache = new WeakMap();

// All segments of a finished stroke, grouped into runs of equal width.
function inkRuns(item) {
  const c = cache.get(item);
  if (c && c.pts === item.pts && c.n === item.pts.length && c.w === item.width) return c.runs;
  const b = new InkBuilder(item);
  const segs = [];
  for (const p of item.pts) { const s = b.push(p); if (s) segs.push(s); }
  const last = b.finish();
  if (last) segs.push(last);
  const runs = [];
  let run = null;
  for (const s of segs) {
    if (!run || run.w !== s.w) {
      run = { w: s.w, path: new Path2D() };
      run.path.moveTo(s.x0, s.y0);
      runs.push(run);
    }
    run.path.bezierCurveTo(s.c2[0], s.c2[1], s.c1[0], s.c1[1], s.x1, s.y1);
  }
  cache.set(item, { pts: item.pts, n: item.pts.length, w: item.width, runs });
  return runs;
}

export function drawInk(ctx, item) {
  const pts = item.pts;
  if (pts.length === 1 || (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1])) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], inkWidth(item, pts[0][2] ?? 0.5) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of inkRuns(item)) { ctx.lineWidth = r.w; ctx.stroke(r.path); }
}
