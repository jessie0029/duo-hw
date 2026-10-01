// Data layer: local-only (this device) or Firebase sync with offline cache.
import { FIREBASE_CONFIG } from './config.js';

const COLS = ['posts', 'occasions', 'reminders', 'settings'];
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';
const LS = 'pdhw:';

const data = Object.fromEntries(COLS.map(c => [c, new Map()]));
const listeners = new Set();
let mode = 'local';
let fb = null; // { auth, db, uid, api }
let status = { mode: 'local', user: null, online: navigator.onLine };

function emit() { for (const fn of listeners) fn(status); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function loadLocal() {
  for (const c of COLS) {
    try {
      const arr = JSON.parse(localStorage.getItem(LS + c) || '[]');
      data[c] = new Map(arr.map(o => [o.id, o]));
    } catch { data[c] = new Map(); }
  }
}
function saveLocal(c) {
  try { localStorage.setItem(LS + c, JSON.stringify([...data[c].values()])); } catch {}
}

export const store = {
  get status() { return status; },
  all(c) { return [...data[c].values()]; },
  get(c, id) { return data[c].get(id); },
  setting(key, fallback) { const s = data.settings.get('main'); return s && key in s ? s[key] : fallback; },
  setSetting(key, value) { const s = { ...(data.settings.get('main') || { id: 'main' }), [key]: value }; this.put('settings', s); },
  on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  put(c, obj) {
    const o = { ...obj, id: obj.id || uid(), updatedAt: Date.now() };
    data[c].set(o.id, o);
    if (mode === 'cloud') {
      fb.api.setDoc(fb.api.doc(fb.db, 'users', fb.uid, c, o.id), o).catch(e => console.warn('sync', e));
    } else saveLocal(c);
    emit();
    return o;
  },
  del(c, id) {
    data[c].delete(id);
    if (mode === 'cloud') {
      fb.api.deleteDoc(fb.api.doc(fb.db, 'users', fb.uid, c, id)).catch(e => console.warn('sync', e));
    } else saveLocal(c);
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

  // Email-link sign-in
  async sendLink(email) {
    const { sendSignInLinkToEmail } = fb.authApi;
    const url = location.origin + location.pathname;
    await sendSignInLinkToEmail(fb.auth, email, { url, handleCodeInApp: true });
    localStorage.setItem(LS + 'email', email);
  },
  async signOut() { await fb.authApi.signOut(fb.auth); },
  get canSync() { return !!FIREBASE_CONFIG; },
  firebase() { return fb; },
};

async function initFirebase() {
  const [{ initializeApp }, authApi, api] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = authApi.getAuth(app);
  let db;
  try {
    db = api.initializeFirestore(app, { localCache: api.persistentLocalCache({ tabManager: api.persistentMultipleTabManager() }) });
  } catch { db = api.getFirestore(app); }
  fb = { app, auth, db, api, authApi, uid: null };

  // Complete sign-in if we arrived via an email link
  if (authApi.isSignInWithEmailLink(auth, location.href)) {
    let email = localStorage.getItem(LS + 'email');
    if (!email) email = prompt('Confirm your email address to finish signing in');
    if (email) {
      try { await authApi.signInWithEmailLink(auth, email, location.href); } catch (e) { alert('Sign-in link expired or already used. Please request a new one.'); }
    }
    history.replaceState(null, '', location.pathname);
  }

  let unsubs = [];
  authApi.onAuthStateChanged(auth, user => {
    unsubs.forEach(u => u()); unsubs = [];
    if (!user) {
      mode = 'local'; fb.uid = null; status = { ...status, mode: 'signed-out', user: null };
      loadLocal(); emit(); return;
    }
    fb.uid = user.uid; mode = 'cloud';
    status = { ...status, mode: 'cloud', user: user.email };
    // First sign-in on this device: upload anything created before signing in
    const pending = COLS.flatMap(c => [...data[c].values()].map(o => [c, o]));
    for (const c of COLS) data[c] = new Map();
    for (const [c, o] of pending) api.setDoc(api.doc(db, 'users', user.uid, c, o.id), o).catch(() => {});
    for (const c of COLS) localStorage.removeItem(LS + c);
    for (const c of COLS) {
      unsubs.push(api.onSnapshot(api.collection(db, 'users', user.uid, c), { includeMetadataChanges: false }, snap => {
        for (const ch of snap.docChanges()) {
          if (ch.type === 'removed') data[c].delete(ch.doc.id);
          else data[c].set(ch.doc.id, ch.doc.data());
        }
        emit();
      }, err => console.warn('snapshot', c, err)));
    }
    emit();
  });
}
