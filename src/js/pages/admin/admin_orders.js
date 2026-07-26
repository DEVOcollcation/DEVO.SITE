import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { getCurrentSession } from '../../services/auth.js';
import { printOrderCustomerInvoice } from '../../utils/print.js?v=2';

let isInitialized = false;
let allAdminOrders = [];
let currentUserProfile = null;
let currentEditingOrderId = null;
let localEditingItems = [];
let isLocalEditMode = false;
let localEditingInventory = {};

const statusConfig = {
    'created': { text: 'تم إنشاء الأوردر', color: 'bg-devo-gray text-white border-devo-gray' },
    'in_progress': { text: 'جاري العمل', color: 'bg-devo-orange/20 text-devo-orange border-devo-orange/50' },
    'editing': { text: 'جاري التعديل', color: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
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
        document.getElementById(id)?.addEventListener('input', applyAdminOrdersFilter);
    });

    await fetchAdminOrders();
    setupRealtimeAdminOrders(); // 🌟 تفعيل الرادار اللحظي الذكي 🌟

    isInitialized = true;
}

// ==========================================
// 🌟 1. استدعاء البيانات الأساسي 🌟
// ==========================================
export async function fetchAdminOrders() {
    const tBody = document.getElementById('ao-table-body');
    if(tBody && allAdminOrders.length === 0) tBody.innerHTML = `<tr><td colspan="9" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i></td></tr>`;

    const { data, error } = await supabase
        .from('orders')
        .select(`
            *,
            system_users!worker_id (full_name),
            order_items (
                *,
                models (name, factory_code, system_code, model_sizes(size_id), classes(class_sizes(size_id))),
                colors (id, name, color_code)
            )
        `)
        .order('created_at', { ascending: false });
        
    if (!error && data) {
        allAdminOrders = data;
        updateAdminStats();
        applyAdminOrdersFilter();
    } else if (error) {
        showToast('حدث خطأ أثناء جلب الأوردرات', 'error');
        console.error(error);
    }
}

async function fetchFullOrderById(orderId) {
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                system_users!worker_id (full_name),
                order_items (
                    *,
                    models (name, factory_code, system_code, model_sizes(size_id), classes(class_sizes(size_id))),
                    colors (id, name, color_code)
                )
            `)
            .eq('id', orderId)
            .maybeSingle();

        if (data && !error) {
            const index = allAdminOrders.findIndex(o => o.id === orderId);
            if (index > -1) {
                allAdminOrders[index] = data;
            } else {
                allAdminOrders.unshift(data);
            }
            return data;
        }
    } catch (e) {
        console.error('Error fetching full order by ID:', e);
    }
    return null;
}

// ==========================================
// 🌟 2. الرادار اللحظي (Targeted DOM Updates) 🌟
// ==========================================
function setupRealtimeAdminOrders() {
    supabase.channel('admin_orders_tracker')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
            // جلب الأوردر الجديد بالكامل مع علاقاته
            const data = await fetchFullOrderById(payload.new.id);
            
            if (data) {
                updateAdminStats();
                
                const tbody = document.getElementById('ao-table-body');
                if (tbody) {
                    const noDataRow = tbody.querySelector('.no-data-row');
                    if(noDataRow) noDataRow.remove(); 
                    
                    // حقن الصف الجديد في أعلى الجدول
                    tbody.insertAdjacentHTML('afterbegin', generateOrderRowHTML(data));
                    
                    // تنبيه مرئي (وميض برتقالي) للصف الجديد
                    const newRow = document.getElementById(`admin-order-row-${data.id}`);
                    if(newRow) {
                        newRow.classList.add('bg-devo-orange/30', 'transition-all', 'duration-500');
                        setTimeout(() => newRow.classList.remove('bg-devo-orange/30'), 3000);
                    }
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async (payload) => {
            // جلب الأوردر التراكمي بالأصناف كاملة
            const updatedOrder = await fetchFullOrderById(payload.new.id) || payload.new;
            const index = allAdminOrders.findIndex(o => o.id === payload.new.id);
            if (index > -1) {
                updateAdminStats();
                
                // 🌟 تحديث الـ DOM للصف المستهدف وعمل وميض ملفت للانتباه لكي يعرف الأدمن أن هناك من يعمل عليه 🌟
                const existingRow = document.getElementById(`admin-order-row-${payload.new.id}`);
                if (existingRow) {
                    existingRow.outerHTML = generateOrderRowHTML(allAdminOrders[index]);
                    
                    const newRow = document.getElementById(`admin-order-row-${payload.new.id}`);
                    if (newRow) {
                        newRow.classList.add('bg-devo-info/30', 'transition-all', 'duration-500');
                        setTimeout(() => newRow.classList.remove('bg-devo-info/30'), 2000);
                    }
                }
            }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, (payload) => {
            allAdminOrders = allAdminOrders.filter(o => o.id !== payload.old.id);
            updateAdminStats();
            
            // إزالة الصف من الشاشة بتأثير حركي
            const existingRow = document.getElementById(`admin-order-row-${payload.old.id}`);
            if (existingRow) {
                existingRow.classList.add('opacity-0', 'scale-95', 'transition-all');
                setTimeout(() => existingRow.remove(), 300);
            }
        })
        .subscribe((status, err) => {
            if (err) console.error('⚠️ خطأ في اتصال الرادار:', err);
        });
}

// 🌐 إعادة الاتصال التلقائي برادار الأدمن عند عودة الإنترنت 🌐
window.addEventListener('online', () => {
    setupRealtimeAdminOrders();
});

// ==========================================
// 🌟 3. هندسة الـ HTML للصف الواحد 🌟
// ==========================================
function generateOrderRowHTML(o) {
    const dateStr = new Date(o.created_at).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour:'2-digit', minute:'2-digit' });
    const isOwner = currentUserProfile?.role === 'owner';
    const conf = statusConfig[o.status] || { text: 'غير معروف', color: 'text-devo-muted bg-transparent' };
    
    // الصلاحيات
    const isAssignedToMe = o.assigned_admin_name === currentUserProfile?.full_name;
    const canEdit = !o.is_locked || isAssignedToMe || isOwner;

    const isOwnerOrAdmin = currentUserProfile?.role === 'owner' || currentUserProfile?.role === 'admin';

    // الحماية والتأكد من إمكانية التعديل
    const isEditable = o.status === 'created' && !o.is_locked;
    const editBtnHtml = isOwnerOrAdmin
        ? (isEditable 
            ? `<button onclick="openEditOrderChoices('${o.id}')" class="p-1.5 bg-devo-orange/20 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors" title="تعديل الأوردر"><i class="ph ph-pencil-simple text-lg"></i></button>`
            : `<button disabled class="p-1.5 bg-devo-gray/30 text-devo-muted rounded cursor-not-allowed opacity-50" title="${o.is_locked ? 'الأوردر مقفل أو قيد التعديل حالياً' : 'يجب إعادة حالة الأوردر إلى تم إنشاء الأوردر لتعديله'}"><i class="ph ph-lock text-lg text-devo-muted"></i></button>`)
        : '';

    const lockIcon = `<button onclick="toggleOrderLock('${o.id}', ${!o.is_locked})" class="${o.is_locked ? 'text-devo-error' : 'text-devo-success'} p-1 hover:bg-white/10 rounded transition-colors" title="${o.is_locked ? 'إلغاء القفل' : 'قفل واستلام الأوردر'}"><i class="ph ${o.is_locked ? 'ph-lock' : 'ph-lock-open'} text-lg"></i></button>`;

    const assignedHTML = o.assigned_admin_name 
        ? `<span class="bg-devo-info/20 text-devo-info px-2 py-1 rounded text-[10px] font-bold"><i class="ph ph-user-gear"></i> ${o.assigned_admin_name}</span>` 
        : `<span class="text-devo-muted text-[10px]">-</span>`;

    const buildStatusOptions = (currentVal) => {
        return Object.keys(statusConfig).map(k => `<option value="${k}" ${k === currentVal ? 'selected' : ''}>${statusConfig[k].text}</option>`).join('');
    };

    return `
        <tr id="admin-order-row-${o.id}" class="hover:bg-devo-black/40 transition-colors">
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
                <div class="mt-1 text-[10px] ${conf.color} px-2 py-0.5 rounded inline-block">${conf.text}</div>
            </td>
            <td class="p-3">
                <div class="flex items-center justify-center gap-1.5">
                    <button onclick="exportSingleOrderToExcel('${o.id}')" class="p-1.5 bg-devo-success/10 text-devo-success hover:bg-devo-success hover:text-white rounded transition-colors" title="تصدير (Excel)"><i class="ph ph-file-xls text-lg"></i></button>

                    <button onclick="printAdminOrder('${o.id}', 'customer')" class="p-1.5 bg-gray-200 text-gray-800 hover:bg-white rounded transition-colors" title="طباعة فاتورة العميل"><i class="ph ph-receipt text-lg"></i></button>
                    <button onclick="printAdminOrder('${o.id}', 'detailed')" class="p-1.5 bg-devo-orange/20 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors" title="طباعة فاتورة الإدارة"><i class="ph ph-printer text-lg"></i></button>
                    ${editBtnHtml}
                    <button onclick="viewAdminOrderDetails('${o.id}')" class="p-1.5 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded transition-colors" title="التفاصيل"><i class="ph ph-eye text-lg"></i></button>
                    ${isOwner ? `<button onclick="deleteOrder('${o.id}')" class="p-1.5 bg-devo-error/10 text-devo-error hover:bg-devo-error hover:text-white rounded transition-colors" title="حذف وإرجاع المخزون"><i class="ph ph-trash text-lg"></i></button>` : ''}
                </div>
            </td>
        </tr>
    `;
}

// ==========================================
// 🌟 4. الإحصائيات والفلترة 🌟
// ==========================================
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

window.applyAdminOrdersFilter = () => {
    const term = document.getElementById('ao-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('ao-status')?.value || '';
    const dateFrom = document.getElementById('ao-date-from')?.value;
    const dateTo = document.getElementById('ao-date-to')?.value;

    const filtered = allAdminOrders.filter(o => {
        if (term) {
            const matchesMain = o.invoice_number.toLowerCase().includes(term) 
                             || o.customer_name.toLowerCase().includes(term) 
                             || (o.phone_1||'').includes(term)
                             || (o.system_users?.full_name||'').toLowerCase().includes(term);
                             
            const matchesItems = o.order_items && o.order_items.some(item => {
                const modelName = (item.models?.name || '').toLowerCase();
                const factoryCode = (item.models?.factory_code || '').toLowerCase();
                const systemCode = (item.models?.system_code || '').toLowerCase();
                const colorName = (item.colors?.name || '').toLowerCase();
                return modelName.includes(term) || factoryCode.includes(term) || systemCode.includes(term) || colorName.includes(term);
            });
            
            if (!matchesMain && !matchesItems) return false;
        }
                 
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
        tbody.innerHTML = `<tr class="no-data-row"><td colspan="9" class="p-10 text-center text-devo-muted">لا توجد أوردرات تطابق بحثك.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(o => generateOrderRowHTML(o)).join('');
};

// ==========================================
// 🌟 5. إجراءات الإدارة (تحديث، قفل، تفاصيل، طباعة) 🌟
// ==========================================

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

    // التحديث اللحظي الصامت (Optimistic Update)
    o.status = newStatus;
    o.is_locked = lockState;
    o.assigned_admin_name = assignedAdmin;
    const row = document.getElementById(`admin-order-row-${id}`);
    if (row) row.outerHTML = generateOrderRowHTML(o);

    const { error } = await supabase.from('orders').update({ 
        status: newStatus, 
        is_locked: lockState, 
        assigned_admin_name: assignedAdmin 
    }).eq('id', id);

    if (error) {
        showToast(error.message || 'حدث خطأ أثناء تحديث الحالة', 'error');
        await fetchAdminOrders(); // لإعادة الحالة إلى ما كانت عليه بالـ DB
    } else {
        showToast('تم تحديث وتخصيص الأوردر بنجاح', 'success');
        const statusText = statusConfig[newStatus]?.text || newStatus;
        await logOrderAction(id, 'status_changed', `تم تغيير حالة الأوردر إلى (${statusText}) بواسطة الإداري ${currentUserProfile?.full_name || ''}`);
    }
};

window.toggleOrderLock = async (id, lockState) => {
    const o = allAdminOrders.find(x => x.id === id);
    if(!o) return;

    if (currentUserProfile?.role !== 'owner' && o.assigned_admin_name && o.assigned_admin_name !== currentUserProfile?.full_name) {
        return showToast('لا تملك صلاحية فتح قفل هذا الأوردر، تواصل مع المالك.', 'error');
    }

    // التحديث اللحظي الصامت
    o.is_locked = lockState;
    o.assigned_admin_name = lockState ? currentUserProfile?.full_name : null;
    const row = document.getElementById(`admin-order-row-${id}`);
    if (row) row.outerHTML = generateOrderRowHTML(o);

    const { error } = await supabase.from('orders').update({ 
        is_locked: lockState,
        assigned_admin_name: o.assigned_admin_name
    }).eq('id', id);

    if (!error) {
        showToast(lockState ? 'تم قفل الأوردر واستلامه' : 'تم فتح الأوردر للجميع', 'success');
        await logOrderAction(id, lockState ? 'locked' : 'unlocked', lockState ? `تم قفل واستلام الأوردر بواسطة الإداري ${currentUserProfile?.full_name || ''}` : `تم إلغاء قفل الأوردر وإتاحته للجميع بواسطة الإداري ${currentUserProfile?.full_name || ''}`);
    }
};


window.viewAdminOrderDetails = async (id) => {
    const freshOrder = await fetchFullOrderById(id);
    const o = freshOrder || allAdminOrders.find(x => x.id === id);
    if (!o) return;

    const remaining = o.total_price - (o.deposit || 0);
    const groupedItems = {};

    o.order_items.forEach(item => {
        const modelId = item.model_id;
        const code = item.models?.factory_code || item.models?.system_code || '';
        const colorName = item.colors?.name || '-';
        const qty = item.quantity;
        
        // حساب المقاسات الذكي
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1); 
        const pieces = qty * sizesCount;
        const piecePrice = item.price_per_series / sizesCount;
        
        const colorWithQty = `${qty} ${colorName}`;

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = {
                modelName: item.models?.name, code: code,
                colorsList: [colorWithQty],
                totalQty: qty, totalPieces: pieces, 
                price: piecePrice, totalPrice: item.total_price
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

    // جلب سجل الحركات بقاعدة البيانات للأوردر
    let logsHtml = '';
    try {
        const { data: logs, error: logsError } = await supabase
            .from('order_logs')
            .select('*')
            .eq('order_id', id)
            .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        if (logs && logs.length > 0) {
            logsHtml = `
                <div class="mt-4 border-t border-devo-gray pt-4 shrink-0">
                    <h5 class="text-xs text-devo-orange font-bold mb-3 flex items-center gap-1.5"><i class="ph ph-clock-counter-clockwise"></i> سجل حركات وتعديلات الأوردر</h5>
                    <div class="space-y-2.5 max-h-[160px] overflow-y-auto custom-scrollbar text-xs">
                        ${logs.map(log => {
                            const logDate = new Date(log.created_at).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                            return `
                                <div class="flex gap-2.5 items-start">
                                    <div class="w-1.5 h-1.5 rounded-full bg-devo-orange mt-1.5 shrink-0 shadow-sm shadow-devo-orange/50"></div>
                                    <div class="flex-1 text-devo-text font-medium">
                                        <span class="font-normal">${log.notes}</span>
                                        <span class="text-[10px] text-devo-muted mr-1.5 font-mono">(${logDate})</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            logsHtml = `
                <div class="mt-4 border-t border-devo-gray pt-3 shrink-0 text-xs text-devo-muted">
                    <i class="ph ph-info mr-1"></i> لا توجد حركات مسجلة لهذا الأوردر بعد.
                </div>
            `;
        }
    } catch (e) {
        console.error('Error fetching logs:', e);
    }

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

            <div class="flex-1 overflow-hidden border border-devo-gray rounded-xl bg-devo-black flex flex-col max-h-[30vh]">
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

            <!-- سجل حركات الأوردر -->
            ${logsHtml}
        </div>
    `;

    const modal = document.getElementById('ao-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);

    // ربط أزرار الطباعة بقيم الأوردر الحالي المعروض
    const printCustBtn = document.getElementById('ao-print-customer-btn');
    const printDetBtn = document.getElementById('ao-print-detailed-btn');
    if (printCustBtn) {
        printCustBtn.onclick = () => window.printAdminOrder(o.id, 'customer');
    }
    if (printDetBtn) {
        printDetBtn.onclick = () => window.printAdminOrder(o.id, 'detailed');
    }
};

window.filterModalTable = (term) => {
    term = term.toLowerCase().trim();
    const rows = document.querySelectorAll('#modal-items-tbody tr');
    rows.forEach(row => {
        const text = row.querySelector('.search-target')?.innerText.toLowerCase() || '';
        row.style.display = text.includes(term) ? '' : 'none';
    });
};
window.closeAdminOrderDetails = async () => {
    const modal = document.getElementById('ao-details-modal');
    modal.classList.add('opacity-0');
    
    if (isLocalEditMode && currentEditingOrderId) {
        const orderId = currentEditingOrderId;
        try {
            const { error } = await supabase.from('orders').update({
                is_locked: false,
                assigned_admin_name: null,
                status: 'created'
            }).eq('id', orderId);
            
            if (error) {
                console.error('Failed to unlock order on modal close:', error);
            } else {
                const o = allAdminOrders.find(x => x.id === orderId);
                if (o) {
                    o.is_locked = false;
                    o.assigned_admin_name = null;
                    o.status = 'created';
                    const row = document.getElementById(`admin-order-row-${orderId}`);
                    if (row) row.outerHTML = generateOrderRowHTML(o);
                }
            }
            await logOrderAction(orderId, 'local_edit_cancel', `ألغى الإداري ${currentUserProfile?.full_name || ''} تعديل الأوردر محلياً (إغلاق التفاصيل)`);
        } catch (e) {
            console.error('Error unlocking order on modal close:', e);
        }
    }

    setTimeout(() => {
        modal.classList.add('hidden');
        currentEditingOrderId = null;
        isLocalEditMode = false;
        localEditingItems = [];
        localEditingInventory = {};
    }, 300);
};

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

window.printAdminOrder = async (id, type) => {
    const freshOrder = await fetchFullOrderById(id);
    const o = freshOrder || allAdminOrders.find(x => x.id === id);
    if(!o) return;
    
    if (type === 'customer') {
        printOrderCustomerInvoice(o);
        return;
    }

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
        
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1); 
        const pieces = qty * sizesCount;
        
        const colorWithQty = `${colorName} ${qty}`; 

        const piecePrice = item.price_per_series / sizesCount;

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = { modelName: item.models?.name, code: code, colorsList: [colorWithQty], totalQty: qty, totalPieces: pieces, price: piecePrice, totalPrice: item.total_price };
        } else {
            groupedItems[modelId].colorsList.push(colorWithQty);
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
                    .erp-totals .row:last-child { border-bottom: none; background: #e5e7eb !important; color: black !important; font-size: 14px; font-weight: bold; padding: 6px; border-top: 1px solid #aaa; -webkit-print-color-adjust: exact;}
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
                <div class="erp-footer">Developed by <a href="https://www.facebook.com/share/1NiodPNtXF/" target="_blank" style="color: inherit; text-decoration: none; font-weight: bold;">UltraSoft</a> - +201140409832</div>
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

function formatOrderExportNotes(o) {
    const depositVal = parseFloat(o.deposit);
    const hasDeposit = !isNaN(depositVal) && depositVal > 0;
    const depositText = hasDeposit ? `العربون ${o.deposit}` : '';
    const mainNotes = o.notes ? String(o.notes).trim() : '';

    if (depositText && mainNotes) {
        return `${depositText} - ${mainNotes}`;
    } else if (depositText) {
        return depositText;
    } else {
        return mainNotes;
    }
}

window.exportOrdersToExcel = () => {
    if (allAdminOrders.length === 0) return showToast('لا توجد بيانات للتصدير', 'warning');
    showToast('جاري تجهيز ملف الإكسيل...', 'info');
    const excelData = [];
    allAdminOrders.forEach(o => {
        const orderNotes = formatOrderExportNotes(o);
        (o.order_items || []).forEach((i, idx) => {
            const sizesCount = i.sizes_count || getModelSizesCount(i.models);
            const piecesQty = i.total_pieces || (i.quantity * sizesCount);
            const unitPrice = i.piece_price || (sizesCount > 0 ? (i.price_per_series / sizesCount) : (i.price_per_series || 0));

            excelData.push({
                'الملاحظات': idx === 0 ? orderNotes : '',
                'كود المخزن': 1,
                'كودالصنف': i.models?.system_code || '',
                'عدد': piecesQty,
                'الفئة': unitPrice,
                'هدية': '',
                'سيريال': '-',
                'باتش': 1,
                'ت صلاحية': '',
                'اسم اللون': i.colors?.name || '',
                'كود المقاس': 1
            });
        });
    });
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    if (!worksheet['!views']) worksheet['!views'] = [];
    worksheet['!views'].push({ rightToLeft: true });
    worksheet['!cols'] = [
        { wch: 30 }, { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, 
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, 
        { wch: 12 }
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "الأوردرات");
    XLSX.writeFile(workbook, `DEVO_Orders_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('تم تحميل الملف بنجاح', 'success');
};

window.exportSingleOrderToExcel = async (id) => {
    const freshOrder = await fetchFullOrderById(id);
    const o = freshOrder || allAdminOrders.find(x => x.id === id);
    if (!o) return;

    showToast('جاري تجهيز ملف الإكسيل...', 'info');

    const cleanCustomerName = (o.customer_name || 'Customer').replace(/[^a-zA-Z0-9\u0600-\u06FF\s]/g, '').replace(/\s+/g, '_').trim();
    const dateStr = new Date(o.created_at).toISOString().split('T')[0];
    const fileName = `${cleanCustomerName}_ORD${o.invoice_number}_${dateStr}.xlsx`;
    const orderNotes = formatOrderExportNotes(o);

    const excelData = (o.order_items || []).map((i, idx) => {
        const sizesCount = i.sizes_count || getModelSizesCount(i.models);
        const piecesQty = i.total_pieces || (i.quantity * sizesCount);
        const unitPrice = i.piece_price || (sizesCount > 0 ? (i.price_per_series / sizesCount) : (i.price_per_series || 0));

        return {
            'الملاحظات': idx === 0 ? orderNotes : '',
            'كود المخزن': 1,
            'كودالصنف': i.models?.system_code || '',
            'عدد': piecesQty,
            'الفئة': unitPrice,
            'هدية': '',
            'سيريال': '-',
            'باتش': 1,
            'ت صلاحية': '',
            'اسم اللون': i.colors?.name || '',
            'كود المقاس': 1
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    if (!worksheet['!views']) worksheet['!views'] = [];
    worksheet['!views'].push({ rightToLeft: true });
    worksheet['!cols'] = [
        { wch: 30 }, { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, 
        { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 15 }, { wch: 15 }, 
        { wch: 12 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Order_Items");
    XLSX.writeFile(workbook, fileName);

    showToast('تم تحميل ملف الأوردر بنجاح', 'success');
};

// --- Custom Sort Handler ---
window.customSortHandlers = window.customSortHandlers || {};
window.customSortHandlers['admin-orders-table'] = (colIndex, direction) => {
    allAdminOrders.sort((a, b) => {
        let valA, valB;
        switch (colIndex) {
            case 0: // رقم الأوردر
                valA = a.invoice_number || '';
                valB = b.invoice_number || '';
                break;
            case 1: // التاريخ
                valA = new Date(a.created_at);
                valB = new Date(b.created_at);
                break;
            case 2: // العميل / المحل
                valA = a.customer_name || '';
                valB = b.customer_name || '';
                break;
            case 3: // البائع
                valA = a.system_users?.full_name || '';
                valB = b.system_users?.full_name || '';
                break;
            case 4: // الكمية
                valA = a.total_series || 0;
                valB = b.total_series || 0;
                break;
            case 5: // الإجمالي
                valA = a.total_price || 0;
                valB = b.total_price || 0;
                break;
            case 6: // مسند إلى
                valA = a.assigned_admin_name || '';
                valB = b.assigned_admin_name || '';
                break;
            case 7: // الحالة
                valA = a.status || '';
                valB = b.status || '';
                break;
            default:
                return 0;
        }

        if (typeof valA === 'string') {
            return direction === 'asc' ? valA.localeCompare(valB, 'ar') : valB.localeCompare(valA, 'ar');
        } else {
            return direction === 'asc' ? valA - valB : valB - valA;
        }
    });

    window.applyAdminOrdersFilter();
};


// =========================================================================
// 🌟 6. خيارات وإجراءات تعديل الأوردرات (الخيارات الثلاثة) 🌟
// =========================================================================

window.openEditOrderChoices = async (orderId) => {
    currentEditingOrderId = orderId;
    const freshOrder = await fetchFullOrderById(orderId);
    const o = freshOrder || allAdminOrders.find(x => x.id === orderId);
    if (!o) return;

    // إعادة تعيين خطوات المودال
    document.getElementById('eoc-step-select').classList.remove('hidden');
    document.getElementById('eoc-step-assign').classList.add('hidden');
    
    // عرض رقم الفاتورة في العنوان
    document.getElementById('eoc-order-number').textContent = `(#${o.invoice_number})`;

    // إظهار المودال
    const modal = document.getElementById('edit-order-choices-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeEditOrderChoices = (keepOrderContext = false) => {
    const modal = document.getElementById('edit-order-choices-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        if (!keepOrderContext) {
            currentEditingOrderId = null;
        }
    }, 300);
};

window.showSelectChoicesStep = () => {
    document.getElementById('eoc-step-select').classList.remove('hidden');
    document.getElementById('eoc-step-assign').classList.add('hidden');
};

window.showAssignWorkerStep = async () => {
    document.getElementById('eoc-step-select').classList.add('hidden');
    document.getElementById('eoc-step-assign').classList.remove('hidden');

    const select = document.getElementById('eoc-worker-select');
    select.innerHTML = '<option value="">-- اختر الموظف --</option>';

    try {
        const { data: users, error } = await supabase
            .from('system_users')
            .select('id, full_name, role, worker_job')
            .eq('is_active', true)
            .order('full_name', { ascending: true });

        if (error) throw error;

        if (users) {
            users.forEach(u => {
                let jobLabel = u.role === 'owner' ? 'مالك' : (u.role === 'admin' ? 'مشرف' : '');
                if (u.role === 'worker') {
                    if (u.worker_job === 'showroom') jobLabel = 'مبيعات المعرض';
                    else if (u.worker_job === 'warehouse') jobLabel = 'أمين مخزن';
                    else jobLabel = 'مبيعات + مخزن';
                }
                const option = document.createElement('option');
                option.value = u.id;
                option.textContent = `${u.full_name} (${jobLabel})`;
                select.appendChild(option);
            });
        }
    } catch (e) {
        showToast('خطأ أثناء جلب الموظفين: ' + e.message, 'error');
    }
};

// --- الخيار الأول: التعديل المحلي ---
window.triggerLocalEdit = async () => {
    if (!currentEditingOrderId) return;
    const o = allAdminOrders.find(x => x.id === currentEditingOrderId);
    if (!o) return;

    if (o.is_locked && o.assigned_admin_name && o.assigned_admin_name !== currentUserProfile?.full_name && currentUserProfile?.role !== 'owner') {
        return showToast('هذا الأوردر مغلق بواسطة إداري آخر!', 'error');
    }

    // قفل الأوردر بقاعدة البيانات فوراً لمنع التعديل المتزامن وتغيير الحالة إلى جاري التعديل
    const adminName = currentUserProfile?.full_name || 'أدمن';
    const { error } = await supabase.rpc('acquire_order_lock', {
        p_order_id: o.id,
        p_assigned_admin_name: adminName
    });

    if (error) {
        return showToast('فشل قفل الأوردر للتعديل: ' + error.message, 'error');
    }

    o.is_locked = true;
    o.assigned_admin_name = currentUserProfile?.full_name;
    o.status = 'editing';
    const row = document.getElementById(`admin-order-row-${o.id}`);
    if (row) row.outerHTML = generateOrderRowHTML(o);

    await logOrderAction(o.id, 'local_edit_start', `بدأ الإداري ${currentUserProfile?.full_name || ''} تعديل الأوردر محلياً`);

    closeEditOrderChoices(true);
    
    isLocalEditMode = true;
    localEditingItems = o.order_items.map(item => ({
        ...item,
        isDeleted: false
    }));

    // جلب كميات المخزن المتاحة لكل موديل ولون معروضين وتخزينها محلياً لتفادي الطلبات المتكررة عند التعديل
    localEditingInventory = {};
    const modelIds = [...new Set(localEditingItems.map(item => item.model_id))];
    if (modelIds.length > 0) {
        try {
            const { data: invData, error: invError } = await supabase
                .from('model_inventory')
                .select('model_id, color_id, available_series')
                .in('model_id', modelIds);
            
            if (!invError && invData) {
                invData.forEach(inv => {
                    const key = `${inv.model_id}_${inv.color_id}`;
                    localEditingInventory[key] = inv.available_series;
                });
            }
        } catch (e) {
            console.error('Error fetching inventory for local edit cache:', e);
        }
    }

    renderLocalEditModal(o);
};

async function renderLocalEditModal(o) {
    const remaining = calculateLocalRemaining(o);
    const totalPrice = calculateLocalTotalPrice();

    // حفظ قيمة البحث الحالية لإعادة تطبيقها بعد إعادة الرسم لمنع فقدان التركيز والكتابة
    const searchInput = document.getElementById('ao-local-search-input');
    const term = searchInput ? searchInput.value : '';

    let itemsHtml = localEditingItems.map((item, index) => {
        if (item.isDeleted) return '';

        const code = item.models?.factory_code || item.models?.system_code || '';
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1);
        const pieces = item.quantity * sizesCount;
        
        // حساب سعر الفئة (سعر القطعة) بدلاً من سعر السيريه
        const piecePrice = item.price_per_series / sizesCount;
        const itemTotal = item.quantity * item.price_per_series;

        const key = `${item.model_id}_${item.color_id}`;
        const dbStock = localEditingInventory[key] !== undefined ? localEditingInventory[key] : 0;

        // حساب الرصيد التفاعلي الحقيقي للكمية المتاحة بالمخزن
        const originalItem = o.order_items.find(oi => oi.model_id === item.model_id && oi.color_id === item.color_id);
        const originalQty = originalItem ? originalItem.quantity : 0;
        const realTimeStock = dbStock - (item.quantity - originalQty);

        return `
            <tr class="border-b border-devo-gray last:border-0 hover:bg-devo-black/50 transition-colors">
                <td class="py-2.5 px-3 text-white text-sm font-bold search-target">${item.models?.name || 'موديل محذوف'} <span class="text-devo-muted text-[10px] font-mono mr-1">(${code})</span></td>
                <td class="py-2.5 px-3 text-devo-info text-xs">
                    ${item.colors?.name || '-'}
                    <span class="text-[10px] block mt-0.5 ${realTimeStock <= 0 ? 'text-devo-error font-semibold' : 'text-devo-muted'}">
                        (متاح: ${realTimeStock} سيريه)
                    </span>
                </td>
                <td class="py-2.5 px-3 text-center">
                    <div class="flex items-center justify-center bg-devo-black border border-devo-gray rounded-lg overflow-hidden h-8 w-28 mx-auto">
                        <button type="button" onclick="updateLocalItemQty(${index}, ${item.quantity - 1})" class="px-2 text-white hover:text-devo-orange transition-colors h-full"><i class="ph ph-minus"></i></button>
                        <input type="text" inputmode="numeric" pattern="[0-9]*" onchange="updateLocalItemQty(${index}, parseInt(this.value) || 0)" value="${item.quantity}" class="w-10 h-full bg-transparent text-center text-white text-xs font-bold outline-none border-x border-devo-gray leading-none">
                        <button type="button" onclick="updateLocalItemQty(${index}, ${item.quantity + 1})" ${realTimeStock <= 0 ? 'disabled' : ''} class="px-2 h-full transition-colors ${realTimeStock <= 0 ? 'text-devo-muted cursor-not-allowed opacity-50' : 'text-white hover:text-devo-orange'}"><i class="ph ph-plus"></i></button>
                    </div>
                    <span class="text-[10px] text-devo-muted font-normal block mt-1">(${pieces} قطعة)</span>
                </td>
                <td class="py-2.5 px-3 text-devo-muted text-center">${piecePrice}</td>
                <td class="py-2.5 px-3 text-devo-orange font-black text-left text-base">${itemTotal} ج.م</td>
                <td class="py-2.5 px-3 text-center">
                    <button type="button" onclick="deleteLocalItem(${index})" class="text-devo-error hover:bg-devo-error/25 p-1.5 rounded transition-colors" title="حذف الصنف"><i class="ph ph-trash text-lg"></i></button>
                </td>
            </tr>
        `;
    }).join('');

    if (itemsHtml.trim() === '') {
        itemsHtml = `<tr><td colspan="6" class="p-6 text-center text-devo-muted">تم حذف جميع الأصناف من الفاتورة.</td></tr>`;
    }

    // جلب سجل الحركات بقاعدة البيانات للأوردر
    let logsHtml = '';
    try {
        const { data: logs, error: logsError } = await supabase
            .from('order_logs')
            .select('*')
            .eq('order_id', o.id)
            .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        if (logs && logs.length > 0) {
            logsHtml = `
                <div class="mt-4 border-t border-devo-gray pt-4 shrink-0">
                    <h5 class="text-xs text-devo-orange font-bold mb-3 flex items-center gap-1.5"><i class="ph ph-clock-counter-clockwise"></i> سجل حركات وتعديلات الأوردر</h5>
                    <div class="space-y-2.5 max-h-[160px] overflow-y-auto custom-scrollbar text-xs">
                        ${logs.map(log => {
                            const logDate = new Date(log.created_at).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                            return `
                                <div class="flex gap-2.5 items-start">
                                    <div class="w-1.5 h-1.5 rounded-full bg-devo-orange mt-1.5 shrink-0 shadow-sm shadow-devo-orange/50"></div>
                                    <div class="flex-1 text-devo-text font-medium">
                                        <span class="font-normal">${log.notes}</span>
                                        <span class="text-[10px] text-devo-muted mr-1.5 font-mono">(${logDate})</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            logsHtml = `
                <div class="mt-4 border-t border-devo-gray pt-3 shrink-0 text-xs text-devo-muted">
                    <i class="ph ph-info mr-1"></i> لا توجد حركات مسجلة لهذا الأوردر بعد.
                </div>
            `;
        }
    } catch (e) {
        console.error('Error fetching logs:', e);
    }

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
                    <div class="flex justify-between text-xs"><span class="text-devo-muted">الإجمالي الجديد:</span> <span class="text-white font-bold" id="local-edit-total-price">${totalPrice}</span></div>
                    <div class="flex justify-between text-xs"><span class="text-devo-muted">المدفوع:</span> <span class="text-devo-success font-bold">${o.deposit}</span></div>
                    <div class="flex justify-between text-sm border-t border-devo-gray pt-1 mt-1"><span class="text-white font-bold">المتبقي للدفع:</span> <span class="text-devo-orange font-black" id="local-edit-remaining">${remaining}</span></div>
                </div>
            </div>

            <!-- حقل البحث المماثل للتفاصيل -->
            <div class="relative shrink-0">
                <i class="ph ph-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-devo-muted"></i>
                <input type="text" id="ao-local-search-input" oninput="filterModalTable(this.value)" placeholder="بحث داخل الأوردر باسم الموديل أو الكود..." value="${term}"
                    class="w-full bg-devo-black border border-devo-gray rounded-xl pr-10 pl-4 py-2.5 text-white focus:border-devo-orange outline-none text-sm transition-all shadow-sm">
            </div>

            <div class="flex-1 overflow-hidden border border-devo-gray rounded-xl bg-devo-black flex flex-col max-h-[30vh]">
                <div class="overflow-y-auto custom-scrollbar flex-1">
                    <table class="w-full text-right text-sm">
                        <thead class="text-xs text-devo-muted bg-devo-dark sticky top-0 shadow-sm z-10">
                            <tr>
                                <th class="p-3">الموديل</th>
                                <th class="p-3">اللون</th>
                                <th class="p-3 text-center">الكمية</th>
                                <th class="p-3 text-center">السعر</th>
                                <th class="p-3 text-left">الإجمالي</th>
                                <th class="p-3 text-center">حذف</th>
                            </tr>
                        </thead>
                        <tbody id="modal-items-tbody" class="divide-y divide-devo-gray">
                            ${itemsHtml}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- سجل حركات الأوردر -->
            ${logsHtml}

            <div class="flex justify-end gap-3 pt-2 shrink-0 border-t border-devo-gray">
                <button id="ao-local-save-btn" onclick="saveLocalOrderEdits('${o.id}')" class="bg-devo-orange hover:bg-devo-orangeHover text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-md flex items-center gap-2 text-sm">
                    <i class="ph ph-check-circle text-lg"></i> حفظ التعديلات
                </button>
                <button onclick="cancelLocalEdit('${o.id}')" class="bg-devo-gray hover:bg-white/10 text-white px-5 py-2.5 rounded-xl font-bold transition-colors text-sm">
                    إلغاء التعديل
                </button>
            </div>
        </div>
    `;

    // تفعيل الفلترة إذا كان هناك نص بحث نشط مسبقاً
    if (term) {
        filterModalTable(term);
    }

    const modal = document.getElementById('ao-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

function calculateLocalTotalSeries() {
    return localEditingItems.reduce((sum, item) => item.isDeleted ? sum : sum + item.quantity, 0);
}

function calculateLocalTotalPrice() {
    return localEditingItems.reduce((sum, item) => item.isDeleted ? sum : sum + (item.quantity * item.price_per_series), 0);
}

function calculateLocalRemaining(o) {
    const total = calculateLocalTotalPrice();
    return total - (o.deposit || 0);
}

window.updateLocalItemQty = async (index, newQty) => {
    if (newQty < 1) return;
    const o = allAdminOrders.find(x => x.id === currentEditingOrderId);
    if (!o) return;
    
    const item = localEditingItems[index];
    const key = `${item.model_id}_${item.color_id}`;
    const dbStock = localEditingInventory[key] !== undefined ? localEditingInventory[key] : 0;
    
    const originalItem = o.order_items.find(oi => oi.model_id === item.model_id && oi.color_id === item.color_id);
    const originalQty = originalItem ? originalItem.quantity : 0;
    const realTimeStock = dbStock - (item.quantity - originalQty);

    if (newQty > item.quantity) {
        const diff = newQty - item.quantity;
        if (diff > realTimeStock) {
            showToast(`المخزون غير كافي! المتاح إضافته هو: ${realTimeStock} سيريه فقط.`, 'warning');
            return;
        }
    }
    
    localEditingItems[index].quantity = newQty;
    await renderLocalEditModal(o);
};

window.deleteLocalItem = async (index) => {
    localEditingItems[index].isDeleted = true;
    localEditingItems[index].quantity = 0;
    const o = allAdminOrders.find(x => x.id === currentEditingOrderId);
    if (o) await renderLocalEditModal(o);
};

window.cancelLocalEdit = async (orderId) => {
    isLocalEditMode = false;
    localEditingItems = [];
    localEditingInventory = {};

    // إلغاء قفل الأوردر بقاعدة البيانات وإتاحته وإعادة حالته لتم الإنشاء
    const { error } = await supabase.from('orders').update({
        is_locked: false,
        assigned_admin_name: null,
        assigned_worker_id: null,
        status: 'created'
    }).eq('id', orderId);

    if (error) {
        showToast('فشل إلغاء قفل الأوردر: ' + error.message, 'error');
    } else {
        const o = allAdminOrders.find(x => x.id === orderId);
        if (o) {
            o.is_locked = false;
            o.assigned_admin_name = null;
            o.assigned_worker_id = null;
            o.status = 'created';
            const row = document.getElementById(`admin-order-row-${orderId}`);
            if (row) row.outerHTML = generateOrderRowHTML(o);
        }
        await logOrderAction(orderId, 'local_edit_cancel', `ألغى الإداري ${currentUserProfile?.full_name || ''} تعديل الأوردر محلياً`);
    }

    viewAdminOrderDetails(orderId);
};

window.saveLocalOrderEdits = async (orderId) => {
    const o = allAdminOrders.find(x => x.id === orderId);
    if (!o) return;

    const activeItems = localEditingItems.filter(item => !item.isDeleted && item.quantity > 0);
    if (activeItems.length === 0) {
        return showToast('عفواً، لا يمكن حفظ الأوردر فارغاً بالكامل! يرجى حذف الأوردر نهائياً بدلاً من ذلك.', 'error');
    }

    const saveBtn = document.getElementById('ao-local-save-btn');
    if (!saveBtn) return;
    const oldBtnHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    try {
        // 1. التحقق من توافر المخزون للزيادات
        const modelIds = [...new Set(activeItems.map(i => i.model_id))];
        const { data: dbInv, error: dbInvError } = await supabase
            .from('model_inventory')
            .select('model_id, color_id, available_series')
            .in('model_id', modelIds);

        if (dbInvError) throw dbInvError;

        let hasStockErrors = false;
        activeItems.forEach(item => {
            const originalItem = o.order_items.find(oi => oi.model_id === item.model_id && oi.color_id === item.color_id);
            const originalQty = originalItem ? originalItem.quantity : 0;
            const diff = item.quantity - originalQty;

            if (diff > 0) {
                const inv = dbInv.find(x => x.model_id === item.model_id && x.color_id === item.color_id);
                const available = inv ? inv.available_series : 0;
                if (available < diff) {
                    showToast(`المخزون غير كافي للموديل ${item.models?.name}. المطلوب زيادة: ${diff}، المتاح بالمخزن: ${available}`, 'error');
                    hasStockErrors = true;
                }
            }
        });

        if (hasStockErrors) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = oldBtnHtml;
            return;
        }

        // 2. تحديث البيانات
        const orderData = {
            customer_name: o.customer_name,
            phone_1: o.phone_1,
            phone_2: o.phone_2,
            address: o.address,
            deposit: o.deposit,
            deposit_receiver: o.deposit_receiver,
            notes: o.notes,
            total_price: calculateLocalTotalPrice(),
            total_series: calculateLocalTotalSeries()
        };

        const orderItemsData = activeItems.map(item => {
            const sizesCount = getModelSizesCount(item.models);
            return {
                model_id: item.model_id,
                color_id: item.color_id,
                qty: item.quantity,
                model_name: item.models?.name || '',
                price: item.price_per_series,
                total: item.quantity * item.price_per_series,
                sizes_count: sizesCount,
                piece_price: sizesCount > 0 ? item.price_per_series / sizesCount : item.price_per_series
            };
        });

        const { data, error: rpcError } = await supabase.rpc('process_order_transaction', {
            p_order_id: orderId,
            p_order_data: orderData,
            p_order_items: orderItemsData
        });

        if (rpcError) throw rpcError;

        // إزالة الإسناد وإلغاء القفل بعد الحفظ الناجح وإعادة الحالة إلى تم إنشاء الأوردر
        await supabase.from('orders').update({ 
            assigned_worker_id: null,
            is_locked: false,
            assigned_admin_name: null,
            status: 'created'
        }).eq('id', orderId);

        await logOrderAction(orderId, 'edited_locally', `تم تعديل الأصناف محلياً وحفظ الفروقات بالمخزن بواسطة الإداري ${currentUserProfile?.full_name || ''}`);

        showToast('تم تعديل الأوردر وحفظ الفروقات بالمخزن بنجاح!', 'success');
        closeAdminOrderDetails();
        await fetchAdminOrders();

    } catch (e) {
        showToast('فشل حفظ التعديلات: ' + e.message, 'error');
        console.error(e);
        saveBtn.disabled = false;
        saveBtn.innerHTML = oldBtnHtml;
    }
};

// --- الخيار الثاني: التعديل بالمعرض (السلة) ---
window.triggerCartEdit = async () => {
    if (!currentEditingOrderId) return;
    const o = allAdminOrders.find(x => x.id === currentEditingOrderId);
    if (!o) return;

    if (o.is_locked && o.assigned_admin_name && o.assigned_admin_name !== currentUserProfile?.full_name && currentUserProfile?.role !== 'owner') {
        return showToast('هذا الأوردر مغلق بواسطة إداري آخر!', 'error');
    }

    // قفل الأوردر بقاعدة البيانات لمنع التعديل المتزامن وتغيير الحالة إلى جاري التعديل
    const adminName = currentUserProfile?.full_name || 'أدمن';
    const { error } = await supabase.rpc('acquire_order_lock', {
        p_order_id: o.id,
        p_assigned_admin_name: adminName
    });

    if (error) {
        return showToast('فشل قفل الأوردر للتعديل: ' + error.message, 'error');
    }

    await logOrderAction(o.id, 'cart_edit_start', `بدأ الإداري ${currentUserProfile?.full_name || ''} تعديل الأوردر بالسلة (المعرض)`);

    showToast('جاري تجهيز السلة والتحويل للمعرض...', 'info');

    const newCart = o.order_items.map(item => {
        const imgUrl = item.models?.image_url_1 || './src/assets/icons/devo.png';
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1);

        return {
            modelId: item.model_id,
            factoryCode: item.models?.factory_code || item.models?.system_code || '',
            colorId: item.color_id,
            modelName: item.models?.name,
            colorName: item.colors?.name,
            price: item.price_per_series / sizesCount,
            image: imgUrl,
            qty: item.quantity,
            sizesCount: sizesCount
        };
    });

    localStorage.setItem('devo_cart', JSON.stringify(newCart));

    const orderData = {
        id: o.id,
        invoice_number: o.invoice_number,
        customer_name: o.customer_name,
        phone_1: o.phone_1,
        phone_2: o.phone_2,
        address: o.address,
        deposit: o.deposit,
        deposit_receiver: o.deposit_receiver,
        notes: o.notes,
        original_items: o.order_items.map(oi => ({
            model_id: oi.model_id,
            color_id: oi.color_id,
            quantity: oi.quantity
        }))
    };
    localStorage.setItem('devo_edit_order_data', JSON.stringify(orderData));

    closeEditOrderChoices(true);
    window.location.href = 'index.html';
};

// --- الخيار الثالث: إسناد الأوردر لموظف آخر ---
window.executeOrderAssignment = async () => {
    if (!currentEditingOrderId) return;
    const workerId = document.getElementById('eoc-worker-select').value;
    if (!workerId) return showToast('يرجى اختيار الموظف أولاً', 'warning');

    const o = allAdminOrders.find(x => x.id === currentEditingOrderId);
    if (!o) return;

    showToast('جاري إسناد الأوردر...', 'info');

    try {
        const { error } = await supabase
            .from('orders')
            .update({
                assigned_worker_id: workerId,
                is_locked: false
            })
            .eq('id', currentEditingOrderId);

        if (error) throw error;

        const workerSelect = document.getElementById('eoc-worker-select');
        const workerName = workerSelect.options[workerSelect.selectedIndex]?.text || 'موظف';
        await logOrderAction(currentEditingOrderId, 'assigned', `تم إسناد الأوردر للتعديل إلى الموظف (${workerName}) بواسطة الإداري ${currentUserProfile?.full_name || ''}`);

        showToast('تم إسناد وتعيين الأوردر بنجاح للموظف!', 'success');
        closeEditOrderChoices();
        await fetchAdminOrders();
    } catch (e) {
        showToast('خطأ أثناء إسناد الأوردر: ' + e.message, 'error');
    }
};

// دالة لتسجيل حركات وتعديلات الأوردرات بسجل الملاحظات
async function logOrderAction(orderId, actionType, notes) {
    try {
        const { session } = getCurrentSession();
        const userId = session?.user?.id || null;
        const userName = currentUserProfile?.full_name || 'نظام DEVO';
        
        const { error } = await supabase.from('order_logs').insert([{
            order_id: orderId,
            user_id: userId,
            user_name: userName,
            action_type: actionType,
            notes: notes
        }]);
        if (error) {
            console.error('Database error inserting order log:', error);
        }
    } catch (err) {
        console.error('Error logging order action:', err);
    }
}

// دالة مساعدة لحساب عدد مقاسات الموديل لتحديد أسعار القطع
function getModelSizesCount(model) {
    if (!model) return 1;
    const classSizes = model.classes?.class_sizes || [];
    if (classSizes.length > 0) return classSizes.length;
    const modelSizes = model.model_sizes || [];
    if (modelSizes.length > 0) return modelSizes.length;
    return 1;
}