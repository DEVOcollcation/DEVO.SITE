import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

let isInitialized = false;
let allModels = [];
let defCache = { cats: [], clss: [], szs: [], clrs: [] };
let currentPage = 1;
const itemsPerPage = 50; 
let currentFilteredModels = [];

let currentOpenModelId = null;
let currentModelMovements = [];

export async function initModelsView() {
    if (isInitialized) return;
    
    ['model-search', 'filter-category', 'filter-class', 'filter-stock', 'filter-stock-op', 'filter-stock-qty', 'filter-date-from', 'filter-date-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', applyFilters);
            el.addEventListener('change', applyFilters);
        }
    });

    const stockOp = document.getElementById('filter-stock-op');
    const stockQty = document.getElementById('filter-stock-qty');
    if (stockOp && stockQty) {
        stockOp.addEventListener('change', () => {
            if (stockOp.value) {
                stockQty.classList.remove('hidden');
                // Force wrapper to sync if needed, though Tailwind controls it
            } else {
                stockQty.classList.add('hidden');
                stockQty.value = '';
            }
            applyFilters();
        });
    }
    
    document.getElementById('model-form')?.addEventListener('submit', handleSaveModel);
    document.getElementById('add-stock-form')?.addEventListener('submit', handleAddStockSubmit);
    
    document.getElementById('m-status')?.addEventListener('change', (e) => {
        document.getElementById('m-status-text').textContent = e.target.checked ? 'نشط' : 'معطل';
    });

    await loadDefinitionsCache();
    await fetchAllModelsChunked(); 
    setupAdminRealtimeTracker(); 

    const urlParams = new URLSearchParams(window.location.search);
    const adminModelId = urlParams.get('admin_model');
    if (adminModelId) {
        setTimeout(() => { window.viewDetails(adminModelId); }, 500);
    }

    isInitialized = true;
}

// ==========================================
// 🌟 1. البيانات الأساسية 🌟
// ==========================================
async function loadDefinitionsCache() {
    const [cats, clss, szs, clrs] = await Promise.all([
        supabase.from('categories').select('id, name'),
        supabase.from('classes').select('id, name, class_sizes(size_id, sizes(id, name))'),
        supabase.from('sizes').select('id, name'),
        supabase.from('colors').select('id, name')
    ]);
    defCache = { cats: cats.data, clss: clss.data, szs: szs.data, clrs: clrs.data };
    
    document.getElementById('filter-category').innerHTML += defCache.cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('filter-class').innerHTML += defCache.clss.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function fetchAllModelsChunked() {
    const container = document.getElementById('models-container');
    if(container) container.innerHTML = `<div class="col-span-full py-20 text-center"><i class="ph ph-spinner animate-spin text-4xl text-devo-orange"></i><p class="mt-2 text-devo-muted">جاري تحميل قاعدة بيانات الموديلات...</p></div>`;

    let allFetchedData = [];
    let from = 0;
    const step = 999;
    let hasMore = true;

    try {
        while (hasMore) {
            const { data, error } = await supabase
                .from('models')
                .select(`*, categories(id, name), classes(id, name, class_sizes(sizes(id, name))), model_sizes(sizes(id, name)), model_inventory(color_id, available_series, colors(id, name, color_code)), model_images(image_url)`)
                .order('created_at', { ascending: false })
                .range(from, from + step);

            if (error) throw error;

            if (data.length > 0) {
                allFetchedData = [...allFetchedData, ...data];
                from += step + 1;
            }
            if (data.length <= step) hasMore = false;
        }

        allModels = allFetchedData;
        updateAdminStats();
        applyFilters();
    } catch (error) {
        console.error("Fetch Models Error:", error);
        showToast('خطأ في تحميل الموديلات', 'error');
    }
}

// ==========================================
// 🌟 2. الرادار اللحظي 🌟
// ==========================================
function setupAdminRealtimeTracker() {
    supabase.channel('admin_models_tracker')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, (payload) => {
            
            if (payload.eventType === 'DELETE') {
                allModels = allModels.filter(m => m.id !== payload.old.id);
                updateAdminStats();
                const card = document.getElementById(`admin-model-card-${payload.old.id}`);
                if (card) {
                    card.classList.add('opacity-0', 'scale-95', 'transition-all');
                    setTimeout(() => card.remove(), 300);
                }
                if (currentOpenModelId === payload.old.id) window.closeDetailsModal();
                return;
            }

            setTimeout(async () => {
                const { data: fullModel } = await supabase
                    .from('models')
                    .select(`*, categories(id, name), classes(id, name, class_sizes(sizes(id, name))), model_sizes(sizes(id, name)), model_inventory(color_id, available_series, colors(id, name, color_code)), model_images(image_url)`)
                    .eq('id', payload.new.id).single();

                if (!fullModel) return;

                if (payload.eventType === 'INSERT') {
                    if (!allModels.find(m => m.id === fullModel.id)) {
                        allModels.unshift(fullModel);
                        updateAdminStats();
                        applyFilters(); 
                    }
                } else if (payload.eventType === 'UPDATE') {
                    const index = allModels.findIndex(m => m.id === fullModel.id);
                    if (index > -1) {
                        allModels[index] = fullModel;
                        updateAdminStats();
                        const card = document.getElementById(`admin-model-card-${fullModel.id}`);
                        if (card) card.outerHTML = generateModelCardHTML(fullModel);
                        
                        if (currentOpenModelId === fullModel.id) updateLiveModalInventory(fullModel);
                    }
                }
            }, 800);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'model_inventory' }, (payload) => {
            const mIndex = allModels.findIndex(m => m.id === payload.new.model_id);
            if (mIndex > -1) {
                const iIndex = allModels[mIndex].model_inventory.findIndex(i => i.color_id === payload.new.color_id);
                if (iIndex > -1) {
                    allModels[mIndex].model_inventory[iIndex].available_series = payload.new.available_series;
                    updateAdminStats(); 
                    
                    const card = document.getElementById(`admin-model-card-${payload.new.model_id}`);
                    if (card) card.outerHTML = generateModelCardHTML(allModels[mIndex]);

                    if (currentOpenModelId === payload.new.model_id) updateLiveModalInventory(allModels[mIndex]);
                }
            }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_movements' }, async (payload) => {
            if (currentOpenModelId === payload.new.model_id) {
                const { data: colorData } = await supabase.from('colors').select('name').eq('id', payload.new.color_id).single();
                payload.new.colors = { name: colorData?.name || 'غير معروف' };
                currentModelMovements.unshift(payload.new);
                currentModelMovements = cleanUpMovements(currentModelMovements); // تطبيق التنظيف لحظياً
                window.applyHistoryFilters(); 
            }
        })
        .subscribe();
}

function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return './src/assets/icons/devo.jpeg';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w400`;
        }
    } catch (e) {}
    return url; 
}

// ==========================================
// 🌟 3. الفلاتر والرسم 🌟
// ==========================================
function updateAdminStats() {
    let active = 0, outOfStock = 0, totalSeries = 0;
    
    allModels.forEach(m => {
        if (m.is_active) active++;
        let mTotalQty = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
        if (mTotalQty === 0) outOfStock++;
        totalSeries += mTotalQty;
    });

    document.getElementById('stat-total').textContent = allModels.length;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-out').textContent = outOfStock;
    document.getElementById('stat-series').textContent = totalSeries;
}

window.clearModelFilters = () => {
    ['model-search', 'filter-category', 'filter-class', 'filter-stock', 'filter-stock-op', 'filter-stock-qty', 'filter-date-from', 'filter-date-to'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.value = '';
    });
    const stockQty = document.getElementById('filter-stock-qty');
    if (stockQty) stockQty.classList.add('hidden');
    applyFilters(); 
};

function applyFilters() {
    const term = document.getElementById('model-search')?.value.toLowerCase() || '';
    const catId = document.getElementById('filter-category')?.value || '';
    const classId = document.getElementById('filter-class')?.value || '';
    const stockStatus = document.getElementById('filter-stock')?.value || '';
    const stockOp = document.getElementById('filter-stock-op')?.value || '';
    const stockQtyVal = parseInt(document.getElementById('filter-stock-qty')?.value, 10);
    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo = document.getElementById('filter-date-to')?.value;

    currentFilteredModels = allModels.filter(m => {
        let isMatch = true;
        const totalQty = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;

        if (term && !m.factory_code?.toLowerCase().includes(term) && !m.name?.toLowerCase().includes(term)) isMatch = false;
        if (catId && m.category_id !== catId) isMatch = false;
        if (classId && m.class_id !== classId) isMatch = false;
        if (stockStatus === 'in_stock' && totalQty === 0) isMatch = false;
        if (stockStatus === 'out_stock' && totalQty > 0) isMatch = false;

        // Stock quantity filter
        if (stockOp && !isNaN(stockQtyVal)) {
            if (stockOp === 'less' && totalQty >= stockQtyVal) isMatch = false;
            if (stockOp === 'greater' && totalQty <= stockQtyVal) isMatch = false;
            if (stockOp === 'equal' && totalQty !== stockQtyVal) isMatch = false;
        }

        if (dateFrom || dateTo) {
            const modelDate = new Date(m.created_at);
            modelDate.setHours(0, 0, 0, 0);
            if (dateFrom) { const fDate = new Date(dateFrom); fDate.setHours(0, 0, 0, 0); if (modelDate < fDate) isMatch = false; }
            if (dateTo) { const tDate = new Date(dateTo); tDate.setHours(23, 59, 59, 999); if (modelDate > tDate) isMatch = false; }
        }
        return isMatch;
    });
    
    currentPage = 1; 
    renderModelsPage();
}

function renderModelsPage() {
    const container = document.getElementById('models-container');
    const topContainer = document.getElementById('models-pagination-top');
    const bottomContainer = document.getElementById('models-pagination-bottom');
    
    if (currentFilteredModels.length === 0) {
        container.innerHTML = `<div class="col-span-full py-10 text-center text-devo-muted">لا توجد موديلات مسجلة حالياً تطابق بحثك</div>`;
        if(topContainer) topContainer.innerHTML = '';
        if(bottomContainer) bottomContainer.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(currentFilteredModels.length / itemsPerPage);
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * itemsPerPage;
    const pageData = currentFilteredModels.slice(startIndex, startIndex + itemsPerPage);

    container.innerHTML = pageData.map(m => generateModelCardHTML(m)).join('');
    renderPaginationControls(totalPages);
}

function generateModelCardHTML(m) {
    const totalSeries = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
    const classSizes = m.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (m.model_sizes?.length || 1); 
    const totalPieces = totalSeries * sizesCount; 
    const isOut = totalSeries === 0;
    const mainImg = resolveImageUrl(m.model_images?.[0]?.image_url); 
    
    const cardClass = isOut ? 'grayscale opacity-75 border-devo-gray' : 'hover:border-devo-orange/50';
    const badgeHTML = isOut 
        ? `<span class="bg-devo-error text-white text-xs px-2 py-1 rounded shadow-md">نفذت الكمية</span>`
        : `<span class="bg-devo-success text-white text-xs px-2 py-1 rounded shadow-md">متوفر</span>`;

    return `
    <div id="admin-model-card-${m.id}" class="bg-devo-dark border border-devo-gray rounded-2xl transition-all duration-300 flex flex-col ${cardClass}">
        <div class="h-48 bg-devo-black relative flex items-center justify-center overflow-hidden rounded-t-2xl">
            <img src="${mainImg}" class="w-full h-full object-cover transition-transform hover:scale-110" onerror="this.src='./src/assets/icons/devo.jpeg'">
            <div class="absolute top-3 right-3 z-10">${badgeHTML}</div>
            ${!m.is_active ? `<div class="absolute top-3 left-3 bg-devo-gray text-white text-xs px-2 py-1 rounded shadow-md z-10">معطل</div>` : ''}
        </div>
        <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
            <div>
                <p class="text-devo-muted text-[10px] font-bold tracking-wider mb-1">${m.factory_code || m.system_code}</p>
                <h4 class="text-white font-bold truncate text-sm" title="${m.name}">${m.name}</h4>
                <p class="text-devo-orange text-sm font-black mt-1">${m.price} <span class="text-[10px] font-normal">ج.م</span></p>
            </div>
            <div class="text-xs text-devo-muted border-t border-devo-gray pt-2">
                <span class="block mb-1"><i class="ph ph-tag"></i> ${m.categories?.name || '-'}</span>
                <span class="block ${isOut ? 'text-devo-error' : 'text-devo-info'} font-bold">
                    المتاح: ${totalSeries} سيريه <span class="font-normal text-devo-muted">(${totalPieces} قطعة)</span>
                </span>
            </div>
            <div class="grid grid-cols-3 gap-2 pt-2">
                <button onclick="viewDetails('${m.id}')" class="col-span-1 py-1.5 bg-devo-black hover:bg-devo-gray text-white rounded text-xs transition-colors" title="التفاصيل والحركات"><i class="ph ph-eye"></i> عرض</button>
                <button onclick="openModelModal('${m.id}')" class="col-span-1 py-1.5 bg-devo-info/10 hover:bg-devo-info text-devo-info hover:text-white rounded text-xs transition-colors" title="تعديل الموديل"><i class="ph ph-pencil"></i> تعديل</button>
                <button onclick="handleDeleteModel('${m.id}')" class="col-span-1 py-1.5 bg-devo-error/10 hover:bg-devo-error text-devo-error hover:text-white rounded text-xs transition-colors" title="حذف الموديل"><i class="ph ph-trash"></i> حذف</button>
            </div>
        </div>
    </div>`;
}

function renderPaginationControls(totalPages) {
    const topContainer = document.getElementById('models-pagination-top');
    const bottomContainer = document.getElementById('models-pagination-bottom');
    if (!topContainer || !bottomContainer) return;

    if (totalPages <= 1) {
        topContainer.innerHTML = ''; bottomContainer.innerHTML = '';
        return;
    }

    let html = `
        <button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} class="px-4 py-2 rounded-lg border border-devo-gray bg-devo-black text-white hover:bg-devo-gray transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"><i class="ph ph-caret-right"></i> السابق</button>
        <span class="px-6 py-2 rounded-lg bg-devo-dark text-devo-orange font-bold border border-devo-gray">صفحة ${currentPage} من ${totalPages}</span>
        <button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} class="px-4 py-2 rounded-lg border border-devo-gray bg-devo-black text-white hover:bg-devo-gray transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">التالي <i class="ph ph-caret-left"></i></button>
    `;
    topContainer.innerHTML = html; bottomContainer.innerHTML = html;
}

window.changePage = (newPage) => {
    currentPage = newPage;
    renderModelsPage();
    document.getElementById('model-search')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

window.refreshModelsData = async () => {
    const icon = document.getElementById('refresh-icon');
    if (icon) icon.classList.add('animate-spin');
    await fetchAllModelsChunked();
    if (icon) icon.classList.remove('animate-spin');
    showToast('تم تحديث البيانات', 'success');
};


// ==========================================
// 🌟 4. النافذة التفصيلية وفلاتر الحركات الذكية 🌟
// ==========================================

// 💡 خوارزمية تنظيف السجل (لإخفاء الحركات الوهمية التي يسببها تعديل الأوردرات) 💡
function cleanUpMovements(movements) {
    let cleaned = [];
    let skipIndices = new Set();

    for (let i = 0; i < movements.length; i++) {
        if (skipIndices.has(i)) continue;
        let m1 = movements[i];
        let foundPair = false;

        // البحث في الحركات اللاحقة عن حركة عكسية لنفس اللون والكمية في غضون 5 ثواني
        for (let j = i + 1; j < Math.min(i + 8, movements.length); j++) {
            if (skipIndices.has(j)) continue;
            let m2 = movements[j];
            
            const timeDiff = Math.abs(new Date(m1.created_at) - new Date(m2.created_at));
            if (m1.color_id === m2.color_id && m1.quantity === m2.quantity && m1.movement_type !== m2.movement_type && timeDiff < 5000) {
                skipIndices.add(j); // تخطي الحركة العكسية
                foundPair = true; // تم العثور على زوج وهمي، لا تضيفه
                break;
            }
        }
        if (!foundPair) cleaned.push(m1);
    }
    return cleaned;
}

window.viewDetails = async (id) => {
    const model = allModels.find(m => m.id === id);
    if (!model) return;

    currentOpenModelId = id;
    history.pushState(null, '', `?admin_model=${id}`); 

    const modal = document.getElementById('view-details-modal');
    const content = document.getElementById('details-content');
    
    content.innerHTML = `<div class="py-20 text-center"><i class="ph ph-spinner animate-spin text-4xl text-devo-orange"></i><p class="mt-2 text-devo-muted">جاري تحميل السجل الزمني...</p></div>`;
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);

    // 🌟 استدعاء آمن: محاولة جلب اسم العميل من جدول orders إذا كان متاحاً 🌟
    let fetchedMovements = [];
    const { data: mData, error: mError } = await supabase
        .from('stock_movements')
        .select('*, colors(name), orders(customer_name)')
        .eq('model_id', id)
        .order('created_at', { ascending: false });

    if (mError) {
        // في حالة عدم وجود علاقة (Foreign Key) مباشرة في الداتا بيز
        const fallback = await supabase.from('stock_movements').select('*, colors(name)').eq('model_id', id).order('created_at', { ascending: false });
        fetchedMovements = fallback.data || [];
    } else {
        fetchedMovements = mData || [];
    }

    // 🌟 تطبيق خوارزمية تنظيف السجل 🌟
    currentModelMovements = cleanUpMovements(fetchedMovements);

    const classSizes = model.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1); 

    let imagesHtml = '';
    if (model.model_images && model.model_images.length > 0) {
        imagesHtml = `<div class="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
            ${model.model_images.map(img => `<img src="${resolveImageUrl(img.image_url)}" class="h-40 w-40 flex-shrink-0 rounded-xl object-cover border border-devo-gray bg-devo-black shadow-sm" onerror="this.src='./src/assets/icons/devo.jpeg'">`).join('')}
        </div>`;
    } else {
        imagesHtml = `<div class="h-40 w-40 rounded-xl bg-devo-black border border-devo-gray flex items-center justify-center overflow-hidden shadow-sm"><img src="./src/assets/icons/devo.jpeg" class="w-full h-full object-cover"></div>`;
    }

    const renderSizesTags = classSizes.length > 0 
        ? classSizes.map(cs => `<span class="bg-devo-black border border-devo-gray px-3 py-1 rounded text-white text-xs shadow-sm"><i class="ph ph-link text-devo-muted"></i> ${cs.sizes?.name}</span>`).join('')
        : model.model_sizes?.map(s => `<span class="bg-devo-black border border-devo-gray px-3 py-1 rounded text-white text-xs shadow-sm">${s.sizes?.name}</span>`).join('');

    content.innerHTML = `
        <div class="flex justify-between items-start mb-6">
            <div class="max-w-[70%]">${imagesHtml}</div>
            <button onclick="shareAdminModel('${model.id}')" class="bg-devo-dark hover:bg-devo-gray border border-devo-gray text-white px-4 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2">
                <i class="ph ph-share-network text-base"></i> نسخ رابط الموديل
            </button>
        </div>

        <div class="bg-devo-black/30 rounded-xl border border-devo-gray overflow-hidden mb-6">
            <table class="w-full text-right text-sm">
                <tbody class="divide-y divide-devo-gray">
                    <tr><td class="p-3 text-devo-muted w-1/3">كود السيستم / المصنع</td><td class="p-3 text-white font-mono">${model.system_code} <span class="text-devo-muted">|</span> ${model.factory_code}</td></tr>
                    <tr><td class="p-3 text-devo-muted">اسم الموديل</td><td class="p-3 text-white font-bold">${model.name}</td></tr>
                    <tr><td class="p-3 text-devo-muted">السعر</td><td class="p-3 text-devo-orange font-bold">${model.price} ج.م</td></tr>
                </tbody>
            </table>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div>
                <h4 class="text-devo-orange font-bold mb-3 text-sm flex items-center gap-2"><i class="ph ph-ruler"></i> المقاسات المتاحة (${sizesCount} مقاسات)</h4>
                <div class="flex flex-wrap gap-2">${renderSizesTags || '<span class="text-devo-muted text-xs">لا توجد مقاسات</span>'}</div>
            </div>
            <div>
                <div class="flex justify-between items-center mb-3">
                    <h4 class="text-devo-orange font-bold text-sm flex items-center gap-2"><i class="ph ph-palette"></i> مخزون الألوان</h4>
                    <button onclick="openAddStockModal('${model.id}')" class="text-xs bg-devo-success/10 text-devo-success hover:bg-devo-success hover:text-white px-3 py-1.5 rounded-lg transition-colors font-bold flex items-center gap-1"><i class="ph ph-plus"></i> إضافة شحنة</button>
                </div>
                <div id="live-modal-inventory" class="space-y-2"></div>
            </div>
        </div>

        <div class="border-t border-devo-gray pt-6">
            <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-4 gap-3">
                <h4 class="text-devo-orange font-bold text-sm shrink-0"><i class="ph ph-list-numbers"></i> سجل حركة المخزون</h4>
                
                <div class="w-full flex flex-wrap md:flex-nowrap gap-2 bg-devo-dark p-2 rounded-lg border border-devo-gray">
                    <div class="relative flex-1 min-w-[120px]">
                        <i class="ph ph-magnifying-glass absolute right-2 top-1/2 -translate-y-1/2 text-devo-muted text-xs"></i>
                        <input type="text" id="hist-search" oninput="applyHistoryFilters()" placeholder="العميل أو الفاتورة..." class="w-full bg-devo-black border border-devo-gray rounded px-7 py-1.5 text-white text-xs outline-none focus:border-devo-orange">
                    </div>
                    <select id="hist-type" onchange="applyHistoryFilters()" class="flex-1 min-w-[90px] bg-devo-black border border-devo-gray rounded px-2 py-1.5 text-white text-xs outline-none focus:border-devo-orange cursor-pointer">
                        <option value="">كل العمليات</option><option value="in">وارد (+)</option><option value="out">مبيعات (-)</option>
                    </select>
                    <select id="hist-color" onchange="applyHistoryFilters()" class="flex-1 min-w-[90px] bg-devo-black border border-devo-gray rounded px-2 py-1.5 text-white text-xs outline-none focus:border-devo-orange cursor-pointer">
                        <option value="">كل الألوان</option>
                        ${model.model_inventory.map(i => `<option value="${i.color_id}">${i.colors?.name}</option>`).join('')}
                    </select>
                    <input type="date" id="hist-date" onchange="applyHistoryFilters()" class="flex-1 min-w-[110px] bg-devo-black border border-devo-gray rounded px-2 py-1.5 text-devo-muted text-xs outline-none cursor-pointer">
                </div>
            </div>
            
            <div class="overflow-x-auto border border-devo-gray rounded-lg max-h-64 custom-scrollbar">
                <table class="w-full text-right text-sm">
                    <thead class="bg-devo-black sticky top-0"><tr class="text-devo-muted">
                        <th class="p-3 font-medium border-b border-devo-gray">النوع</th>
                        <th class="p-3 font-medium border-b border-devo-gray">اللون</th>
                        <th class="p-3 font-medium border-b border-devo-gray">الكمية</th>
                        <th class="p-3 font-medium border-b border-devo-gray">العميل / المرجع</th>
                        <th class="p-3 font-medium border-b border-devo-gray">التاريخ</th>
                    </tr></thead>
                    <tbody id="live-modal-history-tbody" class="divide-y divide-devo-gray bg-devo-black/30">
                        </tbody>
                </table>
            </div>
        </div>
    `;

    updateLiveModalInventory(model);
    window.applyHistoryFilters(); 
};

function updateLiveModalInventory(model) {
    const container = document.getElementById('live-modal-inventory');
    if (!container) return;

    const classSizes = model.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1); 

    container.innerHTML = model.model_inventory?.map(inv => `
        <div class="flex justify-between p-3 bg-devo-black rounded-lg border border-devo-gray items-center transition-all duration-300">
            <span class="text-white">${inv.colors?.name}</span>
            <span class="font-bold ${inv.available_series === 0 ? 'text-devo-error' : 'text-devo-orange'}">
                ${inv.available_series} سيريه 
                <span class="text-xs text-devo-muted font-normal">(${inv.available_series * sizesCount} قطعة)</span>
            </span>
        </div>
    `).join('') || '<div class="text-devo-muted text-xs p-3">لا توجد ألوان.</div>';
}

// 🌟 تطبيق فلاتر الحركات (تشمل البحث باسم العميل) 🌟
window.applyHistoryFilters = () => {
    const term = document.getElementById('hist-search')?.value.toLowerCase().trim() || '';
    const type = document.getElementById('hist-type')?.value || '';
    const colorId = document.getElementById('hist-color')?.value || '';
    const dateStr = document.getElementById('hist-date')?.value || '';
    const tbody = document.getElementById('live-modal-history-tbody');
    
    if (!tbody) return;

    const filtered = currentModelMovements.filter(mov => {
        let isMatch = true;
        
        // البحث بالمرجع أو باسم العميل
        const customerRef = (mov.orders?.customer_name || mov.reference || '').toLowerCase();
        if (term && !customerRef.includes(term)) isMatch = false;
        
        if (type && mov.movement_type !== type) isMatch = false;
        if (colorId && mov.color_id !== colorId) isMatch = false;
        if (dateStr) {
            const mDate = new Date(mov.created_at).toISOString().split('T')[0];
            if (mDate !== dateStr) isMatch = false;
        }
        return isMatch;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-devo-muted text-xs">لا توجد حركات مطابقة.</td></tr>`;
        return;
    }

    const model = allModels.find(m => m.id === currentOpenModelId);
    const sizesCount = model?.classes?.class_sizes?.length || model?.model_sizes?.length || 1;

    tbody.innerHTML = filtered.map(mov => {
        const customerName = mov.orders?.customer_name || mov.reference || '---';
        
        return `
        <tr class="hover:bg-devo-black transition-colors">
            <td class="p-3 ${mov.movement_type === 'in' ? 'text-devo-success' : 'text-devo-error'} font-bold text-xs">
                ${mov.movement_type === 'in' ? '<i class="ph ph-arrow-down-left"></i> وارد' : '<i class="ph ph-arrow-up-right"></i> مبيعات'}
            </td>
            <td class="p-3 text-white text-xs">${mov.colors?.name}</td>
            <td class="p-3 text-white font-bold leading-tight text-xs">
                ${mov.quantity} <br>
                <span class="text-[10px] text-devo-muted font-normal">(${mov.quantity * sizesCount} ق)</span>
            </td>
            <td class="p-3 text-white text-xs font-mono" title="${customerName}">${customerName.length > 25 ? customerName.substring(0,25)+'...' : customerName}</td>
            <td class="p-3 text-devo-muted text-[10px]">${new Date(mov.created_at).toLocaleString('ar-EG')}</td>
        </tr>
    `}).join('');
};

window.closeDetailsModal = () => {
    const modal = document.getElementById('view-details-modal');
    modal.classList.add('opacity-0');
    currentOpenModelId = null;
    
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('admin_model');
    const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
    history.pushState(null, '', newUrl);
    
    setTimeout(() => modal.classList.add('hidden'), 300);
};

window.shareAdminModel = async (id) => {
    const url = `${window.location.origin}${window.location.pathname}?admin_model=${id}`;
    try {
        await navigator.clipboard.writeText(url);
        showToast('تم نسخ الرابط! أرسله للإدارة للمراجعة.', 'success');
    } catch (err) {
        showToast('حدث خطأ أثناء نسخ الرابط', 'error');
    }
};

// ==========================================
// 🌟 5. عمليات الإضافة، التعديل، والحذف 🌟
// ==========================================
window.openModelModal = async (id = null) => {
    const form = document.getElementById('model-form');
    form.reset();
    document.getElementById('m-id').value = id || '';
    
    document.getElementById('m-category').innerHTML = defCache.cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('m-class').innerHTML = defCache.clss.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    window.allAvailableColors = defCache.clrs;

    const invContainer = document.getElementById('m-inventory-container');
    const modalTitle = document.getElementById('model-modal-title');
    const submitBtn = form.querySelector('button[type="submit"]');

    const classSelect = document.getElementById('m-class');
    classSelect.onchange = (e) => renderAutoSizes(e.target.value);

    if (id) {
        const model = allModels.find(m => m.id === id);
        if (!model) return;

        modalTitle.innerHTML = `<i class="ph ph-pencil-simple text-devo-orange text-2xl"></i> تعديل الموديل`;
        submitBtn.innerHTML = `حفظ التعديلات`;

        document.getElementById('m-system-code').value = model.system_code;
        document.getElementById('m-factory-code').value = model.factory_code;
        document.getElementById('m-name').value = model.name;
        document.getElementById('m-price').value = model.price;
        document.getElementById('m-category').value = model.category_id;
        document.getElementById('m-class').value = model.class_id;
        document.getElementById('m-status').checked = model.is_active;
        document.getElementById('m-status-text').textContent = model.is_active ? 'نشط' : 'معطل';

        renderAutoSizes(model.class_id);

        invContainer.innerHTML = `<div class="py-4 text-center text-devo-muted"><i class="ph ph-spinner animate-spin text-2xl"></i></div>`;
        const modal = document.getElementById('model-modal');
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);

        const { data: outMovements } = await supabase.from('stock_movements').select('color_id, quantity').eq('model_id', id).eq('movement_type', 'out');
        const soldMap = {};
        outMovements?.forEach(m => { soldMap[m.color_id] = (soldMap[m.color_id] || 0) + m.quantity; });

        invContainer.innerHTML = '';
        model.model_inventory.forEach(inv => {
            const sold = soldMap[inv.color_id] || 0;
            addInventoryRow(inv.color_id, inv.available_series + sold, sold);
        });

        const imgs = model.model_images || [];
        document.getElementById('m-img-1').value = imgs[0]?.image_url || '';
        document.getElementById('m-img-2').value = imgs[1]?.image_url || '';
        document.getElementById('m-img-3').value = imgs[2]?.image_url || '';

    } else {
        modalTitle.innerHTML = `<i class="ph ph-plus-circle text-devo-orange text-2xl"></i> إضافة موديل`;
        submitBtn.innerHTML = `حفظ الموديل`;
        document.getElementById('m-status').checked = true;
        document.getElementById('m-status-text').textContent = 'نشط';
        renderAutoSizes(classSelect.value);
        invContainer.innerHTML = '';
        addInventoryRow();

        const modal = document.getElementById('model-modal');
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
};

function renderAutoSizes(classId) {
    const sizesContainer = document.getElementById('m-sizes-container');
    if (!classId) { sizesContainer.innerHTML = '<span class="text-devo-muted text-xs">يرجى اختيار الفئة...</span>'; return; }
    const selectedClass = defCache.clss.find(c => c.id === classId);
    if (!selectedClass || !selectedClass.class_sizes || selectedClass.class_sizes.length === 0) {
        sizesContainer.innerHTML = '<span class="text-devo-error text-xs p-2 bg-devo-error/10 rounded flex items-center gap-2 border border-devo-error/20"><i class="ph ph-warning-circle text-lg"></i> الفئة خالية من المقاسات.</span>';
        return;
    }
    sizesContainer.innerHTML = selectedClass.class_sizes.map(cs => `<span class="bg-devo-black border border-devo-gray px-3 py-1.5 rounded text-white text-xs shadow-sm flex items-center gap-1 opacity-80"><i class="ph ph-lock-key text-devo-muted"></i> ${cs.sizes.name}</span>`).join('');
}

window.addInventoryRow = (colorId = '', totalQty = '', soldQty = 0) => {
    const container = document.getElementById('m-inventory-container');
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center';
    const isExisting = colorId !== '';
    
    row.innerHTML = `
        <select name="inv-color" ${isExisting ? 'disabled' : ''} class="flex-[2] bg-devo-black border border-devo-gray rounded px-3 py-2 text-white text-xs outline-none focus:border-devo-orange ${isExisting ? 'opacity-70 cursor-not-allowed' : ''}">
            <option value="" disabled ${!isExisting ? 'selected' : ''}>اختر اللون</option>
            ${window.allAvailableColors.map(c => `<option value="${c.id}" ${c.id === colorId ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
        ${isExisting ? `<input type="hidden" name="inv-color-val" value="${colorId}">` : ''}
        <input type="number" name="inv-qty" placeholder="إجمالي السريات" min="${soldQty}" value="${totalQty}" data-sold="${soldQty}" class="flex-1 bg-devo-black border border-devo-gray rounded px-3 py-2 text-white text-xs outline-none focus:border-devo-orange">
        ${isExisting && soldQty > 0 
            ? `<button type="button" onclick="showToast('لا يمكن حذف لون تم السحب منه.', 'warning')" class="p-2 text-devo-grayHover cursor-not-allowed rounded"><i class="ph ph-trash"></i></button>` 
            : `<button type="button" onclick="this.parentElement.remove()" class="p-2 text-devo-error hover:bg-devo-error/20 rounded transition-colors"><i class="ph ph-trash"></i></button>`
        }
    `;
    container.appendChild(row);
};

window.closeModelModal = () => {
    document.getElementById('model-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('model-modal').classList.add('hidden'), 300);
};

async function handleSaveModel(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = btn.innerHTML;
    
    const id = document.getElementById('m-id').value;
    const classId = document.getElementById('m-class').value;
    const selectedClass = defCache.clss.find(c => c.id === classId);
    const hasSizes = selectedClass && selectedClass.class_sizes && selectedClass.class_sizes.length > 0;

    const modelData = {
        system_code: document.getElementById('m-system-code').value,
        factory_code: document.getElementById('m-factory-code').value,
        name: document.getElementById('m-name').value,
        price: document.getElementById('m-price').value,
        category_id: document.getElementById('m-category').value,
        class_id: classId,
        is_active: document.getElementById('m-status').checked
    };

    const invRows = document.querySelectorAll('#m-inventory-container > div');
    const inventoryData = [];
    
    for (const row of invRows) {
        const hiddenColor = row.querySelector('[name="inv-color-val"]');
        const colorSelect = row.querySelector('[name="inv-color"]');
        const colorId = hiddenColor ? hiddenColor.value : (colorSelect ? colorSelect.value : null);
        if (!colorId) continue;

        const totalQty = parseInt(row.querySelector('[name="inv-qty"]').value) || 0;
        const soldQty = parseInt(row.querySelector('[name="inv-qty"]').dataset.sold || "0");
        const available_series = totalQty - soldQty;
        
        if (available_series < 0) return showToast(`لا يمكن تقليل الكمية لأقل من المباع.`, 'error');
        inventoryData.push({ color_id: colorId, available_series });
    }

    const uniqueColors = new Set(inventoryData.map(i => i.color_id));
    if (uniqueColors.size !== inventoryData.length) return showToast('لا يمكن تكرار اللون، يرجى الدمج.', 'warning');

    const images = ['m-img-1', 'm-img-2', 'm-img-3'].map(inputId => document.getElementById(inputId).value.trim()).filter(url => url !== '');

    let statusMessage = '';
    if (!hasSizes || inventoryData.length === 0) {
        modelData.is_active = false;
        statusMessage = ' (محفوظ كـ معطل لعدم اكتمال البيانات)';
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> الحفظ...`;

    try {
        let modelId = id;
        if (id) {
            const { error: updateError } = await supabase.from('models').update(modelData).eq('id', id);
            if (updateError) throw updateError;
            await supabase.from('model_inventory').delete().eq('model_id', id);
            await supabase.from('model_images').delete().eq('model_id', id);
        } else {
            const { data, error: insertError } = await supabase.from('models').insert([modelData]).select().single();
            if (insertError) throw insertError;
            modelId = data.id;
        }

        if (inventoryData.length > 0) await supabase.from('model_inventory').insert(inventoryData.map(inv => ({ ...inv, model_id: modelId })));
        if (images.length > 0) await supabase.from('model_images').insert(images.map(url => ({ model_id: modelId, image_url: url })));

        showToast((id ? 'تم الحفظ' : 'تمت الإضافة') + statusMessage, 'success');
        closeModelModal();
    } catch (err) {
        if (err.code === '23505') showToast('كود السيستم مستخدم بالفعل!', 'error');
        else showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalBtnText;
    }
}

window.handleDeleteModel = async (id) => {
    const confirmed = await confirmDialog({ title: 'حذف الموديل', message: 'تأكيد الحذف النهائي؟', isDestructive: true });
    if (confirmed) {
        await supabase.from('models').delete().eq('id', id);
        showToast('تم الحذف'); 
    }
};

window.openAddStockModal = (modelId) => {
    const model = allModels.find(m => m.id === modelId);
    if (!model) return;
    document.getElementById('add-stock-form').reset();
    document.getElementById('stock-model-id').value = modelId;
    document.getElementById('stock-color').innerHTML = model.model_inventory.map(inv => `<option value="${inv.color_id}">${inv.colors?.name} (متاح: ${inv.available_series})</option>`).join('');
    
    const modal = document.getElementById('add-stock-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeAddStockModal = () => {
    const modal = document.getElementById('add-stock-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

async function handleAddStockSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('stock-save-btn');
    const modelId = document.getElementById('stock-model-id').value;
    const colorId = document.getElementById('stock-color').value;
    const addedQty = parseInt(document.getElementById('stock-qty').value);

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> الحفظ...`;

    try {
        const currentInv = allModels.find(m => m.id === modelId).model_inventory.find(i => i.color_id === colorId);
        const { error: invError } = await supabase.from('model_inventory').update({ available_series: currentInv.available_series + addedQty }).eq('model_id', modelId).eq('color_id', colorId);
        if (invError) throw invError;
        
        const { error: movError } = await supabase.from('stock_movements').insert([{ model_id: modelId, color_id: colorId, movement_type: 'in', quantity: addedQty, reference: 'شحنة يدوية (إدارة)' }]);
        if (movError) throw movError;

        showToast('تمت إضافة الشحنة بنجاح', 'success');
        closeAddStockModal();
    } catch (err) {
        showToast('خطأ أثناء حفظ الشحنة', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span>حفظ الشحنة</span>`;
    }
}

// ==========================================
// 🌟 6. استيراد Excel 🌟
// ==========================================
let pendingExcelModels = [];
let pendingExcelCategories = new Set();

window.openExcelImportModal = () => {
    document.getElementById('excel-step-1').classList.remove('hidden');
    document.getElementById('excel-step-2').classList.add('hidden');
    document.getElementById('excel-file-input').value = '';
    document.getElementById('excel-file-name').textContent = 'اسحب الملف هنا';
    pendingExcelModels = []; pendingExcelCategories.clear();
    const modal = document.getElementById('excel-import-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeExcelImportModal = () => {
    const modal = document.getElementById('excel-import-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

document.getElementById('excel-file-input')?.addEventListener('change', e => document.getElementById('excel-file-name').textContent = e.target.files[0]?.name || 'اسحب الملف هنا');

window.processExcelPreview = async () => {
    const file = document.getElementById('excel-file-input').files[0];
    if (!file) return showToast('الرجاء اختيار ملف', 'warning');
    const btn = document.getElementById('excel-preview-btn');
    btn.disabled = true; btn.innerHTML = `<i class="ph ph-spinner animate-spin text-xl"></i>`;
    try {
        const data = await readExcelFile(file);
        const existingCodes = new Set(allModels.map(m => String(m.system_code)));
        const duplicates = [];
        data.forEach(row => {
            let sysCode = String(row['كود'] || '').trim().replace('.0', '');
            if (!sysCode || sysCode === 'undefined') return;
            if (existingCodes.has(sysCode)) { duplicates.push({ sysCode, modelName: row['الصنف'] }); } 
            else {
                if (row['النوع']) pendingExcelCategories.add(String(row['النوع']).trim());
                const match = String(row['الصنف']||'').trim().match(/(.+?)\s+(\d+)$/);
                pendingExcelModels.push({ system_code: sysCode, factory_code: match ? match[2] : '', name: match ? match[1].trim() : String(row['الصنف']||'').trim(), price: parseFloat(row['بيع 1']) || 0, category_name: row['النوع'] ? String(row['النوع']).trim() : null, is_active: false });
                existingCodes.add(sysCode);
            }
        });
        document.getElementById('excel-new-count').textContent = pendingExcelModels.length;
        document.getElementById('excel-dup-count').textContent = duplicates.length;
        document.getElementById('excel-step-1').classList.add('hidden');
        document.getElementById('excel-step-2').classList.remove('hidden');
    } catch (err) { showToast('خطأ بالقراءة', 'error'); } 
    finally { btn.disabled = false; btn.innerHTML = `<i class="ph ph-magnifying-glass text-xl"></i> تحليل الملف`; }
};

window.executeExcelImport = async () => {
    if (pendingExcelModels.length === 0) return showToast('لا توجد موديلات صالحة', 'warning');
    const btn = document.getElementById('excel-import-btn');
    btn.disabled = true; btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> الحفظ...`;
    try {
        for (const catName of pendingExcelCategories) {
            if (!defCache.cats.find(c => c.name === catName)) {
                const { data } = await supabase.from('categories').insert([{ name: catName }]).select().single();
                if (data) defCache.cats.push(data);
            }
        }
        const modelsToInsert = pendingExcelModels.map(m => ({ ...m, category_id: m.category_name ? defCache.cats.find(c => c.name === m.category_name)?.id : null }));
        for (let i = 0; i < modelsToInsert.length; i += 300) {
            await supabase.from('models').upsert(modelsToInsert.slice(i, i + 300), { onConflict: 'system_code', ignoreDuplicates: true });
        }
        showToast('تم الاستيراد بنجاح', 'success');
        closeExcelImportModal();
    } catch (err) { showToast(err.message, 'error'); } 
    finally { btn.disabled = false; btn.innerHTML = `تأكيد وحفظ`; }
};

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try { resolve(XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(e.target.result), {type: 'array'}).Sheets[XLSX.read(new Uint8Array(e.target.result), {type: 'array'}).SheetNames[0]], { defval: "" })); } 
            catch(err) { reject(err); }
        };
        reader.readAsArrayBuffer(file);
    });
}