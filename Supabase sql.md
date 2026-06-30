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
-- END;
-- $$;
