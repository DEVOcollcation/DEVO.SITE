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
let isDuplicateMode = false;
let sourceDuplicatingOrderId = null;
let sourceDuplicatingInvoiceNumber = '';
let localEditingInventory = {};
let localEditingCustomerData = {
    customer_name: '',
    phone_1: '',
    phone_2: '',
    address: '',
    deposit: 0,
    deposit_receiver: '',
    notes: ''
};
let currentAdminTab = 'active';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return './src/assets/icons/devo.png';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w400`;
        }
    } catch (e) {}
    return url; 
}

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

    const filterInputs = [
        'ao-search-invoice',
        'ao-search-customer',
        'ao-search-phone',
        'ao-filter-worker',
        'ao-status',
        'ao-date-from',
        'ao-date-to'
    ];

    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', applyAdminOrdersFilter);
            el.addEventListener('change', applyAdminOrdersFilter);
        }
    });

    await populateWorkerFilter();
    await fetchAdminOrders();
    setupRealtimeAdminOrders(); // 🌟 تفعيل الرادار اللحظي الذكي 🌟

    isInitialized = true;
}

// ==========================================
// 🌟 1. استدعاء الموظفين والبيانات الأساسية 🌟
// ==========================================
async function populateWorkerFilter() {
    const select = document.getElementById('ao-filter-worker');
    if (!select) return;

    try {
        const { data: users, error } = await supabase
            .from('system_users')
            .select('id, full_name, username, role, worker_job')
            .order('full_name', { ascending: true });

        if (!error && users) {
            const currentVal = select.value;
            let optionsHtml = '<option value="">كل الموظفين / البائعين</option>';
            users.forEach(u => {
                let jobLabel = u.role === 'owner' ? 'مالك' : (u.role === 'admin' ? 'مشرف' : 'عامل مبيعات');
                const name = u.full_name || u.username;
                optionsHtml += `<option value="${u.id}">${name} (${jobLabel})</option>`;
            });
            select.innerHTML = optionsHtml;
            if (currentVal) select.value = currentVal;
        }
    } catch (e) {
        console.error('Error populating worker filter:', e);
    }
}

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
                models (id, name, factory_code, system_code, price, class_id, model_sizes(size_id), classes(id, name, class_sizes(size_id)), model_images(image_url)),
                colors (id, name, color_code)
            )
        `)
        .order('created_at', { ascending: false });
        
    if (!error && data) {
        allAdminOrders = data;
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
                    models (id, name, factory_code, system_code, price, class_id, model_sizes(size_id), classes(id, name, class_sizes(size_id)), model_images(image_url)),
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
                applyAdminOrdersFilter();
                
                // تنبيه مرئي (وميض برتقالي) للصف الجديد
                const newRow = document.getElementById(`admin-order-row-${data.id}`);
                if(newRow) {
                    newRow.classList.add('bg-devo-orange/30', 'transition-all', 'duration-500');
                    setTimeout(() => newRow.classList.remove('bg-devo-orange/30'), 3000);
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async (payload) => {
            // جلب الأوردر التراكمي بالأصناف كاملة
            const updatedOrder = await fetchFullOrderById(payload.new.id) || payload.new;
            const index = allAdminOrders.findIndex(o => o.id === payload.new.id);
            if (index > -1) {
                applyAdminOrdersFilter(); // 🌟 إعادة تطبيق الفلترة لضمان المزامنة اللحظية بين التبويبات والأجهزة 🌟
                
                // 🌟 عمل وميض ملفت للانتباه للصف إذا كان ظاهراً بالجدول الحالي 🌟
                const targetRow = document.getElementById(`admin-order-row-${payload.new.id}`);
                if (targetRow) {
                    targetRow.classList.add('bg-devo-info/30', 'transition-all', 'duration-500');
                    setTimeout(() => targetRow.classList.remove('bg-devo-info/30'), 2000);
                }
            }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, (payload) => {
            allAdminOrders = allAdminOrders.filter(o => o.id !== payload.old.id);
            applyAdminOrdersFilter();
            
            // إزالة الصف من الشاشة بتأثير حركي
            const existingRow = document.getElementById(`admin-order-row-${payload.old.id}`);
            if (existingRow) {
                existingRow.classList.add('opacity-0', 'scale-95', 'transition-all');
                setTimeout(() => existingRow.remove(), 300);
            }
        })
        .subscribe(async (status, err) => {
            if (err && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
                console.warn('⚠️ تنبيه في اتصال رادار الطلبات:', err);
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                try {
                    await supabase.auth.getSession();
                } catch (e) {}
            }
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
    const isRegistered = o.status === 'registered';
    const isEditable = o.status === 'created' && !o.is_locked;
    const editLockTitle = isRegistered
        ? 'تم تسجيل هذا الأوردر ولا يمكن تعديله نهائياً'
        : (o.is_locked ? 'الأوردر مقفل أو قيد التعديل حالياً' : 'يجب إعادة حالة الأوردر إلى تم إنشاء الأوردر لتعديله');

    const editBtnHtml = isOwnerOrAdmin
        ? (isEditable 
            ? `<button onclick="openEditOrderChoices('${o.id}')" class="p-1.5 bg-devo-orange/20 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors" title="تعديل الأوردر"><i class="ph ph-pencil-simple text-lg"></i></button>`
            : `<button disabled class="p-1.5 bg-devo-gray/30 text-devo-muted rounded cursor-not-allowed opacity-50" title="${editLockTitle}"><i class="ph ph-lock text-lg text-devo-muted"></i></button>`)
        : '';

    const lockIcon = `<button onclick="toggleOrderLock('${o.id}', ${!o.is_locked})" class="${o.is_locked ? 'text-devo-error' : 'text-devo-success'} p-1 hover:bg-white/10 rounded transition-colors" title="${o.is_locked ? 'إلغاء القفل' : 'قفل واستلام الأوردر'}"><i class="ph ${o.is_locked ? 'ph-lock' : 'ph-lock-open'} text-lg"></i></button>`;

    const archiveBadge = o.is_archived
        ? `<span class="bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[9px] px-1.5 py-0.5 rounded font-sans font-bold whitespace-nowrap" title="أوردر مؤرشف">أرشيف</span>`
        : `<span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] px-1.5 py-0.5 rounded font-sans font-bold whitespace-nowrap" title="أوردر نشط">نشط</span>`;

    const assignedHTML = o.assigned_admin_name 
        ? `<span class="bg-devo-info/20 text-devo-info px-2 py-1 rounded text-[10px] font-bold"><i class="ph ph-user-gear"></i> ${o.assigned_admin_name}</span>` 
        : `<span class="text-devo-muted text-[10px]">-</span>`;

    const buildStatusOptions = (currentVal) => {
        return Object.keys(statusConfig).map(k => `<option value="${k}" ${k === currentVal ? 'selected' : ''}>${statusConfig[k].text}</option>`).join('');
    };

    const archiveBtn = `<button onclick="toggleAdminOrderArchive('${o.id}', ${!o.is_archived})" class="p-1.5 bg-devo-black border border-devo-gray hover:border-devo-orange rounded text-devo-muted hover:text-white transition-colors" title="${o.is_archived ? 'استعادة من الأرشيف' : 'أرشفة الأوردر'}"><i class="ph ${o.is_archived ? 'ph-tray-arrow-up' : 'ph-archive'} text-lg"></i></button>`;

    return `
        <tr id="admin-order-row-${o.id}" class="hover:bg-devo-black/40 transition-colors">
            <td class="p-3 font-mono text-devo-orange font-bold text-xs flex items-center gap-1.5 flex-wrap">
                <span>${o.invoice_number}</span>
                ${archiveBadge}
                ${lockIcon}
            </td>
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
                <div class="flex items-center justify-center gap-1.5 flex-wrap">
                    <button onclick="exportSingleOrderToExcel('${o.id}')" class="p-1.5 bg-devo-success/10 text-devo-success hover:bg-devo-success hover:text-white rounded transition-colors cursor-pointer" title="تصدير (Excel)"><i class="ph ph-file-xls text-lg"></i></button>

                    <button onclick="printAdminOrder('${o.id}', 'customer')" class="p-1.5 bg-gray-200 text-gray-800 hover:bg-white rounded transition-colors cursor-pointer" title="طباعة فاتورة العميل"><i class="ph ph-receipt text-lg"></i></button>
                    <button onclick="printAdminOrder('${o.id}', 'detailed')" class="p-1.5 bg-devo-orange/20 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors cursor-pointer" title="طباعة فاتورة الإدارة"><i class="ph ph-printer text-lg"></i></button>
                    <button onclick="duplicateAdminOrder('${o.id}')" class="p-1.5 bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500 hover:text-white rounded transition-colors cursor-pointer" title="نسخ الأوردر كفاتورة جديدة (Duplicate)"><i class="ph ph-copy text-lg"></i></button>
                    ${editBtnHtml}
                    <button onclick="viewAdminOrderDetails('${o.id}')" class="p-1.5 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded transition-colors cursor-pointer" title="التفاصيل"><i class="ph ph-eye text-lg"></i></button>
                    ${archiveBtn}
                    ${isOwner ? `<button onclick="deleteOrder('${o.id}')" class="p-1.5 bg-devo-error/10 text-devo-error hover:bg-devo-error hover:text-white rounded transition-colors cursor-pointer" title="حذف وإرجاع المخزون"><i class="ph ph-trash text-lg"></i></button>` : ''}
                </div>
            </td>
        </tr>
    `;
}

// ==========================================
// 🌟 4. الإحصائيات والفلترة والتبويبات 🌟
// ==========================================
window.switchAdminOrdersTab = (tab) => {
    currentAdminTab = tab;
    const tabActive = document.getElementById('ao-tab-active');
    const tabArchived = document.getElementById('ao-tab-archived');

    if (tabActive && tabArchived) {
        if (tab === 'active') {
            tabActive.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all bg-devo-orange text-white flex items-center gap-1.5 shadow-sm cursor-pointer";
            tabArchived.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all text-devo-muted hover:text-white hover:bg-devo-gray/20 flex items-center gap-1.5 cursor-pointer";
        } else {
            tabActive.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all text-devo-muted hover:text-white hover:bg-devo-gray/20 flex items-center gap-1.5 cursor-pointer";
            tabArchived.className = "px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all bg-devo-orange text-white flex items-center gap-1.5 shadow-sm cursor-pointer";
        }
    }
    applyAdminOrdersFilter();
};

function updateAdminStats(targetList = null, isFiltered = false) {
    // 🌟 إذا كان هناك بحث/فلترة مفعلة، تعكس الإحصائيات نتائج البحث بدقة
    // وإذا لم يكن هناك بحث، تعكس الإحصائيات إجمالي النشطة + الأرشيف معاً
    const list = isFiltered && targetList ? targetList : allAdminOrders;

    let totalCount = list.length;
    let totalSeries = 0;
    let totalRev = 0;

    list.forEach(o => {
        totalSeries += Number(o.total_series) || 0;
        totalRev += Number(o.total_price) || 0;
    });

    const statTotalEl = document.getElementById('ao-stat-total');
    if (statTotalEl) statTotalEl.textContent = totalCount.toLocaleString('ar-EG');

    const statSeriesEl = document.getElementById('ao-stat-series');
    if (statSeriesEl) statSeriesEl.textContent = totalSeries.toLocaleString('ar-EG');

    const statRevEl = document.getElementById('ao-stat-rev');
    if (statRevEl) statRevEl.textContent = totalRev.toLocaleString('ar-EG');

    // تحديث أرقام البادج الخاصة بالتبويبات العلوية
    const activeCount = allAdminOrders.filter(o => !o.is_archived).length;
    const archivedCount = allAdminOrders.filter(o => o.is_archived).length;

    const badgeActive = document.getElementById('ao-badge-active');
    if (badgeActive) badgeActive.textContent = activeCount;

    const badgeArchived = document.getElementById('ao-badge-archived');
    if (badgeArchived) badgeArchived.textContent = archivedCount;
}

window.applyAdminOrdersFilter = () => {
    const invoiceTerm = document.getElementById('ao-search-invoice')?.value.trim().toLowerCase() || '';
    const customerTerm = document.getElementById('ao-search-customer')?.value.trim().toLowerCase() || '';
    const phoneTerm = document.getElementById('ao-search-phone')?.value.trim() || '';
    const workerVal = document.getElementById('ao-filter-worker')?.value || '';
    const statusFilter = document.getElementById('ao-status')?.value || '';
    const dateFrom = document.getElementById('ao-date-from')?.value;
    const dateTo = document.getElementById('ao-date-to')?.value;

    const hasAnyFilter = Boolean(invoiceTerm || customerTerm || phoneTerm || workerVal || statusFilter || dateFrom || dateTo);

    const filtered = allAdminOrders.filter(o => {
        const isArchived = Boolean(o.is_archived);

        // إذا لم يكن هناك أي شرط بحث/فلترة، نتبع التبويب الحالي (نشط أو أرشيف)
        if (!hasAnyFilter) {
            if (currentAdminTab === 'active' && isArchived) return false;
            if (currentAdminTab === 'archived' && !isArchived) return false;
        }

        // 1. البحث برقم الأوردر (Invoice / Order ID)
        if (invoiceTerm) {
            const inv = String(o.invoice_number || '').toLowerCase();
            if (!inv.includes(invoiceTerm)) return false;
        }

        // 2. البحث باسم العميل / المحل (Customer Name)
        if (customerTerm) {
            const cust = String(o.customer_name || '').toLowerCase();
            if (!cust.includes(customerTerm)) return false;
        }

        // 3. البحث برقم هاتف العميل (Phone 1 / Phone 2)
        if (phoneTerm) {
            const p1 = String(o.phone_1 || '');
            const p2 = String(o.phone_2 || '');
            if (!p1.includes(phoneTerm) && !p2.includes(phoneTerm)) return false;
        }

        // 4. سلكتور الموظف البائع (Salesperson / Worker)
        if (workerVal) {
            const matchesWorker = (o.worker_id && o.worker_id === workerVal) || 
                                  (o.assigned_worker_id && o.assigned_worker_id === workerVal);
            if (!matchesWorker) return false;
        }

        // 5. فلتر الحالة (Status)
        if (statusFilter && o.status !== statusFilter) return false;

        // 6. فلتر التاريخ (Date Range)
        if (dateFrom || dateTo) {
            const oDate = new Date(o.created_at);
            oDate.setHours(0, 0, 0, 0);
            if (dateFrom && oDate < new Date(dateFrom)) return false;
            if (dateTo && oDate > new Date(dateTo)) return false;
        }

        return true;
    });

    // تحديث الإحصائيات التفاعلية بناءً على النتائج المعروضة
    updateAdminStats(filtered, hasAnyFilter);

    const tbody = document.getElementById('ao-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
        const emptyMsg = hasAnyFilter
            ? 'لا توجد أوردرات تطابق شروط البحث والفلترة.'
            : (currentAdminTab === 'archived' ? 'لا توجد أوردرات مؤرشفة حالياً.' : 'لا توجد أوردرات نشطة حالياً.');
        tbody.innerHTML = `<tr class="no-data-row"><td colspan="9" class="p-10 text-center text-devo-muted">${emptyMsg}</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(o => generateOrderRowHTML(o)).join('');
};

window.resetAdminOrdersFilters = () => {
    const filterInputIds = [
        'ao-search-invoice',
        'ao-search-customer',
        'ao-search-phone',
        'ao-filter-worker',
        'ao-status',
        'ao-date-from',
        'ao-date-to'
    ];

    filterInputIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    applyAdminOrdersFilter();
};

window.toggleAdminOrderArchive = async (id, archiveStatus) => {
    const o = allAdminOrders.find(x => x.id === id);
    if (!o) return;

    const previousStatus = o.is_archived;
    // Optimistic update
    o.is_archived = archiveStatus;
    applyAdminOrdersFilter();

    let updateError = null;
    try {
        // محاولة تنفيذ الدالة السحابية المركزية toggle_order_archive
        const { error: rpcError } = await supabase.rpc('toggle_order_archive', {
            p_order_id: id,
            p_archive_status: archiveStatus
        });

        if (rpcError) {
            console.warn('RPC toggle_order_archive fallback to direct update:', rpcError);
            // التراجع للتحديث المباشر للجدول في حال عدم تشغيل المايجريشن بعد
            const { error: directError } = await supabase.from('orders').update({ is_archived: archiveStatus }).eq('id', id);
            if (directError) {
                updateError = directError;
            } else {
                await logOrderAction(id, archiveStatus ? 'archived' : 'unarchived', `تم ${archiveStatus ? 'أرشفة الأوردر' : 'استعادة الأوردر من الأرشيف'} بواسطة الإداري ${currentUserProfile?.full_name || ''}`);
            }
        }
    } catch (err) {
        updateError = err;
    }

    if (updateError) {
        console.error('Error toggling admin order archive:', updateError);
        o.is_archived = previousStatus;
        applyAdminOrdersFilter();
        showToast('فشل تعديل حالة الأرشفة في قاعدة البيانات: ' + (updateError.message || updateError), 'error');
    } else {
        showToast(archiveStatus ? 'تم نقل الأوردر إلى الأرشيف' : 'تم استعادة الأوردر من الأرشيف', 'success');
    }
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

    isLocalEditMode = false;
    isDuplicateMode = false;
    currentEditingOrderId = null;
    sourceDuplicatingOrderId = null;
    sourceDuplicatingInvoiceNumber = '';

    // ضبط عنوان المودال وإظهار أزرار الطباعة والنسخ
    const modalTitle = document.getElementById('ao-modal-title');
    if (modalTitle) {
        modalTitle.innerHTML = `<i class="ph ph-receipt text-devo-orange text-xl"></i> <span>تفاصيل الأوردر</span> <span class="text-devo-orange font-mono font-bold mr-1">#${escapeHtml(o.invoice_number)}</span>`;
    }
    const printCustBtn = document.getElementById('ao-print-customer-btn');
    const printDetBtn = document.getElementById('ao-print-detailed-btn');
    const duplicateBtn = document.getElementById('ao-duplicate-btn');
    if (printCustBtn) printCustBtn.classList.remove('hidden');
    if (printDetBtn) printDetBtn.classList.remove('hidden');
    if (duplicateBtn) {
        duplicateBtn.classList.remove('hidden');
        duplicateBtn.onclick = () => window.duplicateAdminOrder(o.id);
    }

    const remaining = Number(o.total_price || 0) - Number(o.deposit || 0);
    let totalPiecesCount = 0;
    (o.order_items || []).forEach(item => {
        const sizesCount = getModelSizesCount(item.models, item.sizes_count);
        totalPiecesCount += (item.quantity * sizesCount);
    });

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
                <div class="mt-4 bg-devo-black/40 border border-devo-gray rounded-xl p-4 shrink-0">
                    <h5 class="text-xs text-devo-orange font-bold mb-3 flex items-center gap-1.5">
                        <i class="ph ph-clock-counter-clockwise text-sm"></i> سجل حركات وتعديلات الأوردر
                    </h5>
                    <div class="space-y-2 max-h-[140px] overflow-y-auto custom-scrollbar text-xs">
                        ${logs.map(log => {
                            const logDate = new Date(log.created_at).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                            return `
                                <div class="flex gap-2.5 items-start bg-devo-dark/50 p-2 rounded-lg border border-devo-gray/30">
                                    <div class="w-2 h-2 rounded-full bg-devo-orange mt-1.5 shrink-0 shadow-sm shadow-devo-orange/50"></div>
                                    <div class="flex-1 text-devo-text font-medium leading-relaxed">
                                        <span class="font-normal text-white">${escapeHtml(log.notes)}</span>
                                        <span class="text-[10px] text-devo-muted mr-2 font-mono" dir="ltr">(${logDate})</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            logsHtml = `
                <div class="mt-3 bg-devo-black/30 border border-devo-gray/50 rounded-xl p-3 shrink-0 text-xs text-devo-muted flex items-center gap-1.5">
                    <i class="ph ph-info text-devo-info"></i> لا توجد حركات أو تعديلات مسجلة لهذا الأوردر حتى الآن.
                </div>
            `;
        }
    } catch (e) {
        console.error('Error fetching logs:', e);
    }

    const orderDateStr = new Date(o.created_at).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const statusInfo = statusConfig[o.status] || { text: o.status, color: 'bg-devo-gray text-white' };

    document.getElementById('ao-details-content').innerHTML = `
        <div class="flex flex-col gap-4 h-full">
            <!-- كروت البيانات والمعلومات العريضة -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 shrink-0">
                <!-- كارت 1: بيانات العميل -->
                <div class="bg-devo-black p-4 rounded-2xl border border-devo-gray flex flex-col justify-between shadow-sm">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs text-devo-muted font-bold flex items-center gap-1.5">
                                <i class="ph ph-user text-devo-orange text-base"></i> بيانات العميل
                            </span>
                        </div>
                        <h4 class="text-white font-black text-lg truncate mb-2">${escapeHtml(o.customer_name)}</h4>
                        <div class="space-y-1 text-xs">
                            <div class="flex items-center gap-2">
                                <span class="text-devo-muted">الهاتف الأساسي:</span>
                                <span class="text-devo-info font-mono font-bold" dir="ltr">${escapeHtml(o.phone_1 || '-')}</span>
                            </div>
                            ${o.phone_2 ? `
                                <div class="flex items-center gap-2">
                                    <span class="text-devo-muted">الهاتف الإضافي:</span>
                                    <span class="text-devo-text font-mono" dir="ltr">${escapeHtml(o.phone_2)}</span>
                                </div>
                            ` : ''}
                            <div class="flex items-start gap-2 pt-1 border-t border-devo-gray/40 mt-1">
                                <span class="text-devo-muted shrink-0">العنوان:</span>
                                <span class="text-devo-text font-medium leading-relaxed">${escapeHtml(o.address || 'لم يتم تحديد عنوان')}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- كارت 2: معلومات الأوردر والدفع -->
                <div class="bg-devo-black p-4 rounded-2xl border border-devo-gray flex flex-col justify-between shadow-sm">
                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-xs text-devo-muted font-bold flex items-center gap-1.5">
                                <i class="ph ph-receipt text-devo-orange text-base"></i> معلومات الأوردر
                            </span>
                            <span class="text-xs px-2.5 py-0.5 rounded-full font-bold border ${statusInfo.color}">
                                ${statusInfo.text}
                            </span>
                        </div>
                        <div class="space-y-1.5 text-xs">
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">رقم الفاتورة:</span>
                                <span class="text-devo-orange font-mono font-bold text-sm">#${escapeHtml(o.invoice_number)}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">البائع (المعرض):</span>
                                <span class="text-white font-bold">${escapeHtml(o.system_users?.full_name || '-')}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">مستلم العربون:</span>
                                <span class="text-white font-medium">${escapeHtml(o.deposit_receiver || 'غير محدد')}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">تاريخ الإنشاء:</span>
                                <span class="text-devo-muted font-mono" dir="ltr">${orderDateStr}</span>
                            </div>
                            ${o.notes ? `
                                <div class="pt-1.5 border-t border-devo-gray/40 text-xs">
                                    <span class="text-devo-muted block mb-0.5">ملاحظات الأوردر:</span>
                                    <span class="text-white font-medium italic">${escapeHtml(o.notes)}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>

                <!-- كارت 3: الحسابات والملخص المالي -->
                <div class="bg-devo-black p-4 rounded-2xl border border-devo-gray flex flex-col justify-between shadow-sm">
                    <div>
                        <span class="text-xs text-devo-muted font-bold flex items-center gap-1.5 mb-2">
                            <i class="ph ph-calculator text-devo-orange text-base"></i> الملخص المالي
                        </span>
                        <div class="space-y-2 text-xs">
                            <div class="flex justify-between items-center pb-1 border-b border-devo-gray/40">
                                <span class="text-devo-muted">الكمية الإجمالية:</span>
                                <span class="text-white font-bold font-mono text-sm">${o.total_series || 0} سيريه <span class="text-devo-muted font-normal text-xs">(${totalPiecesCount} قطعة)</span></span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">إجمالي الفاتورة:</span>
                                <span class="text-white font-bold font-mono text-base">${Number(o.total_price || 0).toLocaleString('en-US')} ج.م</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">المدفوع (العربون):</span>
                                <span class="text-devo-success font-bold font-mono text-base">${Number(o.deposit || 0).toLocaleString('en-US')} ج.م</span>
                            </div>
                            <div class="flex justify-between items-center pt-2 border-t border-devo-gray mt-1">
                                <span class="text-white font-bold text-sm">المتبقي للتحصيل:</span>
                                <span class="text-devo-orange font-black font-mono text-xl">${remaining.toLocaleString('en-US')} ج.م</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- شريط البحث داخل الأصناف -->
            <div class="relative shrink-0">
                <i class="ph ph-magnifying-glass absolute right-3.5 top-1/2 -translate-y-1/2 text-devo-muted text-base"></i>
                <input type="text" oninput="filterModalTable(this.value)" placeholder="بحث سريع داخل الأصناف باسم الموديل أو الكود أو اللون..." 
                    class="w-full bg-devo-black border border-devo-gray rounded-xl pr-10 pl-4 py-2.5 text-white placeholder-devo-muted focus:border-devo-orange outline-none text-sm transition-all shadow-sm">
            </div>

            <!-- حاوية كروت الموديلات المجمعة (مثل السلة) -->
            <div class="flex-1 overflow-y-auto custom-scrollbar border border-devo-gray rounded-2xl bg-devo-black/40 p-3 md:p-4 min-h-[240px]" id="modal-items-container">
                ${renderViewOrderCardsHTML(o)}
            </div>

            <!-- سجل حركات الأوردر -->
            ${logsHtml}
        </div>
    `;

    const modal = document.getElementById('ao-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);

    // ربط أزرار الطباعة بقيم الأوردر الحالي المعروض
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
        isDuplicateMode = false;
        sourceDuplicatingOrderId = null;
        sourceDuplicatingInvoiceNumber = '';
        localEditingItems = [];
        localEditingInventory = {};
        localEditingCustomerData = {
            customer_name: '',
            phone_1: '',
            phone_2: '',
            address: '',
            deposit: 0,
            deposit_receiver: '',
            notes: ''
        };
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
            const sizesCount = getModelSizesCount(i.models, i.sizes_count);
            const seriesQty = Number(i.quantity) || 0;
            const piecesQty = seriesQty * sizesCount;

            let unitPrice = 0;
            if (i.models?.price !== undefined && i.models?.price !== null && i.models?.price !== '') {
                unitPrice = Number(i.models.price);
            } else if (i.piece_price && Number(i.piece_price) > 0) {
                unitPrice = Number(i.piece_price);
            } else if (i.price_per_series && sizesCount > 0) {
                unitPrice = Math.round((Number(i.price_per_series) / sizesCount) * 100) / 100;
            }

            const itemCode = i.models?.system_code || i.models?.factory_code || '';

            excelData.push({
                'الملاحظات': idx === 0 ? orderNotes : '',
                'كود المخزن': 1,
                'كودالصنف': itemCode,
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
        const sizesCount = getModelSizesCount(i.models, i.sizes_count);
        const seriesQty = Number(i.quantity) || 0;
        const piecesQty = seriesQty * sizesCount;

        let unitPrice = 0;
        if (i.models?.price !== undefined && i.models?.price !== null && i.models?.price !== '') {
            unitPrice = Number(i.models.price);
        } else if (i.piece_price && Number(i.piece_price) > 0) {
            unitPrice = Number(i.piece_price);
        } else if (i.price_per_series && sizesCount > 0) {
            unitPrice = Math.round((Number(i.price_per_series) / sizesCount) * 100) / 100;
        }

        const itemCode = i.models?.system_code || i.models?.factory_code || '';

        return {
            'الملاحظات': idx === 0 ? orderNotes : '',
            'كود المخزن': 1,
            'كودالصنف': itemCode,
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

    if (o.status === 'registered') {
        currentEditingOrderId = null;
        return showToast('عفواً، لا يمكن تعديل هذا الأوردر لأنه في حالة (تم التسجيل)!', 'error');
    }

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
                let jobLabel = u.role === 'owner' ? 'مالك' : (u.role === 'admin' ? 'مشرف' : 'عامل مبيعات');
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

    if (o.status === 'registered') {
        return showToast('عفواً، لا يمكن تعديل هذا الأوردر لأنه في حالة (تم التسجيل)!', 'error');
    }

    if (o.is_locked && o.assigned_admin_name && o.assigned_admin_name !== currentUserProfile?.full_name && currentUserProfile?.role !== 'owner') {
        return showToast(`هذا الأوردر مقفول حالياً بواسطة (${o.assigned_admin_name})!`, 'error');
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
    isDuplicateMode = false;
    sourceDuplicatingOrderId = null;
    sourceDuplicatingInvoiceNumber = '';

    localEditingCustomerData = {
        customer_name: o.customer_name || '',
        phone_1: o.phone_1 || '',
        phone_2: o.phone_2 || '',
        address: o.address || '',
        deposit: Number(o.deposit) || 0,
        deposit_receiver: o.deposit_receiver || '',
        notes: o.notes || ''
    };

    localEditingItems = (o.order_items || []).map(item => ({
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

// ==========================================
// 🌟 نسخ الأوردر كفاتورة جديدة (Duplicate Order) 🌟
// ==========================================
window.duplicateAdminOrder = async (orderId) => {
    const freshOrder = await fetchFullOrderById(orderId);
    const o = freshOrder || allAdminOrders.find(x => x.id === orderId);
    if (!o) return;

    closeEditOrderChoices(true);

    isDuplicateMode = true;
    isLocalEditMode = false;
    currentEditingOrderId = null;
    sourceDuplicatingOrderId = o.id;
    sourceDuplicatingInvoiceNumber = o.invoice_number;

    localEditingCustomerData = {
        customer_name: o.customer_name || '',
        phone_1: o.phone_1 || '',
        phone_2: o.phone_2 || '',
        address: o.address || '',
        deposit: Number(o.deposit) || 0,
        deposit_receiver: o.deposit_receiver || '',
        notes: o.notes || ''
    };

    localEditingItems = (o.order_items || []).map(item => ({
        ...item,
        isDeleted: false
    }));

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
            console.error('Error fetching inventory for duplicate order cache:', e);
        }
    }

    renderLocalEditModal(o);
};

window.triggerDuplicateFromChoices = () => {
    if (currentEditingOrderId) {
        duplicateAdminOrder(currentEditingOrderId);
    }
};

async function renderLocalEditModal(o) {
    const modalTitle = document.getElementById('ao-modal-title');
    if (modalTitle) {
        if (isDuplicateMode) {
            modalTitle.innerHTML = `
                <div class="flex flex-wrap items-center gap-2.5">
                    <i class="ph ph-copy text-cyan-400 text-xl"></i>
                    <span>نسخ وتكرار كفاتورة جديدة</span>
                    <span class="text-devo-muted text-xs font-mono mr-1">(مأخوذ من #${escapeHtml(sourceDuplicatingInvoiceNumber)})</span>
                    <span class="text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/40 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                        <i class="ph ph-files"></i> وضع نسخ الأوردر
                    </span>
                </div>
            `;
        } else {
            modalTitle.innerHTML = `
                <div class="flex flex-wrap items-center gap-2.5">
                    <i class="ph ph-note-pencil text-devo-orange text-xl"></i>
                    <span>تعديل الأوردر محلياً</span>
                    <span class="text-devo-orange font-mono font-bold">#${escapeHtml(o.invoice_number)}</span>
                    <span class="text-xs bg-amber-500/20 text-amber-400 border border-amber-500/40 px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1">
                        <span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span> وضع التعديل المباشر
                    </span>
                </div>
            `;
        }
    }

    // إخفاء أزرار الطباعة والنسخ في وضع التعديل/النسخ
    const printCustBtn = document.getElementById('ao-print-customer-btn');
    const printDetBtn = document.getElementById('ao-print-detailed-btn');
    const duplicateBtn = document.getElementById('ao-duplicate-btn');
    if (printCustBtn) printCustBtn.classList.add('hidden');
    if (printDetBtn) printDetBtn.classList.add('hidden');
    if (duplicateBtn) duplicateBtn.classList.add('hidden');

    const remaining = calculateLocalRemaining();
    const totalPrice = calculateLocalTotalPrice();
    const totalSeries = calculateLocalTotalSeries();
    const totalPieces = calculateLocalTotalPieces();

    // جلب سجل الحركات للأوردر (في حال كان تعديل أوردر قائم)
    let logsHtml = '';
    if (!isDuplicateMode) {
        try {
            const { data: logs, error: logsError } = await supabase
                .from('order_logs')
                .select('*')
                .eq('order_id', o.id)
                .order('created_at', { ascending: false });

            if (!logsError && logs && logs.length > 0) {
                logsHtml = `
                    <div class="mt-3 bg-devo-black/40 border border-devo-gray rounded-xl p-3.5 shrink-0">
                        <details class="group cursor-pointer">
                            <summary class="text-xs text-devo-orange font-bold flex items-center justify-between list-none outline-none">
                                <span class="flex items-center gap-1.5"><i class="ph ph-clock-counter-clockwise text-sm"></i> سجل حركات وتعديلات الأوردر (${logs.length})</span>
                                <i class="ph ph-caret-down transition-transform group-open:rotate-180 text-devo-muted"></i>
                            </summary>
                            <div class="space-y-2 max-h-[120px] overflow-y-auto custom-scrollbar text-xs mt-2.5 pt-2 border-t border-devo-gray/40">
                                ${logs.map(log => {
                                    const logDate = new Date(log.created_at).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                                    return `
                                        <div class="flex gap-2 items-start bg-devo-dark/60 p-2 rounded-lg border border-devo-gray/20">
                                            <div class="w-1.5 h-1.5 rounded-full bg-devo-orange mt-1.5 shrink-0"></div>
                                            <div class="flex-1 text-devo-text">
                                                <span class="font-normal text-white">${escapeHtml(log.notes)}</span>
                                                <span class="text-[10px] text-devo-muted mr-1.5 font-mono" dir="ltr">(${logDate})</span>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </details>
                    </div>
                `;
            }
        } catch (e) {
            console.error('Error fetching logs for edit modal:', e);
        }
    }

    document.getElementById('ao-details-content').innerHTML = `
        <div class="flex flex-col gap-4 h-full">
            <!-- 🌟 القسم العلوي: بطاقات بيانات العميل والدفع والملخص اللحظي 🌟 -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 shrink-0">
                <!-- كارت 1: بيانات العميل (5 أعمدة) -->
                <div class="lg:col-span-5 bg-devo-black p-4 rounded-2xl border border-devo-gray shadow-sm flex flex-col justify-between">
                    <div>
                        <div class="flex items-center justify-between mb-3">
                            <span class="text-xs ${isDuplicateMode ? 'text-cyan-400' : 'text-devo-orange'} font-bold flex items-center gap-1.5">
                                <i class="ph ${isDuplicateMode ? 'ph-user-plus' : 'ph-user-gear'} text-base"></i> بيانات العميل المستلم
                            </span>
                            <span class="text-[10px] text-devo-muted">قابلة للتعديل مباشرة</span>
                        </div>
                        <div class="space-y-2.5">
                            <div>
                                <label class="block text-[11px] font-bold text-devo-muted mb-1">اسم العميل / المحل <span class="text-devo-orange">*</span></label>
                                <input type="text" id="ao-edit-cust-name" value="${escapeHtml(localEditingCustomerData.customer_name)}" placeholder="اسم العميل أو اسم المحل..." class="w-full bg-devo-dark border border-devo-gray rounded-xl px-3 py-2 text-white font-bold text-sm focus:border-devo-orange outline-none transition-colors">
                            </div>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                    <label class="block text-[11px] font-bold text-devo-muted mb-1">رقم الهاتف الأساسي <span class="text-devo-orange">*</span></label>
                                    <input type="text" id="ao-edit-phone-1" dir="ltr" value="${escapeHtml(localEditingCustomerData.phone_1)}" placeholder="01xxxxxxxxx" class="w-full bg-devo-dark border border-devo-gray rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-devo-orange outline-none transition-colors">
                                </div>
                                <div>
                                    <label class="block text-[11px] font-bold text-devo-muted mb-1">رقم هاتف إضافي (اختياري)</label>
                                    <input type="text" id="ao-edit-phone-2" dir="ltr" value="${escapeHtml(localEditingCustomerData.phone_2)}" placeholder="رقم إضافي..." class="w-full bg-devo-dark border border-devo-gray rounded-xl px-3 py-2 text-white font-mono text-sm focus:border-devo-orange outline-none transition-colors">
                                </div>
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-devo-muted mb-1">العنوان وتفاصيل الشحن</label>
                                <input type="text" id="ao-edit-address" value="${escapeHtml(localEditingCustomerData.address)}" placeholder="العنوان، المحافظة، تفاصيل الشحن..." class="w-full bg-devo-dark border border-devo-gray rounded-xl px-3 py-2 text-white text-xs focus:border-devo-orange outline-none transition-colors">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- كارت 2: بيانات الدفع والملاحظات (4 أعمدة) -->
                <div class="lg:col-span-4 bg-devo-black p-4 rounded-2xl border border-devo-gray shadow-sm flex flex-col justify-between">
                    <div>
                        <div class="flex items-center justify-between mb-3">
                            <span class="text-xs ${isDuplicateMode ? 'text-cyan-400' : 'text-devo-orange'} font-bold flex items-center gap-1.5">
                                <i class="ph ph-wallet text-base"></i> الدفع والملاحظات
                            </span>
                            <span class="text-[10px] text-devo-muted">تحديث تلقائي</span>
                        </div>
                        <div class="space-y-2.5">
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                    <label class="block text-[11px] font-bold text-devo-muted mb-1">العربون المدفوع (ج.م)</label>
                                    <input type="number" step="any" min="0" id="ao-edit-deposit" value="${localEditingCustomerData.deposit}" oninput="handleLocalDepositChange(this.value)" class="w-full bg-devo-dark border border-devo-gray rounded-xl px-3 py-2 text-devo-success font-black font-mono text-sm focus:border-devo-orange outline-none transition-colors">
                                </div>
                                <div>
                                    <label class="block text-[11px] font-bold text-devo-muted mb-1">مستلم العربون</label>
                                    <input type="text" id="ao-edit-deposit-receiver" value="${escapeHtml(localEditingCustomerData.deposit_receiver)}" placeholder="اسم المستلم / الخزينة..." class="w-full bg-devo-dark border border-devo-gray rounded-xl px-3 py-2 text-white text-xs focus:border-devo-orange outline-none transition-colors">
                                </div>
                            </div>
                            <div>
                                <label class="block text-[11px] font-bold text-devo-muted mb-1">ملاحظات وتعليمات الأوردر</label>
                                <textarea id="ao-edit-notes" placeholder="أي تعليمات خاصة بالتجهيز أو الشحن..." rows="2" class="w-full bg-devo-dark border border-devo-gray rounded-xl px-3 py-2 text-white text-xs focus:border-devo-orange outline-none transition-colors resize-none">${escapeHtml(localEditingCustomerData.notes)}</textarea>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- كارت 3: ملخص الحسابات اللحظي (3 أعمدة) -->
                <div class="lg:col-span-3 bg-devo-black p-4 rounded-2xl border border-devo-gray shadow-sm flex flex-col justify-between">
                    <div>
                        <div class="flex items-center justify-between mb-3">
                            <span class="text-xs text-devo-orange font-bold flex items-center gap-1.5">
                                <i class="ph ph-calculator text-base"></i> ملخص الحسابات اللحظي
                            </span>
                            <span class="text-[10px] bg-devo-orange/15 text-devo-orange border border-devo-orange/30 px-2 py-0.5 rounded-full font-bold">مباشر</span>
                        </div>
                        <div class="space-y-2 text-xs">
                            <div class="flex justify-between items-center pb-1.5 border-b border-devo-gray/40">
                                <span class="text-devo-muted">البائع المنشئ:</span>
                                <span class="text-white font-bold">${escapeHtml(currentUserProfile?.full_name || o.system_users?.full_name || 'موظف')}</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">إجمالي السيريهات:</span>
                                <span class="text-white font-bold font-mono text-sm">
                                    <span id="local-edit-total-series">${totalSeries}</span> سيريه 
                                    <span id="local-edit-total-pieces" class="text-devo-muted text-[11px] font-normal">(${totalPieces} قطعة)</span>
                                </span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">إجمالي الفاتورة:</span>
                                <span id="local-edit-total-price" class="text-white font-bold font-mono text-sm">${totalPrice.toLocaleString('en-US')} ج.م</span>
                            </div>
                            <div class="flex justify-between items-center">
                                <span class="text-devo-muted">المدفوع (العربون):</span>
                                <span id="local-edit-deposit-display" class="text-devo-success font-bold font-mono text-sm">${Number(localEditingCustomerData.deposit || 0).toLocaleString('en-US')} ج.م</span>
                            </div>
                            <div class="flex justify-between items-center pt-2 border-t border-devo-gray mt-1 bg-devo-orange/10 p-2 rounded-xl border border-devo-orange/20">
                                <span class="text-white font-bold text-xs">المتبقي للتحصيل:</span>
                                <span id="local-edit-remaining" class="text-devo-orange font-black font-mono text-base">${remaining.toLocaleString('en-US')} ج.م</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 🌟 شريط البحث وإحصائيات الأصناف 🌟 -->
            <div class="flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
                <div class="relative w-full sm:w-80">
                    <i class="ph ph-magnifying-glass absolute right-3.5 top-1/2 -translate-y-1/2 text-devo-muted text-base"></i>
                    <input type="text" id="ao-local-search-input" oninput="filterModalTable(this.value)" placeholder="بحث سريع في الأصناف بالكود أو الموديل أو اللون..." 
                        class="w-full bg-devo-black border border-devo-gray rounded-xl pr-10 pl-4 py-2 text-white placeholder-devo-muted focus:border-devo-orange outline-none text-xs transition-all shadow-sm">
                </div>
                <div class="text-xs text-devo-muted flex items-center gap-2 self-end sm:self-center">
                    <span>عدد الأصناف المتاحة بالفاتورة:</span>
                    <span id="ao-local-items-count" class="font-bold text-white font-mono bg-devo-gray/40 px-2 py-0.5 rounded-lg border border-devo-gray">${localEditingItems.filter(i => !i.isDeleted).length}</span>
                </div>
            </div>

            <!-- حاوية كروت الموديلات المجمعة (مثل السلة) -->
            <div class="flex-1 overflow-y-auto custom-scrollbar border border-devo-gray rounded-2xl bg-devo-black/40 p-3 md:p-4 min-h-[260px]" id="modal-items-container">
                ${renderLocalItemsCardsHTML(o)}
            </div>

            <!-- سجل حركات الأوردر (قابل للطي) -->
            ${logsHtml}

            <!-- 🌟 شريط الأزرار والإجراءات السفلي 🌟 -->
            <div class="flex items-center justify-between gap-3 pt-3 shrink-0 border-t border-devo-gray bg-devo-dark/80 p-2 rounded-xl">
                <div class="text-xs ${isDuplicateMode ? 'text-cyan-400' : 'text-devo-muted'} flex items-center gap-1.5">
                    <i class="ph ${isDuplicateMode ? 'ph-copy' : 'ph-info text-devo-info'} text-base"></i>
                    <span>${isDuplicateMode ? `سيتم إصدار فاتورة جديدة برقم جديد وخصم الأصناف من المخزن دون أي تعديل على الفاتورة الأصلية #${escapeHtml(sourceDuplicatingInvoiceNumber)}.` : 'تعديل الكميات يخصم/يضيف تلقائياً من المخزون عند الحفظ.'}</span>
                </div>
                <div class="flex items-center gap-3">
                    <button id="ao-local-save-btn" onclick="saveLocalOrderEdits('${isDuplicateMode ? '' : o.id}')" class="${isDuplicateMode ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-devo-orange hover:bg-devo-orangeHover'} text-white px-7 py-2.5 rounded-xl font-black transition-all shadow-md flex items-center gap-2 text-sm cursor-pointer active:scale-95">
                        <i class="ph ${isDuplicateMode ? 'ph-plus-circle' : 'ph-check-circle'} text-lg"></i> ${isDuplicateMode ? 'إنشاء وحفظ الفاتورة المنسوخة' : 'حفظ جميع التعديلات'}
                    </button>
                    <button onclick="cancelLocalEdit('${isDuplicateMode ? '' : o.id}')" class="bg-devo-gray hover:bg-white/10 text-white px-5 py-2.5 rounded-xl font-bold transition-colors text-sm cursor-pointer">
                        ${isDuplicateMode ? 'إلغاء النسخ' : 'إلغاء التعديل'}
                    </button>
                </div>
            </div>
        </div>
    `;

    const modal = document.getElementById('ao-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

// =========================================================================
// 🌟 3. رسم كروت الموديلات المجمعة مع ألوانها (Local Edit & Duplicate) 🌟
// =========================================================================
function renderLocalItemsCardsHTML(o) {
    const groupedMap = new Map();
    localEditingItems.forEach((item, index) => {
        if (item.isDeleted) return;
        if (!groupedMap.has(item.model_id)) {
            const code = item.models?.factory_code || item.models?.system_code || '';
            const sizesCount = getModelSizesCount(item.models);
            const piecePrice = sizesCount > 0 ? (item.price_per_series / sizesCount) : item.price_per_series;
            
            let imgUrl = './src/assets/icons/devo.png';
            if (item.models?.model_images && item.models.model_images.length > 0) {
                imgUrl = resolveImageUrl(item.models.model_images[0].image_url);
            }

            groupedMap.set(item.model_id, {
                modelId: item.model_id,
                modelName: item.models?.name || 'موديل غير محدد',
                factoryCode: code,
                sizesCount: sizesCount,
                piecePrice: piecePrice,
                pricePerSeries: item.price_per_series,
                image: imgUrl,
                colors: []
            });
        }
        groupedMap.get(item.model_id).colors.push({
            ...item,
            originalIndex: index
        });
    });

    if (groupedMap.size === 0) {
        return `<div class="p-10 text-center text-devo-muted text-sm flex flex-col items-center justify-center gap-2"><i class="ph ph-shopping-bag text-3xl"></i><span>تم حذف جميع الأصناف من الفاتورة.</span></div>`;
    }

    let cardsHtml = '';
    groupedMap.forEach((modelGroup) => {
        let modelTotalPrice = 0;
        let modelTotalSeries = 0;
        let colorsHtml = '';

        const piecesPerSeries = modelGroup.sizesCount;

        modelGroup.colors.forEach((item) => {
            const key = `${item.model_id}_${item.color_id}`;
            const dbStock = localEditingInventory[key] !== undefined ? localEditingInventory[key] : 0;

            let realTimeStock;
            if (isDuplicateMode) {
                realTimeStock = dbStock - item.quantity;
            } else {
                const originalItem = (o?.order_items || []).find(oi => oi.model_id === item.model_id && oi.color_id === item.color_id);
                const originalQty = originalItem ? originalItem.quantity : 0;
                realTimeStock = dbStock - (item.quantity - originalQty);
            }

            const itemTotalPrice = item.quantity * item.price_per_series;
            const pieces = item.quantity * piecesPerSeries;

            modelTotalPrice += itemTotalPrice;
            modelTotalSeries += item.quantity;

            let stockBadgeClass = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
            if (realTimeStock <= 0) {
                stockBadgeClass = 'bg-rose-500/15 text-rose-400 border-rose-500/30 font-bold';
            } else if (realTimeStock < 5) {
                stockBadgeClass = 'bg-amber-500/15 text-amber-400 border-amber-500/30';
            }

            colorsHtml += `
                <div class="p-2.5 bg-devo-black border border-devo-gray/70 rounded-xl transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 hover:border-devo-gray">
                    <div class="flex items-center gap-2.5 flex-wrap">
                        <div class="flex items-center gap-1.5">
                            <span class="w-3 h-3 rounded-full bg-devo-info shrink-0 shadow-sm shadow-devo-info/50"></span>
                            <span class="text-white font-bold text-xs sm:text-sm"><i class="ph-fill ph-palette text-devo-info mr-0.5"></i> ${escapeHtml(item.colors?.name || '-')}</span>
                        </div>
                        <span class="text-[11px] px-2.5 py-0.5 rounded-full border ${stockBadgeClass} font-mono font-bold" dir="ltr">
                            متاح: ${realTimeStock} سيريه
                        </span>
                    </div>

                    <div class="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                        <!-- Stepper -->
                        <div class="inline-flex items-center justify-center bg-devo-dark border border-devo-gray rounded-xl overflow-hidden h-8 shadow-inner">
                            <button type="button" onclick="updateLocalItemQty(${item.originalIndex}, ${item.quantity - 1})" class="px-2.5 text-white hover:text-devo-orange hover:bg-white/5 transition-colors h-full flex items-center justify-center cursor-pointer" title="تقليل الكمية">
                                <i class="ph ph-minus font-bold text-xs"></i>
                            </button>
                            <input type="text" inputmode="numeric" pattern="[0-9]*" onchange="updateLocalItemQty(${item.originalIndex}, parseInt(this.value) || 0)" value="${item.quantity}" class="w-11 h-full bg-transparent text-center text-white text-xs font-bold font-mono outline-none border-x border-devo-gray leading-none">
                            <button type="button" onclick="updateLocalItemQty(${item.originalIndex}, ${item.quantity + 1})" ${realTimeStock <= 0 ? 'disabled' : ''} class="px-2.5 h-full transition-colors flex items-center justify-center ${realTimeStock <= 0 ? 'text-devo-muted cursor-not-allowed opacity-40' : 'text-white hover:text-devo-orange hover:bg-white/5 cursor-pointer'}" title="زيادة الكمية">
                                <i class="ph ph-plus font-bold text-xs"></i>
                            </button>
                        </div>

                        <!-- Price & Pieces -->
                        <div class="text-left flex items-center gap-2">
                            <div>
                                <p class="text-devo-orange font-black text-xs sm:text-sm font-mono">${Number(itemTotalPrice).toLocaleString('en-US')} ج.م</p>
                                <p class="text-devo-muted text-[10px] font-mono">(${pieces} قطعة)</p>
                            </div>
                            <button type="button" onclick="deleteLocalItem(${item.originalIndex})" class="text-devo-error hover:bg-devo-error/20 p-1.5 rounded-lg transition-colors cursor-pointer" title="إزالة هذا اللون">
                                <i class="ph ph-trash text-base"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
        });

        cardsHtml += `
            <div class="cart-item-card flex flex-col md:flex-row gap-3 md:gap-4 p-4 bg-devo-dark border border-devo-gray rounded-2xl relative transition-all duration-300 mb-3.5 shadow-sm" data-search="${escapeHtml(modelGroup.modelName)} ${escapeHtml(modelGroup.factoryCode)}">
                <div class="flex gap-3 items-start shrink-0">
                    <img src="${modelGroup.image}" class="w-20 h-20 md:w-24 md:h-24 rounded-xl object-cover bg-devo-black shrink-0 border border-devo-gray" onerror="this.src='./src/assets/icons/devo.png'">
                </div>

                <div class="flex flex-col flex-1 justify-between gap-2.5">
                    <div class="flex justify-between items-start flex-wrap gap-2">
                        <div>
                            <h4 class="text-white font-black text-base md:text-lg search-target">${escapeHtml(modelGroup.modelName)}</h4>
                            <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                                <span class="text-devo-muted text-[11px] font-mono bg-devo-black px-2.5 py-0.5 rounded-lg border border-devo-gray font-bold" title="كود الموديل"><i class="ph ph-barcode"></i> ${escapeHtml(modelGroup.factoryCode || 'بدون كود')}</span>
                                <span class="text-devo-muted text-[11px] bg-devo-black px-2.5 py-0.5 rounded-lg border border-devo-gray font-bold" title="عدد القطع بالسيريه"><i class="ph ph-ruler"></i> ${piecesPerSeries} قطع</span>
                                <span class="text-devo-info text-[11px] bg-devo-info/10 text-devo-info px-2.5 py-0.5 rounded-lg border border-devo-info/30 font-bold font-mono" title="سعر القطعة"><i class="ph ph-tag"></i> ق: ${Number(modelGroup.piecePrice).toLocaleString('en-US')} ج</span>
                                <span class="text-devo-orange text-[11px] bg-devo-orange/10 text-devo-orange px-2.5 py-0.5 rounded-lg border border-devo-orange/30 font-bold font-mono" title="سعر السيريه"><i class="ph ph-stack"></i> سيريه: ${Number(modelGroup.pricePerSeries).toLocaleString('en-US')} ج</span>
                            </div>
                        </div>
                        <button type="button" onclick="deleteLocalModel('${modelGroup.modelId}')" class="text-devo-error hover:bg-devo-error/20 px-3 py-1.5 rounded-xl transition-colors shrink-0 flex items-center gap-1.5 text-xs font-bold border border-devo-error/30 cursor-pointer active:scale-95" title="إزالة الموديل بالكامل بجميع ألوانه">
                            <i class="ph ph-trash text-base"></i> <span>حذف الموديل</span>
                        </button>
                    </div>

                    <div class="mt-1">
                        <p class="text-devo-muted text-xs font-bold mb-2 flex items-center gap-1.5">
                            <i class="ph ph-palette text-devo-orange"></i> الألوان المحددة لهذا الموديل (${modelGroup.colors.length}):
                        </p>
                        <div class="space-y-1.5">
                            ${colorsHtml}
                        </div>
                    </div>

                    <div class="flex justify-between items-center pt-2.5 border-t border-devo-gray/50 text-xs flex-wrap gap-2">
                        <span class="text-devo-muted font-bold">
                            إجمالي الموديل: <span class="text-white font-bold font-mono text-sm">${modelTotalSeries} سيريه</span> <span class="text-devo-muted text-[11px]">(${modelTotalSeries * piecesPerSeries} قطعة)</span>
                        </span>
                        <span class="text-devo-orange font-black font-mono text-base md:text-lg">${modelTotalPrice.toLocaleString('en-US')} ج.م</span>
                    </div>
                </div>
            </div>
        `;
    });

    return cardsHtml;
}

// =========================================================================
// 🌟 4. رسم كروت الموديلات المجمعة لوضع العرض (View Order Details) 🌟
// =========================================================================
function renderViewOrderCardsHTML(o) {
    const groupedMap = new Map();
    (o.order_items || []).forEach((item) => {
        if (!groupedMap.has(item.model_id)) {
            const code = item.models?.factory_code || item.models?.system_code || '';
            const sizesCount = getModelSizesCount(item.models, item.sizes_count);
            const piecePrice = sizesCount > 0 ? (item.price_per_series / sizesCount) : item.price_per_series;
            
            let imgUrl = './src/assets/icons/devo.png';
            if (item.models?.model_images && item.models.model_images.length > 0) {
                imgUrl = resolveImageUrl(item.models.model_images[0].image_url);
            }

            groupedMap.set(item.model_id, {
                modelId: item.model_id,
                modelName: item.models?.name || 'موديل غير محدد',
                factoryCode: code,
                sizesCount: sizesCount,
                piecePrice: piecePrice,
                pricePerSeries: item.price_per_series,
                image: imgUrl,
                colors: []
            });
        }
        groupedMap.get(item.model_id).colors.push(item);
    });

    if (groupedMap.size === 0) {
        return `<div class="p-10 text-center text-devo-muted text-sm">لا توجد أصناف مسجلة في هذا الأوردر.</div>`;
    }

    let cardsHtml = '';
    groupedMap.forEach((modelGroup) => {
        let modelTotalPrice = 0;
        let modelTotalSeries = 0;
        let colorsHtml = '';

        const piecesPerSeries = modelGroup.sizesCount;

        modelGroup.colors.forEach((item) => {
            const itemTotalPrice = item.quantity * item.price_per_series;
            const pieces = item.quantity * piecesPerSeries;

            modelTotalPrice += itemTotalPrice;
            modelTotalSeries += item.quantity;

            colorsHtml += `
                <div class="p-2.5 bg-devo-black border border-devo-gray/70 rounded-xl transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 hover:border-devo-gray">
                    <div class="flex items-center gap-2">
                        <span class="w-3 h-3 rounded-full bg-devo-info shrink-0 shadow-sm shadow-devo-info/50"></span>
                        <span class="text-white font-bold text-xs sm:text-sm"><i class="ph-fill ph-palette text-devo-info mr-0.5"></i> ${escapeHtml(item.colors?.name || '-')}</span>
                    </div>

                    <div class="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                        <div class="bg-devo-dark border border-devo-gray px-3 py-1 rounded-xl text-center">
                            <span class="text-white font-black font-mono text-sm">${item.quantity}</span> <span class="text-[11px] text-devo-muted">سيريه</span>
                            <span class="text-[10px] text-devo-muted font-mono mr-1">(${pieces} قطعة)</span>
                        </div>
                        <div class="text-left">
                            <p class="text-devo-orange font-black text-xs sm:text-sm font-mono">${Number(itemTotalPrice).toLocaleString('en-US')} ج.م</p>
                            <p class="text-devo-muted text-[10px] font-mono">سعر السيريه: ${Number(item.price_per_series).toLocaleString('en-US')} ج</p>
                        </div>
                    </div>
                </div>
            `;
        });

        cardsHtml += `
            <div class="cart-item-card flex flex-col md:flex-row gap-3 md:gap-4 p-4 bg-devo-dark border border-devo-gray rounded-2xl relative transition-all duration-300 mb-3.5 shadow-sm" data-search="${escapeHtml(modelGroup.modelName)} ${escapeHtml(modelGroup.factoryCode)}">
                <div class="flex gap-3 items-start shrink-0">
                    <img src="${modelGroup.image}" class="w-20 h-20 md:w-24 md:h-24 rounded-xl object-cover bg-devo-black shrink-0 border border-devo-gray" onerror="this.src='./src/assets/icons/devo.png'">
                </div>

                <div class="flex flex-col flex-1 justify-between gap-2.5">
                    <div>
                        <h4 class="text-white font-black text-base md:text-lg search-target">${escapeHtml(modelGroup.modelName)}</h4>
                        <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span class="text-devo-muted text-[11px] font-mono bg-devo-black px-2.5 py-0.5 rounded-lg border border-devo-gray font-bold" title="كود الموديل"><i class="ph ph-barcode"></i> ${escapeHtml(modelGroup.factoryCode || 'بدون كود')}</span>
                            <span class="text-devo-muted text-[11px] bg-devo-black px-2.5 py-0.5 rounded-lg border border-devo-gray font-bold" title="عدد القطع بالسيريه"><i class="ph ph-ruler"></i> ${piecesPerSeries} قطع</span>
                            <span class="text-devo-info text-[11px] bg-devo-info/10 text-devo-info px-2.5 py-0.5 rounded-lg border border-devo-info/30 font-bold font-mono" title="سعر القطعة"><i class="ph ph-tag"></i> ق: ${Number(modelGroup.piecePrice).toLocaleString('en-US')} ج</span>
                            <span class="text-devo-orange text-[11px] bg-devo-orange/10 text-devo-orange px-2.5 py-0.5 rounded-lg border border-devo-orange/30 font-bold font-mono" title="سعر السيريه"><i class="ph ph-stack"></i> سيريه: ${Number(modelGroup.pricePerSeries).toLocaleString('en-US')} ج</span>
                        </div>
                    </div>

                    <div class="mt-1">
                        <p class="text-devo-muted text-xs font-bold mb-2 flex items-center gap-1.5">
                            <i class="ph ph-palette text-devo-orange"></i> الألوان المسجلة لهذا الموديل (${modelGroup.colors.length}):
                        </p>
                        <div class="space-y-1.5">
                            ${colorsHtml}
                        </div>
                    </div>

                    <div class="flex justify-between items-center pt-2.5 border-t border-devo-gray/50 text-xs flex-wrap gap-2">
                        <span class="text-devo-muted font-bold">
                            إجمالي الموديل: <span class="text-white font-bold font-mono text-sm">${modelTotalSeries} سيريه</span> <span class="text-devo-muted text-[11px]">(${modelTotalSeries * piecesPerSeries} قطعة)</span>
                        </span>
                        <span class="text-devo-orange font-black font-mono text-base md:text-lg">${modelTotalPrice.toLocaleString('en-US')} ج.م</span>
                    </div>
                </div>
            </div>
        `;
    });

    return cardsHtml;
}

function calculateLocalTotalSeries() {
    return localEditingItems.reduce((sum, item) => item.isDeleted ? sum : sum + item.quantity, 0);
}

function calculateLocalTotalPieces() {
    return localEditingItems.reduce((sum, item) => {
        if (item.isDeleted) return sum;
        const sizesCount = getModelSizesCount(item.models);
        return sum + (item.quantity * sizesCount);
    }, 0);
}

function calculateLocalTotalPrice() {
    return localEditingItems.reduce((sum, item) => item.isDeleted ? sum : sum + (item.quantity * item.price_per_series), 0);
}

function calculateLocalRemaining() {
    const total = calculateLocalTotalPrice();
    const depositInput = document.getElementById('ao-edit-deposit');
    const depositVal = depositInput ? parseFloat(depositInput.value) : Number(localEditingCustomerData.deposit || 0);
    const deposit = isNaN(depositVal) ? 0 : depositVal;
    return Math.max(0, total - deposit);
}

window.handleLocalDepositChange = (val) => {
    const depositNum = parseFloat(val) || 0;
    localEditingCustomerData.deposit = depositNum;

    const total = calculateLocalTotalPrice();
    const remaining = Math.max(0, total - depositNum);

    const depositDisplay = document.getElementById('local-edit-deposit-display');
    if (depositDisplay) {
        depositDisplay.textContent = `${depositNum.toLocaleString('en-US')} ج.م`;
    }

    const remainingEl = document.getElementById('local-edit-remaining');
    if (remainingEl) {
        remainingEl.textContent = `${remaining.toLocaleString('en-US')} ج.م`;
    }
};

function updateLocalItemsTableAndFinancials(o) {
    const container = document.getElementById('modal-items-container');
    if (container) {
        container.innerHTML = renderLocalItemsCardsHTML(o);
    }

    const totalSeries = calculateLocalTotalSeries();
    const totalPieces = calculateLocalTotalPieces();
    const totalPrice = calculateLocalTotalPrice();
    const remaining = calculateLocalRemaining();
    const activeCount = localEditingItems.filter(i => !i.isDeleted).length;

    const totalSeriesEl = document.getElementById('local-edit-total-series');
    if (totalSeriesEl) totalSeriesEl.textContent = totalSeries;

    const totalPiecesEl = document.getElementById('local-edit-total-pieces');
    if (totalPiecesEl) totalPiecesEl.textContent = `(${totalPieces} قطعة)`;

    const totalPriceEl = document.getElementById('local-edit-total-price');
    if (totalPriceEl) totalPriceEl.textContent = `${totalPrice.toLocaleString('en-US')} ج.م`;

    const remainingEl = document.getElementById('local-edit-remaining');
    if (remainingEl) remainingEl.textContent = `${remaining.toLocaleString('en-US')} ج.م`;

    const countEl = document.getElementById('ao-local-items-count');
    if (countEl) countEl.textContent = activeCount;

    const searchInput = document.getElementById('ao-local-search-input');
    if (searchInput && searchInput.value) {
        filterModalTable(searchInput.value);
    }
}

window.filterModalTable = (term) => {
    term = (term || '').toLowerCase().trim();
    const container = document.getElementById('modal-items-container');
    if (!container) return;
    const cards = container.querySelectorAll('.cart-item-card');
    cards.forEach(card => {
        const text = (card.getAttribute('data-search') || card.innerText || '').toLowerCase();
        card.style.display = text.includes(term) ? '' : 'none';
    });
};

window.deleteLocalModel = async (modelId) => {
    const modelItems = localEditingItems.filter(i => i.model_id === modelId && !i.isDeleted);
    if (modelItems.length === 0) return;

    const modelName = modelItems[0]?.models?.name || 'هذا الموديل';
    const confirmed = await confirmDialog({
        title: 'حذف الموديل بالكامل',
        message: `هل أنت متأكد من حذف الموديل (${modelName}) بجميع ألوانه (${modelItems.length} ألوان) من الفاتورة؟`,
        isDestructive: true
    });

    if (confirmed) {
        localEditingItems.forEach(item => {
            if (item.model_id === modelId) {
                item.isDeleted = true;
                item.quantity = 0;
            }
        });
        const targetOrderId = isDuplicateMode ? sourceDuplicatingOrderId : currentEditingOrderId;
        const o = allAdminOrders.find(x => x.id === targetOrderId);
        if (o) updateLocalItemsTableAndFinancials(o);
        showToast(`تم حذف الموديل (${modelName}) بنجاح`, 'info');
    }
};

window.updateLocalItemQty = async (index, newQty) => {
    if (newQty < 1) return;
    const targetOrderId = isDuplicateMode ? sourceDuplicatingOrderId : currentEditingOrderId;
    const o = allAdminOrders.find(x => x.id === targetOrderId);
    if (!o) return;
    
    const item = localEditingItems[index];
    const key = `${item.model_id}_${item.color_id}`;
    const dbStock = localEditingInventory[key] !== undefined ? localEditingInventory[key] : 0;
    
    if (isDuplicateMode) {
        if (newQty > dbStock) {
            showToast(`المخزون غير كافي! المتاح بالمخزن هو: ${dbStock} سيريه فقط.`, 'warning');
            return;
        }
    } else {
        const originalItem = (o.order_items || []).find(oi => oi.model_id === item.model_id && oi.color_id === item.color_id);
        const originalQty = originalItem ? originalItem.quantity : 0;
        const realTimeStock = dbStock - (item.quantity - originalQty);

        if (newQty > item.quantity) {
            const diff = newQty - item.quantity;
            if (diff > realTimeStock) {
                showToast(`المخزون غير كافي! المتاح إضافته هو: ${realTimeStock} سيريه فقط.`, 'warning');
                return;
            }
        }
    }
    
    localEditingItems[index].quantity = newQty;
    updateLocalItemsTableAndFinancials(o);
};

window.deleteLocalItem = async (index) => {
    localEditingItems[index].isDeleted = true;
    localEditingItems[index].quantity = 0;
    const targetOrderId = isDuplicateMode ? sourceDuplicatingOrderId : currentEditingOrderId;
    const o = allAdminOrders.find(x => x.id === targetOrderId);
    if (o) updateLocalItemsTableAndFinancials(o);
};

window.cancelLocalEdit = async (orderId) => {
    if (isDuplicateMode) {
        const sourceId = sourceDuplicatingOrderId;
        isDuplicateMode = false;
        sourceDuplicatingOrderId = null;
        sourceDuplicatingInvoiceNumber = '';
        localEditingItems = [];
        localEditingInventory = {};
        localEditingCustomerData = {
            customer_name: '',
            phone_1: '',
            phone_2: '',
            address: '',
            deposit: 0,
            deposit_receiver: '',
            notes: ''
        };
        if (sourceId) {
            viewAdminOrderDetails(sourceId);
        } else {
            closeAdminOrderDetails();
        }
        return;
    }

    isLocalEditMode = false;
    localEditingItems = [];
    localEditingInventory = {};
    localEditingCustomerData = {
        customer_name: '',
        phone_1: '',
        phone_2: '',
        address: '',
        deposit: 0,
        deposit_receiver: '',
        notes: ''
    };

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
    // جمع وقراءة بيانات العميل المدخلة من الحقول
    const customerName = document.getElementById('ao-edit-cust-name')?.value?.trim() || '';
    const phone1 = document.getElementById('ao-edit-phone-1')?.value?.trim() || '';
    const phone2 = document.getElementById('ao-edit-phone-2')?.value?.trim() || null;
    const address = document.getElementById('ao-edit-address')?.value?.trim() || null;
    const deposit = parseFloat(document.getElementById('ao-edit-deposit')?.value) || 0;
    const depositReceiver = document.getElementById('ao-edit-deposit-receiver')?.value?.trim() || null;
    const notes = document.getElementById('ao-edit-notes')?.value?.trim() || null;

    if (!customerName) {
        showToast('يرجى إدخال اسم العميل / اسم المحل!', 'warning');
        document.getElementById('ao-edit-cust-name')?.focus();
        return;
    }

    if (!phone1) {
        showToast('يرجى إدخال رقم الهاتف الأساسي للعميل!', 'warning');
        document.getElementById('ao-edit-phone-1')?.focus();
        return;
    }

    const activeItems = localEditingItems.filter(item => !item.isDeleted && item.quantity > 0);
    if (activeItems.length === 0) {
        return showToast('عفواً، لا يمكن حفظ الأوردر فارغاً بالكامل! يرجى حذف الأوردر نهائياً بدلاً من ذلك.', 'error');
    }

    const saveBtn = document.getElementById('ao-local-save-btn');
    if (!saveBtn) return;
    const oldBtnHtml = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> ${isDuplicateMode ? 'جاري إنشاء ونسخ الأوردر...' : 'جاري حفظ التعديلات والمخزون...'}`;

    try {
        const modelIds = [...new Set(activeItems.map(i => i.model_id))];
        const { data: dbInv, error: dbInvError } = await supabase
            .from('model_inventory')
            .select('model_id, color_id, available_series')
            .in('model_id', modelIds);

        if (dbInvError) throw dbInvError;

        let hasStockErrors = false;

        if (isDuplicateMode) {
            // فحص المخزون بالكامل لجميع أصناف الفاتورة المنسوخة الجديدة
            activeItems.forEach(item => {
                const inv = dbInv.find(x => x.model_id === item.model_id && x.color_id === item.color_id);
                const available = inv ? inv.available_series : 0;
                if (available < item.quantity) {
                    showToast(`المخزون غير كافي للموديل ${item.models?.name || ''}. المطلوب: ${item.quantity}، المتاح بالمخزن: ${available}`, 'error');
                    hasStockErrors = true;
                }
            });
        } else {
            const o = allAdminOrders.find(x => x.id === orderId);
            if (!o) throw new Error('الأوردر غير موجود');

            activeItems.forEach(item => {
                const originalItem = (o.order_items || []).find(oi => oi.model_id === item.model_id && oi.color_id === item.color_id);
                const originalQty = originalItem ? originalItem.quantity : 0;
                const diff = item.quantity - originalQty;

                if (diff > 0) {
                    const inv = dbInv.find(x => x.model_id === item.model_id && x.color_id === item.color_id);
                    const available = inv ? inv.available_series : 0;
                    if (available < diff) {
                        showToast(`المخزون غير كافي للموديل ${item.models?.name || ''}. المطلوب زيادة: ${diff}، المتاح بالمخزن: ${available}`, 'error');
                        hasStockErrors = true;
                    }
                }
            });
        }

        if (hasStockErrors) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = oldBtnHtml;
            return;
        }

        // 2. تحديث البيانات الشاملة
        const orderData = {
            customer_name: customerName,
            phone_1: phone1,
            phone_2: phone2,
            address: address,
            deposit: deposit,
            deposit_receiver: depositReceiver,
            notes: notes,
            total_price: calculateLocalTotalPrice(),
            total_series: calculateLocalTotalSeries(),
            worker_id: currentUserProfile?.id || null
        };

        const orderItemsData = activeItems.map(item => {
            const sizesCount = getModelSizesCount(item.models);
            return {
                model_id: item.model_id,
                color_id: item.color_id,
                color_name: item.colors?.name || item.color_name || '',
                qty: item.quantity,
                model_name: item.models?.name || '',
                price: item.price_per_series,
                total: item.quantity * item.price_per_series,
                sizes_count: sizesCount,
                piece_price: sizesCount > 0 ? item.price_per_series / sizesCount : item.price_per_series
            };
        });

        if (isDuplicateMode) {
            // إنشاء أوردر جديد تماماً كفاتورة مكررة برقم جديد
            const { data: rpcData, error: rpcError } = await supabase.rpc('process_order_transaction', {
                p_order_id: null,
                p_order_data: orderData,
                p_order_items: orderItemsData
            });

            if (rpcError) throw rpcError;

            const newOrderId = rpcData?.order_id;
            const newInvoiceNumber = rpcData?.invoice_number;

            if (newOrderId) {
                await logOrderAction(newOrderId, 'created_via_duplicate', `تم إنشاء الأوردر كنسخة مكررة من الأوردر #${sourceDuplicatingInvoiceNumber} بواسطة (${currentUserProfile?.full_name || 'إداري'})`);
            }

            showToast(`تم إنشاء ونسخ الأوردر بنجاح! رقم الفاتورة الجديد: #${newInvoiceNumber}`, 'success');

            isDuplicateMode = false;
            sourceDuplicatingOrderId = null;
            sourceDuplicatingInvoiceNumber = '';
            closeAdminOrderDetails();
            await fetchAdminOrders();

        } else {
            // تحديث أوردر قائم محلياً
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

            await logOrderAction(orderId, 'edited_locally', `تم تعديل بيانات وأصناف الأوردر محلياً وحفظ المخزون بواسطة الإداري ${currentUserProfile?.full_name || ''}`);

            showToast('تم حفظ تعديلات الأوردر والبيانات وتحديث المخزون بنجاح!', 'success');
            closeAdminOrderDetails();
            await fetchAdminOrders();
        }

    } catch (e) {
        showToast('فشل حفظ الأوردر: ' + e.message, 'error');
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

    if (o.status === 'registered') {
        return showToast('عفواً، لا يمكن تعديل هذا الأوردر لأنه في حالة (تم التسجيل)!', 'error');
    }

    if (o.is_locked && o.assigned_admin_name && o.assigned_admin_name !== currentUserProfile?.full_name && currentUserProfile?.role !== 'owner') {
        return showToast(`هذا الأوردر مقفول حالياً بواسطة (${o.assigned_admin_name})!`, 'error');
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
function getModelSizesCount(model, fallbackSizesCount = 1) {
    if (model) {
        const classSizes = model.classes?.class_sizes;
        if (Array.isArray(classSizes) && classSizes.length > 0) {
            return classSizes.length;
        }
        const modelSizes = model.model_sizes;
        if (Array.isArray(modelSizes) && modelSizes.length > 0) {
            return modelSizes.length;
        }
    }
    const num = Number(fallbackSizesCount);
    if (!isNaN(num) && num > 1) {
        return num;
    }
    return 1;
}