import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { checkModelsInInvoices } from './models.js';

let isBulkInitialized = false;
let bulkAllModels = []; 
let filteredBulkModels = [];
let selectedModelIds = new Set();
let lastSnapshot = null; 
let bulkClasses = [];

let bulkCurrentPage = 1;
const bulkItemsPerPage = 50;

export async function initBulkEditsView() {
    if (isBulkInitialized) return;
    
    await fetchBulkFilterOptions();
    await fetchBulkModels();

    const stockOp = document.getElementById('bulk-filter-stock-op');
    const stockQty = document.getElementById('bulk-filter-stock-qty');
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
    
    isBulkInitialized = true;
}

// 🌟 دالة فتح/غلق الفلاتر 🌟
window.toggleBulkFilters = () => {
    const container = document.getElementById('bulk-filters-container');
    const icon = document.getElementById('bulk-filter-icon');
    
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        icon.style.transform = 'rotate(0deg)';
    } else {
        container.classList.add('hidden');
        icon.style.transform = 'rotate(180deg)';
    }
};

// تتبع القائمة المفتوحة حالياً
let _openMenuId = null;

window.toggleMultiSelectDropdown = (event, menuId) => {
    event.stopPropagation(); // يمنع document.click من التشغيل فوراً
    const menu = document.getElementById(menuId);
    if (!menu) return;
    
    // إذا في قائمة مفتوحة غيره، أغلقها
    if (_openMenuId && _openMenuId !== menuId) {
        const prevMenu = document.getElementById(_openMenuId);
        if (prevMenu) prevMenu.classList.add('hidden');
    }
    
    const isNowHidden = menu.classList.contains('hidden');
    if (isNowHidden) {
        menu.classList.remove('hidden');
        _openMenuId = menuId;
    } else {
        menu.classList.add('hidden');
        _openMenuId = null;
    }
};

// غلق القائمة عند الضغط خارجها - O(1) بدون مسح DOM
document.addEventListener('click', () => {
    if (_openMenuId) {
        const openMenu = document.getElementById(_openMenuId);
        if (openMenu) openMenu.classList.add('hidden');
        _openMenuId = null;
    }
});

window.multiSelectAction = (event, key, action) => {
    event.stopPropagation();
    const checkboxes = document.querySelectorAll(`input[name="bulk-filter-${key}"]`);
    checkboxes.forEach(cb => {
        cb.checked = (action === 'all');
    });
    window.updateMultiSelectLabel(key);
};

window.updateMultiSelectLabel = (key) => {
    const checkboxes = document.querySelectorAll(`input[name="bulk-filter-${key}"]:checked`);
    const excludeCheckbox = document.getElementById(`bulk-dropdown-${key}-exclude`);
    const labelEl = document.getElementById(`bulk-dropdown-${key}-label`);
    
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




export async function fetchBulkFilterOptions() {
    try {
        const [cats, clss, colors, sizes] = await Promise.all([
            supabase.from('categories').select('id, name'),
            supabase.from('classes').select('id, name, class_sizes(size_id)'),
            supabase.from('colors').select('id, name'),
            supabase.from('sizes').select('id, name')
        ]);

        bulkClasses = clss.data || [];

        const populateCheckbox = (containerId, data, key) => {
            const container = document.getElementById(containerId);
            if (container && data) {
                container.innerHTML = data.map(item => `
                    <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-devo-black/40 rounded cursor-pointer text-xs text-white select-none" onclick="event.stopPropagation()">
                        <input type="checkbox" value="${item.id}" name="bulk-filter-${key}" class="accent-devo-orange w-3.5 h-3.5 rounded cursor-pointer" onchange="updateMultiSelectLabel('${key}')">
                        <span class="truncate">${item.name}</span>
                    </label>
                `).join('');
            }
        };

        populateCheckbox('bulk-dropdown-cat-options', cats.data, 'cat');
        populateCheckbox('bulk-dropdown-class-options', clss.data, 'class');
        populateCheckbox('bulk-dropdown-color-options', colors.data, 'color');
        populateCheckbox('bulk-dropdown-size-options', sizes.data, 'size');

        // Setup labels
        window.updateMultiSelectLabel('cat');
        window.updateMultiSelectLabel('class');
        window.updateMultiSelectLabel('color');
        window.updateMultiSelectLabel('size');

        // تعبئة القوائم السفلية للتعديل المجمع
        const actionSelect = document.getElementById('bulk-action-select');
        if (actionSelect && cats.data) {
            actionSelect.innerHTML = `<option value="" disabled selected>-- اختر التصنيف الجديد --</option>` + cats.data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }

        const actionClassSelect = document.getElementById('bulk-action-class-select');
        if (actionClassSelect && clss.data) {
            actionClassSelect.innerHTML = `<option value="" disabled selected>-- اختر الفئة العمرية الجديدة --</option>` + clss.data.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        }
    } catch (err) {
        console.error("Error fetching filter options:", err);
    }
}

export async function fetchBulkModels() {
    const tbody = document.getElementById('bulk-table-body');
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i> جاري تحميل كل الموديلات...</td></tr>`;

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
                    model_inventory(id, color_id, available_series),
                    model_images(image_url)
                `)
                .order('created_at', { ascending: false })
                .range(from, from + step);

            if (error) throw error;

            if (data.length > 0) {
                allFetchedData = [...allFetchedData, ...data];
                from += step + 1;
            }
            if (data.length <= step) {
                hasMore = false;
            }
        }
        
        bulkAllModels = allFetchedData;
        window.applyBulkFilters();

    } catch (error) {
        console.error("Bulk Fetch Error:", error);
        showToast('خطأ في تحميل الموديلات للتعديل المجمع', 'error');
    }
}

window.applyBulkFilters = () => {
    const nameTerm = document.getElementById('bulk-search-name')?.value.toLowerCase().trim() || '';
    const factoryTerm = document.getElementById('bulk-search-factory')?.value.toLowerCase().trim() || '';
    const systemTerm = document.getElementById('bulk-search-system')?.value.toLowerCase().trim() || '';

    const factoryFromVal = document.getElementById('bulk-factory-from')?.value.trim() || '';
    const factoryToVal = document.getElementById('bulk-factory-to')?.value.trim() || '';

    const selectedCats = Array.from(document.querySelectorAll('input[name="bulk-filter-cat"]:checked')).map(cb => cb.value);
    const isCatExclude = document.getElementById('bulk-dropdown-cat-exclude')?.checked || false;

    const selectedClasses = Array.from(document.querySelectorAll('input[name="bulk-filter-class"]:checked')).map(cb => cb.value);
    const isClassExclude = document.getElementById('bulk-dropdown-class-exclude')?.checked || false;

    const status = document.getElementById('bulk-filter-status')?.value || '';
    const stockOp = document.getElementById('bulk-filter-stock-op')?.value || '';
    const stockQtyVal = parseInt(document.getElementById('bulk-filter-stock-qty')?.value, 10);

    const selectedColors = Array.from(document.querySelectorAll('input[name="bulk-filter-color"]:checked')).map(cb => cb.value);
    const isColorExclude = document.getElementById('bulk-dropdown-color-exclude')?.checked || false;

    const selectedSizes = Array.from(document.querySelectorAll('input[name="bulk-filter-size"]:checked')).map(cb => cb.value);
    const isSizeExclude = document.getElementById('bulk-dropdown-size-exclude')?.checked || false;

    const minPriceVal = document.getElementById('bulk-price-min')?.value;
    const maxPriceVal = document.getElementById('bulk-price-max')?.value;
    const minPrice = minPriceVal ? parseFloat(minPriceVal) : NaN;
    const maxPrice = maxPriceVal ? parseFloat(maxPriceVal) : NaN;

    const dateFrom = document.getElementById('bulk-date-from')?.value || '';
    const dateTo = document.getElementById('bulk-date-to')?.value || '';

    filteredBulkModels = bulkAllModels.filter(m => {
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

    selectedModelIds.clear();
    filteredBulkModels.forEach(m => selectedModelIds.add(m.id));
    
    bulkCurrentPage = 1; 

    renderBulkPage();
    updateBulkActionBar();
};

window.clearBulkFilters = () => {
    const textSelectIds = [
        'bulk-search-name', 'bulk-search-factory', 'bulk-search-system',
        'bulk-factory-from', 'bulk-factory-to',
        'bulk-filter-status', 'bulk-filter-stock-op', 'bulk-filter-stock-qty',
        'bulk-price-min', 'bulk-price-max', 
        'bulk-date-from', 'bulk-date-to'
    ];
    textSelectIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const stockQty = document.getElementById('bulk-filter-stock-qty');
    if (stockQty) stockQty.classList.add('hidden');

    const multiSelectKeys = ['cat', 'class', 'color', 'size'];
    multiSelectKeys.forEach(key => {
        const checkboxes = document.querySelectorAll(`input[name="bulk-filter-${key}"]`);
        checkboxes.forEach(cb => {
            cb.checked = false;
        });
        const excludeCb = document.getElementById(`bulk-dropdown-${key}-exclude`);
        if (excludeCb) excludeCb.checked = false;
        
        window.updateMultiSelectLabel(key);
    });

    window.applyBulkFilters(); 
};

function renderBulkPage() {
    const tbody = document.getElementById('bulk-table-body');
    const paginationContainer = document.getElementById('bulk-pagination');
    const masterCb = document.getElementById('bulk-select-all');
    
    document.getElementById('bulk-results-count').textContent = filteredBulkModels.length;
    document.getElementById('bulk-selected-count').textContent = selectedModelIds.size;

    if (filteredBulkModels.length === 0) {
        if(masterCb) { masterCb.checked = false; masterCb.disabled = true; }
        if(tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-devo-muted">لا توجد نتائج مطابقة للبحث</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    if(masterCb) {
        masterCb.disabled = false;
        masterCb.checked = selectedModelIds.size === filteredBulkModels.length;
    }

    const totalItems = filteredBulkModels.length;
    const totalPages = Math.ceil(totalItems / bulkItemsPerPage);
    
    if (bulkCurrentPage > totalPages) bulkCurrentPage = totalPages;
    if (bulkCurrentPage < 1) bulkCurrentPage = 1;

    const startIndex = (bulkCurrentPage - 1) * bulkItemsPerPage;
    const endIndex = startIndex + bulkItemsPerPage;
    const pageData = filteredBulkModels.slice(startIndex, endIndex);

    if(tbody) {
        tbody.innerHTML = pageData.map(m => {
            const totalQty = m.model_inventory?.reduce((sum, inv) => sum + (inv.available_series || 0), 0) || 0;
            return `
            <tr class="hover:bg-devo-black/50 transition-colors border-b border-devo-gray/50">
                <td class="p-3 text-center border-l border-devo-gray/30">
                    <input type="checkbox" value="${m.id}" onchange="toggleSingleBulkCheck(this)" class="bulk-item-cb accent-devo-orange w-4 h-4 cursor-pointer" ${selectedModelIds.has(m.id) ? 'checked' : ''}>
                </td>
                <td class="p-3">
                    <p class="text-[10px] text-devo-muted font-mono tracking-wider">${m.factory_code || m.system_code}</p>
                    <p class="font-bold text-white text-xs mt-0.5">${m.name}</p>
                </td>
                <td class="p-3 text-center font-black text-devo-orange text-sm">${m.price}</td>
                <td class="p-3 text-center text-xs text-devo-muted">
                    <span class="block mb-1">${m.categories?.name || '-'} / ${m.classes?.name || '-'}</span>
                    <span class="${totalQty === 0 ? 'text-devo-error' : 'text-devo-success'} font-bold text-[10px] bg-devo-black px-2 py-0.5 rounded border border-devo-gray">${totalQty === 0 ? 'نفذت الكمية' : `متبقي: ${totalQty}`}</span>
                </td>
                <td class="p-3 text-center">
                    ${m.is_active ? `<span class="bg-devo-success/10 border border-devo-success/20 text-devo-success text-[10px] font-bold px-2 py-1 rounded">نشط</span>` : `<span class="bg-devo-gray/30 border border-devo-gray text-white text-[10px] font-bold px-2 py-1 rounded">معطل</span>`}
                </td>
            </tr>
        `}).join('');
    }

    renderBulkPaginationControls(totalPages);
}

function renderBulkPaginationControls(totalPages) {
    const container = document.getElementById('bulk-pagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button onclick="changeBulkPage(${bulkCurrentPage - 1})" ${bulkCurrentPage === 1 ? 'disabled' : ''} class="px-3 py-1.5 rounded border border-devo-gray bg-devo-black text-white hover:bg-devo-gray transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-xs"><i class="ph ph-caret-right"></i> السابق</button>`;
    html += `<span class="px-4 py-1.5 rounded bg-devo-dark text-devo-orange font-bold border border-devo-gray text-xs">صفحة ${bulkCurrentPage} من ${totalPages}</span>`;
    html += `<button onclick="changeBulkPage(${bulkCurrentPage + 1})" ${bulkCurrentPage === totalPages ? 'disabled' : ''} class="px-3 py-1.5 rounded border border-devo-gray bg-devo-black text-white hover:bg-devo-gray transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-xs">التالي <i class="ph ph-caret-left"></i></button>`;

    container.innerHTML = html;
}

window.changeBulkPage = (newPage) => {
    bulkCurrentPage = newPage;
    renderBulkPage();
};

window.toggleBulkSelectAll = (cb) => {
    selectedModelIds.clear();
    if (cb.checked) {
        filteredBulkModels.forEach(m => selectedModelIds.add(m.id));
    }
    renderBulkPage(); 
    updateBulkActionBar();
};

window.toggleSingleBulkCheck = (cb) => {
    if (cb.checked) selectedModelIds.add(cb.value);
    else selectedModelIds.delete(cb.value);
    
    document.getElementById('bulk-selected-count').textContent = selectedModelIds.size;
    const masterCb = document.getElementById('bulk-select-all');
    if(masterCb) masterCb.checked = selectedModelIds.size === filteredBulkModels.length;
    updateBulkActionBar();
};

function updateBulkActionBar() {
    const bar = document.getElementById('bulk-action-bar');
    if (selectedModelIds.size > 0 || lastSnapshot !== null) {
        bar.classList.remove('hidden');
        bar.classList.add('block');
    } else {
        bar.classList.add('hidden');
        bar.classList.remove('block');
    }
}

window.handleBulkActionChange = () => {
    const action = document.getElementById('bulk-action-type').value;
    const container = document.getElementById('bulk-action-value-container');
    const input = document.getElementById('bulk-action-input');
    const select = document.getElementById('bulk-action-select');
    const classSelect = document.getElementById('bulk-action-class-select');

    container.classList.remove('hidden');
    input.classList.add('hidden');
    select.classList.add('hidden');
    classSelect.classList.add('hidden');

    if (action.includes('price')) {
        input.classList.remove('hidden');
        input.type = 'number';
        input.value = '';
        input.placeholder = action.includes('percent') ? 'أدخل النسبة المئوية (مثال: 10)...' : 'أدخل المبلغ هنا...';
    } else if (action === 'change_category') {
        select.classList.remove('hidden');
        select.value = '';
    } else if (action === 'change_class') {
        classSelect.classList.remove('hidden');
        classSelect.value = '';
    } else if (action === 'delete_models') {
        // في حالة الحذف لا نحتاج أي مدخلات، نخفي المربع
        container.classList.add('hidden');
    } else {
        container.classList.add('hidden');
    }
};

window.executeBulkEdit = async () => {
    if (selectedModelIds.size === 0) {
        return showToast('الرجاء تحديد موديل واحد على الأقل أولاً', 'warning');
    }

    const action = document.getElementById('bulk-action-type').value;
    if (!action) return showToast('الرجاء اختيار الإجراء أولاً', 'warning');

    const inputVal = document.getElementById('bulk-action-input').value;
    const selectVal = document.getElementById('bulk-action-select').value;
    const classSelectVal = document.getElementById('bulk-action-class-select').value;

    if (action.includes('price') && (!inputVal || inputVal <= 0)) return showToast('الرجاء إدخال قيمة صحيحة', 'error');
    if (action === 'change_category' && !selectVal) return showToast('الرجاء اختيار التصنيف الجديد', 'error');
    if (action === 'change_class' && !classSelectVal) return showToast('الرجاء اختيار الفئة العمرية الجديدة', 'error');

    const isDelete = action === 'delete_models';

    const btn = document.getElementById('btn-bulk-execute');
    const originalBtnText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري المعالجة...`;

    // 🌟 إظهار شريط التقدم وتصفير البيانات فوراً لمنع تعليق الواجهة 🌟
    const progressContainer = document.getElementById('bulk-progress-container');
    const progressBar = document.getElementById('bulk-progress-bar');
    const progressText = document.getElementById('bulk-progress-text');
    const progressPercent = document.getElementById('bulk-progress-percent');
    const progressErrors = document.getElementById('bulk-progress-errors');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressText) progressText.textContent = 'جاري التحضير لبدء العملية...';
    if (progressErrors) {
        progressErrors.innerHTML = '';
        progressErrors.classList.add('hidden');
    }

    const inputsToDisable = [
        document.getElementById('bulk-action-type'),
        document.getElementById('bulk-action-input'),
        document.getElementById('bulk-action-select'),
        document.getElementById('bulk-action-class-select'),
        document.getElementById('btn-bulk-undo')
    ];
    inputsToDisable.forEach(input => {
        if (input) input.disabled = true;
    });

    const resetBulkState = () => {
        btn.disabled = false;
        btn.innerHTML = originalBtnText;
        inputsToDisable.forEach(input => {
            if (input) input.disabled = false;
        });
        if (progressContainer) progressContainer.classList.add('hidden');
    };

    if (isDelete) {
        const initialIdsToDelete = Array.from(selectedModelIds);
        const linkedModelIds = await checkModelsInInvoices(initialIdsToDelete, (percent, text) => {
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressPercent) progressPercent.textContent = `${percent}%`;
            if (progressText) progressText.textContent = text;
        });

        if (linkedModelIds.size > 0) {
            if (linkedModelIds.size === initialIdsToDelete.length) {
                showToast('لا يمكن حذف الموديلات المحددة لأنها مرتبطة بفواتير أو طلبات في السيستم. يمكنك تعطيلها بدلاً من حذفها.', 'error');
                resetBulkState();
                return;
            }

            const deletableIds = initialIdsToDelete.filter(id => !linkedModelIds.has(id));
            const confirmMsg = `تنبيه: يوجد ${linkedModelIds.size} موديل من المحددة مرتبطة بفواتير ولا يمكن حذفها (يمكنك تعطيلها).\nهل تريد متابعة حذف الـ ${deletableIds.length} موديل المتبقية فقط؟`;
            
            const confirmed = await confirmDialog({
                title: 'حذف مجمع للموديلات 🗑️',
                message: confirmMsg,
                isDestructive: true
            });
            if (!confirmed) {
                resetBulkState();
                return;
            }

            selectedModelIds = new Set(deletableIds);
        } else {
            const confirmMsg = `تحذير خطير: سيتم حذف ${initialIdsToDelete.length} موديل نهائياً وبلا رجعة! هل أنت متأكد تماماً؟`;
            const confirmed = await confirmDialog({
                title: 'حذف مجمع للموديلات 🗑️',
                message: confirmMsg,
                isDestructive: true
            });
            if (!confirmed) {
                resetBulkState();
                return;
            }
        }
    } else {
        const confirmMsg = `سيتم تطبيق هذا التعديل على ${selectedModelIds.size} موديل. هل أنت متأكد؟`;
        const confirmed = await confirmDialog({
            title: 'تأكيد التعديل المجمع',
            message: confirmMsg,
            isDestructive: false
        });
        if (!confirmed) {
            resetBulkState();
            return;
        }
    }

    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';

    try {
        const modelsToEdit = bulkAllModels.filter(m => selectedModelIds.has(m.id));
        const CHUNK_SIZE = 100; // معالجة الموديلات على دفعات من 100
        const errorsCollected = [];

        if (isDelete) {
            // 🌟 حفظ لقطة تراجع للحذف المجمع 🌟
            lastSnapshot = {
                actionType: 'delete',
                models: modelsToEdit.map(m => ({
                    id: m.id,
                    system_code: m.system_code,
                    factory_code: m.factory_code,
                    name: m.name,
                    price: m.price,
                    category_id: m.category_id,
                    class_id: m.class_id,
                    is_active: m.is_active,
                    image_url_1: m.image_url_1,
                    image_url_2: m.image_url_2,
                    image_url_3: m.image_url_3,
                    created_at: m.created_at,
                    updated_at: m.updated_at
                })),
                sizes: modelsToEdit.flatMap(m => 
                    (m.model_sizes || []).map(ms => ({
                        model_id: m.id,
                        size_id: ms.size_id
                    }))
                ),
                inventory: modelsToEdit.flatMap(m => 
                    (m.model_inventory || []).map(mi => ({
                        id: mi.id,
                        model_id: m.id,
                        color_id: mi.color_id,
                        available_series: mi.available_series
                    }))
                ),
                images: modelsToEdit.flatMap(m => 
                    (m.model_images || []).map(img => ({
                        model_id: m.id,
                        image_url: img.image_url
                    }))
                )
            };

            // 🌟 الحذف المجمع على دفعات 🌟
            const idsToDelete = Array.from(selectedModelIds);
            const totalBatches = Math.ceil(idsToDelete.length / CHUNK_SIZE);

            for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
                const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
                
                if (progressText) {
                    progressText.textContent = `جاري حذف الموديلات المحددة (${idsToDelete.length} موديل - مجموعة ${batchNum} من ${totalBatches})...`;
                }

                try {
                    const { error } = await supabase.from('models').delete().in('id', chunk);
                    if (error) throw error;
                } catch (chunkErr) {
                    console.error(`Error deleting batch ${batchNum}:`, chunkErr);
                    errorsCollected.push(`المجموعة ${batchNum} (حذف الموديلات): ${chunkErr.message || chunkErr}`);
                }

                const percent = Math.round((batchNum / totalBatches) * 100);
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressPercent) progressPercent.textContent = `${percent}%`;
            }
            
            if (errorsCollected.length === 0) {
                showToast(`تم حذف ${selectedModelIds.size} موديل بنجاح!`, 'success');
                if (progressText) progressText.textContent = 'تم إتمام عملية الحذف بنجاح!';
            } else {
                showToast(`اكتمل الحذف مع وجود أخطاء في بعض المجموعات`, 'warning');
                if (progressText) progressText.textContent = 'اكتملت العملية مع وجود أخطاء.';
            }
            
            // إظهار زر التراجع للحذف
            const undoBtn = document.getElementById('btn-bulk-undo');
            if (undoBtn) {
                undoBtn.classList.remove('hidden');
                undoBtn.classList.add('flex');
            }
            selectedModelIds.clear();
            
        } else {
            // 🌟 التعديل المجمع على دفعات 🌟
            lastSnapshot = modelsToEdit.map(m => ({
                id: m.id, system_code: m.system_code, factory_code: m.factory_code,
                name: m.name, price: m.price, category_id: m.category_id, 
                class_id: m.class_id, is_active: m.is_active
            }));

            const updatedModels = lastSnapshot.map(m => {
                let newModel = { ...m };
                const val = parseFloat(inputVal);

                switch (action) {
                    case 'status_active': newModel.is_active = true; break;
                    case 'status_inactive': newModel.is_active = false; break;
                    case 'price_fixed': newModel.price = val; break;
                    case 'price_increase': newModel.price += val; break;
                    case 'price_decrease': newModel.price = Math.max(0, newModel.price - val); break;
                    case 'price_percent_increase': newModel.price = Math.round(newModel.price * (1 + val / 100)); break;
                    case 'price_percent_decrease': newModel.price = Math.max(0, Math.round(newModel.price * (1 - val / 100))); break;
                    case 'change_category': newModel.category_id = selectVal; break;
                    case 'change_class': newModel.class_id = classSelectVal; break;
                }
                return newModel;
            });

            const totalBatches = Math.ceil(updatedModels.length / CHUNK_SIZE);
            const classChanged = (action === 'change_class' && classSelectVal);
            
            // نسبة التقدم: إذا كان هناك تعديل فئة (الذي يحدث تعديل مخزون لاحقاً)، سنخصص 50% لتعديل الموديلات و50% لتعديل المخزون
            const maxProgressForModels = classChanged ? 50 : 100;

            for (let i = 0; i < updatedModels.length; i += CHUNK_SIZE) {
                const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                const chunk = updatedModels.slice(i, i + CHUNK_SIZE);
                
                if (progressText) {
                    progressText.textContent = `جاري تعديل الموديلات (${updatedModels.length} موديل - مجموعة ${batchNum} من ${totalBatches})...`;
                }

                try {
                    const { error } = await supabase.from('models').upsert(chunk);
                    if (error) throw error;
                } catch (chunkErr) {
                    console.error(`Error updating models batch ${batchNum}:`, chunkErr);
                    errorsCollected.push(`المجموعة ${batchNum} (تعديل الموديلات): ${chunkErr.message || chunkErr}`);
                }

                const percent = Math.round((batchNum / totalBatches) * maxProgressForModels);
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressPercent) progressPercent.textContent = `${percent}%`;
            }

            // تعديل فئات المقاسات والمخزون التابع لها
            if (classChanged) {
                const newClass = bulkClasses.find(c => c.id === classSelectVal);
                const S_new = newClass?.class_sizes?.length || 1;
                
                const inventoryUpdates = [];
                modelsToEdit.forEach(m => {
                    const oldClass = bulkClasses.find(c => c.id === m.class_id);
                    const S_old = oldClass?.class_sizes?.length || 1;
                    if (S_old !== S_new && m.model_inventory && m.model_inventory.length > 0) {
                        m.model_inventory.forEach(inv => {
                            const totalPieces = (inv.available_series || 0) * S_old;
                            const newSeries = Math.floor(totalPieces / S_new);
                            inventoryUpdates.push({
                                id: inv.id,
                                model_id: m.id,
                                color_id: inv.color_id,
                                available_series: newSeries
                            });
                        });
                    }
                });
                
                if (inventoryUpdates.length > 0) {
                    const totalInvBatches = Math.ceil(inventoryUpdates.length / CHUNK_SIZE);
                    for (let i = 0; i < inventoryUpdates.length; i += CHUNK_SIZE) {
                        const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                        const chunk = inventoryUpdates.slice(i, i + CHUNK_SIZE);
                        
                        if (progressText) {
                            progressText.textContent = `جاري تعديل المخزون المتأثر بالفئة العمرية (${inventoryUpdates.length} تحديث - مجموعة ${batchNum} من ${totalInvBatches})...`;
                        }

                        try {
                            const { error } = await supabase.from('model_inventory').upsert(chunk, { onConflict: 'id' });
                            if (error) throw error;
                        } catch (chunkErr) {
                            console.error(`Error updating inventory batch ${batchNum}:`, chunkErr);
                            errorsCollected.push(`المجموعة ${batchNum} (تحديث مخزون الفئة): ${chunkErr.message || chunkErr}`);
                        }

                        const percent = Math.round(50 + (batchNum / totalInvBatches) * 50);
                        if (progressBar) progressBar.style.width = `${percent}%`;
                        if (progressPercent) progressPercent.textContent = `${percent}%`;
                    }
                }
            }

            if (progressBar) progressBar.style.width = '100%';
            if (progressPercent) progressPercent.textContent = '100%';

            if (errorsCollected.length === 0) {
                showToast(`تم تعديل ${selectedModelIds.size} موديل بنجاح!`, 'success');
                if (progressText) progressText.textContent = 'تم إتمام التعديل المجمع بنجاح!';
            } else {
                showToast(`اكتمل التعديل مع وجود أخطاء في بعض المجموعات`, 'warning');
                if (progressText) progressText.textContent = 'اكتملت العملية مع وجود أخطاء.';
            }

            const undoBtn = document.getElementById('btn-bulk-undo');
            if (undoBtn) {
                undoBtn.classList.remove('hidden');
                undoBtn.classList.add('flex');
            }
        }

        // عرض الأخطاء المجمعة إن وجدت
        if (errorsCollected.length > 0 && progressErrors) {
            progressErrors.innerHTML = `
                <div class="font-bold mb-1">الأخطاء التي حدثت أثناء المعالجة:</div>
                ${errorsCollected.map(err => `<div>• ${err}</div>`).join('')}
            `;
            progressErrors.classList.remove('hidden');
        }

        await fetchBulkModels();
        if (typeof window.refreshModelsData === 'function') window.refreshModelsData();

    } catch (err) {
        console.error(err);
        showToast(`خطأ أثناء التنفيذ: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-lightning text-lg"></i> تنفيذ التعديلات`;
        
        // إعادة تمكين الحقول
        inputsToDisable.forEach(input => {
            if (input) input.disabled = false;
        });

        // إخفاء حاوية شريط التقدم بعد 5 ثوانٍ إن لم يكن هناك أخطاء
        const hasErrors = progressErrors && !progressErrors.classList.contains('hidden');
        if (!hasErrors) {
            setTimeout(() => {
                if (progressContainer) progressContainer.classList.add('hidden');
            }, 5000);
        }

        updateBulkActionBar(); 
    }
};

window.undoBulkEdit = async () => {
    if (!lastSnapshot) return;

    const isDeleteUndo = lastSnapshot.actionType === 'delete';
    const count = isDeleteUndo ? lastSnapshot.models.length : lastSnapshot.length;

    const confirmed = await confirmDialog({ 
        title: 'تراجع عن التعديل', 
        message: `هل تريد إرجاع ${count} موديل لحالتهم السابقة؟`, 
        isDestructive: true 
    });
    if (!confirmed) return;

    const btn = document.getElementById('btn-bulk-undo');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري التراجع...`;

    // إظهار شريط التقدم للتراجع
    const progressContainer = document.getElementById('bulk-progress-container');
    const progressBar = document.getElementById('bulk-progress-bar');
    const progressText = document.getElementById('bulk-progress-text');
    const progressPercent = document.getElementById('bulk-progress-percent');
    const progressErrors = document.getElementById('bulk-progress-errors');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar) progressBar.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressText) progressText.textContent = 'جاري التحضير لبدء عملية التراجع...';
    if (progressErrors) {
        progressErrors.innerHTML = '';
        progressErrors.classList.add('hidden');
    }

    const execBtn = document.getElementById('btn-bulk-execute');
    if (execBtn) execBtn.disabled = true;

    try {
        const CHUNK_SIZE = 100;
        const errorsCollected = [];
        
        if (isDeleteUndo) {
            // 1. استعادة جدول الموديلات (Models)
            const totalModels = lastSnapshot.models.length;
            const totalModelBatches = Math.ceil(totalModels / CHUNK_SIZE);
            
            for (let i = 0; i < totalModels; i += CHUNK_SIZE) {
                const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                const chunk = lastSnapshot.models.slice(i, i + CHUNK_SIZE);
                
                if (progressText) {
                    progressText.textContent = `جاري استعادة الموديلات (${totalModels} موديل - مجموعة ${batchNum} من ${totalModelBatches})...`;
                }
                
                try {
                    const { error } = await supabase.from('models').insert(chunk);
                    if (error) throw error;
                } catch (chunkErr) {
                    console.error(`Error restoring models batch ${batchNum}:`, chunkErr);
                    errorsCollected.push(`المجموعة ${batchNum} (استعادة الموديلات): ${chunkErr.message || chunkErr}`);
                }

                const percent = Math.round((batchNum / totalModelBatches) * 25);
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressPercent) progressPercent.textContent = `${percent}%`;
            }

            // 2. استعادة المقاسات (Model Sizes)
            if (lastSnapshot.sizes.length > 0) {
                const totalSizes = lastSnapshot.sizes.length;
                const totalSizeBatches = Math.ceil(totalSizes / CHUNK_SIZE);
                
                for (let i = 0; i < totalSizes; i += CHUNK_SIZE) {
                    const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                    const chunk = lastSnapshot.sizes.slice(i, i + CHUNK_SIZE);
                    
                    if (progressText) {
                        progressText.textContent = `جاري استعادة المقاسات المحددة (${totalSizes} مقاس - مجموعة ${batchNum} من ${totalSizeBatches})...`;
                    }
                    
                    try {
                        const { error } = await supabase.from('model_sizes').insert(chunk);
                        if (error) throw error;
                    } catch (chunkErr) {
                        console.error(`Error restoring sizes batch ${batchNum}:`, chunkErr);
                        errorsCollected.push(`المجموعة ${batchNum} (استعادة المقاسات): ${chunkErr.message || chunkErr}`);
                    }

                    const percent = Math.round(25 + (batchNum / totalSizeBatches) * 25);
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressPercent) progressPercent.textContent = `${percent}%`;
                }
            } else {
                if (progressBar) progressBar.style.width = '50%';
                if (progressPercent) progressPercent.textContent = '50%';
            }

            // 3. استعادة المخزون (Model Inventory)
            if (lastSnapshot.inventory.length > 0) {
                const totalInventory = lastSnapshot.inventory.length;
                const totalInvBatches = Math.ceil(totalInventory / CHUNK_SIZE);
                
                for (let i = 0; i < totalInventory; i += CHUNK_SIZE) {
                    const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                    const chunk = lastSnapshot.inventory.slice(i, i + CHUNK_SIZE);
                    
                    if (progressText) {
                        progressText.textContent = `جاري استعادة كميات المخزون المحددة (${totalInventory} سجل - مجموعة ${batchNum} من ${totalInvBatches})...`;
                    }
                    
                    try {
                        const { error } = await supabase.from('model_inventory').insert(chunk);
                        if (error) throw error;
                    } catch (chunkErr) {
                        console.error(`Error restoring inventory batch ${batchNum}:`, chunkErr);
                        errorsCollected.push(`المجموعة ${batchNum} (استعادة كميات المخزون): ${chunkErr.message || chunkErr}`);
                    }

                    const percent = Math.round(50 + (batchNum / totalInvBatches) * 25);
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressPercent) progressPercent.textContent = `${percent}%`;
                }
            } else {
                if (progressBar) progressBar.style.width = '75%';
                if (progressPercent) progressPercent.textContent = '75%';
            }

            // 4. استعادة صور الموديلات (Model Images)
            if (lastSnapshot.images.length > 0) {
                const totalImages = lastSnapshot.images.length;
                const totalImgBatches = Math.ceil(totalImages / CHUNK_SIZE);
                
                for (let i = 0; i < totalImages; i += CHUNK_SIZE) {
                    const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                    const chunk = lastSnapshot.images.slice(i, i + CHUNK_SIZE);
                    
                    if (progressText) {
                        progressText.textContent = `جاري استعادة صور الموديلات (${totalImages} صورة - مجموعة ${batchNum} من ${totalImgBatches})...`;
                    }
                    
                    try {
                        const { error } = await supabase.from('model_images').insert(chunk);
                        if (error) throw error;
                    } catch (chunkErr) {
                        console.error(`Error restoring images batch ${batchNum}:`, chunkErr);
                        errorsCollected.push(`المجموعة ${batchNum} (استعادة الصور): ${chunkErr.message || chunkErr}`);
                    }

                    const percent = Math.round(75 + (batchNum / totalImgBatches) * 25);
                    if (progressBar) progressBar.style.width = `${percent}%`;
                    if (progressPercent) progressPercent.textContent = `${percent}%`;
                }
            } else {
                if (progressBar) progressBar.style.width = '100%';
                if (progressPercent) progressPercent.textContent = '100%';
            }
        } else {
            // استعادة تعديل الخصائص (Original update undo)
            const totalUpdates = lastSnapshot.length;
            const totalUpdateBatches = Math.ceil(totalUpdates / CHUNK_SIZE);
            
            for (let i = 0; i < totalUpdates; i += CHUNK_SIZE) {
                const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
                const chunk = lastSnapshot.slice(i, i + CHUNK_SIZE);
                
                if (progressText) {
                    progressText.textContent = `جاري استعادة البيانات القديمة (${totalUpdates} موديل - مجموعة ${batchNum} من ${totalUpdateBatches})...`;
                }
                
                try {
                    const { error } = await supabase.from('models').upsert(chunk);
                    if (error) throw error;
                } catch (chunkErr) {
                    console.error(`Error restoring updates batch ${batchNum}:`, chunkErr);
                    errorsCollected.push(`المجموعة ${batchNum} (استعادة التعديلات السابقة): ${chunkErr.message || chunkErr}`);
                }

                const percent = Math.round((batchNum / totalUpdateBatches) * 100);
                if (progressBar) progressBar.style.width = `${percent}%`;
                if (progressPercent) progressPercent.textContent = `${percent}%`;
            }
        }

        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';

        if (errorsCollected.length === 0) {
            showToast('تم التراجع بنجاح وإعادة البيانات القديمة!', 'success');
            if (progressText) progressText.textContent = 'تم استعادة الحالة السابقة للبيانات بنجاح!';
            btn.classList.add('hidden');
            btn.classList.remove('flex');
            lastSnapshot = null; 
        } else {
            showToast('اكتمل التراجع مع وجود بعض الأخطاء', 'warning');
            if (progressText) progressText.textContent = 'اكتملت عملية الاستعادة مع وجود أخطاء.';
        }

        // عرض الأخطاء المجمعة في التراجع
        if (errorsCollected.length > 0 && progressErrors) {
            progressErrors.innerHTML = `
                <div class="font-bold mb-1">الأخطاء التي حدثت أثناء التراجع والاستعادة:</div>
                ${errorsCollected.map(err => `<div>• ${err}</div>`).join('')}
            `;
            progressErrors.classList.remove('hidden');
        }

        await fetchBulkModels();
        if (typeof window.refreshModelsData === 'function') window.refreshModelsData();

    } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء محاولة التراجع: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-arrow-u-up-left text-lg"></i> تراجع (Undo)`;
        if (execBtn) execBtn.disabled = false;

        // إخفاء حاوية شريط التقدم بعد 5 ثوانٍ إن لم يكن هناك أخطاء
        const hasErrors = progressErrors && !progressErrors.classList.contains('hidden');
        if (!hasErrors) {
            setTimeout(() => {
                if (progressContainer) progressContainer.classList.add('hidden');
            }, 5000);
        }

        updateBulkActionBar();
    }
};

// --- Custom Sort Handler ---
window.customSortHandlers = window.customSortHandlers || {};
window.customSortHandlers['bulk-table'] = (colIndex, direction) => {
    bulkAllModels.sort((a, b) => {
        let valA, valB;
        switch (colIndex) {
            case 1: // الكود والموديل
                valA = a.factory_code || '';
                valB = b.factory_code || '';
                break;
            case 2: // السعر
                valA = a.price || 0;
                valB = b.price || 0;
                break;
            case 3: // التصنيف / المخزون
                // Sort by total stock quantity
                valA = a.model_inventory?.reduce((sum, inv) => sum + (inv.available_series || 0), 0) || 0;
                valB = b.model_inventory?.reduce((sum, inv) => sum + (inv.available_series || 0), 0) || 0;
                break;
            case 4: // الحالة
                valA = a.is_active ? 1 : 0;
                valB = b.is_active ? 1 : 0;
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

    window.applyBulkFilters();
};