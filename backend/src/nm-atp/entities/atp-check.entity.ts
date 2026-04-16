import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export interface UrgencyRankEntry {
  cnId: string;
  cnCode: string;
  hstkDays: number;
  transitLtDays: number;
  isCritical: boolean;   // hstk_days < transit_lt_days (C3 CTO fix)
  requestedQty: number;
  atpAlloc: number;
  unfulfilled: number;
  rank: number;
}

@Entity('atp_check')
export class AtpCheck {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'atp_run_id', type: 'bigint' })
  atpRunId: string;

  @Column({ name: 'allocation_run_id', type: 'bigint' })
  allocationRunId: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @Column({ name: 'policy_run_id', type: 'bigint', nullable: true })
  policyRunId: string | null;

  @Column({ name: 'nm_id', type: 'bigint' })
  nmId: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'requested_qty', type: 'decimal', precision: 15, scale: 2 })
  requestedQty: number;

  @Column({ name: 'atp_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
  atpQty: number | null;

  @Column({ length: 15 })
  result: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';

  /** Only set for BLOCKED (STALE_DATA) and FAIL (ZERO_STOCK). NOT for fallback warning. */
  @Column({ type: 'varchar', length: 50, nullable: true })
  reason: string | null;

  /** H6 CTO fix: independent warning flag when atp_qty fallback to allocatable_qty. */
  @Column({ name: 'is_atp_null_fallback', default: false })
  isAtpNullFallback: boolean;

  @Column({ name: 'urgency_ranking', type: 'jsonb', nullable: true })
  urgencyRanking: UrgencyRankEntry[] | null;

  @CreateDateColumn({ name: 'checked_at' })
  checkedAt: Date;
}
