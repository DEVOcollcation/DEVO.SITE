-- =========================================================================
-- 🌟 إضافة مطلوبة لتشغيل التعديل الجديد في cart.js: دالة تحرير قفل الأوردر
-- تُضاف لملف migration.sql (يفضّل بعد قسم "5. إنشاء الدوال الإدارية...")
-- =========================================================================

-- الهدف: تحرير قفل الأوردر (is_locked / assigned_worker_id / assigned_admin_name)
-- من غير ما نضطر نفتح صلاحية UPDATE عامة على جدول orders للعامل، ومن غير ما
-- نسمح له يغيّر أي عمود تاني (سعر، عميل، مخزون...) غير أعلام القفل بس.

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
        assigned_admin_name = NULL
    WHERE id = p_order_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
