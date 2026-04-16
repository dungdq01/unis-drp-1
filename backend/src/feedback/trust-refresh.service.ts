import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TrustScoreService } from '../cn-adjust/trust-score.service';

/**
 * M28 Step 5 — Trust Score Refresh (R4).
 *
 * Phase 1: backfill cn_demand_adjustment.actual_qty from demand_snapshot proxy.
 *          Then call M22.TrustScoreService.recalculateAll() — sets is_grace_period=FALSE if 12w data.
 */
@Injectable()
export class TrustRefreshService {
  private readonly logger = new Logger(TrustRefreshService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly trustSvc: TrustScoreService,
  ) {}

  async run(weekStart: string): Promise<{ refreshedCount: number }> {
    // Phase 1: backfill actual_qty from demand_snapshot for rows without actual
    const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const backfilled: Array<{ updated: number }> = await this.dataSource.query(
      `WITH proxy AS (
         SELECT c.id::text AS cn_id, s.id::text AS sku_id,
                date_trunc('week', dsl.period_start)::date AS week_start,
                SUM(dsl.qty)::decimal AS proxy_qty
         FROM demand_snapshot_line dsl
         JOIN demand_snapshot ds ON ds.snapshot_id = dsl.snapshot_id AND ds.status = 'FROZEN'
         JOIN sku     s ON s.sku_code     = dsl.item_code
         JOIN channel c ON c.channel_code = dsl.location_code
         WHERE dsl.period_start >= $1::date AND dsl.period_start < $2::date
           AND ds.created_at = (SELECT MAX(ds2.created_at) FROM demand_snapshot ds2 WHERE ds2.status='FROZEN')
         GROUP BY c.id, s.id, date_trunc('week', dsl.period_start)
       )
       UPDATE cn_demand_adjustment cda
         SET actual_qty = p.proxy_qty,
             is_accurate = (ABS(cda.adjusted_qty - p.proxy_qty) / NULLIF(p.proxy_qty, 0)) <= 0.20
       FROM proxy p
       JOIN channel c ON c.id::text = p.cn_id
       WHERE cda.cn_id = c.id
         AND cda.submitted_at >= $1::date
         AND cda.submitted_at <  $2::date
         AND cda.actual_qty IS NULL
       RETURNING 1`,
      [weekStart, weekEnd],
    );

    const backfilledCount = backfilled.length;
    this.logger.log(`[Trust-Refresh] backfilled ${backfilledCount} actual_qty rows (Phase 1 FC proxy)`);

    // Call M22 service to recompute trust scores (R11 — owner writes trust_score)
    const result = await this.trustSvc.recalculateAll();
    this.logger.log(`[Trust-Refresh] recalculateAll done: ${result.updated} CNs updated`);

    return { refreshedCount: result.updated };
  }
}
