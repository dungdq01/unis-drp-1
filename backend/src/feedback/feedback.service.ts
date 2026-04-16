import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
  ServiceUnavailableException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SystemConfigService } from '../system-config/system-config.service';
import { SsAutoAdjustService } from './ss-auto-adjust.service';
import { LtAutoUpdateService } from './lt-auto-update.service';
import { TrustRefreshService } from './trust-refresh.service';
import { HonoringBackfillService } from './honoring-backfill.service';
import { OverrideAnalysisService } from './override-analysis.service';
import { KpiSnapshotService } from './kpi-snapshot.service';

export interface RunFeedbackOptions {
  weekStart?: string;
  forceRerunReason?: string;
  createdBy?: string;
}

/**
 * M28 — FeedbackService (pipeline orchestrator).
 * Cron: Monday 06:00 VN (setTimeout reschedule pattern — consistent with M25/M26/M22).
 *
 * Pipeline: 9 steps, try/catch per step → COMPLETED_PARTIAL on partial failure.
 * R10 idempotency: 1 snapshot per week (UNIQUE partial index).
 */
@Injectable()
export class FeedbackService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(FeedbackService.name);
  private _cronTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly systemConfigSvc: SystemConfigService,
    private readonly ssAutoAdjustSvc: SsAutoAdjustService,
    private readonly ltAutoUpdateSvc: LtAutoUpdateService,
    private readonly trustRefreshSvc: TrustRefreshService,
    private readonly honoringBackfillSvc: HonoringBackfillService,
    private readonly overrideAnalysisSvc: OverrideAnalysisService,
    private readonly kpiSnapshotSvc: KpiSnapshotService,
  ) {}

  onApplicationBootstrap(): void {
    this._scheduleWeeklyCron();
  }

  onApplicationShutdown(): void {
    if (this._cronTimer) clearTimeout(this._cronTimer);
  }

  // ── Cron scheduling ──────────────────────────────────────────────────────

  private _scheduleWeeklyCron(): void {
    const msUntilNextMonday0600VN = () => {
      const nowMs = Date.now();
      const vnNow = new Date(nowMs + 7 * 3600_000); // UTC+7
      const day   = vnNow.getUTCDay(); // 0=Sun, 1=Mon …
      const daysUntilMon = day === 1 ? 7 : (8 - day) % 7;
      const targetUtcH = 6 - 7; // 06:00 VN = -01:00 UTC (i.e. previous day 23:00 UTC)
      const nextFire = new Date(Date.UTC(
        vnNow.getUTCFullYear(), vnNow.getUTCMonth(),
        vnNow.getUTCDate() + daysUntilMon,
        targetUtcH, 0, 0, 0,
      ));
      // Handle same-day case
      if (day === 1) {
        const todayFire = new Date(Date.UTC(
          vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(),
          targetUtcH, 0, 0, 0,
        ));
        if (todayFire.getTime() > nowMs) return todayFire.getTime() - nowMs;
      }
      return nextFire.getTime() - nowMs;
    };

    const scheduleNext = () => {
      this._cronTimer = setTimeout(async () => {
        try {
          const weekStart = this._prevMonday();
          await this.runWeekly({ weekStart, createdBy: 'CRON_WEEKLY' });
        } catch (err) {
          this.logger.error(`[M28 CRON] weekly run failed: ${(err as Error).message}`);
        } finally {
          scheduleNext();
        }
      }, msUntilNextMonday0600VN());
    };

    scheduleNext();
  }

  private _prevMonday(): string {
    const now = new Date(Date.now() + 7 * 3600_000); // VN time
    const day = now.getUTCDay();
    const offset = day === 1 ? 7 : day === 0 ? 6 : day - 1;
    const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
    return mon.toISOString().slice(0, 10);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async runWeekly(opts: RunFeedbackOptions = {}): Promise<{ snapshotId: string; status: string }> {
    if (!(await this.systemConfigSvc.isEnabled('m28_feedback_loop_enabled'))) {
      throw new ServiceUnavailableException('M28 Feedback Loop disabled (feature flag m28_feedback_loop_enabled=false)');
    }

    const weekStart = opts.weekStart ?? this._prevMonday();
    const isForce   = !!opts.forceRerunReason;

    if (isForce && (!opts.forceRerunReason || opts.forceRerunReason.length < 20)) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }

    // R10 idempotency: check if already ran this week
    if (!isForce) {
      const existing: Array<{ id: string; status: string }> = await this.dataSource.query(
        `SELECT id::text, status FROM weekly_kpi_snapshot
         WHERE week_start_date = $1 AND is_force_rerun = FALSE
         LIMIT 1`,
        [weekStart],
      );
      if (existing.length > 0) {
        throw new ConflictException(
          `Đã chạy weekly cho tuần ${weekStart} (status=${existing[0].status}). Force rerun cần reason.`,
        );
      }
    }

    // Step 1+2: Create snapshot RUNNING
    const snapshotRow: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO weekly_kpi_snapshot (week_start_date, is_force_rerun, force_rerun_reason, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id::text`,
      [weekStart, isForce, opts.forceRerunReason ?? null, opts.createdBy ?? 'MANUAL'],
    );
    const snapshotId = snapshotRow[0].id;
    this.logger.log(`[M28] weekly_kpi_snapshot #${snapshotId} RUNNING for week ${weekStart}`);

    const errors: Array<{ step: string; error: string }> = [];
    let ssAdjCount = 0;
    let ltUpdCount = 0;

    // Step 3: SS Auto-Adjust
    try {
      const r = await this.ssAutoAdjustSvc.run(snapshotId, weekStart);
      ssAdjCount = r.adjustedCount;
    } catch (e) { errors.push({ step: 'SS_AUTO_ADJUST', error: (e as Error).message }); }

    // Step 4: LT Auto-Update
    try {
      const r = await this.ltAutoUpdateSvc.run(snapshotId, weekStart);
      ltUpdCount = r.updatedCount;
    } catch (e) { errors.push({ step: 'LT_AUTO_UPDATE', error: (e as Error).message }); }

    // Step 5: Trust Refresh
    try {
      await this.trustRefreshSvc.run(weekStart);
    } catch (e) { errors.push({ step: 'TRUST_REFRESH', error: (e as Error).message }); }

    // Step 6: Honoring Backfill
    try {
      await this.honoringBackfillSvc.run(weekStart);
    } catch (e) { errors.push({ step: 'HONORING_BACKFILL', error: (e as Error).message }); }

    // Step 7: Override Analysis
    try {
      await this.overrideAnalysisSvc.run(snapshotId, weekStart);
    } catch (e) { errors.push({ step: 'OVERRIDE_ANALYSIS', error: (e as Error).message }); }

    // Step 8: KPI Snapshot
    try {
      await this.kpiSnapshotSvc.run(snapshotId, weekStart);
    } catch (e) { errors.push({ step: 'KPI_SNAPSHOT', error: (e as Error).message }); }

    // Step 9: Alerts — fill_rate < threshold for 2 consecutive weeks → WARNING log
    // (Alert delivery to M8 is Phase 2 — Phase 1: log only)
    try {
      const fillThreshold = Number(
        await this.systemConfigSvc.getValue('feedback.fill_rate_alert_threshold') ?? 0.85,
      );
      const recent: Array<{ fill_rate_pct: string | null }> = await this.dataSource.query(
        `SELECT fill_rate_pct::text
         FROM weekly_kpi_snapshot
         WHERE status IN ('COMPLETED', 'COMPLETED_PARTIAL')
           AND fill_rate_pct IS NOT NULL
         ORDER BY week_start_date DESC
         LIMIT 2`,
      );
      if (
        recent.length >= 2 &&
        Number(recent[0].fill_rate_pct) < fillThreshold &&
        Number(recent[1].fill_rate_pct) < fillThreshold
      ) {
        this.logger.warn(
          `[M28 ALERT] fill_rate < ${fillThreshold} (fraction) for 2 consecutive weeks ` +
          `(${recent[1].fill_rate_pct}% → ${recent[0].fill_rate_pct}%). Phase 2: trigger M8 delivery.`,
        );
      }
    } catch (e) { errors.push({ step: 'FILL_RATE_ALERT', error: (e as Error).message }); }

    // Finalize
    const finalStatus = errors.length === 0 ? 'COMPLETED' : 'COMPLETED_PARTIAL';
    await this.dataSource.query(
      `UPDATE weekly_kpi_snapshot
         SET status = $2, completed_at = NOW(),
             step_errors = $3,
             ss_adjustments_count = $4,
             lt_updates_count = $5
       WHERE id = $1`,
      [snapshotId, finalStatus, errors.length > 0 ? JSON.stringify(errors) : null, ssAdjCount, ltUpdCount],
    );

    this.logger.log(`[M28] snapshot #${snapshotId} ${finalStatus} — errors: ${errors.length}`);
    if (errors.length > 0) {
      this.logger.warn(`[M28] Step errors: ${errors.map(e => e.step).join(', ')}`);
    }

    return { snapshotId, status: finalStatus };
  }

  async listSnapshots(limit = 20): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT * FROM weekly_kpi_snapshot ORDER BY week_start_date DESC LIMIT $1`,
      [limit],
    );
  }

  async getSnapshot(id: string): Promise<unknown> {
    const rows = await this.dataSource.query(
      `SELECT * FROM weekly_kpi_snapshot WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async recomputeSs(cnId: string, skuId: string): Promise<unknown> {
    if (!(await this.systemConfigSvc.isEnabled('m28_feedback_loop_enabled'))) {
      throw new ServiceUnavailableException('M28 disabled');
    }
    // H1 fix: single-cell recompute — do NOT call ssAutoAdjustSvc.run() (runs all pairs)
    const now = new Date().toISOString().slice(0, 10);
    const tempSnap: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO weekly_kpi_snapshot (week_start_date, is_force_rerun, force_rerun_reason, created_by)
       VALUES ($1, TRUE, 'MANUAL_RECOMPUTE', 'MANUAL')
       RETURNING id::text`,
      [now],
    );
    const snapshotId = tempSnap[0].id;
    await this.ssAutoAdjustSvc.runForCell(snapshotId, cnId, skuId);
    await this.dataSource.query(
      `UPDATE weekly_kpi_snapshot SET status='COMPLETED', completed_at=NOW() WHERE id=$1`, [snapshotId],
    );
    const rows = await this.dataSource.query(
      `SELECT * FROM ss_adjustment_log WHERE weekly_snapshot_id=$1 AND cn_id=$2 AND sku_id=$3`,
      [snapshotId, cnId, skuId],
    );
    return rows[0] ?? null;
  }

  async recomputeLt(nmCode: string): Promise<unknown> {
    if (!(await this.systemConfigSvc.isEnabled('m28_feedback_loop_enabled'))) {
      throw new ServiceUnavailableException('M28 disabled');
    }
    const now = new Date().toISOString().slice(0, 10);
    const tempSnap: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO weekly_kpi_snapshot (week_start_date, is_force_rerun, force_rerun_reason, created_by)
       VALUES ($1, TRUE, 'MANUAL_LT_RECOMPUTE', 'MANUAL')
       RETURNING id::text`,
      [now],
    );
    const snapshotId = tempSnap[0].id;
    await this.ltAutoUpdateSvc.run(snapshotId, now);
    await this.dataSource.query(
      `UPDATE weekly_kpi_snapshot SET status='COMPLETED', completed_at=NOW() WHERE id=$1`, [snapshotId],
    );
    return this.dataSource.query(
      `SELECT * FROM lt_actual_log WHERE weekly_snapshot_id=$1 AND entity_code LIKE $2 || '%'`,
      [snapshotId, nmCode],
    );
  }
}
