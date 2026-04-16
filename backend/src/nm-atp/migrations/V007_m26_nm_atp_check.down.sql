-- V007 DOWN — M26 NM ATP Check rollback
DELETE FROM system_config WHERE config_key IN ('atp.staleness_threshold_hours','atp.honoring_warning_threshold');
DELETE FROM feature_flag WHERE flag_name = 'm26_nm_atp_enabled';

DROP TABLE IF EXISTS nm_honoring_rate CASCADE;
DROP TABLE IF EXISTS atp_check CASCADE;
DROP TABLE IF EXISTS atp_run CASCADE;

ALTER TABLE supplier DROP COLUMN IF EXISTS nm_unreliable_badge;
ALTER TABLE supply_snapshot_line DROP COLUMN IF EXISTS atp_qty;
