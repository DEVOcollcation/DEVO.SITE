-- =========================================================================
-- 🌟 MIGRATION V6: RELEASE ORDER LOCK STATUS RESET 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-07-25
-- الإصدار: v6.0
-- الوصف: 
-- 1. تحديث دالة release_order_lock لتقوم بإعادة حالة الأوردر تلقائياً إلى 'created' (تم إنشاء الأوردر) عند إلغاء القفل.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.release_order_lock(
    p_order_id uuid
)
RETURNS boolean AS $$
BEGIN
    -- مسموح بالأونر/الأدمن، أو صانع الأوردر/المُسند إليه، أو عمال المخزن (warehouse / both)
    IF NOT EXISTS (
        SELECT 1 FROM public.orders o
        WHERE o.id = p_order_id
        AND (
            public.get_my_role() IN ('owner', 'admin')
            OR o.assigned_worker_id = auth.uid()
            OR o.worker_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.system_users u
                WHERE u.id = auth.uid()
                AND u.is_active = true
                AND u.role = 'worker'
                AND u.worker_job IN ('warehouse', 'both')
            )
        )
    ) THEN
        RAISE EXCEPTION 'غير مصرح لك بتحرير قفل هذا الأوردر.';
    END IF;

    UPDATE public.orders
    SET is_locked = false,
        assigned_worker_id = NULL,
        assigned_admin_name = NULL,
        status = 'created'
    WHERE id = p_order_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
