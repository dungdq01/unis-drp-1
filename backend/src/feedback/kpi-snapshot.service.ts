import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * M28 Step 8 — KPI Snapshot (R7 stub MAPE, R8 fill rate alert).
 *
 * Computes weekly metrics and updates weekly_kpi_snapshot row.
 * Phase 1: fc_mape = NULL (no actual_sales table).
 */
@Injectable()
export class KpiSnapshotService {
  private readonly logger = new Logger(KpiSnapshotService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run(snapshotId: string, weekStart: string): Promise<{
    fillRatePct: number | null;
    systemAccuracyPct: number | null;
    nmHonoringAvgPct: number | null;
  }> {
    const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    // fill_rate: Σ actual_received / Σ confirmed_qty from M27 RECEIVED/CLOSED POs
    const fillRows: Array<{ fill: string | null }> = await this.dataSource.query(
      `SELECT (SUM(pl.actual_received_qty)::float / NULLIF(SUM(pl.confirmed_qty), 0))::text AS fill
       FROM po_line pl
       JOIN po_header ph ON ph.id = pl.po_header_id
       WHERE ph.status IN ('RECEIVED','CLOSED')
         AND ph.confirmed_at >= $1 AND ph.confirmed_at < $2`,
      [weekStart, weekEnd],
    );
    const fillRatePct = fillRows[0]?.fill != null ? Number(fillRows[0].fill) : null;

    // lcnb_util: CN_REDIST legs / total allocation legs
    const lcnbRows: Array<{ util: string | null }> = await this.dataSource.query(
      `SELECT (COUNT(*) FILTER (WHERE source_type = 'CN_REDIST')::float / NULLIF(COUNT(*), 0))::text AS util
       FROM allocation_result
       WHERE created_at >= $1 AND created_at < $2`,
      [weekStart, weekEnd],
    );
    const lcnbUtilPct = lcnbRows[0]?.util != null ? Number(lcnbRows[0].util) : null;

    // transport_fill_avg
    const fillAvgRows: Array<{ avg: string | null }> = await this.dataSource.query(
      `SELECT AVG(fill_ratio)::text AS avg
       FROM transport_trip
       WHERE created_at >= $1 AND created_at < $2`,
      [weekStart, weekEnd],
    );
    const transportFillAvg = fillAvgRows[0]?.avg != null ? Number(fillAvgRows[0].avg) : null;

    // system_accuracy: 1 - (distinct POs with any edit / total POs)
    const accuracyRows: Array<{ pct: string | null }> = await this.dataSource.query(
      `SELECT (1 - (COUNT(DISTINCT pel.po_header_id)::float / NULLIF((
           SELECT COUNT(*) FROM po_header ph2
           WHERE ph2.confirmed_at >= $1 AND ph2.confirmed_at < $2
         ), 0)))::text AS pct
       FROM po_edit_log pel
       JOIN po_header ph ON ph.id = pel.po_header_id
       WHERE ph.confirmed_at >= $1 AND ph.confirmed_at < $2`,
      [weekStart, weekEnd],
    );
    const systemAccuracyPct = accuracyRows[0]?.pct != null ? Number(accuracyRows[0].pct) : null;

    // nm_honoring_avg: AVG rate from nm_honoring_rate (recent month)
    const honoringRows: Array<{ avg: string | null }> = await this.dataSource.query(
      `SELECT AVG(rate)::text AS avg
       FROM nm_honoring_rate
       WHERE period_month = date_trunc('month', $1::date)`,
      [weekStart],
    );
    const nmHonoringAvgPct = honoringRows[0]?.avg != null ? Number(honoringRows[0].avg) : null;

    // PO/TO counts
    const poCountRow: Array<{ total: number; edited: number }> = await this.dataSource.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(DISTINCT pel.po_header_id)::int AS edited
       FROM po_header ph
       LEFT JOIN po_edit_log pel ON pel.po_header_id = ph.id
       WHERE ph.confirmed_at >= $1 AND ph.confirmed_at < $2`,
      [weekStart, weekEnd],
    );
    const toCountRow: Array<{ total: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM to_header WHERE confirmed_at >= $1 AND confirmed_at < $2`,
      [weekStart, weekEnd],
    );

    await this.dataSource.query(
      `UPDATE weekly_kpi_snapshot SET
         fc_mape_pct          = NULL,
         fill_rate_pct        = $2,
         lcnb_util_pct        = $3,
         transport_fill_avg   = $4,
         system_accuracy_pct  = $5,
         nm_honoring_avg_pct  = $6,
         total_po_count       = $7,
         edited_po_count      = $8,
         total_to_count       = $9
       WHERE id = $1`,
      [
        snapshotId,
        fillRatePct, lcnbUtilPct, transportFillAvg,
        systemAccuracyPct, nmHonoringAvgPct,
        poCountRow[0]?.total ?? 0,
        poCountRow[0]?.edited ?? 0,
        toCountRow[0]?.total ?? 0,
      ],
    );

    this.logger.log(
      `[KPI-Snapshot] week=${weekStart}: fill=${fillRatePct?.toFixed(3)}, accuracy=${systemAccuracyPct?.toFixed(3)}, honoring=${nmHonoringAvgPct?.toFixed(3)}`,
    );
    return { fillRatePct, systemAccuracyPct, nmHonoringAvgPct };
  }
}
