import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SupplySnapshot } from './supply-snapshot.entity';

@Entity('supply_snapshot_line')
export class SupplySnapshotLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'snapshot_id', type: 'bigint' })
  snapshotId: string;

  @ManyToOne(() => SupplySnapshot, (s) => s.lines)
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: SupplySnapshot;

  @Column({ name: 'item_code', length: 50 })
  itemCode: string;

  @Column({ name: 'location_code', length: 20 })
  locationCode: string;

  @Column({ name: 'allocatable_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  allocatableQty: number;

  @Column({ name: 'reserved_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  reservedQty: number;

  @Column({ name: 'quarantine_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  quarantineQty: number;

  @Column({ name: 'in_transit_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  inTransitQty: number;

  @Column({ name: 'is_estimated', default: false })
  isEstimated: boolean;

  @Column({ name: 'oldest_sync_at', type: 'timestamp', nullable: true })
  oldestSyncAt: Date | null;

  @Column({ length: 10, default: 'PASS' })
  freshness: 'PASS' | 'STALE';

  @Column({ name: 'override_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
  overrideQty: number;

  @Column({ name: 'override_reason', type: 'text', nullable: true })
  overrideReason: string;

  @Column({ name: 'override_by', nullable: true })
  overrideBy: string;

  @Column({ name: 'override_at', type: 'timestamp', nullable: true })
  overrideAt: Date;

  /** M25 H2: line-level reservation for in-transit transport trips. Added in V006. */
  @Column({ name: 'reserved_for_transport', type: 'decimal', precision: 15, scale: 2, default: 0 })
  reservedForTransport: number;

  /**
   * M26 §11b prerequisite (C2/H4 CTO fix): Available-To-Promise qty uploaded by NM via M21 template.
   * NULL when NM has not uploaded with ATP column → M26 falls back to allocatable_qty + is_atp_null_fallback flag.
   * Added in V007 migration.
   */
  @Column({ name: 'atp_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
  atpQty: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
