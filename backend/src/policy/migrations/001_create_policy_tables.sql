-- Migration: 001_create_policy_tables
-- Run: psql -d unis_scp -f 001_create_policy_tables.sql

BEGIN;

CREATE TABLE IF NOT EXISTS item_location_config (
    id                      BIGSERIAL       PRIMARY KEY,
    item_code               VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    location_code           VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    lead_time_days          INT             NOT NULL DEFAULT 5,
    lead_time_variability   DECIMAL(5,4)    NOT NULL DEFAULT 0.20,
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ilc UNIQUE (item_code, location_code)
);

CREATE TABLE IF NOT EXISTS policy_run (
    id                  BIGSERIAL       PRIMARY KEY,
    run_name            VARCHAR(200)    NOT NULL,
    status              VARCHAR(20)     NOT NULL DEFAULT 'DRAFT',
    demand_snapshot_id  UUID            NOT NULL REFERENCES demand_snapshot(snapshot_id),
    total_combinations  INT             NOT NULL DEFAULT 0,
    combinations_done   INT             NOT NULL DEFAULT 0,
    activated_by        VARCHAR(100),
    activated_at        TIMESTAMP,
    created_by          VARCHAR(100),
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS item_abc_classification (
    id                  BIGSERIAL       PRIMARY KEY,
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    abc_class           CHAR(1)         NOT NULL CHECK (abc_class IN ('A','B','C')),
    source              VARCHAR(30)     NOT NULL DEFAULT 'FORECAST_TEAM',
    snapshot_id         UUID            NOT NULL REFERENCES demand_snapshot(snapshot_id),
    annual_volume       DECIMAL(18,2),
    internal_class      CHAR(1)         CHECK (internal_class IN ('A','B','C')),
    discrepancy_flag    BOOLEAN         NOT NULL DEFAULT FALSE,
    effective_date      DATE            NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_abc_item_snapshot UNIQUE (item_code, snapshot_id)
);

CREATE TABLE IF NOT EXISTS safety_stock_target (
    id                  BIGSERIAL       PRIMARY KEY,
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    location_code       VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    policy_run_id       BIGINT          NOT NULL REFERENCES policy_run(id),
    abc_class           CHAR(1)         NOT NULL CHECK (abc_class IN ('A','B','C')),
    csl_target          DECIMAL(5,4)    NOT NULL,
    z_score             DECIMAL(5,3)    NOT NULL,
    lead_time_days      INT             NOT NULL,
    sigma_demand        DECIMAL(15,4)   NOT NULL,
    sigma_lt            DECIMAL(10,4)   NOT NULL,
    adu                 DECIMAL(15,4)   NOT NULL,
    ss_formula          DECIMAL(15,2)   NOT NULL,
    ss_dos_cap          DECIMAL(15,2)   NOT NULL,
    ss_final            INT             NOT NULL,
    dos_target          INT             NOT NULL,
    sigma_source        VARCHAR(20)     NOT NULL DEFAULT 'fc_error',
    lcnb_mode           VARCHAR(20)     NOT NULL DEFAULT 'DETECT_ONLY',
    lcnb_flag           BOOLEAN         NOT NULL DEFAULT FALSE,
    override_ss         INT,
    override_reason     TEXT,
    override_by         VARCHAR(100),
    override_at         TIMESTAMP,
    snapshot_id         UUID            NOT NULL REFERENCES demand_snapshot(snapshot_id),
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sst UNIQUE (item_code, location_code, policy_run_id)
);

CREATE TABLE IF NOT EXISTS rtm_rule (
    id                  BIGSERIAL       PRIMARY KEY,
    branch_code         VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    warehouse_code      VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    priority            INT             NOT NULL CHECK (priority IN (1,2,3)),
    transport_days      INT             NOT NULL DEFAULT 3,
    transport_cost      DECIMAL(10,2),
    min_order_qty       DECIMAL(15,2),
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rtm UNIQUE (branch_code, warehouse_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_abc_item_code ON item_abc_classification(item_code);
CREATE INDEX IF NOT EXISTS idx_abc_snapshot_id ON item_abc_classification(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_abc_class ON item_abc_classification(abc_class);
CREATE INDEX IF NOT EXISTS idx_abc_discrepancy ON item_abc_classification(discrepancy_flag) WHERE discrepancy_flag = TRUE;
CREATE INDEX IF NOT EXISTS idx_sst_item_code ON safety_stock_target(item_code);
CREATE INDEX IF NOT EXISTS idx_sst_location_code ON safety_stock_target(location_code);
CREATE INDEX IF NOT EXISTS idx_sst_policy_run ON safety_stock_target(policy_run_id);
CREATE INDEX IF NOT EXISTS idx_sst_abc_class ON safety_stock_target(abc_class);
CREATE INDEX IF NOT EXISTS idx_sst_lcnb_flag ON safety_stock_target(lcnb_flag) WHERE lcnb_flag = TRUE;
CREATE INDEX IF NOT EXISTS idx_rtm_branch ON rtm_rule(branch_code);
CREATE INDEX IF NOT EXISTS idx_rtm_warehouse ON rtm_rule(warehouse_code);
CREATE INDEX IF NOT EXISTS idx_rtm_priority ON rtm_rule(branch_code, priority) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ilc_item_code ON item_location_config(item_code);
CREATE INDEX IF NOT EXISTS idx_ilc_location_code ON item_location_config(location_code);
CREATE INDEX IF NOT EXISTS idx_policy_run_status ON policy_run(status);
CREATE INDEX IF NOT EXISTS idx_policy_run_created ON policy_run(created_at DESC);

COMMIT;
