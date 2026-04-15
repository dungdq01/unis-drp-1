import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('plan_actual_comparison')
export class PlanActualComparison {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @CreateDateColumn({ name: 'computed_at' })
  computedAt: Date;

  @Column({ name: 'comparison_type', type: 'varchar', length: 30 })
  comparisonType: 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL' | 'UPLOAD_COMPARE';

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'period_type', type: 'varchar', length: 10, default: 'MONTHLY' })
  periodType: 'MONTHLY' | 'WEEKLY';

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', type: 'varchar', length: 20 })
  locationCode: string;

  @Column({ name: 'snapshot_id_base', type: 'varchar', length: 36 })
  snapshotIdBase: string;

  @Column({ name: 'snapshot_id_compare', type: 'varchar', length: 36, nullable: true, default: null })
  snapshotIdCompare: string | null;

  @Column({ name: 'plan_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  planQty: number;

  @Column({ name: 'actual_qty', type: 'decimal', precision: 15, scale: 2, nullable: true, default: null })
  actualQty: number | null;

  @Column({ name: 'variance_qty', type: 'decimal', precision: 15, scale: 2, nullable: true, default: null })
  varianceQty: number | null;

  @Column({ name: 'variance_pct', type: 'decimal', precision: 10, scale: 4, nullable: true, default: null })
  variancePct: number | null;

  @Column({ name: 'fill_rate_proxy', type: 'decimal', precision: 10, scale: 4, nullable: true, default: null })
  fillRateProxy: number | null;

  @Column({ type: 'varchar', length: 20, default: 'ON_TARGET' })
  status: 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'N_A';

  @Column({ name: 'computed_by', type: 'varchar', length: 100, nullable: true, default: null })
  computedBy: string | null;
}
