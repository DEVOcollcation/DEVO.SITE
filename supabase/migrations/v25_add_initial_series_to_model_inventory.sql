-- ==============================================================================
-- Rollback / Reset: Remove initial_series if added
-- Reverts database back to standard schema
-- ==============================================================================

-- حذف عمود initial_series إذا كان قد تم إنشاؤه
ALTER TABLE public.model_inventory 
DROP COLUMN IF EXISTS initial_series;
