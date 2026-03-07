import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

/**
 * DEVO Definitions Service (Tabbed Version)
 * Manages Categories, Classes, Sizes, and Colors with Instant Search
 */

// --- State Management ---
let currentTab = 'categories'; // Default active tab
let allData = []; // Local cache for instant search filtering
let isInitialized = false;

/**
 * تهيئة قسم التعريفات وربط المستمعات (Listeners)
 */
export async function initDefinitionsView() {
    if (isInitialized) return;

    // ربط نموذج الإضافة/التعديل (Modal Form)
    const defForm = document.getElementById('def-action-form');
    if (defForm) {
        defForm.addEventListener('submit', handleSaveDefinition);
    }

    // تحميل بيانات التابة الافتراضية
    await loadCurrentTabData();
    
    isInitialized = true;
}

// --- Navigation & Search Logic ---

/**
 * التبديل بين التابات (Categories, Classes, Sizes, Colors)
 */
window.switchDefTab = async (tabId) => {
    currentTab = tabId;
    
    // 1. تحديث شكل الأزرار في الواجهة (UI Tabs)
    document.querySelectorAll('[data-def-tab]').forEach(btn => {
        btn.classList.toggle('active-tab', btn.dataset.defTab === tabId);
    });

    // 2. تصفير خانة البحث عند التبديل
    const searchInput = document.getElementById('def-search-input');
    if (searchInput) searchInput.value = '';
    
    // 3. جلب بيانات الجدول الجديد
    await loadCurrentTabData();
};

/**
 * محرك البحث اللحظي داخل التابة النشطة
 */
window.handleDefSearch = () => {
    const term = document.getElementById('def-search-input').value.toLowerCase().trim();
    
    // تصفية البيانات محلياً دون الحاجة لطلب جديد من الخادم (Performance optimized)
    const filtered = allData.filter(item => 
        item.name.toLowerCase().includes(term)
    );
    
    renderTable(filtered);
};

// --- Data Fetching & Rendering ---

/**
 * جلب البيانات من Supabase للتابة النشطة حالياً
 */
async function loadCurrentTabData() {
    const tableBody = document.getElementById('def-table-body');
    const emptyState = document.getElementById('def-empty-state');
    
    // إظهار حالة التحميل (Loading Spinner)
    tableBody.innerHTML = `<tr><td colspan="4" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i></td></tr>`;
    emptyState.classList.add('hidden');

    const { data, error } = await supabase
        .from(currentTab)
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        showToast(`خطأ في جلب البيانات: ${error.message}`, 'error');
        return;
    }

    allData = data; // تحديث التخزين المحلي للبحث
    renderTable(data);
}

/**
 * رسم الجدول بناءً على البيانات (Rendering Engine)
 */
function renderTable(data) {
    const tableBody = document.getElementById('def-table-body');
    const emptyState = document.getElementById('def-empty-state');

    if (data.length === 0) {
        tableBody.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    tableBody.innerHTML = data.map((item, index) => `
        <tr class="hover:bg-devo-black/50 transition-colors group border-b border-devo-gray/50">
            <td class="p-4 text-center text-devo-muted font-mono text-sm">${index + 1}</td>
            <td class="p-4 font-bold text-devo-text">${item.name}</td>
            <td class="p-4 text-devo-muted text-xs">${new Date(item.created_at).toLocaleDateString('ar-EG')}</td>
            <td class="p-4">
                <div class="flex justify-center gap-2">
                    <button onclick="openDefinitionModal('${currentTab}', '${item.id}', '${item.name}')" 
                        class="w-9 h-9 rounded-lg flex items-center justify-center text-devo-info hover:bg-devo-info/10 transition-all" title="تعديل">
                        <i class="ph ph-pencil-simple text-xl"></i>
                    </button>
                    <button onclick="handleDeleteDefinition('${currentTab}', '${item.id}')" 
                        class="w-9 h-9 rounded-lg flex items-center justify-center text-devo-error hover:bg-devo-error/10 transition-all" title="حذف">
                        <i class="ph ph-trash text-xl"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// --- CRUD Operations ---

/**
 * فتح النافذة المنبثقة للإضافة أو التعديل
 */
window.openDefinitionModal = (table, id = null, name = '') => {
    const modal = document.getElementById('def-action-modal');
    const modalContent = document.getElementById('def-modal-content');
    const titleEl = document.getElementById('def-modal-title');
    const inputName = document.getElementById('def-item-name');
    
    // ضبط السياق
    document.getElementById('def-target-table').value = table;
    document.getElementById('def-item-id').value = id || '';
    inputName.value = name;
    
    titleEl.textContent = id ? `تعديل البيانات` : `إضافة جديد إلى ${getTabNameAr(table)}`;
    
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modalContent.classList.remove('scale-95');
        inputName.focus();
    });
};

/**
 * مساعدة لفتح الموديل من التابة النشطة مباشرة
 */
window.openDefinitionModalFromCurrent = () => {
    window.openDefinitionModal(currentTab);
};

/**
 * إغلاق النافذة المنبثقة
 */
window.closeDefinitionModal = () => {
    const modal = document.getElementById('def-action-modal');
    const modalContent = document.getElementById('def-modal-content');
    
    modal.classList.add('opacity-0');
    modalContent.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
        document.getElementById('def-action-form').reset();
    }, 300);
};

/**
 * معالجة الحفظ (Insert/Update)
 */
async function handleSaveDefinition(e) {
    e.preventDefault();
    
    const table = document.getElementById('def-target-table').value;
    const id = document.getElementById('def-item-id').value;
    const name = document.getElementById('def-item-name').value.trim();
    const btn = document.getElementById('def-save-btn');

    if (!name) return;

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    let result;
    if (id) {
        result = await supabase.from(table).update({ name }).eq('id', id);
    } else {
        result = await supabase.from(table).insert([{ name }]);
    }

    if (result.error) {
        showToast('خطأ: قد يكون هذا الاسم مسجلاً بالفعل', 'error');
    } else {
        showToast(id ? 'تم تحديث البيانات بنجاح' : 'تمت الإضافة بنجاح', 'success');
        closeDefinitionModal();
        await loadCurrentTabData();
    }

    btn.disabled = false;
    btn.innerHTML = `<span>حفظ البيانات</span> <i class="ph ph-check-circle text-lg"></i>`;
}

/**
 * معالجة الحذف مع التحقق الأمني
 */
window.handleDeleteDefinition = async (table, id) => {
    const confirmed = await confirmDialog({
        title: 'تأكيد الحذف النهائي',
        message: 'هل أنت متأكد؟ لا يمكن حذف العناصر المرتبطة بموديلات أو فواتير مسجلة في النظام.',
        isDestructive: true,
        confirmText: 'نعم، احذف'
    });

    if (!confirmed) return;

    const { error } = await supabase.from(table).delete().eq('id', id);

    if (error) {
        // التحقق من قيود المفتاح الأجنبي (Foreign Key Constraint)
        if (error.code === '23503') {
            showToast('لا يمكن الحذف: هذا العنصر مستخدم حالياً في بيانات الموديلات', 'error');
        } else {
            showToast('حدث خطأ غير متوقع أثناء الحذف', 'error');
        }
    } else {
        showToast('تم الحذف بنجاح', 'success');
        await loadCurrentTabData();
    }
};

// --- Helpers ---
function getTabNameAr(tab) {
    const names = {
        categories: 'التصنيفات',
        classes: 'الفئات العمرية',
        sizes: 'المقاسات',
        colors: 'الألوان'
    };
    return names[tab] || '';
}