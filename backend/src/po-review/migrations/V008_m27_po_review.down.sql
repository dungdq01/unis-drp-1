-- ============================================================
-- Migration: V008_m27_po_review.down.sql
-- Rollback: drop M27 tables in reverse dependency order
-- ============================================================

DROP TABLE IF EXISTS to_tracking      CASCADE;
DROP TABLE IF EXISTS po_tracking      CASCADE;
DROP TABLE IF EXISTS to_edit_log      CASCADE;
DROP TABLE IF EXISTS po_edit_log      CASCADE;
DROP TABLE IF EXISTS to_line          CASCADE;
DROP TABLE IF EXISTS to_header        CASCADE;
DROP TABLE IF EXISTS po_line          CASCADE;
DROP TABLE IF EXISTS po_header        CASCADE;
DROP TABLE IF EXISTS po_run           CASCADE;
DROP TABLE IF EXISTS po_run_pending   CASCADE;
DROP SEQUENCE IF EXISTS po_number_seq;
DROP SEQUENCE IF EXISTS to_number_seq;

DELETE FROM feature_flag  WHERE flag_name  = 'm27_po_rebuild_enabled';
DELETE FROM system_config WHERE config_key = 'po.overdue_days';
