// ScoreSync Service Worker — v5
// Caches static assets + scoring page for offline use

const CACHE_STATIC  = 'scoresync-static-v5';
const CACHE_PAGES   = 'scoresync-pages-v5';

const STATIC_ASSETS = [
  '/tailwind.css',
  '/fa.embedded.css',
  '/manifest.json',
  '/scoresync-logo.png',
  '/mansalay-logo.png',
  '/minsu-logo.png',
  '/icon.png',
  '/offlineScores.js',
];

// ── Install: pre-cache static assets ─────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_STATIC)
      .then(c => c.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

// ── Activate: clear old caches ────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_PAGES)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch handler ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return; // Never cache POSTs

  const url = new URL(e.request.url);

  // 1. Static assets — cache first, fallback to network
  const isStatic = STATIC_ASSETS.some(s => url.pathname === s)
    || url.pathname.startsWith('/webfonts/');

  if (isStatic) {
    e.respondWith(
      caches.match(e.request).then(cached =>
        cached || fetch(e.request).then(res => {
          const clone = res.clone();
          caches.open(CACHE_STATIC).then(c => c.put(e.request, clone));
          return res;
        })
      )
    );
    return;
  }

  // 2. Scoring pages — network first, fallback to cache
  //    Cache: /events/:id/scoring so judges can load it offline
  const isScoringPage = url.pathname.endsWith('/scoring');

  if (isScoringPage) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Cache fresh copy for offline use
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_PAGES).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() =>
          // Offline — serve cached scoring page
          caches.match(e.request).then(cached => {
            if (cached) return cached;
            // No cache yet — return a simple offline page
            return new Response(`
              <!DOCTYPE html>
              <html>
              <head><meta charset="UTF-8"><title>Offline — ScoreSync</title>
              <meta name="viewport" content="width=device-width,initial-scale=1">
              <style>
                body{background:#060b18;color:#e2e8f0;font-family:Inter,sans-serif;
                  display:flex;align-items:center;justify-content:center;
                  min-height:100vh;margin:0;text-align:center;padding:20px}
                h1{font-size:1.5rem;font-weight:900;color:#f87171;margin-bottom:12px}
                p{color:#64748b;font-size:.9rem;max-width:320px;margin:0 auto 20px}
                a{color:#6ee7b7;font-weight:700;text-decoration:none}
              </style></head>
              <body>
                <div>
                  <div style="font-size:3rem;margin-bottom:16px">📵</div>
                  <h1>You're Offline</h1>
                  <p>The scoring page isn't cached yet. Please open it once while online so it's available offline.</p>
                  <a href="/dashboard">← Back to Dashboard</a>
                </div>
              </body></html>
            `, { headers: { 'Content-Type': 'text/html' } });
          })
        )
    );
    return;
  }

  // 3. Everything else — network only, no caching
  // This ensures HTML pages (dashboard, events list, etc.) are always fresh
});
