-- ============================================================
-- Migration: V003_m22_cn_demand_adjustment.down.sql
-- Module: M22 — rollback
-- WARNING: Drops 4 tables + audit log (data loss). Staging only.
-- CASCADE: forces drop of dependent FKs (cn_adjust_audit_log.adjustment_id,
--          future M23 policy_run references, etc.) — avoids partial rollback.
-- ============================================================

DROP TABLE IF EXISTS cn_demand_adjustment CASCADE;
DROP TABLE IF EXISTS cn_adjust_audit_log  CASCADE;
DROP TABLE IF EXISTS trust_score          CASCADE;
DROP TABLE IF EXISTS reason_code          CASCADE;

DELETE FROM feature_flag WHERE flag_name = 'm22_cn_demand_adjust_enabled';
