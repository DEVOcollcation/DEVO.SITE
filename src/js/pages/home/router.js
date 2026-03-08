import { requireAuth, logoutUser } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

// استيراد دوال التهيئة للصفحات
import { initUsersView } from './users.js';

// --- Security Check (Protect the Admin Route) ---
let currentUserContext = null;

async function authenticateAdmin() {
    // 1. الدالة الجديدة requireAuth تقوم بكل شيء:
    // تتأكد من تسجيل الدخول، وتتأكد أن الصلاحية (owner أو admin)، وتطرد من لا يملك الصلاحية.
    const user = requireAuth(['owner', 'admin']); 
    
    if (!user) return false; // إذا كان null يعني تم طرده لصفحة أخرى

    currentUserContext = user;
    updateUserProfileUI(user);
    return true;
}

function updateUserProfileUI(profile) {
    document.getElementById('current-user-name').textContent = profile.full_name;
    document.getElementById('user-avatar').textContent = profile.full_name.charAt(0).toUpperCase();
    
    const roleText = profile.role === 'owner' ? 'مالك النظام' : 'مدير نظام';
    const roleColor = profile.role === 'owner' ? 'text-red-500' : 'text-devo-orange';
    
    const roleEl = document.getElementById('current-user-role');
    if(roleEl) {
        roleEl.textContent = roleText;
        roleEl.className = `text-xs font-bold ${roleColor}`;
    }
}

// --- Navigation Engine (Router Logic) ---
const views = document.querySelectorAll('.view-section');
const navLinks = document.querySelectorAll('.nav-link');
const pageTitle = document.getElementById('page-title');

function switchView(targetId, titleElement) {
    // 1. إخفاء جميع الصفحات
    views.forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('animate-fade-in'); 
    });

    // 2. إزالة حالة "النشط" من جميع الروابط
    navLinks.forEach(link => {
        link.classList.remove('bg-devo-orange/10', 'text-devo-orange');
        link.classList.add('text-devo-muted');
    });

    // 3. إظهار الصفحة المطلوبة
    const targetView = document.getElementById(targetId);
    if (targetView) {
        targetView.classList.remove('hidden');
    }

    // 4. تفعيل الرابط وتحديث العنوان
    if (titleElement) {
        titleElement.classList.remove('text-devo-muted');
        titleElement.classList.add('bg-devo-orange/10', 'text-devo-orange');
        if(pageTitle) {
            pageTitle.textContent = titleElement.querySelector('span').textContent;
        }
    }

    // 5. تشغيل منطق الصفحة (Lazy Loading)
    loadViewLogic(targetId);
}

// Map views to their specific JS initialization functions
async function loadViewLogic(targetId) {
    switch (targetId) {
        case 'view-dashboard':
            // await initDashboard();
            break;
        case 'view-users':
            await initUsersView();
            break;
        case 'view-definitions':
            const { initDefinitionsView } = await import('./definitions.js');
            initDefinitionsView();
            break;
        case 'view-models':
            const { initModelsView } = await import('./models.js'); 
            await initModelsView(); 
            break;
    }
}

// --- Event Listeners Initialization ---
async function initRouter() {
    // 1. انتظار المصادقة قبل رسم أي شيء
    const isAuth = await authenticateAdmin();
    if (!isAuth) return;

    // 2. ربط الروابط في القائمة الجانبية
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            switchView(targetId, link);
        });
    });

    // 3. ربط زر تسجيل الخروج
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            logoutUser();
        });
    }

    // 4. تشغيل الصفحة الافتراضية (الداشبورد)
    const defaultLink = document.querySelector('[data-target="view-dashboard"]');
    if (defaultLink) switchView('view-dashboard', defaultLink);
}

// Start the Router
document.addEventListener('DOMContentLoaded', initRouter);