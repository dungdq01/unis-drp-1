import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('transport_trip_line')
export class TransportTripLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transport_trip_id', type: 'bigint' })
  transportTripId: string;

  @Column({ name: 'allocation_result_id', type: 'bigint' })
  allocationResultId: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'allocated_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  allocatedQty: number;

  @Column({ name: 'weight_kg', type: 'decimal', precision: 10, scale: 2, default: 0 })
  weightKg: number;

  // ── M25 extensions (C3 line-to-stop mapping) ─────────────────────────────

  /** FK transport_trip_stop — which stop unloads this line. NULL for single-drop. */
  @Column({ name: 'stop_id', type: 'bigint', nullable: true, default: null })
  stopId: string | null;

  /** Trace to allocation source (lot, donor). */
  @Column({ name: 'source_allocation_leg_id', type: 'bigint', nullable: true, default: null })
  sourceAllocationLegId: string | null;

  /** Top-up accept origin (spec §6b). */
  @Column({ name: 'top_up_suggestion_id', type: 'bigint', nullable: true, default: null })
  topUpSuggestionId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
