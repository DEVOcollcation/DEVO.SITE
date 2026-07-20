import { supabase } from '../../config/supabase.js';
import { syncActiveTheme } from '../../services/theme.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

// ============================================================
// State
// ============================================================
let currentUser    = null;
let allOrders      = [];
let currentFilter  = 'active';

let currentOrder   = null;
let prepItems      = [];          // flat array from view
let prepItemsMap   = new Map();   // prep_id → item  (single source of truth for metadata)
let originalItems  = [];
let viewMode       = 'full';
let currentSortKey = 'original';
let currentCardIndex = 0;
let groupedByModel = [];

let isFinalizing   = false;
const savingSet    = new Set();  // prep_ids currently being saved → prevents double-fire

// ============================================================
// Audit State
// ============================================================
let auditModels = [];
let auditItems = [];
let currentAuditModel = null;
let currentAuditColor = null;
let activeAuditSession = null;

// Audit View Mode State
let auditViewMode = 'full';
let currentAuditCardIndex = 0;
let auditGroupedByModel = [];

// Dirty states cache
let originalPrepStates = new Map();  // prep_id -> { is_prepared, has_issue, note }
let originalAuditStates = new Map(); // id -> counted_qty

// ============================================================
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    // تزامن المظهر النشط من قاعدة البيانات
    syncActiveTheme();

    const sessionStr = localStorage.getItem('devo_session');
    if (!sessionStr) { window.location.href = 'auth.html'; return; }
    try { currentUser = JSON.parse(sessionStr); }
    catch(e) { window.location.href = 'auth.html'; return; }

    // التحقق من الصلاحيات لدخول صفحة العمال / المخزن
    const role = currentUser.role;
    const workerJob = currentUser.worker_job;
    const isManager = (role === 'owner' || role === 'admin');
    const isWarehouseWorker = (role === 'worker' && (workerJob === 'warehouse' || workerJob === 'both'));
    
    if (!isManager && !isWarehouseWorker) {
        if (role === 'worker' && workerJob === 'showroom') {
            window.location.href = 'index.html';
        } else {
            localStorage.removeItem('devo_session');
            window.location.href = 'auth.html';
        }
        return;
    }

    // حقن أزرار التنقل ديناميكياً بناءً على الصلاحيات
    const hasShowroomAccess = (role === 'owner' || role === 'admin' || workerJob === 'showroom' || workerJob === 'both');
    const hasAdminAccess = (role === 'owner' || role === 'admin');
    
    if (hasShowroomAccess || hasAdminAccess) {
        const userContainer = document.querySelector('#wh-header .flex.items-center.gap-2');
        if (userContainer) {
            let navHtml = '';
            if (hasShowroomAccess) {
                navHtml += `
                    <a href="index.html" class="px-2.5 py-1 bg-devo-gray hover:bg-devo-orange/20 hover:text-devo-orange text-white border border-devo-gray hover:border-devo-orange/40 rounded-lg text-xs font-bold transition-all flex items-center gap-1">
                        <i class="ph ph-storefront text-sm"></i>
                        <span class="hidden sm:inline">الرئيسية (المعرض)</span>
                    </a>
                `;
            }
            if (hasAdminAccess) {
                navHtml += `
                    <a href="admin.html" class="px-2.5 py-1 bg-devo-gray hover:bg-devo-orange/20 hover:text-devo-orange text-white border border-devo-gray hover:border-devo-orange/40 rounded-lg text-xs font-bold transition-all flex items-center gap-1">
                        <i class="ph ph-shield-check text-sm"></i>
                        <span class="hidden sm:inline">الإدارة</span>
                    </a>
                `;
            }
            userContainer.insertAdjacentHTML('afterbegin', navHtml);
        }
    }

    document.getElementById('wh-worker-name').textContent = currentUser.full_name;
    document.getElementById('wh-worker-name').classList.remove('hidden');

    await loadOrderList();
    setupRealtimeOrders();
    setupEventDelegation();   // ← replaces all inline onclick on color rows
    setupSwipeNavigation();   // ← swipe left/right for card mode

    // Manual search input listener (Quick filter in active session)
    document.getElementById('audit-search-input')?.addEventListener('input', () => {
        if (activeAuditSession) {
            if (auditViewMode === 'full') renderAuditTable();
            else {
                buildAuditGroupedByModel();
                renderAuditCardView();
            }
        }
    });
});

// ============================================================
// Logout
// ============================================================
window.whLogout = function() {
    localStorage.removeItem('devo_session');
    window.location.href = 'auth.html';
};

// ============================================================
// 1. Load order list
// ============================================================
async function loadOrderList() {
    const list = document.getElementById('wh-orders-list');
    list.innerHTML = `<div class="text-center py-16 text-devo-muted">
        <i class="ph ph-spinner animate-spin text-4xl text-devo-orange block mb-3"></i>جاري التحميل...</div>`;

    const { data, error } = await supabase
        .from('v_orders_preparation_summary')
        .select('*')
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

    if (error) { showToast('خطأ في جلب الأوردرات', 'error'); return; }
    allOrders = data || [];
    renderOrderList();
}
window.refreshOrderList = async function() { await loadOrderList(); };

// ============================================================
// 2. Render order list
// ============================================================
function renderOrderList() {
    const list = document.getElementById('wh-orders-list');

    let filtered = allOrders;
    if (currentFilter === 'active') {
        filtered = allOrders.filter(o => ['pending','in_progress'].includes(o.preparation_status));
    } else {
        filtered = allOrders.filter(o => o.preparation_status === currentFilter);
    }

    if (filtered.length === 0) {
        list.innerHTML = `<div class="text-center py-16 text-devo-muted">
            <i class="ph ph-check-circle text-5xl text-devo-success block mb-3 opacity-40"></i>
            <p class="font-bold">لا توجد أوردرات في هذه الفئة</p>
        </div>`;
        return;
    }

    const statusConf = {
        pending:     { text: 'في الانتظار',   cls: 'text-white bg-devo-gray/50',         icon: 'ph-clock' },
        in_progress: { text: 'جاري التحضير',  cls: 'text-devo-orange bg-devo-orange/10', icon: 'ph-spinner' },
        on_hold:     { text: 'موقوف',          cls: 'text-yellow-400 bg-yellow-500/10',   icon: 'ph-warning-circle' },
        prepared:    { text: 'تم التحضير',    cls: 'text-blue-400 bg-blue-500/10',       icon: 'ph-check' },
        shipped:     { text: 'تم الشحن',      cls: 'text-green-400 bg-green-500/10',     icon: 'ph-truck' },
    };

    list.innerHTML = filtered.map(o => {
        const st  = statusConf[o.preparation_status] || statusConf.pending;
        const pct = o.progress_pct || 0;
        const canStart    = o.preparation_status === 'pending';
        const canContinue = ['in_progress','on_hold'].includes(o.preparation_status);

        const actionBtn = (canStart || canContinue)
            ? `<button onclick="openPreparation('${o.id}')"
                class="shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all
                       ${canStart ? 'bg-devo-orange text-white shadow-lg shadow-orange-900/30 active:scale-95' : 'bg-devo-orange/20 text-devo-orange active:scale-95'}">
                <i class="ph ${canStart ? 'ph-play' : 'ph-pencil'} text-lg"></i>
                ${canStart ? 'بدء التحضير' : 'متابعة'}
               </button>`
            : `<button onclick="openPreparation('${o.id}')"
                class="shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm bg-devo-gray text-devo-muted active:scale-95">
                <i class="ph ph-eye text-lg"></i> عرض
               </button>`;

        return `<div class="bg-devo-dark border border-devo-gray rounded-2xl p-4 space-y-3">
            <div class="flex items-start justify-between gap-3">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-black text-devo-orange text-xl">#${o.invoice_number}</span>
                        <span class="text-xs px-2 py-0.5 rounded-full font-bold ${st.cls}">
                            <i class="ph ${st.icon} text-xs"></i> ${st.text}
                        </span>
                    </div>
                    <p class="font-bold text-white mt-0.5 text-base">${o.customer_name}</p>
                    <p class="text-sm text-devo-muted">${o.phone_1 || ''}</p>
                    ${o.worker_name ? `<p class="text-xs text-devo-muted mt-1">العامل: <span class="text-white">${o.worker_name}</span></p>` : ''}
                </div>
                ${actionBtn}
            </div>
            <div class="space-y-1">
                <div class="flex justify-between text-xs">
                    <span class="text-devo-muted">${o.prepared_items}/${o.total_items} لون تم تحضيره</span>
                    <span class="font-bold text-devo-orange">${pct}%</span>
                </div>
                <div class="w-full bg-devo-gray rounded-full h-2.5 overflow-hidden">
                    <div class="h-full bg-devo-orange rounded-full transition-all" style="width:${pct}%"></div>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.setOrderFilter = function(filter) {
    currentFilter = filter;
    document.querySelectorAll('.order-filter-tab').forEach(b => {
        b.className = 'order-filter-tab shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors bg-devo-gray text-devo-muted';
    });
    const active = document.getElementById(`filter-tab-${filter}`);
    if (active) active.className = 'order-filter-tab shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors bg-devo-orange text-white';
    renderOrderList();
};

// ============================================================
// 3. Open preparation for an order
// ============================================================
window.openPreparation = async function(orderId) {
    const order = allOrders.find(o => o.id === orderId);
    if (!order) return;
    currentOrder = order;

    // If pending → start it (creates order_item_preparation rows)
    if (order.preparation_status === 'pending') {
        const { error } = await supabase.rpc('init_order_preparation', {
            p_order_id:  orderId,
            p_worker_id: currentUser.id
        });
        if (error) { showToast('خطأ: ' + error.message, 'error'); return; }
    }

    document.getElementById('wh-bottom-nav')?.classList.add('hidden');
    showScreen('screen-preparation');
    document.getElementById('btn-back-to-list').classList.remove('hidden');

    document.getElementById('prep-order-title').textContent   = `#${order.invoice_number} — ${order.customer_name}`;
    document.getElementById('prep-order-subtitle').textContent = `${order.address || ''} ${order.phone_1 || ''}`.trim();

    // Reset state
    savingSet.clear();
    currentSortKey  = 'original';
    currentCardIndex = 0;
    document.getElementById('prep-sort-select').value = 'original';

    await loadPrepItems(orderId);
    setViewMode('full');
};

window.goToOrderList = function() {
    currentOrder = null;
    window.switchWHScreen('orders');
};

// ============================================================
// 4. Load prep items
// ============================================================
async function loadPrepItems(orderId) {
    const { data, error } = await supabase
        .from('v_preparation_items_detail')
        .select('*')
        .eq('order_id', orderId);

    if (error) { showToast('خطأ في جلب بيانات الأوردر', 'error'); return; }

    prepItems  = data || [];
    
    // Save original states for exit/discard confirmation
    originalPrepStates.clear();
    prepItems.forEach(item => {
        originalPrepStates.set(item.prep_id, {
            is_prepared: item.is_prepared,
            has_issue: item.has_issue,
            note: item.prep_note || ''
        });
    });

    // Build lookup map
    prepItemsMap.clear();
    prepItems.forEach(item => prepItemsMap.set(item.prep_id, item));

    originalItems = [...prepItems];
    applySortToPrepItems(currentSortKey);
    buildGroupedByModel();
    updateProgressRing();
}

// ============================================================
// 5. Sort helpers
// ============================================================
function applySortToPrepItems(key) {
    if (key === 'original') {
        prepItems = [...originalItems];
    } else if (key === 'category') {
        prepItems = [...originalItems].sort((a, b) =>
            (a.category_name || '').localeCompare(b.category_name || '', 'ar'));
    } else if (key === 'factory_code') {
        prepItems = [...originalItems].sort((a, b) =>
            (a.factory_code || '').localeCompare(b.factory_code || '', 'ar'));
    }
}

window.changeSortOrder = function(key) {
    currentSortKey   = key;
    currentCardIndex = 0;
    applySortToPrepItems(key);
    buildGroupedByModel();
    if (viewMode === 'full') renderFullView();
    else renderCardView();
};

// ============================================================
// 6. Build grouped model list
// ============================================================
function buildGroupedByModel() {
    const map = new Map();
    prepItems.forEach(item => {
        const groupKey = `${item.model_name}_${item.factory_code || ''}`;
        if (!map.has(groupKey)) map.set(groupKey, { model: item, colors: [] });
        map.get(groupKey).colors.push(item);
    });
    groupedByModel = Array.from(map.values());
}

// ============================================================
// 7. View mode switch
// ============================================================
window.setViewMode = function(mode) {
    viewMode = mode;
    const fullView = document.getElementById('prep-full-view');
    const cardView = document.getElementById('prep-card-view');

    const activeClass = 'view-mode-btn flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors bg-devo-orange text-white flex items-center justify-center gap-1';
    const idleClass   = 'view-mode-btn flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors bg-devo-gray text-devo-muted flex items-center justify-center gap-1';

    document.getElementById('btn-mode-full').className = mode === 'full' ? activeClass : idleClass;
    document.getElementById('btn-mode-card').className = mode === 'card' ? activeClass : idleClass;

    if (mode === 'full') {
        document.body.classList.remove('focus-mode');
        fullView.classList.remove('hidden');
        cardView.classList.add('hidden');
        renderFullView();
    } else {
        document.body.classList.add('focus-mode');
        fullView.classList.add('hidden');
        cardView.classList.remove('hidden');
        currentCardIndex = 0;
        renderCardView();
    }
};

// ============================================================
// 8. Full view
// ============================================================
function renderFullView() {
    const container = document.getElementById('prep-full-view');
    if (groupedByModel.length === 0) {
        container.innerHTML = `<div class="text-center py-16 text-devo-muted">
            <i class="ph ph-package text-5xl block mb-3 opacity-30"></i>
            <p>لا توجد عناصر</p>
        </div>`;
        return;
    }
    container.innerHTML = groupedByModel.map(g => buildModelHTML(g)).join('');
}

// ============================================================
// 9. Card view
// ============================================================
function renderCardView() {
    if (groupedByModel.length === 0) return;

    const total = groupedByModel.length;
    currentCardIndex = Math.max(0, Math.min(currentCardIndex, total - 1));

    // Update counter (dir=ltr so numbers show correctly in RTL)
    const counter = document.getElementById('card-counter');
    counter.innerHTML = `<span dir="ltr">${currentCardIndex + 1} / ${total}</span>`;

    // Disable/enable nav buttons
    const btnPrev = document.getElementById('btn-prev-card');
    const btnNext = document.getElementById('btn-next-card');
    btnPrev.disabled = currentCardIndex === 0;
    btnNext.disabled = currentCardIndex === total - 1;

    const content = document.getElementById('prep-card-content');
    content.innerHTML = buildModelHTML(groupedByModel[currentCardIndex]);
}

window.nextCard = function() {
    if (currentCardIndex < groupedByModel.length - 1) {
        currentCardIndex++;
        renderCardView();
        document.getElementById('prep-card-content').scrollTop = 0;
    }
};
window.prevCard = function() {
    if (currentCardIndex > 0) {
        currentCardIndex--;
        renderCardView();
        document.getElementById('prep-card-content').scrollTop = 0;
    }
};

// ============================================================
// 10. Build model + color HTML (NO inline onclick with objects)
//     Uses data-action + data-prep-id → handled via event delegation
// ============================================================
function buildModelHTML(g) {
    const totalColors   = g.colors.length;
    const preparedCount = g.colors.filter(c => getLocalState(c.prep_id, 'is_prepared', c.is_prepared)).length;
    const issueCount    = g.colors.filter(c => getLocalState(c.prep_id, 'has_issue',   c.has_issue)).length;

    const colorRows = g.colors.map(c => buildColorRowHTML(c)).join('');

    return `<div class="bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden mb-3">
        <div class="flex items-center gap-3 px-4 py-3 bg-devo-black/40 border-b border-devo-gray">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-black text-white text-base">${g.model.model_name}</span>
                    <span class="text-xs font-mono text-devo-muted">${g.model.factory_code}</span>
                </div>
                <div class="flex gap-1.5 mt-1 flex-wrap">
                    ${g.model.category_name ? `<span class="text-xs text-devo-orange bg-devo-orange/10 px-2 py-0.5 rounded-full">${g.model.category_name}</span>` : ''}
                    ${g.model.class_name    ? `<span class="text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">${g.model.class_name}</span>`    : ''}
                </div>
            </div>
            <div class="text-xs text-right shrink-0 space-y-0.5">
                <p class="text-devo-muted"><span class="text-green-400 font-black text-base">${preparedCount}</span>/<span class="text-white">${totalColors}</span> محضَّر</p>
                ${issueCount > 0 ? `<p class="text-yellow-400 font-bold">${issueCount} مشكلة</p>` : ''}
            </div>
        </div>
        <div class="divide-y divide-devo-gray/40">${colorRows}</div>
    </div>`;
}

function buildColorRowHTML(c) {
    const isPrepared = getLocalState(c.prep_id, 'is_prepared', c.is_prepared);
    const hasIssue   = getLocalState(c.prep_id, 'has_issue',   c.has_issue);
    const note       = getLocalState(c.prep_id, 'note',        c.prep_note) || '';

    const rowBg = isPrepared ? 'bg-green-500/5 border-r-4 border-green-500 shadow-md'
                : hasIssue   ? 'bg-yellow-500/5 border-r-4 border-yellow-500 shadow-md' 
                : 'bg-devo-black/20 hover:bg-devo-black/40';

    let statusBadge = '';
    if (isPrepared) {
        statusBadge = `<span class="bg-green-500/20 text-green-400 px-2 py-0.5 rounded-lg text-[10px] font-bold">✓ تم التحضير</span>`;
    } else if (hasIssue) {
        statusBadge = `<span class="bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-lg text-[10px] font-bold">⚠ مشكلة / نقص</span>`;
    } else {
        statusBadge = `<span class="bg-devo-gray/50 text-devo-muted px-2 py-0.5 rounded-lg text-[10px] font-bold">انتظار</span>`;
    }

    return `<div class="color-item px-4 py-4 transition-all duration-200 border-b border-devo-gray/30 last:border-0 ${rowBg}" data-prep-id="${c.prep_id}">
        <div class="flex items-start justify-between gap-4">

            <!-- Right side: Color details -->
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-black text-white text-base">${c.color_name}</span>
                    ${c.color_code ? `<span class="text-xs text-devo-muted mr-0.5">(${c.color_code})</span>` : ''}
                    ${statusBadge}
                </div>
                
                <div class="flex items-center gap-3 mt-2">
                    <!-- Required Quantity Badge -->
                    <span class="bg-devo-orange/10 border border-devo-orange/30 text-devo-orange px-2.5 py-1 rounded-xl font-bold text-xs">
                        المطلوب: <span class="font-black text-white">${c.required_qty} سيرية</span>
                    </span>
                </div>

                <!-- Notes input -->
                <div class="mt-3 relative">
                    <input
                        type="text"
                        value="${escapeAttr(note)}"
                        placeholder="اكتب ملاحظة على هذا اللون إن وجدت..."
                        data-action="note"
                        data-prep-id="${c.prep_id}"
                        class="w-full bg-devo-black/50 border border-devo-gray/60 rounded-xl px-3 py-2
                               text-sm text-white placeholder-devo-gray/50 focus:border-devo-orange outline-none transition-all shadow-inner">
                </div>
            </div>

            <!-- Left side: Status toggle buttons (Larger and clearer) -->
            <div class="flex items-center gap-2.5 shrink-0 self-center">
                <!-- Warning / Issue button -->
                <button
                    data-action="toggle-issue"
                    data-prep-id="${c.prep_id}"
                    class="prep-toggle w-12 h-12 rounded-2xl border-2 flex items-center justify-center transition-all touch-manipulation select-none
                           ${hasIssue
                               ? 'bg-yellow-500 border-yellow-500 text-white shadow-lg shadow-yellow-900/30'
                               : 'bg-devo-gray/20 border-devo-gray text-devo-muted hover:border-yellow-500 hover:text-yellow-500 active:bg-yellow-500/20'}"
                    title="مشكلة / نقص">
                    <i class="ph ph-warning text-xl pointer-events-none"></i>
                </button>

                <!-- Prepared check button -->
                <button
                    data-action="toggle-prepared"
                    data-prep-id="${c.prep_id}"
                    class="prep-toggle w-12 h-12 rounded-2xl border-2 flex items-center justify-center transition-all touch-manipulation select-none
                           ${isPrepared
                               ? 'bg-green-500 border-green-500 text-white shadow-lg shadow-green-900/30'
                               : 'bg-devo-gray/20 border-devo-gray text-devo-muted hover:border-green-500 hover:text-green-500 active:bg-green-500/20'}"
                    title="تم التحضير">
                    <i class="ph ph-check text-xl pointer-events-none"></i>
                </button>
            </div>

        </div>
    </div>`;
}

// Safe attribute escaping
function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ============================================================
// 11. EVENT DELEGATION — single listener, no inline onclick
//     Eliminates double-fire and JSON.stringify hacks
// ============================================================
function setupEventDelegation() {
    // Handle toggle clicks on both full and card views
    ['prep-full-view', 'prep-card-content'].forEach(containerId => {
        const el = document.getElementById(containerId);
        if (!el) return;

        // ★ Use 'pointerdown' + preventDefault to stop the 300ms ghost click on mobile ★
        el.addEventListener('pointerdown', e => {
            const btn = e.target.closest('[data-action="toggle-prepared"], [data-action="toggle-issue"]');
            if (!btn) return;
            e.preventDefault(); // prevents the subsequent synthetic click event
            const prepId = btn.dataset.prepId;
            const action = btn.dataset.action;
            if (!prepId || !action) return;
            if (action === 'toggle-prepared') handleTogglePrepared(prepId);
            else if (action === 'toggle-issue') handleToggleIssue(prepId);
        });

        // Notes use 'change' (fires when user leaves input)
        el.addEventListener('change', e => {
            if (e.target.dataset.action === 'note') {
                handleNoteChange(e.target.dataset.prepId, e.target.value);
            }
        });
    });
}

// ============================================================
// 12. Toggle prepared
// ============================================================
async function handleTogglePrepared(prepId) {
    if (savingSet.has(prepId)) return; // guard against double-fire
    savingSet.add(prepId);

    const item = prepItemsMap.get(prepId);
    if (!item) { savingSet.delete(prepId); return; }

    const currentVal = getLocalState(prepId, 'is_prepared', item.is_prepared);
    const newVal     = !currentVal;

    // Optimistic update
    setLocalState(prepId, { is_prepared: newVal, ...(newVal ? { has_issue: false } : {}) });
    refreshColorRowInPlace(prepId);
    updateProgressRing();

    const { error } = await supabase
        .from('order_item_preparation')
        .update({
            is_prepared: newVal,
            has_issue:   newVal ? false : getLocalState(prepId, 'has_issue', item.has_issue),
            updated_by:  currentUser.id
        })
        .eq('id', prepId);

    savingSet.delete(prepId);

    if (error) {
        // Rollback on error
        setLocalState(prepId, { is_prepared: currentVal });
        refreshColorRowInPlace(prepId);
        updateProgressRing();
        showToast('خطأ في الحفظ', 'error');
    }
}

// ============================================================
// 13. Toggle issue
// ============================================================
async function handleToggleIssue(prepId) {
    if (savingSet.has(prepId)) return;
    savingSet.add(prepId);

    const item = prepItemsMap.get(prepId);
    if (!item) { savingSet.delete(prepId); return; }

    const currentVal = getLocalState(prepId, 'has_issue', item.has_issue);
    const newVal     = !currentVal;

    setLocalState(prepId, { has_issue: newVal, ...(newVal ? { is_prepared: false } : {}) });
    refreshColorRowInPlace(prepId);
    updateProgressRing();

    const { error } = await supabase
        .from('order_item_preparation')
        .update({
            has_issue:   newVal,
            is_prepared: newVal ? false : getLocalState(prepId, 'is_prepared', item.is_prepared),
            updated_by:  currentUser.id
        })
        .eq('id', prepId);

    savingSet.delete(prepId);

    if (error) {
        setLocalState(prepId, { has_issue: currentVal });
        refreshColorRowInPlace(prepId);
        updateProgressRing();
        showToast('خطأ في الحفظ', 'error');
    }
}

// ============================================================
// 14. Update note
// ============================================================
async function handleNoteChange(prepId, noteValue) {
    if (!prepId) return;
    setLocalState(prepId, { note: noteValue });
    const { error } = await supabase
        .from('order_item_preparation')
        .update({ note: noteValue || null, updated_by: currentUser.id })
        .eq('id', prepId);
    if (error) showToast('خطأ في حفظ الملاحظة', 'error');
}

// ============================================================
// 15. In-place DOM update (no re-render of full card/view)
// ============================================================
function refreshColorRowInPlace(prepId) {
    const item = prepItemsMap.get(prepId);
    if (!item) return;

    // Find ALL elements with this prep_id (full view + card view may both exist)
    document.querySelectorAll(`[data-prep-id="${prepId}"].color-item`).forEach(rowEl => {
        const isPrepared = getLocalState(prepId, 'is_prepared', item.is_prepared);
        const hasIssue   = getLocalState(prepId, 'has_issue',   item.has_issue);

        // Row background
        rowEl.className = `color-item px-4 py-3 transition-all ${
            isPrepared ? 'bg-green-500/5 border-r-2 border-green-500/40' :
            hasIssue   ? 'bg-yellow-500/5 border-r-2 border-yellow-500/40' : ''
        }`;

        // Check button
        const checkBtn = rowEl.querySelector('[data-action="toggle-prepared"]');
        if (checkBtn) {
            checkBtn.className = `prep-toggle w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all touch-manipulation select-none ${
                isPrepared
                    ? 'bg-green-500 border-green-500 text-white shadow-lg shadow-green-900/30'
                    : 'border-devo-gray text-devo-gray hover:border-green-400 hover:text-green-400 active:border-green-500 active:bg-green-500/20'
            }`;
        }

        // Issue button
        const issueBtn = rowEl.querySelector('[data-action="toggle-issue"]');
        if (issueBtn) {
            issueBtn.className = `prep-toggle w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all touch-manipulation select-none ${
                hasIssue
                    ? 'bg-yellow-500 border-yellow-500 text-white shadow-lg shadow-yellow-900/30'
                    : 'border-devo-gray text-devo-gray hover:border-yellow-400 hover:text-yellow-400 active:border-yellow-500 active:bg-yellow-500/20'
            }`;
        }
    });

    // Update model header summary count (the prepared/issue counter in the model header)
    refreshModelHeaderCount(item.model_id);
}

function refreshModelHeaderCount(modelId) {
    const group = groupedByModel.find(g => g.model.model_id === modelId);
    if (!group) return;

    const prepared = group.colors.filter(c => getLocalState(c.prep_id, 'is_prepared', c.is_prepared)).length;
    const issues   = group.colors.filter(c => getLocalState(c.prep_id, 'has_issue',   c.has_issue)).length;
    const total    = group.colors.length;

    // Find a model card that belongs to this model
    const firstRow = document.querySelector(`.color-item[data-prep-id="${group.colors[0]?.prep_id}"]`);
    if (!firstRow) return;
    const modelCard = firstRow.closest('.bg-devo-dark.border.border-devo-gray.rounded-2xl');
    if (!modelCard) return;

    const countEl = modelCard.querySelector('.text-right.shrink-0');
    if (countEl) {
        countEl.innerHTML = `
            <p class="text-devo-muted"><span class="text-green-400 font-black text-base">${prepared}</span>/<span class="text-white">${total}</span> محضَّر</p>
            ${issues > 0 ? `<p class="text-yellow-400 font-bold">${issues} مشكلة</p>` : ''}`;
    }
}

// ============================================================
// 16. Local state management
// ============================================================
const localState = {}; // { [prep_id]: { is_prepared?, has_issue?, note? } }

function getLocalState(prepId, key, fallback) {
    return (localState[prepId] && localState[prepId][key] !== undefined)
        ? localState[prepId][key]
        : fallback;
}
function setLocalState(prepId, updates) {
    if (!localState[prepId]) localState[prepId] = {};
    Object.assign(localState[prepId], updates);
}

// ============================================================
// 17. Progress ring
// ============================================================
function updateProgressRing() {
    const total    = prepItems.length;
    const prepared = prepItems.filter(i => getLocalState(i.prep_id, 'is_prepared', i.is_prepared)).length;
    const pct      = total > 0 ? Math.round(prepared / total * 100) : 0;

    const circumference = 138.2;
    const offset = circumference - (pct / 100) * circumference;
    const ring = document.getElementById('prep-progress-ring');
    const pctEl = document.getElementById('prep-progress-pct');
    if (ring)  ring.style.strokeDashoffset = offset;
    if (pctEl) pctEl.textContent = pct + '%';
}

// ============================================================
// 18. Swipe navigation (card mode)
// ============================================================
function setupSwipeNavigation() {
    let touchStartX = 0;
    let touchStartY = 0;

    const prepCardContent = document.getElementById('prep-card-content');
    if (prepCardContent) {
        prepCardContent.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        prepCardContent.addEventListener('touchend', e => {
            if (viewMode !== 'card') return;
            const dx = touchStartX - e.changedTouches[0].screenX;
            const dy = Math.abs(touchStartY - e.changedTouches[0].screenY);
            if (Math.abs(dx) > 60 && Math.abs(dx) > dy * 1.5) {
                if (dx > 0) window.nextCard();
                else        window.prevCard();
            }
        }, { passive: true });
    }

    const auditCardContent = document.getElementById('audit-card-content');
    if (auditCardContent) {
        auditCardContent.addEventListener('touchstart', e => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        auditCardContent.addEventListener('touchend', e => {
            if (auditViewMode !== 'card') return;
            const dx = touchStartX - e.changedTouches[0].screenX;
            const dy = Math.abs(touchStartY - e.changedTouches[0].screenY);
            if (Math.abs(dx) > 60 && Math.abs(dx) > dy * 1.5) {
                if (dx > 0) window.nextAuditCard();
                else        window.prevAuditCard();
            }
        }, { passive: true });
    }
}

// ============================================================
// 19. Notes summary modal
// ============================================================
window.openNotesSummary = function() {
    const body = document.getElementById('notes-summary-body');
    const itemsWithNotes = prepItems.filter(i =>
        getLocalState(i.prep_id, 'has_issue', i.has_issue) ||
        (getLocalState(i.prep_id, 'note', i.prep_note) || '').trim()
    );

    if (itemsWithNotes.length === 0) {
        body.innerHTML = `<div class="text-center py-10 text-devo-muted">
            <i class="ph ph-check-circle text-5xl text-devo-success block mb-3 opacity-50"></i>
            لا توجد ملاحظات أو مشاكل مسجلة
        </div>`;
    } else {
        body.innerHTML = itemsWithNotes.map(i => {
            const note     = getLocalState(i.prep_id, 'note',      i.prep_note) || '';
            const hasIssue = getLocalState(i.prep_id, 'has_issue', i.has_issue);
            return `<div class="bg-devo-black border ${hasIssue ? 'border-yellow-500/30' : 'border-devo-gray'} rounded-xl p-4">
                <div class="flex items-center gap-2 mb-1">
                    ${hasIssue ? '<i class="ph ph-warning-circle text-yellow-400 text-lg"></i>' : '<i class="ph ph-note-pencil text-devo-orange text-lg"></i>'}
                    <div>
                        <span class="font-bold text-white">${i.model_name}</span>
                        <span class="text-sm text-devo-muted mr-1">— ${i.color_name}</span>
                    </div>
                </div>
                ${hasIssue ? '<p class="text-sm text-yellow-400 font-bold">⚠ مشكلة / نقص في هذا اللون</p>' : ''}
                ${note     ? `<p class="text-sm text-devo-muted mt-1">${note}</p>` : ''}
            </div>`;
        }).join('');
    }

    const modal = document.getElementById('notes-summary-modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        document.getElementById('notes-summary-sheet').classList.remove('translate-y-full');
    });
};

window.closeNotesSummary = function() {
    document.getElementById('notes-summary-sheet').classList.add('translate-y-full');
    setTimeout(() => document.getElementById('notes-summary-modal').classList.add('hidden'), 300);
};

// ============================================================
// 20. Finalize preparation
// ============================================================
window.finalizePreparation = function() {
    if (!currentOrder) return;

    const total     = prepItems.length;
    const prepared  = prepItems.filter(i => getLocalState(i.prep_id, 'is_prepared', i.is_prepared)).length;
    const issues    = prepItems.filter(i => getLocalState(i.prep_id, 'has_issue',   i.has_issue)).length;
    const remaining = total - prepared;

    const modal   = document.getElementById('finalize-modal');
    const title   = document.getElementById('finalize-modal-title');
    const message = document.getElementById('finalize-modal-message');
    const statusSel = document.getElementById('finalize-status-selector');

    if (remaining === 0) {
        title.textContent = '✓ اكتمل التحضير!';
        message.innerHTML = `تم تحضير جميع الألوان (<strong>${total}</strong> لون).<br>هل تريد حفظ الأوردر كـ "تم التحضير"؟`;
        statusSel.classList.add('hidden');
        document.getElementById('finalize-confirm-btn').dataset.targetStatus = 'prepared';
    } else {
        title.textContent = 'حفظ غير مكتمل';
        message.innerHTML = `<span class="text-yellow-400 font-bold">${remaining} لون</span> لم يتم تحضيرها بعد.
            ${issues > 0 ? `<br><span class="text-red-400">${issues} لون به مشكلة أو نقص.</span>` : ''}`;
        statusSel.classList.remove('hidden');
        document.getElementById('finalize-status-select').value = issues > 0 ? 'on_hold' : 'in_progress';
        document.getElementById('finalize-confirm-btn').dataset.targetStatus = '';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
};

window.closeFinalizeModal = function() {
    const modal = document.getElementById('finalize-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex', 'items-center', 'justify-center', 'p-4');
};

window.confirmFinalize = async function() {
    if (isFinalizing || !currentOrder) return;
    isFinalizing = true;

    const btn = document.getElementById('finalize-confirm-btn');
    const targetStatus = btn.dataset.targetStatus ||
        document.getElementById('finalize-status-select')?.value || 'in_progress';

    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1"></i> جاري الحفظ...';

    const { data, error } = await supabase.rpc('finalize_order_preparation', {
        p_order_id:   currentOrder.id,
        p_worker_id:  currentUser.id,
        p_new_status: targetStatus,
        p_note:       null
    });

    isFinalizing = false;
    btn.disabled = false;
    btn.innerHTML = 'تأكيد الحفظ';
    closeFinalizeModal();

    if (error) { showToast('خطأ: ' + error.message, 'error'); return; }
    if (data?.success === false) { showToast(data.error || 'لا يمكن إتمام العملية', 'error'); return; }

    showToast('تم حفظ التحضير بنجاح ✓', 'success');
    window.goToOrderList();
};

// ============================================================
// 21. Screen switch
// ============================================================
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId)?.classList.add('active');
}

// ============================================================
// 22. Realtime
// ============================================================
function setupRealtimeOrders() {
    supabase.channel('wh_orders_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
            await loadOrderList();
        })
        .subscribe();
}

// ============================================================
// 23. Toast
// ============================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('wh-toast-container');
    const toast = document.createElement('div');
    const colors = { success: 'bg-devo-success', error: 'bg-devo-error', info: 'bg-blue-600' };
    toast.className = `${colors[type] || colors.info} text-white px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold
        opacity-0 transition-opacity duration-300 flex items-center gap-2 pointer-events-none`;
    const icon = type === 'success' ? 'ph-check-circle' : type === 'error' ? 'ph-warning-circle' : 'ph-info';
    toast.innerHTML = `<i class="ph ${icon} text-lg"></i> ${message}`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.remove('opacity-0'));
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// 24. Smart Inventory Audit Logic
// ============================================================

window.switchWHScreen = function(screenName) {
    const ordersScreen = document.getElementById('screen-orders');
    const auditScreen = document.getElementById('screen-audit');
    const navOrders = document.getElementById('nav-btn-orders');
    const navAudit = document.getElementById('nav-btn-audit');
    
    document.body.classList.remove('focus-mode');
    
    document.getElementById('screen-preparation').classList.remove('active');
    document.getElementById('btn-back-to-list').classList.add('hidden');
    document.getElementById('wh-bottom-nav').classList.remove('hidden');

    if (screenName === 'orders') {
        ordersScreen.classList.add('active');
        ordersScreen.classList.remove('hidden');
        auditScreen.classList.remove('active');
        auditScreen.classList.add('hidden');
        
        navOrders.classList.add('text-devo-orange');
        navOrders.classList.remove('text-devo-muted');
        navAudit.classList.add('text-devo-muted');
        navAudit.classList.remove('text-devo-orange');
        
        loadOrderList();
    } else if (screenName === 'audit') {
        ordersScreen.classList.remove('active');
        ordersScreen.classList.add('hidden');
        auditScreen.classList.add('active');
        auditScreen.classList.remove('hidden');
        
        navAudit.classList.add('text-devo-orange');
        navAudit.classList.remove('text-devo-muted');
        navOrders.classList.add('text-devo-muted');
        navOrders.classList.remove('text-devo-orange');
        
        initAuditView();
    }
};

async function initAuditView() {
    document.getElementById('btn-back-to-list').classList.add('hidden');
    
    // Reset view visibility
    document.getElementById('audit-sessions-view').classList.remove('hidden');
    document.getElementById('audit-work-view').classList.add('hidden');
    
    await loadAuditSessions();
}

async function loadAuditSessions() {
    const listContainer = document.getElementById('audit-sessions-list');
    if (!listContainer) return;
    
    const { data, error } = await supabase
        .from('inventory_audits')
        .select(`
            id, audit_number, status, notes, created_at,
            system_users!created_by(full_name),
            inventory_audit_items(id)
        `)
        .eq('status', 'draft')
        .order('created_at', { ascending: false });
        
    if (error) {
        showToast("خطأ أثناء تحميل جلسات الجرد: " + error.message, "error");
        console.error(error);
        listContainer.innerHTML = `<div class="text-center py-10 text-devo-error">فشل تحميل جلسات الجرد.</div>`;
        return;
    }
    
    if (!data || data.length === 0) {
        listContainer.innerHTML = `
            <div class="text-center py-12 bg-devo-dark border border-devo-gray rounded-2xl p-6">
                <i class="ph ph-clipboard-x text-4xl text-devo-muted block mb-2 opacity-40"></i>
                <p class="text-sm font-bold text-white mb-1">لا توجد جلسات جرد مكلفة حالياً</p>
                <p class="text-xs text-devo-muted">سيظهر هنا أي أمر جرد جديد يتم إنشاؤه من الإدارة.</p>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = data.map(s => {
        const dateStr = new Date(s.created_at).toLocaleString('ar-EG', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const itemsCount = s.inventory_audit_items?.length || 0;
        
        return `
            <div class="bg-devo-dark border border-devo-gray rounded-2xl p-4 flex flex-col gap-3 shadow-lg hover:border-devo-orange/50 transition-colors">
                <div class="flex items-center justify-between">
                    <div>
                        <h4 class="font-mono font-black text-white text-sm">${s.audit_number}</h4>
                        <p class="text-[10px] text-devo-muted">تاريخ التكليف: ${dateStr}</p>
                    </div>
                    <span class="bg-devo-orange/20 text-devo-orange text-[10px] px-2 py-0.5 rounded font-bold">بانتظار البدء</span>
                </div>
                
                <div class="text-xs text-white bg-devo-black/30 p-2.5 rounded-lg">
                    <span class="text-devo-muted block text-[10px] mb-0.5">ملاحظات الإدارة:</span>
                    ${s.notes || 'لا توجد ملاحظات.'}
                </div>
                
                <div class="flex items-center justify-between border-t border-devo-gray/50 pt-3 mt-1">
                    <span class="text-xs text-devo-muted font-bold">${itemsCount} صنف مطلوب جرده</span>
                    <button onclick="window.startActiveAudit('${s.id}')" class="bg-devo-orange hover:bg-devo-orangeHover text-white px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1">
                        <i class="ph ph-play"></i> ابدأ الجرد الآن
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

window.startActiveAudit = async function(sessionId) {
    const { data, error } = await supabase
        .from('inventory_audits')
        .select(`
            id, audit_number, notes, status,
            inventory_audit_items(
                id, model_id, color_id, system_qty, counted_qty, difference,
                models(name, factory_code, system_code),
                colors(name)
            )
        `)
        .eq('id', sessionId)
        .single();
        
    if (error) {
        showToast("فشل تحميل تفاصيل جلسة الجرد", "error");
        console.error(error);
        return;
    }
    
    activeAuditSession = data;
    
    auditItems = data.inventory_audit_items.map(item => ({
        id: item.id,
        model_id: item.model_id,
        model_name: item.models?.name || 'غير معروف',
        factory_code: item.models?.factory_code || '',
        system_code: item.models?.system_code || '',
        color_id: item.color_id,
        color_name: item.colors?.name || 'غير معروف',
        system_qty: item.system_qty,
        counted_qty: item.counted_qty || 0,
        difference: (item.counted_qty || 0) - item.system_qty
    }));
    
    // Save original states for exit/discard confirmation
    originalAuditStates.clear();
    auditItems.forEach(item => {
        originalAuditStates.set(item.id, item.counted_qty);
    });
    
    if (auditModels.length === 0) {
        await fetchAuditModels();
    }
    
    buildAuditGroupedByModel();
    
    document.getElementById('audit-active-title').textContent = `جلسة جرد رقم: ${data.audit_number}`;
    document.getElementById('audit-active-subtitle').textContent = `ملاحظات: ${data.notes || '—'}`;
    
    document.getElementById('audit-sessions-view').classList.add('hidden');
    document.getElementById('audit-work-view').classList.remove('hidden');
    
    setAuditViewMode('full');
};

window.backToAuditSessions = function() {
    if (activeAuditSession && isAuditModified()) {
        const modal = document.getElementById('audit-exit-confirm-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        document.body.classList.remove('focus-mode');
        activeAuditSession = null;
        auditItems = [];
        document.getElementById('audit-notes').value = '';
        document.getElementById('audit-search-input').value = '';
        
        document.getElementById('audit-sessions-view').classList.remove('hidden');
        document.getElementById('audit-work-view').classList.add('hidden');
        
        loadAuditSessions();
    }
};

async function fetchAuditModels() {
    const { data, error } = await supabase
        .from('models')
        .select(`
            id, name, factory_code, system_code, is_active,
            model_inventory (
                color_id, available_series,
                colors (id, name, color_code)
            )
        `)
        .eq('is_active', true);
    
    if (error) {
        showToast("فشل تحميل الموديلات للجرد", "error");
        console.error(error);
        return;
    }
    auditModels = data || [];
}

window.editAuditItem = function(index) {
    const item = auditItems[index];
    if (!item) return;
    
    currentAuditModel = auditModels.find(m => m.id === item.model_id);
    currentAuditColor = item.color_id;
    
    document.getElementById('audit-modal-model-title').textContent = item.model_name;
    document.getElementById('audit-modal-qty-input').value = item.counted_qty;
    document.getElementById('audit-modal-system-qty').textContent = item.system_qty + ' سيرية';
    
    const colorsGrid = document.getElementById('audit-modal-colors-grid');
    colorsGrid.innerHTML = `
        <button type="button" class="audit-color-btn border border-devo-orange bg-devo-orange/10 rounded-xl p-2.5 text-center text-xs text-white font-bold w-full truncate">
            ${item.color_name}
        </button>
    `;
    
    const modal = document.getElementById('audit-color-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex', 'items-center', 'justify-center', 'p-4');
};

window.closeAuditColorModal = function() {
    const modal = document.getElementById('audit-color-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex', 'items-center', 'justify-center', 'p-4');
    currentAuditModel = null;
    currentAuditColor = null;
};

window.adjustAuditModalQty = function(amount) {
    const input = document.getElementById('audit-modal-qty-input');
    let val = parseInt(input.value) || 0;
    val = Math.max(0, val + amount);
    input.value = val;
};

window.saveAuditItem = function() {
    if (!currentAuditModel || !currentAuditColor) return;
    
    const qtyInput = document.getElementById('audit-modal-qty-input');
    const countedQty = parseInt(qtyInput.value);
    if (isNaN(countedQty) || countedQty < 0) {
        return showToast("يرجى إدخال كمية صحيحة", "warning");
    }
    
    const index = auditItems.findIndex(i => i.model_id === currentAuditModel.id && i.color_id === currentAuditColor);
    if (index > -1) {
        auditItems[index].counted_qty = countedQty;
        auditItems[index].difference = countedQty - auditItems[index].system_qty;
        
        showToast("تم تحديث كمية الجرد بنجاح", "success");
        closeAuditColorModal();
        renderAuditTable();
    }
};

function renderAuditTable() {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;
    
    const query = document.getElementById('audit-search-input')?.value.trim().toLowerCase() || '';
    
    const filteredItems = auditItems.filter(item => {
        if (!query) return true;
        return item.model_name.toLowerCase().includes(query) ||
               item.factory_code.toLowerCase().includes(query) ||
               item.system_code.toLowerCase().includes(query) ||
               item.color_name.toLowerCase().includes(query);
    });
    
    if (filteredItems.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="p-8 text-center text-devo-muted">
                    لا توجد أصناف مطابقة للبحث في هذه الجلسة.
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = filteredItems.map((item) => {
        const itemIdx = auditItems.findIndex(x => x.model_id === item.model_id && x.color_id === item.color_id);
        let diffBadge = '';
        if (item.difference === 0) {
            diffBadge = `<span class="bg-devo-success/20 text-devo-success px-2 py-0.5 rounded font-bold">0</span>`;
        } else if (item.difference > 0) {
            diffBadge = `<span class="bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-bold">+${item.difference}</span>`;
        } else {
            diffBadge = `<span class="bg-devo-error/20 text-devo-error px-2 py-0.5 rounded font-bold">${item.difference}</span>`;
        }
        
        return `
            <tr class="hover:bg-devo-gray/10 transition-colors border-b border-devo-gray/40 last:border-0">
                <td class="p-2.5">
                    <p class="font-bold text-white">${item.model_name}</p>
                    <p class="text-[10px] text-devo-muted">${item.color_name} | كود: ${item.factory_code || item.system_code || '-'}</p>
                </td>
                <td class="p-2.5 text-center font-bold text-devo-muted">${item.system_qty}</td>
                <td class="p-2.5 text-center font-bold text-white">${item.counted_qty}</td>
                <td class="p-2.5 text-center">${diffBadge}</td>
                <td class="p-2.5 text-center">
                    <button onclick="window.editAuditItem(${itemIdx})" class="bg-devo-orange hover:bg-devo-orangeHover text-white px-2 py-1.5 rounded-lg text-[10px] font-bold">
                        تعديل
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

window.submitAuditReport = async function() {
    if (!activeAuditSession) return;
    
    const notes = document.getElementById('audit-notes').value.trim();
    
    const submitBtn = document.querySelector('#screen-audit button[onclick="submitAuditReport()"]');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1"></i> جاري الحفظ والتقديم...';
    
    for (const item of auditItems) {
        const { error } = await supabase
            .from('inventory_audit_items')
            .update({
                counted_qty: item.counted_qty,
                difference: item.counted_qty - item.system_qty
            })
            .eq('id', item.id);
            
        if (error) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="ph ph-paper-plane-tilt text-lg"></i> تقديم وإتمام الجرد للمراجعة';
            showToast("حدث خطأ أثناء تحديث الأصناف: " + error.message, "error");
            console.error(error);
            return;
        }
    }
    
    const { error } = await supabase
        .from('inventory_audits')
        .update({
            status: 'submitted',
            notes: notes
        })
        .eq('id', activeAuditSession.id);
        
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="ph ph-paper-plane-tilt text-lg"></i> تقديم وإتمام الجرد للمراجعة';
    
    if (error) {
        showToast("حدث خطأ أثناء إرسال الجلسة: " + error.message, "error");
        console.error(error);
        return;
    }
    
    showToast("تم إرسال تقرير الجرد بنجاح للمراجعة ✓", "success");
    window.backToAuditSessions();
};

// ============================================================
// Audit view mode switch & cards logic
// ============================================================
window.setAuditViewMode = function(mode) {
    auditViewMode = mode;
    const fullView = document.getElementById('audit-full-view');
    const cardView = document.getElementById('audit-card-view');
    
    const header = document.querySelector('body > header');
    const bottomNav = document.getElementById('wh-bottom-nav');
    
    const auditHeaderInfo = document.getElementById('audit-header-info');
    const auditModeSelector = document.getElementById('audit-mode-selector');
    const auditSearchContainer = document.getElementById('audit-search-container');
    const auditBottomActions = document.getElementById('audit-bottom-actions');

    const activeClass = 'audit-view-mode-btn flex-1 py-3 rounded-xl text-sm font-bold transition-colors bg-devo-orange text-white flex items-center justify-center gap-2';
    const idleClass   = 'audit-view-mode-btn flex-1 py-3 rounded-xl text-sm font-bold transition-colors bg-devo-gray text-devo-muted flex items-center justify-center gap-2';

    document.getElementById('audit-btn-mode-full').className = mode === 'full' ? activeClass : idleClass;
    document.getElementById('audit-btn-mode-card').className = mode === 'card' ? activeClass : idleClass;

    if (mode === 'full') {
        fullView.classList.remove('hidden');
        cardView.classList.add('hidden');
        
        header?.classList.remove('hidden');
        bottomNav?.classList.remove('hidden');
        auditHeaderInfo?.classList.remove('hidden');
        auditModeSelector?.classList.remove('hidden');
        auditSearchContainer?.classList.remove('hidden');
        auditBottomActions?.classList.remove('hidden');
        
        renderAuditTable();
    } else {
        fullView.classList.add('hidden');
        cardView.classList.remove('hidden');
        
        header?.classList.add('hidden');
        bottomNav?.classList.add('hidden');
        auditHeaderInfo?.classList.add('hidden');
        auditModeSelector?.classList.add('hidden');
        auditSearchContainer?.classList.add('hidden');
        auditBottomActions?.classList.add('hidden');
        
        currentAuditCardIndex = 0;
        renderAuditCardView();
    }
};

function buildAuditGroupedByModel() {
    const map = new Map();
    const query = document.getElementById('audit-search-input')?.value.trim().toLowerCase() || '';
    
    auditItems.forEach(item => {
        if (query) {
            const match = item.model_name.toLowerCase().includes(query) ||
                          item.factory_code.toLowerCase().includes(query) ||
                          item.system_code.toLowerCase().includes(query) ||
                          item.color_name.toLowerCase().includes(query);
            if (!match) return;
        }

        const groupKey = `${item.model_name}_${item.factory_code || ''}`;

        if (!map.has(groupKey)) {
            map.set(groupKey, {
                model_name: item.model_name,
                factory_code: item.factory_code,
                system_code: item.system_code,
                colors: []
            });
        }
        map.get(groupKey).colors.push(item);
    });
    auditGroupedByModel = Array.from(map.values());
}

function renderAuditCardView() {
    if (auditGroupedByModel.length === 0) {
        document.getElementById('audit-card-content').innerHTML = `
            <div class="text-center py-16 text-devo-muted">
                <i class="ph ph-package text-5xl block mb-3 opacity-30"></i>
                <p>لا توجد عناصر للمطابقة</p>
            </div>
        `;
        return;
    }

    const total = auditGroupedByModel.length;
    currentAuditCardIndex = Math.max(0, Math.min(currentAuditCardIndex, total - 1));

    const counter = document.getElementById('audit-card-counter');
    if (counter) {
        counter.innerHTML = `<span dir="ltr">${currentAuditCardIndex + 1} / ${total}</span>`;
    }

    const btnPrev = document.getElementById('btn-prev-audit-card');
    const btnNext = document.getElementById('btn-next-audit-card');
    if (btnPrev) btnPrev.disabled = currentAuditCardIndex === 0;
    if (btnNext) btnNext.disabled = currentAuditCardIndex === total - 1;

    const content = document.getElementById('audit-card-content');
    content.innerHTML = buildAuditModelCardHTML(auditGroupedByModel[currentAuditCardIndex]);
}

function buildAuditModelCardHTML(g) {
    const colorRows = g.colors.map(c => {
        const itemIdx = auditItems.findIndex(x => x.model_id === c.model_id && x.color_id === c.color_id);
        
        let diffClass = '';
        let diffVal = c.difference;
        if (c.difference === 0) {
            diffClass = 'bg-devo-success/15 border-devo-success/40 text-devo-success';
            diffVal = 'مظبوط';
        } else if (c.difference > 0) {
            diffClass = 'bg-blue-500/15 border-blue-500/40 text-blue-400';
            diffVal = `+${c.difference}`;
        } else {
            diffClass = 'bg-devo-error/15 border-devo-error/40 text-devo-error';
            diffVal = c.difference;
        }

        return `
            <div class="px-4 py-4.5 bg-devo-black/10 hover:bg-devo-black/20 transition-all">
                <div class="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                    <!-- Color info & metadata -->
                    <div class="flex-1 min-w-0">
                        <span class="font-black text-white text-base block mb-1.5">${c.color_name}</span>
                        <div class="flex items-center gap-2.5 flex-wrap">
                            <!-- System Qty Badge -->
                            <span class="bg-devo-gray/40 text-devo-muted px-2.5 py-1 rounded-xl font-bold text-xs border border-devo-gray/60">
                                السيستم: <span class="text-white font-black">${c.system_qty}</span>
                            </span>
                            <!-- Difference Badge -->
                            <span class="px-2.5 py-1 rounded-xl font-bold text-xs border ${diffClass}">
                                الفارق: <span class="font-black">${diffVal}</span>
                            </span>
                        </div>
                    </div>
                    
                    <!-- Qty adjustments -->
                    <div class="flex items-center gap-3 shrink-0">
                        <button onclick="window.adjustAuditItemQty(${itemIdx}, -1)" 
                            class="w-12 h-12 bg-devo-gray hover:bg-devo-gray/70 text-white rounded-2xl flex items-center justify-center font-bold text-xl select-none transition-all touch-manipulation shadow-md">
                            <i class="ph ph-minus"></i>
                        </button>
                        <div class="relative">
                            <input type="number" value="${c.counted_qty}" 
                                onchange="window.setAuditItemQty(${itemIdx}, this.value)" 
                                class="w-20 bg-devo-black border border-devo-gray rounded-2xl text-center py-3 text-white text-base focus:border-devo-orange outline-none font-black shadow-inner" 
                                min="0">
                            <span class="absolute -top-2 left-1/2 -translate-x-1/2 bg-devo-orange text-[9px] text-white px-1.5 py-0.5 rounded-full font-bold shadow-sm">الفعلي</span>
                        </div>
                        <button onclick="window.adjustAuditItemQty(${itemIdx}, 1)" 
                            class="w-12 h-12 bg-devo-orange hover:bg-devo-orangeHover text-white rounded-2xl flex items-center justify-center font-bold text-xl select-none transition-all touch-manipulation shadow-md">
                            <i class="ph ph-plus"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden mb-3 shadow-xl">
            <div class="flex items-center gap-3 px-4 py-4.5 bg-devo-black/40 border-b border-devo-gray">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-black text-white text-base">${g.model_name}</span>
                        <span class="text-xs font-mono text-devo-orange bg-devo-orange/10 px-2 py-0.5 rounded-md">${g.factory_code || g.system_code}</span>
                    </div>
                </div>
            </div>
            <div class="divide-y divide-devo-gray/30">${colorRows}</div>
        </div>
    `;
}

window.adjustAuditItemQty = function(itemIdx, amount) {
    const item = auditItems[itemIdx];
    if (!item) return;
    item.counted_qty = Math.max(0, item.counted_qty + amount);
    item.difference = item.counted_qty - item.system_qty;
    
    buildAuditGroupedByModel();
    renderAuditCardView();
};

window.setAuditItemQty = function(itemIdx, val) {
    const item = auditItems[itemIdx];
    if (!item) return;
    let parsed = parseInt(val);
    if (isNaN(parsed) || parsed < 0) parsed = 0;
    item.counted_qty = parsed;
    item.difference = item.counted_qty - item.system_qty;
    
    buildAuditGroupedByModel();
    renderAuditCardView();
};

window.nextAuditCard = function() {
    if (currentAuditCardIndex < auditGroupedByModel.length - 1) {
        currentAuditCardIndex++;
        renderAuditCardView();
        document.getElementById('audit-card-content').scrollTop = 0;
    }
};

window.prevAuditCard = function() {
    if (currentAuditCardIndex > 0) {
        currentAuditCardIndex--;
        renderAuditCardView();
        document.getElementById('audit-card-content').scrollTop = 0;
    }
};

// ============================================================
// Exit / Discard / Save Draft & Restart Helpers
// ============================================================
function isPrepModified() {
    for (const item of prepItems) {
        const orig = originalPrepStates.get(item.prep_id);
        if (!orig) continue;
        const currPrepared = getLocalState(item.prep_id, 'is_prepared', item.is_prepared);
        const currIssue = getLocalState(item.prep_id, 'has_issue', item.has_issue);
        const currNote = getLocalState(item.prep_id, 'note', item.prep_note) || '';
        if (currPrepared !== orig.is_prepared || currIssue !== orig.has_issue || currNote !== orig.note) {
            return true;
        }
    }
    return false;
}

window.closeExitConfirmModal = function() {
    const modal = document.getElementById('exit-confirm-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.exitConfirmDiscardPrep = function() {
    const modal = document.getElementById('discard-confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeDiscardConfirmModal = function() {
    const modal = document.getElementById('discard-confirm-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.goToOrderList = function() {
    if (isPrepModified()) {
        const modal = document.getElementById('exit-confirm-modal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } else {
        currentOrder = null;
        document.body.classList.remove('focus-mode');
        window.switchWHScreen('orders');
    }
};

window.exitDiscardPrep = async function() {
    showToast('جاري التراجع عن التغييرات...', 'info');
    for (const item of prepItems) {
        const orig = originalPrepStates.get(item.prep_id);
        if (!orig) continue;
        
        await supabase
            .from('order_item_preparation')
            .update({
                is_prepared: orig.is_prepared,
                has_issue: orig.has_issue,
                note: orig.note || null,
                updated_by: currentUser.id
            })
            .eq('id', item.prep_id);
            
        setLocalState(item.prep_id, {
            is_prepared: orig.is_prepared,
            has_issue: orig.has_issue,
            note: orig.note
        });
    }
    
    window.closeDiscardConfirmModal();
    window.closeExitConfirmModal();
    
    currentOrder = null;
    document.body.classList.remove('focus-mode');
    window.switchWHScreen('orders');
};

function isAuditModified() {
    for (const item of auditItems) {
        const origQty = originalAuditStates.get(item.id) || 0;
        if (item.counted_qty !== origQty) {
            return true;
        }
    }
    return false;
}

window.closeAuditExitConfirmModal = function() {
    const modal = document.getElementById('audit-exit-confirm-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.exitConfirmDiscardAudit = function() {
    const modal = document.getElementById('audit-discard-confirm-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
};

window.closeAuditDiscardConfirmModal = function() {
    const modal = document.getElementById('audit-discard-confirm-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
};

window.exitSaveAudit = async function() {
    window.closeAuditExitConfirmModal();
    await window.saveAuditDraftProgress();
    
    document.body.classList.remove('focus-mode');
    activeAuditSession = null;
    auditItems = [];
    document.getElementById('audit-notes').value = '';
    document.getElementById('audit-search-input').value = '';
    document.getElementById('audit-sessions-view').classList.remove('hidden');
    document.getElementById('audit-work-view').classList.add('hidden');
    loadAuditSessions();
};

window.exitDiscardAudit = function() {
    auditItems.forEach(item => {
        const origQty = originalAuditStates.get(item.id) || 0;
        item.counted_qty = origQty;
        item.difference = origQty - item.system_qty;
    });
    
    window.closeAuditDiscardConfirmModal();
    window.closeAuditExitConfirmModal();
    
    document.body.classList.remove('focus-mode');
    activeAuditSession = null;
    auditItems = [];
    document.getElementById('audit-notes').value = '';
    document.getElementById('audit-search-input').value = '';
    document.getElementById('audit-sessions-view').classList.remove('hidden');
    document.getElementById('audit-work-view').classList.add('hidden');
    loadAuditSessions();
};

window.saveAuditDraftProgress = async function() {
    if (!activeAuditSession) return;
    
    const saveBtn = document.querySelector('#audit-bottom-actions button[onclick="window.saveAuditDraftProgress()"]');
    let origHtml = '';
    if (saveBtn) {
        origHtml = saveBtn.innerHTML;
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...';
    }
    
    for (const item of auditItems) {
        await supabase
            .from('inventory_audit_items')
            .update({
                counted_qty: item.counted_qty,
                difference: item.difference
            })
            .eq('id', item.id);
    }
    
    const notes = document.getElementById('audit-notes').value.trim();
    await supabase
        .from('inventory_audits')
        .update({ notes: notes })
        .eq('id', activeAuditSession.id);
        
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = origHtml;
    }
    
    showToast("تم حفظ مسودة الجرد بنجاح ✓", "success");
    
    auditItems.forEach(item => {
        originalAuditStates.set(item.id, item.counted_qty);
    });
};

window.confirmRestartPreparation = async function() {
    const ok = await confirmDialog({
        title: 'إعادة بدء التحضير',
        message: 'هل أنت متأكد من إعادة بدء التحضير من جديد؟ سيتم مسح جميع العلامات والملاحظات المسجلة لهذا الأوردر.',
        confirmText: 'إعادة البدء',
        cancelText: 'إلغاء',
        isDestructive: true
    });
    if (!ok) return;
    window.restartPreparation();
};

window.restartPreparation = async function() {
    if (!currentOrder) return;
    
    showToast("جاري إعادة التهيئة...", "info");
    for (const item of prepItems) {
        await supabase
            .from('order_item_preparation')
            .update({
                is_prepared: false,
                has_issue: false,
                note: null,
                updated_by: currentUser.id
            })
            .eq('id', item.prep_id);
            
        setLocalState(item.prep_id, {
            is_prepared: false,
            has_issue: false,
            note: ''
        });
    }
    
    await loadPrepItems(currentOrder.id);
    if (viewMode === 'full') renderFullView();
    else renderCardView();
    
    showToast("تم إعادة بدء التحضير بنجاح", "success");
};

window.confirmRestartAudit = async function() {
    const ok = await confirmDialog({
        title: 'إعادة بدء الجرد',
        message: 'هل أنت متأكد من إعادة بدء الجرد من جديد؟ سيتم تصفير الكميات الفعلية المسجلة لجميع الأصناف.',
        confirmText: 'إعادة البدء',
        cancelText: 'إلغاء',
        isDestructive: true
    });
    if (!ok) return;
    window.restartAudit();
};

window.restartAudit = function() {
    auditItems.forEach(item => {
        item.counted_qty = 0;
        item.difference = -item.system_qty;
    });
    
    buildAuditGroupedByModel();
    if (auditViewMode === 'full') renderAuditTable();
    else renderAuditCardView();
    
    showToast("تم تصفير كميات الجرد بنجاح", "success");
};
