/**
 * Header Layouts Library
 * كل Layout هو component مستقل. إضافة layout جديد لا يتطلب تعديل النظام الأساسي.
 */

// ===================================================================
// 1. LAYOUT REGISTRY — قائمة الـ Layouts المتاحة
// ===================================================================
export const HEADER_LAYOUTS = [
    {
        id: 'classic',
        name: 'كلاسيك (Classic)',
        description: 'شعار في اليسار، روابط التنقل في الوسط، أيقونات في اليمين',
        icon: 'ph-layout',
        preview_classes: ['flex', 'justify-between']
    },
    {
        id: 'centered',
        name: 'شعار وسط (Centered Logo)',
        description: 'الشعار في المنتصف والقوائم على الجانبين',
        icon: 'ph-arrows-out-line-horizontal',
        preview_classes: ['flex', 'justify-center']
    },
    {
        id: 'minimal',
        name: 'بسيط (Minimal)',
        description: 'تصميم نظيف وبسيط مع شعار وزر قائمة فقط',
        icon: 'ph-minus-circle',
        preview_classes: ['flex', 'justify-between']
    },
    {
        id: 'luxury',
        name: 'فاخر مع شريط علوي (Luxury)',
        description: 'شريط معلومات علوي + Header رئيسي ضخم',
        icon: 'ph-crown-simple',
        preview_classes: ['flex', 'flex-col']
    },
    {
        id: 'search-hero',
        name: 'بحث بارز (Search Hero)',
        description: 'شريط بحث كبير في وسط الهيدر',
        icon: 'ph-magnifying-glass',
        preview_classes: ['flex', 'justify-between']
    },
    {
        id: 'transparent',
        name: 'شفاف مع Scroll (Transparent)',
        description: 'شفاف فوق الـ Hero، يتحول إلى لون ثابت عند التمرير — مع Compact عند الـ Scroll',
        icon: 'ph-eye',
        preview_classes: ['flex', 'justify-between']
    },
];

// ===================================================================
// 2. SHARED UTILITIES — أدوات مشتركة بين الـ Layouts
// ===================================================================

/**
 * بناء روابط التنقل بناءً على بيانات المستخدم
 */
function buildNavLinks(user) {
    const hasAdminAccess = user && (user.role === 'owner' || user.role === 'admin');
    const hasWarehouseAccess = user && (user.role === 'owner' || user.role === 'admin' || user.worker_job === 'warehouse' || user.worker_job === 'both');

    if (user) {
        return [
            { label: 'الرئيسية', action: `switchSiteView('view-home')`, icon: 'ph-house' },
            { label: 'المعرض', action: `switchSiteView('view-gallery')`, icon: 'ph-images' },
            { label: 'الباركود', action: `switchSiteView('view-barcode')`, icon: 'ph-qr-code' },
            { label: 'السلة', action: `switchSiteView('view-cart'); window.refreshCartView?.()`, icon: 'ph-shopping-cart' },
            { label: 'الأوردرات', action: `switchSiteView('view-orders')`, icon: 'ph-receipt' },
        ];
    } else {
        return [
            { label: 'الرئيسية', action: `switchSiteView('view-home')`, icon: 'ph-house' },
            { label: 'المعرض', action: `switchSiteView('view-gallery')`, icon: 'ph-images' },
        ];
    }
}

/**
 * بناء منطقة المستخدم (User Area) في اليمين
 */
function buildUserArea(user) {
    const hasAdminAccess = user && (user.role === 'owner' || user.role === 'admin');
    const hasWarehouseAccess = user && (user.role === 'owner' || user.role === 'admin' || user.worker_job === 'warehouse' || user.worker_job === 'both');
    const isWorker = user && user.role === 'worker';

    if (user) {
        let workerTitle = 'عامل مبيعات';
        if (isWorker) {
            if (user.worker_job === 'warehouse') workerTitle = 'عامل مخزن';
            else if (user.worker_job === 'both') workerTitle = 'مبيعات + مخزن';
        }
        return `
            ${hasAdminAccess ? `<a href="admin.html" class="text-devo-info hover:text-white text-sm font-bold flex items-center gap-1" title="لوحة الإدارة"><i class="ph ph-shield-check text-xl"></i></a>` : ''}
            ${hasWarehouseAccess ? `<a href="warehouse.html" class="text-devo-success hover:text-white text-sm font-bold flex items-center gap-1" title="صفحة العمال"><i class="ph ph-hard-hat text-xl"></i></a>` : ''}
            <div class="flex items-center gap-2 border-r border-devo-gray pr-4">
                <div class="text-right">
                    <p class="text-sm font-bold text-white leading-tight truncate max-w-[120px]" title="${user.full_name}">${user.full_name}</p>
                    <p class="text-[10px] text-devo-orange leading-tight">${isWorker ? workerTitle : 'إدارة'}</p>
                </div>
                <div class="w-10 h-10 rounded-full bg-devo-gray flex items-center justify-center text-white font-bold cursor-pointer hover:bg-devo-orange transition-colors" onclick="handleLogout()" title="تسجيل الخروج">
                    <i class="ph ph-sign-out text-xl"></i>
                </div>
            </div>
        `;
    } else {
        return `
            <a href="auth.html" class="px-4 py-2 bg-devo-orange hover:bg-devo-orangeHover text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm">
                <i class="ph ph-sign-in text-base"></i>
                <span>تسجيل الدخول</span>
            </a>
        `;
    }
}

/**
 * بناء قائمة الموبايل الجانبية (Mobile Drawer) — مشتركة بين كل الـ Layouts
 */
function buildMobileMenu(user) {
    const hasAdminAccess = user && (user.role === 'owner' || user.role === 'admin');
    const hasWarehouseAccess = user && (user.role === 'owner' || user.role === 'admin' || user.worker_job === 'warehouse' || user.worker_job === 'both');

    let links = '';
    if (user) {
        links = `
            <button onclick="switchSiteView('view-home')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">الرئيسية</button>
            <button onclick="switchSiteView('view-gallery')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">المعرض</button>
            <button onclick="switchSiteView('view-barcode')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full flex items-center gap-2"><i class="ph ph-qr-code"></i> الباركود</button>
            <button onclick="switchSiteView('view-cart'); window.refreshCartView?.();" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full flex items-center gap-2"><i class="ph ph-shopping-cart"></i> السلة</button>
            <button onclick="switchSiteView('view-orders')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full flex items-center gap-2"><i class="ph ph-receipt"></i> الأوردرات</button>
            ${hasWarehouseAccess ? `<a href="warehouse.html" class="py-3 text-devo-success hover:text-white border-b border-devo-gray flex items-center gap-2"><i class="ph ph-hard-hat"></i> صفحة العمال (المخزن)</a>` : ''}
            ${hasAdminAccess ? `<a href="admin.html" class="py-3 text-devo-info hover:text-white border-b border-devo-gray flex items-center gap-2"><i class="ph ph-shield-check"></i> لوحة الإدارة</a>` : ''}
            <button onclick="handleLogout()" class="py-3 text-devo-error text-right mt-4 flex items-center gap-2"><i class="ph ph-sign-out"></i> تسجيل خروج</button>
        `;
    } else {
        links = `
            <button onclick="switchSiteView('view-home')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">الرئيسية</button>
            <button onclick="switchSiteView('view-gallery')" class="py-3 text-right text-devo-muted hover:text-white border-b border-devo-gray w-full">المعرض</button>
            <a href="auth.html" class="py-3 text-devo-orange hover:text-white border-b border-devo-gray flex items-center gap-2 font-bold"><i class="ph ph-sign-in"></i> تسجيل الدخول</a>
        `;
    }

    return `
        <div id="mobile-menu" class="fixed inset-0 bg-devo-black z-40 transform translate-x-full transition-transform duration-300 md:hidden flex flex-col pt-24 px-6">
            <div class="flex flex-col space-y-1 text-lg font-bold" id="mobile-nav-links">
                ${links}
            </div>
        </div>
    `;
}

/**
 * إضافة سلوك الـ Mobile Toggle بعد تركيب الـ HTML
 */
export function attachMobileMenuToggle() {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileBtn && mobileMenu) {
        mobileBtn.addEventListener('click', () => {
            mobileMenu.classList.toggle('translate-x-full');
            const icon = mobileBtn.querySelector('i');
            if (icon) {
                icon.classList.toggle('ph-list');
                icon.classList.toggle('ph-x');
            }
        });
    }
}

// ===================================================================
// 3. LAYOUT RENDERERS — كل Layout دالة مستقلة
// ===================================================================

/**
 * Layout: Classic
 * Logo يسار | Nav وسط | User Area يمين
 */
function renderClassic(user, settings) {
    const height = settings.header_height || '80';
    const isTransparent = settings.header_transparent === 'true';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    const navBtns = navLinks.map(l =>
        `<button onclick="${l.action}" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors flex items-center gap-1">
            <i class="ph ${l.icon}"></i>${l.label}
        </button>`
    ).join('');

    const headerBg = isTransparent
        ? 'bg-transparent border-transparent'
        : 'bg-devo-black/90 backdrop-blur-md border-b border-devo-gray';

    return `
        <nav id="site-header-nav" class="fixed w-full z-50 ${headerBg} transition-all duration-300" data-layout="classic">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                    </div>
                    <div class="hidden md:flex items-baseline space-x-2 space-x-reverse">
                        ${navBtns}
                    </div>
                    <div class="hidden md:flex items-center gap-3">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center">
                        <button id="mobile-menu-btn" class="text-devo-muted hover:text-white focus:outline-none">
                            <i class="ph ph-list text-3xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

/**
 * Layout: Centered Logo
 * Nav يمين | Logo وسط | User Area يسار
 */
function renderCentered(user, settings) {
    const height = settings.header_height || '80';
    const isTransparent = settings.header_transparent === 'true';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    // قسم الروابط إلى نصفين
    const half = Math.ceil(navLinks.length / 2);
    const leftLinks = navLinks.slice(0, half);
    const rightLinks = navLinks.slice(half);

    const buildBtns = (links) => links.map(l =>
        `<button onclick="${l.action}" class="px-3 py-2 rounded-md text-sm font-bold text-devo-muted hover:text-white transition-colors">
            ${l.label}
        </button>`
    ).join('');

    const headerBg = isTransparent
        ? 'bg-transparent border-transparent'
        : 'bg-devo-black/90 backdrop-blur-md border-b border-devo-gray';

    return `
        <nav id="site-header-nav" class="fixed w-full z-50 ${headerBg} transition-all duration-300" data-layout="centered">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="hidden md:grid grid-cols-3 items-center" style="height:${height}px">
                    <div class="flex items-center justify-start gap-1">
                        ${buildBtns(rightLinks)}
                    </div>
                    <div class="flex justify-center cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                    </div>
                    <div class="flex items-center justify-end gap-3">
                        ${buildBtns(leftLinks)}
                        <div class="border-r border-devo-gray pr-3">
                            ${userArea}
                        </div>
                    </div>
                </div>
                <div class="md:hidden flex items-center justify-between" style="height:${height}px">
                    <div class="cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h1>
                    </div>
                    <button id="mobile-menu-btn" class="text-devo-muted hover:text-white focus:outline-none">
                        <i class="ph ph-list text-3xl"></i>
                    </button>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

/**
 * Layout: Minimal
 * Logo يسار | فراغ | زر قائمة الهواتف + User فقط يمين
 */
function renderMinimal(user, settings) {
    const height = settings.header_height || '64';
    const isTransparent = settings.header_transparent === 'true';
    const userArea = buildUserArea(user);

    const headerBg = isTransparent
        ? 'bg-transparent border-transparent'
        : 'bg-devo-black/80 backdrop-blur-sm border-b border-devo-gray/30';

    return `
        <nav id="site-header-nav" class="fixed w-full z-50 ${headerBg} transition-all duration-300" data-layout="minimal">
            <div class="max-w-7xl mx-auto px-6 lg:px-8">
                <div class="flex items-center justify-between" style="height:${height}px">
                    <div class="cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl font-black tracking-widest text-white">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                    </div>
                    <div class="hidden md:flex items-center gap-4">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center">
                        <button id="mobile-menu-btn" class="text-devo-muted hover:text-white focus:outline-none">
                            <i class="ph ph-list text-3xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

/**
 * Layout: Luxury
 * Top Info Bar أعلى + Header كبير مع Logo وسط/يمين
 */
function renderLuxury(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    const navBtns = navLinks.map(l =>
        `<button onclick="${l.action}" class="px-4 py-2 text-sm font-bold text-devo-muted hover:text-white transition-colors hover:border-b-2 hover:border-devo-orange">
            ${l.label}
        </button>`
    ).join('');

    return `
        <!-- Top Info Bar -->
        <div class="fixed w-full z-50 top-0 bg-devo-orange/95 backdrop-blur-sm text-white text-xs py-1.5 px-4">
            <div class="max-w-7xl mx-auto flex items-center justify-between">
                <span class="flex items-center gap-1.5 font-medium">
                    <i class="ph ph-clock"></i>
                    ساعات العمل: السبت - الخميس | 10 ص - 10 م
                </span>
                <div class="hidden md:flex items-center gap-4">
                    <span class="flex items-center gap-1"><i class="ph ph-phone"></i> تواصل معنا</span>
                    <span class="flex items-center gap-1"><i class="ph ph-map-pin"></i> موقعنا</span>
                </div>
            </div>
        </div>
        <!-- Main Header -->
        <nav id="site-header-nav" class="fixed w-full z-40 bg-devo-black/95 backdrop-blur-md border-b border-devo-gray transition-all duration-300" style="top:28px" data-layout="luxury">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                        <p class="text-[9px] font-bold tracking-[0.3em] text-devo-orange uppercase -mt-1">Collection</p>
                    </div>
                    <div class="hidden md:flex items-center gap-1 border-r border-l border-devo-gray/30 px-6">
                        ${navBtns}
                    </div>
                    <div class="hidden md:flex items-center gap-3">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center">
                        <button id="mobile-menu-btn" class="text-devo-muted hover:text-white focus:outline-none">
                            <i class="ph ph-list text-3xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

/**
 * Layout: Search Hero
 * Logo يسار | 🔍 Search Bar ضخم في الوسط | User Area يمين
 */
function renderSearchHero(user, settings) {
    const height = settings.header_height || '80';
    const isTransparent = settings.header_transparent === 'true';
    const userArea = buildUserArea(user);

    const headerBg = isTransparent
        ? 'bg-transparent border-transparent'
        : 'bg-devo-black/90 backdrop-blur-md border-b border-devo-gray';

    return `
        <nav id="site-header-nav" class="fixed w-full z-50 ${headerBg} transition-all duration-300" data-layout="search-hero">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex items-center justify-between gap-4" style="height:${height}px">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-2xl md:text-3xl font-black tracking-wider text-white">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                    </div>
                    <!-- Search Bar (Desktop) -->
                    <div class="hidden md:flex flex-1 max-w-xl relative">
                        <i class="ph ph-magnifying-glass absolute right-4 top-1/2 -translate-y-1/2 text-devo-muted text-lg z-10"></i>
                        <input
                            type="text"
                            placeholder="ابحث في المعرض..."
                            onclick="switchSiteView('view-gallery')"
                            class="w-full bg-devo-dark/80 border border-devo-gray rounded-full pr-12 pl-5 py-2.5 text-white placeholder-devo-muted focus:outline-none focus:border-devo-orange transition-all cursor-pointer text-sm"
                            readonly
                        >
                    </div>
                    <div class="hidden md:flex items-center gap-3 flex-shrink-0">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center gap-2">
                        <button onclick="switchSiteView('view-gallery')" class="text-devo-muted hover:text-white">
                            <i class="ph ph-magnifying-glass text-2xl"></i>
                        </button>
                        <button id="mobile-menu-btn" class="text-devo-muted hover:text-white focus:outline-none">
                            <i class="ph ph-list text-3xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

/**
 * Layout: Transparent Scroll
 * شفاف فوق الـ Hero — يتحول إلى solid + compact عند التمرير
 */
function renderTransparent(user, settings) {
    const height = settings.header_height || '80';
    const navLinks = buildNavLinks(user);
    const userArea = buildUserArea(user);

    const navBtns = navLinks.map(l =>
        `<button onclick="${l.action}" class="px-3 py-2 rounded-md text-sm font-bold text-white/80 hover:text-white transition-colors">
            ${l.label}
        </button>`
    ).join('');

    return `
        <nav id="site-header-nav" class="fixed w-full z-50 bg-transparent border-transparent transition-all duration-500" style="height:${height}px" data-layout="transparent">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full">
                <div class="flex items-center justify-between h-full">
                    <div class="flex-shrink-0 cursor-pointer" onclick="switchSiteView('view-home')">
                        <h1 class="text-3xl font-black tracking-wider text-white drop-shadow-lg">
                            D<span class="text-devo-orange">E</span>VO
                        </h1>
                    </div>
                    <div class="hidden md:flex items-baseline space-x-2 space-x-reverse">
                        ${navBtns}
                    </div>
                    <div class="hidden md:flex items-center gap-3">
                        ${userArea}
                    </div>
                    <div class="md:hidden flex items-center">
                        <button id="mobile-menu-btn" class="text-white hover:text-devo-orange focus:outline-none">
                            <i class="ph ph-list text-3xl"></i>
                        </button>
                    </div>
                </div>
            </div>
        </nav>
        ${buildMobileMenu(user)}
    `;
}

// ===================================================================
// 4. SCROLL BEHAVIORS
// ===================================================================

/**
 * Sticky behavior — Header يظل ثابتاً عند التمرير (مفعل افتراضياً)
 */
function attachStickyBehavior(settings) {
    const nav = document.getElementById('site-header-nav');
    if (!nav) return;
    // الـ Header fixed بالفعل من التصميم
}

/**
 * Transparent behavior — تحول من شفاف إلى solid عند التمرير
 */
function attachTransparentScrollBehavior() {
    const nav = document.getElementById('site-header-nav');
    if (!nav) return;

    const updateNavStyle = () => {
        const scrolled = window.scrollY > 60;
        if (scrolled) {
            nav.classList.add('bg-devo-black/95', 'backdrop-blur-md', 'border-b', 'border-devo-gray');
            nav.classList.remove('bg-transparent', 'border-transparent');
            nav.style.height = '64px';
        } else {
            nav.classList.remove('bg-devo-black/95', 'backdrop-blur-md', 'border-b', 'border-devo-gray');
            nav.classList.add('bg-transparent', 'border-transparent');
            nav.style.height = '';
        }
    };

    window.addEventListener('scroll', updateNavStyle, { passive: true });
    updateNavStyle();
}

/**
 * Compact on scroll — Header يصبح أصغر عند التمرير
 */
function attachCompactScrollBehavior(originalHeight) {
    const nav = document.getElementById('site-header-nav');
    if (!nav) return;
    const compactHeight = '56px';

    const updateNavHeight = () => {
        const scrolled = window.scrollY > 80;
        nav.style.height = scrolled ? compactHeight : `${originalHeight}px`;
    };

    window.addEventListener('scroll', updateNavHeight, { passive: true });
}

// ===================================================================
// 5. MAIN RENDER FUNCTION
// ===================================================================

/**
 * الدالة الرئيسية — تُركّب الـ Header المناسب بناءً على الإعداد المختار
 * @param {string} layoutId — معرف الـ Layout
 * @param {object} user — بيانات المستخدم الحالي
 * @param {object} settings — إعدادات الـ Header من Supabase
 */
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

    // حقن الـ HTML في الـ DOM
    const container = document.getElementById('site-header');
    if (container) {
        container.outerHTML = html;
    } else {
        // Fallback: إدخال قبل أول <main>
        const main = document.querySelector('main');
        if (main) {
            main.insertAdjacentHTML('beforebegin', html);
        }
    }

    // ربط سلوكيات الـ Scroll
    if (layoutId === 'transparent') {
        attachTransparentScrollBehavior();
    } else if (settings.header_sticky !== 'false') {
        const compactOnScroll = settings.header_compact_on_scroll === 'true';
        if (compactOnScroll) {
            attachCompactScrollBehavior(parseInt(settings.header_height || '80'));
        }
    }

    // ربط Mobile Menu Toggle
    attachMobileMenuToggle();

    // التعامل مع الـ main padding بناءً على layout
    updateMainPadding(layoutId, settings);
}

/**
 * تحديث padding-top لـ <main> بناءً على ارتفاع الـ Header
 */
function updateMainPadding(layoutId, settings) {
    const main = document.querySelector('main');
    if (!main) return;

    if (layoutId === 'luxury') {
        // Top Bar (28px) + Header
        const height = parseInt(settings.header_height || '80');
        main.style.paddingTop = `${height + 28}px`;
    } else if (layoutId === 'transparent') {
        // شفاف — لا padding (الـ Hero تبدأ من الأعلى)
        main.style.paddingTop = '0';
    } else {
        const height = parseInt(settings.header_height || '80');
        main.style.paddingTop = `${height}px`;
    }
}
