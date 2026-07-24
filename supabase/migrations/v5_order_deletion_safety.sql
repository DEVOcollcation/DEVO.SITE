-- =========================================================================
-- 🌟 MIGRATION V5: ORDER DELETION SAFETY & INVENTORY RESTORATION 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-07-24
-- الإصدار: v5.0
-- الوصف: 
-- 1. تحديث دالة delete_order_safely لضمان إعادة رصيد المخزون بأمان عند حذف أي أوردر ملغي دون السقوط في خطأ غياب صف الموديل.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.delete_order_safely(
    p_order_id uuid
)
RETURNS boolean AS $$
DECLARE
    v_item record;
    v_invoice text;
BEGIN
    -- جلب رقم الفاتورة للتوثيق في سجل الحركة
    SELECT invoice_number INTO v_invoice FROM public.orders WHERE id = p_order_id;

    -- 1. إرجاع الكميات للمخزن وتسجيل الحركة
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
        -- التأكد من وجود صف المخزون أولاً
        INSERT INTO public.model_inventory (model_id, color_id, available_series)
        VALUES (v_item.model_id, v_item.color_id, 0)
        ON CONFLICT (model_id, color_id) DO NOTHING;

        -- إعادة الكمية المسحوبة إلى المخزون
        UPDATE public.model_inventory
        SET available_series = available_series + v_item.quantity
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        -- تسجيل الحركة بالسجل
        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_item.model_id, v_item.color_id, 'in', v_item.quantity, 'حذف أوردر من الإدارة: ' || COALESCE(v_invoice, ''));
    END LOOP;

    -- 2. حذف العناصر والأوردر
    DELETE FROM public.order_items WHERE order_id = p_order_id;
    DELETE FROM public.orders WHERE id = p_order_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
