-- =========================================================================
-- 🌟 MIGRATION V24: FIX INBOUND INVOICE EDITING & DELETION STOCK TRANSACTION 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-10-03
-- الإصدار: v24.0
-- المشكلة المعالجة:
-- 1. عند تعديل فاتورة دخل سابقة، كانت الدالة السابقة تقوم أولاً بخصم كامل الكمية القديمة من المخزون
--    (SET available_series = available_series - v_old_item.quantity).
--    فإذا كان قد تم بيع جزء من هذا الرصيد، كان الرصيد يهبط بالسالب لحظياً (مثال: 13 - 25 = -12)،
--    مما يسبب كسر قيد قاعدة البيانات (chk_positive_available_series) وفشل الحفظ بالخطأ:
--    violates check constraint "chk_positive_available_series" (Error Code 23514).
-- 2. الحل:
--    أ) حساب الفروقات الصافية (Diff = New - Old) مباشرة لكل صنف.
--    ب) التحقق المسبق قبل إجراء أي تعديل: التأكد أن التخفيض لن يتجاوز الرصيد المتوفر حالياً بالمخزن.
--    ج) تطبيق التعديل الصافي بشكل ذري وآمن (Atomic Net Update) يمنع الهبوط السالب اللحظي.
--    د) تحديث دالة الحذف delete_inbound_invoice_safely للتحقق أولاً قبل الخصم.
-- =========================================================================

-- 1. إعادة تعريف دالة معالجة فواتير الدخل (process_inbound_transaction)
CREATE OR REPLACE FUNCTION public.process_inbound_transaction(
    p_invoice_id uuid,
    p_invoice_data jsonb,
    p_invoice_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_invoice_id uuid;
    v_invoice_number text;
    v_diff_record record;
    v_item record;
    v_current_stock int;
    v_model_name text;
    v_color_name text;
BEGIN
    -- =========================================================
    -- الحالة الأولى: وضع التعديل (Update Existing Inbound Invoice)
    -- =========================================================
    IF p_invoice_id IS NOT NULL THEN
        v_invoice_id := p_invoice_id;

        SELECT invoice_number INTO v_invoice_number
        FROM public.inbound_invoices
        WHERE id = v_invoice_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'فاتورة الدخل المراد تعديلها غير موجودة.';
        END IF;

        -- أ) التحقق المسبق من الأصناف التي سيتم تخفيض كمياتها: هل رصيد المخزن الحالي يكفي؟
        FOR v_diff_record IN
            SELECT 
                COALESCE(new_items.model_id, old_items.model_id) AS model_id,
                COALESCE(new_items.color_id, old_items.color_id) AS color_id,
                COALESCE(new_items.qty, 0) - COALESCE(old_items.quantity, 0) AS diff
            FROM (
                SELECT 
                    (x->>'model_id')::uuid AS model_id, 
                    (x->>'color_id')::uuid AS color_id, 
                    SUM((x->>'qty')::int)::int AS qty
                FROM jsonb_array_elements(p_invoice_items) AS x
                WHERE (x->>'qty')::int > 0
                GROUP BY (x->>'model_id')::uuid, (x->>'color_id')::uuid
            ) new_items
            FULL OUTER JOIN (
                SELECT 
                    model_id, 
                    color_id, 
                    SUM(quantity)::int AS quantity
                FROM public.inbound_invoice_items
                WHERE inbound_invoice_id = v_invoice_id
                GROUP BY model_id, color_id
            ) old_items 
            ON new_items.model_id = old_items.model_id AND new_items.color_id = old_items.color_id
        LOOP
            -- إذا كان diff < 0، فهذا يعني أننا نقوم بإنقاص كمية كانت مضافة مسبقاً
            IF v_diff_record.diff < 0 THEN
                SELECT available_series INTO v_current_stock
                FROM public.model_inventory
                WHERE model_id = v_diff_record.model_id AND color_id = v_diff_record.color_id
                FOR UPDATE;

                v_current_stock := COALESCE(v_current_stock, 0);

                -- التحقق من عدم حدوث عجز
                IF v_current_stock < ABS(v_diff_record.diff) THEN
                    SELECT name INTO v_model_name FROM public.models WHERE id = v_diff_record.model_id;
                    SELECT name INTO v_color_name FROM public.colors WHERE id = v_diff_record.color_id;

                    RAISE EXCEPTION 'لا يمكن تعديل الفاتورة. الموديل (%) لون (%) تم بيع كميات منه، والرصيد المتوفر حالياً بالمخزن (%) أقل من الكمية المراد تخفيضها (%). أقصى كمية يمكن تخفيضها هي (%).',
                        COALESCE(v_model_name, 'غير معروف'),
                        COALESCE(v_color_name, 'غير معروف'),
                        v_current_stock,
                        ABS(v_diff_record.diff),
                        v_current_stock;
                END IF;
            END IF;
        END LOOP;

        -- ب) تطبيق الفروقات الصافية مباشرة على المخزون (تعديل ذري يمنع حدوث رصيد سالب لحظي)
        FOR v_diff_record IN
            SELECT 
                COALESCE(new_items.model_id, old_items.model_id) AS model_id,
                COALESCE(new_items.color_id, old_items.color_id) AS color_id,
                COALESCE(new_items.qty, 0) - COALESCE(old_items.quantity, 0) AS diff
            FROM (
                SELECT 
                    (x->>'model_id')::uuid AS model_id, 
                    (x->>'color_id')::uuid AS color_id, 
                    SUM((x->>'qty')::int)::int AS qty
                FROM jsonb_array_elements(p_invoice_items) AS x
                WHERE (x->>'qty')::int > 0
                GROUP BY (x->>'model_id')::uuid, (x->>'color_id')::uuid
            ) new_items
            FULL OUTER JOIN (
                SELECT 
                    model_id, 
                    color_id, 
                    SUM(quantity)::int AS quantity
                FROM public.inbound_invoice_items
                WHERE inbound_invoice_id = v_invoice_id
                GROUP BY model_id, color_id
            ) old_items 
            ON new_items.model_id = old_items.model_id AND new_items.color_id = old_items.color_id
        LOOP
            IF v_diff_record.diff <> 0 THEN
                -- التأكد من وجود صف المخزون
                INSERT INTO public.model_inventory (model_id, color_id, available_series)
                VALUES (v_diff_record.model_id, v_diff_record.color_id, 0)
                ON CONFLICT (model_id, color_id) DO NOTHING;

                -- تطبيق الفرق الصافي (سواء زيادة أو نقص)
                UPDATE public.model_inventory
                SET available_series = available_series + v_diff_record.diff
                WHERE model_id = v_diff_record.model_id AND color_id = v_diff_record.color_id;

                -- تسجيل الحركة في سجل حركات المخزون
                INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
                VALUES (
                    v_diff_record.model_id,
                    v_diff_record.color_id,
                    CASE WHEN v_diff_record.diff > 0 THEN 'in' ELSE 'out' END,
                    ABS(v_diff_record.diff),
                    CASE 
                        WHEN v_diff_record.diff > 0 THEN 'تعديل فاتورة دخل (زيادة كمية): ' || v_invoice_number
                        ELSE 'تعديل فاتورة دخل (تخفيض كمية): ' || v_invoice_number
                    END
                );
            END IF;
        END LOOP;

        -- ج) تحديث بيانات الفاتورة الرئيسية
        UPDATE public.inbound_invoices SET
            supplier_name = p_invoice_data->>'supplier_name',
            notes = p_invoice_data->>'notes',
            total_series = (p_invoice_data->>'total_series')::integer,
            updated_at = now()
        WHERE id = v_invoice_id;

        -- د) إعادة بناء أصناف الفاتورة
        DELETE FROM public.inbound_invoice_items WHERE inbound_invoice_id = v_invoice_id;

        INSERT INTO public.inbound_invoice_items (inbound_invoice_id, model_id, color_id, quantity)
        SELECT 
            v_invoice_id,
            (x->>'model_id')::uuid,
            (x->>'color_id')::uuid,
            (x->>'qty')::int
        FROM jsonb_array_elements(p_invoice_items) AS x
        WHERE (x->>'qty')::int > 0;

    -- =========================================================
    -- الحالة الثانية: وضع الإنشاء الجديد (Create New Inbound Invoice)
    -- =========================================================
    ELSE
        v_invoice_number := 'IN-' || nextval('public.inbound_invoice_number_seq')::text;

        INSERT INTO public.inbound_invoices (invoice_number, supplier_name, notes, total_series, worker_id)
        VALUES (
            v_invoice_number,
            p_invoice_data->>'supplier_name',
            p_invoice_data->>'notes',
            (p_invoice_data->>'total_series')::integer,
            (p_invoice_data->>'worker_id')::uuid
        ) RETURNING id INTO v_invoice_id;

        FOR v_item IN 
            SELECT 
                (x->>'model_id')::uuid AS model_id, 
                (x->>'color_id')::uuid AS color_id, 
                (x->>'qty')::int AS qty
            FROM jsonb_array_elements(p_invoice_items) AS x
            WHERE (x->>'qty')::int > 0
        LOOP
            INSERT INTO public.inbound_invoice_items (inbound_invoice_id, model_id, color_id, quantity)
            VALUES (v_invoice_id, v_item.model_id, v_item.color_id, v_item.qty);

            -- تحديث رصيد المخزن أو إدراجه
            INSERT INTO public.model_inventory (model_id, color_id, available_series)
            VALUES (v_item.model_id, v_item.color_id, v_item.qty)
            ON CONFLICT (model_id, color_id) DO UPDATE
            SET available_series = model_inventory.available_series + EXCLUDED.available_series;

            -- تسجيل الحركة كمدخلات
            INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
            VALUES (v_item.model_id, v_item.color_id, 'in', v_item.qty, 'فاتورة دخل: ' || v_invoice_number);
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'inbound_invoice_id', v_invoice_id);
END;
$$;

ALTER FUNCTION public.process_inbound_transaction(uuid, jsonb, jsonb) SECURITY DEFINER;


-- 2. تحديث دالة حذف فاتورة الدخل الآمن (delete_inbound_invoice_safely)
CREATE OR REPLACE FUNCTION public.delete_inbound_invoice_safely(
    p_invoice_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item record;
    v_invoice_number text;
    v_current_stock int;
    v_model_name text;
    v_color_name text;
BEGIN
    SELECT invoice_number INTO v_invoice_number FROM public.inbound_invoices WHERE id = p_invoice_id;
    IF v_invoice_number IS NULL THEN
        RAISE EXCEPTION 'فاتورة الدخل غير موجودة.';
    END IF;

    -- أ) التحقق أولاً من أن رصيد المخزن الحالي يكفي لخصم كميات الفاتورة دون حدوث عجز سالب
    FOR v_item IN 
        SELECT model_id, color_id, SUM(quantity)::int AS quantity
        FROM public.inbound_invoice_items 
        WHERE inbound_invoice_id = p_invoice_id
        GROUP BY model_id, color_id
    LOOP
        SELECT available_series INTO v_current_stock 
        FROM public.model_inventory
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        v_current_stock := COALESCE(v_current_stock, 0);

        IF v_current_stock < v_item.quantity THEN
            SELECT name INTO v_model_name FROM public.models WHERE id = v_item.model_id;
            SELECT name INTO v_color_name FROM public.colors WHERE id = v_item.color_id;

            RAISE EXCEPTION 'لا يمكن حذف الفاتورة (%) لأن الموديل (%) لون (%) تم بيع أجزاء منه، والرصيد المتوفر حالياً بالمخزن (%) أقل من كمية الفاتورة (%). أقصى كمية يمكن خصمها هي (%).', 
                v_invoice_number,
                COALESCE(v_model_name, 'غير معروف'), 
                COALESCE(v_color_name, 'غير معروف'), 
                v_current_stock,
                v_item.quantity,
                v_current_stock;
        END IF;
    END LOOP;

    -- ب) خصم الكميات من رصيد المخزن وتسجيل الحركات
    FOR v_item IN 
        SELECT model_id, color_id, SUM(quantity)::int AS quantity
        FROM public.inbound_invoice_items 
        WHERE inbound_invoice_id = p_invoice_id
        GROUP BY model_id, color_id
    LOOP
        UPDATE public.model_inventory
        SET available_series = available_series - v_item.quantity
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_item.model_id, v_item.color_id, 'out', v_item.quantity, 'حذف فاتورة دخل: ' || v_invoice_number);
    END LOOP;

    -- ج) الحذف الفعلي للفاتورة وعناصرها (عبر cascade delete أو الحذف المباشر)
    DELETE FROM public.inbound_invoices WHERE id = p_invoice_id;

    RETURN true;
END;
$$;

ALTER FUNCTION public.delete_inbound_invoice_safely(uuid) SECURITY DEFINER;
