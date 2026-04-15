# MODULE 3: INVENTORY POLICY — BẢN IMPLEMENT HOÀN CHỈNH A→Z

**Date:** 2026-04-14 (v1.2 — Bug fixes: BUG-A ssDosCap consistent, BUG-B N+1→batch pre-load, BUG-C N+1 importAbc→buildAbcRankMap, ISSUE-1 latest FROZEN, ISSUE-2 location sigma, ISSUE-3 getSsFinal implementation)
**Author:** Tech Lead
**Mục đích:** Dev đọc file này → biết chính xác cần build gì, ở đâu, thứ tự nào
**BA Spec ref:** `docs/03-inventory-policy.md` (SCP-UNIS-03 v1.0)

---

## ⚠️ UNIS CONSTRAINTS — ĐỌC TRƯỚC KHI CODE

```
1. KHÔNG có tenant_id: UNIS single-tenant — bỏ tất cả WHERE tenant_id = :x
   BA spec có tenant_id ở mọi table → BỎ HOÀN TOÀN

2. item_code VARCHAR(50) (không phải item_id BIGINT):
   FK: item_code VARCHAR(50) → item.item_code
   BA spec dùng item_id BIGINT → SỬA THÀNH item_code VARCHAR(50)

3. location_code VARCHAR(20) (không phải location_id BIGINT):
   FK: location_code VARCHAR(20) → location.location_code
   BA spec dùng location_id BIGINT → SỬA THÀNH location_code VARCHAR(20)

4. API prefix: /api/v1/policy/...
   Không có /api/v1/tenant/:id/policy/...

5. Tech stack:
   Backend:  NestJS 10 + TypeORM + PostgreSQL
   Frontend: Next.js 14 + TailwindCSS
   File:     src/policy/ (NestJS module mới, đăng ký trong app.module.ts)

6. ABC segment KHÔNG tự tính:
   UNIS đã có ABC từ forecast team → import từ demand_snapshot_line.segment
   SCP chỉ cross-check (alert nếu discrepancy > 10%), KHÔNG override forecast team

7. location_relationship trong BA spec = rtm_rule trong 00-master-data.md:
   Table thực tế đặt tên rtm_rule (đã confirm trong master data spec)

8. tenant_config KHÔNG tồn tại:
   Dùng UNIS_CONFIG constants trong unis-config.ts (xem §CONFIG block dưới)
```

---

## KIẾN TRÚC MODULE

```
Module 3 nhận input từ:
  - Module 1: demand_snapshot_line.segment (ABC)
            : demand_forecast_detail.qty_sold_12m_avg, qty_sold_3m_avg (ADU/sigma)
  - Module 2: supply_snapshot_line (tồn kho per item × location)
  - Master data: item_location_config.lead_time_days (LT)
               : rtm_rule (routing CN → warehouse)

Module 3 output cho:
  - Module 4 (DRP Netting): safety_stock_target.ss_final → threshold netting
  - Module 5 (Allocation):  rtm_rule → warehouse selection
  - Module 4 cũng cần:      item_abc_classification.abc_class → priority

Flow tổng:
  [Import ABC từ snapshot] → [item_abc_classification]
  [Trigger Calculate SS]   → [Batch 4,800 combinations] → [safety_stock_target DRAFT]
  [SC Manager Activate]    → [policy_run.status = ACTIVE]
  [RTM load/view]          → [rtm_rule table] → [resolve endpoint]

Page: /policy
  Tab 1: ABC Classification (import + cross-check + view)
  Tab 2: Safety Stock (calculate + view targets + override)
  Tab 3: RTM Rules (view + resolve per branch)
```

---

## UNIS CONFIG CONSTANTS

```typescript
// File: backend/src/policy/unis-config.ts

export const UNIS_CONFIG = {
  // Safety Stock — Z-scores theo ABC class
  Z_SCORES: {
    A: 1.96,    // CSL 97.5%
    B: 1.645,   // CSL 95%
    C: 1.282,   // CSL 90%
  },

  // Days of Supply cap per ABC class
  DOS_TARGETS: {
    A: 14,   // 2 tuần
    B: 21,   // 3 tuần
    C: 30,   // ~1 tháng
  },

  // Lead Time variability coefficient (default)
  LT_VARIABILITY_PCT: 0.20,   // σ_LT = LT × 20%

  // Sigma source
  SIGMA_SOURCE: 'fc_error' as const,  // dùng forecast error, không phải demand volatility

  // Fallback sigma khi < 3 fc_error data points
  SIGMA_FALLBACK_PCT: 0.30,   // qty_3m_avg × 30%

  // LCNB mode — Phase 1: chỉ detect, không execute
  LCNB_MODE: 'DETECT_ONLY' as const,
  LCNB_FACTOR: -0.25,   // -25% SS nếu EXECUTE mode

  // ABC cross-check threshold
  ABC_DISCREPANCY_THRESHOLD: 0.10,  // alert nếu > 10%

  // Batch size khi tính SS
  SS_BATCH_SIZE: 100,
} as const;
```

---

## DATABASE SCHEMA

### Table: item_abc_classification

```sql
-- Import ABC từ forecast team + cross-check
CREATE TABLE item_abc_classification (
    id                  BIGSERIAL       PRIMARY KEY,
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    abc_class           CHAR(1)         NOT NULL CHECK (abc_class IN ('A','B','C')),
    source              VARCHAR(30)     NOT NULL DEFAULT 'FORECAST_TEAM',
      -- FORECAST_TEAM | INTERNAL_CALC
    snapshot_id         UUID            NOT NULL REFERENCES demand_snapshot(id),
      -- snapshot gốc để trace nguồn ABC
    annual_volume       DECIMAL(18,2),  -- volume dùng để cross-check
    internal_class      CHAR(1)         CHECK (internal_class IN ('A','B','C')),
      -- SCP internal calc — chỉ dùng cho cross-check
    discrepancy_flag    BOOLEAN         NOT NULL DEFAULT FALSE,
      -- TRUE nếu forecast ≠ internal > 10%
    effective_date      DATE            NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW(),

    UNIQUE (item_code, snapshot_id)
    -- Mỗi item chỉ có 1 ABC record per snapshot
);

CREATE INDEX idx_abc_item_code ON item_abc_classification(item_code);
CREATE INDEX idx_abc_snapshot_id ON item_abc_classification(snapshot_id);
CREATE INDEX idx_abc_class ON item_abc_classification(abc_class);
CREATE INDEX idx_abc_discrepancy ON item_abc_classification(discrepancy_flag) WHERE discrepancy_flag = TRUE;
```

### Table: item_location_config

```sql
-- Lead time per item × location — source of truth cho Safety Stock
-- Phase 1: default từ location.lead_time_days (TerraX branches.lead_days)
-- Phase 2+: granular per item khi UNIS track NM lead time variance
CREATE TABLE item_location_config (
    id                      BIGSERIAL       PRIMARY KEY,
    item_code               VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    location_code           VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    lead_time_days          INT             NOT NULL DEFAULT 5,
      -- LT từ location → item tại location này (ngày)
    lead_time_variability   DECIMAL(5,4)    NOT NULL DEFAULT 0.20,
      -- σ_LT = LT × lead_time_variability (default 20%)
    is_active               BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP       NOT NULL DEFAULT NOW(),

    UNIQUE (item_code, location_code)
);

CREATE INDEX idx_ilc_item_code ON item_location_config(item_code);
CREATE INDEX idx_ilc_location_code ON item_location_config(location_code);

-- NOTE: Phase 1 — DA seed table này từ location.lead_time_days:
-- INSERT INTO item_location_config (item_code, location_code, lead_time_days)
-- SELECT i.item_code, l.location_code, COALESCE(l.lead_time_days, 5)
-- FROM item i CROSS JOIN location l WHERE l.location_type IN ('WAREHOUSE','FACTORY')
-- ON CONFLICT DO NOTHING;
```

### Table: safety_stock_target

```sql
-- Output của SS calculation — DRP Module 4 reads ss_final
CREATE TABLE safety_stock_target (
    id                  BIGSERIAL       PRIMARY KEY,
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    location_code       VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    policy_run_id       BIGINT          NOT NULL REFERENCES policy_run(id),
    abc_class           CHAR(1)         NOT NULL CHECK (abc_class IN ('A','B','C')),
    csl_target          DECIMAL(5,4)    NOT NULL,   -- 0.975 / 0.95 / 0.90
    z_score             DECIMAL(5,3)    NOT NULL,   -- 1.96 / 1.645 / 1.282
    lead_time_days      INT             NOT NULL,
    sigma_demand        DECIMAL(15,4)   NOT NULL,   -- σ từ fc_error (hoặc fallback)
    sigma_lt            DECIMAL(10,4)   NOT NULL,   -- LT × variability_pct
    adu                 DECIMAL(15,4)   NOT NULL,   -- Average Daily Usage
    ss_formula          DECIMAL(15,2)   NOT NULL,   -- raw formula output
    ss_dos_cap          DECIMAL(15,2)   NOT NULL,   -- ADU × DOS_target
    ss_final            INT             NOT NULL,   -- min(formula, cap), rounded up
    dos_target          INT             NOT NULL,   -- 14/21/30
    sigma_source        VARCHAR(20)     NOT NULL DEFAULT 'fc_error',
    lcnb_mode           VARCHAR(20)     NOT NULL DEFAULT 'DETECT_ONLY',
    lcnb_flag           BOOLEAN         NOT NULL DEFAULT FALSE,
      -- TRUE = item NÊN giảm SS (LCNB logic), nhưng DETECT_ONLY nên không tự giảm
    override_ss         INT,
      -- Planner manual override (nullable — nếu có thì DRP dùng cái này thay ss_final)
    override_reason     TEXT,
    override_by         VARCHAR(100),
    override_at         TIMESTAMP,
    snapshot_id         UUID            NOT NULL REFERENCES demand_snapshot(id),
      -- demand snapshot dùng để tính (trace)
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),

    UNIQUE (item_code, location_code, policy_run_id)
);

CREATE INDEX idx_sst_item_code ON safety_stock_target(item_code);
CREATE INDEX idx_sst_location_code ON safety_stock_target(location_code);
CREATE INDEX idx_sst_policy_run ON safety_stock_target(policy_run_id);
CREATE INDEX idx_sst_abc_class ON safety_stock_target(abc_class);
CREATE INDEX idx_sst_lcnb_flag ON safety_stock_target(lcnb_flag) WHERE lcnb_flag = TRUE;
```

### Table: policy_run

```sql
-- Track mỗi lần tính SS (DRAFT → ACTIVE)
-- Chỉ có 1 policy_run ACTIVE tại 1 thời điểm
CREATE TABLE policy_run (
    id                  BIGSERIAL       PRIMARY KEY,
    run_name            VARCHAR(200)    NOT NULL,
    status              VARCHAR(20)     NOT NULL DEFAULT 'DRAFT',
      -- DRAFT | ACTIVE | ARCHIVED
    demand_snapshot_id  UUID            NOT NULL REFERENCES demand_snapshot(id),
      -- snapshot dùng để tính ABC + sigma
    total_combinations  INT             NOT NULL DEFAULT 0,
      -- số item × location đã tính
    combinations_done   INT             NOT NULL DEFAULT 0,
    activated_by        VARCHAR(100),
    activated_at        TIMESTAMP,
    created_by          VARCHAR(100),
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_policy_run_status ON policy_run(status);
CREATE INDEX idx_policy_run_created ON policy_run(created_at DESC);

-- Constraint: chỉ 1 ACTIVE tại 1 thời điểm
-- Enforce trong service layer (không dùng DB partial unique vì phức tạp)
```

### Table: rtm_rule

```sql
-- Route-to-Market: CN lấy hàng từ warehouse nào, ưu tiên nào
-- Data ETL từ [Masterdata] Nơi kéo - Sheet1.csv (73 entries)
-- ĐỪNG nhầm: rtm_rule ≠ location_relationship (tên trong BA spec đã đổi)
CREATE TABLE rtm_rule (
    id                  BIGSERIAL       PRIMARY KEY,
    branch_code         VARCHAR(20)     NOT NULL REFERENCES location(location_code),
      -- CN (chi nhánh nhận hàng)
    warehouse_code      VARCHAR(20)     NOT NULL REFERENCES location(location_code),
      -- NM/Hub (nơi cung cấp hàng)
    priority            INT             NOT NULL CHECK (priority IN (1,2,3)),
      -- 1=P1 primary, 2=P2 fallback, 3=P3 hub
    transport_days      INT             NOT NULL DEFAULT 3,
      -- Lead time vận chuyển (ngày)
    transport_cost      DECIMAL(10,2),
    min_order_qty       DECIMAL(15,2),
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW(),

    UNIQUE (branch_code, warehouse_code)
    -- 1 CN chỉ có 1 rule per warehouse
);

CREATE INDEX idx_rtm_branch ON rtm_rule(branch_code);
CREATE INDEX idx_rtm_warehouse ON rtm_rule(warehouse_code);
CREATE INDEX idx_rtm_priority ON rtm_rule(branch_code, priority) WHERE is_active = TRUE;
```

---

## MIGRATION FILE

```
File: backend/src/policy/migrations/001_create_policy_tables.sql
```

```sql
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
    demand_snapshot_id  UUID            NOT NULL REFERENCES demand_snapshot(id),
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
    snapshot_id         UUID            NOT NULL REFERENCES demand_snapshot(id),
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
    snapshot_id         UUID            NOT NULL REFERENCES demand_snapshot(id),
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
CREATE INDEX IF NOT EXISTS idx_sst_item_code ON safety_stock_target(item_code);
CREATE INDEX IF NOT EXISTS idx_sst_location_code ON safety_stock_target(location_code);
CREATE INDEX IF NOT EXISTS idx_sst_policy_run ON safety_stock_target(policy_run_id);
CREATE INDEX IF NOT EXISTS idx_sst_lcnb_flag ON safety_stock_target(lcnb_flag) WHERE lcnb_flag = TRUE;
CREATE INDEX IF NOT EXISTS idx_rtm_branch ON rtm_rule(branch_code);
CREATE INDEX IF NOT EXISTS idx_rtm_priority ON rtm_rule(branch_code, priority) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_ilc_item_code ON item_location_config(item_code);
CREATE INDEX IF NOT EXISTS idx_policy_run_status ON policy_run(status);

COMMIT;
```

---

## ENTITY FILES

### policy-run.entity.ts

```typescript
// File: backend/src/policy/entities/policy-run.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('policy_run')
export class PolicyRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'run_name', length: 200 })
  runName: string;

  @Column({ length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

  @Column({ name: 'demand_snapshot_id', type: 'uuid' })
  demandSnapshotId: string;

  @Column({ name: 'total_combinations', default: 0 })
  totalCombinations: number;

  @Column({ name: 'combinations_done', default: 0 })
  combinationsDone: number;

  @Column({ name: 'activated_by', length: 100, nullable: true })
  activatedBy: string | null;

  @Column({ name: 'activated_at', type: 'timestamp', nullable: true })
  activatedAt: Date | null;

  @Column({ name: 'created_by', length: 100, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### item-abc-classification.entity.ts

```typescript
// File: backend/src/policy/entities/item-abc-classification.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('item_abc_classification')
export class ItemAbcClassification {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'abc_class', type: 'char', length: 1 })
  abcClass: 'A' | 'B' | 'C';

  @Column({ length: 30, default: 'FORECAST_TEAM' })
  source: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @Column({ name: 'annual_volume', type: 'decimal', precision: 18, scale: 2, nullable: true })
  annualVolume: number | null;

  @Column({ name: 'internal_class', type: 'char', length: 1, nullable: true })
  internalClass: 'A' | 'B' | 'C' | null;

  @Column({ name: 'discrepancy_flag', default: false })
  discrepancyFlag: boolean;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### safety-stock-target.entity.ts

```typescript
// File: backend/src/policy/entities/safety-stock-target.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PolicyRun } from './policy-run.entity';

@Entity('safety_stock_target')
export class SafetyStockTarget {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', length: 20 })
  locationCode: string;

  @Column({ name: 'policy_run_id', type: 'bigint' })
  policyRunId: string;

  @ManyToOne(() => PolicyRun)
  @JoinColumn({ name: 'policy_run_id' })
  policyRun: PolicyRun;

  @Column({ name: 'abc_class', type: 'char', length: 1 })
  abcClass: 'A' | 'B' | 'C';

  @Column({ name: 'csl_target', type: 'decimal', precision: 5, scale: 4 })
  cslTarget: number;

  @Column({ name: 'z_score', type: 'decimal', precision: 5, scale: 3 })
  zScore: number;

  @Column({ name: 'lead_time_days' })
  leadTimeDays: number;

  @Column({ name: 'sigma_demand', type: 'decimal', precision: 15, scale: 4 })
  sigmaDemand: number;

  @Column({ name: 'sigma_lt', type: 'decimal', precision: 10, scale: 4 })
  sigmaLt: number;

  @Column({ type: 'decimal', precision: 15, scale: 4 })
  adu: number;

  @Column({ name: 'ss_formula', type: 'decimal', precision: 15, scale: 2 })
  ssFormula: number;

  @Column({ name: 'ss_dos_cap', type: 'decimal', precision: 15, scale: 2 })
  ssDosCap: number;   // BUG-1 fix: ss_dos_cap → ssDosCap (thêm 's')

  @Column({ name: 'ss_final' })
  ssFinal: number;

  @Column({ name: 'dos_target' })
  dosTarget: number;

  @Column({ name: 'sigma_source', length: 20, default: 'fc_error' })
  sigmaSource: string;

  @Column({ name: 'lcnb_mode', length: 20, default: 'DETECT_ONLY' })
  lcnbMode: string;

  @Column({ name: 'lcnb_flag', default: false })
  lcnbFlag: boolean;

  @Column({ name: 'override_ss', nullable: true })
  overrideSs: number | null;

  @Column({ name: 'override_reason', type: 'text', nullable: true })
  overrideReason: string | null;

  @Column({ name: 'override_by', length: 100, nullable: true })
  overrideBy: string | null;

  @Column({ name: 'override_at', type: 'timestamp', nullable: true })
  overrideAt: Date | null;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### rtm-rule.entity.ts

```typescript
// File: backend/src/policy/entities/rtm-rule.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('rtm_rule')
export class RtmRule {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'branch_code', length: 20 })
  branchCode: string;

  @Column({ name: 'warehouse_code', length: 20 })
  warehouseCode: string;

  @Column({ type: 'int' })
  priority: 1 | 2 | 3;

  @Column({ name: 'transport_days', default: 3 })
  transportDays: number;

  @Column({ name: 'transport_cost', type: 'decimal', precision: 10, scale: 2, nullable: true })
  transportCost: number | null;

  @Column({ name: 'min_order_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
  minOrderQty: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

---

## SAFETY STOCK LOGIC

### Core Formula

```
SS = z(CSL) × √(LT × σ²_demand + ADU² × σ²_LT)

Sau đó cap: SS = min(SS_formula, ADU × DOS_target)
Sau đó round: SS = ceil(SS)
Minimum: SS = max(SS, 1) nếu ADU > 0
```

### Cách lấy σ_demand (fc_error based)

```
BUG-4 NOTE: demand_accuracy table CÓ TỒN TẠI trong schema UNIS (Module 1 đã migrate).
Columns thực tế (verified via API /demand/accuracy/skus):
  fsku (= item_code), actual_t10, actual_t11, actual_t12, actual_t1,
  fc_t12, fc_t1, fc_t2, fc_t3, acc_t12, acc_t1

QUAN TRỌNG: demand_accuracy KHÔNG có fc_t10, fc_t11 (chỉ có từ T12 trở đi).
→ Chỉ 2 data points dùng được cho fc_error: T12 và T1.
→ Phase 1: không đủ 3 data points → sẽ luôn dùng fallback (qty_3m_avg × 30%).
→ Phase 2 (khi có thêm tháng actual): tự động chuyển sang fc_error khi ≥ 3 points.

Column mapping đã xác nhận:
  demand_accuracy.fsku          → item_code (tên cột khác nhau)
  demand_forecast_detail.qty_sold_12m_avg → qtySold12mAvg (camelCase từ API)
  demand_forecast_detail.qty_sold_3m_avg  → qtySold3mAvg
  DB column names: qty_sold_12m_avg, qty_sold_3m_avg (snake_case trong DB)
```

```typescript
// Ưu tiên: dùng forecast error từ demand_accuracy (khi có đủ ≥ 3 data points)
// Phase 1: sẽ luôn fallback vì chỉ có T12+T1 = 2 data points
// Wrap trong try/catch: nếu table thay đổi schema → fallback an toàn

async function getSigmaDemand(
  itemCode: string,
  locationCode: string,
  snapshotId: string,
  dataSource: DataSource,
): Promise<{ sigma: number; source: 'fc_error' | 'fallback' }> {

  // Bước 1: Lấy forecast errors từ demand_accuracy
  // Chỉ dùng columns thực tế có đủ cả fc và actual: T12 và T1
  // BUG-4 fix: wrap try/catch để không crash nếu schema thay đổi
  try {
    const errors: { error_abs: number }[] = await dataSource.query(`
      SELECT ABS(fc_t12 - actual_t12) AS error_abs
      FROM demand_accuracy
      WHERE fsku = $1
        AND actual_t12 IS NOT NULL AND fc_t12 IS NOT NULL AND actual_t12 > 0
      UNION ALL
      SELECT ABS(fc_t1 - actual_t1)
      FROM demand_accuracy
      WHERE fsku = $1
        AND actual_t1 IS NOT NULL AND fc_t1 IS NOT NULL AND actual_t1 > 0
    `, [itemCode]);

    if (errors.length >= 3) {
      // Đủ data → dùng forecast error std
      const vals = errors.map(e => Number(e.error_abs));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      return { sigma: Math.sqrt(variance), source: 'fc_error' };
    }
    // < 3 data points → fallthrough to fallback
  } catch {
    // demand_accuracy unavailable or schema changed → fallback
  }

  // Fallback: qty_sold_3m_avg × SIGMA_FALLBACK_PCT (0.30)
  // Column DB: qty_sold_3m_avg (snake_case) — đã verified từ demand_forecast_detail schema
  const fallback: { qty_3m: string }[] = await dataSource.query(`
    SELECT COALESCE(SUM(qty_sold_3m_avg), 0)::text AS qty_3m
    FROM demand_forecast_detail
    WHERE demand_snapshot_id = $1
      AND item_code = $2
  `, [snapshotId, itemCode]);

  const qty3m = parseFloat(fallback[0]?.qty_3m ?? '0');
  return { sigma: qty3m * UNIS_CONFIG.SIGMA_FALLBACK_PCT, source: 'fallback' };
}
```

### calculateSafetyStock() — 1 item × 1 location

```typescript
interface SSResult {
  itemCode: string;
  locationCode: string;
  abcClass: 'A' | 'B' | 'C';
  zScore: number;
  cslTarget: number;
  leadTimeDays: number;
  sigmaDemand: number;
  sigmaLt: number;
  adu: number;
  ssFormula: number;
  ssDosCap: number;   // BUG-A fix: thống nhất ssDosCap (entity: ssDosCap, DB: ss_dos_cap)
  ssFinal: number;
  dosTarget: number;
  sigmaSource: string;
  lcnbMode: string;
  lcnbFlag: boolean;
}

async function calculateSafetyStock(
  itemCode: string,
  locationCode: string,
  snapshotId: string,
  dataSource: DataSource,
): Promise<SSResult> {

  // 1. Lấy ABC class (từ import vừa chạy)
  // BUG-5 fix: document rõ behavior khi không có ABC record
  // - 37 items UNIS unclassified + items trong supply_snapshot nhưng không có trong demand_snapshot
  // - Default về 'C': z=1.282, DOS=30 ngày → SS thấp, thận trọng
  // - Behavior này là đúng: items không rõ nguồn gốc → treat as low priority
  // - Dev KHÔNG cần xử lý thêm — ?? 'C' đã đủ
  const abc = await dataSource.query(`
    SELECT abc_class FROM item_abc_classification
    WHERE item_code = $1 AND snapshot_id = $2
    LIMIT 1
  `, [itemCode, snapshotId]);
  const abcClass: 'A' | 'B' | 'C' = abc[0]?.abc_class ?? 'C';
  // abc[0] = undefined → C-class (unclassified items, 37 items UNIS + items chưa import ABC)

  // 2. Lookup z-score, DOS target
  const zScore    = UNIS_CONFIG.Z_SCORES[abcClass];
  const dosTarget = UNIS_CONFIG.DOS_TARGETS[abcClass];
  const cslTarget = { A: 0.975, B: 0.95, C: 0.90 }[abcClass];

  // 3. Lead time từ item_location_config
  const ltConfig = await dataSource.query(`
    SELECT lead_time_days, lead_time_variability
    FROM item_location_config
    WHERE item_code = $1 AND location_code = $2 AND is_active = TRUE
    LIMIT 1
  `, [itemCode, locationCode]);
  const lt = ltConfig[0]?.lead_time_days ?? 5;  // default 5 ngày
  const ltVariability = ltConfig[0]?.lead_time_variability ?? UNIS_CONFIG.LT_VARIABILITY_PCT;
  const sigmaLt = lt * ltVariability;

  // 4. ADU = qty_sold_12m_avg / 365
  // Column DB: qty_sold_12m_avg — verified từ demand_forecast_detail (qtySold12mAvg trong API)
  // SUM vì item có nhiều branch rows → aggregate lên item level
  const aduRow = await dataSource.query(`
    SELECT COALESCE(SUM(qty_sold_12m_avg), 0)::text AS qty_12m
    FROM demand_forecast_detail
    WHERE demand_snapshot_id = $1 AND item_code = $2
  `, [snapshotId, itemCode]);
  const adu = parseFloat(aduRow[0]?.qty_12m ?? '0') / 365;

  // 5. sigma_demand (fc_error hoặc fallback)
  const { sigma: sigmaDemand, source: sigmaSource } =
    await getSigmaDemand(itemCode, locationCode, snapshotId, dataSource);

  // 6. Core formula: SS = z × √(LT × σ²_d + ADU² × σ²_LT)
  const ssFormula = zScore * Math.sqrt(lt * sigmaDemand ** 2 + adu ** 2 * sigmaLt ** 2);

  // 7. DOS cap
  const ssDoCap = adu * dosTarget;
  let ss = Math.min(ssFormula, ssDoCap);

  // 8. LCNB detect (DETECT_ONLY: chỉ flag, không giảm)
  const lcnbFlag = ss > 0 && (ssDoCap > 0) && (ssFormula > ssDoCap * 1.5);
  // Flag khi formula vượt DOS cap nhiều — candidate cho LCNB reduction

  // 9. Round up + minimum 1
  ss = Math.ceil(ss);
  if (adu > 0 && ss < 1) ss = 1;

  return {
    itemCode, locationCode, abcClass, zScore, cslTarget,
    leadTimeDays: lt, sigmaDemand, sigmaLt: sigmaLt, adu,
    ssFormula: Math.round(ssFormula * 100) / 100,
    ssDosCap: Math.round(ssDoCap * 100) / 100,  // BUG-1 fix: consistent với entity property ssDosCap
    ssFinal: ss,
    dosTarget, sigmaSource, lcnbMode: UNIS_CONFIG.LCNB_MODE, lcnbFlag,
  };
}
```

### Batch Calculate All (~4,800 combinations)

```
BUG-B fix: N+1 pattern cũ (4,800 × 4 queries = 19,200 queries → 5-10 phút) đã được thay
bằng pre-load toàn bộ data 1 lần (4 queries tổng), rồi compute in-memory.
Ước tính: 4 queries × <100ms + 4,800 in-memory calculations ≈ 2-5 giây.

ISSUE-1 fix: Chỉ lấy combinations từ LATEST FROZEN snapshot (không lấy từ tất cả FROZEN).
ISSUE-2 fix: getSigmaDemand fallback filter theo location_code (branch-level sigma, không network-level).
```

```typescript
// policy.service.ts — calculateAllSafetyStocks()

async calculateAllSafetyStocks(policyRunId: string, snapshotId: string): Promise<number> {

  // ISSUE-1 fix: chỉ lấy combinations từ LATEST FROZEN snapshot, không từ tất cả FROZEN
  const activeCombs: { item_code: string; location_code: string }[] =
    await this.dataSource.query(`
      SELECT DISTINCT ssl.item_code, ssl.location_code
      FROM supply_snapshot_line ssl
      WHERE ssl.snapshot_id = (
        SELECT id FROM supply_snapshot
        WHERE status = 'FROZEN'
        ORDER BY capture_at DESC
        LIMIT 1
      )
      ORDER BY ssl.item_code, ssl.location_code
    `);

  await this.policyRunRepo.update(policyRunId, {
    totalCombinations: activeCombs.length,
    combinationsDone: 0,
  });

  // BUG-B fix: Pre-load toàn bộ data cần thiết — 4 queries, không phải 4 × 4,800
  const [abcMap, ltConfigMap, aduMap, sigmaMap] = await Promise.all([
    this.loadAbcMap(snapshotId),           // Map<itemCode, 'A'|'B'|'C'>
    this.loadLtConfigMap(activeCombs),     // Map<'item||loc', { lt, variability }>
    this.loadAduMap(snapshotId),           // Map<itemCode, number>
    this.loadSigmaMap(snapshotId, activeCombs), // Map<'item||loc', { sigma, source }>
  ]);

  const results: Partial<SafetyStockTarget>[] = [];
  let done = 0;

  // Vòng lặp chỉ compute in-memory — không có DB query bên trong
  for (const { item_code, location_code } of activeCombs) {
    const abcClass = abcMap.get(item_code) ?? 'C';
    const ltCfg    = ltConfigMap.get(`${item_code}||${location_code}`);
    const lt       = ltCfg?.lt ?? 5;
    const ltVar    = ltCfg?.variability ?? UNIS_CONFIG.LT_VARIABILITY_PCT;
    const sigmaLt  = lt * ltVar;
    const adu      = aduMap.get(item_code) ?? 0;
    const sigmaDemandData = sigmaMap.get(`${item_code}||${location_code}`)
                         ?? { sigma: 0, source: 'fallback' as const };

    const zScore    = UNIS_CONFIG.Z_SCORES[abcClass];
    const dosTarget = UNIS_CONFIG.DOS_TARGETS[abcClass];
    const cslTarget = ({ A: 0.975, B: 0.95, C: 0.90 } as const)[abcClass];

    const ssFormula = zScore * Math.sqrt(lt * sigmaDemandData.sigma ** 2 + adu ** 2 * sigmaLt ** 2);
    const ssDosCap  = adu * dosTarget;

    // LCNB flag — custom heuristic Phase 1: flag khi formula vượt DOS cap hơn 50%
    // Đây là heuristic nội bộ, không có trong BA spec — Phase 2 sẽ dùng cost model chính xác hơn
    const lcnbFlag  = ssFormula > 0 && ssDosCap > 0 && ssFormula > ssDosCap * 1.5;

    let ssFinal = Math.ceil(Math.min(ssFormula, ssDosCap));
    if (adu > 0 && ssFinal < 1) ssFinal = 1;

    results.push({
      itemCode: item_code,
      locationCode: location_code,
      policyRunId,
      abcClass,
      cslTarget,
      zScore,
      leadTimeDays: lt,
      sigmaDemand: Math.round(sigmaDemandData.sigma * 10000) / 10000,
      sigmaLt: Math.round(sigmaLt * 10000) / 10000,
      adu: Math.round(adu * 10000) / 10000,
      ssFormula: Math.round(ssFormula * 100) / 100,
      ssDosCap: Math.round(ssDosCap * 100) / 100,   // BUG-A fix: ssDosCap nhất quán
      ssFinal,
      dosTarget,
      sigmaSource: sigmaDemandData.source,
      lcnbMode: UNIS_CONFIG.LCNB_MODE,
      lcnbFlag,
      snapshotId,
    });

    done++;

    if (results.length >= UNIS_CONFIG.SS_BATCH_SIZE) {
      await this.dataSource.transaction(async (em) => {
        await em.createQueryBuilder()
          .insert().into(SafetyStockTarget)
          .values(results as SafetyStockTarget[])
          .orIgnore()
          .execute();
      });
      results.length = 0;
      await this.policyRunRepo.update(policyRunId, { combinationsDone: done });
    }
  }

  if (results.length > 0) {
    await this.dataSource.transaction(async (em) => {
      await em.createQueryBuilder()
        .insert().into(SafetyStockTarget)
        .values(results as SafetyStockTarget[])
        .orIgnore()
        .execute();
    });
    await this.policyRunRepo.update(policyRunId, { combinationsDone: done });
  }

  return done;
}

// ─── Pre-load helpers (mỗi hàm = 1 query, trả về Map) ─────────────────────

private async loadAbcMap(snapshotId: string): Promise<Map<string, 'A'|'B'|'C'>> {
  const rows: { item_code: string; abc_class: string }[] = await this.dataSource.query(`
    SELECT item_code, abc_class FROM item_abc_classification WHERE snapshot_id = $1
  `, [snapshotId]);
  return new Map(rows.map(r => [r.item_code, r.abc_class as 'A'|'B'|'C']));
}

private async loadLtConfigMap(
  combs: { item_code: string; location_code: string }[],
): Promise<Map<string, { lt: number; variability: number }>> {
  if (combs.length === 0) return new Map();
  const keys = combs.map(c => `${c.item_code}||${c.location_code}`);
  const rows: { item_code: string; location_code: string; lead_time_days: number; lead_time_variability: string }[] =
    await this.dataSource.query(`
      SELECT item_code, location_code, lead_time_days, lead_time_variability
      FROM item_location_config
      WHERE (item_code || '||' || location_code) = ANY($1) AND is_active = TRUE
    `, [keys]);
  const map = new Map<string, { lt: number; variability: number }>();
  for (const r of rows) {
    map.set(`${r.item_code}||${r.location_code}`, {
      lt: r.lead_time_days,
      variability: parseFloat(r.lead_time_variability as any),
    });
  }
  return map;
}

private async loadAduMap(snapshotId: string): Promise<Map<string, number>> {
  // ADU = SUM(qty_sold_12m_avg) per item / 365 (sum across all branches = item-level)
  const rows: { item_code: string; qty_12m: string }[] = await this.dataSource.query(`
    SELECT item_code, SUM(qty_sold_12m_avg)::text AS qty_12m
    FROM demand_forecast_detail
    WHERE demand_snapshot_id = $1
    GROUP BY item_code
  `, [snapshotId]);
  return new Map(rows.map(r => [r.item_code, parseFloat(r.qty_12m) / 365]));
}

private async loadSigmaMap(
  snapshotId: string,
  combs: { item_code: string; location_code: string }[],
): Promise<Map<string, { sigma: number; source: 'fc_error' | 'fallback' }>> {
  const map = new Map<string, { sigma: number; source: 'fc_error' | 'fallback' }>();
  if (combs.length === 0) return map;

  // Bước 1: lấy fc_error từ demand_accuracy (chỉ T12 + T1 — 2 data points, Phase 1 → fallback)
  // Ghi nhớ: Phase 1 chưa đủ ≥ 3 points → tất cả đều fallback, nhưng code đã sẵn sàng cho Phase 2
  let fcErrorMap = new Map<string, number[]>();  // Map<itemCode, errors[]>
  try {
    const fcRows: { fsku: string; error_abs: string }[] = await this.dataSource.query(`
      SELECT fsku, ABS(fc_t12 - actual_t12) AS error_abs
      FROM demand_accuracy
      WHERE actual_t12 IS NOT NULL AND fc_t12 IS NOT NULL AND actual_t12 > 0
      UNION ALL
      SELECT fsku, ABS(fc_t1 - actual_t1)
      FROM demand_accuracy
      WHERE actual_t1 IS NOT NULL AND fc_t1 IS NOT NULL AND actual_t1 > 0
    `);
    for (const r of fcRows) {
      const arr = fcErrorMap.get(r.fsku) ?? [];
      arr.push(parseFloat(r.error_abs));
      fcErrorMap.set(r.fsku, arr);
    }
  } catch { /* demand_accuracy unavailable → all fallback */ }

  // Bước 2: lấy qty_sold_3m_avg per item × location cho fallback
  // ISSUE-2 fix: filter theo location_code để lấy branch-level sigma, không network-level
  const itemCodes = [...new Set(combs.map(c => c.item_code))];
  const locationCodes = [...new Set(combs.map(c => c.location_code))];
  const fallbackRows: { item_code: string; location_code: string; qty_3m: string }[] =
    await this.dataSource.query(`
      SELECT item_code, location_code, COALESCE(qty_sold_3m_avg, 0)::text AS qty_3m
      FROM demand_forecast_detail
      WHERE demand_snapshot_id = $1
        AND item_code = ANY($2)
        AND location_code = ANY($3)
    `, [snapshotId, itemCodes, locationCodes]);
  const fallbackMap = new Map<string, number>();
  for (const r of fallbackRows) {
    fallbackMap.set(`${r.item_code}||${r.location_code}`, parseFloat(r.qty_3m));
  }

  // Bước 3: build sigma per item × location
  for (const { item_code, location_code } of combs) {
    const errors = fcErrorMap.get(item_code) ?? [];
    if (errors.length >= 3) {
      const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
      const variance = errors.reduce((s, v) => s + (v - mean) ** 2, 0) / errors.length;
      map.set(`${item_code}||${location_code}`, { sigma: Math.sqrt(variance), source: 'fc_error' });
    } else {
      const qty3m = fallbackMap.get(`${item_code}||${location_code}`) ?? 0;
      map.set(`${item_code}||${location_code}`, {
        sigma: qty3m * UNIS_CONFIG.SIGMA_FALLBACK_PCT,
        source: 'fallback',
      });
    }
  }

  return map;
}
```

---

## ABC IMPORT LOGIC

```typescript
```
BUG-C fix: importAbcFromSnapshot cũ gọi calcInternalAbc() mỗi item → 1,582 full table scans.
Thay bằng buildAbcRankMap() pre-compute 1 lần, rồi lookup từ Map trong vòng lặp.
calcInternalAbc() vẫn giữ lại như helper cho trường hợp gọi đơn lẻ (e.g. debug 1 item).
```

```typescript
// policy.service.ts — buildAbcRankMap()
// BUG-C fix: pre-compute toàn bộ internal ABC trong 1 query, trả về Map

private async buildAbcRankMap(snapshotId: string): Promise<Map<string, 'A'|'B'|'C'>> {
  const allVolumes: { item_code: string; annual_volume: string }[] =
    await this.dataSource.query(`
      SELECT item_code, SUM(qty_sold_12m_avg)::text AS annual_volume
      FROM demand_forecast_detail
      WHERE demand_snapshot_id = $1
      GROUP BY item_code
      ORDER BY SUM(qty_sold_12m_avg) DESC
    `, [snapshotId]);

  const totalVolume = allVolumes.reduce((s, r) => s + parseFloat(r.annual_volume), 0);
  const map = new Map<string, 'A'|'B'|'C'>();
  if (totalVolume === 0) return map;

  let cumulative = 0;
  for (const row of allVolumes) {
    cumulative += parseFloat(row.annual_volume);
    const pct = cumulative / totalVolume;
    map.set(row.item_code, pct <= 0.20 ? 'A' : pct <= 0.50 ? 'B' : 'C');
  }
  return map;
}

// Helper đơn lẻ — dùng cho debug/API breakdown 1 item, KHÔNG dùng trong batch loop
async calcInternalAbc(itemCode: string, snapshotId: string): Promise<'A'|'B'|'C'|null> {
  const rankMap = await this.buildAbcRankMap(snapshotId);
  return rankMap.get(itemCode) ?? null;
}

// policy.service.ts — importAbcFromSnapshot()

async importAbcFromSnapshot(snapshotId: string): Promise<{ imported: number; discrepancies: number }> {
  // 1. Lấy segment từ demand_snapshot_line
  const segments: { item_code: string; segment: string }[] =
    await this.dataSource.query(`
      SELECT DISTINCT item_code, segment
      FROM demand_snapshot_line
      WHERE snapshot_id = $1 AND segment IS NOT NULL
    `, [snapshotId]);

  // BUG-C fix: pre-compute internal ABC 1 lần thay vì gọi calcInternalAbc() per item
  const rankMap = await this.buildAbcRankMap(snapshotId);

  // Bulk upsert thay vì loop gọi query mỗi item
  const values = segments.map(row => {
    const abcClass = (['A','B','C'].includes(row.segment) ? row.segment : 'C') as 'A'|'B'|'C';
    const internalClass = rankMap.get(row.item_code) ?? null;
    const discrepancy = internalClass !== null && internalClass !== abcClass;
    return { item_code: row.item_code, abcClass, internalClass, discrepancy };
  });

  let discrepancies = 0;
  // Bulk upsert tất cả trong 1 transaction
  await this.dataSource.transaction(async (em) => {
    for (const v of values) {
      await em.query(`
        INSERT INTO item_abc_classification
          (item_code, abc_class, source, snapshot_id, internal_class, discrepancy_flag, effective_date)
        VALUES ($1, $2, 'FORECAST_TEAM', $3, $4, $5, CURRENT_DATE)
        ON CONFLICT (item_code, snapshot_id)
        DO UPDATE SET
          abc_class = EXCLUDED.abc_class,
          internal_class = EXCLUDED.internal_class,
          discrepancy_flag = EXCLUDED.discrepancy_flag,
          updated_at = NOW()
      `, [v.item_code, v.abcClass, snapshotId, v.internalClass, v.discrepancy]);
      if (v.discrepancy) discrepancies++;
    }
  });

  return { imported: values.length, discrepancies };
}
```

---

## RTM RESOLUTION LOGIC

```typescript
// policy.service.ts — resolveRtm()

async resolveRtm(
  itemCode: string,
  branchCode: string,
  abcClass: 'A' | 'B' | 'C',
): Promise<{ warehouseCode: string; priority: number; transportDays: number }[]> {

  // A: full cascade P1→P2→P3
  // B: P1 only
  // C: manual (return empty, planner decides)
  if (abcClass === 'C') return [];

  const maxPriority = abcClass === 'A' ? 3 : 1;

  const routes = await this.rtmRuleRepo.find({
    where: { branchCode, isActive: true },
    order: { priority: 'ASC' },
  });

  return routes
    .filter(r => r.priority <= maxPriority)
    .map(r => ({
      warehouseCode: r.warehouseCode,
      priority: r.priority,
      transportDays: r.transportDays,
    }));
}
```

---

## API ENDPOINTS

### Policy Run

```
POST   /api/v1/policy/runs
       Body: { runName, demandSnapshotId, createdBy? }
       → Tạo policy_run mới (status=DRAFT), trigger calculateAllSafetyStocks()
       → 202 Accepted: { runId, status: 'PROCESSING', totalCombinations }

GET    /api/v1/policy/runs
       → List 20 runs gần nhất, kèm status + progress

GET    /api/v1/policy/runs/:id
       → Chi tiết 1 run + progress (combinations_done / total)

PATCH  /api/v1/policy/runs/:id/activate
       Body: { activatedBy }
       → Activate policy run: status DRAFT → ACTIVE
       → Tự động ARCHIVE run ACTIVE cũ

PATCH  /api/v1/policy/runs/:id/archive
       → Archive manual
```

### ABC Classification

```
POST   /api/v1/policy/abc/import
       Body: { demandSnapshotId }
       → Import ABC từ demand_snapshot_line.segment
       → 200: { imported, discrepancies }

GET    /api/v1/policy/abc/classifications
       Query: ?snapshotId=&abcClass=A|B|C&discrepancyFlag=true&page=&pageSize=
       → Paginated list

GET    /api/v1/policy/abc/discrepancies
       Query: ?snapshotId=
       → Chỉ items có discrepancy_flag = TRUE
```

### Safety Stock

```
GET    /api/v1/policy/safety-stock/targets
       Query: ?policyRunId=&itemCode=&locationCode=&abcClass=&lcnbFlag=true&page=&pageSize=
       → Paginated SS targets

GET    /api/v1/policy/safety-stock/targets/:itemCode/:locationCode
       → SS của 1 item × location từ ACTIVE policy run
       → Trả về cả calculation_steps (breakdown chi tiết)

PATCH  /api/v1/policy/safety-stock/targets/:itemCode/:locationCode/override
       Body: { overrideSs, reason, userId }
       → Planner override SS target
       → Chỉ cho phép trên ACTIVE hoặc DRAFT run

GET    /api/v1/policy/safety-stock/summary
       → Tổng hợp: avg SS by ABC class, count LCNB flagged items, total combinations
```

### RTM Rules

```
GET    /api/v1/policy/rtm/routes
       Query: ?branchCode=&warehouseCode=&priority=1|2|3&isActive=true
       → List RTM rules

POST   /api/v1/policy/rtm/routes
       Body: { branchCode, warehouseCode, priority, transportDays, transportCost?, minOrderQty? }
       → Tạo/cập nhật RTM rule

DELETE /api/v1/policy/rtm/routes/:id
       → Deactivate (set is_active = FALSE, không xóa vật lý)

GET    /api/v1/policy/rtm/resolve/:itemCode/:branchCode
       → Resolve RTM cho 1 item × branch (dùng ABC class từ ACTIVE policy run)
       → Response: [{ warehouseCode, priority, transportDays }]
       → C-class: [] (manual routing, empty)
```

---

## DTO

```typescript
// File: backend/src/policy/dto/index.ts

import { IsString, IsOptional, IsIn, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto';

export class CreatePolicyRunDto {
  @IsString()
  runName: string;

  @IsString()
  demandSnapshotId: string;

  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class ImportAbcDto {
  @IsString()
  demandSnapshotId: string;
}

export class GetSsTargetsQueryDto extends PaginationDto {
  @IsOptional() @IsString()
  policyRunId?: string;

  @IsOptional() @IsString()
  itemCode?: string;

  @IsOptional() @IsString()
  locationCode?: string;

  @IsOptional() @IsIn(['A','B','C'])
  abcClass?: 'A' | 'B' | 'C';

  @IsOptional() @IsBoolean() @Type(() => Boolean)
  lcnbFlag?: boolean;
}

export class OverrideSsDto {
  @IsInt() @Min(0)
  @Type(() => Number)
  overrideSs: number;

  @IsString()
  reason: string;

  @IsOptional() @IsString()
  userId?: string;
}

export class CreateRtmRouteDto {
  @IsString()
  branchCode: string;

  @IsString()
  warehouseCode: string;

  @IsInt() @Min(1) @Max(3)
  @Type(() => Number)
  priority: 1 | 2 | 3;

  @IsInt() @Min(0)
  @Type(() => Number)
  transportDays: number;

  @IsOptional() @Type(() => Number)
  transportCost?: number;

  @IsOptional() @Type(() => Number)
  minOrderQty?: number;
}

export class ActivatePolicyRunDto {
  @IsOptional() @IsString()
  activatedBy?: string;
}
```

---

## MODULE REGISTRATION

```typescript
// File: backend/src/policy/policy.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';
import { PolicyRun } from './entities/policy-run.entity';
import { ItemAbcClassification } from './entities/item-abc-classification.entity';
import { SafetyStockTarget } from './entities/safety-stock-target.entity';
import { RtmRule } from './entities/rtm-rule.entity';
import { ItemLocationConfig } from './entities/item-location-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PolicyRun,
      ItemAbcClassification,
      SafetyStockTarget,
      RtmRule,
      ItemLocationConfig,
    ]),
  ],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
  // exports PolicyService vì Module 4 (DRP) sẽ cần getSsFinal()
})
export class PolicyModule {}
```

```typescript
// File: backend/src/app.module.ts — THÊM PolicyModule
import { PolicyModule } from './policy/policy.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ... }),
    DemandModule,
    SupplyModule,
    PolicyModule,   // <-- thêm vào đây
  ],
})
export class AppModule {}
```

---

## DATA DEPENDENCIES & THỨ TỰ IMPLEMENT

```
DA phải làm trước:
  1. Chạy migration 001_create_policy_tables.sql
  2. Seed item_location_config — CHỈ seed từ supply_snapshot_line (active combinations):
     -- BUG-3 fix: bỏ CROSS JOIN toàn bộ — quá rộng (1,660 × 74 = 123K rows không cần thiết)
     -- Chỉ seed những combination thực sự có tồn kho trong FROZEN snapshot gần nhất
       INSERT INTO item_location_config (item_code, location_code, lead_time_days)
       SELECT DISTINCT
         ssl.item_code,
         ssl.location_code,
         COALESCE(l.lead_time_days, 5) AS lead_time_days
       FROM supply_snapshot_line ssl
       INNER JOIN supply_snapshot ss ON ss.id = ssl.snapshot_id
       LEFT JOIN location l ON l.location_code = ssl.location_code
       WHERE ss.status = 'FROZEN'
       ON CONFLICT (item_code, location_code) DO NOTHING;
     -- Kết quả: ~4,800 rows (không phải 123K)
  3. Load RTM rules từ [Masterdata] Nơi kéo - Sheet1.csv:
       73 entries → INSERT vào rtm_rule table
       DA viết 1 script Python/SQL để map pull_source_code → warehouse location_code

BE implement theo thứ tự:
  Task 1: entities + migration + PolicyModule registration
  Task 2: POST /policy/abc/import → importAbcFromSnapshot()
  Task 3: POST /policy/runs → createRun() + calculateAllSafetyStocks()
  Task 4: PATCH /policy/runs/:id/activate → activateRun()
  Task 5: GET /policy/safety-stock/targets + breakdown endpoint
  Task 6: PATCH /policy/safety-stock/.../override
  Task 7: GET + POST /policy/rtm/routes + GET /policy/rtm/resolve/:itemCode/:branchCode

FE implement (sau BE Task 1-4 xong):
  Tab 1: ABC Classification — table + discrepancy badge + import button
  Tab 2: Safety Stock — table + filter + override drawer + LCNB flag badge
  Tab 3: RTM Rules — table + resolve preview per branch
```

---

## CONSTRAINTS & NOTES

```
NOTE-1: Policy Run activation
  - Chỉ 1 policy_run có status = ACTIVE tại 1 thời điểm
  - Khi activate run mới → tự động ARCHIVE run ACTIVE cũ
  - Enforce trong service layer: check trước khi update
  - DRP (Module 4) luôn đọc SS từ ACTIVE policy run

NOTE-2: ABC class của unclassified items
  - 37 items trong UNIS không có segment assignment
  - Xử lý: treat as 'C' (lowest priority, manual routing)
  - KHÔNG bỏ qua — vẫn cần tính SS cho C-class items

NOTE-3: sigma_demand = 0 edge case
  - Xảy ra khi item có qty_3m_avg = 0 VÀ không có fc_error history
  - SS = 0 trong trường hợp này → DRP netting không có buffer
  - Minimum SS = 1 nếu ADU > 0 (dòng code: if (adu > 0 && ss < 1) ss = 1)
  - Nếu ADU = 0 và sigma = 0 → SS = 0 là đúng (item dormant, không cần buffer)

NOTE-4: item_location_config seed strategy (BUG-3 clarified)
  - Seed DUY NHẤT từ supply_snapshot_line (FROZEN snapshot) — không CROSS JOIN toàn bộ
  - Lý do: CROSS JOIN item × location = 1,660 × 74 = 123K rows — 96% là combination không thực tế
  - supply_snapshot_line chỉ chứa ~4,800 combinations thực sự có tồn kho → đây là đúng scope
  - Phase 1: default lead_time_days = 5 cho tất cả (UNIS chưa có LT per item)
  - Phase 2: DA update lead_time_days từng record khi logistics team cung cấp LT thực tế per NM

NOTE-5: RTM rules ETL
  - Nơi kéo CSV có 73 entries, không phải full 69 CN × N warehouses
  - Nhiều CN share cùng 1 P1 warehouse
  - DA cần map: pull_source_code (text) → location_code (VARCHAR 20) từ location table
  - Ví dụ: "TOKO - HUNG YEN" → factory_code=39 → location.location_code = '039' (cần verify padding)

NOTE-6: CSL decision (P0 — cần BA confirm trước khi deploy)
  - UNIS-TERRAX-MAPPING.md ghi nhận conflict:
    Plugin code: A=97.5%, B=95%, C=90%
    SS Analysis doc: A=95%, B=90%, C=85%
  - File này implement theo plugin code (97.5/95/90) — conservative hơn
  - Nếu BA quyết định dùng doc values → chỉ cần sửa UNIS_CONFIG.Z_SCORES
  - Impact: 97.5% tốn ~19% inventory cao hơn so với 95%

NOTE-7: Module 4 reads SS — getSsFinal() implementation (ISSUE-3 fix)
  PolicyModule phải exports PolicyService để DRPModule import được.
  Implementation:

```typescript
// policy.service.ts — getSsFinal() — dùng bởi Module 4 DRP Netting

/**
 * Trả về SS target cho 1 item × location từ ACTIVE policy run.
 * Priority: override_ss (nếu planner đã override) > ss_final (formula result)
 * Returns 0 nếu không có SS record — DRP sẽ chạy không có safety buffer (item mới / untracked)
 */
async getSsFinal(itemCode: string, locationCode: string): Promise<number> {
  const row: { ss_final: number; override_ss: number | null }[] =
    await this.dataSource.query(`
      SELECT sst.ss_final, sst.override_ss
      FROM safety_stock_target sst
      INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
      WHERE pr.status = 'ACTIVE'
        AND sst.item_code = $1
        AND sst.location_code = $2
      LIMIT 1
    `, [itemCode, locationCode]);

  if (!row[0]) return 0;  // item mới hoặc chưa có ACTIVE policy run → không crash DRP
  return row[0].override_ss ?? row[0].ss_final;
  // override_ss IS NOT NULL → planner đã override → dùng override
  // override_ss IS NULL → dùng ss_final từ formula
}
```
```

---

*MODULE-3-FULL-IMPLEMENT.md | Tech Lead | v1.2 | 2026-04-14*
*v1.0: Initial — 3 sub-modules: ABC Classification + Safety Stock + RTM Rules*
*v1.1: BUG-1 ssDoCap→ssDosCap, BUG-2 calcInternalAbc, BUG-3 seed strategy, BUG-4 demand_accuracy safe, BUG-5 unclassified C documented*
*v1.2: BUG-A ssDosCap toàn bộ consistent; BUG-B N+1 → 4 pre-load queries + in-memory compute; BUG-C importAbc N+1 → buildAbcRankMap 1 query; ISSUE-1 latest FROZEN only; ISSUE-2 branch-level sigma; ISSUE-3 getSsFinal() implementation added*
