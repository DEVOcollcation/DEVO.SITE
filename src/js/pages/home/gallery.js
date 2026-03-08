import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

let allModels = [];
let currentUser = null;

function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return './src/assets/icons/devo.jpeg';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1000`;
        }
    } catch (e) {}
    return url; 
}

export async function initGallery() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;

    // ربط محرك البحث
    document.getElementById('gallery-search')?.addEventListener('input', handleSearch);

    // دالة مؤقتة لفتح التفاصيل
    window.openModelViewer = (id) => {
        showToast('سيتم فتح نافذة التفاصيل لإضافة الموديل للسلة في الخطوة القادمة!', 'info');
    };

    await fetchGalleryModels();
}

async function fetchGalleryModels() {
    const container = document.getElementById('gallery-grid');
    if(!container) return;

    // جلب الموديلات النشطة فقط
    const { data, error } = await supabase
        .from('models')
        .select(`
            id, system_code, factory_code, name, price, is_active,
            categories(name),
            model_inventory(available_series),
            model_images(image_url)
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (error) {
        container.innerHTML = `<div class="col-span-full text-center text-devo-error">حدث خطأ أثناء جلب البيانات.</div>`;
        return;
    }

    allModels = data;
    renderGallery(data);
}

function renderGallery(models) {
    const container = document.getElementById('gallery-grid');
    if (!container) return;

    if (models.length === 0) {
        container.innerHTML = `<div class="col-span-full py-10 text-center text-devo-muted">لا توجد موديلات تطابق بحثك حالياً.</div>`;
        return;
    }

    container.innerHTML = models.map(m => {
        const totalSeries = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
        const isOut = totalSeries === 0;
        const mainImg = resolveImageUrl(m.model_images?.[0]?.image_url);
        
        let stockBadge = '';
        if (currentUser) {
            if (isOut) {
                stockBadge = `<span class="absolute top-3 right-3 bg-devo-error text-white text-xs px-2 py-1 rounded shadow-md z-10 font-bold">نفذت الكمية</span>`;
            } else if (totalSeries <= 5) {
                stockBadge = `<span class="absolute top-3 right-3 bg-devo-orange text-white text-xs px-2 py-1 rounded shadow-md z-10 font-bold">متبقي ${totalSeries} سيريه</span>`;
            } else {
                stockBadge = `<span class="absolute top-3 right-3 bg-devo-success text-white text-xs px-2 py-1 rounded shadow-md z-10 font-bold">متبقي ${totalSeries} سيريه</span>`;
            }
        } else {
            if (isOut) {
                stockBadge = `<span class="absolute top-3 right-3 bg-devo-gray text-white text-xs px-2 py-1 rounded shadow-md z-10 font-bold">نفذت الكمية</span>`;
            }
        }

        const cardStyle = isOut ? 'grayscale opacity-75' : 'card-hover cursor-pointer';

        return `
        <div class="bg-devo-dark border border-devo-gray rounded-2xl overflow-hidden flex flex-col relative group transition-all duration-300 ${cardStyle}" onclick="openModelViewer('${m.id}')">
            ${stockBadge}
            <div class="h-64 bg-devo-black relative overflow-hidden">
                <img src="${mainImg}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" onerror="this.src='./src/assets/icons/devo.jpeg'" loading="lazy">
                <div class="absolute inset-0 bg-gradient-to-t from-devo-black via-transparent to-transparent opacity-80"></div>
            </div>
            <div class="p-5 flex-1 flex flex-col justify-between -mt-8 z-10 relative">
                <div class="bg-devo-black/80 backdrop-blur-sm border border-devo-gray/50 rounded-xl p-3 mb-3 shadow-lg">
                    <div class="flex justify-between items-start mb-1">
                        <h3 class="text-white font-bold truncate pr-2" title="${m.name}">${m.name}</h3>
                        <span class="text-devo-muted text-[10px] font-mono bg-devo-gray/30 px-2 py-0.5 rounded">${m.factory_code || m.system_code}</span>
                    </div>
                    <p class="text-devo-orange font-bold">${m.price} ج.م</p>
                </div>
                <div class="flex justify-between items-center text-xs text-devo-muted">
                    <span class="flex items-center gap-1"><i class="ph ph-tag"></i> ${m.categories?.name || '---'}</span>
                    <span class="flex items-center gap-1 text-white group-hover:text-devo-orange transition-colors">عرض التفاصيل <i class="ph ph-caret-left"></i></span>
                </div>
            </div>
        </div>`;
    }).join('');
}

function handleSearch(e) {
    const term = e.target.value.toLowerCase().trim();
    const filtered = allModels.filter(m => {
        const codeMatch = String(m.factory_code).toLowerCase().includes(term) || String(m.system_code).toLowerCase().includes(term);
        const nameMatch = m.name.toLowerCase().includes(term);
        const catMatch = (m.categories?.name || '').toLowerCase().includes(term);
        return codeMatch || nameMatch || catMatch;
    });
    renderGallery(filtered);
}