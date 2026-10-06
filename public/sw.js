// ScoreSync Service Worker — cache static assets only, never HTML or navigation
const CACHE = 'scoresync-v4';
const STATIC = [
  '/tailwind.css',
  '/fa.embedded.css',
  '/manifest.json',
  '/mansalay-logo.png',
  '/scoresync-logo.png',
  '/minsu-logo.png',
  '/icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // ONLY cache GET requests
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // NEVER cache HTML pages, navigation, or any server routes
  // Only cache explicitly listed static assets and webfonts
  const isStaticAsset = STATIC.some(s => url.pathname === s) ||
    url.pathname.startsWith('/webfonts/');

  if (!isStaticAsset) {
    // Always fetch from network — never serve cached HTML
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});
