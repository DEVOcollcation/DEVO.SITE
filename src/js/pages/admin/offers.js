import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { requireAuth } from '../../services/auth.js';

let promoCards = [];
let isInitialized = false;

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

// ============================================================
// 🎯 تهيئة صفحة العروض والإعلانات
// ============================================================
export async function initOffersView() {
    const user = requireAuth(['owner', 'admin']);
    if (!user) {
        showToast('⛔ ليس لديك صلاحية للوصول لإدارة العروض والإعلانات', 'error');
        return;
    }

    setupWindowBindings();
    await loadPromoCards();

    const form = document.getElementById('promo-form');
    if (form && !form.dataset.bound) {
        form.addEventListener('submit', handleSavePromo);
        form.dataset.bound = 'true';
    }

    isInitialized = true;
}

function setupWindowBindings() {
    window.openPromoModal = openPromoModal;
    window.closePromoModal = closePromoModal;
    window.deletePromoCard = deletePromoCard;
}

// ============================================================
// 📥 تحميل كروت العروض والإعلانات
// ============================================================
export async function loadPromoCards() {
    const container = document.getElementById('promo-cards-container');
    if (container) {
        container.innerHTML = `<div class="col-span-full py-16 text-center text-devo-muted flex flex-col items-center gap-3">
            <i class="ph ph-spinner animate-spin text-3xl text-devo-info"></i>
            <span>جاري تحميل كروت العروض والإعلانات...</span>
        </div>`;
    }

    const { data, error } = await supabase
        .from('promo_cards')
        .select('*')
        .order('created_at', { ascending: true });
    
    if (error) {
        if (container) container.innerHTML = `<div class="col-span-full py-8 text-center text-devo-error">خطأ في تحميل الكروت الإعلانية</div>`;
        return;
    }

    promoCards = data || [];
    renderPromoCards();
}

// ============================================================
// 🎨 رسم كروت العروض في الشبكة
// ============================================================
export function renderPromoCards() {
    const container = document.getElementById('promo-cards-container');
    if (!container) return;

    if (promoCards.length === 0) {
        container.innerHTML = `
            <div class="col-span-full py-16 text-center text-devo-muted border-2 border-dashed border-devo-gray/70 rounded-2xl flex flex-col items-center justify-center gap-3 bg-devo-black/20">
                <div class="w-16 h-16 rounded-2xl bg-devo-info/10 flex items-center justify-center text-devo-info text-3xl">
                    <i class="ph ph-cards"></i>
                </div>
                <h4 class="text-base font-bold text-white">لا توجد كروت إعلانية مسجلة حتى الآن</h4>
                <p class="text-xs text-devo-muted max-w-sm">قم بإضافة عروض وبنرات إعلانية لجذب العملاء وتوجيههم للموديلات والعروض الخاصة.</p>
                <button onclick="openPromoModal()" class="mt-2 px-4 py-2 bg-devo-info hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md">
                    <i class="ph ph-plus-circle text-base"></i>
                    <span>إضافة أول كارت إعلاني</span>
                </button>
            </div>
        `;
        return;
    }

    container.innerHTML = promoCards.map(card => {
        const imgUrl = resolveImageUrl(card.image_url);
        const imgHtml = imgUrl 
            ? `<img src="${imgUrl}" class="w-14 h-14 rounded-xl object-cover border border-devo-gray shrink-0 shadow-sm" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'48\\' height=\\'48\\' fill=\\'%23666\\' viewBox=\\'0 0 256 256\\'><rect width=\\'256\\' height=\\'256\\' fill=\\'none\\'/><path d=\\'M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,160H40V56H216V200Z\\'/></svg>'">` 
            : `<div class="w-14 h-14 rounded-xl bg-devo-gray flex items-center justify-center text-devo-info text-2xl shrink-0 shadow-sm"><i class="ph ph-megaphone"></i></div>`;

        const lines = card.description ? card.description.split('\n').map(l => l.trim()).filter(l => l.length > 0) : [];
        let descHtml = '';
        if (lines.length > 1) {
            descHtml = `<ul class="text-devo-muted text-xs leading-relaxed space-y-1 flex flex-col items-start w-full list-none">` + 
                lines.map(line => `<li class="flex items-center gap-1.5 text-right"><span class="w-1.5 h-1.5 rounded-full bg-devo-info shrink-0"></span><span>${line}</span></li>`).join('') + 
                `</ul>`;
        } else {
            descHtml = `<p class="text-devo-muted text-xs leading-relaxed line-clamp-2">${card.description || ''}</p>`;
        }

        return `
        <div class="bg-devo-black/70 border border-devo-gray rounded-2xl p-5 relative flex flex-col justify-between transition-all hover:border-devo-info/70 hover:shadow-lg ${!card.is_active ? 'opacity-50 grayscale' : ''}">
            ${card.badge_text ? `<span class="absolute top-0 right-0 ${card.badge_color || 'bg-devo-orange'} text-white text-[10px] font-bold px-2.5 py-1 rounded-bl-xl rounded-tr-2xl shadow-sm">${card.badge_text}</span>` : ''}
            
            <div class="flex items-start gap-3.5 mt-2">
                ${imgHtml}
                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        <h4 class="text-white font-bold text-sm leading-tight">${card.title}</h4>
                        ${card.is_active ? '<span class="w-2 h-2 rounded-full bg-devo-success inline-block shrink-0" title="نشط"></span>' : '<span class="w-2 h-2 rounded-full bg-devo-muted inline-block shrink-0" title="معطل"></span>'}
                    </div>
                    ${descHtml}
                </div>
            </div>

            <div class="flex items-center justify-between mt-5 pt-3 border-t border-devo-gray/60">
                <span class="text-[11px] text-devo-muted font-medium">
                    ${card.is_active ? '<span class="text-devo-success">ظاهر للعملاء</span>' : '<span class="text-devo-muted">مخفي</span>'}
                </span>
                <div class="flex items-center gap-1">
                    <button onclick="openPromoModal('${card.id}')" class="text-devo-info hover:bg-devo-info/15 p-2 rounded-lg transition-colors cursor-pointer" title="تعديل العرض">
                        <i class="ph ph-pencil-simple text-base"></i>
                    </button>
                    <button onclick="deletePromoCard('${card.id}')" class="text-devo-error hover:bg-devo-error/15 p-2 rounded-lg transition-colors cursor-pointer" title="حذف العرض">
                        <i class="ph ph-trash text-base"></i>
                    </button>
                </div>
            </div>
        </div>
        `;
    }).join('');
}

// ============================================================
// 🪟 فتح المودال لإضافة أو تعديل كارت
// ============================================================
export async function openPromoModal(id = null) {
    const form = document.getElementById('promo-form');
    if (!form) return;
    form.reset();
    
    document.getElementById('pm-id').value = id || '';
    document.getElementById('promo-modal-title').textContent = id ? 'تعديل بيانات العرض' : 'إضافة عرض إعلاني جديد';

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
            document.getElementById('pm-title').value = card.title || '';
            document.getElementById('pm-desc').value = card.description || '';
            if (document.getElementById('pm-image')) document.getElementById('pm-image').value = card.image_url || '';
            if (modelSelect) modelSelect.value = card.model_id || '';
            document.getElementById('pm-badge').value = card.badge_text || '';
            document.getElementById('pm-color').value = card.badge_color || 'bg-devo-orange';
            document.getElementById('pm-status').checked = card.is_active !== false;
        }
    } else {
        document.getElementById('pm-status').checked = true;
    }

    const modal = document.getElementById('promo-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
}

// ============================================================
// ❌ إغلاق المودال
// ============================================================
export function closePromoModal() {
    const modal = document.getElementById('promo-modal');
    if (!modal) return;
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

// ============================================================
// 💾 حفظ الكارت الإعلاني (إضافة / تعديل)
// ============================================================
export async function handleSavePromo(e) {
    e.preventDefault();
    const id = document.getElementById('pm-id').value;
    const btn = e.target.querySelector('button[type="submit"]');
    const originalText = btn ? btn.innerHTML : 'حفظ';

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

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;
    }

    try {
        if (id) {
            const { error } = await supabase.from('promo_cards').update(payload).eq('id', id);
            if (error) {
                if (error.message && error.message.includes('model_id')) {
                    delete payload.model_id;
                    const { error: err2 } = await supabase.from('promo_cards').update(payload).eq('id', id);
                    if (err2) throw err2;
                } else throw error;
            }
        } else {
            const { error } = await supabase.from('promo_cards').insert([payload]);
            if (error) {
                if (error.message && error.message.includes('model_id')) {
                    delete payload.model_id;
                    const { error: err2 } = await supabase.from('promo_cards').insert([payload]);
                    if (err2) throw err2;
                } else throw error;
            }
        }
        showToast('تم حفظ الكارت الإعلاني بنجاح ✨', 'success');
        closePromoModal();
        await loadPromoCards();
    } catch (error) {
        console.error('Error saving promo card:', error);
        showToast('حدث خطأ أثناء حفظ الكارت الإعلاني', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// ============================================================
// 🗑️ حذف كارت إعلاني
// ============================================================
export async function deletePromoCard(id) {
    const confirmed = await confirmDialog({ 
        title: 'حذف العرض الإعلاني', 
        message: 'هل أنت متأكد من حذف هذا الكارت الإعلاني نهائياً؟', 
        isDestructive: true 
    });
    if (!confirmed) return;

    const { error } = await supabase.from('promo_cards').delete().eq('id', id);
    if (error) {
        console.error('Error deleting promo card:', error);
        showToast('حدث خطأ أثناء حذف الكارت', 'error');
    } else {
        showToast('تم حذف الكارت الإعلاني بنجاح', 'success');
        await loadPromoCards();
    }
}
