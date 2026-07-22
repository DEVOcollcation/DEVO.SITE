import { getCurrentSession, logoutUser } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';
import { renderHeader, attachMobileMenuToggle } from './header_layouts.js';
import { supabase } from '../../config/supabase.js';

export async function initNavbar() {
    const { session } = getCurrentSession();
    const user = session ? session.user : null;

    // جلب إعدادات الهيدر من Supabase
    let settings = {};
    try {
        const { data } = await supabase.from('home_settings').select('*');
        if (data) {
            data.forEach(item => settings[item.setting_key] = item.setting_value);
        }
    } catch (e) {
        console.warn('[Navbar] Could not load header settings, using defaults.');
    }

    const layoutId = settings.header_layout || 'classic';

    // تطبيق الـ Layout
    renderHeader(layoutId, user, settings);

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

    // نظام التوجيه (التبديل بين الصفحات بدون تحميل)
    window.switchSiteView = async (targetId, skipHistory = false) => {
        // تأكيد الخروج من صفحة الباركود إلا إذا كان الهدف هو السلة
        if (!skipHistory && window.currentView === 'view-barcode' && targetId !== 'view-cart') {
            const confirmed = await showCustomConfirm("هل تريد الخروج من صفحة الباركود؟", "تأكيد الانتقال");
            if (!confirmed) {
                return;
            }
        }

        // دفع الصفحة الجديدة في سجل المتصفح
        if (!skipHistory) {
            history.pushState({ view: targetId }, '', window.location.pathname + window.location.search);
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
            window.scrollTo(0, 0);
        }

        // تمييز وتظليل التبويب النشط فورياً في جميع الـ Layouts
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

        // إغلاق قائمة الموبايل إذا كانت مفتوحة
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileMenu && !mobileMenu.classList.contains('translate-x-full')) {
            mobileMenu.classList.add('translate-x-full');
            const icon = document.querySelector('#mobile-menu-btn i');
            if (icon) {
                icon.classList.add('ph-list');
                icon.classList.remove('ph-x');
            }
        }

        // تنبيه بتغيير الصفحة للتحكم في الكاميرا والباركود
        if (typeof window.onViewChanged === 'function') {
            window.onViewChanged(targetId);
        }
    };

    let isConfirmingExit = false;

    // الاستماع لحركة الرجوع والتقدم بالمتصفح بشكل مركزي وتوحيد المنطق
    window.addEventListener('popstate', async (event) => {
        // 1. أولاً: التحقق من روابط وتفاصيل الموديل (Deep linking / details modal)
        const urlParams = new URLSearchParams(window.location.search);
        const modelId = urlParams.get('model');
        const modal = document.getElementById('model-viewer-modal');
        
        if (modal) {
            if (modelId) {
                if (typeof window.openModelViewer === 'function') {
                    window.openModelViewer(modelId, true);
                }
                return;
            } else if (!modal.classList.contains('hidden')) {
                if (typeof window.closeModelViewer === 'function') {
                    window.closeModelViewer(true);
                }
                return;
            }
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
                    // إلغاء الخروج وإعادة دفع حالة الصفحة الحالية لتثبيت الصفحة
                    history.pushState({ view: window.currentView || 'view-home' }, '', window.location.pathname + window.location.search);
                    window.switchSiteView(window.currentView || 'view-home', true);
                }
            } else if (targetView) {
                if (window.currentView === 'view-barcode' && targetView !== 'view-cart') {
                    const confirmed = await showCustomConfirm("هل تريد الخروج من صفحة الباركود؟", "تأكيد الانتقال");
                    if (confirmed) {
                        window.switchSiteView(targetView, true);
                    } else {
                        // إلغاء الخروج وإعادة دفع حالة الباركود لتثبيت الصفحة
                        history.pushState({ view: 'view-barcode' }, '', window.location.pathname + window.location.search);
                    }
                } else {
                    window.switchSiteView(targetView, true);
                }
            }
        } else {
            // حالة احتياطية لحماية الموقع
            history.pushState({ view: 'view-home' }, '', window.location.pathname + window.location.search);
            window.switchSiteView('view-home', true);
        }
    });

    // التنشيط الأولي للشاشة الافتراضية مع إعداد حماية الرجوع للخلف (exit-trap)
    const initialView = localStorage.getItem('devo_edit_order_data') ? 'view-cart' : 'view-home';
    
    window.currentView = initialView;
    history.replaceState({ view: 'exit-trap' }, '', window.location.pathname + window.location.search);
    history.pushState({ view: initialView }, '', window.location.pathname + window.location.search);
    
    window.switchSiteView(initialView, true);
}