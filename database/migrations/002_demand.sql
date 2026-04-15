-- =============================================================================
-- Migration 002: Demand Module Tables — Smartlog SCP/DRP System (PRJ-SCP-001)
-- =============================================================================
-- Module:  Module 1 — Demand Snapshot & Forecast
-- Author:  R-DBE (Database Engineer)
-- Date:    2026-04-11
-- Depends: 001_master_data.sql (item, location tables)
--
-- Tables created:
--   1. demand_snapshot          — snapshot header (DRAFT → FROZEN → SUPERSEDED)
--   2. demand_snapshot_line     — aggregated demand per item/location/period
--   3. demand_forecast_detail   — raw 22-column DRP export data
--   4. demand_override_log      — audit trail for planner overrides
--
-- Key decisions:
--   D-MD-01: item PK = item_code VARCHAR(50), not UUID
--   D-MD-02: location PK = location_code VARCHAR(20), not UUID
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. demand_snapshot — snapshot header
-- ---------------------------------------------------------------------------
CREATE TABLE demand_snapshot (
    snapshot_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id              VARCHAR(64),                                -- e.g. "W9_20260406"
    status              VARCHAR(20) NOT NULL DEFAULT 'DRAFT',       -- DRAFT, FROZEN, SUPERSEDED
    demand_basis        VARCHAR(30) DEFAULT 'MAX_FORECAST_PO',
    total_lines         INTEGER DEFAULT 0,
    total_items         INTEGER DEFAULT 0,
    total_locations     INTEGER DEFAULT 0,
    frozen_at           TIMESTAMPTZ,
    frozen_by           VARCHAR(100),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_snapshot_status CHECK (status IN ('DRAFT', 'FROZEN', 'SUPERSEDED'))
);

-- ---------------------------------------------------------------------------
-- 2. demand_snapshot_line — aggregated demand per item/location/period
-- ---------------------------------------------------------------------------
CREATE TABLE demand_snapshot_line (
    line_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id         UUID NOT NULL REFERENCES demand_snapshot(snapshot_id),
    item_code           VARCHAR(50) NOT NULL,       -- FK to item(item_code)
    location_code       VARCHAR(20) NOT NULL,       -- FK to location(location_code)
    period_start        DATE NOT NULL,              -- first day of month
    qty                 DECIMAL(15,2) NOT NULL DEFAULT 0,
    reconciled_qty      DECIMAL(15,2),              -- after planner override
    demand_type         VARCHAR(20) DEFAULT 'FORECAST',
    segment             CHAR(1),                    -- A/B/C
    priority            INTEGER DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_snapshot_line UNIQUE (snapshot_id, item_code, location_code, period_start),
    CONSTRAINT fk_snapshot_line_item FOREIGN KEY (item_code) REFERENCES item(item_code),
    CONSTRAINT fk_snapshot_line_location FOREIGN KEY (location_code) REFERENCES location(location_code)
);

CREATE INDEX idx_dsl_snapshot ON demand_snapshot_line(snapshot_id);
CREATE INDEX idx_dsl_item ON demand_snapshot_line(item_code);
CREATE INDEX idx_dsl_location ON demand_snapshot_line(location_code);
CREATE INDEX idx_dsl_period ON demand_snapshot_line(period_start);

-- ---------------------------------------------------------------------------
-- 3. demand_forecast_detail — raw 22-column data from DRP export
-- ---------------------------------------------------------------------------
CREATE TABLE demand_forecast_detail (
    detail_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id         UUID REFERENCES demand_snapshot(snapshot_id),
    run_id              VARCHAR(64),
    forecast_date       VARCHAR(10) NOT NULL,       -- "2025-12", "2026-01"
    branch_id           VARCHAR(10),
    branch_name         VARCHAR(256),
    region              VARCHAR(64),
    fsku_id             VARCHAR(64) NOT NULL,
    item_code           VARCHAR(50),                -- mapped from fsku_id
    location_code       VARCHAR(20),                -- mapped from branch_id
    sku_name            VARCHAR(256),
    segment             CHAR(1),                    -- A/B/C
    model_config_id     VARCHAR(32),
    forecast_qty        DECIMAL(15,2) DEFAULT 0,
    reconciled_qty      DECIMAL(15,2) DEFAULT 0,
    scale_factor        DECIMAL(5,2) DEFAULT 1.0,
    tet_flag            CHAR(1),                    -- Y/N
    combo_class         VARCHAR(32),
    branch_archetype    VARCHAR(32),
    confidence_lower    DECIMAL(15,2),
    confidence_upper    DECIMAL(15,2),
    qty_sold_12m_avg    DECIMAL(15,2),
    qty_sold_3m_avg     DECIMAL(15,2),
    panel_months        INTEGER,
    last_nonzero_month  VARCHAR(10),
    data_cutoff         VARCHAR(10),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dfd_snapshot ON demand_forecast_detail(snapshot_id);
CREATE INDEX idx_dfd_fsku ON demand_forecast_detail(fsku_id);
CREATE INDEX idx_dfd_item ON demand_forecast_detail(item_code);
CREATE INDEX idx_dfd_lookup ON demand_forecast_detail(run_id, branch_id, fsku_id, forecast_date);

-- ---------------------------------------------------------------------------
-- 4. demand_override_log — audit trail for planner overrides
-- ---------------------------------------------------------------------------
CREATE TABLE demand_override_log (
    override_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id         UUID NOT NULL REFERENCES demand_snapshot(snapshot_id),
    line_id             UUID NOT NULL REFERENCES demand_snapshot_line(line_id),
    item_code           VARCHAR(50) NOT NULL,
    location_code       VARCHAR(20) NOT NULL,
    period_start        DATE NOT NULL,
    old_qty             DECIMAL(15,2) NOT NULL,
    new_qty             DECIMAL(15,2) NOT NULL,
    reason              TEXT NOT NULL,              -- mandatory per BR
    overridden_by       VARCHAR(100) NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dol_snapshot ON demand_override_log(snapshot_id);
CREATE INDEX idx_dol_line ON demand_override_log(line_id);

COMMIT;

-- =============================================================================
-- Rollback
-- =============================================================================
-- DROP TABLE IF EXISTS demand_override_log CASCADE;
-- DROP TABLE IF EXISTS demand_forecast_detail CASCADE;
-- DROP TABLE IF EXISTS demand_snapshot_line CASCADE;
-- DROP TABLE IF EXISTS demand_snapshot CASCADE;
