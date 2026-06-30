const CACHE_NAME = 'devo-v3';
const assets = [
  './',
  './index.html',
  './admin.html',
  './warehouse.html',
  './auth.html',
  './src/assets/icons/dv.png',
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
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});