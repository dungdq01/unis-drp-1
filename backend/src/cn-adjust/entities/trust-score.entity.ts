import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('trust_score')
export class TrustScore {
  /** 1 row per CN — PK = cn_id */
  @PrimaryColumn({ name: 'cn_id', type: 'bigint' })
  cnId: string;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 100.0 })
  score: number;

  @Column({ name: 'total_adjustments_12w', type: 'int', default: 0 })
  totalAdjustments12w: number;

  @Column({ name: 'accurate_adjustments_12w', type: 'int', default: 0 })
  accurateAdjustments12w: number;

  @Column({ name: 'last_calculated_at', type: 'timestamp', nullable: true, default: null })
  lastCalculatedAt: Date | null;

  /** TRUE = Phase 1 grace period, no actual_sales yet. Display badge "Pending Phase 2". */
  @Column({ name: 'is_grace_period', type: 'boolean', default: true })
  isGracePeriod: boolean;
}
