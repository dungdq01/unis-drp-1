import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('transport_trip')
export class TransportTrip {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transport_plan_id', type: 'bigint' })
  transportPlanId: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'vehicle_type_code', type: 'varchar', length: 20 })
  vehicleTypeCode: 'FLATBED' | 'CRANE_TRUCK';

  @Column({ name: 'carrier_code', type: 'varchar', length: 20, nullable: true, default: null })
  carrierCode: string | null;

  @Column({ name: 'total_weight_kg', type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalWeightKg: number;

  @Column({ name: 'total_pallets', type: 'int', default: 0 })
  totalPallets: number;

  @Column({ name: 'estimated_cost_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  estimatedCostVnd: number;

  @Column({ name: 'departure_date', type: 'date', nullable: true, default: null })
  departureDate: string | null;

  @Column({ name: 'eta_date', type: 'date', nullable: true, default: null })
  etaDate: string | null;

  @Column({ name: 'lead_time_days', type: 'int', default: 1 })
  leadTimeDays: number;

  @Column({ type: 'varchar', length: 20, default: 'PLANNED' })
  status: 'PLANNED' | 'HELD' | 'NO_CARRIER' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';

  @Column({ name: 'exception_note', type: 'text', nullable: true, default: null })
  exceptionNote: string | null;

  // ── M25 extensions ───────────────────────────────────────────────────────

  /** MAX(pallets_pct, weight_pct) 0-1 — computed after consolidation (spec §4) */
  @Column({ name: 'fill_ratio', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRatio: number | null;

  /** Lifecycle reason distinct from status. SHIP | HOLD | FORCE_SHIP_LOW_FILL | FORCE_SHIP_TIMEOUT */
  @Column({ name: 'hold_decision', type: 'varchar', length: 25, nullable: true, default: null })
  holdDecision: 'SHIP' | 'HOLD' | 'FORCE_SHIP_LOW_FILL' | 'FORCE_SHIP_TIMEOUT' | null;

  @Column({ name: 'hold_until_date', type: 'date', nullable: true, default: null })
  holdUntilDate: string | null;

  @Column({ name: 'hold_reason', type: 'text', nullable: true, default: null })
  holdReason: string | null;

  @Column({ name: 'held_at', type: 'timestamp', nullable: true, default: null })
  heldAt: Date | null;

  @Column({ name: 'is_multi_drop', type: 'boolean', default: false })
  isMultiDrop: boolean;

  @Column({ name: 'stop_count', type: 'int', default: 1 })
  stopCount: number;

  @Column({ name: 'policy_run_id', type: 'bigint', nullable: true, default: null })
  policyRunId: string | null;

  @Column({ name: 'allocation_run_id', type: 'bigint', nullable: true, default: null })
  allocationRunId: string | null;

  @Column({ name: 'cancel_reason', type: 'text', nullable: true, default: null })
  cancelReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
