import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('plan_run')
export class PlanRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  /** Nullable per M23 V004 — BLOCKED_STALE rows may not reference a snapshot. */
  @Column({ name: 'demand_snapshot_id', type: 'uuid', nullable: true })
  demandSnapshotId: string | null;

  @Column({ name: 'supply_snapshot_id', type: 'bigint', nullable: true })
  supplySnapshotId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'RUNNING' })
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT' | 'BLOCKED_STALE' | 'FORCE_OVERRIDDEN';

  // ── M23 extensions ───────────────────────────────────────────────────────

  /** Rule 14: policy_run snapshot FK — all downstream reads config from here. */
  @Column({ name: 'policy_run_id', type: 'bigint', nullable: true, default: null })
  policyRunId: string | null;

  /** Stats: how many cells came from M22 vs FC raw. */
  @Column({ name: 'effective_demand_source', type: 'jsonb', nullable: true, default: null })
  effectiveDemandSource: { m22Count: number; fcRawCount: number; m22Unavailable: boolean } | null;

  /** SC Manager bypassed freshness gate (M21). */
  @Column({ name: 'is_stale_override', type: 'boolean', default: false })
  isStaleOverride: boolean;

  @Column({ name: 'stale_override_reason', type: 'text', nullable: true, default: null })
  staleOverrideReason: string | null;

  @Column({ name: 'stale_override_by', type: 'varchar', length: 100, nullable: true, default: null })
  staleOverrideBy: string | null;

  /** Date key for idempotent daily run check (R12). Format: YYYY-MM-DD. */
  @Column({ name: 'run_date', type: 'date', nullable: true, default: null })
  runDate: string | null;

  /** G13 [spec §13]: TRUE for manual force re-run (bypasses daily unique index). */
  @Column({ name: 'is_force_rerun', type: 'boolean', default: false })
  isForceRerun: boolean;

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
