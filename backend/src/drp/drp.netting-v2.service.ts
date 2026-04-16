import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { SystemConfigService } from '../system-config/system-config.service';

/**
 * H2 fix: post-COMPLETED hook signature. AllocationModule registers its hook
 * via `setPostCompletedHook()` at bootstrap; this avoids a drp ↔ allocation
 * module-import circular dep while still giving M24 automatic trigger per
 * spec §7 (M23 COMPLETED → M24 run).
 */
export type PostCompletedHook = (planRunId: string, createdBy: string) => Promise<void> | void;
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DrpPolicyRunService, PolicySnapshot } from './drp.policy-run.service';
import { DrpSsCnService, SsMap } from './drp.ss-cn.service';
import { DrpVariantSuggestionService } from './drp.variant-suggestion.service';
import { FreshnessGateService } from '../data-sync/freshness-gate.service';
import { CnAdjustService } from '../cn-adjust/cn-adjust.service';
import { mondayOfStr } from '../common/date-utils';
import { drpCellKey } from '../common/drp-utils';
import { DrpCnLine } from './entities/drp-cn-line.entity';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface V2RunOptions {
  createdBy?: string;
  forceOverrideReason?: string; // if set, bypass freshness gate
  forceOverrideBy?: string;
}

export interface V2RunResult {
  planRunId: string;
  status: string;
  plannedOrdersCount: number;
  exceptionsCount: number;
  combinationsProcessed: number;
  durationMs: number;
  effectiveDemandSource: {
    m22Count: number;
    fcRawCount: number;
    m22Unavailable: boolean;
  };
}

/** M23 → M24 contract (spec §14.1). */
export interface DrpCellDto {
  cnId: string;
  skuId: string;
  periodStart: string;
  effectiveDemand: number;
  effectiveDemandSource: 'M22_ADJUSTED' | 'FC_RAW';
  onHand: number;
  inTransit: number;
  ssFinal: number;
  netDemand: number; // Can be negative (OVER_STOCK signal)
  status: 'NORMAL' | 'OVER_STOCK' | 'STOCKOUT_RISK';
  /** G12: spec §7 object shape `{variantCode: qty}`. NULL when planner review required. */
  variantSuggestion: Record<string, number> | null;
  plannerReviewRequired: boolean;
  reviewReason: string | null;
}

export interface DrpResultDto {
  planRunId: string;
  policyRunId: string | null;
  generatedAt: Date;
  lines: Map<string, DrpCellDto>; // key: drpCellKey(cnId, skuId, periodStart)
}

interface SupplyRow {
  cn_id: string;
  sku_id: string;
  on_hand: number;
  in_transit: number;
}

interface DemandRow {
  cn_id: string;
  sku_id: string;
  period_start: string;
  fc_qty: number;
}

const CHUNK_SIZE = 500;
const CRON_PRIMARY_VN = '23:15';
const CRON_RETRY_VN = '23:30';

/**
 * G4 [spec §14.7 M1 fix] Status transition matrix.
 * Throw InvalidTransitionException if violated.
 */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  RUNNING:          ['COMPLETED', 'FAILED', 'BLOCKED_STALE'],
  BLOCKED_STALE:    ['FORCE_OVERRIDDEN', 'CANCELLED'],
  FORCE_OVERRIDDEN: ['COMPLETED', 'FAILED'],
  FAILED:           [], // terminal — new plan_run needed to retry
  COMPLETED:        [], // terminal
  CANCELLED:        [], // terminal
};

export class InvalidTransitionException extends BadRequestException {
  constructor(from: string, to: string) {
    super(`Invalid plan_run transition: ${from} → ${to}`);
  }
}

/**
 * M23 — DRP Netting v2 Orchestrator.
 *
 * Pipeline (10 steps):
 *  1. Freshness gate check
 *  2. Idempotent daily run check (run_date unique index)
 *  3. Create policy_run snapshot (Rule 14)
 *  4. Create plan_run (status=RUNNING)
 *  5. Load M22 effective demand map (with fallback to FC raw)
 *  6. Load supply snapshot (on_hand + in_transit per CN×SKU)
 *  7. Compute SS per CN×SKU → ss_cn table
 *  8. Per-CN netting: for each period × CN × SKU → drp_cn_line
 *  9. Variant suggestion overlay
 * 10. Finalize plan_run (status=COMPLETED, stats)
 *
 * Cron: 23:15 VN (primary) + 23:30 VN (retry) daily via setTimeout recursion.
 */
@Injectable()
export class DrpNettingV2Service implements OnApplicationBootstrap {
  private readonly logger = new Logger(DrpNettingV2Service.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly policyRunSvc: DrpPolicyRunService,
    private readonly ssCnSvc: DrpSsCnService,
    private readonly variantSvc: DrpVariantSuggestionService,
    private readonly freshnessGate: FreshnessGateService,
    private readonly cnAdjustSvc: CnAdjustService,
    private readonly systemConfigSvc: SystemConfigService,
  ) {}

  /** H2: populated by AllocationLcnbService.onModuleInit at bootstrap. */
  private _postCompletedHook: PostCompletedHook | null = null;

  /**
   * Register a post-COMPLETED callback. Called by AllocationModule (M24) to
   * receive DrpRunCompleted events without creating a circular module dep.
   * Replace-on-register semantics (single subscriber per process).
   */
  setPostCompletedHook(hook: PostCompletedHook): void {
    this._postCompletedHook = hook;
    this.logger.log(`post-COMPLETED hook registered (${hook.name || 'anonymous'})`);
  }

  /** G11 [DoD] — feature flag gate. Off → 503 / cron skip. */
  private async _isEnabled(): Promise<boolean> {
    return this.systemConfigSvc.isEnabled('m23_drp_netting_v2_enabled');
  }

  // ─── Lifecycle / Cron ──────────────────────────────────────────────────────

  onApplicationBootstrap() {
    this._scheduleNext(CRON_PRIMARY_VN, false);
    this._scheduleNext(CRON_RETRY_VN, true);
    this._scheduleCleanup(); // G14: daily retention cleanup 02:00 VN
  }

  /**
   * G14 [spec §7] — Retention cleanup job.
   * Runs daily 02:00 VN. Deletes plan_run + policy_run older than
   * `planning.snapshot_retention_days` (default 90). ON DELETE CASCADE handles
   * ss_cn and drp_cn_line.
   */
  private _scheduleCleanup() {
    const msUntil = this._msUntilVN('02:00');
    setTimeout(async () => {
      try {
        const deleted = await this.cleanupStaleRuns();
        this.logger.log(`[CRON 02:00] retention cleanup: ${deleted.planRuns} plan_runs + ${deleted.policyRuns} policy_runs deleted`);
      } catch (err) {
        this.logger.error(`[CRON 02:00] cleanup failed: ${(err as Error).message}`);
      } finally {
        this._scheduleCleanup();
      }
    }, msUntil);
  }

  async cleanupStaleRuns(): Promise<{ planRuns: number; policyRuns: number }> {
    const retentionRows: Array<{ config_value: string }> = await this.dataSource.query(
      `SELECT config_value FROM system_config WHERE config_key = 'planning.snapshot_retention_days' LIMIT 1`,
    );
    const days = Number(retentionRows[0]?.config_value ?? 90);

    const delPlan = await this.dataSource.query(
      `DELETE FROM plan_run
       WHERE created_at < NOW() - ($1 || ' days')::interval
         AND status IN ('COMPLETED','FAILED','CANCELLED')
       RETURNING id`,
      [days],
    );
    const delPolicy = await this.dataSource.query(
      `DELETE FROM policy_run
       WHERE created_at < NOW() - ($1 || ' days')::interval
         AND NOT EXISTS (SELECT 1 FROM plan_run WHERE policy_run_id = policy_run.id)
       RETURNING id`,
      [days],
    );
    return { planRuns: delPlan.length, policyRuns: delPolicy.length };
  }

  private _scheduleNext(targetVN: string, isRetry: boolean) {
    const msUntil = this._msUntilVN(targetVN);
    setTimeout(async () => {
      try {
        // G6 [spec §8 M3 fix] — retry cron SKIP silently if a RUNNING/COMPLETED
        // run already exists for today. Avoids duplicate-run ConflictException.
        if (isRetry) {
          const today = this._todayVN();
          const existing = await this.dataSource.query(
            `SELECT 1 FROM plan_run
             WHERE run_date = $1 AND status IN ('RUNNING','COMPLETED')
             LIMIT 1`,
            [today],
          );
          if (existing.length > 0) {
            this.logger.log(`[CRON ${targetVN}] skip retry — run already RUNNING/COMPLETED for ${today}`);
            return;
          }
        }
        // G11: cron skip if feature flag off
        if (!(await this._isEnabled())) {
          this.logger.log(`[CRON ${targetVN}] skip — m23_drp_netting_v2_enabled=false, fallback M4 owner`);
          return;
        }
        this.logger.log(`[CRON ${targetVN}] Starting nightly DRP netting v2`);
        await this.runV2({ createdBy: 'SYSTEM_NIGHTLY' });
      } catch (err) {
        this.logger.error(`[CRON ${targetVN}] DRP netting v2 failed: ${(err as Error).message}`);
      } finally {
        this._scheduleNext(targetVN, isRetry); // recurse for next day
      }
    }, msUntil);
  }

  /**
   * ms until next HH:MM in VN time (UTC+7).
   * BUG-M23-2 fix — aligned with M21 pattern (data-sync.service.ts).
   * Builds target via Date.UTC() on VN calendar date to avoid double-offset
   * + negative-hour wrap that caused brittle behavior for hh < 7 (e.g. cleanup 02:00).
   */
  private _msUntilVN(targetVN: string): number {
    const [hh, mm] = targetVN.split(':').map(Number);
    const nowMs = Date.now();
    const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000); // UTC-fields = VN wall time
    const fire = new Date(Date.UTC(
      vnNow.getUTCFullYear(),
      vnNow.getUTCMonth(),
      vnNow.getUTCDate(),
      hh - 7, mm, 0, 0,
    ));
    if (fire.getTime() <= nowMs) fire.setUTCDate(fire.getUTCDate() + 1);
    return fire.getTime() - nowMs;
  }

  // ─── Main Pipeline ─────────────────────────────────────────────────────────

  async runV2(opts: V2RunOptions = {}): Promise<V2RunResult> {
    // G11 feature flag gate
    if (!(await this._isEnabled())) {
      throw new ServiceUnavailableException(
        'M23 DRP Netting v2 is disabled (feature flag m23_drp_netting_v2_enabled=false)',
      );
    }
    const startedAt = Date.now();
    const runDate = this._todayVN(); // YYYY-MM-DD in VN timezone

    // Step 1: Freshness gate
    let isStaleOverride = false;
    let staleOverrideReason: string | null = null;
    let staleOverrideBy: string | null = null;

    const gate = await this.freshnessGate.check();
    if (!gate.canRun) {
      if (!opts.forceOverrideReason) {
        // C5 fix — persist BLOCKED_STALE plan_run for audit trail before
        // rejecting. H2: link latest FROZEN snapshots when available so the
        // blocked run points at the data that was stale.
        // Migration V004 made demand_snapshot_id / supply_snapshot_id nullable
        // for this exact flow (fresh system with no frozen snapshots).
        await this.dataSource.query(
          `INSERT INTO plan_run
             (demand_snapshot_id, supply_snapshot_id,
              status, run_date, created_by, started_at,
              stale_override_reason)
           VALUES (
             (SELECT snapshot_id FROM demand_snapshot WHERE status = 'FROZEN' ORDER BY created_at DESC LIMIT 1),
             (SELECT id FROM supply_snapshot WHERE status = 'FROZEN' ORDER BY capture_at DESC NULLS LAST, id DESC LIMIT 1),
             'BLOCKED_STALE', $1, $2, NOW(), $3
           )`,
          [
            runDate,
            opts.createdBy ?? 'SYSTEM_NIGHTLY',
            `Blocked by freshness gate: ${gate.staleNms.length} stale NMs (${gate.staleNms.slice(0, 5).join(', ')})`,
          ],
        );
        throw new BadRequestException(
          `Freshness gate blocked: ${gate.staleNms.length} stale NMs. plan_run logged as BLOCKED_STALE. Use forceOverrideReason to bypass.`,
        );
      }
      isStaleOverride = true;
      staleOverrideReason = opts.forceOverrideReason;
      staleOverrideBy = opts.forceOverrideBy ?? opts.createdBy ?? 'UNKNOWN';
    }

    // Step 2: Idempotent daily run check (uq_plan_run_date_completed)
    const existingCompleted = await this.dataSource.query(
      `SELECT id FROM plan_run WHERE run_date = $1 AND status = 'COMPLETED' LIMIT 1`,
      [runDate],
    );
    if (existingCompleted.length > 0 && !opts.forceOverrideReason) {
      throw new ConflictException(
        `DRP run already COMPLETED for ${runDate}. Use forceOverrideReason to override.`,
      );
    }

    // Steps 3+4 [M1 fix, spec §14.2] — atomic: policy_run INSERT + plan_run INSERT
    // share one transaction so a partial failure cannot leave an orphan policy_run.
    // Compute (SS, netting, drp_cn_line) runs OUTSIDE this tx to avoid long locks.
    const planRunStatus = isStaleOverride ? 'FORCE_OVERRIDDEN' : 'RUNNING';
    const isForceRerun = Boolean(opts.forceOverrideReason) && existingCompleted.length > 0;

    let policy: PolicySnapshot;
    let planRunId: string;
    try {
      const txResult = await this.dataSource.transaction(async (em) => {
        const pol = await this.policyRunSvc.createPolicyRun(
          opts.createdBy ?? 'SYSTEM_NIGHTLY',
          `Nightly DRP v2 run for ${runDate}`,
          em,
        );
        const rows: Array<{ id: string }> = await em.query(
          `INSERT INTO plan_run
             (demand_snapshot_id, supply_snapshot_id, status,
              policy_run_id, is_stale_override, stale_override_reason, stale_override_by,
              run_date, is_force_rerun, created_by, started_at)
           VALUES (
             (SELECT snapshot_id FROM demand_snapshot WHERE status = 'FROZEN' ORDER BY created_at DESC LIMIT 1),
             (SELECT id FROM supply_snapshot   WHERE status = 'FROZEN' ORDER BY capture_at DESC NULLS LAST, id DESC LIMIT 1),
             $1, $2, $3, $4, $5, $6, $7, $8, NOW()
           )
           RETURNING id`,
          [
            planRunStatus, pol.policyRunId, isStaleOverride,
            staleOverrideReason, staleOverrideBy, runDate,
            isForceRerun, opts.createdBy ?? 'SYSTEM_NIGHTLY',
          ],
        );
        return { policy: pol, planRunId: rows[0].id };
      });
      policy = txResult.policy;
      planRunId = txResult.planRunId;
    } catch (err) {
      throw new Error(`Failed to create policy_run/plan_run: ${(err as Error).message}`);
    }
    this.logger.log(`plan_run #${planRunId} created (status=${planRunStatus})`);

    try {
      // Step 5: BA re-review C4 — M22 returns per-week Map<"cnId|skuId", qty>.
      // We loop 12 planning weeks, so build a composite map keyed by
      // "cnId|skuId|weekStart" so each week picks up only its own adjustments.
      const m22Map = new Map<string, number>(); // key: cnId|skuId|YYYY-MM-DD
      let m22Unavailable = false;

      // Step 6: Load supply — BA re-review C2 fix:
      // supply_snapshot_line.allocatable_qty = GREATEST(0, SUM(on_hand_qty) - SUM(reserved_qty))
      // ALREADY nets reserved_qty (see supply.service.ts:63). Subtracting it again
      // = double penalty → false STOCKOUT_RISK. Use allocatable_qty as-is,
      // with override_qty precedence per supply module convention.
      const supplyRows: SupplyRow[] = await this.dataSource.query(
        `SELECT
           c.id::text   AS cn_id,
           s.id::text   AS sku_id,
           SUM(COALESCE(ssl.override_qty, ssl.allocatable_qty))::float AS on_hand,
           SUM(ssl.in_transit_qty)::float                               AS in_transit
         FROM supply_snapshot_line ssl
         JOIN supply_snapshot ss ON ss.id = ssl.snapshot_id
         JOIN sku s              ON s.sku_code = ssl.item_code
         JOIN channel c          ON c.channel_code = ssl.location_code
         WHERE ss.id = (
           SELECT id FROM supply_snapshot WHERE status = 'FROZEN' ORDER BY capture_at DESC NULLS LAST, id DESC LIMIT 1
         )
         GROUP BY c.id, s.id`,
      );

      const supplyMap = new Map<string, { onHand: number; inTransit: number }>();
      for (const r of supplyRows) {
        supplyMap.set(`${r.cn_id}|${r.sku_id}`, {
          onHand: Number(r.on_hand),
          inTransit: Number(r.in_transit),
        });
      }

      // Step 7: Compute SS per CN×SKU
      const ssMap: SsMap = await this.ssCnSvc.computeAll(planRunId, policy);

      // Step 8 + 9: Per-CN netting across 12 planning weeks
      const demandRows: DemandRow[] = await this._loadFcDemand();

      // C4 fix: fetch M22 adjustments per distinct planning week → 3-part map.
      // getEffectiveDemand(weekStart) returns Map<"cnId|skuId", qty> for that week only.
      const uniqueWeeks = Array.from(new Set(demandRows.map((r) => r.period_start)));
      for (const week of uniqueWeeks) {
        try {
          const perWeek = await this.cnAdjustSvc.getEffectiveDemand(week);
          for (const [k, v] of perWeek) {
            m22Map.set(`${k}|${week}`, v);
          }
        } catch (err) {
          m22Unavailable = true;
          this.logger.warn(
            `plan_run #${planRunId}: M22 getEffectiveDemand(${week}) failed — fallback FC raw for this week. ${(err as Error).message}`,
          );
        }
      }

      // Pre-load variant suggestions per (cn, sku)
      const uniquePairs = Array.from(
        new Map(demandRows.map((r) => [`${r.cn_id}|${r.sku_id}`, { cnId: r.cn_id, skuId: r.sku_id }])).values(),
      );
      await this.variantSvc.preload(uniquePairs);

      // G3: compute hub_available = Σ(on_hand) across all CNs (Phase 1 hub ảo)
      let hubAvailable = 0;
      for (const s of supplyMap.values()) hubAvailable += s.onHand;

      const lines: Omit<DrpCnLine, 'id' | 'planRun' | 'createdAt'>[] = [];
      let m22Count = 0;
      let fcRawCount = 0;

      for (const dr of demandRows) {
        const ssKey = `${dr.cn_id}|${dr.sku_id}`;                       // SS is week-invariant
        const m22Key = `${dr.cn_id}|${dr.sku_id}|${dr.period_start}`;   // C4: include week
        const m22Qty = m22Map.get(m22Key);
        const effectiveDemand = m22Qty !== undefined ? m22Qty : dr.fc_qty;
        const effectiveDemandSource = m22Qty !== undefined ? 'M22_ADJUSTED' : 'FC_RAW';
        if (m22Qty !== undefined) m22Count++; else fcRawCount++;

        const supply = supplyMap.get(ssKey) ?? { onHand: 0, inTransit: 0 };
        const ssFinal = ssMap.get(ssKey) ?? 0;

        // G15 [spec §5 Step 7] — net can be negative (OVER_STOCK signal).
        // Do NOT clamp to 0; M24 uses negative net to identify donor candidates.
        const netDemand = effectiveDemand - supply.onHand - supply.inTransit + ssFinal;

        let lineStatus: DrpCnLine['status'] = 'NORMAL';
        if (netDemand < 0) {
          lineStatus = 'OVER_STOCK';
        } else if (netDemand > hubAvailable) {
          lineStatus = 'STOCKOUT_RISK';
        }

        const vs = this.variantSvc.suggest(dr.cn_id, dr.sku_id, netDemand);

        lines.push({
          planRunId,
          cnId: dr.cn_id,
          skuId: dr.sku_id,
          periodStart: dr.period_start,
          effectiveDemand,
          effectiveDemandSource,
          onHand: supply.onHand,
          inTransit: supply.inTransit,
          ssFinal,
          netDemand,
          status: lineStatus,
          variantSuggestion: vs.suggestion,
          plannerReviewRequired: vs.plannerReviewRequired,
          reviewReason: vs.reviewReason,
        });
      }

      // Bulk insert drp_cn_line in chunks of 500
      for (let i = 0; i < lines.length; i += CHUNK_SIZE) {
        await this._bulkInsertLines(lines.slice(i, i + CHUNK_SIZE));
      }

      const durationMs = Date.now() - startedAt;
      const effectiveDemandSource = { m22Count, fcRawCount, m22Unavailable };

      // Step 10: Finalize plan_run via validated transition (M2 fix).
      await this.transitionPlanRun(planRunId, 'COMPLETED', {
        actor: opts.createdBy ?? 'SYSTEM',
        extraFields: {
          effective_demand_source: effectiveDemandSource,
          combinations_processed: lines.length,
          planned_orders_count:   lines.filter((l) => l.netDemand > 0).length,
          exceptions_count:       lines.filter((l) => l.status !== 'NORMAL').length,
          duration_ms:            durationMs,
        },
      });

      this.logger.log(
        `plan_run #${planRunId} COMPLETED in ${durationMs}ms — ` +
          `${lines.length} lines, m22=${m22Count}, fcRaw=${fcRawCount}`,
      );

      // H2: fire post-COMPLETED hook (M24 auto-trigger per spec §7).
      // Fire-and-forget: M24 failure must NOT rollback M23 success.
      if (this._postCompletedHook) {
        try {
          await this._postCompletedHook(planRunId, opts.createdBy ?? 'SYSTEM_NIGHTLY');
        } catch (hookErr) {
          this.logger.warn(
            `plan_run #${planRunId} COMPLETED but post-hook failed: ${(hookErr as Error).message}`,
          );
        }
      }

      return {
        planRunId,
        status: 'COMPLETED',
        plannedOrdersCount: lines.filter((l) => l.netDemand > 0).length,
        exceptionsCount: lines.filter((l) => l.status !== 'NORMAL').length,
        combinationsProcessed: lines.length,
        durationMs,
        effectiveDemandSource,
      };
    } catch (err) {
      // M2 fix: use validated transition. Swallow InvalidTransitionException
      // because the run may already be in a terminal state from a prior failure.
      try {
        await this.transitionPlanRun(planRunId, 'FAILED', {
          actor: opts.createdBy ?? 'SYSTEM',
          reason: (err as Error).message,
        });
      } catch (tErr) {
        this.logger.warn(`plan_run #${planRunId} FAILED transition skipped: ${(tErr as Error).message}`);
      }
      this.logger.error(`plan_run #${planRunId} FAILED: ${(err as Error).message}`);
      throw err;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async _loadFcDemand(): Promise<DemandRow[]> {
    // BA re-review C1 — real cols: snapshot_id (not demand_snapshot_id),
    // period_start (not period_date), qty (not quantity).
    // demand_snapshot PK column alias = snapshot_id (uuid).
    return this.dataSource.query(
      `SELECT
         c.id::text                                          AS cn_id,
         s.id::text                                          AS sku_id,
         date_trunc('week', dsl.period_start)::date::text   AS period_start,
         SUM(dsl.qty)::float                                 AS fc_qty
       FROM demand_snapshot_line dsl
       JOIN demand_snapshot ds  ON ds.snapshot_id = dsl.snapshot_id AND ds.status = 'FROZEN'
       JOIN sku s               ON s.sku_code = dsl.item_code
       JOIN channel c           ON c.channel_code = dsl.location_code
       WHERE ds.snapshot_id = (
         SELECT snapshot_id FROM demand_snapshot WHERE status = 'FROZEN' ORDER BY created_at DESC LIMIT 1
       )
         AND dsl.period_start >= CURRENT_DATE
         AND dsl.period_start <  CURRENT_DATE + INTERVAL '12 weeks'
       GROUP BY c.id, s.id, date_trunc('week', dsl.period_start)
       ORDER BY cn_id, sku_id, period_start`,
    );
  }

  private async _bulkInsertLines(
    rows: Omit<DrpCnLine, 'id' | 'planRun' | 'createdAt'>[],
  ): Promise<void> {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;

    for (const r of rows) {
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
      );
      values.push(
        r.planRunId, r.cnId, r.skuId, r.periodStart,
        r.effectiveDemand, r.effectiveDemandSource,
        r.onHand, r.inTransit, r.ssFinal, r.netDemand,
        r.status,
        r.variantSuggestion ? JSON.stringify(r.variantSuggestion) : null,
        r.plannerReviewRequired,
        r.reviewReason,
      );
    }

    await this.dataSource.query(
      `INSERT INTO drp_cn_line
         (plan_run_id, cn_id, sku_id, period_start,
          effective_demand, effective_demand_source,
          on_hand, in_transit, ss_final, net_demand,
          status, variant_suggestion,
          planner_review_required, review_reason)
       VALUES ${placeholders.join(',')}
       ON CONFLICT (plan_run_id, cn_id, sku_id, period_start) DO NOTHING`,
      values,
    );
  }

  /**
   * G4 [spec §14.7] Validated status transition + audit log.
   * Throws InvalidTransitionException on bad transition.
   */
  async transitionPlanRun(
    planRunId: string,
    newStatus: string,
    opts: {
      actor?: string;
      reason?: string | null;
      /** M2 fix: extra columns to SET in the same UPDATE (e.g. finalize stats). */
      extraFields?: Record<string, unknown>;
    } = {},
  ): Promise<void> {
    const rows: Array<{ status: string }> = await this.dataSource.query(
      `SELECT status FROM plan_run WHERE id = $1`,
      [planRunId],
    );
    if (rows.length === 0) throw new NotFoundException(`plan_run #${planRunId} not found`);
    const from = rows[0].status;
    const allowed = STATUS_TRANSITIONS[from] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new InvalidTransitionException(from, newStatus);
    }

    const sets: string[] = [`status = $1`];
    const params: unknown[] = [newStatus];
    let p = 2;
    const extra = opts.extraFields ?? {};
    for (const [col, val] of Object.entries(extra)) {
      sets.push(`${col} = $${p++}`);
      params.push(val);
    }
    sets.push(
      `completed_at = CASE WHEN $1 IN ('COMPLETED','FAILED','CANCELLED') THEN NOW() ELSE completed_at END`,
    );
    params.push(planRunId);
    await this.dataSource.query(
      `UPDATE plan_run SET ${sets.join(', ')} WHERE id = $${p}`,
      params,
    );

    const actor = opts.actor ?? 'SYSTEM';
    this.logger.log(
      `plan_run #${planRunId} transition: ${from} → ${newStatus} by ${actor}${opts.reason ? ` (${opts.reason})` : ''}`,
    );
  }

  private _todayVN(): string {
    const vnOffset = 7 * 60 * 60 * 1000;
    const d = new Date(Date.now() + vnOffset);
    return d.toISOString().slice(0, 10);
  }

  // ─── Read API (for M24 injection) ─────────────────────────────────────────

  /**
   * M23 → M24 contract (spec §14.1).
   * Returns DrpResultDto keyed by drpCellKey(cnId, skuId, periodStart).
   * Throws if plan run is not COMPLETED.
   */
  async getDrpResult(planRunId: string): Promise<DrpResultDto> {
    const run: Array<{ id: string; status: string; policy_run_id: string | null; completed_at: Date | null }> =
      await this.dataSource.query(
        `SELECT id, status, policy_run_id, completed_at FROM plan_run WHERE id = $1`,
        [planRunId],
      );
    if (run.length === 0) throw new NotFoundException(`plan_run #${planRunId} not found`);
    if (run[0].status !== 'COMPLETED') {
      throw new BadRequestException(
        `plan_run #${planRunId} is ${run[0].status} — not COMPLETED`,
      );
    }

    const rows: Array<{
      cn_id: string;
      sku_id: string;
      period_start: string;
      effective_demand: number;
      effective_demand_source: string;
      on_hand: number;
      in_transit: number;
      ss_final: number;
      net_demand: number;
      status: string;
      variant_suggestion: Record<string, number> | null;
      planner_review_required: boolean;
      review_reason: string | null;
    }> = await this.dataSource.query(
      `SELECT cn_id::text, sku_id::text, period_start::text,
              effective_demand::float, effective_demand_source,
              on_hand::float, in_transit::float, ss_final::float, net_demand::float,
              status, variant_suggestion,
              planner_review_required, review_reason
       FROM drp_cn_line
       WHERE plan_run_id = $1`,
      [planRunId],
    );

    const lines = new Map<string, DrpCellDto>();
    for (const r of rows) {
      lines.set(drpCellKey(r.cn_id, r.sku_id, r.period_start), {
        cnId: r.cn_id,
        skuId: r.sku_id,
        periodStart: r.period_start,
        effectiveDemand: Number(r.effective_demand),
        effectiveDemandSource: r.effective_demand_source as DrpCellDto['effectiveDemandSource'],
        onHand: Number(r.on_hand),
        inTransit: Number(r.in_transit),
        ssFinal: Number(r.ss_final),
        netDemand: Number(r.net_demand),
        status: r.status as DrpCellDto['status'],
        variantSuggestion: r.variant_suggestion,
        plannerReviewRequired: Boolean(r.planner_review_required),
        reviewReason: r.review_reason,
      });
    }

    return {
      planRunId: String(run[0].id),
      policyRunId: run[0].policy_run_id,
      generatedAt: run[0].completed_at ?? new Date(),
      lines,
    };
  }

  /**
   * G10 spec §7 — Policy snapshot viewer (audit).
   */
  async getPolicySnapshot(planRunId: string): Promise<{
    policyRunId: string;
    createdAt: Date;
    configSnapshot: Record<string, unknown>;
    masterDataSnapshot: unknown;
  }> {
    const rows: Array<{
      policy_run_id: string;
      created_at: Date;
      config_snapshot: Record<string, unknown>;
      master_data_snapshot: unknown;
    }> = await this.dataSource.query(
      `SELECT pr.policy_run_id::text, pol.created_at, pol.config_snapshot, pol.master_data_snapshot
       FROM plan_run pr
       JOIN policy_run pol ON pol.id = pr.policy_run_id
       WHERE pr.id = $1`,
      [planRunId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`policy_run for plan_run #${planRunId} not found`);
    }
    return {
      policyRunId: rows[0].policy_run_id,
      createdAt: rows[0].created_at,
      configSnapshot: rows[0].config_snapshot,
      masterDataSnapshot: rows[0].master_data_snapshot,
    };
  }

  /**
   * G10 spec §7 — SS summary per cell for a plan run.
   */
  async getSsSummary(planRunId: string, cnId?: string) {
    const conditions = [`plan_run_id = $1`];
    const params: unknown[] = [planRunId];
    if (cnId) {
      conditions.push(`cn_id = $2`);
      params.push(cnId);
    }
    return this.dataSource.query(
      `SELECT cn_id::text, sku_id::text,
              sigma_rolling::float, sigma_seasonal::float, sigma_final::float,
              z_used::float, lt_hub_days::float,
              ss_base::float, lcnb_reduction_pct::float, ss_final::float,
              source, is_critical
       FROM ss_cn
       WHERE ${conditions.join(' AND ')}
       ORDER BY cn_id, sku_id`,
      params,
    );
  }

  /** List v2 runs (newest first). */
  async listV2Runs(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.dataSource.query(
        `SELECT pr.*, pol.created_at AS policy_created_at
         FROM plan_run pr
         LEFT JOIN policy_run pol ON pol.id = pr.policy_run_id
         WHERE pr.policy_run_id IS NOT NULL
         ORDER BY pr.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*) FROM plan_run WHERE policy_run_id IS NOT NULL`,
      ),
    ]);
    return { data: rows, total: Number(total[0].count), page, limit };
  }

  /** Get drp_cn_line with optional CN/SKU filter + pagination. */
  async listLines(
    planRunId: string,
    opts: { cnId?: string; skuId?: string; status?: string; page?: number; limit?: number },
  ) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const offset = (page - 1) * limit;
    const conditions = [`plan_run_id = $1`];
    const params: unknown[] = [planRunId];
    let pIdx = 2;

    if (opts.cnId) { conditions.push(`cn_id = $${pIdx++}`); params.push(opts.cnId); }
    if (opts.skuId) { conditions.push(`sku_id = $${pIdx++}`); params.push(opts.skuId); }
    if (opts.status) { conditions.push(`status = $${pIdx++}`); params.push(opts.status); }

    const where = conditions.join(' AND ');
    const [rows, total] = await Promise.all([
      this.dataSource.query(
        `SELECT * FROM drp_cn_line WHERE ${where} ORDER BY cn_id, sku_id, period_start LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.dataSource.query(`SELECT COUNT(*) FROM drp_cn_line WHERE ${where}`, params),
    ]);

    return { data: rows, total: Number(total[0].count), page, limit };
  }
}
