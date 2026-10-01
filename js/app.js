import { store } from './store.js';
import { presetsForYear } from './presets.js';
import { CAPTION_STUDIO_URL, VAPID_KEY } from './config.js';
import { pickModel, pickModels, usedModel, polishEnglish, toGerman } from './captions.js';

/* ---------- constants ---------- */
export const TAGS = [
  ['弹奏精选', 'var(--t1)'],
  ['奥地利回忆', 'var(--t2)'],
  ['对谈系列', 'var(--t3)'],
  ['图片库', 'var(--t4)'],
  ['排练日常', 'var(--t5)'],
  ['科普内容', 'var(--t6)'],
];
const TAG_COLOR = Object.fromEntries(TAGS);
const PLATFORMS = ['Instagram', 'Facebook', 'YouTube', 'Threads'];
const TYPES = { reel: 'Reel', carousel: 'Photo carousel' };
const DEFAULT_PLATFORMS = { reel: ['Instagram', 'Facebook', 'YouTube', 'Threads'], carousel: ['Instagram', 'Facebook', 'Threads'] };
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DACH = new Set(['DE', 'AT', 'CH']);
const COUNTRY = { AT: 'Austria', DE: 'Germany', CH: 'Switzerland', FR: 'France', IT: 'Italy', ES: 'Spain', PT: 'Portugal', NL: 'Netherlands', BE: 'Belgium', LU: 'Luxembourg', GB: 'United Kingdom', IE: 'Ireland', DK: 'Denmark', SE: 'Sweden', NO: 'Norway', FI: 'Finland', IS: 'Iceland', PL: 'Poland', CZ: 'Czechia', SK: 'Slovakia', HU: 'Hungary', SI: 'Slovenia', HR: 'Croatia', RS: 'Serbia', RO: 'Romania', BG: 'Bulgaria', GR: 'Greece', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', UA: 'Ukraine', MT: 'Malta', CY: 'Cyprus', LI: 'Liechtenstein', MC: 'Monaco', BA: 'Bosnia', ME: 'Montenegro', MK: 'North Macedonia', AL: 'Albania', TR: 'Türkiye' };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfWeek = d => addDays(d, -((d.getDay() + 6) % 7));
const todayISO = () => iso(new Date());
const nice = s => { const d = parse(s); return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`; };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }

/* ---------- state ---------- */
const state = {
  tab: 'plan',
  calMode: localStorage.getItem('pdhw:calMode') || 'month',
  cursor: new Date(),
  tagFilter: new Set(),
  showOcc: true,
};

/* ---------- data access ---------- */
function postsOn(d) {
  return store.all('posts').filter(p => p.date === d && (state.tagFilter.size === 0 || (p.tags || []).some(t => state.tagFilter.has(t))));
}
function occasionsInYear(y) {
  const own = store.all('occasions').flatMap(o => {
    if (o.yearly) {
      const y0 = +o.date.slice(0, 4);
      const n = y - y0;
      if (n < 0) return [];
      return [{ ...o, date: `${y}${o.date.slice(4)}`, sub: n > 0 ? `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'} anniversary` : 'Yearly', round: n > 0 && n % 5 === 0 }];
    }
    return o.date.startsWith(String(y)) ? [o] : [];
  });
  const mode = store.setting('presetMode', 'all');
  return [...own, ...presetsForYear(y, mode)];
}
const occCache = new Map();
function occasionsOn(d) {
  if (!state.showOcc) return [];
  const y = +d.slice(0, 4);
  if (!occCache.has(y)) occCache.set(y, occasionsInYear(y));
  return occCache.get(y).filter(o => o.date === d).sort((a, b) => (b.round ? 1 : 0) - (a.round ? 1 : 0));
}
store.on(() => occCache.clear());

/* ---------- rendering ---------- */
function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  const v = $('#view');
  v.onkeydown = null;
  if (['pending', 'locked', 'setup', 'offline-locked'].includes(store.status.mode)) { renderLock(v); updateBadge(); renderSync(); return; }
  ({ plan: renderPlan, reminders: renderReminders, news: renderNews, concerts: renderConcerts, settings: renderSettings })[state.tab](v);
  updateBadge();
  renderSync();
}
function renderSync() {
  const s = store.status, el = $('#syncState');
  el.className = 'sync';
  if (s.mode === 'cloud') { el.textContent = s.online ? 'Synced' : 'Offline · will sync'; el.classList.add(s.online ? 'on' : 'off'); }
  else if (s.mode === 'connecting' || s.mode === 'pending') el.textContent = 'Connecting…';
  else if (['locked', 'setup', 'offline-locked'].includes(s.mode)) { el.textContent = 'Locked'; el.classList.add('off'); }
  else if (s.mode === 'signed-out') { el.textContent = 'Not signed in'; el.classList.add('off'); }
  else el.textContent = 'This device only';
}

/* ---- encryption lock screen ---- */
function renderLock(v) {
  v.ontouchstart = v.ontouchend = null;
  const m = store.status.mode;
  if (m === 'pending') { v.innerHTML = '<div class="empty">Opening your encrypted data…</div>'; v.onclick = null; return; }
  if (m === 'offline-locked') { v.innerHTML = '<h2>Connect to unlock</h2><p class="muted">This device hasn’t been unlocked yet. Connect to the internet once to enter your passphrase.</p>'; v.onclick = null; return; }
  const setup = m === 'setup';
  v.innerHTML = `
    <h2>${setup ? 'Protect your data' : 'Unlock your data'}</h2>
    <div class="card">
      <p class="small" style="margin-top:0">${setup
        ? 'Choose a passphrase. Your posts, captions, occasions and reminders are encrypted with it on this device before they are synced, so nobody else can read them, including Google and GitHub. You enter it once on each device.'
        : `Signed in as <b>${esc(store.status.user || '')}</b>. Enter your passphrase to decrypt your data on this device. You only need to do this once per device.`}</p>
      ${setup ? '<p class="small" style="color:#a3261b"><b>If you forget the passphrase, your synced data can’t be recovered.</b> Write it down somewhere safe and keep your 15-day backups.</p>' : ''}
      <label class="f"><span>Passphrase</span><input type="password" id="pp1" autocomplete="${setup ? 'new-password' : 'current-password'}" placeholder="At least 10 characters"></label>
      ${setup ? '<label class="f"><span>Repeat passphrase</span><input type="password" id="pp2" autocomplete="new-password"></label>' : ''}
      <div class="row" style="margin-top:14px"><button class="btn" data-go>${setup ? 'Encrypt and continue' : 'Unlock'}</button><span class="small muted" id="ppMsg"></span></div>
    </div>
    <p class="small muted">Wrong account? <button class="btn ghost sm" data-out>Sign out</button></p>`;
  const go = async () => {
    const p1 = $('#pp1').value, msg = $('#ppMsg');
    if (setup) {
      if (p1.length < 10) { msg.textContent = 'Use at least 10 characters.'; return; }
      if (p1 !== $('#pp2').value) { msg.textContent = 'The two passphrases don’t match.'; return; }
    }
    msg.textContent = setup ? 'Encrypting…' : 'Unlocking…';
    try { setup ? await store.setupEncryption(p1) : await store.unlock(p1); toast(setup ? 'Encryption is on' : 'Unlocked'); }
    catch (e) { msg.textContent = e.message === 'wrong-passphrase' ? 'That passphrase is not correct.' : 'Something went wrong. Check your connection and try again.'; }
  };
  v.onclick = e => { if (e.target.closest('[data-go]')) go(); if (e.target.closest('[data-out]')) store.signOut(); };
  v.onkeydown = e => { if (e.key === 'Enter') go(); };
}

/* ---- plan ---- */
function renderPlan(v) {
  const c = state.cursor;
  let title, body;
  if (state.calMode === 'month') {
    title = `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
    body = monthGrid(c);
  } else {
    const s = startOfWeek(c), e = addDays(s, 6);
    title = `${s.getDate()} ${MONTHS[s.getMonth()].slice(0, 3)} – ${e.getDate()} ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getFullYear()}`;
    body = weekList(s);
  }
  v.innerHTML = `
    <div class="cal-head">
      <div class="row" style="gap:2px">
        <button class="icon-btn" data-act="prev" aria-label="Previous">‹</button>
        <div class="cal-title">${title}</div>
        <button class="icon-btn" data-act="next" aria-label="Next">›</button>
      </div>
      <div class="row">
        <button class="btn ghost sm" data-act="today">Today</button>
        <div class="seg"><button data-mode="month" class="${state.calMode === 'month' ? 'on' : ''}">Month</button><button data-mode="week" class="${state.calMode === 'week' ? 'on' : ''}">Week</button></div>
      </div>
    </div>
    <div class="chips">
      ${TAGS.map(([t, col]) => `<button class="chip ${state.tagFilter.has(t) ? 'on' : ''}" data-tag="${t}"><span class="dot" style="background:${col}"></span>${t}</button>`).join('')}
      <button class="chip ${state.showOcc ? 'on' : ''}" data-occ="1"><span class="dot" style="background:var(--gold)"></span>Occasions</button>
    </div>
    ${body}
    <button class="fab" data-act="new" aria-label="New post">+</button>`;
  v.onclick = e => {
    const t = e.target.closest('[data-act],[data-mode],[data-tag],[data-occ],[data-day],[data-post],[data-occid]');
    if (!t) return;
    if (t.dataset.post) return openPost(store.get('posts', t.dataset.post));
    if (t.dataset.occid) return openOccasion(t.dataset.occid, t.dataset.date);
    if (t.dataset.day) return openDay(t.dataset.day);
    if (t.dataset.mode) { state.calMode = t.dataset.mode; localStorage.setItem('pdhw:calMode', state.calMode); return render(); }
    if (t.dataset.tag) { state.tagFilter.has(t.dataset.tag) ? state.tagFilter.delete(t.dataset.tag) : state.tagFilter.add(t.dataset.tag); return render(); }
    if (t.dataset.occ) { state.showOcc = !state.showOcc; return render(); }
    const a = t.dataset.act;
    if (a === 'today') state.cursor = new Date();
    if (a === 'prev' || a === 'next') {
      const k = a === 'prev' ? -1 : 1;
      if (state.calMode === 'month') state.cursor = new Date(c.getFullYear(), c.getMonth() + k, 1);
      else state.cursor = addDays(c, 7 * k);
    }
    if (a === 'new') return openPost({ date: state.calMode === 'week' || sameMonth(new Date(), c) ? todayISO() : iso(new Date(c.getFullYear(), c.getMonth(), 1)) });
    render();
  };
  // swipe between months/weeks
  let x0 = null;
  v.ontouchstart = e => { x0 = e.touches[0].clientX; };
  v.ontouchend = e => {
    if (x0 === null || document.querySelector('#sheet:not([hidden])')) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) < 70) return;
    v.querySelector(`[data-act="${dx < 0 ? 'next' : 'prev'}"]`)?.click();
  };
}
const sameMonth = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();

function postBar(p) {
  const col = TAG_COLOR[(p.tags || [])[0]] || 'var(--ink)';
  return `<div class="bar ${p.approved ? 'ok' : ''}" style="--c:${col}" data-post="${p.id}">${esc(p.title || 'Untitled')}</div>`;
}
function occBar(o) {
  return `<div class="bar occ ${o.round ? 'round' : ''}" data-occid="${esc(o.id)}" data-date="${o.date}">${o.round ? '★ ' : ''}${esc(o.title)}</div>`;
}
function monthGrid(c) {
  const first = new Date(c.getFullYear(), c.getMonth(), 1);
  const start = startOfWeek(first);
  const today = todayISO();
  const maxBars = innerWidth < 600 ? 2 : 3;
  let html = DOW.map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && d.getMonth() !== c.getMonth()) break;
    const ds = iso(d);
    const posts = postsOn(ds), occ = occasionsOn(ds);
    // own occasions and round anniversaries first, then posts, then other presets
    const important = occ.filter(o => !o.preset || o.round), rest = occ.filter(o => o.preset && !o.round);
    const items = [...important.map(occBar), ...posts.map(postBar), ...rest.map(occBar)];
    const shown = items.slice(0, maxBars), more = items.length - shown.length;
    html += `<div class="day ${d.getMonth() !== c.getMonth() ? 'out' : ''} ${ds === today ? 'today' : ''}" data-day="${ds}">
      <span class="n">${d.getDate()}</span>${shown.join('')}${more > 0 ? `<span class="more">+${more} more</span>` : ''}</div>`;
  }
  return `<div class="month">${html}</div>`;
}
function weekList(s) {
  const today = todayISO();
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(s, i), ds = iso(d);
    const posts = postsOn(ds), occ = occasionsOn(ds);
    html += `<div class="wday ${ds === today ? 'today' : ''}">
      <div class="wday-h"><b>${DOW[i]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}</b><button class="btn ghost sm" data-day="${ds}">Open</button></div>
      ${occ.map(occItem).join('')}${posts.map(postItem).join('')}
      ${posts.length + occ.length === 0 ? '<div class="muted small">Nothing planned</div>' : ''}
    </div>`;
  }
  return `<div class="week">${html}</div>`;
}
function postItem(p) {
  const col = TAG_COLOR[(p.tags || [])[0]] || 'var(--ink)';
  return `<div class="item" style="--c:${col}" data-post="${p.id}"><div class="stripe"></div><div class="body">
    <div class="t">${esc(p.title || 'Untitled')}</div>
    <div class="meta"><span class="pill">${TYPES[p.type] || ''}</span>${(p.tags || []).map(t => `<span class="tagpill" style="--c:${TAG_COLOR[t]}">${t}</span>`).join('')}
    ${p.approved ? '<span class="pill ok">Approved ✓</span>' : '<span class="pill">Not approved</span>'}
    <span>${(p.platforms || []).join(' · ')}</span></div></div></div>`;
}
function occItem(o) {
  return `<div class="item" style="--c:var(--gold)" data-occid="${esc(o.id)}" data-date="${o.date}"><div class="stripe"></div><div class="body">
    <div class="t">${o.round ? '★ ' : ''}${esc(o.title)}</div>
    <div class="meta">${o.sub ? `<span>${esc(o.sub)}</span>` : ''}${o.preset ? '<span class="pill gold">Preloaded</span>' : `<span class="pill gold">${o.kind === 'event' ? 'Event' : 'Occasion'}</span>`}</div></div></div>`;
}

/* ---- sheets ---- */
function openSheet(html, onClick) {
  const sh = $('#sheet'), bd = $('#sheetBackdrop');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  sh.hidden = bd.hidden = false;
  sh.scrollTop = 0;
  sh.onclick = e => { if (e.target.closest('[data-close]')) return closeSheet(); onClick && onClick(e); };
  bd.onclick = closeSheet;
}
function closeSheet() { $('#sheet').hidden = $('#sheetBackdrop').hidden = true; $('#sheet').innerHTML = ''; }
addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

function openDay(ds) {
  const posts = store.all('posts').filter(p => p.date === ds);
  const occ = occasionsOn(ds);
  openSheet(`
    <div class="sheet-h"><h2>${nice(ds)}</h2><button class="icon-btn" data-close>✕</button></div>
    ${occ.length ? `<h3>Occasions</h3>${occ.map(occItem).join('')}` : ''}
    <h3>Posts</h3>${posts.length ? posts.map(postItem).join('') : '<div class="empty">No posts planned for this day</div>'}
    <div class="sheet-foot"><button class="btn ghost" data-new-occ>+ Occasion / event</button><button class="btn" data-new-post>+ Post idea</button></div>`,
    e => {
      const t = e.target.closest('[data-post],[data-occid],[data-new-post],[data-new-occ]');
      if (!t) return;
      if (t.dataset.post) openPost(store.get('posts', t.dataset.post));
      else if (t.dataset.occid) openOccasion(t.dataset.occid, t.dataset.date);
      else if ('newPost' in t.dataset) openPost({ date: ds });
      else openOccasion(null, ds);
    });
}

function openPost(p) {
  p = { type: 'reel', tags: [], platforms: null, title: '', captionEn: '', captionDe: '', approved: false, ...p };
  if (!p.platforms) p.platforms = [...DEFAULT_PLATFORMS[p.type]];
  const isNew = !p.id;
  const tagsSel = new Set(p.tags);
  openSheet(`
    <div class="sheet-h"><h2>${isNew ? 'New post idea' : 'Edit post'}</h2><button class="icon-btn" data-close>✕</button></div>
    <label class="f"><span>Title</span><input type="text" id="pTitle" value="${esc(p.title)}" placeholder="e.g. Brahms Hungarian Dance No. 5 – rehearsal clip"></label>
    <label class="f"><span>Date</span><input type="date" id="pDate" value="${p.date || todayISO()}"></label>
    <label class="f"><span>Type</span></label>
    <div class="seg" id="pType">${Object.entries(TYPES).map(([k, l]) => `<button data-type="${k}" class="${p.type === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="f"><span>Platforms</span></label>
    <div class="row" id="pPlat">${PLATFORMS.map(pl => `<label class="check"><input type="checkbox" value="${pl}" ${p.platforms.includes(pl) ? 'checked' : ''}>${pl}</label>`).join('')}</div>
    <label class="f"><span>Tags</span></label>
    <div class="row" id="pTags">${TAGS.map(([t, col]) => `<button class="chip ${tagsSel.has(t) ? 'on' : ''}" data-t="${t}"><span class="dot" style="background:${col}"></span>${t}</button>`).join('')}</div>
    <label class="f"><span>Caption – English</span><textarea id="pEn" placeholder="Draft caption in English">${esc(p.captionEn)}</textarea></label>
    <label class="f"><span>Caption – German</span><textarea id="pDe" placeholder="Deutsche Fassung">${esc(p.captionDe)}</textarea></label>
    <div class="aibox">
      <div class="row"><button class="btn gold sm" data-ai="en">✨ Polish English</button><button class="btn gold sm" data-ai="de">✨ English → German</button>
      ${CAPTION_STUDIO_URL ? '<button class="btn ghost sm" data-studio>Caption Studio (Claude)</button>' : ''}</div>
      <div class="small muted" id="aiMsg" style="margin-top:6px">${store.get('settings', 'ai')?.key ? 'Gemini rewrites the caption using your caption rules. Check the result before saving.' : 'Add your free Gemini API key in Settings to use the built-in caption assistant.'}</div>
      <ul class="ainotes" id="aiNotes"></ul>
    </div>
    <div style="margin-top:14px"><label class="check"><input type="checkbox" id="pOk" ${p.approved ? 'checked' : ''}>Approved by the duo</label></div>
    <div class="sheet-foot">
      ${isNew ? '<span></span>' : '<button class="btn danger" data-del>Delete</button>'}
      <div class="row"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div>
    </div>`,
    async e => {
      const t = e.target.closest('[data-type],[data-t],[data-save],[data-del],[data-studio],[data-ai],[data-undo]');
      if (!t) return;
      if (t.dataset.undo) {
        if (t.dataset.undo === 'en' && p._enBefore !== undefined) { $('#pEn').value = p._enBefore; delete p._enBefore; }
        if (t.dataset.undo === 'de' && p._deBefore !== undefined) { $('#pDe').value = p._deBefore; delete p._deBefore; }
        $('#aiMsg').textContent = 'Restored your previous text.'; $('#aiNotes').innerHTML = '';
        return;
      }
      if (t.dataset.type) {
        p.type = t.dataset.type;
        document.querySelectorAll('#pType button').forEach(b => b.classList.toggle('on', b.dataset.type === p.type));
        document.querySelectorAll('#pPlat input').forEach(i => i.checked = DEFAULT_PLATFORMS[p.type].includes(i.value));
      } else if (t.dataset.t) {
        tagsSel.has(t.dataset.t) ? tagsSel.delete(t.dataset.t) : tagsSel.add(t.dataset.t);
        t.classList.toggle('on');
      } else if (t.dataset.ai) {
        const ai = store.get('settings', 'ai');
        const msg = $('#aiMsg'), notes = $('#aiNotes');
        if (!ai?.key) { msg.innerHTML = 'No Gemini key yet. Go to <b>Settings → Caption assistant</b> to add it.'; return; }
        const src = $('#pEn').value.trim();
        if (!src) { msg.textContent = 'Write the English caption first.'; $('#pEn').focus(); return; }
        const btns = document.querySelectorAll('[data-ai]'); btns.forEach(b => b.disabled = true);
        const context = [TYPES[p.type], $('#pTitle').value.trim(), [...tagsSel].join(', ')].filter(Boolean).join(' · ');
        notes.innerHTML = '';
        try {
          const models = await pickModels(ai.key, ai.model);
          let r;
          if (t.dataset.ai === 'en') {
            r = await polishEnglish(ai.key, models, src, context, st => { msg.textContent = st; });
            if (!p._enBefore) p._enBefore = $('#pEn').value;
            $('#pEn').value = r.text;
          } else {
            r = await toGerman(ai.key, models, src, context, step => { msg.textContent = step; });
            if (!p._deBefore) p._deBefore = $('#pDe').value;
            $('#pDe').value = r.text;
          }
          notes.innerHTML = r.notes.map(n => `<li>${esc(n)}</li>`).join('');
          msg.innerHTML = `Done with ${esc(usedModel())}. Edit if you like, then Save. <button class="linkbtn" data-undo="${t.dataset.ai}">Undo</button>`;
        } catch (err) {
          msg.textContent = err.message || 'Something went wrong. Try again.';
        } finally { btns.forEach(b => b.disabled = false); }
      } else if ('studio' in t.dataset) {
        const text = $('#pEn').value.trim();
        try { if (text) { await navigator.clipboard.writeText(text); toast('English caption copied'); } } catch {}
        window.open(CAPTION_STUDIO_URL, '_blank', 'noopener');
      } else if ('del' in t.dataset) {
        if (confirm('Delete this post idea?')) { store.del('posts', p.id); closeSheet(); toast('Deleted'); }
      } else if ('save' in t.dataset) {
        const o = {
          ...p,
          title: $('#pTitle').value.trim(),
          date: $('#pDate').value || todayISO(),
          platforms: [...document.querySelectorAll('#pPlat input:checked')].map(i => i.value),
          tags: TAGS.map(x => x[0]).filter(x => tagsSel.has(x)),
          captionEn: $('#pEn').value,
          captionDe: $('#pDe').value,
          approved: $('#pOk').checked,
        };
        delete o._enBefore; delete o._deBefore;
        if (!o.title) { $('#pTitle').focus(); return toast('Give the post a title'); }
        store.put('posts', o);
        closeSheet(); toast(isNew ? 'Post idea saved' : 'Saved');
      }
    });
}

function openOccasion(id, ds) {
  if (id && id.startsWith('preset:')) {
    const o = occasionsOn(ds).find(x => x.id === id) || occasionsInYear(+ds.slice(0, 4)).find(x => x.id === id);
    if (!o) return;
    return openSheet(`
      <div class="sheet-h"><h2>${o.round ? '★ ' : ''}${esc(o.title)}</h2><button class="icon-btn" data-close>✕</button></div>
      <p class="muted">${nice(o.date)}${o.sub ? ' · ' + esc(o.sub) : ''}</p>
      <p class="small muted">Preloaded date. You can hide preloaded anniversaries or show only round ones in Settings.</p>
      <div class="sheet-foot"><span></span><button class="btn" data-plan>Plan a post for this</button></div>`,
      e => { if (e.target.closest('[data-plan]')) openPost({ date: o.date, title: o.title }); });
  }
  const o = id ? store.get('occasions', id) : { date: ds || todayISO(), title: '', kind: 'anniversary', yearly: true, note: '' };
  if (!o) return;
  const isNew = !o.id;
  openSheet(`
    <div class="sheet-h"><h2>${isNew ? 'New occasion' : 'Edit occasion'}</h2><button class="icon-btn" data-close>✕</button></div>
    <label class="f"><span>Title</span><input type="text" id="oTitle" value="${esc(o.title)}" placeholder="e.g. Duo founded in Graz"></label>
    <label class="f"><span>Kind</span><select id="oKind">
      <option value="anniversary" ${o.kind === 'anniversary' ? 'selected' : ''}>Anniversary</option>
      <option value="event" ${o.kind === 'event' ? 'selected' : ''}>Event / concert</option>
      <option value="other" ${o.kind === 'other' ? 'selected' : ''}>Other occasion</option></select></label>
    <label class="f"><span>Date</span><input type="date" id="oDate" value="${o.date}"></label>
    <p class="small muted" style="margin:6px 0 0">For anniversaries, enter the original date (e.g. the year it happened) so the app can count the years.</p>
    <div style="margin-top:12px"><label class="check"><input type="checkbox" id="oYearly" ${o.yearly ? 'checked' : ''}>Repeats every year</label></div>
    <label class="f"><span>Note</span><input type="text" id="oNote" value="${esc(o.note)}"></label>
    <div class="sheet-foot">
      ${isNew ? '<span></span>' : '<button class="btn danger" data-del>Delete</button>'}
      <div class="row"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div>
    </div>`,
    e => {
      if (e.target.closest('[data-del]')) { if (confirm('Delete this occasion?')) { store.del('occasions', o.id); closeSheet(); } return; }
      if (!e.target.closest('[data-save]')) return;
      const n = { ...o, title: $('#oTitle').value.trim(), kind: $('#oKind').value, date: $('#oDate').value, yearly: $('#oYearly').checked, note: $('#oNote').value.trim() };
      if (!n.title) return toast('Give it a title');
      store.put('occasions', n); closeSheet(); toast('Saved');
    });
}

/* ---- reminders ---- */
const BACKUP_DAYS = 15;
function backupDue() {
  let since = store.setting('lastBackup', 0);
  if (!since) { try { since = +localStorage.getItem('pdhw:since') || 0; } catch {} }
  return !!since && Date.now() - since >= BACKUP_DAYS * 864e5;
}
function downloadBackup() {
  const blob = new Blob([JSON.stringify({ app: 'PIANO DUO HW', exported: new Date().toISOString(), posts: store.all('posts'), occasions: store.all('occasions'), reminders: store.all('reminders'), starred: store.all('starred'), settings: store.all('settings').filter(x => x.id !== 'push' && x.id !== 'ai') }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `piano-duo-hw-backup-${todayISO()}.json`; a.click();
  store.setSetting('lastBackup', Date.now());
  toast('Backup downloaded');
}
function dueItems() {
  const today = todayISO(), tomorrow = iso(addDays(new Date(), 1));
  const owed = store.all('reminders').filter(r => !r.done && r.due <= today);
  const postsTomorrow = store.all('posts').filter(p => p.date === tomorrow);
  return { owed, postsTomorrow, backup: backupDue() };
}
function updateBadge() {
  const { owed, postsTomorrow, backup } = dueItems();
  const n = owed.length + postsTomorrow.length + (backup ? 1 : 0), b = $('#remBadge');
  b.hidden = !n; b.textContent = n;
}
function renderReminders(v) {
  const today = todayISO(), tomorrow = iso(addDays(new Date(), 1));
  const all = store.all('reminders').sort((a, b) => a.due.localeCompare(b.due));
  const open = all.filter(r => !r.done), done = all.filter(r => r.done).reverse().slice(0, 30);
  const upcomingPosts = store.all('posts').filter(p => p.date >= today && p.date <= iso(addDays(new Date(), 7))).sort((a, b) => a.date.localeCompare(b.date));
  const remRow = r => {
    const overdue = !r.done && r.due < today, isToday = r.due === today;
    return `<div class="item" style="--c:${overdue ? '#a3261b' : isToday ? 'var(--gold)' : 'var(--sand)'}" data-rem="${r.id}">
      <div class="stripe"></div>
      <label class="check" style="border:0;padding:0;background:none" onclick="event.stopPropagation()"><input type="checkbox" data-done="${r.id}" ${r.done ? 'checked' : ''}></label>
      <div class="body"><div class="t" style="${r.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(r.text)}</div>
      <div class="meta"><span>${overdue ? '<b style="color:#a3261b">Overdue</b> · ' : isToday ? '<b>Due today</b> · ' : ''}${nice(r.due)}</span></div></div></div>`;
  };
  v.innerHTML = `
    <h2>Reminders</h2>
    ${backupDue() ? `<div class="card spread" style="border-color:var(--gold)"><div><b>Time to back up</b><div class="small muted">${store.setting('lastBackup', 0) ? 'Your last backup was ' + Math.floor((Date.now() - store.setting('lastBackup', 0)) / 864e5) + ' days ago.' : 'You haven’t made a backup yet.'} Keep the file somewhere safe, e.g. your cloud drive.</div></div><button class="btn gold sm" style="white-space:nowrap;flex:none" data-backup>Back up now</button></div>` : ''}
    <div class="card">
      <label class="f" style="margin-top:0"><span>What do they owe you?</span><input type="text" id="rText" placeholder="e.g. Rehearsal video of Poulenc 1st mvt"></label>
      <div class="row" style="margin-top:10px;flex-wrap:nowrap">
        <input type="date" id="rDue" value="${iso(addDays(new Date(), 3))}" style="flex:1">
        <button class="btn" data-add>Add</button>
      </div>
    </div>
    <h3>Waiting for</h3>${open.length ? open.map(remRow).join('') : '<div class="empty">Nothing outstanding</div>'}
    <h3>Posts in the next 7 days</h3>
    ${upcomingPosts.length ? upcomingPosts.map(p => `<div class="small muted" style="margin:8px 2px 0">${p.date === tomorrow ? '<b style="color:var(--gold)">Tomorrow</b> · ' : p.date === today ? '<b>Today</b> · ' : ''}${nice(p.date)}</div>${postItem(p)}`).join('') : '<div class="empty">No posts scheduled this week</div>'}
    ${done.length ? `<h3>Done</h3>${done.map(remRow).join('')}` : ''}
  `;
  v.onclick = e => {
    const t = e.target.closest('[data-add],[data-done],[data-rem],[data-post],[data-backup]');
    if (!t) return;
    if ('backup' in t.dataset) return downloadBackup();
    if (t.dataset.post) return openPost(store.get('posts', t.dataset.post));
    if (t.dataset.done) { const r = store.get('reminders', t.dataset.done); store.put('reminders', { ...r, done: t.checked }); return; }
    if (t.dataset.rem) return editReminder(store.get('reminders', t.dataset.rem));
    const text = $('#rText').value.trim();
    if (!text) return $('#rText').focus();
    store.put('reminders', { text, due: $('#rDue').value || todayISO(), done: false });
    toast('Reminder added');
  };
  v.onchange = e => { if (e.target.dataset.done) { const r = store.get('reminders', e.target.dataset.done); store.put('reminders', { ...r, done: e.target.checked }); } };
  v.ontouchstart = v.ontouchend = null;
}
function editReminder(r) {
  openSheet(`
    <div class="sheet-h"><h2>Edit reminder</h2><button class="icon-btn" data-close>✕</button></div>
    <label class="f"><span>What do they owe you?</span><input type="text" id="eText" value="${esc(r.text)}"></label>
    <label class="f"><span>Due</span><input type="date" id="eDue" value="${r.due}"></label>
    <div class="sheet-foot"><button class="btn danger" data-del>Delete</button>
      <div class="row"><button class="btn ghost" data-close>Cancel</button><button class="btn" data-save>Save</button></div></div>`,
    e => {
      if (e.target.closest('[data-del]')) { store.del('reminders', r.id); closeSheet(); }
      if (e.target.closest('[data-save]')) { store.put('reminders', { ...r, text: $('#eText').value.trim() || r.text, due: $('#eDue').value || r.due }); closeSheet(); }
    });
}

/* ---- news ---- */
let newsCache = null;
const NEWS_LIMIT = 50;
const newsUI = { view: 'latest', lang: 'all', q: '' };
async function loadJSON(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
function newsId(n) {
  let h = 0; const str = n.link || n.title;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return 'n' + (h >>> 0).toString(36);
}
function readSet() { return new Set(store.get('settings', 'newsRead')?.ids || []); }
function markRead(ids) {
  const cur = store.get('settings', 'newsRead')?.ids || [];
  const set = new Set(cur); let changed = false;
  for (const id of ids) if (!set.has(id)) { set.add(id); changed = true; }
  if (changed) store.put('settings', { id: 'newsRead', ids: [...set].slice(-400) });
}
function newsCard(n, starred, isNew) {
  return `<div class="news">
    <div class="spread" style="align-items:flex-start">
      <a class="t" href="${esc(n.link)}" target="_blank" rel="noopener" data-read="${newsId(n)}" style="color:inherit;text-decoration:none;flex:1;min-width:0">${isNew ? '<span class="newtag">NEW!</span> ' : ''}${esc(n.title)}</a>
      <button class="icon-btn star" data-star="${newsId(n)}" aria-label="${starred ? 'Remove star' : 'Star'}" title="${starred ? 'Remove star' : 'Star to keep'}" style="color:${starred ? 'var(--gold)' : 'var(--sand)'};margin:-6px -6px 0 0">${starred ? '★' : '☆'}</button>
    </div>
    <div class="meta"><span>${esc(n.source)}</span><span>${n.date ? new Date(n.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>${n.keyword ? `<span class="pill">${esc(n.keyword)}</span>` : ''}
    ${starred ? '' : `<button class="mute" data-mute="${esc(n.source)}">Hide this source</button>`}</div></div>`;
}
function renderNews(v) {
  v.ontouchstart = v.ontouchend = null;
  if (!newsCache) {
    v.innerHTML = '<h2>News</h2><div class="empty">Loading…</div>';
    loadJSON('data/news.json').then(d => { newsCache = d; if (state.tab === 'news') render(); })
      .catch(() => { newsCache = { items: [], error: true }; if (state.tab === 'news') render(); });
    return;
  }
  const muted = store.setting('mutedSources', []);
  const starredList = store.all('starred').sort((a, b) => (b.starredAt || 0) - (a.starredAt || 0));
  const starredIds = new Set(starredList.map(x => x.id));
  const q = newsUI.q.toLowerCase();
  const match = n => (newsUI.lang === 'all' || n.lang === newsUI.lang) && (!q || (n.title + ' ' + n.source).toLowerCase().includes(q));
  const latest = (newsCache.items || []).filter(n => !muted.includes(n.source)).slice(0, NEWS_LIMIT).filter(match);
  const starred = starredList.filter(match);
  const list = newsUI.view === 'starred' ? starred : latest;
  const read = readSet();
  const unread = latest.filter(n => !read.has(newsId(n)));
  v.innerHTML = `
    <div class="spread"><h2>News</h2><span class="muted small">${newsCache.updated ? 'Updated ' + new Date(newsCache.updated).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span></div>
    <div class="seg" style="margin-bottom:10px"><button data-view="latest" class="${newsUI.view === 'latest' ? 'on' : ''}">Latest ${NEWS_LIMIT}${unread.length ? ' · ' + unread.length + ' new' : ''}</button><button data-view="starred" class="${newsUI.view === 'starred' ? 'on' : ''}">Starred${starredList.length ? ' (' + starredList.length + ')' : ''}</button></div>
    <div class="row" style="margin-bottom:10px;flex-wrap:nowrap">
      <div class="seg">${[['all', 'All'], ['en', 'EN'], ['de', 'DE']].map(([k, l]) => `<button data-lang="${k}" class="${newsUI.lang === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <input type="search" id="nq" placeholder="Search" value="${esc(newsUI.q)}" style="flex:1;min-width:0">
    </div>
    ${newsCache.error && newsUI.view === 'latest' ? '<div class="empty">Couldn’t load the news. If you’re offline, it will appear once you reconnect.</div>' : ''}
    ${newsUI.view === 'latest' && unread.length ? '<div class="row" style="justify-content:flex-end;margin-bottom:4px"><button class="btn ghost sm" data-allread>Mark all as read</button></div>' : ''}
    ${list.length ? list.map(n => newsCard(n, starredIds.has(newsId(n)), newsUI.view === 'latest' && !read.has(newsId(n)))).join('') :
      (newsUI.view === 'starred' ? '<div class="empty">No starred news yet. Tap ☆ on an article to keep it here.</div>' : newsCache.error ? '' : '<div class="empty">No news matches</div>')}
    ${muted.length && newsUI.view === 'latest' ? `<h3>Hidden sources</h3><div class="row">${muted.map(s => `<button class="chip" data-unmute="${esc(s)}">${esc(s)} ✕</button>`).join('')}</div>` : ''}
  `;
  v.onclick = e => {
    const t = e.target.closest('[data-lang],[data-mute],[data-unmute],[data-view],[data-star],[data-read],[data-allread]');
    if (!t) return;
    if (t.dataset.read) { markRead([t.dataset.read]); return; } // link still opens
    if ('allread' in t.dataset) { markRead(unread.map(newsId)); return; }
    if (t.dataset.star) {
      const id = t.dataset.star;
      if (starredIds.has(id)) { store.del('starred', id); toast('Star removed'); }
      else {
        const n = (newsCache.items || []).find(x => newsId(x) === id);
        if (n) { store.put('starred', { id, title: n.title, link: n.link, source: n.source, date: n.date, lang: n.lang, keyword: n.keyword, starredAt: Date.now() }); toast('Starred'); }
      }
      return;
    }
    if (t.dataset.view) { newsUI.view = t.dataset.view; return render(); }
    if (t.dataset.mute) { store.setSetting('mutedSources', [...new Set([...muted, t.dataset.mute])]); toast('Source hidden'); return; }
    if (t.dataset.unmute) { store.setSetting('mutedSources', muted.filter(s => s !== t.dataset.unmute)); return; }
    newsUI.lang = t.dataset.lang; render();
  };
  const nq = $('#nq');
  nq.oninput = () => { newsUI.q = nq.value; clearTimeout(nq.t); nq.t = setTimeout(() => { render(); const x = $('#nq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 300); };
}

/* ---- concerts ---- */
let concertCache = null;
const cUI = { by: 'venue', region: 'europe', from: 2005, q: '' };
const BY = { venue: 'Venues', promoter: 'Promoters', festival: 'Festivals', orchestra: 'Orchestras' };
function aggregate(list, key) {
  const m = new Map();
  for (const c of list) {
    const name = (c[key] || '').trim();
    if (!name) continue;
    const k = name.toLowerCase();
    if (!m.has(k)) m.set(k, { name, city: c.city, country: c.country, count: 0, last: 0, duos: new Set(), rep: new Set(), concerts: [], keys: new Set() });
    const g = m.get(k);
    // One booking = one duo engagement (a tour or run of dates in the same month counts once for orchestras/festivals/promoters)
    g.keys.add(`${c.duo}|${key === 'venue' ? c.date : String(c.date).slice(0, 7)}`);
    g.count = g.keys.size; g.last = Math.max(g.last, c.year || 0);
    if (key !== 'venue' && g.city !== c.city) g.city = '';
    if (c.duo) g.duos.add(c.duo);
    (c.repertoire || []).forEach(r => g.rep.add(r));
    g.concerts.push(c);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}
function filteredConcerts() {
  const q = cUI.q.toLowerCase();
  return (concertCache.concerts || []).filter(c =>
    (c.year || 0) >= cUI.from &&
    (cUI.region === 'europe' || DACH.has(c.country)) &&
    (!q || JSON.stringify(c).toLowerCase().includes(q)));
}
function renderConcerts(v) {
  v.ontouchstart = v.ontouchend = null;
  if (!concertCache) {
    v.innerHTML = '<h2>Concerts</h2><div class="empty">Loading…</div>';
    loadJSON('data/concerts.json').then(d => { concertCache = d; if (state.tab === 'concerts') render(); })
      .catch(() => { concertCache = { concerts: [], error: true }; if (state.tab === 'concerts') render(); });
    return;
  }
  const list = filteredConcerts();
  const rows = aggregate(list, cUI.by);
  const years = [...new Set((concertCache.concerts || []).map(c => c.year))].filter(Boolean).sort();
  v.innerHTML = `
    <div class="spread"><h2>Concerts</h2><button class="btn ghost sm" data-export>Export to Excel</button></div>
    <div>
      <span class="stat"><b>${list.length}</b><span>concerts</span></span>
      <span class="stat"><b>${new Set(list.map(c => c.duo)).size}</b><span>duos</span></span>
      <span class="stat"><b>${list.filter(c => DACH.has(c.country)).length}</b><span>in DACH</span></span>
      <span class="stat"><b>${concertCache.updated ? new Date(concertCache.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–'}</b><span>last update</span></span>
    </div>
    <div class="chips" style="margin-top:6px">${Object.entries(BY).map(([k, l]) => `<button class="chip ${cUI.by === k ? 'on' : ''}" data-by="${k}">${l}</button>`).join('')}</div>
    <div class="row" style="margin:6px 0 12px;flex-wrap:nowrap">
      <div class="seg"><button data-region="europe" class="${cUI.region === 'europe' ? 'on' : ''}">Europe</button><button data-region="dach" class="${cUI.region === 'dach' ? 'on' : ''}">DACH</button></div>
      <select id="cFrom" style="width:auto">${[2005, ...years.filter(y => y > 2005)].filter((y, i, a) => a.indexOf(y) === i).map(y => `<option value="${y}" ${+cUI.from === y ? 'selected' : ''}>From ${y}</option>`).join('')}</select>
      <input type="search" id="cq" placeholder="Search" value="${esc(cUI.q)}" style="flex:1;min-width:0">
    </div>
    ${concertCache.error ? '<div class="empty">Couldn’t load the concert data. If you’re offline, it will appear once you reconnect.</div>' :
      rows.length ? `<div class="tablewrap"><table class="rank"><thead><tr><th>#</th><th>${BY[cUI.by].slice(0, -1)}</th><th>Duo bookings</th><th>Last</th><th>Duos</th><th>Repertoire</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${DACH.has(r.country) ? 'dach' : ''}" data-row="${i}" style="cursor:pointer">
        <td>${i + 1}</td><td><b>${esc(r.name)}</b><div class="small muted">${esc([r.city, COUNTRY[r.country] || r.country].filter(Boolean).join(', '))}</div></td>
        <td>${r.count}</td><td>${r.last || '–'}</td><td class="small">${esc([...r.duos].join(', '))}</td><td class="small">${esc([...r.rep].slice(0, 4).join('; '))}${r.rep.size > 4 ? ' …' : ''}</td></tr>`).join('')}
      </tbody></table></div><p class="small muted">Blue edge = DACH. A booking is one duo engagement: a tour or run of dates in the same month counts once. Tap a row for the concerts, duos, repertoire and sources.</p>` : '<div class="empty">No concerts match these filters yet</div>'}
  `;
  v.onclick = e => {
    const t = e.target.closest('[data-by],[data-region],[data-row],[data-export]');
    if (!t) return;
    if (t.dataset.by) { cUI.by = t.dataset.by; return render(); }
    if (t.dataset.region) { cUI.region = t.dataset.region; return render(); }
    if (t.dataset.row) return openGroup(rows[+t.dataset.row]);
    if ('export' in t.dataset) exportExcel(list);
  };
  $('#cFrom').onchange = e => { cUI.from = +e.target.value; render(); };
  const cq = $('#cq');
  cq.oninput = () => { cUI.q = cq.value; clearTimeout(cq.t); cq.t = setTimeout(() => { render(); const x = $('#cq'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 300); };
}
function openGroup(g) {
  const cs = [...g.concerts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  openSheet(`
    <div class="sheet-h"><h2>${esc(g.name)}</h2><button class="icon-btn" data-close>✕</button></div>
    <p class="muted">${esc([g.city, COUNTRY[g.country] || g.country].filter(Boolean).join(', '))} · ${g.count} duo booking${g.count > 1 ? 's' : ''} · ${g.concerts.length} concert${g.concerts.length > 1 ? 's' : ''} · last ${g.last}</p>
    <div class="small" style="margin-bottom:4px"><b>Duos:</b> ${esc([...g.duos].join(', '))}</div>
    ${g.rep.size ? `<div class="small muted"><b>Repertoire:</b> ${esc([...g.rep].join('; '))}</div>` : ''}
    <h3>Concerts</h3>
    ${cs.map(c => `<div class="card">
      <div class="spread"><b>${esc(c.duo || 'Piano duo')}</b><span class="small muted">${esc(c.date || c.year)}</span></div>
      <div class="small" style="margin-top:4px">${esc([c.venue, c.city].filter(Boolean).join(', '))}</div>
      ${c.festival ? `<div class="small">Festival: ${esc(c.festival)}</div>` : ''}
      ${c.promoter ? `<div class="small">Promoter: ${esc(c.promoter)}</div>` : ''}
      ${c.orchestra ? `<div class="small">Orchestra: ${esc(c.orchestra)}${c.conductor ? ' · cond. ' + esc(c.conductor) : ''}</div>` : ''}
      ${(c.repertoire || []).length ? `<div class="small muted" style="margin-top:4px">${esc(c.repertoire.join('; '))}</div>` : ''}
      ${c.source ? `<div class="small" style="margin-top:6px"><a href="${esc(c.source)}" target="_blank" rel="noopener" style="color:var(--blue)">Source</a></div>` : ''}
    </div>`).join('')}`);
}
async function exportExcel(list) {
  try {
    if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    const X = window.XLSX, wb = X.utils.book_new();
    const concertsRows = list.map(c => ({ Date: c.date || c.year, Year: c.year, Duo: c.duo, Venue: c.venue, City: c.city, Country: COUNTRY[c.country] || c.country, DACH: DACH.has(c.country) ? 'yes' : '', Festival: c.festival || '', Promoter: c.promoter || '', Orchestra: c.orchestra || '', Conductor: c.conductor || '', Repertoire: (c.repertoire || []).join('; '), Source: c.source || '' }));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(concertsRows), 'Concerts');
    for (const [k, l] of Object.entries(BY)) {
      const rows = aggregate(list, k).map(r => ({ [l.slice(0, -1)]: r.name, City: r.city || '', Country: COUNTRY[r.country] || r.country || '', DACH: DACH.has(r.country) ? 'yes' : '', 'Duo bookings': r.count, Concerts: r.concerts.length, 'Last year': r.last, Duos: [...r.duos].join(', '), Repertoire: [...r.rep].join('; ') }));
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows), l);
    }
    X.writeFile(wb, `piano-duo-concerts-${todayISO()}.xlsx`);
  } catch (e) { toast('Export needs an internet connection the first time'); }
}

/* ---- settings ---- */
function renderSettings(v) {
  v.ontouchstart = v.ontouchend = null;
  const s = store.status;
  const mode = store.setting('presetMode', 'all');
  const notif = 'Notification' in window ? Notification.permission : 'unsupported';
  v.innerHTML = `
    <h2>Settings</h2>
    <h3>Sync</h3>
    <div class="card">
      ${!store.canSync ? '<div class="small">Sync isn’t set up yet. Everything is saved on this device for now.</div>' :
        s.mode === 'cloud' ? `<div class="spread"><div class="small">Signed in as <b>${esc(s.user)}</b>. Phone and browser stay in sync, and the app works offline.<br>🔒 End-to-end encrypted: your entries are encrypted on your devices before syncing.</div><button class="btn ghost sm" data-signout>Sign out</button></div>` :
        `<div class="small">Sign in with your email to sync between your phone and browser. You’ll get a sign-in link by email; open it on this device.</div>
         <div class="row" style="margin-top:10px;flex-wrap:nowrap"><input type="email" id="sEmail" placeholder="you@example.com" value="${esc(localStorage.getItem('pdhw:email') || '')}" style="flex:1"><button class="btn" data-link>Send link</button></div>`}
    </div>
    <h3>Preloaded anniversaries</h3>
    <div class="seg">${[['all', 'All'], ['round', 'Round only (25, 50…)'], ['off', 'Off']].map(([k, l]) => `<button data-pm="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="small muted">About 45 composers whose works are core piano-duo repertoire, plus Piano Day, Fête de la Musique, International Music Day, Valentine’s Day, Chinese New Year and Mid-Autumn Festival. Round anniversaries show with ★.</p>
    <h3>Notifications</h3>
    <div class="card small">
      ${notif === 'granted' ? 'Notifications are on for this device.' : notif === 'denied' ? 'Notifications are blocked. Allow them in your browser or phone settings for this site.' : notif === 'unsupported' ? 'This browser doesn’t support notifications. On Android, install the app to your home screen first.' : '<div class="spread"><span>Get notified about due reminders and posts scheduled for tomorrow.</span><button class="btn sm" data-notif>Turn on</button></div>'}
    </div>
    <h3>Caption assistant</h3>
    <div class="card small">
      <div>Built-in caption help in each post, powered by Google Gemini’s free tier. Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="color:var(--blue)">aistudio.google.com/apikey</a> (sign in with Google → Create API key), then paste it here. ${store.status.mode === 'cloud' ? 'It is stored encrypted and synced to your devices.' : 'It is stored on this device.'}</div>
      <div class="row" style="margin-top:10px;flex-wrap:nowrap"><input type="password" id="aiKey" placeholder="${store.get('settings', 'ai')?.key ? 'Key saved – paste a new one to replace it' : 'Paste your Gemini API key'}" autocomplete="off" style="flex:1"><button class="btn sm" data-aisave>Save</button></div>
      ${store.get('settings', 'ai')?.key ? '<div class="row" style="margin-top:8px"><button class="btn ghost sm" data-aitest>Test key</button><button class="btn ghost sm" data-airemove>Remove key</button><span id="aiTestMsg" class="muted"></span></div>' : ''}
      <div class="muted" style="margin-top:8px">On the free tier Google may use the text you send to improve its products. Fine for captions that will be public anyway.</div>
      ${CAPTION_STUDIO_URL ? `<div style="margin-top:8px"><a href="${CAPTION_STUDIO_URL}" target="_blank" rel="noopener" style="color:var(--blue)">Open Caption Studio (Claude)</a> as an alternative.</div>` : ''}
    </div>
    <h3>Backup</h3>
    <p class="small muted" style="margin-top:0">${store.setting('lastBackup', 0) ? 'Last backup: ' + new Date(store.setting('lastBackup', 0)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + '. ' : ''}You’ll be reminded to back up every ${BACKUP_DAYS} days.</p>
    <div class="row"><button class="btn ghost sm" data-backup>Download backup (JSON)</button><label class="btn ghost sm">Restore backup<input type="file" id="restore" accept="application/json" hidden></label></div>
    <p class="small muted" style="margin-top:24px">PIANO DUO HW · personal planning tool</p>`;
  v.onclick = async e => {
    const t = e.target.closest('[data-pm],[data-link],[data-signout],[data-notif],[data-backup],[data-aisave],[data-aitest],[data-airemove]');
    if (!t) return;
    if ('aisave' in t.dataset) {
      const k = $('#aiKey').value.trim();
      if (k.length < 20) return toast('Paste the whole API key');
      store.put('settings', { id: 'ai', key: k }); toast('Key saved'); return render();
    }
    if ('airemove' in t.dataset) { store.del('settings', 'ai'); toast('Key removed'); return render(); }
    if ('aitest' in t.dataset) {
      const m = $('#aiTestMsg'); m.textContent = 'Testing…';
      try { const model = await pickModel(store.get('settings', 'ai').key); m.textContent = `Works. Using ${model}.`; }
      catch (err) { m.textContent = err.message; }
      return;
    }
    if (t.dataset.pm) { store.setSetting('presetMode', t.dataset.pm); occCache.clear(); return render(); }
    if ('link' in t.dataset) {
      const em = $('#sEmail').value.trim();
      if (!/.+@.+\..+/.test(em)) return toast('Enter your email');
      try { await store.sendLink(em); toast('Link sent. Check your inbox.'); } catch (err) { toast('Couldn’t send link: ' + (err.code || err.message)); }
    }
    if ('signout' in t.dataset) { await store.signOut(); render(); }
    if ('notif' in t.dataset) { await enableNotifications(); render(); }
    if ('backup' in t.dataset) { downloadBackup(); render(); }
  };
  $('#restore').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!confirm('Restore this backup? Entries with the same ID will be overwritten.')) return;
      for (const c of ['posts', 'occasions', 'reminders', 'settings', 'starred']) (d[c] || []).filter(o => o.id !== 'push' && o.id !== 'ai').forEach(o => store.put(c, o));
      toast('Backup restored');
    } catch { toast('That file isn’t a valid backup'); }
  };
}

/* ---------- notifications ---------- */
async function enableNotifications() {
  if (!('Notification' in window)) return;
  const p = await Notification.requestPermission();
  if (p !== 'granted') return;
  checkLocalNotifications();
  registerPush();
}
// Background push (works with the app closed) — needs sync + VAPID key
let pushRegistered = false, pushTrying = false;
async function registerPush() {
  if (pushRegistered || !('Notification' in window) || Notification.permission !== 'granted') return;
  const fb = store.firebase();
  if (!fb || !fb.uid || !VAPID_KEY || !('serviceWorker' in navigator) || pushTrying) return;
  pushTrying = true;
  try {
    const { getMessaging, getToken } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js');
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(fb.app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return;
    pushRegistered = true;
    const cur = store.get('settings', 'push') || { id: 'push', tokens: [] };
    if (!(cur.tokens || []).includes(token)) store.put('settings', { ...cur, since: cur.since || Date.now(), tokens: [...(cur.tokens || []), token].slice(-5) });
  } catch (e) { console.warn('push', e); }
}
async function checkLocalNotifications() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const today = todayISO();
  const seen = JSON.parse(localStorage.getItem('pdhw:notified') || '{}');
  const { owed, postsTomorrow } = dueItems();
  const msgs = [
    ...owed.map(r => [`rem:${r.id}:${today}`, 'Follow up with the duo', r.text]),
    ...postsTomorrow.map(p => [`post:${p.id}:${today}`, 'Post scheduled tomorrow', `${p.title}${p.approved ? '' : ' · not approved yet'}`]),
    ...(backupDue() ? [[`backup:${today}`, 'Time to back up PIANO DUO HW', 'Open Reminders and tap “Back up now”.']] : []),
  ].filter(([k]) => !seen[k]);
  if (!msgs.length) return;
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  for (const [k, title, body] of msgs) {
    try { reg ? reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: k }) : new Notification(title, { body }); } catch {}
    seen[k] = 1;
  }
  for (const k of Object.keys(seen)) if (!k.endsWith(today)) delete seen[k];
  localStorage.setItem('pdhw:notified', JSON.stringify(seen));
}

/* ---------- boot ---------- */
$('#tabs').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  state.tab = b.dataset.tab; closeSheet(); render(); scrollTo(0, 0);
};
let rt;
store.on(() => { cancelAnimationFrame(rt); rt = requestAnimationFrame(() => { if ($('#sheet').hidden) render(); else { updateBadge(); renderSync(); } }); });
try { if (!localStorage.getItem('pdhw:since')) localStorage.setItem('pdhw:since', String(Date.now())); } catch {}
store.init().then(() => { render(); checkLocalNotifications(); });
store.on(st => { if (st.mode === 'cloud') registerPush(); });
setInterval(checkLocalNotifications, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkLocalNotifications(); render(); } });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
