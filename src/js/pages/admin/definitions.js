import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

let currentTab = 'categories'; 
let allData = []; 
let isInitialized = false;

export async function initDefinitionsView() {
    if (isInitialized) return;

    const defForm = document.getElementById('def-action-form');
    if (defForm) {
        defForm.addEventListener('submit', handleSaveDefinition);
    }

    await loadCurrentTabData();
    isInitialized = true;
}

window.switchDefTab = async (tabId) => {
    currentTab = tabId;
    
    document.querySelectorAll('[data-def-tab]').forEach(btn => {
        btn.classList.toggle('active-tab', btn.dataset.defTab === tabId);
    });

    const searchInput = document.getElementById('def-search-input');
    if (searchInput) searchInput.value = '';
    
    // إظهار/إخفاء زر استيراد الإكسيل للألوان فقط
    const headerActions = document.querySelector('#view-definitions .flex.justify-between.items-center');
    const oldBtn = document.getElementById('btn-import-colors');
    if (oldBtn) oldBtn.remove();

    if (tabId === 'colors' && headerActions) {
        const btnHtml = `<button id="btn-import-colors" onclick="openColorExcelModal()" class="bg-devo-success/10 hover:bg-devo-success text-devo-success hover:text-white px-4 py-2 rounded-lg font-bold transition-all flex items-center gap-2 border border-devo-success/20 ml-2"><i class="ph ph-file-xls text-xl"></i> استيراد (Excel)</button>`;
        headerActions.children[1].insertAdjacentHTML('afterbegin', btnHtml);
    }
    
    await loadCurrentTabData();
};

window.handleDefSearch = () => {
    const term = document.getElementById('def-search-input').value.toLowerCase().trim();
    const filtered = allData.filter(item => 
        item.name.toLowerCase().includes(term) || (item.color_code && String(item.color_code).toLowerCase().includes(term))
    );
    renderTable(filtered);
};

async function loadCurrentTabData() {
    const tableBody = document.getElementById('def-table-body');
    const emptyState = document.getElementById('def-empty-state');
    
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

    allData = data; 
    renderTable(data);
}

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
            <td class="p-4 font-bold text-devo-text">
                ${currentTab === 'colors' && item.color_code ? `<span class="bg-devo-gray text-white px-2 py-0.5 rounded text-[10px] ml-2 font-mono">${item.color_code}</span>` : ''}
                ${item.name}
            </td>
            <td class="p-4 text-devo-muted text-xs">${new Date(item.created_at).toLocaleDateString('ar-EG')}</td>
            <td class="p-4">
                <div class="flex justify-center gap-2">
                    <button onclick="openDefinitionModal('${currentTab}', '${item.id}', '${item.name}', '${item.color_code || ''}')" 
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

window.openDefinitionModal = (table, id = null, name = '', code = '') => {
    const modal = document.getElementById('def-action-modal');
    const modalContent = document.getElementById('def-modal-content');
    const titleEl = document.getElementById('def-modal-title');
    const inputName = document.getElementById('def-item-name');
    const inputCode = document.getElementById('def-item-code');
    const codeWrapper = document.getElementById('def-code-wrapper');
    
    document.getElementById('def-target-table').value = table;
    document.getElementById('def-item-id').value = id || '';
    inputName.value = name;
    
    // إظهار حقل الكود لو التابة ألوان
    if (table === 'colors') {
        codeWrapper.classList.remove('hidden');
        inputCode.value = code;
    } else {
        codeWrapper.classList.add('hidden');
        inputCode.value = '';
    }
    
    titleEl.textContent = id ? `تعديل البيانات` : `إضافة جديد إلى ${getTabNameAr(table)}`;
    
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
        modal.classList.remove('opacity-0');
        modalContent.classList.remove('scale-95');
        inputName.focus();
    });
};

window.openDefinitionModalFromCurrent = () => {
    window.openDefinitionModal(currentTab);
};

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

async function handleSaveDefinition(e) {
    e.preventDefault();
    
    const table = document.getElementById('def-target-table').value;
    const id = document.getElementById('def-item-id').value;
    const name = document.getElementById('def-item-name').value.trim();
    const code = document.getElementById('def-item-code').value.trim();
    const btn = document.getElementById('def-save-btn');

    if (!name) return;

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    let payload = { name };
    if (table === 'colors') {
        payload.color_code = code || null;
    }

    let result;
    if (id) {
        result = await supabase.from(table).update(payload).eq('id', id);
    } else {
        result = await supabase.from(table).insert([payload]);
    }

    if (result.error) {
        showToast('خطأ: قد يكون هذا الاسم أو الكود مسجلاً بالفعل', 'error');
    } else {
        showToast(id ? 'تم تحديث البيانات بنجاح' : 'تمت الإضافة بنجاح', 'success');
        closeDefinitionModal();
        await loadCurrentTabData();
    }

    btn.disabled = false;
    btn.innerHTML = `<span>حفظ البيانات</span> <i class="ph ph-check-circle text-lg"></i>`;
}

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

function getTabNameAr(tab) {
    const names = { categories: 'التصنيفات', classes: 'الفئات العمرية', sizes: 'المقاسات', colors: 'الألوان' };
    return names[tab] || '';
}

// ==========================================
// --- Colors Excel Import Logic ---
// ==========================================

let pendingExcelColors = [];

window.openColorExcelModal = () => {
    document.getElementById('color-excel-step-1').classList.remove('hidden');
    document.getElementById('color-excel-step-2').classList.add('hidden');
    document.getElementById('color-excel-step-2').classList.remove('flex');
    document.getElementById('color-excel-file-input').value = '';
    document.getElementById('color-excel-file-name').textContent = 'اسحب الملف هنا أو اضغط للاختيار';
    pendingExcelColors = [];
    
    const modal = document.getElementById('color-excel-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeColorExcelModal = () => {
    const modal = document.getElementById('color-excel-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

document.getElementById('color-excel-file-input')?.addEventListener('change', function(e) {
    const fileName = e.target.files[0]?.name || 'اسحب الملف هنا أو اضغط للاختيار';
    document.getElementById('color-excel-file-name').textContent = fileName;
});

window.processColorExcelPreview = async () => {
    const fileInput = document.getElementById('color-excel-file-input');
    const file = fileInput.files[0];
    
    if (!file) return showToast('الرجاء اختيار ملف إكسيل أولاً', 'warning');

    const btn = document.getElementById('color-excel-preview-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin text-xl"></i> جاري التحليل...`;

    try {
        const data = await readExcelFile(file);
        if (data.length === 0) throw new Error("الملف فارغ");

        const { data: existingColors } = await supabase.from('colors').select('color_code');
        const existingCodes = new Set(existingColors.map(c => String(c.color_code)));

        const newColors = [];
        const duplicates = [];

        data.forEach(row => {
            // 🌟 1. تنظيف الكود ليدعم (كود) وإزالة الـ .0 الزائدة من الإكسيل 🌟
            let rawCode = String(row['كود اللون'] || row['كود'] || row['Code'] || '').trim();
            if (rawCode.endsWith('.0')) rawCode = rawCode.replace('.0', '');
            const code = rawCode;

            // 🌟 2. دعم كلمة (لون) بدون ألف ولام كما هي في ملفك 🌟
            const name = String(row['اسم اللون'] || row['اللون'] || row['لون'] || row['Name'] || '').trim();

            // تجاهل الصفوف الفارغة حقاً
            if (!code || code === 'undefined' || !name) return;

            if (existingCodes.has(code)) {
                duplicates.push({ code, name });
            } else {
                newColors.push({ color_code: code, name: name });
                existingCodes.add(code); // لمنع التكرار داخل نفس الملف
            }
        });

        pendingExcelColors = newColors;

        document.getElementById('color-excel-new-count').textContent = newColors.length;
        document.getElementById('color-excel-dup-count').textContent = duplicates.length;

        const dupWarning = document.getElementById('color-excel-dup-warning');
        const dupList = document.getElementById('color-excel-dup-list');
        
        if (duplicates.length > 0) {
            dupWarning.classList.remove('hidden');
            dupList.innerHTML = duplicates.map(d => `<div class="p-2 border-b border-devo-error/20 last:border-0"><span class="font-mono text-devo-error ml-2">[${d.code}]</span> <span class="text-white">${d.name}</span></div>`).join('');
        } else {
            dupWarning.classList.add('hidden');
        }

        document.getElementById('color-excel-step-1').classList.add('hidden');
        document.getElementById('color-excel-step-2').classList.remove('hidden');
        document.getElementById('color-excel-step-2').classList.add('flex');

    } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء قراءة الملف، تأكد من صحة الأعمدة (كود اللون، اسم اللون)', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-magnifying-glass text-xl"></i> تحليل ومعاينة الملف`;
    }
};
window.executeColorExcelImport = async () => {
    if (pendingExcelColors.length === 0) {
        showToast('لا توجد ألوان جديدة صالحة للإضافة!', 'warning');
        return;
    }

    const btn = document.getElementById('color-excel-import-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin text-xl"></i> جاري الحفظ...`;

    try {
        const { error } = await supabase.from('colors').insert(pendingExcelColors);
        if (error) throw error;

        showToast(`تم استيراد وحفظ ${pendingExcelColors.length} لون بنجاح!`, 'success');
        closeColorExcelModal();
        
        if (currentTab === 'colors') {
            await loadCurrentTabData();
        }

    } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء حفظ البيانات', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-check-circle text-xl"></i> تأكيد وحفظ الألوان الجديدة`;
    }
};

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(worksheet, { defval: "" }));
            } catch(err) { reject(err); }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}