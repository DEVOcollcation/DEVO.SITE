-- ==============================================================================
-- 🚀 V20: الترقية الديناميكية الشاملة للنسخ الاحتياطي والاستعادة التلقائية لكافة الجداول
-- ==============================================================================
-- الغرض:
-- 1. اكتشاف وجلب جميع الجداول الحالية والجديدة تلقائياً دون أي حصر يدوي أو تعديل كود.
-- 2. استبعاد الجداول الداخلية والطوابير المؤقتة (مثل inventory_notification_queue) لتفادي أخطاء الـ 400.
-- 3. دعم استعادة وحفظ أي جداول إضافية يتم إنشاؤها في المستقبل مهما زاد عددها أو سجلاتها.
-- 4. حماية مساحة قاعدة البيانات من التضخم بإلغاء تخزين البايلود المضاعف داخل الـ metadata.
-- ==============================================================================

-- 1. دالة استرجاع كافة جداول النظام الحالية ديناميكياً للـ Frontend
CREATE OR REPLACE FUNCTION public.get_all_system_tables()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, information_schema
AS $$
DECLARE
    v_tables text[];
BEGIN
    SELECT COALESCE(array_agg(table_name::text ORDER BY table_name), ARRAY[]::text[])
    INTO v_tables
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT IN (
          'spatial_ref_sys', 
          'system_backups_log', 
          'schema_migrations',
          'inventory_notification_queue'
      );
      
    RETURN v_tables;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_all_system_tables() TO anon, authenticated, service_role;

-- 2. ترقية دالة النسخ الاحتياطي التلقائي لتجميع كل الجداول الحالية والجديدة ديناميكياً
CREATE OR REPLACE FUNCTION public.execute_automated_daily_backup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, information_schema, net
AS $$
DECLARE
    v_bot_token text;
    v_is_tg_enabled text;
    v_is_backup_enabled text;
    v_backup_chat_id text;
    v_cairo_now timestamp;
    
    v_filename text;
    v_public_url text;
    v_caption text;
    
    v_tables_payload jsonb := '{}'::jsonb;
    v_full_payload jsonb;
    v_total_records integer := 0;
    v_file_size_bytes integer := 0;
    v_formatted_size text := '0 KB';
    
    r RECORD;
    v_table_data jsonb;
    v_table_count integer;
    v_table_names text[] := ARRAY[]::text[];
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

    -- 🌟 تجميع كافة الجداول الحية تلقائياً 100% مع استبعاد الطوابير والجداول الداخلية
    FOR r IN (
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
          AND table_name NOT IN (
              'spatial_ref_sys', 
              'system_backups_log', 
              'schema_migrations',
              'inventory_notification_queue'
          )
        ORDER BY table_name
    ) LOOP
        -- سحب بيانات الجدول كـ JSON
        EXECUTE format('SELECT COALESCE(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM public.%I t', r.table_name) INTO v_table_data;
        v_tables_payload := jsonb_set(v_tables_payload, ARRAY[r.table_name], v_table_data, true);
        
        -- حساب عدد السجلات
        EXECUTE format('SELECT count(*) FROM public.%I', r.table_name) INTO v_table_count;
        v_total_records := v_total_records + v_table_count;
        v_table_names := array_append(v_table_names, r.table_name::text);
    END LOOP;

    -- بناء ملف النسخة الاحتياطية المتوافق مع معايير DEVO
    v_full_payload := jsonb_build_object(
        'meta', jsonb_build_object(
            'version', '2.5.0',
            'format', 'DEVO_SYSTEM_BACKUP',
            'preset', 'full_system',
            'exported_at', to_char(v_cairo_now, 'YYYY-MM-DD"T"HH24:MI:SS'),
            'exported_by', 'system_cron_auto_backup',
            'total_records', v_total_records,
            'tables_count', COALESCE(array_length(v_table_names, 1), 0),
            'tables', v_table_names
        ),
        'tables', v_tables_payload
    );

    v_file_size_bytes := octet_length(v_full_payload::text);
    v_formatted_size := ROUND((v_file_size_bytes / 1024.0)::numeric, 1) || ' KB';

    -- تسجيل النسخة الاحتياطية في جدول system_backups_log (بدون تخزين البايلود لتفادي امتلاء قاعدة البيانات)
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
            'tables_count', COALESCE(array_length(v_table_names, 1), 0),
            'file_size_formatted', v_formatted_size
        )
    ) ON CONFLICT (filename) DO NOTHING;

    -- تطبيق سياسة الأرشفة والتنظيف (30 يوماً)
    PERFORM public.purge_old_backups_log(30);

    -- رفع ملف الـ JSON إلى حاوية التخزين السحابي Supabase Storage (system_backups)
    PERFORM net.http_post(
        url := 'https://abxbhtysmqzrswzsdrzi.supabase.co/storage/v1/object/system_backups/' || v_filename,
        body := v_full_payload,
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_so6KzXru538HEc5dFORaIA_4dB_SWzo", "apikey": "sb_publishable_so6KzXru538HEc5dFORaIA_4dB_SWzo"}'::jsonb
    );

    -- إرسال الإشعار والملف إلى تليجرام
    SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_backup_chat_id';
    IF v_backup_chat_id IS NULL OR trim(v_backup_chat_id) = '' THEN
        SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    END IF;

    IF v_bot_token IS NOT NULL AND v_backup_chat_id IS NOT NULL AND COALESCE(v_is_tg_enabled, 'true') = 'true' THEN
        v_public_url := 'https://abxbhtysmqzrswzsdrzi.supabase.co/storage/v1/object/public/system_backups/' || v_filename;
        
        v_caption := '☁️ *النسخ الاحتياطي التلقائي الكامل للنظام (شامل كافة الجداول)*' || E'\n' ||
                     '📅 التاريخ: ' || to_char(v_cairo_now, 'YYYY-MM-DD') || E'\n' ||
                     '⏰ التوقيت: ' || to_char(v_cairo_now, 'HH12:MI AM') || ' (توقيت القاهرة)' || E'\n' ||
                     '📊 إجمالي السجلات: ' || v_total_records || E'\n' ||
                     '📑 عدد الجداول المكتشفة: ' || COALESCE(array_length(v_table_names, 1), 0) || E'\n' ||
                     '💾 الحجم التقديري: ' || v_formatted_size || E'\n' ||
                     '🗂 اسم الملف: `' || v_filename || '`' || E'\n\n' ||
                     '📥 [اضغط هنا لتنزيل النسخة الاحتياطية مباشرة](' || v_public_url || ')' || E'\n\n' ||
                     '🛡️ *تم حفظ النسخة السحابية وتأمين بيانات كافة الجداول بنجاح.*';

        PERFORM net.http_post(
            url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
            body := jsonb_build_object(
                'chat_id', v_backup_chat_id,
                'text', v_caption,
                'parse_mode', 'Markdown',
                'disable_web_page_preview', false
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'filename', v_filename,
        'total_records', v_total_records,
        'tables_count', COALESCE(array_length(v_table_names, 1), 0)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_automated_daily_backup() TO anon, authenticated, service_role;
