import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { PlanRun } from './plan-run.entity';

export type DrpCnLineStatus = 'NORMAL' | 'OVER_STOCK' | 'STOCKOUT_RISK';
export type DrpCnLineDemandSource = 'M22_ADJUSTED' | 'FC_RAW';

@Entity('drp_cn_line')
export class DrpCnLine {
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

  /** Monday of the planning week (YYYY-MM-DD) */
  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  /** M22 adjusted qty or FC raw qty (unit: same as demand_snapshot_line) */
  @Column({ name: 'effective_demand', type: 'decimal', precision: 15, scale: 2, default: 0 })
  effectiveDemand: number;

  @Column({ name: 'effective_demand_source', type: 'varchar', length: 20, default: 'FC_RAW' })
  effectiveDemandSource: DrpCnLineDemandSource;

  /** On-hand stock at CN at time of run (from supply_snapshot) */
  @Column({ name: 'on_hand', type: 'decimal', precision: 15, scale: 2, default: 0 })
  onHand: number;

  /** In-transit qty (open POs/transfers expected this week) */
  @Column({ name: 'in_transit', type: 'decimal', precision: 15, scale: 2, default: 0 })
  inTransit: number;

  /** Safety stock final (from ss_cn.ss_final for this cn×sku) */
  @Column({ name: 'ss_final', type: 'decimal', precision: 15, scale: 2, default: 0 })
  ssFinal: number;

  /**
   * net_demand = effective_demand - on_hand - in_transit + ss_final (NOT clamped).
   *  - Positive → replenishment needed (planned order trigger).
   *  - Zero    → balanced.
   *  - Negative → OVER_STOCK signal for M24 (donor candidate).
   * See drp.netting-v2.service.ts runV2() netting loop (spec §5 Step 7 / G15).
   */
  @Column({ name: 'net_demand', type: 'decimal', precision: 15, scale: 2, default: 0 })
  netDemand: number;

  @Column({ type: 'varchar', length: 20, default: 'NORMAL' })
  status: DrpCnLineStatus;

  /**
   * Variant breakdown suggestion. Spec §7: JSONB object `{variantCode: qty}`.
   * NULL when no variant history available (planner review required).
   */
  @Column({ name: 'variant_suggestion', type: 'jsonb', nullable: true, default: null })
  variantSuggestion: Record<string, number> | null;

  /**
   * G7 [spec §14.9 M4 fix] — TRUE when variant suggestion is NULL due to
   * missing supply + demand history. Flags to planner for manual breakdown.
   */
  @Column({ name: 'planner_review_required', type: 'boolean', default: false })
  plannerReviewRequired: boolean;

  /** Reason the planner needs to review (e.g. 'NO_VARIANT_HISTORY'). */
  @Column({ name: 'review_reason', type: 'varchar', length: 50, nullable: true, default: null })
  reviewReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
