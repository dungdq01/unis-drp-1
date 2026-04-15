import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('order_line')
export class OrderLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'order_batch_id', type: 'bigint' })
  orderBatchId: string;

  @Column({ name: 'order_no', type: 'varchar', length: 40, unique: true })
  orderNo: string;

  @Column({ name: 'order_type', type: 'varchar', length: 10, default: 'TO' })
  orderType: 'TO' | 'SO' | 'PO';

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'item_name', type: 'varchar', length: 500, nullable: true, default: null })
  itemName: string | null;

  @Column({ name: 'base_uom', type: 'varchar', length: 20, default: 'M2' })
  baseUom: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  qty: number;

  @Column({ name: 'unit_price_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  unitPriceVnd: number;

  @Column({ name: 'total_value_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalValueVnd: number;

  @Column({ name: 'departure_date', type: 'date', nullable: true, default: null })
  departureDate: string | null;

  @Column({ name: 'eta_date', type: 'date', nullable: true, default: null })
  etaDate: string | null;

  @Column({ name: 'carrier_code', type: 'varchar', length: 20, nullable: true, default: null })
  carrierCode: string | null;

  @Column({ name: 'transport_trip_id', type: 'bigint', nullable: true, default: null })
  transportTripId: string | null;

  @Column({ name: 'allocation_result_id', type: 'bigint', nullable: true, default: null })
  allocationResultId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'CANCELLED';

  @Column({ name: 'erp_ref', type: 'varchar', length: 50, nullable: true, default: null })
  erpRef: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
