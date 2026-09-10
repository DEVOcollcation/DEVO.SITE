export function printHtmlInIframe(htmlContent) {
    let iframe = document.getElementById('print-iframe');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'print-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);
    }
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();
    
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
    }, 500);
}

export function printOrderCustomerInvoice(o) {
    const remaining = o.total_price - (o.deposit || 0);
    const printDate = new Date(o.created_at);
    const dateString = `${printDate.getFullYear()}-${String(printDate.getMonth() + 1).padStart(2, '0')}-${String(printDate.getDate()).padStart(2, '0')}`;
    const pdfFileName = `${o.customer_name}_${o.phone_1}_${dateString}`;
    const groupedItems = {};
    
    o.order_items.forEach(item => {
        const modelId = item.model_id;
        const code = item.models?.factory_code || item.models?.system_code || '';
        const colorName = item.colors?.name || '-';
        const qty = Number(item.quantity) || 0;
        
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || (item.sizes_count > 1 ? Number(item.sizes_count) : 1)); 
        const pieces = qty * sizesCount;
        
        const colorWithQty = colorName; 

        const piecePrice = sizesCount > 0 ? Math.round((Number(item.price_per_series) / sizesCount) * 100) / 100 : (Number(item.piece_price) || Number(item.models?.price) || 0);

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = { 
                modelName: item.models?.name, 
                code: code, 
                colorsList: [colorWithQty], 
                totalQty: qty, 
                totalPieces: pieces, 
                price: piecePrice, 
                totalPrice: item.total_price 
            };
        } else {
            if (!groupedItems[modelId].colorsList.includes(colorWithQty)) {
                groupedItems[modelId].colorsList.push(colorWithQty);
            }
            groupedItems[modelId].totalQty += qty;
            groupedItems[modelId].totalPieces += pieces;
            groupedItems[modelId].totalPrice += item.total_price;
        }
    });

    const totalItemsCount = Object.keys(groupedItems).length;
    const grandTotalSeries = Object.values(groupedItems).reduce((sum, i) => sum + (Number(i.totalQty) || 0), 0);
    const grandTotalPieces = Object.values(groupedItems).reduce((sum, i) => sum + (Number(i.totalPieces) || 0), 0);

    const custHtml = Object.values(groupedItems).map((item, idx) => `
        <tr>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center;">${idx + 1}</td>
            <td style="padding: 4px; border: 1px solid #ccc; font-weight: bold;">
                ${item.modelName} ${item.code ? `<span style="font-size:10px; color:#555; font-family: monospace; margin-right: 4px;">(${item.code})</span>` : ''}
            </td>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center; font-size:10px;">${item.colorsList.join('، ')}</td>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center; font-weight: bold;">${item.totalQty} <span style="font-size:10px; color:#555; font-weight:normal;">(${item.totalPieces} ق)</span></td>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center;">${item.price}</td>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center; font-weight: bold; background: #f9f9f9 !important; -webkit-print-color-adjust: exact;">${item.totalPrice}</td>
        </tr>
    `).join('');

    const finalHtml = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>${pdfFileName}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
                @page { size: A4 portrait; margin: 0; }
                @media print {
                    html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
                    body { padding: 6mm 10mm !important; }
                }
                body { font-family: 'Tajawal', sans-serif; background: white; margin: 0; padding: 6mm 10mm; color: black; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            </style>
        </head>
        <body>
        <div style="border-bottom:2px solid black; padding-bottom:5px; margin-bottom:8px; display: flex; justify-content: space-between; align-items: flex-end;">
            <div style="display:flex; align-items:center; gap:8px;">
                <div style="display:inline-flex; align-items:center; gap:5px; direction: ltr;">
                    <span style="font-size:20px; font-weight:900; letter-spacing:1px; line-height: 1;">DEVO</span>
                    <span style="background:#000; color:#fff; padding:2px 6px; font-size:9.5px; font-weight:800; letter-spacing:1.5px; border-radius:3px; line-height: 1.1; display: inline-block; vertical-align: middle;">COLLECTION</span>
                </div>
                <span style="color: #cbd5e1; font-weight: 300; font-size: 12px; margin: 0 2px;">|</span>
                <span style="font-size:10.5px; font-weight:600; color:#444; white-space: nowrap;">هاتف: <span dir="ltr" style="font-family: monospace; font-weight: bold;">+20 12 12751111</span></span>
            </div>
            <div style="font-size: 11px; text-align: left;">
                <b style="font-size: 13px; color: #000;">فاتورة مبيعات</b>
            </div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:6px;">
            <div><b>رقم الفاتورة:</b> <span style="color:red; font-family:monospace; font-size:14px; font-weight:bold;">${o.invoice_number}</span></div>
            <div><b>التاريخ:</b> ${new Date(o.created_at).toLocaleDateString('ar-EG')}</div>
            <div><b>المبيعات:</b> ${o.system_users?.full_name || 'غير معروف'}</div>
        </div>
        <div style="background: #f8fafc; padding: 5px 8px; border: 1px solid #cbd5e1; border-radius: 4px; margin-bottom: 6px; font-size: 11px;">
            <b>العميل:</b> <span style="font-weight:bold;">${o.customer_name}</span> &nbsp;|&nbsp; 
            <b>العنوان:</b> ${o.address || '-'} &nbsp;|&nbsp; 
            <b>هاتف:</b> <span dir="ltr" style="font-family:monospace; font-weight:bold;">${o.phone_1}</span>
        </div>
        ${(o.notes && o.notes !== '-' && o.notes !== 'بدون ملاحظات') ? `
            <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 4px; padding: 4px 8px; margin-bottom: 6px; font-size: 10.5px; color: #92400e; display: flex; align-items: flex-start; gap: 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact;">
                <b style="color: #b45309; white-space: nowrap;">الملاحظات:</b>
                <span style="color: #1c1917; font-weight: 600; line-height: 1.3;">${o.notes}</span>
            </div>
        ` : ''}
        <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; border: 1px solid black;">
            <thead style="background: #e5e7eb !important; color: black !important; -webkit-print-color-adjust: exact;">
                <tr>
                    <th style="padding: 4px; border: 1px solid black; width: 30px;">م</th>
                    <th style="padding: 4px; border: 1px solid black;">الموديل</th>
                    <th style="padding: 4px; border: 1px solid black; width: 100px;">اللون</th>
                    <th style="padding: 4px; border: 1px solid black; width: 110px;">الكمية (سيريه / ق)</th>
                    <th style="padding: 4px; border: 1px solid black; width: 70px;">السعر</th>
                    <th style="padding: 4px; border: 1px solid black; width: 85px;">الإجمالي</th>
                </tr>
            </thead>
            <tbody>${custHtml}</tbody>
        </table>
        <div style="display: flex; justify-content: flex-end; page-break-inside: avoid;">
            <div style="border: 1.5px solid black; width: 240px; border-radius: 4px; overflow: hidden;">
                <div style="padding: 3px 8px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 11px;"><span>إجمالي الأصناف:</span> <b>${totalItemsCount} صنف</b></div>
                <div style="padding: 3px 8px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 11px; background: #f9f9f9 !important;"><span>إجمالي السريات:</span> <b>${grandTotalSeries} سيريه</b></div>
                <div style="padding: 3px 8px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 11px;"><span>إجمالي القطع:</span> <b>${grandTotalPieces} قطعة</b></div>
                <div style="padding: 4px 8px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; background: #f3f4f6 !important;"><span>الإجمالي الكلي:</span> <b>${Number(o.total_price || 0).toLocaleString()} ج.م</b></div>
                ${o.deposit > 0 ? `
                    <div style="padding: 3px 8px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 11px; background: #f9f9f9 !important; -webkit-print-color-adjust: exact;"><span>المدفوع:</span> <b style="color: green;">${Number(o.deposit).toLocaleString()}</b></div>
                    <div style="padding: 5px 8px; display: flex; justify-content: space-between; font-size: 13px; background: #e5e7eb !important; color: black !important; font-weight: bold; border-top: 1px solid #ccc; -webkit-print-color-adjust: exact;"><span>المتبقي:</span> <b>${Number(remaining).toLocaleString()} ج.م</b></div>
                ` : ''}
            </div>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 10px; border-top: 1px dashed #ccc; padding-top: 10px;">Developed by <a href="https://www.facebook.com/share/1NiodPNtXF/" target="_blank" style="color: inherit; text-decoration: none; font-weight: bold;">UltraSoft</a> - +201140409832</div>
        </body>
        </html>
    `;

    printHtmlInIframe(finalHtml);
}
