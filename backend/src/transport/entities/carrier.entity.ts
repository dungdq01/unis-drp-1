import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('carrier')
export class Carrier {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'carrier_code', type: 'varchar', length: 20, unique: true })
  carrierCode: string;

  @Column({ name: 'carrier_name', type: 'varchar', length: 100 })
  carrierName: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true, default: null })
  contactPhone: string | null;

  @Column({ name: 'historical_otd_pct', type: 'decimal', precision: 5, scale: 4, default: 0.9 })
  historicalOtdPct: number;

  @Column({ name: 'supported_vehicles', type: 'varchar', length: 100, default: 'FLATBED,CRANE_TRUCK' })
  supportedVehicles: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
