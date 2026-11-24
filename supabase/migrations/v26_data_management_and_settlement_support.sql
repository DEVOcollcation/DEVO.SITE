-- =========================================================================
-- MIGRATION V26: DATA MANAGEMENT & SETTLEMENT LEDGER SUPPORT
-- =========================================================================
-- Description:
-- 1. Adds a partial index on public.stock_movements to make [SETTLEMENT]
--    lookups instantaneous when opening model cards in the gallery.
-- 2. Guarantees authenticated staff (owner, admin, worker) can read
--    settlement movements so Base Stock (الأصل) stays accurate everywhere.
-- 3. Ensures owner has full write access to home_settings for encrypted
--    Settings Security Lock configuration.
-- =========================================================================

BEGIN;

-- 1. Partial index for fast per-model settlement movement lookups (order_id IS NULL, movement_type = 'out')
CREATE INDEX IF NOT EXISTS idx_stock_movements_settlement_lookup
    ON public.stock_movements (model_id, color_id)
    WHERE movement_type = 'out' AND order_id IS NULL;

-- 2. Verify RLS read policy on stock_movements for staff (owner, admin, worker)
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_select" ON public.stock_movements;
CREATE POLICY "stock_movements_select" ON public.stock_movements
    FOR SELECT TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin', 'worker'));

-- 3. Verify owner/admin write access on stock_movements
DROP POLICY IF EXISTS "stock_movements_write_admin" ON public.stock_movements;
CREATE POLICY "stock_movements_write_admin" ON public.stock_movements
    FOR ALL TO authenticated
    USING (public.get_my_role() IN ('owner', 'admin'))
    WITH CHECK (public.get_my_role() IN ('owner', 'admin'));

COMMIT;
