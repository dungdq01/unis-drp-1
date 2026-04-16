import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface NmFreshnessResult {
  nmCode: string;
  nmName: string;
  lastSyncedAt: Date | null;
  hoursSinceSync: number | null;
  status: 'FRESH' | 'STALE' | 'MISSING';
}

export interface GateCheckResult {
  canRun: boolean;
  checkedAt: Date;
  staleNms: NmFreshnessResult[];
  freshCount: number;
  staleCount: number;
  missingCount: number;
  thresholdMinutes: number;
}

@Injectable()
export class FreshnessGateService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Gate check: returns canRun=true only if ALL active NMs have fresh data.
   * Used by M23 DRP Netting + M26 ATP Check before running.
   * is_legacy_data=TRUE rows are skipped (grace period).
   */
  async check(): Promise<GateCheckResult> {
    const thresholdMinutes = await this._getThresholdMinutes();
    const allResults = await this._queryFreshness(thresholdMinutes);

    const staleNms = allResults.filter(r => r.status !== 'FRESH');
    return {
      canRun:           staleNms.length === 0,
      checkedAt:        new Date(),
      staleNms,
      freshCount:       allResults.filter(r => r.status === 'FRESH').length,
      staleCount:       allResults.filter(r => r.status === 'STALE').length,
      missingCount:     allResults.filter(r => r.status === 'MISSING').length,
      thresholdMinutes,
    };
  }

  /**
   * Returns freshness status for ALL active NMs.
   * Used by GET /supply/sync/dashboard.
   */
  async checkAll(): Promise<NmFreshnessResult[]> {
    const thresholdMinutes = await this._getThresholdMinutes();
    return this._queryFreshness(thresholdMinutes);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async _getThresholdMinutes(): Promise<number> {
    // Read from M10 system_config; default 1440 (24h) per spec R1
    const rows = await this.dataSource.query<{ config_value: string }[]>(
      `SELECT config_value FROM system_config WHERE config_key = 'planning.max_stale_minutes' LIMIT 1`,
    );
    const val = rows.length > 0 ? parseInt(rows[0].config_value, 10) : 1440;
    return isNaN(val) || val < 1 ? 1440 : val;
  }

  private async _queryFreshness(thresholdMinutes: number): Promise<NmFreshnessResult[]> {
    // Join active suppliers with latest non-legacy supply_snapshot per NM
    const rows = await this.dataSource.query<{
      nm_code: string;
      nm_name: string;
      last_synced_at: Date | null;
    }[]>(`
      SELECT
        s.supplier_code AS nm_code,
        s.supplier_name AS nm_name,
        MAX(ss.synced_at) FILTER (WHERE ss.is_legacy_data = FALSE) AS last_synced_at
      FROM supplier s
      LEFT JOIN supply_snapshot ss ON ss.nm_code = s.supplier_code
      WHERE s.status = 'ACTIVE'
      GROUP BY s.supplier_code, s.supplier_name
      ORDER BY s.supplier_name ASC
    `);

    const nowMs = Date.now();
    const thresholdMs = thresholdMinutes * 60 * 1000;

    return rows.map(r => {
      if (!r.last_synced_at) {
        return {
          nmCode:        r.nm_code,
          nmName:        r.nm_name,
          lastSyncedAt:  null,
          hoursSinceSync: null,
          status:        'MISSING' as const,
        };
      }
      const ageMs = nowMs - new Date(r.last_synced_at).getTime();
      const hoursSinceSync = Math.round(ageMs / 1000 / 60 / 60 * 10) / 10;
      return {
        nmCode:        r.nm_code,
        nmName:        r.nm_name,
        lastSyncedAt:  new Date(r.last_synced_at),
        hoursSinceSync,
        status:        ageMs <= thresholdMs ? 'FRESH' : 'STALE',
      };
    });
  }
}
