import { supabase } from '../config/supabase.js';
import { showToast } from '../components/toast.js';
import {
    normalizeBarcodeTemplate,
    buildLabelsToPrint,
    estimateLabelsCount,
    escapePrintHtml
} from './barcode_template_logic.js';
import {
    loadBarcodeTemplatesConfig,
    getCachedBarcodeTemplateState
} from './barcode_templates_store.js';

let cachedSizesMap = null;
let cachedColorsMap = null;

function loadScript(url) {
    const existing = document.querySelector(`script[src="${url}"]`);
    if (existing) {
        return new Promise((resolve) => {
            if (existing.dataset.loaded === 'true') {
                resolve();
            } else {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', resolve, { once: true });
            }
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = (err) => {
            script.remove();
            reject(err);
        };
        document.head.appendChild(script);
    });
}

export async function loadPrintingLibraries() {
    if (typeof JsBarcode === 'undefined') {
        await loadScript('./src/vendor/barcode/JsBarcode.all.min.js');
    }
    if (typeof QRCode === 'undefined') {
        await loadScript('./src/vendor/barcode/qrcode.min.js');
    }
}

export async function ensureLookupMaps(passedSizesMap = null, passedColorsMap = null) {
    if (passedSizesMap && Object.keys(passedSizesMap).length > 0 && passedColorsMap && Object.keys(passedColorsMap).length > 0) {
        cachedSizesMap = passedSizesMap;
        cachedColorsMap = passedColorsMap;
        return { sizesMap: passedSizesMap, colorsMap: passedColorsMap };
    }

    if (cachedSizesMap && cachedColorsMap) {
        return { sizesMap: cachedSizesMap, colorsMap: cachedColorsMap };
    }

    try {
        const [sizesRes, colorsRes] = await Promise.all([
            supabase.from('sizes').select('id, name'),
            supabase.from('colors').select('id, name')
        ]);

        const sMap = {};
        const cMap = {};
        (sizesRes.data || []).forEach(s => { sMap[s.id] = s.name; });
        (colorsRes.data || []).forEach(c => { cMap[c.id] = c.name; });

        cachedSizesMap = sMap;
        cachedColorsMap = cMap;
        return { sizesMap: sMap, colorsMap: cMap };
    } catch {
        return {
            sizesMap: passedSizesMap || cachedSizesMap || {},
            colorsMap: passedColorsMap || cachedColorsMap || {}
        };
    }
}

export async function fetchFullModelsByIds(modelIds) {
    const ids = Array.isArray(modelIds) ? [...new Set(modelIds.filter(Boolean))] : [];
    if (ids.length === 0) return [];

    const { data, error } = await supabase
        .from('models')
        .select(`
            *,
            categories(name),
            classes(name, class_sizes(size_id, sizes(id, name))),
            model_sizes(size_id, sizes(id, name)),
            model_inventory(color_id, available_series, colors(name)),
            model_images(image_url)
        `)
        .in('id', ids);

    if (error) throw error;

    const byId = new Map((data || []).map(m => [m.id, m]));
    return ids.map(id => byId.get(id)).filter(Boolean);
}

export function buildPrintHtmlDocument(labelsToPrint, cfg) {
    const normalized = normalizeBarcodeTemplate(cfg);
    const safeLabels = labelsToPrint.map(lbl => ({
        name: escapePrintHtml(lbl.name || ''),
        display_code: escapePrintHtml(lbl.display_code || lbl.factory_code || lbl.system_code || ''),
        sizesStr: escapePrintHtml(lbl.sizesStr || ''),
        colorStr: escapePrintHtml(lbl.colorStr || ''),
        isSingleColor: Boolean(lbl.isSingleColor),
        price: escapePrintHtml(lbl.price ?? 0),
        value: String(lbl.value || '')
    }));

    const labelsDataJson = JSON.stringify(safeLabels).replace(/<\/script>/gi, '<\\/script>');
    const {
        codeType,
        paperW,
        paperH,
        fontName,
        fontCode,
        fontDetails,
        fontPrice,
        codeBold,
        colorInline,
        showName,
        showCode,
        showSizes,
        showPrice,
        showColors
    } = normalized;

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>طباعة الباركود</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;600;700;800&display=swap');
        @page {
            size: ${paperW}cm ${paperH}cm;
            margin: 0;
        }
        body {
            margin: 0;
            padding: 0;
            background: white;
            color: black;
            font-family: 'Tajawal', sans-serif;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .barcode-label {
            width: ${paperW}cm;
            height: ${paperH}cm;
            page-break-after: always;
            box-sizing: border-box;
            padding: ${Math.min(paperW, paperH) * 0.08}cm;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            text-align: center;
            overflow: hidden;
        }
        .model-name {
            font-size: ${fontName}px;
            font-weight: 700;
            width: 100%;
            display: ${showName ? '-webkit-box' : 'none'};
            -webkit-line-clamp: 2;
            line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.2;
            text-align: center;
            word-break: break-word;
        }
        .model-code {
            font-size: ${fontCode}px;
            font-weight: ${codeBold ? '700' : '400'};
            color: #000;
            margin-top: 1px;
            font-family: monospace, sans-serif;
            display: ${showCode ? 'block' : 'none'};
            text-align: center;
            line-height: 1.2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            width: 100%;
        }
        .model-inline-color {
            font-family: 'Tajawal', sans-serif;
            font-size: 0.9em;
            font-weight: ${codeBold ? '700' : '500'};
            margin-right: 4px;
        }
        .model-sizes {
            font-size: ${fontDetails}px;
            font-weight: 700;
            color: #000;
            margin-top: 1px;
            display: ${showSizes ? 'block' : 'none'};
            width: 100%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .model-colors {
            font-size: ${fontDetails}px;
            font-weight: 700;
            color: #000;
            margin-top: 1px;
            display: ${showColors ? 'block' : 'none'};
            width: 100%;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .code-container {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            height: ${paperH * 0.45}cm;
            margin: 2px 0;
        }
        .code-container svg, .code-container img {
            max-width: 100%;
            max-height: 100%;
            display: block;
        }
        .model-price {
            font-size: ${fontPrice}px;
            font-weight: 700;
            margin-top: 1px;
            border-top: 1px dashed #000;
            width: 100%;
            padding-top: ${fontPrice * 0.2}px;
            display: ${showPrice ? 'block' : 'none'};
        }
    </style>
    <script src="./src/vendor/barcode/JsBarcode.all.min.js"><\/script>
    <script src="./src/vendor/barcode/qrcode.min.js"><\/script>
</head>
<body>
    <div id="labels-container"></div>
    <script>
        const labels = ${labelsDataJson};
        const codeType = "${codeType}";
        const isColorInline = ${Boolean(colorInline)};
        const showColors = ${Boolean(showColors)};

        const container = document.getElementById('labels-container');
        const qrPromises = [];

        labels.forEach((lbl, idx) => {
            const labelDiv = document.createElement('div');
            labelDiv.className = 'barcode-label';

            const showInlineColor = isColorInline && showColors && lbl.isSingleColor && lbl.colorStr;
            const codeText = lbl.display_code || '';

            let codeHtml = '';
            if (codeText) {
                if (showInlineColor) {
                    codeHtml = '<div class="model-code"><span>' + codeText + '</span><span class="model-inline-color">- ' + lbl.colorStr + '</span></div>';
                } else {
                    codeHtml = '<div class="model-code"><span>' + codeText + '</span></div>';
                }
            }

            const colorsHtml = (!showInlineColor && lbl.colorStr && showColors) ? '<div class="model-colors">' + lbl.colorStr + '</div>' : '';

            labelDiv.innerHTML = '<div style="width: 100%;">' +
                '<div class="model-name">' + lbl.name + '</div>' +
                codeHtml +
                (lbl.sizesStr ? '<div class="model-sizes">' + lbl.sizesStr + '</div>' : '') +
                colorsHtml +
            '</div>' +
            '<div class="code-container">' +
                (codeType === 'barcode'
                    ? '<svg id="barcode-' + idx + '"></svg>'
                    : '<img id="qrcode-' + idx + '" src="">'
                ) +
            '</div>' +
            '<div class="model-price">' + lbl.price + ' ج.م</div>';

            container.appendChild(labelDiv);

            if (codeType === 'barcode') {
                try {
                    JsBarcode("#barcode-" + idx, lbl.value, {
                        format: "CODE128",
                        width: 2.0,
                        height: 65,
                        displayValue: false,
                        margin: 0
                    });
                } catch(e) {
                    console.error("JsBarcode failed for", lbl.value, e);
                }
            } else if (codeType === 'qrcode') {
                if (typeof QRCode !== 'undefined') {
                    const promise = QRCode.toDataURL(lbl.value, { width: 250, margin: 1 })
                        .then(url => {
                            const img = document.getElementById('qrcode-' + idx);
                            if (img) img.src = url;
                        })
                        .catch(err => {
                            console.error("Local QRCode generate failed:", err);
                        });
                    qrPromises.push(promise);
                }
            }
        });

        window.onload = function() {
            Promise.all(qrPromises).then(() => {
                setTimeout(() => {
                    window.focus();
                    window.print();
                }, 400);
            });
        };
    <\/script>
</body>
</html>`;
}

/**
 * Print models directly using the active template from Settings (or an optional override).
 * Opens the browser/printer dialog directly via #print-barcode-iframe without intermediate modals.
 */
export async function printModelsDirect(modelsOrIds, options = {}) {
    const items = Array.isArray(modelsOrIds) ? modelsOrIds.filter(Boolean) : [];
    if (items.length === 0) {
        showToast('الرجاء تحديد موديل واحد على الأقل للطباعة', 'warning');
        return false;
    }

    try {
        showToast('جاري تجهيز ملصقات الباركود للطباعة المباشرة...', 'info');

        let resolvedModels = items;
        if (typeof items[0] === 'string') {
            resolvedModels = await fetchFullModelsByIds(items);
        }

        if (!resolvedModels || resolvedModels.length === 0) {
            showToast('تعذر العثور على بيانات الموديلات للطباعة', 'error');
            return false;
        }

        const [state, lookupMaps] = await Promise.all([
            options.templateConfigOverride ? Promise.resolve(null) : loadBarcodeTemplatesConfig(),
            ensureLookupMaps(options.sizesMap || null, options.colorsMap || null),
            loadPrintingLibraries()
        ]);

        const config = normalizeBarcodeTemplate(
            options.templateConfigOverride || state?.activeConfig || getCachedBarcodeTemplateState().activeConfig
        );

        const labelsToPrint = buildLabelsToPrint(resolvedModels, config, {
            sizesMap: lookupMaps.sizesMap,
            colorsMap: lookupMaps.colorsMap,
            origin: window.location.origin
        });

        if (labelsToPrint.length === 0) {
            showToast('لا توجد ملصقات صالحة للطباعة (تحقق من مخزون الألوان أو إعدادات القالب)', 'warning');
            return false;
        }

        const printHtml = buildPrintHtmlDocument(labelsToPrint, config);

        let iframe = document.getElementById('print-barcode-iframe');
        if (iframe) {
            iframe.remove();
        }
        iframe = document.createElement('iframe');
        iframe.id = 'print-barcode-iframe';
        iframe.style.position = 'fixed';
        iframe.style.right = '-9999px';
        iframe.style.bottom = '-9999px';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);

        const doc = iframe.contentDocument || iframe.contentWindow.document;
        doc.open();
        doc.write(printHtml);
        doc.close();

        return true;
    } catch (err) {
        console.error('Direct barcode print failed:', err);
        showToast('حدث خطأ أثناء تجهيز الطباعة: ' + (err?.message || 'خطأ غير متوقع'), 'error');
        return false;
    }
}

export async function renderBarcodeLabelPreview({
    prefix = 'bts',
    config,
    sampleModels = [],
    colorsMap = {}
} = {}) {
    const cfg = normalizeBarcodeTemplate(config);
    await loadPrintingLibraries().catch(() => {});

    const dimBadge = document.getElementById(`${prefix}-dim-badge`);
    if (dimBadge) {
        dimBadge.textContent = `${cfg.paperW} × ${cfg.paperH} سم`;
    }

    const estBadge = document.getElementById(`${prefix}-total-labels-estimate`);
    if (estBadge) {
        const est = estimateLabelsCount(sampleModels, cfg, colorsMap);
        estBadge.textContent = sampleModels.length > 0 ? est.text : `${cfg.fixedQty} ملصق لكل موديل`;
    }

    const previewCard = document.getElementById(`${prefix}-preview-card`);
    if (previewCard) {
        previewCard.style.width = `${cfg.paperW}cm`;
        previewCard.style.height = `${cfg.paperH}cm`;
        previewCard.style.padding = `${Math.min(cfg.paperW, cfg.paperH) * 0.08}cm`;
    }

    const prevName = document.getElementById(`${prefix}-prev-name`);
    const prevCodeRow = document.getElementById(`${prefix}-prev-code-row`);
    const prevCode = document.getElementById(`${prefix}-prev-code`);
    const prevInlineColor = document.getElementById(`${prefix}-prev-inline-color`);
    const prevSizes = document.getElementById(`${prefix}-prev-sizes`);
    const prevColors = document.getElementById(`${prefix}-prev-colors`);
    const prevPrice = document.getElementById(`${prefix}-prev-price`);

    if (prevName) {
        prevName.style.display = cfg.showName ? '-webkit-box' : 'none';
        prevName.style.fontSize = `${cfg.fontName}px`;
    }

    if (prevCode) {
        prevCode.style.fontSize = `${cfg.fontCode}px`;
        prevCode.style.fontWeight = cfg.codeBold ? '700' : '400';
        prevCode.textContent = cfg.valueSource === 'system' ? 'S12345' : 'F12345';
    }

    if (prevCodeRow) {
        prevCodeRow.style.display = cfg.showCode ? 'flex' : 'none';
        prevCodeRow.style.fontSize = `${cfg.fontCode}px`;
    }

    const isSingleColorInPreview = (cfg.qtyMode === 'by_color' && cfg.colorDist === 'separate');

    if (prevInlineColor) {
        if (cfg.showCode && cfg.showColors && cfg.colorInline) {
            prevInlineColor.classList.remove('hidden');
            prevInlineColor.style.fontSize = `${Math.max(8, cfg.fontCode * 0.95)}px`;
            prevInlineColor.style.fontWeight = cfg.codeBold ? '700' : '500';
            prevInlineColor.textContent = '- أحمر';
        } else {
            prevInlineColor.classList.add('hidden');
        }
    }

    if (prevSizes) {
        prevSizes.style.display = cfg.showSizes ? 'block' : 'none';
        prevSizes.style.fontSize = `${cfg.fontDetails}px`;
    }

    if (prevColors) {
        if (cfg.showCode && cfg.showColors && cfg.colorInline) {
            prevColors.style.display = 'none';
        } else if (cfg.showColors) {
            prevColors.style.display = 'block';
            prevColors.style.fontSize = `${cfg.fontDetails}px`;
            prevColors.textContent = isSingleColorInPreview ? 'أحمر (لون منفرد)' : 'أحمر، أسود، أزرق';
        } else {
            prevColors.style.display = 'none';
        }
    }

    if (prevPrice) {
        prevPrice.style.display = cfg.showPrice ? 'block' : 'none';
        prevPrice.style.fontSize = `${cfg.fontPrice}px`;
        prevPrice.style.paddingTop = `${cfg.fontPrice * 0.2}px`;
    }

    const barcodeSvg = document.getElementById(`${prefix}-prev-barcode-svg`);
    const qrcodeImg = document.getElementById(`${prefix}-prev-qrcode-img`);

    let sampleValue = 'F12345';
    if (cfg.valueSource === 'system') {
        sampleValue = 'S12345';
    } else if (cfg.valueSource === 'url') {
        sampleValue = `${window.location.origin}/?system=12345`;
    }

    if (barcodeSvg && qrcodeImg) {
        if (cfg.codeType === 'barcode') {
            barcodeSvg.classList.remove('hidden');
            qrcodeImg.classList.add('hidden');
            try {
                if (typeof JsBarcode !== 'undefined') {
                    JsBarcode(barcodeSvg, sampleValue, {
                        format: 'CODE128',
                        width: 1.8,
                        height: 50,
                        displayValue: false,
                        margin: 0
                    });
                }
            } catch (e) {
                console.error('Preview JsBarcode error:', e);
            }
        } else {
            barcodeSvg.classList.add('hidden');
            qrcodeImg.classList.remove('hidden');
            if (typeof QRCode !== 'undefined') {
                QRCode.toDataURL(sampleValue, { width: 250, margin: 1 })
                    .then(url => { qrcodeImg.src = url; })
                    .catch(err => console.error('Preview QRCode error:', err));
            }
        }
    }
}
