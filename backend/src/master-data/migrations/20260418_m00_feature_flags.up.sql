-- ============================================================
-- Migration: 20260418_m00_feature_flags.up.sql
-- Description: TD-02 — Create feature_flag table so FeatureFlagService
--   reads from DB instead of process.env. Enables QA-18 toggle without
--   server restart.
--
-- When M10 SystemConfigService is built (Sprint 2+):
--   1. Migrate all rows to system_config table (M10 schema)
--   2. Swap FeatureFlagService injection in FeatureFlagGuard
--   3. DROP TABLE feature_flag (or keep as alias)
-- ============================================================

CREATE TABLE IF NOT EXISTS feature_flag (
  flag_name   VARCHAR(100) PRIMARY KEY,
  enabled     BOOLEAN      NOT NULL DEFAULT FALSE,
  description TEXT         DEFAULT NULL,
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_by  VARCHAR(100) DEFAULT 'migration'
);

-- Seed: M00 Master Data enabled by default
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES
  ('m00_master_data_enabled', TRUE,  'M00 Master Data Platform — SKU/Channel/Supplier/Hub CRUD + import'),
  ('m00_csv_import_enabled',  TRUE,  'M00 bulk CSV import endpoint (POST /import/:entityType)'),
  ('m00_audit_log_enabled',   TRUE,  'M00 audit log endpoint (GET /audit)')
ON CONFLICT (flag_name) DO NOTHING;
