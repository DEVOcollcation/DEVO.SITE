import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js'; 

let currentUser = null;
let cartItems = [];
let itemToDeleteIndex = null;
let editingOrderId = null; 
let cartRealtimeChannel = null;

export function initCart() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    
    if (currentUser) {
        document.getElementById('checkout-form')?.addEventListener('submit', handleCheckout);
        window.refreshCartView = loadAndRenderCart;
        window.showInvoiceModal = showInvoiceModal;
        
        document.getElementById('c-deposit')?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || 0;
            document.getElementById('c-receiver').required = val > 0;
        });

        loadAndRenderCart();
        setupCartRealtime(); 
    }
}

// ==========================================
// 🌟 1. الرادار اللحظي للسلة
// ==========================================
function setupCartRealtime() {
    if (cartRealtimeChannel) return;
    
    cartRealtimeChannel = supabase.channel('cart_realtime_sync')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'model_inventory' }, (payload) => {
            const { model_id, color_id, available_series } = payload.new;
            const itemInCart = cartItems.find(i => i.modelId === model_id && i.colorId === color_id);
            
            if (itemInCart && !editingOrderId) { // لا نزعج المستخدم بالرادار أثناء التعديل المباشر
                if (available_series === 0) {
                    showToast(`⚠️ الموديل (${itemInCart.modelName}) الموجود بسلتك قد نفذت كميته للتو!`, 'error');
                } else if (itemInCart.qty > available_series) {
                    showToast(`⚠️ انخفض مخزون الموديل (${itemInCart.modelName}) الموجود بسلتك، يرجى مراجعة السلة!`, 'warning');
                }
                if (!document.getElementById('view-cart')?.classList.contains('hidden')) {
                    loadAndRenderCart();
                }
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, (payload) => {
            const isDeleted = payload.eventType === 'DELETE';
            const isDisabled = payload.eventType === 'UPDATE' && payload.new.is_active === false;
            
            if (isDeleted || isDisabled) {
                const targetId = isDeleted ? payload.old.id : payload.new.id;
                const itemInCart = cartItems.find(i => i.modelId === targetId);
                
                if (itemInCart) {
                    showToast(`⚠️ الموديل (${itemInCart.modelName}) لم يعد متاحاً للطلب! يرجى إزالته من السلة.`, 'error');
                    if (!document.getElementById('view-cart')?.classList.contains('hidden')) {
                        loadAndRenderCart();
                    }
                }
            }
        })
        .subscribe();
}

// ==========================================
// 🌟 2. تحميل ورسم السلة (بمعادلة المتاح الحقيقي) 🌟
// ==========================================
async function loadAndRenderCart() {
    const saved = localStorage.getItem('devo_cart');
    if (saved) { try { cartItems = JSON.parse(saved); } catch(e) { cartItems = []; } }

    // 🌟 نقلنا تعبئة البيانات هنا لتعمل في كل مرة يفتح فيها الموظف السلة 🌟
    let originalOrderData = null;
    const savedOrderData = localStorage.getItem('devo_edit_order_data');
    if (savedOrderData) {
        try {
            originalOrderData = JSON.parse(savedOrderData);
            editingOrderId = originalOrderData.id;
            document.getElementById('c-name').value = originalOrderData.customer_name || '';
            document.getElementById('c-phone1').value = originalOrderData.phone_1 || '';
            document.getElementById('c-phone2').value = originalOrderData.phone_2 || '';
            document.getElementById('c-address').value = originalOrderData.address || '';
            document.getElementById('c-notes').value = originalOrderData.notes || ''; 
            document.getElementById('c-deposit').value = originalOrderData.deposit || 0;
            document.getElementById('c-receiver').value = originalOrderData.deposit_receiver || '';
        } catch(e) {}
    } else {
        editingOrderId = null;
        document.getElementById('checkout-form')?.reset();
    }

    const container = document.getElementById('cart-items-container');
    const checkoutBtn = document.getElementById('btn-checkout');
    
    const sumPriceEl = document.getElementById('sum-price');
    const sumModelsEl = document.getElementById('sum-models');
    const sumSeriesEl = document.getElementById('sum-series');

    if (cartItems.length === 0) {
        if (container) container.innerHTML = `<div class="text-center py-10 text-devo-muted"><i class="ph ph-shopping-cart-simple text-5xl mb-3 opacity-50"></i><p>السلة فارغة حالياً</p></div>`;
        if (sumPriceEl) sumPriceEl.textContent = '0'; 
        if (sumModelsEl) sumModelsEl.textContent = '0';
        if (sumSeriesEl) sumSeriesEl.textContent = '0';

        if (checkoutBtn) { checkoutBtn.disabled = true; checkoutBtn.innerHTML = `تأكيد وإصدار الفاتورة`; checkoutBtn.classList.replace('bg-devo-orange', 'bg-devo-gray'); }
        updateFloatingCart();
        return;
    }

    if (container) container.innerHTML = `<div class="text-center py-10"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i><p class="text-xs text-devo-muted mt-2">جاري مطابقة المخزون مع السيرفر...</p></div>`;

    const modelIds = [...new Set(cartItems.map(i => i.modelId))];

    const [{ data: dbInventory }, { data: dbModels }] = await Promise.all([
        supabase.from('model_inventory').select('model_id, color_id, available_series').in('model_id', modelIds),
        supabase.from('models').select('id, is_active').in('id', modelIds)
    ]);

    renderCartItems(dbInventory || [], dbModels || [], originalOrderData);
    updateFloatingCart();
    
    if(window.filterCartItems) window.filterCartItems();
}

function renderCartItems(dbInventory, dbModels, originalOrderData) {
    const container = document.getElementById('cart-items-container');
    const checkoutBtn = document.getElementById('btn-checkout');
    
    let html = '';
    let totalOrderPrice = 0;
    let totalSeriesCount = 0;
    let hasErrors = false;

    cartItems.forEach((item, index) => {
        const dbInv = dbInventory.find(i => i.model_id === item.modelId && i.color_id === item.colorId);
        const dbModel = dbModels.find(m => m.id === item.modelId);

        let errorMsg = null;
        let availableInDB = dbInv ? dbInv.available_series : 0;

        // 🌟 السحر هنا: معادلة المتاح الحقيقي (True Available) 🌟
        // نضيف الكمية التي يملكها الأوردر بالفعل إلى كمية المخزن
        let ownedQty = 0;
        if (editingOrderId && originalOrderData && originalOrderData.original_items) {
            const oldItem = originalOrderData.original_items.find(oi => oi.model_id === item.modelId && oi.color_id === item.colorId);
            if (oldItem) ownedQty = oldItem.quantity;
        }
        
        const trueAvailable = availableInDB + ownedQty;

        if (!dbModel || !dbModel.is_active) {
            errorMsg = "الموديل غير متاح (تم إيقافه أو حذفه من الإدارة).";
            hasErrors = true;
        } else if (trueAvailable === 0) {
            errorMsg = "نفذت الكمية تماماً من المخزن.";
            hasErrors = true;
        } else if (item.qty > trueAvailable) {
            errorMsg = `المطلوب (${item.qty}) غير متاح. أقصى حد متاح لك: ${trueAvailable} سيريه.`;
            hasErrors = true;
        }

        const pricePerPiece = parseFloat(item.price) || 0;
        const piecesPerSeries = parseInt(item.sizesCount) || 1; 
        const pricePerSeries = pricePerPiece * piecesPerSeries; 
        const itemTotalPrice = pricePerSeries * item.qty; 

        // حتى لو فيه خطأ، نعرض السعر للمنتجات السليمة لنرى الإجمالي
        if (!errorMsg) {
            totalOrderPrice += itemTotalPrice;
            totalSeriesCount += item.qty;
        }

        const cardClass = errorMsg ? 'bg-devo-error/10 border-devo-error shadow-[0_0_10px_rgba(239,68,68,0.2)]' : 'bg-devo-dark border-devo-gray';
        const imgClass = errorMsg ? 'grayscale opacity-60' : '';

        html += `
            <div class="cart-item-card flex gap-3 md:gap-4 p-3 ${cardClass} border rounded-xl relative transition-all duration-300 mb-3" data-search="${item.modelName} ${item.factoryCode || ''}">
                <img src="${item.image}" class="w-20 h-20 md:w-24 md:h-24 rounded-lg object-cover bg-devo-black shrink-0 ${imgClass}" onerror="this.src='./src/assets/icons/devo.jpeg'">
                <div class="flex flex-col flex-1 justify-between">
                    <div class="flex justify-between items-start">
                        <div>
                            <h4 class="text-white font-bold text-sm line-clamp-1">${item.modelName}</h4>
                            
                            <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <span class="text-devo-muted text-[10px] font-mono bg-devo-black px-2 py-0.5 rounded border border-devo-gray" title="كود الموديل"><i class="ph ph-barcode"></i> ${item.factoryCode || 'بدون كود'}</span>
                                <span class="text-devo-muted text-[10px] bg-devo-black px-2 py-0.5 rounded border border-devo-gray" title="عدد القطع في السيريه الواحد"><i class="ph ph-ruler"></i> ${piecesPerSeries} قطع</span>
                                <span class="text-devo-info text-[10px] bg-devo-info/10 px-2 py-0.5 rounded border border-devo-info/20" title="سعر القطعة الواحدة"><i class="ph ph-tag"></i> ق: ${pricePerPiece} ج</span>
                                <span class="text-devo-orange text-[10px] bg-devo-orange/10 px-2 py-0.5 rounded border border-devo-orange/20" title="سعر السيريه الكامل"><i class="ph ph-stack"></i> سيريه: ${pricePerSeries} ج</span>
                            </div>
                            
                            <p class="text-devo-info text-xs mt-1.5 font-bold"><i class="ph-fill ph-palette"></i> ${item.colorName}</p>
                        </div>
                        <button type="button" onclick="confirmRemoveFromCart(${index})" class="text-devo-error hover:bg-devo-error/20 p-1.5 rounded transition-colors shrink-0" title="إزالة من السلة"><i class="ph ph-trash text-lg md:text-xl"></i></button>
                    </div>

                    ${errorMsg ? `
                        <div class="mt-2 p-2 bg-devo-error/20 border border-devo-error/40 rounded flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between">
                            <span class="text-devo-error text-[11px] font-bold flex items-center gap-1"><i class="ph ph-warning-circle text-sm"></i> ${errorMsg}</span>
                            ${trueAvailable > 0 ? `<button type="button" onclick="updateCartItemQty(${index}, ${trueAvailable}, ${trueAvailable})" class="text-[10px] bg-devo-orange text-white px-3 py-1.5 rounded shadow whitespace-nowrap hover:bg-devo-orangeHover transition-colors font-bold">تصحيح لـ ${trueAvailable}</button>` : ''}
                        </div>
                    ` : `
                        <div class="flex justify-between items-end mt-2 border-t border-devo-gray/50 pt-2">
                            <div class="flex items-center bg-devo-black border border-devo-gray rounded-lg overflow-hidden h-8">
                                <button type="button" onclick="updateCartItemQty(${index}, ${item.qty - 1})" class="px-2 text-white hover:text-devo-orange transition-colors h-full"><i class="ph ph-minus"></i></button>
                                <input type="number" readonly value="${item.qty}" class="w-10 h-full bg-transparent text-center text-white text-xs font-bold outline-none border-x border-devo-gray">
                                <button type="button" onclick="updateCartItemQty(${index}, ${item.qty + 1}, ${trueAvailable})" class="px-2 text-white hover:text-devo-orange transition-colors h-full"><i class="ph ph-plus"></i></button>
                            </div>
                            <div class="text-left">
                                <p class="text-devo-orange font-black text-sm">${itemTotalPrice.toLocaleString()} ج.م</p>
                                <p class="text-devo-muted text-[9px] mt-0.5">إجمالي ${item.qty * piecesPerSeries} قطعة</p>
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;
    });

    if (container) container.innerHTML = html;
    
    const sumPriceEl = document.getElementById('sum-price');
    const sumModelsEl = document.getElementById('sum-models');
    const sumSeriesEl = document.getElementById('sum-series');

    if (sumPriceEl) sumPriceEl.textContent = totalOrderPrice.toLocaleString();
    if (sumModelsEl) sumModelsEl.textContent = cartItems.length;
    if (sumSeriesEl) sumSeriesEl.textContent = totalSeriesCount;

    if (checkoutBtn) {
        if (hasErrors) {
            checkoutBtn.disabled = true;
            checkoutBtn.innerHTML = `<i class="ph ph-prohibit"></i> يرجى تصحيح الأخطاء أولاً`;
            checkoutBtn.classList.add('bg-devo-gray', 'cursor-not-allowed');
            checkoutBtn.classList.remove('bg-devo-orange', 'hover:bg-devo-orangeHover');
        } else {
            checkoutBtn.disabled = false;
            checkoutBtn.innerHTML = editingOrderId ? `حفظ التعديلات وإصدار الفاتورة` : `تأكيد وإصدار الفاتورة`;
            checkoutBtn.classList.remove('bg-devo-gray', 'cursor-not-allowed');
            checkoutBtn.classList.add('bg-devo-orange', 'hover:bg-devo-orangeHover');
        }
    }
}

// 🌟 دالة إفراغ السلة بالكامل وإلغاء وضع التعديل 🌟
window.clearEntireCart = async () => {
    if (cartItems.length === 0 && !editingOrderId) {
        return showToast('السلة فارغة بالفعل', 'info');
    }

    const confirmed = await confirmDialog({ 
        title: 'إفراغ السلة', 
        message: 'هل أنت متأكد من رغبتك في إفراغ السلة بالكامل وإلغاء أي تعديلات جارية؟', 
        isDestructive: true 
    });
    
    if (confirmed) {
        cartItems = [];
        editingOrderId = null;
        localStorage.removeItem('devo_cart');
        localStorage.removeItem('devo_edit_order_data');
        
        const form = document.getElementById('checkout-form');
        if (form) form.reset();
        
        updateFloatingCart();
        loadAndRenderCart();
        showToast('تم إفراغ السلة وإلغاء وضع التعديل بنجاح', 'success');
    }
};

window.filterCartItems = () => {
    const term = document.getElementById('cart-search-input')?.value.toLowerCase().trim() || '';
    const cards = document.querySelectorAll('.cart-item-card');
    
    cards.forEach(card => {
        const searchText = card.getAttribute('data-search').toLowerCase();
        if (term === '' || searchText.includes(term)) {
            card.style.display = '';
        } else {
            card.style.display = 'none';
        }
    });
};

window.updateCartItemQty = (index, newQty, maxAvailable = null) => {
    if (newQty < 1) return;
    if (maxAvailable !== null && newQty > maxAvailable) {
        return showToast(`أقصى كمية متاحة لك الآن هي ${maxAvailable}`, 'warning');
    }
    cartItems[index].qty = newQty;
    saveCart();
    loadAndRenderCart(); 
};

// ==========================================
// 🌟 3. الدفع وتأكيد الأوردر مع المخزون 🌟
// ==========================================
async function handleCheckout(e) {
    e.preventDefault();
    if (cartItems.length === 0) return showToast('السلة فارغة!', 'error');

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري التحقق والتأكيد...`;

    try {
        const modelIds = [...new Set(cartItems.map(i => i.modelId))];
        const [{ data: dbInv }, { data: dbMod }] = await Promise.all([
            supabase.from('model_inventory').select('model_id, color_id, available_series').in('model_id', modelIds),
            supabase.from('models').select('id, is_active').in('id', modelIds)
        ]);

        let originalOrderData = null;
        if (editingOrderId) {
            const savedData = localStorage.getItem('devo_edit_order_data');
            if (savedData) originalOrderData = JSON.parse(savedData);
        }

        let hasFinalErrors = false;
        cartItems.forEach(item => {
            const inv = dbInv?.find(i => i.model_id === item.modelId && i.color_id === item.colorId);
            const mod = dbMod?.find(m => m.id === item.modelId);
            
            let ownedQty = 0;
            if (editingOrderId && originalOrderData && originalOrderData.original_items) {
                 const oldItem = originalOrderData.original_items.find(oi => oi.model_id === item.modelId && oi.color_id === item.colorId);
                 if (oldItem) ownedQty = oldItem.quantity;
            }
            const trueAvail = (inv ? inv.available_series : 0) + ownedQty;

            if (!mod || !mod.is_active || trueAvail < item.qty) hasFinalErrors = true;
        });

        if (hasFinalErrors) {
            showToast('حدث تغيير في المخزن! يرجى مراجعة الأخطاء الموضحة باللون الأحمر في السلة.', 'error');
            await loadAndRenderCart(); 
            throw new Error('ValidationError');
        }

        const orderData = {
            worker_id: currentUser.id,
            customer_name: document.getElementById('c-name').value,
            phone_1: document.getElementById('c-phone1').value,
            phone_2: document.getElementById('c-phone2').value || null,
            address: document.getElementById('c-address').value || null,
            notes: document.getElementById('c-notes').value || null, 
            total_price: cartItems.reduce((sum, item) => sum + (item.qty * (item.sizesCount || 1) * item.price), 0),
            total_series: cartItems.reduce((sum, item) => sum + item.qty, 0),
            deposit: parseFloat(document.getElementById('c-deposit').value) || 0,
            deposit_receiver: document.getElementById('c-receiver').value || null,
            status: 'created'
        };

        let orderIdToPrint = null;
        let finalOrderObj = null;
        let oldOrderItems = []; 

        if (editingOrderId) {
            const { data: checkOrder } = await supabase.from('orders').select('is_locked').eq('id', editingOrderId).single();
            if (checkOrder && checkOrder.is_locked) {
                showToast('عفواً، لقد قامت الإدارة بقفل هذا الأوردر ولا يمكن تعديله الآن!', 'error');
                btn.disabled = false;
                btn.innerHTML = `حفظ التعديلات وإصدار الفاتورة`;
                return;
            }

            const { data: oldItemsData } = await supabase.from('order_items').select('*').eq('order_id', editingOrderId);
            oldOrderItems = oldItemsData || [];

            const { data: order, error: orderError } = await supabase.from('orders').update(orderData).eq('id', editingOrderId).select().single();
            if (orderError) throw orderError;
            
            await supabase.from('order_items').delete().eq('order_id', editingOrderId);
            orderIdToPrint = editingOrderId;
            finalOrderObj = order;
        } else {
            const { data: latestOrder } = await supabase.from('orders').select('invoice_number').order('created_at', { ascending: false }).limit(1);
            let nextInvNumber = '1000';
            if (latestOrder && latestOrder.length > 0) {
                const lastNum = parseInt(latestOrder[0].invoice_number);
                if (!isNaN(lastNum)) nextInvNumber = (lastNum + 1).toString();
                else nextInvNumber = Math.floor(Math.random() * 900000 + 100000).toString();
            }
            orderData.invoice_number = nextInvNumber;

            let insertRes = await supabase.from('orders').insert([orderData]).select().single();
            
            if (insertRes.error && insertRes.error.code === '23505') {
                orderData.invoice_number = nextInvNumber + '-' + Math.floor(Math.random() * 100);
                insertRes = await supabase.from('orders').insert([orderData]).select().single();
            }
            
            if (insertRes.error) throw insertRes.error;
            
            orderIdToPrint = insertRes.data.id;
            finalOrderObj = insertRes.data;
        }

        const orderItemsData = cartItems.map(item => ({
            order_id: orderIdToPrint,
            model_id: item.modelId,
            color_id: item.colorId,
            quantity: item.qty,
            price_per_series: item.price * (item.sizesCount || 1),
            total_price: item.qty * (item.sizesCount || 1) * item.price 
        }));

        const { error: itemsError } = await supabase.from('order_items').insert(orderItemsData);
        if (itemsError) throw itemsError;

        let movementsToInsert = [];
        let inventoryUpdates = [];
        const newItemsMap = {};
        cartItems.forEach(i => newItemsMap[`${i.modelId}_${i.colorId}`] = i.qty);

        if (editingOrderId) {
            const oldMap = {};
            oldOrderItems.forEach(i => oldMap[`${i.model_id}_${i.color_id}`] = i.quantity);
            const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newItemsMap)]);

            allKeys.forEach(key => {
                const [mId, cId] = key.split('_');
                const oldQ = oldMap[key] || 0;
                const newQ = newItemsMap[key] || 0;
                const diff = newQ - oldQ; 

                if (diff !== 0) {
                    const inv = dbInv.find(x => x.model_id === mId && x.color_id === cId);
                    if (inv) {
                        inventoryUpdates.push({ model_id: mId, color_id: cId, available_series: inv.available_series - diff });
                    }
                    movementsToInsert.push({
                        model_id: mId, 
                        color_id: cId, 
                        movement_type: diff > 0 ? 'out' : 'in',
                        quantity: Math.abs(diff), 
                        reference: `تعديل فاتورة رقم ${finalOrderObj.invoice_number}`
                    });
                }
            });
        } else {
            cartItems.forEach(item => {
                const inv = dbInv.find(x => x.model_id === item.modelId && x.color_id === item.colorId);
                if (inv) {
                    inventoryUpdates.push({ model_id: item.modelId, color_id: item.colorId, available_series: inv.available_series - item.qty });
                }
                movementsToInsert.push({
                    model_id: item.modelId, 
                    color_id: item.colorId, 
                    movement_type: 'out',
                    quantity: item.qty, 
                    reference: `فاتورة رقم ${finalOrderObj.invoice_number}`
                });
            });
        }

        for (const update of inventoryUpdates) {
            await supabase.from('model_inventory').update({ available_series: update.available_series })
                .eq('model_id', update.model_id).eq('color_id', update.color_id);
        }
        
        if (movementsToInsert.length > 0) {
            await supabase.from('stock_movements').insert(movementsToInsert);
        }

        cartItems = [];
        saveCart();
        e.target.reset();
        document.getElementById('c-receiver').required = false;
        
        editingOrderId = null;
        localStorage.removeItem('devo_edit_order_data');

        document.getElementById('checkout-modal')?.classList.add('opacity-0');
        setTimeout(() => {
            document.getElementById('checkout-modal')?.classList.add('hidden');
            window.showInvoiceModal(finalOrderObj, orderItemsData);
        }, 300);

        showToast('تم إصدار الفاتورة وتحديث المخزون بنجاح!', 'success');

    } catch (err) {
        if (err.message !== 'ValidationError') {
            console.error('Supabase Error:', err);
            showToast(`خطأ من السيرفر: ${err.message || 'فشل الاتصال بقاعدة البيانات'}`, 'error');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = editingOrderId ? `حفظ التعديلات` : `تأكيد وإصدار الفاتورة`;
    }
}

window.confirmRemoveFromCart = (index) => {
    itemToDeleteIndex = index;
    const modal = document.getElementById('confirm-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
};

window.closeConfirmModal = () => {
    const modal = document.getElementById('confirm-modal');
    if(modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => modal.classList.add('hidden'), 300);
    }
    itemToDeleteIndex = null;
};

document.getElementById('btn-confirm-delete')?.addEventListener('click', () => {
    if (itemToDeleteIndex !== null) {
        cartItems.splice(itemToDeleteIndex, 1);
        saveCart();
        loadAndRenderCart();
        showToast('تم الإزالة من السلة', 'success');
    }
    window.closeConfirmModal();
});

function saveCart() {
    localStorage.setItem('devo_cart', JSON.stringify(cartItems));
    updateFloatingCart();
}

function updateFloatingCart() {
    const countEl = document.getElementById('floating-cart-count');
    if (!countEl) return;
    const totalItems = cartItems.reduce((sum, item) => sum + item.qty, 0);
    countEl.textContent = totalItems;
    
    if (totalItems > 0) {
        countEl.parentElement.parentElement.classList.add('animate-bounce');
        setTimeout(() => countEl.parentElement.parentElement.classList.remove('animate-bounce'), 1000);
    }
}

function showInvoiceModal(order, items) {
    const modalContent = document.querySelector('#invoice-modal .bg-white');
    if (modalContent) modalContent.scrollTop = 0;

    document.getElementById('inv-number').textContent = order.invoice_number || order.id;
    document.getElementById('inv-date').textContent = new Date(order.created_at).toLocaleDateString('ar-EG');
    document.getElementById('inv-cust-name').textContent = order.customer_name;
    document.getElementById('inv-cust-phone').textContent = order.phone_1;
    const addressEl = document.getElementById('inv-cust-address');
    if (addressEl) addressEl.textContent = order.address || '';

    const tbody = document.getElementById('inv-items-body');
    if (tbody) {
        tbody.innerHTML = '';
        items.forEach((item, idx) => {
            const cachedItem = JSON.parse(localStorage.getItem('devo_edit_order_data_cache') || '[]').find(i => i.modelId === item.model_id && i.colorId === item.color_id);
            const row = `
                <tr class="text-xs sm:text-sm">
                    <td class="border border-gray-300 p-1 sm:p-2">${idx + 1}</td>
                    <td class="border border-gray-300 p-1 sm:p-2 font-bold">${cachedItem?.modelName || 'موديل'}</td>
                    <td class="border border-gray-300 p-1 sm:p-2 text-gray-600">${cachedItem?.colorName || 'لون'}</td>
                    <td class="border border-gray-300 p-1 sm:p-2 font-bold text-center">${item.quantity}</td>
                    <td class="border border-gray-300 p-1 sm:p-2 text-center">${item.price_per_series}</td>
                    <td class="border border-gray-300 p-1 sm:p-2 text-center font-bold bg-gray-50">${item.total_price}</td>
                </tr>
            `;
            tbody.innerHTML += row;
        });
    }

    const invTotal = document.getElementById('inv-total-price');
    if (invTotal) invTotal.textContent = order.total_price;
    const invDeposit = document.getElementById('inv-deposit');
    if (invDeposit) invDeposit.textContent = order.deposit;
    const invRem = document.getElementById('inv-remaining');
    if (invRem) invRem.textContent = order.total_price - order.deposit;

    const modal = document.getElementById('invoice-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
    localStorage.removeItem('devo_edit_order_data_cache');
}

window.finishOrderAndRedirect = () => {
    const modal = document.getElementById('invoice-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            window.switchSiteView('view-gallery');
        }, 300);
    }
};

window.executeInvoicePrint = () => {
    const custName = document.getElementById('inv-cust-name')?.innerText.trim() || 'Client';
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const originalTitle = document.title;
    
    document.title = `${custName}_${dateStr}`;
    window.print();
    setTimeout(() => { document.title = originalTitle; }, 500);
};

window.addEventListener('beforeunload', () => {
    if(cartItems.length > 0) localStorage.setItem('devo_edit_order_data_cache', JSON.stringify(cartItems));
});
if(cartItems.length > 0) localStorage.setItem('devo_edit_order_data_cache', JSON.stringify(cartItems));