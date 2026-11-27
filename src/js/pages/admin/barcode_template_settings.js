import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { requireAuth } from '../../services/auth.js';
import {
    SYSTEM_TEMPLATE_IDS,
    DEFAULT_BARCODE_TEMPLATES,
    normalizeBarcodeTemplate,
    formatActiveTemplateSummary
} from '../../services/barcode_template_logic.js';
import {
    loadBarcodeTemplatesConfig,
    saveBarcodeTemplateState
} from '../../services/barcode_templates_store.js';
import {
    printModelsDirect,
    renderBarcodeLabelPreview
} from '../../services/barcode_direct_printer.js';

let isPageInitialized = false;
let currentState = {
    templates: { ...DEFAULT_BARCODE_TEMPLATES },
    activeTemplateId: 'default_4_5',
    activeConfig: { ...DEFAULT_BARCODE_TEMPLATES.default_4_5 }
};
let hasUnsavedEdits = false;

export async function initBarcodeTemplateSettingsView() {
    const user = requireAuth(['owner']);
    if (!user || user.role !== 'owner') {
        showToast('هذه الصفحة مخصصة لمالك النظام فقط', 'error');
        return;
    }

    if (!isPageInitialized) {
        renderBarcodeTemplateSettingsPage();
        bindBarcodeTemplateSettingsEvents();
        isPageInitialized = true;
    }

    await refreshBarcodeTemplateSettingsView(false);
}

export async function refreshBarcodeTemplateSettingsView(forceRefresh = true) {
    const loaded = await loadBarcodeTemplatesConfig(forceRefresh);
    currentState = {
        templates: { ...loaded.templates },
        activeTemplateId: loaded.activeTemplateId || 'default_4_5',
        activeConfig: normalizeBarcodeTemplate(loaded.activeConfig)
    };
    hasUnsavedEdits = false;

    populateTemplateSelect();
    applyConfigToForm(currentState.activeConfig, currentState.activeTemplateId);
    updateSavedStatusLine();
    await refreshPreview();
}

function renderBarcodeTemplateSettingsPage() {
    const container = document.getElementById('barcode-template-settings-content');
    if (!container) return;

    container.innerHTML = `
        <div class="animate-fade-in space-y-5 max-w-[1280px] mx-auto pb-12">
            <!-- Header & Direct Active Summary -->
            <div class="bg-devo-dark border border-devo-gray rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
                <div class="space-y-1 flex-1 min-w-0 sm:min-w-[280px]">
                    <h2 class="text-lg sm:text-xl font-bold text-devo-text flex items-center gap-2">
                        <i class="ph ph-printer text-devo-orange text-2xl shrink-0"></i>
                        <span>إعدادات قالب طباعة الباركود المباشرة</span>
                    </h2>
                    <p id="bts-active-summary" class="text-xs text-devo-muted leading-relaxed">جاري تحميل القالب النشط...</p>
                </div>
                <div class="flex flex-wrap items-center gap-2.5">
                    <button type="button" id="bts-test-print-btn" class="px-4 py-2.5 rounded-xl bg-devo-black hover:bg-devo-gray border border-devo-gray text-devo-text text-xs font-bold transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer">
                        <i class="ph ph-printer text-base text-devo-orange"></i>
                        <span>طباعة ملصق تجريبي</span>
                    </button>
                    <button type="button" id="bts-save-active-btn" class="px-5 py-2.5 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs sm:text-sm font-bold transition-all flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer shadow-sm">
                        <i class="ph ph-floppy-disk text-base"></i>
                        <span>حفظ وتفعيل للطباعة المباشرة</span>
                    </button>
                </div>
            </div>

            <!-- Designer Grid -->
            <div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
                <!-- Controls Column -->
                <div class="space-y-4 min-w-0">
                    <!-- 1. Saved Templates -->
                    <section class="bg-devo-dark border border-devo-gray rounded-xl p-4 sm:p-5 space-y-3">
                        <div class="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-devo-gray">
                            <h3 class="text-sm font-bold text-devo-text flex items-center gap-2">
                                <i class="ph ph-bookmarks text-devo-orange text-base"></i>
                                <span>قوالب الطباعة المحفوظة</span>
                            </h3>
                            <span class="text-[11px] text-devo-muted">يُستخدم القالب النشط مباشرة عند كل أمر طباعة دون سؤال</span>
                        </div>

                        <div class="flex flex-wrap items-center gap-2">
                            <select id="bts-template-select" class="flex-1 min-w-[220px] bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-xs sm:text-sm text-devo-text focus:border-devo-orange outline-none cursor-pointer">
                                <option value="__custom__">-- إعداد مخصص نشط --</option>
                            </select>
                            <button type="button" id="bts-update-preset-btn" class="hidden px-3.5 py-2.5 rounded-lg bg-devo-black hover:bg-devo-gray border border-devo-gray text-devo-text text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer" title="تحديث القالب المخصص المحدد بالتعديلات الحالية">
                                <i class="ph ph-arrows-clockwise text-sm align-middle"></i> تحديث القالب
                            </button>
                            <button type="button" id="bts-delete-preset-btn" class="hidden px-3.5 py-2.5 rounded-lg bg-devo-error/15 hover:bg-devo-error border border-devo-error/30 text-devo-error hover:text-white text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer" title="حذف القالب المحدد">
                                <i class="ph ph-trash text-sm"></i>
                            </button>
                        </div>

                        <div class="flex flex-wrap items-center gap-2 pt-2 border-t border-devo-gray/60">
                            <input type="text" id="bts-new-template-name" placeholder="اسم قالب جديد لحفظ الإعدادات الحالية..." class="flex-1 min-w-[200px] bg-devo-black border border-devo-gray rounded-lg px-3 py-2 text-xs sm:text-sm text-devo-text focus:border-devo-orange outline-none">
                            <button type="button" id="bts-save-new-preset-btn" class="px-4 py-2 rounded-lg bg-devo-success/15 hover:bg-devo-success border border-devo-success/30 text-devo-success hover:text-white text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer">
                                <i class="ph ph-plus-circle text-sm"></i>
                                <span>حفظ كقالب جديد</span>
                            </button>
                        </div>
                    </section>

                    <!-- 2. Paper Dimensions & Code Encoding -->
                    <section class="bg-devo-dark border border-devo-gray rounded-xl p-4 sm:p-5 space-y-3.5">
                        <h3 class="text-sm font-bold text-devo-text pb-2.5 border-b border-devo-gray flex items-center gap-2">
                            <i class="ph ph-sliders-horizontal text-devo-orange text-base"></i>
                            <span>أبعاد الورقة ونوع التشفير</span>
                        </h3>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label for="bts-code-type" class="block text-xs font-bold text-devo-muted mb-1.5">نوع الكود</label>
                                <select id="bts-code-type" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-xs sm:text-sm text-devo-text focus:border-devo-orange outline-none cursor-pointer">
                                    <option value="barcode">باركود شريطي (1D - Code128)</option>
                                    <option value="qrcode">كيو آر كود (2D - QR Code)</option>
                                </select>
                            </div>
                            <div>
                                <label for="bts-value-source" class="block text-xs font-bold text-devo-muted mb-1.5">كود التشفير</label>
                                <select id="bts-value-source" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-xs sm:text-sm text-devo-text focus:border-devo-orange outline-none cursor-pointer">
                                    <option value="factory">كود المصنع (Factory Code)</option>
                                    <option value="system">كود السيستم (System Code)</option>
                                    <option value="url">رابط مباشر للموديل (URL)</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label for="bts-sort-order" class="block text-xs font-bold text-devo-muted mb-1.5">ترتيب الملصقات عند الطباعة</label>
                            <select id="bts-sort-order" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-xs sm:text-sm text-devo-text focus:border-devo-orange outline-none cursor-pointer">
                                <option value="table">نفس ترتيب الجدول / الاختيار</option>
                                <option value="factory_asc">كود المصنع (تصاعدي 1 ← 9)</option>
                                <option value="factory_desc">كود المصنع (تنازلي 9 ← 1)</option>
                                <option value="system_asc">كود السيستم (تصاعدي 1 ← 9)</option>
                                <option value="system_desc">كود السيستم (تنازلي 9 ← 1)</option>
                                <option value="name_asc">اسم الموديل (أ - ي)</option>
                                <option value="name_desc">اسم الموديل (ي - أ)</option>
                                <option value="price_asc">السعر (من الأقل للأعلى)</option>
                                <option value="price_desc">السعر (من الأعلى للأقل)</option>
                                <option value="stock_desc">المخزون (الأكثر للأقل)</option>
                                <option value="date_desc">تاريخ الإضافة (الأحدث أولاً)</option>
                                <option value="date_asc">تاريخ الإضافة (الأقدم أولاً)</option>
                            </select>
                        </div>

                        <div class="grid grid-cols-2 gap-3.5">
                            <div>
                                <label for="bts-paper-w" class="block text-xs font-bold text-devo-muted mb-1.5">عرض الورقة (سم)</label>
                                <input type="number" id="bts-paper-w" value="4" step="0.1" min="1.5" max="25" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text focus:border-devo-orange outline-none text-center font-bold tabular-nums font-mono">
                            </div>
                            <div>
                                <label for="bts-paper-h" class="block text-xs font-bold text-devo-muted mb-1.5">ارتفاع الورقة (سم)</label>
                                <input type="number" id="bts-paper-h" value="5" step="0.1" min="1.5" max="25" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text focus:border-devo-orange outline-none text-center font-bold tabular-nums font-mono">
                            </div>
                        </div>
                    </section>

                    <!-- 3. Font Sizes & Text Styling -->
                    <section class="bg-devo-dark border border-devo-gray rounded-xl p-4 sm:p-5 space-y-3.5">
                        <h3 class="text-sm font-bold text-devo-text pb-2.5 border-b border-devo-gray flex items-center gap-2">
                            <i class="ph ph-text-aa text-devo-orange text-base"></i>
                            <span>أحجام الخطوط وتنسيق النصوص</span>
                        </h3>

                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                                <label for="bts-font-name" class="block text-[11px] font-bold text-devo-muted mb-1.5">خط الاسم (px)</label>
                                <input type="number" id="bts-font-name" value="11" min="6" max="36" class="w-full bg-devo-black border border-devo-gray rounded-lg px-2 py-2 text-sm text-devo-text focus:border-devo-orange outline-none text-center font-bold tabular-nums font-mono">
                            </div>
                            <div>
                                <label for="bts-font-code" class="block text-[11px] font-bold text-devo-orange mb-1.5">خط الكود (px)</label>
                                <input type="number" id="bts-font-code" value="10" min="6" max="36" class="w-full bg-devo-black border border-devo-orange/50 rounded-lg px-2 py-2 text-sm text-devo-orange focus:border-devo-orange outline-none text-center font-bold tabular-nums font-mono">
                            </div>
                            <div>
                                <label for="bts-font-details" class="block text-[11px] font-bold text-devo-muted mb-1.5">خط التفاصيل (px)</label>
                                <input type="number" id="bts-font-details" value="9" min="6" max="30" class="w-full bg-devo-black border border-devo-gray rounded-lg px-2 py-2 text-sm text-devo-text focus:border-devo-orange outline-none text-center font-bold tabular-nums font-mono">
                            </div>
                            <div>
                                <label for="bts-font-price" class="block text-[11px] font-bold text-devo-muted mb-1.5">خط السعر (px)</label>
                                <input type="number" id="bts-font-price" value="12" min="6" max="36" class="w-full bg-devo-black border border-devo-gray rounded-lg px-2 py-2 text-sm text-devo-text focus:border-devo-orange outline-none text-center font-bold tabular-nums font-mono">
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-devo-gray/60">
                            <label class="flex items-center gap-2.5 p-2.5 rounded-lg bg-devo-black border border-devo-gray hover:border-devo-orange/60 cursor-pointer text-xs text-devo-text transition-colors">
                                <input type="checkbox" id="bts-code-bold" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span class="font-bold">جعل كود الموديل عريض (Bold)</span>
                            </label>
                            <label class="flex items-center gap-2.5 p-2.5 rounded-lg bg-devo-black border border-devo-gray hover:border-devo-orange/60 cursor-pointer text-xs text-devo-text transition-colors">
                                <input type="checkbox" id="bts-color-inline" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span class="font-semibold">وضع اللون بجوار الكود في الألوان المفردة</span>
                            </label>
                        </div>
                    </section>

                    <!-- 4. Visible Fields -->
                    <section class="bg-devo-dark border border-devo-gray rounded-xl p-4 sm:p-5 space-y-3">
                        <h3 class="text-sm font-bold text-devo-text pb-2.5 border-b border-devo-gray flex items-center gap-2">
                            <i class="ph ph-check-square text-devo-orange text-base"></i>
                            <span>الحقول المراد إظهارها على الملصق</span>
                        </h3>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <label class="flex items-center gap-2.5 cursor-pointer text-xs text-devo-text hover:text-devo-orange transition-colors py-1">
                                <input type="checkbox" id="bts-show-name" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span>إظهار اسم الموديل</span>
                            </label>
                            <label class="flex items-center gap-2.5 cursor-pointer text-xs text-devo-text hover:text-devo-orange transition-colors py-1">
                                <input type="checkbox" id="bts-show-code" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span>إظهار كود الموديل</span>
                            </label>
                            <label class="flex items-center gap-2.5 cursor-pointer text-xs text-devo-text hover:text-devo-orange transition-colors py-1">
                                <input type="checkbox" id="bts-show-sizes" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span>إظهار قائمة المقاسات بداخل الصنف</span>
                            </label>
                            <label class="flex items-center gap-2.5 cursor-pointer text-xs text-devo-text hover:text-devo-orange transition-colors py-1">
                                <input type="checkbox" id="bts-show-price" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span>إظهار السعر أسفل الباركود</span>
                            </label>
                        </div>
                    </section>

                    <!-- 5. Copy Counts & Color Distribution -->
                    <section class="bg-devo-dark border border-devo-gray rounded-xl p-4 sm:p-5 space-y-3.5">
                        <h3 class="text-sm font-bold text-devo-text pb-2.5 border-b border-devo-gray flex items-center gap-2">
                            <i class="ph ph-copy text-devo-orange text-base"></i>
                            <span>خيارات النسخ وتوزيع الألوان</span>
                        </h3>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                            <div>
                                <label for="bts-qty-mode" class="block text-xs font-bold text-devo-muted mb-1.5">طريقة تحديد عدد النسخ</label>
                                <select id="bts-qty-mode" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-xs sm:text-sm text-devo-text focus:border-devo-orange outline-none cursor-pointer">
                                    <option value="fixed">عدد نسخ ثابت (لكل موديل)</option>
                                    <option value="by_color">تلقائي (حسب ألوان الموديل)</option>
                                </select>
                            </div>
                            <div id="bts-fixed-qty-container">
                                <label id="bts-qty-label" for="bts-fixed-qty" class="block text-xs font-bold text-devo-muted mb-1.5">عدد النسخ لكل موديل</label>
                                <input type="number" id="bts-fixed-qty" value="1" min="1" max="500" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text focus:border-devo-orange outline-none text-center font-bold tabular-nums font-mono">
                            </div>
                        </div>

                        <div id="bts-color-dist-container" class="hidden">
                            <label for="bts-color-dist" class="block text-xs font-bold text-devo-muted mb-1.5">طريقة توزيع الألوان على الملصقات</label>
                            <select id="bts-color-dist" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-xs sm:text-sm text-devo-text focus:border-devo-orange outline-none cursor-pointer">
                                <option value="separate">نسخة منفصلة لكل لون (ملصق خاص بكل لون)</option>
                                <option value="all_together">عرض جميع الألوان معاً على كل النسخ</option>
                            </select>
                        </div>

                        <div class="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t border-devo-gray/60">
                            <label class="flex items-center gap-2.5 cursor-pointer text-xs text-devo-text hover:text-devo-orange transition-colors">
                                <input type="checkbox" id="bts-show-colors" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span>إظهار الألوان على الباركود</span>
                            </label>
                            <label class="flex items-center gap-2.5 cursor-pointer text-xs text-devo-text hover:text-devo-orange transition-colors">
                                <input type="checkbox" id="bts-skip-zero-stock" checked class="accent-devo-orange w-4 h-4 cursor-pointer shrink-0">
                                <span>تخطي الألوان التي ليس بها رصيد</span>
                            </label>
                        </div>
                    </section>
                </div>

                <!-- Sticky Live Preview Column -->
                <aside class="bg-devo-dark border border-devo-gray rounded-xl p-5 space-y-4 xl:sticky xl:top-4">
                    <div class="flex items-center justify-between border-b border-devo-gray pb-3">
                        <h3 class="text-sm font-bold text-devo-text flex items-center gap-2">
                            <i class="ph ph-eye text-devo-orange text-base"></i>
                            <span>المعاينة الحية للملصق</span>
                        </h3>
                        <span id="bts-dim-badge" class="text-xs font-mono tabular-nums font-bold text-devo-orange">4 × 5 سم</span>
                    </div>

                    <div id="bts-unsaved-notice" class="hidden text-xs text-amber-500 font-bold border border-amber-500/30 bg-amber-500/10 rounded-lg px-3 py-2">
                        توجد تعديلات غير محفوظة — اضغط «حفظ وتفعيل للطباعة المباشرة» لاعتمادها.
                    </div>

                    <div class="flex items-center justify-center p-4 rounded-xl border border-dashed border-devo-gray bg-devo-black/60 overflow-auto" style="min-height: 270px;">
                        <div id="bts-preview-card" class="bg-white text-black flex flex-col justify-between items-center text-center p-2 box-border shadow-xl rounded-[2px] transition-all duration-200 shrink-0" style="width: 4cm; height: 5cm;">
                            <div class="w-full">
                                <div id="bts-prev-name" class="font-bold text-center text-black" style="font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.2; word-break: break-word;">اسم الموديل التجريبي</div>
                                <div id="bts-prev-code-row" class="text-black font-mono font-bold flex items-center justify-center gap-1 flex-wrap" style="font-size: 10px; margin-top: 1px;">
                                    <span id="bts-prev-code">F12345</span>
                                    <span id="bts-prev-inline-color" class="hidden text-black font-sans font-bold" style="font-size: 0.9em;">- أحمر</span>
                                </div>
                                <div id="bts-prev-sizes" class="text-black font-mono font-bold" style="font-size: 8px; margin-top: 1px;">S, M, L, XL</div>
                                <div id="bts-prev-colors" class="text-black font-sans font-bold" style="font-size: 8px; margin-top: 1px;">أحمر، أسود، أزرق</div>
                            </div>

                            <div class="flex-1 flex items-center justify-center w-full overflow-hidden my-1" style="min-height: 40px;">
                                <svg id="bts-prev-barcode-svg" class="max-w-full max-h-full"></svg>
                                <img id="bts-prev-qrcode-img" class="max-w-full max-h-full hidden" src="" alt="QR Code Preview">
                            </div>

                            <div id="bts-prev-price" class="font-bold border-t border-dashed border-black w-full pt-1 text-black" style="font-size: 12px;">150 ج.م</div>
                        </div>
                    </div>

                    <p class="text-[11px] text-devo-muted text-center leading-relaxed">
                        تُطبق هذه الأبعاد والخطوط تلقائياً بمجرد الضغط على زر الطباعة في أي صفحة بالنظام.
                    </p>
                </aside>
            </div>
        </div>
    `;
}

function populateTemplateSelect() {
    const selectEl = document.getElementById('bts-template-select');
    if (!selectEl) return;

    selectEl.innerHTML = '<option value="__custom__">-- إعداد مخصص نشط --</option>';

    Object.entries(currentState.templates).forEach(([key, tpl]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = SYSTEM_TEMPLATE_IDS.has(key) ? `${tpl.name} (افتراضي)` : tpl.name;
        selectEl.appendChild(opt);
    });

    const selected = currentState.activeTemplateId && currentState.templates[currentState.activeTemplateId]
        ? currentState.activeTemplateId
        : '__custom__';
    selectEl.value = selected;
    updatePresetActionButtons(selected);
}

function updatePresetActionButtons(selectedId) {
    const deleteBtn = document.getElementById('bts-delete-preset-btn');
    const updateBtn = document.getElementById('bts-update-preset-btn');
    const isCustom = Boolean(selectedId && selectedId !== '__custom__' && !SYSTEM_TEMPLATE_IDS.has(selectedId));

    if (deleteBtn) deleteBtn.classList.toggle('hidden', !isCustom);
    if (updateBtn) updateBtn.classList.toggle('hidden', !isCustom);
}

function applyConfigToForm(cfg, templateId = '__custom__') {
    const normalized = normalizeBarcodeTemplate(cfg);

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    const setChecked = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
    };

    const selectEl = document.getElementById('bts-template-select');
    if (selectEl) {
        selectEl.value = templateId && currentState.templates[templateId] ? templateId : '__custom__';
        updatePresetActionButtons(selectEl.value);
    }

    setVal('bts-code-type', normalized.codeType);
    setVal('bts-value-source', normalized.valueSource);
    setVal('bts-sort-order', normalized.printSortOrder);
    setVal('bts-paper-w', normalized.paperW);
    setVal('bts-paper-h', normalized.paperH);
    setVal('bts-font-name', normalized.fontName);
    setVal('bts-font-code', normalized.fontCode);
    setVal('bts-font-details', normalized.fontDetails);
    setVal('bts-font-price', normalized.fontPrice);
    setChecked('bts-code-bold', normalized.codeBold);
    setChecked('bts-color-inline', normalized.colorInline);
    setChecked('bts-show-name', normalized.showName);
    setChecked('bts-show-code', normalized.showCode);
    setChecked('bts-show-sizes', normalized.showSizes);
    setChecked('bts-show-price', normalized.showPrice);
    setVal('bts-qty-mode', normalized.qtyMode);
    setVal('bts-fixed-qty', normalized.fixedQty);
    setVal('bts-color-dist', normalized.colorDist);
    setChecked('bts-show-colors', normalized.showColors);
    setChecked('bts-skip-zero-stock', normalized.skipZeroStockColors);

    syncQtyModeVisibility();
}

function readConfigFromForm() {
    const selectEl = document.getElementById('bts-template-select');
    const selectedId = selectEl?.value || '__custom__';
    const existingPreset = selectedId !== '__custom__' ? currentState.templates[selectedId] : null;

    return normalizeBarcodeTemplate({
        name: existingPreset?.name || currentState.activeConfig?.name || 'إعداد مخصص',
        codeType: document.getElementById('bts-code-type')?.value,
        valueSource: document.getElementById('bts-value-source')?.value,
        printSortOrder: document.getElementById('bts-sort-order')?.value,
        paperW: document.getElementById('bts-paper-w')?.value,
        paperH: document.getElementById('bts-paper-h')?.value,
        fontName: document.getElementById('bts-font-name')?.value,
        fontCode: document.getElementById('bts-font-code')?.value,
        fontDetails: document.getElementById('bts-font-details')?.value,
        fontPrice: document.getElementById('bts-font-price')?.value,
        codeBold: document.getElementById('bts-code-bold')?.checked,
        colorInline: document.getElementById('bts-color-inline')?.checked,
        showName: document.getElementById('bts-show-name')?.checked,
        showCode: document.getElementById('bts-show-code')?.checked,
        showSizes: document.getElementById('bts-show-sizes')?.checked,
        showPrice: document.getElementById('bts-show-price')?.checked,
        qtyMode: document.getElementById('bts-qty-mode')?.value,
        fixedQty: document.getElementById('bts-fixed-qty')?.value,
        colorDist: document.getElementById('bts-color-dist')?.value,
        showColors: document.getElementById('bts-show-colors')?.checked,
        skipZeroStockColors: document.getElementById('bts-skip-zero-stock')?.checked
    });
}

function syncQtyModeVisibility() {
    const qtyMode = document.getElementById('bts-qty-mode')?.value || 'fixed';
    const label = document.getElementById('bts-qty-label');
    const colorDistContainer = document.getElementById('bts-color-dist-container');

    if (qtyMode === 'fixed') {
        if (label) label.textContent = 'عدد النسخ لكل موديل';
        if (colorDistContainer) colorDistContainer.classList.add('hidden');
    } else {
        if (label) label.textContent = 'عدد النسخ لكل لون';
        if (colorDistContainer) colorDistContainer.classList.remove('hidden');
    }
}

function updateSavedStatusLine() {
    const summaryEl = document.getElementById('bts-active-summary');
    const unsavedEl = document.getElementById('bts-unsaved-notice');
    if (summaryEl) {
        const presetName = currentState.activeTemplateId !== '__custom__'
            ? currentState.templates[currentState.activeTemplateId]?.name
            : 'إعداد مخصص';
        summaryEl.textContent = `القالب النشط للطباعة المباشرة: ${formatActiveTemplateSummary(currentState.activeConfig, presetName)}`;
    }
    if (unsavedEl) {
        unsavedEl.classList.toggle('hidden', !hasUnsavedEdits);
    }
}

async function refreshPreview() {
    const formConfig = readConfigFromForm();
    await renderBarcodeLabelPreview({
        prefix: 'bts',
        config: formConfig
    });
}

function bindBarcodeTemplateSettingsEvents() {
    const selectEl = document.getElementById('bts-template-select');
    if (selectEl) {
        selectEl.addEventListener('change', async () => {
            const selectedId = selectEl.value;
            updatePresetActionButtons(selectedId);
            if (selectedId && selectedId !== '__custom__' && currentState.templates[selectedId]) {
                applyConfigToForm(currentState.templates[selectedId], selectedId);
                hasUnsavedEdits = true;
                updateSavedStatusLine();
                await refreshPreview();
            }
        });
    }

    const fieldIds = [
        'bts-code-type', 'bts-value-source', 'bts-sort-order',
        'bts-paper-w', 'bts-paper-h',
        'bts-font-name', 'bts-font-code', 'bts-font-details', 'bts-font-price',
        'bts-code-bold', 'bts-color-inline',
        'bts-show-name', 'bts-show-code', 'bts-show-sizes', 'bts-show-price',
        'bts-qty-mode', 'bts-fixed-qty', 'bts-color-dist',
        'bts-show-colors', 'bts-skip-zero-stock'
    ];

    fieldIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const evtName = (el.tagName === 'INPUT' && el.type !== 'checkbox') ? 'input' : 'change';
        el.addEventListener(evtName, async () => {
            if (id === 'bts-qty-mode') syncQtyModeVisibility();
            hasUnsavedEdits = true;
            updateSavedStatusLine();
            await refreshPreview();
        });
    });

    document.getElementById('bts-save-active-btn')?.addEventListener('click', handleSaveActiveTemplate);
    document.getElementById('bts-save-new-preset-btn')?.addEventListener('click', handleSaveAsNewPreset);
    document.getElementById('bts-update-preset-btn')?.addEventListener('click', handleUpdateSelectedPreset);
    document.getElementById('bts-delete-preset-btn')?.addEventListener('click', handleDeleteSelectedPreset);
    document.getElementById('bts-test-print-btn')?.addEventListener('click', handleTestPrint);
}

async function handleSaveActiveTemplate() {
    const btn = document.getElementById('bts-save-active-btn');
    const selectEl = document.getElementById('bts-template-select');
    const selectedId = selectEl?.value || '__custom__';
    const nextConfig = readConfigFromForm();

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="ph ph-spinner animate-spin text-base"></i> <span>جاري الحفظ...</span>`;
    }

    try {
        const saved = await saveBarcodeTemplateState({
            templates: currentState.templates,
            activeTemplateId: selectedId,
            activeConfig: nextConfig
        });
        currentState = {
            templates: { ...saved.templates },
            activeTemplateId: saved.activeTemplateId,
            activeConfig: normalizeBarcodeTemplate(saved.activeConfig)
        };
        hasUnsavedEdits = false;
        updateSavedStatusLine();
        showToast('تم حفظ وتفعيل قالب طباعة الباركود المباشرة بنجاح', 'success');
    } catch (err) {
        console.error('Save barcode template error:', err);
        showToast('تعذر حفظ الإعدادات: ' + (err?.message || 'خطأ في الاتصال'), 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="ph ph-floppy-disk text-base"></i> <span>حفظ وتفعيل للطباعة المباشرة</span>`;
        }
    }
}

async function handleSaveAsNewPreset() {
    const nameInput = document.getElementById('bts-new-template-name');
    const templateName = nameInput?.value.trim() || '';
    if (!templateName) {
        showToast('الرجاء إدخال اسم للقالب الجديد أولاً', 'warning');
        nameInput?.focus();
        return;
    }

    const key = 'custom_' + Date.now();
    const newPreset = normalizeBarcodeTemplate({
        ...readConfigFromForm(),
        name: templateName
    });

    const nextTemplates = {
        ...currentState.templates,
        [key]: newPreset
    };

    try {
        const saved = await saveBarcodeTemplateState({
            templates: nextTemplates,
            activeTemplateId: key,
            activeConfig: newPreset
        });
        currentState = {
            templates: { ...saved.templates },
            activeTemplateId: key,
            activeConfig: normalizeBarcodeTemplate(saved.activeConfig)
        };
        if (nameInput) nameInput.value = '';
        hasUnsavedEdits = false;
        populateTemplateSelect();
        applyConfigToForm(currentState.activeConfig, key);
        updateSavedStatusLine();
        await refreshPreview();
        showToast(`تم حفظ القالب "${templateName}" وتفعيله للطباعة المباشرة`, 'success');
    } catch (err) {
        console.error('Save new preset error:', err);
        showToast('تعذر حفظ القالب الجديد: ' + (err?.message || 'خطأ في الاتصال'), 'error');
    }
}

async function handleUpdateSelectedPreset() {
    const selectEl = document.getElementById('bts-template-select');
    const selectedId = selectEl?.value;
    if (!selectedId || selectedId === '__custom__' || SYSTEM_TEMPLATE_IDS.has(selectedId)) {
        return;
    }

    const existingName = currentState.templates[selectedId]?.name || 'قالب مخصص';
    const updatedPreset = normalizeBarcodeTemplate({
        ...readConfigFromForm(),
        name: existingName
    });

    const nextTemplates = {
        ...currentState.templates,
        [selectedId]: updatedPreset
    };

    try {
        const saved = await saveBarcodeTemplateState({
            templates: nextTemplates,
            activeTemplateId: selectedId,
            activeConfig: updatedPreset
        });
        currentState = {
            templates: { ...saved.templates },
            activeTemplateId: selectedId,
            activeConfig: normalizeBarcodeTemplate(saved.activeConfig)
        };
        hasUnsavedEdits = false;
        populateTemplateSelect();
        updateSavedStatusLine();
        await refreshPreview();
        showToast(`تم تحديث القالب "${existingName}" وتفعيله بنجاح`, 'success');
    } catch (err) {
        console.error('Update preset error:', err);
        showToast('تعذر تحديث القالب: ' + (err?.message || 'خطأ في الاتصال'), 'error');
    }
}

async function handleDeleteSelectedPreset() {
    const selectEl = document.getElementById('bts-template-select');
    const selectedId = selectEl?.value;
    if (!selectedId || selectedId === '__custom__' || SYSTEM_TEMPLATE_IDS.has(selectedId)) {
        return showToast('لا يمكن حذف القوالب الافتراضية الخاصة بالنظام', 'warning');
    }

    const templateName = currentState.templates[selectedId]?.name || '';
    const confirmed = await confirmDialog({
        title: 'حذف قالب الطباعة',
        message: `هل تريد حذف القالب "${templateName}"؟`,
        confirmText: 'حذف القالب',
        cancelText: 'إلغاء',
        type: 'danger'
    });
    if (!confirmed) return;

    const nextTemplates = { ...currentState.templates };
    delete nextTemplates[selectedId];

    try {
        const saved = await saveBarcodeTemplateState({
            templates: nextTemplates,
            activeTemplateId: 'default_4_5',
            activeConfig: nextTemplates.default_4_5 || DEFAULT_BARCODE_TEMPLATES.default_4_5
        });
        currentState = {
            templates: { ...saved.templates },
            activeTemplateId: saved.activeTemplateId,
            activeConfig: normalizeBarcodeTemplate(saved.activeConfig)
        };
        hasUnsavedEdits = false;
        populateTemplateSelect();
        applyConfigToForm(currentState.activeConfig, currentState.activeTemplateId);
        updateSavedStatusLine();
        await refreshPreview();
        showToast(`تم حذف القالب "${templateName}"`, 'success');
    } catch (err) {
        console.error('Delete preset error:', err);
        showToast('تعذر حذف القالب: ' + (err?.message || 'خطأ في الاتصال'), 'error');
    }
}

async function handleTestPrint() {
    const testConfig = normalizeBarcodeTemplate({
        ...readConfigFromForm(),
        qtyMode: 'fixed',
        fixedQty: 1,
        skipZeroStockColors: false
    });

    const sampleModel = {
        id: 'sample-test',
        name: 'موديل تجريبي للمعاينة',
        factory_code: '12345',
        system_code: '12345',
        price: 150,
        classes: { class_sizes: [{ size_id: 'S' }, { size_id: 'M' }, { size_id: 'L' }] },
        model_inventory: [{ color_id: 'c1', available_series: 5, colors: { name: 'أحمر' } }]
    };

    await printModelsDirect([sampleModel], {
        templateConfigOverride: testConfig,
        sizesMap: { S: 'S', M: 'M', L: 'L' },
        colorsMap: { c1: 'أحمر' }
    });
}
