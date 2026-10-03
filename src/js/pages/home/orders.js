import { supabase } from '../../config/supabase.js';
import { getCurrentSession } from '../../services/auth.js';
import { showToast } from '../../components/toast.js';
import { confirmDialog } from '../../components/modal.js';
import { 
    fetchUserWaitingOrders, 
    deleteWaitingOrderById, 
    convertWaitingOrderToPermanent, 
    parseWaitingOrderMeta 
} from '../../services/waiting_orders.js';
import { printHtmlInIframe } from '../../utils/print.js';

let currentUser = null;
let allOrders = [];
let allWaitingOrders = [];
let currentTab = 'active'; 
let orderToEdit = null;

export async function initOrdersView() {
    const { session } = getCurrentSession();
    currentUser = session ? session.user : null;
    
    if (!currentUser) return;

    ['ord-search', 'ord-status', 'ord-date-from', 'ord-date-to'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', renderOrders);
    });

    try {
        const savedTab = localStorage.getItem('devo_active_orders_tab') || 'active';
        if (savedTab && savedTab !== currentTab) {
            window.switchOrdersTab(savedTab);
        }
    } catch (e) {}

    await Promise.all([
        fetchMyOrders(),
        fetchMyWaitingOrders()
    ]);
    setupOrdersRealtime(); // 🌟 تفعيل الرادار اللحظي للموظف 🌟
}

export async function refreshWorkerOrders() {
    if (!currentUser) return;
    await Promise.all([
        fetchMyOrders(),
        fetchMyWaitingOrders()
    ]);
    renderOrders();
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
                        id,
                        name, 
                        factory_code,
                        system_code,
                        price,
                        class_id,
                        model_images(image_url),
                        model_sizes(size_id),
                        classes(id, name, class_sizes(size_id))
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
    if (!currentUser || !currentUser.id) return;

    supabase.channel(`worker_orders_sync_${currentUser.id}`)
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

    // 🌟 رادار لحظي لمزامنة فواتير الانتظار الخاصة بالموظف 🌟
    supabase.channel(`worker_waiting_radar_${currentUser.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'visitor_orders' }, async () => {
            await fetchMyWaitingOrders();
            if (currentTab === 'waiting') {
                renderOrders();
            }
        })
        .subscribe();
}

window.switchOrdersTab = (tab) => {
    currentTab = tab;
    try {
        localStorage.setItem('devo_active_orders_tab', tab);
    } catch (e) {}

    const activeTabEl = document.getElementById('tab-orders-active');
    const waitingTabEl = document.getElementById('tab-orders-waiting');
    const archivedTabEl = document.getElementById('tab-orders-archived');

    const activeClasses = 'px-3 py-1.5 text-xs sm:text-sm font-bold text-devo-orange border-b-2 border-devo-orange transition-all flex items-center gap-1.5';
    const inactiveClasses = 'px-3 py-1.5 text-xs sm:text-sm font-bold text-devo-muted hover:text-white border-b-2 border-transparent transition-all flex items-center gap-1.5';

    if (activeTabEl) activeTabEl.className = tab === 'active' ? activeClasses : inactiveClasses;
    if (waitingTabEl) waitingTabEl.className = tab === 'waiting' ? activeClasses : inactiveClasses;
    if (archivedTabEl) archivedTabEl.className = tab === 'archived' ? activeClasses : inactiveClasses;

    // تحديث خيارات فلتر الحالة
    const statusSelect = document.getElementById('ord-status');
    if (statusSelect) {
        if (tab === 'waiting') {
            statusSelect.innerHTML = `
                <option value="">كل الحالات</option>
                <option value="pending">في قائمة الانتظار (معلقة)</option>
                <option value="approved">معتمدة (محولة لأوردرات)</option>
                <option value="rejected">مرفوضة</option>
            `;
        } else {
            statusSelect.innerHTML = `
                <option value="">كل الحالات</option>
                <option value="created">تم إنشاء الأوردر</option>
                <option value="in_progress">جاري العمل</option>
                <option value="editing">جاري التعديل</option>
                <option value="registered">تم التسجيل على السيستم</option>
                <option value="preparing">جاري تجهيز الأوردر</option>
                <option value="shipped">تم الشحن</option>
                <option value="delivered">تم التسليم</option>
            `;
        }
    }

    renderOrders();
};

async function fetchMyOrders() {
    const tBody = document.getElementById('orders-table-body');
    if(tBody) tBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center"><i class="ph ph-spinner animate-spin text-3xl text-devo-orange"></i> جاري التحميل...</td></tr>`;

    if (!currentUser || !currentUser.id) {
        if(tBody) tBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-devo-muted">يرجى تسجيل الدخول لعرض الأوردرات</td></tr>`;
        return;
    }

    // 🌟 صفحة أوردراتي في الموقع الرئيسي تقتصر حصرياً على أوردرات صاحب الحساب نفسه 🌟
    // تظهر فقط الأوردرات التي أنشأها المستخدم بنفسه (worker_id) أو المسندة إليه للتعديل (assigned_worker_id)
    const { data, error } = await supabase
        .from('orders')
        .select(`
            *,
            order_items (
                *,
                models (
                    id,
                    name, 
                    factory_code,
                    system_code,
                    price,
                    class_id,
                    model_images(image_url),
                    model_sizes(size_id),
                    classes(id, name, class_sizes(size_id))
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

    allOrders = data || [];
    renderOrders();
}

const statusConfig = {
    'created': { text: 'تم إنشاء الأوردر', color: 'bg-devo-gray text-white border-devo-gray' },
    'in_progress': { text: 'جاري العمل', color: 'bg-devo-orange/20 text-devo-orange border-devo-orange/50' },
    'editing': { text: 'جاري التعديل', color: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
    'registered': { text: 'تم التسجيل', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
    'preparing': { text: 'جاري التجهيز', color: 'bg-purple-500/20 text-purple-400 border-purple-500/50' },
    'shipped': { text: 'تم الشحن', color: 'bg-green-500/20 text-green-400 border-green-500/50' },
    'delivered': { text: 'تم التسليم', color: 'bg-devo-success/20 text-devo-success border-devo-success/50' }
};

function renderOrders() {
    const term = document.getElementById('ord-search')?.value.toLowerCase().trim() || '';
    const statusFilter = document.getElementById('ord-status')?.value || '';
    const dateFrom = document.getElementById('ord-date-from')?.value;
    const dateTo = document.getElementById('ord-date-to')?.value;

    if (currentTab === 'waiting') {
        renderWaitingOrders(term, statusFilter, dateFrom, dateTo);
        return;
    }

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
        const isRegistered = o.status === 'registered';
        const myName = currentUser?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'موظف';
        const isEditingByMe = o.status === 'editing' && o.assigned_admin_name === myName;
        const isEditable = (o.status === 'created' || isEditingByMe) && (!o.is_locked || isEditingByMe);
        const lockTitle = isRegistered 
            ? 'تم تسجيل هذا الأوردر ولا يمكن تعديله نهائياً' 
            : (o.is_locked ? `الأوردر قيد التعديل بواسطة (${o.assigned_admin_name || 'مستخدم آخر'})` : 'يجب أن يكون الأوردر بحالة تم إنشاء الأوردر لتعديله');

        let actionButtons = `
            <div class="flex items-center justify-center gap-1.5 flex-wrap">
                <button onclick="viewOrderDetails('${o.id}')" class="p-2 bg-devo-black border border-devo-gray hover:bg-devo-gray rounded text-white transition-colors cursor-pointer" title="عرض"><i class="ph ph-eye"></i></button>
                <button onclick="reprintOrder('${o.id}')" class="p-2 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded transition-colors cursor-pointer" title="طباعة"><i class="ph ph-printer"></i></button>
                <button onclick="duplicateOrderToCart('${o.id}')" class="p-2 bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500 hover:text-white rounded transition-colors cursor-pointer" title="نسخ الأصناف للسلة كفاتورة جديدة"><i class="ph ph-copy"></i></button>
                ${isEditable 
                    ? `<button onclick="confirmEditOrder('${o.id}')" class="p-2 bg-devo-orange/10 text-devo-orange hover:bg-devo-orange hover:text-white rounded transition-colors cursor-pointer" title="تعديل الأوردر"><i class="ph ph-pencil-simple"></i></button>` 
                    : `<button disabled class="p-2 bg-devo-gray/20 text-devo-muted rounded cursor-not-allowed" title="${lockTitle}"><i class="ph ph-lock text-devo-muted"></i></button>`
                }
                <button onclick="toggleArchive('${o.id}', ${!o.is_archived})" class="p-2 bg-devo-black border border-devo-gray hover:border-devo-orange rounded text-devo-muted hover:text-white transition-colors cursor-pointer" title="${o.is_archived ? 'استعادة' : 'أرشفة'}"><i class="ph ${o.is_archived ? 'ph-tray-arrow-up' : 'ph-archive'}"></i></button>
            </div>
        `;

        let cardActionButtons = `
            <div class="grid grid-cols-5 gap-1 pt-2 border-t border-devo-gray/60 mt-3">
                <button onclick="viewOrderDetails('${o.id}')" class="h-9 bg-devo-black border border-devo-gray hover:bg-devo-gray rounded-lg text-white text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="عرض الفاتورة"><i class="ph ph-eye text-sm"></i> <span class="hidden sm:inline">عرض</span></button>
                <button onclick="reprintOrder('${o.id}')" class="h-9 bg-devo-info/10 text-devo-info hover:bg-devo-info hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="طباعة"><i class="ph ph-printer text-sm"></i> <span class="hidden sm:inline">طباعة</span></button>
                <button onclick="duplicateOrderToCart('${o.id}')" class="h-9 bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500 hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="نسخ للسلة"><i class="ph ph-copy text-sm"></i> <span class="hidden sm:inline">نسخ</span></button>
                ${isEditable 
                    ? `<button onclick="confirmEditOrder('${o.id}')" class="h-9 bg-devo-orange/10 text-devo-orange hover:bg-devo-orange hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="تعديل"><i class="ph ph-pencil-simple text-sm"></i> <span class="hidden sm:inline">تعديل</span></button>` 
                    : `<button disabled class="h-9 bg-devo-gray/20 text-devo-muted rounded-lg text-xs font-medium flex items-center justify-center gap-1 opacity-50 cursor-not-allowed" title="${lockTitle}"><i class="ph ph-lock text-sm"></i> <span class="hidden sm:inline">مقفل</span></button>`
                }
                <button onclick="toggleArchive('${o.id}', ${!o.is_archived})" class="h-9 bg-devo-black border border-devo-gray text-devo-muted hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="${o.is_archived ? 'استعادة' : 'أرشفة'}"><i class="ph ${o.is_archived ? 'ph-tray-arrow-up' : 'ph-archive'} text-sm"></i> <span class="hidden sm:inline">${o.is_archived ? 'استعادة' : 'أرشيف'}</span></button>
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

        const factoryCode = item.models?.factory_code || item.models?.system_code || '';

        const piecePrice = item.price_per_series / sizesCount;

        if (!groupedItems[modelId]) {
            groupedItems[modelId] = {
                modelName: item.models?.name,
                factoryCode: factoryCode,
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

    let totalSeries = 0;
    let totalPieces = 0;
    Object.values(groupedItems).forEach(g => {
        totalSeries += g.totalQty;
        totalPieces += g.totalPieces;
    });

    let itemsHtml = Object.values(groupedItems).map(item => `
        <tr class="border-b border-devo-gray last:border-0">
            <td class="py-3">
                <div class="text-white text-sm font-bold">${item.modelName}</div>
                ${item.factoryCode ? `<div class="text-[11px] text-devo-orange font-mono font-bold mt-0.5">كود: ${item.factoryCode}</div>` : ''}
            </td>
            <td class="py-3 text-devo-info text-xs leading-relaxed max-w-[120px]">${item.colorsList.join('، ')}</td>
            <td class="py-3 text-white font-black text-center">
                <span class="text-lg">${item.totalQty}</span><br>
                <span class="text-[11px] text-devo-muted font-normal">(${item.totalPieces} قطعة)</span>
            </td>
            <td class="py-3 text-devo-muted text-center font-mono">${item.price}</td>
            <td class="py-3 text-devo-orange font-black text-left text-lg font-mono">${item.totalPrice}</td>
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
        <div class="bg-devo-black p-4 rounded-xl border border-devo-gray mb-6 flex justify-between items-center flex-wrap gap-3">
            <div>
                <p class="text-xs text-devo-muted">العميل</p>
                <h4 class="text-white font-bold text-lg">${o.customer_name}</h4>
                <p class="text-sm text-devo-muted" dir="ltr">${o.phone_1}</p>
            </div>
            <div class="flex items-center gap-3">
                <button onclick="closeOrderDetailsModal(); duplicateOrderToCart('${o.id}')" class="px-3.5 py-2 bg-cyan-500/15 text-cyan-400 hover:bg-cyan-500 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer" title="نسخ الأصناف للسلة كفاتورة جديدة">
                    <i class="ph ph-copy text-base"></i> نسخ كأوردر جديد
                </button>
                <div class="text-left">
                    <p class="text-xs text-devo-muted">رقم الفاتورة</p>
                    <p class="text-devo-orange font-mono font-bold text-lg">${o.invoice_number}</p>
                </div>
            </div>
        </div>

        <h4 class="text-white font-bold mb-3 border-b border-devo-gray pb-2">المنتجات المختارة</h4>
        <div class="overflow-x-auto">
            <table class="w-full text-right mb-6">
                <thead class="text-xs text-devo-muted bg-devo-black">
                    <tr>
                        <th class="py-2 px-1">الموديل</th>
                        <th class="py-2 px-1">الألوان والكميات</th>
                        <th class="py-2 px-1 text-center">الكمية (سيريه / ق)</th>
                        <th class="py-2 px-1 text-center">السعر للقطعة</th>
                        <th class="py-2 px-1 text-left">الإجمالي</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>
        </div>

        <div class="bg-devo-black p-4 rounded-xl border border-devo-gray space-y-2 text-sm">
            <div class="flex justify-between text-devo-muted"><span>إجمالي الأصناف:</span> <span class="text-white font-bold">${Object.keys(groupedItems).length} صنف</span></div>
            <div class="flex justify-between text-devo-muted"><span>إجمالي السريات:</span> <span class="text-white font-bold">${totalSeries} سيريه</span></div>
            <div class="flex justify-between text-devo-muted"><span>إجمالي القطع:</span> <span class="text-white font-bold">${totalPieces.toLocaleString()} قطعة</span></div>
            <div class="flex justify-between text-devo-muted border-t border-devo-gray/60 pt-2"><span>الإجمالي الكلي:</span> <span class="text-white font-bold font-mono">${Number(o.total_price || 0).toLocaleString()} ج.م</span></div>
            <div class="flex justify-between text-devo-muted"><span>العربون المدفوع:</span> <span class="text-devo-success font-bold font-mono">${Number(o.deposit || 0).toLocaleString()} ج.م</span></div>
            <div class="flex justify-between border-t border-devo-gray pt-2 mt-2">
                <span class="text-white font-bold">المتبقي للدفع:</span> 
                <span class="text-devo-orange font-black text-lg font-mono">${Number(remaining || 0).toLocaleString()} ج.م</span>
            </div>
        </div>

        <!-- سجل حركات الأوردر -->
        ${logsHtml}
    `;

    const modal = document.getElementById('order-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    history.pushState({ modalId: 'order-details-modal' }, '', window.location.href);
};

window.closeOrderDetailsModal = (skipHistory = false) => {
    const modal = document.getElementById('order-details-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('opacity-0');
    if (!skipHistory && history.state && history.state.modalId === 'order-details-modal') {
        history.back();
    }
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
    const o = allOrders.find(x => x.id === id);
    if (!o) return;

    const previousStatus = o.is_archived;
    // Optimistic update
    o.is_archived = archiveStatus;
    renderOrders();

    let updateError = null;
    try {
        // محاولة تنفيذ الدالة السحابية المركزية
        const { error: rpcError } = await supabase.rpc('toggle_order_archive', {
            p_order_id: id,
            p_archive_status: archiveStatus
        });

        if (rpcError) {
            console.warn('Worker RPC toggle_order_archive fallback to direct update:', rpcError);
            const { error: directError } = await supabase.from('orders').update({ is_archived: archiveStatus }).eq('id', id);
            if (directError) updateError = directError;
        }
    } catch (err) {
        updateError = err;
    }

    if (updateError) {
        console.error('Error toggling worker order archive:', updateError);
        o.is_archived = previousStatus;
        renderOrders();
        showToast('فشل تعديل حالة الأرشفة: ' + (updateError.message || updateError), 'error');
    } else {
        showToast(archiveStatus ? 'تم نقل الأوردر للأرشيف' : 'تم استعادة الأوردر من الأرشيف', 'success');
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

    if (orderToEdit.status === 'registered') {
        return showToast('عفواً، لا يمكن تعديل هذا الأوردر لأنه في حالة تم التسجيل!', 'error');
    }

    const myName = currentUser?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'موظف';
    if (orderToEdit.is_locked && orderToEdit.assigned_admin_name && orderToEdit.assigned_admin_name !== myName) {
        return showToast(`هذا الأوردر مقفول حالياً للتعديل بواسطة (${orderToEdit.assigned_admin_name})!`, 'error');
    }

    const modal = document.getElementById('edit-warning-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    history.pushState({ modalId: 'edit-warning-modal' }, '', window.location.href);
};

window.closeEditWarningModal = (skipHistory = false) => {
    const modal = document.getElementById('edit-warning-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('opacity-0');
    if (!skipHistory && history.state && history.state.modalId === 'edit-warning-modal') {
        history.back();
    }
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

    // قفل الأوردر بقاعدة البيانات لمنع التعديل المتزامن وتغيير الحالة إلى جاري التعديل
    const userName = currentUser?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'موظف';
    const { error } = await supabase.rpc('acquire_order_lock', {
        p_order_id: targetOrder.id,
        p_assigned_admin_name: userName
    });

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
        deposit_receiver: targetOrder.deposit_receiver,
        deposit_payment_method: targetOrder.deposit_payment_method || 'نقدي',
        notes: targetOrder.notes,
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

// ==========================================
// 🌟 نسخ الأوردر إلى السلة لإنشاء فاتورة جديدة (Showroom Duplicate) 🌟
// ==========================================
window.duplicateOrderToCart = (id) => {
    const targetOrder = allOrders.find(x => x.id === id);
    if (!targetOrder) return;

    const newCart = (targetOrder.order_items || []).map(item => {
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
            price: item.price_per_series / sizesCount,
            image: imgUrl, 
            qty: item.quantity,
            sizesCount: sizesCount
        };
    });

    localStorage.setItem('devo_cart', JSON.stringify(newCart));
    // حذف أي بيانات ربط تعديل حتى تتعامل السلة مع الطلب كأوردر جديد تماماً
    localStorage.removeItem('devo_edit_order_data');

    showToast(`تم نسخ أصناف الأوردر #${targetOrder.invoice_number} إلى السلة لإنشاء فاتورة جديدة!`, 'success');

    if (window.refreshCartView) window.refreshCartView();
    window.switchSiteView('view-cart');
};

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

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// =========================================================================
// 🌟 إدارة فواتير الانتظار (عرض، استكمال، تأكيد مباشر، حذف، طباعة) 🌟
// =========================================================================

async function fetchMyWaitingOrders() {
    if (!currentUser || !currentUser.id) return;
    try {
        const isAdmin = currentUser?.role === 'admin' || currentUser?.user_metadata?.role === 'admin' || window.isAdmin === true;
        allWaitingOrders = await fetchUserWaitingOrders(currentUser, isAdmin);
        updateWaitingOrdersBadge();
    } catch (e) {
        console.error('[Orders] Error fetching waiting orders:', e);
    }
}

function updateWaitingOrdersBadge() {
    const badge = document.getElementById('badge-waiting-orders-count');
    if (!badge) return;
    const pendingCount = allWaitingOrders.filter(o => o.status === 'pending').length;
    if (pendingCount > 0) {
        badge.textContent = pendingCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function renderWaitingOrders(term, statusFilter, dateFrom, dateTo) {
    const filtered = allWaitingOrders.filter(vo => {
        if (term) {
            const shortId = (vo.id || '').split('-')[0].toUpperCase();
            const matchesId = shortId.includes(term.toUpperCase()) || (vo.id || '').toLowerCase().includes(term);
            const matchesCust = (vo.customer_name || '').toLowerCase().includes(term);
            const matchesPhone = (vo.phone_1 || '').includes(term) || (vo.phone_2 || '').includes(term);
            const matchesNotes = (vo.notes || '').toLowerCase().includes(term);
            if (!matchesId && !matchesCust && !matchesPhone && !matchesNotes) return false;
        }

        if (statusFilter && vo.status !== statusFilter) return false;

        if (dateFrom || dateTo) {
            const oDate = new Date(vo.created_at);
            oDate.setHours(0,0,0,0);
            if (dateFrom && oDate < new Date(dateFrom)) return false;
            if (dateTo && oDate > new Date(dateTo)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('orders-table-body');
    const cardsBody = document.getElementById('orders-cards-body');

    if (filtered.length === 0) {
        const emptyMsg = `
            <div class="p-12 text-center text-devo-muted space-y-2">
                <i class="ph ph-clock-countdown text-5xl mb-1 text-amber-400/50 block"></i>
                <h4 class="text-base font-bold text-white">لا توجد فواتير انتظار</h4>
                <p class="text-xs text-devo-muted max-w-sm mx-auto leading-relaxed">
                    يمكنك حفظ أي فاتورة من السلة في قائمة الانتظار بدون خصم أي كميات من المخزن للرجوع إليها واستكمالها أو تأكيدها لاحقاً.
                </p>
                <div class="pt-2">
                    <button onclick="switchSiteView('view-cart')" class="bg-amber-500/20 hover:bg-amber-500 hover:text-black text-amber-300 border border-amber-500/40 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer">
                        الذهاب للسلة
                    </button>
                </div>
            </div>
        `;
        if (tbody) tbody.innerHTML = `<tr><td colspan="6">${emptyMsg}</td></tr>`;
        if (cardsBody) cardsBody.innerHTML = emptyMsg;
        return;
    }

    if (tbody) tbody.innerHTML = '';
    if (cardsBody) cardsBody.innerHTML = '';

    filtered.forEach(vo => {
        const shortId = (vo.id || '').split('-')[0].toUpperCase();
        const dateStr = new Date(vo.created_at).toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const itemsCount = vo.visitor_order_items?.length || 0;
        const isPending = vo.status === 'pending';
        const isApproved = vo.status === 'approved';
        const isRejected = vo.status === 'rejected' || vo.status === 'ignored';

        let statusBadge = '';
        if (isPending) {
            statusBadge = '<span class="bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs px-2.5 py-1 rounded-full font-bold inline-flex items-center gap-1"><i class="ph ph-clock"></i> في الانتظار (معلقة)</span>';
        } else if (isApproved) {
            statusBadge = '<span class="bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-xs px-2.5 py-1 rounded-full font-bold inline-flex items-center gap-1"><i class="ph ph-check-circle"></i> معتمدة ومحولة</span>';
        } else if (isRejected) {
            statusBadge = '<span class="bg-rose-500/20 text-rose-400 border border-rose-500/40 text-xs px-2.5 py-1 rounded-full font-bold inline-flex items-center gap-1"><i class="ph ph-x-circle"></i> مرفوضة</span>';
        } else {
            statusBadge = `<span class="bg-devo-gray/40 text-devo-muted border border-devo-gray text-xs px-2.5 py-1 rounded-full font-bold">${vo.status}</span>`;
        }

        const actionsHtml = `
            <div class="flex items-center justify-center gap-1.5 flex-wrap">
                <!-- 1. عرض التفاصيل -->
                <button onclick="viewWaitingOrderDetails('${vo.id}')" class="p-2 bg-devo-black border border-devo-gray hover:bg-devo-gray rounded text-white transition-colors cursor-pointer" title="عرض تفاصيل الفاتورة"><i class="ph ph-eye"></i></button>
                
                <!-- 2. طباعة مسودة -->
                <button onclick="printWaitingOrderInvoice('${vo.id}')" class="p-2 bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white rounded transition-colors cursor-pointer" title="طباعة مسودة / عرض أسعار"><i class="ph ph-printer"></i></button>

                ${isPending ? `
                    <!-- 3. استكمال وتعديل بالسلة -->
                    <button onclick="resumeWaitingOrderToCart('${vo.id}')" class="p-2 bg-amber-500/15 text-amber-400 hover:bg-amber-500 hover:text-black rounded transition-colors cursor-pointer" title="استكمال وتعديل الفاتورة في السلة"><i class="ph ph-pencil-simple"></i></button>

                    <!-- 4. تأكيد وإصدار الفاتورة الأساسية -->
                    <button onclick="confirmWaitingOrderDirectly('${vo.id}')" class="p-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded transition-colors cursor-pointer" title="تأكيد واعتماد الفاتورة كأوردر أساسي وخصم المخزون"><i class="ph ph-check-circle"></i></button>

                    <!-- 5. حذف المسودة -->
                    <button onclick="deleteWaitingOrderPrompt('${vo.id}')" class="p-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded transition-colors cursor-pointer" title="حذف الفاتورة من الانتظار"><i class="ph ph-trash"></i></button>
                ` : ''}
            </div>
        `;

        const cardActionsHtml = `
            <div class="grid grid-cols-${isPending ? '5' : '2'} gap-1 pt-2 border-t border-devo-gray/60 mt-3">
                <button onclick="viewWaitingOrderDetails('${vo.id}')" class="h-9 bg-devo-black border border-devo-gray hover:bg-devo-gray rounded-lg text-white text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="عرض"><i class="ph ph-eye text-sm"></i> <span class="hidden sm:inline">عرض</span></button>
                <button onclick="printWaitingOrderInvoice('${vo.id}')" class="h-9 bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="طباعة"><i class="ph ph-printer text-sm"></i> <span class="hidden sm:inline">طباعة</span></button>
                ${isPending ? `
                    <button onclick="resumeWaitingOrderToCart('${vo.id}')" class="h-9 bg-amber-500/15 text-amber-400 hover:bg-amber-500 hover:text-black rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="استكمال بالسلة"><i class="ph ph-pencil-simple text-sm"></i> <span class="hidden sm:inline">استكمال</span></button>
                    <button onclick="confirmWaitingOrderDirectly('${vo.id}')" class="h-9 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="تأكيد كفاتورة أساسية"><i class="ph ph-check-circle text-sm"></i> <span class="hidden sm:inline">تأكيد</span></button>
                    <button onclick="deleteWaitingOrderPrompt('${vo.id}')" class="h-9 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer" title="حذف"><i class="ph ph-trash text-sm"></i> <span class="hidden sm:inline">حذف</span></button>
                ` : ''}
            </div>
        `;

        if (tbody) {
            tbody.innerHTML += `
                <tr class="hover:bg-devo-black/40 transition-colors">
                    <td class="p-4 font-mono text-amber-400 font-bold text-xs">
                        #${shortId}
                        <span class="block text-[10px] text-amber-400/70 font-sans font-normal">فاتورة انتظار</span>
                    </td>
                    <td class="p-4">
                        <div class="font-bold text-white">${vo.customer_name}</div>
                        <div class="text-[11px] text-devo-muted font-mono" dir="ltr">${vo.phone_1}${vo.phone_2 ? ' / ' + vo.phone_2 : ''}</div>
                        ${vo.address ? `<div class="text-[11px] text-devo-muted/80 truncate max-w-[200px]">${vo.address}</div>` : ''}
                    </td>
                    <td class="p-4 text-devo-muted">
                        <div><span class="font-bold text-white">${vo.total_series}</span> سيريه <span class="text-xs text-devo-muted">(${itemsCount} صنف)</span></div>
                        <div class="text-[11px] text-devo-orange font-bold font-mono">${(Number(vo.total_price) || 0).toLocaleString()} ج.م</div>
                        ${vo.meta?.deposit ? `<div class="text-[10px] text-emerald-400 font-bold">عربون: ${vo.meta.deposit} ج.م</div>` : ''}
                    </td>
                    <td class="p-4 text-devo-muted text-xs">${dateStr}</td>
                    <td class="p-4">${statusBadge}</td>
                    <td class="p-4">${actionsHtml}</td>
                </tr>
            `;
        }

        if (cardsBody) {
            cardsBody.innerHTML += `
                <div class="bg-devo-dark border border-devo-gray p-3.5 rounded-xl shadow-sm relative space-y-2.5">
                    <div class="flex justify-between items-center border-b border-devo-gray/60 pb-2.5">
                        <div class="flex items-center gap-1.5">
                            <span class="bg-amber-500/15 text-amber-400 px-2.5 py-0.5 rounded-md font-mono font-bold text-xs border border-amber-500/30">#${shortId}</span>
                            <span class="text-[10px] text-amber-400 font-bold">فاتورة انتظار</span>
                        </div>
                        ${statusBadge}
                    </div>

                    <div class="flex justify-between items-start pt-0.5">
                        <div>
                            <h4 class="font-bold text-white text-sm">${vo.customer_name}</h4>
                            <p class="text-[11px] text-devo-muted font-mono mt-0.5" dir="ltr">${vo.phone_1}</p>
                            ${vo.address ? `<p class="text-[11px] text-devo-muted/80 mt-0.5">${vo.address}</p>` : ''}
                        </div>
                        <div class="text-left">
                            <div class="text-devo-orange font-black text-sm">${(Number(vo.total_price) || 0).toLocaleString()} ج.م</div>
                            <div class="text-[10px] text-devo-muted">${vo.total_series} سيريه (${itemsCount} صنف)</div>
                            ${vo.meta?.deposit ? `<div class="text-[10px] text-emerald-400 font-bold">عربون: ${vo.meta.deposit} ج.م</div>` : ''}
                        </div>
                    </div>

                    <div class="flex justify-between items-center text-[10px] text-devo-muted pt-1">
                        <span><i class="ph ph-calendar-blank"></i> ${dateStr}</span>
                    </div>

                    ${cardActionsHtml}
                </div>
            `;
        }
    });
}

// 🌟 استكمال وتعديل فاتورة الانتظار في السلة 🌟
window.resumeWaitingOrderToCart = async (id) => {
    const vo = allWaitingOrders.find(x => String(x.id) === String(id));
    if (!vo) return showToast('تعذر العثور على الفاتورة', 'error');

    const existingCart = JSON.parse(localStorage.getItem('devo_cart') || '[]');
    if (existingCart.length > 0) {
        const ok = await confirmDialog({
            title: 'استكمال فاتورة الانتظار',
            message: 'يوجد موديلات حالياً في السلة. سيتم استبدال محتويات السلة بأصناف فاتورة الانتظار هذه لمتابعتها.\nهل تريد الاستمرار؟',
            confirmText: 'نعم، استكمل الفاتورة',
            cancelText: 'إلغاء'
        });
        if (!ok) return;
    }

    const items = vo.visitor_order_items || [];
    const newCart = items.map(item => {
        let imgUrl = './src/assets/icons/devo.png';
        if (item.models?.model_images && item.models.model_images.length > 0) {
            imgUrl = resolveImageUrl(item.models.model_images[0].image_url);
        }
        const classSizes = item.models?.classes?.class_sizes || [];
        const sizesCount = classSizes.length > 0 ? classSizes.length : (item.models?.model_sizes?.length || (item.sizes_count > 1 ? Number(item.sizes_count) : 1));
        const piecePrice = sizesCount > 0 ? (Number(item.price_per_series) / sizesCount) : Number(item.price_per_series);

        return {
            modelId: item.model_id,
            factoryCode: item.models?.factory_code || item.models?.system_code || item.factory_code || '',
            colorId: item.color_id,
            modelName: item.model_name || item.models?.name,
            colorName: item.color_name || item.colors?.name,
            price: piecePrice,
            image: imgUrl,
            qty: Number(item.quantity) || 1,
            sizesCount: sizesCount
        };
    });

    const meta = vo.meta || parseWaitingOrderMeta(vo.notes, vo);

    const editData = {
        id: vo.id,
        short_id: (vo.id || '').split('-')[0].toUpperCase(),
        customer_name: vo.customer_name || '',
        phone_1: vo.phone_1 || '',
        phone_2: vo.phone_2 || '',
        address: vo.address || '',
        notes: meta.cleanNotes || '',
        deposit: meta.deposit || 0,
        deposit_receiver: meta.deposit_receiver || '',
        deposit_payment_method: meta.deposit_payment_method || 'نقدي'
    };

    localStorage.setItem('devo_cart', JSON.stringify(newCart));
    localStorage.setItem('devo_edit_waiting_order_data', JSON.stringify(editData));
    localStorage.removeItem('devo_edit_order_data');
    localStorage.removeItem('devo_edit_order_data_cache');

    showToast(`تم تحميل أصناف فاتورة الانتظار (#${editData.short_id}) إلى السلة بنجاح!`, 'success');

    if (window.refreshCartView) window.refreshCartView();
    if (window.switchSiteView) window.switchSiteView('view-cart');
};

// 🌟 تأكيد وإصدار الفاتورة الأساسية مباشرة من قائمة الانتظار 🌟
window.confirmWaitingOrderDirectly = async (id) => {
    const vo = allWaitingOrders.find(x => String(x.id) === String(id));
    if (!vo) return showToast('تعذر العثور على الفاتورة', 'error');

    const shortCode = (vo.id || '').split('-')[0].toUpperCase();

    const confirmed = await confirmDialog({
        title: 'تأكيد وإصدار الفاتورة الأساسية',
        message: `هل أنت متأكد من تأكيد وإصدار الفاتورة رقم (#${shortCode}) للعميل (${vo.customer_name}) كفاتورة أساسية معتمدة؟\nسيتم التحقق من المخزون وخصم الكميات فوراً وإصدار رقم الفاتورة النهائي.`,
        confirmText: 'نعم، تأكيد وإصدار الفاتورة',
        cancelText: 'إلغاء'
    });

    if (!confirmed) return;

    showToast('جاري التحقق من المخزون وإصدار الفاتورة...', 'info');

    try {
        const result = await convertWaitingOrderToPermanent({
            waitingOrder: vo,
            currentUser
        });

        if (!result.success) {
            showToast('لا يمكن الاعتماد لوجود نقص في المخزن: ' + result.errors[0], 'error');
            return;
        }

        showToast(`🎉 تم اعتماد وإصدار الفاتورة رقم #${result.invoiceNumber} بنجاح وخصم المخزون!`, 'success');

        await fetchMyOrders();
        await fetchMyWaitingOrders();
        renderOrders();

        if (window.showInvoiceModal) {
            window.showInvoiceModal({
                id: result.orderId,
                invoice_number: result.invoiceNumber,
                ...result.orderData
            }, result.orderItemsData);
        }

    } catch (err) {
        console.error('[Orders] Direct confirmation error:', err);
        showToast('فشل تأكيد الفاتورة: ' + (err.message || 'خطأ غير معروف'), 'error');
    }
};

// 🌟 حذف مسودة الانتظار 🌟
window.deleteWaitingOrderPrompt = async (id) => {
    const vo = allWaitingOrders.find(x => String(x.id) === String(id));
    const shortCode = (vo?.id || id).split('-')[0].toUpperCase();
    const custName = vo?.customer_name || 'هذه الفاتورة';

    const ok = await confirmDialog({
        title: 'حذف مسودة الانتظار',
        message: `هل أنت متأكد من رغبتك في حذف مسودة الفاتورة (#${shortCode}) الخاصة بـ (${custName}) من قائمة الانتظار نهائياً؟`,
        isDestructive: true,
        confirmText: 'نعم، احذف',
        cancelText: 'إلغاء'
    });

    if (ok) {
        try {
            await deleteWaitingOrderById(id);
            showToast(`تم حذف المسودة (#${shortCode}) من قائمة الانتظار`, 'success');
            await fetchMyWaitingOrders();
            renderOrders();
        } catch (err) {
            console.error('Delete waiting order error:', err);
            showToast('حدث خطأ أثناء الحذف: ' + err.message, 'error');
        }
    }
};

// 🌟 عرض تفاصيل فاتورة الانتظار في المودال 🌟
window.viewWaitingOrderDetails = async (id) => {
    const vo = allWaitingOrders.find(x => String(x.id) === String(id));
    if (!vo) return showToast('تعذر العثور على الفاتورة', 'error');

    const shortId = (vo.id || '').split('-')[0].toUpperCase();
    const isPending = vo.status === 'pending';
    const meta = vo.meta || parseWaitingOrderMeta(vo.notes, vo);
    const remaining = Number(vo.total_price || 0) - Number(meta.deposit || 0);

    const items = vo.visitor_order_items || [];
    let itemsHtml = items.map((item, idx) => {
        const sizesCount = item.sizes_count || 1;
        const totalPieces = (Number(item.quantity) || 0) * sizesCount;
        const piecePrice = sizesCount > 0 ? (Number(item.price_per_series) / sizesCount) : Number(item.price_per_series);
        const itemTotal = Number(item.total_price) || (Number(item.quantity) * Number(item.price_per_series));

        return `
            <tr class="border-b border-devo-gray last:border-0">
                <td class="py-3 px-2 text-center text-devo-muted font-mono text-xs">${idx + 1}</td>
                <td class="py-3">
                    <div class="text-white text-sm font-bold">${item.model_name || '-'}</div>
                    ${item.factory_code ? `<div class="text-[11px] text-devo-orange font-mono font-bold mt-0.5">كود: ${item.factory_code}</div>` : ''}
                </td>
                <td class="py-3 text-devo-info text-xs leading-relaxed">${item.color_name || '-'}</td>
                <td class="py-3 text-white font-black text-center">
                    <span class="text-lg">${item.quantity}</span><br>
                    <span class="text-[11px] text-devo-muted font-normal">(${totalPieces} قطعة)</span>
                </td>
                <td class="py-3 text-devo-muted text-center font-mono">${piecePrice.toLocaleString()}</td>
                <td class="py-3 text-devo-orange font-black text-left text-lg font-mono">${itemTotal.toLocaleString()}</td>
            </tr>
        `;
    }).join('');

    const modalContent = document.getElementById('order-details-content');
    if (!modalContent) return;

    modalContent.innerHTML = `
        <div class="bg-amber-500/10 p-4 rounded-xl border border-amber-500/30 mb-6 flex justify-between items-center flex-wrap gap-3">
            <div>
                <span class="bg-amber-500/20 text-amber-400 text-xs px-2.5 py-0.5 rounded font-bold inline-block mb-1">فاتورة انتظار (مسودة مؤقتة)</span>
                <h4 class="text-white font-bold text-lg">${vo.customer_name}</h4>
                <p class="text-sm text-devo-muted" dir="ltr">${vo.phone_1}${vo.phone_2 ? ' / ' + vo.phone_2 : ''}</p>
                ${vo.address ? `<p class="text-xs text-devo-muted/80 mt-1"><i class="ph ph-map-pin"></i> ${vo.address}</p>` : ''}
            </div>
            <div class="flex items-center gap-2 flex-wrap">
                <button onclick="printWaitingOrderInvoice('${vo.id}')" class="px-3.5 py-2 bg-purple-500/15 text-purple-400 hover:bg-purple-500 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer" title="طباعة">
                    <i class="ph ph-printer text-base"></i> طباعة
                </button>
                ${isPending ? `
                    <button onclick="closeOrderDetailsModal(); resumeWaitingOrderToCart('${vo.id}')" class="px-3.5 py-2 bg-amber-500/20 text-amber-400 hover:bg-amber-500 hover:text-black rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer" title="استكمال بالسلة">
                        <i class="ph ph-pencil-simple text-base"></i> استكمال بالسلة
                    </button>
                    <button onclick="closeOrderDetailsModal(); confirmWaitingOrderDirectly('${vo.id}')" class="px-3.5 py-2 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer" title="تأكيد كفاتورة أساسية">
                        <i class="ph ph-check-circle text-base"></i> تأكيد كفاتورة أساسية
                    </button>
                ` : ''}
                <div class="text-left mr-2">
                    <p class="text-xs text-devo-muted">كود الطلب</p>
                    <p class="text-amber-400 font-mono font-bold text-lg">#${shortId}</p>
                </div>
            </div>
        </div>

        <h4 class="text-white font-bold mb-3 border-b border-devo-gray pb-2">المنتجات المختارة</h4>
        <div class="overflow-x-auto">
            <table class="w-full text-right mb-6">
                <thead class="text-xs text-devo-muted bg-devo-black">
                    <tr>
                        <th class="py-2 px-2 text-center">#</th>
                        <th class="py-2 px-1">الموديل</th>
                        <th class="py-2 px-1">اللون</th>
                        <th class="py-2 px-1 text-center">الكمية (سيريه / ق)</th>
                        <th class="py-2 px-1 text-center">السعر للقطعة</th>
                        <th class="py-2 px-1 text-left">الإجمالي</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>
        </div>

        <div class="bg-devo-black p-4 rounded-xl border border-devo-gray space-y-2 text-sm">
            <div class="flex justify-between text-devo-muted"><span>إجمالي الأصناف:</span> <span class="text-white font-bold">${items.length} صنف</span></div>
            <div class="flex justify-between text-devo-muted"><span>إجمالي السريات:</span> <span class="text-white font-bold">${vo.total_series} سيريه</span></div>
            <div class="flex justify-between text-devo-muted border-t border-devo-gray/60 pt-2"><span>الإجمالي الكلي:</span> <span class="text-white font-bold font-mono">${(Number(vo.total_price) || 0).toLocaleString()} ج.م</span></div>
            <div class="flex justify-between text-devo-muted"><span>العربون المدفوع:</span> <span class="text-devo-success font-bold font-mono">${(Number(meta.deposit) || 0).toLocaleString()} ج.م</span></div>
            <div class="flex justify-between border-t border-devo-gray pt-2 mt-2">
                <span class="text-white font-bold">المتبقي للدفع:</span> 
                <span class="text-devo-orange font-black text-lg font-mono">${(Number(remaining) || 0).toLocaleString()} ج.م</span>
            </div>
            ${meta.cleanNotes ? `
                <div class="border-t border-devo-gray/60 pt-2 mt-2 text-xs text-devo-muted">
                    <span class="font-bold text-white">ملاحظات:</span> ${meta.cleanNotes}
                </div>
            ` : ''}
        </div>
    `;

    const modal = document.getElementById('order-details-modal');
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
    history.pushState({ modalId: 'order-details-modal' }, '', window.location.href);
};

// 🌟 طباعة مسودة فاتورة الانتظار / عرض أسعار 🌟
window.printWaitingOrderInvoice = async (id) => {
    const vo = allWaitingOrders.find(x => String(x.id) === String(id));
    if (!vo) return showToast('تعذر العثور على الفاتورة للطباعة', 'error');

    showToast('جاري تجهيز مسودة الفاتورة للطباعة...', 'info');

    const shortId = (vo.id || '').split('-')[0].toUpperCase();
    const printDate = new Date(vo.created_at);
    const dateStr = printDate.toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const meta = vo.meta || parseWaitingOrderMeta(vo.notes, vo);
    const remaining = Number(vo.total_price || 0) - Number(meta.deposit || 0);

    const items = vo.visitor_order_items || [];
    const itemsHtml = items.map((item, idx) => {
        const sizesCount = item.sizes_count || 1;
        const totalPieces = (Number(item.quantity) || 0) * sizesCount;
        const piecePrice = sizesCount > 0 ? (Number(item.price_per_series) / sizesCount) : Number(item.price_per_series);
        const itemTotal = Number(item.total_price) || (Number(item.quantity) * Number(item.price_per_series));

        return `
            <tr>
                <td style="padding: 6px; border: 1px solid #ddd; text-align: center;">${idx + 1}</td>
                <td style="padding: 6px; border: 1px solid #ddd; font-weight: bold;">
                    ${item.model_name || '-'}
                    ${item.factory_code ? `<span style="font-size:10px; color:#666; font-family:monospace; margin-right:4px;">(${item.factory_code})</span>` : ''}
                </td>
                <td style="padding: 6px; border: 1px solid #ddd; text-align: center;">${item.color_name || '-'}</td>
                <td style="padding: 6px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${item.quantity} سيريه <span style="font-size:10px; color:#555;">(${totalPieces} ق)</span></td>
                <td style="padding: 6px; border: 1px solid #ddd; text-align: center;">${piecePrice.toLocaleString()}</td>
                <td style="padding: 6px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${itemTotal.toLocaleString()}</td>
            </tr>
        `;
    }).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
            <meta charset="UTF-8">
            <title>مسودة فاتورة انتظار #${shortId}</title>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Tajawal:wght@400;700;900&display=swap');
                @page { size: A4 portrait; margin: 10mm; }
                body { font-family: 'Tajawal', sans-serif; background: white; color: black; margin: 0; padding: 10px; }
                table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 12px; }
                th { background: #f0f0f0; border: 1px solid #ccc; padding: 6px; font-weight: bold; }
                .notice { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; padding: 8px 12px; border-radius: 6px; font-size: 11px; margin-top: 15px; text-align: center; font-weight: bold; }
            </style>
        </head>
        <body>
            <div style="border-bottom: 2px solid black; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div>
                    <h1 style="font-size: 26px; font-weight: 900; margin: 0; letter-spacing: 2px;">DEVO <span style="font-size: 12px; background: #eee; padding: 2px 6px; border-radius: 4px;">Collection</span></h1>
                    <p style="font-size: 11px; color: #666; margin: 2px 0 0 0;">مصنع ديفو للملابس الجاهزة</p>
                </div>
                <div style="text-align: left;">
                    <div style="font-size: 16px; font-weight: bold; color: #b45309;">مسودة فاتورة / طلب انتظار</div>
                    <div style="font-size: 12px; font-family: monospace; color: #444;">كود الفاتورة: #${shortId}</div>
                    <div style="font-size: 10px; color: #777;">${dateStr}</div>
                </div>
            </div>

            <div style="background: #f9f9f9; border: 1px solid #eee; border-radius: 6px; padding: 10px; display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 10px;">
                <div>
                    <div><strong>العميل / المحل:</strong> ${vo.customer_name}</div>
                    <div><strong>رقم الهاتف:</strong> ${vo.phone_1}${vo.phone_2 ? ' / ' + vo.phone_2 : ''}</div>
                </div>
                <div style="text-align: left;">
                    <div><strong>العنوان:</strong> ${vo.address || 'غير محدد'}</div>
                    ${meta.worker_name ? `<div><strong>الموظف:</strong> ${meta.worker_name}</div>` : ''}
                </div>
            </div>

            <table>
                <thead>
                    <tr>
                        <th style="width: 30px;">#</th>
                        <th>الموديل</th>
                        <th>اللون</th>
                        <th>الكمية</th>
                        <th>السعر للقطعة</th>
                        <th>الإجمالي</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div style="margin-top: 15px; border-top: 2px solid #333; padding-top: 10px; display: flex; justify-content: space-between; font-size: 13px;">
                <div>
                    <div><strong>إجمالي السريات:</strong> ${vo.total_series} سيريه</div>
                    ${meta.deposit > 0 ? `<div style="color: #047857; margin-top: 3px;"><strong>العربون المدفوع:</strong> ${meta.deposit.toLocaleString()} ج.م</div>` : ''}
                </div>
                <div style="text-align: left;">
                    <div style="font-size: 15px;"><strong>الإجمالي الكلي:</strong> <span style="font-weight: 900;">${(Number(vo.total_price) || 0).toLocaleString()} ج.م</span></div>
                    ${meta.deposit > 0 ? `<div style="font-size: 14px; color: #c2410c; margin-top: 3px;"><strong>المتبقي للدفع:</strong> ${remaining.toLocaleString()} ج.م</div>` : ''}
                </div>
            </div>

            <div class="notice">
                ⚠️ تنبيه: هذه الفاتورة مسودة مؤقتة محفوظة بقائمة الانتظار (عرض أسعار) ولم يتم خصم كمياتها من المخزن، ولا تعتبر إيصالاً نهائياً لحين الاعتماد وإصدار الفاتورة الأساسية.
            </div>
        </body>
        </html>
    `;

    printHtmlInIframe(htmlContent);
};