import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

let currentUser = null;
let allOrders = [];
let currentTab = 'active'; // active or archived
let orderToEdit = null;

export async function initOrdersView() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    
    if (!currentUser) return;

    ['ord-search', 'ord-status', 'ord-date-from', 'ord-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', renderOrders);
    });

    await fetchMyOrders();
}

window.switchOrdersTab = (tab) => {
    currentTab = tab;
    document.getElementById('tab-orders-active').className = tab === 'active' 
        ? 'px-4 py-2 text-sm font-bold text-devo-orange border-b-2 border-devo-orange transition-all' 
        : 'px-4 py-2 text-sm font-bold text-devo-muted hover:text-white border-b-2 border-transparent transition-all';
        
    document.getElementById('tab-orders-archived').className = tab === 'archived' 
        ? 'px-4 py-2 text-sm font-bold text-devo-orange border-b-2 border-devo-orange transition-all' 
        : 'px-4 py-2 text-sm font-bold text-devo-muted hover:text-white border-b-2 border-transparent transition-all';
        
    renderOrders();
};

async function fetchMyOrders() {
    const tBody = document.getElementById('orders-table-body');
    if(tBody) tBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i> جاري التحميل...</td></tr>`;

    // استبدل قسم الـ select داخل fetchMyOrders بهذا:
    const { data, error } = await supabase
        .from('orders')
        .select(`
            *,
            order_items (
                *,
                models (
                    name, 
                    factory_code,
                    system_code,
                    model_images(image_url),
                    model_sizes(size_id)
                ),
                colors (name)
            )
        `)
        .eq('worker_id', currentUser.id)
        .order('created_at', { ascending: false });
        
    if (error) {
        showToast('حدث خطأ أثناء جلب الأوردرات', 'error');
        console.error(error);
        return;
    }

    allOrders = data;
    renderOrders();
}

const statusConfig = {
    'created': { text: 'تم إنشاء الأوردر', color: 'bg-devo-gray text-white border-devo-gray' },
    'in_progress': { text: 'جاري العمل', color: 'bg-devo-orange/20 text-devo-orange border-devo-orange/50' },
    'registered': { text: 'تم التسجيل', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
    'preparing': { text: 'جاري التجهيز', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50' },
    'shipped': { text: 'تم الشحن', color: 'bg-green-500/20 text-green-400 border-green-500/50' },
    'delivered': { text: 'تم التسليم', color: 'bg-devo-success/20 text-devo-success border-devo-success/50' }
};

function renderOrders() {
    const term = document.getElementById('ord-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('ord-status')?.value || '';
    const dateFrom = document.getElementById('ord-date-from')?.value;
    const dateTo = document.getElementById('ord-date-to')?.value;

    const filtered = allOrders.filter(o => {
        const isArchived = o.is_archived || false;
        if (currentTab === 'active' && isArchived) return false;
        if (currentTab === 'archived' && !isArchived) return false;

        if (term && !o.invoice_number.toLowerCase().includes(term) && !o.customer_name.toLowerCase().includes(term) && !o.phone_1.includes(term)) return false;
        if (statusFilter && o.status !== statusFilter) return false;

        if (dateFrom || dateTo) {
            const oDate = new Date(o.created_at);
            oDate.setHours(0,0,0,0);
            if (dateFrom && oDate < new Date(dateFrom)) return false;
            if (dateTo && oDate > new Date(dateTo)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('orders-table-body');
    const cardsBody = document.getElementById('orders-cards-body');
    
    if (filtered.length === 0) {
        const emptyMsg = `<div class="p-10 text-center text-devo-muted">لا توجد أوردرات تطابق بحثك في هذا القسم.</div>`;
        if (tbody) tbody.innerHTML = `<tr><td colspan="6">${emptyMsg}</td></tr>`;
        if (cardsBody) cardsBody.innerHTML = emptyMsg;
        return;
    }

    if (tbody) tbody.innerHTML = '';
    if (cardsBody) cardsBody.innerHTML = '';

    filtered.forEach(o => {
        const config = statusConfig[o.status] || statusConfig['created'];
        const dateStr = new Date(o.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
        
        const lockIcon = o.is_locked ? `<i class="ph ph-lock text-devo-error" title="مقفل بواسطة الإدارة"></i>` : '';
        let actionButtons = `
            <div class="flex items-center justify-center gap-2">
                <button onclick="viewOrderDetails('${o.id}')" class="p-2 bg-devo-black border border-devo-gray hover:bg-devo-gray rounded text-white transition-colors" title="عرض"><i class="ph ph-eye"></i></button>
                <button onclick="reprintOrder('${o.id}')" class="p-2 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded transition-colors" title="طباعة"><i class="ph ph-printer"></i></button>
                ${!o.is_locked ? `<button onclick="confirmEditOrder('${o.id}')" class="p-2 bg-devo-orange/10 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors" title="تعديل الأوردر"><i class="ph ph-pencil-simple"></i></button>` : `<button disabled class="p-2 bg-devo-gray/20 text-devo-muted rounded cursor-not-allowed" title="هذا الأوردر قيد العمل من قبل الإدارة حالياً"><i class="ph ph-lock"></i></button>`}
                <button onclick="toggleArchive('${o.id}', ${!o.is_archived})" class="p-2 bg-devo-black border border-devo-gray hover:border-devo-orange rounded text-devo-muted hover:text-white transition-colors" title="${o.is_archived ? 'استعادة' : 'أرشفة'}"><i class="ph ${o.is_archived ? 'ph-tray-arrow-up' : 'ph-archive'}"></i></button>
            </div>
        `;

        if (tbody) {
            tbody.innerHTML += `
                <tr class="hover:bg-devo-black/40 transition-colors">
                    <td class="p-4 font-mono text-devo-orange font-bold text-xs">${o.invoice_number} ${lockIcon}</td>
                    <td class="p-4 font-bold text-white">${o.customer_name}</td>
                    <td class="p-4 text-devo-muted">${o.total_series} سيريه</td>
                    <td class="p-4 text-devo-muted text-xs">${dateStr}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-bold border ${config.color}">${config.text}</span></td>
                    <td class="p-4">${actionButtons}</td>
                </tr>
            `;
        }

        if (cardsBody) {
            cardsBody.innerHTML += `
                <div class="bg-devo-dark border border-devo-gray p-4 rounded-xl relative">
                    <div class="flex justify-between items-start border-b border-devo-gray pb-3 mb-3">
                        <div>
                            <span class="font-mono text-devo-orange font-bold text-xs flex items-center gap-1">${o.invoice_number} ${lockIcon}</span>
                            <h4 class="font-bold text-white mt-1">${o.customer_name}</h4>
                        </div>
                        <span class="px-2 py-1 rounded text-[10px] font-bold border ${config.color}">${config.text}</span>
                    </div>
                    <div class="flex justify-between text-xs text-devo-muted mb-4">
                        <span>${o.total_series} سيريه (${o.total_price} ج.م)</span>
                        <span>${dateStr}</span>
                    </div>
                    ${actionButtons}
                </div>
            `;
        }
    });
}

window.viewOrderDetails = (id) => {
    const o = allOrders.find(x => x.id === id);
    if (!o) return;

    const remaining = o.total_price - (o.deposit || 0);
    const groupedItems = {};

    // 🌟 التجميع والحساب اللحظي المباشر 🌟
    o.order_items.forEach(item => {
        const modelId = item.model_id;
        const colorName = item.colors?.name || '-';
        const qty = item.quantity;
        
        // استخراج عدد المقاسات من الاستعلام الرئيسي
        const sizesCount = item.models?.model_sizes?.length || 1; 
        const pieces = qty * sizesCount;

        const colorWithQty = `${qty} ${colorName}`;

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = {
                modelName: item.models?.name,
                colorsList: [colorWithQty],
                totalQty: qty,
                totalPieces: pieces, 
                price: item.price_per_series,
                totalPrice: item.total_price
            };
        } else {
            groupedItems[modelId].colorsList.push(colorWithQty);
            groupedItems[modelId].totalQty += qty;
            groupedItems[modelId].totalPieces += pieces;
            groupedItems[modelId].totalPrice += item.total_price;
        }
    });

    // 🌟 إظهار السريات والقطع معاً في الشاشة بشكل واضح 🌟
    let itemsHtml = Object.values(groupedItems).map(item => `
        <tr class="border-b border-devo-gray last:border-0">
            <td class="py-3 text-white text-sm font-bold">${item.modelName}</td>
            <td class="py-3 text-devo-info text-xs leading-relaxed max-w-[120px]">${item.colorsList.join('، ')}</td>
            <td class="py-3 text-white font-black text-center">
                <span class="text-lg">${item.totalQty} سيريه</span><br>
                <span class="text-[11px] text-devo-muted font-normal">(${item.totalPieces} قطعة)</span>
            </td>
            <td class="py-3 text-devo-muted text-center">${item.price}</td>
            <td class="py-3 text-devo-orange font-black text-left text-lg">${item.totalPrice}</td>
        </tr>
    `).join('');

    document.getElementById('order-details-content').innerHTML = `
        <div class="bg-devo-black p-4 rounded-xl border border-devo-gray mb-6 flex justify-between items-center">
            <div>
                <p class="text-xs text-devo-muted">العميل</p>
                <h4 class="text-white font-bold text-lg">${o.customer_name}</h4>
                <p class="text-sm text-devo-muted" dir="ltr">${o.phone_1}</p>
            </div>
            <div class="text-left">
                <p class="text-xs text-devo-muted">رقم الفاتورة</p>
                <p class="text-devo-orange font-mono font-bold text-lg">${o.invoice_number}</p>
            </div>
        </div>

        <h4 class="text-white font-bold mb-3 border-b border-devo-gray pb-2">المنتجات المختارة</h4>
        <div class="overflow-x-auto">
            <table class="w-full text-right mb-6">
                <thead class="text-xs text-devo-muted bg-devo-black">
                    <tr>
                        <th class="py-2 px-1">الموديل</th>
                        <th class="py-2 px-1">الألوان والكميات</th>
                        <th class="py-2 px-1 text-center">إجمالي الكمية</th>
                        <th class="py-2 px-1 text-center">السعر للقطعة</th>
                        <th class="py-2 px-1 text-left">الإجمالي</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>
        </div>

        <div class="bg-devo-black p-4 rounded-xl border border-devo-gray space-y-2 text-sm">
            <div class="flex justify-between text-devo-muted"><span>الإجمالي الكلي:</span> <span class="text-white font-bold">${o.total_price} ج.م</span></div>
            <div class="flex justify-between text-devo-muted"><span>العربون المدفوع:</span> <span class="text-devo-success font-bold">${o.deposit} ج.م</span></div>
            <div class="flex justify-between border-t border-devo-gray pt-2 mt-2">
                <span class="text-white font-bold">المتبقي للدفع:</span> 
                <span class="text-devo-orange font-black text-lg">${remaining} ج.م</span>
            </div>
        </div>
    `;

    const modal = document.getElementById('order-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeOrderDetailsModal = () => {
    const modal = document.getElementById('order-details-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};
window.reprintOrder = (id) => {
    const o = allOrders.find(x => x.id === id);
    if (!o) return;
    
    showToast('جاري تجهيز الفاتورة للطباعة...', 'info');

    const mappedItems = o.order_items.map(i => {
        const sizesCount = i.models?.model_sizes?.length || 1;
        return {
            model_id: i.model_id, // 🌟 هذا السطر هو الذي سيمنع تداخل الموديلات!
            factory_code: i.models?.factory_code || i.models?.system_code || '', // 🌟 جلب الكود
            model_name: i.models?.name,
            color_name: i.colors?.name,
            qty: i.quantity,
            pieces: i.quantity * sizesCount,
            price: i.price_per_series,
            total: i.total_price
        };
    });

    if(window.showInvoiceModal) {
        window.showInvoiceModal(o, mappedItems, o.invoice_number);
    }
};

window.toggleArchive = async (id, archiveStatus) => {
    const { error } = await supabase.from('orders').update({ is_archived: archiveStatus }).eq('id', id);
    if (!error) {
        showToast(archiveStatus ? 'تم نقل الأوردر للأرشيف' : 'تم استعادة الأوردر', 'success');
        fetchMyOrders();
    }
};

window.confirmEditOrder = (id) => {
    orderToEdit = allOrders.find(x => x.id === id);
    if (!orderToEdit) return;

    if (orderToEdit.is_locked) {
        return showToast('هذا الأوردر قيد العمل من قبل الإدارة، لا يمكن تعديله!', 'error');
    }

    const modal = document.getElementById('edit-warning-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeEditWarningModal = () => {
    const modal = document.getElementById('edit-warning-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
    orderToEdit = null;
};

document.getElementById('btn-confirm-edit')?.addEventListener('click', () => {
    if (!orderToEdit) return;

    const btn = document.getElementById('btn-confirm-edit');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري التجهيز...`;
    btn.disabled = true;

// داخل document.getElementById('btn-confirm-edit')?.addEventListener ...
    const newCart = orderToEdit.order_items.map(item => {
        let imgUrl = './src/assets/icons/devo.jpeg';
        if (item.models?.model_images && item.models.model_images.length > 0) {
            imgUrl = item.models.model_images[0].image_url;
        }
        
        const sizesCount = item.models?.model_sizes?.length || 1;

        return {
            modelId: item.model_id, 
            factoryCode: item.models?.factory_code || item.models?.system_code || '', // 🌟 إضافة الكود
            colorId: item.color_id,
            modelName: item.models?.name, 
            colorName: item.colors?.name,
            price: item.price_per_series, 
            image: imgUrl, 
            qty: item.quantity,
            sizesCount: sizesCount
        };
    });

    localStorage.setItem('devo_cart', JSON.stringify(newCart));
    
    const orderData = {
        id: orderToEdit.id,
        customer_name: orderToEdit.customer_name,
        phone_1: orderToEdit.phone_1, phone_2: orderToEdit.phone_2,
        address: orderToEdit.address, deposit: orderToEdit.deposit,
        deposit_receiver: orderToEdit.deposit_receiver, notes: orderToEdit.notes
    };
    localStorage.setItem('devo_edit_order_data', JSON.stringify(orderData));
    
    btn.innerHTML = originalText;
    btn.disabled = false;
    closeEditWarningModal();
    showToast('تم تحميل بيانات الأوردر للسلة لتعديله', 'info');

    if (window.refreshCartView) window.refreshCartView();
    window.switchSiteView('view-cart');
});

window.refreshOrders = fetchMyOrders;