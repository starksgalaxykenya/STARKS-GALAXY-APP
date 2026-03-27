// ============================================================
// Starks Galaxy Limited – Service Worker
// ============================================================

const CACHE_NAME = 'starks-galaxy-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/signup.html',
  '/dashboard.html',
  '/css/style.css',
  '/css/dashboard.css',
  '/js/app.js',
  '/js/firebase-config.js',
  '/manifest.json',
  '/offline.html'
];

// Install event – cache static assets
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event – clean up old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event – serve from cache, fallback to network, offline fallback
self.addEventListener('fetch', event => {
  // Skip non-GET requests and Firebase/analytics
  if (event.request.method !== 'GET' || 
      event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('firebase') ||
      event.request.url.includes('googleapis.com') ||
      event.request.url.includes('gstatic.com')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // For HTML pages – network first with cache fallback
  if (event.request.headers.get('accept').includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Cache the fresh page
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Fallback to cached version or offline page
          return caches.match(event.request)
            .then(cached => {
              if (cached) return cached;
              return caches.match('/offline.html');
            });
        })
    );
    return;
  }

  // For static assets – cache first with network fallback
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) {
          // Return cached version and update in background
          fetch(event.request)
            .then(networkResponse => {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse);
              });
            })
            .catch(() => {});
          return cached;
        }
        // Not in cache, fetch from network
        return fetch(event.request)
          .then(response => {
            // Cache the new asset
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
            return response;
          });
      })
      .catch(() => {
        // Offline fallback for images
        if (event.request.destination === 'image') {
          return caches.match('/icons/icon-192x192.png');
        }
        return new Response('Offline content not available', {
          status: 404,
          statusText: 'Not Found'
        });
      })
  );
});

// Push notifications (optional)
self.addEventListener('push', event => {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/dashboard.html'
    }
  };
  event.waitUntil(
    self.registration.showNotification(data.title || 'Starks Galaxy', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/dashboard.html';
  event.waitUntil(
    clients.openWindow(url)
  );
});
