INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive)
VALUES
  -- PLANNING_CYCLE (6 rows)
  ('PLANNING_CYCLE', 'planning.cutoff_time',             '"23:00"',           'STRING',  'Nightly DRP cutoff (ICT)',                     false),
  ('PLANNING_CYCLE', 'planning.timezone',                '"Asia/Ho_Chi_Minh"','STRING',  'Timezone',                                     false),
  ('PLANNING_CYCLE', 'planning.horizon_weeks',           '12',                'NUMBER',  'DRP planning horizon (weeks)',                 false),
  ('PLANNING_CYCLE', 'planning.max_stale_minutes',       '240',               'NUMBER',  'Bravo batch mode — max data age before block', false),
  ('PLANNING_CYCLE', 'planning.cadence',                 '"NIGHTLY"',         'STRING',  'Run frequency',                               false),
  ('PLANNING_CYCLE', 'planning.force_override_allowed',  'true',              'BOOLEAN', 'Allow planner to bypass stale gate with audit',false),

  -- PLUGIN_PARAMS (11 rows)
  ('PLUGIN_PARAMS', 'plugin.csl_class_a',                '0.975',             'NUMBER',  'CSL Class A = 97.5% (z=1.96)',                false),
  ('PLUGIN_PARAMS', 'plugin.csl_class_b',                '0.95',              'NUMBER',  'CSL Class B = 95% (z=1.65)',                  false),
  ('PLUGIN_PARAMS', 'plugin.csl_class_c',                '0.90',              'NUMBER',  'CSL Class C = 90% (z=1.28)',                  false),
  ('PLUGIN_PARAMS', 'plugin.hstk_stockout_threshold',    '1.5',               'NUMBER',  'HSTK < 1.5w = STOCKOUT CRITICAL',             false),
  ('PLUGIN_PARAMS', 'plugin.hstk_overstock_threshold',   '3.0',               'NUMBER',  'HSTK > 3.0w = OVERSTOCK WARNING',             false),
  ('PLUGIN_PARAMS', 'plugin.lcnb_mode',                  '"DETECT_ONLY"',     'STRING',  'Lateral transfer: OFF/DETECT_ONLY/EXECUTE',   false),
  ('PLUGIN_PARAMS', 'plugin.lcnb_factor',                '0.25',              'NUMBER',  'SS reduction when EXECUTE mode (Phase 4)',    false),
  ('PLUGIN_PARAMS', 'plugin.horizon_weeks',              '12',                'NUMBER',  'DRP horizon used by engine',                  false),
  ('PLUGIN_PARAMS', 'plugin.lot_sizing',                 '"L4L"',             'STRING',  'Lot sizing method: L4L/MOQ',                  false),
  ('PLUGIN_PARAMS', 'plugin.planning_mode',              '"PUSH"',            'STRING',  'PUSH or PULL',                                false),
  ('PLUGIN_PARAMS', 'plugin.po_overdue_days',            '10',                'NUMBER',  'UNIS PO overdue threshold (not 7)',           false),

  -- FEATURE_TOGGLE (8 rows)
  ('FEATURE_TOGGLE', 'feature.lcnb.enabled',             '"DETECT_ONLY"',     'STRING',  'OFF/DETECT_ONLY/EXECUTE',                     false),
  ('FEATURE_TOGGLE', 'feature.adjustment_report.enabled','true',              'BOOLEAN', 'AdjustmentReport Phase 2',                    false),
  ('FEATURE_TOGGLE', 'feature.co2_tracking.enabled',     'false',             'BOOLEAN', 'CO2 module — Phase 3',                        false),
  ('FEATURE_TOGGLE', 'feature.mape_tracking.enabled',    'false',             'BOOLEAN', 'BLOCKED: actual_sales table pending',         false),
  ('FEATURE_TOGGLE', 'feature.email_alerts.enabled',     'false',             'BOOLEAN', 'SMTP email alerts — Phase 2',                 false),
  ('FEATURE_TOGGLE', 'feature.zalo_alerts.enabled',      'false',             'BOOLEAN', 'Zalo OA alerts — Phase 2',                    false),
  ('FEATURE_TOGGLE', 'feature.scheduled_kpi.enabled',    'false',             'BOOLEAN', 'pg_cron daily KPI — Phase 2',                false),
  ('FEATURE_TOGGLE', 'feature.bravo_sftp_push.enabled',  'false',             'BOOLEAN', 'Auto CSV push to Bravo — Phase 2',           false),

  -- BRAVO_ADAPTER (5 rows)
  ('BRAVO_ADAPTER', 'bravo.erp_target',                  '"BRAVO"',           'STRING',  'ERP system name',                             false),
  ('BRAVO_ADAPTER', 'bravo.timeout_seconds',             '8',                 'NUMBER',  'Per call timeout (seconds)',                  false),
  ('BRAVO_ADAPTER', 'bravo.retry_count',                 '3',                 'NUMBER',  'Max retry attempts',                          false),
  ('BRAVO_ADAPTER', 'bravo.retry_backoff',               '[1,4,16]',          'JSON',    'Exponential backoff (seconds)',                false),
  ('BRAVO_ADAPTER', 'bravo.failure_state',               '"MANUAL_POSTING"',  'STRING',  'Action on failure: MANUAL_POSTING alert',     false)

ON CONFLICT (config_group, config_key) DO NOTHING;
