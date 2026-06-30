import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { getCurrentSession } from '../../services/auth.js';

let isInitialized = false;
let allAudits = [];
let selectedAudit = null;
let currentUserProfile = null;

export async function initAuditsView() {
    if (isInitialized) {
        await fetchAudits();
        return;
    }

    const { session } = getCurrentSession();
    if (session) currentUserProfile = session.user;

    // Setup filters event listeners
    document.getElementById('audits-search')?.addEventListener('input', applyAuditsFilters);
    document.getElementById('audits-status-filter')?.addEventListener('change', applyAuditsFilters);

    // Advanced Audit Creation stock qty input toggle
    const stockOp = document.getElementById('audit-create-filter-stock-op');
    const stockQty = document.getElementById('audit-create-filter-stock-qty');
    if (stockOp && stockQty) {
        stockOp.addEventListener('change', () => {
            if (stockOp.value) {
                stockQty.classList.remove('hidden');
            } else {
                stockQty.classList.add('hidden');
                stockQty.value = '';
            }
        });
    }

    // Global click handler to close audit dropdowns when clicking outside
    document.addEventListener('click', () => {
        const allMenus = document.querySelectorAll('.multi-select-dropdown [id^="audit-create-dropdown-"][id$="-menu"]');
        allMenus.forEach(m => m.classList.add('hidden'));
    });

    await fetchAudits();
    setupRealtimeAudits();

    isInitialized = true;
}

async function fetchAudits() {
    const { data, error } = await supabase
        .from('inventory_audits')
        .select(`
            *,
            system_users!created_by(full_name),
            reviewed_by_user:system_users!reviewed_by(full_name),
            inventory_audit_items(
                *,
                models(name, factory_code, system_code),
                colors(name)
            )
        `)
        .order('created_at', { ascending: false });

    if (error) {
        showToast('خطأ أثناء جلب تقارير الجرد: ' + error.message, 'error');
        console.error(error);
        return;
    }

    allAudits = data || [];
    updateAuditsStats();
    renderAuditsList(allAudits);
}

function updateAuditsStats() {
    const pending = allAudits.filter(a => a.status === 'submitted').length;
    const confirmed = allAudits.filter(a => a.status === 'confirmed').length;
    const cancelled = allAudits.filter(a => a.status === 'cancelled').length;

    const elPending = document.getElementById('audits-stat-pending');
    const elConfirmed = document.getElementById('audits-stat-confirmed');
    const elCancelled = document.getElementById('audits-stat-cancelled');

    if (elPending) elPending.textContent = pending;
    if (elConfirmed) elConfirmed.textContent = confirmed;
    if (elCancelled) elCancelled.textContent = cancelled;
}

function renderAuditsList(list) {
    const tbody = document.getElementById('audits-table-body');
    if (!tbody) return;

    if (list.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-devo-muted">لا توجد تقارير جرد مطابقة</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = list.map(a => {
        const dateStr = new Date(a.created_at).toLocaleString('ar-EG', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        
        let statusBadge = '';
        if (a.status === 'submitted') {
            statusBadge = `<span class="bg-devo-orange/15 text-devo-orange text-xs px-2.5 py-1 rounded-full font-bold">انتظار المراجعة</span>`;
        } else if (a.status === 'confirmed') {
            statusBadge = `<span class="bg-devo-success/15 text-devo-success text-xs px-2.5 py-1 rounded-full font-bold">معتمد ومطبق</span>`;
        } else {
            statusBadge = `<span class="bg-devo-error/15 text-devo-error text-xs px-2.5 py-1 rounded-full font-bold">ملغى</span>`;
        }

        const itemsCount = a.inventory_audit_items?.length || 0;
        const workerName = a.system_users?.full_name || 'غير معروف';

        return `
            <tr class="hover:bg-devo-gray/20 transition-colors">
                <td class="p-4 font-mono font-bold text-white">${a.audit_number}</td>
                <td class="p-4 text-white">${workerName}</td>
                <td class="p-4 text-devo-muted text-xs">${dateStr}</td>
                <td class="p-4 text-center font-bold">${itemsCount} أصناف</td>
                <td class="p-4 text-center">${statusBadge}</td>
                <td class="p-4 text-xs text-devo-muted truncate max-w-[200px]" title="${a.notes || ''}">${a.notes || '—'}</td>
                <td class="p-4 text-center">
                    <button onclick="window.viewAuditDetails('${a.id}')" class="bg-devo-orange hover:bg-devo-orangeHover text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all">
                        عرض وتدقيق
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function applyAuditsFilters() {
    const searchVal = document.getElementById('audits-search')?.value.toLowerCase().trim() || '';
    const statusVal = document.getElementById('audits-status-filter')?.value || '';

    let filtered = allAudits;

    if (statusVal) {
        filtered = filtered.filter(a => a.status === statusVal);
    }

    if (searchVal) {
        filtered = filtered.filter(a => 
            a.audit_number.toLowerCase().includes(searchVal) ||
            (a.system_users?.full_name && a.system_users.full_name.toLowerCase().includes(searchVal))
        );
    }

    renderAuditsList(filtered);
}

function setupRealtimeAudits() {
    supabase.channel('admin_audits_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_audits' }, async () => {
            await fetchAudits();
        })
        .subscribe();
}

window.refreshAuditsList = async () => {
    await fetchAudits();
};

window.viewAuditDetails = (id) => {
    const audit = allAudits.find(a => a.id === id);
    if (!audit) return;
    selectedAudit = audit;

    const modal = document.getElementById('audit-details-modal');
    const subtitle = document.getElementById('audit-modal-subtitle');
    const workerNotes = document.getElementById('audit-detail-worker-notes');
    const tbody = document.getElementById('audit-details-items-tbody');
    const decisionSection = document.getElementById('audit-decision-section');
    const actionButtons = document.getElementById('audit-detail-action-buttons');
    const adminNotesInput = document.getElementById('audit-admin-notes');

    subtitle.textContent = `جلسة جرد رقم: ${audit.audit_number} | بواسطة: ${audit.system_users?.full_name || 'غير معروف'}`;
    
    let baseNotesHtml = audit.notes || 'لا توجد ملاحظات من العامل.';
    workerNotes.innerHTML = `<p class="text-xs text-white leading-relaxed italic">${baseNotesHtml}</p>`;
    
    adminNotesInput.value = audit.review_notes || '';

    // Render items comparison
    tbody.innerHTML = audit.inventory_audit_items.map(item => {
        let diffText = '';
        if (item.difference === 0) {
            diffText = `<span class="text-devo-success font-bold">0 (مطابق)</span>`;
        } else if (item.difference > 0) {
            diffText = `<span class="text-blue-400 font-bold">+${item.difference} (زيادة)</span>`;
        } else {
            diffText = `<span class="text-devo-error font-bold">${item.difference} (عجز)</span>`;
        }

        const code = item.models?.factory_code || item.models?.system_code || '—';

        return `
            <tr class="border-b border-devo-gray last:border-0 hover:bg-devo-black/50 transition-colors">
                <td class="p-3">
                    <p class="font-bold text-white text-xs">${item.models?.name || 'موديل غير معروف'}</p>
                    <p class="text-[10px] text-devo-muted">كود: ${code}</p>
                </td>
                <td class="p-3 text-devo-info text-xs">${item.colors?.name || 'غير معروف'}</td>
                <td class="p-3 text-center font-bold text-devo-muted">${item.system_qty}</td>
                <td class="p-3 text-center font-bold text-white">${item.counted_qty}</td>
                <td class="p-3 text-center">${diffText}</td>
            </tr>
        `;
    }).join('');

    // Adjust footer based on status (only allow confirm/cancel for pending sessions)
    if (audit.status === 'submitted') {
        decisionSection.classList.remove('hidden');
        actionButtons.classList.remove('hidden');
    } else {
        decisionSection.classList.add('hidden');
        actionButtons.classList.add('hidden');
        if (audit.status === 'confirmed') {
            workerNotes.innerHTML += `
                <div class="mt-3 pt-3 border-t border-devo-gray text-[11px] text-devo-success">
                    <p class="font-bold">✓ تم اعتماد هذا الجرد وتطبيقه على السيستم بواسطة: ${audit.reviewed_by_user?.full_name || 'المدير'}</p>
                    <p class="mt-0.5 text-devo-muted">ملاحظات المدير: ${audit.review_notes || 'بدون ملاحظات'}</p>
                </div>
            `;
        } else if (audit.status === 'cancelled') {
            workerNotes.innerHTML += `
                <div class="mt-3 pt-3 border-t border-devo-gray text-[11px] text-devo-error">
                    <p class="font-bold">✕ تم إلغاء وتجاهل هذا الجرد بواسطة: ${audit.reviewed_by_user?.full_name || 'المدير'}</p>
                    <p class="mt-0.5 text-devo-muted">ملاحظات المدير: ${audit.review_notes || 'بدون ملاحظات'}</p>
                </div>
            `;
        }
    }

    // Show modal with animate
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => modal.classList.remove('opacity-0'), 50);
    setTimeout(() => modal.querySelector('.bg-devo-dark').classList.remove('scale-95'), 50);
};

window.closeAuditDetailsModal = () => {
    const modal = document.getElementById('audit-details-modal');
    modal.classList.add('opacity-0');
    modal.querySelector('.bg-devo-dark').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
};

window.confirmAuditSession = async () => {
    if (!selectedAudit) return;
    const notes = document.getElementById('audit-admin-notes').value.trim();

    if (!confirm("هل أنت متأكد من اعتماد هذا الجرد؟ سيتم تعديل كميات الموديلات في المخزن تلقائياً وتوليد حركات مخزنية بالفارق.")) {
        return;
    }

    const confirmBtn = document.getElementById('audit-btn-confirm');
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1"></i> جاري الاعتماد...';

    const { data, error } = await supabase.rpc('confirm_inventory_audit', {
        p_audit_id: selectedAudit.id,
        p_admin_id: currentUserProfile.id,
        p_notes: notes
    });

    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<i class="ph ph-check-circle"></i> تأكيد وتطبيق على السيستم';

    if (error) {
        showToast("فشل اعتماد الجرد: " + error.message, "error");
        console.error(error);
        return;
    }

    if (data && data.success) {
        showToast("تم اعتماد الجرد وتحديث أعداد المخزن بنجاح ✓", "success");
        window.closeAuditDetailsModal();
        await fetchAudits();
    } else {
        showToast("فشل اعتماد الجرد: " + (data?.error || 'خطأ غير معروف'), "error");
    }
};

window.cancelAuditSession = async () => {
    if (!selectedAudit) return;
    const notes = document.getElementById('audit-admin-notes').value.trim();

    if (!confirm("هل أنت متأكد من تجاهل وإلغاء هذا الجرد؟ لن يتم تطبيق أي تعديلات على كميات المخزن.")) {
        return;
    }

    const cancelBtn = document.getElementById('audit-btn-cancel');
    cancelBtn.disabled = true;
    cancelBtn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1"></i> جاري الإلغاء...';

    const { error } = await supabase
        .from('inventory_audits')
        .update({
            status: 'cancelled',
            reviewed_by: currentUserProfile.id,
            reviewed_at: new Date().toISOString(),
            review_notes: notes
        })
        .eq('id', selectedAudit.id);

    cancelBtn.disabled = false;
    cancelBtn.innerHTML = '<i class="ph ph-x-circle"></i> إلغاء وتجاهل الجرد';

    if (error) {
        showToast("فشل إلغاء الجرد: " + error.message, "error");
        console.error(error);
        return;
    }

    showToast("تم إلغاء وتجاهل الجرد بنجاح", "success");
    window.closeAuditDetailsModal();
    await fetchAudits();
};

// ============================================================
// 3. Create Audit Session Logic
// ============================================================
// ============================================================
// 3. Create Audit Session Logic (Advanced Filters)
// ============================================================
let auditCreateAllModels = [];
let auditCreateFilteredModels = [];
let auditCreateSelectedModelIds = new Set();
let auditCreateCategories = [];
let auditCreateClasses = [];

window.toggleAuditCreateMultiSelectDropdown = (event, menuId) => {
    event.stopPropagation();
    const menu = document.getElementById(menuId);
    if (!menu) return;
    
    // Close other dropdowns
    const allMenus = document.querySelectorAll('.multi-select-dropdown [id^="audit-create-dropdown-"][id$="-menu"]');
    allMenus.forEach(m => {
        if (m.id !== menuId) {
            m.classList.add('hidden');
        }
    });
    
    menu.classList.toggle('hidden');
};

window.toggleAuditCreateFilters = () => {
    const container = document.getElementById('audit-create-filters-container');
    const icon = document.getElementById('audit-create-filter-icon');
    const tableWrapper = document.getElementById('audit-create-table-wrapper');
    if (!container || !icon) return;
    
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        icon.style.transform = 'rotate(0deg)';
        if (tableWrapper) {
            tableWrapper.classList.remove('max-h-[500px]');
            tableWrapper.classList.add('max-h-48');
        }
    } else {
        container.classList.add('hidden');
        icon.style.transform = 'rotate(180deg)';
        if (tableWrapper) {
            tableWrapper.classList.remove('max-h-48');
            tableWrapper.classList.add('max-h-[500px]');
        }
    }
};

window.auditCreateMultiSelectAction = (event, key, action) => {
    event.stopPropagation();
    const checkboxes = document.querySelectorAll(`input[name="audit-create-filter-${key}"]`);
    checkboxes.forEach(cb => {
        cb.checked = (action === 'all');
    });
    window.updateAuditCreateMultiSelectLabel(key);
};

window.updateAuditCreateMultiSelectLabel = (key) => {
    const checkboxes = document.querySelectorAll(`input[name="audit-create-filter-${key}"]:checked`);
    const excludeCheckbox = document.getElementById(`audit-create-dropdown-${key}-exclude`);
    const labelEl = document.getElementById(`audit-create-dropdown-${key}-label`);
    
    if (!labelEl) return;
    
    const count = checkboxes.length;
    const isExclude = excludeCheckbox ? excludeCheckbox.checked : false;
    
    let defaultLabel = '';
    if (key === 'cat') defaultLabel = 'جميع التصنيفات';
    else if (key === 'class') defaultLabel = 'جميع الفئات';
    else if (key === 'color') defaultLabel = 'جميع الألوان';
    else if (key === 'size') defaultLabel = 'جميع المقاسات';
    
    if (count === 0) {
        labelEl.textContent = isExclude ? `استثناء: لا شيء (الكل)` : defaultLabel;
        labelEl.classList.remove('text-devo-orange');
    } else {
        const names = Array.from(checkboxes).map(cb => cb.nextElementSibling.textContent.trim());
        if (isExclude) {
            if (count <= 2) {
                labelEl.textContent = `استثناء: ${names.join('، ')}`;
            } else {
                labelEl.textContent = `الكل عدا ${count}`;
            }
            labelEl.classList.add('text-devo-orange');
        } else {
            if (count <= 2) {
                labelEl.textContent = names.join('، ');
            } else {
                labelEl.textContent = `${count} محددة`;
            }
            labelEl.classList.add('text-devo-orange');
        }
    }
};

window.openCreateAuditModal = async () => {
    const modal = document.getElementById('create-audit-modal');
    if (!modal) return;
    
    // Clear selection
    auditCreateSelectedModelIds.clear();
    
    // Reset all filter fields
    window.clearAuditCreateFilters();
    
    // Reset collapsible filter container to default open
    const filtersContainer = document.getElementById('audit-create-filters-container');
    const filtersIcon = document.getElementById('audit-create-filter-icon');
    const tableWrapper = document.getElementById('audit-create-table-wrapper');
    if (filtersContainer && filtersIcon) {
        filtersContainer.classList.remove('hidden');
        filtersIcon.style.transform = 'rotate(0deg)';
        if (tableWrapper) {
            tableWrapper.classList.remove('max-h-[500px]');
            tableWrapper.classList.add('max-h-48');
        }
    }
    
    // Populate dropdown options if empty
    if (auditCreateCategories.length === 0 || auditCreateClasses.length === 0) {
        const [cats, clss, colors, sizes] = await Promise.all([
            supabase.from('categories').select('id, name'),
            supabase.from('classes').select('id, name'),
            supabase.from('colors').select('id, name'),
            supabase.from('sizes').select('id, name')
        ]);
        
        const populateCheckbox = (containerId, data, key) => {
            const container = document.getElementById(containerId);
            if (container && data) {
                container.innerHTML = data.map(item => `
                    <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-devo-black/40 rounded cursor-pointer text-xs text-white select-none" onclick="event.stopPropagation()">
                        <input type="checkbox" value="${item.id}" name="audit-create-filter-${key}" class="accent-devo-orange w-3.5 h-3.5 rounded cursor-pointer" onchange="window.updateAuditCreateMultiSelectLabel('${key}')">
                        <span class="truncate">${item.name}</span>
                    </label>
                `).join('');
            }
        };
        
        if (cats.data) {
            auditCreateCategories = cats.data;
            populateCheckbox('audit-create-dropdown-cat-options', cats.data, 'cat');
        }
        if (clss.data) {
            auditCreateClasses = clss.data;
            populateCheckbox('audit-create-dropdown-class-options', clss.data, 'class');
        }
        if (colors.data) {
            populateCheckbox('audit-create-dropdown-color-options', colors.data, 'color');
        }
        if (sizes.data) {
            populateCheckbox('audit-create-dropdown-size-options', sizes.data, 'size');
        }
        
        window.updateAuditCreateMultiSelectLabel('cat');
        window.updateAuditCreateMultiSelectLabel('class');
        window.updateAuditCreateMultiSelectLabel('color');
        window.updateAuditCreateMultiSelectLabel('size');
    }
    
    // Load models
    const tbody = document.getElementById('audit-create-models-tbody');
    tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-devo-muted"><i class="ph ph-spinner animate-spin text-lg text-devo-orange mb-1 block"></i>جاري تحميل الموديلات...</td></tr>`;
    
    // Fetch all models in chunks of 1000 to avoid API limits (matching bulk edits fetch)
    let allFetchedData = [];
    let from = 0;
    const step = 999;
    let hasMore = true;
    
    try {
        while (hasMore) {
            const { data, error } = await supabase
                .from('models')
                .select(`
                    *, 
                    categories(name), 
                    classes(name, class_sizes(size_id)),
                    model_sizes(size_id),
                    model_inventory(color_id, available_series)
                `)
                .order('created_at', { ascending: false })
                .range(from, from + step);
                
            if (error) throw error;
            
            if (data && data.length > 0) {
                allFetchedData = [...allFetchedData, ...data];
                from += step + 1;
            }
            if (!data || data.length <= step) {
                hasMore = false;
            }
        }
    } catch (err) {
        showToast("فشل تحميل الموديلات للجرد", "error");
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-devo-error">فشل تحميل الموديلات.</td></tr>`;
        return;
    }
    
    auditCreateAllModels = allFetchedData || [];
    
    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => modal.classList.remove('opacity-0'), 50);
    setTimeout(() => modal.querySelector('.bg-devo-dark').classList.remove('scale-95'), 50);
    
    // Initial display of models
    window.applyAuditCreateFilters();
};

window.closeCreateAuditModal = () => {
    const modal = document.getElementById('create-audit-modal');
    if (!modal) return;
    
    modal.classList.add('opacity-0');
    modal.querySelector('.bg-devo-dark').classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
};

window.clearAuditCreateFilters = () => {
    const textSelectIds = [
        'audit-create-search-name', 'audit-create-search-factory', 'audit-create-search-system',
        'audit-create-factory-from', 'audit-create-factory-to',
        'audit-create-filter-status', 'audit-create-filter-stock-op', 'audit-create-filter-stock-qty',
        'audit-create-price-min', 'audit-create-price-max',
        'audit-create-date-from', 'audit-create-date-to'
    ];
    textSelectIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    
    const stockQty = document.getElementById('audit-create-filter-stock-qty');
    if (stockQty) stockQty.classList.add('hidden');
    
    // Clear checkboxes and update labels
    ['cat', 'class', 'color', 'size'].forEach(key => {
        const checkboxes = document.querySelectorAll(`input[name="audit-create-filter-${key}"]`);
        checkboxes.forEach(cb => cb.checked = false);
        const excludeCheckbox = document.getElementById(`audit-create-dropdown-${key}-exclude`);
        if (excludeCheckbox) excludeCheckbox.checked = false;
        window.updateAuditCreateMultiSelectLabel(key);
    });
};

window.applyAuditCreateFilters = () => {
    const nameTerm = document.getElementById('audit-create-search-name')?.value.toLowerCase().trim() || '';
    const factoryTerm = document.getElementById('audit-create-search-factory')?.value.toLowerCase().trim() || '';
    const systemTerm = document.getElementById('audit-create-search-system')?.value.toLowerCase().trim() || '';
    
    const factoryFromVal = document.getElementById('audit-create-factory-from')?.value.trim() || '';
    const factoryToVal = document.getElementById('audit-create-factory-to')?.value.trim() || '';
    
    const selectedCats = Array.from(document.querySelectorAll('input[name="audit-create-filter-cat"]:checked')).map(cb => cb.value);
    const isCatExclude = document.getElementById('audit-create-dropdown-cat-exclude')?.checked || false;
    
    const selectedClasses = Array.from(document.querySelectorAll('input[name="audit-create-filter-class"]:checked')).map(cb => cb.value);
    const isClassExclude = document.getElementById('audit-create-dropdown-class-exclude')?.checked || false;
    
    const status = document.getElementById('audit-create-filter-status')?.value || '';
    const stockOp = document.getElementById('audit-create-filter-stock-op')?.value || '';
    const stockQtyVal = parseInt(document.getElementById('audit-create-filter-stock-qty')?.value, 10);
    
    const selectedColors = Array.from(document.querySelectorAll('input[name="audit-create-filter-color"]:checked')).map(cb => cb.value);
    const isColorExclude = document.getElementById('audit-create-dropdown-color-exclude')?.checked || false;
    
    const selectedSizes = Array.from(document.querySelectorAll('input[name="audit-create-filter-size"]:checked')).map(cb => cb.value);
    const isSizeExclude = document.getElementById('audit-create-dropdown-size-exclude')?.checked || false;
    
    const minPriceVal = document.getElementById('audit-create-price-min')?.value;
    const maxPriceVal = document.getElementById('audit-create-price-max')?.value;
    const minPrice = minPriceVal ? parseFloat(minPriceVal) : NaN;
    const maxPrice = maxPriceVal ? parseFloat(maxPriceVal) : NaN;
    
    const dateFrom = document.getElementById('audit-create-date-from')?.value || '';
    const dateTo = document.getElementById('audit-create-date-to')?.value || '';
    
    auditCreateFilteredModels = auditCreateAllModels.filter(m => {
        let isMatch = true;
        
        // 1. Split search fields (AND logic)
        if (nameTerm && !m.name?.toLowerCase().includes(nameTerm)) isMatch = false;
        if (factoryTerm && !m.factory_code?.toLowerCase().includes(factoryTerm)) isMatch = false;
        if (systemTerm && !m.system_code?.toLowerCase().includes(systemTerm)) isMatch = false;
        
        // 2. Factory Code Range Filter
        if (factoryFromVal || factoryToVal) {
            const codeNum = parseInt(m.factory_code, 10);
            const fromNum = factoryFromVal ? parseInt(factoryFromVal, 10) : NaN;
            const toNum = factoryToVal ? parseInt(factoryToVal, 10) : NaN;
            
            if (!isNaN(codeNum)) {
                if (!isNaN(fromNum) && codeNum < fromNum) isMatch = false;
                if (!isNaN(toNum) && codeNum > toNum) isMatch = false;
            } else {
                if (factoryFromVal && m.factory_code < factoryFromVal) isMatch = false;
                if (factoryToVal && m.factory_code > factoryToVal) isMatch = false;
            }
        }
        
        // 3. Category Multi-select (Inclusion / Exclusion)
        if (selectedCats.length > 0) {
            const inList = selectedCats.includes(m.category_id);
            if (isCatExclude && inList) isMatch = false;
            if (!isCatExclude && !inList) isMatch = false;
        }
        
        // 4. Class Multi-select (Inclusion / Exclusion)
        if (selectedClasses.length > 0) {
            const inList = selectedClasses.includes(m.class_id);
            if (isClassExclude && inList) isMatch = false;
            if (!isClassExclude && !inList) isMatch = false;
        }
        
        // 5. Activation status
        if (status !== "" && String(m.is_active) !== status) isMatch = false;
        
        // 6. Stock quantity filter
        const totalQty = m.model_inventory?.reduce((sum, inv) => sum + (inv.available_series || 0), 0) || 0;
        if (stockOp && !isNaN(stockQtyVal)) {
            if (stockOp === 'less' && totalQty >= stockQtyVal) isMatch = false;
            if (stockOp === 'greater' && totalQty <= stockQtyVal) isMatch = false;
            if (stockOp === 'equal' && totalQty !== stockQtyVal) isMatch = false;
        }
        
        // 7. Colors Multi-select (Inclusion / Exclusion)
        if (selectedColors.length > 0) {
            const hasAnyColor = m.model_inventory?.some(inv => selectedColors.includes(inv.color_id)) || false;
            if (isColorExclude && hasAnyColor) isMatch = false;
            if (!isColorExclude && !hasAnyColor) isMatch = false;
        }
        
        // 8. Sizes Multi-select (Inclusion / Exclusion)
        if (selectedSizes.length > 0) {
            const classSizes = m.classes?.class_sizes?.map(cs => cs.size_id) || [];
            const manualSizes = m.model_sizes?.map(ms => ms.size_id) || [];
            const hasAnySize = selectedSizes.some(sId => classSizes.includes(sId) || manualSizes.includes(sId));
            if (isSizeExclude && hasAnySize) isMatch = false;
            if (!isSizeExclude && !hasAnySize) isMatch = false;
        }
        
        // 9. Prices Range
        if (!isNaN(minPrice) && m.price < minPrice) isMatch = false;
        if (!isNaN(maxPrice) && m.price > maxPrice) isMatch = false;
        
        // 10. Date Range
        if (dateFrom || dateTo) {
            const modelDate = new Date(m.created_at);
            modelDate.setHours(0, 0, 0, 0);
            if (dateFrom) {
                const fDate = new Date(dateFrom);
                fDate.setHours(0, 0, 0, 0);
                if (modelDate < fDate) isMatch = false;
            }
            if (dateTo) {
                const tDate = new Date(dateTo);
                tDate.setHours(23, 59, 59, 999);
                if (modelDate > tDate) isMatch = false;
            }
        }
        return isMatch;
    });
    
    // Auto select all filtered models initially
    auditCreateSelectedModelIds.clear();
    auditCreateFilteredModels.forEach(m => auditCreateSelectedModelIds.add(m.id));
    
    renderAuditCreateModelsTable();
};

function renderAuditCreateModelsTable() {
    const tbody = document.getElementById('audit-create-models-tbody');
    if (!tbody) return;
    
    if (auditCreateFilteredModels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-devo-muted">لا توجد موديلات مطابقة لخيارات البحث الحالية.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = auditCreateFilteredModels.map(m => {
        const checked = auditCreateSelectedModelIds.has(m.id) ? 'checked' : '';
        return `
            <tr class="hover:bg-devo-black/50 transition-colors border-b border-devo-gray/40 last:border-0">
                <td class="p-2.5 text-center">
                    <input type="checkbox" value="${m.id}" onchange="window.toggleAuditCreateModelSelection('${m.id}')" ${checked} class="w-4 h-4 accent-devo-orange rounded cursor-pointer">
                </td>
                <td class="p-2.5 font-bold text-white">${m.name}</td>
                <td class="p-2.5">${m.factory_code || '—'}</td>
                <td class="p-2.5 font-mono">${m.system_code || '—'}</td>
            </tr>
        `;
    }).join('');
    
    updateAuditCreateSelectedCount();
}

window.toggleAuditCreateModelSelection = (id) => {
    if (auditCreateSelectedModelIds.has(id)) {
        auditCreateSelectedModelIds.delete(id);
    } else {
        auditCreateSelectedModelIds.add(id);
    }
    updateAuditCreateSelectedCount();
};

function updateAuditCreateSelectedCount() {
    const el = document.getElementById('audit-create-selected-count');
    if (el) {
        el.textContent = `تم تحديد: ${auditCreateSelectedModelIds.size} موديل`;
    }
}

window.toggleAllAuditCreateModels = () => {
    const allFilteredSelected = auditCreateFilteredModels.every(m => auditCreateSelectedModelIds.has(m.id));
    
    if (allFilteredSelected) {
        auditCreateFilteredModels.forEach(m => auditCreateSelectedModelIds.delete(m.id));
    } else {
        auditCreateFilteredModels.forEach(m => auditCreateSelectedModelIds.add(m.id));
    }
    
    renderAuditCreateModelsTable();
};

window.executeCreateAuditSession = async () => {
    if (auditCreateSelectedModelIds.size === 0) {
        showToast("يرجى تحديد موديل واحد على الأقل للبدء بالجرد الدوري", "warning");
        return;
    }
    
    const notes = document.getElementById('audit-create-notes').value.trim();
    const submitBtn = document.getElementById('audit-create-submit-btn');
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ph ph-spinner animate-spin mr-1"></i> جاري الإنشاء...';
    
    const { data, error } = await supabase.rpc('create_inventory_audit', {
        p_admin_id: currentUserProfile.id,
        p_notes: notes,
        p_model_ids: Array.from(auditCreateSelectedModelIds)
    });
    
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="ph ph-check-circle"></i> إنشاء ونشر الجرد';
    
    if (error) {
        showToast("فشل إنشاء جلسة الجرد: " + error.message, "error");
        console.error(error);
        return;
    }
    
    if (data && data.success) {
        showToast(`تم إنشاء جلسة الجرد بنجاح رقم: ${data.audit_number} ونشرها للمخزن ✓`, "success");
        window.closeCreateAuditModal();
        await fetchAudits();
    } else {
        showToast("فشل إنشاء جلسة الجرد الدوري", "error");
    }
};
