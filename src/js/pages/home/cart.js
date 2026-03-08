import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

let currentUser = null;
let cartItems = [];
let itemToDeleteIndex = null;

export function initCart() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    
    if (currentUser) {
        document.getElementById('checkout-form')?.addEventListener('submit', handleCheckout);
        window.refreshCartView = loadAndRenderCart;
        loadAndRenderCart();
    }
}

function loadAndRenderCart() {
    const saved = localStorage.getItem('devo_cart');
    if (saved) {
        try { cartItems = JSON.parse(saved); } catch(e) { cartItems = []; }
    }
    renderCart();
}

function saveCart() {
    localStorage.setItem('devo_cart', JSON.stringify(cartItems));
    renderCart();
    // تحديث رقم زر السلة العائم الموجود في gallery.js
    const countEl = document.getElementById('floating-cart-count');
    if (countEl) {
        const totalItems = cartItems.reduce((sum, item) => sum + item.qty, 0);
        countEl.textContent = totalItems;
    }
}

function renderCart() {
    const emptyState = document.getElementById('empty-cart-state');
    const cartContent = document.getElementById('cart-content');
    
    if (cartItems.length === 0) {
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex');
        cartContent.classList.add('hidden');
        document.getElementById('cart-items-count').textContent = 'السلة فارغة';
        return;
    }

    emptyState.classList.add('hidden');
    emptyState.classList.remove('flex');
    cartContent.classList.remove('hidden');

    let totalSeries = 0;
    let totalPrice = 0;

    const tbody = document.getElementById('cart-table-body');
    const cardsBody = document.getElementById('cart-cards-body');
    
    tbody.innerHTML = '';
    cardsBody.innerHTML = '';

    cartItems.forEach((item, index) => {
        const itemTotal = item.qty * item.price;
        totalSeries += item.qty;
        totalPrice += itemTotal;

        tbody.innerHTML += `
            <tr class="hover:bg-devo-black/50 transition-colors">
                <td class="p-4">
                    <div class="flex items-center gap-3">
                        <img src="${item.image}" class="w-12 h-12 rounded object-cover border border-devo-gray">
                        <div><p class="font-bold text-white text-sm">${item.modelName}</p></div>
                    </div>
                </td>
                <td class="p-4 text-white font-bold">${item.colorName}</td>
                <td class="p-4">
                    <div class="flex items-center justify-center bg-devo-black border border-devo-gray rounded-lg overflow-hidden w-24 mx-auto h-8">
                        <button onclick="updateCartQty(${index}, -1)" class="px-2 text-white hover:text-devo-orange"><i class="ph ph-minus"></i></button>
                        <input type="number" value="${item.qty}" readonly class="w-8 bg-transparent text-center text-white text-xs font-bold outline-none border-x border-devo-gray pointer-events-none">
                        <button onclick="updateCartQty(${index}, 1)" class="px-2 text-white hover:text-devo-orange"><i class="ph ph-plus"></i></button>
                    </div>
                </td>
                <td class="p-4 text-devo-muted font-mono text-center">${item.price}</td>
                <td class="p-4 text-devo-orange font-bold text-center">${itemTotal}</td>
                <td class="p-4 text-center">
                    <button onclick="openCartConfirmDelete(${index})" class="text-devo-error hover:bg-devo-error/20 p-2 rounded transition-colors"><i class="ph ph-trash text-lg"></i></button>
                </td>
            </tr>
        `;

        cardsBody.innerHTML += `
            <div class="bg-devo-dark border border-devo-gray p-4 rounded-xl flex flex-col gap-3 relative">
                <button onclick="openCartConfirmDelete(${index})" class="absolute top-3 left-3 text-devo-error p-1 bg-devo-error/10 rounded"><i class="ph ph-trash"></i></button>
                <div class="flex gap-3 items-center">
                    <img src="${item.image}" class="w-16 h-16 rounded object-cover border border-devo-gray">
                    <div>
                        <h4 class="font-bold text-white text-sm leading-tight">${item.modelName}</h4>
                        <p class="text-xs text-devo-muted mt-1">اللون: <span class="text-white font-bold">${item.colorName}</span></p>
                        <p class="text-xs text-devo-orange font-bold mt-1">${item.price} ج.م</p>
                    </div>
                </div>
                <div class="flex justify-between items-center border-t border-devo-gray pt-3 mt-1">
                    <div class="flex items-center bg-devo-black border border-devo-gray rounded-lg overflow-hidden h-8">
                        <button onclick="updateCartQty(${index}, -1)" class="px-3 text-white hover:text-devo-orange"><i class="ph ph-minus"></i></button>
                        <span class="w-8 text-center text-white text-xs font-bold border-x border-devo-gray py-1">${item.qty}</span>
                        <button onclick="updateCartQty(${index}, 1)" class="px-3 text-white hover:text-devo-orange"><i class="ph ph-plus"></i></button>
                    </div>
                    <p class="font-black text-white text-lg">${itemTotal} <span class="text-[10px] text-devo-muted font-normal">ج.م</span></p>
                </div>
            </div>
        `;
    });

    document.getElementById('sum-models').textContent = cartItems.length;
    document.getElementById('sum-series').textContent = totalSeries;
    document.getElementById('sum-price').textContent = totalPrice.toLocaleString('en-US');
    document.getElementById('cart-items-count').textContent = `${cartItems.length} موديلات في الأوردر`;
}

window.updateCartQty = async (index, change) => {
    const item = cartItems[index];
    const newQty = item.qty + change;
    if (newQty < 1) return window.openCartConfirmDelete(index);

    if (change > 0) {
        const { data } = await supabase.from('model_inventory').select('available_series').eq('model_id', item.modelId).eq('color_id', item.colorId).single();
        if (data && newQty > data.available_series) {
            return showToast(`أقصى كمية متوفرة في المخزن هي ${data.available_series} سيريه`, 'error');
        }
    }

    cartItems[index].qty = newQty;
    saveCart();
};

window.openCartConfirmDelete = (index) => {
    itemToDeleteIndex = index;
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeConfirmModal = () => {
    const modal = document.getElementById('confirm-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
    itemToDeleteIndex = null;
};

document.getElementById('btn-confirm-delete')?.addEventListener('click', () => {
    if (itemToDeleteIndex !== null) {
        cartItems.splice(itemToDeleteIndex, 1);
        saveCart();
        showToast('تم الإزالة من السلة', 'success');
    }
    window.closeConfirmModal();
});

async function handleCheckout(e) {
    e.preventDefault();
    if (cartItems.length === 0) return showToast('السلة فارغة!', 'error');

    const btn = document.getElementById('btn-save-order');
    const originalHtml = btn.innerHTML;

    const totalSeries = cartItems.reduce((sum, i) => sum + i.qty, 0);
    const totalPrice = cartItems.reduce((sum, i) => sum + (i.qty * i.price), 0);
    const deposit = parseFloat(document.getElementById('c-deposit').value) || 0;

    if (deposit > totalPrice) return showToast('العربون أكبر من إجمالي الفاتورة!', 'error');

    const orderData = {
        customer_name: document.getElementById('c-name').value.trim(),
        phone_1: document.getElementById('c-phone1').value.trim(),
        phone_2: document.getElementById('c-phone2').value.trim() || null,
        address: document.getElementById('c-address').value.trim(),
        deposit: deposit,
        deposit_receiver: document.getElementById('c-receiver').value.trim() || null,
        notes: document.getElementById('c-notes').value.trim() || null,
        total_price: totalPrice,
        total_series: totalSeries,
        worker_id: currentUser.id
    };

    const orderItems = cartItems.map(item => ({
        model_id: item.modelId,
        color_id: item.colorId,
        model_name: item.modelName,
        qty: item.qty,
        price: item.price,
        total: item.qty * item.price
    }));

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin text-2xl"></i> جاري تسجيل الأوردر...`;

    try {
        const { data: response, error } = await supabase.rpc('process_order_transaction', {
            p_order_data: orderData,
            p_order_items: orderItems
        });

        if (error) throw error;

        showToast('تم حفظ الفاتورة بنجاح!', 'success');
        
        localStorage.removeItem('devo_cart');
        cartItems = [];
        saveCart(); // لتحديث الواجهة (تصبح فارغة)
        
        showInvoiceModal(orderData, orderItems, response.invoice_number);
        document.getElementById('checkout-form').reset();

    } catch (err) {
        showToast(err.message || 'حدث خطأ أثناء الحفظ', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

function showInvoiceModal(orderData, items, invoiceNumber) {
    document.getElementById('inv-number').textContent = invoiceNumber;
    document.getElementById('inv-date').textContent = new Date().toLocaleString('ar-EG');
    document.getElementById('inv-worker').textContent = currentUser.full_name;
    document.getElementById('inv-cust-name').textContent = orderData.customer_name;
    document.getElementById('inv-cust-address').textContent = orderData.address;
    document.getElementById('inv-cust-phone').textContent = orderData.phone_1 + (orderData.phone_2 ? ` / ${orderData.phone_2}` : '');

    const tbody = document.getElementById('inv-items-body');
    tbody.innerHTML = items.map((item, idx) => `
        <tr>
            <td class="p-3 text-sm border-r border-gray-300 font-mono">${idx + 1}</td>
            <td class="p-3 text-sm border-r border-gray-300 font-bold">${item.model_name}</td>
            <td class="p-3 text-sm border-r border-gray-300">${cartItems[idx]?.colorName || '-'}</td>
            <td class="p-3 text-sm text-center border-r border-gray-300 font-bold">${item.qty}</td>
            <td class="p-3 text-sm text-center border-r border-gray-300">${item.price}</td>
            <td class="p-3 text-sm text-center font-bold">${item.total}</td>
        </tr>
    `).join('');

    const remaining = orderData.total_price - orderData.deposit;
    document.getElementById('inv-total-price').textContent = `${orderData.total_price.toLocaleString('en-US')} ج.م`;
    document.getElementById('inv-deposit').textContent = `${orderData.deposit.toLocaleString('en-US')} ج.م`;
    document.getElementById('inv-remaining').textContent = `${remaining.toLocaleString('en-US')} ج.م`;

    const modal = document.getElementById('invoice-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

window.finishOrderAndRedirect = () => {
    const modal = document.getElementById('invoice-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        // العودة لصفحة المعرض وبدء طلب جديد
        window.switchSiteView('view-gallery');
    }, 300);
};