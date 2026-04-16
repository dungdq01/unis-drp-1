import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export type TopUpStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';
export type DemandSource = 'M11_FORECAST' | 'M22_ADJUSTED' | 'FC_RAW';

/**
 * M25 top-up suggestion for a HELD trip (spec §6).
 * Created when a trip is HELD with fill < 60%. SC Manager reviews + accepts;
 * acceptance creates a new allocation_result (is_top_up=TRUE) in the same
 * allocation_run without mutating existing result rows (spec §6b H1 fix).
 */
@Entity('top_up_suggestion')
export class TopUpSuggestion {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'suggested_qty', type: 'decimal', precision: 15, scale: 2 })
  suggestedQty: number;

  @Column({ name: 'estimated_pallets', type: 'int', default: 0 })
  estimatedPallets: number;

  @Column({ name: 'estimated_weight_kg', type: 'decimal', precision: 10, scale: 2, default: 0 })
  estimatedWeightKg: number;

  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  reason: string | null;

  @Column({ name: 'priority_score', type: 'int', default: 50 })
  priorityScore: number;

  @Column({ type: 'varchar', length: 15, default: 'PENDING' })
  status: TopUpStatus;

  @Column({ name: 'reviewed_by', type: 'varchar', length: 100, nullable: true, default: null })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true, default: null })
  reviewedAt: Date | null;

  // ── M4 + H2 audit fields ────────────────────────────────────────────────

  /** Monday of forecast week this top-up ships FROM (spec §6 H2). */
  @Column({ name: 'source_period_start', type: 'date' })
  sourcePeriodStart: string;

  /** Frozen at creation time (H2 — do NOT recompute from trip.departure_date). */
  @Column({ name: 'suggested_at', type: 'timestamp', default: () => 'NOW()' })
  suggestedAt: Date;

  /** weeksBetween(suggested_at, source_period_start), immutable after creation. */
  @Column({ name: 'forecast_week_offset', type: 'int', default: 1 })
  forecastWeekOffset: number;

  @Column({ name: 'demand_source', type: 'varchar', length: 20, default: 'FC_RAW' })
  demandSource: DemandSource;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
