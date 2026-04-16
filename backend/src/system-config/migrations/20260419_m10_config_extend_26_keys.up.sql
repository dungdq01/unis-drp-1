-- ============================================================
-- Migration: 20260419_m10_config_extend_26_keys.up.sql
-- Description: M10 Extend — insert 26 new system_config keys (7 groups)
--              + seed 11 feature_flag rows for Rule 13 module flags.
-- Idempotent: ON CONFLICT DO NOTHING — safe to re-run.
-- ============================================================

-- ─── GROUP 1: PLANNING ────────────────────────────────────────────────────────
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive, updated_by)
VALUES
  ('PLANNING', 'planning.max_stale_minutes',     '1440',  'number',  'Số phút tối đa dữ liệu cũ được chấp nhận trước khi re-sync. Bounds: [1, 1440].', false, 'migration'),
  ('PLANNING', 'planning.force_override_allowed', 'false', 'boolean', 'SC Manager có thể force override plan khi hệ thống lock. true/false.', false, 'migration')
ON CONFLICT (config_key) DO NOTHING;

-- ─── GROUP 2: LCNB ────────────────────────────────────────────────────────────
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive, updated_by)
VALUES
  ('LCNB', 'lcnb.enabled',               'DETECT_ONLY', 'string',  'Chế độ LCNB: OFF | DETECT_ONLY | EXECUTE. Dùng bởi M23, M24.', false, 'migration'),
  ('LCNB', 'lcnb.max_distance_km',       '500',         'number',  'Khoảng cách tối đa (km) giữa CN dư và CN thiếu để kích hoạt LCNB. Bounds: [50, 2000].', false, 'migration'),
  ('LCNB', 'lcnb.min_excess_threshold',  '50',          'number',  'Số lượng dư tối thiểu (m²) để xem xét chuyển. Bounds: [1, 10000].', false, 'migration'),
  ('LCNB', 'lcnb.max_transfer_pct',      '80',          'number',  'Tỷ lệ tối đa (%) được phép chuyển từ tồn kho dư. Bounds: [0, 100].', false, 'migration'),
  ('LCNB', 'lcnb.ss_reduction_pct',      '25',          'number',  'Tỷ lệ giảm Safety Stock (%) khi LCNB execute thành công. Bounds: [0, 100].', false, 'migration'),
  ('LCNB', 'lcnb.fifo_enabled',          'true',        'boolean', 'Áp dụng FIFO khi chọn lot để chuyển. true/false.', false, 'migration')
ON CONFLICT (config_key) DO NOTHING;

-- ─── GROUP 3: TRUST SCORE ─────────────────────────────────────────────────────
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive, updated_by)
VALUES
  ('TRUST_SCORE', 'trust.window_weeks',                '12', 'number', 'Số tuần lịch sử để tính Trust Score. Bounds: [1, 52].', false, 'migration'),
  ('TRUST_SCORE', 'trust.accuracy_threshold_pct',      '20', 'number', 'Ngưỡng sai số (%) — vượt quá → giảm Trust Score. Bounds: [0, 100].', false, 'migration'),
  ('TRUST_SCORE', 'trust.auto_approve_threshold_pct',  '85', 'number', 'Điểm Trust Score (%) để auto-approve order. Bounds: [0, 100].', false, 'migration'),
  ('TRUST_SCORE', 'trust.reduce_tolerance_threshold_pct', '60', 'number', 'Điểm Trust Score (%) dưới ngưỡng → giảm tolerance. Bounds: [0, 100].', false, 'migration')
ON CONFLICT (config_key) DO NOTHING;

-- ─── GROUP 4: CN ADJUSTMENT ───────────────────────────────────────────────────
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive, updated_by)
VALUES
  ('CN_ADJUST', 'cn_adjust.tolerance_pct', '30',   'number', 'Biên độ điều chỉnh tối đa (%) CN có thể request so với kế hoạch. Bounds: [0, 100].', false, 'migration'),
  ('CN_ADJUST', 'cn_adjust.cutoff_time',   '"18:00"', 'string', 'Giờ cut-off (HH:MM) để nhận điều chỉnh trong ngày. Format: 24h.', false, 'migration'),
  ('CN_ADJUST', 'cn_adjust.reason_codes',  '["PROMOTION","SEASON","EVENT","COMPETITOR","OTHER"]', 'json', 'Danh sách reason codes hợp lệ khi CN điều chỉnh. JSON array of string.', false, 'migration')
ON CONFLICT (config_key) DO NOTHING;

-- ─── GROUP 5: TRANSPORT ───────────────────────────────────────────────────────
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive, updated_by)
VALUES
  ('TRANSPORT', 'transport.min_fill_ratio',  '0.6', 'number', 'Tỷ lệ fill tối thiểu để dispatch chuyến xe. Bounds: [0, 1].', false, 'migration'),
  ('TRANSPORT', 'transport.hold_max_days',   '2',   'number', 'Số ngày tối đa giữ hàng chờ fill đủ xe. Bounds: [0, 14].', false, 'migration'),
  ('TRANSPORT', 'transport.hold_buffer_days','1',   'number', 'Buffer ngày trước ETA để hold nếu cần re-route. Bounds: [0, 7].', false, 'migration')
ON CONFLICT (config_key) DO NOTHING;

-- ─── GROUP 6: FC COMMITMENT ───────────────────────────────────────────────────
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive, updated_by)
VALUES
  ('FC_COMMIT', 'commit.hard_tolerance_pct',   '5',  'number', 'Tolerance cứng (%) — vượt quá → reject tự động. Phải < firm. Bounds: [0, 100].', false, 'migration'),
  ('FC_COMMIT', 'commit.firm_tolerance_pct',   '15', 'number', 'Tolerance firm (%) — cần SC Manager approve. hard < firm < soft. Bounds: [0, 100].', false, 'migration'),
  ('FC_COMMIT', 'commit.soft_tolerance_pct',   '30', 'number', 'Tolerance mềm (%) — cảnh báo nhưng cho phép. Phải > firm. Bounds: [0, 100].', false, 'migration'),
  ('FC_COMMIT', 'commit.gap_alert_day',        '20', 'number', 'Ngày trong tháng bắt đầu alert gap. Phải < gap_escalate_day. Bounds: [1, 28].', false, 'migration'),
  ('FC_COMMIT', 'commit.gap_alert_pct',        '15', 'number', 'Gap (%) ngưỡng alert. Bounds: [0, 100].', false, 'migration'),
  ('FC_COMMIT', 'commit.gap_escalate_day',     '25', 'number', 'Ngày trong tháng escalate gap. Phải > gap_alert_day. Bounds: [1, 31].', false, 'migration'),
  ('FC_COMMIT', 'commit.gap_escalate_pct',     '10', 'number', 'Gap (%) ngưỡng escalate (nghiêm trọng hơn alert). Bounds: [0, 100].', false, 'migration')
ON CONFLICT (config_key) DO NOTHING;

-- ─── GROUP 7: B2B PIPELINE ────────────────────────────────────────────────────
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive, updated_by)
VALUES
  ('B2B_PIPELINE', 'b2b.stage_prob', '{"Lead":10,"Qualified":40,"Proposal":65,"Committed":85,"Confirmed":100,"Lost":0}',
   'json',
   'Xác suất convert (0-100) cho từng stage. Confirmed=100 và Lost=0 là cố định. Không cộng = 100. Dùng bởi M11.',
   false, 'migration')
ON CONFLICT (config_key) DO NOTHING;

-- ─── FEATURE FLAGS — 11 module flags (Rule 13) ───────────────────────────────
-- Bảng feature_flag đã tạo ở 20260418_m00_feature_flags.up.sql
-- Thêm 8 flags còn lại cho M11-M28 modules.
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES
  ('m11_demand_v2_enabled',       false, 'M11 Demand Planning v2 — B2B pipeline + weighted forecast'),
  ('m12_saop_consensus_enabled',  false, 'M12 S&OP Consensus — multi-stakeholder forecast alignment'),
  ('m21_data_sync_v2_enabled',    false, 'M21 Data Sync v2 — scheduled master data pull from ERP'),
  ('m22_cn_demand_adjust_enabled',false, 'M22 CN Demand Adjust — channel adjustment workflow'),
  ('m23_drp_netting_v2_enabled',  false, 'M23 DRP Netting v2 — LCNB-aware netting engine'),
  ('m24_allocation_lcnb_enabled', false, 'M24 Allocation LCNB — lateral cross-network balancing'),
  ('m25_transport_v2_enabled',    false, 'M25 Transport v2 — fill-ratio dispatch + routing'),
  ('m26_nm_atp_enabled',          false, 'M26 NM ATP — supplier available-to-promise check'),
  ('m27_po_rebuild_enabled',      false, 'M27 PO Rebuild — automated PO revision on DRP delta'),
  ('m28_feedback_loop_enabled',   false, 'M28 Feedback Loop — actual vs forecast drift auto-update')
ON CONFLICT (flag_name) DO NOTHING;

-- m00_master_data_enabled already seeded in 20260418_m00_feature_flags.up.sql
-- m00_csv_import_enabled already seeded
-- m00_audit_log_enabled already seeded
