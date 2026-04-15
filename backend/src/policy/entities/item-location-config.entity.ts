import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('item_location_config')
export class ItemLocationConfig {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', length: 20 })
  locationCode: string;

  @Column({ name: 'lead_time_days', default: 5 })
  leadTimeDays: number;

  @Column({ name: 'lead_time_variability', type: 'decimal', precision: 5, scale: 4, default: 0.20 })
  leadTimeVariability: number;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
