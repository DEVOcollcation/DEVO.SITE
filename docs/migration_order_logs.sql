-- Migration: Create order_logs table
-- This table tracks all status changes, locks, assignments, and modifications.

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

-- Index to optimize querying logs for a specific order
CREATE INDEX IF NOT EXISTS idx_order_logs_order_id ON public.order_logs(order_id);
