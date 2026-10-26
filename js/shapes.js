// Turns a freehand stroke into a clean shape (line, triangle, rectangle,
// ellipse or polygon) when it looks like one.

function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perp(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}

function perp(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (!len) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
}

const pathLen = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

export function recognize(raw) {
  const pts = raw.map(p => [p[0], p[1]]);
  const L = pathLen(pts);
  if (L < 30) return null;
  const first = pts[0], last = pts[pts.length - 1];
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (chord / L > 0.93) return { kind: 'line', pts: [first, last], closed: false };

  const closed = chord < Math.max(30, L * 0.18);
  let xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
  if (!closed) {
    const s = rdp(pts, L * 0.06);
    if (s.length === 3) return { kind: 'line', pts: s, closed: false };
    return null;
  }
  let corners = rdp(pts, L * 0.045);
  if (corners.length > 2 && Math.hypot(corners[0][0] - corners[corners.length - 1][0], corners[0][1] - corners[corners.length - 1][1]) < Math.max(30, L * 0.12)) {
    corners = corners.slice(0, -1);
  }
  // Ellipse fit: how close is every point to the bbox ellipse?
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2 || 1, ry = (y2 - y1) / 2 || 1;
  let err = 0;
  for (const p of pts) err += Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1);
  err /= pts.length;
  if (corners.length === 3) return { kind: 'polygon', pts: corners, closed: true };
  if (corners.length === 4 && err > 0.07) {
    const axis = corners.every((c, i) => {
      const n = corners[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(n[1] - c[1], n[0] - c[0])) % (Math.PI / 2);
      return ang < 0.3 || ang > Math.PI / 2 - 0.3;
    });
    if (axis) return { kind: 'polygon', pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], closed: true };
    return { kind: 'polygon', pts: corners, closed: true };
  }
  if (err < 0.16) return { kind: 'ellipse', pts: [[x1, y1], [x2, y2]], closed: true };
  if (corners.length >= 5 && corners.length <= 8) return { kind: 'polygon', pts: corners, closed: true };
  return null;
}
