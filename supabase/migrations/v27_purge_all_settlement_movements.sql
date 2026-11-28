-- =========================================================================
-- MIGRATION V27: PURGE ALL STORED SETTLEMENT DATA
-- =========================================================================
-- Description:
-- Removes all previously stored settlement rows ([SETTLEMENT]* and
-- periodic audit settlement rows 'تسوية%') from public.stock_movements.
-- Base Stock (الأصل) is strictly computed from Remaining + Real Sold only.
-- =========================================================================

BEGIN;

DELETE FROM public.stock_movements
WHERE reference ILIKE '%[SETTLEMENT]%'
   OR reference ILIKE 'تسوية%';

COMMIT;
