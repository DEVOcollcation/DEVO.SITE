import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SETTLEMENT_REF_PREFIX,
    ARCHIVE_ORDER_SETTLEMENT_REF,
    LOCK_MODES,
    MAX_LOCK_ATTEMPTS,
    LOCK_COOLDOWN_MS,
    isSettlementMovement,
    isOrderArchiveSettlementMovement,
    isStockZeroSettlementMovement,
    filterExcludedSettlementMovements,
    computeAdminModalSoldMap,
    isInventorySyncMovement,
    isInventorySyncOutMovement,
    isInboundReversalOutMovement,
    isOrderReversalInMovement,
    extractInvoiceNumberFromMovement,
    classifyStockMovement,
    matchesHistoryFilter,
    computeMovementLogStats,
    buildSettlementReference,
    computeColorBaseStock,
    buildModelColorOffsetMap,
    buildSettlementPlan,
    buildOrderArchiveSettlementEntries,
    buildOrderRestoreStockDeltas,
    buildInboundDeductStockDeltas,
    filterModelsByHunter,
    appendPatternNode,
    serializePattern,
    validatePinFormat,
    validatePatternSequence,
    generateRandomSalt,
    hashLockSecret,
    constantTimeEqual,
    normalizeLockConfig,
    evaluateLockAttempt,
    escapeHtml
} from './data_management_logic.js';

// =========================================================================
// 1. BASE STOCK & SETTLEMENT EQUATION TESTS
// =========================================================================

test('Zeroing remaining 5 -> Excel import sets real 4 yields Base Stock = 24 (not 29) for Owner and Worker', () => {
    // User's exact scenario:
    // - 20 sold in invoices
    // - 5 remaining on system before zeroing
    // - Model zeroed to 0 (no settlement row recorded; even if a legacy [SETTLEMENT] row exists, it is ignored)
    // - Excel stock sheet uploaded with real physical count = 4 remaining
    // Expected Base Stock = 20 sold + 4 real remaining = 24 (NOT 20 + 5 + 4 = 29)
    const orderItems = [
        { color_id: 'c1', quantity: 20 }
    ];
    const allMovements = [
        { color_id: 'c1', movement_type: 'out', quantity: 20, order_id: null, reference: 'فاتورة مبيعات: 501' },
        // Legacy [SETTLEMENT] from prior model zeroing (must NOT inflate base stock!)
        { color_id: 'c1', movement_type: 'out', quantity: 5, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} تسوية وتصفير مخزون` },
        // Custom [SETTLEMENT] zeroing/waste reason (must NOT inflate base stock!)
        { color_id: 'c1', movement_type: 'out', quantity: 3, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} هالك` },
        // Subsequent ERP Excel import setting physical count to 4
        { color_id: 'c1', movement_type: 'in', quantity: 4, order_id: null, reference: 'مزامنة جرد ERP (تعديل رصيد)' }
    ];

    const ownerRes = buildModelColorOffsetMap({ orderItems, allMovements, orderItemsReliable: true });
    assert.equal(ownerRes.soldMap['c1'], 20);
    assert.equal(ownerRes.settledMap['c1'] || 0, 0);
    assert.equal(4 + (ownerRes.combined['c1'] || 0), 24);

    // Worker (order_items RLS-filtered to empty) must get the exact same 24
    const workerRes = buildModelColorOffsetMap({ orderItems: [], allMovements, orderItemsReliable: false });
    assert.equal(workerRes.soldMap['c1'], 20);
    assert.equal(workerRes.settledMap['c1'] || 0, 0);
    assert.equal(4 + (workerRes.combined['c1'] || 0), 24);
});

test('buildModelColorOffsetMap ignores ALL settlement rows (archived, audit, zeroing) and avoids double-counting', () => {
    const orderItems = [
        { color_id: 'c1', quantity: 50 },
        { color_id: 'c1', quantity: 30 }
    ];
    const allMovements = [
        // Regular order sale out movement (must NOT be double-counted with order_items!)
        { color_id: 'c1', movement_type: 'out', quantity: 80, order_id: 'ord-1', reference: 'فاتورة مبيعات: 101' },
        // Legacy stock-zeroing [SETTLEMENT] must be ignored
        { color_id: 'c1', movement_type: 'out', quantity: 20, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} تسوية وتصفير مخزون` },
        // Legacy archived deleted sales order [SETTLEMENT] must ALSO be ignored (Remaining + Sold ONLY!)
        { color_id: 'c2', movement_type: 'out', quantity: 15, order_id: null, reference: ARCHIVE_ORDER_SETTLEMENT_REF },
        // Legacy periodic audit settlement ('تسوية جرد دوري: ...') must ALSO be ignored
        { color_id: 'c2', movement_type: 'out', quantity: 9, order_id: null, reference: 'تسوية جرد دوري: AUD-2026' },
        // ERP inventory reduction 'out' must NOT count as a sale even for workers
        { color_id: 'c1', movement_type: 'out', quantity: 6, order_id: null, reference: 'مزامنة جرد ERP (تعديل رصيد)' }
    ];

    const ownerRes = buildModelColorOffsetMap({ orderItems, allMovements, orderItemsReliable: true });
    assert.equal(ownerRes.soldMap['c1'], 80);
    assert.equal(ownerRes.settledMap['c1'] || 0, 0);
    assert.equal(ownerRes.combined['c1'], 80);
    assert.equal(ownerRes.settledMap['c2'] || 0, 0);
    assert.equal(ownerRes.combined['c2'] || 0, 0);

    const workerRes = buildModelColorOffsetMap({ orderItems: [], allMovements, orderItemsReliable: false });
    assert.equal(workerRes.soldMap['c1'], 80);
    assert.equal(workerRes.settledMap['c2'] || 0, 0);
    assert.equal(workerRes.combined['c1'], 80);
    assert.equal(workerRes.combined['c2'] || 0, 0);
});

test('Owner with zero sold orders (orderItems=[]) keeps Base Stock = Remaining + 0 without falling back to stock_movements', () => {
    const allMovements = [
        { color_id: 'c1', movement_type: 'out', quantity: 12, order_id: null, reference: 'فاتورة مبيعات: 999' },
        { color_id: 'c1', movement_type: 'out', quantity: 5, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} تسوية وتصفير مخزون` }
    ];
    const ownerRes = buildModelColorOffsetMap({ orderItems: [], allMovements, orderItemsReliable: true });
    assert.deepEqual(ownerRes.soldMap, {});
    assert.deepEqual(ownerRes.settledMap, {});
    assert.deepEqual(ownerRes.combined, {});
});

test('computeColorBaseStock always computes Remaining + Sold ONLY and ignores any legacy settledSeries', () => {
    const res = computeColorBaseStock({ availableSeries: 10, soldSeries: 5, settledSeries: 99 });
    assert.deepEqual(res, { available: 10, sold: 5, settled: 0, baseStock: 15 });
});

test('buildModelColorOffsetMap computes full base stock for workers even when order_items is RLS-filtered to only worker orders', () => {
    // Reproduces model 7437 (25 initial per color: 6, 7, 11, 4 remaining)
    // Worker RLS returns ONLY the worker's own orders (4, 5, 3, 4) instead of full (19, 18, 14, 21)
    const rlsFilteredWorkerOrderItems = [
        { color_id: 'sakkari', quantity: 4 },
        { color_id: 'black', quantity: 5 },
        { color_id: 'basali', quantity: 3 },
        { color_id: 'nibiti', quantity: 4 }
    ];

    const allMovements = [
        // Full sales movements across owner + admin + workers
        { color_id: 'sakkari', movement_type: 'out', quantity: 15, order_id: null, reference: 'فاتورة مبيعات: 1001' },
        { color_id: 'sakkari', movement_type: 'out', quantity: 4, order_id: null, reference: 'فاتورة مبيعات: 1002' },
        { color_id: 'black', movement_type: 'out', quantity: 18, order_id: null, reference: 'فاتورة مبيعات: 1001' },
        { color_id: 'basali', movement_type: 'out', quantity: 17, order_id: null, reference: 'فاتورة مبيعات: 1001' },
        // Order edited down by 3 -> 'in' reversal must reduce net sold from 17 to 14
        { color_id: 'basali', movement_type: 'in', quantity: 3, order_id: null, reference: 'تعديل أوردر رقم 1001' },
        // Nibiti: sold 21 + deleted order of 5 ('out' 5 then 'in' 5) -> net sold 21
        { color_id: 'nibiti', movement_type: 'out', quantity: 21, order_id: null, reference: 'فاتورة مبيعات: 1001' },
        { color_id: 'nibiti', movement_type: 'out', quantity: 5, order_id: null, reference: 'فاتورة مبيعات: 1003' },
        { color_id: 'nibiti', movement_type: 'in', quantity: 5, order_id: null, reference: 'حذف أوردر من الإدارة: 1003' },
        // Inbound addition & inbound deletion must NOT distort sales
        { color_id: 'sakkari', movement_type: 'in', quantity: 25, order_id: null, reference: 'فاتورة دخل: IN-1' },
        { color_id: 'sakkari', movement_type: 'out', quantity: 2, order_id: null, reference: 'حذف فاتورة دخل: IN-2' },
        { color_id: 'black', movement_type: 'out', quantity: 1, order_id: null, reference: 'تعديل فاتورة دخل (تخفيض كمية): IN-3' },
        // Legacy periodic audit or zeroing settlements must NOT distort sales
        { color_id: 'sakkari', movement_type: 'out', quantity: 8, order_id: null, reference: 'تسوية جرد دوري: AUD-1' },
        { color_id: 'nibiti', movement_type: 'out', quantity: 9, order_id: null, reference: ARCHIVE_ORDER_SETTLEMENT_REF }
    ];

    const workerRes = buildModelColorOffsetMap({
        orderItems: rlsFilteredWorkerOrderItems,
        allMovements,
        orderItemsReliable: false
    });

    assert.equal(6 + (workerRes.combined['sakkari'] || 0), 25);
    assert.equal(7 + (workerRes.combined['black'] || 0), 25);
    assert.equal(11 + (workerRes.combined['basali'] || 0), 25);
    assert.equal(4 + (workerRes.combined['nibiti'] || 0), 25);
});

test('Movement classifiers classify ALL settlements, ERP syncs, and reversals strictly', () => {
    assert.equal(isSettlementMovement({ movement_type: 'out', order_id: null, reference: '[SETTLEMENT] تسوية' }), true);
    assert.equal(isSettlementMovement({ movement_type: 'out', order_id: 'ord-1', reference: '[SETTLEMENT] تسوية' }), true);
    assert.equal(isSettlementMovement({ movement_type: 'in', order_id: null, reference: '[SETTLEMENT] تسوية' }), true);
    assert.equal(isSettlementMovement({ movement_type: 'in', order_id: null, reference: 'تسوية جرد دوري: AUD-1' }), true);
    assert.equal(isSettlementMovement({ movement_type: 'out', order_id: null, reference: ARCHIVE_ORDER_SETTLEMENT_REF }), true);
    assert.equal(isSettlementMovement({ movement_type: 'out', order_id: null, reference: 'فاتورة بيع' }), false);

    assert.equal(isOrderArchiveSettlementMovement({ movement_type: 'out', order_id: null, reference: ARCHIVE_ORDER_SETTLEMENT_REF }), false);
    assert.equal(isOrderArchiveSettlementMovement({ movement_type: 'out', order_id: null, reference: '[SETTLEMENT] تسوية وتصفير مخزون' }), false);

    assert.equal(isInventorySyncOutMovement({ movement_type: 'out', reference: 'مزامنة جرد ERP (تعديل رصيد)' }), true);
    assert.equal(isInventorySyncOutMovement({ movement_type: 'out', reference: 'تعديل رصيد يدوي (إدارة البيانات)' }), true);
    assert.equal(isInventorySyncOutMovement({ movement_type: 'in', reference: 'مزامنة جرد ERP (تعديل رصيد)' }), false);
    assert.equal(isInventorySyncOutMovement({ movement_type: 'out', reference: 'فاتورة مبيعات: 105' }), false);

    assert.equal(isInboundReversalOutMovement({ movement_type: 'out', reference: 'حذف فاتورة دخل: IN-5' }), true);
    assert.equal(isInboundReversalOutMovement({ movement_type: 'out', reference: 'تعديل فاتورة دخل (تخفيض كمية): IN-5' }), true);
    assert.equal(isInboundReversalOutMovement({ movement_type: 'out', reference: 'فاتورة مبيعات: 105' }), false);

    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'تعديل أوردر رقم 105' }), true);
    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'حذف أوردر من الإدارة: 105' }), true);
    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'استرجاع رصيد عند حذف فواتير مبيعات (إدارة البيانات)' }), true);
    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'فاتورة دخل: IN-1' }), false);

    assert.equal(isStockZeroSettlementMovement({ movement_type: 'out', order_id: null, reference: '[SETTLEMENT] تسوية وتصفير مخزون' }), true);
    assert.equal(isStockZeroSettlementMovement({ movement_type: 'out', order_id: null, reference: '[SETTLEMENT] هالك' }), true);
    assert.equal(isStockZeroSettlementMovement({ movement_type: 'out', order_id: null, reference: ARCHIVE_ORDER_SETTLEMENT_REF }), true);
    assert.equal(isStockZeroSettlementMovement({ movement_type: 'out', order_id: null, reference: 'تسوية جرد دوري: AUD-1' }), true);
    assert.equal(isStockZeroSettlementMovement({ movement_type: 'out', order_id: null, reference: 'فاتورة مبيعات: 105' }), false);
});

test('filterExcludedSettlementMovements and computeAdminModalSoldMap exclude ALL settlement rows cleanly', () => {
    const movements = [
        { id: '1', color_id: 'c1', movement_type: 'in', quantity: 25, order_id: null, reference: 'فاتورة دخل: IN-1' },
        { id: '2', color_id: 'c1', movement_type: 'out', quantity: 10, order_id: 'ord-1', reference: 'فاتورة مبيعات: 100' },
        { id: '3', color_id: 'c1', movement_type: 'out', quantity: 5, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} تسوية وتصفير مخزون` },
        { id: '4', color_id: 'c2', movement_type: 'out', quantity: 3, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} هالك` },
        { id: '5', color_id: 'c2', movement_type: 'out', quantity: 7, order_id: null, reference: ARCHIVE_ORDER_SETTLEMENT_REF },
        { id: '6', color_id: 'c1', movement_type: 'out', quantity: 2, order_id: null, reference: 'مزامنة جرد ERP (تعديل رصيد)' },
        { id: '7', color_id: 'c1', movement_type: 'out', quantity: 1, order_id: null, reference: 'حذف فاتورة دخل: IN-2' },
        { id: '8', color_id: 'c2', movement_type: 'out', quantity: 4, order_id: null, reference: 'تسوية جرد دوري: AUD-1' }
    ];

    const visibleLog = filterExcludedSettlementMovements(movements);
    assert.deepEqual(visibleLog.map(m => m.id), ['1', '2', '6', '7']);

    const outMovs = movements.filter(m => m.movement_type === 'out');
    const soldMap = computeAdminModalSoldMap(outMovs);
    assert.equal(soldMap['c1'], 10);
    assert.equal(soldMap['c2'] || 0, 0);
});

test('buildSettlementPlan creates exact model_inventory updates without emitting stock_movements rows and supports color filter scope', () => {
    const models = [
        {
            id: 'm1', name: 'طقم شتوي', factory_code: '101',
            model_inventory: [
                { id: 'inv1', color_id: 'c1', available_series: 20, colors: { name: 'أسود' } },
                { id: 'inv2', color_id: 'c2', available_series: 0, colors: { name: 'أبيض' } },
                { id: 'inv3', color_id: 'c3', available_series: 12, colors: { name: 'كحلي' } }
            ]
        }
    ];

    // Full zeroing across all colors (skips c2 which is already 0, emits NO movements)
    const fullPlan = buildSettlementPlan(models, { targetQty: 0 });
    assert.equal(fullPlan.summary.modelsAffected, 1);
    assert.equal(fullPlan.summary.colorRowsAffected, 2);
    assert.equal(fullPlan.summary.totalSeriesSettled, 32);
    assert.equal(fullPlan.movements.length, 0);
    assert.deepEqual(fullPlan.updates.map(u => u.new_series), [0, 0]);

    // Scoped to color c3 only
    const colorPlan = buildSettlementPlan(models, { targetQty: 0, onlyColorIds: ['c3'] });
    assert.equal(colorPlan.summary.colorRowsAffected, 1);
    assert.equal(colorPlan.summary.totalSeriesSettled, 12);
    assert.equal(colorPlan.updates[0].color_id, 'c3');
    assert.equal(colorPlan.movements.length, 0);

    // Partial adjustment to target 5 on c1 (20 -> 5 = 15 reduced, emits NO movements)
    const partialPlan = buildSettlementPlan(models, { targetQty: 5, onlyColorIds: ['c1'] });
    assert.equal(partialPlan.updates[0].new_series, 5);
    assert.equal(partialPlan.summary.totalSeriesSettled, 15);
    assert.equal(partialPlan.movements.length, 0);

    // Increasing stock from 0 -> 4 on c2 when onlyDecrease is false
    const addPlan = buildSettlementPlan(models, { targetQty: 4, onlyDecrease: false, onlyColorIds: ['c2'] });
    assert.equal(addPlan.updates[0].new_series, 4);
    assert.equal(addPlan.summary.totalSeriesAdded, 4);
    assert.equal(addPlan.movements.length, 0);
});

test('Order deletion helpers emit NO archive settlement entries while preserving restore stock deltas', () => {
    const items = [
        { model_id: 'm1', color_id: 'c1', quantity: 50 },
        { model_id: 'm1', color_id: 'c1', quantity: 30 },
        { model_id: 'm2', color_id: 'c2', quantity: 10 },
        { model_id: null, color_id: 'c2', quantity: 5 }
    ];

    const archived = buildOrderArchiveSettlementEntries(items);
    assert.deepEqual(archived, []);

    const restored = buildOrderRestoreStockDeltas(items);
    assert.equal(restored.length, 2);
    assert.equal(restored.find(r => r.model_id === 'm1').restoreQty, 80);
});

test('Inbound invoice deduction clamps stock cleanly at 0 without negative values', () => {
    const inboundItems = [
        { model_id: 'm1', color_id: 'c1', quantity: 30 },
        { model_id: 'm1', color_id: 'c2', quantity: 25 }
    ];
    const currentMap = new Map([
        ['m1::c1', 50],
        ['m1::c2', 10]
    ]);
    const deltas = buildInboundDeductStockDeltas(inboundItems, currentMap);
    assert.equal(deltas.find(d => d.color_id === 'c1').newQty, 20);
    assert.equal(deltas.find(d => d.color_id === 'c2').newQty, 0);
    assert.equal(deltas.find(d => d.color_id === 'c2').actualDeducted, 10);
});

// =========================================================================
// 2. MODEL HUNTER FILTER ENGINE TESTS
// =========================================================================

test('filterModelsByHunter matches name, factory range, include/exclude categories & colors, stock op, price & dates', () => {
    const sampleModels = [
        {
            id: '1', name: 'جاكيت جلد', factory_code: '105', system_code: 'SYS-1',
            category_id: 'cat-a', class_id: 'cls-1', is_active: true, price: 450,
            created_at: '2026-08-10T10:00:00Z',
            model_inventory: [{ color_id: 'black', available_series: 20 }],
            classes: { class_sizes: [{ size_id: 'L' }] }, model_sizes: []
        },
        {
            id: '2', name: 'بنطلون جينز', factory_code: '220', system_code: 'SYS-2',
            category_id: 'cat-b', class_id: 'cls-2', is_active: false, price: 250,
            created_at: '2026-09-05T10:00:00Z',
            model_inventory: [{ color_id: 'blue', available_series: 0 }],
            classes: { class_sizes: [{ size_id: 'M' }] }, model_sizes: []
        }
    ];

    assert.equal(filterModelsByHunter(sampleModels, { factoryFrom: '100', factoryTo: '150' }).length, 1);
    assert.equal(filterModelsByHunter(sampleModels, { selectedCats: ['cat-a'], isCatExclude: true })[0].id, '2');
    assert.equal(filterModelsByHunter(sampleModels, { stockOp: 'greater', stockQty: 0 })[0].id, '1');
    assert.equal(filterModelsByHunter(sampleModels, { stockOp: 'equal', stockQty: 0 })[0].id, '2');
    assert.equal(filterModelsByHunter(sampleModels, { selectedColors: ['black'] })[0].id, '1');
    assert.equal(filterModelsByHunter(sampleModels, { selectedSizes: ['M'] })[0].id, '2');
    assert.equal(filterModelsByHunter(sampleModels, { minPrice: 300, maxPrice: 500 })[0].id, '1');
    assert.equal(filterModelsByHunter(sampleModels, { status: 'false' })[0].id, '2');
    assert.equal(filterModelsByHunter(sampleModels, { dateFrom: '2026-09-01' })[0].id, '2');
});

// =========================================================================
// 3. SETTINGS LOCK (PIN + 9-DOT PATTERN) SECURITY TESTS
// =========================================================================

test('9-dot pattern interpolation auto-inserts collinear midpoints and ignores duplicates', () => {
    // Horizontal jump 0 -> 2 auto-inserts 1
    assert.deepEqual(appendPatternNode([0], 2), [0, 1, 2]);
    // Diagonal jump 0 -> 8 auto-inserts 4
    assert.deepEqual(appendPatternNode([0], 8), [0, 4, 8]);
    // Reverse diagonal 2 -> 6 auto-inserts 4
    assert.deepEqual(appendPatternNode([2], 6), [2, 4, 6]);
    // Vertical jump 1 -> 7 auto-inserts 4
    assert.deepEqual(appendPatternNode([1], 7), [1, 4, 7]);
    // Duplicate ignored
    assert.deepEqual(appendPatternNode([0, 1, 2], 1), [0, 1, 2]);
    // Out of bounds ignored
    assert.deepEqual(appendPatternNode([0], 9), [0]);

    assert.equal(validatePatternSequence([0, 1, 2]), false); // < 4 dots
    assert.equal(validatePatternSequence([0, 1, 2, 5]), true);
    assert.equal(serializePattern([0, 1, 2, 5]), '0-1-2-5');
});

test('PIN validation, salted PBKDF2 hashing, config normalization, and cooldown state machine work securely', async () => {
    assert.equal(validatePinFormat('123'), false);
    assert.equal(validatePinFormat('1234'), true);
    assert.equal(validatePinFormat('12345678'), true);
    assert.equal(validatePinFormat('123456789'), false);
    assert.equal(validatePinFormat('12ab'), false);

    const salt = generateRandomSalt();
    assert.equal(salt.length, 32);

    const pinHash = await hashLockSecret('2580', salt, 'pin');
    const pinHashSame = await hashLockSecret('2580', salt, 'pin');
    const pinHashDiff = await hashLockSecret('0852', salt, 'pin');
    const patternHash = await hashLockSecret('0-1-2-5-8', salt, 'pattern');

    assert.equal(pinHash.length, 64);
    assert.equal(constantTimeEqual(pinHash, pinHashSame), true);
    assert.equal(constantTimeEqual(pinHash, pinHashDiff), false);

    const config = normalizeLockConfig(JSON.stringify({
        enabled: true,
        mode: LOCK_MODES.EITHER,
        salt,
        pinHash,
        patternHash,
        autoLockMinutes: 15
    }));
    assert.ok(config);
    assert.equal(config.mode, LOCK_MODES.EITHER);
    assert.equal(config.autoLockMinutes, 15);

    // Missing required hash for BOTH mode rejects config
    assert.equal(normalizeLockConfig({ enabled: true, mode: LOCK_MODES.BOTH, salt, pinHash, patternHash: null }), null);

    // Rate-limit cooldown after MAX_LOCK_ATTEMPTS failures
    let state = { failedAttempts: 0, cooldownUntil: 0 };
    const t0 = 1_700_000_000_000;
    for (let i = 1; i < MAX_LOCK_ATTEMPTS; i++) {
        const res = evaluateLockAttempt(state, false, t0);
        assert.equal(res.lockedOut, false);
        assert.equal(res.attemptsLeft, MAX_LOCK_ATTEMPTS - i);
        state = res.nextState;
    }
    const triggerRes = evaluateLockAttempt(state, false, t0);
    assert.equal(triggerRes.lockedOut, true);
    assert.equal(triggerRes.remainingSeconds, Math.ceil(LOCK_COOLDOWN_MS / 1000));

    // Attempt during cooldown stays blocked even if secret is right
    const duringCooldown = evaluateLockAttempt(triggerRes.nextState, true, t0 + 5000);
    assert.equal(duringCooldown.allowed, false);
    assert.equal(duringCooldown.lockedOut, true);

    // Attempt after cooldown succeeds and resets
    const afterCooldown = evaluateLockAttempt(triggerRes.nextState, true, t0 + LOCK_COOLDOWN_MS + 1);
    assert.equal(afterCooldown.allowed, true);
    assert.equal(afterCooldown.nextState.failedAttempts, 0);
});

test('escapeHtml neutralizes HTML special characters', () => {
    assert.equal(escapeHtml('<script>"alert(\'x\')&"</script>'), '&lt;script&gt;&quot;alert(&#39;x&#39;)&amp;&quot;&lt;/script&gt;');
});

// =========================================================================
// 4. MOVEMENT LOG CLASSIFICATION, ERP/EXCEL SEPARATION & FILTER-REACTIVE STATS
// =========================================================================

test('classifyStockMovement never classifies ERP/Excel adjustments as sales and extracts invoice numbers accurately', () => {
    const erpOut = classifyStockMovement({
        movement_type: 'out',
        quantity: 2,
        order_id: null,
        reference: 'مزامنة جرد ERP (تعديل رصيد)'
    });
    assert.equal(erpOut.category, 'erp_sync');
    assert.equal(erpOut.isSale, false);
    assert.equal(erpOut.isErpSync, true);
    assert.equal(erpOut.label, 'تعديل جرد (إكسيل -)');
    assert.equal(erpOut.invoiceNumber, null);

    const erpIn = classifyStockMovement({
        movement_type: 'in',
        quantity: 5,
        order_id: null,
        reference: 'مزامنة جرد ERP (تعديل رصيد)'
    });
    assert.equal(erpIn.category, 'erp_sync');
    assert.equal(erpIn.isSale, false);
    assert.equal(erpIn.label, 'تعديل جرد (إكسيل +)');

    const saleMov = classifyStockMovement({
        movement_type: 'out',
        quantity: 1,
        order_id: null,
        reference: 'فاتورة مبيعات: 563'
    });
    assert.equal(saleMov.category, 'sale');
    assert.equal(saleMov.isSale, true);
    assert.equal(saleMov.invoiceNumber, '563');

    const orderReturn = classifyStockMovement({
        movement_type: 'in',
        quantity: 2,
        order_id: 'ord-560',
        reference: 'تعديل أوردر رقم 560'
    });
    assert.equal(orderReturn.category, 'order_return');
    assert.equal(orderReturn.isSale, false);
    assert.equal(orderReturn.isOrderReturn, true);
    assert.equal(orderReturn.invoiceNumber, '560');

    // Inbound invoice must NEVER match as a customer sales invoice number
    assert.equal(extractInvoiceNumberFromMovement({
        movement_type: 'in',
        reference: 'فاتورة دخل: IN-900'
    }), null);

    assert.equal(isInventorySyncMovement({
        movement_type: 'out',
        order_id: null,
        reference: 'تعديل من شيت الإكسيل'
    }), true);
});

test('computeMovementLogStats & matchesHistoryFilter recalculate stats live based on active filters and exclude ERP from sales', () => {
    const movements = [
        { id: '1', color_id: 'tubi', movement_type: 'out', quantity: 2, order_id: null, reference: 'مزامنة جرد ERP (تعديل رصيد)', created_at: '2026-11-27T15:08:00Z', colors: { name: 'طوبي' } },
        { id: '2', color_id: 'tubi', movement_type: 'out', quantity: 1, order_id: null, reference: 'فاتورة مبيعات: 563', created_at: '2026-11-27T12:23:00Z', colors: { name: 'طوبي' }, orders: { customer_name: 'عميل 563' } },
        { id: '3', color_id: 'tubi', movement_type: 'out', quantity: 1, order_id: null, reference: 'فاتورة مبيعات: 560', created_at: '2026-11-27T06:55:00Z', colors: { name: 'طوبي' } },
        { id: '4', color_id: 'tubi', movement_type: 'out', quantity: 2, order_id: null, reference: 'فاتورة مبيعات: 557', created_at: '2026-11-27T06:34:00Z', colors: { name: 'طوبي' } },
        { id: '5', color_id: 'beige', movement_type: 'in', quantity: 10, order_id: null, reference: 'فاتورة دخل: IN-12', created_at: '2026-11-26T10:00:00Z', colors: { name: 'بيج' } },
        { id: '6', color_id: 'beige', movement_type: 'in', quantity: 1, order_id: 'o-1', reference: 'تعديل أوردر رقم 560', created_at: '2026-11-27T07:00:00Z', colors: { name: 'بيج' } }
    ];

    // Unfiltered (sizesCount = 4):
    // Sales = 1 + 1 + 2 = 4 series (16 pcs, 3 invoices) — excludes the 2-series ERP sync!
    // Inbound/Return = 10 + 1 = 11 series (44 pcs, 2 ops)
    // ERP Sync = 1 op (-2 series)
    const allStats = computeMovementLogStats(movements, 4);
    assert.equal(allStats.totalCount, 6);
    assert.equal(allStats.salesCount, 3);
    assert.equal(allStats.salesSeries, 4);
    assert.equal(allStats.salesPieces, 16);
    assert.equal(allStats.inboundCount, 2);
    assert.equal(allStats.inboundSeries, 11);
    assert.equal(allStats.inboundPieces, 44);
    assert.equal(allStats.erpSyncCount, 1);
    assert.equal(allStats.erpSyncOutSeries, 2);
    assert.equal(allStats.erpSyncNetSeries, -2);

    // Filter to color = 'tubi' & type = 'sale': excludes ERP row & beige rows
    const tubiSalesOnly = movements.filter(m => matchesHistoryFilter(m, { colorId: 'tubi', type: 'sale' }));
    assert.equal(tubiSalesOnly.length, 3);
    const tubiSalesStats = computeMovementLogStats(tubiSalesOnly, 4);
    assert.equal(tubiSalesStats.totalCount, 3);
    assert.equal(tubiSalesStats.salesSeries, 4);
    assert.equal(tubiSalesStats.erpSyncCount, 0);

    // Filter by invoice search '563'
    const search563 = movements.filter(m => matchesHistoryFilter(m, { term: '563' }));
    assert.equal(search563.length, 1);
    assert.equal(computeMovementLogStats(search563, 4).salesSeries, 1);

    // Filter to ERP sync only
    const erpOnly = movements.filter(m => matchesHistoryFilter(m, { type: 'erp_sync' }));
    assert.equal(erpOnly.length, 1);
    const erpStats = computeMovementLogStats(erpOnly, 4);
    assert.equal(erpStats.salesSeries, 0);
    assert.equal(erpStats.erpSyncOutSeries, 2);
});

test('Excel/ERP stock adjustments (both in and out) never enter Base Stock for Owner or Worker', () => {
    // Remaining in inventory after Excel upload = 9
    // Real customer invoices sold = 4
    // Excel sync added +3 earlier and subtracted -2 later -> total Base Stock MUST remain 9 + 4 = 13!
    const allMovements = [
        { color_id: 'tubi', movement_type: 'in', quantity: 3, order_id: null, reference: 'مزامنة جرد ERP (تعديل رصيد)' },
        { color_id: 'tubi', movement_type: 'out', quantity: 2, order_id: null, reference: 'مزامنة جرد ERP (تعديل رصيد)' },
        { color_id: 'tubi', movement_type: 'out', quantity: 4, order_id: null, reference: 'فاتورة مبيعات: 563' }
    ];

    const ownerMap = buildModelColorOffsetMap({
        orderItems: [{ color_id: 'tubi', quantity: 4 }],
        allMovements,
        orderItemsReliable: true
    });
    const workerMap = buildModelColorOffsetMap({
        orderItems: [],
        allMovements,
        orderItemsReliable: false
    });

    assert.equal(9 + (ownerMap.combined['tubi'] || 0), 13);
    assert.equal(9 + (workerMap.combined['tubi'] || 0), 13);
});

