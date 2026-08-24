const CACHE_VERSION = 'v10.0';
const STATIC_CACHE = `devo-static-${CACHE_VERSION}`;
const IMAGE_CACHE = 'devo-images-v2';

const staticAssets = [
  './',
  './index.html',
  './admin.html',
  './auth.html',
  './src/assets/icons/dv.png',
  './src/assets/icons/pwa-192.jpg',
  './src/assets/icons/pwa-512.jpg',
  './manifest-index.json',
  './manifest-admin.json'
];

// تثبيت وتجهيز السيرفس وركر فوراً
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(staticAssets);
    })
  );
});

// تفعيل وتنظيف النسخ القديمة من الكاش والاستحواذ على العملاء فوراً
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== STATIC_CACHE && key !== IMAGE_CACHE) {
            console.log('[SW] Clearing old cache version:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// استقبال رسالة التخطي الفوري من الصفحة
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// الاستجابة للطلبات: Network-First للمستندات والسكريبتات (لضمان أحدث كود دائماً)، و Cache-First للصور
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. كاش الصور الديناميكي الشامل (Google Drive + Supabase Storage + صور الأصول)
  const isImageRequest = 
    event.request.destination === 'image' ||
    url.hostname.includes('drive.google.com') ||
    url.hostname.includes('googleusercontent.com') ||
    url.hostname.includes('supabase.co') ||
    url.pathname.includes('/storage/v1/object/') ||
    url.pathname.includes('/thumbnail') ||
    /\.(png|jpg|jpeg|webp|svg|gif|ico)(\?.*)?$/i.test(url.pathname);

  if (isImageRequest) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch (err) {
          return cachedResponse || new Response('Image unavailable offline', { status: 404 });
        }
      })
    );
    return;
  }

  // 2. كاش الملفات المحلية والنظام (App Shell & JavaScript Modules): استراتيجية Network-First
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, resClone));
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            return new Response('Network error occurred', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
            });
          });
        })
    );
  }
});