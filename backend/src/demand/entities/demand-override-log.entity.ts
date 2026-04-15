import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Maps to 002_demand.sql demand_override_log table.
 * BE-2 fix: PK name = override_id (not log_id)
 * BE-3 fix: overriddenBy = NOT NULL (matches DDL)
 */
@Entity('demand_override_log')
export class DemandOverrideLog {
  @PrimaryGeneratedColumn('uuid', { name: 'override_id' })
  id: string;

  @Column({ name: 'snapshot_id' })
  snapshotId: string;

  @Column({ name: 'line_id' })
  lineId: string;

  @Column({ name: 'item_code' })
  itemCode: string;

  @Column({ name: 'location_code' })
  locationCode: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: Date;

  @Column({ name: 'old_qty', type: 'decimal', precision: 15, scale: 2 })
  oldQty: number;

  @Column({ name: 'new_qty', type: 'decimal', precision: 15, scale: 2 })
  newQty: number;

  @Column({ type: 'text' })
  reason: string;

  @Column({ name: 'overridden_by' })
  overriddenBy: string;  // NOT NULL — DDL requires this

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
