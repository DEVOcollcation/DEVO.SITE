-- ==============================================================================
-- 🚀 V17: طبقة معالجة فشل الإرسال وإعادة المحاولة الذكية بدون تكرار (Telegram Retry Layer)
-- ==============================================================================
-- 1. إضافة أعمدة تتبع حالة إرسال التليجرام بجدول system_notifications.
-- 2. إرسال الرسالة الموجزة مباشرة وفورياً مع قفل حظر التكرار (Idempotency).
-- 3. تسجيل نجاح أو فشل الإرسال بدقة لإتاحة إعادة المحاولة التلقائية واليدوية.
-- ==============================================================================

-- 1. إضافة أعمدة تتبع حالة التليجرام
ALTER TABLE public.system_notifications 
ADD COLUMN IF NOT EXISTS telegram_status varchar(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS telegram_sent_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS telegram_attempts int DEFAULT 0,
ADD COLUMN IF NOT EXISTS telegram_last_error text;

-- فهرس لتحسين سرعة فحص الإشعارات المعلقة والفاشلة
CREATE INDEX IF NOT EXISTS idx_system_notifications_tg_status 
ON public.system_notifications (telegram_status, created_at)
WHERE telegram_status IN ('pending', 'failed');


-- 2. دالة وتريجر إرسال التليجرام المحدثة
CREATE OR REPLACE FUNCTION public.send_telegram_notification_trigger()
RETURNS TRIGGER AS $$
DECLARE
    bot_token text;
    chat_id text;
    is_tg_enabled text;
    formatted_message text;
BEGIN
    -- قفل حظر التكرار: إذا تم إرسال الإشعار مسبقاً نخرج فوراً
    IF (NEW.telegram_status = 'sent') THEN
        RETURN NEW;
    END IF;

    -- استبعاد إشعارات المخزون وإشعارات النسخ الاحتياطي (لأن لها قنوات مستقلة)
    IF (NEW.type = 'out_of_stock' OR NEW.type = 'restocked' OR NEW.type = 'system_backup_completed') THEN
        RETURN NEW;
    END IF;

    SELECT setting_value INTO bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';

    -- أ) إشعار إصدار التقارير المجدولة واليدوية
    IF (NEW.type = 'telegram_report_dispatched') THEN
        DECLARE
            v_group_link text;
            v_rep_type text;
        BEGIN
            SELECT setting_value INTO v_group_link FROM public.home_settings WHERE setting_key = 'telegram_reports_group_link';
            IF v_group_link IS NULL OR v_group_link = '' THEN
                v_group_link := 'https://t.me/+3LkR_kgCBPY3MzFk';
            END IF;

            SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';

            IF (is_tg_enabled = 'true' AND bot_token IS NOT NULL AND chat_id IS NOT NULL AND bot_token <> '' AND chat_id <> '') THEN
                v_rep_type := COALESCE(NEW.metadata->>'report_type', 'daily');
                
                IF v_rep_type = 'yearly' THEN
                    formatted_message := '🏆 <b>تم إصدار التقرير السنوي الشامل بنجاح</b>' || E'\n' ||
                                         '━━━━━━━━━━━━' || E'\n' ||
                                         'تم إرسال التقرير السنوي الختامي المفصل بالكامل إلى جروب التقارير.' || E'\n\n' ||
                                         '👉 <a href="' || v_group_link || '">اضغط هنا لفتح وقراءة التقرير في جروب التقارير</a>';
                ELSIF v_rep_type = 'monthly' THEN
                    formatted_message := '🗓️ <b>تم إصدار التقرير الشهري بنجاح</b>' || E'\n' ||
                                         '━━━━━━━━━━━━' || E'\n' ||
                                         'تم إرسال التقرير المالي والإداري الشهري المفصل بالكامل إلى جروب التقارير.' || E'\n\n' ||
                                         '👉 <a href="' || v_group_link || '">اضغط هنا لفتح وقراءة التقرير في جروب التقارير</a>';
                ELSIF v_rep_type = 'weekly' THEN
                    formatted_message := '📅 <b>تم إصدار تقرير الأسبوع بنجاح</b>' || E'\n' ||
                                         '━━━━━━━━━━━━' || E'\n' ||
                                         'تم إرسال التقرير الأسبوعي المفصل بالكامل إلى جروب التقارير.' || E'\n\n' ||
                                         '👉 <a href="' || v_group_link || '">اضغط هنا لفتح وقراءة التقرير في جروب التقارير</a>';
                ELSE
                    formatted_message := '📊 <b>تم إصدار تقرير اليوم بنجاح</b>' || E'\n' ||
                                         '━━━━━━━━━━━━' || E'\n' ||
                                         'تم إرسال التقرير اليومي المفصل بالكامل إلى جروب التقارير.' || E'\n\n' ||
                                         '👉 <a href="' || v_group_link || '">اضغط هنا لفتح وقراءة التقرير في جروب التقارير</a>';
                END IF;

                PERFORM net.http_post(
                    url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
                    body := jsonb_build_object(
                        'chat_id', chat_id,
                        'text', formatted_message,
                        'parse_mode', 'HTML'
                    ),
                    headers := '{"Content-Type": "application/json"}'::jsonb
                );
                
                UPDATE public.system_notifications 
                SET telegram_status = 'sent', telegram_sent_at = NOW(), telegram_attempts = COALESCE(telegram_attempts, 0) + 1
                WHERE id = NEW.id;
            END IF;

            RETURN NEW;
        END;
    END IF;

    -- ب) إرسال البث المخصص (Custom Broadcast)
    IF (NEW.type = 'custom_broadcast') THEN
        DECLARE
            v_tg_target text;
            v_orders_chat text;
            v_stock_chat text;
            v_title text;
            v_body text;
        BEGIN
            v_tg_target := COALESCE(NEW.metadata->>'telegram_target', 'none');
            
            IF (v_tg_target = 'none' OR is_tg_enabled <> 'true' OR bot_token IS NULL OR bot_token = '') THEN
                RETURN NEW;
            END IF;
            
            SELECT setting_value INTO v_orders_chat FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
            SELECT setting_value INTO v_stock_chat FROM public.home_settings WHERE setting_key = 'telegram_stock_chat_id';
            
            v_title := replace(replace(replace(COALESCE(NEW.title, 'تنبيه مخصص'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            v_body := replace(replace(replace(COALESCE(NEW.body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            formatted_message := '<b>' || v_title || '</b>' || E'\n\n' || v_body;
            
            IF ((v_tg_target = 'orders' OR v_tg_target = 'both') AND v_orders_chat IS NOT NULL AND v_orders_chat <> '') THEN
                PERFORM net.http_post(
                    url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
                    body := jsonb_build_object('chat_id', v_orders_chat, 'text', formatted_message, 'parse_mode', 'HTML'),
                    headers := '{"Content-Type": "application/json"}'::jsonb
                );
            END IF;
            
            IF ((v_tg_target = 'stock' OR v_tg_target = 'both') AND v_stock_chat IS NOT NULL AND v_stock_chat <> '') THEN
                PERFORM net.http_post(
                    url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
                    body := jsonb_build_object('chat_id', v_stock_chat, 'text', formatted_message, 'parse_mode', 'HTML'),
                    headers := '{"Content-Type": "application/json"}'::jsonb
                );
            END IF;
            
            UPDATE public.system_notifications 
            SET telegram_status = 'sent', telegram_sent_at = NOW(), telegram_attempts = COALESCE(telegram_attempts, 0) + 1
            WHERE id = NEW.id;
            
            RETURN NEW;
        END;
    END IF;

    -- ج) إشعارات الأوردرات الجديدة وبقية التنبيهات (الرسالة الموجزة)
    IF (is_tg_enabled <> 'true' OR bot_token IS NULL OR bot_token = '') THEN
        UPDATE public.system_notifications 
        SET telegram_status = 'failed', telegram_last_error = 'خدمة تليجرام معطلة أو التوكن غير متوفر'
        WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    IF (chat_id IS NULL OR chat_id = '') THEN
        UPDATE public.system_notifications 
        SET telegram_status = 'failed', telegram_last_error = 'معرف مجموعة الأوردرات غير محدد'
        WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    -- توحيد ومعالجة مجموعات السوبر جروب
    IF chat_id LIKE '-%' AND chat_id NOT LIKE '-100%' AND LENGTH(chat_id) >= 8 THEN
        chat_id := '-100' || SUBSTRING(chat_id FROM 2);
    END IF;

    -- بناء الرسالة الموجزة الآمنة
    formatted_message := '🔔 <b>' || replace(replace(replace(NEW.title, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</b>' || E'\n' ||
                         '━━━━━━━━━━━━' || E'\n' ||
                         replace(replace(replace(NEW.body, '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || E'\n\n' ||
                         '⏰ <i>' || TO_CHAR(NOW() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD HH12:MI') || 
                         CASE WHEN EXTRACT(HOUR FROM NOW() AT TIME ZONE 'Africa/Cairo') >= 12 THEN ' م' ELSE ' ص' END || '</i>';

    PERFORM net.http_post(
        url := 'https://api.telegram.org/bot' || bot_token || '/sendMessage',
        body := jsonb_build_object(
            'chat_id', chat_id,
            'text', formatted_message,
            'parse_mode', 'HTML'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
    );

    -- تسجيل حالة النجاح والمحاولة
    UPDATE public.system_notifications 
    SET telegram_status = 'sent', telegram_sent_at = NOW(), telegram_attempts = COALESCE(telegram_attempts, 0) + 1, telegram_last_error = NULL
    WHERE id = NEW.id;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    UPDATE public.system_notifications 
    SET telegram_status = 'failed', telegram_attempts = COALESCE(telegram_attempts, 0) + 1, telegram_last_error = SQLERRM
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
