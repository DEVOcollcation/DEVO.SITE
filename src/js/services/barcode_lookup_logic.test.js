import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCodeString,
  isUuid,
  parseScannedBarcode,
  buildSupabaseCodeFilter,
  buildSupabaseFallbackCodeFilter,
  canViewInactiveModel,
  pickBestMatchedModel,
  classifyBarcodeLookupResult,
  computeModelStockSummary
} from './barcode_lookup_logic.js';

test('normalizeCodeString converts Arabic-Indic digits and trims whitespace', () => {
  assert.equal(normalizeCodeString('  ٤٠٥ '), '405');
  assert.equal(normalizeCodeString('F-١٢٣٠'), 'F-1230');
  assert.equal(normalizeCodeString(null), '');
});

test('isUuid validates UUIDs strictly and rejects numeric or alphanumeric model codes', () => {
  assert.equal(isUuid('550e8400-e29b-41d4-a716-446655440000'), true);
  assert.equal(isUuid('405'), false);
  assert.equal(isUuid('DV-405'), false);
  assert.equal(isUuid('s550e8400'), false);
});

test('parseScannedBarcode handles prefixes, URLs, quotes, and UUIDs without mangling', () => {
  assert.deepEqual(parseScannedBarcode('F-405'), { cleanCode: '405', explicitType: 'factory' });
  assert.deepEqual(parseScannedBarcode('SYS-9012'), { cleanCode: '9012', explicitType: 'system' });
  assert.deepEqual(parseScannedBarcode('S1025'), { cleanCode: '1025', explicitType: 'system' });
  assert.deepEqual(parseScannedBarcode('f٤٠٢'), { cleanCode: '402', explicitType: 'factory' });
  assert.deepEqual(
    parseScannedBarcode('https://devo.app/?factory=778'),
    { cleanCode: '778', explicitType: 'factory' }
  );
  // A UUID starting with "f" must NOT lose its leading "f"
  assert.deepEqual(
    parseScannedBarcode('f50e8400-e29b-41d4-a716-446655440000'),
    { cleanCode: 'f50e8400-e29b-41d4-a716-446655440000', explicitType: null }
  );
});

test('buildSupabaseCodeFilter omits id.eq for non-UUID codes to prevent Postgres 22P02 errors', () => {
  assert.equal(
    buildSupabaseCodeFilter('405', null, 'both'),
    'factory_code.ilike.405,system_code.ilike.405'
  );
  assert.equal(
    buildSupabaseCodeFilter('405', 'system', 'both'),
    'system_code.ilike.405'
  );
  assert.equal(
    buildSupabaseCodeFilter('405', 'factory', 'both'),
    'factory_code.ilike.405'
  );
  const uuid = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(
    buildSupabaseCodeFilter(uuid, null, 'both'),
    `factory_code.ilike.${uuid},system_code.ilike.${uuid},id.eq.${uuid}`
  );
  assert.equal(
    buildSupabaseFallbackCodeFilter('DV-405'),
    'factory_code.ilike.DV-405,system_code.ilike.DV-405'
  );
});

test('canViewInactiveModel grants access strictly to logged-in staff accounts and denies visitors', () => {
  assert.equal(canViewInactiveModel(true), true);
  assert.equal(canViewInactiveModel(false), false);
  assert.equal(canViewInactiveModel(null), false);
  assert.equal(canViewInactiveModel({ isVisitor: true }), false);
  assert.equal(canViewInactiveModel({ id: 'u1', role: 'worker' }), true);
  assert.equal(canViewInactiveModel({ id: 'u2', role: 'sales' }), true);
  assert.equal(canViewInactiveModel({ id: 'u3', role: 'admin' }), true);
  assert.equal(canViewInactiveModel({ id: 'u4', role: 'owner' }), true);
});

test('classifyBarcodeLookupResult distinguishes active, inactive (staff-only), and not_found', () => {
  const activeModel = { id: 'm1', name: 'ترنج شتوي', is_active: true };
  const inactiveModel = { id: 'm2', name: 'موديل قديم', is_active: false };

  assert.equal(classifyBarcodeLookupResult(activeModel, true).status, 'found_active');
  assert.equal(classifyBarcodeLookupResult(activeModel, false).status, 'found_active');
  assert.equal(classifyBarcodeLookupResult(inactiveModel, true).status, 'found_inactive');
  assert.equal(classifyBarcodeLookupResult(inactiveModel, false).status, 'not_found');
  assert.equal(classifyBarcodeLookupResult(null, true).status, 'not_found');
});

test('pickBestMatchedModel prioritizes active models when multiple rows match', () => {
  const inactive = { id: 'm-old', is_active: false };
  const active = { id: 'm-new', is_active: true };
  assert.equal(pickBestMatchedModel([inactive, active]).id, 'm-new');
  assert.equal(pickBestMatchedModel([inactive]).id, 'm-old');
  assert.equal(pickBestMatchedModel([]), null);
});

test('computeModelStockSummary aggregates remaining, base stock, and per-color states accurately', () => {
  const model = {
    model_inventory: [
      { color_id: 'c1', available_series: 12, colors: { name: 'أسود' } },
      { color_id: 'c2', available_series: 0, colors: { name: 'رمادي' } }
    ]
  };
  const salesMap = { c1: 28, c2: 20 };
  const summary = computeModelStockSummary(model, salesMap);

  assert.equal(summary.totalRemaining, 12);
  assert.equal(summary.totalBase, 60);
  assert.equal(summary.totalColors, 2);
  assert.equal(summary.availableColorsCount, 1);
  assert.deepEqual(summary.colors[0], {
    colorId: 'c1',
    colorName: 'أسود',
    remaining: 12,
    baseStock: 40,
    soldAndSettled: 28,
    isOut: false
  });
  assert.deepEqual(summary.colors[1], {
    colorId: 'c2',
    colorName: 'رمادي',
    remaining: 0,
    baseStock: 20,
    soldAndSettled: 20,
    isOut: true
  });
});
