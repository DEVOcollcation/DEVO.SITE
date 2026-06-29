import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';

// ============================================================
// State
// ============================================================
let isInitialized = false;
let allOrders = [];
let currentModalOrderId = null;
let currentModalItems = [];
let currentTabFilter = 'all';

const prepStatusConfig = {
    pending:     { text: 'في الانتظار',     color: 'bg-devo-gray/50 text-white border-devo-gray' },
    in_progress: { text: 'جاري التحضير',    color: 'bg-devo-orange/20 text-devo-orange border-devo-orange/50' },
    on_hold:     { text: 'موقوف (مشكلة)',   color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50' },
    prepared:    { text: 'تم التحضير',      color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
    shipped:     { text: 'تم الشحن',        color: 'bg-green-500/20 text-green-400 border-green-500/50' },
};

// ============================================================
// Entry Point
// ============================================================
export async function initPreparationView() {
    if (isInitialized) {
        applyFilter();
        return;
    }

    // Filters
    ['prep-filter-invoice','prep-filter-customer','prep-filter-date-from','prep-filter-date-to','prep-filter-status']
        .forEach(id => document.getElementById(id)?.addEventListener('input', applyFilter));

    document.getElementById('prep-show-archived')?.addEventListener('change', applyFilter);

    await fetchOrders();
    setupRealtime();
    isInitialized = true;
}

// ============================================================
// 1. Fetch orders from Supabase view
// ============================================================
async function fetchOrders() {
    setTableLoading(true);

    const { data, error } = await supabase
        .from('v_orders_preparation_summary')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        showToast('خطأ في جلب الأوردرات', 'error');
        console.error(error);
        setTableLoading(false);
        return;
    }

    allOrders = data || [];
    updateStats();
    applyFilter();
}

// ============================================================
// 2. Stats
// ============================================================
function updateStats() {
    const active = allOrders.filter(o => !o.is_archived);
    document.getElementById('prep-stat-pending').textContent    = active.filter(o => o.preparation_status === 'pending').length;
    document.getElementById('prep-stat-inprogress').textContent = active.filter(o => o.preparation_status === 'in_progress').length;
    document.getElementById('prep-stat-onhold').textContent     = active.filter(o => o.preparation_status === 'on_hold').length;
    document.getElementById('prep-stat-prepared').textContent   = active.filter(o => o.preparation_status === 'prepared').length;
    document.getElementById('prep-stat-shipped').textContent    = active.filter(o => o.preparation_status === 'shipped').length;
}

// ============================================================
// 3. Filter & Render
// ============================================================
function applyFilter() {
    const invoice  = document.getElementById('prep-filter-invoice')?.value.trim().toLowerCase() || '';
    const customer = document.getElementById('prep-filter-customer')?.value.trim().toLowerCase() || '';
    const dateFrom = document.getElementById('prep-filter-date-from')?.value || '';
    const dateTo   = document.getElementById('prep-filter-date-to')?.value || '';
    const status   = document.getElementById('prep-filter-status')?.value || '';
    const showArchived = document.getElementById('prep-show-archived')?.checked || false;

    const filtered = allOrders.filter(o => {
        if (!showArchived && o.is_archived) return false;
        if (invoice  && !String(o.invoice_number).toLowerCase().includes(invoice)) return false;
        if (customer && !o.customer_name.toLowerCase().includes(customer) &&
                        !String(o.phone_1 || '').includes(customer)) return false;
        if (status   && o.preparation_status !== status) return false;
        const orderDate = o.created_at?.substring(0, 10);
        if (dateFrom && orderDate < dateFrom) return false;
        if (dateTo   && orderDate > dateTo)   return false;
        return true;
    });

    renderTable(filtered);
}

function renderTable(orders) {
    const tbody = document.getElementById('prep-table-body');
    if (!tbody) return;

    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-10 text-center text-devo-muted">
            <i class="ph ph-package text-4xl block mb-2 opacity-30"></i>
            لا توجد أوردرات
        </td></tr>`;
        return;
    }

    tbody.innerHTML = orders.map(o => {
        const st = prepStatusConfig[o.preparation_status] || prepStatusConfig.pending;
        const pct = o.progress_pct || 0;
        const dateStr = o.created_at
            ? new Date(o.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' })
            : '—';

        const progressBar = `
            <div class="flex items-center gap-2 justify-center min-w-[120px]">
                <div class="flex-1 bg-devo-gray rounded-full h-1.5 overflow-hidden">
                    <div class="h-full bg-devo-orange rounded-full transition-all" style="width:${pct}%"></div>
                </div>
                <span class="text-xs font-bold text-devo-orange w-8 text-left">${pct}%</span>
            </div>`;

        const archiveBtn = o.preparation_status === 'shipped'
            ? `<button onclick="archiveOrder('${o.id}', ${o.is_archived})"
                class="text-xs px-2 py-1 rounded ${o.is_archived ? 'bg-devo-gray text-devo-muted' : 'bg-devo-gray hover:bg-red-900/30 hover:text-red-400 text-devo-muted'} transition-colors flex items-center gap-1">
                <i class="ph ph-archive"></i>${o.is_archived ? 'مؤرشَف' : 'أرشفة'}
               </button>` : '';

        const activateBtn = o.preparation_status === 'pending'
            ? `<button onclick="activateForPreparation('${o.id}')"
                class="text-xs px-2 py-1 rounded bg-devo-orange/20 hover:bg-devo-orange/40 text-devo-orange transition-colors flex items-center gap-1">
                <i class="ph ph-play"></i> تفعيل
               </button>` : '';

        return `<tr class="hover:bg-devo-gray/20 transition-colors ${o.is_archived ? 'opacity-50' : ''}">
            <td class="p-3 font-mono font-bold text-devo-orange">#${o.invoice_number}</td>
            <td class="p-3">
                <p class="font-bold text-white text-sm">${o.customer_name}</p>
                <p class="text-xs text-devo-muted">${o.phone_1 || ''}</p>
            </td>
            <td class="p-3 text-xs text-devo-muted">${dateStr}</td>
            <td class="p-3 text-xs text-devo-muted">${o.worker_name || '<span class="text-devo-gray italic">لم يُسنَد</span>'}</td>
            <td class="p-3">${progressBar}
                <p class="text-center text-[10px] text-devo-muted mt-1">${o.prepared_items}/${o.total_items} لون</p>
            </td>
            <td class="p-3 text-center">
                <span class="px-2 py-1 rounded-full text-xs font-bold border ${st.color} whitespace-nowrap">${st.text}</span>
            </td>
            <td class="p-3">
                <div class="flex items-center justify-center gap-1.5 flex-wrap">
                    <button onclick="openPrepDetailModal('${o.id}')"
                        class="text-xs px-2 py-1 rounded bg-devo-gray hover:bg-devo-gray/70 text-white transition-colors flex items-center gap-1">
                        <i class="ph ph-eye"></i> عرض
                    </button>
                    ${activateBtn}
                    ${archiveBtn}
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ============================================================
// 4. Activate order for preparation
// ============================================================
window.activateForPreparation = async function(orderId) {
    const { error } = await supabase.rpc('init_order_preparation', { p_order_id: orderId });
    if (error) {
        showToast('خطأ في تفعيل الأوردر: ' + error.message, 'error');
    } else {
        showToast('تم تفعيل الأوردر للتحضير', 'success');
        await fetchOrders();
    }
};

// ============================================================
// 5. Archive order
// ============================================================
window.archiveOrder = async function(orderId, isArchived) {
    const { error } = await supabase
        .from('orders')
        .update({ is_archived: !isArchived })
        .eq('id', orderId);

    if (error) {
        showToast('خطأ في الأرشفة', 'error');
    } else {
        showToast(isArchived ? 'تم إلغاء الأرشفة' : 'تم أرشفة الأوردر', 'success');
        await fetchOrders();
    }
};

// ============================================================
// 6. Refresh
// ============================================================
window.refreshPreparationView = async function() {
    await fetchOrders();
    showToast('تم التحديث', 'success');
};

// ============================================================
// 7. Detail Modal
// ============================================================
window.openPrepDetailModal = async function(orderId) {
    currentModalOrderId = orderId;
    currentTabFilter = 'all';

    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;

    // Set modal header
    document.getElementById('prep-modal-title').textContent  = `تفاصيل التحضير — فاتورة #${order.invoice_number}`;
    document.getElementById('prep-modal-subtitle').textContent = `${order.customer_name} | ${order.phone_1 || ''} | ${order.address || ''}`;
    document.getElementById('prep-modal-status-select').value = order.preparation_status;

    // Update progress
    updateModalProgress(order);

    // Fetch items
    await fetchAndRenderModalItems(orderId);

    // Show modal
    const modal = document.getElementById('prep-detail-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modal.querySelector('.bg-devo-dark').classList.remove('scale-95');
    });
};

window.closePrepDetailModal = function() {
    const modal = document.getElementById('prep-detail-modal');
    modal.classList.add('opacity-0');
    modal.querySelector('.bg-devo-dark').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
    currentModalOrderId = null;
};

function updateModalProgress(order) {
    const pct = order.progress_pct || 0;
    document.getElementById('prep-modal-progress-bar').style.width = pct + '%';
    document.getElementById('prep-modal-progress-text').textContent = pct + '%';
    document.getElementById('prep-modal-total').textContent   = order.total_items || 0;
    document.getElementById('prep-modal-done').textContent    = order.prepared_items || 0;
    document.getElementById('prep-modal-issues').textContent  = order.issue_items || 0;
}

async function fetchAndRenderModalItems(orderId) {
    const body = document.getElementById('prep-modal-items-body');
    body.innerHTML = `<div class="text-center py-10"><i class="ph ph-spinner animate-spin text-2xl text-devo-orange"></i></div>`;

    const { data, error } = await supabase
        .from('v_preparation_items_detail')
        .select('*')
        .eq('order_id', orderId)
        .order('model_name');

    if (error) {
        body.innerHTML = `<p class="text-devo-error text-center py-6">خطأ في جلب البيانات</p>`;
        return;
    }

    currentModalItems = data || [];
    renderModalItems();
}

function renderModalItems() {
    const body = document.getElementById('prep-modal-items-body');
    
    let items = currentModalItems;
    if (currentTabFilter === 'done')    items = items.filter(i => i.is_prepared);
    if (currentTabFilter === 'pending') items = items.filter(i => !i.is_prepared);
    if (currentTabFilter === 'issues')  items = items.filter(i => i.has_issue || i.prep_note);

    if (items.length === 0) {
        body.innerHTML = `<div class="text-center py-10 text-devo-muted">
            <i class="ph ph-check-circle text-4xl block mb-2 opacity-30"></i>
            لا توجد عناصر في هذه الفئة
        </div>`;
        return;
    }

    // Group by model
    const grouped = {};
    items.forEach(item => {
        const key = item.model_id;
        if (!grouped[key]) grouped[key] = { model: item, colors: [] };
        grouped[key].colors.push(item);
    });

    body.innerHTML = Object.values(grouped).map(g => `
        <div class="bg-devo-black border border-devo-gray rounded-xl overflow-hidden">
            <div class="flex items-center gap-3 px-4 py-2 bg-devo-dark/60 border-b border-devo-gray">
                <div class="flex-1">
                    <span class="font-bold text-white text-sm">${g.model.model_name}</span>
                    <span class="text-xs text-devo-muted mr-2">| كود: ${g.model.factory_code}</span>
                    ${g.model.category_name ? `<span class="text-xs text-devo-orange bg-devo-orange/10 px-2 py-0.5 rounded mr-1">${g.model.category_name}</span>` : ''}
                    ${g.model.class_name ? `<span class="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">${g.model.class_name}</span>` : ''}
                </div>
            </div>
            <div class="divide-y divide-devo-gray/50">
                ${g.colors.map(c => {
                    const statusIcon = c.is_prepared
                        ? `<i class="ph ph-check-circle text-green-400 text-lg"></i>`
                        : c.has_issue
                            ? `<i class="ph ph-warning-circle text-yellow-400 text-lg"></i>`
                            : `<i class="ph ph-circle text-devo-gray text-lg"></i>`;

                    return `<div class="flex items-center gap-3 px-4 py-2.5 ${c.has_issue ? 'bg-yellow-500/5' : ''}">
                        ${statusIcon}
                        <div class="flex-1">
                            <span class="text-sm text-white font-medium">${c.color_name}</span>
                            ${c.color_code ? `<span class="text-xs text-devo-muted mr-1">(${c.color_code})</span>` : ''}
                            ${c.prep_note ? `<p class="text-xs text-yellow-300 mt-0.5 flex items-center gap-1">
                                <i class="ph ph-note-pencil text-xs"></i> ${c.prep_note}
                            </p>` : ''}
                        </div>
                        <div class="text-left text-xs text-devo-muted">
                            <span class="text-white font-bold">${c.required_qty}</span> سيرية
                        </div>
                    </div>`;
                }).join('')}
            </div>
        </div>
    `).join('');
}

window.switchPrepModalTab = function(tab) {
    currentTabFilter = tab;
    // Update tab styles
    ['all','done','pending','issues'].forEach(t => {
        const btn = document.getElementById(`prep-tab-${t}`);
        if (!btn) return;
        if (t === tab) {
            btn.className = 'prep-detail-tab px-4 py-1.5 rounded-lg text-xs font-bold transition-colors bg-devo-orange text-white';
        } else {
            btn.className = 'prep-detail-tab px-4 py-1.5 rounded-lg text-xs font-bold transition-colors bg-devo-gray text-devo-muted hover:text-white';
        }
    });
    renderModalItems();
};

// ============================================================
// 8. Save status from modal
// ============================================================
window.savePreparationStatus = async function() {
    if (!currentModalOrderId) return;
    const newStatus = document.getElementById('prep-modal-status-select').value;

    const { data, error } = await supabase.rpc('finalize_order_preparation', {
        p_order_id:   currentModalOrderId,
        p_worker_id:  null,
        p_new_status: newStatus,
        p_note:       null
    });

    if (error) {
        showToast('خطأ: ' + error.message, 'error');
        return;
    }

    if (data && data.success === false) {
        showToast(data.error || 'لا يمكن تغيير الحالة', 'error');
        return;
    }

    showToast('تم تحديث حالة التحضير', 'success');
    closePrepDetailModal();
    await fetchOrders();
};

// ============================================================
// 9. Realtime listener
// ============================================================
function setupRealtime() {
    supabase.channel('prep_admin_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
            await fetchOrders();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_preparation' }, async (payload) => {
            // If modal is open for this order — refresh items
            if (currentModalOrderId && payload.new?.order_id === currentModalOrderId) {
                await fetchAndRenderModalItems(currentModalOrderId);
            }
            await fetchOrders();
        })
        .subscribe();
}

// ============================================================
// Helpers
// ============================================================
function setTableLoading(isLoading) {
    if (isLoading) {
        document.getElementById('prep-table-body').innerHTML = `<tr><td colspan="7" class="p-10 text-center text-devo-muted">
            <i class="ph ph-spinner animate-spin text-3xl text-devo-orange block mb-2"></i>
            جاري التحميل...
        </td></tr>`;
    }
}
