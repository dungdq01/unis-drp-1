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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
