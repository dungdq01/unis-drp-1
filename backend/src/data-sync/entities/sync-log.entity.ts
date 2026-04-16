import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type TriggerSource = 'CRON_06' | 'CRON_14' | 'MANUAL';
export type SyncStatus = 'SUCCESS' | 'FAILED' | 'PARTIAL';

@Entity('sync_log')
export class SyncLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'nm_code', type: 'varchar', length: 30 })
  nmCode: string;

  @Column({ name: 'trigger_source', type: 'varchar', length: 20 })
  triggerSource: TriggerSource;

  /** NULL for CRON runs, userId for MANUAL */
  @Column({ name: 'triggered_by_user', type: 'varchar', length: 100, nullable: true, default: null })
  triggeredByUser: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: SyncStatus;

  @Column({ name: 'rows_imported', type: 'int', default: 0 })
  rowsImported: number;

  @Column({ name: 'error_msg', type: 'text', nullable: true, default: null })
  errorMsg: string | null;

  @CreateDateColumn({ name: 'started_at' })
  startedAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true, default: null })
  completedAt: Date | null;
}
