import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';

let isInitialized = false;
let allModels = [];
let existingColors = [];
let existingCategories = [];
let existingClasses = [];
let existingSizes = [];
let excelRawData = [];

// Step state variables
let unregisteredModels = []; // Array of { systemCode, rawName, factoryCode, name, price }
let modelActions = {}; // systemCode -> 'create'|'ignore'
let unknownColorsList = []; // Array of { systemCode, colorName, modelName, factoryCode, count }
let colorMappings = {}; // systemCode -> { colorName -> { action: 'add'|'map'|'ignore', targetColorId } }
let previewData = []; // Array of model updates
let selectedImportStockModelCodes = new Set();
let filteredPreviewData = [];
let activeView = 'step-1';

export async function initImportStockView() {
    if (isInitialized) return;

    // Attach Step 1 Listeners
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }

    const btnAnalyze = document.getElementById('import-btn-analyze');
    if (btnAnalyze) {
        btnAnalyze.addEventListener('click', handleAnalyze);
    }

    // Attach Step Models (New Step) Listeners
    const btnBackToStep1FromModels = document.getElementById('import-btn-back-to-step1-from-models');
    if (btnBackToStep1FromModels) {
        btnBackToStep1FromModels.addEventListener('click', () => switchStep('step-3'));
    }

    const btnApplyModels = document.getElementById('import-btn-apply-models');
    if (btnApplyModels) {
        btnApplyModels.addEventListener('click', handleApplyModels);
    }

    // Attach Step Models Search Listeners
    const searchSystem = document.getElementById('model-search-system');
    const searchFactory = document.getElementById('model-search-factory');
    const searchName = document.getElementById('model-search-name');

    if (searchSystem) searchSystem.addEventListener('input', filterUnregisteredModelsTable);
    if (searchFactory) searchFactory.addEventListener('input', filterUnregisteredModelsTable);
    if (searchName) searchName.addEventListener('input', filterUnregisteredModelsTable);

    // Attach Step Models Bulk Actions
    const btnBulkCreate = document.getElementById('import-models-bulk-create');
    const btnBulkIgnore = document.getElementById('import-models-bulk-ignore');

    if (btnBulkCreate) {
        btnBulkCreate.addEventListener('click', () => handleBulkModelDecision('create'));
    }
    if (btnBulkIgnore) {
        btnBulkIgnore.addEventListener('click', () => handleBulkModelDecision('ignore'));
    }

    const modelsTbody = document.getElementById('import-models-mapping-tbody');
    if (modelsTbody) {
        modelsTbody.addEventListener('change', (e) => {
            if (e.target.classList.contains('model-mapping-select')) {
                const code = e.target.dataset.code;
                modelActions[code] = e.target.value;
            }
        });
    }

    // Attach Step 2 (Color Mapping) Listeners
    const btnBackToModels = document.getElementById('import-btn-back-to-models');
    if (btnBackToModels) {
        btnBackToModels.addEventListener('click', () => {
            if (unregisteredModels.length > 0) {
                switchStep('step-models');
            } else {
                switchStep('step-3');
            }
        });
    }

    const btnApplyColors = document.getElementById('import-btn-apply-colors');
    if (btnApplyColors) {
        btnApplyColors.addEventListener('click', handleApplyColors);
    }

    // Attach Step 3 (Preview) Listeners
    const btnBackToOptions = document.getElementById('import-btn-back-to-options');
    if (btnBackToOptions) {
        btnBackToOptions.addEventListener('click', () => {
            switchStep('step-1');
        });
    }

    const btnProceedChecks = document.getElementById('import-btn-proceed-checks');
    if (btnProceedChecks) {
        btnProceedChecks.addEventListener('click', window.handleProceedToChecks);
    }

    const btnConfirmSave = document.getElementById('import-btn-confirm-save');
    if (btnConfirmSave) {
        btnConfirmSave.addEventListener('click', handleConfirmSave);
    }

    const stockOp = document.getElementById('import-stock-filter-stock-op');
    const stockQtyContainer = document.getElementById('import-stock-filter-stock-qty-container');
    const stockQty = document.getElementById('import-stock-filter-stock-qty');
    if (stockOp) {
        stockOp.addEventListener('change', () => {
            if (stockOp.value) {
                if (stockQtyContainer) stockQtyContainer.classList.remove('hidden');
            } else {
                if (stockQtyContainer) stockQtyContainer.classList.add('hidden');
                if (stockQty) stockQty.value = '';
            }
            window.applyImportStockFilters();
        });
        if (stockQty) stockQty.addEventListener('input', handlePreviewSearch);
    }

    ['import-stock-search-name', 'import-stock-search-factory', 'import-stock-search-system', 'import-stock-factory-from', 'import-stock-factory-to', 'import-stock-filter-stock-qty', 'import-stock-price-min', 'import-stock-price-max', 'import-stock-date-from', 'import-stock-date-to'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', handlePreviewSearch);
    });

    ['import-stock-filter-category', 'import-stock-filter-class', 'import-stock-filter-status', 'import-stock-filter-stock-op', 'import-stock-filter-change'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', handlePreviewSearch);
    });

    await loadInitialData();
    isInitialized = true;
}

function handlePreviewSearch() {
    if (typeof window.applyImportStockFilters === 'function') {
        window.applyImportStockFilters();
    }
}

// 🌟 Multi-Select Label & Action Helpers 🌟
window.updateImportStockMultiSelectLabel = (key) => {
    const checkboxes = document.querySelectorAll(`input[name="import-stock-filter-${key}"]:checked`);
    const excludeCheckbox = document.getElementById(`import-stock-dropdown-${key}-exclude`);
    const labelEl = document.getElementById(`import-stock-dropdown-${key}-label`);
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
            labelEl.textContent = count <= 2 ? `استثناء: ${names.join('، ')}` : `الكل عدا ${count}`;
            labelEl.classList.add('text-devo-orange');
        } else {
            labelEl.textContent = count <= 2 ? names.join('، ') : `${count} محددة`;
            labelEl.classList.add('text-devo-orange');
        }
    }
};

window.importStockMultiSelectAction = (event, key, action) => {
    event.stopPropagation();
    const checkboxes = document.querySelectorAll(`input[name="import-stock-filter-${key}"]`);
    checkboxes.forEach(cb => {
        cb.checked = (action === 'all');
    });
    window.updateImportStockMultiSelectLabel(key);
    window.applyImportStockFilters();
};

// 🌟 1. Load active models, categories, classes, colors, sizes from Supabase 🌟
export async function loadInitialData() {
    try {
        const [catsRes, clssRes, colorsRes, sizesRes] = await Promise.all([
            supabase.from('categories').select('id, name').order('name'),
            supabase.from('classes').select('id, name').order('name'),
            supabase.from('colors').select('id, name, color_code').order('name'),
            supabase.from('sizes').select('id, name').order('name')
        ]);

        existingCategories = catsRes.data || [];
        existingClasses = clssRes.data || [];
        existingColors = colorsRes.data || [];
        existingSizes = sizesRes.data || [];

        const populateCheckbox = (containerId, data, key) => {
            const container = document.getElementById(containerId);
            if (container && data) {
                container.innerHTML = data.map(item => `
                    <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-devo-black/40 rounded cursor-pointer text-xs text-white select-none" onclick="event.stopPropagation()">
                        <input type="checkbox" value="${item.id}" name="import-stock-filter-${key}" class="accent-devo-orange w-3.5 h-3.5 rounded cursor-pointer" onchange="updateImportStockMultiSelectLabel('${key}'); applyImportStockFilters();">
                        <span class="truncate">${item.name}</span>
                    </label>
                `).join('');
            }
        };

        populateCheckbox('import-stock-dropdown-cat-options', existingCategories, 'cat');
        populateCheckbox('import-stock-dropdown-class-options', existingClasses, 'class');
        populateCheckbox('import-stock-dropdown-color-options', existingColors, 'color');
        populateCheckbox('import-stock-dropdown-size-options', existingSizes, 'size');

        const catSelect = document.getElementById('import-stock-filter-category');
        if (catSelect) {
            const cur = catSelect.value;
            catSelect.innerHTML = `<option value="">جميع التصنيفات</option>` + existingCategories.map(c => `<option value="${c.id}" ${cur === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
        }

        const classSelect = document.getElementById('import-stock-filter-class');
        if (classSelect) {
            const cur = classSelect.value;
            classSelect.innerHTML = `<option value="">جميع الفئات العمرية</option>` + existingClasses.map(c => `<option value="${c.id}" ${cur === c.id ? 'selected' : ''}>${c.name}</option>`).join('');
        }

        window.updateImportStockMultiSelectLabel('cat');
        window.updateImportStockMultiSelectLabel('class');
        window.updateImportStockMultiSelectLabel('color');
        window.updateImportStockMultiSelectLabel('size');

        // Fetch models chunked
        let allFetchedModels = [];
        let from = 0;
        const step = 999;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('models')
                .select(`
                    id, system_code, factory_code, name, price, class_id, category_id, is_active, created_at,
                    categories(id, name),
                    classes(id, name, class_sizes(size_id, sizes(id, name))),
                    model_sizes(size_id, sizes(id, name)),
                    model_inventory(color_id, available_series, colors(id, name))
                `)
                .range(from, from + step);

            if (error) throw error;

            if (data.length > 0) {
                allFetchedModels = [...allFetchedModels, ...data];
                from += step + 1;
            }
            if (data.length <= step) hasMore = false;
        }
        allModels = allFetchedModels;

    } catch (err) {
        console.error("Load Initial Data Error:", err);
        showToast('خطأ في تحميل بيانات التهيئة من السيرفر', 'error');
    }
}

// Show selected filename
function handleFileSelect(e) {
    const file = e.target.files[0];
    const fileNameEl = document.getElementById('import-file-name');
    if (fileNameEl) {
        fileNameEl.textContent = file ? file.name : 'اسحب ملف الإكسيل هنا أو اضغط للاختيار';
    }
}

// 🌟 Progress Modal functions 🌟
function showProgress(title, status) {
    const modal = document.getElementById('import-progress-modal');
    const modalContent = document.getElementById('import-progress-content');
    if (!modal || !modalContent) return;

    document.getElementById('import-progress-title').textContent = title;
    document.getElementById('import-progress-status').textContent = status;
    document.getElementById('import-progress-bar').style.width = '0%';
    document.getElementById('import-progress-percent').textContent = '0%';

    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modalContent.classList.remove('scale-95');
    });
}

function updateProgress(status, percent) {
    const statusEl = document.getElementById('import-progress-status');
    const barEl = document.getElementById('import-progress-bar');
    const percentEl = document.getElementById('import-progress-percent');

    if (statusEl) statusEl.textContent = status;
    if (barEl) barEl.style.width = `${percent}%`;
    if (percentEl) percentEl.textContent = `${percent}%`;
}

function hideProgress() {
    const modal = document.getElementById('import-progress-modal');
    const modalContent = document.getElementById('import-progress-content');
    if (!modal || !modalContent) return;

    modal.classList.add('opacity-0');
    modalContent.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

// Switch between wizard views
function switchStep(step) {
    activeView = step;
    document.getElementById('import-step-1').classList.toggle('hidden', step !== 'step-1');
    document.getElementById('import-step-models').classList.toggle('hidden', step !== 'step-models');
    document.getElementById('import-step-2').classList.toggle('hidden', step !== 'step-2');
    document.getElementById('import-step-3').classList.toggle('hidden', step !== 'step-3');

    const globalHeader = document.getElementById('import-global-header');
    if (globalHeader) {
        globalHeader.classList.toggle('hidden', step === 'step-models');
    }
}

// 🌟 2. Analyze Excel File & Go DIRECTLY to Preview Step 3 🌟
async function handleAnalyze() {
    const fileInput = document.getElementById('import-file-input');
    const file = fileInput?.files[0];
    if (!file) {
        return showToast('الرجاء اختيار ملف إكسيل أولاً', 'warning');
    }

    showProgress('تحليل ملف الجرد', 'جاري فتح وقراءة ملف Excel...');

    setTimeout(async () => {
        try {
            const rawRows = await readExcelFileRaw(file);
            if (rawRows.length < 2) {
                throw new Error('الملف فارغ أو لا يحتوي على صفوف بيانات صالحة.');
            }

            updateProgress('جاري استخلاص عناوين الأعمدة والبيانات...', 25);

            let codeIdx = 18;
            let nameIdx = 17;
            let colorIdx = 14;
            let sizeIdx = 15;
            let priceIdx = 2;
            let balanceIdx = 3;

            const headers = rawRows[1] || [];
            headers.forEach((h, idx) => {
                const hStr = String(h || '').trim();
                if (hStr === 'الكود' || hStr === 'كود') codeIdx = idx;
                else if (hStr === 'اسم الصنف' || hStr === 'الصنف') nameIdx = idx;
                else if (hStr === 'لون') colorIdx = idx;
                else if (hStr === 'مقاس') sizeIdx = idx;
            });

            const firstPrice = headers.indexOf('بيع 1');
            if (firstPrice !== -1) priceIdx = firstPrice;
            const firstUnit = headers.indexOf('وحدة');
            if (firstUnit !== -1) balanceIdx = firstUnit;

            updateProgress('جاري فحص الموديلات ومطابقتها مع السيستم...', 50);

            excelRawData = [];
            const seenCodes = new Set();
            unregisteredModels = [];
            modelActions = {};
            colorMappings = {};

            for (let i = 2; i < rawRows.length; i++) {
                const row = rawRows[i];
                if (!row || row.length === 0) continue;

                const systemCode = String(row[codeIdx] || '').trim().replace('.0', '');
                const rawName = String(row[nameIdx] || '').trim();
                const colorName = String(row[colorIdx] || '').trim();
                const price = parseFloat(row[priceIdx]) || 0;
                const balance = parseFloat(row[balanceIdx]) || 0;

                if (!systemCode || !colorName) continue;

                excelRawData.push({
                    systemCode,
                    rawName,
                    colorName,
                    price,
                    balance
                });

                // Set default create model action
                modelActions[systemCode] = 'create';

                // Detect unregistered models
                const exists = allModels.some(m => String(m.system_code) === String(systemCode));
                if (!exists && !seenCodes.has(systemCode)) {
                    seenCodes.add(systemCode);
                    const match = rawName.match(/(.+?)\s+(\d+)$/);
                    const cleanName = match ? match[1].trim() : rawName;
                    const factoryCode = match ? match[2] : '';

                    unregisteredModels.push({
                        systemCode,
                        rawName,
                        factoryCode,
                        name: cleanName,
                        price
                    });
                }

                // Set default color mapping action
                if (!colorMappings[systemCode]) colorMappings[systemCode] = {};
                const matchedColor = existingColors.find(c => c.name.trim().toLowerCase() === colorName.toLowerCase());
                if (matchedColor) {
                    colorMappings[systemCode][colorName] = { action: 'map', targetColorId: matchedColor.id };
                } else {
                    colorMappings[systemCode][colorName] = { action: 'add', targetColorId: null };
                }
            }

            if (excelRawData.length === 0) {
                throw new Error('لم يتم العثور على أي صفوف بيانات صالحة للمطابقة في الملف.');
            }

            updateProgress('جاري معالجة العرض المباشر وصياد الموديلات...', 80);

            await processAndRenderPreview();
            hideProgress();
            switchStep('step-3');

            showToast(`تم عرض تفاصيل الملف بنجاح. يمكنك اصطياد الموديلات المطلوب استيرادها ثم المتابعة للقرارات.`, 'info');

        } catch (err) {
            console.error("Analyze Excel Error:", err);
            hideProgress();
            showToast(err.message || 'حدث خطأ أثناء قراءة ملف الإكسيل', 'error');
        }
    }, 200);
}

// 🌟 3. Render Unregistered Models (Step Models) 🌟
function renderUnregisteredModelsTable() {
    const tbody = document.getElementById('import-models-mapping-tbody');
    if (!tbody) return;

    tbody.innerHTML = unregisteredModels.map(m => {
        const descText = m.factoryCode 
            ? `${m.name} <span class="bg-devo-gray text-white px-2 py-0.5 rounded text-[10px] ml-2 font-mono">مصنع: ${m.factoryCode}</span>` 
            : m.name;

        const modelColors = excelRawData.filter(r => r.systemCode === m.systemCode);
        const colorMap = {};
        modelColors.forEach(row => {
            colorMap[row.colorName] = (colorMap[row.colorName] || 0) + row.balance;
        });

        const colorsHtml = Object.entries(colorMap).map(([colorName, balance]) => `
            <span class="bg-devo-black/60 border border-devo-gray px-2 py-0.5 rounded text-[10px] text-devo-muted flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-devo-orange"></span>
                <span class="text-white font-bold">${colorName}</span>: <span class="text-devo-orange font-bold font-mono">${balance}</span> قطعة
            </span>
        `).join('');

        const actionVal = modelActions[m.systemCode] || 'create';

        return `
            <tr class="hover:bg-devo-black/50 transition-colors" data-code="${m.systemCode}" data-name="${m.name}" data-factory="${m.factoryCode}">
                <td class="p-3 font-mono text-xs text-devo-muted">${m.systemCode}</td>
                <td class="p-3">
                    <div class="font-bold text-white">${descText}</div>
                    <div class="mt-2 flex flex-wrap gap-2">${colorsHtml}</div>
                </td>
                <td class="p-3 text-center font-mono text-xs text-devo-orange">${m.price} ج.م</td>
                <td class="p-3">
                    <select data-code="${m.systemCode}" class="model-mapping-select bg-devo-black border border-devo-gray rounded px-3 py-2 text-white text-xs outline-none focus:border-devo-orange w-full">
                        <option value="create" ${actionVal === 'create' ? 'selected' : ''}>➕ إنشاء موديل جديد بالسيستم</option>
                        <option value="ignore" ${actionVal === 'ignore' ? 'selected' : ''}>🚫 تجاهل هذا الموديل بالكامل</option>
                    </select>
                </td>
            </tr>
        `;
    }).join('');

    const searchSystem = document.getElementById('model-search-system');
    const searchFactory = document.getElementById('model-search-factory');
    const searchName = document.getElementById('model-search-name');
    if (searchSystem) searchSystem.value = '';
    if (searchFactory) searchFactory.value = '';
    if (searchName) searchName.value = '';
}

// 🌟 Live search filtering for Unregistered Models Table 🌟
function filterUnregisteredModelsTable() {
    const sysVal = document.getElementById('model-search-system')?.value.toLowerCase().trim() || '';
    const facVal = document.getElementById('model-search-factory')?.value.toLowerCase().trim() || '';
    const nameVal = document.getElementById('model-search-name')?.value.toLowerCase().trim() || '';

    const trs = document.querySelectorAll('#import-models-mapping-tbody tr');
    trs.forEach(tr => {
        const code = tr.dataset.code ? tr.dataset.code.toLowerCase() : '';
        const name = tr.dataset.name ? tr.dataset.name.toLowerCase() : '';
        const factory = tr.dataset.factory ? tr.dataset.factory.toLowerCase() : '';

        const matchSys = sysVal === '' || code.includes(sysVal);
        const matchFac = facVal === '' || factory.includes(facVal);
        const matchName = nameVal === '' || name.includes(nameVal);

        tr.classList.toggle('hidden', !(matchSys && matchFac && matchName));
    });
}

// 🌟 Bulk decision helper 🌟
function handleBulkModelDecision(decision) {
    unregisteredModels.forEach(m => {
        modelActions[m.systemCode] = decision;
    });

    document.querySelectorAll('.model-mapping-select').forEach(select => {
        select.value = decision;
    });

    showToast(decision === 'create' ? 'تم تطبيق خيار الإنشاء لجميع الموديلات الجديدة' : 'تم تطبيق خيار التجاهل لجميع الموديلات الجديدة', 'success');
}

// 🌟 4. Handle Step Models Submission 🌟
async function handleApplyModels() {
    const selects = document.querySelectorAll('.model-mapping-select');
    selects.forEach(select => {
        const code = select.dataset.code;
        modelActions[code] = select.value;
    });

    await checkSelectedColorsAndProceed();
}

// 🌟 Proceed to Checks on Hunted Models Only 🌟
window.handleProceedToChecks = async () => {
    const selectedCodes = selectedImportStockModelCodes;
    if (selectedCodes.size === 0) {
        return showToast('الرجاء اصطياد/تحديد موديل واحد على الأقل للمتابعة للفحوصات', 'warning');
    }

    // 1. Check unregistered models within HUNTED models
    const selectedUnregistered = unregisteredModels.filter(m => selectedCodes.has(m.systemCode));
    if (selectedUnregistered.length > 0) {
        unregisteredModels = selectedUnregistered;
        renderUnregisteredModelsTable();
        switchStep('step-models');
        showToast(`تم اكتشاف ${selectedUnregistered.length} موديل غير مسجل للأصناف المصطادة. يرجى تحديد الإجراء لكل منها.`, 'warning');
        return;
    }

    await checkSelectedColorsAndProceed();
};

async function checkSelectedColorsAndProceed() {
    showProgress('فحص ألوان الموديلات المصطادة', 'جاري المطابقة...');

    unknownColorsList = [];

    // Build effective selected codes: registered models + new models user chose 'create' for
    const effectiveSelectedCodes = new Set(
        [...selectedImportStockModelCodes].filter(code => {
            const isRegistered = allModels.some(m => String(m.system_code) === String(code));
            if (isRegistered) return true;
            return modelActions[code] === 'create';
        })
    );

    const activeRows = excelRawData.filter(row => effectiveSelectedCodes.has(row.systemCode));

    const seenCombos = new Set();
    activeRows.forEach(row => {
        const colorName = row.colorName;
        const systemCode = row.systemCode;
        const comboKey = `${systemCode}_${colorName}`;

        if (seenCombos.has(comboKey)) return;

        const isKnown = existingColors.some(c => c.name.trim().toLowerCase() === colorName.toLowerCase());
        if (!isKnown) {
            seenCombos.add(comboKey);

            let modelName = row.rawName;
            let factoryCode = '';

            const dbModel = allModels.find(m => String(m.system_code) === String(systemCode));
            if (dbModel) {
                modelName = dbModel.name;
                factoryCode = dbModel.factory_code || '';
            } else {
                const unreg = unregisteredModels.find(m => String(m.systemCode) === String(systemCode));
                if (unreg) {
                    modelName = unreg.name;
                    factoryCode = unreg.factoryCode;
                }
            }

            const count = excelRawData.filter(r => r.systemCode === systemCode && r.colorName === colorName).length;

            unknownColorsList.push({
                systemCode,
                colorName,
                modelName,
                factoryCode,
                count
            });
        }
    });

    hideProgress();

    if (unknownColorsList.length > 0) {
        renderColorMappingTable();
        switchStep('step-2');
        showToast(`تم اكتشاف ألوان غير معرفة للأصناف المصطادة. يرجى اختيار إجراء المطابقة لكل منها.`, 'warning');
    } else {
        // Auto map matched colors
        activeRows.forEach(row => {
            if (!colorMappings[row.systemCode]) {
                colorMappings[row.systemCode] = {};
            }
            const matched = existingColors.find(c => c.name.trim().toLowerCase() === row.colorName.toLowerCase());
            if (matched) {
                colorMappings[row.systemCode][row.colorName] = { action: 'map', targetColorId: matched.id };
            }
        });

        await handleConfirmSave();
    }
}

// 🌟 6. Render Color Mapping (Step 2) 🌟
function renderColorMappingTable() {
    const tbody = document.getElementById('import-color-mapping-tbody');
    if (!tbody) return;

    tbody.innerHTML = unknownColorsList.map(item => {
        const descText = item.factoryCode
            ? `${item.modelName} <span class="bg-devo-gray text-white px-2 py-0.5 rounded text-[10px] ml-2 font-mono">مصنع: ${item.factoryCode}</span>`
            : item.modelName;

        return `
            <tr class="hover:bg-devo-black/50 transition-colors">
                <td class="p-3 font-bold text-white">${descText}</td>
                <td class="p-3 text-devo-orange font-bold text-xs">${item.colorName}</td>
                <td class="p-3 text-center text-devo-muted text-xs">${item.count} صفوف بالملف</td>
                <td class="p-3">
                    <select data-code="${item.systemCode}" data-color="${item.colorName}" class="color-mapping-select bg-devo-black border border-devo-gray rounded px-3 py-2 text-white text-xs outline-none focus:border-devo-orange w-full">
                        <option value="add" selected>➕ إضافة كلون جديد بالسيستم</option>
                        <option value="ignore">🚫 تجاهل هذا اللون في هذا الموديل</option>
                        <optgroup label="ربط بلون موجود بالسيستم:">
                            ${existingColors.map(c => `<option value="map_${c.id}">${c.name}</option>`).join('')}
                        </optgroup>
                    </select>
                </td>
            </tr>
        `;
    }).join('');
}

// 🌟 7. Handle Color Mapping Confirmation 🌟
async function handleApplyColors() {
    const selects = document.querySelectorAll('.color-mapping-select');
    selects.forEach(select => {
        const code = select.dataset.code;
        const colorName = select.dataset.color;
        const val = select.value;

        if (!colorMappings[code]) colorMappings[code] = {};

        if (val === 'add') {
            colorMappings[code][colorName] = { action: 'add', targetColorId: null };
        } else if (val === 'ignore') {
            colorMappings[code][colorName] = { action: 'ignore', targetColorId: null };
        } else if (val.startsWith('map_')) {
            const colorId = val.substring(4);
            colorMappings[code][colorName] = { action: 'map', targetColorId: colorId };
        }
    });

    await handleConfirmSave();
}

// 🌟 8. Process Grouped Data and Render Preview (Step 3) 🌟
async function processAndRenderPreview() {
    const qtyOption = document.querySelector('input[name="import-qty-option"]:checked')?.value || 'as_is';
    const isUpdatePriceEnabled = document.getElementById('import-update-price')?.checked || false;

    // Group excel raw data by systemCode, then by colorName
    const grouped = {};
    excelRawData.forEach(row => {
        const code = row.systemCode;
        if (modelActions[code] === 'ignore') return;

        const mappingsForCode = colorMappings[code] || {};
        const mapping = mappingsForCode[row.colorName];
        if (mapping && mapping.action === 'ignore') return;

        if (!grouped[code]) {
            grouped[code] = {
                code,
                price: row.price,
                colors: {}
            };
        }
        
        grouped[code].colors[row.colorName] = (grouped[code].colors[row.colorName] || 0) + row.balance;
    });

    previewData = [];
    let updatedModelsCount = 0;
    let priceChangesCount = 0;
    let newColorsCount = 0;
    let qtyUpdatesCount = 0;
    let movementsCount = 0;

    // Track unique color names to add globally
    const uniqueColorsToAdd = new Set();
    Object.values(colorMappings).forEach(modelMaps => {
        Object.entries(modelMaps).forEach(([colorName, mapVal]) => {
            if (mapVal.action === 'add') {
                uniqueColorsToAdd.add(colorName.trim());
            }
        });
    });
    newColorsCount = uniqueColorsToAdd.size;

    for (const [code, item] of Object.entries(grouped)) {
        let dbModel = allModels.find(m => String(m.system_code) === String(code));
        let modelId = dbModel?.id || null;
        let modelName = '';
        let factoryCode = '';
        let oldPrice = 0;
        let classId = null;
        let classSizes = [];
        let modelSizes = [];
        let modelInventory = [];

        if (dbModel) {
            modelName = dbModel.name;
            factoryCode = dbModel.factory_code || '';
            oldPrice = dbModel.price;
            classId = dbModel.class_id;
            classSizes = dbModel.classes?.class_sizes || [];
            modelSizes = dbModel.model_sizes || [];
            modelInventory = dbModel.model_inventory || [];
        } else {
            const newM = unregisteredModels.find(m => String(m.systemCode) === String(code));
            if (!newM) continue;
            modelName = newM.name;
            factoryCode = newM.factoryCode;
            oldPrice = 0;
        }

        // Calculate series size
        let S = classSizes.length > 0 ? classSizes.length : (modelSizes.length || 1);
        if (!classId) S = 1; // custom

        let modelHasChanges = !dbModel;
        let modelPriceChanged = false;

        const newPrice = isUpdatePriceEnabled ? item.price : (dbModel ? oldPrice : item.price);
        if (!dbModel || (isUpdatePriceEnabled && oldPrice !== newPrice)) {
            modelHasChanges = true;
            modelPriceChanged = dbModel ? true : false;
            if (dbModel && oldPrice !== newPrice) priceChangesCount++;
        }

        const colorEntries = [];

        for (const [colorName, rawQty] of Object.entries(item.colors)) {
            const mappingsForCode = colorMappings[code] || {};
            const mapping = mappingsForCode[colorName];
            let targetColorId = mapping?.targetColorId;
            let displayColorName = colorName;

            if (mapping?.action === 'add') {
                displayColorName = `${colorName} (جديد)`;
            } else if (mapping?.action === 'map') {
                const matched = existingColors.find(c => c.id === targetColorId);
                if (matched) displayColorName = matched.name;
            }

            // 🌟 Correct Stock Calculations: 🌟
            // Excel quantity is pieces, so we convert it to series: seriesQty = pieces / S
            let calculatedQty = rawQty / S;
            if (S > 1) {
                if (qtyOption === 'round_down') {
                    calculatedQty = Math.floor(calculatedQty);
                } else if (qtyOption === 'round_up') {
                    calculatedQty = Math.ceil(calculatedQty);
                } else if (qtyOption === 'round_balanced') {
                    calculatedQty = Math.round(calculatedQty);
                }
                // If option is 'as_is', calculatedQty is left as a float (e.g. 2.8)
            } else {
                // If S = 1 (custom / مخصص), we treat it as is (no rounding or division)
                calculatedQty = rawQty;
            }

            let currentQty = 0;
            if (targetColorId) {
                const inv = modelInventory.find(i => i.color_id === targetColorId);
                if (inv) currentQty = inv.available_series;
            }

            // When comparing, we round floats to check differences safely
            const diff = calculatedQty - currentQty;

            if (diff !== 0) {
                modelHasChanges = true;
                qtyUpdatesCount++;
                movementsCount++;
            }

            colorEntries.push({
                colorName,
                displayColorName,
                targetColorId,
                action: mapping?.action,
                rawQty,
                calculatedQty,
                currentQty,
                diff
            });
        }

        let categoryId = dbModel?.category_id || null;
        let isActive = dbModel ? dbModel.is_active : false;
        let currentStock = dbModel ? (dbModel.model_inventory?.reduce((sum, inv) => sum + (inv.available_series || 0), 0) || 0) : 0;

        if (modelHasChanges) {
            updatedModelsCount++;
            previewData.push({
                modelId,
                isNew: !dbModel,
                systemCode: code,
                modelName,
                factoryCode,
                categoryId,
                classId,
                isActive,
                currentStock,
                oldPrice,
                newPrice,
                priceChanged: modelPriceChanged,
                colors: colorEntries
            });
        }
    }

    selectedImportStockModelCodes = new Set(previewData.map(m => m.systemCode));

    window.applyImportStockFilters();
}

window.toggleImportStockFilters = () => {
    const container = document.getElementById('import-stock-filters-container');
    const icon = document.getElementById('import-stock-filter-icon');
    if (!container) return;
    if (container.classList.contains('hidden')) {
        container.classList.remove('hidden');
        if (icon) icon.style.transform = 'rotate(0deg)';
    } else {
        container.classList.add('hidden');
        if (icon) icon.style.transform = 'rotate(180deg)';
    }
};

window.updatePreviewStatCards = () => {
    const selectedSet = selectedImportStockModelCodes;
    const selectedItems = previewData.filter(item => selectedSet.has(item.systemCode));

    let excelRowsCount = 0;
    let qtyUpdatesCount = 0;
    let priceChangesCount = 0;
    let movementsCount = 0;
    const uniqueNewColors = new Set();

    selectedItems.forEach(item => {
        const modelExcelRows = excelRawData.filter(r => r.systemCode === item.systemCode).length;
        excelRowsCount += modelExcelRows;

        if (item.priceChanged) priceChangesCount++;

        item.colors.forEach(c => {
            if (c.diff !== 0) {
                qtyUpdatesCount++;
                movementsCount++;
            }
            if (c.action === 'add') {
                uniqueNewColors.add(c.colorName.trim());
            }
        });
        if (item.priceChanged) movementsCount++;
    });

    const rowsEl = document.getElementById('preview-stat-excel-rows');
    const qtyEl = document.getElementById('preview-stat-updated-qty');
    const modelsEl = document.getElementById('preview-stat-models');
    const colorsEl = document.getElementById('preview-stat-colors');
    const pricesEl = document.getElementById('preview-stat-prices');
    const movementsEl = document.getElementById('preview-stat-movements');
    const selectedEl = document.getElementById('import-stock-selected-count');
    const btnSelectedEl = document.getElementById('import-stock-btn-selected-count');

    if (rowsEl) rowsEl.textContent = excelRowsCount;
    if (qtyEl) qtyEl.textContent = qtyUpdatesCount;
    if (modelsEl) modelsEl.textContent = selectedItems.length;
    if (colorsEl) colorsEl.textContent = uniqueNewColors.size;
    if (pricesEl) pricesEl.textContent = priceChangesCount;
    if (movementsEl) movementsEl.textContent = movementsCount;
    if (selectedEl) selectedEl.textContent = selectedItems.length;
    if (btnSelectedEl) btnSelectedEl.textContent = selectedItems.length;
};

window.applyImportStockFilters = () => {
    const nameTerm = document.getElementById('import-stock-search-name')?.value.toLowerCase().trim() || '';
    const factoryTerm = document.getElementById('import-stock-search-factory')?.value.toLowerCase().trim() || '';
    const systemTerm = document.getElementById('import-stock-search-system')?.value.toLowerCase().trim() || '';

    const factoryFromVal = document.getElementById('import-stock-factory-from')?.value.trim() || '';
    const factoryToVal = document.getElementById('import-stock-factory-to')?.value.trim() || '';

    const categoryVal = document.getElementById('import-stock-filter-category')?.value || '';
    const classVal = document.getElementById('import-stock-filter-class')?.value || '';
    const statusVal = document.getElementById('import-stock-filter-status')?.value || '';

    const stockOp = document.getElementById('import-stock-filter-stock-op')?.value || '';
    const stockQtyVal = parseInt(document.getElementById('import-stock-filter-stock-qty')?.value, 10);

    const changeTerm = document.getElementById('import-stock-filter-change')?.value || '';

    filteredPreviewData = previewData.filter(item => {
        let isMatch = true;

        if (nameTerm && !item.modelName.toLowerCase().includes(nameTerm)) isMatch = false;
        if (factoryTerm && !item.factoryCode.toLowerCase().includes(factoryTerm)) isMatch = false;
        if (systemTerm && !String(item.systemCode).toLowerCase().includes(systemTerm)) isMatch = false;

        if (factoryFromVal || factoryToVal) {
            const codeNum = parseInt(item.factoryCode, 10);
            const fromNum = factoryFromVal ? parseInt(factoryFromVal, 10) : NaN;
            const toNum = factoryToVal ? parseInt(factoryToVal, 10) : NaN;

            if (!isNaN(codeNum)) {
                if (!isNaN(fromNum) && codeNum < fromNum) isMatch = false;
                if (!isNaN(toNum) && codeNum > toNum) isMatch = false;
            } else {
                if (factoryFromVal && item.factoryCode < factoryFromVal) isMatch = false;
                if (factoryToVal && item.factoryCode > factoryToVal) isMatch = false;
            }
        }

        if (categoryVal && String(item.categoryId) !== String(categoryVal)) isMatch = false;
        if (classVal && String(item.classId) !== String(classVal)) isMatch = false;

        if (statusVal === 'active' && (!item.isActive || item.isNew)) isMatch = false;
        if (statusVal === 'inactive' && (item.isActive || item.isNew)) isMatch = false;
        if (statusVal === 'new' && !item.isNew) isMatch = false;

        if (stockOp && !isNaN(stockQtyVal)) {
            const qty = item.currentStock || 0;
            if (stockOp === 'equal' && qty !== stockQtyVal) isMatch = false;
            if (stockOp === 'greater' && qty <= stockQtyVal) isMatch = false;
            if (stockOp === 'less' && qty >= stockQtyVal) isMatch = false;
            if (stockOp === 'greater_equal' && qty < stockQtyVal) isMatch = false;
            if (stockOp === 'less_equal' && qty > stockQtyVal) isMatch = false;
        }

        const hasQtyChange = item.colors.some(c => c.diff !== 0);
        if (changeTerm === 'changed' && !hasQtyChange && !item.priceChanged && !item.isNew) isMatch = false;
        if (changeTerm === 'unchanged' && hasQtyChange) isMatch = false;
        if (changeTerm === 'price_changed' && !item.priceChanged) isMatch = false;
        if (changeTerm === 'selected' && !selectedImportStockModelCodes.has(item.systemCode)) isMatch = false;

        return isMatch;
    });

    if (changeTerm !== 'selected') {
        selectedImportStockModelCodes = new Set(filteredPreviewData.map(item => item.systemCode));
    }

    renderPreviewTable(filteredPreviewData);
    window.updatePreviewStatCards();
};

window.clearImportStockFilters = () => {
    ['import-stock-search-name', 'import-stock-search-factory', 'import-stock-search-system', 'import-stock-factory-from', 'import-stock-factory-to', 'import-stock-filter-category', 'import-stock-filter-class', 'import-stock-filter-status', 'import-stock-filter-stock-op', 'import-stock-filter-stock-qty', 'import-stock-filter-change'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const container = document.getElementById('import-stock-filter-stock-qty-container');
    if (container) container.classList.add('hidden');
    window.applyImportStockFilters();
};

window.toggleImportStockSelectAll = (masterCb) => {
    const isChecked = masterCb.checked;
    filteredPreviewData.forEach(item => {
        if (isChecked) {
            selectedImportStockModelCodes.add(item.systemCode);
        } else {
            selectedImportStockModelCodes.delete(item.systemCode);
        }
    });
    renderPreviewTable(filteredPreviewData);
    window.updatePreviewStatCards();
};

window.toggleImportStockModelSelection = (code, checked) => {
    if (checked) {
        selectedImportStockModelCodes.add(code);
    } else {
        selectedImportStockModelCodes.delete(code);
    }

    const selectedCount = selectedImportStockModelCodes.size;
    const countEl = document.getElementById('import-stock-selected-count');
    const btnCountEl = document.getElementById('import-stock-btn-selected-count');
    if (countEl) countEl.textContent = selectedCount;
    if (btnCountEl) btnCountEl.textContent = selectedCount;

    const masterCb = document.getElementById('import-stock-select-all');
    if (masterCb) {
        masterCb.checked = filteredPreviewData.length > 0 && filteredPreviewData.every(item => selectedImportStockModelCodes.has(item.systemCode));
    }
    window.updatePreviewStatCards();
};

// 🌟 Render preview table rows with clear model separators 🌟
function renderPreviewTable(data) {
    const tbodyContainer = document.getElementById('import-preview-tbody-container');
    if (!tbodyContainer) return;

    if (data.length === 0) {
        tbodyContainer.innerHTML = `
            <tbody>
                <tr>
                    <td colspan="8" class="p-8 text-center text-devo-muted text-xs">
                        لا توجد أي نتائج مطابقة للفلترة بالمعاينة.
                    </td>
                </tr>
            </tbody>`;
        return;
    }

    let bodiesHtml = '';
    data.forEach(item => {
        const borderClass = item.isNew ? 'border-b-4 border-devo-orange/40 bg-devo-orange/5' : 'border-b-4 border-devo-gray bg-devo-dark/50 hover:bg-devo-black/20';
        
        let rowsHtml = '';
        item.colors.forEach((color, idx) => {
            const isFirst = idx === 0;
            const rowSpan = item.colors.length;

            const nameDisplay = item.factoryCode 
                ? `${item.modelName} <span class="bg-devo-gray text-white px-2 py-0.5 rounded text-[10px] ml-2 font-mono">مصنع: ${item.factoryCode}</span>` 
                : item.modelName;

            const newBadge = item.isNew ? `<span class="bg-devo-orange text-white text-[9px] font-bold px-1.5 py-0.5 rounded ml-2">جديد</span>` : '';

            let priceDiffHtml = '';
            if (item.isNew) {
                priceDiffHtml = `<span class="text-devo-success font-bold font-mono">${item.newPrice} ج.م</span>`;
            } else if (item.priceChanged) {
                priceDiffHtml = `<span class="text-devo-error line-through ml-2 font-mono">${item.oldPrice}</span>➔ <span class="text-devo-success font-bold font-mono">${item.newPrice}</span>`;
            } else {
                priceDiffHtml = `<span class="text-white font-mono">${item.oldPrice} ج.م</span>`;
            }

            const qtyDiffClass = color.diff > 0 ? 'text-devo-success' : (color.diff < 0 ? 'text-devo-error' : 'text-devo-muted');
            const qtyDiffIcon = color.diff > 0 ? ' ph-arrow-up-right' : (color.diff < 0 ? ' ph-arrow-down-left' : '');
            
            const displayCalculated = color.calculatedQty % 1 !== 0 ? color.calculatedQty.toFixed(2) : color.calculatedQty;
            const displayDiff = color.diff % 1 !== 0 ? (color.diff > 0 ? '+' : '') + color.diff.toFixed(2) : (color.diff > 0 ? '+' : '') + color.diff;

            const diffHtml = color.diff !== 0
                ? `<span class="${qtyDiffClass} font-bold flex items-center justify-center gap-1 font-mono"><i class="ph${qtyDiffIcon}"></i> ${displayDiff}</span>`
                : `<span class="text-devo-muted font-mono">-</span>`;

            rowsHtml += `
                <tr class="transition-colors border-b border-devo-gray/30">
                    ${isFirst ? `<td class="p-3 text-center border-l border-devo-gray/50" rowspan="${rowSpan}"><input type="checkbox" ${selectedImportStockModelCodes.has(item.systemCode) ? 'checked' : ''} onchange="toggleImportStockModelSelection('${item.systemCode}', this.checked)" class="accent-devo-orange w-4 h-4 cursor-pointer"></td>` : ''}
                    ${isFirst ? `<td class="p-3 font-mono text-xs text-devo-muted border-l border-devo-gray/50" rowspan="${rowSpan}">${newBadge}${item.systemCode}</td>` : ''}
                    ${isFirst ? `<td class="p-3 font-bold text-white border-l border-devo-gray/50" rowspan="${rowSpan}">${nameDisplay}</td>` : ''}
                    <td class="p-3 text-white text-xs border-l border-devo-gray/50">${color.displayColorName}</td>
                    ${isFirst ? `<td class="p-3 text-center text-xs border-l border-devo-gray/50" rowspan="${rowSpan}">${priceDiffHtml}</td>` : ''}
                    <td class="p-3 text-center text-xs font-mono text-devo-muted border-l border-devo-gray/50">${color.currentQty}</td>
                    <td class="p-3 text-center text-xs font-mono font-bold text-white border-l border-devo-gray/50">${displayCalculated}</td>
                    <td class="p-3 text-center text-xs font-mono">${diffHtml}</td>
                </tr>
            `;
        });

        bodiesHtml += `<tbody class="${borderClass}">${rowsHtml}</tbody>`;
    });

    tbodyContainer.innerHTML = bodiesHtml;

    const filteredEl = document.getElementById('import-stock-filtered-count');
    const selectedEl = document.getElementById('import-stock-selected-count');
    const btnSelectedEl = document.getElementById('import-stock-btn-selected-count');

    if (filteredEl) filteredEl.textContent = data.length;
    if (selectedEl) selectedEl.textContent = selectedImportStockModelCodes.size;
    if (btnSelectedEl) btnSelectedEl.textContent = selectedImportStockModelCodes.size;

    const masterCb = document.getElementById('import-stock-select-all');
    if (masterCb) {
        masterCb.checked = filteredPreviewData.length > 0 && filteredPreviewData.every(item => selectedImportStockModelCodes.has(item.systemCode));
    }
}

// 🌟 9. Execute Import & Save to Supabase (Save button) 🌟
async function handleConfirmSave() {
    // Build the effective set: only models that are either registered in the system OR user chose 'create'
    const effectiveSelectedCodes = new Set(
        [...selectedImportStockModelCodes].filter(code => {
            const isRegistered = allModels.some(m => String(m.system_code) === String(code));
            if (isRegistered) return true;
            // For unregistered models, only include if user explicitly chose 'create'
            return modelActions[code] === 'create';
        })
    );

    const selectedPreviewData = previewData.filter(item => effectiveSelectedCodes.has(item.systemCode));

    if (selectedPreviewData.length === 0) {
        return showToast('الرجاء اختيار أو اصطياد موديل واحد على الأقل قبل الحفظ', 'warning');
    }

    showProgress('مزامنة وحفظ البيانات', 'جاري بدء الحفظ بقاعدة البيانات...');

    try {
        // Step A: Create new models in bulk batches (only 'create' action, truly unregistered)
        const seenNewCodes = new Set();
        const newModelsToInsert = [];
        for (const item of selectedPreviewData) {
            if (item.isNew && modelActions[item.systemCode] === 'create' && !seenNewCodes.has(item.systemCode)) {
                const unreg = unregisteredModels.find(m => String(m.systemCode) === String(item.systemCode));
                if (unreg) {
                    seenNewCodes.add(item.systemCode);
                    newModelsToInsert.push({
                        system_code: unreg.systemCode,
                        factory_code: unreg.factoryCode,
                        name: unreg.name,
                        price: unreg.price,
                        is_active: false
                    });
                }
            }
        }

        const initialMovements = [];
        if (newModelsToInsert.length > 0) {
            updateProgress('جاري إنشاء الموديلات الجديدة بالسيستم (مجموعات)...', 10);
            for (let i = 0; i < newModelsToInsert.length; i += 200) {
                const chunk = newModelsToInsert.slice(i, i + 200);
                const { data: newModels, error: modelErr } = await supabase
                    .from('models')
                    .insert(chunk)
                    .select('id, system_code, price');

                if (modelErr) throw modelErr;

                if (newModels) {
                    newModels.forEach(newM => {
                        const item = selectedPreviewData.find(p => String(p.systemCode) === String(newM.system_code));
                        if (item) {
                            item.modelId = newM.id;
                            initialMovements.push({
                                model_id: newM.id,
                                color_id: null,
                                movement_type: 'in',
                                quantity: 0,
                                reference: `إنشاء موديل جديد عبر استيراد ERP بسعر ${newM.price} ج.م`
                            });
                        }
                    });
                }
            }
        }

        // Step B: Create new colors globally in bulk with sequential color_code
        updateProgress('جاري فحص وإنشاء الألوان الجديدة بالسيستم وتوليد الأكواد...', 25);
        let maxCodeNum = 0;
        existingColors.forEach(c => {
            const codeNum = parseInt(c.color_code, 10);
            if (!isNaN(codeNum) && codeNum > maxCodeNum) {
                maxCodeNum = codeNum;
            }
        });

        const uniqueColorNamesToCreate = new Set();
        for (const modelMaps of Object.values(colorMappings)) {
            for (const [colorName, mapping] of Object.entries(modelMaps)) {
                if (mapping.action === 'add') {
                    uniqueColorNamesToCreate.add(colorName.trim());
                }
            }
        }

        if (uniqueColorNamesToCreate.size > 0) {
            const existingNames = new Set(existingColors.map(c => c.name.trim()));
            const colorsToInsert = [];

            [...uniqueColorNamesToCreate].forEach(name => {
                if (!existingNames.has(name)) {
                    maxCodeNum++;
                    colorsToInsert.push({
                        color_code: String(maxCodeNum),
                        name: name
                    });
                }
            });

            if (colorsToInsert.length > 0) {
                for (let i = 0; i < colorsToInsert.length; i += 200) {
                    const chunk = colorsToInsert.slice(i, i + 200);
                    const { data: createdColors, error: colorErr } = await supabase
                        .from('colors')
                        .insert(chunk)
                        .select('id, name, color_code');
                    if (colorErr && colorErr.code !== '23505') throw colorErr;
                    if (createdColors) {
                        existingColors.push(...createdColors);
                    }
                }
            }

            const { data: allLatestColors } = await supabase.from('colors').select('id, name, color_code');
            if (allLatestColors) existingColors = allLatestColors;

            const colorMapByName = {};
            existingColors.forEach(c => colorMapByName[c.name.trim()] = c.id);

            for (const modelMaps of Object.values(colorMappings)) {
                for (const [colorName, mapping] of Object.entries(modelMaps)) {
                    if (mapping.action === 'add') {
                        const cleanName = colorName.trim();
                        if (colorMapByName[cleanName]) {
                            mapping.targetColorId = colorMapByName[cleanName];
                        }
                    }
                }
            }
        }

        // Step C: Fetch existing inventory records for all imported models in batch
        updateProgress('جاري فحص أرصدة المخزون السابقة...', 40);
        const affectedModelIds = selectedPreviewData.map(item => item.modelId).filter(Boolean);
        const existingInventoryMap = new Map();

        for (let i = 0; i < affectedModelIds.length; i += 1000) {
            const chunk = affectedModelIds.slice(i, i + 1000);
            const { data: invData, error: fetchInvErr } = await supabase
                .from('model_inventory')
                .select('id, model_id, color_id')
                .in('model_id', chunk);
            if (fetchInvErr) throw fetchInvErr;
            if (invData) {
                invData.forEach(row => {
                    existingInventoryMap.set(`${row.model_id}_${row.color_id}`, row.id);
                });
            }
        }

        // Step D: Build batch payloads in memory
        updateProgress('جاري معالجة وتجهيز تحديثات المخزون والأسعار...', 55);
        const priceUpdates = [];
        const inventoryUpdates = [];
        const inventoryInserts = [];
        const allMovementsToInsert = [...initialMovements];

        for (const item of selectedPreviewData) {
            if (!item.modelId) continue;

            // Price updates
            if (!item.isNew && item.priceChanged) {
                priceUpdates.push({
                    id: item.modelId,
                    price: item.newPrice,
                    updated_at: new Date()
                });
                allMovementsToInsert.push({
                    model_id: item.modelId,
                    color_id: null,
                    movement_type: 'in',
                    quantity: 0,
                    reference: `تعديل السعر من الإكسيل: من ${item.oldPrice} إلى ${item.newPrice} ج.م`
                });
            }

            // Colors & Inventory
            for (const color of item.colors) {
                let targetColorId = color.targetColorId;
                if (color.action === 'add') {
                    targetColorId = colorMappings[item.systemCode]?.[color.colorName]?.targetColorId;
                }
                if (!targetColorId) continue;

                if (color.diff !== 0) {
                    const dbSeriesVal = Math.round(color.calculatedQty);
                    const key = `${item.modelId}_${targetColorId}`;
                    const existingInvId = existingInventoryMap.get(key);

                    if (existingInvId) {
                        inventoryUpdates.push({
                            id: existingInvId,
                            available_series: dbSeriesVal
                        });
                    } else {
                        inventoryInserts.push({
                            model_id: item.modelId,
                            color_id: targetColorId,
                            available_series: dbSeriesVal
                        });
                    }

                    const movementType = color.diff > 0 ? 'in' : 'out';
                    const roundedDiff = Math.abs(Math.round(color.calculatedQty) - color.currentQty);
                    if (roundedDiff !== 0) {
                        allMovementsToInsert.push({
                            model_id: item.modelId,
                            color_id: targetColorId,
                            movement_type: movementType,
                            quantity: roundedDiff,
                            reference: `مزامنة جرد ERP (تعديل رصيد)`
                        });
                    }
                }
            }
        }

        // Step E: Execute Bulk Operations in Batches of 200
        if (priceUpdates.length > 0) {
            updateProgress('جاري تحديث أسعار الموديلات (مجموعات)...', 70);
            for (let i = 0; i < priceUpdates.length; i += 200) {
                const chunk = priceUpdates.slice(i, i + 200);
                const { error } = await supabase.from('models').upsert(chunk, { onConflict: 'id' });
                if (error) throw error;
            }
        }

        if (inventoryUpdates.length > 0) {
            updateProgress('جاري تحديث أرصدة المخزون الحالية (مجموعات)...', 80);
            for (let i = 0; i < inventoryUpdates.length; i += 200) {
                const chunk = inventoryUpdates.slice(i, i + 200);
                const { error } = await supabase.from('model_inventory').upsert(chunk, { onConflict: 'id' });
                if (error) throw error;
            }
        }

        if (inventoryInserts.length > 0) {
            updateProgress('جاري إضافة عناصر المخزون الجديدة (مجموعات)...', 88);
            for (let i = 0; i < inventoryInserts.length; i += 200) {
                const chunk = inventoryInserts.slice(i, i + 200);
                const { error } = await supabase.from('model_inventory').insert(chunk);
                if (error) throw error;
            }
        }

        if (allMovementsToInsert.length > 0) {
            updateProgress('جاري تسجيل حركات الجرد والمخزون (مجموعات)...', 95);
            for (let i = 0; i < allMovementsToInsert.length; i += 200) {
                const chunk = allMovementsToInsert.slice(i, i + 200);
                const { error } = await supabase.from('stock_movements').insert(chunk);
                if (error) throw error;
            }
        }

        updateProgress('اكتملت مزامنة وحفظ البيانات بنجاح!', 100);
        setTimeout(() => {
            hideProgress();
            showToast('تم حفظ ومزامنة كافة التغييرات وجرد المخزون بنجاح!', 'success');
            resetView();
        }, 500);

    } catch (err) {
        console.error("Save Import Error:", err);
        hideProgress();
        showToast(`فشل المزامنة: ${err.message}`, 'error');
    }
}

// Reset view states
function resetView() {
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-file-name').textContent = 'اسحب ملف الإكسيل هنا أو اضغط للاختيار';
    document.getElementById('import-update-price').checked = false;
    
    const defaultRadio = document.querySelector('input[name="import-qty-option"][value="as_is"]');
    if (defaultRadio) defaultRadio.checked = true;

    excelRawData = [];
    unregisteredModels = [];
    modelActions = {};
    unknownColorsList = [];
    colorMappings = {};
    previewData = [];

    switchStep('step-1');
    loadInitialData();
}

// 🌟 Helper: Read raw rows using file reader 🌟
function readExcelFileRaw(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const raw = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                resolve(raw);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error('خطأ في قراءة ملف الإكسيل.'));
        reader.readAsArrayBuffer(file);
    });
}
