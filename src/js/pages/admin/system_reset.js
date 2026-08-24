import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { requireAuth } from '../../services/auth.js';

// ============================================================
// 🔐 كلمة المرور الخاصة بعملية إعادة التهيئة
// ============================================================
const RESET_SECRET_PASSWORD = 'DEVO@RESET#2025';
const CONFIRM_PHRASE = 'أوافق على مسح كل البيانات';

let isInitialized = false;
let currentStage = 0;

// ============================================================
// 🎯 تهيئة الواجهة
// ============================================================
export function initSystemResetView() {
    const user = requireAuth(['owner']);
    if (!user || user.role !== 'owner') {
        showToast('⛔ هذه الصفحة مخصصة لمالك النظام فقط', 'error');
        return;
    }

    if (isInitialized) return;
    isInitialized = true;

    renderResetView();
    attachResetEvents();
}

// ============================================================
// 🎨 رسم محتوى الواجهة — مطابق لنمط باقي الصفحات
// ============================================================
function renderResetView() {
    const container = document.getElementById('reset-view-content');
    if (!container) return;

    const deletedItems = [
        'الأوردرات وعناصرها',
        'الفواتير وعناصرها',
        'الموديلات وصورها',
        'المخزون وحركاته',
        'الفئات والتصنيفات',
        'الألوان والمقاسات',
        'بطاقات الترويج',
        'الإشعارات',
    ];

    const savedItems = [
        'بيانات المستخدمين',
        'صلاحيات الحسابات',
        'إعدادات الواجهة (home_settings)',
        'مظاهر النظام (Themes)',
    ];

    container.innerHTML = `
        <div class="animate-fade-in relative pb-10 space-y-4 max-w-4xl mx-auto">

            <!-- تحذير رئيسي -->
            <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 flex items-start gap-3">
                <i class="ph ph-seal-warning text-xl text-devo-error shrink-0 mt-0.5"></i>
                <div>
                    <p class="text-devo-error font-bold text-sm mb-1">تحذير: هذه العملية لا يمكن التراجع عنها</p>
                    <p class="text-devo-muted text-xs leading-relaxed">سيتم حذف جميع بيانات الموقع نهائياً وبشكل دائم. لا يمكن استعادة أي بيانات بعد تنفيذ هذه العملية.</p>
                </div>
            </div>

            <!-- بطاقات المحذوف والمحفوظ -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

                <!-- البيانات التي ستُحذف -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-3">
                    <p class="text-xs font-bold text-devo-error flex items-center gap-2 pb-2 border-b border-devo-gray">
                        <i class="ph ph-trash text-base"></i> البيانات التي ستُحذف
                    </p>
                    <div class="space-y-2">
                        ${deletedItems.map(item => `
                            <div class="flex items-center gap-2 text-xs text-devo-muted">
                                <i class="ph ph-x-circle text-devo-error shrink-0"></i>
                                <span>${item}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- البيانات المحفوظة -->
                <div class="bg-devo-dark border border-devo-gray rounded-xl p-4 space-y-3">
                    <p class="text-xs font-bold text-devo-success flex items-center gap-2 pb-2 border-b border-devo-gray">
                        <i class="ph ph-shield-check text-base"></i> البيانات المحفوظة
                    </p>
                    <div class="space-y-2">
                        ${savedItems.map(item => `
                            <div class="flex items-center gap-2 text-xs text-devo-muted">
                                <i class="ph ph-check-circle text-devo-success shrink-0"></i>
                                <span>${item}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <!-- زر البدء -->
            <div class="bg-devo-dark border border-devo-gray rounded-xl p-6 flex flex-col items-center gap-4 text-center">
                <div class="w-16 h-16 rounded-full bg-devo-error/10 border border-devo-error/30 flex items-center justify-center">
                    <i class="ph ph-warning-octagon text-3xl text-devo-error"></i>
                </div>
                <div>
                    <p class="text-white font-bold text-base mb-1">جاهز لإعادة التهيئة؟</p>
                    <p class="text-devo-muted text-xs">ستمر بـ 3 مراحل تأكيد قبل تنفيذ أي عملية حذف</p>
                </div>
                <button
                    id="btn-start-reset"
                    class="flex items-center gap-2 px-6 py-3 bg-devo-error/15 hover:bg-devo-error/25 border border-devo-error/40 hover:border-devo-error/60 rounded-xl text-devo-error font-bold text-sm transition-all duration-200 active:scale-95"
                >
                    <i class="ph ph-warning text-base"></i>
                    بدء عملية إعادة التهيئة
                    <i class="ph ph-arrow-left text-sm"></i>
                </button>
            </div>

        </div>

        <!-- ===== MODAL التأكيد الثلاثي ===== -->
        <div id="reset-modal-overlay" class="fixed inset-0 z-[9999] items-center justify-center bg-black/80 backdrop-blur-sm" style="display:none">
            <div class="w-full max-w-md mx-4 bg-devo-dark border border-devo-gray rounded-2xl shadow-2xl overflow-hidden">

                <!-- شريط التقدم -->
                <div class="h-1 bg-devo-gray">
                    <div id="reset-progress-bar" class="h-full bg-devo-error transition-all duration-500" style="width: 0%"></div>
                </div>

                <!-- رأس الـ Modal -->
                <div class="flex items-center justify-between p-5 border-b border-devo-gray">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-xl bg-devo-error/15 flex items-center justify-center">
                            <i class="ph ph-warning-octagon text-xl text-devo-error"></i>
                        </div>
                        <div>
                            <p class="text-sm font-bold text-white" id="modal-stage-title">تأكيد العملية</p>
                            <p class="text-xs text-devo-muted" id="modal-stage-counter">المرحلة 1 من 3</p>
                        </div>
                    </div>
                    <button id="btn-close-reset-modal" class="w-8 h-8 rounded-lg bg-devo-gray hover:bg-devo-gray-hover flex items-center justify-center text-devo-muted hover:text-white transition-colors">
                        <i class="ph ph-x text-sm"></i>
                    </button>
                </div>

                <!-- محتوى المراحل -->
                <div class="p-5">

                    <!-- المرحلة 1 -->
                    <div id="stage-1" class="space-y-4">
                        <p class="text-white font-bold text-base text-center">هل أنت متأكد تماماً؟</p>
                        <p class="text-devo-muted text-sm text-center leading-relaxed">
                            ستقوم بحذف جميع بيانات الموقع بشكل نهائي.<br>هذا يشمل الأوردرات والموديلات والمخزون والمزيد.
                        </p>
                        <div class="bg-devo-error/10 border border-devo-error/20 rounded-xl p-3 flex items-center gap-3">
                            <i class="ph ph-info text-devo-error text-lg shrink-0"></i>
                            <p class="text-xs text-devo-muted">بمجرد تأكيدك ستنتقل للمرحلة التالية. العملية تحتاج 3 تأكيدات.</p>
                        </div>
                        <div class="flex gap-3 pt-2">
                            <button id="btn-stage1-cancel" class="flex-1 py-3 rounded-xl border border-devo-gray text-devo-muted hover:bg-devo-gray hover:text-white transition-colors text-sm font-medium">
                                إلغاء
                            </button>
                            <button id="btn-stage1-confirm" class="flex-1 py-3 rounded-xl bg-devo-error/20 hover:bg-devo-error/30 border border-devo-error/40 text-devo-error transition-colors text-sm font-bold">
                                نعم، أنا موافق — أكمل
                            </button>
                        </div>
                    </div>

                    <!-- المرحلة 2: كلمة المرور -->
                    <div id="stage-2" class="space-y-4 hidden">
                        <p class="text-white font-bold text-base text-center">أدخل كلمة مرور إعادة التهيئة</p>
                        <p class="text-devo-muted text-sm text-center leading-relaxed">
                            كلمة المرور هذه مخصصة لهذه العملية فقط وتختلف عن كلمة مرور حسابك.
                        </p>
                        <div class="relative">
                            <input
                                type="password"
                                id="reset-password-input"
                                placeholder="أدخل كلمة مرور إعادة التهيئة"
                                class="w-full bg-devo-black border border-devo-gray focus:border-devo-error/70 rounded-xl px-4 py-3 text-sm text-white placeholder-devo-muted outline-none transition-colors"
                                autocomplete="off"
                            >
                            <button type="button" id="toggle-reset-password" class="absolute left-3 top-1/2 -translate-y-1/2 text-devo-muted hover:text-white transition-colors">
                                <i class="ph ph-eye text-lg" id="toggle-reset-password-icon"></i>
                            </button>
                        </div>
                        <div id="password-error" class="hidden text-xs text-devo-error items-center gap-1.5">
                            <i class="ph ph-x-circle shrink-0"></i>
                            <span>كلمة المرور غير صحيحة، حاول مرة أخرى.</span>
                        </div>
                        <div class="flex gap-3 pt-2">
                            <button id="btn-stage2-back" class="flex-1 py-3 rounded-xl border border-devo-gray text-devo-muted hover:bg-devo-gray hover:text-white transition-colors text-sm font-medium">
                                رجوع
                            </button>
                            <button id="btn-stage2-confirm" class="flex-1 py-3 rounded-xl bg-devo-error/20 hover:bg-devo-error/30 border border-devo-error/40 text-devo-error transition-colors text-sm font-bold">
                                تحقق من كلمة المرور
                            </button>
                        </div>
                    </div>

                    <!-- المرحلة 3: جملة التأكيد -->
                    <div id="stage-3" class="space-y-4 hidden">
                        <p class="text-white font-bold text-base text-center">التأكيد النهائي</p>
                        <p class="text-devo-muted text-sm text-center leading-relaxed">
                            لإتمام العملية، اكتب الجملة التالية بالضبط في المربع أدناه:
                        </p>
                        <div class="bg-devo-black border border-devo-gray rounded-xl p-3 text-center">
                            <p class="text-devo-error font-mono text-sm font-bold select-none" id="confirm-phrase-display"></p>
                        </div>
                        <input
                            type="text"
                            id="confirm-phrase-input"
                            placeholder="اكتب الجملة هنا..."
                            class="w-full bg-devo-black border border-devo-gray focus:border-devo-error/70 rounded-xl px-4 py-3 text-sm text-white placeholder-devo-muted outline-none transition-colors"
                            autocomplete="off"
                            autocorrect="off"
                            autocapitalize="off"
                            spellcheck="false"
                        >
                        <div id="phrase-error" class="hidden text-xs text-devo-error items-center gap-1.5">
                            <i class="ph ph-x-circle shrink-0"></i>
                            <span>الجملة غير مطابقة، يرجى الكتابة بشكل دقيق.</span>
                        </div>
                        <div class="flex gap-3 pt-2">
                            <button id="btn-stage3-back" class="flex-1 py-3 rounded-xl border border-devo-gray text-devo-muted hover:bg-devo-gray hover:text-white transition-colors text-sm font-medium">
                                رجوع
                            </button>
                            <button id="btn-stage3-execute" class="flex-1 py-3 rounded-xl bg-devo-error hover:bg-red-700 border border-red-700 text-white transition-colors text-sm font-bold flex items-center justify-center gap-2">
                                <i class="ph ph-trash text-base"></i>
                                تنفيذ الحذف النهائي
                            </button>
                        </div>
                    </div>

                    <!-- مرحلة التحميل -->
                    <div id="stage-loading" class="hidden py-8 flex-col items-center gap-4 text-center">
                        <div class="w-16 h-16 rounded-full border-4 border-devo-gray border-t-devo-error animate-spin"></div>
                        <p class="text-white font-bold text-base">جاري تنفيذ العملية...</p>
                        <p class="text-devo-muted text-sm">يرجى الانتظار، لا تغلق الصفحة</p>
                    </div>

                    <!-- مرحلة النجاح -->
                    <div id="stage-success" class="hidden py-6 flex-col items-center gap-4 text-center">
                        <div class="w-20 h-20 rounded-full bg-devo-success/10 border-2 border-devo-success/30 flex items-center justify-center">
                            <i class="ph ph-check-circle text-5xl text-devo-success"></i>
                        </div>
                        <p class="text-white font-bold text-lg">تمت إعادة التهيئة بنجاح! ✅</p>
                        <p class="text-devo-muted text-sm leading-relaxed">تم مسح جميع بيانات الموقع. النظام الآن جاهز للبداية من جديد.</p>
                        <button id="btn-close-after-success" class="mt-2 px-6 py-3 rounded-xl bg-devo-orange hover:bg-devo-orange-hover text-white font-bold text-sm transition-colors">
                            إغلاق
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const displayEl = document.getElementById('confirm-phrase-display');
    if (displayEl) displayEl.textContent = CONFIRM_PHRASE;
}

// ============================================================
// 🎮 ربط الأحداث
// ============================================================
function attachResetEvents() {
    document.getElementById('btn-start-reset')?.addEventListener('click', () => openModal(1));
    document.getElementById('btn-close-reset-modal')?.addEventListener('click', closeModal);

    document.getElementById('reset-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('reset-modal-overlay')) closeModal();
    });

    // المرحلة 1
    document.getElementById('btn-stage1-cancel')?.addEventListener('click', closeModal);
    document.getElementById('btn-stage1-confirm')?.addEventListener('click', () => goToStage(2));

    // المرحلة 2
    document.getElementById('btn-stage2-back')?.addEventListener('click', () => goToStage(1));
    document.getElementById('btn-stage2-confirm')?.addEventListener('click', verifyPassword);
    document.getElementById('reset-password-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') verifyPassword();
        document.getElementById('password-error')?.classList.add('hidden');
    });

    // إظهار/إخفاء كلمة المرور
    document.getElementById('toggle-reset-password')?.addEventListener('click', () => {
        const input = document.getElementById('reset-password-input');
        const icon = document.getElementById('toggle-reset-password-icon');
        if (!input || !icon) return;
        if (input.type === 'password') {
            input.type = 'text';
            icon.className = 'ph ph-eye-slash text-lg';
        } else {
            input.type = 'password';
            icon.className = 'ph ph-eye text-lg';
        }
    });

    // المرحلة 3
    document.getElementById('btn-stage3-back')?.addEventListener('click', () => goToStage(2));
    document.getElementById('btn-stage3-execute')?.addEventListener('click', executeReset);
    document.getElementById('confirm-phrase-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') executeReset();
        document.getElementById('phrase-error')?.classList.add('hidden');
    });

    // إغلاق بعد النجاح
    document.getElementById('btn-close-after-success')?.addEventListener('click', () => {
        closeModal();
        window.location.reload();
    });
}

// ============================================================
// 🔀 إدارة المراحل
// ============================================================
function openModal(stage) {
    const overlay = document.getElementById('reset-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    goToStage(stage);
}

function closeModal() {
    const overlay = document.getElementById('reset-modal-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';

    const passInput = document.getElementById('reset-password-input');
    const phraseInput = document.getElementById('confirm-phrase-input');
    if (passInput) { passInput.value = ''; passInput.type = 'password'; }
    if (phraseInput) phraseInput.value = '';
    document.getElementById('password-error')?.classList.add('hidden');
    document.getElementById('phrase-error')?.classList.add('hidden');
    currentStage = 0;
}

function hideAllStages() {
    ['stage-1', 'stage-2', 'stage-3', 'stage-loading', 'stage-success'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.classList.add('hidden');
            el.style.display = 'none';
        }
    });
}

function goToStage(stageNum) {
    currentStage = stageNum;

    hideAllStages();

    const target = document.getElementById('stage-' + stageNum);
    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'block';
    }

    const stageLabels = {
        1: { title: 'تأكيد العملية', counter: 'المرحلة 1 من 3', progress: 33 },
        2: { title: 'كلمة المرور الخاصة', counter: 'المرحلة 2 من 3', progress: 66 },
        3: { title: 'التأكيد النهائي', counter: 'المرحلة 3 من 3', progress: 100 },
    };

    const info = stageLabels[stageNum];
    if (info) {
        const titleEl = document.getElementById('modal-stage-title');
        const counterEl = document.getElementById('modal-stage-counter');
        const progressBar = document.getElementById('reset-progress-bar');
        if (titleEl) titleEl.textContent = info.title;
        if (counterEl) counterEl.textContent = info.counter;
        if (progressBar) progressBar.style.width = `${info.progress}%`;
    }

    if (stageNum === 2) setTimeout(() => document.getElementById('reset-password-input')?.focus(), 100);
    else if (stageNum === 3) setTimeout(() => document.getElementById('confirm-phrase-input')?.focus(), 100);
}

// ============================================================
// 🔑 التحقق من كلمة المرور
// ============================================================
function verifyPassword() {
    const inputEl = document.getElementById('reset-password-input');
    const errorEl = document.getElementById('password-error');
    if (!inputEl || !errorEl) return;

    if (inputEl.value.trim() === RESET_SECRET_PASSWORD) {
        errorEl.classList.add('hidden');
        goToStage(3);
    } else {
        errorEl.classList.remove('hidden');
        inputEl.value = '';
        inputEl.focus();
    }
}

// ============================================================
// 🗑️ تنفيذ عملية الحذف
// ============================================================
async function executeReset() {
    const phraseInput = document.getElementById('confirm-phrase-input');
    const errorEl = document.getElementById('phrase-error');
    if (!phraseInput || !errorEl) return;

    if (phraseInput.value.trim() !== CONFIRM_PHRASE) {
        errorEl.classList.remove('hidden');
        phraseInput.focus();
        return;
    }

    // إظهار شاشة التحميل فقط
    hideAllStages();
    const loadingEl = document.getElementById('stage-loading');
    if (loadingEl) {
        loadingEl.classList.remove('hidden');
        loadingEl.style.display = 'flex';
        loadingEl.style.flexDirection = 'column';
        loadingEl.style.alignItems = 'center';
    }
    document.getElementById('btn-close-reset-modal')?.classList.add('opacity-0', 'pointer-events-none');

    try {
        const { error } = await supabase.rpc('reset_system_data');
        if (error) throw new Error(error.message);

        // إظهار شاشة النجاح فقط
        hideAllStages();
        const successEl = document.getElementById('stage-success');
        if (successEl) {
            successEl.classList.remove('hidden');
            successEl.style.display = 'flex';
            successEl.style.flexDirection = 'column';
            successEl.style.alignItems = 'center';
        }
        const progressBar = document.getElementById('reset-progress-bar');
        if (progressBar) {
            progressBar.style.width = '100%';
            progressBar.classList.remove('bg-devo-error');
            progressBar.classList.add('bg-devo-success');
        }
        document.getElementById('btn-close-reset-modal')?.classList.remove('opacity-0', 'pointer-events-none');

    } catch (err) {
        console.error('Reset error:', err);
        hideAllStages();
        const stage3 = document.getElementById('stage-3');
        if (stage3) {
            stage3.classList.remove('hidden');
            stage3.style.display = 'block';
        }
        document.getElementById('btn-close-reset-modal')?.classList.remove('opacity-0', 'pointer-events-none');
        showToast(`فشلت عملية إعادة التهيئة: ${err.message}`, 'error');
    }
}