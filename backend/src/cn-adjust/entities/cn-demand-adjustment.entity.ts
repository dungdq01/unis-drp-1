import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export type AdjustStatus =
  | 'PENDING'
  | 'AUTO_APPROVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'FORCE_APPROVED'
  | 'EXPIRED';

@Entity('cn_demand_adjustment')
export class CnDemandAdjustment {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @Column({ name: 'sku_id', type: 'bigint' })
  skuId: string;

  /** Always Monday of the target week (mondayOf() helper). */
  @Column({ name: 'period_date', type: 'date' })
  periodDate: string;

  @Column({ name: 'fc_qty', type: 'decimal', precision: 15, scale: 2 })
  fcQty: number;

  @Column({ name: 'adjusted_qty', type: 'decimal', precision: 15, scale: 2 })
  adjustedQty: number;

  /** Pre-computed: (adjusted-fc)/fc*100 — for fast query */
  @Column({ name: 'delta_pct', type: 'decimal', precision: 7, scale: 4 })
  deltaPct: number;

  @Column({ name: 'reason_code', type: 'varchar', length: 50 })
  reasonCode: string;

  /** Mandatory when delta > tolerance or force submit (service-layer validation, not DB). */
  @Column({ name: 'reason_text', type: 'text', nullable: true, default: null })
  reasonText: string | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: AdjustStatus;

  @Column({ name: 'submitted_by', type: 'varchar', length: 100 })
  submittedBy: string;

  @Column({ name: 'submitted_at', type: 'timestamp', default: () => 'NOW()' })
  submittedAt: Date;

  @Column({ name: 'reviewed_by', type: 'varchar', length: 100, nullable: true, default: null })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true, default: null })
  reviewedAt: Date | null;

  @Column({ name: 'review_note', type: 'text', nullable: true, default: null })
  reviewNote: string | null;

  /** Phase 2: backfill from M28 actual_sales. */
  @Column({ name: 'actual_qty', type: 'decimal', precision: 15, scale: 2, nullable: true, default: null })
  actualQty: number | null;

  /** Phase 2: |adj-actual|/actual <= 20% */
  @Column({ name: 'is_accurate', type: 'boolean', nullable: true, default: null })
  isAccurate: boolean | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
