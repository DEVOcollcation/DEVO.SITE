const CACHE_NAME = 'devo-v5';
const assets = [
  './',
  './index.html',
  './admin.html',
  './warehouse.html',
  './auth.html',
  './src/assets/icons/dv.png',
  './src/assets/icons/pwa-192.jpg',
  './src/assets/icons/pwa-512.jpg',
  './manifest-index.json',
  './manifest-admin.json',
  './manifest-warehouse.json'
];

// تثبيت السيرفس وركر
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    })
  );
});

// تفعيل السيرفس وركر
self.addEventListener('fetch', (event) => {
  // Ignore non-GET requests
  if (event.request.method !== 'GET') return;

  // Ignore external API requests (like Supabase)
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return new Response('Network error occurred', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
        });
      });
    })
  );
});