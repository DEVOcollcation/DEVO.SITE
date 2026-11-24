/**
 * Unified DEVO PWA Auto-Updater, Update Tracker & In-App Install Controller
 * - Detects new GitHub/Server releases via /version.json (no-store) AND Service Worker updatefound
 * - Automatically downloads, clears stale static caches, activates new SW, records device history, and reloads cleanly
 * - Captures beforeinstallprompt & provides iOS Safari install guide (hidden automatically in standalone mode)
 */
import {
  APP_FALLBACK_VERSION,
  isNewerVersion,
  normalizeVersionManifest,
  appendUpdateHistory,
  canAutoReload,
  escapeHtml
} from './pwa_updater_logic.js';

const STORAGE_KEYS = {
  INSTALLED_VERSION: 'devo_installed_version',
  UPDATE_HISTORY: 'devo_update_history',
  JUST_UPDATED: 'devo_just_updated_to',
  LAST_CHECKED_AT: 'devo_update_last_checked_at',
  RELOAD_TS: 'devo_pwa_last_auto_reload_ts'
};

const AUTO_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const state = {
  initialized: false,
  installedVersion: APP_FALLBACK_VERSION,
  remoteManifest: null,
  status: 'idle', // 'idle' | 'checking' | 'up-to-date' | 'updating' | 'update-available' | 'offline' | 'error'
  lastCheckedAt: null,
  lastError: null,
  swRegistered: false,
  swState: 'غير مسجّل',
  swVersion: null,
  isStandalone: false,
  isIos: false,
  canInstallNative: false,
  deferredInstallPrompt: null,
  updateHistory: []
};

let swRegistration = null;
let checkInFlight = null;
let isApplyingUpdate = false;
let autoCheckIntervalId = null;
const listeners = new Set();

function safeGetLocal(key, fallback = null) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

function safeSetLocal(key, value) {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {}
}

function readHistory() {
  try {
    const raw = safeGetLocal(STORAGE_KEYS.UPDATE_HISTORY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(list) {
  state.updateHistory = list;
  safeSetLocal(STORAGE_KEYS.UPDATE_HISTORY, JSON.stringify(list));
}

function detectPlatform() {
  const ua = (navigator.userAgent || '').toLowerCase();
  const isStandaloneDisplay =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.matchMedia?.('(display-mode: minimal-ui)')?.matches ||
    window.navigator.standalone === true;

  const isIosDevice =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  state.isStandalone = Boolean(isStandaloneDisplay);
  state.isIos = Boolean(isIosDevice);
}

function notifyListeners() {
  const snapshot = getUpdateSnapshot();
  listeners.forEach((cb) => {
    try {
      cb(snapshot);
    } catch {}
  });
  try {
    window.dispatchEvent(new CustomEvent('devo:pwa-state-changed', { detail: snapshot }));
  } catch {}
}

export function getUpdateSnapshot() {
  return {
    installedVersion: state.installedVersion,
    remoteManifest: state.remoteManifest,
    latestVersion: state.remoteManifest?.version || state.installedVersion,
    hasUpdate: Boolean(
      state.remoteManifest?.version &&
        isNewerVersion(state.remoteManifest.version, state.installedVersion)
    ),
    status: state.status,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
    swRegistered: state.swRegistered,
    swState: state.swState,
    swVersion: state.swVersion,
    isStandalone: state.isStandalone,
    isIos: state.isIos,
    canInstallNative: state.canInstallNative,
    canShowInstallUi: !state.isStandalone && (state.canInstallNative || state.isIos || true),
    updateHistory: [...state.updateHistory]
  };
}

export function onUpdateStateChange(callback) {
  if (typeof callback === 'function') {
    listeners.add(callback);
  }
  return () => listeners.delete(callback);
}

// =========================================================================
// 🎨 FLOATING UPDATE BANNER & RELEASE NOTES / iOS INSTALL MODALS
// =========================================================================

function getOverlayRoot() {
  let root = document.getElementById('devo-pwa-ui-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'devo-pwa-ui-root';
    document.body.appendChild(root);
  }
  return root;
}

function showUpdatingBanner(targetVersion) {
  if (!document.body) return;
  const root = getOverlayRoot();
  const verText = targetVersion ? `v${escapeHtml(targetVersion)}` : 'الإصدار الجديد';
  root.innerHTML = `
    <div id="devo-pwa-updating-banner" dir="rtl"
      class="fixed bottom-20 md:bottom-6 right-4 left-4 md:right-auto md:left-6 md:w-[390px] z-[250000] bg-devo-dark border border-devo-orange/60 rounded-2xl p-4 shadow-2xl flex items-center gap-3.5 animate-fade-in">
      <div class="w-10 h-10 rounded-xl bg-devo-orange/15 border border-devo-orange/30 text-devo-orange flex items-center justify-center shrink-0">
        <i class="ph ph-arrows-clockwise text-xl animate-spin"></i>
      </div>
      <div class="min-w-0 flex-1 text-right">
        <p class="text-sm font-bold text-devo-text leading-snug">جاري تنزيل التحديث المباشر (${verText})</p>
        <p class="text-xs text-devo-muted mt-0.5">سيتم تحديث التطبيق تلقائياً خلال لحظات دون إعادة تثبيت...</p>
      </div>
    </div>
  `;
}

function showPostUpdateBanner(info) {
  if (!document.body || !info || !info.version) return;
  const root = getOverlayRoot();
  const safeVersion = escapeHtml(info.version);
  const safeTitle = escapeHtml(info.title || `تم التحديث إلى الإصدار v${info.version}`);

  root.innerHTML = `
    <div id="devo-pwa-updated-banner" dir="rtl"
      class="fixed bottom-20 md:bottom-6 right-4 left-4 md:right-auto md:left-6 md:w-[410px] z-[250000] bg-devo-dark border border-devo-success/50 rounded-2xl p-4 shadow-2xl animate-fade-in">
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-xl bg-devo-success/15 border border-devo-success/30 text-devo-success flex items-center justify-center shrink-0">
          <i class="ph ph-check-circle text-xl"></i>
        </div>
        <div class="min-w-0 flex-1 text-right">
          <p class="text-sm font-bold text-devo-text leading-snug">تم تحديث التطبيق تلقائياً إلى v${safeVersion}</p>
          <p class="text-xs text-devo-muted mt-0.5 line-clamp-2">${safeTitle}</p>
          <div class="flex items-center gap-2 mt-3">
            ${
              Array.isArray(info.notes) && info.notes.length > 0
                ? `<button type="button" id="devo-pwa-btn-whats-new" class="px-3 py-1.5 rounded-lg bg-devo-orange hover:bg-devo-orangeHover text-white text-xs font-bold transition-colors cursor-pointer">ما الجديد</button>`
                : ''
            }
            <button type="button" id="devo-pwa-btn-dismiss" class="px-3 py-1.5 rounded-lg bg-devo-black border border-devo-gray text-devo-muted hover:text-devo-text text-xs font-bold transition-colors cursor-pointer">إغلاق</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const dismiss = () => {
    const el = document.getElementById('devo-pwa-updated-banner');
    if (el) el.remove();
  };

  document.getElementById('devo-pwa-btn-dismiss')?.addEventListener('click', dismiss);
  document.getElementById('devo-pwa-btn-whats-new')?.addEventListener('click', () => {
    dismiss();
    openReleaseNotesModal(info);
  });

  setTimeout(dismiss, 14000);
}

export function openReleaseNotesModal(releaseInfo = null) {
  const info = releaseInfo || state.remoteManifest;
  if (!info || !document.body) return;
  const root = getOverlayRoot();
  const safeVersion = escapeHtml(info.version || state.installedVersion);
  const safeTitle = escapeHtml(info.title || `تحديث النظام v${safeVersion}`);
  const safeDate = escapeHtml(info.buildDate || '');
  const notes = Array.isArray(info.notes) ? info.notes : [];

  root.innerHTML = `
    <div id="devo-pwa-notes-modal" dir="rtl" class="fixed inset-0 z-[260000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="w-full max-w-md bg-devo-dark border border-devo-gray rounded-2xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true">
        <div class="p-4 border-b border-devo-gray bg-devo-black/60 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <img src="./src/assets/icons/devo-icon.svg" alt="DEVO" class="w-10 h-10 rounded-xl shrink-0">
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-devo-text truncate">الإصدار v${safeVersion}</h3>
              <p class="text-[11px] text-devo-muted truncate">${safeDate || 'تحديث مباشر للنظام'}</p>
            </div>
          </div>
          <button type="button" id="devo-pwa-notes-close" aria-label="إغلاق" class="w-9 h-9 rounded-xl bg-devo-gray/40 hover:bg-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center cursor-pointer">
            <i class="ph ph-x text-base"></i>
          </button>
        </div>
        <div class="p-5 space-y-3">
          <p class="text-sm font-bold text-devo-orange">${safeTitle}</p>
          ${
            notes.length > 0
              ? `<ul class="space-y-2 text-xs text-devo-text leading-relaxed">
                  ${notes
                    .map(
                      (n) => `<li class="flex items-start gap-2">
                        <i class="ph ph-check-circle text-devo-success text-sm shrink-0 mt-0.5"></i>
                        <span>${escapeHtml(n)}</span>
                      </li>`
                    )
                    .join('')}
                </ul>`
              : `<p class="text-xs text-devo-muted">تم تطبيق آخر التحسينات والتحديثات بنجاح.</p>`
          }
          <div class="pt-2">
            <button type="button" id="devo-pwa-notes-ok" class="w-full py-2.5 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs font-bold transition-colors cursor-pointer">
              تم، متابعة العمل
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  const close = () => document.getElementById('devo-pwa-notes-modal')?.remove();
  document.getElementById('devo-pwa-notes-close')?.addEventListener('click', close);
  document.getElementById('devo-pwa-notes-ok')?.addEventListener('click', close);
  document.getElementById('devo-pwa-notes-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'devo-pwa-notes-modal') close();
  });
}

export function openInstallGuideModal() {
  if (!document.body) return;
  const root = getOverlayRoot();
  const isIos = state.isIos;

  const stepsHtml = isIos
    ? `
      <ol class="space-y-2.5 text-xs text-devo-text leading-relaxed">
        <li class="flex items-start gap-2.5">
          <span class="w-5 h-5 rounded-full bg-devo-orange/15 text-devo-orange font-bold flex items-center justify-center shrink-0">1</span>
          <span>اضغط على زر <strong>المشاركة (Share)</strong> أسفل شاشة Safari <i class="ph ph-export text-devo-orange"></i>.</span>
        </li>
        <li class="flex items-start gap-2.5">
          <span class="w-5 h-5 rounded-full bg-devo-orange/15 text-devo-orange font-bold flex items-center justify-center shrink-0">2</span>
          <span>مرّر للأسفل واختر <strong>«إضافة إلى الشاشة الرئيسية» (Add to Home Screen)</strong>.</span>
        </li>
        <li class="flex items-start gap-2.5">
          <span class="w-5 h-5 rounded-full bg-devo-orange/15 text-devo-orange font-bold flex items-center justify-center shrink-0">3</span>
          <span>اضغط <strong>«إضافة» (Add)</strong> لتثبيت التطبيق بالأيقونة الجديدة.</span>
        </li>
      </ol>
    `
    : `
      <ol class="space-y-2.5 text-xs text-devo-text leading-relaxed">
        <li class="flex items-start gap-2.5">
          <span class="w-5 h-5 rounded-full bg-devo-orange/15 text-devo-orange font-bold flex items-center justify-center shrink-0">1</span>
          <span>من شريط المتصفح (Chrome أو Edge) اضغط على أيقونة <strong>تثبيت التطبيق</strong> أو قائمة النقاط الثلاث <strong>⋮</strong>.</span>
        </li>
        <li class="flex items-start gap-2.5">
          <span class="w-5 h-5 rounded-full bg-devo-orange/15 text-devo-orange font-bold flex items-center justify-center shrink-0">2</span>
          <span>اختر <strong>«تثبيت التطبيق» (Install App)</strong> أو <strong>«الإضافة إلى الشاشة الرئيسية»</strong>.</span>
        </li>
        <li class="flex items-start gap-2.5">
          <span class="w-5 h-5 rounded-full bg-devo-orange/15 text-devo-orange font-bold flex items-center justify-center shrink-0">3</span>
          <span>بعد التثبيت ستصلك كافة التحديثات تلقائياً ومباشرة دون الحاجة لإعادة التثبيت.</span>
        </li>
      </ol>
    `;

  root.innerHTML = `
    <div id="devo-pwa-install-modal" dir="rtl" class="fixed inset-0 z-[260000] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="w-full max-w-md bg-devo-dark border border-devo-gray rounded-2xl shadow-2xl overflow-hidden" role="dialog" aria-modal="true">
        <div class="p-4 border-b border-devo-gray bg-devo-black/60 flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <img src="./src/assets/icons/devo-icon.svg" alt="DEVO" class="w-10 h-10 rounded-xl shrink-0">
            <div class="min-w-0">
              <h3 class="text-sm font-bold text-devo-text">تثبيت تطبيق DEVO</h3>
              <p class="text-[11px] text-devo-muted">${isIos ? 'إرشادات التثبيت على iPhone / iPad' : 'تثبيت سريع على الموبايل أو الكمبيوتر'}</p>
            </div>
          </div>
          <button type="button" id="devo-pwa-install-close" aria-label="إغلاق" class="w-9 h-9 rounded-xl bg-devo-gray/40 hover:bg-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center cursor-pointer">
            <i class="ph ph-x text-base"></i>
          </button>
        </div>
        <div class="p-5 space-y-4">
          ${stepsHtml}
          <button type="button" id="devo-pwa-install-ok" class="w-full py-2.5 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs font-bold transition-colors cursor-pointer">
            حسناً، فهمت
          </button>
        </div>
      </div>
    </div>
  `;

  const close = () => document.getElementById('devo-pwa-install-modal')?.remove();
  document.getElementById('devo-pwa-install-close')?.addEventListener('click', close);
  document.getElementById('devo-pwa-install-ok')?.addEventListener('click', close);
  document.getElementById('devo-pwa-install-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'devo-pwa-install-modal') close();
  });
}

// =========================================================================
// ⚙️ SERVICE WORKER COMMUNICATION & CACHE REFRESH
// =========================================================================

async function queryServiceWorkerVersion() {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return null;

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 1500);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data?.version || null);
    };
    try {
      controller.postMessage({ type: 'GET_SW_VERSION' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function clearAllStaticCaches() {
  // 1. Ask SW if active
  const controller = navigator.serviceWorker?.controller;
  if (controller) {
    await new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(resolve, 1800);
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        controller.postMessage({ type: 'FORCE_REFRESH_CACHES' }, [channel.port2]);
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  // 2. Also clear directly via CacheStorage API from window for belt-and-suspenders reliability
  if (typeof caches !== 'undefined') {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('devo-static-') || k.startsWith('devo-cache-'))
          .map((k) => caches.delete(k))
      );
    } catch {}
  }
}

function performGuardedReload(force = false) {
  const now = Date.now();
  const lastTs = Number(sessionStorage.getItem(STORAGE_KEYS.RELOAD_TS) || '0');
  if (!force && !canAutoReload(lastTs, now, 30000)) {
    return false;
  }
  try {
    sessionStorage.setItem(STORAGE_KEYS.RELOAD_TS, String(now));
  } catch {}
  window.location.reload();
  return true;
}

// =========================================================================
// 🔄 UPDATE DETECTION & APPLICATION ENGINE
// =========================================================================

async function fetchRemoteVersionManifest() {
  const url = `./version.json?_t=${Date.now()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const raw = await res.json();
  return normalizeVersionManifest(raw);
}

/**
 * Applies an update cleanly: clears static caches, updates SW, records local history, and reloads.
 */
export async function forceApplyUpdateNow(options = {}) {
  if (isApplyingUpdate) return;
  isApplyingUpdate = true;

  const {
    targetManifest = state.remoteManifest,
    source = 'manual',
    forceReload = true
  } = options;

  const fromVersion = state.installedVersion;
  const toVersion = targetManifest?.version || state.installedVersion;

  state.status = 'updating';
  notifyListeners();
  showUpdatingBanner(toVersion);

  // Record transition in device update history
  const nextHistory = appendUpdateHistory(state.updateHistory, {
    fromVersion,
    toVersion,
    title: targetManifest?.title || (source === 'manual' ? 'تحديث يدوي وتفريغ الكاش' : `تحديث تلقائي إلى v${toVersion}`),
    source,
    appliedAt: new Date().toISOString()
  });
  writeHistory(nextHistory);
  safeSetLocal(STORAGE_KEYS.INSTALLED_VERSION, toVersion);
  state.installedVersion = toVersion;

  safeSetLocal(
    STORAGE_KEYS.JUST_UPDATED,
    JSON.stringify({
      version: toVersion,
      title: targetManifest?.title || `تم التحديث إلى الإصدار v${toVersion}`,
      buildDate: targetManifest?.buildDate || '',
      notes: targetManifest?.notes || []
    })
  );

  try {
    await clearAllStaticCaches();

    if (swRegistration) {
      await swRegistration.update().catch(() => {});
      if (swRegistration.waiting) {
        swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }
  } catch {}

  setTimeout(() => {
    const reloaded = performGuardedReload(forceReload);
    if (!reloaded) {
      isApplyingUpdate = false;
      state.status = 'up-to-date';
      notifyListeners();
      document.getElementById('devo-pwa-updating-banner')?.remove();
    }
  }, 550);
}

/**
 * Checks /version.json and Service Worker registration for updates.
 * If autoApply=true and a newer version is found, downloads and applies it automatically!
 */
export async function checkForUpdatesNow(options = {}) {
  const { autoApply = true, silent = false } = options;

  if (checkInFlight) return checkInFlight;

  checkInFlight = (async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      state.status = 'offline';
      state.lastError = 'لا يوجد اتصال بالإنترنت حالياً';
      notifyListeners();
      return { status: 'offline', hasUpdate: false };
    }

    state.status = 'checking';
    state.lastError = null;
    if (!silent) notifyListeners();

    try {
      // Trigger browser byte-for-byte check of sw.js in parallel
      if (swRegistration) {
        swRegistration.update().catch(() => {});
      }

      const manifest = await fetchRemoteVersionManifest();
      const nowIso = new Date().toISOString();
      state.lastCheckedAt = nowIso;
      safeSetLocal(STORAGE_KEYS.LAST_CHECKED_AT, nowIso);

      if (!manifest) {
        state.status = 'up-to-date';
        notifyListeners();
        return { status: 'up-to-date', hasUpdate: false };
      }

      state.remoteManifest = manifest;

      // First run on a device without stored version: initialize cleanly without false reload
      const storedVersion = safeGetLocal(STORAGE_KEYS.INSTALLED_VERSION);
      if (!storedVersion) {
        state.installedVersion = manifest.version;
        safeSetLocal(STORAGE_KEYS.INSTALLED_VERSION, manifest.version);
        if (state.updateHistory.length === 0) {
          writeHistory(
            appendUpdateHistory([], {
              fromVersion: null,
              toVersion: manifest.version,
              title: manifest.title || `تثبيت الإصدار v${manifest.version}`,
              source: 'initial',
              appliedAt: nowIso
            })
          );
        }
        state.status = 'up-to-date';
        notifyListeners();
        return { status: 'up-to-date', hasUpdate: false, manifest };
      }

      const hasUpdate = isNewerVersion(manifest.version, state.installedVersion);
      if (hasUpdate) {
        state.status = 'update-available';
        notifyListeners();

        if (autoApply) {
          await forceApplyUpdateNow({
            targetManifest: manifest,
            source: 'auto',
            forceReload: false
          });
          return { status: 'updating', hasUpdate: true, manifest };
        }
        return { status: 'update-available', hasUpdate: true, manifest };
      }

      state.status = 'up-to-date';
      notifyListeners();
      return { status: 'up-to-date', hasUpdate: false, manifest };
    } catch (err) {
      state.status = navigator.onLine === false ? 'offline' : 'error';
      state.lastError = err?.message || 'تعذر الاتصال بخادم التحديثات';
      notifyListeners();
      return { status: state.status, hasUpdate: false, error: state.lastError };
    } finally {
      checkInFlight = null;
    }
  })();

  return checkInFlight;
}

// =========================================================================
// 📲 IN-APP PWA INSTALL PROMPT CONTROLLER
// =========================================================================

export async function triggerInstall() {
  if (state.isStandalone) {
    return { outcome: 'already-installed' };
  }

  if (state.deferredInstallPrompt) {
    const promptEvent = state.deferredInstallPrompt;
    state.deferredInstallPrompt = null;
    state.canInstallNative = false;
    notifyListeners();

    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      return { outcome: choice?.outcome || 'dismissed' };
    } catch {
      openInstallGuideModal();
      return { outcome: 'guide' };
    }
  }

  openInstallGuideModal();
  return { outcome: 'guide' };
}

// =========================================================================
// 🚀 INITIALIZATION
// =========================================================================

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    state.swState = 'غير مدعوم في هذا المتصفح';
    notifyListeners();
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    swRegistration = reg;
    state.swRegistered = true;
    state.swState = reg.active ? 'نشط ومفعّل' : reg.installing ? 'جاري التثبيت' : 'جاهز';
    state.swVersion = await queryServiceWorkerVersion();
    notifyListeners();

    reg.update().catch(() => {});

    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      state.swState = 'جاري تنزيل نسخة جديدة...';
      notifyListeners();

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          newWorker.postMessage({ type: 'SKIP_WAITING' });
        } else if (newWorker.state === 'activated') {
          state.swState = 'نشط ومفعّل';
          notifyListeners();
        }
      });
    });

    // Smooth single guarded reload when new SW takes control
    let controllerReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (controllerReloaded || isApplyingUpdate) return;
      controllerReloaded = true;
      performGuardedReload(false);
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_ACTIVATED' && event.data.version) {
        state.swVersion = event.data.version;
        state.swState = 'نشط ومفعّل';
        notifyListeners();
      }
    });
  } catch (err) {
    state.swRegistered = false;
    state.swState = 'تعذر التسجيل';
    notifyListeners();
  }
}

export function initPwaUpdater() {
  if (state.initialized) return getUpdateSnapshot();
  state.initialized = true;

  detectPlatform();

  // Restore saved version & history
  const storedVersion = safeGetLocal(STORAGE_KEYS.INSTALLED_VERSION);
  if (storedVersion) {
    state.installedVersion = storedVersion;
  }
  state.updateHistory = readHistory();
  state.lastCheckedAt = safeGetLocal(STORAGE_KEYS.LAST_CHECKED_AT);

  // Capture native install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    state.canInstallNative = true;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    state.canInstallNative = false;
    state.isStandalone = true;
    notifyListeners();
  });

  // Show post-update celebration toast once after reload
  const justUpdatedRaw = safeGetLocal(STORAGE_KEYS.JUST_UPDATED);
  if (justUpdatedRaw) {
    safeSetLocal(STORAGE_KEYS.JUST_UPDATED, null);
    try {
      const info = JSON.parse(justUpdatedRaw);
      const showWhenReady = () => setTimeout(() => showPostUpdateBanner(info), 600);
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', showWhenReady, { once: true });
      } else {
        showWhenReady();
      }
    } catch {}
  }

  // Register SW & run initial version check on window load
  const boot = () => {
    registerServiceWorker();
    checkForUpdatesNow({ autoApply: true, silent: true });
  };

  if (document.readyState === 'complete') {
    boot();
  } else {
    window.addEventListener('load', boot, { once: true });
  }

  // Re-check whenever user returns to the installed app from background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdatesNow({ autoApply: true, silent: true });
    }
  });

  // Re-check immediately when connectivity returns
  window.addEventListener('online', () => {
    checkForUpdatesNow({ autoApply: true, silent: true });
  });

  // Periodic background check while app stays open
  if (!autoCheckIntervalId) {
    autoCheckIntervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkForUpdatesNow({ autoApply: true, silent: true });
      }
    }, AUTO_CHECK_INTERVAL_MS);
  }

  notifyListeners();
  return getUpdateSnapshot();
}

// Expose global bridge for inline handlers & cross-module access
const pwaApi = {
  initPwaUpdater,
  checkForUpdatesNow,
  forceApplyUpdateNow,
  triggerInstall,
  openInstallGuideModal,
  openReleaseNotesModal,
  getUpdateSnapshot,
  onUpdateStateChange
};

if (typeof window !== 'undefined') {
  window.devoPwaUpdater = pwaApi;
  initPwaUpdater();
}

export default pwaApi;
