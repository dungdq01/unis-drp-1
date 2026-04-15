import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('transport_trip')
export class TransportTrip {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transport_plan_id', type: 'bigint' })
  transportPlanId: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'vehicle_type_code', type: 'varchar', length: 20 })
  vehicleTypeCode: 'FLATBED' | 'CRANE_TRUCK';

  @Column({ name: 'carrier_code', type: 'varchar', length: 20, nullable: true, default: null })
  carrierCode: string | null;

  @Column({ name: 'total_weight_kg', type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalWeightKg: number;

  @Column({ name: 'total_pallets', type: 'int', default: 0 })
  totalPallets: number;

  @Column({ name: 'estimated_cost_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  estimatedCostVnd: number;

  @Column({ name: 'departure_date', type: 'date', nullable: true, default: null })
  departureDate: string | null;

  @Column({ name: 'eta_date', type: 'date', nullable: true, default: null })
  etaDate: string | null;

  @Column({ name: 'lead_time_days', type: 'int', default: 1 })
  leadTimeDays: number;

  @Column({ type: 'varchar', length: 20, default: 'PLANNED' })
  status: 'PLANNED' | 'NO_CARRIER' | 'DISPATCHED' | 'DELIVERED';

  @Column({ name: 'exception_note', type: 'text', nullable: true, default: null })
  exceptionNote: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
