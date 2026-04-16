import { Injectable } from '@nestjs/common';

export interface VariantMatchResult {
  /** True when at least one variant could not be fully allocated from available sources. */
  plannerReviewRequired: boolean;
  reviewReason: 'VARIANT_MISMATCH' | null;
  /** Per-variant allocated qty breakdown (informational for M27 review). */
  variantBreakdown: Record<string, number>;
}

/**
 * M24 spec §13.6 [M5 fix] — Variant match post-process.
 *
 * M24 loop operates at SKU-base level (one cell per CN×SKU). After the base
 * allocation qty is decided (Hub + LCNB waterfall), this service splits that
 * qty across variants per the M23 variant_suggestion, flagging mismatches
 * for M27 planner review when suggested variants are not all covered.
 *
 * Phase 1 is best-effort: we don't have per-variant on-hand in supply_snapshot,
 * so we assume the allocated base qty can fulfill the suggestion proportionally
 * and flag review when the base allocation is short of the suggestion total.
 */
@Injectable()
export class AllocationVariantMatchService {
  match(
    allocQtyBase: number,
    variantSuggestion: Record<string, number> | null,
  ): VariantMatchResult {
    if (!variantSuggestion || Object.keys(variantSuggestion).length === 0) {
      return { plannerReviewRequired: false, reviewReason: null, variantBreakdown: {} };
    }

    const totalSuggestionQty = Object.values(variantSuggestion).reduce(
      (s, v) => s + (Number(v) || 0),
      0,
    );
    if (totalSuggestionQty <= 0) {
      return { plannerReviewRequired: false, reviewReason: null, variantBreakdown: {} };
    }

    const variantBreakdown: Record<string, number> = {};
    for (const [code, suggestedQty] of Object.entries(variantSuggestion)) {
      const proportion = Number(suggestedQty) / totalSuggestionQty;
      variantBreakdown[code] = Math.round(allocQtyBase * proportion * 100) / 100;
    }

    // If base allocation is short of the full suggestion total, flag review.
    // Threshold 1 unit to absorb rounding.
    const plannerReviewRequired = allocQtyBase + 1 < totalSuggestionQty;

    return {
      plannerReviewRequired,
      reviewReason: plannerReviewRequired ? 'VARIANT_MISMATCH' : null,
      variantBreakdown,
    };
  }
}
