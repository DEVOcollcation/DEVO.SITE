supabase link --project-ref abxbhtysmqzrswzsdrzi

-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.profiles (
id uuid NOT NULL,
full_name character varying NOT NULL,
role character varying DEFAULT 'staff'::character varying,
is_active boolean DEFAULT true,
created_at timestamp with time zone DEFAULT now(),
email character varying,
login_count integer DEFAULT 0,
invoice_count integer DEFAULT 0,
CONSTRAINT profiles_pkey PRIMARY KEY (id),
CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.categories (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
name character varying NOT NULL UNIQUE,
created_at timestamp with time zone DEFAULT now(),
CONSTRAINT categories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.classes (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
name character varying NOT NULL UNIQUE,
created_at timestamp with time zone DEFAULT now(),
CONSTRAINT classes_pkey PRIMARY KEY (id)
);
CREATE TABLE public.sizes (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
name character varying NOT NULL UNIQUE,
created_at timestamp with time zone DEFAULT now(),
CONSTRAINT sizes_pkey PRIMARY KEY (id)
);
CREATE TABLE public.models (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
system_code character varying NOT NULL UNIQUE,
factory_code character varying NOT NULL,
name character varying NOT NULL,
category_id uuid,
class_id uuid,
price numeric NOT NULL CHECK (price >= 0::numeric),
is_active boolean DEFAULT true,
image_url_1 text,
image_url_2 text,
image_url_3 text,
created_at timestamp with time zone DEFAULT now(),
updated_at timestamp with time zone DEFAULT now(),
CONSTRAINT models_pkey PRIMARY KEY (id),
CONSTRAINT models_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id),
CONSTRAINT models_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id)
);
CREATE TABLE public.model_sizes (
model_id uuid NOT NULL,
size_id uuid NOT NULL,
CONSTRAINT model_sizes_pkey PRIMARY KEY (model_id, size_id),
CONSTRAINT model_sizes_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id),
CONSTRAINT model_sizes_size_id_fkey FOREIGN KEY (size_id) REFERENCES public.sizes(id)
);
CREATE TABLE public.model_colors_inventory (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
model_id uuid,
color_id uuid,
available_series_count integer NOT NULL DEFAULT 0 CHECK (available_series_count >= 0),
CONSTRAINT model_colors_inventory_pkey PRIMARY KEY (id),
CONSTRAINT model_colors_inventory_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id)
);
CREATE TABLE public.invoices (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
invoice_number integer NOT NULL DEFAULT nextval('invoices_invoice_number_seq'::regclass),
staff_id uuid,
customer_name character varying NOT NULL,
customer_phone_1 character varying NOT NULL,
customer_phone_2 character varying,
customer_address text,
deposit_amount numeric DEFAULT 0 CHECK (deposit_amount >= 0::numeric),
deposit_receiver character varying,
notes text,
total_amount numeric DEFAULT 0,
is_archived boolean DEFAULT false,
created_at timestamp with time zone DEFAULT now(),
updated_at timestamp with time zone DEFAULT now(),
CONSTRAINT invoices_pkey PRIMARY KEY (id),
CONSTRAINT invoices_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.invoice_items (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
invoice_id uuid,
model_id uuid,
color_id uuid,
series_quantity integer NOT NULL CHECK (series_quantity > 0),
unit_price numeric NOT NULL CHECK (unit_price >= 0::numeric),
total_line_price numeric DEFAULT ((series_quantity)::numeric \* unit_price),
created_at timestamp with time zone DEFAULT now(),
CONSTRAINT invoice_items_pkey PRIMARY KEY (id),
CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id),
CONSTRAINT invoice_items_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id)
);
CREATE TABLE public.model_inventory (
id uuid NOT NULL DEFAULT gen_random_uuid(),
model_id uuid,
color_id uuid,
available_series integer DEFAULT 0,
CONSTRAINT model_inventory_pkey PRIMARY KEY (id),
CONSTRAINT model_inventory_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id),
CONSTRAINT model_inventory_color_id_fkey FOREIGN KEY (color_id) REFERENCES public.colors(id)
);
CREATE TABLE public.model_images (
id uuid NOT NULL DEFAULT gen_random_uuid(),
model_id uuid,
image_url text NOT NULL,
created_at timestamp with time zone DEFAULT now(),
CONSTRAINT model_images_pkey PRIMARY KEY (id),
CONSTRAINT model_images_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id)
);
CREATE TABLE public.stock_movements (
id uuid NOT NULL DEFAULT gen_random_uuid(),
model_id uuid,
color_id uuid,
movement_type text NOT NULL CHECK (movement_type = ANY (ARRAY['in'::text, 'out'::text])),
quantity integer NOT NULL,
reference text,
created_at timestamp with time zone DEFAULT now(),
CONSTRAINT stock_movements_pkey PRIMARY KEY (id),
CONSTRAINT stock_movements_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id),
CONSTRAINT stock_movements_color_id_fkey FOREIGN KEY (color_id) REFERENCES public.colors(id)
);
CREATE TABLE public.system_users (
id uuid NOT NULL DEFAULT gen_random_uuid(),
full_name text NOT NULL,
username text NOT NULL UNIQUE,
password text NOT NULL,
role text NOT NULL CHECK (role = ANY (ARRAY['owner'::text, 'admin'::text, 'worker'::text])),
is_active boolean DEFAULT true,
created_at timestamp with time zone DEFAULT now(),
login_count integer DEFAULT 0,
invoice_count integer DEFAULT 0,
worker_job text,
CONSTRAINT system_users_pkey PRIMARY KEY (id)
);
CREATE TABLE public.home_settings (
setting_key text NOT NULL,
setting_value text NOT NULL,
description text,
CONSTRAINT home_settings_pkey PRIMARY KEY (setting_key)
);
CREATE TABLE public.promo_cards (
id uuid NOT NULL DEFAULT gen_random_uuid(),
title text NOT NULL,
description text,
icon text DEFAULT 'ph-star'::text,
badge_text text,
badge_color text DEFAULT 'bg-devo-orange'::text,
is_active boolean DEFAULT true,
created_at timestamp with time zone DEFAULT now(),
image_url text,
model_id uuid REFERENCES public.models(id) ON DELETE SET NULL,
CONSTRAINT promo_cards_pkey PRIMARY KEY (id)
);
CREATE TABLE public.orders (
id uuid NOT NULL DEFAULT gen_random_uuid(),
invoice_number text NOT NULL UNIQUE,
customer_name text NOT NULL,
phone_1 text NOT NULL,
phone_2 text,
address text,
deposit numeric DEFAULT 0,
deposit_receiver text,
notes text,
total_price numeric NOT NULL,
total_series integer NOT NULL,
worker_id uuid,
created_at timestamp with time zone DEFAULT now(),
status text DEFAULT 'created'::text,
is_archived boolean DEFAULT false,
is_locked boolean DEFAULT false,
assigned_admin_name text,
CONSTRAINT orders_pkey PRIMARY KEY (id),
CONSTRAINT orders_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES public.system_users(id)
);
CREATE TABLE public.order_items (
id uuid NOT NULL DEFAULT gen_random_uuid(),
order_id uuid,
model_id uuid,
color_id uuid,
quantity integer NOT NULL,
price_per_series numeric NOT NULL,
total_price numeric NOT NULL,
CONSTRAINT order_items_pkey PRIMARY KEY (id),
CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id),
CONSTRAINT order_items_model_id_fkey FOREIGN KEY (model_id) REFERENCES public.models(id),
CONSTRAINT order_items_color_id_fkey FOREIGN KEY (color_id) REFERENCES public.colors(id)
);
CREATE TABLE public.colors (
id uuid NOT NULL DEFAULT uuid_generate_v4(),
color_code character varying UNIQUE,
name character varying NOT NULL UNIQUE,
created_at timestamp with time zone DEFAULT now(),
CONSTRAINT colors_pkey PRIMARY KEY (id)
);
CREATE TABLE public.class_sizes (
class_id uuid NOT NULL,
size_id uuid NOT NULL,
CONSTRAINT class_sizes_pkey PRIMARY KEY (class_id, size_id),
CONSTRAINT class_sizes_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.classes(id),
CONSTRAINT class_sizes_size_id_fkey FOREIGN KEY (size_id) REFERENCES public.sizes(id)
);

////////////////////////////////////////
////////////////////////////////////////
////////////////////////////////////////
////////////////////////////////////////

delete_order_safely

DECLARE
v_item record;
v_invoice text;
BEGIN
-- جلب رقم الفاتورة للتوثيق
SELECT invoice_number INTO v_invoice FROM public.orders WHERE id = p_order_id;

    -- 1. إرجاع الكميات للمخزن وتسجيل الحركة
    FOR v_item IN SELECT * FROM public.order_items WHERE order_id = p_order_id LOOP
        -- زيادة المخزون
        UPDATE public.model_inventory
        SET available_series = available_series + v_item.quantity
        WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

        -- تسجيل الحركة
        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_item.model_id, v_item.color_id, 'in', v_item.quantity, 'حذف أوردر من الإدارة: ' || v_invoice);
    END LOOP;

    -- 2. حذف العناصر والأوردر (إذا لم يكن هناك Cascade delete مفعل)
    DELETE FROM public.order_items WHERE order_id = p_order_id;
    DELETE FROM public.orders WHERE id = p_order_id;

    RETURN true;

END;

////////////////////////////////////////
////////////////////////////////////////

handle_inventory_update

BEGIN
-- Handle new invoice item
IF TG_OP = 'INSERT' THEN
UPDATE model_colors_inventory
SET available_series_count = available_series_count - NEW.series_quantity
WHERE model_id = NEW.model_id AND color_id = NEW.color_id;
RETURN NEW;

    -- Handle modifications (e.g., changing quantity or color)
    ELSIF TG_OP = 'UPDATE' THEN
        -- 1. Restore the old quantity back to inventory
        UPDATE model_colors_inventory
        SET available_series_count = available_series_count + OLD.series_quantity
        WHERE model_id = OLD.model_id AND color_id = OLD.color_id;

        -- 2. Deduct the new quantity from inventory
        UPDATE model_colors_inventory
        SET available_series_count = available_series_count - NEW.series_quantity
        WHERE model_id = NEW.model_id AND color_id = NEW.color_id;
        RETURN NEW;

    -- Handle item deletion (or full invoice deletion)
    ELSIF TG_OP = 'DELETE' THEN
        -- Restore quantity back to inventory
        UPDATE model_colors_inventory
        SET available_series_count = available_series_count + OLD.series_quantity
        WHERE model_id = OLD.model_id AND color_id = OLD.color_id;
        RETURN OLD;
    END IF;

END;

////////////////////////////////////////
////////////////////////////////////////
process_order_transaction

DECLARE
v_order_id uuid;
v_invoice_number text;
v_item record;
v_current_stock int;
v_old_item record;
BEGIN
-- 🌟 إذا كان وضع "تعديل" (Update)
IF p_order_id IS NOT NULL THEN
v_order_id := p_order_id;
SELECT invoice_number INTO v_invoice_number FROM public.orders WHERE id = v_order_id;

    -- 1. إرجاع الكميات القديمة للمخزن
    FOR v_old_item IN SELECT * FROM public.order_items WHERE order_id = v_order_id LOOP
        UPDATE public.model_inventory
        SET available_series = available_series + v_old_item.quantity
        WHERE model_id = v_old_item.model_id AND color_id = v_old_item.color_id;

        -- 🌟 الإضافة: تسجيل حركة (إرجاع للمخزن) بسبب التعديل 🌟
        INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
        VALUES (v_old_item.model_id, v_old_item.color_id, 'in', v_old_item.quantity, 'استرجاع لتعديل أوردر: ' || v_invoice_number);
    END LOOP;

    -- 2. مسح العناصر القديمة
    DELETE FROM public.order_items WHERE order_id = v_order_id;

    -- 3. تحديث بيانات الفاتورة
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
v_invoice_number := nextval('public.invoice_number_seq')::text;

    INSERT INTO public.orders (invoice_number, customer_name, phone_1, phone_2, address, deposit, deposit_receiver, notes, total_price, total_series, worker_id)
    VALUES (
      v_invoice_number, p_order_data->>'customer_name', p_order_data->>'phone_1', p_order_data->>'phone_2', p_order_data->>'address',
      (p_order_data->>'deposit')::numeric, p_order_data->>'deposit_receiver', p_order_data->>'notes',
      (p_order_data->>'total_price')::numeric, (p_order_data->>'total_series')::integer, (p_order_data->>'worker_id')::uuid
    ) RETURNING id INTO v_order_id;

    UPDATE public.system_users SET invoice_count = COALESCE(invoice_count, 0) + 1 WHERE id = (p_order_data->>'worker_id')::uuid;

END IF;

-- 🌟 خصم المخزون وتسجيل العناصر الجديدة (يحدث في الحالتين)
FOR v_item IN SELECT \* FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, model_name text, price numeric, total numeric)
LOOP
SELECT available_series INTO v_current_stock FROM public.model_inventory
WHERE model_id = v_item.model_id AND color_id = v_item.color_id FOR UPDATE;

    IF v_current_stock < v_item.qty THEN
       RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة. المتاح: %', v_item.model_name, v_current_stock;
    END IF;

    INSERT INTO public.order_items (order_id, model_id, color_id, quantity, price_per_series, total_price)
    VALUES (v_order_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total);

    UPDATE public.model_inventory SET available_series = available_series - v_item.qty
    WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

    -- 🌟 الإضافة: تسجيل حركة البيع في السجل 🌟
    INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
    VALUES (v_item.model_id, v_item.color_id, 'out', v_item.qty, 'فاتورة مبيعات: ' || v_invoice_number);

END LOOP;

RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;

////////////////////////////////////////
////////////////////////////////////////

////////////////////////////////////////
////////////////////////////////////////
process_order_transaction

DECLARE
v_order_id uuid;
v_invoice_number text;
v_item record;
v_current_stock int;
BEGIN
-- أ) التحقق من المخزون أولاً (Locking the rows to prevent race conditions)
FOR v_item IN SELECT \* FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, model_name text)
LOOP
SELECT available_series INTO v_current_stock FROM public.model_inventory
WHERE model_id = v_item.model_id AND color_id = v_item.color_id FOR UPDATE;

    IF v_current_stock < v_item.qty THEN
       RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة. المتاح: %', v_item.model_name, v_current_stock;
    END IF;

END LOOP;

-- ب) 🌟 التعديل هنا: سحب الرقم التالي من العداد ليكون هو رقم الفاتورة (1, 2, 3...) 🌟
v_invoice_number := nextval('public.invoice_number_seq')::text;

-- ج) تسجيل الأوردر
INSERT INTO public.orders (invoice_number, customer_name, phone_1, phone_2, address, deposit, deposit_receiver, notes, total_price, total_series, worker_id)
VALUES (
v_invoice_number, p_order_data->>'customer_name', p_order_data->>'phone_1', p_order_data->>'phone_2', p_order_data->>'address',
(p_order_data->>'deposit')::numeric, p_order_data->>'deposit_receiver', p_order_data->>'notes',
(p_order_data->>'total_price')::numeric, (p_order_data->>'total_series')::integer, (p_order_data->>'worker_id')::uuid
) RETURNING id INTO v_order_id;

-- د) تسجيل العناصر، خصم المخزون، وتسجيل حركة السحب
FOR v_item IN SELECT \* FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, price numeric, total numeric)
LOOP
-- إدراج العنصر
INSERT INTO public.order_items (order_id, model_id, color_id, quantity, price_per_series, total_price)
VALUES (v_order_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total);

    -- خصم المخزون
    UPDATE public.model_inventory SET available_series = available_series - v_item.qty
    WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

    -- تسجيل حركة المخزون
    INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
    VALUES (v_item.model_id, v_item.color_id, 'out', v_item.qty, 'فاتورة مبيعات: ' || v_invoice_number);

END LOOP;

-- هـ) زيادة عدد فواتير الموظف
UPDATE public.system_users SET invoice_count = COALESCE(invoice_count, 0) + 1
WHERE id = (p_order_data->>'worker_id')::uuid;

-- إرجاع النتيجة للواجهة الأمامية
RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;

////////////////////////////////////////
////////////////////////////////////////

rls_auto_enable

DECLARE
cmd record;
BEGIN
FOR cmd IN
SELECT \*
FROM pg_event_trigger_ddl_commands()
WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
AND object_type IN ('table','partitioned table')
LOOP
IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
BEGIN
EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
EXCEPTION
WHEN OTHERS THEN
RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
END;
ELSE
RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
END IF;
END LOOP;
END;
////////////////////////////////////////
////////////////////////////////////////

////////////////////////////////////////
////////////////////////////////////////
-- Returns and Exchanges Schema

-- 1. Sequence for Return Numbers
-- CREATE SEQUENCE public.return_number_seq START WITH 1001;

-- 2. Returns Table
-- CREATE TABLE public.returns (
--     id uuid NOT NULL DEFAULT gen_random_uuid(),
--     return_number text NOT NULL UNIQUE,
--     order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
--     customer_name text NOT NULL,
--     refund_amount numeric NOT NULL DEFAULT 0,
--     total_series integer NOT NULL DEFAULT 0,
--     notes text,
--     worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
--     created_at timestamp with time zone DEFAULT now(),
--     CONSTRAINT returns_pkey PRIMARY KEY (id)
-- );

-- 3. Return Items Table
-- CREATE TABLE public.return_items (
--     id uuid NOT NULL DEFAULT gen_random_uuid(),
--     return_id uuid REFERENCES public.returns(id) ON DELETE CASCADE,
--     model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
--     color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
--     quantity integer NOT NULL CHECK (quantity > 0),
--     price_per_series numeric NOT NULL CHECK (price_per_series >= 0),
--     total_price numeric NOT NULL CHECK (total_price >= 0),
--     CONSTRAINT return_items_pkey PRIMARY KEY (id)
-- );

-- 4. Process Return Transaction Function
-- CREATE OR REPLACE FUNCTION public.process_return_transaction(
--     p_return_data jsonb,
--     p_return_items jsonb
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     v_return_id uuid;
--     v_return_number text;
--     v_item record;
-- BEGIN
--     -- Pull the next return number
--     v_return_number := 'RET-' || nextval('public.return_number_seq')::text;
-- 
--     -- Insert return master record
--     INSERT INTO public.returns (
--         return_number, order_id, customer_name, refund_amount, total_series, notes, worker_id
--     ) VALUES (
--         v_return_number,
--         (p_return_data->>'order_id')::uuid,
--         p_return_data->>'customer_name',
--         (p_return_data->>'refund_amount')::numeric,
--         (p_return_data->>'total_series')::integer,
--         p_return_data->>'notes',
--         (p_return_data->>'worker_id')::uuid
--     ) RETURNING id INTO v_return_id;
-- 
--     -- Loop through return items
--     FOR v_item IN SELECT * FROM jsonb_to_recordset(p_return_items) AS x(model_id uuid, color_id uuid, qty int, price numeric, total numeric)
--     LOOP
--         -- Insert return item
--         INSERT INTO public.return_items (
--             return_id, model_id, color_id, quantity, price_per_series, total_price
--         ) VALUES (
--             v_return_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total
--         );
-- 
--         -- Add quantity back to inventory
--         UPDATE public.model_inventory 
--         SET available_series = available_series + v_item.qty
--         WHERE model_id = v_item.model_id AND color_id = v_item.color_id;
-- 
--         -- Record stock movement
--         INSERT INTO public.stock_movements (
--             model_id, color_id, movement_type, quantity, reference
--         ) VALUES (
SELECT available_series INTO v_current_stock FROM public.model_inventory
WHERE model_id = v_item.model_id AND color_id = v_item.color_id FOR UPDATE;

    IF v_current_stock < v_item.qty THEN
       RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة. المتاح: %', v_item.model_name, v_current_stock;
    END IF;

    INSERT INTO public.order_items (order_id, model_id, color_id, quantity, price_per_series, total_price)
    VALUES (v_order_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total);

    UPDATE public.model_inventory SET available_series = available_series - v_item.qty
    WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

    -- 🌟 الإضافة: تسجيل حركة البيع في السجل 🌟
    INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
    VALUES (v_item.model_id, v_item.color_id, 'out', v_item.qty, 'فاتورة مبيعات: ' || v_invoice_number);

END LOOP;

RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;

////////////////////////////////////////
////////////////////////////////////////

////////////////////////////////////////
////////////////////////////////////////
process_order_transaction

DECLARE
v_order_id uuid;
v_invoice_number text;
v_item record;
v_current_stock int;
BEGIN
-- أ) التحقق من المخزون أولاً (Locking the rows to prevent race conditions)
FOR v_item IN SELECT \* FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, model_name text)
LOOP
SELECT available_series INTO v_current_stock FROM public.model_inventory
WHERE model_id = v_item.model_id AND color_id = v_item.color_id FOR UPDATE;

    IF v_current_stock < v_item.qty THEN
       RAISE EXCEPTION 'الكمية المطلوبة من الموديل % غير متوفرة. المتاح: %', v_item.model_name, v_current_stock;
    END IF;

END LOOP;

-- ب) 🌟 التعديل هنا: سحب الرقم التالي من العداد ليكون هو رقم الفاتورة (1, 2, 3...) 🌟
v_invoice_number := nextval('public.invoice_number_seq')::text;

-- ج) تسجيل الأوردر
INSERT INTO public.orders (invoice_number, customer_name, phone_1, phone_2, address, deposit, deposit_receiver, notes, total_price, total_series, worker_id)
VALUES (
v_invoice_number, p_order_data->>'customer_name', p_order_data->>'phone_1', p_order_data->>'phone_2', p_order_data->>'address',
(p_order_data->>'deposit')::numeric, p_order_data->>'deposit_receiver', p_order_data->>'notes',
(p_order_data->>'total_price')::numeric, (p_order_data->>'total_series')::integer, (p_order_data->>'worker_id')::uuid
) RETURNING id INTO v_order_id;

-- د) تسجيل العناصر، خصم المخزون، وتسجيل حركة السحب
FOR v_item IN SELECT \* FROM jsonb_to_recordset(p_order_items) AS x(model_id uuid, color_id uuid, qty int, price numeric, total numeric)
LOOP
-- إدراج العنصر
INSERT INTO public.order_items (order_id, model_id, color_id, quantity, price_per_series, total_price)
VALUES (v_order_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total);

    -- خصم المخزون
    UPDATE public.model_inventory SET available_series = available_series - v_item.qty
    WHERE model_id = v_item.model_id AND color_id = v_item.color_id;

    -- تسجيل حركة المخزون
    INSERT INTO public.stock_movements (model_id, color_id, movement_type, quantity, reference)
    VALUES (v_item.model_id, v_item.color_id, 'out', v_item.qty, 'فاتورة مبيعات: ' || v_invoice_number);

END LOOP;

-- هـ) زيادة عدد فواتير الموظف
UPDATE public.system_users SET invoice_count = COALESCE(invoice_count, 0) + 1
WHERE id = (p_order_data->>'worker_id')::uuid;

-- إرجاع النتيجة للواجهة الأمامية
RETURN jsonb_build_object('success', true, 'invoice_number', v_invoice_number, 'order_id', v_order_id);
END;

////////////////////////////////////////
////////////////////////////////////////

rls_auto_enable

DECLARE
cmd record;
BEGIN
FOR cmd IN
SELECT \*
FROM pg_event_trigger_ddl_commands()
WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
AND object_type IN ('table','partitioned table')
LOOP
IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
BEGIN
EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
EXCEPTION
WHEN OTHERS THEN
RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
END;
ELSE
RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
END IF;
END LOOP;
END;
////////////////////////////////////////
////////////////////////////////////////

////////////////////////////////////////
////////////////////////////////////////
-- Returns and Exchanges Schema

-- 1. Sequence for Return Numbers
-- CREATE SEQUENCE public.return_number_seq START WITH 1001;

-- 2. Returns Table
-- CREATE TABLE public.returns (
--     id uuid NOT NULL DEFAULT gen_random_uuid(),
--     return_number text NOT NULL UNIQUE,
--     order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
--     customer_name text NOT NULL,
--     refund_amount numeric NOT NULL DEFAULT 0,
--     total_series integer NOT NULL DEFAULT 0,
--     notes text,
--     worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
--     created_at timestamp with time zone DEFAULT now(),
--     CONSTRAINT returns_pkey PRIMARY KEY (id)
-- );

-- 3. Return Items Table
-- CREATE TABLE public.return_items (
--     id uuid NOT NULL DEFAULT gen_random_uuid(),
--     return_id uuid REFERENCES public.returns(id) ON DELETE CASCADE,
--     model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
--     color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
--     quantity integer NOT NULL CHECK (quantity > 0),
--     price_per_series numeric NOT NULL CHECK (price_per_series >= 0),
--     total_price numeric NOT NULL CHECK (total_price >= 0),
--     CONSTRAINT return_items_pkey PRIMARY KEY (id)
-- );

-- 4. Process Return Transaction Function
-- CREATE OR REPLACE FUNCTION public.process_return_transaction(
--     p_return_data jsonb,
--     p_return_items jsonb
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     v_return_id uuid;
--     v_return_number text;
--     v_item record;
-- BEGIN
--     -- Pull the next return number
--     v_return_number := 'RET-' || nextval('public.return_number_seq')::text;
-- 
--     -- Insert return master record
--     INSERT INTO public.returns (
--         return_number, order_id, customer_name, refund_amount, total_series, notes, worker_id
--     ) VALUES (
--         v_return_number,
--         (p_return_data->>'order_id')::uuid,
--         p_return_data->>'customer_name',
--         (p_return_data->>'refund_amount')::numeric,
--         (p_return_data->>'total_series')::integer,
--         p_return_data->>'notes',
--         (p_return_data->>'worker_id')::uuid
--     ) RETURNING id INTO v_return_id;
-- 
--     -- Loop through return items
--     FOR v_item IN SELECT * FROM jsonb_to_recordset(p_return_items) AS x(model_id uuid, color_id uuid, qty int, price numeric, total numeric)
--     LOOP
--         -- Insert return item
--         INSERT INTO public.return_items (
--             return_id, model_id, color_id, quantity, price_per_series, total_price
--         ) VALUES (
--             v_return_id, v_item.model_id, v_item.color_id, v_item.qty, v_item.price, v_item.total
--         );
-- 
--         -- Add quantity back to inventory
--         UPDATE public.model_inventory 
--         SET available_series = available_series + v_item.qty
--         WHERE model_id = v_item.model_id AND color_id = v_item.color_id;
-- 
--         -- Record stock movement
--         INSERT INTO public.stock_movements (
--             model_id, color_id, movement_type, quantity, reference
--         ) VALUES (
--             v_item.model_id, v_item.color_id, 'in', v_item.qty, 'مرتجع مبيعات: ' || v_return_number
--         );
--     END LOOP;
-- 
--     RETURN jsonb_build_object('success', true, 'return_number', v_return_number, 'return_id', v_return_id);
-- END;
-- $$;

////////////////////////////////////////
////////////////////////////////////////
-- Order and Preparation Status Synchronization Trigger

-- CREATE OR REPLACE FUNCTION public.sync_order_statuses()
-- RETURNS trigger AS $$
-- BEGIN
--   -- 1. Check preparation validation if trying to mark as shipped or delivered
--   IF NEW.status IN ('shipped', 'delivered') THEN
--     IF NOT public.can_mark_order_prepared(NEW.id) THEN
--       RAISE EXCEPTION 'لا يمكن شحن أو تسليم الأوردر: يوجد عناصر لم يتم تحضيرها بالكامل بعد في المخزن.';
--     END IF;
--   END IF;
--
--   -- 2. If preparation_status was changed
--   IF NEW.preparation_status IS DISTINCT FROM OLD.preparation_status THEN
--     IF NEW.preparation_status = 'in_progress' THEN
--       NEW.status := 'preparing';
--     ELSIF NEW.preparation_status = 'shipped' THEN
--       NEW.status := 'shipped';
--     ELSIF NEW.preparation_status = 'pending' AND NEW.status NOT IN ('created', 'in_progress', 'registered') THEN
--       NEW.status := 'created';
--     END IF;
--   
--   -- 3. If status was changed
--   ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
--     IF NEW.status IN ('created', 'in_progress', 'registered') THEN
--       NEW.preparation_status := 'pending';
--     ELSIF NEW.status = 'preparing' AND NEW.preparation_status NOT IN ('in_progress', 'prepared', 'shipped') THEN
--       NEW.preparation_status := 'in_progress';
--     ELSIF NEW.status = 'shipped' THEN
--       NEW.preparation_status := 'shipped';
--     ELSIF NEW.status = 'delivered' THEN
--       NEW.preparation_status := 'shipped';
--     END IF;
--   END IF;
-- 
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;

-- CREATE OR REPLACE TRIGGER trg_sync_order_statuses
-- BEFORE UPDATE OF status, preparation_status ON public.orders
-- FOR EACH ROW
-- EXECUTE FUNCTION public.sync_order_statuses();

////////////////////////////////////////
////////////////////////////////////////
-- Smart Inventory Audit Schema

-- 1. Sequence for Audit Numbers
-- CREATE SEQUENCE public.audit_number_seq START WITH 1001;

-- 2. Inventory Audits Table
-- CREATE TABLE public.inventory_audits (
--     id uuid NOT NULL DEFAULT gen_random_uuid(),
--     audit_number text NOT NULL UNIQUE,
--     created_at timestamp with time zone DEFAULT now(),
--     created_by uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
--     status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'confirmed', 'cancelled')),
--     notes text,
--     reviewed_by uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
--     reviewed_at timestamp with time zone,
--     review_notes text,
--     CONSTRAINT inventory_audits_pkey PRIMARY KEY (id)
-- );

-- 3. Inventory Audit Items Table
-- CREATE TABLE public.inventory_audit_items (
--     id uuid NOT NULL DEFAULT gen_random_uuid(),
--     audit_id uuid NOT NULL REFERENCES public.inventory_audits(id) ON DELETE CASCADE,
--     model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
--     color_id uuid NOT NULL REFERENCES public.colors(id) ON DELETE CASCADE,
--     system_qty integer NOT NULL DEFAULT 0,
--     counted_qty integer NOT NULL DEFAULT 0,
--     difference integer NOT NULL DEFAULT 0,
--     CONSTRAINT inventory_audit_items_pkey PRIMARY KEY (id)
-- );

-- 4. Enable RLS and Create Policies
-- ALTER TABLE public.inventory_audits ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.inventory_audit_items ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Enable all access for all users" ON public.inventory_audits FOR ALL USING (true) WITH CHECK (true);
-- CREATE POLICY "Enable all access for all users" ON public.inventory_audit_items FOR ALL USING (true) WITH CHECK (true);

-- 5. Submit Inventory Audit Function
-- CREATE OR REPLACE FUNCTION public.submit_inventory_audit(
--     p_worker_id uuid,
--     p_notes text,
--     p_items jsonb
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     v_audit_id uuid;
--     v_audit_number text;
--     v_item record;
-- BEGIN
--     v_audit_number := 'AUD-' || nextval('public.audit_number_seq')::text;
--     
--     INSERT INTO public.inventory_audits (
--         audit_number, created_by, status, notes
--     ) VALUES (
--         v_audit_number, p_worker_id, 'submitted', p_notes
--     ) RETURNING id INTO v_audit_id;
--     
--     FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(model_id uuid, color_id uuid, system_qty int, counted_qty int)
--     LOOP
--         INSERT INTO public.inventory_audit_items (
--             audit_id, model_id, color_id, system_qty, counted_qty, difference
--         ) VALUES (
--             v_audit_id,
--             v_item.model_id,
--             v_item.color_id,
--             v_item.system_qty,
--             v_item.counted_qty,
--             (v_item.counted_qty - v_item.system_qty)
--         );
--     END LOOP;
--     
--     RETURN jsonb_build_object('success', true, 'audit_number', v_audit_number, 'audit_id', v_audit_id);
-- END;
-- $$;

-- 6. Confirm Inventory Audit Function
-- CREATE OR REPLACE FUNCTION public.confirm_inventory_audit(
--     p_audit_id uuid,
--     p_admin_id uuid,
--     p_notes text
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     v_audit_number text;
--     v_status text;
--     v_item record;
--     v_diff integer;
-- BEGIN
--     SELECT audit_number, status INTO v_audit_number, v_status
--     FROM public.inventory_audits WHERE id = p_audit_id;
--     
--     IF v_status IS NULL THEN
--         RETURN jsonb_build_object('success', false, 'error', 'جلسة الجرد غير موجودة');
--     END IF;
--     
--     IF v_status <> 'submitted' THEN
--         RETURN jsonb_build_object('success', false, 'error', 'جلسة الجرد ليست في حالة انتظار المراجعة');
--     END IF;
--     
--     FOR v_item IN SELECT * FROM public.inventory_audit_items WHERE audit_id = p_audit_id
--     LOOP
--         v_diff := v_item.difference;
--         
--         IF v_diff <> 0 THEN
--             UPDATE public.model_inventory
--             SET available_series = v_item.counted_qty
--             WHERE model_id = v_item.model_id AND color_id = v_item.color_id;
--             
--             INSERT INTO public.stock_movements (
--                 model_id, color_id, movement_type, quantity, reference
--             ) VALUES (
--                 v_item.model_id,
--                 v_item.color_id,
--                 CASE WHEN v_diff > 0 THEN 'in' ELSE 'out' END,
--                 ABS(v_diff),
--                 'تسوية جرد دوري: ' || v_audit_number
--             );
--         END IF;
--     END LOOP;
--     
--     UPDATE public.inventory_audits
--     SET
--         status = 'confirmed',
--         reviewed_by = p_admin_id,
--         reviewed_at = now(),
--         review_notes = p_notes
--     WHERE id = p_audit_id;
--     
--     RETURN jsonb_build_object('success', true);
-- END;
-- $$;

-- 7. Create Inventory Audit Session (Admin Initiated)
-- CREATE OR REPLACE FUNCTION public.create_inventory_audit(
--     p_admin_id uuid,
--     p_notes text,
--     p_model_ids uuid[]
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--     v_audit_id uuid;
--     v_audit_number text;
--     v_model_id uuid;
--     v_inv record;
-- BEGIN
--     v_audit_number := 'AUD-' || nextval('public.audit_number_seq')::text;
--     
--     INSERT INTO public.inventory_audits (
--         audit_number, created_by, status, notes
--     ) VALUES (
--         v_audit_number, p_admin_id, 'draft', p_notes
--     ) RETURNING id INTO v_audit_id;
--     
--     FOREACH v_model_id IN ARRAY p_model_ids
--     LOOP
--         FOR v_inv IN SELECT color_id, available_series FROM public.model_inventory WHERE model_id = v_model_id
--         LOOP
--             INSERT INTO public.inventory_audit_items (
--                 audit_id, model_id, color_id, system_qty, counted_qty, difference
--             ) VALUES (
--                 v_audit_id,
--                 v_model_id,
--                 v_inv.color_id,
--                 v_inv.available_series,
--                 0,
--                 -v_inv.available_series
--             );
--         END LOOP;
--     END LOOP;
--     
--     RETURN jsonb_build_object('success', true, 'audit_id', v_audit_id, 'audit_number', v_audit_number);
-- $$;

-- =========================================================================
-- 🌟 MIGRATION: ADD ASSIGNED_WORKER_ID TO ORDERS 🌟
-- =========================================================================
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS assigned_worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_assigned_worker_id ON public.orders(assigned_worker_id);

-- =========================================================================
-- 🌟 MIGRATION: CREATE ORDER_LOGS TABLE 🌟
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.order_logs (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
    user_name text NOT NULL,
    action_type text NOT NULL,
    notes text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT order_logs_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_order_logs_order_id ON public.order_logs(order_id);


-- =========================================================================
-- 🌟 MIGRATION: CREATE THEMES TABLE & SEED DEFAULT THEMES 🌟
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.themes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    description text,
    is_active boolean DEFAULT false,
    is_system boolean DEFAULT false,
    variables jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT themes_pkey PRIMARY KEY (id)
);

-- Index on is_active to fast-fetch the current active theme
CREATE INDEX IF NOT EXISTS idx_themes_is_active ON public.themes(is_active);

-- Enforce that at most one theme is active at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_themes_only_one_active ON public.themes (is_active) WHERE (is_active = true);

-- Enable RLS
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;

-- Policies for public.themes:
-- Anyone can read (since themes are applied on client pages)
CREATE POLICY "Allow public read access to themes" ON public.themes
    FOR SELECT USING (true);

CREATE POLICY "Allow admin write access to themes" ON public.themes
    FOR ALL USING (true) WITH CHECK (true);

-- Seed default system themes if they don't exist
INSERT INTO public.themes (name, description, is_active, is_system, variables)
VALUES 
(
  'Dark Theme', 
  'المظهر الداكن الافتراضي الخاص بالنظام بألوان برتقالية وسوداء متناسقة.', 
  true, 
  true, 
  '{
    "colors": {
      "page": {
        "bg": "#0a0a0a",
        "bg_secondary": "#171717",
        "surface": "#171717",
        "text": "#f5f5f5",
        "text_muted": "#a3a3a3",
        "selection_bg": "#f97316",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#f97316",
        "primary_hover": "#ea580c",
        "secondary": "#262626",
        "secondary_hover": "#404040"
      },
      "top_nav": {
        "bg": "#171717",
        "border": "#262626",
        "logo": "#f97316",
        "text": "#f5f5f5",
        "link_active": "#f97316",
        "link_hover": "#ea580c",
        "icons": "#a3a3a3",
        "search_bg": "#0a0a0a",
        "search_border": "#262626",
        "search_text": "#f5f5f5"
      },
      "hero": {
        "bg": "#0a0a0a",
        "overlay": "linear-gradient(to bottom, rgba(10,10,10,0.4), rgba(10,10,10,1))",
        "title": "#ffffff",
        "subtitle": "#a3a3a3"
      },
      "buttons": {
        "primary": { "bg": "#f97316", "text": "#ffffff", "border": "transparent", "hover_bg": "#ea580c", "hover_text": "#ffffff", "active_bg": "#c2410c", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" },
        "secondary": { "bg": "#262626", "text": "#f5f5f5", "border": "#404040", "hover_bg": "#404040", "hover_text": "#ffffff", "active_bg": "#525252", "disabled_bg": "#171717", "disabled_text": "#737373" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#262626", "disabled_text": "#a3a3a3" }
      },
      "product_cards": {
        "bg": "#171717",
        "border": "#262626",
        "radius": "16px",
        "title": "#f5f5f5",
        "price": "#f97316",
        "category": "#a3a3a3",
        "shadow": "0 4px 20px rgba(0,0,0,0.4)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 30px rgba(249,115,22,0.15)",
        "badge_bg": "#f97316",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#171717",
        "border": "#262626",
        "image_border": "#262626",
        "price": "#f97316",
        "text": "#f5f5f5",
        "text_secondary": "#a3a3a3",
        "quantity_bg": "#262626",
        "quantity_text": "#f5f5f5",
        "size_active_bg": "#f97316",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#262626",
        "size_inactive_text": "#a3a3a3",
        "color_border_active": "#f97316"
      },
      "inputs": {
        "bg": "#171717",
        "border": "#262626",
        "focus_border": "#f97316",
        "focus_ring": "rgba(249,115,22,0.2)",
        "placeholder": "#737373",
        "text": "#f5f5f5",
        "icons": "#a3a3a3"
      },
      "tables": {
        "header_bg": "#171717",
        "header_text": "#a3a3a3",
        "row_bg": "#171717",
        "row_alt_bg": "#1e1e1e",
        "row_hover_bg": "#262626",
        "border": "#262626",
        "selected_bg": "rgba(249,115,22,0.1)",
        "selected_text": "#f97316"
      },
      "sidebar": {
        "bg": "#171717",
        "border": "#262626",
        "text": "#a3a3a3",
        "text_hover": "#f5f5f5",
        "text_active": "#f97316",
        "bg_active": "rgba(249,115,22,0.1)",
        "bg_hover": "#262626",
        "icons": "#a3a3a3",
        "icons_active": "#f97316"
      },
      "footer": {
        "bg": "#0a0a0a",
        "border": "#171717",
        "text": "#a3a3a3",
        "link": "#a3a3a3",
        "link_hover": "#f97316",
        "social_bg": "#171717",
        "social_text": "#a3a3a3",
        "social_hover_bg": "#f97316",
        "social_hover_text": "#ffffff"
      },
      "gallery": {
        "bg": "#0a0a0a",
        "image_border": "#262626",
        "hover_effect": "scale",
        "overlay_bg": "rgba(10,10,10,0.6)",
        "shadow": "0 4px 10px rgba(0,0,0,0.5)"
      },
      "cards": {
        "product": { "bg": "#171717", "border": "#262626", "radius": "12px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "translate-y" },
        "statistics": { "bg": "#171717", "border": "#262626", "radius": "16px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "none" },
        "dashboard": { "bg": "#171717", "border": "#262626", "radius": "16px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "none" },
        "order": { "bg": "#171717", "border": "#262626", "radius": "12px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "none" }
      },
      "alerts": {
        "success": { "bg": "rgba(16,185,129,0.1)", "text": "#10b981", "border": "#10b981" },
        "error": { "bg": "rgba(239,68,68,0.1)", "text": "#ef4444", "border": "#ef4444" },
        "warning": { "bg": "rgba(245,158,11,0.1)", "text": "#f59e0b", "border": "#f59e0b" },
        "info": { "bg": "rgba(59,130,246,0.1)", "text": "#3b82f6", "border": "#3b82f6" }
      },
      "badges": {
        "orange": { "bg": "#f97316", "text": "#ffffff" },
        "success": { "bg": "#10b981", "text": "#ffffff" },
        "error": { "bg": "#ef4444", "text": "#ffffff" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff" },
        "info": { "bg": "#3b82f6", "text": "#ffffff" }
      },
      "icons": {
        "primary": "#f97316",
        "muted": "#a3a3a3",
        "white": "#ffffff"
      },
      "links": {
        "normal": "#a3a3a3",
        "hover": "#f97316",
        "active": "#f97316",
        "visited": "#a3a3a3"
      },
      "shadows": {
        "color": "rgba(0,0,0,0.8)",
        "size": "10px",
        "blur": "40px"
      },
      "borders": {
        "color": "#262626",
        "width": "1px",
        "radius": "12px"
      },
      "scrollbar": {
        "track": "#0a0a0a",
        "thumb": "#262626",
        "thumb_hover": "#f97316"
      },
      "loading": {
        "loader": "#f97316",
        "spinner": "#262626"
      },
      "toasts": {
        "bg": "#171717",
        "border": "#262626",
        "text": "#f5f5f5"
      },
      "cart": {
        "bg": "#171717",
        "border": "#262626",
        "text": "#f5f5f5",
        "totals_bg": "#0a0a0a",
        "totals_text": "#f5f5f5"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s",
      "hover_effect": "ease-in-out"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  }'::jsonb
),
(
  'Light Theme', 
  'مظهر فاتح ناصع بألوان برتقالية مميزة وتصميم مريح للعين في الإضاءة القوية.', 
  false, 
  true, 
  '{
    "colors": {
      "page": {
        "bg": "#f3f4f6",
        "bg_secondary": "#ffffff",
        "surface": "#ffffff",
        "text": "#111827",
        "text_muted": "#6b7280",
        "selection_bg": "#f97316",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#f97316",
        "primary_hover": "#ea580c",
        "secondary": "#e5e7eb",
        "secondary_hover": "#d1d5db"
      },
      "top_nav": {
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "logo": "#f97316",
        "text": "#111827",
        "link_active": "#f97316",
        "link_hover": "#ea580c",
        "icons": "#4b5563",
        "search_bg": "#f3f4f6",
        "search_border": "#e5e7eb",
        "search_text": "#111827"
      },
      "hero": {
        "bg": "#ffffff",
        "overlay": "linear-gradient(to bottom, rgba(255,255,255,0.4), rgba(255,255,255,1))",
        "title": "#111827",
        "subtitle": "#4b5563"
      },
      "buttons": {
        "primary": { "bg": "#f97316", "text": "#ffffff", "border": "transparent", "hover_bg": "#ea580c", "hover_text": "#ffffff", "active_bg": "#c2410c", "disabled_bg": "#e5e7eb", "disabled_text": "#9ca3af" },
        "secondary": { "bg": "#f3f4f6", "text": "#111827", "border": "#d1d5db", "hover_bg": "#e5e7eb", "hover_text": "#111827", "active_bg": "#d1d5db", "disabled_bg": "#f9fafb", "disabled_text": "#9ca3af" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#e5e7eb", "disabled_text": "#9ca3af" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#e5e7eb", "disabled_text": "#9ca3af" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#e5e7eb", "disabled_text": "#9ca3af" }
      },
      "product_cards": {
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "radius": "16px",
        "title": "#111827",
        "price": "#f97316",
        "category": "#6b7280",
        "shadow": "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -1px rgba(0,0,0,0.06)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 15px -3px rgba(249,115,22,0.1), 0 4px 6px -2px rgba(249,115,22,0.05)",
        "badge_bg": "#f97316",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "image_border": "#e5e7eb",
        "price": "#f97316",
        "text": "#111827",
        "text_secondary": "#6b7280",
        "quantity_bg": "#f3f4f6",
        "quantity_text": "#111827",
        "size_active_bg": "#f97316",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#f3f4f6",
        "size_inactive_text": "#4b5563",
        "color_border_active": "#f97316"
      },
      "inputs": {
        "bg": "#ffffff",
        "border": "#d1d5db",
        "focus_border": "#f97316",
        "focus_ring": "rgba(249,115,22,0.2)",
        "placeholder": "#9ca3af",
        "text": "#111827",
        "icons": "#6b7280"
      },
      "tables": {
        "header_bg": "#f9fafb",
        "header_text": "#4b5563",
        "row_bg": "#ffffff",
        "row_alt_bg": "#f9fafb",
        "row_hover_bg": "#f3f4f6",
        "border": "#e5e7eb",
        "selected_bg": "rgba(249,115,22,0.08)",
        "selected_text": "#f97316"
      },
      "sidebar": {
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "text": "#4b5563",
        "text_hover": "#111827",
        "text_active": "#f97316",
        "bg_active": "rgba(249,115,22,0.08)",
        "bg_hover": "#f3f4f6",
        "icons": "#6b7280",
        "icons_active": "#f97316"
      },
      "footer": {
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "text": "#4b5563",
        "link": "#4b5563",
        "link_hover": "#f97316",
        "social_bg": "#f3f4f6",
        "social_text": "#4b5563",
        "social_hover_bg": "#f97316",
        "social_hover_text": "#ffffff"
      },
      "gallery": {
        "bg": "#f3f4f6",
        "image_border": "#e5e7eb",
        "hover_effect": "scale",
        "overlay_bg": "rgba(255,255,255,0.6)",
        "shadow": "0 4px 6px -1px rgba(0,0,0,0.1)"
      },
      "cards": {
        "product": { "bg": "#ffffff", "border": "#e5e7eb", "radius": "12px", "shadow": "0 2px 5px rgba(0,0,0,0.05)", "hover_anim": "translate-y" },
        "statistics": { "bg": "#ffffff", "border": "#e5e7eb", "radius": "16px", "shadow": "0 2px 5px rgba(0,0,0,0.05)", "hover_anim": "none" },
        "dashboard": { "bg": "#ffffff", "border": "#e5e7eb", "radius": "16px", "shadow": "0 2px 5px rgba(0,0,0,0.05)", "hover_anim": "none" },
        "order": { "bg": "#ffffff", "border": "#e5e7eb", "radius": "12px", "shadow": "0 2px 5px rgba(0,0,0,0.05)", "hover_anim": "none" }
      },
      "alerts": {
        "success": { "bg": "#ecfdf5", "text": "#065f46", "border": "#a7f3d0" },
        "error": { "bg": "#fef2f2", "text": "#991b1b", "border": "#fca5a5" },
        "warning": { "bg": "#fffbeb", "text": "#92400e", "border": "#fde68a" },
        "info": { "bg": "#eff6ff", "text": "#1e40af", "border": "#bfdbfe" }
      },
      "badges": {
        "orange": { "bg": "#f97316", "text": "#ffffff" },
        "success": { "bg": "#10b981", "text": "#ffffff" },
        "error": { "bg": "#ef4444", "text": "#ffffff" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff" },
        "info": { "bg": "#3b82f6", "text": "#ffffff" }
      },
      "icons": {
        "primary": "#f97316",
        "muted": "#6b7280",
        "white": "#111827"
      },
      "links": {
        "normal": "#4b5563",
        "hover": "#f97316",
        "active": "#f97316",
        "visited": "#4b5563"
      },
      "shadows": {
        "color": "rgba(0,0,0,0.05)",
        "size": "4px",
        "blur": "10px"
      },
      "borders": {
        "color": "#e5e7eb",
        "width": "1px",
        "radius": "12px"
      },
      "scrollbar": {
        "track": "#f3f4f6",
        "thumb": "#d1d5db",
        "thumb_hover": "#f97316"
      },
      "loading": {
        "loader": "#f97316",
        "spinner": "#e5e7eb"
      },
      "toasts": {
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "text": "#111827"
      },
      "cart": {
        "bg": "#ffffff",
        "border": "#e5e7eb",
        "text": "#111827",
        "totals_bg": "#f3f4f6",
        "totals_text": "#111827"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s",
      "hover_effect": "ease-in-out"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  }'::jsonb
),
(
  'Modern Theme', 
  'مظهر حديث وعصري يعتمد على درجات اللون البنفسجي والنيلي ولمسات جمالية مميزة.', 
  false, 
  true, 
  '{
    "colors": {
      "page": {
        "bg": "#0b0f19",
        "bg_secondary": "#161e2e",
        "surface": "#161e2e",
        "text": "#f9fafb",
        "text_muted": "#9ca3af",
        "selection_bg": "#6366f1",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#6366f1",
        "primary_hover": "#4f46e5",
        "secondary": "#1f2937",
        "secondary_hover": "#374151"
      },
      "top_nav": {
        "bg": "#111827",
        "border": "#1f2937",
        "logo": "#6366f1",
        "text": "#f9fafb",
        "link_active": "#6366f1",
        "link_hover": "#818cf8",
        "icons": "#9ca3af",
        "search_bg": "#0b0f19",
        "search_border": "#1f2937",
        "search_text": "#f9fafb"
      },
      "hero": {
        "bg": "#0b0f19",
        "overlay": "linear-gradient(to bottom, rgba(11,15,25,0.4), rgba(11,15,25,1))",
        "title": "#ffffff",
        "subtitle": "#9ca3af"
      },
      "buttons": {
        "primary": { "bg": "#6366f1", "text": "#ffffff", "border": "transparent", "hover_bg": "#4f46e5", "hover_text": "#ffffff", "active_bg": "#4338ca", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" },
        "secondary": { "bg": "#1f2937", "text": "#f3f4f6", "border": "#374151", "hover_bg": "#374151", "hover_text": "#ffffff", "active_bg": "#4b5563", "disabled_bg": "#111827", "disabled_text": "#4b5563" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#1f2937", "disabled_text": "#9ca3af" }
      },
      "product_cards": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "radius": "16px",
        "title": "#f9fafb",
        "price": "#6366f1",
        "category": "#9ca3af",
        "shadow": "0 4px 20px rgba(0,0,0,0.4)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 30px rgba(99,102,241,0.15)",
        "badge_bg": "#6366f1",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "image_border": "#1f2937",
        "price": "#6366f1",
        "text": "#f9fafb",
        "text_secondary": "#9ca3af",
        "quantity_bg": "#1f2937",
        "quantity_text": "#f9fafb",
        "size_active_bg": "#6366f1",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#1f2937",
        "size_inactive_text": "#9ca3af",
        "color_border_active": "#6366f1"
      },
      "inputs": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "focus_border": "#6366f1",
        "focus_ring": "rgba(99,102,241,0.2)",
        "placeholder": "#4b5563",
        "text": "#f9fafb",
        "icons": "#9ca3af"
      },
      "tables": {
        "header_bg": "#161e2e",
        "header_text": "#9ca3af",
        "row_bg": "#161e2e",
        "row_alt_bg": "#1b2436",
        "row_hover_bg": "#1f2937",
        "border": "#1f2937",
        "selected_bg": "rgba(99,102,241,0.1)",
        "selected_text": "#6366f1"
      },
      "sidebar": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "text": "#9ca3af",
        "text_hover": "#f9fafb",
        "text_active": "#6366f1",
        "bg_active": "rgba(99,102,241,0.1)",
        "bg_hover": "#1f2937",
        "icons": "#9ca3af",
        "icons_active": "#6366f1"
      },
      "footer": {
        "bg": "#0b0f19",
        "border": "#161e2e",
        "text": "#9ca3af",
        "link": "#9ca3af",
        "link_hover": "#6366f1",
        "social_bg": "#161e2e",
        "social_text": "#9ca3af",
        "social_hover_bg": "#6366f1",
        "social_hover_text": "#ffffff"
      },
      "gallery": {
        "bg": "#0b0f19",
        "image_border": "#1f2937",
        "hover_effect": "scale",
        "overlay_bg": "rgba(11,15,25,0.6)",
        "shadow": "0 4px 10px rgba(0,0,0,0.5)"
      },
      "cards": {
        "product": { "bg": "#161e2e", "border": "#1f2937", "radius": "12px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "translate-y" },
        "statistics": { "bg": "#161e2e", "border": "#1f2937", "radius": "16px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "none" },
        "dashboard": { "bg": "#161e2e", "border": "#1f2937", "radius": "16px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "none" },
        "order": { "bg": "#161e2e", "border": "#1f2937", "radius": "12px", "shadow": "0 4px 15px rgba(0,0,0,0.3)", "hover_anim": "none" }
      },
      "alerts": {
        "success": { "bg": "rgba(16,185,129,0.1)", "text": "#10b981", "border": "#10b981" },
        "error": { "bg": "rgba(239,68,68,0.1)", "text": "#ef4444", "border": "#ef4444" },
        "warning": { "bg": "rgba(245,158,11,0.1)", "text": "#f59e0b", "border": "#f59e0b" },
        "info": { "bg": "rgba(99,102,241,0.1)", "text": "#6366f1", "border": "#6366f1" }
      },
      "badges": {
        "orange": { "bg": "#6366f1", "text": "#ffffff" },
        "success": { "bg": "#10b981", "text": "#ffffff" },
        "error": { "bg": "#ef4444", "text": "#ffffff" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff" },
        "info": { "bg": "#3b82f6", "text": "#ffffff" }
      },
      "icons": {
        "primary": "#6366f1",
        "muted": "#9ca3af",
        "white": "#ffffff"
      },
      "links": {
        "normal": "#9ca3af",
        "hover": "#6366f1",
        "active": "#6366f1",
        "visited": "#9ca3af"
      },
      "shadows": {
        "color": "rgba(0,0,0,0.6)",
        "size": "8px",
        "blur": "30px"
      },
      "borders": {
        "color": "#1f2937",
        "width": "1px",
        "radius": "12px"
      },
      "scrollbar": {
        "track": "#0b0f19",
        "thumb": "#1f2937",
        "thumb_hover": "#6366f1"
      },
      "loading": {
        "loader": "#6366f1",
        "spinner": "#1f2937"
      },
      "toasts": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "text": "#f9fafb"
      },
      "cart": {
        "bg": "#161e2e",
        "border": "#1f2937",
        "text": "#f9fafb",
        "totals_bg": "#0b0f19",
        "totals_text": "#f9fafb"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s",
      "hover_effect": "ease-in-out"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  }'::jsonb
),
(
  'Luxury Theme', 
  'تصميم فخم يعتمد على درجات الأسود الملكي مع لمسات ذهبية راقية تضفي طابع التميز والجاذبية.', 
  false, 
  true, 
  '{
    "colors": {
      "page": {
        "bg": "#09090b",
        "bg_secondary": "#18181b",
        "surface": "#18181b",
        "text": "#f4f4f5",
        "text_muted": "#a1a1aa",
        "selection_bg": "#d4af37",
        "selection_text": "#000000"
      },
      "brand": {
        "primary": "#d4af37",
        "primary_hover": "#aa8c2c",
        "secondary": "#27272a",
        "secondary_hover": "#3f3f46"
      },
      "top_nav": {
        "bg": "#121214",
        "border": "#27272a",
        "logo": "#d4af37",
        "text": "#f4f4f5",
        "link_active": "#d4af37",
        "link_hover": "#e5c158",
        "icons": "#a1a1aa",
        "search_bg": "#09090b",
        "search_border": "#27272a",
        "search_text": "#f4f4f5"
      },
      "hero": {
        "bg": "#09090b",
        "overlay": "linear-gradient(to bottom, rgba(9,9,11,0.5), rgba(9,9,11,1))",
        "title": "#ffffff",
        "subtitle": "#a1a1aa"
      },
      "buttons": {
        "primary": { "bg": "#d4af37", "text": "#000000", "border": "transparent", "hover_bg": "#aa8c2c", "hover_text": "#000000", "active_bg": "#8c7220", "disabled_bg": "#27272a", "disabled_text": "#71717a" },
        "secondary": { "bg": "#27272a", "text": "#f4f4f5", "border": "#3f3f46", "hover_bg": "#3f3f46", "hover_text": "#ffffff", "active_bg": "#52525b", "disabled_bg": "#18181b", "disabled_text": "#71717a" },
        "success": { "bg": "#10b981", "text": "#ffffff", "border": "transparent", "hover_bg": "#059669", "hover_text": "#ffffff", "active_bg": "#047857", "disabled_bg": "#27272a", "disabled_text": "#71717a" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff", "border": "transparent", "hover_bg": "#d97706", "hover_text": "#ffffff", "active_bg": "#b45309", "disabled_bg": "#27272a", "disabled_text": "#71717a" },
        "danger": { "bg": "#ef4444", "text": "#ffffff", "border": "transparent", "hover_bg": "#dc2626", "hover_text": "#ffffff", "active_bg": "#b91c1c", "disabled_bg": "#27272a", "disabled_text": "#71717a" }
      },
      "product_cards": {
        "bg": "#18181b",
        "border": "#27272a",
        "radius": "12px",
        "title": "#f4f4f5",
        "price": "#d4af37",
        "category": "#a1a1aa",
        "shadow": "0 4px 20px rgba(0,0,0,0.6)",
        "hover_effect": "scale",
        "hover_shadow": "0 10px 30px rgba(212,175,55,0.12)",
        "badge_bg": "#d4af37",
        "badge_text": "#000000"
      },
      "modal": {
        "bg": "#18181b",
        "border": "#27272a",
        "image_border": "#27272a",
        "price": "#d4af37",
        "text": "#f4f4f5",
        "text_secondary": "#a1a1aa",
        "quantity_bg": "#27272a",
        "quantity_text": "#f4f4f5",
        "size_active_bg": "#d4af37",
        "size_active_text": "#000000",
        "size_inactive_bg": "#27272a",
        "size_inactive_text": "#a1a1aa",
        "color_border_active": "#d4af37"
      },
      "inputs": {
        "bg": "#18181b",
        "border": "#27272a",
        "focus_border": "#d4af37",
        "focus_ring": "rgba(212,175,55,0.2)",
        "placeholder": "#52525b",
        "text": "#f4f4f5",
        "icons": "#a1a1aa"
      },
      "tables": {
        "header_bg": "#18181b",
        "header_text": "#a1a1aa",
        "row_bg": "#18181b",
        "row_alt_bg": "#1f1f23",
        "row_hover_bg": "#27272a",
        "border": "#27272a",
        "selected_bg": "rgba(212,175,55,0.1)",
        "selected_text": "#d4af37"
      },
      "sidebar": {
        "bg": "#18181b",
        "border": "#27272a",
        "text": "#a1a1aa",
        "text_hover": "#f4f4f5",
        "text_active": "#d4af37",
        "bg_active": "rgba(212,175,55,0.08)",
        "bg_hover": "#27272a",
        "icons": "#a1a1aa",
        "icons_active": "#d4af37"
      },
      "footer": {
        "bg": "#09090b",
        "border": "#18181b",
        "text": "#a1a1aa",
        "link": "#a1a1aa",
        "link_hover": "#d4af37",
        "social_bg": "#18181b",
        "social_text": "#a1a1aa",
        "social_hover_bg": "#d4af37",
        "social_hover_text": "#000000"
      },
      "gallery": {
        "bg": "#09090b",
        "image_border": "#27272a",
        "hover_effect": "scale",
        "overlay_bg": "rgba(9,9,11,0.6)",
        "shadow": "0 4px 10px rgba(0,0,0,0.6)"
      },
      "cards": {
        "product": { "bg": "#18181b", "border": "#27272a", "radius": "8px", "shadow": "0 4px 15px rgba(0,0,0,0.5)", "hover_anim": "translate-y" },
        "statistics": { "bg": "#18181b", "border": "#27272a", "radius": "12px", "shadow": "0 4px 15px rgba(0,0,0,0.5)", "hover_anim": "none" },
        "dashboard": { "bg": "#18181b", "border": "#27272a", "radius": "12px", "shadow": "0 4px 15px rgba(0,0,0,0.5)", "hover_anim": "none" },
        "order": { "bg": "#18181b", "border": "#27272a", "radius": "8px", "shadow": "0 4px 15px rgba(0,0,0,0.5)", "hover_anim": "none" }
      },
      "alerts": {
        "success": { "bg": "rgba(16,185,129,0.1)", "text": "#10b981", "border": "#10b981" },
        "error": { "bg": "rgba(239,68,68,0.1)", "text": "#ef4444", "border": "#ef4444" },
        "warning": { "bg": "rgba(245,158,11,0.1)", "text": "#f59e0b", "border": "#f59e0b" },
        "info": { "bg": "rgba(212,175,55,0.1)", "text": "#d4af37", "border": "#d4af37" }
      },
      "badges": {
        "orange": { "bg": "#d4af37", "text": "#000000" },
        "success": { "bg": "#10b981", "text": "#ffffff" },
        "error": { "bg": "#ef4444", "text": "#ffffff" },
        "warning": { "bg": "#f59e0b", "text": "#ffffff" },
        "info": { "bg": "#3b82f6", "text": "#ffffff" }
      },
      "icons": {
        "primary": "#d4af37",
        "muted": "#a1a1aa",
        "white": "#ffffff"
      },
      "links": {
        "normal": "#a1a1aa",
        "hover": "#d4af37",
        "active": "#d4af37",
        "visited": "#a1a1aa"
      },
      "shadows": {
        "color": "rgba(0,0,0,0.8)",
        "size": "10px",
        "blur": "45px"
      },
      "borders": {
        "color": "#27272a",
        "width": "1px",
        "radius": "8px"
      },
      "scrollbar": {
        "track": "#09090b",
        "thumb": "#27272a",
        "thumb_hover": "#d4af37"
      },
      "loading": {
        "loader": "#d4af37",
        "spinner": "#27272a"
      },
      "toasts": {
        "bg": "#18181b",
        "border": "#27272a",
        "text": "#f4f4f5"
      },
      "cart": {
        "bg": "#18181b",
        "border": "#27272a",
        "text": "#f4f4f5",
        "totals_bg": "#09090b",
        "totals_text": "#f4f4f5"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.3s",
      "hover_effect": "ease-in-out"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  }'::jsonb
),
(
  'Minimal Theme', 
  'تصميم هادئ وبسيط للغاية، خالي من التكلف والتعقيد، باللونين الأبيض والأسود النقي.', 
  false, 
  true, 
  '{
    "colors": {
      "page": {
        "bg": "#ffffff",
        "bg_secondary": "#fafafa",
        "surface": "#ffffff",
        "text": "#171717",
        "text_muted": "#737373",
        "selection_bg": "#000000",
        "selection_text": "#ffffff"
      },
      "brand": {
        "primary": "#000000",
        "primary_hover": "#262626",
        "secondary": "#e5e5e5",
        "secondary_hover": "#d4d4d4"
      },
      "top_nav": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "logo": "#000000",
        "text": "#171717",
        "link_active": "#000000",
        "link_hover": "#404040",
        "icons": "#737373",
        "search_bg": "#fafafa",
        "search_border": "#e5e5e5",
        "search_text": "#171717"
      },
      "hero": {
        "bg": "#ffffff",
        "overlay": "",
        "title": "#000000",
        "subtitle": "#737373"
      },
      "buttons": {
        "primary": { "bg": "#000000", "text": "#ffffff", "border": "transparent", "hover_bg": "#262626", "hover_text": "#ffffff", "active_bg": "#171717", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" },
        "secondary": { "bg": "#ffffff", "text": "#171717", "border": "#e5e5e5", "hover_bg": "#fafafa", "hover_text": "#171717", "active_bg": "#f5f5f5", "disabled_bg": "#fafafa", "disabled_text": "#d4d4d4" },
        "success": { "bg": "#171717", "text": "#ffffff", "border": "transparent", "hover_bg": "#262626", "hover_text": "#ffffff", "active_bg": "#000000", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" },
        "warning": { "bg": "#404040", "text": "#ffffff", "border": "transparent", "hover_bg": "#525252", "hover_text": "#ffffff", "active_bg": "#262626", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" },
        "danger": { "bg": "#737373", "text": "#ffffff", "border": "transparent", "hover_bg": "#525252", "hover_text": "#ffffff", "active_bg": "#404040", "disabled_bg": "#e5e5e5", "disabled_text": "#a3a3a3" }
      },
      "product_cards": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "radius": "4px",
        "title": "#171717",
        "price": "#000000",
        "category": "#737373",
        "shadow": "none",
        "hover_effect": "none",
        "hover_shadow": "none",
        "badge_bg": "#000000",
        "badge_text": "#ffffff"
      },
      "modal": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "image_border": "#e5e5e5",
        "price": "#000000",
        "text": "#171717",
        "text_secondary": "#737373",
        "quantity_bg": "#fafafa",
        "quantity_text": "#171717",
        "size_active_bg": "#000000",
        "size_active_text": "#ffffff",
        "size_inactive_bg": "#ffffff",
        "size_inactive_text": "#737373",
        "color_border_active": "#000000"
      },
      "inputs": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "focus_border": "#000000",
        "focus_ring": "rgba(0,0,0,0.05)",
        "placeholder": "#a3a3a3",
        "text": "#171717",
        "icons": "#737373"
      },
      "tables": {
        "header_bg": "#fafafa",
        "header_text": "#737373",
        "row_bg": "#ffffff",
        "row_alt_bg": "#ffffff",
        "row_hover_bg": "#fafafa",
        "border": "#e5e5e5",
        "selected_bg": "#f5f5f5",
        "selected_text": "#000000"
      },
      "sidebar": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "text": "#737373",
        "text_hover": "#171717",
        "text_active": "#000000",
        "bg_active": "#f5f5f5",
        "bg_hover": "#fafafa",
        "icons": "#737373",
        "icons_active": "#000000"
      },
      "footer": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "text": "#737373",
        "link": "#737373",
        "link_hover": "#000000",
        "social_bg": "#fafafa",
        "social_text": "#737373",
        "social_hover_bg": "#000000",
        "social_hover_text": "#ffffff"
      },
      "gallery": {
        "bg": "#ffffff",
        "image_border": "#e5e5e5",
        "hover_effect": "none",
        "overlay_bg": "rgba(255,255,255,0.8)",
        "shadow": "none"
      },
      "cards": {
        "product": { "bg": "#ffffff", "border": "#e5e5e5", "radius": "4px", "shadow": "none", "hover_anim": "none" },
        "statistics": { "bg": "#ffffff", "border": "#e5e5e5", "radius": "4px", "shadow": "none", "hover_anim": "none" },
        "dashboard": { "bg": "#ffffff", "border": "#e5e5e5", "radius": "4px", "shadow": "none", "hover_anim": "none" },
        "order": { "bg": "#ffffff", "border": "#e5e5e5", "radius": "4px", "shadow": "none", "hover_anim": "none" }
      },
      "alerts": {
        "success": { "bg": "#fafafa", "text": "#171717", "border": "#e5e5e5" },
        "error": { "bg": "#fafafa", "text": "#171717", "border": "#e5e5e5" },
        "warning": { "bg": "#fafafa", "text": "#171717", "border": "#e5e5e5" },
        "info": { "bg": "#fafafa", "text": "#171717", "border": "#e5e5e5" }
      },
      "badges": {
        "orange": { "bg": "#000000", "text": "#ffffff" },
        "success": { "bg": "#171717", "text": "#ffffff" },
        "error": { "bg": "#404040", "text": "#ffffff" },
        "warning": { "bg": "#737373", "text": "#ffffff" },
        "info": { "bg": "#a3a3a3", "text": "#ffffff" }
      },
      "icons": {
        "primary": "#000000",
        "muted": "#737373",
        "white": "#171717"
      },
      "links": {
        "normal": "#737373",
        "hover": "#000000",
        "active": "#000000",
        "visited": "#737373"
      },
      "shadows": {
        "color": "rgba(0,0,0,0)",
        "size": "0px",
        "blur": "0px"
      },
      "borders": {
        "color": "#e5e5e5",
        "width": "1px",
        "radius": "4px"
      },
      "scrollbar": {
        "track": "#ffffff",
        "thumb": "#e5e5e5",
        "thumb_hover": "#000000"
      },
      "loading": {
        "loader": "#000000",
        "spinner": "#e5e5e5"
      },
      "toasts": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "text": "#171717"
      },
      "cart": {
        "bg": "#ffffff",
        "border": "#e5e5e5",
        "text": "#171717",
        "totals_bg": "#fafafa",
        "totals_text": "#171717"
      }
    },
    "fonts": {
      "family": "Tajawal, sans-serif",
      "size_base": "16px"
    },
    "animations": {
      "transition_speed": "0.15s",
      "hover_effect": "linear"
    },
    "visuals": {
      "glass_effect": false,
      "blur_intensity": "0px"
    }
  }'::jsonb
)
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- 🌟 Inbound Invoices (Stock Batch Replenishments) Schema 🌟
-- ============================================================

-- 1. Sequence for inbound invoice numbering
CREATE SEQUENCE IF NOT EXISTS public.inbound_invoice_number_seq START WITH 1001;

-- 2. Inbound Invoices Table (فاتورة دخل)
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

-- 3. Inbound Invoice Items Table (تفاصيل فاتورة الدخل)
CREATE TABLE IF NOT EXISTS public.inbound_invoice_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    inbound_invoice_id uuid REFERENCES public.inbound_invoices(id) ON DELETE CASCADE,
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
    quantity integer NOT NULL CHECK (quantity >= 0),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inbound_invoice_items_pkey PRIMARY KEY (id)
);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_inbound_invoice_items_invoice_id ON public.inbound_invoice_items(inbound_invoice_id);

-- 5. Disable Row Level Security (RLS) to support custom app authentication (anonymous client)
ALTER TABLE public.inbound_invoices DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_invoice_items DISABLE ROW LEVEL SECURITY;

-- 6. Process Inbound Transaction Function (أهم دالة للتعامل مع دفعات الرصيد والتعديل الآمن)
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
        
        -- مسح العناصر القديمة
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
        -- إدراج العنصر
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

-- 7. Delete Inbound Invoice Safely Function (حذف آمن للفواتير مع التحقق من عدم ترك رصيد سالب)
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

    -- b) التحقق من أن الخصم لم يتسبب في رصيد مخزن سالب
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


