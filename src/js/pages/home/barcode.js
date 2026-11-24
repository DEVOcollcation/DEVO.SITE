import { findModelByCode, checkIsWorker } from './gallery.js?v=18.1';
import { classifyBarcodeLookupResult } from '../../services/barcode_lookup_logic.js';
import {
    classifyCameraError,
    getCameraStatusMessage,
    shouldAutoStartCamera
} from '../../services/barcode_camera_logic.js';
import { showToast } from '../../components/toast.js';
import { supabase } from '../../config/supabase.js';

let html5QrCode = null;
let isScannerRunning = false;
let isStartingScanner = false;
let isScannerLocked = false;
let selectedCameraId = null;
let scanMode = 'both';
let matchType = 'both';

async function fetchBarcodeSettings() {
    try {
        const { data, error } = await supabase
            .from('home_settings')
            .select('*')
            .in('setting_key', ['barcode_scan_mode', 'barcode_match_type']);
        if (!error && data) {
            data.forEach(item => {
                if (item.setting_key === 'barcode_scan_mode') scanMode = item.setting_value;
                if (item.setting_key === 'barcode_match_type') matchType = item.setting_value;
            });
        }
        
        // Dynamically update placeholder
        updateManualInputPlaceholder();
    } catch (e) {
        console.error("Failed to fetch barcode settings:", e);
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
    if (window.Html5QrcodeSupportedFormats) {
        if (scanMode === 'qr') {
            configs.formatsToSupport = [window.Html5QrcodeSupportedFormats.QR_CODE];
        } else if (scanMode === 'barcode') {
            configs.formatsToSupport = [
                window.Html5QrcodeSupportedFormats.EAN_13,
                window.Html5QrcodeSupportedFormats.EAN_8,
                window.Html5QrcodeSupportedFormats.CODE_39,
                window.Html5QrcodeSupportedFormats.CODE_128,
                window.Html5QrcodeSupportedFormats.CODE_93,
                window.Html5QrcodeSupportedFormats.CODABAR,
                window.Html5QrcodeSupportedFormats.UPC_A,
                window.Html5QrcodeSupportedFormats.UPC_E,
                window.Html5QrcodeSupportedFormats.ITF
            ];
        } else {
            // BOTH: explicitly support all common 1D and 2D formats
            configs.formatsToSupport = [
                window.Html5QrcodeSupportedFormats.QR_CODE,
                window.Html5QrcodeSupportedFormats.CODE_128,
                window.Html5QrcodeSupportedFormats.CODE_39,
                window.Html5QrcodeSupportedFormats.EAN_13,
                window.Html5QrcodeSupportedFormats.EAN_8,
                window.Html5QrcodeSupportedFormats.UPC_A,
                window.Html5QrcodeSupportedFormats.UPC_E
            ];
        }
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
    const btnToggleScan = document.getElementById('btn-toggle-scan');
    const btnSubmitManualCode = document.getElementById('btn-submit-manual-code');
    const manualInput = document.getElementById('barcode-manual-input');
    const selectCamera = document.getElementById('select-camera');
    const toggleManualInput = document.getElementById('toggle-manual-input');

    if (!btnToggleScan || !btnSubmitManualCode || !manualInput) return;

    // Fetch barcode settings and initialize scanner
    fetchBarcodeSettings().then(() => {
        try {
            if (window.Html5Qrcode && !html5QrCode) {
                html5QrCode = createScannerInstance();
            }
        } catch (e) {
            console.warn("Failed to initialize Html5Qrcode:", e);
        }
    });

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
            selectedCameraId = e.target.value;
            if (isScannerRunning) {
                stopScanning().then(() => startScanning({ isAutoStart: false }));
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
            // Safely check permissions and start scanning when switching to barcode tab
            setTimeout(() => {
                maybeAutoStartScanning();
            }, 200);
        } else {
            // Automatically stop scanning when leaving barcode tab
            if (isScannerRunning) {
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

        // If current active view is barcode, resume scanning
        const barcodeView = document.getElementById('view-barcode');
        if (window.currentView === 'view-barcode' || (barcodeView && !barcodeView.classList.contains('hidden'))) {
            isScannerLocked = false;
            // Clear manual input for next scan
            if (manualInput) {
                manualInput.value = '';
                if (!manualInput.disabled) {
                    manualInput.focus();
                }
            }
        }
    };

    // إذا كانت الصفحة الحالية بالفعل هي الباركود عند التحميل أو عمل ريفريش، ابدأ المسح تلقائياً بأمان
    const barcodeViewEl = document.getElementById('view-barcode');
    if (window.currentView === 'view-barcode' || (barcodeViewEl && !barcodeViewEl.classList.contains('hidden'))) {
        setTimeout(() => {
            maybeAutoStartScanning();
        }, 250);
    }
}

async function startScanning({ isAutoStart = false } = {}) {
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

    try {
        // Refresh settings before scanning to adapt to any recent admin changes
        await fetchBarcodeSettings();

        // Recreate scanner with latest settings
        html5QrCode = createScannerInstance();

        // Request cameras list
        const devices = await window.Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
            // Populate select box if multiple cameras
            if (selectCamera) {
                selectCamera.innerHTML = devices.map(device => 
                    `<option value="${device.id}" ${device.id === selectedCameraId ? 'selected' : ''}>${device.label || `كاميرا ${devices.indexOf(device) + 1}`}</option>`
                ).join('');
                selectCamera.classList.remove('hidden');
            }

            // Default to first camera if none selected, or back camera if available
            if (!selectedCameraId) {
                const backCamera = devices.find(d => {
                    const label = (d.label || '').toLowerCase();
                    return label.includes('back') || label.includes('environment') || label.includes('rear') || label.includes('out');
                });
                selectedCameraId = backCamera ? backCamera.id : devices[0].id;
                if (selectCamera) selectCamera.value = selectedCameraId;
            }
        }

        const config = {
            fps: 15,
            qrbox: function(width, height) {
                // Focus area optimized for both 1D barcodes and 2D QR codes (min 100x80)
                const safeW = Math.max(100, Math.min((width || 280) * 0.85, 320));
                const safeH = Math.max(80, Math.min((height || 220) * 0.65, 240));
                return {
                    width: Math.floor(safeW),
                    height: Math.floor(safeH)
                };
            },
            aspectRatio: 1.333333
        };

        await html5QrCode.start(
            selectedCameraId ? selectedCameraId : { facingMode: "environment" },
            config,
            onScanSuccess,
            () => {
                // Ignore scanning cycle failures/no code detected
            }
        );

        hideCameraStatusOverlay();

        // ضبط عنصر الفيديو للتأكد من ملاءمته الدقيقة لشاشات كافة الموبايلات
        const videoEl = document.querySelector('#barcode-reader video');
        if (videoEl) {
            videoEl.style.width = '100%';
            videoEl.style.height = '100%';
            videoEl.style.maxWidth = '100%';
            videoEl.style.maxHeight = '100%';
            videoEl.style.objectFit = 'cover';
        }

        // تصفير أي إزاحة أفقية قد تنشأ على أجهزة شاومي أو غيرها
        if (typeof window !== 'undefined') {
            window.scrollTo(0, 0);
            if (document.documentElement) document.documentElement.scrollLeft = 0;
            if (document.body) document.body.scrollLeft = 0;
        }

        isScannerRunning = true;
        isScannerLocked = false;

        if (txtToggleScan) txtToggleScan.textContent = "إيقاف الكاميرا";
        if (btnToggleScan) {
            btnToggleScan.classList.replace('bg-devo-orange', 'bg-devo-error');
            btnToggleScan.classList.replace('hover:bg-devo-orangeHover', 'hover:bg-red-600');
        }
        if (laser) laser.classList.remove('hidden');

    } catch (err) {
        const errorKind = classifyCameraError(err);
        const statusInfo = getCameraStatusMessage(errorKind);

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
}

async function stopScanning() {
    if (!html5QrCode || !isScannerRunning) return;

    const btnToggleScan = document.getElementById('btn-toggle-scan');
    const txtToggleScan = document.getElementById('txt-toggle-scan');
    const laser = document.getElementById('barcode-scanner-laser');

    try {
        if (html5QrCode.isScanning) {
            await html5QrCode.stop().catch(() => {});
        }
    } catch (err) {
        console.warn("Failed to stop Html5Qrcode:", err);
    } finally {
        isScannerRunning = false;
        isScannerLocked = false;

        if (txtToggleScan) txtToggleScan.textContent = "تشغيل الكاميرا";
        if (btnToggleScan) {
            btnToggleScan.classList.replace('bg-devo-error', 'bg-devo-orange');
            btnToggleScan.classList.replace('hover:bg-red-600', 'hover:bg-devo-orangeHover');
        }
        if (laser) laser.classList.add('hidden');
        showCameraStatusOverlay('standby');
    }
}

async function onScanSuccess(decodedText) {
    if (isScannerLocked) return;
    isScannerLocked = true;

    playBeepSound();

    const code = decodedText.trim();
    const isStaff = checkIsWorker();
    const lookupFn = window.findModelByCode || findModelByCode;
    const rawModel = await lookupFn(code, matchType, { includeInactive: isStaff });
    const result = classifyBarcodeLookupResult(rawModel, isStaff);

    if (result.status === 'found_active') {
        showToast(`تم مسح الباركود بنجاح. الموديل: ${result.model.name}`, 'success');
        window.openModelViewer(result.model.id, false, result.model);
    } else if (result.status === 'found_inactive') {
        showToast(`تم العثور على الموديل (غير مفعل بالمعرض): ${result.model.name}`, 'warning');
        window.openModelViewer(result.model.id, false, result.model);
    } else {
        const notFoundMsg = isStaff
            ? `الباركود (${code}) غير مسجل لأي موديل في النظام`
            : `الباركود (${code}) غير مطابق لأي موديل نشط بالمعرض`;
        showToast(notFoundMsg, 'error');
        // Resume scanning after a 2.5 seconds delay so toast is readable
        setTimeout(() => {
            isScannerLocked = false;
        }, 2500);
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
        const rawModel = await lookupFn(code, matchType, { includeInactive: isStaff });
        const result = classifyBarcodeLookupResult(rawModel, isStaff);

        if (result.status === 'found_active') {
            showToast(`تم العثور على الموديل: ${result.model.name}`, 'success');
            window.openModelViewer(result.model.id, false, result.model);
        } else if (result.status === 'found_inactive') {
            showToast(`تم العثور على الموديل (غير مفعل بالمعرض): ${result.model.name}`, 'warning');
            window.openModelViewer(result.model.id, false, result.model);
        } else {
            const notFoundMsg = isStaff
                ? `كود الموديل (${code}) غير موجود في النظام`
                : `كود الموديل (${code}) غير موجود بالمعرض`;
            showToast(notFoundMsg, 'error');
        }
    } finally {
        if (btn) btn.disabled = false;
    }
}

function playBeepSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = "sine";
        oscillator.frequency.value = 1100; // Sharp beep sound
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.04);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.12);

        oscillator.start(audioCtx.currentTime);
        oscillator.stop(audioCtx.currentTime + 0.12);
    } catch (e) {
        console.warn("AudioContext beep failed", e);
    }
}
