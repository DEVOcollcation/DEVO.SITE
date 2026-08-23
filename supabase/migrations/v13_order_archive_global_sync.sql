-- =========================================================================
-- 🌟 MIGRATION V13: ORDER ARCHIVE GLOBAL DATABASE SYNC & REALTIME 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-08-23
-- الإصدار: v13.0
-- الوصف:
-- 1. التأكد من وجود عمود is_archived في جدول orders بقيمة افتراضية false
-- 2. إنشاء فهرس لتحسين أداء استعلامات الأرشفة والفلترة
-- 3. إنشاء دالة سحابية مركزية (toggle_order_archive) لتحديث حالة الأرشفة وحفظها مركزياً وتسجيلها في سجلات الحركات
-- =========================================================================

-- 1. إضافة عمود الأرشفة لجدول الطلبات في حال عدم وجوده
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- 2. إنشاء فهرس سريع على عمود الأرشفة
CREATE INDEX IF NOT EXISTS idx_orders_is_archived ON public.orders(is_archived);

-- 3. دالة مركزية مؤمنة لتعديل أرشفة الأوردرات وتسجيل الحركة (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.toggle_order_archive(
    p_order_id uuid,
    p_archive_status boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id uuid;
    v_caller_role text;
    v_caller_name text;
    v_order RECORD;
BEGIN
    -- التحقق من جلسة المستخدم
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'المستخدم غير مسجل دخول';
    END IF;

    -- جلب بيانات ودور المستخدم
    SELECT role, full_name INTO v_caller_role, v_caller_name
    FROM public.system_users
    WHERE id = v_caller_id AND is_active = true;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'المستخدم غير مصرح له أو حسابه معطل';
    END IF;

    -- جلب بيانات الطلب
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'الأوردر المطلوب غير موجود';
    END IF;

    -- التحقق من الصلاحيات: مسموح للإدارة (owner / admin) أو لصاحب الطلب (worker_id / assigned_worker_id)
    IF v_caller_role NOT IN ('owner', 'admin') 
       AND v_order.worker_id != v_caller_id 
       AND v_order.assigned_worker_id != v_caller_id THEN
        RAISE EXCEPTION 'غير مصرح لك بتعديل حالة أرشفة هذا الأوردر';
    END IF;

    -- تحديث حالة الأرشفة في جدول الطلبات
    UPDATE public.orders
    SET is_archived = p_archive_status
    WHERE id = p_order_id;

    -- تسجيل الحركة تلقائياً في جدول سجلات الأوردرات (order_logs)
    INSERT INTO public.order_logs (
        order_id,
        user_id,
        user_name,
        action_type,
        notes
    ) VALUES (
        p_order_id,
        v_caller_id,
        COALESCE(v_caller_name, 'مستخدم النظام'),
        CASE WHEN p_archive_status THEN 'archived' ELSE 'unarchived' END,
        CASE WHEN p_archive_status 
             THEN 'تم نقل الأوردر إلى الأرشيف بواسطة ' || COALESCE(v_caller_name, '')
             ELSE 'تم استعادة الأوردر من الأرشيف بواسطة ' || COALESCE(v_caller_name, '')
        END
    );

    RETURN jsonb_build_object(
        'success', true,
        'order_id', p_order_id,
        'is_archived', p_archive_status
    );
END;
$$;

-- منح صلاحية تنفيذ الدالة للمستخدمين المسجلين
GRANT EXECUTE ON FUNCTION public.toggle_order_archive(uuid, boolean) TO authenticated;
