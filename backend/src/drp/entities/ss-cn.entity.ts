import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PlanRun } from './plan-run.entity';

export type SsCnSource = 'FORMULA' | 'OVERRIDE_EXPLICIT' | 'OVERRIDE_Z';

@Entity('ss_cn')
export class SsCn {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @ManyToOne(() => PlanRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_run_id' })
  planRun: PlanRun;

  @Column({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  /** σ from rolling 12-week window (stddev of weekly demand) */
  @Column({ name: 'sigma_rolling', type: 'decimal', precision: 15, scale: 4, default: 0 })
  sigmaRolling: number;

  /** σ from seasonal model (nullable — only when seasonal data available) */
  @Column({ name: 'sigma_seasonal', type: 'decimal', precision: 15, scale: 4, nullable: true, default: null })
  sigmaSeasonal: number | null;

  /** MAX(sigmaRolling, sigmaSeasonal) used in formula */
  @Column({ name: 'sigma_final', type: 'decimal', precision: 15, scale: 4, default: 0 })
  sigmaFinal: number;

  /** Z-score used (1.65=95%, 1.96=97.5%, 2.33=99%) */
  @Column({ name: 'z_used', type: 'decimal', precision: 5, scale: 4, default: 1.65 })
  zUsed: number;

  /** Lead time from hub to CN in days */
  @Column({ name: 'lt_hub_days', type: 'decimal', precision: 5, scale: 2, default: 0 })
  ltHubDays: number;

  /** ss_base = z × σ_final × √(lt_hub_days) */
  @Column({ name: 'ss_base', type: 'decimal', precision: 15, scale: 2, default: 0 })
  ssBase: number;

  /** LCNB reduction % (0–100). Applied: ss_final = ss_base × (1 - lcnb_reduction_pct/100) */
  @Column({ name: 'lcnb_reduction_pct', type: 'decimal', precision: 5, scale: 2, default: 0 })
  lcnbReductionPct: number;

  /** Final SS after LCNB reduction */
  @Column({ name: 'ss_final', type: 'decimal', precision: 15, scale: 2, default: 0 })
  ssFinal: number;

  @Column({ type: 'varchar', length: 20, default: 'FORMULA' })
  source: SsCnSource;

  /** TRUE if this CN×SKU is flagged critical (z_used elevated or OVERRIDE_EXPLICIT) */
  @Column({ name: 'is_critical', type: 'boolean', default: false })
  isCritical: boolean;
}
