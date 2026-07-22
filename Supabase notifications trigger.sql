-- ============================================================
-- 1. إنشاء جدول الإشعارات اللحظية (system_notifications)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.system_notifications (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    type varchar(50) NOT NULL, -- 'order_created', 'order_updated', 'out_of_stock', 'order_assigned', 'custom_broadcast'
    title varchar(255) NOT NULL,
    body text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    user_id uuid, -- فارغ للإشعارات العامة (الأدمن)، أو يحتوي على معرف العامل لتوجيه التنبيه له
    is_read boolean NOT NULL DEFAULT false,
    is_archived boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT system_notifications_pkey PRIMARY KEY (id),
    CONSTRAINT system_notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.system_users(id) ON DELETE CASCADE
);

-- تمكين الاستماع اللحظي (Realtime) للجدول في Supabase بشكل آمن (idempotent) لتجنب أخطاء إعادة التشغيل
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_rel pr
        JOIN pg_publication p ON p.oid = pr.prpubid
        JOIN pg_class c ON c.oid = pr.prrelid
        WHERE p.pubname = 'supabase_realtime' AND c.relname = 'system_notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.system_notifications;
    END IF;
END $$;

-- ⚠️ هام جداً: تعطيل سياسة حماية الصفوف (RLS) لأن تطبيقك يستخدم تسجيل دخول مخصص بجدول system_users
-- مما يجعل المتصفح يعمل بصلاحية (anon/public) ويؤدي لظهور خطأ 401 عند إدخال أو جلب إشعارات.
ALTER TABLE public.system_notifications DISABLE ROW LEVEL SECURITY;

-- في حال رغبت بالإبقاء على RLS مفعلاً، يمكنك تشغيل السياسة التالية للسماح بالوصول العام:
-- CREATE POLICY "Allow all public actions" ON public.system_notifications FOR ALL TO public USING (true) WITH CHECK (true);


-- ============================================================
-- 2. أتمتة إشعارات الطلبات (إضافة / تعديل / إسناد لعامل)
-- ============================================================
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
        -- 1. تحقق مما إذا كان هناك تغيير في العامل المسند إليه تحضير الأوردر
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

        -- 2. تحقق من وجود تعديلات أخرى هامة (مثل حالة الطلب أو تعديل الأصناف وإعادة الحفظ)
        IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.total_price IS DISTINCT FROM OLD.total_price OR NEW.is_locked IS DISTINCT FROM OLD.is_locked) THEN
            notification_type := 'order_updated';
            notification_title := '🔄 تحديث في الأوردر #' || COALESCE(NEW.invoice_number, 'غير محدد');
            notification_body := '👤 اسم العميل: ' || COALESCE(NEW.customer_name, 'غير معروف') || E'\n' ||
                                 '📊 الحالة الحالية: ' || COALESCE(NEW.status, 'غير معروف') || E'\n' ||
                                 '💵 إجمالي المبلغ: ' || NEW.total_price || ' ج.م';
            
            INSERT INTO public.system_notifications (type, title, body, metadata)
            VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'total_price', NEW.total_price));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ربط التريجر بجدول الطلبات
DROP TRIGGER IF EXISTS trg_order_changes_notification ON public.orders;
CREATE TRIGGER trg_order_changes_notification
AFTER INSERT OR UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.handle_order_changes_notification();

-- ============================================================
-- 3. أتمتة إشعارات نفاد المخزون للألوان والموديلات (الوصول لـ 0)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_inventory_out_of_stock()
RETURNS TRIGGER AS $$
DECLARE
    model_factory_code text;
    color_name text;
    notification_title text;
    notification_body text;
BEGIN
    -- التحقق من وصول أعداد السيريات المتاحة للصفر (نفاد المخزون للون)
    IF (NEW.available_series = 0 AND (OLD.available_series > 0 OR OLD.available_series IS NULL)) THEN
        -- جلب كود الموديل المصنعي واسم اللون
        SELECT factory_code INTO model_factory_code FROM public.models WHERE id = NEW.model_id;
        SELECT name INTO color_name FROM public.colors WHERE id = NEW.color_id;
        
        notification_title := '⚠️ نفاد كمية من المخزن!';
        notification_body := 'لقد نفد مخزون الموديل (' || COALESCE(model_factory_code, 'غير معروف') || ') للون (' || COALESCE(color_name, 'غير معروف') || ') بالكامل من المخزن.';
        
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES ('out_of_stock', notification_title, notification_body, jsonb_build_object('model_id', NEW.model_id, 'color_id', NEW.color_id, 'model_code', model_factory_code, 'color_name', color_name));
        
    -- التحقق من عودة الكمية للتوفر بعد أن كانت صفراً (تعديل أوردر، إلغاء صنف، أو إرجاع)
    ELSIF (NEW.available_series > 0 AND OLD.available_series = 0) THEN
        -- جلب كود الموديل المصنعي واسم اللون
        SELECT factory_code INTO model_factory_code FROM public.models WHERE id = NEW.model_id;
        SELECT name INTO color_name FROM public.colors WHERE id = NEW.color_id;
        
        notification_title := '✅ عودة توفر صنف في المخزن!';
        notification_body := 'أصبح الموديل (' || COALESCE(model_factory_code, 'غير معروف') || ') للون (' || COALESCE(color_name, 'غير معروف') || ') متاحاً منه عدد (' || NEW.available_series || ') سري مرة أخرى بعد تحديث المخزن/الأوردر.';
        
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES ('restocked', notification_title, notification_body, jsonb_build_object('model_id', NEW.model_id, 'color_id', NEW.color_id, 'model_code', model_factory_code, 'color_name', color_name, 'available_series', NEW.available_series));
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ربط التريجر بجدول الجرد والمخزن
DROP TRIGGER IF EXISTS trg_inventory_out_of_stock ON public.model_inventory;
CREATE TRIGGER trg_inventory_out_of_stock
AFTER INSERT OR UPDATE ON public.model_inventory
FOR EACH ROW
EXECUTE FUNCTION public.handle_inventory_out_of_stock();

-- ============================================================
-- 4. إعداد وتفعيل إرسال الإشعارات إلى بوت التليجرام (Telegram Bot)
-- ============================================================

-- تفعيل امتداد pg_net المخصص لإرسال طلبات HTTP غير الحظرية في الخلفية من داتا بيز Supabase
CREATE EXTENSION IF NOT EXISTS pg_net;

-- وظيفة إرسال الإشعار للتليجرام
CREATE OR REPLACE FUNCTION public.send_telegram_notification_trigger()
RETURNS TRIGGER AS $$
DECLARE
    bot_token text;
    chat_id text;
    is_tg_enabled text;
    formatted_message text;
    should_send_tg boolean := true;
BEGIN
    -- إذا كان البث مخصصاً من الأدمن، نتحقق من اختيار إرساله للتليجرام بالميتاداتا
    IF (NEW.type = 'custom_broadcast') THEN
        IF (COALESCE(NEW.metadata->>'send_to_telegram', 'false') <> 'true') THEN
            should_send_tg := false;
        END IF;
    END IF;

    -- جلب إعدادات تليجرام الحالية من جدول الإعدادات
    SELECT setting_value INTO bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';

    -- تحديد معرف المجموعة المستهدفة بناءً على نوع التنبيه (مخزن أم طلبات)
    IF (NEW.type = 'out_of_stock' OR NEW.type = 'restocked') THEN
        SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_stock_chat_id';
        -- في حال عدم إعداد جروب المخزن بعد، نقع كاحتياط على جروب الطلبات الرئيسي
        IF (chat_id IS NULL OR chat_id = '') THEN
            SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
        END IF;
    ELSE
        SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    END IF;

    -- التحقق من تفعيل الخدمة ووجود التوكن ومعرف الشات وخيار الإرسال
    IF (should_send_tg AND is_tg_enabled = 'true' AND bot_token IS NOT NULL AND chat_id IS NOT NULL AND bot_token <> '' AND chat_id <> '') THEN
        -- تنسيق الرسالة بشكل أنيق للتيليجرام باستخدام HTML
        formatted_message := '<b>' || COALESCE(NEW.title, 'تنبيه جديد') || '</b>' || E'\n\n' || COALESCE(NEW.body, '');

        -- إرسال الطلب غير الحظري للخلفية لضمان سرعة المعاملات بالداتا بيز وعدم حظرها
        PERFORM net.http_post(
            url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
            body := jsonb_build_object(
                'chat_id', chat_id,
                'text', formatted_message,
                'parse_mode', 'HTML'
            ),
            headers := '{"Content-Type": "application/json"}'::jsonb
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ربط التريجر بجدول الإشعارات المركزي
DROP TRIGGER IF EXISTS trg_send_telegram_notification ON public.system_notifications;
CREATE TRIGGER trg_send_telegram_notification
AFTER INSERT ON public.system_notifications
FOR EACH ROW
EXECUTE FUNCTION public.send_telegram_notification_trigger();


-- ============================================================
-- 5. دالة معالجة الأوردرات وجرد المخزن المحسنة (حساب الفروقات الصافية)
-- ============================================================
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
        SELECT invoice_number INTO v_invoice_number FROM public.orders WHERE id = v_order_id;

        -- أ) التحقق من توفر الكميات الإضافية المطلوبة (قبل تعديل المخزن)
        -- بالنسبة لكل صنف زاد طلبه (diff > 0)، نتحقق من وجود رصيد كافٍ
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
                
                IF v_current_stock < v_diff_record.diff THEN
                    RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة. المتاح بالمخزن: %, المطلوب زيادة: %', 
                        v_diff_record.model_name, v_current_stock, v_diff_record.diff;
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
                -- تحديث المخزن بالفرق الصافي دفعة واحدة
                UPDATE public.model_inventory
                SET available_series = available_series - v_diff_record.diff
                WHERE model_id = v_diff_record.model_id AND color_id = v_diff_record.color_id;

                -- تسجيل الحركة بالفرق الصافي
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

    ELSE
        -- 🌟 وضع إنشاء جديد (Insert)
        -- أ) التحقق من المخزون أولاً
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, model_name text)
        LOOP
            SELECT available_series INTO v_current_stock FROM public.model_inventory
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id FOR UPDATE;

            IF v_current_stock < v_item.qty THEN
               RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة. المتاح: %', v_item.model_name, v_current_stock;
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

        -- خصم المخزون وتسجيل الحركات
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int)
        LOOP
            UPDATE public.model_inventory SET available_series = available_series - v_item.qty
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

            INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
            VALUES (v_item.model_id, v_item.color_id, 'out', v_item.qty, 'فاتورة مبيعات: ' || v_invoice_number);
        END LOOP;

    END IF;

    -- 🌟 تسجيل العناصر الجديدة للأوردر (يحدث في وضع الإنشاء والتعديل)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, price numeric, total numeric)
    LOOP
        INSERT INTO public.order_items (order_id, model_id, color_id, quantity, price_per_series, total_price)
        VALUES (v_order_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

