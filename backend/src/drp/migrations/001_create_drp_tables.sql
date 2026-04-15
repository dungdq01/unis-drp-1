-- Module 4: DRP Netting — Migration
-- Run: psql -d unis_scp -f 001_create_drp_tables.sql
-- Verify FK tables first:
--   SELECT table_name FROM information_schema.tables
--   WHERE table_name IN ('demand_snapshot','supply_snapshot','item','location');
--   → Must return 4 rows

BEGIN;

CREATE TABLE IF NOT EXISTS plan_run (
    id                      BIGSERIAL       PRIMARY KEY,
    demand_snapshot_id      UUID            NOT NULL
                              REFERENCES demand_snapshot(snapshot_id),
    supply_snapshot_id      BIGINT          NOT NULL
                              REFERENCES supply_snapshot(id),
    status                  VARCHAR(20)     NOT NULL DEFAULT 'RUNNING',
      -- RUNNING | COMPLETED | FAILED | TIMEOUT
    planned_orders_count    INT             NOT NULL DEFAULT 0,
    exceptions_count        INT             NOT NULL DEFAULT 0,
    combinations_processed  INT             NOT NULL DEFAULT 0,
    duration_ms             INT,
    config_json             JSONB,
    created_by              VARCHAR(100),
    started_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMP,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS planned_order_release (
    id                  BIGSERIAL       PRIMARY KEY,
    plan_run_id         BIGINT          NOT NULL REFERENCES plan_run(id),
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    location_code       VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    week_number         INT             NOT NULL CHECK (week_number BETWEEN 1 AND 12),
    week_start_date     DATE            NOT NULL,
    beginning_inventory DECIMAL(15,2)   DEFAULT NULL,  -- week_number=1 only; weeks 2–12 = NULL
    gross_requirement   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    scheduled_receipt   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_before          DECIMAL(15,2)   NOT NULL,
    net_requirement     DECIMAL(15,2)   NOT NULL DEFAULT 0,
    planned_order_qty   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_after           DECIMAL(15,2)   NOT NULL,
    safety_stock        DECIMAL(15,2)   NOT NULL DEFAULT 0,
    hstk                DECIMAL(7,2),
    frozen_zone_flag    BOOLEAN         NOT NULL DEFAULT FALSE,
    status              VARCHAR(20)     NOT NULL DEFAULT 'AUTO_RELEASE',
      -- AUTO_RELEASE | NEEDS_APPROVAL | RELEASED | CANCELLED
    demand_basis        VARCHAR(20)     NOT NULL DEFAULT 'MAX_FORECAST_PO',
    is_estimated        BOOLEAN         NOT NULL DEFAULT FALSE,
    approved_by         VARCHAR(100),
    approved_at         TIMESTAMP,
    cancelled_by        VARCHAR(100),
    cancelled_at        TIMESTAMP,
    cancel_reason       TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_por UNIQUE (plan_run_id, item_code, location_code, week_number)
);

CREATE TABLE IF NOT EXISTS drp_exception (
    id                  BIGSERIAL       PRIMARY KEY,
    plan_run_id         BIGINT          NOT NULL REFERENCES plan_run(id),
    type                VARCHAR(50)     NOT NULL,
      -- PAB_NEGATIVE | STOCKOUT_ALERT | OVERSTOCK_ALERT
      -- FROZEN_ZONE_VIOLATION | MISSING_SS | NETTING_TIMEOUT
    severity            VARCHAR(10)     NOT NULL CHECK (severity IN ('HIGH','MEDIUM','LOW')),
    item_code           VARCHAR(50)     REFERENCES item(item_code),
    location_code       VARCHAR(20)     REFERENCES location(location_code),
    week_number         INT,
    detail_json         JSONB,
    message             TEXT            NOT NULL,
    resolved            BOOLEAN         NOT NULL DEFAULT FALSE,
    resolved_by         VARCHAR(100),
    resolved_at         TIMESTAMP,
    resolution_note     TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

-- Indexes: plan_run
CREATE INDEX IF NOT EXISTS idx_plan_run_status   ON plan_run(status);
CREATE INDEX IF NOT EXISTS idx_plan_run_created  ON plan_run(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_run_demand   ON plan_run(demand_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_plan_run_supply   ON plan_run(supply_snapshot_id);

-- Indexes: planned_order_release
CREATE INDEX IF NOT EXISTS idx_por_plan_run  ON planned_order_release(plan_run_id);
CREATE INDEX IF NOT EXISTS idx_por_item      ON planned_order_release(item_code);
CREATE INDEX IF NOT EXISTS idx_por_location  ON planned_order_release(location_code);
CREATE INDEX IF NOT EXISTS idx_por_status    ON planned_order_release(status);
CREATE INDEX IF NOT EXISTS idx_por_frozen    ON planned_order_release(frozen_zone_flag)
                                             WHERE frozen_zone_flag = TRUE;
CREATE INDEX IF NOT EXISTS idx_por_week      ON planned_order_release(plan_run_id, week_number);

-- Indexes: drp_exception
CREATE INDEX IF NOT EXISTS idx_exc_plan_run  ON drp_exception(plan_run_id);
CREATE INDEX IF NOT EXISTS idx_exc_type      ON drp_exception(plan_run_id, type);
CREATE INDEX IF NOT EXISTS idx_exc_resolved  ON drp_exception(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_exc_severity  ON drp_exception(severity, resolved);

COMMIT;
