import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSemver,
  compareSemver,
  isNewerVersion,
  normalizeVersionManifest,
  appendUpdateHistory,
  canAutoReload,
  escapeHtml
} from './pwa_updater_logic.js';

test('parseSemver parses standard, v-prefixed, and partial version strings', () => {
  assert.deepEqual(parseSemver('18.0.0'), [18, 0, 0]);
  assert.deepEqual(parseSemver('v18.2.5'), [18, 2, 5]);
  assert.deepEqual(parseSemver('17.5'), [17, 5, 0]);
  assert.deepEqual(parseSemver('18.1.0-beta.1'), [18, 1, 0]);
  assert.deepEqual(parseSemver(''), [0, 0, 0]);
  assert.deepEqual(parseSemver(null), [0, 0, 0]);
});

test('compareSemver & isNewerVersion detect upgrades accurately', () => {
  assert.equal(compareSemver('18.0.0', '18.0.0'), 0);
  assert.equal(compareSemver('18.0.1', '18.0.0'), 1);
  assert.equal(compareSemver('18.1.0', '18.0.9'), 1);
  assert.equal(compareSemver('19.0.0', '18.9.9'), 1);
  assert.equal(compareSemver('17.9.9', '18.0.0'), -1);

  assert.equal(isNewerVersion('18.0.1', '18.0.0'), true);
  assert.equal(isNewerVersion('18.0.0', '18.0.0'), false);
  assert.equal(isNewerVersion('17.5.0', '18.0.0'), false);
  assert.equal(isNewerVersion('18.0.0', ''), false);
  assert.equal(isNewerVersion('', '18.0.0'), false);
});

test('normalizeVersionManifest validates and normalizes version.json payloads', () => {
  assert.equal(normalizeVersionManifest(null), null);
  assert.equal(normalizeVersionManifest({ offline: true }), null);
  assert.equal(normalizeVersionManifest({ version: '' }), null);

  const normalized = normalizeVersionManifest({
    version: 'v18.1.0',
    buildDate: '2026-11-23',
    title: 'تحديث جديد',
    notes: [' ميزة 1 ', '', 'ميزة 2'],
    history: [
      { version: 'v18.1.0', buildDate: '2026-11-23', title: 'إصدار 18.1', notes: ['تحسين'] },
      { invalid: true }
    ]
  });

  assert.equal(normalized.version, '18.1.0');
  assert.deepEqual(normalized.notes, ['ميزة 1', 'ميزة 2']);
  assert.equal(normalized.history.length, 1);
  assert.equal(normalized.history[0].version, '18.1.0');
});

test('appendUpdateHistory prepends, deduplicates consecutive identical entries, and caps size', () => {
  let list = [];
  list = appendUpdateHistory(list, {
    fromVersion: '17.5.0',
    toVersion: '18.0.0',
    source: 'auto',
    appliedAt: '2026-11-22T01:00:00Z'
  }, 3);
  assert.equal(list.length, 1);
  assert.equal(list[0].toVersion, '18.0.0');

  // Consecutive identical transition updates timestamp without creating duplicate row
  list = appendUpdateHistory(list, {
    fromVersion: '17.5.0',
    toVersion: '18.0.0',
    source: 'auto',
    appliedAt: '2026-11-22T01:05:00Z'
  }, 3);
  assert.equal(list.length, 1);
  assert.equal(list[0].appliedAt, '2026-11-22T01:05:00Z');

  // Distinct entries cap at maxItems=3
  list = appendUpdateHistory(list, { fromVersion: '18.0.0', toVersion: '18.0.1', source: 'auto' }, 3);
  list = appendUpdateHistory(list, { fromVersion: '18.0.1', toVersion: '18.0.2', source: 'manual' }, 3);
  list = appendUpdateHistory(list, { fromVersion: '18.0.2', toVersion: '18.0.3', source: 'auto' }, 3);
  assert.equal(list.length, 3);
  assert.equal(list[0].toVersion, '18.0.3');
  assert.equal(list[2].toVersion, '18.0.1');
});

test('canAutoReload blocks rapid reload loops within minGapMs', () => {
  assert.equal(canAutoReload(0, 100000, 30000), true);
  assert.equal(canAutoReload(90000, 100000, 30000), false);
  assert.equal(canAutoReload(70000, 100000, 30000), true);
});

test('escapeHtml neutralizes HTML injection characters', () => {
  assert.equal(escapeHtml('<script>"alert&1"</script>'), '&lt;script&gt;&quot;alert&amp;1&quot;&lt;/script&gt;');
});
