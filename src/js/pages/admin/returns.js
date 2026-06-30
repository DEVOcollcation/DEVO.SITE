import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { getCurrentSession } from '../../services/auth.js';

let isInitialized = false;
let allReturns = [];
let currentUserProfile = null;

export async function initReturnsView() {
    if (isInitialized) {
        await fetchReturns();
        return;
    }

    const { session } = getCurrentSession();
    if (session) currentUserProfile = session.user;

    // Setup filter event listeners
    document.getElementById('ret-search')?.addEventListener('input', applyReturnsFilters);
    document.getElementById('ret-date-from')?.addEventListener('input', applyReturnsFilters);
    document.getElementById('ret-date-to')?.addEventListener('input', applyReturnsFilters);

    await fetchReturns();
    setupRealtimeReturns();

    isInitialized = true;
}

// Global functions exposed to window
window.refreshReturnsList = async () => {
    await fetchReturns();
};

window.viewReturnDetails = (id) => {
    const r = allReturns.find(x => x.id === id);
    if (!r) return;

    const dateStr = new Date(r.created_at).toLocaleString('ar-EG', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    let itemsHtml = r.return_items.map(item => {
        const code = item.models?.factory_code || item.models?.system_code || '';
        return `
            <tr class="border-b border-devo-gray last:border-0 hover:bg-devo-black/50 transition-colors">
                <td class="py-2.5 px-3 text-white text-sm font-bold">${item.models?.name || 'موديل محذوف'} <span class="text-devo-muted text-[10px] font-mono mr-1">(${code})</span></td>
                <td class="py-2.5 px-3 text-devo-info text-xs">${item.colors?.name || '-'}</td>
                <td class="py-2.5 px-3 text-white font-black text-center">${item.quantity}</td>
                <td class="py-2.5 px-3 text-devo-muted text-center">${item.price_per_series}</td>
                <td class="py-2.5 px-3 text-devo-orange font-black text-left text-base">${item.total_price}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('ret-details-content').innerHTML = `
        <div class="flex flex-col gap-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0">
                <div class="bg-devo-black p-3 rounded-xl border border-devo-gray flex flex-col justify-center">
                    <span class="text-[10px] text-devo-muted mb-1"><i class="ph ph-user"></i> بيانات العميل</span>
                    <h4 class="text-white font-bold text-sm truncate">${r.customer_name}</h4>
                    <span class="text-xs text-devo-muted mt-0.5">رقم الأوردر الأصلي: <span class="text-devo-orange font-mono font-bold">${r.orders?.invoice_number || '-'}</span></span>
                </div>
                <div class="bg-devo-black p-3 rounded-xl border border-devo-gray flex flex-col justify-center">
                    <span class="text-[10px] text-devo-muted mb-1"><i class="ph ph-receipt"></i> معلومات المرتجع</span>
                    <h4 class="text-devo-orange font-mono font-bold text-sm truncate">${r.return_number}</h4>
                    <span class="text-[11px] text-devo-muted mt-0.5">المستلم: <span class="text-white">${r.system_users?.full_name || '-'}</span></span>
                </div>
                <div class="bg-devo-black p-3 rounded-xl border border-devo-gray flex flex-col justify-center space-y-1">
                    <div class="flex justify-between text-xs"><span class="text-devo-muted">إجمالي المرتجع:</span> <span class="text-devo-success font-black text-sm">${r.refund_amount} ج.م</span></div>
                    <div class="flex justify-between text-xs"><span class="text-devo-muted">عدد السريات:</span> <span class="text-white font-bold">${r.total_series}</span></div>
                    <div class="flex justify-between text-xs"><span class="text-devo-muted">التاريخ:</span> <span class="text-white font-mono text-[10px]">${dateStr}</span></div>
                </div>
            </div>

            ${r.notes ? `
            <div class="bg-devo-black p-3 rounded-xl border border-devo-gray">
                <span class="text-[10px] text-devo-muted block mb-1">ملاحظات / سبب المرتجع:</span>
                <p class="text-xs text-white leading-relaxed">${r.notes}</p>
            </div>
            ` : ''}

            <div class="border border-devo-gray rounded-xl bg-devo-black max-h-[45vh] overflow-y-auto custom-scrollbar">
                <table class="w-full text-right text-sm">
                    <thead class="text-xs text-devo-muted bg-devo-dark sticky top-0 z-10">
                        <tr><th class="p-3">الموديل</th><th class="p-3">اللون</th><th class="p-3 text-center">الكمية</th><th class="p-3 text-center">سعر السرية</th><th class="p-3 text-left">إجمالي المرتجع</th></tr>
                    </thead>
                    <tbody class="divide-y divide-devo-gray">
                        ${itemsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Setup print button event
    document.getElementById('ret-btn-print').onclick = () => {
        printReturnInvoice(r);
    };

    const modal = document.getElementById('return-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeReturnDetailsModal = () => {
    const modal = document.getElementById('return-details-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

async function fetchReturns() {
    const tBody = document.getElementById('ret-table-body');
    if (tBody && allReturns.length === 0) {
        tBody.innerHTML = `<tr><td colspan="8" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i></td></tr>`;
    }

    const { data, error } = await supabase
        .from('returns')
        .select(`
            *,
            system_users!worker_id (full_name),
            orders!order_id (invoice_number),
            return_items (
                *,
                models (name, factory_code, system_code),
                colors (id, name, color_code)
            )
        `)
        .order('created_at', { ascending: false });

    if (!error && data) {
        allReturns = data;
        updateReturnsStats();
        applyReturnsFilters();
    } else if (error) {
        showToast('حدث خطأ أثناء جلب المرتجعات', 'error');
        console.error(error);
    }
}

function applyReturnsFilters() {
    const term = document.getElementById('ret-search')?.value.toLowerCase() || '';
    const dateFrom = document.getElementById('ret-date-from')?.value;
    const dateTo = document.getElementById('ret-date-to')?.value;

    const filtered = allReturns.filter(r => {
        if (term && !r.return_number.toLowerCase().includes(term) 
                 && !r.customer_name.toLowerCase().includes(term) 
                 && !(r.orders?.invoice_number || '').toLowerCase().includes(term)
                 && !(r.system_users?.full_name || '').toLowerCase().includes(term)) return false;

        if (dateFrom || dateTo) {
            const rDate = new Date(r.created_at);
            rDate.setHours(0, 0, 0, 0);
            if (dateFrom && rDate < new Date(dateFrom)) return false;
            if (dateTo && rDate > new Date(dateTo)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('ret-table-body');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="p-10 text-center text-devo-muted">لا توجد مرتجعات تطابق بحثك.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(r => {
        const dateStr = new Date(r.created_at).toLocaleString('ar-EG', {
            year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        return `
            <tr class="hover:bg-devo-black/40 transition-colors">
                <td class="p-4 font-mono text-devo-orange font-bold text-xs">${r.return_number}</td>
                <td class="p-4 font-mono text-devo-muted text-xs">${r.orders?.invoice_number || '-'}</td>
                <td class="p-4 font-bold text-white text-xs">${r.customer_name}</td>
                <td class="p-4 text-center text-white font-black">${r.total_series}</td>
                <td class="p-4 text-center text-devo-success font-bold">${r.refund_amount} ج.م</td>
                <td class="p-4 text-devo-muted text-[10px]">${dateStr}</td>
                <td class="p-4 text-devo-muted text-[11px]"><i class="ph-fill ph-user-circle"></i> ${r.system_users?.full_name || '-'}</td>
                <td class="p-4">
                    <div class="flex items-center justify-center gap-1.5">
                        <button onclick="window.viewReturnDetails('${r.id}')" class="p-1.5 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded transition-colors" title="التفاصيل"><i class="ph ph-eye text-lg"></i></button>
                        <button onclick="window.printSingleReturnDirectly('${r.id}')" class="p-1.5 bg-gray-200 text-gray-800 hover:bg-white rounded transition-colors" title="طباعة الفاتورة"><i class="ph ph-printer text-lg"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

window.printSingleReturnDirectly = (id) => {
    const r = allReturns.find(x => x.id === id);
    if (r) printReturnInvoice(r);
};

function updateReturnsStats() {
    let count = allReturns.length;
    let amount = 0;
    let series = 0;

    allReturns.forEach(r => {
        amount += Number(r.refund_amount) || 0;
        series += Number(r.total_series) || 0;
    });

    const countEl = document.getElementById('ret-stat-count');
    const amountEl = document.getElementById('ret-stat-amount');
    const seriesEl = document.getElementById('ret-stat-series');

    if (countEl) countEl.textContent = count;
    if (amountEl) amountEl.textContent = amount.toLocaleString() + ' ج.م';
    if (seriesEl) seriesEl.textContent = series;
}

function setupRealtimeReturns() {
    supabase.channel('returns_realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'returns' }, () => {
            fetchReturns();
        })
        .subscribe();
}

function printReturnInvoice(r) {
    showToast('جاري تحضير المرتجع للطباعة...', 'info');
    const printDate = new Date(r.created_at);
    const dateString = `${printDate.getFullYear()}-${String(printDate.getMonth() + 1).padStart(2, '0')}-${String(printDate.getDate()).padStart(2, '0')}`;
    const pdfFileName = `مرتجع_${r.customer_name}_${dateString}`;

    let itemsHtml = r.return_items.map((item, idx) => {
        const code = item.models?.factory_code || item.models?.system_code || '';
        return `
            <tr>
                <td style="text-align: center; font-weight: bold;">${idx + 1}</td>
                <td style="font-weight: bold;">${item.models?.name || 'موديل محذوف'} ${code ? `<span class="code-span">(${code})</span>` : ''}</td>
                <td style="font-size: 11px; text-align: center;">${item.colors?.name || '-'}</td>
                <td style="text-align: center; font-weight: bold;">${item.quantity}</td>
                <td style="text-align: center;">${item.price_per_series}</td>
                <td style="text-align: center; font-weight: 900; background-color: #f5f5f5 !important; -webkit-print-color-adjust: exact;">${item.total_price}</td>
            </tr>
        `;
    }).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>${pdfFileName}</title>
            <style>
                @page { size: A4 portrait; margin: 0.5cm; }
                body { font-family: 'Tahoma', 'Arial', sans-serif; font-size: 12px; color: black; background: white; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .erp-header { border-bottom: 2px solid black; padding-bottom: 4px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
                .erp-header h1 { margin: 0; font-size: 18px; font-weight: 900; letter-spacing: 1px; line-height: 1; }
                .erp-header p { margin: 2px 0 0 0; font-size: 10px; font-weight: bold; }
                .erp-header .title-box { text-align: left; }
                .erp-header .title-box h2 { margin: 0; font-size: 14px; font-weight: bold; background: #eee; padding: 2px 6px; border: 1px solid #000; border-radius: 3px; }
                .erp-info { display: flex; justify-content: space-between; border-bottom: 1px solid black; padding-bottom: 4px; margin-bottom: 6px; font-size: 11px; line-height: 1.4; }
                .erp-info div { width: 48%; }
                .erp-info .left-col { text-align: left; }
                .erp-table { width: 100%; border-collapse: collapse; border: 1.5px solid #000; margin-bottom: 8px; }
                .erp-table thead { display: table-header-group; background-color: #e5e5e5; }
                .erp-table th { border: 1px solid #666; padding: 3px 4px; font-size: 11px; color: black; }
                .erp-table td { border: 1px solid #aaa; padding: 2px 4px; line-height: 1.1; vertical-align: middle; }
                .erp-table tbody tr { page-break-inside: avoid; height: 22px; }
                .erp-summary { display: flex; justify-content: flex-end; margin-top: 8px; }
                .erp-summary-box { width: 33%; border: 1.5px solid #000; border-radius: 4px; overflow: hidden; }
                .erp-summary-row { display: flex; justify-content: space-between; padding: 3px 6px; border-bottom: 1px solid #aaa; font-size: 11px; }
                .erp-summary-row:last-child { border-bottom: none; background: #000; color: #fff; font-weight: bold; }
                .erp-footer { margin-top: 15px; border-top: 1px dashed #999; padding-top: 4px; text-align: center; font-size: 8px; color: #555; }
                .code-span { font-family: monospace; font-size: 10px; color: #333; margin-right: 4px; }
                .notes-box { margin-top: 8px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 10px; line-height: 1.3; }
            </style>
        </head>
        <body>
            <div class="erp-header">
                <div>
                    <h1>DEVO <span style="font-size: 9px; font-weight: bold; background: #eee; padding: 1px 3px; border-radius: 2px;">Collection</span></h1>
                    <p>هاتف: +20 12 12751111</p>
                </div>
                <div class="title-box">
                    <h2>فاتورة مرتجع مبيعات</h2>
                    <p style="text-align: left; font-size: 9px; margin-top: 2px;">رقم: <span style="color: red; font-weight: 900;">${r.return_number}</span></p>
                </div>
            </div>

            <div class="erp-info">
                <div>
                    <strong>العميل:</strong> ${r.customer_name} <br>
                    <strong>رقم الأوردر الأصلي:</strong> ${r.orders?.invoice_number || '-'}
                </div>
                <div class="left-col">
                    <strong>التاريخ:</strong> ${printDate.toLocaleDateString('ar-EG')} ${printDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })} <br>
                    <strong>المستلم:</strong> ${r.system_users?.full_name || '-'}
                </div>
            </div>

            <table class="erp-table">
                <thead>
                    <tr>
                        <th style="width: 30px;">م</th>
                        <th>الموديل</th>
                        <th style="width: 100px;">اللون</th>
                        <th style="width: 70px;">الكمية (سرايات)</th>
                        <th style="width: 80px;">سعر السرية</th>
                        <th style="width: 90px;">الإجمالي</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            ${r.notes ? `
            <div class="notes-box">
                <strong>ملاحظات المرتجع:</strong> ${r.notes}
            </div>
            ` : ''}

            <div class="erp-summary">
                <div class="erp-summary-box">
                    <div class="erp-summary-row">
                        <span>إجمالي السريات المرتجعة:</span>
                        <strong>${r.total_series}</strong>
                    </div>
                    <div class="erp-summary-row">
                        <span>إجمالي المبلغ المسترد:</span>
                        <strong>${r.refund_amount} ج.م</strong>
                    </div>
                </div>
            </div>

            <div class="erp-footer">
                Engineered by Ahmed M. Attia | DEVO Collection &copy; ${new Date().getFullYear()}
            </div>
        </body>
        </html>
    `;

    // Render print iframe
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '-9999px';
    iframe.style.bottom = '-9999px';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    iframe.onload = function() {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        setTimeout(() => { document.body.removeChild(iframe); }, 1000);
    };
}
