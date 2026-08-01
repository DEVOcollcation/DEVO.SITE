-- =========================================================================
-- 🚀 ULTRASOFT COMPLETE MASTER DATABASE SCHEMA (WITH SAFE DELETE RPC FIX)
-- 📦 Project: Ultra Soft (ألترا سوفت)
-- 📅 Updated: 2026-08-01
-- 💡 Description: Fixed reset_system_data function with explicit WHERE clauses
--    to pass PostgreSQL pg_safeupdate check during system reset.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. EXTENSIONS & SEQUENCES
-- -------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_net";

CREATE SEQUENCE IF NOT EXISTS public.invoices_invoice_number_seq START WITH 1001 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.audit_number_seq START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.return_number_seq START WITH 1001 INCREMENT BY 1;

-- -------------------------------------------------------------------------
-- 2. BASE LOOKUP & CATALOG TABLES
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name character varying NOT NULL CONSTRAINT categories_name_key UNIQUE,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.classes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name character varying NOT NULL CONSTRAINT classes_name_key UNIQUE,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sizes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name character varying NOT NULL CONSTRAINT sizes_name_key UNIQUE,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.colors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    color_code character varying CONSTRAINT colors_code_key UNIQUE,
    name character varying NOT NULL CONSTRAINT colors_name_key UNIQUE,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_sizes (
    class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    size_id uuid NOT NULL REFERENCES public.sizes(id) ON DELETE CASCADE,
    CONSTRAINT class_sizes_pkey PRIMARY KEY (class_id, size_id)
);

CREATE TABLE IF NOT EXISTS public.models (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    system_code character varying NOT NULL CONSTRAINT models_system_code_key UNIQUE,
    factory_code character varying NOT NULL,
    name character varying NOT NULL,
    category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
    class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
    price numeric NOT NULL CHECK (price >= 0),
    is_active boolean DEFAULT true,
    image_url_1 text,
    image_url_2 text,
    image_url_3 text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.model_sizes (
    model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
    size_id uuid NOT NULL REFERENCES public.sizes(id) ON DELETE CASCADE,
    CONSTRAINT model_sizes_pkey PRIMARY KEY (model_id, size_id)
);

CREATE TABLE IF NOT EXISTS public.model_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    image_url text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.model_inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
    available_series integer DEFAULT 0 CONSTRAINT chk_positive_available_series CHECK (available_series >= 0),
    CONSTRAINT model_inventory_model_id_color_id_key UNIQUE (model_id, color_id)
);

CREATE TABLE IF NOT EXISTS public.model_colors_inventory (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
    available_series_count integer NOT NULL DEFAULT 0 CHECK (available_series_count >= 0),
    CONSTRAINT model_colors_inventory_model_id_color_id_key UNIQUE (model_id, color_id)
);

-- -------------------------------------------------------------------------
-- 3. SYSTEM USERS & PROFILES
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.system_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid() REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name text NOT NULL,
    username text NOT NULL CONSTRAINT system_users_username_key UNIQUE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'worker')),
    worker_job text CHECK (worker_job IN ('showroom', 'warehouse', 'both')),
    is_active boolean DEFAULT true,
    login_count integer DEFAULT 0,
    invoice_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name character varying NOT NULL,
    role character varying DEFAULT 'staff',
    is_active boolean DEFAULT true,
    email character varying,
    login_count integer DEFAULT 0,
    invoice_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 4. ORDERS & TRANSACTIONS
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number text NOT NULL CONSTRAINT orders_invoice_number_key UNIQUE,
    customer_name text NOT NULL,
    phone_1 text NOT NULL,
    phone_2 text,
    address text,
    deposit numeric DEFAULT 0,
    deposit_receiver text,
    notes text,
    total_price numeric NOT NULL,
    total_series integer NOT NULL,
    worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
    assigned_worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
    assigned_admin_name text,
    status text DEFAULT 'created',
    preparation_status text DEFAULT 'pending' CHECK (preparation_status IN ('pending', 'in_progress', 'on_hold', 'prepared', 'shipped')),
    prepared_by uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
    preparation_started_at timestamp with time zone,
    preparation_completed_at timestamp with time zone,
    preparation_notes text,
    is_archived boolean DEFAULT false,
    is_locked boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    model_id uuid REFERENCES public.models(id) ON DELETE SET NULL,
    color_id uuid REFERENCES public.colors(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity > 0),
    price_per_series numeric NOT NULL CHECK (price_per_series >= 0),
    total_price numeric NOT NULL CHECK (total_price >= 0)
);

CREATE TABLE IF NOT EXISTS public.order_item_preparation (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    model_id uuid NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid NOT NULL REFERENCES public.colors(id) ON DELETE CASCADE,
    is_prepared boolean NOT NULL DEFAULT false,
    has_issue boolean NOT NULL DEFAULT false,
    note text,
    prepared_qty integer CHECK (prepared_qty >= 0),
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid REFERENCES public.system_users(id),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT order_item_preparation_unique UNIQUE (order_item_id)
);

CREATE TABLE IF NOT EXISTS public.preparation_status_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    changed_by uuid REFERENCES public.system_users(id),
    old_status text,
    new_status text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
    user_name text NOT NULL,
    action_type text NOT NULL,
    details text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number integer NOT NULL DEFAULT nextval('public.invoices_invoice_number_seq'::regclass),
    staff_id uuid REFERENCES public.profiles(id),
    customer_name character varying NOT NULL,
    customer_phone_1 character varying NOT NULL,
    customer_phone_2 character varying,
    customer_address text,
    deposit_amount numeric DEFAULT 0 CHECK (deposit_amount >= 0),
    deposit_receiver character varying,
    notes text,
    total_amount numeric DEFAULT 0,
    is_archived boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
    model_id uuid REFERENCES public.models(id) ON DELETE SET NULL,
    color_id uuid REFERENCES public.colors(id),
    series_quantity integer NOT NULL CHECK (series_quantity > 0),
    unit_price numeric NOT NULL CHECK (unit_price >= 0),
    total_line_price numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 5. RETURNS, INBOUND INVOICES & STOCK MOVEMENTS
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.returns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_number text NOT NULL CONSTRAINT returns_return_number_key UNIQUE,
    order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
    customer_name text NOT NULL,
    refund_amount numeric NOT NULL DEFAULT 0,
    total_series integer NOT NULL DEFAULT 0,
    notes text,
    worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.return_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id uuid REFERENCES public.returns(id) ON DELETE CASCADE,
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
    quantity integer NOT NULL CHECK (quantity > 0),
    price_per_series numeric NOT NULL CHECK (price_per_series >= 0),
    total_price numeric NOT NULL CHECK (total_price >= 0)
);

CREATE TABLE IF NOT EXISTS public.inbound_invoices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number text NOT NULL CONSTRAINT inbound_invoices_invoice_number_key UNIQUE,
    supplier_name text NOT NULL,
    notes text,
    total_series integer DEFAULT 0,
    total_cost numeric DEFAULT 0,
    created_by uuid REFERENCES public.system_users(id),
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inbound_invoice_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    inbound_invoice_id uuid REFERENCES public.inbound_invoices(id) ON DELETE CASCADE,
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_cost numeric DEFAULT 0 CHECK (unit_cost >= 0),
    total_cost numeric DEFAULT 0 CHECK (total_cost >= 0)
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    model_id uuid REFERENCES public.models(id) ON DELETE CASCADE,
    color_id uuid REFERENCES public.colors(id) ON DELETE CASCADE,
    movement_type text NOT NULL CHECK (movement_type IN ('in', 'out')),
    quantity integer NOT NULL,
    reference text,
    order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
    inbound_id uuid REFERENCES public.inbound_invoices(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 6. SETTINGS, THEMES, PROMOTIONS, NOTIFICATIONS & BACKUPS
-- -------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.home_settings (
    setting_key text PRIMARY KEY,
    setting_value text NOT NULL,
    description text
);

CREATE TABLE IF NOT EXISTS public.promo_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    icon text DEFAULT 'ph-star',
    badge_text text,
    badge_color text DEFAULT 'bg-devo-orange',
    is_active boolean DEFAULT true,
    image_url text,
    model_id uuid REFERENCES public.models(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.themes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CONSTRAINT themes_name_key UNIQUE,
    theme_key text NOT NULL UNIQUE,
    colors jsonb NOT NULL,
    is_active boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type varchar(50) NOT NULL,
    title varchar(255) NOT NULL,
    body text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    user_id uuid REFERENCES public.system_users(id) ON DELETE CASCADE,
    is_read boolean NOT NULL DEFAULT false,
    is_archived boolean NOT NULL DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_notification_queue (
    transaction_id text NOT NULL,
    model_id uuid NOT NULL,
    color_id uuid NOT NULL,
    new_available_series int NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT pk_inventory_notification_queue PRIMARY KEY (transaction_id, model_id, color_id)
);

CREATE TABLE IF NOT EXISTS public.inventory_audits (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_number text NOT NULL CONSTRAINT inventory_audits_audit_number_key UNIQUE,
    created_by uuid REFERENCES public.system_users(id),
    status text NOT NULL DEFAULT 'draft',
    notes text,
    reviewed_by uuid REFERENCES public.system_users(id),
    reviewed_at timestamp with time zone,
    review_notes text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_audit_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id uuid NOT NULL REFERENCES public.inventory_audits(id) ON DELETE CASCADE,
    model_id uuid NOT NULL REFERENCES public.models(id),
    color_id uuid NOT NULL REFERENCES public.colors(id),
    system_qty integer NOT NULL DEFAULT 0,
    counted_qty integer NOT NULL DEFAULT 0,
    difference integer NOT NULL DEFAULT 0,
    notes text
);

CREATE TABLE IF NOT EXISTS public.system_backups_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    filename text NOT NULL CONSTRAINT system_backups_log_filename_key UNIQUE,
    backup_type text NOT NULL DEFAULT 'full_system',
    total_records integer DEFAULT 0,
    file_size_bytes bigint DEFAULT 0,
    storage_path text,
    exported_by text DEFAULT 'system',
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- -------------------------------------------------------------------------
-- 7. RESET SYSTEM DATA PROCEDURE (WITH EXPLICIT SAFE WHERE CLAUSES)
-- -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_system_data()
RETURNS void AS $$
BEGIN
    IF public.get_my_role() <> 'owner' THEN
        RAISE EXCEPTION 'غير مصرح بك بتنفيذ هذه العملية.';
    END IF;

    DELETE FROM public.order_item_preparation WHERE true;
    DELETE FROM public.preparation_status_log WHERE true;
    DELETE FROM public.order_logs WHERE true;
    DELETE FROM public.order_items WHERE true;
    DELETE FROM public.orders WHERE true;
    DELETE FROM public.inbound_invoice_items WHERE true;
    DELETE FROM public.inbound_invoices WHERE true;
    DELETE FROM public.stock_movements WHERE true;
    DELETE FROM public.returns WHERE true;
    DELETE FROM public.return_items WHERE true;
    DELETE FROM public.system_notifications WHERE true;
    DELETE FROM public.inventory_audit_items WHERE true;
    DELETE FROM public.inventory_audits WHERE true;
    DELETE FROM public.invoice_items WHERE true;
    DELETE FROM public.invoices WHERE true;
    
    UPDATE public.model_inventory SET available_series = 0 WHERE true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================
-- 🎉 SAFE RESET PROCEDURE UPDATED SUCCESSFULLY
-- =========================================================================
