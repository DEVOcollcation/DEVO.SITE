import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { printHtmlInIframe } from '../../utils/print.js';

let isInitialized = false;
let allDepositOrders = [];
let filteredDepositOrders = [];
let depositRealtimeChannel = null;

export async function initDepositReportsView() {
    if (!isInitialized) {
        setupEventListeners();
        setupRealtimeSubscription();
        isInitialized = true;
    }

    // تعيين التاريخ الافتراضي (اليوم) عند فتح الصفحة أول مرة
    const periodSelect = document.getElementById('dr-period-select');
    if (periodSelect && !periodSelect.value) {
        periodSelect.value = 'today';
    }
    
    updateDateInputsVisibility();
    await fetchDepositOrders();
}

function setupEventListeners() {
    const periodSelect = document.getElementById('dr-period-select');
    const dateFromInput = document.getElementById('dr-date-from');
    const dateToInput = document.getElementById('dr-date-to');
    const searchInput = document.getElementById('dr-search-input');
    const printBtn = document.getElementById('dr-print-btn');
    const refreshBtn = document.getElementById('dr-refresh-btn');

    if (periodSelect) {
        periodSelect.addEventListener('change', () => {
            updateDateInputsVisibility();
            applyDepositFilters();
        });
    }

    if (dateFromInput) dateFromInput.addEventListener('input', applyDepositFilters);
    if (dateToInput) dateToInput.addEventListener('input', applyDepositFilters);
    if (searchInput) searchInput.addEventListener('input', applyDepositFilters);

    if (printBtn) {
        printBtn.addEventListener('click', printDepositReport);
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.classList.add('animate-spin');
            await fetchDepositOrders();
            setTimeout(() => refreshBtn.classList.remove('animate-spin'), 600);
        });
    }
}

function updateDateInputsVisibility() {
    const periodSelect = document.getElementById('dr-period-select');
    const customDateContainer = document.getElementById('dr-custom-date-container');
    
    if (!periodSelect || !customDateContainer) return;

    if (periodSelect.value === 'custom') {
        customDateContainer.classList.remove('hidden');
        customDateContainer.classList.add('flex');
    } else {
        customDateContainer.classList.add('hidden');
        customDateContainer.classList.remove('flex');
    }
}

export async function fetchDepositOrders() {
    const tBody = document.getElementById('dr-table-body');
    if (tBody && allDepositOrders.length === 0) {
        tBody.innerHTML = `
            <tr>
                <td colspan="7" class="p-10 text-center text-devo-muted">
                    <i class="ph ph-spinner animate-spin text-3xl text-devo-orange mb-2 block"></i>
                    <span>جاري تحميل تقارير العربون...</span>
                </td>
            </tr>
        `;
    }

    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                system_users!worker_id (full_name)
            `)
            .gt('deposit', 0)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching deposit orders:', error);
            showToast('حدث خطأ أثناء جلب تقارير العربون', 'error');
            return;
        }

        allDepositOrders = data || [];
        applyDepositFilters();
    } catch (err) {
        console.error('Unexpected error fetching deposit orders:', err);
        showToast('خطأ غير متوقع في جلب بيانات العربون', 'error');
    }
}

function setupRealtimeSubscription() {
    if (depositRealtimeChannel) return;

    depositRealtimeChannel = supabase
        .channel('deposit-reports-changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders' },
            async () => {
                await fetchDepositOrders();
            }
        )
        .subscribe();
}

export function applyDepositFilters() {
    const periodValue = document.getElementById('dr-period-select')?.value || 'today';
    const dateFromVal = document.getElementById('dr-date-from')?.value;
    const dateToVal = document.getElementById('dr-date-to')?.value;
    const searchVal = (document.getElementById('dr-search-input')?.value || '').trim().toLowerCase();

    const now = new Date();
    let startDate = null;
    let endDate = null;

    if (periodValue === 'today') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (periodValue === 'week') {
        const temp = new Date(now);
        temp.setDate(temp.getDate() - 7);
        startDate = new Date(temp.getFullYear(), temp.getMonth(), temp.getDate(), 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (periodValue === 'custom') {
        if (dateFromVal) {
            const df = new Date(dateFromVal);
            startDate = new Date(df.getFullYear(), df.getMonth(), df.getDate(), 0, 0, 0, 0);
        }
        if (dateToVal) {
            const dt = new Date(dateToVal);
            endDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 999);
        }
    }

    filteredDepositOrders = allDepositOrders.filter(order => {
        // 1. تصفية التواريخ
        if (startDate || endDate) {
            const orderDate = new Date(order.created_at);
            if (startDate && orderDate < startDate) return false;
            if (endDate && orderDate > endDate) return false;
        }

        // 2. تصفية البحث النصي
        if (searchVal) {
            const orderNum = String(order.invoice_number || order.order_number || order.id || '').toLowerCase();
            const custName = String(order.customer_name || '').toLowerCase();
            const custPhone = String(order.customer_phone || order.phone_1 || order.phone || '').toLowerCase();
            const workerName = String(order.system_users?.full_name || '').toLowerCase();
            const receiverName = String(order.deposit_receiver || '').toLowerCase();

            const matches = orderNum.includes(searchVal) ||
                            custName.includes(searchVal) ||
                            custPhone.includes(searchVal) ||
                            workerName.includes(searchVal) ||
                            receiverName.includes(searchVal);

            if (!matches) return false;
        }

        return true;
    });

    renderDepositTable(filteredDepositOrders);
    updateDepositStats(filteredDepositOrders);
}

function renderDepositTable(orders) {
    const tBody = document.getElementById('dr-table-body');
    const tFooter = document.getElementById('dr-table-footer');
    if (!tBody) return;

    if (!orders || orders.length === 0) {
        tBody.innerHTML = `
            <tr>
                <td colspan="7" class="p-8 text-center text-devo-muted">
                    <i class="ph ph-ghost text-4xl mb-2 block text-devo-grayHover"></i>
                    <span>لا توجد تقارير عربون تطابق الخيارات المحددة</span>
                </td>
            </tr>
        `;
        if (tFooter) tFooter.innerHTML = '';
        return;
    }

    let totalDepositSum = 0;

    const rowsHtml = orders.map((o, idx) => {
        const depositVal = parseFloat(o.deposit) || 0;
        totalDepositSum += depositVal;

        const orderDateObj = new Date(o.created_at);
        const formattedDate = orderDateObj.toLocaleDateString('ar-EG', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        });
        const formattedTime = orderDateObj.toLocaleTimeString('ar-EG', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });

        const orderNumDisplay = o.invoice_number || o.order_number || o.id;
        const custName = o.customer_name || 'غير مسمى';
        const custPhone = o.customer_phone || o.phone_1 || '-';
        const workerName = o.system_users?.full_name || 'غير معروف';
        const depositReceiver = o.deposit_receiver || '-';

        return `
            <tr class="hover:bg-devo-dark/50 transition-colors border-b border-devo-gray/40 text-sm">
                <td class="px-4 py-3 font-mono font-bold text-devo-orange">#${orderNumDisplay}</td>
                <td class="px-4 py-3 whitespace-nowrap">
                    <div class="font-medium text-white">${formattedDate}</div>
                    <div class="text-xs text-devo-muted">${formattedTime}</div>
                </td>
                <td class="px-4 py-3 font-semibold text-white">${custName}</td>
                <td class="px-4 py-3 font-mono text-devo-muted" dir="ltr">${custPhone}</td>
                <td class="px-4 py-3 text-devo-text">${workerName}</td>
                <td class="px-4 py-3">
                    <span class="px-2.5 py-1 rounded-lg text-xs font-bold bg-devo-gray text-white border border-devo-grayHover inline-block">
                        ${depositReceiver}
                    </span>
                </td>
                <td class="px-4 py-3 font-bold text-devo-success text-base whitespace-nowrap">
                    ${depositVal.toLocaleString('ar-EG')} ج.م
                </td>
            </tr>
        `;
    }).join('');

    tBody.innerHTML = rowsHtml;

    if (tFooter) {
        tFooter.innerHTML = `
            <tr class="bg-devo-dark font-bold text-white border-t-2 border-devo-orange/50">
                <td colspan="6" class="px-4 py-3 text-left">إجمالي مبالغ العربون (المفلترة):</td>
                <td class="px-4 py-3 text-devo-success text-lg whitespace-nowrap">
                    ${totalDepositSum.toLocaleString('ar-EG')} ج.م
                </td>
            </tr>
        `;
    }
}

function updateDepositStats(orders) {
    const totalCountEl = document.getElementById('dr-stat-count');
    const totalSumEl = document.getElementById('dr-stat-sum');
    const avgDepositEl = document.getElementById('dr-stat-avg');

    const count = orders.length;
    const totalSum = orders.reduce((sum, o) => sum + (parseFloat(o.deposit) || 0), 0);
    const avg = count > 0 ? (totalSum / count) : 0;

    if (totalCountEl) totalCountEl.textContent = count.toLocaleString('ar-EG');
    if (totalSumEl) totalSumEl.textContent = `${totalSum.toLocaleString('ar-EG')} ج.م`;
    if (avgDepositEl) avgDepositEl.textContent = `${Math.round(avg).toLocaleString('ar-EG')} ج.م`;
}

function printDepositReport() {
    if (!filteredDepositOrders || filteredDepositOrders.length === 0) {
        showToast('لا توجد بيانات مطابقة للطباعة!', 'warning');
        return;
    }

    const periodSelect = document.getElementById('dr-period-select');
    const periodText = periodSelect ? periodSelect.options[periodSelect.selectedIndex].text : 'اليوم';
    const dateFromVal = document.getElementById('dr-date-from')?.value;
    const dateToVal = document.getElementById('dr-date-to')?.value;

    let periodSubtitle = `الفترة: ${periodText}`;
    if (periodSelect?.value === 'custom' && (dateFromVal || dateToVal)) {
        periodSubtitle += ` (${dateFromVal || 'البداية'} إلى ${dateToVal || 'الآن'})`;
    }

    const totalSum = filteredDepositOrders.reduce((sum, o) => sum + (parseFloat(o.deposit) || 0), 0);
    const currentDateStr = new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    const rowsHtml = filteredDepositOrders.map((o, idx) => {
        const orderDateObj = new Date(o.created_at);
        const formattedDate = orderDateObj.toLocaleDateString('ar-EG');
        const formattedTime = orderDateObj.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        const depositVal = parseFloat(o.deposit) || 0;

        return `
            <tr>
                <td style="padding: 4px 6px; border: 1px solid #333; text-align: center;">${idx + 1}</td>
                <td style="padding: 4px 6px; border: 1px solid #333; text-align: center; font-family: monospace; font-weight: bold;">#${o.invoice_number || o.order_number || o.id}</td>
                <td style="padding: 4px 6px; border: 1px solid #333; text-align: center;">${formattedDate} <span style="font-size: 10px; color: #555;">(${formattedTime})</span></td>
                <td style="padding: 4px 6px; border: 1px solid #333; font-weight: bold;">${o.customer_name || 'غير مسمى'}</td>
                <td style="padding: 4px 6px; border: 1px solid #333; text-align: center; font-family: monospace;" dir="ltr">${o.customer_phone || o.phone_1 || '-'}</td>
                <td style="padding: 4px 6px; border: 1px solid #333;">${o.system_users?.full_name || 'غير معروف'}</td>
                <td style="padding: 4px 6px; border: 1px solid #333; text-align: center;">${o.deposit_receiver || '-'}</td>
                <td style="padding: 4px 6px; border: 1px solid #333; text-align: center; font-weight: bold; background: #f0fdf4 !important; -webkit-print-color-adjust: exact;">${depositVal.toLocaleString('ar-EG')} ج.م</td>
            </tr>
        `;
    }).join('');

    const printHtml = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>تقرير_العربون_${new Date().toISOString().split('T')[0]}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;600;700;900&display=swap');
                @page {
                    size: A4 portrait;
                    margin: 0.5cm;
                }
                body {
                    font-family: 'Tajawal', sans-serif;
                    background: white;
                    color: black;
                    margin: 0;
                    padding: 0;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                    font-size: 11px;
                }
                .report-header {
                    border-bottom: 2px solid #000;
                    padding-bottom: 6px;
                    margin-bottom: 8px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .brand-title {
                    font-size: 20px;
                    font-weight: 900;
                    letter-spacing: 1px;
                }
                .report-title {
                    font-size: 16px;
                    font-weight: 700;
                    text-align: center;
                }
                .meta-info {
                    font-size: 10px;
                    color: #444;
                }
                .stats-bar {
                    display: flex;
                    gap: 15px;
                    background: #f8fafc;
                    border: 1px solid #cbd5e1;
                    padding: 6px 12px;
                    margin-bottom: 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-weight: 600;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-bottom: 10px;
                }
                th {
                    background: #1e293b !important;
                    color: white !important;
                    padding: 5px 6px;
                    font-size: 11px;
                    border: 1px solid #0f172a;
                    text-align: center;
                    -webkit-print-color-adjust: exact;
                }
                tr:nth-child(even) {
                    background: #f8fafc;
                    -webkit-print-color-adjust: exact;
                }
                .tfoot-sum {
                    background: #e2e8f0 !important;
                    font-weight: bold;
                    font-size: 12px;
                    -webkit-print-color-adjust: exact;
                }
                .report-footer {
                    margin-top: 15px;
                    display: flex;
                    justify-content: space-between;
                    font-size: 11px;
                    font-weight: 600;
                    border-top: 1px solid #ccc;
                    padding-top: 6px;
                }
            </style>
        </head>
        <body>
            <div class="report-header">
                <div>
                    <div class="brand-title">DEVO Collection</div>
                    <div class="meta-info">تقرير العربونات المالية المفلترة</div>
                </div>
                <div class="report-title">
                    <div>تقرير تفاصـيل العـربـون</div>
                    <div style="font-size: 11px; font-weight: normal; margin-top: 2px;">${periodSubtitle}</div>
                </div>
                <div class="meta-info" style="text-align: left;">
                    <div>تاريخ الطباعة:</div>
                    <div><b>${currentDateStr}</b></div>
                </div>
            </div>

            <div class="stats-bar">
                <div>عدد العمليات: <b>${filteredDepositOrders.length}</b></div>
                <div>إجمالي مبالغ العربون: <b>${totalSum.toLocaleString('ar-EG')} ج.م</b></div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 30px;">#</th>
                        <th style="width: 70px;">رقم الأوردر</th>
                        <th style="width: 110px;">التاريخ والوقت</th>
                        <th>اسم العميل</th>
                        <th style="width: 90px;">رقم العميل</th>
                        <th style="width: 100px;">أنشأ الأوردر</th>
                        <th style="width: 100px;">مستلم العربون</th>
                        <th style="width: 90px;">قيمة العربون</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                </tbody>
                <tfoot>
                    <tr class="tfoot-sum">
                        <td colspan="7" style="padding: 6px; border: 1px solid #333; text-align: left;">الإجمالي الكلي لجميع العربونات بالتقرير:</td>
                        <td style="padding: 6px; border: 1px solid #333; text-align: center; color: #15803d; font-size: 13px;">${totalSum.toLocaleString('ar-EG')} ج.م</td>
                    </tr>
                </tfoot>
            </table>

            <div class="report-footer">
                <div>إعداد لوحة التحكم | DEVO Systems</div>
                <div>اعتماد المسؤول: .......................................</div>
            </div>
        </body>
        </html>
    `;

    printHtmlInIframe(printHtml);
}
