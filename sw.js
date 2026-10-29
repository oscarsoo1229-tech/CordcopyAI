const CACHE = 'chordlens-harmony-v9-4';
const FILES = ['./index.html','./styles.css','./app.js','./harmony-engine.js','./music-structure.js','./manifest.json'];
self.addEventListener('install', event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES))); });
self.addEventListener('activate', event => event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))])));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin || new URL(event.request.url).pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('./index.html'))); return; }
  event.respondWith(fetch(event.request).then(res => { if (res.ok) { const copy=res.clone(); caches.open(CACHE).then(c => c.put(event.request,copy)); } return res; }).catch(() => caches.match(event.request)));
});
