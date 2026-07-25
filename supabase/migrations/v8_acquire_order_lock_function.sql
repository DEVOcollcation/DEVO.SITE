-- =========================================================================
-- 🌟 MIGRATION V8: ACQUIRE ORDER LOCK FUNCTION FOR WORKERS & ADMINS 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-07-25
-- الإصدار: v8.0
-- الوصف: 
-- 1. إنشاء دالة acquire_order_lock بصلاحيات SECURITY DEFINER لتسمح للعمال (بجانب الإدارة)
--    بقفل الأوردر الخاص بهم وتغيير حالته إلى 'in_progress' عند بدء التعديل وتخطي قيود RLS.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.acquire_order_lock(
    p_order_id uuid,
    p_assigned_admin_name text
)
RETURNS boolean AS $$
BEGIN
    -- التحقق من الصلاحيات: مسموح للأونر/الأدمن، أو صانع الأوردر، أو المسند إليه
    IF NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND (
            public.get_my_role() IN ('owner', 'admin')
            OR o.assigned_worker_id = auth.uid()
            OR o.worker_id = auth.uid()
        )
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بتعديل أو قفل هذا الأوردر.';
    END IF;

    -- التحقق مما إذا كان الأوردر مقفولاً بالفعل بواسطة إداري/موظف آخر
    IF EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND o.is_locked = true
        AND o.assigned_admin_name IS DISTINCT FROM p_assigned_admin_name
        AND public.get_my_role() NOT IN ('owner') -- المالك يستطيع كسر القفل
    ) THEN
        RAISE EXCEPTION 'عفواً، هذا الأوردر مقفول حالياً بواسطة مستخدم آخر.';
    END IF;

    -- تحديث حالة وقفل الأوردر
    UPDATE public.orders
    SET is_locked = true,
        assigned_admin_name = p_assigned_admin_name,
        status = 'editing'
    WHERE id = p_order_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
