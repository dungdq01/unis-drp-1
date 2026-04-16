import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('ss_adjustment_log')
export class SsAdjustmentLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'weekly_snapshot_id', type: 'bigint' })
  weeklySnapshotId: string;

  @Column({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  @Column({ name: 'ss_old', type: 'decimal', precision: 15, scale: 2 })
  ssOld: number;

  @Column({ name: 'ss_new_uncapped', type: 'decimal', precision: 15, scale: 2 })
  ssNewUncapped: number;

  @Column({ name: 'ss_new_applied', type: 'decimal', precision: 15, scale: 2 })
  ssNewApplied: number;

  @Column({ name: 'delta_pct', type: 'decimal', precision: 7, scale: 4 })
  deltaPct: number;

  @Column({ name: 'is_capped', default: false })
  isCapped: boolean;

  @Column({ name: 'sigma_old', type: 'decimal', precision: 15, scale: 4, nullable: true })
  sigmaOld: number | null;

  @Column({ name: 'sigma_new', type: 'decimal', precision: 15, scale: 4, nullable: true })
  sigmaNew: number | null;

  @Column({ name: 'trigger', length: 20, default: 'AUTO_WEEKLY' })
  trigger: 'AUTO_WEEKLY' | 'MANUAL_REFRESH';

  @CreateDateColumn({ name: 'calculated_at' })
  calculatedAt: Date;
}
