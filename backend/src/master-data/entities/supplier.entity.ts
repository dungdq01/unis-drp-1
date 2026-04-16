import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to existing `supplier` table (M1-M10 schema).
 * PK = supplier_code VARCHAR (deviation from M00 spec BIGSERIAL).
 * DA1 to plan BIGSERIAL migration Sprint 2.
 * Actual columns: supplier_code, supplier_name, lead_time_days (int),
 *   region, factory_code, status, created_at, lt_drift_count, lt_drift_last_at
 */
@Entity('supplier')
export class Supplier {
  @PrimaryColumn({ name: 'supplier_code', type: 'varchar', length: 30 })
  supplierCode: string;

  @Column({ name: 'supplier_name', type: 'varchar', length: 200 })
  supplierName: string;

  @Column({ name: 'lead_time_days', type: 'int', nullable: true, default: null })
  leadTimeDays: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  region: string | null;

  @Column({ name: 'factory_code', type: 'varchar', length: 50, nullable: true, default: null })
  factoryCode: string | null;

  // status='ACTIVE'/'INACTIVE' — existing M1-M10 pattern
  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: string;

  @Column({ name: 'lt_drift_count', type: 'int', default: 0 })
  ltDriftCount: number;

  @Column({ name: 'lt_drift_last_at', type: 'timestamp', nullable: true, default: null })
  ltDriftLastAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
