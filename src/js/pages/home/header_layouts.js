/**
 * Header Layouts Library
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
        ];
    }
}

function buildNavBtns(links) {
    return links.map(l =>
        `<button data-nav-view="${l.id}" onclick="${l.action}" class="px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold text-devo-muted hover:text-devo-text transition-all flex items-center gap-1.5 border border-transparent">
            <i class="ph ${l.icon} text-base"></i>
            <span>${l.label}</span>
        </button>`
    ).join('');
}

function buildUserArea(user) {
    const hasAdminAccess = user && (user.role === 'owner' || user.role === 'admin');
    const isWorker = user && user.role === 'worker';

    if (user) {
        let roleBadge = 'إدارة';
        if (isWorker) {
            roleBadge = 'عامل مبيعات';
        } else if (user.role === 'owner') {
            roleBadge = 'مالك النظام';
        }

        return `
            ${hasAdminAccess ? `<a href="admin.html" class="p-2 rounded-lg bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white transition-all" title="لوحة الإدارة"><i class="ph ph-shield-check text-xl"></i></a>` : ''}
            <div class="flex items-center gap-2 border-r border-devo-gray pr-3">
                <div class="text-right">
                    <p class="text-xs md:text-sm font-bold text-white leading-tight truncate max-w-[110px]" title="${user.full_name}">${user.full_name}</p>
                    <p class="text-[10px] text-devo-orange leading-tight font-medium">${roleBadge}</p>
                </div>
                <div class="w-9 h-9 rounded-xl bg-devo-dark border border-devo-gray flex items-center justify-center text-devo-muted hover:text-devo-error hover:border-devo-error/40 cursor-pointer transition-all shadow-sm" onclick="handleLogout()" title="تسجيل الخروج">
                    <i class="ph ph-sign-out text-lg"></i>
                </div>
            </div>
        `;
    } else {
        return `
            <a href="auth.html" class="px-4 py-2 bg-devo-orange hover:bg-devo-orangeHover text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md">
                <i class="ph ph-sign-in text-base"></i>
                <span>تسجيل الدخول</span>
            </a>
        `;
    }
}

function buildMobileMenu(user) {
    const hasAdminAccess = user && (user.role === 'owner' || user.role === 'admin');

    let links = '';
    if (user) {
        links = `
            <button data-nav-view="view-home" onclick="switchSiteView('view-home')" class="py-3 px-4 text-right text-devo-muted hover:text-devo-text rounded-xl border border-transparent flex items-center gap-3"><i class="ph ph-house text-xl"></i> الرئيسية</button>
            <button data-nav-view="view-gallery" onclick="switchSiteView('view-gallery')" class="py-3 px-4 text-right text-devo-muted hover:text-devo-text rounded-xl border border-transparent flex items-center gap-3"><i class="ph ph-images text-xl"></i> المعرض</button>
            <button data-nav-view="view-barcode" onclick="switchSiteView('view-barcode')" class="py-3 px-4 text-right text-devo-muted hover:text-devo-text rounded-xl border border-transparent flex items-center gap-3"><i class="ph ph-qr-code text-xl"></i> الباركود</button>
            <button data-nav-view="view-cart" onclick="switchSiteView('view-cart'); window.refreshCartView?.();" class="py-3 px-4 text-right text-devo-muted hover:text-devo-text rounded-xl border border-transparent flex items-center gap-3"><i class="ph ph-shopping-cart text-xl"></i> السلة</button>
            <button data-nav-view="view-orders" onclick="switchSiteView('view-orders')" class="py-3 px-4 text-right text-devo-muted hover:text-devo-text rounded-xl border border-transparent flex items-center gap-3"><i class="ph ph-receipt text-xl"></i> الأوردرات</button>

            ${hasAdminAccess ? `<a href="admin.html" class="py-3 px-4 text-devo-info hover:text-devo-text rounded-xl bg-devo-info/10 flex items-center gap-3"><i class="ph ph-shield-check text-xl"></i> لوحة الإدارة</a>` : ''}
            <button onclick="handleLogout()" class="py-3 px-4 text-devo-error text-right mt-6 rounded-xl bg-devo-error/10 flex items-center gap-3 font-bold"><i class="ph ph-sign-out text-xl"></i> تسجيل خروج</button>
        `;
    } else {
        links = `
            <button data-nav-view="view-home" onclick="switchSiteView('view-home')" class="py-3 px-4 text-right text-devo-muted hover:text-devo-text rounded-xl flex items-center gap-3"><i class="ph ph-house text-xl"></i> الرئيسية</button>
            <button data-nav-view="view-gallery" onclick="switchSiteView('view-gallery')" class="py-3 px-4 text-right text-devo-muted hover:text-devo-text rounded-xl flex items-center gap-3"><i class="ph ph-images text-xl"></i> المعرض</button>
            <a href="auth.html" class="py-3 px-4 text-devo-orange hover:text-devo-text rounded-xl bg-devo-orange/10 flex items-center gap-3 font-bold mt-4"><i class="ph ph-sign-in text-xl"></i> تسجيل الدخول</a>
        `;
    }

    return `
        <div id="mobile-menu" class="fixed inset-0 bg-devo-black/95 backdrop-blur-xl z-[90] transform translate-x-full transition-transform duration-300 md:hidden flex flex-col pt-20 px-6 overflow-y-auto">
            <div class="flex flex-col space-y-2 text-base font-bold" id="mobile-nav-links">
                ${links}
            </div>
        </div>
    `;
}

export function attachMobileMenuToggle() {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileBtn && mobileMenu) {
        mobileBtn.onclick = () => {
            mobileMenu.classList.toggle('translate-x-full');
            const icon = mobileBtn.querySelector('i');
            if (icon) {
                icon.classList.toggle('ph-list');
                icon.classList.toggle('ph-x');
            }
        };
    }
}

// ===================================================================
// 3. LAYOUT RENDERERS — كل Layout دالة مستقلة
// ===================================================================

function renderClassic(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-50 bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" data-layout="classic">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl sm:text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO <span class="text-[10px] font-bold tracking-widest text-devo-orange bg-devo-orange/10 px-2 py-0.5 rounded-full uppercase border border-devo-orange/20">Collection</span>
                        </h1>
                    </div>
                    <div class="hidden md:flex items-center gap-1.5 bg-devo-dark/80 p-1.5 rounded-2xl border border-devo-gray/60 shadow-inner">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="hidden md:flex items-center gap-3">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center gap-2">
                        <button id="mobile-menu-btn" class="p-2 text-devo-muted hover:text-devo-text focus:outline-none bg-devo-dark border border-devo-gray rounded-xl">
                            <i class="ph ph-list text-2xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
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
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-50 bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" data-layout="centered">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="hidden md:grid grid-cols-3 items-center" style="height:${height}px">
                    <div class="flex items-center justify-start gap-1">
                        ${buildNavBtns(rightLinks)}
                    </div>
                    <div class="flex flex-col items-center justify-center cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-3xl font-black tracking-wider text-white leading-none">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                        <span class="text-[9px] font-bold tracking-[0.3em] text-devo-orange uppercase mt-1">Collection</span>
                    </div>
                    <div class="flex items-center justify-end gap-2">
                        ${buildNavBtns(leftLinks)}
                        <div class="border-r border-devo-gray pr-2 mr-1">
                            ${userArea}
                        </div>
                    </div>
                </div>
                <div class="md:hidden flex items-center justify-between" style="height:${height}px">
                    <div class="cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h1>
                    </div>
                    <button id="mobile-menu-btn" class="p-2 text-devo-muted hover:text-devo-text bg-devo-dark border border-devo-gray rounded-xl">
                        <i class="ph ph-list text-2xl"></i>
                    </button>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

function renderMinimal(user, settings) {
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <header id="site-header-nav" class="fixed w-full top-3 left-0 right-0 z-50 px-3 md:px-6 transition-all duration-300 pointer-events-none" data-layout="minimal">
            <div class="max-w-6xl mx-auto bg-devo-black/95 backdrop-blur-xl border border-devo-gray/80 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.8)] px-4 py-2 flex items-center justify-between pointer-events-auto">
                <div class="flex items-center gap-2 cursor-pointer" onclick="switchSiteView('view-home')">
                    <div class="w-9 h-9 rounded-xl bg-devo-orange/10 border border-devo-orange/30 flex items-center justify-center text-devo-orange font-black text-xl">D</div>
                    <h1 class="text-xl font-black tracking-widest text-white">DEVO</h1>
                </div>
                <div class="hidden md:flex items-center gap-1">
                    ${buildNavBtns(navLinks)}
                </div>
                <div class="hidden md:flex items-center gap-2">
                    ${userArea}
                </div>
                <div class="md:hidden flex items-center">
                    <button id="mobile-menu-btn" class="p-2 text-devo-muted hover:text-devo-text bg-devo-dark border border-devo-gray rounded-xl">
                        <i class="ph ph-list text-xl"></i>
                    </button>
                </div>
            </div>
        </header>
        ${buildMobileMenu(user)}
    `;
}

function renderLuxury(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <div class="fixed w-full z-50 top-0 left-0 right-0 bg-gradient-to-r from-devo-orange via-amber-500 to-devo-orange text-white text-[11px] font-bold py-1 px-4 shadow-sm">
            <div class="max-w-7xl mx-auto flex items-center justify-between">
                <span class="flex items-center gap-1.5">
                    <i class="ph ph-clock text-sm"></i>
                    ساعات العمل: السبت - الخميس (10 ص - 10 م)
                </span>
                <div class="hidden sm:flex items-center gap-4">
                    <span class="flex items-center gap-1"><i class="ph ph-phone text-sm"></i> دعم العملاء</span>
                    <span class="flex items-center gap-1"><i class="ph ph-map-pin text-sm"></i> مصنع DEVO</span>
                </div>
            </div>
        </div>
        <nav id="site-header-nav" class="fixed w-full z-40 bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" style="top:26px" data-layout="luxury">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl sm:text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO <span class="text-[9px] font-black text-devo-orange bg-devo-orange/10 px-2 py-0.5 rounded border border-devo-orange/30">LUXURY</span>
                        </h1>
                    </div>
                    <div class="hidden md:flex items-center gap-1 bg-devo-dark p-1.5 rounded-2xl border border-devo-gray/50">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="hidden md:flex items-center gap-3">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center">
                        <button id="mobile-menu-btn" class="p-2 text-devo-muted hover:text-devo-text bg-devo-dark border border-devo-gray rounded-xl">
                            <i class="ph ph-list text-2xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

function renderSearchHero(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-50 bg-devo-black/95 backdrop-blur-md border-b border-devo-gray shadow-md transition-all duration-300" data-layout="search-hero">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between gap-4" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h1>
                    </div>
                    <div class="hidden md:flex flex-1 max-w-md mx-4 relative">
                        <i class="ph ph-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-devo-muted"></i>
                        <input type="text" onclick="switchSiteView('view-gallery')" placeholder="بحث سريع في الموديلات والمعرض..." readonly class="w-full bg-devo-dark border border-devo-gray rounded-xl pr-9 pl-4 py-2 text-xs text-white focus:border-devo-orange cursor-pointer hover:border-devo-grayHover transition-all">
                    </div>
                    <div class="hidden lg:flex items-center gap-1">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="flex items-center gap-2">
                        <div class="hidden sm:flex">${userArea}</div>
                        <button id="mobile-menu-btn" class="md:hidden p-2 text-devo-muted hover:text-devo-text bg-devo-dark border border-devo-gray rounded-xl">
                            <i class="ph ph-list text-xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

function renderTransparent(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    return `
        <nav id="site-header-nav" class="fixed w-full top-0 left-0 right-0 z-50 bg-transparent border-transparent transition-all duration-500" style="height:${height}px" data-layout="transparent">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl sm:text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                    </div>
                    <div class="hidden md:flex items-center gap-1 bg-devo-black/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/10">
                        ${buildNavBtns(navLinks)}
                    </div>
                    <div class="hidden md:flex items-center gap-3">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center">
                        <button id="mobile-menu-btn" class="p-2 text-devo-muted hover:text-devo-text bg-black/40 backdrop-blur-md border border-white/10 rounded-xl">
                            <i class="ph ph-list text-2xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

// ===================================================================
// 4. MAIN RENDER FUNCTION
// ===================================================================

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
        const main = document.querySelector('main');
        if (main) {
            main.insertAdjacentHTML('beforebegin', html);
        }
    }

    attachMobileMenuToggle();
}
