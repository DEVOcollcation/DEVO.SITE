// =========================================================================
// Pure logic for Barcode Print Templates, Config Normalization & Label Building
// Safe for Node unit testing and browser usage (no DOM / Supabase imports)
// =========================================================================

export const BARCODE_TEMPLATES_SETTING_KEY = 'barcode_print_templates';
export const BARCODE_ACTIVE_TEMPLATE_ID_KEY = 'barcode_active_template_id';
export const BARCODE_ACTIVE_TEMPLATE_CONFIG_KEY = 'barcode_active_template_config';

export const LOCAL_TEMPLATES_STORAGE_KEY = 'devo_barcode_templates';
export const LOCAL_ACTIVE_ID_STORAGE_KEY = 'devo_active_barcode_template_id';
export const LOCAL_ACTIVE_CONFIG_STORAGE_KEY = 'devo_active_barcode_template_config';

export const SYSTEM_TEMPLATE_IDS = new Set([
    'default_4_5',
    'small_3_4',
    'qr_standard_5_5'
]);

const VALID_CODE_TYPES = new Set(['barcode', 'qrcode']);
const VALID_VALUE_SOURCES = new Set(['factory', 'system', 'url']);
const VALID_QTY_MODES = new Set(['fixed', 'by_color']);
const VALID_COLOR_DISTS = new Set(['separate', 'all_together']);
const VALID_SORT_ORDERS = new Set([
    'table',
    'factory_asc',
    'factory_desc',
    'system_asc',
    'system_desc',
    'name_asc',
    'name_desc',
    'price_asc',
    'price_desc',
    'stock_desc',
    'stock_asc',
    'date_desc',
    'date_asc'
]);

export const DEFAULT_BARCODE_TEMPLATES = Object.freeze({
    default_4_5: {
        name: 'قالب افتراضي 4×5 سم',
        codeType: 'barcode',
        valueSource: 'factory',
        printSortOrder: 'table',
        paperW: 4,
        paperH: 5,
        fontName: 11,
        fontCode: 10,
        codeBold: true,
        colorInline: true,
        fontDetails: 9,
        fontPrice: 12,
        showName: true,
        showCode: true,
        showSizes: true,
        showPrice: true,
        qtyMode: 'fixed',
        fixedQty: 1,
        colorDist: 'all_together',
        showColors: true,
        skipZeroStockColors: true
    },
    small_3_4: {
        name: 'قالب صغير 3×4 سم',
        codeType: 'barcode',
        valueSource: 'factory',
        printSortOrder: 'table',
        paperW: 3,
        paperH: 4,
        fontName: 9,
        fontCode: 8,
        codeBold: true,
        colorInline: true,
        fontDetails: 7,
        fontPrice: 10,
        showName: true,
        showCode: true,
        showSizes: false,
        showPrice: true,
        qtyMode: 'fixed',
        fixedQty: 1,
        colorDist: 'all_together',
        showColors: true,
        skipZeroStockColors: true
    },
    qr_standard_5_5: {
        name: 'قالب QR مربع 5×5 سم',
        codeType: 'qrcode',
        valueSource: 'system',
        printSortOrder: 'table',
        paperW: 5,
        paperH: 5,
        fontName: 12,
        fontCode: 10,
        codeBold: true,
        colorInline: true,
        fontDetails: 9,
        fontPrice: 13,
        showName: true,
        showCode: true,
        showSizes: true,
        showPrice: true,
        qtyMode: 'fixed',
        fixedQty: 1,
        colorDist: 'all_together',
        showColors: true,
        skipZeroStockColors: true
    }
});

export function clampNumber(value, min, max, fallback, isInteger = false) {
    const parsed = isInteger ? parseInt(value, 10) : parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    const clamped = Math.min(max, Math.max(min, parsed));
    return isInteger ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

export function normalizeBarcodeTemplate(raw, fallback = DEFAULT_BARCODE_TEMPLATES.default_4_5) {
    const base = fallback || DEFAULT_BARCODE_TEMPLATES.default_4_5;
    const src = raw && typeof raw === 'object' ? raw : {};

    return {
        name: typeof src.name === 'string' && src.name.trim() ? src.name.trim() : base.name,
        codeType: VALID_CODE_TYPES.has(src.codeType) ? src.codeType : base.codeType,
        valueSource: VALID_VALUE_SOURCES.has(src.valueSource) ? src.valueSource : base.valueSource,
        printSortOrder: VALID_SORT_ORDERS.has(src.printSortOrder) ? src.printSortOrder : (base.printSortOrder || 'table'),
        paperW: clampNumber(src.paperW, 1.5, 25, base.paperW, false),
        paperH: clampNumber(src.paperH, 1.5, 25, base.paperH, false),
        fontName: clampNumber(src.fontName, 6, 36, base.fontName, true),
        fontCode: clampNumber(src.fontCode ?? src.fontDetails, 6, 36, base.fontCode, true),
        codeBold: src.codeBold !== undefined ? Boolean(src.codeBold) : base.codeBold,
        colorInline: src.colorInline !== undefined ? Boolean(src.colorInline) : base.colorInline,
        fontDetails: clampNumber(src.fontDetails, 6, 30, base.fontDetails, true),
        fontPrice: clampNumber(src.fontPrice, 6, 36, base.fontPrice, true),
        showName: src.showName !== undefined ? Boolean(src.showName) : base.showName,
        showCode: src.showCode !== undefined ? Boolean(src.showCode) : base.showCode,
        showSizes: src.showSizes !== undefined ? Boolean(src.showSizes) : base.showSizes,
        showPrice: src.showPrice !== undefined ? Boolean(src.showPrice) : base.showPrice,
        qtyMode: VALID_QTY_MODES.has(src.qtyMode) ? src.qtyMode : base.qtyMode,
        fixedQty: clampNumber(src.fixedQty, 1, 500, base.fixedQty, true),
        colorDist: VALID_COLOR_DISTS.has(src.colorDist) ? src.colorDist : base.colorDist,
        showColors: src.showColors !== undefined ? Boolean(src.showColors) : base.showColors,
        skipZeroStockColors: src.skipZeroStockColors !== undefined ? Boolean(src.skipZeroStockColors) : base.skipZeroStockColors
    };
}

export function mergeTemplatesCatalog(rawSaved) {
    let parsed = rawSaved;
    if (typeof rawSaved === 'string') {
        try {
            parsed = JSON.parse(rawSaved);
        } catch {
            parsed = {};
        }
    }

    const catalog = {};
    for (const [id, def] of Object.entries(DEFAULT_BARCODE_TEMPLATES)) {
        catalog[id] = normalizeBarcodeTemplate(def, def);
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
            if (!key || SYSTEM_TEMPLATE_IDS.has(key)) continue;
            if (!val || typeof val !== 'object') continue;
            catalog[key] = normalizeBarcodeTemplate(val, DEFAULT_BARCODE_TEMPLATES.default_4_5);
        }
    }

    return catalog;
}

export function resolveActiveBarcodeConfig({ templates, activeTemplateId, activeConfig } = {}) {
    const catalog = mergeTemplatesCatalog(templates);
    const matchedPreset = activeTemplateId && catalog[activeTemplateId] ? catalog[activeTemplateId] : null;

    if (activeConfig && typeof activeConfig === 'object') {
        return normalizeBarcodeTemplate(activeConfig, matchedPreset || DEFAULT_BARCODE_TEMPLATES.default_4_5);
    }

    if (typeof activeConfig === 'string' && activeConfig.trim()) {
        try {
            const parsed = JSON.parse(activeConfig);
            if (parsed && typeof parsed === 'object') {
                return normalizeBarcodeTemplate(parsed, matchedPreset || DEFAULT_BARCODE_TEMPLATES.default_4_5);
            }
        } catch {
            // Fall through to matchedPreset / default
        }
    }

    if (matchedPreset) {
        return normalizeBarcodeTemplate(matchedPreset, matchedPreset);
    }

    return normalizeBarcodeTemplate(DEFAULT_BARCODE_TEMPLATES.default_4_5);
}

export function formatActiveTemplateSummary(config, templateName = '') {
    const cfg = normalizeBarcodeTemplate(config);
    const typeText = cfg.codeType === 'qrcode' ? 'QR Code' : 'باركود شريطي';
    const srcText = cfg.valueSource === 'system'
        ? 'كود السيستم'
        : (cfg.valueSource === 'url' ? 'رابط مباشر' : 'كود المصنع');
    const title = templateName && templateName.trim() ? templateName.trim() : (cfg.name || 'قالب مخصص');
    return `${title} · ${cfg.paperW} × ${cfg.paperH} سم · ${typeText} (${srcText})`;
}

export function resolveBarcodeValue(model, valueSource = 'factory', origin = '') {
    const m = model || {};
    const safeOrigin = (origin || '').replace(/\/+$/, '');

    if (valueSource === 'system') {
        const raw = (m.system_code || m.factory_code || m.id || '101').toString().trim().replace(/^(SYS-|S)/i, '');
        return `S${raw}`;
    }

    if (valueSource === 'factory') {
        const raw = (m.factory_code || m.system_code || m.id || '101').toString().trim().replace(/^(FAC-|F)/i, '');
        return `F${raw}`;
    }

    if (valueSource === 'url') {
        if (m.system_code) {
            const clean = m.system_code.toString().trim().replace(/^(SYS-|S)/i, '');
            return `${safeOrigin}/?system=${encodeURIComponent(clean)}`;
        }
        if (m.factory_code) {
            const clean = m.factory_code.toString().trim().replace(/^(FAC-|F)/i, '');
            return `${safeOrigin}/?factory=${encodeURIComponent(clean)}`;
        }
        return `${safeOrigin}/?code=${encodeURIComponent(m.id || '101')}`;
    }

    return (m.system_code || m.factory_code || m.id || '101').toString();
}

export function getModelSizesString(model, sizesMap = {}) {
    if (!model) return '';
    let sizeNames = [];
    if (model.classes?.class_sizes && model.classes.class_sizes.length > 0) {
        sizeNames = model.classes.class_sizes.map(cs => cs.sizes?.name || sizesMap[cs.size_id] || cs.size_id);
    } else if (model.model_sizes && model.model_sizes.length > 0) {
        sizeNames = model.model_sizes.map(ms => ms.sizes?.name || sizesMap[ms.size_id] || ms.size_id);
    }
    return sizeNames.filter(Boolean).join('، ');
}

export function compareCodeOrText(valA, valB, dir = 'asc') {
    const strA = (valA ?? '').toString().trim();
    const strB = (valB ?? '').toString().trim();

    if (!strA && !strB) return 0;
    if (!strA) return dir === 'asc' ? 1 : -1;
    if (!strB) return dir === 'asc' ? -1 : 1;

    const cleanA = strA.replace(/^(FAC-|SYS-|F|S)/i, '').trim();
    const cleanB = strB.replace(/^(FAC-|SYS-|F|S)/i, '').trim();
    const numA = Number(cleanA);
    const numB = Number(cleanB);

    if (!Number.isNaN(numA) && !Number.isNaN(numB) && cleanA !== '' && cleanB !== '') {
        return dir === 'asc' ? numA - numB : numB - numA;
    }

    const cmp = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
}

export function sortBarcodeModels(list, sortKey = 'table') {
    const copy = Array.isArray(list) ? [...list] : [];
    if (!sortKey || sortKey === 'table' || copy.length <= 1) return copy;

    copy.sort((a, b) => {
        switch (sortKey) {
            case 'factory_asc':
                return compareCodeOrText(a.factory_code, b.factory_code, 'asc');
            case 'factory_desc':
                return compareCodeOrText(a.factory_code, b.factory_code, 'desc');
            case 'system_asc':
                return compareCodeOrText(a.system_code, b.system_code, 'asc');
            case 'system_desc':
                return compareCodeOrText(a.system_code, b.system_code, 'desc');
            case 'name_asc':
                return (a.name || '').localeCompare(b.name || '', 'ar');
            case 'name_desc':
                return (b.name || '').localeCompare(a.name || '', 'ar');
            case 'price_asc':
                return (Number(a.price) || 0) - (Number(b.price) || 0);
            case 'price_desc':
                return (Number(b.price) || 0) - (Number(a.price) || 0);
            case 'stock_desc': {
                const stockA = a.model_inventory?.reduce((s, i) => s + (i.available_series || 0), 0) || 0;
                const stockB = b.model_inventory?.reduce((s, i) => s + (i.available_series || 0), 0) || 0;
                return stockB - stockA;
            }
            case 'stock_asc': {
                const stockA = a.model_inventory?.reduce((s, i) => s + (i.available_series || 0), 0) || 0;
                const stockB = b.model_inventory?.reduce((s, i) => s + (i.available_series || 0), 0) || 0;
                return stockA - stockB;
            }
            case 'date_desc':
                return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            case 'date_asc':
                return new Date(a.created_at || 0) - new Date(b.created_at || 0);
            default:
                return 0;
        }
    });

    return copy;
}

export function buildLabelsToPrint(models, templateConfig, { sizesMap = {}, colorsMap = {}, origin = '' } = {}) {
    const cfg = normalizeBarcodeTemplate(templateConfig);
    const orderedModels = sortBarcodeModels(models, cfg.printSortOrder);
    const labelsToPrint = [];

    orderedModels.forEach(m => {
        if (!m) return;
        const hasInventoryEntries = Array.isArray(m.model_inventory) && m.model_inventory.length > 0;

        let colorsList = [];
        if (hasInventoryEntries) {
            let inventoryItems = m.model_inventory;
            if (cfg.skipZeroStockColors) {
                inventoryItems = inventoryItems.filter(inv => (inv.available_series || 0) > 0);
            }
            const modelColors = inventoryItems
                .map(inv => (inv.colors && inv.colors.name) || colorsMap[inv.color_id] || '')
                .filter(Boolean);
            colorsList = [...new Set(modelColors)];

            if (colorsList.length === 0 && cfg.skipZeroStockColors) {
                return;
            }
        }

        const hasColors = colorsList.length > 0;
        if (colorsList.length === 0) {
            colorsList = [''];
        }

        const formattedCodeVal = resolveBarcodeValue(m, cfg.valueSource, origin);
        const baseLabel = {
            name: m.name || '',
            factory_code: m.factory_code || '',
            system_code: m.system_code || '',
            display_code: formattedCodeVal,
            price: m.price ?? 0,
            sizesStr: getModelSizesString(m, sizesMap),
            value: formattedCodeVal
        };

        if (cfg.qtyMode === 'fixed') {
            const copiesCount = Math.max(1, cfg.fixedQty);
            const isSingle = colorsList.length === 1 && colorsList[0] !== '';
            const allColorsJoined = cfg.showColors && hasColors ? colorsList.join('، ') : '';
            for (let i = 0; i < copiesCount; i++) {
                labelsToPrint.push({
                    ...baseLabel,
                    colorStr: allColorsJoined,
                    isSingleColor: isSingle
                });
            }
        } else {
            const copiesPerColor = Math.max(1, cfg.fixedQty);
            if (cfg.colorDist === 'separate') {
                colorsList.forEach(color => {
                    for (let i = 0; i < copiesPerColor; i++) {
                        labelsToPrint.push({
                            ...baseLabel,
                            colorStr: cfg.showColors ? color : '',
                            isSingleColor: Boolean(color)
                        });
                    }
                });
            } else {
                const isSingle = colorsList.length === 1 && colorsList[0] !== '';
                const allColorsJoined = cfg.showColors && hasColors ? colorsList.join('، ') : '';
                const totalCopies = colorsList.length * copiesPerColor;
                for (let i = 0; i < totalCopies; i++) {
                    labelsToPrint.push({
                        ...baseLabel,
                        colorStr: allColorsJoined,
                        isSingleColor: isSingle
                    });
                }
            }
        }
    });

    return labelsToPrint;
}

export function estimateLabelsCount(models, templateConfig, colorsMap = {}) {
    const cfg = normalizeBarcodeTemplate(templateConfig);
    const list = Array.isArray(models) ? models : [];
    if (list.length === 0) {
        return { totalStickers: 0, text: '0 ملصق' };
    }

    let totalStickers = 0;
    list.forEach(m => {
        if (!m) return;
        let colorsCount = 1;
        const hasInventoryEntries = Array.isArray(m.model_inventory) && m.model_inventory.length > 0;
        if (hasInventoryEntries) {
            let items = m.model_inventory;
            if (cfg.skipZeroStockColors) {
                items = items.filter(inv => (inv.available_series || 0) > 0);
            }
            const uniqueColors = new Set(
                items.map(inv => (inv.colors && inv.colors.name) || colorsMap[inv.color_id] || '').filter(Boolean)
            );
            if (uniqueColors.size === 0 && cfg.skipZeroStockColors) {
                return;
            }
            colorsCount = Math.max(1, uniqueColors.size);
        }

        if (cfg.qtyMode === 'fixed') {
            totalStickers += Math.max(1, cfg.fixedQty);
        } else {
            totalStickers += colorsCount * Math.max(1, cfg.fixedQty);
        }
    });

    const text = cfg.qtyMode === 'fixed'
        ? `${totalStickers} ملصق (${cfg.fixedQty} لكل موديل)`
        : `${totalStickers} ملصق (حسب ألوان الموديلات)`;

    return { totalStickers, text };
}

export function escapePrintHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
