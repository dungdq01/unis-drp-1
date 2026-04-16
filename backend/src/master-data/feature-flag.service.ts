import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * FeatureFlagService — reads feature flags from DB `feature_flag` table.
 *
 * TD-02 Sprint 2: feature_flag table now exists (see 20260418_m00_feature_flags.up.sql).
 * QA-18 "Feature flag off → 503" can now be tested by updating the row:
 *   UPDATE feature_flag SET enabled = FALSE WHERE flag_name = 'm00_master_data_enabled';
 *
 * M10 integration path (Sprint 3+):
 *   When M10 SystemConfigService is built, replace injection in FeatureFlagGuard:
 *     return this.systemConfigService.getBool(`feature.${flagName}`, false);
 *   Then migrate feature_flag rows → system_config table and drop feature_flag.
 */
@Injectable()
export class FeatureFlagService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Check whether a feature flag is enabled.
   * Lookup order:
   *   1. DB: SELECT enabled FROM feature_flag WHERE flag_name = $1
   *   2. Env fallback: process.env[FLAG_NAME_UPPERCASE] !== 'false'
   *      (used when DB is unreachable or table not yet seeded)
   *
   * Default: TRUE — safe for dev, prevents lockout on misconfiguration.
   */
  async isEnabled(flagName: string): Promise<boolean> {
    try {
      const rows = await this.dataSource.query<{ enabled: boolean }[]>(
        `SELECT enabled FROM feature_flag WHERE flag_name = $1 LIMIT 1`,
        [flagName],
      );
      if (rows.length > 0) {
        // DB row found — return the actual DB value (TRUE or FALSE)
        return rows[0].enabled;
      }
      // Flag not seeded in DB → fall through to env fallback
    } catch {
      // Table does not exist (migration not run yet) or DB unreachable.
      // Fall through to env fallback — do not throw.
    }

    // Env fallback: m00_master_data_enabled → M00_MASTER_DATA_ENABLED
    const envKey = flagName.toUpperCase();
    return process.env[envKey] !== 'false';
  }

  /**
   * Toggle a feature flag directly in DB (used by admin API or test setup).
   * Returns the new enabled value.
   */
  async setEnabled(flagName: string, enabled: boolean, updatedBy = 'admin'): Promise<boolean> {
    await this.dataSource.query(
      `INSERT INTO feature_flag (flag_name, enabled, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (flag_name) DO UPDATE
         SET enabled    = EXCLUDED.enabled,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()`,
      [flagName, enabled, updatedBy],
    );
    return enabled;
  }

  /**
   * List all feature flags (for admin dashboard).
   */
  async listFlags(): Promise<{ flagName: string; enabled: boolean; updatedAt: Date }[]> {
    const rows = await this.dataSource.query<{
      flag_name: string;
      enabled: boolean;
      updated_at: Date;
    }[]>(`SELECT flag_name, enabled, updated_at FROM feature_flag ORDER BY flag_name`);
    return rows.map((r) => ({ flagName: r.flag_name, enabled: r.enabled, updatedAt: r.updated_at }));
  }
}
