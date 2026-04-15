import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('order_batch')
export class OrderBatch {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transport_plan_id', type: 'bigint', unique: true })
  transportPlanId: string;

  @Column({ name: 'batch_code', type: 'varchar', length: 30, unique: true })
  batchCode: string;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'EXPORTED' | 'CANCELLED';

  @Column({ name: 'total_lines', type: 'int', default: 0 })
  totalLines: number;

  @Column({ name: 'total_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalQty: number;

  @Column({ name: 'total_value_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalValueVnd: number;

  @Column({ name: 'submitted_by', type: 'varchar', length: 100, nullable: true, default: null })
  submittedBy: string | null;

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true, default: null })
  submittedAt: Date | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 100, nullable: true, default: null })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true, default: null })
  approvedAt: Date | null;

  @Column({ name: 'rejected_by', type: 'varchar', length: 100, nullable: true, default: null })
  rejectedBy: string | null;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true, default: null })
  rejectedAt: Date | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true, default: null })
  rejectReason: string | null;

  @Column({ name: 'exported_by', type: 'varchar', length: 100, nullable: true, default: null })
  exportedBy: string | null;

  @Column({ name: 'exported_at', type: 'timestamp', nullable: true, default: null })
  exportedAt: Date | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
