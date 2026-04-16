import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface VariantSuggestionResult {
  /** Spec §7: `{variantCode: qty}`. NULL when no variant history available. */
  suggestion: Record<string, number> | null;
  plannerReviewRequired: boolean;
  reviewReason: string | null;
}

/**
 * Variant breakdown suggestion (M23 §14.9 — BA re-review adjusted for real schema).
 *
 * Reality check:
 *  - supply_snapshot_line has NO variant_code column (only item_code + qty fields).
 *  - demand_snapshot_line has NO variant_code column either.
 *  - sku_variant exists (variant_code, variant_suffix, variant_name) — attached
 *    to a SKU. No design_proportion column.
 *
 * Phase 1 strategy: when a SKU has active variants registered in sku_variant,
 * distribute net_demand equally across them (Phase 1 equal split; Phase 2 with
 * M28 actual_sales will refine proportions). When a SKU has no active variants,
 * return NULL + planner_review_required so the planner breaks it down manually.
 */
@Injectable()
export class DrpVariantSuggestionService {
  /** skuId → ordered list of variant_codes (equal split base) */
  private variantCache = new Map<string, string[]>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** Pre-load active variants for all SKUs referenced in the run. */
  async preload(cnSkuPairs: Array<{ cnId: string; skuId: string }>): Promise<void> {
    this.variantCache.clear();
    if (cnSkuPairs.length === 0) return;

    const skuIds = Array.from(new Set(cnSkuPairs.map((p) => p.skuId)));
    const rows: Array<{ sku_id: string; variant_code: string }> = await this.dataSource.query(
      `SELECT sku_id::text, variant_code
       FROM sku_variant
       WHERE sku_id = ANY($1::bigint[]) AND active = TRUE
       ORDER BY sku_id, variant_code`,
      [skuIds],
    );
    for (const r of rows) {
      const bucket = this.variantCache.get(r.sku_id) ?? [];
      bucket.push(r.variant_code);
      this.variantCache.set(r.sku_id, bucket);
    }
  }

  suggest(_cnId: string, skuId: string, netDemand: number): VariantSuggestionResult {
    if (netDemand <= 0) {
      return { suggestion: null, plannerReviewRequired: false, reviewReason: null };
    }
    const variants = this.variantCache.get(skuId);
    if (!variants || variants.length === 0) {
      return {
        suggestion: null,
        plannerReviewRequired: true,
        reviewReason: 'NO_VARIANT_HISTORY',
      };
    }
    // Phase 1: equal split. Phase 2 (M28) will weight by actual sales mix.
    const per = netDemand / variants.length;
    const suggestion: Record<string, number> = {};
    for (const code of variants) {
      suggestion[code] = Math.round(per * 100) / 100;
    }
    return { suggestion, plannerReviewRequired: false, reviewReason: null };
  }
}
