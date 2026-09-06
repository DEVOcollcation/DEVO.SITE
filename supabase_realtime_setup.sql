-- ===================================================================
-- 🚀 DEVO Realtime Optimization & Full Replication Identity Setup 🚀
-- تشغيل هذا الكود في Supabase SQL Editor يضمن وصول كافة بيانات الموديلات
-- والمخزون بشكل فوري وكامل لجميع الأجهزة بدون أي نقص عند التعديل أو الحذف
-- ===================================================================

-- 1. تفعيل هوية النسخ الكاملة (Full Replica Identity)
-- لضمان إرسال كامل بيانات الصف القديم والجديد في أحداث Realtime
ALTER TABLE public.models REPLICA IDENTITY FULL;
ALTER TABLE public.model_inventory REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;

-- 2. التأكد من وجود الجداول داخل منشور البث اللحظي (supabase_realtime)
DO $$
BEGIN
    -- جدول الموديلات models
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'models'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.models;
    END IF;

    -- جدول المخزون والألوان model_inventory
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'model_inventory'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.model_inventory;
    END IF;

    -- جدول الأوردرات orders
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    END IF;
END $$;
