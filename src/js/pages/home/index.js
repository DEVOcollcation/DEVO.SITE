import { initNavbar } from './navbar.js';
import { initGallery } from './gallery.js';
import { initHomeContent } from './home_content.js'; // استدعاء المحرك الجديد

document.addEventListener('DOMContentLoaded', async () => {
    // 1. تهيئة شريط التنقل والراوتر
    initNavbar();

    // 2. تهيئة محتوى الرئيسية (من قاعدة البيانات)
    await initHomeContent();

    // 3. تهيئة وجلب الموديلات للمعرض
    await initGallery();
});