# MODULE 4: DRP NETTING — BẢN IMPLEMENT HOÀN CHỈNH A→Z

**Date:** 2026-04-14 (v1.0 — Initial)
**Author:** Tech Lead
**Mục đích:** Dev đọc file này → biết chính xác cần build gì, ở đâu, thứ tự nào
**BA Spec ref:** `docs/04-drp-netting.md` (SCP-UNIS-04 v1.0)

---

## ⚠️ UNIS CONSTRAINTS — ĐỌC TRƯỚC KHI CODE

```
1. KHÔNG có tenant_id: UNIS single-tenant — bỏ tất cả WHERE tenant_id = :x
   BA spec có tenant_id ở policy_run, plan_run → BỎ HOÀN TOÀN

2. item_code VARCHAR(50) (không phải item_id BIGINT):
   FK: item_code VARCHAR(50) → item.item_code
   BA spec dùng item_id BIGINT → SỬA THÀNH item_code VARCHAR(50)

3. location_code VARCHAR(20) (không phải location_id BIGINT):
   FK: location_code VARCHAR(20) → location.location_code
   BA spec dùng location_id BIGINT → SỬA THÀNH location_code VARCHAR(20)

4. PK types quan trọng — KHÔNG nhầm:
   demand_snapshot.snapshot_id   → UUID  (PK tên 'snapshot_id', không phải 'id')
   supply_snapshot.id             → BIGINT (PK auto-increment)
   supply_snapshot_line.snapshot_id → BIGINT (FK → supply_snapshot.id)

5. supply_snapshot_line column thực tế (verified từ entity):
   beginning_inventory = COALESCE(override_qty, allocatable_qty)
   in_transit_qty = scheduled receipts (nếu có ETA)
   is_estimated = BOOLEAN (propagate sang planned_order_release)

6. demand_snapshot_line columns thực tế (confirmed từ entity):
   qty = monthly forecast quantity (base)
   reconciled_qty = planner override qty (nullable) — CÓ TỒN TẠI
   Dùng COALESCE(reconciled_qty, qty) — đây là demand_basis = 'MAX_FORECAST_PO'
   Convert: weekly_gr = COALESCE(reconciled_qty, qty) / count_weeks_in_month(period_start)

7. Module 3 — Safety Stock pre-load (Phase 1: raw SQL bulk, tránh N+1):
   Table: safety_stock_target
   Columns đã confirmed: item_code, location_code, ss_final, override_ss, policy_run_id
   FK: policy_run_id BIGINT → policy_run.id
   Query: SELECT ... FROM safety_stock_target sst
          JOIN policy_run pr ON pr.id = sst.policy_run_id
          WHERE pr.status = 'ACTIVE'
   DRP dùng COALESCE(override_ss, ss_final) làm SS threshold
   Phase 2: nếu PolicyService export loadAllSsFinal() → switch về đó

8. API prefix: /api/v1/drp/...

9. Tech stack:
   Backend:  NestJS 10 + TypeORM + PostgreSQL
   Frontend: Next.js 14 + TailwindCSS
   File: backend/src/drp/ (NestJS module mới)
```

---

## KIẾN TRÚC MODULE

```
Module 4 nhận INPUT từ:
  ┌─ Module 1: demand_snapshot_line (FROZEN)
  │   snapshot_id UUID, item_code, location_code, period_start
  │   GR = COALESCE(reconciled_qty, qty) / weeks_in_month(period_start)
  │
  ├─ Module 2: supply_snapshot_line (FROZEN)
  │   supply_snapshot.stale_acknowledged = TRUE nếu freshness = STALE
  │   snapshot_id BIGINT, item_code, location_code
  │   beginning_inventory = COALESCE(override_qty, allocatable_qty)
  │   in_transit_qty → scheduled receipts (Phase 1: gán tuần 1)
  │
  └─ Module 3: safety_stock_target (raw SQL bulk pre-load)
      JOIN policy_run WHERE status = 'ACTIVE'
      COALESCE(override_ss, ss_final) → SS threshold cho netting

Module 4 OUTPUT cho:
  → Module 5 (Allocation): planned_order_release WHERE status = 'AUTO_RELEASE'
  → Module 8 (Monitor):   drp_exception (stockout/overstock dashboard)

Flow tổng:
  [Planner chọn demand_snapshot + supply_snapshot]
  → [POST /drp/run] → plan_run (RUNNING)
  → [Batch netting: 4,830 combos × 12 weeks = 57,960 calculations]
  → [planned_order_release] + [drp_exception] + [drp_netting_detail]
  → plan_run (COMPLETED, ~30-45s)
  → [Planner review exceptions → resolve]
  → [Planner approve frozen zone orders]

Page: /drp
  Tab 1: Runs (trigger + history table)
  Tab 2: Planned Orders (filter + approve/cancel)
  Tab 3: Exceptions (stockout/overstock/PAB_negative + resolve)
  Tab 4: HSTK Heatmap (matrix item × location)
```

---

## UNIS DRP CONFIG CONSTANTS

```typescript
// File: backend/src/drp/drp-config.ts

export const DRP_CONFIG = {
  HORIZON_WEEKS:    12,     // Tính 12 tuần tới
  FROZEN_ZONE:       2,     // Tuần 1-2: NEEDS_APPROVAL, không auto-release
  LOT_SIZING:     'L4L' as const,    // Lot-for-Lot: PO = NR chính xác
  BOM_EXPLOSION:  false,    // Phân phối, không sản xuất
  DEMAND_BASIS:  'MAX_FORECAST_PO' as const,
  PO_CUTOFF_DAYS:   90,     // PO cũ hơn 90 ngày → bỏ, dùng forecast
  PAB_NEGATIVE_MODE: 'RAISE_EXCEPTION' as const,
  TIMEOUT_MS:    60_000,    // 60s max

  // NOTE — Lead Time không apply trực tiếp trong DRP netting:
  // DRP tính PAB theo tuần (horizon) — không offset planned order theo LT.
  // Lead time ĐÃ được dùng trong Module 3 (Safety Stock) để tính SS buffer.
  // Module 5 (Allocation) sẽ dùng RTM.transport_days để tính ngày release thực tế.
  // DRP chỉ dùng SS (output của M3, đã embed LT) làm threshold trigger.

  // HSTK thresholds (monitoring, NOT DRP trigger)
  HSTK_STOCKOUT_THRESHOLD:   1.5,   // < 1.5w → STOCKOUT alert
  HSTK_OVERSTOCK_THRESHOLD:  3.0,   // > 3.0w → OVERSTOCK alert

  // Batch size khi save planned orders
  BATCH_SIZE: 500,
} as const;
```

---

## DATABASE SCHEMA

### Table: plan_run

```sql
-- Mỗi lần trigger DRP tạo 1 plan_run (không overwrite cũ)
-- Planner có thể compare plan_run A vs B
CREATE TABLE plan_run (
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
    config_json             JSONB,              -- DRP config used for this run
    created_by              VARCHAR(100),
    started_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    completed_at            TIMESTAMP,
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plan_run_status   ON plan_run(status);
CREATE INDEX idx_plan_run_created  ON plan_run(created_at DESC);
CREATE INDEX idx_plan_run_demand   ON plan_run(demand_snapshot_id);
CREATE INDEX idx_plan_run_supply   ON plan_run(supply_snapshot_id);
```

### Table: planned_order_release

```sql
-- Output chính của DRP: 1 row per item × location × week (ALL 12 tuần, kể cả PO=0)
-- Lưu tất cả 12 tuần để getNettingDetail() drill-down đầy đủ, HSTK heatmap chính xác
-- Module 5 (Allocation) đọc WHERE status IN ('AUTO_RELEASE', 'RELEASED')
--   AUTO_RELEASE: tuần 3-12 có PO (tự động release)
--   RELEASED: tuần trong frozen zone đã được planner approve
--   NEEDS_APPROVAL: tuần 1-2 có PO, chờ planner duyệt
--   CANCELLED: planner cancel
CREATE TABLE planned_order_release (
    id                  BIGSERIAL       PRIMARY KEY,
    plan_run_id         BIGINT          NOT NULL REFERENCES plan_run(id),
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    location_code       VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    week_number         INT             NOT NULL CHECK (week_number BETWEEN 1 AND 12),
    week_start_date     DATE            NOT NULL,
    beginning_inventory DECIMAL(15,2)   DEFAULT NULL,  -- PAB(w0): chỉ có tại week_number=1; tuần 2–12 = NULL
    gross_requirement   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    scheduled_receipt   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_before          DECIMAL(15,2)   NOT NULL,   -- PAB trước khi apply planned order
    net_requirement     DECIMAL(15,2)   NOT NULL DEFAULT 0,
    planned_order_qty   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_after           DECIMAL(15,2)   NOT NULL,   -- PAB sau khi apply planned order
    safety_stock        DECIMAL(15,2)   NOT NULL DEFAULT 0,
    hstk                DECIMAL(7,2),               -- HSTK tại tuần này
    frozen_zone_flag    BOOLEAN         NOT NULL DEFAULT FALSE,
    status              VARCHAR(20)     NOT NULL DEFAULT 'AUTO_RELEASE',
      -- AUTO_RELEASE | NEEDS_APPROVAL | RELEASED | CANCELLED
    demand_basis        VARCHAR(20)     NOT NULL DEFAULT 'MAX_FORECAST_PO',
    is_estimated        BOOLEAN         NOT NULL DEFAULT FALSE,  -- từ supply is_estimated
    approved_by         VARCHAR(100),
    approved_at         TIMESTAMP,
    cancelled_by        VARCHAR(100),
    cancelled_at        TIMESTAMP,
    cancel_reason       TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_por UNIQUE (plan_run_id, item_code, location_code, week_number)
);

CREATE INDEX idx_por_plan_run     ON planned_order_release(plan_run_id);
CREATE INDEX idx_por_item         ON planned_order_release(item_code);
CREATE INDEX idx_por_location     ON planned_order_release(location_code);
CREATE INDEX idx_por_status       ON planned_order_release(status);
CREATE INDEX idx_por_frozen       ON planned_order_release(frozen_zone_flag)
                                  WHERE frozen_zone_flag = TRUE;
CREATE INDEX idx_por_week         ON planned_order_release(plan_run_id, week_number);
```

### Table: drp_exception

```sql
-- Exceptions sinh ra trong quá trình netting
-- Planner review + resolve từng exception
CREATE TABLE drp_exception (
    id                  BIGSERIAL       PRIMARY KEY,
    plan_run_id         BIGINT          NOT NULL REFERENCES plan_run(id),
    type                VARCHAR(50)     NOT NULL,
      -- PAB_NEGATIVE | STOCKOUT_ALERT | OVERSTOCK_ALERT
      -- FROZEN_ZONE_VIOLATION | MISSING_SS | NETTING_TIMEOUT
    severity            VARCHAR(10)     NOT NULL CHECK (severity IN ('HIGH','MEDIUM','LOW')),
    item_code           VARCHAR(50)     REFERENCES item(item_code),
    location_code       VARCHAR(20)     REFERENCES location(location_code),
    week_number         INT,
    detail_json         JSONB,          -- { hstk, pab, weekly_demand, ... }
    message             TEXT            NOT NULL,
    resolved            BOOLEAN         NOT NULL DEFAULT FALSE,
    resolved_by         VARCHAR(100),
    resolved_at         TIMESTAMP,
    resolution_note     TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exc_plan_run     ON drp_exception(plan_run_id);
CREATE INDEX idx_exc_type         ON drp_exception(plan_run_id, type);
CREATE INDEX idx_exc_resolved     ON drp_exception(resolved) WHERE resolved = FALSE;
CREATE INDEX idx_exc_severity     ON drp_exception(severity, resolved);
```

### Table: drp_netting_detail (Optional — full trace)

```sql
-- Full audit trail: mỗi tuần × item × location
-- Chỉ cần khi debug hoặc compliance
-- Phase 1: có thể bỏ qua nếu performance concern
-- Phase 2+: bật khi planner yêu cầu drill-down 12-week grid
CREATE TABLE drp_netting_detail (
    id                  BIGSERIAL       PRIMARY KEY,
    plan_run_id         BIGINT          NOT NULL REFERENCES plan_run(id),
    item_code           VARCHAR(50)     NOT NULL,
    location_code       VARCHAR(20)     NOT NULL,
    week_number         INT             NOT NULL,
    week_start_date     DATE            NOT NULL,
    gross_requirement   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    scheduled_receipt   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_before          DECIMAL(15,2)   NOT NULL,
    net_requirement     DECIMAL(15,2)   NOT NULL DEFAULT 0,
    planned_order       DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_after           DECIMAL(15,2)   NOT NULL,
    safety_stock        DECIMAL(15,2)   NOT NULL DEFAULT 0,
    hstk                DECIMAL(7,2),
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_netting_detail UNIQUE (plan_run_id, item_code, location_code, week_number)
);

CREATE INDEX idx_netting_plan_run ON drp_netting_detail(plan_run_id);
CREATE INDEX idx_netting_combo    ON drp_netting_detail(plan_run_id, item_code, location_code);
```

---

## MIGRATION FILE

```
File: backend/src/drp/migrations/001_create_drp_tables.sql
Run:  psql -d unis_scp -f 001_create_drp_tables.sql
```

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS plan_run (
    id                      BIGSERIAL       PRIMARY KEY,
    demand_snapshot_id      UUID            NOT NULL
                              REFERENCES demand_snapshot(snapshot_id),
    supply_snapshot_id      BIGINT          NOT NULL
                              REFERENCES supply_snapshot(id),
    status                  VARCHAR(20)     NOT NULL DEFAULT 'RUNNING',
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
    beginning_inventory DECIMAL(15,2)   DEFAULT NULL,
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

CREATE TABLE IF NOT EXISTS drp_netting_detail (
    id                  BIGSERIAL       PRIMARY KEY,
    plan_run_id         BIGINT          NOT NULL REFERENCES plan_run(id),
    item_code           VARCHAR(50)     NOT NULL,
    location_code       VARCHAR(20)     NOT NULL,
    week_number         INT             NOT NULL,
    week_start_date     DATE            NOT NULL,
    gross_requirement   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    scheduled_receipt   DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_before          DECIMAL(15,2)   NOT NULL,
    net_requirement     DECIMAL(15,2)   NOT NULL DEFAULT 0,
    planned_order       DECIMAL(15,2)   NOT NULL DEFAULT 0,
    pab_after           DECIMAL(15,2)   NOT NULL,
    safety_stock        DECIMAL(15,2)   NOT NULL DEFAULT 0,
    hstk                DECIMAL(7,2),
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_netting_detail UNIQUE (plan_run_id, item_code, location_code, week_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_plan_run_status   ON plan_run(status);
CREATE INDEX IF NOT EXISTS idx_plan_run_created  ON plan_run(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_por_plan_run      ON planned_order_release(plan_run_id);
CREATE INDEX IF NOT EXISTS idx_por_item          ON planned_order_release(item_code);
CREATE INDEX IF NOT EXISTS idx_por_location      ON planned_order_release(location_code);
CREATE INDEX IF NOT EXISTS idx_por_status        ON planned_order_release(status);
CREATE INDEX IF NOT EXISTS idx_por_frozen        ON planned_order_release(frozen_zone_flag)
                                                 WHERE frozen_zone_flag = TRUE;
CREATE INDEX IF NOT EXISTS idx_por_week          ON planned_order_release(plan_run_id, week_number);
CREATE INDEX IF NOT EXISTS idx_exc_plan_run      ON drp_exception(plan_run_id);
CREATE INDEX IF NOT EXISTS idx_exc_type          ON drp_exception(plan_run_id, type);
CREATE INDEX IF NOT EXISTS idx_exc_resolved      ON drp_exception(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_netting_combo     ON drp_netting_detail(plan_run_id, item_code, location_code);

COMMIT;
```

---

## ENTITY FILES

### plan-run.entity.ts

```typescript
// File: backend/src/drp/entities/plan-run.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('plan_run')
export class PlanRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'demand_snapshot_id', type: 'uuid' })
  demandSnapshotId: string;

  @Column({ name: 'supply_snapshot_id', type: 'bigint' })
  supplySnapshotId: string;

  @Column({ length: 20, default: 'RUNNING' })
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';

  @Column({ name: 'planned_orders_count', default: 0 })
  plannedOrdersCount: number;

  @Column({ name: 'exceptions_count', default: 0 })
  exceptionsCount: number;

  @Column({ name: 'combinations_processed', default: 0 })
  combinationsProcessed: number;

  @Column({ name: 'duration_ms', nullable: true })
  durationMs: number | null;

  @Column({ name: 'config_json', type: 'jsonb', nullable: true })
  configJson: Record<string, unknown> | null;

  @Column({ name: 'created_by', length: 100, nullable: true })
  createdBy: string | null;

  @Column({ name: 'started_at', type: 'timestamp' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### planned-order-release.entity.ts

```typescript
// File: backend/src/drp/entities/planned-order-release.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PlanRun } from './plan-run.entity';

@Entity('planned_order_release')
export class PlannedOrderRelease {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @ManyToOne(() => PlanRun)
  @JoinColumn({ name: 'plan_run_id' })
  planRun: PlanRun;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', length: 20 })
  locationCode: string;

  @Column({ name: 'week_number' })
  weekNumber: number;

  // BUG-1 FIX: nullable=true — chỉ week_number=1 có giá trị; tuần 2–12 = null
  @Column({ name: 'beginning_inventory', type: 'decimal', precision: 15, scale: 2, nullable: true, default: null })
  beginningInventory: number | null;

  @Column({ name: 'week_start_date', type: 'date' })
  weekStartDate: Date;

  @Column({ name: 'gross_requirement', type: 'decimal', precision: 15, scale: 2, default: 0 })
  grossRequirement: number;

  @Column({ name: 'scheduled_receipt', type: 'decimal', precision: 15, scale: 2, default: 0 })
  scheduledReceipt: number;

  @Column({ name: 'pab_before', type: 'decimal', precision: 15, scale: 2 })
  pabBefore: number;

  @Column({ name: 'net_requirement', type: 'decimal', precision: 15, scale: 2, default: 0 })
  netRequirement: number;

  @Column({ name: 'planned_order_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  plannedOrderQty: number;

  @Column({ name: 'pab_after', type: 'decimal', precision: 15, scale: 2 })
  pabAfter: number;

  @Column({ name: 'safety_stock', type: 'decimal', precision: 15, scale: 2, default: 0 })
  safetyStock: number;

  @Column({ name: 'hstk', type: 'decimal', precision: 7, scale: 2, nullable: true })
  hstk: number | null;

  @Column({ name: 'frozen_zone_flag', default: false })
  frozenZoneFlag: boolean;

  @Column({ length: 20, default: 'AUTO_RELEASE' })
  status: 'AUTO_RELEASE' | 'NEEDS_APPROVAL' | 'RELEASED' | 'CANCELLED';

  @Column({ name: 'demand_basis', length: 20, default: 'MAX_FORECAST_PO' })
  demandBasis: string;

  @Column({ name: 'is_estimated', default: false })
  isEstimated: boolean;

  @Column({ name: 'approved_by', length: 100, nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'cancelled_by', length: 100, nullable: true })
  cancelledBy: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true })
  cancelReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### drp-exception.entity.ts

```typescript
// File: backend/src/drp/entities/drp-exception.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('drp_exception')
export class DrpException {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @Column({ length: 50 })
  type: string;
  // PAB_NEGATIVE | STOCKOUT_ALERT | OVERSTOCK_ALERT
  // FROZEN_ZONE_VIOLATION | MISSING_SS | NETTING_TIMEOUT

  @Column({ length: 10 })
  severity: 'HIGH' | 'MEDIUM' | 'LOW';

  @Column({ name: 'item_code', length: 50, nullable: true })
  itemCode: string | null;

  @Column({ name: 'location_code', length: 20, nullable: true })
  locationCode: string | null;

  @Column({ name: 'week_number', nullable: true })
  weekNumber: number | null;

  @Column({ name: 'detail_json', type: 'jsonb', nullable: true })
  detailJson: Record<string, unknown> | null;

  @Column({ type: 'text' })
  message: string;

  @Column({ default: false })
  resolved: boolean;

  @Column({ name: 'resolved_by', length: 100, nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

---

## DRP ALGORITHM — CHI TIẾT

### Helper: Tính số tuần trong tháng

```typescript
// Dùng để convert monthly qty → weekly GR
function countWeeksInMonth(periodStart: Date): number {
  // Đếm số thứ Hai trong tháng (ISO week convention)
  const year = periodStart.getFullYear();
  const month = periodStart.getMonth(); // 0-indexed
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.round(daysInMonth / 7); // 4 hoặc 5
}

// weekStartDate cho tuần w (1-indexed từ startOfHorizon)
function getWeekStartDate(horizonStart: Date, weekNumber: number): Date {
  const d = new Date(horizonStart);
  d.setDate(d.getDate() + (weekNumber - 1) * 7);
  return d;
}
```

### Helper: Lấy GR theo tuần từ monthly demand

```typescript
// demand_snapshot_line lưu monthly → cần phân bổ vào tuần
// UNIS chưa có weekly pattern → chia đều (equal distribution)
interface WeeklyDemand {
  week: number;
  weekStartDate: Date;
  grossRequirement: number;
}

function buildWeeklyDemandMap(
  monthlyRows: { period_start: Date; qty: number }[],
  horizonStart: Date,
  horizonWeeks: number,
): Map<number, number> {
  // Map<weekNumber, weeklyGR>
  const map = new Map<number, number>();

  for (let w = 1; w <= horizonWeeks; w++) {
    const weekStart = getWeekStartDate(horizonStart, w);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Tìm tháng chứa tuần này (dùng weekStart)
    const matchingRow = monthlyRows.find(r => {
      const rowMonth = r.period_start.getMonth();
      const rowYear  = r.period_start.getFullYear();
      return weekStart.getMonth() === rowMonth && weekStart.getFullYear() === rowYear;
    });

    if (!matchingRow) {
      map.set(w, 0);
      continue;
    }

    const weeksInMonth = countWeeksInMonth(matchingRow.period_start);
    map.set(w, matchingRow.qty / weeksInMonth);
  }

  return map;
}
```

### Core Netting — 1 item × 1 location

```typescript
interface NettingInput {
  itemCode: string;
  locationCode: string;
  beginningInventory: number;   // COALESCE(override_qty, allocatable_qty)
  scheduledReceipts: Map<number, number>; // Map<week, qty> từ in_transit_qty
  weeklyDemand: Map<number, number>;      // Map<week, GR> sau convert
  safetyStock: number;                    // COALESCE(override_ss, ss_final) từ ssMap pre-load
  isEstimated: boolean;                   // từ supply_snapshot_line
}

interface WeekResult {
  week: number;
  weekStartDate: Date;
  gr: number;
  sr: number;
  pabBefore: number;
  nr: number;
  po: number;
  pabAfter: number;
  hstk: number | null;
  frozenZone: boolean;
  status: 'AUTO_RELEASE' | 'NEEDS_APPROVAL';
}

function runNetting(input: NettingInput, horizonStart: Date): {
  weeks: WeekResult[];
  exceptions: { type: string; severity: string; week: number; message: string; detail: Record<string, unknown> }[];
} {
  const { HORIZON_WEEKS, FROZEN_ZONE, HSTK_STOCKOUT_THRESHOLD, HSTK_OVERSTOCK_THRESHOLD } = DRP_CONFIG;
  const weeks: WeekResult[] = [];
  const exceptions: typeof weeks extends never[] ? never : {
    type: string; severity: string; week: number; message: string; detail: Record<string, unknown>;
  }[] = [] as { type: string; severity: string; week: number; message: string; detail: Record<string, unknown> }[];

  let pabPrev = input.beginningInventory;

  for (let w = 1; w <= HORIZON_WEEKS; w++) {
    const gr = input.weeklyDemand.get(w) ?? 0;
    const sr = input.scheduledReceipts.get(w) ?? 0;

    // 1. PAB trước planned order
    const pabRaw = pabPrev + sr - gr;

    // 2. Net Requirement
    let nr = 0;
    let po = 0;
    let pabAfter = pabRaw;

    if (pabRaw < input.safetyStock) {
      nr = input.safetyStock - pabRaw;   // L4L: PO = NR chính xác
      po = nr;
      pabAfter = pabRaw + po;             // = safetyStock (L4L invariant)
    }

    // 3. PAB_NEGATIVE exception (PAB trước PO < 0)
    if (pabRaw < 0) {
      exceptions.push({
        type: 'PAB_NEGATIVE',
        severity: 'HIGH',
        week: w,
        message: `PAB âm tại tuần ${w}: ${pabRaw.toFixed(0)} units (trước khi đặt hàng)`,
        detail: { pabBefore: pabRaw, gr, sr, pabAfter, safetyStock: input.safetyStock },
      });
    }

    // 4. HSTK alerts (monitoring — KHÔNG trigger DRP)
    // BUG-3 FIX: chỉ tính và raise HSTK exception khi gr > 0
    // Khi gr = 0 (tuần không có demand), HSTK = pabAfter/1 là vô nghĩa → bỏ qua
    let hstk: number | null = null;
    if (gr > 0) {
      hstk = pabAfter / gr;
      if (hstk < HSTK_STOCKOUT_THRESHOLD) {
        exceptions.push({
          type: 'STOCKOUT_ALERT',
          severity: 'HIGH',
          week: w,
          message: `HSTK = ${hstk.toFixed(1)} tuần (< ${HSTK_STOCKOUT_THRESHOLD} ngưỡng)`,
          detail: { hstk, pabAfter, weeklyDemand: gr },
        });
      } else if (hstk > HSTK_OVERSTOCK_THRESHOLD) {
        exceptions.push({
          type: 'OVERSTOCK_ALERT',
          severity: 'LOW',
          week: w,
          message: `HSTK = ${hstk.toFixed(1)} tuần (> ${HSTK_OVERSTOCK_THRESHOLD} ngưỡng — tồn dư)`,
          detail: { hstk, pabAfter, weeklyDemand: gr },
        });
      }
    }

    // 5. Frozen zone
    const frozenZone = w <= FROZEN_ZONE;
    const status = (frozenZone && po > 0) ? 'NEEDS_APPROVAL' : 'AUTO_RELEASE';

    if (frozenZone && po > 0) {
      exceptions.push({
        type: 'FROZEN_ZONE_VIOLATION',
        severity: 'MEDIUM',
        week: w,
        message: `Planned order tuần ${w} trong frozen zone — cần planner duyệt`,
        detail: { po, nr, weekNumber: w },
      });
    }

    weeks.push({
      week: w,
      weekStartDate: getWeekStartDate(horizonStart, w),
      gr, sr, pabBefore: pabRaw, nr, po, pabAfter,
      hstk,   // null khi gr=0 (BUG-3 fix: hstk đã là null nếu gr=0)
      frozenZone, status,
    });

    pabPrev = pabAfter;
  }

  return { weeks, exceptions };
}
```

### Pre-load Data — Batch Queries (không N+1)

```typescript
// 4 queries pre-load toàn bộ data cần thiết
// Không N+1 qua 4,830 combinations

/** Pre-load beginning inventory từ supply_snapshot_line
 *  BUG-2 FIX: supplySnapshotId là number (BIGINT) — truyền trực tiếp, PG tự cast
 *  Dùng $1::bigint để explicit nếu vẫn nhận string từ upstream
 */
async function loadInventoryMap(
  supplySnapshotId: number,
  dataSource: DataSource,
): Promise<Map<string, { qty: number; isEstimated: boolean }>> {
  const rows: {
    item_code: string;
    location_code: string;
    allocatable_qty: string;
    override_qty: string | null;
    in_transit_qty: string;
    is_estimated: boolean;
  }[] = await dataSource.query(`
    SELECT item_code, location_code,
           allocatable_qty, override_qty, in_transit_qty, is_estimated
    FROM supply_snapshot_line
    WHERE snapshot_id = $1::bigint
  `, [supplySnapshotId]);

  const map = new Map<string, { qty: number; isEstimated: boolean }>();
  for (const r of rows) {
    const key = `${r.item_code}||${r.location_code}`;
    const qty = parseFloat(r.override_qty ?? r.allocatable_qty ?? '0');
    map.set(key, { qty, isEstimated: r.is_estimated });
  }
  return map;
}

/** Pre-load scheduled receipts từ in_transit_qty
 *  Phase 1: in_transit_qty là tổng — gán vào tuần 1 (không có ETA)
 *  Phase 2: khi có ETA từ Bravo → phân bổ đúng tuần
 *  BUG-2 FIX: supplySnapshotId là number (BIGINT), dùng $1::bigint
 */
async function loadScheduledReceiptMap(
  supplySnapshotId: number,
  dataSource: DataSource,
): Promise<Map<string, number>> {
  // Phase 1: gán in_transit_qty vào tuần 1 (earliest possible)
  const rows: { item_code: string; location_code: string; in_transit_qty: string }[] =
    await dataSource.query(`
      SELECT item_code, location_code, in_transit_qty
      FROM supply_snapshot_line
      WHERE snapshot_id = $1::bigint AND in_transit_qty > 0
    `, [supplySnapshotId]);

  const map = new Map<string, number>();
  for (const r of rows) {
    // Key: item||location||week (week=1 cho Phase 1)
    const key = `${r.item_code}||${r.location_code}||1`;
    map.set(key, parseFloat(r.in_transit_qty));
  }
  return map;
}

/** Pre-load weekly demand từ demand_snapshot_line (monthly → weekly)
 *  BUG-NEW-1 FIX: dùng COALESCE(reconciled_qty, qty) — reconciled_qty tồn tại trong entity
 *  (nullable, planner override). BA spec COALESCE(reconciled_qty, forecast_qty) là đúng.
 *  NOTE-3 cũ ("chỉ có cột qty") — SAI, cần bỏ.
 */
async function loadWeeklyDemandMap(
  demandSnapshotId: string,
  horizonStart: Date,
  horizonWeeks: number,
  dataSource: DataSource,
): Promise<Map<string, Map<number, number>>> {
  // Map<'item||location', Map<week, weeklyGR>>
  const rows: {
    item_code: string;
    location_code: string;
    qty: string;
    period_start: Date;
  }[] = await dataSource.query(`
    SELECT item_code, location_code,
           COALESCE(reconciled_qty, qty)::text AS qty,
           period_start
    FROM demand_snapshot_line
    WHERE snapshot_id = $1
      AND COALESCE(reconciled_qty, qty) > 0
    ORDER BY item_code, location_code, period_start
  `, [demandSnapshotId]);

  const grouped = new Map<string, { period_start: Date; qty: number }[]>();
  for (const r of rows) {
    const key = `${r.item_code}||${r.location_code}`;
    const arr = grouped.get(key) ?? [];
    arr.push({ period_start: new Date(r.period_start), qty: parseFloat(r.qty) });
    grouped.set(key, arr);
  }

  const result = new Map<string, Map<number, number>>();
  for (const [key, monthlyRows] of grouped) {
    result.set(key, buildWeeklyDemandMap(monthlyRows, horizonStart, horizonWeeks));
  }
  return result;
}

/** Pre-load safety stock từ ACTIVE policy_run — bulk raw SQL (không N+1)
 *  Dùng trực tiếp safety_stock_target thay vì PolicyService.getSsFinal() per combo
 *  Logic: COALESCE(override_ss, ss_final) — giống getSsFinal() nhưng 1 query cho toàn bộ
 *  Phase 2: nếu PolicyService export loadAllSsFinal() → switch về đó
 */
```

### Main Batch Method — calculateDrpBatch()

```typescript
// drp.service.ts — phương thức chính

async calculateDrpBatch(
  planRunId: string,
  demandSnapshotId: string,
  supplySnapshotId: string,
  horizonStart: Date,
): Promise<{ ordersCount: number; exceptionsCount: number }> {

  const startTime = Date.now();

  // 1. Lấy tất cả combinations từ demand snapshot
  // BUG-NEW-4 FIX: dùng COALESCE(reconciled_qty, qty) để không bỏ sót
  // trường hợp planner override qty=0 → reconciled_qty=500
  const combinations: { item_code: string; location_code: string }[] =
    await this.dataSource.query(`
      SELECT DISTINCT item_code, location_code
      FROM demand_snapshot_line
      WHERE snapshot_id = $1 AND COALESCE(reconciled_qty, qty) > 0
      ORDER BY item_code, location_code
    `, [demandSnapshotId]);

  await this.planRunRepo.update(planRunId, {
    combinationsProcessed: combinations.length,
  });

  // 2. Pre-load tất cả data (3 queries, không N+1)
  const [inventoryMap, srMap, weeklyDemandMap] = await Promise.all([
    this.loadInventoryMap(supplySnapshotId),
    this.loadScheduledReceiptMap(supplySnapshotId),
    this.loadWeeklyDemandMap(demandSnapshotId, horizonStart, DRP_CONFIG.HORIZON_WEEKS),
  ]);

  // 3. Pre-load SS bulk từ ACTIVE policy_run
  //    Dùng raw SQL để tránh N+1 (1 query thay vì 4,830 × getSsFinal())
  //    ✅ CONFIRMED: safety_stock_target.policy_run_id (BIGINT FK → policy_run.id) tồn tại trong entity
  const ssRows: { item_code: string; location_code: string; ss_final: number; override_ss: number | null }[] =
    await this.dataSource.query(`
      SELECT sst.item_code, sst.location_code, sst.ss_final, sst.override_ss
      FROM safety_stock_target sst
      INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
      WHERE pr.status = 'ACTIVE'
    `);
  const ssMap = new Map<string, number>();
  for (const r of ssRows) {
    ssMap.set(`${r.item_code}||${r.location_code}`, r.override_ss ?? r.ss_final);
  }

  const allOrders: Partial<PlannedOrderRelease>[] = [];
  const allExceptions: Partial<DrpException>[] = [];
  let missingSSExceptions = 0;

  // 4. Netting loop
  for (const { item_code, location_code } of combinations) {
    const comboKey = `${item_code}||${location_code}`;

    // Safety stock (default 0 nếu chưa có ACTIVE policy run)
    const ss = ssMap.get(comboKey) ?? 0;
    if (!ssMap.has(comboKey)) {
      missingSSExceptions++;
      allExceptions.push({
        planRunId,
        type: 'MISSING_SS',
        severity: 'MEDIUM',
        itemCode: item_code,
        locationCode: location_code,
        weekNumber: null,
        message: `Không có safety stock target cho ${item_code} @ ${location_code}`,
        detailJson: { note: 'SS = 0, DRP vẫn chạy nhưng không có safety buffer' },
      });
    }

    // Beginning inventory
    const invData = inventoryMap.get(comboKey);
    const beginningInventory = invData?.qty ?? 0;
    const isEstimated = invData?.isEstimated ?? false;

    // Scheduled receipts per week
    const scheduledReceipts = new Map<number, number>();
    for (let w = 1; w <= DRP_CONFIG.HORIZON_WEEKS; w++) {
      const qty = srMap.get(`${comboKey}||${w}`) ?? 0;
      if (qty > 0) scheduledReceipts.set(w, qty);
    }

    // Weekly demand
    const weeklyDemand = weeklyDemandMap.get(comboKey) ?? new Map();

    // Skip nếu không có demand và không có inventory
    if (weeklyDemand.size === 0 && beginningInventory === 0) continue;

    // Run core netting
    const { weeks, exceptions } = runNetting(
      { itemCode: item_code, locationCode: location_code, beginningInventory,
        scheduledReceipts, weeklyDemand, safetyStock: ss, isEstimated },
      horizonStart,
    );

    // BUG-1 FIX: Save ALL 12 tuần (kể cả PO=0) vào planned_order_release
    // Lý do: getNettingDetail() cần full 12-week trace để drill-down
    //        getHstkSummary() cần đếm đúng số combinations (kể cả items không cần đặt hàng)
    for (const w of weeks) {
      allOrders.push({
        planRunId,
        itemCode: item_code,
        locationCode: location_code,
        weekNumber: w.week,
        weekStartDate: w.weekStartDate,
        // BUG-1 FIX: tuần 1 lưu tồn đầu kỳ thực tế; tuần 2–12 lưu null (nullable column)
        // FE/reconstruct dùng beginningInventory của tuần 1, không đọc tuần 2–12
        beginningInventory: w.week === 1 ? beginningInventory : null,
        grossRequirement: Math.round(w.gr * 100) / 100,
        scheduledReceipt: Math.round(w.sr * 100) / 100,
        pabBefore: Math.round(w.pabBefore * 100) / 100,
        netRequirement: Math.round(w.nr * 100) / 100,
        plannedOrderQty: Math.round(w.po * 100) / 100,
        pabAfter: Math.round(w.pabAfter * 100) / 100,
        safetyStock: ss,
        hstk: w.hstk !== null ? Math.round(w.hstk * 100) / 100 : null,
        frozenZoneFlag: w.frozenZone,
        status: w.po > 0 ? w.status : 'AUTO_RELEASE', // tuần không có PO → AUTO_RELEASE (no action needed)
        demandBasis: 'MAX_FORECAST_PO',
        isEstimated,
      });
    }

    // Collect exceptions
    for (const exc of exceptions) {
      allExceptions.push({
        planRunId,
        type: exc.type,
        severity: exc.severity as 'HIGH' | 'MEDIUM' | 'LOW',
        itemCode: item_code,
        locationCode: location_code,
        weekNumber: exc.week,
        message: exc.message,
        detailJson: exc.detail,
      });
    }
  }

  // 5. Batch save (500/batch)
  await this.batchSave(this.porRepo, allOrders, DRP_CONFIG.BATCH_SIZE);
  await this.batchSave(this.excRepo, allExceptions, DRP_CONFIG.BATCH_SIZE);

  const durationMs = Date.now() - startTime;

  // 6. Update plan_run summary
  await this.planRunRepo.update(planRunId, {
    status: durationMs > DRP_CONFIG.TIMEOUT_MS ? 'TIMEOUT' : 'COMPLETED',
    plannedOrdersCount: allOrders.length,
    exceptionsCount: allExceptions.length,
    durationMs,
    completedAt: new Date(),
  });

  if (durationMs > DRP_CONFIG.TIMEOUT_MS) {
    console.warn(`[PlanRun ${planRunId}] DRP timeout: ${durationMs}ms > 60s`);
  }

  return { ordersCount: allOrders.length, exceptionsCount: allExceptions.length };
}

/** Generic batch insert helper
 *  BUG-3 FIX: Dùng orIgnore() chỉ cho drp_exception (không có UNIQUE constraint quan trọng).
 *  Với planned_order_release có UNIQUE (plan_run_id, item_code, location_code, week_number):
 *  - Trong 1 run không bao giờ có duplicate → orIgnore() OK về mặt logic
 *  - Nhưng nếu calculateDrpBatch() bị gọi 2 lần cho cùng planRunId (bug/retry) → data drop silently
 *  Guard: createAndRunDrp() reject nếu plan_run đã COMPLETED/FAILED (xem validation ở trên)
 */
private async batchSave<T>(repo: Repository<T>, items: Partial<T>[], batchSize: number) {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await repo.createQueryBuilder()
      .insert().into(repo.target)
      .values(batch as T[])
      .orIgnore()   // safe vì plan_run đã được guard không re-run khi COMPLETED
      .execute();
  }
}
```

---

## SERVICE FILE

```typescript
// File: backend/src/drp/drp.service.ts

@Injectable()
export class DrpService {
  constructor(
    @InjectRepository(PlanRun)              private readonly planRunRepo: Repository<PlanRun>,
    @InjectRepository(PlannedOrderRelease)  private readonly porRepo: Repository<PlannedOrderRelease>,
    @InjectRepository(DrpException)         private readonly excRepo: Repository<DrpException>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════
  // TASK 1 — CREATE & TRIGGER DRP RUN
  // ═══════════════════════════════════════════════════════

  async createAndRunDrp(dto: CreateDrpRunDto): Promise<{
    planRunId: string; status: string; combinationsToProcess: number;
  }> {
    // Guard: không cho re-run nếu đã có plan_run RUNNING/COMPLETED với cùng snapshot pair
    // Ngăn batchSave orIgnore drop data silently nếu dev retry
    const existingRun = await this.dataSource.query(`
      SELECT id, status FROM plan_run
      WHERE demand_snapshot_id = $1 AND supply_snapshot_id = $2
        AND status IN ('RUNNING', 'COMPLETED')
      LIMIT 1
    `, [dto.demandSnapshotId, dto.supplySnapshotId]);
    if (existingRun[0])
      throw new ConflictException(
        `Plan run #${existingRun[0].id} (${existingRun[0].status}) đã tồn tại cho snapshot pair này. Dùng run đó hoặc chọn snapshot khác.`,
      );

    // Validate demand snapshot FROZEN
    const demandSnap = await this.dataSource.query(`
      SELECT snapshot_id, status FROM demand_snapshot
      WHERE snapshot_id = $1
    `, [dto.demandSnapshotId]);
    if (!demandSnap[0]) throw new NotFoundException('Demand snapshot not found');
    if (demandSnap[0].status !== 'FROZEN')
      throw new BadRequestException(`Demand snapshot not FROZEN (current: ${demandSnap[0].status})`);

    // Validate supply snapshot FROZEN + freshness
    // REFERENCE FIX: stale gate dùng supply_snapshot.stale_acknowledged column (Module 2 đã set)
    // KHÔNG dùng flag từ FE — planner phải acknowledge STALE qua Module 2 endpoint TRƯỚC khi trigger DRP
    const supplySnap = await this.dataSource.query(`
      SELECT id, status, freshness, stale_acknowledged FROM supply_snapshot WHERE id = $1::bigint
    `, [dto.supplySnapshotId]);
    if (!supplySnap[0]) throw new NotFoundException('Supply snapshot not found');
    if (supplySnap[0].status !== 'FROZEN')
      throw new BadRequestException(`Supply snapshot not FROZEN (current: ${supplySnap[0].status})`);
    if (supplySnap[0].freshness === 'STALE' && !supplySnap[0].stale_acknowledged)
      throw new ConflictException('Supply snapshot STALE chưa được acknowledge — vào Module 2 acknowledge trước khi chạy DRP');

    // Count combinations — dùng COALESCE(reconciled_qty, qty) để nhất quán với calculateDrpBatch
    const countRes = await this.dataSource.query(`
      SELECT COUNT(DISTINCT item_code || '||' || location_code) AS cnt
      FROM demand_snapshot_line
      WHERE snapshot_id = $1 AND COALESCE(reconciled_qty, qty) > 0
    `, [dto.demandSnapshotId]);
    const combinationsToProcess = parseInt(countRes[0]?.cnt ?? '0');

    // Create plan_run
    const horizonStart = dto.horizonStart ? new Date(dto.horizonStart) : new Date();
    const run = this.planRunRepo.create({
      demandSnapshotId: dto.demandSnapshotId,
      supplySnapshotId: dto.supplySnapshotId,
      status: 'RUNNING',
      combinationsProcessed: combinationsToProcess,
      configJson: {
        horizonWeeks: DRP_CONFIG.HORIZON_WEEKS,
        frozenZone: DRP_CONFIG.FROZEN_ZONE,
        lotSizing: DRP_CONFIG.LOT_SIZING,
        demandBasis: DRP_CONFIG.DEMAND_BASIS,
        horizonStart: horizonStart.toISOString(),
      },
      createdBy: dto.createdBy ?? null,
      startedAt: new Date(),
    });
    const saved = await this.planRunRepo.save(run);

    // Fire-and-forget async (non-blocking)
    this.calculateDrpBatch(saved.id, dto.demandSnapshotId, dto.supplySnapshotId, horizonStart)
      .catch(err => {
        console.error(`[PlanRun ${saved.id}] DRP failed:`, err.message);
        this.planRunRepo.update(saved.id, { status: 'FAILED', completedAt: new Date() });
      });

    return { planRunId: saved.id, status: 'RUNNING', combinationsToProcess };
  }

  // ═══════════════════════════════════════════════════════
  // TASK 2 — READ PLAN RUNS
  // ═══════════════════════════════════════════════════════

  async listPlanRuns() {
    return this.planRunRepo.find({ order: { createdAt: 'DESC' }, take: 20 });
  }

  async getPlanRun(id: string) {
    const run = await this.planRunRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`Plan run ${id} not found`);

    // Exceptions breakdown by type
    const breakdown: { type: string; cnt: string }[] = await this.dataSource.query(`
      SELECT type, COUNT(*) AS cnt FROM drp_exception
      WHERE plan_run_id = $1 GROUP BY type
    `, [id]);
    const exceptionsByType: Record<string, number> = {};
    for (const r of breakdown) exceptionsByType[r.type] = parseInt(r.cnt);

    return { ...run, exceptionsByType };
  }

  // ═══════════════════════════════════════════════════════
  // TASK 3 — PLANNED ORDERS
  // ═══════════════════════════════════════════════════════

  async getPlannedOrders(query: GetPlannedOrdersQueryDto) {
    const { planRunId, itemCode, locationCode, weekNumber, status,
            frozenZoneFlag, page = 1, pageSize = 50 } = query;
    const skip = (page - 1) * pageSize;

    const qb = this.porRepo.createQueryBuilder('por');
    qb.where('por.plan_run_id = :planRunId', { planRunId });
    if (itemCode)      qb.andWhere('por.item_code ILIKE :ic', { ic: `%${itemCode}%` });
    if (locationCode)  qb.andWhere('por.location_code ILIKE :lc', { lc: `%${locationCode}%` });
    if (weekNumber)    qb.andWhere('por.week_number = :wn', { wn: weekNumber });
    if (status)        qb.andWhere('por.status = :status', { status });
    if (frozenZoneFlag !== undefined)
      qb.andWhere('por.frozen_zone_flag = :fz', { fz: frozenZoneFlag });

    qb.orderBy('por.week_number', 'ASC').addOrderBy('por.item_code', 'ASC').skip(skip).take(pageSize);
    const [data, total] = await qb.getManyAndCount();

    const summaryRes = await this.dataSource.query(`
      SELECT
        SUM(planned_order_qty) AS total_qty,
        COUNT(*) AS total_orders,
        COUNT(*) FILTER (WHERE status = 'AUTO_RELEASE') AS auto_release,
        COUNT(*) FILTER (WHERE status = 'NEEDS_APPROVAL') AS needs_approval
      FROM planned_order_release WHERE plan_run_id = $1
    `, [planRunId]);
    const s = summaryRes[0] ?? {};

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      summary: {
        totalPlannedQty: parseFloat(s.total_qty ?? '0'),
        totalOrders: parseInt(s.total_orders ?? '0'),
        autoRelease: parseInt(s.auto_release ?? '0'),
        needsApproval: parseInt(s.needs_approval ?? '0'),
      },
    };
  }

  // ═══════════════════════════════════════════════════════
  // TASK 4 — EXCEPTIONS
  // ═══════════════════════════════════════════════════════

  async getExceptions(query: GetExceptionsQueryDto) {
    const { planRunId, type, severity, resolved, page = 1, pageSize = 50 } = query;
    const skip = (page - 1) * pageSize;

    const qb = this.excRepo.createQueryBuilder('exc');
    qb.where('exc.plan_run_id = :planRunId', { planRunId });
    if (type)     qb.andWhere('exc.type = :type', { type });
    if (severity) qb.andWhere('exc.severity = :severity', { severity });
    if (resolved !== undefined) qb.andWhere('exc.resolved = :resolved', { resolved });

    // WARNING-2 FIX: TypeORM QueryBuilder không support raw CASE expression trong orderBy()
    // → sort in-memory sau getManyAndCount()
    qb.orderBy('exc.created_at', 'ASC').skip(skip).take(pageSize);
    const [data, total] = await qb.getManyAndCount();

    // Sort HIGH → MEDIUM → LOW
    const severityOrder: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };
    data.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async resolveException(excId: string, dto: ResolveExceptionDto) {
    const exc = await this.excRepo.findOne({ where: { id: excId } });
    if (!exc) throw new NotFoundException(`Exception ${excId} not found`);

    exc.resolved = true;
    exc.resolvedBy = dto.resolvedBy ?? null;
    exc.resolvedAt = new Date();
    exc.resolutionNote = dto.resolutionNote;
    return this.excRepo.save(exc);
  }

  // ═══════════════════════════════════════════════════════
  // TASK 5 — NETTING DETAIL (12-week trace)
  // ═══════════════════════════════════════════════════════

  async getNettingDetail(planRunId: string, itemCode: string, locationCode: string) {
    // BUG-1 FIX: planned_order_release giờ lưu ALL 12 tuần (kể cả PO=0)
    // → full trace luôn có đủ 12 rows, không cần reconstruct
    // beginningInventory được lưu vào column 'beginning_inventory' tại tuần 1
    const weeks = await this.porRepo.find({
      where: { planRunId, itemCode, locationCode },
      order: { weekNumber: 'ASC' },
    });

    if (weeks.length === 0)
      throw new NotFoundException(`Không có netting data cho ${itemCode} @ ${locationCode} trong run ${planRunId}`);

    const week1 = weeks.find(w => w.weekNumber === 1);
    const ss = week1?.safetyStock ?? 0;
    // beginningInventory được lưu trực tiếp tại week_number=1
    const beginningInventory = week1 ? parseFloat(String(week1.beginningInventory)) : 0;

    return {
      itemCode, locationCode, planRunId,
      safetyStock: ss,
      beginningInventory,
      weeks: weeks.map(o => ({
        week:        o.weekNumber,
        weekStartDate: o.weekStartDate,
        gr:          parseFloat(String(o.grossRequirement)),
        sr:          parseFloat(String(o.scheduledReceipt)),
        pabBefore:   parseFloat(String(o.pabBefore)),
        nr:          parseFloat(String(o.netRequirement)),
        po:          parseFloat(String(o.plannedOrderQty)),
        pabAfter:    parseFloat(String(o.pabAfter)),
        hstk:        o.hstk,
        frozenZone:  o.frozenZoneFlag,
        status:      o.status,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════
  // TASK 6 — APPROVE / CANCEL PLANNED ORDER
  // ═══════════════════════════════════════════════════════

  async approvePlannedOrder(id: string, dto: ApprovePlannedOrderDto) {
    const order = await this.porRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Planned order ${id} not found`);
    if (order.status !== 'NEEDS_APPROVAL')
      throw new BadRequestException(`Order ${id} status is ${order.status}, không phải NEEDS_APPROVAL`);

    order.status = 'RELEASED';
    order.approvedBy = dto.approvedBy ?? null;
    order.approvedAt = new Date();
    return this.porRepo.save(order);
  }

  async cancelPlannedOrder(id: string, dto: CancelPlannedOrderDto) {
    const order = await this.porRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Planned order ${id} not found`);
    if (['RELEASED', 'CANCELLED'].includes(order.status))
      throw new BadRequestException(`Order ${id} status ${order.status} không thể cancel`);

    order.status = 'CANCELLED';
    order.cancelledBy = dto.cancelledBy ?? null;
    order.cancelledAt = new Date();
    order.cancelReason = dto.reason;
    return this.porRepo.save(order);
  }

  // ═══════════════════════════════════════════════════════
  // TASK 7 — HSTK SUMMARY
  // ═══════════════════════════════════════════════════════

  async getHstkSummary(planRunId: string) {
    const rows: { type: string; cnt: string }[] = await this.dataSource.query(`
      SELECT type, COUNT(*) AS cnt
      FROM drp_exception
      WHERE plan_run_id = $1
        AND type IN ('STOCKOUT_ALERT', 'OVERSTOCK_ALERT')
      GROUP BY type
    `, [planRunId]);

    // ISSUE-2 FIX: Đếm combinations từ demand_snapshot_line (qua plan_run)
    // KHÔNG đếm từ planned_order_release vì bảng đó chứa tất cả 12 tuần × combo
    // — items không có PO vẫn có rows (PO=0), nhưng vẫn cần đếm đúng số combinations
    // Dùng combinations_processed đã lưu sẵn trong plan_run (chính xác, không cần JOIN)
    const runRes = await this.dataSource.query(`
      SELECT combinations_processed FROM plan_run WHERE id = $1
    `, [planRunId]);
    const total = parseInt(runRes[0]?.combinations_processed ?? '0');

    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.type] = parseInt(r.cnt);

    const stockout  = byType['STOCKOUT_ALERT']  ?? 0;
    const overstock = byType['OVERSTOCK_ALERT'] ?? 0;
    const ok        = Math.max(0, total - stockout - overstock);

    return {
      totalCombinations: total,
      stockoutCount: stockout,
      stockoutPct: total > 0 ? Math.round(stockout / total * 1000) / 10 : 0,
      okCount: ok,
      okPct: total > 0 ? Math.round(ok / total * 1000) / 10 : 0,
      overstockCount: overstock,
      overstockPct: total > 0 ? Math.round(overstock / total * 1000) / 10 : 0,
    };
  }
}
```

---

## CONTROLLER FILE

```typescript
// File: backend/src/drp/drp.controller.ts

import {
  Controller, Get, Post, Patch, Param, Body, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DrpService } from './drp.service';
import {
  CreateDrpRunDto, GetPlannedOrdersQueryDto, GetExceptionsQueryDto,
  ResolveExceptionDto, ApprovePlannedOrderDto, CancelPlannedOrderDto,
} from './dto';

@ApiTags('drp')
@Controller('drp')
export class DrpController {
  constructor(private readonly svc: DrpService) {}

  // ─── Plan Runs ─────────────────────────────────────────────────────────────

  @Post('run')
  @ApiOperation({ summary: 'Trigger DRP netting run (async, fire-and-forget)' })
  createRun(@Body() dto: CreateDrpRunDto) {
    return this.svc.createAndRunDrp(dto);
  }

  @Get('run')
  @ApiOperation({ summary: 'List 20 most recent DRP runs' })
  listRuns() {
    return this.svc.listPlanRuns();
  }

  @Get('run/:id')
  @ApiOperation({ summary: 'Get DRP run status + exceptions breakdown' })
  getRun(@Param('id') id: string) {
    return this.svc.getPlanRun(id);
  }

  // ─── Planned Orders ────────────────────────────────────────────────────────

  @Get('run/:id/planned-orders')
  @ApiOperation({ summary: 'List planned orders — filter by item, location, week, status' })
  getPlannedOrders(@Param('id') id: string, @Query() query: GetPlannedOrdersQueryDto) {
    return this.svc.getPlannedOrders({ ...query, planRunId: id });
  }

  @Get('run/:id/netting-detail/:itemCode/:locationCode')
  @ApiOperation({ summary: '12-week netting trace cho 1 item × location' })
  getNettingDetail(
    @Param('id') id: string,
    @Param('itemCode') itemCode: string,
    @Param('locationCode') locationCode: string,
  ) {
    return this.svc.getNettingDetail(id, itemCode, locationCode);
  }

  @Patch('planned-orders/:id/approve')
  @ApiOperation({ summary: 'Approve planned order trong frozen zone' })
  approve(@Param('id') id: string, @Body() dto: ApprovePlannedOrderDto) {
    return this.svc.approvePlannedOrder(id, dto);
  }

  @Patch('planned-orders/:id/cancel')
  @ApiOperation({ summary: 'Cancel planned order' })
  cancel(@Param('id') id: string, @Body() dto: CancelPlannedOrderDto) {
    return this.svc.cancelPlannedOrder(id, dto);
  }

  // ─── Exceptions ────────────────────────────────────────────────────────────

  @Get('run/:id/exceptions')
  @ApiOperation({ summary: 'List exceptions — filter by type, severity, resolved' })
  getExceptions(@Param('id') id: string, @Query() query: GetExceptionsQueryDto) {
    return this.svc.getExceptions({ ...query, planRunId: id });
  }

  @Patch('run/:runId/exceptions/:excId/resolve')
  @ApiOperation({ summary: 'Planner resolve exception' })
  resolveException(
    @Param('excId') excId: string,
    @Body() dto: ResolveExceptionDto,
  ) {
    return this.svc.resolveException(excId, dto);
  }

  // ─── HSTK ──────────────────────────────────────────────────────────────────

  @Get('run/:id/hstk')
  @ApiOperation({ summary: 'HSTK summary: stockout / ok / overstock counts' })
  getHstk(@Param('id') id: string) {
    return this.svc.getHstkSummary(id);
  }
}
```

---

## DTO FILE

```typescript
// File: backend/src/drp/dto/index.ts

import { IsString, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateDrpRunDto {
  @ApiProperty({ description: 'UUID của demand_snapshot (FROZEN)' })
  @IsString()
  demandSnapshotId: string;

  // BUG-2 FIX: supply_snapshot.id là BIGINT — dùng @IsInt() + @Type(() => Number)
  // để tránh PostgreSQL so sánh BIGINT = string trả về kết quả rỗng không lỗi
  @ApiProperty({ description: 'ID (BIGINT) của supply_snapshot (FROZEN)' })
  @IsInt()
  @Type(() => Number)
  supplySnapshotId: number;

  @ApiPropertyOptional({ description: 'Ngày bắt đầu horizon (default: today)' })
  @IsOptional() @IsString()
  horizonStart?: string;  // ISO date string, default = today

  // acknowledgeStale đã bỏ — stale gate dùng supply_snapshot.stale_acknowledged (Module 2 set)
  // Planner phải acknowledge STALE trong Module 2 trước, DRP tự đọc column đó

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  createdBy?: string;
}

export class GetPlannedOrdersQueryDto extends PaginationDto {
  planRunId?: string; // Injected từ route param

  @ApiPropertyOptional() @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  weekNumber?: number;

  @ApiPropertyOptional({ enum: ['AUTO_RELEASE','NEEDS_APPROVAL','RELEASED','CANCELLED'] })
  @IsOptional() @IsString()
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() @Type(() => Boolean)
  frozenZoneFlag?: boolean;
}

export class GetExceptionsQueryDto extends PaginationDto {
  planRunId?: string; // Injected từ route param

  @ApiPropertyOptional({ enum: ['PAB_NEGATIVE','STOCKOUT_ALERT','OVERSTOCK_ALERT','FROZEN_ZONE_VIOLATION','MISSING_SS','NETTING_TIMEOUT'] })
  @IsOptional() @IsString()
  type?: string;

  @ApiPropertyOptional({ enum: ['HIGH','MEDIUM','LOW'] })
  @IsOptional() @IsString()
  severity?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() @Type(() => Boolean)
  resolved?: boolean;
}

export class ResolveExceptionDto {
  @ApiProperty()
  @IsString()
  resolutionNote: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  resolvedBy?: string;
}

export class ApprovePlannedOrderDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  approvedBy?: string;
}

export class CancelPlannedOrderDto {
  @ApiProperty()
  @IsString()
  reason: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  cancelledBy?: string;
}
```

---

## MODULE REGISTRATION

```typescript
// File: backend/src/drp/drp.module.ts

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DrpController } from './drp.controller';
import { DrpService } from './drp.service';
import { PlanRun } from './entities/plan-run.entity';
import { PlannedOrderRelease } from './entities/planned-order-release.entity';
import { DrpException } from './entities/drp-exception.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlanRun, PlannedOrderRelease, DrpException]),
    // WARNING-1: PolicyModule không được inject trong Phase 1 vì SS pre-load dùng raw SQL (tránh N+1).
    // Phase 2: nếu PolicyService thêm loadAllSsFinal() với cache → import PolicyModule ở đây
    // và inject PolicyService vào DrpService thay cho raw SQL query.
    // PolicyModule,
  ],
  controllers: [DrpController],
  providers: [DrpService],
  exports: [DrpService], // Module 5 inject DrpService để read planned orders
})
export class DrpModule {}
```

```typescript
// File: backend/src/app.module.ts — THÊM DrpModule vào imports[]

import { DrpModule } from './drp/drp.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ... }),
    DemandModule,
    SupplyModule,
    PolicyModule,
    DrpModule,   // ← THÊM
    // InsightsModule, ...
  ],
})
export class AppModule {}
```

---

## FRONTEND PAGE SKELETON

```typescript
// File: frontend/app/drp/page.tsx — Thay ModuleShell bằng full page

// Tab 1: Runs — trigger button + history table + status badge
// Tab 2: Planned Orders — filter + approve/cancel + export
// Tab 3: Exceptions — summary cards (stockout/overstock/pab_neg/frozen) + resolve list
// Tab 4: Netting Grid — search item+location → 12-week table (GR/SR/PAB/NR/PO/HSTK)

// FE gọi: lib/api/drp.ts (tạo mới)
// Endpoints:
//   GET  /api/v1/drp/run                → listRuns()
//   POST /api/v1/drp/run                → createRun()
//   GET  /api/v1/drp/run/:id            → getRun() (poll để cập nhật status)
//   GET  /api/v1/drp/run/:id/planned-orders  → getPlannedOrders()
//   GET  /api/v1/drp/run/:id/exceptions      → getExceptions()
//   GET  /api/v1/drp/run/:id/hstk            → getHstk()
//   GET  /api/v1/drp/run/:id/netting-detail/:item/:loc → getNettingDetail()
//   PATCH /api/v1/drp/planned-orders/:id/approve → approve()
//   PATCH /api/v1/drp/planned-orders/:id/cancel  → cancel()
//   PATCH /api/v1/drp/run/:runId/exceptions/:excId/resolve → resolve()
```

---

## TASK CHECKLIST — THỨ TỰ BUILD

### BE Tasks (dev đọc theo thứ tự)

```
BE-1  Tạo folder structure
      backend/src/drp/
        entities/
        dto/
        migrations/

BE-2  Viết migration: migrations/001_create_drp_tables.sql
      ⚠️ Trước khi run: verify FK tables tồn tại
        SELECT 1 FROM information_schema.tables WHERE table_name IN ('item','location','demand_snapshot','supply_snapshot');
      Run: psql -d unis_scp -f 001_create_drp_tables.sql
      Verify: \d plan_run  \d planned_order_release  \d drp_exception

BE-3  Viết entities (phải trước DTO và Service để tránh compile error)
      entities/plan-run.entity.ts
      entities/planned-order-release.entity.ts
      entities/drp-exception.entity.ts

BE-4  Viết drp-config.ts (constants — không phụ thuộc gì)

BE-5  Viết dto/index.ts  ← TRƯỚC service (service import DTO ngay từ đầu)
      CreateDrpRunDto, GetPlannedOrdersQueryDto, GetExceptionsQueryDto
      ResolveExceptionDto, ApprovePlannedOrderDto, CancelPlannedOrderDto

BE-6  Viết drp.service.ts — chia làm 3 bước nhỏ để test từng phần:

      BE-6a  Pure helpers (không cần DB, testable độc lập)
             countWeeksInMonth()
             getWeekStartDate()
             buildWeeklyDemandMap()
             runNetting()   ← pure function, test với mock data trước

      BE-6b  Pre-load helpers (cần DB)
             loadInventoryMap()
             loadScheduledReceiptMap()
             loadWeeklyDemandMap()
             → Smoke test: gọi từng hàm với snapshot ID thật, log output

      BE-6c  Business methods (cần BE-6a + BE-6b hoàn chỉnh)
             createAndRunDrp() + calculateDrpBatch()
             listPlanRuns(), getPlanRun()
             getPlannedOrders(), getNettingDetail()
             getExceptions(), resolveException()
             approvePlannedOrder(), cancelPlannedOrder()
             getHstkSummary()

BE-7  Viết drp.controller.ts (10 endpoints)

BE-8  Viết drp.module.ts

BE-9  Đăng ký DrpModule trong app.module.ts

BE-10 Test via Swagger — thứ tự test:
      1. POST /drp/run  → verify plan_run tạo ra, status = RUNNING rồi COMPLETED
      2. GET  /drp/run/:id  → verify planned_orders_count, exceptions_count
      3. GET  /drp/run/:id/planned-orders  → spot-check 1 item có PO
      4. GET  /drp/run/:id/netting-detail/:item/:loc  → verify 12 tuần đủ
      5. GET  /drp/run/:id/exceptions  → verify sort HIGH trước
      6. GET  /drp/run/:id/hstk  → verify totalCombinations = combinations_processed
      7. PATCH approve/cancel/resolve  → verify status change
      Target: full run < 60s cho ~4,830 combinations
```

### FE Tasks

```
FE-1  Tạo lib/api/drp.ts (API client functions — làm trước, các tab đều dùng)
      listRuns, createRun, getRun, getPlannedOrders, getExceptions,
      getHstk, getNettingDetail, approve, cancel, resolve

FE-2  Build Tab 1: Run Dashboard  ← làm trước vì trigger toàn bộ flow
      - "Run DRP" button + modal chọn demand_snapshot + supply_snapshot
      - Hiển thị demand snapshots FROZEN + supply snapshots FROZEN (dropdown)
      - History table: run_id | status badge | duration | planned_orders_count | exceptions_count
      - Auto-refresh polling khi status = RUNNING (mỗi 3s dùng setInterval)
      - Click vào run → chuyển sang Tab 2/3 filter theo run_id đó

── Tab 2, 3, 4 độc lập nhau → có thể build song song ──

FE-3  Build Tab 2: Planned Orders
      - Filter: itemCode, locationCode, week, status, frozenZone
      - Table: item | location | week | qty | pab_before | pab_after | SS | HSTK | status
      - Bulk actions: Approve all frozen zone (NEEDS_APPROVAL)
      - Individual approve/cancel buttons

FE-4  Build Tab 3: Exceptions
      - Summary cards: STOCKOUT (red) | OVERSTOCK (green) | PAB_NEGATIVE (dark red) | FROZEN_ZONE (yellow)
      - Exception list: type | severity | item | location | week | message | resolved?
      - Resolve button → text input → submit
      - Unresolved count badge trên tab header

FE-5  Build Tab 4: Netting Grid
      - Search: itemCode + locationCode input → GET netting-detail
      - 12-column table: week 1-12
      - Rows: GR | SR | PAB_before | NR | PO | PAB_after | HSTK
      - Color coding: PAB_before < SS → red | PAB < 0 → dark red | PO > 0 → blue | week 1-2 → gray overlay
      - Hiển thị beginningInventory (tuần 1) và safetyStock ở header
```

---

## KNOWN ISSUES & NOTES

```
NOTE-1: Scheduled Receipts — Phase 1 limitation
  supply_snapshot_line.in_transit_qty là tổng qty đang trên đường, KHÔNG có ETA.
  → Phase 1: gán toàn bộ in_transit_qty vào tuần 1 (conservative / optimistic).
  → Phase 2: khi Bravo SFTP có ETA per shipment → phân bổ đúng tuần.

NOTE-2: SS bulk pre-load
  calculateDrpBatch() pre-load SS từ safety_stock_target qua raw SQL,
  KHÔNG dùng PolicyService.getSsFinal() để tránh N+1.
  Nếu Module 3 thêm cache layer trong Phase 2 → cân nhắc switch về getSsFinal().

NOTE-3: demand_snapshot_line.reconciled_qty — CONFIRMED tồn tại
  Entity demand-snapshot-line.entity.ts có column reconciled_qty (nullable).
  BA spec COALESCE(reconciled_qty, forecast_qty) là ĐÚNG — đã áp dụng.
  loadWeeklyDemandMap() và combinations query đều dùng COALESCE(reconciled_qty, qty).
  → Planner override reconciled_qty sẽ được DRP tự động dùng, không cần re-trigger.

NOTE-4: horizonStart configuration
  CreateDrpRunDto nhận horizonStart từ FE (ISO date string).
  Default = today nếu không set.
  UNIS nên set horizonStart = thứ Hai tuần hiện tại (Monday of current week).

NOTE-5: drp_netting_detail table — Phase 2
  Phase 1: không save drp_netting_detail (save storage, tăng performance).
  getNettingDetail() reconstruct từ planned_order_release (đủ dùng).
  Phase 2: nếu audit trail required → enable save drp_netting_detail trong calculateDrpBatch().

NOTE-6: Performance target
  4,830 combinations × 12 weeks = 57,960 calculations.
  Giờ save ALL 12 tuần → 57,960 rows thay vì chỉ rows có PO.
  3 pre-load queries + in-memory compute + batch INSERT (500/batch ≈ 116 INSERT calls).
  Estimate: < 20s. Nếu > 20s → tăng BATCH_SIZE lên 1000, check index.
  Target spec: < 60s (plenty of margin).

NOTE-7: Module 5 (Allocation) — query planned_order_release
  Module 5 phải đọc WHERE status IN ('AUTO_RELEASE', 'RELEASED'):
  - AUTO_RELEASE: tuần 3-12 có PO, không cần planner approve
  - RELEASED:     tuần 1-2 trong frozen zone, planner đã approve
  KHÔNG đọc WHERE status = 'AUTO_RELEASE' alone → bỏ sót frozen zone orders đã approve.
  Rows có planned_order_qty = 0 (tuần không cần đặt hàng) → Module 5 filter thêm AND planned_order_qty > 0.
```
