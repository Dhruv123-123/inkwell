// Drawing of paper, ink and other page items. Shared by the editor,
// thumbnails and PDF export so every surface looks the same.
import { getBlob } from './db.js';

export const PAGE_SIZES = {
  letter: [816, 1056],
  a4: [794, 1123],
  letterLandscape: [1056, 816],
  a4Landscape: [1123, 794],
  square: [900, 900],
};

export const PAPER_COLORS = {
  white: { bg: '#ffffff', line: '#c9d6e8', margin: '#f0a3a3' },
  cream: { bg: '#fbf6e9', line: '#d8cdb3', margin: '#e9a99a' },
  yellow: { bg: '#fdf4b8', line: '#c8c08a', margin: '#e59a8a' },
  gray: { bg: '#eceef1', line: '#c6cad1', margin: '#e3a2a2' },
  dark: { bg: '#24262b', line: '#3f444d', margin: '#7a4a4a' },
  black: { bg: '#0f1012', line: '#2b2e33', margin: '#6a3b3b' },
};

export const TEMPLATES = [
  ['blank', 'Blank'],
  ['lined', 'Lined (college)'],
  ['wide', 'Lined (wide)'],
  ['narrow', 'Lined (narrow)'],
  ['grid', 'Grid'],
  ['smallgrid', 'Small grid'],
  ['dotted', 'Dotted'],
  ['cornell', 'Cornell notes'],
  ['music', 'Music staff'],
  ['planner', 'Daily planner'],
  ['todo', 'Checklist'],
];

export function drawPaper(ctx, w, h, template = 'lined', color = 'white', lineScale = 1) {
  const pc = PAPER_COLORS[color] || PAPER_COLORS.white;
  ctx.fillStyle = pc.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.strokeStyle = pc.line;
  ctx.fillStyle = pc.line;
  ctx.lineWidth = lineScale;
  const hLines = (gap, top = 96, left = 0) => {
    ctx.beginPath();
    for (let y = top; y < h - 24; y += gap) { ctx.moveTo(left, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
  };
  const margin = x => {
    ctx.save(); ctx.strokeStyle = pc.margin; ctx.lineWidth = lineScale; ctx.beginPath();
    ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); ctx.restore();
  };
  const grid = gap => {
    ctx.beginPath();
    for (let x = gap; x < w; x += gap) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
    for (let y = gap; y < h; y += gap) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
    ctx.stroke();
  };
  switch (template) {
    case 'lined': hLines(32); margin(96); break;
    case 'wide': hLines(40); margin(96); break;
    case 'narrow': hLines(24); margin(80); break;
    case 'grid': grid(32); break;
    case 'smallgrid': ctx.globalAlpha = 0.7; grid(16); break;
    case 'dotted':
      for (let y = 24; y < h; y += 24) for (let x = 24; x < w; x += 24) {
        ctx.beginPath(); ctx.arc(x, y, 1.3 * lineScale, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'cornell': {
      hLines(32, 128, 0);
      ctx.save(); ctx.strokeStyle = pc.margin; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(0, 96.5); ctx.lineTo(w, 96.5);
      ctx.moveTo(w * 0.3, 96); ctx.lineTo(w * 0.3, h - 200);
      ctx.moveTo(0, h - 200.5); ctx.lineTo(w, h - 200.5);
      ctx.stroke(); ctx.restore();
      ctx.font = '600 13px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = pc.margin;
      ctx.fillText('CUES', 16, 120); ctx.fillText('NOTES', w * 0.3 + 16, 120); ctx.fillText('SUMMARY', 16, h - 180);
      break;
    }
    case 'music':
      ctx.beginPath();
      for (let top = 110; top + 48 < h - 40; top += 96) {
        for (let i = 0; i < 5; i++) { const y = top + i * 12 + 0.5; ctx.moveTo(48, y); ctx.lineTo(w - 48, y); }
      }
      ctx.stroke();
      break;
    case 'planner': {
      ctx.font = '600 14px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = pc.margin;
      ctx.fillText('DATE', 48, 60);
      ctx.beginPath(); ctx.moveTo(100, 62.5); ctx.lineTo(320, 62.5); ctx.stroke();
      let y = 110;
      ctx.font = '12px -apple-system, system-ui, sans-serif';
      for (let hr = 7; hr <= 21 && y < h - 40; hr++, y += 60) {
        ctx.fillStyle = pc.margin;
        ctx.fillText(((hr - 1) % 12 + 1) + (hr < 12 ? ' AM' : ' PM'), 40, y + 16);
        ctx.beginPath(); ctx.moveTo(100, y + 0.5); ctx.lineTo(w - 40, y + 0.5); ctx.stroke();
        ctx.save(); ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(100, y + 30.5); ctx.lineTo(w - 40, y + 30.5); ctx.stroke(); ctx.restore();
      }
      break;
    }
    case 'todo':
      for (let y = 112; y < h - 40; y += 44) {
        ctx.strokeRect(56.5, y - 16.5, 18, 18);
        ctx.beginPath(); ctx.moveTo(92, y + 4.5); ctx.lineTo(w - 48, y + 4.5); ctx.stroke();
      }
      break;
  }
  ctx.restore();
}

// ---- items ----

// Stroke width at a point, taking pen pressure into account.
export const PEN_TYPES = [['fountain', 'Fountain'], ['ball', 'Ballpoint'], ['brush', 'Brush']];

export function pressureWidth(item, p) {
  if (!item.pressure) return item.width;
  switch (item.pen) {
    case 'ball': return item.width * (0.8 + 0.35 * p);
    case 'brush': return item.width * (0.12 + 1.9 * Math.pow(p, 1.25));
    default: return item.width * (0.25 + 1.1 * Math.pow(p, 0.8));
  }
}

// Brush strokes taper at both ends even without pressure input.
function taper(item, i, n) {
  if (item.pen !== 'brush') return 1;
  const k = Math.min(1, (i + 1) / 7, (n - i) / 7);
  return 0.25 + 0.75 * k;
}

export function drawStroke(ctx, item) {
  const pts = item.pts;
  if (!pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = item.color;
  ctx.fillStyle = item.color;
  if (item.tool === 'highlighter') {
    ctx.globalAlpha = 0.38;
    ctx.lineCap = item.flat ? 'butt' : 'round';
    ctx.lineWidth = item.width;
    ctx.beginPath();
    tracePath(ctx, pts);
    ctx.stroke();
  } else if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0][0], pts[0][1], pressureWidth(item, pts[0][2] ?? 0.5) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (!item.pressure && item.pen !== 'brush') {
    ctx.lineWidth = item.width;
    ctx.beginPath();
    tracePath(ctx, pts);
    ctx.stroke();
  } else {
    // Variable width: one short curved segment per point pair.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const prev = i > 1 ? pts[i - 2] : a;
      ctx.lineWidth = pressureWidth(item, (a[2] + b[2]) / 2) * taper(item, i, pts.length);
      ctx.beginPath();
      const m1x = (prev[0] + a[0]) / 2, m1y = (prev[1] + a[1]) / 2;
      const m2x = (a[0] + b[0]) / 2, m2y = (a[1] + b[1]) / 2;
      if (i === 1) { ctx.moveTo(a[0], a[1]); ctx.lineTo(m2x, m2y); }
      else { ctx.moveTo(m1x, m1y); ctx.quadraticCurveTo(a[0], a[1], m2x, m2y); }
      if (i === pts.length - 1) ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function tracePath(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 1) { ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); return; }
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

export function drawShape(ctx, item) {
  ctx.save();
  ctx.strokeStyle = item.color;
  ctx.lineWidth = item.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (item.dash) ctx.setLineDash([item.width * 3, item.width * 2.5]);
  const p = item.pts;
  ctx.beginPath();
  if (item.kind === 'ellipse') {
    const [a, b] = p;
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    ctx.ellipse(cx, cy, Math.abs(b[0] - a[0]) / 2 || 0.5, Math.abs(b[1] - a[1]) / 2 || 0.5, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
    if (item.closed) ctx.closePath();
  }
  if (item.fill) { ctx.fillStyle = item.fill; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; }
  ctx.stroke();
  if (item.kind === 'arrow' && p.length >= 2) {
    const a = p[p.length - 2], b = p[p.length - 1];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const L = Math.max(12, item.width * 4);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b[0] - L * Math.cos(ang - 0.45), b[1] - L * Math.sin(ang - 0.45));
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(b[0] - L * Math.cos(ang + 0.45), b[1] - L * Math.sin(ang + 0.45));
    ctx.stroke();
  }
  ctx.restore();
}

export const FONTS = {
  sans: '-apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Menlo, "SF Mono", Consolas, monospace',
  marker: '"Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive',
  hand: '"Noteworthy", "Bradley Hand", "Segoe Print", cursive',
};

export function textFont(item) {
  return `${item.bold ? '700 ' : ''}${item.italic ? 'italic ' : ''}${item.size}px ${FONTS[item.font] || FONTS.sans}`;
}

export function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (ctx.measureText(test).width > maxW && line.trim()) { lines.push(line.trimEnd()); line = w.trimStart(); }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export function drawText(ctx, item) {
  ctx.save();
  ctx.font = textFont(item);
  ctx.textBaseline = 'top';
  const lh = item.size * 1.3;
  const lines = wrapText(ctx, item.text || '', item.w - 8);
  if (item.bg) {
    ctx.fillStyle = item.bg;
    ctx.fillRect(item.pts[0][0], item.pts[0][1], item.w, lines.length * lh + 8);
  }
  ctx.fillStyle = item.color;
  lines.forEach((ln, i) => ctx.fillText(ln, item.pts[0][0] + 4, item.pts[0][1] + 4 + i * lh + item.size * 0.1));
  ctx.restore();
}

const imageCache = new Map();
export async function loadImage(blobId) {
  if (imageCache.has(blobId)) return imageCache.get(blobId);
  const p = (async () => {
    const blob = await getBlob(blobId);
    if (!blob) return null;
    try { return await createImageBitmap(blob); }
    catch {
      return await new Promise(res => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => res(null);
        img.src = URL.createObjectURL(blob);
      });
    }
  })();
  imageCache.set(blobId, p);
  // Keep the cache small: big PDF page bitmaps add up fast on iPad.
  if (imageCache.size > 40) {
    const first = imageCache.keys().next().value;
    imageCache.get(first).then(b => b && b.close && b.close());
    imageCache.delete(first);
  }
  return p;
}

export function drawImageItem(ctx, item, bmp) {
  const [a, b] = item.pts;
  if (!bmp) {
    ctx.save(); ctx.fillStyle = '#ddd'; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.restore();
    return;
  }
  ctx.drawImage(bmp, a[0], a[1], b[0] - a[0], b[1] - a[1]);
}

export const TAPE_COLORS = ['#f4a6b8', '#9fd3f5', '#b9e4a8', '#ffd98a', '#c9b6f2', '#cfcfd4'];

export function drawTape(ctx, item) {
  const [a, b] = item.pts;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const w = item.width;
  ctx.save();
  ctx.translate(a[0], a[1]);
  ctx.rotate(ang);
  ctx.beginPath();
  // Torn, zig-zag ends like real washi tape.
  const z = Math.max(3, w / 8);
  ctx.moveTo(0, -w / 2);
  ctx.lineTo(len, -w / 2);
  for (let y = -w / 2, k = 0; y < w / 2; y += z, k++) ctx.lineTo(len + (k % 2 ? 0 : z * 0.8), Math.min(w / 2, y + z));
  ctx.lineTo(0, w / 2);
  for (let y = w / 2, k = 0; y > -w / 2; y -= z, k++) ctx.lineTo(k % 2 ? 0 : -z * 0.8, Math.max(-w / 2, y - z));
  ctx.closePath();
  if (item.revealed) {
    ctx.globalAlpha = 0.22; ctx.fillStyle = item.color; ctx.fill();
    ctx.globalAlpha = 0.8; ctx.setLineDash([4, 3]); ctx.strokeStyle = item.color; ctx.lineWidth = 1.2; ctx.stroke();
  } else {
    ctx.fillStyle = item.color; ctx.fill();
    ctx.clip();
    ctx.globalAlpha = 0.18; ctx.strokeStyle = '#fff'; ctx.lineWidth = w / 6;
    ctx.beginPath();
    for (let x = -w; x < len + w; x += w / 2.2) { ctx.moveTo(x, -w / 2); ctx.lineTo(x + w * 0.7, w / 2); }
    ctx.stroke();
  }
  ctx.restore();
}

export function drawItem(ctx, item, images, opts = {}) {
  if (opts.alphaFor) {
    const al = opts.alphaFor(item);
    if (al <= 0) return;
    ctx.save(); ctx.globalAlpha = al;
  }
  switch (item.type) {
    case 'stroke': drawStroke(ctx, item); break;
    case 'shape': drawShape(ctx, item); break;
    case 'image': drawImageItem(ctx, item, images.get(item.blob)); break;
    case 'text': if (!opts.skipText) drawText(ctx, item); break;
    case 'tape': drawTape(ctx, opts.forExport ? { ...item, revealed: false } : item); break;
  }
  if (opts.alphaFor) ctx.restore();
}

// Render a whole page (paper + items) into ctx at page units.
export async function renderPage(ctx, page, note, opts = {}) {
  const images = new Map();
  const ids = page.items.filter(i => i.type === 'image').map(i => i.blob);
  if (page.bgBlob) ids.push(page.bgBlob);
  await Promise.all(ids.map(async id => images.set(id, await loadImage(id))));
  drawBackground(ctx, page, note, images);
  for (const it of page.items) drawItem(ctx, it, images, opts);
}

export function drawBackground(ctx, page, note, images) {
  const tpl = page.template || note.template;
  const col = page.paper || note.paper;
  if (page.bgBlob) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, page.w, page.h);
    const bmp = images.get(page.bgBlob);
    if (bmp) ctx.drawImage(bmp, 0, 0, page.w, page.h);
  } else {
    drawPaper(ctx, page.w, page.h, tpl, col);
  }
}

// ---- geometry ----
export function itemBBox(item) {
  if (item.type === 'text') {
    const [x, y] = item.pts[0];
    return [x, y, x + item.w, y + (item.hh || item.size * 1.6)];
  }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of item.pts) {
    if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0];
    if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1];
  }
  const pad = (item.width || 0) / 2;
  return [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
}

export function distToSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((px - a[0]) * dx + (py - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx, y = a[1] + t * dy;
  return Math.hypot(px - x, py - y);
}

export function hitItem(item, x, y, r) {
  const bb = itemBBox(item);
  if (x < bb[0] - r || x > bb[2] + r || y < bb[1] - r || y > bb[3] + r) return false;
  if (item.type === 'image' || item.type === 'text') return true;
  if (item.type === 'shape' && item.kind === 'ellipse') {
    const [a, b] = item.pts;
    const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    const rx = Math.abs(b[0] - a[0]) / 2 || 1, ry = Math.abs(b[1] - a[1]) / 2 || 1;
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return Math.abs(d - 1) * Math.min(rx, ry) < r + item.width / 2 || (item.fill && d < 1);
  }
  const pts = item.pts;
  const rr = r + (item.width || 2) / 2;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) < rr;
  for (let i = 1; i < pts.length; i++) if (distToSeg(x, y, pts[i - 1], pts[i]) < rr) return true;
  if (item.closed && distToSeg(x, y, pts[pts.length - 1], pts[0]) < rr) return true;
  return false;
}

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function transformItem(item, s, tx, ty, ox = 0, oy = 0) {
  item.pts = item.pts.map(p => {
    const q = [ox + (p[0] - ox) * s + tx, oy + (p[1] - oy) * s + ty];
    if (p.length > 2) q.push(...p.slice(2));
    return q;
  });
  if (item.width) item.width *= s;
  if (item.type === 'text') { item.w *= s; item.size *= s; }
}
