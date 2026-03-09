import { supabase } from '../../config/supabase.js';

let isInitialized = false;
let allDashboardOrders = [];
let allDashboardInventory = [];

const statusConfig = {
    'created': { text: 'مُنشأ', color: 'text-devo-gray bg-devo-gray/10 border border-devo-gray/30' },
    'in_progress': { text: 'جاري العمل', color: 'text-devo-orange bg-devo-orange/10 border border-devo-orange/30' },
    'registered': { text: 'مسجل', color: 'text-blue-400 bg-blue-500/10 border border-blue-500/30' },
    'preparing': { text: 'تجهيز', color: 'text-purple-400 bg-purple-500/10 border border-purple-500/30' },
    'shipped': { text: 'مشحون', color: 'text-green-400 bg-green-500/10 border border-green-500/30' },
    'delivered': { text: 'مُسلم', color: 'text-devo-success bg-devo-success/10 border border-devo-success/30' }
};

// 🌟 تعريف دوال الفلاتر على مستوى الـ window لمنع خطأ undefined 🌟
window.setDashDatePreset = (preset) => {
    const today = new Date();
    const fromInput = document.getElementById('dash-date-from');
    const toInput = document.getElementById('dash-date-to');

    const formatDate = (dateObj) => {
        const d = new Date(dateObj);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().split('T')[0];
    };

    if (preset === 'today') {
        fromInput.value = formatDate(today);
        toInput.value = formatDate(today);
    } else if (preset === 'week') {
        const firstDay = new Date(today.setDate(today.getDate() - today.getDay()));
        fromInput.value = formatDate(firstDay);
        toInput.value = formatDate(new Date());
    } else if (preset === 'month') {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        fromInput.value = formatDate(firstDay);
        toInput.value = formatDate(new Date());
    } else {
        fromInput.value = '';
        toInput.value = '';
    }
    
    // تلوين الزر النشط
    document.querySelectorAll('#view-dashboard button').forEach(b => {
        if(b.textContent === 'اليوم' || b.textContent === 'الأسبوع' || b.textContent === 'الشهر' || b.textContent === 'الكل') {
            b.classList.remove('text-devo-orange');
            b.classList.add('text-devo-muted');
        }
    });
    if(event && event.currentTarget) {
        event.currentTarget.classList.add('text-devo-orange');
        event.currentTarget.classList.remove('text-devo-muted');
    }

    window.applyDashboardFilters();
};

window.applyDashboardFilters = () => {
    const dateFrom = document.getElementById('dash-date-from').value;
    const dateTo = document.getElementById('dash-date-to').value;

    let filteredOrders = allDashboardOrders;

    // 🌟 حماية فروق التوقيت (Timezone Proof) 🌟
    if (dateFrom || dateTo) {
        filteredOrders = allDashboardOrders.filter(o => {
            const oDate = new Date(o.created_at);
            
            let isValid = true;
            if (dateFrom) {
                const [y, m, d] = dateFrom.split('-');
                const fDate = new Date(y, m - 1, d, 0, 0, 0, 0); // بداية اليوم
                if (oDate < fDate) isValid = false;
            }
            if (dateTo) {
                const [y, m, d] = dateTo.split('-');
                const tDate = new Date(y, m - 1, d, 23, 59, 59, 999); // نهاية اليوم
                if (oDate > tDate) isValid = false;
            }
            return isValid;
        });
    }

    calculateStatistics(filteredOrders);
    renderRecentOrders(filteredOrders.slice(0, 50));
};

export async function initDashboard() {
    if (isInitialized) return;

    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('dash-current-date').textContent = new Date().toLocaleDateString('ar-EG', options);

    await fetchDashboardData();

    // تشغيل فلتر "الكل" كافتراضي لتظهر كل الإحصائيات
    window.setDashDatePreset('all');

    // استماع لحظي قوي
    supabase.channel('dashboard_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchDashboardData)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'model_inventory' }, fetchDashboardData)
        .subscribe();

    isInitialized = true;
}

async function fetchDashboardData() {
    const [ordersRes, inventoryRes] = await Promise.all([
        supabase.from('orders').select(`
            *,
            order_items (
                *,
                models (name, factory_code, system_code, model_sizes(size_id))
            )
        `).order('created_at', { ascending: false }),
        
        supabase.from('model_inventory').select(`
            available_series,
            colors (name),
            models (name, factory_code, system_code)
        `).order('available_series', { ascending: true })
    ]);

    if (ordersRes.error) console.error("Orders Fetch Error:", ordersRes.error);
    if (inventoryRes.error) console.error("Inventory Fetch Error:", inventoryRes.error);

    allDashboardOrders = ordersRes.data || [];
    allDashboardInventory = inventoryRes.data || [];

    renderLowStock(allDashboardInventory);
    window.applyDashboardFilters();
}

function calculateStatistics(orders) {
    let totalRev = 0, totalCollected = 0, totalDebts = 0;
    let totalSeries = 0, totalPieces = 0, inProgress = 0;

    orders.forEach(o => {
        const orderTotal = o.total_price || 0;
        const deposit = o.deposit || 0;
        
        totalRev += orderTotal;
        totalCollected += deposit;
        totalDebts += (orderTotal - deposit);
        
        if (['in_progress', 'registered', 'preparing'].includes(o.status)) inProgress++;

        // 🌟 حماية لحساب السريات بشكل دقيق سواء كان اسم الحقل quantity أو series_quantity 🌟
        let orderSeries = 0;
        let orderPieces = 0;

        if (o.order_items && o.order_items.length > 0) {
            o.order_items.forEach(item => {
                const qty = item.series_quantity || item.quantity || 0; 
                const sizesCount = item.models?.model_sizes?.length || 1;
                orderSeries += qty;
                orderPieces += (qty * sizesCount);
            });
        } else {
            orderSeries = o.total_series || 0;
            orderPieces = orderSeries * 5; 
        }

        totalSeries += orderSeries;
        totalPieces += orderPieces;
    });

    const avgOrder = orders.length > 0 ? Math.round(totalRev / orders.length) : 0;

    document.getElementById('dash-total-orders').textContent = orders.length;
    document.getElementById('dash-total-rev').textContent = totalRev.toLocaleString();
    document.getElementById('dash-total-collected').textContent = totalCollected.toLocaleString();
    document.getElementById('dash-total-debts').textContent = totalDebts.toLocaleString();
    document.getElementById('dash-total-series').textContent = totalSeries.toLocaleString();
    document.getElementById('dash-total-pieces').textContent = totalPieces.toLocaleString();
    document.getElementById('dash-avg-order').textContent = avgOrder.toLocaleString();
    document.getElementById('dash-in-progress').textContent = inProgress;
}

function renderRecentOrders(orders) {
    const tbody = document.getElementById('dash-recent-orders');
    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-devo-muted border-none">لا توجد أوردرات في هذه الفترة.</td></tr>`;
        return;
    }

    tbody.innerHTML = orders.map(o => {
        const status = statusConfig[o.status] || { text: o.status || 'مُنشأ', color: 'text-white' };
        const dateStr = new Date(o.created_at).toLocaleDateString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit' });
        
        let rowSeries = o.total_series || 0;
        if (!rowSeries && o.order_items) {
            rowSeries = o.order_items.reduce((sum, item) => sum + (item.series_quantity || item.quantity || 0), 0);
        }

        return `
            <tr class="hover:bg-devo-black/50 transition-colors">
                <td class="p-3 font-mono text-devo-orange font-bold">${o.invoice_number || '-'}</td>
                <td class="p-3">
                    <span class="text-white block truncate max-w-[120px]" title="${o.customer_name}">${o.customer_name}</span>
                    <span class="text-[10px] text-devo-muted">${dateStr}</span>
                </td>
                <td class="p-3 text-center font-bold text-white">${rowSeries}</td>
                <td class="p-3 text-center text-devo-info font-bold">${o.total_price || 0}</td>
                <td class="p-3 text-center"><span class="px-2 py-1 rounded text-[10px] ${status.color}">${status.text}</span></td>
            </tr>
        `;
    }).join('');
}

function renderLowStock(inventory) {
    const tbody = document.getElementById('dash-low-stock');
    
    // 🌟 حماية تحويل القيمة لرقم (ParseInt) لضمان ظهور أي رقم أقل من 5 🌟
    const lowStock = inventory.filter(i => {
        const qty = parseInt(i.available_series) || 0;
        return qty < 5;
    });

    if (lowStock.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-10 text-center text-devo-success border-none"><i class="ph ph-check-circle text-4xl block mb-2"></i> المخزون بحالة ممتازة</td></tr>`;
        return;
    }

    tbody.innerHTML = lowStock.map(i => {
        const qty = parseInt(i.available_series) || 0;
        const isOut = qty === 0;
        const colorBadge = isOut ? 'bg-devo-error/20 text-devo-error border border-devo-error/30' : 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30';
        const statusText = isOut ? 'نفذت الكمية' : 'كمية حرجة';

        return `
            <tr class="hover:bg-devo-black/50 transition-colors">
                <td class="p-3">
                    <span class="text-white font-bold block truncate max-w-[140px]" title="${i.models?.name || '-'}">${i.models?.name || '-'}</span>
                    <span class="text-[10px] text-devo-muted font-mono">${i.models?.factory_code || i.models?.system_code || '-'}</span>
                </td>
                <td class="p-3 text-devo-info text-xs">${i.colors?.name || '-'}</td>
                <td class="p-3 text-center font-black text-lg ${isOut ? 'text-devo-error' : 'text-yellow-500'}">${qty}</td>
                <td class="p-3 text-center"><span class="px-2 py-1 rounded text-[10px] ${colorBadge}">${statusText}</span></td>
            </tr>
        `;
    }).join('');
}