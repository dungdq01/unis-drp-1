import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DrpNettingV2Service, DrpCellDto, DrpResultDto } from '../drp/drp.netting-v2.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AllocationFairShareService, CellDemand } from './allocation.fair-share.service';
import { AllocationVariantMatchService } from './allocation.variant-match.service';
import { HUB_VIRTUAL_ID, LegSourceType } from '../common/allocation-constants';

// ─── DTOs (M24 → M25 contract, spec §13.1) ───────────────────────────────────

export interface AllocationLegDto {
  /** DB id of allocation_leg row — used by M25 to populate transport_trip_line.source_allocation_leg_id. */
  legId: string | null;
  /** DB id of parent allocation_result row — used by M25 for transport_trip_line.allocation_result_id. */
  allocationResultId: string;
  sourceType: LegSourceType;
  sourceEntityId: string;
  sourceLotId: string | null;
  allocatedQty: number;
  fifoRank: number | null;
  distanceKm: number | null;
}

export interface AllocationCellDto {
  cnId: string;
  skuId: string;
  /** H1 fix: Monday of planning week — preserves M23 grain through M25/M26. */
  periodStart: string;
  qtyRequired: number;
  qtyAllocated: number;
  status: 'FULL' | 'PARTIAL' | 'PARTIAL_STOCKOUT' | 'UNALLOCATED';
  plannerReviewRequired: boolean;
  reviewReason: string | null;
  legs: AllocationLegDto[];
  variantBreakdown: Record<string, number>;
  // Top-up cross-module contract (M25/M26/M27):
  isTopUp: boolean;
  sourceTopUpId: string | null;
  sourcePeriodStart: string | null;
}

export interface AllocationResultDto {
  allocationRunId: string;
  planRunId: string;
  policyRunId: string | null;
  generatedAt: Date;
  /** key: `${cnId}|${skuId}|${periodStart}` — 3-part grain matches M23 drpCellKey. */
  results: Map<string, AllocationCellDto>;
}

export function allocCellKey(cnId: string, skuId: string, periodStart: string): string {
  return `${cnId}|${skuId}|${periodStart}`;
}

export interface RunOptions {
  planRunId: string;
  createdBy?: string;
  forceRerunReason?: string;
}

export interface RunResult {
  allocationRunId: string;
  status: string;
  totalDemandLines: number;
  /**
   * H4 fix: renamed from `totalAllocated` to avoid overload with
   * allocation_run.total_allocated column (which stores COUNT of FULL rows).
   * This field is the summed allocated *quantity* across all cells.
   */
  totalAllocatedQty: number;
  /** Count of cells with status='FULL'. Matches allocation_run.total_allocated. */
  fullAllocatedCount: number;
  totalLegs: number;
  lcnbTransfers: number;
  partialStockout: number;
  durationMs: number;
}

export class AllocationRunNotCompletedException extends BadRequestException {
  constructor(runId: string, status: string) {
    super(`allocation_run #${runId} is ${status} — not COMPLETED`);
  }
}

const BULK_CHUNK = 500;

/**
 * M24 — Allocation Engine LCNB v2 orchestrator (spec §4 pipeline 8 steps).
 *
 * Triggered by M23 after DRP run COMPLETED. Implements the 3-tier waterfall:
 *   (1) Hub pool  (2) LCNB lateral from donor CNs  (3) STOCKOUT_FLAG
 *
 * Outside scope: transport routing (M25), PO generation (M27).
 */
@Injectable()
export class AllocationLcnbService implements OnModuleInit {
  private readonly logger = new Logger(AllocationLcnbService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly drpSvc: DrpNettingV2Service,
    private readonly fairShareSvc: AllocationFairShareService,
    private readonly variantMatchSvc: AllocationVariantMatchService,
    private readonly systemConfigSvc: SystemConfigService,
  ) {}

  /**
   * H2 fix: register with M23 on bootstrap so DRP COMPLETED automatically
   * triggers allocation (spec §7 M23→M24 callback). Fire-and-forget to keep
   * M23 cycle time unchanged; errors surface in M24 logs + allocation_run row.
   */
  onModuleInit(): void {
    this.drpSvc.setPostCompletedHook(async (planRunId, createdBy) => {
      try {
        await this.triggerFromDrp(planRunId, createdBy);
      } catch (err) {
        this.logger.error(
          `M24 auto-trigger failed for plan_run #${planRunId}: ${(err as Error).message}`,
        );
      }
    });
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * H1 fix — Named entry point for M23 → M24 callback (spec §7).
   *
   * @nestjs/event-emitter is not installed in this repo (verified package.json);
   * direct injection would create a circular module dep (drp ↔ allocation).
   * Resolution: M23 code that wants to trigger M24 imports `AllocationModule`
   * WITHOUT importing DrpModule, then calls this method. M24's internal retry
   * chain (_fetchDrpWithRetry) already absorbs a race where M23 hasn't
   * committed its COMPLETED status yet.
   *
   * Usage pattern (in M23 post-completion hook):
   *   await allocationLcnbService.triggerFromDrp(planRunId, userId);
   *
   * Manual/cron equivalent: POST /api/v1/allocation/v2/run { planRunId }.
   */
  async triggerFromDrp(planRunId: string, createdBy = 'M23_CALLBACK'): Promise<RunResult> {
    return this.runV2({ planRunId, createdBy });
  }

  async runV2(opts: RunOptions): Promise<RunResult> {
    if (!(await this.systemConfigSvc.isEnabled('m24_allocation_lcnb_enabled'))) {
      throw new ServiceUnavailableException(
        'M24 Allocation LCNB is disabled (feature flag m24_allocation_lcnb_enabled=false)',
      );
    }

    const startedAt = Date.now();

    // Step 1: Validate M23 plan_run COMPLETED (retry chain §7/US-14).
    // H4 fix: if M23 never becomes ready, persist BLOCKED_M23_NOT_READY row
    // for audit trail before surfacing the error.
    let drpResult;
    try {
      drpResult = await this._fetchDrpWithRetry(opts.planRunId);
    } catch (err) {
      await this.dataSource.query(
        `INSERT INTO allocation_run
           (plan_run_id, status, lcnb_enabled, created_by, started_at,
            error_message, completed_at)
         VALUES ($1, 'BLOCKED_M23_NOT_READY', FALSE, $2, NOW(), $3, NOW())
         ON CONFLICT DO NOTHING`,
        [opts.planRunId, opts.createdBy ?? 'M23_CALLBACK', (err as Error).message],
      );
      throw err;
    }

    // R13 idempotent check (primary guard = partial UNIQUE index enforces it;
    // we also check here for a friendlier error).
    const existing = await this.dataSource.query(
      `SELECT id FROM allocation_run WHERE plan_run_id = $1 AND is_force_rerun = FALSE LIMIT 1`,
      [opts.planRunId],
    );
    if (existing.length > 0 && !opts.forceRerunReason) {
      throw new ConflictException(
        `allocation_run already exists for plan_run #${opts.planRunId}. Use forceRerunReason to override.`,
      );
    }
    if (opts.forceRerunReason && opts.forceRerunReason.length < 20) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }
    const isForceRerun = Boolean(opts.forceRerunReason) && existing.length > 0;

    // Step 2: Policy snapshot (reused from M23 — R12 no new snapshot).
    const policyRow: Array<{ policy_run_id: string | null; config_snapshot: Record<string, unknown> | null }> =
      await this.dataSource.query(
        `SELECT pr.policy_run_id::text,
                pol.config_snapshot
         FROM plan_run pr
         LEFT JOIN policy_run pol ON pol.id = pr.policy_run_id
         WHERE pr.id = $1`,
        [opts.planRunId],
      );
    if (policyRow.length === 0) {
      throw new NotFoundException(`plan_run #${opts.planRunId} not found`);
    }
    const policyRunId = policyRow[0].policy_run_id;
    const config = policyRow[0].config_snapshot ?? {};
    // BUG-M24-3 fix: lcnb.enabled is 3-state OFF | DETECT_ONLY | EXECUTE (per M10 seed).
    // Only EXECUTE actually performs the CN_REDIST legs; DETECT_ONLY flags
    // donors/recipients but doesn't transfer. OFF bypasses LCNB entirely.
    const lcnbMode = this._cfgStr(config, 'lcnb.enabled', 'DETECT_ONLY').toUpperCase();
    const lcnbEnabled = lcnbMode === 'EXECUTE';
    const maxDistanceKm = this._cfgNum(config, 'lcnb.max_distance_km', 500);
    const minExcess = this._cfgNum(config, 'lcnb.min_excess_threshold', 50);
    // BUG-M24-2 fix: M10 seeds max_transfer_pct as percent (0-100). Normalize
    // to fraction (0-1) for arithmetic. Accept both forms defensively — values
    // ≤ 1 are already fractions.
    const rawTransferPct = this._cfgNum(config, 'lcnb.max_transfer_pct', 80);
    const maxTransferPct = rawTransferPct > 1 ? rawTransferPct / 100 : rawTransferPct;

    // Step 3: Create allocation_run (status=RUNNING).
    const runRows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO allocation_run
         (plan_run_id, policy_run_id, status, lcnb_enabled,
          is_force_rerun, force_rerun_reason, created_by, started_at)
       VALUES ($1, $2, 'RUNNING', $3, $4, $5, $6, NOW())
       RETURNING id`,
      [
        opts.planRunId,
        policyRunId,
        lcnbEnabled,
        isForceRerun,
        opts.forceRerunReason ?? null,
        opts.createdBy ?? 'M23_CALLBACK',
      ],
    );
    const allocationRunId = runRows[0].id;
    this.logger.log(`allocation_run #${allocationRunId} created (plan_run=${opts.planRunId}, lcnb=${lcnbEnabled})`);

    try {
      // Step 4: Load demand (positive net_demand cells) — C1 fix: preserve week grain.
      const cells: CellDemand[] = [];
      const cellMap = new Map<string, DrpCellDto>(); // key: cnId|skuId|periodStart
      for (const cell of drpResult.lines.values()) {
        if (cell.netDemand <= 0) continue;
        const key = allocCellKey(cell.cnId, cell.skuId, cell.periodStart);
        cellMap.set(key, { ...cell });
        cells.push({
          cnId: cell.cnId,
          skuId: cell.skuId,
          periodStart: cell.periodStart,
          netDemand: cell.netDemand,
        });
      }

      // Step 5: Donors (OVER_STOCK cells) — per (sku, week).
      const donorsBySkuWeek = this._groupDonors(drpResult);

      // C1 fix [round 2]: Phase 1 hub pool = 0.
      //
      // Rationale: M23 netDemand = demand - onHand - inTransit + ssFinal.
      // The CN's onHand is ALREADY consumed when M23 reduces demand to net.
      // If M24 re-reads onHand and uses it as a "hub pool", the same physical
      // stock is allocated twice (once implicitly by M23, once explicitly
      // by M24 Step 6a). In Phase 1 with no real Hub inventory (M16 not live),
      // all remaining netDemand must be served via LCNB from OVER_STOCK donors
      // (or left as STOCKOUT). Spec §4 Step 5 "hub_available = Σ on_hand_cn"
      // describes the gross-pool CONCEPT; the actual M24 hub draw is 0 until
      // M16 provides virtual inventory independent of drp_cn_line.onHand.
      //
      // Phase 2 swap: replace with `await m16Service.getVirtualInventory(sku)`.
      const hubBySkuWeek = new Map<string, number>();

      // Step 5.5: Fair-share pre-compute at (sku, week) grain.
      const fairShareQuota = this.fairShareSvc.compute(cells, hubBySkuWeek);

      // C2 fix: preload id→code maps so legacy VARCHAR columns
      // (allocation_result.item_code / dest_location_code) receive real codes,
      // not stringified BIGINT IDs. Downstream FE/reports + M25 top-up expect
      // codes per M00 master-data contract.
      const { skuCodeById, channelCodeById } = await this._loadCodeMaps();

      // Distance matrix (CN_REDIST lanes only)
      const distanceMap = await this._loadDistanceMatrix(maxDistanceKm);

      // Donor running balance per (cn|sku|week). H1 fix: also track
      // cumulative transferred so R7 max_transfer_pct is enforced at the DONOR
      // level (total across all recipients), not per-iteration.
      const donorRemaining = new Map<string, number>();
      const donorMaxTransfer = new Map<string, number>();   // cap = excessQty × maxTransferPct
      const donorTransferred = new Map<string, number>();   // running sum per donor
      for (const donors of donorsBySkuWeek.values()) {
        for (const d of donors) {
          const k = allocCellKey(d.cnId, d.skuId, d.periodStart);
          donorRemaining.set(k, d.excessQty);
          donorMaxTransfer.set(k, d.excessQty * maxTransferPct);
          donorTransferred.set(k, 0);
        }
      }

      // Step 6: per-cell allocation
      const allocResults: Array<{
        cell: DrpCellDto;
        qtyAllocated: number;
        status: AllocationCellDto['status'];
        legs: AllocationLegDto[];
        plannerReviewRequired: boolean;
        reviewReason: string | null;
        variantBreakdown: Record<string, number>;
      }> = [];

      let totalLegs = 0;
      let lcnbTransfers = 0;
      let partialStockout = 0;
      let totalAllocated = 0;

      for (const cell of cellMap.values()) {
        const key = allocCellKey(cell.cnId, cell.skuId, cell.periodStart);
        const need = cell.netDemand;
        const quota = fairShareQuota.get(key) ?? 0;
        const grp = `${cell.skuId}|${cell.periodStart}`;
        const legs: AllocationLegDto[] = [];

        // 6a: Hub pool (capped by fair-share quota) — per (sku, week)
        const hubAvail = hubBySkuWeek.get(grp) ?? 0;
        const hubTake = Math.min(need, quota, hubAvail);
        if (hubTake > 0) {
          legs.push({
            legId: null,           // assigned after DB insert in _bulkInsertResults
            allocationResultId: '', // assigned after DB insert in _bulkInsertResults
            sourceType: 'HUB',
            sourceEntityId: HUB_VIRTUAL_ID,
            sourceLotId: null,
            allocatedQty: hubTake,
            fifoRank: null,
            distanceKm: null,
          });
          hubBySkuWeek.set(grp, hubAvail - hubTake);
        }

        // 6b: LCNB from donor CNs (if enabled + remaining need) — per (sku, week)
        let remaining = need - hubTake;
        if (remaining > 0 && lcnbEnabled) {
          const donors = (donorsBySkuWeek.get(grp) ?? [])
            .filter((d) => d.cnId !== cell.cnId) // can't donor to self
            .map((d) => ({
              ...d,
              distanceKm: distanceMap.get(`${d.cnId}|${cell.cnId}`) ?? null,
            }))
            .filter((d) => d.distanceKm !== null && d.distanceKm <= maxDistanceKm) // R5
            .sort((a, b) => (a.distanceKm! - b.distanceKm!)); // R4 NEAREST_FIRST

          for (const donor of donors) {
            if (remaining <= 0) break;
            const donorKey = allocCellKey(donor.cnId, donor.skuId, donor.periodStart);
            const donorLeft = donorRemaining.get(donorKey) ?? 0;
            if (donorLeft < minExcess) continue; // R6

            // H1 fix: R7 enforced cumulatively per donor.
            const cap = donorMaxTransfer.get(donorKey) ?? 0;
            const alreadyTransferred = donorTransferred.get(donorKey) ?? 0;
            const budgetLeft = Math.max(0, cap - alreadyTransferred);
            if (budgetLeft <= 0) continue; // donor exhausted its transfer cap
            const available = Math.min(donorLeft, budgetLeft);
            const take = Math.min(remaining, available);
            if (take <= 0) continue;

            legs.push({
              legId: null,           // assigned after DB insert in _bulkInsertResults
              allocationResultId: '', // assigned after DB insert in _bulkInsertResults
              sourceType: 'CN_REDIST',
              sourceEntityId: donor.cnId,
              sourceLotId: null,
              allocatedQty: take,
              fifoRank: null,
              distanceKm: donor.distanceKm,
            });
            donorRemaining.set(donorKey, donorLeft - take);
            donorTransferred.set(donorKey, alreadyTransferred + take);
            remaining -= take;
            lcnbTransfers++;
          }
        }

        const qtyAllocated = need - remaining;
        totalAllocated += qtyAllocated;
        totalLegs += legs.length;

        let status: AllocationCellDto['status'];
        if (qtyAllocated >= need - 0.01) status = 'FULL';
        else if (qtyAllocated <= 0)      status = 'UNALLOCATED';
        else if (remaining > 0)          status = 'PARTIAL_STOCKOUT';
        else                              status = 'PARTIAL';

        if (status === 'PARTIAL_STOCKOUT' || status === 'UNALLOCATED') partialStockout++;

        // Step 6d: variant match post-process
        const vm = this.variantMatchSvc.match(qtyAllocated, cell.variantSuggestion as Record<string, number> | null);

        allocResults.push({
          cell,
          qtyAllocated,
          status,
          legs,
          plannerReviewRequired: vm.plannerReviewRequired || status === 'PARTIAL_STOCKOUT',
          reviewReason: vm.plannerReviewRequired
            ? 'VARIANT_MISMATCH'
            : status === 'PARTIAL_STOCKOUT'
              ? 'PARTIAL_STOCKOUT'
              : null,
          variantBreakdown: vm.variantBreakdown,
        });
      }

      // Step 7: Bulk insert allocation_result + legs (reconciled qty = Σ legs).
      await this._bulkInsertResults(allocationRunId, allocResults, skuCodeById, channelCodeById);

      const durationMs = Date.now() - startedAt;

      // Step 8: Finalize allocation_run.
      await this.dataSource.query(
        `UPDATE allocation_run SET
           status = 'COMPLETED',
           total_demand_lines = $1,
           total_allocated = $2,
           total_partial = $3,
           total_unallocated = $4,
           total_legs_count = $5,
           lcnb_transfers_count = $6,
           partial_stockout_count = $7,
           duration_ms = $8,
           completed_at = NOW()
         WHERE id = $9`,
        [
          allocResults.length,
          allocResults.filter((r) => r.status === 'FULL').length,
          allocResults.filter((r) => r.status === 'PARTIAL').length,
          allocResults.filter((r) => r.status === 'UNALLOCATED').length,
          totalLegs,
          lcnbTransfers,
          partialStockout,
          durationMs,
          allocationRunId,
        ],
      );

      this.logger.log(
        `allocation_run #${allocationRunId} COMPLETED in ${durationMs}ms — ` +
          `${allocResults.length} cells, ${totalLegs} legs, ${lcnbTransfers} LCNB transfers, ${partialStockout} stockouts`,
      );

      return {
        allocationRunId,
        status: 'COMPLETED',
        totalDemandLines: allocResults.length,
        totalAllocatedQty: totalAllocated,
        fullAllocatedCount: allocResults.filter((r) => r.status === 'FULL').length,
        totalLegs,
        lcnbTransfers,
        partialStockout,
        durationMs,
      };
    } catch (err) {
      await this.dataSource.query(
        `UPDATE allocation_run SET status = 'FAILED', error_message = $1, completed_at = NOW() WHERE id = $2`,
        [(err as Error).message, allocationRunId],
      );
      this.logger.error(`allocation_run #${allocationRunId} FAILED: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * M24 → M25 injectable contract (spec §13.1).
   */
  async getAllocationResult(allocationRunId: string): Promise<AllocationResultDto> {
    const runRows: Array<{
      id: string;
      plan_run_id: string;
      policy_run_id: string | null;
      status: string;
      completed_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT id, plan_run_id::text, policy_run_id::text, status, completed_at
       FROM allocation_run WHERE id = $1`,
      [allocationRunId],
    );
    if (runRows.length === 0) throw new NotFoundException(`allocation_run #${allocationRunId} not found`);
    if (runRows[0].status !== 'COMPLETED') {
      throw new AllocationRunNotCompletedException(allocationRunId, runRows[0].status);
    }

    const rows: Array<{
      result_id: string;
      cn_id: string;
      sku_id: string;
      period_start: string;
      qty_required: number;
      qty_allocated: number;
      status: string;
      planner_review_required: boolean;
      review_reason: string | null;
      variant_breakdown: Record<string, number> | null;
      is_top_up: boolean;
      source_top_up_id: string | null;
      source_period_start: string | null;
      leg_id: string | null;
      leg_source_type: string | null;
      leg_source_entity_id: string | null;
      leg_source_lot_id: string | null;
      leg_allocated_qty: number | null;
      leg_fifo_rank: number | null;
      leg_distance_km: number | null;
    }> = await this.dataSource.query(
      `SELECT
         ar.id::text   AS result_id,
         ar.cn_id::text, ar.sku_id::text, ar.period_start::text,
         ar.qty_required::float, ar.qty_allocated::float,
         ar.status,
         ar.planner_review_required, ar.review_reason,
         ar.variant_breakdown,
         ar.is_top_up, ar.source_top_up_id::text AS source_top_up_id, ar.source_period_start::text AS source_period_start,
         al.id::text                      AS leg_id,
         al.source_type                   AS leg_source_type,
         al.source_entity_id::text        AS leg_source_entity_id,
         al.source_lot_id                 AS leg_source_lot_id,
         al.allocated_qty::float          AS leg_allocated_qty,
         al.fifo_rank                     AS leg_fifo_rank,
         al.distance_km::float            AS leg_distance_km
       FROM allocation_result ar
       LEFT JOIN allocation_leg al ON al.allocation_result_id = ar.id
       WHERE ar.allocation_run_id = $1
         AND ar.cn_id IS NOT NULL
       ORDER BY ar.id, al.id`,
      [allocationRunId],
    );

    const results = new Map<string, AllocationCellDto>();
    for (const r of rows) {
      const key = allocCellKey(r.cn_id, r.sku_id, r.period_start);
      let cell = results.get(key);
      if (!cell) {
        cell = {
          cnId: r.cn_id,
          skuId: r.sku_id,
          periodStart: r.period_start,
          qtyRequired: Number(r.qty_required),
          qtyAllocated: Number(r.qty_allocated),
          status: r.status as AllocationCellDto['status'],
          plannerReviewRequired: Boolean(r.planner_review_required),
          reviewReason: r.review_reason,
          legs: [],
          variantBreakdown: r.variant_breakdown ?? {},
          isTopUp: Boolean(r.is_top_up),
          sourceTopUpId: r.source_top_up_id,
          sourcePeriodStart: r.source_period_start,
        };
        results.set(key, cell);
      }
      if (r.leg_source_type) {
        cell.legs.push({
          legId: r.leg_id,
          allocationResultId: r.result_id,
          sourceType: r.leg_source_type as LegSourceType,
          sourceEntityId: r.leg_source_entity_id ?? HUB_VIRTUAL_ID,
          sourceLotId: r.leg_source_lot_id,
          allocatedQty: Number(r.leg_allocated_qty),
          fifoRank: r.leg_fifo_rank,
          distanceKm: r.leg_distance_km !== null ? Number(r.leg_distance_km) : null,
        });
      }
    }

    return {
      allocationRunId: runRows[0].id,
      planRunId: runRows[0].plan_run_id,
      policyRunId: runRows[0].policy_run_id,
      generatedAt: runRows[0].completed_at ?? new Date(),
      results,
    };
  }

  // ─── Read API ──────────────────────────────────────────────────────────────

  async listRuns(planRunId?: string, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (planRunId) {
      conditions.push(`plan_run_id = $${params.length + 1}`);
      params.push(planRunId);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.dataSource.query(
      `SELECT * FROM allocation_run ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    const total = await this.dataSource.query(
      `SELECT COUNT(*)::int AS c FROM allocation_run ${where}`,
      params,
    );
    return { data: rows, total: total[0].c, page, limit };
  }

  async listResults(
    allocationRunId: string,
    opts: { cnId?: string; status?: string; page?: number; limit?: number },
  ) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const offset = (page - 1) * limit;
    const conditions = [`allocation_run_id = $1`];
    const params: unknown[] = [allocationRunId];
    let p = 2;
    if (opts.cnId)   { conditions.push(`cn_id = $${p++}`);  params.push(opts.cnId); }
    if (opts.status) { conditions.push(`status = $${p++}`); params.push(opts.status); }
    const where = conditions.join(' AND ');
    const [data, total] = await Promise.all([
      this.dataSource.query(
        `SELECT * FROM allocation_result WHERE ${where} ORDER BY id LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM allocation_result WHERE ${where}`, params),
    ]);
    return { data, total: total[0].c, page, limit };
  }

  async getRun(allocationRunId: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM allocation_run WHERE id = $1`,
      [allocationRunId],
    );
    if (rows.length === 0) throw new NotFoundException(`allocation_run #${allocationRunId} not found`);
    return rows[0];
  }

  async listLegs(
    allocationRunId: string,
    opts: { sourceType?: string; page?: number; limit?: number },
  ) {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 100;
    const offset = (page - 1) * limit;
    const conditions = [`ar.allocation_run_id = $1`];
    const params: unknown[] = [allocationRunId];
    let p = 2;
    if (opts.sourceType) { conditions.push(`al.source_type = $${p++}`); params.push(opts.sourceType); }
    const where = conditions.join(' AND ');
    const [data, total] = await Promise.all([
      this.dataSource.query(
        `SELECT al.*, ar.cn_id::text AS recipient_cn_id, ar.sku_id::text, ar.period_start::text
         FROM allocation_leg al
         JOIN allocation_result ar ON ar.id = al.allocation_result_id
         WHERE ${where}
         ORDER BY al.id LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS c FROM allocation_leg al
         JOIN allocation_result ar ON ar.id = al.allocation_result_id
         WHERE ${where}`,
        params,
      ),
    ]);
    return { data, total: total[0].c, page, limit };
  }

  async getLcnbSummary(allocationRunId: string) {
    return this.dataSource.query(
      `SELECT al.source_entity_id::text AS donor_cn_id,
              ar.cn_id::text             AS recipient_cn_id,
              COUNT(*)                   AS transfer_count,
              SUM(al.allocated_qty)::float AS total_qty,
              AVG(al.distance_km)::float  AS avg_distance_km,
              SUM(al.allocated_qty * al.distance_km)::float AS total_km
       FROM allocation_leg al
       JOIN allocation_result ar ON ar.id = al.allocation_result_id
       WHERE ar.allocation_run_id = $1 AND al.source_type = 'CN_REDIST'
       GROUP BY al.source_entity_id, ar.cn_id
       ORDER BY transfer_count DESC`,
      [allocationRunId],
    );
  }

  async getReviewRequired(allocationRunId: string) {
    return this.dataSource.query(
      `SELECT id, cn_id::text, sku_id::text, qty_required, qty_allocated,
              status, review_reason
       FROM allocation_result
       WHERE allocation_run_id = $1 AND planner_review_required = TRUE
       ORDER BY id`,
      [allocationRunId],
    );
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _fetchDrpWithRetry(planRunId: string): Promise<DrpResultDto> {
    const maxAttempts = 5;
    const delayMs = 30_000;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.drpSvc.getDrpResult(planRunId);
      } catch (err) {
        lastErr = err;
        // Only retry for "not COMPLETED" state; fail fast on NotFound
        if ((err as Error).message.includes('not found')) throw err;
        if (attempt < maxAttempts) {
          this.logger.warn(
            `[M23 retry ${attempt}/${maxAttempts}] plan_run #${planRunId} not ready: ${(err as Error).message}`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw new BadRequestException(
      `M23 plan_run #${planRunId} not COMPLETED after ${maxAttempts} retries: ${(lastErr as Error).message}`,
    );
  }

  /**
   * Group OVER_STOCK donors per (sku, week). excessQty = |netDemand|.
   * Key: `${skuId}|${periodStart}` — matches fair-share grain.
   */
  private _groupDonors(
    drp: DrpResultDto,
  ): Map<string, Array<{ cnId: string; skuId: string; periodStart: string; excessQty: number }>> {
    const map = new Map<
      string,
      Array<{ cnId: string; skuId: string; periodStart: string; excessQty: number }>
    >();
    for (const cell of drp.lines.values()) {
      if (cell.status !== 'OVER_STOCK' || cell.netDemand >= 0) continue;
      const grp = `${cell.skuId}|${cell.periodStart}`;
      const arr = map.get(grp) ?? [];
      arr.push({
        cnId: cell.cnId,
        skuId: cell.skuId,
        periodStart: cell.periodStart,
        excessQty: -cell.netDemand,
      });
      map.set(grp, arr);
    }
    return map;
  }

  private async _loadDistanceMatrix(maxDistanceKm: number): Promise<Map<string, number>> {
    // transport_lane real schema: source_location_code, dest_location_code, lead_time_days.
    // distance_km column exists per BUG-M00-02 migration; spec uses it for LCNB.
    const rows: Array<{ from_cn: string; to_cn: string; distance_km: number }> =
      await this.dataSource.query(
        `SELECT c1.id::text AS from_cn, c2.id::text AS to_cn, tl.distance_km::float
         FROM transport_lane tl
         JOIN channel c1 ON c1.channel_code = tl.source_location_code
         JOIN channel c2 ON c2.channel_code = tl.dest_location_code
         WHERE tl.is_active = TRUE AND tl.distance_km <= $1`,
        [maxDistanceKm],
      );
    const map = new Map<string, number>();
    for (const r of rows) map.set(`${r.from_cn}|${r.to_cn}`, Number(r.distance_km));
    return map;
  }

  private async _loadCodeMaps(): Promise<{
    skuCodeById: Map<string, string>;
    channelCodeById: Map<string, string>;
  }> {
    const [skus, channels] = await Promise.all([
      this.dataSource.query(`SELECT id::text AS id, sku_code FROM sku`),
      this.dataSource.query(`SELECT id::text AS id, channel_code FROM channel`),
    ]);
    const skuCodeById = new Map<string, string>();
    const channelCodeById = new Map<string, string>();
    for (const r of skus as Array<{ id: string; sku_code: string }>) {
      skuCodeById.set(r.id, r.sku_code);
    }
    for (const r of channels as Array<{ id: string; channel_code: string }>) {
      channelCodeById.set(r.id, r.channel_code);
    }
    return { skuCodeById, channelCodeById };
  }

  private async _bulkInsertResults(
    allocationRunId: string,
    results: Array<{
      cell: DrpCellDto;
      qtyAllocated: number;
      status: AllocationCellDto['status'];
      legs: AllocationLegDto[];
      plannerReviewRequired: boolean;
      reviewReason: string | null;
      variantBreakdown: Record<string, number>;
    }>,
    skuCodeById: Map<string, string>,
    channelCodeById: Map<string, string>,
  ): Promise<void> {
    if (results.length === 0) return;

    for (let i = 0; i < results.length; i += BULK_CHUNK) {
      const chunk = results.slice(i, i + BULK_CHUNK);
      // Insert results — capture id for leg linkage.
      // C3 fix: planned_order_id explicitly NULL (M24 creates rows from M23
      // drp_cn_line; legacy FK to planned_order_release not applicable).
      const placeholders: string[] = [];
      const values: unknown[] = [];
      let p = 1;
      for (const r of chunk) {
        placeholders.push(
          `($${p++},NULL,$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`,
        );
        values.push(
          allocationRunId,
          r.cell.cnId,                                    // cn_id
          r.cell.skuId,                                   // sku_id
          r.cell.periodStart,                             // period_start
          skuCodeById.get(r.cell.skuId) ?? '',            // C2: real sku_code
          channelCodeById.get(r.cell.cnId) ?? '',         // C2: real channel_code
          r.cell.netDemand,
          r.qtyAllocated,
          r.status,
          r.plannerReviewRequired,
          r.reviewReason,
          JSON.stringify(r.variantBreakdown),             // H2: persist
        );
      }
      // M1 fix: fetch ids by natural key AFTER insert so mapping survives
      // ON CONFLICT DO NOTHING collisions (force-rerun same plan_run).
      await this.dataSource.query(
        `INSERT INTO allocation_result
           (allocation_run_id, planned_order_id, cn_id, sku_id, period_start,
            item_code, dest_location_code,
            qty_required, qty_allocated, status,
            planner_review_required, review_reason, variant_breakdown)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (allocation_run_id, cn_id, sku_id, period_start) DO NOTHING`,
        values,
      );
      const natKeys = chunk.map((r) => [r.cell.cnId, r.cell.skuId, r.cell.periodStart]);
      const inserted: Array<{ id: string; cn_id: string; sku_id: string; period_start: string }> =
        await this.dataSource.query(
          `SELECT id::text, cn_id::text, sku_id::text, period_start::text
           FROM allocation_result
           WHERE allocation_run_id = $1
             AND (cn_id, sku_id, period_start) IN (${
               natKeys.map((_, i) => `($${i * 3 + 2},$${i * 3 + 3},$${i * 3 + 4})`).join(',')
             })`,
          [allocationRunId, ...natKeys.flat()],
        );
      const idByKey = new Map<string, string>();
      for (const r of inserted) idByKey.set(allocCellKey(r.cn_id, r.sku_id, r.period_start), r.id);

      // Legs — M1 fix: lookup result_id via natural key, not index.
      const legPlaceholders: string[] = [];
      const legValues: unknown[] = [];
      let lp = 1;
      for (const r of chunk) {
        const resultId = idByKey.get(allocCellKey(r.cell.cnId, r.cell.skuId, r.cell.periodStart));
        if (!resultId) continue; // row didn't materialize (shouldn't happen on a fresh run)
        for (const leg of r.legs) {
          legPlaceholders.push(
            `($${lp++},$${lp++},$${lp++},$${lp++},$${lp++},$${lp++},$${lp++})`,
          );
          legValues.push(
            resultId,
            leg.sourceType,
            leg.sourceEntityId,
            leg.sourceLotId,
            leg.allocatedQty,
            leg.fifoRank,
            leg.distanceKm,
          );
        }
      }
      if (legPlaceholders.length > 0) {
        await this.dataSource.query(
          `INSERT INTO allocation_leg
             (allocation_result_id, source_type, source_entity_id, source_lot_id,
              allocated_qty, fifo_rank, distance_km)
           VALUES ${legPlaceholders.join(',')}`,
          legValues,
        );
      }

    }
  }

  private _cfgNum(cfg: Record<string, unknown>, key: string, fallback: number): number {
    const v = cfg[key];
    if (v === undefined || v === null) return fallback;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  }

  private _cfgStr(cfg: Record<string, unknown>, key: string, fallback: string): string {
    const v = cfg[key];
    if (v === undefined || v === null) return fallback;
    // config_snapshot values may be JSON-encoded strings (wrapped in quotes);
    // strip outer quotes defensively.
    return String(v).replace(/^"|"$/g, '');
  }
}
