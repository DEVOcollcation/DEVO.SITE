-- =========================================================================
-- 🌟 MIGRATION V3: PERMANENT PIECE PRICING & SIZES COUNT FOR ORDER ITEMS 🌟
-- =========================================================================
-- تاريخ الإنشاء: 2026-07-24
-- الإصدار: v3.0
-- الوصف: 
-- 1. إضافة أعمدة (sizes_count, piece_price, total_pieces) إلى جدول order_items لحفظ حسابات القطع والسعر الفردي بشكل دائم ومستقر عند كل طلب.
-- 2. تحديث السجلات القديمة وحساب قيمها تلقائياً.
-- 3. تحديث دالة process_order_transaction لتسجيل هذه القيم فورياً عند إنشاء/تعديل الفواتير.
-- =========================================================================

-- 1. إضافة الأعمدة الجديدة لجدول order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS sizes_count INT DEFAULT 1;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS piece_price NUMERIC DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS total_pieces INT DEFAULT 1;

-- 2. تحديث قيم السجلات القديمة
UPDATE public.order_items oi
SET sizes_count = COALESCE(
    (
        SELECT CASE WHEN COUNT(cs.size_id) > 0 THEN COUNT(cs.size_id) ELSE NULL END
        FROM public.models m
        LEFT JOIN public.classes c ON c.id = m.class_id
        LEFT JOIN public.class_sizes cs ON cs.class_id = c.id
        WHERE m.id = oi.model_id
    ),
    (
        SELECT CASE WHEN COUNT(ms.size_id) > 0 THEN COUNT(ms.size_id) ELSE NULL END
        FROM public.model_sizes ms
        WHERE ms.model_id = oi.model_id
    ),
    1
)
WHERE oi.sizes_count IS NULL OR oi.sizes_count = 1;

UPDATE public.order_items
SET 
    total_pieces = quantity * COALESCE(sizes_count, 1),
    piece_price = CASE WHEN COALESCE(sizes_count, 1) > 0 THEN price_per_series / sizes_count ELSE price_per_series END;

-- 3. تحديث دالة process_order_transaction لتسجيل الأعمدة الجديدة
CREATE OR REPLACE FUNCTION public.process_order_transaction(
    p_order_id uuid,
    p_order_data jsonb,
    p_order_items jsonb
)
RETURNS jsonb AS $$
DECLARE
    v_order_id uuid;
    v_invoice_number text;
    v_item record;
    v_current_stock int;
    v_diff_record record;
BEGIN
    -- 🌟 إذا كان وضع "تعديل" (Update)
    IF p_order_id IS NOT NULL THEN
        v_order_id := p_order_id;

        -- 🛡️ منع تعديل الأوردر إذا كان مقفولاً من قبل مستخدم آخر (ويستثنى من قيد القفل المالك والمشرف)
        IF EXISTS (
            SELECT 1 FROM public.orders 
            WHERE id = v_order_id 
              AND is_locked = true 
              AND (assigned_worker_id != auth.uid() OR assigned_worker_id IS NULL)
              AND public.get_my_role() NOT IN ('owner', 'admin')
        ) THEN
            RAISE EXCEPTION 'عفواً، هذا الأوردر قيد التحضير/مقفول حالياً ولا يمكن تعديله.';
        END IF;

        SELECT invoice_number INTO v_invoice_number FROM public.orders WHERE id = v_order_id;

        -- أ) التحقق من توفر الكميات الإضافية المطلوبة (قبل تعديل المخزن)
        FOR v_diff_record IN 
            SELECT 
                coalesce(new_items.model_id, old_items.model_id) as model_id,
                coalesce(new_items.color_id, old_items.color_id) as color_id,
                coalesce(new_items.qty, 0) - coalesce(old_items.quantity, 0) as diff,
                coalesce(new_items.model_name, '') as model_name
            FROM (
                SELECT (x->>'model_id')::uuid as model_id, (x->>'color_id')::uuid as color_id, (x->>'qty')::int as qty, (x->>'model_name')::text as model_name
                FROM jsonb_array_elements(p_order_items) as x
            ) new_items
            FULL OUTER JOIN (
                SELECT model_id, color_id, quantity
                FROM public.order_items
                WHERE order_id = v_order_id
            ) old_items 
            ON new_items.model_id = old_items.model_id AND new_items.color_id = old_items.color_id
        LOOP
            IF v_diff_record.diff > 0 THEN
                SELECT available_series INTO v_current_stock FROM public.model_inventory
                WHERE model_id = v_diff_record.model_id AND color_id = v_diff_record.color_id FOR UPDATE;
                
                IF COALESCE(v_current_stock, 0) < v_diff_record.diff THEN
                    RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة بالمخزن. المتاح بالمخزن: %, المطلوب زيادة: %', 
                        v_diff_record.model_name, COALESCE(v_current_stock, 0), v_diff_record.diff;
                END IF;
            END IF;
        END LOOP;

        -- ب) تطبيق الفروقات على المخزن وتسجيل حركات المخزون
        FOR v_diff_record IN 
            SELECT 
                coalesce(new_items.model_id, old_items.model_id) as model_id,
                coalesce(new_items.color_id, old_items.color_id) as color_id,
                coalesce(new_items.qty, 0) - coalesce(old_items.quantity, 0) as diff
            FROM (
                SELECT (x->>'model_id')::uuid as model_id, (x->>'color_id')::uuid as color_id, (x->>'qty')::int as qty
                FROM jsonb_array_elements(p_order_items) as x
            ) new_items
            FULL OUTER JOIN (
                SELECT model_id, color_id, quantity
                FROM public.order_items
                WHERE order_id = v_order_id
            ) old_items 
            ON new_items.model_id = old_items.model_id AND new_items.color_id = old_items.color_id
        LOOP
            IF v_diff_record.diff <> 0 THEN
                INSERT INTO public.model_inventory (model_id, color_id, available_series)
                VALUES (v_diff_record.model_id, v_diff_record.color_id, 0)
                ON CONFLICT (model_id, color_id) DO NOTHING;

                UPDATE public.model_inventory
                SET available_series = available_series - v_diff_record.diff
                WHERE model_id = v_diff_record.model_id AND color_id = v_diff_record.color_id;

                INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
                VALUES (
                    v_diff_record.model_id, 
                    v_diff_record.color_id, 
                    CASE WHEN v_diff_record.diff > 0 THEN 'out' ELSE 'in' END, 
                    abs(v_diff_record.diff), 
                    'تعديل أوردر رقم ' || v_invoice_number
                );
            END IF;
        END LOOP;

        -- ج) مسح العناصر القديمة
        DELETE FROM public.order_items WHERE order_id = v_order_id;

        -- د) تحديث بيانات الفاتورة
        UPDATE public.orders SET
            customer_name = p_order_data->>'customer_name',
            phone_1 = p_order_data->>'phone_1',
            phone_2 = p_order_data->>'phone_2',
            address = p_order_data->>'address',
            deposit = (p_order_data->>'deposit')::numeric,
            deposit_receiver = p_order_data->>'deposit_receiver',
            notes = p_order_data->>'notes',
            total_price = (p_order_data->>'total_price')::numeric,
            total_series = (p_order_data->>'total_series')::integer
        WHERE id = v_order_id;

    ELSE
        -- 🌟 وضع إنشاء جديد (Insert)
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, model_name text)
        LOOP
            SELECT available_series INTO v_current_stock FROM public.model_inventory
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id FOR UPDATE;

            IF COALESCE(v_current_stock, 0) < v_item.qty THEN
               RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة بالمخزن. المتاح: %', COALESCE(v_item.model_name, ''), COALESCE(v_current_stock, 0);
            END IF;
        END LOOP;

        v_invoice_number := nextval('public.invoice_number_seq')::text;

        INSERT INTO public.orders (invoice_number, customer_name, phone_1, phone_2, address, deposit, deposit_receiver, notes, total_price, total_series, worker_id)
        VALUES (
          v_invoice_number, p_order_data->>'customer_name', p_order_data->>'phone_1', p_order_data->>'phone_2', p_order_data->>'address',
          (p_order_data->>'deposit')::numeric, p_order_data->>'deposit_receiver', p_order_data->>'notes',
          (p_order_data->>'total_price')::numeric, (p_order_data->>'total_series')::integer, (p_order_data->>'worker_id')::uuid
        ) RETURNING id INTO v_order_id;

        UPDATE public.system_users SET invoice_count = COALESCE(invoice_count, 0) + 1 WHERE id = (p_order_data->>'worker_id')::uuid;

        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int)
        LOOP
            INSERT INTO public.model_inventory (model_id, color_id, available_series)
            VALUES (v_item.model_id, v_item.color_id, 0)
            ON CONFLICT (model_id, color_id) DO NOTHING;

            UPDATE public.model_inventory SET available_series = available_series - v_item.qty
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

            INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
            VALUES (v_item.model_id, v_item.color_id, 'out', v_item.qty, 'فاتورة مبيعات: ' || v_invoice_number);
        END LOOP;

    END IF;

    -- 🌟 تسجيل العناصر الجديدة للأوردر مع حفظ قيم القطع السلسة محفورة بالسجل
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_order_items) AS x(
        model_id uuid, 
        color_id uuid, 
        qty int, 
        price numeric, 
        total numeric,
        sizes_count int,
        piece_price numeric
    )
    LOOP
        INSERT INTO public.order_items (
            order_id, 
            model_id, 
            color_id, 
            quantity, 
            price_per_series, 
            total_price,
            sizes_count,
            piece_price,
            total_pieces
        ) VALUES (
            v_order_id, 
            v_item.model_id, 
            v_item.color_id, 
            v_item.qty, 
            v_item.price, 
            v_item.total,
            COALESCE(v_item.sizes_count, 1),
            COALESCE(v_item.piece_price, CASE WHEN COALESCE(v_item.sizes_count, 1) > 0 THEN v_item.price / v_item.sizes_count ELSE v_item.price END),
            v_item.qty * COALESCE(v_item.sizes_count, 1)
        );
    END LOOP;

    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
