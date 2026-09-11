import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { resolveImageUrl } from '../../services/offline_store.js';
import { confirmDialog } from '../../components/modal.js';

// ==============================================================================
// State Variables
// ==============================================================================
let isInitialized = false;
let allModelsCache = [];
let scannedModelsData = []; // Array of processed models with matched info and images
let selectedModelCodes = new Set();
let activeFilter = 'all'; // 'all' | 'ready' | 'existing' | 'not_found'
let searchQuery = '';
let gDriveSettings = {
    apiKey: '',
    lastFolderUrl: '',
    lastSync: null
};
let activeZoomImages = [];
let activeZoomIndex = 0;
let activeZoomModelCode = '';
let lastExtractedMap = null;

// ==============================================================================
// Initialization
// ==============================================================================
export async function initImportImagesView() {
    setupWindowBindings();
    await loadDriveSettings();
    await loadAllModels();
    renderLastSyncSummary();

    if (!isInitialized) {
        attachEventListeners();
        isInitialized = true;
    }
}

function setupWindowBindings() {
    window.openDriveSettingsModal = openDriveSettingsModal;
    window.closeDriveSettingsModal = closeDriveSettingsModal;
    window.saveDriveSettings = saveDriveSettings;
    window.scanGoogleDriveFolder = scanGoogleDriveFolder;
    window.toggleSelectAllImportImages = toggleSelectAllImportImages;
    window.toggleSingleImportImageModel = toggleSingleImportImageModel;
    window.openImageConflictModal = openImageConflictModal;
    window.closeImageConflictModal = closeImageConflictModal;
    window.executeImageImport = executeImageImport;
    window.openImageZoomModal = openImageZoomModal;
    window.closeImageZoomModal = closeImageZoomModal;
    window.prevZoomImage = prevZoomImage;
    window.nextZoomImage = nextZoomImage;
    window.goToZoomIndex = goToZoomIndex;
    window.openFullscreenWorkspace = openFullscreenWorkspace;
    window.closeFullscreenWorkspace = closeFullscreenWorkspace;
    window.selectOnlyNewModels = selectOnlyNewModels;
    window.filterImportImagesView = filterImportImagesView;
    window.openPurgeModal = openPurgeModal;
    window.closePurgeModal = closePurgeModal;
    window.updatePurgePreviewStats = updatePurgePreviewStats;
    window.executeImagePurge = executeImagePurge;
}

function attachEventListeners() {
    const searchInput = document.getElementById('gdrive-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            const fsSearch = document.getElementById('gdrive-fs-search-input');
            if (fsSearch && fsSearch.value !== e.target.value) fsSearch.value = e.target.value;
            renderPreviewTable();
        });
    }

    const fsSearchInput = document.getElementById('gdrive-fs-search-input');
    if (fsSearchInput) {
        fsSearchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim().toLowerCase();
            const regularSearch = document.getElementById('gdrive-search-input');
            if (regularSearch && regularSearch.value !== e.target.value) regularSearch.value = e.target.value;
            renderPreviewTable();
        });
    }

    const folderInput = document.getElementById('gdrive-folder-url');
    if (folderInput) {
        folderInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                scanGoogleDriveFolder();
            }
        });
    }

    // Keyboard navigation for image carousel (ArrowLeft, ArrowRight, Escape)
    window.addEventListener('keydown', (e) => {
        const zoomModal = document.getElementById('gdrive-zoom-modal');
        if (zoomModal && !zoomModal.classList.contains('hidden')) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                prevZoomImage();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                nextZoomImage();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeImageZoomModal();
            }
        }
    });
}

// ==============================================================================
// Settings Management (home_settings)
// ==============================================================================
async function loadDriveSettings() {
    try {
        const { data, error } = await supabase
            .from('home_settings')
            .select('setting_key, setting_value')
            .in('setting_key', ['gdrive_api_key', 'gdrive_last_folder_url', 'gdrive_image_last_sync']);

        if (!error && data) {
            data.forEach(item => {
                if (item.setting_key === 'gdrive_api_key') gDriveSettings.apiKey = item.setting_value || '';
                if (item.setting_key === 'gdrive_last_folder_url') gDriveSettings.lastFolderUrl = item.setting_value || '';
                if (item.setting_key === 'gdrive_image_last_sync') {
                    try {
                        gDriveSettings.lastSync = item.setting_value ? JSON.parse(item.setting_value) : null;
                    } catch (e) {
                        gDriveSettings.lastSync = null;
                    }
                }
            });
        }

        // Apply to UI fields
        const folderInput = document.getElementById('gdrive-folder-url');
        if (folderInput && gDriveSettings.lastFolderUrl) {
            folderInput.value = gDriveSettings.lastFolderUrl;
        }

        const apiKeyInput = document.getElementById('gdrive-api-key-input');
        if (apiKeyInput && gDriveSettings.apiKey) {
            apiKeyInput.value = gDriveSettings.apiKey;
        }

        updateApiKeyBadge();
    } catch (e) {
        console.warn('Error loading drive settings:', e);
    }
}

function updateApiKeyBadge() {
    const badge = document.getElementById('gdrive-api-key-status-badge');
    if (badge) {
        if (gDriveSettings.apiKey && gDriveSettings.apiKey.trim().length > 10) {
            badge.innerHTML = `<i class="ph ph-check-circle text-devo-success"></i> <span class="text-devo-success">مفتاح API مضبوط</span>`;
            badge.className = 'text-xs px-2.5 py-1 rounded-full bg-devo-success/10 border border-devo-success/30 flex items-center gap-1.5';
        } else {
            badge.innerHTML = `<i class="ph ph-warning-circle text-devo-warning"></i> <span class="text-devo-warning">مطلوب ضبط مفتاح Google API</span>`;
            badge.className = 'text-xs px-2.5 py-1 rounded-full bg-devo-warning/10 border border-devo-warning/30 flex items-center gap-1.5';
        }
    }
}

function openDriveSettingsModal() {
    const modal = document.getElementById('gdrive-settings-modal');
    const apiKeyInput = document.getElementById('gdrive-api-key-input');
    if (apiKeyInput) apiKeyInput.value = gDriveSettings.apiKey || '';
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
}

function closeDriveSettingsModal() {
    const modal = document.getElementById('gdrive-settings-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

async function saveDriveSettings() {
    const apiKeyInput = document.getElementById('gdrive-api-key-input');
    const newKey = apiKeyInput ? apiKeyInput.value.trim() : '';

    try {
        const { error } = await supabase
            .from('home_settings')
            .upsert([
                { setting_key: 'gdrive_api_key', setting_value: newKey }
            ], { onConflict: 'setting_key' });

        if (error) throw error;

        gDriveSettings.apiKey = newKey;
        updateApiKeyBadge();
        showToast('تم حفظ مفتاح Google Drive API بنجاح', 'success');
        closeDriveSettingsModal();
    } catch (err) {
        showToast(`فشل حفظ المفتاح: ${err.message}`, 'error');
    }
}

// ==============================================================================
// Models Cache
// ==============================================================================
async function loadAllModels() {
    try {
        const { data, error } = await supabase
            .from('models')
            .select(`
                id,
                system_code,
                factory_code,
                name,
                category_id,
                categories(id, name),
                model_images(id, image_url, sort_order, is_cover)
            `);

        if (error) throw error;
        allModelsCache = data || [];
    } catch (err) {
        console.error('Error fetching models for Drive importer:', err);
    }
}

// ==============================================================================
// Google Drive Folder Scanner & Parsing Logic
// ==============================================================================
function extractDriveFolderId(input) {
    if (!input) return null;
    const clean = input.trim();
    // Matches: https://drive.google.com/drive/folders/xxxx or drive.google.com/drive/u/0/folders/xxxx
    const match = clean.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) return match[1];
    // If it is just the raw ID (alphanumeric, underscores, hyphens, usually 25+ chars)
    if (/^[a-zA-Z0-9_-]{20,}$/.test(clean)) return clean;
    return null;
}

export async function scanGoogleDriveFolder() {
    const folderInput = document.getElementById('gdrive-folder-url');
    const rawUrl = folderInput ? folderInput.value.trim() : '';

    if (!rawUrl) {
        showToast('يرجى إدخال رابط أو معرف مجلد Google Drive أولاً', 'warning');
        return;
    }

    const folderId = extractDriveFolderId(rawUrl);
    if (!folderId) {
        showToast('رابط المجلد غير صالح. يرجى نسخ الرابط كاملاً من شريط متصفح Google Drive', 'error');
        return;
    }

    if (!gDriveSettings.apiKey) {
        showToast('يرجى ضبط مفتاح Google Drive API أولاً من زر الإعدادات ⚙️', 'warning');
        openDriveSettingsModal();
        return;
    }

    // Save last used folder URL in database for convenience
    supabase
        .from('home_settings')
        .upsert([{ setting_key: 'gdrive_last_folder_url', setting_value: rawUrl }], { onConflict: 'setting_key' })
        .then(() => { gDriveSettings.lastFolderUrl = rawUrl; });

    const btnScan = document.getElementById('btn-scan-drive');
    const originalBtnHtml = btnScan ? btnScan.innerHTML : '';

    // Automatically open the dedicated Fullscreen Studio workspace upon scan/extraction
    openFullscreenWorkspace();
    setScanningProgress(true, 'جاري فحص المجلد واستخراج محتويات Google Drive...', 10);

    try {
        if (btnScan) {
            btnScan.disabled = true;
            btnScan.innerHTML = `<i class="ph ph-spinner animate-spin text-lg"></i> جاري الفحص...`;
        }

        // Refresh models cache before scanning to guarantee up-to-date matches
        await loadAllModels();

        // 1. Fetch top-level items in the folder via Google Drive API v3
        setScanningProgress(true, 'جاري قراءة محتويات المجلد الرئيسي...', 25);
        const topLevelItems = await fetchDriveFolderFiles(folderId, gDriveSettings.apiKey);

        if (!topLevelItems || topLevelItems.length === 0) {
            throw new Error('لم يتم العثور على أي ملفات أو مجلدات داخل هذا المجلد. تأكد من إعداد المشاركة: "أي شخص لديه الرابط يمكنه العرض"');
        }

        // 2. Separate into folders and direct image files
        const subfolders = topLevelItems.filter(item => item.mimeType === 'application/vnd.google-apps.folder');
        const directImages = topLevelItems.filter(item => item.mimeType && item.mimeType.startsWith('image/'));

        setScanningProgress(true, `تم العثور على ${subfolders.length} مجلد فرعي و ${directImages.length} صورة مباشرة. جاري التحليل...`, 50);

        // Raw collection of images grouped by extracted model code
        // Structure: Map<rawModelCode, Array<{ id, name, sortOrder, thumbnailUrl }>>
        const extractedMap = new Map();

        // Helper to register an image to a model code with deduplication (by drive file ID or URL)
        function addImageToCode(modelCode, imageItem) {
            if (!modelCode || !imageItem) return;
            const normalizedCode = String(modelCode).trim();
            if (!extractedMap.has(normalizedCode)) {
                extractedMap.set(normalizedCode, []);
            }
            const existingList = extractedMap.get(normalizedCode);
            // Deduplicate: check if this file ID or thumbnail URL is already added for this model
            const isDuplicate = existingList.some(img => 
                (img.id && imageItem.id && String(img.id).trim() === String(imageItem.id).trim()) ||
                (img.thumbnailUrl && imageItem.thumbnailUrl && String(img.thumbnailUrl).trim() === String(imageItem.thumbnailUrl).trim())
            );
            if (!isDuplicate) {
                existingList.push(imageItem);
            }
        }

        // Case A: Process direct image files in root folder
        directImages.forEach(img => {
            const parsed = parseImageFilename(img.name);
            if (parsed && parsed.modelCode) {
                addImageToCode(parsed.modelCode, {
                    id: img.id,
                    name: img.name,
                    sortOrder: parsed.sortOrder,
                    thumbnailUrl: `https://drive.google.com/thumbnail?id=${img.id}&sz=w1000`
                });
            }
        });

        // Case B: Process subfolders (each folder named after model code)
        if (subfolders.length > 0) {
            let processedFolders = 0;
            for (const folder of subfolders) {
                processedFolders++;
                const folderPercent = 50 + Math.round((processedFolders / subfolders.length) * 35);
                setScanningProgress(true, `فحص المجلد الفرعي (${processedFolders}/${subfolders.length}): ${folder.name}`, folderPercent);

                const folderFiles = await fetchDriveFolderFiles(folder.id, gDriveSettings.apiKey);
                const folderImages = folderFiles.filter(item => item.mimeType && item.mimeType.startsWith('image/'));

                // Clean folder name to extract model code (e.g., "1520" or "Model 1520")
                const folderModelCode = cleanFolderModelCode(folder.name);

                folderImages.forEach(img => {
                    const parsed = parseImageFilename(img.name);
                    const sortOrder = parsed?.sortOrder || extractNumberFromString(img.name) || 999;
                    addImageToCode(folderModelCode, {
                        id: img.id,
                        name: img.name,
                        sortOrder: sortOrder,
                        thumbnailUrl: `https://drive.google.com/thumbnail?id=${img.id}&sz=w1000`
                    });
                });
            }
        }

        setScanningProgress(true, 'مطابقة الأكواد مع قاعدة بيانات DEVO...', 90);

        // 3. Match extracted codes with models in Supabase
        lastExtractedMap = extractedMap;
        scannedModelsData = matchExtractedWithDatabase(extractedMap, allModelsCache);

        // 4. Default selection: select all "ready" and "existing" models
        selectedModelCodes.clear();
        scannedModelsData.forEach(item => {
            if (item.status === 'ready' || item.status === 'existing') {
                selectedModelCodes.add(item.modelCode);
            }
        });

        setScanningProgress(false);
        renderPreviewStats();
        renderPreviewTable();

        showToast(`اكتمل الفحص! تم التعرف على ${scannedModelsData.length} موديل إجمالاً.`, 'success');

        // Reveal inline preview section as well
        const previewSection = document.getElementById('gdrive-preview-section');
        if (previewSection) {
            previewSection.classList.remove('hidden');
        }

    } catch (err) {
        console.error('Drive scan error:', err);
        setScanningProgress(false);
        showToast(err.message || 'حدث خطأ أثناء فحص Google Drive', 'error');
    } finally {
        if (btnScan) {
            btnScan.disabled = false;
            btnScan.innerHTML = originalBtnHtml;
        }
    }
}

// ==============================================================================
// Google Drive API Fetcher
// ==============================================================================
async function fetchDriveFolderFiles(folderId, apiKey) {
    let allFiles = [];
    let pageToken = null;

    do {
        let url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${folderId}' in parents and trashed = false`)}&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000&key=${apiKey}`;
        if (pageToken) {
            url += `&pageToken=${pageToken}`;
        }

        const res = await fetch(url);
        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            const msg = errJson?.error?.message || `HTTP ${res.status}`;
            if (res.status === 403 || res.status === 401) {
                throw new Error(`خطأ في صلاحيات Google API (${msg}). تأكد من صحة المفتاح وتفعيل "Google Drive API" في Google Cloud Console، وأن المجلد مفتوح للمشاركة.`);
            }
            if (res.status === 404) {
                throw new Error('لم يتم العثور على المجلد في Google Drive. تأكد من الرابط وصلاحيات الوصول.');
            }
            throw new Error(`خطأ من Google Drive API: ${msg}`);
        }

        const data = await res.json();
        if (data.files) {
            allFiles = allFiles.concat(data.files);
        }
        pageToken = data.nextPageToken || null;
    } while (pageToken);

    return allFiles;
}

// ==============================================================================
// Smart Parsing Utilities
// ==============================================================================
/**
 * Extracts model code and sort order from file name.
 * Supported patterns:
 * - 1001.jpg -> code: 1001, order: 1 (Plain factory code without any numbering suffix)
 * - 1001_1.jpg or 1001-1.jpg or 1001.1.jpg or 1001 (1).jpg -> code: 1001, order: 1
 * - 1001_2.jpg or 1001-2.jpg or 1001.2.jpg or 1001 (2).jpg -> code: 1001, order: 2
 * - 1001_cover.jpg or 1001-cover.jpg or 1001_main.jpg -> code: 1001, order: 0
 */
function parseImageFilename(filename) {
    if (!filename) return null;
    const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
    const clean = nameWithoutExt.trim();

    // 1. Pattern: code_order or code-order or code.order or code (order)
    // Matches suffix after _, -, space, or dot when followed by digits or keywords
    const matchSuffix = clean.match(/^(.+?)[_ \-–—.]+(\d+|\bcover\b|\bfront\b|\bback\b|\bthumb\b|\bmain\b)$/i) ||
                        clean.match(/^(.+?)\s*\(([0-9]+)\)$/);

    if (matchSuffix) {
        const rawCode = matchSuffix[1].trim();
        const suffix = matchSuffix[2].toLowerCase().trim();
        let order = 1;
        if (suffix === 'cover' || suffix === 'main' || suffix === 'front') {
            order = 0; // Highest priority for cover
        } else {
            order = parseInt(suffix, 10) || 1;
        }
        return { modelCode: rawCode, sortOrder: order };
    }

    // 2. Plain factory code without any order suffix (e.g. 1001.jpg, M1520.png)
    return { modelCode: clean, sortOrder: 1 };
}

function cleanFolderModelCode(folderName) {
    if (!folderName) return '';
    let name = folderName.trim();
    // Remove prefixes like "Model", "موديل", "كود", "مصنع"
    name = name.replace(/^(موديل|كود|مصنع|كود مصنع|model|code|factory)[ \-_:]+/i, '');
    return name.trim();
}

function extractNumberFromString(str) {
    if (!str) return null;
    const m = str.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
}

// ==============================================================================
// Model Matching with Database (STRICTLY factory_code ONLY)
// ==============================================================================
function matchExtractedWithDatabase(extractedMap, dbModels) {
    // Build quick lookup dictionary strictly for factory_code
    const factoryCodeMap = new Map();

    dbModels.forEach(m => {
        if (m.factory_code) {
            factoryCodeMap.set(String(m.factory_code).trim().toLowerCase(), m);
        }
    });

    const results = [];

    extractedMap.forEach((images, modelCode) => {
        // Sort images: lowest sortOrder first, then naturally by filename
        images.sort((a, b) => {
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.name.localeCompare(b.name, undefined, { numeric: true });
        });

        // Set isCover for the first image
        images.forEach((img, idx) => {
            img.isCover = idx === 0;
            img.finalSortOrder = idx + 1;
        });

        const normalizedSearch = modelCode.trim().toLowerCase();

        // Match strictly by factory_code ONLY
        const matchedModel = factoryCodeMap.get(normalizedSearch);

        let status = 'not_found';
        let existingImagesCount = 0;

        if (matchedModel) {
            existingImagesCount = (matchedModel.model_images && matchedModel.model_images.length) || 0;
            status = existingImagesCount > 0 ? 'existing' : 'ready';
        }

        results.push({
            modelCode: modelCode,
            matchedModel: matchedModel || null,
            status: status, // 'ready' | 'existing' | 'not_found'
            existingImagesCount: existingImagesCount,
            images: images
        });
    });

    // Sort results: 'ready' first, then 'existing', then 'not_found'
    const statusPriority = { ready: 1, existing: 2, not_found: 3 };
    results.sort((a, b) => {
        if (statusPriority[a.status] !== statusPriority[b.status]) {
            return statusPriority[a.status] - statusPriority[b.status];
        }
        return a.modelCode.localeCompare(b.modelCode, undefined, { numeric: true });
    });

    return results;
}

// ==============================================================================
// UI Rendering - Stats & Table
// ==============================================================================
function setScanningProgress(active, message = '', percent = 0) {
    // 1. Inline Progress
    const barContainer = document.getElementById('gdrive-scan-progress-container');
    const bar = document.getElementById('gdrive-scan-progress-bar');
    const msg = document.getElementById('gdrive-scan-progress-text');

    if (barContainer) {
        if (active) {
            barContainer.classList.remove('hidden');
            if (bar) bar.style.width = `${percent}%`;
            if (msg) msg.textContent = message;
        } else {
            barContainer.classList.add('hidden');
        }
    }

    // 2. Fullscreen Studio Progress
    const fsContainer = document.getElementById('gdrive-fs-progress-container');
    const fsBar = document.getElementById('gdrive-fs-progress-bar');
    const fsMsg = document.getElementById('gdrive-fs-progress-text');

    if (fsContainer) {
        if (active) {
            fsContainer.classList.remove('hidden');
            if (fsBar) fsBar.style.width = `${percent}%`;
            if (fsMsg) fsMsg.innerHTML = `<i class="ph ph-spinner animate-spin text-devo-orange"></i> ${message}`;
        } else {
            fsContainer.classList.add('hidden');
        }
    }
}

function renderPreviewStats() {
    const totalModels = scannedModelsData.length;
    let readyCount = 0;
    let existingCount = 0;
    let notFoundCount = 0;
    let totalImages = 0;

    scannedModelsData.forEach(item => {
        totalImages += item.images.length;
        if (item.status === 'ready') readyCount++;
        else if (item.status === 'existing') existingCount++;
        else if (item.status === 'not_found') notFoundCount++;
    });

    // 1. Inline Stats Badges
    const statTotal = document.getElementById('gdrive-stat-total-models');
    const statReady = document.getElementById('gdrive-stat-ready-models');
    const statExisting = document.getElementById('gdrive-stat-existing-models');
    const statNotFound = document.getElementById('gdrive-stat-not-found-models');
    const statImages = document.getElementById('gdrive-stat-total-images');

    if (statTotal) statTotal.textContent = totalModels;
    if (statReady) statReady.textContent = readyCount;
    if (statExisting) statExisting.textContent = existingCount;
    if (statNotFound) statNotFound.textContent = notFoundCount;
    if (statImages) statImages.textContent = totalImages;

    // 2. Fullscreen Studio Stats Badges
    const fsStatTotal = document.getElementById('gdrive-fs-stat-total');
    const fsStatReady = document.getElementById('gdrive-fs-stat-ready');
    const fsStatExisting = document.getElementById('gdrive-fs-stat-existing');
    const fsStatNotFound = document.getElementById('gdrive-fs-stat-not-found');
    const fsStatImages = document.getElementById('gdrive-fs-stat-images');

    if (fsStatTotal) fsStatTotal.textContent = totalModels;
    if (fsStatReady) fsStatReady.textContent = readyCount;
    if (fsStatExisting) fsStatExisting.textContent = existingCount;
    if (fsStatNotFound) fsStatNotFound.textContent = notFoundCount;
    if (fsStatImages) fsStatImages.textContent = totalImages;
}

function filterImportImagesView(filterType) {
    activeFilter = filterType;

    // Update active tab buttons styling for both inline and fullscreen studio
    document.querySelectorAll('.gdrive-filter-btn').forEach(btn => {
        if (btn.dataset.filter === filterType) {
            btn.className = 'gdrive-filter-btn px-4 py-1.5 sm:py-2 rounded-xl text-xs font-bold transition-all bg-devo-orange text-white shadow-lg shadow-devo-orange/20';
        } else {
            btn.className = 'gdrive-filter-btn px-4 py-1.5 sm:py-2 rounded-xl text-xs font-medium transition-all bg-devo-dark text-devo-muted hover:text-white border border-devo-gray hover:border-devo-orange/50';
        }
    });

    renderPreviewTable();
}

function getFilteredData() {
    return scannedModelsData.filter(item => {
        // Status filter
        if (activeFilter === 'ready' && item.status !== 'ready') return false;
        if (activeFilter === 'existing' && item.status !== 'existing') return false;
        if (activeFilter === 'not_found' && item.status !== 'not_found') return false;

        // Search query filter
        if (searchQuery) {
            const codeMatches = item.modelCode.toLowerCase().includes(searchQuery);
            const nameMatches = item.matchedModel?.name?.toLowerCase().includes(searchQuery);
            const sysCodeMatches = item.matchedModel?.system_code?.toLowerCase().includes(searchQuery);
            const factoryMatches = item.matchedModel?.factory_code?.toLowerCase().includes(searchQuery);
            if (!codeMatches && !nameMatches && !sysCodeMatches && !factoryMatches) return false;
        }

        return true;
    });
}

function renderPreviewTable() {
    const tbody = document.getElementById('gdrive-preview-tbody');
    const fsTbody = document.getElementById('gdrive-fs-preview-tbody');

    const selectAllCheckbox = document.getElementById('gdrive-select-all');
    const fsSelectAllCheckbox = document.getElementById('gdrive-fs-select-all');

    const btnExecute = document.getElementById('btn-import-images-execute');
    const fsBtnExecute = document.getElementById('btn-fs-import-execute');

    const selectedCounter = document.getElementById('gdrive-selected-counter');
    const fsSelectedCounter = document.getElementById('gdrive-fs-selected-counter');

    const filtered = getFilteredData();
    const selectableItems = filtered.filter(i => i.status !== 'not_found');
    const allChecked = selectableItems.length > 0 && selectableItems.every(i => selectedModelCodes.has(i.modelCode));
    const isIndeterminate = selectableItems.some(i => selectedModelCodes.has(i.modelCode)) && !allChecked;

    // Sync select-all checkboxes
    [selectAllCheckbox, fsSelectAllCheckbox].forEach(cb => {
        if (cb) {
            cb.checked = allChecked;
            cb.indeterminate = isIndeterminate;
        }
    });

    // Update selected counters & execute buttons
    const selectedCount = selectedModelCodes.size;
    [selectedCounter, fsSelectedCounter].forEach(el => {
        if (el) el.textContent = `${selectedCount} موديل محدد`;
    });

    [btnExecute, fsBtnExecute].forEach(btn => {
        if (btn) {
            btn.disabled = selectedCount === 0;
            if (selectedCount === 0) {
                btn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                btn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
    });

    if (filtered.length === 0) {
        const emptyHtml = `
            <tr>
                <td colspan="6" class="py-12 text-center text-devo-muted">
                    <i class="ph ph-magnifying-glass text-4xl mb-2 text-devo-gray"></i>
                    <p class="text-sm">لا توجد نتائج تطابق خيارات التصفية أو البحث الحالية</p>
                </td>
            </tr>
        `;
        if (tbody) tbody.innerHTML = emptyHtml;
        if (fsTbody) fsTbody.innerHTML = emptyHtml;
        return;
    }

    const rowsHtml = filtered.map(item => {
        const isSelected = selectedModelCodes.has(item.modelCode);
        const isNotFound = item.status === 'not_found';

        let statusBadge = '';
        if (item.status === 'ready') {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-devo-success/10 text-devo-success border border-devo-success/30"><i class="ph ph-check-circle"></i> جديد وجاهز للربط</span>`;
        } else if (item.status === 'existing') {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30"><i class="ph ph-image"></i> لديه ${item.existingImagesCount} صور سابقة</span>`;
        } else {
            statusBadge = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-devo-error/10 text-devo-error border border-devo-error/30"><i class="ph ph-x-circle"></i> غير مسجل بالنظام</span>`;
        }

        const modelName = item.matchedModel ? item.matchedModel.name : '<span class="text-devo-muted italic">--</span>';
        const categoryName = item.matchedModel?.categories?.name ? item.matchedModel.categories.name : '';

        // Generate Thumbnails Preview HTML with Carousel Zoom Click
        const thumbsHtml = item.images.map((img, idx) => `
            <div class="relative group cursor-pointer shrink-0" onclick="openImageZoomModal('${item.modelCode}', ${idx})" title="انقر لتكبير واستعراض الصورة">
                <img src="${img.thumbnailUrl}" 
                     class="w-12 h-12 rounded-lg object-cover border ${img.isCover ? 'border-devo-orange ring-1 ring-devo-orange/50' : 'border-devo-gray'} bg-devo-black transition-transform group-hover:scale-105" 
                     onerror="this.src='./src/assets/icons/devo.png'" 
                     loading="lazy">
                ${img.isCover ? `
                    <span class="absolute -top-1.5 -right-1.5 bg-devo-orange text-white text-[9px] font-bold px-1 rounded shadow">غلاف</span>
                ` : `
                    <span class="absolute -bottom-1 -left-1 bg-devo-black/80 text-white text-[9px] px-1 rounded border border-devo-gray">#${idx + 1}</span>
                `}
            </div>
        `).join('');

        return `
            <tr class="border-b border-devo-gray/50 hover:bg-white/[0.02] transition-colors ${isSelected ? 'bg-devo-orange/[0.03]' : ''}" style="background-color: var(--devo-black, #0a0a0a);">
                <td class="py-3 px-4 text-center" style="background-color: var(--devo-black, #0a0a0a);">
                    <input type="checkbox" 
                           ${isNotFound ? 'disabled' : ''} 
                           ${isSelected ? 'checked' : ''} 
                           onchange="toggleSingleImportImageModel('${item.modelCode}', this.checked)"
                           class="rounded bg-devo-black border-devo-gray text-devo-orange focus:ring-devo-orange focus:ring-offset-devo-black cursor-pointer ${isNotFound ? 'opacity-30 cursor-not-allowed' : ''}">
                </td>
                <td class="py-3 px-4">
                    <div class="font-bold text-white text-sm font-mono flex items-center gap-2">
                        <i class="ph ph-tag text-devo-orange text-base"></i>
                        <span>${item.modelCode}</span>
                    </div>
                    <span class="text-[10px] text-devo-muted">كود المصنع المستخرج</span>
                </td>
                <td class="py-3 px-4">
                    <div class="text-white text-xs font-bold">${modelName}</div>
                    <div class="flex items-center gap-2 mt-1">
                        ${categoryName ? `<span class="text-[11px] text-devo-orange/90 bg-devo-orange/10 px-2 py-0.5 rounded font-medium">${categoryName}</span>` : ''}
                        ${item.matchedModel?.factory_code ? `<span class="text-[11px] text-devo-muted font-mono">كود المصنع: <strong class="text-white">${item.matchedModel.factory_code}</strong></span>` : ''}
                    </div>
                </td>
                <td class="py-3 px-4 text-center">
                    ${statusBadge}
                </td>
                <td class="py-3 px-4 text-center">
                    <span class="font-bold text-white text-sm bg-devo-dark px-2.5 py-1 rounded-lg border border-devo-gray">${item.images.length}</span>
                </td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2 overflow-x-auto custom-scrollbar py-1 max-w-[280px]">
                        ${thumbsHtml}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    if (tbody) tbody.innerHTML = rowsHtml;
    if (fsTbody) fsTbody.innerHTML = rowsHtml;
}

function toggleSelectAllImportImages(checked) {
    const filtered = getFilteredData();
    filtered.forEach(item => {
        if (item.status !== 'not_found') {
            if (checked) {
                selectedModelCodes.add(item.modelCode);
            } else {
                selectedModelCodes.delete(item.modelCode);
            }
        }
    });
    renderPreviewTable();
}

function toggleSingleImportImageModel(modelCode, isChecked) {
    if (isChecked) {
        selectedModelCodes.add(modelCode);
    } else {
        selectedModelCodes.delete(modelCode);
    }
    renderPreviewTable();
}

function selectOnlyNewModels() {
    selectedModelCodes.clear();
    scannedModelsData.forEach(item => {
        if (item.status === 'ready') {
            selectedModelCodes.add(item.modelCode);
        }
    });
    renderPreviewTable();
    showToast(`تم تحديد ${selectedModelCodes.size} موديل جديد (جاهز للربط بدون صور سابقة)`, 'info');
}

// ==============================================================================
// Fullscreen Studio Workspace Management
// ==============================================================================
function openFullscreenWorkspace() {
    const fs = document.getElementById('gdrive-fullscreen-workspace');
    if (fs) {
        fs.classList.remove('hidden');
        fs.classList.add('flex');
        document.body.classList.add('overflow-hidden');
        fs.scrollTop = 0;
        const tableArea = fs.querySelector('.overflow-y-auto');
        if (tableArea) tableArea.scrollTop = 0;
    }
}

function closeFullscreenWorkspace() {
    const fs = document.getElementById('gdrive-fullscreen-workspace');
    if (fs) {
        fs.classList.add('hidden');
        fs.classList.remove('flex');
        document.body.classList.remove('overflow-hidden');
    }
}

// ==============================================================================
// Conflict Resolution Modal (Replace vs Append vs Skip)
// ==============================================================================
function openImageConflictModal() {
    if (selectedModelCodes.size === 0) {
        showToast('يرجى تحديد موديل واحد على الأقل للاستيراد', 'warning');
        return;
    }

    // Count how many selected models already have existing images
    let conflictCount = 0;
    scannedModelsData.forEach(item => {
        if (selectedModelCodes.has(item.modelCode) && item.status === 'existing') {
            conflictCount++;
        }
    });

    // If no models have existing images, execute directly with replace/clean import
    if (conflictCount === 0) {
        executeImageImport('replace');
        return;
    }

    // Populate conflict modal details
    const countEl = document.getElementById('conflict-models-count');
    if (countEl) countEl.textContent = conflictCount;

    const modal = document.getElementById('gdrive-conflict-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
}

function closeImageConflictModal() {
    const modal = document.getElementById('gdrive-conflict-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

// ==============================================================================
// Execution: Batch Saving into model_images & Recording Sync
// ==============================================================================
export async function executeImageImport(conflictStrategy = 'replace') {
    closeImageConflictModal();

    if (selectedModelCodes.size === 0) return;

    const btnExecute = document.getElementById('btn-import-images-execute');
    const fsBtnExecute = document.getElementById('btn-fs-import-execute');
    const originalText = btnExecute ? btnExecute.innerHTML : '';
    const fsOriginalText = fsBtnExecute ? fsBtnExecute.innerHTML : '';

    setScanningProgress(true, 'بدء معالجة واستيراد الصور على شكل دفعات...', 10);

    [btnExecute, fsBtnExecute].forEach(btn => {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;
        }
    });

    let successCount = 0;
    let totalImagesSaved = 0;
    let skippedCount = 0;
    const errors = [];

    // Filter candidate models from selection
    let targetModels = scannedModelsData.filter(item => 
        selectedModelCodes.has(item.modelCode) && item.matchedModel && item.status !== 'not_found'
    );

    // If strategy is 'skip', process ONLY new models (status === 'ready') and exclude existing completely!
    if (conflictStrategy === 'skip') {
        const existingSelected = targetModels.filter(item => item.status === 'existing');
        skippedCount = existingSelected.length;
        targetModels = targetModels.filter(item => item.status === 'ready');
    }

    if (targetModels.length === 0) {
        setScanningProgress(false);
        [btnExecute, fsBtnExecute].forEach(btn => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = btn === btnExecute ? originalText : fsOriginalText;
            }
        });
        showToast('لم يتم العثور على أي موديلات جديدة للمعالجة (تم تخطي جميع الموديلات التي تحتوي صوراً)', 'info');
        return;
    }

    try {
        // Step 1: Batch Deletion (for 'replace' strategy)
        if (conflictStrategy === 'replace') {
            setScanningProgress(true, 'مسح الصور القديمة للموديلات المحددة على شكل دفعات...', 20);
            const modelIdsToDelete = targetModels.map(m => m.matchedModel.id);
            const DELETE_CHUNK_SIZE = 50;

            for (let i = 0; i < modelIdsToDelete.length; i += DELETE_CHUNK_SIZE) {
                const chunk = modelIdsToDelete.slice(i, i + DELETE_CHUNK_SIZE);
                const { error: delErr } = await supabase
                    .from('model_images')
                    .delete()
                    .in('model_id', chunk);

                if (delErr) {
                    console.error('Batch delete error:', delErr);
                    errors.push(`خطأ أثناء حذف صور دفعة موديلات: ${delErr.message}`);
                }
            }
        }

        // Step 2: Prepare all rows to insert across all target models with strict deduplication
        setScanningProgress(true, 'تجهيز بيانات الصور للرفع المجمع ومنع أي دبلرة...', 40);
        const allRowsToInsert = [];
        let duplicateImagesSkipped = 0;

        for (const item of targetModels) {
            const modelId = item.matchedModel.id;
            let baseSort = 0;
            let allowCover = true;

            // Sets to track existing IDs and URLs already associated with this model
            const existingFileIds = new Set();
            const existingUrls = new Set();

            if (conflictStrategy === 'append' && item.status === 'existing') {
                const existingImgs = item.matchedModel.model_images || [];
                existingImgs.forEach(ei => {
                    if (ei.sort_order && ei.sort_order > baseSort) baseSort = ei.sort_order;
                    if (ei.drive_file_id) existingFileIds.add(String(ei.drive_file_id).trim());
                    if (ei.image_url) existingUrls.add(String(ei.image_url).trim());
                });
                allowCover = existingImgs.length === 0;
            }

            // Sets to track newly added items within the current batch for this model
            const batchFileIds = new Set();
            const batchUrls = new Set();
            let addedOrderIndex = 0;

            item.images.forEach((img) => {
                const fileId = img.id ? String(img.id).trim() : null;
                const imgUrl = img.thumbnailUrl ? String(img.thumbnailUrl).trim() : null;

                // 1. Prevent duplicate Drive file ID for this model
                if (fileId && (existingFileIds.has(fileId) || batchFileIds.has(fileId))) {
                    console.log(`[Deduplication] تم تخطي صورة مكررة لنفس معرف Drive للموديل ${item.modelCode}:`, fileId);
                    duplicateImagesSkipped++;
                    return;
                }

                // 2. Prevent duplicate Image URL for this model
                if (imgUrl && (existingUrls.has(imgUrl) || batchUrls.has(imgUrl))) {
                    console.log(`[Deduplication] تم تخطي صورة مكررة لنفس الرابط للموديل ${item.modelCode}:`, imgUrl);
                    duplicateImagesSkipped++;
                    return;
                }

                if (fileId) batchFileIds.add(fileId);
                if (imgUrl) batchUrls.add(imgUrl);

                addedOrderIndex++;
                allRowsToInsert.push({
                    model_id: modelId,
                    image_url: img.thumbnailUrl,
                    drive_file_id: img.id || null,
                    sort_order: baseSort + addedOrderIndex,
                    is_cover: allowCover && addedOrderIndex === 1
                });
            });
        }

        // Step 3: Batch Insertion in chunks of 100 rows
        const INSERT_CHUNK_SIZE = 100;
        const totalChunks = Math.ceil(allRowsToInsert.length / INSERT_CHUNK_SIZE);

        for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
            const chunk = allRowsToInsert.slice(chunkIdx * INSERT_CHUNK_SIZE, (chunkIdx + 1) * INSERT_CHUNK_SIZE);
            const progressPercent = 45 + Math.round(((chunkIdx + 1) / totalChunks) * 50);
            setScanningProgress(true, `جاري حفظ دفعة الصور (${chunkIdx + 1}/${totalChunks}) — (${chunk.length} صورة)...`, progressPercent);

            const { error: insErr } = await supabase
                .from('model_images')
                .insert(chunk);

            if (insErr) {
                console.error(`Batch insert error on chunk ${chunkIdx + 1}:`, insErr);
                errors.push(`خطأ في إدراج دفعة صور (${chunkIdx + 1}): ${insErr.message}`);
            } else {
                totalImagesSaved += chunk.length;
            }
        }

        successCount = targetModels.length;

        // Step 4: Record Sync Result into home_settings
        const syncSummary = {
            timestamp: new Date().toISOString(),
            dateFormatted: new Date().toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }),
            totalModelsScanned: scannedModelsData.length,
            modelsUpdated: successCount,
            imagesImported: totalImagesSaved,
            modelsSkipped: skippedCount,
            modelsNotFound: scannedModelsData.filter(i => i.status === 'not_found').length,
            strategyUsed: conflictStrategy
        };

        await supabase
            .from('home_settings')
            .upsert([{ setting_key: 'gdrive_image_last_sync', setting_value: JSON.stringify(syncSummary) }], { onConflict: 'setting_key' });

        gDriveSettings.lastSync = syncSummary;
        renderLastSyncSummary();

        setScanningProgress(false);

        if (errors.length > 0) {
            console.warn('Sync finished with errors:', errors);
            showToast(`تم استيراد ${totalImagesSaved} صورة لـ ${successCount} موديل، مع وجود بعض الملاحظات.`, 'warning');
        } else if (duplicateImagesSkipped > 0) {
            showToast(`🎉 تم حفظ واستيراد ${totalImagesSaved} صورة لـ ${successCount} موديل بنجاح (تم تخطي ${duplicateImagesSkipped} صورة مكررة لمنع الدبلرة).`, 'success');
        } else {
            showToast(`🎉 تم حفظ واستيراد ${totalImagesSaved} صورة لـ ${successCount} موديل على شكل دفعات بنجاح!`, 'success');
        }

        // Reload models cache and re-render tables
        await loadAllModels();
        scannedModelsData = matchExtractedWithDatabase(
            new Map(scannedModelsData.map(i => [i.modelCode, i.images])),
            allModelsCache
        );
        selectedModelCodes.clear();
        renderPreviewStats();
        renderPreviewTable();

    } catch (err) {
        console.error('Import execution error:', err);
        setScanningProgress(false);
        showToast(`حدث خطأ أثناء الحفظ: ${err.message}`, 'error');
    } finally {
        [btnExecute, fsBtnExecute].forEach(btn => {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = btn === btnExecute ? originalText : fsOriginalText;
            }
        });
    }
}

// ==============================================================================
// Last Sync Result Card Rendering
// ==============================================================================
function renderLastSyncSummary() {
    const container = document.getElementById('gdrive-last-sync-card');
    if (!container) return;

    if (!gDriveSettings.lastSync) {
        container.innerHTML = `
            <div class="p-4 rounded-xl border border-devo-gray bg-devo-dark/50 text-devo-muted text-xs flex items-center justify-between">
                <div class="flex items-center gap-2">
                    <i class="ph ph-clock-counter-clockwise text-lg text-devo-orange"></i>
                    <span>لم تتم أي عملية مزامنة لصور Google Drive مؤخراً</span>
                </div>
                <span class="text-[11px] text-devo-muted">حالة السجل: فارغ</span>
            </div>
        `;
        return;
    }

    const s = gDriveSettings.lastSync;
    const strategyName = s.strategyUsed === 'append' ? 'إلحاق' : (s.strategyUsed === 'skip' ? 'تخطي الموجود' : 'استبدال');

    container.innerHTML = `
        <div class="p-4 rounded-xl border border-devo-gray bg-devo-dark relative overflow-hidden">
            <div class="flex flex-wrap items-center justify-between gap-3 mb-3 border-b border-devo-gray/60 pb-3">
                <div class="flex items-center gap-2.5">
                    <div class="w-8 h-8 rounded-lg bg-devo-success/10 text-devo-success flex items-center justify-center">
                        <i class="ph ph-check text-lg font-bold"></i>
                    </div>
                    <div>
                        <h4 class="text-sm font-bold text-white">آخر عملية مزامنة ناجحة (Last Sync Result)</h4>
                        <p class="text-[11px] text-devo-muted font-mono">${s.dateFormatted || s.timestamp}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-xs text-devo-muted bg-devo-black px-2.5 py-1 rounded-lg border border-devo-gray">
                        استراتيجية: <strong class="text-devo-orange">${strategyName}</strong>
                    </span>
                </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div class="bg-devo-black/70 p-2.5 rounded-lg border border-devo-gray text-center">
                    <span class="text-[10px] text-devo-muted block">موديلات تم تحديثها</span>
                    <span class="text-base font-bold text-devo-success font-mono">✓ ${s.modelsUpdated || 0}</span>
                </div>
                <div class="bg-devo-black/70 p-2.5 rounded-lg border border-devo-gray text-center">
                    <span class="text-[10px] text-devo-muted block">صور تم استيرادها</span>
                    <span class="text-base font-bold text-white font-mono">✓ ${s.imagesImported || 0}</span>
                </div>
                <div class="bg-devo-black/70 p-2.5 rounded-lg border border-devo-gray text-center">
                    <span class="text-[10px] text-devo-muted block">موديلات غير مسجلة</span>
                    <span class="text-base font-bold text-devo-warning font-mono">⚠ ${s.modelsNotFound || 0}</span>
                </div>
                <div class="bg-devo-black/70 p-2.5 rounded-lg border border-devo-gray text-center">
                    <span class="text-[10px] text-devo-muted block">موديلات تم تخطيها</span>
                    <span class="text-base font-bold text-devo-muted font-mono">${s.modelsSkipped || 0}</span>
                </div>
            </div>
        </div>
    `;
}

// ==============================================================================
// Image Zoom Lightbox Modal with Carousel Navigation & High Z-Index
// ==============================================================================
function openImageZoomModal(arg1, arg2, arg3) {
    let modelCode = '';
    let imageIndex = 0;

    // Supports both openImageZoomModal(modelCode, idx) and legacy openImageZoomModal(url, modelCode, idx)
    if (typeof arg2 === 'number') {
        modelCode = arg1;
        imageIndex = arg2;
    } else if (typeof arg3 === 'number') {
        modelCode = arg2;
        imageIndex = Math.max(0, arg3 - 1);
    } else {
        modelCode = arg1;
        imageIndex = 0;
    }

    const item = scannedModelsData.find(m => m.modelCode === modelCode);
    if (!item || !item.images || item.images.length === 0) return;

    activeZoomModelCode = modelCode;
    activeZoomImages = item.images.map((img, idx) => ({
        url: img.thumbnailUrl,
        name: img.name,
        sortOrder: img.finalSortOrder || (idx + 1),
        isCover: img.isCover || idx === 0,
        id: img.id
    }));

    activeZoomIndex = Math.max(0, Math.min(imageIndex, activeZoomImages.length - 1));
    renderZoomModalContent();

    const modal = document.getElementById('gdrive-zoom-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
}

function renderZoomModalContent() {
    if (activeZoomImages.length === 0) return;
    const currentImg = activeZoomImages[activeZoomIndex];
    if (!currentImg) return;

    const imgEl = document.getElementById('gdrive-zoom-img');
    const titleEl = document.getElementById('gdrive-zoom-title');
    const subtitleEl = document.getElementById('gdrive-zoom-subtitle');
    const coverBadge = document.getElementById('gdrive-zoom-cover-badge');
    const prevBtn = document.getElementById('gdrive-zoom-btn-prev');
    const nextBtn = document.getElementById('gdrive-zoom-btn-next');
    const thumbsContainer = document.getElementById('gdrive-zoom-thumbs-strip');

    if (imgEl) {
        imgEl.src = currentImg.url;
    }
    if (titleEl) {
        titleEl.textContent = `معاينة صور الموديل: ${activeZoomModelCode}`;
    }
    if (subtitleEl) {
        subtitleEl.textContent = `صورة ${activeZoomIndex + 1} من ${activeZoomImages.length} (${currentImg.name || ''})`;
    }
    if (coverBadge) {
        if (currentImg.isCover) {
            coverBadge.classList.remove('hidden');
        } else {
            coverBadge.classList.add('hidden');
        }
    }

    // Toggle Previous / Next arrows based on image count
    if (prevBtn && nextBtn) {
        if (activeZoomImages.length <= 1) {
            prevBtn.classList.add('hidden');
            nextBtn.classList.add('hidden');
        } else {
            prevBtn.classList.remove('hidden');
            nextBtn.classList.remove('hidden');
        }
    }

    // Render bottom thumbnails carousel strip
    if (thumbsContainer) {
        if (activeZoomImages.length <= 1) {
            thumbsContainer.innerHTML = '';
        } else {
            thumbsContainer.innerHTML = activeZoomImages.map((img, idx) => {
                const isActive = idx === activeZoomIndex;
                return `
                    <button type="button" 
                            onclick="goToZoomIndex(${idx})" 
                            class="relative w-12 h-12 rounded-lg overflow-hidden border-2 transition-all shrink-0 cursor-pointer ${isActive ? 'border-devo-orange ring-2 ring-devo-orange/50 scale-105' : 'border-devo-gray/70 opacity-60 hover:opacity-100 hover:border-devo-gray'}">
                        <img src="${img.url}" class="w-full h-full object-cover" onerror="this.src='./src/assets/icons/devo.png'">
                        ${img.isCover ? '<span class="absolute bottom-0 right-0 bg-devo-orange text-white text-[8px] px-1 font-bold">غلاف</span>' : ''}
                    </button>
                `;
            }).join('');
        }
    }
}

function prevZoomImage() {
    if (activeZoomImages.length <= 1) return;
    activeZoomIndex = (activeZoomIndex - 1 + activeZoomImages.length) % activeZoomImages.length;
    renderZoomModalContent();
}

function nextZoomImage() {
    if (activeZoomImages.length <= 1) return;
    activeZoomIndex = (activeZoomIndex + 1) % activeZoomImages.length;
    renderZoomModalContent();
}

function goToZoomIndex(index) {
    if (index >= 0 && index < activeZoomImages.length) {
        activeZoomIndex = index;
        renderZoomModalContent();
    }
}

function closeImageZoomModal() {
    const modal = document.getElementById('gdrive-zoom-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

// ==============================================================================
// Advanced Image Purge Tool (تفريغ ومسح صور الموديلات)
// ==============================================================================
function openPurgeModal() {
    const modal = document.getElementById('gdrive-purge-modal');
    if (!modal) return;

    // Check availability of existing images in different scopes
    const scannedExistingCount = scannedModelsData.filter(m => m.status === 'existing' && m.matchedModel).length;
    const selectedExistingCount = scannedModelsData.filter(m => selectedModelCodes.has(m.modelCode) && m.status === 'existing' && m.matchedModel).length;

    // Choose smart default scope
    if (selectedExistingCount > 0) {
        const selRadio = document.querySelector('input[name="purge-scope"][value="selected"]');
        if (selRadio) selRadio.checked = true;
    } else if (scannedExistingCount > 0) {
        const scRadio = document.querySelector('input[name="purge-scope"][value="scanned_existing"]');
        if (scRadio) scRadio.checked = true;
    }

    updatePurgePreviewStats();

    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function closePurgeModal() {
    const modal = document.getElementById('gdrive-purge-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            const progressContainer = document.getElementById('purge-progress-container');
            if (progressContainer) progressContainer.classList.add('hidden');
        }, 200);
    }
}

function setPurgeProgress(percent, message) {
    const container = document.getElementById('purge-progress-container');
    const bar = document.getElementById('purge-progress-bar');
    const text = document.getElementById('purge-progress-text');
    const percentEl = document.getElementById('purge-progress-percent');

    if (container) container.classList.remove('hidden');
    if (bar) bar.style.width = `${percent}%`;
    if (percentEl) percentEl.textContent = `${percent}%`;
    if (text && message) {
        text.innerHTML = `<i class="ph ph-spinner animate-spin text-devo-error"></i> ${message}`;
    }
}

function getPurgeSlotLabel(slotChoice, customIndex = 1) {
    switch (slotChoice) {
        case 'all': return 'جميع الصور بالكامل';
        case 'slot_1': return 'الصورة الأولى فقط (الغلاف Cover)';
        case 'slot_2': return 'الصورة الثانية فقط';
        case 'slot_3': return 'الصورة الثالثة فقط';
        case 'custom': return `الصورة رقم (${customIndex}) فقط`;
        default: return slotChoice;
    }
}

function calculatePurgeTargets() {
    const scopeRadio = document.querySelector('input[name="purge-scope"]:checked');
    const slotRadio = document.querySelector('input[name="purge-slot"]:checked');
    const customInput = document.getElementById('purge-slot-custom-input');

    const scope = scopeRadio ? scopeRadio.value : 'scanned_existing';
    const slotChoice = slotRadio ? slotRadio.value : 'all';
    const customIndex = customInput ? (parseInt(customInput.value, 10) || 1) : 1;

    // 1. Calculate pool of target models based on scope
    let targetModels = [];

    if (scope === 'scanned_existing') {
        targetModels = scannedModelsData
            .filter(m => m.status === 'existing' && m.matchedModel)
            .map(m => m.matchedModel);
    } else if (scope === 'selected') {
        targetModels = scannedModelsData
            .filter(m => selectedModelCodes.has(m.modelCode) && m.status === 'existing' && m.matchedModel)
            .map(m => m.matchedModel);
    } else if (scope === 'filtered') {
        targetModels = getFilteredData()
            .filter(m => m.status === 'existing' && m.matchedModel)
            .map(m => m.matchedModel);
    } else if (scope === 'all_system') {
        targetModels = allModelsCache.filter(m => m.model_images && m.model_images.length > 0);
    }

    // 2. Identify candidate images to delete
    const imagesToDelete = [];
    const modelsAffected = new Set();

    targetModels.forEach(model => {
        // Look up fresh images from cache if available
        const cachedModel = allModelsCache.find(m => m.id === model.id) || model;
        const imgs = (cachedModel.model_images || []).slice();
        if (imgs.length === 0) return;

        // Sort ascending by sort_order
        imgs.sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));

        if (slotChoice === 'all') {
            imgs.forEach(img => {
                imagesToDelete.push({ id: img.id, model_id: cachedModel.id, is_cover: img.is_cover, sort_order: img.sort_order });
                modelsAffected.add(cachedModel.id);
            });
        } else if (slotChoice === 'slot_1') {
            if (imgs[0]) {
                imagesToDelete.push({ id: imgs[0].id, model_id: cachedModel.id, is_cover: imgs[0].is_cover, sort_order: imgs[0].sort_order });
                modelsAffected.add(cachedModel.id);
            }
        } else if (slotChoice === 'slot_2') {
            if (imgs[1]) {
                imagesToDelete.push({ id: imgs[1].id, model_id: cachedModel.id, is_cover: imgs[1].is_cover, sort_order: imgs[1].sort_order });
                modelsAffected.add(cachedModel.id);
            }
        } else if (slotChoice === 'slot_3') {
            if (imgs[2]) {
                imagesToDelete.push({ id: imgs[2].id, model_id: cachedModel.id, is_cover: imgs[2].is_cover, sort_order: imgs[2].sort_order });
                modelsAffected.add(cachedModel.id);
            }
        } else if (slotChoice === 'custom') {
            const targetImg = imgs[customIndex - 1];
            if (targetImg) {
                imagesToDelete.push({ id: targetImg.id, model_id: cachedModel.id, is_cover: targetImg.is_cover, sort_order: targetImg.sort_order });
                modelsAffected.add(cachedModel.id);
            }
        }
    });

    return { scope, slotChoice, customIndex, targetModels, imagesToDelete, modelsAffected };
}

function updatePurgePreviewStats() {
    // 1. Update Scope Badges
    const badgeScanned = document.getElementById('purge-badge-scanned');
    const badgeSelected = document.getElementById('purge-badge-selected');
    const badgeFiltered = document.getElementById('purge-badge-filtered');
    const badgeAllSystem = document.getElementById('purge-badge-all-system');

    const scannedExisting = scannedModelsData.filter(m => m.status === 'existing' && m.matchedModel).length;
    const selectedExisting = scannedModelsData.filter(m => selectedModelCodes.has(m.modelCode) && m.status === 'existing' && m.matchedModel).length;
    const filteredExisting = getFilteredData().filter(m => m.status === 'existing' && m.matchedModel).length;
    const allSystemExisting = allModelsCache.filter(m => m.model_images && m.model_images.length > 0).length;

    if (badgeScanned) badgeScanned.textContent = `${scannedExisting} موديل`;
    if (badgeSelected) badgeSelected.textContent = `${selectedExisting} موديل`;
    if (badgeFiltered) badgeFiltered.textContent = `${filteredExisting} موديل`;
    if (badgeAllSystem) badgeAllSystem.textContent = `${allSystemExisting} موديل`;

    // 2. Calculate impact targets
    const { slotChoice, customIndex, imagesToDelete, modelsAffected } = calculatePurgeTargets();

    const modelsEl = document.getElementById('purge-summary-models');
    const imagesEl = document.getElementById('purge-summary-images');
    const descEl = document.getElementById('purge-summary-desc');
    const btnConfirm = document.getElementById('btn-confirm-purge');

    if (modelsEl) modelsEl.textContent = modelsAffected.size;
    if (imagesEl) imagesEl.textContent = imagesToDelete.length;

    const slotLabel = getPurgeSlotLabel(slotChoice, customIndex);

    if (descEl) {
        if (imagesToDelete.length === 0) {
            descEl.innerHTML = `<span class="text-devo-orange">⚠️ لا توجد أي صور مطابقة للنطاق والترتيب المختارين حالياً.</span>`;
        } else {
            descEl.innerHTML = `سيتم تفريغ <strong>${slotLabel}</strong> وحذف <strong>${imagesToDelete.length} صورة</strong> من إجمالي <strong>${modelsAffected.size} موديل</strong> مستهدف بشكل آمن على شكل دفعات.`;
        }
    }

    if (btnConfirm) {
        btnConfirm.disabled = imagesToDelete.length === 0;
        if (imagesToDelete.length === 0) {
            btnConfirm.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            btnConfirm.classList.remove('opacity-50', 'cursor-not-allowed');
        }
    }
}

async function executeImagePurge() {
    const { slotChoice, customIndex, imagesToDelete, modelsAffected } = calculatePurgeTargets();

    if (imagesToDelete.length === 0) {
        showToast('لا توجد أي صور مستهدفة للحذف في النطاق المحدد', 'warning');
        return;
    }

    const slotLabel = getPurgeSlotLabel(slotChoice, customIndex);
    const isConfirmed = await confirmDialog({
        title: 'تأكيد تفريغ الصور نهائياً',
        message: 
            `• عدد الموديلات المستهدفة: <strong class="text-white">${modelsAffected.size}</strong> موديل<br>` +
            `• إجمالي الصور التي سيتم مسحها: <strong class="text-devo-error">${imagesToDelete.length}</strong> صورة<br>` +
            `• موضع الحذف: <strong class="text-devo-orange">${slotLabel}</strong><br><br>` +
            `هل أنت متأكد من تنفيذ عملية الحذف نهائياً؟ لا يمكن التراجع عن هذا الإجراء.`,
        confirmText: 'نعم، تفريغ الصور',
        cancelText: 'إلغاء',
        isDestructive: true
    });

    if (!isConfirmed) return;

    const btnConfirm = document.getElementById('btn-confirm-purge');
    const originalBtnHtml = btnConfirm ? btnConfirm.innerHTML : '';
    if (btnConfirm) {
        btnConfirm.disabled = true;
        btnConfirm.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري التفريغ...`;
    }

    try {
        setPurgeProgress(10, 'جاري إعداد دفعات مسح الصور...');

        const imageIds = imagesToDelete.map(i => i.id);
        const modelsLosingCover = new Set(imagesToDelete.filter(i => i.is_cover).map(i => i.model_id));

        // Batch delete in chunks of 100
        const CHUNK_SIZE = 100;
        const totalChunks = Math.ceil(imageIds.length / CHUNK_SIZE);

        for (let i = 0; i < totalChunks; i++) {
            const chunk = imageIds.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
            const progress = 15 + Math.round(((i + 1) / totalChunks) * 65);
            setPurgeProgress(progress, `جاري مسح الصور (${i + 1}/${totalChunks}) — (${chunk.length} صورة)...`);

            const { error: delErr } = await supabase
                .from('model_images')
                .delete()
                .in('id', chunk);

            if (delErr) throw delErr;
        }

        // If models lost their cover image and still have other images, promote the next image to cover
        if (modelsLosingCover.size > 0) {
            setPurgeProgress(85, 'إعادة تعيين الأغلفة للموديلات المتبقية...');
            const deletedIdSet = new Set(imageIds);
            const coversToPromote = [];

            modelsLosingCover.forEach(modelId => {
                const model = allModelsCache.find(m => m.id === modelId);
                if (model && model.model_images) {
                    const remaining = model.model_images
                        .filter(img => !deletedIdSet.has(img.id))
                        .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
                    if (remaining.length > 0 && !remaining.some(r => r.is_cover)) {
                        coversToPromote.push(remaining[0].id);
                    }
                }
            });

            if (coversToPromote.length > 0) {
                for (let i = 0; i < coversToPromote.length; i += 100) {
                    const chunk = coversToPromote.slice(i, i + 100);
                    await supabase
                        .from('model_images')
                        .update({ is_cover: true })
                        .in('id', chunk);
                }
            }
        }

        // Reload models cache & re-match
        setPurgeProgress(92, 'تحديث بيانات الموديلات والمعاينة...');
        await loadAllModels();

        const activeMap = lastExtractedMap || (scannedModelsData.length > 0 ? new Map(scannedModelsData.map(i => [i.modelCode, i.images])) : null);
        if (activeMap && activeMap.size > 0) {
            scannedModelsData = matchExtractedWithDatabase(activeMap, allModelsCache);
            renderPreviewStats();
            renderPreviewTable();
        }

        setPurgeProgress(100, 'اكتملت عملية التفريغ بنجاح!');
        showToast(`تم تفريغ ${imageIds.length} صورة بنجاح من ${modelsAffected.size} موديل`, 'success');

        setTimeout(() => {
            closePurgeModal();
        }, 600);

    } catch (err) {
        console.error('Image purge error:', err);
        showToast(`فشل تفريغ الصور: ${err.message}`, 'error');
    } finally {
        if (btnConfirm) {
            btnConfirm.disabled = false;
            btnConfirm.innerHTML = originalBtnHtml;
        }
    }
}

