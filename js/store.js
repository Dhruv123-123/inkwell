// Library-level data operations: notes, subjects, dividers, import/export.
import { db, uid, putBlob, getBlob } from './db.js';
import { PAGE_SIZES, renderPage } from './render.js';

export const SUBJECT_COLORS = ['#e5383b', '#f77f00', '#f6c90e', '#2a9d4b', '#14a3a3', '#1f6feb', '#5e3fd3', '#c13b8d', '#8b5a2b', '#5b5f66'];

export function settings() {
  try { return JSON.parse(localStorage.getItem('inkwell.settings') || '{}'); } catch { return {}; }
}
export function saveSettings(patch) {
  const s = { ...settings(), ...patch };
  try { localStorage.setItem('inkwell.settings', JSON.stringify(s)); } catch {}
  return s;
}

export function newPage(note, size) {
  const [w, h] = PAGE_SIZES[size || note.pageSize || 'letter'];
  return { id: uid(), noteId: note.id, w, h, items: [] };
}

export async function createNote({ title, subjectId = null, template, paper, pageSize, pages } = {}) {
  const s = settings();
  const note = {
    id: uid(),
    title: title || 'Note ' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }),
    subjectId,
    created: Date.now(),
    modified: Date.now(),
    template: template || s.template || 'lined',
    paper: paper || s.paper || 'white',
    pageSize: pageSize || s.pageSize || 'letter',
    pageIds: [],
    favorite: false,
    thumb: null,
    searchText: '',
  };
  const pageObjs = pages && pages.length ? pages.map(p => ({ ...p, id: p.id || uid(), noteId: note.id, items: p.items || [] })) : [newPage(note)];
  note.pageIds = pageObjs.map(p => p.id);
  note.searchText = buildSearchText(note, pageObjs);
  await db.putMany('pages', pageObjs);
  await db.put('notes', note);
  return note;
}

export function buildSearchText(note, pages) {
  const parts = [note.title];
  for (const p of pages) {
    if (p.pdfText) parts.push(p.pdfText);
    for (const it of p.items) if (it.type === 'text' && it.text) parts.push(it.text);
  }
  return parts.join('\n').toLowerCase();
}

export async function loadPages(note) {
  const pages = await db.byIndex('pages', 'noteId', note.id);
  const byId = new Map(pages.map(p => [p.id, p]));
  return note.pageIds.map(id => byId.get(id)).filter(Boolean);
}

export async function deleteNote(note) {
  const pages = await db.byIndex('pages', 'noteId', note.id);
  const recs = await db.byIndex('recordings', 'noteId', note.id);
  const blobIds = [];
  for (const p of pages) {
    if (p.bgBlob) blobIds.push(p.bgBlob);
    for (const it of p.items) if (it.type === 'image') blobIds.push(it.blob);
  }
  for (const r of recs) blobIds.push(r.blob);
  // Blobs can be shared with duplicated notes, so only delete unreferenced ones.
  const stillUsed = await referencedBlobs(note.id);
  await db.delMany('blobs', blobIds.filter(id => !stillUsed.has(id)));
  await db.delMany('pages', pages.map(p => p.id));
  await db.delMany('recordings', recs.map(r => r.id));
  await db.del('notes', note.id);
}

async function referencedBlobs(exceptNoteId) {
  const used = new Set();
  for (const p of await db.all('pages')) {
    if (p.noteId === exceptNoteId) continue;
    if (p.bgBlob) used.add(p.bgBlob);
    for (const it of p.items) if (it.type === 'image') used.add(it.blob);
  }
  for (const r of await db.all('recordings')) if (r.noteId !== exceptNoteId) used.add(r.blob);
  return used;
}

export async function duplicateNote(note) {
  const pages = await loadPages(note);
  const copy = { ...structuredClone(note), id: uid(), title: note.title + ' copy', created: Date.now(), modified: Date.now() };
  const newPages = pages.map(p => ({ ...structuredClone(p), id: uid(), noteId: copy.id }));
  copy.pageIds = newPages.map(p => p.id);
  await db.putMany('pages', newPages);
  const recs = await db.byIndex('recordings', 'noteId', note.id);
  // Recording ids are referenced by items, so keep them stable inside the copy via a map.
  const recMap = new Map();
  const newRecs = recs.map(r => { const id = uid(); recMap.set(r.id, id); return { ...r, id, noteId: copy.id }; });
  if (recMap.size) {
    for (const p of newPages) for (const it of p.items) if (it.rec && recMap.has(it.rec.id)) it.rec = { ...it.rec, id: recMap.get(it.rec.id) };
    await db.putMany('pages', newPages);
  }
  await db.putMany('recordings', newRecs);
  await db.put('notes', copy);
  return copy;
}

// ---- PDF import ----
let pdfjsP = null;
export function loadPdfJs() {
  if (!pdfjsP) {
    pdfjsP = import('../vendor/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
  }
  return pdfjsP;
}

export async function pdfToPages(file, onProgress = () => {}) {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress(i, doc.numPages);
    const pg = await doc.getPage(i);
    const vp1 = pg.getViewport({ scale: 1 });
    // Normalise to our page width and keep aspect ratio.
    const w = 816, h = Math.round((816 * vp1.height) / vp1.width);
    const scale = (w * 2) / vp1.width;
    const vp = pg.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    c.width = c.height = 0;
    let text = '';
    try { const tc = await pg.getTextContent(); text = tc.items.map(t => t.str).join(' '); } catch {}
    pages.push({ w, h, items: [], bgBlob: await putBlob(blob), pdfText: text });
    pg.cleanup();
  }
  await doc.destroy();
  return pages;
}

export async function imageToPage(file) {
  const bmp = await createImageBitmap(file);
  const w = 816, h = Math.round((816 * bmp.height) / bmp.width);
  bmp.close && bmp.close();
  return { w, h, items: [], bgBlob: await putBlob(file) };
}

// ---- export ----
export async function renderPageBlob(page, note, scale = 2, type = 'image/jpeg') {
  const c = document.createElement('canvas');
  c.width = Math.round(page.w * scale); c.height = Math.round(page.h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  await renderPage(ctx, page, note);
  const blob = await new Promise(r => c.toBlob(r, type, 0.9));
  c.width = c.height = 0;
  return blob;
}

export async function makeThumb(page, note) {
  const s = 240 / page.w;
  const c = document.createElement('canvas');
  c.width = 240; c.height = Math.round(page.h * s);
  const ctx = c.getContext('2d');
  ctx.scale(s, s);
  await renderPage(ctx, page, note);
  const url = c.toDataURL('image/jpeg', 0.75);
  c.width = c.height = 0;
  return url;
}

// Build a PDF whose pages are full-resolution JPEG renders.
export async function exportPdf(note, pages, onProgress = () => {}) {
  const enc = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = data => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); offset += b.length; };
  const objStart = n => { offsets[n] = offset; push(`${n} 0 obj\n`); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // objects: 1 catalog, 2 pages, then per page: page, content, image
  const pageObj = i => 3 + i * 3;
  objStart(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objStart(2);
  push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((_, i) => pageObj(i) + ' 0 R').join(' ')}] >>\nendobj\n`);
  for (let i = 0; i < n; i++) {
    onProgress(i + 1, n);
    const p = pages[i];
    const blob = await renderPageBlob(p, note, 2);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const W = (p.w * 0.75).toFixed(2), H = (p.h * 0.75).toFixed(2);
    const io = pageObj(i);
    objStart(io);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${io + 2} 0 R >> >> /Contents ${io + 1} 0 R >>\nendobj\n`);
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
    objStart(io + 1); push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    objStart(io + 2);
    push(`<< /Type /XObject /Subtype /Image /Width ${Math.round(p.w * 2)} /Height ${Math.round(p.h * 2)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`);
    push(bytes);
    push('\nendstream\nendobj\n');
  }
  const total = 3 + n * 3;
  const xref = offset;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info << /Title (${pdfStr(note.title)}) /Producer (Inkwell) >> >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

function pdfStr(s) { return String(s).replace(/[^\x20-\x7e]/g, '').replace(/([()\\])/g, '\\$1'); }

// ---- backup ----
const toB64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

export async function exportBackup(noteIds = null) {
  const out = { app: 'inkwell', version: 1, exported: Date.now() };
  out.dividers = await db.all('dividers');
  out.subjects = await db.all('subjects');
  let notes = await db.all('notes');
  if (noteIds) notes = notes.filter(n => noteIds.includes(n.id));
  const ids = new Set(notes.map(n => n.id));
  out.notes = notes;
  out.pages = (await db.all('pages')).filter(p => ids.has(p.noteId));
  out.recordings = (await db.all('recordings')).filter(r => ids.has(r.noteId));
  const blobIds = new Set();
  for (const p of out.pages) { if (p.bgBlob) blobIds.add(p.bgBlob); for (const it of p.items) if (it.type === 'image') blobIds.add(it.blob); }
  for (const r of out.recordings) blobIds.add(r.blob);
  out.blobs = [];
  for (const id of blobIds) {
    const b = await getBlob(id);
    if (b) out.blobs.push({ id, type: b.type, data: await toB64(b) });
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'inkwell') throw new Error('Not an Inkwell backup file');
  for (const b of data.blobs || []) {
    const bin = Uint8Array.from(atob(b.data), c => c.charCodeAt(0));
    await db.put('blobs', { id: b.id, blob: new Blob([bin], { type: b.type }), type: b.type });
  }
  await db.putMany('dividers', data.dividers || []);
  await db.putMany('subjects', data.subjects || []);
  await db.putMany('pages', data.pages || []);
  await db.putMany('recordings', data.recordings || []);
  await db.putMany('notes', data.notes || []);
  return (data.notes || []).length;
}
