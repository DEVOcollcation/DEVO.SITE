-- =========================================================================
-- 🌟 MIGRATION V22: ENSURE SUPABASE REALTIME FOR MODEL INVENTORY & MODELS 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-10-02
-- الإصدار: v22.0
-- الوصف:
-- 1. التأكد من إضافة جدولي model_inventory و models إلى منشور supabase_realtime
-- 2. ضبط REPLICA IDENTITY FULL للجداول لضمان وصول كافة بيانات السجل القديم والجديد في البث اللحظي
-- =========================================================================

DO $$
BEGIN
    -- 1. إضافة جدول model_inventory للبث اللحظي إذا لم يكن مضافاً
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'model_inventory'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.model_inventory;
    END IF;

    -- 2. إضافة جدول models للبث اللحظي إذا لم يكن مضافاً
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
        AND schemaname = 'public' 
        AND tablename = 'models'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.models;
    END IF;
END $$;

-- 3. ضبط هوية التكرار الكاملة لتوفير قيم الصفوف كاملة عند التحديث والحذف
ALTER TABLE public.model_inventory REPLICA IDENTITY FULL;
ALTER TABLE public.models REPLICA IDENTITY FULL;
