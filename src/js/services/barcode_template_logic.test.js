import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_BARCODE_TEMPLATES,
    normalizeBarcodeTemplate,
    mergeTemplatesCatalog,
    resolveActiveBarcodeConfig,
    resolveBarcodeValue,
    buildLabelsToPrint,
    estimateLabelsCount,
    sortBarcodeModels,
    formatActiveTemplateSummary,
    escapePrintHtml
} from './barcode_template_logic.js';

test('normalizeBarcodeTemplate clamps bounds and applies defaults safely', () => {
    const normalized = normalizeBarcodeTemplate({
        name: '  قالب حراري  ',
        paperW: 50, // exceeds max 25
        paperH: 0.2, // below min 1.5
        fontName: 99, // exceeds 36
        fontCode: 2, // below 6
        codeType: 'invalid',
        qtyMode: 'by_color',
        fixedQty: 0, // below 1
        showPrice: false
    });

    assert.equal(normalized.name, 'قالب حراري');
    assert.equal(normalized.paperW, 25);
    assert.equal(normalized.paperH, 1.5);
    assert.equal(normalized.fontName, 36);
    assert.equal(normalized.fontCode, 6);
    assert.equal(normalized.codeType, 'barcode');
    assert.equal(normalized.qtyMode, 'by_color');
    assert.equal(normalized.fixedQty, 1);
    assert.equal(normalized.showPrice, false);
});

test('mergeTemplatesCatalog keeps system presets and merges custom templates', () => {
    const merged = mergeTemplatesCatalog({
        default_4_5: { name: 'Override Attempt', paperW: 99 },
        custom_123: { name: 'ستيكر خاص', paperW: 5, paperH: 4.6, codeType: 'qrcode' },
        corrupt_entry: 'not-an-object'
    });

    assert.equal(merged.default_4_5.paperW, 4);
    assert.equal(merged.small_3_4.paperH, 4);
    assert.equal(merged.qr_standard_5_5.codeType, 'qrcode');
    assert.equal(merged.custom_123.name, 'ستيكر خاص');
    assert.equal(merged.custom_123.paperW, 5);
    assert.equal(merged.custom_123.paperH, 4.6);
    assert.equal(merged.custom_123.codeType, 'qrcode');
    assert.equal(merged.corrupt_entry, undefined);
});

test('resolveActiveBarcodeConfig prioritizes explicit activeConfig, then activeTemplateId, then default_4_5', () => {
    const catalog = {
        custom_1: { ...DEFAULT_BARCODE_TEMPLATES.small_3_4, name: 'مقاس صغير مخصص' }
    };

    const byPreset = resolveActiveBarcodeConfig({
        templates: catalog,
        activeTemplateId: 'custom_1'
    });
    assert.equal(byPreset.paperW, 3);
    assert.equal(byPreset.paperH, 4);

    const byOverride = resolveActiveBarcodeConfig({
        templates: catalog,
        activeTemplateId: 'custom_1',
        activeConfig: { paperW: 5, paperH: 4.6, codeType: 'qrcode' }
    });
    assert.equal(byOverride.paperW, 5);
    assert.equal(byOverride.paperH, 4.6);
    assert.equal(byOverride.codeType, 'qrcode');

    const fallback = resolveActiveBarcodeConfig({});
    assert.equal(fallback.paperW, 4);
    assert.equal(fallback.paperH, 5);
});

test('resolveBarcodeValue handles factory, system, and url modes', () => {
    const model = { id: 'm1', factory_code: 'F204', system_code: 'SYS-9001' };

    assert.equal(resolveBarcodeValue(model, 'factory'), 'F204');
    assert.equal(resolveBarcodeValue(model, 'system'), 'S9001');
    assert.equal(
        resolveBarcodeValue(model, 'url', 'https://devo.example.com/'),
        'https://devo.example.com/?system=9001'
    );
});

test('buildLabelsToPrint handles skipZeroStockColors, by_color separate vs all_together, and sorting', () => {
    const models = [
        {
            id: 'm2',
            name: 'تيشيرت صيفي',
            factory_code: '20',
            system_code: '200',
            price: 150,
            classes: { class_sizes: [{ size_id: 's1' }, { size_id: 's2' }] },
            model_inventory: [
                { color_id: 'c1', available_series: 3, colors: { name: 'أحمر' } },
                { color_id: 'c2', available_series: 0, colors: { name: 'أسود' } },
                { color_id: 'c3', available_series: 2, colors: { name: 'أبيض' } }
            ]
        },
        {
            id: 'm1',
            name: 'بنطلون جينز',
            factory_code: '5',
            system_code: '100',
            price: 250,
            model_sizes: [{ size_id: 's2' }],
            model_inventory: [
                { color_id: 'c2', available_series: 0, colors: { name: 'أسود' } }
            ]
        }
    ];

    const sizesMap = { s1: 'M', s2: 'L' };
    const labels = buildLabelsToPrint(models, {
        ...DEFAULT_BARCODE_TEMPLATES.default_4_5,
        printSortOrder: 'factory_asc',
        qtyMode: 'by_color',
        fixedQty: 2,
        colorDist: 'separate',
        skipZeroStockColors: true
    }, { sizesMap });

    // m1 is skipped because all colors have 0 stock and skipZeroStockColors is true
    // m2 has 2 active colors * 2 copies = 4 labels
    assert.equal(labels.length, 4);
    assert.equal(labels[0].name, 'تيشيرت صيفي');
    assert.equal(labels[0].display_code, 'F20');
    assert.equal(labels[0].sizesStr, 'M، L');
    assert.equal(labels[0].colorStr, 'أحمر');
    assert.equal(labels[0].isSingleColor, true);
    assert.equal(labels[2].colorStr, 'أبيض');
});

test('sortBarcodeModels sorts numerically by factory_code without mutating source', () => {
    const src = [
        { id: '1', factory_code: '10' },
        { id: '2', factory_code: '2' },
        { id: '3', factory_code: 'F15' }
    ];
    const sorted = sortBarcodeModels(src, 'factory_asc');
    assert.deepEqual(sorted.map(x => x.id), ['2', '1', '3']);
    assert.deepEqual(src.map(x => x.id), ['1', '2', '3']);
});

test('estimateLabelsCount and formatActiveTemplateSummary and escapePrintHtml return expected values', () => {
    const est = estimateLabelsCount(
        [{ id: '1', model_inventory: [{ color_id: 'c1', available_series: 4, colors: { name: 'أزرق' } }] }],
        { qtyMode: 'fixed', fixedQty: 3 }
    );
    assert.equal(est.totalStickers, 3);
    assert.match(est.text, /3 ملصق/);

    const summary = formatActiveTemplateSummary({ paperW: 5, paperH: 4.6, codeType: 'qrcode', valueSource: 'system' }, 'قالب المعمل');
    assert.equal(summary, 'قالب المعمل · 5 × 4.6 سم · QR Code (كود السيستم)');

    assert.equal(escapePrintHtml('<script>"test"</script>'), '&lt;script&gt;&quot;test&quot;&lt;/script&gt;');
});
