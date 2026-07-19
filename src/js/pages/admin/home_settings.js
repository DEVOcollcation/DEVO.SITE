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
        document.getElementById('hs-social-maps').value = map['social_maps'] || '';
    }

    // تعيين قيم الإعدادات المتقدمة للهيدر
    const heightEl = document.getElementById('hs-header-height');
    const stickyEl = document.getElementById('hs-header-sticky');
    const transparentEl = document.getElementById('hs-header-transparent');
    const compactEl = document.getElementById('hs-header-compact');
    if (heightEl) heightEl.value = map['header_height'] || '80';
    if (stickyEl) stickyEl.value = map['header_sticky'] || 'true';
    if (transparentEl) transparentEl.value = map['header_transparent'] || 'false';
    if (compactEl) compactEl.value = map['header_compact_on_scroll'] || 'false';

    // تعيين خيار الروابط السريعة للفوتر
    const quickLinksEl = document.getElementById('hs-footer-quick-links');
    if (quickLinksEl) quickLinksEl.checked = map['footer_show_quick_links'] === 'true';

    // رسم Layout Pickers
    renderHeaderLayoutPicker(map['header_layout'] || 'classic');
    renderFooterLayoutPicker(map['footer_layout'] || 'simple');
}

// ==========================================
// 2. Header Layout Picker UI
// ==========================================

function renderHeaderLayoutPicker(activeId) {
    const container = document.getElementById('header-layouts-grid');
    if (!container) return;

    container.innerHTML = HEADER_LAYOUTS.map(layout => {
        const isActive = layout.id === activeId;
        return `
            <div
                onclick="selectHeaderLayout('${layout.id}')"
                id="header-layout-card-${layout.id}"
                class="relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200
                    ${isActive
                        ? 'border-devo-orange bg-devo-orange/5 shadow-[0_0_15px_rgba(249,115,22,0.15)]'
                        : 'border-devo-gray bg-devo-black hover:border-devo-grayHover'
                    }"
            >
                ${isActive ? `<div class="absolute top-2 left-2 w-5 h-5 rounded-full bg-devo-orange flex items-center justify-center"><i class="ph ph-check text-white text-xs font-bold"></i></div>` : ''}
                <div class="flex items-start gap-3">
                    <div class="w-10 h-10 rounded-lg ${isActive ? 'bg-devo-orange/20 text-devo-orange' : 'bg-devo-gray/30 text-devo-muted'} flex items-center justify-center shrink-0 transition-colors">
                        <i class="ph ${layout.icon} text-xl"></i>
                    </div>
                    <div>
                        <h4 class="text-sm font-bold ${isActive ? 'text-devo-orange' : 'text-white'} leading-snug">${layout.name}</h4>
                        <p class="text-xs text-devo-muted mt-0.5 leading-relaxed">${layout.description}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.selectHeaderLayout = function(layoutId) {
    currentSettings.header_layout = layoutId;
    // تحديث UI
    HEADER_LAYOUTS.forEach(l => {
        const card = document.getElementById(`header-layout-card-${l.id}`);
        if (!card) return;
        const isActive = l.id === layoutId;
        card.className = `relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200 ${
            isActive
                ? 'border-devo-orange bg-devo-orange/5 shadow-[0_0_15px_rgba(249,115,22,0.15)]'
                : 'border-devo-gray bg-devo-black hover:border-devo-grayHover'
        }`;
        const checkmark = card.querySelector('.absolute');
        if (isActive && !checkmark) {
            card.insertAdjacentHTML('afterbegin', `<div class="absolute top-2 left-2 w-5 h-5 rounded-full bg-devo-orange flex items-center justify-center"><i class="ph ph-check text-white text-xs font-bold"></i></div>`);
        } else if (!isActive && checkmark) {
            checkmark.remove();
        }
        const icon = card.querySelector('.w-10');
        if (icon) icon.className = `w-10 h-10 rounded-lg ${isActive ? 'bg-devo-orange/20 text-devo-orange' : 'bg-devo-gray/30 text-devo-muted'} flex items-center justify-center shrink-0 transition-colors`;
        const title = card.querySelector('h4');
        if (title) title.className = `text-sm font-bold ${isActive ? 'text-devo-orange' : 'text-white'} leading-snug`;
    });
};

window.saveHeaderSettings = async () => {
    const btn = document.getElementById('btn-save-header');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    try {
        const updates = [
            { setting_key: 'header_layout', setting_value: currentSettings.header_layout || 'classic' },
            { setting_key: 'header_height', setting_value: document.getElementById('hs-header-height')?.value || '80' },
            { setting_key: 'header_sticky', setting_value: document.getElementById('hs-header-sticky')?.value || 'true' },
            { setting_key: 'header_transparent', setting_value: document.getElementById('hs-header-transparent')?.value || 'false' },
            { setting_key: 'header_compact_on_scroll', setting_value: document.getElementById('hs-header-compact')?.value || 'false' },
        ];

        const { error } = await supabase.from('home_settings').upsert(updates, { onConflict: 'setting_key' });
        if (error) throw error;

        showToast('تم حفظ إعدادات الهيدر بنجاح ✓ ستُطبق عند إعادة تحميل الصفحة الرئيسية', 'success');
    } catch (err) {
        showToast('حدث خطأ أثناء الحفظ: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-floppy-disk"></i> حفظ إعدادات الهيدر`;
    }
};

// ==========================================
// 3. Footer Layout Picker UI
// ==========================================

function renderFooterLayoutPicker(activeId) {
    const container = document.getElementById('footer-layouts-grid');
    if (!container) return;

    container.innerHTML = FOOTER_LAYOUTS.map(layout => {
        const isActive = layout.id === activeId;
        return `
            <div
                onclick="selectFooterLayout('${layout.id}')"
                id="footer-layout-card-${layout.id}"
                class="relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200
                    ${isActive
                        ? 'border-purple-500 bg-purple-500/5 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                        : 'border-devo-gray bg-devo-black hover:border-devo-grayHover'
                    }"
            >
                ${isActive ? `<div class="absolute top-2 left-2 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center"><i class="ph ph-check text-white text-xs font-bold"></i></div>` : ''}
                <div class="flex items-start gap-3">
                    <div class="w-10 h-10 rounded-lg ${isActive ? 'bg-purple-500/20 text-purple-400' : 'bg-devo-gray/30 text-devo-muted'} flex items-center justify-center shrink-0 transition-colors">
                        <i class="ph ${layout.icon} text-xl"></i>
                    </div>
                    <div>
                        <h4 class="text-sm font-bold ${isActive ? 'text-purple-400' : 'text-white'} leading-snug">${layout.name}</h4>
                        <p class="text-xs text-devo-muted mt-0.5 leading-relaxed">${layout.description}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.selectFooterLayout = function(layoutId) {
    currentSettings.footer_layout = layoutId;
    FOOTER_LAYOUTS.forEach(l => {
        const card = document.getElementById(`footer-layout-card-${l.id}`);
        if (!card) return;
        const isActive = l.id === layoutId;
        card.className = `relative cursor-pointer rounded-xl border-2 p-4 transition-all duration-200 ${
            isActive
                ? 'border-purple-500 bg-purple-500/5 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                : 'border-devo-gray bg-devo-black hover:border-devo-grayHover'
        }`;
        const checkmark = card.querySelector('.absolute');
        if (isActive && !checkmark) {
            card.insertAdjacentHTML('afterbegin', `<div class="absolute top-2 left-2 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center"><i class="ph ph-check text-white text-xs font-bold"></i></div>`);
        } else if (!isActive && checkmark) {
            checkmark.remove();
        }
        const icon = card.querySelector('.w-10');
        if (icon) icon.className = `w-10 h-10 rounded-lg ${isActive ? 'bg-purple-500/20 text-purple-400' : 'bg-devo-gray/30 text-devo-muted'} flex items-center justify-center shrink-0 transition-colors`;
        const title = card.querySelector('h4');
        if (title) title.className = `text-sm font-bold ${isActive ? 'text-purple-400' : 'text-white'} leading-snug`;
    });
};

window.saveFooterSettings = async () => {
    const btn = document.getElementById('btn-save-footer');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    try {
        const updates = [
            { setting_key: 'footer_layout', setting_value: currentSettings.footer_layout || 'simple' },
            { setting_key: 'footer_show_quick_links', setting_value: document.getElementById('hs-footer-quick-links')?.checked ? 'true' : 'false' },
        ];

        const { error } = await supabase.from('home_settings').upsert(updates, { onConflict: 'setting_key' });
        if (error) throw error;

        showToast('تم حفظ إعدادات الفوتر بنجاح ✓ ستُطبق عند إعادة تحميل الصفحة الرئيسية', 'success');
    } catch (err) {
        showToast('حدث خطأ أثناء الحفظ: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-floppy-disk"></i> حفظ إعدادات الفوتر`;
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
            { setting_key: 'social_maps', setting_value: document.getElementById('hs-social-maps').value.trim() }
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

window.openPromoModal = (id = null) => {
    const form = document.getElementById('promo-form');
    form.reset();
    document.getElementById('pm-id').value = id || '';
    document.getElementById('promo-modal-title').textContent = id ? 'تعديل العرض' : 'إضافة عرض جديد';

    if (id) {
        const card = promoCards.find(c => c.id === id);
        if (card) {
            document.getElementById('pm-title').value = card.title;
            document.getElementById('pm-desc').value = card.description;
            // استدعاء الصورة في حالة التعديل
            if (document.getElementById('pm-image')) document.getElementById('pm-image').value = card.image_url || '';
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

    // تجهيز البيانات بما فيها حقل الصورة
    const payload = {
        title: document.getElementById('pm-title').value.trim(),
        description: document.getElementById('pm-desc').value.trim(),
        image_url: document.getElementById('pm-image') ? document.getElementById('pm-image').value.trim() : null,
        badge_text: document.getElementById('pm-badge').value.trim() || null,
        badge_color: document.getElementById('pm-color').value,
        is_active: document.getElementById('pm-status').checked
    };

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> حفظ...`;

    try {
        if (id) {
            const { error } = await supabase.from('promo_cards').update(payload).eq('id', id);
            if (error) throw error;
        } else {
            const { error } = await supabase.from('promo_cards').insert([payload]);
            if (error) throw error;
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