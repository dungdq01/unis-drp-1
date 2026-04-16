/**
 * supply.service.spec.ts
 * Unit tests for BUG-01: is_estimated flag on captureSnapshot()
 *
 * Strategy: mock dataSource.query to return fake lot_attribute aggregated rows
 * (kết quả của BOOL_OR(source_type = 'DISTRIBUTION')), then assert that:
 *  - isEstimated is correctly propagated to each SupplySnapshotLine
 *  - estimatedLinesCount on snapshot header reflects the correct count
 */

import { BadRequestException } from '@nestjs/common';
import { SupplyService } from './supply.service';

// ── Minimal entity stubs ──────────────────────────────────────────────────────

class FakeSnapshotLine {
  snapshotId: string;
  itemCode: string;
  locationCode: string;
  allocatableQty: number;
  reservedQty: number;
  quarantineQty: number;
  inTransitQty: number;
  oldestSyncAt: Date | null;
  freshness: string;
  isEstimated: boolean;
}

class FakeSnapshot {
  id = 'snap-uuid-001';
  snapshotName: string;
  status = 'DRAFT';
  freshness = 'PASS';
  freshnessAgeMinutes = 0;
  totalLines = 0;
  totalItems = 0;
  totalLocations = 0;
  totalAllocatableQty = 0;
  totalReservedQty = 0;
  totalInTransitQty = 0;
  estimatedLinesCount = 0;
  staleAcknowledged = false;
  captureAt: Date;
}

// ── Factory: build a mock DataSource ─────────────────────────────────────────

function buildMockDataSource(aggregatedRows: any[], savedSnapshotId = 'snap-uuid-001') {
  const savedLines: FakeSnapshotLine[] = [];

  const em = {
    create: jest.fn().mockImplementation((EntityClass: any, data: any) => {
      const instance = new EntityClass();
      Object.assign(instance, data);
      return instance;
    }),
    save: jest.fn().mockImplementation(async (EntityClass: any, entityOrArray: any) => {
      if (Array.isArray(entityOrArray)) {
        savedLines.push(...entityOrArray);
        return entityOrArray;
      }
      // Save snapshot header — return with id
      const snap = entityOrArray as FakeSnapshot;
      snap.id = savedSnapshotId;
      return snap;
    }),
  };

  const dataSource = {
    query: jest.fn().mockResolvedValueOnce(aggregatedRows), // first call = lot_attribute aggregate
    transaction: jest.fn().mockImplementation(async (cb: (em: any) => Promise<any>) => {
      return cb(em);
    }),
    _em: em,       // expose for assertions
    _lines: savedLines,
  };

  return dataSource as any;
}

// ── snapshotRepo stub ─────────────────────────────────────────────────────────

function buildSnapshotRepo(returnedSnap: Partial<FakeSnapshot> = {}) {
  const snap = Object.assign(new FakeSnapshot(), returnedSnap);
  return {
    findOne: jest.fn().mockResolvedValue(snap),
    find: jest.fn().mockResolvedValue([snap]),
    save: jest.fn().mockImplementation(async (s: any) => s),
  };
}

// ── lineRepo stub ─────────────────────────────────────────────────────────────

function buildLineRepo() {
  return {
    findOne: jest.fn(),
    save: jest.fn().mockImplementation(async (l: any) => l),
    createQueryBuilder: jest.fn(),
  };
}

// ── lotRepo stub ──────────────────────────────────────────────────────────────

function buildLotRepo() {
  return {};
}

// ── Helper: build SupplyService with mocked deps ──────────────────────────────

function buildService(dataSource: any, snapshotRepo?: any, lineRepo?: any) {
  return new SupplyService(
    snapshotRepo ?? (buildSnapshotRepo() as any),
    lineRepo ?? (buildLineRepo() as any),
    buildLotRepo() as any,
    dataSource,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('captureSnapshot - is_estimated flag (BUG-01)', () => {

  it('should set isEstimated=false when source_type=OEM only', async () => {
    const aggregated = [
      {
        item_code: 'ITEM-A',
        location_code: 'WH-01',
        allocatable_qty: '100.00',
        reserved_qty: '0.00',
        quarantine_qty: '0.00',
        in_transit_qty: '0.00',
        oldest_sync_at: new Date(),
        is_estimated: false, // BOOL_OR(source_type='DISTRIBUTION') = false khi chỉ có OEM
      },
    ];

    const dataSource = buildMockDataSource(aggregated);
    const service = buildService(dataSource);

    const result = await service.captureSnapshot({ snapshotName: 'Test OEM' });

    // Verify line saved with isEstimated = false
    const savedLines = dataSource._lines as FakeSnapshotLine[];
    expect(savedLines.length).toBe(1);
    expect(savedLines[0].isEstimated).toBe(false);

    // Verify snapshot estimatedLinesCount = 0
    const emSave = dataSource._em.save as jest.Mock;
    const snapSavedArg = emSave.mock.calls.find(
      (call: any[]) => !Array.isArray(call[1]) && call[1]?.estimatedLinesCount !== undefined
    );
    expect(snapSavedArg).toBeTruthy();
    expect(snapSavedArg[1].estimatedLinesCount).toBe(0);
  });

  it('should set isEstimated=true when source_type=DISTRIBUTION', async () => {
    const aggregated = [
      {
        item_code: 'ITEM-B',
        location_code: 'WH-02',
        allocatable_qty: '50.00',
        reserved_qty: '10.00',
        quarantine_qty: '0.00',
        in_transit_qty: '5.00',
        oldest_sync_at: new Date(),
        is_estimated: true, // BOOL_OR = true khi có ít nhất 1 DISTRIBUTION lot
      },
    ];

    const dataSource = buildMockDataSource(aggregated);
    const service = buildService(dataSource);

    await service.captureSnapshot({ snapshotName: 'Test DIST' });

    const savedLines = dataSource._lines as FakeSnapshotLine[];
    expect(savedLines.length).toBe(1);
    expect(savedLines[0].isEstimated).toBe(true);
  });

  it('should set isEstimated=true when mixed OEM+DISTRIBUTION in same item/location', async () => {
    // Sau khi GROUP BY, BOOL_OR sẽ = true nếu bất kỳ lot nào là DISTRIBUTION
    const aggregated = [
      {
        item_code: 'ITEM-C',
        location_code: 'WH-03',
        allocatable_qty: '200.00',
        reserved_qty: '20.00',
        quarantine_qty: '5.00',
        in_transit_qty: '0.00',
        oldest_sync_at: new Date(),
        is_estimated: true, // mixed: OEM lot + DISTRIBUTION lot → BOOL_OR = true
      },
    ];

    const dataSource = buildMockDataSource(aggregated);
    const service = buildService(dataSource);

    await service.captureSnapshot({ snapshotName: 'Test Mixed' });

    const savedLines = dataSource._lines as FakeSnapshotLine[];
    expect(savedLines[0].isEstimated).toBe(true);
  });

  it('should set estimatedLinesCount correctly on snapshot header', async () => {
    // 3 lines: 2 OEM, 1 DISTRIBUTION
    const aggregated = [
      {
        item_code: 'ITEM-D', location_code: 'WH-01',
        allocatable_qty: '100.00', reserved_qty: '0.00',
        quarantine_qty: '0.00', in_transit_qty: '0.00',
        oldest_sync_at: new Date(), is_estimated: false,
      },
      {
        item_code: 'ITEM-D', location_code: 'WH-02',
        allocatable_qty: '80.00', reserved_qty: '0.00',
        quarantine_qty: '0.00', in_transit_qty: '0.00',
        oldest_sync_at: new Date(), is_estimated: false,
      },
      {
        item_code: 'ITEM-D', location_code: 'WH-03',
        allocatable_qty: '60.00', reserved_qty: '0.00',
        quarantine_qty: '0.00', in_transit_qty: '0.00',
        oldest_sync_at: new Date(), is_estimated: true, // 1 DISTRIBUTION line
      },
    ];

    const dataSource = buildMockDataSource(aggregated);
    const service = buildService(dataSource);

    await service.captureSnapshot({ snapshotName: 'Test Count' });

    const emSave = dataSource._em.save as jest.Mock;
    // Tìm call save snapshot header (object, not array)
    const snapCall = emSave.mock.calls.find(
      (call: any[]) => !Array.isArray(call[1]) && call[1]?.estimatedLinesCount !== undefined
    );
    expect(snapCall).toBeTruthy();
    expect(snapCall[1].estimatedLinesCount).toBe(1); // chỉ 1 line có is_estimated=true
    expect(snapCall[1].totalLines).toBe(3);
  });

  it('should throw BadRequestException when no allocatable records found', async () => {
    const dataSource = buildMockDataSource([]); // empty result
    const service = buildService(dataSource);

    await expect(service.captureSnapshot({ snapshotName: 'Empty' }))
      .rejects.toThrow(BadRequestException);
  });

});
