-- ═══════════════════════════════════════════════════════════════════════════════
-- V007 — M26 NM ATP Check & Urgency Ranking
-- Sprint 5-7 | Owner: BE2
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── 0. Prerequisite — supply_snapshot_line.atp_qty (§11b C2/H4 CTO fix) ─────
-- M21 NM upload template already has atp_qty column in CSV but entity lacked it.
ALTER TABLE supply_snapshot_line
  ADD COLUMN IF NOT EXISTS atp_qty DECIMAL(15,2) NULL;

COMMENT ON COLUMN supply_snapshot_line.atp_qty IS
  'M26 §11b: Available-To-Promise qty from NM upload. NULL = NM did not upload ATP column → M26 fallback to allocatable_qty + is_atp_null_fallback flag.';

-- ─── 1. supplier — expose honoring_rate column (US-7/US-8 R8 H3) ─────────────
ALTER TABLE supplier
  ADD COLUMN IF NOT EXISTS nm_unreliable_badge BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN supplier.nm_unreliable_badge IS
  'M26 R8: TRUE when rolling_3m_rate < 80% threshold. Set by honoring-rate cron.';

-- ─── 2. atp_run — wrapper per allocation_run ─────────────────────────────────
CREATE TABLE IF NOT EXISTS atp_run (
  id                  BIGSERIAL PRIMARY KEY,
  allocation_run_id   BIGINT NOT NULL REFERENCES allocation_run(id),
  plan_run_id         BIGINT NOT NULL REFERENCES plan_run(id),
  policy_run_id       BIGINT REFERENCES policy_run(id),
  status              VARCHAR(20) NOT NULL DEFAULT 'RUNNING'
                        CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  -- Stats (H2 fix: blocked_count added, BLOCKED is cell-level not run-level)
  total_cells         INT NOT NULL DEFAULT 0,
  pass_count          INT NOT NULL DEFAULT 0,
  partial_count       INT NOT NULL DEFAULT 0,
  fail_count          INT NOT NULL DEFAULT 0,
  blocked_count       INT NOT NULL DEFAULT 0,
  critical_count      INT NOT NULL DEFAULT 0,
  -- Force rerun
  is_force_rerun      BOOLEAN NOT NULL DEFAULT FALSE,
  force_rerun_reason  TEXT,
  -- Audit
  created_by          VARCHAR(100) NOT NULL DEFAULT 'SYSTEM_NIGHTLY',
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMP,
  duration_ms         INT
);

-- R10 idempotency: 1 atp_run per allocation_run unless force rerun
CREATE UNIQUE INDEX IF NOT EXISTS uq_atp_run_no_force
  ON atp_run (allocation_run_id)
  WHERE is_force_rerun = FALSE;

-- ─── 3. atp_check — per (NM, SKU, week) result ───────────────────────────────
CREATE TABLE IF NOT EXISTS atp_check (
  id                    BIGSERIAL PRIMARY KEY,
  atp_run_id            BIGINT NOT NULL REFERENCES atp_run(id) ON DELETE CASCADE,
  allocation_run_id     BIGINT NOT NULL REFERENCES allocation_run(id),
  plan_run_id           BIGINT NOT NULL REFERENCES plan_run(id),
  policy_run_id         BIGINT REFERENCES policy_run(id),
  nm_id                 BIGINT NOT NULL REFERENCES supplier(id),
  sku_id                BIGINT NOT NULL REFERENCES sku(id),
  period_start          DATE NOT NULL,              -- Monday convention (M22/M23)
  requested_qty         DECIMAL(15,2) NOT NULL,
  atp_qty               DECIMAL(15,2),              -- NULL when BLOCKED or FAIL ZERO_STOCK
  -- Result (H1 CTO fix: BLOCKED ≠ FAIL; H6 fix: reason only for failure, not fallback)
  result                VARCHAR(15) NOT NULL
                          CHECK (result IN ('PASS','PARTIAL','FAIL','BLOCKED')),
  reason                VARCHAR(50),                -- STALE_DATA (BLOCKED) | ZERO_STOCK (FAIL) only
  is_atp_null_fallback  BOOLEAN NOT NULL DEFAULT FALSE,  -- H6 fix: warning flag, independent of reason
  -- Urgency ranking (PARTIAL only)
  urgency_ranking       JSONB,
  checked_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  -- Idempotent secondary key
  CONSTRAINT uq_atp_check_cell UNIQUE (atp_run_id, nm_id, sku_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_atp_check_run    ON atp_check (atp_run_id);
CREATE INDEX IF NOT EXISTS idx_atp_check_nm_sku ON atp_check (nm_id, sku_id, period_start);
CREATE INDEX IF NOT EXISTS idx_atp_check_result ON atp_check (result);

-- ─── 4. nm_honoring_rate — monthly metric (C4 CTO fix — rate = fulfilled/atp) ─
CREATE TABLE IF NOT EXISTS nm_honoring_rate (
  id                  BIGSERIAL PRIMARY KEY,
  nm_id               BIGINT NOT NULL REFERENCES supplier(id),
  period_month        DATE NOT NULL,               -- YYYY-MM-01
  -- C4 fix: denominator = atp_at_check_total (NM promise), NOT requested_total
  atp_at_check_total  DECIMAL(15,2),               -- Σ atp_qty for PASS+PARTIAL cells
  requested_total     DECIMAL(15,2),               -- Σ requested_qty (dashboard only)
  fulfilled_total     DECIMAL(15,2),               -- Σ actual_received from M27 PO; NULL Phase 1
  rate                DECIMAL(5,4),                -- C4: fulfilled/atp_at_check. NULL Phase 1
  rolling_3m_rate     DECIMAL(5,4),                -- H3 fix: 3-month rolling for threshold compare
  cell_count          INT NOT NULL DEFAULT 0,
  partial_count       INT NOT NULL DEFAULT 0,
  fail_count          INT NOT NULL DEFAULT 0,
  blocked_count       INT NOT NULL DEFAULT 0,
  calculated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_nm_honoring_rate UNIQUE (nm_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_nm_honoring_nm ON nm_honoring_rate (nm_id, period_month DESC);

-- ─── 5. Feature flag + config seed ───────────────────────────────────────────
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES ('m26_nm_atp_enabled', FALSE,
        'M26 NM ATP Check & Urgency Ranking (ATP gate before M27 PO generation)')
ON CONFLICT (flag_name) DO NOTHING;

-- M10 does NOT seed atp.* keys — all new, safe to insert here.
INSERT INTO system_config (config_key, config_value, config_group, description)
VALUES
  ('atp.staleness_threshold_hours',    '24',  'ATP', 'R3: hours since NM last sync before BLOCKED'),
  ('atp.honoring_warning_threshold',   '0.80','ATP', 'R8/H3: rolling 3-month rate < this → nm_unreliable_badge=TRUE (PRD 80%)')
ON CONFLICT (config_key) DO NOTHING;
