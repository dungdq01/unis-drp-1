import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { DemandSnapshot } from './demand-snapshot.entity';

/**
 * Maps EXACTLY to 002_demand.sql demand_forecast_detail table.
 * Raw 22-column data from DRP export (drp_export_dec25_q1_2026.csv).
 */
@Entity('demand_forecast_detail')
export class DemandForecastDetail {
  @PrimaryGeneratedColumn('uuid', { name: 'detail_id' })
  id: string;

  @Column({ name: 'snapshot_id', nullable: true })
  snapshotId?: string;

  @Column({ name: 'run_id', nullable: true })
  runId?: string;

  @Column({ name: 'forecast_date' })
  forecastDate: string;

  @Column({ name: 'branch_id', nullable: true })
  branchId?: string;

  @Column({ name: 'branch_name', nullable: true })
  branchName?: string;

  @Column({ nullable: true })
  region?: string;

  @Column({ name: 'fsku_id' })
  fskuId: string;

  @Column({ name: 'item_code', nullable: true })
  itemCode?: string;

  @Column({ name: 'location_code', nullable: true })
  locationCode?: string;

  @Column({ name: 'sku_name', nullable: true })
  skuName?: string;

  @Column({ nullable: true, length: 1 })
  segment?: string;

  @Column({ name: 'model_config_id', nullable: true })
  modelConfigId?: string;

  @Column({ name: 'forecast_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  forecastQty: number;

  @Column({ name: 'reconciled_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  reconciledQty: number;

  @Column({ name: 'scale_factor', type: 'decimal', precision: 5, scale: 2, default: 1.0 })
  scaleFactor: number;

  @Column({ name: 'tet_flag', nullable: true, length: 1 })
  tetFlag?: string;

  @Column({ name: 'combo_class', nullable: true })
  comboClass?: string;

  @Column({ name: 'branch_archetype', nullable: true })
  branchArchetype?: string;

  @Column({ name: 'confidence_lower', type: 'decimal', precision: 15, scale: 2, nullable: true })
  confidenceLower?: number;

  @Column({ name: 'confidence_upper', type: 'decimal', precision: 15, scale: 2, nullable: true })
  confidenceUpper?: number;

  @Column({ name: 'qty_sold_12m_avg', type: 'decimal', precision: 15, scale: 2, nullable: true })
  qtySold12mAvg?: number;

  @Column({ name: 'qty_sold_3m_avg', type: 'decimal', precision: 15, scale: 2, nullable: true })
  qtySold3mAvg?: number;

  @Column({ name: 'panel_months', nullable: true })
  panelMonths?: number;

  @Column({ name: 'last_nonzero_month', nullable: true })
  lastNonzeroMonth?: string;

  @Column({ name: 'data_cutoff', nullable: true })
  dataCutoff?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => DemandSnapshot)
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: DemandSnapshot;
}
