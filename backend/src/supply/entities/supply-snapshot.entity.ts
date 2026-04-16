import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { SupplySnapshotLine } from './supply-snapshot-line.entity';

@Entity('supply_snapshot')
export class SupplySnapshot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'snapshot_name', length: 200 })
  snapshotName: string;

  @Column({ length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'FROZEN' | 'ARCHIVED';

  @Column({ length: 10, default: 'PASS' })
  freshness: 'PASS' | 'STALE';

  @Column({ name: 'freshness_age_minutes', type: 'int', default: 0 })
  freshnessAgeMinutes: number;

  @Column({ name: 'total_lines', type: 'int', default: 0 })
  totalLines: number;

  @Column({ name: 'total_items', type: 'int', default: 0 })
  totalItems: number;

  @Column({ name: 'total_locations', type: 'int', default: 0 })
  totalLocations: number;

  @Column({ name: 'total_allocatable_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalAllocatableQty: number;

  @Column({ name: 'total_reserved_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalReservedQty: number;

  @Column({ name: 'total_in_transit_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalInTransitQty: number;

  @Column({ name: 'estimated_lines_count', type: 'int', default: 0 })
  estimatedLinesCount: number;

  @Column({ name: 'stale_acknowledged', default: false })
  staleAcknowledged: boolean;

  @Column({ name: 'stale_acknowledged_by', nullable: true })
  staleAcknowledgedBy: string;

  @Column({ name: 'stale_acknowledged_at', type: 'timestamp', nullable: true })
  staleAcknowledgedAt: Date;

  @Column({ name: 'stale_reason', type: 'text', nullable: true })
  staleReason: string;

  @Column({ name: 'capture_at', type: 'timestamp', default: () => 'NOW()' })
  captureAt: Date;

  @Column({ name: 'frozen_at', type: 'timestamp', nullable: true })
  frozenAt: Date;

  @Column({ name: 'frozen_by', nullable: true })
  frozenBy: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  // ── M21 Data Sync fields ─────────────────────────────────────────────────

  /** NM supplier code — references supplier.supplier_code (VARCHAR PK until Sprint 2). */
  @Column({ name: 'nm_code', type: 'varchar', length: 30, nullable: true, default: null })
  nmCode: string | null;

  /** Timestamp of last confirmed NM upload. Gate checks this vs threshold. */
  @Column({ name: 'synced_at', type: 'timestamp', nullable: true, default: null })
  syncedAt: Date | null;

  /** Data origin. LEGACY = pre-M21 rows (skip gate during grace period). */
  @Column({ name: 'source', type: 'varchar', length: 20, default: 'LEGACY' })
  source: 'NM_UPLOAD' | 'MANUAL' | 'ESTIMATED' | 'FALLBACK' | 'LEGACY';

  /** Grace period flag. TRUE = skip freshness gate. DevOps flips FALSE after 3 days. */
  @Column({ name: 'is_legacy_data', type: 'boolean', default: false })
  isLegacyData: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => SupplySnapshotLine, (line) => line.snapshot)
  lines: SupplySnapshotLine[];
}
