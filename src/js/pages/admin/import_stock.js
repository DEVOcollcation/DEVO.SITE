import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';

let isInitialized = false;
let allModels = [];
let existingColors = [];
let excelRawData = [];

// Step state variables
let unregisteredModels = []; // Array of { systemCode, rawName, factoryCode, name, price }
let modelActions = {}; // systemCode -> 'create'|'ignore'
let unknownColorsList = []; // Array of { systemCode, colorName, modelName, factoryCode, count }
let colorMappings = {}; // systemCode -> { colorName -> { action: 'add'|'map'|'ignore', targetColorId } }
let previewData = []; // Array of model updates
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
        btnBackToStep1FromModels.addEventListener('click', () => switchStep('step-1'));
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
                switchStep('step-1');
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
            if (unknownColorsList.length > 0) {
                switchStep('step-2');
            } else if (unregisteredModels.length > 0) {
                switchStep('step-models');
            } else {
                switchStep('step-1');
            }
        });
    }

    const btnConfirmSave = document.getElementById('import-btn-confirm-save');
    if (btnConfirmSave) {
        btnConfirmSave.addEventListener('click', handleConfirmSave);
    }

    const previewSearch = document.getElementById('preview-search');
    if (previewSearch) {
        previewSearch.addEventListener('input', handlePreviewSearch);
    }

    await loadInitialData();
    isInitialized = true;
}

// 🌟 1. Load active models and colors from Supabase 🌟
async function loadInitialData() {
    try {
        // Fetch colors
        const { data: colorsData, error: colorsError } = await supabase
            .from('colors')
            .select('id, name, color_code')
            .order('name');
        if (colorsError) throw colorsError;
        existingColors = colorsData || [];

        // Fetch models
        let allFetchedModels = [];
        let from = 0;
        const step = 999;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from('models')
                .select(`
                    id, system_code, factory_code, name, price, class_id, is_active,
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

    // Toggle global header card visibility in step-models
    const globalHeader = document.getElementById('import-global-header');
    if (globalHeader) {
        globalHeader.classList.toggle('hidden', step === 'step-models');
    }
}

// 🌟 2. Analyze Excel File (Step 1) 🌟
async function handleAnalyze() {
    const fileInput = document.getElementById('import-file-input');
    const file = fileInput?.files[0];
    if (!file) {
        return showToast('الرجاء اختيار ملف إكسيل أولاً', 'warning');
    }

    showProgress('تحليل ملف الجرد', 'جاري فتح وقراءة ملف Excel...');

    setTimeout(async () => {
        try {
            // Read file using XLSX
            const rawRows = await readExcelFileRaw(file);
            if (rawRows.length < 2) {
                throw new Error('الملف فارغ أو لا يحتوي على صفوف بيانات صالحة.');
            }

            updateProgress('جاري استخلاص عناوين الأعمدة والبيانات...', 25);

            // Determine column indices dynamically
            let codeIdx = 18; // default to ERP Index 18
            let nameIdx = 17; // default to ERP Index 17
            let colorIdx = 14; // default to ERP Index 14
            let sizeIdx = 15; // default to ERP Index 15
            let priceIdx = 2; // default to ERP Index 2
            let balanceIdx = 3; // default to ERP Index 3

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

            // Parse data rows
            excelRawData = [];
            const seenCodes = new Set();
            unregisteredModels = [];
            modelActions = {};

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
            }

            if (excelRawData.length === 0) {
                throw new Error('لم يتم العثور على أي صفوف بيانات صالحة للمطابقة في الملف.');
            }

            updateProgress('جاري الانتهاء من إعداد جداول الرفع...', 80);

            setTimeout(() => {
                hideProgress();
                if (unregisteredModels.length > 0) {
                    renderUnregisteredModelsTable();
                    switchStep('step-models');
                    showToast(`تم العثور على ${unregisteredModels.length} موديل غير مسجل بالسيستم. يرجى مراجعتها.`, 'warning');
                } else {
                    checkColorsAndTransition();
                }
            }, 400);

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

        // Render color list badges with piece counts under name
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

    // Clear search values
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
    modelActions = {};
    selects.forEach(select => {
        const code = select.dataset.code;
        modelActions[code] = select.value;
    });

    await checkColorsAndTransition();
}

// 🌟 5. Check Colors And Switch to Step 2 or 3 🌟
async function checkColorsAndTransition() {
    showProgress('مطابقة الألوان المفقودة', 'جاري فحص الألوان المفقودة في الموديلات...');
    
    unknownColorsList = [];
    colorMappings = {};

    const activeRows = excelRawData.filter(row => {
        const exists = allModels.some(m => String(m.system_code) === String(row.systemCode));
        if (exists) return true;
        return modelActions[row.systemCode] === 'create';
    });

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

    updateProgress('جاري مراجعة وتحميل جداول الألوان...', 80);

    setTimeout(async () => {
        hideProgress();
        if (unknownColorsList.length > 0) {
            renderColorMappingTable();
            switchStep('step-2');
            showToast(`تم اكتشاف ألوان غير معرفة للموديلات المحددة. يرجى مطابقتها.`, 'warning');
        } else {
            // Auto map all known colors
            activeRows.forEach(row => {
                if (!colorMappings[row.systemCode]) {
                    colorMappings[row.systemCode] = {};
                }
                const matched = existingColors.find(c => c.name.trim().toLowerCase() === row.colorName.toLowerCase());
                if (matched) {
                    colorMappings[row.systemCode][row.colorName] = { action: 'map', targetColorId: matched.id };
                }
            });

            showProgress('معاينة البيانات', 'جاري حساب أعداد السرايات والتقريب...');
            await processAndRenderPreview();
            hideProgress();
            switchStep('step-3');
        }
    }, 400);
}

// 🌟 6. Render Color Mapping (Step 2) with Model Context 🌟
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
    colorMappings = {};

    excelRawData.forEach(row => {
        const isModelActive = allModels.some(m => String(m.system_code) === String(row.systemCode)) || modelActions[row.systemCode] === 'create';
        if (isModelActive && !colorMappings[row.systemCode]) {
            colorMappings[row.systemCode] = {};
        }
    });

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

    // Auto map all matched known colors
    excelRawData.forEach(row => {
        const mappingsForCode = colorMappings[row.systemCode];
        if (mappingsForCode && !mappingsForCode[row.colorName]) {
            const matched = existingColors.find(c => c.name.trim().toLowerCase() === row.colorName.toLowerCase());
            if (matched) {
                mappingsForCode[row.colorName] = { action: 'map', targetColorId: matched.id };
            }
        }
    });

    showProgress('معاينة البيانات', 'جاري معالجة الفروقات وحساب السرايات...');
    await processAndRenderPreview();
    hideProgress();
    switchStep('step-3');
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

        if (modelHasChanges) {
            updatedModelsCount++;
            previewData.push({
                modelId,
                isNew: !dbModel,
                systemCode: code,
                modelName,
                factoryCode,
                oldPrice,
                newPrice,
                priceChanged: modelPriceChanged,
                colors: colorEntries
            });
        }
    }

    document.getElementById('preview-stat-excel-rows').textContent = excelRawData.length;
    document.getElementById('preview-stat-updated-qty').textContent = qtyUpdatesCount;
    document.getElementById('preview-stat-models').textContent = previewData.length;
    document.getElementById('preview-stat-colors').textContent = newColorsCount;
    document.getElementById('preview-stat-prices').textContent = priceChangesCount;
    document.getElementById('preview-stat-movements').textContent = movementsCount + priceChangesCount;

    renderPreviewTable(previewData);
}

// 🌟 Render preview table rows with clear model separators 🌟
function renderPreviewTable(data) {
    const tbodyContainer = document.getElementById('import-preview-tbody-container');
    if (!tbodyContainer) return;

    if (data.length === 0) {
        tbodyContainer.innerHTML = `
            <tbody>
                <tr>
                    <td colspan="7" class="p-8 text-center text-devo-muted text-xs">
                        لا توجد أي تغييرات مطلوبة للمزامنة (تطابق كامل بين البيانات الحالية والملف).
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
            
            // Format floats for preview display
            const displayCalculated = color.calculatedQty % 1 !== 0 ? color.calculatedQty.toFixed(2) : color.calculatedQty;
            const displayDiff = color.diff % 1 !== 0 ? (color.diff > 0 ? '+' : '') + color.diff.toFixed(2) : (color.diff > 0 ? '+' : '') + color.diff;

            const diffHtml = color.diff !== 0
                ? `<span class="${qtyDiffClass} font-bold flex items-center justify-center gap-1 font-mono"><i class="ph${qtyDiffIcon}"></i> ${displayDiff}</span>`
                : `<span class="text-devo-muted font-mono">-</span>`;

            rowsHtml += `
                <tr class="transition-colors border-b border-devo-gray/30">
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
}

// Live search filter in preview table
function handlePreviewSearch(e) {
    const term = e.target.value.toLowerCase().trim();
    const filtered = previewData.filter(item => {
        return item.modelName.toLowerCase().includes(term) ||
               String(item.systemCode).toLowerCase().includes(term) ||
               String(item.factoryCode).toLowerCase().includes(term);
    });
    renderPreviewTable(filtered);
}

// 🌟 9. Execute Import & Save to Supabase (Save button) 🌟
async function handleConfirmSave() {
    showProgress('مزامنة وحفظ البيانات', 'جاري بدء الحفظ بقاعدة البيانات...');

    try {
        // Step A: Create new models in bulk batches
        const newModelsToInsert = [];
        for (const item of previewData) {
            if (item.isNew) {
                const unreg = unregisteredModels.find(m => String(m.systemCode) === String(item.systemCode));
                if (unreg) {
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
                        const item = previewData.find(p => String(p.systemCode) === String(newM.system_code));
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

        // Step B: Create new colors globally in bulk
        updateProgress('جاري فحص وإنشاء الألوان الجديدة بالسيستم...', 25);
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
            const colorsToInsert = [...uniqueColorNamesToCreate]
                .filter(name => !existingNames.has(name))
                .map(name => ({ name }));

            if (colorsToInsert.length > 0) {
                const { data: createdColors, error: colorErr } = await supabase
                    .from('colors')
                    .insert(colorsToInsert)
                    .select('id, name');
                if (colorErr && colorErr.code !== '23505') throw colorErr;
                if (createdColors) {
                    existingColors.push(...createdColors);
                }
            }

            const { data: allLatestColors } = await supabase.from('colors').select('id, name');
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
        const affectedModelIds = previewData.map(item => item.modelId).filter(Boolean);
        const existingInventoryMap = new Map(); // "modelId_colorId" -> inventoryId

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

        for (const item of previewData) {
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
