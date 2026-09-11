import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { resolveImageUrl } from '../../services/offline_store.js';
import { printHtmlInIframe } from '../../utils/print.js';

let visitorCartItems = [];
let currentVisitorCartFilter = 'all';
let currentVisitorSubTab = 'cart';
let cachedVisitorHistoryOrders = [];

// ==========================================
// 🌟 تهيئة سلة الزائر وسجل الطلبات
// ==========================================
export function initVisitorCart() {
    loadVisitorCart();

    const form = document.getElementById('visitor-checkout-form');
    if (form) {
        form.addEventListener('submit', handleVisitorCheckout);
        form.addEventListener('input', saveVisitorCustomerDraft);
        form.addEventListener('change', saveVisitorCustomerDraft);
    }

    // استرجاع بيانات العميل المحفوظة تلقائياً
    prefillCustomerCheckoutForm();
    updateVisitorOrdersHistoryBadge();
    renderQueriedCodesChips();
    setupVisitorOrdersRealtime();

    window.refreshVisitorCartView = loadAndRenderVisitorCart;
    window.clearVisitorCart = clearVisitorCart;
    window.updateVisitorCartItemQty = updateVisitorCartItemQty;
    window.removeVisitorCartItem = removeVisitorCartItem;
    window.confirmRemoveVisitorCartItem = confirmRemoveVisitorCartItem;
    window.removeVisitorModelFromCart = removeVisitorModelFromCart;
    window.setVisitorCartFilter = setVisitorCartFilter;
    window.filterVisitorCartItems = filterVisitorCartItems;

    // دوال سجل الطلبات والاستعلام والطباعة
    window.switchVisitorCartSubTab = switchVisitorCartSubTab;
    window.loadVisitorOrdersHistory = loadVisitorOrdersHistory;
    window.searchVisitorOrders = searchVisitorOrders;
    window.viewCustomerOrderDetails = viewCustomerOrderDetails;
    window.closeCustomerOrderDetailsModal = closeCustomerOrderDetailsModal;
    window.printCustomerVisitorOrder = printCustomerVisitorOrder;
    window.copyVisitorOrderCode = copyVisitorOrderCode;
    window.goToVisitorOrdersHistoryTab = goToVisitorOrdersHistoryTab;
    window.applyQueriedCode = applyQueriedCode;
    window.removeQueriedCode = removeQueriedCode;
    window.clearQueriedCodesHistory = clearQueriedCodesHistory;

    loadAndRenderVisitorCart();
}

// ==========================================
// 🌟 إدارة التخزين المحلي
// ==========================================
function loadVisitorCart() {
    const saved = localStorage.getItem('devo_visitor_cart');
    if (saved) {
        try { visitorCartItems = JSON.parse(saved); } catch (e) { visitorCartItems = []; }
    }
}

function saveVisitorCart() {
    localStorage.setItem('devo_visitor_cart', JSON.stringify(visitorCartItems));
    updateVisitorFloatingCart();
}

function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function updateVisitorFloatingCart() {
    const countEl = document.getElementById('visitor-floating-cart-count');
    const btn = document.getElementById('visitor-floating-cart-btn');
    if (typeof window !== 'undefined' && window.isVisitor === false) {
        if (btn) btn.classList.add('hidden');
        return;
    }
    if (!countEl) return;
    const total = visitorCartItems.reduce((sum, i) => sum + i.qty, 0);
    countEl.textContent = total;
    if (btn) {
        if (total > 0) btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    }
}

export function getVisitorCartQtyForColor(modelId, colorId) {
    loadVisitorCart();
    const item = visitorCartItems.find(
        i => String(i.modelId) === String(modelId) && String(i.colorId) === String(colorId)
    );
    return item ? item.qty : 0;
}

// ==========================================
// 🌟 إضافة للسلة
// ==========================================
window.visitorAddToCart = (event, modelId, colorId) => {
    const btn = event?.currentTarget || event?.target;
    if (btn) {
        if (btn.dataset.locked === 'true') return;
        btn.dataset.locked = 'true';
        btn.disabled = true;
    }
    const unlock = () => { if (btn) { btn.disabled = false; delete btn.dataset.locked; } };

    const allModels = window.allGalleryModels || [];
    const model = allModels.find(m => String(m.id) === String(modelId));
    if (!model) { unlock(); return showToast('الموديل غير متوفر حالياً', 'error'); }

    const inv = model.model_inventory?.find(i => String(i.color_id) === String(colorId));
    if (!inv) { unlock(); return showToast('هذا اللون غير متوفر', 'error'); }

    const qtyInput = document.getElementById('vqty-' + colorId);
    const qty = parseInt(qtyInput?.value) || 1;

    loadVisitorCart();

    const dbAvailable = inv.available_series || 0;
    const currentInCart = getVisitorCartQtyForColor(modelId, colorId);
    const spaceLeft = dbAvailable - currentInCart;

    if (dbAvailable <= 0) { unlock(); return showToast('هذا اللون غير متوفر حالياً', 'error'); }
    if (qty > spaceLeft) { unlock(); return showToast('الكمية المطلوبة تتجاوز المتاح (' + spaceLeft + ' سيريه)', 'warning'); }

    const classSizes = model.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1);
    const mainImg = resolveImageUrl(model.model_images?.[0]?.image_url);
    const factoryCode = model.factory_code || model.system_code || '';

    let colorName = 'لون';
    if (inv.colors?.name) colorName = inv.colors.name;
    else if (Array.isArray(inv.colors) && inv.colors[0]?.name) colorName = inv.colors[0].name;
    else if (inv.color_name && inv.color_name !== 'لون') colorName = inv.color_name;

    const existingIdx = visitorCartItems.findIndex(
        i => String(i.modelId) === String(modelId) && String(i.colorId) === String(colorId)
    );

    if (existingIdx > -1) {
        if (visitorCartItems[existingIdx].qty + qty > dbAvailable) {
            unlock();
            return showToast('إجمالي الكمية في السلة يتجاوز المتاح!', 'warning');
        }
        visitorCartItems[existingIdx].qty += qty;
    } else {
        visitorCartItems.push({
            modelId: model.id, colorId: inv.color_id,
            modelName: model.name, colorName,
            price: model.price, image: mainImg,
            qty, sizesCount, factoryCode
        });
    }

    saveVisitorCart();
    if (window.refreshVisitorCartView) window.refreshVisitorCartView();
    if (typeof window.refreshVisitorColorsContainer === 'function') {
        window.refreshVisitorColorsContainer(modelId);
    }

    if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-check text-base"></i> تمت الإضافة';
        btn.classList.replace('bg-devo-orange', 'bg-devo-success');
        btn.classList.replace('hover:bg-devo-orangeHover', 'hover:bg-green-600');
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.classList.replace('bg-devo-success', 'bg-devo-orange');
            btn.classList.replace('hover:bg-green-600', 'hover:bg-devo-orangeHover');
            unlock();
        }, 900);
    }
};

window.visitorAddSetToCart = (event, modelId) => {
    const btn = event?.currentTarget || event?.target;
    if (btn) {
        if (btn.dataset.locked === 'true') return;
        btn.dataset.locked = 'true';
        btn.disabled = true;
    }

    const allModels = window.allGalleryModels || [];
    const model = allModels.find(m => String(m.id) === String(modelId));
    if (!model || !model.model_inventory?.length) {
        if (btn) { btn.disabled = false; delete btn.dataset.locked; }
        return showToast('لا توجد ألوان متاحة لهذا الموديل!', 'error');
    }

    const setQtyInput = document.getElementById('vset-qty-' + model.id);
    const setCount = parseInt(setQtyInput?.value) || 1;

    loadVisitorCart();
    const mainImg = resolveImageUrl(model.model_images?.[0]?.image_url);
    const classSizes = model.classes?.class_sizes || [];
    const sizesCount = classSizes.length > 0 ? classSizes.length : (model.model_sizes?.length || 1);
    const factoryCode = model.factory_code || model.system_code || '';

    let addedCount = 0;
    let skippedColors = [];

    model.model_inventory.forEach(inv => {
        const dbAvailable = inv.available_series || 0;
        let colorName = 'لون';
        if (inv.colors?.name) colorName = inv.colors.name;
        else if (Array.isArray(inv.colors) && inv.colors[0]?.name) colorName = inv.colors[0].name;
        else if (inv.color_name && inv.color_name !== 'لون') colorName = inv.color_name;

        if (dbAvailable <= 0) { skippedColors.push(colorName); return; }

        const currentInCart = getVisitorCartQtyForColor(model.id, inv.color_id);
        const spaceLeft = dbAvailable - currentInCart;
        if (spaceLeft <= 0) { skippedColors.push(colorName); return; }

        const qtyToAdd = Math.min(setCount, spaceLeft);
        const existingIdx = visitorCartItems.findIndex(
            i => String(i.modelId) === String(model.id) && String(i.colorId) === String(inv.color_id)
        );
        if (existingIdx > -1) {
            visitorCartItems[existingIdx].qty += qtyToAdd;
        } else {
            visitorCartItems.push({
                modelId: model.id, colorId: inv.color_id,
                modelName: model.name, colorName,
                price: model.price, image: mainImg,
                qty: qtyToAdd, sizesCount, factoryCode
            });
        }
        addedCount++;
    });

    if (addedCount === 0) {
        showToast('جميع الألوان نفذت كميتها أو مضافة بالفعل!', 'error');
    } else {
        saveVisitorCart();
        if (window.refreshVisitorCartView) window.refreshVisitorCartView();
        if (typeof window.refreshVisitorColorsContainer === 'function') {
            window.refreshVisitorColorsContainer(model.id);
        }
        let msg = 'تم إضافة ' + setCount + ' طقم (' + addedCount + ' لون) للسلة بنجاح!';
        if (skippedColors.length > 0) msg += ' (تجاوزنا ' + skippedColors.length + ' لون لنفاذ الكمية)';
        showToast(msg, 'success');
    }

    if (btn) {
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="ph ph-check text-base"></i> تمت الإضافة';
        btn.classList.replace('from-devo-orange', 'from-devo-success');
        btn.classList.replace('to-orange-600', 'to-green-600');
        setTimeout(() => {
            btn.innerHTML = orig;
            btn.classList.replace('from-devo-success', 'from-devo-orange');
            btn.classList.replace('to-green-600', 'to-orange-600');
            btn.disabled = false; delete btn.dataset.locked;
        }, 1000);
    }
};

// ==========================================
// 🌟 رسم سلة الزائر
// ==========================================
async function loadAndRenderVisitorCart() {
    loadVisitorCart();
    updateVisitorFloatingCart();

    const container = document.getElementById('visitor-cart-items-container');
    const toolsContainer = document.getElementById('visitor-cart-tools-container');
    const checkoutBtn = document.getElementById('visitor-btn-checkout');
    const sumPriceEl = document.getElementById('v-sum-price');
    const sumModelsEl = document.getElementById('v-sum-models');
    const sumSeriesEl = document.getElementById('v-sum-series');

    if (visitorCartItems.length === 0) {
        if (toolsContainer) toolsContainer.classList.add('hidden');
        if (container) container.innerHTML = `
            <div class="text-center py-12 text-devo-muted">
                <i class="ph ph-shopping-cart-simple text-5xl mb-3 opacity-40 block"></i>
                <p class="font-bold text-lg text-white mb-1">سلتك فارغة</p>
                <p class="text-sm mb-4">تصفح المعرض وأضف الموديلات التي تريدها</p>
                <button onclick="switchSiteView('view-gallery')" class="bg-devo-orange hover:bg-devo-orangeHover text-white px-6 py-2.5 rounded-xl font-bold transition-all cursor-pointer">تصفح المعرض</button>
            </div>`;
        if (sumPriceEl) sumPriceEl.textContent = '0';
        if (sumModelsEl) sumModelsEl.textContent = '0';
        if (sumSeriesEl) sumSeriesEl.textContent = '0';
        if (checkoutBtn) { checkoutBtn.disabled = true; checkoutBtn.classList.add('opacity-50', 'cursor-not-allowed'); }
        return;
    }

    if (toolsContainer) toolsContainer.classList.remove('hidden');
    if (container) container.innerHTML = `<div class="text-center py-8"><i class="ph ph-spinner animate-spin text-2xl text-devo-orange"></i><p class="text-xs text-devo-muted mt-2">جاري التحقق من المخزون...</p></div>`;

    const modelIds = [...new Set(visitorCartItems.map(i => i.modelId))];
    const [{ data: dbInventory }, { data: dbModels }] = await Promise.all([
        supabase.from('model_inventory').select('model_id, color_id, available_series').in('model_id', modelIds),
        supabase.from('models').select('id, is_active').in('id', modelIds)
    ]);

    renderVisitorCart(dbInventory || [], dbModels || []);
}

function renderVisitorCart(dbInventory, dbModels) {
    const container = document.getElementById('visitor-cart-items-container');
    const checkoutBtn = document.getElementById('visitor-btn-checkout');
    const sumPriceEl = document.getElementById('v-sum-price');
    const sumModelsEl = document.getElementById('v-sum-models');
    const sumSeriesEl = document.getElementById('v-sum-series');

    let html = '';
    let totalPrice = 0;
    let totalSeries = 0;
    let hasErrors = false;
    let errorModelsCount = 0;

    const groupedMap = new Map();
    visitorCartItems.forEach((item, index) => {
        if (!groupedMap.has(item.modelId)) {
            groupedMap.set(item.modelId, { ...item, colors: [] });
        }
        groupedMap.get(item.modelId).colors.push({ ...item, originalIndex: index });
    });

    groupedMap.forEach((group, modelId) => {
        const pricePerPiece = parseFloat(group.price) || 0;
        const piecesPerSeries = parseInt(group.sizesCount) || 1;
        const pricePerSeries = pricePerPiece * piecesPerSeries;
        let modelHasErrors = false;
        let modelTotalPrice = 0;
        let modelTotalSeries = 0;
        let colorsHtml = '';

        group.colors.forEach(item => {
            const dbInv = dbInventory.find(i =>
                String(i.model_id) === String(item.modelId) && String(i.color_id) === String(item.colorId)
            );
            const dbMod = dbModels.find(m => String(m.id) === String(item.modelId));
            const available = dbInv ? dbInv.available_series : 0;
            let errorMsg = null;

            if (!dbMod || !dbMod.is_active) errorMsg = 'الموديل غير متاح.';
            else if (available === 0) errorMsg = 'نفذت الكمية تماماً.';
            else if (item.qty > available) errorMsg = 'الكمية المطلوبة (' + item.qty + ') تجاوزت المتاح. الحد الأقصى: ' + available + ' سيريه.';

            if (errorMsg) { hasErrors = true; modelHasErrors = true; }

            const itemTotal = pricePerSeries * item.qty;
            if (!errorMsg) { totalPrice += itemTotal; totalSeries += item.qty; modelTotalPrice += itemTotal; modelTotalSeries += item.qty; }

            const rowClass = errorMsg ? 'bg-devo-error/20 border-devo-error/40' : 'bg-devo-black border-devo-gray/60';

            colorsHtml += `
            <div class="p-2.5 ${rowClass} border rounded-lg mb-2 transition-all">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full ${errorMsg ? 'bg-devo-error' : 'bg-devo-success'} shrink-0"></span>
                        <span class="text-white font-bold text-xs sm:text-sm">${item.colorName}</span>
                    </div>
                    ${errorMsg ? `
                        <div class="flex flex-col sm:flex-row gap-2 items-start sm:items-center w-full sm:w-auto justify-between">
                            <span class="text-devo-error text-[11px] font-bold flex items-center gap-1"><i class="ph ph-warning-circle text-sm"></i> ${errorMsg}</span>
                            <div class="flex items-center gap-2">
                                ${available > 0 ? '<button type="button" onclick="updateVisitorCartItemQty(' + item.originalIndex + ', ' + available + ', ' + available + ')" class="text-[10px] bg-devo-orange text-white px-2.5 py-1 rounded shadow whitespace-nowrap hover:bg-devo-orangeHover transition-colors font-bold cursor-pointer">تصحيح لـ ' + available + '</button>' : ''}
                                <button type="button" onclick="confirmRemoveVisitorCartItem(${item.originalIndex})" class="text-devo-error hover:bg-devo-error/20 p-1 rounded transition-colors cursor-pointer"><i class="ph ph-trash text-base"></i></button>
                            </div>
                        </div>` :
                    `<div class="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                        <div class="flex items-center bg-devo-dark border border-devo-gray rounded-lg overflow-hidden h-8">
                            <button type="button" onclick="updateVisitorCartItemQty(${item.originalIndex}, ${item.qty - 1})" class="px-2 text-white hover:text-devo-orange transition-colors h-full"><i class="ph ph-minus text-xs"></i></button>
                            <input type="number" readonly value="${item.qty}" class="w-9 h-full bg-transparent text-center text-white text-xs font-bold outline-none border-x border-devo-gray">
                            <button type="button" onclick="updateVisitorCartItemQty(${item.originalIndex}, ${item.qty + 1}, ${available})" class="px-2 text-white hover:text-devo-orange transition-colors h-full"><i class="ph ph-plus text-xs"></i></button>
                        </div>
                        <div class="text-left flex items-center gap-2">
                            <p class="text-devo-orange font-black text-xs sm:text-sm">${itemTotal.toLocaleString()} ج.م</p>
                            <button type="button" onclick="confirmRemoveVisitorCartItem(${item.originalIndex})" class="text-devo-error hover:bg-devo-error/20 p-1.5 rounded transition-colors cursor-pointer"><i class="ph ph-trash text-base"></i></button>
                        </div>
                    </div>`}
                </div>
            </div>`;
        });

        if (modelHasErrors) {
            errorModelsCount++;
        }

        html += `
        <div class="visitor-cart-item-card flex flex-col sm:flex-row gap-3 p-3.5 ${modelHasErrors ? 'bg-devo-error/10 border-devo-error shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-devo-dark border-devo-gray'} border rounded-xl mb-4 shadow-sm transition-all duration-300" data-search="${(group.modelName || '').toLowerCase()} ${(group.factoryCode || '').toLowerCase()}" data-has-errors="${modelHasErrors}">
            <img src="${group.image}" class="w-20 h-20 rounded-lg object-cover bg-devo-black shrink-0 ${modelHasErrors ? 'grayscale opacity-60' : ''}" onerror="this.src='./src/assets/icons/devo.png'">
            <div class="flex flex-col flex-1">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h4 class="text-white font-bold text-sm sm:text-base line-clamp-1">${group.modelName}</h4>
                        <span class="text-devo-muted text-[10px] font-mono bg-devo-black px-2 py-0.5 rounded border border-devo-gray"><i class="ph ph-barcode"></i> ${group.factoryCode || 'بدون كود'}</span>
                    </div>
                    <button type="button" onclick="removeVisitorModelFromCart('${modelId}')" class="text-devo-error hover:bg-devo-error/20 px-2 py-1 rounded-lg text-xs font-bold border border-devo-error/20 flex items-center gap-1 cursor-pointer">
                        <i class="ph ph-trash text-sm"></i><span class="hidden sm:inline">حذف</span>
                    </button>
                </div>
                <div class="mt-1 space-y-1">${colorsHtml}</div>
                <div class="flex justify-between items-center mt-2 pt-2 border-t border-devo-gray/50 text-xs">
                    <span class="text-devo-muted">إجمالي الموديل: <span class="text-white font-bold">${modelTotalSeries} سيريه</span></span>
                    <span class="text-devo-orange font-black">${modelTotalPrice.toLocaleString()} ج.م</span>
                </div>
            </div>
        </div>`;
    });

    if (container) container.innerHTML = html;
    if (sumPriceEl) sumPriceEl.textContent = totalPrice.toLocaleString();
    if (sumModelsEl) sumModelsEl.textContent = groupedMap.size;
    if (sumSeriesEl) sumSeriesEl.textContent = totalSeries;

    const errorBadge = document.getElementById('vcart-error-badge');
    if (errorBadge) {
        errorBadge.textContent = errorModelsCount;
        if (errorModelsCount > 0) errorBadge.classList.remove('hidden');
        else errorBadge.classList.add('hidden');
    }

    updateVisitorFilterButtonsUI();
    filterVisitorCartItems();

    if (checkoutBtn) {
        if (hasErrors) {
            checkoutBtn.disabled = true;
            checkoutBtn.innerHTML = '<i class="ph ph-prohibit"></i> يرجى تصحيح الأخطاء أولاً';
            checkoutBtn.classList.add('opacity-50', 'cursor-not-allowed');
            checkoutBtn.classList.remove('bg-devo-orange', 'hover:bg-devo-orangeHover');
        } else {
            checkoutBtn.disabled = false;
            checkoutBtn.innerHTML = '<span>إرسال الطلب</span><i class="ph ph-paper-plane-tilt text-xl"></i>';
            checkoutBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            checkoutBtn.classList.add('bg-devo-orange', 'hover:bg-devo-orangeHover');
        }
    }
}

function updateVisitorFilterButtonsUI() {
    const filters = {
        all: {
            activeClass: "px-4 py-2 rounded-lg font-bold transition-all bg-devo-orange text-white flex items-center gap-1.5 shadow-sm cursor-pointer",
            inactiveClass: "px-4 py-2 rounded-lg font-bold transition-all text-devo-muted hover:text-white hover:bg-devo-gray/20 flex items-center gap-1.5 cursor-pointer"
        },
        ok: {
            activeClass: "px-4 py-2 rounded-lg font-bold transition-all bg-devo-orange text-white flex items-center gap-1.5 shadow-sm cursor-pointer",
            inactiveClass: "px-4 py-2 rounded-lg font-bold transition-all text-devo-muted hover:text-white hover:bg-devo-gray/20 flex items-center gap-1.5 cursor-pointer"
        },
        error: {
            activeClass: "px-4 py-2 rounded-lg font-bold transition-all bg-devo-error text-white flex items-center gap-1.5 shadow-sm cursor-pointer",
            inactiveClass: "px-4 py-2 rounded-lg font-bold transition-all text-devo-muted hover:text-white hover:bg-devo-gray/20 flex items-center gap-1.5 cursor-pointer"
        }
    };

    Object.keys(filters).forEach(type => {
        const btn = document.getElementById(`btn-vcart-filter-${type}`);
        if (btn) {
            btn.className = (currentVisitorCartFilter === type) ? filters[type].activeClass : filters[type].inactiveClass;
        }
    });
}

function setVisitorCartFilter(filterType) {
    currentVisitorCartFilter = filterType;
    updateVisitorFilterButtonsUI();
    filterVisitorCartItems();
}

function filterVisitorCartItems() {
    const term = document.getElementById('visitor-cart-search-input')?.value.toLowerCase().trim() || '';
    const cards = document.querySelectorAll('.visitor-cart-item-card');

    cards.forEach(card => {
        const searchText = (card.getAttribute('data-search') || '').toLowerCase();
        const hasErrors = card.getAttribute('data-has-errors') === 'true';

        const matchesSearch = term === '' || searchText.includes(term);
        let matchesFilter = true;
        if (currentVisitorCartFilter === 'ok') {
            matchesFilter = !hasErrors;
        } else if (currentVisitorCartFilter === 'error') {
            matchesFilter = hasErrors;
        }

        if (matchesSearch && matchesFilter) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
}

// ==========================================
// 🌟 تعديل الكمية وحذف
// ==========================================
function updateVisitorCartItemQty(index, newQty, maxAvailable) {
    if (newQty < 1) return;
    if (maxAvailable !== undefined && maxAvailable !== null && newQty > maxAvailable) {
        return showToast('أقصى كمية متاحة هي ' + maxAvailable, 'warning');
    }
    visitorCartItems[index].qty = newQty;
    saveVisitorCart();
    loadAndRenderVisitorCart();
}

function removeVisitorCartItem(index) {
    if (index < 0 || index >= visitorCartItems.length) return;
    visitorCartItems.splice(index, 1);
    saveVisitorCart();
    loadAndRenderVisitorCart();
}

async function removeVisitorModelFromCart(modelId) {
    const modelItems = visitorCartItems.filter(i => String(i.modelId) === String(modelId));
    if (modelItems.length === 0) return;
    const confirmed = await confirmDialog({
        title: 'حذف الموديل', message: 'هل تريد حذف (' + modelItems[0].modelName + ') بجميع ألوانه من السلة؟', isDestructive: true
    });
    if (confirmed) {
        visitorCartItems = visitorCartItems.filter(i => String(i.modelId) !== String(modelId));
        saveVisitorCart(); loadAndRenderVisitorCart();
        showToast('تم حذف الموديل من السلة', 'success');
    }
}

async function confirmRemoveVisitorCartItem(index) {
    const item = visitorCartItems[index];
    if (!item) return;
    const confirmed = await confirmDialog({
        title: 'حذف اللون', message: 'هل تريد حذف اللون (' + item.colorName + ') من السلة؟', isDestructive: true
    });
    if (confirmed) {
        removeVisitorCartItem(index);
        showToast('تم حذف اللون من السلة', 'success');
    }
}

async function clearVisitorCart() {
    if (visitorCartItems.length === 0) return showToast('السلة فارغة بالفعل', 'info');
    const confirmed = await confirmDialog({
        title: 'إفراغ السلة', message: 'هل أنت متأكد من رغبتك في إفراغ السلة بالكامل؟', isDestructive: true
    });
    if (confirmed) {
        visitorCartItems = []; saveVisitorCart(); loadAndRenderVisitorCart();
        showToast('تم إفراغ السلة', 'success');
    }
}

window.updateVisitorCartItemQty = updateVisitorCartItemQty;
window.removeVisitorCartItem = removeVisitorCartItem;
window.confirmRemoveVisitorCartItem = confirmRemoveVisitorCartItem;
window.removeVisitorModelFromCart = removeVisitorModelFromCart;
window.clearVisitorCart = clearVisitorCart;

// ==========================================
// 🌟 إرسال الطلب
// ==========================================
async function handleVisitorCheckout(e) {
    e.preventDefault();
    if (visitorCartItems.length === 0) return showToast('السلة فارغة!', 'error');

    const customerName = document.getElementById('vc-name')?.value.trim();
    const phone1 = document.getElementById('vc-phone1')?.value.trim();
    const address = document.getElementById('vc-address')?.value.trim();

    if (!customerName) {
        showToast('يرجى إدخال اسمك أو اسم المحل!', 'warning');
        document.getElementById('vc-name')?.focus();
        return;
    }

    if (!phone1) {
        showToast('يرجى إدخال رقم الهاتف!', 'warning');
        document.getElementById('vc-phone1')?.focus();
        return;
    }

    if (!address) {
        showToast('يرجى إدخال العنوان بالتفصيل!', 'warning');
        document.getElementById('vc-address')?.focus();
        return;
    }

    const btn = document.getElementById('visitor-btn-checkout');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> جاري إرسال الطلب...'; }

    try {
        const modelIds = [...new Set(visitorCartItems.map(i => i.modelId))];
        const [{ data: dbInv }, { data: dbMod }] = await Promise.all([
            supabase.from('model_inventory').select('model_id, color_id, available_series').in('model_id', modelIds),
            supabase.from('models').select('id, is_active').in('id', modelIds)
        ]);

        let hasErrors = false;
        visitorCartItems.forEach(item => {
            const inv = dbInv?.find(i => String(i.model_id) === String(item.modelId) && String(i.color_id) === String(item.colorId));
            const mod = dbMod?.find(m => String(m.id) === String(item.modelId));
            const available = inv ? inv.available_series : 0;
            if (!mod || !mod.is_active || item.qty > available || available === 0) hasErrors = true;
        });

        if (hasErrors) {
            showToast('بعض الموديلات تغيرت كميتها أو نفذت! يرجى مراجعة السلة.', 'error');
            await loadAndRenderVisitorCart();
            if (btn) { btn.disabled = false; btn.innerHTML = '<span>إرسال الطلب</span><i class="ph ph-paper-plane-tilt text-xl"></i>'; }
            return;
        }

        const totalPrice = visitorCartItems.reduce((sum, i) => sum + (i.qty * (i.sizesCount || 1) * i.price), 0);
        const totalSeries = visitorCartItems.reduce((sum, i) => sum + i.qty, 0);

        const orderId = generateUUID();
        const orderData = {
            id: orderId,
            customer_name: customerName,
            phone_1: phone1,
            phone_2: document.getElementById('vc-phone2')?.value.trim() || null,
            address: address,
            notes: document.getElementById('vc-notes')?.value.trim() || null,
            total_price: totalPrice,
            total_series: totalSeries,
            status: 'pending'
        };

        const { error: orderError } = await supabase
            .from('visitor_orders').insert(orderData);

        if (orderError) throw orderError;

        const orderItems = visitorCartItems.map(item => ({
            id: generateUUID(),
            visitor_order_id: orderId,
            model_id: item.modelId,
            color_id: item.colorId,
            model_name: item.modelName,
            color_name: item.colorName,
            factory_code: item.factoryCode || '',
            quantity: item.qty,
            price_per_series: item.price * (item.sizesCount || 1),
            sizes_count: item.sizesCount || 1,
            total_price: item.qty * (item.sizesCount || 1) * item.price
        }));

        const { error: itemsError } = await supabase.from('visitor_order_items').insert(orderItems);
        if (itemsError) throw itemsError;

        visitorCartItems = [];
        saveVisitorCart();
        localStorage.removeItem('devo_visitor_customer_draft');
        e.target.reset();
        loadAndRenderVisitorCart();

        // حفظ الطلب في سجل جهاز العميل وتحديث الشارة
        saveOrderToLocalHistory(orderData, orderItems);
        updateVisitorOrdersHistoryBadge();

        showVisitorOrderSuccess(orderId, orderData);

    } catch (err) {
        console.error('[VisitorCart] Checkout error:', err);
        showToast('حدث خطأ أثناء إرسال الطلب: ' + (err.message || 'خطأ غير معروف'), 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<span>إرسال الطلب</span><i class="ph ph-paper-plane-tilt text-xl"></i>'; }
    }
}

function showVisitorOrderSuccess(orderId, orderData) {
    const modal = document.getElementById('visitor-order-success-modal');
    if (!modal) {
        showToast('تم إرسال طلبك بنجاح! سيتم التواصل معك قريباً.', 'success');
        return;
    }
    const nameEl = modal.querySelector('#vos-customer-name');
    const phoneEl = modal.querySelector('#vos-customer-phone');
    const idEl = modal.querySelector('#vos-order-id');
    const printBtn = modal.querySelector('#vos-btn-print');

    if (nameEl) nameEl.textContent = orderData.customer_name || '---';
    if (phoneEl) phoneEl.textContent = orderData.phone_1 || '---';
    if (idEl) idEl.textContent = orderId.toString().split('-')[0].toUpperCase();

    if (printBtn) {
        printBtn.onclick = () => printCustomerVisitorOrder(orderId);
    }

    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

window.closeVisitorOrderSuccess = () => {
    const modal = document.getElementById('visitor-order-success-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => { modal.classList.add('hidden'); window.switchSiteView?.('view-gallery'); }, 300);
    }
};

// ==========================================
// 🌟 سجل ومتابعة طلبات العميل
// ==========================================

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getLocalOrdersHistory() {
    try {
        const saved = localStorage.getItem('devo_visitor_my_orders');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        console.error('[VisitorCart] Failed to read local orders:', e);
        return [];
    }
}

function saveLocalOrdersHistory(orders) {
    try {
        localStorage.setItem('devo_visitor_my_orders', JSON.stringify(orders));
        updateVisitorOrdersHistoryBadge();
    } catch (e) {
        console.error('[VisitorCart] Failed to save local orders:', e);
    }
}

export function removeOrderFromLocalHistory(orderId) {
    if (!orderId) return;
    try {
        let orders = getLocalOrdersHistory();
        orders = orders.filter(o => String(o.id) !== String(orderId) && (o.code ? String(o.code).toUpperCase() !== String(orderId).toUpperCase() : true));
        saveLocalOrdersHistory(orders);
        updateVisitorOrdersHistoryBadge();
    } catch (e) {
        console.error('[VisitorCart] Error removing order from local history:', e);
    }
}

function saveOrderToLocalHistory(orderData, orderItems = []) {
    if (!orderData || !orderData.id) return;
    const orders = getLocalOrdersHistory();
    const existingIndex = orders.findIndex(o => String(o.id) === String(orderData.id));
    const shortCode = (orderData.id || '').toString().split('-')[0].toUpperCase();
    const existing = existingIndex >= 0 ? orders[existingIndex] : null;

    const item = {
        id: orderData.id,
        code: shortCode,
        customer_name: orderData.customer_name || '',
        phone_1: orderData.phone_1 || '',
        phone_2: orderData.phone_2 || null,
        address: orderData.address || '',
        notes: orderData.notes || null,
        total_price: Number(orderData.total_price || 0),
        total_series: Number(orderData.total_series || 0),
        status: orderData.status || 'pending',
        rejection_reason: orderData.rejection_reason || null,
        reviewed_by: orderData.reviewed_by || null,
        created_at: orderData.created_at || new Date().toISOString(),
        items: (orderItems && orderItems.length > 0) ? orderItems : (existing?.items || [])
    };

    if (existingIndex >= 0) {
        orders[existingIndex] = { ...orders[existingIndex], ...item };
    } else {
        orders.unshift(item);
    }

    saveLocalOrdersHistory(orders);
    saveQueriedCode(shortCode);
}

// ==========================================
// 🌟 إدارة سجل الأكواد المستعلم عنها
// ==========================================
function getQueriedCodesHistory() {
    try {
        const saved = localStorage.getItem('devo_visitor_queried_codes');
        return saved ? JSON.parse(saved) : [];
    } catch (e) {
        return [];
    }
}

export function saveQueriedCode(rawCode) {
    if (!rawCode) return;
    const clean = rawCode.toString().replace(/[#\s]/g, '').trim().toUpperCase();
    if (!clean || clean.length < 3) return;

    let list = getQueriedCodesHistory();
    // إزالة الكود إن وُجد سابقاً لوضعه في المقدمة
    list = list.filter(item => item.code !== clean);
    list.unshift({
        code: clean,
        time: Date.now()
    });
    // الاحتفاظ بآخر 12 كود/بحث
    if (list.length > 12) list = list.slice(0, 12);
    try {
        localStorage.setItem('devo_visitor_queried_codes', JSON.stringify(list));
    } catch (e) {}
    renderQueriedCodesChips();
}

export function removeQueriedCode(codeToRemove) {
    let list = getQueriedCodesHistory();
    list = list.filter(item => item.code !== codeToRemove);
    try {
        localStorage.setItem('devo_visitor_queried_codes', JSON.stringify(list));
    } catch (e) {}
    renderQueriedCodesChips();
}

export function clearQueriedCodesHistory() {
    try {
        localStorage.removeItem('devo_visitor_queried_codes');
    } catch (e) {}
    renderQueriedCodesChips();
    showToast('تم مسح سجل الأكواد المستعلم عنها', 'info');
}

export function renderQueriedCodesChips() {
    const container = document.getElementById('visitor-recent-queries-container');
    const listEl = document.getElementById('visitor-recent-queries-list');
    if (!container || !listEl) return;

    const list = getQueriedCodesHistory();
    if (!list || list.length === 0) {
        container.classList.add('hidden');
        listEl.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');
    listEl.innerHTML = list.map(item => `
        <div class="inline-flex items-center gap-1 bg-devo-black hover:bg-devo-gray/40 border border-devo-gray hover:border-devo-orange rounded-lg pl-2 pr-1.5 py-1 text-xs text-white transition-all">
            <button type="button" onclick="applyQueriedCode('${item.code}')" class="font-mono font-bold text-devo-orange hover:underline cursor-pointer flex items-center gap-1">
                <i class="ph ph-hash text-[11px] opacity-70"></i>
                <span>${item.code}</span>
            </button>
            <button type="button" onclick="event.stopPropagation(); removeQueriedCode('${item.code}')" class="text-devo-muted hover:text-rose-400 p-0.5 rounded cursor-pointer transition-colors" title="إزالة من السجل">
                <i class="ph ph-x text-[10px]"></i>
            </button>
        </div>
    `).join('');
}

export function applyQueriedCode(code) {
    const input = document.getElementById('visitor-order-query-input');
    if (input) {
        input.value = code;
    }
    searchVisitorOrders(code);
}

export function updateVisitorOrdersHistoryBadge() {
    const badge = document.getElementById('visitor-orders-history-badge');
    if (!badge) return;
    const orders = getLocalOrdersHistory();
    if (orders.length > 0) {
        badge.textContent = orders.length;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function saveVisitorCustomerDraft() {
    const name = document.getElementById('vc-name')?.value || '';
    const p1 = document.getElementById('vc-phone1')?.value || '';
    const p2 = document.getElementById('vc-phone2')?.value || '';
    const addr = document.getElementById('vc-address')?.value || '';
    const notes = document.getElementById('vc-notes')?.value || '';

    const hasData = name.trim() || p1.trim() || p2.trim() || addr.trim() || notes.trim();
    if (hasData) {
        localStorage.setItem('devo_visitor_customer_draft', JSON.stringify({
            customer_name: name,
            phone_1: p1,
            phone_2: p2,
            address: addr,
            notes: notes
        }));
    } else {
        localStorage.removeItem('devo_visitor_customer_draft');
    }
}

export function prefillCustomerCheckoutForm() {
    try {
        const savedDraft = localStorage.getItem('devo_visitor_customer_draft');
        if (savedDraft) {
            const draft = JSON.parse(savedDraft);
            if (draft) {
                const nameInput = document.getElementById('vc-name');
                const p1Input = document.getElementById('vc-phone1');
                const p2Input = document.getElementById('vc-phone2');
                const addrInput = document.getElementById('vc-address');
                const notesInput = document.getElementById('vc-notes');

                if (nameInput && !nameInput.value && draft.customer_name) nameInput.value = draft.customer_name;
                if (p1Input && !p1Input.value && draft.phone_1) p1Input.value = draft.phone_1;
                if (p2Input && !p2Input.value && draft.phone_2) p2Input.value = draft.phone_2;
                if (addrInput && !addrInput.value && draft.address) addrInput.value = draft.address;
                if (notesInput && !notesInput.value && draft.notes) notesInput.value = draft.notes;
                return;
            }
        }
    } catch(e) {}

    const orders = getLocalOrdersHistory();
    if (!orders || orders.length === 0) return;
    const last = orders[0];
    if (!last) return;

    const nameInput = document.getElementById('vc-name');
    const p1Input = document.getElementById('vc-phone1');
    const p2Input = document.getElementById('vc-phone2');
    const addrInput = document.getElementById('vc-address');

    if (nameInput && !nameInput.value && last.customer_name) nameInput.value = last.customer_name;
    if (p1Input && !p1Input.value && last.phone_1) p1Input.value = last.phone_1;
    if (p2Input && !p2Input.value && last.phone_2) p2Input.value = last.phone_2;
    if (addrInput && !addrInput.value && last.address) addrInput.value = last.address;
}

export function switchVisitorCartSubTab(tab) {
    currentVisitorSubTab = tab;
    const btnCart = document.getElementById('tab-btn-vcart-current');
    const btnHistory = document.getElementById('tab-btn-vcart-history');
    const wrapCart = document.getElementById('visitor-cart-main-wrapper');
    const wrapHistory = document.getElementById('visitor-history-main-wrapper');

    if (tab === 'cart') {
        if (btnCart) {
            btnCart.className = 'px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 transition-all bg-devo-orange text-white shadow-md cursor-pointer';
        }
        if (btnHistory) {
            btnHistory.className = 'px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 transition-all text-devo-muted hover:text-white hover:bg-devo-gray/30 cursor-pointer';
        }
        if (wrapCart) wrapCart.classList.remove('hidden');
        if (wrapHistory) wrapHistory.classList.add('hidden');
    } else {
        if (btnHistory) {
            btnHistory.className = 'px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 transition-all bg-devo-orange text-white shadow-md cursor-pointer';
        }
        if (btnCart) {
            btnCart.className = 'px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm flex items-center gap-2 transition-all text-devo-muted hover:text-white hover:bg-devo-gray/30 cursor-pointer';
        }
        if (wrapCart) wrapCart.classList.add('hidden');
        if (wrapHistory) wrapHistory.classList.remove('hidden');

        loadVisitorOrdersHistory();
        renderQueriedCodesChips();
    }
}

export function goToVisitorOrdersHistoryTab() {
    window.closeVisitorOrderSuccess?.();
    window.switchSiteView?.('view-visitor-cart');
    switchVisitorCartSubTab('history');
}

export async function loadVisitorOrdersHistory(forceRefresh = false) {
    const listEl = document.getElementById('visitor-orders-history-list');
    const titleEl = document.getElementById('visitor-orders-section-title');
    if (titleEl) titleEl.textContent = 'طلباتك المسجلة';

    renderQueriedCodesChips();
    const localOrders = getLocalOrdersHistory();

    if (!localOrders || localOrders.length === 0) {
        if (listEl) {
            listEl.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 px-4 text-center bg-devo-dark border border-devo-gray rounded-2xl">
                    <div class="w-16 h-16 bg-devo-gray/20 rounded-full flex items-center justify-center mb-3 text-devo-muted">
                        <i class="ph ph-receipt text-3xl"></i>
                    </div>
                    <h4 class="text-base font-bold text-white mb-1">لا توجد طلبات مسجلة على هذا المتصفح</h4>
                    <p class="text-xs text-devo-muted max-w-sm mb-4 leading-relaxed">
                        عند إرسال أي طلب جديد سيتم حفظه هنا تلقائياً، أو يمكنك الاستعلام عن أي طلب سابق بإدخال رقم هاتفك أو كود الطلب في شريط البحث أعلاه.
                    </p>
                    <button type="button" onclick="switchVisitorCartSubTab('cart')" class="bg-devo-orange hover:bg-devo-orangeHover text-white px-5 py-2 rounded-xl text-xs font-bold transition-all shadow-md">
                        العودة للسلة
                    </button>
                </div>
            `;
        }
        return;
    }

    if (listEl) {
        listEl.innerHTML = `
            <div class="p-8 text-center bg-devo-dark border border-devo-gray rounded-2xl">
                <i class="ph ph-spinner animate-spin text-2xl text-devo-orange"></i>
                <p class="text-xs text-devo-muted mt-2">جاري فحص وتحديث حالة طلباتك من النظام...</p>
            </div>
        `;
    }

    try {
        const orderIds = localOrders.map(o => o.id);
        const { data: dbOrders, error } = await supabase
            .from('visitor_orders')
            .select('*')
            .in('id', orderIds)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // إذا نجح الاستعلام من قاعدة البيانات:
        // نعتمد حصرياً الطلبات التي لا تزال موجودة في قاعدة البيانات (Supabase)
        // إذا قام الأدمن بحذف طلب، فلن يرجع في dbOrders ويتم حذفه تلقائياً من التخزين المحلي للمتصفح
        cachedVisitorHistoryOrders = (dbOrders || []).sort(
            (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
        );
        saveLocalOrdersHistory(cachedVisitorHistoryOrders);
        updateVisitorOrdersHistoryBadge();
        renderVisitorOrdersHistoryList(cachedVisitorHistoryOrders);

    } catch (err) {
        console.warn('[VisitorCart] Error refreshing history from Supabase, using local:', err);
        cachedVisitorHistoryOrders = localOrders;
        renderVisitorOrdersHistoryList(cachedVisitorHistoryOrders);
    }
}

export function renderVisitorOrdersHistoryList(orders, isSearch = false) {
    const listEl = document.getElementById('visitor-orders-history-list');
    if (!listEl) return;

    if (!orders || orders.length === 0) {
        listEl.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 px-4 text-center bg-devo-dark border border-devo-gray rounded-2xl">
                <div class="w-16 h-16 bg-devo-error/10 rounded-full flex items-center justify-center mb-3 text-devo-error">
                    <i class="ph ph-magnifying-glass text-3xl"></i>
                </div>
                <h4 class="text-base font-bold text-white mb-1">لم يتم العثور على أي طلب</h4>
                <p class="text-xs text-devo-muted max-w-sm mb-4">
                    تأكد من كتابة رقم الهاتف الصحيح أو كود الطلب بالكامل.
                </p>
                <button type="button" onclick="loadVisitorOrdersHistory(true)" class="bg-devo-gray/30 hover:bg-devo-gray text-white px-4 py-2 rounded-xl text-xs font-bold transition-all">
                    عرض جميع طلباتي المسجلة
                </button>
            </div>
        `;
        return;
    }

    listEl.innerHTML = orders.map(order => {
        const shortId = (order.id || '').toString().split('-')[0].toUpperCase();
        const dateStr = order.created_at ? new Date(order.created_at).toLocaleString('ar-EG', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }) : '---';

        let statusBadge = '';
        let statusClass = '';
        if (order.status === 'approved') {
            statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"><i class="ph ph-check-circle"></i> تم القبول والاعتماد</span>';
            statusClass = 'border-emerald-500/30';
        } else if (order.status === 'rejected') {
            statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30"><i class="ph ph-x-circle"></i> تم الرفض</span>';
            statusClass = 'border-rose-500/30';
        } else if (order.status === 'ignored') {
            statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-500/15 text-gray-400 border border-gray-500/30"><i class="ph ph-prohibit"></i> ملغي</span>';
            statusClass = 'border-gray-500/30';
        } else if (order.status === 'archived') {
            statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30"><i class="ph ph-archive"></i> مؤرشف</span>';
            statusClass = 'border-purple-500/30';
        } else {
            statusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30"><i class="ph ph-clock"></i> قيد المراجعة</span>';
            statusClass = 'border-devo-gray hover:border-devo-orange/50';
        }

        const rejectionBanner = (order.status === 'rejected' || order.status === 'ignored') ? `
            <div class="bg-rose-500/15 border border-rose-500/30 rounded-xl p-3 text-xs text-rose-200 flex items-start gap-2.5">
                <i class="ph ph-warning-circle text-rose-400 text-lg mt-0.5 shrink-0"></i>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-1 flex-wrap">
                        <span class="font-bold text-rose-300">سبب الرفض:</span>
                        ${order.reviewed_by ? `<span class="text-[10px] text-rose-300/70">المراجع: ${escapeHtml(order.reviewed_by)}</span>` : ''}
                    </div>
                    <p class="text-white font-bold text-xs bg-devo-black/70 p-2 rounded-lg border border-rose-500/20 mt-1 leading-relaxed">
                        ${escapeHtml(order.rejection_reason || 'تم رفض الطلب من قبل الإدارة لعدم توفر الكمية المطلوبة بالمخزن')}
                    </p>
                </div>
            </div>
        ` : '';

        return `
            <div class="bg-devo-dark border ${statusClass} rounded-2xl p-4 sm:p-5 shadow-sm transition-all space-y-3.5">
                <!-- Header -->
                <div class="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-devo-gray/60">
                    <div class="flex items-center gap-2.5">
                        <div class="w-10 h-10 rounded-xl bg-devo-black border border-devo-gray flex items-center justify-center text-devo-orange shrink-0">
                            <i class="ph ph-receipt text-xl"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="text-white font-mono font-black text-sm sm:text-base">#${shortId}</span>
                                <button type="button" onclick="copyVisitorOrderCode('${shortId}')" class="text-devo-muted hover:text-white transition-colors" title="نسخ الكود">
                                    <i class="ph ph-copy text-sm"></i>
                                </button>
                            </div>
                            <p class="text-[11px] text-devo-muted">${dateStr}</p>
                        </div>
                    </div>
                    <div>
                        ${statusBadge}
                    </div>
                </div>

                <!-- Rejection Banner if any -->
                ${rejectionBanner}

                <!-- Customer Details & Metrics -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs bg-devo-black/70 p-3 rounded-xl border border-devo-gray/50">
                    <div>
                        <span class="text-devo-muted block text-[10px]">العميل:</span>
                        <span class="text-white font-bold truncate block">${escapeHtml(order.customer_name || 'بدون اسم')}</span>
                    </div>
                    <div>
                        <span class="text-devo-muted block text-[10px]">الهاتف:</span>
                        <span class="text-white font-mono font-bold truncate block" dir="ltr">${escapeHtml(order.phone_1 || '---')}</span>
                    </div>
                    <div>
                        <span class="text-devo-muted block text-[10px]">إجمالي السريات:</span>
                        <span class="text-devo-orange font-black text-sm block">${Number(order.total_series || 0)} سيريه</span>
                    </div>
                    <div>
                        <span class="text-devo-muted block text-[10px]">إجمالي القيمة:</span>
                        <span class="text-white font-black text-sm block">${Number(order.total_price || 0).toLocaleString()} ج.م</span>
                    </div>
                </div>

                <!-- Actions -->
                <div class="flex items-center justify-end gap-2 pt-1">
                    <button type="button" onclick="printCustomerVisitorOrder('${order.id}')" class="px-3.5 py-2 rounded-xl bg-purple-600/15 hover:bg-purple-600 text-purple-300 hover:text-white border border-purple-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer">
                        <i class="ph ph-printer text-base"></i>
                        <span>طباعة</span>
                    </button>
                    <button type="button" onclick="viewCustomerOrderDetails('${order.id}')" class="px-4 py-2 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer">
                        <i class="ph ph-eye text-base"></i>
                        <span>عرض التفاصيل</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

export async function searchVisitorOrders(targetQuery = null) {
    const input = document.getElementById('visitor-order-query-input');
    const rawQuery = (targetQuery !== null && targetQuery !== undefined ? targetQuery : input?.value) || '';
    const query = rawQuery.trim();
    if (!query) {
        showToast('يرجى كتابة رقم الهاتف أو كود الطلب أولاً للاستعلام', 'warning');
        loadVisitorOrdersHistory();
        return;
    }

    if (input && targetQuery) {
        input.value = targetQuery;
    }

    // تنظيف الكود من أي علامات # ومسافات
    const cleanCode = query.replace(/[#\s]/g, '').trim();
    if (!cleanCode) {
        showToast('يرجى كتابة كود طلب أو رقم هاتف صحيح', 'warning');
        return;
    }

    // حفظ الكود المستعلم عنه في سجل الأكواد وتحديث الـ chips
    saveQueriedCode(cleanCode);

    const listEl = document.getElementById('visitor-orders-history-list');
    const titleEl = document.getElementById('visitor-orders-section-title');
    if (titleEl) titleEl.textContent = `نتائج الاستعلام عن: "#${cleanCode.toUpperCase()}"`;

    if (listEl) {
        listEl.innerHTML = `
            <div class="p-8 text-center bg-devo-dark border border-devo-gray rounded-2xl">
                <i class="ph ph-spinner animate-spin text-2xl text-devo-orange"></i>
                <p class="text-xs text-devo-muted mt-2">جاري البحث عن طلباتك في النظام...</p>
            </div>
        `;
    }

    try {
        const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleanCode);
        const cleanHex = cleanCode.replace(/[^0-9a-f]/gi, '').toLowerCase();
        const isHexPrefix = cleanHex.length >= 3 && cleanHex.length <= 32;

        const fetchPromises = [];

        // 1. إذا كان UUID كامل
        if (isFullUuid) {
            fetchPromises.push(
                supabase.from('visitor_orders').select('*').eq('id', cleanCode)
            );
        }
        // 2. إذا كان كود هيكس (كود الطلب المكون من 3 إلى 32 خانة)
        if (isHexPrefix) {
            const hex = cleanHex;
            const lowerHex = hex.padEnd(32, '0');
            const upperHex = hex.padEnd(32, 'f');
            const lowerUuid = `${lowerHex.slice(0,8)}-${lowerHex.slice(8,12)}-${lowerHex.slice(12,16)}-${lowerHex.slice(16,20)}-${lowerHex.slice(20,32)}`;
            const upperUuid = `${upperHex.slice(0,8)}-${upperHex.slice(8,12)}-${upperHex.slice(12,16)}-${upperHex.slice(16,20)}-${upperHex.slice(20,32)}`;

            fetchPromises.push(
                supabase.from('visitor_orders')
                    .select('*')
                    .gte('id', lowerUuid)
                    .lte('id', upperUuid)
                    .order('created_at', { ascending: false })
            );
        }

        // 3. بحث برقم الهاتف أو الاسم أو الملاحظات
        fetchPromises.push(
            supabase.from('visitor_orders')
                .select('*')
                .or(`phone_1.ilike.%${cleanCode}%,phone_2.ilike.%${cleanCode}%,customer_name.ilike.%${cleanCode}%`)
                .order('created_at', { ascending: false })
        );

        const responses = await Promise.all(fetchPromises);
        let foundOrders = [];
        responses.forEach(res => {
            if (res.error) {
                console.warn('[VisitorCart] Search sub-query warning:', res.error);
            }
            if (res.data && Array.isArray(res.data)) {
                res.data.forEach(order => {
                    if (!foundOrders.some(o => String(o.id) === String(order.id))) {
                        foundOrders.push(order);
                    }
                });
            }
        });

        // التحقق من السجل المحلي وإزالة أي طلب تم حذفه من قاعدة البيانات
        const localOrders = getLocalOrdersHistory();
        const searchLower = cleanCode.toLowerCase();
        
        localOrders.forEach(lo => {
            const matchId = (lo.id && lo.id.toLowerCase().startsWith(searchLower)) ||
                            (lo.code && lo.code.toLowerCase().startsWith(searchLower)) ||
                            (lo.id && lo.id.toLowerCase().replace(/-/g, '').startsWith(searchLower));
            const matchPhone = (lo.phone_1 && lo.phone_1.includes(cleanCode)) || (lo.phone_2 && lo.phone_2.includes(cleanCode));
            const matchName = lo.customer_name && lo.customer_name.includes(cleanCode);

            // إذا كان الطلب مسجل محلياً وطابق شروط البحث ولكن لم تجده قاعدة البيانات إطلاقاً
            // فهذا يعني أن الأدمن قام بحذفه، فيتم حذفه من الذاكرة المحلية فوراً وعدم إضافته لنتائج البحث
            if (matchId || matchPhone || matchName) {
                const stillExists = foundOrders.some(fo => String(fo.id) === String(lo.id));
                if (!stillExists) {
                    removeOrderFromLocalHistory(lo.id);
                }
            }
        });

        // ترتيب الطلبات الحية من الأحدث للأقدم
        foundOrders.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

        // تحديث الطلبات الحية في السجل المحلي وتحديث الشارة
        if (foundOrders.length > 0) {
            foundOrders.forEach(order => saveOrderToLocalHistory(order));
        }
        updateVisitorOrdersHistoryBadge();

        renderVisitorOrdersHistoryList(foundOrders, true);

    } catch (err) {
        console.error('[VisitorCart] Search error:', err);
        showToast('حدث خطأ أثناء الاستعلام: ' + (err.message || 'خطأ غير معروف'), 'error');
        renderVisitorOrdersHistoryList([], true);
    }
}

export async function viewCustomerOrderDetails(orderId) {
    const modal = document.getElementById('visitor-order-details-modal');
    const contentEl = document.getElementById('vod-modal-content');
    const codeEl = document.getElementById('vod-order-code');
    const dateEl = document.getElementById('vod-order-date');
    const badgeEl = document.getElementById('vod-status-badge');
    const printBtn = document.getElementById('vod-btn-print');

    if (!modal || !contentEl) return;

    // إظهار المودال مع حالة تحميل
    const shortId = (orderId || '').toString().split('-')[0].toUpperCase();
    if (codeEl) codeEl.textContent = `#${shortId}`;
    if (dateEl) dateEl.textContent = 'جاري التحميل...';
    if (printBtn) printBtn.onclick = () => printCustomerVisitorOrder(orderId);

    contentEl.innerHTML = `
        <div class="py-16 text-center">
            <i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i>
            <p class="text-xs text-devo-muted mt-2">جاري جلب تفاصيل الطلب والأصناف...</p>
        </div>
    `;

    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('div')?.classList.remove('scale-95');
    }, 10);

    try {
        let order = null;
        let items = [];

        const shortId = (orderId || '').toString().split('-')[0].toUpperCase();

        try {
            const [{ data: dbOrder }, { data: dbItems }] = await Promise.all([
                supabase.from('visitor_orders').select('*').eq('id', orderId).maybeSingle(),
                supabase.from('visitor_order_items').select('*').eq('visitor_order_id', orderId)
            ]);
            if (dbOrder) {
                order = dbOrder;
                if (dbItems && dbItems.length > 0) items = dbItems;
            } else {
                // الطلب غير موجود في قاعدة البيانات (تم حذفه من قِبل الأدمن)
                removeOrderFromLocalHistory(orderId);
                closeCustomerOrderDetailsModal();
                showToast('عذراً، هذا الطلب غير موجود في النظام (قد تم حذفه من قبل الإدارة)', 'warning');
                loadVisitorOrdersHistory(true);
                return;
            }
        } catch (dbEx) {
            console.warn('[VisitorCart] DB fetch warning in viewCustomerOrderDetails:', dbEx);
        }

        if (!order) {
            removeOrderFromLocalHistory(orderId);
            closeCustomerOrderDetailsModal();
            showToast('تعذر العثور على بيانات هذا الطلب في النظام', 'warning');
            return;
        }

        if (dateEl) {
            dateEl.textContent = order.created_at ? new Date(order.created_at).toLocaleString('ar-EG', {
                year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
            }) : '---';
        }

        if (badgeEl) {
            if (order.status === 'approved') {
                badgeEl.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
                badgeEl.innerHTML = '<i class="ph ph-check-circle"></i> تم القبول والاعتماد';
            } else if (order.status === 'rejected') {
                badgeEl.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/40';
                badgeEl.innerHTML = '<i class="ph ph-x-circle"></i> تم الرفض';
            } else if (order.status === 'ignored') {
                badgeEl.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-500/20 text-gray-400 border border-gray-500/40';
                badgeEl.innerHTML = '<i class="ph ph-prohibit"></i> ملغي';
            } else if (order.status === 'archived') {
                badgeEl.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/40';
                badgeEl.innerHTML = '<i class="ph ph-archive"></i> مؤرشف';
            } else {
                badgeEl.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40';
                badgeEl.innerHTML = '<i class="ph ph-clock"></i> قيد المراجعة';
            }
        }

        const rejectionSection = (order.status === 'rejected' || order.status === 'ignored') ? `
            <div class="bg-gradient-to-r from-rose-950/70 to-devo-black border-2 border-rose-500/40 rounded-xl p-3.5 sm:p-4 text-xs text-rose-100 shadow-md space-y-2">
                <div class="flex items-center justify-between flex-wrap gap-2 text-rose-400 font-bold text-sm">
                    <div class="flex items-center gap-2">
                        <i class="ph ph-x-circle text-2xl text-rose-400"></i>
                        <span>تم رفض هذا الطلب من قبل الإدارة</span>
                    </div>
                    ${order.reviewed_by ? `<span class="text-[11px] font-normal text-rose-300/80">المسؤول: ${escapeHtml(order.reviewed_by)}</span>` : ''}
                </div>
                <div class="bg-devo-black/90 border border-rose-500/30 rounded-lg p-3 space-y-1">
                    <span class="text-rose-300 font-bold block text-[11px]">سبب الرفض المسجل:</span>
                    <p class="text-white font-bold text-xs sm:text-sm leading-relaxed">${escapeHtml(order.rejection_reason || 'تم رفض الطلب لعدم توافر الكمية المطلوبة بالمخزن أو تعذر التواصل')}</p>
                </div>
                <p class="text-[11px] text-rose-300/70 pt-0.5">
                    إذا كانت لديك أي استفسارات أو رغبة في استبدال الموديل، يمكنك التواصل مع خدمة العملاء: <span class="text-white font-mono font-bold" dir="ltr">+20 12 12751111</span>
                </p>
            </div>
        ` : '';

        let totalPieces = 0;
        let totalSeries = 0;
        const itemsRows = (items && items.length > 0) ? items.map((item, idx) => {
            const qty = Number(item.quantity) || 1;
            const sizesCount = Number(item.sizes_count || item.sizesCount) || (item.models?.classes?.class_sizes?.length || item.models?.model_sizes?.length || 1);
            const rowPieces = qty * sizesCount;
            totalPieces += rowPieces;
            totalSeries += qty;
            return `
            <tr class="border-b border-devo-gray/40 hover:bg-devo-gray/10 text-xs text-white transition-colors">
                <td class="p-2.5 text-center text-devo-muted font-mono">${idx + 1}</td>
                <td class="p-2.5">
                    <div class="font-bold text-white">${escapeHtml(item.model_name || 'موديل')}</div>
                    ${item.factory_code ? `<span class="text-[10px] text-devo-muted font-mono block">${escapeHtml(item.factory_code)}</span>` : ''}
                </td>
                <td class="p-2.5 text-center">${escapeHtml(item.color_name || '---')}</td>
                <td class="p-2.5 text-center font-black text-devo-orange">
                    ${qty}
                    <span class="text-[10px] font-normal text-devo-muted block font-mono">(${rowPieces} ق)</span>
                </td>
                <td class="p-2.5 text-center font-mono text-devo-muted">${Number(item.price_per_series || 0).toLocaleString()} ج.م</td>
                <td class="p-2.5 text-center font-bold font-mono text-white">${Number(item.total_price || (qty * (item.price_per_series || 0))).toLocaleString()} ج.م</td>
            </tr>
        `;
        }).join('') : `
            <tr>
                <td colspan="6" class="p-4 text-center text-devo-muted text-xs">
                    لم يتم تسجيل تفاصيل الأصناف المفردة (الإجمالي مسجل أدناه).
                </td>
            </tr>
        `;

        contentEl.innerHTML = `
            <div class="space-y-4">
                <!-- شريط سبب الرفض إن وجد -->
                ${rejectionSection}

                <!-- كارت بيانات العميل والتوصيل -->
                <div class="bg-devo-black/70 border border-devo-gray rounded-xl p-4 text-xs space-y-2">
                    <h4 class="font-bold text-white flex items-center gap-1.5 border-b border-devo-gray/40 pb-2">
                        <i class="ph ph-user text-devo-orange"></i>
                        <span>بيانات العميل والتوصيل</span>
                    </h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-devo-muted">
                        <div><span class="text-devo-muted">الاسم:</span> <b class="text-white mr-1">${escapeHtml(order.customer_name)}</b></div>
                        <div><span class="text-devo-muted">الهاتف:</span> <b class="text-white font-mono mr-1" dir="ltr">${escapeHtml(order.phone_1)}</b> ${order.phone_2 ? ` | <span dir="ltr">${escapeHtml(order.phone_2)}</span>` : ''}</div>
                        <div class="sm:col-span-2"><span class="text-devo-muted">العنوان:</span> <span class="text-white mr-1">${escapeHtml(order.address || 'بدون عنوان')}</span></div>
                        ${order.notes ? `<div class="sm:col-span-2"><span class="text-devo-muted">ملاحظات:</span> <span class="text-white mr-1">${escapeHtml(order.notes)}</span></div>` : ''}
                    </div>
                </div>

                <!-- جدول الأصناف -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <h4 class="text-xs font-bold text-white flex items-center gap-1.5">
                            <i class="ph ph-package text-devo-orange"></i>
                            <span>الأصناف المطلوبة (${(items || []).length} صنف)</span>
                        </h4>
                    </div>

                    <div class="overflow-x-auto border border-devo-gray rounded-xl">
                        <table class="w-full text-right border-collapse">
                            <thead class="bg-devo-black text-[11px] text-devo-muted border-b border-devo-gray">
                                <tr>
                                    <th class="p-2.5 text-center">#</th>
                                    <th class="p-2.5 text-right">الموديل والكود</th>
                                    <th class="p-2.5 text-center">اللون</th>
                                    <th class="p-2.5 text-center">الكمية (سيريه / ق)</th>
                                    <th class="p-2.5 text-center">سعر السيريه</th>
                                    <th class="p-2.5 text-center">الإجمالي</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${itemsRows}
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Grand Totals -->
                <div class="bg-devo-black border border-devo-orange/30 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div class="flex items-center gap-4 flex-wrap text-xs">
                        <div>
                            <span class="text-devo-muted block text-[11px]">إجمالي الأصناف:</span>
                            <strong class="text-sm font-bold text-white">${(items || []).length} صنف</strong>
                        </div>
                        <div class="border-r border-devo-gray/50 pr-4">
                            <span class="text-devo-muted block text-[11px]">إجمالي السريات:</span>
                            <strong class="text-sm font-bold text-white">${Number(order.total_series || totalSeries || 0)} سيريه</strong>
                        </div>
                        <div class="border-r border-devo-gray/50 pr-4">
                            <span class="text-devo-muted block text-[11px]">إجمالي القطع:</span>
                            <strong class="text-sm font-bold text-amber-400">${Number(totalPieces || 0).toLocaleString()} قطعة</strong>
                        </div>
                    </div>
                    <div class="text-left">
                        <span class="text-[11px] text-devo-muted block">الإجمالي الكلي المطلوب:</span>
                        <span class="text-lg font-black text-devo-orange">${Number(order.total_price || 0).toLocaleString()} ج.م</span>
                    </div>
                </div>
            </div>
        `;

    } catch (err) {
        console.error('[VisitorCart] View details error:', err);
        showToast('تعذر تحميل تفاصيل الطلب: ' + (err.message || 'خطأ غير معروف'), 'error');
        closeCustomerOrderDetailsModal();
    }
}

export function closeCustomerOrderDetailsModal() {
    const modal = document.getElementById('visitor-order-details-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    modal.querySelector('div')?.classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

export async function printCustomerVisitorOrder(orderId) {
    showToast('جاري تجهيز الفاتورة للطباعة...', 'info');

    try {
        let order = null;
        let items = [];
        const shortId = (orderId || '').toString().split('-')[0].toUpperCase();

        try {
            const [{ data: dbOrder }, { data: dbItems }] = await Promise.all([
                supabase.from('visitor_orders').select('*').eq('id', orderId).maybeSingle(),
                supabase.from('visitor_order_items').select('*, models(id, name, factory_code, system_code, price, classes(class_sizes), model_sizes)').eq('visitor_order_id', orderId)
            ]);
            if (dbOrder) {
                order = dbOrder;
                if (dbItems && dbItems.length > 0) items = dbItems;
            } else {
                // الطلب غير موجود في قاعدة البيانات (تم حذفه من قِبل الأدمن)
                removeOrderFromLocalHistory(orderId);
                showToast('تعذر طباعة الفاتورة؛ هذا الطلب لم يعد موجوداً في النظام (قد تم حذفه من قِبل الإدارة)', 'warning');
                loadVisitorOrdersHistory(true);
                return;
            }
        } catch (dbEx) {
            console.warn('[VisitorCart] DB print fetch warning:', dbEx);
        }

        if (!order) {
            removeOrderFromLocalHistory(orderId);
            showToast('تعذر العثور على بيانات الطلب لطباعته', 'warning');
            return;
        }

        const printHtml = generateCustomerVisitorOrderInvoiceHtml(order, items || []);
        printHtmlInIframe(printHtml);

    } catch (err) {
        console.error('[VisitorCart] Print error:', err);
        showToast('حدث خطأ أثناء إعداد الطباعة: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
}

function generateCustomerVisitorOrderInvoiceHtml(order, items) {
    const shortId = (order.id || '').toString().split('-')[0].toUpperCase();
    const dateStr = order.created_at ? new Date(order.created_at).toLocaleString('ar-EG', {
        year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '---';

    let statusText = 'قيد المراجعة';
    let statusColor = '#b45309';

    if (order.status === 'approved') {
        statusText = 'معتمد ومقبول';
        statusColor = '#047857';
    } else if (order.status === 'rejected' || order.status === 'ignored') {
        statusText = 'مرفوض';
        statusColor = '#b91c1c';
    } else if (order.status === 'archived') {
        statusText = 'مؤرشف';
        statusColor = '#4b5563';
    }

    // Phone cleanup: If phone_2 matches phone_1, don't repeat it
    const p1 = (order.phone_1 || '').trim();
    const p2 = (order.phone_2 || '').trim();
    let phoneDisplay = p1;
    if (p2 && p2 !== p1) {
        phoneDisplay = `${p1} &nbsp;|&nbsp; <span style="color:#555; font-weight:normal;">إضافي:</span> ${p2}`;
    }

    // Address cleanup: Don't show placeholder texts like 'بدون عنوان' or '-'
    let cleanAddress = (order.address || '').trim();
    if (cleanAddress === 'بدون عنوان' || cleanAddress === '-' || cleanAddress === 'null' || cleanAddress === 'undefined') {
        cleanAddress = '';
    }

    // Notes cleanup
    let cleanNotes = (order.notes || '').trim();
    if (cleanNotes === 'null' || cleanNotes === 'undefined' || cleanNotes === '-') {
        cleanNotes = '';
    }

    let totalPieces = 0;
    let totalSeries = 0;
    const itemsRows = items.map((item, idx) => {
        const qty = Number(item.quantity) || 1;
        const sizesCount = Number(item.sizes_count || item.sizesCount) || (item.models?.classes?.class_sizes?.length || item.models?.model_sizes?.length || 1);
        const rowPieces = qty * sizesCount;
        totalPieces += rowPieces;
        totalSeries += qty;
        const rowTotal = qty * (Number(item.price_per_series) || 0);
        return `
            <tr>
                <td style="padding: 3px 4px; border: 1px solid #000; text-align: center; font-family: monospace; font-size: 10px;">${idx + 1}</td>
                <td style="padding: 3px 6px; border: 1px solid #000; font-weight: bold; text-align: right;">
                    ${escapeHtml(item.model_name || 'موديل')}
                    ${item.factory_code ? `<span style="font-size:10px; color:#475569; font-family: monospace; margin-right: 4px; font-weight: normal;">(${escapeHtml(item.factory_code)})</span>` : ''}
                </td>
                <td style="padding: 3px 6px; border: 1px solid #000; text-align: center;">${escapeHtml(item.color_name || '---')}</td>
                <td style="padding: 3px 6px; border: 1px solid #000; text-align: center; font-weight: bold; font-size: 11px;">
                    ${qty}
                    <span style="font-size: 9.5px; font-weight: normal; color: #475569; display: inline-block; margin-right: 2px;">(${rowPieces} ق)</span>
                </td>
                <td style="padding: 3px 6px; border: 1px solid #000; text-align: center; font-family: monospace;">${Number(item.price_per_series || 0).toLocaleString()} ج.م</td>
                <td style="padding: 3px 6px; border: 1px solid #000; text-align: center; font-weight: bold; font-family: monospace; background: #f8fafc !important;">${rowTotal.toLocaleString()} ج.م</td>
            </tr>
        `;
    }).join('');

    return `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title></title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
                @page {
                    size: A4 portrait;
                    margin: 0;
                }
                @media print {
                    html, body {
                        margin: 0 !important;
                        padding: 0 !important;
                        background: #ffffff !important;
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }
                    .print-page {
                        padding: 6mm 10mm !important;
                        box-sizing: border-box !important;
                        width: 100% !important;
                    }
                }
                body {
                    font-family: 'Tajawal', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: #ffffff;
                    margin: 0;
                    padding: 6mm 10mm;
                    color: #000000;
                    box-sizing: border-box;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
            </style>
        </head>
        <body>
            <div class="print-page">
                <!-- Compact Header -->
                <div style="border-bottom: 2px solid #000; padding-bottom: 4px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: flex-end;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <div style="display: inline-flex; align-items: center; gap: 5px; direction: ltr;">
                            <span style="font-size: 18px; font-weight: 900; letter-spacing: 1px; color: #000; line-height: 1;">DEVO</span>
                            <span style="background: #000; color: #fff; padding: 2px 6px; border-radius: 3px; font-size: 9.5px; font-weight: 800; letter-spacing: 1.5px; line-height: 1.1; display: inline-block; vertical-align: middle;">COLLECTION</span>
                        </div>
                        <span style="color: #cbd5e1; font-weight: 300; font-size: 12px; margin: 0 2px;">|</span>
                        <span style="font-size: 10.5px; color: #444; white-space: nowrap;">خدمة العملاء: <span dir="ltr" style="font-family: monospace; font-weight: bold; color: #000;">+20 12 12751111</span></span>
                    </div>
                    <div style="text-align: left; font-size: 11px;">
                        <b style="font-size: 13px; color: #000;">فاتورة طلب عميل</b>
                        <span style="color: #666; margin-right: 6px; font-family: monospace;">(#${shortId})</span>
                        <span style="font-size: 10px; color: ${statusColor}; font-weight: bold; margin-right: 4px;">[${statusText}]</span>
                    </div>
                </div>

                <!-- Customer Details Strip -->
                <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 8px; margin-bottom: 6px; font-size: 11px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                        <div><b>العميل:</b> <span style="font-weight: bold; color: #000;">${escapeHtml(order.customer_name || 'بدون اسم')}</span></div>
                        <div><b>الهاتف:</b> <span dir="ltr" style="font-family: monospace; font-weight: bold;">${phoneDisplay}</span></div>
                        ${cleanAddress ? `<div><b>العنوان:</b> <span>${escapeHtml(cleanAddress)}</span></div>` : ''}
                    </div>
                    <div style="display: flex; gap: 10px; align-items: center; font-size: 10.5px; color: #475569;">
                        <div><b>التاريخ:</b> <span>${dateStr}</span></div>
                    </div>
                </div>

                <!-- Notes if any -->
                ${cleanNotes ? `
                    <div style="margin-bottom: 6px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 4px; padding: 3px 8px; font-size: 10.5px; color: #92400e;">
                        <b>ملاحظات:</b> ${escapeHtml(cleanNotes)}
                    </div>
                ` : ''}

                <!-- Rejection Reason if any -->
                ${(order.status === 'rejected' || order.status === 'ignored') ? `
                    <div style="background: #fef2f2; padding: 4px 8px; border: 1.5px solid #fca5a5; border-radius: 4px; margin-bottom: 6px; font-size: 11px; color: #991b1b; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
                        <b>سبب رفض الطلب:</b> <span style="font-weight: bold;">${escapeHtml(order.rejection_reason || 'تم رفض الطلب من قبل الإدارة لعدم توفر الكمية المطلوبة')}</span>
                    </div>
                ` : ''}

                <!-- Items Table -->
                <table style="border: 1px solid #000; font-size: 11px; margin-bottom: 6px;">
                    <thead style="background: #e2e8f0 !important; color: #000 !important; -webkit-print-color-adjust: exact;">
                        <tr>
                            <th style="padding: 3px 4px; border: 1px solid #000; width: 28px; text-align: center;">م</th>
                            <th style="padding: 3px 6px; border: 1px solid #000; text-align: right;">الموديل والكود</th>
                            <th style="padding: 3px 6px; border: 1px solid #000; width: 85px; text-align: center;">اللون</th>
                            <th style="padding: 3px 6px; border: 1px solid #000; width: 95px; text-align: center;">الكمية (سيريه / ق)</th>
                            <th style="padding: 3px 6px; border: 1px solid #000; width: 85px; text-align: center;">سعر السيريه</th>
                            <th style="padding: 3px 6px; border: 1px solid #000; width: 95px; text-align: center;">الإجمالي</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsRows}
                    </tbody>
                </table>

                <!-- Summary & Totals -->
                <div style="display: flex; justify-content: flex-end; margin-top: 6px; page-break-inside: avoid;">
                    <div style="border: 1.5px solid #000; width: 230px; border-radius: 4px; overflow: hidden; background: #ffffff;">
                        <div style="padding: 3px 8px; border-bottom: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 10.5px;">
                            <span style="color: #475569;">إجمالي الأصناف:</span>
                            <b style="color: #000;">${items.length} صنف</b>
                        </div>
                        <div style="padding: 3px 8px; border-bottom: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 10.5px; background: #f8fafc !important;">
                            <span style="color: #475569;">إجمالي السريات:</span>
                            <b style="color: #000;">${order.total_series || totalSeries} سيريه</b>
                        </div>
                        <div style="padding: 3px 8px; border-bottom: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 10.5px;">
                            <span style="color: #475569;">إجمالي القطع:</span>
                            <b style="color: #000;">${totalPieces.toLocaleString()} قطعة</b>
                        </div>
                        <div style="padding: 4px 8px; display: flex; justify-content: space-between; font-size: 12px; background: #000 !important; color: #fff !important; font-weight: bold; -webkit-print-color-adjust: exact;">
                            <span>الإجمالي الكلي:</span>
                            <span style="font-size: 13px; font-family: monospace;">${Number(order.total_price || 0).toLocaleString()} ج.م</span>
                        </div>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
}

export function copyVisitorOrderCode(code) {
    if (!code) return;
    const clean = code.toString().replace(/^#/, '').trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(clean).then(() => {
            showToast(`تم نسخ كود الطلب (#${clean}) بنجاح`, 'success');
        }).catch(() => {
            prompt('انسخ كود الطلب:', clean);
        });
    } else {
        prompt('انسخ كود الطلب:', clean);
    }
}

// ==========================================
// 📡 رادار التزامن اللحظي لطلبات الزائر (Realtime Sync)
// ==========================================
export function setupVisitorOrdersRealtime() {
    try {
        supabase.channel('visitor_orders_live_sync')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'visitor_orders' }, payload => {
                if (payload.eventType === 'DELETE') {
                    const deletedId = payload.old?.id;
                    if (deletedId) {
                        removeOrderFromLocalHistory(deletedId);
                        cachedVisitorHistoryOrders = cachedVisitorHistoryOrders.filter(o => String(o.id) !== String(deletedId));
                        renderVisitorOrdersHistoryList(cachedVisitorHistoryOrders);
                        updateVisitorOrdersHistoryBadge();

                        // إغلاق المودال تلقائياً إذا كان الزائر فاتحه للطلب المحذوف
                        const modal = document.getElementById('visitor-order-details-modal');
                        const codeEl = document.getElementById('vod-order-code');
                        const shortDeleted = String(deletedId).split('-')[0].toUpperCase();
                        if (modal && !modal.classList.contains('hidden') && codeEl?.textContent?.includes(shortDeleted)) {
                            closeCustomerOrderDetailsModal();
                            showToast('تم حذف هذا الطلب من قبل الإدارة', 'warning');
                        }
                    }
                } else if (payload.eventType === 'UPDATE') {
                    const updated = payload.new;
                    if (updated && updated.id) {
                        const localOrders = getLocalOrdersHistory();
                        const idx = localOrders.findIndex(o => String(o.id) === String(updated.id));
                        if (idx >= 0) {
                            localOrders[idx] = { ...localOrders[idx], ...updated };
                            saveLocalOrdersHistory(localOrders);
                            cachedVisitorHistoryOrders = localOrders;
                            renderVisitorOrdersHistoryList(localOrders);

                            // تحديث المودال لحظياً إذا كان الزائر فاتحه
                            const modal = document.getElementById('visitor-order-details-modal');
                            const codeEl = document.getElementById('vod-order-code');
                            const shortUpdated = String(updated.id).split('-')[0].toUpperCase();
                            if (modal && !modal.classList.contains('hidden') && codeEl?.textContent?.includes(shortUpdated)) {
                                viewCustomerOrderDetails(updated.id);
                            }
                        }
                    }
                }
            })
            .subscribe();
    } catch (e) {
        console.warn('[VisitorCart] Realtime setup error:', e);
    }
}
