import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('drp_override_log')
export class DrpOverrideLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'override_reason', type: 'text' })
  overrideReason: string;

  @Column({ name: 'approved_by', type: 'varchar', length: 100 })
  approvedBy: string;

  /** FK to plan_run — populated when M23 calls override */
  @Column({ name: 'plan_run_id', type: 'varchar', length: 100, nullable: true, default: null })
  planRunId: string | null;

  /** JSON snapshot: which NMs were stale at override time */
  @Column({ name: 'stale_nms', type: 'jsonb', nullable: true, default: null })
  staleNms: object | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
