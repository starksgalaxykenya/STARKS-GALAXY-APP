const CACHE_NAME = 'starks-galaxy-cache-v1';

// List all the files from your exact folder structure
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './dashboard.html',
  './signup.html',
  './CSS/style.css',
  './CSS/dashboard.css',
  './JS/app.js',
  './JS/signup.js',
  './ICONS/launchericon-192x192.png',
  './ICONS/launchericon-512x512.png'
];

// Install Event - Caches the files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(ASSETS_TO_CACHE);
      })
  );
});

// Activate Event - Cleans up old caches if you update the app
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch Event - Serves files from cache when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached file if found, otherwise fetch from the network
        return response || fetch(event.request);
      })
  );
});
