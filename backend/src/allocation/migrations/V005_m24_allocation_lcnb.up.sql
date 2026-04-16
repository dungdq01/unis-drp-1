-- ============================================================
-- Migration: V005_m24_allocation_lcnb.up.sql
-- Module: M24 — Allocation Engine LCNB v2
-- DA: DA1 · Sprint 5
-- ============================================================

-- ─── 1. allocation_run extend ────────────────────────────────────────────────
ALTER TABLE allocation_run
  ADD COLUMN IF NOT EXISTS policy_run_id            BIGINT       NULL,
  ADD COLUMN IF NOT EXISTS lcnb_enabled             BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS total_legs_count         INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lcnb_transfers_count     INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS partial_stockout_count   INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_force_rerun           BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS force_rerun_reason       TEXT         NULL;

-- Add FK to policy_run (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_alloc_run_policy_run'
  ) THEN
    ALTER TABLE allocation_run ADD CONSTRAINT fk_alloc_run_policy_run
      FOREIGN KEY (policy_run_id) REFERENCES policy_run(id) ON DELETE SET NULL;
  END IF;
END $$;

-- C4 idempotent guard #1: partial UNIQUE on plan_run_id excluding force reruns.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alloc_run_plan_run
  ON allocation_run (plan_run_id)
  WHERE is_force_rerun = FALSE;

-- ─── 2. allocation_result extend ─────────────────────────────────────────────
ALTER TABLE allocation_result
  ADD COLUMN IF NOT EXISTS planner_review_required  BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS review_reason            VARCHAR(50)  NULL,
  ADD COLUMN IF NOT EXISTS cn_id                    BIGINT       NULL,
  ADD COLUMN IF NOT EXISTS sku_id                   BIGINT       NULL,
  ADD COLUMN IF NOT EXISTS period_start             DATE         NULL,  -- H1 fix: week grain
  ADD COLUMN IF NOT EXISTS variant_breakdown        JSONB        NULL,  -- H2 fix: persist
  -- M25/M26/M27 cross-module contract for top-up (spec §6 + §7):
  -- M25 creates top-up legs AND a parallel allocation_result row flagged
  -- is_top_up=TRUE so downstream (M26 ATP, M27 PO Review) can filter by
  -- cell without joining allocation_leg.
  ADD COLUMN IF NOT EXISTS is_top_up                BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_top_up_id         BIGINT       NULL,   -- FK → top_up_suggestion.id (M25)
  ADD COLUMN IF NOT EXISTS source_period_start      DATE         NULL;   -- forecast week the top-up ships FROM

-- C3 fix: M5 legacy planned_order_id/week_number NOT NULL → M24 creates result
-- rows from drp_cn_line directly (no planned_order_release precursor). Relax
-- so M24 INSERT doesn't crash; keep legacy rows intact.
ALTER TABLE allocation_result ALTER COLUMN planned_order_id DROP NOT NULL;
ALTER TABLE allocation_result ALTER COLUMN week_number      SET DEFAULT 1;

-- Extend status enum by loosening the existing CHECK if any (spec adds
-- PARTIAL_STOCKOUT + FULL; existing ALLOCATED/PARTIAL/UNALLOCATED kept).
-- VARCHAR(20) column already; no migration needed for enum.

-- C4 idempotent guard #2: UNIQUE on (run, cn, sku) — prevents duplicate cells.
-- NULL cn_id/sku_id rows (legacy M5) are excluded by partial predicate.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alloc_result_cell
  ON allocation_result (allocation_run_id, cn_id, sku_id, period_start)
  WHERE cn_id IS NOT NULL AND sku_id IS NOT NULL;

-- Top-up filter hot path for M26 ATP reconciliation + M27 review queue.
CREATE INDEX IF NOT EXISTS idx_alloc_result_top_up
  ON allocation_result (allocation_run_id, is_top_up)
  WHERE is_top_up = TRUE;

-- ─── 3. allocation_leg extend (M25 C2 cross-link) ───────────────────────────
ALTER TABLE allocation_leg
  ADD COLUMN IF NOT EXISTS source_period_start  DATE    NULL,   -- top-up from another forecast week
  ADD COLUMN IF NOT EXISTS origin_top_up_id     BIGINT  NULL;   -- audit link → top_up_suggestion (M25)

-- Update CHECK constraint (drop+add to include TOP_UP_NEXT_WEEK)
ALTER TABLE allocation_leg DROP CONSTRAINT IF EXISTS check_source_type;
ALTER TABLE allocation_leg ADD CONSTRAINT check_source_type
  CHECK (source_type IN ('HUB', 'CN_REDIST', 'NM', 'TOP_UP_NEXT_WEEK', 'UNKNOWN'));

-- Hot path index: M25 iterates legs per allocation_run
CREATE INDEX IF NOT EXISTS idx_alloc_leg_run
  ON allocation_leg (allocation_result_id, source_type);

-- ─── 4. Feature flag + M10 config seed ───────────────────────────────────────
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES ('m24_allocation_lcnb_enabled', FALSE, 'M24 Allocation Engine LCNB v2')
ON CONFLICT (flag_name) DO NOTHING;

-- BUG-M24-2 fix: lcnb.* configs are OWNED by M10 migration
-- (20260419_m10_config_extend_26_keys.up.sql:18-23). M10 uses:
--   lcnb.enabled = 'DETECT_ONLY' (3-state: OFF | DETECT_ONLY | EXECUTE)
--   lcnb.max_transfer_pct = '80' (percent 0-100)
-- V005 must NOT re-seed — different value types would silently diverge after
-- ON CONFLICT DO NOTHING. Service code reads M10 values and normalizes them.
