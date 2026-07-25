-- =========================================================================
-- 🌟 MIGRATION V7: NOTIFICATION NOISE REDUCTION & SELECTIVE TELEGRAM ALERTS 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-07-25
-- الإصدار: v7.0
-- الوصف: 
-- 1. تحديث handle_order_changes_notification لتقليل الضوضاء: إرسال تنبيهات فقط عند إنشاء الأوردر، عند إسناد عامل، أو عند بدء التعديل (الحالة تصبح in_progress).
-- 2. تحديث process_order_transaction لإرسال إشعار تعديل وحفظ الأوردر بنجاح فقط عند حفظ التعديلات فعلياً، وتخطي إرسال إشعارات مع كل تغيير حالة.
-- =========================================================================

-- 1. تحديث دالة التريجر لجدول الطلبات لتقليل التنبيهات
CREATE OR REPLACE FUNCTION public.handle_order_changes_notification()
RETURNS TRIGGER AS $$
DECLARE
    notification_title text;
    notification_body text;
    notification_type text;
    target_user_id uuid := NULL;
BEGIN
    -- أ) عند إضافة أوردر جديد بالسيستم
    IF (TG_OP = 'INSERT') THEN
        notification_type := 'order_created';
        notification_title := '🚨 أوردر جديد قد وصل!';
        notification_body := '🧾 رقم الأوردر: ' || COALESCE(NEW.invoice_number, 'غير محدد') || E'\n' ||
                             '👤 اسم العميل: ' || COALESCE(NEW.customer_name, 'غير معروف') || E'\n' ||
                             '📞 رقم الهاتف: ' || COALESCE(NEW.phone_1, 'غير محدد') || 
                             CASE WHEN NEW.phone_2 IS NOT NULL AND NEW.phone_2 <> '' THEN ' / ' || NEW.phone_2 ELSE '' END || E'\n' ||
                             '📍 العنوان: ' || COALESCE(NEW.address, 'غير محدد') || E'\n' ||
                             '💵 إجمالي المبلغ: ' || NEW.total_price || ' ج.م' ||
                             CASE WHEN NEW.notes IS NOT NULL AND NEW.notes <> '' THEN E'\n📝 ملاحظات: ' || NEW.notes ELSE '' END;
        
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id, 'customer_name', NEW.customer_name, 'total_price', NEW.total_price));
        
    -- ب) عند تعديل أوردر بالسيستم
    ELSIF (TG_OP = 'UPDATE') THEN
        -- 1. تحقق مما إذا كان هناك تغيير في العامل المسند إليه تحضير الأوردر (إشعار للموظف داخل النظام فقط)
        IF (NEW.worker_id IS DISTINCT FROM OLD.worker_id AND NEW.worker_id IS NOT NULL) THEN
            notification_type := 'order_assigned';
            notification_title := '📋 تم تعيين أوردر جديد لك!';
            notification_body := '📦 تم إسناد الأوردر رقم: ' || COALESCE(NEW.invoice_number, 'غير محدد') || E'\n' ||
                                 '👤 للعميل: ' || COALESCE(NEW.customer_name, 'غير معروف') || E'\n' ||
                                 'يرجى البدء في تحضير الطلب بالمخزن.';
            target_user_id := NEW.worker_id;
            
            INSERT INTO public.system_notifications (type, title, body, metadata, user_id)
            VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id), target_user_id);
        END IF;

        -- 2. إشعار بدء تعديل الأوردر فقط عند تحول حالته إلى 'editing'
        IF ((NEW.status = 'editing' OR NEW.status = 'in_progress') AND OLD.status NOT IN ('editing', 'in_progress')) THEN
            notification_type := 'order_edit_start';
            notification_title := '✏️ بدأ تعديل الأوردر #' || COALESCE(NEW.invoice_number, 'غير محدد');
            notification_body := '👤 اسم العميل: ' || COALESCE(NEW.customer_name, 'غير معروف') || E'\n' ||
                                 '👤 القائم بالتعديل: ' || COALESCE(NEW.assigned_admin_name, 'غير معروف') || E'\n' ||
                                 '💵 إجمالي المبلغ الحالي: ' || NEW.total_price || ' ج.م';
            
            INSERT INTO public.system_notifications (type, title, body, metadata)
            VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'total_price', NEW.total_price));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. تحديث دالة عملية حفظ الأوردر لإدراج إشعار تعديل الطلب مباشرة عند الحفظ الناجح
CREATE OR REPLACE FUNCTION public.process_order_transaction(
    p_order_id uuid,
    p_order_data jsonb,
    p_order_items jsonb
)
RETURNS jsonb AS $$
DECLARE
    v_order_id uuid;
    v_invoice_number text;
    v_item record;
    v_current_stock int;
    v_diff_record record;
BEGIN
    -- 🌟 إذا كان وضع "تعديل" (Update)
    IF p_order_id IS NOT NULL THEN
        v_order_id := p_order_id;

        -- 🛡️ منع تعديل الأوردر إذا كان مقفولاً من قبل مستخدم آخر (ويستثنى من قيد القفل المالك والمشرف)
        IF EXISTS (
            SELECT 1 FROM public.orders 
            WHERE id = v_order_id 
              AND is_locked = true 
              AND (assigned_worker_id != auth.uid() OR assigned_worker_id IS NULL)
              AND public.get_my_role() NOT IN ('owner', 'admin')
        ) THEN
            RAISE EXCEPTION 'عفواً، هذا الأوردر قيد التحضير/مقفول حالياً ولا يمكن تعديله.';
        END IF;

        SELECT invoice_number INTO v_invoice_number FROM public.orders WHERE id = v_order_id;

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

        -- د) تحديث بيانات الفاتورة
        UPDATE public.orders SET
            customer_name = p_order_data->>'customer_name',
            phone_1 = p_order_data->>'phone_1',
            phone_2 = p_order_data->>'phone_2',
            address = p_order_data->>'address',
            deposit = (p_order_data->>'deposit')::numeric,
            deposit_receiver = p_order_data->>'deposit_receiver',
            notes = p_order_data->>'notes',
            total_price = (p_order_data->>'total_price')::numeric,
            total_series = (p_order_data->>'total_series')::integer
        WHERE id = v_order_id;

        -- هـ) إدراج إشعار تعديل الأوردر وحفظه بنجاح مباشرة في الإشعارات
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

        INSERT INTO public.orders (invoice_number, customer_name, phone_1, phone_2, address, deposit, deposit_receiver, notes, total_price, total_series, worker_id)
        VALUES (
          v_invoice_number, p_order_data->>'customer_name', p_order_data->>'phone_1', p_order_data->>'phone_2', p_order_data->>'address',
          (p_order_data->>'deposit')::numeric, p_order_data->>'deposit_receiver', p_order_data->>'notes',
          (p_order_data->>'total_price')::numeric, (p_order_data->>'total_series')::integer, (p_order_data->>'worker_id')::uuid
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

    -- 🌟 تسجيل العناصر الجديدة للأوردر مع حفظ قيم القطع السلسة محفورة بالسجل
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
            piece_price,
            total_pieces
        ) VALUES (
            v_order_id, 
            v_item.model_id, 
            v_item.color_id, 
            v_item.qty, 
            v_item.price, 
            v_item.total,
            COALESCE(v_item.sizes_count, 1),
            COALESCE(v_item.piece_price, CASE WHEN COALESCE(v_item.sizes_count, 1) > 0 THEN v_item.price / v_item.sizes_count ELSE v_item.price END),
            v_item.qty * COALESCE(v_item.sizes_count, 1)
        );
    END LOOP;

    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
