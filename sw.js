const CACHE_NAME = 'starks-galaxy-v1';
const STATIC_ASSETS = [
  '/STARKS-GALAXY-APP/',
  '/STARKS-GALAXY-APP/index.html',
  '/STARKS-GALAXY-APP/login.html',
  '/STARKS-GALAXY-APP/signup.html',
  '/STARKS-GALAXY-APP/dashboard.html',
  '/STARKS-GALAXY-APP/css/style.css',
  '/STARKS-GALAXY-APP/css/dashboard.css',
  '/STARKS-GALAXY-APP/js/app.js',
  '/STARKS-GALAXY-APP/js/firebase-config.js',
  '/STARKS-GALAXY-APP/manifest.json',
  '/STARKS-GALAXY-APP/offline.html'
];

// Install event
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate event
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event
self.addEventListener('fetch', event => {
  // Skip Firebase requests
  if (event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('firebase') ||
      event.request.url.includes('googleapis.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For HTML pages - network first
  if (event.request.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cached => cached || caches.match('/STARKS-GALAXY-APP/offline.html'));
        })
    );
    return;
  }

  // For static assets - cache first
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // Update in background
          fetch(event.request).then(networkResponse => {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, networkResponse);
            });
          }).catch(() => {});
          return cached;
        }
        return fetch(event.request).then(response => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        });
      })
  );
});
