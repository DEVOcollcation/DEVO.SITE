import { supabase } from '../../config/supabase.js';

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
// Boot
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    const sessionStr = localStorage.getItem('devo_session');
    if (!sessionStr) { window.location.href = 'auth.html'; return; }
    try { currentUser = JSON.parse(sessionStr); }
    catch(e) { window.location.href = 'auth.html'; return; }

    document.getElementById('wh-worker-name').textContent = currentUser.full_name;
    document.getElementById('wh-worker-name').classList.remove('hidden');

    await loadOrderList();
    setupRealtimeOrders();
    setupEventDelegation();   // ← replaces all inline onclick on color rows
    setupSwipeNavigation();   // ← swipe left/right for card mode
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
    showScreen('screen-orders');
    document.getElementById('btn-back-to-list').classList.add('hidden');
    currentOrder = null;
    loadOrderList();
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
        if (!map.has(item.model_id)) map.set(item.model_id, { model: item, colors: [] });
        map.get(item.model_id).colors.push(item);
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
        fullView.classList.remove('hidden');
        cardView.classList.add('hidden');
        renderFullView();
    } else {
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

    const rowBg = isPrepared ? 'bg-green-500/5 border-r-2 border-green-500/40'
                : hasIssue   ? 'bg-yellow-500/5 border-r-2 border-yellow-500/40' : '';

    // ★ NO JSON.stringify, NO inline event handlers with data ★
    // Only data-prep-id + data-action → handled by event delegation
    return `<div class="color-item px-4 py-3 transition-all ${rowBg}" data-prep-id="${c.prep_id}">
        <div class="flex items-center gap-3">

            <!-- Toggle buttons (event delegation handles clicks) -->
            <div class="flex gap-2 shrink-0">
                <button
                    data-action="toggle-prepared"
                    data-prep-id="${c.prep_id}"
                    class="prep-toggle w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all touch-manipulation select-none
                           ${isPrepared
                               ? 'bg-green-500 border-green-500 text-white shadow-lg shadow-green-900/30'
                               : 'border-devo-gray text-devo-gray hover:border-green-400 hover:text-green-400 active:border-green-500 active:bg-green-500/20'}"
                    title="تم التحضير">
                    <i class="ph ph-check text-lg pointer-events-none"></i>
                </button>
                <button
                    data-action="toggle-issue"
                    data-prep-id="${c.prep_id}"
                    class="prep-toggle w-11 h-11 rounded-full border-2 flex items-center justify-center transition-all touch-manipulation select-none
                           ${hasIssue
                               ? 'bg-yellow-500 border-yellow-500 text-white shadow-lg shadow-yellow-900/30'
                               : 'border-devo-gray text-devo-gray hover:border-yellow-400 hover:text-yellow-400 active:border-yellow-500 active:bg-yellow-500/20'}"
                    title="مشكلة / نقص">
                    <i class="ph ph-warning text-lg pointer-events-none"></i>
                </button>
            </div>

            <!-- Color info -->
            <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                    <div>
                        <span class="font-bold text-white">${c.color_name}</span>
                        ${c.color_code ? `<span class="text-xs text-devo-muted mr-1">(${c.color_code})</span>` : ''}
                    </div>
                    <span class="text-sm font-black text-devo-orange shrink-0">${c.required_qty} سيرية</span>
                </div>
                <input
                    type="text"
                    value="${escapeAttr(note)}"
                    placeholder="ملاحظة على هذا اللون..."
                    data-action="note"
                    data-prep-id="${c.prep_id}"
                    class="mt-2 w-full bg-devo-black border border-devo-gray/60 rounded-xl px-3 py-2
                           text-sm text-white placeholder-devo-gray/60 focus:border-devo-orange outline-none transition-colors">
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

    const cardContent = document.getElementById('prep-card-content');
    if (!cardContent) return;

    cardContent.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    cardContent.addEventListener('touchend', e => {
        if (viewMode !== 'card') return;
        const dx = touchStartX - e.changedTouches[0].screenX;
        const dy = Math.abs(touchStartY - e.changedTouches[0].screenY);

        // Only horizontal swipes (dx > dy threshold)
        if (Math.abs(dx) > 60 && Math.abs(dx) > dy * 1.5) {
            if (dx > 0) window.nextCard(); // swipe left → next model
            else        window.prevCard(); // swipe right → prev model
        }
    }, { passive: true });
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
};

window.closeFinalizeModal = function() {
    document.getElementById('finalize-modal').classList.add('hidden');
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
