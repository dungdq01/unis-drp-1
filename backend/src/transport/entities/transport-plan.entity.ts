import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('transport_plan')
export class TransportPlan {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /** M25: nullable to allow standalone plans during migration; unique enforced by partial index. */
  @Column({ name: 'allocation_run_id', type: 'bigint', nullable: true })
  allocationRunId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_PARTIAL' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';

  // ── M25 extensions ───────────────────────────────────────────────────────

  @Column({ name: 'policy_run_id', type: 'bigint', nullable: true, default: null })
  policyRunId: string | null;

  @Column({ name: 'is_force_rerun', type: 'boolean', default: false })
  isForceRerun: boolean;

  @Column({ name: 'force_rerun_reason', type: 'text', nullable: true, default: null })
  forceRerunReason: string | null;

  @Column({ name: 'held_trips', type: 'int', default: 0 })
  heldTrips: number;

  @Column({ name: 'multi_drop_trips', type: 'int', default: 0 })
  multiDropTrips: number;

  @Column({ name: 'avg_fill_ratio', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  avgFillRatio: number | null;

  @Column({ name: 'total_trips', type: 'int', default: 0 })
  totalTrips: number;

  @Column({ name: 'total_weight_kg', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalWeightKg: number;

  @Column({ name: 'total_cost_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalCostVnd: number;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @Column({ name: 'confirmed_by', type: 'varchar', length: 100, nullable: true, default: null })
  confirmedBy: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamp', nullable: true, default: null })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
