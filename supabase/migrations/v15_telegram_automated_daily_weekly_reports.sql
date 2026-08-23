-- ==============================================================================
-- 🌟 MIGRATION V15: AUTOMATED TELEGRAM DAILY & WEEKLY REPORTS & PG_CRON SCHEDULING 🌟
-- ==============================================================================
-- تاريخ الإنشاء: 2026-08-23
-- الإصدار: v15.0
-- الوصف:
-- 1. إضافة إعدادات شات التقارير (-5419925349) ورابط جروب التقارير في جدول home_settings.
-- 2. إرسال التقرير الكامل المفصل والمؤمن ضد قيم NULL حصرياً إلى جروب التقارير.
-- 3. تقصير الخط الفاصل (━━━━━━━━━━━━) لمنع انكسار السطر على شاشات الموبايل.
-- 4. إرسال تنبيه مختصر وأنيق فقط لشات الأوردرات مع رابط مباشر للانتقال لجروب التقارير.
-- ==============================================================================

-- 1. إدراج أو تحديث إعدادات شات وبوت التقارير في جدول home_settings
INSERT INTO public.home_settings (setting_key, setting_value) VALUES 
('telegram_chat_id', '-5488929514'),
('telegram_stock_chat_id', '-1004482360716'),
('telegram_backup_chat_id', '-1004363122042'),
('telegram_reports_chat_id', '-1004352609361'),
('telegram_reports_group_link', 'https://t.me/+3LkR_kgCBPY3MzFk'),
('telegram_reports_enabled', 'true'),
('telegram_daily_report_time', '23:55'),
('telegram_weekly_report_day', 'friday'),
('telegram_weekly_report_time', '23:59')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value;

-- التأكد من تفعيل امتداد pg_net لإرسال طلبات الويب غير الحظرية
CREATE EXTENSION IF NOT EXISTS pg_net;


-- 2. دالة توليد وإرسال تقارير التليجرام اليومية والأسبوعية
CREATE OR REPLACE FUNCTION public.generate_and_send_telegram_report(
    p_report_type text DEFAULT 'daily',            -- 'daily' | 'weekly' | 'custom'
    p_custom_from timestamp with time zone DEFAULT NULL,
    p_custom_to timestamp with time zone DEFAULT NULL,
    p_override_chat_id text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_bot_token text;
    v_is_tg_enabled text;
    v_is_reports_enabled text;
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
    v_daily_breakdown_text text := '';
    
    v_report_title text := '';
    v_message text := '';
    v_rank_icons text[] := ARRAY['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    v_idx integer := 0;
    
    v_rec record;
    v_day_rec record;
    v_best_day_name text := '';
    v_best_day_sales numeric := 0;
BEGIN
    -- أ) جلب إعدادات التليجرام من جدول الإعدادات
    SELECT setting_value INTO v_bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO v_is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';
    SELECT setting_value INTO v_is_reports_enabled FROM public.home_settings WHERE setting_key = 'telegram_reports_enabled';
    SELECT setting_value INTO v_group_link FROM public.home_settings WHERE setting_key = 'telegram_reports_group_link';
    
    IF v_group_link IS NULL OR v_group_link = '' THEN
        v_group_link := 'https://t.me/+3LkR_kgCBPY3MzFk';
    END IF;

    -- التحقق من المعرّف
    IF p_override_chat_id IS NOT NULL AND p_override_chat_id <> '' THEN
        v_chat_id := p_override_chat_id;
    ELSE
        SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_reports_chat_id';
        IF v_chat_id IS NULL OR v_chat_id = '' THEN
            SELECT setting_value INTO v_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
        END IF;
    END IF;

    -- التحقق من تفعيل التليجرام ووجود التوكن والشات
    IF v_bot_token IS NULL OR v_bot_token = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Telegram bot token is not configured in home_settings');
    END IF;

    IF v_chat_id IS NULL OR v_chat_id = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Telegram reports chat ID is not configured');
    END IF;

    IF COALESCE(v_is_tg_enabled, 'true') = 'false' OR COALESCE(v_is_reports_enabled, 'true') = 'false' THEN
        IF p_override_chat_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Telegram reports are disabled in settings');
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

    IF p_report_type = 'daily' THEN
        IF p_custom_from IS NOT NULL AND p_custom_to IS NOT NULL THEN
            v_from_tz := p_custom_from;
            v_to_tz := p_custom_to;
        ELSE
            v_from_tz := (date_trunc('day', v_cairo_now) AT TIME ZONE 'Africa/Cairo');
            v_to_tz := ((date_trunc('day', v_cairo_now) + interval '1 day' - interval '1 millisecond') AT TIME ZONE 'Africa/Cairo');
        END IF;
        
        v_report_title := '📊 <b>تقرير المبيعات والنشاط اليومي</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '🗓️ <b>اليوم:</b> ' || v_day_name || E'\n' ||
                          '📅 <b>التاريخ:</b> ' || v_date_str || E'\n' ||
                          '⏰ <b>الوقت:</b> ' || v_time_str || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';
    ELSIF p_report_type = 'weekly' THEN
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

        v_report_title := '📅 <b>التقرير التنفيذي الشامل للأسبوع</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '🗓️ <b>الفترة:</b> من ' || v_from_day_name || ' (' || v_from_date_str || ') ⬅️ إلى ' || v_to_day_name || ' (' || v_to_date_str || ')' || E'\n' ||
                          '⏰ <b>وقت إصدار التقرير:</b> ' || v_time_str || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';
    ELSE
        v_from_tz := COALESCE(p_custom_from, (date_trunc('day', v_cairo_now) AT TIME ZONE 'Africa/Cairo'));
        v_to_tz := COALESCE(p_custom_to, now());
        v_report_title := '📑 <b>تقرير الفترة المحددة</b>' || E'\n' ||
                          '━━━━━━━━━━━━' || E'\n' ||
                          '⏰ <b>وقت التصدير:</b> ' || v_time_str || ' (' || v_date_str || ')' || E'\n' ||
                          '🏭 <b>المصنع:</b> DEVO Factory System' || E'\n' ||
                          '━━━━━━━━━━━━';
    END IF;

    -- ج) تجميع إحصائيات الطلبات العامة في الفترة المحددة
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

    -- د) تجميع إجمالي السريات والقطع المباعة في الفترة
    SELECT 
        COALESCE(SUM(oi.quantity), 0),
        COALESCE(SUM(COALESCE(oi.total_pieces, oi.quantity * COALESCE(oi.sizes_count, 1))), 0)
    INTO 
        v_total_series,
        v_total_pieces
    FROM public.order_items oi
    INNER JOIN public.orders o ON o.id = oi.order_id
    WHERE o.created_at >= v_from_tz AND o.created_at <= v_to_tz AND o.status != 'cancelled';

    -- هـ) تجميع أكثر الموديلات سحباً ومبيعاً (تنسيق كروت منظم للموبايل مع حماية COALESCE)
    v_idx := 0;
    FOR v_rec IN 
        SELECT 
            COALESCE(m.name, 'بدون اسم') as model_name,
            COALESCE(m.factory_code, '') as factory_code,
            COALESCE(SUM(oi.quantity), 0) as series_sold,
            COALESCE(SUM(COALESCE(oi.total_pieces, oi.quantity * COALESCE(oi.sizes_count, 1))), 0) as pieces_sold,
            COALESCE(SUM(oi.total_price), 0) as total_rev
        FROM public.order_items oi
        INNER JOIN public.orders o ON o.id = oi.order_id
        INNER JOIN public.models m ON m.id = oi.model_id
        WHERE o.created_at >= v_from_tz AND o.created_at <= v_to_tz AND o.status != 'cancelled'
        GROUP BY m.id, m.name, m.factory_code
        ORDER BY pieces_sold DESC, total_rev DESC
        LIMIT CASE WHEN p_report_type = 'weekly' THEN 7 ELSE 5 END
    LOOP
        v_idx := v_idx + 1;
        v_top_models_text := COALESCE(v_top_models_text, '') || 
            v_rank_icons[v_idx] || ' <b>' || replace(replace(replace(COALESCE(v_rec.model_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</b>' || E'\n' ||
            CASE WHEN v_rec.factory_code IS NOT NULL AND v_rec.factory_code <> '' THEN 
                '   • كود: <code>' || replace(replace(replace(COALESCE(v_rec.factory_code, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</code>' || E'\n'
            ELSE '' END ||
            '   • الكمية: <b>' || COALESCE(v_rec.pieces_sold, 0) || ' قطعة</b> (' || COALESCE(v_rec.series_sold, 0) || ' سيري)' || E'\n' ||
            '   • الإجمالي: <b>' || to_char(COALESCE(v_rec.total_rev, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n\n';
    END LOOP;

    IF v_top_models_text IS NULL OR v_top_models_text = '' THEN
        v_top_models_text := '<i>لا توجد مبيعات موديلات مسجلة في هذه الفترة</i>' || E'\n\n';
    END IF;

    -- و) تجميع أكثر الألوان سحباً ومبيعاً
    v_idx := 0;
    FOR v_rec IN 
        SELECT 
            COALESCE(c.name, 'بدون لون') as color_name,
            COALESCE(SUM(oi.quantity), 0) as series_sold,
            COALESCE(SUM(COALESCE(oi.total_pieces, oi.quantity * COALESCE(oi.sizes_count, 1))), 0) as pieces_sold
        FROM public.order_items oi
        INNER JOIN public.orders o ON o.id = oi.order_id
        INNER JOIN public.colors c ON c.id = oi.color_id
        WHERE o.created_at >= v_from_tz AND o.created_at <= v_to_tz AND o.status != 'cancelled'
        GROUP BY c.id, c.name
        ORDER BY pieces_sold DESC
        LIMIT 5
    LOOP
        v_idx := v_idx + 1;
        v_top_colors_text := COALESCE(v_top_colors_text, '') || 
            '▫️ <b>' || replace(replace(replace(COALESCE(v_rec.color_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ':</b> ' ||
            COALESCE(v_rec.pieces_sold, 0) || ' قطعة (' || COALESCE(v_rec.series_sold, 0) || ' سيري)' || E'\n';
    END LOOP;

    IF v_top_colors_text IS NULL OR v_top_colors_text = '' THEN
        v_top_colors_text := '<i>لا توجد بيانات ألوان في هذه الفترة</i>' || E'\n';
    END IF;

    -- ز) تجميع أداء موظفي المبيعات
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
        LIMIT 4
    LOOP
        v_idx := v_idx + 1;
        v_top_staff_text := COALESCE(v_top_staff_text, '') || 
            '👤 <b>' || replace(replace(replace(COALESCE(v_rec.staff_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || ':</b> ' ||
            COALESCE(v_rec.orders_count, 0) || ' فواتير • <b>' || to_char(COALESCE(v_rec.staff_sales, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n';
    END LOOP;

    IF v_top_staff_text IS NULL OR v_top_staff_text = '' THEN
        v_top_staff_text := '<i>لا توجد فواتير مسجلة للموظفين في هذه الفترة</i>' || E'\n';
    END IF;

    -- ح) حركة الأيام في التقرير الأسبوعي
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

            v_daily_breakdown_text := COALESCE(v_daily_breakdown_text, '') || 
                '▫️ <b>' || v_day_name || '</b> (' || v_day_rec.day_num || ' ' || v_month_name || '): ' ||
                COALESCE(v_day_rec.d_orders, 0) || ' فواتير • <b>' || to_char(COALESCE(v_day_rec.d_sales, 0), 'FM999,999,999') || ' ج.م</b>' || E'\n';
            
            IF v_day_rec.d_sales > v_best_day_sales THEN
                v_best_day_sales := v_day_rec.d_sales;
                v_best_day_name := v_day_name || ' (' || to_char(v_day_rec.d_sales, 'FM999,999,999') || ' ج.م)';
            END IF;
        END LOOP;
    END IF;

    -- ط) بناء نص الرسالة المفصلة الكاملة (لجروب التقارير المخصص)
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

    IF p_report_type = 'weekly' AND COALESCE(v_daily_breakdown_text, '') <> '' THEN
        v_message := v_message || E'\n' ||
                     '📈 <b><u>حركة المبيعات اليومية بالأسبوع:</u></b>' || E'\n' ||
                     v_daily_breakdown_text;
        IF v_best_day_name <> '' THEN
            v_message := v_message || E'\n' || '🌟 <b>أعلى يوم مبيعاً:</b> ' || v_best_day_name || E'\n';
        END IF;
    END IF;

    v_message := v_message || E'\n' || '━━━━━━━━━━━━' || E'\n' ||
                 '🤖 <i>تم إرسال هذا التقرير آلياً بواسطة بوت تقارير DEVO</i>';

    -- ي) إرسال الرسالة المفصلة مباشرة إلى جروب التقارير
    PERFORM net.http_post(
        url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
        body := jsonb_build_object(
            'chat_id', v_chat_id,
            'text', v_message,
            'parse_mode', 'HTML'
        ),
        headers := '{"Content-Type": "application/json"}'::jsonb
    );

    -- في حال كان الجروب Supergroup ويحتاج بادئة -100 يتم إرسال طلب احتياطي لضمان الوصول
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

    -- ك) تسجيل التقرير في جدول الإشعارات (مع الميتاداتا)
    INSERT INTO public.system_notifications (type, title, body, metadata)
    VALUES (
        'telegram_report_dispatched',
        CASE WHEN p_report_type = 'weekly' THEN '📅 تم إصدار التقرير الأسبوعي' ELSE '📊 تم إصدار تقرير اليوم' END,
        'تم إرسال التقرير ' || CASE WHEN p_report_type = 'weekly' THEN 'الأسبوعي' ELSE 'اليومي' END || ' المفصل إلى جروب التقارير.',
        jsonb_build_object(
            'report_type', p_report_type,
            'chat_id', v_chat_id,
            'total_sales', v_total_sales,
            'total_orders', v_total_orders,
            'total_pieces', v_total_pieces,
            'total_series', v_total_series,
            'period', CASE WHEN p_report_type = 'weekly' THEN v_from_date_str || ' - ' || v_to_date_str ELSE v_date_str END
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
        'period', CASE WHEN p_report_type = 'weekly' THEN v_from_date_str || ' - ' || v_to_date_str ELSE v_date_str END,
        'formatted_message', v_message
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- منح الصلاحيات لتنفيذ الدالة
GRANT EXECUTE ON FUNCTION public.generate_and_send_telegram_report TO authenticated, anon, service_role;


-- ==============================================================================
-- 3. تحديث تريجر الإشعارات: إرسال تنبيه أنيق ومختصر بخط فاصل قصير يمنع الانكسار
-- ==============================================================================
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

    -- أ) إشعار إصدار التقارير إلى شات الأوردرات (تنبيه أنيق ومختصر بخط فاصل قصير ورابط مباشر)
    IF (NEW.type = 'telegram_report_dispatched') THEN
        DECLARE
            v_group_link text;
            v_is_weekly boolean;
        BEGIN
            SELECT setting_value INTO v_group_link FROM public.home_settings WHERE setting_key = 'telegram_reports_group_link';
            IF v_group_link IS NULL OR v_group_link = '' THEN
                v_group_link := 'https://t.me/+3LkR_kgCBPY3MzFk';
            END IF;

            SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';

            IF (is_tg_enabled = 'true' AND bot_token IS NOT NULL AND chat_id IS NOT NULL AND bot_token <> '' AND chat_id <> '') THEN
                v_is_weekly := (NEW.metadata->>'report_type' = 'weekly');
                
                IF v_is_weekly THEN
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

    -- ب) إذا كان البث مخصصاً من الأدمن
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
            
            RETURN NEW;
        END;
    END IF;

    -- ج) إشعارات الطلبات العادية
    SELECT setting_value INTO chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';

    IF (is_tg_enabled = 'true' AND bot_token IS NOT NULL AND chat_id IS NOT NULL AND bot_token <> '' AND chat_id <> '') THEN
        DECLARE
            v_title text;
            v_body text;
        BEGIN
            v_title := replace(replace(replace(COALESCE(NEW.title, 'تنبيه جديد'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            v_body := replace(replace(replace(COALESCE(NEW.body, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
            formatted_message := '<b>' || v_title || '</b>' || E'\n\n' || v_body;

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


-- ==============================================================================
-- 4. دالة النسخ الاحتياطي التلقائي الشامل للنظام السحابي والتليجرام
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.system_backups_log (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    filename text NOT NULL UNIQUE,
    backup_type text NOT NULL DEFAULT 'full_system',
    total_records integer DEFAULT 0,
    file_size_bytes bigint DEFAULT 0,
    storage_path text,
    exported_by text DEFAULT 'system',
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT system_backups_log_pkey PRIMARY KEY (id)
);

ALTER TABLE public.system_backups_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow all access to system_backups_log" ON public.system_backups_log;
END $$;

CREATE POLICY "Allow all access to system_backups_log"
    ON public.system_backups_log FOR ALL
    USING (true)
    WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.purge_old_backups_log(p_retention_days integer DEFAULT 30)
RETURNS integer AS $$
DECLARE
    deleted_count integer := 0;
BEGIN
    WITH deleted_rows AS (
        DELETE FROM public.system_backups_log
        WHERE created_at < (now() - (p_retention_days || ' days')::interval)
        RETURNING id
    )
    SELECT count(*) INTO deleted_count FROM deleted_rows;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.execute_automated_daily_backup()
RETURNS jsonb AS $$
DECLARE
    v_bot_token text;
    v_backup_chat_id text;
    v_is_tg_enabled text;
    
    v_cairo_now timestamp;
    v_day_name text;
    v_month_name text;
    v_date_str text;
    v_time_str text;
    v_filename text;
    
    v_categories jsonb;
    v_classes jsonb;
    v_sizes jsonb;
    v_colors jsonb;
    v_class_sizes jsonb;
    v_system_users jsonb;
    v_themes jsonb;
    v_home_settings jsonb;
    v_models jsonb;
    v_model_sizes jsonb;
    v_model_images jsonb;
    v_model_colors_inventory jsonb;
    v_model_inventory jsonb;
    v_stock_movements jsonb;
    v_promo_cards jsonb;
    v_invoices jsonb;
    v_invoice_items jsonb;
    v_orders jsonb;
    v_order_items jsonb;
    v_order_logs jsonb;
    v_system_notifications jsonb;
    
    v_total_records integer := 0;
    v_payload jsonb;
    v_payload_text text;
    v_file_size_bytes bigint := 0;
    v_formatted_size text;
    v_caption text;
BEGIN
    v_cairo_now := now() AT TIME ZONE 'Africa/Cairo';

    v_day_name := CASE EXTRACT(DOW FROM v_cairo_now)
        WHEN 0 THEN 'الأحد' WHEN 1 THEN 'الإثنين' WHEN 2 THEN 'الثلاثاء'
        WHEN 3 THEN 'الأربعاء' WHEN 4 THEN 'الخميس' WHEN 5 THEN 'الجمعة' WHEN 6 THEN 'السبت'
    END;

    v_month_name := CASE EXTRACT(MONTH FROM v_cairo_now)
        WHEN 1 THEN 'يناير' WHEN 2 THEN 'فبراير' WHEN 3 THEN 'مارس' WHEN 4 THEN 'أبريل'
        WHEN 5 THEN 'مايو' WHEN 6 THEN 'يونيو' WHEN 7 THEN 'يوليو' WHEN 8 THEN 'أغسطس'
        WHEN 9 THEN 'سبتمبر' WHEN 10 THEN 'أكتوبر' WHEN 11 THEN 'نوفمبر' WHEN 12 THEN 'ديسمبر'
    END;

    v_date_str := EXTRACT(DAY FROM v_cairo_now)::text || ' ' || v_month_name || ' ' || EXTRACT(YEAR FROM v_cairo_now)::text;
    v_time_str := TO_CHAR(v_cairo_now, 'HH12:MI') || CASE WHEN EXTRACT(HOUR FROM v_cairo_now) >= 12 THEN ' مساءً' ELSE ' صباحاً' END;
    v_filename := 'devo_auto_backup_' || TO_CHAR(v_cairo_now, 'YYYY-MM-DD_HH24-MI-SS') || '.json';

    -- جمع جداول النظام كاملة
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_categories FROM (SELECT * FROM public.categories ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_classes FROM (SELECT * FROM public.classes ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_sizes FROM (SELECT * FROM public.sizes ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_colors FROM (SELECT * FROM public.colors ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_class_sizes FROM (SELECT * FROM public.class_sizes ORDER BY class_id, size_id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_system_users FROM (SELECT * FROM public.system_users ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_themes FROM (SELECT * FROM public.themes ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_home_settings FROM (SELECT * FROM public.home_settings ORDER BY setting_key) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_models FROM (SELECT * FROM public.models ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_model_sizes FROM (SELECT * FROM public.model_sizes ORDER BY model_id, size_id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_model_images FROM (SELECT * FROM public.model_images ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_model_colors_inventory FROM (SELECT * FROM public.model_colors_inventory ORDER BY model_id, color_id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_model_inventory FROM (SELECT * FROM public.model_inventory ORDER BY model_id, color_id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_stock_movements FROM (SELECT * FROM public.stock_movements ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_promo_cards FROM (SELECT * FROM public.promo_cards ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_invoices FROM (SELECT * FROM public.invoices ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_invoice_items FROM (SELECT * FROM public.invoice_items ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_orders FROM (SELECT * FROM public.orders ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_order_items FROM (SELECT * FROM public.order_items ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_order_logs FROM (SELECT * FROM public.order_logs ORDER BY id) t;
    SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_system_notifications FROM (SELECT * FROM public.system_notifications ORDER BY id) t;

    v_total_records := jsonb_array_length(v_categories) + jsonb_array_length(v_classes) + 
                       jsonb_array_length(v_sizes) + jsonb_array_length(v_colors) + 
                       jsonb_array_length(v_class_sizes) + jsonb_array_length(v_system_users) + 
                       jsonb_array_length(v_themes) + jsonb_array_length(v_home_settings) + 
                       jsonb_array_length(v_models) + jsonb_array_length(v_model_sizes) + 
                       jsonb_array_length(v_model_images) + jsonb_array_length(v_model_colors_inventory) + 
                       jsonb_array_length(v_model_inventory) + jsonb_array_length(v_stock_movements) + 
                       jsonb_array_length(v_promo_cards) + jsonb_array_length(v_invoices) + 
                       jsonb_array_length(v_invoice_items) + jsonb_array_length(v_orders) + 
                       jsonb_array_length(v_order_items) + jsonb_array_length(v_order_logs) + 
                       jsonb_array_length(v_system_notifications);

    v_payload := jsonb_build_object(
        'format', 'DEVO_SYSTEM_BACKUP',
        'meta', jsonb_build_object(
            'version', '2.5.0',
            'exported_at', now(),
            'exported_at_cairo', v_date_str || ' ' || v_time_str,
            'preset_id', 'full_system',
            'preset_name', 'نسخة احتياطية كاملة للنظام (تلقائية)',
            'total_records', v_total_records,
            'tables_count', 21,
            'exported_by', 'system_cron_auto_backup'
        ),
        'tables', jsonb_build_object(
            'categories', v_categories,
            'classes', v_classes,
            'sizes', v_sizes,
            'colors', v_colors,
            'class_sizes', v_class_sizes,
            'system_users', v_system_users,
            'themes', v_themes,
            'home_settings', v_home_settings,
            'models', v_models,
            'model_sizes', v_model_sizes,
            'model_images', v_model_images,
            'model_colors_inventory', v_model_colors_inventory,
            'model_inventory', v_model_inventory,
            'stock_movements', v_stock_movements,
            'promo_cards', v_promo_cards,
            'invoices', v_invoices,
            'invoice_items', v_invoice_items,
            'orders', v_orders,
            'order_items', v_order_items,
            'order_logs', v_order_logs,
            'system_notifications', v_system_notifications
        )
    );

    v_payload_text := v_payload::text;
    v_file_size_bytes := octet_length(v_payload_text);
    v_formatted_size := ROUND((v_file_size_bytes / 1024.0), 1)::text || ' KB';

    -- تسجيل النسخة الاحتياطية في جدول system_backups_log مع حفظ البيانات بالكامل
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
        'system_cron',
        jsonb_build_object(
            'version', '2.5.0',
            'preset_name', 'نسخة احتياطية كاملة للنظام (تلقائية)',
            'cairo_time', v_date_str || ' ' || v_time_str,
            'backup_payload', v_payload
        )
    )
    ON CONFLICT (filename) DO UPDATE SET
        total_records = EXCLUDED.total_records,
        file_size_bytes = EXCLUDED.file_size_bytes,
        metadata = EXCLUDED.metadata;

    -- تطبيق سياسة الحذف التلقائي للنسخ الأقدم من 30 يوماً
    PERFORM public.purge_old_backups_log(30);

    -- رفع ملف الـ JSON تلقائياً إلى حاوية التخزين السحابي Supabase Storage (system_backups)
    PERFORM net.http_post(
        url := 'https://abxbhtysmqzrswzsdrzi.supabase.co/storage/v1/object/system_backups/' || v_filename,
        body := v_payload,
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_so6KzXru538HEc5dFORaIA_4dB_SWzo", "apikey": "sb_publishable_so6KzXru538HEc5dFORaIA_4dB_SWzo"}'::jsonb
    );

    -- جلب إعدادات تليجرام للإشعار
    SELECT setting_value INTO v_bot_token FROM public.home_settings WHERE setting_key = 'telegram_bot_token';
    SELECT setting_value INTO v_is_tg_enabled FROM public.home_settings WHERE setting_key = 'telegram_enabled';
    SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_backup_chat_id';

    IF v_backup_chat_id IS NULL OR v_backup_chat_id = '' THEN
        SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    END IF;

    -- توحيد المعرف لسوبر جروب (-100) تلقائياً لمنع التكرار
    IF v_backup_chat_id LIKE '-%' AND v_backup_chat_id NOT LIKE '-100%' AND LENGTH(v_backup_chat_id) >= 8 THEN
        v_backup_chat_id := '-100' || SUBSTRING(v_backup_chat_id FROM 2);
    END IF;

    -- إرسال المستند المرفق بالكامل لجروب النسخ الاحتياطي في تليجرام
    IF COALESCE(v_is_tg_enabled, 'true') = 'true' AND v_bot_token IS NOT NULL AND v_backup_chat_id IS NOT NULL AND v_bot_token <> '' AND v_backup_chat_id <> '' THEN
        DECLARE
            v_public_url text;
        BEGIN
            v_public_url := 'https://abxbhtysmqzrswzsdrzi.supabase.co/storage/v1/object/public/system_backups/' || v_filename;

            v_caption := '🛡️ <b>النسخ الاحتياطي التلقائي للنظام</b>' || E'\n' ||
                         '━━━━━━━━━━━━' || E'\n' ||
                         '🗓️ <b>اليوم:</b> ' || v_day_name || E'\n' ||
                         '📅 <b>التاريخ:</b> ' || v_date_str || E'\n' ||
                         '⏰ <b>الوقت:</b> ' || v_time_str || E'\n' ||
                         '📦 <b>نوع النسخة:</b> نسخة كاملة للنظام (Full Backup)' || E'\n' ||
                         '📊 <b>إجمالي السجلات:</b> <b>' || to_char(v_total_records, 'FM999,999,999') || ' سجل</b>' || E'\n' ||
                         '💾 <b>حجم الملف:</b> ' || v_formatted_size || E'\n' ||
                         '🌐 <b>النظام:</b> DEVO Collection v2.5.0' || E'\n' ||
                         '☁️ <b>الحالة:</b> تم الرفع والأرشفة السحابية بنجاح ✅' || E'\n' ||
                         '━━━━━━━━━━━━' || E'\n' ||
                         '🤖 <i>تم إنشاء وإرفاق هذه النسخة آلياً بالتزامن مع موعد التقرير اليومي</i>';

            -- إرسال ملف النسخة الاحتياطية الفعلي كمستند مرفق (sendDocument) مرة واحدة فقط مع الكابشن
            PERFORM net.http_post(
                url := 'https://api.telegram.org/bot' || v_bot_token || '/sendDocument',
                body := jsonb_build_object(
                    'chat_id', v_backup_chat_id,
                    'document', v_public_url,
                    'caption', v_caption,
                    'parse_mode', 'HTML'
                ),
                headers := '{"Content-Type": "application/json"}'::jsonb
            );
        END;
    END IF;

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
-- 5. دالة إعادة ضبط مواعيد التقارير والنسخ الاحتياطي تلقائياً (pg_cron)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reschedule_telegram_reports_cron()
RETURNS jsonb AS $$
DECLARE
    v_daily_time text;
    v_weekly_day text;
    v_weekly_time text;
    v_reports_enabled text;
    
    v_daily_utc_hour int;
    v_daily_min int;
    
    v_weekly_utc_hour int;
    v_weekly_min int;
    v_weekly_dow text := '5';
    
    v_target_cairo_ts timestamp;
    v_target_utc_ts timestamp;
    
    v_dow_target int;
    v_current_dow int;
    v_day_diff int;
    v_weekly_target_cairo_ts timestamp;
    v_weekly_target_utc_ts timestamp;
BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;

    -- إلغاء الجدولة السابقة
    BEGIN
        PERFORM cron.unschedule('daily-telegram-report');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        PERFORM cron.unschedule('weekly-telegram-report');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('daily-telegram-report', 'weekly-telegram-report');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- جلب الإعدادات المخصصة
    SELECT COALESCE(setting_value, 'true') INTO v_reports_enabled FROM public.home_settings WHERE setting_key = 'telegram_reports_enabled';
    
    IF v_reports_enabled = 'false' THEN
        RETURN jsonb_build_object('success', true, 'message', 'تم تعطيل التقارير والنسخ الاحتياطي التلقائي');
    END IF;

    SELECT COALESCE(setting_value, '23:55') INTO v_daily_time FROM public.home_settings WHERE setting_key = 'telegram_daily_report_time';
    SELECT COALESCE(setting_value, 'friday') INTO v_weekly_day FROM public.home_settings WHERE setting_key = 'telegram_weekly_report_day';
    SELECT COALESCE(setting_value, '23:59') INTO v_weekly_time FROM public.home_settings WHERE setting_key = 'telegram_weekly_report_time';

    -- 1) استخراج وتوقيت التقرير والنسخ الاحتياطي اليومي بالتحويل التلقائي والدقيق حسب توقيت القاهرة الفعلي (صيفي UTC+3 أو شتوي UTC+2)
    BEGIN
        v_target_cairo_ts := (TO_CHAR(now() AT TIME ZONE 'Africa/Cairo', 'YYYY-MM-DD') || ' ' || v_daily_time)::timestamp;
        v_target_utc_ts := (v_target_cairo_ts AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'UTC';
        
        v_daily_utc_hour := EXTRACT(HOUR FROM v_target_utc_ts)::int;
        v_daily_min := EXTRACT(MINUTE FROM v_target_utc_ts)::int;
    EXCEPTION WHEN OTHERS THEN
        v_daily_utc_hour := 20;
        v_daily_min := 55;
    END;

    -- جدولة التقرير اليومي + النسخ الاحتياطي التلقائي اليومي في نفس اللحظة
    BEGIN
        PERFORM cron.schedule(
            'daily-telegram-report',
            v_daily_min::text || ' ' || v_daily_utc_hour::text || ' * * *',
            $cmd$
            SELECT public.generate_and_send_telegram_report('daily');
            SELECT public.execute_automated_daily_backup();
            $cmd$
        );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- 2) استخراج وتوقيت التقرير الأسبوعي بدقة تامة
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
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'daily_cron', v_daily_min::text || ' ' || v_daily_utc_hour::text || ' * * *',
        'weekly_cron', v_weekly_min::text || ' ' || v_weekly_utc_hour::text || ' * * ' || v_weekly_dow
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.reschedule_telegram_reports_cron TO authenticated, anon, service_role;

-- تشغيل الجدولة الأولية
SELECT public.reschedule_telegram_reports_cron();
