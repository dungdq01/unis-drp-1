-- ============================================================
-- Migration: V004_m23_drp_netting_v2.up.sql
-- Module: M23 — DRP Netting v2 + Safety Stock CN
-- DA: DA1 · Sprint 4
-- ============================================================

-- ─── 1. Extend plan_run (M4 table) ───────────────────────────────────────────
ALTER TABLE plan_run
  ADD COLUMN IF NOT EXISTS policy_run_id      BIGINT       NULL,   -- Rule 14 baseline pin
  ADD COLUMN IF NOT EXISTS effective_demand_source JSONB   NULL,   -- {m22_count, fc_raw_count, m22_unavailable}
  ADD COLUMN IF NOT EXISTS is_stale_override  BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stale_override_reason TEXT      NULL,
  ADD COLUMN IF NOT EXISTS stale_override_by  VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS run_date           DATE         NULL;   -- YYYY-MM-DD for idempotent check

-- Extend status enum (VARCHAR, add new values via check constraint update)
-- Existing: RUNNING | COMPLETED | FAILED | TIMEOUT
-- New:       BLOCKED_STALE | FORCE_OVERRIDDEN (appended, backward-compatible)

-- BUG re-review C1/H2: BLOCKED_STALE rows are logged even when no valid
-- demand/supply snapshot exists (edge case: fresh system). Relax NOT NULL so
-- audit trail survives; main flow still populates them via subselects.
ALTER TABLE plan_run ALTER COLUMN demand_snapshot_id DROP NOT NULL;
ALTER TABLE plan_run ALTER COLUMN supply_snapshot_id DROP NOT NULL;

-- Idempotent index: 1 COMPLETED nightly run per day (R12).
-- G13 [spec §13] — force re-run bypasses by setting is_force_rerun=TRUE,
-- partial index excludes those rows so duplicate daily cron protection
-- stays intact while manual force re-runs are allowed.
ALTER TABLE plan_run
  ADD COLUMN IF NOT EXISTS is_force_rerun BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_run_date_completed
  ON plan_run (run_date)
  WHERE status = 'COMPLETED' AND is_force_rerun = FALSE;

-- ─── 2. policy_run (Rule 14 snapshot) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS policy_run (
  id                    BIGSERIAL     PRIMARY KEY,
  created_by            VARCHAR(100)  NOT NULL DEFAULT 'SYSTEM_NIGHTLY',
  config_snapshot       JSONB         NOT NULL,   -- M10 configs at run time
  master_data_snapshot  JSONB         NOT NULL,   -- sku_cn_mapping overrides + LT values
  note                  TEXT          NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE policy_run IS 'M23 Rule 14: immutable config snapshot per DRP run. M24/M25 read from this.';

-- FK plan_run → policy_run (deferred to after policy_run created)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_plan_run_policy_run'
  ) THEN
    ALTER TABLE plan_run ADD CONSTRAINT fk_plan_run_policy_run
      FOREIGN KEY (policy_run_id) REFERENCES policy_run(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── 3. ss_cn (Safety Stock per CN × SKU per run) ────────────────────────────
CREATE TABLE IF NOT EXISTS ss_cn (
  id                BIGSERIAL      PRIMARY KEY,
  plan_run_id       BIGINT         NOT NULL REFERENCES plan_run(id) ON DELETE CASCADE,
  cn_id             BIGINT         NOT NULL REFERENCES channel(id) ON DELETE RESTRICT,
  sku_id            BIGINT         NOT NULL REFERENCES sku(id)     ON DELETE RESTRICT,
  sigma_rolling     DECIMAL(15,4)  NOT NULL DEFAULT 0,
  sigma_seasonal    DECIMAL(15,4)  NULL,
  sigma_final       DECIMAL(15,4)  NOT NULL DEFAULT 0,
  z_used            DECIMAL(5,4)   NOT NULL DEFAULT 1.65,
  lt_hub_days       DECIMAL(5,2)   NOT NULL DEFAULT 0,
  ss_base           DECIMAL(15,2)  NOT NULL DEFAULT 0,
  lcnb_reduction_pct DECIMAL(5,2)  NOT NULL DEFAULT 0,
  ss_final          DECIMAL(15,2)  NOT NULL DEFAULT 0,
  source            VARCHAR(20)    NOT NULL DEFAULT 'FORMULA'
                      CHECK (source IN ('FORMULA','OVERRIDE_EXPLICIT','OVERRIDE_Z')),
  is_critical       BOOLEAN        NOT NULL DEFAULT FALSE,
  CONSTRAINT uq_ss_cn UNIQUE (plan_run_id, cn_id, sku_id)
);

CREATE INDEX IF NOT EXISTS idx_ss_cn_run ON ss_cn (plan_run_id, cn_id);

-- ─── 4. drp_cn_line (per-CN netting output) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS drp_cn_line (
  id                      BIGSERIAL      PRIMARY KEY,
  plan_run_id             BIGINT         NOT NULL REFERENCES plan_run(id) ON DELETE CASCADE,
  cn_id                   BIGINT         NOT NULL REFERENCES channel(id)  ON DELETE RESTRICT,
  sku_id                  BIGINT         NOT NULL REFERENCES sku(id)       ON DELETE RESTRICT,
  period_start            DATE           NOT NULL,
  effective_demand        DECIMAL(15,2)  NOT NULL DEFAULT 0,
  effective_demand_source VARCHAR(20)    NOT NULL DEFAULT 'FC_RAW'
                            CHECK (effective_demand_source IN ('M22_ADJUSTED','FC_RAW')),
  on_hand                 DECIMAL(15,2)  NOT NULL DEFAULT 0,
  in_transit              DECIMAL(15,2)  NOT NULL DEFAULT 0,
  ss_final                DECIMAL(15,2)  NOT NULL DEFAULT 0,
  net_demand              DECIMAL(15,2)  NOT NULL DEFAULT 0,
  status                  VARCHAR(20)    NOT NULL DEFAULT 'NORMAL'
                            CHECK (status IN ('NORMAL','OVER_STOCK','STOCKOUT_RISK')),
  variant_suggestion      JSONB          NULL,   -- Spec §7: {variantCode: qty}
  planner_review_required BOOLEAN        NOT NULL DEFAULT FALSE,  -- G7 [M4 fix]
  review_reason           VARCHAR(50)    NULL,                    -- e.g. 'NO_VARIANT_HISTORY'
  created_at              TIMESTAMP      NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_drp_cn_line UNIQUE (plan_run_id, cn_id, sku_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_drp_cn_line_run    ON drp_cn_line (plan_run_id, status);
CREATE INDEX IF NOT EXISTS idx_drp_cn_line_cn     ON drp_cn_line (plan_run_id, cn_id, period_start);
-- Hot path: M24 reads per (cn, sku)
CREATE INDEX IF NOT EXISTS idx_drp_cn_line_m24    ON drp_cn_line (plan_run_id, cn_id, sku_id);

-- ─── 5. Feature flag + configs (G11 + G2 floor) ──────────────────────────────
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES ('m23_drp_netting_v2_enabled', FALSE, 'M23 DRP Netting v2 + SS CN engine')
ON CONFLICT (flag_name) DO NOTHING;

-- BA re-review H3: system_config has no is_active column. Align with entity.
INSERT INTO system_config (config_key, config_value, config_group, description)
VALUES
  ('planning.min_ss_floor_pct',         '0.05', 'PLANNING',     'SS floor as %% of mean demand (σ≈0 guard)'),
  ('safety_stock.default_z_score',      '1.65', 'SAFETY_STOCK', 'Default z (95% CSL)'),
  ('safety_stock.lcnb_reduction_pct',   '25',   'SAFETY_STOCK', 'LCNB SS reduction % when enabled'),
  ('planning.snapshot_retention_days',  '90',   'PLANNING',     'policy_run/plan_run retention (Sprint 5 cleanup)')
ON CONFLICT (config_key) DO NOTHING;
