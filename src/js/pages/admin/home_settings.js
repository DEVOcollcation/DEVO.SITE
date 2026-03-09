import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

let isInitialized = false;
let promoCards = [];

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
// 1. Hero Settings Logic
// ==========================================

async function loadHeroSettings() {
    const { data, error } = await supabase.from('home_settings').select('*');
    if (error || !data) return;

    const map = {};
    data.forEach(item => map[item.setting_key] = item.setting_value);

    if (document.getElementById('hs-hero-title')) {
        document.getElementById('hs-hero-title').value = map['hero_title'] || '';
        document.getElementById('hs-hero-subtitle').value = map['hero_subtitle'] || '';
        document.getElementById('hs-bg-desktop').value = map['hero_bg_desktop'] || '';
        document.getElementById('hs-bg-mobile').value = map['hero_bg_mobile'] || '';
        document.getElementById('hs-social-fb').value = map['social_facebook'] || '';
        document.getElementById('hs-social-wa').value = map['social_whatsapp'] || '';
        document.getElementById('hs-social-maps').value = map['social_maps'] || '';
    }
}

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