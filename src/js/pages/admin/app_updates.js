import { showToast } from '../../components/toast.js';
import { requireAuth } from '../../services/auth.js';
import { escapeHtml } from '../../services/pwa_updater_logic.js';
import {
  getUpdateSnapshot,
  onUpdateStateChange,
  checkForUpdatesNow,
  forceApplyUpdateNow,
  triggerInstall
} from '../../services/pwa_updater.js';

let isAppUpdatesInitialized = false;
let unsubscribeUpdates = null;

function formatArabicDateTime(iso) {
  if (!iso) return 'لم يتم الفحص بعد';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return escapeHtml(iso);
    return d.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return escapeHtml(iso);
  }
}

function getSourceBadge(source) {
  switch (source) {
    case 'auto':
      return { label: 'تحديث تلقائي مباشر', cls: 'bg-devo-success/15 text-devo-success border-devo-success/30' };
    case 'manual':
      return { label: 'تحديث يدوي', cls: 'bg-devo-orange/15 text-devo-orange border-devo-orange/30' };
    case 'sw':
      return { label: 'تحديث خلفي', cls: 'bg-devo-info/15 text-devo-info border-devo-info/30' };
    default:
      return { label: 'تثبيت أولي', cls: 'bg-devo-gray/60 text-devo-muted border-devo-gray' };
  }
}

export async function initAppUpdatesView() {
  const user = requireAuth(['owner']);
  if (!user || user.role !== 'owner') {
    showToast('هذه الصفحة مخصصة لمالك النظام فقط', 'error');
    return;
  }

  if (!isAppUpdatesInitialized) {
    renderAppUpdatesShell();
    bindAppUpdatesEvents();
    unsubscribeUpdates = onUpdateStateChange((snap) => renderAppUpdatesState(snap));
    isAppUpdatesInitialized = true;
  }

  renderAppUpdatesState(getUpdateSnapshot());
  // Trigger a fresh non-disruptive check to keep status accurate when opening the tab
  await checkForUpdatesNow({ autoApply: false, silent: false });
}

export async function refreshAppUpdatesView() {
  if (!isAppUpdatesInitialized) {
    await initAppUpdatesView();
    return;
  }
  await checkForUpdatesNow({ autoApply: false, silent: false });
}

function renderAppUpdatesShell() {
  const container = document.getElementById('app-updates-content');
  if (!container) return;

  container.innerHTML = `
    <div class="animate-fade-in space-y-5 max-w-[1200px] mx-auto pb-10">
      <!-- Top Hero: App Icon, Installed vs Server Version, Primary Actions -->
      <div class="bg-devo-dark border border-devo-gray rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div class="flex items-center gap-4 min-w-0">
          <div class="w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-2xl bg-devo-black border border-devo-gray/80 p-1.5 shrink-0 shadow-md flex items-center justify-center">
            <img src="./src/assets/icons/devo-icon.svg?v=18.0.0" alt="أيقونة تطبيق DEVO" class="w-full h-full object-contain rounded-xl">
          </div>
          <div class="min-w-0 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <h2 class="text-lg sm:text-xl font-bold text-devo-text">تتبع تحديثات تطبيق DEVO</h2>
              <span id="au-sync-badge" class="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border border-devo-gray bg-devo-black text-devo-muted">
                جاري الفحص...
              </span>
            </div>
            <p class="text-xs sm:text-sm text-devo-muted">
              الإصدار المثبّت حالياً:
              <strong id="au-installed-version" class="text-devo-text font-mono tabular-nums">v--</strong>
              <span class="mx-1.5 text-devo-gray">•</span>
              آخر إصدار متاح:
              <strong id="au-latest-version" class="text-devo-orange font-mono tabular-nums">v--</strong>
            </p>
            <p id="au-last-checked" class="text-[11px] text-devo-muted">آخر فحص: جاري التحميل...</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2.5 shrink-0">
          <button type="button" id="au-btn-check" class="px-4 py-2.5 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs sm:text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap">
            <i id="au-check-icon" class="ph ph-arrows-clockwise text-base"></i>
            <span>فحص التحديثات الآن</span>
          </button>

          <button type="button" id="au-btn-force-update" class="px-4 py-2.5 rounded-xl bg-devo-black hover:bg-devo-gray border border-devo-gray hover:border-devo-orange/50 text-devo-text text-xs sm:text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap">
            <i class="ph ph-cloud-arrow-down text-base text-devo-orange"></i>
            <span id="au-force-btn-label">تحديث فوري وتفريغ الكاش</span>
          </button>

          <button type="button" id="au-btn-install" class="hidden px-4 py-2.5 rounded-xl bg-devo-info/15 hover:bg-devo-info text-devo-info hover:text-white border border-devo-info/30 text-xs sm:text-sm font-bold transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap">
            <i class="ph ph-device-mobile-camera text-base"></i>
            <span id="au-install-btn-label">تثبيت التطبيق</span>
          </button>
        </div>
      </div>

      <!-- Pending Update Callout (shown only when a newer version is detected while autoApply=false) -->
      <div id="au-update-callout" class="hidden bg-devo-orange/10 border border-devo-orange/40 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl bg-devo-orange text-white flex items-center justify-center shrink-0">
            <i class="ph ph-sparkle text-xl"></i>
          </div>
          <div>
            <h3 id="au-callout-title" class="text-sm font-bold text-devo-text">يتوفر إصدار جديد جاهز للتطبيق المباشر</h3>
            <p id="au-callout-desc" class="text-xs text-devo-muted mt-0.5">اضغط لتنزيل أحدث الملفات فوراً دون إلغاء تثبيت التطبيق.</p>
          </div>
        </div>
        <button type="button" id="au-btn-apply-new" class="px-5 py-2.5 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs sm:text-sm font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer">
          تطبيق التحديث الآن
        </button>
      </div>

      <!-- Status Overview Row -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <span class="text-xs text-devo-muted block">وضع تشغيل التطبيق</span>
            <strong id="au-run-mode" class="text-sm font-bold text-devo-text mt-1 block truncate">--</strong>
          </div>
          <div class="w-10 h-10 rounded-xl bg-devo-black border border-devo-gray text-devo-orange flex items-center justify-center shrink-0">
            <i id="au-run-mode-icon" class="ph ph-device-mobile text-xl"></i>
          </div>
        </div>

        <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <span class="text-xs text-devo-muted block">محرك التحديث المباشر (PWA)</span>
            <strong id="au-sw-status" class="text-sm font-bold text-devo-text mt-1 block truncate">--</strong>
          </div>
          <div class="w-10 h-10 rounded-xl bg-devo-black border border-devo-gray text-devo-success flex items-center justify-center shrink-0">
            <i class="ph ph-broadcast text-xl"></i>
          </div>
        </div>

        <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 flex items-center justify-between gap-3">
          <div class="min-w-0">
            <span class="text-xs text-devo-muted block">إجمالي التحديثات المسجّلة بالجهاز</span>
            <strong id="au-history-count" class="text-sm font-bold text-devo-text font-mono tabular-nums mt-1 block">0 تحديث</strong>
          </div>
          <div class="w-10 h-10 rounded-xl bg-devo-black border border-devo-gray text-devo-info flex items-center justify-center shrink-0">
            <i class="ph ph-clock-counter-clockwise text-xl"></i>
          </div>
        </div>
      </div>

      <!-- Two-Column Timelines: Local Device Update History + System Release Changelog -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <!-- Local Device History -->
        <div class="bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden flex flex-col">
          <div class="p-4 sm:p-5 border-b border-devo-gray flex items-center justify-between gap-2 bg-devo-black/40">
            <h3 class="text-sm font-bold text-devo-text flex items-center gap-2">
              <i class="ph ph-clock-counter-clockwise text-devo-orange text-lg"></i>
              <span>سجل التحديثات على هذا الجهاز</span>
            </h3>
            <span class="text-[11px] text-devo-muted">يُسجّل تلقائياً</span>
          </div>
          <div id="au-device-history-list" class="p-4 sm:p-5 space-y-3 flex-1"></div>
        </div>

        <!-- System Release Changelog -->
        <div class="bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden flex flex-col">
          <div class="p-4 sm:p-5 border-b border-devo-gray flex items-center justify-between gap-2 bg-devo-black/40">
            <h3 class="text-sm font-bold text-devo-text flex items-center gap-2">
              <i class="ph ph-list-checks text-devo-orange text-lg"></i>
              <span>سجل إصدارات النظام (Changelog)</span>
            </h3>
            <span class="text-[11px] text-devo-muted">من GitHub / السيرفر</span>
          </div>
          <div id="au-changelog-list" class="p-4 sm:p-5 space-y-3 flex-1"></div>
        </div>
      </div>

      <!-- Concise GitHub Deployment Note -->
      <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 flex items-start gap-3">
        <div class="w-9 h-9 rounded-lg bg-devo-orange/15 text-devo-orange flex items-center justify-center shrink-0 mt-0.5">
          <i class="ph ph-git-branch text-lg"></i>
        </div>
        <div class="text-xs text-devo-muted leading-relaxed space-y-1">
          <p class="text-devo-text font-bold">كيف يصل التحديث تلقائياً للموبايلات المثبّتة عند الرفع على GitHub؟</p>
          <p>
            عند نشر أي تعديل جديد على GitHub، يكفي رفع رقم الإصدار في ملف <code class="px-1.5 py-0.5 rounded bg-devo-black border border-devo-gray text-devo-orange font-mono">version.json</code>
            (وتحديث <code class="px-1.5 py-0.5 rounded bg-devo-black border border-devo-gray text-devo-orange font-mono">CACHE_VERSION</code> في <code class="px-1.5 py-0.5 rounded bg-devo-black border border-devo-gray text-devo-text font-mono">sw.js</code>)،
            وسيُحمّل التطبيق التحديث مباشرة ويفرّغ الكاش القديم تلقائياً عند فتحه على الموبايل أو الكمبيوتر دون الحاجة لإلغاء التثبيت.
          </p>
        </div>
      </div>
    </div>
  `;
}

function bindAppUpdatesEvents() {
  document.getElementById('au-btn-check')?.addEventListener('click', async () => {
    const icon = document.getElementById('au-check-icon');
    icon?.classList.add('animate-spin');
    const result = await checkForUpdatesNow({ autoApply: false, silent: false });
    icon?.classList.remove('animate-spin');

    if (result.status === 'update-available') {
      showToast(`يتوفر إصدار جديد v${result.manifest?.version} جاهز للتطبيق`, 'info');
    } else if (result.status === 'up-to-date') {
      showToast('التطبيق محدّث بالفعل على أحدث إصدار', 'success');
    } else if (result.status === 'offline') {
      showToast('لا يوجد اتصال بالإنترنت لفحص التحديثات', 'error');
    } else {
      showToast('تعذر الاتصال بخادم التحديثات، حاول مرة أخرى', 'error');
    }
  });

  const handleApply = async () => {
    showToast('جاري تنزيل أحدث نسخة وتفريغ الكاش...', 'info');
    await forceApplyUpdateNow({ source: 'manual', forceReload: true });
  };

  document.getElementById('au-btn-force-update')?.addEventListener('click', handleApply);
  document.getElementById('au-btn-apply-new')?.addEventListener('click', handleApply);

  document.getElementById('au-btn-install')?.addEventListener('click', async () => {
    const res = await triggerInstall();
    if (res.outcome === 'accepted') {
      showToast('جاري تثبيت تطبيق DEVO على جهازك...', 'success');
    }
  });
}

function renderAppUpdatesState(snap) {
  const installedEl = document.getElementById('au-installed-version');
  const latestEl = document.getElementById('au-latest-version');
  const lastCheckedEl = document.getElementById('au-last-checked');
  const syncBadge = document.getElementById('au-sync-badge');
  const callout = document.getElementById('au-update-callout');
  const calloutTitle = document.getElementById('au-callout-title');
  const calloutDesc = document.getElementById('au-callout-desc');
  const forceLabel = document.getElementById('au-force-btn-label');
  const installBtn = document.getElementById('au-btn-install');
  const installLabel = document.getElementById('au-install-btn-label');
  const runModeEl = document.getElementById('au-run-mode');
  const runModeIcon = document.getElementById('au-run-mode-icon');
  const swStatusEl = document.getElementById('au-sw-status');
  const historyCountEl = document.getElementById('au-history-count');

  if (!installedEl) return;

  installedEl.textContent = `v${snap.installedVersion}`;
  latestEl.textContent = `v${snap.latestVersion}`;
  lastCheckedEl.textContent = `آخر فحص: ${formatArabicDateTime(snap.lastCheckedAt)}`;

  if (snap.status === 'checking') {
    syncBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border border-devo-info/30 bg-devo-info/10 text-devo-info';
    syncBadge.innerHTML = '<i class="ph ph-spinner animate-spin"></i><span>جاري الفحص...</span>';
  } else if (snap.hasUpdate || snap.status === 'update-available') {
    syncBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border border-devo-orange/40 bg-devo-orange/15 text-devo-orange';
    syncBadge.innerHTML = '<i class="ph ph-arrow-circle-up"></i><span>يتوفر تحديث جديد</span>';
  } else if (snap.status === 'updating') {
    syncBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border border-devo-orange/40 bg-devo-orange/15 text-devo-orange';
    syncBadge.innerHTML = '<i class="ph ph-arrows-clockwise animate-spin"></i><span>جاري التحديث...</span>';
  } else if (snap.status === 'offline') {
    syncBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border border-devo-gray bg-devo-black text-devo-muted';
    syncBadge.innerHTML = '<i class="ph ph-wifi-slash"></i><span>وضع عدم الاتصال</span>';
  } else if (snap.status === 'error') {
    syncBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border border-devo-error/40 bg-devo-error/10 text-devo-error';
    syncBadge.innerHTML = '<i class="ph ph-warning-circle"></i><span>تعذر الفحص</span>';
  } else {
    syncBadge.className = 'inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-lg border border-devo-success/30 bg-devo-success/10 text-devo-success';
    syncBadge.innerHTML = '<i class="ph ph-check-circle"></i><span>محدّث لآخر إصدار</span>';
  }

  if (callout) {
    if (snap.hasUpdate) {
      callout.classList.remove('hidden');
      if (calloutTitle) {
        calloutTitle.textContent = `يتوفر الإصدار الجديد v${snap.latestVersion} (${snap.remoteManifest?.title || 'تحديث للنظام'})`;
      }
      if (calloutDesc) {
        calloutDesc.textContent = 'اضغط لتنزيل الملفات الجديدة وتفريغ الكاش القديم فوراً بدون إعادة تثبيت التطبيق.';
      }
      if (forceLabel) forceLabel.textContent = `تحديث إلى v${snap.latestVersion}`;
    } else {
      callout.classList.add('hidden');
      if (forceLabel) forceLabel.textContent = 'تحديث فوري وتفريغ الكاش';
    }
  }

  // Install button: strictly hidden when already running in standalone installed PWA mode
  if (installBtn) {
    if (snap.isStandalone) {
      installBtn.classList.add('hidden');
    } else {
      installBtn.classList.remove('hidden');
      if (installLabel) {
        installLabel.textContent = snap.canInstallNative
          ? 'تثبيت التطبيق الآن'
          : snap.isIos
            ? 'طريقة التثبيت على iPhone'
            : 'تثبيت التطبيق';
      }
    }
  }

  if (runModeEl) {
    runModeEl.textContent = snap.isStandalone ? 'تطبيق مثبّت (PWA Standalone)' : 'متصفح الويب';
  }
  if (runModeIcon) {
    runModeIcon.className = snap.isStandalone ? 'ph ph-app-window text-xl' : 'ph ph-globe text-xl';
  }
  if (swStatusEl) {
    swStatusEl.textContent = snap.swVersion
      ? `${snap.swState} (${snap.swVersion})`
      : snap.swState;
  }
  if (historyCountEl) {
    historyCountEl.textContent = `${snap.updateHistory.length} سجل`;
  }

  renderDeviceHistoryList(snap.updateHistory);
  renderChangelogList(snap.remoteManifest, snap.installedVersion);
}

function renderDeviceHistoryList(history) {
  const listEl = document.getElementById('au-device-history-list');
  if (!listEl) return;

  if (!Array.isArray(history) || history.length === 0) {
    listEl.innerHTML = `
      <div class="py-8 text-center text-xs text-devo-muted space-y-2">
        <i class="ph ph-clock-counter-clockwise text-3xl opacity-40 block mx-auto"></i>
        <p>لم يتم تسجيل تحديثات سابقة على هذا الجهاز بعد.</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = history
    .map((entry) => {
      const badge = getSourceBadge(entry.source);
      const transition = entry.fromVersion
        ? `v${escapeHtml(entry.fromVersion)} → v${escapeHtml(entry.toVersion)}`
        : `v${escapeHtml(entry.toVersion)}`;

      return `
        <div class="p-3.5 rounded-xl bg-devo-black border border-devo-gray/70 space-y-1.5">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span dir="ltr" class="text-xs font-bold font-mono tabular-nums text-devo-text">${transition}</span>
            <span class="text-[11px] font-bold px-2 py-0.5 rounded-md border ${badge.cls}">${badge.label}</span>
          </div>
          ${entry.title ? `<p class="text-xs text-devo-muted">${escapeHtml(entry.title)}</p>` : ''}
          <p class="text-[11px] text-devo-muted/80 flex items-center gap-1">
            <i class="ph ph-calendar-blank text-xs"></i>
            <span>${formatArabicDateTime(entry.appliedAt)}</span>
          </p>
        </div>
      `;
    })
    .join('');
}

function renderChangelogList(manifest, installedVersion) {
  const listEl = document.getElementById('au-changelog-list');
  if (!listEl) return;

  const releases = manifest?.history || [];
  if (releases.length === 0) {
    listEl.innerHTML = `
      <div class="py-8 text-center text-xs text-devo-muted space-y-2">
        <i class="ph ph-cloud-slash text-3xl opacity-40 block mx-auto"></i>
        <p>جاري جلب سجل الإصدارات من الخادم...</p>
      </div>
    `;
    return;
  }

  listEl.innerHTML = releases
    .map((rel) => {
      const isCurrent = rel.version === installedVersion;
      const notesHtml = Array.isArray(rel.notes) && rel.notes.length > 0
        ? `<ul class="space-y-1.5 pt-2 border-t border-devo-gray/50">
            ${rel.notes
              .map(
                (n) => `<li class="flex items-start gap-2 text-xs text-devo-muted leading-relaxed">
                  <i class="ph ph-check text-devo-orange text-xs shrink-0 mt-1"></i>
                  <span>${escapeHtml(n)}</span>
                </li>`
              )
              .join('')}
          </ul>`
        : '';

      return `
        <div class="p-4 rounded-xl bg-devo-black border ${isCurrent ? 'border-devo-orange/50' : 'border-devo-gray/70'} space-y-2">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold font-mono tabular-nums text-devo-orange">v${escapeHtml(rel.version)}</span>
              ${
                isCurrent
                  ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-devo-success/15 text-devo-success border border-devo-success/30">مثبّت حالياً</span>`
                  : ''
              }
            </div>
            ${rel.buildDate ? `<span class="text-[11px] font-mono tabular-nums text-devo-muted">${escapeHtml(rel.buildDate)}</span>` : ''}
          </div>
          <p class="text-xs font-bold text-devo-text">${escapeHtml(rel.title)}</p>
          ${notesHtml}
        </div>
      `;
    })
    .join('');
}
