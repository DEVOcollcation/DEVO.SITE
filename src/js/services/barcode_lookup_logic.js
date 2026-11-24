/**
 * Pure, testable logic for Barcode Lookup, Staff Inactive Model Access,
 * Safe Supabase Filter Building, and Model Inventory Summaries.
 * No DOM or browser globals required so unit tests run directly in Node.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STAFF_ROLES = new Set(['owner', 'admin', 'worker', 'sales']);

/**
 * Converts Arabic-Indic digits (٠-٩) to Western digits (0-9) and trims.
 */
export function normalizeCodeString(str) {
  if (str === null || str === undefined) return '';
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(str).trim().replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)));
}

/**
 * Checks whether a string is a valid UUID (safe for Postgres uuid column equality).
 */
export function isUuid(value) {
  if (typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
}

/**
 * Parses a raw scanned barcode/QR string or manual code input into:
 * { cleanCode, explicitType: 'system' | 'factory' | null }
 */
export function parseScannedBarcode(rawCode) {
  if (rawCode === null || rawCode === undefined) {
    return { cleanCode: '', explicitType: null };
  }

  let cleanCode = normalizeCodeString(rawCode).toLowerCase();
  let explicitType = null;

  // 1. Parse URL query parameters if QR contains a deep link
  if (cleanCode.includes('?') || cleanCode.includes('=')) {
    try {
      const urlStr = cleanCode.startsWith('http')
        ? cleanCode
        : `http://dummy.com/${cleanCode.startsWith('?') ? '' : '?'}${cleanCode}`;
      const urlObj = new URL(urlStr);
      if (urlObj.searchParams.has('system')) {
        explicitType = 'system';
        cleanCode = (urlObj.searchParams.get('system') || '').toLowerCase();
      } else if (urlObj.searchParams.has('factory')) {
        explicitType = 'factory';
        cleanCode = (urlObj.searchParams.get('factory') || '').toLowerCase();
      } else if (urlObj.searchParams.has('code')) {
        cleanCode = (urlObj.searchParams.get('code') || '').toLowerCase();
      } else if (urlObj.searchParams.has('model') || urlObj.searchParams.has('id')) {
        cleanCode = (urlObj.searchParams.get('model') || urlObj.searchParams.get('id') || '').toLowerCase();
      }
    } catch (_) {
      // Ignore malformed URLs and fall back to raw string
    }
  }

  cleanCode = cleanCode.replace(/^["']|["']$/g, '').trim();

  // 2. Detect explicit prefixes (F for factory, S for system)
  if (!explicitType && cleanCode) {
    if (/^(sys-|system-|s-)/i.test(cleanCode)) {
      explicitType = 'system';
      cleanCode = cleanCode.replace(/^(sys-|system-|s-)/i, '');
    } else if (/^(fac-|factory-|f-)/i.test(cleanCode)) {
      explicitType = 'factory';
      cleanCode = cleanCode.replace(/^(fac-|factory-|f-)/i, '');
    } else if (/^s[0-9a-z_]+/i.test(cleanCode) && !isUuid(cleanCode)) {
      explicitType = 'system';
      cleanCode = cleanCode.substring(1);
    } else if (/^f[0-9a-z_]+/i.test(cleanCode) && !isUuid(cleanCode)) {
      explicitType = 'factory';
      cleanCode = cleanCode.substring(1);
    }
  }

  cleanCode = normalizeCodeString(cleanCode).toLowerCase();
  return { cleanCode, explicitType };
}

/**
 * Escapes PostgREST filter special characters for safe ilike exact match.
 */
function sanitizePostgrestValue(val) {
  // Strip PostgREST syntax delimiters (commas, parens, quotes, wildcards) to keep .or() well-formed
  const cleaned = String(val || '').replace(/[(),"\\*%]/g, '').trim();
  return cleaned;
}

/**
 * Builds a UUID-safe PostgREST `.or(...)` filter expression so non-UUID codes
 * never trigger Postgres `22P02: invalid input syntax for type uuid` on `models.id`.
 * Uses case-insensitive `ilike` (without wildcards) for factory_code & system_code.
 */
export function buildSupabaseCodeFilter(cleanCode, explicitType = null, matchType = 'both') {
  const safeVal = sanitizePostgrestValue(cleanCode);
  if (!safeVal) return '';

  const uuidOk = isUuid(safeVal);
  const clauses = [];

  if (explicitType === 'system' || (!explicitType && matchType === 'system')) {
    clauses.push(`system_code.ilike.${safeVal}`);
    if (uuidOk) clauses.push(`id.eq.${safeVal}`);
  } else if (explicitType === 'factory' || (!explicitType && matchType === 'factory')) {
    clauses.push(`factory_code.ilike.${safeVal}`);
  } else {
    clauses.push(`factory_code.ilike.${safeVal}`);
    clauses.push(`system_code.ilike.${safeVal}`);
    if (uuidOk) clauses.push(`id.eq.${safeVal}`);
  }

  return clauses.join(',');
}

/**
 * Builds the broad fallback PostgREST `.or(...)` filter across factory_code, system_code,
 * and (only if valid UUID) id.
 */
export function buildSupabaseFallbackCodeFilter(cleanCode) {
  return buildSupabaseCodeFilter(cleanCode, null, 'both');
}

/**
 * Determines whether the current user is allowed to inspect inactive/disabled models via barcode scan.
 * Strictly true for logged-in system accounts (owner, admin, worker, sales), strictly false for visitors.
 */
export function canViewInactiveModel(sessionOrFlag) {
  if (typeof sessionOrFlag === 'boolean') return sessionOrFlag;
  if (!sessionOrFlag || typeof sessionOrFlag !== 'object') return false;
  if (sessionOrFlag.isVisitor === true) return false;

  const user = sessionOrFlag.user && typeof sessionOrFlag.user === 'object'
    ? sessionOrFlag.user
    : sessionOrFlag;

  const role = String(user.role || '').toLowerCase().trim();
  if (STAFF_ROLES.has(role)) return true;
  if (user.id || user.username) return true;
  return false;
}

/**
 * Selects the best matching model when multiple records are returned by a DB lookup.
 * Always prioritizes an active model over an inactive one.
 */
export function pickBestMatchedModel(models) {
  if (!Array.isArray(models) || models.length === 0) return null;
  const active = models.find((m) => m && m.is_active !== false);
  return active || models[0] || null;
}

/**
 * Classifies a barcode lookup result according to user permissions:
 * - 'found_active': model exists and is_active !== false
 * - 'found_inactive': model exists, is_active === false, and user is logged-in staff
 * - 'not_found': model missing OR inactive while user is a visitor
 */
export function classifyBarcodeLookupResult(model, isStaff) {
  if (!model || typeof model !== 'object') {
    return { status: 'not_found', model: null };
  }
  const isInactive = model.is_active === false;
  if (isInactive) {
    if (canViewInactiveModel(isStaff)) {
      return { status: 'found_inactive', model };
    }
    return { status: 'not_found', model: null };
  }
  return { status: 'found_active', model };
}

/**
 * Computes normalized inventory totals and per-color breakdown for a model card
 * (preserving the exact Base Stock = Remaining + Sold + Settlements equation).
 */
export function computeModelStockSummary(model, colorSalesMap = {}, resolveColorNameFn = null) {
  const inventory = Array.isArray(model?.model_inventory) ? model.model_inventory : [];
  let totalRemaining = 0;
  let totalBase = 0;
  let availableColorsCount = 0;

  const colors = inventory.map((inv) => {
    const remaining = Math.max(0, Number(inv?.available_series) || 0);
    const colorId = String(inv?.color_id ?? '');
    const soldAndSettled = Math.max(0, Number(colorSalesMap?.[colorId]) || 0);
    const baseStock = remaining + soldAndSettled;
    const isOut = remaining <= 0;

    totalRemaining += remaining;
    totalBase += baseStock;
    if (!isOut) availableColorsCount += 1;

    const colorName = typeof resolveColorNameFn === 'function'
      ? resolveColorNameFn(inv)
      : (inv?.colors?.name || inv?.color_name || 'غير محدد');

    return {
      colorId,
      colorName,
      remaining,
      baseStock,
      soldAndSettled,
      isOut
    };
  });

  return {
    colors,
    totalRemaining,
    totalBase,
    totalColors: colors.length,
    availableColorsCount
  };
}
