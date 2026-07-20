import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { HEADER_LAYOUTS } from '../home/header_layouts.js';
import { FOOTER_LAYOUTS } from '../home/footer_layouts.js';

let isInitialized = false;
let promoCards = [];
let currentSettings = {}; // كاش لإعدادات الموقع الحالية

// --- دالة معالجة روابط درايف ---
function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return '';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w400`;
        }
    } catch (e) {}
    return url; 
}

export async function initHomeSettingsView() {
    if (isInitialized) return;

    await loadHeroSettings();
    await loadPromoCards();

    document.getElementById('promo-form')?.addEventListener('submit', handleSavePromo);

    isInitialized = true;
}

// ==========================================
// 1. Hero Settings Logic + Layout Settings
// ==========================================

async function loadHeroSettings() {
    const { data, error } = await supabase.from('home_settings').select('*');
    if (error || !data) return;

    const map = {};
    data.forEach(item => map[item.setting_key] = item.setting_value);
    currentSettings = map; // كاش للاستخدام لاحقاً

    if (document.getElementById('hs-hero-title')) {
        document.getElementById('hs-hero-title').value = map['hero_title'] || '';
        document.getElementById('hs-hero-subtitle').value = map['hero_subtitle'] || '';
        document.getElementById('hs-bg-desktop').value = map['hero_bg_desktop'] || '';
        document.getElementById('hs-bg-mobile').value = map['hero_bg_mobile'] || '';
        document.getElementById('hs-social-fb').value = map['social_facebook'] || '';
        document.getElementById('hs-social-wa').value = map['social_whatsapp'] || '';
        if (document.getElementById('hs-social-tg')) document.getElementById('hs-social-tg').value = map['social_telegram'] || '';
        document.getElementById('hs-social-maps').value = map['social_maps'] || '';

        // الخيارات المتقدمة لخلفية الهيرو
        if (document.getElementById('hs-bg-show')) document.getElementById('hs-bg-show').value = map['hero_bg_show'] || 'true';
        if (document.getElementById('hs-bg-blend')) document.getElementById('hs-bg-blend').value = map['hero_bg_blend'] || 'normal';
        if (document.getElementById('hs-bg-glass')) document.getElementById('hs-bg-glass').value = map['hero_bg_glass'] || 'soft';
        if (document.getElementById('hs-title-color')) document.getElementById('hs-title-color').value = map['hero_title_color'] || '#ffffff';
        if (document.getElementById('hs-subtitle-color')) document.getElementById('hs-subtitle-color').value = map['hero_subtitle_color'] || '#a3a3a3';
        if (document.getElementById('hs-bg-edge-feather')) document.getElementById('hs-bg-edge-feather').value = map['hero_bg_edge_feather'] || '25';
        if (document.getElementById('hs-bg-opacity')) document.getElementById('hs-bg-opacity').value = map['hero_bg_opacity'] || '100';
        if (document.getElementById('hs-bg-overlay')) document.getElementById('hs-bg-overlay').value = map['hero_bg_overlay_opacity'] || '40';
        if (document.getElementById('hs-bg-blur')) document.getElementById('hs-bg-blur').value = map['hero_bg_blur'] || '0';
        if (document.getElementById('hs-glass-opacity')) document.getElementById('hs-glass-opacity').value = map['hero_glass_opacity'] || '30';
        if (document.getElementById('hs-glass-blur')) document.getElementById('hs-glass-blur').value = map['hero_glass_blur'] || '12';

        // خيارات تفعيل الخلفية في صفحات الموقع المختلفة
        if (document.getElementById('hs-bg-enable-gallery')) document.getElementById('hs-bg-enable-gallery').value = map['bg_enable_gallery'] || 'false';
        if (document.getElementById('hs-bg-enable-barcode')) document.getElementById('hs-bg-enable-barcode').value = map['bg_enable_barcode'] || 'false';
        if (document.getElementById('hs-bg-enable-cart')) document.getElementById('hs-bg-enable-cart').value = map['bg_enable_cart'] || 'false';
        if (document.getElementById('hs-bg-enable-orders')) document.getElementById('hs-bg-enable-orders').value = map['bg_enable_orders'] || 'false';
    }

    // تعبئة قوائم خيارات الهيدر والفوتر
    populateHeaderFooterSelectors(map['header_layout'] || 'classic', map['footer_layout'] || 'simple');

    // ربط وتفعيل المعاينة الحية في لوحة الإدارة
    setupHeroPreviewListeners();
    updateAdminHeroPreview();
}

// ==========================================
// دالة تحديث المعاينة الحية المباشرة في أدمن
// ==========================================
function updateAdminHeroPreview() {
    const desktopImg = resolveImageUrl(document.getElementById('hs-bg-desktop')?.value);
    const mobileImg = resolveImageUrl(document.getElementById('hs-bg-mobile')?.value);
    const bgUrl = desktopImg || mobileImg;

    const showBg = document.getElementById('hs-bg-show')?.value === 'true';
    const blendMode = document.getElementById('hs-bg-blend')?.value || 'normal';
    const glassMode = document.getElementById('hs-bg-glass')?.value || 'soft';
    const titleColor = document.getElementById('hs-title-color')?.value || '#ffffff';
    const subtitleColor = document.getElementById('hs-subtitle-color')?.value || '#a3a3a3';
    const edgeFeather = document.getElementById('hs-bg-edge-feather')?.value || '25';
    const opacity = document.getElementById('hs-bg-opacity')?.value || '100';
    const overlay = document.getElementById('hs-bg-overlay')?.value || '40';
    const blur = document.getElementById('hs-bg-blur')?.value || '0';
    const glassOpacity = document.getElementById('hs-glass-opacity')?.value || '30';
    const glassBlur = document.getElementById('hs-glass-blur')?.value || '12';

    // تحديث أرقام ونصوص المؤشرات
    if (document.getElementById('hs-title-color-text')) document.getElementById('hs-title-color-text').textContent = titleColor;
    if (document.getElementById('hs-subtitle-color-text')) document.getElementById('hs-subtitle-color-text').textContent = subtitleColor;
    if (document.getElementById('hs-bg-edge-feather-val')) document.getElementById('hs-bg-edge-feather-val').textContent = `${edgeFeather}%`;
    if (document.getElementById('hs-bg-opacity-val')) document.getElementById('hs-bg-opacity-val').textContent = `${opacity}%`;
    if (document.getElementById('hs-bg-overlay-val')) document.getElementById('hs-bg-overlay-val').textContent = `${overlay}%`;
    if (document.getElementById('hs-bg-blur-val')) document.getElementById('hs-bg-blur-val').textContent = `${blur}px`;
    if (document.getElementById('hs-glass-opacity-val')) document.getElementById('hs-glass-opacity-val').textContent = `${glassOpacity}%`;
    if (document.getElementById('hs-glass-blur-val')) document.getElementById('hs-glass-blur-val').textContent = `${glassBlur}px`;

    // 1. طبقة الصورة
    const prevImg = document.getElementById('admin-hero-prev-img');
    if (prevImg) {
        if (showBg && bgUrl) {
            prevImg.style.display = 'block';
            prevImg.style.backgroundImage = `url('${bgUrl}')`;
            prevImg.style.opacity = (parseInt(opacity) / 100).toString();
            prevImg.style.filter = `blur(${blur}px)`;
            prevImg.style.mixBlendMode = blendMode;
        } else {
            prevImg.style.display = 'none';
        }
    }

    // 2. طبقة التغميق
    const prevOverlay = document.getElementById('admin-hero-prev-overlay');
    if (prevOverlay) {
        prevOverlay.style.backgroundColor = `rgba(0, 0, 0, ${parseInt(overlay) / 100})`;
    }

    // 3. طبقات الدمج العلوية والسفلية Edge Merging Fades
    const prevTopFade = document.getElementById('admin-hero-prev-top-fade');
    const prevBottomFade = document.getElementById('admin-hero-prev-bottom-fade');
    const featherPercent = parseInt(edgeFeather);
    if (prevTopFade) {
        prevTopFade.style.height = `${featherPercent}%`;
        prevTopFade.style.backgroundImage = 'linear-gradient(to bottom, #0a0a0a, transparent)';
    }
    if (prevBottomFade) {
        prevBottomFade.style.height = `${featherPercent}%`;
        prevBottomFade.style.backgroundImage = 'linear-gradient(to top, #0a0a0a, transparent)';
    }

    // 4. كارت المحتوى الزجاجي
    const prevCard = document.getElementById('admin-hero-prev-card');
    if (prevCard) {
        if (glassMode !== 'none') {
            const opacityRatio = parseInt(glassOpacity) / 100;
            const bgAlpha = glassMode === 'heavy' ? Math.min(0.9, opacityRatio + 0.3) : opacityRatio;
            prevCard.style.backgroundColor = `rgba(0, 0, 0, ${bgAlpha})`;
            prevCard.style.backdropFilter = `blur(${glassBlur}px)`;
            prevCard.style.webkitBackdropFilter = `blur(${glassBlur}px)`;
            prevCard.style.border = `1px solid rgba(255, 255, 255, ${Math.min(0.25, opacityRatio * 0.5)})`;
            prevCard.style.boxShadow = `0 10px 40px rgba(0, 0, 0, ${Math.min(0.6, opacityRatio + 0.2)})`;
        } else {
            prevCard.style.backgroundColor = 'transparent';
            prevCard.style.backdropFilter = 'none';
            prevCard.style.webkitBackdropFilter = 'none';
            prevCard.style.border = 'none';
            prevCard.style.boxShadow = 'none';
        }
    }

    // 5. النصوص والألوان
    const titleVal = document.getElementById('hs-hero-title')?.value.trim();
    const subtitleVal = document.getElementById('hs-hero-subtitle')?.value.trim();
    const prevTitle = document.getElementById('admin-hero-prev-title');
    const prevSubtitle = document.getElementById('admin-hero-prev-subtitle');

    if (prevTitle) {
        prevTitle.textContent = titleVal || 'العنوان الرئيسي';
        prevTitle.style.color = titleColor;
    }
    if (prevSubtitle) {
        prevSubtitle.textContent = subtitleVal || 'الوصف المكتوب في حقل النص الفرعي اعلاه';
        prevSubtitle.style.color = subtitleColor;
    }
}

function setupHeroPreviewListeners() {
    const ids = [
        'hs-hero-title', 'hs-hero-subtitle', 'hs-bg-desktop', 'hs-bg-mobile',
        'hs-bg-show', 'hs-bg-blend', 'hs-bg-glass', 'hs-title-color', 'hs-subtitle-color',
        'hs-bg-edge-feather', 'hs-bg-opacity', 'hs-bg-overlay', 'hs-bg-blur',
        'hs-glass-opacity', 'hs-glass-blur', 'hs-bg-enable-gallery', 'hs-bg-enable-barcode',
        'hs-bg-enable-cart', 'hs-bg-enable-orders'
    ];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.removeEventListener('input', updateAdminHeroPreview);
            el.removeEventListener('change', updateAdminHeroPreview);
            el.addEventListener('input', updateAdminHeroPreview);
            el.addEventListener('change', updateAdminHeroPreview);
        }
    });
}

// ==========================================
// 2. Header & Footer Layout Selectors UI
// ==========================================

function populateHeaderFooterSelectors(activeHeaderId, activeFooterId) {
    const headerSelect = document.getElementById('hs-header-layout');
    const footerSelect = document.getElementById('hs-footer-layout');

    if (headerSelect) {
        headerSelect.innerHTML = HEADER_LAYOUTS.map(l => 
            `<option value="${l.id}" ${l.id === activeHeaderId ? 'selected' : ''}>${l.name}</option>`
        ).join('');
    }

    if (footerSelect) {
        footerSelect.innerHTML = FOOTER_LAYOUTS.map(l => 
            `<option value="${l.id}" ${l.id === activeFooterId ? 'selected' : ''}>${l.name}</option>`
        ).join('');
    }
}

window.saveHeaderFooterLayouts = async () => {
    const btn = document.getElementById('btn-save-header-footer');
    if (!btn) return;

    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    try {
        const headerVal = document.getElementById('hs-header-layout')?.value || 'classic';
        const footerVal = document.getElementById('hs-footer-layout')?.value || 'simple';

        const updates = [
            { setting_key: 'header_layout', setting_value: headerVal },
            { setting_key: 'footer_layout', setting_value: footerVal }
        ];

        const { error } = await supabase.from('home_settings').upsert(updates, { onConflict: 'setting_key' });
        if (error) throw error;

        currentSettings.header_layout = headerVal;
        currentSettings.footer_layout = footerVal;

        showToast('تم حفظ تصميم الهيدر والفوتر بنجاح ✓', 'success');
    } catch (err) {
        showToast('حدث خطأ أثناء الحفظ: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
};

// ==========================================
// 4. General Hero / Social Settings
// ==========================================

window.saveHeroSettings = async () => {
    const btn = document.getElementById('btn-save-hero');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    try {
        const updates = [
            { setting_key: 'hero_title', setting_value: document.getElementById('hs-hero-title').value.trim() },
            { setting_key: 'hero_subtitle', setting_value: document.getElementById('hs-hero-subtitle').value.trim() },
            { setting_key: 'hero_bg_desktop', setting_value: document.getElementById('hs-bg-desktop').value.trim() },
            { setting_key: 'hero_bg_mobile', setting_value: document.getElementById('hs-bg-mobile').value.trim() },
            { setting_key: 'social_facebook', setting_value: document.getElementById('hs-social-fb').value.trim() },
            { setting_key: 'social_whatsapp', setting_value: document.getElementById('hs-social-wa').value.trim() },
            { setting_key: 'social_telegram', setting_value: (document.getElementById('hs-social-tg')?.value || '').trim() },
            { setting_key: 'social_maps', setting_value: document.getElementById('hs-social-maps').value.trim() },
            
            // خصائص التحكم المتقدمة في الخلفية والنصوص
            { setting_key: 'hero_bg_show', setting_value: document.getElementById('hs-bg-show')?.value || 'true' },
            { setting_key: 'hero_bg_blend', setting_value: document.getElementById('hs-bg-blend')?.value || 'normal' },
            { setting_key: 'hero_bg_glass', setting_value: document.getElementById('hs-bg-glass')?.value || 'soft' },
            { setting_key: 'hero_title_color', setting_value: document.getElementById('hs-title-color')?.value || '#ffffff' },
            { setting_key: 'hero_subtitle_color', setting_value: document.getElementById('hs-subtitle-color')?.value || '#a3a3a3' },
            { setting_key: 'hero_bg_edge_feather', setting_value: document.getElementById('hs-bg-edge-feather')?.value || '25' },
            { setting_key: 'hero_bg_opacity', setting_value: document.getElementById('hs-bg-opacity')?.value || '100' },
            { setting_key: 'hero_bg_overlay_opacity', setting_value: document.getElementById('hs-bg-overlay')?.value || '40' },
            { setting_key: 'hero_bg_blur', setting_value: document.getElementById('hs-bg-blur')?.value || '0' },
            { setting_key: 'hero_glass_opacity', setting_value: document.getElementById('hs-glass-opacity')?.value || '30' },
            { setting_key: 'hero_glass_blur', setting_value: document.getElementById('hs-glass-blur')?.value || '12' },
            
            // خيارات تفعيل الخلفية في بقية الصفحات
            { setting_key: 'bg_enable_gallery', setting_value: document.getElementById('hs-bg-enable-gallery')?.value || 'false' },
            { setting_key: 'bg_enable_barcode', setting_value: document.getElementById('hs-bg-enable-barcode')?.value || 'false' },
            { setting_key: 'bg_enable_cart', setting_value: document.getElementById('hs-bg-enable-cart')?.value || 'false' },
            { setting_key: 'bg_enable_orders', setting_value: document.getElementById('hs-bg-enable-orders')?.value || 'false' }
        ];

        const { error } = await supabase.from('home_settings').upsert(updates, { onConflict: 'setting_key' });
        if (error) throw error;

        showToast('تم تحديث إعدادات الموقع بنجاح', 'success');
    } catch (error) {
        showToast('حدث خطأ أثناء الحفظ', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-floppy-disk"></i> حفظ الإعدادات`;
    }
};

// ==========================================
// 2. Promo Cards Logic
// ==========================================
async function loadPromoCards() {
    const container = document.getElementById('promo-cards-container');
    container.innerHTML = `<div class="col-span-full py-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-info"></i></div>`;

    const { data, error } = await supabase.from('promo_cards').select('*').order('created_at', { ascending: true });
    
    if (error) {
        container.innerHTML = `<div class="col-span-full text-center text-devo-error">خطأ في تحميل الكروت</div>`;
        return;
    }

    promoCards = data;
    renderPromoCards();
}

function renderPromoCards() {
    const container = document.getElementById('promo-cards-container');
    if (promoCards.length === 0) {
        container.innerHTML = `<div class="col-span-full py-8 text-center text-devo-muted border border-dashed border-devo-gray rounded-xl">لا توجد كروت إعلانية مسجلة. اضغط على إضافة عرض جديد.</div>`;
        return;
    }

    // هنا يتم رسم صورة الكارت إن وجدت بدلاً من الأيقونة فقط
    container.innerHTML = promoCards.map(card => {
        const imgUrl = resolveImageUrl(card.image_url);
        const imgHtml = imgUrl 
            ? `<img src="${imgUrl}" class="w-12 h-12 rounded-lg object-cover border border-devo-gray shrink-0">` 
            : `<div class="w-12 h-12 rounded-lg bg-devo-gray flex items-center justify-center text-white shrink-0"><i class="ph ph-star text-xl"></i></div>`;

        return `
        <div class="bg-devo-black border border-devo-gray rounded-xl p-4 relative flex flex-col transition-colors hover:border-devo-info ${!card.is_active ? 'opacity-50 grayscale' : ''}">
            ${card.badge_text ? `<span class="absolute top-0 right-0 ${card.badge_color} text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg rounded-tr-xl">${card.badge_text}</span>` : ''}
            
            <div class="flex items-start gap-3 mt-2">
                ${imgHtml}
                <div>
                    <h4 class="text-white font-bold text-sm leading-tight mb-1">${card.title}</h4>
                    <p class="text-devo-muted text-xs leading-relaxed line-clamp-2">${card.description}</p>
                </div>
            </div>

            <div class="flex justify-end gap-2 mt-4 pt-3 border-t border-devo-gray">
                <button onclick="openPromoModal('${card.id}')" class="text-devo-info hover:bg-devo-info/10 p-1.5 rounded transition-colors" title="تعديل"><i class="ph ph-pencil-simple text-lg"></i></button>
                <button onclick="deletePromoCard('${card.id}')" class="text-devo-error hover:bg-devo-error/10 p-1.5 rounded transition-colors" title="حذف"><i class="ph ph-trash text-lg"></i></button>
            </div>
        </div>
        `;
    }).join('');
}

window.openPromoModal = async (id = null) => {
    const form = document.getElementById('promo-form');
    form.reset();
    document.getElementById('pm-id').value = id || '';
    document.getElementById('promo-modal-title').textContent = id ? 'تعديل العرض' : 'إضافة عرض جديد';

    // تعبئة قائمة الموديلات المتاحة للربط
    const modelSelect = document.getElementById('pm-model-id');
    if (modelSelect) {
        modelSelect.innerHTML = `<option value="">جاري تحميل الموديلات...</option>`;
        try {
            const { data: models } = await supabase
                .from('models')
                .select('id, name, factory_code, system_code')
                .eq('is_active', true)
                .order('name', { ascending: true });

            let options = `<option value="">-- بدون ربط (تصفح المعرض فقط) --</option>`;
            if (models && models.length > 0) {
                options += models.map(m => `<option value="${m.id}">[${m.factory_code || m.system_code || 'موديل'}] ${m.name}</option>`).join('');
            }
            modelSelect.innerHTML = options;
        } catch (e) {
            modelSelect.innerHTML = `<option value="">-- بدون ربط --</option>`;
        }
    }

    if (id) {
        const card = promoCards.find(c => c.id === id);
        if (card) {
            document.getElementById('pm-title').value = card.title;
            document.getElementById('pm-desc').value = card.description;
            if (document.getElementById('pm-image')) document.getElementById('pm-image').value = card.image_url || '';
            if (modelSelect) modelSelect.value = card.model_id || '';
            document.getElementById('pm-badge').value = card.badge_text || '';
            document.getElementById('pm-color').value = card.badge_color || 'bg-devo-orange';
            document.getElementById('pm-status').checked = card.is_active;
        }
    } else {
        document.getElementById('pm-status').checked = true;
    }

    const modal = document.getElementById('promo-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closePromoModal = () => {
    const modal = document.getElementById('promo-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

async function handleSavePromo(e) {
    e.preventDefault();
    const id = document.getElementById('pm-id').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;

    const selectedModelId = document.getElementById('pm-model-id')?.value || null;

    const payload = {
        title: document.getElementById('pm-title').value.trim(),
        description: document.getElementById('pm-desc').value.trim(),
        image_url: document.getElementById('pm-image') ? document.getElementById('pm-image').value.trim() : null,
        model_id: selectedModelId,
        badge_text: document.getElementById('pm-badge').value.trim() || null,
        badge_color: document.getElementById('pm-color').value,
        is_active: document.getElementById('pm-status').checked
    };

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> حفظ...`;

    try {
        if (id) {
            const { error } = await supabase.from('promo_cards').update(payload).eq('id', id);
            if (error) {
                if (error.message && error.message.includes('model_id')) {
                    delete payload.model_id;
                    const { error: err2 } = await supabase.from('promo_cards').update(payload).eq('id', id);
                    if (err2) throw err2;
                    showToast('تم الحفظ، لتشغيل ربط الموديل يرجى إضافة عمود model_id في جدول promo_cards', 'warning');
                } else throw error;
            }
        } else {
            const { error } = await supabase.from('promo_cards').insert([payload]);
            if (error) {
                if (error.message && error.message.includes('model_id')) {
                    delete payload.model_id;
                    const { error: err2 } = await supabase.from('promo_cards').insert([payload]);
                    if (err2) throw err2;
                    showToast('تم الحفظ، لتشغيل ربط الموديل يرجى إضافة عمود model_id في جدول promo_cards', 'warning');
                } else throw error;
            }
        }
        showToast('تم حفظ الكارت الإعلاني بنجاح', 'success');
        closePromoModal();
        loadPromoCards();
    } catch (error) {
        showToast('حدث خطأ أثناء الحفظ', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

window.deletePromoCard = async (id) => {
    const confirmed = await confirmDialog({ title: 'حذف العرض', message: 'هل أنت متأكد من حذف هذا الكارت الإعلاني؟', isDestructive: true });
    if (!confirmed) return;

    const { error } = await supabase.from('promo_cards').delete().eq('id', id);
    if (error) {
        showToast('حدث خطأ أثناء الحذف', 'error');
    } else {
        showToast('تم الحذف بنجاح', 'success');
        loadPromoCards();
    }
};