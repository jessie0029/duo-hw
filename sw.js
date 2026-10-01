// PIANO DUO HW service worker: offline app shell + cached data + background push
const VERSION = 'pdhw-v10';
const SHELL = ['./', 'index.html', 'app.css', 'js/app.js', 'js/store.js', 'js/presets.js', 'js/config.js', 'js/captions.js', 'js/caption-rules.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Firestore / auth traffic is handled by the Firebase SDK itself
  if (/googleapis\.com|firebaseio|identitytoolkit|securetoken/.test(url.host)) return;

  // Data files and the app's own code: network first, fall back to cache
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
    return;
  }
  // CDN libraries and fonts: cache first, refresh in background
  if (/gstatic\.com|fontshare\.com|cdnjs\.cloudflare\.com/.test(url.host)) {
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

// Background push from Firebase Cloud Messaging
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {}
  const n = d.notification || d.data || {};
  if (!n.title) return;
  e.waitUntil(self.registration.showNotification(n.title, { body: n.body || '', icon: 'icons/icon-192.png', tag: n.tag || undefined }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(ws => {
    for (const w of ws) if ('focus' in w) return w.focus();
    return self.clients.openWindow('./');
  }));
});
