const CACHE_VERSION = 'v18.4.0';
const STATIC_CACHE = `devo-static-${CACHE_VERSION}`;
const IMAGE_CACHE = 'devo-images-v4';

const staticAssets = [
  './',
  './index.html',
  './admin.html',
  './auth.html',
  './src/css/tailwind.css',
  './src/vendor/phosphor/style.css',
  './src/vendor/phosphor/regular/style.css',
  './src/vendor/phosphor/regular/Phosphor.woff2',
  './src/vendor/phosphor/fill/style.css',
  './src/vendor/phosphor/fill/Phosphor-Fill.woff2',
  './src/vendor/phosphor/bold/style.css',
  './src/vendor/phosphor/bold/Phosphor-Bold.woff2',
  './src/vendor/phosphor/duotone/style.css',
  './src/vendor/phosphor/duotone/Phosphor-Duotone.woff2',
  './src/vendor/phosphor/light/style.css',
  './src/vendor/phosphor/light/Phosphor-Light.woff2',
  './src/vendor/phosphor/thin/style.css',
  './src/vendor/phosphor/thin/Phosphor-Thin.woff2',
  './src/vendor/xlsx/xlsx.full.min.js',
  './src/vendor/html5-qrcode/html5-qrcode.min.js',
  './src/vendor/barcode/JsBarcode.all.min.js',
  './src/vendor/barcode/qrcode.min.js',
  './src/js/services/pwa_updater_logic.js',
  './src/js/services/pwa_updater.js',
  './src/assets/icons/devo-icon.svg',
  './src/assets/icons/dv.png',
  './src/assets/icons/pwa-192x192.png',
  './src/assets/icons/pwa-512x512.png',
  './src/assets/icons/pwa-maskable-192x192.png',
  './src/assets/icons/pwa-maskable-512x512.png',
  './src/assets/icons/apple-touch-icon.png',
  './manifest.json',
  './manifest-index.json',
  './manifest-admin.json'
];

// تثبيت وتجهيز السيرفس وركر وتخزين الأصول الأساسية من الشبكة مباشرة (تجاوز كاش HTTP القديم)
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      await Promise.allSettled(
        staticAssets.map(async (assetUrl) => {
          try {
            const req = new Request(assetUrl, { cache: 'no-cache' });
            const res = await fetch(req);
            if (res && res.ok) {
              await cache.put(assetUrl, res);
            }
          } catch (_) {
            // تجاهل تعذر تخزين ملف واحد حتى لا يتعطل التثبيت بالكامل
          }
        })
      );
    })
  );
});

// تفعيل وتنظيف كافة النسخ القديمة من الكاش فوراً والاستحواذ على العملاء
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== STATIC_CACHE && key !== IMAGE_CACHE) {
              return caches.delete(key);
            }
          })
        )
      )
      .then(() => self.clients.claim())
      .then(async () => {
        const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clientList) {
          client.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION });
        }
      })
  );
});

// استقبال رسائل التحكم الفوري من الصفحات (تخطي الانتظار / تفريغ الكاش / الاستعلام عن النسخة)
self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (data.type === 'GET_SW_VERSION') {
    if (event.ports && event.ports[0]) {
      event.ports[0].postMessage({ version: CACHE_VERSION, staticCache: STATIC_CACHE });
    }
    return;
  }

  if (data.type === 'FORCE_REFRESH_CACHES') {
    event.waitUntil(
      caches.keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith('devo-static-') || k.startsWith('devo-cache-'))
              .map((k) => caches.delete(k))
          )
        )
        .then(() => {
          if (event.ports && event.ports[0]) {
            event.ports[0].postMessage({ cleared: true, version: CACHE_VERSION });
          }
        })
    );
  }
});

// الاستجابة للطلبات
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // ⚠️ تحذير أمني وقاعدي: منع اعتراض أي طلبات لقاعدة بيانات Supabase نهائياً ⚠️
  if (url.hostname.includes('supabase.co')) {
    const isSupabaseStorageImage = url.pathname.includes('/storage/v1/object/');
    if (!isSupabaseStorageImage) {
      return;
    }
  }

  // 0. ملف تتبع الإصدار (version.json): دائماً من الشبكة مباشرة بدون أي تخزين مؤقت
  if (url.origin === self.location.origin && /\/version\.json$/i.test(url.pathname)) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' }).catch(() =>
        new Response(JSON.stringify({ offline: true }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' }
        })
      )
    );
    return;
  }

  // الأيقونات الرسمية والمانيفست الخاصة بالنظام تُعامل كـ App Shell (Network-First) حتى تتحدث فوراً مع كل إصدار
  const isLocalAppIcon =
    url.origin === self.location.origin && url.pathname.includes('/src/assets/icons/');
  const isLocalManifest =
    url.origin === self.location.origin && /\/manifest.*\.json$/i.test(url.pathname);

  // 1. كاش صور المنتجات والوسائط الخارجية فقط (Cache-First)
  const isProductOrExternalImage =
    !isLocalAppIcon &&
    !isLocalManifest &&
    (event.request.destination === 'image' ||
      url.hostname.includes('drive.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.pathname.includes('/storage/v1/object/') ||
      url.pathname.includes('/thumbnail') ||
      /\.(png|jpg|jpeg|webp|svg|gif|ico)(\?.*)?$/i.test(url.pathname));

  if (isProductOrExternalImage) {
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
        } catch (_) {
          return cachedResponse || new Response('Image unavailable offline', { status: 404 });
        }
      })
    );
    return;
  }

  // 2. الملفات المحلية والنظام (HTML / JS / CSS / Manifests / App Icons): استراتيجية Network-First مع إعادة التحقق الفوري
  if (url.origin === self.location.origin) {
    const bypassHttpCache =
      event.request.mode === 'navigate' ||
      isLocalManifest ||
      isLocalAppIcon ||
      /\.(html|js|css|json)(\?.*)?$/i.test(url.pathname);

    const networkFetch = bypassHttpCache
      ? fetch(event.request, { cache: 'no-cache' })
      : fetch(event.request);

    event.respondWith(
      networkFetch
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, resClone));
          }
          return networkResponse;
        })
        .catch(async () => {
          const exactMatch = await caches.match(event.request);
          if (exactMatch) return exactMatch;

          const ignoreSearchMatch = await caches.match(event.request, { ignoreSearch: true });
          if (ignoreSearchMatch) return ignoreSearchMatch;

          if (event.request.mode === 'navigate') {
            const shellPath = url.pathname.includes('admin')
              ? './admin.html'
              : url.pathname.includes('auth')
                ? './auth.html'
                : './index.html';
            const shellMatch = await caches.match(shellPath);
            if (shellMatch) return shellMatch;
          }

          return new Response('Network error occurred', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'Content-Type': 'text/plain; charset=utf-8' })
          });
        })
    );
  }
});