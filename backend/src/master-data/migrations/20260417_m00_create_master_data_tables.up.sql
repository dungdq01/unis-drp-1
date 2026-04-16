-- ============================================================
-- Migration: 20260417_m00_create_master_data_tables.up.sql
-- Description: M00 Master Data Platform — create all tables
--              matching TypeORM entity definitions exactly.
-- NOTE: supplier table already exists from M1-M10 with
--       supplier_code VARCHAR PK (deviation from spec BIGSERIAL).
--       This migration uses CREATE TABLE IF NOT EXISTS — safe to
--       run on both fresh DB and DB with existing M1-M10 tables.
-- ============================================================

-- ─── 1. SUPPLIER (M1-M10 existing schema — DO NOT RECREATE COLUMNS) ───────────
-- Table already exists in production with supplier_code VARCHAR PK.
-- Only add drift columns if not present (idempotent ALTER).
CREATE TABLE IF NOT EXISTS supplier (
  supplier_code    VARCHAR(30)  PRIMARY KEY,
  supplier_name    VARCHAR(200) NOT NULL,
  lead_time_days   INT          DEFAULT NULL,
  region           VARCHAR(50)  DEFAULT NULL,
  factory_code     VARCHAR(50)  DEFAULT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS lt_drift_count  INT       NOT NULL DEFAULT 0;
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS lt_drift_last_at TIMESTAMP DEFAULT NULL;

-- ─── 2. CHANNEL (CN) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel (
  id               BIGSERIAL    PRIMARY KEY,
  cn_code          VARCHAR(20)  NOT NULL UNIQUE,
  cn_name          VARCHAR(200) NOT NULL,
  region           VARCHAR(50)  DEFAULT NULL,
  address          TEXT         DEFAULT NULL,
  lat              DECIMAL(10,6) NOT NULL,
  lng              DECIMAL(10,6) NOT NULL,
  manager_user_id  BIGINT       DEFAULT NULL,
  connectivity     VARCHAR(10)  NOT NULL DEFAULT 'GOOD',
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ─── 3. SKU ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sku (
  id               BIGSERIAL    PRIMARY KEY,
  sku_code         VARCHAR(50)  NOT NULL UNIQUE,
  sku_name         VARCHAR(200) NOT NULL,
  uom              VARCHAR(20)  NOT NULL DEFAULT 'm2',
  product_group    VARCHAR(50)  DEFAULT NULL,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  created_by       VARCHAR(100) DEFAULT NULL,
  updated_by       VARCHAR(100) DEFAULT NULL
);

-- ─── 4. SKU_VARIANT ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sku_variant (
  id               BIGSERIAL    PRIMARY KEY,
  sku_id           BIGINT       NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  variant_code     VARCHAR(60)  NOT NULL,
  variant_suffix   VARCHAR(10)  NOT NULL,
  variant_name     VARCHAR(200) DEFAULT NULL,
  attrs            JSONB        DEFAULT NULL,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE (sku_id, variant_code)
);

-- ─── 5. HUB ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hub (
  id               BIGSERIAL    PRIMARY KEY,
  hub_code         VARCHAR(30)  NOT NULL UNIQUE,
  hub_name         VARCHAR(200) NOT NULL,
  hub_type         VARCHAR(10)  NOT NULL DEFAULT 'VIRTUAL',
  lat              DECIMAL(10,6) DEFAULT NULL,
  lng              DECIMAL(10,6) DEFAULT NULL,
  capacity         DECIMAL(15,2) DEFAULT NULL,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ─── 6. CUSTOMER ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer (
  id               BIGSERIAL    PRIMARY KEY,
  customer_code    VARCHAR(50)  NOT NULL UNIQUE,
  customer_name    VARCHAR(200) NOT NULL,
  contact_email    VARCHAR(200) DEFAULT NULL,
  contact_phone    VARCHAR(20)  DEFAULT NULL,
  customer_type    VARCHAR(20)  NOT NULL DEFAULT 'B2B',
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ─── 7. SKU_NM_MAPPING (SKU ↔ Supplier, single-source rule) ──────────────────
-- nm_id is a placeholder BIGINT (0) — real FK is nm_code → supplier.supplier_code
-- (supplier PK deviation: VARCHAR not BIGSERIAL, see Sprint 2 migration plan)
CREATE TABLE IF NOT EXISTS sku_nm_mapping (
  id               BIGSERIAL    PRIMARY KEY,
  sku_id           BIGINT       NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  nm_id            BIGINT       NOT NULL DEFAULT 0,
  nm_code          VARCHAR(30)  DEFAULT NULL,
  moq              DECIMAL(15,2) NOT NULL DEFAULT 0,
  priority         INT          NOT NULL DEFAULT 1,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);
-- Partial unique: only 1 active mapping per SKU (single-source rule)
CREATE UNIQUE INDEX IF NOT EXISTS uq_sku_single_nm
  ON sku_nm_mapping(sku_id)
  WHERE active = TRUE;

-- ─── 8. SKU_CN_MAPPING (SKU ↔ Channel distribution) ─────────────────────────
CREATE TABLE IF NOT EXISTS sku_cn_mapping (
  id               BIGSERIAL    PRIMARY KEY,
  sku_id           BIGINT       NOT NULL REFERENCES sku(id)     ON DELETE CASCADE,
  cn_id            BIGINT       NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  ss_override      DECIMAL(15,2) DEFAULT NULL,
  z_override       DECIMAL(5,4)  DEFAULT NULL,
  is_critical      BOOLEAN      NOT NULL DEFAULT FALSE,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (sku_id, cn_id)
);

-- ─── 9. HUB_CN_CLUSTER (Hub ↔ Channel geographic cluster) ───────────────────
CREATE TABLE IF NOT EXISTS hub_cn_cluster (
  id               BIGSERIAL    PRIMARY KEY,
  hub_id           BIGINT       NOT NULL REFERENCES hub(id)     ON DELETE CASCADE,
  cn_id            BIGINT       NOT NULL REFERENCES channel(id) ON DELETE CASCADE,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (hub_id, cn_id)
);

-- ─── 10. HUB_NM_ASSIGNMENT (Hub ↔ Supplier assignment) ──────────────────────
-- nm_id placeholder (supplier PK deviation) — uses nm_code in practice
CREATE TABLE IF NOT EXISTS hub_nm_assignment (
  id               BIGSERIAL    PRIMARY KEY,
  hub_id           BIGINT       NOT NULL REFERENCES hub(id) ON DELETE CASCADE,
  nm_id            BIGINT       NOT NULL DEFAULT 0,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (hub_id, nm_id)
);

-- ─── 11. CUSTOMER_CN (Customer ↔ Channel link) ───────────────────────────────
CREATE TABLE IF NOT EXISTS customer_cn (
  id               BIGSERIAL    PRIMARY KEY,
  customer_id      BIGINT       NOT NULL REFERENCES customer(id) ON DELETE CASCADE,
  cn_id            BIGINT       NOT NULL REFERENCES channel(id)  ON DELETE CASCADE,
  is_primary       BOOLEAN      NOT NULL DEFAULT FALSE,
  active           BOOLEAN      NOT NULL DEFAULT TRUE,
  UNIQUE (customer_id, cn_id)
);
-- Only 1 primary channel per customer
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_primary_cn
  ON customer_cn(customer_id)
  WHERE is_primary = TRUE AND active = TRUE;

-- ─── 12. MASTER_DATA_AUDIT_LOG ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS master_data_audit_log (
  id               BIGSERIAL    PRIMARY KEY,
  entity_type      VARCHAR(30)  NOT NULL,
  entity_id        VARCHAR(100) NOT NULL,
  action           VARCHAR(10)  NOT NULL,   -- CREATE | UPDATE | DELETE | IMPORT
  changed_fields   JSONB        DEFAULT NULL,
  changed_by       VARCHAR(100) NOT NULL,
  source           VARCHAR(20)  NOT NULL DEFAULT 'UI',  -- UI | IMPORT | M28_AUTO
  changed_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON master_data_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed_at ON master_data_audit_log(changed_at DESC);

-- ─── BUG-M00-01 fix: hub_nm_assignment — add nm_code + created_at ─────────────
-- nm_code is the REAL supplier reference (nm_id=0 is placeholder, Sprint 2 migration).
-- M13 (Hub Booking) and M16 (Hub Supply) query nm_code → supplier.supplier_code → lead_time_days.
ALTER TABLE hub_nm_assignment ADD COLUMN IF NOT EXISTS nm_code    VARCHAR(30) DEFAULT NULL;
ALTER TABLE hub_nm_assignment ADD COLUMN IF NOT EXISTS created_at TIMESTAMP   NOT NULL DEFAULT NOW();

-- ─── BUG-M00-02 fix: transport_lane extension — M25/M28 dependency ────────────
-- M25 (Transport Routing) reads lt_days for ETA calculation.
-- M28 (Feedback Loop) writes lt_days + distance_km from actual delivery data.
-- mode: ROAD | SEA | AIR | RAIL
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS lt_days      INT           DEFAULT NULL;
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS distance_km  DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS mode         VARCHAR(20)   DEFAULT 'ROAD';
