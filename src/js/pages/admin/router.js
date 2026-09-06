import { requireAuth, logoutUser, validateAndSyncSession, setupUserRealtimeSync } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';
import { initHomeSettingsView } from './home_settings.js';
// استيراد صفحة المستخدمين (كما كانت في كودك)
import { initUsersView } from './users.js';
import { syncActiveTheme } from '../../services/theme.js';
import { initNotifications } from '../../services/notifications.js';
import { initNetworkStatusMonitor } from '../../components/network_banner.js';

// --- Security Check (Protect the Admin Route) ---
let currentUserContext = null;

const OWNER_ONLY_VIEWS = [
    'view-users',
    'view-home-settings',
    'view-theme-manager',
    'view-backup-restore',
    'view-notification-settings',
    'view-system-reset'
];

async function authenticateAdmin() {
    const user = requireAuth(['owner', 'admin']); 
    
    if (!user) {
        return false;
    }

    currentUserContext = user;
    updateUserProfileUI(user);

    // التحقق الحي المتزامن من قاعدة البيانات فور فتح الصفحة
    validateAndSyncSession(['owner', 'admin']).then((syncedUser) => {
        if (syncedUser) {
            currentUserContext = syncedUser;
            updateUserProfileUI(syncedUser);
        }
    });

    // تفعيل الرادار اللحظي للصلاحيات (إذا قام المالك بتعديل صلاحيات هذا الحساب فوراً)
    setupUserRealtimeSync((updatedUser) => {
        currentUserContext = updatedUser;
        updateUserProfileUI(updatedUser);
        if (updatedUser.role !== 'owner' && OWNER_ONLY_VIEWS.includes(window.currentAdminView)) {
            showToast('تم تحديث صلاحياتك بواسطة إدارة النظام', 'info');
            const dashLink = document.querySelector('[data-target="view-dashboard"]');
            switchView('view-dashboard', dashLink);
        }
    });

    return true;
}

function updateUserProfileUI(profile) {
    if (!profile) return;
    document.getElementById('current-user-name').textContent = profile.full_name;
    document.getElementById('user-avatar').textContent = profile.full_name.charAt(0).toUpperCase();
    
    const isOwner = profile.role === 'owner';
    const roleText = isOwner ? 'مالك النظام' : 'مشرف إدارة';
    const roleColor = isOwner ? 'text-red-500' : 'text-devo-orange';
    
    const roleEl = document.getElementById('current-user-role');
    if (roleEl) {
        roleEl.textContent = roleText;
        roleEl.className = `text-xs font-bold ${roleColor}`;
    }

    // 🌟 حماية وتبديل قائمة إدارة الحسابات (للمالك فقط) 🌟
    const usersLink = document.querySelector('[data-target="view-users"]');
    if (usersLink) {
        if (isOwner) {
            usersLink.classList.remove('hidden');
        } else {
            usersLink.classList.add('hidden');
        }
    }

    // 🌟 حماية وتبديل قائمة الإعدادات بالكامل (للمالك فقط) 🌟
    const settingsGroup = document.getElementById('sidebar-settings-group');
    if (settingsGroup) {
        if (isOwner) {
            settingsGroup.classList.remove('hidden');
        } else {
            settingsGroup.classList.add('hidden');
        }
    }
}
// --- Navigation Engine (Router Logic) ---
const views = document.querySelectorAll('.view-section');
const navLinks = document.querySelectorAll('.nav-link');
const pageTitle = document.getElementById('page-title');

function resolveInitialAdminView() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin_model')) {
        return { targetId: 'view-models', subTab: null };
    }

    const hashStr = (window.location.hash || '').replace('#', '').trim();
    if (hashStr) {
        let viewPart = hashStr;
        let subTab = null;
        if (hashStr.includes('?')) {
            const parts = hashStr.split('?');
            viewPart = parts[0];
            const hashParams = new URLSearchParams(parts[1]);
            subTab = hashParams.get('tab');
        }

        const el = document.getElementById(viewPart);
        if (el && el.classList.contains('view-section')) {
            return { targetId: viewPart, subTab };
        }
    }

    try {
        const savedView = localStorage.getItem('devo_active_admin_view');
        const savedSubTab = localStorage.getItem('devo_active_admin_subtab');
        if (savedView) {
            const el = document.getElementById(savedView);
            if (el && el.classList.contains('view-section')) {
                return { targetId: savedView, subTab: savedSubTab };
            }
        }
    } catch (e) {}

    return { targetId: 'view-dashboard', subTab: null };
}

function switchView(targetId, titleElement = null, subTabParam = null, skipHistory = false) {
    // 🌟 فحص أمني: منع المشرف من الدخول لصفحات المالك حتى لو طلبها مباشرة 🌟
    if (OWNER_ONLY_VIEWS.includes(targetId) && currentUserContext && currentUserContext.role !== 'owner') {
        showToast('عفواً، هذه الصفحة مخصصة لمالك النظام فقط!', 'error');
        const dashLink = document.querySelector('[data-target="view-dashboard"]');
        switchView('view-dashboard', dashLink, null, skipHistory);
        return;
    }

    window.currentAdminView = targetId;
    window.currentAdminSubTab = subTabParam;

    // حفظ الصفحة في الذاكرة المحلية
    try {
        localStorage.setItem('devo_active_admin_view', targetId);
        if (subTabParam) {
            localStorage.setItem('devo_active_admin_subtab', subTabParam);
        } else {
            localStorage.removeItem('devo_active_admin_subtab');
        }
    } catch (e) {}

    // تحديث الرابط بالـ hash لضمان استرجاع الصفحة بالريفريش
    const hashFragment = subTabParam ? `${targetId}?tab=${subTabParam}` : targetId;
    const targetUrl = window.location.pathname + window.location.search + '#' + hashFragment;
    if (!skipHistory) {
        history.pushState({ adminView: targetId, subTab: subTabParam }, '', targetUrl);
    } else {
        history.replaceState({ adminView: targetId, subTab: subTabParam }, '', targetUrl);
    }

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

    // 2.1 التعامل مع القائمة الجانبية للتقارير (تمدد أو طي تلقائي عند الخروج)
    const reportsSubmenu = document.getElementById('sidebar-reports-submenu');
    const reportsChevron = document.getElementById('reports-chevron');
    const reportsToggle = document.getElementById('sidebar-reports-toggle');

    if (targetId === 'view-reports' || targetId === 'view-deposit-reports') {
        if (reportsSubmenu) reportsSubmenu.classList.remove('hidden');
        if (reportsChevron) reportsChevron.classList.add('rotate-180');
        if (reportsToggle) {
            reportsToggle.classList.remove('text-devo-muted');
            reportsToggle.classList.add('text-white');
        }
    } else {
        // الخروج خارج التقارير: طي القائمة الفرعية تلقائياً
        if (reportsSubmenu) reportsSubmenu.classList.add('hidden');
        if (reportsChevron) reportsChevron.classList.remove('rotate-180');
        if (reportsToggle) {
            reportsToggle.classList.remove('text-white', 'bg-devo-orange/10', 'text-devo-orange');
            reportsToggle.classList.add('text-devo-muted');
        }
    }

    // 2.2 التعامل مع القائمة الجانبية للإعدادات (تمدد أو طي تلقائي عند الخروج)
    const settingsViews = ['view-home-settings', 'view-theme-manager', 'view-backup-restore', 'view-notification-settings', 'view-system-reset'];
    const settingsSubmenu = document.getElementById('sidebar-settings-submenu');
    const settingsChevron = document.getElementById('settings-chevron');
    const settingsToggle = document.getElementById('sidebar-settings-toggle');

    if (settingsViews.includes(targetId)) {
        if (settingsSubmenu) settingsSubmenu.classList.remove('hidden');
        if (settingsChevron) settingsChevron.classList.add('rotate-180');
        if (settingsToggle) {
            settingsToggle.classList.remove('text-devo-muted');
            settingsToggle.classList.add('text-white');
        }
    } else {
        // الخروج خارج الإعدادات: طي القائمة الفرعية تلقائياً
        if (settingsSubmenu) settingsSubmenu.classList.add('hidden');
        if (settingsChevron) settingsChevron.classList.remove('rotate-180');
        if (settingsToggle) {
            settingsToggle.classList.remove('text-white', 'bg-devo-orange/10', 'text-devo-orange');
            settingsToggle.classList.add('text-devo-muted');
        }
    }

    // 3. Show the target view
    const targetView = document.getElementById(targetId);
    if (targetView) {
        targetView.classList.remove('hidden');
    }

    // البحث التلقائي عن رابط القائمة إذا لم يتم تمريره
    if (!titleElement) {
        if (subTabParam) {
            titleElement = document.querySelector(`.nav-link[data-target="${targetId}"][data-report-tab="${subTabParam}"]`);
        }
        if (!titleElement) {
            titleElement = document.querySelector(`.nav-link[data-target="${targetId}"]`);
        }
    }

    // 4. Highlight active link and update Topbar title
    if (titleElement) {
        titleElement.classList.remove('text-devo-muted');
        titleElement.classList.add('bg-devo-orange/10', 'text-devo-orange');
        const spanText = titleElement.querySelector('span')?.textContent;
        if (spanText && pageTitle) {
            pageTitle.textContent = spanText;
        }
    }

    // 4.1 إظهار تبويبات الأوردرات في الهيدر العلوي فقط عند فتح صفحة إدارة الأوردرات
    const aoHeaderTabs = document.getElementById('ao-header-tabs');
    if (aoHeaderTabs) {
        if (targetId === 'view-admin-orders') {
            aoHeaderTabs.classList.remove('hidden');
            aoHeaderTabs.classList.add('flex');
        } else {
            aoHeaderTabs.classList.add('hidden');
            aoHeaderTabs.classList.remove('flex');
        }
    }

    // 4.2 إظهار أزرار التقارير (تليجرام وطباعة) في الهيدر العلوي فقط عند فتح صفحة التقارير
    const reportsHeaderActions = document.getElementById('reports-header-actions');
    if (reportsHeaderActions) {
        if (targetId === 'view-reports' || targetId === 'view-deposit-reports') {
            reportsHeaderActions.classList.remove('hidden');
            reportsHeaderActions.classList.add('flex');
        } else {
            reportsHeaderActions.classList.add('hidden');
            reportsHeaderActions.classList.remove('flex');
        }
    }

    // 4.3 إظهار زر إنشاء مظهر جديد في الهيدر العلوي فقط عند فتح صفحة إدارة المظاهر
    const themeHeaderActions = document.getElementById('theme-header-actions');
    if (themeHeaderActions) {
        if (targetId === 'view-theme-manager') {
            themeHeaderActions.classList.remove('hidden');
            themeHeaderActions.classList.add('flex');
        } else {
            themeHeaderActions.classList.add('hidden');
            themeHeaderActions.classList.remove('flex');
        }
    }

    // 5. Initialize View Logic (Lazy Loading)
    const targetSubTab = subTabParam || titleElement?.getAttribute('data-report-tab') || null;
    loadViewLogic(targetId, targetSubTab);
}

// Map views to their specific JS initialization functions
async function loadViewLogic(targetId, subTab = null) {
    
    if (targetId === 'view-users' && currentUserContext?.role !== 'owner') {
        showToast('عفواً، هذه الصفحة مخصصة لمالك النظام فقط 🛑', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return; 
    }




    if (targetId === 'view-theme-manager' && currentUserContext?.role !== 'owner') {
        showToast('عفواً، هذه الصفحة مخصصة لمالك النظام فقط 🛑', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return; 
    }

    if (targetId === 'view-home-settings' && currentUserContext?.role !== 'owner') {
        showToast('عفواً، هذه الصفحة مخصصة لمالك النظام فقط 🛑', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return; 
    }

    if ((targetId === 'view-notifications' || targetId === 'view-notification-settings' || targetId === 'view-offers') && !['owner', 'admin'].includes(currentUserContext?.role)) {
        showToast('عفواً، هذه الصفحة مخصصة للمدراء والمالكين فقط 🛑', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return; 
    }

    if (targetId === 'view-add-batch' && !['owner', 'admin'].includes(currentUserContext?.role)) {
        showToast('عفواً، هذه الصفحة مخصصة للمدراء والمالكين فقط 🛑', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return; 
    }

    if (targetId === 'view-system-reset' && currentUserContext?.role !== 'owner') {
        showToast('⛔ هذه الصفحة مخصصة لمالك النظام فقط', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return;
    }

    if (targetId === 'view-backup-restore' && !['owner', 'admin'].includes(currentUserContext?.role)) {
        showToast('عفواً، هذه الصفحة مخصصة للمدراء والمالكين فقط 🛑', 'error');
        const defaultLink = document.querySelector('[data-target="view-dashboard"]');
        if (defaultLink) switchView('view-dashboard', defaultLink);
        return;
    }

    switch (targetId) {
            case 'view-dashboard':
            const { initDashboard } = await import('./dashboard.js');
            await initDashboard();
            break;
        case 'view-stock-alerts':
            const { initStockAlertsView } = await import('./stock_alerts.js');
            await initStockAlertsView();
            break;
        case 'view-users':
            await initUsersView();
            break;
        case 'view-definitions':
            const { initDefinitionsView } = await import('./definitions.js');
            initDefinitionsView();
            break;
        case 'view-models':
            const { initModelsView } = await import('./models.js?v=8.0'); 
            await initModelsView(); 
            break;
        case 'view-home-settings':
            await initHomeSettingsView();
            break;
        case 'view-bulk-edits':
            const { initBulkEditsView } = await import('./bulk_edits.js');
            await initBulkEditsView();
            break;
        case 'view-print-barcodes':
            const { initPrintBarcodesView } = await import('./print_barcodes.js');
            await initPrintBarcodesView();
            break;
        case 'view-admin-orders':
            const { initAdminOrdersView } = await import('./admin_orders.js?v=8.4');
            await initAdminOrdersView();
            break;
        case 'view-reports': {
            const { initReportsView, switchReportTab } = await import('./reports.js?v=2.1');
            await initReportsView(subTab);
            if (subTab) switchReportTab(subTab);
            break;
        }
        case 'view-deposit-reports': {
            const { initReportsView, switchReportTab } = await import('./reports.js?v=2.1');
            await initReportsView('deposits');
            switchReportTab('deposits');
            break;
        }
        case 'view-import-stock':
            const { initImportStockView } = await import('./import_stock.js');
            await initImportStockView();
            break;
        case 'view-add-batch':
            const { initInboundInvoicesView } = await import('./inbound_invoices.js');
            await initInboundInvoicesView();
            break;


        case 'view-theme-manager':
            const { initThemeManagerView } = await import('./theme_manager.js');
            await initThemeManagerView();
            break;
        case 'view-notifications':
            const { initNotificationsView } = await import('./notifications_view.js');
            await initNotificationsView();
            break;
        case 'view-offers':
            const { initOffersView } = await import('./offers.js');
            await initOffersView();
            break;
        case 'view-backup-restore':
            const { initBackupRestoreView } = await import('./backup_restore.js?v=2.2');
            initBackupRestoreView();
            break;
        case 'view-notification-settings':
            const { initNotificationSettingsView } = await import('./notification_settings.js');
            await initNotificationSettingsView();
            break;
        case 'view-system-reset':
            const { initSystemResetView } = await import('./system_reset.js');
            initSystemResetView();
            break;
    }
}
// --- Event Listeners Initialization ---
async function initRouter() {
    // مراقبة وإظهار بنر الاتصال بالإنترنت عند الانقطاع
    initNetworkStatusMonitor();

    // تزامن المظهر النشط من قاعدة البيانات
    syncActiveTheme();

    // Wait for authentication before rendering anything
    const isAuth = await authenticateAdmin();
    if (!isAuth) return;

    // تهيئة نظام الإشعارات اللحظية للأدمن
    initNotifications();

    // Attach click events to Sidebar Links (including report sublinks)
    const currentNavLinks = document.querySelectorAll('.nav-link');
    currentNavLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            const subTab = link.getAttribute('data-report-tab');
            switchView(targetId, link, subTab);
        });
    });

    // معالجة زر فتح وإغلاق قائمة التقارير الجانبية
    const reportsToggle = document.getElementById('sidebar-reports-toggle');
    if (reportsToggle) {
        reportsToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const reportsSubmenu = document.getElementById('sidebar-reports-submenu');
            const reportsChevron = document.getElementById('reports-chevron');
            const isHidden = reportsSubmenu?.classList.contains('hidden');

            if (isHidden) {
                reportsSubmenu.classList.remove('hidden');
                reportsChevron?.classList.add('rotate-180');
                const firstSublink = document.querySelector('.report-sublink[data-report-tab="sales"]');
                switchView('view-reports', firstSublink || reportsToggle, 'sales');
            } else {
                reportsSubmenu.classList.add('hidden');
                reportsChevron?.classList.remove('rotate-180');
            }
        });
    }

    // معالجة زر فتح وإغلاق قائمة الإعدادات الجانبية
    const settingsToggle = document.getElementById('sidebar-settings-toggle');
    if (settingsToggle) {
        settingsToggle.addEventListener('click', (e) => {
            e.preventDefault();
            const settingsSubmenu = document.getElementById('sidebar-settings-submenu');
            const settingsChevron = document.getElementById('settings-chevron');
            const isHidden = settingsSubmenu?.classList.contains('hidden');

            if (isHidden) {
                settingsSubmenu.classList.remove('hidden');
                settingsChevron?.classList.add('rotate-180');
                const firstVisibleSublink = settingsSubmenu.querySelector('.nav-link:not(.hidden)');
                if (firstVisibleSublink) {
                    const target = firstVisibleSublink.getAttribute('data-target');
                    switchView(target, firstVisibleSublink);
                }
            } else {
                settingsSubmenu.classList.add('hidden');
                settingsChevron?.classList.remove('rotate-180');
            }
        });
    }

    document.getElementById('logout-btn').addEventListener('click', () => {
        logoutUser(); 
    });

    // الاستماع لتغييرات المتصفح (الرجوع والتقدم) في لوحة التحكم
    window.addEventListener('popstate', () => {
        const route = resolveInitialAdminView();
        let link = null;
        if (route.subTab) {
            link = document.querySelector(`.nav-link[data-target="${route.targetId}"][data-report-tab="${route.subTab}"]`);
        }
        if (!link) {
            link = document.querySelector(`.nav-link[data-target="${route.targetId}"]`);
        }
        switchView(route.targetId, link, route.subTab, true);
    });

    window.addEventListener('hashchange', () => {
        const route = resolveInitialAdminView();
        let link = null;
        if (route.subTab) {
            link = document.querySelector(`.nav-link[data-target="${route.targetId}"][data-report-tab="${route.subTab}"]`);
        }
        if (!link) {
            link = document.querySelector(`.nav-link[data-target="${route.targetId}"]`);
        }
        if (route.targetId !== window.currentAdminView || route.subTab !== window.currentAdminSubTab) {
            switchView(route.targetId, link, route.subTab, true);
        }
    });

    window.switchAdminView = switchView;

    // 🌟 فتح الصفحة المحددة أو المحفوظة عند التحميل أو الريفريش 🌟
    const initialRoute = resolveInitialAdminView();
    let targetViewId = initialRoute.targetId;
    let targetSubTab = initialRoute.subTab;

    if (OWNER_ONLY_VIEWS.includes(targetViewId) && currentUserContext?.role !== 'owner') {
        targetViewId = 'view-dashboard';
        targetSubTab = null;
    }

    let defaultLink = null;
    if (targetSubTab) {
        defaultLink = document.querySelector(`.nav-link[data-target="${targetViewId}"][data-report-tab="${targetSubTab}"]`);
    }
    if (!defaultLink) {
        defaultLink = document.querySelector(`.nav-link[data-target="${targetViewId}"]`);
    }

    switchView(targetViewId, defaultLink, targetSubTab, true);
}

// ==========================================
// 🌟 Engine: Refresh All System & Website Data 🌟
// ==========================================
export async function refreshAllSystemData(options = {}) {
    const isSilent = options.silent === true;

    const icons = document.querySelectorAll('#global-refresh-icon, #refresh-icon, .refresh-icon-spin');
    icons.forEach(i => i.classList.add('animate-spin'));

    if (!isSilent) {
        showToast('جاري جلب أحدث البيانات من قاعدة البيانات...', 'info');
    }

    try {
        // 1. Refetch definitions & lookup caches for dependent modules
        const modelsMod = await import('./models.js').catch(() => null);
        if (modelsMod && typeof modelsMod.loadDefinitionsCache === 'function') {
            await modelsMod.loadDefinitionsCache();
        }

        const bulkMod = await import('./bulk_edits.js').catch(() => null);
        if (bulkMod && typeof bulkMod.fetchBulkFilterOptions === 'function') {
            await bulkMod.fetchBulkFilterOptions();
        }

        const barcodeMod = await import('./print_barcodes.js').catch(() => null);
        if (barcodeMod && typeof barcodeMod.fetchBarcodeFilterOptions === 'function') {
            await barcodeMod.fetchBarcodeFilterOptions();
        }

        const importMod = await import('./import_stock.js').catch(() => null);
        if (importMod && typeof importMod.loadInitialData === 'function') {
            await importMod.loadInitialData();
        }

        const inboundMod = await import('./inbound_invoices.js').catch(() => null);
        if (inboundMod && typeof inboundMod.loadInboundData === 'function') {
            await inboundMod.loadInboundData();
        }

        // 2. Identify active view and refresh its data
        const activeView = document.querySelector('.view-section:not(.hidden)');
        const activeViewId = activeView ? activeView.id : null;

        if (activeViewId) {
            switch (activeViewId) {
                case 'view-dashboard': {
                    const dashMod = await import('./dashboard.js').catch(() => null);
                    if (dashMod && typeof dashMod.fetchDashboardData === 'function') {
                        await dashMod.fetchDashboardData();
                    }
                    break;
                }
                case 'view-stock-alerts': {
                    const saMod = await import('./stock_alerts.js').catch(() => null);
                    if (saMod && typeof saMod.fetchStockAlertsData === 'function') {
                        await saMod.fetchStockAlertsData();
                    }
                    break;
                }
                case 'view-models': {
                    if (modelsMod && typeof modelsMod.fetchAllModelsChunked === 'function') {
                        await modelsMod.fetchAllModelsChunked();
                    }
                    break;
                }
                case 'view-definitions': {
                    const defMod = await import('./definitions.js').catch(() => null);
                    if (defMod && typeof defMod.loadCurrentTabData === 'function') {
                        await defMod.loadCurrentTabData();
                    }
                    break;
                }
                case 'view-admin-orders': {
                    const ordersMod = await import('./admin_orders.js').catch(() => null);
                    if (ordersMod && typeof ordersMod.fetchAdminOrders === 'function') {
                        await ordersMod.fetchAdminOrders();
                    }
                    break;
                }
                case 'view-add-batch': {
                    if (inboundMod && typeof inboundMod.loadInboundData === 'function') {
                        await inboundMod.loadInboundData();
                    }
                    break;
                }


                case 'view-bulk-edits': {
                    if (bulkMod && typeof bulkMod.fetchBulkModels === 'function') {
                        await bulkMod.fetchBulkModels();
                    }
                    break;
                }
                case 'view-print-barcodes': {
                    if (barcodeMod && typeof barcodeMod.fetchBarcodeModels === 'function') {
                        await barcodeMod.fetchBarcodeModels();
                    }
                    break;
                }
                case 'view-home-settings': {
                    const hsMod = await import('./home_settings.js').catch(() => null);
                    if (hsMod && typeof hsMod.loadHeroSettings === 'function') {
                        await hsMod.loadHeroSettings();
                    }
                    break;
                }
                case 'view-theme-manager': {
                    const themeMod = await import('./theme_manager.js').catch(() => null);
                    if (themeMod && typeof themeMod.loadThemes === 'function') {
                        await themeMod.loadThemes();
                    }
                    break;
                }
                case 'view-users': {
                    const usersMod = await import('./users.js').catch(() => null);
                    if (usersMod && typeof usersMod.loadUsers === 'function') {
                        await usersMod.loadUsers();
                    }
                    break;
                }
                case 'view-reports':
                case 'view-deposit-reports': {
                    const repMod = await import('./reports.js').catch(() => null);
                    if (repMod && typeof repMod.fetchReportsData === 'function') {
                        await repMod.fetchReportsData(true);
                    }
                    break;
                }
            }
        }

        window.dispatchEvent(new CustomEvent('devo:global-data-refreshed'));

        if (!isSilent) {
            showToast('تم تحديث جميع بيانات النظام بنجاح 🔄', 'success');
        }
    } catch (err) {
        console.error('Data refresh error:', err);
        if (!isSilent) {
            showToast('حدث خطأ أثناء تحديث البيانات', 'error');
        }
    } finally {
        icons.forEach(i => i.classList.remove('animate-spin'));
    }
}

window.refreshAllSystemData = refreshAllSystemData;

// Start the Router
document.addEventListener('DOMContentLoaded', initRouter);