-- ==============================================================================
-- Migration v19: DEVO Model Image Importer Support
-- Adds drive_file_id, sort_order, and is_cover to model_images
-- Configures default home_settings keys for Google Drive integration
-- ==============================================================================

-- 1. إضافة الأعمدة الجديدة لجدول model_images لدعم الترتيب وصور الغلاف ومعرفات Drive
ALTER TABLE public.model_images ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE public.model_images ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 1;
ALTER TABLE public.model_images ADD COLUMN IF NOT EXISTS is_cover boolean DEFAULT false;

-- 2. تنظيف وحذف أي سجلات مكررة سابقاً لنفس الموديل قبل إنشاء الفهارس الفريدة (لمنع خطأ duplicate key 23505)
DELETE FROM public.model_images a
USING public.model_images b
WHERE a.ctid < b.ctid
  AND a.model_id = b.model_id
  AND a.drive_file_id = b.drive_file_id
  AND a.drive_file_id IS NOT NULL 
  AND a.drive_file_id <> '';

DELETE FROM public.model_images a
USING public.model_images b
WHERE a.ctid < b.ctid
  AND a.model_id = b.model_id
  AND a.image_url = b.image_url
  AND a.image_url IS NOT NULL 
  AND a.image_url <> '';

-- 3. فهرس لتسريع استرجاع الصور مرتبة حسب رقم الترتيب لكل موديل
CREATE INDEX IF NOT EXISTS idx_model_images_model_sort 
ON public.model_images(model_id, sort_order ASC);

-- 3.1 منع دبلرة نفس معرف ملف Google Drive لنفس الموديل
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_images_model_drive_file_id 
ON public.model_images(model_id, drive_file_id) 
WHERE drive_file_id IS NOT NULL AND drive_file_id <> '';

-- 3.2 منع دبلرة نفس رابط الصورة لنفس الموديل
CREATE UNIQUE INDEX IF NOT EXISTS uq_model_images_model_image_url 
ON public.model_images(model_id, image_url) 
WHERE image_url IS NOT NULL AND image_url <> '';

-- 3. التأكد من صلاحيات RLS لجدول model_images
DO $$
BEGIN
    -- قراءة متاحة للجميع
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'model_images' 
        AND policyname = 'model_images_select_public'
    ) THEN
        CREATE POLICY "model_images_select_public" ON public.model_images 
        FOR SELECT USING (true);
    END IF;

    -- الكتابة والتعديل والحذف للأدمن والمالك فقط
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'model_images' 
        AND policyname = 'model_images_write_admin'
    ) THEN
        CREATE POLICY "model_images_write_admin" ON public.model_images 
        FOR ALL TO authenticated 
        USING (public.get_my_role() IN ('owner', 'admin')) 
        WITH CHECK (public.get_my_role() IN ('owner', 'admin'));
    END IF;
END $$;

-- 4. إدراج مفاتيح إعدادات Google Drive الافتراضية في جدول home_settings إن لم تكن موجودة
INSERT INTO public.home_settings (setting_key, setting_value)
VALUES 
    ('gdrive_api_key', ''),
    ('gdrive_last_folder_url', ''),
    ('gdrive_image_last_sync', '{}')
ON CONFLICT (setting_key) DO NOTHING;
