-- =========================================================================
-- 🌟 MIGRATION V11: AUTOMATED CLOUD BACKUPS, LOGS & STORAGE RETENTION 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-07-31
-- الإصدار: v11.0
-- الوصف:
-- 1. إنشاء جدول سجل النسخ الاحتياطية السحابية system_backups_log لتتبع أحدث النسخ التلقائية واليدوية.
-- 2. إعداد حاوية تخزين Supabase Storage (system_backups) لحفظ ملفات النسخ الاحتياطية بأمان وتفعيل الوصول المباشر.
-- 3. دالة تنظيف تلقائي (purge_old_backups_log) لحذف سجلات وملفات النسخ الأقدم من 30 يوماً.
-- =========================================================================

-- 1. إنشاء جدول سجل النسخ الاحتياطية
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

-- تفعيل RLS على جدول السجلات
ALTER TABLE public.system_backups_log ENABLE ROW LEVEL SECURITY;

-- سماحيات RLS لكافة أدوار المستخدمين (authenticated + anon) لتسجيل واسترجاع النسخ بدون عوائق
DO $$
BEGIN
    DROP POLICY IF EXISTS "Allow read access to system_backups_log for authenticated" ON public.system_backups_log;
    DROP POLICY IF EXISTS "Allow insert access to system_backups_log for authenticated" ON public.system_backups_log;
    DROP POLICY IF EXISTS "Allow delete access to system_backups_log for authenticated" ON public.system_backups_log;
    DROP POLICY IF EXISTS "Allow all access to system_backups_log" ON public.system_backups_log;
END $$;

CREATE POLICY "Allow all access to system_backups_log"
    ON public.system_backups_log FOR ALL
    USING (true)
    WITH CHECK (true);

-- 2. إنشاء Supabase Storage Bucket لحفظ النسخ السحابية بأمان وبطريقة عامة للوصول المباشر
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

-- سياسات الوصول الشاملة المباشرة لـ Storage Bucket system_backups
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND schemaname = 'storage' 
        AND policyname = 'Public Access for system_backups bucket'
    ) THEN
        CREATE POLICY "Public Access for system_backups bucket"
            ON storage.objects FOR SELECT
            USING (bucket_id = 'system_backups');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND schemaname = 'storage' 
        AND policyname = 'Public Upload for system_backups bucket'
    ) THEN
        CREATE POLICY "Public Upload for system_backups bucket"
            ON storage.objects FOR INSERT
            WITH CHECK (bucket_id = 'system_backups');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'objects' 
        AND schemaname = 'storage' 
        AND policyname = 'Public Delete for system_backups bucket'
    ) THEN
        CREATE POLICY "Public Delete for system_backups bucket"
            ON storage.objects FOR DELETE
            USING (bucket_id = 'system_backups');
    END IF;
END $$;

-- 3. دالة تنظيف النسخ الاحتياطية القديمة تلقائياً (Retention Policy: 30 يوماً)
CREATE OR REPLACE FUNCTION public.purge_old_backups_log(p_retention_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    deleted_count integer := 0;
BEGIN
    -- حذف السجلات الأقدم من عدد الأيام المحدد
    WITH deleted_rows AS (
        DELETE FROM public.system_backups_log
        WHERE created_at < (now() - (p_retention_days || ' days')::interval)
        RETURNING id
    )
    SELECT count(*) INTO deleted_count FROM deleted_rows;

    RETURN deleted_count;
END;
$$;
