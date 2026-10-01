// Data layer: local-only (this device) or Firebase sync with offline cache.
// Cloud data is end-to-end encrypted (AES-GCM, key derived from a passphrase that never leaves the device).
// Only the fields needed for background reminders stay readable on the server (see PLAIN).
import { FIREBASE_CONFIG } from './config.js';

const COLS = ['posts', 'occasions', 'reminders', 'settings', 'starred'];
const PLAIN = { posts: ['date'], reminders: ['due', 'done'], settings: ['tokens', 'since', 'lastBackup'], occasions: [], starred: [] };
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
const LS = 'pdhw:';

const data = Object.fromEntries(COLS.map(c => [c, new Map()]));
const listeners = new Set();
let mode = 'local';           // 'local' | 'cloud'
let fb = null;                // { app, auth, db, api, authApi, uid }
let key = null;               // CryptoKey (AES-GCM) when unlocked
let meta = null;              // { salt, check } from users/{uid}/meta/crypto
let pending = [];             // items created before sign-in, uploaded once unlocked
let unsubs = [];
let status = { mode: 'local', user: null, online: navigator.onLine };

function emit() { for (const fn of listeners) fn(status); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* ---------- crypto ---------- */
const te = new TextEncoder(), td = new TextDecoder();
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, saltB64) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: unb64(saltB64), iterations: 310000, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(obj, k = key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, te.encode(JSON.stringify(obj)));
  const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
  // chunked base64 for large docs
  let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
}
async function open(str, k = key) {
  const all = unb64(str);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12) }, k, all.slice(12));
  return JSON.parse(td.decode(pt));
}
// Keep the derived (non-extractable) key in IndexedDB so the passphrase is needed once per device
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('pdhw-keys', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function keyGet(id) { try { const d = await idb(); return await new Promise(r => { const q = d.transaction('keys').objectStore('keys').get(id); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); } catch { return null; } }
async function keyPut(id, k) { try { const d = await idb(); await new Promise(r => { const t = d.transaction('keys', 'readwrite'); t.objectStore('keys').put(k, id); t.oncomplete = r; t.onerror = r; }); } catch {} }
async function keyDel(id) { try { const d = await idb(); await new Promise(r => { const t = d.transaction('keys', 'readwrite'); t.objectStore('keys').delete(id); t.oncomplete = r; t.onerror = r; }); } catch {} }

/* ---------- local ---------- */
function loadLocal() {
  for (const c of COLS) {
    try { data[c] = new Map(JSON.parse(localStorage.getItem(LS + c) || '[]').map(o => [o.id, o])); } catch { data[c] = new Map(); }
  }
}
function saveLocal(c) { try { localStorage.setItem(LS + c, JSON.stringify([...data[c].values()])); } catch {} }

/* ---------- cloud writes ---------- */
async function writeCloud(c, o) {
  const doc = { enc: await seal(o), updatedAt: o.updatedAt || Date.now() };
  for (const f of PLAIN[c]) if (o[f] !== undefined) doc[f] = o[f];
  await fb.api.setDoc(fb.api.doc(fb.db, 'users', fb.uid, c, o.id), doc);
}

export const store = {
  get status() { return status; },
  all(c) { return [...data[c].values()]; },
  get(c, id) { return data[c].get(id); },
  setting(k, fallback) { const s = data.settings.get('main'); return s && k in s ? s[k] : fallback; },
  setSetting(k, value) { const s = { ...(data.settings.get('main') || { id: 'main' }), [k]: value }; this.put('settings', s); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  put(c, obj) {
    const o = { ...obj, id: obj.id || uid(), updatedAt: Date.now() };
    data[c].set(o.id, o);
    if (mode === 'cloud' && key) writeCloud(c, o).catch(e => console.warn('sync', e));
    else if (mode === 'local') saveLocal(c);
    else if (mode === 'pending') pending.push([c, o]);
    emit();
    return o;
  },
  del(c, id) {
    data[c].delete(id);
    if (mode === 'cloud' && key) fb.api.deleteDoc(fb.api.doc(fb.db, 'users', fb.uid, c, id)).catch(e => console.warn('sync', e));
    else if (mode === 'local') saveLocal(c);
    emit();
  },

  async init() {
    loadLocal();
    addEventListener('online', () => { status.online = true; emit(); });
    addEventListener('offline', () => { status.online = false; emit(); });
    if (!FIREBASE_CONFIG) { emit(); return; }
    status.mode = 'connecting';
    try { await initFirebase(); } catch (e) { console.warn('Firebase failed, staying local', e); status.mode = 'local'; }
    emit();
  },

  async sendLink(email) {
    const url = location.origin + location.pathname;
    await fb.authApi.sendSignInLinkToEmail(fb.auth, email, { url, handleCodeInApp: true });
    localStorage.setItem(LS + 'email', email);
  },
  async signOut() { if (fb?.uid) await keyDel(fb.uid); key = null; await fb.authApi.signOut(fb.auth); },
  get canSync() { return !!FIREBASE_CONFIG; },
  firebase() { return fb; },

  // First device: choose a passphrase
  async setupEncryption(pass) {
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const k = await deriveKey(pass, salt);
    const check = await seal({ ok: true }, k);
    meta = { salt, check, created: Date.now() };
    await fb.api.setDoc(fb.api.doc(fb.db, 'users', fb.uid, 'meta', 'crypto'), meta);
    key = k; await keyPut(fb.uid, k);
    startSync();
  },
  // Other devices: unlock with the same passphrase
  async unlock(pass) {
    const k = await deriveKey(pass, meta.salt);
    try { await open(meta.check, k); } catch { throw new Error('wrong-passphrase'); }
    key = k; await keyPut(fb.uid, k);
    startSync();
  },
};

function startSync() {
  unsubs.forEach(u => u()); unsubs = [];
  mode = 'cloud';
  status = { ...status, mode: 'cloud' };
  for (const c of COLS) data[c] = new Map();
  // upload anything created on this device before signing in
  for (const [c, o] of pending) { data[c].set(o.id, o); writeCloud(c, o).catch(() => {}); }
  pending = [];
  for (const c of COLS) localStorage.removeItem(LS + c);
  const { api, db } = fb;
  for (const c of COLS) {
    unsubs.push(api.onSnapshot(api.collection(db, 'users', fb.uid, c), async snap => {
      await Promise.all(snap.docChanges().map(async ch => {
        if (ch.type === 'removed') { data[c].delete(ch.doc.id); return; }
        const d = ch.doc.data();
        if (d.enc) {
          try { data[c].set(ch.doc.id, { ...(await open(d.enc)), id: ch.doc.id }); }
          catch { console.warn('Could not decrypt', c, ch.doc.id); }
        } else {
          // legacy plaintext doc: keep it and re-save encrypted
          const o = { ...d, id: ch.doc.id };
          data[c].set(o.id, o);
          writeCloud(c, o).catch(() => {});
        }
      }));
      emit();
    }, err => console.warn('snapshot', c, err)));
  }
  emit();
}

async function initFirebase() {
  const [{ initializeApp }, authApi, api] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = authApi.getAuth(app);
  let db;
  try { db = api.initializeFirestore(app, { localCache: api.persistentLocalCache({ tabManager: api.persistentMultipleTabManager() }) }); }
  catch { db = api.getFirestore(app); }
  fb = { app, auth, db, api, authApi, uid: null };

  if (authApi.isSignInWithEmailLink(auth, location.href)) {
    let email = localStorage.getItem(LS + 'email');
    if (!email) email = prompt('Confirm your email address to finish signing in');
    if (email) {
      try { await authApi.signInWithEmailLink(auth, email, location.href); } catch { alert('Sign-in link expired or already used. Please request a new one.'); }
    }
    history.replaceState(null, '', location.pathname);
  }

  authApi.onAuthStateChanged(auth, async user => {
    unsubs.forEach(u => u()); unsubs = [];
    key = null;
    if (!user) {
      mode = 'local'; fb.uid = null; status = { ...status, mode: 'signed-out', user: null };
      loadLocal(); emit(); return;
    }
    fb.uid = user.uid;
    status = { ...status, user: user.email };
    if (mode === 'local') pending = COLS.flatMap(c => [...data[c].values()].map(o => [c, o]));
    mode = 'pending';
    for (const c of COLS) data[c] = new Map();
    emit();
    // Encryption state
    try {
      const snap = await api.getDoc(api.doc(db, 'users', user.uid, 'meta', 'crypto'));
      meta = snap.exists() ? snap.data() : null;
    } catch (e) {
      // offline and never cached: try the stored key anyway
      meta = undefined;
    }
    const stored = await keyGet(user.uid);
    if (stored && meta !== null) { key = stored; startSync(); return; }
    status = { ...status, mode: meta ? 'locked' : meta === null ? 'setup' : 'offline-locked' };
    emit();
  });
}
