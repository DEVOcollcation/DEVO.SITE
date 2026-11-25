/**
 * Pure, testable logic for DEVO PWA Auto-Update & Update Tracking.
 * No DOM or browser globals required here so unit tests run directly in Node.
 */

export const APP_FALLBACK_VERSION = '18.2.0';

/**
 * Parses a version string like "v18.0.0" or "18.2" into [major, minor, patch].
 */
export function parseSemver(version) {
  if (typeof version !== 'string' && typeof version !== 'number') {
    return [0, 0, 0];
  }
  const cleaned = String(version).trim().replace(/^v/i, '').split('-')[0];
  if (!cleaned) return [0, 0, 0];
  const parts = cleaned.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/**
 * Compares two semver strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/**
 * Returns true strictly when remoteVersion is a valid, newer version than localVersion.
 */
export function isNewerVersion(remoteVersion, localVersion) {
  if (!remoteVersion || typeof remoteVersion !== 'string') return false;
  const r = remoteVersion.trim();
  if (!r || parseSemver(r).every((n) => n === 0)) return false;
  if (!localVersion || typeof localVersion !== 'string' || !localVersion.trim()) {
    return false;
  }
  return compareSemver(r, localVersion.trim()) > 0;
}

/**
 * Sanitizes and normalizes the JSON payload from /version.json.
 */
export function normalizeVersionManifest(raw) {
  if (!raw || typeof raw !== 'object' || raw.offline) {
    return null;
  }

  const version = typeof raw.version === 'string' ? raw.version.trim().replace(/^v/i, '') : '';
  if (!version) return null;

  const buildDate = typeof raw.buildDate === 'string' ? raw.buildDate.trim() : '';
  const title = typeof raw.title === 'string' ? raw.title.trim() : `الإصدار ${version}`;
  const notes = Array.isArray(raw.notes)
    ? raw.notes.map((n) => String(n || '').trim()).filter(Boolean)
    : [];

  const history = Array.isArray(raw.history)
    ? raw.history
        .filter((item) => item && typeof item === 'object' && typeof item.version === 'string' && item.version.trim())
        .map((item) => ({
          version: item.version.trim().replace(/^v/i, ''),
          buildDate: typeof item.buildDate === 'string' ? item.buildDate.trim() : '',
          title: typeof item.title === 'string' ? item.title.trim() : `الإصدار ${item.version.trim()}`,
          notes: Array.isArray(item.notes)
            ? item.notes.map((n) => String(n || '').trim()).filter(Boolean)
            : []
        }))
    : [
        {
          version,
          buildDate,
          title,
          notes
        }
      ];

  return {
    version,
    buildDate,
    title,
    notes,
    history
  };
}

/**
 * Prepends a local device update record, deduplicating immediate consecutive identical transitions
 * and capping the list to maxItems.
 */
export function appendUpdateHistory(existingHistory, entry, maxItems = 25) {
  const safeList = Array.isArray(existingHistory) ? existingHistory.filter((x) => x && typeof x === 'object') : [];
  if (!entry || typeof entry !== 'object' || !entry.toVersion) {
    return safeList.slice(0, maxItems);
  }

  const normalizedEntry = {
    fromVersion: String(entry.fromVersion || '').trim() || null,
    toVersion: String(entry.toVersion).trim().replace(/^v/i, ''),
    title: String(entry.title || '').trim(),
    source: String(entry.source || 'auto').trim(), // 'auto' | 'manual' | 'sw' | 'initial'
    appliedAt: entry.appliedAt || new Date().toISOString()
  };

  const head = safeList[0];
  if (
    head &&
    head.toVersion === normalizedEntry.toVersion &&
    head.fromVersion === normalizedEntry.fromVersion &&
    head.source === normalizedEntry.source
  ) {
    // Update timestamp of identical consecutive event rather than duplicating
    return [normalizedEntry, ...safeList.slice(1)].slice(0, maxItems);
  }

  return [normalizedEntry, ...safeList].slice(0, maxItems);
}

/**
 * Guard against accidental infinite auto-reload loops (e.g., if a CDN serves a stale asset briefly).
 */
export function canAutoReload(lastReloadTs, nowTs = Date.now(), minGapMs = 30000) {
  const last = Number(lastReloadTs) || 0;
  if (last <= 0) return true;
  return nowTs - last >= minGapMs;
}

/**
 * Escapes HTML special characters for safe template rendering.
 */
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
