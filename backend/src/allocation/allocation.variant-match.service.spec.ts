import { AllocationVariantMatchService } from './allocation.variant-match.service';

describe('AllocationVariantMatchService', () => {
  const svc = new AllocationVariantMatchService();

  it('returns empty breakdown when no variant suggestion', () => {
    const r = svc.match(100, null);
    expect(r.plannerReviewRequired).toBe(false);
    expect(r.variantBreakdown).toEqual({});
  });

  it('distributes allocated qty proportionally to suggestion (US-9 fully covered)', () => {
    // 600 alloc, suggestion {A4: 400, B2: 200} → base matches → no review
    const r = svc.match(600, { A4: 400, B2: 200 });
    expect(r.plannerReviewRequired).toBe(false);
    expect(r.variantBreakdown.A4).toBeCloseTo(400, 1);
    expect(r.variantBreakdown.B2).toBeCloseTo(200, 1);
  });

  it('flags review when base allocation is short of suggestion total (US-9 shortage)', () => {
    // 500 alloc vs suggestion total 600 → short → VARIANT_MISMATCH
    const r = svc.match(500, { A4: 400, B2: 200 });
    expect(r.plannerReviewRequired).toBe(true);
    expect(r.reviewReason).toBe('VARIANT_MISMATCH');
  });

  it('no review flag on rounding-level shortfall (<1 unit)', () => {
    const r = svc.match(599.5, { A4: 400, B2: 200 });
    expect(r.plannerReviewRequired).toBe(false);
  });

  it('handles zero-total suggestion gracefully', () => {
    const r = svc.match(100, { A4: 0, B2: 0 });
    expect(r.plannerReviewRequired).toBe(false);
    expect(r.variantBreakdown).toEqual({});
  });
});
