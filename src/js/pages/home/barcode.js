import { findModelByCode } from './gallery.js';
import { showToast } from '../../components/toast.js';
import { supabase } from '../../config/supabase.js';

let html5QrCode = null;
let isScannerRunning = false;
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
            console.error("Failed to initialize Html5Qrcode:", e);
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
            startScanning();
        }
    });

    // Camera selection change
    if (selectCamera) {
        selectCamera.addEventListener('change', (e) => {
            selectedCameraId = e.target.value;
            if (isScannerRunning) {
                stopScanning().then(() => startScanning());
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
            // Automatically start scanning when switching to barcode tab
            setTimeout(() => {
                if (!isScannerRunning) {
                    startScanning();
                }
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
        if (barcodeView && barcodeView.classList.contains('block')) {
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
}

async function startScanning() {
    if (!window.Html5Qrcode) {
        showToast("مكتبة قارئ الباركود لم تكتمل في التحميل بعد. أعد المحاولة.", "warning");
        return;
    }

    // Refresh settings before scanning to adapt to any recent admin changes
    await fetchBarcodeSettings();

    // Recreate scanner with latest settings
    try {
        html5QrCode = createScannerInstance();
    } catch (e) {
        console.error("Failed to create Html5Qrcode instance:", e);
        showToast("حدث خطأ أثناء تهيئة الكاميرا.", "error");
        return;
    }
    
    const btnToggleScan = document.getElementById('btn-toggle-scan');
    const txtToggleScan = document.getElementById('txt-toggle-scan');
    const selectCamera = document.getElementById('select-camera');
    const laser = document.getElementById('barcode-scanner-laser');

    try {
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
                // Focus area optimized for both 1D barcodes and 2D QR codes
                return {
                    width: Math.min(width * 0.9, 360),
                    height: Math.min(height * 0.65, 260)
                };
            },
            aspectRatio: 1.333333
        };

        await html5QrCode.start(
            selectedCameraId ? selectedCameraId : { facingMode: "environment" },
            config,
            onScanSuccess,
            (errorMessage) => {
                // Ignore scanning cycle failures/no code detected
            }
        );

        isScannerRunning = true;
        isScannerLocked = false;

        if (txtToggleScan) txtToggleScan.textContent = "إيقاف الكاميرا";
        if (btnToggleScan) {
            btnToggleScan.classList.replace('bg-devo-orange', 'bg-devo-error');
            btnToggleScan.classList.replace('hover:bg-devo-orangeHover', 'hover:bg-red-600');
        }
        if (laser) laser.classList.remove('hidden');

    } catch (err) {
        console.error("Camera access failed", err);
        showToast("لم نتمكن من تشغيل الكاميرا. تأكد من إعطاء الصلاحيات للمتصفح.", "error");
    }
}

async function stopScanning() {
    if (!html5QrCode || !isScannerRunning) return;

    const btnToggleScan = document.getElementById('btn-toggle-scan');
    const txtToggleScan = document.getElementById('txt-toggle-scan');
    const laser = document.getElementById('barcode-scanner-laser');

    try {
        await html5QrCode.stop();
        isScannerRunning = false;
        isScannerLocked = false;

        if (txtToggleScan) txtToggleScan.textContent = "تشغيل الكاميرا";
        if (btnToggleScan) {
            btnToggleScan.classList.replace('bg-devo-error', 'bg-devo-orange');
            btnToggleScan.classList.replace('hover:bg-red-600', 'hover:bg-devo-orangeHover');
        }
        if (laser) laser.classList.add('hidden');
    } catch (err) {
        console.error("Failed to stop Html5Qrcode:", err);
    }
}

function onScanSuccess(decodedText) {
    if (isScannerLocked) return;
    isScannerLocked = true;

    playBeepSound();

    const code = decodedText.trim();
    const model = findModelByCode(code, matchType);

    if (model) {
        showToast(`تم مسح الباركود بنجاح. الموديل: ${model.name}`, 'success');
        window.openModelViewer(model.id);
    } else {
        showToast(`الباركود (${code}) غير مطابق لأي موديل نشط بالمعرض`, 'error');
        // Resume scanning after a 2.5 seconds delay so toast is readable
        setTimeout(() => {
            isScannerLocked = false;
        }, 2500);
    }
}

function handleManualCodeSubmit() {
    const manualInput = document.getElementById('barcode-manual-input');
    if (!manualInput) return;

    const code = manualInput.value.trim();
    if (!code) {
        return showToast("يرجى إدخال كود الموديل للبحث", "warning");
    }

    const model = findModelByCode(code, matchType);
    if (model) {
        showToast(`تم العثور على الموديل: ${model.name}`, 'success');
        window.openModelViewer(model.id);
    } else {
        showToast(`كود الموديل (${code}) غير موجود بالمعرض`, 'error');
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
