import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('kpi_snapshot')
export class KpiSnapshot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @CreateDateColumn({ name: 'computed_at' })
  computedAt: Date;

  @Column({ name: 'period_type', type: 'varchar', length: 10, default: 'WEEKLY' })
  periodType: 'DAILY' | 'WEEKLY' | 'MONTHLY';

  @Column({ name: 'period_start', type: 'date' })
  periodStart: string;

  @Column({ name: 'period_end', type: 'date' })
  periodEnd: string;

  @Column({ name: 'kpi_group', type: 'varchar', length: 30 })
  kpiGroup: string;

  @Column({ name: 'kpi_code', type: 'varchar', length: 50 })
  kpiCode: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, default: 0 })
  value: number;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, default: null })
  target: number | null;

  @Column({ type: 'varchar', length: 20, default: 'ON_TARGET' })
  status: 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'DISABLED' | 'N_A';

  @Column({ name: 'item_code', type: 'varchar', length: 50, nullable: true, default: null })
  itemCode: string | null;

  @Column({ name: 'location_code', type: 'varchar', length: 20, nullable: true, default: null })
  locationCode: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @Column({ name: 'computed_by', type: 'varchar', length: 100, nullable: true, default: null })
  computedBy: string | null;
}
