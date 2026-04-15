import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('lot_attribute')
export class LotAttribute {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', length: 20 })
  locationCode: string;

  @Column({ name: 'lot_number', length: 50, default: 'DEFAULT' })
  lotNumber: string;

  @Column({ name: 'on_hand_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  onHandQty: number;

  @Column({ name: 'reserved_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  reservedQty: number;

  @Column({ name: 'quarantine_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  quarantineQty: number;

  @Column({ name: 'in_transit_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  inTransitQty: number;

  @Column({ name: 'quality_status', length: 20, default: 'ALLOCATABLE' })
  qualityStatus: 'ALLOCATABLE' | 'HOLD' | 'REJECTED';

  @Column({ name: 'source_type', length: 20, default: 'OEM' })
  sourceType: 'OEM' | 'DISTRIBUTION';

  @Column({ name: 'last_sync_at', type: 'timestamp', default: () => 'NOW()' })
  lastSyncAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
