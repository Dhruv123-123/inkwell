// App shell: the library (subjects, dividers, note grid) and view switching.
import { db, uid } from './db.js';
import { icon, el, toast, menu, prompt, confirm, sheet, pickFile, shareOrDownload, fmtDate, alertBox } from './ui.js';
import {
  createNote, deleteNote, duplicateNote, loadPages, pdfToPages, imageToPage, exportPdf,
  exportBackup, importBackup, settings, saveSettings, SUBJECT_COLORS,
} from './store.js';
import { Editor } from './editor.js';

class App {
  constructor() {
    this.libEl = document.getElementById('library');
    this.edEl = document.getElementById('editor');
    this.filter = settings().filter || { kind: 'all' };
    this.sort = settings().sort || 'modified';
    this.query = '';
    this.editor = new Editor(this);
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
    this.renderSidebar();
    this.renderGrid();
  }

  // ---------- library DOM ----------
  buildLibrary() {
    this.sideList = el('nav', { class: 'side-list' });
    this.sidebar = el('aside', { class: 'sidebar' },
      el('div', { class: 'brand' }, el('img', { src: 'icons/icon-192.png', alt: '' }), el('span', {}, 'Inkwell')),
      this.sideList,
      el('div', { class: 'side-foot' },
        el('button', { class: 'side-btn', onclick: () => this.backupSheet() }, el('span', { html: icon.import }), 'Backup & restore'),
        el('button', { class: 'side-btn', onclick: () => this.showHelp() }, el('span', { html: icon.hand }), 'Help & gestures')));
    this.searchInput = el('input', { type: 'search', class: 'field lib-search', placeholder: 'Search notes' });
    this.searchInput.addEventListener('input', () => { this.query = this.searchInput.value.trim().toLowerCase(); this.renderGrid(); });
    this.headTitle = el('h1', {});
    this.grid = el('div', { class: 'note-grid' });
    const main = el('main', { class: 'lib-main' },
      el('header', { class: 'lib-head' },
        el('button', { class: 'icon-btn side-toggle', html: icon.sidebar, title: 'Subjects', onclick: () => this.libEl.classList.toggle('side-open') }),
        this.headTitle,
        el('div', { class: 'lib-actions' },
          this.searchInput,
          el('button', { class: 'icon-btn', html: icon.sort, title: 'Sort', onclick: e => this.sortMenu(e.currentTarget) }),
          el('button', { class: 'btn', onclick: e => this.importMenu(e.currentTarget) }, el('span', { html: icon.import }), 'Import'),
          el('button', { class: 'btn primary', onclick: () => this.newNote() }, el('span', { html: icon.plus }), 'New note'))),
      this.installHint(),
      this.grid);
    this.libEl.append(this.sidebar, main, el('div', { class: 'side-scrim', onclick: () => this.libEl.classList.remove('side-open') }));
  }

  installHint() {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (standalone || settings().hideInstall) return null;
    const box = el('div', { class: 'install-hint' },
      el('span', { html: icon.share }),
      el('div', {}, el('strong', {}, 'Install on your iPad: '), 'tap the Share button in Safari, then "Add to Home Screen". Inkwell then opens full screen and works offline.'),
      el('button', { class: 'icon-btn small', html: icon.close, onclick: () => { saveSettings({ hideInstall: true }); box.remove(); } }));
    return box;
  }

  renderSidebar() {
    const L = this.sideList;
    L.innerHTML = '';
    const count = f => this.notes.filter(f).length;
    const row = (label, ic, filter, n, extra = {}) => {
      const active = this.filter.kind === filter.kind && this.filter.id === filter.id;
      const b = el('div', { class: 'side-row' + (active ? ' active' : ''), onclick: () => this.setFilter(filter) },
        extra.dot ? el('span', { class: 'dot', style: { background: extra.dot } }) : el('span', { class: 'side-icon', html: icon[ic] }),
        el('span', { class: 'side-label' }, label),
        el('span', { class: 'side-count' }, String(n)),
        extra.menu ? el('button', { class: 'icon-btn small', html: icon.more, onclick: e => { e.stopPropagation(); extra.menu(e.currentTarget); } }) : null);
      return b;
    };
    L.append(
      row('All notes', 'notes', { kind: 'all' }, this.notes.length),
      row('Recent', 'clock', { kind: 'recent' }, Math.min(12, this.notes.length)),
      row('Favorites', 'star', { kind: 'favorites' }, count(n => n.favorite)),
      row('Unfiled', 'inbox', { kind: 'unfiled' }, count(n => !n.subjectId || !this.subjects.find(s => s.id === n.subjectId))));
    L.append(el('div', { class: 'side-head' }, el('span', {}, 'Subjects'),
      el('button', { class: 'icon-btn small', html: icon.plus, title: 'New subject or divider', onclick: e => menu(e.currentTarget, [
        { label: 'New subject', icon: 'folder', action: () => this.newSubject() },
        { label: 'New divider', icon: 'divider', action: () => this.newDivider() },
      ]) })));
    const subjRow = s => row(s.name, 'folder', { kind: 'subject', id: s.id }, count(n => n.subjectId === s.id), { dot: s.color, menu: a => this.subjectMenu(s, a) });
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
        if (!kids.length) wrap.append(el('div', { class: 'muted side-empty' }, 'No subjects'));
        L.append(wrap);
      }
    }
    if (!this.subjects.length && !this.dividers.length) L.append(el('p', { class: 'muted side-empty' }, 'Create subjects to organize notes, and dividers to group subjects.'));
  }

  setFilter(f) {
    this.filter = f;
    saveSettings({ filter: f });
    this.libEl.classList.remove('side-open');
    this.renderSidebar();
    this.renderGrid();
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
    if (f.kind === 'recent' && !this.query) list = list.sort((a, b) => b.modified - a.modified).slice(0, 12);
    return list;
  }

  subjectOf(n) { return this.subjects.find(s => s.id === n.subjectId); }

  renderGrid() {
    const f = this.filter;
    this.headTitle.textContent = f.kind === 'subject' ? (this.subjects.find(s => s.id === f.id)?.name || 'Subject')
      : { all: 'All notes', recent: 'Recent', favorites: 'Favorites', unfiled: 'Unfiled' }[f.kind];
    const g = this.grid;
    g.innerHTML = '';
    const list = this.filteredNotes();
    if (!list.length) {
      g.append(el('div', { class: 'empty' },
        el('div', { class: 'empty-art', html: icon.notes }),
        el('h2', {}, this.query ? 'No matching notes' : 'No notes here yet'),
        el('p', { class: 'muted' }, this.query ? 'Search looks at titles, typed text and text inside imported PDFs.' : 'Start a fresh note, or import a PDF to annotate.'),
        this.query ? null : el('div', { class: 'empty-actions' },
          el('button', { class: 'btn primary', onclick: () => this.newNote() }, 'New note'),
          el('button', { class: 'btn', onclick: () => this.importPdfs() }, 'Import PDF'))));
      return;
    }
    for (const n of list) {
      const subj = this.subjectOf(n);
      const card = el('div', { class: 'note-card' },
        el('button', { class: 'card-thumb', onclick: () => this.openNote(n) },
          n.thumb ? el('img', { src: n.thumb, alt: '' }) : el('div', { class: 'blank-thumb' }),
          n.favorite ? el('span', { class: 'fav', html: icon.star }) : null),
        el('div', { class: 'card-meta' },
          el('div', { class: 'card-text', onclick: () => this.openNote(n) },
            el('div', { class: 'card-title' }, n.title),
            el('div', { class: 'card-sub' }, subj ? el('span', { class: 'dot', style: { background: subj.color } }) : null, fmtDate(n.modified))),
          el('button', { class: 'icon-btn small', html: icon.more, onclick: e => this.noteMenu(n, e.currentTarget) })));
      g.append(card);
    }
  }

  // ---------- actions ----------
  currentSubjectId() { return this.filter.kind === 'subject' ? this.filter.id : null; }

  async newNote() {
    const n = await createNote({ subjectId: this.currentSubjectId() });
    this.openNote(n);
  }

  async openNote(n, fromHistory = false) {
    this.libEl.classList.add('hidden');
    this.edEl.classList.remove('hidden');
    if (!fromHistory) history.pushState({ note: n.id }, '', '#note=' + n.id);
    await this.editor.open(n);
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
      { label: 'Rename', icon: 'text', action: async () => { const v = await prompt('Rename note', n.title); if (v) { n.title = v; n.searchText = n.title.toLowerCase() + '\n' + (n.searchText || ''); await db.put('notes', n); this.refresh(); } } },
      { label: 'Move to subject…', icon: 'folder', action: () => this.moveNote(n) },
      { label: n.favorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', action: async () => { n.favorite = !n.favorite; await db.put('notes', n); this.refresh(); } },
      { label: 'Duplicate', icon: 'copy', action: async () => { await duplicateNote(n); this.refresh(); toast('Note duplicated'); } },
      { label: 'Export as PDF', icon: 'share', action: () => this.exportNotePdf(n) },
      { label: 'Export backup (.inkwell)', icon: 'import', action: async () => shareOrDownload(await exportBackup([n.id]), `${n.title}.inkwell.json`) },
      '-',
      { label: 'Delete', icon: 'trash', danger: true, action: async () => {
        if (!(await confirm(`Delete "${n.title}"?`, 'This removes the note, its pages and recordings from this device.', { ok: 'Delete', danger: true }))) return;
        await deleteNote(n); this.refresh(); toast('Note deleted');
      } },
    ]);
  }

  async exportNotePdf(n) {
    toast('Building PDF…', 60000);
    try {
      const blob = await exportPdf(n, await loadPages(n), (i, t) => toast(`Building PDF… page ${i} of ${t}`, 60000));
      toast('PDF ready');
      shareOrDownload(blob, `${n.title}.pdf`);
    } catch (e) { toast('Export failed: ' + e.message); }
  }

  moveNote(n) {
    const list = el('div', { class: 'move-list' });
    const m = sheet('Move to subject', list);
    const opt = (label, id, color) => list.append(el('button', { class: 'side-row' + (n.subjectId === id ? ' active' : ''), onclick: async () => { n.subjectId = id; await db.put('notes', n); m.close(); this.refresh(); } },
      color ? el('span', { class: 'dot', style: { background: color } }) : el('span', { class: 'side-icon', html: icon.inbox }), el('span', { class: 'side-label' }, label)));
    opt('Unfiled', null);
    for (const s of this.subjects) opt(s.name, s.id, s.color);
    list.append(el('button', { class: 'btn block', onclick: async () => { m.close(); const s = await this.newSubject(); if (s) { n.subjectId = s.id; await db.put('notes', n); this.refresh(); } } }, '+ New subject'));
  }

  async newSubject(dividerId = null) {
    const name = await prompt('New subject', '', { placeholder: 'e.g. Biology', ok: 'Create' });
    if (!name) return null;
    const s = { id: uid(), name, color: SUBJECT_COLORS[this.subjects.length % SUBJECT_COLORS.length], dividerId, order: Date.now() };
    await db.put('subjects', s);
    await this.refresh();
    this.setFilter({ kind: 'subject', id: s.id });
    return s;
  }

  async newDivider() {
    const name = await prompt('New divider', '', { placeholder: 'e.g. Fall semester', ok: 'Create' });
    if (!name) return;
    await db.put('dividers', { id: uid(), name, order: Date.now(), collapsed: false });
    this.refresh();
  }

  subjectMenu(s, anchor) {
    menu(anchor, [
      { label: 'Rename', icon: 'text', action: async () => { const v = await prompt('Rename subject', s.name); if (v) { s.name = v; await db.put('subjects', s); this.refresh(); } } },
      { label: 'Change color', icon: 'shapes', action: () => {
        const g = el('div', { class: 'color-grid' });
        const m = sheet('Subject color', g);
        for (const c of SUBJECT_COLORS) g.append(el('button', { class: 'swatch big' + (s.color === c ? ' active' : ''), style: { '--c': c }, onclick: async () => { s.color = c; await db.put('subjects', s); m.close(); this.refresh(); } }));
      } },
      { label: 'Move to divider…', icon: 'divider', action: () => {
        const list = el('div', { class: 'move-list' });
        const m = sheet('Move to divider', list);
        const opt = (label, id) => list.append(el('button', { class: 'side-row' + ((s.dividerId || null) === id ? ' active' : ''), onclick: async () => { s.dividerId = id; await db.put('subjects', s); m.close(); this.refresh(); } }, el('span', { class: 'side-label' }, label)));
        opt('No divider', null);
        for (const d of this.dividers) opt(d.name, d.id);
      } },
      { label: 'Move up', icon: 'sort', action: () => this.reorderSubject(s, -1) },
      '-',
      { label: 'Delete subject', icon: 'trash', danger: true, action: async () => {
        const n = this.notes.filter(x => x.subjectId === s.id);
        if (!(await confirm(`Delete subject "${s.name}"?`, n.length ? `Its ${n.length} note(s) are kept and moved to Unfiled.` : '', { ok: 'Delete', danger: true }))) return;
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
      { label: 'Rename', icon: 'text', action: async () => { const v = await prompt('Rename divider', d.name); if (v) { d.name = v; await db.put('dividers', d); this.refresh(); } } },
      '-',
      { label: 'Delete divider', icon: 'trash', danger: true, action: async () => {
        if (!(await confirm(`Delete divider "${d.name}"?`, 'Subjects inside it are kept.', { ok: 'Delete', danger: true }))) return;
        for (const s of this.subjects.filter(s => s.dividerId === d.id)) { s.dividerId = null; await db.put('subjects', s); }
        await db.del('dividers', d.id); this.refresh();
      } },
    ]);
  }

  sortMenu(anchor) {
    const set = s => { this.sort = s; saveSettings({ sort: s }); this.renderGrid(); };
    menu(anchor, [
      { label: 'Date modified', checked: this.sort === 'modified', action: () => set('modified') },
      { label: 'Date created', checked: this.sort === 'created', action: () => set('created') },
      { label: 'Title', checked: this.sort === 'title', action: () => set('title') },
    ]);
  }

  importMenu(anchor) {
    menu(anchor, [
      { label: 'PDF documents', icon: 'paper', action: () => this.importPdfs() },
      { label: 'Photos / images', icon: 'image', action: () => this.importImages() },
      { label: 'Inkwell backup', icon: 'import', action: () => this.restore() },
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
    const m = sheet('Backup & restore', el('div', { class: 'backup' },
      el('p', {}, 'Your notes are stored only on this device. Export a backup file regularly (save it to Files or iCloud Drive) to keep a copy or move notes to another device.'),
      usage ? el('p', { class: 'muted' }, usage) : null,
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', onclick: () => { m.close(); this.restore(); } }, 'Restore from file'),
        el('button', { class: 'btn primary', onclick: async () => { m.close(); toast('Preparing backup…', 30000); shareOrDownload(await exportBackup(), `Inkwell backup ${new Date().toISOString().slice(0, 10)}.inkwell.json`); toast('Backup ready'); } }, 'Export all notes'))));
  }

  showHelp() {
    const li = (k, v) => el('li', {}, el('strong', {}, k), ' ', v);
    sheet('Inkwell tips', el('div', { class: 'help' },
      el('h4', {}, 'Writing'),
      el('ul', {},
        li('Apple Pencil draws, fingers scroll.', 'This switches on automatically the first time you use the Pencil (toggle it under ⋯).'),
        li('Pinch', 'with two fingers to zoom. Two-finger tap = undo, three-finger tap = redo.'),
        li('Tap the active tool again', 'for its colors, sizes and options.'),
        li('Draw a shape and hold', 'the Pencil still for a moment to snap it into a clean line, circle, rectangle or triangle.'),
        li('Lasso', 'to select ink, text, shapes and images. Drag to move, pull the corner dot to resize, and use the bar to copy, recolor, reorder or delete. Tap empty space with the lasso to paste.')),
      el('h4', {}, 'Audio'),
      el('ul', {},
        li('Tap the microphone', 'to record a lecture while you write. Everything you write is synced to the recording.'),
        li('Play it back', 'with Replay notes on: later notes fade until they are reached, and tapping ink jumps to the moment you wrote it.')),
      el('h4', {}, 'Organizing'),
      el('ul', {},
        li('Subjects and dividers', 'live in the sidebar. Use a note\'s ⋯ menu to move, duplicate, favorite or export it.'),
        li('Import PDFs', 'to annotate slides and worksheets; their text becomes searchable.'),
        li('Export', 'any note as a PDF from the share button, and back up everything from Backup & restore.')),
      el('h4', {}, 'Keyboard'),
      el('p', { class: 'muted' }, 'P pen · H highlighter · E eraser · L lasso · T text · S shapes · K laser · ⌘Z undo · ⇧⌘Z redo · ⌘C/⌘X/⌘V copy, cut, paste · ⌘+/⌘− zoom')));
  }
}

const app = new App();
window.inkwell = app;
app.start();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
}
