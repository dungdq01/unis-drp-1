import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('policy_run')
export class PolicyRun {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'created_by', type: 'varchar', length: 100, default: 'SYSTEM_NIGHTLY' })
  createdBy: string;

  /**
   * Rule 14: Immutable snapshot of M10 system_config rows at run time.
   * Keys: all config_key values from system_config (planning.*, safety_stock.*, etc.)
   */
  @Column({ name: 'config_snapshot', type: 'jsonb' })
  configSnapshot: Record<string, unknown>;

  /**
   * Rule 14: sku_cn_mapping overrides + transport_lane LT values at run time.
   * Shape: { skuCnMappings: [...], transportLanes: [...] }
   */
  @Column({ name: 'master_data_snapshot', type: 'jsonb' })
  masterDataSnapshot: Record<string, unknown>;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
