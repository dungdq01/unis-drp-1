import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * M28 — Dashboard read-side (US-16, US-17).
 * Queries weekly_kpi_snapshot (cached results — KHÔNG recompute).
 * Dashboard load < 3s (NFR-F2B8-001).
 */
@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getDashboard(weekStart?: string) {
    // Default to latest completed snapshot
    const snapshotRows = await this.dataSource.query(
      `SELECT * FROM weekly_kpi_snapshot
       WHERE status IN ('COMPLETED','COMPLETED_PARTIAL')
         AND ($1::date IS NULL OR week_start_date = $1::date)
       ORDER BY week_start_date DESC
       LIMIT 1`,
      [weekStart ?? null],
    );
    const current = snapshotRows[0] ?? null;
    if (!current) return { current: null, previous: null, alerts: [], overrideAnalysis: null };

    // Previous week for trend arrows
    const prevDate = new Date(new Date(current.week_start_date).getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const prevRows = await this.dataSource.query(
      `SELECT * FROM weekly_kpi_snapshot
       WHERE week_start_date = $1 AND status IN ('COMPLETED','COMPLETED_PARTIAL')
       LIMIT 1`,
      [prevDate],
    );
    const previous = prevRows[0] ?? null;

    // Override analysis for this week
    const overrideRows = await this.dataSource.query(
      `SELECT * FROM override_analysis WHERE weekly_snapshot_id = $1 LIMIT 1`,
      [current.id],
    );

    // SS adjustment history (last 4 weeks)
    const ssHistory = await this.dataSource.query(
      `SELECT sal.cn_id, sal.sku_id, sal.ss_old, sal.ss_new_applied, sal.delta_pct, sal.is_capped,
              wks.week_start_date
       FROM ss_adjustment_log sal
       JOIN weekly_kpi_snapshot wks ON wks.id = sal.weekly_snapshot_id
       WHERE wks.week_start_date >= ($1::date - INTERVAL '4 weeks')
         AND wks.status IN ('COMPLETED','COMPLETED_PARTIAL')
       ORDER BY wks.week_start_date DESC, sal.cn_id, sal.sku_id`,
      [current.week_start_date],
    );

    // LT drift table
    const ltDrift = await this.dataSource.query(
      `SELECT lal.entity_code, lal.lt_old_days, lal.lt_actual_avg_days, lal.drift_pct,
              lal.action, lal.drift_count_after, wks.week_start_date
       FROM lt_actual_log lal
       JOIN weekly_kpi_snapshot wks ON wks.id = lal.weekly_snapshot_id
       WHERE lal.weekly_snapshot_id = $1
       ORDER BY lal.drift_pct DESC`,
      [current.id],
    );

    // Build alerts
    const alerts: string[] = [];
    if (current.step_errors?.length) {
      alerts.push(`COMPLETED_PARTIAL: ${current.step_errors.map((e: { step: string }) => e.step).join(', ')} failed`);
    }
    if (current.fill_rate_pct != null && previous?.fill_rate_pct != null) {
      if (current.fill_rate_pct < 0.85 && previous.fill_rate_pct < 0.85) {
        alerts.push(`FILL_RATE_LOW: 2 consecutive weeks < 85% (${(current.fill_rate_pct * 100).toFixed(1)}%, ${(previous.fill_rate_pct * 100).toFixed(1)}%)`);
      }
    }

    return {
      current,
      previous,
      alerts,
      overrideAnalysis: overrideRows[0] ?? null,
      ssAdjustmentHistory: ssHistory,
      ltDriftTable: ltDrift,
    };
  }

  async getDrillDown(metric: string, cnId?: string, skuId?: string) {
    if (metric === 'fill_rate') {
      return this.dataSource.query(
        `SELECT ph.cn_id, pl.sku_id,
                date_trunc('week', ph.confirmed_at)::date AS week_start,
                SUM(pl.actual_received_qty)::float AS actual,
                SUM(pl.confirmed_qty)::float AS confirmed,
                (SUM(pl.actual_received_qty)::float / NULLIF(SUM(pl.confirmed_qty), 0)) AS fill_rate
         FROM po_line pl
         JOIN po_header ph ON ph.id = pl.po_header_id
         WHERE ph.status IN ('RECEIVED','CLOSED')
           AND ($1::bigint IS NULL OR ph.cn_id = $1::bigint)
           AND ($2::bigint IS NULL OR pl.sku_id = $2::bigint)
         GROUP BY ph.cn_id, pl.sku_id, week_start
         ORDER BY week_start DESC
         LIMIT 200`,
        [cnId ?? null, skuId ?? null],
      );
    }
    return [];
  }

  async getSsAdjustments(cnId?: string, skuId?: string, fromWeek?: string, toWeek?: string) {
    return this.dataSource.query(
      `SELECT sal.*, wks.week_start_date
       FROM ss_adjustment_log sal
       JOIN weekly_kpi_snapshot wks ON wks.id = sal.weekly_snapshot_id
       WHERE ($1::bigint IS NULL OR sal.cn_id  = $1::bigint)
         AND ($2::bigint IS NULL OR sal.sku_id = $2::bigint)
         AND ($3::date IS NULL   OR wks.week_start_date >= $3::date)
         AND ($4::date IS NULL   OR wks.week_start_date <= $4::date)
       ORDER BY wks.week_start_date DESC, sal.cn_id, sal.sku_id`,
      [cnId ?? null, skuId ?? null, fromWeek ?? null, toWeek ?? null],
    );
  }

  async getLtUpdates(nmCode?: string, fromDate?: string, toDate?: string) {
    return this.dataSource.query(
      `SELECT lal.*, wks.week_start_date
       FROM lt_actual_log lal
       JOIN weekly_kpi_snapshot wks ON wks.id = lal.weekly_snapshot_id
       WHERE ($1::text IS NULL OR lal.entity_code LIKE $1::text || '%')
         AND ($2::date IS NULL OR wks.week_start_date >= $2::date)
         AND ($3::date IS NULL OR wks.week_start_date <= $3::date)
       ORDER BY wks.week_start_date DESC, lal.drift_pct DESC`,
      [nmCode ?? null, fromDate ?? null, toDate ?? null],
    );
  }

  async getOverrides(week?: string) {
    return this.dataSource.query(
      `SELECT oa.*, wks.week_start_date
       FROM override_analysis oa
       JOIN weekly_kpi_snapshot wks ON wks.id = oa.weekly_snapshot_id
       WHERE ($1::date IS NULL OR wks.week_start_date = $1::date)
       ORDER BY wks.week_start_date DESC
       LIMIT 20`,
      [week ?? null],
    );
  }
}
