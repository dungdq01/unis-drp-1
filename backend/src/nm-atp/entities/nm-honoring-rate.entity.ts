import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('nm_honoring_rate')
export class NmHonoringRate {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'nm_id', type: 'bigint' })
  nmId: string;

  @Column({ name: 'period_month', type: 'date' })
  periodMonth: string;

  /** C4 CTO fix: Σ atp_qty NM đã promise (PASS+PARTIAL) — denominator của rate. */
  @Column({ name: 'atp_at_check_total', type: 'decimal', precision: 15, scale: 2, nullable: true })
  atpAtCheckTotal: number | null;

  /** Σ requested_qty — chỉ tracking dashboard, KHÔNG dùng compute rate. */
  @Column({ name: 'requested_total', type: 'decimal', precision: 15, scale: 2, nullable: true })
  requestedTotal: number | null;

  /** Σ actual_received từ M27 PO RECEIVED. NULL Phase 1 (M27 chưa có data). */
  @Column({ name: 'fulfilled_total', type: 'decimal', precision: 15, scale: 2, nullable: true })
  fulfilledTotal: number | null;

  /** C4: fulfilled_total / atp_at_check_total. NULL Phase 1. */
  @Column({ name: 'rate', type: 'decimal', precision: 5, scale: 4, nullable: true })
  rate: number | null;

  /** H3: rolling 3-month rate to compare vs 80% threshold (PRD). NULL Phase 1. */
  @Column({ name: 'rolling_3m_rate', type: 'decimal', precision: 5, scale: 4, nullable: true })
  rolling3mRate: number | null;

  @Column({ name: 'cell_count', default: 0 })
  cellCount: number;

  @Column({ name: 'partial_count', default: 0 })
  partialCount: number;

  @Column({ name: 'fail_count', default: 0 })
  failCount: number;

  @Column({ name: 'blocked_count', default: 0 })
  blockedCount: number;

  @CreateDateColumn({ name: 'calculated_at' })
  calculatedAt: Date;
}
