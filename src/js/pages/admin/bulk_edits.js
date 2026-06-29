import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

let isBulkInitialized = false;
let bulkAllModels = []; 
let filteredBulkModels = [];
let selectedModelIds = new Set();
let lastSnapshot = null; 

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

window.toggleMultiSelectDropdown = (event, menuId) => {
    event.stopPropagation();
    const menu = document.getElementById(menuId);
    if (!menu) return;
    
    // Close other dropdowns
    const allMenus = document.querySelectorAll('.multi-select-dropdown [id$="-menu"]');
    allMenus.forEach(m => {
        if (m.id !== menuId) {
            m.classList.add('hidden');
        }
    });
    
    menu.classList.toggle('hidden');
};

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

// Global click handler to close dropdowns when clicking outside
document.addEventListener('click', () => {
    const allMenus = document.querySelectorAll('.multi-select-dropdown [id$="-menu"]');
    allMenus.forEach(m => m.classList.add('hidden'));
});

async function fetchBulkFilterOptions() {
    try {
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

async function fetchBulkModels() {
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
                    model_inventory(color_id, available_series)
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
    if (selectedModelIds.size > 0) {
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
    const action = document.getElementById('bulk-action-type').value;
    if (!action) return showToast('الرجاء اختيار الإجراء أولاً', 'warning');

    const inputVal = document.getElementById('bulk-action-input').value;
    const selectVal = document.getElementById('bulk-action-select').value;
    const classSelectVal = document.getElementById('bulk-action-class-select').value;

    if (action.includes('price') && (!inputVal || inputVal <= 0)) return showToast('الرجاء إدخال قيمة صحيحة', 'error');
    if (action === 'change_category' && !selectVal) return showToast('الرجاء اختيار التصنيف الجديد', 'error');
    if (action === 'change_class' && !classSelectVal) return showToast('الرجاء اختيار الفئة العمرية الجديدة', 'error');

    const isDelete = action === 'delete_models';
    const confirmMsg = isDelete 
        ? `تحذير خطير: سيتم حذف ${selectedModelIds.size} موديل نهائياً وبلا رجعة! هل أنت متأكد تماماً؟`
        : `سيتم تطبيق هذا التعديل على ${selectedModelIds.size} موديل. هل أنت متأكد؟`;

    const confirmed = await confirmDialog({ 
        title: isDelete ? 'حذف مجمع للموديلات 🗑️' : 'تأكيد التعديل المجمع', 
        message: confirmMsg, 
        isDestructive: isDelete 
    });
    
    if (!confirmed) return;

    const btn = document.getElementById('btn-bulk-execute');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري التنفيذ...`;

    try {
        const modelsToEdit = bulkAllModels.filter(m => selectedModelIds.has(m.id));
        const CHUNK_SIZE = 300;

        if (isDelete) {
            // 🌟 خوارزمية الحذف المجمع 🌟
            const idsToDelete = Array.from(selectedModelIds);
            for (let i = 0; i < idsToDelete.length; i += CHUNK_SIZE) {
                const chunk = idsToDelete.slice(i, i + CHUNK_SIZE);
                const { error } = await supabase.from('models').delete().in('id', chunk);
                if (error) throw error;
            }
            
            showToast(`تم حذف ${selectedModelIds.size} موديل بنجاح!`, 'success');
            
            // نخفي زر التراجع لأن الحذف لا يمكن التراجع فيه
            document.getElementById('btn-bulk-undo').classList.add('hidden');
            document.getElementById('btn-bulk-undo').classList.remove('flex');
            selectedModelIds.clear();
            lastSnapshot = null;
            
        } else {
            // 🌟 خوارزميات التعديل (النسب المئوية والأسعار) 🌟
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

            for (let i = 0; i < updatedModels.length; i += CHUNK_SIZE) {
                const chunk = updatedModels.slice(i, i + CHUNK_SIZE);
                const { error } = await supabase.from('models').upsert(chunk);
                if (error) throw error;
            }

            showToast(`تم تعديل ${selectedModelIds.size} موديل بنجاح!`, 'success');
            document.getElementById('btn-bulk-undo').classList.remove('hidden');
            document.getElementById('btn-bulk-undo').classList.add('flex');
        }

        await fetchBulkModels();
        if (typeof window.refreshModelsData === 'function') window.refreshModelsData();

    } catch (err) {
        console.error(err);
        showToast(`خطأ أثناء التنفيذ: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-lightning text-lg"></i> تنفيذ الإجراءات`;
        updateBulkActionBar(); 
    }
};

window.undoBulkEdit = async () => {
    if (!lastSnapshot || lastSnapshot.length === 0) return;

    const confirmed = await confirmDialog({ title: 'تراجع عن التعديل', message: `هل تريد إرجاع ${lastSnapshot.length} موديل لحالتهم السابقة؟`, isDestructive: true });
    if (!confirmed) return;

    const btn = document.getElementById('btn-bulk-undo');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري التراجع...`;

    try {
        const CHUNK_SIZE = 300;
        for (let i = 0; i < lastSnapshot.length; i += CHUNK_SIZE) {
            const chunk = lastSnapshot.slice(i, i + CHUNK_SIZE);
            const { error } = await supabase.from('models').upsert(chunk);
            if (error) throw error;
        }

        showToast('تم التراجع بنجاح وإعادة البيانات القديمة!', 'success');
        btn.classList.add('hidden');
        btn.classList.remove('flex');
        lastSnapshot = null; 

        await fetchBulkModels();
        if (typeof window.refreshModelsData === 'function') window.refreshModelsData();

    } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء محاولة التراجع', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-arrow-u-up-left text-lg"></i> تراجع (Undo)`;
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