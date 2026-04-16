import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NmAtpService } from '../nm-atp/nm-atp.service';
import { atpCellKey } from '../common/atp-utils';

export interface EditLineDto {
  confirmedQty?: number;
  variantCode?: string;
  reason: string;          // mandatory R7
  changedBy?: string;
}

export interface AddLineDto {
  skuId: string;
  qty: number;
  variantCode?: string;
  reason: string;
  changedBy?: string;
}

/**
 * M27 Edit service — R7 + R8 validation + mandatory audit log.
 *
 * R7: Mọi edit trước CONFIRMED ghi po_edit_log với mandatory reason.
 * R8: qty edit > ATP → warning (flag qty_exceeds_atp=TRUE, không block);
 *     SKU không thuộc NM → reject;
 *     qty=0 → soft delete (status CANCELLED).
 */
@Injectable()
export class PoEditService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly atpSvc: NmAtpService,
  ) {}

  async editLine(poId: string, lineId: string, dto: EditLineDto): Promise<{ lineId: string; warning?: string }> {
    // R7: only editable before CONFIRMED
    const poRows: Array<{ status: string; nm_id: string; po_run_id: string }> = await this.dataSource.query(
      `SELECT status, nm_id::text, po_run_id::text FROM po_header WHERE id = $1`,
      [poId],
    );
    if (poRows.length === 0) throw new NotFoundException(`PO #${poId} not found`);
    const po = poRows[0];
    if (po.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot edit PO in status ${po.status}. Edit only allowed in DRAFT.`);
    }

    const lineRows: Array<{
      id: string; sku_id: string; confirmed_qty: number; variant_code: string | null;
    }> = await this.dataSource.query(
      `SELECT id::text, sku_id::text, confirmed_qty::float, variant_code
       FROM po_line WHERE id = $1 AND po_header_id = $2`,
      [lineId, poId],
    );
    if (lineRows.length === 0) throw new NotFoundException(`PO line #${lineId} not found`);
    const line = lineRows[0];

    // R7: mandatory reason
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('reason is mandatory for every edit (R7)');
    }

    let warning: string | undefined;
    let qtyExceedsAtp = false;

    if (dto.confirmedQty !== undefined) {
      if (dto.confirmedQty === 0) {
        // Soft delete (qty=0)
        await this.dataSource.query(
          `UPDATE po_line SET status = 'CANCELLED', confirmed_qty = 0, updated_at = NOW() WHERE id = $1`,
          [lineId],
        );
        await this._logEdit(poId, lineId, 'qty', String(line.confirmed_qty), '0', dto.reason, dto.changedBy ?? 'SYSTEM');
        return { lineId };
      }

      // R8: validate ATP
      const allocationRunId = await this._getAllocationRunId(po.po_run_id);
      if (allocationRunId) {
        try {
          const atpResult = await this.atpSvc.getAtpResult(allocationRunId);
          // Find ATP check for this NM × SKU (best match across periods)
          let atpQty: number | null = null;
          for (const [key, check] of atpResult.checks) {
            if (key.startsWith(`${po.nm_id}|${line.sku_id}|`)) {
              atpQty = check.atpQty;
              break;
            }
          }
          if (atpQty !== null && dto.confirmedQty > atpQty) {
            qtyExceedsAtp = true;
            warning = `Qty ${dto.confirmedQty} > ATP ${atpQty} for NM#${po.nm_id} SKU#${line.sku_id}. Saved with qty_exceeds_atp=TRUE flag.`;
          }
        } catch {
          // ATP not available — allow edit with warning
          warning = 'ATP data unavailable for validation. Qty saved with Planner responsibility.';
          qtyExceedsAtp = true;
        }
      }

      await this.dataSource.query(
        `UPDATE po_line
         SET confirmed_qty = $1, qty_exceeds_atp = $2, updated_at = NOW()
         WHERE id = $3`,
        [dto.confirmedQty, qtyExceedsAtp, lineId],
      );
      await this._logEdit(poId, lineId, 'qty', String(line.confirmed_qty), String(dto.confirmedQty), dto.reason, dto.changedBy ?? 'SYSTEM');
    }

    if (dto.variantCode !== undefined) {
      await this.dataSource.query(
        `UPDATE po_line SET variant_code = $1, updated_at = NOW() WHERE id = $2`,
        [dto.variantCode, lineId],
      );
      await this._logEdit(poId, lineId, 'variant', line.variant_code ?? '', dto.variantCode, dto.reason, dto.changedBy ?? 'SYSTEM');
    }

    return { lineId, ...(warning ? { warning } : {}) };
  }

  async addLine(poId: string, dto: AddLineDto): Promise<{ lineId: string; warning?: string }> {
    const poRows: Array<{ status: string; nm_id: string; po_run_id: string }> = await this.dataSource.query(
      `SELECT status, nm_id::text, po_run_id::text FROM po_header WHERE id = $1`,
      [poId],
    );
    if (poRows.length === 0) throw new NotFoundException(`PO #${poId} not found`);
    const po = poRows[0];
    if (po.status !== 'DRAFT') throw new BadRequestException(`Cannot add line to PO in status ${po.status}`);

    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException('reason is mandatory (R7)');
    }

    // R8: SKU must belong to NM (M00 sku_nm_mapping)
    const mappingRows: Array<{ nm_id: string }> = await this.dataSource.query(
      `SELECT nm_id::text FROM sku_nm_mapping WHERE sku_id = $1 AND nm_id = $2 AND active = TRUE`,
      [dto.skuId, po.nm_id],
    );
    if (mappingRows.length === 0) {
      throw new BadRequestException(`SKU #${dto.skuId} không thuộc NM #${po.nm_id} (sku_nm_mapping check — R8)`);
    }

    let warning: string | undefined;
    let qtyExceedsAtp = false;
    const allocationRunId = await this._getAllocationRunId(po.po_run_id);
    if (allocationRunId) {
      try {
        const atpResult = await this.atpSvc.getAtpResult(allocationRunId);
        let atpQty: number | null = null;
        for (const [key, check] of atpResult.checks) {
          if (key.startsWith(`${po.nm_id}|${dto.skuId}|`)) { atpQty = check.atpQty; break; }
        }
        if (atpQty !== null && dto.qty > atpQty) {
          qtyExceedsAtp = true;
          warning = `Qty ${dto.qty} > ATP ${atpQty}. Saved with qty_exceeds_atp=TRUE flag.`;
        }
      } catch {
        warning = 'ATP not available. Planner responsibility for qty.';
        qtyExceedsAtp = true;
      }
    }

    const insertRows: Array<{ id: string }> = await this.dataSource.query(
      `INSERT INTO po_line (po_header_id, sku_id, variant_code, requested_qty, confirmed_qty, qty_exceeds_atp)
       VALUES ($1, $2, $3, $4, $4, $5)
       RETURNING id::text`,
      [poId, dto.skuId, dto.variantCode ?? null, dto.qty, qtyExceedsAtp],
    );
    const lineId = insertRows[0].id;
    await this._logEdit(poId, lineId, 'sku_added', '', JSON.stringify({ skuId: dto.skuId, qty: dto.qty }), dto.reason, dto.changedBy ?? 'SYSTEM');

    return { lineId, ...(warning ? { warning } : {}) };
  }

  async deleteLine(poId: string, lineId: string, reason: string, changedBy = 'SYSTEM'): Promise<void> {
    const poRows: Array<{ status: string }> = await this.dataSource.query(
      `SELECT status FROM po_header WHERE id = $1`,
      [poId],
    );
    if (poRows.length === 0) throw new NotFoundException(`PO #${poId} not found`);
    if (poRows[0].status !== 'DRAFT') throw new BadRequestException(`Cannot delete line from PO in status ${poRows[0].status}`);
    if (!reason || reason.trim().length === 0) throw new BadRequestException('reason mandatory (R7)');

    await this.dataSource.query(
      `UPDATE po_line SET status = 'CANCELLED', confirmed_qty = 0, updated_at = NOW() WHERE id = $1`,
      [lineId],
    );
    await this._logEdit(poId, lineId, 'sku_removed', '', '', reason, changedBy);
  }

  private async _logEdit(
    poId: string, lineId: string | null, field: string,
    oldVal: string, newVal: string, reason: string, changedBy: string,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO po_edit_log (po_header_id, po_line_id, field_changed, old_value, new_value, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [poId, lineId, field, oldVal, newVal, reason, changedBy],
    );
  }

  private async _getAllocationRunId(poRunId: string): Promise<string | null> {
    const rows: Array<{ allocation_run_id: string }> = await this.dataSource.query(
      `SELECT allocation_run_id::text FROM po_run WHERE id = $1`, [poRunId],
    );
    return rows[0]?.allocation_run_id ?? null;
  }
}
