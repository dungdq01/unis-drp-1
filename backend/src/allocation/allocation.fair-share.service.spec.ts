import { AllocationFairShareService } from './allocation.fair-share.service';

const W = '2026-04-14';

describe('AllocationFairShareService', () => {
  const svc = new AllocationFairShareService();

  it('returns full demand when hub is adequate (US-1)', () => {
    const cells = [
      { cnId: '1', skuId: '10', periodStart: W, netDemand: 100 },
      { cnId: '2', skuId: '10', periodStart: W, netDemand: 200 },
    ];
    const hub = new Map([[`10|${W}`, 500]]);
    const q = svc.compute(cells, hub);
    expect(q.get(`1|10|${W}`)).toBe(100);
    expect(q.get(`2|10|${W}`)).toBe(200);
  });

  it('distributes proportionally when hub is short (US-8)', () => {
    const cells = [
      { cnId: 'DN', skuId: 'X', periodStart: W, netDemand: 500 },
      { cnId: 'BD', skuId: 'X', periodStart: W, netDemand: 400 },
      { cnId: 'CT', skuId: 'X', periodStart: W, netDemand: 300 },
    ];
    const hub = new Map([[`X|${W}`, 600]]);
    const q = svc.compute(cells, hub);
    expect(q.get(`DN|X|${W}`)).toBeCloseTo(250, 1);
    expect(q.get(`BD|X|${W}`)).toBeCloseTo(200, 1);
    expect(q.get(`CT|X|${W}`)).toBeCloseTo(150, 1);
  });

  it('gives 0 when netDemand is 0 or negative', () => {
    const cells = [
      { cnId: '1', skuId: '10', periodStart: W, netDemand: 0 },
      { cnId: '2', skuId: '10', periodStart: W, netDemand: -50 },
    ];
    const q = svc.compute(cells, new Map([[`10|${W}`, 100]]));
    expect(q.get(`1|10|${W}`)).toBe(0);
    expect(q.get(`2|10|${W}`)).toBe(0);
  });

  it('gives 0 when hub has 0 stock for the (sku, week)', () => {
    const cells = [{ cnId: '1', skuId: '10', periodStart: W, netDemand: 100 }];
    const q = svc.compute(cells, new Map());
    expect(q.get(`1|10|${W}`)).toBe(0);
  });

  it('isolates quota per SKU (independent pools)', () => {
    const cells = [
      { cnId: '1', skuId: 'A', periodStart: W, netDemand: 100 },
      { cnId: '1', skuId: 'B', periodStart: W, netDemand: 100 },
    ];
    const hub = new Map([[`A|${W}`, 50], [`B|${W}`, 200]]);
    const q = svc.compute(cells, hub);
    expect(q.get(`1|A|${W}`)).toBe(50);   // capped
    expect(q.get(`1|B|${W}`)).toBe(100);  // full
  });

  it('C1 fix: isolates quota per week — week-N shortfall does not affect week-M', () => {
    const cells = [
      { cnId: '1', skuId: 'X', periodStart: '2026-04-14', netDemand: 100 },
      { cnId: '2', skuId: 'X', periodStart: '2026-04-14', netDemand: 100 },
      { cnId: '1', skuId: 'X', periodStart: '2026-04-21', netDemand: 100 },
    ];
    const hub = new Map([
      [`X|2026-04-14`, 50],   // week 1 hub short
      [`X|2026-04-21`, 500],  // week 2 hub abundant
    ]);
    const q = svc.compute(cells, hub);
    expect(q.get(`1|X|2026-04-14`)).toBeCloseTo(25, 1); // half of 50
    expect(q.get(`2|X|2026-04-14`)).toBeCloseTo(25, 1);
    expect(q.get(`1|X|2026-04-21`)).toBe(100);  // full week-2
  });
});
