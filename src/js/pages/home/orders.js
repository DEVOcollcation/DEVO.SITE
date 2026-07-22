import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';

let currentUser = null;
let allOrders = [];
let currentTab = 'active'; 
let orderToEdit = null;

export async function initOrdersView() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    
    if (!currentUser) return;

    ['ord-search', 'ord-status', 'ord-date-from', 'ord-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', renderOrders);
    });

    await fetchMyOrders();
    setupOrdersRealtime(); // 🌟 تفعيل الرادار اللحظي للموظف 🌟
}

export async function refreshWorkerOrders() {
    if (!currentUser) return;
    await fetchMyOrders();
}
window.refreshWorkerOrders = refreshWorkerOrders;

async function fetchFullWorkerOrderById(orderId) {
    if (!currentUser) return null;
    try {
        const { data, error } = await supabase
            .from('orders')
            .select(`
                *,
                order_items (
                    *,
                    models (
                        name, 
                        factory_code,
                        system_code,
                        model_images(image_url),
                        model_sizes(size_id),
                        classes(class_sizes(size_id))
                    ),
                    colors (name)
                )
            `)
            .eq('id', orderId)
            .maybeSingle();

        if (data && !error) {
            const idx = allOrders.findIndex(o => o.id === orderId);
            if (idx > -1) {
                allOrders[idx] = data;
            } else {
                allOrders.unshift(data);
            }
            return data;
        }
    } catch (e) {
        console.error('Error fetching worker order by ID:', e);
    }
    return null;
}

// 🌟 الرادار اللحظي لمنع التعديل عند القفل والمزامنة اللحظية الشاملة 🌟
function setupOrdersRealtime() {
    supabase.channel('worker_orders_sync')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async (payload) => {
            if (!currentUser) return;
            const isMine = payload.new.worker_id === currentUser.id || payload.new.assigned_worker_id === currentUser.id;
            if (!isMine) return;

            const newOrder = await fetchFullWorkerOrderById(payload.new.id);
            if (newOrder) {
                renderOrders();
                showToast(`تم إسناد/إنشاء أوردر جديد رقم (#${newOrder.invoice_number})!`, 'info');
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async (payload) => {
            if (!currentUser) return;
            const isMine = payload.new.worker_id === currentUser.id || payload.new.assigned_worker_id === currentUser.id;
            const existingIdx = allOrders.findIndex(o => o.id === payload.new.id);

            if (isMine) {
                const updatedOrder = await fetchFullWorkerOrderById(payload.new.id);
                if (updatedOrder) {
                    renderOrders();
                    
                    // تنبيه الموظف عند إسناد أوردر جديد له من قبل الإدارة
                    if (existingIdx === -1) {
                        showToast(`تم إسناد أوردر رقم (#${updatedOrder.invoice_number}) لك من قبل الإدارة!`, 'info');
                    }

                    // إذا كان الموظف يحاول تعديله وقام مستخدم آخر بقفله
                    const myName = currentUser?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || '';
                    if (orderToEdit && orderToEdit.id === payload.new.id && payload.new.is_locked && payload.new.assigned_admin_name !== myName) {
                        closeEditWarningModal();
                        showToast('قامت الإدارة أو مستخدم آخر بقفل هذا الأوردر للتو، لا يمكن تعديله الآن!', 'error');
                    }
                }
            } else {
                // إذا كان الأوردر موجهاً سابقاً للموظف وتم إلغاء تعيينه أو تحويله لموظف آخر
                if (existingIdx > -1) {
                    allOrders.splice(existingIdx, 1);
                    renderOrders();
                    showToast('تم إلغاء إسناد أحد الأوردرات من حسابك بواسطة الإدارة', 'warning');
                }
            }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' }, (payload) => {
            if (!currentUser) return;
            const existingIdx = allOrders.findIndex(o => o.id === payload.old.id);
            if (existingIdx > -1) {
                const deletedInv = allOrders[existingIdx].invoice_number || payload.old.id;
                allOrders.splice(existingIdx, 1);
                renderOrders();
                showToast(`تم حذف الأوردر رقم (#${deletedInv}) بواسطة الإدارة`, 'warning');

                if (orderToEdit && orderToEdit.id === payload.old.id) {
                    closeEditWarningModal();
                }
            }
        })
        .subscribe();
}

window.switchOrdersTab = (tab) => {
    currentTab = tab;
    document.getElementById('tab-orders-active').className = tab === 'active' 
        ? 'px-4 py-2 text-sm font-bold text-devo-orange border-b-2 border-devo-orange transition-all' 
        : 'px-4 py-2 text-sm font-bold text-devo-muted hover:text-white border-b-2 border-transparent transition-all';
        
    document.getElementById('tab-orders-archived').className = tab === 'archived' 
        ? 'px-4 py-2 text-sm font-bold text-devo-orange border-b-2 border-devo-orange transition-all' 
        : 'px-4 py-2 text-sm font-bold text-devo-muted hover:text-white border-b-2 border-transparent transition-all';
        
    renderOrders();
};

async function fetchMyOrders() {
    const tBody = document.getElementById('orders-table-body');
    if(tBody) tBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i> جاري التحميل...</td></tr>`;

    const { data, error } = await supabase
        .from('orders')
        .select(`
            *,
            order_items (
                *,
                models (
                    name, 
                    factory_code,
                    system_code,
                    model_images(image_url),
                    model_sizes(size_id),
                    classes(class_sizes(size_id))
                ),
                colors (name)
            )
        `)
        .or(`worker_id.eq.${currentUser.id},assigned_worker_id.eq.${currentUser.id}`)
        .order('created_at', { ascending: false });
        
    if (error) {
        showToast('حدث خطأ أثناء جلب الأوردرات', 'error');
        console.error(error);
        return;
    }

    allOrders = data;
    renderOrders();
}

const statusConfig = {
    'created': { text: 'تم إنشاء الأوردر', color: 'bg-devo-gray text-white border-devo-gray' },
    'in_progress': { text: 'جاري العمل', color: 'bg-devo-orange/20 text-devo-orange border-devo-orange/50' },
    'registered': { text: 'تم التسجيل', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
    'preparing': { text: 'جاري التجهيز', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50' },
    'shipped': { text: 'تم الشحن', color: 'bg-green-500/20 text-green-400 border-green-500/50' },
    'delivered': { text: 'تم التسليم', color: 'bg-devo-success/20 text-devo-success border-devo-success/50' }
};

function renderOrders() {
    const term = document.getElementById('ord-search')?.value.toLowerCase() || '';
    const statusFilter = document.getElementById('ord-status')?.value || '';
    const dateFrom = document.getElementById('ord-date-from')?.value;
    const dateTo = document.getElementById('ord-date-to')?.value;

    const filtered = allOrders.filter(o => {
        const isArchived = o.is_archived || false;
        if (currentTab === 'active' && isArchived) return false;
        if (currentTab === 'archived' && !isArchived) return false;

        if (term && !o.invoice_number.toLowerCase().includes(term) && !o.customer_name.toLowerCase().includes(term) && !o.phone_1.includes(term)) return false;
        if (statusFilter && o.status !== statusFilter) return false;

        if (dateFrom || dateTo) {
            const oDate = new Date(o.created_at);
            oDate.setHours(0,0,0,0);
            if (dateFrom && oDate < new Date(dateFrom)) return false;
            if (dateTo && oDate > new Date(dateTo)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('orders-table-body');
    const cardsBody = document.getElementById('orders-cards-body');
    
    if (filtered.length === 0) {
        const emptyMsg = `<div class="p-10 text-center text-devo-muted">لا توجد أوردرات تطابق بحثك في هذا القسم.</div>`;
        if (tbody) tbody.innerHTML = `<tr><td colspan="6">${emptyMsg}</td></tr>`;
        if (cardsBody) cardsBody.innerHTML = emptyMsg;
        return;
    }

    if (tbody) tbody.innerHTML = '';
    if (cardsBody) cardsBody.innerHTML = '';

    filtered.forEach(o => {
        const config = statusConfig[o.status] || statusConfig['created'];
        const dateStr = new Date(o.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
        
        const lockIcon = o.is_locked ? `<i class="ph ph-lock text-devo-error" title="مقفل بواسطة الإدارة"></i>` : '';
        const isEditable = o.status === 'created' && !o.is_locked;
        let actionButtons = `
            <div class="flex items-center justify-center gap-2">
                <button onclick="viewOrderDetails('${o.id}')" class="p-2 bg-devo-black border border-devo-gray hover:bg-devo-gray rounded text-white transition-colors" title="عرض"><i class="ph ph-eye"></i></button>
                <button onclick="reprintOrder('${o.id}')" class="p-2 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded transition-colors" title="طباعة"><i class="ph ph-printer"></i></button>
                ${isEditable 
                    ? `<button onclick="confirmEditOrder('${o.id}')" class="p-2 bg-devo-orange/10 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors" title="تعديل الأوردر"><i class="ph ph-pencil-simple"></i></button>` 
                    : `<button disabled class="p-2 bg-devo-gray/20 text-devo-muted rounded cursor-not-allowed" title="${o.is_locked ? 'هذا الأوردر قيد العمل من قبل الإدارة حالياً' : 'يجب إعادة حالة الأوردر إلى تم إنشاء الأوردر لتعديله'}"><i class="ph ph-lock text-devo-muted"></i></button>`
                }
                <button onclick="toggleArchive('${o.id}', ${!o.is_archived})" class="p-2 bg-devo-black border border-devo-gray hover:border-devo-orange rounded text-devo-muted hover:text-white transition-colors" title="${o.is_archived ? 'استعادة' : 'أرشفة'}"><i class="ph ${o.is_archived ? 'ph-tray-arrow-up' : 'ph-archive'}"></i></button>
            </div>
        `;

        let cardActionButtons = `
            <div class="grid grid-cols-4 gap-1.5 pt-2 border-t border-devo-gray/60 mt-3">
                <button onclick="viewOrderDetails('${o.id}')" class="h-9 bg-devo-black border border-devo-gray hover:bg-devo-gray rounded-lg text-white text-xs font-medium flex items-center justify-center gap-1 transition-colors" title="عرض الفاتورة"><i class="ph ph-eye text-sm"></i> <span>عرض</span></button>
                <button onclick="reprintOrder('${o.id}')" class="h-9 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors" title="طباعة"><i class="ph ph-printer text-sm"></i> <span>طباعة</span></button>
                ${isEditable 
                    ? `<button onclick="confirmEditOrder('${o.id}')" class="h-9 bg-devo-orange/10 text-devo-orange hover:bg-devo-orange hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors" title="تعديل"><i class="ph ph-pencil-simple text-sm"></i> <span>تعديل</span></button>` 
                    : `<button disabled class="h-9 bg-devo-gray/20 text-devo-muted rounded-lg text-xs font-medium flex items-center justify-center gap-1 opacity-50 cursor-not-allowed" title="${o.is_locked ? 'الأوردر قيد العمل من الإدارة' : 'لا يمكن التعديل'}"><i class="ph ph-lock text-sm"></i> <span>مقفل</span></button>`
                }
                <button onclick="toggleArchive('${o.id}', ${!o.is_archived})" class="h-9 bg-devo-black border border-devo-gray text-devo-muted hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors" title="${o.is_archived ? 'استعادة' : 'أرشفة'}"><i class="ph ${o.is_archived ? 'ph-tray-arrow-up' : 'ph-archive'} text-sm"></i> <span>${o.is_archived ? 'استعادة' : 'أرشيف'}</span></button>
            </div>
        `;

        if (tbody) {
            tbody.innerHTML += `
                <tr class="hover:bg-devo-black/40 transition-colors">
                    <td class="p-4 font-mono text-devo-orange font-bold text-xs">${o.invoice_number} ${lockIcon}</td>
                    <td class="p-4 font-bold text-white">${o.customer_name}</td>
                    <td class="p-4 text-devo-muted">${o.total_series} سيريه</td>
                    <td class="p-4 text-devo-muted text-xs">${dateStr}</td>
                    <td class="p-4"><span class="px-2 py-1 rounded text-[10px] font-bold border ${config.color}">${config.text}</span></td>
                    <td class="p-4">${actionButtons}</td>
                </tr>
            `;
        }

        if (cardsBody) {
            cardsBody.innerHTML += `
                <div class="bg-devo-dark border border-devo-gray p-3.5 rounded-xl shadow-sm relative space-y-2.5">
                    <div class="flex justify-between items-center border-b border-devo-gray/60 pb-2.5">
                        <div class="flex items-center gap-1.5">
                            <span class="bg-devo-orange/15 text-devo-orange px-2.5 py-0.5 rounded-md font-mono font-bold text-xs border border-devo-orange/30">#${o.invoice_number}</span>
                            ${lockIcon}
                        </div>
                        <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${config.color}">${config.text}</span>
                    </div>

                    <div class="flex justify-between items-start pt-0.5">
                        <div>
                            <h4 class="font-bold text-white text-sm">${o.customer_name}</h4>
                            ${o.phone_1 ? `<p class="text-[11px] text-devo-muted font-mono mt-0.5" dir="ltr">${o.phone_1}</p>` : ''}
                        </div>
                        <div class="text-left">
                            <div class="text-devo-orange font-black text-sm">${(o.total_price || 0).toLocaleString()} ج.م</div>
                            <div class="text-[10px] text-devo-muted">${o.total_series} سيريه</div>
                        </div>
                    </div>

                    <div class="flex justify-between items-center text-[10px] text-devo-muted pt-1">
                        <span><i class="ph ph-calendar-blank"></i> ${dateStr}</span>
                    </div>

                    ${cardActionButtons}
                </div>
            `;
        }
    });
}

window.viewOrderDetails = async (id) => {
    const freshOrder = await fetchFullWorkerOrderById(id);
    const o = freshOrder || allOrders.find(x => x.id === id);
    if (!o) return;

    const remaining = o.total_price - (o.deposit || 0);
    const groupedItems = {};

    o.order_items.forEach(item => {
        const modelId = item.model_id;
        const colorName = item.colors?.name || '-';
        const qty = item.quantity;
        
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1);
        const pieces = qty * sizesCount;

        const colorWithQty = `${qty} ${colorName}`;

        const piecePrice = item.price_per_series / sizesCount;

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = {
                modelName: item.models?.name,
                colorsList: [colorWithQty],
                totalQty: qty,
                totalPieces: pieces, 
                price: piecePrice,
                totalPrice: item.total_price
            };
        } else {
            groupedItems[modelId].colorsList.push(colorWithQty);
            groupedItems[modelId].totalQty += qty;
            groupedItems[modelId].totalPieces += pieces;
            groupedItems[modelId].totalPrice += item.total_price;
        }
    });

    let itemsHtml = Object.values(groupedItems).map(item => `
        <tr class="border-b border-devo-gray last:border-0">
            <td class="py-3 text-white text-sm font-bold">${item.modelName}</td>
            <td class="py-3 text-devo-info text-xs leading-relaxed max-w-[120px]">${item.colorsList.join('، ')}</td>
            <td class="py-3 text-white font-black text-center">
                <span class="text-lg">${item.totalQty} سيريه</span><br>
                <span class="text-[11px] text-devo-muted font-normal">(${item.totalPieces} قطعة)</span>
            </td>
            <td class="py-3 text-devo-muted text-center">${item.price}</td>
            <td class="py-3 text-devo-orange font-black text-left text-lg">${item.totalPrice}</td>
        </tr>
    `).join('');

    // جلب سجل الحركات بقاعدة البيانات للأوردر
    let logsHtml = '';
    try {
        const { data: logs, error: logsError } = await supabase
            .from('order_logs')
            .select('*')
            .eq('order_id', id)
            .order('created_at', { ascending: false });

        if (logsError) throw logsError;

        if (logs && logs.length > 0) {
            logsHtml = `
                <div class="mt-6 border-t border-devo-gray pt-4">
                    <h5 class="text-xs text-devo-orange font-bold mb-3 flex items-center gap-1.5"><i class="ph ph-clock-counter-clockwise"></i> سجل حركات وتعديلات الأوردر</h5>
                    <div class="space-y-2.5 max-h-[140px] overflow-y-auto custom-scrollbar text-xs">
                        ${logs.map(log => {
                            const logDate = new Date(log.created_at).toLocaleString('ar-EG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                            return `
                                <div class="flex gap-2.5 items-start">
                                    <div class="w-1.5 h-1.5 rounded-full bg-devo-orange mt-1.5 shrink-0 shadow-sm shadow-devo-orange/50"></div>
                                    <div class="flex-1 text-devo-text font-medium">
                                        <span class="font-normal">${log.notes}</span>
                                        <span class="text-[10px] text-devo-muted mr-1.5 font-mono">(${logDate})</span>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        } else {
            logsHtml = `
                <div class="mt-4 border-t border-devo-gray pt-3 text-xs text-devo-muted">
                    <i class="ph ph-info mr-1"></i> لا توجد حركات مسجلة لهذا الأوردر بعد.
                </div>
            `;
        }
    } catch (e) {
        console.error('Error fetching logs:', e);
    }

    document.getElementById('order-details-content').innerHTML = `
        <div class="bg-devo-black p-4 rounded-xl border border-devo-gray mb-6 flex justify-between items-center">
            <div>
                <p class="text-xs text-devo-muted">العميل</p>
                <h4 class="text-white font-bold text-lg">${o.customer_name}</h4>
                <p class="text-sm text-devo-muted" dir="ltr">${o.phone_1}</p>
            </div>
            <div class="text-left">
                <p class="text-xs text-devo-muted">رقم الفاتورة</p>
                <p class="text-devo-orange font-mono font-bold text-lg">${o.invoice_number}</p>
            </div>
        </div>

        <h4 class="text-white font-bold mb-3 border-b border-devo-gray pb-2">المنتجات المختارة</h4>
        <div class="overflow-x-auto">
            <table class="w-full text-right mb-6">
                <thead class="text-xs text-devo-muted bg-devo-black">
                    <tr>
                        <th class="py-2 px-1">الموديل</th>
                        <th class="py-2 px-1">الألوان والكميات</th>
                        <th class="py-2 px-1 text-center">إجمالي الكمية</th>
                        <th class="py-2 px-1 text-center">السعر للقطعة</th>
                        <th class="py-2 px-1 text-left">الإجمالي</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>
        </div>

        <div class="bg-devo-black p-4 rounded-xl border border-devo-gray space-y-2 text-sm">
            <div class="flex justify-between text-devo-muted"><span>الإجمالي الكلي:</span> <span class="text-white font-bold">${o.total_price} ج.م</span></div>
            <div class="flex justify-between text-devo-muted"><span>العربون المدفوع:</span> <span class="text-devo-success font-bold">${o.deposit} ج.م</span></div>
            <div class="flex justify-between border-t border-devo-gray pt-2 mt-2">
                <span class="text-white font-bold">المتبقي للدفع:</span> 
                <span class="text-devo-orange font-black text-lg">${remaining} ج.م</span>
            </div>
        </div>

        <!-- سجل حركات الأوردر -->
        ${logsHtml}
    `;

    const modal = document.getElementById('order-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeOrderDetailsModal = () => {
    const modal = document.getElementById('order-details-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

window.reprintOrder = async (id) => {
    const freshOrder = await fetchFullWorkerOrderById(id);
    const o = freshOrder || allOrders.find(x => x.id === id);
    if (!o) return;
    
    showToast('جاري تجهيز الفاتورة للطباعة...', 'info');

    const mappedItems = o.order_items.map(i => {
        const classSizes = i.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (i.models?.model_sizes?.length || 1);
        return {
            model_id: i.model_id, 
            factory_code: i.models?.factory_code || i.models?.system_code || '', 
            model_name: i.models?.name,
            color_name: i.colors?.name,
            qty: i.quantity,
            pieces: i.quantity * sizesCount,
            price: i.price_per_series / sizesCount,
            total: i.total_price
        };
    });

    if(window.showInvoiceModal) {
        window.showInvoiceModal(o, mappedItems, o.invoice_number);
    }
};

window.toggleArchive = async (id, archiveStatus) => {
    const { error } = await supabase.from('orders').update({ is_archived: archiveStatus }).eq('id', id);
    if (!error) {
        showToast(archiveStatus ? 'تم نقل الأوردر للأرشيف' : 'تم استعادة الأوردر', 'success');
        fetchMyOrders();
    }
};

// 🌟 دالة مساعدة لفك روابط الصور لكي تظهر في السلة بعد التعديل 🌟
function resolveImageUrl(url) {
    if (!url || url.trim() === "" || url === "null" || url === "undefined") return './src/assets/icons/devo.png';
    try {
        if (url.includes('drive.google.com') || url.includes('drive.usercontent.google.com')) {
            const idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w400`;
        }
    } catch (e) {}
    return url; 
}

window.confirmEditOrder = (id) => {
    orderToEdit = allOrders.find(x => x.id === id);
    if (!orderToEdit) return;

    if (orderToEdit.is_locked) {
        return showToast('هذا الأوردر قيد العمل من قبل الإدارة، لا يمكن تعديله!', 'error');
    }

    const modal = document.getElementById('edit-warning-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
};

window.closeEditWarningModal = () => {
    const modal = document.getElementById('edit-warning-modal');
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
    orderToEdit = null;
};

document.getElementById('btn-confirm-edit')?.addEventListener('click', async () => {
    // حفظ نسخة محليّة من الأوردر المختار لتفادي تفريغه أو تعيينه بـ null بسبب أحداث الرادار اللحظية المتزامنة
    const targetOrder = orderToEdit;
    if (!targetOrder) return;

    const btn = document.getElementById('btn-confirm-edit');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="ph ph-spinner animate-spin"></i> جاري التجهيز...`;
    btn.disabled = true;

    // قفل الأوردر بقاعدة البيانات لمنع التعديل المتزامن
    const userName = currentUser?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'موظف';
    const { error } = await supabase.from('orders').update({
        is_locked: true,
        assigned_admin_name: userName
    }).eq('id', targetOrder.id);

    if (error) {
        showToast('فشل قفل الأوردر للتعديل: ' + error.message, 'error');
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    await logOrderAction(targetOrder.id, 'cart_edit_start', `بدأ الموظف ${userName} تعديل الأوردر بالسلة (المعرض)`);

    // 🌟 الإصلاح الجذري لمعادلة الأسعار والصور عند إرسالها للسلة 🌟
    const newCart = targetOrder.order_items.map(item => {
        let imgUrl = './src/assets/icons/devo.png';
        if (item.models?.model_images && item.models.model_images.length > 0) {
            imgUrl = resolveImageUrl(item.models.model_images[0].image_url);
        }
        
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || 1);

        return {
            modelId: item.model_id, 
            factoryCode: item.models?.factory_code || item.models?.system_code || '',
            colorId: item.color_id,
            modelName: item.models?.name, 
            colorName: item.colors?.name,
            price: item.price_per_series / sizesCount, // 🌟 Fix: إرسال سعر القطعة للسلة
            image: imgUrl, 
            qty: item.quantity,
            sizesCount: sizesCount
        };
    });

    localStorage.setItem('devo_cart', JSON.stringify(newCart));
    
    const orderData = {
        id: targetOrder.id,
        invoice_number: targetOrder.invoice_number,
        customer_name: targetOrder.customer_name,
        phone_1: targetOrder.phone_1, phone_2: targetOrder.phone_2,
        address: targetOrder.address, deposit: targetOrder.deposit,
        deposit_receiver: targetOrder.deposit_receiver, notes: targetOrder.notes,
        original_items: targetOrder.order_items // 🌟 السطر السحري: تمرير ما يملكه الأوردر للسلة 🌟
    };
    localStorage.setItem('devo_edit_order_data', JSON.stringify(orderData));
    
    btn.innerHTML = originalText;
    btn.disabled = false;
    
    // إغلاق مودال التنبيه وتصفير المتغير العام بعد انتهاء العمليات بأمان
    closeEditWarningModal();
    showToast('تم تحميل بيانات الأوردر للسلة لتعديله', 'info');

    if (window.refreshCartView) window.refreshCartView();
    window.switchSiteView('view-cart');
});

window.refreshOrders = fetchMyOrders;

// --- Custom Sort Handler ---
window.customSortHandlers = window.customSortHandlers || {};
window.customSortHandlers['customer-orders-table'] = (colIndex, direction) => {
    allOrders.sort((a, b) => {
        let valA, valB;
        switch (colIndex) {
            case 0: // رقم الأوردر
                valA = a.invoice_number || '';
                valB = b.invoice_number || '';
                break;
            case 1: // اسم العميل
                valA = a.customer_name || '';
                valB = b.customer_name || '';
                break;
            case 2: // الموديلات
                valA = a.order_items?.length || 0;
                valB = b.order_items?.length || 0;
                break;
            case 3: // التاريخ
                valA = new Date(a.created_at);
                valB = new Date(b.created_at);
                break;
            case 4: // الحالة
                valA = a.status || '';
                valB = b.status || '';
                break;
            default:
                return 0;
        }

        if (typeof valA === 'string') {
            return direction === 'asc' ? valA.localeCompare(valB, 'ar') : valB.localeCompare(valA, 'ar');
        } else {
            return direction === 'asc' ? valA - valB : valB - valA;
        }
    });

    renderOrders();
};

// دالة لتسجيل حركات وتعديلات الأوردرات بسجل الملاحظات (للموظفين)
async function logOrderAction(orderId, actionType, notes) {
    try {
        const userId = currentUser?.id || null;
        const userName = currentUser?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'موظف';
        
        const { error } = await supabase.from('order_logs').insert([{
            order_id: orderId,
            user_id: userId,
            user_name: userName,
            action_type: actionType,
            notes: notes
        }]);
        if (error) {
            console.error('Database error inserting order log:', error);
        }
    } catch (err) {
        console.error('Error logging order action:', err);
    }
}