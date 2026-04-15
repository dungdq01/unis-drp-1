import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DemandAccuracy } from './entities/demand-accuracy.entity';
import { AccuracySkuQueryDto, WorstPerformersDto, AccuracyMonth } from './dto/accuracy-query.dto';

/**
 * Accuracy Dashboard service (spec ACCURACY-DASHBOARD-SPEC.md).
 * Endpoints:
 *   BE-A1 getSummary — aggregate KPI + byMonth + byTier
 *   BE-A2 getSkus    — paginated SKU table with filter/sort
 *   BE-A3 getWorst   — SKUs where model acc < threshold (need review)
 */
@Injectable()
export class AccuracyService {
  constructor(
    @InjectRepository(DemandAccuracy)
    private readonly accRepo: Repository<DemandAccuracy>,
  ) {}

  // ── BE-A1: Summary ─────────────────────────────────────────

  async getSummary() {
    const mgr = this.accRepo.manager;

    // byMonth — dynamic aggregates per period.
    // For T10/T11 there's only WMA backtest (no FINAL) so gain = 0.
    // For T12/T1 we have FINAL and MA3 → gain = final - ma3.
    // Each UNION branch needs its own FROM — aggregate functions require a table
    // scope per branch. Extended to include actualTotal + forecastTotal + T2/T3
    // (forecast-only, no actuals yet) for Forecast-vs-Actual chart.
    // WMAPE per month = SUM(|forecast - actual|) / SUM(actual) × 100
    // Only meaningful when actual exists (T10/T11/T12/T1).
    const byMonth = await mgr.query(`
      SELECT
        'T10'::text AS month,
        COUNT(*) FILTER (WHERE actual_t10 > 0)::int AS skus,
        AVG(acc_wma_t10)::float AS "finalAcc",
        AVG(acc_wma_t10)::float AS "ma3Acc",
        0::float AS gain,
        SUM(actual_t10)::float AS "actualTotal",
        SUM(wma_t10)::float    AS "forecastTotal",
        (SUM(ABS(wma_t10 - actual_t10)) / NULLIF(SUM(actual_t10), 0) * 100)::float AS wmape,
        FALSE AS highlight, FALSE AS live, FALSE AS pending
      FROM demand_accuracy
      UNION ALL SELECT
        'T11'::text,
        COUNT(*) FILTER (WHERE actual_t11 > 0)::int,
        AVG(acc_wma_t11)::float,
        AVG(acc_wma_t11)::float,
        0::float,
        SUM(actual_t11)::float,
        SUM(wma_t11)::float,
        (SUM(ABS(wma_t11 - actual_t11)) / NULLIF(SUM(actual_t11), 0) * 100)::float,
        FALSE, FALSE, FALSE
      FROM demand_accuracy
      UNION ALL SELECT
        'T12'::text,
        COUNT(*) FILTER (WHERE actual_t12 > 0)::int,
        AVG(acc_final_t12)::float,
        AVG(acc_ma3_t12)::float,
        (COALESCE(AVG(acc_final_t12), 0) - COALESCE(AVG(acc_ma3_t12), 0))::float,
        SUM(actual_t12)::float,
        SUM(final_fc_t12)::float,
        (SUM(ABS(final_fc_t12 - actual_t12)) / NULLIF(SUM(actual_t12), 0) * 100)::float,
        TRUE, FALSE, FALSE
      FROM demand_accuracy
      UNION ALL SELECT
        'T1'::text,
        COUNT(*) FILTER (WHERE actual_t1 > 0)::int,
        AVG(acc_final_t1)::float,
        AVG(acc_ma3_t1)::float,
        (COALESCE(AVG(acc_final_t1), 0) - COALESCE(AVG(acc_ma3_t1), 0))::float,
        SUM(actual_t1)::float,
        SUM(final_fc_t1)::float,
        (SUM(ABS(final_fc_t1 - actual_t1)) / NULLIF(SUM(actual_t1), 0) * 100)::float,
        TRUE, TRUE, FALSE
      FROM demand_accuracy
      UNION ALL SELECT
        'T2'::text, 0::int, NULL::float, NULL::float, 0::float,
        NULL::float, SUM(final_fc_t2)::float, NULL::float,
        FALSE, FALSE, TRUE
      FROM demand_accuracy
      UNION ALL SELECT
        'T3'::text, 0::int, NULL::float, NULL::float, 0::float,
        NULL::float, SUM(final_fc_t3)::float, NULL::float,
        FALSE, FALSE, TRUE
      FROM demand_accuracy
    `);

    // byTier — rank by actual_t1 desc, compute avg accuracy for each slice.
    const tierSlices = [20, 50, 100, 200, 500];
    const totalEval = await mgr.query(`
      SELECT COUNT(*)::int AS n FROM demand_accuracy WHERE actual_t1 > 0
    `);
    const allCount = Number(totalEval[0]?.n || 0);

    const byTier: any[] = [];
    for (const k of tierSlices) {
      const t = await mgr.query(`
        SELECT
          AVG(acc_final_t1)::float AS "finalAcc",
          AVG(acc_ma3_t1)::float   AS "ma3Acc",
          COUNT(*)::int            AS skus
        FROM (
          SELECT acc_final_t1, acc_ma3_t1
          FROM demand_accuracy
          WHERE actual_t1 > 0
          ORDER BY actual_t1 DESC
          LIMIT $1
        ) s
      `, [k]);
      const r = t[0] || {};
      byTier.push({
        tier: `Top ${k}`,
        skus: Number(r.skus) || 0,
        finalAcc: roundPct(r.finalAcc),
        ma3Acc: roundPct(r.ma3Acc),
        gain: roundPct((Number(r.finalAcc) || 0) - (Number(r.ma3Acc) || 0)),
      });
    }
    const allAgg = await mgr.query(`
      SELECT
        AVG(acc_final_t1)::float AS "finalAcc",
        AVG(acc_ma3_t1)::float   AS "ma3Acc"
      FROM demand_accuracy WHERE actual_t1 > 0
    `);
    const aAll = allAgg[0] || {};
    byTier.push({
      tier: 'All',
      skus: allCount,
      finalAcc: roundPct(aAll.finalAcc),
      ma3Acc: roundPct(aAll.ma3Acc),
      gain: roundPct((Number(aAll.finalAcc) || 0) - (Number(aAll.ma3Acc) || 0)),
    });

    // KPI derived from byMonth T1 + T12
    const t1 = byMonth.find((r: any) => r.month === 'T1') || {};
    const t12 = byMonth.find((r: any) => r.month === 'T12') || {};

    const byMonthOut = byMonth.map((r: any) => ({
      month: r.month,
      skus: Number(r.skus) || 0,
      finalAcc: r.finalAcc !== null ? roundPct(r.finalAcc) : null,
      ma3Acc: r.ma3Acc !== null ? roundPct(r.ma3Acc) : null,
      gain: roundPct(r.gain),
      wmape: r.wmape !== null ? roundPct(r.wmape) : null,
      actualTotal: r.actualTotal !== null ? Number(r.actualTotal) : null,
      forecastTotal: r.forecastTotal !== null ? Number(r.forecastTotal) : null,
      highlight: r.highlight,
      live: r.live,
      pending: r.pending,
    }));

    return {
      byMonth: byMonthOut,
      byTier,
      kpi: {
        modelAccT1: roundPct(t1.finalAcc),
        ma3AccT1: roundPct(t1.ma3Acc),
        gainT1: roundPct(t1.gain),
        skusEvaluated: Number(t1.skus) || 0,
        modelAccT12: roundPct(t12.finalAcc),
        gainT12: roundPct(t12.gain),
      },
    };
  }

  // ── BE-A2: SKU table ──────────────────────────────────────

  async getSkus(dto: AccuracySkuQueryDto) {
    const { month, segment, winner, sort, page, pageSize } = dto;
    const cols = colsForMonth(month);

    const params: any[] = [];
    let paramIdx = 1;
    const whereClauses: string[] = [`a.${cols.actual} IS NOT NULL`];

    if (segment) {
      params.push(segment);
      whereClauses.push(`i.segment = $${paramIdx++}`);
    }

    // winner filter applied AFTER SELECT (we need computed winner)
    const winnerExpr = `CASE
        WHEN COALESCE(a.${cols.accFinal}, 0) >= COALESCE(a.${cols.accMa3}, 0)
        THEN 'MODEL' ELSE 'MA3' END`;
    if (winner === 'MODEL' || winner === 'MA3') {
      whereClauses.push(`${winnerExpr} = $${paramIdx}`);
      params.push(winner);
      paramIdx++;
    }

    const orderBy = sortExpr(sort, cols);

    const countRow = await this.accRepo.manager.query(`
      SELECT COUNT(*)::int AS n
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL
        GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE ${whereClauses.join(' AND ')}
    `, params);
    const total = Number(countRow[0]?.n || 0);

    // R5: include full horizon forecast+actual values per SKU for planner visibility.
    const offset = (page - 1) * pageSize;
    const rows = await this.accRepo.manager.query(`
      SELECT
        a.fsku,
        i.segment,
        a.${cols.actual}::float   AS actual,
        a.${cols.finalFc}::float  AS "modelForecast",
        a.${cols.ma3Fc}::float    AS "ma3Forecast",
        a.${cols.accFinal}::float AS "modelAccuracy",
        a.${cols.accMa3}::float   AS "ma3Accuracy",
        ${winnerExpr}             AS winner,
        (COALESCE(a.${cols.accFinal}, 0) - COALESCE(a.${cols.accMa3}, 0))::float AS gain,
        a.is_modified             AS "isModified",
        -- R5 + R8: full horizon (all months, T10 → T3)
        a.actual_t10::float   AS "actualT10",
        a.actual_t11::float   AS "actualT11",
        a.actual_t12::float   AS "actualT12",
        a.actual_t1::float    AS "actualT1",
        a.final_fc_t12::float AS "fcT12",
        a.final_fc_t1::float  AS "fcT1",
        a.final_fc_t2::float  AS "fcT2",
        a.final_fc_t3::float  AS "fcT3",
        a.acc_final_t12::float AS "accT12",
        a.acc_final_t1::float  AS "accT1"
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL
        GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE ${whereClauses.join(' AND ')}
      ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}
    `, params);

    return {
      data: rows.map((r: any) => ({
        fsku: r.fsku,
        segment: r.segment || null,
        actual: r.actual,
        modelForecast: r.modelForecast,
        ma3Forecast: r.ma3Forecast,
        modelAccuracy: roundPct(r.modelAccuracy),
        ma3Accuracy: roundPct(r.ma3Accuracy),
        winner: r.winner,
        gain: roundPct(r.gain),
        isModified: !!r.isModified,
        // R5 + R8 full horizon (T10 → T3)
        actualT10: r.actualT10 != null ? Number(r.actualT10) : null,
        actualT11: r.actualT11 != null ? Number(r.actualT11) : null,
        actualT12: r.actualT12 != null ? Number(r.actualT12) : null,
        actualT1:  r.actualT1  != null ? Number(r.actualT1)  : null,
        fcT12:     r.fcT12     != null ? Number(r.fcT12)     : null,
        fcT1:      r.fcT1      != null ? Number(r.fcT1)      : null,
        fcT2:      r.fcT2      != null ? Number(r.fcT2)      : null,
        fcT3:      r.fcT3      != null ? Number(r.fcT3)      : null,
        accT12:    r.accT12    != null ? roundPct(r.accT12)  : null,
        accT1:     r.accT1     != null ? roundPct(r.accT1)   : null,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // ── BE-A3: Worst performers ───────────────────────────────

  async getWorst(dto: WorstPerformersDto) {
    const { month, threshold, minActual, pageSize } = dto;
    const cols = colsForMonth(month);

    const rows = await this.accRepo.manager.query(`
      SELECT
        a.fsku,
        i.segment,
        a.${cols.actual}::float    AS actual,
        a.${cols.finalFc}::float   AS "modelForecast",
        a.${cols.accFinal}::float  AS "modelAccuracy",
        a.${cols.accMa3}::float    AS "ma3Accuracy",
        a.final_fc_t2::float       AS "forecastT2",
        a.final_fc_t3::float       AS "forecastT3"
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL
        GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.${cols.accFinal} < $1
        AND a.${cols.actual} > $2
      ORDER BY a.${cols.accFinal} ASC NULLS LAST
      LIMIT ${pageSize}
    `, [threshold, minActual]);

    const countRow = await this.accRepo.manager.query(`
      SELECT COUNT(*)::int AS n
      FROM demand_accuracy
      WHERE ${cols.accFinal} < $1 AND ${cols.actual} > $2
    `, [threshold, minActual]);

    return {
      data: rows.map((r: any) => ({
        fsku: r.fsku,
        segment: r.segment || null,
        actual: r.actual,
        modelForecast: r.modelForecast,
        modelAccuracy: roundPct(r.modelAccuracy),
        ma3Accuracy: roundPct(r.ma3Accuracy),
        forecastT2: r.forecastT2,
        forecastT3: r.forecastT3,
        action: 'REVIEW_NEEDED',
      })),
      meta: { total: Number(countRow[0]?.n || 0), threshold, minActual, month },
    };
  }

  // ── BE-NEW-1: Trend (forecast + actual + confidence per month) ──

  async getTrend() {
    const mgr = this.accRepo.manager;

    // Accuracy-derived forecast+actual (aggregate from demand_accuracy)
    const accMonths = await mgr.query(`
      SELECT
        SUM(actual_t10)::float   AS a10, SUM(wma_t10)::float      AS f10,
        SUM(actual_t11)::float   AS a11, SUM(wma_t11)::float      AS f11,
        SUM(actual_t12)::float   AS a12, SUM(final_fc_t12)::float AS f12,
        SUM(actual_t1)::float    AS a1,  SUM(final_fc_t1)::float  AS f1,
        SUM(final_fc_t2)::float  AS f2,
        SUM(final_fc_t3)::float  AS f3,
        COUNT(*) FILTER (WHERE actual_t10 > 0)::int AS s10,
        COUNT(*) FILTER (WHERE actual_t11 > 0)::int AS s11,
        COUNT(*) FILTER (WHERE actual_t12 > 0)::int AS s12,
        COUNT(*) FILTER (WHERE actual_t1  > 0)::int AS s1
      FROM demand_accuracy
    `);
    const a = accMonths[0] || {};

    // Confidence bands from latest FROZEN snapshot_line (if any)
    const confRows = await mgr.query(`
      SELECT TO_CHAR(period_start, 'YYYY-MM') AS period,
             SUM(confidence_lower)::float AS "confLower",
             SUM(confidence_upper)::float AS "confUpper"
      FROM demand_snapshot_line l
      JOIN demand_snapshot s ON s.snapshot_id = l.snapshot_id
      WHERE s.status = 'FROZEN'
      GROUP BY period_start ORDER BY period_start
    `);
    const confByPeriod: Record<string, { confLower: number | null; confUpper: number | null }> = {};
    for (const r of confRows) {
      confByPeriod[r.period] = {
        confLower: r.confLower !== null ? Number(r.confLower) : null,
        confUpper: r.confUpper !== null ? Number(r.confUpper) : null,
      };
    }
    // Map T-codes to YYYY-MM. Adjust when horizon rolls.
    const monthMap: Record<string, string> = {
      T10: '2025-10', T11: '2025-11', T12: '2025-12',
      T1: '2026-01', T2: '2026-02', T3: '2026-03',
    };

    const build = (code: string, forecast: any, actual: any, skus: any) => {
      const p = monthMap[code];
      const c = confByPeriod[p] || { confLower: null, confUpper: null };
      return {
        month: code,
        forecast: forecast !== null && forecast !== undefined ? Number(forecast) : null,
        actual: actual !== null && actual !== undefined ? Number(actual) : null,
        skus: skus !== null && skus !== undefined ? Number(skus) : 0,
        confLower: c.confLower,
        confUpper: c.confUpper,
        pending: actual === null || actual === undefined,
      };
    };

    return {
      months: [
        build('T10', a.f10, a.a10, a.s10),
        build('T11', a.f11, a.a11, a.s11),
        build('T12', a.f12, a.a12, a.s12),
        build('T1',  a.f1,  a.a1,  a.s1),
        build('T2',  a.f2,  null, 0),
        build('T3',  a.f3,  null, 0),
      ],
    };
  }

  // ── BE-NEW-2: Per-SKU trend (T10 → T3) for sparkline ────────

  async getSkuTrend(fsku: string) {
    const row = await this.accRepo.findOne({ where: { fsku } });
    if (!row) return { fsku, months: [] };
    const n = (v: any) => v === null || v === undefined ? null : Number(v);
    return {
      fsku,
      months: [
        { month: 'T10', actual: n(row.actualT10), forecast: null,             wma: n(row.wmaT10),    ma3: null },
        { month: 'T11', actual: n(row.actualT11), forecast: null,             wma: n(row.wmaT11),    ma3: null },
        { month: 'T12', actual: n(row.actualT12), forecast: n(row.finalFcT12), wma: null,           ma3: n(row.ma3FcT12) },
        { month: 'T1',  actual: n(row.actualT1),  forecast: n(row.finalFcT1),  wma: null,           ma3: n(row.ma3FcT1) },
        { month: 'T2',  actual: null,             forecast: n(row.finalFcT2),  wma: null,           ma3: null },
        { month: 'T3',  actual: null,             forecast: n(row.finalFcT3),  wma: null,           ma3: null },
      ],
    };
  }

  // ── R1+R2: Tab 1 Overview (all from demand_accuracy + item ONLY) ──

  async getOverview() {
    const mgr = this.accRepo.manager;
    // Row 1 KPI + gauges all derived from accuracy + item table.
    const core = await mgr.query(`
      SELECT
        (SELECT COUNT(*) FROM item)::int AS "totalItems",
        (SELECT COUNT(*) FROM item WHERE status = 'ACT')::int AS "activeItems",
        COUNT(*)::int AS "accuracyRows",
        COUNT(*) FILTER (WHERE
          COALESCE(final_fc_t12,0) > 0 OR COALESCE(final_fc_t1,0) > 0
          OR COALESCE(final_fc_t2,0) > 0 OR COALESCE(final_fc_t3,0) > 0
          OR COALESCE(wma_t10,0) > 0 OR COALESCE(wma_t11,0) > 0
        )::int AS "itemsWithForecast",
        COUNT(*) FILTER (WHERE
          COALESCE(actual_t10,0) = 0 AND COALESCE(actual_t11,0) = 0
          AND COALESCE(actual_t12,0) = 0 AND COALESCE(actual_t1,0) = 0
        )::int AS dormant,
        COUNT(*) FILTER (WHERE
          (CASE WHEN COALESCE(actual_t10,0) > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN COALESCE(actual_t11,0) > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN COALESCE(actual_t12,0) > 0 THEN 1 ELSE 0 END) +
          (CASE WHEN COALESCE(actual_t1,0)  > 0 THEN 1 ELSE 0 END) >= 3
        )::int AS "denseItems"
      FROM demand_accuracy
    `);
    const c = core[0] || {};

    // Distinct segments from item table (ACT scope — what planner cares about).
    // item table may lack segment col — gracefully fall back.
    let segmentsDistinct = 0;
    try {
      const segR = await mgr.query(`
        SELECT COUNT(DISTINCT segment)::int AS n
        FROM (
          SELECT DISTINCT segment FROM demand_snapshot_line WHERE segment IS NOT NULL
        ) s
      `);
      segmentsDistinct = Number(segR[0]?.n) || 0;
    } catch { /* no snapshot_line yet */ }

    const totalItems = Number(c.totalItems) || 0;
    const accuracyRows = Number(c.accuracyRows) || 1;
    const itemsWithForecast = Number(c.itemsWithForecast) || 0;
    const denseItems = Number(c.denseItems) || 0;

    const coveragePercent = accuracyRows > 0
      ? Math.round((itemsWithForecast / accuracyRows) * 1000) / 10 : 0;
    const sparsity = accuracyRows > 0
      ? Math.round((denseItems / accuracyRows) * 1000) / 10 : 0;
    // dataMonths: accuracy dataset spans T10→T3 = 6 months coverage.
    // Prefer max(actuals_present_count) avg across items as proxy.
    const mRow = await mgr.query(`
      SELECT AVG(
        (CASE WHEN COALESCE(actual_t10,0) > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(actual_t11,0) > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(actual_t12,0) > 0 THEN 1 ELSE 0 END) +
        (CASE WHEN COALESCE(actual_t1,0)  > 0 THEN 1 ELSE 0 END)
      )::float AS avg_months
      FROM demand_accuracy
    `);
    const dataMonths = Number(mRow[0]?.avg_months) || 0;

    return {
      kpi: {
        totalItems,
        activeItems: Number(c.activeItems) || 0,
        coveragePercent,
        dormantCount: Number(c.dormant) || 0,
      },
      quality: {
        forecastRate: coveragePercent, // same metric, alias for gauge
        sparsity,
        dataMonths: Math.round(dataMonths * 10) / 10, // avg actual months per item (0-4)
        segmentsDistinct,
      },
    };
  }

  // ── BE-NEW-3: SKU status distribution ──────────────────────

  async getSkuStatus() {
    const mgr = this.accRepo.manager;
    const rows = await mgr.query(`
      SELECT status, COUNT(*)::int AS count
      FROM item
      GROUP BY status
      ORDER BY count DESC
    `);
    const total = rows.reduce((s: number, r: any) => s + Number(r.count), 0) || 1;
    // Collapse to 4 buckets: ACT / END / NEW / Other
    const bucket: Record<string, number> = { ACT: 0, END: 0, NEW: 0, Other: 0 };
    for (const r of rows) {
      const st = String(r.status || '').toUpperCase();
      const c = Number(r.count);
      if (st === 'ACT' || st === 'ACTIVE') bucket.ACT += c;
      else if (st.startsWith('END')) bucket.END += c;
      else if (st === 'NEW') bucket.NEW += c;
      else bucket.Other += c;
    }
    const statuses = Object.entries(bucket)
      .map(([status, count]) => ({ status, count, pct: Math.round((count / total) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count);
    return { statuses, total };
  }

  // ── I-2: Pareto (cumulative demand % by SKU rank) ──────────

  async getPareto() {
    const mgr = this.accRepo.manager;
    const rows = await mgr.query(`
      SELECT
        fsku,
        actual_t1::float AS demand
      FROM demand_accuracy
      WHERE actual_t1 > 0
      ORDER BY actual_t1 DESC
    `);
    const total = rows.reduce((s: number, r: any) => s + Number(r.demand), 0) || 1;
    let cumulative = 0;
    return {
      items: rows.map((r: any, i: number) => {
        cumulative += Number(r.demand);
        return {
          rank: i + 1,
          fsku: r.fsku,
          demand: Number(r.demand),
          demandPct: Math.round((Number(r.demand) / total) * 10000) / 100,
          cumulativePct: Math.round((cumulative / total) * 10000) / 100,
        };
      }),
      summary: {
        top20: { count: 20, cumulativePct: 0 },
        top100: { count: 100, cumulativePct: 0 },
      },
    };
  }

  // ── I-3: Scatter (model vs MA3 accuracy per SKU) ───────────

  async getScatter(month: string = 't1') {
    const mgr = this.accRepo.manager;
    const colMap: Record<string, { accFinal: string; accMa3: string; actual: string }> = {
      t1:  { accFinal: 'acc_final_t1',  accMa3: 'acc_ma3_t1',  actual: 'actual_t1' },
      t12: { accFinal: 'acc_final_t12', accMa3: 'acc_ma3_t12', actual: 'actual_t12' },
      t11: { accFinal: 'acc_wma_t11',   accMa3: 'acc_wma_t11', actual: 'actual_t11' },
      t10: { accFinal: 'acc_wma_t10',   accMa3: 'acc_wma_t10', actual: 'actual_t10' },
    };
    const c = colMap[month] || colMap['t1'];
    const rows = await mgr.query(`
      SELECT
        a.fsku,
        i.segment,
        a.${c.actual}::float   AS actual,
        a.${c.accFinal}::float AS "modelAcc",
        a.${c.accMa3}::float   AS "ma3Acc"
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.${c.actual} > 0
        AND a.${c.accFinal} IS NOT NULL
        AND a.${c.accMa3} IS NOT NULL
    `);
    // Quadrant counts
    let q1 = 0, q2 = 0, q3 = 0, q4 = 0;
    const points = rows.map((r: any) => {
      const m = Number(r.modelAcc) || 0;
      const a = Number(r.ma3Acc) || 0;
      if (m >= 50 && a >= 50) q1++;
      else if (m >= 50 && a < 50) q2++;
      else if (m < 50 && a < 50) q3++;
      else q4++;
      return {
        fsku: r.fsku,
        segment: r.segment || 'C',
        actual: Number(r.actual) || 0,
        modelAcc: Math.round(m * 10) / 10,
        ma3Acc: Math.round(a * 10) / 10,
      };
    });
    return {
      points,
      quadrants: {
        q1BothGood: q1,
        q2ModelWins: q2,
        q3BothBad: q3,
        q4Ma3Wins: q4,
      },
      month,
    };
  }

  // ── I-4: Heatmap (accuracy by segment × volume tier) ───────

  async getHeatmap() {
    const mgr = this.accRepo.manager;
    const tiers = [
      { label: 'Top 20', limit: 20 },
      { label: 'Top 100', limit: 100 },
      { label: 'Top 500', limit: 500 },
      { label: 'Tail', limit: 99999 },
    ];
    const segments = ['A', 'B', 'C'];

    // Get all items ranked by actual_t1
    const allItems = await mgr.query(`
      SELECT a.fsku, i.segment, a.actual_t1, a.acc_final_t1,
             ROW_NUMBER() OVER (ORDER BY a.actual_t1 DESC NULLS LAST) AS rn
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.actual_t1 > 0 AND a.acc_final_t1 IS NOT NULL
    `);

    const result: any[] = [];
    for (const seg of segments) {
      const segItems = allItems.filter((r: any) => (r.segment || 'C') === seg);
      const tierData: Record<string, { acc: number | null; count: number }> = {};
      let prevLimit = 0;
      for (const tier of tiers) {
        const tierItems = tier.label === 'Tail'
          ? allItems.filter((r: any) => (r.segment || 'C') === seg && Number(r.rn) > 500)
          : allItems.filter((r: any) => (r.segment || 'C') === seg && Number(r.rn) <= tier.limit && Number(r.rn) > prevLimit);
        const accs = tierItems.map((r: any) => Number(r.acc_final_t1)).filter(v => isFinite(v));
        tierData[tier.label] = {
          acc: accs.length > 0 ? Math.round(accs.reduce((a, b) => a + b, 0) / accs.length * 10) / 10 : null,
          count: accs.length,
        };
        if (tier.label !== 'Tail') prevLimit = tier.limit;
      }
      result.push({ segment: seg, tiers: tierData, total: segItems.length });
    }
    return { rows: result, tiers: tiers.map(t => t.label) };
  }

  // ── I-5: Volatility (CV distribution histogram) ────────────

  async getVolatility() {
    const mgr = this.accRepo.manager;
    const rows = await mgr.query(`
      SELECT
        fsku,
        STDDEV(v)::float AS stddev,
        AVG(v)::float AS mean
      FROM demand_accuracy,
      LATERAL (VALUES (actual_t10), (actual_t11), (actual_t12), (actual_t1)) t(v)
      WHERE v > 0
      GROUP BY fsku
      HAVING COUNT(v) >= 2 AND AVG(v) > 0
    `);
    const bins = [
      { range: '0-25%', min: 0, max: 0.25, count: 0 },
      { range: '25-50%', min: 0.25, max: 0.5, count: 0 },
      { range: '50-75%', min: 0.5, max: 0.75, count: 0 },
      { range: '75-100%', min: 0.75, max: 1.0, count: 0 },
      { range: '>100%', min: 1.0, max: Infinity, count: 0 },
    ];
    let total = 0;
    for (const r of rows) {
      const cv = Number(r.stddev) / Number(r.mean);
      if (!isFinite(cv)) continue;
      total++;
      const bin = bins.find(b => cv >= b.min && cv < b.max) || bins[bins.length - 1];
      bin.count++;
    }
    return {
      bins: bins.map(b => ({
        range: b.range,
        count: b.count,
        pct: total > 0 ? Math.round((b.count / total) * 1000) / 10 : 0,
        label: b.range === '0-25%' ? 'Stable' : b.range === '25-50%' ? 'Medium' : b.range === '50-75%' ? 'Volatile' : b.range === '75-100%' ? 'High' : 'Extreme',
        color: b.range === '0-25%' ? '#10B981' : b.range === '25-50%' ? '#F59E0B' : b.range === '50-75%' ? '#F97316' : '#EF4444',
      })),
      total,
    };
  }

  // ── I-10: Compare (period vs period per SKU) ───────────────

  async getCompare(month1: string = 't12', month2: string = 't1', page = 1, pageSize = 50) {
    const mgr = this.accRepo.manager;
    const colMap: Record<string, { fc: string; actual: string; acc: string }> = {
      t1:  { fc: 'final_fc_t1',  actual: 'actual_t1',  acc: 'acc_final_t1' },
      t12: { fc: 'final_fc_t12', actual: 'actual_t12', acc: 'acc_final_t12' },
      t11: { fc: 'wma_t11',      actual: 'actual_t11', acc: 'acc_wma_t11' },
      t10: { fc: 'wma_t10',      actual: 'actual_t10', acc: 'acc_wma_t10' },
    };
    const c1 = colMap[month1] || colMap['t12'];
    const c2 = colMap[month2] || colMap['t1'];
    const offset = (page - 1) * pageSize;
    const countRow = await mgr.query(`SELECT COUNT(*)::int AS n FROM demand_accuracy WHERE ${c1.actual} > 0 OR ${c2.actual} > 0`);
    const total = Number(countRow[0]?.n || 0);
    const rows = await mgr.query(`
      SELECT
        a.fsku,
        i.segment,
        a.${c1.fc}::float     AS fc1,
        a.${c1.actual}::float AS actual1,
        a.${c1.acc}::float    AS acc1,
        a.${c2.fc}::float     AS fc2,
        a.${c2.actual}::float AS actual2,
        a.${c2.acc}::float    AS acc2,
        CASE WHEN COALESCE(a.${c1.fc},0) > 0
          THEN ((COALESCE(a.${c2.fc},0) - COALESCE(a.${c1.fc},0)) / a.${c1.fc} * 100)::float
          ELSE NULL END AS "changePct",
        (COALESCE(a.${c2.acc},0) - COALESCE(a.${c1.acc},0))::float AS "accChange"
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.${c1.actual} > 0 OR a.${c2.actual} > 0
      ORDER BY ABS(COALESCE(a.${c2.acc},0) - COALESCE(a.${c1.acc},0)) DESC NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `);
    return {
      data: rows.map((r: any) => ({
        fsku: r.fsku,
        segment: r.segment || null,
        fc1: r.fc1 !== null ? Number(r.fc1) : null,
        actual1: r.actual1 !== null ? Number(r.actual1) : null,
        acc1: r.acc1 !== null ? Math.round(Number(r.acc1) * 10) / 10 : null,
        fc2: r.fc2 !== null ? Number(r.fc2) : null,
        actual2: r.actual2 !== null ? Number(r.actual2) : null,
        acc2: r.acc2 !== null ? Math.round(Number(r.acc2) * 10) / 10 : null,
        changePct: r.changePct !== null ? Math.round(Number(r.changePct) * 10) / 10 : null,
        accChange: r.accChange !== null ? Math.round(Number(r.accChange) * 10) / 10 : null,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), month1, month2 },
    };
  }

  // ── Tab 3 BE endpoints ──────────────────────────────────────

  async getErrorDistribution(month: string = 't1', segment?: string) {
    const mgr = this.accRepo.manager;
    const colMap: Record<string, { acc: string; actual: string }> = {
      t1:  { acc: 'acc_final_t1',  actual: 'actual_t1' },
      t12: { acc: 'acc_final_t12', actual: 'actual_t12' },
      t11: { acc: 'acc_wma_t11',   actual: 'actual_t11' },
      t10: { acc: 'acc_wma_t10',   actual: 'actual_t10' },
    };
    const c = colMap[month] || colMap['t1'];
    // MAPE = 100 - accuracy (since accuracy = max(0, 100 - |error%|*100))
    const segFilter = segment ? `AND i.segment = '${segment.toUpperCase()}'` : '';
    const rows = await mgr.query(`
      SELECT
        a.fsku,
        i.segment,
        GREATEST(0, 100 - COALESCE(a.${c.acc}, 0))::float AS mape,
        a.${c.actual}::float AS actual
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.${c.actual} > 0 AND a.${c.acc} IS NOT NULL
      ${segFilter}
    `);
    const bins = [
      { range: '0-10%', min: 0, max: 10, count: 0 },
      { range: '10-20%', min: 10, max: 20, count: 0 },
      { range: '20-30%', min: 20, max: 30, count: 0 },
      { range: '30-50%', min: 30, max: 50, count: 0 },
      { range: '50-80%', min: 50, max: 80, count: 0 },
      { range: '>80%', min: 80, max: Infinity, count: 0 },
    ];
    const mapeVals: number[] = [];
    const tailSKUs: any[] = [];
    for (const r of rows) {
      const mape = Number(r.mape);
      if (!isFinite(mape)) continue;
      mapeVals.push(mape);
      const bin = bins.find(b => mape >= b.min && mape < b.max) || bins[bins.length - 1];
      bin.count++;
      if (mape > 80) tailSKUs.push({ fsku: r.fsku, mape: Math.round(mape * 10) / 10, segment: r.segment, actual: Number(r.actual) });
    }
    mapeVals.sort((a, b) => a - b);
    const pct = (p: number) => mapeVals[Math.floor(mapeVals.length * p / 100)] || 0;
    const mean = mapeVals.length > 0 ? mapeVals.reduce((a, b) => a + b, 0) / mapeVals.length : 0;
    const variance = mapeVals.length > 0 ? mapeVals.reduce((a, b) => a + (b - mean) ** 2, 0) / mapeVals.length : 0;
    return {
      bins: bins.map(b => ({ ...b, pct: mapeVals.length > 0 ? Math.round(b.count / mapeVals.length * 1000) / 10 : 0 })),
      percentiles: { p10: Math.round(pct(10)*10)/10, p25: Math.round(pct(25)*10)/10, p50: Math.round(pct(50)*10)/10, p75: Math.round(pct(75)*10)/10, p90: Math.round(pct(90)*10)/10 },
      mean: Math.round(mean * 10) / 10,
      stdDev: Math.round(Math.sqrt(variance) * 10) / 10,
      tailSKUs: tailSKUs.sort((a, b) => b.mape - a.mape).slice(0, 20),
      total: mapeVals.length,
      month,
    };
  }

  async getBias(groupBy: string = 'segment', month: string = 't1') {
    const mgr = this.accRepo.manager;
    const colMap: Record<string, { fc: string; actual: string }> = {
      t1:  { fc: 'final_fc_t1',  actual: 'actual_t1' },
      t12: { fc: 'final_fc_t12', actual: 'actual_t12' },
      t11: { fc: 'wma_t11',      actual: 'actual_t11' },
      t10: { fc: 'wma_t10',      actual: 'actual_t10' },
    };
    const c = colMap[month] || colMap['t1'];
    let groupExpr = '';
    let labelExpr = '';
    if (groupBy === 'segment') {
      groupExpr = 'i.segment';
      labelExpr = 'i.segment';
    } else {
      // month groupBy — show all months
      const items: any[] = [];
      for (const [m, cols] of Object.entries(colMap)) {
        const r = await mgr.query(`
          SELECT
            '${m.toUpperCase()}'::text AS label,
            AVG((${cols.fc} - ${cols.actual}) / NULLIF(${cols.actual}, 0) * 100)::float AS bias,
            COUNT(*)::int AS count,
            AVG(${cols.actual})::float AS "avgActual"
          FROM demand_accuracy
          WHERE ${cols.actual} > 0 AND ${cols.fc} IS NOT NULL
        `);
        if (r[0]) items.push({ dimension: 'month', label: m.toUpperCase(), bias: Math.round(Number(r[0].bias) * 10) / 10, count: Number(r[0].count), avgActual: Number(r[0].avgActual) });
      }
      return { items, groupBy: 'month' };
    }
    const rows = await mgr.query(`
      SELECT
        ${labelExpr} AS label,
        AVG((a.${c.fc} - a.${c.actual}) / NULLIF(a.${c.actual}, 0) * 100)::float AS bias,
        COUNT(*)::int AS count,
        AVG(a.${c.actual})::float AS "avgActual"
      FROM demand_accuracy a
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.${c.actual} > 0 AND a.${c.fc} IS NOT NULL
      GROUP BY ${groupExpr}
      ORDER BY ${groupExpr}
    `);
    return {
      items: rows.map((r: any) => ({
        dimension: groupBy,
        label: r.label || 'Unknown',
        bias: Math.round(Number(r.bias) * 10) / 10,
        count: Number(r.count),
        avgActual: Math.round(Number(r.avgActual)),
      })),
      groupBy,
    };
  }

  async getBiasHeatmap(month: string = 't1') {
    const mgr = this.accRepo.manager;
    const colMap: Record<string, { fc: string; actual: string }> = {
      t1:  { fc: 'final_fc_t1',  actual: 'actual_t1' },
      t12: { fc: 'final_fc_t12', actual: 'actual_t12' },
    };
    const c = colMap[month] || colMap['t1'];
    const rows = await mgr.query(`
      SELECT
        l.location_code AS "branchCode",
        MAX(loc.location_name) AS "branchName",
        MAX(i.segment) AS segment,
        AVG((a.${c.fc} - a.${c.actual}) / NULLIF(a.${c.actual}, 0) * 100) FILTER (WHERE i.segment = 'A')::float AS "segA",
        AVG((a.${c.fc} - a.${c.actual}) / NULLIF(a.${c.actual}, 0) * 100) FILTER (WHERE i.segment = 'B')::float AS "segB",
        AVG((a.${c.fc} - a.${c.actual}) / NULLIF(a.${c.actual}, 0) * 100) FILTER (WHERE i.segment = 'C')::float AS "segC",
        AVG((a.${c.fc} - a.${c.actual}) / NULLIF(a.${c.actual}, 0) * 100)::float AS avg
      FROM demand_accuracy a
      LEFT JOIN demand_snapshot_line l ON l.item_code = a.fsku
      LEFT JOIN location loc ON loc.location_code = l.location_code
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.${c.actual} > 0 AND a.${c.fc} IS NOT NULL AND l.location_code IS NOT NULL
      GROUP BY l.location_code
      ORDER BY ABS(AVG((a.${c.fc} - a.${c.actual}) / NULLIF(a.${c.actual}, 0) * 100)) DESC NULLS LAST
      LIMIT 20
    `);
    const rnd = (v: any) => v !== null && v !== undefined ? Math.round(Number(v) * 10) / 10 : null;
    return {
      rows: rows.map((r: any) => ({
        branchCode: r.branchCode,
        branchName: r.branchName || r.branchCode,
        segA: rnd(r.segA),
        segB: rnd(r.segB),
        segC: rnd(r.segC),
        avg: rnd(r.avg),
      })),
      month,
    };
  }

  async getCohort(month: string = 't1') {
    const mgr = this.accRepo.manager;
    const colMap: Record<string, { acc: string; accMa3: string }> = {
      t1:  { acc: 'acc_final_t1',  accMa3: 'acc_ma3_t1' },
      t12: { acc: 'acc_final_t12', accMa3: 'acc_ma3_t12' },
    };
    const c = colMap[month] || colMap['t1'];
    // Cohort = how many non-zero actual months the SKU has (proxy for data maturity)
    const rows = await mgr.query(`
      SELECT
        CASE
          WHEN months_present <= 1 THEN 'New (<2m)'
          WHEN months_present <= 2 THEN 'Growing (2m)'
          WHEN months_present <= 3 THEN 'Mature (3m)'
          ELSE 'Established (4m)'
        END AS cohort,
        months_present,
        COUNT(*)::int AS count,
        AVG(acc_t10)::float AS "t10",
        AVG(acc_t11)::float AS "t11",
        AVG(acc_t12)::float AS "t12",
        AVG(acc_t1)::float  AS "t1",
        AVG(acc_t1)::float - AVG(acc_ma3)::float AS "gainVsMA3"
      FROM (
        SELECT fsku,
          acc_wma_t10 AS acc_t10, acc_wma_t11 AS acc_t11,
          acc_final_t12 AS acc_t12, ${c.acc} AS acc_t1, ${c.accMa3} AS acc_ma3,
          (CASE WHEN actual_t10 > 0 THEN 1 ELSE 0 END +
           CASE WHEN actual_t11 > 0 THEN 1 ELSE 0 END +
           CASE WHEN actual_t12 > 0 THEN 1 ELSE 0 END +
           CASE WHEN actual_t1  > 0 THEN 1 ELSE 0 END) AS months_present
        FROM demand_accuracy
      ) s
      GROUP BY cohort, months_present
      ORDER BY months_present
    `);
    const rnd = (v: any) => v !== null && v !== undefined ? Math.round(Number(v) * 10) / 10 : null;
    return {
      cohorts: rows.map((r: any) => ({
        label: r.cohort,
        count: Number(r.count),
        months: { t10: rnd(r.t10), t11: rnd(r.t11), t12: rnd(r.t12), t1: rnd(r.t1) },
        gainVsMA3: rnd(r.gainVsMA3),
      })),
      month,
    };
  }

  async getCiCalibration() {
    const mgr = this.accRepo.manager;
    // CI coverage: what % of actuals fall within the CI bands
    // We'll approximate using demand_snapshot_line confidence bounds vs demand_accuracy actual
    const rows = await mgr.query(`
      SELECT
        i.segment,
        COUNT(*) FILTER (WHERE a.actual_t1 BETWEEN l.confidence_lower AND l.confidence_upper)::float / NULLIF(COUNT(*), 0) * 100 AS coverage_80,
        COUNT(*)::int AS total
      FROM demand_accuracy a
      JOIN demand_snapshot_line l ON l.item_code = a.fsku
      JOIN demand_snapshot s ON s.snapshot_id = l.snapshot_id AND s.status = 'FROZEN'
      LEFT JOIN (
        SELECT item_code, MAX(segment) AS segment
        FROM demand_snapshot_line WHERE segment IS NOT NULL GROUP BY item_code
      ) i ON i.item_code = a.fsku
      WHERE a.actual_t1 > 0 AND l.confidence_lower IS NOT NULL AND l.confidence_upper IS NOT NULL
      GROUP BY i.segment
    `).catch(() => []);
    const overall = await mgr.query(`
      SELECT
        COUNT(*) FILTER (WHERE a.actual_t1 BETWEEN l.confidence_lower AND l.confidence_upper)::float / NULLIF(COUNT(*), 0) * 100 AS coverage,
        COUNT(*)::int AS total
      FROM demand_accuracy a
      JOIN demand_snapshot_line l ON l.item_code = a.fsku
      JOIN demand_snapshot s ON s.snapshot_id = l.snapshot_id AND s.status = 'FROZEN'
      WHERE a.actual_t1 > 0 AND l.confidence_lower IS NOT NULL
    `).catch(() => [{ coverage: 80, total: 0 }]);
    const rnd = (v: any) => v !== null ? Math.round(Number(v) * 10) / 10 : null;
    return {
      levels: [
        { target: 80, actualCoverage: rnd(overall[0]?.coverage) ?? 80, total: Number(overall[0]?.total) || 0 },
      ],
      bySegment: rows.map((r: any) => ({
        segment: r.segment || 'Unknown',
        coverage80: rnd(r.coverage_80),
        total: Number(r.total),
      })),
    };
  }

  async getSeasonality() {
    const mgr = this.accRepo.manager;
    // Compute seasonal index from actual data across all months
    const rows = await mgr.query(`
      SELECT
        AVG(actual_t10)::float AS a10, AVG(actual_t11)::float AS a11,
        AVG(actual_t12)::float AS a12, AVG(actual_t1)::float AS a1
      FROM demand_accuracy
      WHERE actual_t10 > 0 OR actual_t11 > 0 OR actual_t12 > 0 OR actual_t1 > 0
    `);
    const r = rows[0] || {};
    const vals = [Number(r.a10)||0, Number(r.a11)||0, Number(r.a12)||0, Number(r.a1)||0];
    const overallAvg = vals.reduce((a, b) => a + b, 0) / (vals.filter(v => v > 0).length || 1);
    const rnd = (v: number) => overallAvg > 0 ? Math.round((v / overallAvg) * 100) / 100 : 1;
    const months = [
      { month: 'Oct', label: 'T10', index: rnd(vals[0]), actual: vals[0] },
      { month: 'Nov', label: 'T11', index: rnd(vals[1]), actual: vals[1] },
      { month: 'Dec', label: 'T12', index: rnd(vals[2]), actual: vals[2] },
      { month: 'Jan', label: 'T1',  index: rnd(vals[3]), actual: vals[3] },
    ];
    return { indices: months, overallAvg: Math.round(overallAvg) };
  }
}

// ── helpers ─────────────────────────────────────────────────

function roundPct(v: any): number {
  const n = Number(v);
  if (!isFinite(n) || isNaN(n)) return 0;
  return Math.round(n * 10) / 10;
}

function colsForMonth(month: AccuracyMonth) {
  // T10/T11: only WMA backtest exists (WMA ≡ MA3 per ACCURACY_REPORT_DOCS.md)
  // No separate ma3 columns for T10/T11 in DB — use wma as both final and ma3
  const map = {
    t10: { actual: 'actual_t10', finalFc: 'wma_t10',      ma3Fc: 'wma_t10',      accFinal: 'acc_wma_t10',   accMa3: 'acc_wma_t10'   },
    t11: { actual: 'actual_t11', finalFc: 'wma_t11',      ma3Fc: 'wma_t11',      accFinal: 'acc_wma_t11',   accMa3: 'acc_wma_t11'   },
    t12: { actual: 'actual_t12', finalFc: 'final_fc_t12', ma3Fc: 'ma3_fc_t12',   accFinal: 'acc_final_t12', accMa3: 'acc_ma3_t12' },
    t1:  { actual: 'actual_t1',  finalFc: 'final_fc_t1',  ma3Fc: 'ma3_fc_t1',   accFinal: 'acc_final_t1',  accMa3: 'acc_ma3_t1'  },
  };
  return map[month];
}

function sortExpr(sort: string, cols: ReturnType<typeof colsForMonth>): string {
  switch (sort) {
    case 'accuracy_asc':  return `ORDER BY a.${cols.accFinal} ASC NULLS LAST`;
    case 'accuracy_desc': return `ORDER BY a.${cols.accFinal} DESC NULLS LAST`;
    case 'gain_desc':     return `ORDER BY (COALESCE(a.${cols.accFinal},0) - COALESCE(a.${cols.accMa3},0)) DESC NULLS LAST`;
    case 'actual_desc':
    default:              return `ORDER BY a.${cols.actual} DESC NULLS LAST`;
  }
}
