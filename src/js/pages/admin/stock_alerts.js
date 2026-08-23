import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';

let isInitialized = false;
let allActiveModels = [];
let filteredAlerts = [];
let currentFilter = 'all'; // 'all', 'out_of_stock', 'critical'
let searchTerm = '';

export async function initStockAlertsView() {
    if (!isInitialized) {
        setupEventListeners();
        setupRealtimeStockAlerts();
        isInitialized = true;
    }

    await fetchStockAlertsData();
}

function setupEventListeners() {
    const searchInput = document.getElementById('sa-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchTerm = e.target.value.toLowerCase().trim();
            applyStockAlertFilters();
        });
    }

    const filterStatus = document.getElementById('sa-status-filter');
    if (filterStatus) {
        filterStatus.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            applyStockAlertFilters();
        });
    }

    const refreshBtn = document.getElementById('sa-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            const icon = refreshBtn.querySelector('i');
            if (icon) icon.classList.add('animate-spin');
            showToast('جاري تحديث تنبيهات المخزون...', 'info');
            await fetchStockAlertsData();
            if (icon) setTimeout(() => icon.classList.remove('animate-spin'), 600);
        });
    }

    const printBtn = document.getElementById('sa-print-btn');
    if (printBtn) {
        printBtn.addEventListener('click', printStockAlertsReport);
    }
}

// ==========================================
// 🌟 1. استدعاء البيانات من السيرفر 🌟
// ==========================================
export async function fetchStockAlertsData() {
    const tbody = document.getElementById('sa-table-body');
    if (tbody && allActiveModels.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange block mx-auto mb-2"></i><span class="text-devo-muted text-xs">جاري فحص وتحديث تنبيهات المخزون...</span></td></tr>`;
    }

    let fetchedModels = [];
    let from = 0;
    const step = 999;
    let hasMore = true;

    try {
        while (hasMore) {
            const { data, error } = await supabase
                .from('models')
                .select(`
                    id, name, system_code, factory_code, is_active,
                    categories(name),
                    classes(name),
                    model_images(image_url),
                    model_inventory(color_id, available_series, colors(name, color_code))
                `)
                .eq('is_active', true)
                .range(from, from + step);

            if (error) throw error;

            if (data && data.length > 0) {
                fetchedModels.push(...data);
                from += step + 1;
            }
            if (!data || data.length <= step) hasMore = false;
        }

        allActiveModels = fetchedModels;
        applyStockAlertFilters();
    } catch (err) {
        console.error('Error fetching stock alerts:', err);
        showToast('حدث خطأ أثناء جلب تنبيهات المخزون', 'error');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-devo-error text-sm">فشل تحميل البيانات. يرجى الضغط على زر التحديث.</td></tr>`;
        }
    }
}

// ==========================================
// 🌟 2. الرادار اللحظي لتنبيهات المخزون 🌟
// ==========================================
function setupRealtimeStockAlerts() {
    supabase.channel('stock_alerts_tracker')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, async (payload) => {
            if (payload.eventType === 'DELETE') {
                allActiveModels = allActiveModels.filter(m => m.id !== payload.old.id);
                applyStockAlertFilters();
                return;
            }

            const { data } = await supabase
                .from('models')
                .select(`
                    id, name, system_code, factory_code, is_active,
                    categories(name),
                    classes(name),
                    model_images(image_url),
                    model_inventory(color_id, available_series, colors(name, color_code))
                `)
                .eq('id', payload.new.id)
                .maybeSingle();

            if (data) {
                const idx = allActiveModels.findIndex(m => m.id === data.id);
                if (data.is_active) {
                    if (idx > -1) allActiveModels[idx] = data;
                    else allActiveModels.unshift(data);
                } else {
                    if (idx > -1) allActiveModels.splice(idx, 1);
                }
                applyStockAlertFilters();
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'model_inventory' }, (payload) => {
            const row = payload.new || payload.old;
            if (!row) return;

            const mIdx = allActiveModels.findIndex(m => m.id === row.model_id);
            if (mIdx > -1) {
                const invList = allActiveModels[mIdx].model_inventory || [];
                const iIdx = invList.findIndex(i => i.color_id === row.color_id);
                if (iIdx > -1) {
                    if (payload.eventType === 'DELETE') {
                        invList.splice(iIdx, 1);
                    } else {
                        invList[iIdx].available_series = row.available_series;
                    }
                } else if (payload.eventType === 'INSERT') {
                    invList.push({
                        color_id: row.color_id,
                        available_series: row.available_series,
                        colors: { name: 'لون جديد', color_code: '#888888' }
                    });
                }
                applyStockAlertFilters();
            }
        })
        .subscribe();
}

// ==========================================
// 🌟 3. الفلترة وتحديث الإحصائيات 🌟
// ==========================================
function applyStockAlertFilters() {
    let flatAlerts = [];
    const affectedModelIds = new Set();
    let totalOutCount = 0;
    let totalCriticalCount = 0;

    allActiveModels.forEach(m => {
        const inventory = m.model_inventory || [];
        inventory.forEach(inv => {
            const available = parseInt(inv.available_series) || 0;
            if (available < 5) {
                affectedModelIds.add(m.id);
                if (available === 0) totalOutCount++;
                else totalCriticalCount++;

                const primaryImage = (m.model_images && m.model_images.length > 0) 
                    ? m.model_images[0].image_url 
                    : null;

                flatAlerts.push({
                    model_id: m.id,
                    model_name: m.name || 'بدون اسم',
                    factory_code: m.factory_code || '',
                    system_code: m.system_code || '',
                    category_name: m.categories?.name || '-',
                    class_name: m.classes?.name || '-',
                    color_name: inv.colors?.name || 'غير محدد',
                    color_code: inv.colors?.color_code || null,
                    available_series: available,
                    image_url: primaryImage
                });
            }
        });
    });

    // تحديث بطاقات الإحصائيات العلوية
    updateStatCard('sa-stat-total-alerts', flatAlerts.length);
    updateStatCard('sa-stat-out-of-stock', totalOutCount);
    updateStatCard('sa-stat-critical-stock', totalCriticalCount);
    updateStatCard('sa-stat-affected-models', affectedModelIds.size);

    // تحديث الشارة في القائمة الجانبية (Sidebar Badge)
    const sidebarBadge = document.getElementById('sidebar-stock-alert-badge');
    if (sidebarBadge) {
        if (flatAlerts.length > 0) {
            sidebarBadge.textContent = flatAlerts.length;
            sidebarBadge.classList.remove('hidden');
        } else {
            sidebarBadge.classList.add('hidden');
        }
    }

    // تطبيق فلتر الحالة (نفذت الكمية / حرجة)
    let filtered = flatAlerts;
    if (currentFilter === 'out_of_stock') {
        filtered = filtered.filter(item => item.available_series === 0);
    } else if (currentFilter === 'critical') {
        filtered = filtered.filter(item => item.available_series > 0 && item.available_series < 5);
    }

    // تطبيق البحث النصي
    if (searchTerm) {
        filtered = filtered.filter(item => {
            const nameMatch = item.model_name.toLowerCase().includes(searchTerm);
            const factoryMatch = item.factory_code.toLowerCase().includes(searchTerm);
            const systemMatch = item.system_code.toLowerCase().includes(searchTerm);
            const colorMatch = item.color_name.toLowerCase().includes(searchTerm);
            const catMatch = item.category_name.toLowerCase().includes(searchTerm);
            return nameMatch || factoryMatch || systemMatch || colorMatch || catMatch;
        });
    }

    // الفرز: نفذت الكمية أولاً، ثم حسب الأقل
    filteredAlerts = filtered.sort((a, b) => a.available_series - b.available_series);

    renderStockAlertsTable(filteredAlerts);
}

function updateStatCard(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = value;
    }
}

// ==========================================
// 🌟 4. رسم الجدول 🌟
// ==========================================
function renderStockAlertsTable(items) {
    const tbody = document.getElementById('sa-table-body');
    if (!tbody) return;

    if (items.length === 0) {
        const msg = (searchTerm || currentFilter !== 'all') 
            ? 'لا توجد تنبيهات مخزون تطابق معايير البحث والفلترة المحددة.' 
            : 'رائع! جميع الموديلات النشطة بها مخزون كافي (5 سيريه أو أكثر).';
        const icon = (searchTerm || currentFilter !== 'all') ? 'ph-magnifying-glass' : 'ph-check-circle';
        const color = (searchTerm || currentFilter !== 'all') ? 'text-devo-muted' : 'text-devo-success';

        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="p-12 text-center border-none">
                    <i class="ph ${icon} ${color} text-5xl block mx-auto mb-3"></i>
                    <p class="text-white font-bold text-sm mb-1">${msg}</p>
                    <span class="text-xs text-devo-muted">سيتم رصد أي صنف ينخفض رصيده تلقائياً ولحظياً هنا</span>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map(item => {
        const qty = item.available_series;
        const isOut = qty === 0;
        const statusClass = isOut 
            ? 'bg-devo-error/15 text-devo-error border-devo-error/40' 
            : 'bg-amber-500/15 text-amber-400 border-amber-500/40';
        const statusText = isOut ? 'نفذت الكمية تماماً' : 'كمية حرجة (أوشك على النفاد)';
        const statusIcon = isOut ? 'ph-x-circle' : 'ph-warning';

        const colorDot = item.color_code 
            ? `<span class="w-3 h-3 rounded-full border border-white/20 inline-block shrink-0 shadow-sm" style="background-color: ${item.color_code};"></span>`
            : '';

        const fallbackImg = './src/assets/icons/devo.png';
        const imgSrc = item.image_url ? resolveImageUrl(item.image_url) : fallbackImg;

        return `
            <tr class="hover:bg-devo-black/60 transition-colors border-b border-devo-gray/50">
                <td class="p-3">
                    <div class="flex items-center gap-3">
                        <img src="${imgSrc}" alt="${item.model_name}" onerror="this.src='${fallbackImg}'" class="w-11 h-11 rounded-lg object-cover bg-devo-black border border-devo-gray/80 shrink-0">
                        <div class="overflow-hidden">
                            <span class="text-white font-bold text-sm block truncate" title="${item.model_name}">${item.model_name}</span>
                            <div class="flex items-center gap-2 mt-0.5 text-[11px] text-devo-muted font-mono">
                                ${item.factory_code ? `<span class="bg-devo-gray/40 px-1.5 py-0.5 rounded text-devo-orange font-bold">مصنع: ${item.factory_code}</span>` : ''}
                                ${item.system_code ? `<span>كود: ${item.system_code}</span>` : ''}
                            </div>
                        </div>
                    </div>
                </td>
                <td class="p-3">
                    <div class="text-xs text-white">${item.category_name}</div>
                    <div class="text-[10px] text-devo-muted">${item.class_name}</div>
                </td>
                <td class="p-3">
                    <div class="inline-flex items-center gap-1.5 px-2 py-1 bg-devo-black/70 border border-devo-gray/60 rounded-lg text-xs text-white">
                        ${colorDot}
                        <span>${item.color_name}</span>
                    </div>
                </td>
                <td class="p-3 text-center">
                    <span class="text-base font-black font-mono ${isOut ? 'text-devo-error' : 'text-amber-400'}">${qty}</span>
                    <span class="text-[10px] text-devo-muted block">سيريه</span>
                </td>
                <td class="p-3 text-center">
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusClass}">
                        <i class="ph-bold ${statusIcon}"></i> ${statusText}
                    </span>
                </td>
                <td class="p-3">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="goToAddBatchForModel('${item.model_id}')" class="p-2 bg-devo-orange/15 text-devo-orange hover:bg-devo-orange hover:text-white rounded-lg transition-colors text-xs font-bold flex items-center gap-1 cursor-pointer" title="شحن رصيد جديد">
                            <i class="ph ph-truck text-base"></i>
                            <span class="hidden md:inline">شحن رصيد</span>
                        </button>
                        <button onclick="goToModelEdit('${item.model_id}')" class="p-2 bg-devo-gray hover:bg-white hover:text-black rounded-lg transition-colors text-devo-muted text-xs cursor-pointer" title="عرض في الموديلات">
                            <i class="ph ph-t-shirt text-base"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// دالة مساعدة لفك روابط الصور
function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return './src/assets/icons/devo.png';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w400`;
        }
    } catch (e) {}
    return url;
}

// ==========================================
// 🌟 5. إجراءات التوجيه السريع والطباعة 🌟
// ==========================================
window.goToAddBatchForModel = (modelId) => {
    const addBatchLink = document.querySelector('[data-target="view-add-batch"]');
    if (addBatchLink) {
        addBatchLink.click();
    }
};

window.goToModelEdit = (modelId) => {
    const modelsLink = document.querySelector('[data-target="view-models"]');
    if (modelsLink) {
        modelsLink.click();
    }
};

function printStockAlertsReport() {
    if (filteredAlerts.length === 0) {
        showToast('لا توجد بيانات للطباعة', 'warning');
        return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showToast('يرجى السماح بالنوافذ المنبثقة للطباعة', 'error');
        return;
    }

    const dateStr = new Date().toLocaleString('ar-EG', { dateStyle: 'full', timeStyle: 'short' });
    const rowsHtml = filteredAlerts.map((item, idx) => `
        <tr>
            <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
            <td style="font-weight: bold;">${item.model_name}</td>
            <td>${item.factory_code || item.system_code || '-'}</td>
            <td>${item.category_name} / ${item.class_name}</td>
            <td>${item.color_name}</td>
            <td style="text-align: center; font-weight: bold; font-size: 14px; color: ${item.available_series === 0 ? '#dc2626' : '#d97706'};">${item.available_series}</td>
            <td style="text-align: center;">${item.available_series === 0 ? 'نفذت الكمية' : 'كمية حرجة'}</td>
        </tr>
    `).join('');

    printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>تقرير تنبيهات المخزون - DEVO</title>
            <style>
                body { font-family: 'Tajawal', Arial, sans-serif; padding: 20px; color: #111; direction: rtl; }
                .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 15px; margin-bottom: 20px; }
                .title { font-size: 22px; font-weight: bold; margin: 0; }
                .meta { font-size: 12px; color: #666; margin-top: 5px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: right; }
                th { background-color: #f3f4f6; font-weight: bold; }
                @media print {
                    button { display: none; }
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1 class="title">تقرير تنبيهات المخزون الحرج والنوافذ</h1>
                <div class="meta">تاريخ الاستخراج: ${dateStr} | إجمالي التنبيهات: ${filteredAlerts.length}</div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 40px; text-align: center;">#</th>
                        <th>اسم الموديل</th>
                        <th>كود الموديل</th>
                        <th>التصنيف / الفئة</th>
                        <th>اللون</th>
                        <th style="width: 90px; text-align: center;">المتاح (سيريه)</th>
                        <th style="width: 100px; text-align: center;">الحالة</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
            </table>
            <script>
                window.onload = function() { window.print(); };
            <\/script>
        </body>
        </html>
    `);
    printWindow.document.close();
}
