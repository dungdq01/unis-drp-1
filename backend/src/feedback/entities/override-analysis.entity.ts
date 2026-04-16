import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export interface OverrideReasonEntry {
  reason: string;
  count: number;
  pct: number;
}

@Entity('override_analysis')
export class OverrideAnalysis {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'weekly_snapshot_id', type: 'bigint' })
  weeklySnapshotId: string;

  @Column({ name: 'week_start_date', type: 'date' })
  weekStartDate: string;

  @Column({ name: 'top_reasons', type: 'jsonb', default: '[]' })
  topReasons: OverrideReasonEntry[];

  @Column({ name: 'total_edits', default: 0 })
  totalEdits: number;

  @Column({ name: 'total_pos', default: 0 })
  totalPos: number;

  @Column({ name: 'total_tos', default: 0 })
  totalTos: number;

  @Column({ name: 'system_accuracy_pct', type: 'decimal', precision: 7, scale: 4, nullable: true })
  systemAccuracyPct: number | null;

  @Column({ name: 'field_breakdown', type: 'jsonb', nullable: true })
  fieldBreakdown: Record<string, number> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
