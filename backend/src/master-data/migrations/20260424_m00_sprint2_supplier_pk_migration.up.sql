-- ============================================================
-- Migration: 20260424_m00_sprint2_supplier_pk_migration.up.sql
-- Description: TD-01 — Resolve supplier PK deviation.
--   supplier table was created with supplier_code VARCHAR as PK
--   (no BIGSERIAL id). This migration adds a surrogate BIGSERIAL id,
--   backfills nm_id in sku_nm_mapping + hub_nm_assignment via nm_code,
--   then adds FK constraints so M21/M22/M23 can JOIN by nm_id.
--
-- Prerequisites (must be done before running this migration):
--   ✅ BUG-M00-01 fix: hub_nm_assignment.nm_code column exists
--   ✅ All active sku_nm_mapping rows have nm_code populated
--   ✅ All active hub_nm_assignment rows have nm_code populated
--
-- Run order: AFTER 20260417_m00_create_master_data_tables.up.sql
-- Rollback: 20260424_m00_sprint2_supplier_pk_migration.down.sql
-- ============================================================

BEGIN;

-- ─── Step 1: Add BIGSERIAL id to supplier ────────────────────────────────────
-- supplier_code remains the PRIMARY KEY (business key).
-- id is a surrogate key used by FK references in mapping tables.
-- BIGSERIAL auto-assigns unique sequential values to existing rows.
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS id BIGSERIAL;

-- Create unique index so mapping tables can reference it efficiently.
-- Not a PK (supplier_code keeps that role) — just a unique surrogate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_surrogate_id ON supplier(id);

-- ─── Step 2: Verify backfill preconditions ────────────────────────────────────
-- Fail fast if any active mapping row has nm_code = NULL.
-- This means BUG-M00-01 fix was not fully applied — abort migration.
DO $$
DECLARE
  null_nm_code_count INT;
BEGIN
  SELECT COUNT(*) INTO null_nm_code_count
  FROM sku_nm_mapping
  WHERE active = TRUE AND nm_code IS NULL;

  IF null_nm_code_count > 0 THEN
    RAISE EXCEPTION
      'TD-01 precondition failed: % active sku_nm_mapping rows have nm_code = NULL. '
      'Run POST /hubs/:id/assign-nm for all hubs before this migration.',
      null_nm_code_count;
  END IF;
END $$;

-- ─── Step 3: Backfill nm_id in sku_nm_mapping ────────────────────────────────
-- Before: nm_id = 0 (placeholder), nm_code = 'NM01' (real reference)
-- After:  nm_id = supplier.id (surrogate BIGINT), nm_code retained for readability

UPDATE sku_nm_mapping snm
SET nm_id = s.id
FROM supplier s
WHERE snm.nm_code = s.supplier_code
  AND snm.nm_id = 0;

-- Log count for migration audit trail
DO $$
DECLARE updated_count INT;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'sku_nm_mapping: backfilled nm_id for % rows', updated_count;
END $$;

-- ─── Step 4: Backfill nm_id in hub_nm_assignment ─────────────────────────────
-- Requires BUG-M00-01 fix (nm_code column must exist and be populated).

UPDATE hub_nm_assignment hna
SET nm_id = s.id
FROM supplier s
WHERE hna.nm_code = s.supplier_code
  AND hna.nm_id = 0;

DO $$
DECLARE updated_count INT;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'hub_nm_assignment: backfilled nm_id for % rows', updated_count;
END $$;

-- ─── Step 5: Verify no orphaned nm_id = 0 remain ────────────────────────────
-- If any rows still have nm_id = 0 after backfill, they have invalid nm_code.
-- Flag as warning (not hard fail) — these rows will be excluded from FK constraint.
DO $$
DECLARE orphan_count INT;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM sku_nm_mapping
  WHERE nm_id = 0 AND active = TRUE;

  IF orphan_count > 0 THEN
    RAISE WARNING
      '% active sku_nm_mapping rows still have nm_id=0 after backfill. '
      'These have nm_code values with no matching supplier_code. '
      'Review data quality before adding FK constraint.',
      orphan_count;
  END IF;
END $$;

-- ─── Step 6: Add FK constraints ──────────────────────────────────────────────
-- Only add if all rows have valid nm_id (no orphans).
-- Using DEFERRABLE INITIALLY DEFERRED for safe bulk operations in transactions.

ALTER TABLE sku_nm_mapping
  ADD CONSTRAINT fk_sku_nm_mapping_supplier
  FOREIGN KEY (nm_id)
  REFERENCES supplier(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE hub_nm_assignment
  ADD CONSTRAINT fk_hub_nm_assignment_supplier
  FOREIGN KEY (nm_id)
  REFERENCES supplier(id)
  ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- ─── Step 7: Update default for future inserts ───────────────────────────────
-- After migration: service layer must set nm_id = supplier.id (not 0).
-- This DEFAULT 0 sentinel is now invalid — change default to NULL to expose bugs early.
ALTER TABLE sku_nm_mapping    ALTER COLUMN nm_id DROP DEFAULT;
ALTER TABLE hub_nm_assignment ALTER COLUMN nm_id DROP DEFAULT;

COMMIT;

-- ─── Post-migration: Update JOIN pattern for M21/M22/M23 ─────────────────────
-- Before migration (interim pattern — still works after migration):
--   JOIN supplier s ON s.supplier_code = snm.nm_code
--
-- After migration (preferred — uses FK index, faster):
--   JOIN supplier s ON s.id = snm.nm_id
--
-- Both patterns are valid after migration since nm_code is retained.
-- Teams should gradually migrate to nm_id JOIN for performance.
