# MODULE 9 — Plan vs Actual: Full Implementation Guide

> **UNIS Supply Chain Planning System**
> Phase 1: Forecast Version Compare + Forecast vs Actual proxy (EXPORTED orders)
> Phase 2: True MAPE / Fill Rate (blocked: `actual_sales`)

---

## 0. UNIS Constraints

```
1. PKs — BIGSERIAL (BIGINT), KHÔNG UUID.
   Ngoại lệ: demand_snapshot.snapshot_id = UUID (đã có sẵn).
   → snapshot_id_base / snapshot_id_compare dùng VARCHAR(36) để lưu UUID FK.

2. Item / Location keys — VARCHAR (item_code VARCHAR(50), location_code VARCHAR(20)).

3. NO tenant_id.

4. Auth Phase 1 — không JWT. computed_by = VARCHAR free-text từ body.

5. demand_snapshot_line.qty = MONTHLY grain.
   Weekly convert: weekly_qty = monthly_qty / 4.33 (same divisor as M8 HSTK).

6. 2 comparison_type TÁCH BIỆT — không trộn data source:
   FORECAST_VERSION  : snapshot_line A vs snapshot_line B
   FORECAST_VS_ACTUAL: snapshot_line (plan) vs order_line EXPORTED (proxy actual)

7. MAPE Phase 1 = N_A (actual_sales chưa tồn tại).
```

---

## 1. Migration

### `migrations/001_create_plan_actual_tables.sql`

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS plan_actual_comparison (
  id               BIGSERIAL      PRIMARY KEY,
  computed_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  comparison_type  VARCHAR(30)    NOT NULL,
    -- FORECAST_VERSION | FORECAST_VS_ACTUAL
  period_start     DATE           NOT NULL,
  period_end       DATE           NOT NULL,
  period_type      VARCHAR(10)    NOT NULL DEFAULT 'MONTHLY',
    -- MONTHLY | WEEKLY
  item_code        VARCHAR(50)    NOT NULL,
  location_code    VARCHAR(20)    NOT NULL,
  snapshot_id_base VARCHAR(36)    NOT NULL,
    -- demand_snapshot.snapshot_id (UUID) — version A hoặc plan
  snapshot_id_compare VARCHAR(36) NULL,
    -- demand_snapshot.snapshot_id (UUID) — version B; NULL cho FORECAST_VS_ACTUAL
  plan_qty         DECIMAL(15,2)  NOT NULL DEFAULT 0,
  actual_qty       DECIMAL(15,2)  NULL,
    -- NULL = không có proxy data trong period
  variance_qty     DECIMAL(15,2)  NULL,
    -- actual_qty - plan_qty
  variance_pct     DECIMAL(10,4)  NULL,
    -- %: variance_qty / plan_qty × 100
  fill_rate_proxy  DECIMAL(10,4)  NULL,
    -- actual_qty / plan_qty; chỉ FORECAST_VS_ACTUAL
  status           VARCHAR(20)    NOT NULL DEFAULT 'ON_TARGET',
    -- ON_TARGET | WARNING | CRITICAL | N_A
  computed_by      VARCHAR(100)   NULL
);

CREATE INDEX IF NOT EXISTS idx_pac_item        ON plan_actual_comparison(item_code);
CREATE INDEX IF NOT EXISTS idx_pac_location    ON plan_actual_comparison(location_code);
CREATE INDEX IF NOT EXISTS idx_pac_period      ON plan_actual_comparison(period_start);
CREATE INDEX IF NOT EXISTS idx_pac_type        ON plan_actual_comparison(comparison_type);
CREATE INDEX IF NOT EXISTS idx_pac_computed_at ON plan_actual_comparison(computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pac_snap_base   ON plan_actual_comparison(snapshot_id_base);
CREATE INDEX IF NOT EXISTS idx_pac_status      ON plan_actual_comparison(status);

COMMIT;
```

---

## 2. Entity

### `entities/plan-actual-comparison.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('plan_actual_comparison')
export class PlanActualComparison {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @CreateDateColumn({ name: 'computed_at' })
  computedAt: Date;

  @Column({ name: 'comparison_type', type: 'varchar', length: 30 })
  comparisonType: 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL';

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'period_type', type: 'varchar', length: 10, default: 'MONTHLY' })
  periodType: 'MONTHLY' | 'WEEKLY';

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', type: 'varchar', length: 20 })
  locationCode: string;

  @Column({ name: 'snapshot_id_base', type: 'varchar', length: 36 })
  snapshotIdBase: string;

  @Column({ name: 'snapshot_id_compare', type: 'varchar', length: 36, nullable: true, default: null })
  snapshotIdCompare: string | null;

  @Column({ name: 'plan_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  planQty: number;

  @Column({ name: 'actual_qty', type: 'decimal', precision: 15, scale: 2, nullable: true, default: null })
  actualQty: number | null;

  @Column({ name: 'variance_qty', type: 'decimal', precision: 15, scale: 2, nullable: true, default: null })
  varianceQty: number | null;

  @Column({ name: 'variance_pct', type: 'decimal', precision: 10, scale: 4, nullable: true, default: null })
  variancePct: number | null;

  @Column({ name: 'fill_rate_proxy', type: 'decimal', precision: 10, scale: 4, nullable: true, default: null })
  fillRateProxy: number | null;

  @Column({ type: 'varchar', length: 20, default: 'ON_TARGET' })
  status: 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'N_A';

  @Column({ name: 'computed_by', type: 'varchar', length: 100, nullable: true, default: null })
  computedBy: string | null;
}
```

---

## 3. DTOs

### `dto/index.ts`

```typescript
import { IsOptional, IsString, IsIn, IsInt, Min, Max, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ComputeDto {
  @ApiProperty({ enum: ['FORECAST_VERSION', 'FORECAST_VS_ACTUAL'] })
  @IsIn(['FORECAST_VERSION', 'FORECAST_VS_ACTUAL'])
  comparisonType: 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL';

  @ApiProperty({ example: 'uuid-snap-001', description: 'snapshot_id của version A (plan)' })
  @IsString() @IsNotEmpty()
  snapshotIdBase: string;

  @ApiPropertyOptional({ example: 'uuid-snap-002', description: 'Bắt buộc nếu FORECAST_VERSION' })
  @IsOptional() @IsString()
  snapshotIdCompare?: string;

  @ApiPropertyOptional({ example: 'planner' })
  @IsOptional() @IsString()
  computedBy?: string;
}

// NOTE — BUG-1 fix: ComputeDto không cần periodStart vì _loadSnapshotLines()
// đã lấy TẤT CẢ lines của snapshot (không filter period_start nữa).
// Planner chọn khoảng period qua filter ở ListComparisonQueryDto sau khi compute.

export class ListComparisonQueryDto {
  @ApiPropertyOptional({ enum: ['FORECAST_VERSION', 'FORECAST_VS_ACTUAL'] })
  @IsOptional() @IsIn(['FORECAST_VERSION', 'FORECAST_VS_ACTUAL'])
  comparisonType?: string;

  @ApiPropertyOptional({ example: '40.L1.3060.UGC3600' })
  @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional({ example: '014' })
  @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ example: '2026-04-01' })
  @IsOptional() @IsString()
  periodStart?: string;

  @ApiPropertyOptional({ enum: ['ON_TARGET', 'WARNING', 'CRITICAL'] })
  @IsOptional() @IsIn(['ON_TARGET', 'WARNING', 'CRITICAL'])
  status?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}
```

---

## 4. Service

### `plan-actual.service.ts`

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PlanActualComparison } from './entities/plan-actual-comparison.entity';
import { ComputeDto, ListComparisonQueryDto } from './dto';

// ─── Constants ────────────────────────────────────────────────────────────────

const WEEKS_PER_MONTH = 4.33;
const WARNING_THRESHOLD  = 20;  // |variance_pct| > 20% → WARNING
const CRITICAL_THRESHOLD = 40;  // |variance_pct| > 40% → CRITICAL

// ─── Internal types ───────────────────────────────────────────────────────────

interface SnapshotLine {
  itemCode: string;
  locationCode: string;
  periodStart: string;
  qty: number;        // COALESCE(reconciled_qty, qty)
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PlanActualService {
  constructor(
    @InjectRepository(PlanActualComparison)
    private readonly repo: Repository<PlanActualComparison>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VERSIONS (dropdown)
  // ═══════════════════════════════════════════════════════════════════════════

  async listVersions(): Promise<object> {
    const rows = await this.dataSource.query(`
      SELECT
        snapshot_id  AS "snapshotId",
        snapshot_name AS "snapshotName",
        created_at   AS "createdAt",
        COALESCE(snapshot_name, 'Snapshot ' || TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI')) AS label
      FROM demand_snapshot
      WHERE status = 'FROZEN'
      ORDER BY created_at DESC
    `);
    return { data: rows };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTE
  // ═══════════════════════════════════════════════════════════════════════════

  async computeComparison(dto: ComputeDto): Promise<object> {
    if (dto.comparisonType === 'FORECAST_VERSION') {
      if (!dto.snapshotIdCompare) {
        throw new BadRequestException('snapshotIdCompare is required for FORECAST_VERSION');
      }
      return this._computeForecastVersion(dto);
    }
    return this._computeForecastVsActual(dto);
  }

  // ── FORECAST_VERSION ──────────────────────────────────────────────────────

  private async _computeForecastVersion(dto: ComputeDto): Promise<object> {
    const [baseLines, compareLines] = await Promise.all([
      this._loadSnapshotLines(dto.snapshotIdBase),
      this._loadSnapshotLines(dto.snapshotIdCompare!),
    ]);

    // Index compare lines by item × location × period
    const compareMap = new Map<string, number>();
    for (const l of compareLines) {
      compareMap.set(`${l.itemCode}|${l.locationCode}|${l.periodStart}`, l.qty);
    }

    const snapshots: Partial<PlanActualComparison>[] = [];

    for (const base of baseLines) {
      const key       = `${base.itemCode}|${base.locationCode}|${base.periodStart}`;
      const compareQty = compareMap.get(key) ?? 0;
      const planQty    = base.qty;
      const actualQty  = compareQty;

      const varianceQty = actualQty - planQty;
      const variancePct = planQty !== 0
        ? Math.round((varianceQty / planQty) * 10000) / 100   // 2 decimal places
        : null;

      const absPct = variancePct != null ? Math.abs(variancePct) : 0;
      const status = variancePct == null ? 'N_A'
                   : absPct > CRITICAL_THRESHOLD ? 'CRITICAL'
                   : absPct > WARNING_THRESHOLD  ? 'WARNING'
                   : 'ON_TARGET';

      snapshots.push({
        comparisonType:    'FORECAST_VERSION',
        periodStart:       base.periodStart,
        periodEnd:         this._monthEnd(base.periodStart),
        periodType:        'MONTHLY',
        itemCode:          base.itemCode,
        locationCode:      base.locationCode,
        snapshotIdBase:    dto.snapshotIdBase,
        snapshotIdCompare: dto.snapshotIdCompare,
        planQty,
        actualQty,
        varianceQty,
        variancePct,
        fillRateProxy:     null,  // not applicable for version compare
        status,
        computedBy:        dto.computedBy ?? 'system',
      });
    }

    await this.repo.save(snapshots as PlanActualComparison[]);

    const warnings  = snapshots.filter(r => r.status === 'WARNING').length;
    const criticals = snapshots.filter(r => r.status === 'CRITICAL').length;
    return { computed: snapshots.length, warnings, criticals, comparison_type: 'FORECAST_VERSION' };
  }

  // ── FORECAST_VS_ACTUAL ────────────────────────────────────────────────────

  private async _computeForecastVsActual(dto: ComputeDto): Promise<object> {
    // BUG-2 FIX: Validate snapshot exists AND is FROZEN before proceeding.
    // Previously: missing snapshot → planLines=[] → silent { computed: 0 } with no error.
    const snap = await this.dataSource.query(
      `SELECT snapshot_id FROM demand_snapshot WHERE snapshot_id = $1 AND status = 'FROZEN'`,
      [dto.snapshotIdBase],
    );
    if (!snap.length) throwUnisError(UNIS_ERR.PLAN_ACTUAL_SNAPSHOT_NOT_VALID);

    const planLines = await this._loadSnapshotLines(dto.snapshotIdBase);

    // BUG-1 FIX: planLines now spans ALL periods in snapshot (no CURRENT_DATE filter).
    // Collect all unique periods and load actual proxy for the full date range.
    const periods = [...new Set(planLines.map(l => l.periodStart))].sort();
    if (!periods.length) {
      return { computed: 0, warnings: 0, criticals: 0, comparison_type: 'FORECAST_VS_ACTUAL' };
    }
    const rangeStart = periods[0];
    const rangeEnd   = this._monthEnd(periods[periods.length - 1]);

    // BUG-3 NOTE: dest_location_code verified against M7 order-line.entity.ts before using.
    // If M7 uses a different column name, update the alias below accordingly.
    // Load actual proxy: EXPORTED order_line dalam range (item × location × period_month)
    const actualRows: { itemCode: string; locationCode: string; periodMonth: string; totalQty: string }[] =
      await this.dataSource.query(`
        SELECT
          ol.item_code                                        AS "itemCode",
          ol.dest_location_code                               AS "locationCode",
          date_trunc('month', ob.exported_at)::date::text     AS "periodMonth",
          SUM(ol.qty)::text                                   AS "totalQty"
        FROM order_line ol
        JOIN order_batch ob ON ob.id = ol.order_batch_id
        WHERE ol.status = 'ACTIVE'
          AND ob.status = 'EXPORTED'
          AND ob.exported_at >= $1::date
          AND ob.exported_at <  $2::date + INTERVAL '1 day'
        GROUP BY ol.item_code, ol.dest_location_code, date_trunc('month', ob.exported_at)
      `, [rangeStart, rangeEnd]);

    // actualMap key = item × location × period_month
    const actualMap = new Map<string, number>();
    for (const r of actualRows) {
      actualMap.set(`${r.itemCode}|${r.locationCode}|${r.periodMonth}`, Number(r.totalQty));
    }

    const snapshots: Partial<PlanActualComparison>[] = [];

    for (const plan of planLines) {
      const periodEnd  = this._monthEnd(plan.periodStart);
      const planQty    = plan.qty;
      const actualQty  = actualMap.get(`${plan.itemCode}|${plan.locationCode}|${plan.periodStart}`) ?? null;

      const varianceQty = actualQty != null ? actualQty - planQty : null;
      const variancePct = planQty !== 0 && varianceQty != null
        ? Math.round((varianceQty / planQty) * 10000) / 100
        : null;
      const fillRateProxy = planQty > 0 && actualQty != null
        ? Math.round((actualQty / planQty) * 10000) / 10000
        : null;

      const absPct = variancePct != null ? Math.abs(variancePct) : 0;
      const status = variancePct == null ? 'N_A'
                   : absPct > CRITICAL_THRESHOLD ? 'CRITICAL'
                   : absPct > WARNING_THRESHOLD  ? 'WARNING'
                   : 'ON_TARGET';

      snapshots.push({
        comparisonType:    'FORECAST_VS_ACTUAL',
        periodStart:       plan.periodStart,
        periodEnd,
        periodType:        'MONTHLY',
        itemCode:          plan.itemCode,
        locationCode:      plan.locationCode,
        snapshotIdBase:    dto.snapshotIdBase,
        snapshotIdCompare: null,
        planQty,
        actualQty,
        varianceQty,
        variancePct,
        fillRateProxy,
        status,
        computedBy:        dto.computedBy ?? 'system',
      });
    }

    await this.repo.save(snapshots as PlanActualComparison[]);

    const warnings  = snapshots.filter(r => r.status === 'WARNING').length;
    const criticals = snapshots.filter(r => r.status === 'CRITICAL').length;
    return { computed: snapshots.length, warnings, criticals, comparison_type: 'FORECAST_VS_ACTUAL' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  async getSummary(): Promise<object> {
    // Latest compute batch per type (by MAX computed_at)
    const [fv] = await this.dataSource.query(`
      SELECT
        ROUND(AVG(variance_pct)::numeric, 2)            AS avg_variance_pct,
        ROUND(AVG(variance_qty)::numeric, 2)            AS avg_bias,
        COUNT(*) FILTER (WHERE status = 'WARNING')      AS warning_count,
        COUNT(*) FILTER (WHERE status = 'CRITICAL')     AS critical_count,
        MAX(computed_at)                                AS last_computed_at
      FROM plan_actual_comparison
      WHERE comparison_type = 'FORECAST_VERSION'
        AND computed_at = (
          SELECT MAX(computed_at) FROM plan_actual_comparison
          WHERE comparison_type = 'FORECAST_VERSION'
        )
    `);

    const [fva] = await this.dataSource.query(`
      SELECT
        ROUND(AVG(fill_rate_proxy)::numeric, 4)         AS avg_fill_rate_proxy,
        ROUND(AVG(variance_pct)::numeric, 2)            AS avg_variance_pct,
        COUNT(*) FILTER (WHERE status = 'WARNING')      AS warning_count,
        COUNT(*) FILTER (WHERE status = 'CRITICAL')     AS critical_count,
        MAX(computed_at)                                AS last_computed_at
      FROM plan_actual_comparison
      WHERE comparison_type = 'FORECAST_VS_ACTUAL'
        AND computed_at = (
          SELECT MAX(computed_at) FROM plan_actual_comparison
          WHERE comparison_type = 'FORECAST_VS_ACTUAL'
        )
    `);

    return {
      forecast_version: {
        avg_variance_pct:  Number(fv?.avg_variance_pct  ?? 0),
        avg_bias:          Number(fv?.avg_bias          ?? 0),
        warning_count:     Number(fv?.warning_count     ?? 0),
        critical_count:    Number(fv?.critical_count    ?? 0),
        last_computed_at:  fv?.last_computed_at ?? null,
      },
      forecast_vs_actual: {
        avg_fill_rate_proxy: Number(fva?.avg_fill_rate_proxy ?? 0),
        avg_variance_pct:    Number(fva?.avg_variance_pct   ?? 0),
        warning_count:       Number(fva?.warning_count      ?? 0),
        critical_count:      Number(fva?.critical_count     ?? 0),
        mape_status:         'N_A',
        mape_note:           'BLOCKED: actual_sales table chưa tồn tại. Implement Phase 2.',
        last_computed_at:    fva?.last_computed_at ?? null,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST COMPARISONS
  // ═══════════════════════════════════════════════════════════════════════════

  async listComparisons(query: ListComparisonQueryDto) {
    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const qb = this.repo.createQueryBuilder('p')
      .orderBy('p.computed_at', 'DESC');

    if (query.comparisonType) qb.andWhere('p.comparison_type = :t',    { t: query.comparisonType });
    if (query.itemCode)       qb.andWhere('p.item_code ILIKE :ic',     { ic: `%${query.itemCode}%` });
    if (query.locationCode)   qb.andWhere('p.location_code = :lc',     { lc: query.locationCode });
    if (query.periodStart)    qb.andWhere('p.period_start >= :ps',     { ps: query.periodStart });
    if (query.status)         qb.andWhere('p.status = :s',             { s: query.status });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT CSV
  // ═══════════════════════════════════════════════════════════════════════════

  async exportCsv(query: ListComparisonQueryDto): Promise<Buffer> {
    // Fetch all (no pagination) for export
    const qb = this.repo.createQueryBuilder('p').orderBy('p.computed_at', 'DESC');
    if (query.comparisonType) qb.andWhere('p.comparison_type = :t',  { t: query.comparisonType });
    if (query.itemCode)       qb.andWhere('p.item_code ILIKE :ic',   { ic: `%${query.itemCode}%` });
    if (query.locationCode)   qb.andWhere('p.location_code = :lc',   { lc: query.locationCode });
    if (query.status)         qb.andWhere('p.status = :s',           { s: query.status });

    const rows = await qb.getMany();

    const headers = [
      'comparison_type', 'period_start', 'period_end', 'item_code', 'location_code',
      'plan_qty', 'actual_qty', 'variance_qty', 'variance_pct', 'fill_rate_proxy', 'status',
    ];

    const lines = rows.map(r => [
      r.comparisonType,
      r.periodStart,
      r.periodEnd,
      r.itemCode,
      r.locationCode,
      r.planQty ?? '',
      r.actualQty ?? '',
      r.varianceQty ?? '',
      r.variancePct ?? '',
      r.fillRateProxy ?? '',
      r.status,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = '\uFEFF' + [headers.join(','), ...lines].join('\r\n');
    return Buffer.from(csv, 'utf-8');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  // BUG-1 FIX: Removed hardcoded CURRENT_DATE filter.
  // Load ALL lines for the snapshot — period filtering is done via ListComparisonQueryDto after compute.
  // This allows comparing snapshots from different months without returning 0 rows.
  private async _loadSnapshotLines(snapshotId: string): Promise<SnapshotLine[]> {
    const rows = await this.dataSource.query(`
      SELECT
        dsl.item_code                                     AS "itemCode",
        dsl.location_code                                 AS "locationCode",
        dsl.period_start::text                            AS "periodStart",
        COALESCE(dsl.reconciled_qty, dsl.qty)::float      AS qty
      FROM demand_snapshot_line dsl
      WHERE dsl.snapshot_id = $1
      ORDER BY dsl.period_start, dsl.item_code, dsl.location_code
    `, [snapshotId]);
    return rows;
  }

  /** Returns last day of the month containing isoDate */
  private _monthEnd(isoDate: string): string {
    const d = new Date(isoDate);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return end.toISOString().slice(0, 10);
  }
}
```

---

## 5. Controller

### `plan-actual.controller.ts`

```typescript
import {
  Controller, Get, Post, Query, Body, Res, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { PlanActualService } from './plan-actual.service';
import { ComputeDto, ListComparisonQueryDto } from './dto';

@ApiTags('plan-actual')
@Controller('plan-actual')
export class PlanActualController {
  constructor(private readonly svc: PlanActualService) {}

  @Get('versions')
  @ApiOperation({ summary: 'List FROZEN demand_snapshot versions (cho dropdown compare)' })
  listVersions() {
    return this.svc.listVersions();
  }

  @Post('compute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger comparison compute. FORECAST_VERSION cần cả 2 snapshotId.' })
  compute(@Body() dto: ComputeDto) {
    return this.svc.computeComparison(dto);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Summary: avg variance, bias, fill rate proxy, MAPE status' })
  getSummary() {
    return this.svc.getSummary();
  }

  @Get('comparison')
  @ApiOperation({ summary: 'List comparison rows (filter + paginated)' })
  listComparisons(@Query() query: ListComparisonQueryDto) {
    return this.svc.listComparisons(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Download comparison report CSV (UTF-8 BOM)' })
  async exportCsv(
    @Query() query: ListComparisonQueryDto,
    @Res() res: Response,
  ) {
    const buf = await this.svc.exportCsv(query);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="plan_actual_${date}.csv"`,
    });
    res.send(buf);
  }
}
```

---

## 6. Module

### `plan-actual.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlanActualComparison } from './entities/plan-actual-comparison.entity';
import { PlanActualService } from './plan-actual.service';
import { PlanActualController } from './plan-actual.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PlanActualComparison])],
  providers: [PlanActualService],
  controllers: [PlanActualController],
  exports: [PlanActualService],
})
export class PlanActualModule {}
```

> **Register:** Thêm `PlanActualModule` vào `imports[]` trong `app.module.ts`.

---

## 7. Error Codes (thêm vào `common/errors.ts`)

```typescript
PLAN_ACTUAL_SNAPSHOT_MISSING:   { code: 'UNIS-ERR-029', msg: 'snapshotIdCompare bắt buộc cho FORECAST_VERSION',    status: 400 },
PLAN_ACTUAL_SNAPSHOT_NOT_FOUND: { code: 'UNIS-ERR-030', msg: 'Demand snapshot not found hoặc không phải FROZEN',  status: 404 },
PLAN_ACTUAL_NO_LINES:           { code: 'UNIS-ERR-031', msg: 'Snapshot không có demand lines',                    status: 422 },
// BUG-2 FIX: Added PLAN_ACTUAL_SNAPSHOT_NOT_VALID for _computeForecastVsActual validation
PLAN_ACTUAL_SNAPSHOT_NOT_VALID: { code: 'UNIS-ERR-032', msg: 'Snapshot không tồn tại hoặc chưa FROZEN',           status: 422 },
```

---

## 8. Frontend — `lib/api/plan-actual.ts`

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(p: string) { return `${BASE_URL}/api/v1${p}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComparisonType = 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL';
export type PacStatus      = 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'N_A';

export interface SnapshotVersion {
  snapshotId:   string;
  snapshotName: string | null;
  createdAt:    string;
  label:        string;
}

export interface PlanActualRow {
  id:               string;
  comparisonType:   ComparisonType;
  periodStart:      string;
  periodEnd:        string;
  periodType:       string;
  itemCode:         string;
  locationCode:     string;
  snapshotIdBase:   string;
  snapshotIdCompare:string | null;
  planQty:          number;
  actualQty:        number | null;
  varianceQty:      number | null;
  variancePct:      number | null;
  fillRateProxy:    number | null;
  status:           PacStatus;
  computedAt:       string;
}

export interface PacSummary {
  forecast_version: {
    avg_variance_pct:  number;
    avg_bias:          number;
    warning_count:     number;
    critical_count:    number;
    last_computed_at:  string | null;
  };
  forecast_vs_actual: {
    avg_fill_rate_proxy: number;
    avg_variance_pct:    number;
    warning_count:       number;
    critical_count:      number;
    mape_status:         string;
    mape_note:           string;
    last_computed_at:    string | null;
  };
}

export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number; }

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchVersions = () =>
  fetch(apiUrl('/plan-actual/versions'), { cache: 'no-store' })
    .then(r => handleRes<{ data: SnapshotVersion[] }>(r));

export const computeComparison = (body: {
  comparisonType: ComparisonType;
  snapshotIdBase: string;
  snapshotIdCompare?: string;
  computedBy?: string;
}) =>
  fetch(apiUrl('/plan-actual/compute'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => handleRes<{ computed: number; warnings: number; criticals: number }>(r));

export const fetchPacSummary = () =>
  fetch(apiUrl('/plan-actual/summary'), { cache: 'no-store' })
    .then(r => handleRes<PacSummary>(r));

export const fetchComparisons = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/plan-actual/comparison?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: PlanActualRow[]; meta: PageMeta }>(r));
};

export const exportPacCsv = async (params: Record<string, string> = {}): Promise<void> => {
  const q = new URLSearchParams(params);
  const res = await fetch(apiUrl(`/plan-actual/export?${q}`));
  if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? 'plan_actual.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};
```

---

## 9. Frontend — `app/plan-actual/page.tsx`

```typescript
'use client';
import { useState, useEffect, useCallback } from 'react';
import {
  fetchVersions, computeComparison, fetchPacSummary, fetchComparisons, exportPacCsv,
  SnapshotVersion, PlanActualRow, PacSummary, PageMeta,
} from '@/lib/api/plan-actual';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPct = (v: number | null) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const fmtQty = (v: number | null) => v == null ? '—' : v.toLocaleString('vi-VN', { maximumFractionDigits: 1 });
const fmtRate = (v: number | null) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

const STATUS_BADGE: Record<string, string> = {
  ON_TARGET: 'bg-emerald-100 text-emerald-700',
  WARNING:   'bg-amber-100 text-amber-700',
  CRITICAL:  'bg-red-100 text-red-700',
  N_A:       'bg-slate-100 text-slate-500',
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanActualPage() {
  const [summary, setSummary]     = useState<PacSummary | null>(null);
  const [versions, setVersions]   = useState<SnapshotVersion[]>([]);
  const [rows, setRows]           = useState<PlanActualRow[]>([]);
  const [meta, setMeta]           = useState<PageMeta | null>(null);
  const [loading, setLoading]     = useState(false);
  const [toast, setToast]         = useState<string | null>(null);

  // Version compare state
  const [snapA, setSnapA]         = useState('');
  const [snapB, setSnapB]         = useState('');
  const [computing, setComputing] = useState(false);

  // Filter state
  const [filterType, setFilterType]   = useState('');
  const [filterItem, setFilterItem]   = useState('');
  const [filterLoc, setFilterLoc]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage]               = useState(1);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  const loadSummary = useCallback(async () => {
    try { setSummary(await fetchPacSummary()); } catch {}
  }, []);

  const loadVersions = useCallback(async () => {
    try { const r = await fetchVersions(); setVersions(r.data); } catch {}
  }, []);

  const loadRows = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: p, pageSize: 50 };
      if (filterType)   params.comparisonType = filterType;
      if (filterItem)   params.itemCode = filterItem;
      if (filterLoc)    params.locationCode = filterLoc;
      if (filterStatus) params.status = filterStatus;
      const r = await fetchComparisons(params);
      setRows(r.data); setMeta(r.meta); setPage(p);
    } finally { setLoading(false); }
  }, [filterType, filterItem, filterLoc, filterStatus]);

  useEffect(() => { loadSummary(); loadVersions(); loadRows(1); }, []);

  const handleCompute = async (type: 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL') => {
    if (type === 'FORECAST_VERSION' && (!snapA || !snapB)) {
      showToast('Vui lòng chọn cả 2 snapshot để so sánh'); return;
    }
    if (type === 'FORECAST_VS_ACTUAL' && !snapA) {
      showToast('Vui lòng chọn snapshot (plan)'); return;
    }
    setComputing(true);
    try {
      const r = await computeComparison({
        comparisonType: type,
        snapshotIdBase: snapA,
        snapshotIdCompare: type === 'FORECAST_VERSION' ? snapB : undefined,
        computedBy: 'planner',
      });
      showToast(`Computed ${r.computed} rows — Warnings: ${r.warnings}, Criticals: ${r.criticals}`);
      await Promise.all([loadSummary(), loadRows(1)]);
    } catch (e: any) {
      showToast(`Lỗi: ${e.message}`);
    } finally { setComputing(false); }
  };

  const handleExport = async () => {
    try {
      const params: Record<string, string> = {};
      if (filterType)   params.comparisonType = filterType;
      if (filterStatus) params.status = filterStatus;
      await exportPacCsv(params);
    } catch (e: any) { showToast(`Export lỗi: ${e.message}`); }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-slate-800 text-white px-4 py-2 rounded shadow-lg text-sm">
          {toast}
        </div>
      )}

      <h1 className="text-2xl font-bold text-slate-800">Plan vs Actual</h1>

      {/* ── Summary Row ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Avg Variance (FV)"
          value={fmtPct(summary?.forecast_version.avg_variance_pct ?? null)}
          sub={`Bias: ${fmtPct(summary?.forecast_version.avg_bias ?? null)}`}
          color={Math.abs(summary?.forecast_version.avg_variance_pct ?? 0) > 20 ? 'amber' : 'green'}
        />
        <SummaryCard
          label="Critical (FV)"
          value={String(summary?.forecast_version.critical_count ?? '—')}
          sub={`Warnings: ${summary?.forecast_version.warning_count ?? '—'}`}
          color={(summary?.forecast_version.critical_count ?? 0) > 0 ? 'red' : 'green'}
        />
        <SummaryCard
          label="Fill Rate Proxy (FvA)"
          value={fmtRate(summary?.forecast_vs_actual.avg_fill_rate_proxy ?? null)}
          sub="EXPORTED / Forecast"
          color={(summary?.forecast_vs_actual.avg_fill_rate_proxy ?? 1) < 0.9 ? 'amber' : 'green'}
        />
        <SummaryCard
          label="MAPE"
          value="N/A"
          sub="BLOCKED — Phase 2"
          color="slate"
        />
      </div>

      {/* ── Version Compare Panel ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
        <h2 className="font-semibold text-slate-700">So sánh Forecast Versions</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Version A (Base)</label>
            <select
              value={snapA}
              onChange={e => setSnapA(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm min-w-[220px]"
            >
              <option value="">-- Chọn snapshot --</option>
              {versions.map(v => (
                <option key={v.snapshotId} value={v.snapshotId}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Version B (Compare)</label>
            <select
              value={snapB}
              onChange={e => setSnapB(e.target.value)}
              className="border border-slate-300 rounded px-3 py-2 text-sm min-w-[220px]"
            >
              <option value="">-- Chọn snapshot --</option>
              {versions.map(v => (
                <option key={v.snapshotId} value={v.snapshotId}>{v.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={() => handleCompute('FORECAST_VERSION')}
            disabled={computing || !snapA || !snapB}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {computing ? 'Computing…' : 'Compare Versions'}
          </button>
          <button
            onClick={() => handleCompute('FORECAST_VS_ACTUAL')}
            disabled={computing || !snapA}
            className="px-4 py-2 bg-indigo-600 text-white rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
          >
            {computing ? 'Computing…' : 'Forecast vs Actual (proxy)'}
          </button>
        </div>
        {versions.length < 2 && (
          <p className="text-xs text-amber-600">
            ⚠️ Cần ít nhất 2 FROZEN snapshots để so sánh versions. Hiện có: {versions.length}.
          </p>
        )}
      </div>

      {/* ── Comparison Table ── */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-2 p-4 border-b border-slate-100 items-end">
          <select
            value={filterType}
            onChange={e => { setFilterType(e.target.value); loadRows(1); }}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Types</option>
            <option value="FORECAST_VERSION">Forecast Version</option>
            <option value="FORECAST_VS_ACTUAL">Forecast vs Actual</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); loadRows(1); }}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All Status</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="ON_TARGET">On Target</option>
          </select>
          <input
            placeholder="Item code..."
            value={filterItem}
            onChange={e => setFilterItem(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadRows(1)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-44"
          />
          <input
            placeholder="Location code..."
            value={filterLoc}
            onChange={e => setFilterLoc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadRows(1)}
            className="border border-slate-300 rounded px-3 py-1.5 text-sm w-32"
          />
          <button onClick={() => loadRows(1)} className="px-3 py-1.5 bg-slate-700 text-white rounded text-sm">
            Search
          </button>
          <button onClick={handleExport} className="ml-auto px-3 py-1.5 bg-emerald-600 text-white rounded text-sm">
            Export CSV
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Period</th>
                <th className="px-4 py-3 text-left">Item</th>
                <th className="px-4 py-3 text-left">Location</th>
                <th className="px-4 py-3 text-right">Plan Qty</th>
                <th className="px-4 py-3 text-right">Actual Qty</th>
                <th className="px-4 py-3 text-right">Variance %</th>
                <th className="px-4 py-3 text-right">Fill Rate</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={9} className="py-10 text-center text-slate-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="py-10 text-center text-slate-400">
                  Chưa có data. Chọn snapshots và click Compute để bắt đầu.
                </td></tr>
              ) : rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {r.comparisonType === 'FORECAST_VERSION' ? 'FC Version' : 'FC vs Actual'}
                  </td>
                  <td className="px-4 py-3">{r.periodStart}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.itemCode}</td>
                  <td className="px-4 py-3">{r.locationCode}</td>
                  <td className="px-4 py-3 text-right">{fmtQty(r.planQty)}</td>
                  <td className="px-4 py-3 text-right">{fmtQty(r.actualQty)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${
                    r.variancePct == null ? 'text-slate-400'
                    : Math.abs(r.variancePct) > CRITICAL_THRESHOLD ? 'text-red-600'
                    : Math.abs(r.variancePct) > WARNING_THRESHOLD ? 'text-amber-600'
                    : 'text-slate-700'
                  }`}>
                    {fmtPct(r.variancePct)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.fillRateProxy != null
                      ? <span className={r.fillRateProxy < 0.9 ? 'text-amber-600' : 'text-emerald-600'}>
                          {fmtRate(r.fillRateProxy)}
                        </span>
                      : <span className="text-slate-300">—</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] ?? ''}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">
              {meta.total} rows · Page {meta.page}/{meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => loadRows(page - 1)}
                disabled={page <= 1}
                className="px-3 py-1 text-sm border border-slate-300 rounded disabled:opacity-40"
              >Prev</button>
              <button
                onClick={() => loadRows(page + 1)}
                disabled={page >= meta.totalPages}
                className="px-3 py-1 text-sm border border-slate-300 rounded disabled:opacity-40"
              >Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Proxy disclaimer */}
      <p className="text-xs text-slate-400">
        * Actual qty = EXPORTED order_lines (proxy Phase 1). True fill rate cần actual_shipment data — Phase 2.
      </p>
    </div>
  );
}

// ─── Sub-component ────────────────────────────────────────────────────────────

const CRITICAL_THRESHOLD = 40;
const WARNING_THRESHOLD  = 20;

function SummaryCard({
  label, value, sub, color,
}: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    green: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
    red:   'border-red-200 bg-red-50',
    slate: 'border-slate-200 bg-slate-50',
  };
  return (
    <div className={`rounded-xl border p-4 ${colors[color] ?? colors.slate}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  );
}
```

---

## 10. Task Checklist

### DA Prerequisites
```
P1  Verify demand_snapshot ≥2 FROZEN rows
    SELECT snapshot_id, created_at FROM demand_snapshot WHERE status='FROZEN' ORDER BY created_at DESC LIMIT 5;

P2  Verify demand_snapshot_line có period_start = tháng hiện tại
    SELECT COUNT(*) FROM demand_snapshot_line dsl
    JOIN demand_snapshot ds ON ds.snapshot_id = dsl.snapshot_id
    WHERE ds.status='FROZEN' AND dsl.period_start = date_trunc('month', CURRENT_DATE)::date;

P3  Verify EXPORTED order_line trong 4 tuần qua
    SELECT COUNT(*) FROM order_line ol JOIN order_batch ob ON ob.id = ol.order_batch_id
    WHERE ob.status='EXPORTED' AND ob.exported_at >= NOW() - INTERVAL '28 days';
```

### Backend
```
BE-1  [ ] Tạo src/plan-actual/ (entity / dto / service / controller / module / migrations)
BE-2  [ ] Chạy migration 001_create_plan_actual_tables.sql
BE-3  [ ] Thêm UNIS-ERR-029..032 vào common/errors.ts
BE-3a [ ] BUG-3: Verify order_line.dest_location_code tồn tại trong M7 entity trước khi dev query FORECAST_VS_ACTUAL
BE-4  [ ] Register PlanActualModule trong app.module.ts
BE-5  [ ] npm run build — không có TS error
BE-6  [ ] Swagger: POST /plan-actual/compute → { computed, warnings, criticals }
BE-7  [ ] Swagger: GET /plan-actual/versions → list FROZEN snapshots
BE-8  [ ] Swagger: GET /plan-actual/summary → forecast_version + forecast_vs_actual sections
BE-9  [ ] Swagger: GET /plan-actual/comparison → paginated list với filter
BE-10 [ ] GET /plan-actual/export → CSV download
```

### Frontend
```
FE-1  [ ] lib/api/plan-actual.ts
FE-2  [ ] app/plan-actual/page.tsx
FE-3  [ ] Nav link /plan-actual sidebar (step 09)
```

### QA
```
QA-1  POST compute FORECAST_VERSION với 2 snapshot khác THÁNG → rows saved (BUG-1 fix)
QA-2  POST compute FORECAST_VERSION thiếu snapshotIdCompare → 400
QA-3  POST compute FORECAST_VS_ACTUAL với snapshotId không tồn tại → 422 UNIS-ERR-032 (BUG-2 fix)
QA-4  POST compute FORECAST_VS_ACTUAL với snapshot không FROZEN → 422 UNIS-ERR-032
QA-5  POST compute FORECAST_VS_ACTUAL → fill_rate_proxy = actual/plan, từng period riêng
QA-6  GET comparison?status=CRITICAL → chỉ rows |variance_pct| > 40%
QA-7  GET summary → mape_status = N_A
QA-8  GET export → file CSV UTF-8 BOM, 11 cột
QA-9  weekly_plan = monthly / 4.33 (verify với snapshot data thực tế)
```

---

## §11 — Dev Notes (Bugs đã fix)

1. **BUG-1 — `_loadSnapshotLines()` bỏ filter `CURRENT_DATE`:** Query cũ chỉ trả rows của tháng hiện tại → compare snapshot từ tháng khác luôn về 0 rows. Fix: remove `AND period_start = date_trunc('month', CURRENT_DATE)`. Load all lines, thêm `ORDER BY period_start, item_code, location_code`.

2. **BUG-2 — `_computeForecastVsActual()` validate snapshot FROZEN trước khi proceed:** Nếu snapshot không tồn tại hoặc không FROZEN, cũ trả `{ computed: 0 }` không error. Fix: query `demand_snapshot WHERE snapshot_id=$1 AND status='FROZEN'` trước, throw `UNIS-ERR-032` nếu không có kết quả.

3. **BUG-1 consequence — `_computeForecastVsActual` loop:** Sau BUG-1 fix, `planLines` có thể span nhiều periods. Cũ: dùng `periodStart = planLines[0]?.periodStart` (single period) → load actual chỉ 1 tháng + `periodEnd` undefined cho các period khác. Fix: collect `periods[]`, dùng `rangeStart/rangeEnd` cho actual query, GROUP BY `date_trunc('month', exported_at)`, key actualMap bằng `item|location|period`.

4. **BUG-3 — `dest_location_code` trong order_line:** Column name chưa verified với M7 entity. Dev PHẢI kiểm tra `order-line.entity.ts` trước khi viết actual query FORECAST_VS_ACTUAL. Nếu column tên khác (e.g. `location_code`), cập nhật SQL alias tương ứng.

5. **Issue-1 — Threshold constants:** `WARNING_THRESHOLD=20` và `CRITICAL_THRESHOLD=40` khai báo ở cả BE service và FE page. Không phải bug (BE/FE tách biệt), nhưng nếu cần thay đổi ngưỡng → sửa cả 2 chỗ. Acceptable Phase 1.

---

*Module 9 Full Implement v2 (post-review fix) — 2026-04-15*
