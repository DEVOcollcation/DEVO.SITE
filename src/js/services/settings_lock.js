import { supabase } from '../config/supabase.js';
import { showToast } from '../components/toast.js';
import { getCurrentSession } from './auth.js';
import {
    SETTINGS_LOCK_KEY,
    LOCK_MODES,
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
// 🔒 IN-MEMORY SETTINGS LOCK SESSION STATE (Never stored in localStorage)
// =========================================================================
let cachedLockConfig = undefined; // undefined = not fetched yet, null = not configured yet
let isUnlockedInMemory = false;
let autoLockTimerId = null;
let attemptState = { failedAttempts: 0, cooldownUntil: 0 };
let cooldownIntervalId = null;
let activeLockModalCleanup = null;
let onLockStateChangeCallbacks = new Set();

export const SETTINGS_VIEW_IDS = [
    'view-home-settings',
    'view-barcode-template-settings',
    'view-theme-manager',
    'view-backup-restore',
    'view-notification-settings',
    'view-data-management',
    'view-settings-lock',
    'view-app-updates',
    'view-system-reset'
];

// =========================================================================
// 📡 LOAD & SAVE LOCK CONFIG IN SUPABASE (home_settings)
// =========================================================================

export async function loadSettingsLockConfig(forceRefresh = false) {
    if (!forceRefresh && cachedLockConfig !== undefined) {
        return cachedLockConfig;
    }

    try {
        const { data, error } = await supabase
            .from('home_settings')
            .select('setting_value')
            .eq('setting_key', SETTINGS_LOCK_KEY)
            .maybeSingle();

        if (error) {
            console.warn('[SettingsLock] Failed to load config:', error.message);
            cachedLockConfig = null;
            return null;
        }

        cachedLockConfig = data?.setting_value ? normalizeLockConfig(data.setting_value) : null;
        return cachedLockConfig;
    } catch (err) {
        console.warn('[SettingsLock] Load error:', err);
        cachedLockConfig = null;
        return null;
    }
}

export async function saveSettingsLockConfig({ mode, pin = null, pattern = null, autoLockMinutes = 15, keepExisting = false }) {
    const existing = await loadSettingsLockConfig(true);
    const salt = existing?.salt || generateRandomSalt();

    let pinHash = keepExisting ? (existing?.pinHash || null) : null;
    let patternHash = keepExisting ? (existing?.patternHash || null) : null;

    if (pin !== null && pin !== undefined && pin !== '') {
        if (!validatePinFormat(pin)) {
            throw new Error('رمز PIN يجب أن يتكون من 4 إلى 8 أرقام فقط.');
        }
        pinHash = await hashLockSecret(String(pin).trim(), salt, 'pin');
    }

    if (Array.isArray(pattern) && pattern.length > 0) {
        if (!validatePatternSequence(pattern)) {
            throw new Error('نمط القفل يجب أن يصل بين 4 نقاط على الأقل.');
        }
        patternHash = await hashLockSecret(serializePattern(pattern), salt, 'pattern');
    }

    const payload = {
        enabled: true,
        mode,
        salt,
        pinHash,
        patternHash,
        autoLockMinutes: Math.max(0, Math.min(120, parseInt(autoLockMinutes ?? 15, 10) || 0)),
        updatedAt: new Date().toISOString()
    };

    const normalized = normalizeLockConfig(payload);
    if (!normalized) {
        throw new Error('بيانات القفل غير مكتملة للوضع المختار (تأكد من إدخال رمز PIN و/أو رسم النمط).');
    }

    const { error } = await supabase
        .from('home_settings')
        .upsert([{
            setting_key: SETTINGS_LOCK_KEY,
            setting_value: JSON.stringify(normalized),
            description: 'إعدادات قفل الأمان المشفّرة لقسم الإعدادات (PIN ونمط الـ 9 نقاط)'
        }], { onConflict: 'setting_key' });

    if (error) {
        throw new Error(error.message || 'تعذر حفظ إعدادات قفل الأمان في قاعدة البيانات.');
    }

    cachedLockConfig = normalized;
    markSessionUnlocked(normalized.autoLockMinutes);
    return normalized;
}

export async function clearSettingsLockConfig() {
    const { error } = await supabase
        .from('home_settings')
        .delete()
        .eq('setting_key', SETTINGS_LOCK_KEY);

    if (error) {
        throw new Error(error.message || 'تعذر إعادة تعيين قفل الأمان.');
    }

    cachedLockConfig = null;
    isUnlockedInMemory = false;
    clearAutoLockTimer();
    notifyLockStateChange();
}

// =========================================================================
// ⏱️ SESSION UNLOCK STATE & INACTIVITY AUTO-LOCK
// =========================================================================

export function isSettingsUnlocked() {
    return isUnlockedInMemory === true;
}

export function onSettingsLockStateChange(cb) {
    if (typeof cb === 'function') {
        onLockStateChangeCallbacks.add(cb);
    }
    return () => onLockStateChangeCallbacks.delete(cb);
}

function notifyLockStateChange() {
    updateSettingsLockHeaderButton();
    onLockStateChangeCallbacks.forEach(cb => {
        try { cb(isUnlockedInMemory); } catch (e) {}
    });
}

function clearAutoLockTimer() {
    if (autoLockTimerId) {
        clearTimeout(autoLockTimerId);
        autoLockTimerId = null;
    }
}

function scheduleAutoLock(minutes) {
    clearAutoLockTimer();
    const mins = parseInt(minutes, 10) || 0;
    if (mins <= 0 || !isUnlockedInMemory) return;

    autoLockTimerId = setTimeout(() => {
        if (isUnlockedInMemory) {
            lockSettingsNow({ silent: false, reason: 'auto' });
        }
    }, mins * 60 * 1000);
}

export function touchSettingsActivity() {
    if (!isUnlockedInMemory || !cachedLockConfig) return;
    if (cachedLockConfig.autoLockMinutes > 0) {
        scheduleAutoLock(cachedLockConfig.autoLockMinutes);
    }
}

function markSessionUnlocked(autoLockMinutes = 15) {
    isUnlockedInMemory = true;
    attemptState = { failedAttempts: 0, cooldownUntil: 0 };
    scheduleAutoLock(autoLockMinutes);
    notifyLockStateChange();
}

export function lockSettingsNow(options = {}) {
    const { silent = false, reason = 'manual' } = options;
    isUnlockedInMemory = false;
    clearAutoLockTimer();
    notifyLockStateChange();

    if (!silent) {
        showToast(
            reason === 'auto'
                ? 'تم قفل قسم الإعدادات تلقائياً بعد فترة الخمول'
                : 'تم قفل قسم الإعدادات بنجاح',
            'info'
        );
    }

    // If user is currently viewing a Settings page, move them back to Dashboard safely
    if (SETTINGS_VIEW_IDS.includes(window.currentAdminView) && typeof window.switchAdminView === 'function') {
        const dashLink = document.querySelector('[data-target="view-dashboard"]');
        window.switchAdminView('view-dashboard', dashLink);
    }
}

export function updateSettingsLockHeaderButton() {
    const wrapper = document.getElementById('settings-lock-header-actions');
    if (!wrapper) return;
    const inSettings = SETTINGS_VIEW_IDS.includes(window.currentAdminView);
    if (inSettings && isUnlockedInMemory) {
        wrapper.classList.remove('hidden');
        wrapper.classList.add('flex');
    } else {
        wrapper.classList.add('hidden');
        wrapper.classList.remove('flex');
    }
}

// Track owner activity inside Settings to refresh inactivity auto-lock timer
if (typeof window !== 'undefined') {
    ['pointerdown', 'keydown'].forEach(evt => {
        window.addEventListener(evt, () => {
            if (isUnlockedInMemory && SETTINGS_VIEW_IDS.includes(window.currentAdminView)) {
                touchSettingsActivity();
            }
        }, { passive: true });
    });
}

// =========================================================================
// 🕸️ REUSABLE 9-DOT INTERACTIVE PATTERN PAD (Mouse + Touch PointerEvents)
// =========================================================================

const NODE_COORDS = [
    { x: 50, y: 50 },  { x: 150, y: 50 },  { x: 250, y: 50 },
    { x: 50, y: 150 }, { x: 150, y: 150 }, { x: 250, y: 150 },
    { x: 50, y: 250 }, { x: 150, y: 250 }, { x: 250, y: 250 }
];

/**
 * Mounts an accessible, touch-friendly 3x3 pattern pad inside `container`.
 * Supports drag (PointerEvents), tap-to-connect fallback, midpoint auto-link,
 * error/success flash states, and clean teardown.
 */
export function mountPatternPad(container, options = {}) {
    if (!container) return { reset: () => {}, destroy: () => {}, setError: () => {} };

    const {
        onComplete = () => {},
        onChange = () => {},
        disabled = false,
        sizeClass = 'w-[240px] h-[240px] sm:w-[264px] sm:h-[264px]'
    } = options;

    let sequence = [];
    let isDrawing = false;
    let pointerPos = null;
    let statusState = 'idle'; // idle | active | error | success
    let isDisabled = Boolean(disabled);

    container.innerHTML = `
        <div class="relative mx-auto ${sizeClass} select-none" data-testid="settings-pattern-pad">
            <svg viewBox="0 0 300 300" class="w-full h-full touch-none cursor-pointer overflow-visible" role="application" aria-label="شبكة نمط القفل ذات الـ 9 نقاط">
                <g class="pattern-lines"></g>
                <line class="pattern-live-line hidden" stroke-width="5" stroke-linecap="round" opacity="0.55"></line>
                <g class="pattern-nodes">
                    ${NODE_COORDS.map((pt, idx) => `
                        <g class="pattern-node-group" data-node="${idx}" tabindex="0" role="button" aria-label="نقطة النمط ${idx + 1}">
                            <circle cx="${pt.x}" cy="${pt.y}" r="34" fill="transparent" class="pattern-hit"></circle>
                            <circle cx="${pt.x}" cy="${pt.y}" r="22" class="pattern-ring transition-all duration-150" fill="var(--devo-black, #0a0a0a)" stroke="var(--devo-gray, #262626)" stroke-width="2.5"></circle>
                            <circle cx="${pt.x}" cy="${pt.y}" r="7" class="pattern-dot transition-all duration-150" fill="var(--devo-muted, #a3a3a3)"></circle>
                        </g>
                    `).join('')}
                </g>
            </svg>
        </div>
    `;

    const svg = container.querySelector('svg');
    const linesGroup = container.querySelector('.pattern-lines');
    const liveLine = container.querySelector('.pattern-live-line');
    const nodeGroups = Array.from(container.querySelectorAll('.pattern-node-group'));

    function getStrokeColor() {
        if (statusState === 'error') return 'var(--devo-error, #ef4444)';
        if (statusState === 'success') return 'var(--devo-success, #10b981)';
        return 'var(--devo-orange, #f97316)';
    }

    function render() {
        const stroke = getStrokeColor();

        // Render connecting lines
        let linesHtml = '';
        for (let i = 0; i < sequence.length - 1; i++) {
            const from = NODE_COORDS[sequence[i]];
            const to = NODE_COORDS[sequence[i + 1]];
            linesHtml += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="5.5" stroke-linecap="round" opacity="0.9"></line>`;
        }
        linesGroup.innerHTML = linesHtml;

        // Render trailing line to pointer
        if (isDrawing && pointerPos && sequence.length > 0) {
            const last = NODE_COORDS[sequence[sequence.length - 1]];
            liveLine.setAttribute('x1', String(last.x));
            liveLine.setAttribute('y1', String(last.y));
            liveLine.setAttribute('x2', String(pointerPos.x));
            liveLine.setAttribute('y2', String(pointerPos.y));
            liveLine.setAttribute('stroke', stroke);
            liveLine.classList.remove('hidden');
        } else {
            liveLine.classList.add('hidden');
        }

        // Update node visuals
        nodeGroups.forEach((g, idx) => {
            const isSelected = sequence.includes(idx);
            const ring = g.querySelector('.pattern-ring');
            const dot = g.querySelector('.pattern-dot');

            if (isSelected) {
                ring.setAttribute('stroke', stroke);
                ring.setAttribute('stroke-width', '3.5');
                ring.setAttribute('r', '25');
                ring.setAttribute('fill', statusState === 'error'
                    ? 'color-mix(in srgb, var(--devo-error, #ef4444) 16%, var(--devo-black, #0a0a0a))'
                    : statusState === 'success'
                        ? 'color-mix(in srgb, var(--devo-success, #10b981) 16%, var(--devo-black, #0a0a0a))'
                        : 'color-mix(in srgb, var(--devo-orange, #f97316) 16%, var(--devo-black, #0a0a0a))');
                dot.setAttribute('fill', stroke);
                dot.setAttribute('r', '9');
            } else {
                ring.setAttribute('stroke', 'var(--devo-gray, #262626)');
                ring.setAttribute('stroke-width', '2.5');
                ring.setAttribute('r', '22');
                ring.setAttribute('fill', 'var(--devo-black, #0a0a0a)');
                dot.setAttribute('fill', 'var(--devo-muted, #a3a3a3)');
                dot.setAttribute('r', '7');
            }
        });
    }

    function clientToSvgPoint(clientX, clientY) {
        const rect = svg.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return {
            x: ((clientX - rect.left) / rect.width) * 300,
            y: ((clientY - rect.top) / rect.height) * 300
        };
    }

    function hitTestNode(svgPt, radius = 33) {
        if (!svgPt) return -1;
        for (let i = 0; i < NODE_COORDS.length; i++) {
            const dx = svgPt.x - NODE_COORDS[i].x;
            const dy = svgPt.y - NODE_COORDS[i].y;
            if (Math.hypot(dx, dy) <= radius) return i;
        }
        return -1;
    }

    function addNode(idx) {
        if (idx < 0 || idx > 8) return;
        const prevLen = sequence.length;
        sequence = appendPatternNode(sequence, idx);
        if (sequence.length !== prevLen) {
            onChange([...sequence]);
            render();
        }
    }

    function onPointerDown(e) {
        if (isDisabled) return;
        e.preventDefault();
        try { svg.setPointerCapture(e.pointerId); } catch {}
        statusState = 'active';
        sequence = [];
        isDrawing = true;
        pointerPos = clientToSvgPoint(e.clientX, e.clientY);
        const hit = hitTestNode(pointerPos, 35);
        if (hit !== -1) addNode(hit);
        render();
    }

    function onPointerMove(e) {
        if (!isDrawing || isDisabled) return;
        e.preventDefault();
        pointerPos = clientToSvgPoint(e.clientX, e.clientY);
        const hit = hitTestNode(pointerPos, 31);
        if (hit !== -1) addNode(hit);
        render();
    }

    function finishStroke() {
        if (!isDrawing) return;
        isDrawing = false;
        pointerPos = null;
        render();
        if (sequence.length > 0) {
            onComplete([...sequence]);
        }
    }

    // Keyboard accessibility: pressing Enter/Space on nodes builds pattern, Enter on last submits
    function onKeyDown(e) {
        if (isDisabled) return;
        const group = e.target.closest('.pattern-node-group');
        if (!group) return;
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            statusState = 'active';
            const idx = parseInt(group.dataset.node, 10);
            addNode(idx);
        }
    }

    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', finishStroke);
    svg.addEventListener('pointercancel', finishStroke);
    svg.addEventListener('keydown', onKeyDown);

    render();

    return {
        getSequence: () => [...sequence],
        setDisabled: (val) => { isDisabled = Boolean(val); },
        reset: () => {
            sequence = [];
            isDrawing = false;
            pointerPos = null;
            statusState = 'idle';
            onChange([]);
            render();
        },
        setError: () => {
            statusState = 'error';
            render();
            setTimeout(() => {
                if (statusState === 'error') {
                    sequence = [];
                    statusState = 'idle';
                    onChange([]);
                    render();
                }
            }, 650);
        },
        setSuccess: () => {
            statusState = 'success';
            render();
        },
        submitCurrent: () => {
            if (sequence.length > 0) onComplete([...sequence]);
        },
        destroy: () => {
            svg.removeEventListener('pointerdown', onPointerDown);
            svg.removeEventListener('pointermove', onPointerMove);
            svg.removeEventListener('pointerup', finishStroke);
            svg.removeEventListener('pointercancel', finishStroke);
            svg.removeEventListener('keydown', onKeyDown);
        }
    };
}

// =========================================================================
// 🚪 MAIN SETTINGS LOCK GATE (First-Run Setup + Unlock + Owner Recovery)
// =========================================================================

function getGateRoot() {
    let root = document.getElementById('settings-lock-gate-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'settings-lock-gate-root';
        document.body.appendChild(root);
    }
    return root;
}

function closeActiveGate() {
    if (cooldownIntervalId) {
        clearInterval(cooldownIntervalId);
        cooldownIntervalId = null;
    }
    if (typeof activeLockModalCleanup === 'function') {
        activeLockModalCleanup();
        activeLockModalCleanup = null;
    }
    const root = document.getElementById('settings-lock-gate-root');
    if (root) root.innerHTML = '';
}

/**
 * Ensures the Owner has unlocked the Settings section before revealing any
 * Settings tab. If no lock has been configured yet, guides the Owner through
 * creating their PIN and/or 9-dot Pattern immediately.
 */
export async function ensureSettingsUnlocked(onUnlocked, onCancel = null) {
    const { session } = getCurrentSession();
    const user = session?.user;
    if (!user || user.role !== 'owner') {
        showToast('عفواً، قسم الإعدادات مخصص لمالك النظام فقط', 'error');
        if (typeof onCancel === 'function') onCancel();
        return false;
    }

    if (isUnlockedInMemory) {
        touchSettingsActivity();
        if (typeof onUnlocked === 'function') onUnlocked();
        return true;
    }

    const config = await loadSettingsLockConfig(true);

    if (!config) {
        openFirstRunSetupGate(onUnlocked, onCancel);
        return false;
    }

    openUnlockGate(config, onUnlocked, onCancel);
    return false;
}

// -------------------------------------------------------------------------
// A. FIRST-RUN SETUP WIZARD (When Owner hasn't created a PIN/Pattern yet)
// -------------------------------------------------------------------------
function openFirstRunSetupGate(onUnlocked, onCancel) {
    closeActiveGate();
    const root = getGateRoot();

    let selectedMode = LOCK_MODES.EITHER;
    let firstPattern = [];
    let confirmPattern = [];
    let patternStep = 'draw'; // 'draw' | 'confirm'
    let activePad = null;

    root.innerHTML = `
        <div id="settings-lock-overlay" class="fixed inset-0 z-[9995] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
            <div class="w-full max-w-lg bg-devo-dark border border-devo-gray rounded-2xl shadow-devo-float overflow-hidden my-auto" role="dialog" aria-modal="true" aria-labelledby="sl-setup-title">
                <div class="p-5 border-b border-devo-gray flex items-center justify-between gap-3 bg-devo-black/60">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-devo-orange/15 border border-devo-orange/30 flex items-center justify-center text-devo-orange shrink-0">
                            <i class="ph ph-shield-check text-xl"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 id="sl-setup-title" class="text-base font-bold text-devo-text truncate">إعداد قفل أمان قسم الإعدادات</h3>
                            <p class="text-xs text-devo-muted">اختر طريقة الحماية لقسم الإعدادات بالكامل قبل الدخول</p>
                        </div>
                    </div>
                    <button type="button" id="sl-setup-close" aria-label="إغلاق" class="w-10 h-10 rounded-xl bg-devo-gray/40 hover:bg-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center transition-colors shrink-0">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>

                <div class="p-5 space-y-5 max-h-[82vh] overflow-y-auto custom-scrollbar">
                    <!-- Mode Selector -->
                    <div class="space-y-2">
                        <label class="block text-xs font-bold text-devo-muted">أسلوب الحماية المطلوب</label>
                        <div class="grid grid-cols-2 gap-2" id="sl-setup-mode-grid">
                            <button type="button" data-mode="either" class="sl-mode-btn px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-right flex items-center gap-2 border-devo-orange bg-devo-orange/15 text-devo-orange">
                                <i class="ph ph-squares-four text-base shrink-0"></i>
                                <span>PIN + النمط (أيهما)</span>
                            </button>
                            <button type="button" data-mode="both" class="sl-mode-btn px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-right flex items-center gap-2 border-devo-gray bg-devo-black text-devo-muted hover:text-devo-text">
                                <i class="ph ph-lock-laminated text-base shrink-0"></i>
                                <span>الاثنين معاً (مزدوج)</span>
                            </button>
                            <button type="button" data-mode="pin" class="sl-mode-btn px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-right flex items-center gap-2 border-devo-gray bg-devo-black text-devo-muted hover:text-devo-text">
                                <i class="ph ph-key text-base shrink-0"></i>
                                <span>رمز PIN فقط</span>
                            </button>
                            <button type="button" data-mode="pattern" class="sl-mode-btn px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-right flex items-center gap-2 border-devo-gray bg-devo-black text-devo-muted hover:text-devo-text">
                                <i class="ph ph-dots-nine text-base shrink-0"></i>
                                <span>نمط الـ 9 نقاط فقط</span>
                            </button>
                        </div>
                    </div>

                    <!-- PIN Section -->
                    <div id="sl-setup-pin-section" class="space-y-3 pt-2 border-t border-devo-gray/60">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-bold text-devo-text">رمز الـ PIN (من 4 إلى 8 أرقام)</span>
                            <span class="text-[11px] text-devo-muted">أرقام إنجليزية 0-9</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <input type="password" inputmode="numeric" maxlength="8" id="sl-setup-pin-1" placeholder="أدخل رمز PIN" autocomplete="new-password" class="w-full bg-devo-black border border-devo-gray focus:border-devo-orange rounded-xl px-3.5 py-2.5 text-sm text-devo-text font-mono tabular-nums tracking-widest outline-none text-center">
                            <input type="password" inputmode="numeric" maxlength="8" id="sl-setup-pin-2" placeholder="تأكيد رمز PIN" autocomplete="new-password" class="w-full bg-devo-black border border-devo-gray focus:border-devo-orange rounded-xl px-3.5 py-2.5 text-sm text-devo-text font-mono tabular-nums tracking-widest outline-none text-center">
                        </div>
                    </div>

                    <!-- Pattern Section -->
                    <div id="sl-setup-pattern-section" class="space-y-3 pt-2 border-t border-devo-gray/60">
                        <div class="flex items-center justify-between gap-2">
                            <div>
                                <span class="text-xs font-bold text-devo-text block">نمط الـ 9 نقاط</span>
                                <span id="sl-setup-pattern-hint" class="text-[11px] text-devo-muted">اسحب لتوصيل 4 نقاط على الأقل</span>
                            </div>
                            <button type="button" id="sl-setup-pattern-reset" class="px-2.5 py-1.5 rounded-lg bg-devo-black border border-devo-gray text-xs text-devo-muted hover:text-devo-text transition-colors whitespace-nowrap shrink-0">
                                إعادة الرسم
                            </button>
                        </div>
                        <div id="sl-setup-pattern-mount" class="py-1"></div>
                        <p id="sl-setup-pattern-status" class="text-center text-xs text-devo-muted min-h-[18px]"></p>
                    </div>

                    <!-- Auto-Lock Selector -->
                    <div class="pt-2 border-t border-devo-gray/60 flex items-center justify-between gap-3">
                        <label for="sl-setup-autolock" class="text-xs font-bold text-devo-muted">القفل التلقائي عند الخمول</label>
                        <select id="sl-setup-autolock" class="bg-devo-black border border-devo-gray rounded-lg px-3 py-2 text-xs text-devo-text outline-none focus:border-devo-orange">
                            <option value="15" selected>بعد 15 دقيقة</option>
                            <option value="5">بعد 5 دقائق</option>
                            <option value="30">بعد 30 دقيقة</option>
                            <option value="0">عند تحديث/إغلاق الصفحة فقط</option>
                        </select>
                    </div>

                    <div id="sl-setup-error" class="hidden text-xs text-devo-error bg-devo-error/10 border border-devo-error/30 rounded-xl p-3"></div>

                    <div class="flex items-center gap-3 pt-1">
                        <button type="button" id="sl-setup-cancel" class="px-5 py-2.5 rounded-xl border border-devo-gray text-devo-muted hover:text-devo-text hover:bg-devo-black text-sm font-bold transition-colors whitespace-nowrap">
                            إلغاء
                        </button>
                        <button type="button" id="sl-setup-save" class="flex-1 py-2.5 px-5 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 whitespace-nowrap">
                            <i class="ph ph-lock-key text-base"></i>
                            <span>حفظ القفل ودخول الإعدادات</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const pinSection = document.getElementById('sl-setup-pin-section');
    const patternSection = document.getElementById('sl-setup-pattern-section');
    const patternHint = document.getElementById('sl-setup-pattern-hint');
    const patternStatus = document.getElementById('sl-setup-pattern-status');
    const errorBox = document.getElementById('sl-setup-error');

    function showError(msg) {
        if (!msg) {
            errorBox.classList.add('hidden');
            errorBox.textContent = '';
        } else {
            errorBox.textContent = msg;
            errorBox.classList.remove('hidden');
        }
    }

    function resetPatternFlow() {
        firstPattern = [];
        confirmPattern = [];
        patternStep = 'draw';
        patternHint.textContent = 'اسحب لتوصيل 4 نقاط على الأقل';
        patternStatus.textContent = '';
        patternStatus.className = 'text-center text-xs text-devo-muted min-h-[18px]';
        activePad?.reset();
    }

    function updateModeVisibility() {
        const needsPin = selectedMode !== LOCK_MODES.PATTERN;
        const needsPattern = selectedMode !== LOCK_MODES.PIN;
        pinSection.classList.toggle('hidden', !needsPin);
        patternSection.classList.toggle('hidden', !needsPattern);

        document.querySelectorAll('#sl-setup-mode-grid .sl-mode-btn').forEach(btn => {
            const active = btn.dataset.mode === selectedMode;
            btn.className = active
                ? 'sl-mode-btn px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-right flex items-center gap-2 border-devo-orange bg-devo-orange/15 text-devo-orange'
                : 'sl-mode-btn px-3 py-2.5 rounded-xl border text-xs font-bold transition-all text-right flex items-center gap-2 border-devo-gray bg-devo-black text-devo-muted hover:text-devo-text';
        });
        showError('');
    }

    activePad = mountPatternPad(document.getElementById('sl-setup-pattern-mount'), {
        sizeClass: 'w-[220px] h-[220px]',
        onComplete: (seq) => {
            showError('');
            if (!validatePatternSequence(seq)) {
                patternStatus.textContent = 'يجب توصيل 4 نقاط على الأقل، حاول مجدداً';
                patternStatus.className = 'text-center text-xs text-devo-error font-bold min-h-[18px]';
                activePad.setError();
                return;
            }

            if (patternStep === 'draw') {
                firstPattern = seq;
                patternStep = 'confirm';
                patternHint.textContent = 'ارسم نفس النمط مرة أخرى للتأكيد';
                patternStatus.textContent = `تم التقاط النمط (${seq.length} نقاط) — أعد رسمه للتأكيد`;
                patternStatus.className = 'text-center text-xs text-devo-orange font-bold min-h-[18px]';
                activePad.setSuccess();
                setTimeout(() => {
                    if (patternStep === 'confirm') activePad.reset();
                }, 420);
            } else {
                if (serializePattern(seq) === serializePattern(firstPattern)) {
                    confirmPattern = seq;
                    patternHint.textContent = 'تم تأكيد النمط بنجاح';
                    patternStatus.textContent = 'النمط مطابق وجاهز للحفظ ✓';
                    patternStatus.className = 'text-center text-xs text-devo-success font-bold min-h-[18px]';
                    activePad.setSuccess();
                } else {
                    confirmPattern = [];
                    patternStatus.textContent = 'النمط غير مطابق للرسم الأول، أعد رسمه للتأكيد';
                    patternStatus.className = 'text-center text-xs text-devo-error font-bold min-h-[18px]';
                    activePad.setError();
                }
            }
        }
    });

    document.querySelectorAll('#sl-setup-mode-grid .sl-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedMode = btn.dataset.mode;
            updateModeVisibility();
        });
    });

    document.getElementById('sl-setup-pattern-reset')?.addEventListener('click', resetPatternFlow);

    const handleCancel = () => {
        closeActiveGate();
        if (typeof onCancel === 'function') onCancel();
    };
    document.getElementById('sl-setup-close')?.addEventListener('click', handleCancel);
    document.getElementById('sl-setup-cancel')?.addEventListener('click', handleCancel);

    document.getElementById('sl-setup-save')?.addEventListener('click', async () => {
        showError('');
        const needsPin = selectedMode !== LOCK_MODES.PATTERN;
        const needsPattern = selectedMode !== LOCK_MODES.PIN;

        let pinToSave = null;
        if (needsPin) {
            const p1 = (document.getElementById('sl-setup-pin-1')?.value || '').trim();
            const p2 = (document.getElementById('sl-setup-pin-2')?.value || '').trim();
            if (!validatePinFormat(p1)) {
                showError('رمز الـ PIN يجب أن يكون من 4 إلى 8 أرقام فقط.');
                return;
            }
            if (p1 !== p2) {
                showError('رمزا الـ PIN غير متطابقين، يرجى التأكد.');
                return;
            }
            pinToSave = p1;
        }

        let patternToSave = null;
        if (needsPattern) {
            if (!validatePatternSequence(confirmPattern)) {
                showError('يرجى رسم نمط الـ 9 نقاط ثم إعادة رسمه مرة ثانية للتأكيد.');
                return;
            }
            patternToSave = confirmPattern;
        }

        const saveBtn = document.getElementById('sl-setup-save');
        const autoLockMinutes = parseInt(document.getElementById('sl-setup-autolock')?.value || '15', 10);
        saveBtn.disabled = true;
        saveBtn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i><span>جاري التشفير والحفظ...</span>`;

        try {
            await saveSettingsLockConfig({
                mode: selectedMode,
                pin: pinToSave,
                pattern: patternToSave,
                autoLockMinutes
            });
            closeActiveGate();
            showToast('تم تفعيل قفل قسم الإعدادات بنجاح', 'success');
            if (typeof onUnlocked === 'function') onUnlocked();
        } catch (err) {
            showError(err.message || 'تعذر حفظ قفل الإعدادات');
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="ph ph-lock-key text-base"></i><span>حفظ القفل ودخول الإعدادات</span>`;
        }
    });

    updateModeVisibility();
    activeLockModalCleanup = () => {
        activePad?.destroy();
    };
}

// -------------------------------------------------------------------------
// B. UNLOCK GATE (PIN, 9-Dot Pattern, Either Switcher, or Dual Step)
// -------------------------------------------------------------------------
function openUnlockGate(config, onUnlocked, onCancel) {
    closeActiveGate();
    const root = getGateRoot();

    const mode = config.mode;
    // Active input method inside the dialog
    let currentMethod = mode === LOCK_MODES.PIN ? 'pin' : 'pattern';
    // When mode === 'both', step 1 is pattern, step 2 is PIN
    let dualStepPassedPattern = false;
    let pinBuffer = '';
    let activePad = null;
    let showRecovery = false;

    const { session } = getCurrentSession();
    const ownerUsername = session?.user?.username || '';

    function getHeaderSubtitle() {
        if (showRecovery) return 'أعد تأكيد كلمة مرور حساب المالك لإعادة ضبط القفل';
        if (mode === LOCK_MODES.BOTH) {
            return dualStepPassedPattern
                ? 'الخطوة 2 من 2: أدخل رمز الـ PIN لإكمال الدخول'
                : 'الخطوة 1 من 2: ارسم نمط الـ 9 نقاط أولاً';
        }
        if (mode === LOCK_MODES.EITHER) return 'افتح قسم الإعدادات بالنمط أو برمز الـ PIN';
        if (mode === LOCK_MODES.PATTERN) return 'ارسم نمط الـ 9 نقاط لفتح قسم الإعدادات';
        return 'أدخل رمز الـ PIN لفتح قسم الإعدادات';
    }

    root.innerHTML = `
        <div id="settings-lock-overlay" class="fixed inset-0 z-[9995] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
            <div class="w-full max-w-md bg-devo-dark border border-devo-gray rounded-2xl shadow-devo-float overflow-hidden my-auto" role="dialog" aria-modal="true" aria-labelledby="sl-unlock-title">
                <div class="p-5 border-b border-devo-gray flex items-center justify-between gap-3 bg-devo-black/60">
                    <div class="flex items-center gap-3 min-w-0">
                        <div class="w-10 h-10 rounded-xl bg-devo-orange/15 border border-devo-orange/30 flex items-center justify-center text-devo-orange shrink-0">
                            <i class="ph ph-lock-key text-xl"></i>
                        </div>
                        <div class="min-w-0">
                            <h3 id="sl-unlock-title" class="text-base font-bold text-devo-text truncate">قسم الإعدادات محمي</h3>
                            <p id="sl-unlock-subtitle" class="text-xs text-devo-muted truncate">${escapeHtml(getHeaderSubtitle())}</p>
                        </div>
                    </div>
                    <button type="button" id="sl-unlock-close" aria-label="إغلاق" class="w-10 h-10 rounded-xl bg-devo-gray/40 hover:bg-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center transition-colors shrink-0">
                        <i class="ph ph-x text-lg"></i>
                    </button>
                </div>

                <div class="p-5 space-y-4">
                    ${mode === LOCK_MODES.EITHER ? `
                        <div id="sl-method-tabs" class="grid grid-cols-2 gap-1 p-1 bg-devo-black border border-devo-gray rounded-xl">
                            <button type="button" data-method="pattern" class="sl-tab-btn py-2 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap">
                                <i class="ph ph-dots-nine text-base"></i>
                                <span>نمط الـ 9 نقاط</span>
                            </button>
                            <button type="button" data-method="pin" class="sl-tab-btn py-2 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap">
                                <i class="ph ph-key text-base"></i>
                                <span>رمز الـ PIN</span>
                            </button>
                        </div>
                    ` : ''}

                    ${mode === LOCK_MODES.BOTH ? `
                        <div id="sl-dual-progress" class="flex items-center justify-center gap-3 text-xs font-bold">
                            <span id="sl-dual-step-1" class="text-devo-orange">1. نمط الـ 9 نقاط</span>
                            <span class="text-devo-muted">←</span>
                            <span id="sl-dual-step-2" class="text-devo-muted">2. رمز الـ PIN</span>
                        </div>
                    ` : ''}

                    <div id="sl-unlock-error" class="hidden text-xs text-devo-error bg-devo-error/10 border border-devo-error/30 rounded-xl p-3 text-center font-bold"></div>

                    <!-- Pattern Unlock Panel -->
                    <div id="sl-panel-pattern" class="space-y-3">
                        <div id="sl-unlock-pattern-mount" class="py-1"></div>
                        <p class="text-center text-[11px] text-devo-muted">اسحب إصبعك أو المؤشر لربط نقاط النمط المحفوظ</p>
                    </div>

                    <!-- PIN Unlock Panel -->
                    <div id="sl-panel-pin" class="hidden space-y-4">
                        <div class="bg-devo-black border border-devo-gray rounded-xl py-3.5 px-4 flex items-center justify-center gap-2.5 min-h-[54px]" id="sl-pin-dots" aria-live="polite" aria-label="حقل رمز الـ PIN">
                            <span class="text-xs text-devo-muted">أدخل رمز الـ PIN</span>
                        </div>

                        <div dir="ltr" class="grid grid-cols-3 gap-2.5 max-w-[270px] mx-auto">
                            ${[1,2,3,4,5,6,7,8,9].map(d => `
                                <button type="button" data-digit="${d}" class="sl-pin-key h-12 rounded-xl bg-devo-black hover:bg-devo-gray border border-devo-gray text-devo-text font-mono tabular-nums text-lg font-bold transition-all active:scale-95">
                                    ${d}
                                </button>
                            `).join('')}
                            <button type="button" id="sl-pin-clear" class="h-12 rounded-xl bg-devo-black hover:bg-devo-gray border border-devo-gray text-devo-muted hover:text-devo-text text-xs font-bold transition-all">
                                مسح
                            </button>
                            <button type="button" data-digit="0" class="sl-pin-key h-12 rounded-xl bg-devo-black hover:bg-devo-gray border border-devo-gray text-devo-text font-mono tabular-nums text-lg font-bold transition-all active:scale-95">
                                0
                            </button>
                            <button type="button" id="sl-pin-backspace" aria-label="حذف آخر رقم" class="h-12 rounded-xl bg-devo-black hover:bg-devo-gray border border-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center transition-all">
                                <i class="ph ph-backspace text-lg"></i>
                            </button>
                        </div>

                        <button type="button" id="sl-pin-submit" class="w-full py-2.5 px-4 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
                            <i class="ph ph-lock-open text-base"></i>
                            <span>تأكيد وفتح الإعدادات</span>
                        </button>
                    </div>

                    <!-- Owner Password Recovery Panel -->
                    <div id="sl-panel-recovery" class="hidden space-y-3">
                        <div class="bg-devo-black border border-devo-gray rounded-xl p-3 text-xs text-devo-muted leading-relaxed">
                            لإعادة ضبط القفل في حالة النسيان، أدخل كلمة مرور حساب المالك (<span class="text-devo-text font-bold font-mono">${escapeHtml(ownerUsername)}</span>) للتحقق من هويتك.
                        </div>
                        <input type="password" id="sl-recovery-password" placeholder="كلمة مرور حساب المالك..." autocomplete="current-password" class="w-full bg-devo-black border border-devo-gray focus:border-devo-orange rounded-xl px-3.5 py-2.5 text-sm text-devo-text outline-none">
                        <div class="flex gap-2">
                            <button type="button" id="sl-recovery-back" class="px-4 py-2.5 rounded-xl border border-devo-gray text-devo-muted hover:text-devo-text text-xs font-bold">
                                رجوع
                            </button>
                            <button type="button" id="sl-recovery-confirm" class="flex-1 py-2.5 px-4 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs font-bold transition-colors">
                                تحقق وأعد إعداد القفل
                            </button>
                        </div>
                    </div>

                    <div class="pt-2 border-t border-devo-gray/50 flex items-center justify-between text-xs">
                        <button type="button" id="sl-toggle-recovery" class="text-devo-muted hover:text-devo-orange transition-colors">
                            نسيت الرمز أو النمط؟
                        </button>
                        <button type="button" id="sl-unlock-cancel" class="text-devo-muted hover:text-devo-text transition-colors">
                            إلغاء والعودة
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const subtitleEl = document.getElementById('sl-unlock-subtitle');
    const errorEl = document.getElementById('sl-unlock-error');
    const panelPattern = document.getElementById('sl-panel-pattern');
    const panelPin = document.getElementById('sl-panel-pin');
    const panelRecovery = document.getElementById('sl-panel-recovery');
    const pinDotsEl = document.getElementById('sl-pin-dots');

    function setUnlockError(msg) {
        if (!msg) {
            errorEl.classList.add('hidden');
            errorEl.textContent = '';
        } else {
            errorEl.textContent = msg;
            errorEl.classList.remove('hidden');
        }
    }

    function renderPinDots() {
        if (!pinBuffer.length) {
            pinDotsEl.innerHTML = `<span class="text-xs text-devo-muted">أدخل رمز الـ PIN</span>`;
            return;
        }
        pinDotsEl.innerHTML = Array.from({ length: pinBuffer.length }).map(() =>
            `<span class="w-3 h-3 rounded-full bg-devo-orange transition-transform"></span>`
        ).join('');
    }

    function startCooldownTicker() {
        if (cooldownIntervalId) clearInterval(cooldownIntervalId);
        const tick = () => {
            const rem = Math.ceil((attemptState.cooldownUntil - Date.now()) / 1000);
            if (rem > 0) {
                setUnlockError(`تم إيقاف المحاولات مؤقتاً — انتظر ${rem} ثانية`);
                activePad?.setDisabled(true);
            } else {
                clearInterval(cooldownIntervalId);
                cooldownIntervalId = null;
                setUnlockError('');
                activePad?.setDisabled(false);
            }
        };
        tick();
        cooldownIntervalId = setInterval(tick, 1000);
    }

    function updatePanels() {
        subtitleEl.textContent = getHeaderSubtitle();
        panelRecovery.classList.toggle('hidden', !showRecovery);
        panelPattern.classList.toggle('hidden', showRecovery || currentMethod !== 'pattern');
        panelPin.classList.toggle('hidden', showRecovery || currentMethod !== 'pin');

        const toggleRecBtn = document.getElementById('sl-toggle-recovery');
        if (toggleRecBtn) {
            toggleRecBtn.textContent = showRecovery ? 'العودة لشاشة القفل' : 'نسيت الرمز أو النمط؟';
        }

        document.querySelectorAll('#sl-method-tabs .sl-tab-btn').forEach(btn => {
            const isActive = !showRecovery && btn.dataset.method === currentMethod;
            btn.className = isActive
                ? 'sl-tab-btn py-2 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap bg-devo-orange text-white'
                : 'sl-tab-btn py-2 px-3 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap text-devo-muted hover:text-devo-text';
        });

        const step1El = document.getElementById('sl-dual-step-1');
        const step2El = document.getElementById('sl-dual-step-2');
        if (step1El && step2El) {
            step1El.className = dualStepPassedPattern ? 'text-devo-success' : 'text-devo-orange';
            step2El.className = dualStepPassedPattern ? 'text-devo-orange' : 'text-devo-muted';
        }
    }

    async function completeUnlock() {
        markSessionUnlocked(config.autoLockMinutes);
        closeActiveGate();
        showToast('تم فتح قسم الإعدادات بنجاح', 'success');
        if (typeof onUnlocked === 'function') onUnlocked();
    }

    async function verifyPatternInput(seq) {
        const preCheck = evaluateLockAttempt(attemptState, false, Date.now());
        if (attemptState.cooldownUntil > Date.now()) {
            startCooldownTicker();
            activePad?.setError();
            return;
        }
        if (!validatePatternSequence(seq)) {
            setUnlockError('يجب توصيل 4 نقاط على الأقل');
            activePad?.setError();
            return;
        }

        const hash = await hashLockSecret(serializePattern(seq), config.salt, 'pattern');
        const isMatch = constantTimeEqual(hash, config.patternHash);
        const result = evaluateLockAttempt(attemptState, isMatch, Date.now());
        attemptState = result.nextState;

        if (!result.allowed) {
            activePad?.setError();
            if (result.lockedOut) {
                startCooldownTicker();
            } else {
                setUnlockError(`النمط غير صحيح (متبقي ${result.attemptsLeft} محاولات)`);
            }
            return;
        }

        setUnlockError('');
        activePad?.setSuccess();

        if (mode === LOCK_MODES.BOTH && !dualStepPassedPattern) {
            dualStepPassedPattern = true;
            setTimeout(() => {
                currentMethod = 'pin';
                updatePanels();
            }, 350);
            return;
        }

        setTimeout(() => completeUnlock(), 220);
    }

    async function verifyPinInput() {
        if (attemptState.cooldownUntil > Date.now()) {
            startCooldownTicker();
            return;
        }
        if (!validatePinFormat(pinBuffer)) {
            setUnlockError('أدخل رمز PIN من 4 إلى 8 أرقام');
            return;
        }

        const hash = await hashLockSecret(pinBuffer, config.salt, 'pin');
        const isMatch = constantTimeEqual(hash, config.pinHash);
        const result = evaluateLockAttempt(attemptState, isMatch, Date.now());
        attemptState = result.nextState;

        if (!result.allowed) {
            pinBuffer = '';
            renderPinDots();
            if (result.lockedOut) {
                startCooldownTicker();
            } else {
                setUnlockError(`رمز PIN غير صحيح (متبقي ${result.attemptsLeft} محاولات)`);
            }
            return;
        }

        setUnlockError('');
        await completeUnlock();
    }

    activePad = mountPatternPad(document.getElementById('sl-unlock-pattern-mount'), {
        onComplete: verifyPatternInput
    });

    // Mode switcher tabs (for 'either' mode)
    document.querySelectorAll('#sl-method-tabs .sl-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showRecovery = false;
            currentMethod = btn.dataset.method;
            setUnlockError('');
            updatePanels();
        });
    });

    // PIN keypad buttons
    document.querySelectorAll('.sl-pin-key').forEach(btn => {
        btn.addEventListener('click', () => {
            if (attemptState.cooldownUntil > Date.now()) return;
            if (pinBuffer.length >= 8) return;
            pinBuffer += btn.dataset.digit;
            setUnlockError('');
            renderPinDots();
        });
    });

    document.getElementById('sl-pin-clear')?.addEventListener('click', () => {
        pinBuffer = '';
        renderPinDots();
    });

    document.getElementById('sl-pin-backspace')?.addEventListener('click', () => {
        pinBuffer = pinBuffer.slice(0, -1);
        renderPinDots();
    });

    document.getElementById('sl-pin-submit')?.addEventListener('click', verifyPinInput);

    // Keyboard entry for PIN when PIN panel is active
    const onGlobalKeydown = (e) => {
        if (showRecovery || currentMethod !== 'pin') return;
        if (e.key >= '0' && e.key <= '9') {
            if (pinBuffer.length < 8) {
                pinBuffer += e.key;
                setUnlockError('');
                renderPinDots();
            }
        } else if (e.key === 'Backspace') {
            pinBuffer = pinBuffer.slice(0, -1);
            renderPinDots();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            verifyPinInput();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };
    window.addEventListener('keydown', onGlobalKeydown);

    // Recovery toggle
    document.getElementById('sl-toggle-recovery')?.addEventListener('click', () => {
        showRecovery = !showRecovery;
        setUnlockError('');
        updatePanels();
        if (showRecovery) {
            setTimeout(() => document.getElementById('sl-recovery-password')?.focus(), 60);
        }
    });

    document.getElementById('sl-recovery-back')?.addEventListener('click', () => {
        showRecovery = false;
        setUnlockError('');
        updatePanels();
    });

    document.getElementById('sl-recovery-confirm')?.addEventListener('click', async () => {
        const pwd = (document.getElementById('sl-recovery-password')?.value || '').trim();
        if (!pwd) {
            setUnlockError('أدخل كلمة مرور حساب المالك أولاً');
            return;
        }
        const btn = document.getElementById('sl-recovery-confirm');
        btn.disabled = true;
        btn.textContent = 'جاري التحقق...';
        try {
            const email = ownerUsername.trim().toLowerCase() + '@staff.devo.internal';
            const { error } = await supabase.auth.signInWithPassword({ email, password: pwd });
            if (error) {
                setUnlockError('كلمة مرور حساب المالك غير صحيحة');
                btn.disabled = false;
                btn.textContent = 'تحقق وأعد إعداد القفل';
                return;
            }
            attemptState = { failedAttempts: 0, cooldownUntil: 0 };
            showToast('تم التحقق من هويتك — قم بإنشاء قفل جديد الآن', 'info');
            openFirstRunSetupGate(onUnlocked, onCancel);
        } catch (err) {
            setUnlockError('حدث خطأ أثناء التحقق، حاول مرة أخرى');
            btn.disabled = false;
            btn.textContent = 'تحقق وأعد إعداد القفل';
        }
    });

    const handleCancel = () => {
        closeActiveGate();
        if (typeof onCancel === 'function') onCancel();
    };
    document.getElementById('sl-unlock-close')?.addEventListener('click', handleCancel);
    document.getElementById('sl-unlock-cancel')?.addEventListener('click', handleCancel);

    updatePanels();
    if (attemptState.cooldownUntil > Date.now()) {
        startCooldownTicker();
    }

    activeLockModalCleanup = () => {
        activePad?.destroy();
        window.removeEventListener('keydown', onGlobalKeydown);
    };
}

// Expose manual lock helper globally for header button
if (typeof window !== 'undefined') {
    window.lockSettingsNow = () => lockSettingsNow({ silent: false, reason: 'manual' });
}
