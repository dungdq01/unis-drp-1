import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TransportLotSizingService, TransportPlanIncompleteException } from '../transport/transport.lot-sizing.service';
import { NmAtpService } from '../nm-atp/nm-atp.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { atpCellKey } from '../common/atp-utils';

// ─── Exceptions ──────────────────────────────────────────────────────────────

export class PoRunNotCompletedException extends BadRequestException {
  constructor(allocationRunId: string, status: string) {
    super(`PO run for allocation_run #${allocationRunId} is ${status}, not COMPLETED.`);
  }
}

export class InvalidTransitionException extends ConflictException {
  constructor(from: string, to: string) {
    super(`Cannot transition PO/TO from ${from} → ${to}`);
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RunPoOptions {
  allocationRunId: string;
  transportPlanId: string;
  atpRunId: string;
  forceRerunReason?: string;
  createdBy?: string;
}

export interface PoFulfillmentDto {
  poId: string;
  poNumber: string;
  nmId: string;
  cnId: string;
  status: string;
  confirmedAt: Date | null;
  shippedAt: Date | null;
  receivedAt: Date | null;
  closedAt: Date | null;
  ltActualDays: number | null;
  lines: Array<{
    lineId: string;
    skuId: string;
    variantCode: string | null;
    periodStart: string | null;
    requestedQty: number;
    confirmedQty: number;
    actualReceivedQty: number | null;
    isTopUp: boolean;
    sourcePeriodStart: string | null;
    deliveryIncomplete: boolean;
    deliveryNote: string | null;
  }>;
}

/**
 * M27 — PO/TO Review & Confirm orchestrator.
 *
 * Pipeline (§4):
 *  Step 1: Validate gates (NO_CARRIER block, ATP completed, idempotent)
 *  Step 2: Pin policy_run_id from M24 (Rule 14)
 *  Step 3: Create po_run (RUNNING)
 *  Step 4: Load allocation legs + resolve NM via sku_nm_mapping (C1/C2/C3)
 *  Step 5: Apply M26 ATP gate per cell — skip BLOCKED/FAIL, clamp PARTIAL (H1+H2)
 *  Step 6: Group → insert po_header/po_line + to_header/to_line (bulk)
 *  Step 7: Status DRAFT, window 00:30-05:00 VN for Planner review
 *  Step 8: po_run COMPLETED — notify Planner
 */
@Injectable()
export class PoReviewService {
  private readonly logger = new Logger(PoReviewService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(forwardRef(() => TransportLotSizingService)) private readonly transportSvc: TransportLotSizingService,
    @Inject(forwardRef(() => NmAtpService)) private readonly atpSvc: NmAtpService,
    private readonly systemConfigSvc: SystemConfigService,
  ) {}

  // ─── Generate run ──────────────────────────────────────────────────────────

  async generate(opts: RunPoOptions): Promise<{
    poRunId: string; status: string;
    totalPoCount: number; totalToCount: number;
    skippedAtpFailCount: number; skippedAtpBlockedCount: number;
    clampedAtpPartialCount: number; variantReviewCount: number; topUpCount: number;
  }> {
    if (!(await this.systemConfigSvc.isEnabled('m27_po_rebuild_enabled'))) {
      throw new ServiceUnavailableException('M27 PO Review disabled (feature flag m27_po_rebuild_enabled=false)');
    }
    const startedAt = Date.now();

    // R10 idempotent guard
    const existing: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM po_run WHERE allocation_run_id = $1 AND is_force_rerun = FALSE LIMIT 1`,
      [opts.allocationRunId],
    );
    if (existing.length > 0 && !opts.forceRerunReason) {
      throw new ConflictException(
        `PO run exists for allocation_run #${opts.allocationRunId}. Use forceRerunReason to override.`,
      );
    }
    if (opts.forceRerunReason && opts.forceRerunReason.length < 20) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }
    const isForceRerun = Boolean(opts.forceRerunReason) && existing.length > 0;

    // Step 1a: Hard gate — NO_CARRIER (R3 — blocks ENTIRE run)
    let transportPlan: Awaited<ReturnType<TransportLotSizingService['getTransportPlan']>>;
    try {
      transportPlan = await this.transportSvc.getTransportPlan(opts.transportPlanId);
    } catch (err) {
      if (err instanceof TransportPlanIncompleteException) {
        // Set po_run BLOCKED_INCOMPLETE and surface error
        const blockedRun: Array<{ id: string }> = await this.dataSource.query(
          `INSERT INTO po_run
             (allocation_run_id, transport_plan_id, atp_run_id, status, is_force_rerun, force_rerun_reason, created_by)
           VALUES ($1, $2, $3, 'BLOCKED_INCOMPLETE', $4, $5, $6)
           RETURNING id::text`,
          [
            opts.allocationRunId, opts.transportPlanId, opts.atpRunId,
            isForceRerun, opts.forceRerunReason ?? null,
            opts.createdBy ?? 'SYSTEM',
          ],
        );
        this.logger.warn(
          `[M27] po_run #${blockedRun[0].id} BLOCKED_INCOMPLETE — NO_CARRIER trips in transport_plan #${opts.transportPlanId}`,
        );
        throw new ServiceUnavailableException(
          `M27 blocked: transport_plan has NO_CARRIER trips. Resolve carrier before M27 can generate. Details: ${JSON.stringify((err as TransportPlanIncompleteException).reasons ?? [])}`,
        );
      }
      throw err;
    }

    // Step 1b: Hard gate — M26 ATP completed
    const atpResult = await this.atpSvc.getAtpResult(opts.allocationRunId);

    // Step 2: policy_run_id from M24 (Rule 14 pin) — via allocation_run
    const policyRows: Array<{ policy_run_id: string | null; plan_run_id: string | null }> =
      await this.dataSource.query(
        `SELECT policy_run_id::text, plan_run_id::text FROM allocation_run WHERE id = $1 LIMIT 1`,
        [opts.allocationRunId],
      );
    const policyRunId = policyRows[0]?.policy_run_id ?? null;
    const planRunId = policyRows[0]?.plan_run_id ?? null;

    // Step 3: Create po_run
    const runRows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO po_run
         (plan_run_id, allocation_run_id, transport_plan_id, atp_run_id, policy_run_id,
          status, is_force_rerun, force_rerun_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, 'RUNNING', $6, $7, $8)
       RETURNING id::text`,
      [
        planRunId, opts.allocationRunId, opts.transportPlanId, opts.atpRunId, policyRunId,
        isForceRerun, opts.forceRerunReason ?? null,
        opts.createdBy ?? 'SYSTEM_EVENT',
      ],
    );
    const poRunId = runRows[0].id;
    this.logger.log(`po_run #${poRunId} created for allocation_run #${opts.allocationRunId}`);

    try {
      // Step 4: Load allocation legs (C1/C2/C3 fix per spec §4 query)
      const legs = await this._loadAllocationLegs(opts.allocationRunId);

      // Step 5: Apply ATP gate + group into PO/TO candidates
      let skippedAtpFailCount = 0, skippedAtpBlockedCount = 0;
      let clampedAtpPartialCount = 0, variantReviewCount = 0, topUpCount = 0;

      // Group: PO key = `${nmId}|${cnId}|${effectivePeriod}|${isTopUp}`
      // Group: TO key = `${donorCnId}|${cnId}|${effectivePeriod}`
      const poGroups = new Map<string, {
        nmId: string; cnId: string; effectivePeriod: string; isTopUp: boolean;
        lines: Array<{ legId: string; skuId: string; variantCode: string | null;
          qty: number; requiresVariantReview: boolean; isTopUp: boolean; sourcePeriodStart: string | null; }>;
      }>();
      const toGroups = new Map<string, {
        donorCnId: string; receiverCnId: string; effectivePeriod: string;
        lines: Array<{ legId: string; skuId: string; qty: number; requiresVariantReview: boolean; }>;
      }>();

      for (const leg of legs) {
        const skuIdStr = String(leg.sku_id);
        const effectivePeriod = leg.effective_period;

        if (leg.source_type === 'CN_REDIST') {
          // TO candidate
          const donorCnId = String(leg.source_entity_id);
          const receiverCnId = String(leg.cn_id);
          const key = `${donorCnId}|${receiverCnId}|${effectivePeriod}`;
          if (!toGroups.has(key)) {
            toGroups.set(key, { donorCnId, receiverCnId, effectivePeriod, lines: [] });
          }
          toGroups.get(key)!.lines.push({
            legId: leg.leg_id,
            skuId: skuIdStr,
            qty: Number(leg.allocated_qty),
            requiresVariantReview: Boolean(leg.planner_review_required),
          });
          if (leg.planner_review_required) variantReviewCount++;
          continue;
        }

        // PO candidate (HUB / NM / TOP_UP_NEXT_WEEK)
        const nmId = leg.resolved_nm_id ? String(leg.resolved_nm_id) : null;
        if (!nmId) {
          this.logger.warn(`[M27] leg #${leg.leg_id} has no resolved NM (sku_nm_mapping miss) — skip`);
          continue;
        }

        const cnId = String(leg.cn_id);
        const isTopUp = Boolean(leg.is_top_up);
        const sourcePeriodStart = leg.source_period_start ?? null;

        // ATP gate (R2 / H1 sweep BLOCKED ≠ FAIL)
        const atpKey = atpCellKey(nmId, skuIdStr, effectivePeriod);
        const atp = atpResult.checks.get(atpKey);

        if (atp?.result === 'BLOCKED') {
          skippedAtpBlockedCount++;
          this.logger.warn(`[M27] SKIP BLOCKED NM#${nmId} SKU#${skuIdStr} ${effectivePeriod} — stale data, sync NM first`);
          continue;
        }
        if (atp?.result === 'FAIL') {
          skippedAtpFailCount++;
          this.logger.warn(`[M27] SKIP FAIL NM#${nmId} SKU#${skuIdStr} ${effectivePeriod} — NM zero stock`);
          continue;
        }

        let qty = Number(leg.allocated_qty);

        if (atp?.result === 'PARTIAL' && atp.urgencyRanking) {
          // Clamp to urgency_ranking.atp_alloc per CN
          const urgencyEntry = atp.urgencyRanking.find((e) => e.cnId === cnId);
          const atpAlloc = urgencyEntry?.atpAlloc ?? 0;
          if (atpAlloc === 0) {
            this.logger.log(`[M27] SKIP PARTIAL NM#${nmId} SKU#${skuIdStr} CN#${cnId} — urgency atp_alloc=0`);
            continue;
          }
          qty = Math.min(qty, atpAlloc);
          clampedAtpPartialCount++;
        }

        const groupKey = `${nmId}|${cnId}|${effectivePeriod}|${isTopUp}`;
        if (!poGroups.has(groupKey)) {
          poGroups.set(groupKey, { nmId, cnId, effectivePeriod, isTopUp, lines: [] });
        }
        poGroups.get(groupKey)!.lines.push({
          legId: leg.leg_id,
          skuId: skuIdStr,
          variantCode: null,  // Phase 1: no variant break
          qty,
          requiresVariantReview: Boolean(leg.planner_review_required),
          isTopUp,
          sourcePeriodStart,
        });
        if (leg.planner_review_required) variantReviewCount++;
        if (isTopUp) topUpCount++;
      }

      // Step 6: Bulk insert PO headers + lines
      const yearMonth = new Date().toISOString().slice(0, 7).replace('-', '');
      let totalPoCount = 0, totalToCount = 0;

      for (const [, group] of poGroups) {
        const poNumber = await this._nextPoNumber(yearMonth);
        const totalQty = group.lines.reduce((s, l) => s + l.qty, 0);

        const poRows: Array<{ id: string }> = await this.dataSource.query(
          `INSERT INTO po_header
             (po_run_id, po_number, nm_id, cn_id, status, total_qty)
           VALUES ($1, $2, $3, $4, 'DRAFT', $5)
           RETURNING id::text`,
          [poRunId, poNumber, group.nmId, group.cnId, totalQty],
        );
        const poHeaderId = poRows[0].id;

        // Insert po_tracking stub (will be filled at CONFIRMED → SHIPPED)
        await this.dataSource.query(
          `INSERT INTO po_tracking (po_header_id) VALUES ($1)`,
          [poHeaderId],
        );

        // Bulk insert lines
        for (const line of group.lines) {
          await this.dataSource.query(
            `INSERT INTO po_line
               (po_header_id, sku_id, requested_qty, confirmed_qty,
                source_allocation_leg_id, is_top_up, source_period_start,
                requires_variant_review)
             VALUES ($1, $2, $3, $3, $4, $5, $6, $7)
             ON CONFLICT (po_header_id, sku_id, COALESCE(variant_code, ''))
             DO UPDATE SET
               requested_qty  = po_line.requested_qty  + EXCLUDED.requested_qty,
               confirmed_qty  = po_line.confirmed_qty  + EXCLUDED.confirmed_qty`,
            [
              poHeaderId, line.skuId, line.qty,
              line.legId ? line.legId : null,
              line.isTopUp, line.sourcePeriodStart,
              line.requiresVariantReview,
            ],
          );
        }
        totalPoCount++;
      }

      for (const [, group] of toGroups) {
        const toNumber = await this._nextToNumber(yearMonth);
        const totalQty = group.lines.reduce((s, l) => s + l.qty, 0);

        const toRows: Array<{ id: string }> = await this.dataSource.query(
          `INSERT INTO to_header
             (po_run_id, to_number, donor_cn_id, receiver_cn_id, status, total_qty)
           VALUES ($1, $2, $3, $4, 'DRAFT', $5)
           RETURNING id::text`,
          [poRunId, toNumber, group.donorCnId, group.receiverCnId, totalQty],
        );
        const toHeaderId = toRows[0].id;

        await this.dataSource.query(
          `INSERT INTO to_tracking (to_header_id) VALUES ($1)`,
          [toHeaderId],
        );

        for (const line of group.lines) {
          await this.dataSource.query(
            `INSERT INTO to_line
               (to_header_id, sku_id, requested_qty, confirmed_qty,
                source_allocation_leg_id, requires_variant_review)
             VALUES ($1, $2, $3, $3, $4, $5)
             ON CONFLICT DO NOTHING`,
            [toHeaderId, line.skuId, line.qty, line.legId || null, line.requiresVariantReview],
          );
        }
        totalToCount++;
      }

      // Step 8: Finalize po_run COMPLETED
      const durationMs = Date.now() - startedAt;
      await this.dataSource.query(
        `UPDATE po_run SET
           status = 'COMPLETED', completed_at = NOW(),
           total_po_count = $1, total_to_count = $2,
           skipped_atp_fail_count = $3, skipped_atp_blocked_count = $4,
           clamped_atp_partial_count = $5, variant_review_count = $6, top_up_count = $7
         WHERE id = $8`,
        [
          totalPoCount, totalToCount,
          skippedAtpFailCount, skippedAtpBlockedCount,
          clampedAtpPartialCount, variantReviewCount, topUpCount,
          poRunId,
        ],
      );

      this.logger.log(
        `po_run #${poRunId} COMPLETED in ${durationMs}ms — PO:${totalPoCount} TO:${totalToCount} ` +
          `skipFAIL:${skippedAtpFailCount} skipBLOCKED:${skippedAtpBlockedCount} clamp:${clampedAtpPartialCount}`,
      );

      return {
        poRunId, status: 'COMPLETED',
        totalPoCount, totalToCount,
        skippedAtpFailCount, skippedAtpBlockedCount,
        clampedAtpPartialCount, variantReviewCount, topUpCount,
      };
    } catch (err) {
      await this.dataSource.query(
        `UPDATE po_run SET status = 'FAILED' WHERE id = $1`,
        [poRunId],
      );
      throw err;
    }
  }

  // ─── M28 injectable contracts ─────────────────────────────────────────────

  /** H4 CTO fix: per-line granularity for M28 honoring rate backfill */
  async getPoFulfillment(poId: string): Promise<PoFulfillmentDto> {
    const rows: Array<{
      id: string; po_number: string; nm_id: string; cn_id: string; status: string;
      confirmed_at: Date | null; cancelled_at: Date | null;
      nm_ship_date: Date | null; cn_received_date: Date | null; lt_actual_days: number | null;
    }> = await this.dataSource.query(
      `SELECT h.id::text, h.po_number, h.nm_id::text, h.cn_id::text, h.status,
              h.confirmed_at, h.cancelled_at,
              t.nm_ship_date, t.cn_received_date, t.lt_actual_days
       FROM po_header h
       LEFT JOIN po_tracking t ON t.po_header_id = h.id
       WHERE h.id = $1`,
      [poId],
    );
    if (rows.length === 0) throw new NotFoundException(`PO #${poId} not found`);
    const h = rows[0];

    const lineRows: Array<{
      id: string; sku_id: string; variant_code: string | null;
      source_period_start: string | null;
      requested_qty: number; confirmed_qty: number; actual_received_qty: number | null;
      is_top_up: boolean; delivery_incomplete: boolean; delivery_note: string | null;
    }> = await this.dataSource.query(
      `SELECT id::text, sku_id::text, variant_code,
              source_period_start::text,
              requested_qty::float, confirmed_qty::float, actual_received_qty::float,
              is_top_up, delivery_incomplete, delivery_note
       FROM po_line WHERE po_header_id = $1 AND status = 'ACTIVE'`,
      [poId],
    );

    return {
      poId: h.id,
      poNumber: h.po_number,
      nmId: h.nm_id,
      cnId: h.cn_id,
      status: h.status,
      confirmedAt: h.confirmed_at,
      shippedAt: h.nm_ship_date ? new Date(h.nm_ship_date) : null,
      receivedAt: h.cn_received_date ? new Date(h.cn_received_date) : null,
      closedAt: null,  // Phase 1 — no separate closed_at column
      ltActualDays: h.lt_actual_days,
      lines: lineRows.map((l) => ({
        lineId: l.id,
        skuId: l.sku_id,
        variantCode: l.variant_code,
        periodStart: l.source_period_start,
        requestedQty: Number(l.requested_qty),
        confirmedQty: Number(l.confirmed_qty),
        actualReceivedQty: l.actual_received_qty !== null ? Number(l.actual_received_qty) : null,
        isTopUp: Boolean(l.is_top_up),
        sourcePeriodStart: l.source_period_start,
        deliveryIncomplete: Boolean(l.delivery_incomplete),
        deliveryNote: l.delivery_note,
      })),
    };
  }

  /** M28: rolling actual LT per NM route for lead_time_days update */
  async getActualLtPerNmRoute(
    nmId: string, cnId: string, fromDate: string, toDate: string,
  ): Promise<number[]> {
    const rows: Array<{ lt_actual_days: number }> = await this.dataSource.query(
      `SELECT t.lt_actual_days
       FROM po_tracking t
       JOIN po_header h ON h.id = t.po_header_id
       WHERE h.nm_id = $1 AND h.cn_id = $2
         AND t.cn_received_date BETWEEN $3::date AND $4::date
         AND t.lt_actual_days IS NOT NULL`,
      [nmId, cnId, fromDate, toDate],
    );
    return rows.map((r) => Number(r.lt_actual_days));
  }

  // ─── Event listener (AND correlation — M1 CTO fix) ───────────────────────

  /**
   * Called by M25 when transport_plan COMPLETED.
   * Upserts po_run_pending row; triggers generate if M26 already done.
   */
  async onM25TransportCompleted(allocationRunId: string, transportPlanId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO po_run_pending (allocation_run_id, m25_done, transport_plan_id)
       VALUES ($1, TRUE, $2)
       ON CONFLICT (allocation_run_id) DO UPDATE
         SET m25_done = TRUE, transport_plan_id = EXCLUDED.transport_plan_id, updated_at = NOW()`,
      [allocationRunId, transportPlanId],
    );
    await this._checkAndTrigger(allocationRunId);
  }

  /**
   * Called by M26 when atp_run COMPLETED.
   * Upserts po_run_pending row; triggers generate if M25 already done.
   */
  async onM26AtpCompleted(allocationRunId: string, atpRunId: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO po_run_pending (allocation_run_id, m26_done, atp_run_id)
       VALUES ($1, TRUE, $2)
       ON CONFLICT (allocation_run_id) DO UPDATE
         SET m26_done = TRUE, atp_run_id = EXCLUDED.atp_run_id, updated_at = NOW()`,
      [allocationRunId, atpRunId],
    );
    await this._checkAndTrigger(allocationRunId);
  }

  // ─── Read API ─────────────────────────────────────────────────────────────

  async listRuns(opts: { status?: string; allocationRunId?: string; page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1, limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) { conditions.push(`status = $${params.length + 1}`); params.push(opts.status); }
    if (opts.allocationRunId) { conditions.push(`allocation_run_id = $${params.length + 1}`); params.push(opts.allocationRunId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [data, total] = await Promise.all([
      this.dataSource.query(`SELECT * FROM po_run ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM po_run ${where}`, params),
    ]);
    return { data, total: total[0].c, page, limit };
  }

  async listPo(opts: { status?: string; nmId?: string; cnId?: string; poRunId?: string; page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1, limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) { conditions.push(`h.status = $${params.length + 1}`); params.push(opts.status); }
    if (opts.nmId) { conditions.push(`h.nm_id = $${params.length + 1}`); params.push(opts.nmId); }
    if (opts.cnId) { conditions.push(`h.cn_id = $${params.length + 1}`); params.push(opts.cnId); }
    if (opts.poRunId) { conditions.push(`h.po_run_id = $${params.length + 1}`); params.push(opts.poRunId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [data, total] = await Promise.all([
      this.dataSource.query(
        `SELECT h.*, t.nm_ship_date, t.actual_eta_date, t.vehicle_no, t.carrier_code
         FROM po_header h LEFT JOIN po_tracking t ON t.po_header_id = h.id
         ${where} ORDER BY h.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM po_header h ${where}`, params),
    ]);
    return { data, total: total[0].c, page, limit };
  }

  async getPoDetail(poId: string) {
    const rows = await this.dataSource.query(
      `SELECT h.*, t.vehicle_no, t.carrier_code, t.container_no, t.driver_name, t.driver_phone,
              t.nm_ship_date, t.actual_eta_date, t.cn_received_date, t.lt_actual_days
       FROM po_header h LEFT JOIN po_tracking t ON t.po_header_id = h.id
       WHERE h.id = $1`,
      [poId],
    );
    if (rows.length === 0) throw new NotFoundException(`PO #${poId} not found`);
    const lines = await this.dataSource.query(
      `SELECT * FROM po_line WHERE po_header_id = $1 ORDER BY id`, [poId],
    );
    const editLog = await this.dataSource.query(
      `SELECT * FROM po_edit_log WHERE po_header_id = $1 ORDER BY changed_at DESC`, [poId],
    );
    return { ...rows[0], lines, editLog };
  }

  async listTo(opts: { status?: string; donorCnId?: string; receiverCnId?: string; page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1, limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) { conditions.push(`status = $${params.length + 1}`); params.push(opts.status); }
    if (opts.donorCnId) { conditions.push(`donor_cn_id = $${params.length + 1}`); params.push(opts.donorCnId); }
    if (opts.receiverCnId) { conditions.push(`receiver_cn_id = $${params.length + 1}`); params.push(opts.receiverCnId); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [data, total] = await Promise.all([
      this.dataSource.query(`SELECT * FROM to_header ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM to_header ${where}`, params),
    ]);
    return { data, total: total[0].c, page, limit };
  }

  async getToDetail(toId: string) {
    const rows = await this.dataSource.query(
      `SELECT h.*, t.vehicle_no, t.carrier_code, t.container_no,
              t.donor_ship_date, t.actual_eta_date, t.receiver_recv_date, t.lt_actual_days
       FROM to_header h LEFT JOIN to_tracking t ON t.to_header_id = h.id
       WHERE h.id = $1`,
      [toId],
    );
    if (rows.length === 0) throw new NotFoundException(`TO #${toId} not found`);
    const lines = await this.dataSource.query(
      `SELECT * FROM to_line WHERE to_header_id = $1 ORDER BY id`, [toId],
    );
    const editLog = await this.dataSource.query(
      `SELECT * FROM to_edit_log WHERE to_header_id = $1 ORDER BY changed_at DESC`, [toId],
    );
    return { ...rows[0], lines, editLog };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Step 4 SQL (C1/C2/C3 fix per spec §4):
   * - C2: filter via allocation_result, NOT allocation_leg direct
   * - C1: resolve NM via sku_nm_mapping single-source
   * - C3: COALESCE(source_period_start, period_start) as effective_period
   */
  private async _loadAllocationLegs(allocationRunId: string): Promise<Array<{
    leg_id: string; source_type: string; source_entity_id: string;
    source_period_start: string | null; cn_id: string; sku_id: string;
    is_top_up: boolean; effective_period: string;
    allocated_qty: number; resolved_nm_id: string | null;
    planner_review_required: boolean;
  }>> {
    return this.dataSource.query(
      `SELECT
         leg.id::text                                             AS leg_id,
         leg.source_type,
         leg.source_entity_id::text,
         leg.source_period_start::text,
         result.cn_id::text,
         result.sku_id::text,
         result.is_top_up,
         COALESCE(result.source_period_start, result.period_start)::text AS effective_period,
         leg.allocated_qty::float,
         m.nm_id::text                                           AS resolved_nm_id,
         COALESCE(result.planner_review_required, FALSE)         AS planner_review_required
       FROM allocation_leg leg
       JOIN allocation_result result ON result.id = leg.allocation_result_id
       LEFT JOIN sku_nm_mapping m ON m.sku_id = result.sku_id AND m.active = TRUE
       WHERE result.allocation_run_id = $1
         AND leg.source_type IN ('HUB', 'NM', 'TOP_UP_NEXT_WEEK', 'CN_REDIST')`,
      [allocationRunId],
    );
  }

  // BUG-1 + H1 fix: use PostgreSQL sequence — atomic, race-safe, no fake INSERT
  private async _nextPoNumber(yearMonth: string): Promise<string> {
    const seq: Array<{ n: string }> = await this.dataSource.query(
      `SELECT nextval('po_number_seq')::text AS n`,
    );
    const n = String(seq[0].n).padStart(5, '0');
    return `PO-${yearMonth}-${n}`;
  }

  private async _nextToNumber(yearMonth: string): Promise<string> {
    const seq: Array<{ n: string }> = await this.dataSource.query(
      `SELECT nextval('to_number_seq')::text AS n`,
    );
    const n = String(seq[0].n).padStart(5, '0');
    return `TO-${yearMonth}-${n}`;
  }

  private async _checkAndTrigger(allocationRunId: string): Promise<void> {
    const pending: Array<{
      m25_done: boolean; m26_done: boolean;
      transport_plan_id: string | null; atp_run_id: string | null;
    }> = await this.dataSource.query(
      `SELECT m25_done, m26_done, transport_plan_id::text, atp_run_id::text
       FROM po_run_pending WHERE allocation_run_id = $1`,
      [allocationRunId],
    );
    if (pending.length === 0) return;
    const row = pending[0];
    if (!row.m25_done || !row.m26_done) return;  // AND condition not met yet
    if (!row.transport_plan_id || !row.atp_run_id) return;

    // Both done — trigger generate, then cleanup pending row
    this.logger.log(`[M27] AND condition met for allocation_run #${allocationRunId} → triggering generate`);
    await this.dataSource.query(
      `DELETE FROM po_run_pending WHERE allocation_run_id = $1`,
      [allocationRunId],
    );
    // Fire-and-forget (notify only — actual trigger via REST or message queue in prod)
    this.generate({
      allocationRunId,
      transportPlanId: row.transport_plan_id,
      atpRunId: row.atp_run_id,
      createdBy: 'SYSTEM_EVENT',
    }).catch((err) =>
      this.logger.error(`[M27] Auto-generate failed for alloc_run #${allocationRunId}: ${(err as Error).message}`),
    );
  }
}
