import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyCameraError,
    getCameraStatusMessage,
    shouldAutoStartCamera
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
