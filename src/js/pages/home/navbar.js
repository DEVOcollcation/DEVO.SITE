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

    // نظام التوجيه (التبديل بين الصفحات بدون تحميل)
    window.switchSiteView = (targetId) => {
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
}