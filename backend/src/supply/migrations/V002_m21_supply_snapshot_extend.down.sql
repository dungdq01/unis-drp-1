-- ============================================================
-- Migration: V002_m21_supply_snapshot_extend.down.sql
-- Module: M21 — rollback
-- WARNING: Drops sync_log and drp_override_log tables (data loss).
--          Run only on staging. Production rollback requires manual data backup.
-- ============================================================

-- ─── Drop tables (M21-new) ───────────────────────────────────────────────────
DROP TABLE IF EXISTS drp_override_log;
DROP TABLE IF EXISTS sync_log;

-- ─── Remove indexes ───────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_sync_log_nm_status;
DROP INDEX IF EXISTS idx_sync_log_nm_started;
DROP INDEX IF EXISTS idx_supply_snapshot_nm_synced;

-- ─── Remove columns from supply_snapshot ─────────────────────────────────────
ALTER TABLE supply_snapshot
  DROP COLUMN IF EXISTS is_legacy_data,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS synced_at,
  DROP COLUMN IF EXISTS nm_code;
