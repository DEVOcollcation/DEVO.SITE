-- Migration: Create Inbound Invoices and Items tables + Safety functions
-- Author: Antigravity AI
-- Date: 2026-07-23

-- 1. Create sequence for inbound invoice numbering
CREATE SEQUENCE IF NOT EXISTS public.inbound_invoice_number_seq START WITH 1001;

-- 2. Create inbound_invoices table
CREATE TABLE IF NOT EXISTS public.inbound_invoices (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    invoice_number text NOT NULL UNIQUE,
    supplier_name text,
    notes text,
    total_series integer NOT NULL DEFAULT 0,
    worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inbound_invoices_pkey PRIMARY KEY (id)
);

-- 3. Create inbound_invoice_items table
CREATE TABLE IF NOT EXISTS public.inbound_invoice_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    inbound_invoice_id uuid REFERENCES public.inbound_invoices(id) ON DELETE CASCADE,
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
    quantity integer NOT NULL CHECK (quantity >= 0),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inbound_invoice_items_pkey PRIMARY KEY (id)
);

-- 4. Create index to optimize queries
CREATE INDEX IF NOT EXISTS idx_inbound_invoice_items_invoice_id ON public.inbound_invoice_items(inbound_invoice_id);

-- 5. Disable Row Level Security (RLS) to support custom app authentication (anonymous client)
ALTER TABLE public.inbound_invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_invoice_items DISABLE ROW LEVEL SECURITY;

-- 7. Define process_inbound_transaction function
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
    v_item record;
    v_old_item record;
    v_current_stock int;
    v_model_name text;
    v_color_name text;
BEGIN
    -- أ) إنشاء جدول مؤقت لتخزين الأصناف المتأثرة للتحقق النهائي من المخزون
    CREATE TEMP TABLE affected_items_temp ON COMMIT DROP AS
    SELECT DISTINCT model_id, color_id FROM (
        SELECT model_id, color_id FROM public.inbound_invoice_items WHERE inbound_invoice_id = p_invoice_id
        UNION ALL
        SELECT model_id, color_id 
        FROM jsonb_to_recordset(p_invoice_items) AS x(model_id uuid, color_id uuid, qty int)
    ) AS tmp WHERE model_id IS NOT NULL AND color_id IS NOT NULL;

    -- ب) التحقق من وضع التعديل مقابل الإنشاء الجديد
    IF p_invoice_id IS NOT NULL THEN
        v_invoice_id := p_invoice_id;
        SELECT invoice_number INTO v_invoice_number FROM public.inbound_invoices WHERE id = v_invoice_id;
        IF v_invoice_number IS NULL THEN
            RAISE EXCEPTION 'فاتورة الدخل غير موجودة للتعديل.';
        END IF;
        
        -- إرجاع/خصم الكميات القديمة من رصيد المخزن
        FOR v_old_item IN SELECT * FROM public.inbound_invoice_items WHERE inbound_invoice_id = v_invoice_id LOOP
            UPDATE public.model_inventory
            SET available_series = available_series - v_old_item.quantity
            WHERE model_id = v_old_item.model_id AND color_id = v_old_item.color_id;
            
            -- تسجيل حركة المخزون كحركة مخرجات مؤقتة للتصحيح
            INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
            VALUES (v_old_item.model_id, v_old_item.color_id, 'out', v_old_item.quantity, 'تعديل فاتورة دخل (إرجاع كمية قديمة): ' || v_invoice_number);
        END LOOP;
        
        -- تحديث تفاصيل الفاتورة الرئيسية
        UPDATE public.inbound_invoices SET
            supplier_name = p_invoice_data->>'supplier_name',
            notes = p_invoice_data->>'notes',
            total_series = (p_invoice_data->>'total_series')::integer,
            updated_at = now()
        WHERE id = v_invoice_id;
        
        -- مسح العناصر القديمة من جدول تفاصيل الفاتورة
        DELETE FROM public.inbound_invoice_items WHERE inbound_invoice_id = v_invoice_id;
        
    ELSE
        -- إنشاء جديد
        v_invoice_number := 'IN-' || nextval('public.inbound_invoice_number_seq')::text;
        
        INSERT INTO public.inbound_invoices (invoice_number, supplier_name, notes, total_series, worker_id)
        VALUES (
            v_invoice_number,
            p_invoice_data->>'supplier_name',
            p_invoice_data->>'notes',
            (p_invoice_data->>'total_series')::integer,
            (p_invoice_data->>'worker_id')::uuid
        ) RETURNING id INTO v_invoice_id;
    END IF;
    
    -- ج) إدخال الكميات الجديدة وتحديث الرصيد الفعلي
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_invoice_items) AS x(model_id uuid, color_id uuid, qty int)
    LOOP
        -- إدراج العنصر في الفاتورة
        INSERT INTO public.inbound_invoice_items (inbound_invoice_id, model_id, color_id, quantity)
        VALUES (v_invoice_id, v_item.model_id, v_item.color_id, v_item.qty);
        
        -- تحديث رصيد المخزن (وإنشائه إن لم يكن موجوداً)
        IF EXISTS (SELECT 1 FROM public.model_inventory WHERE model_id = v_item.model_id AND color_id = v_item.color_id) THEN
            UPDATE public.model_inventory
            SET available_series = available_series + v_item.qty
            WHERE model_id = v_item.model_id AND color_id = v_item.color_id;
        ELSE
            INSERT INTO public.model_inventory (model_id, color_id, available_series)
            VALUES (v_item.model_id, v_item.color_id, v_item.qty);
        END IF;
        
        -- تسجيل الحركة كمدخلات
        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_item.model_id, v_item.color_id, 'in', v_item.qty, 'فاتورة دخل: ' || v_invoice_number);
    END LOOP;
    
    -- د) التحقق الأمني الحرج: التأكد أن رصيد المخزن الفعلي لم يقل عن الصفر لأي صنف تأثر بالتعديل
    FOR v_item IN SELECT * FROM affected_items_temp
    LOOP
        SELECT available_series INTO v_current_stock FROM public.model_inventory
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;
        
        IF v_current_stock < 0 THEN
            SELECT name INTO v_model_name FROM public.models WHERE id = v_item.model_id;
            SELECT name INTO v_color_name FROM public.colors WHERE id = v_item.color_id;
            
            RAISE EXCEPTION 'لا يمكن تعديل الفاتورة. الموديل (%) لون (%) تم سحب رصيد منه مسبقاً، والكمية الجديدة المقترحة ستجعل رصيد المخزن بالسالب (%).', 
                COALESCE(v_model_name, 'غير معروف'), 
                COALESCE(v_color_name, 'غير معروف'), 
                v_current_stock;
        END IF;
    END LOOP;
    
    RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'inbound_invoice_id', v_invoice_id);
END;
$$;

-- 8. Define delete_inbound_invoice_safely function
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

    -- أ) خصم الكميات من رصيد المخزن مؤقتاً وتسجيل الحركات
    FOR v_item IN SELECT * FROM public.inbound_invoice_items WHERE inbound_invoice_id = p_invoice_id LOOP
        UPDATE public.model_inventory
        SET available_series = available_series - v_item.quantity
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_item.model_id, v_item.color_id, 'out', v_item.quantity, 'حذف فاتورة دخل: ' || v_invoice_number);
    END LOOP;

    -- ب) التحقق من أن الخصم لم يتسبب في رصيد مخزن سالب
    FOR v_item IN SELECT * FROM public.inbound_invoice_items WHERE inbound_invoice_id = p_invoice_id LOOP
        SELECT available_series INTO v_current_stock FROM public.model_inventory
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        IF v_current_stock < 0 THEN
            SELECT name INTO v_model_name FROM public.models WHERE id = v_item.model_id;
            SELECT name INTO v_color_name FROM public.colors WHERE id = v_item.color_id;

            RAISE EXCEPTION 'لا يمكن حذف الفاتورة (%) لأن الموديل (%) لون (%) تم بيع أجزاء منه وسيتسبب الحذف في رصيد سالب للكمية بالمخزن (%).', 
                v_invoice_number,
                COALESCE(v_model_name, 'غير معروف'), 
                COALESCE(v_color_name, 'غير معروف'), 
                v_current_stock;
        END IF;
    END LOOP;

    -- ج) الحذف الفعلي للفاتورة وعناصرها (الاعتماد على cascade delete)
    DELETE FROM public.inbound_invoices WHERE id = p_invoice_id;

    RETURN true;
END;
$$;
