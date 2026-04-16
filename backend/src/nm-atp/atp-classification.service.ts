import { Injectable } from '@nestjs/common';
import { AtpResult } from '../common/atp-utils';

export interface ClassifyInput {
  atpQty: number | null;
  requestedQty: number;
  isFresh: boolean;
}

export interface ClassifyOutput {
  result: AtpResult;
  reason: string | null;
  /** H6 CTO fix: warning flag only — does NOT affect result classification. */
  isAtpNullFallback: boolean;
  /** Effective ATP qty used for classification (after fallback). */
  effectiveAtpQty: number | null;
}

/**
 * M26 §4 Step 5c — ATP classification (R2/H1/H6 CTO fixes).
 *
 * Result matrix:
 *   BLOCKED  — isFresh=false: stale data, cannot conclude (H1 fix: ≠ FAIL semantics)
 *   PASS     — atp >= requested
 *   PARTIAL  — 0 < atp < requested
 *   FAIL     — atp = 0 (declarative zero stock)
 *
 * Note: is_atp_null_fallback is a separate warning flag (H6 fix),
 * NOT a reason and NOT affecting the result classification.
 */
@Injectable()
export class AtpClassificationService {
  classify(input: ClassifyInput): ClassifyOutput {
    // R3/H1: freshness gate always wins — BLOCKED before ATP qty check
    if (!input.isFresh) {
      return {
        result: 'BLOCKED',
        reason: 'STALE_DATA',
        isAtpNullFallback: false,
        effectiveAtpQty: null,
      };
    }

    // R11/H6: atp_qty NULL fallback (warning flag, classification continues normally)
    const isAtpNullFallback = input.atpQty === null || input.atpQty === undefined;

    // effectiveAtpQty: use atp_qty if present, else treat as null (FAIL guard below)
    // NOTE: fallback to allocatable_qty happens at the DATA LOAD level in NmAtpService,
    // not here — this service only receives the final qty. isAtpNullFallback signals origin.
    const effectiveAtpQty = input.atpQty;

    if (effectiveAtpQty === null || effectiveAtpQty === undefined) {
      // Should not happen after fallback — defensive: treat as FAIL
      return {
        result: 'FAIL',
        reason: 'ZERO_STOCK',
        isAtpNullFallback,
        effectiveAtpQty: null,
      };
    }

    // R2: classify
    if (effectiveAtpQty >= input.requestedQty) {
      return { result: 'PASS', reason: null, isAtpNullFallback, effectiveAtpQty };
    }
    if (effectiveAtpQty > 0) {
      return { result: 'PARTIAL', reason: null, isAtpNullFallback, effectiveAtpQty };
    }
    // effectiveAtpQty === 0
    return { result: 'FAIL', reason: 'ZERO_STOCK', isAtpNullFallback, effectiveAtpQty: 0 };
  }
}
