import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('plan_run')
export class PlanRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'demand_snapshot_id', type: 'uuid' })
  demandSnapshotId: string;

  @Column({ name: 'supply_snapshot_id', type: 'bigint' })
  supplySnapshotId: string;

  @Column({ type: 'varchar', length: 20, default: 'RUNNING' })
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';

  @Column({ name: 'planned_orders_count', type: 'int', default: 0 })
  plannedOrdersCount: number;

  @Column({ name: 'exceptions_count', type: 'int', default: 0 })
  exceptionsCount: number;

  @Column({ name: 'combinations_processed', type: 'int', default: 0 })
  combinationsProcessed: number;

  @Column({ name: 'duration_ms', type: 'int', nullable: true, default: null })
  durationMs: number | null;

  @Column({ name: 'config_json', type: 'jsonb', nullable: true, default: null })
  configJson: Record<string, unknown> | null;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true, default: null })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true, default: null })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
