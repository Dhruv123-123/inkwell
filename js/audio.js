// Audio recording synced to ink: every item drawn while recording is stamped
// with the recording id and time, so playback can replay the notes.
import { db, uid, putBlob, getBlob } from './db.js';
import { hitItem } from './render.js';
import { icon, el, toast, menu, prompt, confirm, fmtTime, shareOrDownload } from './ui.js';

const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

export class AudioPanel {
  constructor(ed) {
    this.ed = ed;
    this.recs = [];
    this.cur = null;
    this.replay = true;
    this.speed = 1;
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.addEventListener('timeupdate', () => this.updateTime());
    this.audio.addEventListener('play', () => { this.renderControls(); this.startReplayLoop(); });
    this.audio.addEventListener('pause', () => { this.renderControls(); this.stopReplayLoop(); });
    this.audio.addEventListener('ended', () => { this.renderControls(); this.stopReplayLoop(); this.ed.rerenderAll(); });
    this.audio.addEventListener('loadedmetadata', () => this.updateTime());
  }

  async load() {
    this.recs = (await db.byIndex('recordings', 'noteId', this.ed.note.id)).sort((a, b) => a.created - b.created);
    if (this.recs.length) this.showBar(false);
  }

  destroy() {
    this.audio.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.stopReplayLoop();
    clearInterval(this.timer);
  }

  tag(item) {
    if (this.rs) item.rec = { id: this.rs.id, t: Date.now() - this.rs.start };
  }

  // ---- recording ----
  async toggleRecord() {
    if (this.rs) return this.stopRecording();
    return this.startRecording();
  }

  async startRecording() {
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Audio recording is not supported in this browser'); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast('Microphone permission was denied'); return; }
    const type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', ''].find(t => !t || MediaRecorder.isTypeSupported(t));
    const rec = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    this.audio.pause();
    this.rs = { id: uid(), start: Date.now(), rec, stream, chunks, type: rec.mimeType || type || 'audio/mp4' };
    rec.start(1000);
    this.ed.recording = true;
    this.ed.micBtn.classList.add('recording');
    this.ed.micBtn.innerHTML = icon.stop;
    this.ed.micBtn.title = 'Stop recording';
    const tick = () => { this.ed.recTime.textContent = '● ' + fmtTime((Date.now() - this.rs.start) / 1000); };
    tick();
    this.timer = setInterval(tick, 500);
    toast('Recording. Notes you take now are synced to the audio.');
  }

  async stopRecording() {
    const rs = this.rs;
    if (!rs) return;
    this.rs = null;
    clearInterval(this.timer);
    this.ed.recording = false;
    this.ed.recTime.textContent = '';
    this.ed.micBtn.classList.remove('recording');
    this.ed.micBtn.innerHTML = icon.mic;
    this.ed.micBtn.title = 'Record audio';
    await new Promise(res => { rs.rec.onstop = res; rs.rec.stop(); });
    rs.stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(rs.chunks, { type: rs.type.split(';')[0] || 'audio/mp4' });
    const duration = (Date.now() - rs.start) / 1000;
    const r = {
      id: rs.id, noteId: this.ed.note.id, blob: await putBlob(blob), duration, created: rs.start,
      name: 'Recording ' + new Date(rs.start).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    };
    await db.put('recordings', r);
    this.recs.push(r);
    await this.select(r);
    this.showBar(true);
    toast('Recording saved');
  }

  // ---- playback ----
  async select(r) {
    this.audio.pause();
    this.cur = r;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    if (!r) return;
    const blob = await getBlob(r.blob);
    if (!blob) { toast('Audio data missing'); return; }
    this.url = URL.createObjectURL(blob);
    this.audio.src = this.url;
    this.audio.playbackRate = this.speed;
  }

  replayActive() {
    return this.replay && this.cur && !this.ed.audioBar.classList.contains('hidden') && !this.audio.paused;
  }

  alphaFor() {
    if (!this.replay || !this.cur || this.ed.audioBar.classList.contains('hidden')) return null;
    if (this.audio.paused && this.audio.currentTime === 0) return null;
    const t = this.audio.currentTime * 1000, id = this.cur.id;
    return it => (it.rec && it.rec.id === id && it.rec.t > t ? 0.13 : 1);
  }

  revealedCount() {
    if (!this.cur) return 0;
    const t = this.audio.currentTime * 1000, id = this.cur.id;
    let n = 0;
    for (const p of this.ed.pages) for (const it of p.items) if (it.rec && it.rec.id === id && it.rec.t <= t) n++;
    return n;
  }

  startReplayLoop() {
    this.stopReplayLoop();
    this.lastCount = -1;
    this.replayTimer = setInterval(() => {
      if (!this.replay) return;
      const n = this.revealedCount();
      if (n !== this.lastCount) { this.lastCount = n; this.ed.rerenderAll(); this.followInk(); }
    }, 150);
  }

  stopReplayLoop() { clearInterval(this.replayTimer); }

  // Keep the page with the most recently replayed ink in view.
  followInk() {
    if (!this.cur) return;
    const t = this.audio.currentTime * 1000, id = this.cur.id;
    let best = null, bt = -1;
    this.ed.pages.forEach((p, i) => { for (const it of p.items) if (it.rec && it.rec.id === id && it.rec.t <= t && it.rec.t > bt) { bt = it.rec.t; best = i; } });
    if (best == null) return;
    const pe = this.ed.pageEls.get(this.ed.pages[best].id);
    const sc = this.ed.scroller;
    if (pe && (pe.el.offsetTop + pe.el.offsetHeight < sc.scrollTop || pe.el.offsetTop > sc.scrollTop + sc.clientHeight)) this.ed.scrollToPage(best);
  }

  seekFromTap(pe, pt) {
    if (!this.cur) return;
    const id = this.cur.id;
    const hit = [...pe.page.items].reverse().find(it => it.rec && it.rec.id === id && hitItem(it, pt[0], pt[1], 8));
    if (!hit) { toast('Tap ink written during this recording to jump to it'); return; }
    this.audio.currentTime = Math.max(0, hit.rec.t / 1000 - 1);
    this.audio.play();
  }

  // ---- UI ----
  showBar(open) {
    const bar = this.ed.audioBar;
    if (!this.recs.length) {
      if (open) toast('No recordings yet. Tap the microphone to record.');
      bar.classList.add('hidden');
      return;
    }
    if (!this.cur) this.select(this.recs[this.recs.length - 1]);
    bar.classList.remove('hidden');
    this.renderBar();
    setTimeout(() => this.ed.layout(), 20);
  }

  hideBar() {
    this.audio.pause();
    this.ed.audioBar.classList.add('hidden');
    this.ed.rerenderAll();
    setTimeout(() => this.ed.layout(), 20);
  }

  renderBar() {
    const bar = this.ed.audioBar;
    bar.innerHTML = '';
    const pick = el('select', { class: 'field rec-pick' });
    this.recs.forEach(r => pick.append(el('option', { value: r.id, selected: this.cur && r.id === this.cur.id }, `${r.name} (${fmtTime(r.duration)})`)));
    pick.onchange = async () => { await this.select(this.recs.find(r => r.id === pick.value)); this.renderBar(); this.ed.rerenderAll(); };
    this.playBtn = el('button', { class: 'icon-btn play', html: icon.play, onclick: () => (this.audio.paused ? this.audio.play() : this.audio.pause()) });
    this.scrub = el('input', { type: 'range', min: 0, max: 1000, value: 0, class: 'scrub' });
    this.scrub.oninput = () => {
      const d = this.duration();
      if (d) this.audio.currentTime = (this.scrub.value / 1000) * d;
      this.ed.rerenderAll();
    };
    this.timeEl = el('span', { class: 'rec-clock' }, '0:00');
    const speedBtn = el('button', { class: 'btn small', onclick: () => {
      this.speed = SPEEDS[(SPEEDS.indexOf(this.speed) + 1) % SPEEDS.length];
      this.audio.playbackRate = this.speed; speedBtn.textContent = this.speed + '×';
    } }, this.speed + '×');
    const replayBtn = el('button', { class: 'btn small' + (this.replay ? ' on' : ''), title: 'Fade notes that come later in the recording, and tap ink to jump to that moment', onclick: () => {
      this.replay = !this.replay; replayBtn.classList.toggle('on', this.replay); this.ed.rerenderAll();
    } }, 'Replay notes');
    bar.append(
      pick,
      el('button', { class: 'icon-btn small', title: 'Back 15s', onclick: () => { this.audio.currentTime = Math.max(0, this.audio.currentTime - 15); this.ed.rerenderAll(); } }, '−15'),
      this.playBtn,
      el('button', { class: 'icon-btn small', title: 'Forward 15s', onclick: () => { this.audio.currentTime = Math.min(this.duration() || 0, this.audio.currentTime + 15); this.ed.rerenderAll(); } }, '+15'),
      this.scrub, this.timeEl, speedBtn, replayBtn,
      el('button', { class: 'icon-btn small', html: icon.more, onclick: e => this.recMenu(e.currentTarget) }),
      el('button', { class: 'icon-btn small', html: icon.close, title: 'Hide', onclick: () => this.hideBar() }));
    this.renderControls();
    this.updateTime();
  }

  duration() {
    const d = this.audio.duration;
    return isFinite(d) && d > 0 ? d : this.cur ? this.cur.duration : 0;
  }

  renderControls() { if (this.playBtn) this.playBtn.innerHTML = this.audio.paused ? icon.play : icon.pause; }

  updateTime() {
    if (!this.timeEl) return;
    const d = this.duration();
    this.timeEl.textContent = `${fmtTime(this.audio.currentTime)} / ${fmtTime(d)}`;
    if (d && document.activeElement !== this.scrub) this.scrub.value = Math.round((this.audio.currentTime / d) * 1000);
  }

  recMenu(anchor) {
    const r = this.cur;
    if (!r) return;
    menu(anchor, [
      { label: 'Rename recording', icon: 'text', action: async () => { const v = await prompt('Rename recording', r.name); if (v) { r.name = v; await db.put('recordings', r); this.renderBar(); } } },
      { label: 'Share audio file', icon: 'share', action: async () => { const b = await getBlob(r.blob); const ext = b.type.includes('webm') ? 'webm' : 'm4a'; shareOrDownload(b, `${r.name}.${ext}`); } },
      '-',
      { label: 'Delete recording', icon: 'trash', danger: true, action: async () => {
        if (!(await confirm('Delete this recording?', 'Your notes stay; only the audio is removed.', { ok: 'Delete', danger: true }))) return;
        this.audio.pause();
        await db.del('recordings', r.id); await db.del('blobs', r.blob);
        this.recs = this.recs.filter(x => x !== r);
        this.cur = null;
        if (this.recs.length) { await this.select(this.recs[this.recs.length - 1]); this.renderBar(); } else this.hideBar();
        this.ed.rerenderAll();
      } },
    ]);
  }
}
