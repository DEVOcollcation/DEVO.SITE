import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { getCurrentSession } from '../../services/auth.js';

let isInitialized = false;
let allAdminOrders = [];
let currentUserProfile = null;

const statusConfig = {
    'created': { text: 'تم إنشاء الأوردر', color: 'bg-devo-gray text-white border-devo-gray' },
    'in_progress': { text: 'جاري العمل', color: 'bg-devo-orange/20 text-devo-orange border-devo-orange/50' },
    'registered': { text: 'تم التسجيل', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
    'preparing': { text: 'جاري التجهيز', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50' },
    'shipped': { text: 'تم الشحن', color: 'bg-green-500/20 text-green-400 border-green-500/50' },
    'delivered': { text: 'تم التسليم', color: 'bg-devo-success/20 text-devo-success border-devo-success/50' }
};

export async function initAdminOrdersView() {
    if (isInitialized) return;

    const { session } = getCurrentSession();
    if(session) currentUserProfile = session.user;

    ['ao-search', 'ao-status', 'ao-date-from', 'ao-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', renderAdminOrders);
    });

    await fetchAdminOrders();

    supabase.channel('admin_orders_channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchAdminOrders)
        .subscribe();

    isInitialized = true;
}

async function fetchAdminOrders() {
    const tBody = document.getElementById('ao-table-body');
    if(tBody && allAdminOrders.length === 0) tBody.innerHTML = `<tr><td colspan="9" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i></td></tr>`;

    const { data, error } = await supabase
        .from('orders')
        .select(`
            *,
            system_users (full_name),
            order_items (
                *,
                models (name, factory_code, system_code, model_sizes(size_id)),
                colors (id, name, color_code)
            )
        `)
        .order('created_at', { ascending: false });
        
    if (!error && data) {
        allAdminOrders = data;
        updateAdminStats();
        renderAdminOrders();
    }
}

function updateAdminStats() {
    let totalRev = 0, prog = 0, done = 0, totalSeries = 0;
    allAdminOrders.forEach(o => {
        totalRev += o.total_price || 0;
        totalSeries += o.total_series || 0;
        if(['in_progress', 'registered', 'preparing'].includes(o.status)) prog++;
        if(['shipped', 'delivered'].includes(o.status)) done++;
    });

    document.getElementById('ao-stat-total').textContent = allAdminOrders.length;
    document.getElementById('ao-stat-series').textContent = totalSeries;
    document.getElementById('ao-stat-rev').textContent = totalRev.toLocaleString();
    document.getElementById('ao-stat-prog').textContent = prog;
    document.getElementById('ao-stat-done').textContent = done;
}

function renderAdminOrders() {
    const term = document.getElementById('ao-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('ao-status')?.value || '';
    const dateFrom = document.getElementById('ao-date-from')?.value;
    const dateTo = document.getElementById('ao-date-to')?.value;

    const filtered = allAdminOrders.filter(o => {
        if (term && !o.invoice_number.toLowerCase().includes(term) 
                 && !o.customer_name.toLowerCase().includes(term) 
                 && !(o.phone_1||'').includes(term)
                 && !(o.system_users?.full_name||'').toLowerCase().includes(term)) return false;
                 
        if (statusFilter && o.status !== statusFilter) return false;

        if (dateFrom || dateTo) {
            const oDate = new Date(o.created_at);
            oDate.setHours(0,0,0,0);
            if (dateFrom && oDate < new Date(dateFrom)) return false;
            if (dateTo && oDate > new Date(dateTo)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('ao-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-10 text-center text-devo-muted">لا توجد أوردرات تطابق بحثك.</td></tr>`;
        return;
    }

    const buildStatusOptions = (currentVal) => {
        return Object.keys(statusConfig).map(k => 
            `<option value="${k}" ${k === currentVal ? 'selected' : ''}>${statusConfig[k].text}</option>`
        ).join('');
    };

    tbody.innerHTML = filtered.map(o => {
        const dateStr = new Date(o.created_at).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour:'2-digit', minute:'2-digit' });
        const isOwner = currentUserProfile?.role === 'owner';
        
        // الصلاحيات
        const isAssignedToMe = o.assigned_admin_name === currentUserProfile?.full_name;
        const canEdit = !o.is_locked || isAssignedToMe || isOwner;

        const lockIcon = `<button onclick="toggleOrderLock('${o.id}', ${!o.is_locked})" class="${o.is_locked ? 'text-devo-error' : 'text-devo-success'} p-1 hover:bg-white/10 rounded transition-colors" title="${o.is_locked ? 'إلغاء القفل' : 'قفل واستلام الأوردر'}"><i class="ph ${o.is_locked ? 'ph-lock' : 'ph-lock-open'} text-lg"></i></button>`;

        const assignedHTML = o.assigned_admin_name 
            ? `<span class="bg-devo-info/20 text-devo-info px-2 py-1 rounded text-[10px] font-bold"><i class="ph ph-user-gear"></i> ${o.assigned_admin_name}</span>` 
            : `<span class="text-devo-muted text-[10px]">-</span>`;

        return `
            <tr class="hover:bg-devo-black/40 transition-colors">
                <td class="p-3 font-mono text-devo-orange font-bold text-xs flex items-center gap-1">${o.invoice_number} ${lockIcon}</td>
                <td class="p-3 text-devo-muted text-[10px]">${dateStr}</td>
                <td class="p-3 font-bold text-white text-xs">
                    ${o.customer_name} <br>
                    <span class="text-devo-muted text-[10px] font-mono">${o.phone_1}</span>
                </td>
                <td class="p-3 text-devo-muted text-[11px]"><i class="ph-fill ph-user-circle"></i> ${o.system_users?.full_name || '-'}</td>
                <td class="p-3 text-center text-white font-black">${o.total_series}</td>
                <td class="p-3 text-center text-devo-orange font-bold">${o.total_price}</td>
                <td class="p-3 text-center">${assignedHTML}</td>
                <td class="p-3 text-center">
                    <select ${!canEdit ? 'disabled' : ''} onchange="updateOrderStatus('${o.id}', this.value)" class="bg-devo-black border border-devo-gray rounded px-2 py-1 text-white text-xs outline-none focus:border-devo-orange cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        ${buildStatusOptions(o.status)}
                    </select>
                </td>
                <td class="p-3">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="exportSingleOrderToExcel('${o.id}')" class="p-1.5 bg-devo-success/10 text-devo-success hover:bg-devo-success hover:text-white rounded transition-colors" title="تصدير الأوردر للإدخال (Excel)"><i class="ph ph-file-xls text-lg"></i></button>
                        <button onclick="printAdminOrder('${o.id}', 'customer')" class="p-1.5 bg-gray-200 text-gray-800 hover:bg-white rounded transition-colors" title="طباعة فاتورة العميل (ريسييت)"><i class="ph ph-receipt text-lg"></i></button>
                        <button onclick="printAdminOrder('${o.id}', 'detailed')" class="p-1.5 bg-devo-orange/20 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors" title="طباعة فاتورة الإدارة"><i class="ph ph-printer text-lg"></i></button>
                        <button onclick="viewAdminOrderDetails('${o.id}')" class="p-1.5 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded transition-colors" title="التفاصيل"><i class="ph ph-eye text-lg"></i></button>
                        ${isOwner ? `<button onclick="deleteOrder('${o.id}')" class="p-1.5 bg-devo-error/10 text-devo-error hover:bg-devo-error hover:text-white rounded transition-colors" title="حذف وإرجاع المخزون"><i class="ph ph-trash text-lg"></i></button>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// 🌟 تحديث الحالة التلقائي والقفل 🌟
window.updateOrderStatus = async (id, newStatus) => {
    const o = allAdminOrders.find(x => x.id === id);
    if (!o) return;

    let lockState = o.is_locked;
    let assignedAdmin = o.assigned_admin_name;

    if (newStatus !== 'created') {
        lockState = true;
        assignedAdmin = currentUserProfile.full_name;
    } else {
        lockState = false;
        assignedAdmin = null;
    }

    o.status = newStatus;
    o.is_locked = lockState;
    o.assigned_admin_name = assignedAdmin;
    renderAdminOrders();

    const { error } = await supabase.from('orders').update({ 
        status: newStatus, 
        is_locked: lockState, 
        assigned_admin_name: assignedAdmin 
    }).eq('id', id);

    if (error) showToast('حدث خطأ أثناء تحديث الحالة', 'error');
    else showToast('تم تحديث وتخصيص الأوردر بنجاح', 'success');
};

// 🌟 القفل اليدوي المباشر 🌟
window.toggleOrderLock = async (id, lockState) => {
    const o = allAdminOrders.find(x => x.id === id);
    if(!o) return;

    if (currentUserProfile?.role !== 'owner' && o.assigned_admin_name && o.assigned_admin_name !== currentUserProfile?.full_name) {
        return showToast('لا تملك صلاحية فتح قفل هذا الأوردر، تواصل مع المالك.', 'error');
    }

    o.is_locked = lockState;
    o.assigned_admin_name = lockState ? currentUserProfile?.full_name : null;
    renderAdminOrders();

    const { error } = await supabase.from('orders').update({ 
        is_locked: lockState,
        assigned_admin_name: o.assigned_admin_name
    }).eq('id', id);

    if (!error) showToast(lockState ? 'تم قفل الأوردر واستلامه' : 'تم فتح الأوردر للجميع', 'success');
};


window.viewAdminOrderDetails = (id) => {
    const o = allAdminOrders.find(x => x.id === id);
    if (!o) return;

    const remaining = o.total_price - (o.deposit || 0);
    const groupedItems = {};

    o.order_items.forEach(item => {
        const modelId = item.model_id;
        const code = item.models?.factory_code || item.models?.system_code || '';
        const colorName = item.colors?.name || '-';
        const qty = item.quantity;
        const sizesCount = item.models?.model_sizes?.length || 1; 
        const pieces = qty * sizesCount;
        const colorWithQty = `${qty} ${colorName}`;

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = {
                modelName: item.models?.name, code: code,
                colorsList: [colorWithQty],
                totalQty: qty, totalPieces: pieces, 
                price: item.price_per_series, totalPrice: item.total_price
            };
        } else {
            groupedItems[modelId].colorsList.push(colorWithQty);
            groupedItems[modelId].totalQty += qty;
            groupedItems[modelId].totalPieces += pieces;
            groupedItems[modelId].totalPrice += item.total_price;
        }
    });

    let itemsHtml = Object.values(groupedItems).map(item => `
        <tr class="border-b border-devo-gray last:border-0 hover:bg-devo-black/50 transition-colors">
            <td class="py-2.5 px-3 text-white text-sm font-bold search-target">${item.modelName} <span class="text-devo-muted text-[10px] font-mono mr-1">(${item.code})</span></td>
            <td class="py-2.5 px-3 text-devo-info text-xs leading-relaxed">${item.colorsList.join('، ')}</td>
             <td class="py-3 text-white font-black text-center">
                <span class="text-lg">${item.totalQty} سيريه</span><br>
                <span class="text-[11px] text-devo-muted font-normal">(${item.totalPieces} قطعة)</span>
            </td>
            <td class="py-2.5 px-3 text-devo-muted text-center">${item.price}</td>
            <td class="py-2.5 px-3 text-devo-orange font-black text-left text-base">${item.totalPrice}</td>
        </tr>
    `).join('');

    document.getElementById('ao-details-content').innerHTML = `
        <div class="flex flex-col gap-4 h-full">
            
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
                <div class="bg-devo-black p-3 rounded-xl border border-devo-gray flex flex-col justify-center">
                    <span class="text-[10px] text-devo-muted mb-1"><i class="ph ph-user"></i> بيانات العميل</span>
                    <h4 class="text-white font-bold text-sm truncate">${o.customer_name}</h4>
                    <span class="text-xs text-devo-info font-mono mt-0.5" dir="ltr">${o.phone_1}</span>
                </div>
                <div class="bg-devo-black p-3 rounded-xl border border-devo-gray flex flex-col justify-center">
                    <span class="text-[10px] text-devo-muted mb-1"><i class="ph ph-receipt"></i> معلومات الأوردر</span>
                    <h4 class="text-devo-orange font-mono font-bold text-sm truncate">${o.invoice_number}</h4>
                    <span class="text-[11px] text-devo-muted mt-0.5">البائع: <span class="text-white">${o.system_users?.full_name || '-'}</span></span>
                </div>
                <div class="bg-devo-black p-3 rounded-xl border border-devo-gray flex flex-col justify-center space-y-1">
                    <div class="flex justify-between text-xs"><span class="text-devo-muted">الإجمالي:</span> <span class="text-white font-bold">${o.total_price}</span></div>
                    <div class="flex justify-between text-xs"><span class="text-devo-muted">المدفوع:</span> <span class="text-devo-success font-bold">${o.deposit}</span></div>
                    <div class="flex justify-between text-sm border-t border-devo-gray pt-1 mt-1"><span class="text-white font-bold">المتبقي:</span> <span class="text-devo-orange font-black">${remaining}</span></div>
                </div>
            </div>

            <div class="relative shrink-0">
                <i class="ph ph-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-devo-muted"></i>
                <input type="text" oninput="filterModalTable(this.value)" placeholder="بحث داخل الأوردر باسم الموديل أو الكود..." 
                    class="w-full bg-devo-black border border-devo-gray rounded-xl pr-10 pl-4 py-2.5 text-white focus:border-devo-orange outline-none text-sm transition-all shadow-sm">
            </div>

            <div class="flex-1 overflow-hidden border border-devo-gray rounded-xl bg-devo-black flex flex-col max-h-[45vh]">
                <div class="overflow-y-auto custom-scrollbar flex-1">
                    <table class="w-full text-right text-sm">
                        <thead class="text-xs text-devo-muted bg-devo-dark sticky top-0 shadow-sm z-10">
                            <tr><th class="p-3">الموديل</th><th class="p-3">الألوان</th><th class="p-3 text-center">الكمية</th><th class="p-3 text-center">السعر</th><th class="p-3 text-left">الإجمالي</th></tr>
                        </thead>
                        <tbody id="modal-items-tbody" class="divide-y divide-devo-gray">
                            ${itemsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    const modal = document.getElementById('ao-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.filterModalTable = (term) => {
    term = term.toLowerCase().trim();
    const rows = document.querySelectorAll('#modal-items-tbody tr');
    rows.forEach(row => {
        const text = row.querySelector('.search-target')?.innerText.toLowerCase() || '';
        row.style.display = text.includes(term) ? '' : 'none';
    });
};
window.closeAdminOrderDetails = () => {
    const modal = document.getElementById('ao-details-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

// 🌟 المحرك المعزول للطباعة (Iframe Engine) يمنع تضارب الشاشات البيضاء 🌟
function printHtmlInIframe(htmlContent) {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '-9999px';
    iframe.style.bottom = '-9999px';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    iframe.onload = function() {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    };
}

window.printAdminOrder = (id, type) => {
    const o = allAdminOrders.find(x => x.id === id);
    if(!o) return;
    
    showToast('جاري تحضير الفاتورة للطباعة...', 'info');
    const remaining = o.total_price - (o.deposit || 0);
    const printDate = new Date(o.created_at);
    const dateString = `${printDate.getFullYear()}-${String(printDate.getMonth() + 1).padStart(2, '0')}-${String(printDate.getDate()).padStart(2, '0')}`;
    const pdfFileName = `${o.customer_name}_${o.phone_1}_${dateString}`;
    const groupedItems = {};
    o.order_items.forEach(item => {
        const modelId = item.model_id;
        const code = item.models?.factory_code || item.models?.system_code || '';
        const colorName = item.colors?.name || '-';
        const qty = item.quantity;
        const sizesCount = item.models?.model_sizes?.length || 1; 
        const pieces = qty * sizesCount;
        
        const colorWithQty = type === 'detailed' ? `${colorName} ${qty}` : colorName; 

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = { modelName: item.models?.name, code: code, colorsList: [colorWithQty], totalQty: qty, totalPieces: pieces, price: item.price_per_series, totalPrice: item.total_price };
        } else {
            if (type === 'customer' && !groupedItems[modelId].colorsList.includes(colorWithQty)) groupedItems[modelId].colorsList.push(colorWithQty);
            else if (type === 'detailed') groupedItems[modelId].colorsList.push(colorWithQty);
            
            groupedItems[modelId].totalQty += qty;
            groupedItems[modelId].totalPieces += pieces;
            groupedItems[modelId].totalPrice += item.total_price;
        }
    });

    let finalHtml = '';

    if (type === 'detailed') {
        let itemsHtml = Object.values(groupedItems).map((item, idx) => `
            <tr>
                <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
                <td style="font-weight: bold;">${item.modelName} ${item.code ? `<span class="code-span">(${item.code})</span>` : ''}</td>
                <td style="font-size: 11px;">${item.colorsList.join(' / ')}</td>
                <td style="text-align: center; font-weight: bold;">${item.totalQty} <span style="font-weight: normal; font-size: 10px;">(${item.totalPieces} ق)</span></td>
                <td style="text-align: center;">${item.price}</td>
                <td style="text-align: center; font-weight: 900; background-color: #f5f5f5 !important; -webkit-print-color-adjust: exact;">${item.totalPrice}</td>
            </tr>
        `).join('');

        finalHtml = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>${pdfFileName}</title>
                <style>
                    @page { size: A4 portrait; margin: 0.5cm; }
                    body { font-family: 'Tahoma', 'Arial', sans-serif; font-size: 12px; color: black; background: white; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    .erp-header { border-bottom: 2px solid black; padding-bottom: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
                    .erp-header h1 { margin: 0; font-size: 18px; font-weight: 900; letter-spacing: 1px; line-height: 1; }
                    .erp-header p { margin: 2px 0 0 0; font-size: 10px; font-weight: bold; }
                    .erp-header .title-box { text-align: left; }
                    .erp-header .title-box h2 { margin: 0; font-size: 14px; font-weight: bold; background: #eee; padding: 2px 6px; border: 1px solid #000; border-radius: 3px; }
                    .erp-info { display: flex; justify-content: space-between; border-bottom: 1px solid black; padding-bottom: 4px; margin-bottom: 6px; font-size: 11px; line-height: 1.4; }
                    .erp-info div { width: 48%; }
                    .erp-info .left-col { text-align: left; }
                    .erp-table { width: 100%; border-collapse: collapse; border: 1.5px solid #000; margin-bottom: 8px; }
                    .erp-table thead { display: table-header-group; background-color: #e5e5e5; }
                    .erp-table th { border: 1px solid #666; padding: 3px 4px; font-size: 11px; color: black; }
                    .erp-table td { border: 1px solid #aaa; padding: 2px 4px; line-height: 1.1; vertical-align: middle; }
                    .erp-table tbody tr { page-break-inside: avoid; height: 22px; }
                    .code-span { font-size: 9px; font-family: monospace; color: #444; }
                    .erp-totals-wrapper { display: flex; justify-content: flex-end; page-break-inside: avoid; }
                    .erp-totals { width: 220px; border: 1.5px solid black; border-radius: 3px; overflow: hidden; }
                    .erp-totals .row { display: flex; justify-content: space-between; padding: 4px 6px; border-bottom: 1px solid #aaa; font-size: 12px; }
                    .erp-totals .row:last-child { border-bottom: none; background: black !important; color: white !important; font-size: 14px; font-weight: bold; padding: 6px; -webkit-print-color-adjust: exact;}
                    .erp-footer { text-align: center; margin-top: 10px; padding-top: 4px; border-top: 1px dashed #999; font-size: 9px; color: #555; position: fixed; bottom: 0; width: 100%; }
                </style>
            </head>
            <body>
                <div class="erp-header">
                    <div><h1>DEVO <span style="font-size:11px; font-weight:bold;">Collection</span></h1><p>Phone: +20 12 12751111</p></div>
                    <div class="title-box"><h2>فاتورة تفصيلية للإدارة</h2><p style="margin-top: 4px;">رقم الأوردر: <span style="font-family: monospace; font-size: 12px; color: red;">${o.invoice_number}</span></p></div>
                </div>
                <div class="erp-info">
                    <div><div><b>العميل:</b> ${o.customer_name}</div><div><b>الهاتف:</b> <span dir="ltr">${o.phone_1} ${o.phone_2 ? ' / ' + o.phone_2 : ''}</span></div><div><b>العنوان:</b> ${o.address || '-'}</div></div>
                    <div class="left-col"><div><b>التاريخ:</b> ${new Date(o.created_at).toLocaleDateString('ar-EG')} &nbsp;|&nbsp; <b>الوقت:</b> ${new Date(o.created_at).toLocaleTimeString('ar-EG', {hour: '2-digit', minute:'2-digit'})}</div><div><b>الموظف:</b> ${o.system_users?.full_name}</div><div><b>العربون:</b> ${o.deposit} ج.م &nbsp;|&nbsp; <b>مستلم العربون:</b> ${o.deposit_receiver || '-'}</div></div>
                </div>
                <table class="erp-table">
                    <thead><tr><th style="width: 30px;">#</th><th>الموديل</th><th>تفصيل الألوان</th><th style="width: 80px;">الكمية</th><th style="width: 60px;">السعر</th><th style="width: 80px;">الإجمالي</th></tr></thead>
                    <tbody>${itemsHtml}</tbody>
                </table>
                <div class="erp-totals-wrapper"><div class="erp-totals"><div class="row"><b>الإجمالي الكلي:</b> <b>${o.total_price}</b></div><div class="row" style="background: #f9f9f9 !important; -webkit-print-color-adjust: exact;"><b>المدفوع:</b> <b>${o.deposit}</b></div><div class="row"><b>المتبقي:</b> <span>${remaining} ج.م</span></div></div></div>
                <div class="erp-footer">Printed by DEVO System | Engineer Ahmed M. Attia</div>
            </body>
            </html>
        `;

    } else if (type === 'customer') {
let custHtml = Object.values(groupedItems).map((item, idx) => `
            <tr>
                <td style="padding: 2px 4px; border: 1px solid #ccc; text-align: center;">${idx + 1}</td>
                <td style="padding: 2px 4px; border: 1px solid #ccc; font-weight: bold;">
                    ${item.modelName} ${item.code ? `<span style="font-size:10px; color:#555; font-family: monospace; margin-right: 4px;">(${item.code})</span>` : ''}
                </td>
                <td style="padding: 2px 4px; border: 1px solid #ccc; text-align: center; font-size:10px;">${item.colorsList.join('، ')}</td>
                <td style="padding: 2px 4px; border: 1px solid #ccc; text-align: center; font-weight: bold;">${item.totalPieces}</td>
                <td style="padding: 2px 4px; border: 1px solid #ccc; text-align: center;">${item.price}</td>
                <td style="padding: 2px 4px; border: 1px solid #ccc; text-align: center; font-weight: bold; background: #f9f9f9 !important; -webkit-print-color-adjust: exact;">${item.totalPrice}</td>
            </tr>
        `).join('');

        finalHtml = `
            <!DOCTYPE html>
            <html lang="ar" dir="rtl">
            <head>
                <meta charset="UTF-8">
                <title>${pdfFileName}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
                    @page { margin: 0.5cm; }
                    body { font-family: 'Tajawal', sans-serif; background: white; margin: 0; color: black; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                </style>
            </head>
            <body>
            <div style="border-bottom:4px solid black; padding-bottom:6px; margin-bottom:10px;">

    <div style="display:flex; align-items:center; gap:10px;">
            <span style="
            background:#c7d7e5;
            padding:3px 10px;
            font-size:16px;
            font-weight:700;
            letter-spacing:2px;">
             Collection
        </span>
        <span style="font-size:28px; font-weight:900; letter-spacing:1px;">
            DEVO
        </span>
    </div>

    <div style="font-size:14px; font-weight:600; margin-top:4px;">
        Phone: +20 12 12751111
    </div>

</div>

<div style="display:flex; justify-content:space-between; font-size:12px; margin-top:8px;">
    <div>
        <b>رقم:</b>
        <span style="color:red; font-family:monospace; font-size:16px;">
            ${o.invoice_number}
        </span>
    </div>

    <div>
        التاريخ: ${new Date(o.created_at).toLocaleDateString('ar-EG')}
    </div>

    <div>
        الكاشير: ${o.system_users?.full_name}
    </div>
</div>
                <div style="background: #f3f4f6; padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 15px; font-size: 12px;"><b>العميل:</b> ${o.customer_name} &nbsp;|&nbsp; <b>هاتف:</b> <span dir="ltr">${o.phone_1}</span></div>
                <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 15px; border: 1px solid black;">
                    <thead style="background: black !important; color: white !important; -webkit-print-color-adjust: exact;"><tr><th style="padding: 6px;">م</th><th style="padding: 6px;">الموديل</th><th style="padding: 6px;">اللون</th><th style="padding: 6px;">الكمية (ق)</th><th style="padding: 6px;">السعر</th><th style="padding: 6px;">الإجمالي</th></tr></thead>
                    <tbody>${custHtml}</tbody>
                </table>
                <div style="display: flex; justify-content: flex-end; page-break-inside: avoid;">
                    <div style="border: 2px solid black; width: 250px; border-radius: 4px; overflow: hidden;">
                        <div style="padding: 6px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 12px;"><span>الإجمالي:</span> <b>${o.total_price}</b></div>
                        <div style="padding: 6px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 12px; background: #f9f9f9 !important; -webkit-print-color-adjust: exact;"><span>المدفوع:</span> <b style="color: green;">${o.deposit}</b></div>
                        <div style="padding: 8px; display: flex; justify-content: space-between; font-size: 14px; background: black !important; color: white !important; -webkit-print-color-adjust: exact;"><span>المتبقي:</span> <b>${remaining} ج.م</b></div>
                    </div>
                </div>
                <div style="text-align: center; margin-top: 20px; font-size: 10px; border-top: 1px dashed #ccc; padding-top: 10px;">Engineered by Ahmed M. Attia</div>
            </body>
            </html>
        `;
    }

    printHtmlInIframe(finalHtml);
};

window.deleteOrder = async (id) => {
    const confirmed = await confirmDialog({ 
        title: 'حذف الأوردر', 
        message: 'هل أنت متأكد من الحذف؟ سيتم إرجاع جميع الكميات إلى المخزن.', 
        isDestructive: true 
    });
    
    if (confirmed) {
        showToast('جاري الحذف وإرجاع المخزون...', 'info');
        const { error } = await supabase.rpc('delete_order_safely', { p_order_id: id });
        if (error) showToast('حدث خطأ أثناء الحذف', 'error');
        else showToast('تم الحذف بنجاح', 'success');
    }
};

window.exportOrdersToExcel = () => {
    if (allAdminOrders.length === 0) return showToast('لا توجد بيانات للتصدير', 'warning');
    showToast('جاري تجهيز ملف الإكسيل...', 'info');
    const excelData = [];
    allAdminOrders.forEach(o => {
        o.order_items.forEach(i => {
            const sizesCount = i.models?.model_sizes?.length || 1;
            excelData.push({
                'رقم الفاتورة': o.invoice_number,
                'التاريخ': new Date(o.created_at).toLocaleDateString('ar-EG'),
                'اسم العميل': o.customer_name,
                'رقم الهاتف': o.phone_1,
                'الموظف البائع': o.system_users?.full_name,
                'كود الموديل': i.models?.factory_code || i.models?.system_code,
                'اسم الموديل': i.models?.name,
                'اللون': i.colors?.name,
                'عدد السيريّات': i.quantity,
                'إجمالي القطع': i.quantity * sizesCount,
                'سعر القطعة': i.price_per_series,
                'إجمالي الصنف': i.total_price,
                'حالة الأوردر': statusConfig[o.status]?.text || ''
            });
        });
    });
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    if(!worksheet['!views']) worksheet['!views'] = [];
    worksheet['!views'].push({ rightToLeft: true });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "الأوردرات");
    XLSX.writeFile(workbook, `DEVO_Orders_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('تم تحميل الملف بنجاح', 'success');
};

// 🌟 النظام الجديد لتصدير أوردر واحد للإدخال للـ ERP 🌟
window.exportSingleOrderToExcel = (id) => {
    const o = allAdminOrders.find(x => x.id === id);
    if (!o) return;

    showToast('جاري تجهيز ملف الإكسيل...', 'info');

    // 1. معالجة وتجهيز اسم الملف (CustomerName_OrderNumber_Date.xlsx)
    const cleanCustomerName = (o.customer_name || 'Customer').replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').replace(/\s+/g, '_').trim();
    const dateStr = new Date(o.created_at).toISOString().split('T')[0];
    const fileName = `${cleanCustomerName}_ORD${o.invoice_number}_${dateStr}.xlsx`;

    // 2. تجميع البيانات حسب المسميات الإنجليزية المطلوبة للإدخال
const excelData = o.order_items.map(i => {
        const sizesCount = i.models?.model_sizes?.length || 1;
        return {
            'System Code': i.models?.system_code || '',
            'Model Code': i.models?.factory_code || '',
            'Model Name': i.models?.name || '',
            'Color Code': i.colors?.color_code || '', 
            'Color Name': i.colors?.name || '',
            'Series Size': sizesCount,
            'Series Qty': i.quantity,
            'Pieces Qty': i.quantity * sizesCount,
            'Unit Price': i.price_per_series, 
            'Total': i.total_price
        };
    });

    // 3. إنشاء الشيت وضبط مسافات الأعمدة (لتبقى منظمة عند الفتح)
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    worksheet['!cols'] = [
        { wch: 15 }, // System Code
        { wch: 15 }, // Model Code
        { wch: 30 }, // Model Name
        { wch: 35 }, // Color Code (ID)
        { wch: 20 }, // Color Name
        { wch: 12 }, // Series Size
        { wch: 12 }, // Series Qty
        { wch: 12 }, // Pieces Qty
        { wch: 12 }, // Unit Price
        { wch: 15 }  // Total
    ];

    // 4. بناء الملف وتنزيله
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Order_Items");
    XLSX.writeFile(workbook, fileName);

    showToast('تم تحميل ملف الأوردر بنجاح', 'success');
};