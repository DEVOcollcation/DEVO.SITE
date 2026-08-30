-- ==============================================================================
-- 🚀 V18: توحيد إشعار تليجرام في رسالة واحدة متكاملة وإصلاح ظهور أسماء الألوان
-- ==============================================================================
-- 1. إصلاح ظهور أسماء الألوان الحقيقية بدلاً من كلمة "لون" عن طريق جلب الاسم من جدول colors تلقائياً.
-- 2. توحيد إشعار الطلبات ليتم إرسال إشعار تفصيلي واحد فقط لكل أوردر بدلاً من إشعارين مكررين.
-- 3. تنظيف أي تريجرات قديمة مسببة للتكرار وضمان حظر التكرار عبر قفل Idempotency.
-- ==============================================================================

-- 1. إزالة أي تريجرات قديمة قد تسبب تكرار إرسال إشعارات الأوردرات للتليجرام
DROP TRIGGER IF EXISTS trg_order_items_telegram_notification ON public.order_items;
DROP TRIGGER IF EXISTS trg_order_telegram_notification ON public.orders;
DROP TRIGGER IF EXISTS trg_send_order_telegram_details ON public.orders;
DROP TRIGGER IF EXISTS trg_order_details_telegram ON public.order_items;
DROP TRIGGER IF EXISTS trg_order_changes_notification ON public.orders;

-- 2. تحديث handle_order_changes_notification لعدم إرسال إشعار مكرر عند إنشاء الأوردر
-- لأن دالة process_order_transaction تتولى إنشاء الإشعار التفصيلي الشامل مباشرة
CREATE OR REPLACE FUNCTION public.handle_order_changes_notification()
RETURNS TRIGGER AS $$
DECLARE
    notification_title text;
    notification_body text;
    notification_type text;
    target_user_id uuid := NULL;
    v_cust_name text;
    v_inv_no text;
BEGIN
    v_cust_name := replace(replace(replace(COALESCE(NEW.customer_name, 'غير معروف'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_inv_no := replace(replace(replace(COALESCE(NEW.invoice_number, 'غير محدد'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

    -- أ) عند تعديل أوردر بالسيستم
    IF (TG_OP = 'UPDATE') THEN
        -- 1. تنبيه العامل عند إسناد الأوردر له لتحضيره
        IF (NEW.worker_id IS DISTINCT FROM OLD.worker_id AND NEW.worker_id IS NOT NULL) THEN
            notification_type := 'order_assigned';
            notification_title := '📋 تم تعيين أوردر جديد لك!';
            notification_body := '📦 تم إسناد الأوردر رقم: ' || v_inv_no || E'\n' ||
                                 '👤 للعميل: ' || v_cust_name || E'\n' ||
                                 'يرجى البدء في تحضير الطلب بالمخزن.';
            target_user_id := NEW.worker_id;
            
            INSERT INTO public.system_notifications (type, title, body, metadata, user_id)
            VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id), target_user_id);
        END IF;

        -- 2. تنبيه عند بدء تعديل الأوردر (تغير الحالة إلى editing)
        IF ((NEW.status = 'editing' OR NEW.status = 'in_progress') AND OLD.status NOT IN ('editing', 'in_progress')) THEN
            notification_type := 'order_edit_start';
            notification_title := '✏️ بدأ تعديل الأوردر #' || v_inv_no;
            notification_body := '👤 اسم العميل: ' || v_cust_name || E'\n' ||
                                 '👤 القائم بالتعديل: ' || COALESCE(NEW.assigned_admin_name, 'غير معروف') || E'\n' ||
                                 '💵 إجمالي المبلغ الحالي: ' || to_char(COALESCE(NEW.total_price, 0), 'FM999,999,999') || ' ج.م';
            
            INSERT INTO public.system_notifications (type, title, body, metadata)
            VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'total_price', NEW.total_price));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- إعادة ربط التريجر على UPDATE فقط بجدول orders لمنع تكرار إشعار الإنشاء
CREATE TRIGGER trg_order_changes_notification
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_changes_notification();


-- 3. تحديث دالة معالجة الأوردرات الشاملة (process_order_transaction)
-- لبناء الإشعار التفصيلي الموحد مع جلب أسماء الألوان الحقيقية بدقة من قاعدة البيانات
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
    
    -- متغيرات بناء الرسالة الموحدة
    v_cashier_name text := 'DEVO';
    v_cust_name text;
    v_phone text;
    v_address text;
    v_notes text;
    v_deposit numeric := 0;
    v_deposit_receiver text := '';
    v_total_price numeric := 0;
    v_total_series int := 0;
    v_total_pieces int := 0;
    v_remaining numeric := 0;
    v_items_details_text text := '';
    v_color_name text;
    v_model_name text;
    v_pieces_count int;
    v_notification_title text;
    v_notification_body text;
    v_notification_type text;
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

        -- منع حفظ التعديلات إذا كان الأوردر مسجلاً
        IF v_current_status = 'registered' THEN
            RAISE EXCEPTION 'عفواً، لا يمكن تعديل أو حفظ أي تغييرات على هذا الأوردر لأنه في حالة (تم التسجيل).';
        END IF;

        -- منع حفظ الأوردر إذا كان مقفولاً بواسطة مستخدم آخر (ويستثنى المالك)
        IF v_is_locked = true 
           AND (v_assigned_worker_id IS NOT NULL AND v_assigned_worker_id != auth.uid())
           AND (v_assigned_admin_name IS NOT NULL AND v_assigned_admin_name IS DISTINCT FROM (p_order_data->>'assigned_admin_name'))
           AND public.get_my_role() NOT IN ('owner') THEN
            RAISE EXCEPTION 'عفواً، هذا الأوردر مقفول حالياً بواسطة (%s) ولا يمكن حفظه.', COALESCE(v_assigned_admin_name, 'مستخدم آخر');
        END IF;

        -- أ) التحقق من توفر الكميات الإضافية المطلوبة
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
            total_series = (p_order_data->>'total_series')::integer,
            status = 'created',
            is_locked = false,
            assigned_admin_name = NULL,
            assigned_worker_id = NULL
        WHERE id = v_order_id;

        v_notification_type := 'order_updated';
        v_notification_title := '🔄 تم تعديل الأوردر #' || v_invoice_number;

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

        IF (p_order_data->>'worker_id') IS NOT NULL THEN
            UPDATE public.system_users SET invoice_count = COALESCE(invoice_count, 0) + 1 WHERE id = (p_order_data->>'worker_id')::uuid;
        END IF;

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

        v_notification_type := 'order_created';
        v_notification_title := '🚨 أوردر جديد قد وصل!';
    END IF;

    -- 🌟 تسجيل العناصر الجديدة للأوردر مع حفظ قيم القطع وبناء قائمة الأصناف للإشعار
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(
        model_id uuid, 
        color_id uuid, 
        color_name text,
        model_name text,
        qty int, 
        price numeric, 
        total numeric,
        sizes_count int,
        piece_price numeric
    )
    LOOP
        -- جلب اسم اللون بدقة من جدول colors مع بدائل أمان متعددة
        v_color_name := NULL;
        IF v_item.color_id IS NOT NULL THEN
            SELECT name INTO v_color_name FROM public.colors WHERE id = v_item.color_id;
        END IF;

        IF v_color_name IS NULL OR v_color_name = '' OR v_color_name = 'لون' THEN
            IF v_item.color_name IS NOT NULL AND v_item.color_name <> '' AND v_item.color_name <> 'لون' AND v_item.color_name <> 'غير محدد' THEN
                v_color_name := v_item.color_name;
            ELSE
                SELECT c.name INTO v_color_name 
                FROM public.model_inventory mi 
                JOIN public.colors c ON c.id = mi.color_id 
                WHERE mi.model_id = v_item.model_id AND mi.color_id = v_item.color_id 
                LIMIT 1;
            END IF;
        END IF;

        IF v_color_name IS NULL OR v_color_name = '' OR v_color_name = 'لون' THEN
            v_color_name := 'غير محدد';
        END IF;

        -- جلب اسم الموديل بدقة
        SELECT name INTO v_model_name FROM public.models WHERE id = v_item.model_id;
        IF v_model_name IS NULL OR v_model_name = '' THEN
            v_model_name := COALESCE(v_item.model_name, 'موديل');
        END IF;

        -- حساب عدد القطع في السيري
        v_pieces_count := COALESCE(v_item.sizes_count, 1);
        IF v_pieces_count <= 0 THEN
            v_pieces_count := 1;
        END IF;

        v_total_pieces := v_total_pieces + (v_item.qty * v_pieces_count);

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
        )
        VALUES (
            v_order_id, 
            v_item.model_id, 
            v_item.color_id, 
            v_item.qty, 
            v_item.price, 
            v_item.total,
            v_pieces_count,
            COALESCE(v_item.piece_price, v_item.price / v_pieces_count),
            v_item.qty * v_pieces_count
        );

        -- إضافة الصنف لنص الرسالة مع تفاصيل اللون والكمية بالقطع والسريات
        v_items_details_text := v_items_details_text || 
            '▫️ ' || replace(replace(replace(v_model_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || 
            ' (' || replace(replace(replace(v_color_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ')' || 
            ' • ' || v_item.qty || ' سيري (' || (v_item.qty * v_pieces_count) || ' ق)' || E'\n';
    END LOOP;

    -- جلب اسم الكاشير / صانع الأوردر
    IF (p_order_data->>'worker_id') IS NOT NULL THEN
        SELECT COALESCE(full_name, username, 'DEVO') INTO v_cashier_name 
        FROM public.system_users 
        WHERE id = (p_order_data->>'worker_id')::uuid;
    END IF;
    IF v_cashier_name IS NULL OR v_cashier_name = '' THEN
        v_cashier_name := 'DEVO';
    END IF;

    -- تجهيز وتنسيق بيانات الرسالة الموحدة
    v_cust_name := replace(replace(replace(COALESCE(p_order_data->>'customer_name', 'غير معروف'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_phone := COALESCE(p_order_data->>'phone_1', 'غير محدد');
    IF (p_order_data->>'phone_2') IS NOT NULL AND (p_order_data->>'phone_2') <> '' THEN
        v_phone := v_phone || ' / ' || (p_order_data->>'phone_2');
    END IF;

    v_address := replace(replace(replace(COALESCE(p_order_data->>'address', 'غير محدد'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_notes := replace(replace(replace(COALESCE(p_order_data->>'notes', ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    
    v_total_price := COALESCE((p_order_data->>'total_price')::numeric, 0);
    v_deposit := COALESCE((p_order_data->>'deposit')::numeric, 0);
    v_remaining := v_total_price - v_deposit;
    v_total_series := COALESCE((p_order_data->>'total_series')::integer, 0);
    v_deposit_receiver := COALESCE(p_order_data->>'deposit_receiver', '');

    -- بناء نص الإشعار الشامل والنهائي
    v_notification_body := '🧾 رقم الأوردر: #' || v_invoice_number || E'\n' ||
                           '👤 اسم العميل: ' || v_cust_name || E'\n' ||
                           '📞 رقم الهاتف: ' || v_phone || E'\n' ||
                           '📍 العنوان: ' || v_address || E'\n' ||
                           '💵 إجمالي المبلغ: ' || to_char(v_total_price, 'FM999,999,999') || ' ج.م' || E'\n' ||
                           '📥 المدفوع (عربون): ' || to_char(v_deposit, 'FM999,999,999') || ' ج.م' ||
                           CASE WHEN v_deposit_receiver <> '' THEN ' (المستلم: ' || v_deposit_receiver || ')' ELSE '' END || E'\n' ||
                           '⌛ المتبقي: ' || to_char(v_remaining, 'FM999,999,999') || ' ج.م' || E'\n' ||
                           '📦 الكمية: ' || v_total_series || ' سيري (' || v_total_pieces || ' قطعة)' || E'\n' ||
                           '👤 الكاشير: ' || replace(replace(replace(v_cashier_name, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

    IF v_notes <> '' THEN
        v_notification_body := v_notification_body || E'\n📝 ملاحظات: ' || v_notes;
    END IF;

    IF v_items_details_text <> '' THEN
        v_notification_body := v_notification_body || E'\n━━━━━━━━━━━━\n' || v_items_details_text;
    END IF;

    -- إدراج الإشعار الموحد في system_notifications ليتولى التريجر إرساله فورياً لتليجرام بدون تكرار
    INSERT INTO public.system_notifications (
        type, 
        title, 
        body, 
        metadata, 
        telegram_status, 
        telegram_attempts
    )
    VALUES (
        v_notification_type, 
        v_notification_title, 
        v_notification_body, 
        jsonb_build_object(
            'order_id', v_order_id, 
            'invoice_number', v_invoice_number, 
            'customer_name', p_order_data->>'customer_name', 
            'total_price', v_total_price
        ),
        'pending',
        0
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'invoice_number', v_invoice_number
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
