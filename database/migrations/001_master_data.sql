-- ============================================================
-- UNIS SCP — Migration 001: Master Data Tables
-- Created: 2026-04-13
-- Depends: (none — first migration)
-- ============================================================

BEGIN;

-- ── Item Master ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS item (
    item_code           VARCHAR(50) PRIMARY KEY,
    item_name           VARCHAR(500),
    category            VARCHAR(100),
    base_uom            VARCHAR(20) DEFAULT 'M2',
    brand               VARCHAR(100),
    factory_code        VARCHAR(20),
    variant             VARCHAR(50),           -- color_tail / size variant
    status              VARCHAR(20) DEFAULT 'ACT',
    shelf_life_months   INTEGER DEFAULT 0,
    external_sku        VARCHAR(100),          -- bravo_sku (ERP mapping)
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_item_status ON item(status);
CREATE INDEX idx_item_category ON item(category);
CREATE INDEX idx_item_brand ON item(brand);

-- ── Location Master ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS location (
    location_code       VARCHAR(20) PRIMARY KEY,
    location_name       VARCHAR(256),
    location_type       VARCHAR(20) NOT NULL,  -- WAREHOUSE, BRANCH, FACTORY, PULL_POINT
    parent_location_code VARCHAR(20),           -- warehouse for branch
    region              VARCHAR(64),
    channel             VARCHAR(20),            -- UNIS, UNIMAX, UNICHEMI, UNILUX, LOTINA
    corporation_id      VARCHAR(10),            -- 000=UNIS, 222=LOTINA
    capacity_pallets    INTEGER DEFAULT 1000,
    status              VARCHAR(20) DEFAULT 'ACTIVE',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_location_type ON location(location_type);
CREATE INDEX idx_location_region ON location(region);
CREATE INDEX idx_location_channel ON location(channel);

-- ── Supplier Master ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS supplier (
    supplier_code       VARCHAR(50) PRIMARY KEY,
    supplier_name       VARCHAR(256),
    lead_time_days      INTEGER DEFAULT 3,
    region              VARCHAR(64),
    factory_code        VARCHAR(20),
    status              VARCHAR(20) DEFAULT 'ACTIVE',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RTM Rule ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rtm_rule (
    rule_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    branch_code         VARCHAR(20) NOT NULL,   -- FK location(location_code)
    warehouse_code      VARCHAR(20) NOT NULL,   -- FK location(location_code)
    item_code           VARCHAR(50),            -- NULL = all items
    priority            INTEGER NOT NULL DEFAULT 1,
    transport_days      INTEGER DEFAULT 3,
    transport_mode      VARCHAR(20) DEFAULT 'ROAD',
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_rtm_branch FOREIGN KEY (branch_code) REFERENCES location(location_code),
    CONSTRAINT fk_rtm_warehouse FOREIGN KEY (warehouse_code) REFERENCES location(location_code)
);

CREATE INDEX idx_rtm_branch ON rtm_rule(branch_code);
CREATE INDEX idx_rtm_warehouse ON rtm_rule(warehouse_code);
CREATE INDEX idx_rtm_item ON rtm_rule(item_code);

-- ── Item-Location Config (ABC + SS) ─────────────────────────

CREATE TABLE IF NOT EXISTS item_location_config (
    config_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code           VARCHAR(50) NOT NULL REFERENCES item(item_code),
    location_code       VARCHAR(20) NOT NULL REFERENCES location(location_code),
    abc_class           CHAR(1),                -- A/B/C
    ss_target           DECIMAL(15,2) DEFAULT 0,
    dos_target_days     INTEGER,
    lead_time_days      INTEGER DEFAULT 3,
    reorder_point       DECIMAL(15,2),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_item_location UNIQUE (item_code, location_code)
);

CREATE INDEX idx_ilc_item ON item_location_config(item_code);
CREATE INDEX idx_ilc_location ON item_location_config(location_code);
CREATE INDEX idx_ilc_abc ON item_location_config(abc_class);

-- ── Planning Cycle ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS planning_cycle (
    cycle_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cutoff_time         TIME NOT NULL DEFAULT '23:00',
    run_frequency       VARCHAR(20) DEFAULT 'NIGHTLY',
    horizon_weeks       INTEGER DEFAULT 12,
    granularity         VARCHAR(20) DEFAULT 'WEEKLY',
    timezone            VARCHAR(50) DEFAULT 'Asia/Ho_Chi_Minh',
    freshness_threshold_minutes INTEGER DEFAULT 240,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;

-- ============================================================
-- Rollback:
-- DROP TABLE IF EXISTS planning_cycle CASCADE;
-- DROP TABLE IF EXISTS item_location_config CASCADE;
-- DROP TABLE IF EXISTS rtm_rule CASCADE;
-- DROP TABLE IF EXISTS supplier CASCADE;
-- DROP TABLE IF EXISTS location CASCADE;
-- DROP TABLE IF EXISTS item CASCADE;
-- ============================================================
