import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';

/**
 * M25 multi-drop UNLOAD stop (Phase 1 — no LOAD stops).
 * Source location is on transport_trip.source_location_code (not a stop row).
 */
@Entity('transport_trip_stop')
@Unique(['tripId', 'stopSequence'])
export class TransportTripStop {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'trip_id', type: 'bigint' })
  tripId: string;

  /** 1-indexed nearest-neighbor sequence (spec §5). */
  @Column({ name: 'stop_sequence', type: 'int' })
  stopSequence: number;

  @Column({ name: 'location_code', type: 'varchar', length: 20 })
  locationCode: string;

  @Column({ name: 'pallets_at_stop', type: 'int', default: 0 })
  palletsAtStop: number;

  @Column({ name: 'weight_kg_at_stop', type: 'decimal', precision: 10, scale: 2, default: 0 })
  weightKgAtStop: number;

  @Column({ name: 'eta_at_stop', type: 'date', nullable: true, default: null })
  etaAtStop: string | null;

  @Column({ name: 'arrived_at', type: 'timestamp', nullable: true, default: null })
  arrivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
