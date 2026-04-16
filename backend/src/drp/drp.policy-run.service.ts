import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PolicyRun } from './entities/policy-run.entity';

export interface PolicySnapshot {
  policyRunId: string;
  configSnapshot: Record<string, unknown>;
  masterDataSnapshot: {
    /** Only rows with overrides (z_override / ss_override / is_critical). */
    skuCnMappings: Array<{
      skuId: string;
      cnId: string;
      isPrimary: boolean;
      proportion: number;
      zOverride: number | null;
      ssOverride: number | null;
      isCritical: boolean;
    }>;
    /** LT_hub per CN from transport_lane lane_type='HUB_TO_CN'. */
    transportLanes: Array<{
      supplierId: string;
      cnId: string;
      ltDays: number;
    }>;
  };
}

/**
 * Rule 14 — Policy Run Snapshot Service.
 * Captures an immutable snapshot of M10 system_config + master data
 * at the start of each DRP run. M23/M24/M25 read from this JSONB,
 * never from live config tables.
 */
@Injectable()
export class DrpPolicyRunService {
  private readonly logger = new Logger(DrpPolicyRunService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Creates a policy_run row capturing:
   * - All system_config rows (M10)
   * - sku_cn_mapping rows with proportion
   * - transport_lane LT values
   *
   * Returns the PolicySnapshot needed by downstream compute services.
   */
  async createPolicyRun(
    createdBy = 'SYSTEM_NIGHTLY',
    note?: string,
    /** M1 fix: when caller wraps in transaction, pass the EntityManager so the
     * policy_run INSERT shares the tx with plan_run INSERT. */
    manager?: EntityManager,
  ): Promise<PolicySnapshot> {
    const runner = manager ?? this.dataSource;
    // Fix C3 [BA re-review] — system_config has no is_active column.
    const configRows: Array<{ config_key: string; config_value: string }> =
      await runner.query(
        `SELECT config_key, config_value FROM system_config`,
      );

    const configSnapshot: Record<string, unknown> = {};
    for (const row of configRows) {
      configSnapshot[row.config_key] = row.config_value;
    }

    // G5 [spec §7 M2 fix] — only snapshot sku_cn_mapping rows with overrides.
    // Full mapping (~25K rows) is reconstructible from master data; snapshot
    // should stay <500 rows / ~300KB for JSONB efficiency.
    const skuCnRows: Array<{
      sku_id: string;
      cn_id: string;
      z_override: number | null;
      ss_override: number | null;
      is_critical: boolean;
    }> = await runner.query(
      // Fix H1 [BA re-review] — column is `active` not `is_active`.
      // Fix: is_primary/proportion columns không tồn tại trên entity → bỏ.
      `SELECT sku_id::text, cn_id::text,
              z_override, ss_override, is_critical
       FROM sku_cn_mapping
       WHERE active = TRUE
         AND (z_override IS NOT NULL OR ss_override IS NOT NULL OR is_critical = TRUE)`,
    );

    // Fix G9 + BA re-review — transport_lane real schema:
    //   source_location_code, dest_location_code, lead_time_days, is_active
    //   (no lane_type / transit_lt_days / to_location). For Phase 1 we treat
    //   any active lane arriving at a CN channel_code as a hub-to-CN lane
    //   and pick MAX lead_time_days as the LT_hub lower bound.
    const tlRows: Array<{
      cn_id: string;
      lt_days: number;
    }> = await runner.query(
      `SELECT c.id::text AS cn_id, MAX(tl.lead_time_days)::float AS lt_days
       FROM transport_lane tl
       JOIN channel c ON c.channel_code = tl.dest_location_code
       WHERE tl.is_active = TRUE
       GROUP BY c.id`,
    );

    const masterDataSnapshot = {
      skuCnMappings: skuCnRows.map((r) => ({
        skuId: r.sku_id,
        cnId: r.cn_id,
        isPrimary: false, // not tracked in sku_cn_mapping entity
        proportion: 1,    // single-mapping default
        zOverride: r.z_override !== null ? Number(r.z_override) : null,
        ssOverride: r.ss_override !== null ? Number(r.ss_override) : null,
        isCritical: Boolean(r.is_critical),
      })),
      transportLanes: tlRows.map((r) => ({
        supplierId: '', // deprecated — kept for backward-compat with PolicySnapshot shape
        cnId: r.cn_id,
        ltDays: Number(r.lt_days),
      })),
    };

    const inserted: PolicyRun[] = await runner.query(
      `INSERT INTO policy_run (created_by, config_snapshot, master_data_snapshot, note)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_by, config_snapshot, master_data_snapshot, note, created_at`,
      [createdBy, configSnapshot, masterDataSnapshot, note ?? null],
    );

    const row = inserted[0] as unknown as Record<string, unknown>;
    this.logger.log(
      `policy_run #${row['id']} created — ${skuCnRows.length} sku_cn_mapping, ${tlRows.length} transport_lanes`,
    );

    return {
      policyRunId: String(row['id']),
      configSnapshot: row['config_snapshot'] as Record<string, unknown>,
      masterDataSnapshot: row['master_data_snapshot'] as PolicySnapshot['masterDataSnapshot'],
    };
  }

  /** Read numeric config value from snapshot (with fallback default). */
  static getConfigNum(
    snapshot: Record<string, unknown>,
    key: string,
    fallback: number,
  ): number {
    const val = snapshot[key];
    if (val === undefined || val === null) return fallback;
    const n = Number(val);
    return isNaN(n) ? fallback : n;
  }

  /** Read string config value from snapshot. */
  static getConfigStr(
    snapshot: Record<string, unknown>,
    key: string,
    fallback: string,
  ): string {
    const val = snapshot[key];
    if (val === undefined || val === null) return fallback;
    return String(val);
  }
}
