import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('allocation_result')
export class AllocationResult {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint' })
  allocationRunId: string;

  /** Nullable per V005 — M24 creates rows from drp_cn_line directly (no planned_order precursor). */
  @Column({ name: 'planned_order_id', type: 'bigint', nullable: true })
  plannedOrderId: string | null;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20, nullable: true, default: null })
  sourceLocationCode: string | null;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20, default: '' })
  destLocationCode: string;

  @Column({ name: 'lot_number', type: 'varchar', length: 50, default: 'DEFAULT' })
  lotNumber: string;

  @Column({ name: 'qty_required', type: 'decimal', precision: 15, scale: 2, default: 0 })
  qtyRequired: number;

  @Column({ name: 'qty_allocated', type: 'decimal', precision: 15, scale: 2, default: 0 })
  qtyAllocated: number;

  @Column({ name: 'fill_rate', type: 'decimal', precision: 5, scale: 4, nullable: true, default: null })
  fillRate: number | null;

  @Column({ name: 'abc_class', type: 'char', length: 1, nullable: true, default: null })
  abcClass: 'A' | 'B' | 'C' | null;

  @Column({ name: 'source_priority', type: 'int', default: 1 })
  sourcePriority: number;

  @Column({ type: 'varchar', length: 20, default: 'UNALLOCATED' })
  status: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED' | 'FULL' | 'PARTIAL_STOCKOUT';

  // ── M24 extensions ───────────────────────────────────────────────────────

  /** M24 cell identity. NULL for legacy M5 rows (pre-M24). */
  @Column({ name: 'cn_id', type: 'bigint', nullable: true, default: null })
  cnId: string | null;

  @Column({ name: 'sku_id', type: 'bigint', nullable: true, default: null })
  skuId: string | null;

  /** H1 fix: Monday of planning week. Carries M23 grain through M24→M25→M26. */
  @Column({ name: 'period_start', type: 'date', nullable: true, default: null })
  periodStart: string | null;

  /** H2 fix: variant breakdown `{variantCode: qty}` output by variant-match service. */
  @Column({ name: 'variant_breakdown', type: 'jsonb', nullable: true, default: null })
  variantBreakdown: Record<string, number> | null;

  // ── Top-up cross-module contract (M25/M26/M27) ──────────────────────────

  /**
   * TRUE when this result row was created by M25 as a top-up parallel leg
   * (shipping from a different forecast week). Distinct from regular M24
   * rows so M26 ATP + M27 review queue can filter by row, not by leg join.
   */
  @Column({ name: 'is_top_up', type: 'boolean', default: false })
  isTopUp: boolean;

  /** FK → top_up_suggestion.id (M25). NULL for non-top-up rows. */
  @Column({ name: 'source_top_up_id', type: 'bigint', nullable: true, default: null })
  sourceTopUpId: string | null;

  /** Forecast week the top-up ships FROM (vs `period_start` which is the target week). */
  @Column({ name: 'source_period_start', type: 'date', nullable: true, default: null })
  sourcePeriodStart: string | null;

  @Column({ name: 'planner_review_required', type: 'boolean', default: false })
  plannerReviewRequired: boolean;

  /** `VARIANT_MISMATCH / PARTIAL_STOCKOUT / LCNB_FAR_DONOR` */
  @Column({ name: 'review_reason', type: 'varchar', length: 50, nullable: true, default: null })
  reviewReason: string | null;

  @Column({ name: 'layer_trace', type: 'jsonb', default: () => "'{}'::jsonb" })
  layerTrace: Record<string, unknown>;

  @Column({ name: 'week_number', type: 'int', default: 1 })
  weekNumber: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
