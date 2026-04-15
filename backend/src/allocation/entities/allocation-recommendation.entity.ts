import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('allocation_recommendation')
export class AllocationRecommendation {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint' })
  allocationRunId: string;

  @Column({ type: 'varchar', length: 40, default: 'LCNB_LATERAL_TRANSFER' })
  type: 'LCNB_LATERAL_TRANSFER';

  @Column({ name: 'from_location_code', type: 'varchar', length: 20 })
  fromLocationCode: string;

  @Column({ name: 'to_location_code', type: 'varchar', length: 20 })
  toLocationCode: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'suggested_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  suggestedQty: number;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

  @Column({ name: 'decided_by', type: 'varchar', length: 100, nullable: true, default: null })
  decidedBy: string | null;

  @Column({ name: 'decided_at', type: 'timestamp', nullable: true, default: null })
  decidedAt: Date | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
