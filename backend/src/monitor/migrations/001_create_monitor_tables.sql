-- ============================================================
-- Module 8 — Monitor & Learn
-- Migration: 001_create_monitor_tables.sql
-- Run once against unis_scp database (DA task)
-- Prerequisites: order_batch + order_line (M7), plan_run (M4), rtm_rule (M3)
-- ============================================================

BEGIN;

-- ── kpi_snapshot ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kpi_snapshot (
  id                BIGSERIAL       PRIMARY KEY,
  computed_at       TIMESTAMP       NOT NULL DEFAULT NOW(),
  period_type       VARCHAR(10)     NOT NULL DEFAULT 'WEEKLY',
    -- DAILY | WEEKLY | MONTHLY
  period_start      DATE            NOT NULL,
  period_end        DATE            NOT NULL,
  kpi_group         VARCHAR(30)     NOT NULL,
    -- SERVICE | WORKING_CAPITAL | TRUST | DECISION_SPEED | AI_VALUE | SUSTAINABILITY | DATA_QUALITY
  kpi_code          VARCHAR(50)     NOT NULL,
    -- HSTK_AVG | HSTK | PO_OVERDUE_COUNT | APPROVAL_SLA_HOURS | CANCEL_RATE
    -- DRP_CYCLE_TIME_HOURS | DATA_COMPLETENESS | CO2_TOTAL_KG | MAPE
  value             DECIMAL(18,4)   NOT NULL DEFAULT 0,
  target            DECIMAL(18,4),
  status            VARCHAR(20)     NOT NULL DEFAULT 'ON_TARGET',
    -- ON_TARGET | WARNING | CRITICAL | DISABLED | N_A
  item_code         VARCHAR(50),
    -- NULL = aggregate; non-null = per-SKU breakdown
  location_code     VARCHAR(20),
    -- NULL = aggregate; non-null = per-CN breakdown
  note              TEXT,
  computed_by       VARCHAR(100)
);

CREATE INDEX IF NOT EXISTS idx_kpi_snap_code   ON kpi_snapshot(kpi_code);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_period ON kpi_snapshot(period_start, period_type);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_loc    ON kpi_snapshot(location_code);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_item   ON kpi_snapshot(item_code);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_group  ON kpi_snapshot(kpi_group);

-- ── alert ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert (
  id                BIGSERIAL       PRIMARY KEY,
  alert_type        VARCHAR(50)     NOT NULL,
    -- STOCKOUT_RISK | OVERSTOCK | PO_OVERDUE | FILL_RATE_LOW |
    -- OVERRIDE_HIGH | MAPE_DEGRADED | SS_BREACH | DEMAND_DRIFT |
    -- DISTRIBUTION_SHIFT | ERP_SFTP_FAILED
  severity          VARCHAR(10)     NOT NULL DEFAULT 'WARNING',
    -- INFO | WARNING | CRITICAL
  title             VARCHAR(255)    NOT NULL,
  body              TEXT,
  item_code         VARCHAR(50),
  location_code     VARCHAR(20),
  ref_id            VARCHAR(100),
  ref_type          VARCHAR(50),
  channels_sent     VARCHAR(100)    NOT NULL DEFAULT 'SYSTEM',
  is_acknowledged   BOOLEAN         NOT NULL DEFAULT FALSE,
  acknowledged_by   VARCHAR(100),
  acknowledged_at   TIMESTAMP,
  created_at        TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_type ON alert(alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_sev  ON alert(severity);
CREATE INDEX IF NOT EXISTS idx_alert_ack  ON alert(is_acknowledged);
CREATE INDEX IF NOT EXISTS idx_alert_loc  ON alert(location_code);
CREATE INDEX IF NOT EXISTS idx_alert_item ON alert(item_code);
CREATE INDEX IF NOT EXISTS idx_alert_ts   ON alert(created_at DESC);

COMMIT;

-- ============================================================
-- DA verify after run:
-- SELECT tablename FROM pg_tables
-- WHERE tablename IN ('kpi_snapshot','alert')
-- ORDER BY tablename;
-- → expect 2 rows
--
-- Phase 2 tables (NOT in this migration):
--   drift_detection_log    — demand drift + PSI (needs actual_sales)
--   feedback_recommendation — 4 closed-loop feedback outputs
-- ============================================================
