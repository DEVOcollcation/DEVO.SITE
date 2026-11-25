import { findModelByCode, checkIsWorker } from './gallery.js?v=18.2';
import { classifyBarcodeLookupResult } from '../../services/barcode_lookup_logic.js';
import {
    classifyCameraError,
    getCameraStatusMessage,
    shouldAutoStartCamera,
    getScannerFormatsToSupport,
    computeScannerQrBox,
    shouldSkipDuplicateScan
} from '../../services/barcode_camera_logic.js';
import { showToast } from '../../components/toast.js';
import { supabase } from '../../config/supabase.js';

const BARCODE_SETTINGS_CACHE_KEY = 'devo_barcode_settings_cache';
const PREFERRED_CAMERA_STORAGE_KEY = 'devo_preferred_camera_id';
const SCAN_STATE = {
    NOT_STARTED: 1,
    SCANNING: 2,
    PAUSED: 3
};

let html5QrCode = null;
let isScannerRunning = false;
let isStartingScanner = false;
let isScannerLocked = false;
let isBarcodeViewInitialized = false;
let selectedCameraId = null;
let scanMode = 'both';
let matchType = 'both';
let scannerOpChain = Promise.resolve();
let unlockSafetyTimer = null;
let sharedAudioCtx = null;
let lastScannedCode = '';
let lastScannedAt = 0;

function readCachedBarcodeSettings() {
    try {
        const raw = localStorage.getItem(BARCODE_SETTINGS_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.scanMode) scanMode = parsed.scanMode;
            if (parsed?.matchType) matchType = parsed.matchType;
        }
    } catch {}
    try {
        const savedCam = localStorage.getItem(PREFERRED_CAMERA_STORAGE_KEY);
        if (savedCam) selectedCameraId = savedCam;
    } catch {}
}

function writeCachedBarcodeSettings() {
    try {
        localStorage.setItem(BARCODE_SETTINGS_CACHE_KEY, JSON.stringify({ scanMode, matchType }));
    } catch {}
}

function withTimeout(promise, ms, label = 'operation') {
    let timer = null;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function enqueueScannerOp(task) {
    const next = scannerOpChain.then(() => task(), () => task());
    scannerOpChain = next.catch(() => {});
    return next;
}

function getSafeScannerState() {
    try {
        if (html5QrCode && typeof html5QrCode.getState === 'function') {
            return html5QrCode.getState();
        }
    } catch {}
    return SCAN_STATE.NOT_STARTED;
}

async function destroyScannerInstance() {
    if (!html5QrCode) return;
    try {
        const state = getSafeScannerState();
        if (state === SCAN_STATE.SCANNING || state === SCAN_STATE.PAUSED || html5QrCode.isScanning) {
            await html5QrCode.stop().catch(() => {});
        }
    } catch {}
    try {
        if (typeof html5QrCode.clear === 'function') {
            html5QrCode.clear();
        }
    } catch {}
    html5QrCode = null;
}

async function fetchBarcodeSettings() {
    try {
        const { data, error } = await withTimeout(
            supabase
                .from('home_settings')
                .select('*')
                .in('setting_key', ['barcode_scan_mode', 'barcode_match_type']),
            3000,
            'fetchBarcodeSettings'
        );
        if (!error && data) {
            data.forEach(item => {
                if (item.setting_key === 'barcode_scan_mode' && item.setting_value) scanMode = item.setting_value;
                if (item.setting_key === 'barcode_match_type' && item.setting_value) matchType = item.setting_value;
            });
            writeCachedBarcodeSettings();
        }
        updateManualInputPlaceholder();
    } catch {
        // Non-fatal: cached or default settings remain active immediately
    }
}

function updateManualInputPlaceholder() {
    const manualInput = document.getElementById('barcode-manual-input');
    const toggleManualInput = document.getElementById('toggle-manual-input');
    if (manualInput) {
        if (toggleManualInput && !toggleManualInput.checked) {
            manualInput.placeholder = "تفعيل الإدخال اليدوي أولاً...";
            return;
        }
        if (matchType === 'system') {
            manualInput.placeholder = "اكتب كود السيستم...";
        } else if (matchType === 'factory') {
            manualInput.placeholder = "اكتب كود المصنع...";
        } else {
            manualInput.placeholder = "اكتب كود المصنع أو السيستم...";
        }
    }
}

function createScannerInstance() {
    const configs = {
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        }
    };
    const formats = getScannerFormatsToSupport(scanMode, window.Html5QrcodeSupportedFormats);
    if (formats && formats.length > 0) {
        configs.formatsToSupport = formats;
    }
    return new window.Html5Qrcode("barcode-reader", configs);
}

function enableManualInputFromOverlay() {
    const toggleManualInput = document.getElementById('toggle-manual-input');
    const manualInput = document.getElementById('barcode-manual-input');
    const btnSubmitManualCode = document.getElementById('btn-submit-manual-code');
    if (toggleManualInput && !toggleManualInput.checked) {
        toggleManualInput.checked = true;
        toggleManualInput.dispatchEvent(new Event('change'));
    } else if (manualInput) {
        manualInput.disabled = false;
        if (btnSubmitManualCode) btnSubmitManualCode.disabled = false;
        updateManualInputPlaceholder();
        manualInput.focus();
    }
    manualInput?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideCameraStatusOverlay() {
    const overlay = document.getElementById('barcode-camera-status-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function showCameraStatusOverlay(kind) {
    const cameraBox = document.getElementById('barcode-camera-box');
    if (!cameraBox) return;

    const info = getCameraStatusMessage(kind);
    let overlay = document.getElementById('barcode-camera-status-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'barcode-camera-status-overlay';
        cameraBox.appendChild(overlay);
    }

    const isWarning = kind === 'permission_denied' || kind === 'not_found' || kind === 'in_use' || kind === 'unsupported' || kind === 'unknown';
    const iconClass = kind === 'standby' ? 'ph-camera' : 'ph-camera-slash';
    const iconBgClass = isWarning
        ? 'bg-devo-orange/15 border-devo-orange/40 text-devo-orange'
        : 'bg-devo-info/15 border-devo-info/40 text-devo-info';

    overlay.className = 'absolute inset-0 z-20 flex flex-col items-center justify-center p-4 text-center bg-devo-black/95 backdrop-blur-sm';
    overlay.innerHTML = `
        <div class="w-12 h-12 rounded-2xl border ${iconBgClass} flex items-center justify-center mb-2.5 shrink-0">
            <i class="ph ${iconClass} text-2xl"></i>
        </div>
        <h4 class="text-white font-black text-sm leading-snug mb-1"></h4>
        <p class="text-devo-muted text-xs leading-relaxed max-w-xs mb-3"></p>
        <div class="flex flex-wrap items-center justify-center gap-2">
            ${info.suggestManual ? `<button type="button" data-action="enable-manual" class="px-3.5 py-2 rounded-xl bg-devo-info hover:bg-blue-600 text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"><i class="ph ph-keyboard text-sm"></i><span>إدخال الكود يدوياً</span></button>` : ''}
            ${info.allowRetry ? `<button type="button" data-action="retry-camera" class="px-3.5 py-2 rounded-xl bg-devo-dark border border-devo-gray hover:border-devo-orange text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"><i class="ph ph-arrows-clockwise text-sm"></i><span>${kind === 'standby' ? 'تشغيل الكاميرا' : 'إعادة المحاولة'}</span></button>` : ''}
        </div>
    `;
    const titleEl = overlay.querySelector('h4');
    const descEl = overlay.querySelector('p');
    if (titleEl) titleEl.textContent = info.title;
    if (descEl) descEl.textContent = info.subtitle;

    overlay.querySelector('[data-action="enable-manual"]')?.addEventListener('click', enableManualInputFromOverlay);
    overlay.querySelector('[data-action="retry-camera"]')?.addEventListener('click', () => startScanning({ isAutoStart: false }));
}

async function queryCameraPermissionState() {
    try {
        if (navigator?.permissions && typeof navigator.permissions.query === 'function') {
            const status = await navigator.permissions.query({ name: 'camera' });
            return status?.state || 'unknown';
        }
    } catch {
        // Firefox / Safari may not support 'camera' in Permissions API
    }
    return 'unknown';
}

async function populateCameraListFromActiveSession() {
    const selectCamera = document.getElementById('select-camera');
    if (!selectCamera || !navigator?.mediaDevices?.enumerateDevices) return;

    try {
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = allDevices.filter((d) => d.kind === 'videoinput' && d.deviceId);
        if (videoDevices.length === 0) return;

        // Detect which camera track is currently running so dropdown matches reality
        let activeDeviceId = selectedCameraId;
        try {
            const activeTrackSettings = html5QrCode?.getRunningTrackSettings?.();
            if (activeTrackSettings?.deviceId) {
                activeDeviceId = activeTrackSettings.deviceId;
                selectedCameraId = activeDeviceId;
            }
        } catch {}

        selectCamera.innerHTML = videoDevices.map((device, idx) =>
            `<option value="${device.id}" ${device.id === activeDeviceId ? 'selected' : ''}>${device.label || `كاميرا ${idx + 1}`}</option>`
        ).join('');

        if (videoDevices.length > 1) {
            selectCamera.classList.remove('hidden');
        } else {
            selectCamera.classList.add('hidden');
        }
    } catch {}
}

function pauseScannerSafely() {
    try {
        if (!html5QrCode || !isScannerRunning) return;
        const state = getSafeScannerState();
        if (state === SCAN_STATE.SCANNING && typeof html5QrCode.pause === 'function') {
            html5QrCode.pause(true);
            const laser = document.getElementById('barcode-scanner-laser');
            if (laser) laser.classList.add('hidden');
        }
    } catch {}
}

function resumeScannerSafely() {
    if (unlockSafetyTimer) {
        clearTimeout(unlockSafetyTimer);
        unlockSafetyTimer = null;
    }
    isScannerLocked = false;
    try {
        if (!html5QrCode || !isScannerRunning) return;
        const state = getSafeScannerState();
        if (state === SCAN_STATE.PAUSED && typeof html5QrCode.resume === 'function') {
            html5QrCode.resume();
            const laser = document.getElementById('barcode-scanner-laser');
            if (laser) laser.classList.remove('hidden');
        }
    } catch {
        // Fallback: if video stream died while paused in background, restart cleanly
        stopScanning({ keepOverlayHidden: true }).then(() => maybeAutoStartScanning());
    }
}

function scheduleShortScanUnlock(delayMs = 900) {
    if (unlockSafetyTimer) clearTimeout(unlockSafetyTimer);
    unlockSafetyTimer = setTimeout(() => {
        unlockSafetyTimer = null;
        resumeScannerSafely();
    }, delayMs);
}

async function maybeAutoStartScanning() {
    if (isScannerRunning || isStartingScanner) return;
    const barcodeView = document.getElementById('view-barcode');
    if (barcodeView && barcodeView.classList.contains('hidden')) return;

    const hasMediaDevices = typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
    let isEmbedded = false;
    try {
        isEmbedded = typeof window !== 'undefined' && window.self !== window.top;
    } catch {
        isEmbedded = true;
    }

    const permissionState = hasMediaDevices ? await queryCameraPermissionState() : 'denied';
    const decision = shouldAutoStartCamera({ permissionState, hasMediaDevices, isEmbedded });

    if (!decision.shouldStart) {
        if (decision.fallbackStatus) {
            showCameraStatusOverlay(decision.fallbackStatus);
        }
        return;
    }

    await startScanning({ isAutoStart: true });
}

export function initBarcode() {
    if (isBarcodeViewInitialized) return;
    isBarcodeViewInitialized = true;

    readCachedBarcodeSettings();

    const btnToggleScan = document.getElementById('btn-toggle-scan');
    const btnSubmitManualCode = document.getElementById('btn-submit-manual-code');
    const manualInput = document.getElementById('barcode-manual-input');
    const selectCamera = document.getElementById('select-camera');
    const toggleManualInput = document.getElementById('toggle-manual-input');

    if (!btnToggleScan || !btnSubmitManualCode || !manualInput) return;

    // Fetch latest barcode settings in the background without blocking UI startup
    fetchBarcodeSettings();

    // Toggle manual input state change
    if (toggleManualInput) {
        toggleManualInput.addEventListener('change', () => {
            if (toggleManualInput.checked) {
                manualInput.disabled = false;
                btnSubmitManualCode.disabled = false;
                updateManualInputPlaceholder();
                manualInput.focus();
            } else {
                manualInput.disabled = true;
                btnSubmitManualCode.disabled = true;
                manualInput.value = '';
                updateManualInputPlaceholder();
                manualInput.blur();
            }
        });
    }

    // Toggle scanning button click
    btnToggleScan.addEventListener('click', () => {
        if (isScannerRunning) {
            stopScanning();
        } else {
            startScanning({ isAutoStart: false });
        }
    });

    // Camera selection change
    if (selectCamera) {
        selectCamera.addEventListener('change', (e) => {
            selectedCameraId = e.target.value || null;
            try {
                if (selectedCameraId) {
                    localStorage.setItem(PREFERRED_CAMERA_STORAGE_KEY, selectedCameraId);
                } else {
                    localStorage.removeItem(PREFERRED_CAMERA_STORAGE_KEY);
                }
            } catch {}
            if (isScannerRunning) {
                stopScanning({ keepOverlayHidden: true }).then(() => startScanning({ isAutoStart: false }));
            }
        });
    }

    // Manual code submit click
    btnSubmitManualCode.addEventListener('click', handleManualCodeSubmit);
    manualInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleManualCodeSubmit();
        }
    });

    // Defensive hook chaining for site navigation
    const existingOnViewChanged = window.onViewChanged;
    window.onViewChanged = (targetId) => {
        if (typeof existingOnViewChanged === 'function') {
            existingOnViewChanged(targetId);
        }

        if (targetId === 'view-barcode') {
            setTimeout(() => {
                maybeAutoStartScanning();
            }, 120);
        } else {
            if (isScannerRunning || isStartingScanner) {
                stopScanning();
            }
        }
    };

    // Defensive hook chaining for model details modal close event
    const existingOnModelViewerClosed = window.onModelViewerClosed;
    window.onModelViewerClosed = () => {
        if (typeof existingOnModelViewerClosed === 'function') {
            existingOnModelViewerClosed();
        }

        const barcodeView = document.getElementById('view-barcode');
        if (window.currentView === 'view-barcode' || (barcodeView && !barcodeView.classList.contains('hidden'))) {
            resumeScannerSafely();
            if (manualInput) {
                manualInput.value = '';
                if (!manualInput.disabled) {
                    manualInput.focus();
                }
            }
        }
    };

    // Pause/resume cleanly when app goes to background on mobile PWA
    document.addEventListener('visibilitychange', () => {
        const barcodeView = document.getElementById('view-barcode');
        const onBarcodeTab = window.currentView === 'view-barcode' || (barcodeView && !barcodeView.classList.contains('hidden'));
        if (!onBarcodeTab) return;

        if (document.hidden) {
            if (isScannerRunning) {
                stopScanning({ keepOverlayHidden: true });
            }
        } else {
            const modal = document.getElementById('model-viewer-modal');
            const modalClosed = !modal || modal.classList.contains('hidden');
            if (modalClosed && !isScannerRunning) {
                setTimeout(() => maybeAutoStartScanning(), 180);
            }
        }
    });

    // إذا كانت الصفحة الحالية بالفعل هي الباركود عند التحميل أو عمل ريفريش، ابدأ المسح تلقائياً بأمان
    const barcodeViewEl = document.getElementById('view-barcode');
    if (window.currentView === 'view-barcode' || (barcodeViewEl && !barcodeViewEl.classList.contains('hidden'))) {
        setTimeout(() => {
            maybeAutoStartScanning();
        }, 180);
    }
}

async function startScanning({ isAutoStart = false } = {}) {
    return enqueueScannerOp(async () => {
        if (isScannerRunning || isStartingScanner) return;

        if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
            showCameraStatusOverlay('unsupported');
            if (!isAutoStart) {
                const msg = getCameraStatusMessage('unsupported');
                showToast(msg.toastMessage, msg.toastType);
            }
            return;
        }

        if (!window.Html5Qrcode) {
            showToast("مكتبة قارئ الباركود لم تكتمل في التحميل بعد. أعد المحاولة.", "warning");
            return;
        }

        isStartingScanner = true;

        const btnToggleScan = document.getElementById('btn-toggle-scan');
        const txtToggleScan = document.getElementById('txt-toggle-scan');
        const selectCamera = document.getElementById('select-camera');
        const laser = document.getElementById('barcode-scanner-laser');

        // Refresh settings non-blockingly in background so camera opens with zero network delay
        fetchBarcodeSettings();

        try {
            // Ensure previous scanner instance & streams/canvases are completely cleaned up
            await destroyScannerInstance();
            html5QrCode = createScannerInstance();

            const config = {
                fps: 20,
                qrbox: (width, height) => computeScannerQrBox(width, height),
                aspectRatio: 1.333333
            };

            const cameraTarget = selectedCameraId ? selectedCameraId : { facingMode: "environment" };

            try {
                await html5QrCode.start(
                    cameraTarget,
                    config,
                    onScanSuccess,
                    () => {}
                );
            } catch (primaryErr) {
                // If saved cameraId no longer exists or failed, automatically fall back once to environment camera
                if (selectedCameraId) {
                    selectedCameraId = null;
                    try { localStorage.removeItem(PREFERRED_CAMERA_STORAGE_KEY); } catch {}
                    await destroyScannerInstance();
                    html5QrCode = createScannerInstance();
                    await html5QrCode.start(
                        { facingMode: "environment" },
                        config,
                        onScanSuccess,
                        () => {}
                    );
                } else {
                    throw primaryErr;
                }
            }

            // Improve close-up barcode crispness & continuous autofocus asynchronously (non-blocking)
            if (typeof html5QrCode.applyVideoConstraints === 'function') {
                html5QrCode.applyVideoConstraints({
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    advanced: [{ focusMode: 'continuous' }]
                }).catch(() => {});
            }

            hideCameraStatusOverlay();

            // Populate camera selector from active stream without opening a second temporary stream
            populateCameraListFromActiveSession();

            // ضبط عنصر الفيديو للتأكد من ملاءمته الدقيقة لشاشات كافة الموبايلات
            const videoEl = document.querySelector('#barcode-reader video');
            if (videoEl) {
                videoEl.style.width = '100%';
                videoEl.style.height = '100%';
                videoEl.style.maxWidth = '100%';
                videoEl.style.maxHeight = '100%';
                videoEl.style.objectFit = 'cover';
            }

            isScannerRunning = true;
            isScannerLocked = false;
            lastScannedCode = '';
            lastScannedAt = 0;

            if (txtToggleScan) txtToggleScan.textContent = "إيقاف الكاميرا";
            if (btnToggleScan) {
                btnToggleScan.classList.replace('bg-devo-orange', 'bg-devo-error');
                btnToggleScan.classList.replace('hover:bg-devo-orangeHover', 'hover:bg-red-600');
            }
            if (laser) laser.classList.remove('hidden');

        } catch (err) {
            const errorKind = classifyCameraError(err);
            const statusInfo = getCameraStatusMessage(errorKind);

            await destroyScannerInstance();

            if (selectCamera) selectCamera.classList.add('hidden');
            if (laser) laser.classList.add('hidden');
            isScannerRunning = false;
            showCameraStatusOverlay(errorKind);

            if (errorKind === 'unknown') {
                console.warn("Camera unavailable:", err);
            }

            if (!isAutoStart && statusInfo.toastMessage) {
                showToast(statusInfo.toastMessage, statusInfo.toastType);
            }
        } finally {
            isStartingScanner = false;
        }
    });
}

async function stopScanning({ keepOverlayHidden = false } = {}) {
    return enqueueScannerOp(async () => {
        if (unlockSafetyTimer) {
            clearTimeout(unlockSafetyTimer);
            unlockSafetyTimer = null;
        }

        const btnToggleScan = document.getElementById('btn-toggle-scan');
        const txtToggleScan = document.getElementById('txt-toggle-scan');
        const laser = document.getElementById('barcode-scanner-laser');

        try {
            await destroyScannerInstance();
        } catch (err) {
            console.warn("Failed to stop Html5Qrcode:", err);
        } finally {
            isScannerRunning = false;
            isStartingScanner = false;
            isScannerLocked = false;

            if (txtToggleScan) txtToggleScan.textContent = "تشغيل الكاميرا";
            if (btnToggleScan) {
                btnToggleScan.classList.replace('bg-devo-error', 'bg-devo-orange');
                btnToggleScan.classList.replace('hover:bg-red-600', 'hover:bg-devo-orangeHover');
            }
            if (laser) laser.classList.add('hidden');
            if (!keepOverlayHidden) {
                showCameraStatusOverlay('standby');
            }
        }
    });
}

async function onScanSuccess(decodedText) {
    const code = String(decodedText || '').trim();
    const now = Date.now();
    if (
        isScannerLocked ||
        shouldSkipDuplicateScan({ lastCode: lastScannedCode, lastTime: lastScannedAt, currentCode: code, now, cooldownMs: 1200 })
    ) {
        return;
    }

    isScannerLocked = true;
    lastScannedCode = code;
    lastScannedAt = now;

    // Pause video decoding immediately so UI thread isn't competing with 20fps scanning
    pauseScannerSafely();
    playBeepSound();

    try {
        const isStaff = checkIsWorker();
        const lookupFn = window.findModelByCode || findModelByCode;
        const rawModel = await withTimeout(
            lookupFn(code, matchType, { includeInactive: isStaff }),
            6000,
            'barcodeLookup'
        );
        const result = classifyBarcodeLookupResult(rawModel, isStaff);

        if (result.status === 'found_active') {
            showToast(`تم مسح الباركود بنجاح. الموديل: ${result.model.name}`, 'success');
            await window.openModelViewer(result.model.id, false, result.model);
            // Failsafe: if modal didn't open for any reason, unlock and resume
            const modal = document.getElementById('model-viewer-modal');
            if (!modal || modal.classList.contains('hidden')) {
                resumeScannerSafely();
            }
        } else if (result.status === 'found_inactive') {
            showToast(`تم العثور على الموديل (غير مفعل بالمعرض): ${result.model.name}`, 'warning');
            await window.openModelViewer(result.model.id, false, result.model);
            const modal = document.getElementById('model-viewer-modal');
            if (!modal || modal.classList.contains('hidden')) {
                resumeScannerSafely();
            }
        } else {
            const notFoundMsg = isStaff
                ? `الباركود (${code}) غير مسجل لأي موديل في النظام`
                : `الباركود (${code}) غير مطابق لأي موديل نشط بالمعرض`;
            showToast(notFoundMsg, 'error');
            scheduleShortScanUnlock(900);
        }
    } catch (err) {
        console.warn('[Barcode] Lookup error or timeout:', err);
        showToast('تعذر إتمام البحث عن الباركود حالياً. حاول مسحه مجدداً.', 'warning');
        scheduleShortScanUnlock(900);
    }
}

async function handleManualCodeSubmit() {
    const manualInput = document.getElementById('barcode-manual-input');
    if (!manualInput) return;

    const code = manualInput.value.trim();
    if (!code) {
        return showToast("يرجى إدخال كود الموديل للبحث", "warning");
    }

    const btn = document.getElementById('btn-submit-manual-code');
    if (btn) btn.disabled = true;

    try {
        const isStaff = checkIsWorker();
        const lookupFn = window.findModelByCode || findModelByCode;
        const rawModel = await withTimeout(
            lookupFn(code, matchType, { includeInactive: isStaff }),
            6000,
            'manualBarcodeLookup'
        );
        const result = classifyBarcodeLookupResult(rawModel, isStaff);

        if (result.status === 'found_active') {
            showToast(`تم العثور على الموديل: ${result.model.name}`, 'success');
            await window.openModelViewer(result.model.id, false, result.model);
        } else if (result.status === 'found_inactive') {
            showToast(`تم العثور على الموديل (غير مفعل بالمعرض): ${result.model.name}`, 'warning');
            await window.openModelViewer(result.model.id, false, result.model);
        } else {
            const notFoundMsg = isStaff
                ? `كود الموديل (${code}) غير موجود في النظام`
                : `كود الموديل (${code}) غير موجود بالمعرض`;
            showToast(notFoundMsg, 'error');
        }
    } catch (err) {
        console.warn('[Barcode] Manual lookup error or timeout:', err);
        showToast('حدث بطء في الشبكة أثناء البحث عن الكود. أعد المحاولة.', 'warning');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function playBeepSound() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') {
            sharedAudioCtx = new AudioCtx();
        }
        if (sharedAudioCtx.state === 'suspended') {
            sharedAudioCtx.resume().catch(() => {});
        }

        const now = sharedAudioCtx.currentTime;
        const oscillator = sharedAudioCtx.createOscillator();
        const gainNode = sharedAudioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(sharedAudioCtx.destination);

        oscillator.type = "sine";
        oscillator.frequency.value = 1100;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.2, now + 0.03);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.11);

        oscillator.start(now);
        oscillator.stop(now + 0.12);
    } catch {
        // Non-fatal if AudioContext is blocked
    }
}
