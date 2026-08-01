-- =========================================================================
-- 🌟 MIGRATION V10: SYSTEM NOTIFICATIONS RLS & CONFLICT FIXES 🌟
-- =========================================================================
-- تاریخ الإنشاء: 2026-07-31
-- الإصدار: v10.0
-- الوصف: 
-- 1. تحديث سياسة RLS لجدول system_notifications للسماح لجميع المستخدمين المسجلين (بمن فيهم العمال)
--    بتحديث وتعديل وقراءة الإشعارات الموجهة إليهم أو الإشعارات العامة.
-- 2. تأكيد الفهارس الفريدة لجدول model_inventory لمنع التعارض 409 (Conflict).
-- =========================================================================

-- 1. تحديث سياسة RLS لجدول system_notifications
ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_notifications_select" ON public.system_notifications;
CREATE POLICY "system_notifications_select" ON public.system_notifications
    FOR SELECT TO authenticated
    USING (
        user_id = auth.uid()
        OR user_id IS NULL
        OR public.get_my_role() IN ('owner', 'admin')
    );

DROP POLICY IF EXISTS "system_notifications_write" ON public.system_notifications;
CREATE POLICY "system_notifications_write" ON public.system_notifications
    FOR ALL TO authenticated
    USING (
        user_id = auth.uid()
        OR user_id IS NULL
        OR public.get_my_role() IN ('owner', 'admin')
    )
    WITH CHECK (
        user_id = auth.uid()
        OR user_id IS NULL
        OR public.get_my_role() IN ('owner', 'admin')
    );
