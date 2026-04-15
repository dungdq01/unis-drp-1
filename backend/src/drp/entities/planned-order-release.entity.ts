import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { PlanRun } from './plan-run.entity';

@Entity('planned_order_release')
export class PlannedOrderRelease {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'plan_run_id', type: 'bigint' })
  planRunId: string;

  @ManyToOne(() => PlanRun)
  @JoinColumn({ name: 'plan_run_id' })
  planRun: PlanRun;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', type: 'varchar', length: 20 })
  locationCode: string;

  @Column({ name: 'week_number', type: 'int' })
  weekNumber: number;

  @Column({ name: 'week_start_date', type: 'date' })
  weekStartDate: Date;

  @Column({ name: 'beginning_inventory', type: 'decimal', precision: 15, scale: 2, nullable: true, default: null })
  beginningInventory: number | null;

  @Column({ name: 'gross_requirement', type: 'decimal', precision: 15, scale: 2, default: 0 })
  grossRequirement: number;

  @Column({ name: 'scheduled_receipt', type: 'decimal', precision: 15, scale: 2, default: 0 })
  scheduledReceipt: number;

  @Column({ name: 'pab_before', type: 'decimal', precision: 15, scale: 2 })
  pabBefore: number;

  @Column({ name: 'net_requirement', type: 'decimal', precision: 15, scale: 2, default: 0 })
  netRequirement: number;

  @Column({ name: 'planned_order_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  plannedOrderQty: number;

  @Column({ name: 'pab_after', type: 'decimal', precision: 15, scale: 2 })
  pabAfter: number;

  @Column({ name: 'safety_stock', type: 'decimal', precision: 15, scale: 2, default: 0 })
  safetyStock: number;

  @Column({ name: 'hstk', type: 'decimal', precision: 7, scale: 2, nullable: true, default: null })
  hstk: number | null;

  @Column({ name: 'frozen_zone_flag', type: 'boolean', default: false })
  frozenZoneFlag: boolean;

  @Column({ type: 'varchar', length: 20, default: 'AUTO_RELEASE' })
  status: 'AUTO_RELEASE' | 'NEEDS_APPROVAL' | 'RELEASED' | 'CANCELLED';

  @Column({ name: 'demand_basis', type: 'varchar', length: 20, default: 'MAX_FORECAST_PO' })
  demandBasis: string;

  @Column({ name: 'is_estimated', type: 'boolean', default: false })
  isEstimated: boolean;

  @Column({ name: 'approved_by', type: 'varchar', length: 100, nullable: true, default: null })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true, default: null })
  approvedAt: Date | null;

  @Column({ name: 'cancelled_by', type: 'varchar', length: 100, nullable: true, default: null })
  cancelledBy: string | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true, default: null })
  cancelledAt: Date | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true, default: null })
  cancelReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
