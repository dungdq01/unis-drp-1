# MODULE 8 — Monitor & Learn: Full Implementation Guide

> **UNIS Supply Chain Planning System**
> Phase 1 scope: KPI on-demand, HSTK alerts, PO overdue, alert CRUD
> Phase 2 scope: Closed-loop feedback, EMAIL/ZALO, scheduled jobs
> Phase 3 scope: SSE real-time push, MAPE/Fill Rate (blocked: `actual_sales`)

---

## 0. UNIS Constraints (đọc trước khi code)

```
1. PKs — BIGSERIAL (BIGINT), KHÔNG UUID.

2. Location / Item keys — VARCHAR, không UUID:
   - item_code       VARCHAR(50) — từ item.item_code
   - location_code   VARCHAR(20) — từ location.location_code

3. BA spec §5 dùng UUID cho dimension_sku, dimension_location, sku_id, location_id
   → SỬA HẾT về VARCHAR(50) / VARCHAR(20)

4. NO tenant_id — bỏ khỏi tất cả tables và queries.

5. Auth Phase 1 — không JWT. acknowledged_by = VARCHAR(100) truyền từ body.

6. actual_sales table chưa tồn tại → MAPE, Fill Rate, Drift → BLOCKED Phase 2/3.

7. Override Rate Phase 1 — chỉ tính cancel_rate (proxy):
   cancel_rate = COUNT(lines WHERE status='CANCELLED') / COUNT(all lines)
   True override rate cần qty_original (Phase 2 — M7 schema change).

8. HSTK denominator:
   demand_snapshot_line.qty       = monthly quantity
   demand_snapshot_line.reconciled_qty = planner-adjusted (dùng nếu không NULL)
   weekly_demand = COALESCE(reconciled_qty, qty) / 4.33
   on_hand proxy = supply_snapshot_line.allocatable_qty

9. KPI calculation Phase 1 — on-demand (không có Celery/cron).
   Trigger: POST /monitor/kpi/compute → tính + lưu kpi_snapshot.
   SSE → Phase 3.
```

---

## 1. UNIS Business Thresholds

```typescript
// monitor.config.ts
export const UNIS_MONITOR_CONFIG = {
  hstk: {
    stockoutThreshold: 1.5,   // weeks — CRITICAL alert
    overstockThreshold: 3.0,  // weeks — WARNING alert
  },
  drift: {
    demandDriftPct: 20,        // % — WARNING/CRITICAL
    psiThreshold: 0.30,        // CRITICAL
    criticalMultiplier: 40,    // drift > 40% → CRITICAL (else WARNING)
  },
  service: {
    fillRateTarget: 0.92,      // 92%
    otifTarget: 0.90,          // 90%
  },
  workingCapital: {
    inventoryTurnsTarget: 6.0,
  },
  trust: {
    overrideRateTarget: 0.25,  // ≤ 25%
  },
  aiValue: {
    mapeTarget: 25,            // %
  },
  execution: {
    poOverdueDays: 10,         // days — WARNING alert (UNIS = 10, not 7)
    approvalSlaHours: 48,      // hours target
  },
} as const;
```

---

## 2. Database Migration

### `001_create_monitor_tables.sql`

```sql
BEGIN;

-- ── kpi_snapshot ──────────────────────────────────────────────────────────────
-- Lưu kết quả KPI sau mỗi lần compute (on-demand hoặc scheduled Phase 2)
CREATE TABLE IF NOT EXISTS kpi_snapshot (
  id                BIGSERIAL       PRIMARY KEY,
  computed_at       TIMESTAMP       NOT NULL DEFAULT NOW(),
  period_type       VARCHAR(10)     NOT NULL DEFAULT 'WEEKLY',
    -- DAILY | WEEKLY | MONTHLY
  period_start      DATE            NOT NULL,
  period_end        DATE            NOT NULL,
  kpi_group         VARCHAR(30)     NOT NULL,
    -- SERVICE | WORKING_CAPITAL | TRUST | DECISION_SPEED | AI_VALUE | SUSTAINABILITY | DATA_QUALITY
  kpi_code          VARCHAR(50)     NOT NULL,
    -- FILL_RATE | HSTK_AVG | OVERRIDE_RATE | APPROVAL_SLA_HOURS | MAPE |
    -- INVENTORY_TURNS | DATA_COMPLETENESS | DATA_ACCURACY | CANCEL_RATE
  value             DECIMAL(18,4)   NOT NULL DEFAULT 0,
  target            DECIMAL(18,4),
  status            VARCHAR(20)     NOT NULL DEFAULT 'ON_TARGET',
    -- ON_TARGET | WARNING | CRITICAL | DISABLED | N_A
  item_code         VARCHAR(50),
    -- NULL = aggregate; non-null = per-SKU breakdown
  location_code     VARCHAR(20),
    -- NULL = aggregate; non-null = per-CN breakdown
  note              TEXT,
  computed_by       VARCHAR(100)    -- 'system' | username
);

CREATE INDEX IF NOT EXISTS idx_kpi_snap_code    ON kpi_snapshot(kpi_code);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_period  ON kpi_snapshot(period_start, period_type);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_loc     ON kpi_snapshot(location_code);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_item    ON kpi_snapshot(item_code);
CREATE INDEX IF NOT EXISTS idx_kpi_snap_group   ON kpi_snapshot(kpi_group);

-- ── alert ─────────────────────────────────────────────────────────────────────
-- Event-driven alerts: STOCKOUT_RISK, OVERSTOCK, PO_OVERDUE, etc.
CREATE TABLE IF NOT EXISTS alert (
  id                BIGSERIAL       PRIMARY KEY,
  alert_type        VARCHAR(50)     NOT NULL,
    -- STOCKOUT_RISK | OVERSTOCK | PO_OVERDUE | FILL_RATE_LOW |
    -- OVERRIDE_HIGH | MAPE_DEGRADED | SS_BREACH | DEMAND_DRIFT |
    -- DISTRIBUTION_SHIFT | ERP_SFTP_FAILED
  severity          VARCHAR(10)     NOT NULL DEFAULT 'WARNING',
    -- INFO | WARNING | CRITICAL
  title             VARCHAR(255)    NOT NULL,
  body              TEXT,
  item_code         VARCHAR(50),
  location_code     VARCHAR(20),
  ref_id            VARCHAR(100),   -- e.g. order_batch.id, plan_run.id
  ref_type          VARCHAR(50),    -- 'order_batch' | 'plan_run' | 'supply_snapshot'
  channels_sent     VARCHAR(100)    NOT NULL DEFAULT 'SYSTEM',
    -- Phase 1: 'SYSTEM' only; Phase 2: 'SSE,EMAIL'; Phase 3: 'SSE,EMAIL,ZALO'
  is_acknowledged   BOOLEAN         NOT NULL DEFAULT FALSE,
  acknowledged_by   VARCHAR(100),
  acknowledged_at   TIMESTAMP,
  created_at        TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_type   ON alert(alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_sev    ON alert(severity);
CREATE INDEX IF NOT EXISTS idx_alert_ack    ON alert(is_acknowledged);
CREATE INDEX IF NOT EXISTS idx_alert_loc    ON alert(location_code);
CREATE INDEX IF NOT EXISTS idx_alert_item   ON alert(item_code);
CREATE INDEX IF NOT EXISTS idx_alert_ts     ON alert(created_at DESC);

COMMIT;
```

> **Phase 2 tables (chưa tạo):**
> - `drift_detection_log` — demand drift + PSI log (cần `actual_sales`)
> - `feedback_recommendation` — FC→SS, Override→RTM, Supplier LT, Drift→Reforecast loops

---

## 3. Entities

### `entities/kpi-snapshot.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('kpi_snapshot')
export class KpiSnapshot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @CreateDateColumn({ name: 'computed_at' })
  computedAt: Date;

  @Column({ name: 'period_type', type: 'varchar', length: 10, default: 'WEEKLY' })
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY';

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'kpi_group', type: 'varchar', length: 30 })
  kpiGroup: string;

  @Column({ name: 'kpi_code', type: 'varchar', length: 50 })
  kpiCode: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  value: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, default: null })
  target: number | null;

  @Column({ type: 'varchar', length: 20, default: 'ON_TARGET' })
  status: 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'DISABLED' | 'N_A';

  @Column({ name: 'item_code', type: 'varchar', length: 50, nullable: true, default: null })
  itemCode: string | null;

  @Column({ name: 'location_code', type: 'varchar', length: 20, nullable: true, default: null })
  locationCode: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @Column({ name: 'computed_by', type: 'varchar', length: 100, nullable: true, default: null })
  computedBy: string | null;
}
```

### `entities/alert.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('alert')
export class Alert {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'alert_type', type: 'varchar', length: 50 })
  alertType: string;

  @Column({ type: 'varchar', length: 10, default: 'WARNING' })
  severity: 'INFO' | 'WARNING' | 'CRITICAL';

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true, default: null })
  body: string | null;

  @Column({ name: 'item_code', type: 'varchar', length: 50, nullable: true, default: null })
  itemCode: string | null;

  @Column({ name: 'location_code', type: 'varchar', length: 20, nullable: true, default: null })
  locationCode: string | null;

  @Column({ name: 'ref_id', type: 'varchar', length: 100, nullable: true, default: null })
  refId: string | null;

  @Column({ name: 'ref_type', type: 'varchar', length: 50, nullable: true, default: null })
  refType: string | null;

  @Column({ name: 'channels_sent', type: 'varchar', length: 100, default: 'SYSTEM' })
  channelsSent: string;

  @Column({ name: 'is_acknowledged', type: 'boolean', default: false })
  isAcknowledged: boolean;

  @Column({ name: 'acknowledged_by', type: 'varchar', length: 100, nullable: true, default: null })
  acknowledgedBy: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamp', nullable: true, default: null })
  acknowledgedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

---

## 4. DTOs

### `dto/index.ts`

```typescript
import { IsOptional, IsString, IsIn, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// ── Compute KPI ──────────────────────────────────────────────────────────────

export class ComputeKpiDto {
  @ApiPropertyOptional({ example: 'planner', description: 'Who triggered the compute' })
  @IsOptional() @IsString()
  computedBy?: string;
}

// ── List KPI Snapshots ────────────────────────────────────────────────────────

export class ListKpiQueryDto {
  @ApiPropertyOptional({ example: 'WEEKLY' })
  @IsOptional() @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  periodType?: string;

  @ApiPropertyOptional({ example: 'SERVICE' })
  @IsOptional() @IsString()
  kpiGroup?: string;

  @ApiPropertyOptional({ example: 'HSTK_AVG' })
  @IsOptional() @IsString()
  kpiCode?: string;

  @ApiPropertyOptional({ example: '001' })
  @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ example: '40.L1.3060.UGC3600' })
  @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

// ── HSTK Query ────────────────────────────────────────────────────────────────

export class HstkQueryDto {
  @ApiPropertyOptional({ example: '001', description: 'Filter by location_code' })
  @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ example: '40.L1.3060.UGC3600' })
  @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional({ enum: ['STOCKOUT', 'OK', 'OVERSTOCK'] })
  @IsOptional() @IsIn(['STOCKOUT', 'OK', 'OVERSTOCK'])
  classification?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}

// ── List Alerts ───────────────────────────────────────────────────────────────

export class ListAlertsQueryDto {
  @ApiPropertyOptional({ example: 'CRITICAL' })
  @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  severity?: string;

  @ApiPropertyOptional({ example: 'STOCKOUT_RISK' })
  @IsOptional() @IsString()
  alertType?: string;

  @ApiPropertyOptional({ example: false })
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  acknowledged?: boolean;

  @ApiPropertyOptional({ example: '001' })
  @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

// ── Acknowledge Alert ─────────────────────────────────────────────────────────

export class AcknowledgeAlertDto {
  @ApiPropertyOptional({ example: 'planner' })
  @IsOptional() @IsString()
  acknowledgedBy?: string;
}
```

---

## 5. Service

### `monitor.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { KpiSnapshot } from './entities/kpi-snapshot.entity';
import { Alert } from './entities/alert.entity';
import { UNIS_MONITOR_CONFIG } from './monitor.config';
import {
  ComputeKpiDto, ListKpiQueryDto, HstkQueryDto,
  ListAlertsQueryDto, AcknowledgeAlertDto,
} from './dto';

// ─── Internal types ───────────────────────────────────────────────────────────

interface HstkRow {
  itemCode: string;
  itemName: string | null;
  locationCode: string;
  locationName: string | null;
  onHand: number;
  weeklyDemand: number;
  hstkWeeks: number;
  classification: 'STOCKOUT' | 'OK' | 'OVERSTOCK';
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MonitorService {
  constructor(
    @InjectRepository(KpiSnapshot) private readonly kpiRepo:   Repository<KpiSnapshot>,
    @InjectRepository(Alert)       private readonly alertRepo: Repository<Alert>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTE KPI (on-demand, Phase 1)
  // ═══════════════════════════════════════════════════════════════════════════

  async computeKpi(dto: ComputeKpiDto): Promise<{ computed: number; alerts_generated: number }> {
    const now = new Date();
    const periodStart = _isoMonday(now);           // current week Monday
    const periodEnd   = _addDays(periodStart, 6);  // Sunday

    const snapshots: Partial<KpiSnapshot>[] = [];
    let alertsGenerated = 0;

    // ── 1. HSTK (WORKING_CAPITAL) ──────────────────────────────────────────
    const hstkRows = await this._calcHstk();

    if (hstkRows.length > 0) {
      const avgHstk = hstkRows.reduce((s, r) => s + r.hstkWeeks, 0) / hstkRows.length;
      const stockoutCount = hstkRows.filter(r => r.classification === 'STOCKOUT').length;
      const overstockCount = hstkRows.filter(r => r.classification === 'OVERSTOCK').length;

      // Aggregate HSTK_AVG
      snapshots.push({
        periodType: 'WEEKLY', periodStart, periodEnd,
        kpiGroup: 'WORKING_CAPITAL', kpiCode: 'HSTK_AVG',
        value: Math.round(avgHstk * 100) / 100,
        target: null,
        status: stockoutCount > 0 ? 'CRITICAL' : overstockCount > 0 ? 'WARNING' : 'ON_TARGET',
        computedBy: dto.computedBy ?? 'system',
      });

      // Per-location per-SKU snapshots for drill-down
      for (const row of hstkRows) {
        snapshots.push({
          periodType: 'WEEKLY', periodStart, periodEnd,
          kpiGroup: 'WORKING_CAPITAL', kpiCode: 'HSTK',
          value: Math.round(row.hstkWeeks * 100) / 100,
          status: row.classification === 'STOCKOUT' ? 'CRITICAL'
                : row.classification === 'OVERSTOCK' ? 'WARNING' : 'ON_TARGET',
          itemCode: row.itemCode,
          locationCode: row.locationCode,
          computedBy: dto.computedBy ?? 'system',
        });

        // Generate alerts for thresholds
        if (row.classification === 'STOCKOUT') {
          alertsGenerated += await this._upsertAlert({
            alertType: 'STOCKOUT_RISK',
            severity: 'CRITICAL',
            title: `STOCKOUT RISK: ${row.itemCode} tại ${row.locationCode}`,
            body: `HSTK = ${row.hstkWeeks.toFixed(2)} tuần (ngưỡng: ${UNIS_MONITOR_CONFIG.hstk.stockoutThreshold}). On-hand: ${row.onHand}, avg weekly demand: ${row.weeklyDemand.toFixed(1)}`,
            itemCode: row.itemCode,
            locationCode: row.locationCode,
          });
        } else if (row.classification === 'OVERSTOCK') {
          alertsGenerated += await this._upsertAlert({
            alertType: 'OVERSTOCK',
            severity: 'WARNING',
            title: `OVERSTOCK: ${row.itemCode} tại ${row.locationCode}`,
            body: `HSTK = ${row.hstkWeeks.toFixed(2)} tuần (ngưỡng: ${UNIS_MONITOR_CONFIG.hstk.overstockThreshold}). On-hand: ${row.onHand}`,
            itemCode: row.itemCode,
            locationCode: row.locationCode,
          });
        }
      }
    }

    // ── 2. PO Overdue (EXECUTION) ──────────────────────────────────────────
    const overdueResult = await this._calcPoOverdue();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DECISION_SPEED', kpiCode: 'PO_OVERDUE_COUNT',
      value: overdueResult.overdueCount,
      target: 0,
      status: overdueResult.overdueCount > 0 ? 'WARNING' : 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });
    if (overdueResult.overdueCount > 0) {
      alertsGenerated += await this._upsertAlert({
        alertType: 'PO_OVERDUE',
        severity: 'WARNING',
        title: `${overdueResult.overdueCount} order batch quá hạn duyệt (> ${UNIS_MONITOR_CONFIG.execution.poOverdueDays} ngày)`,
        body: `Batch IDs: ${overdueResult.batchIds.slice(0, 10).join(', ')}${overdueResult.batchIds.length > 10 ? '...' : ''}`,
      });
    }

    // ── 3. Approval SLA (DECISION_SPEED) ──────────────────────────────────
    const slaResult = await this._calcApprovalSla();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DECISION_SPEED', kpiCode: 'APPROVAL_SLA_HOURS',
      value: Math.round(slaResult.avgHours * 10) / 10,
      target: UNIS_MONITOR_CONFIG.execution.approvalSlaHours,
      status: slaResult.avgHours > UNIS_MONITOR_CONFIG.execution.approvalSlaHours ? 'WARNING' : 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 4. Cancel Rate (TRUST — proxy for override rate Phase 1) ──────────
    const cancelResult = await this._calcCancelRate();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'TRUST', kpiCode: 'CANCEL_RATE',
      value: Math.round(cancelResult.rate * 10000) / 10000,
      target: UNIS_MONITOR_CONFIG.trust.overrideRateTarget,
      status: cancelResult.rate > UNIS_MONITOR_CONFIG.trust.overrideRateTarget ? 'WARNING' : 'ON_TARGET',
      note: 'Phase 1 proxy: cancel_rate. True override_rate cần qty_original (Phase 2).',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 5. DRP Cycle Time (DECISION_SPEED) ────────────────────────────────
    const cycleResult = await this._calcDrpCycleTime();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DECISION_SPEED', kpiCode: 'DRP_CYCLE_TIME_HOURS',
      value: Math.round(cycleResult.avgHours * 10) / 10,
      status: 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 6. Data Quality (DATA_QUALITY) ────────────────────────────────────
    const dqResult = await this._calcDataQuality();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DATA_QUALITY', kpiCode: 'DATA_COMPLETENESS',
      value: Math.round(dqResult.completeness * 10000) / 10000,
      target: 0.9,
      status: dqResult.completeness < 0.9 ? 'WARNING' : 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 7. Sustainability (OFF) ────────────────────────────────────────────
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'SUSTAINABILITY', kpiCode: 'CO2_TOTAL_KG',
      value: 0,
      status: 'DISABLED',
      note: 'CO2 tracking OFF for UNIS Phase 1.',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 8. AI_VALUE / MAPE (blocked Phase 2/3) ────────────────────────────
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'AI_VALUE', kpiCode: 'MAPE',
      value: 0,
      target: UNIS_MONITOR_CONFIG.aiValue.mapeTarget,
      status: 'N_A',
      note: 'BLOCKED: actual_sales table chưa tồn tại. Implement Phase 2/3.',
      computedBy: dto.computedBy ?? 'system',
    });

    // Bulk save
    await this.kpiRepo.save(snapshots as KpiSnapshot[]);

    return { computed: snapshots.length, alerts_generated: alertsGenerated };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HSTK
  // ═══════════════════════════════════════════════════════════════════════════

  async getHstk(query: HstkQueryDto) {
    const rows = await this._calcHstk();

    let filtered = rows;
    if (query.locationCode) filtered = filtered.filter(r => r.locationCode === query.locationCode);
    if (query.itemCode)     filtered = filtered.filter(r => r.itemCode.includes(query.itemCode!));
    if (query.classification) filtered = filtered.filter(r => r.classification === query.classification);

    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);
    const total    = filtered.length;
    const data     = filtered.slice((page - 1) * pageSize, page * pageSize);

    const summary = {
      stockout:  rows.filter(r => r.classification === 'STOCKOUT').length,
      ok:        rows.filter(r => r.classification === 'OK').length,
      overstock: rows.filter(r => r.classification === 'OVERSTOCK').length,
      avg_hstk:  rows.length
        ? Math.round(rows.reduce((s, r) => s + r.hstkWeeks, 0) / rows.length * 100) / 100
        : 0,
    };

    return {
      summary,
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALERTS
  // ═══════════════════════════════════════════════════════════════════════════

  async listAlerts(query: ListAlertsQueryDto) {
    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const qb = this.alertRepo.createQueryBuilder('a')
      .orderBy('a.created_at', 'DESC');

    if (query.severity)     qb.andWhere('a.severity = :sev',      { sev: query.severity });
    if (query.alertType)    qb.andWhere('a.alert_type = :t',      { t: query.alertType });
    if (query.locationCode) qb.andWhere('a.location_code = :lc',  { lc: query.locationCode });
    if (query.acknowledged !== undefined) {
      qb.andWhere('a.is_acknowledged = :ack', { ack: query.acknowledged });
    }

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async acknowledgeAlert(alertId: string, dto: AcknowledgeAlertDto): Promise<Alert> {
    const alert = await this.alertRepo.findOne({ where: { id: alertId } });
    if (!alert) throw new NotFoundException(`alert ${alertId} not found`);

    alert.isAcknowledged = true;
    alert.acknowledgedBy = dto.acknowledgedBy ?? null;
    alert.acknowledgedAt = new Date();
    return this.alertRepo.save(alert);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STATS (dashboard summary)
  // ═══════════════════════════════════════════════════════════════════════════

  async getStats(): Promise<object> {
    const [alertStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE severity = 'CRITICAL' AND NOT is_acknowledged)  AS critical_unacked,
        COUNT(*) FILTER (WHERE severity = 'WARNING'  AND NOT is_acknowledged)  AS warning_unacked,
        COUNT(*) FILTER (WHERE NOT is_acknowledged)                             AS total_unacked,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')        AS last_7d_total
      FROM alert
    `);

    const [batchStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUBMITTED'
          AND submitted_at < NOW() - INTERVAL '10 days')  -- UNIS_MONITOR_CONFIG.execution.poOverdueDays = 10 (constant, hardcoded to avoid template-literal-in-SQL)
        AS overdue_batches,
        COUNT(*) FILTER (WHERE status IN ('DRAFT','SUBMITTED','APPROVED','EXPORTED','CANCELLED'))
        AS total_batches,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 3600
        ) FILTER (WHERE approved_at IS NOT NULL AND submitted_at IS NOT NULL)::numeric, 1)
        AS avg_approval_sla_hours
      FROM order_batch
    `);

    // Latest HSTK snapshot
    const [hstkStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'CRITICAL') AS hstk_stockout_count,
        COUNT(*) FILTER (WHERE status = 'WARNING')  AS hstk_overstock_count,
        AVG(value) AS hstk_avg
      FROM kpi_snapshot
      WHERE kpi_code = 'HSTK'
        AND computed_at = (SELECT MAX(computed_at) FROM kpi_snapshot WHERE kpi_code = 'HSTK')
    `);

    return { alerts: alertStats, batches: batchStats, hstk: hstkStats };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KPI HISTORY (list snapshots)
  // ═══════════════════════════════════════════════════════════════════════════

  async listKpiSnapshots(query: ListKpiQueryDto) {
    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const qb = this.kpiRepo.createQueryBuilder('k')
      .orderBy('k.computed_at', 'DESC');

    if (query.periodType)   qb.andWhere('k.period_type = :pt',    { pt: query.periodType });
    if (query.kpiGroup)     qb.andWhere('k.kpi_group = :g',       { g: query.kpiGroup });
    if (query.kpiCode)      qb.andWhere('k.kpi_code = :c',        { c: query.kpiCode });
    if (query.locationCode) qb.andWhere('k.location_code = :lc',  { lc: query.locationCode });
    if (query.itemCode)     qb.andWhere('k.item_code = :ic',      { ic: query.itemCode });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION METRICS (from M7)
  // ═══════════════════════════════════════════════════════════════════════════

  async getExecutionMetrics(): Promise<object> {
    const [metrics] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUBMITTED'
          AND submitted_at < NOW() - INTERVAL '10 days')  -- UNIS_MONITOR_CONFIG.execution.poOverdueDays = 10 (constant)
          AS overdue_count,
        COUNT(*) FILTER (WHERE status = 'DRAFT')      AS draft_count,
        COUNT(*) FILTER (WHERE status = 'SUBMITTED')  AS submitted_count,
        COUNT(*) FILTER (WHERE status = 'APPROVED')   AS approved_count,
        COUNT(*) FILTER (WHERE status = 'EXPORTED')   AS exported_count,
        COUNT(*) FILTER (WHERE status = 'CANCELLED')  AS cancelled_count,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 3600
        ) FILTER (WHERE approved_at IS NOT NULL AND submitted_at IS NOT NULL)::numeric, 2)
          AS avg_approval_sla_hours,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 3600
        ) FILTER (WHERE approved_at IS NOT NULL AND submitted_at IS NOT NULL
          AND submitted_at >= NOW() - INTERVAL '30 days')::numeric, 2)
          AS avg_approval_sla_30d_hours
      FROM order_batch
    `);

    const [lineMetrics] = await this.dataSource.query(`
      SELECT
        COUNT(*) AS total_lines,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled_lines,
        ROUND(
          COUNT(*) FILTER (WHERE status = 'CANCELLED')::decimal / NULLIF(COUNT(*), 0) * 100,
        2) AS cancel_rate_pct
      FROM order_line
    `);

    return { batch: metrics, lines: lineMetrics };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * HSTK = supply_snapshot_line.allocatable_qty
   *      / NULLIF(COALESCE(dsl.reconciled_qty, dsl.qty) / 4.33, 0)
   *
   * Anchors:
   *  - supply: latest supply_snapshot WHERE freshness = 'PASS'
   *  - demand: latest demand_snapshot WHERE status = 'FROZEN'
   *    (period_start = first day of current month)
   */
  private async _calcHstk(): Promise<HstkRow[]> {
    const rows: any[] = await this.dataSource.query(`
      WITH latest_supply AS (
        SELECT id FROM supply_snapshot
        WHERE freshness = 'PASS'
        ORDER BY id DESC LIMIT 1
      ),
      latest_demand AS (
        SELECT snapshot_id FROM demand_snapshot
        WHERE status = 'FROZEN'
        ORDER BY created_at DESC LIMIT 1
      ),
      supply_data AS (
        SELECT
          ssl.item_code,
          ssl.location_code,
          ssl.allocatable_qty AS on_hand
        FROM supply_snapshot_line ssl
        JOIN latest_supply ls ON ssl.supply_snapshot_id = ls.id
        WHERE ssl.allocatable_qty >= 0  -- BUG-FIX: >= 0 (không loại trừ items có qty=0 — chúng cần được phát hiện là STOCKOUT)
      ),
      demand_data AS (
        SELECT
          dsl.item_code,
          dsl.location_code,
          COALESCE(dsl.reconciled_qty, dsl.qty) / 4.33 AS weekly_demand
        FROM demand_snapshot_line dsl
        JOIN latest_demand ld ON dsl.snapshot_id = ld.snapshot_id
        WHERE dsl.period_start = date_trunc('month', CURRENT_DATE)::date
      )
      SELECT
        s.item_code        AS "itemCode",
        i.item_name        AS "itemName",
        s.location_code    AS "locationCode",
        l.location_name    AS "locationName",
        s.on_hand          AS "onHand",
        COALESCE(d.weekly_demand, 0) AS "weeklyDemand",
        CASE
          WHEN COALESCE(d.weekly_demand, 0) <= 0
            THEN 999.0
          ELSE ROUND((s.on_hand / d.weekly_demand)::numeric, 2)
        END AS "hstkWeeks"
      FROM supply_data s
      LEFT JOIN demand_data d
        ON d.item_code = s.item_code AND d.location_code = s.location_code
      LEFT JOIN item i ON i.item_code = s.item_code
      LEFT JOIN location l ON l.location_code = s.location_code
      ORDER BY "hstkWeeks" ASC
    `);

    return rows.map(r => ({
      itemCode:      r.itemCode,
      itemName:      r.itemName ?? null,
      locationCode:  r.locationCode,
      locationName:  r.locationName ?? null,
      onHand:        Number(r.onHand),
      weeklyDemand:  Number(r.weeklyDemand),
      hstkWeeks:     Number(r.hstkWeeks),
      classification: Number(r.hstkWeeks) < UNIS_MONITOR_CONFIG.hstk.stockoutThreshold ? 'STOCKOUT'
                   : Number(r.hstkWeeks) > UNIS_MONITOR_CONFIG.hstk.overstockThreshold ? 'OVERSTOCK'
                   : 'OK',
    }));
  }

  private async _calcPoOverdue(): Promise<{ overdueCount: number; batchIds: string[] }> {
    const rows: { id: string }[] = await this.dataSource.query(`
      SELECT id::text AS id FROM order_batch
      WHERE status = 'SUBMITTED'
        AND submitted_at < NOW() - INTERVAL '10 days'  -- UNIS_MONITOR_CONFIG.execution.poOverdueDays = 10 (constant)
      ORDER BY submitted_at ASC
    `);
    return { overdueCount: rows.length, batchIds: rows.map(r => r.id) };
  }

  private async _calcApprovalSla(): Promise<{ avgHours: number }> {
    const [result] = await this.dataSource.query(`
      SELECT COALESCE(
        AVG(EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 3600)
        FILTER (WHERE approved_at IS NOT NULL AND submitted_at IS NOT NULL
                  AND submitted_at >= NOW() - INTERVAL '30 days'),
        0
      ) AS avg_hours
      FROM order_batch
    `);
    return { avgHours: Number(result.avg_hours) };
  }

  private async _calcCancelRate(): Promise<{ rate: number; cancelled: number; total: number }> {
    const [result] = await this.dataSource.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled
      FROM order_line
    `);
    const total     = Number(result.total);
    const cancelled = Number(result.cancelled);
    return { rate: total > 0 ? cancelled / total : 0, cancelled, total };
  }

  private async _calcDrpCycleTime(): Promise<{ avgHours: number }> {
    // plan_run table được tạo bởi M4 (DrpModule) — wrap try/catch phòng table chưa tồn tại
    try {
      const [result] = await this.dataSource.query(`
        SELECT COALESCE(
          AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600)
          FILTER (WHERE status = 'COMPLETED'
                    AND started_at IS NOT NULL AND completed_at IS NOT NULL
                    AND created_at >= NOW() - INTERVAL '30 days'),
          0
        ) AS avg_hours
        FROM plan_run
      `);
      return { avgHours: Number(result.avg_hours) };
    } catch {
      return { avgHours: 0 };
    }
  }

  private async _calcDataQuality(): Promise<{ completeness: number }> {
    // Đo % items và locations có đủ config cơ bản
    const [result] = await this.dataSource.query(`
      WITH item_check AS (
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE item_name IS NOT NULL AND base_uom IS NOT NULL) AS ok
        FROM item
      ),
      location_check AS (
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE location_name IS NOT NULL AND location_type IS NOT NULL) AS ok
        FROM location
      ),
      rtm_check AS (
        SELECT COUNT(DISTINCT branch_code) AS branches_with_rtm
        FROM rtm_rule
      ),
      location_total AS (
        SELECT COUNT(*) AS total FROM location WHERE location_type = 'BRANCH'
      )
      SELECT
        (i.ok::float / NULLIF(i.total,0) * 0.4
        + l.ok::float / NULLIF(l.total,0) * 0.4
        + r.branches_with_rtm::float / NULLIF(lt.total,0) * 0.2) AS completeness
      FROM item_check i, location_check l, rtm_check r, location_total lt
    `);
    return { completeness: Math.min(1, Number(result?.completeness ?? 0)) };
  }

  /**
   * Upsert alert: nếu cùng alert_type + item_code + location_code chưa acknowledge → skip.
   * Returns 1 nếu tạo mới, 0 nếu skip.
   */
  private async _upsertAlert(payload: {
    alertType: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    title: string;
    body?: string;
    itemCode?: string;
    locationCode?: string;
    refId?: string;
    refType?: string;
  }): Promise<0 | 1> {
    const existing = await this.alertRepo.findOne({
      where: {
        alertType: payload.alertType,
        itemCode: payload.itemCode ?? null,
        locationCode: payload.locationCode ?? null,
        isAcknowledged: false,
      } as any,
    });

    if (existing) {
      // Update title/body to latest, do not create duplicate
      existing.title = payload.title;
      existing.body  = payload.body ?? existing.body;
      await this.alertRepo.save(existing);
      return 0;
    }

    await this.alertRepo.save(
      this.alertRepo.create({
        alertType:    payload.alertType,
        severity:     payload.severity,
        title:        payload.title,
        body:         payload.body ?? null,
        itemCode:     payload.itemCode ?? null,
        locationCode: payload.locationCode ?? null,
        refId:        payload.refId ?? null,
        refType:      payload.refType ?? null,
        channelsSent: 'SYSTEM',
      }),
    );
    return 1;
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function _isoMonday(d: Date): string {
  const day = d.getDay() || 7; // 0=Sun → 7
  const mon = new Date(d);
  mon.setDate(d.getDate() - day + 1);
  return mon.toISOString().slice(0, 10);
}

function _addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
```

---

## 6. Controller

### `monitor.controller.ts`

```typescript
import {
  Controller, Get, Post, Patch, Query, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MonitorService } from './monitor.service';
import {
  ComputeKpiDto, ListKpiQueryDto, HstkQueryDto,
  ListAlertsQueryDto, AcknowledgeAlertDto,
} from './dto';

@ApiTags('monitor')
@Controller('monitor')
export class MonitorController {
  constructor(private readonly svc: MonitorService) {}

  // ── Dashboard summary ─────────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard summary: alert counts + HSTK + batch metrics' })
  getStats() { return this.svc.getStats(); }

  // ── KPI Compute (on-demand trigger) ───────────────────────────────────────

  @Post('kpi/compute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Trigger KPI computation (on-demand). Saves to kpi_snapshot + generates alerts.' })
  computeKpi(@Body() dto: ComputeKpiDto) {
    return this.svc.computeKpi(dto);
  }

  // ── KPI Snapshots (history) ───────────────────────────────────────────────

  @Get('kpi')
  @ApiOperation({ summary: 'List kpi_snapshot history (filter by group/code/location/item)' })
  listKpi(@Query() query: ListKpiQueryDto) {
    return this.svc.listKpiSnapshots(query);
  }

  // ── HSTK ──────────────────────────────────────────────────────────────────

  @Get('hstk')
  @ApiOperation({ summary: 'HSTK per item × location (filter by location_code, item_code, classification)' })
  getHstk(@Query() query: HstkQueryDto) {
    return this.svc.getHstk(query);
  }

  // ── Execution Metrics (from M7) ───────────────────────────────────────────

  @Get('execution')
  @ApiOperation({ summary: 'Execution metrics: overdue batches, approval SLA, cancel rate' })
  getExecution() { return this.svc.getExecutionMetrics(); }

  // ── Alerts ────────────────────────────────────────────────────────────────

  @Get('alerts')
  @ApiOperation({ summary: 'List alerts (filter by severity, type, acknowledged, location)' })
  listAlerts(@Query() query: ListAlertsQueryDto) {
    return this.svc.listAlerts(query);
  }

  @Patch('alerts/:id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge alert' })
  acknowledgeAlert(
    @Param('id') id: string,
    @Body() dto: AcknowledgeAlertDto,
  ) {
    return this.svc.acknowledgeAlert(id, dto);
  }
}
```

---

## 7. Module

### `monitor.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiSnapshot } from './entities/kpi-snapshot.entity';
import { Alert } from './entities/alert.entity';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KpiSnapshot, Alert])],
  providers: [MonitorService],
  controllers: [MonitorController],
  exports: [MonitorService],
})
export class MonitorModule {}
```

> **NOTE:** Register `MonitorModule` trong `app.module.ts`:
>
> ```typescript
> // app.module.ts — thêm 2 dòng
> import { MonitorModule } from './monitor/monitor.module';
> // ... (trong imports array)
>     MonitorModule,
> ```

---

## 8. UNIS Errors (thêm vào `common/errors.ts`)

```typescript
ALERT_NOT_FOUND:        { code: 'UNIS-ERR-025', msg: 'Alert not found',                       status: 404 },
KPI_COMPUTE_FAILED:     { code: 'UNIS-ERR-026', msg: 'KPI computation failed',                status: 500 },
MONITOR_NO_SUPPLY_DATA: { code: 'UNIS-ERR-027', msg: 'Không có supply snapshot PASS nào',    status: 422 },
MONITOR_NO_DEMAND_DATA: { code: 'UNIS-ERR-028', msg: 'Không có demand snapshot FROZEN nào',  status: 422 },
```

---

## 9. Frontend — `lib/api/monitor.ts`

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(p: string) { return `${BASE_URL}/api/v1${p}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity    = 'INFO' | 'WARNING' | 'CRITICAL';
export type KpiStatus        = 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'DISABLED' | 'N_A';
export type HstkClass        = 'STOCKOUT' | 'OK' | 'OVERSTOCK';

export interface KpiSnapshot {
  id: string;
  computedAt: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  kpiGroup: string;
  kpiCode: string;
  value: number;
  target: number | null;
  status: KpiStatus;
  itemCode: string | null;
  locationCode: string | null;
  note: string | null;
}

export interface MonitorAlert {
  id: string;
  alertType: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  itemCode: string | null;
  locationCode: string | null;
  isAcknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface HstkRow {
  itemCode: string;
  itemName: string | null;
  locationCode: string;
  locationName: string | null;
  onHand: number;
  weeklyDemand: number;
  hstkWeeks: number;
  classification: HstkClass;
}

export interface HstkSummary {
  stockout: number;
  ok: number;
  overstock: number;
  avg_hstk: number;
}

export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number; }

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchMonitorStats = () =>
  fetch(apiUrl('/monitor/stats'), { cache: 'no-store' })
    .then(r => handleRes<any>(r));

export const computeKpi = (computedBy?: string) =>
  fetch(apiUrl('/monitor/kpi/compute'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ computedBy }),
  }).then(r => handleRes<{ computed: number; alerts_generated: number }>(r));

export const fetchKpiSnapshots = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/monitor/kpi?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: KpiSnapshot[]; meta: PageMeta }>(r));
};

export const fetchHstk = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/monitor/hstk?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ summary: HstkSummary; data: HstkRow[]; meta: PageMeta }>(r));
};

export const fetchExecutionMetrics = () =>
  fetch(apiUrl('/monitor/execution'), { cache: 'no-store' })
    .then(r => handleRes<any>(r));

export const fetchAlerts = (params: Record<string, string | boolean | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/monitor/alerts?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: MonitorAlert[]; meta: PageMeta }>(r));
};

export const acknowledgeAlert = (id: string, acknowledgedBy?: string) =>
  fetch(apiUrl(`/monitor/alerts/${id}/acknowledge`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledgedBy }),
  }).then(r => handleRes<MonitorAlert>(r));
```

---

## 10. HSTK Calculation Logic (chi tiết)

```
supply_snapshot_line.allocatable_qty
= on_hand proxy (Phase 1)

demand_snapshot_line.qty
= monthly forecast (period_start = first day of current month)

demand_snapshot_line.reconciled_qty
= planner-overridden qty (dùng nếu NOT NULL)

weekly_demand = COALESCE(reconciled_qty, qty) / 4.33
               ↑ 4.33 = avg weeks per month (52/12)

HSTK = allocatable_qty / NULLIF(weekly_demand, 0)

Classification:
  HSTK < 1.5  → STOCKOUT   (CRITICAL alert)
  1.5 ≤ HSTK ≤ 3.0 → OK   (no alert)
  HSTK > 3.0  → OVERSTOCK  (WARNING alert)

Edge cases:
  weekly_demand = 0 → HSTK = 999.0 (infinite, classified as OVERSTOCK)
  allocatable_qty = 0 → HSTK = 0.0 → STOCKOUT
```

---

## 11. Phase Boundaries

```
Phase 1 (NOW — implement):
  ✅ kpi_snapshot table + alert table
  ✅ POST /monitor/kpi/compute (on-demand)
  ✅ GET  /monitor/hstk (live HSTK từ supply/demand snapshots)
  ✅ GET  /monitor/execution (M7 metrics)
  ✅ GET  /monitor/alerts + PATCH acknowledge
  ✅ GET  /monitor/stats (dashboard summary)
  ✅ FE: /monitoring page (KPI row, HSTK table, Alert center, Execution panel)
  ℹ️ Override Rate: cancel_rate proxy (documented limitation)
  ℹ️ MAPE: status = N_A, note = blocked

Phase 2 (after actual_sales + M7 qty_original):
  ⬜ actual_sales table (DA create + ERP import pipeline)
  ⬜ MAPE, WMAPE calculation
  ⬜ Fill Rate (actual fulfilled / planned)
  ⬜ True override_rate (qty_adjusted vs qty_original — M7 schema change)
  ⬜ Drift detection (demand drift > 20%, PSI > 0.30)
  ⬜ drift_detection_log table
  ⬜ feedback_recommendation table
  ⬜ FC→SS feedback loop (Celery/pg_cron weekly)
  ⬜ Override→RTM feedback loop (Celery weekly)
  ⬜ Supplier LT feedback loop (Celery monthly)
  ⬜ EMAIL integration
  ⬜ ZALO integration

Phase 3:
  ⬜ SSE real-time alert push (EventSource endpoint)
  ⬜ Drift→Reforecast loop (auto trigger on CRITICAL drift)
  ⬜ SS auto-recalc (FC→SS loop AUTO_APPLY mode)
  ⬜ Scheduled KPI compute (pg_cron daily/weekly)
  ⬜ HSTK history trend chart (per SKU-CN week-over-week)
```

---

## 12. Task Checklist

### Prerequisites

```
P1  [ ] Verify supply_snapshot có ít nhất 1 row với freshness='PASS'
P2  [ ] Verify demand_snapshot có ít nhất 1 row với status='FROZEN'
P3  [ ] Verify demand_snapshot_line có rows với period_start = first day of current month
```

### Backend

```
BE-1  [ ] Tạo src/monitor/
BE-2  [ ] Tạo entities/: kpi-snapshot.entity.ts, alert.entity.ts
BE-3  [ ] Chạy migration 001_create_monitor_tables.sql
BE-4  [ ] Thêm UNIS-ERR-025..028 vào common/errors.ts
BE-5  [ ] Tạo monitor.config.ts
BE-6  [ ] Tạo dto/index.ts
BE-7  [ ] Tạo monitor.service.ts
BE-8  [ ] Tạo monitor.controller.ts
BE-9  [ ] Tạo monitor.module.ts
BE-10 [ ] Register MonitorModule trong app.module.ts
BE-11 [ ] npm run build — không có TS error
BE-12 [ ] Swagger: POST /monitor/kpi/compute → { computed: N, alerts_generated: M }
BE-13 [ ] Swagger: GET /monitor/hstk → có summary + data rows
BE-14 [ ] Swagger: GET /monitor/execution → overdue_count, avg_approval_sla_hours
BE-15 [ ] Swagger: GET /monitor/alerts → list với severity
BE-16 [ ] Swagger: PATCH /monitor/alerts/:id/acknowledge → is_acknowledged = true
```

### Frontend

```
FE-1  [ ] Tạo lib/api/monitor.ts
FE-2  [ ] Tạo app/monitoring/page.tsx
FE-3  [ ] KPI summary row: critical alerts, warning alerts, avg HSTK, overdue batches
FE-4  [ ] HSTK table: item × location, classification badge (red/yellow/green), sort by hstkWeeks
FE-5  [ ] Filter HSTK: by classification (STOCKOUT/OK/OVERSTOCK) + location_code
FE-6  [ ] Alert center: list grouped by severity, unacked count badge
FE-7  [ ] Alert acknowledge button (inline)
FE-8  [ ] Execution panel: overdue count, avg SLA hours, cancel rate %
FE-9  [ ] Compute KPI button → POST /monitor/kpi/compute → toast result
FE-10 [ ] Nav link /monitoring trong sidebar (step 08)
```

### QA

```
QA-1  [ ] POST /monitor/kpi/compute → kpi_snapshot rows saved, alerts generated for STOCKOUT items
QA-2  [ ] GET /monitor/hstk → HSTK < 1.5 → classification = STOCKOUT, status = CRITICAL
QA-3  [ ] GET /monitor/hstk → HSTK > 3.0 → classification = OVERSTOCK, status = WARNING
QA-4  [ ] GET /monitor/hstk?classification=STOCKOUT → chỉ trả STOCKOUT rows
QA-5  [ ] PO overdue: batch SUBMITTED > 10 days → alert OVERDUE + overdue_count > 0
QA-6  [ ] PATCH acknowledge → is_acknowledged = true, re-compute không tạo duplicate
QA-7  [ ] MAPE row → status = N_A, note chứa "BLOCKED"
QA-8  [ ] Sustainability row → value = 0, status = DISABLED
QA-9  [ ] GET /monitor/stats → aggregated view đúng
QA-10 [ ] FE: compute → toast hiển thị "computed: N, alerts_generated: M"
```

---

## 13. DA Prerequisites SQL

```sql
-- P1: Check supply_snapshot có PASS
SELECT id, snapshot_name, freshness, status
FROM supply_snapshot
WHERE freshness = 'PASS'
ORDER BY id DESC LIMIT 5;
-- Cần ít nhất 1 row

-- P2: Check demand_snapshot FROZEN
SELECT snapshot_id, run_id, status, created_at
FROM demand_snapshot
WHERE status = 'FROZEN'
ORDER BY created_at DESC LIMIT 5;
-- Cần ít nhất 1 row

-- P3: Check demand_snapshot_line có period_start tháng hiện tại
SELECT COUNT(*), MIN(qty), MAX(qty)
FROM demand_snapshot_line dsl
JOIN demand_snapshot ds ON ds.snapshot_id = dsl.snapshot_id
WHERE ds.status = 'FROZEN'
  AND dsl.period_start = date_trunc('month', CURRENT_DATE)::date;
-- Cần > 0 rows

-- P4: Check supply_snapshot_line có allocatable_qty
SELECT COUNT(*), AVG(allocatable_qty)
FROM supply_snapshot_line ssl
JOIN supply_snapshot ss ON ss.id = ssl.supply_snapshot_id
WHERE ss.freshness = 'PASS'
  AND ssl.allocatable_qty > 0;
-- Cần > 0 rows
```

---

## 14. Phase 2 Out-of-Scope (documented)

| Feature | Lý do defer |
|---------|------------|
| MAPE / Fill Rate / OTIF | `actual_sales` table không tồn tại — DA cần tạo + ERP import |
| True Override Rate | M7 `order_line` thiếu `qty_original` — cần schema change |
| Drift Detection (> 20%) | Cần `actual_sales` để so sánh forecast vs actual |
| PSI calculation | Cần distribution data từ nhiều chu kỳ |
| FC→SS feedback loop | Cần MAPE history ≥ 8 tuần + Celery/pg_cron |
| Override→RTM feedback loop | Cần true override data + pattern analysis |
| Supplier LT feedback loop | Cần actual delivery timestamp (M7 chưa track) |
| EMAIL integration | Cần SMTP config + template service |
| ZALO integration | Cần Zalo OA API key + webhook |
| SSE real-time push | Cần EventSource endpoint + connection management |
| Scheduled KPI compute | Cần pg_cron hoặc Celery worker |
| HSTK trend history chart | Cần ≥ 4 weeks kpi_snapshot data trước khi chart có ý nghĩa |
