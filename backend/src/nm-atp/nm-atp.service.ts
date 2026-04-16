import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PoReviewService } from '../po-review/po-review.service';
import { AllocationLcnbService } from '../allocation/allocation.lcnb.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { FreshnessGateService, NmFreshnessResult } from '../data-sync/freshness-gate.service';
import { AtpClassificationService } from './atp-classification.service';
import { UrgencyRankingService } from './urgency-ranking.service';
import { atpCellKey } from '../common/atp-utils';
import { AtpResultDto, AtpCheckDto, RunAtpOptions, RunAtpResult } from './dto';

/**
 * Thrown when M27 calls getAtpResult() before atp_run is COMPLETED.
 * M27 must retry / wait.
 */
export class AtpRunNotCompletedException extends BadRequestException {
  constructor(allocationRunId: string, status: string) {
    super(`ATP run for allocation_run #${allocationRunId} is ${status}, not COMPLETED. Retry when done.`);
  }
}

/**
 * M26 — NM ATP Check & Urgency Ranking orchestrator.
 *
 * Pipeline (§4):
 *  1. Validate: M24 COMPLETED, flag check, R10 idempotent
 *  2. Policy snapshot pin (Rule 14)
 *  3. Create atp_run (RUNNING)
 *  4. Load requested qty per (NM, SKU, week) via sku_nm_mapping (C1 fix)
 *  5. Preload freshness map (H4) + NM supply ATP qtys
 *  6. For each cell: classify PASS/PARTIAL/FAIL/BLOCKED (R2/R3/H1)
 *  7. For PARTIAL cells: urgency ranking (R4-R6, C3)
 *  8. Finalize atp_run COMPLETED (run status ≠ BLOCKED — H2 fix)
 *
 * Trigger: M24 event listener (parallel with M25) OR manual POST /nm-atp/run.
 */
@Injectable()
export class NmAtpService {
  private readonly logger = new Logger(NmAtpService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly allocationSvc: AllocationLcnbService,
    private readonly freshnessGateSvc: FreshnessGateService,
    private readonly classificationSvc: AtpClassificationService,
    private readonly urgencyRankingSvc: UrgencyRankingService,
    private readonly systemConfigSvc: SystemConfigService,
    @Optional() @Inject(forwardRef(() => PoReviewService)) private readonly poReviewSvc?: PoReviewService,
  ) {}

  // ─── Public API ─────────────────────────────────────────────────────────────

  async run(opts: RunAtpOptions): Promise<RunAtpResult> {
    if (!(await this.systemConfigSvc.isEnabled('m26_nm_atp_enabled'))) {
      throw new ServiceUnavailableException('M26 ATP Check disabled (feature flag m26_nm_atp_enabled=false)');
    }
    const startedAt = Date.now();

    // R10: idempotent guard
    const existing: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM atp_run WHERE allocation_run_id = $1 AND is_force_rerun = FALSE LIMIT 1`,
      [opts.allocationRunId],
    );
    if (existing.length > 0 && !opts.forceRerunReason) {
      throw new ConflictException(
        `ATP run exists for allocation_run #${opts.allocationRunId}. Use forceRerunReason to override.`,
      );
    }
    if (opts.forceRerunReason && opts.forceRerunReason.length < 20) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }
    const isForceRerun = Boolean(opts.forceRerunReason) && existing.length > 0;

    // Step 1: M24 allocation result (validates COMPLETED)
    const allocResult = await this.allocationSvc.getAllocationResult(opts.allocationRunId);
    const policyRunId = allocResult.policyRunId;
    const planRunId = allocResult.planRunId;

    // Step 2: Policy config (Rule 14 pin)
    const atpStaleThresholdH = await this._cfgNum('atp.staleness_threshold_hours', policyRunId, 24);

    // Step 3: Create atp_run
    const runRows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO atp_run
         (allocation_run_id, plan_run_id, policy_run_id, status,
          is_force_rerun, force_rerun_reason, created_by)
       VALUES ($1, $2, $3, 'RUNNING', $4, $5, $6)
       RETURNING id::text`,
      [
        opts.allocationRunId, planRunId, policyRunId,
        isForceRerun, opts.forceRerunReason ?? null,
        opts.createdBy ?? 'SYSTEM_NIGHTLY',
      ],
    );
    const atpRunId = runRows[0].id;
    this.logger.log(`atp_run #${atpRunId} created for allocation_run #${opts.allocationRunId}`);

    try {
      // Step 4: Load requested per (NM, SKU, week) via sku_nm_mapping (C1 fix)
      const requestedCells = await this._loadRequestedCells(opts.allocationRunId);

      // Preloads — done ONCE per run for performance (< 1min target §9)
      // H4: freshness map preloaded from M21 checkAll()
      const freshnessMap = await this._buildFreshnessMap(atpStaleThresholdH);
      // Supply ATP qtys preloaded per NM (line-level, C2 fix)
      const atpQtyMap = await this._preloadAtpQtys(requestedCells);
      // Transport lane LT map for urgency ranking (NM_TO_CN lanes)
      const ltMap = await this._preloadNmToCnLt(requestedCells);
      // HSTK map preloaded for all CN involved
      const hstkMap = await this._preloadHstk(requestedCells);
      // CN code lookup map (cnId → cnCode for urgency entries)
      const cnCodeMap = await this._preloadCnCodes(requestedCells);

      // Steps 5-7: classify + rank
      let passCount = 0, partialCount = 0, failCount = 0, blockedCount = 0, criticalCount = 0;

      for (const cell of requestedCells) {
        const nmIdStr = String(cell.nm_id);
        const skuIdStr = String(cell.sku_id);

        // H4: freshness check per NM
        const isFresh = freshnessMap.get(nmIdStr) ?? false;

        // C2: ATP qty from supply_snapshot_line.atp_qty (line-level)
        const { atpQty, isAtpNullFallback } = atpQtyMap.get(`${nmIdStr}|${skuIdStr}`) ?? {
          atpQty: null,
          isAtpNullFallback: true,
        };

        // Classify (R2/H1/H6)
        // BUG-2 fix: pass atpQty directly — _preloadAtpQtys() already applied allocatable_qty fallback
        const classified = this.classificationSvc.classify({
          atpQty,
          requestedQty: Number(cell.requested_qty),
          isFresh,
        });

        // For BLOCKED, effectiveAtpQty stays null (stale data — cannot conclude)
        const finalAtpQty = classified.result === 'BLOCKED' ? null : (atpQty ?? 0);

        // Urgency ranking for PARTIAL (R4-R6, C3)
        let urgencyRanking: import('./entities/atp-check.entity').UrgencyRankEntry[] | null = null;
        if (classified.result === 'PARTIAL') {
          const recipients = await this._loadCellRecipients(
            opts.allocationRunId, nmIdStr, skuIdStr, cell.period_start,
          );
          const rankEntries = this.urgencyRankingSvc.rank({
            atpQty: Number(atpQty ?? 0),
            recipients: recipients.map((r) => ({
              cnId: String(r.cn_id),
              cnCode: cnCodeMap.get(String(r.cn_id)) ?? `CN-${r.cn_id}`,
              requestedQty: Number(r.requested_qty),
            })),
            hstkMap,
            ltMap: this._buildCnLtMap(ltMap, nmIdStr),
          });
          urgencyRanking = rankEntries;
          criticalCount += rankEntries.filter((e) => e.isCritical).length;
        }

        // INSERT atp_check
        await this.dataSource.query(
          `INSERT INTO atp_check
             (atp_run_id, allocation_run_id, plan_run_id, policy_run_id,
              nm_id, sku_id, period_start,
              requested_qty, atp_qty, result, reason, is_atp_null_fallback, urgency_ranking)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           ON CONFLICT (atp_run_id, nm_id, sku_id, period_start) DO NOTHING`,
          [
            atpRunId, opts.allocationRunId, planRunId, policyRunId,
            cell.nm_id, cell.sku_id, cell.period_start,
            cell.requested_qty, finalAtpQty,
            classified.result, classified.reason, classified.isAtpNullFallback || isAtpNullFallback,
            urgencyRanking ? JSON.stringify(urgencyRanking) : null,
          ],
        );

        switch (classified.result) {
          case 'PASS':    passCount++;    break;
          case 'PARTIAL': partialCount++; break;
          case 'FAIL':    failCount++;    break;
          case 'BLOCKED': blockedCount++; break;
        }
      }

      const totalCells = requestedCells.length;
      const durationMs = Date.now() - startedAt;

      // Step 8: finalize (H2 fix: COMPLETED even if cells have BLOCKED)
      await this.dataSource.query(
        `UPDATE atp_run
           SET status = 'COMPLETED', completed_at = NOW(), duration_ms = $1,
               total_cells = $2, pass_count = $3, partial_count = $4,
               fail_count = $5, blocked_count = $6, critical_count = $7
         WHERE id = $8`,
        [durationMs, totalCells, passCount, partialCount, failCount, blockedCount, criticalCount, atpRunId],
      );

      this.logger.log(
        `atp_run #${atpRunId} COMPLETED in ${durationMs}ms — ` +
          `${totalCells} cells: PASS=${passCount} PARTIAL=${partialCount} FAIL=${failCount} BLOCKED=${blockedCount} CRITICAL=${criticalCount}`,
      );

      // H3 fix: notify M27 AND correlation gate
      this.poReviewSvc?.onM26AtpCompleted(opts.allocationRunId, atpRunId).catch(e =>
        this.logger.error(`M27 onM26AtpCompleted callback failed: ${e?.message}`),
      );

      return {
        atpRunId,
        status: 'COMPLETED',
        totalCells,
        passCount,
        partialCount,
        failCount,
        blockedCount,
        criticalCount,
        durationMs,
      };
    } catch (err) {
      await this.dataSource.query(
        `UPDATE atp_run SET status = 'FAILED' WHERE id = $1`,
        [atpRunId],
      );
      throw err;
    }
  }

  /**
   * M27 contract (M2 sweep — keyed by allocationRunId, NOT planRunId).
   * Throws AtpRunNotCompletedException if not COMPLETED → M27 waits/retries.
   */
  async getAtpResult(allocationRunId: string): Promise<AtpResultDto> {
    const runRows: Array<{
      id: string; plan_run_id: string; status: string; completed_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT id::text, plan_run_id::text, status, completed_at
       FROM atp_run
       WHERE allocation_run_id = $1
       ORDER BY created_at DESC LIMIT 1`,
      [allocationRunId],
    );
    if (runRows.length === 0) {
      throw new NotFoundException(`No ATP run found for allocation_run #${allocationRunId}`);
    }
    const run = runRows[0];
    if (run.status !== 'COMPLETED') {
      throw new AtpRunNotCompletedException(allocationRunId, run.status);
    }

    const checkRows: Array<{
      id: string; nm_id: string; sku_id: string; period_start: string;
      requested_qty: number; atp_qty: number | null;
      result: string; reason: string | null;
      is_atp_null_fallback: boolean;
      urgency_ranking: any;
    }> = await this.dataSource.query(
      `SELECT id::text, nm_id::text, sku_id::text, period_start::text,
              requested_qty::float, atp_qty::float,
              result, reason, is_atp_null_fallback, urgency_ranking
       FROM atp_check WHERE atp_run_id = $1`,
      [run.id],
    );

    const checks = new Map<string, AtpCheckDto>();
    for (const r of checkRows) {
      const key = atpCellKey(r.nm_id, r.sku_id, r.period_start);
      checks.set(key, {
        checkId: r.id,
        nmId: r.nm_id,
        skuId: r.sku_id,
        periodStart: r.period_start,
        requestedQty: Number(r.requested_qty),
        atpQty: r.atp_qty !== null ? Number(r.atp_qty) : null,
        result: r.result as AtpCheckDto['result'],
        reason: r.reason,
        isAtpNullFallback: Boolean(r.is_atp_null_fallback),
        urgencyRanking: r.urgency_ranking ?? null,
      });
    }

    return {
      atpRunId: run.id,
      allocationRunId,
      planRunId: run.plan_run_id,
      generatedAt: run.completed_at ?? new Date(),
      checks,
    };
  }

  // ─── Read API ──────────────────────────────────────────────────────────────

  async listRuns(opts: { status?: string; allocationRunId?: string; page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1, limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) { conditions.push(`status = $${params.length + 1}`); params.push(opts.status); }
    if (opts.allocationRunId) { conditions.push(`allocation_run_id = $${params.length + 1}`); params.push(opts.allocationRunId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [data, total] = await Promise.all([
      this.dataSource.query(`SELECT * FROM atp_run ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM atp_run ${where}`, params),
    ]);
    return { data, total: total[0].c, page, limit };
  }

  async getRunDetail(runId: string) {
    const runs = await this.dataSource.query(`SELECT * FROM atp_run WHERE id = $1`, [runId]);
    if (runs.length === 0) throw new NotFoundException(`atp_run #${runId} not found`);
    return runs[0];
  }

  async listChecks(runId: string, opts: { nmId?: string; result?: string } = {}) {
    const conditions = [`atp_run_id = $1`];
    const params: unknown[] = [runId];
    if (opts.nmId) { conditions.push(`nm_id = $${params.length + 1}`); params.push(opts.nmId); }
    if (opts.result) { conditions.push(`result = $${params.length + 1}`); params.push(opts.result); }
    return this.dataSource.query(
      `SELECT * FROM atp_check WHERE ${conditions.join(' AND ')} ORDER BY nm_id, sku_id, period_start`,
      params,
    );
  }

  async getCritical(runId: string) {
    return this.dataSource.query(
      `SELECT * FROM atp_check
       WHERE atp_run_id = $1
         AND result = 'PARTIAL'
         AND urgency_ranking @> '[{"isCritical": true}]'
       ORDER BY nm_id, sku_id`,
      [runId],
    );
  }

  async getUrgencyDetail(checkId: string) {
    const rows = await this.dataSource.query(
      `SELECT id::text, nm_id::text, sku_id::text, period_start::text,
              atp_qty::float, requested_qty::float, result, urgency_ranking
       FROM atp_check WHERE id = $1`,
      [checkId],
    );
    if (rows.length === 0) throw new NotFoundException(`atp_check #${checkId} not found`);
    return rows[0];
  }

  async listHonoring(opts: { nmId?: string; fromMonth?: string; toMonth?: string } = {}) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.nmId) { conditions.push(`nm_id = $${params.length + 1}`); params.push(opts.nmId); }
    if (opts.fromMonth) { conditions.push(`period_month >= $${params.length + 1}`); params.push(opts.fromMonth); }
    if (opts.toMonth) { conditions.push(`period_month <= $${params.length + 1}`); params.push(opts.toMonth); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return this.dataSource.query(`SELECT * FROM nm_honoring_rate ${where} ORDER BY nm_id, period_month DESC`, params);
  }

  async getHonoringLeaderboard() {
    return this.dataSource.query(
      `SELECT s.supplier_code, s.supplier_name, s.nm_unreliable_badge,
              h.rolling_3m_rate, h.rate AS last_month_rate, h.period_month
       FROM nm_honoring_rate h
       JOIN supplier s ON s.id = h.nm_id
       WHERE h.period_month = (SELECT MAX(period_month) FROM nm_honoring_rate WHERE nm_id = h.nm_id)
       ORDER BY h.rolling_3m_rate DESC NULLS LAST`,
    );
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** C1 fix: resolve NM lineage via sku_nm_mapping (single-source). Skip CN_REDIST (R12). */
  private async _loadRequestedCells(allocationRunId: string): Promise<Array<{
    nm_id: string; sku_id: string; period_start: string; requested_qty: number;
  }>> {
    return this.dataSource.query(
      `SELECT
         m.nm_id::text,
         ar.sku_id::text,
         -- R13/H7: top-up legs use source_period_start for ATP period
         CASE
           WHEN ar.is_top_up = TRUE THEN ar.source_period_start::text
           ELSE ar.period_start::text
         END AS period_start,
         SUM(leg.allocated_qty)::float AS requested_qty
       FROM allocation_leg leg
       JOIN allocation_result ar ON ar.id = leg.allocation_result_id
       JOIN sku_nm_mapping m ON m.sku_id = ar.sku_id AND m.active = TRUE
       WHERE ar.allocation_run_id = $1
         AND leg.source_type IN ('HUB', 'NM', 'TOP_UP_NEXT_WEEK')
       GROUP BY m.nm_id, ar.sku_id,
         CASE WHEN ar.is_top_up = TRUE THEN ar.source_period_start ELSE ar.period_start END`,
      [allocationRunId],
    );
  }

  /**
   * H4 fix: preload freshness for all active NMs using M21 FreshnessGateService.checkAll().
   * Returns Map<nmId, isFresh> — keyed by supplier.id (not code).
   */
  private async _buildFreshnessMap(stalenessThresholdH: number): Promise<Map<string, boolean>> {
    const freshnessResults: NmFreshnessResult[] = await this.freshnessGateSvc.checkAll();

    // Resolve supplier_code → supplier.id
    const nmCodes = freshnessResults.map((r) => r.nmCode);
    if (nmCodes.length === 0) return new Map();

    const supplierRows: Array<{ id: string; supplier_code: string }> = await this.dataSource.query(
      `SELECT id::text, supplier_code FROM supplier WHERE supplier_code = ANY($1::varchar[])`,
      [nmCodes],
    );
    const codeToId = new Map(supplierRows.map((r) => [r.supplier_code, r.id]));

    const map = new Map<string, boolean>();
    for (const r of freshnessResults) {
      const nmId = codeToId.get(r.nmCode);
      if (!nmId) continue;
      // Use staleness threshold from policy config (may differ from M21 default)
      const isFresh = r.status === 'FRESH' &&
        (r.hoursSinceSync === null || r.hoursSinceSync <= stalenessThresholdH);
      map.set(nmId, isFresh);
    }
    return map;
  }

  /** C2 fix: preload atp_qty from supply_snapshot_line LINE-LEVEL for all NM×SKU. */
  private async _preloadAtpQtys(cells: Array<{ nm_id: string; sku_id: string }>): Promise<
    Map<string, { atpQty: number | null; isAtpNullFallback: boolean }>
  > {
    if (cells.length === 0) return new Map();

    // Distinct NM IDs
    const nmIds = [...new Set(cells.map((c) => c.nm_id))];
    const skuIds = [...new Set(cells.map((c) => c.sku_id))];

    // Query line-level ATP qty from latest FROZEN supply snapshot per NM (C2 fix)
    const rows: Array<{
      nm_id: string; sku_id: string; atp_qty: number | null; allocatable_qty: number;
    }> = await this.dataSource.query(
      `SELECT
         s.id::text AS nm_id,
         sk.id::text AS sku_id,
         ssl.atp_qty::float,
         ssl.allocatable_qty::float
       FROM supplier s
       JOIN supply_snapshot ss ON ss.nm_code = s.supplier_code
         AND COALESCE(ss.synced_at, ss.captured_at) = (
           SELECT MAX(COALESCE(ss2.synced_at, ss2.captured_at)) FROM supply_snapshot ss2
           WHERE ss2.nm_code = s.supplier_code AND ss2.status = 'FROZEN'
         )
       JOIN supply_snapshot_line ssl ON ssl.snapshot_id = ss.id
       JOIN sku sk ON sk.sku_code = ssl.item_code
       WHERE s.id = ANY($1::bigint[])
         AND sk.id = ANY($2::bigint[])`,
      [nmIds, skuIds],
    );

    const map = new Map<string, { atpQty: number | null; isAtpNullFallback: boolean }>();
    for (const r of rows) {
      const key = `${r.nm_id}|${r.sku_id}`;
      const isAtpNullFallback = r.atp_qty === null || r.atp_qty === undefined;
      // R11/H6: fallback to allocatable_qty when atp_qty IS NULL + flag warning
      const atpQty = isAtpNullFallback ? Number(r.allocatable_qty ?? 0) : Number(r.atp_qty);
      map.set(key, { atpQty, isAtpNullFallback });
    }
    return map;
  }

  /** Preload transport_lane lead_time_days for NM_TO_CN lanes. */
  private async _preloadNmToCnLt(cells: Array<{ nm_id: string }>): Promise<
    Map<string, number>  // key: `${nmId}|${cnId}` → lt_days
  > {
    if (cells.length === 0) return new Map();
    const rows: Array<{
      source_nm_code: string; dest_cn_code: string; lead_time_days: number;
    }> = await this.dataSource.query(
      `SELECT source_location_code AS source_nm_code,
              dest_location_code AS dest_cn_code,
              lead_time_days
       FROM transport_lane
       WHERE lane_type = 'NM_TO_CN' AND is_active = TRUE`,
    );

    // Also need nm_code → nm_id and cn_code → cn_id maps
    const nmCodeToId = await this._preloadNmCodeToId(cells.map((c) => c.nm_id));
    const cnCodeToId = await this._preloadChannelCodeToId();

    const map = new Map<string, number>();
    for (const r of rows) {
      const nmId = nmCodeToId.get(r.source_nm_code);
      const cnId = cnCodeToId.get(r.dest_cn_code);
      if (nmId && cnId) map.set(`${nmId}|${cnId}`, Number(r.lead_time_days));
    }
    return map;
  }

  /** Preload HSTK days for all CN involved across all cells. */
  private async _preloadHstk(cells: Array<{ nm_id: string; sku_id: string }>): Promise<Map<string, number>> {
    // Phase 1 fallback: query channel table with hardcoded 10 days if no M8 service.
    // M8 service.getHstkDays(cn, sku) → replace with actual M8 call when available.
    const rows: Array<{ channel_id: string; hstk_days: number }> = await this.dataSource.query(
      `SELECT id::text AS channel_id, 10::int AS hstk_days FROM channel`,
    );
    return new Map(rows.map((r) => [r.channel_id, r.hstk_days]));
  }

  private async _preloadCnCodes(cells: Array<{ nm_id: string }>): Promise<Map<string, string>> {
    const rows: Array<{ id: string; channel_code: string }> = await this.dataSource.query(
      `SELECT id::text, channel_code FROM channel`,
    );
    return new Map(rows.map((r) => [r.id, r.channel_code]));
  }

  /** Load recipient CNs for a specific PARTIAL cell. */
  private async _loadCellRecipients(
    allocationRunId: string, nmId: string, skuId: string, periodStart: string,
  ): Promise<Array<{ cn_id: string; requested_qty: number }>> {
    return this.dataSource.query(
      `SELECT ar.cn_id::text, SUM(leg.allocated_qty)::float AS requested_qty
       FROM allocation_leg leg
       JOIN allocation_result ar ON ar.id = leg.allocation_result_id
       JOIN sku_nm_mapping m ON m.sku_id = ar.sku_id AND m.active = TRUE
       WHERE ar.allocation_run_id = $1
         AND m.nm_id = $2
         AND ar.sku_id = $3
         AND (CASE WHEN ar.is_top_up = TRUE THEN ar.source_period_start ELSE ar.period_start END) = $4
         AND leg.source_type IN ('HUB', 'NM', 'TOP_UP_NEXT_WEEK')
         AND ar.cn_id IS NOT NULL
       GROUP BY ar.cn_id`,
      [allocationRunId, nmId, skuId, periodStart],
    );
  }

  /** Build Map<cnId, lt_days> from the preloaded NM-specific lt map. */
  private _buildCnLtMap(fullLtMap: Map<string, number>, nmId: string): Map<string, number> {
    const map = new Map<string, number>();
    for (const [key, lt] of fullLtMap) {
      const [keyNmId, cnId] = key.split('|');
      if (keyNmId === nmId) map.set(cnId, lt);
    }
    return map;
  }

  private async _preloadNmCodeToId(nmIds: string[]): Promise<Map<string, string>> {
    if (nmIds.length === 0) return new Map();
    const rows: Array<{ id: string; supplier_code: string }> = await this.dataSource.query(
      `SELECT id::text, supplier_code FROM supplier WHERE id = ANY($1::bigint[])`,
      [nmIds],
    );
    return new Map(rows.map((r) => [r.supplier_code, r.id]));
  }

  private async _preloadChannelCodeToId(): Promise<Map<string, string>> {
    const rows: Array<{ id: string; channel_code: string }> = await this.dataSource.query(
      `SELECT id::text, channel_code FROM channel`,
    );
    return new Map(rows.map((r) => [r.channel_code, r.id]));
  }

  private async _cfgNum(key: string, policyRunId: string | null, fallback: number): Promise<number> {
    if (policyRunId) {
      const rows: Array<{ config_snapshot: Record<string, unknown> }> = await this.dataSource.query(
        `SELECT config_snapshot FROM policy_run WHERE id = $1 LIMIT 1`,
        [policyRunId],
      );
      if (rows.length > 0) {
        const v = rows[0].config_snapshot?.[key];
        if (v !== undefined && v !== null) {
          const n = Number(v);
          if (!isNaN(n)) return n;
        }
      }
    }
    const sysRows: Array<{ config_value: string }> = await this.dataSource.query(
      `SELECT config_value FROM system_config WHERE config_key = $1 LIMIT 1`,
      [key],
    );
    if (sysRows.length > 0) {
      const n = Number(sysRows[0].config_value);
      if (!isNaN(n)) return n;
    }
    return fallback;
  }
}
