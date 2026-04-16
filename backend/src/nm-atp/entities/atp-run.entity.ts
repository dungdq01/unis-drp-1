import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('atp_run')
export class AtpRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint' })
  allocationRunId: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @Column({ name: 'policy_run_id', type: 'bigint', nullable: true })
  policyRunId: string | null;

  @Column({ length: 20, default: 'RUNNING' })
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';

  @Column({ name: 'total_cells', default: 0 })
  totalCells: number;

  @Column({ name: 'pass_count', default: 0 })
  passCount: number;

  @Column({ name: 'partial_count', default: 0 })
  partialCount: number;

  @Column({ name: 'fail_count', default: 0 })
  failCount: number;

  @Column({ name: 'blocked_count', default: 0 })
  blockedCount: number;

  @Column({ name: 'critical_count', default: 0 })
  criticalCount: number;

  @Column({ name: 'is_force_rerun', default: false })
  isForceRerun: boolean;

  @Column({ name: 'force_rerun_reason', type: 'text', nullable: true })
  forceRerunReason: string | null;

  @Column({ name: 'created_by', length: 100, default: 'SYSTEM_NIGHTLY' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;
}
