// Study sets: flashcards made from typed text or lasso selections, reviewed
// with a simple spaced-repetition schedule (Again / Hard / Good / Easy).
import { db, uid, putBlob, getBlob } from './db.js';
import { icon, el, toast, menu, prompt, confirm, sheet } from './ui.js';
import { SUBJECT_COLORS } from './store.js';

const DAY = 86400000;

function newCard(front, back, noteId = null) {
  return { id: uid(), front, back, noteId, due: Date.now(), interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

// Returns the card's next state for a grade (0 again, 1 hard, 2 good, 3 easy).
function schedule(c, g) {
  const n = { ...c };
  if (g === 0) {
    n.reps = 0; n.lapses++; n.ease = Math.max(1.3, n.ease - 0.2); n.interval = 0; n.due = Date.now() + 60_000;
    return n;
  }
  if (g === 1) { n.ease = Math.max(1.3, n.ease - 0.15); n.interval = Math.max(1, (n.interval || 1) * 1.2); }
  else if (g === 2) n.interval = n.reps === 0 ? 1 : n.reps === 1 ? 3 : Math.round(n.interval * n.ease);
  else { n.ease += 0.15; n.interval = n.reps === 0 ? 4 : Math.round(Math.max(n.interval, 1) * n.ease * 1.3); }
  n.reps++;
  n.due = Date.now() + n.interval * DAY;
  return n;
}

const label = days => (days < 1 ? '<1m' : days < 30 ? Math.round(days) + 'd' : Math.round(days / 30) + 'mo');

export class StudyView {
  constructor(app) { this.app = app; }

  async sets() { return (await db.all('study')).sort((a, b) => a.created - b.created); }

  async renderSets(C) {
    const sets = await this.sets();
    C.innerHTML = '';
    const grid = el('div', { class: 'study-grid' });
    const now = Date.now();
    for (const s of sets) {
      const due = s.cards.filter(c => c.due <= now).length;
      grid.append(el('div', { class: 'set-card', style: { '--c': s.color } },
        el('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } },
          el('h3', { style: { flex: 1 } }, s.name),
          el('button', { class: 'icon-btn small', html: icon.more, onclick: e => this.setMenu(s, e.currentTarget) })),
        el('div', { class: 'set-stats' },
          el('span', { class: 'chip' }, `${s.cards.length} card${s.cards.length === 1 ? '' : 's'}`),
          el('span', { class: 'chip', style: due ? { background: 'rgba(52,199,89,.16)', color: '#1f9d48' } : {} }, `${due} due`)),
        el('div', { class: 'set-actions' },
          el('button', { class: 'btn primary small', disabled: !s.cards.length, onclick: () => this.study(s) }, due ? 'Study' : 'Review all'),
          el('button', { class: 'btn small', onclick: () => this.editSet(s) }, 'Cards'))));
    }
    grid.append(el('button', { class: 'set-card', style: { alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--line-2)', background: 'transparent', boxShadow: 'none', minHeight: '150px', color: 'var(--accent)' }, onclick: () => this.newSet() },
      el('span', { html: icon.plus }), el('strong', {}, 'New Study Set')));
    C.append(grid);
    if (!sets.length) C.append(el('p', { class: 'muted', style: { marginTop: '20px', maxWidth: '520px' } },
      'Make flashcards by typing them, or lasso anything in a note (handwriting, diagrams, PDF snippets) and tap Flashcard. Cards come back for review right before you would forget them.'));
  }

  refreshIfVisible() { if (this.app.filter.kind === 'study' && !this.app.libEl.classList.contains('hidden')) this.app.renderMain(); }

  async newSet(name) {
    name = name || await prompt('New Study Set', '', { placeholder: 'e.g. Bio midterm', ok: 'Create' });
    if (!name) return null;
    const n = (await this.sets()).length;
    const s = { id: uid(), name, color: SUBJECT_COLORS[(n + 3) % SUBJECT_COLORS.length], cards: [], created: Date.now() };
    await db.put('study', s);
    this.refreshIfVisible();
    return s;
  }

  setMenu(s, anchor) {
    menu(anchor, [
      { label: 'Rename', icon: 'text', action: async () => { const v = await prompt('Rename Study Set', s.name); if (v) { s.name = v; await db.put('study', s); this.refreshIfVisible(); } } },
      { label: 'Reset Progress', icon: 'flip', action: async () => { s.cards = s.cards.map(c => ({ ...newCard(c.front, c.back, c.noteId), id: c.id })); await db.put('study', s); this.refreshIfVisible(); } },
      '-',
      { label: 'Delete Set', icon: 'trash', danger: true, action: async () => { if (await confirm(`Delete "${s.name}"?`, `${s.cards.length} cards will be removed.`, { ok: 'Delete', danger: true })) { await db.del('study', s.id); this.refreshIfVisible(); } } },
    ]);
  }

  async sideEl(side) {
    const box = el('div', { class: 'cr-side' });
    if (side.img) { const b = await getBlob(side.img); if (b) box.append(el('img', { src: URL.createObjectURL(b) })); }
    if (side.text) box.append(side.img ? ' ' : '', side.text);
    return box;
  }

  async editSet(s) {
    const list = el('div', { class: 'card-list' });
    const front = el('textarea', { class: 'field', placeholder: 'Front (question)', rows: 2 });
    const back = el('textarea', { class: 'field', placeholder: 'Back (answer)', rows: 2 });
    const renderList = async () => {
      list.innerHTML = '';
      if (!s.cards.length) list.append(el('p', { class: 'muted' }, 'No cards yet.'));
      for (const c of s.cards) {
        list.append(el('div', { class: 'card-row' }, await this.sideEl(c.front), el('span', { class: 'muted' }, '→'), await this.sideEl(c.back),
          el('button', { class: 'icon-btn small', html: icon.trash, title: 'Delete card', onclick: async () => { s.cards = s.cards.filter(x => x !== c); await db.put('study', s); renderList(); } })));
      }
    };
    sheet(s.name, el('div', {}, list,
      el('div', { class: 'sec-label' }, 'Add a card'),
      el('div', { class: 'form-row' }, front), el('div', { class: 'form-row' }, back),
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn primary', onclick: async () => {
          if (!front.value.trim()) { front.focus(); return; }
          s.cards.push(newCard({ text: front.value.trim() }, { text: back.value.trim() }));
          await db.put('study', s);
          front.value = ''; back.value = '';
          renderList(); front.focus();
          this.refreshIfVisible();
        } }, 'Add Card'))));
    renderList();
  }

  // Shared dialog for creating a card from a note (text or a lasso image).
  async cardDialog({ title, frontImg = null, note = null }) {
    let sets = await this.sets();
    const pick = el('select', { class: 'field' });
    const fill = () => {
      pick.innerHTML = '';
      for (const s of sets) pick.append(el('option', { value: s.id, selected: s.id === this.lastSet }, s.name));
      pick.append(el('option', { value: '__new' }, 'New study set…'));
    };
    fill();
    const front = el('textarea', { class: 'field', placeholder: frontImg ? 'Optional text with the image' : 'Front (question)', rows: 2 });
    const back = el('textarea', { class: 'field', placeholder: 'Back (answer)', rows: 3 });
    let imgUrl = null;
    if (frontImg) imgUrl = URL.createObjectURL(frontImg);
    const m = sheet(title, el('div', {},
      el('div', { class: 'sec-label' }, 'Study set'), pick,
      el('div', { class: 'sec-label' }, 'Front'),
      imgUrl ? el('div', { style: { background: '#fff', borderRadius: '12px', padding: '10px', textAlign: 'center', marginBottom: '8px', boxShadow: 'var(--shadow-s)' } }, el('img', { src: imgUrl, style: { maxWidth: '100%', maxHeight: '180px' } })) : null,
      front,
      el('div', { class: 'sec-label' }, 'Back'), back,
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', onclick: () => m.close() }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: async () => {
          if (!frontImg && !front.value.trim()) { front.focus(); return; }
          let s;
          if (pick.value === '__new' || !sets.length) s = await this.newSet(note ? note.title : null);
          else s = sets.find(x => x.id === pick.value);
          if (!s) return;
          const f = { text: front.value.trim() || undefined };
          if (frontImg) f.img = await putBlob(frontImg);
          s.cards.push(newCard(f, { text: back.value.trim() }, note ? note.id : null));
          await db.put('study', s);
          this.lastSet = s.id;
          m.close();
          toast(`Added to "${s.name}"`);
        } }, 'Add Card'))));
    setTimeout(() => (frontImg ? back : front).focus(), 60);
  }

  cardFromImage(blob, note) { return this.cardDialog({ title: 'New Flashcard', frontImg: blob, note }); }
  cardFromText(note) { return this.cardDialog({ title: 'New Flashcard', note }); }

  async study(s) {
    const now = Date.now();
    let queue = s.cards.filter(c => c.due <= now);
    if (!queue.length) queue = s.cards.slice();
    queue = queue.sort(() => Math.random() - 0.5);
    const total = queue.length;
    let done = 0, correct = 0;
    const failed = new Set();
    const view = el('div', { class: 'study-view' });
    const bar = el('i', { style: { width: '0%' } });
    const counter = el('span', { class: 'chip' });
    const stage = el('div', { style: { width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minHeight: 0 } });
    view.append(
      el('div', { class: 'study-top' },
        el('button', { class: 'icon-btn', html: icon.close, title: 'End session', onclick: () => { view.remove(); this.refreshIfVisible(); } }),
        el('h3', {}, s.name), counter),
      el('div', { class: 'study-progress' }, bar), stage);
    document.body.append(view);
    const urls = [];
    const face = async (side, tag) => {
      const f = el('div', { class: 'flash-face ' + (tag === 'Answer' ? 'flash-back' : '') }, el('span', { class: 'face-tag' }, tag));
      if (side.img) { const b = await getBlob(side.img); if (b) { const u = URL.createObjectURL(b); urls.push(u); f.append(el('img', { src: u })); } }
      if (side.text) f.append(el('div', { style: { marginTop: side.img ? '14px' : 0 } }, side.text));
      if (!side.img && !side.text) f.append(el('span', { class: 'muted' }, '(empty)'));
      return f;
    };
    const next = async () => {
      stage.innerHTML = '';
      bar.style.width = (done / total) * 100 + '%';
      counter.textContent = `${Math.min(done + 1, total)} / ${total}`;
      if (!queue.length) {
        stage.append(el('div', { class: 'empty' },
          el('div', { class: 'empty-art', html: icon.check }),
          el('h2', {}, 'Session complete'),
          el('p', { class: 'muted' }, `${correct} of ${total} remembered on the first try. Cards are scheduled for review.`),
          el('div', { class: 'empty-actions' }, el('button', { class: 'btn primary', onclick: () => { view.remove(); urls.forEach(u => URL.revokeObjectURL(u)); this.refreshIfVisible(); } }, 'Done'))));
        return;
      }
      const c = queue.shift();
      const card = el('div', { class: 'flash' }, el('div', { class: 'flash-inner' }, await face(c.front, 'Question'), await face(c.back, 'Answer')));
      const grades = el('div', { class: 'grade-row' });
      const showGrades = () => {
        grades.innerHTML = '';
        [['Again', 'g-again'], ['Hard', 'g-hard'], ['Good', 'g-good'], ['Easy', 'g-easy']].forEach(([lbl, cls], g) => {
          const nx = schedule(c, g);
          grades.append(el('button', { class: 'btn ' + cls, onclick: async () => {
            const i = s.cards.findIndex(x => x.id === c.id);
            if (i >= 0) s.cards[i] = nx;
            await db.put('study', s);
            if (g === 0) { failed.add(c.id); queue.push(nx); } else { done++; if (!failed.has(c.id)) correct++; }
            next();
          } }, lbl, el('small', {}, g === 0 ? '1m' : label(nx.interval))));
        });
      };
      grades.append(el('button', { class: 'btn primary', style: { minWidth: '220px' }, onclick: () => { card.classList.add('flipped'); showGrades(); } }, 'Show Answer'));
      card.onclick = () => { if (!card.classList.contains('flipped')) { card.classList.add('flipped'); showGrades(); } else card.classList.remove('flipped'); };
      stage.append(card, grades);
    };
    next();
  }
}
