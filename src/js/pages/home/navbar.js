import { getCurrentSession, logoutUser } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';
import { renderHeader, attachMobileMenuToggle, closeMobileMenu, isMobileMenuOpen, syncBottomNavActive, syncHeaderHeightVar, syncTransparentHeaderState } from './header_layouts.js?v=2.4';
import { supabase } from '../../config/supabase.js';

const HEADER_SETTINGS_CACHE_KEY = 'devo_header_settings_cache';

function readCachedHeaderSettings() {
    try {
        const raw = localStorage.getItem(HEADER_SETTINGS_CACHE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') return parsed;
        }
    } catch (e) {}
    return {};
}

function writeCachedHeaderSettings(settings) {
    try {
        localStorage.setItem(HEADER_SETTINGS_CACHE_KEY, JSON.stringify(settings || {}));
    } catch (e) {}
}

function syncDesktopNavActive(targetId) {
    document.querySelectorAll('[data-nav-view]').forEach(btn => {
        const viewId = btn.getAttribute('data-nav-view');
        if (viewId === targetId) {
            btn.classList.add('text-devo-orange', 'font-black', 'bg-devo-orange/15', 'border-devo-orange/40', 'shadow-sm');
            btn.classList.remove('text-devo-muted', 'border-transparent');
        } else {
            btn.classList.remove('text-devo-orange', 'font-black', 'bg-devo-orange/15', 'border-devo-orange/40', 'shadow-sm');
            btn.classList.add('text-devo-muted', 'border-transparent');
        }
    });
}

export async function initNavbar() {
    const { session } = getCurrentSession();
    const user = session ? session.user : null;

    // 1. عرض فوري للهيدر والبار السفلي من الكاش أو الإعدادات الافتراضية لمنع اختفاء البار نهائياً
    const cachedSettings = readCachedHeaderSettings();
    const initialLayoutId = cachedSettings.header_layout || 'classic';
    const initialHeight = String(cachedSettings.header_height || '80');

    renderHeader(initialLayoutId, user, cachedSettings);

    // تسجيل الخروج
    window.handleLogout = () => { logoutUser(); };

    // تسجيل تحذير الزائر
    window.alertVisitor = () => {
        showToast('يجب أن تكون من ضمن فريق العمل للوصول لهذه الميزة', 'warning');
    };

    // دالة مساعدة لعرض التنبيهات المخصصة بدلاً من confirm الافتراضي للمتصفح
    const showCustomConfirm = (message, title = 'تأكيد الإجراء', isDestructive = false) => {
        if (typeof window.confirmDialog === 'function') {
            return window.confirmDialog({
                title: title,
                message: message,
                confirmText: 'نعم',
                cancelText: 'إلغاء',
                isDestructive: isDestructive
            });
        }
        return Promise.resolve(confirm(message));
    };

    // دالة مساعدة لتحديد الصفحة الافتراضية عند التحميل أو عمل ريفريش
    function resolveInitialSiteView() {
        if (localStorage.getItem('devo_edit_order_data')) {
            return 'view-cart';
        }

        const validViews = ['view-home', 'view-gallery', 'view-barcode', 'view-cart', 'view-orders', 'view-visitor-cart'];
        const aliasMap = {
            'home': 'view-home',
            'gallery': 'view-gallery',
            'barcode': 'view-barcode',
            'cart': 'view-cart',
            'orders': 'view-orders',
            'visitor-cart': 'view-visitor-cart'
        };

        const hash = (window.location.hash || '').replace('#', '').trim().toLowerCase();
        let target = aliasMap[hash] || (validViews.includes(hash) ? hash : null);

        if (!target) {
            try {
                const saved = (localStorage.getItem('devo_active_site_view') || '').trim().toLowerCase();
                target = aliasMap[saved] || (validViews.includes(saved) ? saved : null);
            } catch (e) {}
        }

        if (window.isVisitor && target && target !== 'view-home' && target !== 'view-gallery' && target !== 'view-barcode' && target !== 'view-visitor-cart') {
            target = 'view-home';
        }

        return target || 'view-home';
    }

    // 2. نظام التوجيه (التبديل بين الصفحات بدون تحميل)
    window.switchSiteView = async (targetId, skipHistory = false) => {
        // تأكيد الخروج من صفحة الباركود إلا إذا كان الهدف هو السلة
        if (!skipHistory && window.currentView === 'view-barcode' && targetId !== 'view-cart' && targetId !== 'view-visitor-cart') {
            const confirmed = await showCustomConfirm("هل تريد الخروج من صفحة الباركود؟", "تأكيد الانتقال");
            if (!confirmed) {
                return;
            }
        }

        // حفظ الصفحة الحالية في التخزين المحلي لضمان استرجاعها عند الريفريش
        try {
            localStorage.setItem('devo_active_site_view', targetId);
        } catch (e) {}

        const hashUrl = window.location.pathname + window.location.search + '#' + targetId;

        // دفع الصفحة الجديدة في سجل المتصفح وتحديث الـ hash
        if (!skipHistory) {
            history.pushState({ view: targetId }, '', hashUrl);
        } else {
            history.replaceState({ view: targetId }, '', hashUrl);
        }

        window.currentView = targetId;

        document.querySelectorAll('.site-view-section').forEach(el => {
            el.classList.remove('block');
            el.classList.add('hidden');
        });

        const target = document.getElementById(targetId);
        if (target) {
            target.classList.remove('hidden');
            target.classList.add('block');
            window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
            if (document.documentElement) document.documentElement.scrollLeft = 0;
            if (document.body) document.body.scrollLeft = 0;
        }

        // تمييز وتظليل التبويب النشط فورياً في جميع الـ Layouts
        syncDesktopNavActive(targetId);

        // تمييز وتظليل التبويب النشط في شريط التنقل السفلي للموبايل
        syncBottomNavActive(targetId);

        // تحديث ارتفاع الهيدر وحالة الشفافية فور الانتقال بين الصفحات
        syncHeaderHeightVar();
        syncTransparentHeaderState();

        // إغلاق قائمة الموبايل إذا كانت مفتوحة
        if (isMobileMenuOpen()) {
            closeMobileMenu();
        }

        // تنبيه بتغيير الصفحة للتحكم في الكاميرا والباركود
        if (typeof window.onViewChanged === 'function') {
            window.onViewChanged(targetId);
        }

        // تحديث فوري للسلة أو الأوردرات عند التبديل
        if (targetId === 'view-cart' && typeof window.refreshCartView === 'function') {
            window.refreshCartView();
        } else if (targetId === 'view-orders' && typeof window.refreshWorkerOrders === 'function') {
            window.refreshWorkerOrders();
        } else if (targetId === 'view-visitor-cart' && typeof window.refreshVisitorCartView === 'function') {
            window.refreshVisitorCartView();
        }
    };

    if (!window.__devoNavbarRouterInit) {
        window.__devoNavbarRouterInit = true;
        let isConfirmingExit = false;

        // الاستماع لحركة الرجوع والتقدم بالمتصفح بشكل مركزي وتوحيد المنطق
        window.addEventListener('popstate', async (event) => {
            // 1. أولاً: التحقق من أي نافذة منبثقة مفتوحة وإغلاقها فورياً عند ضغط زر الرجوع (Back)
            const openCustomBackdrop = document.querySelector('.devo-custom-backdrop');
            if (openCustomBackdrop) {
                const cancelBtn = openCustomBackdrop.querySelector('#devo-cancel-btn, #devo-prompt-cancel-btn');
                if (cancelBtn) {
                    cancelBtn.click();
                    return;
                }
            }

            const invoiceModal = document.getElementById('invoice-modal');
            if (invoiceModal && !invoiceModal.classList.contains('hidden')) {
                if (typeof window.finishOrderAndRedirect === 'function') {
                    window.finishOrderAndRedirect(true);
                } else {
                    invoiceModal.classList.add('hidden');
                }
                return;
            }

            const orderDetailsModal = document.getElementById('order-details-modal');
            if (orderDetailsModal && !orderDetailsModal.classList.contains('hidden')) {
                if (typeof window.closeOrderDetailsModal === 'function') {
                    window.closeOrderDetailsModal(true);
                } else {
                    orderDetailsModal.classList.add('hidden');
                }
                return;
            }

            const editWarningModal = document.getElementById('edit-warning-modal');
            if (editWarningModal && !editWarningModal.classList.contains('hidden')) {
                if (typeof window.closeEditWarningModal === 'function') {
                    window.closeEditWarningModal(true);
                } else {
                    editWarningModal.classList.add('hidden');
                }
                return;
            }

            const confirmModal = document.getElementById('confirm-modal');
            if (confirmModal && !confirmModal.classList.contains('hidden')) {
                if (typeof window.closeConfirmModal === 'function') {
                    window.closeConfirmModal(true);
                } else {
                    confirmModal.classList.add('hidden');
                }
                return;
            }

            const visitorSuccessModal = document.getElementById('visitor-order-success-modal');
            if (visitorSuccessModal && !visitorSuccessModal.classList.contains('hidden')) {
                if (typeof window.closeVisitorOrderSuccess === 'function') {
                    window.closeVisitorOrderSuccess();
                } else {
                    visitorSuccessModal.classList.add('hidden');
                }
                return;
            }

            const modelModal = document.getElementById('model-viewer-modal');
            if (modelModal) {
                const urlParams = new URLSearchParams(window.location.search);
                const modelId = urlParams.get('model');
                if (modelId) {
                    if (typeof window.openModelViewer === 'function') {
                        window.openModelViewer(modelId, true);
                    }
                    return;
                } else if (!modelModal.classList.contains('hidden')) {
                    if (typeof window.closeModelViewer === 'function') {
                        window.closeModelViewer(true);
                    }
                    return;
                }
            }

            // إغلاق قائمة الموبايل إذا كانت مفتوحة
            if (isMobileMenuOpen()) {
                closeMobileMenu();
                return;
            }

            // 2. ثانياً: معالجة التنقل وحماية الخروج من الموقع وتأكيد الخروج من الباركود
            if (event.state) {
                const targetView = event.state.view;
                if (targetView === 'exit-trap') {
                    if (isConfirmingExit) return;
                    isConfirmingExit = true;

                    // منع مغادرة الموقع نهائياً وسؤال المستخدم أولاً بنافذة مخصصة
                    const confirmed = await showCustomConfirm("هل تريد بالفعل مغادرة الموقع وإغلاق الجلسة؟", "تأكيد الخروج من الموقع", true);
                    isConfirmingExit = false;

                    if (confirmed) {
                        history.back();
                    } else {
                        const cur = window.currentView || 'view-home';
                        history.pushState({ view: cur }, '', window.location.pathname + window.location.search + '#' + cur);
                        window.switchSiteView(cur, true);
                    }
                } else if (targetView) {
                    if (window.currentView === 'view-barcode' && targetView !== 'view-cart' && targetView !== 'view-visitor-cart') {
                        const confirmed = await showCustomConfirm("هل تريد الخروج من صفحة الباركود؟", "تأكيد الانتقال");
                        if (confirmed) {
                            window.switchSiteView(targetView, true);
                        } else {
                            history.pushState({ view: 'view-barcode' }, '', window.location.pathname + window.location.search + '#view-barcode');
                        }
                    } else {
                        window.switchSiteView(targetView, true);
                    }
                }
            } else {
                const cur = window.currentView || 'view-home';
                history.pushState({ view: cur }, '', window.location.pathname + window.location.search + '#' + cur);
                window.switchSiteView(cur, true);
            }
        });

        // الاستماع لتغيير الـ Hash مباشرة من الرابط
        window.addEventListener('hashchange', () => {
            const targetView = resolveInitialSiteView();
            if (targetView && targetView !== window.currentView) {
                window.switchSiteView(targetView, true);
            }
        });

        // التنشيط الأولي للشاشة الافتراضية مع إعداد حماية الرجوع للخلف (exit-trap)
        const initialView = resolveInitialSiteView();
        window.currentView = initialView;
        history.replaceState({ view: 'exit-trap' }, '', window.location.pathname + window.location.search);
        history.pushState({ view: initialView }, '', window.location.pathname + window.location.search + '#' + initialView);
        window.switchSiteView(initialView, true);
    } else if (window.currentView) {
        syncDesktopNavActive(window.currentView);
        syncBottomNavActive(window.currentView);
        syncHeaderHeightVar();
        syncTransparentHeaderState();
    }

    // 3. تحديث إعدادات الهيدر في الخلفية من Supabase بدون حجب العرض الأولي أبداً
    (async () => {
        try {
            const { data } = await supabase.from('home_settings').select('*');
            if (!data || !Array.isArray(data)) return;
            const freshSettings = {};
            data.forEach(item => { freshSettings[item.setting_key] = item.setting_value; });
            writeCachedHeaderSettings(freshSettings);

            const freshLayoutId = freshSettings.header_layout || 'classic';
            const freshHeight = String(freshSettings.header_height || '80');

            if (freshLayoutId !== initialLayoutId || freshHeight !== initialHeight) {
                const { session: latestSession } = getCurrentSession();
                const latestUser = latestSession ? latestSession.user : null;
                renderHeader(freshLayoutId, latestUser, freshSettings);
                if (window.currentView) {
                    syncDesktopNavActive(window.currentView);
                    syncBottomNavActive(window.currentView);
                }
            }
        } catch (e) {
            console.warn('[Navbar] Could not refresh header settings from Supabase, keeping cached/default layout.');
        }
    })();
}