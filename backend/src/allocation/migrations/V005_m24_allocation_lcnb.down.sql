-- ============================================================
-- Migration: V005_m24_allocation_lcnb.down.sql
-- Module: M24 — rollback
-- WARNING: Drops columns/indexes added by V005. Staging only.
-- ============================================================

DROP INDEX IF EXISTS idx_alloc_leg_run;

ALTER TABLE allocation_leg DROP CONSTRAINT IF EXISTS check_source_type;
ALTER TABLE allocation_leg ADD CONSTRAINT check_source_type
  CHECK (source_type IN ('HUB', 'CN_REDIST', 'NM', 'UNKNOWN'));

ALTER TABLE allocation_leg
  DROP COLUMN IF EXISTS origin_top_up_id,
  DROP COLUMN IF EXISTS source_period_start;

DROP INDEX IF EXISTS idx_alloc_result_top_up;
DROP INDEX IF EXISTS uq_alloc_result_cell;

-- Restore legacy NOT NULL (only safe if no M24 rows remain)
ALTER TABLE allocation_result ALTER COLUMN planned_order_id SET NOT NULL;

ALTER TABLE allocation_result
  DROP COLUMN IF EXISTS source_period_start,
  DROP COLUMN IF EXISTS source_top_up_id,
  DROP COLUMN IF EXISTS is_top_up,
  DROP COLUMN IF EXISTS variant_breakdown,
  DROP COLUMN IF EXISTS period_start,
  DROP COLUMN IF EXISTS sku_id,
  DROP COLUMN IF EXISTS cn_id,
  DROP COLUMN IF EXISTS review_reason,
  DROP COLUMN IF EXISTS planner_review_required;

DROP INDEX IF EXISTS uq_alloc_run_plan_run;
ALTER TABLE allocation_run DROP CONSTRAINT IF EXISTS fk_alloc_run_policy_run;

ALTER TABLE allocation_run
  DROP COLUMN IF EXISTS force_rerun_reason,
  DROP COLUMN IF EXISTS is_force_rerun,
  DROP COLUMN IF EXISTS partial_stockout_count,
  DROP COLUMN IF EXISTS lcnb_transfers_count,
  DROP COLUMN IF EXISTS total_legs_count,
  DROP COLUMN IF EXISTS lcnb_enabled,
  DROP COLUMN IF EXISTS policy_run_id;

DELETE FROM feature_flag  WHERE flag_name = 'm24_allocation_lcnb_enabled';
-- BUG-M24-2: lcnb.* configs OWNED by M10 migration — do NOT delete them on M24
-- rollback (would break M23/M24 if re-deployed).
