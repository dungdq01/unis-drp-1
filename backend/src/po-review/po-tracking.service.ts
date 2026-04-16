import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface UpdatePoTrackingDto {
  vehicleNo?: string;
  carrierCode?: string;
  containerNo?: string;
  driverName?: string;
  driverPhone?: string;
  nmShipDate?: string;
  actualEtaDate?: string;
  updatedBy?: string;
}

export interface UpdateToTrackingDto {
  vehicleNo?: string;
  carrierCode?: string;
  containerNo?: string;
  donorShipDate?: string;
  actualEtaDate?: string;
  updatedBy?: string;
}

/**
 * M27 H2 fix: standalone tracking update service.
 * Allows Planner to update vehicle/driver/ETA fields independently
 * after SHIPPED without re-transitioning.
 */
@Injectable()
export class PoTrackingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async updatePoTracking(poId: string, dto: UpdatePoTrackingDto): Promise<{ poId: string }> {
    const exists: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id::text FROM po_header WHERE id = $1`, [poId],
    );
    if (exists.length === 0) throw new NotFoundException(`PO #${poId} not found`);

    const sets: string[] = [];
    const params: unknown[] = [];

    if (dto.vehicleNo    !== undefined) { params.push(dto.vehicleNo);    sets.push(`vehicle_no = $${params.length}`); }
    if (dto.carrierCode  !== undefined) { params.push(dto.carrierCode);  sets.push(`carrier_code = $${params.length}`); }
    if (dto.containerNo  !== undefined) { params.push(dto.containerNo);  sets.push(`container_no = $${params.length}`); }
    if (dto.driverName   !== undefined) { params.push(dto.driverName);   sets.push(`driver_name = $${params.length}`); }
    if (dto.driverPhone  !== undefined) { params.push(dto.driverPhone);  sets.push(`driver_phone = $${params.length}`); }
    if (dto.nmShipDate   !== undefined) { params.push(dto.nmShipDate);   sets.push(`nm_ship_date = $${params.length}`); }
    if (dto.actualEtaDate !== undefined) { params.push(dto.actualEtaDate); sets.push(`actual_eta_date = $${params.length}`); }

    if (sets.length === 0) return { poId };

    params.push(dto.updatedBy ?? 'SYSTEM');
    sets.push(`updated_by = $${params.length}`);
    sets.push(`updated_at = NOW()`);

    params.push(poId);
    await this.dataSource.query(
      `UPDATE po_tracking SET ${sets.join(', ')} WHERE po_header_id = $${params.length}`,
      params,
    );
    return { poId };
  }

  async getPoTracking(poId: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM po_tracking WHERE po_header_id = $1`, [poId],
    );
    if (rows.length === 0) throw new NotFoundException(`Tracking for PO #${poId} not found`);
    return rows[0];
  }

  async updateToTracking(toId: string, dto: UpdateToTrackingDto): Promise<{ toId: string }> {
    const exists: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id::text FROM to_header WHERE id = $1`, [toId],
    );
    if (exists.length === 0) throw new NotFoundException(`TO #${toId} not found`);

    const sets: string[] = [];
    const params: unknown[] = [];

    if (dto.vehicleNo     !== undefined) { params.push(dto.vehicleNo);     sets.push(`vehicle_no = $${params.length}`); }
    if (dto.carrierCode   !== undefined) { params.push(dto.carrierCode);   sets.push(`carrier_code = $${params.length}`); }
    if (dto.containerNo   !== undefined) { params.push(dto.containerNo);   sets.push(`container_no = $${params.length}`); }
    if (dto.donorShipDate !== undefined) { params.push(dto.donorShipDate); sets.push(`donor_ship_date = $${params.length}`); }
    if (dto.actualEtaDate !== undefined) { params.push(dto.actualEtaDate); sets.push(`actual_eta_date = $${params.length}`); }

    if (sets.length === 0) return { toId };

    params.push(dto.updatedBy ?? 'SYSTEM');
    sets.push(`updated_by = $${params.length}`);
    sets.push(`updated_at = NOW()`);

    params.push(toId);
    await this.dataSource.query(
      `UPDATE to_tracking SET ${sets.join(', ')} WHERE to_header_id = $${params.length}`,
      params,
    );
    return { toId };
  }

  async getToTracking(toId: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM to_tracking WHERE to_header_id = $1`, [toId],
    );
    if (rows.length === 0) throw new NotFoundException(`Tracking for TO #${toId} not found`);
    return rows[0];
  }
}
