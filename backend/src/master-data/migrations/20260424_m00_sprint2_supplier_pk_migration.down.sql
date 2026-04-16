-- ============================================================
-- Rollback: 20260424_m00_sprint2_supplier_pk_migration.down.sql
-- Reverses supplier PK migration — use only if Sprint 2 migration
-- fails and must be rolled back completely.
-- ============================================================

BEGIN;

-- Remove FK constraints first
ALTER TABLE sku_nm_mapping    DROP CONSTRAINT IF EXISTS fk_sku_nm_mapping_supplier;
ALTER TABLE hub_nm_assignment DROP CONSTRAINT IF EXISTS fk_hub_nm_assignment_supplier;

-- Reset nm_id back to 0 placeholder
ALTER TABLE sku_nm_mapping    ALTER COLUMN nm_id SET DEFAULT 0;
ALTER TABLE hub_nm_assignment ALTER COLUMN nm_id SET DEFAULT 0;

UPDATE sku_nm_mapping    SET nm_id = 0 WHERE nm_id != 0;
UPDATE hub_nm_assignment SET nm_id = 0 WHERE nm_id != 0;

-- Remove surrogate index and column
DROP INDEX IF EXISTS idx_supplier_surrogate_id;
ALTER TABLE supplier DROP COLUMN IF EXISTS id;

COMMIT;
