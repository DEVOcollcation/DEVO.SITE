import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { requireAuth } from '../../services/auth.js';
import { checkModelsInInvoices } from './models.js';
import {
    buildSettlementPlan,
    buildOrderArchiveSettlementEntries,
    buildOrderRestoreStockDeltas,
    buildInboundDeductStockDeltas,
    filterModelsByHunter,
    escapeHtml
} from '../../services/data_management_logic.js';

// =========================================================================
// 📦 MODULE STATE
// =========================================================================
let isDmInitialized = false;
let activeDmTab = 'models'; // 'models' | 'invoices' | 'notifications'

// Model Hunter state (strictly isolated from bulk_edits / print_barcodes)
let dmAllModels = [];
let dmFilteredModels = [];
let dmSelectedIds = new Set();
let dmCurrentPage = 1;
const DM_ITEMS_PER_PAGE = 50;
let dmOpenDropdownId = null;

// Live counts cache for Invoices & Notifications
let dmCounts = {
    ordersTotal: 0,
    ordersActive: 0,
    ordersArchived: 0,
    inboundTotal: 0,
    visitorTotal: 0,
    visitorPending: 0,
    notifTotal: 0,
    notifUnread: 0,
    notifRead: 0,
    notifArchived: 0
};

// =========================================================================
// 🚀 INITIALIZATION
// =========================================================================
export async function initDataManagementView() {
    const user = requireAuth(['owner']);
    if (!user || user.role !== 'owner') {
        showToast('هذه الصفحة مخصصة لمالك النظام فقط', 'error');
        return;
    }

    if (!isDmInitialized) {
        renderDataManagementShell();
        attachGlobalEvents();
        isDmInitialized = true;
    }

    await refreshDataManagementData();
}

export async function refreshDataManagementData() {
    await Promise.all([
        fetchDmFilterOptions(),
        fetchDmModels(),
        fetchDmLiveCounts()
    ]);
}

// =========================================================================
// 🎨 SHELL RENDERING
// =========================================================================
function renderDataManagementShell() {
    const container = document.getElementById('data-management-content');
    if (!container) return;

    container.innerHTML = `
        <div class="animate-fade-in relative pb-12 space-y-5 max-w-[1400px] mx-auto">

            <!-- Top Workspace Header & Segmented Tabs -->
            <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div class="space-y-1">
                    <h2 class="text-lg sm:text-xl font-bold text-devo-text flex items-center gap-2">
                        <i class="ph ph-sliders-horizontal text-devo-orange text-2xl shrink-0"></i>
                        <span>إدارة البيانات والتسويات</span>
                    </h2>
                    <p class="text-xs text-devo-muted">تحكم دقيق في تسوية وتصفير أرصدة الموديلات مع حفظ الأصل، وحذف الفواتير والطلبات والإشعارات</p>
                </div>

                <!-- Segmented Control Tabs -->
                <div class="flex items-center gap-1 p-1 bg-devo-black border border-devo-gray rounded-xl overflow-x-auto shrink-0" role="tablist" aria-label="أقسام إدارة البيانات">
                    <button type="button" role="tab" id="dm-tab-btn-models" data-dm-tab="models" class="dm-tab-btn px-3.5 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        <i class="ph ph-t-shirt text-base"></i>
                        <span>الموديلات والمخزون</span>
                    </button>
                    <button type="button" role="tab" id="dm-tab-btn-invoices" data-dm-tab="invoices" class="dm-tab-btn px-3.5 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        <i class="ph ph-receipt text-base"></i>
                        <span>الفواتير والطلبات</span>
                    </button>
                    <button type="button" role="tab" id="dm-tab-btn-notifications" data-dm-tab="notifications" class="dm-tab-btn px-3.5 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0">
                        <i class="ph ph-bell-slash text-base"></i>
                        <span>الإشعارات</span>
                    </button>
                </div>
            </div>

            <!-- ========================================================= -->
            <!-- TAB 1: MODELS & INVENTORY (POWERED BY MODEL HUNTER)       -->
            <!-- ========================================================= -->
            <section id="dm-panel-models" class="space-y-4">
                <!-- صياد الموديلات (فلترة متقدمة) -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl shadow-sm transition-all duration-300">
                    <button type="button" id="dm-hunter-toggle" aria-expanded="true" class="w-full p-4 flex justify-between items-center cursor-pointer select-none border-b border-transparent hover:border-devo-gray/50 transition-colors text-right">
                        <span class="text-base md:text-lg font-bold text-devo-text flex items-center gap-2">
                            <i class="ph ph-funnel text-devo-orange text-xl"></i>
                            <span>صياد الموديلات (فلترة متقدمة)</span>
                        </span>
                        <span class="flex items-center gap-3 shrink-0">
                            <span class="text-xs text-devo-muted hidden md:inline">اضغط للطي/الفتح</span>
                            <i id="dm-hunter-caret" class="ph ph-caret-up text-xl text-devo-muted transition-transform duration-200"></i>
                        </span>
                    </button>

                    <div id="dm-hunter-body" class="p-4 border-t border-devo-gray">
                        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            <!-- Row 1: Split Searches -->
                            <div class="lg:col-span-2 relative">
                                <i class="ph ph-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-devo-muted pointer-events-none"></i>
                                <input type="text" id="dm-search-name" autocomplete="off" placeholder="البحث باسم الصنف..." class="w-full bg-devo-black border border-devo-gray rounded-lg pr-9 pl-3 py-2.5 text-devo-text outline-none focus:border-devo-orange text-sm transition-colors">
                            </div>
                            <div class="relative">
                                <i class="ph ph-hash absolute right-3 top-1/2 -translate-y-1/2 text-devo-muted pointer-events-none"></i>
                                <input type="text" id="dm-search-factory" autocomplete="off" placeholder="كود المصنع..." class="w-full bg-devo-black border border-devo-gray rounded-lg pr-9 pl-3 py-2.5 text-devo-text outline-none focus:border-devo-orange text-sm transition-colors">
                            </div>
                            <div class="relative">
                                <i class="ph ph-cpu absolute right-3 top-1/2 -translate-y-1/2 text-devo-muted pointer-events-none"></i>
                                <input type="text" id="dm-search-system" autocomplete="off" placeholder="كود السيستم..." class="w-full bg-devo-black border border-devo-gray rounded-lg pr-9 pl-3 py-2.5 text-devo-text outline-none focus:border-devo-orange text-sm transition-colors">
                            </div>

                            <!-- Row 2: Factory Range & Categories / Classes -->
                            <div class="lg:col-span-2 flex items-center gap-2 bg-devo-black border border-devo-gray rounded-lg px-3 py-1.5">
                                <span class="text-xs text-devo-muted whitespace-nowrap">رينج كود المصنع:</span>
                                <input type="text" id="dm-factory-from" class="bg-transparent text-devo-text outline-none text-sm w-full text-center font-mono" placeholder="من كود">
                                <span class="text-xs text-devo-muted whitespace-nowrap border-r border-devo-gray pr-2 pl-1">إلى:</span>
                                <input type="text" id="dm-factory-to" class="bg-transparent text-devo-text outline-none text-sm w-full text-center font-mono" placeholder="إلى كود">
                            </div>

                            ${renderMultiSelectMarkup('cat', 'جميع التصنيفات')}
                            ${renderMultiSelectMarkup('class', 'جميع الفئات')}

                            <!-- Row 3: Colors, Sizes, Status, Stock -->
                            ${renderMultiSelectMarkup('color', 'جميع الألوان')}
                            ${renderMultiSelectMarkup('size', 'جميع المقاسات')}

                            <select id="dm-filter-status" aria-label="حالة التفعيل" class="bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-devo-text outline-none focus:border-devo-orange text-sm cursor-pointer">
                                <option value="">حالة التفعيل (الكل)</option>
                                <option value="true">النشطة فقط</option>
                                <option value="false">المعطلة فقط</option>
                            </select>

                            <div class="flex items-center gap-1 bg-devo-black border border-devo-gray rounded-lg px-2">
                                <select id="dm-filter-stock-op" aria-label="كمية المخزون" class="bg-transparent text-devo-text outline-none text-sm cursor-pointer w-full py-2.5">
                                    <option class="bg-devo-dark text-devo-text" value="">كمية المخزون (الكل)</option>
                                    <option class="bg-devo-dark text-devo-text" value="greater">الكمية أكبر من</option>
                                    <option class="bg-devo-dark text-devo-text" value="less">الكمية أقل من</option>
                                    <option class="bg-devo-dark text-devo-text" value="equal">الكمية تساوي</option>
                                </select>
                                <input type="number" id="dm-filter-stock-qty" placeholder="الكمية" min="0" class="bg-transparent text-devo-text outline-none text-sm font-mono tabular-nums w-16 text-center border-r border-devo-gray py-2.5 hidden">
                            </div>

                            <!-- Row 4: Price Range & Date Range -->
                            <div class="lg:col-span-2 flex items-center gap-2 bg-devo-black border border-devo-gray rounded-lg px-3 py-1.5">
                                <span class="text-xs text-devo-muted whitespace-nowrap">السعر:</span>
                                <input type="number" id="dm-price-min" class="bg-transparent text-devo-text outline-none text-sm w-full text-center font-mono tabular-nums" placeholder="من">
                                <span class="text-xs text-devo-muted whitespace-nowrap border-r border-devo-gray pr-2 pl-1">إلى:</span>
                                <input type="number" id="dm-price-max" class="bg-transparent text-devo-text outline-none text-sm w-full text-center font-mono tabular-nums" placeholder="أقصى">
                            </div>

                            <div class="lg:col-span-2 flex items-center gap-2 bg-devo-black border border-devo-gray rounded-lg px-3 py-1.5">
                                <span class="text-xs text-devo-muted whitespace-nowrap">الإضافة:</span>
                                <input type="date" id="dm-date-from" aria-label="من تاريخ الإضافة" class="bg-transparent text-devo-muted outline-none text-xs w-full cursor-pointer">
                                <span class="text-xs text-devo-muted whitespace-nowrap border-r border-devo-gray pr-2 pl-1">إلى:</span>
                                <input type="date" id="dm-date-to" aria-label="إلى تاريخ الإضافة" class="bg-transparent text-devo-muted outline-none text-xs w-full cursor-pointer">
                            </div>

                            <!-- Row 5: Search & Clear -->
                            <div class="col-span-full flex gap-2 mt-1">
                                <button type="button" id="dm-apply-filters-btn" class="flex-1 bg-devo-orange hover:bg-devo-orangeHover text-white py-2.5 px-4 rounded-lg text-sm font-bold transition-colors flex justify-center items-center gap-2">
                                    <i class="ph ph-magnifying-glass text-lg"></i>
                                    <span>بحث وتطبيق الفلاتر</span>
                                </button>
                                <button type="button" id="dm-clear-filters-btn" title="مسح الفلاتر" aria-label="مسح الفلاتر" class="bg-devo-gray hover:bg-devo-black border border-devo-gray text-devo-text px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center justify-center">
                                    <i class="ph ph-eraser text-lg"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Filtered Models Table -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl overflow-hidden flex flex-col">
                    <div class="px-4 py-3 bg-devo-black/70 border-b border-devo-gray flex flex-wrap items-center justify-between gap-3">
                        <div class="flex items-center gap-4 text-xs sm:text-sm">
                            <span class="font-bold text-devo-text">إجمالي المطابق: <span id="dm-results-count" class="text-devo-orange font-mono tabular-nums">0</span> موديل</span>
                            <span class="text-devo-gray">|</span>
                            <span class="text-devo-muted">المحدد للتنفيذ: <span id="dm-selected-count" class="text-devo-text font-bold font-mono tabular-nums">0</span></span>
                            <span class="text-devo-gray hidden sm:inline">|</span>
                            <span class="text-devo-muted hidden sm:inline">إجمالي الرصيد المتبقي بالمحدد: <span id="dm-selected-series" class="text-devo-orange font-bold font-mono tabular-nums">0</span> سيري</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button type="button" id="dm-select-all-filtered-btn" class="px-3 py-1.5 rounded-lg bg-devo-dark border border-devo-gray hover:border-devo-orange/60 text-xs text-devo-text transition-colors whitespace-nowrap">
                                تحديد كل المطابق
                            </button>
                            <button type="button" id="dm-deselect-all-btn" class="px-3 py-1.5 rounded-lg bg-devo-dark border border-devo-gray hover:border-devo-grayHover text-xs text-devo-muted hover:text-devo-text transition-colors whitespace-nowrap">
                                إلغاء التحديد
                            </button>
                        </div>
                    </div>

                    <div class="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar">
                        <table class="w-full text-right text-sm">
                            <thead class="bg-devo-black sticky top-0 z-10 text-devo-muted text-xs border-b border-devo-gray">
                                <tr>
                                    <th class="p-3 w-12 text-center border-l border-devo-gray/30">
                                        <input type="checkbox" id="dm-select-all-cb" aria-label="تحديد جميع الموديلات المطابقة" class="accent-devo-orange w-4 h-4 cursor-pointer">
                                    </th>
                                    <th class="p-3">الكود والموديل</th>
                                    <th class="p-3 text-center">التصنيف / الفئة</th>
                                    <th class="p-3 text-center">الألوان المتاحة</th>
                                    <th class="p-3 text-center">الرصيد المتبقي</th>
                                    <th class="p-3 text-center">الحالة</th>
                                </tr>
                            </thead>
                            <tbody id="dm-models-tbody" class="divide-y divide-devo-gray/40">
                                <tr><td colspan="6" class="p-10 text-center text-devo-muted text-xs">جاري تحميل الموديلات...</td></tr>
                            </tbody>
                        </table>
                    </div>

                    <div id="dm-pagination" class="px-4 py-2.5 bg-devo-black/50 border-t border-devo-gray flex items-center justify-between text-xs text-devo-muted"></div>
                </div>

                <!-- Sticky Operational Action Bar for Selected Models -->
                <div id="dm-models-actionbar" class="sticky bottom-2 z-20 bg-devo-dark/95 backdrop-blur-md border border-devo-gray shadow-devo-float rounded-xl p-3.5 sm:p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 transition-colors">
                    <div class="space-y-0.5 min-w-0">
                        <p class="text-sm font-bold text-devo-text">إجراءات على الموديلات المحددة (<span id="dm-actionbar-count" class="text-devo-orange font-mono tabular-nums">0</span>)</p>
                        <p class="text-xs text-devo-muted truncate">تصفير/تسوية الرصيد يسجّل حركة تسوية مستقلة تحفظ «الأصل» صحيحاً في كارت الموديل بالمعرض</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2.5 shrink-0">
                        <button type="button" id="dm-open-zero-modal-btn" class="flex-1 md:flex-none justify-center px-4 py-2.5 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs sm:text-sm font-bold transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
                            <i class="ph ph-arrows-counter-clockwise text-base"></i>
                            <span>تصفير / تسوية الرصيد</span>
                        </button>
                        <button type="button" id="dm-open-delete-models-btn" class="flex-1 md:flex-none justify-center px-4 py-2.5 rounded-xl bg-devo-error/15 hover:bg-devo-error/25 border border-devo-error/40 text-devo-error text-xs sm:text-sm font-bold transition-colors flex items-center gap-2 whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
                            <i class="ph ph-trash text-base"></i>
                            <span>حذف الموديلات المحددة</span>
                        </button>
                    </div>
                </div>
            </section>

            <!-- ========================================================= -->
            <!-- TAB 2: INVOICES & ORDERS MANAGEMENT                       -->
            <!-- ========================================================= -->
            <section id="dm-panel-invoices" class="hidden space-y-4">
                <!-- Live Summary Strip -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-1">
                        <p class="text-xs text-devo-muted">فواتير المبيعات والأوردرات</p>
                        <p class="text-2xl font-black text-devo-text font-mono tabular-nums" id="dm-stat-orders">0</p>
                        <p class="text-xs text-devo-muted">نشط: <span id="dm-stat-orders-active" class="text-devo-text font-mono tabular-nums">0</span> · مؤرشف: <span id="dm-stat-orders-archived" class="text-devo-text font-mono tabular-nums">0</span></p>
                    </div>
                    <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-1">
                        <p class="text-xs text-devo-muted">فواتير الدخل وإضافة الرصيد</p>
                        <p class="text-2xl font-black text-devo-text font-mono tabular-nums" id="dm-stat-inbound">0</p>
                        <p class="text-xs text-devo-muted">إجمالي دفعات التوريد المسجلة</p>
                    </div>
                    <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-1">
                        <p class="text-xs text-devo-muted">طلبات الزوار (قائمة الانتظار)</p>
                        <p class="text-2xl font-black text-devo-text font-mono tabular-nums" id="dm-stat-visitors">0</p>
                        <p class="text-xs text-devo-muted">قيد الانتظار: <span id="dm-stat-visitors-pending" class="text-devo-orange font-mono tabular-nums">0</span></p>
                    </div>
                </div>

                <!-- 1. Sales Invoices / Orders Card -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl p-5 space-y-4">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-devo-gray">
                        <div>
                            <h3 class="text-base font-bold text-devo-text flex items-center gap-2">
                                <i class="ph ph-receipt text-devo-orange text-lg"></i>
                                <span>حذف فواتير المبيعات والأوردرات</span>
                            </h3>
                            <p class="text-xs text-devo-muted mt-0.5">حذف كل الفواتير أو حسب الحالة والتاريخ مع تحديد أثر الحذف على المخزون والأصل</p>
                        </div>
                        <button type="button" id="dm-delete-orders-btn" class="px-4 py-2.5 rounded-xl bg-devo-error hover:bg-red-700 text-white text-xs font-bold transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0">
                            <i class="ph ph-trash text-base"></i>
                            <span>معاينة وحذف فواتير المبيعات</span>
                        </button>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label for="dm-orders-scope" class="block text-xs text-devo-muted mb-1.5">نطاق الفواتير</label>
                            <select id="dm-orders-scope" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                                <option value="all">جميع فواتير المبيعات (النشطة والمؤرشفة)</option>
                                <option value="active">الفواتير النشطة فقط</option>
                                <option value="archived">الفواتير المؤرشفة فقط</option>
                            </select>
                        </div>
                        <div>
                            <label for="dm-orders-date-from" class="block text-xs text-devo-muted mb-1.5">من تاريخ (اختياري)</label>
                            <input type="date" id="dm-orders-date-from" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                        </div>
                        <div>
                            <label for="dm-orders-date-to" class="block text-xs text-devo-muted mb-1.5">إلى تاريخ (اختياري)</label>
                            <input type="date" id="dm-orders-date-to" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                        </div>
                    </div>

                    <!-- Explicit Stock Choice for Sales Orders -->
                    <div class="space-y-2.5 pt-1">
                        <p class="text-xs font-bold text-devo-text">التعامل مع رصيد الموديلات وقت الحذف:</p>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <label class="flex items-start gap-3 p-3.5 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer transition-colors">
                                <input type="radio" name="dm-orders-stock-mode" value="keep" checked class="mt-0.5 accent-devo-orange w-4 h-4 shrink-0">
                                <div class="space-y-1.5">
                                    <span class="block text-xs sm:text-sm font-bold text-devo-text">إبقاء الرصيد الحالي كما هو</span>
                                    <span class="block text-xs text-devo-muted leading-relaxed">يحذف الفواتير فقط دون إضافة كمياتها للمخزن مرة أخرى.</span>
                                    <label class="flex items-center gap-2 pt-1 text-xs text-devo-orange cursor-pointer">
                                        <input type="checkbox" id="dm-orders-preserve-base" checked class="accent-devo-orange w-3.5 h-3.5 rounded">
                                        <span>حفظ كمياتها كـ «تسوية أرشيفية» ليظل الأصل صحيحاً بكارت الموديل</span>
                                    </label>
                                </div>
                            </label>
                            <label class="flex items-start gap-3 p-3.5 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer transition-colors">
                                <input type="radio" name="dm-orders-stock-mode" value="restore" class="mt-0.5 accent-devo-orange w-4 h-4 shrink-0">
                                <div class="space-y-1">
                                    <span class="block text-xs sm:text-sm font-bold text-devo-text">استرجاع كميات الفواتير إلى المخزون</span>
                                    <span class="block text-xs text-devo-muted leading-relaxed">يعيد جميع السيريهات المباعة داخل الفواتير المحذوفة إلى رصيد الموديلات المتاح.</span>
                                </div>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- 2. Inbound Invoices Card -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl p-5 space-y-4">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-devo-gray">
                        <div>
                            <h3 class="text-base font-bold text-devo-text flex items-center gap-2">
                                <i class="ph ph-truck text-devo-orange text-lg"></i>
                                <span>حذف فواتير الدخل وإضافة الرصيد</span>
                            </h3>
                            <p class="text-xs text-devo-muted mt-0.5">حذف سجل دفعات التوريد بالكامل أو خلال فترة محددة مع اختيار أثرها على المخزون</p>
                        </div>
                        <button type="button" id="dm-delete-inbound-btn" class="px-4 py-2.5 rounded-xl bg-devo-error/15 hover:bg-devo-error/25 border border-devo-error/40 text-devo-error text-xs font-bold transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0">
                            <i class="ph ph-trash text-base"></i>
                            <span>معاينة وحذف فواتير الدخل</span>
                        </button>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label for="dm-inbound-date-from" class="block text-xs text-devo-muted mb-1.5">من تاريخ (اختياري)</label>
                            <input type="date" id="dm-inbound-date-from" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                        </div>
                        <div>
                            <label for="dm-inbound-date-to" class="block text-xs text-devo-muted mb-1.5">إلى تاريخ (اختياري)</label>
                            <input type="date" id="dm-inbound-date-to" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <label class="flex items-start gap-3 p-3.5 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer transition-colors">
                            <input type="radio" name="dm-inbound-stock-mode" value="keep" checked class="mt-0.5 accent-devo-orange w-4 h-4 shrink-0">
                            <div>
                                <span class="block text-xs sm:text-sm font-bold text-devo-text">إبقاء الرصيد الحالي كما هو</span>
                                <span class="block text-xs text-devo-muted mt-0.5">يحذف سجلات فواتير التوريد فقط دون المساس بالأرصدة الحالية.</span>
                            </div>
                        </label>
                        <label class="flex items-start gap-3 p-3.5 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer transition-colors">
                            <input type="radio" name="dm-inbound-stock-mode" value="deduct" class="mt-0.5 accent-devo-orange w-4 h-4 shrink-0">
                            <div>
                                <span class="block text-xs sm:text-sm font-bold text-devo-text">خصم كمياتها من المخزون (بحد أدنى 0)</span>
                                <span class="block text-xs text-devo-muted mt-0.5">يخصم السيريهات الواردة في تلك الفواتير من رصيد كل موديل ولون.</span>
                            </div>
                        </label>
                    </div>
                </div>

                <!-- 3. Visitor Waiting Orders Card -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl p-5 space-y-4">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-devo-gray">
                        <div>
                            <h3 class="text-base font-bold text-devo-text flex items-center gap-2">
                                <i class="ph ph-clock text-devo-orange text-lg"></i>
                                <span>حذف طلبات الزوار (قائمة الانتظار)</span>
                            </h3>
                            <p class="text-xs text-devo-muted mt-0.5">تنظيف طلبات الزوار غير المؤكدة أو القديمة (لا تؤثر على أرصدة المخزون)</p>
                        </div>
                        <button type="button" id="dm-delete-visitors-btn" class="px-4 py-2.5 rounded-xl bg-devo-error/15 hover:bg-devo-error/25 border border-devo-error/40 text-devo-error text-xs font-bold transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0">
                            <i class="ph ph-trash text-base"></i>
                            <span>معاينة وحذف طلبات الزوار</span>
                        </button>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label for="dm-visitors-status" class="block text-xs text-devo-muted mb-1.5">حالة الطلب</label>
                            <select id="dm-visitors-status" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                                <option value="all">جميع طلبات الزوار</option>
                                <option value="pending">قيد الانتظار فقط</option>
                                <option value="confirmed">المؤكدة فقط</option>
                                <option value="cancelled">الملغاة فقط</option>
                            </select>
                        </div>
                        <div>
                            <label for="dm-visitors-date-from" class="block text-xs text-devo-muted mb-1.5">من تاريخ (اختياري)</label>
                            <input type="date" id="dm-visitors-date-from" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                        </div>
                        <div>
                            <label for="dm-visitors-date-to" class="block text-xs text-devo-muted mb-1.5">إلى تاريخ (اختياري)</label>
                            <input type="date" id="dm-visitors-date-to" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                        </div>
                    </div>
                </div>
            </section>

            <!-- ========================================================= -->
            <!-- TAB 3: NOTIFICATIONS CLEANUP                              -->
            <!-- ========================================================= -->
            <section id="dm-panel-notifications" class="hidden space-y-4">
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-1">
                        <p class="text-xs text-devo-muted">إجمالي الإشعارات</p>
                        <p class="text-2xl font-black text-devo-text font-mono tabular-nums" id="dm-stat-notif-total">0</p>
                    </div>
                    <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-1">
                        <p class="text-xs text-devo-muted">غير مقروءة</p>
                        <p class="text-2xl font-black text-devo-orange font-mono tabular-nums" id="dm-stat-notif-unread">0</p>
                    </div>
                    <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-1">
                        <p class="text-xs text-devo-muted">مقروءة</p>
                        <p class="text-2xl font-black text-devo-success font-mono tabular-nums" id="dm-stat-notif-read">0</p>
                    </div>
                    <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-1">
                        <p class="text-xs text-devo-muted">مؤرشفة</p>
                        <p class="text-2xl font-black text-devo-muted font-mono tabular-nums" id="dm-stat-notif-archived">0</p>
                    </div>
                </div>

                <div class="bg-devo-dark border border-devo-gray rounded-xl p-5 space-y-4">
                    <div class="pb-3 border-b border-devo-gray">
                        <h3 class="text-base font-bold text-devo-text flex items-center gap-2">
                            <i class="ph ph-bell-slash text-devo-orange text-lg"></i>
                            <span>حذف الإشعارات وسجلات التنبيهات</span>
                        </h3>
                        <p class="text-xs text-devo-muted mt-0.5">مسح كافة الإشعارات أو تنظيف الإشعارات المقروءة والقديمة فقط</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                        <div>
                            <label for="dm-notif-scope" class="block text-xs text-devo-muted mb-1.5">نطاق الحذف</label>
                            <select id="dm-notif-scope" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                                <option value="all">حذف جميع الإشعارات بالكامل</option>
                                <option value="read">حذف الإشعارات المقروءة فقط</option>
                                <option value="before_date">حذف الإشعارات الأقدم من تاريخ محدد</option>
                            </select>
                        </div>
                        <div id="dm-notif-date-wrap" class="hidden">
                            <label for="dm-notif-before-date" class="block text-xs text-devo-muted mb-1.5">الأقدم من تاريخ</label>
                            <input type="date" id="dm-notif-before-date" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-sm text-devo-text outline-none focus:border-devo-orange">
                        </div>
                    </div>

                    <div class="pt-2 flex justify-end">
                        <button type="button" id="dm-delete-notifs-btn" class="px-5 py-2.5 rounded-xl bg-devo-error hover:bg-red-700 text-white text-sm font-bold transition-colors flex items-center gap-2 whitespace-nowrap">
                            <i class="ph ph-trash text-base"></i>
                            <span>معاينة وحذف الإشعارات</span>
                        </button>
                    </div>
                </div>
            </section>
        </div>
    `;

    // Mount reusable operation modal directly on document.body so it sits above sidebar, header & sticky bars
    let modalPortal = document.getElementById('dm-modal-portal');
    if (!modalPortal) {
        modalPortal = document.createElement('div');
        modalPortal.id = 'dm-modal-portal';
        document.body.appendChild(modalPortal);
    }
    modalPortal.innerHTML = `
        <div id="dm-modal-overlay" class="fixed inset-0 z-[99950] bg-black/80 backdrop-blur-sm hidden items-center justify-center p-4 overflow-y-auto">
            <div id="dm-modal-box" class="w-full max-w-lg bg-devo-dark border border-devo-gray rounded-2xl shadow-devo-float overflow-hidden my-auto" role="dialog" aria-modal="true">
                <div class="p-4 sm:p-5 border-b border-devo-gray flex items-center justify-between gap-3 bg-devo-black/60">
                    <h3 id="dm-modal-title" class="text-base font-bold text-devo-text flex items-center gap-2"></h3>
                    <button type="button" id="dm-modal-close" aria-label="إغلاق" class="w-9 h-9 rounded-lg bg-devo-gray/40 hover:bg-devo-gray text-devo-muted hover:text-devo-text flex items-center justify-center transition-colors">
                        <i class="ph ph-x text-base"></i>
                    </button>
                </div>
                <div id="dm-modal-body" class="p-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar"></div>
                <div id="dm-modal-footer" class="p-4 border-t border-devo-gray bg-devo-black/40 flex items-center justify-end gap-2.5"></div>
            </div>
        </div>
    `;

    switchDmTab(activeDmTab);
}

function renderMultiSelectMarkup(key, defaultLabel) {
    return `
        <div class="relative dm-multi-dropdown" id="dm-dd-${key}-container">
            <button type="button" data-dm-dd-toggle="dm-dd-${key}-menu" class="w-full bg-devo-black border border-devo-gray rounded-lg px-3 py-2.5 text-devo-text outline-none focus:border-devo-orange text-sm flex justify-between items-center cursor-pointer">
                <span id="dm-dd-${key}-label" class="truncate text-right">${defaultLabel}</span>
                <i class="ph ph-caret-down text-devo-muted text-xs shrink-0"></i>
            </button>
            <div id="dm-dd-${key}-menu" class="hidden absolute top-full right-0 left-0 mt-1 bg-devo-dark border border-devo-gray rounded-lg p-3 z-[120] shadow-devo-float flex flex-col gap-2">
                <div class="flex items-center justify-between border-b border-devo-gray/50 pb-2 mb-1">
                    <label class="flex items-center gap-1.5 cursor-pointer text-xs text-devo-text select-none">
                        <input type="checkbox" id="dm-dd-${key}-exclude" data-dm-dd-exclude="${key}" class="accent-devo-orange w-3.5 h-3.5 rounded cursor-pointer">
                        <span>استثناء المحدد</span>
                    </label>
                    <div class="flex gap-2">
                        <button type="button" data-dm-dd-action="all" data-dm-dd-key="${key}" class="text-[11px] text-devo-orange hover:underline">تحديد الكل</button>
                        <button type="button" data-dm-dd-action="clear" data-dm-dd-key="${key}" class="text-[11px] text-devo-muted hover:underline">مسح</button>
                    </div>
                </div>
                <div id="dm-dd-${key}-options" class="flex flex-col gap-1 max-h-40 overflow-y-auto custom-scrollbar"></div>
            </div>
        </div>
    `;
}

// =========================================================================
// 🎮 EVENT BINDING
// =========================================================================
function attachGlobalEvents() {
    // Tab switching
    document.querySelectorAll('.dm-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchDmTab(btn.dataset.dmTab);
        });
    });

    // Model Hunter collapse/expand
    document.getElementById('dm-hunter-toggle')?.addEventListener('click', () => {
        const body = document.getElementById('dm-hunter-body');
        const caret = document.getElementById('dm-hunter-caret');
        const btn = document.getElementById('dm-hunter-toggle');
        const hidden = body.classList.toggle('hidden');
        if (caret) caret.style.transform = hidden ? 'rotate(180deg)' : 'rotate(0deg)';
        btn?.setAttribute('aria-expanded', String(!hidden));
    });

    // Multi-select dropdown toggles & actions
    document.querySelectorAll('[data-dm-dd-toggle]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menuId = btn.dataset.dmDdToggle;
            const menu = document.getElementById(menuId);
            if (!menu) return;
            if (dmOpenDropdownId && dmOpenDropdownId !== menuId) {
                document.getElementById(dmOpenDropdownId)?.classList.add('hidden');
            }
            const willShow = menu.classList.contains('hidden');
            menu.classList.toggle('hidden', !willShow);
            dmOpenDropdownId = willShow ? menuId : null;
        });
    });

    document.querySelectorAll('.dm-multi-dropdown > div[id$="-menu"]').forEach(menu => {
        menu.addEventListener('click', (e) => e.stopPropagation());
    });

    document.addEventListener('click', () => {
        if (dmOpenDropdownId) {
            document.getElementById(dmOpenDropdownId)?.classList.add('hidden');
            dmOpenDropdownId = null;
        }
    });

    document.querySelectorAll('[data-dm-dd-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = btn.dataset.dmDdKey;
            const action = btn.dataset.dmDdAction;
            document.querySelectorAll(`input[name="dm-filter-${key}"]`).forEach(cb => {
                cb.checked = action === 'all';
            });
            updateDmMultiSelectLabel(key);
        });
    });

    document.querySelectorAll('[data-dm-dd-exclude]').forEach(cb => {
        cb.addEventListener('change', () => updateDmMultiSelectLabel(cb.dataset.dmDdExclude));
    });

    // Stock op reveal qty input
    const stockOp = document.getElementById('dm-filter-stock-op');
    const stockQty = document.getElementById('dm-filter-stock-qty');
    stockOp?.addEventListener('change', () => {
        if (stockOp.value) {
            stockQty?.classList.remove('hidden');
        } else {
            stockQty?.classList.add('hidden');
            if (stockQty) stockQty.value = '';
        }
    });

    // Search/Clear filter actions
    document.getElementById('dm-apply-filters-btn')?.addEventListener('click', applyDmHunterFilters);
    document.getElementById('dm-clear-filters-btn')?.addEventListener('click', clearDmHunterFilters);

    // Allow pressing Enter in search inputs to apply filters immediately
    ['dm-search-name', 'dm-search-factory', 'dm-search-system', 'dm-factory-from', 'dm-factory-to', 'dm-price-min', 'dm-price-max', 'dm-filter-stock-qty'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') applyDmHunterFilters();
        });
    });

    // Table selection controls
    document.getElementById('dm-select-all-cb')?.addEventListener('change', (e) => {
        if (e.target.checked) {
            dmFilteredModels.forEach(m => dmSelectedIds.add(m.id));
        } else {
            dmSelectedIds.clear();
        }
        renderDmModelsTable();
    });

    document.getElementById('dm-select-all-filtered-btn')?.addEventListener('click', () => {
        dmFilteredModels.forEach(m => dmSelectedIds.add(m.id));
        renderDmModelsTable();
    });

    document.getElementById('dm-deselect-all-btn')?.addEventListener('click', () => {
        dmSelectedIds.clear();
        renderDmModelsTable();
    });

    // Model operations
    document.getElementById('dm-open-zero-modal-btn')?.addEventListener('click', openZeroSettlementModal);
    document.getElementById('dm-open-delete-models-btn')?.addEventListener('click', openDeleteModelsModal);

    // Invoice & Order operations
    document.getElementById('dm-delete-orders-btn')?.addEventListener('click', openDeleteOrdersModal);
    document.getElementById('dm-delete-inbound-btn')?.addEventListener('click', openDeleteInboundModal);
    document.getElementById('dm-delete-visitors-btn')?.addEventListener('click', openDeleteVisitorsModal);

    // Notifications operations
    document.getElementById('dm-notif-scope')?.addEventListener('change', (e) => {
        document.getElementById('dm-notif-date-wrap')?.classList.toggle('hidden', e.target.value !== 'before_date');
    });
    document.getElementById('dm-delete-notifs-btn')?.addEventListener('click', openDeleteNotificationsModal);

    // Modal close
    document.getElementById('dm-modal-close')?.addEventListener('click', closeDmModal);
    document.getElementById('dm-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('dm-modal-overlay')) closeDmModal();
    });
}

function switchDmTab(tabName) {
    activeDmTab = tabName;
    const panels = ['models', 'invoices', 'notifications'];
    panels.forEach(p => {
        document.getElementById(`dm-panel-${p}`)?.classList.toggle('hidden', p !== tabName);
        const btn = document.getElementById(`dm-tab-btn-${p}`);
        if (btn) {
            const active = p === tabName;
            btn.setAttribute('aria-selected', String(active));
            btn.className = active
                ? 'dm-tab-btn px-3.5 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 bg-devo-orange text-white'
                : 'dm-tab-btn px-3.5 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 text-devo-muted hover:text-devo-text';
        }
    });

    if (tabName === 'invoices' || tabName === 'notifications') {
        fetchDmLiveCounts();
    }
}

// =========================================================================
// 🔍 MODEL HUNTER DATA FETCHING & FILTERING
// =========================================================================
async function fetchDmFilterOptions() {
    try {
        const [cats, clss, colors, sizes] = await Promise.all([
            supabase.from('categories').select('id, name').order('name'),
            supabase.from('classes').select('id, name').order('name'),
            supabase.from('colors').select('id, name').order('name'),
            supabase.from('sizes').select('id, name').order('name')
        ]);

        const populate = (key, rows) => {
            const container = document.getElementById(`dm-dd-${key}-options`);
            if (!container || !rows) return;
            container.innerHTML = rows.map(item => `
                <label class="flex items-center gap-2 px-2 py-1.5 hover:bg-devo-black/50 rounded cursor-pointer text-xs text-devo-text select-none">
                    <input type="checkbox" value="${escapeHtml(item.id)}" name="dm-filter-${key}" class="accent-devo-orange w-3.5 h-3.5 rounded cursor-pointer">
                    <span class="truncate">${escapeHtml(item.name)}</span>
                </label>
            `).join('');

            container.querySelectorAll(`input[name="dm-filter-${key}"]`).forEach(cb => {
                cb.addEventListener('change', () => updateDmMultiSelectLabel(key));
            });
            updateDmMultiSelectLabel(key);
        };

        populate('cat', cats.data || []);
        populate('class', clss.data || []);
        populate('color', colors.data || []);
        populate('size', sizes.data || []);
    } catch (err) {
        console.error('[DataManagement] Filter options fetch error:', err);
    }
}

function updateDmMultiSelectLabel(key) {
    const checkboxes = document.querySelectorAll(`input[name="dm-filter-${key}"]:checked`);
    const exclude = document.getElementById(`dm-dd-${key}-exclude`)?.checked || false;
    const labelEl = document.getElementById(`dm-dd-${key}-label`);
    if (!labelEl) return;

    const defaults = {
        cat: 'جميع التصنيفات',
        class: 'جميع الفئات',
        color: 'جميع الألوان',
        size: 'جميع المقاسات'
    };

    const count = checkboxes.length;
    if (count === 0) {
        labelEl.textContent = exclude ? 'استثناء: لا شيء (الكل)' : defaults[key];
        labelEl.classList.remove('text-devo-orange');
    } else {
        const names = Array.from(checkboxes).map(cb => cb.nextElementSibling?.textContent?.trim() || '');
        if (exclude) {
            labelEl.textContent = count <= 2 ? `استثناء: ${names.join('، ')}` : `الكل عدا ${count}`;
        } else {
            labelEl.textContent = count <= 2 ? names.join('، ') : `${count} محددة`;
        }
        labelEl.classList.add('text-devo-orange');
    }
}

async function fetchDmModels() {
    const tbody = document.getElementById('dm-models-tbody');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-devo-muted text-xs"><i class="ph ph-spinner animate-spin text-2xl text-devo-orange align-middle ml-2"></i>جاري تحميل الموديلات...</td></tr>`;
    }

    const allFetched = [];
    let from = 0;
    const step = 999;
    let hasMore = true;

    try {
        while (hasMore) {
            const { data, error } = await supabase
                .from('models')
                .select(`
                    id, name, factory_code, system_code, price, is_active, category_id, class_id, created_at,
                    categories(name),
                    classes(name, class_sizes(size_id)),
                    model_sizes(size_id),
                    model_inventory(id, color_id, available_series, colors(name))
                `)
                .order('created_at', { ascending: false })
                .range(from, from + step);

            if (error) throw error;
            if (data && data.length > 0) {
                allFetched.push(...data);
                from += step + 1;
            }
            if (!data || data.length <= step) {
                hasMore = false;
            }
        }

        dmAllModels = allFetched;
        applyDmHunterFilters();
    } catch (err) {
        console.error('[DataManagement] Fetch models error:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-devo-error text-xs">تعذر تحميل الموديلات: ${escapeHtml(err.message)}</td></tr>`;
        }
    }
}

function getHunterCriteriaFromDOM() {
    return {
        nameTerm: document.getElementById('dm-search-name')?.value || '',
        factoryTerm: document.getElementById('dm-search-factory')?.value || '',
        systemTerm: document.getElementById('dm-search-system')?.value || '',
        factoryFrom: document.getElementById('dm-factory-from')?.value || '',
        factoryTo: document.getElementById('dm-factory-to')?.value || '',
        selectedCats: Array.from(document.querySelectorAll('input[name="dm-filter-cat"]:checked')).map(cb => cb.value),
        isCatExclude: document.getElementById('dm-dd-cat-exclude')?.checked || false,
        selectedClasses: Array.from(document.querySelectorAll('input[name="dm-filter-class"]:checked')).map(cb => cb.value),
        isClassExclude: document.getElementById('dm-dd-class-exclude')?.checked || false,
        selectedColors: Array.from(document.querySelectorAll('input[name="dm-filter-color"]:checked')).map(cb => cb.value),
        isColorExclude: document.getElementById('dm-dd-color-exclude')?.checked || false,
        selectedSizes: Array.from(document.querySelectorAll('input[name="dm-filter-size"]:checked')).map(cb => cb.value),
        isSizeExclude: document.getElementById('dm-dd-size-exclude')?.checked || false,
        status: document.getElementById('dm-filter-status')?.value || '',
        stockOp: document.getElementById('dm-filter-stock-op')?.value || '',
        stockQty: document.getElementById('dm-filter-stock-qty')?.value || '',
        minPrice: document.getElementById('dm-price-min')?.value || '',
        maxPrice: document.getElementById('dm-price-max')?.value || '',
        dateFrom: document.getElementById('dm-date-from')?.value || '',
        dateTo: document.getElementById('dm-date-to')?.value || ''
    };
}

function applyDmHunterFilters() {
    const criteria = getHunterCriteriaFromDOM();
    dmFilteredModels = filterModelsByHunter(dmAllModels, criteria);

    // Keep only still-matching selections; if none selected yet and filters narrow results, don't force surprise delete
    const validIds = new Set(dmFilteredModels.map(m => m.id));
    dmSelectedIds = new Set(Array.from(dmSelectedIds).filter(id => validIds.has(id)));
    dmCurrentPage = 1;
    renderDmModelsTable();
}

function clearDmHunterFilters() {
    [
        'dm-search-name', 'dm-search-factory', 'dm-search-system',
        'dm-factory-from', 'dm-factory-to', 'dm-filter-status',
        'dm-filter-stock-op', 'dm-filter-stock-qty',
        'dm-price-min', 'dm-price-max', 'dm-date-from', 'dm-date-to'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    document.getElementById('dm-filter-stock-qty')?.classList.add('hidden');

    ['cat', 'class', 'color', 'size'].forEach(key => {
        document.querySelectorAll(`input[name="dm-filter-${key}"]`).forEach(cb => { cb.checked = false; });
        const ex = document.getElementById(`dm-dd-${key}-exclude`);
        if (ex) ex.checked = false;
        updateDmMultiSelectLabel(key);
    });

    applyDmHunterFilters();
}

function getSelectedDmModels() {
    return dmFilteredModels.filter(m => dmSelectedIds.has(m.id));
}

function renderDmModelsTable() {
    const tbody = document.getElementById('dm-models-tbody');
    const paginationEl = document.getElementById('dm-pagination');
    const masterCb = document.getElementById('dm-select-all-cb');

    const selectedModels = getSelectedDmModels();
    const totalSelectedSeries = selectedModels.reduce((sum, m) =>
        sum + (m.model_inventory || []).reduce((s, inv) => s + (Number(inv.available_series) || 0), 0), 0
    );

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
    setEl('dm-results-count', dmFilteredModels.length);
    setEl('dm-selected-count', dmSelectedIds.size);
    setEl('dm-selected-series', totalSelectedSeries);
    setEl('dm-actionbar-count', dmSelectedIds.size);

    const zeroBtn = document.getElementById('dm-open-zero-modal-btn');
    const delBtn = document.getElementById('dm-open-delete-models-btn');
    if (zeroBtn) zeroBtn.disabled = dmSelectedIds.size === 0;
    if (delBtn) delBtn.disabled = dmSelectedIds.size === 0;

    if (dmFilteredModels.length === 0) {
        if (masterCb) { masterCb.checked = false; masterCb.disabled = true; }
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-devo-muted text-xs">لا توجد موديلات مطابقة للفلاتر الحالية</td></tr>`;
        }
        if (paginationEl) paginationEl.innerHTML = `<span>0 نتيجة</span><span></span>`;
        return;
    }

    if (masterCb) {
        masterCb.disabled = false;
        masterCb.checked = dmSelectedIds.size > 0 && dmSelectedIds.size === dmFilteredModels.length;
    }

    const totalPages = Math.max(1, Math.ceil(dmFilteredModels.length / DM_ITEMS_PER_PAGE));
    if (dmCurrentPage > totalPages) dmCurrentPage = totalPages;
    const startIdx = (dmCurrentPage - 1) * DM_ITEMS_PER_PAGE;
    const pageRows = dmFilteredModels.slice(startIdx, startIdx + DM_ITEMS_PER_PAGE);

    if (tbody) {
        tbody.innerHTML = pageRows.map(m => {
            const invList = m.model_inventory || [];
            const totalQty = invList.reduce((sum, inv) => sum + (Number(inv.available_series) || 0), 0);
            const colorsPreview = invList.slice(0, 3).map(inv =>
                `${escapeHtml(inv.colors?.name || 'لون')} (${inv.available_series || 0})`
            ).join(' · ');
            const extraColors = invList.length > 3 ? ` +${invList.length - 3}` : '';
            const checked = dmSelectedIds.has(m.id) ? 'checked' : '';

            return `
                <tr class="hover:bg-devo-black/50 transition-colors">
                    <td class="p-3 text-center border-l border-devo-gray/30">
                        <input type="checkbox" data-dm-row-id="${escapeHtml(m.id)}" class="dm-row-cb accent-devo-orange w-4 h-4 cursor-pointer" ${checked}>
                    </td>
                    <td class="p-3">
                        <p class="font-bold text-devo-text text-xs sm:text-sm">${escapeHtml(m.name)}</p>
                        <p class="text-[11px] text-devo-muted font-mono tabular-nums mt-0.5">${escapeHtml(m.factory_code || '-')} / ${escapeHtml(m.system_code || '-')}</p>
                    </td>
                    <td class="p-3 text-center text-xs text-devo-muted">
                        ${escapeHtml(m.categories?.name || '-')} · ${escapeHtml(m.classes?.name || '-')}
                    </td>
                    <td class="p-3 text-center text-xs text-devo-muted max-w-[260px] truncate" title="${escapeHtml(invList.map(i => `${i.colors?.name || ''}: ${i.available_series}`).join(' | '))}">
                        ${colorsPreview || 'بدون ألوان'}${extraColors}
                    </td>
                    <td class="p-3 text-center font-mono tabular-nums text-xs sm:text-sm font-bold ${totalQty === 0 ? 'text-devo-error' : 'text-devo-success'}">
                        ${totalQty} سيري
                    </td>
                    <td class="p-3 text-center text-xs ${m.is_active ? 'text-devo-success' : 'text-devo-muted'}">
                        ${m.is_active ? 'نشط' : 'معطل'}
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.dm-row-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.dmRowId;
                if (cb.checked) dmSelectedIds.add(id);
                else dmSelectedIds.delete(id);
                renderDmModelsTable();
            });
        });
    }

    if (paginationEl) {
        paginationEl.innerHTML = `
            <span>عرض <span class="font-mono tabular-nums text-devo-text">${startIdx + 1}–${Math.min(startIdx + DM_ITEMS_PER_PAGE, dmFilteredModels.length)}</span> من <span class="font-mono tabular-nums text-devo-text">${dmFilteredModels.length}</span></span>
            <div class="flex items-center gap-2">
                <button type="button" id="dm-page-prev" ${dmCurrentPage <= 1 ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg bg-devo-dark border border-devo-gray text-devo-text disabled:opacity-40">السابق</button>
                <span class="font-mono tabular-nums">${dmCurrentPage} / ${totalPages}</span>
                <button type="button" id="dm-page-next" ${dmCurrentPage >= totalPages ? 'disabled' : ''} class="px-2.5 py-1 rounded-lg bg-devo-dark border border-devo-gray text-devo-text disabled:opacity-40">التالي</button>
            </div>
        `;
        document.getElementById('dm-page-prev')?.addEventListener('click', () => { dmCurrentPage--; renderDmModelsTable(); });
        document.getElementById('dm-page-next')?.addEventListener('click', () => { dmCurrentPage++; renderDmModelsTable(); });
    }
}

// =========================================================================
// ⚖️ OPERATION 1: ZERO / SETTLE MODEL STOCK (WITH BASE STOCK PRESERVATION)
// =========================================================================
function openZeroSettlementModal() {
    const selectedModels = getSelectedDmModels();
    if (selectedModels.length === 0) {
        showToast('حدد موديلاً واحداً على الأقل من صياد الموديلات أولاً', 'warning');
        return;
    }

    const activeColorIds = Array.from(document.querySelectorAll('input[name="dm-filter-color"]:checked')).map(cb => cb.value);
    const hasColorFilter = activeColorIds.length > 0 && !(document.getElementById('dm-dd-color-exclude')?.checked);

    const bodyHtml = `
        <div class="space-y-4">
            <div class="bg-devo-black border border-devo-gray rounded-xl p-3.5 text-xs text-devo-muted leading-relaxed">
                <p class="text-devo-text font-bold mb-1">كيف يتم الحفاظ على «الرصيد الأساسي (الأصل)»؟</p>
                <p>سيتم ضبط الرصيد المتبقي على القيمة المختارة وتسجيل الفرق تلقائياً كحركة تسوية مستقلة في دفتر المخزون، فيظهر في كارت الموديل المتبقي بصفر (أو القيمة الجديدة) بينما يظل <strong>الأصل</strong> صحيحاً تماماً ولا تتأثر تقارير المبيعات.</p>
            </div>

            <div class="space-y-2">
                <label class="block text-xs font-bold text-devo-text">نوع التسوية</label>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label class="flex items-center gap-2.5 p-3 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer">
                        <input type="radio" name="dm-settle-type" value="zero" checked class="accent-devo-orange w-4 h-4">
                        <span class="text-xs font-bold text-devo-text">تصفير كامل للرصيد المتبقي (0)</span>
                    </label>
                    <label class="flex items-center gap-2.5 p-3 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer">
                        <input type="radio" name="dm-settle-type" value="custom" class="accent-devo-orange w-4 h-4">
                        <span class="text-xs font-bold text-devo-text">تسوية لرصيد متبقي محدد</span>
                    </label>
                </div>
                <div id="dm-settle-target-wrap" class="hidden pt-1">
                    <label for="dm-settle-target-qty" class="block text-xs text-devo-muted mb-1">الرصيد المتبقي الجديد لكل لون (سيري)</label>
                    <input type="number" id="dm-settle-target-qty" min="0" value="0" class="w-full bg-devo-black border border-devo-gray focus:border-devo-orange rounded-lg px-3 py-2 text-sm text-devo-text font-mono tabular-nums outline-none">
                </div>
            </div>

            ${hasColorFilter ? `
                <div class="space-y-2">
                    <label class="block text-xs font-bold text-devo-text">نطاق الألوان</label>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <label class="flex items-center gap-2.5 p-3 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer">
                            <input type="radio" name="dm-settle-color-scope" value="all" checked class="accent-devo-orange w-4 h-4">
                            <span class="text-xs text-devo-text">كل ألوان الموديلات المحددة</span>
                        </label>
                        <label class="flex items-center gap-2.5 p-3 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer">
                            <input type="radio" name="dm-settle-color-scope" value="filtered" class="accent-devo-orange w-4 h-4">
                            <span class="text-xs text-devo-text">الألوان المفلترة بالصياد فقط (${activeColorIds.length})</span>
                        </label>
                    </div>
                </div>
            ` : ''}

            <div>
                <label for="dm-settle-reason" class="block text-xs text-devo-muted mb-1">سبب التسوية (اختياري — للتوثيق الداخلي)</label>
                <input type="text" id="dm-settle-reason" placeholder="مثال: تسوية بواقي تصنيع / جرد نهاية موسم..." maxlength="120" class="w-full bg-devo-black border border-devo-gray focus:border-devo-orange rounded-lg px-3 py-2 text-sm text-devo-text outline-none">
            </div>

            <div id="dm-settle-preview-box" class="bg-devo-black border border-devo-gray rounded-xl p-3.5 grid grid-cols-3 gap-2 text-center"></div>
            <div id="dm-settle-progress" class="hidden space-y-1.5">
                <div class="h-2 bg-devo-black rounded-full overflow-hidden border border-devo-gray">
                    <div id="dm-settle-progress-bar" class="h-full bg-devo-orange transition-all duration-200" style="width:0%"></div>
                </div>
                <p id="dm-settle-progress-text" class="text-xs text-devo-muted text-center"></p>
            </div>
        </div>
    `;

    openDmModal({
        title: `<i class="ph ph-arrows-counter-clockwise text-devo-orange text-lg"></i><span>تصفير / تسوية رصيد الموديلات</span>`,
        bodyHtml,
        footerHtml: `
            <button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted hover:text-devo-text">إلغاء</button>
            <button type="button" id="dm-modal-confirm-settle" class="px-5 py-2 rounded-xl bg-devo-orange hover:bg-devo-orangeHover text-white text-xs font-bold flex items-center gap-1.5">
                <i class="ph ph-check-circle text-base"></i>
                <span>تنفيذ التسوية الآن</span>
            </button>
        `
    });

    const getCurrentPlan = () => {
        const settleType = document.querySelector('input[name="dm-settle-type"]:checked')?.value || 'zero';
        const targetQty = settleType === 'zero' ? 0 : Math.max(0, parseInt(document.getElementById('dm-settle-target-qty')?.value || '0', 10) || 0);
        const colorScope = document.querySelector('input[name="dm-settle-color-scope"]:checked')?.value || 'all';
        const reason = document.getElementById('dm-settle-reason')?.value || '';
        return buildSettlementPlan(selectedModels, {
            targetQty,
            onlyDecrease: settleType === 'zero',
            onlyColorIds: colorScope === 'filtered' ? activeColorIds : null,
            reason
        });
    };

    const updatePreview = () => {
        const plan = getCurrentPlan();
        const box = document.getElementById('dm-settle-preview-box');
        if (box) {
            box.innerHTML = `
                <div>
                    <p class="text-[11px] text-devo-muted">الموديلات المتأثرة</p>
                    <p class="text-lg font-black text-devo-text font-mono tabular-nums">${plan.summary.modelsAffected}</p>
                </div>
                <div>
                    <p class="text-[11px] text-devo-muted">سطور الألوان</p>
                    <p class="text-lg font-black text-devo-text font-mono tabular-nums">${plan.summary.colorRowsAffected}</p>
                </div>
                <div>
                    <p class="text-[11px] text-devo-muted">سيريهات للتسوية</p>
                    <p class="text-lg font-black text-devo-orange font-mono tabular-nums">${plan.summary.totalSeriesSettled}</p>
                </div>
            `;
        }
        const btn = document.getElementById('dm-modal-confirm-settle');
        if (btn) btn.disabled = plan.updates.length === 0;
    };

    document.querySelectorAll('input[name="dm-settle-type"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('dm-settle-target-wrap')?.classList.toggle('hidden', r.value !== 'custom' || !r.checked);
            updatePreview();
        });
    });
    document.querySelectorAll('input[name="dm-settle-color-scope"]').forEach(r => r.addEventListener('change', updatePreview));
    document.getElementById('dm-settle-target-qty')?.addEventListener('input', updatePreview);

    updatePreview();

    document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);
    document.getElementById('dm-modal-confirm-settle')?.addEventListener('click', async () => {
        const plan = getCurrentPlan();
        if (plan.updates.length === 0) {
            showToast('لا توجد أرصدة تحتاج تعديلاً ضمن الموديلات المحددة', 'info');
            return;
        }

        const confirmBtn = document.getElementById('dm-modal-confirm-settle');
        const progressWrap = document.getElementById('dm-settle-progress');
        const progressBar = document.getElementById('dm-settle-progress-bar');
        const progressText = document.getElementById('dm-settle-progress-text');

        confirmBtn.disabled = true;
        progressWrap?.classList.remove('hidden');

        try {
            const CHUNK = 100;
            // 1. Insert [SETTLEMENT] movements first so Base Stock ledger is preserved atomically
            for (let i = 0; i < plan.movements.length; i += CHUNK) {
                const chunk = plan.movements.slice(i, i + CHUNK);
                const { error: movErr } = await supabase.from('stock_movements').insert(chunk);
                if (movErr) throw movErr;
                const pct = Math.round(((i + chunk.length) / (plan.movements.length + plan.updates.length)) * 100);
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (progressText) progressText.textContent = `جاري توثيق حركات التسوية لحفظ الأصل (${pct}%)...`;
            }

            // 2. Update model_inventory available_series in safe chunks
            for (let i = 0; i < plan.updates.length; i += CHUNK) {
                const chunk = plan.updates.slice(i, i + CHUNK).map(u => ({
                    id: u.id,
                    model_id: u.model_id,
                    color_id: u.color_id,
                    available_series: u.new_series
                }));
                const { error: invErr } = await supabase
                    .from('model_inventory')
                    .upsert(chunk, { onConflict: 'model_id,color_id' });
                if (invErr) throw invErr;

                const pct = Math.round(((plan.movements.length + i + chunk.length) / (plan.movements.length + plan.updates.length)) * 100);
                if (progressBar) progressBar.style.width = `${pct}%`;
                if (progressText) progressText.textContent = `جاري تحديث أرصدة الموديلات (${pct}%)...`;
            }

            closeDmModal();
            showToast(`تمت تسوية ${plan.summary.totalSeriesSettled} سيري لـ ${plan.summary.modelsAffected} موديل مع حفظ الأصل بنجاح`, 'success');
            await fetchDmModels();
            if (typeof window.refreshAllSystemData === 'function') {
                await window.refreshAllSystemData({ silent: true });
            }
        } catch (err) {
            console.error('[DataManagement] Settlement execution error:', err);
            showToast(`فشلت عملية التسوية: ${err.message}`, 'error');
            confirmBtn.disabled = false;
        }
    });
}

// =========================================================================
// 🗑️ OPERATION 2: DELETE SELECTED MODELS (POWERED BY MODEL HUNTER)
// =========================================================================
async function openDeleteModelsModal() {
    const selectedModels = getSelectedDmModels();
    if (selectedModels.length === 0) {
        showToast('حدد موديلاً واحداً على الأقل من صياد الموديلات أولاً', 'warning');
        return;
    }

    openDmModal({
        title: `<i class="ph ph-trash text-devo-error text-lg"></i><span>فحص وحذف الموديلات المحددة</span>`,
        bodyHtml: `
            <div class="py-8 flex flex-col items-center gap-3 text-center">
                <i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i>
                <p class="text-xs text-devo-muted">جاري فحص ارتباط ${selectedModels.length} موديل بفواتير المبيعات والدخل...</p>
            </div>
        `,
        footerHtml: `<button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>`
    });
    document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);

    const ids = selectedModels.map(m => m.id);
    const linkedSet = await checkModelsInInvoices(ids);
    const unlinkedIds = ids.filter(id => !linkedSet.has(id));
    const linkedIds = ids.filter(id => linkedSet.has(id));

    const bodyEl = document.getElementById('dm-modal-body');
    const footerEl = document.getElementById('dm-modal-footer');
    if (!bodyEl || !footerEl) return;

    bodyEl.innerHTML = `
        <div class="space-y-4">
            <div class="grid grid-cols-3 gap-2 text-center bg-devo-black border border-devo-gray rounded-xl p-3.5">
                <div>
                    <p class="text-[11px] text-devo-muted">إجمالي المحدد</p>
                    <p class="text-lg font-black text-devo-text font-mono tabular-nums">${ids.length}</p>
                </div>
                <div>
                    <p class="text-[11px] text-devo-muted">غير مرتبط بفواتير</p>
                    <p class="text-lg font-black text-devo-success font-mono tabular-nums">${unlinkedIds.length}</p>
                </div>
                <div>
                    <p class="text-[11px] text-devo-muted">مرتبط بفواتير</p>
                    <p class="text-lg font-black text-devo-warning font-mono tabular-nums">${linkedIds.length}</p>
                </div>
            </div>

            ${linkedIds.length > 0 ? `
                <div class="space-y-2">
                    <label class="block text-xs font-bold text-devo-text">كيف تريد التعامل مع الموديلات المرتبطة بفواتير؟</label>
                    <label class="flex items-start gap-2.5 p-3 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-orange cursor-pointer">
                        <input type="radio" name="dm-del-models-mode" value="unlinked_only" ${unlinkedIds.length > 0 ? 'checked' : ''} ${unlinkedIds.length === 0 ? 'disabled' : ''} class="mt-0.5 accent-devo-orange w-4 h-4">
                        <div class="text-xs">
                            <span class="block font-bold text-devo-text">حذف غير المرتبطة بفواتير فقط (${unlinkedIds.length} موديل)</span>
                            <span class="text-devo-muted">يتخطى الموديلات الموجودة داخل فواتير سابقة بأمان.</span>
                        </div>
                    </label>
                    <label class="flex items-start gap-2.5 p-3 rounded-xl bg-devo-black border border-devo-gray has-[:checked]:border-devo-error cursor-pointer">
                        <input type="radio" name="dm-del-models-mode" value="force_all" ${unlinkedIds.length === 0 ? 'checked' : ''} class="mt-0.5 accent-devo-error w-4 h-4">
                        <div class="text-xs">
                            <span class="block font-bold text-devo-error">حذف جميع الموديلات المحددة نهائياً (${ids.length} موديل)</span>
                            <span class="text-devo-muted">يحذف الموديل وصوره ومخزونه مع الإبقاء على القيم المالية للفواتير التاريخية.</span>
                        </div>
                    </label>
                </div>
            ` : `
                <p class="text-xs text-devo-muted bg-devo-black border border-devo-gray rounded-xl p-3">جميع الموديلات المحددة (${ids.length}) غير مرتبطة بأي فواتير ويمكن حذفها نهائياً بأمان.</p>
            `}

            <div class="bg-devo-error/10 border border-devo-error/30 rounded-xl p-3 text-xs text-devo-error">
                تحذير: الحذف نهائي ولا يمكن التراجع عنه بعد التنفيذ.
            </div>

            <div id="dm-del-models-progress" class="hidden space-y-1.5">
                <div class="h-2 bg-devo-black rounded-full overflow-hidden border border-devo-gray">
                    <div id="dm-del-models-bar" class="h-full bg-devo-error transition-all duration-200" style="width:0%"></div>
                </div>
                <p id="dm-del-models-text" class="text-xs text-devo-muted text-center"></p>
            </div>
        </div>
    `;

    footerEl.innerHTML = `
        <button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted hover:text-devo-text">إلغاء</button>
        <button type="button" id="dm-modal-exec-del-models" class="px-5 py-2 rounded-xl bg-devo-error hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5">
            <i class="ph ph-trash text-base"></i>
            <span>تأكيد الحذف النهائي</span>
        </button>
    `;

    document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);
    document.getElementById('dm-modal-exec-del-models')?.addEventListener('click', async () => {
        const mode = document.querySelector('input[name="dm-del-models-mode"]:checked')?.value || 'force_all';
        const targetIds = (linkedIds.length > 0 && mode === 'unlinked_only') ? unlinkedIds : ids;

        if (targetIds.length === 0) {
            showToast('لا توجد موديلات للحذف بالاختيار الحالي', 'info');
            return;
        }

        const btn = document.getElementById('dm-modal-exec-del-models');
        const pWrap = document.getElementById('dm-del-models-progress');
        const pBar = document.getElementById('dm-del-models-bar');
        const pText = document.getElementById('dm-del-models-text');
        btn.disabled = true;
        pWrap?.classList.remove('hidden');

        try {
            const CHUNK = 50;
            let deletedCount = 0;
            for (let i = 0; i < targetIds.length; i += CHUNK) {
                const chunk = targetIds.slice(i, i + CHUNK);
                const { error } = await supabase.from('models').delete().in('id', chunk);
                if (error) throw error;
                deletedCount += chunk.length;
                const pct = Math.round((deletedCount / targetIds.length) * 100);
                if (pBar) pBar.style.width = `${pct}%`;
                if (pText) pText.textContent = `جاري حذف الموديلات (${deletedCount} من ${targetIds.length})...`;
            }

            dmSelectedIds.clear();
            closeDmModal();
            showToast(`تم حذف ${deletedCount} موديل بنجاح`, 'success');
            await fetchDmModels();
            if (typeof window.refreshAllSystemData === 'function') {
                await window.refreshAllSystemData({ silent: true });
            }
        } catch (err) {
            console.error('[DataManagement] Delete models error:', err);
            showToast(`تعذر حذف بعض الموديلات: ${err.message}`, 'error');
            btn.disabled = false;
        }
    });
}

// =========================================================================
// 🧾 OPERATION 3: INVOICES, ORDERS & NOTIFICATIONS LIVE COUNTS + DELETION
// =========================================================================
async function fetchDmLiveCounts() {
    try {
        const [
            ordersAll, ordersActive, ordersArchived,
            inboundAll,
            visitorsAll, visitorsPending,
            notifAll, notifUnread, notifRead, notifArchived
        ] = await Promise.all([
            supabase.from('orders').select('id', { count: 'exact', head: true }),
            supabase.from('orders').select('id', { count: 'exact', head: true }).eq('is_archived', false),
            supabase.from('orders').select('id', { count: 'exact', head: true }).eq('is_archived', true),
            supabase.from('inbound_invoices').select('id', { count: 'exact', head: true }),
            supabase.from('visitor_orders').select('id', { count: 'exact', head: true }),
            supabase.from('visitor_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('system_notifications').select('id', { count: 'exact', head: true }),
            supabase.from('system_notifications').select('id', { count: 'exact', head: true }).eq('is_read', false),
            supabase.from('system_notifications').select('id', { count: 'exact', head: true }).eq('is_read', true),
            supabase.from('system_notifications').select('id', { count: 'exact', head: true }).eq('is_archived', true)
        ]);

        dmCounts = {
            ordersTotal: ordersAll.count || 0,
            ordersActive: ordersActive.count || 0,
            ordersArchived: ordersArchived.count || 0,
            inboundTotal: inboundAll.count || 0,
            visitorTotal: visitorsAll.count || 0,
            visitorPending: visitorsPending.count || 0,
            notifTotal: notifAll.count || 0,
            notifUnread: notifUnread.count || 0,
            notifRead: notifRead.count || 0,
            notifArchived: notifArchived.count || 0
        };

        const setCount = (id, n) => {
            const el = document.getElementById(id);
            if (el) el.textContent = Number(n || 0).toLocaleString('en-US');
        };
        setCount('dm-stat-orders', dmCounts.ordersTotal);
        setCount('dm-stat-orders-active', dmCounts.ordersActive);
        setCount('dm-stat-orders-archived', dmCounts.ordersArchived);
        setCount('dm-stat-inbound', dmCounts.inboundTotal);
        setCount('dm-stat-visitors', dmCounts.visitorTotal);
        setCount('dm-stat-visitors-pending', dmCounts.visitorPending);
        setCount('dm-stat-notif-total', dmCounts.notifTotal);
        setCount('dm-stat-notif-unread', dmCounts.notifUnread);
        setCount('dm-stat-notif-read', dmCounts.notifRead);
        setCount('dm-stat-notif-archived', dmCounts.notifArchived);
    } catch (err) {
        console.warn('[DataManagement] Live counts error:', err);
    }
}

function buildDateBoundaries(fromStr, toStr) {
    const startIso = fromStr ? new Date(`${fromStr}T00:00:00.000Z`).toISOString() : null;
    const endIso = toStr ? new Date(`${toStr}T23:59:59.999Z`).toISOString() : null;
    return { startIso, endIso };
}

async function openDeleteOrdersModal() {
    const scope = document.getElementById('dm-orders-scope')?.value || 'all';
    const dateFrom = document.getElementById('dm-orders-date-from')?.value || '';
    const dateTo = document.getElementById('dm-orders-date-to')?.value || '';
    const stockMode = document.querySelector('input[name="dm-orders-stock-mode"]:checked')?.value || 'keep';
    const preserveBase = document.getElementById('dm-orders-preserve-base')?.checked !== false;

    const { startIso, endIso } = buildDateBoundaries(dateFrom, dateTo);

    openDmModal({
        title: `<i class="ph ph-receipt text-devo-error text-lg"></i><span>معاينة حذف فواتير المبيعات</span>`,
        bodyHtml: `<div class="py-8 flex flex-col items-center gap-3"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i><p class="text-xs text-devo-muted">جاري حصر الفواتير والكميات المطابقة...</p></div>`,
        footerHtml: `<button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>`
    });
    document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);

    try {
        let query = supabase.from('orders').select('id, invoice_number, order_items(model_id, color_id, quantity)');
        if (scope === 'active') query = query.eq('is_archived', false);
        else if (scope === 'archived') query = query.eq('is_archived', true);
        if (startIso) query = query.gte('created_at', startIso);
        if (endIso) query = query.lte('created_at', endIso);

        const { data: matchedOrders, error } = await query;
        if (error) throw error;

        const orders = matchedOrders || [];
        const allItems = orders.flatMap(o => o.order_items || []);
        const totalSeries = allItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

        const bodyEl = document.getElementById('dm-modal-body');
        const footerEl = document.getElementById('dm-modal-footer');
        if (!bodyEl || !footerEl) return;

        if (orders.length === 0) {
            bodyEl.innerHTML = `<p class="text-center py-6 text-sm text-devo-muted">لا توجد فواتير مبيعات مطابقة للفلاتر المحددة.</p>`;
            return;
        }

        const stockSummaryText = stockMode === 'restore'
            ? `سيتم استرجاع <strong>${totalSeries}</strong> سيري إلى رصيد المخزون المتاح قبل حذف الفواتير.`
            : preserveBase
                ? `سيبقى الرصيد المتاح كما هو، وسيتم ترحيل <strong>${totalSeries}</strong> سيري إلى دفتر التسويات ليظل «الأصل» صحيحاً في كارت الموديل.`
                : `سيبقى الرصيد المتاح كما هو ولن يتم حفظ كميات هذه الفواتير ضمن الأصل.`;

        bodyEl.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-3 text-center bg-devo-black border border-devo-gray rounded-xl p-4">
                    <div>
                        <p class="text-xs text-devo-muted">عدد الفواتير للحذف</p>
                        <p class="text-2xl font-black text-devo-error font-mono tabular-nums">${orders.length}</p>
                    </div>
                    <div>
                        <p class="text-xs text-devo-muted">إجمالي السيريهات بداخلها</p>
                        <p class="text-2xl font-black text-devo-text font-mono tabular-nums">${totalSeries}</p>
                    </div>
                </div>
                <div class="bg-devo-black border border-devo-gray rounded-xl p-3.5 text-xs text-devo-muted leading-relaxed">
                    ${stockSummaryText}
                </div>
                <div class="bg-devo-error/10 border border-devo-error/30 rounded-xl p-3 text-xs text-devo-error">
                    تحذير: حذف الفواتير نهائي ولا يمكن استعادته إلا من نسخة احتياطية.
                </div>
            </div>
        `;

        footerEl.innerHTML = `
            <button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>
            <button type="button" id="dm-exec-del-orders" class="px-5 py-2 rounded-xl bg-devo-error hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5">
                <i class="ph ph-trash text-base"></i>
                <span>حذف ${orders.length} فاتورة الآن</span>
            </button>
        `;

        document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);
        document.getElementById('dm-exec-del-orders')?.addEventListener('click', async () => {
            const btn = document.getElementById('dm-exec-del-orders');
            btn.disabled = true;
            btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i><span>جاري التنفيذ...</span>`;

            try {
                if (stockMode === 'restore') {
                    const deltas = buildOrderRestoreStockDeltas(allItems);
                    await applyRestoreStockDeltas(deltas, 'استرجاع رصيد عند حذف فواتير مبيعات (إدارة البيانات)');
                } else if (preserveBase && allItems.length > 0) {
                    const archiveEntries = buildOrderArchiveSettlementEntries(allItems);
                    for (let i = 0; i < archiveEntries.length; i += 100) {
                        const { error: mErr } = await supabase.from('stock_movements').insert(archiveEntries.slice(i, i + 100));
                        if (mErr) throw mErr;
                    }
                }

                // Delete matched orders in chunks (cascades order_items, order_logs, preparation, order-linked stock_movements)
                const orderIds = orders.map(o => o.id);
                for (let i = 0; i < orderIds.length; i += 80) {
                    const { error: dErr } = await supabase.from('orders').delete().in('id', orderIds.slice(i, i + 80));
                    if (dErr) throw dErr;
                }

                // Also clean legacy invoices table if scope === 'all' and no date filter
                if (scope === 'all' && !startIso && !endIso) {
                    await supabase.from('invoices').delete().neq('id', '00000000-0000-0000-0000-000000000000');
                }

                closeDmModal();
                showToast(`تم حذف ${orders.length} فاتورة مبيعات بنجاح`, 'success');
                await Promise.all([fetchDmLiveCounts(), fetchDmModels()]);
                if (typeof window.refreshAllSystemData === 'function') {
                    await window.refreshAllSystemData({ silent: true });
                }
            } catch (err) {
                console.error('[DataManagement] Delete orders error:', err);
                showToast(`فشل حذف الفواتير: ${err.message}`, 'error');
                btn.disabled = false;
                btn.innerHTML = `<i class="ph ph-trash text-base"></i><span>إعادة المحاولة</span>`;
            }
        });
    } catch (err) {
        closeDmModal();
        showToast(`تعذر حصر فواتير المبيعات: ${err.message}`, 'error');
    }
}

async function applyRestoreStockDeltas(deltas, movementReference) {
    if (!deltas.length) return;
    const modelIds = Array.from(new Set(deltas.map(d => d.model_id)));
    const { data: invRows, error: invFetchErr } = await supabase
        .from('model_inventory')
        .select('id, model_id, color_id, available_series')
        .in('model_id', modelIds);
    if (invFetchErr) throw invFetchErr;

    const invMap = new Map();
    (invRows || []).forEach(r => invMap.set(`${r.model_id}::${r.color_id}`, r));

    const upserts = [];
    const movements = [];
    for (const d of deltas) {
        const key = `${d.model_id}::${d.color_id}`;
        const existing = invMap.get(key);
        const currentQty = existing ? (Number(existing.available_series) || 0) : 0;
        upserts.push({
            ...(existing?.id ? { id: existing.id } : {}),
            model_id: d.model_id,
            color_id: d.color_id,
            available_series: currentQty + d.restoreQty
        });
        movements.push({
            model_id: d.model_id,
            color_id: d.color_id,
            movement_type: 'in',
            quantity: d.restoreQty,
            reference: movementReference,
            order_id: null,
            inbound_id: null
        });
    }

    for (let i = 0; i < upserts.length; i += 100) {
        const { error } = await supabase.from('model_inventory').upsert(upserts.slice(i, i + 100), { onConflict: 'model_id,color_id' });
        if (error) throw error;
    }
    for (let i = 0; i < movements.length; i += 100) {
        const { error } = await supabase.from('stock_movements').insert(movements.slice(i, i + 100));
        if (error) throw error;
    }
}

async function openDeleteInboundModal() {
    const dateFrom = document.getElementById('dm-inbound-date-from')?.value || '';
    const dateTo = document.getElementById('dm-inbound-date-to')?.value || '';
    const stockMode = document.querySelector('input[name="dm-inbound-stock-mode"]:checked')?.value || 'keep';
    const { startIso, endIso } = buildDateBoundaries(dateFrom, dateTo);

    openDmModal({
        title: `<i class="ph ph-truck text-devo-error text-lg"></i><span>معاينة حذف فواتير الدخل</span>`,
        bodyHtml: `<div class="py-8 flex flex-col items-center gap-3"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i><p class="text-xs text-devo-muted">جاري حصر فواتير الدخل المطابقة...</p></div>`,
        footerHtml: `<button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>`
    });
    document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);

    try {
        let query = supabase.from('inbound_invoices').select('id, invoice_number, inbound_invoice_items(model_id, color_id, quantity)');
        if (startIso) query = query.gte('created_at', startIso);
        if (endIso) query = query.lte('created_at', endIso);

        const { data: matched, error } = await query;
        if (error) throw error;

        const invoices = matched || [];
        const allItems = invoices.flatMap(inv => inv.inbound_invoice_items || []);
        const totalSeries = allItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

        const bodyEl = document.getElementById('dm-modal-body');
        const footerEl = document.getElementById('dm-modal-footer');
        if (!bodyEl || !footerEl) return;

        if (invoices.length === 0) {
            bodyEl.innerHTML = `<p class="text-center py-6 text-sm text-devo-muted">لا توجد فواتير دخل مطابقة للنطاق المحدد.</p>`;
            return;
        }

        bodyEl.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-3 text-center bg-devo-black border border-devo-gray rounded-xl p-4">
                    <div>
                        <p class="text-xs text-devo-muted">فواتير الدخل للحذف</p>
                        <p class="text-2xl font-black text-devo-error font-mono tabular-nums">${invoices.length}</p>
                    </div>
                    <div>
                        <p class="text-xs text-devo-muted">إجمالي السيريهات الواردة</p>
                        <p class="text-2xl font-black text-devo-text font-mono tabular-nums">${totalSeries}</p>
                    </div>
                </div>
                <p class="text-xs text-devo-muted bg-devo-black border border-devo-gray rounded-xl p-3">
                    ${stockMode === 'deduct'
                        ? `سيتم خصم كميات هذه الفواتير من رصيد المخزون الحالي لكل موديل ولون (بحد أدنى 0).`
                        : `سيتم حذف سجل فواتير الدخل فقط مع إبقاء أرصدة المخزون الحالية كما هي.`}
                </p>
            </div>
        `;

        footerEl.innerHTML = `
            <button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>
            <button type="button" id="dm-exec-del-inbound" class="px-5 py-2 rounded-xl bg-devo-error hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5">
                <i class="ph ph-trash text-base"></i>
                <span>حذف ${invoices.length} فاتورة دخل</span>
            </button>
        `;

        document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);
        document.getElementById('dm-exec-del-inbound')?.addEventListener('click', async () => {
            const btn = document.getElementById('dm-exec-del-inbound');
            btn.disabled = true;
            btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i><span>جاري الحذف...</span>`;

            try {
                if (stockMode === 'deduct' && allItems.length > 0) {
                    const modelIds = Array.from(new Set(allItems.map(i => i.model_id).filter(Boolean)));
                    const { data: invRows, error: invErr } = await supabase
                        .from('model_inventory')
                        .select('id, model_id, color_id, available_series')
                        .in('model_id', modelIds);
                    if (invErr) throw invErr;

                    const curMap = new Map();
                    const rowIdMap = new Map();
                    (invRows || []).forEach(r => {
                        const k = `${r.model_id}::${r.color_id}`;
                        curMap.set(k, r.available_series);
                        rowIdMap.set(k, r.id);
                    });

                    const deltas = buildInboundDeductStockDeltas(allItems, curMap);
                    const upserts = deltas
                        .filter(d => rowIdMap.has(`${d.model_id}::${d.color_id}`))
                        .map(d => ({
                            id: rowIdMap.get(`${d.model_id}::${d.color_id}`),
                            model_id: d.model_id,
                            color_id: d.color_id,
                            available_series: d.newQty
                        }));

                    for (let i = 0; i < upserts.length; i += 100) {
                        const { error: uErr } = await supabase.from('model_inventory').upsert(upserts.slice(i, i + 100), { onConflict: 'model_id,color_id' });
                        if (uErr) throw uErr;
                    }
                }

                const invIds = invoices.map(i => i.id);
                for (let i = 0; i < invIds.length; i += 80) {
                    const { error: dErr } = await supabase.from('inbound_invoices').delete().in('id', invIds.slice(i, i + 80));
                    if (dErr) throw dErr;
                }

                closeDmModal();
                showToast(`تم حذف ${invoices.length} فاتورة دخل بنجاح`, 'success');
                await Promise.all([fetchDmLiveCounts(), fetchDmModels()]);
                if (typeof window.refreshAllSystemData === 'function') {
                    await window.refreshAllSystemData({ silent: true });
                }
            } catch (err) {
                console.error('[DataManagement] Delete inbound error:', err);
                showToast(`فشل حذف فواتير الدخل: ${err.message}`, 'error');
                btn.disabled = false;
                btn.innerHTML = `<i class="ph ph-trash text-base"></i><span>إعادة المحاولة</span>`;
            }
        });
    } catch (err) {
        closeDmModal();
        showToast(`تعذر حصر فواتير الدخل: ${err.message}`, 'error');
    }
}

async function openDeleteVisitorsModal() {
    const status = document.getElementById('dm-visitors-status')?.value || 'all';
    const dateFrom = document.getElementById('dm-visitors-date-from')?.value || '';
    const dateTo = document.getElementById('dm-visitors-date-to')?.value || '';
    const { startIso, endIso } = buildDateBoundaries(dateFrom, dateTo);

    openDmModal({
        title: `<i class="ph ph-clock text-devo-error text-lg"></i><span>معاينة حذف طلبات الزوار</span>`,
        bodyHtml: `<div class="py-8 flex flex-col items-center gap-3"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i><p class="text-xs text-devo-muted">جاري حصر طلبات الزوار...</p></div>`,
        footerHtml: `<button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>`
    });
    document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);

    try {
        let query = supabase.from('visitor_orders').select('id');
        if (status !== 'all') query = query.eq('status', status);
        if (startIso) query = query.gte('created_at', startIso);
        if (endIso) query = query.lte('created_at', endIso);

        const { data: rows, error } = await query;
        if (error) throw error;

        const ids = (rows || []).map(r => r.id);
        const bodyEl = document.getElementById('dm-modal-body');
        const footerEl = document.getElementById('dm-modal-footer');
        if (!bodyEl || !footerEl) return;

        if (ids.length === 0) {
            bodyEl.innerHTML = `<p class="text-center py-6 text-sm text-devo-muted">لا توجد طلبات زوار مطابقة للنطاق المحدد.</p>`;
            return;
        }

        bodyEl.innerHTML = `
            <div class="space-y-3 text-center">
                <div class="bg-devo-black border border-devo-gray rounded-xl p-4">
                    <p class="text-xs text-devo-muted">عدد طلبات الزوار التي سيتم حذفها</p>
                    <p class="text-3xl font-black text-devo-error font-mono tabular-nums mt-1">${ids.length}</p>
                </div>
                <p class="text-xs text-devo-muted">هذه العملية لا تؤثر على أرصدة المخزون.</p>
            </div>
        `;

        footerEl.innerHTML = `
            <button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>
            <button type="button" id="dm-exec-del-visitors" class="px-5 py-2 rounded-xl bg-devo-error hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5">
                <i class="ph ph-trash text-base"></i>
                <span>حذف ${ids.length} طلب زائر</span>
            </button>
        `;

        document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);
        document.getElementById('dm-exec-del-visitors')?.addEventListener('click', async () => {
            const btn = document.getElementById('dm-exec-del-visitors');
            btn.disabled = true;
            btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i><span>جاري الحذف...</span>`;
            try {
                for (let i = 0; i < ids.length; i += 80) {
                    const chunk = ids.slice(i, i + 80);
                    await supabase.from('visitor_order_items').delete().in('visitor_order_id', chunk);
                    const { error: dErr } = await supabase.from('visitor_orders').delete().in('id', chunk);
                    if (dErr) throw dErr;
                }
                closeDmModal();
                showToast(`تم حذف ${ids.length} طلب زائر بنجاح`, 'success');
                await fetchDmLiveCounts();
                if (typeof window.refreshAllSystemData === 'function') {
                    await window.refreshAllSystemData({ silent: true });
                }
            } catch (err) {
                showToast(`فشل حذف طلبات الزوار: ${err.message}`, 'error');
                btn.disabled = false;
                btn.innerHTML = `<i class="ph ph-trash text-base"></i><span>إعادة المحاولة</span>`;
            }
        });
    } catch (err) {
        closeDmModal();
        showToast(`تعذر حصر طلبات الزوار: ${err.message}`, 'error');
    }
}

async function openDeleteNotificationsModal() {
    const scope = document.getElementById('dm-notif-scope')?.value || 'all';
    const beforeDate = document.getElementById('dm-notif-before-date')?.value || '';

    if (scope === 'before_date' && !beforeDate) {
        showToast('يرجى تحديد التاريخ أولاً', 'warning');
        return;
    }

    openDmModal({
        title: `<i class="ph ph-bell-slash text-devo-error text-lg"></i><span>معاينة حذف الإشعارات</span>`,
        bodyHtml: `<div class="py-8 flex flex-col items-center gap-3"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i><p class="text-xs text-devo-muted">جاري حصر الإشعارات...</p></div>`,
        footerHtml: `<button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>`
    });
    document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);

    try {
        let countQuery = supabase.from('system_notifications').select('id', { count: 'exact', head: true });
        if (scope === 'read') countQuery = countQuery.eq('is_read', true);
        if (scope === 'before_date') countQuery = countQuery.lt('created_at', new Date(`${beforeDate}T00:00:00.000Z`).toISOString());

        const { count, error } = await countQuery;
        if (error) throw error;

        const targetCount = count || 0;
        const bodyEl = document.getElementById('dm-modal-body');
        const footerEl = document.getElementById('dm-modal-footer');
        if (!bodyEl || !footerEl) return;

        if (targetCount === 0) {
            bodyEl.innerHTML = `<p class="text-center py-6 text-sm text-devo-muted">لا توجد إشعارات مطابقة للنطاق المحدد.</p>`;
            return;
        }

        bodyEl.innerHTML = `
            <div class="space-y-3 text-center">
                <div class="bg-devo-black border border-devo-gray rounded-xl p-4">
                    <p class="text-xs text-devo-muted">عدد الإشعارات التي سيتم مسحها نهائياً</p>
                    <p class="text-3xl font-black text-devo-error font-mono tabular-nums mt-1">${targetCount}</p>
                </div>
                <p class="text-xs text-devo-muted">سيتم مسح هذه الإشعارات من قاعدة البيانات وتحديث شارة الجرس فوراً.</p>
            </div>
        `;

        footerEl.innerHTML = `
            <button type="button" id="dm-modal-cancel-btn" class="px-4 py-2 rounded-xl border border-devo-gray text-xs font-bold text-devo-muted">إلغاء</button>
            <button type="button" id="dm-exec-del-notifs" class="px-5 py-2 rounded-xl bg-devo-error hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5">
                <i class="ph ph-trash text-base"></i>
                <span>حذف ${targetCount} إشعار</span>
            </button>
        `;

        document.getElementById('dm-modal-cancel-btn')?.addEventListener('click', closeDmModal);
        document.getElementById('dm-exec-del-notifs')?.addEventListener('click', async () => {
            const btn = document.getElementById('dm-exec-del-notifs');
            btn.disabled = true;
            btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i><span>جاري المسح...</span>`;

            try {
                let delQuery = supabase.from('system_notifications').delete();
                if (scope === 'read') {
                    delQuery = delQuery.eq('is_read', true);
                } else if (scope === 'before_date') {
                    delQuery = delQuery.lt('created_at', new Date(`${beforeDate}T00:00:00.000Z`).toISOString());
                } else {
                    delQuery = delQuery.neq('id', '00000000-0000-0000-0000-000000000000');
                }
                const { error: dErr } = await delQuery;
                if (dErr) throw dErr;

                closeDmModal();
                showToast(`تم حذف ${targetCount} إشعار بنجاح`, 'success');
                await fetchDmLiveCounts();

                // Sync top-bar notifications badge
                const badge = document.getElementById('notifications-badge');
                if (badge && scope === 'all') {
                    badge.textContent = '0';
                    badge.classList.add('hidden');
                }
            } catch (err) {
                showToast(`فشل حذف الإشعارات: ${err.message}`, 'error');
                btn.disabled = false;
                btn.innerHTML = `<i class="ph ph-trash text-base"></i><span>إعادة المحاولة</span>`;
            }
        });
    } catch (err) {
        closeDmModal();
        showToast(`تعذر حصر الإشعارات: ${err.message}`, 'error');
    }
}

// =========================================================================
// 🪟 MODAL HELPERS
// =========================================================================
function openDmModal({ title, bodyHtml, footerHtml }) {
    const overlay = document.getElementById('dm-modal-overlay');
    const titleEl = document.getElementById('dm-modal-title');
    const bodyEl = document.getElementById('dm-modal-body');
    const footerEl = document.getElementById('dm-modal-footer');
    if (!overlay) return;

    if (titleEl) titleEl.innerHTML = title || '';
    if (bodyEl) bodyEl.innerHTML = bodyHtml || '';
    if (footerEl) footerEl.innerHTML = footerHtml || '';

    overlay.classList.remove('hidden');
    overlay.classList.add('flex');
}

function closeDmModal() {
    const overlay = document.getElementById('dm-modal-overlay');
    if (!overlay) return;
    overlay.classList.add('hidden');
    overlay.classList.remove('flex');
}
