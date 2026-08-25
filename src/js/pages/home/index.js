import { initNavbar } from './navbar.js';
import { initGallery } from './gallery.js?v=9.2';
import { initHomeContent } from './home_content.js?v=9.2';
import { initCart } from './cart.js?v=9.2';
import { initOrdersView } from './orders.js?v=9.2';
import { initBarcode } from './barcode.js?v=9.2';
import { initFooter } from './footer_renderer.js';
import { syncActiveTheme } from '../../services/theme.js';
import { initNetworkStatusMonitor } from '../../components/network_banner.js';
import { validateAndSyncSession, setupUserRealtimeSync } from '../../services/auth.js';

document.addEventListener('DOMContentLoaded', async () => {
    // مراقبة وإظهار بنر الاتصال بالإنترنت عند الانقطاع
    initNetworkStatusMonitor();

    // تزامن المظهر النشط من قاعدة البيانات
    syncActiveTheme();
    
    // التحقق من الجلسة وصلاحية البائع/المبيعات إن وجدت
    const sessionStr = localStorage.getItem('devo_session');
    let currentUser = null;

    if (sessionStr) {
        try {
            currentUser = JSON.parse(sessionStr);
            if (currentUser && currentUser.user) currentUser = currentUser.user;
        } catch (e) {
            localStorage.removeItem('devo_session');
            currentUser = null;
        }
    }
    
    if (currentUser) {
        const role = String(currentUser.role || '').toLowerCase().trim();
        const isAuthorized = (role === 'owner' || role === 'admin' || role === 'worker' || role === 'sales' || !!currentUser.id);
        
        if (!isAuthorized) {
            localStorage.removeItem('devo_session');
            currentUser = null;
        }
    }

    // تعيين علامة الزائر عالمياً
    window.isVisitor = !currentUser;

    // تهيئة الهيدر والفوتر والمحتوى والمعرض بشكل توازي سريع فوراً (Instant Concurrent Load)
    Promise.all([
        initNavbar(),
        initFooter(),
        initHomeContent(),
        initGallery()
    ]);
    
    // تشغيل السلة والأوردرات والباركود فقط لفريق العمل والمديرين
    if (!window.isVisitor) {
        initCart();
        await initOrdersView();
        initBarcode();

        if (localStorage.getItem('devo_edit_order_data')) {
            if (window.switchSiteView) window.switchSiteView('view-cart');
        }

        // 🌟 فحص وتزامن الصلاحيات الحي من قاعدة البيانات في الخلفية 🌟
        validateAndSyncSession().then(syncedUser => {
            if (syncedUser && (syncedUser.role !== currentUser?.role || syncedUser.worker_job !== currentUser?.worker_job)) {
                initNavbar(); // تحديث الهيدر والأزرار فورياً إذا تغيرت الصلاحية
            }
        });

        // 🌟 الرادار اللحظي للصلاحيات (يحدث الواجهة في جزء من الثانية إذا عدلت الإدارة الصلاحيات) 🌟
        setupUserRealtimeSync((updatedUser) => {
            initNavbar(); // تحديث الهيدر وشارة المستخدم والزر الإداري فورياً
        });
    }
});