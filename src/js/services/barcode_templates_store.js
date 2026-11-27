import { supabase } from '../config/supabase.js';
import {
    BARCODE_TEMPLATES_SETTING_KEY,
    BARCODE_ACTIVE_TEMPLATE_ID_KEY,
    BARCODE_ACTIVE_TEMPLATE_CONFIG_KEY,
    LOCAL_TEMPLATES_STORAGE_KEY,
    LOCAL_ACTIVE_ID_STORAGE_KEY,
    LOCAL_ACTIVE_CONFIG_STORAGE_KEY,
    SYSTEM_TEMPLATE_IDS,
    DEFAULT_BARCODE_TEMPLATES,
    mergeTemplatesCatalog,
    normalizeBarcodeTemplate,
    resolveActiveBarcodeConfig
} from './barcode_template_logic.js';

let cachedState = null;

function readLocalJson(key, fallback = null) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function writeLocalState(state) {
    try {
        const customOnly = {};
        for (const [k, v] of Object.entries(state.templates || {})) {
            if (!SYSTEM_TEMPLATE_IDS.has(k)) {
                customOnly[k] = v;
            }
        }
        // Keep full merged catalog in devo_barcode_templates for full backward compatibility
        localStorage.setItem(LOCAL_TEMPLATES_STORAGE_KEY, JSON.stringify({
            ...DEFAULT_BARCODE_TEMPLATES,
            ...customOnly
        }));
        localStorage.setItem(LOCAL_ACTIVE_ID_STORAGE_KEY, state.activeTemplateId || '');
        localStorage.setItem(LOCAL_ACTIVE_CONFIG_STORAGE_KEY, JSON.stringify(state.activeConfig));
    } catch {
        // Ignore storage quota errors cleanly
    }
}

export function getCachedBarcodeTemplateState() {
    if (cachedState) {
        return cachedState;
    }

    const localTemplates = readLocalJson(LOCAL_TEMPLATES_STORAGE_KEY, null);
    let localActiveId = '';
    try {
        localActiveId = localStorage.getItem(LOCAL_ACTIVE_ID_STORAGE_KEY) || '';
    } catch {
        localActiveId = '';
    }
    const localActiveConfig = readLocalJson(LOCAL_ACTIVE_CONFIG_STORAGE_KEY, null);

    const templates = mergeTemplatesCatalog(localTemplates);
    const activeTemplateId = localActiveId && (templates[localActiveId] || localActiveId === '__custom__')
        ? localActiveId
        : 'default_4_5';
    const activeConfig = resolveActiveBarcodeConfig({
        templates,
        activeTemplateId: activeTemplateId === '__custom__' ? '' : activeTemplateId,
        activeConfig: localActiveConfig
    });

    cachedState = { templates, activeTemplateId, activeConfig };
    return cachedState;
}

export async function loadBarcodeTemplatesConfig(forceRefresh = false) {
    if (cachedState && !forceRefresh && cachedState._syncedFromDb) {
        return cachedState;
    }

    const fallback = getCachedBarcodeTemplateState();

    try {
        const { data, error } = await supabase
            .from('home_settings')
            .select('setting_key, setting_value')
            .in('setting_key', [
                BARCODE_TEMPLATES_SETTING_KEY,
                BARCODE_ACTIVE_TEMPLATE_ID_KEY,
                BARCODE_ACTIVE_TEMPLATE_CONFIG_KEY
            ]);

        if (error) {
            return fallback;
        }

        const map = {};
        (data || []).forEach(row => {
            map[row.setting_key] = row.setting_value;
        });

        const hasDbTemplates = typeof map[BARCODE_TEMPLATES_SETTING_KEY] === 'string' && map[BARCODE_TEMPLATES_SETTING_KEY].trim() !== '';
        const hasDbActiveId = typeof map[BARCODE_ACTIVE_TEMPLATE_ID_KEY] === 'string' && map[BARCODE_ACTIVE_TEMPLATE_ID_KEY].trim() !== '';
        const hasDbActiveConfig = typeof map[BARCODE_ACTIVE_TEMPLATE_CONFIG_KEY] === 'string' && map[BARCODE_ACTIVE_TEMPLATE_CONFIG_KEY].trim() !== '';

        const templates = hasDbTemplates
            ? mergeTemplatesCatalog(map[BARCODE_TEMPLATES_SETTING_KEY])
            : fallback.templates;

        const rawActiveId = hasDbActiveId ? map[BARCODE_ACTIVE_TEMPLATE_ID_KEY].trim() : fallback.activeTemplateId;
        const activeTemplateId = rawActiveId && (templates[rawActiveId] || rawActiveId === '__custom__')
            ? rawActiveId
            : 'default_4_5';

        const activeConfig = hasDbActiveConfig
            ? resolveActiveBarcodeConfig({
                templates,
                activeTemplateId: activeTemplateId === '__custom__' ? '' : activeTemplateId,
                activeConfig: map[BARCODE_ACTIVE_TEMPLATE_CONFIG_KEY]
            })
            : (hasDbActiveId
                ? resolveActiveBarcodeConfig({ templates, activeTemplateId })
                : fallback.activeConfig);

        cachedState = {
            templates,
            activeTemplateId,
            activeConfig,
            _syncedFromDb: true
        };
        writeLocalState(cachedState);
        dispatchBarcodeTemplateChanged(cachedState);
        return cachedState;
    } catch {
        return fallback;
    }
}

export async function saveBarcodeTemplateState({ templates, activeTemplateId, activeConfig }) {
    const mergedTemplates = mergeTemplatesCatalog(templates);
    const resolvedId = activeTemplateId && (mergedTemplates[activeTemplateId] || activeTemplateId === '__custom__')
        ? activeTemplateId
        : '__custom__';

    const normalizedActive = normalizeBarcodeTemplate(
        activeConfig,
        (resolvedId !== '__custom__' && mergedTemplates[resolvedId]) || DEFAULT_BARCODE_TEMPLATES.default_4_5
    );

    const customOnly = {};
    for (const [k, v] of Object.entries(mergedTemplates)) {
        if (!SYSTEM_TEMPLATE_IDS.has(k)) {
            customOnly[k] = v;
        }
    }

    const nextState = {
        templates: mergedTemplates,
        activeTemplateId: resolvedId,
        activeConfig: normalizedActive,
        _syncedFromDb: true
    };

    cachedState = nextState;
    writeLocalState(nextState);

    const updates = [
        { setting_key: BARCODE_TEMPLATES_SETTING_KEY, setting_value: JSON.stringify(customOnly) },
        { setting_key: BARCODE_ACTIVE_TEMPLATE_ID_KEY, setting_value: resolvedId },
        { setting_key: BARCODE_ACTIVE_TEMPLATE_CONFIG_KEY, setting_value: JSON.stringify(normalizedActive) }
    ];

    const { error } = await supabase
        .from('home_settings')
        .upsert(updates, { onConflict: 'setting_key' });

    if (error) {
        throw error;
    }

    dispatchBarcodeTemplateChanged(nextState);
    return nextState;
}

export function dispatchBarcodeTemplateChanged(state) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('devo:barcode-template-changed', {
        detail: state
    }));
}
