import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { DemandSnapshotLine } from './demand-snapshot-line.entity';

@Entity('demand_snapshot')
export class DemandSnapshot {
  @PrimaryGeneratedColumn('uuid', { name: 'snapshot_id' })
  id: string;

  @Column({ name: 'run_id', nullable: true })
  runId?: string;

  // G5: metadata columns
  @Column({ name: 'snapshot_name', nullable: true })
  snapshotName?: string;

  @Column({ name: 'source_type', default: 'CSV_UPLOAD' })
  sourceType: string;

  @Column({ name: 'forecast_file_name', nullable: true })
  forecastFileName?: string;

  @Column({ name: 'horizon_start', type: 'date', nullable: true })
  horizonStart?: Date;

  @Column({ name: 'horizon_end', type: 'date', nullable: true })
  horizonEnd?: Date;

  @Column({ name: 'created_by', nullable: true })
  createdBy?: string;

  @Column({ default: 'DRAFT' })
  status: string; // DRAFT | FROZEN | ARCHIVED (G8)

  @Column({ name: 'demand_basis', default: 'MAX_FORECAST_PO' })
  demandBasis: string;

  @Column({ name: 'total_lines', default: 0 })
  totalLines: number;

  @Column({ name: 'total_items', default: 0 })
  totalItems: number;

  @Column({ name: 'total_locations', default: 0 })
  totalLocations: number;

  @Column({ name: 'frozen_at', type: 'timestamptz', nullable: true })
  frozenAt?: Date;

  @Column({ name: 'frozen_by', nullable: true })
  frozenBy?: string;

  @Column({ nullable: true })
  notes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => DemandSnapshotLine, line => line.snapshot)
  lines: DemandSnapshotLine[];
}
