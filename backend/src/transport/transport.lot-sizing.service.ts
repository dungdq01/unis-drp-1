import {
  Injectable,
  Logger,
  OnModuleInit,
  OnApplicationBootstrap,
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
import { AllocationLcnbService, AllocationResultDto } from '../allocation/allocation.lcnb.service';
import { SystemConfigService } from '../system-config/system-config.service';
import {
  TransportMultiDropService,
  RawTrip,
  ConsolidatedTrip,
  VehicleCapacity,
} from './transport.multi-drop.service';
import { TransportTopUpService } from './transport.top-up.service';

// ─── DTOs (M25 → M27 contract, spec §14.1) ───────────────────────────────────

export interface TripStopDto {
  stopSequence: number;
  locationCode: string;
  palletsAtStop: number;
  weightKgAtStop: number;
  etaAtStop: string | null;
}

export interface TripLineDto {
  itemCode: string;
  allocatedQty: number;
  weightKg: number;
  stopId: string | null;
  sourceAllocationLegId: string | null;
  topUpSuggestionId: string | null;
}

export interface TripDto {
  tripId: string;
  sourceLocationCode: string;
  destLocationCode: string;
  status: string;
  carrierCode: string | null;
  vehicleTypeCode: string;
  fillRatio: number | null;
  holdDecision: string | null;
  holdUntilDate: string | null;
  isMultiDrop: boolean;
  stops: TripStopDto[];
  lines: TripLineDto[];
}

export interface TransportPlanDto {
  planId: string;
  allocationRunId: string | null;
  policyRunId: string | null;
  generatedAt: Date;
  status: string;
  trips: TripDto[];
}

export interface RunOptions {
  allocationRunId: string;
  createdBy?: string;
  forceRerunReason?: string;
}

export interface RunResult {
  transportPlanId: string;
  status: string;
  totalTrips: number;
  heldTrips: number;
  multiDropTrips: number;
  avgFillRatio: number;
  durationMs: number;
}

/**
 * H5 fix: single exception with reasons[] for precedence matrix.
 */
export class TransportPlanIncompleteException extends BadRequestException {
  constructor(
    public readonly reasons: Array<{ code: string; detail?: unknown }>,
    planId?: string,
  ) {
    super({
      message: `Transport plan${planId ? ` #${planId}` : ''} incomplete`,
      reasons,
    });
  }
}

/**
 * M25 — Transport Lot Sizing v2 orchestrator (spec §4 8-step pipeline).
 *
 * Trigger: auto via onModuleInit hook registered with M24. Manual: POST /v2/run.
 *
 * Pipeline:
 *   1. Load M24 allocation result (fail → exception)
 *   2. Reuse policy_run from M24/M23 (Rule 14)
 *   3. Create transport_plan (status=RUNNING)
 *   4. RAW BUILD trips from allocation_leg grouped by (source, dest)
 *   5. MULTI-DROP CONSOLIDATION (groupByPairwiseDistance + nearest-neighbor)
 *   6. COMPUTE fill_ratio per consolidated trip
 *   7. HOLD DECISION per trip (effective_hstk = MIN across stops)
 *   8. Persist trips + stops + lines; reserve supply line-level
 *   9. Finalize plan (COMPLETED or COMPLETED_PARTIAL if NO_CARRIER)
 */
@Injectable()
export class TransportLotSizingService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(TransportLotSizingService.name);
  private _cronTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly allocationSvc: AllocationLcnbService,
    private readonly multiDropSvc: TransportMultiDropService,
    private readonly topUpSvc: TransportTopUpService,
    private readonly systemConfigSvc: SystemConfigService,
    @Optional() @Inject(forwardRef(() => PoReviewService)) private readonly poReviewSvc?: PoReviewService,
  ) {}

  onModuleInit(): void {
    // Register as M24 post-COMPLETED hook so allocation.completed auto-triggers.
    // M24 exposes a similar setter — spec §7 "M24 callback event listener".
    // Since M24 wires into M23 via setPostCompletedHook, M25 wires into M24 via
    // the same pattern (to add after M24 exposes it). Phase 1: manual trigger
    // via POST /v2/run while the pattern rollout completes. See tech-debt.
    //
    // (If AllocationLcnbService later adds setPostAllocationHook, wire here.)
  }

  onApplicationBootstrap(): void {
    this._scheduleHeldReleaseCron();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async runV2(opts: RunOptions): Promise<RunResult> {
    if (!(await this.systemConfigSvc.isEnabled('m25_transport_v2_enabled'))) {
      throw new ServiceUnavailableException(
        'M25 Transport v2 disabled (feature flag m25_transport_v2_enabled=false)',
      );
    }
    const startedAt = Date.now();

    // Idempotent guard (R12)
    const existing = await this.dataSource.query(
      `SELECT id FROM transport_plan
       WHERE allocation_run_id = $1 AND is_force_rerun = FALSE LIMIT 1`,
      [opts.allocationRunId],
    );
    if (existing.length > 0 && !opts.forceRerunReason) {
      throw new ConflictException(
        `transport_plan exists for allocation_run #${opts.allocationRunId}. Use forceRerunReason to override.`,
      );
    }
    if (opts.forceRerunReason && opts.forceRerunReason.length < 20) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }
    const isForceRerun = Boolean(opts.forceRerunReason) && existing.length > 0;

    // Step 1: M24 allocation result
    const allocResult: AllocationResultDto = await this.allocationSvc.getAllocationResult(opts.allocationRunId);

    // Step 2: policy snapshot
    const policyRunId = allocResult.policyRunId;
    const config = await this._loadConfigSnapshot(policyRunId);
    const minFill = this._cfgNum(config, 'transport.min_fill_ratio', 0.6);
    const holdMaxDays = this._cfgNum(config, 'transport.hold_max_days', 2);
    const holdBufferDays = this._cfgNum(config, 'transport.hold_buffer_days', 1);
    const maxMultidropKm = this._cfgNum(config, 'transport.max_multidrop_distance_km', 200);

    // Step 3: create transport_plan
    const planRows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO transport_plan
         (allocation_run_id, policy_run_id, status, created_by,
          is_force_rerun, force_rerun_reason)
       VALUES ($1, $2, 'RUNNING', $3, $4, $5)
       RETURNING id`,
      [opts.allocationRunId, policyRunId, opts.createdBy ?? 'M24_CALLBACK',
        isForceRerun, opts.forceRerunReason ?? null],
    );
    const planId = planRows[0].id;
    this.logger.log(`transport_plan #${planId} created (allocation_run=${opts.allocationRunId})`);

    try {
      // Step 4: RAW BUILD trips
      const rawTrips = await this._buildRawTrips(allocResult);

      // Vehicle capacity (Phase 1 default from M00; could be per-lane)
      const vehicle = await this._defaultVehicleCapacity();

      // Distance matrix
      const distanceMap = await this._loadDistanceMatrix();

      // Step 5: CONSOLIDATE (multi-drop)
      const consolidated = this.multiDropSvc.consolidate(
        rawTrips, vehicle, distanceMap, maxMultidropKm,
      );

      // Step 6+7+8: compute fill + decide hold + persist
      const persisted = await this._persistTrips(
        planId, opts.allocationRunId, policyRunId,
        consolidated, vehicle, minFill, holdMaxDays, holdBufferDays,
      );

      // Step 9: finalize
      const durationMs = Date.now() - startedAt;
      const avgFill = persisted.trips.length > 0
        ? persisted.trips.reduce((s, t) => s + (t.fillRatio ?? 0), 0) / persisted.trips.length
        : 0;
      const heldCount = persisted.trips.filter((t) => t.status === 'HELD').length;
      const multiDropCount = persisted.trips.filter((t) => t.isMultiDrop).length;
      const noCarrierCount = persisted.trips.filter((t) => t.status === 'NO_CARRIER').length;

      const finalStatus = noCarrierCount > 0 ? 'COMPLETED_PARTIAL' : 'COMPLETED';

      await this.dataSource.query(
        `UPDATE transport_plan
           SET status = $1,
               total_trips = $2, held_trips = $3, multi_drop_trips = $4,
               avg_fill_ratio = $5, total_weight_kg = $6
         WHERE id = $7`,
        [
          finalStatus, persisted.trips.length, heldCount, multiDropCount,
          avgFill, persisted.totalWeight, planId,
        ],
      );

      this.logger.log(
        `transport_plan #${planId} ${finalStatus} in ${durationMs}ms — ` +
          `${persisted.trips.length} trips (${heldCount} held, ${multiDropCount} multi-drop, ${noCarrierCount} no_carrier)`,
      );

      // H3 fix: notify M27 AND correlation gate
      this.poReviewSvc?.onM25TransportCompleted(opts.allocationRunId, planId).catch(e =>
        this.logger.error(`M27 onM25TransportCompleted callback failed: ${e?.message}`),
      );

      return {
        transportPlanId: planId,
        status: finalStatus,
        totalTrips: persisted.trips.length,
        heldTrips: heldCount,
        multiDropTrips: multiDropCount,
        avgFillRatio: Math.round(avgFill * 10000) / 10000,
        durationMs,
      };
    } catch (err) {
      await this.dataSource.query(
        `UPDATE transport_plan SET status = 'FAILED' WHERE id = $1`,
        [planId],
      );
      throw err;
    }
  }

  /**
   * M25 → M27 injectable (spec §14.1).
   * H5 precedence: NOT_COMPLETED > NO_CARRIER > pass.
   */
  async getTransportPlan(planId: string): Promise<TransportPlanDto> {
    const planRows: Array<{
      id: string; allocation_run_id: string | null; policy_run_id: string | null;
      status: string; created_at: Date;
    }> = await this.dataSource.query(
      `SELECT id::text, allocation_run_id::text, policy_run_id::text, status, created_at
       FROM transport_plan WHERE id = $1`,
      [planId],
    );
    if (planRows.length === 0) throw new NotFoundException(`transport_plan #${planId} not found`);
    const plan = planRows[0];

    // H5 precedence 1: NOT_COMPLETED
    if (!['COMPLETED', 'COMPLETED_PARTIAL'].includes(plan.status)) {
      throw new TransportPlanIncompleteException(
        [{ code: 'NOT_COMPLETED', detail: plan.status }],
        planId,
      );
    }

    // H5 precedence 2: NO_CARRIER trips
    const noCarrier: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id::text FROM transport_trip
       WHERE transport_plan_id = $1
         AND (status = 'NO_CARRIER' OR carrier_code IS NULL)`,
      [planId],
    );
    if (noCarrier.length > 0) {
      throw new TransportPlanIncompleteException(
        [{ code: 'NO_CARRIER', detail: { trip_ids: noCarrier.map((t) => t.id) } }],
        planId,
      );
    }

    // Load trips + stops + lines
    const trips = await this._loadTripsForPlan(planId);

    return {
      planId: plan.id,
      allocationRunId: plan.allocation_run_id,
      policyRunId: plan.policy_run_id,
      generatedAt: plan.created_at,
      status: plan.status,
      trips,
    };
  }

  // ─── Trip operations ───────────────────────────────────────────────────────

  async releaseHeldTrip(tripId: string, userId: string): Promise<void> {
    // SC Manager force release — transition HELD → PLANNED + recompute fill
    await this._transitionTrip(tripId, 'HELD', 'PLANNED', userId, 'Manual release');
  }

  async extendHold(tripId: string, extendDays: number, userId: string): Promise<{ newHoldUntil: string }> {
    // H4 fix: hard cap at held_at + hold_max_days
    const rows: Array<{
      held_at: Date | null; hold_until_date: string | null; status: string;
    }> = await this.dataSource.query(
      `SELECT held_at, hold_until_date::text, status FROM transport_trip WHERE id = $1`,
      [tripId],
    );
    if (rows.length === 0) throw new NotFoundException(`trip #${tripId} not found`);
    if (rows[0].status !== 'HELD') {
      throw new BadRequestException(`trip #${tripId} is ${rows[0].status}, not HELD`);
    }
    if (!rows[0].held_at || !rows[0].hold_until_date) {
      throw new BadRequestException(`trip #${tripId} missing held_at/hold_until_date`);
    }

    const holdMaxDays = Number(
      (await this.dataSource.query(
        `SELECT config_value FROM system_config WHERE config_key = 'transport.hold_max_days' LIMIT 1`,
      ))[0]?.config_value ?? 2,
    );

    // Compare at DAY granularity (UTC midnight) — avoids drift from timestamps
    // where held_at has hh:mm:ss and hold_until_date is 00:00:00.
    const DAY = 86_400_000;
    const dayFloor = (ms: number) => Math.floor(ms / DAY) * DAY;

    const heldAtDay = dayFloor(rows[0].held_at.getTime());
    const capDay = heldAtDay + holdMaxDays * DAY;
    const currentDay = dayFloor(new Date(rows[0].hold_until_date).getTime());
    const proposedDay = currentDay + extendDays * DAY;
    const newDay = Math.min(proposedDay, capDay);

    if (newDay <= currentDay) {
      throw new ConflictException(
        `trip #${tripId} already at hold cap (held_at + ${holdMaxDays}d). Force ship or cancel.`,
      );
    }

    const newHoldUntil = new Date(newDay).toISOString().slice(0, 10);
    await this.dataSource.query(
      `UPDATE transport_trip SET hold_until_date = $1 WHERE id = $2`,
      [newHoldUntil, tripId],
    );
    this.logger.log(`trip #${tripId} HOLD extended to ${newHoldUntil} by ${userId}`);
    return { newHoldUntil };
  }

  async cancelTrip(tripId: string, reason: string, userId: string): Promise<void> {
    if (!reason || reason.length < 20) {
      throw new BadRequestException('cancel reason must be ≥ 20 chars');
    }
    const rows: Array<{ status: string }> = await this.dataSource.query(
      `SELECT status FROM transport_trip WHERE id = $1`,
      [tripId],
    );
    if (rows.length === 0) throw new NotFoundException(`trip #${tripId} not found`);
    if (['DISPATCHED', 'DELIVERED'].includes(rows[0].status)) {
      throw new BadRequestException(`trip #${tripId} is ${rows[0].status} — cannot cancel (already en route)`);
    }

    await this.dataSource.transaction(async (em) => {
      await em.query(
        `UPDATE transport_trip SET status='CANCELLED', cancel_reason = $1 WHERE id = $2`,
        [`${reason} (by ${userId})`, tripId],
      );
      // Release reservation
      await em.query(
        `UPDATE supply_snapshot_line ssl
           SET reserved_for_transport = GREATEST(0, ssl.reserved_for_transport - sub.qty)
         FROM (
           SELECT tt.source_location_code AS loc, ttl.item_code, SUM(ttl.allocated_qty) AS qty
           FROM transport_trip_line ttl
           JOIN transport_trip tt ON tt.id = ttl.transport_trip_id
           WHERE ttl.transport_trip_id = $1
           GROUP BY tt.source_location_code, ttl.item_code
         ) sub
         WHERE ssl.location_code = sub.loc AND ssl.item_code = sub.item_code`,
        [tripId],
      );
    });
    this.logger.log(`trip #${tripId} CANCELLED by ${userId}: ${reason}`);
  }

  // ─── Held release cron (spec §8, R10) ──────────────────────────────────────

  private _scheduleHeldReleaseCron(): void {
    const msUntil = this._msUntilVN('06:00');
    this._cronTimer = setTimeout(async () => {
      try {
        const result = await this.runHeldRelease();
        this.logger.log(`[CRON 06:00] held-release: ${result.released} released, ${result.forced} force-shipped`);
      } catch (err) {
        this.logger.error(`[CRON 06:00] held-release failed: ${(err as Error).message}`);
      } finally {
        this._scheduleHeldReleaseCron();
      }
    }, msUntil);
  }

  async runHeldRelease(): Promise<{ released: number; forced: number; stillHeld: number }> {
    const holdMaxDays = this._cfgNum(await this._loadConfigSnapshot(null), 'transport.hold_max_days', 2);
    const minFill = this._cfgNum(await this._loadConfigSnapshot(null), 'transport.min_fill_ratio', 0.6);

    const rows: Array<{
      id: string; fill_ratio: number | null; held_at: Date; hold_until_date: string;
    }> = await this.dataSource.query(
      `SELECT id::text, fill_ratio::float, held_at, hold_until_date::text
       FROM transport_trip
       WHERE status = 'HELD'
         AND hold_until_date <= CURRENT_DATE`,
    );

    let released = 0, forced = 0, stillHeld = 0;
    const today = Date.now();
    for (const t of rows) {
      const heldAt = t.held_at.getTime();
      const capReached = (today - heldAt) >= holdMaxDays * 86_400_000;
      const fillOk = (t.fill_ratio ?? 0) >= minFill;

      if (fillOk) {
        await this.dataSource.query(
          `UPDATE transport_trip SET status='PLANNED', hold_decision='SHIP' WHERE id = $1`,
          [t.id],
        );
        released++;
      } else if (capReached) {
        await this.dataSource.query(
          `UPDATE transport_trip SET status='PLANNED', hold_decision='FORCE_SHIP_TIMEOUT',
             hold_reason = COALESCE(hold_reason,'') || ' | Force shipped after ' || $2 || ' days'
           WHERE id = $1`,
          [t.id, holdMaxDays],
        );
        forced++;
      } else {
        stillHeld++;
      }
    }
    return { released, forced, stillHeld };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _buildRawTrips(alloc: AllocationResultDto): Promise<RawTrip[]> {
    // Group legs (not results) by (source_entity_id → source_location, dest_location)
    // Phase 1: source = HUB_VIRTUAL (location code resolved from config) OR donor CN.
    // For simplicity: group by cell's dest, source = primary HUB location code.

    // Resolve HUB default source location
    const hubRows: Array<{ channel_code: string }> = await this.dataSource.query(
      `SELECT channel_code FROM channel WHERE channel_code LIKE 'HUB%' ORDER BY id LIMIT 1`,
    );
    const hubCode = hubRows[0]?.channel_code ?? 'HUB_HCM';

    const channelRows: Array<{ id: string; channel_code: string }> = await this.dataSource.query(
      `SELECT id::text, channel_code FROM channel`,
    );
    const channelCodeById = new Map(channelRows.map((r) => [r.id, r.channel_code]));

    const skuRows: Array<{ id: string; sku_code: string; weight_kg: number; pallet_size: number }> =
      await this.dataSource.query(
        `SELECT id::text, sku_code,
                COALESCE(weight_kg, 0)::float AS weight_kg,
                COALESCE(pallet_size, 10)::float AS pallet_size FROM sku`,
      );
    const skuById = new Map(skuRows.map((r) => [r.id, r]));

    // Group cells by (source, dest)
    const bySourceDest = new Map<string, RawTrip>();
    for (const cell of alloc.results.values()) {
      if (cell.qtyAllocated <= 0) continue;
      const destCode = channelCodeById.get(cell.cnId) ?? `CN-${cell.cnId}`;
      for (const leg of cell.legs) {
        const sourceCode = leg.sourceType === 'CN_REDIST'
          ? (channelCodeById.get(leg.sourceEntityId) ?? `CN-${leg.sourceEntityId}`)
          : hubCode;
        const key = `${sourceCode}|${destCode}`;
        const existing = bySourceDest.get(key) ?? {
          sourceLocationCode: sourceCode,
          destLocationCode: destCode,
          totalPallets: 0,
          totalWeightKg: 0,
          items: [],
        };
        const sku = skuById.get(cell.skuId);
        const skuCode = sku?.sku_code ?? `SKU-${cell.skuId}`;
        const weightKg = (sku?.weight_kg ?? 0) * leg.allocatedQty;
        const palletSize = sku?.pallet_size ?? 10;
        const pallets = Math.ceil(leg.allocatedQty / palletSize);
        existing.items.push({
          itemCode: skuCode,
          qty: leg.allocatedQty,
          weightKg,
          pallets,
          sourceAllocationLegId: leg.legId,
          allocationResultId: leg.allocationResultId,
        });
        existing.totalPallets += pallets;
        existing.totalWeightKg += weightKg;
        bySourceDest.set(key, existing);
      }
    }

    return Array.from(bySourceDest.values());
  }

  private async _defaultVehicleCapacity(): Promise<VehicleCapacity> {
    const rows: Array<{ max_pallets: number; max_weight_kg: number }> = await this.dataSource.query(
      `SELECT COALESCE(max_pallets, 20) AS max_pallets,
              COALESCE(max_weight_kg, 10000)::float AS max_weight_kg
       FROM vehicle_type ORDER BY id LIMIT 1`,
    );
    if (rows.length === 0) return { maxPallets: 20, maxWeightKg: 10_000 };
    return { maxPallets: rows[0].max_pallets, maxWeightKg: Number(rows[0].max_weight_kg) };
  }

  private async _loadDistanceMatrix(): Promise<Map<string, number>> {
    const rows: Array<{ source: string; dest: string; distance_km: number }> =
      await this.dataSource.query(
        `SELECT source_location_code AS source, dest_location_code AS dest, distance_km::float
         FROM transport_lane WHERE is_active = TRUE`,
      );
    const m = new Map<string, number>();
    for (const r of rows) m.set(`${r.source}|${r.dest}`, Number(r.distance_km));
    return m;
  }

  private async _persistTrips(
    planId: string,
    allocationRunId: string,
    policyRunId: string | null,
    consolidated: ConsolidatedTrip[],
    vehicle: VehicleCapacity,
    minFill: number,
    holdMaxDays: number,
    holdBufferDays: number,
  ): Promise<{
    trips: Array<{ id: string; status: string; isMultiDrop: boolean; fillRatio: number | null }>;
    totalWeight: number;
  }> {
    const outputTrips: Array<{ id: string; status: string; isMultiDrop: boolean; fillRatio: number | null }> = [];
    let totalWeight = 0;

    for (const ct of consolidated) {
      const fillRatio = this.multiDropSvc.computeFillRatio(ct.totalPallets, ct.totalWeightKg, vehicle);

      // Carrier + lead time lookup first — lead time feeds _decideHold (BUG-M25-3 fix).
      // If no lane/carrier found → status = 'NO_CARRIER' (caught by getTransportPlan C6 gate).
      const destCode = ct.stops[0]?.locationCode ?? '';
      const laneRows: Array<{ carrier_code: string | null; lead_time_days: number | null }> =
        await this.dataSource.query(
          `SELECT tl.carrier_code, tl.lead_time_days
           FROM transport_lane tl
           WHERE tl.source_location_code = $1
             AND tl.dest_location_code   = $2
             AND tl.is_active = TRUE
           ORDER BY tl.id LIMIT 1`,
          [ct.sourceLocationCode, destCode],
        );
      const carrierCode = laneRows[0]?.carrier_code ?? null;
      const leadTimeDays = laneRows[0]?.lead_time_days ?? 1;

      const { decision, holdUntilDate, holdReason } = await this._decideHold(
        ct, fillRatio, minFill, holdMaxDays, holdBufferDays, leadTimeDays,
      );
      const tripStatus = carrierCode === null ? 'NO_CARRIER' : (decision === 'HOLD' ? 'HELD' : 'PLANNED');
      const status = tripStatus; // alias for hold-generation check below

      const tripRows: Array<{ id: string }> = await this.dataSource.query(
        `INSERT INTO transport_trip
           (transport_plan_id, source_location_code, dest_location_code,
            vehicle_type_code, carrier_code, total_pallets, total_weight_kg,
            lead_time_days, status,
            fill_ratio, hold_decision, hold_until_date, hold_reason, held_at,
            is_multi_drop, stop_count,
            policy_run_id, allocation_run_id)
         VALUES ($1, $2, $3, 'FLATBED', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id::text`,
        [
          planId,
          ct.sourceLocationCode,
          destCode,
          carrierCode,
          ct.totalPallets,
          ct.totalWeightKg,
          leadTimeDays,
          tripStatus,
          fillRatio, decision, holdUntilDate, holdReason,
          tripStatus === 'HELD' ? new Date() : null,
          ct.isMultiDrop, ct.stops.length,
          policyRunId, allocationRunId,
        ],
      );
      const tripId = tripRows[0].id;

      // Persist stops
      const stopIdByLoc = new Map<string, string>();
      if (ct.isMultiDrop) {
        for (const stop of ct.stops) {
          const stopRows: Array<{ id: string }> = await this.dataSource.query(
            `INSERT INTO transport_trip_stop
               (trip_id, stop_sequence, location_code, pallets_at_stop, weight_kg_at_stop)
             VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
            [tripId, stop.stopSequence, stop.locationCode, stop.palletsAtStop, stop.weightKgAtStop],
          );
          stopIdByLoc.set(stop.locationCode, stopRows[0].id);
        }
      }

      // Persist lines with stop_id mapping (C3) + real allocation IDs (BUG-2 fix)
      for (let i = 0; i < ct.items.length; i++) {
        const item = ct.items[i];
        const stopId = ct.isMultiDrop ? (stopIdByLoc.get(ct.itemStopMapping[i]) ?? null) : null;
        await this.dataSource.query(
          `INSERT INTO transport_trip_line
             (transport_trip_id, allocation_result_id, item_code, allocated_qty,
              weight_kg, stop_id, source_allocation_leg_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tripId,
            item.allocationResultId ?? null,
            item.itemCode,
            item.qty,
            item.weightKg,
            stopId,
            item.sourceAllocationLegId ?? null,
          ],
        );
      }

      // Reserve supply line-level (C1+C4)
      const itemAgg = new Map<string, number>();
      for (const item of ct.items) {
        itemAgg.set(item.itemCode, (itemAgg.get(item.itemCode) ?? 0) + item.qty);
      }
      for (const [itemCode, qty] of itemAgg) {
        await this.dataSource.query(
          `UPDATE supply_snapshot_line
             SET reserved_for_transport = reserved_for_transport + $1
           WHERE location_code = $2 AND item_code = $3`,
          [qty, ct.sourceLocationCode, itemCode],
        );
      }

      // Generate top-up suggestions if HELD
      if (status === 'HELD' && ct.stops.length > 0) {
        try {
          await this.topUpSvc.generate({
            tripId,
            primaryDestLocationCode: ct.stops[0].locationCode,
            sourceLocationCode: ct.sourceLocationCode,
            remainingPallets: Math.max(0, vehicle.maxPallets - ct.totalPallets),
            remainingWeightKg: Math.max(0, vehicle.maxWeightKg - ct.totalWeightKg),
            suggestedAt: new Date(),
          });
        } catch (err) {
          this.logger.warn(`top-up generate failed for trip #${tripId}: ${(err as Error).message}`);
        }
      }

      outputTrips.push({ id: tripId, status, isMultiDrop: ct.isMultiDrop, fillRatio });
      totalWeight += ct.totalWeightKg;
    }

    return { trips: outputTrips, totalWeight };
  }

  private async _decideHold(
    ct: ConsolidatedTrip,
    fillRatio: number,
    minFill: number,
    holdMaxDays: number,
    holdBufferDays: number,
    leadTimeDays: number,
  ): Promise<{
    decision: 'SHIP' | 'HOLD' | 'FORCE_SHIP_LOW_FILL';
    holdUntilDate: string | null;
    holdReason: string | null;
  }> {
    if (fillRatio >= minFill) {
      return { decision: 'SHIP', holdUntilDate: null, holdReason: `Fill ${(fillRatio * 100).toFixed(0)}%` };
    }

    // Query HSTK per stop — Phase 1 fallback to a default 10 days if no data
    // (M8 HSTK service not in this module's scope)
    const stopLocs = ct.stops.map((s) => s.locationCode);
    const hstkRows: Array<{ location_code: string; hstk_days: number }> = await this.dataSource.query(
      `SELECT channel_code AS location_code, 10::int AS hstk_days FROM channel WHERE channel_code = ANY($1::varchar[])`,
      [stopLocs],
    );
    const hstkByLoc = new Map(hstkRows.map((r) => [r.location_code, Number(r.hstk_days)]));

    const effectiveHstk = Math.min(...stopLocs.map((loc) => hstkByLoc.get(loc) ?? 10));
    const safeToHold = effectiveHstk > leadTimeDays + holdBufferDays;

    if (safeToHold) {
      const holdDays = Math.min(holdMaxDays, effectiveHstk - leadTimeDays - holdBufferDays);
      const holdUntil = new Date(Date.now() + holdDays * 86_400_000).toISOString().slice(0, 10);
      return {
        decision: 'HOLD',
        holdUntilDate: holdUntil,
        holdReason: `Fill ${(fillRatio * 100).toFixed(0)}%, HSTK ${effectiveHstk}d > LT+buffer ${leadTimeDays + holdBufferDays}d`,
      };
    }

    return {
      decision: 'FORCE_SHIP_LOW_FILL',
      holdUntilDate: null,
      holdReason: `Fill ${(fillRatio * 100).toFixed(0)}%, HSTK ${effectiveHstk}d ≤ LT+buffer ${leadTimeDays + holdBufferDays}d — stockout risk`,
    };
  }

  private async _transitionTrip(
    tripId: string, expectedFrom: string, to: string,
    userId: string, reason: string,
  ): Promise<void> {
    const rows: Array<{ status: string }> = await this.dataSource.query(
      `SELECT status FROM transport_trip WHERE id = $1`,
      [tripId],
    );
    if (rows.length === 0) throw new NotFoundException(`trip #${tripId} not found`);
    if (rows[0].status !== expectedFrom) {
      throw new BadRequestException(
        `trip #${tripId} is ${rows[0].status}, expected ${expectedFrom}`,
      );
    }
    await this.dataSource.query(
      `UPDATE transport_trip SET status = $1 WHERE id = $2`,
      [to, tripId],
    );
    this.logger.log(`trip #${tripId} ${expectedFrom} → ${to} by ${userId} (${reason})`);
  }

  private async _loadConfigSnapshot(policyRunId: string | null): Promise<Record<string, unknown>> {
    if (policyRunId) {
      const rows: Array<{ config_snapshot: Record<string, unknown> }> = await this.dataSource.query(
        `SELECT config_snapshot FROM policy_run WHERE id = $1`,
        [policyRunId],
      );
      if (rows.length > 0) return rows[0].config_snapshot;
    }
    // Fallback: read live system_config
    const rows: Array<{ config_key: string; config_value: string }> = await this.dataSource.query(
      `SELECT config_key, config_value FROM system_config WHERE config_key LIKE 'transport.%'`,
    );
    const cfg: Record<string, unknown> = {};
    for (const r of rows) cfg[r.config_key] = r.config_value;
    return cfg;
  }

  private _cfgNum(cfg: Record<string, unknown>, key: string, fallback: number): number {
    const v = cfg[key];
    if (v === undefined || v === null) return fallback;
    const n = Number(v);
    return isNaN(n) ? fallback : n;
  }

  private async _loadTripsForPlan(planId: string): Promise<TripDto[]> {
    const tripRows: Array<{
      id: string; source_location_code: string; dest_location_code: string;
      status: string; carrier_code: string | null; vehicle_type_code: string;
      fill_ratio: number | null; hold_decision: string | null;
      hold_until_date: string | null; is_multi_drop: boolean;
    }> = await this.dataSource.query(
      `SELECT id::text, source_location_code, dest_location_code,
              status, carrier_code, vehicle_type_code,
              fill_ratio::float, hold_decision,
              hold_until_date::text, is_multi_drop
       FROM transport_trip WHERE transport_plan_id = $1 ORDER BY id`,
      [planId],
    );

    const trips: TripDto[] = [];
    for (const t of tripRows) {
      const stops: Array<{ stop_sequence: number; location_code: string; pallets_at_stop: number; weight_kg_at_stop: number; eta_at_stop: string | null }> =
        await this.dataSource.query(
          `SELECT stop_sequence, location_code, pallets_at_stop, weight_kg_at_stop::float, eta_at_stop::text
           FROM transport_trip_stop WHERE trip_id = $1 ORDER BY stop_sequence`,
          [t.id],
        );
      const lines: Array<{ item_code: string; allocated_qty: number; weight_kg: number; stop_id: string | null; source_allocation_leg_id: string | null; top_up_suggestion_id: string | null }> =
        await this.dataSource.query(
          `SELECT item_code, allocated_qty::float, weight_kg::float,
                  stop_id::text, source_allocation_leg_id::text, top_up_suggestion_id::text
           FROM transport_trip_line WHERE transport_trip_id = $1`,
          [t.id],
        );

      trips.push({
        tripId: t.id,
        sourceLocationCode: t.source_location_code,
        destLocationCode: t.dest_location_code,
        status: t.status,
        carrierCode: t.carrier_code,
        vehicleTypeCode: t.vehicle_type_code,
        fillRatio: t.fill_ratio,
        holdDecision: t.hold_decision,
        holdUntilDate: t.hold_until_date,
        isMultiDrop: t.is_multi_drop,
        stops: stops.map((s) => ({
          stopSequence: s.stop_sequence,
          locationCode: s.location_code,
          palletsAtStop: s.pallets_at_stop,
          weightKgAtStop: Number(s.weight_kg_at_stop),
          etaAtStop: s.eta_at_stop,
        })),
        lines: lines.map((l) => ({
          itemCode: l.item_code,
          allocatedQty: Number(l.allocated_qty),
          weightKg: Number(l.weight_kg),
          stopId: l.stop_id,
          sourceAllocationLegId: l.source_allocation_leg_id,
          topUpSuggestionId: l.top_up_suggestion_id,
        })),
      });
    }
    return trips;
  }

  private _msUntilVN(targetVN: string): number {
    const [hh, mm] = targetVN.split(':').map(Number);
    const nowMs = Date.now();
    const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000);
    const fire = new Date(Date.UTC(
      vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate(),
      hh - 7, mm, 0, 0,
    ));
    if (fire.getTime() <= nowMs) fire.setUTCDate(fire.getUTCDate() + 1);
    return fire.getTime() - nowMs;
  }

  // ─── Read API ──────────────────────────────────────────────────────────────

  async listPlans(opts: { status?: string; page?: number; limit?: number } = {}) {
    const page = opts.page ?? 1, limit = opts.limit ?? 20;
    const offset = (page - 1) * limit;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (opts.status) { conditions.push(`status = $${params.length + 1}`); params.push(opts.status); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [data, total] = await Promise.all([
      this.dataSource.query(
        `SELECT * FROM transport_plan ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        params,
      ),
      this.dataSource.query(`SELECT COUNT(*)::int AS c FROM transport_plan ${where}`, params),
    ]);
    return { data, total: total[0].c, page, limit };
  }

  async listTrips(planId: string, opts: { status?: string } = {}) {
    const conditions = [`transport_plan_id = $1`];
    const params: unknown[] = [planId];
    if (opts.status) { conditions.push(`status = $${params.length + 1}`); params.push(opts.status); }
    return this.dataSource.query(
      `SELECT * FROM transport_trip WHERE ${conditions.join(' AND ')} ORDER BY id`,
      params,
    );
  }

  async getTripDetail(tripId: string) {
    const trips = await this.dataSource.query(`SELECT * FROM transport_trip WHERE id = $1`, [tripId]);
    if (trips.length === 0) throw new NotFoundException(`trip #${tripId} not found`);
    const stops = await this.dataSource.query(
      `SELECT * FROM transport_trip_stop WHERE trip_id = $1 ORDER BY stop_sequence`, [tripId],
    );
    const lines = await this.dataSource.query(
      `SELECT * FROM transport_trip_line WHERE transport_trip_id = $1`, [tripId],
    );
    const topUps = await this.dataSource.query(
      `SELECT * FROM top_up_suggestion WHERE trip_id = $1 ORDER BY priority_score DESC`, [tripId],
    );
    return { ...trips[0], stops, lines, topUpSuggestions: topUps };
  }

  async listTopUps(tripId: string) {
    return this.dataSource.query(
      `SELECT * FROM top_up_suggestion WHERE trip_id = $1 ORDER BY priority_score DESC`,
      [tripId],
    );
  }
}
