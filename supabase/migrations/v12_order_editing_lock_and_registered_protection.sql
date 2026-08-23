-- =========================================================================
-- 🌟 MIGRATION V12: ORDER EDITING LOCK, REGISTERED STATUS PROTECTION & RESET TO CREATED 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-08-23
-- الإصدار: v12.0
-- الوصف: 
-- 1. تسجيل العامل/الإداري الذي يبدأ التعديل وقفله بحالة 'editing' (جاري التعديل) ومنع أي شخص آخر من تعديله أو حفظه.
-- 2. منع تعديل أو حفظ أي أوردر بحالة 'registered' (تم التسجيل) منعاً باتاً.
-- 3. إعادة الأوردر تلقائياً إلى حالة 'created' (تم إنشاء الأوردر) وفك القفل بعد حفظ التعديل أو إفراغ السلة/إلغاء التعديل.
-- =========================================================================

-- 1. دالة قفل الأوردر وبدء التعديل (acquire_order_lock)
CREATE OR REPLACE FUNCTION public.acquire_order_lock(
    p_order_id uuid,
    p_assigned_admin_name text
)
RETURNS boolean AS $$
DECLARE
    v_current_status text;
    v_is_locked boolean;
    v_assigned_admin_name text;
BEGIN
    -- جلب حالة وقفل الأوردر
    SELECT status, is_locked, assigned_admin_name 
    INTO v_current_status, v_is_locked, v_assigned_admin_name
    FROM public.orders 
    WHERE id = p_order_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'الأوردر غير موجود.';
    END IF;

    -- 🛡️ منع تعديل الأوردر إذا كان في حالة تم التسجيل
    IF v_current_status = 'registered' THEN
        RAISE EXCEPTION 'عفواً، لا يمكن تعديل هذا الأوردر لأنه في حالة (تم التسجيل).';
    END IF;

    -- التحقق من الصلاحيات: مسموح للأونر/الأدمن، أو صانع الأوردر، أو المسند إليه
    IF NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND (
            public.get_my_role() IN ('owner', 'admin')
            OR o.assigned_worker_id = auth.uid()
            OR o.worker_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بتعديل أو قفل هذا الأوردر.';
    END IF;

    -- التحقق مما إذا كان الأوردر مقفولاً بالفعل بواسطة إداري/موظف آخر
    IF v_is_locked = true 
       AND v_assigned_admin_name IS DISTINCT FROM p_assigned_admin_name 
       AND public.get_my_role() NOT IN ('owner') THEN
        RAISE EXCEPTION 'عفواً، هذا الأوردر مقفول حالياً بواسطة مستخدم آخر (%s).', COALESCE(v_assigned_admin_name, 'مستخدم آخر');
    END IF;

    -- تحديث حالة وقفل الأوردر وتسجيل الموظف القائم بالتعديل
    UPDATE public.orders
    SET is_locked = true,
        assigned_admin_name = p_assigned_admin_name,
        assigned_worker_id = auth.uid(),
        status = 'editing'
    WHERE id = p_order_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. دالة تحرير قفل الأوردر وإعادته إلى 'created' (release_order_lock)
CREATE OR REPLACE FUNCTION public.release_order_lock(
    p_order_id uuid
)
RETURNS boolean AS $$
BEGIN
    -- مسموح بالأونر/الأدمن، أو صانع الأوردر/المُسند إليه، أو عمال المعرض/المخزن
    IF NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND (
            public.get_my_role() IN ('owner', 'admin')
            OR o.assigned_worker_id = auth.uid()
            OR o.worker_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.system_users u
                WHERE u.id = auth.uid()
                AND u.is_active = true
            )
        )
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بتحرير قفل هذا الأوردر.';
    END IF;

    -- إرجاع الأوردر إلى تم إنشاء الأوردر وتحرير القفل والإسناد
    UPDATE public.orders
    SET is_locked = false,
        assigned_worker_id = NULL,
        assigned_admin_name = NULL,
        status = 'created'
    WHERE id = p_order_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 3. تحديث دالة عملية حفظ الأوردر الشاملة (process_order_transaction)
CREATE OR REPLACE FUNCTION public.process_order_transaction(
    p_order_id uuid,
    p_order_data jsonb,
    p_order_items jsonb
)
RETURNS jsonb AS $$
DECLARE
    v_order_id uuid;
    v_invoice_number text;
    v_current_status text;
    v_is_locked boolean;
    v_assigned_admin_name text;
    v_assigned_worker_id uuid;
    v_item record;
    v_current_stock int;
    v_diff_record record;
BEGIN
    -- 🌟 إذا كان وضع "تعديل" (Update)
    IF p_order_id IS NOT NULL THEN
        v_order_id := p_order_id;

        -- جلب بيانات القفل والحالة الحالية للأوردر
        SELECT status, is_locked, assigned_admin_name, assigned_worker_id, invoice_number 
        INTO v_current_status, v_is_locked, v_assigned_admin_name, v_assigned_worker_id, v_invoice_number
        FROM public.orders 
        WHERE id = v_order_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'الأوردر المراد تعديله غير موجود.';
        END IF;

        -- 🛡️ منع حفظ التعديلات نهائياً إذا كان الأوردر في حالة "تم التسجيل"
        IF v_current_status = 'registered' THEN
            RAISE EXCEPTION 'عفواً، لا يمكن تعديل أو حفظ أي تغييرات على هذا الأوردر لأنه في حالة (تم التسجيل).';
        END IF;

        -- 🛡️ منع حفظ الأوردر إذا كان مقفولاً من قبل مستخدم آخر (ويستثنى المالك)
        IF v_is_locked = true 
           AND (v_assigned_worker_id IS NOT NULL AND v_assigned_worker_id != auth.uid())
           AND (v_assigned_admin_name IS NOT NULL AND v_assigned_admin_name IS DISTINCT FROM (p_order_data->>'assigned_admin_name'))
           AND public.get_my_role() NOT IN ('owner') THEN
            RAISE EXCEPTION 'عفواً، هذا الأوردر مقفول حالياً بواسطة (%s) ولا يمكن حفظه.', COALESCE(v_assigned_admin_name, 'مستخدم آخر');
        END IF;

        -- أ) التحقق من توفر الكميات الإضافية المطلوبة (قبل تعديل المخزن)
        FOR v_diff_record IN 
            SELECT 
                coalesce(new_items.model_id, old_items.model_id) as model_id,
                coalesce(new_items.color_id, old_items.color_id) as color_id,
                coalesce(new_items.qty, 0) - coalesce(old_items.quantity, 0) as diff,
                coalesce(new_items.model_name, '') as model_name
            FROM (
                SELECT (x->>'model_id')::uuid as model_id, (x->>'color_id')::uuid as color_id, (x->>'qty')::int as qty, (x->>'model_name')::text as model_name
                FROM jsonb_array_elements(p_order_items) as x
            ) new_items
            FULL OUTER JOIN (
                SELECT model_id, color_id, quantity
                FROM public.order_items
                WHERE order_id = v_order_id
            ) old_items 
            ON new_items.model_id = old_items.model_id AND new_items.color_id = old_items.color_id
        LOOP
            IF v_diff_record.diff > 0 THEN
                SELECT available_series INTO v_current_stock FROM public.model_inventory
                WHERE model_id = v_diff_record.model_id AND color_id = v_diff_record.color_id FOR UPDATE;
                
                IF COALESCE(v_current_stock, 0) < v_diff_record.diff THEN
                    RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة بالمخزن. المتاح بالمخزن: %, المطلوب زيادة: %', 
                        v_diff_record.model_name, COALESCE(v_current_stock, 0), v_diff_record.diff;
                END IF;
            END IF;
        END LOOP;

        -- ب) تطبيق الفروقات على المخزن وتسجيل حركات المخزون
        FOR v_diff_record IN 
            SELECT 
                coalesce(new_items.model_id, old_items.model_id) as model_id,
                coalesce(new_items.color_id, old_items.color_id) as color_id,
                coalesce(new_items.qty, 0) - coalesce(old_items.quantity, 0) as diff
            FROM (
                SELECT (x->>'model_id')::uuid as model_id, (x->>'color_id')::uuid as color_id, (x->>'qty')::int as qty
                FROM jsonb_array_elements(p_order_items) as x
            ) new_items
            FULL OUTER JOIN (
                SELECT model_id, color_id, quantity
                FROM public.order_items
                WHERE order_id = v_order_id
            ) old_items 
            ON new_items.model_id = old_items.model_id AND new_items.color_id = old_items.color_id
        LOOP
            IF v_diff_record.diff <> 0 THEN
                INSERT INTO public.model_inventory (model_id, color_id, available_series)
                VALUES (v_diff_record.model_id, v_diff_record.color_id, 0)
                ON CONFLICT (model_id, color_id) DO NOTHING;

                UPDATE public.model_inventory
                SET available_series = available_series - v_diff_record.diff
                WHERE model_id = v_diff_record.model_id AND color_id = v_diff_record.color_id;

                INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
                VALUES (
                    v_diff_record.model_id, 
                    v_diff_record.color_id, 
                    CASE WHEN v_diff_record.diff > 0 THEN 'out' ELSE 'in' END, 
                    abs(v_diff_record.diff), 
                    'تعديل أوردر رقم ' || v_invoice_number
                );
            END IF;
        END LOOP;

        -- ج) مسح العناصر القديمة
        DELETE FROM public.order_items WHERE order_id = v_order_id;

        -- د) تحديث بيانات الفاتورة وإرجاع الحالة إلى 'created' وفك القفل
        UPDATE public.orders SET
            customer_name = p_order_data->>'customer_name',
            phone_1 = p_order_data->>'phone_1',
            phone_2 = p_order_data->>'phone_2',
            address = p_order_data->>'address',
            deposit = (p_order_data->>'deposit')::numeric,
            deposit_receiver = p_order_data->>'deposit_receiver',
            notes = p_order_data->>'notes',
            total_price = (p_order_data->>'total_price')::numeric,
            total_series = (p_order_data->>'total_series')::integer,
            status = 'created',
            is_locked = false,
            assigned_admin_name = NULL,
            assigned_worker_id = NULL
        WHERE id = v_order_id;

        -- هـ) إدراج إشعار تعديل الأوردر وحفظه بنجاح
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES (
            'order_updated',
            '🔄 تم تعديل الأوردر #' || v_invoice_number,
            '👤 اسم العميل: ' || COALESCE(p_order_data->>'customer_name', 'غير معروف') || E'\n' ||
            '💵 إجمالي المبلغ الجديد: ' || (p_order_data->>'total_price')::numeric || ' ج.م',
            jsonb_build_object('order_id', v_order_id, 'status', 'created', 'total_price', (p_order_data->>'total_price')::numeric)
        );

    ELSE
        -- 🌟 وضع إنشاء جديد (Insert)
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, model_name text)
        LOOP
            SELECT available_series INTO v_current_stock FROM public.model_inventory
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id FOR UPDATE;

            IF COALESCE(v_current_stock, 0) < v_item.qty THEN
               RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة بالمخزن. المتاح: %', COALESCE(v_item.model_name, ''), COALESCE(v_current_stock, 0);
            END IF;
        END LOOP;

        v_invoice_number := nextval('public.invoice_number_seq')::text;

        INSERT INTO public.orders (
            invoice_number, customer_name, phone_1, phone_2, address, 
            deposit, deposit_receiver, notes, total_price, total_series, 
            worker_id, status, is_locked, assigned_admin_name, assigned_worker_id
        )
        VALUES (
            v_invoice_number, p_order_data->>'customer_name', p_order_data->>'phone_1', p_order_data->>'phone_2', p_order_data->>'address',
            (p_order_data->>'deposit')::numeric, p_order_data->>'deposit_receiver', p_order_data->>'notes',
            (p_order_data->>'total_price')::numeric, (p_order_data->>'total_series')::integer, 
            (p_order_data->>'worker_id')::uuid, 'created', false, NULL, NULL
        ) RETURNING id INTO v_order_id;

        UPDATE public.system_users SET invoice_count = COALESCE(invoice_count, 0) + 1 WHERE id = (p_order_data->>'worker_id')::uuid;

        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int)
        LOOP
            INSERT INTO public.model_inventory (model_id, color_id, available_series)
            VALUES (v_item.model_id, v_item.color_id, 0)
            ON CONFLICT (model_id, color_id) DO NOTHING;

            UPDATE public.model_inventory SET available_series = available_series - v_item.qty
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

            INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
            VALUES (v_item.model_id, v_item.color_id, 'out', v_item.qty, 'فاتورة مبيعات: ' || v_invoice_number);
        END LOOP;

    END IF;

    -- 🌟 تسجيل العناصر الجديدة للأوردر مع حفظ قيم القطع
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(
        model_id uuid, 
        color_id uuid, 
        qty int, 
        price numeric, 
        total numeric,
        sizes_count int,
        piece_price numeric
    )
    LOOP
        INSERT INTO public.order_items (
            order_id, 
            model_id, 
            color_id, 
            quantity, 
            price_per_series, 
            total_price,
            sizes_count,
            piece_price
        )
        VALUES (
            v_order_id, 
            v_item.model_id, 
            v_item.color_id, 
            v_item.qty, 
            v_item.price, 
            v_item.total,
            COALESCE(v_item.sizes_count, 1),
            COALESCE(v_item.piece_price, v_item.price)
        );
    END LOOP;

    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'invoice_number', v_invoice_number
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
