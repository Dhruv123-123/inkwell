// The note editor: page layout, input handling, tools, undo/redo and saving.
import { db, uid, putBlob, getBlob } from './db.js';
import {
  drawBackground, drawItem, drawStroke, drawShape, loadImage, itemBBox, hitItem, distToSeg,
  pointInPoly, transformItem, TEMPLATES, PAPER_COLORS, PAGE_SIZES, FONTS, textFont,
  PEN_TYPES, TAPE_COLORS, drawTape, drawPaper,
} from './render.js';
import { recognize } from './shapes.js';
import { InkBuilder, strokeSegment } from './ink.js';
import {
  icon, el, toast, menu, popover, closePopover, prompt, confirm, sheet, pickFile,
  shareOrDownload, COLORS, HL_COLORS, fmtTime,
} from './ui.js';
import {
  settings, saveSettings, newPage, loadPages, buildSearchText, pdfToPages, imageToPage,
  exportPdf, renderPageBlob, makeThumb, exportBackup,
} from './store.js';
import { AudioPanel } from './audio.js';

const MAX_PX = 8_000_000; // per-canvas pixel budget (iPad Safari canvas memory is limited)
const DRAW_TOOLS = new Set(['pen', 'highlighter', 'eraser', 'lasso', 'shape', 'text', 'laser', 'tape']);

const DEFAULT_TOOLS = {
  pen: { color: '#1c1c1e', width: 2.4, pressure: true, pen: 'fountain', colors: ['#1c1c1e', '#1f6feb', '#e5383b'], sizes: [1.4, 2.4, 4.2] },
  highlighter: { color: '#ffe94d', width: 18, straight: false, colors: ['#ffe94d', '#9ef01a', '#ff8fab'], sizes: [10, 18, 28] },
  eraser: { mode: 'stroke', size: 16, sizes: [8, 16, 34] },
  shape: { kind: 'auto', color: '#1c1c1e', width: 2.4, fill: null, dash: false, colors: ['#1c1c1e', '#1f6feb', '#e5383b'], sizes: [1.5, 2.5, 4.5] },
  text: { font: 'sans', size: 20, color: '#1c1c1e', bold: false, colors: ['#1c1c1e', '#1f6feb', '#e5383b'], sizes: [14, 20, 32] },
  laser: { color: '#ff2d55', colors: ['#ff2d55', '#0a84ff', '#34c759'] },
  tape: { color: '#f4a6b8', width: 26, colors: ['#f4a6b8', '#9fd3f5', '#ffd98a'], sizes: [16, 26, 40] },
};

const EMOJI = '⭐️ ✅ ❌ ❗️ ❓ 💡 📌 📎 🔥 ✨ 💯 👍 👏 🙌 😀 😂 🥰 😎 🤔 😴 🎉 🎯 🏆 🚀 📚 📝 ✏️ 📐 🧪 🧬 🔬 🌍 🎵 ☕️ 🍎 🌸 🌈 ☀️ 🌙 ❤️ 💙 💚 💛 💜 🖤 ➡️ ⬅️ ⬆️ ⬇️ ↩️ 🔁 ⚠️ 🚫 ⏰ 📅 💬 🔑 🧠 💪'.split(' ');
const STICKY = ['#fff59d', '#ffcc80', '#f8bbd0', '#b3e5fc', '#c5e1a5', '#d1c4e9'];

function canvasBlob(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'));
  return new Promise(r => c.toBlob(r, 'image/png'));
}

const emojiBlob = em => canvasBlob(256, 256, ctx => {
  ctx.font = '200px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(em, 128, 140);
});

const stickyBlob = color => canvasBlob(440, 440, ctx => {
  ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(20, 16); ctx.lineTo(420, 16); ctx.lineTo(420, 380); ctx.quadraticCurveTo(400, 420, 330, 420); ctx.lineTo(20, 420); ctx.closePath(); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(0,0,0,.05)'; ctx.fillRect(20, 16, 400, 40);
});

export class Editor {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('editor');
    const s = settings();
    this.tools = structuredClone(DEFAULT_TOOLS);
    for (const k of Object.keys(this.tools)) Object.assign(this.tools[k], (s.tools || {})[k] || {});
    this.tool = s.tool || 'pen';
    this.pencilOnly = !!s.pencilOnly;
    this.shapeHold = s.shapeHold !== false;
    this.zoom = 1;
    this.clipboard = null;
    this.bindGlobal();
  }

  // ---------- lifecycle ----------
  async open(note) {
    this.note = note;
    this.pages = await loadPages(note);
    for (const p of this.pages) for (const it of p.items) if (!it.id) it.id = uid();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = new Set();
    this.noteDirty = false;
    this.sel = null;
    this.zoom = 1;
    this.recording = null;
    this.horizontal = settings().scrollDir === 'horizontal';
    this.adaptInk();
    this.buildDom();
    this.audio = new AudioPanel(this);
    await this.audio.load();
    this.layout();
    this.updateUndoButtons();
    this.selectTool(this.tool === 'laser' ? 'pen' : this.tool);
    this.renderTabs();
  }

  // Swap near-black ink for white on dark paper (and back on light paper) so the default pen is always visible.
  adaptInk() {
    const p = this.pages[0];
    const paper = (p && p.paper) || this.note.paper;
    const dark = !(p && p.bgBlob) && (paper === 'dark' || paper === 'black');
    const lum = c => { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return .5; const n = parseInt(m[1], 16); return ((n >> 16) * .299 + ((n >> 8) & 255) * .587 + (n & 255) * .114) / 255; };
    const flip = c => dark ? (lum(c) < .2 ? '#f5f5f7' : c) : (lum(c) > .92 ? '#1c1c1e' : c);
    for (const t of ['pen', 'shape', 'text']) {
      const o = this.tools[t];
      o.color = flip(o.color);
      if (o.colors) o.colors = o.colors.map(flip);
    }
  }

  async close() {
    if (!this.note) return;
    if (this.recording) await this.audio.stopRecording();
    this.audio.destroy();
    this.endTextEdit();
    await this.flush();
    try {
      if (this.pages[0] && this.thumbStale !== false) {
        this.note.thumb = await makeThumb(this.pages[0], this.note);
        await db.put('notes', this.note);
      }
    } catch (e) { console.warn(e); }
    this.io && this.io.disconnect();
    this.root.innerHTML = '';
    this.root.classList.remove('presenting');
    this.pageEls = new Map();
    this.note = null;
  }

  // ---------- DOM ----------
  buildDom() {
    this.root.innerHTML = '';
    const ib = (name, title, onclick, cls = '') => el('button', { class: 'icon-btn ' + cls, title, 'aria-label': title, html: icon[name], onclick });
    this.undoBtn = ib('undo', 'Undo', () => this.undo());
    this.redoBtn = ib('redo', 'Redo', () => this.redo());
    this.toolBtns = {};
    const toolDefs = [['pen', 'pen', 'Pen'], ['highlighter', 'highlighter', 'Highlighter'], ['eraser', 'eraser', 'Eraser'],
      ['lasso', 'lasso', 'Lasso'], ['shape', 'shapes', 'Shapes'], ['text', 'text', 'Text'], ['tape', 'tape', 'Tape'],
      ['laser', 'laser', 'Laser pointer'], ['hand', 'hand', 'Scroll']];
    const tools = el('div', { class: 'tool-group' });
    for (const [t, ic, title] of toolDefs) {
      const b = el('button', { class: 'icon-btn tool', title, 'aria-label': title, html: icon[ic], onclick: e => this.onToolButton(t, e.currentTarget) });
      this.toolBtns[t] = b;
      tools.append(b);
      if (t === 'tape') tools.append(
        el('button', { class: 'icon-btn tool', title: 'Insert image', html: icon.image, onclick: () => this.insertImage() }),
        el('button', { class: 'icon-btn tool', title: 'Stickers & elements', html: icon.sticker, onclick: e => this.stickerPicker(e.currentTarget) }));
    }
    this.swatches = el('div', { class: 'swatches' });
    this.sizesEl = el('div', { class: 'sizes' });
    this.micBtn = el('button', { class: 'icon-btn mic', title: 'Record audio', html: icon.mic, onclick: () => this.audio.toggleRecord() });
    this.recTime = el('span', { class: 'rec-time' });
    this.tabsEl = el('div', { class: 'tabs' });
    const nav = el('header', { class: 'ed-nav' },
      el('div', { class: 'ed-nav-left' },
        ib('grid', 'Library', () => this.app.showLibrary()),
        ib('pages', 'Pages & outline', () => this.toggleThumbs()),
        ib('search', 'Search in note', () => this.toggleSearch())),
      this.tabsEl,
      el('div', { class: 'ed-nav-right' },
        this.recTime, this.micBtn,
        ib('present', 'Present', () => this.togglePresent()),
        ib('share', 'Share & export', e => this.shareMenu(e.currentTarget)),
        ib('more', 'More', e => this.moreMenu(e.currentTarget))));
    this.grip = el('button', { class: 'icon-btn tool-grip', title: 'Drag to move the toolbar', 'aria-label': 'Move toolbar', html: icon.grip });
    const toolbar = this.toolbar = el('div', { class: 'ed-tools' },
      this.grip, this.undoBtn, this.redoBtn, el('span', { class: 'bar-sep' }), tools, el('span', { class: 'bar-sep' }), this.swatches, this.sizesEl);

    this.pagesEl = el('div', { class: 'pages' + (this.horizontal ? ' horizontal' : '') });
    if (this.horizontal) Object.assign(this.pagesEl.style, { flexDirection: 'row', alignItems: 'center', minHeight: '100%', padding: '16px 40px' });
    this.scroller = el('div', { class: 'scroller' + (this.horizontal ? ' horizontal' : '') }, this.pagesEl);
    this.thumbsEl = el('aside', { class: 'side-panel hidden' });
    this.searchEl = el('aside', { class: 'search-panel hidden' });
    this.pageNum = el('div', { class: 'page-num' });
    this.audioBar = el('div', { class: 'audio-bar hidden' });
    const body = el('div', { class: 'ed-body' }, this.thumbsEl, el('div', { class: 'scroll-wrap' }, this.scroller, this.pageNum, this.audioBar), this.searchEl);
    this.root.append(nav, toolbar, body);
    this.scrollWrap = body.querySelector('.scroll-wrap');
    this.dockHint = el('div', { class: 'dock-hint hidden' });
    this.scrollWrap.append(this.dockHint);
    this.applyDock(settings().toolbarDock || 'top');
    this.bindGrip();
    this.root.addEventListener('gesturestart', e => e.preventDefault());

    this.live = el('canvas', { class: 'live' });
    this.liveCtx = this.live.getContext('2d', { desynchronized: true }) || this.live.getContext('2d');
    // The pen tip: the short, not-yet-fitted end of the stroke, redrawn every event.
    this.tip = el('canvas', { class: 'live' });
    this.tipCtx = this.tip.getContext('2d', { desynchronized: true }) || this.tip.getContext('2d');
    this.selBox = el('div', { class: 'sel-box' }, el('div', { class: 'sel-handle' }));

    this.scroller.addEventListener('pointerdown', e => this.onDown(e));
    this.scroller.addEventListener('pointermove', e => this.onMove(e));
    this.scroller.addEventListener('pointerup', e => this.onUp(e));
    this.scroller.addEventListener('pointercancel', e => this.onUp(e, true));
    this.scroller.addEventListener('touchstart', e => this.onTouchStart(e), { passive: false });
    this.scroller.addEventListener('touchmove', e => this.onTouchMove(e), { passive: false });
    this.scroller.addEventListener('touchend', e => this.onTouchEnd(e), { passive: false });
    this.scroller.addEventListener('touchcancel', e => this.onTouchEnd(e), { passive: false });
    this.scroller.addEventListener('scroll', () => this.onScroll(), { passive: true });
    this.scroller.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    this.scroller.addEventListener('contextmenu', e => e.preventDefault());

    this.pageEls = new Map();
    this.io = new IntersectionObserver(entries => {
      for (const en of entries) {
        const pe = this.pageEls.get(en.target.dataset.id);
        if (!pe) continue;
        if (en.isIntersecting) this.mount(pe); else this.unmount(pe);
      }
    }, { root: this.scroller, rootMargin: this.horizontal ? '0px 60%' : '60% 0px' });
    this.rebuildPages();
  }

  async renderTabs() {
    if (!this.tabsEl) return;
    const notes = await this.app.tabNotes();
    this.tabsEl.innerHTML = '';
    for (const n of notes) {
      const active = this.note && n.id === this.note.id;
      const subj = this.app.subjects?.find(s => s.id === n.subjectId);
      const tab = el('div', { class: 'tab' + (active ? ' active' : ''), title: n.title, onclick: () => { if (active) this.rename(); else this.app.openNote(n, true); } },
        subj ? el('span', { class: 'dot', style: { background: subj.color } }) : null,
        el('span', { class: 'tab-title' }, n.title),
        el('button', { class: 'tab-x', html: icon.close, title: 'Close tab', onclick: e => { e.stopPropagation(); this.app.closeTab(n.id); } }));
      if (active) this.titleEl = tab.querySelector('.tab-title');
      this.tabsEl.append(tab);
    }
    const act = this.tabsEl.querySelector('.tab.active');
    if (act) act.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  rebuildPages() {
    this.io.disconnect();
    this.pagesEl.innerHTML = '';
    this.pageEls.clear();
    this.pages.forEach((p, i) => {
      const canvas = el('canvas', { class: 'page-canvas' });
      const textLayer = el('div', { class: 'text-layer' });
      const node = el('div', { class: 'page', 'data-id': p.id }, canvas, textLayer, el('div', { class: 'page-label' }, String(i + 1)),
        p.bookmark ? el('div', { class: 'page-bm', title: p.bookmarkTitle || 'Bookmarked' }) : null);
      const pe = { page: p, el: node, canvas, textLayer, mounted: false, token: 0 };
      this.pageEls.set(p.id, pe);
      this.pagesEl.append(node);
      this.io.observe(node);
    });
    this.pagesEl.append(el('button', { class: 'add-page', onclick: () => this.addPage(this.pages.length) }, el('span', { html: icon.plus }), 'Add page'));
    this.layout();
    if (!this.thumbsEl.classList.contains('hidden')) this.renderThumbs();
  }

  get scale() { return this.fit * this.zoom; }

  layout() {
    if (!this.scroller) return;
    const maxW = Math.max(...this.pages.map(p => p.w), 816);
    const avail = (this.scroller.clientWidth || innerWidth) - (this.dock === 'left' || this.dock === 'right' ? 72 : 0);
    this.fit = Math.min(1.6, Math.max(0.3, (avail - 32) / maxW));
    if (this.horizontal) {
      // Page-by-page mode: fit the whole page on screen.
      const maxH = Math.max(...this.pages.map(p => p.h), 1056);
      this.fit = Math.max(0.2, Math.min((avail - 80) / maxW, ((this.scroller.clientHeight || innerHeight) - 32) / maxH));
    }
    const s = this.scale;
    this.pagesEl.style.gap = Math.round(18 * Math.min(1, s)) + 'px';
    for (const pe of this.pageEls.values()) {
      pe.el.style.width = pe.page.w * s + 'px';
      pe.el.style.height = pe.page.h * s + 'px';
      pe.textLayer.style.width = pe.page.w + 'px';
      pe.textLayer.style.height = pe.page.h + 'px';
      pe.textLayer.style.transform = `scale(${s})`;
      this.dropDetail(pe);
      if (pe.mounted) this.renderPageEl(pe);
    }
    if (this.sel) this.showSelection();
    this.updatePageNum();
    this.scheduleDetail();
  }

  mount(pe) {
    if (pe.mounted) return;
    pe.mounted = true;
    this.renderPageEl(pe);
  }

  unmount(pe) {
    if (!pe.mounted || pe === this.active?.pe) return;
    pe.mounted = false;
    this.dropDetail(pe);
    pe.canvas.width = pe.canvas.height = 0;
    pe.textLayer.innerHTML = '';
  }

  pxScale(page) {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(this.scale * dpr, Math.sqrt(MAX_PX / (page.w * page.h)));
  }

  async renderPageEl(pe) {
    const token = ++pe.token;
    const p = pe.page;
    const images = new Map();
    const ids = p.items.filter(i => i.type === 'image').map(i => i.blob);
    if (p.bgBlob) ids.push(p.bgBlob);
    await Promise.all(ids.map(async id => images.set(id, await loadImage(id))));
    if (token !== pe.token || !pe.mounted) return;
    const ps = this.pxScale(p);
    const W = Math.round(p.w * ps), H = Math.round(p.h * ps);
    if (pe.canvas.width !== W || pe.canvas.height !== H) { pe.canvas.width = W; pe.canvas.height = H; }
    const ctx = pe.canvas.getContext('2d');
    ctx.setTransform(ps, 0, 0, ps, 0, 0);
    drawBackground(ctx, p, this.note, images);
    const opts = { skipText: true, alphaFor: this.audio?.alphaFor() };
    for (const it of p.items) drawItem(ctx, it, images, opts);
    pe.images = images;
    this.paintDetail(pe);
    this.renderTextLayer(pe);
  }

  // Cheap path for adding one item on top of an existing render.
  drawOnPage(pe, item) {
    if (!pe.mounted || !pe.canvas.width) return;
    const ps = pe.canvas.width / pe.page.w;
    const ctx = pe.canvas.getContext('2d');
    ctx.setTransform(ps, 0, 0, ps, 0, 0);
    drawItem(ctx, item, pe.images || new Map(), { skipText: true });
    this.paintDetail(pe, item);
  }

  renderTextLayer(pe) {
    const editingId = this.editingText?.item.id;
    for (const node of [...pe.textLayer.children]) if (node.dataset.id !== editingId) node.remove();
    const alphaFor = this.audio?.alphaFor();
    for (const it of pe.page.items) {
      if (it.type !== 'text' || it.id === editingId) continue;
      const node = this.textNode(it);
      if (alphaFor) node.style.opacity = alphaFor(it);
      pe.textLayer.append(node);
    }
  }

  textNode(it) {
    const node = el('div', { class: 'tbox', 'data-id': it.id });
    this.styleTextNode(node, it);
    node.textContent = it.text || '';
    return node;
  }

  styleTextNode(node, it) {
    Object.assign(node.style, {
      left: it.pts[0][0] + 'px', top: it.pts[0][1] + 'px', width: it.w + 'px',
      font: textFont(it), lineHeight: '1.3', color: it.color, background: it.bg || 'transparent',
    });
  }

  rerender(pe) { if (pe && pe.mounted) this.renderPageEl(pe); }
  rerenderAll() { for (const pe of this.pageEls.values()) this.rerender(pe); }

  // ---------- tools ----------
  onToolButton(t, btn) {
    if (this.tool === t && t !== 'hand') this.toolOptions(t, btn);
    else this.selectTool(t);
  }

  selectTool(t) {
    if (t !== 'lasso') this.clearSelection();
    if (t !== 'text') this.endTextEdit();
    this.tool = t;
    for (const [k, b] of Object.entries(this.toolBtns)) b.classList.toggle('active', k === t);
    this.root.dataset.tool = t;
    this.applyTouchAction();
    this.renderSwatches();
    this.persistTools();
  }

  applyTouchAction() {
    if (!this.scroller) return;
    // The page handles every gesture itself (see onTouch*): with native panning
    // enabled, iOS delays Pencil events while it decides whether a touch is a scroll.
    this.scroller.style.touchAction = 'none';
  }

  persistTools() {
    saveSettings({ tools: this.tools, tool: this.tool, pencilOnly: this.pencilOnly, shapeHold: this.shapeHold });
  }

  colorTarget() {
    const t = this.tool;
    if (t === 'lasso' || t === 'eraser' || t === 'hand') return null;
    return this.tools[t];
  }

  // Quick colors and three size presets, like the favorites bar in pro note apps.
  renderSwatches() {
    this.swatches.innerHTML = '';
    this.sizesEl.innerHTML = '';
    for (const t of ['pen', 'highlighter', 'tape']) if (this.toolBtns[t]) this.toolBtns[t].style.setProperty('--tip', this.tools[t].color);
    const target = this.colorTarget();
    if (target && target.colors) {
      for (const c of target.colors) {
        this.swatches.append(el('button', {
          class: 'swatch' + (c === target.color ? ' active' : ''), style: { '--c': c }, title: 'Color',
          onclick: e => {
            if (target.color === c) { this.toolOptions(this.tool, e.currentTarget); return; }
            target.color = c; this.renderSwatches(); this.persistTools(); this.applyToEditingText();
          },
        }));
      }
    }
    const o = this.tools[this.tool];
    if (o && o.sizes) {
      const key = this.tool === 'eraser' ? 'size' : this.tool === 'text' ? 'size' : 'width';
      const max = Math.max(...o.sizes);
      o.sizes.forEach((v, i) => {
        const d = Math.round(5 + (v / max) * 13);
        this.sizesEl.append(el('button', {
          class: 'size-dot' + (Math.abs(o[key] - v) < 0.01 ? ' active' : ''), title: 'Size ' + (i + 1),
          onclick: e => {
            if (Math.abs(o[key] - v) < 0.01) { this.toolOptions(this.tool, e.currentTarget); return; }
            o[key] = v; this.renderSwatches(); this.persistTools(); this.applyToEditingText();
          },
        }, el('i', { style: { width: d + 'px', height: d + 'px' } })));
      });
    }
  }

  toolOptions(t, anchor) {
    const o = this.tools[t];
    if (!o) return;
    const box = el('div', { class: 'tool-opts' });
    const remember = c => { if (o.colors && !o.colors.includes(c)) { o.colors.pop(); o.colors.unshift(c); } };
    const colorGrid = (palette, key = 'color') => {
      const g = el('div', { class: 'color-grid' });
      for (const c of palette) g.append(el('button', {
        class: 'swatch' + (c === o[key] ? ' active' : ''), style: { '--c': c },
        onclick: () => {
          o[key] = c;
          if (key === 'color') remember(c);
          this.persistTools(); this.renderSwatches(); this.applyToEditingText(); this.toolOptions(t, anchor);
        },
      }));
      const custom = el('input', { type: 'color', value: o[key] || '#000000', class: 'color-input', title: 'Custom color' });
      custom.oninput = () => { o[key] = custom.value; this.persistTools(); this.renderSwatches(); this.applyToEditingText(); };
      custom.onchange = () => { if (key === 'color') remember(custom.value); this.persistTools(); this.renderSwatches(); };
      g.append(custom);
      return g;
    };
    const sizeKey = t === 'eraser' || t === 'text' ? 'size' : 'width';
    const slider = (label, key, min, max, step) => {
      const val = el('span', { class: 'slider-val' }, String(+(+o[key]).toFixed(1)));
      const input = el('input', { type: 'range', min, max, step, value: o[key] });
      input.oninput = () => {
        o[key] = +input.value; val.textContent = input.value;
        // Editing the size updates the selected preset, so presets are customizable.
        if (key === sizeKey && o.sizes && this.activePreset != null) o.sizes[this.activePreset] = +input.value;
        this.persistTools(); this.applyToEditingText(); this.renderSwatches();
      };
      return el('label', { class: 'slider' }, el('span', {}, label), input, val);
    };
    this.activePreset = o.sizes ? o.sizes.findIndex(v => Math.abs(v - o[sizeKey]) < 0.01) : null;
    if (this.activePreset < 0) this.activePreset = null;
    const toggle = (label, key, target = o) => {
      const input = el('input', { type: 'checkbox' }); input.checked = !!target[key];
      input.onchange = () => { target[key] = input.checked; this.persistTools(); this.applyToEditingText(); };
      return el('label', { class: 'toggle' }, el('span', {}, label), input);
    };
    const seg = (key, options) => el('div', { class: 'seg' }, options.map(([v, label]) => el('button', {
      class: o[key] === v ? 'on' : '', onclick: () => { o[key] = v; this.persistTools(); this.applyToEditingText(); this.toolOptions(t, anchor); },
    }, label)));
    switch (t) {
      case 'pen': {
        box.append(el('h4', {}, 'Pen'), seg('pen', PEN_TYPES), colorGrid(COLORS), slider('Size', 'width', 0.5, 14, 0.1), toggle('Pressure sensitivity', 'pressure'));
        const holder = { shapeHold: this.shapeHold };
        const tg = toggle('Draw and hold to snap shapes', 'shapeHold', holder);
        tg.querySelector('input').addEventListener('change', () => { this.shapeHold = holder.shapeHold; this.persistTools(); });
        box.append(tg);
        break;
      }
      case 'highlighter':
        box.append(el('h4', {}, 'Highlighter'), colorGrid(HL_COLORS.concat(COLORS.slice(3, 9))), slider('Size', 'width', 6, 40, 1), toggle('Straight lines', 'straight'));
        break;
      case 'eraser':
        box.append(el('h4', {}, 'Eraser'), seg('mode', [['stroke', 'Whole stroke'], ['partial', 'Precise']]), slider('Size', 'size', 4, 60, 1));
        break;
      case 'shape':
        box.append(el('h4', {}, 'Shapes'), seg('kind', [['auto', 'Freehand'], ['line', 'Line'], ['arrow', 'Arrow'], ['rect', 'Rect'], ['ellipse', 'Oval'], ['triangle', 'Tri']]),
          colorGrid(COLORS), slider('Line', 'width', 0.5, 14, 0.1), toggle('Dashed', 'dash'));
        { const fills = el('div', { class: 'color-grid' }, el('button', { class: 'swatch none' + (!o.fill ? ' active' : ''), title: 'No fill', onclick: () => { o.fill = null; this.persistTools(); this.toolOptions(t, anchor); } }));
          for (const c of COLORS.slice(3)) fills.append(el('button', { class: 'swatch' + (o.fill === c ? ' active' : ''), style: { '--c': c }, onclick: () => { o.fill = c; this.persistTools(); this.toolOptions(t, anchor); } }));
          box.append(el('div', { class: 'opt-label' }, 'Fill'), fills); }
        break;
      case 'text':
        box.append(el('h4', {}, 'Text'), seg('font', Object.keys(FONTS).map(f => [f, f[0].toUpperCase() + f.slice(1)])), colorGrid(COLORS), slider('Size', 'size', 10, 72, 1), toggle('Bold', 'bold'));
        break;
      case 'laser':
        box.append(el('h4', {}, 'Laser pointer'), colorGrid(['#ff2d55', '#ff9500', '#34c759', '#0a84ff', '#bf5af2']));
        break;
      case 'tape':
        box.append(el('h4', {}, 'Tape'), el('p', { class: 'muted', style: { margin: '0 0 10px', fontSize: '13px' } }, 'Drag to cover answers. Tap tape to peek underneath; tap again to cover.'),
          colorGrid(TAPE_COLORS), slider('Width', 'width', 10, 60, 1),
          el('button', { class: 'btn small', onclick: () => { this.setAllTape(false); closePopover(); } }, 'Reveal all on page'), ' ',
          el('button', { class: 'btn small', onclick: () => { this.setAllTape(true); closePopover(); } }, 'Cover all'));
        break;
      default: return;
    }
    popover(anchor, box);
  }

  // ---------- input ----------
  pagePoint(e, pe) {
    const r = pe.el.getBoundingClientRect();
    return [(e.clientX - r.left) / this.scale, (e.clientY - r.top) / this.scale];
  }

  pressureOf(e) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? Math.min(1, e.pressure) : 0.5;
    return 0.5;
  }

  onDown(e) {
    if (this.pinch) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen' && !this.pencilOnly && !settings().pencilAuto) {
      this.pencilOnly = true;
      saveSettings({ pencilAuto: true });
      this.persistTools();
      this.applyTouchAction();
      toast('Apple Pencil detected: fingers now scroll, Pencil draws');
    }
    if (e.pointerType === 'touch' && (this.pencilOnly || this.tool === 'hand')) return;
    if (this.tool === 'hand') return;
    if (e.pointerType === 'pen') {
      this.lastPenT = performance.now();
      // A palm that started drawing before the Pencil landed loses to the Pencil.
      if (this.active && this.active.type !== 'pen') this.cancelActive();
      this.tapGesture = null;
      if (this.pinch) return;
    }
    if (this.active) return;
    if (e.pointerType === 'touch' && this.touchCount > 1) return;
    const pageNode = e.target.closest('.page');
    if (!pageNode) return;
    const pe = this.pageEls.get(pageNode.dataset.id);
    if (this.editingText && e.target.closest('.tbox.editing')) return;
    if (this.audio.replayActive()) { this.audio.seekFromTap(pe, this.pagePoint(e, pe)); return; }
    e.preventDefault();
    closePopover();
    try { this.scroller.setPointerCapture(e.pointerId); } catch {}
    const pt = this.pagePoint(e, pe);
    this.active = { id: e.pointerId, type: e.pointerType, pe, start: pt, last: pt, moved: false, t0: performance.now() };
    const h = this['down_' + this.tool];
    if (h) h.call(this, this.active, pt, e);
  }

  onMove(e) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const h = this['move_' + this.tool];
    for (const ev of (evs.length ? evs : [e])) {
      const pt = this.pagePoint(ev, a.pe);
      if (!a.moved && Math.hypot(pt[0] - a.start[0], pt[1] - a.start[1]) * this.scale > 4) a.moved = true;
      if (h) h.call(this, a, pt, ev);
      a.last = pt;
    }
    if (a.type === 'pen') this.lastPenT = performance.now();
    if (a.ink && !a.shape) this.drawTip(a);
    else if (h) this.requestLive();
  }

  onUp(e, cancelled = false) {
    const a = this.active;
    if (!a || e.pointerId !== a.id) return;
    this.active = null;
    if (a.type === 'pen') this.lastPenT = performance.now();
    clearTimeout(a.holdTimer);
    const h = this['up_' + this.tool];
    if (cancelled && e.pointerType === 'touch') { this.clearLive(); return; }
    if (h) h.call(this, a, a.last, e);
  }

  cancelActive() {
    if (!this.active) return;
    clearTimeout(this.active.holdTimer);
    if (this.active.before) { this.active.pe.page.items = this.active.before; this.rerender(this.active.pe); }
    this.active = null;
    this.clearLive();
  }

  // Touch events: palm rejection, pinch zoom, two/three-finger tap undo/redo.
  isPalm(t) { return (t.radiusX || t.webkitRadiusX || 0) > 34; }

  penBusy() { return this.active?.type === 'pen' || performance.now() - (this.lastPenT || 0) < 350; }

  fingerPans() { return this.pencilOnly || this.tool === 'hand' || !DRAW_TOOLS.has(this.tool) || this.tool === 'text'; }

  // One-finger panning with momentum, done by hand because touch-action is none.
  startPan(t) {
    this.stopMomentum();
    this.pan = { id: t.identifier, x: t.clientX, y: t.clientY, t: performance.now(), vx: 0, vy: 0, moved: false };
  }

  movePan(e) {
    const p = this.pan, t = [...e.touches].find(t => t.identifier === p.id);
    if (!t) return;
    const now = performance.now(), dt = Math.max(1, now - p.t);
    const dx = t.clientX - p.x, dy = t.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    p.moved = true;
    this.scroller.scrollLeft -= dx; this.scroller.scrollTop -= dy;
    p.vx = p.vx * 0.3 + (dx / dt) * 0.7; p.vy = p.vy * 0.3 + (dy / dt) * 0.7;
    p.x = t.clientX; p.y = t.clientY; p.t = now;
  }

  endPan() {
    const p = this.pan;
    this.pan = null;
    if (!p || !p.moved || performance.now() - p.t > 60) return;
    let vx = p.vx, vy = p.vy, last = performance.now();
    const step = now => {
      const dt = Math.min(40, now - last); last = now;
      const f = Math.pow(0.9955, dt);
      vx *= f; vy *= f;
      this.scroller.scrollLeft -= vx * dt; this.scroller.scrollTop -= vy * dt;
      if (Math.hypot(vx, vy) > 0.02) this.momentum = requestAnimationFrame(step); else this.momentum = 0;
    };
    this.momentum = requestAnimationFrame(step);
  }

  stopMomentum() { if (this.momentum) { cancelAnimationFrame(this.momentum); this.momentum = 0; } }

  onTouchStart(e) {
    this.touchCount = e.touches.length;
    this.stopMomentum();
    const touches = [...e.touches];
    const stylus = touches.some(t => t.touchType === 'stylus');
    // Palm rejection: while the Pencil is writing (or just lifted between letters),
    // a resting hand must not scroll, zoom, or fire the undo tap.
    if (!stylus && this.tool !== 'hand' && (this.penBusy() || touches.some(t => this.isPalm(t)))) {
      e.preventDefault();
      this.tapGesture = null;
      return;
    }
    if (e.touches.length >= 2 && !stylus) {
      e.preventDefault();
      this.pan = null;
      if (this.active && this.active.type === 'touch') this.cancelActive();
      if (e.touches.length === 2) this.startPinch(e);
      this.tapGesture = { n: e.touches.length, t: performance.now(), x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
      return;
    }
    if (stylus && this.tool !== 'hand' && this.tool !== 'text' && !e.target.closest('.tbox.editing')) { e.preventDefault(); return; }
    if (!stylus && e.touches.length === 1 && this.fingerPans() && !e.target.closest('.tbox.editing, .sel-bar, .audio-bar, .ed-tools')) this.startPan(e.touches[0]);
  }

  onTouchMove(e) {
    if (this.pinch && e.touches.length >= 2) { e.preventDefault(); this.updatePinch(e); return; }
    const stylus = [...e.touches].some(t => t.touchType === 'stylus');
    if (stylus && this.tool !== 'hand') e.preventDefault();
    if (this.active) e.preventDefault();
    if (this.pan && !stylus) { e.preventDefault(); this.movePan(e); }
  }

  onTouchEnd(e) {
    this.touchCount = e.touches.length;
    if (this.pan && ![...e.touches].some(t => t.identifier === this.pan.id)) this.endPan();
    if (this.pinch && e.touches.length < 2) this.endPinch();
    const g = this.tapGesture;
    if (g && e.touches.length === 0) {
      this.tapGesture = null;
      if (!g.moved && performance.now() - g.t < 300 && settings().tapUndo !== false) {
        if (g.n === 2) this.undo();
        else if (g.n === 3) this.redo();
      }
    }
  }

  startPinch(e) {
    const [t1, t2] = e.touches;
    const r = this.scroller.getBoundingClientRect();
    const mx = (t1.clientX + t2.clientX) / 2, my = (t1.clientY + t2.clientY) / 2;
    this.pinch = {
      d0: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY) || 1,
      m0: [mx, my], z0: this.zoom,
      ox: this.scroller.scrollLeft + mx - r.left - this.pagesEl.offsetLeft,
      oy: this.scroller.scrollTop + my - r.top,
      s: 1, dx: 0, dy: 0,
    };
    this.pagesEl.style.transformOrigin = `${this.pinch.ox}px ${this.pinch.oy}px`;
  }

  updatePinch(e) {
    const p = this.pinch;
    const [t1, t2] = e.touches;
    const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const mx = (t1.clientX + t2.clientX) / 2, my = (t1.clientY + t2.clientY) / 2;
    const z = Math.max(0.5, Math.min(5, p.z0 * d / p.d0));
    p.s = z / p.z0;
    p.dx = mx - p.m0[0]; p.dy = my - p.m0[1];
    if (this.tapGesture && (Math.abs(p.dx) + Math.abs(p.dy) > 10 || Math.abs(p.s - 1) > 0.05)) this.tapGesture.moved = true;
    this.pagesEl.style.transform = `translate(${p.dx}px, ${p.dy}px) scale(${p.s})`;
  }

  endPinch() {
    const p = this.pinch;
    this.pinch = null;
    this.pagesEl.style.transform = '';
    const r = this.scroller.getBoundingClientRect();
    if (Math.abs(p.s - 1) < 0.02) {
      this.scroller.scrollLeft -= p.dx; this.scroller.scrollTop -= p.dy;
      return;
    }
    this.zoom = p.z0 * p.s;
    if (Math.abs(this.zoom - 1) < 0.06) this.zoom = 1;
    const real = this.zoom / p.z0;
    this.layout();
    this.scroller.scrollTop = p.oy * real - (p.m0[1] + p.dy - r.top);
    this.scroller.scrollLeft = p.ox * real + this.pagesEl.offsetLeft - (p.m0[0] + p.dx - r.left);
  }

  onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const f = Math.exp(-e.deltaY / 200);
    this.setZoom(this.zoom * f);
  }

  setZoom(z) {
    const old = this.scale;
    const center = this.scroller.scrollTop + this.scroller.clientHeight / 2;
    this.zoom = Math.max(0.5, Math.min(5, z));
    this.layout();
    this.scroller.scrollTop = center * (this.scale / old) - this.scroller.clientHeight / 2;
  }

  onScroll() {
    cancelAnimationFrame(this.scrollRaf);
    this.scrollRaf = requestAnimationFrame(() => this.updatePageNum());
    this.scheduleDetail();
  }

  currentPageIndex() {
    const h = this.horizontal;
    const mid = h ? this.scroller.scrollLeft + this.scroller.clientWidth / 2 : this.scroller.scrollTop + this.scroller.clientHeight / 3;
    let idx = 0;
    this.pages.forEach((p, i) => { const pe = this.pageEls.get(p.id); if (pe && (h ? pe.el.offsetLeft : pe.el.offsetTop) <= mid) idx = i; });
    return idx;
  }

  updatePageNum() {
    if (!this.pages) return;
    this.pageNum.textContent = `${this.currentPageIndex() + 1} / ${this.pages.length}`;
    this.pageNum.classList.add('show');
    clearTimeout(this.pageNumTimer);
    this.pageNumTimer = setTimeout(() => this.pageNum.classList.remove('show'), 1200);
  }

  // ---------- movable toolbar ----------
  // Docks to the top (full width), or floats as a pill on the bottom, left or right edge.
  applyDock(side) {
    this.dock = side;
    this.root.dataset.dock = side;
    const t = this.toolbar;
    if (side === 'top') { delete t.dataset.popSide; this.root.insertBefore(t, this.root.querySelector('.ed-body')); }
    else { t.dataset.popSide = side; this.scrollWrap.append(t); }
    t.classList.toggle('vertical', side === 'left' || side === 'right');
  }

  setDock(side) {
    if (side === this.dock) return;
    saveSettings({ toolbarDock: side });
    this.applyDock(side);
    this.layout();
  }

  bindGrip() {
    const g = this.grip;
    let drag = null;
    const sideAt = (x, y) => {
      const r = this.scrollWrap.getBoundingClientRect();
      const d = { top: y - r.top, bottom: r.bottom - y, left: x - r.left, right: r.right - x };
      // Favor the top: it is where the bar lives by default and where most people want it.
      d.top *= 0.7;
      return Object.keys(d).reduce((a, b) => (d[a] <= d[b] ? a : b));
    };
    g.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      try { g.setPointerCapture(e.pointerId); } catch {}
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, side: this.dock };
    });
    g.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      closePopover();
      this.toolbar.classList.add('dragging');
      this.toolbar.style.translate = `${dx}px ${dy}px`;
      drag.side = sideAt(e.clientX, e.clientY);
      this.dockHint.className = 'dock-hint dock-' + drag.side;
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      this.toolbar.classList.remove('dragging');
      this.toolbar.style.translate = '';
      this.dockHint.className = 'dock-hint hidden';
      if (d.moved) this.setDock(d.side);
      else menu(g, ['top', 'bottom', 'left', 'right'].map(s => ({ label: 'Toolbar ' + s[0].toUpperCase() + s.slice(1), checked: this.dock === s, action: () => this.setDock(s) })));
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', e => { if (drag) { drag.moved = false; drag = null; this.toolbar.classList.remove('dragging'); this.toolbar.style.translate = ''; this.dockHint.className = 'dock-hint hidden'; } });
    g.addEventListener('click', e => e.stopPropagation());
  }

  // ---------- sharp zoom ----------
  // Past the page canvas's pixel budget, the visible part of each page is painted
  // again at screen resolution so ink stays crisp at any zoom.
  scheduleDetail() {
    clearTimeout(this.detailTimer);
    this.detailTimer = setTimeout(() => this.renderDetails(), 120);
  }

  dropDetail(pe) { if (pe.detail) { pe.detail.remove(); pe.detail = null; } }

  renderDetails() {
    if (!this.scroller || !this.note) return;
    const dpr = window.devicePixelRatio || 1, want = this.scale * dpr;
    const wr = this.scroller.getBoundingClientRect();
    for (const pe of this.pageEls.values()) {
      const r = pe.el.getBoundingClientRect();
      const x1 = Math.max(r.left, wr.left), y1 = Math.max(r.top, wr.top), x2 = Math.min(r.right, wr.right), y2 = Math.min(r.bottom, wr.bottom);
      if (!pe.mounted || !pe.canvas.width || pe.canvas.width / pe.page.w >= want * 0.98 || x2 <= x1 || y2 <= y1) { this.dropDetail(pe); continue; }
      const c = pe.detail || (pe.detail = el('canvas', { class: 'detail' }));
      if (c.parentNode !== pe.el) pe.el.insertBefore(c, pe.textLayer);
      const L = x1 - r.left, T = y1 - r.top, W = x2 - x1, H = y2 - y1;
      Object.assign(c.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      pe.detailBox = [L, T, dpr];
      this.paintDetail(pe);
    }
  }

  paintDetail(pe, only) {
    if (!pe.detail) return;
    const ctx = pe.detail.getContext('2d'), [L, T, dpr] = pe.detailBox, k = this.scale * dpr;
    ctx.setTransform(k, 0, 0, k, -L * dpr, -T * dpr);
    const images = pe.images || new Map();
    if (only) { drawItem(ctx, only, images, { skipText: true }); return; }
    drawBackground(ctx, pe.page, this.note, images);
    const opts = { skipText: true, alphaFor: this.audio?.alphaFor() };
    for (const it of pe.page.items) drawItem(ctx, it, images, opts);
  }

  // ---------- live overlay ----------
  // The live layer is one screen-sized canvas over the scroller at full device
  // resolution, mapped onto the page being written on and clipped to it.
  attachLive(pe) {
    const wrap = this.scrollWrap, dpr = window.devicePixelRatio || 1;
    const W = Math.round(wrap.clientWidth * dpr), H = Math.round(wrap.clientHeight * dpr);
    const wr = wrap.getBoundingClientRect(), pr = pe.el.getBoundingClientRect(), k = this.scale * dpr;
    for (const [c, ctx] of [[this.live, this.liveCtx], [this.tip, this.tipCtx]]) {
      if (c.parentNode !== wrap) wrap.insertBefore(c, this.scroller.nextSibling);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      if (this.liveClipped) ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.setTransform(k, 0, 0, k, (pr.left - wr.left) * dpr, (pr.top - wr.top) * dpr);
      ctx.beginPath(); ctx.rect(0, 0, pe.page.w, pe.page.h); ctx.clip();
    }
    this.liveClipped = true;
    this.livePe = pe;
    this.tipBox = null;
  }

  clearLive() {
    if (!this.livePe) return;
    this.liveCtx.clearRect(0, 0, this.livePe.page.w, this.livePe.page.h);
    this.tipCtx.clearRect(0, 0, this.livePe.page.w, this.livePe.page.h);
    this.tipBox = null;
  }

  // Joins the fitted ink to the exact Pencil position, so the line never trails the tip.
  drawTip(a) {
    const ctx = this.tipCtx, pts = a.item.pts, n = pts.length, raw = a.tipPt;
    if (this.tipBox) { const b = this.tipBox; ctx.clearRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }
    const path = [n > 1 ? pts[n - 2] : pts[0], pts[n - 1], raw];
    const w = a.ink.w;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of path) { x1 = Math.min(x1, p[0]); y1 = Math.min(y1, p[1]); x2 = Math.max(x2, p[0]); y2 = Math.max(y2, p[1]); }
    const pad = w + 2 / this.scale;
    this.tipBox = [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
    ctx.strokeStyle = a.item.color;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(path[0][0], path[0][1]);
    ctx.lineTo(path[1][0], path[1][1]);
    ctx.lineTo(path[2][0], path[2][1]);
    ctx.stroke();
  }

  requestLive() {
    if (this.liveRaf) return;
    this.liveRaf = requestAnimationFrame(() => { this.liveRaf = 0; this.drawLive && this.drawLive(); });
  }

  // ---------- pen & highlighter ----------
  newStroke(tool, a, pt, e) {
    const o = this.tools[tool];
    const item = {
      id: uid(), type: 'stroke', tool, color: o.color, width: o.width,
      pressure: tool === 'pen' && o.pressure && e.pointerType === 'pen',
      pts: [[pt[0], pt[1], this.pressureOf(e)]],
    };
    if (tool === 'pen' && o.pen && o.pen !== 'fountain') item.pen = o.pen;
    if (tool === 'highlighter') item.flat = true;
    this.audio.tag(item);
    a.item = item;
    this.attachLive(a.pe);
    if (tool === 'pen') {
      a.ink = new InkBuilder(item);
      a.ink.push(item.pts[0]);
      a.tipPt = item.pts[0];
      this.drawLive = () => { if (a.shape) { this.clearLive(); drawShape(this.liveCtx, a.shape); } };
      this.drawTip(a);
      return;
    }
    // Only the stroke's own box is cleared and repainted each frame, so the GPU
    // uploads a few thousand pixels instead of the whole screen.
    let box = null;
    this.drawLive = () => {
      if (a.shape) { this.clearLive(); box = null; drawShape(this.liveCtx, a.shape); return; }
      const it = a.item, pad = it.width * 2 + 2;
      const nb = itemBBox(it);
      box = box ? [Math.min(box[0], nb[0] - pad), Math.min(box[1], nb[1] - pad), Math.max(box[2], nb[2] + pad), Math.max(box[3], nb[3] + pad)]
        : [nb[0] - pad, nb[1] - pad, nb[2] + pad, nb[3] + pad];
      this.liveCtx.clearRect(box[0], box[1], box[2] - box[0], box[3] - box[1]);
      drawStroke(this.liveCtx, it);
    };
    this.requestLive();
  }

  down_pen(a, pt, e) { this.newStroke('pen', a, pt, e); }
  down_highlighter(a, pt, e) { this.newStroke('highlighter', a, pt, e); }

  move_pen(a, pt, e) {
    if (a.shape) return;
    const pts = a.item.pts;
    const last = pts[pts.length - 1];
    const pr = this.pressureOf(e);
    a.tipPt = [pt[0], pt[1], pr];
    const d = Math.hypot(pt[0] - last[0], pt[1] - last[1]) * this.scale;
    if (d < 0.35) return;
    if (a.ink) {
      // Light, speed-aware smoothing: steadies slow strokes, stays out of the way of fast ones.
      const k = Math.min(1, 0.55 + d / 10);
      const p = [last[0] + (pt[0] - last[0]) * k, last[1] + (pt[1] - last[1]) * k, pr];
      pts.push(p);
      const seg = a.ink.push(p);
      if (seg) strokeSegment(this.liveCtx, seg, a.item.color);
    } else pts.push([pt[0], pt[1], pr]);
    if (this.shapeHold && this.tool === 'pen') {
      clearTimeout(a.holdTimer);
      a.holdTimer = setTimeout(() => this.snapShape(a), 650);
    }
  }

  move_highlighter(a, pt, e) {
    if (this.tools.highlighter.straight) {
      a.item.pts = [a.item.pts[0], [pt[0], pt[1], 0.5]];
      return;
    }
    this.move_pen(a, pt, e);
  }

  snapShape(a) {
    if (this.active !== a || a.shape) return;
    const pts = a.item.pts;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len * this.scale < 40) return;
    const r = recognize(a.item.pts);
    if (!r) return;
    a.shape = { id: uid(), type: 'shape', kind: r.kind, pts: r.pts, closed: r.closed, color: a.item.color, width: a.item.width * 1.1 };
    this.audio.tag(a.shape);
    this.requestLive();
  }

  up_pen(a) { this.commitStroke(a); }
  up_highlighter(a) { this.commitStroke(a); }

  commitStroke(a) {
    const item = a.shape || a.item;
    this.clearLive();
    this.drawLive = null;
    this.addItems(a.pe, [item]);
  }

  addItems(pe, items) {
    // Adding is the hot path after every stroke: undo stores just the new items
    // instead of a copy of the whole page.
    pe.page.items.push(...items);
    this.pushUndo({ kind: 'add', pageId: pe.page.id, items: structuredClone(items) }, pe.page);
    for (const it of items) this.drawOnPage(pe, it);
    if (items.some(i => i.type === 'text' || i.type === 'image')) this.rerender(pe);
  }

  // ---------- shapes ----------
  down_shape(a, pt, e) {
    const o = this.tools.shape;
    if (o.kind === 'auto') {
      this.newStroke('pen', a, pt, e);
      a.item.color = o.color; a.item.width = o.width; a.item.pressure = false;
      return;
    }
    this.attachLive(a.pe);
    a.shape = { id: uid(), type: 'shape', kind: o.kind, pts: [pt, pt], closed: false, color: o.color, width: o.width, fill: o.fill, dash: o.dash };
    this.audio.tag(a.shape);
    this.drawLive = () => { this.clearLive(); drawShape(this.liveCtx, a.shape); };
  }

  move_shape(a, pt, e) {
    const o = this.tools.shape;
    if (o.kind === 'auto') { this.move_pen(a, pt, e); return; }
    const [x0, y0] = a.start;
    let [x1, y1] = pt;
    const s = a.shape;
    switch (o.kind) {
      case 'line': case 'arrow': s.pts = [[x0, y0], [x1, y1]]; s.kind = o.kind; break;
      case 'rect': s.kind = 'polygon'; s.closed = true; s.pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; break;
      case 'ellipse': s.kind = 'ellipse'; s.closed = true; s.pts = [[x0, y0], [x1, y1]]; break;
      case 'triangle': s.kind = 'polygon'; s.closed = true; s.pts = [[(x0 + x1) / 2, y0], [x1, y1], [x0, y1]]; break;
    }
  }

  up_shape(a) {
    const o = this.tools.shape;
    if (o.kind === 'auto') {
      const r = a.shape ? null : recognize(a.item.pts);
      if (r) a.shape = { id: a.item.id, type: 'shape', kind: r.kind, pts: r.pts, closed: r.closed, color: o.color, width: o.width, fill: r.closed ? o.fill : null, dash: o.dash, rec: a.item.rec };
      else if (a.shape) Object.assign(a.shape, { fill: a.shape.closed ? o.fill : null, dash: o.dash });
      this.commitStroke(a);
      return;
    }
    this.clearLive();
    this.drawLive = null;
    if (!a.moved) return;
    this.addItems(a.pe, [a.shape]);
  }

  // ---------- eraser ----------
  down_eraser(a, pt) {
    a.before = structuredClone(a.pe.page.items);
    a.changed = false;
    this.attachLive(a.pe);
    this.drawLive = () => {
      this.clearLive();
      const r = this.tools.eraser.size / 2;
      this.liveCtx.strokeStyle = 'rgba(120,120,120,.9)'; this.liveCtx.lineWidth = 1 / this.scale;
      this.liveCtx.fillStyle = 'rgba(200,200,200,.25)';
      this.liveCtx.beginPath(); this.liveCtx.arc(a.last[0], a.last[1], r, 0, Math.PI * 2); this.liveCtx.fill(); this.liveCtx.stroke();
    };
    this.erase(a, pt, pt);
    this.requestLive();
  }

  move_eraser(a, pt) { this.erase(a, a.last, pt); }

  erase(a, from, to) {
    const r = this.tools.eraser.size / 2;
    const page = a.pe.page;
    const partial = this.tools.eraser.mode === 'partial';
    const out = [];
    let changed = false;
    for (const it of page.items) {
      if (it.type === 'image' || it.type === 'text') { out.push(it); continue; }
      const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
      const span = Math.hypot(to[0] - from[0], to[1] - from[1]) / 2;
      if (!hitItem(it, mid[0], mid[1], r + span)) { out.push(it); continue; }
      if (it.type === 'stroke' && partial) {
        const rr = r + it.width / 2;
        const keep = it.pts.map(p => distToSeg(p[0], p[1], from, to) > rr);
        if (keep.every(Boolean)) { out.push(it); continue; }
        changed = true;
        let run = [];
        const flush = () => { if (run.length > 1) out.push({ ...it, id: uid(), pts: run }); run = []; };
        it.pts.forEach((p, i) => { if (keep[i]) run.push(p); else flush(); });
        flush();
      } else {
        // Whole-item erase: check against the swept eraser segment.
        const pts = it.pts;
        let hit = false;
        if (it.type === 'shape' && it.kind === 'ellipse') hit = hitItem(it, to[0], to[1], r) || hitItem(it, mid[0], mid[1], r);
        else if (pts.length === 1) hit = distToSeg(pts[0][0], pts[0][1], from, to) < r + (it.width || 0) / 2;
        else {
          const segs = it.closed ? pts.concat([pts[0]]) : pts;
          for (let i = 1; i < segs.length && !hit; i++) hit = segDist(segs[i - 1], segs[i], from, to) < r + (it.width || 0) / 2;
        }
        if (hit) changed = true; else out.push(it);
      }
    }
    if (changed) {
      page.items = out;
      a.changed = true;
      cancelAnimationFrame(a.raf);
      a.raf = requestAnimationFrame(() => this.rerender(a.pe));
    }
  }

  up_eraser(a) {
    this.clearLive();
    this.drawLive = null;
    if (a.changed) this.pushUndo({ kind: 'items', pageId: a.pe.page.id, before: a.before, after: structuredClone(a.pe.page.items) }, a.pe.page);
  }

  // ---------- laser ----------
  down_laser(a, pt) {
    this.attachLive(a.pe);
    this.laserPts = [[pt[0], pt[1], performance.now()]];
    this.laserPe = a.pe;
    this.animateLaser();
  }
  move_laser(a, pt) { this.laserPts.push([pt[0], pt[1], performance.now()]); }
  up_laser() {}
  animateLaser() {
    cancelAnimationFrame(this.laserRaf);
    const step = () => {
      const now = performance.now();
      this.laserPts = this.laserPts.filter(p => now - p[2] < 700);
      this.clearLive();
      const ctx = this.liveCtx;
      const col = this.tools.laser.color;
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < this.laserPts.length; i++) {
        const p = this.laserPts[i], q = this.laserPts[i - 1];
        const al = 1 - (now - p[2]) / 700;
        ctx.globalAlpha = al; ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10;
        ctx.lineWidth = 5 / Math.max(0.6, this.scale) ;
        ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      }
      if (this.active && this.laserPts.length) {
        const p = this.laserPts[this.laserPts.length - 1];
        ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p[0], p[1], 5 / Math.max(0.6, this.scale), 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (this.laserPts.length || this.active) this.laserRaf = requestAnimationFrame(step);
    };
    step();
  }

  // ---------- tape ----------
  down_tape(a, pt) {
    const o = this.tools.tape;
    this.attachLive(a.pe);
    a.shape = { id: uid(), type: 'tape', pts: [pt, pt], width: o.width, color: o.color };
    this.drawLive = () => { this.clearLive(); if (a.moved) drawTape(this.liveCtx, a.shape); };
  }

  move_tape(a, pt) { a.shape.pts = [a.start, pt]; }

  up_tape(a, pt) {
    this.clearLive();
    this.drawLive = null;
    const page = a.pe.page;
    if (!a.moved || Math.hypot(pt[0] - a.start[0], pt[1] - a.start[1]) < 8) {
      const hit = [...page.items].reverse().find(it => it.type === 'tape' && hitItem(it, pt[0], pt[1], 4));
      if (hit) { hit.revealed = !hit.revealed; this.markDirty(page); this.rerender(a.pe); }
      return;
    }
    this.addItems(a.pe, [a.shape]);
  }

  // ---------- text ----------
  down_text(a) { /* handled on up so taps can focus */ }

  up_text(a, pt) {
    if (a.moved) return;
    const pe = a.pe;
    const hit = [...pe.page.items].reverse().find(it => it.type === 'text' && hitItem(it, pt[0], pt[1], 2));
    if (hit) { this.startTextEdit(pe, hit); return; }
    if (this.editingText) { this.endTextEdit(); return; }
    const o = this.tools.text;
    const item = { id: uid(), type: 'text', pts: [[pt[0] - 4, pt[1] - o.size * 0.7]], w: Math.min(360, pe.page.w - pt[0] - 8), text: '', size: o.size, color: o.color, font: o.font, bold: o.bold };
    if (item.w < 120) { item.w = 240; item.pts[0][0] = pe.page.w - 248; }
    this.audio.tag(item);
    this.addItems(pe, [item]);
    this.startTextEdit(pe, item, true);
  }

  startTextEdit(pe, item, isNew = false) {
    this.endTextEdit();
    this.renderTextLayer(pe);
    let node = pe.textLayer.querySelector(`.tbox[data-id="${item.id}"]`);
    if (!node) { node = this.textNode(item); pe.textLayer.append(node); }
    node.classList.add('editing');
    node.contentEditable = 'true';
    node.spellcheck = true;
    this.editingText = { pe, item, node, before: structuredClone(pe.page.items), isNew };
    node.addEventListener('input', () => {
      item.text = node.innerText.replace(/\n$/, '');
      item.hh = node.offsetHeight;
      this.markDirty(pe.page);
    });
    node.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); this.endTextEdit(); } e.stopPropagation(); });
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node); range.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }

  applyToEditingText() {
    const t = this.editingText;
    if (!t || this.tool !== 'text') return;
    const o = this.tools.text;
    Object.assign(t.item, { color: o.color, size: o.size, font: o.font, bold: o.bold });
    this.styleTextNode(t.node, t.item);
    this.markDirty(t.pe.page);
  }

  endTextEdit() {
    const t = this.editingText;
    if (!t) return;
    this.editingText = null;
    t.node.contentEditable = 'false';
    t.node.classList.remove('editing');
    t.item.text = t.node.innerText.replace(/\n$/, '');
    t.item.hh = t.node.offsetHeight || undefined;
    const page = t.pe.page;
    if (!t.item.text.trim()) page.items = page.items.filter(i => i !== t.item);
    const after = structuredClone(page.items);
    if (JSON.stringify(after) !== JSON.stringify(t.before)) {
      // A brand-new box's "add" entry is folded into this one.
      if (t.isNew && this.undoStack.length && this.undoStack[this.undoStack.length - 1].pageId === page.id) {
        const prev = this.undoStack.pop();
        this.pushUndo({ kind: 'items', pageId: page.id, before: prev.before, after }, page);
      } else this.pushUndo({ kind: 'items', pageId: page.id, before: t.before, after }, page);
    } else if (t.isNew && !t.item.text.trim()) {
      const prev = this.undoStack[this.undoStack.length - 1];
      if (prev && prev.pageId === page.id) this.undoStack.pop();
      this.updateUndoButtons();
    }
    this.renderTextLayer(t.pe);
    try { document.activeElement && document.activeElement.blur(); } catch {}
  }

  // ---------- lasso & selection ----------
  down_lasso(a, pt) {
    if (this.sel && this.sel.pe === a.pe) {
      const bb = this.sel.bbox;
      const hs = 22 / this.scale;
      if (Math.hypot(pt[0] - bb[2], pt[1] - bb[3]) < hs) { this.beginTransform(a, 'scale'); return; }
      if (pt[0] >= bb[0] && pt[0] <= bb[2] && pt[1] >= bb[1] && pt[1] <= bb[3]) { this.beginTransform(a, 'move'); return; }
    }
    this.clearSelection();
    a.path = [pt];
    this.attachLive(a.pe);
    this.drawLive = () => {
      this.clearLive();
      const c = this.liveCtx;
      c.save();
      c.setLineDash([6 / this.scale, 5 / this.scale]);
      c.strokeStyle = '#1f6feb'; c.lineWidth = 1.5 / this.scale; c.fillStyle = 'rgba(31,111,235,.06)';
      c.beginPath(); a.path.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.closePath(); c.fill(); c.stroke(); c.restore();
    };
  }

  move_lasso(a, pt) {
    if (a.mode) { this.updateTransform(a, pt); return; }
    a.path.push(pt);
  }

  up_lasso(a, pt, e) {
    if (a.mode) { this.endTransform(a); return; }
    this.clearLive();
    this.drawLive = null;
    const items = a.pe.page.items;
    let picked;
    if (!a.moved || a.path.length < 4) {
      const hit = [...items].reverse().find(it => hitItem(it, pt[0], pt[1], 6 / this.scale));
      picked = hit ? [hit] : [];
      if (!hit && this.clipboard) { this.pasteMenu(a.pe, pt, e); return; }
    } else {
      const poly = a.path;
      picked = items.filter(it => {
        if (it.type === 'stroke' || (it.type === 'shape' && it.kind !== 'ellipse')) {
          const pts = it.pts;
          const step = Math.max(1, Math.floor(pts.length / 30));
          let inside = 0, n = 0;
          for (let i = 0; i < pts.length; i += step, n++) if (pointInPoly(pts[i][0], pts[i][1], poly)) inside++;
          return inside / n >= 0.5;
        }
        const bb = itemBBox(it);
        return pointInPoly((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, poly);
      });
    }
    if (picked.length) this.setSelection(a.pe, picked.map(i => i.id));
  }

  setSelection(pe, ids) {
    this.sel = { pe, ids: new Set(ids) };
    this.computeSelBBox();
    this.showSelection();
    this.renderSwatches();
  }

  selItems() { return this.sel ? this.sel.pe.page.items.filter(i => this.sel.ids.has(i.id)) : []; }

  computeSelBBox() {
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const it of this.selItems()) {
      const b = itemBBox(it);
      bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1]), Math.max(bb[2], b[2]), Math.max(bb[3], b[3])];
    }
    const pad = 4;
    this.sel.bbox = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
  }

  showSelection() {
    if (!this.sel) return;
    const [x1, y1, x2, y2] = this.sel.bbox;
    const s = this.scale;
    Object.assign(this.selBox.style, { left: x1 * s + 'px', top: y1 * s + 'px', width: (x2 - x1) * s + 'px', height: (y2 - y1) * s + 'px' });
    if (this.selBox.parentNode !== this.sel.pe.el) this.sel.pe.el.append(this.selBox);
    this.showSelBar();
  }

  showSelBar() {
    this.selBar && this.selBar.remove();
    const items = this.selItems();
    const n = items.length;
    const btn = (label, fn, cls = '') => el('button', { class: cls, onclick: e => { e.stopPropagation(); fn(e); } }, label);
    const bar = el('div', { class: 'sel-bar' },
      btn('Cut', () => { this.copySel(); this.deleteSel(); }),
      btn('Copy', () => { this.copySel(); toast(`Copied ${n} item${n > 1 ? 's' : ''}`); }),
      btn('Duplicate', () => this.duplicateSel()),
      btn('Color', e => this.recolorSel(e.currentTarget)),
      n === 1 && items[0].type === 'text' ? btn('Edit', () => { const it = items[0]; const pe = this.sel.pe; this.selectTool('text'); this.startTextEdit(pe, it); }) : null,
      btn('Front', () => this.reorderSel(true)),
      btn('Back', () => this.reorderSel(false)),
      this.pages.length > 1 ? btn('Move to Page', () => this.moveSelToPage()) : null,
      btn('Flashcard', () => this.selToFlashcard()),
      btn('Save Element', () => this.saveSelAsElement()),
      btn('Delete', () => this.deleteSel(), 'danger'));
    bar.addEventListener('pointerdown', e => e.stopPropagation());
    this.selBox.append(bar);
    this.selBar = bar;
  }

  clearSelection() {
    if (!this.sel) return;
    this.sel = null;
    this.selBox.remove();
    this.renderSwatches();
  }

  beginTransform(a, mode) {
    a.mode = mode;
    a.before = structuredClone(a.pe.page.items);
    a.orig = new Map(this.selItems().map(i => [i.id, structuredClone(i)]));
    a.bb0 = this.sel.bbox.slice();
  }

  updateTransform(a, pt) {
    const dx = pt[0] - a.start[0], dy = pt[1] - a.start[1];
    const [x1, y1, x2, y2] = a.bb0;
    let s = 1, tx = dx, ty = dy;
    if (a.mode === 'scale') {
      const w = x2 - x1, h = y2 - y1;
      s = Math.max(0.1, ((w + dx) / w + (h + dy) / h) / 2);
      tx = 0; ty = 0;
    }
    const page = a.pe.page;
    page.items = page.items.map(it => {
      const o = a.orig.get(it.id);
      if (!o) return it;
      const c = structuredClone(o);
      transformItem(c, s, tx, ty, x1, y1);
      return c;
    });
    this.sel.bbox = [x1 + tx, y1 + ty, x1 + (x2 - x1) * s + tx, y1 + (y2 - y1) * s + ty];
    this.showSelection();
    cancelAnimationFrame(a.raf);
    a.raf = requestAnimationFrame(() => this.rerender(a.pe));
  }

  endTransform(a) {
    if (!a.moved) return;
    this.computeSelBBox();
    this.showSelection();
    this.rerender(a.pe);
    this.pushUndo({ kind: 'items', pageId: a.pe.page.id, before: a.before, after: structuredClone(a.pe.page.items) }, a.pe.page);
  }

  // Render the selected items to a transparent PNG, cropped to the selection.
  async selectionBlob() {
    const items = this.selItems();
    const [x1, y1, x2, y2] = this.sel.bbox;
    const sc = 2;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((x2 - x1) * sc)); c.height = Math.max(1, Math.round((y2 - y1) * sc));
    const ctx = c.getContext('2d');
    ctx.setTransform(sc, 0, 0, sc, -x1 * sc, -y1 * sc);
    const images = new Map();
    await Promise.all(items.filter(i => i.type === 'image').map(async i => images.set(i.blob, await loadImage(i.blob))));
    for (const it of items) drawItem(ctx, it, images, { forExport: true });
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    return blob;
  }

  async saveSelAsElement() {
    const blob = await this.selectionBlob();
    await db.put('elements', { id: uid(), blob: await putBlob(blob), created: Date.now() });
    toast('Saved to My Elements');
  }

  async selToFlashcard() {
    const blob = await this.selectionBlob();
    await this.app.study.cardFromImage(blob, this.note);
  }

  copySel() {
    this.clipboard = structuredClone(this.selItems());
  }

  deleteSel() {
    const pe = this.sel.pe, ids = this.sel.ids;
    this.clearSelection();
    this.record(pe.page, () => { pe.page.items = pe.page.items.filter(i => !ids.has(i.id)); });
    this.rerender(pe);
  }

  duplicateSel() {
    const pe = this.sel.pe;
    const copies = this.selItems().map(i => { const c = structuredClone(i); c.id = uid(); delete c.rec; transformItem(c, 1, 20, 20); return c; });
    this.addItems(pe, copies);
    this.rerender(pe);
    this.setSelection(pe, copies.map(c => c.id));
  }

  reorderSel(front) {
    const pe = this.sel.pe, ids = this.sel.ids;
    this.record(pe.page, () => {
      const sel = pe.page.items.filter(i => ids.has(i.id)), rest = pe.page.items.filter(i => !ids.has(i.id));
      pe.page.items = front ? rest.concat(sel) : sel.concat(rest);
    });
    this.rerender(pe);
  }

  recolorSel(anchor) {
    const g = el('div', { class: 'color-grid' });
    for (const c of COLORS.concat(HL_COLORS)) g.append(el('button', {
      class: 'swatch', style: { '--c': c }, onclick: () => {
        const pe = this.sel.pe, ids = this.sel.ids;
        this.record(pe.page, () => { for (const it of pe.page.items) if (ids.has(it.id) && it.type !== 'image') it.color = c; });
        this.rerender(pe);
        closePopover();
      },
    }));
    popover(anchor, el('div', { class: 'tool-opts' }, el('h4', {}, 'Recolor selection'), g));
  }

  async moveSelToPage() {
    const v = await prompt(`Move to page (1–${this.pages.length})`, String(Math.min(this.pages.length, this.currentPageIndex() + 2)), { ok: 'Move' });
    const n = parseInt(v, 10);
    if (!n || n < 1 || n > this.pages.length) return;
    const from = this.sel.pe, to = this.pageEls.get(this.pages[n - 1].id);
    if (from === to) return;
    const ids = this.sel.ids;
    const moving = this.selItems().map(i => structuredClone(i));
    this.clearSelection();
    this.recordPages(() => {
      from.page.items = from.page.items.filter(i => !ids.has(i.id));
      to.page.items.push(...moving.map(i => { if (i.pts) { const bb = itemBBox(i); if (bb[3] > to.page.h) transformItem(i, 1, 0, -Math.max(0, bb[3] - to.page.h)); } return i; }));
    });
  }

  pasteMenu(pe, pt, e) {
    const anchor = el('div', { style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', width: '1px', height: '1px' } });
    document.body.append(anchor);
    menu(anchor, [{ label: 'Paste', icon: 'copy', action: () => this.paste(pe, pt) }]);
    anchor.remove();
  }

  paste(pe, pt) {
    if (!this.clipboard || !this.clipboard.length) return;
    const items = structuredClone(this.clipboard);
    let bb = [Infinity, Infinity];
    for (const it of items) { const b = itemBBox(it); bb = [Math.min(bb[0], b[0]), Math.min(bb[1], b[1])]; }
    const dx = pt ? pt[0] - bb[0] : 24, dy = pt ? pt[1] - bb[1] : 24;
    for (const it of items) { it.id = uid(); delete it.rec; transformItem(it, 1, dx, dy); }
    this.addItems(pe, items);
    this.rerender(pe);
    if (this.tool !== 'lasso') this.selectTool('lasso');
    this.setSelection(pe, items.map(i => i.id));
  }

  // ---------- undo / redo ----------
  record(page, fn) {
    const before = structuredClone(page.items);
    fn();
    this.pushUndo({ kind: 'items', pageId: page.id, before, after: structuredClone(page.items) }, page);
  }

  recordPages(fn) {
    const snap = () => ({ pages: structuredClone(this.pages) });
    const before = snap();
    fn();
    const after = snap();
    this.pushUndo({ kind: 'pages', before, after });
    this.applyPagesState(after, false);
  }

  pushUndo(entry, page) {
    this.undoStack.push(entry);
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
    if (page) this.markDirty(page);
    this.updateUndoButtons();
  }

  undo() { this.step(this.undoStack, this.redoStack, 'before'); }
  redo() { this.step(this.redoStack, this.undoStack, 'after'); }

  step(from, to, which) {
    this.endTextEdit();
    const e = from.pop();
    if (!e) return;
    to.push(e);
    this.clearSelection();
    if (e.kind === 'items') {
      const pe = this.pageEls.get(e.pageId);
      const page = this.pages.find(p => p.id === e.pageId);
      if (page) {
        page.items = structuredClone(e[which]);
        this.markDirty(page);
        if (pe) this.rerender(pe);
      }
    } else if (e.kind === 'add') {
      const pe = this.pageEls.get(e.pageId);
      const page = this.pages.find(p => p.id === e.pageId);
      if (page) {
        const ids = new Set(e.items.map(i => i.id));
        page.items = page.items.filter(i => !ids.has(i.id));
        if (which === 'after') page.items.push(...structuredClone(e.items));
        this.markDirty(page);
        if (pe) this.rerender(pe);
      }
    } else if (e.kind === 'pages') {
      this.applyPagesState(e[which], true);
    }
    this.updateUndoButtons();
  }

  applyPagesState(state, clone) {
    const old = new Set(this.pages.map(p => p.id));
    this.pages = clone ? structuredClone(state.pages) : state.pages.map(p => this.pages.find(q => q.id === p.id) || structuredClone(p));
    if (!clone) {
      // keep live objects but sync item lists with the snapshot
      for (const p of this.pages) { const s = state.pages.find(q => q.id === p.id); Object.assign(p, structuredClone(s)); }
    }
    const now = new Set(this.pages.map(p => p.id));
    this.removedPages = [...(this.removedPages || []), ...[...old].filter(id => !now.has(id))];
    this.note.pageIds = this.pages.map(p => p.id);
    for (const p of this.pages) this.dirty.add(p);
    this.noteDirty = true;
    this.thumbStale = true;
    this.rebuildPages();
    this.scheduleSave();
  }

  updateUndoButtons() {
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  // ---------- saving ----------
  markDirty(page) {
    this.dirty.add(page);
    this.thumbStale = true;
    this.scheduleSave();
    if (!this.thumbsEl.classList.contains('hidden')) {
      clearTimeout(this.thumbTimer);
      this.thumbTimer = setTimeout(() => this.refreshThumb(page), 800);
    }
  }

  scheduleSave() {
    clearTimeout(this.saveTimer);
    // Saving serializes whole pages, so wait for a real pause and never run mid-stroke.
    this.saveTimer = setTimeout(() => (this.active ? this.scheduleSave() : this.flush()), 1800);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    if (!this.note) return;
    const pages = [...this.dirty].filter(p => this.pages.includes(p));
    this.dirty.clear();
    if (pages.length) await db.putMany('pages', pages);
    const live = new Set(this.pages.map(p => p.id));
    const gone = (this.removedPages || []).filter(id => !live.has(id));
    this.removedPages = [];
    // Undo keeps full page snapshots, so removed pages can be deleted right away.
    if (gone.length) await db.delMany('pages', gone);
    this.note.pageIds = this.pages.map(p => p.id);
    this.note.modified = Date.now();
    this.note.searchText = buildSearchText(this.note, this.pages) + '\n' + (this.audio ? this.audio.transcriptText().toLowerCase() : '');
    await db.put('notes', this.note);
  }

  bindGlobal() {
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.note) this.flush(); });
    window.addEventListener('pagehide', () => { if (this.note) this.flush(); });
    window.addEventListener('resize', () => {
      if (!this.note) return;
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.layout(), 150);
    });
    document.addEventListener('keydown', e => {
      if (!this.note || this.root.classList.contains('hidden')) return;
      if (e.target.closest && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); this.redo(); }
      else if (mod && e.key.toLowerCase() === 'c' && this.sel) { this.copySel(); }
      else if (mod && e.key.toLowerCase() === 'x' && this.sel) { this.copySel(); this.deleteSel(); }
      else if (mod && e.key.toLowerCase() === 'v' && this.clipboard) { e.preventDefault(); const pe = this.pageEls.get(this.pages[this.currentPageIndex()].id); this.paste(pe, null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.sel) { e.preventDefault(); this.deleteSel(); }
      else if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); this.setZoom(this.zoom * 1.2); }
      else if (mod && e.key === '-') { e.preventDefault(); this.setZoom(this.zoom / 1.2); }
      else if (!mod) {
        const map = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', t: 'text', s: 'shape', k: 'laser' };
        if (map[e.key]) this.selectTool(map[e.key]);
      }
    });
  }

  // ---------- pages ----------
  addPage(index, opts = {}) {
    const p = newPage(this.note);
    const ref = this.pages[Math.max(0, index - 1)];
    if (ref && !ref.bgBlob && !opts.fresh) { p.w = ref.w; p.h = ref.h; if (ref.template) p.template = ref.template; if (ref.paper) p.paper = ref.paper; }
    this.recordPages(() => this.pages.splice(index, 0, p));
    requestAnimationFrame(() => this.scrollToPage(index));
    return p;
  }

  scrollToPage(i, smooth = true) {
    const p = this.pages[i];
    const pe = p && this.pageEls.get(p.id);
    if (!pe) return;
    if (this.horizontal) this.scroller.scrollTo({ left: pe.el.offsetLeft - (this.scroller.clientWidth - pe.el.offsetWidth) / 2, behavior: smooth ? 'smooth' : 'auto' });
    else this.scroller.scrollTo({ top: pe.el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
  }

  deletePage(i) {
    if (this.pages.length === 1) {
      this.recordPages(() => { this.pages.splice(0, 1, newPage(this.note)); });
      return;
    }
    this.recordPages(() => this.pages.splice(i, 1));
    toast('Page deleted (undo to restore)');
  }

  duplicatePage(i) {
    const c = structuredClone(this.pages[i]);
    c.id = uid();
    for (const it of c.items) { it.id = uid(); delete it.rec; }
    this.recordPages(() => this.pages.splice(i + 1, 0, c));
  }

  movePage(i, d) {
    const j = i + d;
    if (j < 0 || j >= this.pages.length) return;
    this.recordPages(() => { const [p] = this.pages.splice(i, 1); this.pages.splice(j, 0, p); });
  }

  async toggleBookmark(i) {
    const p = this.pages[i];
    if (!p.bookmark) {
      const t = await prompt('Bookmark title', p.bookmarkTitle || firstText(p) || `Page ${i + 1}`, { ok: 'Bookmark' });
      if (t == null) return;
      p.bookmark = true; p.bookmarkTitle = t;
    } else p.bookmark = false;
    this.markDirty(p);
    this.rebuildPages();
  }

  toggleThumbs() {
    this.thumbsEl.classList.toggle('hidden');
    if (!this.thumbsEl.classList.contains('hidden')) this.renderThumbs();
    setTimeout(() => this.layout(), 20);
  }

  renderThumbs() {
    const box = this.thumbsEl;
    box.innerHTML = '';
    const outline = this.thumbFilter === 'outline';
    box.append(el('div', { class: 'panel-head' },
      el('div', { class: 'seg small', style: { margin: 0 } },
        el('button', { class: outline ? '' : 'on', onclick: () => { this.thumbFilter = 'all'; this.renderThumbs(); } }, 'Pages'),
        el('button', { class: outline ? 'on' : '', onclick: () => { this.thumbFilter = 'outline'; this.renderThumbs(); } }, 'Outline'))));
    this.thumbCanvases = new Map();
    if (outline) {
      const list = el('div', { class: 'outline-list' });
      this.pages.forEach((p, i) => {
        if (!p.bookmark) return;
        list.append(el('button', { class: 'outline-row', onclick: () => this.scrollToPage(i) },
          el('span', { class: 'bm-icon', html: icon.bookmark }), el('span', {}, p.bookmarkTitle || `Page ${i + 1}`), el('span', { class: 'ol-page' }, String(i + 1))));
      });
      if (!list.children.length) list.append(el('p', { class: 'muted pad', style: { fontSize: '13.5px' } }, 'Bookmark pages from the Pages tab (… menu) to build an outline of this note.'));
      box.append(list);
      return;
    }
    const list = el('div', { class: 'thumb-list' });
    box.append(list);
    const cur = this.currentPageIndex();
    this.pages.forEach((p, i) => {
      const c = el('canvas', { class: 'thumb-canvas' });
      this.thumbCanvases.set(p.id, c);
      const item = el('div', { class: 'thumb' + (p.bookmark ? ' bm' : '') + (i === cur ? ' current' : '') },
        el('button', { class: 'thumb-img', onclick: () => this.scrollToPage(i) }, c),
        el('div', { class: 'thumb-foot' },
          el('span', {}, String(i + 1)),
          p.bookmark ? el('span', { class: 'bm-icon', html: icon.bookmark }) : null,
          el('button', { class: 'icon-btn small', html: icon.more, onclick: e => this.pageMenu(i, e.currentTarget) })));
      list.append(item);
      this.drawThumb(p, c);
    });
    list.append(el('button', { class: 'btn block', onclick: () => this.addPage(this.pages.length) }, '+ Add Page'));
  }

  async drawThumb(p, c) {
    const s = 150 / p.w;
    c.width = 150 * 2; c.height = Math.round(p.h * s) * 2;
    c.style.width = '150px'; c.style.height = Math.round(p.h * s) + 'px';
    const ctx = c.getContext('2d');
    ctx.scale(s * 2, s * 2);
    const images = new Map();
    const ids = p.items.filter(i => i.type === 'image').map(i => i.blob);
    if (p.bgBlob) ids.push(p.bgBlob);
    await Promise.all(ids.map(async id => images.set(id, await loadImage(id))));
    drawBackground(ctx, p, this.note, images);
    for (const it of p.items) drawItem(ctx, it, images);
  }

  refreshThumb(page) {
    const c = this.thumbCanvases && this.thumbCanvases.get(page.id);
    if (c) this.drawThumb(page, c);
  }

  pageMenu(i, anchor) {
    const p = this.pages[i];
    menu(anchor, [
      { label: 'Insert page after', icon: 'plus', action: () => this.addPage(i + 1) },
      { label: 'Duplicate page', icon: 'copy', action: () => this.duplicatePage(i) },
      { label: p.bookmark ? 'Remove bookmark' : 'Bookmark page', icon: 'bookmark', action: () => this.toggleBookmark(i) },
      { label: 'Move up', icon: 'back', action: () => this.movePage(i, -1) },
      { label: 'Move down', icon: 'back', action: () => this.movePage(i, 1) },
      !p.bgBlob ? { label: 'Paper for this page…', icon: 'paper', action: () => this.paperSheet(i) } : null,
      { label: 'Share page as image', icon: 'share', action: async () => shareOrDownload(await renderPageBlob(p, this.note, 2, 'image/png'), `${this.note.title} p${i + 1}.png`) },
      '-',
      { label: 'Delete page', icon: 'trash', danger: true, action: () => this.deletePage(i) },
    ]);
  }

  // ---------- search ----------
  toggleSearch() {
    const box = this.searchEl;
    if (box.classList.contains('transcript-panel')) { box.classList.remove('transcript-panel'); box.classList.add('hidden'); }
    box.classList.toggle('hidden');
    if (box.classList.contains('hidden')) { setTimeout(() => this.layout(), 20); return; }
    box.innerHTML = '';
    const input = el('input', { type: 'search', class: 'field', placeholder: 'Search typed text and PDF text' });
    const results = el('div', { class: 'search-results' });
    const run = () => {
      results.innerHTML = '';
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      let count = 0;
      this.pages.forEach((p, i) => {
        const texts = [];
        for (const it of p.items) if (it.type === 'text' && it.text) texts.push(it.text);
        if (p.pdfText) texts.push(p.pdfText);
        for (const t of texts) {
          let idx = t.toLowerCase().indexOf(q);
          while (idx >= 0 && count < 200) {
            count++;
            const snip = t.slice(Math.max(0, idx - 30), idx + q.length + 40);
            const hi = snip.toLowerCase().indexOf(q);
            results.append(el('button', { class: 'search-hit', onclick: () => this.scrollToPage(i) },
              el('span', { class: 'hit-page' }, 'Page ' + (i + 1)),
              el('span', {}, '…' + snip.slice(0, hi), el('mark', {}, snip.slice(hi, hi + q.length)), snip.slice(hi + q.length) + '…')));
            idx = t.toLowerCase().indexOf(q, idx + q.length);
          }
        }
      });
      for (const r of this.audio.recs) for (const seg of r.transcript || []) {
        const t = seg.text, i0 = t.toLowerCase().indexOf(q);
        if (i0 < 0 || count >= 200) continue;
        count++;
        results.append(el('button', { class: 'search-hit', onclick: () => this.audio.seekTo(r, seg.t) },
          el('span', { class: 'hit-page' }, `${r.name} · ${fmtTime(seg.t / 1000)}`),
          el('span', {}, t.slice(0, i0), el('mark', {}, t.slice(i0, i0 + q.length)), t.slice(i0 + q.length))));
      }
      if (!count) results.append(el('p', { class: 'muted pad' }, 'No matches. Search covers typed text, PDF text and audio transcripts; handwriting is not searchable.'));
    };
    input.addEventListener('input', run);
    box.append(el('div', { class: 'search-head' }, input, el('button', { class: 'icon-btn', html: icon.close, onclick: () => this.toggleSearch() })), results);
    setTimeout(() => { input.focus(); this.layout(); }, 30);
  }

  // ---------- menus ----------
  async rename() {
    const v = await prompt('Rename note', this.note.title);
    if (!v) return;
    this.note.title = v;
    this.noteDirty = true;
    await this.flush();
    this.renderTabs();
  }

  shareMenu(anchor) {
    menu(anchor, [
      { label: 'Export as PDF', icon: 'share', action: () => this.exportPdf() },
      { label: 'Share current page as image', icon: 'image', action: async () => { const i = this.currentPageIndex(); shareOrDownload(await renderPageBlob(this.pages[i], this.note, 2, 'image/png'), `${this.note.title} p${i + 1}.png`); } },
      { label: 'Export note backup (.inkwell)', icon: 'import', action: async () => { await this.flush(); shareOrDownload(await exportBackup([this.note.id]), `${this.note.title}.inkwell.json`); } },
      { label: 'Print', icon: 'paper', action: () => this.print() },
    ]);
  }

  async exportPdf() {
    await this.flush();
    toast('Building PDF…', 60000);
    try {
      const blob = await exportPdf(this.note, this.pages, (i, n) => toast(`Building PDF… page ${i} of ${n}`, 60000));
      toast('PDF ready');
      await shareOrDownload(blob, `${this.note.title}.pdf`);
    } catch (e) { console.error(e); toast('PDF export failed: ' + e.message); }
  }

  async print() {
    toast('Preparing pages…', 30000);
    const urls = [];
    for (const p of this.pages) urls.push(URL.createObjectURL(await renderPageBlob(p, this.note, 2)));
    const box = el('div', { id: 'print-root' }, urls.map(u => el('img', { src: u })));
    document.body.append(box);
    toast('Opening print…');
    await Promise.all([...box.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
    window.print();
    setTimeout(() => { box.remove(); urls.forEach(u => URL.revokeObjectURL(u)); }, 2000);
  }

  moreMenu(anchor) {
    menu(anchor, [
      { label: 'Paper & Templates…', icon: 'paper', action: () => this.paperSheet() },
      { label: 'Add Page', icon: 'plus', action: () => this.addPage(this.currentPageIndex() + 1) },
      { label: 'Insert PDF Pages…', icon: 'import', action: () => this.insertPdf() },
      { label: 'Insert Photo as Page…', icon: 'image', action: () => this.insertImagePage() },
      { label: 'Bookmark This Page', icon: 'bookmark', checked: !!this.pages[this.currentPageIndex()]?.bookmark, action: () => this.toggleBookmark(this.currentPageIndex()) },
      '-',
      { label: 'Recordings & Transcript', icon: 'mic', action: () => this.audio.showBar(true) },
      { label: 'Make Flashcard…', icon: 'cards', action: () => this.app.study.cardFromText(this.note) },
      { label: 'Present', icon: 'present', action: () => this.togglePresent() },
      '-',
      { label: 'Draw with Apple Pencil Only', icon: 'pencil', checked: this.pencilOnly, action: () => { this.pencilOnly = !this.pencilOnly; saveSettings({ pencilAuto: true }); this.persistTools(); this.applyTouchAction(); toast(this.pencilOnly ? 'Fingers scroll, Pencil draws' : 'Fingers draw too (two fingers scroll)'); } },
      { label: this.horizontal ? 'Scroll Pages Vertically' : 'Scroll Pages Horizontally', icon: 'sort', action: () => { saveSettings({ scrollDir: this.horizontal ? 'vertical' : 'horizontal' }); this.reopen(); } },
      { label: 'Zoom to Fit', icon: 'zoom', action: () => this.setZoom(1) },
      { label: 'Rename', icon: 'text', action: () => this.rename() },
      { label: 'Tips & Gestures', icon: 'hand', action: () => this.app.showHelp() },
    ]);
  }

  async reopen() {
    const n = this.note;
    await this.close();
    await this.open(n);
  }

  togglePresent() {
    const on = !this.root.classList.contains('presenting');
    this.root.classList.toggle('presenting', on);
    this.presentBar && this.presentBar.remove();
    this.presentBar = null;
    if (on) {
      this.prePresentTool = this.tool;
      this.selectTool('laser');
      const b = (ic, t, title) => el('button', { class: 'icon-btn' + (this.tool === t ? ' on' : ''), title, html: icon[ic], onclick: () => { this.selectTool(t); this.togglePresentBar(); } });
      this.togglePresentBar = () => {
        this.presentBar && this.presentBar.remove();
        this.presentBar = el('div', { class: 'present-exit' }, b('laser', 'laser', 'Laser'), b('pen', 'pen', 'Pen'), b('hand', 'hand', 'Scroll'),
          el('button', { class: 'icon-btn', title: 'Exit presentation', html: icon.close, onclick: () => this.togglePresent() }));
        this.root.querySelector('.scroll-wrap').append(this.presentBar);
      };
      this.togglePresentBar();
      toast('Presenting: laser pointer is on');
    } else if (this.prePresentTool) this.selectTool(this.prePresentTool);
    setTimeout(() => this.layout(), 30);
  }

  setAllTape(covered) {
    const pe = this.pageEls.get(this.pages[this.currentPageIndex()].id);
    let n = 0;
    for (const it of pe.page.items) if (it.type === 'tape') { it.revealed = !covered; n++; }
    if (!n) { toast('No tape on this page'); return; }
    this.markDirty(pe.page);
    this.rerender(pe);
  }

  paperSheet(pageIndex = null) {
    const target = pageIndex == null ? this.note : this.pages[pageIndex];
    const cur = { template: target.template || this.note.template, paper: target.paper || this.note.paper };
    const content = el('div', { class: 'paper-sheet' });
    const render = () => {
      content.innerHTML = '';
      const grid = el('div', { class: 'tpl-grid' });
      for (const [k, label] of TEMPLATES) {
        const c = el('canvas', { width: 136, height: 176 });
        const ctx = c.getContext('2d'); ctx.scale(136 / 816, 176 / 1056);
        drawPaper(ctx, 816, 1056, k, cur.paper, 3.5);
        grid.append(el('button', { class: 'tpl' + (cur.template === k ? ' on' : ''), onclick: () => { cur.template = k; render(); } }, c, el('span', {}, label)));
      }
      const colors = el('div', { class: 'paper-colors' });
      for (const [k, v] of Object.entries(PAPER_COLORS)) colors.append(el('button', { class: 'swatch big' + (cur.paper === k ? ' active' : ''), style: { '--c': v.bg }, title: k, onclick: () => { cur.paper = k; render(); } }));
      const sizes = el('select', { class: 'field' });
      for (const k of Object.keys(PAGE_SIZES)) sizes.append(el('option', { value: k, selected: (this.note.pageSize || 'letter') === k }, { letter: 'US Letter', a4: 'A4', letterLandscape: 'Letter landscape', a4Landscape: 'A4 landscape', square: 'Square' }[k]));
      content.append(el('h4', {}, 'Template'), grid, el('h4', {}, 'Paper color'), colors);
      if (pageIndex == null) content.append(el('h4', {}, 'Size of new pages'), sizes);
      content.append(el('div', { class: 'dialog-actions' },
        pageIndex == null ? el('button', { class: 'btn', onclick: () => apply(false) }, 'New pages only') : null,
        el('button', { class: 'btn primary', onclick: () => apply(true) }, pageIndex == null ? 'Apply to all pages' : 'Apply to page')));
      content._sizes = sizes;
    };
    const apply = all => {
      if (pageIndex == null) {
        this.note.template = cur.template; this.note.paper = cur.paper; this.note.pageSize = content._sizes.value;
        saveSettings({ template: cur.template, paper: cur.paper, pageSize: content._sizes.value });
        if (all) for (const p of this.pages) { delete p.template; delete p.paper; this.markDirty(p); }
      } else {
        target.template = cur.template; target.paper = cur.paper; this.markDirty(target);
      }
      this.noteDirty = true;
      this.flush();
      this.adaptInk(); this.renderSwatches();
      this.rerenderAll();
      if (!this.thumbsEl.classList.contains('hidden')) this.renderThumbs();
      m.close();
    };
    render();
    const m = sheet(pageIndex == null ? 'Paper' : `Paper for page ${pageIndex + 1}`, content);
  }

  async insertImage() {
    const [file] = await pickFile('image/*');
    if (!file) return;
    await this.insertImageBlob(file, 0.6);
    toast('Drag to move, pull the corner to resize');
  }

  // Place an image (photo, sticker or saved element) in the middle of the visible page.
  async insertImageBlob(blob, frac = 0.6, existingId = null) {
    const i = this.currentPageIndex();
    const pe = this.pageEls.get(this.pages[i].id);
    const blobId = existingId || await putBlob(blob);
    const bmp = await loadImage(blobId);
    if (!bmp) { toast('Could not read that image'); return; }
    const maxW = pe.page.w * frac, maxH = pe.page.h * frac * 0.8;
    const s = Math.min(1, maxW / bmp.width, maxH / bmp.height);
    const w = bmp.width * s, h = bmp.height * s;
    const view = this.horizontal ? 0 : Math.max(0, (this.scroller.scrollTop - pe.el.offsetTop) / this.scale);
    const visH = this.scroller.clientHeight / this.scale;
    const x = (pe.page.w - w) / 2, y = Math.max(10, Math.min(pe.page.h - h - 10, view + (Math.min(visH, pe.page.h) - h) / 2));
    const item = { id: uid(), type: 'image', blob: blobId, pts: [[x, y], [x + w, y + h]] };
    this.addItems(pe, [item]);
    this.selectTool('lasso');
    this.setSelection(pe, [item.id]);
  }

  stickerPicker(anchor) {
    const box = el('div', { class: 'sticker-pop' });
    const tab = this.stickerTab || 'stickers';
    const render = async () => {
      box.innerHTML = '';
      box.append(el('div', { class: 'seg small' },
        el('button', { class: this.stickerTab !== 'mine' ? 'on' : '', onclick: () => { this.stickerTab = 'stickers'; render(); } }, 'Stickers'),
        el('button', { class: this.stickerTab === 'mine' ? 'on' : '', onclick: () => { this.stickerTab = 'mine'; render(); } }, 'My Elements')));
      const grid = el('div', { class: 'sticker-grid' });
      box.append(grid);
      if (this.stickerTab === 'mine') {
        const els = (await db.all('elements')).sort((a, b) => b.created - a.created);
        if (!els.length) { box.append(el('p', { class: 'muted', style: { fontSize: '13px', margin: '8px 4px' } }, 'Lasso anything on a page and choose "Save Element" to reuse it here.')); return; }
        for (const e of els) {
          const b = await getBlob(e.blob);
          if (!b) continue;
          const url = URL.createObjectURL(b);
          grid.append(el('button', { title: 'Insert (long-press menu to delete)', onclick: () => { closePopover(); this.insertImageBlob(null, 0.5, e.blob); },
            oncontextmenu: async ev => { ev.preventDefault(); if (await confirm('Delete this element?', '', { ok: 'Delete', danger: true })) { await db.del('elements', e.id); render(); } } },
          el('img', { src: url, alt: '' })));
        }
        return;
      }
      for (const c of STICKY) grid.append(el('button', { title: 'Sticky note', onclick: async () => { closePopover(); this.insertImageBlob(await stickyBlob(c), 0.32); } },
        el('span', { style: { width: '70%', height: '70%', background: c, borderRadius: '3px', boxShadow: '0 2px 4px rgba(0,0,0,.18)', display: 'block' } })));
      for (const em of EMOJI) grid.append(el('button', { onclick: async () => { closePopover(); this.insertImageBlob(await emojiBlob(em), 0.12); } }, em));
    };
    void tab;
    render();
    popover(anchor, box);
  }

  async insertPdf() {
    const [file] = await pickFile('application/pdf');
    if (!file) return;
    try {
      const pages = await pdfToPages(file, (i, n) => toast(`Importing page ${i} of ${n}…`, 60000));
      const at = this.currentPageIndex() + 1;
      const objs = pages.map(p => ({ ...p, id: uid(), noteId: this.note.id }));
      this.recordPages(() => this.pages.splice(at, 0, ...objs));
      toast(`Inserted ${objs.length} page${objs.length > 1 ? 's' : ''}`);
      this.scrollToPage(at);
    } catch (e) { console.error(e); toast('Could not import PDF: ' + e.message); }
  }

  async insertImagePage() {
    const files = await pickFile('image/*', true);
    if (!files.length) return;
    const at = this.currentPageIndex() + 1;
    const objs = [];
    for (const f of files) objs.push({ ...(await imageToPage(f)), id: uid(), noteId: this.note.id });
    this.recordPages(() => this.pages.splice(at, 0, ...objs));
    this.scrollToPage(at);
  }
}

function firstText(p) {
  const t = p.items.find(i => i.type === 'text' && i.text && i.text.trim());
  return t ? t.text.trim().split('\n')[0].slice(0, 40) : '';
}

function segDist(a, b, c, d) {
  return Math.min(distToSeg(c[0], c[1], a, b), distToSeg(d[0], d[1], a, b), distToSeg(a[0], a[1], c, d), distToSeg(b[0], b[1], c, d));
}
