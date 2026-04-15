import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DemandSnapshot } from './demand-snapshot.entity';

@Entity('demand_snapshot_line')
export class DemandSnapshotLine {
  @PrimaryGeneratedColumn('uuid', { name: 'line_id' })
  id: string;

  @Column({ name: 'snapshot_id' })
  snapshotId: string;

  @Column({ name: 'item_code' })
  itemCode: string;

  @Column({ name: 'location_code' })
  locationCode: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  qty: number;

  @Column({ name: 'reconciled_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
  reconciledQty?: number;

  @Column({ name: 'demand_type', default: 'FORECAST' })
  demandType: string;

  @Column({ nullable: true, length: 1 })
  segment?: string;

  @Column({ default: 0 })
  priority: number;

  @Column({ name: 'combo_class', nullable: true })
  comboClass?: string;

  @Column({ name: 'branch_archetype', nullable: true })
  branchArchetype?: string;

  @Column({ name: 'tet_flag', nullable: true, length: 1 })
  tetFlag?: string;

  @Column({ name: 'confidence_lower', type: 'decimal', precision: 15, scale: 2, nullable: true })
  confidenceLower?: number;

  @Column({ name: 'confidence_upper', type: 'decimal', precision: 15, scale: 2, nullable: true })
  confidenceUpper?: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => DemandSnapshot, snapshot => snapshot.lines)
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: DemandSnapshot;
}
