import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

let currentUser = null;
let cartItems = [];
let itemToDeleteIndex = null;
let editingOrderId = null; // متغير لحفظ ID الأوردر المُراد تعديله

export function initCart() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    
    if (currentUser) {
        document.getElementById('checkout-form')?.addEventListener('submit', handleCheckout);
        window.refreshCartView = loadAndRenderCart;
        
        // 🌟 التعديل السحري: تصدير دالة عرض الفاتورة لتصبح متاحة لصفحة الأوردرات 🌟
        window.showInvoiceModal = showInvoiceModal;
        
        // إجبار كتابة مستلم العربون
        document.getElementById('c-deposit')?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || 0;
            document.getElementById('c-receiver').required = val > 0;
        });

        loadAndRenderCart();
    }
}

function loadAndRenderCart() {
    const saved = localStorage.getItem('devo_cart');
    if (saved) {
        try { cartItems = JSON.parse(saved); } catch(e) { cartItems = []; }
    }

    // 🌟 تحميل بيانات العميل إذا كنا في وضع التعديل 🌟
    const savedEditData = localStorage.getItem('devo_edit_order_data');
    if (savedEditData) {
        try {
            const data = JSON.parse(savedEditData);
            editingOrderId = data.id;
            document.getElementById('c-name').value = data.customer_name || '';
            document.getElementById('c-phone1').value = data.phone_1 || '';
            document.getElementById('c-phone2').value = data.phone_2 || '';
            document.getElementById('c-address').value = data.address || '';
            document.getElementById('c-deposit').value = data.deposit || 0;
            document.getElementById('c-receiver').value = data.deposit_receiver || '';
            document.getElementById('c-notes').value = data.notes || '';
            
            // تغيير نص الزر
            const btn = document.getElementById('btn-save-order');
            if(btn) btn.innerHTML = `<span>حفظ التعديلات وإصدار الفاتورة</span><i class="ph ph-receipt text-xl"></i>`;
        } catch(e) {}
    } else {
        editingOrderId = null;
        document.getElementById('checkout-form')?.reset();
        const btn = document.getElementById('btn-save-order');
        if(btn) btn.innerHTML = `<span>حفظ وإصدار الفاتورة</span><i class="ph ph-receipt text-xl"></i>`;
    }

    renderCart();
}

function saveCart() {
    localStorage.setItem('devo_cart', JSON.stringify(cartItems));
    renderCart();
    const countEl = document.getElementById('floating-cart-count');
    if (countEl) countEl.textContent = cartItems.reduce((sum, item) => sum + item.qty, 0);
}

function renderCart() {
    const emptyState = document.getElementById('empty-cart-state');
    const cartContent = document.getElementById('cart-content');
    
    if (cartItems.length === 0) {
        emptyState.classList.remove('hidden'); emptyState.classList.add('flex');
        cartContent.classList.add('hidden');
        document.getElementById('cart-items-count').textContent = 'السلة فارغة';
        localStorage.removeItem('devo_edit_order_data'); editingOrderId = null;
        return;
    }

    emptyState.classList.add('hidden'); emptyState.classList.remove('flex');
    cartContent.classList.remove('hidden');

    let totalSeries = 0, totalPrice = 0;
    const tbody = document.getElementById('cart-table-body');
    const cardsBody = document.getElementById('cart-cards-body');
    
    tbody.innerHTML = ''; cardsBody.innerHTML = '';

    cartItems.forEach((item, index) => {
        const sizes = item.sizesCount || 1; // حماية للبيانات القديمة
        const itemPieces = item.qty * sizes; // إجمالي القطع
        const itemTotal = itemPieces * item.price; // 🌟 المعادلة الصحيحة 🌟
        
        totalSeries += item.qty; totalPrice += itemTotal;

        // 🌟 إضافة الكود بجوار الاسم في الديسكتوب 🌟
        tbody.innerHTML += `
            <tr class="hover:bg-devo-black/50 transition-colors">
                <td class="p-4"><div class="flex items-center gap-3"><img src="${item.image}" class="w-12 h-12 rounded object-cover border border-devo-gray"><div><p class="font-bold text-white text-sm">${item.modelName} ${item.factoryCode ? `<span class="text-devo-muted font-mono text-xs">(${item.factoryCode})</span>` : ''}</p><p class="text-xs text-devo-info">${sizes} قطع بالسيريه</p></div></div></td>
                <td class="p-4 text-white font-bold">${item.colorName}</td>
                <td class="p-4"><div class="flex items-center justify-center bg-devo-black border border-devo-gray rounded-lg overflow-hidden w-24 mx-auto h-8"><button onclick="updateCartQty(${index}, -1)" class="px-2 text-white hover:text-devo-orange"><i class="ph ph-minus"></i></button><input type="number" value="${item.qty}" readonly class="w-8 bg-transparent text-center text-white text-xs font-bold outline-none border-x border-devo-gray pointer-events-none"><button onclick="updateCartQty(${index}, 1)" class="px-2 text-white hover:text-devo-orange"><i class="ph ph-plus"></i></button></div></td>
                <td class="p-4 text-devo-muted font-mono text-center">${item.price}</td>
                <td class="p-4 text-devo-orange font-bold text-center">${itemTotal}</td>
                <td class="p-4 text-center"><button onclick="openCartConfirmDelete(${index})" class="text-devo-error hover:bg-devo-error/20 p-2 rounded transition-colors"><i class="ph ph-trash text-lg"></i></button></td>
            </tr>`;

        // 🌟 إضافة الكود بجوار الاسم في الموبايل 🌟
        cardsBody.innerHTML += `
            <div class="bg-devo-dark border border-devo-gray p-4 rounded-xl flex flex-col gap-3 relative"><button onclick="openCartConfirmDelete(${index})" class="absolute top-3 left-3 text-devo-error p-1 bg-devo-error/10 rounded"><i class="ph ph-trash"></i></button><div class="flex gap-3 items-center"><img src="${item.image}" class="w-16 h-16 rounded object-cover border border-devo-gray"><div><h4 class="font-bold text-white text-sm leading-tight">${item.modelName} ${item.factoryCode ? `<span class="text-devo-muted font-mono text-xs">(${item.factoryCode})</span>` : ''}</h4><p class="text-xs text-devo-muted mt-1">اللون: <span class="text-white font-bold">${item.colorName}</span></p><p class="text-xs text-devo-orange font-bold mt-1">${item.price} ج.م <span class="text-devo-muted">للقطعة</span></p></div></div><div class="flex justify-between items-center border-t border-devo-gray pt-3 mt-1"><div class="flex items-center bg-devo-black border border-devo-gray rounded-lg overflow-hidden h-8"><button onclick="updateCartQty(${index}, -1)" class="px-3 text-white hover:text-devo-orange"><i class="ph ph-minus"></i></button><span class="w-8 text-center text-white text-xs font-bold border-x border-devo-gray py-1">${item.qty}</span><button onclick="updateCartQty(${index}, 1)" class="px-3 text-white hover:text-devo-orange"><i class="ph ph-plus"></i></button></div><p class="font-black text-white text-lg">${itemTotal} <span class="text-[10px] text-devo-muted font-normal">ج.م</span></p></div></div>`;
    });

    document.getElementById('sum-models').textContent = cartItems.length;
    document.getElementById('sum-series').textContent = totalSeries;
    document.getElementById('sum-price').textContent = totalPrice.toLocaleString('en-US');
}

// 2. تحديث دالة الحفظ
async function handleCheckout(e) {
    e.preventDefault();
    if (cartItems.length === 0) return showToast('السلة فارغة!', 'error');

    const deposit = parseFloat(document.getElementById('c-deposit').value) || 0;
    const receiver = document.getElementById('c-receiver').value.trim();

    if (deposit > 0 && receiver === '') {
        document.getElementById('c-receiver').focus();
        return showToast('يرجى كتابة اسم "مستلم العربون"!', 'error');
    }

    const btn = document.getElementById('btn-save-order');
    const originalHtml = btn.innerHTML;

    const totalSeries = cartItems.reduce((sum, i) => sum + i.qty, 0);
    // 🌟 التعديل المحاسبي النهائي للحفظ 🌟
    const totalPrice = cartItems.reduce((sum, i) => sum + (i.qty * (i.sizesCount || 1) * i.price), 0);
    
    if (deposit > totalPrice) return showToast('العربون أكبر من إجمالي الفاتورة!', 'error');

    const orderData = {
        customer_name: document.getElementById('c-name').value.trim(),
        phone_1: document.getElementById('c-phone1').value.trim(),
        phone_2: document.getElementById('c-phone2').value.trim() || null,
        address: document.getElementById('c-address').value.trim(),
        deposit: deposit, deposit_receiver: receiver || null,
        notes: document.getElementById('c-notes').value.trim() || null,
        total_price: totalPrice, total_series: totalSeries, worker_id: currentUser.id
    };

    const orderItems = cartItems.map(item => ({
        model_id: item.modelId, color_id: item.colorId,
        factory_code: item.factoryCode, // 🌟 تمرير الكود
        model_name: item.modelName, color_name: item.colorName,
        qty: item.qty, 
        pieces: item.qty * (item.sizesCount || 1),
        price: item.price, 
        total: item.qty * (item.sizesCount || 1) * item.price
    }));

    // ... باقي دالة الحفظ كما هي ...
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin text-2xl"></i> جاري الحفظ...`;

    try {
        const { data: response, error } = await supabase.rpc('process_order_transaction', {
            p_order_data: orderData, p_order_items: orderItems, p_order_id: editingOrderId 
        });

        if (error) throw error;
        showToast(editingOrderId ? 'تم تعديل الفاتورة بنجاح!' : 'تم حفظ الفاتورة بنجاح!', 'success');
        
        if(window.refreshGallery) window.refreshGallery();
        if(window.refreshOrders) window.refreshOrders();

        localStorage.removeItem('devo_cart'); localStorage.removeItem('devo_edit_order_data');
        editingOrderId = null; cartItems = [];
        
        showInvoiceModal(orderData, orderItems, response.invoice_number);
        document.getElementById('checkout-form').reset();
        saveCart(); 

    } catch (err) { showToast(err.message, 'error'); } finally { btn.disabled = false; btn.innerHTML = originalHtml; }
}

// 3. تحديث عرض الفاتورة ليعرض عدد القطع
function showInvoiceModal(orderData, items, invoiceNumber) {
    // ... كود تعبئة البيانات العلوية كما هو ...
    document.getElementById('inv-number').textContent = invoiceNumber;
    document.getElementById('inv-date').textContent = new Date().toLocaleString('ar-EG', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    document.getElementById('inv-worker').textContent = currentUser.full_name;
    document.getElementById('inv-cust-name').textContent = orderData.customer_name;
    document.getElementById('inv-cust-address').textContent = orderData.address;
    document.getElementById('inv-cust-phone').textContent = orderData.phone_1 + (orderData.phone_2 ? ` / ${orderData.phone_2}` : '');
const grouped = {};
    items.forEach(item => {
        const colorName = item.color_name || '-'; 
        if (!grouped[item.model_id]) {
            grouped[item.model_id] = {
                model_name: item.model_name,
                factory_code: item.factory_code || '', // 🌟 استقبال الكود
                colors: [colorName],
                pieces: item.pieces || item.qty,
                price: item.price, total: item.total
            };
        } else {
            if (!grouped[item.model_id].colors.includes(colorName)) grouped[item.model_id].colors.push(colorName);
            grouped[item.model_id].pieces += (item.pieces || item.qty);
            grouped[item.model_id].total += item.total;
        }
    });

const tbody = document.getElementById('inv-items-body');
    tbody.innerHTML = Object.values(grouped).map((item, idx) => `
        <tr class="text-black">
            <td class="p-1 border-l border-gray-300 font-mono text-center font-bold bg-gray-50">${idx + 1}</td>
            <td class="p-1 border-l border-gray-300 font-bold truncate max-w-[150px]">
                ${item.model_name} ${item.factory_code ? `<span class="text-[10px] text-gray-600 font-mono">(${item.factory_code})</span>` : ''}
            </td>
            <td class="p-1 border-l border-gray-300 text-center font-bold text-gray-800 text-[10px] leading-tight">${item.colors.join('، ')}</td>
            <td class="p-1 text-center border-l border-gray-300 font-black text-lg">${item.pieces}</td>
            <td class="p-1 text-center border-l border-gray-300">${item.price}</td>
            <td class="p-1 text-center font-black text-lg bg-gray-50">${item.total}</td>
        </tr>
    `).join('');
    const remaining = orderData.total_price - orderData.deposit;
    document.getElementById('inv-total-price').textContent = `${orderData.total_price.toLocaleString('en-US')}`;
    document.getElementById('inv-deposit').textContent = `${orderData.deposit.toLocaleString('en-US')}`;
    document.getElementById('inv-remaining').textContent = `${remaining.toLocaleString('en-US')} ج.م`;

    const modal = document.getElementById('invoice-modal');
    modal.classList.remove('hidden'); setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

window.updateCartQty = async (index, change) => {
    const item = cartItems[index];
    const newQty = item.qty + change;
    if (newQty < 1) return window.openCartConfirmDelete(index);

    if (change > 0) {
        // إذا كنا نعدل، لا نمنعه من تجاوز المتاح (لأن الكمية القديمة محجوزة أصلاً، سيتم التحقق النهائي في الداتا بيز)
        if (!editingOrderId) {
            const { data } = await supabase.from('model_inventory').select('available_series').eq('model_id', item.modelId).eq('color_id', item.colorId).single();
            if (data && newQty > data.available_series) {
                return showToast(`أقصى كمية متوفرة هي ${data.available_series} سيريه`, 'error');
            }
        }
    }

    cartItems[index].qty = newQty;
    saveCart();
};

window.openCartConfirmDelete = (index) => {
    itemToDeleteIndex = index;
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('hidden'); setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeConfirmModal = () => {
    const modal = document.getElementById('confirm-modal');
    modal.classList.add('opacity-0'); setTimeout(() => modal.classList.add('hidden'), 300);
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



window.finishOrderAndRedirect = () => {
    const modal = document.getElementById('invoice-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        window.switchSiteView('view-gallery');
    }, 300);
};



// 🌟 دالة الطباعة المخصصة لتغيير اسم ملف الـ PDF 🌟
window.executeInvoicePrint = () => {
    const custName = document.getElementById('inv-cust-name').innerText.trim() || 'Client';
    const custPhone = document.getElementById('inv-cust-phone').innerText.trim() || 'Phone';
    
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // حفظ اسم الموقع الأصلي
    const originalTitle = document.title;
    
    // تغيير اسم الموقع مؤقتاً ليكون هو اسم ملف الـ PDF
    document.title = `${custName}_${custPhone}_${dateStr}`;

    // أمر الطباعة
    window.print();

    // إرجاع اسم الموقع الأصلي بعد ثانية لكي لا يلاحظ المستخدم التغيير
    setTimeout(() => {
        document.title = originalTitle;
    }, 1500);
};