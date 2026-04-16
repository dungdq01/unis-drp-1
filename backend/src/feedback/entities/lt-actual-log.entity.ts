import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('lt_actual_log')
export class LtActualLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'weekly_snapshot_id', type: 'bigint' })
  weeklySnapshotId: string;

  @Column({ name: 'entity_type', length: 20 })
  entityType: 'SUPPLIER' | 'TRANSPORT_LANE';

  @Column({ name: 'entity_id', type: 'bigint', nullable: true })
  entityId: string | null;

  @Column({ name: 'entity_code', type: 'varchar', length: 100, nullable: true })
  entityCode: string | null;

  @Column({ name: 'route_label', type: 'varchar', length: 100, nullable: true })
  routeLabel: string | null;

  @Column({ name: 'lt_old_days', type: 'decimal', precision: 5, scale: 2 })
  ltOldDays: number;

  @Column({ name: 'lt_actual_avg_days', type: 'decimal', precision: 5, scale: 2 })
  ltActualAvgDays: number;

  @Column({ name: 'lt_new_days', type: 'decimal', precision: 5, scale: 2, nullable: true })
  ltNewDays: number | null;

  @Column({ name: 'sample_size', default: 0 })
  sampleSize: number;

  @Column({ name: 'drift_pct', type: 'decimal', precision: 7, scale: 4 })
  driftPct: number;

  @Column({ name: 'action', length: 25 })
  action: 'APPLIED' | 'DRIFT_BLOCKED' | 'DRIFT_FORCE_APPLY';

  @Column({ name: 'drift_count_after', default: 0 })
  driftCountAfter: number;

  @CreateDateColumn({ name: 'calculated_at' })
  calculatedAt: Date;
}
