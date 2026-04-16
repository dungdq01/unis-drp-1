import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DrpSsCnService } from '../drp/drp.ss-cn.service';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * M28 Step 3 — SS Auto-Adjust (R2, R12 cap, H1+H2 v1.2).
 *
 * For each (cn, sku) with drp_cn_line in prior week:
 *   1. Recompute σ_demand 12w rolling from M9 actual (Phase 1 fallback: demand_snapshot FC proxy)
 *   2. Compute ss_new via DrpSsCnService.computeSsCnFormula() — PURE, no DB write
 *   3. Cap delta at 50% (R12); alert if > 20% (R2)
 *   4. Persist sigma_history (H1)
 *   5. Insert ss_adjustment_log (audit)
 *   KHÔNG ghi ss_cn directly — M23 nightly reads sigma_history and writes ss_cn.
 */
@Injectable()
export class SsAutoAdjustService {
  private readonly logger = new Logger(SsAutoAdjustService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ssCnSvc: DrpSsCnService,
    private readonly systemConfigSvc: SystemConfigService,
  ) {}

  async run(snapshotId: string, weekStart: string): Promise<{ adjustedCount: number; cappedCount: number }> {
    const alertPct = Number(await this.systemConfigSvc.getValue('feedback.ss_adjust_alert_threshold_pct') ?? 20);
    const capPct   = Number(await this.systemConfigSvc.getValue('feedback.ss_adjust_cap_pct') ?? 50);

    // Load (cn, sku) pairs active this week from drp_cn_line
    const pairs: Array<{ cn_id: string; sku_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT dcl.cn_id::text, dcl.sku_id::text
       FROM drp_cn_line dcl
       JOIN plan_run pr ON pr.id = dcl.plan_run_id
       WHERE pr.created_at >= $1::date
         AND pr.created_at <  ($1::date + INTERVAL '7 days')`,
      [weekStart],
    );

    if (pairs.length === 0) {
      this.logger.log(`[SS-AutoAdjust] No drp_cn_line rows for week ${weekStart}, skip`);
      return { adjustedCount: 0, cappedCount: 0 };
    }

    // Preload latest ss_final per (cn, sku) from ss_cn
    const ssOldRows: Array<{ cn_id: string; sku_id: string; ss_final: string }> =
      await this.dataSource.query(
        `SELECT DISTINCT ON (cn_id, sku_id) cn_id::text, sku_id::text, ss_final::text
         FROM ss_cn
         ORDER BY cn_id, sku_id, plan_run_id DESC`,
      );
    const ssOldMap = new Map<string, number>();
    for (const r of ssOldRows) ssOldMap.set(`${r.cn_id}|${r.sku_id}`, Number(r.ss_final));

    let adjustedCount = 0;
    let cappedCount   = 0;

    for (const pair of pairs) {
      const key = `${pair.cn_id}|${pair.sku_id}`;
      const ssOld = ssOldMap.get(key) ?? 0;

      // Step M3 source precedence: try M9 plan_actual_comparison first, fallback demand_snapshot
      const sigmaResult = await this._computeSigma(pair.cn_id, pair.sku_id);
      const { sigmaNew, confidence, sampleSize } = sigmaResult;

      // PURE SS formula from M23 DrpSsCnService (BUG-1 fix: use computeSsCnFormula — no DB side-effect)
      const preview = await this.ssCnSvc.preview(pair.cn_id, pair.sku_id);
      const ssNewUncapped = this.ssCnSvc.computeSsCnFormula({
        sigmaDemand:      sigmaNew,
        ltHubDays:        preview.ltHubDays,
        zUsed:            preview.zUsed,
        lcnbReductionPct: preview.lcnbReductionPct,
      });

      // R12: cap at ±50%
      let ssNewApplied = ssNewUncapped;
      let isCapped     = false;
      if (ssOld > 0) {
        const deltaPctRaw = (ssNewUncapped - ssOld) / ssOld * 100;
        if (Math.abs(deltaPctRaw) > capPct) {
          const sign = ssNewUncapped > ssOld ? 1 : -1;
          ssNewApplied = ssOld * (1 + sign * capPct / 100);
          isCapped     = true;
          cappedCount++;
          this.logger.warn(
            `[SS-AutoAdjust] CN=${pair.cn_id} SKU=${pair.sku_id}: delta=${deltaPctRaw.toFixed(1)}% CAPPED at ±${capPct}%`,
          );
        } else if (Math.abs(deltaPctRaw) > alertPct) {
          this.logger.warn(
            `[SS-AutoAdjust] CN=${pair.cn_id} SKU=${pair.sku_id}: delta=${deltaPctRaw.toFixed(1)}% > alert threshold ${alertPct}%`,
          );
        }
      }

      const deltaPct = ssOld > 0 ? (ssNewApplied - ssOld) / ssOld * 100 : 0;

      // Persist sigma_history (H1)
      await this.dataSource.query(
        `INSERT INTO sigma_history (cn_id, sku_id, sigma_demand, sample_size, source, confidence, weekly_snapshot_id)
         VALUES ($1, $2, $3, $4, 'M28_AUTO_WEEKLY', $5, $6)
         ON CONFLICT (cn_id, sku_id, calculated_at) DO NOTHING`,
        [pair.cn_id, pair.sku_id, sigmaNew, sampleSize, confidence, snapshotId],
      );

      // Insert audit log
      await this.dataSource.query(
        `INSERT INTO ss_adjustment_log
           (weekly_snapshot_id, cn_id, sku_id, ss_old, ss_new_uncapped, ss_new_applied,
            delta_pct, is_capped, sigma_old, sigma_new)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          snapshotId, pair.cn_id, pair.sku_id,
          ssOld, ssNewUncapped, ssNewApplied,
          deltaPct, isCapped, preview.sigmaRolling, sigmaNew,
        ],
      );
      adjustedCount++;
    }

    this.logger.log(`[SS-AutoAdjust] week=${weekStart}: ${adjustedCount} adjusted, ${cappedCount} capped`);
    return { adjustedCount, cappedCount };
  }

  /**
   * H1 fix — single-cell recompute for recomputeSs() endpoint.
   * Processes exactly one (cnId, skuId) without iterating all pairs.
   */
  async runForCell(
    snapshotId: string,
    cnId: string,
    skuId: string,
  ): Promise<{ ssOld: number; ssNewApplied: number; deltaPct: number; isCapped: boolean }> {
    const alertPct = Number(await this.systemConfigSvc.getValue('feedback.ss_adjust_alert_threshold_pct') ?? 20);
    const capPct   = Number(await this.systemConfigSvc.getValue('feedback.ss_adjust_cap_pct') ?? 50);

    const ssOldRows: Array<{ ss_final: string }> = await this.dataSource.query(
      `SELECT ss_final::text FROM ss_cn
       WHERE cn_id::text = $1 AND sku_id::text = $2
       ORDER BY plan_run_id DESC LIMIT 1`,
      [cnId, skuId],
    );
    const ssOld = Number(ssOldRows[0]?.ss_final ?? 0);

    const { sigmaNew, confidence, sampleSize } = await this._computeSigma(cnId, skuId);
    const preview = await this.ssCnSvc.preview(cnId, skuId);
    const ssNewUncapped = this.ssCnSvc.computeSsCnFormula({
      sigmaDemand:      sigmaNew,
      ltHubDays:        preview.ltHubDays,
      zUsed:            preview.zUsed,
      lcnbReductionPct: preview.lcnbReductionPct,
    });

    let ssNewApplied = ssNewUncapped;
    let isCapped = false;
    if (ssOld > 0) {
      const deltaPctRaw = (ssNewUncapped - ssOld) / ssOld * 100;
      if (Math.abs(deltaPctRaw) > capPct) {
        const sign = ssNewUncapped > ssOld ? 1 : -1;
        ssNewApplied = ssOld * (1 + sign * capPct / 100);
        isCapped = true;
      }
    }
    const deltaPct = ssOld > 0 ? (ssNewApplied - ssOld) / ssOld * 100 : 0;

    await this.dataSource.query(
      `INSERT INTO sigma_history (cn_id, sku_id, sigma_demand, sample_size, source, confidence, weekly_snapshot_id)
       VALUES ($1, $2, $3, $4, 'M28_MANUAL_RECOMPUTE', $5, $6)
       ON CONFLICT (cn_id, sku_id, calculated_at) DO NOTHING`,
      [cnId, skuId, sigmaNew, sampleSize, confidence, snapshotId],
    );

    await this.dataSource.query(
      `INSERT INTO ss_adjustment_log
         (weekly_snapshot_id, cn_id, sku_id, ss_old, ss_new_uncapped, ss_new_applied,
          delta_pct, is_capped, sigma_old, sigma_new, trigger)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'MANUAL_REFRESH')`,
      [snapshotId, cnId, skuId, ssOld, ssNewUncapped, ssNewApplied,
       deltaPct, isCapped, preview.sigmaRolling, sigmaNew],
    );

    return { ssOld, ssNewApplied, deltaPct, isCapped };
  }

  /**
   * M3 v1.2 source precedence:
   *   1. M9 plan_actual_comparison.actual_qty (HIGH confidence)
   *   2. demand_snapshot.qty FC proxy (LOW confidence)
   */
  private async _computeSigma(
    cnId: string,
    skuId: string,
  ): Promise<{ sigmaNew: number; confidence: 'HIGH' | 'LOW'; sampleSize: number }> {
    // Try M9 actual first
    const actualRows: Array<{ week_qty: string }> = await this.dataSource.query(
      `SELECT SUM(actual_qty)::text AS week_qty
       FROM plan_actual_comparison
       WHERE cn_id::text = $1
         AND sku_id::text = $2
         AND week_start >= CURRENT_DATE - INTERVAL '12 weeks'
         AND comparison_type = 'FORECAST_VS_ACTUAL'
       GROUP BY week_start
       HAVING SUM(actual_qty) IS NOT NULL`,
      [cnId, skuId],
    );

    if (actualRows.length >= 4) {
      const vals = actualRows.map(r => Number(r.week_qty));
      const sigma = this._stddev(vals);
      return { sigmaNew: sigma, confidence: 'HIGH', sampleSize: vals.length };
    }

    // Phase 1 fallback: demand_snapshot FC proxy
    this.logger.log(`[SS-AutoAdjust] CN=${cnId} SKU=${skuId}: using FC proxy (LOW confidence)`);
    const fcRows: Array<{ week_qty: string }> = await this.dataSource.query(
      `SELECT SUM(dsl.qty)::text AS week_qty
       FROM demand_snapshot_line dsl
       JOIN demand_snapshot ds ON ds.snapshot_id = dsl.snapshot_id AND ds.status = 'FROZEN'
       JOIN sku s     ON s.sku_code = dsl.item_code
       JOIN channel c ON c.channel_code = dsl.location_code
       WHERE c.id::text = $1 AND s.id::text = $2
         AND dsl.period_start >= CURRENT_DATE - INTERVAL '12 weeks'
         AND ds.created_at = (SELECT MAX(ds2.created_at) FROM demand_snapshot ds2 WHERE ds2.status = 'FROZEN')
       GROUP BY date_trunc('week', dsl.period_start)`,
      [cnId, skuId],
    );

    const vals = fcRows.map(r => Number(r.week_qty));
    const sigma = vals.length > 0 ? this._stddev(vals) : 0;
    return { sigmaNew: sigma, confidence: 'LOW', sampleSize: vals.length };
  }

  private _stddev(vals: number[]): number {
    if (vals.length === 0) return 0;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    return Math.sqrt(variance);
  }
}
