-- ============================================================
--  نظام إدارة تحضير الأوردرات - DEVO.SITE
--  Preparation Management System
-- ============================================================
-- شغّل هذا السكريبت كاملاً داخل Supabase SQL Editor
-- ============================================================


-- ============================================================
-- 1. إضافة أعمدة التحضير على جدول orders
--    حالات التحضير مستقلة عن حقل status الأصلي
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS preparation_status text
    NOT NULL DEFAULT 'pending'
    CHECK (preparation_status IN (
      'pending',      -- في انتظار التحضير
      'in_progress',  -- جاري التحضير
      'on_hold',      -- في انتظار (مشكلة / نقص)
      'prepared',     -- تم التحضير
      'shipped'       -- تم الشحن
    ));

-- العامل المسؤول عن التحضير
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS prepared_by uuid
    REFERENCES public.system_users(id);

-- وقت بدء التحضير
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS preparation_started_at timestamp with time zone;

-- وقت إتمام التحضير
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS preparation_completed_at timestamp with time zone;

-- ملاحظة عامة على مستوى الأوردر من قِبَل العامل
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS preparation_notes text;


-- ============================================================
-- 2. جدول تحضير عناصر الأوردر (لكل لون في كل موديل)
--    order_item_preparation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.order_item_preparation (
  id              uuid    NOT NULL DEFAULT gen_random_uuid(),
  order_item_id   uuid    NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  order_id        uuid    NOT NULL REFERENCES public.orders(id)      ON DELETE CASCADE,
  model_id        uuid    NOT NULL REFERENCES public.models(id),
  color_id        uuid    NOT NULL REFERENCES public.colors(id),

  -- هل تم تحضير هذا العنصر؟
  is_prepared     boolean NOT NULL DEFAULT false,

  -- هل يوجد مشكلة / نقص في هذا اللون؟
  has_issue       boolean NOT NULL DEFAULT false,

  -- ملاحظة خاصة بهذا اللون
  note            text,

  -- الكمية الفعلية المُحضَّرة (يملأها العامل)
  prepared_qty    integer CHECK (prepared_qty >= 0),

  -- وقت آخر تعديل
  updated_at      timestamp with time zone DEFAULT now(),

  -- العامل الذي حدّث هذا السطر
  updated_by      uuid REFERENCES public.system_users(id),

  CONSTRAINT order_item_preparation_pkey   PRIMARY KEY (id),
  CONSTRAINT order_item_preparation_unique UNIQUE (order_item_id)
);


-- ============================================================
-- 3. جدول سجل تاريخ تغيير حالة التحضير (Audit Log)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.preparation_status_log (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  changed_by  uuid REFERENCES public.system_users(id),
  old_status  text,
  new_status  text NOT NULL,
  note        text,
  changed_at  timestamp with time zone DEFAULT now(),

  CONSTRAINT preparation_status_log_pkey PRIMARY KEY (id)
);


-- ============================================================
-- 4. Indexes للأداء
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_orders_preparation_status
  ON public.orders (preparation_status);

CREATE INDEX IF NOT EXISTS idx_orders_prepared_by
  ON public.orders (prepared_by);

CREATE INDEX IF NOT EXISTS idx_order_item_prep_order_id
  ON public.order_item_preparation (order_id);

CREATE INDEX IF NOT EXISTS idx_order_item_prep_item_id
  ON public.order_item_preparation (order_item_id);

CREATE INDEX IF NOT EXISTS idx_prep_log_order_id
  ON public.preparation_status_log (order_id);


-- ============================================================
-- 5. دالة: حساب نسبة تقدم تحضير الأوردر (0-100)
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_order_preparation_progress(p_order_id uuid)
RETURNS TABLE (
  total_items     integer,
  prepared_items  integer,
  issue_items     integer,
  progress_pct    numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)::integer                                              AS total_items,
    COUNT(*) FILTER (WHERE is_prepared = true)::integer           AS prepared_items,
    COUNT(*) FILTER (WHERE has_issue   = true)::integer           AS issue_items,
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND(
             COUNT(*) FILTER (WHERE is_prepared = true)::numeric
             / COUNT(*)::numeric * 100,
             1
           )
    END                                                           AS progress_pct
  FROM public.order_item_preparation
  WHERE order_id = p_order_id;
$$;


-- ============================================================
-- 6. دالة: التحقق إذا كان يمكن رفع حالة الأوردر
--    إلى prepared أو shipped (كل العناصر جاهزة؟)
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_mark_order_prepared(p_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    -- يجب أن تكون كل العناصر محضَّرة
    NOT EXISTS (
      SELECT 1
      FROM public.order_item_preparation
      WHERE order_id  = p_order_id
        AND is_prepared = false
    )
    -- ويجب أن يوجد عناصر أصلاً (لم يُهيَّأ الأوردر بعد = لا يُعتبر جاهزاً)
    AND EXISTS (
      SELECT 1
      FROM public.order_item_preparation
      WHERE order_id = p_order_id
    );
$$;


-- ============================================================
-- 7. دالة: تهيئة سجلات التحضير لأوردر (عند بدء العامل العمل)
--    init_order_preparation(order_id, worker_id)
-- ============================================================

CREATE OR REPLACE FUNCTION public.init_order_preparation(
  p_order_id  uuid,
  p_worker_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- أنشئ سجل تحضير لكل بند في الأوردر إذا لم يكن موجوداً
  INSERT INTO public.order_item_preparation
    (order_item_id, order_id, model_id, color_id, updated_by)
  SELECT
    oi.id,
    oi.order_id,
    oi.model_id,
    oi.color_id,
    p_worker_id
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id
  ON CONFLICT (order_item_id) DO NOTHING;

  -- غيّر حالة الأوردر إلى in_progress وسجّل العامل والوقت
  UPDATE public.orders
  SET
    preparation_status     = 'in_progress',
    prepared_by            = COALESCE(p_worker_id, prepared_by),
    preparation_started_at = COALESCE(preparation_started_at, now())
  WHERE id = p_order_id
    AND preparation_status = 'pending';
END;
$$;


-- ============================================================
-- 8. دالة: حفظ الحالة النهائية للأوردر بعد التحضير
--    finalize_order_preparation(order_id, worker_id, new_status, note)
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_order_preparation(
  p_order_id   uuid,
  p_worker_id  uuid,
  p_new_status text,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_can_complete boolean;
  v_old_status   text;
BEGIN
  SELECT preparation_status INTO v_old_status
  FROM public.orders WHERE id = p_order_id;

  -- إذا كانت الحالة المطلوبة prepared أو shipped,
  -- تحقق أن جميع العناصر محضَّرة
  IF p_new_status IN ('prepared', 'shipped') THEN
    SELECT public.can_mark_order_prepared(p_order_id) INTO v_can_complete;
    IF NOT v_can_complete THEN
      RETURN jsonb_build_object(
        'success', false,
        'error',   'لا يمكن إتمام الأوردر: يوجد عناصر لم يتم تحضيرها بعد'
      );
    END IF;
  END IF;

  -- تحديث الأوردر
  UPDATE public.orders
  SET
    preparation_status       = p_new_status,
    preparation_notes        = COALESCE(p_note, preparation_notes),
    preparation_completed_at = CASE
                                 WHEN p_new_status IN ('prepared', 'shipped')
                                 THEN now()
                                 ELSE preparation_completed_at
                               END
  WHERE id = p_order_id;

  -- تسجيل في سجل التاريخ
  INSERT INTO public.preparation_status_log
    (order_id, changed_by, old_status, new_status, note)
  VALUES
    (p_order_id, p_worker_id, v_old_status, p_new_status, p_note);

  RETURN jsonb_build_object('success', true, 'new_status', p_new_status);
END;
$$;


-- ============================================================
-- 9. Trigger: تحديث updated_at تلقائياً في order_item_preparation
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_preparation_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_preparation_updated_at ON public.order_item_preparation;

CREATE TRIGGER trg_preparation_updated_at
  BEFORE UPDATE ON public.order_item_preparation
  FOR EACH ROW EXECUTE FUNCTION public.touch_preparation_updated_at();


-- ============================================================
-- 10. Row Level Security (RLS)
-- ============================================================

-- order_item_preparation
ALTER TABLE public.order_item_preparation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prep_select_all" ON public.order_item_preparation;
DROP POLICY IF EXISTS "prep_insert_all" ON public.order_item_preparation;
DROP POLICY IF EXISTS "prep_update_all" ON public.order_item_preparation;

CREATE POLICY "prep_select_all"
  ON public.order_item_preparation FOR SELECT USING (true);

CREATE POLICY "prep_insert_all"
  ON public.order_item_preparation FOR INSERT WITH CHECK (true);

CREATE POLICY "prep_update_all"
  ON public.order_item_preparation FOR UPDATE USING (true);

-- preparation_status_log
ALTER TABLE public.preparation_status_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prep_log_select_all" ON public.preparation_status_log;
DROP POLICY IF EXISTS "prep_log_insert_all" ON public.preparation_status_log;

CREATE POLICY "prep_log_select_all"
  ON public.preparation_status_log FOR SELECT USING (true);

CREATE POLICY "prep_log_insert_all"
  ON public.preparation_status_log FOR INSERT WITH CHECK (true);


-- ============================================================
-- 11. View: ملخص الأوردرات مع نسبة التحضير (للإدارة)
--     v_orders_preparation_summary
-- ============================================================

CREATE OR REPLACE VIEW public.v_orders_preparation_summary AS
SELECT
  o.id,
  o.invoice_number,
  o.customer_name,
  o.phone_1,
  o.phone_2,
  o.address,
  o.total_price,
  o.total_series,
  o.notes,
  o.preparation_status,
  o.preparation_notes,
  o.preparation_started_at,
  o.preparation_completed_at,
  o.is_archived,
  o.created_at,
  -- العامل المسؤول
  su.full_name    AS worker_name,
  su.username     AS worker_username,
  -- إحصاءات التحضير
  COALESCE(prog.total_items,    0)::integer AS total_items,
  COALESCE(prog.prepared_items, 0)::integer AS prepared_items,
  COALESCE(prog.issue_items,    0)::integer AS issue_items,
  COALESCE(prog.progress_pct,   0)::numeric AS progress_pct
FROM public.orders o
LEFT JOIN public.system_users su ON su.id = o.prepared_by
LEFT JOIN LATERAL (
  SELECT * FROM public.get_order_preparation_progress(o.id)
) prog ON true;


-- ============================================================
-- 12. View: تفاصيل عناصر التحضير (للعامل والإدارة)
--     v_preparation_items_detail
-- ============================================================

CREATE OR REPLACE VIEW public.v_preparation_items_detail AS
SELECT
  oip.id               AS prep_id,
  oip.order_id,
  oip.order_item_id,
  oip.is_prepared,
  oip.has_issue,
  oip.note             AS prep_note,
  oip.prepared_qty,
  oip.updated_at       AS prep_updated_at,
  -- الموديل
  m.id                 AS model_id,
  m.system_code,
  m.factory_code,
  m.name               AS model_name,
  -- الفئة العمرية
  cat.id               AS category_id,
  cat.name             AS category_name,
  -- التصنيف
  cls.id               AS class_id,
  cls.name             AS class_name,
  -- اللون
  c.id                 AS color_id,
  c.name               AS color_name,
  c.color_code,
  -- الكمية المطلوبة
  oi.quantity          AS required_qty,
  oi.price_per_series,
  oi.total_price       AS item_total_price
FROM public.order_item_preparation oip
JOIN public.order_items   oi  ON oi.id  = oip.order_item_id
JOIN public.models         m  ON m.id   = oip.model_id
JOIN public.colors         c  ON c.id   = oip.color_id
LEFT JOIN public.categories cat ON cat.id = m.category_id
LEFT JOIN public.classes    cls ON cls.id = m.class_id;


-- ============================================================
-- ✓ انتهى السكريبت بنجاح
-- ============================================================
