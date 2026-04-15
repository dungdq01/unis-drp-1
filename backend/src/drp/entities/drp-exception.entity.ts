import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('drp_exception')
export class DrpException {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 10 })
  severity: 'HIGH' | 'MEDIUM' | 'LOW';

  @Column({ name: 'item_code', type: 'varchar', length: 50, nullable: true, default: null })
  itemCode: string | null;

  @Column({ name: 'location_code', type: 'varchar', length: 20, nullable: true, default: null })
  locationCode: string | null;

  @Column({ name: 'week_number', type: 'int', nullable: true, default: null })
  weekNumber: number | null;

  @Column({ name: 'detail_json', type: 'jsonb', nullable: true, default: null })
  detailJson: Record<string, unknown> | null;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @Column({ name: 'resolved_by', type: 'varchar', length: 100, nullable: true, default: null })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamp', nullable: true, default: null })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true, default: null })
  resolutionNote: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
