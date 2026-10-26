// Small UI kit: icons, toasts, dialogs, popovers and action menus.
const P = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const icon = {
  back: P('<path d="M15 18l-6-6 6-6"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  pen: P('<path d="M4 20l1.2-4.6L16.6 4a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M14.5 6.2l3.3 3.3"/><path d="M4 20l1.2-4.6 3.4 3.4z" fill="var(--tip, currentColor)" stroke="var(--tip, currentColor)"/>'),
  highlighter: P('<path d="M9 15l-3 3H3v-1.5L6.5 13z" fill="var(--tip, none)" stroke="var(--tip, currentColor)"/><path d="M6.5 13l8.8-8.8a2 2 0 0 1 2.8 0l1.7 1.7a2 2 0 0 1 0 2.8L11 17.5z"/><path d="M14 21h7"/>'),
  eraser: P('<path d="M7 21h13"/><path d="M5.6 15.4l8.5-8.5a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 19H8.2a2 2 0 0 1-1.4-.6L5.6 17.2a1.3 1.3 0 0 1 0-1.8z"/><path d="M9.5 11.5l5 5"/>'),
  lasso: P('<path d="M7 17.5C4.5 16.3 3 14.4 3 12c0-4.4 4-7.5 9-7.5s9 3.1 9 7.5-4 7.5-9 7.5c-1 0-2-.1-2.9-.4"/><circle cx="7.5" cy="18.5" r="1.8"/><path d="M8.5 20c.5 1.2 0 2-1 2"/>'),
  text: P('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
  shapes: P('<rect x="3" y="12" width="9" height="9" rx="1"/><circle cx="16.5" cy="7.5" r="4.5"/>'),
  image: P('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/>'),
  laser: P('<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'),
  hand: P('<path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11"/><path d="M15 10.5V4.5a1.5 1.5 0 0 0-3 0v6"/><path d="M12 10V5.5a1.5 1.5 0 0 0-3 0V13"/><path d="M18 9.5a1.5 1.5 0 0 1 3 0V14a8 8 0 0 1-8 8h-1a7 7 0 0 1-5.6-2.8L3.2 15.7a1.5 1.5 0 0 1 2.3-1.9L9 17"/>'),
  undo: P('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  redo: P('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  mic: P('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  stop: P('<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>'),
  play: P('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  pause: P('<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>'),
  search: P('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  pages: P('<rect x="4" y="3" width="10" height="13" rx="1.5"/><rect x="10" y="8" width="10" height="13" rx="1.5"/>'),
  more: P('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
  share: P('<path d="M12 3v13M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  trash: P('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  folder: P('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  star: P('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  notes: P('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  inbox: P('<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 13h5l1 3h6l1-3h5"/>'),
  sidebar: P('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>'),
  close: P('<path d="M6 6l12 12M18 6L6 18"/>'),
  import: P('<path d="M12 3v12M7.5 10.5L12 15l4.5-4.5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>'),
  bookmark: P('<path d="M6 3h12v18l-6-4-6 4z"/>'),
  paper: P('<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 8h8M8 12h8M8 16h8"/>'),
  divider: P('<path d="M4 6h16M4 12h10M4 18h16"/>'),
  sort: P('<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>'),
  pencil: P('<path d="M12 21l-2-6 8-12 3 2-8 12z"/><path d="M10 15l3 1"/>'),
  zoom: P('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6M11 8v6"/>'),
  copy: P('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  grid: P('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  list: P('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
  tape: P('<path d="M4 9.5L18.5 5l1.5 5L5.5 14.5z" fill="var(--tip, none)" fill-opacity=".35"/><path d="M4 9.5L18.5 5l1.5 5L5.5 14.5zM7 18.5h11"/>'),
  sticker: P('<path d="M20 12.5V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h7.5z"/><path d="M20 12.5h-5.5a2 2 0 0 0-2 2V20"/><circle cx="9" cy="9.5" r=".8" fill="currentColor"/><circle cx="14" cy="9.5" r=".8" fill="currentColor"/><path d="M8.5 13.5c1.5 1.3 3.5 1.3 5 0"/>'),
  cards: P('<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 6V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2"/><path d="M7 13h6"/>'),
  present: P('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8"/><circle cx="12" cy="10" r="1.6" fill="currentColor"/>'),
  settings: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  transcript: P('<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>'),
  outline: P('<path d="M8 6h12M8 12h12M8 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="2.6"/>'),
  moon: P('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  flip: P('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>'),
  link: P('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  ruler: P('<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>'),
};

const root = () => document.getElementById('overlay-root');

export function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? e.style.setProperty(sk, sv) : (e.style[sk] = sv); }
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
}

let toastTimer;
export function toast(msg, ms = 2200) {
  let t = document.getElementById('toast');
  if (!t) { t = el('div', { id: 'toast' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function modal(content, { onClose } = {}) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal' }, content);
  back.append(box);
  const close = v => { back.remove(); onClose && onClose(v); };
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  root().append(back);
  return { box, close };
}

export function prompt(title, value = '', { placeholder = '', ok = 'Save' } = {}) {
  return new Promise(resolve => {
    const input = el('input', { type: 'text', value, placeholder, class: 'field' });
    let done = false;
    const finish = v => { if (done) return; done = true; m.close(); resolve(v); };
    const form = el('form', { class: 'dialog', onsubmit: e => { e.preventDefault(); finish(input.value.trim()); } },
      el('h3', {}, title), input,
      el('div', { class: 'dialog-actions' },
        el('button', { type: 'button', class: 'btn', onclick: () => finish(null) }, 'Cancel'),
        el('button', { type: 'submit', class: 'btn primary' }, ok)));
    const m = modal(form, { onClose: () => { if (!done) { done = true; resolve(null); } } });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}

export function confirm(title, msg = '', { ok = 'OK', danger = false } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; m.close(); resolve(v); };
    const m = modal(el('div', { class: 'dialog' },
      el('h3', {}, title), msg ? el('p', {}, msg) : null,
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'),
        el('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => finish(true) }, ok))),
    { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });
}

export function alertBox(title, msg) {
  return new Promise(resolve => {
    const m = modal(el('div', { class: 'dialog' }, el('h3', {}, title), el('p', {}, msg),
      el('div', { class: 'dialog-actions' }, el('button', { class: 'btn primary', onclick: () => { m.close(); resolve(); } }, 'OK'))));
  });
}

export function sheet(title, content) {
  const m = modal(el('div', { class: 'dialog sheet' },
    el('div', { class: 'sheet-head' }, el('h3', {}, title),
      el('button', { class: 'icon-btn', html: icon.close, onclick: () => m.close() })), content));
  return m;
}

// Popover anchored to an element; returns { close }.
let openPop = null;
export function popover(anchor, content, { cls = '' } = {}) {
  closePopover();
  const back = el('div', { class: 'pop-back' });
  const pop = el('div', { class: 'popover ' + cls }, content);
  back.append(pop);
  root().append(back);
  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let left = r.left + r.width / 2 - pw / 2;
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  let top = r.bottom + 8;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 8);
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  const close = () => { back.remove(); if (openPop === api) openPop = null; };
  back.addEventListener('pointerdown', e => { if (e.target === back) { e.preventDefault(); close(); } });
  const api = { close, el: pop };
  openPop = api;
  return api;
}
export function closePopover() { if (openPop) openPop.close(); }

// Action menu: items = [{label, icon, danger, action}] or '-' separators.
export function menu(anchor, items) {
  const list = el('div', { class: 'menu' });
  const pop = popover(anchor, list);
  for (const it of items) {
    if (it === '-') { list.append(el('div', { class: 'menu-sep' })); continue; }
    if (!it) continue;
    list.append(el('button', {
      class: 'menu-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''),
      onclick: () => { pop.close(); it.action(); },
    }, it.icon ? el('span', { class: 'mi-icon', html: icon[it.icon] || '' }) : el('span', { class: 'mi-icon' }), el('span', {}, it.label)));
  }
  return pop;
}

export function pickFile(accept, multiple = false) {
  return new Promise(resolve => {
    const input = el('input', { type: 'file', accept, style: { display: 'none' } });
    if (multiple) input.multiple = true;
    input.onchange = () => { resolve([...input.files]); input.remove(); };
    document.body.append(input);
    input.click();
  });
}

export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s || 0));
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  return (h ? h + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
}

export const COLORS = ['#1c1c1e', '#5b5f66', '#ffffff', '#e5383b', '#f77f00', '#f6c90e', '#2a9d4b', '#14a3a3', '#1f6feb', '#5e3fd3', '#c13b8d', '#8b5a2b'];
export const HL_COLORS = ['#ffe94d', '#9ef01a', '#5ce1e6', '#ff8fab', '#ffb347', '#c39bff'];
