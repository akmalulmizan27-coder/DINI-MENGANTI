/* Service worker Warung Dini — Develop Program (MIZAN&NORMAN)
   Halaman: network-first (selalu versi terbaru, cadangan cache saat offline).
   Aset statis lokal: stale-while-revalidate. Data Supabase/API: tidak di-cache. */
const CACHE = 'warung-dini-v3';
const SHELL = ['/', '/index.html', '/demo-db.js', '/manifest.json', '/logo.jpg', '/banner-bg.jpg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Supabase, CDN, WA: langsung ke jaringan
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put('/index.html', c)); return r; })
      .catch(() => caches.match('/index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
