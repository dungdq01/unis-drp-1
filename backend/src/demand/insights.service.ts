import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DemandForecastDetail } from './entities/demand-forecast-detail.entity';
import { DemandSnapshotLine } from './entities/demand-snapshot-line.entity';
import { DemandOverrideLog } from './entities/demand-override-log.entity';

/**
 * Sprint: Demand Insights (spec DEMAND-INSIGHTS-SPEC.md)
 * Owns 4 endpoints: insights, quality, alerts, branches.
 * All aggregations read from demand_forecast_detail (always populated)
 * per Tech Lead data-source decision (2026-04-13).
 */
/**
 * F6 FIX: branch_name / location_name in DB may contain literal JSON-escape
 * sequences ("Ti\u00e1\u00bb\u20acN GIANG") from upstream data pipelines.
 * Decode to proper Vietnamese ("TIỀN GIANG") before returning to FE.
 */
function decodeUnicodeEscapes(s: string | null | undefined): string {
  if (!s) return '';
  if (!s.includes('\\u')) return s;
  try {
    return JSON.parse(`"${s.replace(/"/g, '\\"')}"`);
  } catch {
    return s;
  }
}

@Injectable()
export class InsightsService {
  constructor(
    @InjectRepository(DemandForecastDetail)
    private readonly detailRepo: Repository<DemandForecastDetail>,
    @InjectRepository(DemandSnapshotLine)
    private readonly lineRepo: Repository<DemandSnapshotLine>,
    @InjectRepository(DemandOverrideLog)
    private readonly overrideRepo: Repository<DemandOverrideLog>,
  ) {}

  // ── BE-I1: Forecast Insights Summary ────────────────────
  // CTE-based to single-pass the 84K rows for 4 aggregates (spec §BE-I1 note)

  async getInsights(snapshotId?: string) {
    const manager = this.detailRepo.manager;
    const whereSid = snapshotId ? 'WHERE snapshot_id = $1' : '';
    const params = snapshotId ? [snapshotId] : [];

    // byPeriod (from snapshot_line — canonical qty)
    const byPeriod = await manager.query(`
      SELECT period_start::text AS period, SUM(qty)::float AS "totalQty",
             COUNT(DISTINCT item_code)::int AS "itemCount"
      FROM demand_snapshot_line
      ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
      GROUP BY period_start ORDER BY period_start
    `, params);

    // Tet flag per period: prefer detail table, fallback to snapshot_line.tet_flag,
    // final fallback = detect Jan/Feb/Mar (senior review pragmatic fix).
    const tetMap = await manager.query(`
      SELECT period, MAX(tet) AS tet FROM (
        SELECT forecast_date AS period, MAX(tet_flag) AS tet
        FROM demand_forecast_detail ${whereSid} GROUP BY forecast_date
        UNION ALL
        SELECT TO_CHAR(period_start, 'YYYY-MM') AS period, MAX(tet_flag) AS tet
        FROM demand_snapshot_line ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
        GROUP BY period_start
      ) u GROUP BY period
    `, params);
    const tetByPeriod: Record<string, string> = {};
    for (const r of tetMap) tetByPeriod[String(r.period).slice(0, 7)] = r.tet || '';

    const byPeriodOut = byPeriod.map((r: any) => {
      const p = String(r.period).slice(0, 7);
      const flagStored = (tetByPeriod[p] || '').toUpperCase() === 'Y';
      const month = parseInt(p.slice(5, 7), 10);
      const flagDerived = month >= 1 && month <= 3;
      return {
        period: p,
        totalQty: Number(r.totalQty) || 0,
        itemCount: Number(r.itemCount) || 0,
        tetFlag: flagStored || flagDerived,
      };
    });

    // bySegment
    const bySegmentRaw = await manager.query(`
      SELECT segment, SUM(qty)::float AS "totalQty",
             COUNT(DISTINCT item_code)::int AS "itemCount"
      FROM demand_snapshot_line
      ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
      GROUP BY segment ORDER BY "totalQty" DESC
    `, params);
    const totalForSeg = bySegmentRaw.reduce((s: number, r: any) => s + Number(r.totalQty), 0) || 1;
    const bySegment = bySegmentRaw.map((r: any) => ({
      segment: r.segment || 'Unknown',
      totalQty: Number(r.totalQty) || 0,
      itemCount: Number(r.itemCount) || 0,
      pct: Math.round((Number(r.totalQty) / totalForSeg) * 1000) / 10,
    }));

    // byComboClass: prefer detail (always populated via pipeline) but fallback to
    // snapshot_line when detail rows are missing (current state of DB per senior review).
    const detailHasRows = await manager.query(
      `SELECT 1 FROM demand_forecast_detail ${whereSid} LIMIT 1`,
      params,
    );
    const comboSource = detailHasRows.length > 0 ? 'demand_forecast_detail' : 'demand_snapshot_line';
    const comboWhere = snapshotId ? 'WHERE snapshot_id = $1' : '';
    const byComboRaw = await manager.query(`
      SELECT combo_class AS "comboClass", COUNT(DISTINCT item_code)::int AS "itemCount"
      FROM ${comboSource}
      ${comboWhere}
      GROUP BY combo_class
      HAVING combo_class IS NOT NULL
      ORDER BY "itemCount" DESC
    `, params);
    const totalItemsCombo = byComboRaw.reduce((s: number, r: any) => s + Number(r.itemCount), 0) || 1;
    const byComboClass = byComboRaw.map((r: any) => ({
      comboClass: r.comboClass || 'OTHER',
      itemCount: Number(r.itemCount) || 0,
      pct: Math.round((Number(r.itemCount) / totalItemsCombo) * 1000) / 10,
    }));

    // tetImpact: fallback to snapshot_line + EXTRACT(MONTH) when detail empty/tet_flag NULL.
    // Period-based detection (Jan/Feb/Mar) matches FE isTetPeriod() convention.
    const tetQty = await manager.query(`
      SELECT CASE
               WHEN UPPER(COALESCE(tet_flag, '')) = 'Y'
                    OR EXTRACT(MONTH FROM period_start) IN (1,2,3)
               THEN 'Y' ELSE 'N'
             END AS tet_flag,
             SUM(qty)::float AS qty,
             COUNT(DISTINCT period_start)::int AS months,
             COUNT(DISTINCT item_code)::int AS items
      FROM demand_snapshot_line
      ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
      GROUP BY 1
    `, params);
    const tetRow = tetQty.find((r: any) => String(r.tet_flag) === 'Y');
    const nonTetRow = tetQty.find((r: any) => String(r.tet_flag) !== 'Y');
    const tetAvgQty = tetRow && tetRow.months > 0 ? tetRow.qty / tetRow.months : 0;
    const nonTetAvgQty = nonTetRow && nonTetRow.months > 0 ? nonTetRow.qty / nonTetRow.months : 0;

    // B5 FIX: uplift uses OVERALL avg as baseline (not non-Tet alone).
    // Reason: when the horizon only has 1 non-Tet month (e.g. Dec Q4 peak),
    // treating it as baseline gives misleading negative uplift. Overall avg
    // normalizes across full horizon.
    const totalQtyAll = (Number(tetRow?.qty) || 0) + (Number(nonTetRow?.qty) || 0);
    const totalMonthsAll = (Number(tetRow?.months) || 0) + (Number(nonTetRow?.months) || 0);
    const overallAvg = totalMonthsAll > 0 ? totalQtyAll / totalMonthsAll : 0;
    const upliftPct = overallAvg > 0
      ? Math.round(((tetAvgQty - overallAvg) / overallAvg) * 1000) / 10
      : 0;

    // Totals
    const totalRow = await manager.query(`
      SELECT SUM(qty)::float AS total, COUNT(DISTINCT item_code)::int AS items,
             COUNT(DISTINCT period_start)::int AS periods
      FROM demand_snapshot_line
      ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
    `, params);

    const overrideCount = snapshotId
      ? await this.overrideRepo.count({ where: { snapshotId } })
      : await this.overrideRepo.count();

    return {
      byPeriod: byPeriodOut,
      bySegment,
      byComboClass,
      tetImpact: {
        tetAvgQty: Math.round(tetAvgQty),
        nonTetAvgQty: Math.round(nonTetAvgQty),
        upliftPct,
        tetItemCount: Number(tetRow?.items || 0),
      },
      totalDemand: Number(totalRow[0]?.total) || 0,
      totalItems: Number(totalRow[0]?.items) || 0,
      totalPeriods: Number(totalRow[0]?.periods) || 0,
      overrideCount,
    };
  }

  // ── BE-I2: Forecast Quality ─────────────────────────────

  async getQuality(snapshotId?: string) {
    const manager = this.detailRepo.manager;
    const whereSid = snapshotId ? 'WHERE snapshot_id = $1' : '';
    const params = snapshotId ? [snapshotId] : [];

    // Confidence spread: prefer detail, fallback snapshot_line (confidence cols in 002b)
    const detailHas = await manager.query(
      `SELECT 1 FROM demand_forecast_detail ${whereSid} LIMIT 1`, params,
    );
    const confSource = detailHas.length > 0
      ? { table: 'demand_forecast_detail', qty: 'forecast_qty' }
      : { table: 'demand_snapshot_line',  qty: 'qty' };
    const confWhere = snapshotId ? 'WHERE snapshot_id = $1' : '';

    const spreadRows = await manager.query(`
      SELECT item_code,
             AVG(CASE WHEN ${confSource.qty} > 0
                      THEN (confidence_upper - confidence_lower) / NULLIF(${confSource.qty},0)
                      ELSE NULL END) AS spread
      FROM ${confSource.table}
      ${confWhere}
      GROUP BY item_code
    `, params);

    let tight = 0, medium = 0, wide = 0, spreadSum = 0, spreadN = 0;
    for (const r of spreadRows) {
      const s = Number(r.spread);
      if (!isFinite(s) || isNaN(s)) continue;
      spreadSum += s; spreadN++;
      if (s < 0.05) tight++;
      else if (s <= 0.20) medium++;
      else wide++;
    }
    const avgSpreadPct = spreadN > 0 ? Math.round((spreadSum / spreadN) * 1000) / 10 : 0;

    // Accuracy alerts classification (per item)
    const accRows = await manager.query(`
      SELECT item_code, segment,
             SUM(forecast_qty)::float AS total_forecast,
             AVG(COALESCE(qty_sold_12m_avg, 0))::float AS avg_12m,
             AVG(CASE WHEN COALESCE(qty_sold_12m_avg,0) > 0
                      THEN ABS(forecast_qty - qty_sold_12m_avg) / qty_sold_12m_avg
                      ELSE NULL END) AS proxy
      FROM demand_forecast_detail
      ${whereSid}
      GROUP BY item_code, segment
    `, params);

    let dormant = 0, noHistory = 0, highAccProxy = 0, ok = 0, unused = 0;
    const bySegSum: Record<string, { sum: number; n: number }> = {};
    let proxySum = 0, proxyN = 0;
    const proxyValues: number[] = [];

    for (const r of accRows) {
      const total = Number(r.total_forecast) || 0;
      const avg12 = Number(r.avg_12m) || 0;
      const proxy = Number(r.proxy);
      const seg = r.segment || 'Unknown';

      // D2 FIX: Tighten classification buckets.
      //   dormant       = zero forecast BUT had sales history (true MISS — planner alert)
      //   noHistory     = has forecast BUT no sales history (cold start)
      //   unused        = both zero (not dormant, not a risk — usually filtered upstream)
      //   highAccProxy  = forecast + history diverge > 30% (quality alert)
      //   ok            = rest
      if (total === 0 && avg12 > 0) dormant++;
      else if (total === 0 && avg12 === 0) unused++;
      else if (avg12 === 0) noHistory++;
      else if (isFinite(proxy) && proxy > 0.30) highAccProxy++;
      else ok++;

      // D1 FIX: Only count proxy for items with BOTH forecast and history > 0.
      // Previously items with forecast=0 + history>0 contributed proxy = 1.0 (100%),
      // inflating avg to ~99% when dormant items dominated.
      if (total > 0 && avg12 > 0 && isFinite(proxy) && !isNaN(proxy)) {
        proxySum += proxy; proxyN++; proxyValues.push(proxy);
        if (!bySegSum[seg]) bySegSum[seg] = { sum: 0, n: 0 };
        bySegSum[seg].sum += proxy; bySegSum[seg].n++;
      }
    }

    const bySegment: Record<string, number> = {};
    for (const [seg, v] of Object.entries(bySegSum)) {
      bySegment[seg] = Math.round((v.sum / v.n) * 1000) / 10;
    }
    proxyValues.sort((a, b) => a - b);
    const median = proxyValues.length > 0
      ? proxyValues[Math.floor(proxyValues.length / 2)]
      : 0;

    // Bug-4 FE gauges: real avg panel_months + distinct combo classes count.
    const metaRows = await manager.query(`
      SELECT AVG(NULLIF(panel_months, 0))::float AS "panelMonthsAvg",
             COUNT(DISTINCT combo_class) FILTER (WHERE combo_class IS NOT NULL)::int AS "combosDistinct",
             COUNT(DISTINCT segment) FILTER (WHERE segment IS NOT NULL)::int AS "segmentsDistinct"
      FROM demand_forecast_detail
      ${whereSid}
    `, params);
    const meta = metaRows[0] || {};

    return {
      confidence: {
        avgSpreadPct,
        tight: { count: tight, label: '<5% spread' },
        medium: { count: medium, label: '5-20% spread' },
        wide: { count: wide, label: '>20% spread' },
      },
      alerts: {
        highAccProxy: { count: highAccProxy, label: 'Items with proxy deviation > 30%' },
        dormant: { count: dormant, label: 'Items with zero forecast (all periods)' },
        noHistory: { count: noHistory, label: 'Items with no sales history (cold start)' },
        ok: { count: ok, label: 'Items with acceptable forecast quality' },
      },
      accuracyProxy: {
        avgPct: proxyN > 0 ? Math.round((proxySum / proxyN) * 1000) / 10 : 0,
        medianPct: Math.round(median * 1000) / 10,
        bySegment,
      },
      // Gauge meta (Tab 1 DataQualityGauges — real values, not hardcoded)
      dataMeta: {
        panelMonthsAvg: meta.panelMonthsAvg !== null ? Number(meta.panelMonthsAvg) : null,
        combosDistinct: Number(meta.combosDistinct) || 0,
        segmentsDistinct: Number(meta.segmentsDistinct) || 0,
      },
    };
  }

  // ── BE-I3: Zero Forecast Alerts ─────────────────────────

  async getAlerts(snapshotId: string | undefined, page: number, pageSize: number) {
    const manager = this.detailRepo.manager;
    const whereSid = snapshotId ? 'AND snapshot_id = $1' : '';
    const params = snapshotId ? [snapshotId] : [];

    // Aggregate per item: sum forecast=0 AND history>0
    const rows = await manager.query(`
      SELECT item_code AS "itemCode",
             MAX(segment) AS segment,
             MAX(combo_class) AS "comboClass",
             AVG(qty_sold_12m_avg)::float AS "qtySold12mAvg",
             AVG(qty_sold_3m_avg)::float AS "qtySold3mAvg",
             SUM(forecast_qty)::float AS "forecastQty",
             COUNT(*) FILTER (WHERE forecast_qty = 0)::int AS "periodsWithZero"
      FROM demand_forecast_detail
      WHERE COALESCE(qty_sold_12m_avg, 0) > 0 ${whereSid}
      GROUP BY item_code
      HAVING SUM(forecast_qty) = 0
      ORDER BY AVG(qty_sold_12m_avg) DESC
    `, params);

    const withSeverity = rows.map((r: any) => {
      const avg12 = Number(r.qtySold12mAvg) || 0;
      const seg = r.segment || 'C';
      let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' = 'MEDIUM';
      if (seg === 'A' && avg12 > 1000) severity = 'CRITICAL';
      else if ((seg === 'A' || seg === 'B') && avg12 > 500) severity = 'HIGH';
      return {
        itemCode: r.itemCode,
        segment: seg,
        comboClass: r.comboClass || 'OTHER',
        qtySold12mAvg: Number(r.qtySold12mAvg) || 0,
        qtySold3mAvg: Number(r.qtySold3mAvg) || 0,
        forecastQty: 0,
        periodsWithZero: Number(r.periodsWithZero) || 0,
        severity,
      };
    });

    // Sort by severity rank then avg desc
    const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
    withSeverity.sort((a: any, b: any) => {
      if (rank[a.severity] !== rank[b.severity]) return rank[a.severity] - rank[b.severity];
      return b.qtySold12mAvg - a.qtySold12mAvg;
    });

    const total = withSeverity.length;
    const start = (page - 1) * pageSize;
    const data = withSeverity.slice(start, start + pageSize);

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      summary: {
        totalAlerts: total,
        critical: withSeverity.filter((x: any) => x.severity === 'CRITICAL').length,
        high: withSeverity.filter((x: any) => x.severity === 'HIGH').length,
        medium: withSeverity.filter((x: any) => x.severity === 'MEDIUM').length,
      },
    };
  }

  // ── R9: Branch summary (drill-down on row expand) ──

  async getBranchSummary(snapshotId: string | undefined, locationCode: string) {
    const manager = this.detailRepo.manager;
    const params: any[] = [locationCode];
    let idx = 2;
    const snapFilter = snapshotId ? `AND snapshot_id = $${idx++}` : '';
    if (snapshotId) params.push(snapshotId);

    // Header: total qty + item count + top segment
    const hdrRows = await manager.query(`
      SELECT l.location_code AS "locationCode",
             MAX(loc.location_name) AS "locationName",
             MAX(loc.region) AS region,
             COUNT(DISTINCT l.item_code)::int AS "itemCount",
             SUM(l.qty)::float AS "totalQty"
      FROM demand_snapshot_line l
      LEFT JOIN location loc ON loc.location_code = l.location_code
      WHERE l.location_code = $1 ${snapFilter}
      GROUP BY l.location_code
    `, params);
    const hdr = hdrRows[0] || {};

    // By period
    const byPeriod = await manager.query(`
      SELECT TO_CHAR(period_start, 'YYYY-MM') AS period,
             SUM(qty)::float AS qty
      FROM demand_snapshot_line
      WHERE location_code = $1 ${snapFilter}
      GROUP BY period_start ORDER BY period_start
    `, params);

    // By segment
    const bySegment = await manager.query(`
      SELECT segment, SUM(qty)::float AS qty, COUNT(DISTINCT item_code)::int AS items
      FROM demand_snapshot_line
      WHERE location_code = $1 ${snapFilter}
      GROUP BY segment ORDER BY qty DESC
    `, params);

    // Top 10 SKUs
    const topSkus = await manager.query(`
      SELECT item_code AS "itemCode", MAX(segment) AS segment,
             SUM(qty)::float AS "totalQty"
      FROM demand_snapshot_line
      WHERE location_code = $1 ${snapFilter}
      GROUP BY item_code
      ORDER BY "totalQty" DESC
      LIMIT 10
    `, params);

    return {
      header: {
        locationCode: hdr.locationCode || locationCode,
        locationName: decodeUnicodeEscapes(hdr.locationName) || locationCode,
        region: decodeUnicodeEscapes(hdr.region) || null,
        itemCount: Number(hdr.itemCount) || 0,
        totalQty: Number(hdr.totalQty) || 0,
      },
      byPeriod: byPeriod.map((r: any) => ({ period: r.period, qty: Number(r.qty) || 0 })),
      bySegment: bySegment.map((r: any) => ({
        segment: r.segment || 'Unknown',
        qty: Number(r.qty) || 0,
        items: Number(r.items) || 0,
      })),
      topSkus: topSkus.map((r: any) => ({
        itemCode: r.itemCode,
        segment: r.segment || null,
        totalQty: Number(r.totalQty) || 0,
      })),
    };
  }

  // ── R3: Branch-level FSKU pivot (item × location, pivot by period) ──

  async getBranchPivot(
    snapshotId: string | undefined,
    locationCode: string | undefined,
    page: number,
    pageSize: number,
    itemQuery: string | undefined,
  ) {
    const manager = this.detailRepo.manager;
    const params: any[] = [];
    let idx = 1;
    const where: string[] = [];
    if (snapshotId) { where.push(`snapshot_id = $${idx++}`); params.push(snapshotId); }
    if (locationCode) { where.push(`location_code = $${idx++}`); params.push(locationCode); }
    if (itemQuery) { where.push(`item_code ILIKE $${idx++}`); params.push(`%${itemQuery}%`); }

    const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // R11: JOIN location for name. Aggregate per (item, location, period).
    // Note: snapshot_line may not have WHERE prefix — build w/ table alias.
    const wl = whereSql
      ? whereSql.replace(/\b(snapshot_id|location_code|item_code)\b/g, 'l.$1')
      : '';
    const groupRows = await manager.query(`
      SELECT l.item_code AS "itemCode", l.location_code AS "locationCode",
             MAX(loc.location_name) AS "locationName",
             MAX(l.segment) AS segment,
             TO_CHAR(l.period_start, 'YYYY-MM') AS period,
             SUM(l.qty)::float AS qty
      FROM demand_snapshot_line l
      LEFT JOIN location loc ON loc.location_code = l.location_code
      ${wl}
      GROUP BY l.item_code, l.location_code, l.period_start
      ORDER BY l.item_code, l.location_code, l.period_start
    `, params);

    // Pivot
    const map = new Map<string, any>();
    for (const r of groupRows) {
      const k = `${r.itemCode}__${r.locationCode}`;
      let entry = map.get(k);
      if (!entry) {
        entry = {
          itemCode: r.itemCode,
          locationCode: r.locationCode,
          locationName: decodeUnicodeEscapes(r.locationName) || r.locationCode,
          segment: r.segment || null,
          periods: {} as Record<string, number>,
          total: 0,
        };
        map.set(k, entry);
      }
      entry.periods[r.period] = Number(r.qty);
      entry.total += Number(r.qty);
    }
    const all = Array.from(map.values()).sort((a, b) => b.total - a.total);
    const total = all.length;
    const offset = (page - 1) * pageSize;
    const data = all.slice(offset, offset + pageSize);

    // Detect available period columns from current page
    const allPeriods = new Set<string>();
    for (const r of data) for (const p of Object.keys(r.periods)) allPeriods.add(p);
    const periods = Array.from(allPeriods).sort();

    return {
      data,
      periods,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // ── I-6: Branch × Period heatmap ──────────────────────────

  async getBranchHeatmap(snapshotId?: string) {
    const mgr = this.detailRepo.manager;

    // Get the snapshot to use
    let sid = snapshotId;
    if (!sid) {
      const latest = await mgr.query(`
        SELECT snapshot_id FROM demand_snapshot
        WHERE status = 'FROZEN'
        ORDER BY frozen_at DESC NULLS LAST, created_at DESC
        LIMIT 1
      `).catch(() => []);
      sid = latest[0]?.snapshot_id;
    }
    if (!sid) return { branches: [], periods: [] };

    const rows = await mgr.query(`
      SELECT
        l.location_code AS "branchCode",
        COALESCE(loc.location_name, l.location_code) AS "branchName",
        TO_CHAR(l.period_start, 'YYYY-MM') AS period,
        SUM(l.forecast_qty)::float AS qty
      FROM demand_snapshot_line l
      LEFT JOIN location loc ON loc.location_code = l.location_code
      WHERE l.snapshot_id = $1
      GROUP BY l.location_code, loc.location_name, period_start
      ORDER BY l.location_code, period_start
    `, [sid]);

    // Pivot into { branchCode, branchName, periods: { 'YYYY-MM': qty } }
    const branchMap = new Map<string, { branchCode: string; branchName: string; periods: Record<string, number>; total: number }>();
    const periodsSet = new Set<string>();
    for (const r of rows) {
      periodsSet.add(r.period);
      if (!branchMap.has(r.branchCode)) {
        branchMap.set(r.branchCode, { branchCode: r.branchCode, branchName: r.branchName, periods: {}, total: 0 });
      }
      const b = branchMap.get(r.branchCode)!;
      b.periods[r.period] = Number(r.qty);
      b.total += Number(r.qty);
    }

    const periods = Array.from(periodsSet).sort();
    const branches = Array.from(branchMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 30); // top 30 branches for readability

    return { branches, periods };
  }

  // ── BE-I4: Branch Breakdown ─────────────────────────────

  async getBranches(snapshotId: string | undefined, page: number, pageSize: number) {
    const manager = this.detailRepo.manager;
    const whereSid = snapshotId ? 'WHERE l.snapshot_id = $1' : '';
    const params = snapshotId ? [snapshotId] : [];

    // Senior review fix: use snapshot_line JOIN location (detail table often empty).
    // Tet month fallback: EXTRACT(MONTH) IN (1,2,3) when tet_flag NULL.
    const rows = await manager.query(`
      SELECT l.location_code AS "locationCode",
             MAX(loc.location_name) AS "locationName",
             MAX(loc.region) AS region,
             MAX(COALESCE(l.branch_archetype, loc.location_type, 'UNKNOWN')) AS "branchArchetype",
             COUNT(DISTINCT l.item_code)::int AS "itemCount",
             SUM(l.qty)::float AS "totalQty",
             SUM(CASE WHEN UPPER(COALESCE(l.tet_flag,'')) = 'Y'
                        OR EXTRACT(MONTH FROM l.period_start) IN (1,2,3)
                      THEN l.qty ELSE 0 END)::float AS "tetQty",
             SUM(CASE WHEN NOT (UPPER(COALESCE(l.tet_flag,'')) = 'Y'
                                 OR EXTRACT(MONTH FROM l.period_start) IN (1,2,3))
                      THEN l.qty ELSE 0 END)::float AS "nonTetQty"
      FROM demand_snapshot_line l
      LEFT JOIN location loc ON l.location_code = loc.location_code
      ${whereSid}
      GROUP BY l.location_code
      ORDER BY "totalQty" DESC NULLS LAST
    `, params);

    // Top segment per branch — also from snapshot_line
    const segRows = await manager.query(`
      SELECT location_code, segment, SUM(qty)::float AS qty
      FROM demand_snapshot_line
      ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
      GROUP BY location_code, segment
    `, params);
    const topSeg: Record<string, { seg: string; qty: number }> = {};
    for (const r of segRows) {
      const loc = r.location_code;
      const qty = Number(r.qty) || 0;
      if (!topSeg[loc] || qty > topSeg[loc].qty) topSeg[loc] = { seg: r.segment || 'C', qty };
    }

    const data = rows.map((r: any) => ({
      locationCode: r.locationCode,
      locationName: decodeUnicodeEscapes(r.locationName) || r.locationCode,
      region: decodeUnicodeEscapes(r.region) || 'Unknown',
      branchArchetype: r.branchArchetype || 'UNKNOWN',
      itemCount: Number(r.itemCount) || 0,
      totalQty: Number(r.totalQty) || 0,
      topSegment: topSeg[r.locationCode]?.seg || 'C',
      tetQty: Number(r.tetQty) || 0,
      nonTetQty: Number(r.nonTetQty) || 0,
    }));

    const total = data.length;
    const pageData = data.slice((page - 1) * pageSize, page * pageSize);

    // byArchetype summary
    const archMap: Record<string, { branchCount: number; totalQty: number }> = {};
    for (const r of data) {
      const a = r.branchArchetype;
      if (!archMap[a]) archMap[a] = { branchCount: 0, totalQty: 0 };
      archMap[a].branchCount++;
      archMap[a].totalQty += r.totalQty;
    }
    const byArchetype = Object.entries(archMap)
      .map(([archetype, v]) => ({ archetype, ...v }))
      .sort((a, b) => b.totalQty - a.totalQty);

    return {
      data: pageData,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      byArchetype,
    };
  }
}
