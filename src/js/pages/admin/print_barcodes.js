import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';

let isBarcodeInitialized = false;
let barcodeAllModels = []; 
let filteredBarcodeModels = [];
let selectedBarcodeModelIds = new Set();
let sizesMap = {};
let colorsMap = {};

let barcodeCurrentPage = 1;
const barcodeItemsPerPage = 50;

export async function initPrintBarcodesView() {
    if (isBarcodeInitialized) return;
    
    await fetchBarcodeFilterOptions();
    await fetchBarcodeModels();

    const stockOp = document.getElementById('barcode-filter-stock-op');
    const stockQty = document.getElementById('barcode-filter-stock-qty');
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
    
    // Initialize Standalone Generator Autocomplete & Controls
    initStandaloneBarcodeGenerator();
    window.renderStandaloneBarcode();

    isBarcodeInitialized = true;
}

// 🌟 دالة فتح/غلق الفلاتر 🌟
window.toggleBarcodeFilters = () => {
    const container = document.getElementById('barcode-filters-container');
    const icon = document.getElementById('barcode-filter-icon');
    
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        icon.style.transform = 'rotate(0deg)';
    } else {
        container.classList.add('hidden');
        icon.style.transform = 'rotate(180deg)';
    }
};

window.toggleBarcodeMultiSelectDropdown = (event, menuId) => {
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

window.barcodeMultiSelectAction = (event, key, action) => {
    event.stopPropagation();
    const checkboxes = document.querySelectorAll(`input[name="barcode-filter-${key}"]`);
    checkboxes.forEach(cb => {
        cb.checked = (action === 'all');
    });
    window.updateBarcodeMultiSelectLabel(key);
};

window.updateBarcodeMultiSelectLabel = (key) => {
    const checkboxes = document.querySelectorAll(`input[name="barcode-filter-${key}"]:checked`);
    const excludeCheckbox = document.getElementById(`barcode-dropdown-${key}-exclude`);
    const labelEl = document.getElementById(`barcode-dropdown-${key}-label`);
    
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
    const allBarcodeMenus = document.querySelectorAll('.multi-select-dropdown [id^="barcode-dropdown-"][id$="-menu"]');
    allBarcodeMenus.forEach(m => m.classList.add('hidden'));
});

export async function fetchBarcodeFilterOptions() {
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
                        <input type="checkbox" value="${item.id}" name="barcode-filter-${key}" class="accent-devo-orange w-3.5 h-3.5 rounded cursor-pointer" onchange="updateBarcodeMultiSelectLabel('${key}')">
                        <span class="truncate">${item.name}</span>
                    </label>
                `).join('');
            }
        };

        populateCheckbox('barcode-dropdown-cat-options', cats.data, 'cat');
        populateCheckbox('barcode-dropdown-class-options', clss.data, 'class');
        populateCheckbox('barcode-dropdown-color-options', colors.data, 'color');
        populateCheckbox('barcode-dropdown-size-options', sizes.data, 'size');

        if (sizes && sizes.data) {
            sizes.data.forEach(s => {
                sizesMap[s.id] = s.name;
            });
        }

        if (colors && colors.data) {
            colors.data.forEach(c => {
                colorsMap[c.id] = c.name;
            });
        }

        // Setup labels
        window.updateBarcodeMultiSelectLabel('cat');
        window.updateBarcodeMultiSelectLabel('class');
        window.updateBarcodeMultiSelectLabel('color');
        window.updateBarcodeMultiSelectLabel('size');

    } catch (err) {
        console.error("Error fetching filter options:", err);
    }
}

export async function fetchBarcodeModels() {
    const tbody = document.getElementById('barcode-table-body');
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
                    model_inventory(color_id, available_series, colors(name)),
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
        
        barcodeAllModels = allFetchedData;
        window.applyBarcodeFilters();

    } catch (error) {
        console.error("Barcode Fetch Error:", error);
        showToast('خطأ في تحميل الموديلات للطباعة', 'error');
    }
}

window.applyBarcodeFilters = () => {
    const nameTerm = document.getElementById('barcode-search-name')?.value.toLowerCase().trim() || '';
    const factoryTerm = document.getElementById('barcode-search-factory')?.value.toLowerCase().trim() || '';
    const systemTerm = document.getElementById('barcode-search-system')?.value.toLowerCase().trim() || '';

    const factoryFromVal = document.getElementById('barcode-factory-from')?.value.trim() || '';
    const factoryToVal = document.getElementById('barcode-factory-to')?.value.trim() || '';

    const selectedCats = Array.from(document.querySelectorAll('input[name="barcode-filter-cat"]:checked')).map(cb => cb.value);
    const isCatExclude = document.getElementById('barcode-dropdown-cat-exclude')?.checked || false;

    const selectedClasses = Array.from(document.querySelectorAll('input[name="barcode-filter-class"]:checked')).map(cb => cb.value);
    const isClassExclude = document.getElementById('barcode-dropdown-class-exclude')?.checked || false;

    const status = document.getElementById('barcode-filter-status')?.value || '';
    const stockOp = document.getElementById('barcode-filter-stock-op')?.value || '';
    const stockQtyVal = parseInt(document.getElementById('barcode-filter-stock-qty')?.value, 10);

    const selectedColors = Array.from(document.querySelectorAll('input[name="barcode-filter-color"]:checked')).map(cb => cb.value);
    const isColorExclude = document.getElementById('barcode-dropdown-color-exclude')?.checked || false;

    const selectedSizes = Array.from(document.querySelectorAll('input[name="barcode-filter-size"]:checked')).map(cb => cb.value);
    const isSizeExclude = document.getElementById('barcode-dropdown-size-exclude')?.checked || false;

    const minPriceVal = document.getElementById('barcode-price-min')?.value;
    const maxPriceVal = document.getElementById('barcode-price-max')?.value;
    const minPrice = minPriceVal ? parseFloat(minPriceVal) : NaN;
    const maxPrice = maxPriceVal ? parseFloat(maxPriceVal) : NaN;

    const dateFrom = document.getElementById('barcode-date-from')?.value || '';
    const dateTo = document.getElementById('barcode-date-to')?.value || '';

    filteredBarcodeModels = barcodeAllModels.filter(m => {
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

    selectedBarcodeModelIds.clear();
    filteredBarcodeModels.forEach(m => selectedBarcodeModelIds.add(m.id));
    
    barcodeCurrentPage = 1; 

    renderBarcodePage();
    updateBarcodeActionBar();
};

window.clearBarcodeFilters = () => {
    const textSelectIds = [
        'barcode-search-name', 'barcode-search-factory', 'barcode-search-system',
        'barcode-factory-from', 'barcode-factory-to',
        'barcode-filter-status', 'barcode-filter-stock-op', 'barcode-filter-stock-qty',
        'barcode-price-min', 'barcode-price-max', 
        'barcode-date-from', 'barcode-date-to'
    ];
    textSelectIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const stockQty = document.getElementById('barcode-filter-stock-qty');
    if (stockQty) stockQty.classList.add('hidden');

    const multiSelectKeys = ['cat', 'class', 'color', 'size'];
    multiSelectKeys.forEach(key => {
        const checkboxes = document.querySelectorAll(`input[name="barcode-filter-${key}"]`);
        checkboxes.forEach(cb => {
            cb.checked = false;
        });
        const excludeCb = document.getElementById(`barcode-dropdown-${key}-exclude`);
        if (excludeCb) excludeCb.checked = false;
        
        window.updateBarcodeMultiSelectLabel(key);
    });

    window.applyBarcodeFilters(); 
};

function renderBarcodePage() {
    const tbody = document.getElementById('barcode-table-body');
    const paginationContainer = document.getElementById('barcode-pagination');
    const masterCb = document.getElementById('barcode-select-all');
    
    document.getElementById('barcode-results-count').textContent = filteredBarcodeModels.length;
    document.getElementById('barcode-selected-count').textContent = selectedBarcodeModelIds.size;

    if (filteredBarcodeModels.length === 0) {
        if(masterCb) { masterCb.checked = false; masterCb.disabled = true; }
        if(tbody) tbody.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-devo-muted">لا توجد نتائج مطابقة للبحث</td></tr>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    if(masterCb) {
        masterCb.disabled = false;
        masterCb.checked = selectedBarcodeModelIds.size === filteredBarcodeModels.length;
    }

    const totalItems = filteredBarcodeModels.length;
    const totalPages = Math.ceil(totalItems / barcodeItemsPerPage);
    
    if (barcodeCurrentPage > totalPages) barcodeCurrentPage = totalPages;
    if (barcodeCurrentPage < 1) barcodeCurrentPage = 1;

    const startIndex = (barcodeCurrentPage - 1) * barcodeItemsPerPage;
    const endIndex = startIndex + barcodeItemsPerPage;
    const pageData = filteredBarcodeModels.slice(startIndex, endIndex);

    if(tbody) {
        tbody.innerHTML = pageData.map(m => {
            const totalQty = m.model_inventory?.reduce((sum, inv) => sum + (inv.available_series || 0), 0) || 0;
            return `
            <tr class="hover:bg-devo-black/50 transition-colors border-b border-devo-gray/50">
                <td class="p-3 text-center border-l border-devo-gray/30">
                    <input type="checkbox" value="${m.id}" onchange="toggleSingleBarcodeCheck(this)" class="barcode-item-cb accent-devo-orange w-4 h-4 cursor-pointer" ${selectedBarcodeModelIds.has(m.id) ? 'checked' : ''}>
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

    renderBarcodePaginationControls(totalPages);
}

function renderBarcodePaginationControls(totalPages) {
    const container = document.getElementById('barcode-pagination');
    if (!container) return;

    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    html += `<button onclick="changeBarcodePage(${barcodeCurrentPage - 1})" ${barcodeCurrentPage === 1 ? 'disabled' : ''} class="px-3 py-1.5 rounded border border-devo-gray bg-devo-black text-white hover:bg-devo-gray transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-xs"><i class="ph ph-caret-right"></i> السابق</button>`;
    html += `<span class="px-4 py-1.5 rounded bg-devo-dark text-devo-orange font-bold border border-devo-gray text-xs">صفحة ${barcodeCurrentPage} من ${totalPages}</span>`;
    html += `<button onclick="changeBarcodePage(${barcodeCurrentPage + 1})" ${barcodeCurrentPage === totalPages ? 'disabled' : ''} class="px-3 py-1.5 rounded border border-devo-gray bg-devo-black text-white hover:bg-devo-gray transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-xs">التالي <i class="ph ph-caret-left"></i></button>`;

    container.innerHTML = html;
}

window.changeBarcodePage = (newPage) => {
    barcodeCurrentPage = newPage;
    renderBarcodePage();
};

window.toggleBarcodeSelectAll = (cb) => {
    selectedBarcodeModelIds.clear();
    if (cb.checked) {
        filteredBarcodeModels.forEach(m => selectedBarcodeModelIds.add(m.id));
    }
    renderBarcodePage(); 
    updateBarcodeActionBar();
};

window.toggleSingleBarcodeCheck = (cb) => {
    if (cb.checked) selectedBarcodeModelIds.add(cb.value);
    else selectedBarcodeModelIds.delete(cb.value);
    
    document.getElementById('barcode-selected-count').textContent = selectedBarcodeModelIds.size;
    const masterCb = document.getElementById('barcode-select-all');
    if(masterCb) masterCb.checked = selectedBarcodeModelIds.size === filteredBarcodeModels.length;
    updateBarcodeActionBar();
};

function updateBarcodeActionBar() {
    const bar = document.getElementById('barcode-action-bar');
    if (selectedBarcodeModelIds.size > 0) {
        bar.classList.remove('hidden');
        bar.classList.add('block');
    } else {
        bar.classList.add('hidden');
        bar.classList.remove('block');
    }
}

// =========================================================================
// 🌟 7. تصدير وطباعة الباركود المجمع 🌟
// =========================================================================

// دالة مساعدة للحصول على نص مقاسات الموديل المنسق
function getModelSizesString(m) {
    let sizeNames = [];
    if (m.classes?.class_sizes && m.classes.class_sizes.length > 0) {
        sizeNames = m.classes.class_sizes.map(cs => sizesMap[cs.size_id] || cs.size_id);
    } else if (m.model_sizes && m.model_sizes.length > 0) {
        sizeNames = m.model_sizes.map(ms => sizesMap[ms.size_id] || ms.size_id);
    }
    return sizeNames.filter(Boolean).join('، ');
}

// دالة تحميل مكتبات التشفير ديناميكياً
async function loadPrintingLibraries() {
    if (typeof JsBarcode === 'undefined') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js');
    }
    if (typeof QRCode === 'undefined') {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcode/1.4.4/qrcode.min.js');
    }
}

function loadScript(url) {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
        return new Promise((resolve) => {
            if (existing.dataset.loaded === "true") {
                resolve();
            } else {
                existing.addEventListener('load', resolve);
                existing.addEventListener('error', resolve);
            }
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
            script.dataset.loaded = "true";
            resolve();
        };
        script.onerror = (err) => {
            script.remove();
            reject(err);
        };
        document.head.appendChild(script);
    });
}

// دالة إخفاء/تفعيل مدخلات عدد النسخ الثابت
window.toggleBarcodeQtyInput = () => {
    const qtyMode = document.getElementById('bulk-barcode-qty-mode').value;
    const container = document.getElementById('bulk-barcode-fixed-qty-container');
    if (container) {
        const input = container.querySelector('input');
        if (qtyMode === 'fixed') {
            container.classList.remove('opacity-50', 'pointer-events-none');
            if (input) input.disabled = false;
        } else {
            container.classList.add('opacity-50', 'pointer-events-none');
            if (input) input.disabled = true;
        }
    }
};

// دالة تحديث المعاينة الحية للملصق بداخل المودال
window.updateBarcodePreview = () => {
    const codeType = document.getElementById('bulk-barcode-type').value;
    const valueSource = document.getElementById('bulk-barcode-value-source').value;
    
    const paperW = parseFloat(document.getElementById('bulk-barcode-paper-w').value) || 4;
    const paperH = parseFloat(document.getElementById('bulk-barcode-paper-h').value) || 5;
    
    const fontName = parseInt(document.getElementById('bulk-barcode-font-size-name').value, 10) || 11;
    const fontDetails = parseInt(document.getElementById('bulk-barcode-font-size-details').value, 10) || 9;
    const fontPrice = parseInt(document.getElementById('bulk-barcode-font-size-price').value, 10) || 12;
    
    const showName = document.getElementById('bulk-barcode-show-name').checked;
    const showCode = document.getElementById('bulk-barcode-show-code').checked;
    const showSizes = document.getElementById('bulk-barcode-show-sizes').checked;
    const showPrice = document.getElementById('bulk-barcode-show-price').checked;
    const showColors = document.getElementById('bulk-barcode-show-colors').checked;
    const colorDist = document.getElementById('bulk-barcode-color-dist').value;

    // ضبط أبعاد كرت المعاينة
    const previewCard = document.getElementById('barcode-preview-card');
    if (previewCard) {
        previewCard.style.width = `${paperW}cm`;
        previewCard.style.height = `${paperH}cm`;
        previewCard.style.padding = `${Math.min(paperW, paperH) * 0.08}cm`;
    }

    // إظهار/إخفاء الحقول وضبط الخط بشكل منفصل
    const prevName = document.getElementById('prev-name');
    const prevCode = document.getElementById('prev-code');
    const prevSizes = document.getElementById('prev-sizes');
    const prevColors = document.getElementById('prev-colors');
    const prevPrice = document.getElementById('prev-price');

    if (prevName) {
        prevName.style.display = showName ? '-webkit-box' : 'none';
        prevName.style.fontSize = `${fontName}px`;
    }
    if (prevCode) {
        prevCode.style.display = showCode ? 'block' : 'none';
        prevCode.style.fontSize = `${fontDetails}px`;
    }
    if (prevSizes) {
        prevSizes.style.display = showSizes ? 'block' : 'none';
        prevSizes.style.fontSize = `${fontDetails}px`;
    }
    if (prevColors) {
        prevColors.style.display = showColors ? 'block' : 'none';
        prevColors.style.fontSize = `${fontDetails}px`;
        if (colorDist === 'separate') {
            prevColors.textContent = 'أحمر (مثال لون منفرد)';
        } else {
            prevColors.textContent = 'أحمر، أسود، أزرق';
        }
    }
    if (prevPrice) {
        prevPrice.style.display = showPrice ? 'block' : 'none';
        prevPrice.style.fontSize = `${fontPrice}px`;
        prevPrice.style.paddingTop = `${fontPrice * 0.2}px`;
    }

    // رسم الكود التجريبي
    const barcodeSvg = document.getElementById('prev-barcode-svg');
    const qrcodeImg = document.getElementById('prev-qrcode-img');
    const sampleValue = 'DEVO-12345';

    if (codeType === 'barcode') {
        barcodeSvg.classList.remove('hidden');
        qrcodeImg.classList.add('hidden');
        try {
            if (typeof JsBarcode !== 'undefined') {
                JsBarcode(barcodeSvg, sampleValue, {
                    format: "CODE128",
                    width: 1.8,
                    height: 50,
                    displayValue: false,
                    margin: 0
                });
            }
        } catch(e) {
            console.error("Preview JsBarcode error:", e);
        }
    } else {
        barcodeSvg.classList.add('hidden');
        qrcodeImg.classList.remove('hidden');
        if (typeof QRCode !== 'undefined') {
            QRCode.toDataURL(sampleValue, { width: 250, margin: 1 })
                .then(url => { qrcodeImg.src = url; })
                .catch(err => {
                    console.error("Local QRCode error:", err);
                    qrcodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(sampleValue)}`;
                });
        } else {
            qrcodeImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(sampleValue)}`;
        }
    }
};

window.openBulkBarcodeModal = async () => {
    if (selectedBarcodeModelIds.size === 0) {
        return showToast('الرجاء تحديد موديل واحد على الأقل أولاً', 'warning');
    }

    try {
        await loadPrintingLibraries();
    } catch(e) {
        console.error("Failed to load barcode scripts:", e);
        showToast('خطأ في تحميل مكتبات الباركود، تحقق من الاتصال بالشبكة', 'error');
    }

    // تهيئة واستدعاء القوالب المحفوظة
    window.initBarcodeTemplates();

    const countEl = document.getElementById('bulk-barcode-count');
    if (countEl) countEl.textContent = selectedBarcodeModelIds.size;

    const modal = document.getElementById('bulk-barcode-modal');
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        modal.classList.add('flex');
        window.toggleBarcodeQtyInput();
        window.updateBarcodePreview();
    }, 10);
};

window.closeBulkBarcodeModal = () => {
    const modal = document.getElementById('bulk-barcode-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, 300);
};

window.generateAndPrintBulkBarcodes = () => {
    if (selectedBarcodeModelIds.size === 0) return showToast('الرجاء تحديد موديل واحد على الأقل أولاً', 'warning');

    const codeType = document.getElementById('bulk-barcode-type').value;
    const valueSource = document.getElementById('bulk-barcode-value-source').value;
    
    const paperW = parseFloat(document.getElementById('bulk-barcode-paper-w').value) || 4;
    const paperH = parseFloat(document.getElementById('bulk-barcode-paper-h').value) || 5;
    
    const fontName = parseInt(document.getElementById('bulk-barcode-font-size-name').value, 10) || 11;
    const fontDetails = parseInt(document.getElementById('bulk-barcode-font-size-details').value, 10) || 9;
    const fontPrice = parseInt(document.getElementById('bulk-barcode-font-size-price').value, 10) || 12;
    
    const showName = document.getElementById('bulk-barcode-show-name').checked;
    const showCode = document.getElementById('bulk-barcode-show-code').checked;
    const showSizes = document.getElementById('bulk-barcode-show-sizes').checked;
    const showPrice = document.getElementById('bulk-barcode-show-price').checked;
    const showColors = document.getElementById('bulk-barcode-show-colors').checked;
    const skipZeroStock = document.getElementById('bulk-barcode-skip-zero-stock-colors').checked;

    const qtyMode = document.getElementById('bulk-barcode-qty-mode').value;
    const fixedQty = parseInt(document.getElementById('bulk-barcode-fixed-qty').value, 10) || 1;
    const colorDist = document.getElementById('bulk-barcode-color-dist').value;

    // Get selected models data
    const selectedModels = barcodeAllModels.filter(m => selectedBarcodeModelIds.has(m.id));

    if (selectedModels.length === 0) return showToast('الموديلات المحددة غير متوفرة', 'error');

    showToast('جاري تحضير الباركود للطباعة...', 'info');

    // Generate label items based on copies count and color choices
    const labelsToPrint = [];
    selectedModels.forEach(m => {
        const hasInventoryEntries = m.model_inventory && m.model_inventory.length > 0;
        
        let colorsList = [];
        if (hasInventoryEntries) {
            let inventoryItems = m.model_inventory;
            if (skipZeroStock) {
                inventoryItems = inventoryItems.filter(inv => (inv.available_series || 0) > 0);
            }
            const modelColors = inventoryItems.map(inv => {
                return (inv.colors && inv.colors.name) || colorsMap[inv.color_id] || '';
            }).filter(Boolean);
            colorsList = [...new Set(modelColors)];
            
            // If all colors of the model are out of stock and we are skipping out-of-stock, skip this model completely
            if (colorsList.length === 0 && skipZeroStock) {
                return;
            }
        }
        
        const hasColors = colorsList.length > 0;
        if (colorsList.length === 0) {
            colorsList = [''];
        }

        const baseLabel = {
            name: m.name,
            factory_code: m.factory_code,
            system_code: m.system_code,
            price: m.price,
            sizesStr: getModelSizesString(m),
            value: (valueSource === 'system' ? m.system_code : m.factory_code) || m.system_code || '0000000'
        };

        if (qtyMode === 'by_color') {
            const copiesCount = colorsList.length;
            if (colorDist === 'separate') {
                colorsList.forEach(color => {
                    labelsToPrint.push({
                        ...baseLabel,
                        colorStr: showColors ? color : ''
                    });
                });
            } else {
                const allColorsJoined = showColors && hasColors ? colorsList.join('، ') : '';
                for (let i = 0; i < copiesCount; i++) {
                    labelsToPrint.push({
                        ...baseLabel,
                        colorStr: allColorsJoined
                    });
                }
            }
        } else {
            const copiesCount = Math.max(1, fixedQty);
            if (colorDist === 'separate') {
                colorsList.forEach(color => {
                    for (let i = 0; i < copiesCount; i++) {
                        labelsToPrint.push({
                            ...baseLabel,
                            colorStr: showColors ? color : ''
                        });
                    }
                });
            } else {
                const allColorsJoined = showColors && hasColors ? colorsList.join('، ') : '';
                for (let i = 0; i < copiesCount; i++) {
                    labelsToPrint.push({
                        ...baseLabel,
                        colorStr: allColorsJoined
                    });
                }
            }
        }
    });

    const labelsDataJson = JSON.stringify(labelsToPrint);

    const printHtml = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>طباعة الباركود</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700&display=swap');
        @page {
            size: ${paperW}cm ${paperH}cm;
            margin: 0;
        }
        body {
            margin: 0;
            padding: 0;
            background: white;
            color: black;
            font-family: 'Tajawal', sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .barcode-label {
            width: ${paperW}cm;
            height: ${paperH}cm;
            page-break-after: always;
            box-sizing: border-box;
            padding: ${Math.min(paperW, paperH) * 0.08}cm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            text-align: center;
            overflow: hidden;
        }
        .model-name {
            font-size: ${fontName}px;
            font-weight: 700;
            width: 100%;
            display: ${showName ? '-webkit-box' : 'none'};
            -webkit-line-clamp: 2;
            line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
            text-align: center;
            word-break: break-word;
        }
        .model-code {
            font-size: ${fontDetails}px;
            font-weight: 700;
            color: #000;
            margin-top: 1px;
            font-family: monospace;
            display: ${showCode ? 'block' : 'none'};
        }
        .model-sizes {
            font-size: ${fontDetails}px;
            font-weight: 700;
            color: #000;
            margin-top: 1px;
            display: ${showSizes ? 'block' : 'none'};
            width: 100%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .model-colors {
            font-size: ${fontDetails}px;
            font-weight: 700;
            color: #000;
            margin-top: 1px;
            display: ${showColors ? 'block' : 'none'};
            width: 100%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .code-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: ${paperH * 0.45}cm;
            margin: 2px 0;
        }
        .code-container svg, .code-container img {
            max-width: 100%;
            max-height: 100%;
            display: block;
        }
        .model-price {
            font-size: ${fontPrice}px;
            font-weight: 700;
            margin-top: 1px;
            border-top: 1px dashed #000;
            width: 100%;
            padding-top: ${fontPrice * 0.2}px;
            display: ${showPrice ? 'block' : 'none'};
        }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode/1.4.4/qrcode.min.js"></script>
</head>
<body>
    <div id="labels-container"></div>

    <script>
        const labels = ${labelsDataJson};
        const codeType = "${codeType}";

        const container = document.getElementById('labels-container');
        const qrPromises = [];
        
        labels.forEach((lbl, idx) => {
            const labelDiv = document.createElement('div');
            labelDiv.className = 'barcode-label';
            
            labelDiv.innerHTML = '<div>' +
                '<div class="model-name">' + lbl.name + '</div>' +
                '<div class="model-code">' + (lbl.factory_code || lbl.system_code || '') + '</div>' +
                (lbl.sizesStr ? '<div class="model-sizes">' + lbl.sizesStr + '</div>' : '') +
                (lbl.colorStr ? '<div class="model-colors">' + lbl.colorStr + '</div>' : '') +
            '</div>' +
            '<div class="code-container">' +
                (codeType === 'barcode' 
                    ? '<svg id="barcode-' + idx + '"></svg>' 
                    : '<img id="qrcode-' + idx + '" src="">'
                ) +
            '</div>' +
            '<div class="model-price">' + lbl.price + ' ج.م</div>';
            
            container.appendChild(labelDiv);

            if (codeType === 'barcode') {
                try {
                    JsBarcode("#barcode-" + idx, lbl.value, {
                        format: "CODE128",
                        width: 2.0,
                        height: 65,
                        displayValue: false,
                        margin: 0
                    });
                } catch(e) {
                    console.error("JsBarcode failed for", lbl.value, e);
                }
            } else if (codeType === 'qrcode') {
                if (typeof QRCode !== 'undefined') {
                    const promise = QRCode.toDataURL(lbl.value, { width: 250, margin: 1 })
                        .then(url => {
                            const img = document.getElementById('qrcode-' + idx);
                            if (img) img.src = url;
                        })
                        .catch(err => {
                            console.error("Local QRCode generate failed, falling back:", err);
                            const img = document.getElementById('qrcode-' + idx);
                            if (img) img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(lbl.value);
                        });
                    qrPromises.push(promise);
                } else {
                    const img = document.getElementById('qrcode-' + idx);
                    if (img) img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(lbl.value);
                }
            }
        });

        window.onload = function() {
            Promise.all(qrPromises).then(() => {
                setTimeout(() => {
                    window.focus();
                    window.print();
                }, 800);
            });
        };
    </script>
</body>
</html>
    `;

    // Print inside an iframe
    let iframe = document.getElementById('print-barcode-iframe');
    if (iframe) {
        iframe.remove();
    }
    iframe = document.createElement('iframe');
    iframe.id = 'print-barcode-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '-9999px';
    iframe.style.bottom = '-9999px';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(printHtml);
    doc.close();

    closeBulkBarcodeModal();
};

// =========================================================================
// 🌟 8. إدارة وحفظ قوالب تصميم الباركود 🌟
// =========================================================================

// القوالب الافتراضية للسيستم
const DEFAULT_BARCODE_TEMPLATES = {
    "default_4_5": {
        name: "قالب افتراضي 4×5 سم 🏷️",
        paperW: 4,
        paperH: 5,
        fontName: 11,
        fontDetails: 9,
        fontPrice: 12,
        showName: true,
        showCode: true,
        showSizes: true,
        showPrice: true,
        codeType: "barcode",
        valueSource: "factory",
        qtyMode: "fixed",
        fixedQty: 1,
        colorDist: "all_together",
        showColors: true,
        skipZeroStockColors: true
    },
    "small_3_4": {
        name: "قالب صغير 3×4 سم 🏷️",
        paperW: 3,
        paperH: 4,
        fontName: 9,
        fontDetails: 7,
        fontPrice: 10,
        showName: true,
        showCode: true,
        showSizes: false,
        showPrice: true,
        codeType: "barcode",
        valueSource: "factory",
        qtyMode: "fixed",
        fixedQty: 1,
        colorDist: "all_together",
        showColors: true,
        skipZeroStockColors: true
    },
    "qr_standard_5_5": {
        name: "قالب QR مربع 5×5 سم 🔳",
        paperW: 5,
        paperH: 5,
        fontName: 12,
        fontDetails: 9,
        fontPrice: 13,
        showName: true,
        showCode: true,
        showSizes: true,
        showPrice: true,
        codeType: "qrcode",
        valueSource: "system",
        qtyMode: "fixed",
        fixedQty: 1,
        colorDist: "all_together",
        showColors: true,
        skipZeroStockColors: true
    }
};

window.initBarcodeTemplates = () => {
    let saved = {};
    try {
        const localData = localStorage.getItem('devo_barcode_templates');
        if (localData) {
            saved = JSON.parse(localData);
        } else {
            // Save defaults first time
            localStorage.setItem('devo_barcode_templates', JSON.stringify(DEFAULT_BARCODE_TEMPLATES));
            saved = DEFAULT_BARCODE_TEMPLATES;
        }
    } catch (e) {
        console.error("Failed to parse templates from localstorage", e);
        saved = DEFAULT_BARCODE_TEMPLATES;
    }

    const selectEl = document.getElementById('bulk-barcode-template-select');
    if (!selectEl) return;

    // Reset select except first custom option
    selectEl.innerHTML = '<option value="">-- إعدادات يدوية (مخصصة) --</option>';

    Object.keys(saved).forEach(key => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = saved[key].name;
        selectEl.appendChild(opt);
    });

    // Hide trash button by default
    const trashBtn = document.getElementById('btn-delete-barcode-template');
    if (trashBtn) trashBtn.classList.add('hidden');
};

window.loadBarcodeTemplate = () => {
    const selectEl = document.getElementById('bulk-barcode-template-select');
    const selectedKey = selectEl.value;

    const trashBtn = document.getElementById('btn-delete-barcode-template');
    if (trashBtn) {
        if (selectedKey && !selectedKey.startsWith('default_') && !selectedKey.startsWith('small_') && !selectedKey.startsWith('qr_standard_')) {
            trashBtn.classList.remove('hidden');
        } else {
            trashBtn.classList.add('hidden');
        }
    }

    if (!selectedKey) return; // Custom mode

    let templates = {};
    try {
        templates = JSON.parse(localStorage.getItem('devo_barcode_templates')) || DEFAULT_BARCODE_TEMPLATES;
    } catch(e) {
        templates = DEFAULT_BARCODE_TEMPLATES;
    }

    const template = templates[selectedKey];
    if (!template) return;

    // Set values to inputs
    document.getElementById('bulk-barcode-type').value = template.codeType || 'barcode';
    document.getElementById('bulk-barcode-value-source').value = template.valueSource || 'factory';
    document.getElementById('bulk-barcode-paper-w').value = template.paperW || 4;
    document.getElementById('bulk-barcode-paper-h').value = template.paperH || 5;
    document.getElementById('bulk-barcode-font-size-name').value = template.fontName || 11;
    document.getElementById('bulk-barcode-font-size-details').value = template.fontDetails || 9;
    document.getElementById('bulk-barcode-font-size-price').value = template.fontPrice || 12;
    document.getElementById('bulk-barcode-show-name').checked = template.showName !== false;
    document.getElementById('bulk-barcode-show-code').checked = template.showCode !== false;
    document.getElementById('bulk-barcode-show-sizes').checked = template.showSizes !== false;
    document.getElementById('bulk-barcode-show-price').checked = template.showPrice !== false;
    document.getElementById('bulk-barcode-qty-mode').value = template.qtyMode || 'fixed';
    document.getElementById('bulk-barcode-fixed-qty').value = template.fixedQty || 1;
    document.getElementById('bulk-barcode-color-dist').value = template.colorDist || 'all_together';
    document.getElementById('bulk-barcode-show-colors').checked = template.showColors !== false;
    document.getElementById('bulk-barcode-skip-zero-stock-colors').checked = template.skipZeroStockColors !== false;

    // Toggle qty input state
    window.toggleBarcodeQtyInput();

    // Refresh live preview
    window.updateBarcodePreview();
};

window.saveBarcodeTemplate = () => {
    const nameInput = document.getElementById('bulk-barcode-template-name');
    const templateName = nameInput.value.trim();

    if (!templateName) {
        return showToast('الرجاء إدخال اسم للقالب أولاً', 'warning');
    }

    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem('devo_barcode_templates')) || {};
    } catch(e) {
        saved = {};
    }

    // Generate unique key
    const key = 'custom_' + Date.now();

    saved[key] = {
        name: templateName,
        codeType: document.getElementById('bulk-barcode-type').value,
        valueSource: document.getElementById('bulk-barcode-value-source').value,
        paperW: parseFloat(document.getElementById('bulk-barcode-paper-w').value) || 4,
        paperH: parseFloat(document.getElementById('bulk-barcode-paper-h').value) || 5,
        fontName: parseInt(document.getElementById('bulk-barcode-font-size-name').value, 10) || 11,
        fontDetails: parseInt(document.getElementById('bulk-barcode-font-size-details').value, 10) || 9,
        fontPrice: parseInt(document.getElementById('bulk-barcode-font-size-price').value, 10) || 12,
        showName: document.getElementById('bulk-barcode-show-name').checked,
        showCode: document.getElementById('bulk-barcode-show-code').checked,
        showSizes: document.getElementById('bulk-barcode-show-sizes').checked,
        showPrice: document.getElementById('bulk-barcode-show-price').checked,
        qtyMode: document.getElementById('bulk-barcode-qty-mode').value,
        fixedQty: parseInt(document.getElementById('bulk-barcode-fixed-qty').value, 10) || 1,
        colorDist: document.getElementById('bulk-barcode-color-dist').value,
        showColors: document.getElementById('bulk-barcode-show-colors').checked,
        skipZeroStockColors: document.getElementById('bulk-barcode-skip-zero-stock-colors').checked
    };

    localStorage.setItem('devo_barcode_templates', JSON.stringify(saved));
    nameInput.value = ''; // clear input

    // Reinitialize select dropdown
    window.initBarcodeTemplates();

    // Select the newly created template
    const selectEl = document.getElementById('bulk-barcode-template-select');
    if (selectEl) {
        selectEl.value = key;
        window.loadBarcodeTemplate();
    }

    showToast(`تم حفظ قالب الطباعة "${templateName}" بنجاح`, 'success');
};

window.deleteBarcodeTemplate = () => {
    const selectEl = document.getElementById('bulk-barcode-template-select');
    const selectedKey = selectEl.value;

    if (!selectedKey) return;
    if (selectedKey.startsWith('default_') || selectedKey.startsWith('small_') || selectedKey.startsWith('qr_standard_')) {
        return showToast('لا يمكن حذف القوالب الافتراضية الخاصة بالنظام', 'error');
    }

    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem('devo_barcode_templates')) || {};
    } catch(e) {
        saved = {};
    }

    const templateName = saved[selectedKey]?.name || '';
    delete saved[selectedKey];

    localStorage.setItem('devo_barcode_templates', JSON.stringify(saved));

    // Reset dropdown and select custom
    window.initBarcodeTemplates();
    selectEl.value = '';
    window.loadBarcodeTemplate();

    showToast(`تم حذف قالب "${templateName}" بنجاح`, 'success');
};

// =========================================================================
// 🌟 STANDALONE BARCODE & QR GENERATOR (مولّد الباركود والـ QR المستقل) 🌟
// =========================================================================

let standaloneSelectedModel = null;
let standaloneCodeSourceMode = 'factory'; // 'factory', 'system', 'url', 'custom'
let logoImgCache = null;

// Sub-tab switching between Standalone Generator & Bulk Label Printer
window.switchBarcodeSubTab = (tabName) => {
    const standaloneTab = document.getElementById('barcode-subtab-standalone');
    const bulkTab = document.getElementById('barcode-subtab-bulk');
    const btnStandalone = document.getElementById('tab-btn-standalone-generator');
    const btnBulk = document.getElementById('tab-btn-bulk-printer');

    if (!standaloneTab || !bulkTab) return;

    if (tabName === 'standalone') {
        standaloneTab.classList.remove('hidden');
        bulkTab.classList.add('hidden');

        if (btnStandalone) btnStandalone.className = "flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 bg-devo-orange text-white shadow-sm cursor-pointer";
        if (btnBulk) btnBulk.className = "flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 text-devo-muted hover:text-white hover:bg-devo-black/50 cursor-pointer";
        
        // Initial render on tab open
        window.renderStandaloneBarcode();
    } else {
        bulkTab.classList.remove('hidden');
        standaloneTab.classList.add('hidden');

        if (btnBulk) btnBulk.className = "flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 bg-devo-orange text-white shadow-sm cursor-pointer";
        if (btnStandalone) btnStandalone.className = "flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition-all flex items-center justify-center gap-2 text-devo-muted hover:text-white hover:bg-devo-black/50 cursor-pointer";
    }
};

// Initialize Standalone Generator Autocomplete & Listeners
function initStandaloneBarcodeGenerator() {
    const searchInput = document.getElementById('single-barcode-model-search');
    const resultsContainer = document.getElementById('single-barcode-search-results');

    if (searchInput && resultsContainer) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.trim().toLowerCase();
            if (!query) {
                resultsContainer.innerHTML = '';
                resultsContainer.classList.add('hidden');
                return;
            }

            const matches = barcodeAllModels.filter(m => {
                const name = (m.name || '').toLowerCase();
                const factory = (m.factory_code || '').toString().toLowerCase();
                const system = (m.system_code || '').toString().toLowerCase();
                return name.includes(query) || factory.includes(query) || system.includes(query);
            }).slice(0, 15);

            if (matches.length === 0) {
                resultsContainer.innerHTML = `<div class="p-3 text-xs text-devo-muted text-center">لا توجد موديلات مطابقة لـ "${e.target.value}"</div>`;
            } else {
                resultsContainer.innerHTML = matches.map(m => `
                    <div onclick="selectStandaloneModel('${m.id}')" class="p-2.5 hover:bg-devo-gray/70 cursor-pointer transition-colors flex items-center justify-between gap-3 text-right">
                        <div class="truncate">
                            <div class="text-white text-xs font-bold truncate">${m.name}</div>
                            <div class="text-[10px] text-devo-muted font-mono mt-0.5">
                                مصنع: <span class="text-devo-orange">${m.factory_code || 'بدون'}</span> | سيستم: <span>${m.system_code || 'بدون'}</span>
                            </div>
                        </div>
                        <span class="text-devo-success text-xs font-bold shrink-0">${m.price || 0} ج.م</span>
                    </div>
                `).join('');
            }
            resultsContainer.classList.remove('hidden');
        });

        // Close search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
                resultsContainer.classList.add('hidden');
            }
        });
    }
}

// Select a model from autocomplete
window.selectStandaloneModel = (modelId) => {
    const model = barcodeAllModels.find(m => m.id === modelId);
    const resultsContainer = document.getElementById('single-barcode-search-results');
    const searchInput = document.getElementById('single-barcode-model-search');
    const badge = document.getElementById('single-barcode-selected-model-badge');

    if (resultsContainer) resultsContainer.classList.add('hidden');

    if (model) {
        standaloneSelectedModel = model;
        if (searchInput) searchInput.value = model.name;

        // Update badge fields
        const nameEl = document.getElementById('single-selected-model-name');
        const factoryEl = document.getElementById('single-selected-factory-code');
        const systemEl = document.getElementById('single-selected-system-code');
        const priceEl = document.getElementById('single-selected-price');

        if (nameEl) nameEl.textContent = model.name;
        if (factoryEl) factoryEl.textContent = model.factory_code || '-';
        if (systemEl) systemEl.textContent = model.system_code || '-';
        if (priceEl) priceEl.textContent = `${model.price || 0} ج.م`;
        if (badge) badge.classList.remove('hidden');

        // Apply source mode to set input value
        window.updateStandaloneSourceMode(standaloneCodeSourceMode);
    }
};

window.clearStandaloneModelSelection = () => {
    standaloneSelectedModel = null;
    const searchInput = document.getElementById('single-barcode-model-search');
    const badge = document.getElementById('single-barcode-selected-model-badge');
    const valInput = document.getElementById('single-barcode-input-value');

    if (searchInput) searchInput.value = '';
    if (badge) badge.classList.add('hidden');
    if (valInput && !valInput.value) valInput.value = 'SAMPLE-101';

    window.renderStandaloneBarcode();
};

window.updateStandaloneSourceMode = (mode) => {
    standaloneCodeSourceMode = mode;
    const inputVal = document.getElementById('single-barcode-input-value');
    if (!inputVal) return;

    if (standaloneSelectedModel) {
        const facRaw = (standaloneSelectedModel.factory_code || '').toString().trim();
        const sysRaw = (standaloneSelectedModel.system_code || '').toString().trim();
        const idRaw = (standaloneSelectedModel.id || '').toString().trim();

        if (mode === 'factory') {
            const raw = facRaw || sysRaw || idRaw;
            inputVal.value = raw.startsWith('FAC-') ? raw : `FAC-${raw.replace(/^SYS-/, '')}`;
        } else if (mode === 'system') {
            const raw = sysRaw || facRaw || idRaw;
            inputVal.value = raw.startsWith('SYS-') ? raw : `SYS-${raw.replace(/^FAC-/, '')}`;
        } else if (mode === 'url') {
            if (sysRaw) {
                const cleanSys = sysRaw.replace(/^SYS-/, '');
                inputVal.value = `${window.location.origin}/?system=${encodeURIComponent(cleanSys)}`;
            } else if (facRaw) {
                const cleanFac = facRaw.replace(/^FAC-/, '');
                inputVal.value = `${window.location.origin}/?factory=${encodeURIComponent(cleanFac)}`;
            } else {
                inputVal.value = `${window.location.origin}/?code=${encodeURIComponent(idRaw)}`;
            }
        }
    } else {
        const currentCode = inputVal.value.trim();
        if (mode === 'factory') {
            if (currentCode.startsWith('SYS-')) {
                inputVal.value = `FAC-${currentCode.substring(4)}`;
            } else if (!currentCode.startsWith('FAC-') && currentCode && !currentCode.startsWith('http')) {
                inputVal.value = `FAC-${currentCode}`;
            }
        } else if (mode === 'system') {
            if (currentCode.startsWith('FAC-')) {
                inputVal.value = `SYS-${currentCode.substring(4)}`;
            } else if (!currentCode.startsWith('SYS-') && currentCode && !currentCode.startsWith('http')) {
                inputVal.value = `SYS-${currentCode}`;
            }
        } else if (mode === 'url') {
            if (!currentCode.startsWith('http')) {
                if (currentCode.startsWith('SYS-')) {
                    inputVal.value = `${window.location.origin}/?system=${encodeURIComponent(currentCode.substring(4))}`;
                } else if (currentCode.startsWith('FAC-')) {
                    inputVal.value = `${window.location.origin}/?factory=${encodeURIComponent(currentCode.substring(4))}`;
                } else {
                    inputVal.value = `${window.location.origin}/?code=${encodeURIComponent(currentCode || '101')}`;
                }
            }
        }
    }

    window.renderStandaloneBarcode();
};

window.generateRandomStandaloneCode = () => {
    const inputVal = document.getElementById('single-barcode-input-value');
    if (!inputVal) return;

    const randomNum = Math.floor(1000 + Math.random() * 9000);
    if (standaloneCodeSourceMode === 'system') {
        inputVal.value = `SYS-${randomNum}`;
    } else if (standaloneCodeSourceMode === 'url') {
        inputVal.value = `${window.location.origin}/?code=${randomNum}`;
    } else {
        inputVal.value = `${randomNum}`;
    }

    window.renderStandaloneBarcode();
};

// Render Barcode / QR Code on Canvas
window.renderStandaloneBarcode = async () => {
    await loadPrintingLibraries();

    const inputValEl = document.getElementById('single-barcode-input-value');
    const canvas = document.getElementById('single-barcode-canvas');
    if (!inputValEl || !canvas) return;

    const codeVal = inputValEl.value.trim() || 'SAMPLE-101';
    
    // Length hint
    const lengthHint = document.getElementById('single-code-length-hint');
    if (lengthHint) lengthHint.textContent = `${codeVal.length} حرف`;

    // Options
    const codeType = document.querySelector('input[name="single-code-type"]:checked')?.value || 'qrcode';
    const scaleFactor = parseInt(document.getElementById('single-barcode-scale')?.value || '8', 10);
    const isTransparent = document.getElementById('single-barcode-transparent')?.checked ?? true;
    const centerLogo = document.getElementById('single-barcode-center-logo')?.checked ?? true;
    const captionStyle = document.getElementById('single-barcode-caption-style')?.value || 'code_only';
    const codeColor = document.getElementById('single-barcode-color')?.value || '#FFFFFF';
    const bgColorVal = document.getElementById('single-barcode-bg-color')?.value || '#FFFFFF';

    // Show/hide background color picker
    const bgWrapper = document.getElementById('single-barcode-bg-color-wrapper');
    if (bgWrapper) {
        if (isTransparent) bgWrapper.classList.add('hidden');
        else bgWrapper.classList.remove('hidden');
    }

    // Ensure valid contrast hex colors for QR Code library
    let qrDarkColor = (codeColor && codeColor.startsWith('#') && codeColor.length >= 4) ? codeColor : '#FFFFFF';
    let qrLightColor = isTransparent ? '#00000000' : ((bgColorVal && bgColorVal.startsWith('#')) ? bgColorVal : '#000000');

    // Force contrast if colors match
    if (qrDarkColor.toLowerCase() === qrLightColor.toLowerCase()) {
        qrDarkColor = '#FFFFFF';
        qrLightColor = isTransparent ? '#00000000' : '#000000';
    }

    const finalBgColor = isTransparent ? 'rgba(0,0,0,0)' : bgColorVal;
    const ctx = canvas.getContext('2d');

    if (codeType === 'qrcode') {
        const qrBaseSize = 280 * scaleFactor;
        let extraHeight = 0;
        if (captionStyle === 'with_code_text') extraHeight = 45 * scaleFactor;
        else if (captionStyle === 'full_card') extraHeight = 85 * scaleFactor;

        canvas.width = qrBaseSize;
        canvas.height = qrBaseSize + extraHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!isTransparent) {
            ctx.fillStyle = finalBgColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Offscreen canvas for QR rendering
        const offCanvas = document.createElement('canvas');
        try {
            // Calculate module scale so QR code expands to fill the entire qrBaseSize!
            const approxModules = 33; // Standard Level H module count
            const qrModuleScale = Math.max(4, Math.floor((qrBaseSize * 0.88) / approxModules));

            await QRCode.toCanvas(offCanvas, codeVal, {
                scale: qrModuleScale,
                margin: 2,
                color: {
                    dark: qrDarkColor,
                    light: qrLightColor
                },
                errorCorrectionLevel: 'H'
            });

            // Draw QR code stretched to fill qrBaseSize
            ctx.drawImage(offCanvas, 0, 0, qrBaseSize, qrBaseSize);

            // Draw DEVO logo in center if enabled (16% of QR size so corner finder patterns are unobstructed)
            if (centerLogo) {
                await drawCenterLogoOnCanvas(ctx, qrBaseSize / 2, qrBaseSize / 2, qrBaseSize * 0.16, isTransparent ? '#FFFFFF' : finalBgColor, qrDarkColor);
            }

            // Draw Caption Text underneath
            if (captionStyle !== 'code_only') {
                drawBarcodeCaptionText(ctx, canvas.width, qrBaseSize + (15 * scaleFactor), scaleFactor, captionStyle, codeVal, qrDarkColor);
            }

        } catch (e) {
            console.error("QRCode canvas generation failed:", e);
        }

    } else {
        // 1D Barcode (CODE128 with optimal bar ratios & quiet margins)
        const barWidth = 320 * scaleFactor;
        let extraHeight = 0;
        if (captionStyle === 'with_code_text') extraHeight = 45 * scaleFactor;
        else if (captionStyle === 'full_card') extraHeight = 85 * scaleFactor;

        const offCanvas = document.createElement('canvas');
        try {
            JsBarcode(offCanvas, codeVal, {
                format: "CODE128",
                width: Math.max(2, Math.round(scaleFactor * 2.5)),
                height: 120 * scaleFactor,
                displayValue: false,
                lineColor: qrDarkColor,
                background: isTransparent ? undefined : (bgColorVal || '#FFFFFF'),
                margin: 25 * scaleFactor
            });

            canvas.width = Math.max(offCanvas.width, barWidth);
            canvas.height = offCanvas.height + extraHeight;

            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (!isTransparent) {
                ctx.fillStyle = finalBgColor;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }

            const dx = (canvas.width - offCanvas.width) / 2;
            ctx.drawImage(offCanvas, dx, 0);

            if (captionStyle !== 'code_only') {
                drawBarcodeCaptionText(ctx, canvas.width, offCanvas.height + (10 * scaleFactor), scaleFactor, captionStyle, codeVal, qrDarkColor);
            }

        } catch (e) {
            console.error("JsBarcode canvas generation failed:", e);
        }
    }

    // Update Resolution Badge
    const resBadge = document.getElementById('single-barcode-resolution-badge');
    if (resBadge) resBadge.textContent = `${canvas.width} × ${canvas.height} px`;

    // Scanner Compatibility Check
    updateScannerCompatibilityStatus(codeVal);
};

// Helper: Draw Center Logo in QR Code
async function drawCenterLogoOnCanvas(ctx, cx, cy, logoSize, bgBoxColor, borderColor) {
    if (!logoImgCache) {
        logoImgCache = new Image();
        logoImgCache.src = './src/assets/icons/dv.png';
        await new Promise((resolve) => {
            logoImgCache.onload = resolve;
            logoImgCache.onerror = resolve;
        });
    }

    if (!logoImgCache.complete || !logoImgCache.naturalWidth) return;

    ctx.save();
    
    // Draw rounded background square behind logo
    const boxSize = logoSize * 1.15;
    const halfBox = boxSize / 2;
    const rx = cx - halfBox;
    const ry = cy - halfBox;
    const radius = boxSize * 0.2;

    ctx.beginPath();
    ctx.moveTo(rx + radius, ry);
    ctx.arcTo(rx + boxSize, ry, rx + boxSize, ry + boxSize, radius);
    ctx.arcTo(rx + boxSize, ry + boxSize, rx, ry + boxSize, radius);
    ctx.arcTo(rx, ry + boxSize, rx, ry, radius);
    ctx.arcTo(rx, ry, rx + boxSize, ry, radius);
    ctx.closePath();

    ctx.fillStyle = (bgBoxColor === 'rgba(0,0,0,0)' || bgBoxColor === 'transparent') ? '#FFFFFF' : bgBoxColor;
    ctx.fill();

    ctx.lineWidth = Math.max(2, boxSize * 0.05);
    ctx.strokeStyle = borderColor;
    ctx.stroke();

    // Draw logo inside
    const halfLogo = logoSize / 2;
    ctx.drawImage(logoImgCache, cx - halfLogo, cy - halfLogo, logoSize, logoSize);
    ctx.restore();
}

// Helper: Draw Text Caption under Barcode/QR (Supports Custom Unregistered Models)
function drawBarcodeCaptionText(ctx, canvasWidth, startY, scaleFactor, style, codeVal, textColor) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = textColor;

    const customNameInput = document.getElementById('single-custom-model-name');
    const customPriceInput = document.getElementById('single-custom-model-price');

    const customName = customNameInput ? customNameInput.value.trim() : '';
    const customPrice = customPriceInput ? customPriceInput.value.trim() : '';

    if (style === 'with_code_text') {
        ctx.font = `bold ${16 * scaleFactor}px Tajawal, monospace, sans-serif`;
        ctx.fillText(`كود: ${codeVal}`, canvasWidth / 2, startY);
    } else if (style === 'full_card') {
        let modelName = 'موديل مخصص';
        let priceStr = '';

        if (standaloneSelectedModel) {
            modelName = standaloneSelectedModel.name;
            priceStr = standaloneSelectedModel.price ? `${standaloneSelectedModel.price} ج.م` : '';
        } else {
            if (customName) modelName = customName;
            if (customPrice) priceStr = `${customPrice} ج.م`;
        }

        ctx.font = `bold ${18 * scaleFactor}px Tajawal, sans-serif`;
        ctx.fillText(modelName, canvasWidth / 2, startY);

        ctx.font = `bold ${14 * scaleFactor}px Tajawal, monospace, sans-serif`;
        const detailsStr = priceStr ? `كود: ${codeVal}  |  السعر: ${priceStr}` : `كود: ${codeVal}`;
        ctx.fillText(detailsStr, canvasWidth / 2, startY + (24 * scaleFactor));
    }

    ctx.restore();
}

// Helper: Update Scanner Compatibility Badge
function updateScannerCompatibilityStatus(codeVal) {
    const badge = document.getElementById('single-barcode-compat-badge');
    if (!badge) return;

    let cleanCode = codeVal.trim().toLowerCase();
    if (cleanCode.includes('?code=') || cleanCode.includes('&code=')) {
        const match = cleanCode.match(/[?&]code=([^&]+)/);
        if (match && match[1]) cleanCode = decodeURIComponent(match[1]).toLowerCase();
    }

    const matchedModel = barcodeAllModels.find(m => 
        (m.factory_code && m.factory_code.toString().toLowerCase() === cleanCode) ||
        (m.system_code && m.system_code.toString().toLowerCase() === cleanCode) ||
        (m.id && m.id.toString().toLowerCase() === cleanCode)
    );

    if (matchedModel) {
        badge.className = "w-full bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 p-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2";
        badge.innerHTML = `<i class="ph ph-check-circle text-base"></i> <span>متوافق 100% مع قارئ الموقع: سيفتح الموديل "${matchedModel.name}" فوراً عند الكسح</span>`;
    } else {
        badge.className = "w-full bg-devo-black border border-devo-gray text-devo-muted p-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2";
        badge.innerHTML = `<i class="ph ph-info text-base text-devo-orange"></i> <span>رمز مخصص نشط (جاهز للكسح ونسخ الصورة لاستخدامها بأي تصميم)</span>`;
    }
}

// Action: Copy High-Res Image to Clipboard
window.copySingleBarcodeImage = async () => {
    const canvas = document.getElementById('single-barcode-canvas');
    if (!canvas) return;

    try {
        canvas.toBlob(async (blob) => {
            if (!blob) {
                showToast("تعذر استخراج صورة الباركود", "error");
                return;
            }
            try {
                const item = new ClipboardItem({ 'image/png': blob });
                await navigator.clipboard.write([item]);
                showToast("تم نسخ صورة الباركود بنجاح! يمكنك الآن لصقها في برنامج تعديل الصور (Ctrl+V) 📋", "success");
            } catch (err) {
                console.error("Direct clipboard write failed, falling back to download:", err);
                window.downloadSingleBarcodeImage('png');
                showToast("متصفحك يمنع النسخ المباشر للصور. تم تنزيل الصورة تلقائياً لك.", "info");
            }
        }, 'image/png');
    } catch (e) {
        console.error("Blob copy failed:", e);
        showToast("حدث خطأ أثناء نسخ الصورة", "error");
    }
};

// Action: Download High-Res Image (PNG / SVG)
window.downloadSingleBarcodeImage = (format) => {
    const canvas = document.getElementById('single-barcode-canvas');
    const inputValEl = document.getElementById('single-barcode-input-value');
    if (!canvas) return;

    const rawCode = inputValEl ? inputValEl.value.trim() : 'barcode';
    const cleanFileName = rawCode.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'devo_barcode';

    if (format === 'png') {
        const link = document.createElement('a');
        link.download = `${cleanFileName}_hd.png`;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        link.remove();
        showToast("تم تنزيل صورة الباركود عالية الدقة بنجاح 📥", "success");
    } else if (format === 'svg') {
        // Generate Vector SVG Markup
        const codeType = document.querySelector('input[name="single-code-type"]:checked')?.value || 'qrcode';
        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}"><image href="${canvas.toDataURL('image/png')}" width="${canvas.width}" height="${canvas.height}"/></svg>`;

        const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `${cleanFileName}.svg`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast("تم تنزيل ملف SVG المتجه بنجاح 📐", "success");
    }
};

// Action: Open Standalone Barcode Generator for a specific Model (from Models List)
window.openStandaloneBarcodeForModel = async (modelId) => {
    // 1. If not initialized, fetch models first
    if (!isBarcodeInitialized) {
        await fetchBarcodeModels();
    }

    // Switch view to print-barcodes section if available
    const navLink = document.querySelector('a[data-target="view-print-barcodes"]');
    if (navLink) {
        navLink.click();
    }

    // Switch to standalone tab
    window.switchBarcodeSubTab('standalone');

    // Select the model
    window.selectStandaloneModel(modelId);

    showToast("تم تجهيز الباركود والكيو ار كود للموديل المحدد بنجاح 🔳", "success");
};

window.closeStandaloneBarcodeModal = () => {
    const modal = document.getElementById('modal-standalone-barcode');
    if (modal) {
        modal.classList.add('opacity-0');
        modal.querySelector('.transform')?.classList.add('scale-95');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    }
};
