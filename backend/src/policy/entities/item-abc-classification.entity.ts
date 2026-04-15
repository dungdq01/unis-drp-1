import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('item_abc_classification')
export class ItemAbcClassification {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'abc_class', type: 'char', length: 1 })
  abcClass: 'A' | 'B' | 'C';

  @Column({ length: 30, default: 'FORECAST_TEAM' })
  source: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @Column({ name: 'annual_volume', type: 'decimal', precision: 18, scale: 2, nullable: true })
  annualVolume: number | null;

  @Column({ name: 'internal_class', type: 'char', length: 1, nullable: true })
  internalClass: 'A' | 'B' | 'C' | null;

  @Column({ name: 'discrepancy_flag', default: false })
  discrepancyFlag: boolean;

  @Column({ name: 'effective_date', type: 'date' })
  effectiveDate: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
