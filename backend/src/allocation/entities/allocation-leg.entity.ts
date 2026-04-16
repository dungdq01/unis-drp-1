import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * allocation_leg — BUG-02 fix (schema v2)
 * One row per source per allocation_result.
 * A PARTIAL result that pulls from 2 sources = 2 leg rows.
 * A FULL result from 1 source = 1 leg row.
 *
 * Columns aligned with migration schema:
 *   id, allocation_result_id, source_type VARCHAR(20),
 *   source_entity_id BIGINT DEFAULT 0, source_lot_id VARCHAR(50) NULL,
 *   allocated_qty DECIMAL(15,2), fifo_rank INT NULL,
 *   distance_km DECIMAL(10,2) NULL, created_at TIMESTAMPTZ
 */
@Entity('allocation_leg')
export class AllocationLeg {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_result_id', type: 'bigint' })
  allocationResultId: string;

  /** 'HUB' | 'NM' | 'CN_REDIST' | 'UNKNOWN' */
  @Column({ name: 'source_type', type: 'varchar', length: 20 })
  sourceType: string;

  /** Phase 1: always 0 — will map to warehouse/hub entity id in Phase 2 */
  @Column({ name: 'source_entity_id', type: 'bigint', default: 0 })
  sourceEntityId: string;

  /** Lot-level traceability — Phase 1: NULL */
  @Column({ name: 'source_lot_id', type: 'varchar', length: 50, nullable: true, default: null })
  sourceLotId: string | null;

  @Column({ name: 'allocated_qty', type: 'decimal', precision: 15, scale: 2 })
  allocatedQty: number;

  /** FIFO rank within lot — Phase 1: NULL */
  @Column({ name: 'fifo_rank', type: 'int', nullable: true, default: null })
  fifoRank: number | null;

  /** Distance from source to dest in km — Phase 1: NULL */
  @Column({ name: 'distance_km', type: 'decimal', precision: 10, scale: 2, nullable: true, default: null })
  distanceKm: number | null;

  /**
   * M25 C2 cross-link: period this leg's source ships for (top-up from a
   * different forecast week). NULL for normal HUB/CN_REDIST legs.
   */
  @Column({ name: 'source_period_start', type: 'date', nullable: true, default: null })
  sourcePeriodStart: string | null;

  /** M25 top_up_suggestion.id — audit trace for TOP_UP_NEXT_WEEK legs. */
  @Column({ name: 'origin_top_up_id', type: 'bigint', nullable: true, default: null })
  originTopUpId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
