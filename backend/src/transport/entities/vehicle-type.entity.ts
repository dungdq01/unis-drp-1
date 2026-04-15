import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('vehicle_type')
export class VehicleType {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: 'FLATBED' | 'CRANE_TRUCK';

  @Column({ type: 'varchar', length: 50 })
  label: string;

  @Column({ name: 'capacity_kg', type: 'decimal', precision: 10, scale: 2 })
  capacityKg: number;

  @Column({ name: 'capacity_pallets', type: 'int', default: 0 })
  capacityPallets: number;

  @Column({ name: 'cost_multiplier', type: 'decimal', precision: 5, scale: 3, default: 1.0 })
  costMultiplier: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
