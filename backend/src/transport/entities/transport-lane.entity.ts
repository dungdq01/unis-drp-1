import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('transport_lane')
export class TransportLane {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'distance_km', type: 'decimal', precision: 8, scale: 2, default: 0 })
  distanceKm: number;

  @Column({ name: 'lead_time_days', type: 'int', default: 1 })
  leadTimeDays: number;

  @Column({ name: 'rate_vnd_per_km', type: 'decimal', precision: 12, scale: 2, default: 15000 })
  rateVndPerKm: number;

  @Column({ name: 'carrier_codes', type: 'varchar', length: 200, default: '' })
  carrierCodes: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
