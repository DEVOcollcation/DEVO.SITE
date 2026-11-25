import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyCameraError,
    getCameraStatusMessage,
    shouldAutoStartCamera,
    getScannerFormatsToSupport,
    computeScannerQrBox,
    shouldSkipDuplicateScan
} from './barcode_camera_logic.js';

test('classifyCameraError detects permission denials from DOMException names or plain strings', () => {
    assert.equal(classifyCameraError({ name: 'NotAllowedError', message: 'Permission denied' }), 'permission_denied');
    assert.equal(classifyCameraError({ name: 'PermissionDeniedError', message: '' }), 'permission_denied');
    assert.equal(classifyCameraError('NotAllowedError: Permission denied'), 'permission_denied');
    assert.equal(classifyCameraError(new Error('Permission dismissed by user')), 'permission_denied');
});

test('classifyCameraError detects missing devices, busy camera, and unsupported contexts', () => {
    assert.equal(classifyCameraError({ name: 'NotFoundError', message: 'Requested device not found' }), 'not_found');
    assert.equal(classifyCameraError({ name: 'NotReadableError', message: 'Could not start video source' }), 'in_use');
    assert.equal(classifyCameraError({ name: 'SecurityError', message: 'Only secure origins are allowed' }), 'unsupported');
    assert.equal(classifyCameraError(new Error('Something unexpected')), 'unknown');
});

test('shouldAutoStartCamera avoids triggering permission denials when blocked or embedded without prior grant', () => {
    assert.deepEqual(
        shouldAutoStartCamera({ permissionState: 'denied', hasMediaDevices: true, isEmbedded: false }),
        { shouldStart: false, fallbackStatus: 'permission_denied' }
    );
    assert.deepEqual(
        shouldAutoStartCamera({ permissionState: 'prompt', hasMediaDevices: true, isEmbedded: true }),
        { shouldStart: false, fallbackStatus: 'standby' }
    );
    assert.deepEqual(
        shouldAutoStartCamera({ permissionState: 'granted', hasMediaDevices: true, isEmbedded: true }),
        { shouldStart: true, fallbackStatus: null }
    );
    assert.deepEqual(
        shouldAutoStartCamera({ permissionState: 'prompt', hasMediaDevices: true, isEmbedded: false }),
        { shouldStart: true, fallbackStatus: null }
    );
    assert.deepEqual(
        shouldAutoStartCamera({ permissionState: 'prompt', hasMediaDevices: false, isEmbedded: false }),
        { shouldStart: false, fallbackStatus: 'unsupported' }
    );
});

test('getCameraStatusMessage returns Arabic UI guidance and manual input fallback flags', () => {
    const denied = getCameraStatusMessage('permission_denied');
    assert.ok(denied.title.includes('صلاحية'));
    assert.equal(denied.suggestManual, true);
    assert.equal(denied.allowRetry, true);
});

test('getScannerFormatsToSupport keeps only essential decoders per scan mode for fast frame decoding', () => {
    const F = { QR_CODE: 0, CODE_128: 5, CODE_39: 3, EAN_13: 9, CODABAR: 2, ITF: 12 };
    assert.deepEqual(getScannerFormatsToSupport('qr', F), [0]);
    assert.deepEqual(getScannerFormatsToSupport('barcode', F), [5, 3, 9]);
    assert.deepEqual(getScannerFormatsToSupport('both', F), [0, 5, 9, 3]);
    assert.equal(getScannerFormatsToSupport('both', null), undefined);
});

test('computeScannerQrBox fits inside container bounds while giving wide 1D barcode clearance', () => {
    const desktop = computeScannerQrBox(440, 330);
    assert.ok(desktop.width <= 380 && desktop.width >= 300);
    assert.ok(desktop.height <= 240 && desktop.height >= 180);

    const smallMobile = computeScannerQrBox(260, 195);
    assert.ok(smallMobile.width <= 244);
    assert.ok(smallMobile.height <= 179);
});

test('shouldSkipDuplicateScan debounces identical rapid scans while permitting new codes immediately', () => {
    assert.equal(shouldSkipDuplicateScan({ lastCode: '505', lastTime: 1000, currentCode: '505', now: 1600, cooldownMs: 1500 }), true);
    assert.equal(shouldSkipDuplicateScan({ lastCode: '505', lastTime: 1000, currentCode: '505', now: 2600, cooldownMs: 1500 }), false);
    assert.equal(shouldSkipDuplicateScan({ lastCode: '505', lastTime: 1000, currentCode: '404', now: 1100, cooldownMs: 1500 }), false);
});
