import { supabase } from '../../config/supabase.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';

let isInitialized = false;
let allModels = [];
let defCache = { cats: [], clss: [], szs: [], clrs: [] };

// 🌟 النظام الجديد لمنع تداخل التحديثات والتعامل مع خمول المتصفح 🌟
let isSyncing = false;

async function syncAdminData() {
    // إذا كانت الصفحة مخفية، لا تفعل شيئاً (سيتم التحديث عند عودة المستخدم لها)
    if (isSyncing || document.hidden) return; 
    isSyncing = true;
    
    setTimeout(async () => {
        console.log('🔄 رصد تغيير في قاعدة البيانات! جاري تحديث الإدارة...');
        await fetchModelsSilent();
        isSyncing = false;
    }, 500); // ننتظر نصف ثانية حتى تستقر كل السجلات
}

function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return './src/assets/icons/devo.jpeg';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) {
                return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1000`;
            }
        }
    } catch (e) {
        console.error("Image Resolving Error:", e);
    }
    return url; 
}

export async function initModelsView() {
    if (isInitialized) return;

    ['model-search', 'filter-category', 'filter-class', 'filter-stock', 'filter-date-from', 'filter-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', applyFilters);
    });
    
    document.getElementById('model-form')?.addEventListener('submit', handleSaveModel);
    document.getElementById('add-stock-form')?.addEventListener('submit', handleAddStockSubmit);
    
    document.getElementById('m-status')?.addEventListener('change', (e) => {
        document.getElementById('m-status-text').textContent = e.target.checked ? 'نشط' : 'معطل';
    });

    await loadDefinitionsCache();
    await loadModels();

    // 🌟 🌟 🌟 تفعيل الاستماع اللحظي (Realtime) القوي والآمن 🌟 🌟 🌟
    supabase.channel('admin_realtime_sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'model_inventory' }, syncAdminData)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements' }, syncAdminData)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'models' }, syncAdminData)
        .subscribe((status) => {
            console.log('📡 حالة اتصال الإدارة بالرادار اللحظي:', status);
        });
// 🌟 تحديث البيانات فوراً بمجرد عودة المستخدم لصفحة الإدارة (قهر خمول المتصفح) 🌟
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && isInitialized) {
            console.log('👁️ عودة لصفحة الإدارة، جاري جلب أحدث البيانات لتفادي خمول المتصفح...');
            fetchModelsSilent();
        }
    });
    isInitialized = true;
}

window.clearModelFilters = () => {
    document.getElementById('model-search').value = '';
    document.getElementById('filter-category').value = '';
    document.getElementById('filter-class').value = '';
    document.getElementById('filter-stock').value = '';
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    applyFilters(); 
};

// --- Data Fetching ---
async function loadDefinitionsCache() {
    const [cats, clss, szs, clrs] = await Promise.all([
        supabase.from('categories').select('id, name'),
        supabase.from('classes').select('id, name'),
        supabase.from('sizes').select('id, name'),
        supabase.from('colors').select('id, name')
    ]);
    defCache = { cats: cats.data, clss: clss.data, szs: szs.data, clrs: clrs.data };
    
    document.getElementById('filter-category').innerHTML += defCache.cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('filter-class').innerHTML += defCache.clss.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

async function loadModels() {
    const container = document.getElementById('models-container');
    container.innerHTML = `<div class="col-span-full py-20 text-center"><i class="ph ph-spinner animate-spin text-4xl text-devo-orange"></i></div>`;
    await fetchModelsSilent(false); 
}

async function fetchModelsSilent(isSilent = true) {
    const { data, error } = await supabase
        .from('models')
        .select(`
            *,
            categories(id, name),
            classes(id, name),
            model_sizes(sizes(id, name)),
            model_inventory(color_id, available_series, colors(id, name, color_code)),
            model_images(image_url)
        `)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Fetch Models Error:", error);
        if (!isSilent) showToast('خطأ في تحميل الموديلات', 'error');
        return;
    }

    allModels = data;
    updateStatistics(data);
    applyFilters();

    // تحديث النافذة المفتوحة بصمت
    const detailsModal = document.getElementById('view-details-modal');
    if (detailsModal && !detailsModal.classList.contains('hidden')) {
        const activeModelId = detailsModal.getAttribute('data-current-view-id');
        if (activeModelId) {
            viewDetails(activeModelId, true); 
        }
    }
}

function updateStatistics(data) {
    let active = 0, outOfStock = 0, totalSeries = 0;
    
    data.forEach(m => {
        if (m.is_active) active++;
        let mTotalQty = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
        if (mTotalQty === 0) outOfStock++;
        totalSeries += mTotalQty;
    });

    document.getElementById('stat-total').textContent = data.length;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-out').textContent = outOfStock;
    document.getElementById('stat-series').textContent = totalSeries;
}

function applyFilters() {
    const term = document.getElementById('model-search').value.toLowerCase();
    const catId = document.getElementById('filter-category').value;
    const classId = document.getElementById('filter-class').value;
    const stockStatus = document.getElementById('filter-stock').value;
    
    const dateFrom = document.getElementById('filter-date-from')?.value;
    const dateTo = document.getElementById('filter-date-to')?.value;

    const filtered = allModels.filter(m => {
        let isMatch = true;
        const totalQty = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;

        if (term && !m.factory_code?.toLowerCase().includes(term) && !m.name?.toLowerCase().includes(term)) isMatch = false;
        if (catId && m.category_id !== catId) isMatch = false;
        if (classId && m.class_id !== classId) isMatch = false;
        if (stockStatus === 'in_stock' && totalQty === 0) isMatch = false;
        if (stockStatus === 'out_stock' && totalQty > 0) isMatch = false;

        if (dateFrom || dateTo) {
            const modelDate = new Date(m.created_at);
            modelDate.setHours(0, 0, 0, 0);

            if (dateFrom) {
                const fDate = new Date(dateFrom);
                fDate.setHours(0, 0, 0, 0);
                if (modelDate < fDate) isMatch = false;
            }

            if (dateTo) {
                const tDate = new Date(dateTo);
                tDate.setHours(23, 59, 59, 999);
                if (modelDate > tDate) isMatch = false;
            }
        }

        return isMatch;
    });
    renderModelsGrid(filtered);
}

function renderModelsGrid(models) {
    const container = document.getElementById('models-container');
    if (models.length === 0) {
        container.innerHTML = `<div class="col-span-full py-10 text-center text-devo-muted">لا توجد موديلات مسجلة حالياً تطابق بحثك</div>`;
        return;
    }

    container.innerHTML = models.map(m => {
        const totalSeries = m.model_inventory?.reduce((sum, inv) => sum + inv.available_series, 0) || 0;
        const sizesCount = m.model_sizes?.length || 1; 
        const totalPieces = totalSeries * sizesCount; 
        
        const isOut = totalSeries === 0;
        const mainImg = resolveImageUrl(m.model_images?.[0]?.image_url); 
        
        const cardClass = isOut ? 'grayscale opacity-75 border-devo-gray' : 'hover:border-devo-orange/50';
        const badgeHTML = isOut 
            ? `<span class="bg-devo-error text-white text-xs px-2 py-1 rounded shadow-md">نفذت الكمية</span>`
            : `<span class="bg-devo-success text-white text-xs px-2 py-1 rounded shadow-md">متوفر</span>`;

        return `
        <div class="bg-devo-dark border border-devo-gray rounded-2xl  transition-all duration-300 flex flex-col ${cardClass}">
            <div class="h-48 bg-devo-black relative flex items-center justify-center">
                <img src="${mainImg}" class="w-full h-full object-cover" onerror="this.src='./src/assets/icons/devo.jpeg'">
                <div class="absolute top-3 right-3">${badgeHTML}</div>
                ${!m.is_active ? `<div class="absolute top-3 left-3 bg-devo-gray text-white text-xs px-2 py-1 rounded shadow-md">معطل</div>` : ''}
            </div>
            <div class="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div>
                    <p class="text-devo-muted text-[10px] font-bold tracking-wider">${m.factory_code || m.system_code}</p>
                    <h4 class="text-white font-bold truncate" title="${m.name}">${m.name}</h4>
                    <p class="text-devo-orange text-sm font-bold mt-1">${m.price} ج.م</p>
                </div>
                <div class="text-xs text-devo-muted border-t border-devo-gray pt-2">
                    <span class="block mb-1"><i class="ph ph-tag"></i> ${m.categories?.name}</span>
                    <span class="block ${isOut ? 'text-devo-error' : 'text-devo-info'} font-bold">
                        المتاح: ${totalSeries} سيريه <span class="font-normal text-devo-muted">(${totalPieces} قطعة)</span>
                    </span>
                </div>
                <div class="grid grid-cols-3 gap-2 pt-2">
                    <button onclick="viewDetails('${m.id}')" class="col-span-1 py-1.5 bg-devo-black hover:bg-devo-gray text-white rounded text-xs transition-colors"><i class="ph ph-eye"></i> عرض</button>
                    <button onclick="openModelModal('${m.id}')" class="col-span-1 py-1.5 bg-devo-info/10 hover:bg-devo-info text-devo-info hover:text-white rounded text-xs transition-colors"><i class="ph ph-pencil"></i> تعديل</button>
                    <button onclick="handleDeleteModel('${m.id}')" class="col-span-1 py-1.5 bg-devo-error/10 hover:bg-devo-error text-devo-error hover:text-white rounded text-xs transition-colors"><i class="ph ph-trash"></i> حذف</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

window.openModelModal = async (id = null) => {
    const form = document.getElementById('model-form');
    form.reset();
    document.getElementById('m-id').value = id || '';
    
    document.getElementById('m-category').innerHTML = defCache.cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    document.getElementById('m-class').innerHTML = defCache.clss.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    window.allAvailableColors = defCache.clrs;

    const sizesContainer = document.getElementById('m-sizes-container');
    const invContainer = document.getElementById('m-inventory-container');
    const modalTitle = document.getElementById('model-modal-title');
    const submitBtn = form.querySelector('button[type="submit"]');

    if (id) {
        const model = allModels.find(m => m.id === id);
        if (!model) return;

        modalTitle.innerHTML = `<i class="ph ph-pencil-simple text-devo-orange text-2xl"></i> تعديل بيانات الموديل`;
        submitBtn.innerHTML = `حفظ التعديلات`;

        document.getElementById('m-system-code').value = model.system_code;
        document.getElementById('m-factory-code').value = model.factory_code;
        document.getElementById('m-name').value = model.name;
        document.getElementById('m-price').value = model.price;
        document.getElementById('m-category').value = model.category_id;
        document.getElementById('m-class').value = model.class_id;
        
        document.getElementById('m-status').checked = model.is_active;
        document.getElementById('m-status-text').textContent = model.is_active ? 'نشط' : 'معطل';

        const modelSizeIds = model.model_sizes.map(s => s.sizes?.id);
        sizesContainer.innerHTML = defCache.szs.map(s => `
            <label class="flex items-center gap-2 bg-devo-black border border-devo-gray px-3 py-1.5 rounded cursor-pointer hover:border-devo-orange has-[:checked]:border-devo-orange text-xs">
                <input type="checkbox" name="sizes" value="${s.id}" class="accent-devo-orange" ${modelSizeIds.includes(s.id) ? 'checked' : ''}> <span class="text-white">${s.name}</span>
            </label>
        `).join('');

        invContainer.innerHTML = `<div class="py-4 text-center text-devo-muted"><i class="ph ph-spinner animate-spin text-2xl"></i></div>`;
        
        const modal = document.getElementById('model-modal');
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);

        const { data: outMovements } = await supabase
            .from('stock_movements')
            .select('color_id, quantity')
            .eq('model_id', id)
            .eq('movement_type', 'out');
            
        const soldMap = {};
        outMovements?.forEach(m => {
            soldMap[m.color_id] = (soldMap[m.color_id] || 0) + m.quantity;
        });

        invContainer.innerHTML = '';
        model.model_inventory.forEach(inv => {
            const sold = soldMap[inv.color_id] || 0;
            const total = inv.available_series + sold; 
            addInventoryRow(inv.color_id, total, sold);
        });

        const imgs = model.model_images || [];
        document.getElementById('m-img-1').value = imgs[0]?.image_url || '';
        document.getElementById('m-img-2').value = imgs[1]?.image_url || '';
        document.getElementById('m-img-3').value = imgs[2]?.image_url || '';

    } else {
        modalTitle.innerHTML = `<i class="ph ph-plus-circle text-devo-orange text-2xl"></i> إنشاء موديل جديد`;
        submitBtn.innerHTML = `حفظ الموديل`;
        
        document.getElementById('m-status').checked = true;
        document.getElementById('m-status-text').textContent = 'نشط';

        sizesContainer.innerHTML = defCache.szs.map(s => `
            <label class="flex items-center gap-2 bg-devo-black border border-devo-gray px-3 py-1.5 rounded cursor-pointer hover:border-devo-orange has-[:checked]:border-devo-orange text-xs">
                <input type="checkbox" name="sizes" value="${s.id}" class="accent-devo-orange"> <span class="text-white">${s.name}</span>
            </label>
        `).join('');

        invContainer.innerHTML = '';
        addInventoryRow();

        const modal = document.getElementById('model-modal');
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
};

window.addInventoryRow = (colorId = '', totalQty = '', soldQty = 0) => {
    const container = document.getElementById('m-inventory-container');
    const row = document.createElement('div');
    row.className = 'flex gap-2 items-center';
    
    const isExisting = colorId !== '';
    
    row.innerHTML = `
        <select name="inv-color" ${isExisting ? 'disabled' : ''} class="flex-[2] bg-devo-black border border-devo-gray rounded px-3 py-2 text-white text-xs outline-none focus:border-devo-orange ${isExisting ? 'opacity-70 cursor-not-allowed' : ''}">
            <option value="" disabled ${!isExisting ? 'selected' : ''}>اختر اللون</option>
            ${window.allAvailableColors.map(c => `<option value="${c.id}" ${c.id === colorId ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
        ${isExisting ? `<input type="hidden" name="inv-color-val" value="${colorId}">` : ''}
        
        <input type="number" name="inv-qty" placeholder="إجمالي السريات" min="${soldQty}" value="${totalQty}" data-sold="${soldQty}" class="flex-1 bg-devo-black border border-devo-gray rounded px-3 py-2 text-white text-xs outline-none focus:border-devo-orange" title="تم سحب ${soldQty} سيريه من هذا اللون">
        
        ${isExisting && soldQty > 0 
            ? `<button type="button" onclick="showToast('لا يمكن حذف لون تم السحب منه. يمكنك تقليل الإجمالي فقط.', 'warning')" class="p-2 text-devo-grayHover cursor-not-allowed rounded"><i class="ph ph-trash"></i></button>` 
            : `<button type="button" onclick="this.parentElement.remove()" class="p-2 text-devo-error hover:bg-devo-error/20 rounded transition-colors"><i class="ph ph-trash"></i></button>`
        }
    `;
    container.appendChild(row);
};

window.closeModelModal = () => {
    document.getElementById('model-modal').classList.add('opacity-0');
    setTimeout(() => document.getElementById('model-modal').classList.add('hidden'), 300);
};

async function handleSaveModel(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const originalBtnText = btn.innerHTML;
    
    const id = document.getElementById('m-id').value;
    const modelData = {
        system_code: document.getElementById('m-system-code').value,
        factory_code: document.getElementById('m-factory-code').value,
        name: document.getElementById('m-name').value,
        price: document.getElementById('m-price').value,
        category_id: document.getElementById('m-category').value,
        class_id: document.getElementById('m-class').value,
        is_active: document.getElementById('m-status').checked
    };

    const selectedSizes = Array.from(document.querySelectorAll('input[name="sizes"]:checked')).map(cb => cb.value);
    
    const invRows = document.querySelectorAll('#m-inventory-container > div');
    const inventoryData = [];
    
    for (const row of invRows) {
        const hiddenColor = row.querySelector('[name="inv-color-val"]');
        const colorSelect = row.querySelector('[name="inv-color"]');
        const colorId = hiddenColor ? hiddenColor.value : (colorSelect ? colorSelect.value : null);
        
        if (!colorId) continue;

        const qtyInput = row.querySelector('[name="inv-qty"]');
        const totalQty = parseInt(qtyInput.value) || 0;
        const soldQty = parseInt(qtyInput.dataset.sold || "0");
        
        const available_series = totalQty - soldQty;
        
        if (available_series < 0) {
            const colorName = colorSelect.options[colorSelect.selectedIndex].text;
            showToast(`لا يمكن تقليل كمية (${colorName}) لأقل من المباع (${soldQty}).`, 'error');
            return;
        }
        
        inventoryData.push({ color_id: colorId, available_series });
    }

    const uniqueColors = new Set(inventoryData.map(i => i.color_id));
    if (uniqueColors.size !== inventoryData.length) {
        return showToast('لا يمكن تكرار اللون في نفس الموديل. يرجى دمج الكميات في صف واحد.', 'warning');
    }

    const images = ['m-img-1', 'm-img-2', 'm-img-3']
        .map(inputId => document.getElementById(inputId).value.trim())
        .filter(url => url !== '');

    let statusMessage = '';
    if (selectedSizes.length === 0 || inventoryData.length === 0) {
        modelData.is_active = false;
        statusMessage = ' (تم الحفظ كـ "معطل" لعدم اكتمال المقاسات والألوان)';
    }

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    try {
        let modelId = id;
        if (id) {
            const { error: updateError } = await supabase.from('models').update(modelData).eq('id', id);
            if (updateError) throw updateError;
            
            await supabase.from('model_sizes').delete().eq('model_id', id);
            await supabase.from('model_inventory').delete().eq('model_id', id);
            await supabase.from('model_images').delete().eq('model_id', id);
        } else {
            const { data, error: insertError } = await supabase.from('models').insert([modelData]).select().single();
            if (insertError) throw insertError;
            modelId = data.id;
        }

        if (selectedSizes.length > 0) {
            await supabase.from('model_sizes').insert(selectedSizes.map(sId => ({ model_id: modelId, size_id: sId })));
        }
        if (inventoryData.length > 0) {
            await supabase.from('model_inventory').insert(inventoryData.map(inv => ({ ...inv, model_id: modelId })));
        }
        if (images.length > 0) {
            await supabase.from('model_images').insert(images.map(url => ({ model_id: modelId, image_url: url })));
        }

        showToast((id ? 'تم حفظ التعديلات بنجاح' : 'تم إضافة الموديل بنجاح') + statusMessage, 'success');
        closeModelModal();

        // 🌟 🌟 السطر السحري تم وضعه في مكانه الصحيح 🌟 🌟
        await fetchModelsSilent(false);

    } catch (err) {
        if (err.code === '23505') { 
            showToast('كود السيستم هذا مستخدم بالفعل في موديل آخر، يرجى تغييره!', 'error');
        } else {
            showToast(err.message, 'error');
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalBtnText;
    }
}

// 🌟 تعديل العرض ليدعم التحديث الصامت 🌟
window.viewDetails = async (id, isSilent = false) => {
    const model = allModels.find(m => m.id === id);
    if (!model) return;

    const modal = document.getElementById('view-details-modal');
    const content = document.getElementById('details-content');
    
    modal.setAttribute('data-current-view-id', id);

    const sizesCount = model.model_sizes?.length || 1; 

    if (!isSilent) {
        content.innerHTML = `<div class="py-20 text-center"><i class="ph ph-spinner animate-spin text-4xl text-devo-orange"></i><p class="mt-2 text-devo-muted">جاري تحميل بيانات السجل...</p></div>`;
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }

    const { data: movements } = await supabase
        .from('stock_movements')
        .select('*, colors(name)')
        .eq('model_id', id)
        .order('created_at', { ascending: false });

    let imagesHtml = '';
    if (model.model_images && model.model_images.length > 0) {
        imagesHtml = `
            <div class="flex gap-3 overflow-x-auto pb-2 custom-scrollbar">
                ${model.model_images.map(img => `
                    <img src="${resolveImageUrl(img.image_url)}" class="h-40 w-40 flex-shrink-0 rounded-xl object-cover border border-devo-gray bg-devo-black shadow-sm" onerror="this.src='./src/assets/icons/devo.jpeg'">
                `).join('')}
            </div>
        `;
    } else {
        imagesHtml = `
            <div class="h-40 w-40 rounded-xl bg-devo-black border border-devo-gray flex items-center justify-center overflow-hidden shadow-sm">
                <img src="./src/assets/icons/devo.jpeg" class="w-full h-full object-cover ">
            </div>
        `;
    }
    const colorsHtml = model.model_inventory?.map(inv => `
        <div class="flex justify-between p-3 bg-devo-black rounded-lg border border-devo-gray items-center">
            <span class="text-white">${inv.colors?.name}</span>
            <span class="font-bold ${inv.available_series === 0 ? 'text-devo-error' : 'text-devo-orange'}">
                ${inv.available_series} سيريه 
                <span class="text-xs text-devo-muted font-normal">(${inv.available_series * sizesCount} قطعة)</span>
            </span>
        </div>
    `).join('');

    const movementsHtml = movements?.length ? `
        <div class="overflow-x-auto border border-devo-gray rounded-lg">
            <table class="w-full text-right text-sm">
                <thead class="bg-devo-black">
                    <tr class="text-devo-muted">
                        <th class="p-3 font-medium border-b border-devo-gray">النوع</th>
                        <th class="p-3 font-medium border-b border-devo-gray">اللون</th>
                        <th class="p-3 font-medium border-b border-devo-gray">الكمية</th>
                        <th class="p-3 font-medium border-b border-devo-gray">الوصف</th>
                        <th class="p-3 font-medium border-b border-devo-gray">التاريخ</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-devo-gray bg-devo-black/30">
                    ${movements.map(mov => `
                        <tr class="hover:bg-devo-black transition-colors">
                            <td class="p-3 ${mov.movement_type === 'in' ? 'text-devo-success' : 'text-devo-error'} font-bold">
                                ${mov.movement_type === 'in' ? '<i class="ph ph-arrow-down-left"></i> إضافة وارد' : '<i class="ph ph-arrow-up-right"></i> سحب مبيعات'}
                            </td>
                            <td class="p-3 text-white">${mov.colors?.name}</td>
                            <td class="p-3 text-white font-bold leading-tight">
                                ${mov.quantity} سيريه <br>
                                <span class="text-[10px] text-devo-muted font-normal">(${mov.quantity * sizesCount} قطعة)</span>
                            </td>
                            <td class="p-3 text-devo-muted">${mov.reference || '---'}</td>
                            <td class="p-3 text-devo-muted text-xs">${new Date(mov.created_at).toLocaleString('ar-EG')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    ` : `<div class="bg-devo-black p-8 rounded-xl border border-devo-gray text-center text-devo-muted flex flex-col items-center">
            <i class="ph ph-clock text-4xl opacity-50 mb-2"></i>
            <p class="text-sm">لا توجد حركات مسجلة لهذا الموديل حتى الآن.</p>
         </div>`;

    content.innerHTML = `
        <div class="mb-6">${imagesHtml}</div>
        <div class="bg-devo-black/30 rounded-xl border border-devo-gray overflow-hidden mb-6">
            <table class="w-full text-right text-sm">
                <tbody class="divide-y divide-devo-gray">
                    <tr><td class="p-3 text-devo-muted w-1/3">كود السيستم</td><td class="p-3 text-white font-mono">${model.system_code}</td></tr>
                    <tr><td class="p-3 text-devo-muted">كود المصنع</td><td class="p-3 text-white font-mono">${model.factory_code}</td></tr>
                    <tr><td class="p-3 text-devo-muted">اسم الموديل</td><td class="p-3 text-white font-bold">${model.name}</td></tr>
                    <tr><td class="p-3 text-devo-muted">التصنيف والفئة</td><td class="p-3 text-white">${model.categories?.name} - ${model.classes?.name}</td></tr>
                    <tr><td class="p-3 text-devo-muted">السعر</td><td class="p-3 text-devo-orange font-bold">${model.price} ج.م</td></tr>
                </tbody>
            </table>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <h4 class="text-devo-orange font-bold mb-3 text-sm flex items-center gap-2"><i class="ph ph-ruler"></i> المقاسات المتاحة (${sizesCount} مقاسات)</h4>
                <div class="flex flex-wrap gap-2">
                    ${model.model_sizes?.map(s => `<span class="bg-devo-black border border-devo-gray px-3 py-1 rounded text-white text-xs shadow-sm">${s.sizes?.name}</span>`).join('')}
                </div>
            </div>
            <div>
                <div class="flex justify-between items-center mb-3">
                    <h4 class="text-devo-orange font-bold text-sm flex items-center gap-2"><i class="ph ph-palette"></i> مخزون الألوان</h4>
                    <button onclick="openAddStockModal('${model.id}')" class="text-xs bg-devo-success/10 text-devo-success hover:bg-devo-success hover:text-white px-3 py-1.5 rounded-lg transition-colors font-bold flex items-center gap-1">
                        <i class="ph ph-plus"></i> إضافة شحنة
                    </button>
                </div>
                <div class="space-y-2">${colorsHtml}</div>
            </div>
        </div>
        <div class="mt-8 border-t border-devo-gray pt-6">
            <h4 class="text-devo-orange font-bold mb-4 text-sm"><i class="ph ph-list-numbers"></i> سجل حركة المخزون</h4>
            ${movementsHtml}
        </div>
    `;
};

window.closeDetailsModal = () => {
    document.getElementById('view-details-modal').classList.add('opacity-0');
    document.getElementById('view-details-modal').removeAttribute('data-current-view-id');
    setTimeout(() => document.getElementById('view-details-modal').classList.add('hidden'), 300);
};

window.handleDeleteModel = async (id) => {
    const confirmed = await confirmDialog({ title: 'حذف الموديل', message: 'هل أنت متأكد؟ سيتم حذف الموديل وجميع بيانات المخزون المرتبطة به.', isDestructive: true });
    if (confirmed) {
        await supabase.from('models').delete().eq('id', id);
        showToast('تم حذف الموديل بنجاح');
    }
};

window.openAddStockModal = (modelId) => {
    const model = allModels.find(m => m.id === modelId);
    if (!model) return;

    document.getElementById('add-stock-form').reset();
    document.getElementById('stock-model-id').value = modelId;
    
    const colorSelect = document.getElementById('stock-color');
    colorSelect.innerHTML = model.model_inventory.map(inv => 
        `<option value="${inv.color_id}">${inv.colors?.name} (المتاح حالياً: ${inv.available_series} سيريه)</option>`
    ).join('');

    const modal = document.getElementById('add-stock-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeAddStockModal = () => {
    const modal = document.getElementById('add-stock-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

async function handleAddStockSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('stock-save-btn');
    const modelId = document.getElementById('stock-model-id').value;
    const colorId = document.getElementById('stock-color').value;
    const addedQty = parseInt(document.getElementById('stock-qty').value);

    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري الحفظ...`;

    try {
        const currentInv = allModels.find(m => m.id === modelId).model_inventory.find(i => i.color_id === colorId);
        const newQty = currentInv.available_series + addedQty;

        const { error: invError } = await supabase
            .from('model_inventory')
            .update({ available_series: newQty })
            .eq('model_id', modelId)
            .eq('color_id', colorId);
        if (invError) throw invError;

        const { error: movError } = await supabase
            .from('stock_movements')
            .insert([{ model_id: modelId, color_id: colorId, movement_type: 'in', quantity: addedQty, reference: 'إضافة شحنة يدوية' }]);
        if (movError) throw movError;

        showToast('تمت إضافة الشحنة للمخزون بنجاح', 'success');
        closeAddStockModal();

    } catch (err) {
        showToast('حدث خطأ أثناء حفظ الشحنة', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span>حفظ الشحنة</span>`;
    }
}

// ==========================================
// --- Excel Import Logic ---
// ==========================================

let pendingExcelModels = [];
let pendingExcelCategories = new Set();

window.resetExcelModal = () => {
    document.getElementById('excel-step-1').classList.remove('hidden');
    document.getElementById('excel-step-2').classList.add('hidden');
    document.getElementById('excel-step-2').classList.remove('flex');
    document.getElementById('excel-file-input').value = '';
    document.getElementById('excel-file-name').textContent = 'اسحب الملف هنا أو اضغط للاختيار';
    pendingExcelModels = [];
    pendingExcelCategories.clear();
};

window.openExcelImportModal = () => {
    resetExcelModal();
    const modal = document.getElementById('excel-import-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeExcelImportModal = () => {
    const modal = document.getElementById('excel-import-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

document.getElementById('excel-file-input')?.addEventListener('change', function(e) {
    const fileName = e.target.files[0]?.name || 'اسحب الملف هنا أو اضغط للاختيار';
    document.getElementById('excel-file-name').textContent = fileName;
});

window.processExcelPreview = async () => {
    const fileInput = document.getElementById('excel-file-input');
    const file = fileInput.files[0];
    
    if (!file) return showToast('الرجاء اختيار ملف إكسيل أولاً', 'warning');

    const btn = document.getElementById('excel-preview-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin text-xl"></i> جاري التحليل...`;

    try {
        const data = await readExcelFile(file);
        if (data.length === 0) throw new Error("الملف فارغ");

        const existingCodes = new Set(allModels.map(m => String(m.system_code)));
        const newModels = [];
        const duplicates = [];
        const uniqueCategories = new Set();

        data.forEach(row => {
            const sysCode = String(row['كود']);
            if (!sysCode || sysCode === 'undefined') return;

            const price = parseFloat(row['بيع 1']) || 0;
            const catName = row['النوع'] ? String(row['النوع']).trim() : null;
            const rawItemName = row['الصنف'] ? String(row['الصنف']).trim() : '';

            let modelName = rawItemName;
            let factoryCode = '';

            const match = rawItemName.match(/(.+?)\s+(\d+)$/);
            if (match) {
                modelName = match[1].trim();
                factoryCode = match[2];
            }

            if (existingCodes.has(sysCode)) {
                duplicates.push({ sysCode, modelName });
            } else {
                if (catName) uniqueCategories.add(catName);
                newModels.push({
                    system_code: sysCode,
                    factory_code: factoryCode,
                    name: modelName,
                    price: price,
                    category_name: catName,
                    class_id: null,
                    is_active: false
                });
            }
        });

        pendingExcelModels = newModels;
        pendingExcelCategories = uniqueCategories;

        document.getElementById('excel-new-count').textContent = newModels.length;
        document.getElementById('excel-dup-count').textContent = duplicates.length;

        const dupWarning = document.getElementById('excel-dup-warning');
        const dupList = document.getElementById('excel-dup-list');
        
        if (duplicates.length > 0) {
            dupWarning.classList.remove('hidden');
            dupList.innerHTML = duplicates.map(d => `<div class="bg-devo-black/50 p-2 rounded border border-devo-error/20"><span class="font-mono text-devo-error ml-2">[${d.sysCode}]</span> <span class="text-white">${d.modelName}</span></div>`).join('');
        } else {
            dupWarning.classList.add('hidden');
        }

        document.getElementById('excel-step-1').classList.add('hidden');
        document.getElementById('excel-step-2').classList.remove('hidden');
        document.getElementById('excel-step-2').classList.add('flex');

    } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء قراءة الملف، تأكد من صحة الأعمدة', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-magnifying-glass text-xl"></i> تحليل ومعاينة الملف`;
    }
};

window.executeExcelImport = async () => {
    if (pendingExcelModels.length === 0) {
        showToast('لا توجد موديلات جديدة صالحة للإضافة!', 'warning');
        return;
    }

    const btn = document.getElementById('excel-import-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin text-xl"></i> جاري الحفظ والتأكيد...`;

    try {
        for (const catName of pendingExcelCategories) {
            let existingCat = defCache.cats.find(c => c.name === catName);
            if (!existingCat) {
                const { data: newCat } = await supabase.from('categories').insert([{ name: catName }]).select().single();
                if (newCat) defCache.cats.push(newCat);
            }
        }

        const modelsToInsert = pendingExcelModels.map(m => {
            const catId = m.category_name ? defCache.cats.find(c => c.name === m.category_name)?.id : null;
            return {
                system_code: m.system_code,
                factory_code: m.factory_code,
                name: m.name,
                price: m.price,
                category_id: catId,
                class_id: m.class_id,
                is_active: m.is_active
            };
        });

        const { error } = await supabase.from('models').insert(modelsToInsert);
        if (error) throw error;

        showToast(`تم استيراد وحفظ ${modelsToInsert.length} موديل بنجاح!`, 'success');
        closeExcelImportModal();

        // 🌟 السطر السحري: لتحديث الجدول فوراً بعد رفع الإكسيل 🌟
        await fetchModelsSilent(false);

    } catch (err) {
        console.error(err);
        showToast('حدث خطأ أثناء حفظ البيانات المجمعة', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="ph ph-check-circle text-xl"></i> تأكيد وحفظ الموديلات الجديدة`;
    }
};

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, {type: 'array'});
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                resolve(json);
            } catch(err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    });
}