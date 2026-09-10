-- ================================================
-- 🌟 DEVO — Visitor Orders System (Full SQL Setup)
-- نفذ هذا الكود في Supabase SQL Editor
-- ================================================

-- 1. جدول طلبات الزوار
CREATE TABLE IF NOT EXISTS visitor_orders (
  id            UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  customer_name TEXT        NOT NULL,
  phone_1       TEXT        NOT NULL,
  phone_2       TEXT,
  address       TEXT,
  notes         TEXT,
  total_price   NUMERIC     NOT NULL DEFAULT 0,
  total_series  INT         NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'pending',
  reviewed_at   TIMESTAMPTZ,
  reviewed_by   TEXT,
  rejection_reason TEXT
);

-- 2. جدول أصناف طلبات الزوار
CREATE TABLE IF NOT EXISTS visitor_order_items (
  id                UUID    DEFAULT gen_random_uuid() PRIMARY KEY,
  visitor_order_id  UUID    REFERENCES visitor_orders(id) ON DELETE CASCADE,
  model_id          UUID    REFERENCES models(id),
  color_id          UUID    REFERENCES colors(id),
  model_name        TEXT,
  color_name        TEXT,
  factory_code      TEXT,
  quantity          INT     NOT NULL DEFAULT 1,
  price_per_series  NUMERIC NOT NULL DEFAULT 0,
  sizes_count       INT     DEFAULT 1,
  total_price       NUMERIC NOT NULL DEFAULT 0
);

-- 3. فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_visitor_orders_status     ON visitor_orders (status);
CREATE INDEX IF NOT EXISTS idx_visitor_orders_created_at ON visitor_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_order_items_order ON visitor_order_items (visitor_order_id);

-- 4. تفعيل Row Level Security
ALTER TABLE visitor_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE visitor_order_items ENABLE ROW LEVEL SECURITY;

-- 5. سياسات visitor_orders
DROP POLICY IF EXISTS "visitor_orders_select_all" ON visitor_orders;
DROP POLICY IF EXISTS "visitor_orders_select_anon" ON visitor_orders;
CREATE POLICY "visitor_orders_select_all"
  ON visitor_orders FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "visitor_orders_insert_anon" ON visitor_orders;
CREATE POLICY "visitor_orders_insert_anon"
  ON visitor_orders FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "visitor_orders_all_auth" ON visitor_orders;
CREATE POLICY "visitor_orders_all_auth"
  ON visitor_orders FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 6. سياسات visitor_order_items
DROP POLICY IF EXISTS "visitor_order_items_select_all" ON visitor_order_items;
DROP POLICY IF EXISTS "visitor_order_items_select_anon" ON visitor_order_items;
CREATE POLICY "visitor_order_items_select_all"
  ON visitor_order_items FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "visitor_order_items_insert_anon" ON visitor_order_items;
CREATE POLICY "visitor_order_items_insert_anon"
  ON visitor_order_items FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "visitor_order_items_all_auth" ON visitor_order_items;
CREATE POLICY "visitor_order_items_all_auth"
  ON visitor_order_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 7. منح الصلاحيات الصريحة (Grants)
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.visitor_orders TO anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.visitor_order_items TO anon, authenticated;
GRANT UPDATE, DELETE ON TABLE public.visitor_orders TO authenticated;
GRANT UPDATE, DELETE ON TABLE public.visitor_order_items TO authenticated;

-- 8. تفعيل الاستماع اللحظي Realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'visitor_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE visitor_orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'visitor_order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE visitor_order_items;
  END IF;
END $$;
