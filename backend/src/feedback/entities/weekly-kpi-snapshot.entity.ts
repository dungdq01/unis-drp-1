import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('weekly_kpi_snapshot')
export class WeeklyKpiSnapshot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'week_start_date', type: 'date' })
  weekStartDate: string;

  @Column({ length: 20, default: 'RUNNING' })
  status: 'RUNNING' | 'COMPLETED' | 'COMPLETED_PARTIAL' | 'FAILED';

  @Column({ name: 'step_errors', type: 'jsonb', nullable: true })
  stepErrors: Array<{ step: string; error: string }> | null;

  @Column({ name: 'fc_mape_pct', type: 'decimal', precision: 7, scale: 4, nullable: true })
  fcMapePct: number | null;

  @Column({ name: 'fill_rate_pct', type: 'decimal', precision: 7, scale: 4, nullable: true })
  fillRatePct: number | null;

  @Column({ name: 'lcnb_util_pct', type: 'decimal', precision: 7, scale: 4, nullable: true })
  lcnbUtilPct: number | null;

  @Column({ name: 'transport_fill_avg', type: 'decimal', precision: 5, scale: 4, nullable: true })
  transportFillAvg: number | null;

  @Column({ name: 'system_accuracy_pct', type: 'decimal', precision: 7, scale: 4, nullable: true })
  systemAccuracyPct: number | null;

  @Column({ name: 'nm_honoring_avg_pct', type: 'decimal', precision: 7, scale: 4, nullable: true })
  nmHonoringAvgPct: number | null;

  @Column({ name: 'total_po_count', default: 0 })
  totalPoCount: number;

  @Column({ name: 'edited_po_count', default: 0 })
  editedPoCount: number;

  @Column({ name: 'total_to_count', default: 0 })
  totalToCount: number;

  @Column({ name: 'ss_adjustments_count', default: 0 })
  ssAdjustmentsCount: number;

  @Column({ name: 'lt_updates_count', default: 0 })
  ltUpdatesCount: number;

  @Column({ name: 'is_force_rerun', default: false })
  isForceRerun: boolean;

  @Column({ name: 'force_rerun_reason', type: 'text', nullable: true })
  forceRerunReason: string | null;

  @Column({ name: 'created_by', length: 100, default: 'CRON_WEEKLY' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
