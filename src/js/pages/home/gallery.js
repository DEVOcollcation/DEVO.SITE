import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

let allModels = [];
let currentCategories = new Set();
let currentUser = null;
let isWorker = false;
let localCart = []; // سلة المشتريات في المتصفح

export async function initGallery() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    isWorker = currentUser && (currentUser.role === 'worker' || currentUser.role === 'admin' || currentUser.role === 'owner');

    if (isWorker) {
        loadLocalCart();
        document.getElementById('floating-cart-btn').classList.remove('hidden');
    }

    document.getElementById('gal-search')?.addEventListener('input', applyGalleryFilters);
    document.getElementById('gal-category')?.addEventListener('change', applyGalleryFilters);
    document.getElementById('gal-sort')?.addEventListener('change', applyGalleryFilters);

    await fetchGalleryModels();

    supabase
        .channel('public_gallery_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, () => {
            console.log('🔄 تم رصد موديل جديد! جاري تحديث المعرض...');
            fetchGalleryModels(); 
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'model_inventory' }, () => {
            console.log('🔄 تم رصد تغير في المخزون! جاري تحديث المعرض...');
            fetchGalleryModels(); 
        })
        .subscribe();
}

async function fetchGalleryModelsSilent() {
    const { data, error } = await supabase
        .from('models')
        .select(`
            *,
            categories(name),
            model_sizes(sizes(name)),
            model_inventory(color_id, available_series, colors(name)),
            model_images(image_url)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (!error && data) {
        allModels = data; // تحديث الذاكرة المحلية
        applyGalleryFilters(); // إعادة رسم الكروت والأرقام الجديدة
        
        // إذا كان الموظف فاتح نافذة التفاصيل حالياً، قم بتحديثها أيضاً!
        const modal = document.getElementById('model-viewer-modal');
        if (modal && !modal.classList.contains('hidden')) {
            const currentModelId = modal.getAttribute('data-current-model-id');
            if (currentModelId) {
                window.openModelViewer(currentModelId);
            }
        }
    }
}

window.clearGalleryFilters = () => {
    document.getElementById('gal-search').value = '';
    document.getElementById('gal-category').value = '';
    document.getElementById('gal-sort').value = 'newest';
    applyGalleryFilters();
};

// --- جلب ومعالجة البيانات ---
function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return './src/assets/icons/devo.jpeg';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1000`;
        }
    } catch (e) {}
    return url; 
}

async function fetchGalleryModels() {
    const container = document.getElementById('gallery-grid');
    if(!container) return;

    container.innerHTML = `<div class="col-span-full py-20 text-center"><i class="ph ph-spinner animate-spin text-5xl text-devo-orange"></i></div>`;

    const { data, error } = await supabase
        .from('models')
        .select(`
            *,
            categories(name),
            model_sizes(sizes(name)),
            model_inventory(color_id, available_series, colors(name)),
            model_images(image_url)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) {
        container.innerHTML = `<div class="col-span-full text-center text-devo-error font-bold">حدث خطأ أثناء الاتصال بقاعدة البيانات.</div>`;
        return;
    }

    allModels = data;
    
    // استخراج التصنيفات لملء الفلتر
    const catSelect = document.getElementById('gal-category');
    currentCategories.clear();
    allModels.forEach(m => { if(m.categories?.name) currentCategories.add(m.categories.name); });
    
    let catOptions = `<option value="">جميع التصنيفات</option>`;
    currentCategories.forEach(cat => catOptions += `<option value="${cat}">${cat}</option>`);
    if(catSelect) catSelect.innerHTML = catOptions;

    applyGalleryFilters();
}

// --- محرك الفلترة والترتيب ---
function applyGalleryFilters() {
    const term = document.getElementById('gal-search')?.value.toLowerCase().trim() || '';
    const cat = document.getElementById('gal-category')?.value || '';
    const sort = document.getElementById('gal-sort')?.value || 'newest';

    let filtered = allModels.filter(m => {
        let isMatch = true;
        const searchStr = `${m.name} ${m.factory_code} ${m.system_code} ${m.categories?.name}`.toLowerCase();
        
        if (term && !searchStr.includes(term)) isMatch = false;
        if (cat && m.categories?.name !== cat) isMatch = false;
        
        return isMatch;
    });

    // الترتيب
    if (sort === 'price_asc') filtered.sort((a, b) => a.price - b.price);
    else if (sort === 'price_desc') filtered.sort((a, b) => b.price - a.price);
    else filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    renderGallery(filtered);
}

// --- رسم الكروت في المعرض ---
function renderGallery(models) {
    const container = document.getElementById('gallery-grid');
    if (!container) return;

    if (models.length === 0) {
        container.innerHTML = `<div class="col-span-full py-20 text-center text-devo-muted flex flex-col items-center"><i class="ph ph-magnifying-glass text-6xl mb-4 opacity-50"></i><p>لا توجد موديلات تطابق بحثك حالياً.</p></div>`;
        return;
    }

    container.innerHTML = models.map(m => {
        const totalSeries = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
        const isOut = totalSeries === 0;
        const mainImg = resolveImageUrl(m.model_images?.[0]?.image_url);
        
        // هندسة الشارات بناءً على الصلاحية
        let stockBadge = '';
        if (isWorker) {
            if (isOut) stockBadge = `<span class="absolute top-3 right-3 bg-devo-error text-white text-xs px-3 py-1.5 rounded shadow-lg z-10 font-bold flex items-center gap-1"><i class="ph ph-warning-circle"></i> نفذت الكمية</span>`;
            else if (totalSeries <= 5) stockBadge = `<span class="absolute top-3 right-3 bg-devo-orange text-white text-xs px-3 py-1.5 rounded shadow-lg z-10 font-bold">متبقي ${totalSeries} سيريه</span>`;
            else stockBadge = `<span class="absolute top-3 right-3 bg-devo-success text-white text-xs px-3 py-1.5 rounded shadow-lg z-10 font-bold">متبقي ${totalSeries} سيريه</span>`;
        } else {
            // الزائر لا يرى الأرقام
            if (isOut) stockBadge = `<span class="absolute top-3 right-3 bg-devo-black/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded shadow-lg z-10 font-bold border border-devo-gray">نفذت الكمية</span>`;
            else stockBadge = `<span class="absolute top-3 right-3 bg-devo-success/20 text-devo-success backdrop-blur-sm border border-devo-success/50 text-xs px-3 py-1.5 rounded shadow-lg z-10 font-bold">متوفر</span>`;
        }

        const cardStyle = isOut ? 'grayscale opacity-80' : 'card-hover cursor-pointer';

        return `
        <div class="bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden flex flex-col relative group transition-all duration-300 ${cardStyle}" onclick="openModelViewer('${m.id}')">
            ${stockBadge}
            <div class="h-72 bg-devo-black relative overflow-hidden">
                <img src="${mainImg}" class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" onerror="this.src='./src/assets/icons/devo.jpeg'" loading="lazy">
                <div class="absolute inset-0 bg-gradient-to-t from-devo-black via-devo-black/20 to-transparent opacity-90"></div>
            </div>
            <div class="p-5 flex flex-col flex-1 justify-end z-10 -mt-16 relative">
                <p class="text-devo-muted text-[10px] font-mono tracking-wider mb-1">${m.factory_code || m.system_code}</p>
                <h3 class="text-white font-bold text-lg mb-1 truncate" title="${m.name}">${m.name}</h3>
                <div class="flex justify-between items-end mt-2">
                    <span class="text-devo-muted text-xs flex items-center gap-1"><i class="ph ph-tag"></i> ${m.categories?.name || 'بدون تصنيف'}</span>
                    <p class="text-devo-orange font-black text-xl">${m.price} <span class="text-xs font-normal">ج.م</span></p>
                </div>
            </div>
        </div>`;
    }).join('');
}


window.openModelViewer = (id) => {
    const model = allModels.find(m => m.id === id);
    if (!model) return;

    const sizesCount = model.model_sizes?.length || 1;

    const modal = document.getElementById('model-viewer-modal');
    if (modal) modal.setAttribute('data-current-model-id', id);

    const content = document.getElementById('model-viewer-content');
    
    const imgs = model.model_images?.length > 0 ? model.model_images : [{image_url: null}];
    const mainImg = resolveImageUrl(imgs[0].image_url);
    let imagesGalleryHtml = `
        <div class="bg-devo-black rounded-xl overflow-hidden border border-devo-gray h-80 md:h-[400px] mb-3">
            <img src="${mainImg}" id="viewer-main-img" class="w-full h-full object-cover" onerror="this.src='./src/assets/icons/devo.jpeg'">
        </div>
        ${imgs.length > 1 ? `<div class="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">${imgs.map(img => `<img src="${resolveImageUrl(img.image_url)}" onclick="document.getElementById('viewer-main-img').src=this.src" class="w-20 h-20 rounded-lg object-cover cursor-pointer border border-devo-gray hover:border-devo-orange transition-colors shrink-0" onerror="this.src='./src/assets/icons/devo.jpeg'">`).join('')}</div>` : ''}
    `;

    const sizesHtml = model.model_sizes?.map(s => `<span class="bg-devo-gray/30 border border-devo-gray text-white text-xs px-3 py-1.5 rounded font-medium">${s.sizes?.name}</span>`).join('') || '<span class="text-devo-muted text-xs">غير محدد</span>';

    let colorsHtml = '';
    if (model.model_inventory && model.model_inventory.length > 0) {
        colorsHtml = model.model_inventory.map(inv => {
            const available = inv.available_series || 0;
            const isOut = available === 0;
            
            if (!isWorker) {
                return `<div class="flex justify-between items-center p-3 bg-devo-black border border-devo-gray rounded-xl mb-2"><span class="text-white font-bold">${inv.colors?.name}</span><span class="${isOut ? 'text-devo-error' : 'text-devo-success'} text-xs font-bold">${isOut ? 'غير متوفر' : 'متوفر'}</span></div>`;
            }

            // 🌟 تمرير sizesCount إلى زر الإضافة للسلة 🌟
            return `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center p-3 bg-devo-black border ${isOut ? 'border-devo-error/30' : 'border-devo-gray'} rounded-xl mb-2 gap-3">
                <div class="flex justify-between w-full sm:w-auto flex-1">
                    <span class="text-white font-bold flex items-center gap-2"><span class="w-3 h-3 rounded-full ${isOut ? 'bg-devo-error' : 'bg-devo-success'}"></span>${inv.colors?.name}</span>
                    <span class="text-xs text-devo-muted font-mono mt-1">متبقي: ${available}</span>
                </div>
                ${isOut ? `<button disabled class="w-full sm:w-auto px-4 py-2 bg-devo-gray/20 text-devo-muted rounded-lg text-sm font-bold cursor-not-allowed">نفذت الكمية</button>` : `
                    <div class="flex items-center gap-2 w-full sm:w-auto">
                        <div class="flex items-center bg-devo-dark border border-devo-gray rounded-lg overflow-hidden h-9">
                            <button onclick="decrementQty('qty-${inv.color_id}')" class="px-3 text-white hover:text-devo-orange transition-colors"><i class="ph ph-minus"></i></button>
                            <input type="number" id="qty-${inv.color_id}" value="1" min="1" max="${available}" readonly class="w-10 bg-transparent text-center text-white text-sm font-bold outline-none border-x border-devo-gray">
                            <button onclick="incrementQty('qty-${inv.color_id}', ${available})" class="px-3 text-white hover:text-devo-orange transition-colors"><i class="ph ph-plus"></i></button>
                        </div>
                        <button onclick="addToCart(event, '${model.id}', '${inv.color_id}', '${model.name.replace(/'/g, "\\'")}', '${inv.colors?.name}', ${model.price}, '${mainImg}', ${available}, ${sizesCount}, '${model.factory_code || model.system_code}')" class="flex-1 sm:flex-none px-4 py-2 bg-devo-orange hover:bg-devo-orangeHover text-white rounded-lg text-sm font-bold transition-all shadow-md flex justify-center items-center gap-2">
                            <i class="ph ph-shopping-cart-simple text-lg"></i> إضافة
                        </button>
                    </div>
                `}
            </div>`;
        }).join('');
    } else {
        colorsHtml = `<div class="text-center p-4 text-devo-error bg-devo-error/10 rounded-xl text-sm border border-devo-error/20">لا توجد ألوان مسجلة.</div>`;
    }

    if (content) {
        content.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 p-4 md:p-0">
                <div>${imagesGalleryHtml}</div>
                <div class="flex flex-col">
                    <div class="mb-4 pb-4 border-b border-devo-gray">
                        <p class="text-devo-muted text-xs font-mono mb-1">كود: ${model.factory_code || model.system_code}</p>
                        <h2 class="text-2xl font-black text-white mb-2 leading-tight">${model.name}</h2>
                        <p class="text-3xl text-devo-orange font-black">${model.price} <span class="text-base font-normal">ج.م للقطعة</span></p>
                    </div>
                    <div class="mb-6">
                        <h4 class="text-sm font-bold text-white mb-2 flex items-center gap-2"><i class="ph ph-ruler"></i> المقاسات داخل السيريه (${sizesCount} قطع)</h4>
                        <div class="flex flex-wrap gap-2">${sizesHtml}</div>
                    </div>
                    <div class="flex-1">
                        <h4 class="text-sm font-bold text-white mb-3 flex items-center gap-2"><i class="ph ph-palette"></i> الألوان المتاحة للطلب</h4>
                        <div class="space-y-1">${colorsHtml}</div>
                    </div>
                </div>
            </div>
        `;
    }

    if (modal) { modal.classList.remove('hidden'); setTimeout(() => modal.classList.remove('opacity-0'), 10); }
};

// استبدل دالة addToCart بهذا الكود لتستقبل factoryCode
window.addToCart = (event, modelId, colorId, modelName, colorName, price, image, maxAvailable, sizesCount, factoryCode) => {
    const qtyInput = document.getElementById(`qty-${colorId}`);
    const qty = parseInt(qtyInput.value);

    if (qty > maxAvailable) return showToast('الكمية المطلوبة تتجاوز المتاح في المخزن!', 'error');

    const existingIndex = localCart.findIndex(i => i.modelId === modelId && i.colorId === colorId);
    
    if (existingIndex > -1) {
        if (localCart[existingIndex].qty + qty > maxAvailable) return showToast('إجمالي الكمية المطلوبة في السلة تتجاوز المتاح!', 'error');
        localCart[existingIndex].qty += qty;
    } else {
        // 🌟 حفظ الكود في السلة 🌟
        localCart.push({ modelId, colorId, modelName, colorName, price, image, qty, sizesCount, factoryCode });
    }

    saveLocalCart();
    if (window.refreshCartView) window.refreshCartView();
    
    const btn = event.currentTarget || event.target;
    if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<i class="ph ph-check text-lg"></i> تمت الإضافة`;
        btn.classList.replace('bg-devo-orange', 'bg-devo-success');
        btn.classList.replace('hover:bg-devo-orangeHover', 'hover:bg-green-600');
        setTimeout(() => {
            btn.innerHTML = originalHtml;
            btn.classList.replace('bg-devo-success', 'bg-devo-orange');
            btn.classList.replace('hover:bg-green-600', 'hover:bg-devo-orangeHover');
        }, 2000);
    }
    showToast(`تم إضافة الموديل للسلة`, 'success');
};
window.closeModelViewer = () => {
    const modal = document.getElementById('model-viewer-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

// --- دوال التحكم في الكمية داخل النافذة ---
window.incrementQty = (inputId, max) => {
    const input = document.getElementById(inputId);
    let val = parseInt(input.value);
    if (val < max) input.value = val + 1;
};
window.decrementQty = (inputId) => {
    const input = document.getElementById(inputId);
    let val = parseInt(input.value);
    if (val > 1) input.value = val - 1;
};

// --- نظام السلة (Cart Logic) ---
function loadLocalCart() {
    const saved = localStorage.getItem('devo_cart');
    if (saved) {
        try { localCart = JSON.parse(saved); } catch(e) { localCart = []; }
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
    
    // حساب إجمالي عدد السيريّات المطلوبة (وليس عدد العناصر)
    const totalItems = localCart.reduce((sum, item) => sum + item.qty, 0);
    countEl.textContent = totalItems;
    
    if (totalItems > 0) {
        countEl.parentElement.parentElement.classList.add('animate-bounce');
        setTimeout(() => countEl.parentElement.parentElement.classList.remove('animate-bounce'), 1000);
    }
}


// تعريض الدالة للاستخدام العالمي لتحديث المعرض بعد الطلب
window.refreshGallery = fetchGalleryModels;