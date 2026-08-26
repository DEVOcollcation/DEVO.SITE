-- ==============================================================================
-- 🌟 MIGRATION V16: GRANULAR REPORT CONTROLS & MONTHLY / YEARLY REPORTS 🌟
-- ==============================================================================
-- تاريخ الإنشاء: 2026-08-25
-- الإصدار: v16.0
-- الوصف:
-- 1. إضافة مفاتيح التحكم المستقل لكل تقرير في home_settings:
--    (اليومي، الأسبوعي، الشهري، السنوي، والنسخ الاحتياطي السحابي).
-- 2. ترقية دالة generate_and_send_telegram_report لدعم التقارير الشهرية والسنوية الشاملة.
-- 3. ترقية دالة execute_automated_daily_backup للتحقق من مفتاح تفعيل النسخ الاحتياطي.
-- 4. ترقية تريجر send_telegram_notification_trigger لدعم تنبيهات التقارير الشهرية والسنوية.
-- 5. ترقية دالة reschedule_telegram_reports_cron لجدولة مهام pg_cron منفصلة ومنظمة.
-- ==============================================================================

-- 1. إدراج أو تحديث إعدادات التحكم المتقدمة في جدول home_settings
INSERT INTO public.home_settings (setting_key, setting_value) VALUES 
('telegram_daily_report_enabled', 'true'),
('telegram_daily_report_time', '23:55'),
('telegram_weekly_report_enabled', 'true'),
('telegram_weekly_report_day', 'friday'),
('telegram_weekly_report_time', '23:59'),
('telegram_monthly_report_enabled', 'true'),
('telegram_monthly_report_day', 'last_day'),
('telegram_monthly_report_time', '23:59'),
('telegram_yearly_report_enabled', 'true'),
('telegram_yearly_report_time', '23:59'),
('telegram_backup_enabled', 'true'),
('telegram_backup_time', '23:55')
ON CONFLICT (setting_key) DO NOTHING;


-- 2. دالة توليد وإرسال تقارير التليجرام (اليومية، الأسبوعية، الشهرية، والسنوية)
CREATE OR REPLACE FUNCTION public.generate_and_send_telegram_report(
    p_report_type text DEFAULT 'daily',            -- 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
    p_custom_from timestamp with time zone DEFAULT NULL,
    p_custom_to timestamp with time zone DEFAULT NULL,
    p_override_chat_id text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_bot_token text;
    v_is_tg_enabled text;
    v_is_reports_enabled text;
    v_is_specific_enabled text;
    v_chat_id text;
    v_group_link text;
    
    v_from_tz timestamptz;
    v_to_tz timestamptz;
    v_cairo_now timestamp;
    
    v_day_name text;
    v_month_name text;
    v_date_str text;
    v_time_str text;
    
    v_from_day_name text;
    v_from_date_str text;
    v_to_day_name text;
    v_to_date_str text;
    
    v_total_orders integer := 0;
    v_active_orders integer := 0;
    v_cancelled_orders integer := 0;
    v_completed_orders integer := 0;
    v_total_sales numeric := 0;
    v_total_deposits numeric := 0;
    v_remaining_balance numeric := 0;
    v_avg_order_value numeric := 0;
    v_total_series integer := 0;
    v_total_pieces integer := 0;
    
    v_top_models_text text := '';
    v_top_colors_text text := '';
    v_top_staff_text text := '';
    v_breakdown_text text := '';
    
    v_report_title text := '';
    v_period_label text := '';
    v_message text := '';
    v_rank_icons text[] := ARRAY['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    v_idx integer := 0;
    v_limit_models integer := 5;
    
    v_rec record;
    v_day_rec record;
    v_month_rec record;
    v_best_item_name text := '';
    v_best_item_sales numeric := 0;
BEGIN
    -- أ) جلب إعدادات التليجرام العامة والخاصة من جدول الإعدادات
    SELECT setting_value INTO v_bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO v_is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';
    SELECT setting_value INTO v_is_reports_enabled FROM public.home_settings WHERE setting_key = 'telegram_reports_enabled';
    SELECT setting_value INTO v_group_link FROM public.home_settings WHERE setting_key = 'telegram_reports_group_link';
    
    IF v_group_link IS NULL OR v_group_link = '' THEN
        v_group_link := 'https://t.me/+3LkR_kgCBPY3MzFk';
    END IF;

    -- التحقق من معرّف المحادثة
    IF p_override_chat_id IS NOT NULL AND p_override_chat_id <> '' THEN
        v_chat_id := p_override_chat_id;
    ELSE
        SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_reports_chat_id';
        IF v_chat_id IS NULL OR v_chat_id = '' THEN
            SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
        END IF;
    END IF;

    -- التحقق من توكن البوت ومعرف الشات
    IF v_bot_token IS NULL OR v_bot_token = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Telegram bot token is not configured in home_settings');
    END IF;

    IF v_chat_id IS NULL OR v_chat_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Telegram reports chat ID is not configured');
    END IF;

    -- التحقق من التفعيل العام لبوت التقارير والتليجرام
    IF COALESCE(v_is_tg_enabled, 'true') = 'false' OR COALESCE(v_is_reports_enabled, 'true') = 'false' THEN
        IF p_override_chat_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Telegram reports are disabled in settings');
        END IF;
    END IF;

    -- التحقق من تفعيل التقرير المحدد بشكل مستقل
    IF p_override_chat_id IS NULL THEN
        IF p_report_type = 'daily' THEN
            SELECT setting_value INTO v_is_specific_enabled FROM public.home_settings WHERE setting_key = 'telegram_daily_report_enabled';
            IF COALESCE(v_is_specific_enabled, 'true') = 'false' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Daily report is disabled in settings');
            END IF;
        ELSIF p_report_type = 'weekly' THEN
            SELECT setting_value INTO v_is_specific_enabled FROM public.home_settings WHERE setting_key = 'telegram_weekly_report_enabled';
            IF COALESCE(v_is_specific_enabled, 'true') = 'false' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Weekly report is disabled in settings');
            END IF;
        ELSIF p_report_type = 'monthly' THEN
            SELECT setting_value INTO v_is_specific_enabled FROM public.home_settings WHERE setting_key = 'telegram_monthly_report_enabled';
            IF COALESCE(v_is_specific_enabled, 'true') = 'false' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Monthly report is disabled in settings');
            END IF;
        ELSIF p_report_type = 'yearly' THEN
            SELECT setting_value INTO v_is_specific_enabled FROM public.home_settings WHERE setting_key = 'telegram_yearly_report_enabled';
            IF COALESCE(v_is_specific_enabled, 'true') = 'false' THEN
                RETURN jsonb_build_object('success', false, 'error', 'Yearly report is disabled in settings');
            END IF;
        END IF;
    END IF;

    -- ب) ضبط التوقيت والتاريخ واليوم بحسب توقيت مصر (Africa/Cairo)
    v_cairo_now := now() AT TIME ZONE 'Africa/Cairo';

    -- اسم اليوم بالعربية
    v_day_name := CASE EXTRACT(DOW FROM v_cairo_now)
        WHEN 0 THEN 'الأحد'
        WHEN 1 THEN 'الإثنين'
        WHEN 2 THEN 'الثلاثاء'
        WHEN 3 THEN 'الأربعاء'
        WHEN 4 THEN 'الخميس'
        WHEN 5 THEN 'الجمعة'
        WHEN 6 THEN 'السبت'
    END;

    -- اسم الشهر بالعربية
    v_month_name := CASE EXTRACT(MONTH FROM v_cairo_now)
        WHEN 1 THEN 'يناير'
        WHEN 2 THEN 'فبراير'
        WHEN 3 THEN 'مارس'
        WHEN 4 THEN 'أبريل'
        WHEN 5 THEN 'مايو'
        WHEN 6 THEN 'يونيو'
        WHEN 7 THEN 'يوليو'
        WHEN 8 THEN 'أغسطس'
        WHEN 9 THEN 'سبتمبر'
        WHEN 10 THEN 'أكتوبر'
        WHEN 11 THEN 'نوفمبر'
        WHEN 12 THEN 'ديسمبر'
    END;

    -- التاريخ والوقت المفصولين
    v_date_str := EXTRACT(DAY FROM v_cairo_now)::text || ' ' || v_month_name || ' ' || EXTRACT(YEAR FROM v_cairo_now)::text;
    v_time_str := TO_CHAR(v_cairo_now, 'HH12:MI') || CASE WHEN EXTRACT(HOUR FROM v_cairo_now) >= 12 THEN ' مساءً' ELSE ' صباحاً' END;

    -- ج) تحديد النطاق الزمني والعنوان بناءً على نوع التقرير
    IF p_report_type = 'daily' THEN
        v_limit_models := 5;
        IF p_custom_from IS NOT NULL AND p_custom_to IS NOT NULL THEN
            v_from_tz := p_custom_from;
            v_to_tz := p_custom_to;
        ELSE
            v_from_tz := (date_trunc('day', v_cairo_now) AT TIME ZONE 'Africa/Cairo');
            v_to_tz := ((date_trunc('day', v_cairo_now) + interval '1 day' - interval '1 millisecond') AT TIME ZONE 'Africa/Cairo');
        END IF;
        v_period_label := v_date_str;
        
        v_report_title := '📊 <b>تقرير المبيعات والنشاط اليومي</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '🗓️ <b>اليوم:</b> ' || v_day_name || E'\n' ||
                          '📅 <b>التاريخ:</b> ' || v_date_str || E'\n' ||
                          '⏰ <b>الوقت:</b> ' || v_time_str || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';

    ELSIF p_report_type = 'weekly' THEN
        v_limit_models := 7;
        IF p_custom_from IS NOT NULL AND p_custom_to IS NOT NULL THEN
            v_from_tz := p_custom_from;
            v_to_tz := p_custom_to;
        ELSE
            v_from_tz := ((date_trunc('day', v_cairo_now) - interval '6 days') AT TIME ZONE 'Africa/Cairo');
            v_to_tz := ((date_trunc('day', v_cairo_now) + interval '1 day' - interval '1 millisecond') AT TIME ZONE 'Africa/Cairo');
        END IF;

        v_from_day_name := CASE EXTRACT(DOW FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))
            WHEN 0 THEN 'الأحد' WHEN 1 THEN 'الإثنين' WHEN 2 THEN 'الثلاثاء'
            WHEN 3 THEN 'الأربعاء' WHEN 4 THEN 'الخميس' WHEN 5 THEN 'الجمعة' WHEN 6 THEN 'السبت'
        END;
        v_from_date_str := EXTRACT(DAY FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))::text || ' ' ||
            CASE EXTRACT(MONTH FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))
                WHEN 1 THEN 'يناير' WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس' WHEN 4 THEN 'أبريل'
                WHEN 5 THEN 'مايو' WHEN 6 THEN 'يونيو' WHEN 7 THEN 'يوليو' WHEN 8 THEN 'أغسطس'
                WHEN 9 THEN 'سبتمبر' WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
            END;

        v_to_day_name := CASE EXTRACT(DOW FROM (v_to_tz AT TIME ZONE 'Africa/Cairo'))
            WHEN 0 THEN 'الأحد' WHEN 1 THEN 'الإثنين' WHEN 2 THEN 'الثلاثاء'
            WHEN 3 THEN 'الأربعاء' WHEN 4 THEN 'الخميس' WHEN 5 THEN 'الجمعة' WHEN 6 THEN 'السبت'
        END;
        v_to_date_str := EXTRACT(DAY FROM (v_to_tz AT TIME ZONE 'Africa/Cairo'))::text || ' ' ||
            CASE EXTRACT(MONTH FROM (v_to_tz AT TIME ZONE 'Africa/Cairo'))
                WHEN 1 THEN 'يناير' WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس' WHEN 4 THEN 'أبريل'
                WHEN 5 THEN 'مايو' WHEN 6 THEN 'يونيو' WHEN 7 THEN 'يوليو' WHEN 8 THEN 'أغسطس'
                WHEN 9 THEN 'سبتمبر' WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
            END || ' ' || EXTRACT(YEAR FROM (v_to_tz AT TIME ZONE 'Africa/Cairo'))::text;

        v_period_label := v_from_date_str || ' - ' || v_to_date_str;

        v_report_title := '📅 <b>التقرير التنفيذي الشامل للأسبوع</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '🗓️ <b>الفترة:</b> من ' || v_from_day_name || ' (' || v_from_date_str || ') ⬅️ إلى ' || v_to_day_name || ' (' || v_to_date_str || ')' || E'\n' ||
                          '⏰ <b>وقت إصدار التقرير:</b> ' || v_time_str || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';

    ELSIF p_report_type = 'monthly' THEN
        v_limit_models := 10;
        IF p_custom_from IS NOT NULL AND p_custom_to IS NOT NULL THEN
            v_from_tz := p_custom_from;
            v_to_tz := p_custom_to;
        ELSE
            -- إذا تم استدعاء التقرير في أول يوم من الشهر صباحاً، يقدم تقرير الشهر المنقضي
            IF EXTRACT(DAY FROM v_cairo_now) = 1 AND EXTRACT(HOUR FROM v_cairo_now) < 12 THEN
                v_from_tz := (date_trunc('month', v_cairo_now - interval '1 day') AT TIME ZONE 'Africa/Cairo');
                v_to_tz := ((date_trunc('month', v_cairo_now - interval '1 day') + interval '1 month' - interval '1 millisecond') AT TIME ZONE 'Africa/Cairo');
            ELSE
                v_from_tz := (date_trunc('month', v_cairo_now) AT TIME ZONE 'Africa/Cairo');
                v_to_tz := ((date_trunc('month', v_cairo_now) + interval '1 month' - interval '1 millisecond') AT TIME ZONE 'Africa/Cairo');
            END IF;
        END IF;

        v_month_name := CASE EXTRACT(MONTH FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))
            WHEN 1 THEN 'يناير' WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس' WHEN 4 THEN 'أبريل'
            WHEN 5 THEN 'مايو' WHEN 6 THEN 'يونيو' WHEN 7 THEN 'يوليو' WHEN 8 THEN 'أغسطس'
            WHEN 9 THEN 'سبتمبر' WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
        END;
        v_period_label := 'شهر ' || v_month_name || ' ' || EXTRACT(YEAR FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))::text;

        v_report_title := '🗓️ <b>التقرير المالي والإداري الشامل لشهر ' || v_month_name || '</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '📅 <b>الشهر والسنة:</b> ' || v_month_name || ' ' || EXTRACT(YEAR FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))::text || E'\n' ||
                          '⏰ <b>وقت إصدار التقرير:</b> ' || v_time_str || ' (' || v_date_str || ')' || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';

    ELSIF p_report_type = 'yearly' THEN
        v_limit_models := 10;
        IF p_custom_from IS NOT NULL AND p_custom_to IS NOT NULL THEN
            v_from_tz := p_custom_from;
            v_to_tz := p_custom_to;
        ELSE
            -- إذا تم استدعاء التقرير في 1 يناير صباحاً، يقدم تقرير السنة المنقضية
            IF EXTRACT(MONTH FROM v_cairo_now) = 1 AND EXTRACT(DAY FROM v_cairo_now) = 1 AND EXTRACT(HOUR FROM v_cairo_now) < 12 THEN
                v_from_tz := (date_trunc('year', v_cairo_now - interval '1 day') AT TIME ZONE 'Africa/Cairo');
                v_to_tz := ((date_trunc('year', v_cairo_now - interval '1 day') + interval '1 year' - interval '1 millisecond') AT TIME ZONE 'Africa/Cairo');
            ELSE
                v_from_tz := (date_trunc('year', v_cairo_now) AT TIME ZONE 'Africa/Cairo');
                v_to_tz := ((date_trunc('year', v_cairo_now) + interval '1 year' - interval '1 millisecond') AT TIME ZONE 'Africa/Cairo');
            END IF;
        END IF;

        v_period_label := 'عام ' || EXTRACT(YEAR FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))::text;

        v_report_title := '🏆 <b>التقرير السنوي الختامي الشامل لعام ' || EXTRACT(YEAR FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))::text || '</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '📅 <b>السنة المالية:</b> ' || EXTRACT(YEAR FROM (v_from_tz AT TIME ZONE 'Africa/Cairo'))::text || E'\n' ||
                          '⏰ <b>وقت إصدار التقرير:</b> ' || v_time_str || ' (' || v_date_str || ')' || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';
    ELSE
        v_limit_models := 7;
        v_from_tz := COALESCE(p_custom_from, (date_trunc('day', v_cairo_now) AT TIME ZONE 'Africa/Cairo'));
        v_to_tz := COALESCE(p_custom_to, now());
        v_period_label := 'فترة مخصصة';
        
        v_report_title := '📑 <b>تقرير الفترة المحددة</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '⏰ <b>وقت التصدير:</b> ' || v_time_str || ' (' || v_date_str || ')' || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';
    END IF;

    -- د) تجميع إحصائيات الطلبات العامة في الفترة المحددة
    SELECT 
        COALESCE(COUNT(id), 0),
        COALESCE(COUNT(CASE WHEN status != 'cancelled' THEN 1 END), 0),
        COALESCE(COUNT(CASE WHEN status = 'cancelled' THEN 1 END), 0),
        COALESCE(COUNT(CASE WHEN status IN ('completed', 'shipped') THEN 1 END), 0),
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_price ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN deposit ELSE 0 END), 0)
    INTO 
        v_total_orders,
        v_active_orders,
        v_cancelled_orders,
        v_completed_orders,
        v_total_sales,
        v_total_deposits
    FROM public.orders
    WHERE created_at >= v_from_tz AND created_at <= v_to_tz;

    v_remaining_balance := v_total_sales - v_total_deposits;
    IF v_active_orders > 0 THEN
        v_avg_order_value := ROUND(v_total_sales / v_active_orders, 2);
    ELSE
        v_avg_order_value := 0;
    END IF;

    -- هـ) تجميع إجمالي السريات والقطع المباعة في الفترة
    WITH period_items AS (
        SELECT 
            oi.id,
            oi.quantity as series_qty,
            GREATEST(
                COALESCE(
                    NULLIF((SELECT COUNT(*) FROM public.class_sizes cs JOIN public.models m2 ON m2.class_id = cs.class_id WHERE m2.id = oi.model_id), 0),
                    NULLIF((SELECT COUNT(*) FROM public.model_sizes ms WHERE ms.model_id = oi.model_id), 0),
                    oi.sizes_count,
                    1
                ),
                1
            ) as sz_count
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.created_at >= v_from_tz AND o.created_at <= v_to_tz AND o.status != 'cancelled'
    )
    SELECT 
        COALESCE(SUM(series_qty), 0),
        COALESCE(SUM(series_qty * sz_count), 0)
    INTO 
        v_total_series,
        v_total_pieces
    FROM period_items;

    -- و) تجميع أكثر الموديلات سحباً ومبيعاً
    v_idx := 0;
    FOR v_rec IN 
        WITH model_items AS (
            SELECT 
                oi.model_id,
                m.name as model_name,
                m.factory_code,
                oi.quantity as series_qty,
                GREATEST(
                    COALESCE(
                        NULLIF((SELECT COUNT(*) FROM public.class_sizes cs JOIN public.models m2 ON m2.class_id = cs.class_id WHERE m2.id = oi.model_id), 0),
                        NULLIF((SELECT COUNT(*) FROM public.model_sizes ms WHERE ms.model_id = oi.model_id), 0),
                        oi.sizes_count,
                        1
                    ),
                    1
                ) as sz_count,
                oi.total_price
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
            JOIN public.models m ON m.id = oi.model_id
            WHERE o.created_at >= v_from_tz AND o.created_at <= v_to_tz AND o.status != 'cancelled'
        )
        SELECT 
            COALESCE(model_name, 'بدون اسم') as model_name,
            COALESCE(factory_code, '') as factory_code,
            COALESCE(SUM(series_qty), 0) as series_sold,
            COALESCE(SUM(series_qty * sz_count), 0) as pieces_sold,
            COALESCE(SUM(total_price), 0) as total_rev
        FROM model_items
        GROUP BY model_id, model_name, factory_code
        ORDER BY pieces_sold DESC, total_rev DESC
        LIMIT v_limit_models
    LOOP
        v_idx := v_idx + 1;
        v_top_models_text := COALESCE(v_top_models_text, '') || 
            v_rank_icons[v_idx] || ' <b>' || replace(replace(replace(COALESCE(v_rec.model_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</b>' || E'\n' ||
            CASE WHEN v_rec.factory_code IS NOT NULL AND v_rec.factory_code <> '' THEN 
                '   • كود: <code>' || replace(replace(replace(COALESCE(v_rec.factory_code, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</code>' || E'\n'
            ELSE '' END ||
            '   • الكمية: <b>' || COALESCE(v_rec.series_sold, 0) || ' سيري</b> (' || COALESCE(v_rec.pieces_sold, 0) || ' قطعة)' || E'\n' ||
            '   • الإجمالي: <b>' || to_char(COALESCE(v_rec.total_rev, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n\n';
    END LOOP;

    IF v_top_models_text IS NULL OR v_top_models_text = '' THEN
        v_top_models_text := '<i>لا توجد مبيعات موديلات مسجلة في هذه الفترة</i>' || E'\n\n';
    END IF;

    -- ز) تجميع أكثر الألوان سحباً ومبيعاً
    v_idx := 0;
    FOR v_rec IN 
        WITH color_items AS (
            SELECT 
                oi.color_id,
                c.name as color_name,
                oi.quantity as series_qty,
                GREATEST(
                    COALESCE(
                        NULLIF((SELECT COUNT(*) FROM public.class_sizes cs JOIN public.models m2 ON m2.class_id = cs.class_id WHERE m2.id = oi.model_id), 0),
                        NULLIF((SELECT COUNT(*) FROM public.model_sizes ms WHERE ms.model_id = oi.model_id), 0),
                        oi.sizes_count,
                        1
                    ),
                    1
                ) as sz_count
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
            JOIN public.colors c ON c.id = oi.color_id
            WHERE o.created_at >= v_from_tz AND o.created_at <= v_to_tz AND o.status != 'cancelled'
        )
        SELECT 
            COALESCE(color_name, 'بدون لون') as color_name,
            COALESCE(SUM(series_qty), 0) as series_sold,
            COALESCE(SUM(series_qty * sz_count), 0) as pieces_sold
        FROM color_items
        GROUP BY color_id, color_name
        ORDER BY pieces_sold DESC
        LIMIT CASE WHEN p_report_type IN ('monthly', 'yearly') THEN 7 ELSE 5 END
    LOOP
        v_idx := v_idx + 1;
        v_top_colors_text := COALESCE(v_top_colors_text, '') || 
            '▫️ <b>' || replace(replace(replace(COALESCE(v_rec.color_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ':</b> ' ||
            COALESCE(v_rec.series_sold, 0) || ' سيري (' || COALESCE(v_rec.pieces_sold, 0) || ' قطعة)' || E'\n';
    END LOOP;

    IF v_top_colors_text IS NULL OR v_top_colors_text = '' THEN
        v_top_colors_text := '<i>لا توجد بيانات ألوان في هذه الفترة</i>' || E'\n';
    END IF;

    -- ح) تجميع أداء موظفي المبيعات
    v_idx := 0;
    FOR v_rec IN 
        SELECT 
            COALESCE(u.full_name, u.username, 'غير محدد') as staff_name,
            COALESCE(COUNT(o.id), 0) as orders_count,
            COALESCE(SUM(o.total_price), 0) as staff_sales
        FROM public.orders o
        LEFT JOIN public.system_users u ON u.id = o.worker_id
        WHERE o.created_at >= v_from_tz AND o.created_at <= v_to_tz AND o.status != 'cancelled'
        GROUP BY u.id, u.full_name, u.username
        ORDER BY staff_sales DESC
        LIMIT CASE WHEN p_report_type = 'yearly' THEN 8 WHEN p_report_type = 'monthly' THEN 6 ELSE 4 END
    LOOP
        v_idx := v_idx + 1;
        v_top_staff_text := COALESCE(v_top_staff_text, '') || 
            '👤 <b>' || replace(replace(replace(COALESCE(v_rec.staff_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ':</b> ' ||
            COALESCE(v_rec.orders_count, 0) || ' فواتير • <b>' || to_char(COALESCE(v_rec.staff_sales, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n';
    END LOOP;

    IF v_top_staff_text IS NULL OR v_top_staff_text = '' THEN
        v_top_staff_text := '<i>لا توجد فواتير مسجلة للموظفين في هذه الفترة</i>' || E'\n';
    END IF;

    -- ط) حركة الأيام أو الشهور للتقارير الأسبوعية والشهرية والسنوية
    IF p_report_type = 'weekly' THEN
        FOR v_day_rec IN 
            SELECT 
                date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo') as day_dt,
                EXTRACT(DOW FROM date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')) as dow_num,
                EXTRACT(DAY FROM date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')) as day_num,
                EXTRACT(MONTH FROM date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')) as month_num,
                COALESCE(COUNT(id), 0) as d_orders,
                COALESCE(SUM(total_price), 0) as d_sales
            FROM public.orders
            WHERE created_at >= v_from_tz AND created_at <= v_to_tz AND status != 'cancelled'
            GROUP BY date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')
            ORDER BY date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo') ASC
        LOOP
            v_day_name := CASE v_day_rec.dow_num
                WHEN 0 THEN 'الأحد' WHEN 1 THEN 'الإثنين' WHEN 2 THEN 'الثلاثاء'
                WHEN 3 THEN 'الأربعاء' WHEN 4 THEN 'الخميس' WHEN 5 THEN 'الجمعة' WHEN 6 THEN 'السبت'
            END;
            v_month_name := CASE v_day_rec.month_num
                WHEN 1 THEN 'يناير' WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس' WHEN 4 THEN 'أبريل'
                WHEN 5 THEN 'مايو' WHEN 6 THEN 'يونيو' WHEN 7 THEN 'يوليو' WHEN 8 THEN 'أغسطس'
                WHEN 9 THEN 'سبتمبر' WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
            END;

            v_breakdown_text := COALESCE(v_breakdown_text, '') || 
                '▫️ <b>' || v_day_name || '</b> (' || v_day_rec.day_num || ' ' || v_month_name || '): ' ||
                COALESCE(v_day_rec.d_orders, 0) || ' فواتير • <b>' || to_char(COALESCE(v_day_rec.d_sales, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n';
            
            IF v_day_rec.d_sales > v_best_item_sales THEN
                v_best_item_sales := v_day_rec.d_sales;
                v_best_item_name := v_day_name || ' (' || to_char(v_day_rec.d_sales, 'FM999,999,999') || ' ج.م)';
            END IF;
        END LOOP;

    ELSIF p_report_type = 'monthly' THEN
        -- أفضل أيام الشهر مبيعاً
        FOR v_day_rec IN 
            SELECT 
                date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo') as day_dt,
                EXTRACT(DAY FROM date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')) as day_num,
                EXTRACT(DOW FROM date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')) as dow_num,
                COALESCE(COUNT(id), 0) as d_orders,
                COALESCE(SUM(total_price), 0) as d_sales
            FROM public.orders
            WHERE created_at >= v_from_tz AND created_at <= v_to_tz AND status != 'cancelled'
            GROUP BY date_trunc('day', created_at AT TIME ZONE 'Africa/Cairo')
            ORDER BY d_sales DESC
            LIMIT 3
        LOOP
            v_day_name := CASE v_day_rec.dow_num
                WHEN 0 THEN 'الأحد' WHEN 1 THEN 'الإثنين' WHEN 2 THEN 'الثلاثاء'
                WHEN 3 THEN 'الأربعاء' WHEN 4 THEN 'الخميس' WHEN 5 THEN 'الجمعة' WHEN 6 THEN 'السبت'
            END;
            v_breakdown_text := COALESCE(v_breakdown_text, '') || 
                '⭐ <b>' || v_day_name || ' (' || v_day_rec.day_num || ' ' || v_month_name || '):</b> ' ||
                COALESCE(v_day_rec.d_orders, 0) || ' فواتير • <b>' || to_char(COALESCE(v_day_rec.d_sales, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n';
        END LOOP;

    ELSIF p_report_type = 'yearly' THEN
        -- حركة شهور السنة (12 شهراً)
        FOR v_month_rec IN 
            SELECT 
                EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Africa/Cairo'))::int as m_num,
                COALESCE(COUNT(id), 0) as m_orders,
                COALESCE(SUM(total_price), 0) as m_sales
            FROM public.orders
            WHERE created_at >= v_from_tz AND created_at <= v_to_tz AND status != 'cancelled'
            GROUP BY EXTRACT(MONTH FROM (created_at AT TIME ZONE 'Africa/Cairo'))::int
            ORDER BY m_num ASC
        LOOP
            v_month_name := CASE v_month_rec.m_num
                WHEN 1 THEN 'يناير' WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس' WHEN 4 THEN 'أبريل'
                WHEN 5 THEN 'مايو' WHEN 6 THEN 'يونيو' WHEN 7 THEN 'يوليو' WHEN 8 THEN 'أغسطس'
                WHEN 9 THEN 'سبتمبر' WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
            END;

            v_breakdown_text := COALESCE(v_breakdown_text, '') || 
                '▫️ <b>' || v_month_name || ':</b> ' ||
                COALESCE(v_month_rec.m_orders, 0) || ' فواتير • <b>' || to_char(COALESCE(v_month_rec.m_sales, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n';

            IF v_month_rec.m_sales > v_best_item_sales THEN
                v_best_item_sales := v_month_rec.m_sales;
                v_best_item_name := v_month_name || ' (' || to_char(v_month_rec.m_sales, 'FM999,999,999') || ' ج.م)';
            END IF;
        END LOOP;
    END IF;

    -- ي) بناء نص الرسالة المفصلة الكاملة (لجروب التقارير المخصص)
    v_message := COALESCE(v_report_title, '') || E'\n\n' ||
                 '💰 <b><u>المؤشرات المالية والكميات:</u></b>' || E'\n' ||
                 '🧾 <b>عدد الفواتير:</b> ' || COALESCE(v_total_orders, 0) || ' فاتورة' ||
                 CASE WHEN v_cancelled_orders > 0 THEN ' (منها ' || v_cancelled_orders || ' ملغاة)' ELSE '' END || E'\n' ||
                 '💵 <b>إجمالي المبيعات:</b> <b>' || to_char(COALESCE(v_total_sales, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n' ||
                 '📥 <b>العرابين المقبوضة:</b> <b>' || to_char(COALESCE(v_total_deposits, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n' ||
                 '⏳ <b>المتبقي للتحصيل:</b> <b>' || to_char(COALESCE(v_remaining_balance, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n' ||
                 '🎯 <b>متوسط الفاتورة:</b> <b>' || to_char(COALESCE(v_avg_order_value, 0), 'FM999,999,999.00') || ' ج.م</b>' || E'\n' ||
                 '📦 <b>إجمالي السريات:</b> ' || COALESCE(v_total_series, 0) || ' سيري' || E'\n' ||
                 '👕 <b>إجمالي القطع:</b> ' || COALESCE(v_total_pieces, 0) || ' قطعة' || E'\n\n' ||
                 
                 '🔥 <b><u>أكثر الموديلات طلباً وسحباً:</u></b>' || E'\n' ||
                 COALESCE(v_top_models_text, '') ||
                 
                 '🎨 <b><u>أكثر الألوان طلباً:</u></b>' || E'\n' ||
                 COALESCE(v_top_colors_text, '') || E'\n' ||
                 
                 '🏆 <b><u>أداء موظفي المبيعات:</u></b>' || E'\n' ||
                 COALESCE(v_top_staff_text, '');

    IF p_report_type = 'weekly' AND COALESCE(v_breakdown_text, '') <> '' THEN
        v_message := v_message || E'\n' ||
                     '📈 <b><u>حركة المبيعات اليومية بالأسبوع:</u></b>' || E'\n' ||
                     v_breakdown_text;
        IF v_best_item_name <> '' THEN
            v_message := v_message || E'\n' || '🌟 <b>أعلى يوم مبيعاً:</b> ' || v_best_item_name || E'\n';
        END IF;
    ELSIF p_report_type = 'monthly' AND COALESCE(v_breakdown_text, '') <> '' THEN
        v_message := v_message || E'\n' ||
                     '📈 <b><u>أعلى أيام الشهر مبيعاً ونشاطاً:</u></b>' || E'\n' ||
                     v_breakdown_text;
    ELSIF p_report_type = 'yearly' AND COALESCE(v_breakdown_text, '') <> '' THEN
        v_message := v_message || E'\n' ||
                     '📈 <b><u>حركة المبيعات الشهرية على مدار العام:</u></b>' || E'\n' ||
                     v_breakdown_text;
        IF v_best_item_name <> '' THEN
            v_message := v_message || E'\n' || '🌟 <b>أعلى شهر مبيعاً في العام:</b> ' || v_best_item_name || E'\n';
        END IF;
    END IF;

    v_message := v_message || E'\n' || '━━━━━━━━━━━━' || E'\n' ||
                 '🤖 <i>تم إرسال هذا التقرير آلياً بواسطة بوت تقارير DEVO</i>';

    -- ك) إرسال الرسالة المفصلة مباشرة إلى جروب التقارير
    PERFORM net.http_post(
        url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
        body := jsonb_build_object(
            'chat_id', v_chat_id,
            'text', v_message,
            'parse_mode', 'HTML'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
    );

    -- في حال كان الجروب Supergroup ويحتاج بادئة -100 يتم إرسال طلب احتياطي
    IF v_chat_id LIKE '-%' AND v_chat_id NOT LIKE '-100%' AND LENGTH(v_chat_id) >= 8 THEN
        PERFORM net.http_post(
            url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
            body := jsonb_build_object(
                'chat_id', '-100' || SUBSTRING(v_chat_id FROM 2),
                'text', v_message,
                'parse_mode', 'HTML'
            ),
            headers := '{"Content-Type": "application/json"}'::jsonb
        );
    END IF;

    -- ل) تسجيل التقرير في جدول الإشعارات (مع الميتاداتا)
    INSERT INTO public.system_notifications (type, title, body, metadata)
    VALUES (
        'telegram_report_dispatched',
        CASE 
            WHEN p_report_type = 'yearly' THEN '🏆 تم إصدار التقرير السنوي'
            WHEN p_report_type = 'monthly' THEN '🗓️ تم إصدار التقرير الشهري'
            WHEN p_report_type = 'weekly' THEN '📅 تم إصدار التقرير الأسبوعي'
            ELSE '📊 تم إصدار تقرير اليوم'
        END,
        'تم إرسال التقرير ' || 
        CASE 
            WHEN p_report_type = 'yearly' THEN 'السنوي الشامل'
            WHEN p_report_type = 'monthly' THEN 'الشهري المفصل'
            WHEN p_report_type = 'weekly' THEN 'الأسبوعي'
            ELSE 'اليومي'
        END || ' إلى جروب التقارير.',
        jsonb_build_object(
            'report_type', p_report_type,
            'chat_id', v_chat_id,
            'total_sales', v_total_sales,
            'total_orders', v_total_orders,
            'total_pieces', v_total_pieces,
            'total_series', v_total_series,
            'period', v_period_label
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'report_type', p_report_type,
        'chat_id', v_chat_id,
        'total_sales', v_total_sales,
        'total_orders', v_total_orders,
        'total_pieces', v_total_pieces,
        'total_series', v_total_series,
        'period', v_period_label,
        'formatted_message', v_message
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.generate_and_send_telegram_report TO authenticated, anon, service_role;


-- ==============================================================================
-- 3. ترقية دالة النسخ الاحتياطي التلقائي لدعم فحص مفتاح التفعيل
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.execute_automated_daily_backup()
RETURNS jsonb AS $$
DECLARE
    v_bot_token text;
    v_is_tg_enabled text;
    v_is_backup_enabled text;
    v_backup_chat_id text;
    v_cairo_now timestamp;
    
    v_filename text;
    v_public_url text;
    v_caption text;
    
    v_payload jsonb;
    v_total_records integer := 0;
    v_file_size_bytes integer := 0;
    v_formatted_size text := '0 KB';
BEGIN
    SELECT setting_value INTO v_bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO v_is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';
    SELECT setting_value INTO v_is_backup_enabled FROM public.home_settings WHERE setting_key = 'telegram_backup_enabled';
    
    -- التحقق من تفعيل النسخ الاحتياطي التلقائي
    IF COALESCE(v_is_backup_enabled, 'true') = 'false' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Automated backup is disabled in settings');
    END IF;

    v_cairo_now := now() AT TIME ZONE 'Africa/Cairo';
    v_filename := 'devo_auto_backup_' || TO_CHAR(v_cairo_now, 'YYYY-MM-DD_HH24-MI-SS') || '.json';

    -- بناء هيكل البيانات الكامل للنظام
    SELECT jsonb_build_object(
        'meta', jsonb_build_object(
            'version', '2.5.0',
            'format', 'DEVO_SYSTEM_BACKUP',
            'preset', 'full_system',
            'exported_at', to_char(v_cairo_now, 'YYYY-MM-DD"T"HH24:MI:SS'),
            'exported_by', 'system_cron_auto_backup'
        ),
        'data', jsonb_build_object(
            'categories', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.categories t),
            'classes', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.classes t),
            'sizes', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.sizes t),
            'colors', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.colors t),
            'class_sizes', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.class_sizes t),
            'system_users', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.system_users t),
            'themes', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.themes t),
            'home_settings', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.home_settings t),
            'models', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.models t),
            'model_sizes', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.model_sizes t),
            'model_images', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.model_images t),
            'model_colors_inventory', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.model_colors_inventory t),
            'model_inventory', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.model_inventory t),
            'stock_movements', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.stock_movements t),
            'promo_cards', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.promo_cards t),
            'invoices', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.invoices t),
            'invoice_items', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.invoice_items t),
            'orders', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.orders t),
            'order_items', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.order_items t),
            'order_logs', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.order_logs t),
            'system_notifications', (SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.system_notifications t)
        )
    ) INTO v_payload;

    -- حساب عدد السجلات الإجمالي وحجم الملف
    v_total_records := (
        (SELECT count(*) FROM public.categories) +
        (SELECT count(*) FROM public.classes) +
        (SELECT count(*) FROM public.sizes) +
        (SELECT count(*) FROM public.colors) +
        (SELECT count(*) FROM public.models) +
        (SELECT count(*) FROM public.orders) +
        (SELECT count(*) FROM public.order_items) +
        (SELECT count(*) FROM public.invoices) +
        (SELECT count(*) FROM public.stock_movements) +
        (SELECT count(*) FROM public.system_users)
    );

    v_file_size_bytes := octet_length(v_payload::text);
    IF v_file_size_bytes >= 1048576 THEN
        v_formatted_size := ROUND((v_file_size_bytes / 1048576.0)::numeric, 2) || ' MB';
    ELSE
        v_formatted_size := ROUND((v_file_size_bytes / 1024.0)::numeric, 1) || ' KB';
    END IF;

    -- تسجيل النسخة الاحتياطية في جدول system_backups_log
    INSERT INTO public.system_backups_log (
        filename,
        backup_type,
        total_records,
        file_size_bytes,
        storage_path,
        exported_by,
        metadata
    ) VALUES (
        v_filename,
        'full_system',
        v_total_records,
        v_file_size_bytes,
        v_filename,
        'system_cron_auto_backup',
        jsonb_build_object(
            'version', '2.5.0',
            'exported_at', to_char(v_cairo_now, 'YYYY-MM-DD"T"HH24:MI:SS'),
            'total_records', v_total_records,
            'file_size_formatted', v_formatted_size,
            'backup_payload', v_payload
        )
    ) ON CONFLICT (filename) DO NOTHING;

    -- تطبيق سياسة الأرشفة والتنظيف (30 يوماً)
    PERFORM public.purge_old_backups_log(30);

    -- إرسال الإشعار والملف إلى تليجرام
    SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_backup_chat_id';
    IF v_backup_chat_id IS NULL OR v_backup_chat_id = '' THEN
        SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    END IF;

    IF v_backup_chat_id LIKE '-%' AND v_backup_chat_id NOT LIKE '-100%' AND LENGTH(v_backup_chat_id) >= 8 THEN
        v_backup_chat_id := '-100' || SUBSTRING(v_backup_chat_id FROM 2);
    END IF;

    IF COALESCE(v_is_tg_enabled, 'true') = 'true' AND v_bot_token IS NOT NULL AND v_backup_chat_id IS NOT NULL AND v_bot_token <> '' AND v_backup_chat_id <> '' THEN
        v_caption := '🛡️ <b>نسخة احتياطية سحابية تلقائية جديدة</b>' || E'\n' ||
                     '━━━━━━━━━━━━' || E'\n' ||
                     '📦 <b>نوع النسخة:</b> نسخة كاملة للنظام (Full Backup)' || E'\n' ||
                     '📊 <b>إجمالي السجلات:</b> ' || v_total_records || ' سجل' || E'\n' ||
                     '💾 <b>الحجم:</b> ' || v_formatted_size || E'\n' ||
                     '📁 <b>الملف:</b> <code>' || v_filename || '</code>' || E'\n' ||
                     '⏰ <b>الوقت:</b> ' || TO_CHAR(v_cairo_now, 'YYYY-MM-DD HH12:MI') || CASE WHEN EXTRACT(HOUR FROM v_cairo_now) >= 12 THEN ' م' ELSE ' ص' END || E'\n' ||
                     '━━━━━━━━━━━━' || E'\n' ||
                     '🤖 <i>تم الحفظ والأرشفة السحابية بنجاح عبر النظام التلقائي</i>';

        PERFORM net.http_post(
            url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
            body := jsonb_build_object(
                'chat_id', v_backup_chat_id,
                'text', v_caption,
                'parse_mode', 'HTML'
            ),
            headers := '{"Content-Type": "application/json"}'::jsonb
        );
    END IF;

    -- تسجيل إشعار بنجاح النسخ الاحتياطي في جدول الإشعارات
    BEGIN
        INSERT INTO public.system_notifications (type, title, body, metadata)
        VALUES (
            'system_backup_completed',
            '🛡️ تم إنشاء نسخة احتياطية سحابية',
            'تم إنشاء نسخة احتياطية تلقائية للنظام وأرشفتها بنجاح (' || v_formatted_size || ' • ' || v_total_records || ' سجل).',
            jsonb_build_object(
                'filename', v_filename,
                'total_records', v_total_records,
                'file_size', v_formatted_size,
                'backup_type', 'automated_daily'
            )
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'filename', v_filename,
        'total_records', v_total_records,
        'file_size_bytes', v_file_size_bytes,
        'formatted_size', v_formatted_size
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.execute_automated_daily_backup TO authenticated, anon, service_role;


-- ==============================================================================
-- 4. ترقية تريجر الإشعارات لدعم تنبيهات التقارير الشهرية والسنوية
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.send_telegram_notification_trigger()
RETURNS TRIGGER AS $$
DECLARE
    bot_token text;
    chat_id text;
    is_tg_enabled text;
    formatted_message text;
BEGIN
    IF (NEW.type = 'out_of_stock' OR NEW.type = 'restocked') THEN
        RETURN NEW;
    END IF;

    SELECT setting_value INTO bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';

    -- إشعار إصدار التقارير إلى شات الأوردرات
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
            END IF;

            RETURN NEW;
        END;
    END IF;

    -- بقية التنبيهات العادية (أوردرات، حركات المخزون، إلخ)
    IF (is_tg_enabled <> 'true' OR bot_token IS NULL OR bot_token = '') THEN
        RETURN NEW;
    END IF;

    SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    IF (chat_id IS NULL OR chat_id = '') THEN
        RETURN NEW;
    END IF;

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

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==============================================================================
-- 5. ترقية دالة إعادة ضبط مواعيد التقارير والنسخ الاحتياطي تلقائياً (pg_cron)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reschedule_telegram_reports_cron()
RETURNS jsonb AS $$
DECLARE
    v_reports_master_enabled text;
    v_daily_enabled text;
    v_weekly_enabled text;
    v_monthly_enabled text;
    v_yearly_enabled text;
    v_backup_enabled text;
    
    v_daily_time text;
    v_weekly_day text;
    v_weekly_time text;
    v_monthly_time text;
    v_yearly_time text;
    v_backup_time text;
    
    v_daily_utc_hour int;
    v_daily_min int;
    
    v_weekly_utc_hour int;
    v_weekly_min int;
    v_weekly_dow text := '5';
    
    v_monthly_utc_hour int;
    v_monthly_min int;
    
    v_yearly_utc_hour int;
    v_yearly_min int;
    
    v_backup_utc_hour int;
    v_backup_min int;
    
    v_target_cairo_ts timestamp;
    v_target_utc_ts timestamp;
    
    v_dow_target int;
    v_current_dow int;
    v_day_diff int;
    v_weekly_target_cairo_ts timestamp;
    v_weekly_target_utc_ts timestamp;
    
    v_scheduled_jobs jsonb := '{}'::jsonb;
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- إلغاء الجدولة السابقة لجميع المهام
    BEGIN
        PERFORM cron.unschedule('daily-telegram-report');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        PERFORM cron.unschedule('weekly-telegram-report');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        PERFORM cron.unschedule('monthly-telegram-report');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        PERFORM cron.unschedule('yearly-telegram-report');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        PERFORM cron.unschedule('daily-automated-backup');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN (
            'daily-telegram-report',
            'weekly-telegram-report',
            'monthly-telegram-report',
            'yearly-telegram-report',
            'daily-automated-backup'
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- جلب حالات التفعيل والمواعيد من home_settings
    SELECT COALESCE(setting_value, 'true') INTO v_reports_master_enabled FROM public.home_settings WHERE setting_key = 'telegram_reports_enabled';
    SELECT COALESCE(setting_value, 'true') INTO v_daily_enabled FROM public.home_settings WHERE setting_key = 'telegram_daily_report_enabled';
    SELECT COALESCE(setting_value, 'true') INTO v_weekly_enabled FROM public.home_settings WHERE setting_key = 'telegram_weekly_report_enabled';
    SELECT COALESCE(setting_value, 'true') INTO v_monthly_enabled FROM public.home_settings WHERE setting_key = 'telegram_monthly_report_enabled';
    SELECT COALESCE(setting_value, 'true') INTO v_yearly_enabled FROM public.home_settings WHERE setting_key = 'telegram_yearly_report_enabled';
    SELECT COALESCE(setting_value, 'true') INTO v_backup_enabled FROM public.home_settings WHERE setting_key = 'telegram_backup_enabled';

    SELECT COALESCE(setting_value, '23:55') INTO v_daily_time FROM public.home_settings WHERE setting_key = 'telegram_daily_report_time';
    SELECT COALESCE(setting_value, 'friday') INTO v_weekly_day FROM public.home_settings WHERE setting_key = 'telegram_weekly_report_day';
    SELECT COALESCE(setting_value, '23:59') INTO v_weekly_time FROM public.home_settings WHERE setting_key = 'telegram_weekly_report_time';
    SELECT COALESCE(setting_value, '23:59') INTO v_monthly_time FROM public.home_settings WHERE setting_key = 'telegram_monthly_report_time';
    SELECT COALESCE(setting_value, '23:59') INTO v_yearly_time FROM public.home_settings WHERE setting_key = 'telegram_yearly_report_time';
    SELECT COALESCE(setting_value, '23:55') INTO v_backup_time FROM public.home_settings WHERE setting_key = 'telegram_backup_time';

    -- 1) جدولة التقرير اليومي
    IF v_reports_master_enabled <> 'false' AND v_daily_enabled <> 'false' THEN
        BEGIN
            v_target_cairo_ts := (TO_CHAR(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') || ' ' || v_daily_time)::timestamp;
            v_target_utc_ts := (v_target_cairo_ts AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'UTC';
            v_daily_utc_hour := EXTRACT(HOUR FROM v_target_utc_ts)::int;
            v_daily_min := EXTRACT(MINUTE FROM v_target_utc_ts)::int;
        EXCEPTION WHEN OTHERS THEN
            v_daily_utc_hour := 20;
            v_daily_min := 55;
        END;

        BEGIN
            PERFORM cron.schedule(
                'daily-telegram-report',
                v_daily_min::text || ' ' || v_daily_utc_hour::text || ' * * *',
                $cmd$SELECT public.generate_and_send_telegram_report('daily');$cmd$
            );
            v_scheduled_jobs := v_scheduled_jobs || jsonb_build_object('daily', v_daily_min::text || ' ' || v_daily_utc_hour::text || ' * * *');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- 2) جدولة التقرير الأسبوعي
    IF v_reports_master_enabled <> 'false' AND v_weekly_enabled <> 'false' THEN
        BEGIN
            v_dow_target := CASE LOWER(v_weekly_day)
                WHEN 'sunday' THEN 0 WHEN '0' THEN 0
                WHEN 'monday' THEN 1 WHEN '1' THEN 1
                WHEN 'tuesday' THEN 2 WHEN '2' THEN 2
                WHEN 'wednesday' THEN 3 WHEN '3' THEN 3
                WHEN 'thursday' THEN 4 WHEN '4' THEN 4
                WHEN 'friday' THEN 5 WHEN '5' THEN 5
                WHEN 'saturday' THEN 6 WHEN '6' THEN 6
                ELSE 5
            END;

            v_current_dow := EXTRACT(DOW FROM (now() AT TIME ZONE 'Africa/Cairo'))::int;
            v_day_diff := (v_dow_target - v_current_dow + 7) % 7;
            
            v_weekly_target_cairo_ts := ((TO_CHAR((now() AT TIME ZONE 'Africa/Cairo')::date + v_day_diff, 'YYYY-MM-DD')) || ' ' || v_weekly_time)::timestamp;
            v_weekly_target_utc_ts := (v_weekly_target_cairo_ts AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'UTC';
            
            v_weekly_utc_hour := EXTRACT(HOUR FROM v_weekly_target_utc_ts)::int;
            v_weekly_min := EXTRACT(MINUTE FROM v_weekly_target_utc_ts)::int;
            v_weekly_dow := EXTRACT(DOW FROM v_weekly_target_utc_ts)::text;
        EXCEPTION WHEN OTHERS THEN
            v_weekly_utc_hour := 20;
            v_weekly_min := 59;
            v_weekly_dow := '5';
        END;

        BEGIN
            PERFORM cron.schedule(
                'weekly-telegram-report',
                v_weekly_min::text || ' ' || v_weekly_utc_hour::text || ' * * ' || v_weekly_dow,
                $cmd$SELECT public.generate_and_send_telegram_report('weekly');$cmd$
            );
            v_scheduled_jobs := v_scheduled_jobs || jsonb_build_object('weekly', v_weekly_min::text || ' ' || v_weekly_utc_hour::text || ' * * ' || v_weekly_dow);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- 3) جدولة التقرير الشهري (يُرسل في أول كل شهر مع منتصف الليل ليغطي الشهر المنقضي بالكامل)
    IF v_reports_master_enabled <> 'false' AND v_monthly_enabled <> 'false' THEN
        BEGIN
            v_target_cairo_ts := (TO_CHAR(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') || ' ' || v_monthly_time)::timestamp;
            v_target_utc_ts := (v_target_cairo_ts AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'UTC';
            v_monthly_utc_hour := EXTRACT(HOUR FROM v_target_utc_ts)::int;
            v_monthly_min := EXTRACT(MINUTE FROM v_target_utc_ts)::int;
        EXCEPTION WHEN OTHERS THEN
            v_monthly_utc_hour := 20;
            v_monthly_min := 59;
        END;

        BEGIN
            PERFORM cron.schedule(
                'monthly-telegram-report',
                v_monthly_min::text || ' ' || v_monthly_utc_hour::text || ' 1 * *',
                $cmd$SELECT public.generate_and_send_telegram_report('monthly');$cmd$
            );
            v_scheduled_jobs := v_scheduled_jobs || jsonb_build_object('monthly', v_monthly_min::text || ' ' || v_monthly_utc_hour::text || ' 1 * *');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- 4) جدولة التقرير السنوي (يُرسل في 1 يناير صباحاً ليغطي السنة المنقضية بالكامل)
    IF v_reports_master_enabled <> 'false' AND v_yearly_enabled <> 'false' THEN
        BEGIN
            v_target_cairo_ts := (TO_CHAR(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') || ' ' || v_yearly_time)::timestamp;
            v_target_utc_ts := (v_target_cairo_ts AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'UTC';
            v_yearly_utc_hour := EXTRACT(HOUR FROM v_target_utc_ts)::int;
            v_yearly_min := EXTRACT(MINUTE FROM v_target_utc_ts)::int;
        EXCEPTION WHEN OTHERS THEN
            v_yearly_utc_hour := 20;
            v_yearly_min := 59;
        END;

        BEGIN
            PERFORM cron.schedule(
                'yearly-telegram-report',
                v_yearly_min::text || ' ' || v_yearly_utc_hour::text || ' 1 1 *',
                $cmd$SELECT public.generate_and_send_telegram_report('yearly');$cmd$
            );
            v_scheduled_jobs := v_scheduled_jobs || jsonb_build_object('yearly', v_yearly_min::text || ' ' || v_yearly_utc_hour::text || ' 1 1 *');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    -- 5) جدولة النسخ الاحتياطي التلقائي السحابي
    IF v_backup_enabled <> 'false' THEN
        BEGIN
            v_target_cairo_ts := (TO_CHAR(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') || ' ' || v_backup_time)::timestamp;
            v_target_utc_ts := (v_target_cairo_ts AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'UTC';
            v_backup_utc_hour := EXTRACT(HOUR FROM v_target_utc_ts)::int;
            v_backup_min := EXTRACT(MINUTE FROM v_target_utc_ts)::int;
        EXCEPTION WHEN OTHERS THEN
            v_backup_utc_hour := 20;
            v_backup_min := 55;
        END;

        BEGIN
            PERFORM cron.schedule(
                'daily-automated-backup',
                v_backup_min::text || ' ' || v_backup_utc_hour::text || ' * * *',
                $cmd$SELECT public.execute_automated_daily_backup();$cmd$
            );
            v_scheduled_jobs := v_scheduled_jobs || jsonb_build_object('backup', v_backup_min::text || ' ' || v_backup_utc_hour::text || ' * * *');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'scheduled_jobs', v_scheduled_jobs
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.reschedule_telegram_reports_cron TO authenticated, anon, service_role;

-- تشغيل الجدولة التلقائية فوراً
SELECT public.reschedule_telegram_reports_cron();
