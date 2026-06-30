import { initNavbar } from './navbar.js';
import { initGallery } from './gallery.js';
import { initHomeContent } from './home_content.js';
import { initCart } from './cart.js';
import { initOrdersView } from './orders.js';
import { initBarcode } from './barcode.js';

document.addEventListener('DOMContentLoaded', async () => {
    // التحقق من الجلسة وصلاحية البائع/المبيعات
    const sessionStr = localStorage.getItem('devo_session');
    if (!sessionStr) {
        window.location.href = 'auth.html';
        return;
    }
    
    try {
        const currentUser = JSON.parse(sessionStr);
        const role = currentUser.role;
        const workerJob = currentUser.worker_job;
        
        const isManager = (role === 'owner' || role === 'admin');
        const isShowroomSeller = (role === 'worker' && (workerJob === 'showroom' || workerJob === 'both'));
        
        if (!isManager && !isShowroomSeller) {
            if (role === 'worker' && workerJob === 'warehouse') {
                window.location.href = 'warehouse.html';
            } else {
                localStorage.removeItem('devo_session');
                window.location.href = 'auth.html';
            }
            return;
        }
    } catch (e) {
        window.location.href = 'auth.html';
        return;
    }

    initNavbar();
    await initHomeContent();
    await initGallery();
    initCart();
    await initOrdersView();
    initBarcode();
});