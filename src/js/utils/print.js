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
        const qty = item.quantity;
        
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1); 
        const pieces = qty * sizesCount;
        
        const colorWithQty = colorName; 

        const piecePrice = item.price_per_series / sizesCount;

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

    const custHtml = Object.values(groupedItems).map((item, idx) => `
        <tr>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center;">${idx + 1}</td>
            <td style="padding: 4px; border: 1px solid #ccc; font-weight: bold;">
                ${item.modelName} ${item.code ? `<span style="font-size:10px; color:#555; font-family: monospace; margin-right: 4px;">(${item.code})</span>` : ''}
            </td>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center; font-size:10px;">${item.colorsList.join('، ')}</td>
            <td style="padding: 4px; border: 1px solid #ccc; text-align: center; font-weight: bold;">${item.totalPieces}</td>
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
                @page { margin: 0.5cm; }
                body { font-family: 'Tajawal', sans-serif; background: white; margin: 0; color: black; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            </style>
        </head>
        <body>
        <div style="border-bottom:4px solid black; padding-bottom:6px; margin-bottom:10px;">
            <div style="display:flex; align-items:center; gap:10px;">
                <span style="background:#c7d7e5; padding:3px 10px; font-size:16px; font-weight:700; letter-spacing:2px;">Collection</span>
                <span style="font-size:28px; font-weight:900; letter-spacing:1px;">DEVO</span>
            </div>
            <div style="font-size:14px; font-weight:600; margin-top:4px;">Phone: +20 12 12751111</div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-top:8px;">
            <div><b>رقم:</b> <span style="color:red; font-family:monospace; font-size:16px;">${o.invoice_number}</span></div>
            <div>التاريخ: ${new Date(o.created_at).toLocaleDateString('ar-EG')}</div>
            <div>الكاشير: ${o.system_users?.full_name || 'غير معروف'}</div>
        </div>
        <div style="background: #f3f4f6; padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 15px; font-size: 12px;"><b>العميل:</b> ${o.customer_name} &nbsp;|&nbsp; <b>العنوان:</b> ${o.address || '-'} &nbsp;|&nbsp; <b>هاتف:</b> <span dir="ltr">${o.phone_1}</span></div>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 15px; border: 1px solid black;">
            <thead style="background: black !important; color: white !important; -webkit-print-color-adjust: exact;"><tr><th style="padding: 6px;">م</th><th style="padding: 6px;">الموديل</th><th style="padding: 6px;">اللون</th><th style="padding: 6px;">الكمية (ق)</th><th style="padding: 6px;">السعر</th><th style="padding: 6px;">الإجمالي</th></tr></thead>
            <tbody>${custHtml}</tbody>
        </table>
        <div style="display: flex; justify-content: flex-end; page-break-inside: avoid;">
            <div style="border: 2px solid black; width: 250px; border-radius: 4px; overflow: hidden;">
                <div style="padding: 6px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 12px;"><span>الإجمالي:</span> <b>${o.total_price}</b></div>
                <div style="padding: 6px; border-bottom: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 12px; background: #f9f9f9 !important; -webkit-print-color-adjust: exact;"><span>المدفوع:</span> <b style="color: green;">${o.deposit}</b></div>
                <div style="padding: 8px; display: flex; justify-content: space-between; font-size: 14px; background: black !important; color: white !important; -webkit-print-color-adjust: exact;"><span>المتبقي:</span> <b>${remaining} ج.م</b></div>
            </div>
        </div>
        <div style="text-align: center; margin-top: 20px; font-size: 10px; border-top: 1px dashed #ccc; padding-top: 10px;">Engineered by Ahmed M. Attia</div>
        </body>
        </html>
    `;

    printHtmlInIframe(finalHtml);
}
