/**
 * Pure business logic for Data Management, Base Stock Settlement Equation,
 * Model Hunter Filtering, and Settings Lock (PIN + 9-Dot Pattern).
 *
 * Kept 100% free of DOM and Supabase runtime side-effects so it can be
 * verified deterministically with fast unit tests.
 */

export const SETTLEMENT_REF_PREFIX = '[SETTLEMENT]';
export const SETTINGS_LOCK_KEY = 'settings_security_lock_v1';

export const LOCK_MODES = Object.freeze({
    PIN: 'pin',
    PATTERN: 'pattern',
    EITHER: 'either',
    BOTH: 'both'
});

export const MAX_LOCK_ATTEMPTS = 5;
export const LOCK_COOLDOWN_MS = 30 * 1000;

/**
 * Collinear midpoint lookup table for a 3x3 pattern grid indexed 0..8:
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */
export const PATTERN_MIDPOINTS = Object.freeze({
    '0-2': 1, '2-0': 1,
    '0-6': 3, '6-0': 3,
    '0-8': 4, '8-0': 4,
    '1-7': 4, '7-1': 4,
    '2-6': 4, '6-2': 4,
    '2-8': 5, '8-2': 5,
    '3-5': 4, '5-3': 4,
    '6-8': 7, '8-6': 7
});

// =========================================================================
// 1. BASE STOCK & SETTLEMENT LEDGER EQUATION
// =========================================================================

/**
 * Identifies whether a stock_movements row represents a settlement / zeroing
 * entry (distinct from regular sales orders).
 */
export function isSettlementMovement(movement) {
    if (!movement || typeof movement !== 'object') return false;
    const isOut = movement.movement_type === 'out';
    const hasNoOrder = movement.order_id === null || movement.order_id === undefined || movement.order_id === '';
    const ref = typeof movement.reference === 'string' ? movement.reference.trim() : '';
    return isOut && hasNoOrder && ref.startsWith(SETTLEMENT_REF_PREFIX);
}

/**
 * Builds a standardized settlement reference string stored in stock_movements.
 */
export function buildSettlementReference(reason = '', kind = 'zero') {
    const cleanReason = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (cleanReason) {
        return `${SETTLEMENT_REF_PREFIX} ${cleanReason}`;
    }
    if (kind === 'archive_order') {
        return `${SETTLEMENT_REF_PREFIX} أرشيف فواتير مبيعات محذوفة`;
    }
    if (kind === 'adjust') {
        return `${SETTLEMENT_REF_PREFIX} تسوية رصيد مخزون`;
    }
    return `${SETTLEMENT_REF_PREFIX} تسوية وتصفير مخزون`;
}

/**
 * Computes accurate Base Stock (الأصل) for a single model+color:
 *   Base Stock = Current Remaining + Sold in Invoices + Settled/Zeroed Movements
 */
export function computeColorBaseStock({ availableSeries = 0, soldSeries = 0, settledSeries = 0 } = {}) {
    const available = Math.max(0, Number(availableSeries) || 0);
    const sold = Math.max(0, Number(soldSeries) || 0);
    const settled = Math.max(0, Number(settledSeries) || 0);
    return {
        available,
        sold,
        settled,
        baseStock: available + sold + settled
    };
}

/**
 * Combines order_items and stock_movements for a model into a unified
 * per-color offset map (sold + settled) so gallery cards compute:
 *   baseStock = available + colorOffsetMap[colorId]
 * without double-counting sales that also appear in stock_movements.
 */
export function buildModelColorOffsetMap({ orderItems = [], outMovements = [] } = {}) {
    const soldMap = {};
    const settledMap = {};
    const legacyOutMap = {};

    if (Array.isArray(orderItems)) {
        for (const item of orderItems) {
            if (!item || item.color_id === null || item.color_id === undefined) continue;
            const cid = String(item.color_id);
            const qty = Math.max(0, Number(item.quantity) || 0);
            if (qty > 0) soldMap[cid] = (soldMap[cid] || 0) + qty;
        }
    }

    if (Array.isArray(outMovements)) {
        for (const mov of outMovements) {
            if (!mov || mov.color_id === null || mov.color_id === undefined) continue;
            const cid = String(mov.color_id);
            const qty = Math.max(0, Number(mov.quantity) || 0);
            if (qty <= 0) continue;

            if (isSettlementMovement(mov)) {
                settledMap[cid] = (settledMap[cid] || 0) + qty;
            } else if (mov.movement_type === 'out') {
                legacyOutMap[cid] = (legacyOutMap[cid] || 0) + qty;
            }
        }
    }

    const hasRealOrderItems = Object.keys(soldMap).length > 0;
    const combined = {};
    const allColorIds = new Set([
        ...Object.keys(soldMap),
        ...Object.keys(settledMap),
        ...(hasRealOrderItems ? [] : Object.keys(legacyOutMap))
    ]);

    for (const cid of allColorIds) {
        const sold = hasRealOrderItems ? (soldMap[cid] || 0) : (legacyOutMap[cid] || 0);
        const settled = settledMap[cid] || 0;
        const total = sold + settled;
        if (total > 0) combined[cid] = total;
    }

    return {
        combined,
        soldMap: hasRealOrderItems ? soldMap : legacyOutMap,
        settledMap
    };
}

/**
 * Builds an exact settlement/zeroing plan for selected models.
 * - targetQty = 0 zeroes remaining stock while recording delta in stock_movements
 * - targetQty > 0 adjusts remaining stock to targetQty:
 *     - If currentQty > targetQty: records positive settlement 'out' movement of (currentQty - targetQty)
 *     - If currentQty < targetQty: increases stock (records 'in' adjustment movement; does not inflate settlement)
 * - onlyColorIds (optional Set/Array): restricts operation to matching colors only.
 */
export function buildSettlementPlan(models = [], options = {}) {
    const targetQty = Math.max(0, parseInt(options.targetQty ?? 0, 10) || 0);
    const onlyDecrease = options.onlyDecrease !== false && targetQty === 0;
    const reason = options.reason || '';
    const colorFilterSet = options.onlyColorIds && options.onlyColorIds.length > 0
        ? new Set(options.onlyColorIds.map(String))
        : null;

    const updates = [];
    const movements = [];
    const affectedModelIds = new Set();
    let totalSeriesSettled = 0;
    let totalSeriesAdded = 0;

    for (const model of models) {
        if (!model || !Array.isArray(model.model_inventory)) continue;

        for (const inv of model.model_inventory) {
            if (!inv || inv.color_id === null || inv.color_id === undefined) continue;
            if (colorFilterSet && !colorFilterSet.has(String(inv.color_id))) continue;

            const currentQty = Math.max(0, Number(inv.available_series) || 0);
            if (currentQty === targetQty) continue;
            if (onlyDecrease && currentQty < targetQty) continue;

            const delta = currentQty - targetQty; // > 0 means settling/removing from remaining
            affectedModelIds.add(model.id);

            updates.push({
                id: inv.id,
                model_id: model.id,
                color_id: inv.color_id,
                model_name: model.name || '',
                factory_code: model.factory_code || model.system_code || '',
                color_name: inv.colors?.name || '',
                previous_series: currentQty,
                new_series: targetQty,
                delta
            });

            if (delta > 0) {
                totalSeriesSettled += delta;
                movements.push({
                    model_id: model.id,
                    color_id: inv.color_id,
                    movement_type: 'out',
                    quantity: delta,
                    reference: buildSettlementReference(reason, targetQty === 0 ? 'zero' : 'adjust'),
                    order_id: null,
                    inbound_id: null
                });
            } else if (delta < 0) {
                const added = Math.abs(delta);
                totalSeriesAdded += added;
                movements.push({
                    model_id: model.id,
                    color_id: inv.color_id,
                    movement_type: 'in',
                    quantity: added,
                    reference: reason ? `تعديل رصيد يدوي (إدارة البيانات): ${reason.trim()}` : 'تعديل رصيد يدوي (إدارة البيانات)',
                    order_id: null,
                    inbound_id: null
                });
            }
        }
    }

    return {
        updates,
        movements,
        summary: {
            modelsAffected: affectedModelIds.size,
            colorRowsAffected: updates.length,
            totalSeriesSettled,
            totalSeriesAdded
        }
    };
}

/**
 * Aggregates deleted sales order items by (model_id, color_id) into
 * [SETTLEMENT] stock_movements rows so deleting sales invoices while keeping
 * stock as-is preserves every model's Base Stock (الأصل).
 */
export function buildOrderArchiveSettlementEntries(orderItems = [], reason = '') {
    const grouped = new Map();
    for (const item of orderItems) {
        if (!item || !item.model_id || !item.color_id) continue;
        const qty = Math.max(0, Number(item.quantity) || 0);
        if (qty <= 0) continue;
        const key = `${item.model_id}::${item.color_id}`;
        const prev = grouped.get(key) || { model_id: item.model_id, color_id: item.color_id, quantity: 0 };
        prev.quantity += qty;
        grouped.set(key, prev);
    }

    const ref = buildSettlementReference(reason, 'archive_order');
    return Array.from(grouped.values()).map(entry => ({
        model_id: entry.model_id,
        color_id: entry.color_id,
        movement_type: 'out',
        quantity: entry.quantity,
        reference: ref,
        order_id: null,
        inbound_id: null
    }));
}

/**
 * Aggregates deleted sales order items by (model_id, color_id) into positive
 * stock restoration deltas when the owner chooses "restore stock".
 */
export function buildOrderRestoreStockDeltas(orderItems = []) {
    const grouped = new Map();
    for (const item of orderItems) {
        if (!item || !item.model_id || !item.color_id) continue;
        const qty = Math.max(0, Number(item.quantity) || 0);
        if (qty <= 0) continue;
        const key = `${item.model_id}::${item.color_id}`;
        const prev = grouped.get(key) || { model_id: item.model_id, color_id: item.color_id, restoreQty: 0 };
        prev.restoreQty += qty;
        grouped.set(key, prev);
    }
    return Array.from(grouped.values());
}

/**
 * Computes safe stock deductions (clamped at 0) when deleting inbound invoices
 * with "deduct quantities from inventory".
 */
export function buildInboundDeductStockDeltas(inboundItems = [], currentInventoryMap = new Map()) {
    const grouped = new Map();
    for (const item of inboundItems) {
        if (!item || !item.model_id || !item.color_id) continue;
        const qty = Math.max(0, Number(item.quantity) || 0);
        if (qty <= 0) continue;
        const key = `${item.model_id}::${item.color_id}`;
        const prev = grouped.get(key) || { model_id: item.model_id, color_id: item.color_id, deductQty: 0 };
        prev.deductQty += qty;
        grouped.set(key, prev);
    }

    return Array.from(grouped.values()).map(entry => {
        const key = `${entry.model_id}::${entry.color_id}`;
        const currentQty = Math.max(0, Number(currentInventoryMap.get(key)) || 0);
        const newQty = Math.max(0, currentQty - entry.deductQty);
        return {
            ...entry,
            currentQty,
            newQty,
            actualDeducted: currentQty - newQty
        };
    });
}

// =========================================================================
// 2. MODEL HUNTER (صياد الموديلات) PURE FILTER ENGINE
// =========================================================================

/**
 * Filters a list of models using all 10 criteria of DEVO's Model Hunter.
 */
export function filterModelsByHunter(models = [], criteria = {}) {
    const nameTerm = String(criteria.nameTerm || '').toLowerCase().trim();
    const factoryTerm = String(criteria.factoryTerm || '').toLowerCase().trim();
    const systemTerm = String(criteria.systemTerm || '').toLowerCase().trim();
    const factoryFromVal = String(criteria.factoryFrom || '').trim();
    const factoryToVal = String(criteria.factoryTo || '').trim();

    const selectedCats = Array.isArray(criteria.selectedCats) ? criteria.selectedCats.map(String) : [];
    const isCatExclude = Boolean(criteria.isCatExclude);

    const selectedClasses = Array.isArray(criteria.selectedClasses) ? criteria.selectedClasses.map(String) : [];
    const isClassExclude = Boolean(criteria.isClassExclude);

    const status = criteria.status === undefined || criteria.status === null ? '' : String(criteria.status);
    const stockOp = String(criteria.stockOp || '');
    const stockQtyVal = criteria.stockQty !== '' && criteria.stockQty !== undefined && criteria.stockQty !== null
        ? parseInt(criteria.stockQty, 10)
        : NaN;

    const selectedColors = Array.isArray(criteria.selectedColors) ? criteria.selectedColors.map(String) : [];
    const isColorExclude = Boolean(criteria.isColorExclude);

    const selectedSizes = Array.isArray(criteria.selectedSizes) ? criteria.selectedSizes.map(String) : [];
    const isSizeExclude = Boolean(criteria.isSizeExclude);

    const minPrice = criteria.minPrice !== '' && criteria.minPrice !== undefined && criteria.minPrice !== null
        ? parseFloat(criteria.minPrice)
        : NaN;
    const maxPrice = criteria.maxPrice !== '' && criteria.maxPrice !== undefined && criteria.maxPrice !== null
        ? parseFloat(criteria.maxPrice)
        : NaN;

    const dateFrom = String(criteria.dateFrom || '').trim();
    const dateTo = String(criteria.dateTo || '').trim();

    return models.filter(m => {
        if (!m) return false;

        if (nameTerm && !(m.name || '').toLowerCase().includes(nameTerm)) return false;
        if (factoryTerm && !(m.factory_code || '').toLowerCase().includes(factoryTerm)) return false;
        if (systemTerm && !(m.system_code || '').toLowerCase().includes(systemTerm)) return false;

        if (factoryFromVal || factoryToVal) {
            const rawCode = String(m.factory_code || '');
            const codeNum = parseInt(rawCode, 10);
            const fromNum = factoryFromVal ? parseInt(factoryFromVal, 10) : NaN;
            const toNum = factoryToVal ? parseInt(factoryToVal, 10) : NaN;

            if (!isNaN(codeNum) && (!factoryFromVal || !isNaN(fromNum)) && (!factoryToVal || !isNaN(toNum))) {
                if (!isNaN(fromNum) && codeNum < fromNum) return false;
                if (!isNaN(toNum) && codeNum > toNum) return false;
            } else {
                if (factoryFromVal && rawCode < factoryFromVal) return false;
                if (factoryToVal && rawCode > factoryToVal) return false;
            }
        }

        if (selectedCats.length > 0) {
            const inList = selectedCats.includes(String(m.category_id));
            if (isCatExclude && inList) return false;
            if (!isCatExclude && !inList) return false;
        }

        if (selectedClasses.length > 0) {
            const inList = selectedClasses.includes(String(m.class_id));
            if (isClassExclude && inList) return false;
            if (!isClassExclude && !inList) return false;
        }

        if (status !== '' && String(m.is_active) !== status) return false;

        const totalQty = (m.model_inventory || []).reduce((sum, inv) => sum + (Number(inv.available_series) || 0), 0);
        if (stockOp && !isNaN(stockQtyVal)) {
            if (stockOp === 'less' && totalQty >= stockQtyVal) return false;
            if (stockOp === 'greater' && totalQty <= stockQtyVal) return false;
            if (stockOp === 'equal' && totalQty !== stockQtyVal) return false;
        }

        if (selectedColors.length > 0) {
            const hasAnyColor = (m.model_inventory || []).some(inv => selectedColors.includes(String(inv.color_id)));
            if (isColorExclude && hasAnyColor) return false;
            if (!isColorExclude && !hasAnyColor) return false;
        }

        if (selectedSizes.length > 0) {
            const classSizes = (m.classes?.class_sizes || []).map(cs => String(cs.size_id));
            const manualSizes = (m.model_sizes || []).map(ms => String(ms.size_id));
            const hasAnySize = selectedSizes.some(sId => classSizes.includes(sId) || manualSizes.includes(sId));
            if (isSizeExclude && hasAnySize) return false;
            if (!isSizeExclude && !hasAnySize) return false;
        }

        const price = Number(m.price);
        if (!isNaN(minPrice) && price < minPrice) return false;
        if (!isNaN(maxPrice) && price > maxPrice) return false;

        if (dateFrom || dateTo) {
            const modelDate = new Date(m.created_at);
            if (!isNaN(modelDate.getTime())) {
                modelDate.setHours(0, 0, 0, 0);
                if (dateFrom) {
                    const fDate = new Date(dateFrom);
                    fDate.setHours(0, 0, 0, 0);
                    if (modelDate < fDate) return false;
                }
                if (dateTo) {
                    const tDate = new Date(dateTo);
                    tDate.setHours(23, 59, 59, 999);
                    if (modelDate > tDate) return false;
                }
            }
        }

        return true;
    });
}

// =========================================================================
// 3. SETTINGS SECURITY LOCK (PIN + 9-DOT PATTERN) PURE LOGIC
// =========================================================================

/**
 * Appends a node (0..8) to a pattern sequence, automatically interpolating
 * any unvisited collinear midpoint node (e.g., 0 -> 2 automatically includes 1).
 */
export function appendPatternNode(sequence = [], nextNode) {
    const node = Number(nextNode);
    if (!Number.isInteger(node) || node < 0 || node > 8) return [...sequence];
    if (sequence.includes(node)) return [...sequence];

    const updated = [...sequence];
    if (updated.length > 0) {
        const last = updated[updated.length - 1];
        const mid = PATTERN_MIDPOINTS[`${last}-${node}`];
        if (mid !== undefined && !updated.includes(mid)) {
            updated.push(mid);
        }
    }
    updated.push(node);
    return updated;
}

export function serializePattern(sequence = []) {
    return sequence.map(Number).join('-');
}

export function validatePinFormat(pin) {
    const str = String(pin ?? '').trim();
    return /^\d{4,8}$/.test(str);
}

export function validatePatternSequence(sequence) {
    if (!Array.isArray(sequence) || sequence.length < 4 || sequence.length > 9) return false;
    const seen = new Set();
    for (const n of sequence) {
        const num = Number(n);
        if (!Number.isInteger(num) || num < 0 || num > 8 || seen.has(num)) return false;
        seen.add(num);
    }
    return true;
}

/**
 * Generates a cryptographically strong random hex salt (16 bytes = 32 hex chars).
 */
export function generateRandomSalt() {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hashes a PIN or serialized pattern with a per-config salt using Web Crypto
 * PBKDF2-SHA256 (100,000 iterations) so secrets are never stored in plaintext.
 */
export async function hashLockSecret(secret, salt, kind = 'pin') {
    const enc = new TextEncoder();
    const keyMaterial = await globalThis.crypto.subtle.importKey(
        'raw',
        enc.encode(`${kind}:${String(secret)}`),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );

    const bits = await globalThis.crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: enc.encode(`devo-settings-lock::${String(salt)}`),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );

    return Array.from(new Uint8Array(bits), b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string comparison for fixed-length hex digests.
 */
export function constantTimeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || a.length === 0) {
        return false;
    }
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/**
 * Safely parses & normalizes stored JSON lock configuration from home_settings.
 */
export function normalizeLockConfig(raw) {
    if (!raw) return null;
    let obj = raw;
    if (typeof raw === 'string') {
        try {
            obj = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object') return null;

    const validModes = Object.values(LOCK_MODES);
    const mode = validModes.includes(obj.mode) ? obj.mode : LOCK_MODES.EITHER;
    const salt = typeof obj.salt === 'string' && obj.salt.length >= 16 ? obj.salt : '';
    const pinHash = typeof obj.pinHash === 'string' && obj.pinHash.length === 64 ? obj.pinHash : null;
    const patternHash = typeof obj.patternHash === 'string' && obj.patternHash.length === 64 ? obj.patternHash : null;
    const autoLockMinutes = Math.max(0, Math.min(120, parseInt(obj.autoLockMinutes ?? 15, 10) || 0));

    // Verify the chosen mode actually has the required hashes configured
    const hasRequiredCredentials =
        Boolean(salt) && (
            (mode === LOCK_MODES.PIN && Boolean(pinHash)) ||
            (mode === LOCK_MODES.PATTERN && Boolean(patternHash)) ||
            ((mode === LOCK_MODES.EITHER || mode === LOCK_MODES.BOTH) && Boolean(pinHash) && Boolean(patternHash))
        );

    if (!hasRequiredCredentials) return null;

    return {
        enabled: obj.enabled !== false,
        mode,
        salt,
        pinHash,
        patternHash,
        autoLockMinutes,
        updatedAt: obj.updatedAt || null
    };
}

/**
 * Pure rate-limiting state machine for Settings Lock verification attempts.
 */
export function evaluateLockAttempt(state = { failedAttempts: 0, cooldownUntil: 0 }, isSuccess, nowMs = Date.now()) {
    const currentCooldown = Number(state.cooldownUntil) || 0;
    if (currentCooldown > nowMs) {
        return {
            allowed: false,
            lockedOut: true,
            remainingSeconds: Math.ceil((currentCooldown - nowMs) / 1000),
            nextState: {
                failedAttempts: Number(state.failedAttempts) || 0,
                cooldownUntil: currentCooldown
            }
        };
    }

    if (isSuccess) {
        return {
            allowed: true,
            lockedOut: false,
            remainingSeconds: 0,
            nextState: { failedAttempts: 0, cooldownUntil: 0 }
        };
    }

    const nextFails = (Number(state.failedAttempts) || 0) + 1;
    if (nextFails >= MAX_LOCK_ATTEMPTS) {
        const nextCooldown = nowMs + LOCK_COOLDOWN_MS;
        return {
            allowed: false,
            lockedOut: true,
            remainingSeconds: Math.ceil(LOCK_COOLDOWN_MS / 1000),
            nextState: { failedAttempts: 0, cooldownUntil: nextCooldown }
        };
    }

    return {
        allowed: false,
        lockedOut: false,
        remainingSeconds: 0,
        attemptsLeft: MAX_LOCK_ATTEMPTS - nextFails,
        nextState: { failedAttempts: nextFails, cooldownUntil: 0 }
    };
}

/**
 * Escapes untrusted text before inserting into HTML templates.
 */
export function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
