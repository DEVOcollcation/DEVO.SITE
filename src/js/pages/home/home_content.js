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

    // 1. حقن النصوص
    if (document.getElementById('display-hero-title')) document.getElementById('display-hero-title').innerHTML = map['hero_title'] || 'DEVO';
    if (document.getElementById('display-hero-subtitle')) document.getElementById('display-hero-subtitle').innerHTML = map['hero_subtitle'] || '';

    // 2. حقن السوشيال ميديا
    if (document.getElementById('link-facebook')) document.getElementById('link-facebook').href = map['social_facebook'] || '#';
    if (document.getElementById('link-whatsapp')) document.getElementById('link-whatsapp').href = map['social_whatsapp'] || '#';
    if (document.getElementById('link-maps')) document.getElementById('link-maps').href = map['social_maps'] || '#';

    // 3. هندسة الصور المتجاوبة (Desktop vs Mobile)
    const desktopImg = resolveImageUrl(map['hero_bg_desktop']);
    const mobileImg = resolveImageUrl(map['hero_bg_mobile']);

    if (desktopImg || mobileImg) {
        // إنشاء ستايل ديناميكي يغير الصورة حسب حجم الشاشة
        const styleId = 'dynamic-hero-bg-style';
        let styleTag = document.getElementById(styleId);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = styleId;
            document.head.appendChild(styleTag);
        }

        // الصورة الافتراضية هي الموبايل، وتتغير في الشاشات الأكبر من 768px للديسكتوب
        styleTag.innerHTML = `
            .hero-bg {
                background-image: linear-gradient(to bottom, rgba(10,10,10,0.5), rgba(10,10,10,1)), url('${mobileImg || desktopImg}');
            }
            @media (min-width: 768px) {
                .hero-bg {
                    background-image: linear-gradient(to bottom, rgba(10,10,10,0.5), rgba(10,10,10,1)), url('${desktopImg || mobileImg}');
                }
            }
        `;
    }
}

// جلب الكروت الإعلانية بتصميم احترافي (Banner Style)
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
        
        // إذا كان هناك صورة نعرضها كبانر علوي، وإلا نعرض خلفية داكنة مع الأيقونة
        const imgHtml = imgUrl 
            ? `<img src="${imgUrl}" class="w-full h-48 object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy">`
            : `<div class="w-full h-48 bg-devo-black flex items-center justify-center text-devo-gray/30"><i class="ph ${card.icon || 'ph-image'} text-6xl"></i></div>`;

        return `
        <div class="bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden card-hover transition-all flex flex-col relative group cursor-pointer" onclick="switchSiteView('view-gallery')">
            ${card.badge_text ? `<div class="absolute top-3 right-3 ${card.badge_color || 'bg-devo-orange'} text-white text-[10px] font-bold px-3 py-1 rounded shadow-lg z-20">${card.badge_text}</div>` : ''}
            
            <div class="relative overflow-hidden border-b border-devo-gray">
                ${imgHtml}
                <div class="absolute inset-0 bg-gradient-to-t from-devo-dark to-transparent opacity-90 z-10"></div>
            </div>
            
            <div class="p-6 flex flex-col flex-1 relative z-20 -mt-10">
                <h3 class="text-white font-bold text-lg mb-2 group-hover:text-devo-orange transition-colors">${card.title}</h3>
                <p class="text-devo-muted text-sm leading-relaxed">${card.description || ''}</p>
            </div>
        </div>
        `;
    }).join('');
}