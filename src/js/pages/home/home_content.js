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

// جلب الإعدادات (نصوص، صور، سوشيال ميديا) مع الكاش الفوري
async function loadHeroSettings() {
    // ⚡ 1. التحميل الفوري السريع من الكاش (0ms Instant Load) ⚡
    const cachedMap = localStorage.getItem('devo_cached_hero_settings');
    if (cachedMap) {
        try {
            applyHeroSettingsMap(JSON.parse(cachedMap));
        } catch (e) {}
    }

    // 🔄 2. الجلب التحديثي من السيرفر في الخلفية 🔄
    const { data, error } = await supabase.from('home_settings').select('*');
    if (error || !data) return;

    const map = {};
    data.forEach(item => map[item.setting_key] = item.setting_value);

    applyHeroSettingsMap(map);
    try {
        localStorage.setItem('devo_cached_hero_settings', JSON.stringify(map));
    } catch (e) {}
}

function applyHeroSettingsMap(map) {
    if (!map) return;

    // 1. حقن النصوص وتحديد ألوانها المخصصة
    const titleEl = document.getElementById('display-hero-title');
    const subtitleEl = document.getElementById('display-hero-subtitle');
    const titleColor = map['hero_title_color'] || '#ffffff';
    const subtitleColor = map['hero_subtitle_color'] || '#a3a3a3';

    if (titleEl && map['hero_title']) {
        titleEl.innerHTML = map['hero_title'];
        titleEl.style.setProperty('color', titleColor, 'important');
    }
    if (subtitleEl && map['hero_subtitle']) {
        subtitleEl.innerHTML = map['hero_subtitle'];
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

    // 5. تطبيق خلفية البانر الرئيسي على الأقسام الأُخرى المفعّلة
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

    // 🌟 1. الصورة طويلة (Portrait: ratio < 1.15) -> الكارت يكون جانبـي بارتفاع موحد متناسق وتصميم فخم 🌟
    if (ratio < 1.15) {
        cardEl.className = "w-[82vw] md:w-full bg-gradient-to-br from-devo-dark to-devo-dark/95 border border-devo-gray/50 rounded-2xl overflow-hidden card-hover transition-all duration-500 flex flex-row relative group cursor-pointer h-52 sm:h-60 shadow-md hover:shadow-xl hover:shadow-devo-orange/5 hover:-translate-y-1 hover:scale-[1.015] active:scale-[0.98] snap-center shrink-0";
        
        if (imgWrapper) {
            imgWrapper.className = "promo-img-container w-1/3 sm:w-2/5 h-full bg-devo-gray/10 relative shrink-0 flex items-center justify-center p-2.5 border-l border-devo-gray/30 overflow-hidden";
        }
        if (textWrapper) {
            textWrapper.className = "promo-text-container p-3.5 sm:p-4 flex flex-col justify-between flex-1 h-full min-w-0 relative z-10";
        }
    } 
    // 🌟 2. الصورة عريضة (Landscape: ratio >= 1.15) -> الكارت يكون رأسي بارتفاع موحد متناسق وتصميم فخم 🌟
    else {
        cardEl.className = "w-[82vw] md:w-full bg-gradient-to-br from-devo-dark to-devo-dark/95 border border-devo-gray/50 rounded-2xl overflow-hidden card-hover transition-all duration-500 flex flex-col relative group cursor-pointer h-72 sm:h-80 shadow-md hover:shadow-xl hover:shadow-devo-orange/5 hover:-translate-y-1 hover:scale-[1.015] active:scale-[0.98] snap-center shrink-0";
        
        if (imgWrapper) {
            imgWrapper.className = "promo-img-container w-full h-36 sm:h-40 bg-devo-gray/10 relative shrink-0 flex items-center justify-center p-3 border-b border-devo-gray/30 overflow-hidden";
        }
        if (textWrapper) {
            textWrapper.className = "promo-text-container p-3.5 sm:p-4 flex flex-col justify-between flex-1 h-full min-w-0 relative z-10";
        }
    }
};

// 🌟 تفاعل الميلان ثلاثي الأبعاد والتحريك البارلاكس للكروت 🌟
function initPromoCardsTilt() {
    // تعطيل تفاعل الـ 3D Tilt على شاشات اللمس لتفادي تعليق الحركة أو التأثير على سكرول الصفحة
    if (!window.matchMedia('(hover: hover)').matches) return;
    
    const cards = document.querySelectorAll('[id^="promo-card-"]');
    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            
            const rotateX = ((centerY - y) / centerY) * 5; 
            const rotateY = ((x - centerX) / centerX) * 5;
            
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px) scale(1.015)`;
            card.style.transition = 'transform 0.1s ease';
            
            const img = card.querySelector('.promo-main-img');
            if (img) {
                const imgMoveX = ((centerX - x) / centerX) * 3;
                const imgMoveY = ((centerY - y) / centerY) * 3;
                img.style.transform = `scale(1.04) translate(${imgMoveX}px, ${imgMoveY}px)`;
                img.style.transition = 'transform 0.1s ease';
            }
        });
        
        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            card.style.transition = 'transform 0.5s ease-out';
            
            const img = card.querySelector('.promo-main-img');
            if (img) {
                img.style.transform = '';
                img.style.transition = 'transform 0.5s ease-out';
            }
        });
    });
}

// جلب الكروت الإعلانية بتصميم احترافي موحد الأحجام مع الكاش الفوري
async function loadPromoCards() {
    const container = document.getElementById('display-promo-cards');
    if (!container) return;

    // ⚡ 1. التحميل الفوري السريع من الكاش (0ms Instant Load) ⚡
    const cachedCards = localStorage.getItem('devo_cached_promo_cards');
    if (cachedCards) {
        try {
            renderPromoCardsUI(JSON.parse(cachedCards), container);
        } catch (e) {}
    }

    // 🔄 2. الجلب التحديثي من السيرفر في الخلفية 🔄
    const { data, error } = await supabase.from('promo_cards').select('*').eq('is_active', true).order('created_at', { ascending: true });

    if (error || !data) return;

    renderPromoCardsUI(data, container);
    try {
        localStorage.setItem('devo_cached_promo_cards', JSON.stringify(data));
    } catch (e) {}
}

function renderPromoCardsUI(data, container) {
    if (!container) return;
    if (!data || data.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = data.map(card => {
        const imgUrl = resolveImageUrl(card.image_url);
        
        const imgHtml = imgUrl 
            ? `<div class="promo-img-container w-full h-36 sm:h-40 bg-devo-gray/10 relative shrink-0 flex items-center justify-center p-3 border-b border-devo-gray/30 overflow-hidden">
                <img src="${imgUrl}" class="promo-blur-bg animate-drift absolute inset-0 w-full h-full object-cover blur-md scale-125 opacity-60 pointer-events-none" aria-hidden="true" onerror="this.style.display='none'" loading="lazy" decoding="async">
                <div class="absolute inset-0 bg-black/10 backdrop-blur-[2px] pointer-events-none"></div>
                <div class="w-full h-full transition-transform duration-700 ease-out group-hover:scale-[1.06] flex items-center justify-center relative z-10">
                    <img src="${imgUrl}" class="promo-main-img max-w-full max-h-full w-auto h-auto object-contain rounded-lg border border-devo-gray/50 shadow-md animate-kenburns" loading="lazy" decoding="async" onload="window.detectPromoImageAspect(this, '${card.id}')">
                </div>
               </div>`
            : `<div class="promo-img-container w-full h-36 sm:h-40 bg-devo-gray/10 relative shrink-0 flex items-center justify-center text-devo-gray/30 border-b border-devo-gray/30"><i class="ph ${card.icon || 'ph-image'} text-5xl"></i></div>`;

        const clickAction = card.model_id 
            ? `openPromoModelLink('${card.model_id}')` 
            : `switchSiteView('view-gallery')`;

        const lines = card.description ? card.description.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];
        let descHtml = '';
        if (lines.length > 1) {
            descHtml = `<ul class="text-devo-muted text-[11px] sm:text-xs leading-normal space-y-1.5 flex flex-col items-start w-full list-none">` + 
                lines.map(line => `<li class="flex items-start gap-1.5 text-right w-full"><i class="ph ph-caret-left text-devo-orange text-xs shrink-0 mt-[2.5px] transition-transform group-hover:-translate-x-0.5"></i><span class="line-clamp-2">${line}</span></li>`).join('') + 
                `</ul>`;
        } else {
            descHtml = `<p class="text-devo-muted text-[11px] sm:text-xs leading-relaxed line-clamp-2 sm:line-clamp-3 text-right w-full">${card.description || ''}</p>`;
        }

        return `
        <div id="promo-card-${card.id}" class="w-[82vw] md:w-full bg-gradient-to-br from-devo-dark to-devo-dark/95 border border-devo-gray/50 rounded-2xl overflow-hidden card-hover transition-all duration-500 flex flex-col relative group cursor-pointer h-72 sm:h-80 shadow-md hover:shadow-xl hover:shadow-devo-orange/5 hover:-translate-y-1 hover:scale-[1.015] active:scale-[0.98] snap-center shrink-0" onclick="${clickAction}">
            ${card.badge_text ? `<div class="absolute top-3 right-3 ${card.badge_color || 'bg-devo-orange'} text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-lg z-20 transition-transform duration-300 group-hover:scale-105">${card.badge_text}</div>` : ''}
            
            <!-- Glass Shine Effect -->
            <div class="absolute inset-0 w-2/3 h-full bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0)_20%,rgba(255,255,255,0.45)_40%,rgba(255,255,255,0.1)_50%,rgba(255,255,255,0.65)_55%,rgba(255,255,255,0)_70%,transparent_100%)] -skew-x-20 -translate-x-[150%] group-hover:translate-x-[250%] transition-transform duration-[1300ms] ease-out pointer-events-none z-30"></div>
            
            ${imgHtml}
            
            <div class="promo-text-container p-3.5 sm:p-4 flex flex-col justify-between flex-1 h-full min-w-0 relative z-10">
                <h3 class="text-devo-text font-bold text-sm sm:text-base mb-1 group-hover:text-devo-orange transition-colors line-clamp-2 shrink-0 leading-tight">${card.title}</h3>
                
                <div class="flex-1 flex flex-col justify-center my-2 overflow-hidden w-full">
                    ${descHtml}
                </div>
                
                <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-devo-orange/10 text-devo-orange border border-devo-orange/20 text-[10px] sm:text-xs font-bold transition-all duration-500 group-hover:bg-devo-orange group-hover:text-white group-hover:border-devo-orange group-hover:shadow-[0_4px_12px_rgba(249,115,22,0.25)] w-fit mt-auto shrink-0">
                    <span>${card.model_id ? 'عرض الموديل' : 'تصفح المعرض'}</span>
                    <i class="ph ph-arrow-left text-xs transition-transform duration-500 group-hover:-translate-x-1"></i>
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
        
        // تفعيل حركة الـ 3D Tilt للكروت بعد رندرتها
        initPromoCardsTilt();
    }, 100);
}