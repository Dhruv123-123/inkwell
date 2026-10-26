// App shell: the library (subjects, dividers, notebooks), tabs and view switching.
import { db, uid } from './db.js';
import { icon, el, toast, menu, prompt, confirm, sheet, pickFile, shareOrDownload, fmtDate, alertBox } from './ui.js';
import {
  createNote, deleteNote, duplicateNote, loadPages, pdfToPages, imageToPage, exportPdf,
  exportBackup, importBackup, settings, saveSettings, SUBJECT_COLORS, COVER_COLORS, COVER_PATTERNS,
} from './store.js';
import { TEMPLATES, PAPER_COLORS, PAGE_SIZES, drawPaper } from './render.js';
import { Editor } from './editor.js';
import { StudyView } from './study.js';

export function applyTheme(theme = settings().theme || 'system') {
  const r = document.documentElement;
  if (theme === 'system') r.removeAttribute('data-theme'); else r.dataset.theme = theme;
}

// A notebook cover, or the first page for notes without one.
export function coverEl(note, { label = true } = {}) {
  if (note.cover && note.cover !== 'none') {
    const [color, pattern = 'plain'] = note.cover.split(':');
    return el('div', { class: `cover p-${pattern}`, style: { '--cv': COVER_COLORS[color] || color } },
      el('div', { class: 'cv-pattern' }),
      null);
  }
  return el('div', { class: 'paper-thumb' }, note.thumb ? el('img', { src: note.thumb, alt: '' }) : el('div', { class: 'blank-thumb' + (/dark|black/.test(note.paper || '') ? ' dark' : '') }));
}

class App {
  constructor() {
    applyTheme();
    this.libEl = document.getElementById('library');
    this.edEl = document.getElementById('editor');
    const s = settings();
    this.filter = s.filter || { kind: 'all' };
    this.sort = s.sort || 'modified';
    this.view = s.view || 'grid';
    this.tabs = s.tabs || [];
    this.query = '';
    this.editor = new Editor(this);
    this.study = new StudyView(this);
  }

  async start() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    this.buildLibrary();
    await this.refresh();
    window.addEventListener('popstate', () => { if (!location.hash.startsWith('#note=') && this.editor.note) this.showLibrary(true); });
    const m = location.hash.match(/^#note=(.+)$/);
    if (m) { const n = await db.get('notes', m[1]); if (n) this.openNote(n, true); }
    if (!settings().seenHelp) { saveSettings({ seenHelp: true }); setTimeout(() => this.showHelp(), 400); }
  }

  // ---------- data ----------
  async refresh() {
    [this.dividers, this.subjects, this.notes] = await Promise.all([db.all('dividers'), db.all('subjects'), db.all('notes')]);
    this.dividers.sort((a, b) => a.order - b.order);
    this.subjects.sort((a, b) => a.order - b.order);
    if (this.filter.kind === 'subject' && !this.subjects.find(s => s.id === this.filter.id)) this.filter = { kind: 'all' };
    const ids = new Set(this.notes.map(n => n.id));
    this.tabs = this.tabs.filter(id => ids.has(id));
    this.renderSidebar();
    await this.renderMain();
  }

  // ---------- library DOM ----------
  buildLibrary() {
    this.sideList = el('nav', { class: 'side-list' });
    const footBtn = (ic, label, fn) => el('button', { class: 'side-btn', onclick: () => { this.libEl.classList.remove('side-open'); fn(); } }, el('span', { html: icon[ic] }), label);
    this.sidebar = el('aside', { class: 'sidebar' },
      el('div', { class: 'brand' }, el('img', { src: 'icons/icon-192.png', alt: '' }), el('span', {}, 'Inkwell')),
      this.sideList,
      el('div', { class: 'side-foot' },
        footBtn('import', 'Backup', () => this.backupSheet()),
        footBtn('settings', 'Settings', () => this.settingsSheet()),
        footBtn('hand', 'Help', () => this.showHelp())));
    this.searchInput = el('input', { type: 'search', class: 'field', placeholder: 'Search titles, typed text, PDFs and transcripts' });
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value.trim().toLowerCase(); this.renderMain(); });
    this.titleH = el('h1', {});
    this.titleSub = el('div', { class: 'sub' });
    this.viewSeg = el('div', { class: 'seg-icons' });
    this.content = el('div', { class: 'lib-scroll' });
    this.toolsRow = el('div', { class: 'lib-tools' },
      el('div', { class: 'search-wrap' }, el('span', { html: icon.search }), this.searchInput),
      this.viewSeg,
      el('button', { class: 'icon-btn', html: icon.sort, title: 'Sort', onclick: e => this.sortMenu(e.currentTarget) }));
    const main = el('main', { class: 'lib-main' },
      el('header', { class: 'lib-head' },
        el('button', { class: 'icon-btn side-toggle', html: icon.sidebar, title: 'Subjects', onclick: () => this.libEl.classList.toggle('side-open') }),
        el('div', { class: 'lib-title' }, this.titleH, this.titleSub),
        el('div', { class: 'lib-actions' },
          el('button', { class: 'btn', onclick: e => this.importMenu(e.currentTarget) }, el('span', { html: icon.import }), el('span', {}, 'Import')),
          el('button', { class: 'btn primary', onclick: e => this.newMenu(e.currentTarget) }, el('span', { html: icon.plus }), 'New'))),
      this.toolsRow,
      this.installHint(),
      this.content);
    this.libEl.append(this.sidebar, main, el('div', { class: 'side-scrim', onclick: () => this.libEl.classList.remove('side-open') }));
  }

  installHint() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone || settings().hideInstall) return null;
    const box = el('div', { class: 'install-hint' },
      el('span', { class: 'ih-icon', html: icon.share }),
      el('div', {}, el('strong', {}, 'Add Inkwell to your Home Screen. '), 'In Safari tap Share, then "Add to Home Screen" for a full-screen app that works offline.'),
      el('button', { class: 'icon-btn small', html: icon.close, onclick: () => { saveSettings({ hideInstall: true }); box.remove(); } }));
    return box;
  }

  renderSidebar() {
    const L = this.sideList;
    L.innerHTML = '';
    const count = f => this.notes.filter(f).length;
    const row = (label, iconEl, filter, n, extra = {}) => {
      const active = this.filter.kind === filter.kind && this.filter.id === filter.id;
      return el('div', { class: 'side-row' + (active ? ' active' : ''), onclick: () => this.setFilter(filter) },
        iconEl, el('span', { class: 'side-label' }, label),
        n != null ? el('span', { class: 'side-count' }, String(n)) : null,
        extra.menu ? el('button', { class: 'icon-btn small', html: icon.more, onclick: e => { e.stopPropagation(); extra.menu(e.currentTarget); } }) : null);
    };
    const sic = name => el('span', { class: 'side-icon', html: icon[name] });
    L.append(
      row('All Notes', sic('notes'), { kind: 'all' }, this.notes.length),
      row('Recents', sic('clock'), { kind: 'recent' }, null),
      row('Favorites', sic('star'), { kind: 'favorites' }, count(n => n.favorite)),
      row('Unfiled', sic('inbox'), { kind: 'unfiled' }, count(n => !n.subjectId || !this.subjects.find(s => s.id === n.subjectId))),
      row('Study Sets', sic('cards'), { kind: 'study' }, null));
    L.append(el('div', { class: 'side-head' }, el('span', {}, 'Subjects'),
      el('button', { class: 'icon-btn small', html: icon.plus, title: 'New subject or divider', onclick: e => menu(e.currentTarget, [
        { label: 'New Subject', icon: 'folder', action: () => this.newSubject() },
        { label: 'New Divider', icon: 'divider', action: () => this.newDivider() },
      ]) })));
    const subjRow = s => row(s.name, el('span', { class: 'subj-icon', style: { '--sc': s.color }, html: icon.folder }), { kind: 'subject', id: s.id },
      count(n => n.subjectId === s.id), { menu: a => this.subjectMenu(s, a) });
    for (const s of this.subjects.filter(s => !s.dividerId || !this.dividers.find(d => d.id === s.dividerId))) L.append(subjRow(s));
    for (const d of this.dividers) {
      const kids = this.subjects.filter(s => s.dividerId === d.id);
      L.append(el('div', { class: 'divider-row', onclick: () => { d.collapsed = !d.collapsed; db.put('dividers', d); this.renderSidebar(); } },
        el('span', { class: 'chev' + (d.collapsed ? '' : ' open'), html: icon.back }),
        el('span', { class: 'side-label' }, d.name),
        el('button', { class: 'icon-btn small', html: icon.plus, title: 'New subject in divider', onclick: e => { e.stopPropagation(); this.newSubject(d.id); } }),
        el('button', { class: 'icon-btn small', html: icon.more, onclick: e => { e.stopPropagation(); this.dividerMenu(d, e.currentTarget); } })));
      if (!d.collapsed) {
        const wrap = el('div', { class: 'divider-kids' }, kids.map(subjRow));
        if (!kids.length) wrap.append(el('div', { class: 'muted side-empty' }, 'No subjects yet'));
        L.append(wrap);
      }
    }
    if (!this.subjects.length && !this.dividers.length) L.append(el('p', { class: 'muted side-empty' }, 'Make a subject for each class or project, and group subjects with dividers.'));
  }

  setFilter(f) {
    this.filter = f;
    saveSettings({ filter: f });
    this.libEl.classList.remove('side-open');
    this.renderSidebar();
    this.renderMain();
  }

  filteredNotes() {
    let list = this.notes.slice();
    const f = this.filter;
    if (f.kind === 'favorites') list = list.filter(n => n.favorite);
    else if (f.kind === 'unfiled') list = list.filter(n => !n.subjectId || !this.subjects.find(s => s.id === n.subjectId));
    else if (f.kind === 'subject') list = list.filter(n => n.subjectId === f.id);
    if (this.query) {
      const q = this.query;
      list = list.filter(n => (n.searchText || n.title.toLowerCase()).includes(q) || (this.subjectOf(n)?.name || '').toLowerCase().includes(q));
    }
    const by = this.sort;
    list.sort((a, b) => by === 'title' ? a.title.localeCompare(b.title) : by === 'created' ? b.created - a.created : b.modified - a.modified);
    if (f.kind === 'recent' && !this.query) list = list.sort((a, b) => b.modified - a.modified).slice(0, 18);
    return list;
  }

  subjectOf(n) { return this.subjects.find(s => s.id === n.subjectId); }

  async renderMain() {
    const f = this.filter;
    const isStudy = f.kind === 'study';
    this.toolsRow.classList.toggle('hidden', isStudy);
    this.titleH.textContent = f.kind === 'subject' ? (this.subjects.find(s => s.id === f.id)?.name || 'Subject')
      : { all: 'All Notes', recent: 'Recents', favorites: 'Favorites', unfiled: 'Unfiled', study: 'Study Sets' }[f.kind];
    if (isStudy) { this.titleSub.textContent = 'Flashcards with spaced repetition'; await this.study.renderSets(this.content); return; }
    this.viewSeg.innerHTML = '';
    for (const [v, ic] of [['grid', 'grid'], ['list', 'list']]) this.viewSeg.append(el('button', { class: this.view === v ? 'on' : '', html: icon[ic], title: v === 'grid' ? 'Grid' : 'List', onclick: () => { this.view = v; saveSettings({ view: v }); this.renderMain(); } }));
    const list = this.filteredNotes();
    this.titleSub.textContent = `${list.length} ${list.length === 1 ? 'note' : 'notes'}`;
    const C = this.content;
    C.innerHTML = '';
    if (!list.length && (this.query || this.view === 'list' || f.kind !== 'all')) {
      C.append(el('div', { class: 'empty' },
        el('div', { class: 'empty-art', html: icon.notes }),
        el('h2', {}, this.query ? 'No matching notes' : 'Nothing here yet'),
        el('p', { class: 'muted' }, this.query ? 'Search looks at titles, typed text, PDF text and audio transcripts.' : 'Create a notebook, or import a PDF to annotate.'),
        this.query ? null : el('div', { class: 'empty-actions' },
          el('button', { class: 'btn primary', onclick: () => this.newNotebookDialog() }, 'New Notebook'),
          el('button', { class: 'btn', onclick: () => this.importPdfs() }, 'Import PDF'))));
      return;
    }
    if (this.view === 'list') {
      const box = el('div', { class: 'note-list' });
      for (const n of list) {
        const subj = this.subjectOf(n);
        box.append(el('div', { class: 'list-row', onclick: () => this.openNote(n) },
          el('div', { class: 'lr-thumb' }, coverEl(n, { label: false })),
          el('div', { class: 'lr-main' },
            el('div', { class: 'lr-title' }, n.title),
            el('div', { class: 'lr-sub' }, subj ? el('span', { class: 'chip' }, el('span', { class: 'dot', style: { background: subj.color } }), subj.name) : null,
              `${fmtDate(n.modified)} · ${n.pageIds.length} page${n.pageIds.length === 1 ? '' : 's'}`)),
          n.favorite ? el('span', { class: 'fav', style: { position: 'static' }, html: icon.star }) : null,
          el('button', { class: 'icon-btn small', html: icon.more, onclick: e => { e.stopPropagation(); this.noteMenu(n, e.currentTarget); } })));
      }
      C.append(box);
      return;
    }
    const g = el('div', { class: 'note-grid' });
    if (!this.query) g.append(el('div', { class: 'note-card new-card' },
      el('button', { class: 'card-thumb', onclick: e => this.newMenu(e.currentTarget) }, el('span', { class: 'plus-disc', html: icon.plus }), el('span', {}, 'New')),
      el('div', { class: 'card-meta' }, el('div', { class: 'card-text', style: { paddingLeft: 0 } }, el('div', { class: 'card-sub' }, 'Notebook, PDF or quick note')))));
    list.forEach((n, i) => {
      const subj = this.subjectOf(n);
      g.append(el('div', { class: 'note-card', style: { animationDelay: Math.min(i, 20) * 18 + 'ms' } },
        el('button', { class: 'card-thumb', onclick: () => this.openNote(n) },
          coverEl(n),
          n.favorite ? el('span', { class: 'fav', html: icon.star }) : null,
          n.hasAudio ? el('span', { class: 'rec-badge', html: icon.mic }) : null),
        el('div', { class: 'card-meta' },
          el('div', { class: 'card-text', onclick: () => this.openNote(n) },
            el('div', { class: 'card-title' }, n.title),
            el('div', { class: 'card-sub' }, subj ? el('span', { class: 'dot', style: { background: subj.color } }) : null, fmtDate(n.modified))),
          el('button', { class: 'icon-btn small', html: icon.more, onclick: e => this.noteMenu(n, e.currentTarget) }))));
    });
    C.append(g);
  }

  // ---------- notebooks ----------
  currentSubjectId() { return this.filter.kind === 'subject' ? this.filter.id : null; }

  newMenu(anchor) {
    menu(anchor, [
      { label: 'Notebook…', icon: 'notes', action: () => this.newNotebookDialog() },
      { label: 'Quick Note', icon: 'pen', action: () => this.quickNote() },
      '-',
      { label: 'Import PDF', icon: 'paper', action: () => this.importPdfs() },
      { label: 'Import Photos', icon: 'image', action: () => this.importImages() },
      '-',
      { label: 'New Subject', icon: 'folder', action: () => this.newSubject() },
      { label: 'New Study Set', icon: 'cards', action: () => { this.setFilter({ kind: 'study' }); this.study.newSet(); } },
    ]);
  }

  async quickNote() {
    const n = await createNote({ subjectId: this.currentSubjectId() });
    this.openNote(n);
  }

  newNotebookDialog() {
    const s = settings();
    const state = {
      title: '', cover: s.lastCover || 'navy:plain', template: 'blank', paper: 'black', pageSize: s.pageSize || 'letter',
      subjectId: this.currentSubjectId(),
    };
    const box = el('div', {});
    const m = sheet('New Notebook', box);
    m.box.querySelector('.dialog').classList.add('wide');
    const titleIn = el('input', { class: 'field', placeholder: 'Untitled Notebook', value: '' });
    titleIn.oninput = () => { state.title = titleIn.value; drawPreview(); };
    const preview = el('div', { class: 'preview' });
    const drawPreview = () => { preview.innerHTML = ''; preview.append(coverEl({ cover: state.cover, title: state.title || 'Untitled Notebook' })); };
    const covers = el('div', { class: 'cover-grid' });
    const pats = el('div', { class: 'seg small' });
    const tpls = el('div', { class: 'tpl-grid' });
    const papers = el('div', { class: 'paper-colors' });
    const renderPickers = () => {
      const [col, pat = 'plain'] = state.cover.split(':');
      covers.innerHTML = '';
      covers.append(el('button', { class: 'cover-pick' + (state.cover === 'none' ? ' on' : ''), title: 'No cover', onclick: () => { state.cover = 'none'; renderPickers(); } },
        el('div', { class: 'paper-thumb', style: { height: '100%' } }, el('div', { class: 'blank-thumb' }))));
      for (const c of Object.keys(COVER_COLORS)) covers.append(el('button', {
        class: 'cover-pick' + (col === c && state.cover !== 'none' ? ' on' : ''), title: c,
        onclick: () => { state.cover = `${c}:${state.cover === 'none' ? 'plain' : pat}`; renderPickers(); },
      }, coverEl({ cover: `${c}:${state.cover === 'none' ? 'plain' : pat}` }, { label: false })));
      pats.innerHTML = '';
      for (const p of COVER_PATTERNS) pats.append(el('button', { class: pat === p && state.cover !== 'none' ? 'on' : '', onclick: () => { state.cover = `${state.cover === 'none' ? 'navy' : col}:${p}`; renderPickers(); } }, p[0].toUpperCase() + p.slice(1)));
      tpls.innerHTML = '';
      for (const [k, label] of TEMPLATES) {
        const c = el('canvas', { width: 136, height: 176 });
        const ctx = c.getContext('2d'); ctx.scale(136 / 816, 176 / 1056);
        drawPaper(ctx, 816, 1056, k, state.paper, 3.5);
        tpls.append(el('button', { class: 'tpl' + (state.template === k ? ' on' : ''), onclick: () => { state.template = k; renderPickers(); } }, c, el('span', {}, label)));
      }
      papers.innerHTML = '';
      for (const [k, v] of Object.entries(PAPER_COLORS)) papers.append(el('button', { class: 'swatch big' + (state.paper === k ? ' active' : ''), style: { '--c': v.bg }, title: k, onclick: () => { state.paper = k; renderPickers(); } }));
      drawPreview();
    };
    const sizeSel = el('select', { class: 'field' });
    for (const k of Object.keys(PAGE_SIZES)) sizeSel.append(el('option', { value: k, selected: state.pageSize === k }, { letter: 'US Letter', a4: 'A4', letterLandscape: 'Letter, landscape', a4Landscape: 'A4, landscape', square: 'Square' }[k]));
    sizeSel.onchange = () => { state.pageSize = sizeSel.value; };
    const subjSel = el('select', { class: 'field' }, el('option', { value: '' }, 'Unfiled'));
    for (const sb of this.subjects) subjSel.append(el('option', { value: sb.id, selected: sb.id === state.subjectId }, sb.name));
    subjSel.onchange = () => { state.subjectId = subjSel.value || null; };
    box.append(
      el('div', { class: 'new-nb' },
        el('div', {}, preview),
        el('div', {},
          el('div', { class: 'form-row' }, titleIn),
          el('div', { class: 'sec-label' }, 'Cover'), covers, el('div', { style: { height: '10px' } }), pats)),
      el('div', { class: 'sec-label' }, 'Paper'), tpls,
      el('div', { class: 'sec-label' }, 'Paper color'), papers,
      el('div', { class: 'new-nb', style: { gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '6px' } },
        el('div', {}, el('div', { class: 'sec-label' }, 'Page size'), sizeSel),
        el('div', {}, el('div', { class: 'sec-label' }, 'Subject'), subjSel)),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: async () => {
          saveSettings({ lastCover: state.cover, template: state.template, paper: state.paper, pageSize: state.pageSize });
          const n = await createNote({ title: state.title.trim() || 'Untitled Notebook', subjectId: state.subjectId, template: state.template, paper: state.paper, pageSize: state.pageSize, cover: state.cover });
          m.close();
          this.openNote(n);
        } }, 'Create')));
    renderPickers();
    setTimeout(() => titleIn.focus(), 60);
  }

  async openNote(n, fromHistory = false) {
    if (this.editor.note) await this.editor.close();
    if (!this.tabs.includes(n.id)) { this.tabs.push(n.id); if (this.tabs.length > 8) this.tabs.shift(); saveSettings({ tabs: this.tabs }); }
    this.libEl.classList.add('hidden');
    this.edEl.classList.remove('hidden');
    if (!fromHistory) history.pushState({ note: n.id }, '', '#note=' + n.id);
    else history.replaceState({ note: n.id }, '', '#note=' + n.id);
    this.notes = this.notes || [];
    await this.editor.open(n);
  }

  async closeTab(id) {
    this.tabs = this.tabs.filter(t => t !== id);
    saveSettings({ tabs: this.tabs });
    if (this.editor.note && this.editor.note.id === id) {
      const next = this.tabs[this.tabs.length - 1];
      const n = next && await db.get('notes', next);
      if (n) this.openNote(n, true); else this.showLibrary();
    } else this.editor.renderTabs();
  }

  async tabNotes() {
    const out = [];
    for (const id of this.tabs) { const n = id === this.editor.note?.id ? this.editor.note : await db.get('notes', id); if (n) out.push(n); }
    return out;
  }

  async showLibrary(fromHistory = false) {
    await this.editor.close();
    this.edEl.classList.add('hidden');
    this.libEl.classList.remove('hidden');
    if (!fromHistory && location.hash) history.pushState({}, '', location.pathname + location.search);
    await this.refresh();
  }

  noteMenu(n, anchor) {
    menu(anchor, [
      { label: 'Open', icon: 'notes', action: () => this.openNote(n) },
      { label: 'Rename', icon: 'text', action: async () => { const v = await prompt('Rename', n.title); if (v) { n.title = v; n.searchText = n.title.toLowerCase() + '\n' + (n.searchText || ''); await db.put('notes', n); this.refresh(); } } },
      { label: 'Change Cover…', icon: 'notes', action: () => this.coverSheet(n) },
      { label: 'Move to Subject…', icon: 'folder', action: () => this.moveNote(n) },
      { label: n.favorite ? 'Unfavorite' : 'Favorite', icon: 'star', action: async () => { n.favorite = !n.favorite; await db.put('notes', n); this.refresh(); } },
      { label: 'Duplicate', icon: 'copy', action: async () => { await duplicateNote(n); this.refresh(); toast('Duplicated'); } },
      { label: 'Export PDF', icon: 'share', action: () => this.exportNotePdf(n) },
      { label: 'Export Inkwell File', icon: 'import', action: async () => shareOrDownload(await exportBackup([n.id]), `${n.title}.inkwell.json`) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, action: async () => {
        if (!(await confirm(`Delete "${n.title}"?`, 'This removes the note, its pages and recordings from this device.', { ok: 'Delete', danger: true }))) return;
        await deleteNote(n); this.tabs = this.tabs.filter(t => t !== n.id); saveSettings({ tabs: this.tabs }); this.refresh(); toast('Deleted');
      } },
    ]);
  }

  coverSheet(n) {
    const grid = el('div', { class: 'cover-grid' });
    const m = sheet('Cover', grid);
    const set = async c => { n.cover = c; await db.put('notes', n); m.close(); this.refresh(); };
    grid.append(el('button', { class: 'cover-pick' + (!n.cover || n.cover === 'none' ? ' on' : ''), title: 'First page', onclick: () => set('none') }, el('div', { class: 'paper-thumb', style: { height: '100%' } }, n.thumb ? el('img', { src: n.thumb }) : el('div', { class: 'blank-thumb' }))));
    for (const c of Object.keys(COVER_COLORS)) for (const p of ['plain', 'dots', 'band']) {
      const id = `${c}:${p}`;
      grid.append(el('button', { class: 'cover-pick' + (n.cover === id ? ' on' : ''), onclick: () => set(id) }, coverEl({ cover: id }, { label: false })));
    }
  }

  async exportNotePdf(n) {
    toast('Building PDF…', 60000);
    try {
      const blob = await exportPdf(n, await loadPages(n), (i, t) => toast(`Building PDF… ${i}/${t}`, 60000));
      toast('PDF ready');
      shareOrDownload(blob, `${n.title}.pdf`);
    } catch (e) { toast('Export failed: ' + e.message); }
  }

  moveNote(n) {
    const list = el('div', { class: 'move-list' });
    const m = sheet('Move to Subject', list);
    const opt = (label, id, color) => list.append(el('button', { class: 'side-row' + ((n.subjectId || null) === id ? ' active' : ''), onclick: async () => { n.subjectId = id; await db.put('notes', n); m.close(); this.refresh(); } },
      color ? el('span', { class: 'subj-icon', style: { '--sc': color }, html: icon.folder }) : el('span', { class: 'side-icon', html: icon.inbox }), el('span', { class: 'side-label' }, label)));
    opt('Unfiled', null);
    for (const s of this.subjects) opt(s.name, s.id, s.color);
    list.append(el('button', { class: 'btn block', onclick: async () => { m.close(); const s = await this.newSubject(); if (s) { n.subjectId = s.id; await db.put('notes', n); this.refresh(); } } }, '+ New Subject'));
  }

  async newSubject(dividerId = null) {
    const name = await prompt('New Subject', '', { placeholder: 'e.g. Biology', ok: 'Create' });
    if (!name) return null;
    const s = { id: uid(), name, color: SUBJECT_COLORS[this.subjects.length % SUBJECT_COLORS.length], dividerId, order: Date.now() };
    await db.put('subjects', s);
    await this.refresh();
    this.setFilter({ kind: 'subject', id: s.id });
    return s;
  }

  async newDivider() {
    const name = await prompt('New Divider', '', { placeholder: 'e.g. Fall Semester', ok: 'Create' });
    if (!name) return;
    await db.put('dividers', { id: uid(), name, order: Date.now(), collapsed: false });
    this.refresh();
  }

  subjectMenu(s, anchor) {
    menu(anchor, [
      { label: 'Rename', icon: 'text', action: async () => { const v = await prompt('Rename Subject', s.name); if (v) { s.name = v; await db.put('subjects', s); this.refresh(); } } },
      { label: 'Color', icon: 'shapes', action: () => {
        const g = el('div', { class: 'color-grid' });
        const m = sheet('Subject Color', g);
        for (const c of SUBJECT_COLORS) g.append(el('button', { class: 'swatch big' + (s.color === c ? ' active' : ''), style: { '--c': c }, onclick: async () => { s.color = c; await db.put('subjects', s); m.close(); this.refresh(); } }));
      } },
      { label: 'Move to Divider…', icon: 'divider', action: () => {
        const list = el('div', { class: 'move-list' });
        const m = sheet('Move to Divider', list);
        const opt = (label, id) => list.append(el('button', { class: 'side-row' + ((s.dividerId || null) === id ? ' active' : ''), onclick: async () => { s.dividerId = id; await db.put('subjects', s); m.close(); this.refresh(); } }, el('span', { class: 'side-label' }, label)));
        opt('No Divider', null);
        for (const d of this.dividers) opt(d.name, d.id);
      } },
      { label: 'Move Up', icon: 'sort', action: () => this.reorderSubject(s, -1) },
      '-',
      { label: 'Delete Subject', icon: 'trash', danger: true, action: async () => {
        const n = this.notes.filter(x => x.subjectId === s.id);
        if (!(await confirm(`Delete "${s.name}"?`, n.length ? `Its ${n.length} note(s) are kept and moved to Unfiled.` : '', { ok: 'Delete', danger: true }))) return;
        for (const x of n) { x.subjectId = null; await db.put('notes', x); }
        await db.del('subjects', s.id); this.refresh();
      } },
    ]);
  }

  async reorderSubject(s, d) {
    const peers = this.subjects.filter(x => (x.dividerId || null) === (s.dividerId || null));
    const i = peers.indexOf(s), j = i + d;
    if (j < 0 || j >= peers.length) return;
    [peers[i].order, peers[j].order] = [peers[j].order, peers[i].order];
    if (peers[i].order === peers[j].order) peers[i].order -= 1;
    await db.putMany('subjects', [peers[i], peers[j]]);
    this.refresh();
  }

  dividerMenu(d, anchor) {
    menu(anchor, [
      { label: 'Rename', icon: 'text', action: async () => { const v = await prompt('Rename Divider', d.name); if (v) { d.name = v; await db.put('dividers', d); this.refresh(); } } },
      '-',
      { label: 'Delete Divider', icon: 'trash', danger: true, action: async () => {
        if (!(await confirm(`Delete "${d.name}"?`, 'Subjects inside it are kept.', { ok: 'Delete', danger: true }))) return;
        for (const s of this.subjects.filter(s => s.dividerId === d.id)) { s.dividerId = null; await db.put('subjects', s); }
        await db.del('dividers', d.id); this.refresh();
      } },
    ]);
  }

  sortMenu(anchor) {
    const set = s => { this.sort = s; saveSettings({ sort: s }); this.renderMain(); };
    menu(anchor, [
      { label: 'Date Modified', checked: this.sort === 'modified', action: () => set('modified') },
      { label: 'Date Created', checked: this.sort === 'created', action: () => set('created') },
      { label: 'Title', checked: this.sort === 'title', action: () => set('title') },
    ]);
  }

  importMenu(anchor) {
    menu(anchor, [
      { label: 'PDF Documents', icon: 'paper', action: () => this.importPdfs() },
      { label: 'Photos & Images', icon: 'image', action: () => this.importImages() },
      { label: 'Inkwell Backup', icon: 'import', action: () => this.restore() },
    ]);
  }

  async importPdfs() {
    const files = await pickFile('application/pdf', true);
    for (const f of files) {
      try {
        const pages = await pdfToPages(f, (i, n) => toast(`${f.name}: page ${i} of ${n}`, 60000));
        await createNote({ title: f.name.replace(/\.pdf$/i, ''), subjectId: this.currentSubjectId(), pages });
      } catch (e) { console.error(e); toast(`Could not import ${f.name}: ${e.message}`, 4000); }
    }
    if (files.length) { toast(`Imported ${files.length} PDF${files.length > 1 ? 's' : ''}`); this.refresh(); }
  }

  async importImages() {
    const files = await pickFile('image/*', true);
    if (!files.length) return;
    const pages = [];
    for (const f of files) pages.push(await imageToPage(f));
    await createNote({ title: 'Photos ' + new Date().toLocaleDateString(), subjectId: this.currentSubjectId(), pages });
    this.refresh();
  }

  async restore() {
    const [f] = await pickFile('.json,application/json');
    if (!f) return;
    try { const n = await importBackup(f); toast(`Restored ${n} note${n === 1 ? '' : 's'}`); this.refresh(); }
    catch (e) { alertBox('Could not restore', e.message); }
  }

  async backupSheet() {
    let usage = '';
    try { const est = await navigator.storage.estimate(); usage = `Using ${(est.usage / 1048576).toFixed(1)} MB on this device.`; } catch {}
    const m = sheet('Backup & Restore', el('div', { class: 'backup' },
      el('p', { class: 'muted' }, 'Notes live only on this device. Export a backup file (save it to Files or iCloud Drive) to keep a copy or move everything to another device. Backups include study sets and saved elements.'),
      usage ? el('p', { class: 'muted' }, usage) : null,
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', onclick: () => { m.close(); this.restore(); } }, 'Restore from File'),
        el('button', { class: 'btn primary', onclick: async () => { m.close(); toast('Preparing backup…', 30000); shareOrDownload(await exportBackup(), `Inkwell Backup ${new Date().toISOString().slice(0, 10)}.inkwell.json`); toast('Backup ready'); } }, 'Export Everything'))));
  }

  settingsSheet() {
    const s = settings();
    const box = el('div', {});
    const m = sheet('Settings', box);
    const seg = (key, opts, cur, onPick) => el('div', { class: 'seg' }, opts.map(([v, l]) => el('button', { class: cur === v ? 'on' : '', onclick: e => { saveSettings({ [key]: v }); onPick && onPick(v); [...e.currentTarget.parentNode.children].forEach(b => b.classList.toggle('on', b === e.currentTarget)); } }, l)));
    const tog = (label, key, def, onChange) => {
      const inp = el('input', { type: 'checkbox' }); inp.checked = s[key] ?? def;
      inp.onchange = () => { saveSettings({ [key]: inp.checked }); onChange && onChange(inp.checked); };
      return el('label', { class: 'toggle' }, el('span', {}, label), inp);
    };
    box.append(
      el('div', { class: 'sec-label' }, 'Appearance'),
      el('div', { class: 'settings-group' }, el('div', { class: 'set-row' }, el('span', {}, 'Theme'), seg('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme || 'system', applyTheme))),
      el('div', { class: 'sec-label' }, 'Writing'),
      el('div', { class: 'settings-group' },
        tog('Draw with Apple Pencil only', 'pencilOnly', false, v => { this.editor.pencilOnly = v; saveSettings({ pencilAuto: true }); this.editor.applyTouchAction(); }),
        tog('Draw and hold to snap shapes', 'shapeHold', true, v => { this.editor.shapeHold = v; }),
        tog('Two-finger tap to undo', 'tapUndo', true),
        tog('Transcribe recordings live (beta)', 'transcribe', true)),
      el('div', { class: 'sec-label' }, 'Scrolling'),
      el('div', { class: 'settings-group' }, el('div', { class: 'set-row' }, el('span', {}, 'Page direction'), seg('scrollDir', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']], s.scrollDir || 'vertical'))),
      el('p', { class: 'muted', style: { fontSize: '13px' } }, 'Inkwell ' + (window.INKWELL_VERSION || '') + ' · stored on this device only'));
    void m;
  }

  showHelp() {
    const li = (k, v) => el('li', {}, el('strong', {}, k), ' ', v);
    sheet('Inkwell Tips', el('div', { class: 'help' },
      el('div', { class: 'sec-label' }, 'Writing'),
      el('ul', {},
        li('Apple Pencil draws, fingers scroll.', 'Turns on automatically the first time you use the Pencil.'),
        li('Pinch', 'to zoom. Two-finger tap undoes, three-finger tap redoes.'),
        li('Tap the active tool again', 'for pen type (fountain, ballpoint, brush), colors and sizes.'),
        li('Draw a shape and hold', 'to snap it into a clean line, circle, rectangle or triangle.'),
        li('Lasso', 'to move, resize, recolor, copy or delete. Turn a selection into a flashcard or save it as a reusable element.'),
        li('Tape', 'hides answers for self-testing. Drag to lay tape, tap it to peek.')),
      el('div', { class: 'sec-label' }, 'Audio & study'),
      el('ul', {},
        li('Record', 'a lecture while you write. Playback replays your notes in sync, and tapping ink jumps to that moment.'),
        li('Live transcript', 'turns speech into searchable text while you record (where the browser supports it).'),
        li('Study Sets', 'are flashcards with spaced repetition. Make cards from typed text or from any lasso selection.')),
      el('div', { class: 'sec-label' }, 'Organize & share'),
      el('ul', {},
        li('Subjects and dividers', 'organize the library. Open notes stay in tabs at the top of the editor.'),
        li('Outline', 'collects bookmarked pages with their titles for quick navigation.'),
        li('Present', 'hides all chrome for screen sharing, with the laser pointer ready.'),
        li('Export', 'notes as PDF, pages as images, or everything as a backup.')),
      el('div', { class: 'sec-label' }, 'Keyboard'),
      el('p', { class: 'muted' }, 'P pen · H highlighter · E eraser · L lasso · T text · S shapes · K laser · ⌘Z / ⇧⌘Z undo/redo · ⌘C ⌘X ⌘V · ⌘+ / ⌘− zoom')));
  }
}

const app = new App();
window.inkwell = app;
app.start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
}
