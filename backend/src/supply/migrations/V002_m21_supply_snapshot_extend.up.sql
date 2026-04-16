-- ============================================================
-- Migration: V002_m21_supply_snapshot_extend.up.sql
-- Module: M21 — Data Sync & Freshness Gate
-- Description:
--   1. Extend supply_snapshot with nm_code, synced_at, source, is_legacy_data
--   2. Create sync_log table
--   3. Create drp_override_log table
--   4. Indexes for freshness gate queries
--   5. One-time backfill: mark all existing rows as legacy
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS
-- ============================================================

-- ─── Step 1: Extend supply_snapshot ──────────────────────────────────────────

ALTER TABLE supply_snapshot
  ADD COLUMN IF NOT EXISTS nm_code      VARCHAR(30)  NULL,
  ADD COLUMN IF NOT EXISTS synced_at    TIMESTAMP    NULL,
  ADD COLUMN IF NOT EXISTS source       VARCHAR(20)  NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS is_legacy_data BOOLEAN    NOT NULL DEFAULT FALSE;

-- Note: nm_code references supplier.supplier_code (VARCHAR PK per Sprint 1 schema).
-- nm_id BIGINT FK will be added Sprint 2 when supplier gets BIGSERIAL PK.
-- source ENUM values: NM_UPLOAD | MANUAL | ESTIMATED | FALLBACK | LEGACY

-- ─── Step 2: Backfill — mark existing rows as legacy (grace period) ───────────
-- Strategy per spec §6b:
--   - Set is_legacy_data = TRUE and synced_at = NOW() (NOT captured_at)
--   - synced_at = captured_at would make all old rows STALE immediately → block DRP
--   - Grace period: DevOps flips is_legacy_data = FALSE after 3 days production

UPDATE supply_snapshot
SET    is_legacy_data = TRUE,
       synced_at      = NOW(),
       source         = 'LEGACY'
WHERE  is_legacy_data = FALSE
  AND  nm_code IS NULL;

-- ─── Step 3: Create sync_log ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_log (
  id                 BIGSERIAL     PRIMARY KEY,
  nm_code            VARCHAR(30)   NOT NULL,
  trigger_source     VARCHAR(20)   NOT NULL CHECK (trigger_source IN ('CRON_06', 'CRON_14', 'MANUAL')),
  triggered_by_user  VARCHAR(100)  NULL,          -- NULL when CRON
  status             VARCHAR(20)   NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'PARTIAL')),
  rows_imported      INT           NOT NULL DEFAULT 0,
  error_msg          TEXT          NULL,
  started_at         TIMESTAMP     NOT NULL DEFAULT NOW(),
  completed_at       TIMESTAMP     NULL,
  CONSTRAINT fk_sync_log_supplier FOREIGN KEY (nm_code) REFERENCES supplier(supplier_code) ON DELETE RESTRICT
);

COMMENT ON TABLE sync_log IS 'M21: one row per NM sync attempt (cron or manual)';
COMMENT ON COLUMN sync_log.triggered_by_user IS 'NULL for CRON runs, userId for MANUAL';

-- ─── Step 4: Create drp_override_log ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS drp_override_log (
  id              BIGSERIAL     PRIMARY KEY,
  override_reason TEXT          NOT NULL,
  approved_by     VARCHAR(100)  NOT NULL,
  plan_run_id     VARCHAR(100)  NULL,           -- FK to plan_run when M23 exists
  stale_nms       JSONB         NULL,           -- snapshot of which NMs were stale
  created_at      TIMESTAMP     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE drp_override_log IS 'M21: audit trail for SC Manager DRP override (force run with stale data)';

-- ─── Step 5: Indexes ─────────────────────────────────────────────────────────

-- Gate query: max synced_at per NM (freshness check)
CREATE INDEX IF NOT EXISTS idx_supply_snapshot_nm_synced
  ON supply_snapshot (nm_code, synced_at DESC)
  WHERE nm_code IS NOT NULL;

-- Sync log: history per NM
CREATE INDEX IF NOT EXISTS idx_sync_log_nm_started
  ON sync_log (nm_code, started_at DESC);

-- Dashboard: latest sync per NM (covering index)
CREATE INDEX IF NOT EXISTS idx_sync_log_nm_status
  ON sync_log (nm_code, status, started_at DESC);
