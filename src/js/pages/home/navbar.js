import { getCurrentSession, logoutUser } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

export function initNavbar() {
    const { session } = getCurrentSession();
    const user = session ? session.user : null;
    const isWorker = user && user.role === 'worker';
    const isAdmin = user && (user.role === 'admin' || user.role === 'owner');

    const desktopLinks = document.getElementById('desktop-nav-links');
    const mobileLinks = document.getElementById('mobile-nav-links');
    const desktopUserArea = document.getElementById('desktop-user-area');

    if (!desktopLinks || !mobileLinks || !desktopUserArea) return;

    window.alertVisitor = () => {
        showToast('يجب تسجيل الدخول للوصول لهذه الميزة', 'warning');
    };

    // نظام التوجيه (التبديل بين الصفحات بدون تحميل)
    window.switchSiteView = (targetId) => {
        // إخفاء كل الأقسام
        document.querySelectorAll('.site-view-section').forEach(el => {
            el.classList.remove('block');
            el.classList.add('hidden');
        });
        
        // إظهار القسم المطلوب
        const target = document.getElementById(targetId);
        if (target) {
            target.classList.remove('hidden');
            target.classList.add('block');
            window.scrollTo(0,0);
        }

        // إغلاق قائمة الموبايل إذا كانت مفتوحة
        const mobileMenu = document.getElementById('mobile-menu');
        if (mobileMenu && !mobileMenu.classList.contains('translate-x-full')) {
            mobileMenu.classList.add('translate-x-full');
            const icon = document.querySelector('#mobile-menu-btn i');
            if(icon) { icon.classList.add('ph-list'); icon.classList.remove('ph-x'); }
        }
    };

    if (user) {
        // روابط المسجل دخول
        desktopLinks.innerHTML = `
            <button onclick="switchSiteView('view-home')" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors">الرئيسية</button>
            <button onclick="switchSiteView('view-gallery')" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors">المعرض</button>
            <button onclick="switchSiteView('view-cart'); window.refreshCartView();" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors flex items-center gap-1"><i class="ph ph-shopping-cart"></i> السلة</button>
            <button onclick="switchSiteView('view-orders')" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors flex items-center gap-1"><i class="ph ph-receipt"></i> الأوردرات</button>
        `;
        
        mobileLinks.innerHTML = `
            <button onclick="switchSiteView('view-home')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">الرئيسية</button>
            <button onclick="switchSiteView('view-gallery')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">المعرض</button>
            <button onclick="switchSiteView('view-cart'); window.refreshCartView();" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full"><i class="ph ph-shopping-cart"></i> السلة</button>
            <button onclick="switchSiteView('view-orders')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full"><i class="ph ph-receipt"></i> الأوردرات</button>
            ${isAdmin ? `<a href="admin.html" class="py-3 text-devo-info hover:text-white border-b border-devo-gray flex items-center gap-2"><i class="ph ph-shield-check"></i> لوحة الإدارة</a>` : ''}
            <button onclick="handleLogout()" class="py-3 text-devo-error text-right mt-4 flex items-center gap-2"><i class="ph ph-sign-out"></i> تسجيل خروج</button>
        `;

        desktopUserArea.innerHTML = `
            ${isAdmin ? `<a href="admin.html" class="text-devo-info hover:text-white text-sm font-bold flex items-center gap-1" title="لوحة الإدارة"><i class="ph ph-shield-check text-xl"></i></a>` : ''}
            <div class="flex items-center gap-2 border-r border-devo-gray pr-4 mr-2">
                <div class="text-right">
                    <p class="text-sm font-bold text-white leading-tight">${user.full_name}</p>
                    <p class="text-[10px] text-devo-orange leading-tight">${isWorker ? 'عامل مبيعات' : 'إدارة'}</p>
                </div>
                <div class="w-10 h-10 rounded-full bg-devo-gray flex items-center justify-center text-white font-bold cursor-pointer hover:bg-devo-orange transition-colors" onclick="handleLogout()" title="تسجيل الخروج">
                    <i class="ph ph-sign-out text-xl"></i>
                </div>
            </div>
        `;
        window.handleLogout = () => { logoutUser(); };

    } else {
        // روابط الزائر
        desktopLinks.innerHTML = `
            <button onclick="switchSiteView('view-home')" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors">الرئيسية</button>
            <button onclick="switchSiteView('view-gallery')" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors">المعرض</button>
            <button onclick="alertVisitor()" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted/50 cursor-not-allowed flex items-center gap-1"><i class="ph ph-shopping-cart"></i> السلة <i class="ph ph-lock-key text-[10px]"></i></button>
        `;

        mobileLinks.innerHTML = `
            <button onclick="switchSiteView('view-home')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">الرئيسية</button>
            <button onclick="switchSiteView('view-gallery')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">المعرض</button>
            <a href="auth.html" class="py-3 text-devo-orange mt-4 flex items-center gap-2"><i class="ph ph-sign-in"></i> تسجيل الدخول</a>
        `;

        desktopUserArea.innerHTML = `
            <a href="auth.html" class="bg-devo-gray hover:bg-devo-orange text-white text-sm font-bold py-2 px-6 rounded-lg transition-colors flex items-center gap-2">
                تسجيل الدخول <i class="ph ph-sign-in text-lg"></i>
            </a>
        `;
    }

    // زر القائمة الجانبية للموبايل
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileBtn && mobileMenu) {
        mobileBtn.addEventListener('click', () => {
            mobileMenu.classList.toggle('translate-x-full');
            const icon = mobileBtn.querySelector('i');
            icon.classList.toggle('ph-list');
            icon.classList.toggle('ph-x');
        });
    }
}