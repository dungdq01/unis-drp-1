import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * M26 §8 — Honoring Rate cron (R7/R8/H3/M4 CTO fixes).
 *
 * Cron: 1st of month, 06:00 VN.
 * Phase 1: INSERT row with fulfilled_total=NULL, rate=NULL — infrastructure ready,
 *           compute skipped until M27 actual_delivered data available.
 * Phase 2: Full compute auto-unblocked when po_line.actual_received_qty has data.
 *
 * R7/C4: rate = fulfilled_total / atp_at_check_total (NOT requested_total — PRD F2-B6/F2-B8).
 * R8/H3: rolling_3m_rate < 0.80 → nm_unreliable_badge=TRUE + alert.
 */
@Injectable()
export class HonoringRateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HonoringRateService.name);
  private _cronTimer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    this._scheduleMonthlyHonoringCron();
  }

  private _scheduleMonthlyHonoringCron(): void {
    // Fire at 06:00 VN on day 1 of next month.
    const msUntil = this._msUntilFirstOfMonth();
    this._cronTimer = setTimeout(async () => {
      try {
        const result = await this.computeMonthly();
        this.logger.log(
          `[CRON 1st/month] honoring-rate computed: ${result.nmCount} NMs, ${result.unreliableCount} unreliable`,
        );
      } catch (err) {
        this.logger.error(`[CRON 1st/month] honoring-rate failed: ${(err as Error).message}`);
      } finally {
        this._scheduleMonthlyHonoringCron();
      }
    }, msUntil);
  }

  /**
   * Compute honoring rate for previous month.
   * Phase 1: INSERT with NULL rate (M27 data not yet ready).
   * Phase 2: Full compute when po_line.actual_received_qty available.
   */
  async computeMonthly(targetMonthIso?: string): Promise<{ nmCount: number; unreliableCount: number }> {
    const periodMonth = targetMonthIso
      ? targetMonthIso.slice(0, 7) + '-01'
      : this._prevMonthFirstDay();

    // Check if M27 actual_received data exists (Phase 1 vs Phase 2 guard)
    const phase2Available = await this._checkPhase2DataAvailable(periodMonth);

    // Get all active NMs that had ATP checks this month
    const nmRows: Array<{ nm_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT ac.nm_id::text
       FROM atp_check ac
       WHERE ac.checked_at >= $1::date
         AND ac.checked_at < ($1::date + INTERVAL '1 month')
         AND ac.result IN ('PASS','PARTIAL')`,
      [periodMonth],
    );

    let unreliableCount = 0;

    for (const row of nmRows) {
      const nmId = row.nm_id;

      // Aggregate atp_check stats for this NM this month (C4 fix — PASS+PARTIAL only)
      const statsRows: Array<{
        atp_total: number; req_total: number;
        cell_count: number; partial_count: number; fail_count: number; blocked_count: number;
      }> = await this.dataSource.query(
        `SELECT
           SUM(CASE WHEN result IN ('PASS','PARTIAL') THEN COALESCE(atp_qty, 0) ELSE 0 END)::float AS atp_total,
           SUM(requested_qty)::float AS req_total,
           COUNT(*)::int AS cell_count,
           SUM(CASE WHEN result='PARTIAL' THEN 1 ELSE 0 END)::int AS partial_count,
           SUM(CASE WHEN result='FAIL' THEN 1 ELSE 0 END)::int AS fail_count,
           SUM(CASE WHEN result='BLOCKED' THEN 1 ELSE 0 END)::int AS blocked_count
         FROM atp_check
         WHERE nm_id = $1
           AND checked_at >= $2::date
           AND checked_at < ($2::date + INTERVAL '1 month')`,
        [nmId, periodMonth],
      );
      const stats = statsRows[0];

      let fulfilledTotal: number | null = null;
      let rate: number | null = null;
      let rolling3mRate: number | null = null;

      if (phase2Available && Number(stats.atp_total) > 0) {
        // Phase 2: compute using M27 po_line.actual_received_qty
        const fulfilledRows: Array<{ fulfilled: number }> = await this.dataSource.query(
          `SELECT COALESCE(SUM(pl.actual_received_qty), 0)::float AS fulfilled
           FROM po_line pl
           WHERE pl.nm_id = $1
             AND pl.delivered_at >= $2::date
             AND pl.delivered_at < ($2::date + INTERVAL '1 month')`,
          [nmId, periodMonth],
        );
        fulfilledTotal = Number(fulfilledRows[0]?.fulfilled ?? 0);
        rate = fulfilledTotal / Number(stats.atp_total);

        // Rolling 3-month rate (H3 fix — correct window for PRD 80% threshold)
        const rolling3mRows: Array<{ r3m: number | null }> = await this.dataSource.query(
          `SELECT AVG(rate)::float AS r3m
           FROM nm_honoring_rate
           WHERE nm_id = $1
             AND period_month >= ($2::date - INTERVAL '2 months')
             AND period_month < $2::date
             AND rate IS NOT NULL`,
          [nmId, periodMonth],
        );
        const prevAvg = rolling3mRows[0]?.r3m ?? null;
        rolling3mRate = prevAvg !== null
          ? (prevAvg * 2 + rate) / 3  // include current month in 3-month average
          : rate;
      } else {
        this.logger.log(
          `[honoring-rate] NM #${nmId} period ${periodMonth}: Phase 1 — pending M27 actual_delivered data`,
        );
      }

      // Upsert nm_honoring_rate
      await this.dataSource.query(
        `INSERT INTO nm_honoring_rate
           (nm_id, period_month, atp_at_check_total, requested_total, fulfilled_total,
            rate, rolling_3m_rate, cell_count, partial_count, fail_count, blocked_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (nm_id, period_month) DO UPDATE SET
           atp_at_check_total = EXCLUDED.atp_at_check_total,
           requested_total    = EXCLUDED.requested_total,
           fulfilled_total    = EXCLUDED.fulfilled_total,
           rate               = EXCLUDED.rate,
           rolling_3m_rate    = EXCLUDED.rolling_3m_rate,
           cell_count         = EXCLUDED.cell_count,
           partial_count      = EXCLUDED.partial_count,
           fail_count         = EXCLUDED.fail_count,
           blocked_count      = EXCLUDED.blocked_count,
           calculated_at      = NOW()`,
        [
          nmId, periodMonth,
          stats.atp_total, stats.req_total, fulfilledTotal,
          rate, rolling3mRate,
          stats.cell_count, stats.partial_count, stats.fail_count, stats.blocked_count,
        ],
      );

      // R8/H3: badge + alert when rolling_3m_rate < 0.80 (PRD threshold)
      if (rolling3mRate !== null && rolling3mRate < 0.80) {
        await this.dataSource.query(
          `UPDATE supplier SET nm_unreliable_badge = TRUE WHERE id = $1`,
          [nmId],
        );
        this.logger.warn(
          `[honoring-rate] NM #${nmId} rolling 3m rate ${(rolling3mRate * 100).toFixed(1)}% < 80% → nm_unreliable_badge=TRUE (alert M8)`,
        );
        unreliableCount++;
      } else if (rolling3mRate !== null) {
        // Clear badge if rate recovered
        await this.dataSource.query(
          `UPDATE supplier SET nm_unreliable_badge = FALSE WHERE id = $1`,
          [nmId],
        );
      }
    }

    return { nmCount: nmRows.length, unreliableCount };
  }

  /**
   * M28 Step 6 entry point (M1 CTO sweep — mode coordination).
   *   mode='monthly_full'   : M26 monthly cron — create/upsert row + full compute for period_month.
   *   mode='weekly_rolling' : M28 weekly — only UPDATE rolling_3m_rate for last 3 months (KHÔNG create row).
   * Race-safe: both modes share single method, mode parameter selects behavior branch.
   */
  async recompute(
    month: string,
    mode: 'monthly_full' | 'weekly_rolling',
  ): Promise<{ nmCount: number; unreliableCount: number }> {
    if (mode === 'monthly_full') {
      return this.computeMonthly(month);
    }

    // weekly_rolling: update rolling_3m_rate for last 3 months for all NMs
    const monthsToRefresh: string[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(month);
      d.setUTCMonth(d.getUTCMonth() - i);
      monthsToRefresh.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`);
    }

    let unreliableCount = 0;
    const nmRows: Array<{ nm_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT nm_id::text FROM nm_honoring_rate`,
    );

    for (const { nm_id } of nmRows) {
      for (const periodMonth of monthsToRefresh) {
        const rolling3mRows: Array<{ r3m: number | null }> = await this.dataSource.query(
          `SELECT AVG(rate)::float AS r3m
           FROM nm_honoring_rate
           WHERE nm_id = $1
             AND period_month >= ($2::date - INTERVAL '2 months')
             AND period_month <= $2::date
             AND rate IS NOT NULL`,
          [nm_id, periodMonth],
        );
        const rolling3mRate = rolling3mRows[0]?.r3m ?? null;
        if (rolling3mRate === null) continue;

        await this.dataSource.query(
          `UPDATE nm_honoring_rate
             SET rolling_3m_rate = $3, calculated_at = NOW()
           WHERE nm_id = $1 AND period_month = $2`,
          [nm_id, periodMonth, rolling3mRate],
        );

        // R8/H3 badge check on latest month
        if (periodMonth === monthsToRefresh[0]) {
          if (rolling3mRate < 0.80) {
            await this.dataSource.query(
              `UPDATE supplier SET nm_unreliable_badge = TRUE WHERE id = $1`, [nm_id],
            );
            this.logger.warn(`[recompute-weekly] NM #${nm_id} rolling_3m=${(rolling3mRate * 100).toFixed(1)}% < 80% → badge=TRUE`);
            unreliableCount++;
          } else {
            await this.dataSource.query(
              `UPDATE supplier SET nm_unreliable_badge = FALSE WHERE id = $1`, [nm_id],
            );
          }
        }
      }
    }

    return { nmCount: nmRows.length, unreliableCount };
  }

  private async _checkPhase2DataAvailable(periodMonth: string): Promise<boolean> {
    // Phase 2 check: po_line.actual_received_qty column exists and has data for period
    try {
      const rows: Array<{ cnt: string }> = await this.dataSource.query(
        `SELECT COUNT(*)::text AS cnt FROM po_line
         WHERE delivered_at >= $1::date AND delivered_at < ($1::date + INTERVAL '1 month')
           AND actual_received_qty IS NOT NULL
         LIMIT 1`,
        [periodMonth],
      );
      return parseInt(rows[0]?.cnt ?? '0') > 0;
    } catch {
      return false; // po_line table or column doesn't exist yet (Phase 1)
    }
  }

  private _prevMonthFirstDay(): string {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return first.toISOString().slice(0, 10);
  }

  private _msUntilFirstOfMonth(): number {
    // Next 1st of month at 06:00 VN (UTC+7 = 23:00 UTC previous day)
    const nowMs = Date.now();
    const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000);
    let year = vnNow.getUTCFullYear();
    let month = vnNow.getUTCMonth() + 2; // +1 convert 0→1-indexed, +1 advance to NEXT month
    if (month > 12) { month = 1; year++; }
    // 06:00 VN = -1 on hh-7 approach: hh=6, hh-7=-1 → setUTCDate handles wrap via Date.UTC
    const fire = new Date(Date.UTC(year, month - 1, 1, 6 - 7, 0, 0, 0));
    if (fire.getTime() <= nowMs) {
      // Already past 1st of next month 06:00 VN — advance 1 more month
      const m2 = month + 1 > 12 ? 1 : month + 1;
      const y2 = month + 1 > 12 ? year + 1 : year;
      return new Date(Date.UTC(y2, m2 - 1, 1, 6 - 7, 0, 0, 0)).getTime() - nowMs;
    }
    return fire.getTime() - nowMs;
  }
}
