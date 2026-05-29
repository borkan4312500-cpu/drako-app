const CACHE_NAME = 'drako-v1';
const urlsToCache = [
  '/',
  '/customer',
  '/login.html',
  '/driver',
  '/restaurant',
  '/admin',
  '/styles.css',   // لو فيه ملف CSS خارجي منفصل، وإلا تجاهل
  '/socket.io/socket.io.js',
  '/api/restaurants',
  '/api/regions'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
