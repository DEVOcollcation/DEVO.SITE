import { requireAuth, logoutUser } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';
import { initHomeSettingsView } from './home_settings.js';
// استيراد صفحة المستخدمين (كما كانت في كودك)
import { initUsersView } from './users.js';

// --- Security Check (Protect the Admin Route) ---
let currentUserContext = null;

async function authenticateAdmin() {
    // استخدام دالة الحماية الجديدة بدلاً من القديمة
    const user = requireAuth(['owner', 'admin']); 
    
    if (!user) {
        return false;
    }

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
    if (roleEl) {
        roleEl.textContent = roleText;
        roleEl.className = `text-xs font-bold ${roleColor}`;
    }

    // 🌟 السطر السحري لإخفاء/إظهار زر إدارة الحسابات بناءً على الصلاحية 🌟
    const usersLink = document.querySelector('[data-target="view-users"]');
    if (usersLink) {
        if (profile.role === 'owner') {
            usersLink.classList.remove('hidden'); // إظهار للمالك
        } else {
            usersLink.classList.add('hidden'); // إخفاء للمدير
        }
    }
}
// --- Navigation Engine (Router Logic) ---
const views = document.querySelectorAll('.view-section');
const navLinks = document.querySelectorAll('.nav-link');
const pageTitle = document.getElementById('page-title');

function switchView(targetId, titleElement) {
    // 1. Hide all views
    views.forEach(view => {
        view.classList.add('hidden');
        view.classList.remove('animate-fade-in'); 
    });

    // 2. Remove active state from all links
    navLinks.forEach(link => {
        link.classList.remove('bg-devo-orange/10', 'text-devo-orange');
        link.classList.add('text-devo-muted');
    });

    // 3. Show the target view
    const targetView = document.getElementById(targetId);
    if (targetView) {
        targetView.classList.remove('hidden');
        // targetView.classList.add('animate-fade-in'); 
    }

    // 4. Highlight active link and update Topbar title
    if (titleElement) {
        titleElement.classList.remove('text-devo-muted');
        titleElement.classList.add('bg-devo-orange/10', 'text-devo-orange');
        pageTitle.textContent = titleElement.querySelector('span').textContent;
    }

    // 5. Initialize View Logic (Lazy Loading)
    loadViewLogic(targetId);
}

// Map views to their specific JS initialization functions
async function loadViewLogic(targetId) {
    
    if (targetId === 'view-users' && currentUserContext?.role !== 'owner') {
        showToast('عفواً، هذه الصفحة مخصصة لمالك النظام فقط 🛑', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return; 
    }

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
        case 'view-home-settings':
            await initHomeSettingsView();
            break;
        case 'view-admin-orders':
            const { initAdminOrdersView } = await import('./admin_orders.js');
            await initAdminOrdersView();
            break;
    }
}
// --- Event Listeners Initialization ---
async function initRouter() {
    // Wait for authentication before rendering anything
    const isAuth = await authenticateAdmin();
    if (!isAuth) return;

    // Attach click events to Sidebar Links
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            switchView(targetId, link);
        });
    });

    // Handle Logout (تم تحديثه ليعمل مع النظام الجديد بدون أخطاء)
    document.getElementById('logout-btn').addEventListener('click', () => {
        logoutUser(); // الدالة الجديدة لا ترجع Error بل تخرج فوراً
    });

    // Activate Default View (Dashboard)
    const defaultLink = document.querySelector('[data-target="view-dashboard"]');
    if (defaultLink) switchView('view-dashboard', defaultLink);
}

// Start the Router
document.addEventListener('DOMContentLoaded', initRouter);