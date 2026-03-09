const CACHE_NAME = 'devo-v2';
const assets = [
  './',
  './index.html',
  './admin.html',
  './auth.html',
  './src/assets/icons/dv.png',

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
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});