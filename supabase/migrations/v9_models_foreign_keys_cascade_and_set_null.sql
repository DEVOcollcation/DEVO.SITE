-- =========================================================================
-- 🌟 MIGRATION V9: MODELS FOREIGN KEYS CASCADE & SET NULL + RPC FIX 🌟
-- =========================================================================
-- Date: 2026-07-25
-- Description: Drops and recreates foreign key constraints pointing to public.models
-- to allow cascading deletions, and ensures delete_order_safely function is defined correctly.
-- =========================================================================

BEGIN;

-- 1. Drop existing constraints
ALTER TABLE public.model_sizes DROP CONSTRAINT IF EXISTS model_sizes_model_id_fkey;
ALTER TABLE public.model_colors_inventory DROP CONSTRAINT IF EXISTS model_colors_inventory_model_id_fkey;
ALTER TABLE public.invoice_items DROP CONSTRAINT IF EXISTS invoice_items_model_id_fkey;
ALTER TABLE public.model_inventory DROP CONSTRAINT IF EXISTS model_inventory_model_id_fkey;
ALTER TABLE public.model_images DROP CONSTRAINT IF EXISTS model_images_model_id_fkey;
ALTER TABLE public.stock_movements DROP CONSTRAINT IF EXISTS stock_movements_model_id_fkey;
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS order_items_model_id_fkey;
ALTER TABLE public.order_item_preparation DROP CONSTRAINT IF EXISTS order_item_preparation_model_id_fkey;

-- 2. Re-create constraints with CASCADE or SET NULL rules
ALTER TABLE public.model_sizes
    ADD CONSTRAINT model_sizes_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;

ALTER TABLE public.model_colors_inventory
    ADD CONSTRAINT model_colors_inventory_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;

ALTER TABLE public.invoice_items
    ADD CONSTRAINT invoice_items_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE SET NULL;

ALTER TABLE public.model_inventory
    ADD CONSTRAINT model_inventory_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;

ALTER TABLE public.model_images
    ADD CONSTRAINT model_images_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;

ALTER TABLE public.stock_movements
    ADD CONSTRAINT stock_movements_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;

ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE SET NULL;

ALTER TABLE public.order_item_preparation
    ADD CONSTRAINT order_item_preparation_model_id_fkey 
    FOREIGN KEY (model_id) REFERENCES public.models(id) ON DELETE CASCADE;


-- 3. Re-create delete_order_safely function to guarantee correct name and RLS
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

ALTER FUNCTION public.delete_order_safely(uuid) SECURITY DEFINER;

COMMIT;
