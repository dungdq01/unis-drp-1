-- =============================================================================
-- Migration 002c: Demand Snapshot metadata columns + ARCHIVED status (G5 + G8)
-- =============================================================================
-- Fixes from MODULE-1-REVIEW.md:
--   G5: Add snapshot_name, source_type, forecast_file_name, horizon_start/end, created_by
--   G8: Status enum SUPERSEDED → ARCHIVED (spec 01-demand-ingestion.md §5)
-- =============================================================================

BEGIN;

-- G5: Metadata columns
ALTER TABLE demand_snapshot
  ADD COLUMN IF NOT EXISTS snapshot_name       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_type         VARCHAR(30)  DEFAULT 'CSV_UPLOAD',
  ADD COLUMN IF NOT EXISTS forecast_file_name  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS horizon_start       DATE,
  ADD COLUMN IF NOT EXISTS horizon_end         DATE,
  ADD COLUMN IF NOT EXISTS created_by          VARCHAR(100);

-- G8: Align status enum — SUPERSEDED → ARCHIVED
-- Step 1: migrate existing rows
UPDATE demand_snapshot SET status = 'ARCHIVED' WHERE status = 'SUPERSEDED';

-- Step 2: replace check constraint
ALTER TABLE demand_snapshot DROP CONSTRAINT IF EXISTS chk_snapshot_status;
ALTER TABLE demand_snapshot
  ADD CONSTRAINT chk_snapshot_status
  CHECK (status IN ('DRAFT', 'FROZEN', 'ARCHIVED'));

COMMIT;
