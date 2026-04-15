import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('transport_plan')
export class TransportPlan {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint', unique: true })
  allocationRunId: string;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

  @Column({ name: 'total_trips', type: 'int', default: 0 })
  totalTrips: number;

  @Column({ name: 'total_weight_kg', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalWeightKg: number;

  @Column({ name: 'total_cost_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalCostVnd: number;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @Column({ name: 'confirmed_by', type: 'varchar', length: 100, nullable: true, default: null })
  confirmedBy: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamp', nullable: true, default: null })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
