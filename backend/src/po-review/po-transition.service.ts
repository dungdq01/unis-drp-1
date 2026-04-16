import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export class InvalidTransitionException extends ConflictException {
  constructor(from: string, to: string, entity = 'PO') {
    super(`Cannot transition ${entity} from ${from} → ${to}`);
  }
}

const PO_TRANSITION_MATRIX: Record<string, string[]> = {
  DRAFT:     ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED:   ['RECEIVED'],
  RECEIVED:  ['CLOSED'],
  CLOSED:    [],
  CANCELLED: [],
};

const TO_TRANSITION_MATRIX: Record<string, string[]> = {
  DRAFT:     ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['SHIPPED', 'CANCELLED'],
  SHIPPED:   ['RECEIVED'],
  RECEIVED:  ['CLOSED'],
  CLOSED:    [],
  CANCELLED: [],
};

export interface TransitionPoDto {
  toStatus: 'CONFIRMED' | 'SHIPPED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';
  // SHIPPED mandatory (R9)
  vehicleNo?: string;
  carrierCode?: string;
  containerNo?: string;
  shipDate?: string;
  // RECEIVED mandatory when < confirmed (R10)
  actualReceivedQty?: number;
  receiveDate?: string;
  note?: string;
  // CANCELLED
  cancelReason?: string;
  // common
  changedBy?: string;
  idempotencyKey?: string;
}

@Injectable()
export class PoTransitionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async transitionPo(poId: string, dto: TransitionPoDto): Promise<{ id: string; status: string }> {
    const rows: Array<{ id: string; status: string; nm_id: string; cn_id: string }> =
      await this.dataSource.query(
        `SELECT id::text, status, nm_id::text, cn_id::text FROM po_header WHERE id = $1`,
        [poId],
      );
    if (rows.length === 0) throw new NotFoundException(`PO #${poId} not found`);
    const po = rows[0];
    const allowed = PO_TRANSITION_MATRIX[po.status] ?? [];
    if (!allowed.includes(dto.toStatus)) {
      throw new InvalidTransitionException(po.status, dto.toStatus, 'PO');
    }

    await this.dataSource.transaction(async (em) => {
      // Validate mandatory fields per transition
      if (dto.toStatus === 'CONFIRMED') {
        // Idempotency check (R13 — Sprint 0 BUG-03 pattern)
        if (dto.idempotencyKey) {
          const idem = await em.query(
            `SELECT result_json FROM idempotency_log WHERE key = $1 AND expires_at > NOW()`,
            [dto.idempotencyKey],
          );
          if (idem.length > 0) return idem[0].result_json;
        }
        await em.query(
          `UPDATE po_header
           SET status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by = $1, updated_at = NOW()
           WHERE id = $2`,
          [dto.changedBy ?? 'SYSTEM', poId],
        );
        await em.query(
          `INSERT INTO po_edit_log (po_header_id, field_changed, old_value, new_value, reason, changed_by)
           VALUES ($1, 'status', $2, 'CONFIRMED', 'Planner confirmed PO', $3)`,
          [poId, po.status, dto.changedBy ?? 'SYSTEM'],
        );
        if (dto.idempotencyKey) {
          await em.query(
            `INSERT INTO idempotency_log (key, endpoint, result_json, status_code)
             VALUES ($1, '/po-review/po/:id/confirm', $2, 200)
             ON CONFLICT (key) DO NOTHING`,
            [dto.idempotencyKey, JSON.stringify({ id: poId, status: 'CONFIRMED' })],
          );
        }
      }

      if (dto.toStatus === 'SHIPPED') {
        // R9: vehicle_no + carrier_code + container_no mandatory
        if (!dto.vehicleNo) throw new BadRequestException('Số xe (vehicle_no) bắt buộc khi SHIPPED');
        if (!dto.carrierCode) throw new BadRequestException('Carrier bắt buộc khi SHIPPED');
        if (!dto.containerNo) throw new BadRequestException('Số container bắt buộc khi SHIPPED');
        await em.query(
          `UPDATE po_header SET status = 'SHIPPED', updated_at = NOW() WHERE id = $1`,
          [poId],
        );
        await em.query(
          `UPDATE po_tracking SET
             vehicle_no = $1, carrier_code = $2, container_no = $3,
             nm_ship_date = $4, updated_by = $5, updated_at = NOW()
           WHERE po_header_id = $6`,
          [dto.vehicleNo, dto.carrierCode, dto.containerNo, dto.shipDate ?? null, dto.changedBy ?? 'SYSTEM', poId],
        );
      }

      if (dto.toStatus === 'RECEIVED') {
        // R10: actual_received_qty + note if incomplete
        const lineRows: Array<{ confirmed_qty: number }> = await em.query(
          `SELECT SUM(confirmed_qty)::float AS confirmed_qty FROM po_line WHERE po_header_id = $1 AND status = 'ACTIVE'`,
          [poId],
        );
        const totalConfirmed = Number(lineRows[0]?.confirmed_qty ?? 0);
        const actualQty = dto.actualReceivedQty ?? totalConfirmed;
        const incomplete = actualQty < totalConfirmed;
        if (incomplete && !dto.note) {
          throw new BadRequestException('Ghi chú bắt buộc khi thực nhận < xác nhận (R10)');
        }
        await em.query(
          `UPDATE po_header SET status = 'RECEIVED', updated_at = NOW() WHERE id = $1`,
          [poId],
        );
        await em.query(
          `UPDATE po_tracking SET
             cn_received_date = $1,
             lt_actual_days = EXTRACT(DAY FROM ($1::date - nm_ship_date))::int,
             updated_by = $2, updated_at = NOW()
           WHERE po_header_id = $3`,
          [dto.receiveDate ?? new Date().toISOString().slice(0, 10), dto.changedBy ?? 'SYSTEM', poId],
        );
        if (incomplete) {
          await em.query(
            `UPDATE po_line SET delivery_incomplete = TRUE, delivery_note = $1, updated_at = NOW()
             WHERE po_header_id = $2 AND status = 'ACTIVE'`,
            [dto.note, poId],
          );
        }
      }

      if (dto.toStatus === 'CLOSED') {
        await em.query(
          `UPDATE po_header SET status = 'CLOSED', updated_at = NOW() WHERE id = $1`,
          [poId],
        );
      }

      if (dto.toStatus === 'CANCELLED') {
        if (po.status === 'SHIPPED' || po.status === 'RECEIVED' || po.status === 'CLOSED') {
          throw new BadRequestException(`Không thể cancel PO ở trạng thái ${po.status} (đã trên đường)`);
        }
        if (!dto.cancelReason || dto.cancelReason.length < 20) {
          throw new BadRequestException('cancelReason phải ≥ 20 ký tự (R11)');
        }
        await em.query(
          `UPDATE po_header
           SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = $1,
               cancel_reason = $2, updated_at = NOW()
           WHERE id = $3`,
          [dto.changedBy ?? 'SYSTEM', dto.cancelReason, poId],
        );
        // R11 + H3: rollback reservation line-level
        await this._rollbackReservation(em, poId);
        await em.query(
          `INSERT INTO po_edit_log (po_header_id, field_changed, old_value, new_value, reason, changed_by)
           VALUES ($1, 'status', $2, 'CANCELLED', $3, $4)`,
          [poId, po.status, dto.cancelReason, dto.changedBy ?? 'SYSTEM'],
        );
      }
    });

    return { id: poId, status: dto.toStatus };
  }

  async transitionTo(toId: string, dto: TransitionPoDto): Promise<{ id: string; status: string }> {
    const rows: Array<{ id: string; status: string }> = await this.dataSource.query(
      `SELECT id::text, status FROM to_header WHERE id = $1`,
      [toId],
    );
    if (rows.length === 0) throw new NotFoundException(`TO #${toId} not found`);
    const to = rows[0];
    const allowed = TO_TRANSITION_MATRIX[to.status] ?? [];
    if (!allowed.includes(dto.toStatus)) {
      throw new InvalidTransitionException(to.status, dto.toStatus, 'TO');
    }

    await this.dataSource.transaction(async (em) => {
      if (dto.toStatus === 'CONFIRMED') {
        if (dto.idempotencyKey) {
          const idem = await em.query(
            `SELECT result_json FROM idempotency_log WHERE key = $1 AND expires_at > NOW()`,
            [dto.idempotencyKey],
          );
          if (idem.length > 0) return idem[0].result_json;
        }
        await em.query(
          `UPDATE to_header SET status = 'CONFIRMED', confirmed_at = NOW(), confirmed_by = $1, updated_at = NOW()
           WHERE id = $2`,
          [dto.changedBy ?? 'SYSTEM', toId],
        );
        if (dto.idempotencyKey) {
          await em.query(
            `INSERT INTO idempotency_log (key, endpoint, result_json, status_code)
             VALUES ($1, '/po-review/to/:id/confirm', $2, 200)
             ON CONFLICT (key) DO NOTHING`,
            [dto.idempotencyKey, JSON.stringify({ id: toId, status: 'CONFIRMED' })],
          );
        }
      }

      if (dto.toStatus === 'SHIPPED') {
        if (!dto.vehicleNo) throw new BadRequestException('vehicle_no bắt buộc khi SHIPPED');
        if (!dto.carrierCode) throw new BadRequestException('carrier_code bắt buộc khi SHIPPED');
        if (!dto.containerNo) throw new BadRequestException('container_no bắt buộc khi SHIPPED');
        await em.query(`UPDATE to_header SET status = 'SHIPPED', updated_at = NOW() WHERE id = $1`, [toId]);
        await em.query(
          `UPDATE to_tracking SET
             vehicle_no = $1, carrier_code = $2, container_no = $3,
             donor_ship_date = $4, updated_by = $5, updated_at = NOW()
           WHERE to_header_id = $6`,
          [dto.vehicleNo, dto.carrierCode, dto.containerNo, dto.shipDate ?? null, dto.changedBy ?? 'SYSTEM', toId],
        );
      }

      if (dto.toStatus === 'RECEIVED') {
        await em.query(`UPDATE to_header SET status = 'RECEIVED', updated_at = NOW() WHERE id = $1`, [toId]);
        await em.query(
          `UPDATE to_tracking SET
             receiver_recv_date = $1,
             lt_actual_days = EXTRACT(DAY FROM ($1::date - donor_ship_date))::int,
             updated_by = $2, updated_at = NOW()
           WHERE to_header_id = $3`,
          [dto.receiveDate ?? new Date().toISOString().slice(0, 10), dto.changedBy ?? 'SYSTEM', toId],
        );
      }

      if (dto.toStatus === 'CLOSED') {
        await em.query(`UPDATE to_header SET status = 'CLOSED', updated_at = NOW() WHERE id = $1`, [toId]);
      }

      if (dto.toStatus === 'CANCELLED') {
        if (!dto.cancelReason || dto.cancelReason.length < 20) {
          throw new BadRequestException('cancelReason phải ≥ 20 ký tự (R11)');
        }
        await em.query(
          `UPDATE to_header SET status = 'CANCELLED', cancelled_at = NOW(), cancelled_by = $1, cancel_reason = $2, updated_at = NOW()
           WHERE id = $3`,
          [dto.changedBy ?? 'SYSTEM', dto.cancelReason, toId],
        );
        await em.query(
          `INSERT INTO to_edit_log (to_header_id, field_changed, old_value, new_value, reason, changed_by)
           VALUES ($1, 'status', $2, 'CANCELLED', $3, $4)`,
          [toId, to.status, dto.cancelReason, dto.changedBy ?? 'SYSTEM'],
        );
      }
    });

    return { id: toId, status: dto.toStatus };
  }

  // R11 + H3: CANCEL rollback reservation — LINE-LEVEL per (location_code × item_code)
  private async _rollbackReservation(em: EntityManager, poId: string): Promise<void> {
    const lines: Array<{
      source_allocation_leg_id: string | null;
      sku_id: string;
      confirmed_qty: number;
    }> = await em.query(
      `SELECT source_allocation_leg_id::text, sku_id::text, confirmed_qty::float
       FROM po_line WHERE po_header_id = $1 AND status = 'ACTIVE'`,
      [poId],
    );

    for (const line of lines) {
      if (!line.source_allocation_leg_id) continue;

      // Resolve source location_code from allocation_leg source_entity_id
      const legRows: Array<{ source_entity_id: string; source_type: string }> = await em.query(
        `SELECT source_entity_id::text, source_type FROM allocation_leg WHERE id = $1`,
        [line.source_allocation_leg_id],
      );
      if (legRows.length === 0) continue;
      const leg = legRows[0];

      // Resolve item_code from sku
      const skuRows: Array<{ sku_code: string }> = await em.query(
        `SELECT sku_code FROM sku WHERE id = $1`, [line.sku_id],
      );
      if (skuRows.length === 0) continue;
      const itemCode = skuRows[0].sku_code;

      // H5 fix: HUB source has no supply_snapshot (virtual hub, no NM supplier) — skip rollback.
      // Only NM/TOP_UP_NEXT_WEEK source legs have supply_snapshot rows to roll back.
      let locationCode: string | null = null;
      if (leg.source_type === 'HUB') {
        continue; // No snapshot for virtual hub — reservation lives in hub pool, not supply_snapshot
      } else if (leg.source_type === 'NM' || leg.source_type === 'TOP_UP_NEXT_WEEK') {
        const nmRows: Array<{ supplier_code: string }> = await em.query(
          `SELECT supplier_code FROM supplier WHERE id = $1`, [leg.source_entity_id],
        );
        locationCode = nmRows[0]?.supplier_code ?? null;
      }
      if (!locationCode) continue;

      // Line-level reservation rollback (M25 C1 v1.2 grain)
      await em.query(
        `UPDATE supply_snapshot_line
         SET reserved_for_transport = GREATEST(0, reserved_for_transport - $1)
         WHERE item_code = $2
           AND snapshot_id = (
             SELECT ssl_inner.snapshot_id
             FROM supply_snapshot_line ssl_inner
             JOIN supply_snapshot ss ON ss.id = ssl_inner.snapshot_id
             WHERE ssl_inner.item_code = $2
               AND ss.nm_code = $3
             ORDER BY COALESCE(ss.synced_at, ss.captured_at) DESC LIMIT 1
           )`,
        [line.confirmed_qty, itemCode, locationCode],
      );
    }
  }
}
