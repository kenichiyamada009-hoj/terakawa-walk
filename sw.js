const CACHE = 'terakawa-walk-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './assets/terakawa.webp',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Don't cache tile/API requests - always fetch live
  if (url.includes('openstreetmap.org') || url.includes('overpass-api') || url.includes('unpkg.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
