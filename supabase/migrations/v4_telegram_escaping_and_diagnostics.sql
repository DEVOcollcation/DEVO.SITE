-- =========================================================================
-- 🌟 MIGRATION V4: TELEGRAM HTML ESCAPING AND SAFETY ENHANCEMENTS 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-07-24
-- الإصدار: v4.0
-- الوصف: 
-- 1. حماية وتشفير الرموز الخاصة (&, <, >) لأسماء العملاء، الألوان، والملاحظات في دوال تريجر التليجرام لضمان عدم رفض الرسائل كأخطاء HTML.
-- 2. تحديث handle_order_changes_notification و process_inventory_notification_queue بالكامل مع حماية الـ HTML Entities.
-- =========================================================================

-- 1. تحديث دالة أتمتة إشعارات الطلبات وتشفير النصوص الخاصة
CREATE OR REPLACE FUNCTION public.handle_order_changes_notification()
RETURNS TRIGGER AS $$
DECLARE
    notification_title text;
    notification_body text;
    notification_type text;
    target_user_id uuid := NULL;
    v_cust_name text;
    v_notes text;
    v_address text;
    v_inv_no text;
BEGIN
    -- تشفير الحروف الخاصة لحماية تنسيق HTML في رسائل التليجرام
    v_cust_name := replace(replace(replace(COALESCE(NEW.customer_name, 'غير معروف'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_notes := replace(replace(replace(COALESCE(NEW.notes, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_address := replace(replace(replace(COALESCE(NEW.address, 'غير محدد'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
    v_inv_no := replace(replace(replace(COALESCE(NEW.invoice_number, 'غير محدد'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

    -- أ) عند إضافة أوردر جديد بالسيستم
    IF (TG_OP = 'INSERT') THEN
        notification_type := 'order_created';
        notification_title := '🚨 أوردر جديد قد وصل!';
        notification_body := '🧾 رقم الأوردر: ' || v_inv_no || E'\n' ||
                             '👤 اسم العميل: ' || v_cust_name || E'\n' ||
                             '📞 رقم الهاتف: ' || COALESCE(NEW.phone_1, 'غير محدد') || 
                             CASE WHEN NEW.phone_2 IS NOT NULL AND NEW.phone_2 <> '' THEN ' / ' || NEW.phone_2 ELSE '' END || E'\n' ||
                             '📍 العنوان: ' || v_address || E'\n' ||
                             '💵 إجمالي المبلغ: ' || NEW.total_price || ' ج.م' ||
                             CASE WHEN v_notes <> '' THEN E'\n📝 ملاحظات: ' || v_notes ELSE '' END;
        
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id, 'customer_name', NEW.customer_name, 'total_price', NEW.total_price));
        
    -- ب) عند تعديل أوردر بالسيستم
    ELSIF (TG_OP = 'UPDATE') THEN
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

        IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.total_price IS DISTINCT FROM OLD.total_price OR NEW.is_locked IS DISTINCT FROM OLD.is_locked) THEN
            notification_type := 'order_updated';
            notification_title := '🔄 تحديث في الأوردر #' || v_inv_no;
            notification_body := '👤 اسم العميل: ' || v_cust_name || E'\n' ||
                                 '📊 الحالة الحالية: ' || COALESCE(NEW.status, 'غير معروف') || E'\n' ||
                                 '💵 إجمالي المبلغ: ' || NEW.total_price || ' ج.م';
            
            INSERT INTO public.system_notifications (type, title, body, metadata)
            VALUES (notification_type, notification_title, notification_body, jsonb_build_object('order_id', NEW.id, 'status', NEW.status, 'total_price', NEW.total_price));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 2. تحديث معالجة طابور تنبيهات المخزون مجمعة مع تشفير أسماء الألوان
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
    
    SELECT EXISTS (
        SELECT 1 FROM public.inventory_notification_queue WHERE transaction_id = v_tx_id
    ) INTO v_has_rows;
    
    IF NOT v_has_rows THEN
        RETURN NULL;
    END IF;

    SELECT setting_value INTO v_bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO v_is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';
    SELECT setting_value INTO v_is_stock_enabled FROM public.home_settings WHERE setting_key = 'telegram_stock_enabled';
    
    IF (v_is_tg_enabled = 'true' AND COALESCE(v_is_stock_enabled, 'true') = 'true' AND v_bot_token IS NOT NULL AND v_bot_token <> '') THEN
        SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_stock_chat_id';
        IF (v_chat_id IS NULL OR v_chat_id = '') THEN
            SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
        END IF;
        
        IF (v_chat_id IS NOT NULL AND v_chat_id <> '') THEN
            FOR v_model_record IN 
                SELECT DISTINCT model_id 
                FROM public.inventory_notification_queue 
                WHERE transaction_id = v_tx_id
            LOOP
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
                
                FOR v_color_record IN 
                    SELECT q.color_id, q.new_available_series
                    FROM public.inventory_notification_queue q
                    WHERE q.transaction_id = v_tx_id 
                      AND q.model_id = v_model_record.model_id
                LOOP
                    SELECT name INTO v_color_name FROM public.colors WHERE id = v_color_record.color_id;
                    v_color_name := replace(replace(replace(COALESCE(v_color_name, 'غير معروف'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
                    
                    IF v_color_record.new_available_series = 0 THEN
                        v_out_colors := v_out_colors || E'• ' || v_color_name || E' (نفد ❌)\n';
                    ELSE
                        v_out_colors := v_out_colors || E'• ' || v_color_name || ' (' || v_color_record.new_available_series || E' سري متاح ✅)\n';
                    END IF;
                END LOOP;
                
                IF (v_out_colors <> '') THEN
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
    
    DELETE FROM public.inventory_notification_queue WHERE transaction_id = v_tx_id;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
