// ============================================================
// Starks Galaxy — Service Worker
// Bump CACHE_VERSION whenever any cached file changes so clients
// pick up the new version instead of serving stale assets forever.
// ============================================================
const CACHE_VERSION = 'v2';
const STATIC_CACHE = `starks-galaxy-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `starks-galaxy-runtime-${CACHE_VERSION}`;

// Everything here must be a real file that exists in the deployed app —
// cache.addAll() fails (and the whole install step aborts) if even one
// of these 404s, which is what silently broke offline support before.
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './signup.html',
  './manifest.json',
  './css/style.css',
  './css/dashboard.css',
  './js/app.js',
  './js/firebase-config.js',
  './js/pwa-install.js',
  './icons/launchericon-48x48.png',
  './icons/launchericon-72x72.png',
  './icons/launchericon-96x96.png',
  './icons/launchericon-144x144.png',
  './icons/launchericon-192x192.png',
  './icons/launchericon-512x512.png',
];

// ─── Install: pre-cache the app shell ─────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .catch((err) => console.warn('[SW] Precache failed:', err))
  );
  // Don't wait for old tabs to close — the "update available" banner in
  // pwa-install.js asks the user before we actually take over (see
  // SKIP_WAITING message handler below), so this is safe.
  self.skipWaiting();
});

// ─── Activate: drop old caches from previous versions ─────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name !== STATIC_CACHE && name !== RUNTIME_CACHE)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

// Lets the page trigger activation of a waiting worker once the user
// accepts the "update available" prompt, instead of forcing a reload.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ─── Fetch strategy ────────────────────────────────────────
// - Firebase/Google API calls: always network (never cache auth/data calls).
// - HTML navigations: network-first, falling back to cache so the app still
//   opens offline; falls back further to the cached dashboard shell.
// - Everything else (css/js/icons/fonts): cache-first, filling the runtime
//   cache in the background so it's instant on the next load.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let Firebase/Google/font requests go straight to network

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
