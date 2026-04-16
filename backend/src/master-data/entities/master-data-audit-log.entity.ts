import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('master_data_audit_log')
export class MasterDataAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'entity_type', length: 30 })
  entityType: string;

  // varchar(100): supports both BIGINT ids (sku, channel...) and VARCHAR PKs (supplier_code)
  @Column({ name: 'entity_id', type: 'varchar', length: 100 })
  entityId: string;

  @Column({ name: 'action', length: 10 })
  action: string; // CREATE | UPDATE | DELETE | IMPORT

  @Column({ name: 'changed_fields', type: 'jsonb', nullable: true })
  changedFields: object | null;

  @Column({ name: 'changed_by', length: 100 })
  changedBy: string;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt: Date;

  @Column({ name: 'source', length: 20, default: 'UI' })
  source: string; // UI | IMPORT | M28_AUTO
}
