-- ============================================================
-- Migration: V009_m28_feedback_loop.down.sql
-- Rollback: drop M28 tables in reverse dependency order
-- ============================================================

DROP TABLE IF EXISTS override_analysis    CASCADE;
DROP TABLE IF EXISTS lt_actual_log        CASCADE;
DROP TABLE IF EXISTS ss_adjustment_log    CASCADE;
DROP TABLE IF EXISTS sigma_history        CASCADE;
DROP TABLE IF EXISTS weekly_kpi_snapshot  CASCADE;

-- nm_unreliable_badge belongs to V007 (M26) — do NOT drop here
-- ALTER TABLE supplier DROP COLUMN IF EXISTS nm_unreliable_badge;

-- H2 fix columns added by V009
ALTER TABLE transport_lane DROP COLUMN IF EXISTS lt_drift_last_at;
ALTER TABLE transport_lane DROP COLUMN IF EXISTS lt_drift_count;

DELETE FROM feature_flag  WHERE flag_name  = 'm28_feedback_loop_enabled';
DELETE FROM system_config WHERE config_key IN (
  'feedback.ss_adjust_alert_threshold_pct',
  'feedback.ss_adjust_cap_pct',
  'feedback.fill_rate_alert_threshold',
  'feedback.lt_drift_gate_pct',
  'feedback.lt_min_sample_size',
  'feedback.snapshot_retention_weeks'
);
