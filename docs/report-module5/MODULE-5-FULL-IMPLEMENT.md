# Module 5 — Allocation Engine: Full Implementation Guide

> **Version:** 1.1 | **Date:** 2026-04-14
> **Stack:** NestJS 10 · TypeORM · PostgreSQL · Next.js 14
> **Port BE:** 3002 | **Prefix:** `/api/v1/allocation`
> **Depends on:** Module 2 (lot_attribute), Module 3 (rtm_rule, safety_stock_target, item_abc_classification), Module 4 (planned_order_release, plan_run)

---

## 0. Tổng quan

Allocation Engine là cầu nối giữa **DRP netting (Module 4)** và **Transport Planning (Module 6)**.

- Module 4 trả lời: *"CN nào cần bao nhiêu?"* → `planned_order_release.planned_order_qty`
- Module 5 trả lời: *"Lấy hàng từ kho nào?"* → `allocation_result.source_location_code`

### 6-Layer Sequential Filter (UNIS Phase 1)

```
planned_order_release (status IN AUTO_RELEASE/RELEASED, week_number=1, qty > 0)
       │
       ▼
  L1: RTM Source Selection      ← rtm_rule: branch→warehouse waterfall P1→P2→P3
       │
       ▼
  L2: Quality Filter            ← quality_status='ALLOCATABLE' (SKIP variant — no specs_id)
       │
       ▼
  L3: FEFO                      ← SKIP (fefo_enabled=false — gạch men không hết hạn)
       │
       ▼
  L4: ABC Fair-Share            ← item_abc_classification, mode=FCFS Phase 1
       │
       ▼
  L5: Safety Stock Guard        ← safety_stock_target JOIN ACTIVE policy_run
       │
       ▼
  L6: LCNB Detect               ← scan lot_attribute, tạo allocation_recommendation
       │
       ▼
  allocation_result + allocation_recommendation
```

---

## 1. UNIS Constraints — đọc trước khi code

```
1. PK types:
   - allocation_run.id              → BIGSERIAL
   - allocation_result.id           → BIGSERIAL
   - allocation_recommendation.id   → BIGSERIAL
   - planned_order_release.id       → BIGINT FK từ Module 4
   - plan_run.id                    → BIGINT FK từ Module 4

2. Item/Location keys: VARCHAR (không phải UUID)
   - item_code VARCHAR(50)
   - location_code VARCHAR(20)

3. RTM reality (verified từ DB):
   - rtm_rule.branch_code   = location_code của CN (destination)
   - rtm_rule.warehouse_code = location_code của kho nguồn (source)
   - item_code = NULL → rule áp dụng cho tất cả items (hiện tại 133 rules đều NULL)
   - priority: 1 = primary, 2 = secondary, 3 = tertiary
   - KHÔNG có layer column, KHÔNG có fallback_action column

4. DA TASK — cần làm TRƯỚC khi chạy allocation:
   Seed lại rtm_rule.warehouse_code = branch_code thực (location_code trong lot_attribute)
   Hiện tại warehouse_code = 'HUBR00001'...'HUBR00020' (không tồn tại trong lot_attribute)
   → 100% allocation sẽ ra UNALLOCATED nếu chưa seed
   
   SQL seed mẫu:
   UPDATE rtm_rule SET warehouse_code = '<branch_code_thực>' WHERE warehouse_code = 'HUBR00001';
   
   Hoặc DA insert rtm_rule mới với warehouse_code = branch_code thực của kho nguồn.

5. Supply source: lot_attribute (live data, không có snapshot FK)
   - allocatable_qty = on_hand_qty - reserved_qty (tính runtime)
   - quality_status: chỉ lấy 'ALLOCATABLE'
   - Không có specs_id → L2 Variant = SKIP Phase 1
   - lot_attribute.location_code = branch/location codes (001, 002, ...) — nhất quán với rtm_rule.branch_code

6. Demand source: planned_order_release
   - WHERE status IN ('AUTO_RELEASE', 'RELEASED') AND week_number = 1 AND planned_order_qty > 0
   - 7,906 rows sẵn sàng (verified)

7. ABC classification: item-level ONLY
   - Bảng item_abc_classification KHÔNG có location_code
   - Query: DISTINCT ON (item_code) ORDER BY effective_date DESC
   - 1,571 rows hiện có

8. Async pattern: fire-and-forget như Module 4
   - POST /allocation/run → trả về runId + status=RUNNING ngay (202)
   - FE polling GET /allocation/runs/:id mỗi 3s
   - Lý do: 7,906 demand lines × 6 layers có thể mất 15-30s

9. Concurrency: in-memory Map mutation (không dùng SELECT FOR UPDATE)
   - supplyMap (lot_attribute) load một lần vào memory
   - Allocation loop mutate map in-memory (supply.qty -= take)
   - Safe vì mỗi allocation_run là isolated run (không concurrent writes)

10. Phase 1 simplifications:
    - L4 ABC: FCFS (first-come-first-served), không batch shortage detection
    - L6 LCNB: DETECT_ONLY, tạo recommendation, không tự chuyển hàng
    - Dispatch limit: warning vào layer_trace, KHÔNG block
    - Channel isolation: OFF (lot_attribute không có channel_code)
    - No Kafka — HTTP polling pattern (không có Kafka trong UNIS backend)

11. Module import: AllocationModule PHẢI import PolicyModule
    (để inject PolicyService.getSsFinal nếu cần Phase 2 migration)
    Phase 1: dùng raw SQL cho SS load, PolicyModule vẫn cần import để không broken
```

---

## 2. DB Schema — 3 bảng mới

### Migration: `src/allocation/migrations/001_create_allocation_tables.sql`

```sql
-- ── allocation_run ──────────────────────────────────────────────────────────
CREATE TABLE allocation_run (
  id                    BIGSERIAL PRIMARY KEY,
  plan_run_id           BIGINT       NOT NULL,
  status                VARCHAR(20)  NOT NULL DEFAULT 'RUNNING',
  -- RUNNING | COMPLETED | PARTIAL | FAILED
  total_demand_lines    INT          NOT NULL DEFAULT 0,
  total_allocated       INT          NOT NULL DEFAULT 0,
  total_partial         INT          NOT NULL DEFAULT 0,
  total_unallocated     INT          NOT NULL DEFAULT 0,
  fill_rate_overall     DECIMAL(5,4) DEFAULT NULL,
  fill_rate_a           DECIMAL(5,4) DEFAULT NULL,
  fill_rate_b           DECIMAL(5,4) DEFAULT NULL,
  fill_rate_c           DECIMAL(5,4) DEFAULT NULL,
  config_snapshot       JSONB        DEFAULT NULL,
  error_message         TEXT         DEFAULT NULL,
  created_by            VARCHAR(100) DEFAULT NULL,
  started_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ  DEFAULT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_allocation_run_plan_run ON allocation_run(plan_run_id);
CREATE INDEX idx_allocation_run_status   ON allocation_run(status);

-- ── allocation_result ───────────────────────────────────────────────────────
CREATE TABLE allocation_result (
  id                          BIGSERIAL    PRIMARY KEY,
  allocation_run_id           BIGINT       NOT NULL,
  planned_order_release_id    BIGINT       NOT NULL,
  item_code                   VARCHAR(50)  NOT NULL,
  source_location_code        VARCHAR(20)  NOT NULL,
  dest_location_code          VARCHAR(20)  NOT NULL,
  lot_number                  VARCHAR(50)  NOT NULL DEFAULT 'DEFAULT',
  qty_required                DECIMAL(15,2) NOT NULL DEFAULT 0,
  qty_allocated               DECIMAL(15,2) NOT NULL DEFAULT 0,
  fill_rate                   DECIMAL(5,4)  DEFAULT NULL,
  abc_class                   CHAR(1)       DEFAULT NULL,
  source_priority             INT           DEFAULT 1,
  status                      VARCHAR(20)   NOT NULL DEFAULT 'UNALLOCATED',
  -- ALLOCATED | PARTIAL | UNALLOCATED
  layer_trace                 JSONB         DEFAULT '{}',
  week_number                 INT           DEFAULT 1,
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alloc_result_run    ON allocation_result(allocation_run_id);
CREATE INDEX idx_alloc_result_item   ON allocation_result(item_code, dest_location_code);
CREATE INDEX idx_alloc_result_status ON allocation_result(status);
CREATE INDEX idx_alloc_result_por    ON allocation_result(planned_order_release_id);

-- ── allocation_recommendation (LCNB) ───────────────────────────────────────
CREATE TABLE allocation_recommendation (
  id                  BIGSERIAL    PRIMARY KEY,
  allocation_run_id   BIGINT       NOT NULL,
  type                VARCHAR(40)  NOT NULL DEFAULT 'LCNB_LATERAL_TRANSFER',
  from_location_code  VARCHAR(20)  NOT NULL,
  to_location_code    VARCHAR(20)  NOT NULL,
  item_code           VARCHAR(50)  NOT NULL,
  suggested_qty       DECIMAL(15,2) NOT NULL DEFAULT 0,
  status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  -- PENDING | ACCEPTED | REJECTED | EXPIRED
  decided_by          VARCHAR(100) DEFAULT NULL,
  decided_at          TIMESTAMPTZ  DEFAULT NULL,
  note                TEXT         DEFAULT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alloc_rec_run    ON allocation_recommendation(allocation_run_id);
CREATE INDEX idx_alloc_rec_status ON allocation_recommendation(status);
```

> **Note:** 3 bảng trên CHƯA TỒN TẠI trong DB (verified). DA chạy migration trước khi BE deploy.

---

## 3. Entities

### `src/allocation/entities/allocation-run.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('allocation_run')
export class AllocationRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @Column({ type: 'varchar', length: 20, default: 'RUNNING' })
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

  @Column({ name: 'total_demand_lines', type: 'int', default: 0 })
  totalDemandLines: number;

  @Column({ name: 'total_allocated', type: 'int', default: 0 })
  totalAllocated: number;

  @Column({ name: 'total_partial', type: 'int', default: 0 })
  totalPartial: number;

  @Column({ name: 'total_unallocated', type: 'int', default: 0 })
  totalUnallocated: number;

  @Column({ name: 'fill_rate_overall', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateOverall: number | null;

  @Column({ name: 'fill_rate_a', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateA: number | null;

  @Column({ name: 'fill_rate_b', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateB: number | null;

  @Column({ name: 'fill_rate_c', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateC: number | null;

  @Column({ name: 'config_snapshot', type: 'jsonb', nullable: true, default: null })
  configSnapshot: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @Column({ name: 'started_at', type: 'timestamptz', default: () => 'NOW()' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true, default: null })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### `src/allocation/entities/allocation-result.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('allocation_result')
export class AllocationResult {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint' })
  allocationRunId: string;

  @Column({ name: 'planned_order_release_id', type: 'bigint' })
  plannedOrderReleaseId: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'lot_number', type: 'varchar', length: 50, default: 'DEFAULT' })
  lotNumber: string;

  @Column({ name: 'qty_required', type: 'decimal', precision: 15, scale: 2, default: 0 })
  qtyRequired: number;

  @Column({ name: 'qty_allocated', type: 'decimal', precision: 15, scale: 2, default: 0 })
  qtyAllocated: number;

  @Column({ name: 'fill_rate', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRate: number | null;

  @Column({ name: 'abc_class', type: 'char', length: 1, nullable: true, default: null })
  abcClass: 'A' | 'B' | 'C' | null;

  @Column({ name: 'source_priority', type: 'int', default: 1 })
  sourcePriority: number;

  @Column({ type: 'varchar', length: 20, default: 'UNALLOCATED' })
  status: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED';

  @Column({ name: 'layer_trace', type: 'jsonb', default: () => "'{}'::jsonb" })
  layerTrace: Record<string, unknown>;

  @Column({ name: 'week_number', type: 'int', default: 1 })
  weekNumber: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### `src/allocation/entities/allocation-recommendation.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('allocation_recommendation')
export class AllocationRecommendation {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint' })
  allocationRunId: string;

  @Column({ type: 'varchar', length: 40, default: 'LCNB_LATERAL_TRANSFER' })
  type: 'LCNB_LATERAL_TRANSFER';

  @Column({ name: 'from_location_code', type: 'varchar', length: 20 })
  fromLocationCode: string;

  @Column({ name: 'to_location_code', type: 'varchar', length: 20 })
  toLocationCode: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'suggested_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  suggestedQty: number;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

  @Column({ name: 'decided_by', type: 'varchar', length: 100, nullable: true, default: null })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true, default: null })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

---

## 4. Config

### `src/allocation/allocation-config.ts`

```typescript
export const UNIS_ALLOCATION_CONFIG = {
  fefoEnabled: false,
  variantMatchEnabled: false,   // TODO Phase 2: khi lot_attribute có specs_id

  abcWeights: { A: 2.0, B: 1.5, C: 1.0 } as Record<string, number>,

  ssGuardEnabled: true,

  lcnbMode: 'DETECT_ONLY' as const,
  lcnbSurplusThreshold: 1,

  dispatchLimit: 800,           // warning-only Phase 1

  insertChunkSize: 200,

  // Chỉ allocate week_number = 1 (tuần gần nhất cần hàng)
  allocateWeekNumbers: [1],
} as const;
```

---

## 5. DTOs

### `src/allocation/dto/index.ts`

```typescript
import { IsString, IsOptional, IsIn, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAllocationRunDto {
  @ApiProperty({ description: 'plan_run_id từ Module 4 (BIGINT as string)' })
  @IsString()
  planRunId: string;

  @ApiPropertyOptional({ description: 'Override supply snapshot (default: lấy từ plan_run)' })
  @IsOptional()
  @IsString()
  supplySnapshotId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({ description: 'Override dispatch limit (default: 800)' })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  dispatchLimitOverride?: number;
}

export class GetAllocationResultsQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1;
  @IsOptional() @Type(() => Number) pageSize?: number = 50;

  @IsOptional() @IsString() itemCode?: string;
  @IsOptional() @IsString() destLocationCode?: string;
  @IsOptional() @IsString() sourceLocationCode?: string;

  @IsOptional() @IsIn(['ALLOCATED', 'PARTIAL', 'UNALLOCATED'])
  status?: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED';

  @IsOptional() @IsIn(['A', 'B', 'C'])
  abcClass?: 'A' | 'B' | 'C';
}

export class GetRecommendationsQueryDto {
  @IsOptional() @Type(() => Number) page?: number = 1;
  @IsOptional() @Type(() => Number) pageSize?: number = 50;

  @IsOptional() @IsIn(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'])
  status?: string;
}

export class DecideRecommendationDto {
  @ApiProperty({ enum: ['ACCEPTED', 'REJECTED'] })
  @IsIn(['ACCEPTED', 'REJECTED'])
  decision: 'ACCEPTED' | 'REJECTED';

  @IsOptional() @IsNumber() @Min(0) @Type(() => Number) adjustedQty?: number;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() decidedBy?: string;
}

export class RetryAllocationDto {
  @ApiProperty({ type: [String] })
  plannedOrderReleaseIds: string[];

  @IsOptional() @IsString() reason?: string;
}
```

---

## 6. Service

### `src/allocation/allocation.service.ts`

```typescript
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AllocationRun } from './entities/allocation-run.entity';
import { AllocationResult } from './entities/allocation-result.entity';
import { AllocationRecommendation } from './entities/allocation-recommendation.entity';
import { UNIS_ALLOCATION_CONFIG } from './allocation-config';
import {
  CreateAllocationRunDto, GetAllocationResultsQueryDto,
  GetRecommendationsQueryDto, DecideRecommendationDto, RetryAllocationDto,
} from './dto';

interface DemandLine {
  porId: string;
  itemCode: string;
  destLocationCode: string;
  qtyRequired: number;
  weekNumber: number;
  abcClass: 'A' | 'B' | 'C';
}

interface RtmRule {
  sourceLocationCode: string;
  priority: number;
}

interface AllocationDecision {
  porId: string;
  itemCode: string;
  sourceLocationCode: string;
  destLocationCode: string;
  lotNumber: string;
  qtyRequired: number;
  qtyAllocated: number;
  abcClass: 'A' | 'B' | 'C';
  sourcePriority: number;
  weekNumber: number;
  layerTrace: Record<string, unknown>;
}

@Injectable()
export class AllocationService {
  constructor(
    @InjectRepository(AllocationRun)   private readonly runRepo: Repository<AllocationRun>,
    @InjectRepository(AllocationResult) private readonly resultRepo: Repository<AllocationResult>,
    @InjectRepository(AllocationRecommendation) private readonly recRepo: Repository<AllocationRecommendation>,
    private readonly dataSource: DataSource,
  ) {}

  // ══════════════════════════════════════════════════════════════════
  // CREATE RUN — fire-and-forget async (202 immediately)
  // ══════════════════════════════════════════════════════════════════

  async createAllocationRun(dto: CreateAllocationRunDto) {
    // 1. Validate plan_run COMPLETED
    const planRuns: { status: string; supply_snapshot_id: string }[] = await this.dataSource.query(
      `SELECT status, supply_snapshot_id FROM plan_run WHERE id = $1::bigint`,
      [dto.planRunId],
    );
    if (!planRuns[0]) throw new NotFoundException(`plan_run ${dto.planRunId} not found`);
    if (planRuns[0].status !== 'COMPLETED')
      throw new ConflictException(`plan_run ${dto.planRunId} status=${planRuns[0].status} — phải COMPLETED`);

    const supplySnapshotId = dto.supplySnapshotId ?? planRuns[0].supply_snapshot_id;
    if (!supplySnapshotId)
      throw new BadRequestException(`plan_run ${dto.planRunId} chưa có supply_snapshot_id`);

    // 2. Check không có run RUNNING cho plan_run này
    const running: { id: string }[] = await this.dataSource.query(
      `SELECT id FROM allocation_run WHERE plan_run_id = $1::bigint AND status = 'RUNNING' LIMIT 1`,
      [dto.planRunId],
    );
    if (running[0]) throw new ConflictException(`Allocation run #${running[0].id} đang chạy`);

    // 3. Create run record
    const run = this.runRepo.create({
      planRunId: dto.planRunId,
      status: 'RUNNING',
      createdBy: dto.createdBy ?? null,
      configSnapshot: {
        ...UNIS_ALLOCATION_CONFIG,
        supplySnapshotId,
        dispatchLimit: dto.dispatchLimitOverride ?? UNIS_ALLOCATION_CONFIG.dispatchLimit,
      },
    });
    const saved = await this.runRepo.save(run);

    // 4. Fire-and-forget
    this.runEngine(saved.id, dto.planRunId, supplySnapshotId, dto.dispatchLimitOverride)
      .catch((err) => {
        console.error(`[AllocationRun ${saved.id}] FAILED:`, err.message);
        this.runRepo.update(saved.id, {
          status: 'FAILED',
          errorMessage: err.message,
          completedAt: new Date(),
        });
      });

    return { runId: saved.id, status: 'RUNNING', supplySnapshotId };
  }

  // ══════════════════════════════════════════════════════════════════
  // CORE ENGINE
  // ══════════════════════════════════════════════════════════════════

  private async runEngine(
    runId: string,
    planRunId: string,
    supplySnapshotId: string,
    dispatchLimitOverride?: number,
  ): Promise<void> {
    const dispatchLimit = dispatchLimitOverride ?? UNIS_ALLOCATION_CONFIG.dispatchLimit;

    // A. Load demand lines (week_number=1)
    const demands = await this.loadDemandLines(planRunId);
    await this.runRepo.update(runId, { totalDemandLines: demands.length });

    if (demands.length === 0) {
      await this.runRepo.update(runId, {
        status: 'COMPLETED', completedAt: new Date(),
        totalAllocated: 0, totalPartial: 0, totalUnallocated: 0, fillRateOverall: 1,
      });
      return;
    }

    // B. Pre-load maps (zero N+1 trong allocation loop)
    const rtmMap    = await this.loadRtmMap();
    const lotMap    = await this.loadLotMap();    // lot_attribute ALLOCATABLE
    const ssMap     = await this.loadSsMap(demands);

    // C. Dispatch usage tracker (warning-only)
    const dispatchUsage = new Map<string, number>();

    // D. 6-layer allocation per demand line
    const decisions: AllocationDecision[] = demands.map((d) =>
      this.allocateSingle(d, rtmMap, lotMap, ssMap, dispatchUsage, dispatchLimit),
    );

    // E. Bulk save results
    await this.bulkInsertResults(runId, decisions);

    // F. Layer 6 LCNB — scan partials for lateral transfer opportunities
    const partials = decisions.filter((d) => d.qtyAllocated < d.qtyRequired);
    const recs = this.detectLcnb(runId, partials, lotMap, ssMap);
    if (recs.length > 0) await this.bulkInsertRecommendations(runId, recs);

    // G. Finalize run stats
    const totalAllocated = decisions.filter((d) => d.qtyAllocated >= d.qtyRequired).length;
    const totalPartial   = decisions.filter((d) => d.qtyAllocated > 0 && d.qtyAllocated < d.qtyRequired).length;
    const totalUnalloc   = decisions.filter((d) => d.qtyAllocated === 0).length;
    const totalReqQty    = decisions.reduce((s, d) => s + d.qtyRequired, 0);
    const totalAllocQty  = decisions.reduce((s, d) => s + d.qtyAllocated, 0);
    const fillOverall    = totalReqQty > 0 ? totalAllocQty / totalReqQty : 1;
    const fillByClass    = this.computeFillByClass(decisions);

    const runStatus = totalUnalloc === 0 && totalPartial === 0 ? 'COMPLETED'
      : totalAllocated === 0 && totalPartial === 0 ? 'FAILED'
      : 'PARTIAL';

    await this.runRepo.update(runId, {
      status: runStatus,
      totalAllocated, totalPartial, totalUnallocated: totalUnalloc,
      fillRateOverall: Math.round(fillOverall * 10000) / 10000,
      fillRateA: fillByClass.A, fillRateB: fillByClass.B, fillRateC: fillByClass.C,
      completedAt: new Date(),
    });
  }

  // ── 6-Layer allocation cho 1 demand line ──────────────────────────

  private allocateSingle(
    demand: DemandLine,
    rtmMap: Map<string, RtmRule[]>,
    supplyMap: Map<string, { qty: number }>,
    ssMap: Map<string, number>,
    dispatchUsage: Map<string, number>,
    dispatchLimit: number,
  ): AllocationDecision {
    const layerTrace: Record<string, unknown> = {};
    let remaining = demand.qtyRequired;
    let totalAllocated = 0;
    let bestSource = '';
    let bestPriority = 1;

    // L1: RTM Source Selection
    // rtm_rule: branch_code (dest) → warehouse_code (source, đã seed = branch_code thực)
    const rules = (rtmMap.get(demand.destLocationCode) ?? []).sort((a, b) => a.priority - b.priority);
    layerTrace['L1_rtm'] = rules.map((r) => `${r.sourceLocationCode}(P${r.priority})`);

    if (rules.length === 0) {
      layerTrace['L1_result'] = 'NO_RTM_RULE';
      return this.buildUnallocated(demand, layerTrace);
    }

    // L2: Quality — SKIP variant (no specs_id), lot_attribute đã filter ALLOCATABLE ở loadLotMap
    layerTrace['L2_quality'] = 'ALLOCATABLE_only — variant SKIPPED Phase1';

    // L3: FEFO — DISABLED
    layerTrace['L3_fefo'] = 'DISABLED';

    // L4: ABC note
    layerTrace['L4_abc'] = `class=${demand.abcClass} weight=${UNIS_ALLOCATION_CONFIG.abcWeights[demand.abcClass] ?? 1.0} mode=FCFS`;

    // L1 waterfall + L5 SS Guard
    for (const rule of rules) {
      if (remaining <= 0) break;

      const key = `${demand.itemCode}||${rule.sourceLocationCode}`;
      const supply = supplyMap.get(key);
      if (!supply || supply.qty <= 0) {
        layerTrace[`P${rule.priority}_${rule.sourceLocationCode}`] = 'NO_STOCK';
        continue;
      }

      // L5: SS Guard
      const ss = ssMap.get(key) ?? 0;
      const available = Math.max(0, supply.qty - ss);
      if (available <= 0) {
        layerTrace[`P${rule.priority}_${rule.sourceLocationCode}`] = `SS_BLOCKED(ss=${ss},stock=${supply.qty})`;
        continue;
      }

      // Dispatch warning (không block)
      const dispatched = dispatchUsage.get(rule.sourceLocationCode) ?? 0;
      if (dispatched >= dispatchLimit) {
        layerTrace[`P${rule.priority}_dispatch_warn`] = `${dispatched}>=${dispatchLimit}`;
      }

      const take = Math.min(remaining, available);
      supply.qty -= take;              // mutate in-memory
      remaining  -= take;
      totalAllocated += take;
      dispatchUsage.set(rule.sourceLocationCode, dispatched + take);

      layerTrace[`P${rule.priority}_${rule.sourceLocationCode}`] = `alloc=${take} ss=${ss} rem=${remaining}`;

      if (!bestSource) {
        bestSource   = rule.sourceLocationCode;
        bestPriority = rule.priority;
      }
    }

    const status = totalAllocated >= demand.qtyRequired ? 'ALLOCATED'
      : totalAllocated > 0 ? 'PARTIAL' : 'UNALLOCATED';
    layerTrace['final'] = { status, totalAllocated, remaining };

    return {
      porId: demand.porId,
      itemCode: demand.itemCode,
      sourceLocationCode: bestSource || (rules[0]?.sourceLocationCode ?? ''),
      destLocationCode: demand.destLocationCode,
      lotNumber: 'LOT_ATTR',
      qtyRequired: demand.qtyRequired,
      qtyAllocated: totalAllocated,
      abcClass: demand.abcClass,
      sourcePriority: bestPriority,
      weekNumber: demand.weekNumber,
      layerTrace,
    };
  }

  private buildUnallocated(demand: DemandLine, layerTrace: Record<string, unknown>): AllocationDecision {
    layerTrace['final'] = { status: 'UNALLOCATED', totalAllocated: 0 };
    return {
      porId: demand.porId, itemCode: demand.itemCode,
      sourceLocationCode: '', destLocationCode: demand.destLocationCode,
      lotNumber: '', qtyRequired: demand.qtyRequired, qtyAllocated: 0,
      abcClass: demand.abcClass, sourcePriority: 0,
      weekNumber: demand.weekNumber, layerTrace,
    };
  }

  // ── L6 LCNB Detect ────────────────────────────────────────────────

  private detectLcnb(
    runId: string,
    partials: AllocationDecision[],
    supplyMap: Map<string, { qty: number }>,
    ssMap: Map<string, number>,
  ): Omit<AllocationRecommendation, 'id' | 'createdAt'>[] {
    const recs: Omit<AllocationRecommendation, 'id' | 'createdAt'>[] = [];

    for (const demand of partials) {
      const shortfall = demand.qtyRequired - demand.qtyAllocated;
      if (shortfall <= 0) continue;

      for (const [key, supply] of supplyMap.entries()) {
        const [kItem, kLoc] = key.split('||');
        if (kItem !== demand.itemCode) continue;
        if (kLoc === demand.destLocationCode) continue;
        if (supply.qty <= 0) continue;

        const ss = ssMap.get(key) ?? 0;
        const surplus = supply.qty - ss;
        if (surplus >= UNIS_ALLOCATION_CONFIG.lcnbSurplusThreshold) {
          recs.push({
            allocationRunId: runId, type: 'LCNB_LATERAL_TRANSFER',
            fromLocationCode: kLoc, toLocationCode: demand.destLocationCode,
            itemCode: demand.itemCode,
            suggestedQty: Math.min(surplus, shortfall),
            status: 'PENDING', decidedBy: null, decidedAt: null,
            note: `surplus=${surplus.toFixed(0)} ss=${ss}`,
          } as any);
          break; // 1 rec per shortfall line
        }
      }
    }
    return recs;
  }

  // ══════════════════════════════════════════════════════════════════
  // DATA LOADERS — pre-load pattern, zero N+1
  // ══════════════════════════════════════════════════════════════════

  private async loadDemandLines(planRunId: string): Promise<DemandLine[]> {
    const rows: { id: string; item_code: string; location_code: string; planned_order_qty: string; week_number: number }[] =
      await this.dataSource.query(
        `SELECT id, item_code, location_code, planned_order_qty, week_number
         FROM planned_order_release
         WHERE plan_run_id = $1::bigint
           AND week_number = ANY($2)
           AND planned_order_qty > 0
           AND status IN ('AUTO_RELEASE', 'RELEASED')
         ORDER BY item_code, location_code`,
        [planRunId, UNIS_ALLOCATION_CONFIG.allocateWeekNumbers],
      );

    // ABC: item-level, DISTINCT ON effective_date DESC
    const itemCodes = [...new Set(rows.map((r) => r.item_code))];
    const abcRows: { item_code: string; abc_class: string }[] = itemCodes.length > 0
      ? await this.dataSource.query(
          `SELECT DISTINCT ON (item_code) item_code, abc_class
           FROM item_abc_classification
           WHERE item_code = ANY($1)
           ORDER BY item_code, effective_date DESC`,
          [itemCodes],
        )
      : [];

    const abcMap = new Map(abcRows.map((r) => [r.item_code, r.abc_class as 'A' | 'B' | 'C']));

    return rows.map((r) => ({
      porId: r.id,
      itemCode: r.item_code,
      destLocationCode: r.location_code,
      qtyRequired: parseFloat(r.planned_order_qty),
      weekNumber: r.week_number,
      abcClass: abcMap.get(r.item_code) ?? 'C',  // default C nếu chưa classify
    }));
  }

  private async loadRtmMap(): Promise<Map<string, RtmRule[]>> {
    // rtm_rule.warehouse_code phải đã được DA seed = branch_code thực
    const rows: { branch_code: string; warehouse_code: string; priority: number }[] =
      await this.dataSource.query(
        `SELECT branch_code, warehouse_code, priority
         FROM rtm_rule
         WHERE is_active = true
         ORDER BY branch_code, priority ASC`,
      );

    const map = new Map<string, RtmRule[]>();
    for (const r of rows) {
      const list = map.get(r.branch_code) ?? [];
      list.push({ sourceLocationCode: r.warehouse_code, priority: r.priority });
      map.set(r.branch_code, list);
    }
    return map;
  }

  private async loadLotMap(): Promise<Map<string, { qty: number }>> {
    // Load từ lot_attribute (live data) — aggregate per item × location
    const rows: { item_code: string; location_code: string; allocatable_qty: string }[] =
      await this.dataSource.query(
        `SELECT item_code, location_code,
                GREATEST(0, SUM(on_hand_qty) - SUM(reserved_qty))::text AS allocatable_qty
         FROM lot_attribute
         WHERE quality_status = 'ALLOCATABLE'
         GROUP BY item_code, location_code
         HAVING GREATEST(0, SUM(on_hand_qty) - SUM(reserved_qty)) > 0`,
      );

    const map = new Map<string, { qty: number }>();
    for (const r of rows) {
      map.set(`${r.item_code}||${r.location_code}`, { qty: parseFloat(r.allocatable_qty) });
    }
    return map;
  }

  private async loadSsMap(demands: DemandLine[]): Promise<Map<string, number>> {
    const itemCodes = [...new Set(demands.map((d) => d.itemCode))];
    if (itemCodes.length === 0) return new Map();

    const rows: { item_code: string; location_code: string; ss_final: string; override_ss: string | null }[] =
      await this.dataSource.query(
        `SELECT sst.item_code, sst.location_code, sst.ss_final, sst.override_ss
         FROM safety_stock_target sst
         INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
         WHERE pr.status = 'ACTIVE'
           AND sst.item_code = ANY($1)`,
        [itemCodes],
      );

    const map = new Map<string, number>();
    for (const r of rows) {
      const ss = r.override_ss !== null ? parseFloat(r.override_ss) : parseFloat(r.ss_final);
      map.set(`${r.item_code}||${r.location_code}`, ss);
    }
    return map;
  }

  // ══════════════════════════════════════════════════════════════════
  // BULK INSERT HELPERS
  // ══════════════════════════════════════════════════════════════════

  private async bulkInsertResults(runId: string, decisions: AllocationDecision[]): Promise<void> {
    if (decisions.length === 0) return;
    const CHUNK = UNIS_ALLOCATION_CONFIG.insertChunkSize;

    for (let i = 0; i < decisions.length; i += CHUNK) {
      const chunk = decisions.slice(i, i + CHUNK);
      const ph: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      for (const d of chunk) {
        const fillRate = d.qtyRequired > 0 ? d.qtyAllocated / d.qtyRequired : 0;
        const status = d.qtyAllocated >= d.qtyRequired ? 'ALLOCATED'
          : d.qtyAllocated > 0 ? 'PARTIAL' : 'UNALLOCATED';

        ph.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
        params.push(
          runId, d.porId, d.itemCode,
          d.sourceLocationCode, d.destLocationCode, d.lotNumber,
          d.qtyRequired, d.qtyAllocated,
          Math.round(fillRate * 10000) / 10000,
          d.abcClass, d.sourcePriority, status,
          JSON.stringify(d.layerTrace), d.weekNumber,
        );
      }

      await this.dataSource.query(
        `INSERT INTO allocation_result
           (allocation_run_id, planned_order_release_id, item_code,
            source_location_code, dest_location_code, lot_number,
            qty_required, qty_allocated, fill_rate,
            abc_class, source_priority, status, layer_trace, week_number)
         VALUES ${ph.join(', ')}`,
        params,
      );
    }
  }

  private async bulkInsertRecommendations(
    runId: string,
    recs: Omit<AllocationRecommendation, 'id' | 'createdAt'>[],
  ): Promise<void> {
    if (recs.length === 0) return;
    const ph = recs.map((_, i) => {
      const b = i * 6;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6})`;
    });
    const params = recs.flatMap((r) => [
      runId, r.fromLocationCode, r.toLocationCode,
      r.itemCode, r.suggestedQty, 'PENDING',
    ]);
    await this.dataSource.query(
      `INSERT INTO allocation_recommendation
         (allocation_run_id, from_location_code, to_location_code, item_code, suggested_qty, status)
       VALUES ${ph.join(', ')}`,
      params,
    );
  }

  // ══════════════════════════════════════════════════════════════════
  // READ METHODS
  // ══════════════════════════════════════════════════════════════════

  async listRuns(planRunId?: string) {
    const qb = this.runRepo.createQueryBuilder('r').orderBy('r.created_at', 'DESC').take(20);
    if (planRunId) qb.where('r.plan_run_id = :planRunId', { planRunId });
    return qb.getMany();
  }

  async getRun(runId: string) {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException(`allocation_run ${runId} not found`);
    return run;
  }

  async getResults(runId: string, query: GetAllocationResultsQueryDto) {
    const { page = 1, pageSize = 50 } = query;
    const qb = this.resultRepo.createQueryBuilder('ar').where('ar.allocation_run_id = :runId', { runId });

    if (query.itemCode)           qb.andWhere('ar.item_code ILIKE :ic', { ic: `%${query.itemCode}%` });
    if (query.destLocationCode)   qb.andWhere('ar.dest_location_code ILIKE :dlc', { dlc: `%${query.destLocationCode}%` });
    if (query.sourceLocationCode) qb.andWhere('ar.source_location_code ILIKE :slc', { slc: `%${query.sourceLocationCode}%` });
    if (query.status)             qb.andWhere('ar.status = :status', { status: query.status });
    if (query.abcClass)           qb.andWhere('ar.abc_class = :abc', { abc: query.abcClass });

    // PARTIAL/UNALLOCATED lên đầu (fill_rate thấp trước)
    qb.orderBy('ar.fill_rate', 'ASC').addOrderBy('ar.qty_required', 'DESC');
    qb.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getResultsSummary(runId: string) {
    const run = await this.getRun(runId);
    const byClass: { abc_class: string; total: string; allocated: string; required: string }[] =
      await this.dataSource.query(
        `SELECT abc_class, COUNT(*) AS total,
                SUM(qty_allocated) AS allocated, SUM(qty_required) AS required
         FROM allocation_result
         WHERE allocation_run_id = $1::bigint
         GROUP BY abc_class ORDER BY abc_class`,
        [runId],
      );
    const sourceBreakdown: { source_location_code: string; total_allocated: string; lines: string }[] =
      await this.dataSource.query(
        `SELECT source_location_code, SUM(qty_allocated) AS total_allocated, COUNT(*) AS lines
         FROM allocation_result
         WHERE allocation_run_id = $1::bigint AND status != 'UNALLOCATED'
         GROUP BY source_location_code ORDER BY SUM(qty_allocated) DESC`,
        [runId],
      );
    return {
      run,
      byClass: byClass.map((r) => ({
        abcClass: r.abc_class,
        total: parseInt(r.total),
        fillRate: parseFloat(r.required) > 0
          ? Math.round((parseFloat(r.allocated) / parseFloat(r.required)) * 10000) / 10000 : 1,
        totalAllocated: parseFloat(r.allocated),
        totalRequired: parseFloat(r.required),
      })),
      sourceBreakdown: sourceBreakdown.map((r) => ({
        sourceLocationCode: r.source_location_code,
        totalAllocated: parseFloat(r.total_allocated),
        lines: parseInt(r.lines),
      })),
    };
  }

  async getRecommendations(runId: string, query: GetRecommendationsQueryDto) {
    const { page = 1, pageSize = 50 } = query;
    const qb = this.recRepo.createQueryBuilder('rec').where('rec.allocation_run_id = :runId', { runId });
    if (query.status) qb.andWhere('rec.status = :status', { status: query.status });
    qb.orderBy('rec.suggested_qty', 'DESC').skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async decideRecommendation(recId: string, dto: DecideRecommendationDto) {
    const rec = await this.recRepo.findOne({ where: { id: recId } });
    if (!rec) throw new NotFoundException(`recommendation ${recId} not found`);
    if (rec.status !== 'PENDING')
      throw new ConflictException(`recommendation ${recId} already decided: ${rec.status}`);
    rec.status = dto.decision;
    rec.decidedBy = dto.decidedBy ?? null;
    rec.decidedAt = new Date();
    rec.note = dto.note ?? null;
    if (dto.adjustedQty !== undefined) rec.suggestedQty = dto.adjustedQty;
    return this.recRepo.save(rec);
  }

  // ══════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════

  private computeFillByClass(decisions: AllocationDecision[]) {
    const compute = (cls: 'A' | 'B' | 'C') => {
      const subset = decisions.filter((d) => d.abcClass === cls);
      if (subset.length === 0) return null;
      const req   = subset.reduce((s, d) => s + d.qtyRequired, 0);
      const alloc = subset.reduce((s, d) => s + d.qtyAllocated, 0);
      return req > 0 ? Math.round((alloc / req) * 10000) / 10000 : 1;
    };
    return { A: compute('A'), B: compute('B'), C: compute('C') };
  }
}
```

---

## 7. Controller

### `src/allocation/allocation.controller.ts`

```typescript
import { Controller, Post, Get, Patch, Param, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { AllocationService } from './allocation.service';
import {
  CreateAllocationRunDto, GetAllocationResultsQueryDto,
  GetRecommendationsQueryDto, DecideRecommendationDto, RetryAllocationDto,
} from './dto';

@ApiTags('Allocation – Module 5')
@Controller('allocation')
export class AllocationController {
  constructor(private readonly svc: AllocationService) {}

  // POST /allocation/run — trigger async run (202)
  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Trigger allocation run async cho 1 plan_run' })
  createRun(@Body() dto: CreateAllocationRunDto) {
    return this.svc.createAllocationRun(dto);
  }

  // GET /allocation/runs
  @Get('runs')
  @ApiOperation({ summary: 'Danh sách allocation runs' })
  listRuns(@Query('planRunId') planRunId?: string) {
    return this.svc.listRuns(planRunId);
  }

  // GET /allocation/runs/:id
  @Get('runs/:id')
  @ApiOperation({ summary: 'Chi tiết 1 allocation run (dùng để poll status)' })
  getRun(@Param('id') id: string) {
    return this.svc.getRun(id);
  }

  // GET /allocation/runs/:id/results
  @Get('runs/:id/results')
  @ApiOperation({ summary: 'Danh sách allocation results với filter + phân trang' })
  getResults(@Param('id') id: string, @Query() query: GetAllocationResultsQueryDto) {
    return this.svc.getResults(id, query);
  }

  // GET /allocation/runs/:id/summary
  @Get('runs/:id/summary')
  @ApiOperation({ summary: 'Summary: fill rate by ABC class + source breakdown' })
  getSummary(@Param('id') id: string) {
    return this.svc.getResultsSummary(id);
  }

  // GET /allocation/runs/:id/recommendations
  @Get('runs/:id/recommendations')
  @ApiOperation({ summary: 'LCNB recommendations (PENDING trước)' })
  getRecommendations(@Param('id') id: string, @Query() query: GetRecommendationsQueryDto) {
    return this.svc.getRecommendations(id, query);
  }

  // PATCH /allocation/recommendations/:id/decide
  @Patch('recommendations/:id/decide')
  @ApiOperation({ summary: 'Accept/Reject LCNB recommendation' })
  decideRec(@Param('id') id: string, @Body() dto: DecideRecommendationDto) {
    return this.svc.decideRecommendation(id, dto);
  }
}
```

---

## 8. Module

### `src/allocation/allocation.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AllocationController } from './allocation.controller';
import { AllocationService } from './allocation.service';
import { AllocationRun } from './entities/allocation-run.entity';
import { AllocationResult } from './entities/allocation-result.entity';
import { AllocationRecommendation } from './entities/allocation-recommendation.entity';
import { PolicyModule } from '../policy/policy.module';  // ← bắt buộc

@Module({
  imports: [
    TypeOrmModule.forFeature([AllocationRun, AllocationResult, AllocationRecommendation]),
    PolicyModule,
  ],
  controllers: [AllocationController],
  providers: [AllocationService],
  exports: [AllocationService],
})
export class AllocationModule {}
```

### Thêm vào `src/app.module.ts`

```typescript
import { AllocationModule } from './allocation/allocation.module';
// ... trong imports array:
AllocationModule,
```

---

## 9. API Endpoints Summary

| Method | Path | Mô tả | Response |
|--------|------|--------|----------|
| POST | `/api/v1/allocation/run` | Trigger run async | 202 `{ runId, status: 'RUNNING' }` |
| GET | `/api/v1/allocation/runs` | List runs (filter planRunId) | `AllocationRun[]` |
| GET | `/api/v1/allocation/runs/:id` | Poll run status | `AllocationRun` |
| GET | `/api/v1/allocation/runs/:id/results` | Results paginated + filter | `Paginated<AllocationResult>` |
| GET | `/api/v1/allocation/runs/:id/summary` | Fill rate by class + source | Summary object |
| GET | `/api/v1/allocation/runs/:id/recommendations` | LCNB recs | `Paginated<Recommendation>` |
| PATCH | `/api/v1/allocation/recommendations/:id/decide` | Accept/Reject rec | `AllocationRecommendation` |

---

## 10. Frontend

### `frontend/app/allocation/page.tsx` — 4 tabs

```
Tab 1: Runs
  - Danh sách allocation runs
  - Nút "Run Allocation" → chọn plan_run (COMPLETED) → POST /allocation/run
  - Auto-poll 3s khi RUNNING, dừng khi COMPLETED/PARTIAL/FAILED
  - Cards: status badge, fill rate overall, total demand lines, completed/partial/unalloc

Tab 2: Results
  - Bảng allocation results (filter: item, dest, source, status, ABC)
  - Highlight row: UNALLOCATED = đỏ, PARTIAL = vàng, ALLOCATED = xanh
  - Cột layer_trace: click expand → xem từng layer đã làm gì

Tab 3: Exceptions (PARTIAL + UNALLOCATED)
  - Chỉ hiện rows status != ALLOCATED
  - Sort: fill_rate ASC (vấn đề nhất lên đầu)
  - Hiển thị lý do từ layer_trace: NO_RTM_RULE / NO_STOCK / SS_BLOCKED

Tab 4: LCNB Recommendations
  - Danh sách recs PENDING
  - Mỗi rec: from → to, item, suggested_qty, note (surplus/ss)
  - Action: Accept / Reject / Adjust qty → PATCH /recommendations/:id/decide
```

### `frontend/lib/api/allocation.ts` — types + API calls

Tương tự `lib/api/drp.ts` — mirror các types từ entities + 7 API functions.

---

## 11. DA Tasks (phải làm TRƯỚC khi BE deploy)

| Task | SQL | Priority |
|------|-----|----------|
| **[CRITICAL] Seed rtm_rule.warehouse_code** | Update warehouse_code = branch_code thực (location trong lot_attribute) | 🔴 P0 — block toàn bộ allocation |
| Chạy migration 3 bảng mới | Run `001_create_allocation_tables.sql` | 🔴 P0 |
| Fix 626 MISSING_SS | Chạy lại policy_run covering đủ 8,109 combos | ⚠️ P1 — ảnh hưởng SS guard accuracy |

### Seed rtm_rule hướng dẫn

Hiện tại 133 rtm_rules đều có warehouse_code = 'HUBR00001'...'HUBR00020'.
Những codes này không tồn tại trong lot_attribute → allocation sẽ ra UNALLOCATED 100%.

DA cần xác định: kho nguồn thực tế của mỗi branch là branch nào?
- Ví dụ: Branch 008 lấy hàng từ branch 001 (hub HCM) → `UPDATE rtm_rule SET warehouse_code='001' WHERE branch_code='008' AND warehouse_code='HUBR00001'`
- Hoặc DA insert rtm_rule mới với đúng warehouse_code, set is_active=false cho HUBR rows cũ

---

## 12. Task Breakdown & Tiến độ

### Sprint 3 — L1·L2·L3 (AC đã xác nhận)

| ID | Owner | Mô tả | Status |
|----|-------|-------|--------|
| DA-5-1 | DA | Migration 2 bảng (allocation_run, allocation_result) | ✅ DONE |
| DA-5-2 | DA | Seed rtm_rule.warehouse_code = branch_code thực (Option C) | ✅ DONE |
| DA-5-3 | DA | Chạy lại policy_run (fix 626 MISSING_SS) | ✅ DONE |
| BE-5-1 | BE | Entities (AllocationRun, AllocationResult) + migration SQL | ✅ DONE |
| BE-5-2 | BE | AllocationService: L1 RTM + L2 Quality + L3 FEFO pass-through, async engine | ✅ DONE |
| BE-5-3 | BE | AllocationController (4 endpoints) + Module + app.module.ts | ✅ DONE |
| FE-5-1 | FE | `lib/api/allocation.ts` types + API functions | ✅ DONE |
| FE-5-2 | FE | `app/allocation/page.tsx`: Run trigger, polling, Results table, Exceptions view | ✅ DONE |

**Sprint 3 E2E kết quả (run #1):**
- 203 demand lines (week=1, AUTO_RELEASE) processed trong 631ms
- ALLOCATED: 167 (82.3%) · PARTIAL: 36 (17.7%, INSUFFICIENT_STOCK) · UNALLOCATED: 0
- Option C RTM hoạt động đúng: source_location = branch_code thực

---

### Sprint 4+ — L4·L5·L6 (Deferred)

| ID | Owner | Mô tả | Status |
|----|-------|-------|--------|
| DA-5-4 | DA | Migration bảng allocation_recommendation | ⏳ Sprint 4 |
| BE-5-4 | BE | L4: ABC Fair-Share (shortage detection + weighted allocation) | ⏳ Sprint 4 |
| BE-5-5 | BE | L5: Safety Stock Guard (post-alloc ≥ SS target) | ⏳ Sprint 4 |
| BE-5-6 | BE | L6: LCNB Detect (AllocationRecommendation entity + 3 endpoints) | ⏳ Sprint 4 |
| BE-5-7 | BE | allocation-config.ts (extract hardcoded constants) | ⏳ Nice-to-have |
| FE-5-3 | FE | Tab LCNB Recommendations + Accept/Reject flow | ⏳ Sprint 4 |

---

*Module 5 Allocation Engine — Implementation Guide v1.1 | 2026-04-14*
*Verified against actual DB schema: rtm_rule(133 rows), lot_attribute(100,312 ALLOCATABLE), planned_order_release(7,906 week=1 releasable), item_abc_classification(1,571 rows)*
