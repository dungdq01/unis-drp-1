import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type AuditAction = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'FORCE' | 'EXPIRE';

@Entity('cn_adjust_audit_log')
export class CnAdjustAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'adjustment_id', type: 'bigint', nullable: true, default: null })
  adjustmentId: string | null;

  @Column({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  @Column({ type: 'varchar', length: 30 })
  action: AuditAction;

  @Column({ name: 'old_status', type: 'varchar', length: 30, nullable: true, default: null })
  oldStatus: string | null;

  @Column({ name: 'new_status', type: 'varchar', length: 30 })
  newStatus: string;

  @Column({ type: 'varchar', length: 100 })
  actor: string;

  @Column({ name: 'reason_text', type: 'text', nullable: true, default: null })
  reasonText: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
