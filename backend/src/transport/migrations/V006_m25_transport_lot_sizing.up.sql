-- ============================================================
-- Migration: V006_m25_transport_lot_sizing.up.sql
-- Module: M25 — Transport Lot Sizing v2 (hold-or-ship + top-up + multi-drop)
-- DA: DA1 · Sprint 6
-- ============================================================

-- ─── 1. transport_trip extend (spec §7) ─────────────────────────────────────
ALTER TABLE transport_trip
  ADD COLUMN IF NOT EXISTS fill_ratio         DECIMAL(5,4) NULL,
  ADD COLUMN IF NOT EXISTS hold_decision      VARCHAR(25)  NULL,   -- SHIP | HOLD | FORCE_SHIP_LOW_FILL | FORCE_SHIP_TIMEOUT
  ADD COLUMN IF NOT EXISTS hold_until_date    DATE         NULL,
  ADD COLUMN IF NOT EXISTS hold_reason        TEXT         NULL,
  ADD COLUMN IF NOT EXISTS held_at            TIMESTAMP    NULL,
  ADD COLUMN IF NOT EXISTS is_multi_drop      BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stop_count         INT          NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS policy_run_id      BIGINT       NULL,
  ADD COLUMN IF NOT EXISTS allocation_run_id  BIGINT       NULL,  -- inherited from transport_plan but denormalized for fast query
  ADD COLUMN IF NOT EXISTS cancel_reason      TEXT         NULL;

-- Relax carrier_code tracking — extend status enum via CHECK (VARCHAR already)
-- Existing: PLANNED | NO_CARRIER | DISPATCHED | DELIVERED
-- New: HELD | CANCELLED | COMPLETED_PARTIAL

-- C4 fix: UNIQUE on (transport_plan_id, ...) — 1 plan per allocation_run
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_plan_alloc_run
  ON transport_plan (allocation_run_id)
  WHERE allocation_run_id IS NOT NULL;

-- Hot path: cron 06:00 held release
CREATE INDEX IF NOT EXISTS idx_trip_hold_release
  ON transport_trip (status, hold_until_date)
  WHERE status = 'HELD';

-- ─── 2. transport_plan extend (allocation_run_id + policy_run_id) ───────────
-- Drop legacy full UNIQUE on allocation_run_id — replaced by partial unique
-- (WHERE is_force_rerun = FALSE) so force re-runs are allowed.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'transport_plan'::regclass AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%allocation_run_id%'
  LOOP
    EXECUTE format('ALTER TABLE transport_plan DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE transport_plan
  ADD COLUMN IF NOT EXISTS allocation_run_id  BIGINT       NULL,
  ADD COLUMN IF NOT EXISTS policy_run_id      BIGINT       NULL,
  ADD COLUMN IF NOT EXISTS is_force_rerun     BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS force_rerun_reason TEXT         NULL,
  ADD COLUMN IF NOT EXISTS total_trips        INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS held_trips         INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multi_drop_trips   INT          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_fill_ratio     DECIMAL(5,4) NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_transport_plan_alloc_run') THEN
    ALTER TABLE transport_plan ADD CONSTRAINT fk_transport_plan_alloc_run
      FOREIGN KEY (allocation_run_id) REFERENCES allocation_run(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_transport_plan_policy_run') THEN
    ALTER TABLE transport_plan ADD CONSTRAINT fk_transport_plan_policy_run
      FOREIGN KEY (policy_run_id) REFERENCES policy_run(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Partial UNIQUE: 1 non-force transport_plan per allocation_run (R12 idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS uq_transport_plan_no_force
  ON transport_plan (allocation_run_id)
  WHERE is_force_rerun = FALSE AND allocation_run_id IS NOT NULL;

-- ─── 3. transport_trip_line extend (C3 line-to-stop mapping) ────────────────
ALTER TABLE transport_trip_line
  ADD COLUMN IF NOT EXISTS stop_id                   BIGINT  NULL,  -- FK transport_trip_stop (set after stops created)
  ADD COLUMN IF NOT EXISTS source_allocation_leg_id  BIGINT  NULL,
  ADD COLUMN IF NOT EXISTS top_up_suggestion_id      BIGINT  NULL;

-- Relax allocation_result_id NOT NULL if it was (top-up lines reference new result row, covered)
-- No change needed.

-- ─── 4. supply_snapshot_line reservation (C1 + C4, line-level) ──────────────
ALTER TABLE supply_snapshot_line
  ADD COLUMN IF NOT EXISTS reserved_for_transport DECIMAL(15,2) NOT NULL DEFAULT 0;

-- Hot path for reconcile cron 04:00
CREATE INDEX IF NOT EXISTS idx_supply_line_reserved_transport
  ON supply_snapshot_line (location_code, item_code)
  WHERE reserved_for_transport > 0;

-- ─── 5. transport_trip_stop (new — UNLOAD only Phase 1) ─────────────────────
CREATE TABLE IF NOT EXISTS transport_trip_stop (
  id               BIGSERIAL PRIMARY KEY,
  trip_id          BIGINT       NOT NULL REFERENCES transport_trip(id) ON DELETE CASCADE,
  stop_sequence    INT          NOT NULL,
  location_code    VARCHAR(20)  NOT NULL,
  pallets_at_stop  INT          NOT NULL DEFAULT 0,
  weight_kg_at_stop DECIMAL(10,2) NOT NULL DEFAULT 0,
  eta_at_stop      DATE         NULL,
  arrived_at       TIMESTAMP    NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_trip_stop_seq UNIQUE (trip_id, stop_sequence)
);

CREATE INDEX IF NOT EXISTS idx_trip_stop_trip
  ON transport_trip_stop (trip_id, stop_sequence);

-- ─── 6. top_up_suggestion (new — M4 audit fields) ───────────────────────────
CREATE TABLE IF NOT EXISTS top_up_suggestion (
  id                   BIGSERIAL    PRIMARY KEY,
  trip_id              BIGINT       NOT NULL REFERENCES transport_trip(id) ON DELETE CASCADE,
  item_code            VARCHAR(50)  NOT NULL,
  suggested_qty        DECIMAL(15,2) NOT NULL,
  estimated_pallets    INT          NOT NULL DEFAULT 0,
  estimated_weight_kg  DECIMAL(10,2) NOT NULL DEFAULT 0,
  reason               VARCHAR(100) NULL,
  priority_score       INT          NOT NULL DEFAULT 50,
  status               VARCHAR(15)  NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  reviewed_by          VARCHAR(100) NULL,
  reviewed_at          TIMESTAMP    NULL,
  -- M4 + H2 audit:
  source_period_start  DATE         NOT NULL,
  suggested_at         TIMESTAMP    NOT NULL DEFAULT NOW(),
  forecast_week_offset INT          NOT NULL DEFAULT 1,
  demand_source        VARCHAR(20)  NOT NULL DEFAULT 'FC_RAW',
  created_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_top_up_trip_status
  ON top_up_suggestion (trip_id, status);

-- FK from allocation_result.source_top_up_id → top_up_suggestion.id (M24 V005 added col, add FK now)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_alloc_result_top_up') THEN
    ALTER TABLE allocation_result ADD CONSTRAINT fk_alloc_result_top_up
      FOREIGN KEY (source_top_up_id) REFERENCES top_up_suggestion(id) ON DELETE SET NULL;
  END IF;
END $$;

-- FK from allocation_leg.origin_top_up_id
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'fk_alloc_leg_top_up') THEN
    ALTER TABLE allocation_leg ADD CONSTRAINT fk_alloc_leg_top_up
      FOREIGN KEY (origin_top_up_id) REFERENCES top_up_suggestion(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 7. Feature flag + config seed ──────────────────────────────────────────
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES ('m25_transport_v2_enabled', FALSE, 'M25 Transport Lot Sizing v2 (hold-or-ship + top-up + multi-drop)')
ON CONFLICT (flag_name) DO NOTHING;

-- transport.min_fill_ratio / hold_max_days / hold_buffer_days already seeded by M10
-- (20260419_m10_config_extend_26_keys). Only the M25-new key is added here.
INSERT INTO system_config (config_key, config_value, config_group, description)
VALUES
  ('transport.max_multidrop_distance_km', '200', 'TRANSPORT', 'H3: pairwise distance threshold for multi-drop grouping')
ON CONFLICT (config_key) DO NOTHING;

-- Status enum update via CHECK (defensive, VARCHAR allows any string)
ALTER TABLE transport_trip DROP CONSTRAINT IF EXISTS check_trip_status;
ALTER TABLE transport_trip ADD CONSTRAINT check_trip_status
  CHECK (status IN (
    'PLANNED', 'HELD', 'NO_CARRIER',
    'DISPATCHED', 'DELIVERED', 'CANCELLED'
  ));
