-- ============================================================
-- Migration: V006_m25_transport_lot_sizing.down.sql
-- Module: M25 — rollback
-- ============================================================

ALTER TABLE allocation_result DROP CONSTRAINT IF EXISTS fk_alloc_result_top_up;
ALTER TABLE allocation_leg    DROP CONSTRAINT IF EXISTS fk_alloc_leg_top_up;

DROP INDEX IF EXISTS idx_top_up_trip_status;
DROP TABLE IF EXISTS top_up_suggestion CASCADE;

DROP INDEX IF EXISTS idx_trip_stop_trip;
DROP TABLE IF EXISTS transport_trip_stop CASCADE;

DROP INDEX IF EXISTS idx_supply_line_reserved_transport;
ALTER TABLE supply_snapshot_line
  DROP COLUMN IF EXISTS reserved_for_transport;

ALTER TABLE transport_trip_line
  DROP COLUMN IF EXISTS top_up_suggestion_id,
  DROP COLUMN IF EXISTS source_allocation_leg_id,
  DROP COLUMN IF EXISTS stop_id;

DROP INDEX IF EXISTS uq_transport_plan_no_force;
ALTER TABLE transport_plan DROP CONSTRAINT IF EXISTS fk_transport_plan_alloc_run;
ALTER TABLE transport_plan DROP CONSTRAINT IF EXISTS fk_transport_plan_policy_run;
ALTER TABLE transport_plan
  DROP COLUMN IF EXISTS avg_fill_ratio,
  DROP COLUMN IF EXISTS multi_drop_trips,
  DROP COLUMN IF EXISTS held_trips,
  DROP COLUMN IF EXISTS total_trips,
  DROP COLUMN IF EXISTS force_rerun_reason,
  DROP COLUMN IF EXISTS is_force_rerun,
  DROP COLUMN IF EXISTS policy_run_id,
  DROP COLUMN IF EXISTS allocation_run_id;

DROP INDEX IF EXISTS idx_trip_hold_release;
DROP INDEX IF EXISTS uq_transport_plan_alloc_run;

ALTER TABLE transport_trip DROP CONSTRAINT IF EXISTS check_trip_status;
ALTER TABLE transport_trip
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS allocation_run_id,
  DROP COLUMN IF EXISTS policy_run_id,
  DROP COLUMN IF EXISTS stop_count,
  DROP COLUMN IF EXISTS is_multi_drop,
  DROP COLUMN IF EXISTS held_at,
  DROP COLUMN IF EXISTS hold_reason,
  DROP COLUMN IF EXISTS hold_until_date,
  DROP COLUMN IF EXISTS hold_decision,
  DROP COLUMN IF EXISTS fill_ratio;

DELETE FROM feature_flag  WHERE flag_name = 'm25_transport_v2_enabled';
DELETE FROM system_config WHERE config_key IN (
  'transport.min_fill_ratio',
  'transport.hold_max_days',
  'transport.hold_buffer_days',
  'transport.max_multidrop_distance_km'
);
