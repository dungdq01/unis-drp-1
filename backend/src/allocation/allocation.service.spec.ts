/**
 * allocation.service.spec.ts
 * Unit tests for BUG-02: allocation legs (per-source breakdown)
 *
 * Strategy: test _allocate() logic indirectly by feeding controlled
 * rtmMap / supplyMap / ssMap and asserting the `legs` array on the Decision.
 *
 * Because _allocate() is private, we expose its behavior through a thin
 * test subclass (TS allows protected override for testing patterns).
 */

import { AllocationService } from './allocation.service';

// ── Type aliases (mirror private types in service) ────────────────────────────

interface DemandLine {
  porId: string;
  itemCode: string;
  destLocationCode: string;
  qtyRequired: number;
  weekNumber: number;
  abcClass: 'A' | 'B' | 'C';
}

interface RtmRule {
  sourceLocationCode: string;
  priority: number;
}

interface DecisionLeg {
  sourceType: string;
  sourceLocationCode: string;
  qty: number;
  priority: number;
}

interface Decision {
  porId: string;
  itemCode: string;
  sourceLocationCode: string;
  destLocationCode: string;
  qtyRequired: number;
  qtyAllocated: number;
  abcClass: 'A' | 'B' | 'C';
  sourcePriority: number;
  weekNumber: number;
  layerTrace: Record<string, unknown>;
  legs: DecisionLeg[];
}

// ── Test-visible subclass ─────────────────────────────────────────────────────
// Expose private _allocate() method for unit testing

class TestableAllocationService extends AllocationService {
  public testAllocate(
    demand: DemandLine,
    rtmMap: Map<string, RtmRule[]>,
    supplyMap: Map<string, { qty: number }>,
    ssMap: Map<string, number>,
    dispatchUsage: Map<string, number>,
    dispatchLimit: number,
  ): Decision {
    // Access private method via bracket notation (TypeScript test pattern)
    return (this as any)._allocate(demand, rtmMap, supplyMap, ssMap, dispatchUsage, dispatchLimit);
  }
}

// ── Mock deps for constructor ─────────────────────────────────────────────────

function buildService(): TestableAllocationService {
  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
    findAndCount: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const mockDataSource = {
    query: jest.fn(),
    transaction: jest.fn(),
  };

  return new TestableAllocationService(
    mockRepo as any,  // runRepo
    mockRepo as any,  // resultRepo
    mockRepo as any,  // legRepo
    mockRepo as any,  // recRepo
    mockDataSource as any,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDemand(overrides: Partial<DemandLine> = {}): DemandLine {
  return {
    porId: 'por-001',
    itemCode: 'TILE-60x60',
    destLocationCode: 'BRANCH-HCM',
    qtyRequired: 100,
    weekNumber: 1,
    abcClass: 'A',
    ...overrides,
  };
}

function makeRtmMap(rules: { sourceLocationCode: string; priority: number }[], destLoc = 'BRANCH-HCM') {
  return new Map<string, RtmRule[]>([[destLoc, rules]]);
}

function makeSupplyMap(entries: { itemCode: string; locationCode: string; qty: number }[]) {
  const map = new Map<string, { qty: number }>();
  for (const e of entries) {
    map.set(`${e.itemCode}||${e.locationCode}`, { qty: e.qty });
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('allocation legs (BUG-02)', () => {
  let service: TestableAllocationService;

  beforeEach(() => {
    service = buildService();
  });

  it('should create 1 leg when demand fulfilled from 1 source', () => {
    const demand = makeDemand({ qtyRequired: 100 });
    const rtmMap = makeRtmMap([{ sourceLocationCode: 'WH-HCM', priority: 1 }]);
    const supplyMap = makeSupplyMap([{ itemCode: 'TILE-60x60', locationCode: 'WH-HCM', qty: 200 }]);
    const ssMap = new Map<string, number>();
    const dispatchUsage = new Map<string, number>();

    const decision = service.testAllocate(demand, rtmMap, supplyMap, ssMap, dispatchUsage, 9999);

    expect(decision.legs).toHaveLength(1);
    expect(decision.legs[0].qty).toBe(100);
    expect(decision.legs[0].sourceLocationCode).toBe('WH-HCM');
    expect(decision.qtyAllocated).toBe(100);
  });

  it('should create 2 legs when demand partially filled from 2 sources', () => {
    const demand = makeDemand({ qtyRequired: 150 });
    const rtmMap = makeRtmMap([
      { sourceLocationCode: 'WH-HCM', priority: 1 },
      { sourceLocationCode: 'WH-DN',  priority: 2 },
    ]);
    // WH-HCM chỉ có 80, WH-DN có 100 → cần lấy từ cả 2
    const supplyMap = makeSupplyMap([
      { itemCode: 'TILE-60x60', locationCode: 'WH-HCM', qty: 80 },
      { itemCode: 'TILE-60x60', locationCode: 'WH-DN',  qty: 100 },
    ]);
    const ssMap = new Map<string, number>();
    const dispatchUsage = new Map<string, number>();

    const decision = service.testAllocate(demand, rtmMap, supplyMap, ssMap, dispatchUsage, 9999);

    expect(decision.legs).toHaveLength(2);
    expect(decision.legs[0].sourceLocationCode).toBe('WH-HCM');
    expect(decision.legs[0].qty).toBe(80);
    expect(decision.legs[1].sourceLocationCode).toBe('WH-DN');
    expect(decision.legs[1].qty).toBe(70); // 150 - 80 = 70
    expect(decision.qtyAllocated).toBe(150);
  });

  it('should set sourceType=HUB on all legs (Phase 1)', () => {
    const demand = makeDemand({ qtyRequired: 200 });
    const rtmMap = makeRtmMap([
      { sourceLocationCode: 'WH-HCM', priority: 1 },
      { sourceLocationCode: 'WH-HN',  priority: 2 },
    ]);
    const supplyMap = makeSupplyMap([
      { itemCode: 'TILE-60x60', locationCode: 'WH-HCM', qty: 100 },
      { itemCode: 'TILE-60x60', locationCode: 'WH-HN',  qty: 100 },
    ]);
    const ssMap = new Map<string, number>();
    const dispatchUsage = new Map<string, number>();

    const decision = service.testAllocate(demand, rtmMap, supplyMap, ssMap, dispatchUsage, 9999);

    // Phase 1 spec: tất cả legs đều là HUB
    expect(decision.legs.length).toBeGreaterThan(0);
    for (const leg of decision.legs) {
      expect(leg.sourceType).toBe('HUB');
    }
  });

  it('should create 0 legs for UNALLOCATED demand (no RTM rule)', () => {
    const demand = makeDemand({ destLocationCode: 'BRANCH-CT' }); // no RTM rule for CT
    const rtmMap = makeRtmMap([{ sourceLocationCode: 'WH-HCM', priority: 1 }]); // rule only for BRANCH-HCM
    const supplyMap = makeSupplyMap([
      { itemCode: 'TILE-60x60', locationCode: 'WH-HCM', qty: 500 },
    ]);
    const ssMap = new Map<string, number>();
    const dispatchUsage = new Map<string, number>();

    const decision = service.testAllocate(demand, rtmMap, supplyMap, ssMap, dispatchUsage, 9999);

    expect(decision.legs).toHaveLength(0);
    expect(decision.qtyAllocated).toBe(0);
  });

  it('should create 0 legs for UNALLOCATED demand (all sources SS-blocked)', () => {
    const demand = makeDemand({ qtyRequired: 50 });
    const rtmMap = makeRtmMap([{ sourceLocationCode: 'WH-HCM', priority: 1 }]);
    // Supply = 100, SS = 100 → available = 0
    const supplyMap = makeSupplyMap([{ itemCode: 'TILE-60x60', locationCode: 'WH-HCM', qty: 100 }]);
    const ssMap = new Map([['TILE-60x60||WH-HCM', 100]]); // full SS block
    const dispatchUsage = new Map<string, number>();

    const decision = service.testAllocate(demand, rtmMap, supplyMap, ssMap, dispatchUsage, 9999);

    expect(decision.legs).toHaveLength(0);
    expect(decision.qtyAllocated).toBe(0);
  });

  it('should consume supply correctly when multiple demands use same source', () => {
    // Simulate shared supplyMap across 2 demands (như _runEngine làm)
    const rtmMap = makeRtmMap([{ sourceLocationCode: 'WH-HCM', priority: 1 }]);
    const supplyMap = makeSupplyMap([{ itemCode: 'TILE-60x60', locationCode: 'WH-HCM', qty: 120 }]);
    const ssMap = new Map<string, number>();
    const dispatchUsage = new Map<string, number>();

    const d1 = makeDemand({ porId: 'por-001', qtyRequired: 80 });
    const d2 = makeDemand({ porId: 'por-002', qtyRequired: 80 });

    const dec1 = service.testAllocate(d1, rtmMap, supplyMap, ssMap, dispatchUsage, 9999);
    const dec2 = service.testAllocate(d2, rtmMap, supplyMap, ssMap, dispatchUsage, 9999);

    // d1 lấy hết 80, d2 chỉ còn 40
    expect(dec1.qtyAllocated).toBe(80);
    expect(dec2.qtyAllocated).toBe(40);
    expect(dec1.legs[0].qty).toBe(80);
    expect(dec2.legs[0].qty).toBe(40);
  });

});
