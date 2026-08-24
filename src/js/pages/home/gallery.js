import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';
import { 
    getAllCachedModels, 
    saveAllCachedModels, 
    putCachedModel, 
    deleteCachedModel, 
    resolveImageUrl, 
    getCachedImageObjectUrl, 
    cacheImageBlob, 
    bindImageToCache, 
    pruneUnusedImages, 
    preloadModelImages, 
    removeImagesForModel 
} from '../../services/offline_store.js';

let allModels = [];
let currentCategories = new Set();
let currentUser = null;
let isWorker = false;
let localCart = []; 
let currentPage = 1;
const itemsPerPage = 25;
let currentFilteredModels = [];

export async function initGallery() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    
    // الموظف المخول برؤية الأرصدة والطلب هو الأونر/الأدمن أو العامل
    isWorker = currentUser && (
        currentUser.role === 'admin' 
        || currentUser.role === 'owner' 
        || currentUser.role === 'worker'
    );

    if (isWorker) {
        loadLocalCart();
        document.getElementById('floating-cart-btn')?.classList.remove('hidden');
    }

    document.getElementById('gal-search')?.addEventListener('input', applyGalleryFilters);
    document.getElementById('gal-category')?.addEventListener('change', applyGalleryFilters);
    document.getElementById('gal-sort')?.addEventListener('change', applyGalleryFilters);

    await fetchGalleryModels();
    setupGalleryRealtime(); // 🌟 تفعيل الرادار اللحظي الشامل 🌟

    // نظام الروابط العميقة (Deep Linking)
    const urlParams = new URLSearchParams(window.location.search);
    const modelFromUrl = urlParams.get('model');
    if (modelFromUrl) {
        setTimeout(() => { window.openModelViewer(modelFromUrl, true); }, 500);
    }

    // إغلاق نافذة التفاصيل عند الضغط خارجها (خلفية المودال)
    const modelViewerModal = document.getElementById('model-viewer-modal');
    if (modelViewerModal) {
        modelViewerModal.addEventListener('click', (e) => {
            if (e.target === modelViewerModal) {
                window.closeModelViewer();
            }
        });
    }
}

// ==========================================
// 🌟 1. استدعاء البيانات مع تقنية الكاش الفوري (Stale-While-Revalidate) 🌟
// ==========================================
async function fetchGalleryModels() {
    const container = document.getElementById('gallery-grid');
    if (!container) return;
    
    // ⚡ 1. التحميل الفوري السريع من IndexedDB في (0ms Instant Load) ⚡
    try {
        const cachedData = await getAllCachedModels();
        if (cachedData && cachedData.length > 0 && allModels.length === 0) {
            allModels = cachedData;
            populateCategoryFilter();
            applyGalleryFilters();
        }
    } catch (e) {
        console.warn('تجاوز كاش IndexedDB:', e);
    }

    if (allModels.length === 0) {
        container.innerHTML = `<div class="col-span-full py-20 text-center"><i class="ph ph-spinner animate-spin text-5xl text-devo-orange"></i></div>`;
    }

    // 🔄 2. التحديث الصامت في الخلفية من Supabase لتنقيح وحفظ البيانات الحديثة 🔄
    try {
        const { data, error } = await supabase
            .from('models')
            .select(`
                *,
                categories(name),
                classes(name, class_sizes(sizes(name))),
                model_sizes(sizes(name)),
                model_inventory(color_id, available_series, colors(name)),
                model_images(image_url)
            `)
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('[Gallery] Supabase fetch error:', error);
            return;
        }

        if (data) {
            const previousModels = allModels;
            allModels = data;

            // حفظ أحدث نسخة في IndexedDB بالخلفية
            saveAllCachedModels(data);

            // تنظيف صور الموديلات المعطلة أو المحذوفة تلقائياً لتوفير المساحة
            pruneUnusedImages(data);

            // بدء التنزيل المسبق لصور الموديلات الجديدة غير المخزنة محلياً
            preloadModelImages(data);

            populateCategoryFilter();

            // تطبيق التحديث الناعم Fine-Grained DOM Patching دون وميض
            patchOrRenderGallery(previousModels, data);
        }
    } catch (err) {
        console.warn('[Gallery] Network fetch failed, relying on offline cache:', err);
    }
}

function populateCategoryFilter() {
    const catSelect = document.getElementById('gal-category');
    if (!catSelect) return;
    const currentVal = catSelect.value;
    currentCategories = new Set();
    allModels.forEach(m => { if (m.categories?.name) currentCategories.add(m.categories.name); });
    let catOptions = `<option value="">جميع التصنيفات</option>`;
    currentCategories.forEach(cat => catOptions += `<option value="${cat}">${cat}</option>`);
    catSelect.innerHTML = catOptions;
    if (currentVal) catSelect.value = currentVal;
}

// ==========================================
// 🌟 2. الرادار اللحظي الشامل (Insert, Update, Delete) 🌟
// ==========================================
function setupGalleryRealtime() {
    supabase.channel('public_gallery_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, (payload) => {
            
            // 🚨 حالة الحذف المباشر (DELETE) 🚨
            if (payload.eventType === 'DELETE') {
                const targetId = payload.old.id;
                allModels = allModels.filter(m => m.id !== targetId);
                deleteCachedModel(targetId);
                
                // أنيميشن ناعم لحذف الكارت إن وجد
                const card = document.getElementById(`gallery-card-${targetId}`);
                if (card) {
                    card.style.transition = 'all 0.35s ease';
                    card.style.opacity = '0';
                    card.style.transform = 'scale(0.92)';
                    setTimeout(() => { applyGalleryFilters(); }, 350);
                } else {
                    applyGalleryFilters();
                }

                checkAndCloseModal(targetId, 'تم حذف هذا الموديل من قبل الإدارة.');
                return;
            }

            // 🌟 الحل السحري (Race Condition Fix): 
            // ننتظر 800 ملي ثانية لكي تكتمل عمليات مسح وإعادة إدخال الألوان والصور في قاعدة البيانات
            setTimeout(async () => {
                const { data: fullModel, error } = await supabase
                    .from('models')
                    .select(`
                        *, categories(name), classes(name, class_sizes(sizes(name))),
                        model_sizes(sizes(name)), model_inventory(color_id, available_series, colors(name)), model_images(image_url)
                    `)
                    .eq('id', payload.new.id)
                    .single();

                if (error || !fullModel) return;

                if (payload.eventType === 'INSERT') {
                    if (fullModel.is_active) {
                        if (!allModels.find(m => m.id === fullModel.id)) {
                            allModels.unshift(fullModel);
                            putCachedModel(fullModel);
                            if (fullModel.model_images?.[0]?.image_url) {
                                cacheImageBlob(fullModel.model_images[0].image_url, fullModel.id);
                            }
                            applyGalleryFilters();
                        }
                    }
                } 
                else if (payload.eventType === 'UPDATE') {
                    if (!fullModel.is_active) {
                        allModels = allModels.filter(m => m.id !== fullModel.id);
                        deleteCachedModel(fullModel.id);
                        
                        const card = document.getElementById(`gallery-card-${fullModel.id}`);
                        if (card) {
                            card.style.transition = 'all 0.35s ease';
                            card.style.opacity = '0';
                            card.style.transform = 'scale(0.92)';
                            setTimeout(() => { applyGalleryFilters(); }, 350);
                        } else {
                            applyGalleryFilters();
                        }

                        checkAndCloseModal(fullModel.id, 'تم تعطيل هذا الموديل ولم يعد متاحاً.');
                    } else {
                        const index = allModels.findIndex(m => m.id === fullModel.id);
                        putCachedModel(fullModel);
                        if (fullModel.model_images?.[0]?.image_url) {
                            cacheImageBlob(fullModel.model_images[0].image_url, fullModel.id);
                        }

                        if (index > -1) {
                            allModels[index] = fullModel;
                            patchGalleryCardDOM(fullModel);
                            updateModelViewerDOM(fullModel.id);
                        } else {
                            // كان معطلاً وأصبح نشطاً (إضافة جديدة للمعرض)
                            allModels.unshift(fullModel);
                            applyGalleryFilters();
                        }
                    }
                }
            }, 800);
        })
        
        // 🚨 حالة تعديل المخزون المباشر 🚨
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'model_inventory' }, (payload) => {
            const modelIndex = allModels.findIndex(m => m.id === payload.new.model_id);
            if (modelIndex > -1) {
                const invIndex = allModels[modelIndex].model_inventory?.findIndex(i => i.color_id === payload.new.color_id);
                if (invIndex > -1) {
                    allModels[modelIndex].model_inventory[invIndex].available_series = payload.new.available_series;
                    putCachedModel(allModels[modelIndex]);
                    patchGalleryCardDOM(allModels[modelIndex]);
                    updateModelViewerDOM(payload.new.model_id);
                }
            }
        })
        .subscribe();
}

// دالة حماية: إغلاق نافذة الموديل إذا تم إخفاؤه أو حذفه
function checkAndCloseModal(modelId, message) {
    const modal = document.getElementById('model-viewer-modal');
    if (modal && !modal.classList.contains('hidden') && modal.getAttribute('data-current-model-id') === modelId) {
        window.closeModelViewer();
        showToast(message, 'warning');
    }
}

// ==========================================
// 🌟 3. الفلترة والرسم الناعم (Fine-Grained DOM Patching) 🌟
// ==========================================

window.toggleGalleryFilters = () => {
    const advFilters = document.getElementById('gallery-advanced-filters');
    const btnIcon = document.querySelector('button[onclick="toggleGalleryFilters()"] i');
    if (!advFilters) return;
    
    const isHidden = advFilters.classList.contains('hidden');
    if (isHidden) {
        advFilters.classList.remove('hidden');
        advFilters.classList.add('flex');
        if (btnIcon) {
            btnIcon.className = 'ph ph-x text-lg text-devo-orange';
        }
    } else {
        advFilters.classList.add('hidden');
        advFilters.classList.remove('flex');
        if (btnIcon) {
            btnIcon.className = 'ph ph-faders text-lg text-white';
        }
    }
};

window.clearGalleryFilters = () => {
    const searchEl = document.getElementById('gal-search');
    const catEl = document.getElementById('gal-category');
    const sortEl = document.getElementById('gal-sort');
    if (searchEl) searchEl.value = '';
    if (catEl) catEl.value = '';
    if (sortEl) sortEl.value = 'newest';
    applyGalleryFilters();
};

function applyGalleryFilters() {
    const term = document.getElementById('gal-search')?.value.toLowerCase().trim() || '';
    const cat = document.getElementById('gal-category')?.value || '';
    const sort = document.getElementById('gal-sort')?.value || 'newest';

    let filtered = allModels.filter(m => {
        let isMatch = true;
        const searchStr = `${m.factory_code || ''} ${m.system_code || ''} ${m.name || ''}`.toLowerCase();
        if (term && !searchStr.includes(term)) isMatch = false;
        if (cat && m.categories?.name !== cat) isMatch = false;
        return isMatch;
    });

    if (sort === 'price_asc') filtered.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    currentFilteredModels = filtered;
    renderGalleryPage();
}

/**
 * Smart Patch or Full Render
 */
function patchOrRenderGallery(prevModels, nextModels) {
    if (!prevModels || prevModels.length === 0) {
        applyGalleryFilters();
        return;
    }

    const term = document.getElementById('gal-search')?.value.toLowerCase().trim() || '';
    const cat = document.getElementById('gal-category')?.value || '';
    const sort = document.getElementById('gal-sort')?.value || 'newest';

    let filtered = nextModels.filter(m => {
        let isMatch = true;
        const searchStr = `${m.factory_code || ''} ${m.system_code || ''} ${m.name || ''}`.toLowerCase();
        if (term && !searchStr.includes(term)) isMatch = false;
        if (cat && m.categories?.name !== cat) isMatch = false;
        return isMatch;
    });

    if (sort === 'price_asc') filtered.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    currentFilteredModels = filtered;

    // Check if the current page cards can be patched in-place
    const totalItems = currentFilteredModels.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageData = currentFilteredModels.slice(startIndex, endIndex);

    const container = document.getElementById('gallery-grid');
    if (!container) return;

    const renderedCards = container.querySelectorAll('[id^="gallery-card-"]');
    const canPatchInPlace = renderedCards.length === pageData.length && 
        Array.from(renderedCards).every((card, idx) => card.id === `gallery-card-${pageData[idx].id}`);

    if (canPatchInPlace) {
        // Fine-Grained update without any layout jump or re-render!
        pageData.forEach(model => {
            patchGalleryCardDOM(model);
        });
        renderGalleryPaginationControls(totalPages);
    } else {
        // Render smoothly
        renderGalleryPage();
    }
}

function renderGalleryPage() {
    const container = document.getElementById('gallery-grid');
    const topPagination = document.getElementById('gallery-pagination-top');
    const bottomPagination = document.getElementById('gallery-pagination-bottom');
    
    if (!container) return;

    if (currentFilteredModels.length === 0) {
        container.innerHTML = `<div class="col-span-full py-20 text-center text-devo-muted flex flex-col items-center"><i class="ph ph-magnifying-glass text-6xl mb-4 opacity-50"></i><p>لا توجد موديلات تطابق بحثك حالياً.</p></div>`;
        if (topPagination) topPagination.innerHTML = '';
        if (bottomPagination) bottomPagination.innerHTML = '';
        return;
    }

    const totalItems = currentFilteredModels.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageData = currentFilteredModels.slice(startIndex, endIndex);

    container.innerHTML = pageData.map(m => generateGalleryCardHTML(m)).join('');
    
    // Bind images to local cache
    pageData.forEach(m => {
        const card = document.getElementById(`gallery-card-${m.id}`);
        if (card) {
            const rawUrl = m.model_images?.[0]?.image_url;
            if (rawUrl) {
                const mainImg = card.querySelector('.card-main-img');
                const blurImg = card.querySelector('.card-blur-img');
                if (mainImg) bindImageToCache(mainImg, rawUrl, m.id);
                if (blurImg) bindImageToCache(blurImg, rawUrl, m.id);
            }
        }
    });

    renderGalleryPaginationControls(totalPages);
}

/**
 * Generate stock badge HTML
 */
function getStockBadgeHTML(totalSeries, isOut) {
    if (isWorker) {
        if (isOut) return `<span class="stock-badge bg-devo-error text-white text-[10px] sm:text-xs px-2 sm:px-2.5 py-1 rounded-md shadow-lg font-bold flex items-center gap-1"><i class="ph ph-warning-circle"></i> نفذت</span>`;
        else if (totalSeries <= 5) return `<span class="stock-badge bg-devo-orange text-white text-[10px] sm:text-xs px-2 sm:px-2.5 py-1 rounded-md shadow-lg font-bold">متبقي ${totalSeries} سيريه</span>`;
        else return `<span class="stock-badge bg-devo-success text-white text-[10px] sm:text-xs px-2 sm:px-2.5 py-1 rounded-md shadow-lg font-bold">متبقي ${totalSeries} سيريه</span>`;
    } else {
        if (isOut) return `<span class="stock-badge bg-devo-black/80 backdrop-blur-sm text-white text-[10px] sm:text-xs px-2 sm:px-2.5 py-1 rounded-md shadow-lg font-bold border border-devo-gray">نفذت الكمية</span>`;
        else return `<span class="stock-badge bg-devo-success/20 text-devo-success backdrop-blur-sm border border-devo-success/50 text-[10px] sm:text-xs px-2 sm:px-2.5 py-1 rounded-md shadow-lg font-bold">متوفر</span>`;
    }
}

function generateGalleryCardHTML(m) {
    const totalSeries = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
    const isOut = totalSeries === 0;
    const rawImg = m.model_images?.[0]?.image_url;
    const mainImg = resolveImageUrl(rawImg);
    const stockBadge = getStockBadgeHTML(totalSeries, isOut);
    const cardStyle = isOut ? 'grayscale opacity-80' : 'card-hover cursor-pointer';

    return `
    <div id="gallery-card-${m.id}" class="bg-devo-dark border border-devo-gray rounded-xl sm:rounded-2xl overflow-hidden flex flex-col relative group transition-all duration-300 ${cardStyle}" onclick="openModelViewer('${m.id}')">
        <div class="card-stock-badge-container absolute top-2 right-2 z-30 transition-all duration-300">
            ${stockBadge}
        </div>
        <div class="h-44 sm:h-64 md:h-72 bg-devo-black relative overflow-hidden flex items-center justify-center p-3">
            <img src="${mainImg}" class="card-blur-img absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-40 pointer-events-none transition-opacity duration-300" aria-hidden="true" onerror="this.style.display='none'" loading="lazy" decoding="async">
            <div class="absolute inset-0 bg-devo-black/20 backdrop-blur-sm pointer-events-none"></div>
            <img src="${mainImg}" class="card-main-img relative z-10 max-w-full max-h-full w-auto h-auto object-contain rounded-lg border border-devo-gray/50 shadow-md transition-transform duration-500 group-hover:scale-[1.03]" onerror="this.src='./src/assets/icons/devo.png'" loading="lazy" decoding="async">
        </div>
        <div class="p-2.5 sm:p-4 flex flex-col flex-1 justify-between z-10 relative bg-devo-dark border-t border-devo-gray/30">
            <div>
                <p class="card-code-text text-devo-muted text-[9px] sm:text-[10px] font-mono tracking-wider mb-0.5">${m.factory_code || m.system_code || ''}</p>
                <h3 class="card-name-text text-white font-bold text-xs sm:text-base md:text-lg mb-0.5 sm:mb-1 truncate" title="${m.name}">${m.name}</h3>
            </div>
            <div class="flex justify-between items-end mt-1 sm:mt-2">
                <span class="card-cat-text text-devo-muted text-[10px] sm:text-xs flex items-center gap-1"><i class="ph ph-tag"></i> ${m.categories?.name || 'بدون تصنيف'}</span>
                <p class="text-devo-orange font-black text-sm sm:text-lg md:text-xl"><span class="card-price-val">${m.price}</span> <span class="text-[9px] sm:text-[10px] font-normal">ج.م</span></p>
            </div>
        </div>
    </div>`;
}

/**
 * Fine-Grained in-place DOM patch for a single gallery card
 */
function patchGalleryCardDOM(model) {
    if (!model || !model.id) return;
    const card = document.getElementById(`gallery-card-${model.id}`);
    if (!card) return;

    const totalSeries = model.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
    const isOut = totalSeries === 0;

    // 1. Update Card Stock Badge
    const badgeContainer = card.querySelector('.card-stock-badge-container');
    if (badgeContainer) {
        badgeContainer.innerHTML = getStockBadgeHTML(totalSeries, isOut);
    }

    // 2. Update Card Greyscale / Hover Style
    if (isOut) {
        card.classList.add('grayscale', 'opacity-80');
        card.classList.remove('card-hover', 'cursor-pointer');
    } else {
        card.classList.remove('grayscale', 'opacity-80');
        card.classList.add('card-hover', 'cursor-pointer');
    }

    // 3. Update Price
    const priceValEl = card.querySelector('.card-price-val');
    if (priceValEl && priceValEl.textContent !== String(model.price)) {
        priceValEl.textContent = model.price;
        priceValEl.classList.add('text-devo-success', 'scale-110');
        setTimeout(() => priceValEl.classList.remove('text-devo-success', 'scale-110'), 800);
    }

    // 4. Update Name & Code
    const nameEl = card.querySelector('.card-name-text');
    if (nameEl && nameEl.textContent !== model.name) {
        nameEl.textContent = model.name;
        nameEl.title = model.name;
    }

    const codeEl = card.querySelector('.card-code-text');
    const newCode = model.factory_code || model.system_code || '';
    if (codeEl && codeEl.textContent !== newCode) {
        codeEl.textContent = newCode;
    }

    // 5. Update Category
    const catEl = card.querySelector('.card-cat-text');
    if (catEl) {
        catEl.innerHTML = `<i class="ph ph-tag"></i> ${model.categories?.name || 'بدون تصنيف'}`;
    }

    // 6. Update Image if changed
    const rawUrl = model.model_images?.[0]?.image_url;
    if (rawUrl) {
        const mainImg = card.querySelector('.card-main-img');
        const blurImg = card.querySelector('.card-blur-img');
        if (mainImg) bindImageToCache(mainImg, rawUrl, model.id);
        if (blurImg) bindImageToCache(blurImg, rawUrl, model.id);
    }
}

// 🌟 التحديث الشامل داخل نافذة التفاصيل 🌟
function updateModelViewerDOM(id) {
    const modal = document.getElementById('model-viewer-modal');
    if (modal && !modal.classList.contains('hidden') && modal.getAttribute('data-current-model-id') === id) {
        const model = allModels.find(m => m.id === id);
        if (model) {
            // تحديث الاسم
            const nameEl = document.getElementById('viewer-name');
            if (nameEl) nameEl.textContent = model.name;

            // تحديث السعر
            const priceEl = document.getElementById('viewer-price');
            if (priceEl) priceEl.textContent = model.price;

            // تحديث عدد المقاسات الكلي في العنوان
            const classSizes = model.classes?.class_sizes || [];
            const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1);
            const sizesTitleEl = document.getElementById('viewer-sizes-title');
            if (sizesTitleEl) sizesTitleEl.innerHTML = `<i class="ph ph-ruler"></i> المقاسات داخل السيريه (${sizesCount} قطع)`;

            // تحديث بادجات المقاسات
            const sizesContainer = document.getElementById('viewer-sizes-container');
            if (sizesContainer) {
                const renderSizesTags = classSizes.length > 0 
                    ? classSizes.map(cs => `<span class="bg-devo-gray/30 border border-devo-gray text-white text-xs px-3 py-1.5 rounded font-medium"><i class="ph ph-link text-devo-muted"></i> ${cs.sizes?.name}</span>`).join('')
                    : model.model_sizes?.map(s => `<span class="bg-devo-gray/30 border border-devo-gray text-white text-xs px-3 py-1.5 rounded font-medium">${s.sizes?.name}</span>`).join('');
                sizesContainer.innerHTML = renderSizesTags || '<span class="text-devo-muted text-xs">غير محدد</span>';
            }

            // تحديث الألوان والمخزون
            const colorsContainer = document.getElementById('viewer-colors-container');
            if (colorsContainer) {
                colorsContainer.innerHTML = generateColorsHTML(model, sizesCount);
            }
        }
    }
}

function renderGalleryPaginationControls(totalPages) {
    const topContainer = document.getElementById('gallery-pagination-top');
    const bottomContainer = document.getElementById('gallery-pagination-bottom');
    if (!topContainer || !bottomContainer) return;
    if (totalPages <= 1) { topContainer.innerHTML = ''; bottomContainer.innerHTML = ''; return; }

    let html = `
        <button onclick="changeGalleryPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="px-3.5 md:px-5 py-2 md:py-2.5 rounded-xl border border-devo-gray bg-devo-dark/80 text-white disabled:text-neutral-600 disabled:border-neutral-800/40 disabled:opacity-40 disabled:pointer-events-none hover:border-devo-orange hover:text-devo-orange transition-all duration-300 flex items-center gap-1.5 text-xs md:text-sm font-medium group">
            <i class="ph ph-caret-right text-devo-orange group-disabled:text-inherit text-sm md:text-base transition-colors"></i>
            <span class="text-inherit">السابق</span>
        </button>
        <span class="px-4 md:px-6 py-2 md:py-2.5 rounded-xl bg-devo-dark/80 text-white font-bold border border-devo-gray text-xs md:text-sm whitespace-nowrap">
            صفحة <span class="text-devo-orange font-bold">${currentPage} من ${totalPages}</span>
        </span>
        <button onclick="changeGalleryPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="px-3.5 md:px-5 py-2 md:py-2.5 rounded-xl border border-devo-gray bg-devo-dark/80 text-white disabled:text-neutral-600 disabled:border-neutral-800/40 disabled:opacity-40 disabled:pointer-events-none hover:border-devo-orange hover:text-devo-orange transition-all duration-300 flex items-center gap-1.5 text-xs md:text-sm font-medium group">
            <span class="text-inherit">التالي</span>
            <i class="ph ph-caret-left text-devo-orange group-disabled:text-inherit text-sm md:text-base transition-colors"></i>
        </button>
    `;
    topContainer.innerHTML = html; bottomContainer.innerHTML = html;
}

window.changeGalleryPage = (newPage) => {
    currentPage = newPage;
    renderGalleryPage();
    document.getElementById('gal-search')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

// ==========================================
// 🌟 4. تفاصيل الموديل والروابط العميقة 🌟
// ==========================================
window.openModelViewer = (id, skipHistory = false) => {
    const model = allModels.find(m => m.id === id);
    if (!model) return;

    if (!skipHistory) {
        history.pushState({ modelId: id }, '', `?model=${id}`);
    }

    const classSizes = model.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1);

    const modal = document.getElementById('model-viewer-modal');
    if (modal) modal.setAttribute('data-current-model-id', id);

    const content = document.getElementById('model-viewer-content');
    const imgs = model.model_images?.length > 0 ? model.model_images : [{ image_url: null }];
    const mainImg = resolveImageUrl(imgs[0].image_url);
    
    let imagesGalleryHtml = `
        <div class="bg-devo-black rounded-xl overflow-hidden border border-devo-gray h-56 sm:h-72 md:h-[380px] mb-2 sm:mb-3 flex items-center justify-center p-4 relative">
            <img src="${mainImg}" id="viewer-blur-bg" class="absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-40 pointer-events-none" aria-hidden="true" onerror="this.style.display='none'" loading="lazy" decoding="async">
            <div class="absolute inset-0 bg-devo-black/20 backdrop-blur-sm pointer-events-none"></div>
            <img src="${mainImg}" id="viewer-main-img" class="relative z-10 max-w-full max-h-full w-auto h-auto object-contain rounded-xl border border-devo-gray/50 shadow-lg" onerror="this.src='./src/assets/icons/devo.png'" decoding="async">
        </div>
        ${imgs.length > 1 ? `<div class="flex gap-2 overflow-x-auto pb-1.5 custom-scrollbar">${imgs.map(img => `<img src="${resolveImageUrl(img.image_url)}" onclick="document.getElementById('viewer-main-img').src=this.src; if(document.getElementById('viewer-blur-bg')) document.getElementById('viewer-blur-bg').src=this.src" class="viewer-thumb-img w-14 h-14 sm:w-20 sm:h-20 rounded-lg object-cover cursor-pointer border border-devo-gray hover:border-devo-orange transition-colors shrink-0" onerror="this.src='./src/assets/icons/devo.png'" loading="lazy" decoding="async">`).join('')}</div>` : ''}
    `;

    const renderSizesTags = classSizes.length > 0 
        ? classSizes.map(cs => `<span class="bg-devo-gray/30 border border-devo-gray text-white text-[11px] sm:text-xs px-2.5 py-1 rounded font-medium"><i class="ph ph-link text-devo-muted"></i> ${cs.sizes?.name}</span>`).join('')
        : model.model_sizes?.map(s => `<span class="bg-devo-gray/30 border border-devo-gray text-white text-[11px] sm:text-xs px-2.5 py-1 rounded font-medium">${s.sizes?.name}</span>`).join('');
    
    const sizesHtml = renderSizesTags || '<span class="text-devo-muted text-xs">غير محدد</span>';

    // قسم إضافة طقم (يظهر فقط للموظفين/الآدمن)
    let setHtml = '';
    if (isWorker) {
        setHtml = `
        <div class="bg-gradient-to-r from-devo-orange/15 via-devo-dark to-devo-black border border-devo-orange/40 rounded-xl p-2.5 sm:p-3 mb-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 shadow-md">
            <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-lg bg-devo-orange/20 border border-devo-orange/50 flex items-center justify-center text-devo-orange shrink-0">
                    <i class="ph ph-package text-lg font-bold"></i>
                </div>
                <div>
                    <h5 class="text-white text-xs sm:text-sm font-black flex items-center gap-1">
                        إضافة طقم كامل
                        <span class="text-[10px] text-devo-orange bg-devo-orange/20 px-1.5 py-0.5 rounded font-bold border border-devo-orange/30">(سيرية من كل لون)</span>
                    </h5>
                </div>
            </div>

            <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
                <div class="flex items-center bg-devo-dark border border-devo-orange/50 rounded-lg overflow-hidden h-8 sm:h-9">
                    <button onclick="decrementQty('set-qty-${model.id}')" class="px-2 text-white hover:text-devo-orange transition-colors"><i class="ph ph-minus text-xs"></i></button>
                    <input type="number" id="set-qty-${model.id}" value="1" min="1" max="99" readonly class="w-8 bg-transparent text-center text-devo-orange text-xs sm:text-sm font-black outline-none border-x border-devo-gray">
                    <button onclick="incrementQty('set-qty-${model.id}', 99)" class="px-2 text-white hover:text-devo-orange transition-colors"><i class="ph ph-plus text-xs"></i></button>
                </div>
                
                <button id="add-set-btn-${model.id}" onclick="addSetToCart(event, '${model.id}')" class="flex-1 sm:flex-none px-3.5 py-1.5 sm:py-2 bg-gradient-to-r from-devo-orange to-orange-600 hover:from-devo-orangeHover hover:to-orange-700 text-white rounded-lg text-xs sm:text-sm font-black transition-all shadow-lg flex items-center justify-center gap-1.5 active:scale-95">
                    <i class="ph ph-plus-circle text-base sm:text-lg"></i>
                    <span>إضافة طقم</span>
                </button>
            </div>
        </div>`;
    }

    if (content) {
        content.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 p-1 sm:p-2 md:p-0">
                <div>${imagesGalleryHtml}</div>
                <div class="flex flex-col">
                    <div class="mb-3 pb-3 border-b border-devo-gray flex justify-between items-center gap-2">
                        <div>
                            <p class="text-devo-muted text-[10px] sm:text-xs font-mono mb-0.5">كود: ${model.factory_code || model.system_code || ''}</p>
                            <h2 id="viewer-name" class="text-lg sm:text-2xl font-black text-white leading-tight">${model.name}</h2>
                            <p class="text-xl sm:text-3xl text-devo-orange font-black mt-1"><span id="viewer-price">${model.price}</span> <span class="text-xs sm:text-base font-normal">ج.م</span></p>
                        </div>
                        <button onclick="shareModel('${model.id}')" class="flex items-center justify-center gap-1.5 bg-devo-dark border border-devo-gray hover:border-devo-info hover:text-devo-info text-white px-3 py-1.5 rounded-lg transition-colors text-xs sm:text-sm font-bold shrink-0 shadow-sm">
                            <i class="ph ph-share-network text-base"></i> مشاركة
                        </button>
                    </div>

                    <div class="mb-3">
                        <h4 id="viewer-sizes-title" class="text-xs sm:text-sm font-bold text-white mb-1.5 flex items-center gap-1.5"><i class="ph ph-ruler text-devo-orange"></i> المقاسات داخل السيريه (${sizesCount} قطع)</h4>
                        <div id="viewer-sizes-container" class="flex flex-wrap gap-1.5">${sizesHtml}</div>
                    </div>

                    ${setHtml}

                    <div class="flex-1">
                        <h4 class="text-xs sm:text-sm font-bold text-white mb-2 flex items-center gap-1.5"><i class="ph ph-palette text-devo-orange"></i> الألوان المتاحة للطلب</h4>
                        <div id="viewer-colors-container" class="space-y-1.5">
                            ${generateColorsHTML(model, sizesCount)}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Bind main & thumbnail images in viewer to cache
        if (imgs[0]?.image_url) {
            bindImageToCache(document.getElementById('viewer-main-img'), imgs[0].image_url, model.id);
            bindImageToCache(document.getElementById('viewer-blur-bg'), imgs[0].image_url, model.id);
        }
        content.querySelectorAll('.viewer-thumb-img').forEach((thumbEl, idx) => {
            if (imgs[idx]?.image_url) {
                bindImageToCache(thumbEl, imgs[idx].image_url, model.id);
            }
        });
    }

    if (modal) { modal.classList.remove('hidden'); setTimeout(() => modal.classList.remove('opacity-0'), 10); }
};

function getOwnedQtyForColor(modelId, colorId) {
    const savedOrderData = localStorage.getItem('devo_edit_order_data');
    if (!savedOrderData) return 0;
    try {
        const orderData = JSON.parse(savedOrderData);
        if (orderData && orderData.original_items) {
            const item = orderData.original_items.find(oi => oi.model_id === modelId && oi.color_id === colorId);
            return item ? (item.quantity || 0) : 0;
        }
    } catch(e) {}
    return 0;
}

function getCartQtyForColor(modelId, colorId) {
    loadLocalCart();
    const item = localCart.find(i => i.modelId === modelId && i.colorId === colorId);
    return item ? item.qty : 0;
}

function refreshColorsContainer(modelId) {
    const model = allModels.find(m => m.id === modelId);
    if (!model) return;
    const classSizes = model.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1);
    const container = document.getElementById('viewer-colors-container');
    if (container) container.innerHTML = generateColorsHTML(model, sizesCount);
}

function generateColorsHTML(model, sizesCount) {
    if (!model.model_inventory || model.model_inventory.length === 0) {
        return `<div class="text-center p-3 text-devo-error bg-devo-error/10 rounded-xl text-xs sm:text-sm border border-devo-error/20">لا توجد ألوان مسجلة.</div>`;
    }

    const mainImg = resolveImageUrl(model.model_images?.[0]?.image_url);

    return model.model_inventory.map(inv => {
        const dbAvailable = inv.available_series || 0;
        const ownedQty = getOwnedQtyForColor(model.id, inv.color_id);
        const available = dbAvailable + ownedQty;
        const isOut = available === 0;
        
        if (!isWorker) {
            return `<div class="flex justify-between items-center p-2.5 bg-devo-black border border-devo-gray rounded-xl mb-1.5 transition-all"><span class="text-white text-xs sm:text-sm font-bold">${inv.colors?.name}</span><span class="${isOut ? 'text-devo-error' : 'text-devo-success'} text-xs font-bold">${isOut ? 'غير متوفر' : 'متوفر'}</span></div>`;
        }

        const cartQty = getCartQtyForColor(model.id, inv.color_id);
        const displayAvailable = Math.max(0, available - cartQty);
        const isDisplayOut = displayAvailable === 0;

        const cartBadge = cartQty > 0
            ? `<span class="inline-flex items-center gap-0.5 text-[10px] font-black text-devo-orange bg-devo-orange/15 border border-devo-orange/40 px-1.5 py-0.5 rounded-md whitespace-nowrap"><i class="ph ph-shopping-cart-simple text-[10px]"></i>${cartQty} في السلة</span>`
            : '';

        return `
        <div class="flex items-center justify-between p-2 sm:p-2.5 bg-devo-black border ${isDisplayOut && !isOut ? 'border-devo-orange/30' : isOut ? 'border-devo-error/30 opacity-70' : 'border-devo-gray'} rounded-xl mb-1.5 gap-2 transition-all duration-300">
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="w-2.5 h-2.5 rounded-full shrink-0 ${isOut ? 'bg-devo-error' : isDisplayOut ? 'bg-devo-orange' : 'bg-devo-success'}"></span>
                <div class="flex items-center gap-1.5 flex-wrap min-w-0">
                    <span class="text-white font-bold text-xs sm:text-sm truncate">${inv.colors?.name}</span>
                    <span class="text-[10px] sm:text-xs ${isOut ? 'text-devo-error' : isDisplayOut ? 'text-devo-orange' : 'text-devo-muted'} font-mono whitespace-nowrap">${isOut ? '(نفذت)' : `(متبقي ${displayAvailable})`}</span>
                    ${cartBadge}
                </div>
            </div>
            ${isOut ? `<span class="text-[11px] font-bold text-devo-error px-2 py-1 bg-devo-error/10 border border-devo-error/20 rounded-lg shrink-0">غير متوفر</span>` : isDisplayOut ? `<span class="text-[11px] font-bold text-devo-orange px-2 py-1 bg-devo-orange/10 border border-devo-orange/20 rounded-lg shrink-0">مضافة كلها</span>` : `
                <div class="flex items-center gap-1.5 shrink-0">
                    <div class="flex items-center bg-devo-dark border border-devo-gray rounded-lg overflow-hidden h-8 sm:h-9">
                        <button onclick="decrementQty('qty-${inv.color_id}')" class="px-2 text-white hover:text-devo-orange transition-colors"><i class="ph ph-minus text-xs"></i></button>
                        <input type="number" id="qty-${inv.color_id}" value="1" min="1" max="${displayAvailable}" readonly class="w-8 sm:w-10 bg-transparent text-center text-white text-xs sm:text-sm font-bold outline-none border-x border-devo-gray appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none leading-none">
                        <button onclick="incrementQty('qty-${inv.color_id}', ${displayAvailable})" class="px-2 text-white hover:text-devo-orange transition-colors"><i class="ph ph-plus text-xs"></i></button>
                    </div>
                    <button onclick="addToCart(event, '${model.id}', '${inv.color_id}', '${model.name.replace(/'/g, "\\'")}', '${inv.colors?.name}', ${model.price}, '${mainImg}', ${dbAvailable}, ${sizesCount}, '${model.factory_code || model.system_code}')" class="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-devo-orange hover:bg-devo-orangeHover text-white rounded-lg text-xs sm:text-sm font-bold transition-all shadow-md flex justify-center items-center gap-1 active:scale-95">
                        <i class="ph ph-shopping-cart-simple text-sm sm:text-base"></i> <span class="hidden xs:inline">إضافة</span>
                    </button>
                </div>
            `}
        </div>`;
    }).join('');
}

window.closeModelViewer = (skipHistory = false) => {
    const modal = document.getElementById('model-viewer-modal');
    if (!modal || modal.classList.contains('hidden') || modal.classList.contains('opacity-0')) return;

    modal.classList.add('opacity-0');

    if (!skipHistory) {
        if (history.state && history.state.modelId) {
            history.back();
        } else {
            history.replaceState(null, '', window.location.pathname);
        }
    }

    setTimeout(() => {
        modal.classList.add('hidden');
        modal.removeAttribute('data-current-model-id');
        if (typeof window.onModelViewerClosed === 'function') {
            window.onModelViewerClosed();
        }
    }, 300);
};

window.shareModel = async (id) => {
    const url = `${window.location.origin}${window.location.pathname}?model=${id}`;
    try {
        await navigator.clipboard.writeText(url);
        showToast('تم نسخ الرابط! يمكنك مشاركته الآن.', 'success');
    } catch (err) {
        showToast('حدث خطأ أثناء نسخ الرابط', 'error');
    }
};

// ==========================================
// 🌟 5. أوامر السلة والكميات (مع حماية الضغط المتكرر) 🌟
// ==========================================
window.incrementQty = (inputId, max) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    let val = parseInt(input.value) || 1;
    if (val < max) input.value = val + 1;
};

window.decrementQty = (inputId) => {
    const input = document.getElementById(inputId);
    if (!input) return;
    let val = parseInt(input.value) || 1;
    if (val > 1) input.value = val - 1;
};

window.addSetToCart = (event, modelId) => {
    const btn = event?.currentTarget || event?.target;
    if (btn) {
        if (btn.dataset.locked === "true") return; // 🛡️ حماية ضد الضغط المتكرر
        btn.dataset.locked = "true";
        btn.disabled = true;
    }

    const model = allModels.find(m => m.id === modelId);
    if (!model || !model.model_inventory || model.model_inventory.length === 0) {
        if (btn) { btn.disabled = false; delete btn.dataset.locked; }
        return showToast('لا توجد ألوان متاحة لهذا الموديل!', 'error');
    }

    const setQtyInput = document.getElementById(`set-qty-${modelId}`);
    const setCount = parseInt(setQtyInput?.value) || 1;

    loadLocalCart();

    const mainImg = resolveImageUrl(model.model_images?.[0]?.image_url);
    const classSizes = model.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1);
    const factoryCode = model.factory_code || model.system_code;

    let addedColorsCount = 0;
    let totalSeriesAdded = 0;
    let skippedColors = [];

    model.model_inventory.forEach(inv => {
        const dbAvailable = inv.available_series || 0;
        const ownedQty = getOwnedQtyForColor(model.id, inv.color_id);
        const trueAvailable = dbAvailable + ownedQty;

        if (trueAvailable <= 0) {
            skippedColors.push(inv.colors?.name || 'لون');
            return;
        }

        const existingIndex = localCart.findIndex(i => i.modelId === model.id && i.colorId === inv.color_id);
        const currentQty = existingIndex > -1 ? localCart[existingIndex].qty : 0;
        
        const spaceLeft = trueAvailable - currentQty;
        if (spaceLeft <= 0) {
            skippedColors.push(inv.colors?.name || 'لون');
            return;
        }

        const qtyToAdd = Math.min(setCount, spaceLeft);

        if (existingIndex > -1) {
            localCart[existingIndex].qty += qtyToAdd;
        } else {
            localCart.push({
                modelId: model.id,
                colorId: inv.color_id,
                modelName: model.name,
                colorName: inv.colors?.name,
                price: model.price,
                image: mainImg,
                qty: qtyToAdd,
                sizesCount: sizesCount,
                factoryCode: factoryCode
            });
        }
        addedColorsCount++;
        totalSeriesAdded += qtyToAdd;
    });

    if (addedColorsCount === 0) {
        showToast('جميع الألوان المتاحة نفذت كميتها أو مضافة بالفعل بأقصى حد بالسلة!', 'error');
    } else {
        saveLocalCart();
        if (window.refreshCartView) window.refreshCartView();
        refreshColorsContainer(modelId);

        let msg = `تم إضافة ${setCount} طقم (${addedColorsCount} لون) للسلة بنجاح!`;
        if (skippedColors.length > 0) {
            msg += ` (تم تجاوز ${skippedColors.length} لون لنفاذ الكمية)`;
        }
        showToast(msg, 'success');
    }

    if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="ph ph-check text-base"></i> تمت إضافة الطقم`;
        btn.classList.replace('from-devo-orange', 'from-devo-success');
        btn.classList.replace('to-orange-600', 'to-green-600');
        
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.replace('from-devo-success', 'from-devo-orange');
            btn.classList.replace('to-green-600', 'to-orange-600');
            btn.disabled = false;
            delete btn.dataset.locked;
        }, 1000);
    }
};

window.addToCart = (event, modelId, colorId, modelName, colorName, price, image, maxAvailable, sizesCount, factoryCode) => {
    const btn = event?.currentTarget || event?.target;
    if (btn) {
        if (btn.dataset.locked === "true") return; // 🛡️ حماية ضد الضغط المتكرر
        btn.dataset.locked = "true";
        btn.disabled = true;
    }

    const unlockBtn = () => {
        if (btn) {
            btn.disabled = false;
            delete btn.dataset.locked;
        }
    };

    const qtyInput = document.getElementById(`qty-${colorId}`);
    const qty = parseInt(qtyInput?.value) || 1;

    // 🌟 قراءة أحدث سلة من localStorage مباشرة لمنع مسح أصناف الفاتورة عند التعديل 🌟
    loadLocalCart();

    const ownedQty = getOwnedQtyForColor(modelId, colorId);
    const trueAvailable = maxAvailable + ownedQty;

    if (qty > trueAvailable) {
        unlockBtn();
        return showToast('الكمية المطلوبة تتجاوز المتاح لك في المخزن!', 'error');
    }

    const existingIndex = localCart.findIndex(i => i.modelId === modelId && i.colorId === colorId);
    
    if (existingIndex > -1) {
        if (localCart[existingIndex].qty + qty > trueAvailable) {
            unlockBtn();
            return showToast('إجمالي الكمية المطلوبة في السلة تتجاوز المتاح لك!', 'error');
        }
        localCart[existingIndex].qty += qty;
    } else {
        localCart.push({ modelId, colorId, modelName, colorName, price, image, qty, sizesCount, factoryCode });
    }

    saveLocalCart();
    if (window.refreshCartView) window.refreshCartView();
    refreshColorsContainer(modelId);

    if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="ph ph-check text-base"></i> تمت الإضافة`;
        btn.classList.replace('bg-devo-orange', 'bg-devo-success');
        btn.classList.replace('hover:bg-devo-orangeHover', 'hover:bg-green-600');
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.replace('bg-devo-success', 'bg-devo-orange');
            btn.classList.replace('hover:bg-green-600', 'hover:bg-devo-orangeHover');
            unlockBtn();
        }, 1000);
    } else {
        unlockBtn();
    }
    showToast(`تم إضافة الموديل للسلة`, 'success');
};

function loadLocalCart() {
    const saved = localStorage.getItem('devo_cart');
    if (saved) {
        try { localCart = JSON.parse(saved); } catch(e) { localCart = []; }
    } else {
        localCart = [];
    }
    updateFloatingCart();
}

function saveLocalCart() {
    localStorage.setItem('devo_cart', JSON.stringify(localCart));
    updateFloatingCart();
}

function updateFloatingCart() {
    const countEl = document.getElementById('floating-cart-count');
    if (!countEl) return;
    const totalItems = localCart.reduce((sum, item) => sum + item.qty, 0);
    countEl.textContent = totalItems;
    if (totalItems > 0) {
        countEl.parentElement?.parentElement?.classList.add('animate-bounce');
        setTimeout(() => countEl.parentElement?.parentElement?.classList.remove('animate-bounce'), 1000);
    }
}

export function findModelByCode(code, matchType = 'both') {
    if (!code) return null;
    let rawStr = code.trim();
    let cleanCode = rawStr.toLowerCase();
    let explicitType = null; // 'system' | 'factory' | null

    // 1. Support URL query parameter parsing if scanner reads a direct link (e.g. ?system=1024 or ?factory=XYZ or ?code=SYS-101)
    if (cleanCode.includes('?') || cleanCode.includes('=')) {
        try {
            const urlObj = new URL(cleanCode.startsWith('http') ? cleanCode : `http://dummy.com/${cleanCode.startsWith('?') ? '' : '?'}${cleanCode}`);
            if (urlObj.searchParams.has('system')) {
                explicitType = 'system';
                cleanCode = urlObj.searchParams.get('system').toLowerCase();
            } else if (urlObj.searchParams.has('factory')) {
                explicitType = 'factory';
                cleanCode = urlObj.searchParams.get('factory').toLowerCase();
            } else if (urlObj.searchParams.has('code')) {
                cleanCode = urlObj.searchParams.get('code').toLowerCase();
            } else if (urlObj.searchParams.has('model') || urlObj.searchParams.has('id')) {
                cleanCode = (urlObj.searchParams.get('model') || urlObj.searchParams.get('id')).toLowerCase();
            }
        } catch(e) {
            // fallback if URL parsing fails
        }
    }

    cleanCode = cleanCode.replace(/^["']|["']$/g, '').trim();

    // 2. Check for explicit prefix in the code string (S5000 vs F5000, as well as legacy SYS- / FAC-)
    if (!explicitType) {
        if (/^(sys-|system-|s-)/i.test(cleanCode)) {
            explicitType = 'system';
            cleanCode = cleanCode.replace(/^(sys-|system-|s-)/i, '');
        } else if (/^(fac-|factory-|f-)/i.test(cleanCode)) {
            explicitType = 'factory';
            cleanCode = cleanCode.replace(/^(fac-|factory-|f-)/i, '');
        } else if (/^s[0-9a-z_]+/i.test(cleanCode)) {
            explicitType = 'system';
            cleanCode = cleanCode.substring(1);
        } else if (/^f[0-9a-z_]+/i.test(cleanCode)) {
            explicitType = 'factory';
            cleanCode = cleanCode.substring(1);
        }
    }

    // 3. Match against allModels based on explicitType
    return allModels.find(m => {
        const sysCode = m.system_code ? m.system_code.toString().toLowerCase() : '';
        const facCode = m.factory_code ? m.factory_code.toString().toLowerCase() : '';
        const modelId = m.id ? m.id.toString().toLowerCase() : '';

        if (explicitType === 'system') {
            return sysCode === cleanCode || modelId === cleanCode;
        } else if (explicitType === 'factory') {
            return facCode === cleanCode;
        } else {
            // Legacy / Unprefixed barcode fallback (Backward compatible with all existing printed barcodes)
            const isSystemMatch = sysCode && sysCode === cleanCode;
            const isFactoryMatch = facCode && facCode === cleanCode;
            const isIdMatch = modelId && modelId === cleanCode;

            if (matchType === 'system') {
                return isSystemMatch || isFactoryMatch || isIdMatch;
            } else if (matchType === 'factory') {
                return isFactoryMatch || isSystemMatch || isIdMatch;
            } else {
                return isFactoryMatch || isSystemMatch || isIdMatch;
            }
        }
    });
}