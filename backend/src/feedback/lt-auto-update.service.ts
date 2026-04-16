import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MasterDataService } from '../master-data/master-data.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { PoReviewService } from '../po-review/po-review.service';

/**
 * M28 Step 4 — LT Auto-Update (R3 safety gate).
 *
 * Per NM: rolling 6-month avg from M27 getActualLtPerNmRoute().
 *   delta ≤ 30% → auto-apply via M00.autoUpdateLt().
 *   delta > 30% → DRIFT_BLOCKED, increment lt_drift_count.
 *   drift_count ≥ 3 consecutive → DRIFT_FORCE_APPLY.
 * Per route (NM×CN): same pattern via M00.updateTransitLt().
 */
@Injectable()
export class LtAutoUpdateService {
  private readonly logger = new Logger(LtAutoUpdateService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly masterDataSvc: MasterDataService,
    private readonly poReviewSvc: PoReviewService,
    private readonly systemConfigSvc: SystemConfigService,
  ) {}

  async run(snapshotId: string, weekStart: string): Promise<{ updatedCount: number }> {
    const driftGatePct  = Number(await this.systemConfigSvc.getValue('feedback.lt_drift_gate_pct') ?? 30);
    const minSampleSize = Number(await this.systemConfigSvc.getValue('feedback.lt_min_sample_size') ?? 5);
    const sixMonthsAgo  = new Date(new Date(weekStart).getTime() - 183 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    let updatedCount = 0;

    // ── Per NM supplier ──────────────────────────────────────────────────────
    const suppliers: Array<{ supplier_code: string; lead_time_days: number | null; lt_drift_count: number }> =
      await this.dataSource.query(
        `SELECT supplier_code, lead_time_days, lt_drift_count FROM supplier WHERE status = 'ACTIVE'`,
      );

    for (const nm of suppliers) {
      const actuals = await this.poReviewSvc.getActualLtPerNmRoute(nm.supplier_code, null, sixMonthsAgo, weekStart);
      if (actuals.length < minSampleSize) continue;

      const avg    = actuals.reduce((a, b) => a + b, 0) / actuals.length;
      const oldLt  = nm.lead_time_days ?? avg;
      const deltaPct = oldLt > 0 ? Math.abs(avg - oldLt) / oldLt * 100 : 0;
      const driftCount = nm.lt_drift_count ?? 0;

      const isForce = driftCount >= 2 && deltaPct > driftGatePct;
      const shouldApply = deltaPct <= driftGatePct || isForce;
      const action = shouldApply
        ? (isForce ? 'DRIFT_FORCE_APPLY' : 'APPLIED')
        : 'DRIFT_BLOCKED';

      const newLt = shouldApply ? avg : null;

      // Call M00 service (R11 separation of concerns)
      const result = await this.masterDataSvc.autoUpdateLt(nm.supplier_code, avg, 'M28_AUTO');

      await this.dataSource.query(
        `INSERT INTO lt_actual_log
           (weekly_snapshot_id, entity_type, entity_code,
            lt_old_days, lt_actual_avg_days, lt_new_days,
            sample_size, drift_pct, action, drift_count_after)
         VALUES ($1, 'SUPPLIER', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          snapshotId, nm.supplier_code,
          oldLt, avg, newLt,
          actuals.length, deltaPct, action,
          result.driftCountAfter,
        ],
      );

      if (shouldApply) updatedCount++;
    }

    // ── Per transport lane (NM×CN route) ─────────────────────────────────────
    // H2 fix: include lt_drift_count so DRIFT_FORCE_APPLY can be evaluated (same as SUPPLIER loop)
    const lanes: Array<{
      id: string;
      source_location_code: string;
      dest_location_code: string;
      lt_days: number | null;
      lt_drift_count: number;
    }> = await this.dataSource.query(
      `SELECT id::text, source_location_code, dest_location_code, lt_days,
              COALESCE(lt_drift_count, 0)::int AS lt_drift_count
       FROM transport_lane WHERE is_active = TRUE`,
    );

    for (const lane of lanes) {
      const actuals = await this.poReviewSvc.getActualLtPerNmRoute(
        lane.source_location_code, lane.dest_location_code, sixMonthsAgo, weekStart,
      );
      if (actuals.length < minSampleSize) continue;

      const avg        = actuals.reduce((a, b) => a + b, 0) / actuals.length;
      const oldLt      = lane.lt_days ?? avg;
      const deltaPct   = oldLt > 0 ? Math.abs(avg - oldLt) / oldLt * 100 : 0;
      const driftCount = lane.lt_drift_count;

      // H2: same DRIFT_FORCE_APPLY logic as SUPPLIER loop
      const isForce    = driftCount >= 2 && deltaPct > driftGatePct;
      const shouldApply = deltaPct <= driftGatePct || isForce;
      const action = shouldApply
        ? (isForce ? 'DRIFT_FORCE_APPLY' : 'APPLIED')
        : 'DRIFT_BLOCKED';

      const result = await this.masterDataSvc.updateTransitLt(
        lane.source_location_code, lane.dest_location_code, avg, 'M28_AUTO',
      );

      const routeLabel = `${lane.source_location_code}→${lane.dest_location_code}`;
      await this.dataSource.query(
        `INSERT INTO lt_actual_log
           (weekly_snapshot_id, entity_type, entity_id, entity_code, route_label,
            lt_old_days, lt_actual_avg_days, lt_new_days,
            sample_size, drift_pct, action, drift_count_after)
         VALUES ($1, 'TRANSPORT_LANE', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          snapshotId, lane.id,
          routeLabel, routeLabel,
          oldLt, avg, shouldApply ? avg : null,
          actuals.length, deltaPct, action,
          result.driftCountAfter,
        ],
      );

      if (shouldApply) updatedCount++;
    }

    this.logger.log(`[LT-AutoUpdate] week=${weekStart}: ${updatedCount} LT values updated`);
    return { updatedCount };
  }
}
