import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { getCurrentSession } from '../../services/auth.js';

let isInitialized = false;
let inboundInvoices = [];
let modelsCache = [];
let currentUser = null;

// Local state for the current draft invoice being created or edited
let draftInvoice = {
    id: null,           // null for new invoice, uuid for editing
    supplier_name: '',
    notes: '',
    items: []           // array of { model_id, model_code, model_name, color_id, color_name, qty, current_stock }
};

export async function initInboundInvoicesView() {
    if (isInitialized) return;

    // Load active session user
    const { session } = getCurrentSession();
    currentUser = session?.user;

    // Register event listeners for filters & search
    const searchInput = document.getElementById('inbound-search');
    if (searchInput) searchInput.addEventListener('input', renderInboundInvoicesList);

    const dateFrom = document.getElementById('inbound-date-from');
    if (dateFrom) dateFrom.addEventListener('input', renderInboundInvoicesList);

    const dateTo = document.getElementById('inbound-date-to');
    if (dateTo) dateTo.addEventListener('input', renderInboundInvoicesList);

    // Expose functions to window for onclick handlers
    window.openNewInboundInvoiceForm = openNewInboundInvoiceForm;
    window.closeInboundInvoiceForm = closeInboundInvoiceForm;
    window.handleAddModelToInvoice = handleAddModelToInvoice;
    window.handleSaveInboundInvoice = handleSaveInboundInvoice;
    window.editInboundInvoice = editInboundInvoice;
    window.deleteInboundInvoice = deleteInboundInvoice;
    window.removeModelFromInvoiceDraft = removeModelFromInvoiceDraft;
    window.updateDraftItemQty = updateDraftItemQty;
    window.populateModelSelectDropdown = populateModelSelectDropdown;
    window.exportInboundInvoiceToExcel = exportInboundInvoiceToExcel;

    // Load initial data from Supabase
    await loadInboundData();
    isInitialized = true;
}

// 🌟 Fetch database data: Inbound Invoices and Models with Inventory 🌟
export async function loadInboundData() {
    try {
        const activeSection = document.getElementById('view-add-batch');
        if (!activeSection) return;

        // Show spinner in list tbody
        const tbody = document.getElementById('inbound-list-tbody');
        if (tbody) {
            tbody.innerHTML = `
                <tr class="no-data-row">
                    <td colspan="7" class="p-8 text-center text-devo-muted">
                        <i class="ph ph-spinner animate-spin text-2xl mb-2 block mx-auto text-devo-orange"></i>
                        جاري تحميل فواتير الدخل...
                    </td>
                </tr>
            `;
        }

        // 1. Fetch Inbound Invoices
        const { data: invoicesData, error: invoicesError } = await supabase
            .from('inbound_invoices')
            .select(`
                id, invoice_number, supplier_name, total_series, notes, created_at,
                system_users:worker_id(id, full_name)
            `)
            .order('created_at', { ascending: false });

        if (invoicesError) throw invoicesError;
        inboundInvoices = invoicesData || [];

        // 2. Fetch Models and their inventories (only active models)
        const { data: modelsData, error: modelsError } = await supabase
            .from('models')
            .select(`
                id, system_code, factory_code, name, is_active, price, class_id,
                classes(id, name, class_sizes(size_id, sizes(id, name))),
                model_sizes(size_id, sizes(id, name)),
                model_inventory(color_id, available_series, colors(id, name))
            `);

        if (modelsError) throw modelsError;

        // Fetch all colors globally to fallback on models with no color inventory entries
        const { data: colorsData, error: colorsError } = await supabase
            .from('colors')
            .select('id, name')
            .order('name');

        if (colorsError) throw colorsError;
        const allColors = colorsData || [];

        modelsCache = (modelsData || []).map(m => {
            let inv = m.model_inventory || [];
            if (inv.length === 0) {
                // If model has no colors in inventory, populate it with all system colors at 0 stock
                inv = allColors.map(c => ({
                    color_id: c.id,
                    available_series: 0,
                    colors: { id: c.id, name: c.name }
                }));
            }
            return {
                ...m,
                model_inventory: inv
            };
        });

        // 3. Render List and Dropdown
        renderInboundInvoicesList();
        populateModelSelectDropdown();
        updateStats();

    } catch (err) {
        console.error("Load Inbound Data Error:", err);
        showToast('خطأ في تحميل فواتير الدخل من السيرفر', 'error');
    }
}

// 🌟 Calculate and update fast summary stats cards 🌟
function updateStats() {
    const totalCountEl = document.getElementById('inbound-stat-count');
    const totalQtyEl = document.getElementById('inbound-stat-total-qty');

    if (totalCountEl) totalCountEl.textContent = inboundInvoices.length;
    if (totalQtyEl) {
        const totalQty = inboundInvoices.reduce((sum, inv) => sum + (inv.total_series || 0), 0);
        totalQtyEl.textContent = totalQty;
    }
}

// 🌟 Render table list of Inbound Invoices 🌟
function renderInboundInvoicesList() {
    const tbody = document.getElementById('inbound-list-tbody');
    if (!tbody) return;

    const searchQuery = document.getElementById('inbound-search')?.value.toLowerCase().trim() || '';
    const dateFromVal = document.getElementById('inbound-date-from')?.value || '';
    const dateToVal = document.getElementById('inbound-date-to')?.value || '';

    // Filter invoices locally
    const filteredInvoices = inboundInvoices.filter(inv => {
        // Search filter
        const matchesSearch = !searchQuery || 
            inv.invoice_number.toLowerCase().includes(searchQuery) ||
            (inv.system_users?.full_name && inv.system_users.full_name.toLowerCase().includes(searchQuery));

        // Date filter
        let matchesDate = true;
        if (dateFromVal) {
            const fromDate = new Date(dateFromVal + 'T00:00:00');
            const invDate = new Date(inv.created_at);
            matchesDate = matchesDate && (invDate >= fromDate);
        }
        if (dateToVal) {
            const toDate = new Date(dateToVal + 'T23:59:59');
            const invDate = new Date(inv.created_at);
            matchesDate = matchesDate && (invDate <= toDate);
        }

        return matchesSearch && matchesDate;
    });

    if (filteredInvoices.length === 0) {
        tbody.innerHTML = `
            <tr class="no-data-row">
                <td colspan="5" class="p-8 text-center text-devo-muted">
                    <i class="ph ph-warning text-2xl mb-1 block mx-auto"></i>
                    لا توجد فواتير دخل مطابقة لخيارات البحث
                </td>
            </tr>
        `;
        return;
    }

    const canModify = currentUser && ['owner', 'admin'].includes(currentUser.role);

    tbody.innerHTML = filteredInvoices.map(inv => {
        const dateStr = new Date(inv.created_at).toLocaleString('ar-EG', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const actions = canModify ? `
            <div class="flex items-center justify-center gap-2">
                <button onclick="exportInboundInvoiceToExcel('${inv.id}')" 
                    title="تصدير إلى إكسيل (Excel)"
                    class="p-1.5 bg-devo-success/10 text-devo-success hover:bg-devo-success hover:text-white rounded transition-all cursor-pointer">
                    <i class="ph ph-file-xls text-sm"></i>
                </button>
                <button onclick="editInboundInvoice('${inv.id}')" 
                    title="تعديل الفاتورة"
                    class="p-1.5 bg-devo-orange/10 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-all cursor-pointer">
                    <i class="ph ph-pencil-simple text-sm"></i>
                </button>
                <button onclick="deleteInboundInvoice('${inv.id}')" 
                    title="حذف الفاتورة"
                    class="p-1.5 bg-devo-error/10 text-devo-error hover:bg-devo-error hover:text-white rounded transition-all cursor-pointer">
                    <i class="ph ph-trash text-sm"></i>
                </button>
            </div>
        ` : `<span class="text-devo-muted">-</span>`;

        return `
            <tr class="hover:bg-devo-gray/25 transition-colors border-b border-devo-gray/30">
                <td class="p-4 font-bold text-devo-orange">${inv.invoice_number}</td>
                <td class="p-4 font-black">${inv.total_series} سري</td>
                <td class="p-4 text-devo-muted">${inv.system_users?.full_name || 'غير معروف'}</td>
                <td class="p-4 text-xs text-devo-muted" dir="ltr">${dateStr}</td>
                <td class="p-4 text-center">${actions}</td>
            </tr>
        `;
    }).join('');
}

// 🌟 Populate & filter model selection dropdown list 🌟
function populateModelSelectDropdown() {
    const select = document.getElementById('inbound-model-select');
    if (!select) return;

    const activeFilter = document.getElementById('inbound-model-filter')?.value || 'all';

    const filteredModels = modelsCache.filter(m => {
        const hasColors = m.model_inventory && m.model_inventory.length > 0;
        if (!hasColors) return false;

        const totalStock = m.model_inventory.reduce((sum, inv) => sum + (inv.available_series || 0), 0);

        if (activeFilter === 'active') {
            return m.is_active;
        } else if (activeFilter === 'inactive') {
            return !m.is_active;
        } else if (activeFilter === 'active_zero') {
            return m.is_active && totalStock === 0;
        } else if (activeFilter === 'active_not_zero') {
            return m.is_active && totalStock > 0;
        } else if (activeFilter === 'active_under_five') {
            return m.is_active && totalStock < 5;
        } else if (activeFilter === 'inactive_under_five') {
            return !m.is_active && totalStock < 5;
        }
        
        return true; // 'all'
    });

    select.innerHTML = '<option value="">-- اختر الموديل --</option>' + 
        filteredModels.map(m => `
            <option value="${m.id}">[${m.factory_code}] ${m.name}${m.is_active ? '' : ' (غير نشط)'}</option>
        `).join('');
}


// 🌟 Switch views: list view to form view 🌟
function openNewInboundInvoiceForm() {
    // Reset local draft state
    draftInvoice = {
        id: null,
        supplier_name: '',
        notes: '',
        items: []
    };

    // Update UI elements
    document.getElementById('inbound-form-title').innerHTML = `<i class="ph ph-plus-circle text-devo-orange text-lg"></i> إنشاء فاتورة دخل جديدة`;
    
    const filterSelect = document.getElementById('inbound-model-filter');
    if (filterSelect) filterSelect.value = 'all';
    
    populateModelSelectDropdown();


    renderDraftItems();

    // Toggle visibility
    document.getElementById('inbound-list-section').classList.add('hidden');
    document.getElementById('inbound-form-section').classList.remove('hidden');
}

function closeInboundInvoiceForm() {
    // Toggle visibility
    document.getElementById('inbound-form-section').classList.add('hidden');
    document.getElementById('inbound-list-section').classList.remove('hidden');
}

// 🌟 Add model cards to the local draft invoice 🌟
function handleAddModelToInvoice() {
    const select = document.getElementById('inbound-model-select');
    const modelId = select.value;
    if (!modelId) {
        showToast('يرجى اختيار موديل أولاً', 'warning');
        return;
    }

    // Check if already added
    const alreadyExists = draftInvoice.items.some(item => item.model_id === modelId);
    if (alreadyExists) {
        showToast('هذا الموديل مضاف بالفعل في مسودة الفاتورة', 'warning');
        return;
    }

    const model = modelsCache.find(m => m.id === modelId);
    if (!model || !model.model_inventory || model.model_inventory.length === 0) {
        showToast('لا توجد ألوان مهيأة لهذا الموديل', 'warning');
        return;
    }

    // Add all model color combinations to local draft items
    model.model_inventory.forEach(inv => {
        draftInvoice.items.push({
            model_id: model.id,
            model_code: model.factory_code,
            model_name: model.name,
            color_id: inv.color_id,
            color_name: inv.colors?.name || 'بدون اسم',
            qty: 0,
            current_stock: inv.available_series || 0
        });
    });

    // Reset dropdown and render cards
    select.value = '';
    populateModelSelectDropdown();
    
    renderDraftItems();
    showToast(`تمت إضافة الموديل [${model.factory_code}] للمسودة`, 'success');
}

// 🌟 Remove model card from local draft invoice 🌟
window.removeModelFromInvoiceDraft = (modelId) => {
    draftInvoice.items = draftInvoice.items.filter(item => item.model_id !== modelId);
    renderDraftItems();
};

// 🌟 Update local draft item quantity in real-time 🌟
window.updateDraftItemQty = (modelId, colorId, val) => {
    const qty = parseInt(val) || 0;
    const item = draftInvoice.items.find(i => i.model_id === modelId && i.color_id === colorId);
    if (item) {
        item.qty = qty;

        // Update expected stock cell directly in DOM to keep input fast and non-laggy
        const currentStock = item.current_stock || 0;
        const expectedStock = currentStock + qty;
        const cell = document.getElementById(`expected-stock-${modelId}-${colorId}`);
        if (cell) {
            cell.textContent = `${expectedStock} سري`;
            if (expectedStock > currentStock) {
                cell.className = "py-2 font-bold text-devo-success";
            } else {
                cell.className = "py-2 font-bold text-devo-muted";
            }
        }

        calculateTotalSeries();
    }
};

function calculateTotalSeries() {
    const total = draftInvoice.items.reduce((sum, item) => sum + (item.qty || 0), 0);
    const sumEl = document.getElementById('inbound-summary-total-series');
    if (sumEl) sumEl.textContent = total;
}

// 🌟 Render draft items inside the form view 🌟
function renderDraftItems() {
    const container = document.getElementById('inbound-added-items-container');
    if (!container) return;

    if (draftInvoice.items.length === 0) {
        container.innerHTML = `
            <div class="bg-devo-dark border border-devo-gray/50 rounded-xl p-8 text-center text-devo-muted">
                <i class="ph ph-shopping-bag-open text-4xl block mx-auto mb-2 text-devo-muted/60"></i>
                لم يتم إضافة أي موديلات للفاتورة بعد. اختر موديل من القائمة أعلاه للبدء في تعبئة أعداده.
            </div>
        `;
        const sumEl = document.getElementById('inbound-summary-total-series');
        if (sumEl) sumEl.textContent = '0';
        return;
    }

    // Group items by model to show them as neat blocks/cards
    const grouped = {};
    draftInvoice.items.forEach(item => {
        if (!grouped[item.model_id]) {
            grouped[item.model_id] = {
                model_id: item.model_id,
                model_code: item.model_code,
                model_name: item.model_name,
                colors: []
            };
        }
        grouped[item.model_id].colors.push(item);
    });

    let html = '';
    Object.values(grouped).forEach(m => {
        html += `
            <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 shadow-sm space-y-3" id="draft-model-card-${m.model_id}">
                <div class="flex justify-between items-center border-b border-devo-gray pb-2">
                    <div class="flex items-center gap-2">
                        <span class="bg-devo-orange/10 text-devo-orange border border-devo-orange/20 px-2 py-0.5 rounded text-[10px] font-bold">كود: ${m.model_code}</span>
                        <h4 class="text-sm font-bold text-white">${m.model_name}</h4>
                    </div>
                    <button onclick="removeModelFromInvoiceDraft('${m.model_id}')" 
                        class="text-xs text-devo-error hover:text-red-400 transition-colors flex items-center gap-1 cursor-pointer">
                        <i class="ph ph-trash"></i>
                        <span>حذف الموديل</span>
                    </button>
                </div>
                
                <div class="overflow-x-auto">
                    <table class="w-full text-right text-xs">
                        <thead>
                            <tr class="text-devo-muted font-bold">
                                <th class="pb-2">اللون</th>
                                <th class="pb-2">الرصيد الحالي بالمخزن</th>
                                <th class="pb-2">الكمية المضافة للدفعة (سري)</th>
                                <th class="pb-2">الرصيد بعد الإضافة (الرصيد المتوقع)</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-devo-gray/30">
                            ${m.colors.map(c => {
                                const currentStock = c.current_stock || 0;
                                const addedQty = c.qty || 0;
                                const expectedStock = currentStock + addedQty;
                                return `
                                    <tr class="align-middle">
                                        <td class="py-2 text-white font-bold">${c.color_name}</td>
                                        <td class="py-2 text-devo-muted">${currentStock} سري</td>
                                        <td class="py-2">
                                            <input type="number" min="0" value="${addedQty || ''}" placeholder="0"
                                                oninput="updateDraftItemQty('${m.model_id}', '${c.color_id}', this.value)"
                                                id="input-qty-${m.model_id}-${c.color_id}"
                                                class="w-24 bg-devo-black border border-devo-gray rounded px-2.5 py-1.5 text-white text-xs outline-none focus:border-devo-orange transition-all text-center">
                                        </td>
                                        <td class="py-2 font-bold ${expectedStock > currentStock ? 'text-devo-success' : 'text-devo-muted'}" 
                                            id="expected-stock-${m.model_id}-${c.color_id}">
                                            ${expectedStock} سري
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
    calculateTotalSeries();
}

// 🌟 Save Inbound Invoice (Create/Edit) to database with safety check 🌟
async function handleSaveInboundInvoice() {
    const btn = document.getElementById('inbound-btn-save');
    const totalSeries = parseInt(document.getElementById('inbound-summary-total-series').textContent) || 0;

    if (draftInvoice.items.length === 0) {
        showToast('يرجى إضافة موديل واحد على الأقل للمسودة', 'warning');
        return;
    }

    if (totalSeries <= 0) {
        showToast('يرجى إدخال كمية مضافة أكبر من الصفر لصنف واحد على الأقل', 'warning');
        return;
    }

    btn.disabled = true;
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin text-lg"></i> جاري حفظ الفاتورة...`;

    try {
        // Build items list, filtering out items with zero quantity
        const itemsToSend = draftInvoice.items
            .filter(item => (item.qty || 0) > 0)
            .map(item => ({
                model_id: item.model_id,
                color_id: item.color_id,
                qty: item.qty
            }));

        // Call database transaction RPC
        const { data, error } = await supabase.rpc('process_inbound_transaction', {
            p_invoice_id: draftInvoice.id,
            p_invoice_data: {
                supplier_name: null,
                notes: null,
                total_series: totalSeries,
                worker_id: currentUser?.id || null
            },
            p_invoice_items: itemsToSend
        });

        if (error) throw error;

        if (data && data.success) {
            showToast(draftInvoice.id ? 'تمت تعديل فاتورة الدخل بنجاح' : 'تم حفظ فاتورة الدخل وإضافة الرصيد بنجاح', 'success');
            closeInboundInvoiceForm();
            await loadInboundData();
            
            // Trigger global data refresh to sync stock levels across dashboard/models page
            if (typeof window.refreshAllSystemData === 'function') {
                await window.refreshAllSystemData({ silent: true });
            }
        } else {
            throw new Error('حدث خطأ غير متوقع أثناء الحفظ على السيرفر');
        }

    } catch (err) {
        console.error("Save Inbound Invoice Error:", err);
        // Display nice readable database error message (e.g. negative stock exception)
        if (err.message && err.message.includes('سيصبح بالسالب')) {
            showToast(err.message, 'error', 7000);
        } else {
            showToast(err.message || 'خطأ أثناء حفظ فاتورة الدخل', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
}

// 🌟 Edit Inbound Invoice (Loads existing items into form) 🌟
async function editInboundInvoice(invoiceId) {
    try {
        const inv = inboundInvoices.find(i => i.id === invoiceId);
        if (!inv) return;

        // Show toast loading
        showToast('جاري تحميل تفاصيل الفاتورة للتعديل...', 'info');

        // Fetch invoice items details
        const { data: itemsData, error: itemsError } = await supabase
            .from('inbound_invoice_items')
            .select(`
                id, model_id, color_id, quantity,
                models(id, name, factory_code),
                colors(id, name)
            `)
            .eq('inbound_invoice_id', invoiceId);

        if (itemsError) throw itemsError;

        // Fetch current model stock map to show current inventory correctly
        // (note: current inventory is loaded in modelsCache. We will lookup there)
        const items = itemsData.map(item => {
            const modelCache = modelsCache.find(m => m.id === item.model_id);
            const invRecord = modelCache?.model_inventory?.find(i => i.color_id === item.color_id);
            
            // Since database quantity is already included in available_series,
            // we calculate the base stock (without this invoice's quantity) so the form shows correct values.
            // But wait, the form shows: Current Stock + Added Qty = Expected Stock.
            // If we are editing, "Current Stock" should be the stock BEFORE this invoice's quantity was added!
            // That is: available_series - quantity.
            // This is perfect!
            const currentAvailable = invRecord ? (invRecord.available_series || 0) : 0;
            const baseStock = currentAvailable - item.quantity;

            return {
                model_id: item.model_id,
                model_code: item.models?.factory_code || 'غير معروف',
                model_name: item.models?.name || 'غير معروف',
                color_id: item.color_id,
                color_name: item.colors?.name || 'بدون اسم',
                qty: item.quantity,
                current_stock: baseStock
            };
        });

        // Initialize edit draft state
        draftInvoice = {
            id: invoiceId,
            supplier_name: inv.supplier_name || '',
            notes: inv.notes || '',
            items: items
        };

        // Populate header fields
        document.getElementById('inbound-form-title').innerHTML = `<i class="ph ph-pencil-simple-bold text-devo-orange text-lg"></i> تعديل فاتورة دخل: <span class="text-white">${inv.invoice_number}</span>`;
        
        const filterSelect = document.getElementById('inbound-model-filter');
        if (filterSelect) filterSelect.value = 'all';
        
        populateModelSelectDropdown();

        // Render cards
        renderDraftItems();

        // Toggle visibility
        document.getElementById('inbound-list-section').classList.add('hidden');
        document.getElementById('inbound-form-section').classList.remove('hidden');

    } catch (err) {
        console.error("Edit Inbound Invoice Load Error:", err);
        showToast('خطأ أثناء تحميل تفاصيل الفاتورة', 'error');
    }
}

// 🌟 Delete Inbound Invoice safely with negative stock protection 🌟
async function deleteInboundInvoice(invoiceId) {
    const inv = inboundInvoices.find(i => i.id === invoiceId);
    if (!inv) return;

    const confirmed = await confirmDialog({
        title: `حذف فاتورة الدخل (${inv.invoice_number})`,
        message: `هل أنت متأكد من الحذف النهائي للفاتورة؟ سيتم خصم إجمالي الكميات المضافة (${inv.total_series} سري) من رصيد المخزن الفعلي للقطع.`,
        isDestructive: true
    });

    if (!confirmed) return;

    try {
        showToast('جاري التحقق وحذف الفاتورة من المخزون...', 'info');

        // Call safe deletion database function
        const { data, error } = await supabase.rpc('delete_inbound_invoice_safely', {
            p_invoice_id: invoiceId
        });

        if (error) throw error;

        if (data) {
            showToast(`تم حذف فاتورة الدخل (${inv.invoice_number}) وتحديث المخزون بنجاح`, 'success');
            await loadInboundData();

            // Trigger global data refresh to sync stock levels across dashboard/models page
            if (typeof window.refreshAllSystemData === 'function') {
                await window.refreshAllSystemData({ silent: true });
            }
        } else {
            throw new Error('فشلت عملية الحذف على السيرفر');
        }

    } catch (err) {
        console.error("Delete Inbound Invoice Error:", err);
        if (err.message && err.message.includes('سيصبح بالسالب')) {
            showToast(err.message, 'error', 7000);
        } else {
            showToast(err.message || 'خطأ أثناء حذف فاتورة الدخل', 'error');
        }
    }
}

// 🌟 Export Inbound Invoice to Excel file matching Customer Order structure 🌟
async function exportInboundInvoiceToExcel(invoiceId) {
    try {
        const inv = inboundInvoices.find(i => i.id === invoiceId);
        if (!inv) return;

        showToast('جاري تجهيز ملف الإكسيل...', 'info');

        // Fetch invoice items details including sizes and prices
        const { data: itemsData, error: itemsError } = await supabase
            .from('inbound_invoice_items')
            .select(`
                id, model_id, color_id, quantity,
                models(id, name, factory_code, system_code, price, class_id, 
                    classes(id, name, class_sizes(size_id, sizes(id, name))),
                    model_sizes(size_id, sizes(id, name))
                ),
                colors(id, name)
            `)
            .eq('inbound_invoice_id', invoiceId);

        if (itemsError) throw itemsError;

        const dateStr = new Date(inv.created_at).toISOString().split('T')[0];
        const fileName = `INB${inv.invoice_number}_${dateStr}.xlsx`;
        
        const invoiceNotes = `فاتورة دخل رقم: ${inv.invoice_number} | حررت بواسطة: ${inv.system_users?.full_name || 'غير معروف'}`;

        const excelData = (itemsData || []).map((i, idx) => {
            const classSizes = i.models?.classes?.class_sizes || [];
            const sizesCount = classSizes.length > 0 ? classSizes.length : (i.models?.model_sizes?.length || 1); 
            const piecesQty = i.quantity * sizesCount;
            const modelPrice = i.models?.price || 0;
            const unitPrice = sizesCount > 0 ? (modelPrice / sizesCount) : modelPrice;

            return {
                'الملاحظات': idx === 0 ? invoiceNotes : '',
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
        XLSX.utils.book_append_sheet(workbook, worksheet, "Inbound_Items");
        XLSX.writeFile(workbook, fileName);

        showToast('تم تحميل ملف فاتورة الدخل بنجاح', 'success');

    } catch (err) {
        console.error("Export Inbound Invoice Error:", err);
        showToast('خطأ أثناء تصدير الفاتورة إلى إكسيل', 'error');
    }
}

