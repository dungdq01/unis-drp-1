import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { mondayOfStr } from '../common/date-utils';
import { HUB_VIRTUAL_ID } from '../common/allocation-constants';

export interface TopUpContext {
  tripId: string;
  primaryDestLocationCode: string;   // resolved from CN channel_code
  sourceLocationCode: string;
  remainingPallets: number;
  remainingWeightKg: number;
  suggestedAt: Date;                  // H2 freeze
}

export interface TopUpRow {
  id: string;
  itemCode: string;
  suggestedQty: number;
  estimatedPallets: number;
  estimatedWeightKg: number;
  priorityScore: number;
  sourcePeriodStart: string;
}

/**
 * M25 §6 — Top-up suggestion engine + accept flow.
 *
 * Generate: for each HELD trip, query next-week forecast at dest, filter items
 * not yet allocated for that (cn, sku, period) cell, check supply availability
 * at source (line-level available = allocatable - reserved - in_transit -
 * reserved_for_transport), greedy-fill capacity.
 *
 * Accept: INSERT new allocation_result (is_top_up=TRUE) in SAME allocation_run
 * + new allocation_leg (source_type='TOP_UP_NEXT_WEEK') + transport_trip_line
 * + bump supply_snapshot_line.reserved_for_transport. No mutation of existing
 * rows (H1).
 */
@Injectable()
export class TransportTopUpService {
  private readonly logger = new Logger(TransportTopUpService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Generate suggestions for a HELD trip. */
  async generate(ctx: TopUpContext): Promise<TopUpRow[]> {
    const nextMonday = mondayOfStr(new Date(ctx.suggestedAt.getTime() + 7 * 86_400_000));

    // 1. Query forecast for dest at next_monday
    const rows: Array<{ item_code: string; forecast_qty: number }> = await this.dataSource.query(
      `SELECT dsl.item_code,
              SUM(COALESCE(dsl.reconciled_qty, dsl.qty))::float AS forecast_qty
       FROM demand_snapshot_line dsl
       JOIN demand_snapshot ds ON ds.snapshot_id = dsl.snapshot_id AND ds.status = 'FROZEN'
       WHERE dsl.location_code = $1
         AND dsl.period_start   = $2
       GROUP BY dsl.item_code
       HAVING SUM(COALESCE(dsl.reconciled_qty, dsl.qty)) > 0`,
      [ctx.primaryDestLocationCode, nextMonday],
    );

    if (rows.length === 0) return [];

    // 2. Filter items NOT yet allocated for this cell (location, item, next_monday)
    //    + check supply available at source (line-level)
    const itemCodes = rows.map((r) => r.item_code);
    const allocated: Array<{ item_code: string }> = await this.dataSource.query(
      `SELECT DISTINCT ar.item_code
       FROM allocation_result ar
       WHERE ar.dest_location_code = $1
         AND ar.item_code = ANY($2::varchar[])
         AND ar.period_start = $3`,
      [ctx.primaryDestLocationCode, itemCodes, nextMonday],
    );
    const alreadyAllocated = new Set(allocated.map((r) => r.item_code));

    const supply: Array<{ item_code: string; available: number }> = await this.dataSource.query(
      `SELECT ssl.item_code,
              SUM(GREATEST(0,
                COALESCE(ssl.override_qty, ssl.allocatable_qty)
                - COALESCE(ssl.reserved_qty, 0)
                - COALESCE(ssl.in_transit_qty, 0)
                - COALESCE(ssl.reserved_for_transport, 0)
              ))::float AS available
       FROM supply_snapshot_line ssl
       JOIN supply_snapshot ss ON ss.id = ssl.snapshot_id AND ss.status = 'FROZEN'
       WHERE ssl.location_code = $1
         AND ssl.item_code = ANY($2::varchar[])
       GROUP BY ssl.item_code`,
      [ctx.sourceLocationCode, itemCodes],
    );
    const availableBySku = new Map(supply.map((s) => [s.item_code, Number(s.available)]));

    // SKU dimension (weight / pallet size)
    const skuRows: Array<{ sku_code: string; weight_kg: number; pallet_size: number }> =
      await this.dataSource.query(
        `SELECT sku_code,
                COALESCE(weight_kg, 0)::float AS weight_kg,
                COALESCE(pallet_size, 10)::float AS pallet_size
         FROM sku
         WHERE sku_code = ANY($1::varchar[])`,
        [itemCodes],
      );
    const skuDim = new Map(skuRows.map((s) => [s.sku_code, s]));

    // 3. Greedy fill, priority = forecast_qty desc
    const sorted = rows
      .filter((r) => !alreadyAllocated.has(r.item_code))
      .filter((r) => (availableBySku.get(r.item_code) ?? 0) > 0)
      .sort((a, b) => Number(b.forecast_qty) - Number(a.forecast_qty));

    const suggestions: Array<{
      itemCode: string;
      suggestedQty: number;
      estimatedPallets: number;
      estimatedWeightKg: number;
      priorityScore: number;
    }> = [];

    let palletsLeft = ctx.remainingPallets;
    let weightLeft = ctx.remainingWeightKg;

    for (const r of sorted) {
      if (palletsLeft <= 0 || weightLeft <= 0) break;
      const dim = skuDim.get(r.item_code);
      if (!dim) continue;
      const palletSize = dim.pallet_size || 10;
      const weightPerUnit = dim.weight_kg || 0;
      const available = availableBySku.get(r.item_code) ?? 0;
      const maxByPallets = palletsLeft * palletSize;
      const maxByWeight = weightPerUnit > 0 ? weightLeft / weightPerUnit : Infinity;
      const qty = Math.min(Number(r.forecast_qty), available, maxByPallets, maxByWeight);
      if (qty < 1) continue;
      const pallets = Math.ceil(qty / palletSize);
      const weight = qty * weightPerUnit;
      suggestions.push({
        itemCode: r.item_code,
        suggestedQty: Math.floor(qty * 100) / 100,
        estimatedPallets: pallets,
        estimatedWeightKg: Math.round(weight * 100) / 100,
        priorityScore: Math.min(100, Math.floor(Number(r.forecast_qty) / 10)),
      });
      palletsLeft -= pallets;
      weightLeft -= weight;
    }

    if (suggestions.length === 0) return [];

    // 4. Persist suggestions — M4 + H2 audit
    const suggestedAtIso = ctx.suggestedAt.toISOString();
    const offsetWeeks = Math.max(0, Math.round(
      (new Date(nextMonday).getTime() - ctx.suggestedAt.getTime()) / (7 * 86_400_000),
    ));

    const placeholders: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    for (const s of suggestions) {
      placeholders.push(
        `($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},'FC_RAW')`,
      );
      values.push(
        ctx.tripId, s.itemCode, s.suggestedQty,
        s.estimatedPallets, s.estimatedWeightKg,
        'Forecast next week + unallocated', s.priorityScore,
        nextMonday, suggestedAtIso, offsetWeeks,
      );
    }

    const inserted: Array<{ id: string; item_code: string }> = await this.dataSource.query(
      `INSERT INTO top_up_suggestion
         (trip_id, item_code, suggested_qty,
          estimated_pallets, estimated_weight_kg, reason, priority_score,
          source_period_start, suggested_at, forecast_week_offset, demand_source)
       VALUES ${placeholders.join(',')}
       RETURNING id, item_code`,
      values,
    );

    return inserted.map((r) => {
      const s = suggestions.find((x) => x.itemCode === r.item_code)!;
      return {
        id: r.id,
        itemCode: r.item_code,
        suggestedQty: s.suggestedQty,
        estimatedPallets: s.estimatedPallets,
        estimatedWeightKg: s.estimatedWeightKg,
        priorityScore: s.priorityScore,
        sourcePeriodStart: nextMonday,
      };
    });
  }

  /**
   * Accept a top-up suggestion (§6b).
   * Transaction: suggestion status → ACCEPTED, INSERT allocation_result
   * (is_top_up=TRUE), INSERT allocation_leg, INSERT transport_trip_line,
   * bump reserved_for_transport.
   */
  async accept(suggestionId: string, userId: string): Promise<{ newResultId: string; newLegId: string }> {
    return this.dataSource.transaction(async (em) => {
      const rows: Array<{
        id: string; trip_id: string; item_code: string; suggested_qty: number;
        estimated_pallets: number; estimated_weight_kg: number;
        source_period_start: string; status: string;
        allocation_run_id: string | null;
        primary_dest_cn_id: string; dest_location_code: string; source_location_code: string;
      }> = await em.query(
        `SELECT tus.id, tus.trip_id::text, tus.item_code, tus.suggested_qty::float,
                tus.estimated_pallets, tus.estimated_weight_kg::float,
                tus.source_period_start::text, tus.status,
                tt.allocation_run_id::text,
                c.id::text AS primary_dest_cn_id,
                tt.dest_location_code, tt.source_location_code
         FROM top_up_suggestion tus
         JOIN transport_trip tt ON tt.id = tus.trip_id
         LEFT JOIN channel c ON c.channel_code = tt.dest_location_code
         WHERE tus.id = $1`,
        [suggestionId],
      );
      if (rows.length === 0) throw new NotFoundException(`top_up_suggestion #${suggestionId} not found`);
      const s = rows[0];
      if (s.status !== 'PENDING') {
        throw new BadRequestException(`Suggestion #${suggestionId} is ${s.status}, cannot accept`);
      }
      if (!s.allocation_run_id) {
        throw new BadRequestException(`Trip #${s.trip_id} has no allocation_run_id — cannot accept top-up`);
      }

      // Lookup sku id
      const skuRows: Array<{ id: string }> = await em.query(
        `SELECT id::text FROM sku WHERE sku_code = $1 LIMIT 1`,
        [s.item_code],
      );
      if (skuRows.length === 0) throw new BadRequestException(`sku_code ${s.item_code} not found`);

      // 1. Suggestion → ACCEPTED
      await em.query(
        `UPDATE top_up_suggestion SET status = 'ACCEPTED', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
        [userId, suggestionId],
      );

      // 2. INSERT new allocation_result (is_top_up=TRUE) in SAME run
      const resultRows: Array<{ id: string }> = await em.query(
        `INSERT INTO allocation_result
           (allocation_run_id, planned_order_id,
            cn_id, sku_id, period_start,
            item_code, dest_location_code,
            qty_required, qty_allocated, status,
            is_top_up, source_top_up_id, source_period_start)
         VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $7, 'TOP_UP_FILL', TRUE, $8, $4)
         RETURNING id::text`,
        [
          s.allocation_run_id,
          s.primary_dest_cn_id,
          skuRows[0].id,
          s.source_period_start,
          s.item_code,
          s.dest_location_code,
          s.suggested_qty,
          suggestionId,
        ],
      );
      const newResultId = resultRows[0].id;

      // 3. INSERT allocation_leg
      const legRows: Array<{ id: string }> = await em.query(
        `INSERT INTO allocation_leg
           (allocation_result_id, source_type, source_entity_id,
            source_lot_id, allocated_qty, fifo_rank, distance_km,
            source_period_start, origin_top_up_id)
         VALUES ($1, 'TOP_UP_NEXT_WEEK', $2, NULL, $3, NULL, NULL, $4, $5)
         RETURNING id::text`,
        [newResultId, HUB_VIRTUAL_ID, s.suggested_qty, s.source_period_start, suggestionId],
      );

      // 4. INSERT transport_trip_line (unassigned stop_id for single-drop held trip)
      await em.query(
        `INSERT INTO transport_trip_line
           (transport_trip_id, allocation_result_id, item_code, allocated_qty,
            weight_kg, source_allocation_leg_id, top_up_suggestion_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [s.trip_id, newResultId, s.item_code, s.suggested_qty, s.estimated_weight_kg, legRows[0].id, suggestionId],
      );

      // 5. Reserve supply (line-level)
      await em.query(
        `UPDATE supply_snapshot_line
           SET reserved_for_transport = reserved_for_transport + $1
         WHERE location_code = $2 AND item_code = $3`,
        [s.suggested_qty, s.source_location_code, s.item_code],
      );

      // 6. Bump trip totals + recompute fill (caller invokes recompute)
      await em.query(
        `UPDATE transport_trip
           SET total_pallets = total_pallets + $1,
               total_weight_kg = total_weight_kg + $2
         WHERE id = $3`,
        [s.estimated_pallets, s.estimated_weight_kg, s.trip_id],
      );

      this.logger.log(
        `top_up #${suggestionId} ACCEPTED → trip #${s.trip_id} +${s.suggested_qty} ${s.item_code} ` +
          `(new result #${newResultId}, leg #${legRows[0].id})`,
      );

      return { newResultId, newLegId: legRows[0].id };
    });
  }

  async reject(suggestionId: string, userId: string): Promise<void> {
    const res = await this.dataSource.query(
      `UPDATE top_up_suggestion
         SET status = 'REJECTED', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2 AND status = 'PENDING'
       RETURNING id`,
      [userId, suggestionId],
    );
    if (res.length === 0) {
      throw new NotFoundException(`Suggestion #${suggestionId} not found or not PENDING`);
    }
  }
}
