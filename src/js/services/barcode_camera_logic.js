/**
 * Pure camera permission & error classification helpers for the barcode scanner.
 */

export function classifyCameraError(err) {
    const rawName = String(err?.name || '').toLowerCase();
    const rawMsg = String(typeof err === 'string' ? err : (err?.message || '')).toLowerCase();
    const combined = `${rawName} ${rawMsg}`.trim();

    if (
        rawName === 'notallowederror' ||
        rawName === 'permissiondeniederror' ||
        rawName === 'permissiondismissederror' ||
        combined.includes('permission denied') ||
        combined.includes('notallowed') ||
        combined.includes('denied') ||
        combined.includes('dismissed')
    ) {
        return 'permission_denied';
    }

    if (
        rawName === 'notfounderror' ||
        rawName === 'devicesnotfounderror' ||
        combined.includes('requested device not found') ||
        combined.includes('no camera') ||
        combined.includes('no video input') ||
        combined.includes('notfound')
    ) {
        return 'not_found';
    }

    if (
        rawName === 'notreadableerror' ||
        rawName === 'trackstarterror' ||
        rawName === 'aborterror' ||
        combined.includes('could not start video source') ||
        combined.includes('in use') ||
        combined.includes('notreadable')
    ) {
        return 'in_use';
    }

    if (
        rawName === 'notsupportederror' ||
        rawName === 'securityerror' ||
        combined.includes('secure origin') ||
        combined.includes('mediadevices') ||
        combined.includes('not supported') ||
        combined.includes('notsupported')
    ) {
        return 'unsupported';
    }

    return 'unknown';
}

export function getCameraStatusMessage(kind) {
    switch (kind) {
        case 'permission_denied':
            return {
                title: 'صلاحية الكاميرا غير مفعلة',
                subtitle: 'اسمح بالوصول للكاميرا من إعدادات المتصفح ثم أعد المحاولة، أو استخدم إدخال الكود يدوياً بالأسفل.',
                toastMessage: 'تم رفض صلاحية الكاميرا. يمكنك تفعيلها من إعدادات المتصفح أو إدخال الكود يدوياً.',
                toastType: 'warning',
                allowRetry: true,
                suggestManual: true
            };
        case 'not_found':
            return {
                title: 'لا توجد كاميرا متصلة',
                subtitle: 'لم يتم العثور على كاميرا في هذا الجهاز. يمكنك إدخال كود الموديل يدوياً بالأسفل.',
                toastMessage: 'لم يتم العثور على كاميرا. يمكنك البحث بإدخال الكود يدوياً.',
                toastType: 'warning',
                allowRetry: true,
                suggestManual: true
            };
        case 'in_use':
            return {
                title: 'الكاميرا مستخدمة حالياً',
                subtitle: 'أغلق أي تطبيق آخر يستخدم الكاميرا ثم اضغط تشغيل الكاميرا، أو استخدم الإدخال اليدوي.',
                toastMessage: 'الكاميرا مستخدمة في تطبيق آخر. يمكنك المحاولة مجدداً أو إدخال الكود يدوياً.',
                toastType: 'warning',
                allowRetry: true,
                suggestManual: true
            };
        case 'unsupported':
            return {
                title: 'تشغيل الكاميرا غير متاح هنا',
                subtitle: 'هذا المتصفح أو الإطار لا يدعم تشغيل الكاميرا. استخدم إدخال الكود يدوياً بالأسفل.',
                toastMessage: 'تشغيل الكاميرا غير مدعوم هنا. يرجى استخدام الإدخال اليدوي.',
                toastType: 'warning',
                allowRetry: false,
                suggestManual: true
            };
        case 'standby':
            return {
                title: 'اضغط «تشغيل الكاميرا» لبدء المسح',
                subtitle: 'يمكنك تشغيل الكاميرا لمسح الباركود أو تفعيل إدخال الكود يدوياً بالأسفل.',
                toastMessage: '',
                toastType: 'info',
                allowRetry: true,
                suggestManual: true
            };
        default:
            return {
                title: 'تعذر تشغيل الكاميرا',
                subtitle: 'تأكد من توفر الكاميرا وصلاحيات المتصفح ثم أعد المحاولة، أو أدخل الكود يدوياً.',
                toastMessage: 'تعذر تشغيل الكاميرا. يمكنك المحاولة مجدداً أو استخدام الإدخال اليدوي.',
                toastType: 'warning',
                allowRetry: true,
                suggestManual: true
            };
    }
}

export function shouldAutoStartCamera({ permissionState = 'unknown', hasMediaDevices = true, isEmbedded = false } = {}) {
    if (!hasMediaDevices) {
        return { shouldStart: false, fallbackStatus: 'unsupported' };
    }
    if (permissionState === 'denied') {
        return { shouldStart: false, fallbackStatus: 'permission_denied' };
    }
    if (isEmbedded && permissionState !== 'granted') {
        return { shouldStart: false, fallbackStatus: 'standby' };
    }
    return { shouldStart: true, fallbackStatus: null };
}
