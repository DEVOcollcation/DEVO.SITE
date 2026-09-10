-- ================================================================
-- 🌟 حل مشكلة استعلام طلبات الزوار (Fix Visitor Orders RLS & Permissions)
-- نفذ هذا الكود في Supabase SQL Editor لحل مشكلة عدم ظهور الطلبات عند الاستعلام
-- ================================================================

-- 1. التأكد من تفعيل Row Level Security على الجداول
ALTER TABLE public.visitor_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visitor_order_items ENABLE ROW LEVEL SECURITY;

-- 2. سياسات جدول visitor_orders
-- أ) السماح للجميع (زوار ومستخدمين) بالاستعلام وقراءة الطلبات
DROP POLICY IF EXISTS "visitor_orders_select_anon" ON public.visitor_orders;
DROP POLICY IF EXISTS "visitor_orders_select_all" ON public.visitor_orders;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.visitor_orders;
CREATE POLICY "visitor_orders_select_all"
  ON public.visitor_orders
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ب) السماح للزوار بإرسال طلبات جديدة
DROP POLICY IF EXISTS "visitor_orders_insert_anon" ON public.visitor_orders;
CREATE POLICY "visitor_orders_insert_anon"
  ON public.visitor_orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ج) السماح للمشرفين المسجلين بكافة الصلاحيات (تعديل، قبول، رفض، حذف، أرشفة)
DROP POLICY IF EXISTS "visitor_orders_all_auth" ON public.visitor_orders;
CREATE POLICY "visitor_orders_all_auth"
  ON public.visitor_orders
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. سياسات جدول visitor_order_items
-- أ) السماح للجميع بقراءة تفاصيل وأصناف الطلبات
DROP POLICY IF EXISTS "visitor_order_items_select_anon" ON public.visitor_order_items;
DROP POLICY IF EXISTS "visitor_order_items_select_all" ON public.visitor_order_items;
DROP POLICY IF EXISTS "Enable read access for all users on items" ON public.visitor_order_items;
CREATE POLICY "visitor_order_items_select_all"
  ON public.visitor_order_items
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ب) السماح بإضافة أصناف الطلبات
DROP POLICY IF EXISTS "visitor_order_items_insert_anon" ON public.visitor_order_items;
CREATE POLICY "visitor_order_items_insert_anon"
  ON public.visitor_order_items
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ج) السماح للمشرفين بكافة العمليات على الأصناف
DROP POLICY IF EXISTS "visitor_order_items_all_auth" ON public.visitor_order_items;
CREATE POLICY "visitor_order_items_all_auth"
  ON public.visitor_order_items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. منح الصلاحيات الصريحة (Grants) لأدوار Supabase
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.visitor_orders TO anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.visitor_order_items TO anon, authenticated;
GRANT UPDATE, DELETE ON TABLE public.visitor_orders TO authenticated;
GRANT UPDATE, DELETE ON TABLE public.visitor_order_items TO authenticated;
