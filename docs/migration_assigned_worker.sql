-- Migration: Add assigned_worker_id to orders table
-- This enables assigning orders to other workers/supervisors for editing.

ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS assigned_worker_id uuid REFERENCES public.system_users(id) ON DELETE SET NULL;

-- Create an index to optimize query performance for workers fetching their assigned orders
CREATE INDEX IF NOT EXISTS idx_orders_assigned_worker_id ON public.orders(assigned_worker_id);
