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
        notification_body := 'أوردر جديد برقم #' || NEW.id || ' للعميل: ' || COALESCE(NEW.customer_name, 'عميل غير معروف') || ' بإجمالي: ' || NEW.total_price || ' ج.م';
        
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id, 'customer_name', NEW.customer_name, 'total_price', NEW.total_price));
        
    -- ب) عند تعديل أوردر بالسيستم
    ELSIF (TG_OP = 'UPDATE') THEN
        -- 1. تحقق مما إذا كان هناك تغيير في العامل المسند إليه تحضير الأوردر
        IF (NEW.worker_id IS DISTINCT FROM OLD.worker_id AND NEW.worker_id IS NOT NULL) THEN
            notification_type := 'order_assigned';
            notification_title := '📋 تم تعيين أوردر جديد لك!';
            notification_body := 'تم إسناد الأوردر #' || NEW.id || ' إليك للبدء في تحضيره بالمخزن.';
            target_user_id := NEW.worker_id;
            
            INSERT INTO public.system_notifications (type, title, body, metadata, user_id)
            VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id), target_user_id);
        END IF;

        -- 2. تحقق من وجود تعديلات أخرى هامة (مثل حالة الطلب أو تعديل الأصناف وإعادة الحفظ)
        IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.total_price IS DISTINCT FROM OLD.total_price OR NEW.is_locked IS DISTINCT FROM OLD.is_locked) THEN
            notification_type := 'order_updated';
            notification_title := '🔄 تحديث في الأوردر #' || NEW.id;
            notification_body := 'تم تعديل بيانات الأوردر الخاص بالعميل ' || COALESCE(NEW.customer_name, 'عميل') || '. الحالة الحالية: ' || COALESCE(NEW.status, 'غير معروف') || '، الإجمالي: ' || NEW.total_price || ' ج.م';
            
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
BEGIN
    -- جلب إعدادات تليجرام الحالية من جدول الإعدادات
    SELECT setting_value INTO bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    SELECT setting_value INTO is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';

    -- التحقق من تفعيل الخدمة ووجود التوكن ومعرف الشات
    IF (is_tg_enabled = 'true' AND bot_token IS NOT NULL AND chat_id IS NOT NULL AND bot_token <> '' AND chat_id <> '') THEN
        -- تنسيق الرسالة بشكل أنيق للتيليجرام باستخدام HTML
        formatted_message := '<b>' || COALESCE(NEW.title, 'تنبيه جديد') || '</b>' || E'\n\n' || COALESCE(NEW.body, '');

        -- إرسال الطلب غير الحظري للخلفية لضمان سرعة المعاملات بالداتا بيز وعدم حظرها
        PERFORM net.http_post(
            url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
            body := jsonb_build_object(
                'chat_id', chat_id,
                'text', formatted_message,
                'parse_mode', 'HTML'
            )::text,
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

