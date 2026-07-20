import { supabase } from '../../config/supabase.js';

export async function initHomeContent() {
    await Promise.all([
        loadHeroSettings(),
        loadPromoCards()
    ]);
}

// دالة معالجة روابط درايف
function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return '';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w2000`;
        }
    } catch (e) {}
    return url; 
}

// جلب الإعدادات (نصوص، صور، سوشيال ميديا)
async function loadHeroSettings() {
    const { data, error } = await supabase.from('home_settings').select('*');
    if (error || !data) return;

    const map = {};
    data.forEach(item => map[item.setting_key] = item.setting_value);

    // 1. حقن النصوص وتحديد ألوانها المخصصة
    const titleEl = document.getElementById('display-hero-title');
    const subtitleEl = document.getElementById('display-hero-subtitle');
    const titleColor = map['hero_title_color'] || '#ffffff';
    const subtitleColor = map['hero_subtitle_color'] || '#a3a3a3';

    if (titleEl) {
        titleEl.innerHTML = map['hero_title'] || 'DEVO';
        titleEl.style.setProperty('color', titleColor, 'important');
    }
    if (subtitleEl) {
        subtitleEl.innerHTML = map['hero_subtitle'] || '';
        subtitleEl.style.setProperty('color', subtitleColor, 'important');
    }

    // 2. حقن السوشيال ميديا
    if (document.getElementById('link-facebook')) document.getElementById('link-facebook').href = map['social_facebook'] || '#';
    if (document.getElementById('link-whatsapp')) document.getElementById('link-whatsapp').href = map['social_whatsapp'] || '#';
    if (document.getElementById('link-telegram')) document.getElementById('link-telegram').href = map['social_telegram'] || '#';
    if (document.getElementById('link-maps')) document.getElementById('link-maps').href = map['social_maps'] || '#';

    // 3. قراءة خصائص خلفية البانر الرئيسي
    const desktopImg = resolveImageUrl(map['hero_bg_desktop']);
    const mobileImg = resolveImageUrl(map['hero_bg_mobile']);
    const showBg = map['hero_bg_show'] !== 'false';
    const blendMode = map['hero_bg_blend'] || 'normal';
    const glassMode = map['hero_bg_glass'] || 'soft';
    const edgeFeatherVal = map['hero_bg_edge_feather'] !== undefined ? parseInt(map['hero_bg_edge_feather']) : 25;
    const opacityVal = map['hero_bg_opacity'] !== undefined ? parseInt(map['hero_bg_opacity']) : 100;
    const overlayVal = map['hero_bg_overlay_opacity'] !== undefined ? parseInt(map['hero_bg_overlay_opacity']) : 40;
    const blurVal = map['hero_bg_blur'] !== undefined ? parseInt(map['hero_bg_blur']) : 0;
    const glassOpacityVal = map['hero_glass_opacity'] !== undefined ? parseInt(map['hero_glass_opacity']) : 30;
    const glassBlurVal = map['hero_glass_blur'] !== undefined ? parseInt(map['hero_glass_blur']) : 12;

    const imgLayer = document.getElementById('hero-bg-image-layer');
    const overlayLayer = document.getElementById('hero-bg-overlay-layer');
    const topFadeLayer = document.getElementById('hero-bg-top-fade');
    const bottomFadeLayer = document.getElementById('hero-bg-bottom-fade');
    const contentCard = document.getElementById('hero-content-card');

    // 4. هندسة الصور والستايلات الديناميكية للطبقة المستقلة للصورة
    if (desktopImg || mobileImg) {
        const styleId = 'dynamic-hero-bg-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            document.head.appendChild(styleTag);
        }

        styleTag.innerHTML = `
            :root {
                --hero-bg-url: url('${mobileImg || desktopImg}');
            }
            @media (min-width: 768px) {
                :root {
                    --hero-bg-url: url('${desktopImg || mobileImg}');
                }
            }
        `;
    }

    // تطبيق الخصائص المباشرة على طبقة الصورة
    if (imgLayer) {
        if (showBg && (desktopImg || mobileImg)) {
            imgLayer.style.display = 'block';
            imgLayer.style.backgroundImage = 'var(--hero-bg-url)';
            imgLayer.style.opacity = (opacityVal / 100).toString();
            imgLayer.style.filter = `blur(${blurVal}px)`;
            imgLayer.style.mixBlendMode = blendMode;
        } else {
            imgLayer.style.display = 'none';
        }
    }

    // تطبيق الخصائص المباشرة على طبقة الإعتام الداكنة
    if (overlayLayer) {
        overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${overlayVal / 100})`;
    }

    // تطبيق تدرج الاضمحلال العلوية والسفلية Edge Merging Fades بلون الثيم النشط
    const activeBodyBg = (document.body && window.getComputedStyle(document.body).backgroundColor) || 'rgb(10, 10, 10)';
    if (topFadeLayer) {
        topFadeLayer.style.height = `${edgeFeatherVal}%`;
        topFadeLayer.style.backgroundImage = `linear-gradient(to bottom, ${activeBodyBg}, transparent)`;
    }
    if (bottomFadeLayer) {
        bottomFadeLayer.style.height = `${edgeFeatherVal}%`;
        bottomFadeLayer.style.backgroundImage = `linear-gradient(to top, ${activeBodyBg}, transparent)`;
    }

    // تطبيق الخصائص المباشرة على كارت المحتوى الزجاجي
    if (contentCard) {
        if (glassMode !== 'none') {
            const opacityRatio = glassOpacityVal / 100;
            const bgAlpha = glassMode === 'heavy' ? Math.min(0.9, opacityRatio + 0.3) : opacityRatio;
            contentCard.className = "text-center z-10 px-6 py-8 md:px-12 md:py-12 max-w-3xl mx-auto rounded-3xl transition-all duration-300";
            contentCard.style.backgroundColor = `rgba(0, 0, 0, ${bgAlpha})`;
            contentCard.style.backdropFilter = `blur(${glassBlurVal}px)`;
            contentCard.style.webkitBackdropFilter = `blur(${glassBlurVal}px)`;
            contentCard.style.border = `1px solid rgba(255, 255, 255, ${Math.min(0.25, opacityRatio * 0.5)})`;
            contentCard.style.boxShadow = `0 20px 50px rgba(0, 0, 0, ${Math.min(0.7, opacityRatio + 0.2)})`;
        } else {
            contentCard.className = "text-center z-10 px-6 py-8 md:px-12 md:py-12 max-w-3xl mx-auto rounded-3xl transition-all duration-300 bg-transparent";
            contentCard.style.backgroundColor = 'transparent';
            contentCard.style.backdropFilter = 'none';
            contentCard.style.webkitBackdropFilter = 'none';
            contentCard.style.border = 'none';
            contentCard.style.boxShadow = 'none';
        }
    }

    // 5. تطبيق خلفية البانر الرئيسي على الأقسام الأُخرى المفعّلة (المعرض، الباركود، السلة، الأوردرات)
    applySectionBackgrounds(map);
}

// 🌟 دالة تطبيق خلفية الهيرو على الأقسام والصفحات الأخرى (المعرض، الباركود، السلة، الأوردرات) 🌟
export function applySectionBackgrounds(map) {
    const desktopImg = resolveImageUrl(map['hero_bg_desktop']);
    const mobileImg = resolveImageUrl(map['hero_bg_mobile']);
    const bgUrl = desktopImg || mobileImg;

    const opacityVal = map['hero_bg_opacity'] !== undefined ? parseInt(map['hero_bg_opacity']) : 100;
    const overlayVal = map['hero_bg_overlay_opacity'] !== undefined ? parseInt(map['hero_bg_overlay_opacity']) : 40;
    const blurVal = map['hero_bg_blur'] !== undefined ? parseInt(map['hero_bg_blur']) : 0;
    const blendMode = map['hero_bg_blend'] || 'normal';

    const sectionMap = {
        'view-gallery': map['bg_enable_gallery'] === 'true',
        'view-barcode': map['bg_enable_barcode'] === 'true',
        'view-cart': map['bg_enable_cart'] === 'true',
        'view-orders': map['bg_enable_orders'] === 'true'
    };

    Object.entries(sectionMap).forEach(([viewId, enabled]) => {
        const viewEl = document.getElementById(viewId);
        if (!viewEl) return;

        let bgLayer = viewEl.querySelector('.section-bg-image-layer');
        let overlayLayer = viewEl.querySelector('.section-bg-overlay-layer');

        if (enabled && bgUrl) {
            if (!viewEl.classList.contains('relative')) {
                viewEl.classList.add('relative');
            }

            // طبقة الصورة
            if (!bgLayer) {
                bgLayer = document.createElement('div');
                bgLayer.className = 'section-bg-image-layer absolute inset-0 bg-cover bg-center bg-fixed pointer-events-none transition-all duration-300 z-0';
                viewEl.insertBefore(bgLayer, viewEl.firstChild);
            }
            bgLayer.style.display = 'block';
            bgLayer.style.backgroundImage = `url('${bgUrl}')`;
            bgLayer.style.opacity = (opacityVal / 100).toString();
            bgLayer.style.filter = `blur(${blurVal}px)`;
            bgLayer.style.mixBlendMode = blendMode;

            // طبقة الإعتام الداكنة
            if (!overlayLayer) {
                overlayLayer = document.createElement('div');
                overlayLayer.className = 'section-bg-overlay-layer absolute inset-0 pointer-events-none transition-all duration-300 z-[1]';
                viewEl.insertBefore(overlayLayer, bgLayer.nextSibling);
            }
            overlayLayer.style.display = 'block';
            overlayLayer.style.backgroundColor = `rgba(0, 0, 0, ${overlayVal / 100})`;

            // التأكد من أن جميع الأبناء يكون لها z-index أعلى لظهور المحتوى بوضوح فوق الخلفية
            Array.from(viewEl.children).forEach(child => {
                if (child !== bgLayer && child !== overlayLayer) {
                    if (!child.classList.contains('z-10') && !child.classList.contains('z-20') && !child.classList.contains('z-30')) {
                        child.classList.add('relative', 'z-10');
                    }
                }
            });
        } else {
            if (bgLayer) bgLayer.style.display = 'none';
            if (overlayLayer) overlayLayer.style.display = 'none';
        }
    });
}

window.openPromoModelLink = (modelId) => {
    if (typeof window.switchSiteView === 'function') {
        window.switchSiteView('view-gallery');
    }
    setTimeout(() => {
        if (typeof window.openModelViewer === 'function') {
            window.openModelViewer(modelId);
        }
    }, 400);
};

// 🌟 الكشف الذكي عن أبعاد الصورة وتغيير تخطيط الكارت تلقائياً مع الحفاظ التام على توحيد حجم الكروت طولاً وعرضاً 🌟
window.detectPromoImageAspect = (imgEl, cardId) => {
    if (!imgEl || !cardId) return;
    const cardEl = document.getElementById(`promo-card-${cardId}`);
    if (!cardEl) return;

    const width = imgEl.naturalWidth || imgEl.width;
    const height = imgEl.naturalHeight || imgEl.height;
    if (!width || !height) return;

    const ratio = width / height;
    const imgWrapper = cardEl.querySelector('.promo-img-container');
    const textWrapper = cardEl.querySelector('.promo-text-container');

    // 🌟 1. الصورة طويلة (Portrait: ratio < 1.15) -> الكارت يكون جانبـي بارتفاع موحد 🌟
    if (ratio < 1.15) {
        cardEl.className = "w-full bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden card-hover transition-all duration-300 flex flex-row relative group cursor-pointer h-72 sm:h-80 shadow-lg";
        
        if (imgWrapper) {
            imgWrapper.className = "promo-img-container w-1/3 sm:w-2/5 h-full bg-devo-black relative shrink-0 flex items-center justify-center p-1.5 border-l border-devo-gray/30 overflow-hidden";
        }
        if (textWrapper) {
            textWrapper.className = "promo-text-container p-4 sm:p-5 flex flex-col justify-between flex-1 h-full min-w-0 relative z-10";
        }
    } 
    // 🌟 2. الصورة عريضة (Landscape: ratio >= 1.15) -> الكارت يكون رأسي بنفس الارتفاع الموحد 🌟
    else {
        cardEl.className = "w-full bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden card-hover transition-all duration-300 flex flex-col relative group cursor-pointer h-72 sm:h-80 shadow-lg";
        
        if (imgWrapper) {
            imgWrapper.className = "promo-img-container w-full h-44 sm:h-48 bg-devo-black relative shrink-0 flex items-center justify-center p-2 border-b border-devo-gray/30 overflow-hidden";
        }
        if (textWrapper) {
            textWrapper.className = "promo-text-container p-4 sm:p-5 flex flex-col justify-between flex-1 h-full min-w-0 relative z-10";
        }
    }
};

// جلب الكروت الإعلانية بتصميم احترافي موحد الأحجام
async function loadPromoCards() {
    const container = document.getElementById('display-promo-cards');
    if (!container) return;

    const { data, error } = await supabase.from('promo_cards').select('*').eq('is_active', true).order('created_at', { ascending: true });

    if (error || !data || data.length === 0) {
        container.innerHTML = ''; 
        return;
    }

    container.innerHTML = data.map(card => {
        const imgUrl = resolveImageUrl(card.image_url);
        
        const imgHtml = imgUrl 
            ? `<div class="promo-img-container w-full h-44 sm:h-48 bg-devo-black relative shrink-0 flex items-center justify-center p-2 border-b border-devo-gray/30 overflow-hidden">
                <img src="${imgUrl}" class="promo-blur-bg absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-40 pointer-events-none" aria-hidden="true" onerror="this.style.display='none'">
                <div class="absolute inset-0 bg-devo-black/20 backdrop-blur-sm pointer-events-none"></div>
                <img src="${imgUrl}" class="promo-main-img relative z-10 w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" loading="lazy" onload="window.detectPromoImageAspect(this, '${card.id}')">
               </div>`
            : `<div class="promo-img-container w-full h-44 sm:h-48 bg-devo-black relative shrink-0 flex items-center justify-center text-devo-gray/30 border-b border-devo-gray/30"><i class="ph ${card.icon || 'ph-image'} text-5xl"></i></div>`;

        const clickAction = card.model_id 
            ? `openPromoModelLink('${card.model_id}')` 
            : `switchSiteView('view-gallery')`;

        return `
        <div id="promo-card-${card.id}" class="w-full bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden card-hover transition-all duration-300 flex flex-col relative group cursor-pointer h-72 sm:h-80 shadow-lg" onclick="${clickAction}">
            ${card.badge_text ? `<div class="absolute top-3 right-3 ${card.badge_color || 'bg-devo-orange'} text-white text-xs font-bold px-3 py-1 rounded-lg shadow-lg z-20">${card.badge_text}</div>` : ''}
            
            ${imgHtml}
            
            <div class="promo-text-container p-4 sm:p-5 flex flex-col justify-between flex-1 h-full min-w-0 bg-devo-dark relative z-10">
                <div>
                    <h3 class="text-white font-bold text-base sm:text-lg mb-1.5 group-hover:text-devo-orange transition-colors line-clamp-2">${card.title}</h3>
                    <p class="text-devo-muted text-xs sm:text-sm leading-relaxed line-clamp-2 sm:line-clamp-3 mb-2">${card.description || ''}</p>
                </div>
                
                <div class="flex items-center gap-1.5 text-devo-orange text-xs font-bold mt-auto group-hover:-translate-x-1 transition-transform">
                    <span>${card.model_id ? 'عرض الموديل المرتبط' : 'تصفح المعرض'}</span>
                    <i class="ph ph-arrow-left text-sm"></i>
                </div>
            </div>
        </div>
        `;
    }).join('');

    setTimeout(() => {
        container.querySelectorAll('.promo-main-img').forEach(img => {
            if (img.complete) {
                const cardId = img.closest('[id^="promo-card-"]')?.id?.replace('promo-card-', '');
                if (cardId) window.detectPromoImageAspect(img, cardId);
            }
        });
    }, 100);
}