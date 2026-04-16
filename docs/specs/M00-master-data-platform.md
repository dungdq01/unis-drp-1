# M00 — Master Data Platform: Full Spec

> **Version:** 1.2 · **Date:** 2026-04-16 · **Author:** SA/Architect
> **Changelog v1.1:** Fix C1 (bỏ `sku.nm_id` redundancy, `sku_nm_mapping` là source of truth),
> C2 (composite unique variant_code), C3 (DQ query orphan mapping), C4 (FeatureFlag metadata pattern),
> M1 (atomic import), M2 (LT override escape hatch), M4 (full 11 entities), M5 (M6 table guard).
> **Changelog v1.2:** Fix R1 (NmTemplate stale query dùng `sku.nmId` → join `sku_nm_mapping`),
> R2 (FE type `Sku.nmId` → `nmMappings[]`), R3 (`§6.2` validation rule table stale ref),
> R4 (`§11.1` `@UseGuards` syntax error), R5 (`findOne` stale relations), R6 (DoD QA count 18→25),
> R7 (`alertService` missing constructor inject in `SupplierService`).
> **Domain:** D1 Foundation · **Phase:** 0 · **Sprint:** 1-2
> **PRD Ref:** UNIS-SCP-v2.0-FULL-PRD.md §F0 (Master Data)
> **Owner:** BE3 + DA1 + FE2
> **Status:** 🔴 NEW — xây mới hoàn toàn
> **Feature flag:** `m00_master_data_enabled` (bắt buộc cho mọi endpoint v2)

---

## §0 — UNIS Constraints (đọc trước khi code)

| Constraint | Giá trị | Lý do |
|------------|---------|-------|
| PK tất cả tables | `BIGSERIAL` | Consistent với M1-M10 |
| TypeORM ID type | `id: string` | BIGSERIAL → PostgreSQL bigint → string trong JS |
| Folder name | `backend/src/master-data/` | Không phải `foundation/` (Rule 3) |
| API prefix | `/api/v1/master-data/...` | NEW module, không prefix v2 |
| Soft delete | `active BOOLEAN` | Không DROP row, deactivate only |
| SKU→NM mapping | **Single-source** | 1 SKU base = 1 NM sản xuất (BR-F0-003) |
| Variant → Base | Bắt buộc | Variant không tồn tại độc lập |
| Audit log | Tất cả CRUD ghi vào `master_data_audit_log` | Compliance |
| Import max size | 500 rows/file | Validate per row, partial OK |
| Auto-update threshold | >30% lệch → alert, KHÔNG auto-apply | Safety gate cho M28 feedback |

---

## §1 — Overview

### Mục tiêu

Master Data Platform là **nền tảng dữ liệu** cho toàn bộ 28 module. Không có M00 → không module nào chạy được.

### Scope Phase 1

| In scope | Out scope |
|----------|-----------|
| CRUD 6 core entities (SKU, Variant, CN, NM, Hub, Customer) | ERP replacement |
| 5 mapping tables (SKU-NM, Variant-Base, Hub-CN, Hub-NM, Customer-CN) | User authentication/SSO |
| Operational params (MOQ, LT, Transit LT per route) | Financial master (pricing detail) |
| Bulk CSV import (dry-run preview) | Production master tại NM |
| NM upload template generator | — |
| Data quality dashboard | — |
| Audit log | — |
| Extend `transport_lane` table (từ M6) | — |

### PRD Traceability

| PRD Requirement | Spec Section |
|----------------|--------------|
| FR-F0-001 CRUD core entities | §3, §5, §6 |
| FR-F0-002 SKU mandatory fields | §4 validation |
| FR-F0-003 Config management | **Thuộc M10 extend** — không trong M00 |
| FR-F0-004 Bulk import | §6.4 |
| FR-F0-005 Validation rules | §6.2 |
| FR-F0-006 NM template generator | §6.5 |
| FR-F0-007 Auto-update từ M28 | §11 (M28 integration point) |
| FR-F0-008 Data quality dashboard | §6.6, §10 |

### Dependencies

| Depends on | Data |
|-----------|------|
| ERP (Bravo) | Initial import: SKU, CN list |
| M28 (future) | Auto-update transit_lt_days, σ, honoring, trust |

| Feeds into | |
|-----------|---|
| **Tất cả 17 module v2** | Mọi module đều đọc master data |

---

## §2 — Domain Model

### Sơ đồ quan hệ

```
                 sku (base)                    nm (supplier)
                    │                              │
       ┌────────────┼────────────┐                 │
       │            │            │                 │
   sku_variant  sku_cn_mapping  sku_nm_mapping ────┘
       │            │            │
       │       channel (CN)      │
       │            │            │
       │            ├──► hub_cn_cluster ──► hub
       │            │                        │
       │      customer_cn ──► customer       │
       │                                     │
       │                                     │
       ▼                                     │
   transport_lane (NM×CN, CN×CN, Hub×CN) ◄───┘
   (extend existing M6 table)
```

### 13 tables tổng

| # | Table | Loại | Mục đích |
|---|-------|------|----------|
| 1 | `sku` | NEW | SKU base |
| 2 | `sku_variant` | NEW | Variant của SKU base |
| 3 | `channel` | NEW | CN (chi nhánh) |
| 4 | `supplier` | NEW | NM (nhà máy) |
| 5 | `hub` | NEW | Hub (virtual/physical) |
| 6 | `customer` | NEW | Khách hàng B2B |
| 7 | `sku_nm_mapping` | NEW | SKU→NM single-source |
| 8 | `sku_cn_mapping` | NEW | Override SS/z per CN×SKU |
| 9 | `hub_cn_cluster` | NEW | Hub phục vụ CN nào |
| 10 | `hub_nm_assignment` | NEW | NM cung cấp cho Hub nào |
| 11 | `customer_cn` | NEW | Customer thuộc CN nào |
| 12 | `transport_lane` | **EXTEND** | Thêm `transit_lt_days`, `lane_type` |
| 13 | `master_data_audit_log` | NEW | Audit trail tất cả CRUD |

---

## §3 — Migration SQL

### File: `backend/src/master-data/migrations/20260417_m00_create_master_data_tables.up.sql`

```sql
BEGIN;

-- ════════════════════════════════════════════════════════════════════
-- PRECONDITION CHECK: M6 transport_lane table required (M5 fix)
-- ════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='transport_lane') THEN
    RAISE EXCEPTION 'M6 transport_lane table required. Deploy M6 migrations first.';
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- 1. SKU BASE (C1 fix: bỏ nm_id — sku_nm_mapping là source of truth)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sku (
  id              BIGSERIAL      PRIMARY KEY,
  sku_code        VARCHAR(50)    NOT NULL UNIQUE,
  sku_name        VARCHAR(200)   NOT NULL,
  uom             VARCHAR(20)    NOT NULL DEFAULT 'm2',
  product_group   VARCHAR(50)    NULL,
  -- REMOVED: nm_id — dùng sku_nm_mapping thay thế (xem bảng 7)
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  created_by      VARCHAR(100)   NULL,
  updated_by      VARCHAR(100)   NULL
);
CREATE INDEX idx_sku_code ON sku(sku_code);
CREATE INDEX idx_sku_active ON sku(active);

-- ════════════════════════════════════════════════════════════════════
-- 2. SKU VARIANT (C2 fix: composite unique (sku_id, variant_code))
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sku_variant (
  id              BIGSERIAL      PRIMARY KEY,
  sku_id          BIGINT         NOT NULL REFERENCES sku(id),
  variant_code    VARCHAR(60)    NOT NULL,
  variant_suffix  VARCHAR(10)    NOT NULL,  -- A4, B2, C1...
  variant_name    VARCHAR(200)   NULL,
  attrs           JSONB          NULL,       -- màu, grade, kích thước
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_variant_in_sku UNIQUE (sku_id, variant_code)
);
CREATE INDEX idx_variant_sku ON sku_variant(sku_id);
CREATE INDEX idx_variant_code ON sku_variant(variant_code);

-- ════════════════════════════════════════════════════════════════════
-- 3. CHANNEL (CN)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS channel (
  id              BIGSERIAL      PRIMARY KEY,
  cn_code         VARCHAR(20)    NOT NULL UNIQUE,
  cn_name         VARCHAR(200)   NOT NULL,
  region          VARCHAR(50)    NULL,            -- Nam/Bắc/Trung
  address         TEXT           NULL,
  lat             DECIMAL(10, 6) NOT NULL,        -- mandatory cho LCNB
  lng             DECIMAL(10, 6) NOT NULL,
  manager_user_id BIGINT         NULL,            -- FK user (optional Phase 1)
  connectivity    VARCHAR(10)    DEFAULT 'GOOD',  -- GOOD/MEDIUM/WEAK
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP      NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_channel_code ON channel(cn_code);
CREATE INDEX idx_channel_region ON channel(region);

-- ════════════════════════════════════════════════════════════════════
-- 4. SUPPLIER (NM)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS supplier (
  id                  BIGSERIAL      PRIMARY KEY,
  nm_code             VARCHAR(30)    NOT NULL UNIQUE,
  nm_name             VARCHAR(200)   NOT NULL,
  contact_email       VARCHAR(200)   NULL,
  contact_phone       VARCHAR(20)    NULL,
  capacity_monthly    DECIMAL(15, 2) NULL,           -- m2/tháng
  production_cycle_d  INT            NULL,           -- days
  lead_time_days      DECIMAL(5, 2)  NOT NULL,       -- avg LT, auto-update by M28
  lt_sigma            DECIMAL(5, 2)  NULL,           -- σ_LT rolling
  price_tier_1        DECIMAL(15, 2) NULL,
  price_tier_2        DECIMAL(15, 2) NULL,
  honoring_rate       DECIMAL(5, 4)  NULL,           -- auto-update by M28 (0.00-1.00)
  relationship_score  INT            NULL,           -- 0-100
  active              BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP      NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_supplier_code ON supplier(nm_code);

-- C1 fix: Không còn FK circular vì sku.nm_id đã bỏ.
-- Relationship SKU ↔ Supplier qua sku_nm_mapping (bảng 7 bên dưới).

-- ════════════════════════════════════════════════════════════════════
-- 5. HUB
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hub (
  id              BIGSERIAL      PRIMARY KEY,
  hub_code        VARCHAR(30)    NOT NULL UNIQUE,
  hub_name        VARCHAR(200)   NOT NULL,
  hub_type        VARCHAR(10)    NOT NULL DEFAULT 'VIRTUAL',  -- VIRTUAL / PHYSICAL
  lat             DECIMAL(10, 6) NULL,
  lng             DECIMAL(10, 6) NULL,
  capacity        DECIMAL(15, 2) NULL,
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP      NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_hub_code ON hub(hub_code);

-- ════════════════════════════════════════════════════════════════════
-- 6. CUSTOMER
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer (
  id              BIGSERIAL      PRIMARY KEY,
  customer_code   VARCHAR(50)    NOT NULL UNIQUE,
  customer_name   VARCHAR(200)   NOT NULL,
  contact_email   VARCHAR(200)   NULL,
  contact_phone   VARCHAR(20)    NULL,
  customer_type   VARCHAR(20)    DEFAULT 'B2B',     -- B2B / B2C
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP      NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════════════
-- 7. SKU-NM MAPPING (Single-source — SOURCE OF TRUTH sau C1 fix)
-- ════════════════════════════════════════════════════════════════════
-- C1: Bảng này là duy nhất encode SKU → NM relationship + MOQ.
-- Service phải đảm bảo: tạo SKU → bắt buộc kèm mapping active.
CREATE TABLE IF NOT EXISTS sku_nm_mapping (
  id              BIGSERIAL      PRIMARY KEY,
  sku_id          BIGINT         NOT NULL REFERENCES sku(id),
  nm_id           BIGINT         NOT NULL REFERENCES supplier(id),
  moq             DECIMAL(15, 2) NOT NULL DEFAULT 0,        -- min order per lần SX
  priority        INT            DEFAULT 1,                  -- future: multi-source fallback
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sku_nm UNIQUE (sku_id, nm_id)
);
CREATE INDEX idx_sku_nm_map ON sku_nm_mapping(sku_id, nm_id);

-- Business constraint: 1 sku_id có tối đa 1 row active (single-source rule)
CREATE UNIQUE INDEX uq_sku_single_nm
  ON sku_nm_mapping(sku_id) WHERE active = TRUE;

-- ════════════════════════════════════════════════════════════════════
-- 8. SKU-CN MAPPING (per-CN override SS/z)
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sku_cn_mapping (
  id              BIGSERIAL      PRIMARY KEY,
  sku_id          BIGINT         NOT NULL REFERENCES sku(id),
  cn_id           BIGINT         NOT NULL REFERENCES channel(id),
  ss_override     DECIMAL(15, 2) NULL,        -- override SS_cn formula
  z_override      DECIMAL(5, 4)  NULL,        -- override z-factor
  is_critical     BOOLEAN        DEFAULT FALSE,
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_sku_cn UNIQUE (sku_id, cn_id)
);
CREATE INDEX idx_sku_cn_map ON sku_cn_mapping(sku_id, cn_id);

-- ════════════════════════════════════════════════════════════════════
-- 9. HUB-CN CLUSTER
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hub_cn_cluster (
  id              BIGSERIAL      PRIMARY KEY,
  hub_id          BIGINT         NOT NULL REFERENCES hub(id),
  cn_id           BIGINT         NOT NULL REFERENCES channel(id),
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_hub_cn UNIQUE (hub_id, cn_id)
);

-- ════════════════════════════════════════════════════════════════════
-- 10. HUB-NM ASSIGNMENT
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hub_nm_assignment (
  id              BIGSERIAL      PRIMARY KEY,
  hub_id          BIGINT         NOT NULL REFERENCES hub(id),
  nm_id           BIGINT         NOT NULL REFERENCES supplier(id),
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_hub_nm UNIQUE (hub_id, nm_id)
);

-- ════════════════════════════════════════════════════════════════════
-- 11. CUSTOMER-CN
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_cn (
  id              BIGSERIAL      PRIMARY KEY,
  customer_id     BIGINT         NOT NULL REFERENCES customer(id),
  cn_id           BIGINT         NOT NULL REFERENCES channel(id),
  is_primary      BOOLEAN        DEFAULT FALSE,
  active          BOOLEAN        NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_customer_cn UNIQUE (customer_id, cn_id)
);

-- ════════════════════════════════════════════════════════════════════
-- 12. TRANSPORT LANE (EXTEND existing M6 table)
-- ════════════════════════════════════════════════════════════════════
-- Assume existing: transport_lane(id, from_location, to_location, distance_km)
-- Add columns cho v2.0:
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS lane_type VARCHAR(15) DEFAULT 'NM_TO_CN';
  -- NM_TO_CN | NM_TO_HUB | HUB_TO_CN | CN_TO_CN (LCNB)
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS transit_lt_days DECIMAL(5, 2) DEFAULT 1;
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS lt_sigma DECIMAL(5, 2) NULL;
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS last_actual_lt DECIMAL(5, 2) NULL;
ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS last_updated_by_m28 TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_lane_type ON transport_lane(lane_type);
CREATE INDEX IF NOT EXISTS idx_lane_from_to ON transport_lane(from_location, to_location);

-- ════════════════════════════════════════════════════════════════════
-- 13. MASTER DATA AUDIT LOG
-- ════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS master_data_audit_log (
  id              BIGSERIAL      PRIMARY KEY,
  entity_type     VARCHAR(30)    NOT NULL,     -- SKU | CHANNEL | SUPPLIER | HUB | ...
  entity_id       BIGINT         NOT NULL,
  action          VARCHAR(10)    NOT NULL,     -- CREATE | UPDATE | DELETE | IMPORT
  changed_fields  JSONB          NULL,         -- {field: [old, new]}
  changed_by      VARCHAR(100)   NOT NULL,
  changed_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  source          VARCHAR(20)    DEFAULT 'UI'  -- UI | IMPORT | M28_AUTO
);
CREATE INDEX idx_audit_entity ON master_data_audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_changed_at ON master_data_audit_log(changed_at DESC);

COMMIT;
```

### File: `20260417_m00_create_master_data_tables.down.sql`

```sql
BEGIN;
DROP TABLE IF EXISTS master_data_audit_log;
DROP TABLE IF EXISTS customer_cn;
DROP TABLE IF EXISTS hub_nm_assignment;
DROP TABLE IF EXISTS hub_cn_cluster;
DROP TABLE IF EXISTS sku_cn_mapping;
DROP TABLE IF EXISTS sku_nm_mapping;
DROP TABLE IF EXISTS customer;
DROP TABLE IF EXISTS hub;
DROP TABLE IF EXISTS supplier;
DROP TABLE IF EXISTS channel;
DROP TABLE IF EXISTS sku_variant;
DROP TABLE IF EXISTS sku;

ALTER TABLE transport_lane DROP COLUMN IF EXISTS last_updated_by_m28;
ALTER TABLE transport_lane DROP COLUMN IF EXISTS last_actual_lt;
ALTER TABLE transport_lane DROP COLUMN IF EXISTS lt_sigma;
ALTER TABLE transport_lane DROP COLUMN IF EXISTS transit_lt_days;
ALTER TABLE transport_lane DROP COLUMN IF EXISTS lane_type;
COMMIT;
```

### File: `20260417_m00_seed_transport_lanes.up.sql`

Seed lane cho tất cả combinations NM×CN + CN×CN (cho LCNB max 500km):

```sql
-- Pseudocode (DA1 generate SQL thực từ master data):
-- Foreach active NM × active CN:
--   INSERT transport_lane (from=NM, to=CN, lane_type='NM_TO_CN', distance_km=haversine(lat,lng))
-- Foreach active CN × active CN (distance <= 500km):
--   INSERT transport_lane (from=CN1, to=CN2, lane_type='CN_TO_CN', distance_km=haversine)
-- transit_lt_days default = ceil(distance_km / 300) ngày; sẽ auto-update bởi M28 sau.
```

---

## §4 — Entities (TypeORM)

File path: `backend/src/master-data/entities/`

### `sku.entity.ts` (C1 fix: bỏ nmId)

```typescript
import { Entity, PrimaryGeneratedColumn, Column, OneToMany, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { SkuVariant } from './sku-variant.entity';
import { SkuNmMapping } from './sku-nm-mapping.entity';

@Entity('sku')
export class Sku {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'sku_code', length: 50, unique: true })
  skuCode: string;

  @Column({ name: 'sku_name', length: 200 })
  skuName: string;

  @Column({ length: 20, default: 'm2' })
  uom: string;

  @Column({ name: 'product_group', length: 50, nullable: true })
  productGroup: string | null;

  // C1 fix: bỏ nmId column — relationship qua sku_nm_mapping
  @OneToMany(() => SkuNmMapping, m => m.sku)
  nmMappings: SkuNmMapping[];

  @OneToMany(() => SkuVariant, v => v.sku)
  variants: SkuVariant[];

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ name: 'created_by', length: 100, nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', length: 100, nullable: true })
  updatedBy: string | null;
}
```

### Các entity còn lại (rút gọn — cùng pattern)

```typescript
// sku-variant.entity.ts
@Entity('sku_variant')
export class SkuVariant {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'sku_id', type: 'bigint' }) skuId: string;
  @ManyToOne(() => Sku, s => s.variants) @JoinColumn({ name: 'sku_id' }) sku: Sku;
  @Column({ name: 'variant_code', length: 60, unique: true }) variantCode: string;
  @Column({ name: 'variant_suffix', length: 10 }) variantSuffix: string;
  @Column({ name: 'variant_name', length: 200, nullable: true }) variantName: string | null;
  @Column({ type: 'jsonb', nullable: true }) attrs: object | null;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

// channel.entity.ts
@Entity('channel')
export class Channel {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'cn_code', length: 20, unique: true }) cnCode: string;
  @Column({ name: 'cn_name', length: 200 }) cnName: string;
  @Column({ length: 50, nullable: true }) region: string | null;
  @Column({ type: 'text', nullable: true }) address: string | null;
  @Column({ type: 'decimal', precision: 10, scale: 6 }) lat: number;
  @Column({ type: 'decimal', precision: 10, scale: 6 }) lng: number;
  @Column({ name: 'connectivity', length: 10, default: 'GOOD' }) connectivity: string;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

// supplier.entity.ts
@Entity('supplier')
export class Supplier {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'nm_code', length: 30, unique: true }) nmCode: string;
  @Column({ name: 'nm_name', length: 200 }) nmName: string;
  @Column({ name: 'contact_email', length: 200, nullable: true }) contactEmail: string | null;
  @Column({ name: 'contact_phone', length: 20, nullable: true }) contactPhone: string | null;
  @Column({ name: 'capacity_monthly', type: 'decimal', precision: 15, scale: 2, nullable: true }) capacityMonthly: number | null;
  @Column({ name: 'production_cycle_d', type: 'int', nullable: true }) productionCycleD: number | null;
  @Column({ name: 'lead_time_days', type: 'decimal', precision: 5, scale: 2 }) leadTimeDays: number;
  @Column({ name: 'lt_sigma', type: 'decimal', precision: 5, scale: 2, nullable: true }) ltSigma: number | null;
  @Column({ name: 'price_tier_1', type: 'decimal', precision: 15, scale: 2, nullable: true }) priceTier1: number | null;
  @Column({ name: 'price_tier_2', type: 'decimal', precision: 15, scale: 2, nullable: true }) priceTier2: number | null;
  @Column({ name: 'honoring_rate', type: 'decimal', precision: 5, scale: 4, nullable: true }) honoringRate: number | null;
  @Column({ name: 'relationship_score', type: 'int', nullable: true }) relationshipScore: number | null;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

// hub.entity.ts
@Entity('hub')
export class Hub {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'hub_code', length: 30, unique: true }) hubCode: string;
  @Column({ name: 'hub_name', length: 200 }) hubName: string;
  @Column({ name: 'hub_type', length: 10, default: 'VIRTUAL' }) hubType: 'VIRTUAL' | 'PHYSICAL';
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true }) lat: number | null;
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true }) lng: number | null;
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true }) capacity: number | null;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

// customer.entity.ts
@Entity('customer')
export class Customer {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'customer_code', length: 50, unique: true }) customerCode: string;
  @Column({ name: 'customer_name', length: 200 }) customerName: string;
  @Column({ name: 'contact_email', length: 200, nullable: true }) contactEmail: string | null;
  @Column({ name: 'contact_phone', length: 20, nullable: true }) contactPhone: string | null;
  @Column({ name: 'customer_type', length: 20, default: 'B2B' }) customerType: 'B2B' | 'B2C';
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}

// sku-nm-mapping.entity.ts (C1: source of truth)
@Entity('sku_nm_mapping')
export class SkuNmMapping {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'sku_id', type: 'bigint' }) skuId: string;
  @ManyToOne(() => Sku, s => s.nmMappings) @JoinColumn({ name: 'sku_id' }) sku: Sku;
  @Column({ name: 'nm_id', type: 'bigint' }) nmId: string;
  @ManyToOne(() => Supplier) @JoinColumn({ name: 'nm_id' }) supplier: Supplier;
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 }) moq: number;
  @Column({ type: 'int', default: 1 }) priority: number;
  @Column({ default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}

// sku-cn-mapping.entity.ts
@Entity('sku_cn_mapping')
export class SkuCnMapping {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'sku_id', type: 'bigint' }) skuId: string;
  @Column({ name: 'cn_id', type: 'bigint' }) cnId: string;
  @Column({ name: 'ss_override', type: 'decimal', precision: 15, scale: 2, nullable: true }) ssOverride: number | null;
  @Column({ name: 'z_override', type: 'decimal', precision: 5, scale: 4, nullable: true }) zOverride: number | null;
  @Column({ name: 'is_critical', default: false }) isCritical: boolean;
  @Column({ default: true }) active: boolean;
}

// hub-cn-cluster.entity.ts
@Entity('hub_cn_cluster')
export class HubCnCluster {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'hub_id', type: 'bigint' }) hubId: string;
  @Column({ name: 'cn_id', type: 'bigint' }) cnId: string;
  @Column({ default: true }) active: boolean;
}

// hub-nm-assignment.entity.ts
@Entity('hub_nm_assignment')
export class HubNmAssignment {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'hub_id', type: 'bigint' }) hubId: string;
  @Column({ name: 'nm_id', type: 'bigint' }) nmId: string;
  @Column({ default: true }) active: boolean;
}

// customer-cn.entity.ts
@Entity('customer_cn')
export class CustomerCn {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'customer_id', type: 'bigint' }) customerId: string;
  @Column({ name: 'cn_id', type: 'bigint' }) cnId: string;
  @Column({ name: 'is_primary', default: false }) isPrimary: boolean;
  @Column({ default: true }) active: boolean;
}

// transport-lane.entity.ts (EXTEND từ M6 — giữ naming cũ)
// ⚠️ QUAN TRỌNG: File này CÓ THỂ đã tồn tại trong src/transport/entities/transport-lane.entity.ts (M6).
// M00 KHÔNG tạo file mới — chỉ extend entity cũ bằng cách thêm @Column decorators mới.
// Nếu chưa có file cũ: tạo tại src/transport/entities/transport-lane.entity.ts (PROTECTED zone).
// Fields mới:
@Entity('transport_lane')
export class TransportLane {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'from_location', length: 50 }) fromLocation: string;   // existing từ M6
  @Column({ name: 'to_location', length: 50 }) toLocation: string;       // existing từ M6
  @Column({ name: 'distance_km', type: 'decimal', precision: 10, scale: 2, nullable: true }) distanceKm: number | null;  // existing

  // ── Thêm mới bởi M00 ──
  @Column({ name: 'lane_type', length: 15, default: 'NM_TO_CN' })
  laneType: 'NM_TO_CN' | 'NM_TO_HUB' | 'HUB_TO_CN' | 'CN_TO_CN';

  @Column({ name: 'transit_lt_days', type: 'decimal', precision: 5, scale: 2, default: 1 })
  transitLtDays: number;

  @Column({ name: 'lt_sigma', type: 'decimal', precision: 5, scale: 2, nullable: true })
  ltSigma: number | null;

  @Column({ name: 'last_actual_lt', type: 'decimal', precision: 5, scale: 2, nullable: true })
  lastActualLt: number | null;

  @Column({ name: 'last_updated_by_m28', type: 'timestamp', nullable: true })
  lastUpdatedByM28: Date | null;
}

// master-data-audit-log.entity.ts
@Entity('master_data_audit_log')
export class MasterDataAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' }) id: string;
  @Column({ name: 'entity_type', length: 30 }) entityType: string;
  @Column({ name: 'entity_id', type: 'bigint' }) entityId: string;
  @Column({ length: 10 }) action: string;
  @Column({ name: 'changed_fields', type: 'jsonb', nullable: true }) changedFields: object | null;
  @Column({ name: 'changed_by', length: 100 }) changedBy: string;
  @CreateDateColumn({ name: 'changed_at' }) changedAt: Date;
  @Column({ length: 20, default: 'UI' }) source: string;
}
```

---

## §5 — DTOs

File path: `backend/src/master-data/dto/`

### Core CRUD DTOs (example với SKU)

```typescript
// dto/create-sku.dto.ts
import { IsString, IsNotEmpty, IsOptional, IsInt, IsBoolean, IsNumber, Length, IsArray, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType, OmitType } from '@nestjs/mapped-types';  // chốt: @nestjs/mapped-types

export class CreateSkuDto {
  @IsString() @Length(1, 50)
  skuCode: string;

  @IsString() @Length(1, 200)
  skuName: string;

  @IsOptional() @IsString() @Length(1, 20)
  uom?: string;

  @IsOptional() @IsString()
  productGroup?: string;

  // C1 fix: nmId vẫn mandatory trong DTO vì SKU phải có ít nhất 1 mapping active.
  // Service layer sẽ tạo sku_nm_mapping thay vì insert vào sku.nm_id.
  @IsString() @IsNotEmpty()
  nmId: string;

  @IsOptional() @IsNumber() @Min(0)
  moq?: number = 0;   // sẽ lưu vào sku_nm_mapping.moq

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateVariantInlineDto)
  variants?: CreateVariantInlineDto[];

  @IsOptional() @IsString()
  createdBy?: string;
}

export class CreateVariantInlineDto {
  @IsString() @Length(1, 60)
  variantCode: string;

  @IsString() @Length(1, 10)
  variantSuffix: string;

  @IsOptional() @IsString()
  variantName?: string;
}

// dto/update-sku.dto.ts — skuCode immutable, variants/nmId update qua endpoint riêng
export class UpdateSkuDto extends PartialType(
  OmitType(CreateSkuDto, ['skuCode', 'variants', 'nmId', 'moq'] as const)
) {}

// dto/change-sku-nm.dto.ts — endpoint riêng để đổi NM (audit critical)
export class ChangeSkuNmDto {
  @IsString() @IsNotEmpty() newNmId: string;
  @IsOptional() @IsNumber() @Min(0) newMoq?: number;
  @IsString() @IsNotEmpty() reason: string;         // mandatory
  @IsString() @IsNotEmpty() approvedBy: string;
}

// dto/sku-query.dto.ts — pagination + filter
export class SkuQueryDto {
  @IsOptional() @IsString()
  search?: string;

  @IsOptional() @IsString()
  nmId?: string;                // filter qua join sku_nm_mapping

  @IsOptional() @IsBoolean() @Type(() => Boolean)
  activeOnly?: boolean = true;

  @IsOptional() @IsInt() @Type(() => Number) @Min(1)
  page?: number = 1;

  @IsOptional() @IsInt() @Type(() => Number) @Min(1) @Max(500)
  pageSize?: number = 50;
}
```

### Bulk Import DTOs

```typescript
// dto/import-csv.dto.ts
export class ImportCsvDto {
  @IsString() @IsIn(['SKU', 'CHANNEL', 'SUPPLIER', 'HUB', 'CUSTOMER'])
  entityType: string;

  @IsOptional() @IsBoolean() @Type(() => Boolean)
  dryRun?: boolean = true;     // default: preview only

  @IsString()
  importedBy: string;

  // File content passed via multipart/form-data
}

export class ImportResultDto {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportErrorDto[];
  insertedIds?: string[];       // Only when dryRun=false
}

export class ImportErrorDto {
  lineNumber: number;
  field?: string;
  message: string;
  rawData: object;
}
```

### NM Upload Template DTO

```typescript
// dto/nm-template.dto.ts
export class NmTemplateDto {
  nmId: string;
  nmCode: string;
  nmName: string;
  generatedAt: string;
  skus: NmTemplateRowDto[];
}

export class NmTemplateRowDto {
  skuCode: string;              // pre-filled
  skuName: string;              // pre-filled
  uom: string;                  // pre-filled
  availableQty?: number;        // NM điền
  atpQty?: number;              // NM điền
  lastUpdated?: string;         // NM điền
}
```

---

## §6 — Service Logic

File path: `backend/src/master-data/services/`

Split services theo entity để tránh 1 file service khổng lồ:

```
services/
├── sku.service.ts
├── sku-variant.service.ts
├── channel.service.ts
├── supplier.service.ts
├── hub.service.ts
├── customer.service.ts
├── mapping.service.ts         (SKU-NM, SKU-CN, Hub-CN, Hub-NM)
├── import.service.ts          (bulk CSV import)
├── nm-template.service.ts     (generate NM upload template)
├── data-quality.service.ts
└── audit.service.ts
```

### 6.1 SKU Service (skeleton)

```typescript
// services/sku.service.ts
@Injectable()
export class SkuService {
  constructor(
    @InjectRepository(Sku) private readonly skuRepo: Repository<Sku>,
    @InjectRepository(SkuNmMapping) private readonly mappingRepo: Repository<SkuNmMapping>,
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    private readonly audit: AuditService,     // m4 fix: explicit inject
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateSkuDto): Promise<Sku> {
    return this.dataSource.transaction(async (mgr) => {
      // 1. Validate NM exists & active
      const nmExists = await mgr.findOne(Supplier, { where: { id: dto.nmId, active: true } });
      if (!nmExists) throwUnisError(UNIS_ERR.MD_NM_NOT_FOUND);

      // 2. Uniqueness check on sku_code
      const dup = await mgr.findOne(Sku, { where: { skuCode: dto.skuCode } });
      if (dup) throwUnisError(UNIS_ERR.MD_SKU_CODE_DUPLICATE);

      // 3. Create SKU (C1: không có nmId field)
      const sku = mgr.create(Sku, {
        skuCode: dto.skuCode,
        skuName: dto.skuName,
        uom: dto.uom ?? 'm2',
        productGroup: dto.productGroup ?? null,
        createdBy: dto.createdBy ?? null,
      });
      const saved = await mgr.save(sku);

      // 4. Create sku_nm_mapping (SOURCE OF TRUTH — single-source enforced by partial unique index)
      await mgr.save(SkuNmMapping, {
        skuId: saved.id,
        nmId: dto.nmId,
        moq: dto.moq ?? 0,
        priority: 1,
        active: true,
      });

      // 5. Create variants nếu có
      if (dto.variants?.length) {
        const variants = dto.variants.map(v => mgr.create(SkuVariant, {
          skuId: saved.id,
          variantCode: v.variantCode,
          variantSuffix: v.variantSuffix,
          variantName: v.variantName ?? null,
        }));
        await mgr.save(variants);
      }

      // 6. Audit log
      await this.audit.log(mgr, 'SKU', saved.id, 'CREATE',
        { skuCode: [null, dto.skuCode], nmId: [null, dto.nmId] },
        dto.createdBy ?? 'system');

      return saved;
    });
  }

  // C1 fix: đổi NM cho SKU (audit-critical, endpoint riêng)
  async changeNm(skuId: string, dto: ChangeSkuNmDto): Promise<void> {
    return this.dataSource.transaction(async (mgr) => {
      const existing = await mgr.findOne(SkuNmMapping, {
        where: { skuId, active: true },
      });
      if (!existing) throwUnisError(UNIS_ERR.MD_SKU_NOT_FOUND);

      // Validate new NM
      const newNm = await mgr.findOne(Supplier, { where: { id: dto.newNmId, active: true } });
      if (!newNm) throwUnisError(UNIS_ERR.MD_NM_NOT_FOUND);

      if (existing.nmId === dto.newNmId) return;  // no-op

      // Deactivate old mapping
      existing.active = false;
      await mgr.save(existing);

      // Create new active mapping
      await mgr.save(SkuNmMapping, {
        skuId,
        nmId: dto.newNmId,
        moq: dto.newMoq ?? existing.moq,
        priority: 1,
        active: true,
      });

      await this.audit.log(mgr, 'SKU', skuId, 'UPDATE',
        { nmId: [existing.nmId, dto.newNmId], reason: [null, dto.reason] },
        dto.approvedBy);
    });
  }

  async findAll(query: SkuQueryDto): Promise<PageResult<Sku>> {
    // C1 fix: join qua sku_nm_mapping thay vì sku.nm_id
    const qb = this.skuRepo.createQueryBuilder('sku')
      .leftJoinAndSelect('sku.nmMappings', 'mapping', 'mapping.active = true')
      .leftJoinAndSelect('mapping.supplier', 'supplier')
      .leftJoinAndSelect('sku.variants', 'variants', 'variants.active = true');

    if (query.activeOnly) qb.where('sku.active = true');
    if (query.search) qb.andWhere('(sku.sku_code ILIKE :s OR sku.sku_name ILIKE :s)', { s: `%${query.search}%` });
    if (query.nmId) qb.andWhere('mapping.nm_id = :nm', { nm: query.nmId });

    qb.orderBy('sku.sku_code', 'ASC')
      .skip((query.page! - 1) * query.pageSize!)
      .take(query.pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page: query.page!, pageSize: query.pageSize! };
  }

  async findOne(id: string): Promise<Sku> {
    const sku = await this.skuRepo.findOne({
      where: { id },
      relations: ['nmMappings', 'nmMappings.supplier', 'variants'],
    });
    if (!sku) throwUnisError(UNIS_ERR.MD_SKU_NOT_FOUND);
    return sku;
  }

  async update(id: string, dto: UpdateSkuDto, actor: string): Promise<Sku> {
    const existing = await this.findOne(id);
    const diff = this.audit.computeDiff(existing, dto);

    Object.assign(existing, dto, { updatedBy: actor });
    const saved = await this.skuRepo.save(existing);

    if (Object.keys(diff).length) {
      await this.audit.log(null, 'SKU', id, 'UPDATE', diff, actor);
    }
    return saved;
  }

  async softDelete(id: string, actor: string): Promise<void> {
    await this.skuRepo.update(id, { active: false, updatedBy: actor });
    await this.audit.log(null, 'SKU', id, 'DELETE', { active: [true, false] }, actor);
  }
}
```

### 6.2 Validation Rules (referential integrity)

| Rule | Error | Áp dụng |
|------|-------|--------|
| `sku_nm_mapping.nm_id` must reference active supplier | `MD_NM_NOT_FOUND` | CreateSku, UpdateSku |
| `sku.sku_code` unique | `MD_SKU_CODE_DUPLICATE` | CreateSku |
| `sku_variant.sku_id` must reference active SKU | `MD_SKU_NOT_FOUND` | CreateVariant |
| `channel.lat/lng` mandatory | Class-validator at DTO | CreateChannel |
| `supplier.lead_time_days > 0` | `MD_INVALID_LT` | CreateSupplier |
| `sku_nm_mapping` 1 active per sku_id | Partial unique index `uq_sku_single_nm` | CreateMapping |
| Cannot deactivate supplier nếu có active SKU | `MD_SUPPLIER_IN_USE` | SoftDelete supplier |

### 6.3 Audit Service

```typescript
// services/audit.service.ts
@Injectable()
export class AuditService {
  constructor(@InjectRepository(MasterDataAuditLog) private readonly repo: Repository<MasterDataAuditLog>) {}

  async log(
    mgr: EntityManager | null,
    entityType: string,
    entityId: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT',
    changedFields: object | null,
    changedBy: string,
    source: 'UI' | 'IMPORT' | 'M28_AUTO' = 'UI',
  ): Promise<void> {
    const log = { entityType, entityId, action, changedFields, changedBy, source };
    await (mgr ?? this.repo.manager).save(MasterDataAuditLog, log);
  }

  computeDiff(oldEntity: object, newDto: object): Record<string, [any, any]> {
    const diff: Record<string, [any, any]> = {};
    for (const key of Object.keys(newDto)) {
      if ((newDto as any)[key] !== (oldEntity as any)[key]) {
        diff[key] = [(oldEntity as any)[key], (newDto as any)[key]];
      }
    }
    return diff;
  }
}
```

### 6.4 Import Service (Bulk CSV)

```typescript
// services/import.service.ts
@Injectable()
export class ImportService {
  // ... inject entity services
  async importCsv(
    entityType: string,
    fileBuffer: Buffer,
    dryRun: boolean,
    actor: string,
  ): Promise<ImportResultDto> {
    const rows = parse(fileBuffer, { columns: true, trim: true }); // csv-parse
    if (rows.length > 500) throwUnisError(UNIS_ERR.MD_IMPORT_TOO_MANY);

    const errors: ImportErrorDto[] = [];
    const validDtos: any[] = [];

    // Phase 1: validate all rows
    for (let i = 0; i < rows.length; i++) {
      try {
        const dto = await this.validateRow(entityType, rows[i], i + 2);
        validDtos.push(dto);
      } catch (e: any) {
        errors.push({ lineNumber: i + 2, message: e.message, rawData: rows[i] });
      }
    }

    // Phase 2: if dry-run, return preview
    if (dryRun) {
      return { totalRows: rows.length, validRows: validDtos.length, errorRows: errors.length, errors };
    }

    // Phase 3: ATOMIC commit — M1 fix: bọc toàn bộ loop trong 1 transaction.
    // Nếu bất kỳ row nào fail ở DB layer → rollback toàn bộ. User nhận
    // danh sách validation errors + runtime error (nếu có), không có partial commit.
    const insertedIds: string[] = [];
    try {
      await this.dataSource.transaction(async (mgr) => {
        for (const dto of validDtos) {
          const saved = await this.dispatchCreate(mgr, entityType, dto, actor);
          insertedIds.push(saved.id);
        }
      });
    } catch (err: any) {
      // Rollback đã xảy ra. Return error để user biết không có row nào commit.
      return {
        totalRows: rows.length,
        validRows: validDtos.length,
        errorRows: errors.length + 1,
        errors: [
          ...errors,
          { lineNumber: 0, message: `Import rolled back: ${err.message}`, rawData: {} },
        ],
        insertedIds: [],
      };
    }

    return {
      totalRows: rows.length,
      validRows: validDtos.length,
      errorRows: errors.length,
      errors,
      insertedIds,
    };
  }

  private async validateRow(entityType: string, raw: any, lineNumber: number): Promise<any> {
    switch (entityType) {
      case 'SKU':      return plainToInstance(CreateSkuDto, raw);
      case 'CHANNEL':  return plainToInstance(CreateChannelDto, raw);
      // ... other
      default: throw new Error(`Unsupported entity: ${entityType}`);
    }
    // validateOrReject(dto) → throw class-validator errors
  }

  // M1 fix: dispatchCreate nhận EntityManager để participate trong parent transaction
  private async dispatchCreate(mgr: EntityManager, entityType: string, dto: any, actor: string): Promise<any> {
    switch (entityType) {
      case 'SKU':      return this.skuService.createWithMgr(mgr, { ...dto, createdBy: actor });
      case 'CHANNEL':  return this.channelService.createWithMgr(mgr, { ...dto, createdBy: actor });
      case 'SUPPLIER': return this.supplierService.createWithMgr(mgr, { ...dto, createdBy: actor });
      case 'HUB':      return this.hubService.createWithMgr(mgr, { ...dto, createdBy: actor });
      case 'CUSTOMER': return this.customerService.createWithMgr(mgr, { ...dto, createdBy: actor });
      default: throw new Error(`Unsupported entity: ${entityType}`);
    }
  }
}
```

> **Pattern note:** Mỗi entity service phải expose `createWithMgr(mgr, dto)` variant — logic giống `create()` nhưng nhận sẵn `EntityManager` thay vì tự tạo transaction. `create()` công khai chỉ là wrapper: `this.dataSource.transaction(mgr => this.createWithMgr(mgr, dto))`.

### 6.4.1 Import Order — Bắt buộc theo thứ tự (BLOCK-2 fix)

User PHẢI import theo thứ tự sau. Vi phạm thứ tự sẽ gây FK constraint error:

| Bước | Entity | Lý do |
|------|--------|-------|
| 1 | **Supplier (NM)** | `sku_nm_mapping.nm_id` references `supplier.id` |
| 2 | **SKU** | References `supplier` qua `sku_nm_mapping` |
| 3 | **Channel (CN)** | `sku_cn_mapping.cn_id` và `customer_cn.cn_id` references `channel.id` |
| 4 | **Hub** | `hub_cn_cluster.hub_id` và `hub_nm_assignment.hub_id` references `hub.id` |
| 5 | **Customer** | `customer_cn.customer_id` references `customer.id` |
| 6 | **Mapping tables** | SKU-CN, Hub-CN, Hub-NM, Customer-CN — sau khi base entities tồn tại |

**FE Import Wizard PHẢI:**
- Hiển thị dropdown chọn entity type với label thứ tự (1-6)
- Show warning nếu user chọn bước 2+ nhưng bước trước chưa có data
- API `GET /master-data/quality` trả về count mỗi entity để FE check

---

### 6.5 NM Upload Template Generator

```typescript
// services/nm-template.service.ts
@Injectable()
export class NmTemplateService {
  constructor(
    @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SkuNmMapping) private readonly mappingRepo: Repository<SkuNmMapping>,
  ) {}

  async generate(nmId: string): Promise<Buffer> {
    const supplier = await this.supplierRepo.findOne({ where: { id: nmId, active: true } });
    if (!supplier) throwUnisError(UNIS_ERR.MD_NM_NOT_FOUND);

    // R1 fix: sku.nmId không còn tồn tại sau C1 — join qua sku_nm_mapping
    const mappings = await this.mappingRepo.find({
      where: { nmId, active: true },
      relations: ['sku'],
      order: { sku: { skuCode: 'ASC' } } as any,
    });
    const skus = mappings
      .map(m => m.sku)
      .filter(s => s?.active);

    // Generate CSV
    const header = 'sku_code,sku_name,uom,available_qty,atp_qty,last_updated\r\n';
    const rows = skus.map(s => `"${s.skuCode}","${s.skuName}","${s.uom}",,,`).join('\r\n');
    const csv = '\uFEFF' + header + rows;

    return Buffer.from(csv, 'utf-8');
  }
}
```

### 6.6 Data Quality Service

```typescript
// services/data-quality.service.ts
@Injectable()
export class DataQualityService {
  async getMetrics(): Promise<DataQualityDto> {
    const [
      skuWithoutActiveNm,
      cnWithoutLatLng,
      nmWithoutSkus,
      skuNoRecentSupply,
    ] = await Promise.all([
      // C3 fix: SKU không có active mapping HOẶC mapping trỏ tới NM inactive
      this.dataSource.query(`
        SELECT COUNT(*) AS count FROM sku s
        WHERE s.active = true
          AND NOT EXISTS (
            SELECT 1 FROM sku_nm_mapping m
            JOIN supplier n ON n.id = m.nm_id
            WHERE m.sku_id = s.id AND m.active = true AND n.active = true
          )
      `),
      this.dataSource.query(`
        SELECT COUNT(*) AS count FROM channel
        WHERE active=true AND (lat IS NULL OR lng IS NULL)
      `),
      this.dataSource.query(`
        SELECT COUNT(*) AS count FROM supplier s WHERE active=true
          AND NOT EXISTS (
            SELECT 1 FROM sku_nm_mapping m
            JOIN sku ON sku.id = m.sku_id
            WHERE m.nm_id = s.id AND m.active = true AND sku.active = true
          )
      `),
      // M3 note: join qua string item_code. Tech Debt Phase 3 — M2 migration map item_code → sku_id.
      // Query này assume item_code === sku_code. Nếu M2 thay đổi format → cần rework.
      this.dataSource.query(`
        SELECT COUNT(DISTINCT s.id) AS count FROM sku s WHERE active=true
          AND NOT EXISTS (
            SELECT 1 FROM supply_snapshot_line ssl
            JOIN supply_snapshot ss ON ss.id = ssl.snapshot_id
            WHERE ssl.item_code = s.sku_code
              AND ss.captured_at >= NOW() - INTERVAL '30 days'
          )
      `),
    ]);

    return {
      skuWithoutActiveNm: Number(skuWithoutActiveNm[0].count),
      cnWithoutLatLng: Number(cnWithoutLatLng[0].count),
      nmWithoutSkus: Number(nmWithoutSkus[0].count),
      skuNoRecentSupply: Number(skuNoRecentSupply[0].count),
    };
  }
}
```

---

## §7 — Controller & API Routes

File path: `backend/src/master-data/`

### m1 fix: API prefix clarification

**Assumption:** `main.ts` gọi `app.setGlobalPrefix('api/v1')`. Do đó Controller KHÔNG prefix `v1/`:

```typescript
// main.ts
app.setGlobalPrefix('api/v1');

// controller — chỉ relative path
@Controller('master-data/sku')  // → resolves to /api/v1/master-data/sku
```

Nếu repo hiện tại dùng `setGlobalPrefix('api')` → thì Controller dùng `@Controller('v1/master-data/sku')`. **BE3 verify trong Sprint 1 Day 1.**

### Controllers (split by entity)

```
controllers/
├── sku.controller.ts
├── channel.controller.ts
├── supplier.controller.ts
├── hub.controller.ts
├── customer.controller.ts
├── mapping.controller.ts
├── import.controller.ts
├── nm-template.controller.ts
└── data-quality.controller.ts
```

### API Endpoints đầy đủ (30 endpoints)

| Method | Path | Purpose |
|--------|------|---------|
| **SKU** | | |
| GET | `/api/v1/master-data/sku` | List + filter + pagination |
| GET | `/api/v1/master-data/sku/:id` | Detail + variants |
| POST | `/api/v1/master-data/sku` | Create SKU + optional variants |
| PATCH | `/api/v1/master-data/sku/:id` | Update |
| DELETE | `/api/v1/master-data/sku/:id` | Soft delete |
| **SKU Variant** | | |
| GET | `/api/v1/master-data/sku/:id/variants` | List variants |
| POST | `/api/v1/master-data/sku/:id/variants` | Add variant |
| DELETE | `/api/v1/master-data/variants/:id` | Soft delete |
| **Channel (CN)** | | |
| GET/POST/PATCH/DELETE | `/api/v1/master-data/channel[/:id]` | CRUD |
| **Supplier (NM)** | | |
| GET/POST/PATCH/DELETE | `/api/v1/master-data/supplier[/:id]` | CRUD |
| GET | `/api/v1/master-data/supplier/:id/upload-template` | Download CSV template cho NM |
| POST | `/api/v1/master-data/supplier/:id/lt-override` | SC Manager force override LT (M2 escape hatch) |
| PATCH | `/api/v1/master-data/sku/:id/change-nm` | Đổi NM cho SKU (audit critical) |
| **Hub** | | |
| GET/POST/PATCH/DELETE | `/api/v1/master-data/hub[/:id]` | CRUD |
| **Customer** | | |
| GET/POST/PATCH/DELETE | `/api/v1/master-data/customer[/:id]` | CRUD |
| **Mappings** | | |
| GET | `/api/v1/master-data/mapping/sku-nm` | List SKU-NM mappings |
| POST | `/api/v1/master-data/mapping/sku-nm` | Create mapping |
| GET/POST | `/api/v1/master-data/mapping/hub-cn` | Hub-CN cluster |
| GET/POST | `/api/v1/master-data/mapping/hub-nm` | Hub-NM assignment |
| **Bulk Import** | | |
| POST | `/api/v1/master-data/import/:entityType` | Upload CSV (multipart), `?dryRun=true` |
| **Data Quality** | | |
| GET | `/api/v1/master-data/quality` | 4 metrics dashboard |
| **Audit** | | |
| GET | `/api/v1/master-data/audit` | Audit log paginated, filter by entityType/entityId |

### C4 fix: FeatureFlag pattern (metadata-based)

```typescript
// common/decorators/feature-flag.decorator.ts
import { SetMetadata } from '@nestjs/common';
export const FEATURE_FLAG_KEY = 'feature_flag';
export const FeatureFlag = (flagKey: string) => SetMetadata(FEATURE_FLAG_KEY, flagKey);

// common/guards/feature-flag.guard.ts
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flagsService: SystemConfigService,  // M10 service
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flagKey = this.reflector.get<string>(FEATURE_FLAG_KEY, ctx.getHandler())
                 ?? this.reflector.get<string>(FEATURE_FLAG_KEY, ctx.getClass());
    if (!flagKey) return true;  // no flag → allow

    const enabled = await this.flagsService.isEnabled(flagKey);
    if (!enabled) throw new ServiceUnavailableException(`Feature ${flagKey} disabled`);
    return true;
  }
}
```

Dùng:
```typescript
@Controller('master-data/sku')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m00_master_data_enabled')
export class SkuController { /*...*/ }
```

### Example Controller: SKU

```typescript
// sku.controller.ts
@Controller('master-data/sku')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m00_master_data_enabled')
export class SkuController {
  constructor(private readonly svc: SkuService) {}

  @Get()
  findAll(@Query() q: SkuQueryDto) { return this.svc.findAll(q); }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Post()
  create(@Body() dto: CreateSkuDto) { return this.svc.create(dto); }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSkuDto,
    @Headers('x-user-id') actor: string,
  ) {
    return this.svc.update(id, dto, actor ?? 'system');
  }

  @Delete(':id')
  softDelete(@Param('id') id: string, @Headers('x-user-id') actor: string) {
    return this.svc.softDelete(id, actor ?? 'system');
  }
}
```

---

## §8 — Error Codes

Thêm vào `backend/src/common/errors.ts`:

```typescript
// Module M00 — Master Data (UNIS-ERR-050..069, reserved 20 codes)
MD_SKU_NOT_FOUND:         { code: 'UNIS-ERR-050', msg: 'SKU not found',                            status: 404 },
MD_SKU_CODE_DUPLICATE:    { code: 'UNIS-ERR-051', msg: 'SKU code đã tồn tại',                      status: 409 },
MD_NM_NOT_FOUND:          { code: 'UNIS-ERR-052', msg: 'Supplier (NM) not found hoặc inactive',    status: 404 },
MD_NM_CODE_DUPLICATE:     { code: 'UNIS-ERR-053', msg: 'NM code đã tồn tại',                       status: 409 },
MD_CN_NOT_FOUND:          { code: 'UNIS-ERR-054', msg: 'Channel (CN) not found',                   status: 404 },
MD_CN_CODE_DUPLICATE:     { code: 'UNIS-ERR-055', msg: 'CN code đã tồn tại',                       status: 409 },
MD_HUB_NOT_FOUND:         { code: 'UNIS-ERR-056', msg: 'Hub not found',                            status: 404 },
MD_VARIANT_NOT_FOUND:     { code: 'UNIS-ERR-057', msg: 'SKU variant not found',                    status: 404 },
MD_VARIANT_CODE_DUP:      { code: 'UNIS-ERR-058', msg: 'Variant code đã tồn tại',                  status: 409 },
MD_INVALID_LT:            { code: 'UNIS-ERR-059', msg: 'Lead time phải > 0',                       status: 400 },
MD_SUPPLIER_IN_USE:       { code: 'UNIS-ERR-060', msg: 'Không thể xóa NM đang có SKU active',      status: 409 },
MD_SKU_VARIANT_IN_USE:    { code: 'UNIS-ERR-061', msg: 'Variant đang được dùng trong snapshot',    status: 409 },
MD_CIRCULAR_MAPPING:      { code: 'UNIS-ERR-062', msg: 'Circular mapping detected',                status: 409 },
MD_IMPORT_TOO_MANY:       { code: 'UNIS-ERR-063', msg: 'Import file > 500 rows',                   status: 413 },
MD_IMPORT_INVALID_HEADER: { code: 'UNIS-ERR-064', msg: 'CSV header không hợp lệ',                  status: 400 },
MD_CUSTOMER_NOT_FOUND:    { code: 'UNIS-ERR-065', msg: 'Customer not found',                       status: 404 },
MD_LANE_NOT_FOUND:        { code: 'UNIS-ERR-066', msg: 'Transport lane not found',                 status: 404 },
MD_SINGLE_SOURCE_VIOLATED:{ code: 'UNIS-ERR-067', msg: 'SKU chỉ được map 1 NM active',             status: 409 },
MD_LT_OVERRIDE_REASON:    { code: 'UNIS-ERR-068', msg: 'LT override bắt buộc reason',               status: 400 },
```

> **Reserved range:** UNIS-ERR-050 → UNIS-ERR-069 dành cho M00. Đã dùng 19/20.

---

## §9 — Frontend Types + API Layer

File path: `frontend/lib/api/master-data.ts`

```typescript
const BASE = '/api/v1/master-data';

// ─── Types ────────────────────────────────────────────────────────────
// R2 fix: sku entity không có field nmId sau C1 — relationship qua nmMappings[]
export interface SkuNmMapping {
  id: string;
  skuId: string;
  nmId: string;
  moq: number;
  priority: number;
  active: boolean;
  supplier?: Supplier;
}

export interface Sku {
  id: string;
  skuCode: string;
  skuName: string;
  uom: string;
  productGroup: string | null;
  // C1: nmId moved to nmMappings[]. Active mapping = nmMappings.find(m => m.active)
  nmMappings?: SkuNmMapping[];
  supplier?: Supplier;    // convenience: populated from active nmMapping.supplier
  variants?: SkuVariant[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkuVariant {
  id: string;
  skuId: string;
  variantCode: string;
  variantSuffix: string;
  variantName: string | null;
  attrs: object | null;
  active: boolean;
}

export interface Channel {
  id: string;
  cnCode: string;
  cnName: string;
  region: string | null;
  address: string | null;
  lat: number;
  lng: number;
  connectivity: 'GOOD' | 'MEDIUM' | 'WEAK';
  active: boolean;
}

export interface Supplier {
  id: string;
  nmCode: string;
  nmName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  leadTimeDays: number;
  ltSigma: number | null;
  capacityMonthly: number | null;
  honoringRate: number | null;
  relationshipScore: number | null;
  active: boolean;
}

export interface Hub { id: string; hubCode: string; hubName: string; hubType: 'VIRTUAL' | 'PHYSICAL'; /*...*/ }
export interface Customer { id: string; customerCode: string; customerName: string; /*...*/ }

export interface PageResult<T> { data: T[]; total: number; page: number; pageSize: number; }

export interface ImportResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: { lineNumber: number; field?: string; message: string; rawData: object }[];
  insertedIds?: string[];
}

export interface DataQualityMetrics {
  skuWithoutNm: number;
  cnWithoutLatLng: number;
  nmWithoutSkus: number;
  skuNoRecentSupply: number;
}

// ─── API Functions ────────────────────────────────────────────────────
async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

// SKU
export const fetchSkus = (params: Partial<{search: string; nmId: string; page: number; pageSize: number}> = {}) => {
  const qs = new URLSearchParams(params as any).toString();
  return req<PageResult<Sku>>(`${BASE}/sku?${qs}`);
};
export const fetchSku = (id: string) => req<Sku>(`${BASE}/sku/${id}`);
export const createSku = (body: Partial<Sku> & { variants?: Partial<SkuVariant>[] }) =>
  req<Sku>(`${BASE}/sku`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
export const updateSku = (id: string, body: Partial<Sku>) =>
  req<Sku>(`${BASE}/sku/${id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
export const deleteSku = (id: string) => req<void>(`${BASE}/sku/${id}`, { method: 'DELETE' });

// Channel, Supplier, Hub, Customer — cùng pattern

// Import
export const importCsv = async (entityType: string, file: File, dryRun = true) => {
  const fd = new FormData();
  fd.append('file', file);
  return req<ImportResult>(`${BASE}/import/${entityType}?dryRun=${dryRun}`, { method: 'POST', body: fd });
};

// Data Quality
export const fetchDataQuality = () => req<DataQualityMetrics>(`${BASE}/quality`);

// NM Template download
export const downloadNmTemplate = (nmId: string) => `${BASE}/supplier/${nmId}/upload-template`;
```

---

## §10 — Frontend Pages

File path: `frontend/app/master-data/`

### Page structure

```
app/master-data/
├── layout.tsx                    ← Shared sidebar + breadcrumb for all master-data pages
├── page.tsx                      ← Landing: navigation cards + quality dashboard widget
├── sku/
│   ├── page.tsx                  ← SKU list + search + filter
│   ├── [id]/page.tsx             ← SKU detail + variants editor
│   └── new/page.tsx              ← Create form
├── channel/
│   ├── page.tsx                  ← CN list + map view toggle
│   └── [id]/page.tsx
├── supplier/
│   ├── page.tsx                  ← NM list + "Download Template" per row
│   └── [id]/page.tsx
├── hub/
│   └── page.tsx
├── customer/
│   └── page.tsx
├── import/
│   └── page.tsx                  ← Bulk import wizard (pick entity → upload CSV → preview → commit)
└── quality/
    └── page.tsx                  ← Full data quality dashboard with drill-down
```

### Components

```
components/master-data/
├── sku/
│   ├── SkuTable.tsx
│   ├── SkuForm.tsx
│   └── VariantEditor.tsx
├── channel/
│   ├── ChannelTable.tsx
│   ├── ChannelForm.tsx
│   └── ChannelMapView.tsx       ← Leaflet/Google Map hiển thị lat/lng CN
├── supplier/
│   ├── SupplierTable.tsx
│   ├── SupplierForm.tsx
│   └── TemplateDownloadButton.tsx
├── import/
│   ├── ImportWizard.tsx          ← 3-step: upload → preview → commit
│   ├── ImportPreviewTable.tsx
│   └── ImportErrorList.tsx
└── quality/
    ├── QualityCard.tsx           ← 4 cards
    └── QualityDrillDown.tsx
```

### UX Notes

- **Sidebar nav:** thêm `/master-data` ở top (trước `/demand`) — foundation-first
- **Search:** debounced 300ms, ILIKE trên code+name
- **Bulk import flow:** `dryRun=true` mặc định → hiện preview table → user confirm → gọi lại `dryRun=false`
- **Map view (CN):** cluster markers, click CN → popup info
- **Template download:** mỗi row NM có button → GET `/supplier/:id/upload-template` → trình duyệt tải CSV
- **Data quality widget trên landing page:** 4 cards kèm "View Details" link drill-down

---

## §11 — Integration Points

### 11.1 Feature Flag

```typescript
// Tất cả controller M00 phải wrap (R4 fix: dùng decorator pair, không phải factory call):
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m00_master_data_enabled')
```

Flag config trong `system_config` (M10):
```sql
INSERT INTO system_config (config_group, config_key, config_value, value_type, description)
VALUES ('FEATURE_TOGGLE', 'feature.m00_master_data.enabled', 'true', 'BOOLEAN', 'M00 Master Data Platform');
```

### 11.2 Service exports (cho module khác dùng)

```typescript
// master-data.module.ts
@Module({
  // ...
  exports: [SkuService, ChannelService, SupplierService, HubService, CustomerService, MappingService],
})
export class MasterDataModule {}
```

Module khác inject:
```typescript
// Ví dụ M11 Demand Aggregate:
constructor(private readonly skuService: SkuService) {}

async validateSku(skuCode: string) {
  const sku = await this.skuService.findByCode(skuCode);
  if (!sku) throwUnisError(DEMAND_ERR.SKU_UNKNOWN);
}
```

### 11.3 M28 Auto-update (future, Phase 1 stub)

**m6 fix — Integration style:** M28 **inject `SupplierService` trực tiếp** (internal service call),
KHÔNG gọi qua HTTP. Cần export trong MasterDataModule (xem §11.2).

M28 Feedback sẽ cập nhật:
- `supplier.lead_time_days` (rolling average)
- `supplier.honoring_rate`
- `transport_lane.transit_lt_days`
- `supplier.lt_sigma`

M00 cung cấp 2 method + 1 override endpoint:

```typescript
// supplier.service.ts

// R7 fix: SupplierService cần inject AlertService. Thêm vào constructor:
// constructor(
//   @InjectRepository(Supplier) private readonly supplierRepo: Repository<Supplier>,
//   private readonly audit: AuditService,
//   private readonly dataSource: DataSource,
//   private readonly alertService: AlertService,  // <-- ADD THIS
// ) {}

// M28 gọi method này mỗi PO closed
async autoUpdateLt(nmId: string, newLt: number, actor = 'M28_AUTO'): Promise<void> {
  const existing = await this.findOne(nmId);
  const deltaPct = Math.abs((newLt - existing.leadTimeDays) / existing.leadTimeDays) * 100;

  // Safety gate: >30% change → KHÔNG auto-apply, increment drift counter
  if (deltaPct > 30) {
    const counter = await this.incrementDriftCounter(nmId);

    // M2 fix — escape hatch: 3 lần drift liên tiếp → force apply với audit
    if (counter >= 3) {
      existing.leadTimeDays = newLt;
      await this.supplierRepo.save(existing);
      await this.audit.log(null, 'SUPPLIER', nmId, 'UPDATE',
        { leadTimeDays: [existing.leadTimeDays, newLt], driftCounter: counter },
        actor, 'M28_AUTO');
      await this.resetDriftCounter(nmId);
      await this.alertService.create({
        type: 'MD_LT_FORCE_UPDATE',
        message: `NM ${existing.nmCode}: LT force-updated sau 3 lần drift ${deltaPct.toFixed(1)}% (${existing.leadTimeDays} → ${newLt})`,
        severity: 'INFO',
      });
      return;
    }

    // Chưa đủ 3 lần → chỉ alert, chờ SC Manager review
    await this.alertService.create({
      type: 'MD_LT_DRIFT',
      message: `NM ${existing.nmCode} LT drift ${deltaPct.toFixed(1)}% (${counter}/3). SC Manager review hoặc chờ confirm lần 3.`,
      severity: 'WARNING',
    });
    return;
  }

  // <30% — auto-apply bình thường
  await this.resetDriftCounter(nmId);
  existing.leadTimeDays = newLt;
  await this.supplierRepo.save(existing);
  await this.audit.log(null, 'SUPPLIER', nmId, 'UPDATE',
    { leadTimeDays: [existing.leadTimeDays, newLt] }, actor, 'M28_AUTO');
}

// M2 fix: endpoint cho SC Manager force override LT (bypass drift gate)
async forceOverrideLt(nmId: string, dto: LtOverrideDto): Promise<void> {
  const existing = await this.findOne(nmId);
  existing.leadTimeDays = dto.newLt;
  if (dto.newLtSigma != null) existing.ltSigma = dto.newLtSigma;
  await this.supplierRepo.save(existing);
  await this.resetDriftCounter(nmId);
  await this.audit.log(null, 'SUPPLIER', nmId, 'UPDATE',
    { leadTimeDays: [existing.leadTimeDays, dto.newLt], reason: [null, dto.reason] },
    dto.approvedBy, 'UI');
}
```

**New endpoint:**
```
POST /api/v1/master-data/supplier/:id/lt-override
Body: { newLt: number, newLtSigma?: number, reason: string, approvedBy: string }
```

**Drift counter storage:** Dùng Redis với TTL 7 ngày, hoặc thêm column `supplier.lt_drift_count INT DEFAULT 0` (simpler Phase 1).

### 11.4 Policy Snapshot Pin (Rule 14)

M00 **không có DRP chain** → không cần pin `policy_run_id`. Nhưng:
- Khi M23/M24/M25 đọc master data, phải capture snapshot tại thời điểm run
- → Sẽ được handle trong M23 spec (reference M00 snapshot version)

---

## §12 — Task Checklist

### DA1 (Data Architect)
```
DA-1  [ ] Review schema 13 tables — confirm PK/FK/index
DA-2  [ ] Migration V001 .up.sql + .down.sql (§3)
DA-3  [ ] Migration V002 seed transport_lane cho tất cả NM×CN + CN×CN <= 500km
DA-4  [ ] Validate partial unique index `uq_sku_single_nm` hoạt động đúng
DA-5  [ ] Data quality queries (§6.6) — test trên staging DB
DA-6  [ ] Sample data cho dev/test: 10 NM + 50 SKU + 5 CN + 3 Hub
```

### BE3 (Backend)
```
BE-1  [ ] Tạo src/master-data/ với cấu trúc theo Rule 2
BE-2  [ ] 11 Entities (§4)
BE-3  [ ] DTOs + class-validator (§5)
BE-4  [ ] 11 Services (SKU, Variant, CN, NM, Hub, Customer, Mapping, Import, NmTemplate, DataQuality, Audit)
BE-5  [ ] 9 Controllers (§7) — tất cả wrap FeatureFlagGuard
BE-6  [ ] MasterDataModule + register trong app.module.ts
BE-7  [ ] Error codes UNIS-ERR-050..067 trong common/errors.ts
BE-8  [ ] Service export cho module khác (§11.2)
BE-9  [ ] Audit hooks trong mọi create/update/delete
BE-10 [ ] M28 auto-update stub method (§11.3)
BE-11 [ ] Unit test ≥ 70% coverage cho mọi service
BE-12 [ ] Integration test cho import flow (dry-run → commit)
BE-13 [ ] Swagger docs cho 30 endpoints
```

### FE2 (Frontend)
```
FE-1  [ ] lib/api/master-data.ts (types + API functions)
FE-2  [ ] app/master-data/page.tsx (landing + quality widget)
FE-3  [ ] SKU CRUD pages + VariantEditor
FE-4  [ ] CN CRUD pages + map view (Leaflet)
FE-5  [ ] NM CRUD pages + Template Download button
FE-6  [ ] Hub CRUD pages
FE-7  [ ] Customer CRUD pages
FE-8  [ ] Mapping management (SKU-NM, Hub-CN, Hub-NM)
FE-9  [ ] Bulk Import wizard (3-step)
FE-10 [ ] Data Quality dashboard (4 cards + drill-down)
FE-11 [ ] Audit log viewer (filter by entity)
FE-12 [ ] Sidebar nav: thêm /master-data ở top
FE-13 [ ] FeatureGate wrapper component (nếu flag off → show maintenance page)
```

### QA
```
QA-1  [ ] POST SKU không có nmId → 400 validation error
QA-2  [ ] POST SKU với nmId không tồn tại → 404 MD_NM_NOT_FOUND
QA-3  [ ] POST SKU với sku_code duplicate → 409 MD_SKU_CODE_DUPLICATE
QA-4  [ ] POST variant không có sku_id → 400
QA-5  [ ] POST variant với variant_code duplicate → 409
QA-6  [ ] POST channel không có lat/lng → 400
QA-7  [ ] DELETE supplier đang có active SKU → 409 MD_SUPPLIER_IN_USE
QA-8  [ ] Import CSV 501 rows → 413 MD_IMPORT_TOO_MANY
QA-9  [ ] Import CSV với header sai → 400 MD_IMPORT_INVALID_HEADER
QA-10 [ ] Import dry-run 100 rows (80 valid, 20 invalid) → preview returns 20 errors, 80 valid
QA-11 [ ] Import commit 80 valid rows → 80 rows inserted + audit log 80 entries
QA-12 [ ] GET /supplier/:id/upload-template → CSV file với SKU của NM đó
QA-13 [ ] GET /quality → 4 metrics đúng trên test data
QA-14 [ ] Soft delete SKU → active=false, GET list (activeOnly=true) không trả về
QA-15 [ ] Audit log ghi đúng action/changed_fields/changed_by
QA-16 [ ] Partial unique index: tạo 2 mapping SKU-NM active cùng SKU → 409
QA-17 [ ] Update NM lead_time_days → audit log có diff {leadTimeDays: [old, new]}
QA-18 [ ] Feature flag off → tất cả endpoint 503 Service Unavailable
QA-19 [ ] POST /supplier/:id/lt-override không có reason → 400 MD_LT_OVERRIDE_REASON
QA-20 [ ] M28 autoUpdateLt với delta 35% lần 1-2 → alert WARNING, không update
QA-21 [ ] M28 autoUpdateLt với delta 35% lần 3 → force update + alert INFO + audit
QA-22 [ ] Import CSV atomic: 100 rows, fail row 50 ở DB layer → 0 rows committed (M1)
QA-23 [ ] POST /sku/:id/change-nm không có reason → 400
QA-24 [ ] POST 2 SKU cùng variant_code nhưng khác sku_id → thành công (C2)
QA-25 [ ] POST 2 variant cùng (sku_id, variant_code) → 409 MD_VARIANT_CODE_DUP (C2)
```

### DevOps (DevOps1)
```
OPS-1 [ ] CI: migration auto-run on deploy
OPS-2 [ ] Feature flag infra: `m00_master_data_enabled` default=true staging, =false prod
OPS-3 [ ] Backup strategy: master data daily pg_dump
OPS-4 [ ] Monitoring: alert nếu /api/v1/master-data/quality có metric > threshold
```

---

## §13 — Dev Notes

1. **C1 resolved — No FK circular:** Sau khi bỏ `sku.nm_id`, không còn vòng tròn. SKU ↔ Supplier chỉ qua `sku_nm_mapping`. Tạo `sku` trước, `supplier` sau, `sku_nm_mapping` cuối cùng với 2 FKs.

2. **Single-source rule enforcement:** Partial unique index `uq_sku_single_nm ON sku_nm_mapping(sku_id) WHERE active = TRUE` — database-level, không dựa vào service logic.

3. **Soft delete gotcha:** Khi deactivate NM, phải check trước nếu có SKU active đang ref → reject. Đừng cascade deactivate SKU tự động (risk mất data).

4. **BIGSERIAL → JS string:** TypeORM trả `id` là string. Đừng so sánh `id === 1` — phải `id === '1'` hoặc convert. DTO nhận string.

5. **Audit log performance:** Ghi đồng bộ trong transaction chấp nhận được cho CRUD nhỏ. Nếu import 500 rows → 500 audit entries OK. Không cần async queue Phase 1.

6. **Import dry-run pattern:** Validate tất cả rows trước khi commit bất kỳ row nào. Không "fail fast" — phải show user toàn bộ errors để họ fix 1 lần.

7. **NM Template encoding:** CSV UTF-8 BOM `\uFEFF` để Excel Windows mở không lỗi tiếng Việt.

8. **Data Quality queries:** Chạy real-time OK cho Phase 1. Nếu dataset lớn (>10K SKU) → materialized view refresh hourly.

9. **Transport lane seed:** Generate Cartesian product NM×CN + CN×CN tại sprint setup. Sau đó M28 sẽ tinh chỉnh `transit_lt_days` dần qua actual PO data.

10. **Map component library:** Phase 1 dùng Leaflet (free, OSS). Phase 2 nếu cần routing → Google Maps.

11. **Auth actor:** Phase 1 dùng header `X-User-Id` (free-text), không JWT. Phase 2 sẽ replace bằng JWT decoded.

12. **Idempotent seed:** Seed scripts dùng `ON CONFLICT DO NOTHING` — chạy lại không duplicate.

13. **M3 Tech Debt:** `supply_snapshot_line.item_code` (M2) là VARCHAR — không FK tới `sku.id`. Query DQ `skuNoRecentSupply` join qua string coupling. **Phase 3 cleanup:** M2 migration thêm `sku_id` FK, backfill từ `item_code` → `sku.sku_code`, sau đó drop `item_code`. Flag trong backlog.

14. **C2 variant_code scope:** Unique theo `(sku_id, variant_code)` — 2 SKU khác nhau có thể dùng cùng suffix "A4". Khi query variant global (hiếm), phải kèm `sku_id`. Convention khuyến nghị: `{sku_code}-{suffix}` nhưng không enforce.

15. **M28 drift counter storage:** Phase 1 khuyến nghị thêm column `supplier.lt_drift_count INT DEFAULT 0` (simpler). Phase 2 migrate sang Redis với TTL 7 ngày nếu perf issue.

16. **EntityManager vs Repository pattern:** Mọi service có 2 variants — `create(dto)` (tự transaction) và `createWithMgr(mgr, dto)` (nhận sẵn manager). Import service dùng `createWithMgr` để atomic multi-row. Controller external call dùng `create()`.

---

## §14 — Migration Dependencies (order matters)

**m3 fix:** Chốt timestamp convention (TypeORM) — không dùng V-number.

```
Sprint 1:
  20260417_m00_create_master_data_tables.up.sql      (13 tables, partial unique index INLINE)
  20260417_m00_create_master_data_tables.down.sql    (rollback)
  20260418_m00_seed_sample_data.up.sql               (dev/test: 10 NM + 50 SKU + 5 CN + 3 Hub)
  20260418_m00_seed_sample_data.down.sql

Sprint 2:
  20260420_m00_seed_transport_lanes.up.sql           (NM×CN + CN×CN <= 500km)
  20260420_m00_seed_transport_lanes.down.sql
```

> **Lưu ý:** Partial unique index `uq_sku_single_nm` đã INLINE trong migration tạo `sku_nm_mapping` (§3). Không cần migration riêng V004.
>
> **Sample data seed:** DA1 generate SQL thực từ DA requirements — spec không embed SQL vì dataset phụ thuộc môi trường dev cụ thể. Template: insert 10 NM trước, insert 50 SKU + 50 sku_nm_mapping, insert 5 CN, insert 3 Hub, insert hub_cn_cluster + hub_nm_assignment.

---

## §15 — DoD (Definition of Done)

- [ ] Schema 13 tables deployed lên staging
- [ ] Migration `.up` + `.down` test rollback thành công
- [ ] 30 API endpoints Swagger documented
- [ ] Unit test coverage ≥ 70% cho service layer
- [ ] Integration test: import flow end-to-end
- [ ] FE pages đầy đủ cho 6 entities + import + quality
- [ ] 25 QA cases pass (QA-1 → QA-25)
- [ ] Feature flag bật được/tắt được không ảnh hưởng module khác
- [ ] DA1 confirm data integrity trên staging (10 NM + 50 SKU + 5 CN + 3 Hub)
- [ ] Tech Lead review PR: không vi phạm PHASE2-DEV-RULES
- [ ] Sample data loaded cho các module sau (M11, M21, M22...) dùng

---

*M00 Master Data Platform Spec v1.2 — 2026-04-16 (post-review fix R1-R7)*
