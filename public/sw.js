// ScoreSync Service Worker — v6
// Full offline support for scoring page

const CACHE_STATIC = 'scoresync-static-v6';
const CACHE_PAGES  = 'scoresync-pages-v6';
const CACHE_FONTS  = 'scoresync-fonts-v6';

const STATIC_ASSETS = [
  '/tailwind.css',
  '/fa.embedded.css',
  '/fa.min.css',
  '/manifest.json',
  '/scoresync-logo.png',
  '/mansalay-logo.png',
  '/minsu-logo.png',
  '/icon.png',
  '/offlineScores.js',
  '/webfonts/fa-solid-900.woff2',
  '/webfonts/fa-regular-400.woff2',
  '/webfonts/fa-brands-400.woff2',
];

// Install — pre-cache all static assets
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(c => c.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
});

// Activate — remove old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_STATIC && k !== CACHE_PAGES && k !== CACHE_FONTS)
            .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // 1. Google Fonts — cache on first load, serve from cache offline
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(CACHE_FONTS).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 2. Local static assets — cache first
  const isStatic = STATIC_ASSETS.some(s => url.pathname === s)
    || url.pathname.startsWith('/webfonts/');

  if (isStatic) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          if (res.ok) {
            caches.open(CACHE_STATIC).then(c => c.put(e.request, res.clone()));
          }
          return res;
        }).catch(() => new Response('', { status: 503 }))
      )
    );
    return;
  }

  // 3. Scoring page — network first, cache fallback
  //    Also cache ALL CSS/JS loaded by the scoring page
  const isScoringPage = url.pathname.endsWith('/scoring');

  if (isScoringPage) {
    e.respondWith(
      fetch(e.request.clone())
        .then(res => {
          if (res.ok) {
            caches.open(CACHE_PAGES).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then(cached => {
            if (cached) return cached;
            return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Offline — ScoreSync</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#060b18;color:#e2e8f0;font-family:Inter,system-ui,sans-serif;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    min-height:100vh;padding:24px;text-align:center}
  .icon{font-size:4rem;margin-bottom:20px}
  h1{font-size:1.4rem;font-weight:900;color:#f87171;margin-bottom:10px}
  p{color:#64748b;font-size:.875rem;max-width:300px;line-height:1.6;margin-bottom:24px}
  .tip{background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);
    border-radius:12px;padding:14px 16px;font-size:.8rem;color:#fcd34d;
    max-width:300px;text-align:left;margin-bottom:20px}
  .tip strong{display:block;margin-bottom:4px}
  a{color:#6ee7b7;font-weight:700;text-decoration:none;
    padding:10px 24px;border-radius:10px;
    background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3)}
</style>
</head>
<body>
  <div class="icon">📵</div>
  <h1>Scoring Page Not Cached</h1>
  <p>You need to open this scoring page once while online so it gets saved to your device.</p>
  <div class="tip">
    <strong>💡 How to use offline:</strong>
    1. Open the scoring page while connected<br>
    2. Enable Offline Mode using the toggle<br>
    3. Now you can score without internet
  </div>
  <a href="javascript:history.back()">← Go Back</a>
</body>
</html>`, { headers: { 'Content-Type': 'text/html' } });
          })
        )
    );
    return;
  }

  // 4. Tailwind CDN (cdn.tailwindcss.com) — cache it too
  if (url.hostname === 'cdn.tailwindcss.com') {
    e.respondWith(
      caches.open(CACHE_STATIC).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // 5. Everything else — network only (always fresh)
});
