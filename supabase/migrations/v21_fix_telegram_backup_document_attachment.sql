-- ==============================================================================
-- 🚀 V21: إصلاح إرسال ملف النسخ الاحتياطي الفعلي كمستند مرفق إلى Telegram (sendDocument)
-- ==============================================================================
-- المشكلة المعالجة:
-- في الترقية الأخيرة، تم إرسال رسالة نصية فقط (sendMessage) بدلاً من إرفاق ملف الـ JSON الفعلي (sendDocument).
-- هذا التحديث يعيد إرسال المستند المرفق (.json) في شات التليجرام مع الكابشن التوضيحي ورابط التنزيل المباشر
-- بالإضافة لضمان تفعيل الحاوية السحابية system_backups وسياسات القراءة العامة لمنع أي أخطاء 400.
-- ==============================================================================

-- 1. التأكد من تفعيل حاوية التخزين system_backups وجعلها عامة للتنزيل المباشر
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'system_backups',
    'system_backups',
    true,
    52428800, -- 50 MB
    ARRAY['application/json', 'text/plain', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE 
SET public = true,
    file_size_limit = 52428800;

-- 2. تأكيد سياسات الـ Storage لتمكين الوصول المباشر والرفع
DO $$
BEGIN
    DROP POLICY IF EXISTS "Public Access for system_backups bucket" ON storage.objects;
    CREATE POLICY "Public Access for system_backups bucket"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'system_backups');

    DROP POLICY IF EXISTS "Public Upload for system_backups bucket" ON storage.objects;
    CREATE POLICY "Public Upload for system_backups bucket"
        ON storage.objects FOR INSERT
        WITH CHECK (bucket_id = 'system_backups');

    DROP POLICY IF EXISTS "Public Update for system_backups bucket" ON storage.objects;
    CREATE POLICY "Public Update for system_backups bucket"
        ON storage.objects FOR UPDATE
        USING (bucket_id = 'system_backups');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. ترقية دالة النسخ الاحتياطي التلقائي لإرسال الملف الفعلي كمستند مرفق (sendDocument)
CREATE OR REPLACE FUNCTION public.execute_automated_daily_backup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, information_schema, net, storage
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
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer sb_publishable_so6KzXru538HEc5dFORaIA_4dB_SWzo", "apikey": "sb_publishable_so6KzXru538HEc5dFORaIA_4dB_SWzo", "x-upsert": "true"}'::jsonb,
        timeout_milliseconds := 15000
    );

    -- فهرسة الملف في جدول storage.objects لضمان التوافق التام مع مسارات التنزيل
    BEGIN
        INSERT INTO storage.objects (
            id,
            bucket_id,
            name,
            owner,
            created_at,
            updated_at,
            last_accessed_at,
            metadata
        ) VALUES (
            gen_random_uuid(),
            'system_backups',
            v_filename,
            NULL,
            now(),
            now(),
            now(),
            jsonb_build_object(
                'mimetype', 'application/json',
                'size', v_file_size_bytes,
                'cacheControl', 'max-age=3600'
            )
        ) ON CONFLICT (bucket_id, name) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- إرسال الإشعار والمستند المرفق إلى Telegram
    SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_backup_chat_id';
    IF v_backup_chat_id IS NULL OR trim(v_backup_chat_id) = '' THEN
        SELECT setting_value INTO v_backup_chat_id FROM public.home_settings WHERE setting_key = 'telegram_chat_id';
    END IF;

    -- ضبط بادئة السوبر جروب (-100...)
    IF v_backup_chat_id LIKE '-%' AND v_backup_chat_id NOT LIKE '-100%' AND LENGTH(v_backup_chat_id) >= 8 THEN
        v_backup_chat_id := '-100' || SUBSTRING(v_backup_chat_id FROM 2);
    END IF;

    IF v_bot_token IS NOT NULL AND v_backup_chat_id IS NOT NULL AND COALESCE(v_is_tg_enabled, 'true') = 'true' THEN
        v_public_url := 'https://abxbhtysmqzrswzsdrzi.supabase.co/storage/v1/object/public/system_backups/' || v_filename;
        
        v_caption := '🛡️ <b>النسخ الاحتياطي للنظام</b>' || E'\n\n' ||
                     '📅 <b>التاريخ والوقت:</b> ' || to_char(v_cairo_now, 'YYYY/M/D') || '، ' || to_char(v_cairo_now, 'HH12:MI:SS') || CASE WHEN EXTRACT(HOUR FROM v_cairo_now) >= 12 THEN ' م' ELSE ' ص' END || E'\n' ||
                     '📦 <b>نوع النسخة:</b> نسخة احتياطية كاملة للنظام (شاملة كافة الجداول)' || E'\n' ||
                     '📊 <b>إجمالي السجلات:</b> ' || to_char(v_total_records, 'FM999,999,999') || ' سجل' || E'\n' ||
                     '📑 <b>عدد الجداول:</b> ' || COALESCE(array_length(v_table_names, 1), 0) || ' جدول' || E'\n' ||
                     '💾 <b>حجم الملف:</b> ' || v_formatted_size || E'\n' ||
                     '🌐 <b>النظام:</b> DEVO Collection v2.5.0' || E'\n\n' ||
                     '🔗 <a href="' || v_public_url || '">اضغط هنا لتنزيل النسخة المباشرة من السحابة (.json)</a>';

        -- إرسال ملف الـ JSON الفعلي كمستند مرفق (sendDocument) في التليجرام
        PERFORM net.http_post(
            url := 'https://api.telegram.org/bot' || v_bot_token || '/sendDocument',
            body := jsonb_build_object(
                'chat_id', v_backup_chat_id,
                'document', v_public_url,
                'caption', v_caption,
                'parse_mode', 'HTML'
            ),
            headers := '{"Content-Type": "application/json"}'::jsonb,
            timeout_milliseconds := 15000
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
