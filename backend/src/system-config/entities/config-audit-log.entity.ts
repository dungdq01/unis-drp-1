import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('config_audit_log')
export class ConfigAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'config_group', length: 50 })
  configGroup: string;

  @Column({ name: 'config_key', length: 100 })
  configKey: string;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue: string | null;

  @Column({ name: 'new_value', type: 'text' })
  newValue: string;

  @Column({ name: 'changed_by', length: 100 })
  changedBy: string;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt: Date;

  @Column({ type: 'text', nullable: true })
  reason: string | null;
}
