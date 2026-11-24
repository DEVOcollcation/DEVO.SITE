/**
 * Header Layouts Library + Mobile Bottom Navigation & Top-Down Drawer
 * كل Layout هو component مستقل ومصمم بعناية فائقة للاستجابة والشكل.
 */

// ===================================================================
// 1. LAYOUT REGISTRY — قائمة الـ Layouts المتاحة
// ===================================================================
export const HEADER_LAYOUTS = [
    {
        id: 'classic',
        name: 'كلاسيك حديث (Classic Layout)',
        description: 'شعار أنيق في اليمين، أزرار متبوبة بالوسط بتظليل متميز، ومعلومات المستخدم في اليسار',
        icon: 'ph-layout',
        preview_classes: ['flex', 'justify-between']
    },
    {
        id: 'centered',
        name: 'شعار بالوسط (Centered Brand)',
        description: 'شعار المصنع بارز بالمنتصف متوازن مع أزرار التنقل والمستخدم على الجانبين',
        icon: 'ph-arrows-out-line-horizontal',
        preview_classes: ['flex', 'justify-center']
    },
    {
        id: 'minimal',
        name: 'عائم زجاجي (Floating Glass)',
        description: 'كبسولة عائمة بحواف دائرية وتأثير زجاجي فاخر يطفو فوق المحتوى',
        icon: 'ph-minus-circle',
        preview_classes: ['flex', 'justify-between']
    },
    {
        id: 'luxury',
        name: 'فاخر مزدوج (Luxury TopBar)',
        description: 'شريط معلومات علوي متميز (أوقات العمل والهاتف) + هيدر رئيسي سفلي',
        icon: 'ph-crown-simple',
        preview_classes: ['flex', 'flex-col']
    },
    {
        id: 'search-hero',
        name: 'بحث سريع مدمج (Integrated Search)',
        description: 'شريط بحث مدمج بالموديلات في منتصف الهيدر للوصول الفوري',
        icon: 'ph-magnifying-glass',
        preview_classes: ['flex', 'justify-between']
    },
    {
        id: 'transparent',
        name: 'شفاف متكيف (Dynamic Transparent)',
        description: 'شفاف فوق الصفحة الرئيسية ويتلون تلقائياً مع التمرير',
        icon: 'ph-eye',
        preview_classes: ['flex', 'justify-between']
    },
];

// ===================================================================
// 2. SHARED UTILITIES — أدوات مشتركة
// ===================================================================

function buildNavLinks(user) {
    if (user) {
        return [
            { id: 'view-home', label: 'الرئيسية', action: `switchSiteView('view-home')`, icon: 'ph-house' },
            { id: 'view-gallery', label: 'المعرض', action: `switchSiteView('view-gallery')`, icon: 'ph-images' },
            { id: 'view-barcode', label: 'الباركود', action: `switchSiteView('view-barcode')`, icon: 'ph-qr-code' },
            { id: 'view-cart', label: 'السلة', action: `switchSiteView('view-cart'); window.refreshCartView?.()`, icon: 'ph-shopping-cart' },
            { id: 'view-orders', label: 'الأوردرات', action: `switchSiteView('view-orders')`, icon: 'ph-receipt' },
        ];
    } else {
        return [
            { id: 'view-home', label: 'الرئيسية', action: `switchSiteView('view-home')`, icon: 'ph-house' },
            { id: 'view-gallery', label: 'المعرض', action: `switchSiteView('view-gallery')`, icon: 'ph-images' },
            { id: 'view-barcode', label: 'الباركود', action: `switchSiteView('view-barcode')`, icon: 'ph-qr-code' },
            { id: 'view-visitor-cart', label: 'طلبي', action: `switchSiteView('view-visitor-cart'); window.refreshVisitorCartView?.()`, icon: 'ph-shopping-cart-simple' },
        ];
    }
}

function buildNavBtns(links) {
    return links.map(l =>
        `<button data-nav-view="${l.id}" onclick="${l.action}" class="px-2 lg:px-3.5 py-1.5 lg:py-2 rounded-xl text-xs lg:text-sm font-bold text-devo-muted hover:text-devo-text transition-all flex items-center gap-1 lg:gap-1.5 border border-transparent whitespace-nowrap shrink-0">
            <i class="ph ${l.icon} text-sm lg:text-base shrink-0"></i>
            <span>${l.label}</span>
        </button>`
    ).join('');
}

function getRoleMeta(user) {
    const role = String(user?.role || '').toLowerCase().trim();
    if (role === 'owner') return { label: 'مالك النظام', badgeClass: 'text-devo-orange bg-devo-orange/15 border-devo-orange/30' };
    if (role === 'admin') return { label: 'إدارة', badgeClass: 'text-devo-info bg-devo-info/15 border-devo-info/30' };
    return { label: 'عامل مبيعات', badgeClass: 'text-devo-orange bg-devo-orange/15 border-devo-orange/30' };
}

function buildUserArea(user) {
    const hasAdminAccess = user && (user.role === 'owner' || user.role === 'admin');
    const roleMeta = getRoleMeta(user);

    if (user) {
        return `
            ${hasAdminAccess ? `<a href="admin.html" class="p-1.5 lg:p-2 rounded-lg bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white transition-all shrink-0" title="لوحة الإدارة"><i class="ph ph-shield-check text-lg lg:text-xl"></i></a>` : ''}
            <div class="flex items-center gap-1.5 lg:gap-2 border-r border-devo-gray pr-2 lg:pr-3 shrink-0">
                <div class="text-right min-w-0">
                    <p class="text-xs lg:text-sm font-bold text-white leading-tight truncate max-w-[78px] lg:max-w-[115px]" title="${user.full_name}">${user.full_name}</p>
                    <p class="text-[10px] text-devo-orange leading-tight font-medium whitespace-nowrap">${roleMeta.label}</p>
                </div>
                <div class="w-8 h-8 lg:w-9 lg:h-9 rounded-xl bg-devo-dark border border-devo-gray flex items-center justify-center text-devo-muted hover:text-devo-error hover:border-devo-error/40 cursor-pointer transition-all shadow-sm shrink-0" onclick="handleLogout()" title="تسجيل الخروج">
                    <i class="ph ph-sign-out text-base lg:text-lg"></i>
                </div>
            </div>
        `;
    } else {
        return `
            <a href="auth.html" class="px-3 lg:px-4 py-1.5 lg:py-2 bg-devo-orange hover:bg-devo-orangeHover text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md whitespace-nowrap shrink-0">
                <i class="ph ph-sign-in text-base"></i>
                <span>تسجيل الدخول</span>
            </a>
        `;
    }
}

let devoLogoGradientSeq = 0;

/**
 * شعار DEVO المخصص (Luxury Geometric DV Monogram متكيف مع كافة المظاهر)
 */
function buildDevoLogoMark(sizeClass = 'w-8 h-8') {
    const uid = ++devoLogoGradientSeq;
    return `
        <svg viewBox="0 0 48 48" class="${sizeClass} shrink-0 drop-shadow-sm" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <linearGradient id="devo-tile-bg-${uid}" x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#222227"/>
                    <stop offset="55%" stop-color="#131316"/>
                    <stop offset="100%" stop-color="#09090B"/>
                </linearGradient>
                <linearGradient id="devo-tile-rim-${uid}" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.22"/>
                    <stop offset="55%" stop-color="var(--devo-orange, #f97316)" stop-opacity="0.35"/>
                    <stop offset="100%" stop-color="var(--devo-orange, #f97316)" stop-opacity="0.85"/>
                </linearGradient>
                <linearGradient id="devo-tile-sheen-${uid}" x1="24" y1="2" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.11"/>
                    <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <!-- Luxury Obsidian Squircle Base -->
            <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#devo-tile-bg-${uid})"/>
            <!-- Subtle Top Metallic Sheen -->
            <path d="M14 2.5H34C40.35 2.5 45.5 7.65 45.5 14V18C35 21.5 13 21.5 2.5 18V14C2.5 7.65 7.65 2.5 14 2.5Z" fill="url(#devo-tile-sheen-${uid})"/>
            <!-- Precision Inner Rim -->
            <rect x="2.75" y="2.75" width="42.5" height="42.5" rx="11.25" stroke="url(#devo-tile-rim-${uid})" stroke-width="1.5"/>
            <!-- Architectural White 'D' Monogram -->
            <path fill-rule="evenodd" clip-rule="evenodd" d="M8.5 13H16.8C22.4 13 25.4 16.9 25.4 24C25.4 31.1 22.4 35 16.8 35H8.5V13ZM13.1 17.4V30.6H16.4C19.5 30.6 20.9 28.2 20.9 24C20.9 19.8 19.5 17.4 16.4 17.4H13.1Z" fill="#FFFFFF"/>
            <!-- Dynamic Accent 'V' Monogram -->
            <path d="M25.4 13H30.0L32.6 26.6L35.2 13H39.8L34.7 35H30.5L25.4 13Z" fill="var(--devo-orange, #f97316)"/>
            <!-- Subtle Luxury Micro-Bar under D/V -->
            <rect x="17" y="39.2" width="14" height="1.8" rx="0.9" fill="var(--devo-orange, #f97316)" opacity="0.85"/>
        </svg>
    `;
}

/**
 * شريط الهيدر العلوي البسيط والأنيق للموبايل — فقط لوجو وكلمة DEVO على الجهة اليسرى
 */
function buildMobileHeaderBar(user, extraClass = '') {
    return `
        <div class="md:hidden flex items-center justify-end h-[54px] ${extraClass}">
            <button type="button" onclick="switchSiteView('view-home')" dir="ltr" aria-label="DEVO"
                class="flex items-center gap-2 focus:outline-none group">
                ${buildDevoLogoMark('w-8 h-8')}
                <span class="text-[22px] font-black tracking-[0.14em] text-devo-text leading-none">
                    D<span class="text-devo-orange">E</span>VO
                </span>
            </button>
        </div>
    `;
}

/**
 * القائمة السفلية المنزلقة من الأسفل للأعلى (Bottom-to-Top Drawer) تنبثق من فوق شريط التنقل السفلي
 */
function buildMobileMenu(user) {
    const hasAdminAccess = user && (user.role === 'owner' || user.role === 'admin');
    const roleMeta = getRoleMeta(user);
    const initials = user?.full_name ? String(user.full_name).trim().charAt(0).toUpperCase() : 'D';

    let headerCard = '';
    let navGrid = '';
    let footerActions = '';

    if (user) {
        headerCard = `
            <div class="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-devo-dark border border-devo-gray mb-3">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-11 h-11 rounded-2xl bg-devo-orange text-white font-black text-lg flex items-center justify-center shrink-0 shadow-sm">
                        ${initials}
                    </div>
                    <div class="min-w-0 text-right">
                        <p class="text-sm font-black text-devo-text truncate">${user.full_name || user.username || 'مستخدم DEVO'}</p>
                        <span class="inline-flex items-center gap-1 text-[11px] font-bold text-devo-orange mt-0.5">
                            <i class="ph ph-seal-check text-xs"></i>
                            ${roleMeta.label}
                        </span>
                    </div>
                </div>
                <button type="button" onclick="window.closeMobileMenu?.()" aria-label="إغلاق القائمة"
                    class="w-9 h-9 rounded-xl bg-devo-black border border-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center shrink-0 transition-colors focus:outline-none">
                    <i class="ph ph-x text-lg"></i>
                </button>
            </div>
        `;

        navGrid = `
            <div class="grid grid-cols-2 gap-2 mb-3">
                <button type="button" data-drawer-nav-view="view-gallery" onclick="switchSiteView('view-gallery')"
                    class="drawer-nav-item col-span-2 py-3 px-4 rounded-2xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center justify-between gap-3 transition-all focus:outline-none">
                    <span class="flex items-center gap-2.5 text-sm font-bold">
                        <span class="drawer-nav-icon w-8 h-8 rounded-xl bg-devo-orange/15 text-devo-orange flex items-center justify-center"><i class="ph ph-images text-lg"></i></span>
                        <span>المعرض وتصفح الموديلات</span>
                    </span>
                    <i class="ph ph-caret-left text-base text-devo-muted"></i>
                </button>
                <button type="button" data-drawer-nav-view="view-home" onclick="switchSiteView('view-home')"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-house text-base"></i></span>
                    <span>الرئيسية</span>
                </button>
                <button type="button" data-drawer-nav-view="view-barcode" onclick="switchSiteView('view-barcode')"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-qr-code text-base"></i></span>
                    <span>الباركود</span>
                </button>
                <button type="button" data-drawer-nav-view="view-cart" onclick="switchSiteView('view-cart'); window.refreshCartView?.();"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-shopping-cart text-base"></i></span>
                    <span>السلة</span>
                </button>
                <button type="button" data-drawer-nav-view="view-orders" onclick="switchSiteView('view-orders')"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-receipt text-base"></i></span>
                    <span>الأوردرات</span>
                </button>
            </div>
        `;

        footerActions = `
            <div class="space-y-2 pt-2.5 border-t border-devo-gray">
                ${hasAdminAccess ? `
                <a href="admin.html" class="w-full py-2.5 px-3.5 rounded-2xl bg-devo-dark border border-devo-gray hover:border-devo-info flex items-center justify-between gap-3 transition-all group">
                    <span class="flex items-center gap-3">
                        <span class="w-9 h-9 rounded-xl bg-devo-info text-white flex items-center justify-center shrink-0 shadow-sm">
                            <i class="ph ph-shield-check text-lg"></i>
                        </span>
                        <span class="flex flex-col text-right">
                            <span class="text-sm font-extrabold text-devo-text leading-tight">لوحة تحكم الإدارة</span>
                            <span class="text-[11px] text-devo-muted font-medium">إدارة الموديلات والأوردرات والتقارير</span>
                        </span>
                    </span>
                    <i class="ph ph-arrow-left text-base text-devo-info"></i>
                </a>` : ''}
                <button type="button" onclick="handleLogout()" class="w-full py-2.5 px-4 rounded-2xl bg-devo-dark border border-devo-error/35 text-devo-error hover:bg-devo-error hover:text-white flex items-center justify-center gap-2 text-sm font-bold transition-all focus:outline-none">
                    <i class="ph ph-sign-out text-lg"></i>
                    <span>تسجيل الخروج</span>
                </button>
            </div>
        `;
    } else {
        headerCard = `
            <div class="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-devo-dark border border-devo-gray mb-3">
                <div class="flex items-center gap-3 min-w-0">
                    ${buildDevoLogoMark('w-10 h-10')}
                    <div class="min-w-0 text-right">
                        <p class="text-sm font-black text-devo-text">DEVO</p>
                        <p class="text-[11px] text-devo-muted font-medium">تصفح الموديلات أو سجل دخولك</p>
                    </div>
                </div>
                <button type="button" onclick="window.closeMobileMenu?.()" aria-label="إغلاق القائمة"
                    class="w-9 h-9 rounded-xl bg-devo-black border border-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center shrink-0 transition-colors focus:outline-none">
                    <i class="ph ph-x text-lg"></i>
                </button>
            </div>
        `;

        navGrid = `
            <div class="grid grid-cols-2 gap-2 mb-3">
                <button type="button" data-drawer-nav-view="view-home" onclick="switchSiteView('view-home')"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-house text-base"></i></span>
                    <span>الرئيسية</span>
                </button>
                <button type="button" data-drawer-nav-view="view-gallery" onclick="switchSiteView('view-gallery')"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-images text-base"></i></span>
                    <span>المعرض</span>
                </button>
                <button type="button" data-drawer-nav-view="view-barcode" onclick="switchSiteView('view-barcode')"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-qr-code text-base"></i></span>
                    <span>الباركود</span>
                </button>
                <button type="button" data-drawer-nav-view="view-visitor-cart" onclick="switchSiteView('view-visitor-cart'); window.refreshVisitorCartView?.();"
                    class="drawer-nav-item py-2.5 px-3 rounded-xl bg-devo-dark border border-devo-gray text-right text-devo-text flex items-center gap-2.5 text-xs font-bold transition-all focus:outline-none">
                    <span class="drawer-nav-icon w-7 h-7 rounded-lg bg-devo-black border border-devo-gray/70 text-devo-muted flex items-center justify-center shrink-0"><i class="ph ph-shopping-cart-simple text-base"></i></span>
                    <span>طلبي</span>
                </button>
            </div>
        `;

        footerActions = `
            <div class="pt-2.5 border-t border-devo-gray">
                <a href="auth.html" class="w-full py-3 px-4 rounded-2xl bg-devo-orange hover:bg-devo-orangeHover text-white flex items-center justify-center gap-2 text-sm font-black shadow-sm transition-all">
                    <i class="ph ph-sign-in text-lg"></i>
                    <span>تسجيل الدخول</span>
                </a>
            </div>
        `;
    }

    const pwaSnap = window.devoPwaUpdater?.getUpdateSnapshot?.();
    const versionLabel = pwaSnap?.installedVersion ? `v${pwaSnap.installedVersion}` : 'v18.0.0';
    const hideInstallBtn = pwaSnap?.isStandalone ? 'hidden' : '';

    const pwaFooterStrip = `
        <div id="mobile-drawer-pwa-strip" class="mt-3 pt-2.5 border-t border-devo-gray/70 flex items-center justify-between gap-2">
            <button type="button" id="mobile-drawer-check-update" onclick="window.devoHandleDrawerUpdateCheck?.()"
                class="flex items-center gap-1.5 text-[11px] font-bold text-devo-muted hover:text-devo-orange transition-colors focus:outline-none cursor-pointer">
                <i id="mobile-drawer-update-icon" class="ph ph-arrows-clockwise text-sm text-devo-orange"></i>
                <span id="mobile-drawer-version-label" class="font-mono tabular-nums">${versionLabel}</span>
                <span class="text-devo-muted/80">• فحص التحديث</span>
            </button>
            <button type="button" id="mobile-drawer-install-btn" onclick="window.devoPwaUpdater?.triggerInstall?.()"
                class="${hideInstallBtn} px-2.5 py-1.5 rounded-xl bg-devo-orange/15 hover:bg-devo-orange text-devo-orange hover:text-white border border-devo-orange/30 text-[11px] font-bold flex items-center gap-1.5 transition-all focus:outline-none cursor-pointer whitespace-nowrap shrink-0">
                <i class="ph ph-download-simple text-sm"></i>
                <span>تثبيت التطبيق</span>
            </button>
        </div>
    `;

    return `
        <div id="mobile-menu-backdrop" onclick="window.closeMobileMenu?.()"
            class="md:hidden fixed inset-0 bg-black/50 backdrop-blur-[2px] z-[100008] opacity-0 pointer-events-none transition-opacity duration-300"></div>
        <div id="mobile-menu" data-open="false"
            class="md:hidden fixed inset-x-0 bottom-[calc(66px+env(safe-area-inset-bottom,0px))] z-[100012] max-h-[calc(100vh-140px)] overflow-y-auto bg-devo-black border-t border-devo-gray rounded-t-3xl shadow-[0_-16px_44px_rgba(0,0,0,0.28)] px-4 pt-2 pb-4 transform translate-y-[115%] opacity-0 pointer-events-none transition-all duration-300 ease-out will-change-transform">
            <div id="mobile-menu-drag-handle" class="pt-1 pb-3 flex justify-center cursor-grab active:cursor-grabbing touch-none">
                <div class="w-12 h-1.5 rounded-full bg-devo-muted/40"></div>
            </div>
            <div id="mobile-nav-links">
                ${headerCard}
                ${navGrid}
                ${footerActions}
                ${pwaFooterStrip}
            </div>
        </div>
    `;
}

/**
 * شريط التنقل السفلي للموبايل (Bottom Navigation Bar)
 * الترتيب من اليمين لليسار (RTL):
 * [الرئيسية] | [السلة / طلبي] | [الباركود (بارز بالمنتصف)] | [الأوردرات / المعرض] | [القائمة]
 */
function buildMobileBottomNav(user) {
    const cartTarget = user ? 'view-cart' : 'view-visitor-cart';
    const cartAction = user
        ? `switchSiteView('view-cart'); window.refreshCartView?.()`
        : `switchSiteView('view-visitor-cart'); window.refreshVisitorCartView?.()`;
    const cartLabel = user ? 'السلة' : 'طلبي';
    const cartIcon = user ? 'ph-shopping-cart' : 'ph-shopping-cart-simple';

    const leftSecondaryTarget = user ? 'view-orders' : 'view-gallery';
    const leftSecondaryAction = user ? `switchSiteView('view-orders')` : `switchSiteView('view-gallery')`;
    const leftSecondaryLabel = user ? 'الأوردرات' : 'المعرض';
    const leftSecondaryIcon = user ? 'ph-receipt' : 'ph-images';

    return `
        <nav id="mobile-bottom-nav" aria-label="التنقل السفلي"
            class="md:hidden fixed bottom-0 inset-x-0 z-[100015] bg-devo-black/95 backdrop-blur-xl border-t border-devo-gray shadow-[0_-8px_28px_rgba(0,0,0,0.16)] pb-[env(safe-area-inset-bottom,0px)]">
            <div class="grid grid-cols-5 items-end h-[66px] max-w-lg mx-auto px-1">
                <!-- 1. أقصى اليمين: الرئيسية -->
                <button type="button" data-bottom-nav-view="view-home" onclick="switchSiteView('view-home')"
                    class="relative h-full flex flex-col items-center justify-center gap-0.5 pt-1 pb-1.5 focus:outline-none transition-colors">
                    <span class="bottom-tab-indicator absolute top-0 w-7 h-[3px] rounded-full bg-devo-orange transition-all duration-200 opacity-0 scale-x-0"></span>
                    <span class="bottom-tab-pill relative w-11 h-8 rounded-2xl flex items-center justify-center transition-all duration-200 text-devo-muted">
                        <i class="ph ph-house text-[21px]"></i>
                    </span>
                    <span class="bottom-tab-label text-[10px] font-bold text-devo-muted leading-none transition-colors">الرئيسية</span>
                </button>

                <!-- 2. يمين المنتصف: السلة / طلبي -->
                <button type="button" data-bottom-nav-view="${cartTarget}" onclick="${cartAction}"
                    class="relative h-full flex flex-col items-center justify-center gap-0.5 pt-1 pb-1.5 focus:outline-none transition-colors">
                    <span class="bottom-tab-indicator absolute top-0 w-7 h-[3px] rounded-full bg-devo-orange transition-all duration-200 opacity-0 scale-x-0"></span>
                    <span class="bottom-tab-pill relative w-11 h-8 rounded-2xl flex items-center justify-center transition-all duration-200 text-devo-muted">
                        <i class="ph ${cartIcon} text-[21px]"></i>
                        <span id="mobile-bottom-cart-badge" class="hidden absolute -top-1 -left-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-devo-orange text-white text-[10px] font-black flex items-center justify-center shadow-sm border border-devo-black leading-none">0</span>
                    </span>
                    <span class="bottom-tab-label text-[10px] font-bold text-devo-muted leading-none transition-colors">${cartLabel}</span>
                </button>

                <!-- 3. المنتصف: الباركود (زر بارز مربع بحواف دائرية) -->
                <div class="h-full flex flex-col items-center justify-end pb-1.5 relative">
                    <button type="button" data-bottom-nav-view="view-barcode" onclick="switchSiteView('view-barcode')"
                        aria-label="الباركود"
                        class="bottom-center-fab -mt-6 w-[54px] h-[54px] rounded-2xl bg-devo-orange hover:bg-devo-orangeHover text-white flex items-center justify-center shadow-[0_8px_22px_rgba(249,115,22,0.42)] ring-4 ring-devo-black transition-all duration-200 active:scale-95 focus:outline-none">
                        <i class="ph ph-qr-code text-[27px]"></i>
                    </button>
                    <span data-bottom-center-label="view-barcode" class="bottom-tab-label text-[10px] font-bold text-devo-muted mt-0.5 leading-none transition-colors">الباركود</span>
                </div>

                <!-- 4. يسار المنتصف: الأوردرات (أو المعرض للزائر) -->
                <button type="button" data-bottom-nav-view="${leftSecondaryTarget}" onclick="${leftSecondaryAction}"
                    class="relative h-full flex flex-col items-center justify-center gap-0.5 pt-1 pb-1.5 focus:outline-none transition-colors">
                    <span class="bottom-tab-indicator absolute top-0 w-7 h-[3px] rounded-full bg-devo-orange transition-all duration-200 opacity-0 scale-x-0"></span>
                    <span class="bottom-tab-pill relative w-11 h-8 rounded-2xl flex items-center justify-center transition-all duration-200 text-devo-muted">
                        <i class="ph ${leftSecondaryIcon} text-[21px]"></i>
                    </span>
                    <span class="bottom-tab-label text-[10px] font-bold text-devo-muted leading-none transition-colors">${leftSecondaryLabel}</span>
                </button>

                <!-- 5. أقصى اليسار: القائمة -->
                <button type="button" id="mobile-bottom-menu-btn" onclick="window.toggleMobileMenu?.()"
                    aria-label="القائمة" aria-expanded="false"
                    class="relative h-full flex flex-col items-center justify-center gap-0.5 pt-1 pb-1.5 focus:outline-none transition-colors">
                    <span class="bottom-tab-indicator absolute top-0 w-7 h-[3px] rounded-full bg-devo-orange transition-all duration-200 opacity-0 scale-x-0"></span>
                    <span class="bottom-tab-pill relative w-11 h-8 rounded-2xl flex items-center justify-center transition-all duration-200 text-devo-muted">
                        <i class="ph ph-list text-[21px]"></i>
                    </span>
                    <span class="bottom-tab-label text-[10px] font-bold text-devo-muted leading-none transition-colors">القائمة</span>
                </button>
            </div>
        </nav>
    `;
}

// ===================================================================
// 3. MOBILE MENU & BOTTOM NAV CONTROLLERS
// ===================================================================

function setMenuButtonVisualState(isOpen) {
    const btn = document.getElementById('mobile-bottom-menu-btn');
    if (!btn) return;
    btn.setAttribute('aria-expanded', String(isOpen));
    const indicator = btn.querySelector('.bottom-tab-indicator');
    const pill = btn.querySelector('.bottom-tab-pill');
    const label = btn.querySelector('.bottom-tab-label');
    const icon = btn.querySelector('i');

    if (indicator) {
        indicator.classList.toggle('opacity-100', isOpen);
        indicator.classList.toggle('scale-x-100', isOpen);
        indicator.classList.toggle('opacity-0', !isOpen);
        indicator.classList.toggle('scale-x-0', !isOpen);
    }
    if (pill) {
        pill.classList.toggle('bg-devo-orange/15', isOpen);
        pill.classList.toggle('text-devo-orange', isOpen);
        pill.classList.toggle('text-devo-muted', !isOpen);
    }
    if (label) {
        label.classList.toggle('text-devo-orange', isOpen);
        label.classList.toggle('text-devo-muted', !isOpen);
    }
    if (icon) {
        icon.classList.toggle('ph-x', isOpen);
        icon.classList.toggle('ph-list', !isOpen);
    }
}

export function isMobileMenuOpen() {
    const mobileMenu = document.getElementById('mobile-menu');
    return !!(mobileMenu && mobileMenu.dataset.open === 'true');
}

export function openMobileMenu() {
    const mobileMenu = document.getElementById('mobile-menu');
    const backdrop = document.getElementById('mobile-menu-backdrop');
    if (!mobileMenu) return;

    mobileMenu.dataset.open = 'true';
    mobileMenu.style.transform = '';
    mobileMenu.style.transition = '';
    mobileMenu.classList.remove('translate-y-[115%]', 'opacity-0', 'pointer-events-none');
    mobileMenu.classList.add('translate-y-0', 'opacity-100', 'pointer-events-auto');

    if (backdrop) {
        backdrop.classList.remove('opacity-0', 'pointer-events-none');
        backdrop.classList.add('opacity-100', 'pointer-events-auto');
    }
    setMenuButtonVisualState(true);
}

export function closeMobileMenu() {
    const mobileMenu = document.getElementById('mobile-menu');
    const backdrop = document.getElementById('mobile-menu-backdrop');
    if (!mobileMenu) return;

    mobileMenu.dataset.open = 'false';
    mobileMenu.style.transform = '';
    mobileMenu.style.transition = '';
    mobileMenu.classList.add('translate-y-[115%]', 'opacity-0', 'pointer-events-none');
    mobileMenu.classList.remove('translate-y-0', 'opacity-100', 'pointer-events-auto');

    if (backdrop) {
        backdrop.classList.add('opacity-0', 'pointer-events-none');
        backdrop.classList.remove('opacity-100', 'pointer-events-auto');
    }
    setMenuButtonVisualState(false);
}

export function toggleMobileMenu() {
    if (isMobileMenuOpen()) closeMobileMenu();
    else openMobileMenu();
}

export function syncBottomNavActive(targetId) {
    document.querySelectorAll('[data-bottom-nav-view]').forEach(btn => {
        const viewId = btn.getAttribute('data-bottom-nav-view');
        const isActive = viewId === targetId;

        if (btn.classList.contains('bottom-center-fab')) {
            btn.classList.toggle('scale-105', isActive);
            btn.classList.toggle('shadow-[0_10px_28px_rgba(249,115,22,0.58)]', isActive);
            const centerLabel = document.querySelector(`[data-bottom-center-label="${viewId}"]`);
            if (centerLabel) {
                centerLabel.classList.toggle('text-devo-orange', isActive);
                centerLabel.classList.toggle('text-devo-muted', !isActive);
            }
            return;
        }

        const indicator = btn.querySelector('.bottom-tab-indicator');
        const pill = btn.querySelector('.bottom-tab-pill');
        const label = btn.querySelector('.bottom-tab-label');

        if (indicator) {
            indicator.classList.toggle('opacity-100', isActive);
            indicator.classList.toggle('scale-x-100', isActive);
            indicator.classList.toggle('opacity-0', !isActive);
            indicator.classList.toggle('scale-x-0', !isActive);
        }
        if (pill) {
            pill.classList.toggle('bg-devo-orange/15', isActive);
            pill.classList.toggle('text-devo-orange', isActive);
            pill.classList.toggle('text-devo-muted', !isActive);
        }
        if (label) {
            label.classList.toggle('text-devo-orange', isActive);
            label.classList.toggle('text-devo-muted', !isActive);
        }
    });

    // تزامن التحديد النشط داخل القائمة السفلية (بدون أي ألوان داكنة متضاربة)
    document.querySelectorAll('[data-drawer-nav-view]').forEach(btn => {
        const viewId = btn.getAttribute('data-drawer-nav-view');
        const isActive = viewId === targetId;
        const iconBox = btn.querySelector('.drawer-nav-icon');

        btn.classList.toggle('border-devo-orange', isActive);
        btn.classList.toggle('text-devo-orange', isActive);
        btn.classList.toggle('border-devo-gray', !isActive);
        btn.classList.toggle('text-devo-text', !isActive);

        if (iconBox) {
            iconBox.classList.toggle('bg-devo-orange', isActive);
            iconBox.classList.toggle('text-white', isActive);
            iconBox.classList.toggle('border-transparent', isActive);
            if (!isActive) {
                if (viewId === 'view-gallery' && btn.classList.contains('col-span-2')) {
                    iconBox.classList.add('bg-devo-orange/15', 'text-devo-orange');
                    iconBox.classList.remove('bg-devo-black', 'text-devo-muted');
                } else {
                    iconBox.classList.remove('bg-devo-orange/15', 'text-devo-orange');
                    iconBox.classList.add('bg-devo-black', 'text-devo-muted');
                }
            } else {
                iconBox.classList.remove('bg-devo-orange/15', 'text-devo-orange', 'bg-devo-black', 'text-devo-muted');
            }
        }
    });
}

function syncMobileBottomCartBadge() {
    const badge = document.getElementById('mobile-bottom-cart-badge');
    if (!badge) return;
    const isVisitor = !!window.isVisitor;
    const sourceEl = document.getElementById(isVisitor ? 'visitor-floating-cart-count' : 'floating-cart-count');
    let count = parseInt(sourceEl?.textContent || '0', 10) || 0;

    if (!count) {
        try {
            const raw = localStorage.getItem(isVisitor ? 'devo_visitor_cart' : 'devo_cart');
            const items = raw ? JSON.parse(raw) : [];
            count = items.reduce((sum, item) => sum + (parseInt(item.qty, 10) || 0), 0);
        } catch {}
    }

    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count <= 0);
}

function attachMobileMenuSwipeDown() {
    const mobileMenu = document.getElementById('mobile-menu');
    const handle = document.getElementById('mobile-menu-drag-handle');
    if (!mobileMenu || !handle || mobileMenu.dataset.swipeInit === 'true') return;
    mobileMenu.dataset.swipeInit = 'true';

    let startY = 0;
    let deltaY = 0;
    let dragging = false;

    handle.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1 || !isMobileMenuOpen()) return;
        startY = e.touches[0].clientY;
        deltaY = 0;
        dragging = true;
        mobileMenu.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
        if (!dragging || e.touches.length !== 1) return;
        deltaY = Math.max(0, e.touches[0].clientY - startY);
        if (deltaY > 0 && e.cancelable) e.preventDefault();
        mobileMenu.style.transform = `translateY(${deltaY}px)`;
    }, { passive: false });

    const finishSwipe = () => {
        if (!dragging) return;
        dragging = false;
        mobileMenu.style.transition = '';
        if (deltaY > 55) {
            closeMobileMenu();
        } else {
            mobileMenu.style.transform = '';
        }
    };

    handle.addEventListener('touchend', finishSwipe, { passive: true });
    handle.addEventListener('touchcancel', finishSwipe, { passive: true });
}

export function attachMobileMenuToggle() {
    window.toggleMobileMenu = toggleMobileMenu;
    window.closeMobileMenu = closeMobileMenu;
    window.openMobileMenu = openMobileMenu;
    window.syncBottomNavActive = syncBottomNavActive;

    attachMobileMenuSwipeDown();
    syncMobileBottomCartBadge();

    const syncDrawerPwaStrip = (snap) => {
        const current = snap || window.devoPwaUpdater?.getUpdateSnapshot?.();
        if (!current) return;
        const verEl = document.getElementById('mobile-drawer-version-label');
        const installBtn = document.getElementById('mobile-drawer-install-btn');
        if (verEl && current.installedVersion) {
            verEl.textContent = `v${current.installedVersion}`;
        }
        if (installBtn) {
            installBtn.classList.toggle('hidden', Boolean(current.isStandalone));
        }
    };

    window.devoHandleDrawerUpdateCheck = async () => {
        const icon = document.getElementById('mobile-drawer-update-icon');
        icon?.classList.add('animate-spin');
        try {
            const res = await window.devoPwaUpdater?.checkForUpdatesNow?.({ autoApply: true, silent: false });
            if (res?.status === 'up-to-date') {
                const { showToast } = await import('../../components/toast.js');
                showToast(`التطبيق محدّث على آخر إصدار (v${res.manifest?.version || '18.0.0'})`, 'success');
            }
        } finally {
            icon?.classList.remove('animate-spin');
        }
    };

    syncDrawerPwaStrip();
    if (!window.__devoDrawerPwaListenerBound) {
        window.__devoDrawerPwaListenerBound = true;
        window.addEventListener('devo:pwa-state-changed', (e) => syncDrawerPwaStrip(e.detail));
    }

    if (!window.__devoCartBadgeObserverBound) {
        window.__devoCartBadgeObserverBound = true;
        const observeBadgeSource = (elId) => {
            const el = document.getElementById(elId);
            if (!el) return;
            const obs = new MutationObserver(() => syncMobileBottomCartBadge());
            obs.observe(el, { childList: true, characterData: true, subtree: true });
        };
        observeBadgeSource('floating-cart-count');
        observeBadgeSource('visitor-floating-cart-count');
        window.addEventListener('storage', (e) => {
            if (e.key === 'devo_cart' || e.key === 'devo_visitor_cart') {
                syncMobileBottomCartBadge();
            }
        });
    }
}

// ===================================================================
// 4. LAYOUT RENDERERS — كل Layout دالة مستقلة
// ===================================================================

function renderClassic(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-[100020] bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" data-layout="classic">
            <div class="max-w-7xl mx-auto px-3.5 sm:px-5 lg:px-8">
                <div class="hidden md:flex items-center justify-between gap-2 lg:gap-4" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer whitespace-nowrap" onclick="switchSiteView('view-home')">
                        <h1 class="text-xl lg:text-3xl font-black tracking-wider text-white flex items-center gap-1.5">
                            <span>D<span class="text-devo-orange">E</span>VO</span>
                            <span class="hidden lg:inline-block text-[10px] font-bold tracking-widest text-devo-orange bg-devo-orange/10 px-2 py-0.5 rounded-full uppercase border border-devo-orange/20">Collection</span>
                        </h1>
                    </div>
                    <div class="flex items-center gap-0.5 lg:gap-1.5 bg-devo-dark/80 p-1 lg:p-1.5 rounded-2xl border border-devo-gray/60 shadow-inner">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="flex items-center gap-2 lg:gap-3 shrink-0">
                        ${userArea}
                    </div>
                </div>
                ${buildMobileHeaderBar(user)}
            </div>
        </nav>
        ${buildMobileMenu(user)}
        ${buildMobileBottomNav(user)}
    `;
}

function renderCentered(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    const half = Math.ceil(navLinks.length / 2);
    const leftLinks = navLinks.slice(0, half);
    const rightLinks = navLinks.slice(half);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-[100020] bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" data-layout="centered">
            <div class="max-w-7xl mx-auto px-3.5 sm:px-5 lg:px-8">
                <div class="hidden md:flex lg:grid lg:grid-cols-3 items-center justify-between gap-2" style="height:${height}px">
                    <div class="hidden lg:flex items-center justify-start gap-1">
                        ${buildNavBtns(rightLinks)}
                    </div>
                    <div class="flex flex-col items-center justify-center cursor-pointer shrink-0" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl lg:text-3xl font-black tracking-wider text-white leading-none">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                        <span class="hidden lg:inline text-[9px] font-bold tracking-[0.3em] text-devo-orange uppercase mt-1">Collection</span>
                    </div>
                    <div class="flex lg:hidden items-center gap-0.5 bg-devo-dark/80 p-1 rounded-2xl border border-devo-gray/60">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="flex items-center justify-end gap-2 shrink-0">
                        <div class="hidden lg:flex items-center gap-1">
                            ${buildNavBtns(leftLinks)}
                        </div>
                        <div class="lg:border-r lg:border-devo-gray lg:pr-2 lg:mr-1 flex items-center gap-2">
                            ${userArea}
                        </div>
                    </div>
                </div>
                ${buildMobileHeaderBar(user)}
            </div>
        </nav>
        ${buildMobileMenu(user)}
        ${buildMobileBottomNav(user)}
    `;
}

function renderMinimal(user, settings) {
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 md:top-3 left-0 right-0 z-[100020] px-0 md:px-4 lg:px-6 transition-all duration-300 md:pointer-events-none" data-layout="minimal">
            <div class="hidden md:flex max-w-6xl mx-auto bg-devo-black/95 backdrop-blur-xl border border-devo-gray/80 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.28)] px-3 lg:px-4 py-2 items-center justify-between gap-2 pointer-events-auto">
                <div class="flex items-center gap-2 cursor-pointer shrink-0" onclick="switchSiteView('view-home')">
                    <div class="w-8 h-8 lg:w-9 lg:h-9 rounded-xl bg-devo-orange/10 border border-devo-orange/30 flex items-center justify-center text-devo-orange font-black text-lg lg:text-xl">D</div>
                    <h1 class="text-lg lg:text-xl font-black tracking-widest text-white">DEVO</h1>
                </div>
                <div class="flex items-center gap-0.5 lg:gap-1">
                    ${buildNavBtns(navLinks)}
                </div>
                <div class="flex items-center gap-2 shrink-0">
                    ${userArea}
                </div>
            </div>
            <div class="md:hidden bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md px-3.5">
                ${buildMobileHeaderBar(user)}
            </div>
        </nav>
        ${buildMobileMenu(user)}
        ${buildMobileBottomNav(user)}
    `;
}

function renderLuxury(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <div id="site-header-topbar" class="fixed w-full z-[100025] top-0 left-0 right-0 bg-gradient-to-r from-devo-orange via-amber-500 to-devo-orange text-white text-[11px] font-bold py-1 px-4 shadow-sm">
            <div class="max-w-7xl mx-auto flex items-center justify-between gap-2">
                <span class="flex items-center gap-1.5 truncate">
                    <i class="ph ph-clock text-sm shrink-0"></i>
                    <span class="truncate">ساعات العمل: السبت - الخميس (10 ص - 10 م)</span>
                </span>
                <div class="hidden sm:flex items-center gap-4 shrink-0">
                    <span class="flex items-center gap-1"><i class="ph ph-phone text-sm"></i> دعم العملاء</span>
                    <span class="flex items-center gap-1"><i class="ph ph-map-pin text-sm"></i> مصنع DEVO</span>
                </div>
            </div>
        </div>
        <nav id="site-header-nav" class="fixed w-full z-[100020] bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" style="top:var(--devo-topbar-height,26px)" data-layout="luxury">
            <div class="max-w-7xl mx-auto px-3.5 sm:px-5 lg:px-8">
                <div class="hidden md:flex items-center justify-between gap-2 lg:gap-4" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer whitespace-nowrap" onclick="switchSiteView('view-home')">
                        <h1 class="text-xl lg:text-3xl font-black tracking-wider text-white flex items-center gap-1.5">
                            <span>D<span class="text-devo-orange">E</span>VO</span>
                            <span class="hidden lg:inline-block text-[9px] font-black text-devo-orange bg-devo-orange/10 px-2 py-0.5 rounded border border-devo-orange/30">LUXURY</span>
                        </h1>
                    </div>
                    <div class="flex items-center gap-0.5 lg:gap-1 bg-devo-dark p-1 lg:p-1.5 rounded-2xl border border-devo-gray/50">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="flex items-center gap-2 lg:gap-3 shrink-0">
                        ${userArea}
                    </div>
                </div>
                ${buildMobileHeaderBar(user)}
            </div>
        </nav>
        ${buildMobileMenu(user)}
        ${buildMobileBottomNav(user)}
    `;
}

function renderSearchHero(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-[100020] bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" data-layout="search-hero">
            <div class="max-w-7xl mx-auto px-3.5 sm:px-5 lg:px-8">
                <div class="hidden md:flex items-center justify-between gap-2 lg:gap-4" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer whitespace-nowrap" onclick="switchSiteView('view-home')">
                        <h1 class="text-xl lg:text-2xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h1>
                    </div>
                    <div class="hidden xl:flex flex-1 max-w-sm mx-2 relative">
                        <i class="ph ph-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-devo-muted"></i>
                        <input type="text" onclick="switchSiteView('view-gallery')" placeholder="بحث سريع في الموديلات والمعرض..." readonly class="w-full bg-devo-dark border border-devo-gray rounded-xl pr-9 pl-4 py-2 text-xs text-white focus:border-devo-orange cursor-pointer hover:border-devo-grayHover transition-all">
                    </div>
                    <div class="flex items-center gap-0.5 lg:gap-1">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        ${userArea}
                    </div>
                </div>
                ${buildMobileHeaderBar(user)}
            </div>
        </nav>
        ${buildMobileMenu(user)}
        ${buildMobileBottomNav(user)}
    `;
}

function renderTransparent(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-[100020] bg-devo-black/95 border-b border-devo-gray backdrop-blur-md shadow-md transition-all duration-300" data-layout="transparent">
            <div class="max-w-7xl mx-auto px-3.5 sm:px-5 lg:px-8">
                <div class="hidden md:flex items-center justify-between gap-2 lg:gap-4" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer whitespace-nowrap" onclick="switchSiteView('view-home')">
                        <h1 class="text-xl lg:text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                    </div>
                    <div class="flex items-center gap-0.5 lg:gap-1 bg-devo-dark/75 backdrop-blur-md p-1 lg:p-1.5 rounded-2xl border border-devo-gray/60">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="flex items-center gap-2 lg:gap-3 shrink-0">
                        ${userArea}
                    </div>
                </div>
                ${buildMobileHeaderBar(user)}
            </div>
        </nav>
        ${buildMobileMenu(user)}
        ${buildMobileBottomNav(user)}
    `;
}

// ===================================================================
// 5. MAIN RENDER FUNCTION & RESPONSIVE HEIGHT SYNCHRONIZER
// ===================================================================

let _headerResizeObserver = null;

export function syncTransparentHeaderState() {
    const nav = document.getElementById('site-header-nav');
    if (!nav || nav.dataset.layout !== 'transparent') return;

    const isDesktop = window.innerWidth >= 768;
    const isHome = !window.currentView || window.currentView === 'view-home';
    const isAtTop = (window.scrollY || window.pageYOffset || 0) <= 16;
    const useGlassTop = isDesktop && isHome && isAtTop;

    nav.classList.toggle('md:bg-devo-black/80', useGlassTop);
    nav.classList.toggle('md:border-transparent', useGlassTop);
    nav.classList.toggle('md:shadow-none', useGlassTop);
}

export function syncHeaderHeightVar() {
    const nav = document.getElementById('site-header-nav');
    if (!nav) return;

    const topbar = document.getElementById('site-header-topbar');
    const topbarH = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty('--devo-topbar-height', `${topbarH}px`);

    const layout = nav.dataset.layout;
    const isDesktop = window.innerWidth >= 768;

    if (layout === 'luxury') {
        nav.style.top = `${topbarH}px`;
    } else {
        nav.style.top = '';
    }

    const navRect = nav.getBoundingClientRect();
    const navHeight = Math.ceil(navRect.height);
    let totalHeight = navHeight + topbarH;

    if (layout === 'minimal' && isDesktop) {
        // Floating pill sits at top: 12px (md:top-3); include top gap + bottom breathing room
        totalHeight = navHeight + 20;
    }

    if (totalHeight > 0) {
        document.documentElement.style.setProperty('--devo-header-height', `${totalHeight}px`);
    }
}

function observeHeaderSize() {
    if (typeof ResizeObserver === 'undefined') return;
    if (_headerResizeObserver) {
        _headerResizeObserver.disconnect();
    }
    _headerResizeObserver = new ResizeObserver(() => {
        syncHeaderHeightVar();
    });
    const nav = document.getElementById('site-header-nav');
    const topbar = document.getElementById('site-header-topbar');
    if (nav) _headerResizeObserver.observe(nav);
    if (topbar) _headerResizeObserver.observe(topbar);
}

export function renderHeader(layoutId, user, settings = {}) {
    let html = '';

    switch (layoutId) {
        case 'centered':
            html = renderCentered(user, settings);
            break;
        case 'minimal':
            html = renderMinimal(user, settings);
            break;
        case 'luxury':
            html = renderLuxury(user, settings);
            break;
        case 'search-hero':
            html = renderSearchHero(user, settings);
            break;
        case 'transparent':
            html = renderTransparent(user, settings);
            break;
        case 'classic':
        default:
            html = renderClassic(user, settings);
            break;
    }

    const container = document.getElementById('site-header');
    if (container) {
        container.outerHTML = html;
    } else {
        document.getElementById('site-header-topbar')?.remove();
        document.getElementById('mobile-menu-backdrop')?.remove();
        document.getElementById('mobile-menu')?.remove();
        document.getElementById('mobile-bottom-nav')?.remove();

        const existingNav = document.getElementById('site-header-nav');
        if (existingNav) {
            existingNav.outerHTML = html;
        } else {
            const main = document.querySelector('main');
            if (main) {
                main.insertAdjacentHTML('beforebegin', html);
            }
        }
    }

    attachMobileMenuToggle();
    syncHeaderHeightVar();
    syncTransparentHeaderState();
    observeHeaderSize();
    requestAnimationFrame(() => {
        syncHeaderHeightVar();
        syncTransparentHeaderState();
    });

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => syncHeaderHeightVar()).catch(() => {});
    }

    if (window.currentView) {
        syncBottomNavActive(window.currentView);
    }

    if (!window.__devoHeaderResizeBound) {
        window.__devoHeaderResizeBound = true;
        window.addEventListener('resize', () => {
            syncHeaderHeightVar();
            syncTransparentHeaderState();
        }, { passive: true });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                syncHeaderHeightVar();
                syncTransparentHeaderState();
            }, 120);
        }, { passive: true });
        window.addEventListener('scroll', syncTransparentHeaderState, { passive: true });
    }
}
