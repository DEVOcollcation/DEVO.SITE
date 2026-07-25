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
-- 1.5. إنشاء جدول طابور تنبيهات المخزون المؤقت لإرسال رسائل مجمعة للتليجرام
-- ============================================================
CREATE TABLE IF NOT EXISTS public.inventory_notification_queue (
    transaction_id text NOT NULL,
    model_id uuid NOT NULL,
    color_id uuid NOT NULL,
    new_available_series int NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pk_inventory_notification_queue PRIMARY KEY (transaction_id, model_id, color_id)
);
ALTER TABLE public.inventory_notification_queue DISABLE ROW LEVEL SECURITY;


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
        
        -- إدراج التغيير في جدول الطابور المؤقت لمعالجته بنهاية المعاملة للتليجرام
        INSERT INTO public.inventory_notification_queue (transaction_id, model_id, color_id, new_available_series)
        VALUES (pg_current_xact_id()::text, NEW.model_id, NEW.color_id, 0)
        ON CONFLICT (transaction_id, model_id, color_id)
        DO UPDATE SET new_available_series = 0;
        
    -- التحقق من عودة الكمية للتوفر بعد أن كانت صفراً (تعديل أوردر، إلغاء صنف، أو إرجاع)
    ELSIF (NEW.available_series > 0 AND OLD.available_series = 0) THEN
        -- جلب كود الموديل المصنعي واسم اللون
        SELECT factory_code INTO model_factory_code FROM public.models WHERE id = NEW.model_id;
        SELECT name INTO color_name FROM public.colors WHERE id = NEW.color_id;
        
        notification_title := '✅ عودة توفر صنف في المخزن!';
        notification_body := 'أصبح الموديل (' || COALESCE(model_factory_code, 'غير معروف') || ') للون (' || COALESCE(color_name, 'غير معروف') || ') متاحاً منه عدد (' || NEW.available_series || ') سري مرة أخرى بعد تحديث المخزن/الأوردر.';
        
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES ('restocked', notification_title, notification_body, jsonb_build_object('model_id', NEW.model_id, 'color_id', NEW.color_id, 'model_code', model_factory_code, 'color_name', color_name, 'available_series', NEW.available_series));
        
        -- إدراج التغيير في جدول الطابور المؤقت لمعالجته بنهاية المعاملة للتليجرام
        INSERT INTO public.inventory_notification_queue (transaction_id, model_id, color_id, new_available_series)
        VALUES (pg_current_xact_id()::text, NEW.model_id, NEW.color_id, NEW.available_series)
        ON CONFLICT (transaction_id, model_id, color_id)
        DO UPDATE SET new_available_series = EXCLUDED.new_available_series;
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
-- 3.5. معالجة طابور تنبيهات المخزون مجمعة بنهاية المعاملة (Constraint Trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_inventory_notification_queue()
RETURNS TRIGGER AS $$
DECLARE
    v_tx_id text;
    v_bot_token text;
    v_is_tg_enabled text;
    v_is_stock_enabled text;
    v_chat_id text;
    
    v_model_record RECORD;
    v_color_record RECORD;
    
    v_model_name text;
    v_factory_code text;
    v_category_name text;
    v_class_name text;
    
    v_out_colors text;
    v_color_name text;
    v_message text;
    v_has_rows boolean := false;
BEGIN
    v_tx_id := pg_current_xact_id()::text;
    
    -- تحقق أولاً إذا كان هناك أي عناصر مسجلة لهذه المعاملة
    SELECT EXISTS (
        SELECT 1 FROM public.inventory_notification_queue WHERE transaction_id = v_tx_id
    ) INTO v_has_rows;
    
    IF NOT v_has_rows THEN
        RETURN NULL;
    END IF;

    -- جلب إعدادات التليجرام
    SELECT setting_value INTO v_bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO v_is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';
    SELECT setting_value INTO v_is_stock_enabled FROM public.home_settings WHERE setting_key = 'telegram_stock_enabled';
    
    -- الإرسال فقط إذا كان التليجرام وبوت المخزن مفعلين
    IF (v_is_tg_enabled = 'true' AND COALESCE(v_is_stock_enabled, 'true') = 'true' AND v_bot_token IS NOT NULL AND v_bot_token <> '') THEN
        -- تحديد جروب المخازن
        SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_stock_chat_id';
        IF (v_chat_id IS NULL OR v_chat_id = '') THEN
            SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
        END IF;
        
        IF (v_chat_id IS NOT NULL AND v_chat_id <> '') THEN
            -- التكرار على الموديلات المتأثرة في هذه المعاملة
            FOR v_model_record IN 
                SELECT DISTINCT model_id 
                FROM public.inventory_notification_queue 
                WHERE transaction_id = v_tx_id
            LOOP
                -- جلب تفاصيل الموديل والتصنيفات
                SELECT 
                    m.name, 
                    m.factory_code, 
                    cat.name as category_name, 
                    cls.name as class_name
                INTO 
                    v_model_name, 
                    v_factory_code, 
                    v_category_name, 
                    v_class_name
                FROM public.models m
                LEFT JOIN public.categories cat ON cat.id = m.category_id
                LEFT JOIN public.classes cls ON cls.id = m.class_id
                WHERE m.id = v_model_record.model_id;
                
                v_out_colors := '';
                
                -- تجميع الألوان المرتبطة بهذا الموديل
                FOR v_color_record IN 
                    SELECT q.color_id, q.new_available_series
                    FROM public.inventory_notification_queue q
                    WHERE q.transaction_id = v_tx_id 
                      AND q.model_id = v_model_record.model_id
                LOOP
                    SELECT name INTO v_color_name FROM public.colors WHERE id = v_color_record.color_id;
                    
                    IF v_color_record.new_available_series = 0 THEN
                        v_out_colors := v_out_colors || E'• ' || COALESCE(v_color_name, 'غير معروف') || E' (نفد ❌)\n';
                    ELSE
                        v_out_colors := v_out_colors || E'• ' || COALESCE(v_color_name, 'غير معروف') || ' (' || v_color_record.new_available_series || E' سري متاح ✅)\n';
                    END IF;
                END LOOP;
                
                -- تجهيز وإرسال الرسالة
                IF (v_out_colors <> '') THEN
                    -- ترميز الحروف الخاصة بالـ HTML لمنع فشل التليجرام
                    v_model_name := replace(replace(replace(COALESCE(v_model_name, 'غير معروف'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
                    v_factory_code := replace(replace(replace(COALESCE(v_factory_code, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
                    v_category_name := replace(replace(replace(COALESCE(v_category_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
                    v_class_name := replace(replace(replace(COALESCE(v_class_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
                    
                    v_message := '<b>📦 تحديث حالة الموديل:</b> ' || v_model_name || E'\n';
                    IF (v_factory_code <> '') THEN
                        v_message := v_message || '<b>🏷️ كود المصنع:</b> <code>' || v_factory_code || E'</code>\n';
                    END IF;
                    IF (v_category_name <> '') THEN
                        v_message := v_message || '<b>📝 التصنيف/الوصف:</b> ' || v_category_name || E'\n';
                    END IF;
                    IF (v_class_name <> '') THEN
                        v_message := v_message || '<b>👥 الفئة العمرية:</b> ' || v_class_name || E'\n';
                    END IF;
                    v_message := v_message || E'\n';
                    v_message := v_message || E'<b>الألوان وحالتها بالمخزن:</b>\n' || v_out_colors;
                    
                    -- إرسال الطلب غير الحظري عبر pg_net
                    PERFORM net.http_post(
                        url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
                        body := jsonb_build_object(
                            'chat_id', v_chat_id,
                            'text', v_message,
                            'parse_mode', 'HTML'
                        ),
                        headers := '{"Content-Type": "application/json"}'::jsonb
                    );
                END IF;
            END LOOP;
        END IF;
    END IF;
    
    -- تفريغ الطابور لهذه المعاملة
    DELETE FROM public.inventory_notification_queue WHERE transaction_id = v_tx_id;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ربط التريجر كـ Constraint Trigger مؤجل للنهاية (INITIALLY DEFERRED)
DROP TRIGGER IF EXISTS trg_deferred_inventory_notification ON public.model_inventory;
CREATE CONSTRAINT TRIGGER trg_deferred_inventory_notification
AFTER INSERT OR UPDATE ON public.model_inventory
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.process_inventory_notification_queue();


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
BEGIN
    -- تخطي إشعارات المخزون الفردية لأنها تُرسل مجمّعة ومصنفة بالتريجر المؤجل
    IF (NEW.type = 'out_of_stock' OR NEW.type = 'restocked') THEN
        RETURN NEW;
    END IF;

    -- جلب إعدادات تليجرام الحالية من جدول الإعدادات
    SELECT setting_value INTO bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';

    -- إذا كان البث مخصصاً من الأدمن، نتحقق من اختيار إرساله للتليجرام والجهة المحددة بالميتاداتا
    IF (NEW.type = 'custom_broadcast') THEN
        DECLARE
            v_tg_target text;
            v_orders_chat text;
            v_stock_chat text;
            v_title text;
            v_body text;
        BEGIN
            v_tg_target := COALESCE(NEW.metadata->>'telegram_target', 'none');
            
            -- التحقق من التفعيل والتوكن والهدف
            IF (v_tg_target = 'none' OR is_tg_enabled <> 'true' OR bot_token IS NULL OR bot_token = '') THEN
                RETURN NEW;
            END IF;
            
            SELECT setting_value INTO v_orders_chat FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
            SELECT setting_value INTO v_stock_chat FROM public.home_settings WHERE setting_key = 'telegram_stock_chat_id';
            
            -- ترميز الحروف الخاصة لحماية الـ HTML من أخطاء التحليل
            v_title := replace(replace(replace(COALESCE(NEW.title, 'تنبيه مخصص'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            v_body := replace(replace(replace(COALESCE(NEW.body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            formatted_message := '<b>' || v_title || '</b>' || E'\n\n' || v_body;
            
            -- الإرسال لمجموعة الطلبات
            IF ((v_tg_target = 'orders' OR v_tg_target = 'both') AND v_orders_chat IS NOT NULL AND v_orders_chat <> '') THEN
                PERFORM net.http_post(
                    url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
                    body := jsonb_build_object('chat_id', v_orders_chat, 'text', formatted_message, 'parse_mode', 'HTML'),
                    headers := '{"Content-Type": "application/json"}'::jsonb
                );
            END IF;
            
            -- الإرسال لمجموعة المخازن
            IF ((v_tg_target = 'stock' OR v_tg_target = 'both') AND v_stock_chat IS NOT NULL AND v_stock_chat <> '') THEN
                PERFORM net.http_post(
                    url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
                    body := jsonb_build_object('chat_id', v_stock_chat, 'text', formatted_message, 'parse_mode', 'HTML'),
                    headers := '{"Content-Type": "application/json"}'::jsonb
                );
            END IF;
            
            RETURN NEW;
        END;
    END IF;

    -- للأنواع الأخرى (إشعارات الطلبات)
    SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';

    -- التحقق من تفعيل الخدمة ووجود التوكن ومعرف الشات
    IF (is_tg_enabled = 'true' AND bot_token IS NOT NULL AND chat_id IS NOT NULL AND bot_token <> '' AND chat_id <> '') THEN
        DECLARE
            v_title text;
            v_body text;
        BEGIN
            -- ترميز الحروف الخاصة لحماية الـ HTML من أخطاء التحليل
            v_title := replace(replace(replace(COALESCE(NEW.title, 'تنبيه جديد'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            v_body := replace(replace(replace(COALESCE(NEW.body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            formatted_message := '<b>' || v_title || '</b>' || E'\n\n' || v_body;

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
        END;
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

        -- 🛡️ منع تعديل الأوردر إذا كان مقفولاً من قبل مستخدم آخر (ويستثنى من قيد القفل المالك والمشرف) (حل خطأ 2)
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

        -- أ) التحقق من توفر الكميات الإضافية المطلوبة (قبل تعديل المخزن) (حل خطأ 1)
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
                -- التدميج مع جدول المخزن لضمان وجود الصف قبل تحديثه
                INSERT INTO public.model_inventory (model_id, color_id, available_series)
                VALUES (v_diff_record.model_id, v_diff_record.color_id, 0)
                ON CONFLICT (model_id, color_id) DO NOTHING;

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
        -- أ) التحقق من المخزون أولاً (حل خطأ 1)
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

        -- خصم المخزون وتسجيل الحركات
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

    -- 🌟 تسجيل العناصر الجديدة للأوردر (يحدث في وضع الإنشاء والتعديل)
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, price numeric, total numeric)
    LOOP
        INSERT INTO public.order_items (order_id, model_id, color_id, quantity, price_per_series, total_price)
        VALUES (v_order_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- تهيئة الإعدادات الافتراضية لمركز الإشعارات والربط
INSERT INTO public.home_settings (setting_key, setting_value) VALUES 
('telegram_stock_enabled', 'true'),
('web_notifications_enabled', 'true')
ON CONFLICT (setting_key) DO NOTHING;


