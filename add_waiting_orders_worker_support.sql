-- =========================================================================
-- 🌟 ترقية جدول طلبات وفواتير الانتظار لدعم الموظفين والعربون (اختياري)
-- قم بتشغيل هذا الكود في Supabase SQL Editor
-- =========================================================================

-- 1. إضافة أعمدة الموظف والعربون إن لم تكن موجودة
ALTER TABLE IF EXISTS public.visitor_orders 
  ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES public.system_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_name TEXT,
  ADD COLUMN IF NOT EXISTS deposit NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_receiver TEXT;

-- 2. فهرس لتسريع استعلام فواتير الانتظار للموظف
CREATE INDEX IF NOT EXISTS idx_visitor_orders_worker_id ON public.visitor_orders(worker_id);
