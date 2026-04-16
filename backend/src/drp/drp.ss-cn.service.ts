import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PolicySnapshot, DrpPolicyRunService } from './drp.policy-run.service';
import { SsCnSource } from './entities/ss-cn.entity';

export interface SsCnRow {
  cnId: string;
  skuId: string;
  sigmaRolling: number;
  sigmaSeasonal: number | null;
  sigmaFinal: number;
  zUsed: number;
  ltHubDays: number;
  ssBase: number;
  lcnbReductionPct: number;
  ssFinal: number;
  source: SsCnSource;
  isCritical: boolean;
}

/** Map key: "cnId|skuId" → ss_final */
export type SsMap = Map<string, number>;

/**
 * Safety Stock per CN×SKU computation (M23 §5).
 * Formula: ss_base = z × σ_final × √(lt_hub_days)
 *          σ_final = MAX(σ_rolling, σ_seasonal)  [σ_seasonal nullable → use σ_rolling]
 *          ss_final = ss_base × (1 - lcnb_reduction_pct / 100)
 */
@Injectable()
export class DrpSsCnService {
  private readonly logger = new Logger(DrpSsCnService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Compute SS for all active CN×SKU combinations and bulk-insert into ss_cn.
   * Returns a Map<"cnId|skuId", ss_final> for fast netting lookup.
   */
  async computeAll(
    planRunId: string,
    policy: PolicySnapshot,
  ): Promise<SsMap> {
    const defaultZ = DrpPolicyRunService.getConfigNum(
      policy.configSnapshot,
      'safety_stock.default_z_score',
      1.65,
    );
    const lcnbPct = DrpPolicyRunService.getConfigNum(
      policy.configSnapshot,
      'safety_stock.lcnb_reduction_pct',
      0,
    );
    // G2 [C1 fix] SS floor for σ≈0 case (Phase 1 FC-only data → σ_rolling=0 → SS=0).
    // SS_floor = mean_demand_12w × min_ss_floor_pct (default 5%).
    const minSsFloorPct = DrpPolicyRunService.getConfigNum(
      policy.configSnapshot,
      'planning.min_ss_floor_pct',
      0.05,
    );

    // Build CN→LT map from policy snapshot
    const ltMap = new Map<string, number>(); // cnId → lt_days
    for (const lane of policy.masterDataSnapshot.transportLanes) {
      // transport_lane: supplier → cn; we need the CN side LT
      ltMap.set(lane.cnId, Number(lane.ltDays));
    }

    // Query σ_rolling + mean_demand_12w per CN×SKU (mean needed for SS floor)
    const sigmaRows: Array<{
      cn_id: string;
      sku_id: string;
      sigma_rolling: string;
      mean_demand: string;
    }> = await this.dataSource.query(
      `WITH weekly AS (
         SELECT
           c.id::text        AS cn_id,
           s.id::text        AS sku_id,
           date_trunc('week', dsl.period_start) AS week_start,
           SUM(dsl.qty)      AS week_qty
         FROM demand_snapshot_line dsl
         JOIN demand_snapshot ds  ON ds.snapshot_id = dsl.snapshot_id AND ds.status = 'FROZEN'
         JOIN sku s               ON s.sku_code = dsl.item_code
         JOIN channel c           ON c.channel_code = dsl.location_code
         WHERE dsl.period_start >= CURRENT_DATE - INTERVAL '12 weeks'
           AND ds.created_at = (
             SELECT MAX(ds2.created_at) FROM demand_snapshot ds2 WHERE ds2.status = 'FROZEN'
           )
         GROUP BY c.id, s.id, week_start
       )
       SELECT
         cn_id,
         sku_id,
         COALESCE(STDDEV_POP(week_qty), 0)::text AS sigma_rolling,
         COALESCE(AVG(week_qty), 0)::text        AS mean_demand
       FROM weekly
       GROUP BY cn_id, sku_id`,
    );

    const sigmaMap = new Map<string, number>();
    const meanMap = new Map<string, number>();
    for (const r of sigmaRows) {
      const key = `${r.cn_id}|${r.sku_id}`;
      sigmaMap.set(key, Number(r.sigma_rolling));
      meanMap.set(key, Number(r.mean_demand));
    }

    // G8 [spec §4] — Build override lookup from policy snapshot.
    // Snapshot only contains rows WITH overrides (G5 size guard).
    const overrideMap = new Map<string, {
      zOverride: number | null;
      ssOverride: number | null;
      isCritical: boolean;
    }>();
    for (const m of policy.masterDataSnapshot.skuCnMappings) {
      overrideMap.set(`${m.cnId}|${m.skuId}`, {
        zOverride: m.zOverride,
        ssOverride: m.ssOverride,
        isCritical: m.isCritical,
      });
    }

    // Query ALL active (cn, sku) pairs — the override-only snapshot cannot
    // drive iteration (would skip non-override rows = 99% of the population).
    const allPairs: Array<{ cn_id: string; sku_id: string }> = await this.dataSource.query(
      `SELECT DISTINCT cn_id::text, sku_id::text
       FROM sku_cn_mapping
       WHERE active = TRUE`,
    );

    const rows: SsCnRow[] = [];
    for (const pair of allPairs) {
      const key = `${pair.cn_id}|${pair.sku_id}`;
      const ovr = overrideMap.get(key);

      const sigmaRolling = sigmaMap.get(key) ?? 0;
      const sigmaSeasonal: number | null = null; // Phase 1
      const sigmaFinal = sigmaSeasonal !== null
        ? Math.max(sigmaRolling, sigmaSeasonal)
        : sigmaRolling;

      const ltHubDays = ltMap.get(pair.cn_id) ?? 0;
      const zUsed = ovr?.zOverride ?? defaultZ;
      const ssBase = zUsed * sigmaFinal * Math.sqrt(ltHubDays);
      const ssAfterLcnb = ssBase * (1 - lcnbPct / 100);

      // G2 [C1 fix] SS floor for σ≈0 case.
      const meanDemand = meanMap.get(key) ?? 0;
      const ssFloor = meanDemand * minSsFloorPct;

      // G8 [spec §4] ss_override bypasses formula entirely.
      let ssFinal: number;
      let source: SsCnSource;
      if (ovr?.ssOverride !== undefined && ovr?.ssOverride !== null) {
        ssFinal = ovr.ssOverride;
        source = 'OVERRIDE_EXPLICIT';
      } else if (ovr?.zOverride !== undefined && ovr?.zOverride !== null) {
        ssFinal = Math.max(0, ssAfterLcnb, ssFloor);
        source = 'OVERRIDE_Z';
      } else {
        ssFinal = Math.max(0, ssAfterLcnb, ssFloor);
        source = 'FORMULA';
      }

      rows.push({
        cnId: pair.cn_id,
        skuId: pair.sku_id,
        sigmaRolling,
        sigmaSeasonal,
        sigmaFinal,
        zUsed,
        ltHubDays,
        ssBase,
        lcnbReductionPct: lcnbPct,
        ssFinal,
        source,
        isCritical: ovr?.isCritical ?? false,
      });
    }

    if (rows.length === 0) {
      this.logger.warn(`plan_run #${planRunId}: no sku_cn_mapping → ss_cn empty`);
      return new Map();
    }

    // Bulk insert in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await this._bulkInsertChunk(planRunId, chunk);
    }

    this.logger.log(`plan_run #${planRunId}: inserted ${rows.length} ss_cn rows`);

    // Return Map for downstream netting
    const ssMap: SsMap = new Map();
    for (const r of rows) {
      ssMap.set(`${r.cnId}|${r.skuId}`, r.ssFinal);
    }
    return ssMap;
  }

  /**
   * G10 spec §7 — Live SS preview for (cnId, skuId) without persisting.
   * Reads active M10 config + sku_cn_mapping override at call time.
   */
  async preview(cnId: string, skuId: string): Promise<SsCnRow & { previewedAt: Date }> {
    const configRows: Array<{ config_key: string; config_value: string }> =
      await this.dataSource.query(
        `SELECT config_key, config_value FROM system_config
         WHERE config_key IN ('safety_stock.default_z_score','safety_stock.lcnb_reduction_pct','planning.min_ss_floor_pct')`,
      );
    const cfg: Record<string, string> = {};
    for (const r of configRows) cfg[r.config_key] = r.config_value;

    const defaultZ = Number(cfg['safety_stock.default_z_score'] ?? 1.65);
    const lcnbPct = Number(cfg['safety_stock.lcnb_reduction_pct'] ?? 0);
    const minSsFloorPct = Number(cfg['planning.min_ss_floor_pct'] ?? 0.05);

    const overrideRows: Array<{
      z_override: number | null;
      ss_override: number | null;
      is_critical: boolean;
    }> = await this.dataSource.query(
      `SELECT z_override, ss_override, is_critical
       FROM sku_cn_mapping
       WHERE cn_id = $1 AND sku_id = $2 AND active = TRUE
       LIMIT 1`,
      [cnId, skuId],
    );
    const ovr = overrideRows[0];

    // H1 fix: transport_lane real cols = source_location_code, dest_location_code,
    // lead_time_days, is_active. Join channel to resolve cnId → channel_code.
    const ltRows: Array<{ lt_days: number }> = await this.dataSource.query(
      `SELECT MAX(tl.lead_time_days)::float AS lt_days
       FROM transport_lane tl
       JOIN channel c ON c.channel_code = tl.dest_location_code
       WHERE c.id::text = $1 AND tl.is_active = TRUE`,
      [cnId],
    );
    const ltHubDays = Number(ltRows[0]?.lt_days ?? 0);

    const statsRows: Array<{ sigma_rolling: string; mean_demand: string }> =
      await this.dataSource.query(
        `WITH weekly AS (
           SELECT date_trunc('week', dsl.period_start) AS w, SUM(dsl.qty) AS q
           FROM demand_snapshot_line dsl
           JOIN sku s     ON s.sku_code = dsl.item_code
           JOIN channel c ON c.channel_code = dsl.location_code
           WHERE c.id::text = $1 AND s.id::text = $2
             AND dsl.period_start >= CURRENT_DATE - INTERVAL '12 weeks'
           GROUP BY w
         )
         SELECT COALESCE(STDDEV_POP(q), 0)::text AS sigma_rolling,
                COALESCE(AVG(q), 0)::text        AS mean_demand
         FROM weekly`,
        [cnId, skuId],
      );
    const sigmaRolling = Number(statsRows[0]?.sigma_rolling ?? 0);
    const meanDemand = Number(statsRows[0]?.mean_demand ?? 0);
    const sigmaFinal = sigmaRolling;
    const zUsed = ovr?.z_override ?? defaultZ;
    const ssBase = zUsed * sigmaFinal * Math.sqrt(ltHubDays);
    const ssAfterLcnb = ssBase * (1 - lcnbPct / 100);
    const ssFloor = meanDemand * minSsFloorPct;

    let ssFinal: number;
    let source: SsCnSource;
    if (ovr?.ss_override !== undefined && ovr?.ss_override !== null) {
      ssFinal = Number(ovr.ss_override);
      source = 'OVERRIDE_EXPLICIT';
    } else if (ovr?.z_override !== undefined && ovr?.z_override !== null) {
      ssFinal = Math.max(0, ssAfterLcnb, ssFloor);
      source = 'OVERRIDE_Z';
    } else {
      ssFinal = Math.max(0, ssAfterLcnb, ssFloor);
      source = 'FORMULA';
    }

    return {
      cnId, skuId,
      sigmaRolling, sigmaSeasonal: null, sigmaFinal,
      zUsed, ltHubDays, ssBase,
      lcnbReductionPct: lcnbPct, ssFinal,
      source, isCritical: Boolean(ovr?.is_critical),
      previewedAt: new Date(),
    };
  }

  /**
   * M28 contract (H1+H2 CTO v1.2) — PURE formula, KHÔNG ghi DB, KHÔNG side effect.
   * M28 Step 3 gọi để compute ss_new với σ_demand mới mà không trigger any DB write.
   */
  computeSsCnFormula(input: {
    sigmaDemand: number;
    ltHubDays: number;
    zUsed: number;
    lcnbReductionPct: number;
    meanDemand?: number;
    minSsFloorPct?: number;
  }): number {
    const { sigmaDemand, ltHubDays, zUsed, lcnbReductionPct, meanDemand = 0, minSsFloorPct = 0.05 } = input;
    const ssBase     = zUsed * sigmaDemand * Math.sqrt(ltHubDays);
    const ssAfterLcnb = ssBase * (1 - lcnbReductionPct / 100);
    const ssFloor    = meanDemand * minSsFloorPct;
    return Math.max(0, ssAfterLcnb, ssFloor);
  }

  private async _bulkInsertChunk(planRunId: string, rows: SsCnRow[]): Promise<void> {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;

    for (const r of rows) {
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
      );
      values.push(
        planRunId,
        r.cnId,
        r.skuId,
        r.sigmaRolling,
        r.sigmaSeasonal,
        r.sigmaFinal,
        r.zUsed,
        r.ltHubDays,
        r.ssBase,
        r.lcnbReductionPct,
        r.ssFinal,
        r.source,
        r.isCritical,
      );
    }

    await this.dataSource.query(
      `INSERT INTO ss_cn
         (plan_run_id, cn_id, sku_id,
          sigma_rolling, sigma_seasonal, sigma_final,
          z_used, lt_hub_days, ss_base,
          lcnb_reduction_pct, ss_final, source, is_critical)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (plan_run_id, cn_id, sku_id) DO NOTHING`,
      values,
    );
  }
}
