import { initNavbar } from './navbar.js';
import { initGallery } from './gallery.js';
import { initHomeContent } from './home_content.js';
import { initCart } from './cart.js?v=8.0';
import { initOrdersView } from './orders.js?v=8.0';
import { initBarcode } from './barcode.js';
import { initFooter } from './footer_renderer.js';
import { syncActiveTheme } from '../../services/theme.js';
import { initNetworkStatusMonitor } from '../../components/network_banner.js';

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
        } catch (e) {
            localStorage.removeItem('devo_session');
        }
    }
    
    if (currentUser) {
        const role = currentUser.role;
        const workerJob = currentUser.worker_job;
        

        
        // التحقق من الصلاحيات الأخرى، إن كانت غير معروفة يتم تسجيل الخروج والتعامل كزائر
        const isManager = (role === 'owner' || role === 'admin');
        const isShowroomSeller = (role === 'worker' && (workerJob === 'showroom' || workerJob === 'both'));
        
        if (!isManager && !isShowroomSeller) {
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
    }
});