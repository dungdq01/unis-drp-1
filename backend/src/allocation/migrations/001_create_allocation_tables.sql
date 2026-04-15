-- Module 5: Allocation Engine — Migration
-- Run: psql -d unis_scp -f 001_create_allocation_tables.sql

BEGIN;

CREATE TABLE IF NOT EXISTS allocation_run (
    id                  BIGSERIAL       PRIMARY KEY,
    plan_run_id         BIGINT          NOT NULL REFERENCES plan_run(id),
    status              VARCHAR(20)     NOT NULL DEFAULT 'QUEUED',
      -- QUEUED | RUNNING | COMPLETED | FAILED
    total_orders        INT             NOT NULL DEFAULT 0,
    allocated_count     INT             NOT NULL DEFAULT 0,
    partial_count       INT             NOT NULL DEFAULT 0,
    unallocated_count   INT             NOT NULL DEFAULT 0,
    duration_ms         INT,
    created_by          VARCHAR(100),
    started_at          TIMESTAMP,
    completed_at        TIMESTAMP,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alloc_run_plan ON allocation_run(plan_run_id);
CREATE INDEX IF NOT EXISTS idx_alloc_run_status ON allocation_run(status);

CREATE TABLE IF NOT EXISTS allocation_result (
    id                  BIGSERIAL       PRIMARY KEY,
    allocation_run_id   BIGINT          NOT NULL REFERENCES allocation_run(id),
    planned_order_id    BIGINT          NOT NULL REFERENCES planned_order_release(id),
    item_code           VARCHAR(50)     NOT NULL,
    location_code       VARCHAR(20)     NOT NULL,   -- demand branch
    source_location     VARCHAR(20),                -- warehouse/branch supplying stock
    allocated_qty       NUMERIC(15,2)   NOT NULL DEFAULT 0,
    required_qty        NUMERIC(15,2)   NOT NULL DEFAULT 0,
    rtm_priority        INT,                        -- which RTM priority was used
    status              VARCHAR(20)     NOT NULL DEFAULT 'UNALLOCATED',
      -- ALLOCATED | PARTIAL | UNALLOCATED
    exception_code      VARCHAR(50),
      -- NO_SOURCE_AVAILABLE | QUALITY_UNAVAILABLE | INSUFFICIENT_STOCK
    exception_detail    TEXT,
    week_number         INT             NOT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alloc_result_run ON allocation_result(allocation_run_id);
CREATE INDEX IF NOT EXISTS idx_alloc_result_item ON allocation_result(item_code, location_code);
CREATE INDEX IF NOT EXISTS idx_alloc_result_status ON allocation_result(allocation_run_id, status);

COMMIT;
