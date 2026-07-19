/**
 * Footer Layouts Library
 * كل Layout هو component مستقل. إضافة layout جديد لا يتطلب تعديل النظام الأساسي.
 */

// ===================================================================
// 1. LAYOUT REGISTRY — قائمة الـ Layouts المتاحة
// ===================================================================
export const FOOTER_LAYOUTS = [
    {
        id: 'simple',
        name: 'بسيط (Simple)',
        description: 'سطر واحد: شعار + حقوق النشر + وسائل التواصل',
        icon: 'ph-minus',
    },
    {
        id: 'minimal',
        name: 'شعار وسوشيال (Minimal)',
        description: 'الشعار في الوسط ووسائل التواصل فقط',
        icon: 'ph-dot-outline-fill',
    },
    {
        id: 'columns',
        name: 'متعدد الأعمدة (Multi-Column)',
        description: 'شعار ووصف + تواصل اجتماعي + بيانات إضافية',
        icon: 'ph-columns',
    },
    {
        id: 'luxury',
        name: 'فاخر (Luxury)',
        description: 'تصميم فاخر بخلفية متميزة وعناصر بصرية غنية',
        icon: 'ph-crown-simple',
    },
    {
        id: 'contact-only',
        name: 'تواصل فقط (Contact Only)',
        description: 'معلومات التواصل والسوشيال فقط',
        icon: 'ph-phone',
    },
    {
        id: 'brand-social',
        name: 'شعار ووصف وسوشيال (Brand + Social)',
        description: 'شعار مع وصف المتجر ووسائل التواصل',
        icon: 'ph-heart',
    },
];

// ===================================================================
// 2. SHARED UTILITIES
// ===================================================================

/**
 * بناء أيقونات السوشيال ميديا
 */
function buildSocialIcons(settings, size = 'md') {
    const fb = settings.social_facebook || '#';
    const wa = settings.social_whatsapp || '#';
    const maps = settings.social_maps || '#';
    const sz = size === 'lg' ? 'w-12 h-12 text-2xl' : 'w-10 h-10 text-xl';

    return `
        <a href="${fb}" target="_blank" class="${sz} rounded-full bg-devo-black border border-devo-gray flex items-center justify-center text-devo-muted hover:text-blue-500 hover:border-blue-500 hover:shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all" aria-label="Facebook" id="link-facebook">
            <i class="ph ph-facebook-logo"></i>
        </a>
        <a href="${wa}" target="_blank" class="${sz} rounded-full bg-devo-black border border-devo-gray flex items-center justify-center text-devo-muted hover:text-green-500 hover:border-green-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] transition-all" aria-label="WhatsApp" id="link-whatsapp">
            <i class="ph ph-whatsapp-logo"></i>
        </a>
        <a href="${maps}" target="_blank" class="${sz} rounded-full bg-devo-black border border-devo-gray flex items-center justify-center text-devo-muted hover:text-red-500 hover:border-red-500 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] transition-all" aria-label="Google Maps" id="link-maps">
            <i class="ph ph-map-pin"></i>
        </a>
    `;
}

/**
 * شريط حقوق النشر السفلي
 */
function buildCopyrightBar() {
    return `
        <div class="border-t border-devo-gray/50 mt-6 pt-4 flex flex-col md:flex-row items-center justify-between max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-[11px]">
            <div class="text-devo-muted mb-3 md:mb-0 font-medium">
                &copy; <span id="footer-current-year"></span> DEVO Collection. جميع الحقوق محفوظة للمصنع.
            </div>
            <div class="flex flex-wrap items-center justify-center gap-1.5 text-devo-muted bg-devo-black py-1.5 px-3 rounded-full border border-devo-gray/50 shadow-sm">
                <i class="ph-fill ph-code text-devo-orange text-base"></i>
                <a href="https://ahmed-attia-portfolio-ahm3d0xs-projects.vercel.app/" target="_blank" class="text-white font-bold hover:text-devo-orange transition-colors tracking-wide">Ahmed M. Attia</a>
                <span class="font-medium">Developer</span>
                <span class="text-devo-gray mx-0.5">|</span>
                <a href="https://www.linkedin.com/in/ahmed-m-attia-757aa6292/" target="_blank" class="text-blue-400 hover:text-blue-300 transition-colors flex items-center" title="LinkedIn Profile"><i class="ph-fill ph-linkedin-logo text-base"></i></a>
            </div>
        </div>
    `;
}

/**
 * شريط روابط سريعة (اختياري)
 */
function buildQuickLinks() {
    return `
        <div>
            <h4 class="text-white font-bold text-sm mb-3">روابط سريعة</h4>
            <ul class="space-y-2 text-devo-muted text-xs font-medium">
                <li><button onclick="switchSiteView('view-home')" class="hover:text-devo-orange transition-colors">الرئيسية</button></li>
                <li><button onclick="switchSiteView('view-gallery')" class="hover:text-devo-orange transition-colors">المعرض</button></li>
            </ul>
        </div>
    `;
}

// ===================================================================
// 3. LAYOUT RENDERERS — كل Layout دالة مستقلة
// ===================================================================

/**
 * Layout: Simple
 * سطر واحد: Logo يسار | Copyright وسط | Social يمين
 */
function renderSimple(settings) {
    return `
        <footer class="bg-devo-dark border-t border-devo-gray py-5 mt-auto" data-layout="simple">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div class="cursor-pointer flex-shrink-0" onclick="switchSiteView('view-home')">
                        <h2 class="text-2xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h2>
                    </div>
                    <p class="text-devo-muted text-xs font-medium text-center">
                        &copy; <span id="footer-current-year"></span> DEVO Collection — جميع الحقوق محفوظة للمصنع.
                    </p>
                    <div class="flex items-center gap-2">
                        ${buildSocialIcons(settings)}
                    </div>
                </div>
            </div>
        </footer>
    `;
}

/**
 * Layout: Minimal
 * شعار كبير في الوسط + Social icons فقط
 */
function renderMinimal(settings) {
    return `
        <footer class="bg-devo-dark border-t border-devo-gray py-10 mt-auto text-center" data-layout="minimal">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col items-center gap-5">
                <div class="cursor-pointer" onclick="switchSiteView('view-home')">
                    <h2 class="text-4xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h2>
                    <p class="text-xs tracking-[0.4em] text-devo-orange uppercase font-bold mt-1">Collection</p>
                </div>
                <div class="flex items-center gap-3">
                    ${buildSocialIcons(settings, 'md')}
                </div>
                <p class="text-devo-muted text-xs font-medium">
                    &copy; <span id="footer-current-year"></span> DEVO Collection
                </p>
            </div>
        </footer>
    `;
}

/**
 * Layout: Multi-Column
 * شعار + وصف | تواصل اجتماعي | (روابط سريعة — اختياري)
 */
function renderColumns(settings) {
    const showQuickLinks = settings.footer_show_quick_links === 'true';
    const cols = showQuickLinks ? 'md:grid-cols-3' : 'md:grid-cols-2';

    return `
        <footer class="bg-devo-dark border-t border-devo-gray py-10 mt-auto relative overflow-hidden" data-layout="columns">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 ${cols} gap-8 text-center md:text-right relative z-10">
                <div>
                    <div class="cursor-pointer mb-3 inline-block" onclick="switchSiteView('view-home')">
                        <h2 class="text-2xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h2>
                    </div>
                    <p class="text-devo-muted text-xs leading-relaxed max-w-xs mx-auto md:mx-0">
                        للملابس الجاهزة.<br>نلتزم بتقديم أفضل الخامات وأحدث التصاميم لعملائنا في كل مكان.
                    </p>
                </div>
                ${showQuickLinks ? buildQuickLinks() : ''}
                <div>
                    <h4 class="text-white font-bold text-sm mb-3">تواصل معنا</h4>
                    <div class="flex justify-center md:justify-start gap-3">
                        ${buildSocialIcons(settings)}
                    </div>
                </div>
            </div>
            ${buildCopyrightBar()}
        </footer>
    `;
}

/**
 * Layout: Luxury
 * Footer فاخر مع خلفية متميزة
 */
function renderLuxury(settings) {
    const showQuickLinks = settings.footer_show_quick_links === 'true';

    return `
        <footer class="bg-devo-black border-t border-devo-orange/20 mt-auto relative overflow-hidden" data-layout="luxury">
            <!-- خلفية زخرفية -->
            <div class="absolute inset-0 pointer-events-none">
                <div class="absolute top-0 right-0 w-72 h-72 bg-devo-orange/3 rounded-full blur-3xl translate-x-1/3 -translate-y-1/2"></div>
                <div class="absolute bottom-0 left-0 w-56 h-56 bg-devo-orange/3 rounded-full blur-3xl -translate-x-1/3 translate-y-1/3"></div>
            </div>

            <div class="relative z-10 py-14">
                <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <!-- Logo + Tagline -->
                    <div class="text-center mb-10">
                        <div class="cursor-pointer inline-block mb-3" onclick="switchSiteView('view-home')">
                            <h2 class="text-5xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h2>
                        </div>
                        <p class="text-xs tracking-[0.5em] text-devo-orange uppercase font-bold mb-2">Collection</p>
                        <div class="w-16 h-0.5 bg-devo-orange mx-auto"></div>
                        <p class="text-devo-muted text-sm mt-4 max-w-sm mx-auto leading-relaxed">
                            للملابس الجاهزة. نلتزم بتقديم أفضل الخامات وأحدث التصاميم.
                        </p>
                    </div>

                    ${showQuickLinks ? `
                    <div class="flex justify-center gap-6 mb-8 text-sm">
                        <button onclick="switchSiteView('view-home')" class="text-devo-muted hover:text-devo-orange transition-colors">الرئيسية</button>
                        <button onclick="switchSiteView('view-gallery')" class="text-devo-muted hover:text-devo-orange transition-colors">المعرض</button>
                    </div>` : ''}

                    <!-- Social Icons -->
                    <div class="flex items-center justify-center gap-4 mb-10">
                        ${buildSocialIcons(settings, 'lg')}
                    </div>

                    <!-- Copyright -->
                    <div class="border-t border-devo-gray/30 pt-6 flex flex-col md:flex-row items-center justify-between text-[11px]">
                        <p class="text-devo-muted mb-3 md:mb-0">
                            &copy; <span id="footer-current-year"></span> DEVO Collection. جميع الحقوق محفوظة للمصنع.
                        </p>
                        <div class="flex flex-wrap items-center justify-center gap-1.5 text-devo-muted bg-devo-dark py-1.5 px-3 rounded-full border border-devo-gray/50">
                            <i class="ph-fill ph-code text-devo-orange text-base"></i>
                            <a href="https://ahmed-attia-portfolio-ahm3d0xs-projects.vercel.app/" target="_blank" class="text-white font-bold hover:text-devo-orange transition-colors tracking-wide">Ahmed M. Attia</a>
                            <span class="font-medium">Developer</span>
                            <span class="text-devo-gray mx-0.5">|</span>
                            <a href="https://www.linkedin.com/in/ahmed-m-attia-757aa6292/" target="_blank" class="text-blue-400 hover:text-blue-300 transition-colors"><i class="ph-fill ph-linkedin-logo text-base"></i></a>
                        </div>
                    </div>
                </div>
            </div>
        </footer>
    `;
}

/**
 * Layout: Contact Only
 * معلومات التواصل + سوشيال + Copyright
 */
function renderContactOnly(settings) {
    const fb = settings.social_facebook || '#';
    const wa = settings.social_whatsapp || '#';
    const maps = settings.social_maps || '#';

    return `
        <footer class="bg-devo-dark border-t border-devo-gray py-8 mt-auto" data-layout="contact-only">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div class="flex flex-col md:flex-row items-center justify-between gap-6">
                    <!-- Logo -->
                    <div class="cursor-pointer flex-shrink-0" onclick="switchSiteView('view-home')">
                        <h2 class="text-2xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h2>
                    </div>

                    <!-- Contact Info -->
                    <div class="flex flex-wrap items-center justify-center gap-6 text-sm">
                        <a href="${wa}" target="_blank" class="flex items-center gap-2 text-devo-muted hover:text-green-400 transition-colors" id="link-whatsapp">
                            <div class="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
                                <i class="ph ph-whatsapp-logo text-green-400"></i>
                            </div>
                            <span>واتساب</span>
                        </a>
                        <a href="${fb}" target="_blank" class="flex items-center gap-2 text-devo-muted hover:text-blue-400 transition-colors" id="link-facebook">
                            <div class="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                                <i class="ph ph-facebook-logo text-blue-400"></i>
                            </div>
                            <span>فيسبوك</span>
                        </a>
                        <a href="${maps}" target="_blank" class="flex items-center gap-2 text-devo-muted hover:text-red-400 transition-colors" id="link-maps">
                            <div class="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                                <i class="ph ph-map-pin text-red-400"></i>
                            </div>
                            <span>الموقع</span>
                        </a>
                    </div>

                    <!-- Copyright -->
                    <p class="text-devo-muted text-xs font-medium flex-shrink-0">
                        &copy; <span id="footer-current-year"></span> DEVO Collection
                    </p>
                </div>
            </div>
        </footer>
    `;
}

/**
 * Layout: Brand + Social
 * شعار + وصف متجر + Social icons (بدون روابط إضافية)
 */
function renderBrandSocial(settings) {
    return `
        <footer class="bg-devo-dark border-t border-devo-gray py-10 mt-auto" data-layout="brand-social">
            <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <div class="cursor-pointer mb-2" onclick="switchSiteView('view-home')">
                    <h2 class="text-3xl font-black tracking-wider text-white">D<span class="text-devo-orange">E</span>VO</h2>
                </div>
                <p class="text-xs tracking-[0.4em] text-devo-orange uppercase font-bold mb-5">Collection</p>
                <p class="text-devo-muted text-sm leading-relaxed max-w-md mx-auto mb-6">
                    للملابس الجاهزة. نلتزم بتقديم أفضل الخامات وأحدث التصاميم لعملائنا في كل مكان.
                </p>
                <div class="flex items-center justify-center gap-3 mb-8">
                    ${buildSocialIcons(settings)}
                </div>
                ${buildCopyrightBar()}
            </div>
        </footer>
    `;
}

// ===================================================================
// 4. MAIN RENDER FUNCTION
// ===================================================================

/**
 * الدالة الرئيسية — تُركّب الـ Footer المناسب بناءً على الإعداد المختار
 * @param {string} layoutId — معرف الـ Layout
 * @param {object} settings — إعدادات الموقع من Supabase (home_settings map)
 */
export function renderFooter(layoutId, settings = {}) {
    let html = '';

    switch (layoutId) {
        case 'minimal':
            html = renderMinimal(settings);
            break;
        case 'columns':
            html = renderColumns(settings);
            break;
        case 'luxury':
            html = renderLuxury(settings);
            break;
        case 'contact-only':
            html = renderContactOnly(settings);
            break;
        case 'brand-social':
            html = renderBrandSocial(settings);
            break;
        case 'simple':
        default:
            html = renderSimple(settings);
            break;
    }

    // حقن الـ HTML في الـ DOM
    const container = document.getElementById('site-footer');
    if (container) {
        container.outerHTML = html;
    } else {
        // Fallback: استبدال الـ footer الموجود
        const existingFooter = document.querySelector('footer');
        if (existingFooter) {
            existingFooter.outerHTML = html;
        }
    }

    // تعيين السنة الحالية
    const yearEl = document.getElementById('footer-current-year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
}
