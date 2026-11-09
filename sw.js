/* Lexi's Studio — offline worker. App shell: network first, cache fallback. GitHub API never touched. */
const SHELL = 'studio-shell-v1';
const PRECACHE = ['./', 'index.html', 'style.css', 'app.js', 'program.json', 'foods.json', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname === 'api.github.com') return;
  if (url.origin !== location.origin) {
    // fonts: cache on first sight, serve from cache after
    e.respondWith(caches.open(SHELL).then(async c => {
      const hit = await c.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; } catch (err) { return Response.error(); }
    }));
    return;
  }
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(SHELL).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(h => h || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});
