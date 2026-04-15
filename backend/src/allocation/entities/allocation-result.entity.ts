import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('allocation_result')
export class AllocationResult {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint' })
  allocationRunId: string;

  @Column({ name: 'planned_order_id', type: 'bigint' })
  plannedOrderId: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20, nullable: true, default: null })
  sourceLocationCode: string | null;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20, default: '' })
  destLocationCode: string;

  @Column({ name: 'lot_number', type: 'varchar', length: 50, default: 'DEFAULT' })
  lotNumber: string;

  @Column({ name: 'qty_required', type: 'decimal', precision: 15, scale: 2, default: 0 })
  qtyRequired: number;

  @Column({ name: 'qty_allocated', type: 'decimal', precision: 15, scale: 2, default: 0 })
  qtyAllocated: number;

  @Column({ name: 'fill_rate', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRate: number | null;

  @Column({ name: 'abc_class', type: 'char', length: 1, nullable: true, default: null })
  abcClass: 'A' | 'B' | 'C' | null;

  @Column({ name: 'source_priority', type: 'int', default: 1 })
  sourcePriority: number;

  @Column({ type: 'varchar', length: 20, default: 'UNALLOCATED' })
  status: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED';

  @Column({ name: 'layer_trace', type: 'jsonb', default: () => "'{}'::jsonb" })
  layerTrace: Record<string, unknown>;

  @Column({ name: 'week_number', type: 'int', default: 1 })
  weekNumber: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
