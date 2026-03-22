import { supabase } from '../../config/supabase.js';

let isInitialized = false;
let allDashboardOrders = [];
let allActiveModels = []; // مصفوفة جديدة تخزن كل الموديلات لحساب المخزون الشامل

const statusConfig = {
    'created': { text: 'مُنشأ', color: 'text-devo-gray bg-devo-gray/10 border border-devo-gray/30' },
    'in_progress': { text: 'جاري العمل', color: 'text-devo-orange bg-devo-orange/10 border border-devo-orange/30' },
    'registered': { text: 'مسجل', color: 'text-blue-400 bg-blue-500/10 border border-blue-500/30' },
    'preparing': { text: 'تجهيز', color: 'text-purple-400 bg-purple-500/10 border border-purple-500/30' },
    'shipped': { text: 'مشحون', color: 'text-green-400 bg-green-500/10 border border-green-500/30' },
    'delivered': { text: 'مُسلم', color: 'text-devo-success bg-devo-success/10 border border-devo-success/30' }
};

window.setDashDatePreset = (preset) => {
    try {
        const today = new Date();
        const fromInput = document.getElementById('dash-date-from');
        const toInput = document.getElementById('dash-date-to');

        if (fromInput && toInput) {
            if (preset === 'today') {
                const d = today.toISOString().split('T')[0];
                fromInput.value = d;
                toInput.value = d;
            } else if (preset === 'month') {
                const y = today.getFullYear();
                const m = String(today.getMonth() + 1).padStart(2, '0');
                fromInput.value = `${y}-${m}-01`;
                toInput.value = new Date(y, today.getMonth() + 1, 0).toISOString().split('T')[0];
            } else if (preset === 'all') {
                fromInput.value = '';
                toInput.value = '';
            }
        }
        applyDashFilters();
    } catch (err) {
        console.error('Date Preset Error:', err);
        applyDashFilters();
    }
};

export async function initDashboard() {
    if (isInitialized) return;

    try {
        document.getElementById('dash-date-from')?.addEventListener('change', applyDashFilters);
        document.getElementById('dash-date-to')?.addEventListener('change', applyDashFilters);

        window.setDashDatePreset('month');

        await fetchDashboardData();
        setupDashboardRealtime();

        isInitialized = true;
    } catch (err) {
        console.error('❌ خطأ أثناء تشغيل الداشبورد:', err);
    }
}

// ==========================================
// 🌟 1. المسح الشامل لقاعدة البيانات 🌟
// ==========================================
async function fetchDashboardData() {
    // 1. جلب الأوردرات ومعها عناصر الأوردر لحساب "إجمالي القطع المباعة" بدقة
    const { data: ordersData } = await supabase
        .from('orders')
        .select(`
            id, total_price, status, created_at, total_series,
            order_items(quantity, models(classes(class_sizes(size_id)), model_sizes(size_id)))
        `);
    
    allDashboardOrders = ordersData || [];

    // 2. جلب كل الموديلات النشطة مع مخزونها لحساب "القيمة الكلية" و "المتبقي" 
    let fetchedModels = [];
    let from = 0;
    const step = 999;
    let hasMore = true;

    while(hasMore) {
        const { data } = await supabase.from('models')
            .select(`id, name, system_code, factory_code, price, is_active, classes(class_sizes(size_id)), model_sizes(size_id), model_inventory(color_id, available_series, colors(name))`)
            .eq('is_active', true)
            .range(from, from + step);
        
        if(data && data.length > 0) {
            fetchedModels.push(...data);
            from += step + 1;
        }
        if(!data || data.length <= step) hasMore = false;
    }
    allActiveModels = fetchedModels;

    applyDashFilters();
    renderLowStockTable();
}

// ==========================================
// 🌟 2. الرادار اللحظي الشامل 🌟
// ==========================================
function setupDashboardRealtime() {
    supabase.channel('dashboard_tracker')
        // مراقبة حركة الأوردرات
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async (payload) => {
            if (payload.eventType === 'DELETE') {
                allDashboardOrders = allDashboardOrders.filter(o => o.id !== payload.old.id);
                applyDashFilters();
            } else {
                // في حالة إضافة أو تعديل أوردر، نجلبه بالتفصيل لحساب القطع بدقة
                const { data } = await supabase.from('orders')
                    .select(`id, total_price, status, created_at, total_series, order_items(quantity, models(classes(class_sizes(size_id)), model_sizes(size_id)))`)
                    .eq('id', payload.new.id).single();
                
                if (data) {
                    const idx = allDashboardOrders.findIndex(o => o.id === data.id);
                    if (idx > -1) allDashboardOrders[idx] = data;
                    else allDashboardOrders.push(data);
                    applyDashFilters();
                }
            }
        })
        // مراقبة الموديلات (تنشيط، تعطيل، إضافة)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, async (payload) => {
            if (payload.eventType === 'DELETE') {
                allActiveModels = allActiveModels.filter(m => m.id !== payload.old.id);
                applyDashFilters(); 
                renderLowStockTable();
                return;
            }
            const { data } = await supabase.from('models')
                .select(`id, name, system_code, factory_code, price, is_active, classes(class_sizes(size_id)), model_sizes(size_id), model_inventory(color_id, available_series, colors(name))`)
                .eq('id', payload.new.id).single();
            
            if (data) {
                const idx = allActiveModels.findIndex(m => m.id === data.id);
                if (data.is_active) {
                    if (idx > -1) allActiveModels[idx] = data;
                    else allActiveModels.push(data);
                } else {
                    if (idx > -1) allActiveModels.splice(idx, 1);
                }
                applyDashFilters();
                renderLowStockTable();
            }
        })
        // مراقبة سحب وإضافة المخزون
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'model_inventory' }, (payload) => {
            const mIdx = allActiveModels.findIndex(m => m.id === payload.new.model_id);
            if (mIdx > -1) {
                const iIdx = allActiveModels[mIdx].model_inventory?.findIndex(i => i.color_id === payload.new.color_id);
                if (iIdx > -1) {
                    allActiveModels[mIdx].model_inventory[iIdx].available_series = payload.new.available_series;
                }
                applyDashFilters();
                renderLowStockTable();
            }
        })
        .subscribe();
}

// ==========================================
// 🌟 3. الفلترة والحسابات المعقدة 🌟
// ==========================================
function applyDashFilters() {
    const dateFrom = document.getElementById('dash-date-from')?.value;
    const dateTo = document.getElementById('dash-date-to')?.value;

    const filteredOrders = allDashboardOrders.filter(o => {
        if (dateFrom || dateTo) {
            const oDate = new Date(o.created_at);
            oDate.setHours(0,0,0,0);
            if (dateFrom && oDate < new Date(dateFrom)) return false;
            if (dateTo && oDate > new Date(dateTo)) return false;
        }
        return true;
    });

    updateDashStats(filteredOrders);
}

function updateDashStats(orders) {
    let totalSales = 0, totalOrders = orders.length, soldSeries = 0, soldPieces = 0;
    let statuses = { 'created': 0, 'in_progress': 0, 'registered': 0, 'preparing': 0, 'shipped': 0, 'delivered': 0 };

    // حساب المبيعات (أموال + سريات + قطع)
    orders.forEach(o => {
        totalSales += (o.total_price || 0);
        soldSeries += (o.total_series || 0);
        if (statuses[o.status] !== undefined) statuses[o.status]++;
        
        o.order_items?.forEach(item => {
            const sizesCount = item.models?.classes?.class_sizes?.length || item.models?.model_sizes?.length || 1;
            soldPieces += (item.quantity * sizesCount);
        });
    });

    // حساب المخزون (موديلات + قيمة + متبقي)
    let totalModelsCount = allActiveModels.length;
    let totalStockValue = 0;
    let remainingSeries = 0;
    let remainingPieces = 0;

    allActiveModels.forEach(m => {
        const sizesCount = m.classes?.class_sizes?.length || m.model_sizes?.length || 1;
        m.model_inventory?.forEach(inv => {
            const qty = inv.available_series || 0;
            remainingSeries += qty;
            remainingPieces += (qty * sizesCount);
            totalStockValue += (qty * (m.price || 0));
        });
    });

    const animateUpdate = (id, val) => {
        const el = document.getElementById(id);
        if (el && el.textContent !== String(val)) {
            el.textContent = val;
            el.classList.add('text-devo-orange', 'scale-110', 'transition-all', 'duration-300');
            setTimeout(() => el.classList.remove('text-devo-orange', 'scale-110'), 500);
        }
    };

    // تطبيق الأرقام على الشاشة
    animateUpdate('dash-stat-total-models', totalModelsCount);
    animateUpdate('dash-stat-total-sales', totalSales.toLocaleString());
    animateUpdate('dash-stat-stock-value', totalStockValue.toLocaleString());
    animateUpdate('dash-stat-orders-count', totalOrders);
    animateUpdate('dash-stat-sold-series', soldSeries);
    animateUpdate('dash-stat-sold-pieces', `(يوازي ${soldPieces} قطعة مباعة)`);
    animateUpdate('dash-stat-remaining-series', remainingSeries);
    animateUpdate('dash-stat-remaining-pieces', `(يوازي ${remainingPieces} قطعة متبقية)`);

    Object.keys(statuses).forEach(key => animateUpdate(`dash-stat-${key}`, statuses[key]));
}

// ==========================================
// 🌟 4. رسم جدول المخزون الحرج 🌟
// ==========================================
function renderLowStockTable() {
    const tbody = document.getElementById('dash-low-stock-tbody');
    if (!tbody) return;

    let lowStock = [];
    allActiveModels.forEach(m => {
        m.model_inventory?.forEach(inv => {
            if (inv.available_series < 5) {
                lowStock.push({
                    model_id: m.id,
                    model_name: m.name,
                    factory_code: m.factory_code,
                    system_code: m.system_code,
                    color_name: inv.colors?.name,
                    available_series: inv.available_series
                });
            }
        });
    });

    const sorted = lowStock.sort((a, b) => a.available_series - b.available_series);

    if (sorted.length === 0) {
        tbody.innerHTML = `<tr><td colspan=\"4\" class=\"p-10 text-center text-devo-success border-none\"><i class=\"ph ph-check-circle text-4xl block mb-2\"></i> جميع الموديلات النشطة بها مخزون كافي</td></tr>`;
        return;
    }

    tbody.innerHTML = sorted.map(i => {
        const qty = parseInt(i.available_series) || 0;
        const isOut = qty === 0;
        const colorBadge = isOut ? 'bg-devo-error/20 text-devo-error border border-devo-error/30' : 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30';
        const statusText = isOut ? 'نفذت الكمية' : 'كمية حرجة';

        return `
            <tr class=\"hover:bg-devo-black/50 transition-colors animate-fade-in\">
                <td class=\"p-3\">
                    <span class=\"text-white font-bold block\" title=\"${i.model_name || '-'}\">${i.model_name || '-'}</span>
                    <span class=\"text-[10px] text-devo-muted font-mono mt-0.5\">${i.factory_code || i.system_code || '-'}</span>
                </td>
                <td class=\"p-3 text-devo-muted text-xs\">${i.color_name || '-'}</td>
                <td class=\"p-3 text-center font-black ${isOut ? 'text-devo-error' : 'text-yellow-500'}\">${qty}</td>
                <td class=\"p-3 text-center\">
                    <span class=\"px-2 py-1 rounded text-[10px] font-bold ${colorBadge}\">${statusText}</span>
                </td>
            </tr>
        `;
    }).join('');
}