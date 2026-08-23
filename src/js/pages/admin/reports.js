import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { printHtmlInIframe } from '../../utils/print.js';

// --- State Management ---
let isInitialized = false;
let currentTab = 'sales'; // 'sales' | 'deposits' | 'inventory' | 'models' | 'staff'

// Cached Data
let rawOrders = [];
let rawModels = [];
let rawInventory = [];
let rawUsers = [];
let rawDefinitions = {
    categories: [],
    classes: [],
    colors: []
};

// Filtered Data Collections
let filteredSalesData = [];
let filteredDepositsData = [];
let filteredInventoryData = [];
let filteredModelsData = [];
let filteredStaffData = [];

// Realtime channels
let reportsRealtimeChannel = null;

// ==========================================
// 🚀 Main Initialization
// ==========================================
export async function initReportsView(targetSubTab = null) {
    if (!isInitialized) {
        setupEventListeners();
        setupRealtimeSubscription();
        isInitialized = true;
    }

    if (targetSubTab && ['sales', 'deposits', 'inventory', 'models', 'staff'].includes(targetSubTab)) {
        switchReportTab(targetSubTab);
    } else {
        switchReportTab(currentTab);
    }

    await loadDefinitions();
    await fetchReportsData();
}

// ==========================================
// 🔀 Sub-Tab Switching Logic
// ==========================================
export function switchReportTab(tabName) {
    currentTab = tabName;

    // Update Tab Buttons UI
    const tabButtons = document.querySelectorAll('.reports-tab-btn');
    tabButtons.forEach(btn => {
        const tab = btn.getAttribute('data-report-tab');
        if (tab === tabName) {
            btn.classList.remove('text-devo-muted', 'bg-transparent', 'border-transparent');
            btn.classList.add('text-white', 'bg-devo-orange', 'border-devo-orange', 'shadow-md', 'shadow-devo-orange/20');
        } else {
            btn.classList.remove('text-white', 'bg-devo-orange', 'border-devo-orange', 'shadow-md', 'shadow-devo-orange/20');
            btn.classList.add('text-devo-muted', 'bg-devo-dark', 'border-devo-gray');
        }
    });

    // Update Tab Content Panels
    const tabPanels = document.querySelectorAll('.reports-tab-panel');
    tabPanels.forEach(panel => {
        if (panel.id === `reports-panel-${tabName}`) {
            panel.classList.remove('hidden');
        } else {
            panel.classList.add('hidden');
        }
    });

    // Also highlight sidebar sublink if exists
    const sublinks = document.querySelectorAll('.report-sublink');
    sublinks.forEach(link => {
        if (link.getAttribute('data-report-tab') === tabName) {
            link.classList.remove('text-devo-muted');
            link.classList.add('text-devo-orange', 'bg-devo-orange/15', 'font-bold');
        } else {
            link.classList.remove('text-devo-orange', 'bg-devo-orange/15', 'font-bold');
            link.classList.add('text-devo-muted');
        }
    });

    // Reapply filters for active tab
    applyActiveTabFilters();
}

// ==========================================
// ⚙️ Event Listeners Setup
// ==========================================
function setupEventListeners() {
    // Top Tabs Click Listeners
    document.querySelectorAll('.reports-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-report-tab');
            switchReportTab(tab);
        });
    });

    // Global Refresh Button
    const refreshBtn = document.getElementById('rep-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('animate-spin');
            await fetchReportsData(true);
            setTimeout(() => refreshBtn.classList.remove('animate-spin'), 600);
            showToast('تم تحديث بيانات التقارير بنجاح 🔄', 'success');
        });
    }

    // Print Button Trigger & Dropdown Modal
    const printBtn = document.getElementById('rep-print-btn');
    const printModal = document.getElementById('rep-print-modal');
    const printWithCardsBtn = document.getElementById('rep-print-with-cards');
    const printWithoutCardsBtn = document.getElementById('rep-print-without-cards');
    const printModalClose = document.getElementById('rep-print-modal-close');

    if (printBtn && printModal) {
        printBtn.addEventListener('click', () => {
            printModal.classList.remove('hidden');
            printModal.classList.add('flex');
        });
    }

    if (printModalClose && printModal) {
        printModalClose.addEventListener('click', () => {
            printModal.classList.add('hidden');
            printModal.classList.remove('flex');
        });
    }

    if (printWithCardsBtn && printModal) {
        printWithCardsBtn.addEventListener('click', () => {
            printModal.classList.add('hidden');
            printModal.classList.remove('flex');
            executeActiveReportPrint(true);
        });
    }

    if (printWithoutCardsBtn && printModal) {
        printWithoutCardsBtn.addEventListener('click', () => {
            printModal.classList.add('hidden');
            printModal.classList.remove('flex');
            executeActiveReportPrint(false);
        });
    }

    // --- Tab 1: Sales & Orders Event Listeners ---
    setupFilterListeners('rep-sales-period', 'rep-sales-custom-date', 'rep-sales-from', 'rep-sales-to', 'rep-sales-search', [
        'rep-sales-status',
        'rep-sales-worker',
        'rep-sales-archive'
    ], () => applySalesFilters());

    // --- Tab 2: Deposits Event Listeners ---
    setupFilterListeners('rep-dep-period', 'rep-dep-custom-date', 'rep-dep-from', 'rep-dep-to', 'rep-dep-search', [
        'rep-dep-receiver',
        'rep-dep-worker'
    ], () => applyDepositsFilters());

    // --- Tab 3: Inventory Event Listeners ---
    setupFilterListeners(null, null, null, null, 'rep-inv-search', [
        'rep-inv-category',
        'rep-inv-class',
        'rep-inv-status',
        'rep-inv-color'
    ], () => applyInventoryFilters());

    // --- Tab 4: Models Event Listeners ---
    setupFilterListeners('rep-models-period', 'rep-models-custom-date', 'rep-models-from', 'rep-models-to', 'rep-models-search', [
        'rep-models-category',
        'rep-models-class',
        'rep-models-sort'
    ], () => applyModelsFilters());

    // --- Tab 5: Staff Event Listeners ---
    setupFilterListeners('rep-staff-period', 'rep-staff-custom-date', 'rep-staff-from', 'rep-staff-to', 'rep-staff-search', [
        'rep-staff-role',
        'rep-staff-status'
    ], () => applyStaffFilters());
}

function setupFilterListeners(periodId, customDateId, fromId, toId, searchId, selectIds, callback) {
    if (periodId) {
        const pEl = document.getElementById(periodId);
        if (pEl) {
            pEl.addEventListener('change', () => {
                const cEl = customDateId ? document.getElementById(customDateId) : null;
                if (cEl) {
                    if (pEl.value === 'custom') {
                        cEl.classList.remove('hidden');
                        cEl.classList.add('flex');
                    } else {
                        cEl.classList.add('hidden');
                        cEl.classList.remove('flex');
                    }
                }
                callback();
            });
        }
    }

    if (fromId) {
        const fromEl = document.getElementById(fromId);
        if (fromEl) fromEl.addEventListener('input', callback);
    }

    if (toId) {
        const toEl = document.getElementById(toId);
        if (toEl) toEl.addEventListener('input', callback);
    }

    if (searchId) {
        const searchEl = document.getElementById(searchId);
        if (searchEl) searchEl.addEventListener('input', callback);
    }

    if (selectIds && Array.isArray(selectIds)) {
        selectIds.forEach(sId => {
            const el = document.getElementById(sId);
            if (el) el.addEventListener('change', callback);
        });
    }
}

// ==========================================
// 📡 Realtime Updates
// ==========================================
function setupRealtimeSubscription() {
    if (reportsRealtimeChannel) return;

    reportsRealtimeChannel = supabase
        .channel('admin-reports-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
            await fetchReportsData(false);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'model_inventory' }, async () => {
            await fetchReportsData(false);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, async () => {
            await fetchReportsData(false);
        })
        .subscribe();
}

// ==========================================
// 📥 Fetch Definitions (Categories, Classes, Colors, Users)
// ==========================================
async function loadDefinitions() {
    try {
        const [catsRes, classesRes, colorsRes, usersRes] = await Promise.all([
            supabase.from('categories').select('id, name').order('name'),
            supabase.from('classes').select('id, name, class_sizes(size_id)').order('name'),
            supabase.from('colors').select('id, name').order('name'),
            supabase.from('system_users').select('id, username, full_name, role, is_active, login_count, invoice_count, created_at').order('full_name')
        ]);

        rawDefinitions.categories = catsRes.data || [];
        rawDefinitions.classes = classesRes.data || [];
        rawDefinitions.colors = colorsRes.data || [];
        rawUsers = usersRes.data || [];

        populateFilterDropdowns();
    } catch (err) {
        console.error('Error loading definitions for reports:', err);
    }
}

function populateFilterDropdowns() {
    // 1. Worker / Staff Dropdowns
    const workerSelects = ['rep-sales-worker', 'rep-dep-worker'];
    workerSelects.forEach(selectId => {
        const el = document.getElementById(selectId);
        if (!el) return;
        const currentVal = el.value;
        let html = '<option value="all">كافة الموظفين / البائعين</option>';
        rawUsers.forEach(u => {
            html += `<option value="${u.id}">${u.full_name || u.username} (${u.role === 'owner' ? 'مالك' : u.role === 'admin' ? 'مدير' : 'بائع'})</option>`;
        });
        el.innerHTML = html;
        if (currentVal) el.value = currentVal;
    });

    // 2. Deposit Receiver Dropdowns
    const receiverSelect = document.getElementById('rep-dep-receiver');
    if (receiverSelect) {
        const currentVal = receiverSelect.value;
        const receivers = new Set();
        rawOrders.forEach(o => {
            if (o.deposit_receiver && o.deposit_receiver.trim()) {
                receivers.add(o.deposit_receiver.trim());
            }
        });
        let html = '<option value="all">كافة مستلمي العربون</option>';
        receivers.forEach(r => {
            html += `<option value="${r}">${r}</option>`;
        });
        receiverSelect.innerHTML = html;
        if (currentVal) receiverSelect.value = currentVal;
    }

    // 3. Category Dropdowns
    const catSelects = ['rep-inv-category', 'rep-models-category'];
    catSelects.forEach(sId => {
        const el = document.getElementById(sId);
        if (!el) return;
        const currentVal = el.value;
        let html = '<option value="all">كافة الأقسام</option>';
        rawDefinitions.categories.forEach(c => {
            html += `<option value="${c.id}">${c.name}</option>`;
        });
        el.innerHTML = html;
        if (currentVal) el.value = currentVal;
    });

    // 4. Class Dropdowns
    const classSelects = ['rep-inv-class', 'rep-models-class'];
    classSelects.forEach(sId => {
        const el = document.getElementById(sId);
        if (!el) return;
        const currentVal = el.value;
        let html = '<option value="all">كافة الفئات</option>';
        rawDefinitions.classes.forEach(c => {
            html += `<option value="${c.id}">${c.name}</option>`;
        });
        el.innerHTML = html;
        if (currentVal) el.value = currentVal;
    });

    // 5. Color Dropdown
    const colorSelect = document.getElementById('rep-inv-color');
    if (colorSelect) {
        const currentVal = colorSelect.value;
        let html = '<option value="all">كافة الألوان</option>';
        rawDefinitions.colors.forEach(c => {
            html += `<option value="${c.id}">${c.name}</option>`;
        });
        colorSelect.innerHTML = html;
        if (currentVal) colorSelect.value = currentVal;
    }
}

// ==========================================
// 📥 Fetch All Primary Data
// ==========================================
export async function fetchReportsData(force = false) {
    showLoadingStates();

    try {
        const [ordersRes, modelsRes, inventoryRes] = await Promise.all([
            // Orders with complete items and worker profile
            supabase
                .from('orders')
                .select(`
                    *,
                    system_users!worker_id (
                        id,
                        full_name,
                        username,
                        role
                    ),
                    order_items (
                        id,
                        model_id,
                        color_id,
                        quantity,
                        price_per_series,
                        total_price,
                        colors ( name ),
                        models (
                            id,
                            name,
                            factory_code,
                            system_code,
                            price,
                            category_id,
                            class_id,
                            model_sizes ( size_id ),
                            classes ( id, name, class_sizes ( size_id ) )
                        )
                    )
                `)
                .order('created_at', { ascending: false }),

            // Models with relations
            supabase
                .from('models')
                .select(`
                    id,
                    system_code,
                    factory_code,
                    name,
                    price,
                    category_id,
                    class_id,
                    is_active,
                    created_at,
                    categories ( id, name ),
                    classes ( id, name, class_sizes ( size_id ) ),
                    model_sizes ( size_id )
                `)
                .order('created_at', { ascending: false }),

            // Model Inventory per color
            supabase
                .from('model_inventory')
                .select(`
                    id,
                    model_id,
                    color_id,
                    available_series,
                    colors ( id, name )
                `)
        ]);

        if (ordersRes.error) throw ordersRes.error;
        if (modelsRes.error) throw modelsRes.error;
        if (inventoryRes.error) throw inventoryRes.error;

        rawOrders = ordersRes.data || [];
        rawModels = modelsRes.data || [];
        rawInventory = inventoryRes.data || [];

        populateFilterDropdowns();
        applyActiveTabFilters();
    } catch (err) {
        console.error('Error fetching reports data:', err);
        showToast('حدث خطأ أثناء تحميل بيانات التقارير', 'error');
    }
}

function showLoadingStates() {
    const tableBodies = [
        'rep-sales-table-body',
        'rep-dep-table-body',
        'rep-inv-table-body',
        'rep-models-table-body',
        'rep-staff-table-body'
    ];

    tableBodies.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.innerHTML.trim() === '') {
            el.innerHTML = `
                <tr>
                    <td colspan="10" class="p-8 text-center text-devo-muted">
                        <i class="ph ph-spinner animate-spin text-3xl text-devo-orange mb-2 block"></i>
                        <span>جاري جلب وحساب البيانات...</span>
                    </td>
                </tr>
            `;
        }
    });
}

function applyActiveTabFilters() {
    switch (currentTab) {
        case 'sales':
            applySalesFilters();
            break;
        case 'deposits':
            applyDepositsFilters();
            break;
        case 'inventory':
            applyInventoryFilters();
            break;
        case 'models':
            applyModelsFilters();
            break;
        case 'staff':
            applyStaffFilters();
            break;
    }
}

// ==========================================
// 🛠️ Date Helper Logic
// ==========================================
function getDateRange(periodValue, customFrom, customTo) {
    const now = new Date();
    let startDate = null;
    let endDate = null;

    if (periodValue === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (periodValue === 'yesterday') {
        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        startDate = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0, 0);
        endDate = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);
    } else if (periodValue === 'week') {
        const temp = new Date(now);
        temp.setDate(temp.getDate() - 7);
        startDate = new Date(temp.getFullYear(), temp.getMonth(), temp.getDate(), 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (periodValue === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (periodValue === 'last_month') {
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (periodValue === 'custom') {
        if (customFrom) {
            const df = new Date(customFrom);
            startDate = new Date(df.getFullYear(), df.getMonth(), df.getDate(), 0, 0, 0, 0);
        }
        if (customTo) {
            const dt = new Date(customTo);
            endDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
        }
    }
    // 'all' returns null for both, allowing all records

    return { startDate, endDate };
}

// ==========================================
// 📊 1. Sales & Orders Tab Logic
// ==========================================
export function applySalesFilters() {
    const period = document.getElementById('rep-sales-period')?.value || 'today';
    const fromVal = document.getElementById('rep-sales-from')?.value;
    const toVal = document.getElementById('rep-sales-to')?.value;
    const statusVal = document.getElementById('rep-sales-status')?.value || 'all';
    const workerVal = document.getElementById('rep-sales-worker')?.value || 'all';
    const archiveVal = document.getElementById('rep-sales-archive')?.value || 'active';
    const searchVal = (document.getElementById('rep-sales-search')?.value || '').trim().toLowerCase();

    const { startDate, endDate } = getDateRange(period, fromVal, toVal);

    filteredSalesData = rawOrders.filter(o => {
        // Date check
        if (startDate || endDate) {
            const d = new Date(o.created_at);
            if (startDate && d < startDate) return false;
            if (endDate && d > endDate) return false;
        }

        // Archive check
        if (archiveVal === 'active' && o.is_archived === true) return false;
        if (archiveVal === 'archived' && o.is_archived !== true) return false;

        // Status check
        if (statusVal !== 'all' && o.status !== statusVal) return false;

        // Worker check
        if (workerVal !== 'all' && o.worker_id !== workerVal && o.assigned_worker_id !== workerVal) return false;

        // Search check
        if (searchVal) {
            const num = String(o.invoice_number || o.order_number || o.id || '').toLowerCase();
            const cust = String(o.customer_name || '').toLowerCase();
            const phone = String(o.phone_1 || o.customer_phone || '').toLowerCase();
            const worker = String(o.system_users?.full_name || o.system_users?.username || '').toLowerCase();

            const match = num.includes(searchVal) || cust.includes(searchVal) || phone.includes(searchVal) || worker.includes(searchVal);
            if (!match) return false;
        }

        return true;
    });

    renderSalesView(filteredSalesData);
}

function renderSalesView(orders) {
    // Stats calculation
    let totalSales = 0;
    let totalDeposits = 0;
    let totalSeries = 0;
    let totalPieces = 0;

    orders.forEach(o => {
        totalSales += parseFloat(o.total_price) || 0;
        totalDeposits += parseFloat(o.deposit) || 0;

        if (o.order_items && Array.isArray(o.order_items)) {
            o.order_items.forEach(item => {
                const qty = item.quantity || 0;
                totalSeries += qty;
                const classSizes = item.models?.classes?.class_sizes || [];
                const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1);
                totalPieces += qty * sizesCount;
            });
        }
    });

    const ordersCount = orders.length;
    const avgOrder = ordersCount > 0 ? totalSales / ordersCount : 0;
    const remaining = totalSales - totalDeposits;

    // Update Stat Cards
    setStatText('rep-sales-stat-total', `${totalSales.toLocaleString('ar-EG')} ج.م`);
    setStatText('rep-sales-stat-count', ordersCount.toLocaleString('ar-EG'));
    setStatText('rep-sales-stat-items', `${totalSeries.toLocaleString('ar-EG')} سيري (${totalPieces.toLocaleString('ar-EG')} قطعة)`);
    setStatText('rep-sales-stat-avg', `${Math.round(avgOrder).toLocaleString('ar-EG')} ج.م`);
    setStatText('rep-sales-stat-remaining', `${remaining.toLocaleString('ar-EG')} ج.م`);

    // Render Table Body
    const tBody = document.getElementById('rep-sales-table-body');
    const tFoot = document.getElementById('rep-sales-table-foot');
    if (!tBody) return;

    if (orders.length === 0) {
        tBody.innerHTML = `
            <tr>
                <td colspan="9" class="p-8 text-center text-devo-muted">
                    <i class="ph ph-receipt-x text-4xl mb-2 block text-devo-gray"></i>
                    <span>لا توجد أوردرات تطابق خيارات الفلترة الحالية</span>
                </td>
            </tr>
        `;
        if (tFoot) tFoot.innerHTML = '';
        return;
    }

    tBody.innerHTML = orders.map((o, idx) => {
        const orderNum = o.invoice_number || o.order_number || o.id;
        const dateObj = new Date(o.created_at);
        const dateStr = dateObj.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const timeStr = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
        const custName = o.customer_name || 'عميل نقدي';
        const phone = o.phone_1 || o.customer_phone || '-';
        const workerName = o.system_users?.full_name || o.system_users?.username || 'غير محدد';
        const orderTotal = parseFloat(o.total_price) || 0;
        const depositVal = parseFloat(o.deposit) || 0;
        const remVal = orderTotal - depositVal;

        // Calculate series & pieces for this order
        let orderSeries = 0;
        let orderPieces = 0;
        if (o.order_items && Array.isArray(o.order_items)) {
            o.order_items.forEach(i => {
                const q = i.quantity || 0;
                orderSeries += q;
                const szCount = (i.models?.classes?.class_sizes?.length > 0 ? i.models.classes.class_sizes.length : i.models?.model_sizes?.length) || 1;
                orderPieces += q * szCount;
            });
        }

        const statusBadge = getStatusBadge(o.status);

        return `
            <tr class="hover:bg-devo-dark/50 transition-colors border-b border-devo-gray/40 text-xs">
                <td class="px-3 py-3 text-center text-devo-muted">${idx + 1}</td>
                <td class="px-3 py-3 font-mono font-bold text-devo-orange">#${orderNum}</td>
                <td class="px-3 py-3 whitespace-nowrap">
                    <div class="font-medium text-white">${dateStr}</div>
                    <div class="text-[10px] text-devo-muted">${timeStr}</div>
                </td>
                <td class="px-3 py-3 font-semibold text-white">
                    ${custName}
                    <div class="text-[10px] text-devo-muted font-mono" dir="ltr">${phone}</div>
                </td>
                <td class="px-3 py-3 text-devo-text">${workerName}</td>
                <td class="px-3 py-3 text-center">${statusBadge}</td>
                <td class="px-3 py-3 text-center font-bold text-devo-text">
                    ${orderSeries} سيري <span class="text-[10px] text-devo-muted font-normal">(${orderPieces} ق)</span>
                </td>
                <td class="px-3 py-3 font-bold text-white whitespace-nowrap">${orderTotal.toLocaleString('ar-EG')} ج.م</td>
                <td class="px-3 py-3 font-bold text-devo-success whitespace-nowrap">
                    ${depositVal > 0 ? `${depositVal.toLocaleString('ar-EG')} ج.م` : '<span class="text-devo-muted font-normal">-</span>'}
                </td>
            </tr>
        `;
    }).join('');

    if (tFoot) {
        tFoot.innerHTML = `
            <tr class="bg-devo-dark font-bold text-white border-t-2 border-devo-orange/50 text-xs">
                <td colspan="6" class="px-4 py-3 text-left">إجمالي المبيعات المفلترة (${orders.length} أوردر):</td>
                <td class="px-3 py-3 text-center text-devo-orange">${totalSeries.toLocaleString('ar-EG')} سيري (${totalPieces.toLocaleString('ar-EG')} ق)</td>
                <td class="px-3 py-3 text-white text-sm whitespace-nowrap">${totalSales.toLocaleString('ar-EG')} ج.م</td>
                <td class="px-3 py-3 text-devo-success text-sm whitespace-nowrap">${totalDeposits.toLocaleString('ar-EG')} ج.م</td>
            </tr>
        `;
    }
}

// ==========================================
// 💰 2. Deposit Reports Tab Logic
// ==========================================
export function applyDepositsFilters() {
    const period = document.getElementById('rep-dep-period')?.value || 'today';
    const fromVal = document.getElementById('rep-dep-from')?.value;
    const toVal = document.getElementById('rep-dep-to')?.value;
    const receiverVal = document.getElementById('rep-dep-receiver')?.value || 'all';
    const workerVal = document.getElementById('rep-dep-worker')?.value || 'all';
    const searchVal = (document.getElementById('rep-dep-search')?.value || '').trim().toLowerCase();

    const { startDate, endDate } = getDateRange(period, fromVal, toVal);

    filteredDepositsData = rawOrders.filter(o => {
        const dep = parseFloat(o.deposit) || 0;
        if (dep <= 0) return false;

        if (startDate || endDate) {
            const d = new Date(o.created_at);
            if (startDate && d < startDate) return false;
            if (endDate && d > endDate) return false;
        }

        if (receiverVal !== 'all' && (o.deposit_receiver || '').trim() !== receiverVal) return false;
        if (workerVal !== 'all' && o.worker_id !== workerVal) return false;

        if (searchVal) {
            const num = String(o.invoice_number || o.order_number || o.id || '').toLowerCase();
            const cust = String(o.customer_name || '').toLowerCase();
            const phone = String(o.phone_1 || o.customer_phone || '').toLowerCase();
            const worker = String(o.system_users?.full_name || o.system_users?.username || '').toLowerCase();
            const receiver = String(o.deposit_receiver || '').toLowerCase();

            const match = num.includes(searchVal) || cust.includes(searchVal) || phone.includes(searchVal) || worker.includes(searchVal) || receiver.includes(searchVal);
            if (!match) return false;
        }

        return true;
    });

    renderDepositsView(filteredDepositsData);
}

function renderDepositsView(orders) {
    let totalSum = 0;
    const count = orders.length;

    orders.forEach(o => {
        totalSum += parseFloat(o.deposit) || 0;
    });

    const avg = count > 0 ? totalSum / count : 0;

    setStatText('rep-dep-stat-count', count.toLocaleString('ar-EG'));
    setStatText('rep-dep-stat-sum', `${totalSum.toLocaleString('ar-EG')} ج.م`);
    setStatText('rep-dep-stat-avg', `${Math.round(avg).toLocaleString('ar-EG')} ج.م`);

    const tBody = document.getElementById('rep-dep-table-body');
    const tFoot = document.getElementById('rep-dep-table-foot');
    if (!tBody) return;

    if (orders.length === 0) {
        tBody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-devo-muted">
                    <i class="ph ph-hand-coins text-4xl mb-2 block text-devo-gray"></i>
                    <span>لا توجد تقارير عربون تطابق خيارات الفلترة المحددة</span>
                </td>
            </tr>
        `;
        if (tFoot) tFoot.innerHTML = '';
        return;
    }

    tBody.innerHTML = orders.map((o, idx) => {
        const orderNum = o.invoice_number || o.order_number || o.id;
        const dateObj = new Date(o.created_at);
        const dateStr = dateObj.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
        const timeStr = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
        const custName = o.customer_name || 'غير مسمى';
        const phone = o.phone_1 || o.customer_phone || '-';
        const workerName = o.system_users?.full_name || o.system_users?.username || 'غير محدد';
        const depositReceiver = o.deposit_receiver || '-';
        const depositVal = parseFloat(o.deposit) || 0;
        const totalVal = parseFloat(o.total_price) || 0;
        const remVal = totalVal - depositVal;

        return `
            <tr class="hover:bg-devo-dark/50 transition-colors border-b border-devo-gray/40 text-xs">
                <td class="px-3 py-3 text-center text-devo-muted">${idx + 1}</td>
                <td class="px-3 py-3 font-mono font-bold text-devo-orange">#${orderNum}</td>
                <td class="px-3 py-3 whitespace-nowrap">
                    <div class="font-medium text-white">${dateStr}</div>
                    <div class="text-[10px] text-devo-muted">${timeStr}</div>
                </td>
                <td class="px-3 py-3 font-semibold text-white">
                    ${custName}
                    <div class="text-[10px] text-devo-muted font-mono" dir="ltr">${phone}</div>
                </td>
                <td class="px-3 py-3 text-devo-text">${workerName}</td>
                <td class="px-3 py-3">
                    <span class="px-2.5 py-1 rounded-md text-[11px] font-bold bg-devo-gray text-white border border-devo-grayHover inline-block">
                        ${depositReceiver}
                    </span>
                </td>
                <td class="px-3 py-3 font-bold text-devo-success text-sm whitespace-nowrap">
                    ${depositVal.toLocaleString('ar-EG')} ج.م
                </td>
                <td class="px-3 py-3 text-devo-muted whitespace-nowrap">
                    ${totalVal.toLocaleString('ar-EG')} ج.م
                    <div class="text-[10px] text-devo-orange">متبقي: ${remVal.toLocaleString('ar-EG')} ج.م</div>
                </td>
            </tr>
        `;
    }).join('');

    if (tFoot) {
        tFoot.innerHTML = `
            <tr class="bg-devo-dark font-bold text-white border-t-2 border-devo-orange/50 text-xs">
                <td colspan="6" class="px-4 py-3 text-left">إجمالي مبالغ العربون المحصلة (${count} حركة):</td>
                <td class="px-3 py-3 text-devo-success text-base whitespace-nowrap">${totalSum.toLocaleString('ar-EG')} ج.م</td>
                <td></td>
            </tr>
        `;
    }
}

// ==========================================
// 📦 3. Inventory & Stock Reports Tab Logic
// ==========================================
export function applyInventoryFilters() {
    const catVal = document.getElementById('rep-inv-category')?.value || 'all';
    const classVal = document.getElementById('rep-inv-class')?.value || 'all';
    const statusVal = document.getElementById('rep-inv-status')?.value || 'all';
    const colorVal = document.getElementById('rep-inv-color')?.value || 'all';
    const searchVal = (document.getElementById('rep-inv-search')?.value || '').trim().toLowerCase();

    // Map inventory items grouped by model
    const modelStockMap = {};
    rawInventory.forEach(inv => {
        if (!modelStockMap[inv.model_id]) {
            modelStockMap[inv.model_id] = [];
        }
        modelStockMap[inv.model_id].push(inv);
    });

    filteredInventoryData = rawModels.map(m => {
        const variants = modelStockMap[m.id] || [];
        const totalSeries = variants.reduce((sum, v) => sum + (v.available_series || 0), 0);
        const sizesCount = (m.classes?.class_sizes?.length > 0 ? m.classes.class_sizes.length : m.model_sizes?.length) || 1;
        const totalPieces = totalSeries * sizesCount;
        const modelPrice = parseFloat(m.price) || 0;
        const totalStockValue = totalSeries * modelPrice;

        return {
            ...m,
            variants,
            totalSeries,
            totalPieces,
            totalStockValue,
            sizesCount
        };
    }).filter(m => {
        if (catVal !== 'all' && m.category_id !== catVal) return false;
        if (classVal !== 'all' && m.class_id !== classVal) return false;

        // Stock status filter
        if (statusVal === 'in_stock' && m.totalSeries <= 5) return false;
        if (statusVal === 'low_stock' && (m.totalSeries === 0 || m.totalSeries > 5)) return false;
        if (statusVal === 'out_of_stock' && m.totalSeries > 0) return false;

        // Color filter
        if (colorVal !== 'all') {
            const hasColor = m.variants.some(v => v.color_id === colorVal && (v.available_series || 0) > 0);
            if (!hasColor) return false;
        }

        // Search check
        if (searchVal) {
            const name = String(m.name || '').toLowerCase();
            const fCode = String(m.factory_code || '').toLowerCase();
            const sCode = String(m.system_code || '').toLowerCase();
            const catName = String(m.categories?.name || '').toLowerCase();

            const match = name.includes(searchVal) || fCode.includes(searchVal) || sCode.includes(searchVal) || catName.includes(searchVal);
            if (!match) return false;
        }

        return true;
    });

    renderInventoryView(filteredInventoryData);
}

function renderInventoryView(items) {
    let totalActiveModels = 0;
    let totalStockSeries = 0;
    let totalStockPieces = 0;
    let totalMonetaryValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    items.forEach(m => {
        if (m.is_active) totalActiveModels++;
        totalStockSeries += m.totalSeries;
        totalStockPieces += m.totalPieces;
        totalMonetaryValue += m.totalStockValue;

        if (m.totalSeries === 0) {
            outOfStockCount++;
        } else if (m.totalSeries <= 5) {
            lowStockCount++;
        }
    });

    setStatText('rep-inv-stat-models', items.length.toLocaleString('ar-EG'));
    setStatText('rep-inv-stat-series', `${totalStockSeries.toLocaleString('ar-EG')} سيري`);
    setStatText('rep-inv-stat-pieces', `${totalStockPieces.toLocaleString('ar-EG')} قطعة`);
    setStatText('rep-inv-stat-value', `${totalMonetaryValue.toLocaleString('ar-EG')} ج.م`);
    setStatText('rep-inv-stat-alerts', `${lowStockCount + outOfStockCount} (منها ${outOfStockCount} نافد)`);

    const tBody = document.getElementById('rep-inv-table-body');
    const tFoot = document.getElementById('rep-inv-table-foot');
    if (!tBody) return;

    if (items.length === 0) {
        tBody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-devo-muted">
                    <i class="ph ph-warehouse text-4xl mb-2 block text-devo-gray"></i>
                    <span>لا توجد موديلات أو أرصدة تطابق خيارات الفلترة المحددة</span>
                </td>
            </tr>
        `;
        if (tFoot) tFoot.innerHTML = '';
        return;
    }

    tBody.innerHTML = items.map((m, idx) => {
        const catName = m.categories?.name || 'غير محدد';
        const className = m.classes?.name || 'غير محدد';
        const price = parseFloat(m.price) || 0;

        // Build color badges with quantity
        const colorsHtml = m.variants.length > 0
            ? m.variants.map(v => `
                <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-devo-dark border border-devo-grayHover text-white">
                    <span>${v.colors?.name || 'لون'}</span>
                    <span class="font-bold font-mono text-devo-orange">${v.available_series || 0}</span>
                </span>
            `).join(' ')
            : '<span class="text-devo-muted text-[10px]">لا يوجد تفاصيل ألوان</span>';

        const stockBadge = m.totalSeries === 0
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-devo-error/20 text-devo-error border border-devo-error/40">نافد الرصيد</span>'
            : m.totalSeries <= 5
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">رصيد منخفض</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-devo-success/20 text-devo-success border border-devo-success/40">متوفر</span>';

        return `
            <tr class="hover:bg-devo-dark/50 transition-colors border-b border-devo-gray/40 text-xs">
                <td class="px-3 py-3 text-center text-devo-muted">${idx + 1}</td>
                <td class="px-3 py-3">
                    <div class="font-bold text-white text-sm">${m.name}</div>
                    <div class="flex items-center gap-2 mt-0.5 text-[10px] text-devo-muted font-mono">
                        <span>مصنع: <b class="text-devo-text">${m.factory_code || '-'}</b></span>
                        <span>•</span>
                        <span>سيستم: <b class="text-devo-orange">${m.system_code || '-'}</b></span>
                    </div>
                </td>
                <td class="px-3 py-3 text-devo-text">
                    <div>${catName}</div>
                    <div class="text-[10px] text-devo-muted">${className}</div>
                </td>
                <td class="px-3 py-3 max-w-[280px]">
                    <div class="flex flex-wrap gap-1">${colorsHtml}</div>
                </td>
                <td class="px-3 py-3 text-center">
                    <div class="font-bold text-white text-sm">${m.totalSeries} سيري</div>
                    <div class="text-[10px] text-devo-muted">(${m.totalPieces} قطعة)</div>
                    <div class="mt-1">${stockBadge}</div>
                </td>
                <td class="px-3 py-3 font-bold text-white whitespace-nowrap">${price.toLocaleString('ar-EG')} ج.م</td>
                <td class="px-3 py-3 font-bold text-devo-orange text-sm whitespace-nowrap">
                    ${m.totalStockValue.toLocaleString('ar-EG')} ج.م
                </td>
            </tr>
        `;
    }).join('');

    if (tFoot) {
        tFoot.innerHTML = `
            <tr class="bg-devo-dark font-bold text-white border-t-2 border-devo-orange/50 text-xs">
                <td colspan="4" class="px-4 py-3 text-left">إجمالي المخزون المفلتر (${items.length} موديل):</td>
                <td class="px-3 py-3 text-center text-white text-sm">${totalStockSeries.toLocaleString('ar-EG')} سيري (${totalStockPieces.toLocaleString('ar-EG')} ق)</td>
                <td></td>
                <td class="px-3 py-3 text-devo-orange text-base whitespace-nowrap">${totalMonetaryValue.toLocaleString('ar-EG')} ج.م</td>
            </tr>
        `;
    }
}

// ==========================================
// 👗 4. Models Sales Performance Tab Logic
// ==========================================
export function applyModelsFilters() {
    const period = document.getElementById('rep-models-period')?.value || 'month';
    const fromVal = document.getElementById('rep-models-from')?.value;
    const toVal = document.getElementById('rep-models-to')?.value;
    const catVal = document.getElementById('rep-models-category')?.value || 'all';
    const classVal = document.getElementById('rep-models-class')?.value || 'all';
    const sortVal = document.getElementById('rep-models-sort')?.value || 'sales_qty_desc';
    const searchVal = (document.getElementById('rep-models-search')?.value || '').trim().toLowerCase();

    const { startDate, endDate } = getDateRange(period, fromVal, toVal);

    // Aggregate sold items per model within the selected date range
    const modelSalesAgg = {};
    rawOrders.forEach(o => {
        // Date check
        if (startDate || endDate) {
            const d = new Date(o.created_at);
            if (startDate && d < startDate) return;
            if (endDate && d > endDate) return;
        }

        // Cancelled orders should not count in sales performance
        if (o.status === 'cancelled') return;

        if (o.order_items && Array.isArray(o.order_items)) {
            o.order_items.forEach(item => {
                const mId = item.model_id;
                if (!mId) return;

                if (!modelSalesAgg[mId]) {
                    modelSalesAgg[mId] = {
                        soldSeries: 0,
                        soldPieces: 0,
                        totalRevenue: 0,
                        ordersCount: 0
                    };
                }

                const qty = item.quantity || 0;
                const szCount = (item.models?.classes?.class_sizes?.length > 0 ? item.models.classes.class_sizes.length : item.models?.model_sizes?.length) || 1;
                modelSalesAgg[mId].soldSeries += qty;
                modelSalesAgg[mId].soldPieces += qty * szCount;
                modelSalesAgg[mId].totalRevenue += parseFloat(item.total_price) || 0;
                modelSalesAgg[mId].ordersCount += 1;
            });
        }
    });

    // Merge with current stock
    const modelStockMap = {};
    rawInventory.forEach(inv => {
        modelStockMap[inv.model_id] = (modelStockMap[inv.model_id] || 0) + (inv.available_series || 0);
    });

    filteredModelsData = rawModels.map(m => {
        const sales = modelSalesAgg[m.id] || { soldSeries: 0, soldPieces: 0, totalRevenue: 0, ordersCount: 0 };
        const currentStockSeries = modelStockMap[m.id] || 0;

        return {
            ...m,
            ...sales,
            currentStockSeries
        };
    }).filter(m => {
        if (catVal !== 'all' && m.category_id !== catVal) return false;
        if (classVal !== 'all' && m.class_id !== classVal) return false;

        if (searchVal) {
            const name = String(m.name || '').toLowerCase();
            const fCode = String(m.factory_code || '').toLowerCase();
            const sCode = String(m.system_code || '').toLowerCase();
            const match = name.includes(searchVal) || fCode.includes(searchVal) || sCode.includes(searchVal);
            if (!match) return false;
        }

        return true;
    });

    // Sorting
    filteredModelsData.sort((a, b) => {
        if (sortVal === 'sales_qty_desc') return b.soldSeries - a.soldSeries;
        if (sortVal === 'sales_qty_asc') return a.soldSeries - b.soldSeries;
        if (sortVal === 'revenue_desc') return b.totalRevenue - a.totalRevenue;
        if (sortVal === 'stock_desc') return b.currentStockSeries - a.currentStockSeries;
        return 0;
    });

    renderModelsPerformanceView(filteredModelsData);
}

function renderModelsPerformanceView(models) {
    let totalSoldSeries = 0;
    let totalSoldPieces = 0;
    let totalRevenue = 0;
    let activeSoldModelsCount = 0;
    let topSeller = null;

    models.forEach(m => {
        totalSoldSeries += m.soldSeries;
        totalSoldPieces += m.soldPieces;
        totalRevenue += m.totalRevenue;
        if (m.soldSeries > 0) activeSoldModelsCount++;

        if (!topSeller || m.soldSeries > topSeller.soldSeries) {
            if (m.soldSeries > 0) topSeller = m;
        }
    });

    setStatText('rep-models-stat-top', topSeller ? `${topSeller.name} (${topSeller.soldSeries} سيري)` : 'لا يوجد');
    setStatText('rep-models-stat-sold', `${totalSoldSeries.toLocaleString('ar-EG')} سيري (${totalSoldPieces.toLocaleString('ar-EG')} ق)`);
    setStatText('rep-models-stat-rev', `${totalRevenue.toLocaleString('ar-EG')} ج.م`);
    setStatText('rep-models-stat-active', `${activeSoldModelsCount} / ${models.length} موديل`);

    const tBody = document.getElementById('rep-models-table-body');
    const tFoot = document.getElementById('rep-models-table-foot');
    if (!tBody) return;

    if (models.length === 0) {
        tBody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-devo-muted">
                    <i class="ph ph-t-shirt text-4xl mb-2 block text-devo-gray"></i>
                    <span>لا توجد موديلات تطابق خيارات التصفية المحددة</span>
                </td>
            </tr>
        `;
        if (tFoot) tFoot.innerHTML = '';
        return;
    }

    tBody.innerHTML = models.map((m, idx) => {
        const catName = m.categories?.name || '-';
        const price = parseFloat(m.price) || 0;

        return `
            <tr class="hover:bg-devo-dark/50 transition-colors border-b border-devo-gray/40 text-xs">
                <td class="px-3 py-3 text-center text-devo-muted">${idx + 1}</td>
                <td class="px-3 py-3">
                    <div class="font-bold text-white text-sm">${m.name}</div>
                    <div class="flex items-center gap-2 mt-0.5 text-[10px] text-devo-muted font-mono">
                        <span>كود المصنع: <b class="text-devo-text">${m.factory_code || '-'}</b></span>
                        <span>•</span>
                        <span>السيستم: <b class="text-devo-orange">${m.system_code || '-'}</b></span>
                    </div>
                </td>
                <td class="px-3 py-3 text-devo-text">${catName}</td>
                <td class="px-3 py-3 font-bold text-white whitespace-nowrap">${price.toLocaleString('ar-EG')} ج.م</td>
                <td class="px-3 py-3 text-center font-bold text-devo-orange text-sm">
                    ${m.soldSeries} سيري
                    <div class="text-[10px] text-devo-muted font-normal">(${m.soldPieces} قطعة)</div>
                </td>
                <td class="px-3 py-3 font-bold text-devo-success text-sm whitespace-nowrap">
                    ${m.totalRevenue.toLocaleString('ar-EG')} ج.م
                </td>
                <td class="px-3 py-3 text-center">
                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${m.currentStockSeries > 0 ? 'bg-devo-gray text-white' : 'bg-devo-error/20 text-devo-error'} border border-devo-grayHover inline-block">
                        ${m.currentStockSeries} سيري
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    if (tFoot) {
        tFoot.innerHTML = `
            <tr class="bg-devo-dark font-bold text-white border-t-2 border-devo-orange/50 text-xs">
                <td colspan="4" class="px-4 py-3 text-left">إجمالي المبيعات المحققة للموديلات:</td>
                <td class="px-3 py-3 text-center text-devo-orange text-sm">${totalSoldSeries.toLocaleString('ar-EG')} سيري (${totalSoldPieces.toLocaleString('ar-EG')} ق)</td>
                <td class="px-3 py-3 text-devo-success text-base whitespace-nowrap">${totalRevenue.toLocaleString('ar-EG')} ج.م</td>
                <td></td>
            </tr>
        `;
    }
}

// ==========================================
// 👥 5. Staff & Accounts Performance Tab Logic
// ==========================================
export function applyStaffFilters() {
    const period = document.getElementById('rep-staff-period')?.value || 'month';
    const fromVal = document.getElementById('rep-staff-from')?.value;
    const toVal = document.getElementById('rep-staff-to')?.value;
    const roleVal = document.getElementById('rep-staff-role')?.value || 'all';
    const statusVal = document.getElementById('rep-staff-status')?.value || 'all';
    const searchVal = (document.getElementById('rep-staff-search')?.value || '').trim().toLowerCase();

    const { startDate, endDate } = getDateRange(period, fromVal, toVal);

    // Aggregate orders & sales per staff
    const staffSalesMap = {};
    rawOrders.forEach(o => {
        if (startDate || endDate) {
            const d = new Date(o.created_at);
            if (startDate && d < startDate) return;
            if (endDate && d > endDate) return;
        }

        const workerId = o.worker_id || o.assigned_worker_id;
        if (!workerId) return;

        if (!staffSalesMap[workerId]) {
            staffSalesMap[workerId] = {
                ordersCount: 0,
                totalSales: 0,
                totalDeposit: 0,
                soldSeries: 0
            };
        }

        staffSalesMap[workerId].ordersCount += 1;
        staffSalesMap[workerId].totalSales += parseFloat(o.total_price) || 0;
        staffSalesMap[workerId].totalDeposit += parseFloat(o.deposit) || 0;

        if (o.order_items && Array.isArray(o.order_items)) {
            o.order_items.forEach(i => {
                staffSalesMap[workerId].soldSeries += i.quantity || 0;
            });
        }
    });

    filteredStaffData = rawUsers.map(u => {
        const perf = staffSalesMap[u.id] || { ordersCount: 0, totalSales: 0, totalDeposit: 0, soldSeries: 0 };
        const avgOrderVal = perf.ordersCount > 0 ? perf.totalSales / perf.ordersCount : 0;

        return {
            ...u,
            ...perf,
            avgOrderVal
        };
    }).filter(u => {
        if (roleVal !== 'all' && u.role !== roleVal) return false;
        if (statusVal === 'active' && u.is_active !== true) return false;
        if (statusVal === 'inactive' && u.is_active === true) return false;

        if (searchVal) {
            const name = String(u.full_name || '').toLowerCase();
            const username = String(u.username || '').toLowerCase();
            const match = name.includes(searchVal) || username.includes(searchVal);
            if (!match) return false;
        }

        return true;
    });

    // Default sort by sales amount desc
    filteredStaffData.sort((a, b) => b.totalSales - a.totalSales);

    renderStaffPerformanceView(filteredStaffData);
}

function renderStaffPerformanceView(staffList) {
    let totalTeamSales = 0;
    let totalTeamDeposits = 0;
    let totalTeamOrders = 0;
    let topStaff = null;

    staffList.forEach(s => {
        totalTeamSales += s.totalSales;
        totalTeamDeposits += s.totalDeposit;
        totalTeamOrders += s.ordersCount;

        if (!topStaff || s.totalSales > topStaff.totalSales) {
            if (s.totalSales > 0) topStaff = s;
        }
    });

    setStatText('rep-staff-stat-count', staffList.length.toLocaleString('ar-EG'));
    setStatText('rep-staff-stat-top', topStaff ? `${topStaff.full_name} (${topStaff.totalSales.toLocaleString('ar-EG')} ج.م)` : 'لا يوجد');
    setStatText('rep-staff-stat-sales', `${totalTeamSales.toLocaleString('ar-EG')} ج.م`);
    setStatText('rep-staff-stat-deposits', `${totalTeamDeposits.toLocaleString('ar-EG')} ج.م`);

    const tBody = document.getElementById('rep-staff-table-body');
    const tFoot = document.getElementById('rep-staff-table-foot');
    if (!tBody) return;

    if (staffList.length === 0) {
        tBody.innerHTML = `
            <tr>
                <td colspan="8" class="p-8 text-center text-devo-muted">
                    <i class="ph ph-users text-4xl mb-2 block text-devo-gray"></i>
                    <span>لا توجد حسابات أو عمال تطابق خيارات الفلترة المحددة</span>
                </td>
            </tr>
        `;
        if (tFoot) tFoot.innerHTML = '';
        return;
    }

    tBody.innerHTML = staffList.map((u, idx) => {
        const roleName = u.role === 'owner' ? 'مالك النظام' : u.role === 'admin' ? 'مدير نظام' : 'بائع / موظف';
        const roleClass = u.role === 'owner' ? 'text-red-400 bg-red-500/10 border-red-500/30' : u.role === 'admin' ? 'text-devo-orange bg-devo-orange/10 border-devo-orange/30' : 'text-blue-400 bg-blue-500/10 border-blue-500/30';
        const statusBadge = u.is_active
            ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-devo-success/20 text-devo-success border border-devo-success/40">نشط</span>'
            : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-devo-gray text-devo-muted border border-devo-gray">معطل</span>';

        return `
            <tr class="hover:bg-devo-dark/50 transition-colors border-b border-devo-gray/40 text-xs">
                <td class="px-3 py-3 text-center text-devo-muted">${idx + 1}</td>
                <td class="px-3 py-3 font-semibold text-white">
                    ${u.full_name}
                    <div class="text-[10px] text-devo-muted font-mono">@${u.username}</div>
                </td>
                <td class="px-3 py-3">
                    <span class="px-2.5 py-1 rounded-md text-[10px] font-bold border inline-block ${roleClass}">
                        ${roleName}
                    </span>
                </td>
                <td class="px-3 py-3 text-center">${statusBadge}</td>
                <td class="px-3 py-3 text-center font-bold text-white text-sm">
                    ${u.ordersCount.toLocaleString('ar-EG')}
                    <div class="text-[10px] text-devo-muted font-normal">(${u.soldSeries} سيري)</div>
                </td>
                <td class="px-3 py-3 font-bold text-devo-orange text-sm whitespace-nowrap">
                    ${u.totalSales.toLocaleString('ar-EG')} ج.م
                </td>
                <td class="px-3 py-3 font-bold text-devo-success whitespace-nowrap">
                    ${u.totalDeposit > 0 ? `${u.totalDeposit.toLocaleString('ar-EG')} ج.م` : '<span class="text-devo-muted font-normal">-</span>'}
                </td>
                <td class="px-3 py-3 text-white whitespace-nowrap">
                    ${Math.round(u.avgOrderVal).toLocaleString('ar-EG')} ج.م
                </td>
            </tr>
        `;
    }).join('');

    if (tFoot) {
        tFoot.innerHTML = `
            <tr class="bg-devo-dark font-bold text-white border-t-2 border-devo-orange/50 text-xs">
                <td colspan="4" class="px-4 py-3 text-left">إجمالي إنتاجية الفريق المفلترة (${staffList.length} موظف):</td>
                <td class="px-3 py-3 text-center text-white text-sm">${totalTeamOrders.toLocaleString('ar-EG')} أوردر</td>
                <td class="px-3 py-3 text-devo-orange text-base whitespace-nowrap">${totalTeamSales.toLocaleString('ar-EG')} ج.م</td>
                <td class="px-3 py-3 text-devo-success text-base whitespace-nowrap">${totalTeamDeposits.toLocaleString('ar-EG')} ج.م</td>
                <td></td>
            </tr>
        `;
    }
}

// ==========================================
// 🖨️ Master Print Engine (With / Without Cards)
// ==========================================
export function executeActiveReportPrint(withCards = true) {
    let reportTitle = '';
    let filterSubtitle = '';
    let statsCardsHtml = '';
    let tableHeadersHtml = '';
    let tableRowsHtml = '';
    let tableFootersHtml = '';

    const currentDateStr = new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    switch (currentTab) {
        case 'sales': {
            if (filteredSalesData.length === 0) {
                showToast('لا توجد بيانات مطابقة للطباعة في تقرير المبيعات!', 'warning');
                return;
            }
            reportTitle = 'تقرير المبيعات والأوردرات الشامل';
            const periodText = getSelectedOptionText('rep-sales-period');
            filterSubtitle = `الفترة: ${periodText}`;

            // Stats
            let totalSales = 0, totalDep = 0, totalSer = 0, totalPcs = 0;
            filteredSalesData.forEach(o => {
                totalSales += parseFloat(o.total_price) || 0;
                totalDep += parseFloat(o.deposit) || 0;
                o.order_items?.forEach(i => {
                    const q = i.quantity || 0;
                    totalSer += q;
                    totalPcs += q * (i.models?.classes?.class_sizes?.length || 1);
                });
            });

            if (withCards) {
                statsCardsHtml = `
                    <div class="stats-grid">
                        <div class="stat-box"><span class="stat-label">إجمالي المبيعات</span><span class="stat-val text-orange">${totalSales.toLocaleString('ar-EG')} ج.م</span></div>
                        <div class="stat-box"><span class="stat-label">عدد الأوردرات</span><span class="stat-val">${filteredSalesData.length}</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي الكمية</span><span class="stat-val">${totalSer} سيري (${totalPcs} ق)</span></div>
                        <div class="stat-box"><span class="stat-label">العربون المحصل</span><span class="stat-val text-green">${totalDep.toLocaleString('ar-EG')} ج.م</span></div>
                        <div class="stat-box"><span class="stat-label">المتبقي</span><span class="stat-val">${(totalSales - totalDep).toLocaleString('ar-EG')} ج.م</span></div>
                    </div>
                `;
            }

            tableHeadersHtml = `
                <tr>
                    <th style="width: 30px;">#</th>
                    <th>رقم الأوردر</th>
                    <th>التاريخ والوقت</th>
                    <th>العميل والهاتف</th>
                    <th>الموظف</th>
                    <th>الحالة</th>
                    <th>الكمية</th>
                    <th>الإجمالي</th>
                    <th>العربون</th>
                </tr>
            `;

            tableRowsHtml = filteredSalesData.map((o, idx) => {
                const dateObj = new Date(o.created_at);
                const dStr = dateObj.toLocaleDateString('ar-EG');
                const tStr = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
                let sCount = 0;
                o.order_items?.forEach(i => sCount += i.quantity || 0);

                return `
                    <tr>
                        <td class="text-center">${idx + 1}</td>
                        <td class="text-center font-bold font-mono">#${o.invoice_number || o.order_number || o.id}</td>
                        <td class="text-center">${dStr} <span class="time-sub">(${tStr})</span></td>
                        <td><b>${o.customer_name || 'نقدي'}</b> <span class="phone-sub">(${o.phone_1 || o.customer_phone || '-'})</span></td>
                        <td>${o.system_users?.full_name || '-'}</td>
                        <td class="text-center">${getStatusText(o.status)}</td>
                        <td class="text-center font-bold">${sCount} سيري</td>
                        <td class="text-center font-bold">${(parseFloat(o.total_price) || 0).toLocaleString('ar-EG')} ج.م</td>
                        <td class="text-center font-bold">${(parseFloat(o.deposit) || 0).toLocaleString('ar-EG')} ج.م</td>
                    </tr>
                `;
            }).join('');

            tableFootersHtml = `
                <tr class="footer-row">
                    <td colspan="6" style="text-align: left;">إجمالي المبيعات المفلترة (${filteredSalesData.length} أوردر):</td>
                    <td class="text-center font-bold">${totalSer} سيري</td>
                    <td class="text-center font-bold">${totalSales.toLocaleString('ar-EG')} ج.م</td>
                    <td class="text-center font-bold">${totalDep.toLocaleString('ar-EG')} ج.م</td>
                </tr>
            `;
            break;
        }

        case 'deposits': {
            if (filteredDepositsData.length === 0) {
                showToast('لا توجد بيانات مطابقة للطباعة في تقرير العربون!', 'warning');
                return;
            }
            reportTitle = 'تقرير العربون والمقبوضات المقدمة';
            const periodText = getSelectedOptionText('rep-dep-period');
            filterSubtitle = `الفترة: ${periodText}`;

            let totalDep = 0;
            filteredDepositsData.forEach(o => totalDep += parseFloat(o.deposit) || 0);

            if (withCards) {
                statsCardsHtml = `
                    <div class="stats-grid">
                        <div class="stat-box"><span class="stat-label">إجمالي مبالغ العربون</span><span class="stat-val text-green">${totalDep.toLocaleString('ar-EG')} ج.م</span></div>
                        <div class="stat-box"><span class="stat-label">عدد العمليات</span><span class="stat-val">${filteredDepositsData.length}</span></div>
                        <div class="stat-box"><span class="stat-label">متوسط العربون</span><span class="stat-val">${Math.round(totalDep / filteredDepositsData.length).toLocaleString('ar-EG')} ج.م</span></div>
                    </div>
                `;
            }

            tableHeadersHtml = `
                <tr>
                    <th style="width: 30px;">#</th>
                    <th>رقم الأوردر</th>
                    <th>التاريخ</th>
                    <th>العميل</th>
                    <th>الهاتف</th>
                    <th>الموظف</th>
                    <th>مستلم العربون</th>
                    <th>قيمة العربون</th>
                </tr>
            `;

            tableRowsHtml = filteredDepositsData.map((o, idx) => {
                const dateObj = new Date(o.created_at);
                const dStr = dateObj.toLocaleDateString('ar-EG');
                const tStr = dateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

                return `
                    <tr>
                        <td class="text-center">${idx + 1}</td>
                        <td class="text-center font-bold font-mono">#${o.invoice_number || o.order_number || o.id}</td>
                        <td class="text-center">${dStr} <span class="time-sub">(${tStr})</span></td>
                        <td><b>${o.customer_name || 'غير مسمى'}</b></td>
                        <td class="text-center font-mono" dir="ltr">${o.phone_1 || o.customer_phone || '-'}</td>
                        <td>${o.system_users?.full_name || '-'}</td>
                        <td class="text-center font-bold">${o.deposit_receiver || '-'}</td>
                        <td class="text-center font-bold bg-green-light">${(parseFloat(o.deposit) || 0).toLocaleString('ar-EG')} ج.م</td>
                    </tr>
                `;
            }).join('');

            tableFootersHtml = `
                <tr class="footer-row">
                    <td colspan="7" style="text-align: left;">إجمالي مبالغ العربون المحصلة (${filteredDepositsData.length} حركة):</td>
                    <td class="text-center font-bold">${totalDep.toLocaleString('ar-EG')} ج.م</td>
                </tr>
            `;
            break;
        }

        case 'inventory': {
            if (filteredInventoryData.length === 0) {
                showToast('لا توجد بيانات مطابقة للطباعة في تقرير المخزن!', 'warning');
                return;
            }
            reportTitle = 'تقرير المخزن وحالة الأرصدة وقيمة البضاعة';
            filterSubtitle = `تاريخ الجرد: ${currentDateStr}`;

            let totalSer = 0, totalPcs = 0, totalVal = 0;
            filteredInventoryData.forEach(m => {
                totalSer += m.totalSeries;
                totalPcs += m.totalPieces;
                totalVal += m.totalStockValue;
            });

            if (withCards) {
                statsCardsHtml = `
                    <div class="stats-grid">
                        <div class="stat-box"><span class="stat-label">إجمالي الموديلات</span><span class="stat-val">${filteredInventoryData.length}</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي السيريهات</span><span class="stat-val text-orange">${totalSer.toLocaleString('ar-EG')} سيري</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي القطع التقديرية</span><span class="stat-val">${totalPcs.toLocaleString('ar-EG')} قطعة</span></div>
                        <div class="stat-box"><span class="stat-label">القيمة الإجمالية للمخزون</span><span class="stat-val text-green">${totalVal.toLocaleString('ar-EG')} ج.م</span></div>
                    </div>
                `;
            }

            tableHeadersHtml = `
                <tr>
                    <th style="width: 30px;">#</th>
                    <th>كود المصنع</th>
                    <th>كود السيستم</th>
                    <th>اسم الموديل</th>
                    <th>القسم / الفئة</th>
                    <th>تفاصيل ألوان الرصيد</th>
                    <th>الرصيد الكلي</th>
                    <th>السعر</th>
                    <th>القيمة الإجمالية</th>
                </tr>
            `;

            tableRowsHtml = filteredInventoryData.map((m, idx) => {
                const colorStrs = m.variants.map(v => `${v.colors?.name || 'لون'}: ${v.available_series || 0}`).join(' | ');

                return `
                    <tr>
                        <td class="text-center">${idx + 1}</td>
                        <td class="text-center font-bold font-mono">${m.factory_code || '-'}</td>
                        <td class="text-center font-mono">${m.system_code || '-'}</td>
                        <td><b>${m.name}</b></td>
                        <td>${m.categories?.name || '-'} / ${m.classes?.name || '-'}</td>
                        <td style="font-size: 9px;">${colorStrs || 'لا يوجد تفاصيل'}</td>
                        <td class="text-center font-bold">${m.totalSeries} سيري (${m.totalPieces} ق)</td>
                        <td class="text-center font-bold">${(parseFloat(m.price) || 0).toLocaleString('ar-EG')} ج.م</td>
                        <td class="text-center font-bold text-orange">${m.totalStockValue.toLocaleString('ar-EG')} ج.م</td>
                    </tr>
                `;
            }).join('');

            tableFootersHtml = `
                <tr class="footer-row">
                    <td colspan="6" style="text-align: left;">إجمالي المخزون المفلتر (${filteredInventoryData.length} موديل):</td>
                    <td class="text-center font-bold">${totalSer} سيري (${totalPcs} ق)</td>
                    <td></td>
                    <td class="text-center font-bold">${totalVal.toLocaleString('ar-EG')} ج.م</td>
                </tr>
            `;
            break;
        }

        case 'models': {
            if (filteredModelsData.length === 0) {
                showToast('لا توجد بيانات مطابقة للطباعة في تقرير حركة الموديلات!', 'warning');
                return;
            }
            reportTitle = 'تقرير حركة الموديلات والمبيعات';
            const periodText = getSelectedOptionText('rep-models-period');
            filterSubtitle = `الفترة: ${periodText}`;

            let totalSold = 0, totalRev = 0;
            filteredModelsData.forEach(m => {
                totalSold += m.soldSeries;
                totalRev += m.totalRevenue;
            });

            if (withCards) {
                statsCardsHtml = `
                    <div class="stats-grid">
                        <div class="stat-box"><span class="stat-label">الموديلات المدرجة</span><span class="stat-val">${filteredModelsData.length}</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي السيريهات المباعة</span><span class="stat-val text-orange">${totalSold.toLocaleString('ar-EG')} سيري</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي الإيرادات المحققة</span><span class="stat-val text-green">${totalRev.toLocaleString('ar-EG')} ج.م</span></div>
                    </div>
                `;
            }

            tableHeadersHtml = `
                <tr>
                    <th style="width: 30px;">#</th>
                    <th>كود المصنع</th>
                    <th>اسم الموديل</th>
                    <th>القسم</th>
                    <th>سعر السيرية</th>
                    <th>الكمية المباعة</th>
                    <th>الإيراد المحقق</th>
                    <th>الرصيد المتبقي</th>
                </tr>
            `;

            tableRowsHtml = filteredModelsData.map((m, idx) => `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    <td class="text-center font-mono font-bold">${m.factory_code || '-'}</td>
                    <td><b>${m.name}</b> <span class="font-mono text-muted">(${m.system_code})</span></td>
                    <td>${m.categories?.name || '-'}</td>
                    <td class="text-center">${(parseFloat(m.price) || 0).toLocaleString('ar-EG')} ج.م</td>
                    <td class="text-center font-bold text-orange">${m.soldSeries} سيري (${m.soldPieces} ق)</td>
                    <td class="text-center font-bold text-green">${m.totalRevenue.toLocaleString('ar-EG')} ج.م</td>
                    <td class="text-center font-bold">${m.currentStockSeries} سيري</td>
                </tr>
            `).join('');

            tableFootersHtml = `
                <tr class="footer-row">
                    <td colspan="5" style="text-align: left;">إجمالي المبيعات المحققة للموديلات:</td>
                    <td class="text-center font-bold">${totalSold} سيري</td>
                    <td class="text-center font-bold">${totalRev.toLocaleString('ar-EG')} ج.م</td>
                    <td></td>
                </tr>
            `;
            break;
        }

        case 'staff': {
            if (filteredStaffData.length === 0) {
                showToast('لا توجد بيانات مطابقة للطباعة في تقرير العمال!', 'warning');
                return;
            }
            reportTitle = 'تقرير إنتاجية ومبيعات الحسابات والعمال';
            const periodText = getSelectedOptionText('rep-staff-period');
            filterSubtitle = `الفترة: ${periodText}`;

            let totalSales = 0, totalDep = 0, totalOrders = 0;
            filteredStaffData.forEach(u => {
                totalSales += u.totalSales;
                totalDep += u.totalDeposit;
                totalOrders += u.ordersCount;
            });

            if (withCards) {
                statsCardsHtml = `
                    <div class="stats-grid">
                        <div class="stat-box"><span class="stat-label">عدد الموظفين</span><span class="stat-val">${filteredStaffData.length}</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي الأوردرات</span><span class="stat-val">${totalOrders} أوردر</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي مبيعات الفريق</span><span class="stat-val text-orange">${totalSales.toLocaleString('ar-EG')} ج.م</span></div>
                        <div class="stat-box"><span class="stat-label">إجمالي العربون المحصل</span><span class="stat-val text-green">${totalDep.toLocaleString('ar-EG')} ج.م</span></div>
                    </div>
                `;
            }

            tableHeadersHtml = `
                <tr>
                    <th style="width: 30px;">#</th>
                    <th>اسم الموظف</th>
                    <th>اسم المستخدم</th>
                    <th>الصلاحية</th>
                    <th>الحالة</th>
                    <th>عدد الفواتير</th>
                    <th>إجمالي المبيعات</th>
                    <th>إجمالي العربون</th>
                    <th>متوسط الفاتورة</th>
                </tr>
            `;

            tableRowsHtml = filteredStaffData.map((u, idx) => `
                <tr>
                    <td class="text-center">${idx + 1}</td>
                    <td><b>${u.full_name}</b></td>
                    <td class="text-center font-mono">@${u.username}</td>
                    <td class="text-center">${u.role === 'owner' ? 'مالك' : u.role === 'admin' ? 'مدير' : 'بائع'}</td>
                    <td class="text-center">${u.is_active ? 'نشط' : 'معطل'}</td>
                    <td class="text-center font-bold">${u.ordersCount} (${u.soldSeries} سيري)</td>
                    <td class="text-center font-bold text-orange">${u.totalSales.toLocaleString('ar-EG')} ج.م</td>
                    <td class="text-center font-bold text-green">${u.totalDeposit > 0 ? `${u.totalDeposit.toLocaleString('ar-EG')} ج.م` : '-'}</td>
                    <td class="text-center">${Math.round(u.avgOrderVal).toLocaleString('ar-EG')} ج.م</td>
                </tr>
            `).join('');

            tableFootersHtml = `
                <tr class="footer-row">
                    <td colspan="5" style="text-align: left;">إجمالي إنتاجية الفريق (${filteredStaffData.length} موظف):</td>
                    <td class="text-center font-bold">${totalOrders} أوردر</td>
                    <td class="text-center font-bold">${totalSales.toLocaleString('ar-EG')} ج.م</td>
                    <td class="text-center font-bold">${totalDep.toLocaleString('ar-EG')} ج.م</td>
                    <td></td>
                </tr>
            `;
            break;
        }
    }

    const printDocHtml = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>${reportTitle}_${new Date().toISOString().split('T')[0]}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;600;700;900&display=swap');
                @page {
                    size: A4 portrait;
                    margin: 0.5cm;
                }
                body {
                    font-family: 'Tajawal', sans-serif;
                    background: white;
                    color: black;
                    margin: 0;
                    padding: 0;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                    font-size: 11px;
                }
                .report-header {
                    border-bottom: 2px solid #000;
                    padding-bottom: 6px;
                    margin-bottom: 8px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .brand-title {
                    font-size: 20px;
                    font-weight: 900;
                    letter-spacing: 1px;
                }
                .report-title {
                    font-size: 15px;
                    font-weight: 700;
                    text-align: center;
                }
                .meta-info {
                    font-size: 10px;
                    color: #444;
                }
                .stats-grid {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    background: #f8fafc;
                    border: 1px solid #cbd5e1;
                    padding: 6px 10px;
                    margin-bottom: 8px;
                    border-radius: 4px;
                }
                .stat-box {
                    flex: 1;
                    min-width: 100px;
                    display: flex;
                    flex-direction: column;
                }
                .stat-label {
                    font-size: 9px;
                    color: #64748b;
                    font-weight: bold;
                }
                .stat-val {
                    font-size: 12px;
                    font-weight: 900;
                    color: #0f172a;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 4px;
                }
                th, td {
                    border: 1px solid #333;
                    padding: 4px 6px;
                    font-size: 10px;
                }
                th {
                    background-color: #f1f5f9 !important;
                    font-weight: bold;
                    text-align: center;
                }
                .footer-row {
                    background-color: #f8fafc !important;
                    font-weight: 900;
                }
                .text-center { text-align: center; }
                .font-bold { font-weight: bold; }
                .font-mono { font-family: monospace; }
                .time-sub { font-size: 9px; color: #555; }
                .phone-sub { font-size: 9px; font-family: monospace; }
                .text-orange { color: #d97706; }
                .text-green { color: #16a34a; }
                .bg-green-light { background-color: #f0fdf4 !important; }
            </style>
        </head>
        <body>
            <div class="report-header">
                <div>
                    <div class="brand-title">DEVO COLLECTION</div>
                    <div class="meta-info">منظومة الإدارة والمبيعات</div>
                </div>
                <div style="text-align: center;">
                    <div class="report-title">${reportTitle}</div>
                    <div class="meta-info">${filterSubtitle}</div>
                </div>
                <div style="text-align: left;">
                    <div class="meta-info">تاريخ الطباعة:</div>
                    <div class="meta-info" style="font-weight: bold;">${currentDateStr}</div>
                </div>
            </div>

            ${statsCardsHtml}

            <table>
                <thead>
                    ${tableHeadersHtml}
                </thead>
                <tbody>
                    ${tableRowsHtml}
                </tbody>
                <tfoot>
                    ${tableFootersHtml}
                </tfoot>
            </table>
        </body>
        </html>
    `;

    printHtmlInIframe(printDocHtml);
}

// ==========================================
// 🛠️ Helper Utilities
// ==========================================
function setStatText(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = text;
}

function getSelectedOptionText(selectId) {
    const el = document.getElementById(selectId);
    if (!el) return '';
    return el.options[el.selectedIndex]?.text || '';
}

function getStatusBadge(status) {
    switch (status) {
        case 'pending':
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/40">قيد الانتظار</span>';
        case 'confirmed':
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/40">مؤكد</span>';
        case 'prepared':
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-400 border border-purple-500/40">تم التجهيز</span>';
        case 'completed':
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-devo-success/20 text-devo-success border border-devo-success/40">مكتمل</span>';
        case 'cancelled':
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-devo-error/20 text-devo-error border border-devo-error/40">ملغي</span>';
        default:
            return `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-devo-gray text-white">${status || '-'}</span>`;
    }
}

function getStatusText(status) {
    switch (status) {
        case 'pending': return 'قيد الانتظار';
        case 'confirmed': return 'مؤكد';
        case 'prepared': return 'تم التجهيز';
        case 'completed': return 'مكتمل';
        case 'cancelled': return 'ملغي';
        default: return status || '-';
    }
}
