// ==========================================
// 🚀 DEVO Offline & IndexedDB Cache Engine 🚀
// Ultra-fast Local Data & Binary Image Store with SWR & Smart Pruning
// ==========================================

const DB_NAME = 'devo_local_v2';
const DB_VERSION = 1;
const STORE_MODELS = 'models';
const STORE_IMAGES = 'images';
const STORE_METADATA = 'metadata';

let dbInstance = null;
let memoryObjectUrls = new Map(); // url -> { objectUrl, blob }
let isPreloading = false;
let preloadQueue = [];

/**
 * Open or upgrade IndexedDB
 */
export function openDevoDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
            console.warn('[OfflineStore] IndexedDB is not supported on this browser.');
            return resolve(null);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // 1. Models Store: Keyed by model ID
            if (!db.objectStoreNames.contains(STORE_MODELS)) {
                const modelStore = db.createObjectStore(STORE_MODELS, { keyPath: 'id' });
                modelStore.createIndex('is_active', 'is_active', { unique: false });
                modelStore.createIndex('created_at', 'created_at', { unique: false });
            }

            // 2. Images Store: Keyed by resolved image URL
            if (!db.objectStoreNames.contains(STORE_IMAGES)) {
                const imageStore = db.createObjectStore(STORE_IMAGES, { keyPath: 'url' });
                imageStore.createIndex('model_id', 'model_id', { unique: false });
                imageStore.createIndex('saved_at', 'saved_at', { unique: false });
            }

            // 3. Metadata Store: Keyed by key name
            if (!db.objectStoreNames.contains(STORE_METADATA)) {
                db.createObjectStore(STORE_METADATA, { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => {
            dbInstance = event.target.result;
            dbInstance.onversionchange = () => {
                dbInstance.close();
                dbInstance = null;
            };
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            console.error('[OfflineStore] Failed to open IndexedDB:', event.target.error);
            resolve(null);
        };
    });
}

// ==========================================
// 📦 1. إدارة الموديلات في IndexedDB (Models Store)
// ==========================================

/**
 * Get all cached models from IndexedDB
 */
export async function getAllCachedModels() {
    const db = await openDevoDB();
    if (!db) return [];

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_MODELS, 'readonly');
            const store = tx.objectStore(STORE_MODELS);
            const request = store.getAll();

            request.onsuccess = () => {
                const models = request.result || [];
                // Sort by created_at descending by default
                models.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
                resolve(models);
            };

            request.onerror = (e) => {
                console.warn('[OfflineStore] Error reading models from IndexedDB:', e);
                resolve([]);
            };
        } catch (e) {
            console.warn('[OfflineStore] Transaction error:', e);
            resolve([]);
        }
    });
}

/**
 * Save all models to IndexedDB in a single atomic bulk transaction
 */
export async function saveAllCachedModels(models) {
    if (!Array.isArray(models)) return;
    const db = await openDevoDB();
    if (!db) return;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction([STORE_MODELS, STORE_METADATA], 'readwrite');
            const modelStore = tx.objectStore(STORE_MODELS);
            const metaStore = tx.objectStore(STORE_METADATA);

            // Clear old records to remove inactive/deleted items
            modelStore.clear();

            models.forEach(model => {
                if (model && model.id) {
                    modelStore.put(model);
                }
            });

            metaStore.put({
                key: 'models_last_sync',
                timestamp: Date.now(),
                count: models.length
            });

            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => {
                console.warn('[OfflineStore] Bulk save error:', e);
                resolve(false);
            };
        } catch (e) {
            console.warn('[OfflineStore] Failed to execute bulk save transaction:', e);
            resolve(false);
        }
    });
}

/**
 * Upsert or update a single model in IndexedDB
 */
export async function putCachedModel(model) {
    if (!model || !model.id) return;
    const db = await openDevoDB();
    if (!db) return;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_MODELS, 'readwrite');
            const store = tx.objectStore(STORE_MODELS);
            store.put(model);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * Delete a model and its cached images from IndexedDB
 */
export async function deleteCachedModel(modelId) {
    if (!modelId) return;
    const db = await openDevoDB();
    if (!db) return;

    // 1. Delete model record
    try {
        const tx = db.transaction(STORE_MODELS, 'readwrite');
        tx.objectStore(STORE_MODELS).delete(modelId);
    } catch (e) {}

    // 2. Remove all cached images belonging to this model
    await removeImagesForModel(modelId);
}

// ==========================================
// 🖼️ 2. إدارة وتخزين الصور محلياً كـ Blobs (Images Store)
// ==========================================

/**
 * Helper to normalize and resolve image URLs
 */
export function resolveImageUrl(url) {
    if (!url || typeof url !== 'string' || url.trim() === "" || url === "null" || url === "undefined") {
        return './src/assets/icons/devo.png';
    }
    const cleanUrl = url.trim();
    try {
        if (cleanUrl.includes('drive.google.com') || cleanUrl.includes('drive.usercontent.google.com')) {
            const idMatch = cleanUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || cleanUrl.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1000`;
        }
    } catch (e) {}
    return cleanUrl;
}

/**
 * Get cached Blob Object URL from Memory or IndexedDB
 * Returns Object URL if cached, or null if not yet cached locally.
 */
export async function getCachedImageObjectUrl(rawUrl) {
    const resolvedUrl = resolveImageUrl(rawUrl);
    if (!resolvedUrl || resolvedUrl.startsWith('data:') || resolvedUrl.startsWith('blob:')) {
        return resolvedUrl;
    }

    // 1. Check in-memory Map for instant 0ms access
    if (memoryObjectUrls.has(resolvedUrl)) {
        return memoryObjectUrls.get(resolvedUrl).objectUrl;
    }

    // 2. Check IndexedDB store
    const db = await openDevoDB();
    if (!db) return null;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_IMAGES, 'readonly');
            const store = tx.objectStore(STORE_IMAGES);
            const request = store.get(resolvedUrl);

            request.onsuccess = () => {
                const record = request.result;
                if (record && record.blob) {
                    try {
                        const objectUrl = URL.createObjectURL(record.blob);
                        memoryObjectUrls.set(resolvedUrl, {
                            objectUrl,
                            blob: record.blob,
                            modelId: record.model_id
                        });
                        resolve(objectUrl);
                    } catch (err) {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            };

            request.onerror = () => resolve(null);
        } catch (e) {
            resolve(null);
        }
    });
}

/**
 * Fetch and store image in Cache API or IndexedDB without CORS errors
 */
export async function cacheImageBlob(rawUrl, modelId = null) {
    const resolvedUrl = resolveImageUrl(rawUrl);
    if (!resolvedUrl || resolvedUrl === './src/assets/icons/devo.png' || resolvedUrl.startsWith('data:') || resolvedUrl.startsWith('blob:')) {
        return resolvedUrl;
    }

    // If already in memory cache, return object URL
    if (memoryObjectUrls.has(resolvedUrl)) {
        return memoryObjectUrls.get(resolvedUrl).objectUrl;
    }

    const isDriveUrl = resolvedUrl.includes('drive.google.com') || resolvedUrl.includes('googleusercontent.com');

    // 1. For Google Drive / opaque cross-origin URLs: cache via Cache Storage API with mode 'no-cors'
    if (isDriveUrl) {
        if ('caches' in window) {
            try {
                const cache = await caches.open('devo-images-v2');
                const cachedMatch = await cache.match(resolvedUrl);
                if (!cachedMatch) {
                    const response = await fetch(resolvedUrl, { mode: 'no-cors', cache: 'force-cache' });
                    if (response) {
                        await cache.put(resolvedUrl, response);
                    }
                }
            } catch (err) {
                // Pre-warm via browser image cache if Cache API fails
                try {
                    const preloadImg = new Image();
                    preloadImg.src = resolvedUrl;
                } catch (e) {}
            }
        }
        return resolvedUrl;
    }

    // 2. For CORS-enabled URLs (Supabase Storage, same-origin, etc.): cache as binary Blobs in IndexedDB
    const db = await openDevoDB();

    try {
        const response = await fetch(resolvedUrl, {
            mode: 'cors',
            cache: 'force-cache'
        });

        if (!response.ok) return resolvedUrl;

        const blob = await response.blob();
        if (!blob || blob.size === 0) return resolvedUrl;

        const objectUrl = URL.createObjectURL(blob);
        memoryObjectUrls.set(resolvedUrl, { objectUrl, blob, modelId });

        // Save to IndexedDB
        if (db) {
            const tx = db.transaction(STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(STORE_IMAGES);
            store.put({
                url: resolvedUrl,
                blob: blob,
                mimeType: blob.type || 'image/jpeg',
                model_id: modelId,
                size: blob.size,
                saved_at: Date.now()
            });
        }

        // Also put in Cache API
        if ('caches' in window) {
            try {
                const cache = await caches.open('devo-images-v2');
                cache.put(resolvedUrl, new Response(blob));
            } catch (e) {}
        }

        return objectUrl;
    } catch (e) {
        // Fallback gracefully without console error
        return resolvedUrl;
    }
}

/**
 * Bind image element to local cache with smooth fallback
 */
export async function bindImageToCache(imgEl, rawUrl, modelId = null) {
    if (!imgEl) return;
    const resolvedUrl = resolveImageUrl(rawUrl);

    // 1. Try instant memory/IDB cache
    const cachedUrl = await getCachedImageObjectUrl(resolvedUrl);
    if (cachedUrl) {
        imgEl.src = cachedUrl;
        return;
    }

    // 2. Set resolved network URL first so it loads immediately
    imgEl.src = resolvedUrl;

    // 3. Cache in background for future instant offline loads
    cacheImageBlob(resolvedUrl, modelId).then(blobUrl => {
        if (blobUrl && blobUrl !== resolvedUrl && imgEl.isConnected && blobUrl.startsWith('blob:')) {
            // Swap smoothly to local Blob Object URL
            imgEl.src = blobUrl;
        }
    }).catch(() => {});
}

// ==========================================
// 🧹 3. التنظيف التلقائي للصور (Smart Cache Pruning)
// ==========================================

/**
 * Remove all cached images belonging to a specific model ID
 */
export async function removeImagesForModel(modelId) {
    if (!modelId) return;

    // 1. Clean from memory map
    for (const [url, entry] of memoryObjectUrls.entries()) {
        if (entry.modelId === modelId) {
            try { URL.revokeObjectURL(entry.objectUrl); } catch (e) {}
            memoryObjectUrls.delete(url);
        }
    }

    // 2. Clean from IndexedDB
    const db = await openDevoDB();
    if (!db) return;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(STORE_IMAGES);
            const index = store.index('model_id');
            const request = index.openCursor(IDBKeyRange.only(modelId));

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve(true);
                }
            };
            request.onerror = () => resolve(false);
        } catch (e) {
            resolve(false);
        }
    });
}

/**
 * Prune all images that do not belong to currently active models or valid URLs
 */
export async function pruneUnusedImages(activeModels) {
    if (!Array.isArray(activeModels) || activeModels.length === 0) return;

    const activeModelIdSet = new Set(activeModels.map(m => m.id));
    const activeUrlSet = new Set();

    activeModels.forEach(m => {
        if (Array.isArray(m.model_images)) {
            m.model_images.forEach(img => {
                if (img && img.image_url) {
                    activeUrlSet.add(resolveImageUrl(img.image_url));
                }
            });
        }
    });

    // 1. Prune memory cache
    for (const [url, entry] of memoryObjectUrls.entries()) {
        if (!activeUrlSet.has(url) || (entry.modelId && !activeModelIdSet.has(entry.modelId))) {
            try { URL.revokeObjectURL(entry.objectUrl); } catch (e) {}
            memoryObjectUrls.delete(url);
        }
    }

    // 2. Prune IndexedDB images store
    const db = await openDevoDB();
    if (!db) return;

    return new Promise((resolve) => {
        try {
            const tx = db.transaction(STORE_IMAGES, 'readwrite');
            const store = tx.objectStore(STORE_IMAGES);
            const request = store.openCursor();
            let deletedCount = 0;

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const record = cursor.value;
                    const isUnusedModel = record.model_id && !activeModelIdSet.has(record.model_id);
                    const isUnusedUrl = !activeUrlSet.has(record.url);

                    if (isUnusedModel || isUnusedUrl) {
                        cursor.delete();
                        deletedCount++;
                    }
                    cursor.continue();
                } else {
                    if (deletedCount > 0) {
                        console.log(`[OfflineStore] Pruned ${deletedCount} unused/deactivated model images to free disk space.`);
                    }
                    resolve(deletedCount);
                }
            };
            request.onerror = () => resolve(0);
        } catch (e) {
            resolve(0);
        }
    });
}

// ==========================================
// ⚡ 4. طابور التنزيل الخلفي الذكي للصور (Background Preloading Queue)
// ==========================================

/**
 * Preload and cache images for all active models in background
 */
export function preloadModelImages(models) {
    if (!Array.isArray(models) || models.length === 0) return;

    // Collect all image URLs needed
    const tasks = [];
    models.forEach(model => {
        if (Array.isArray(model.model_images)) {
            model.model_images.forEach(img => {
                if (img && img.image_url) {
                    const resolved = resolveImageUrl(img.image_url);
                    if (resolved && !memoryObjectUrls.has(resolved)) {
                        tasks.push({ url: resolved, modelId: model.id });
                    }
                }
            });
        }
    });

    preloadQueue = tasks;
    if (!isPreloading && preloadQueue.length > 0) {
        processPreloadQueue();
    }
}

async function processPreloadQueue() {
    if (preloadQueue.length === 0) {
        isPreloading = false;
        return;
    }

    isPreloading = true;

    // Process in small batches of 3 images using requestIdleCallback or setTimeout
    const batch = preloadQueue.splice(0, 3);

    await Promise.all(batch.map(item => {
        return cacheImageBlob(item.url, item.modelId).catch(() => null);
    }));

    if (preloadQueue.length > 0) {
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(() => processPreloadQueue(), { timeout: 1000 });
        } else {
            setTimeout(processPreloadQueue, 150);
        }
    } else {
        isPreloading = false;
    }
}
