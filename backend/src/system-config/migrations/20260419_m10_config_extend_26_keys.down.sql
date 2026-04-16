-- ============================================================
-- Migration: 20260419_m10_config_extend_26_keys.down.sql
-- Description: Rollback M10 Extend — remove 26 system_config keys + 10 feature flags.
-- Safe: m00_* flags (seeded in 20260418_m00_feature_flags.up.sql) are NOT touched.
-- ============================================================

-- ─── Remove 26 M10 config keys ───────────────────────────────────────────────
DELETE FROM system_config WHERE config_key IN (
  -- GROUP 1: PLANNING
  'planning.max_stale_minutes',
  'planning.force_override_allowed',

  -- GROUP 2: LCNB
  'lcnb.enabled',
  'lcnb.max_distance_km',
  'lcnb.min_excess_threshold',
  'lcnb.max_transfer_pct',
  'lcnb.ss_reduction_pct',
  'lcnb.fifo_enabled',

  -- GROUP 3: TRUST SCORE
  'trust.window_weeks',
  'trust.accuracy_threshold_pct',
  'trust.auto_approve_threshold_pct',
  'trust.reduce_tolerance_threshold_pct',

  -- GROUP 4: CN ADJUSTMENT
  'cn_adjust.tolerance_pct',
  'cn_adjust.cutoff_time',
  'cn_adjust.reason_codes',

  -- GROUP 5: TRANSPORT
  'transport.min_fill_ratio',
  'transport.hold_max_days',
  'transport.hold_buffer_days',

  -- GROUP 6: FC COMMITMENT
  'commit.hard_tolerance_pct',
  'commit.firm_tolerance_pct',
  'commit.soft_tolerance_pct',
  'commit.gap_alert_day',
  'commit.gap_alert_pct',
  'commit.gap_escalate_day',
  'commit.gap_escalate_pct',

  -- GROUP 7: B2B PIPELINE
  'b2b.stage_prob'
);

-- ─── Remove 10 M11-M28 feature flags (keep m00_* intact) ─────────────────────
DELETE FROM feature_flag WHERE flag_name IN (
  'm11_demand_v2_enabled',
  'm12_saop_consensus_enabled',
  'm21_data_sync_v2_enabled',
  'm22_cn_demand_adjust_enabled',
  'm23_drp_netting_v2_enabled',
  'm24_allocation_lcnb_enabled',
  'm25_transport_v2_enabled',
  'm26_nm_atp_enabled',
  'm27_po_rebuild_enabled',
  'm28_feedback_loop_enabled'
);
