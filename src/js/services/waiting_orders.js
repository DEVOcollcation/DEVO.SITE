import { supabase } from '../config/supabase.js';
import { resolveImageUrl } from './offline_store.js';

/**
 * 🌟 خدمة إدارة فواتير الانتظار (Waiting / Draft Orders Service) 🌟
 * تتيح للمستخدمين حفظ فواتير مؤقتة في قائمة الانتظار بدون خصم أي كميات من المخزن،
 * مع إمكانية استكمالها، تعديلها، تحويلها لفواتير أساسية، أو قيام الأدمن باعتمادها.
 */

export function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * استخراج بيانات الموظف والعربون من الملاحظات أو من أعمدة الجدول
 */
export function parseWaitingOrderMeta(notesStr = '', orderObj = null) {
    let meta = {
        worker_id: orderObj?.worker_id || null,
        worker_name: orderObj?.worker_name || '',
        deposit: Number(orderObj?.deposit ?? 0),
        deposit_receiver: orderObj?.deposit_receiver || '',
        is_worker_waiting: false,
        saved_at: orderObj?.created_at || null,
        cleanNotes: ''
    };

    let clean = (notesStr || '').trim();
    const metaMatch = clean.match(/\[DEVO_META:([\s\S]*?)\]/);

    if (metaMatch) {
        try {
            const parsed = JSON.parse(metaMatch[1]);
            if (!meta.worker_id && parsed.worker_id) meta.worker_id = parsed.worker_id;
            if (!meta.worker_name && parsed.worker_name) meta.worker_name = parsed.worker_name;
            if (meta.deposit === 0 && parsed.deposit !== undefined) meta.deposit = Number(parsed.deposit) || 0;
            if (!meta.deposit_receiver && parsed.deposit_receiver) meta.deposit_receiver = parsed.deposit_receiver;
            if (parsed.is_worker_waiting) meta.is_worker_waiting = true;
            if (parsed.saved_at) meta.saved_at = parsed.saved_at;
        } catch (e) {
            console.warn('[WaitingOrders] Failed to parse DEVO_META JSON:', e);
        }
        clean = clean.replace(/\[DEVO_META:[\s\S]*?\]/, '').trim();
    }

    if (meta.worker_id) {
        meta.is_worker_waiting = true;
    }

    meta.cleanNotes = clean;
    return meta;
}

/**
 * ترميز الملاحظات مع بيانات الميتا لضمان استرجاع الموظف والعربون بدقة بدون أخطاء قاعدة البيانات
 */
export function encodeWaitingOrderNotes(rawNotes = '', metaObj = {}) {
    let clean = (rawNotes || '').replace(/\[DEVO_META:[\s\S]*?\]/, '').trim();
    const metaPayload = {
        worker_id: metaObj.worker_id || null,
        worker_name: metaObj.worker_name || 'موظف',
        deposit: Number(metaObj.deposit || 0),
        deposit_receiver: metaObj.deposit_receiver || '',
        is_worker_waiting: true,
        saved_at: new Date().toISOString()
    };
    return (clean ? clean + '\n' : '') + `[DEVO_META:${JSON.stringify(metaPayload)}]`;
}

/**
 * حفظ فاتورة في قائمة الانتظار (جديدة أو تحديث لمسودة سابقة) بدون خصم مخزن
 */
export async function saveWaitingOrderDraft({
    existingOrderId = null,
    customerName,
    phone1,
    phone2 = null,
    address = null,
    deposit = 0,
    depositReceiver = null,
    notes = '',
    cartItems = [],
    currentUser
}) {
    if (!cartItems || cartItems.length === 0) {
        throw new Error('السلة فارغة!');
    }
    if (!customerName || !customerName.trim()) {
        throw new Error('اسم العميل مطلوب!');
    }
    if (!phone1 || !phone1.trim()) {
        throw new Error('رقم الهاتف مطلوب!');
    }

    const workerName = currentUser?.full_name || currentUser?.user_metadata?.full_name || currentUser?.email || 'موظف';
    const workerId = currentUser?.id || null;

    const meta = {
        worker_id: workerId,
        worker_name: workerName,
        deposit: Number(deposit) || 0,
        deposit_receiver: depositReceiver ? depositReceiver.trim() : '',
        is_worker_waiting: true
    };

    const encodedNotes = encodeWaitingOrderNotes(notes, meta);
    const totalPrice = cartItems.reduce((sum, item) => sum + (item.qty * (item.sizesCount || 1) * item.price), 0);
    const totalSeries = cartItems.reduce((sum, item) => sum + item.qty, 0);

    const orderId = existingOrderId || generateUUID();

    const orderPayload = {
        id: orderId,
        customer_name: customerName.trim(),
        phone_1: phone1.trim(),
        phone_2: phone2 ? phone2.trim() : null,
        address: address ? address.trim() : null,
        notes: encodedNotes,
        total_price: totalPrice,
        total_series: totalSeries,
        status: 'pending'
    };

    if (existingOrderId) {
        // تحديث الفاتورة القائمة
        const updateData = { ...orderPayload };
        delete updateData.id; // لا تقم بتحديث الـ id

        let { error: updErr } = await supabase
            .from('visitor_orders')
            .update({ ...updateData, worker_id: workerId, worker_name: workerName })
            .eq('id', existingOrderId);

        if (updErr && updErr.message?.includes('column')) {
            // محاولة التحديث بدون الأعمدة المضافة إن لم تكن موجودة بقاعدة البيانات
            const { error: retryErr } = await supabase
                .from('visitor_orders')
                .update(updateData)
                .eq('id', existingOrderId);
            if (retryErr) throw retryErr;
        } else if (updErr) {
            throw updErr;
        }

        // حذف الأصناف القديمة وإعادة إدراج الأصناف المحدثة
        await supabase.from('visitor_order_items').delete().eq('visitor_order_id', existingOrderId);
    } else {
        // إدراج فاتورة انتظار جديدة
        let { error: insErr } = await supabase
            .from('visitor_orders')
            .insert({ ...orderPayload, worker_id: workerId, worker_name: workerName });

        if (insErr && insErr.message?.includes('column')) {
            const { error: retryErr } = await supabase
                .from('visitor_orders')
                .insert(orderPayload);
            if (retryErr) throw retryErr;
        } else if (insErr) {
            throw insErr;
        }
    }

    // إدراج أصناف الفاتورة في جدول visitor_order_items
    const orderItems = cartItems.map(item => ({
        id: generateUUID(),
        visitor_order_id: orderId,
        model_id: item.modelId,
        color_id: item.colorId,
        model_name: item.modelName,
        color_name: item.colorName,
        factory_code: item.factoryCode || '',
        quantity: item.qty,
        price_per_series: item.price * (item.sizesCount || 1),
        sizes_count: item.sizesCount || 1,
        total_price: item.qty * (item.sizesCount || 1) * item.price
    }));

    const { error: itemsErr } = await supabase.from('visitor_order_items').insert(orderItems);
    if (itemsErr) throw itemsErr;

    return {
        orderId,
        isUpdate: !!existingOrderId,
        totalPrice,
        totalSeries
    };
}

/**
 * جلب فواتير الانتظار الخاصة بالمستخدم المسجل
 */
export async function fetchUserWaitingOrders(currentUser, isAdmin = false) {
    if (!currentUser || !currentUser.id) return [];

    try {
        const { data, error } = await supabase
            .from('visitor_orders')
            .select(`
                *,
                visitor_order_items (
                    *,
                    models (
                        id, 
                        name, 
                        factory_code, 
                        system_code, 
                        price, 
                        model_images(image_url), 
                        model_sizes(size_id),
                        classes(id, name, class_sizes(size_id))
                    ),
                    colors (id, name, color_code)
                )
            `)
            .order('created_at', { ascending: false });

        if (error) throw error;
        if (!data) return [];

        const enriched = data.map(order => {
            const meta = parseWaitingOrderMeta(order.notes, order);
            return {
                ...order,
                meta
            };
        });

        // إذا كان المستخدم ليس مديراً، يتم تصفية الفواتير لتظهر فقط الفواتير التي أنشأها هو
        if (!isAdmin) {
            return enriched.filter(order => {
                return (
                    order.worker_id === currentUser.id ||
                    order.meta.worker_id === currentUser.id
                );
            });
        }

        // إذا كان مدير نظام، يمكنه رؤية فواتير الانتظار الخاصة به أو فواتير الانتظار التي تم إنشاؤها عبر الموظفين
        return enriched;
    } catch (err) {
        console.error('[WaitingOrders] fetchUserWaitingOrders error:', err);
        return [];
    }
}

/**
 * حذف فاتورة انتظار
 */
export async function deleteWaitingOrderById(orderId) {
    const { error } = await supabase.from('visitor_orders').delete().eq('id', orderId);
    if (error) throw error;
    return true;
}

/**
 * تأكيد وتحويل فاتورة الانتظار مباشرة إلى فاتورة أساسية معتمدة مع خصم المخزون
 */
export async function convertWaitingOrderToPermanent({
    waitingOrder,
    currentUser
}) {
    if (!waitingOrder || !waitingOrder.visitor_order_items || waitingOrder.visitor_order_items.length === 0) {
        throw new Error('لا توجد أصناف في هذا الطلب!');
    }

    const items = waitingOrder.visitor_order_items;
    const modelIds = [...new Set(items.map(i => i.model_id))];

    // التحقق اللحظي من المخزون
    const [{ data: dbInv }, { data: dbMod }] = await Promise.all([
        supabase.from('model_inventory').select('model_id, color_id, available_series').in('model_id', modelIds),
        supabase.from('models').select('id, is_active').in('id', modelIds)
    ]);

    const stockErrors = [];
    items.forEach(item => {
        const inv = dbInv?.find(i => String(i.model_id) === String(item.model_id) && String(i.color_id) === String(item.color_id));
        const mod = dbMod?.find(m => String(m.id) === String(item.model_id));
        const available = inv ? inv.available_series : 0;

        if (!mod || !mod.is_active) {
            stockErrors.push(`الموديل (${item.model_name}) غير مفعل حالياً.`);
        } else if (item.quantity > available) {
            stockErrors.push(`الصنف (${item.model_name} - ${item.color_name}): المطلوب ${item.quantity} سيريه والمتاح بالمخزن ${available} فقط.`);
        }
    });

    if (stockErrors.length > 0) {
        return {
            success: false,
            errors: stockErrors
        };
    }

    const meta = waitingOrder.meta || parseWaitingOrderMeta(waitingOrder.notes, waitingOrder);
    const workerId = meta.worker_id || waitingOrder.worker_id || currentUser.id;
    const workerName = meta.worker_name || currentUser.full_name || currentUser.email || 'موظف';

    const orderData = {
        worker_id: workerId,
        customer_name: waitingOrder.customer_name,
        phone_1: waitingOrder.phone_1,
        phone_2: waitingOrder.phone_2 || null,
        address: waitingOrder.address || null,
        notes: (meta.cleanNotes ? meta.cleanNotes + ' | ' : '') + `معتمدة من قائمة الانتظار بواسطة (${workerName})`,
        total_price: Number(waitingOrder.total_price) || 0,
        total_series: Number(waitingOrder.total_series) || 0,
        deposit: Number(meta.deposit || waitingOrder.deposit || 0),
        deposit_receiver: meta.deposit_receiver || waitingOrder.deposit_receiver || null,
        status: 'created'
    };

    const orderItemsData = items.map(item => {
        const sizesCount = item.sizes_count || 1;
        const pricePerSeries = Number(item.price_per_series) || 0;
        return {
            model_id: item.model_id,
            color_id: item.color_id,
            color_name: item.color_name || '',
            qty: item.quantity,
            model_name: item.model_name,
            price: pricePerSeries,
            total: item.quantity * pricePerSeries,
            sizes_count: sizesCount,
            piece_price: sizesCount > 0 ? (pricePerSeries / sizesCount) : pricePerSeries
        };
    });

    // تنفيذ المعاملة السحابية الآمنة لخصم المخزون وإصدار رقم الفاتورة
    const { data: rpcData, error: rpcError } = await supabase.rpc('process_order_transaction', {
        p_order_id: null,
        p_order_data: orderData,
        p_order_items: orderItemsData
    });

    if (rpcError) throw rpcError;

    // تحديث حالة الفاتورة بقائمة الانتظار إلى معتمدة
    await supabase.from('visitor_orders').update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: workerName
    }).eq('id', waitingOrder.id);

    return {
        success: true,
        invoiceNumber: rpcData.invoice_number,
        orderId: rpcData.order_id,
        orderData,
        orderItemsData
    };
}
