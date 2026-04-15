import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_config')
export class SystemConfig {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'config_group', length: 50 })
  configGroup: string;

  @Column({ name: 'config_key', length: 100 })
  configKey: string;

  @Column({ name: 'config_value', type: 'text' })
  configValue: string;

  @Column({ name: 'value_type', length: 20, default: 'STRING' })
  valueType: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_sensitive', default: false })
  isSensitive: boolean;

  @Column({ name: 'updated_by', type: 'varchar', length: 100, nullable: true, default: null })
  updatedBy: string | null;

  @Column({ name: 'updated_at', type: 'timestamp', default: () => 'NOW()' })
  updatedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
