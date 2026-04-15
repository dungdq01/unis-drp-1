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

export interface HstkRow {
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
    const now        = new Date();
    const periodStart = _isoMonday(now);
    const periodEnd   = _addDays(periodStart, 6);

    const snapshots: Partial<KpiSnapshot>[] = [];
    let alertsGenerated = 0;

    // ── 1. HSTK (WORKING_CAPITAL) ──────────────────────────────────────────
    const hstkRows = await this._calcHstk();

    if (hstkRows.length > 0) {
      const avgHstk        = hstkRows.reduce((s, r) => s + r.hstkWeeks, 0) / hstkRows.length;
      const stockoutCount  = hstkRows.filter(r => r.classification === 'STOCKOUT').length;
      const overstockCount = hstkRows.filter(r => r.classification === 'OVERSTOCK').length;

      // Aggregate HSTK_AVG — CRITICAL beats WARNING
      snapshots.push({
        periodType: 'WEEKLY', periodStart, periodEnd,
        kpiGroup: 'WORKING_CAPITAL', kpiCode: 'HSTK_AVG',
        value:  Math.round(avgHstk * 100) / 100,
        target: null,
        status: stockoutCount > 0 ? 'CRITICAL' : overstockCount > 0 ? 'WARNING' : 'ON_TARGET',
        computedBy: dto.computedBy ?? 'system',
      });

      // Per-SKU × per-location snapshots
      for (const row of hstkRows) {
        snapshots.push({
          periodType: 'WEEKLY', periodStart, periodEnd,
          kpiGroup: 'WORKING_CAPITAL', kpiCode: 'HSTK',
          value:        Math.round(row.hstkWeeks * 100) / 100,
          status:       row.classification === 'STOCKOUT' ? 'CRITICAL'
                      : row.classification === 'OVERSTOCK' ? 'WARNING' : 'ON_TARGET',
          itemCode:     row.itemCode,
          locationCode: row.locationCode,
          computedBy:   dto.computedBy ?? 'system',
        });

        if (row.classification === 'STOCKOUT') {
          alertsGenerated += await this._upsertAlert({
            alertType: 'STOCKOUT_RISK',
            severity:  'CRITICAL',
            title:     `STOCKOUT RISK: ${row.itemCode} tại ${row.locationCode}`,
            body:      `HSTK = ${row.hstkWeeks.toFixed(2)} tuần (ngưỡng: ${UNIS_MONITOR_CONFIG.hstk.stockoutThreshold}). On-hand: ${row.onHand}, avg weekly demand: ${row.weeklyDemand.toFixed(1)}`,
            itemCode:     row.itemCode,
            locationCode: row.locationCode,
          });
        } else if (row.classification === 'OVERSTOCK') {
          alertsGenerated += await this._upsertAlert({
            alertType: 'OVERSTOCK',
            severity:  'WARNING',
            title:     `OVERSTOCK: ${row.itemCode} tại ${row.locationCode}`,
            body:      `HSTK = ${row.hstkWeeks.toFixed(2)} tuần (ngưỡng: ${UNIS_MONITOR_CONFIG.hstk.overstockThreshold}). On-hand: ${row.onHand}`,
            itemCode:     row.itemCode,
            locationCode: row.locationCode,
          });
        }
      }
    }

    // ── 2. PO Overdue (DECISION_SPEED) ─────────────────────────────────────
    const overdueResult = await this._calcPoOverdue();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DECISION_SPEED', kpiCode: 'PO_OVERDUE_COUNT',
      value:  overdueResult.overdueCount,
      target: 0,
      status: overdueResult.overdueCount > 0 ? 'WARNING' : 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });
    if (overdueResult.overdueCount > 0) {
      alertsGenerated += await this._upsertAlert({
        alertType: 'PO_OVERDUE',
        severity:  'WARNING',
        title:     `${overdueResult.overdueCount} order batch quá hạn duyệt (> ${UNIS_MONITOR_CONFIG.execution.poOverdueDays} ngày)`,
        body:      `Batch IDs: ${overdueResult.batchIds.slice(0, 10).join(', ')}${overdueResult.batchIds.length > 10 ? '...' : ''}`,
      });
    }

    // ── 3. Approval SLA (DECISION_SPEED) ───────────────────────────────────
    const slaResult = await this._calcApprovalSla();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DECISION_SPEED', kpiCode: 'APPROVAL_SLA_HOURS',
      value:  Math.round(slaResult.avgHours * 10) / 10,
      target: UNIS_MONITOR_CONFIG.execution.approvalSlaHours,
      status: slaResult.avgHours > UNIS_MONITOR_CONFIG.execution.approvalSlaHours ? 'WARNING' : 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 4. Cancel Rate (TRUST — proxy Phase 1) ─────────────────────────────
    const cancelResult = await this._calcCancelRate();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'TRUST', kpiCode: 'CANCEL_RATE',
      value:  Math.round(cancelResult.rate * 10000) / 10000,
      target: UNIS_MONITOR_CONFIG.trust.overrideRateTarget,
      status: cancelResult.rate > UNIS_MONITOR_CONFIG.trust.overrideRateTarget ? 'WARNING' : 'ON_TARGET',
      note:   'Phase 1 proxy: cancel_rate. True override_rate cần qty_original (Phase 2).',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 5. DRP Cycle Time (DECISION_SPEED — informational) ─────────────────
    const cycleResult = await this._calcDrpCycleTime();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DECISION_SPEED', kpiCode: 'DRP_CYCLE_TIME_HOURS',
      value:  Math.round(cycleResult.avgHours * 10) / 10,
      status: 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 6. Data Quality (DATA_QUALITY) ─────────────────────────────────────
    const dqResult = await this._calcDataQuality();
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'DATA_QUALITY', kpiCode: 'DATA_COMPLETENESS',
      value:  Math.round(dqResult.completeness * 10000) / 10000,
      target: UNIS_MONITOR_CONFIG.dataQuality.completenessTarget,
      status: dqResult.completeness < UNIS_MONITOR_CONFIG.dataQuality.completenessTarget ? 'WARNING' : 'ON_TARGET',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 7. Sustainability CO2 (DISABLED Phase 1) ───────────────────────────
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'SUSTAINABILITY', kpiCode: 'CO2_TOTAL_KG',
      value:  0,
      status: 'DISABLED',
      note:   'CO2 tracking OFF for UNIS Phase 1. Phase 3 scope.',
      computedBy: dto.computedBy ?? 'system',
    });

    // ── 8. MAPE (N_A — blocked: no actual_sales) ───────────────────────────
    snapshots.push({
      periodType: 'WEEKLY', periodStart, periodEnd,
      kpiGroup: 'AI_VALUE', kpiCode: 'MAPE',
      value:  0,
      target: UNIS_MONITOR_CONFIG.aiValue.mapeTarget,
      status: 'N_A',
      note:   'BLOCKED: actual_sales table chua ton tai. Implement Phase 2/3.',
      computedBy: dto.computedBy ?? 'system',
    });

    // Bulk save all snapshots
    await this.kpiRepo.save(snapshots as KpiSnapshot[]);

    return { computed: snapshots.length, alerts_generated: alertsGenerated };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HSTK (live query)
  // ═══════════════════════════════════════════════════════════════════════════

  async getHstk(query: HstkQueryDto) {
    const rows = await this._calcHstk();

    // summary always on full dataset (spec §5.2)
    const summary = {
      stockout:  rows.filter(r => r.classification === 'STOCKOUT').length,
      ok:        rows.filter(r => r.classification === 'OK').length,
      overstock: rows.filter(r => r.classification === 'OVERSTOCK').length,
      avg_hstk:  rows.length
        ? Math.round(rows.reduce((s, r) => s + r.hstkWeeks, 0) / rows.length * 100) / 100
        : 0,
    };

    // filter after summary
    let filtered = rows;
    if (query.locationCode)  filtered = filtered.filter(r => r.locationCode === query.locationCode);
    if (query.itemCode)      filtered = filtered.filter(r => r.itemCode.includes(query.itemCode!));
    if (query.classification) filtered = filtered.filter(r => r.classification === query.classification);

    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);
    const total    = filtered.length;
    const data     = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      summary,
      data,
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ALERTS
  // ═══════════════════════════════════════════════════════════════════════════

  async listAlerts(query: ListAlertsQueryDto) {
    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const qb = this.alertRepo.createQueryBuilder('a').orderBy('a.created_at', 'DESC');
    if (query.severity)     qb.andWhere('a.severity = :sev',     { sev: query.severity });
    if (query.alertType)    qb.andWhere('a.alert_type = :t',     { t: query.alertType });
    if (query.locationCode) qb.andWhere('a.location_code = :lc', { lc: query.locationCode });
    if (query.acknowledged !== undefined) {
      qb.andWhere('a.is_acknowledged = :ack', { ack: query.acknowledged });
    }

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
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
  // STATS
  // ═══════════════════════════════════════════════════════════════════════════

  async getStats(): Promise<object> {
    const [alertStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE severity = 'CRITICAL' AND NOT is_acknowledged) AS critical_unacked,
        COUNT(*) FILTER (WHERE severity = 'WARNING'  AND NOT is_acknowledged) AS warning_unacked,
        COUNT(*) FILTER (WHERE NOT is_acknowledged)                            AS total_unacked,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')       AS last_7d_total
      FROM alert
    `);

    const [batchStats] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUBMITTED'
          AND submitted_at < NOW() - INTERVAL '10 days') AS overdue_batches,
        COUNT(*) AS total_batches,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 3600
        ) FILTER (WHERE approved_at IS NOT NULL AND submitted_at IS NOT NULL)::numeric, 1)
        AS avg_approval_sla_hours
      FROM order_batch
    `);

    // Live HSTK stats — always reflects current inventory/demand data
    const hstkRows = await this._calcHstk();
    const hstkStats = {
      hstk_stockout_count: hstkRows.filter(r => r.classification === 'STOCKOUT').length,
      hstk_overstock_count: hstkRows.filter(r => r.classification === 'OVERSTOCK').length,
      hstk_avg: hstkRows.length > 0
        ? (Math.round(hstkRows.reduce((s, r) => s + r.hstkWeeks, 0) / hstkRows.length * 100) / 100)
        : null,
    };

    return { alerts: alertStats, batches: batchStats, hstk: hstkStats };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // KPI HISTORY
  // ═══════════════════════════════════════════════════════════════════════════

  async listKpiSnapshots(query: ListKpiQueryDto) {
    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const qb = this.kpiRepo.createQueryBuilder('k').orderBy('k.computed_at', 'DESC');
    if (query.periodType)   qb.andWhere('k.period_type = :pt',   { pt: query.periodType });
    if (query.kpiGroup)     qb.andWhere('k.kpi_group = :g',      { g: query.kpiGroup });
    if (query.kpiCode)      qb.andWhere('k.kpi_code = :c',       { c: query.kpiCode });
    if (query.locationCode) qb.andWhere('k.location_code = :lc', { lc: query.locationCode });
    if (query.itemCode)     qb.andWhere('k.item_code = :ic',     { ic: query.itemCode });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION METRICS
  // ═══════════════════════════════════════════════════════════════════════════

  async getExecutionMetrics(): Promise<object> {
    const [metrics] = await this.dataSource.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'SUBMITTED'
          AND submitted_at < NOW() - INTERVAL '10 days') AS overdue_count,
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
   * HSTK = allocatable_qty / (COALESCE(reconciled_qty, qty) / 4.33)
   * - supply: latest supply_snapshot WHERE freshness = 'PASS'
   * - demand: latest FROZEN demand_snapshot, latest available period_start
   *   (fallback: MAX(period_start) instead of current month — handles data lag)
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
      latest_period AS (
        -- Use latest available period (fallback from strict current-month when data lags)
        SELECT MAX(dsl.period_start) AS period_start
        FROM demand_snapshot_line dsl
        JOIN latest_demand ld ON dsl.snapshot_id = ld.snapshot_id
      ),
      supply_data AS (
        SELECT
          ssl.item_code,
          ssl.location_code,
          ssl.allocatable_qty AS on_hand
        FROM supply_snapshot_line ssl
        JOIN latest_supply ls ON ssl.snapshot_id = ls.id
        WHERE ssl.allocatable_qty >= 0
      ),
      demand_data AS (
        SELECT
          dsl.item_code,
          dsl.location_code,
          COALESCE(dsl.reconciled_qty, dsl.qty) / 4.33 AS weekly_demand
        FROM demand_snapshot_line dsl
        JOIN latest_demand ld ON dsl.snapshot_id = ld.snapshot_id
        JOIN latest_period lp ON dsl.period_start = lp.period_start
      )
      SELECT
        s.item_code       AS "itemCode",
        i.item_name       AS "itemName",
        s.location_code   AS "locationCode",
        l.location_name   AS "locationName",
        s.on_hand         AS "onHand",
        COALESCE(d.weekly_demand, 0) AS "weeklyDemand",
        CASE
          WHEN COALESCE(d.weekly_demand, 0) <= 0 THEN 999.0
          ELSE ROUND((s.on_hand / d.weekly_demand)::numeric, 2)
        END AS "hstkWeeks"
      FROM supply_data s
      LEFT JOIN demand_data d
        ON d.item_code = s.item_code AND d.location_code = s.location_code
      LEFT JOIN item i     ON i.item_code = s.item_code
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
        AND submitted_at < NOW() - INTERVAL '10 days'
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
    try {
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
          SELECT COUNT(DISTINCT branch_code) AS branches_with_rtm FROM rtm_rule
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
    } catch {
      return { completeness: 0 };
    }
  }

  /**
   * Upsert alert: cùng alert_type + item_code + location_code chưa acknowledge → UPDATE (return 0).
   * Chỉ INSERT mới khi không có existing unacked alert (return 1).
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
        alertType:    payload.alertType,
        itemCode:     (payload.itemCode     ?? null) as any,
        locationCode: (payload.locationCode ?? null) as any,
        isAcknowledged: false,
      },
    });

    if (existing) {
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
        itemCode:     payload.itemCode     ?? null,
        locationCode: payload.locationCode ?? null,
        refId:        payload.refId        ?? null,
        refType:      payload.refType      ?? null,
        channelsSent: 'SYSTEM',
      }),
    );
    return 1;
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function _isoMonday(d: Date): string {
  const day = d.getDay() || 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - day + 1);
  return mon.toISOString().slice(0, 10);
}

function _addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
