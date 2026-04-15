-- ============================================================
-- Module 7 — Order Bridge
-- Migration: 001_create_order_tables.sql
-- Run once against unis_scp database (DA task)
-- Prerequisites:
--   • transport_plan table must exist (Module 6)
--   • transport_trip table must exist (Module 6)
--   • allocation_result table must exist (Module 5)
-- ============================================================

BEGIN;

-- ── order_batch_seq (atomic sequence counter, no race condition) ──────────────
CREATE TABLE IF NOT EXISTS order_batch_seq (
    month_key   CHAR(6)  NOT NULL PRIMARY KEY,
      -- format: YYYYMM, e.g. '202604'
    last_seq    INT      NOT NULL DEFAULT 0
);

-- ── order_batch ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_batch (
    id                  BIGSERIAL    PRIMARY KEY,
    transport_plan_id   BIGINT       NOT NULL UNIQUE REFERENCES transport_plan(id),
    batch_code          VARCHAR(30)  NOT NULL UNIQUE,
      -- format: TO-YYYYMM-XXXX, e.g. TO-202604-0001
    status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
      -- DRAFT | SUBMITTED | APPROVED | EXPORTED | CANCELLED
    total_lines         INT          NOT NULL DEFAULT 0,
    total_qty           DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_value_vnd     DECIMAL(18,2) NOT NULL DEFAULT 0,
      -- sum of order_line.total_value_vnd (Phase 1: always 0)
    submitted_by        VARCHAR(100),
    submitted_at        TIMESTAMP,
    approved_by         VARCHAR(100),
    approved_at         TIMESTAMP,
    rejected_by         VARCHAR(100),
    rejected_at         TIMESTAMP,
    reject_reason       TEXT,
    exported_by         VARCHAR(100),
    exported_at         TIMESTAMP,
    note                TEXT,
    created_by          VARCHAR(100),
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_batch_plan   ON order_batch(transport_plan_id);
CREATE INDEX IF NOT EXISTS idx_order_batch_status ON order_batch(status);
CREATE INDEX IF NOT EXISTS idx_order_batch_code   ON order_batch(batch_code);

-- ── order_line ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_line (
    id                      BIGSERIAL    PRIMARY KEY,
    order_batch_id          BIGINT       NOT NULL REFERENCES order_batch(id),
    order_no                VARCHAR(40)  NOT NULL UNIQUE,
      -- format: {batch_code}-L{seq 4-digit}, e.g. TO-202604-0001-L0001
    order_type              VARCHAR(10)  NOT NULL DEFAULT 'TO',
      -- TO | SO | PO  (Phase 1: TO only)
    source_location_code    VARCHAR(20)  NOT NULL,
    dest_location_code      VARCHAR(20)  NOT NULL,
    item_code               VARCHAR(50)  NOT NULL,
    item_name               VARCHAR(500),
      -- snapshot từ item.item_name lúc generate, không join lại sau
    base_uom                VARCHAR(20)  NOT NULL DEFAULT 'M2',
    qty                     DECIMAL(15,2) NOT NULL DEFAULT 0,
    unit_price_vnd          DECIMAL(15,2) NOT NULL DEFAULT 0,
      -- Phase 1: để 0; Phase 2: từ price list
    total_value_vnd         DECIMAL(18,2) NOT NULL DEFAULT 0,
      -- = qty × unit_price_vnd
    departure_date          DATE,
      -- copy từ transport_trip.departure_date
    eta_date                DATE,
    carrier_code            VARCHAR(20),
    transport_trip_id       BIGINT       REFERENCES transport_trip(id),
    allocation_result_id    BIGINT       REFERENCES allocation_result(id),
    status                  VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
      -- ACTIVE | CANCELLED
    erp_ref                 VARCHAR(50),
      -- ERP document number sau khi sync (Phase 1: ghi thủ công)
    note                    TEXT,
    created_at              TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_line_batch  ON order_line(order_batch_id);
CREATE INDEX IF NOT EXISTS idx_order_line_item   ON order_line(item_code);
CREATE INDEX IF NOT EXISTS idx_order_line_source ON order_line(source_location_code);
CREATE INDEX IF NOT EXISTS idx_order_line_dest   ON order_line(dest_location_code);
CREATE INDEX IF NOT EXISTS idx_order_line_status ON order_line(status);
CREATE INDEX IF NOT EXISTS idx_order_line_erp    ON order_line(erp_ref) WHERE erp_ref IS NOT NULL;

COMMIT;

-- ============================================================
-- DA verify after run:
--
-- SELECT tablename FROM pg_tables
-- WHERE tablename IN ('order_batch','order_batch_seq','order_line')
-- ORDER BY tablename;
-- → expect 3 rows
--
-- Phase 2 scope (NOT in this migration):
--   • qty_original, qty_adjusted, adjust_reason columns (FR29)
--   • adjustment_report table (EX-009)
--   • cn_approved_by, mgr_approved_by columns (2-tier approval)
--   • PO overdue detection (EX-008, needs scheduler)
-- ============================================================
