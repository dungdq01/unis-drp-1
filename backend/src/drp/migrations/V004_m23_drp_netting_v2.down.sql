-- ============================================================
-- Migration: V004_m23_drp_netting_v2.down.sql
-- Module: M23 — rollback
-- WARNING: Drops drp_cn_line, ss_cn, policy_run. Data loss. Staging only.
-- BUG-M23-3: CASCADE forces FK deps (child rows / constraints) so rollback
--            doesn't abort mid-way. BUG-M23-4: clean up feature_flag +
--            system_config seeds that up.sql inserted.
-- ============================================================

DROP TABLE IF EXISTS drp_cn_line CASCADE;
DROP TABLE IF EXISTS ss_cn       CASCADE;

-- Remove FK before dropping policy_run
ALTER TABLE plan_run DROP CONSTRAINT IF EXISTS fk_plan_run_policy_run;
DROP TABLE IF EXISTS policy_run  CASCADE;
DROP INDEX IF EXISTS uq_plan_run_date_completed;

-- Remove M23 columns from plan_run
ALTER TABLE plan_run
  DROP COLUMN IF EXISTS is_force_rerun,
  DROP COLUMN IF EXISTS run_date,
  DROP COLUMN IF EXISTS stale_override_by,
  DROP COLUMN IF EXISTS stale_override_reason,
  DROP COLUMN IF EXISTS is_stale_override,
  DROP COLUMN IF EXISTS effective_demand_source,
  DROP COLUMN IF EXISTS policy_run_id;

-- Restore NOT NULL on snapshot FKs (only safe if no BLOCKED_STALE orphan rows remain)
ALTER TABLE plan_run ALTER COLUMN demand_snapshot_id SET NOT NULL;
ALTER TABLE plan_run ALTER COLUMN supply_snapshot_id SET NOT NULL;

-- BUG-M23-4: remove seeds inserted by up.sql
DELETE FROM feature_flag WHERE flag_name = 'm23_drp_netting_v2_enabled';
DELETE FROM system_config WHERE config_key IN (
  'planning.min_ss_floor_pct',
  'safety_stock.default_z_score',
  'safety_stock.lcnb_reduction_pct',
  'planning.snapshot_retention_days'
);
