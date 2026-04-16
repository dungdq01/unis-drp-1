-- ============================================================
-- Migration: V008_m27_po_review.up.sql
-- Module: M27 — PO/TO Review & Confirm (REBUILD)
-- Description:
--   1. po_run_pending      — AND correlation table (M25 + M26 event gate)
--   2. po_run              — run wrapper (status tracking)
--   3. po_header           — PO per NM × CN (R5 granularity)
--   4. po_line             — line per SKU, per-line grain (H4 fix)
--   5. to_header           — TO per donor × receiver CN (R6 separation)
--   6. to_line             — line per SKU
--   7. po_edit_log         — mandatory audit every edit (R7)
--   8. to_edit_log         — same for TO
--   9. po_tracking         — vehicle/carrier/ETA (R9/R10)
--  10. to_tracking         — same for TO
-- Idempotent: CREATE TABLE IF NOT EXISTS
-- ============================================================

-- ─── 1. po_run_pending (M1 CTO fix: AND correlation) ─────────────────────────

CREATE TABLE IF NOT EXISTS po_run_pending (
  allocation_run_id  BIGINT   PRIMARY KEY,
  m25_done           BOOLEAN  NOT NULL DEFAULT FALSE,
  m26_done           BOOLEAN  NOT NULL DEFAULT FALSE,
  transport_plan_id  BIGINT   NULL,
  atp_run_id         BIGINT   NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE po_run_pending IS 'M27: AND correlation gate — row created when M25 OR M26 done, deleted when both done and M27 triggered';

-- ─── 2. po_run ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS po_run (
  id                         BIGSERIAL    PRIMARY KEY,
  plan_run_id                BIGINT       NULL,
  allocation_run_id          BIGINT       NOT NULL,
  transport_plan_id          BIGINT       NULL,
  atp_run_id                 BIGINT       NULL,
  policy_run_id              BIGINT       NULL,
  status                     VARCHAR(25)  NOT NULL DEFAULT 'RUNNING'
                               CHECK (status IN ('RUNNING','COMPLETED','FAILED','BLOCKED_INCOMPLETE')),
  total_po_count             INT          NOT NULL DEFAULT 0,
  total_to_count             INT          NOT NULL DEFAULT 0,
  skipped_atp_fail_count     INT          NOT NULL DEFAULT 0,
  skipped_atp_blocked_count  INT          NOT NULL DEFAULT 0,
  clamped_atp_partial_count  INT          NOT NULL DEFAULT 0,
  variant_review_count       INT          NOT NULL DEFAULT 0,
  top_up_count               INT          NOT NULL DEFAULT 0,
  is_force_rerun             BOOLEAN      NOT NULL DEFAULT FALSE,
  force_rerun_reason         TEXT         NULL,
  created_by                 VARCHAR(100) NOT NULL DEFAULT 'SYSTEM',
  created_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at               TIMESTAMPTZ  NULL
);

-- Idempotent: primary run per allocation_run (R13)
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_run_primary
  ON po_run (allocation_run_id)
  WHERE is_force_rerun = FALSE;

COMMENT ON TABLE po_run IS 'M27: one row per M27 generate run triggered from M25+M26 AND event';
COMMENT ON COLUMN po_run.status IS 'BLOCKED_INCOMPLETE = NO_CARRIER hard gate (H2 fix: ATP FAIL/BLOCKED only skip cell)';

-- ─── 3. po_header ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS po_header (
  id               BIGSERIAL    PRIMARY KEY,
  po_run_id        BIGINT       NOT NULL REFERENCES po_run(id) ON DELETE RESTRICT,
  po_number        VARCHAR(50)  NOT NULL UNIQUE,
  nm_id            BIGINT       NOT NULL,
  cn_id            BIGINT       NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','CONFIRMED','SHIPPED','RECEIVED','CLOSED','CANCELLED')),
  total_qty        DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_value_vnd  DECIMAL(18,2) NOT NULL DEFAULT 0,  -- Phase 1: 0
  requested_eta    DATE         NULL,
  confirmed_at     TIMESTAMPTZ  NULL,
  confirmed_by     VARCHAR(100) NULL,
  cancelled_at     TIMESTAMPTZ  NULL,
  cancelled_by     VARCHAR(100) NULL,
  cancel_reason    TEXT         NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_header_run ON po_header(po_run_id);
CREATE INDEX IF NOT EXISTS idx_po_header_nm  ON po_header(nm_id, status);
CREATE INDEX IF NOT EXISTS idx_po_header_cn  ON po_header(cn_id, status);

COMMENT ON TABLE po_header IS 'M27: 1 PO = 1 NM → 1 CN (R5 granularity, not multi-CN)';

-- ─── 4. po_line ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS po_line (
  id                       BIGSERIAL     PRIMARY KEY,
  po_header_id             BIGINT        NOT NULL REFERENCES po_header(id) ON DELETE CASCADE,
  sku_id                   BIGINT        NOT NULL,
  variant_code             VARCHAR(60)   NULL,
  requested_qty            DECIMAL(15,2) NOT NULL DEFAULT 0,
  confirmed_qty            DECIMAL(15,2) NOT NULL DEFAULT 0,
  actual_received_qty      DECIMAL(15,2) NULL,
  unit_price_vnd           DECIMAL(15,2) NOT NULL DEFAULT 0,  -- Phase 1: 0
  source_allocation_leg_id BIGINT        NULL,  -- R15 lineage
  is_top_up                BOOLEAN       NOT NULL DEFAULT FALSE,  -- R16
  source_period_start      DATE          NULL,  -- R16: when is_top_up=TRUE
  requires_variant_review  BOOLEAN       NOT NULL DEFAULT FALSE,  -- R4 soft gate
  qty_exceeds_atp          BOOLEAN       NOT NULL DEFAULT FALSE,
  delivery_incomplete      BOOLEAN       NOT NULL DEFAULT FALSE,
  delivery_note            TEXT          NULL,
  status                   VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','CANCELLED')),
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- H5 CTO fix: NULL-safe UNIQUE (PG NULL != NULL allows dup base-SKU lines)
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_line
  ON po_line (po_header_id, sku_id, COALESCE(variant_code, ''));

CREATE INDEX IF NOT EXISTS idx_po_line_header ON po_line(po_header_id);
CREATE INDEX IF NOT EXISTS idx_po_line_sku    ON po_line(sku_id);

COMMENT ON COLUMN po_line.source_allocation_leg_id IS 'R15: trace to allocation_leg → DRP/alloc/transport chain';
COMMENT ON COLUMN po_line.is_top_up IS 'R16: from TOP_UP_NEXT_WEEK allocation_leg source_type';
COMMENT ON COLUMN po_line.requires_variant_review IS 'R4: from M24 planner_review_required flag, soft gate';

-- ─── 5. to_header ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS to_header (
  id               BIGSERIAL    PRIMARY KEY,
  po_run_id        BIGINT       NOT NULL REFERENCES po_run(id) ON DELETE RESTRICT,
  to_number        VARCHAR(50)  NOT NULL UNIQUE,
  donor_cn_id      BIGINT       NOT NULL,
  receiver_cn_id   BIGINT       NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','CONFIRMED','SHIPPED','RECEIVED','CLOSED','CANCELLED')),
  total_qty        DECIMAL(15,2) NOT NULL DEFAULT 0,
  requested_eta    DATE         NULL,
  confirmed_at     TIMESTAMPTZ  NULL,
  confirmed_by     VARCHAR(100) NULL,
  cancelled_at     TIMESTAMPTZ  NULL,
  cancelled_by     VARCHAR(100) NULL,
  cancel_reason    TEXT         NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_to_header_run      ON to_header(po_run_id);
CREATE INDEX IF NOT EXISTS idx_to_header_donor    ON to_header(donor_cn_id, status);
CREATE INDEX IF NOT EXISTS idx_to_header_receiver ON to_header(receiver_cn_id, status);

-- ─── 6. to_line ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS to_line (
  id                       BIGSERIAL     PRIMARY KEY,
  to_header_id             BIGINT        NOT NULL REFERENCES to_header(id) ON DELETE CASCADE,
  sku_id                   BIGINT        NOT NULL,
  variant_code             VARCHAR(60)   NULL,
  requested_qty            DECIMAL(15,2) NOT NULL DEFAULT 0,
  confirmed_qty            DECIMAL(15,2) NOT NULL DEFAULT 0,
  actual_received_qty      DECIMAL(15,2) NULL,
  source_allocation_leg_id BIGINT        NULL,
  requires_variant_review  BOOLEAN       NOT NULL DEFAULT FALSE,
  delivery_incomplete      BOOLEAN       NOT NULL DEFAULT FALSE,
  delivery_note            TEXT          NULL,
  status                   VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','CANCELLED')),
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_to_line
  ON to_line (to_header_id, sku_id, COALESCE(variant_code, ''));

CREATE INDEX IF NOT EXISTS idx_to_line_header ON to_line(to_header_id);

-- ─── 7. po_edit_log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS po_edit_log (
  id             BIGSERIAL     PRIMARY KEY,
  po_header_id   BIGINT        NOT NULL REFERENCES po_header(id) ON DELETE CASCADE,
  po_line_id     BIGINT        NULL REFERENCES po_line(id) ON DELETE SET NULL,
  field_changed  VARCHAR(50)   NOT NULL,  -- qty / variant / sku_added / sku_removed / cancel
  old_value      TEXT          NULL,      -- JSON serialized
  new_value      TEXT          NULL,
  reason         TEXT          NOT NULL,  -- mandatory (R7)
  changed_by     VARCHAR(100)  NOT NULL,
  changed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_edit_log_header ON po_edit_log(po_header_id, changed_at DESC);

-- ─── 8. to_edit_log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS to_edit_log (
  id             BIGSERIAL     PRIMARY KEY,
  to_header_id   BIGINT        NOT NULL REFERENCES to_header(id) ON DELETE CASCADE,
  to_line_id     BIGINT        NULL REFERENCES to_line(id) ON DELETE SET NULL,
  field_changed  VARCHAR(50)   NOT NULL,
  old_value      TEXT          NULL,
  new_value      TEXT          NULL,
  reason         TEXT          NOT NULL,
  changed_by     VARCHAR(100)  NOT NULL,
  changed_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_to_edit_log_header ON to_edit_log(to_header_id, changed_at DESC);

-- ─── 9. po_tracking ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS po_tracking (
  po_header_id     BIGINT        PRIMARY KEY REFERENCES po_header(id) ON DELETE CASCADE,
  vehicle_no       VARCHAR(20)   NULL,   -- mandatory when SHIPPED (R9)
  carrier_code     VARCHAR(20)   NULL,   -- mandatory when SHIPPED (R9)
  container_no     VARCHAR(30)   NULL,   -- mandatory when SHIPPED (R9)
  driver_name      VARCHAR(100)  NULL,
  driver_phone     VARCHAR(20)   NULL,
  nm_ship_date     DATE          NULL,
  actual_eta_date  DATE          NULL,   -- = nm_ship_date + transit_lt_days (computed)
  cn_received_date DATE          NULL,
  lt_actual_days   INT           NULL,   -- computed = received - ship
  updated_by       VARCHAR(100)  NULL,
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE po_tracking IS 'M27: 1-1 with po_header, stub inserted at CONFIRMED, filled at SHIPPED/RECEIVED';

-- ─── 10. to_tracking ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS to_tracking (
  to_header_id     BIGINT        PRIMARY KEY REFERENCES to_header(id) ON DELETE CASCADE,
  vehicle_no       VARCHAR(20)   NULL,
  carrier_code     VARCHAR(20)   NULL,
  container_no     VARCHAR(30)   NULL,
  donor_ship_date  DATE          NULL,
  actual_eta_date  DATE          NULL,
  receiver_recv_date DATE        NULL,
  lt_actual_days   INT           NULL,
  updated_by       VARCHAR(100)  NULL,
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── Sequences: race-safe PO/TO number generation (BUG-1 + H1 fix) ─────────

CREATE SEQUENCE IF NOT EXISTS po_number_seq START 1 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS to_number_seq START 1 INCREMENT 1;

COMMENT ON SEQUENCE po_number_seq IS 'M27: atomic PO number counter, format PO-YYYYMM-NNNNN';
COMMENT ON SEQUENCE to_number_seq IS 'M27: atomic TO number counter, format TO-YYYYMM-NNNNN';

-- ─── Seeds: feature flag + config keys ───────────────────────────────────────

-- BUG-M27-1 fix: must seed into feature_flag (not system_config) so FeatureFlagGuard resolves it
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES ('m27_po_rebuild_enabled', FALSE, 'M27 PO Review & Confirm (PO/TO generation after M25+M26)')
ON CONFLICT (flag_name) DO NOTHING;

INSERT INTO system_config (config_key, config_value, config_group, description)
VALUES
  ('po.overdue_days', '7', 'ORDER', 'M27: PO CONFIRMED > N days without SHIPPED → PO_OVERDUE alert (R12)')
ON CONFLICT (config_key) DO NOTHING;
