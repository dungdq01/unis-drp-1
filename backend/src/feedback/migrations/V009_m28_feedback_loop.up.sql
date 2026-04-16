-- ============================================================
-- Migration: V009_m28_feedback_loop.up.sql
-- Module: M28 — Feedback & Closed Loop
-- Description:
--   1. weekly_kpi_snapshot — wrapper run + KPI cache
--   2. sigma_history      — H1 v1.2 single source of truth σ_demand (M28→M23)
--   3. ss_adjustment_log  — SS adjust audit per (cn, sku, week)
--   4. lt_actual_log      — LT actual rolling per NM/route
--   5. override_analysis  — top 5 PO edit reasons per week
--   6. ALTER supplier ADD nm_unreliable_badge
--   7. Seeds: feature_flag + system_config
-- ============================================================

-- ─── 1. weekly_kpi_snapshot ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_kpi_snapshot (
  id                    BIGSERIAL      PRIMARY KEY,
  week_start_date       DATE           NOT NULL,
  status                VARCHAR(20)    NOT NULL DEFAULT 'RUNNING'
                          CHECK (status IN ('RUNNING','COMPLETED','COMPLETED_PARTIAL','FAILED')),
  step_errors           JSONB          NULL,           -- [{step, error}] when COMPLETED_PARTIAL
  fc_mape_pct           DECIMAL(7,4)   NULL,           -- Phase 1: NULL
  fill_rate_pct         DECIMAL(7,4)   NULL,
  lcnb_util_pct         DECIMAL(7,4)   NULL,
  transport_fill_avg    DECIMAL(5,4)   NULL,
  system_accuracy_pct   DECIMAL(7,4)   NULL,
  nm_honoring_avg_pct   DECIMAL(7,4)   NULL,
  total_po_count        INT            NOT NULL DEFAULT 0,
  edited_po_count       INT            NOT NULL DEFAULT 0,
  total_to_count        INT            NOT NULL DEFAULT 0,
  ss_adjustments_count  INT            NOT NULL DEFAULT 0,
  lt_updates_count      INT            NOT NULL DEFAULT 0,
  is_force_rerun        BOOLEAN        NOT NULL DEFAULT FALSE,
  force_rerun_reason    TEXT           NULL,
  created_by            VARCHAR(100)   NOT NULL DEFAULT 'CRON_WEEKLY',
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMP      NULL
);

-- Idempotency: 1 non-force snapshot per week
CREATE UNIQUE INDEX IF NOT EXISTS uq_weekly_snapshot_week
  ON weekly_kpi_snapshot (week_start_date)
  WHERE is_force_rerun = FALSE;

COMMENT ON TABLE weekly_kpi_snapshot IS 'M28: 1 row per week — pipeline run + KPI cache. Source of truth for dashboard.';

-- ─── 2. sigma_history (H1 v1.2) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sigma_history (
  id                    BIGSERIAL      PRIMARY KEY,
  cn_id                 BIGINT         NOT NULL,
  sku_id                BIGINT         NOT NULL,
  sigma_demand          DECIMAL(15,4)  NOT NULL,
  sample_size           INT            NOT NULL DEFAULT 0,
  source                VARCHAR(30)    NOT NULL DEFAULT 'M28_AUTO_WEEKLY'
                          CHECK (source IN ('M28_AUTO_WEEKLY','M28_MANUAL_RECOMPUTE','SEED')),
  confidence            VARCHAR(10)    NOT NULL DEFAULT 'LOW'
                          CHECK (confidence IN ('HIGH','LOW')),
  calculated_at         TIMESTAMP      NOT NULL DEFAULT NOW(),
  weekly_snapshot_id    BIGINT         NULL REFERENCES weekly_kpi_snapshot(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sigma_history_cn_sku_at
  ON sigma_history (cn_id, sku_id, calculated_at);

-- M23 nightly lookup: latest sigma per (cn, sku)
CREATE INDEX IF NOT EXISTS idx_sigma_history_lookup
  ON sigma_history (cn_id, sku_id, calculated_at DESC);

COMMENT ON TABLE sigma_history IS 'M28→M23: M28 publishes σ_demand weekly, M23 nightly reads latest per (cn,sku) and writes ss_cn.';

-- ─── 3. ss_adjustment_log ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ss_adjustment_log (
  id                    BIGSERIAL      PRIMARY KEY,
  weekly_snapshot_id    BIGINT         NOT NULL REFERENCES weekly_kpi_snapshot(id) ON DELETE CASCADE,
  cn_id                 BIGINT         NOT NULL,
  sku_id                BIGINT         NOT NULL,
  ss_old                DECIMAL(15,2)  NOT NULL,
  ss_new_uncapped       DECIMAL(15,2)  NOT NULL,
  ss_new_applied        DECIMAL(15,2)  NOT NULL,
  delta_pct             DECIMAL(7,4)   NOT NULL,
  is_capped             BOOLEAN        NOT NULL DEFAULT FALSE,
  sigma_old             DECIMAL(15,4)  NULL,
  sigma_new             DECIMAL(15,4)  NULL,
  trigger               VARCHAR(20)    NOT NULL DEFAULT 'AUTO_WEEKLY'
                          CHECK (trigger IN ('AUTO_WEEKLY','MANUAL_REFRESH')),
  calculated_at         TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ss_adj_snapshot ON ss_adjustment_log (weekly_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_ss_adj_cn_sku   ON ss_adjustment_log (cn_id, sku_id, calculated_at DESC);

COMMENT ON TABLE ss_adjustment_log IS 'M28: audit trail of SS auto-adjust per (cn, sku) per week.';

-- ─── 4. lt_actual_log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_actual_log (
  id                    BIGSERIAL      PRIMARY KEY,
  weekly_snapshot_id    BIGINT         NOT NULL REFERENCES weekly_kpi_snapshot(id) ON DELETE CASCADE,
  entity_type           VARCHAR(20)    NOT NULL CHECK (entity_type IN ('SUPPLIER','TRANSPORT_LANE')),
  entity_id             BIGINT         NULL,           -- nm_id or lane_id (nullable for string PK suppliers)
  entity_code           VARCHAR(100)   NULL,           -- supplier_code or "NM→CN" label
  route_label           VARCHAR(100)   NULL,
  lt_old_days           DECIMAL(5,2)   NOT NULL,
  lt_actual_avg_days    DECIMAL(5,2)   NOT NULL,
  lt_new_days           DECIMAL(5,2)   NULL,           -- NULL if drift-blocked
  sample_size           INT            NOT NULL DEFAULT 0,
  drift_pct             DECIMAL(7,4)   NOT NULL,
  action                VARCHAR(25)    NOT NULL
                          CHECK (action IN ('APPLIED','DRIFT_BLOCKED','DRIFT_FORCE_APPLY')),
  drift_count_after     INT            NOT NULL DEFAULT 0,
  calculated_at         TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_log_snapshot ON lt_actual_log (weekly_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_lt_log_entity   ON lt_actual_log (entity_code, calculated_at DESC);

COMMENT ON TABLE lt_actual_log IS 'M28: audit trail of LT rolling-avg update per NM/route per week.';

-- ─── 5. override_analysis ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS override_analysis (
  id                    BIGSERIAL      PRIMARY KEY,
  weekly_snapshot_id    BIGINT         NOT NULL REFERENCES weekly_kpi_snapshot(id) ON DELETE CASCADE,
  week_start_date       DATE           NOT NULL,
  top_reasons           JSONB          NOT NULL DEFAULT '[]',  -- [{reason, count, pct}]
  total_edits           INT            NOT NULL DEFAULT 0,
  total_pos             INT            NOT NULL DEFAULT 0,
  total_tos             INT            NOT NULL DEFAULT 0,
  system_accuracy_pct   DECIMAL(7,4)   NULL,
  field_breakdown       JSONB          NULL,           -- {qty: N, sku_added: N, sku_removed: N}
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_override_analysis_snapshot
  ON override_analysis (weekly_snapshot_id);

COMMENT ON TABLE override_analysis IS 'M28: top 5 PO/TO edit reasons per week for SC Manager review.';

-- ─── 6. transport_lane drift tracking ────────────────────────────────────────
-- nm_unreliable_badge already added by V007 (M26) — not repeated here

ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS lt_drift_count    INT       NOT NULL DEFAULT 0;
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS lt_drift_last_at  TIMESTAMP NULL;

-- ─── 7. Seeds ────────────────────────────────────────────────────────────────

INSERT INTO feature_flag (flag_name, enabled, description)
VALUES ('m28_feedback_loop_enabled', FALSE, 'M28 Feedback & Closed Loop (weekly Monday 06:00 VN)')
ON CONFLICT (flag_name) DO NOTHING;

INSERT INTO system_config (config_key, config_value, config_group, description)
VALUES
  ('feedback.ss_adjust_alert_threshold_pct', '20',   'FEEDBACK', 'M28 R2: SS delta > N% → WARNING alert'),
  ('feedback.ss_adjust_cap_pct',             '50',   'FEEDBACK', 'M28 R12: SS delta capped at N% per cycle'),
  ('feedback.fill_rate_alert_threshold',     '0.85', 'FEEDBACK', 'M28 R8: fill rate < N% 2 weeks → alert'),
  ('feedback.lt_drift_gate_pct',             '30',   'FEEDBACK', 'M28 R3: LT delta > N% → drift-blocked'),
  ('feedback.lt_min_sample_size',            '5',    'FEEDBACK', 'M28: min PO sample before applying LT update'),
  ('feedback.snapshot_retention_weeks',      '104',  'FEEDBACK', 'M28: retain weekly_kpi_snapshot N weeks before archive')
ON CONFLICT (config_key) DO NOTHING;
