import { showToast } from '../../components/toast.js';
import { requireAuth } from '../../services/auth.js';
import {
    LOCK_MODES,
    validatePinFormat,
    validatePatternSequence,
    serializePattern
} from '../../services/data_management_logic.js';
import {
    loadSettingsLockConfig,
    saveSettingsLockConfig,
    lockSettingsNow,
    mountPatternPad
} from '../../services/settings_lock.js';

// =========================================================================
// 🔐 DEDICATED SETTINGS LOCK PAGE STATE
// =========================================================================
let isLockPageInitialized = false;
let lockPadInstance = null;
let lockFirstPattern = [];
let lockConfirmPattern = [];
let lockPatternStep = 'draw';

// =========================================================================
// 🚀 INITIALIZATION
// =========================================================================
export async function initSettingsLockView() {
    const user = requireAuth(['owner']);
    if (!user || user.role !== 'owner') {
        showToast('هذه الصفحة مخصصة لمالك النظام فقط', 'error');
        return;
    }

    if (!isLockPageInitialized) {
        renderSettingsLockPage();
        bindSettingsLockEvents();
        isLockPageInitialized = true;
    }

    await refreshSettingsLockPageUI();
}

// =========================================================================
// 🎨 PAGE RENDERING
// =========================================================================
function renderSettingsLockPage() {
    const container = document.getElementById('settings-lock-page-content');
    if (!container) return;

    container.innerHTML = `
        <div class="animate-fade-in space-y-5 max-w-[1200px] mx-auto pb-10">
            <!-- Top Header & Instant Lock Banner -->
            <div class="bg-devo-dark border border-devo-gray rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="space-y-1">
                    <h2 class="text-lg sm:text-xl font-bold text-devo-text flex items-center gap-2">
                        <i class="ph ph-shield-check text-devo-orange text-2xl shrink-0"></i>
                        <span>حماية قسم الإعدادات بالكامل</span>
                    </h2>
                    <p id="slp-status-summary" class="text-xs text-devo-muted">جاري تحميل حالة القفل...</p>
                </div>
                <button type="button" id="slp-lock-now-btn" class="px-4 py-2.5 rounded-xl bg-devo-black hover:bg-devo-gray border border-devo-gray hover:border-devo-orange/50 text-devo-text text-xs font-bold transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer">
                    <i class="ph ph-lock-key text-base text-devo-orange"></i>
                    <span>قفل الإعدادات الآن</span>
                </button>
            </div>

            <!-- Configuration Grid -->
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <!-- Mode, Auto-Lock & PIN Config -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl p-5 space-y-4">
                    <h3 class="text-sm font-bold text-devo-text pb-2.5 border-b border-devo-gray flex items-center gap-2">
                        <i class="ph ph-key text-devo-orange text-base"></i>
                        <span>وضع التحقق ورمز الـ PIN</span>
                    </h3>

                    <div>
                        <label for="slp-mode-select" class="block text-xs text-devo-muted mb-1.5">أسلوب الدخول لقسم الإعدادات</label>
                        <select id="slp-mode-select" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange cursor-pointer">
                            <option value="either">PIN + نمط الـ 9 نقاط (الفتح بأيهما)</option>
                            <option value="both">PIN + نمط الـ 9 نقاط معاً (تحقق مزدوج إلزامي)</option>
                            <option value="pin">رمز الـ PIN فقط</option>
                            <option value="pattern">نمط الـ 9 نقاط فقط</option>
                        </select>
                    </div>

                    <div>
                        <label for="slp-autolock-select" class="block text-xs text-devo-muted mb-1.5">القفل التلقائي عند الخمول</label>
                        <select id="slp-autolock-select" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange cursor-pointer">
                            <option value="15">بعد 15 دقيقة من عدم النشاط</option>
                            <option value="5">بعد 5 دقائق من عدم النشاط</option>
                            <option value="30">بعد 30 دقيقة من عدم النشاط</option>
                            <option value="0">عند تحديث أو إغلاق الصفحة فقط</option>
                        </select>
                    </div>

                    <div id="slp-pin-fields" class="space-y-3 pt-2 border-t border-devo-gray/60">
                        <p class="text-xs font-bold text-devo-text">تعيين / تغيير رمز PIN (اتركه فارغاً للإبقاء على الرمز الحالي)</p>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input type="password" inputmode="numeric" maxlength="8" id="slp-pin-1" placeholder="رمز PIN جديد (4-8 أرقام)" autocomplete="new-password" class="w-full bg-devo-black border border-devo-gray focus:border-devo-orange rounded-lg px-3 py-2.5 text-sm text-devo-text font-mono tabular-nums text-center outline-none">
                            <input type="password" inputmode="numeric" maxlength="8" id="slp-pin-2" placeholder="تأكيد رمز PIN" autocomplete="new-password" class="w-full bg-devo-black border border-devo-gray focus:border-devo-orange rounded-lg px-3 py-2.5 text-sm text-devo-text font-mono tabular-nums text-center outline-none">
                        </div>
                    </div>

                    <div id="slp-error" class="hidden text-xs text-devo-error bg-devo-error/10 border border-devo-error/30 rounded-lg p-3"></div>

                    <button type="button" id="slp-save-btn" class="w-full py-2.5 px-4 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 cursor-pointer">
                        <i class="ph ph-floppy-disk text-base"></i>
                        <span>حفظ إعدادات قفل الأمان</span>
                    </button>
                </div>

                <!-- 9-Dot Pattern Config -->
                <div id="slp-pattern-card" class="bg-devo-dark border border-devo-gray rounded-xl p-5 space-y-3 transition-opacity">
                    <div class="flex items-center justify-between gap-2 pb-2.5 border-b border-devo-gray">
                        <div>
                            <h3 class="text-sm font-bold text-devo-text flex items-center gap-2">
                                <i class="ph ph-dots-nine text-devo-orange text-base"></i>
                                <span>تعيين / إعادة رسم نمط الـ 9 نقاط</span>
                            </h3>
                            <p id="slp-pattern-hint" class="text-xs text-devo-muted mt-0.5">ارسم نمطاً جديداً من 4 نقاط على الأقل ثم أعد رسمه للتأكيد</p>
                        </div>
                        <button type="button" id="slp-pattern-reset" class="px-3 py-1.5 rounded-lg bg-devo-black border border-devo-gray text-xs text-devo-muted hover:text-devo-text transition-colors whitespace-nowrap shrink-0 cursor-pointer">
                            إعادة الرسم
                        </button>
                    </div>
                    <div id="slp-pattern-mount" class="py-2"></div>
                    <p id="slp-pattern-status" class="text-center text-xs text-devo-muted min-h-[18px]">اتركه بدون رسم إذا كنت تريد الإبقاء على النمط الحالي</p>
                </div>
            </div>
        </div>
    `;
}

// =========================================================================
// 🎮 EVENT BINDING & STATE SYNC
// =========================================================================
function bindSettingsLockEvents() {
    document.getElementById('slp-lock-now-btn')?.addEventListener('click', () => lockSettingsNow({ reason: 'manual' }));
    document.getElementById('slp-mode-select')?.addEventListener('change', syncLockPageModeFields);
    document.getElementById('slp-pattern-reset')?.addEventListener('click', resetLockPatternEditor);
    document.getElementById('slp-save-btn')?.addEventListener('click', handleSaveSettingsLock);
}

export async function refreshSettingsLockPageUI() {
    const config = await loadSettingsLockConfig(true);
    const summaryEl = document.getElementById('slp-status-summary');
    const modeSelect = document.getElementById('slp-mode-select');
    const autoLockSelect = document.getElementById('slp-autolock-select');

    const modeLabels = {
        pin: 'رمز PIN فقط',
        pattern: 'نمط الـ 9 نقاط فقط',
        either: 'PIN + نمط الـ 9 نقاط (الفتح بأيهما)',
        both: 'PIN + نمط الـ 9 نقاط (تحقق مزدوج إلزامي)'
    };

    if (config) {
        if (modeSelect) {
            modeSelect.value = config.mode;
            modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (autoLockSelect) {
            autoLockSelect.value = String(config.autoLockMinutes ?? 15);
            autoLockSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (summaryEl) {
            const autoLabel = config.autoLockMinutes > 0
                ? `قفل تلقائي بعد ${config.autoLockMinutes} دقيقة`
                : 'قفل عند تحديث/إغلاق الصفحة';
            summaryEl.textContent = `القفل مفعّل · ${modeLabels[config.mode] || config.mode} · ${autoLabel}`;
        }
    } else if (summaryEl) {
        summaryEl.textContent = 'لم يتم تفعيل قفل الأمان بعد — قم بضبطه وحفظه الآن';
    }

    syncLockPageModeFields();
    mountLockPatternEditor();
}

function syncLockPageModeFields() {
    const mode = document.getElementById('slp-mode-select')?.value || LOCK_MODES.EITHER;
    const pinFields = document.getElementById('slp-pin-fields');
    const patternCard = document.getElementById('slp-pattern-card');
    if (pinFields) pinFields.classList.toggle('hidden', mode === LOCK_MODES.PATTERN);
    if (patternCard) patternCard.classList.toggle('opacity-50', mode === LOCK_MODES.PIN);
}

function mountLockPatternEditor() {
    const mountEl = document.getElementById('slp-pattern-mount');
    if (!mountEl) return;

    lockPadInstance?.destroy();
    lockFirstPattern = [];
    lockConfirmPattern = [];
    lockPatternStep = 'draw';

    const hintEl = document.getElementById('slp-pattern-hint');
    const statusEl = document.getElementById('slp-pattern-status');

    lockPadInstance = mountPatternPad(mountEl, {
        sizeClass: 'w-[228px] h-[228px]',
        onComplete: (seq) => {
            if (!validatePatternSequence(seq)) {
                if (statusEl) {
                    statusEl.textContent = 'يجب توصيل 4 نقاط على الأقل';
                    statusEl.className = 'text-center text-xs text-devo-error font-bold min-h-[18px]';
                }
                lockPadInstance.setError();
                return;
            }
            if (lockPatternStep === 'draw') {
                lockFirstPattern = seq;
                lockPatternStep = 'confirm';
                if (hintEl) hintEl.textContent = 'ارسم نفس النمط مرة ثانية للتأكيد';
                if (statusEl) {
                    statusEl.textContent = `تم رسم النمط (${seq.length} نقاط) — أعد رسمه للتأكيد`;
                    statusEl.className = 'text-center text-xs text-devo-orange font-bold min-h-[18px]';
                }
                lockPadInstance.setSuccess();
                setTimeout(() => { if (lockPatternStep === 'confirm') lockPadInstance.reset(); }, 400);
            } else {
                if (serializePattern(seq) === serializePattern(lockFirstPattern)) {
                    lockConfirmPattern = seq;
                    if (hintEl) hintEl.textContent = 'النمط الجديد جاهز للحفظ';
                    if (statusEl) {
                        statusEl.textContent = 'تم تأكيد النمط الجديد بنجاح — اضغط «حفظ إعدادات قفل الأمان»';
                        statusEl.className = 'text-center text-xs text-devo-success font-bold min-h-[18px]';
                    }
                    lockPadInstance.setSuccess();
                } else {
                    lockConfirmPattern = [];
                    if (statusEl) {
                        statusEl.textContent = 'النمط غير مطابق، أعد الرسم للتأكيد';
                        statusEl.className = 'text-center text-xs text-devo-error font-bold min-h-[18px]';
                    }
                    lockPadInstance.setError();
                }
            }
        }
    });
}

function resetLockPatternEditor() {
    lockFirstPattern = [];
    lockConfirmPattern = [];
    lockPatternStep = 'draw';
    const hintEl = document.getElementById('slp-pattern-hint');
    const statusEl = document.getElementById('slp-pattern-status');
    if (hintEl) hintEl.textContent = 'ارسم نمطاً جديداً من 4 نقاط على الأقل ثم أعد رسمه للتأكيد';
    if (statusEl) {
        statusEl.textContent = 'اتركه بدون رسم إذا كنت تريد الإبقاء على النمط الحالي';
        statusEl.className = 'text-center text-xs text-devo-muted min-h-[18px]';
    }
    lockPadInstance?.reset();
}

async function handleSaveSettingsLock() {
    const errEl = document.getElementById('slp-error');
    const showErr = (m) => {
        if (!errEl) return;
        errEl.textContent = m || '';
        errEl.classList.toggle('hidden', !m);
    };
    showErr('');

    const mode = document.getElementById('slp-mode-select')?.value || LOCK_MODES.EITHER;
    const autoLockMinutes = parseInt(document.getElementById('slp-autolock-select')?.value || '15', 10);
    const pin1 = (document.getElementById('slp-pin-1')?.value || '').trim();
    const pin2 = (document.getElementById('slp-pin-2')?.value || '').trim();

    if (pin1 || pin2) {
        if (!validatePinFormat(pin1)) return showErr('رمز PIN يجب أن يتكون من 4 إلى 8 أرقام فقط.');
        if (pin1 !== pin2) return showErr('رمزا PIN غير متطابقين.');
    }

    const btn = document.getElementById('slp-save-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i><span>جاري الحفظ...</span>`;

    try {
        await saveSettingsLockConfig({
            mode,
            pin: pin1 || null,
            pattern: lockConfirmPattern.length >= 4 ? lockConfirmPattern : null,
            autoLockMinutes,
            keepExisting: true
        });
        if (document.getElementById('slp-pin-1')) document.getElementById('slp-pin-1').value = '';
        if (document.getElementById('slp-pin-2')) document.getElementById('slp-pin-2').value = '';
        resetLockPatternEditor();
        await refreshSettingsLockPageUI();
        showToast('تم تحديث إعدادات قفل قسم الإعدادات بنجاح', 'success');
    } catch (err) {
        showErr(err.message || 'تعذر حفظ إعدادات القفل');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-floppy-disk text-base"></i><span>حفظ إعدادات قفل الأمان</span>`;
    }
}
