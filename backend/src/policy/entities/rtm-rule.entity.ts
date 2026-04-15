import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('rtm_rule')
export class RtmRule {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'branch_code', length: 20 })
  branchCode: string;

  @Column({ name: 'warehouse_code', length: 20 })
  warehouseCode: string;

  @Column({ type: 'int' })
  priority: 1 | 2 | 3;

  @Column({ name: 'transport_days', type: 'int', default: 3 })
  transportDays: number;

  @Column({ name: 'transport_cost', type: 'decimal', precision: 10, scale: 2, nullable: true })
  transportCost: number | null;

  @Column({ name: 'min_order_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
  minOrderQty: number | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
