import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('allocation_run')
export class AllocationRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @Column({ type: 'varchar', length: 20, default: 'RUNNING' })
  status: 'RUNNING' | 'QUEUED' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'BLOCKED_M23_NOT_READY';

  // ── M24 extensions ───────────────────────────────────────────────────────

  /** Rule 14: reuses M23 plan_run's policy_run_id — no new snapshot. */
  @Column({ name: 'policy_run_id', type: 'bigint', nullable: true, default: null })
  policyRunId: string | null;

  /** Snapshot of lcnb.enabled from policy_run at run time. */
  @Column({ name: 'lcnb_enabled', type: 'boolean', default: false })
  lcnbEnabled: boolean;

  @Column({ name: 'total_legs_count', type: 'int', default: 0 })
  totalLegsCount: number;

  @Column({ name: 'lcnb_transfers_count', type: 'int', default: 0 })
  lcnbTransfersCount: number;

  @Column({ name: 'partial_stockout_count', type: 'int', default: 0 })
  partialStockoutCount: number;

  @Column({ name: 'is_force_rerun', type: 'boolean', default: false })
  isForceRerun: boolean;

  @Column({ name: 'force_rerun_reason', type: 'text', nullable: true, default: null })
  forceRerunReason: string | null;

  @Column({ name: 'total_demand_lines', type: 'int', default: 0 })
  totalDemandLines: number;

  @Column({ name: 'total_allocated', type: 'int', default: 0 })
  totalAllocated: number;

  @Column({ name: 'total_partial', type: 'int', default: 0 })
  totalPartial: number;

  @Column({ name: 'total_unallocated', type: 'int', default: 0 })
  totalUnallocated: number;

  @Column({ name: 'fill_rate_overall', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateOverall: number | null;

  @Column({ name: 'fill_rate_a', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateA: number | null;

  @Column({ name: 'fill_rate_b', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateB: number | null;

  @Column({ name: 'fill_rate_c', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRateC: number | null;

  @Column({ name: 'config_snapshot', type: 'jsonb', nullable: true, default: null })
  configSnapshot: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true, default: null })
  errorMessage: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true, default: null })
  durationMs: number | null;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true, default: null })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true, default: null })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
