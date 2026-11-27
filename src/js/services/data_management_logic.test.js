import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SETTLEMENT_REF_PREFIX,
    LOCK_MODES,
    MAX_LOCK_ATTEMPTS,
    LOCK_COOLDOWN_MS,
    isSettlementMovement,
    isInboundReversalOutMovement,
    isOrderReversalInMovement,
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
// 1. BASE STOCK & SETTLEMENT EQUATION TESTS (User's exact 100 -> 80 -> 20 -> 0 -> +40 scenario)
// =========================================================================

test('Base Stock equation preserves original 100 when settling remaining 20 to 0 and scales when adding +40 later', () => {
    // Initial: 100 manufactured, 0 sold, 0 settled
    assert.deepEqual(computeColorBaseStock({ availableSeries: 100, soldSeries: 0, settledSeries: 0 }), {
        available: 100, sold: 0, settled: 0, baseStock: 100
    });

    // Sold 80 -> remaining 20, base still 100
    assert.deepEqual(computeColorBaseStock({ availableSeries: 20, soldSeries: 80, settledSeries: 0 }), {
        available: 20, sold: 80, settled: 0, baseStock: 100
    });

    // Zeroed remaining 20 via Data Management -> remaining 0, sold 80, settled 20 => base STILL 100!
    assert.deepEqual(computeColorBaseStock({ availableSeries: 0, soldSeries: 80, settledSeries: 20 }), {
        available: 0, sold: 80, settled: 20, baseStock: 100
    });

    // Later inbound batch +40 -> remaining 40, sold 80, settled 20 => base 140!
    assert.deepEqual(computeColorBaseStock({ availableSeries: 40, soldSeries: 80, settledSeries: 20 }), {
        available: 40, sold: 80, settled: 20, baseStock: 140
    });
});

test('buildModelColorOffsetMap combines order_items sales and [SETTLEMENT] movements without double-counting regular out movements', () => {
    const orderItems = [
        { color_id: 'c1', quantity: 50 },
        { color_id: 'c1', quantity: 30 }
    ];
    const outMovements = [
        // Regular order sale out movement (must NOT be double-counted with order_items!)
        { color_id: 'c1', movement_type: 'out', quantity: 80, order_id: 'ord-1', reference: 'فاتورة بيع #101' },
        // Settlement movement from zeroing remaining 20
        { color_id: 'c1', movement_type: 'out', quantity: 20, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} تسوية وتصفير مخزون` },
        // Another color with only settlement (no sales yet)
        { color_id: 'c2', movement_type: 'out', quantity: 15, order_id: null, reference: `${SETTLEMENT_REF_PREFIX} هالك` }
    ];

    const res = buildModelColorOffsetMap({ orderItems, outMovements });
    assert.equal(res.soldMap['c1'], 80);
    assert.equal(res.settledMap['c1'], 20);
    assert.equal(res.combined['c1'], 100);
    assert.equal(res.combined['c2'], 15);

    // Remaining 0 + combined 100 => baseStock 100
    assert.equal(0 + res.combined['c1'], 100);
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
        { color_id: 'black', movement_type: 'out', quantity: 1, order_id: null, reference: 'تعديل فاتورة دخل (تخفيض كمية): IN-3' }
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

test('isSettlementMovement, isInboundReversalOutMovement, and isOrderReversalInMovement classify movements strictly', () => {
    assert.equal(isSettlementMovement({ movement_type: 'out', order_id: null, reference: '[SETTLEMENT] تسوية' }), true);
    assert.equal(isSettlementMovement({ movement_type: 'out', order_id: 'ord-1', reference: '[SETTLEMENT] تسوية' }), false);
    assert.equal(isSettlementMovement({ movement_type: 'in', order_id: null, reference: '[SETTLEMENT] تسوية' }), false);
    assert.equal(isSettlementMovement({ movement_type: 'out', order_id: null, reference: 'فاتورة بيع' }), false);

    assert.equal(isInboundReversalOutMovement({ movement_type: 'out', reference: 'حذف فاتورة دخل: IN-5' }), true);
    assert.equal(isInboundReversalOutMovement({ movement_type: 'out', reference: 'تعديل فاتورة دخل (تخفيض كمية): IN-5' }), true);
    assert.equal(isInboundReversalOutMovement({ movement_type: 'out', reference: 'فاتورة مبيعات: 105' }), false);

    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'تعديل أوردر رقم 105' }), true);
    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'حذف أوردر من الإدارة: 105' }), true);
    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'استرجاع رصيد عند حذف فواتير مبيعات (إدارة البيانات)' }), true);
    assert.equal(isOrderReversalInMovement({ movement_type: 'in', reference: 'فاتورة دخل: IN-1' }), false);
});

test('buildSettlementPlan creates exact updates and [SETTLEMENT] movements and supports color filter scope', () => {
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

    // Full zeroing across all colors (skips c2 which is already 0)
    const fullPlan = buildSettlementPlan(models, { targetQty: 0, reason: 'جرد نهاية الموسم' });
    assert.equal(fullPlan.summary.modelsAffected, 1);
    assert.equal(fullPlan.summary.colorRowsAffected, 2);
    assert.equal(fullPlan.summary.totalSeriesSettled, 32);
    assert.equal(fullPlan.movements.length, 2);
    assert.ok(fullPlan.movements.every(m => isSettlementMovement(m)));
    assert.equal(fullPlan.movements[0].reference, buildSettlementReference('جرد نهاية الموسم', 'zero'));

    // Scoped to color c3 only
    const colorPlan = buildSettlementPlan(models, { targetQty: 0, onlyColorIds: ['c3'] });
    assert.equal(colorPlan.summary.colorRowsAffected, 1);
    assert.equal(colorPlan.summary.totalSeriesSettled, 12);
    assert.equal(colorPlan.updates[0].color_id, 'c3');

    // Partial settlement to target 5 on c1 (20 -> 5 = 15 settled)
    const partialPlan = buildSettlementPlan(models, { targetQty: 5, onlyColorIds: ['c1'] });
    assert.equal(partialPlan.updates[0].new_series, 5);
    assert.equal(partialPlan.movements[0].quantity, 15);
    assert.equal(partialPlan.movements[0].movement_type, 'out');
});

test('Order deletion helpers correctly build archive settlement entries and restore stock deltas', () => {
    const items = [
        { model_id: 'm1', color_id: 'c1', quantity: 50 },
        { model_id: 'm1', color_id: 'c1', quantity: 30 },
        { model_id: 'm2', color_id: 'c2', quantity: 10 },
        { model_id: null, color_id: 'c2', quantity: 5 }
    ];

    const archived = buildOrderArchiveSettlementEntries(items);
    assert.equal(archived.length, 2);
    const m1Entry = archived.find(e => e.model_id === 'm1');
    assert.equal(m1Entry.quantity, 80);
    assert.equal(isSettlementMovement(m1Entry), true);

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
