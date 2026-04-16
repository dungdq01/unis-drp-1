/**
 * order.service.spec.ts
 * Unit tests for BUG-03: createBatch transaction safety + idempotency
 *
 * Strategy: mock dataSource.transaction / dataSource.query / batchRepo
 * để kiểm tra:
 *  1. Rollback toàn bộ nếu line insert throw
 *  2. Trả cache khi idempotency_key đã tồn tại
 *  3. _saveIdempotency được gọi sau khi createBatch thành công
 *  4. Console.warn khi M7_TRANSACTION_SAFE=false
 */

import { NotFoundException, ConflictException } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderBatchDto } from './dto';

// ── Fake entity stubs ─────────────────────────────────────────────────────────

class FakeOrderBatch {
  id = 'batch-uuid-001';
  transportPlanId: string;
  batchCode = 'TO-202604-0001';
  status = 'DRAFT';
  createdBy: string | null = null;
  note: string | null = null;
  totalLines = 0;
  totalQty = 0;
  totalValueVnd = 0;
}

// ── Builder: mock dataSource ──────────────────────────────────────────────────

interface MockDataSourceOptions {
  transportPlanStatus?: string;           // default 'CONFIRMED'
  existingBatch?: FakeOrderBatch | null;  // default null
  tripLines?: any[];                      // default 1 line
  idempotencyRow?: any | null;            // default null = no cached result
  transactionShouldFail?: boolean;        // default false
  failOnLineInsert?: boolean;             // throw inside em.save(OrderLine, ...)
}

function buildMockDataSource(opts: MockDataSourceOptions = {}) {
  const {
    transportPlanStatus = 'CONFIRMED',
    tripLines = [
      {
        tripLineId: '1', tripId: '10', allocationResultId: '100',
        itemCode: 'TILE-60x60', itemName: 'Tile 60x60', baseUom: 'M2',
        qty: 500, sourceLocationCode: 'WH-HCM', destLocationCode: 'BRANCH-HCM',
        departureDate: '2026-05-01', etaDate: '2026-05-03', carrierCode: 'CARRIER-A',
      },
    ],
    idempotencyRow = null,
    transactionShouldFail = false,
    failOnLineInsert = false,
  } = opts;

  let transactionCallCount = 0;

  const em = {
    query: jest.fn().mockResolvedValue([{ last_seq: 1 }]),
    create: jest.fn().mockImplementation((_cls: any, data: any) => Object.assign(new FakeOrderBatch(), data)),
    save: jest.fn().mockImplementation(async (EntityClass: any, data: any) => {
      // Nếu failOnLineInsert và đây là mảng (tức là line chunk) → throw
      if (failOnLineInsert && Array.isArray(data)) {
        throw new Error('Simulated line insert failure');
      }
      if (Array.isArray(data)) return data;
      const saved = Object.assign(new FakeOrderBatch(), data);
      saved.id = 'batch-uuid-001';
      return saved;
    }),
    update: jest.fn().mockResolvedValue(undefined),
  };

  const ds = {
    query: jest.fn().mockImplementation(async (sql: string, params?: any[]) => {
      // transport_plan status check
      if (sql.includes('transport_plan') && sql.includes('status')) {
        return [{ status: transportPlanStatus }];
      }
      // trip lines load
      if (sql.includes('transport_trip_line')) {
        return tripLines;
      }
      // idempotency check
      if (sql.includes('idempotency_log') && sql.includes('SELECT')) {
        return idempotencyRow ? [{ result_json: idempotencyRow }] : [];
      }
      // idempotency save (INSERT INTO idempotency_log)
      if (sql.includes('idempotency_log') && sql.includes('INSERT')) {
        return [];
      }
      return [];
    }),

    transaction: jest.fn().mockImplementation(async (cb: (em: any) => Promise<any>) => {
      transactionCallCount++;
      if (transactionShouldFail) {
        throw new Error('Simulated transaction failure');
      }
      return cb(em);
    }),

    _em: em,
    get transactionCallCount() { return transactionCallCount; },
  };

  return ds as any;
}

// ── batchRepo mock ────────────────────────────────────────────────────────────

function buildBatchRepo(existingBatch: FakeOrderBatch | null = null) {
  const savedBatch = new FakeOrderBatch();
  let callCount = 0;
  return {
    // 1st call = duplicate check (returns existingBatch or null)
    // 2nd call = post-transaction reload (returns savedBatch)
    findOne: jest.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return existingBatch;   // duplicate check
      return savedBatch;                           // post-tx reload
    }),
    save: jest.fn().mockImplementation(async (b: any) => b),
    update: jest.fn().mockResolvedValue(undefined),
    count: jest.fn().mockResolvedValue(1),
    createQueryBuilder: jest.fn(),
  };
}

function buildLineRepo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (l: any) => l),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn(),
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

function buildService(dataSource: any, batchRepo?: any, lineRepo?: any) {
  return new OrderService(
    batchRepo ?? (buildBatchRepo() as any),
    lineRepo ?? (buildLineRepo() as any),
    dataSource,
  );
}

function makeCreateDto(overrides: Partial<CreateOrderBatchDto> = {}): CreateOrderBatchDto {
  return { transportPlanId: 'plan-001', createdBy: 'tester', ...overrides } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('createBatch transaction safety (BUG-03)', () => {

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.M7_TRANSACTION_SAFE;
  });

  // ── Test 1: Rollback ──────────────────────────────────────────────────────

  it('should rollback entire transaction if line insert fails', async () => {
    const dataSource = buildMockDataSource({ failOnLineInsert: true });

    // Khi batchRepo.findOne gọi sau createBatch (post-tx load) → ta cần nó throw/return null
    // thay vì mock existing batch check = null (để không bị reject trước)
    const batchRepo = buildBatchRepo(null); // no duplicate → passes pre-check
    // Override findOne: lần 1 = null (duplicate check), lần 2 = error sẽ không đến

    const service = buildService(dataSource, batchRepo);

    // Service sẽ throw vì em.save(OrderLine, chunk) throw
    await expect(service.createBatch(makeCreateDto())).rejects.toThrow('Simulated line insert failure');

    // Transaction được gọi 1 lần (và failed bên trong)
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);

    // batchRepo.save không được gọi vì entity save là qua em, không phải repo trực tiếp
    // EM save cho header được gọi, nhưng whole tx rolled back → final batchRepo.findOne
    // (post-tx reload) sẽ không được gọi
  });

  it('should throw ConflictException if transport_plan is not CONFIRMED', async () => {
    const dataSource = buildMockDataSource({ transportPlanStatus: 'DRAFT' });
    const batchRepo = buildBatchRepo(null);
    const service = buildService(dataSource, batchRepo);

    await expect(service.createBatch(makeCreateDto())).rejects.toThrow(ConflictException);
    // Transaction không được gọi vì reject trước khi enter tx
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  // ── Test 2: Idempotency cache hit ─────────────────────────────────────────

  it('should return cached result for duplicate idempotency_key', async () => {
    const cachedBatch = new FakeOrderBatch();
    cachedBatch.id = 'cached-batch-001';
    cachedBatch.batchCode = 'TO-CACHED';

    const dataSource = buildMockDataSource({ idempotencyRow: cachedBatch });
    const batchRepo = buildBatchRepo(null);
    const service = buildService(dataSource, batchRepo);

    const result = await service.createBatch(makeCreateDto(), 'idem-key-abc123');

    // Kết quả = cached batch
    expect(result).toMatchObject({ id: 'cached-batch-001' });

    // Không vào transaction (early return)
    expect(dataSource.transaction).not.toHaveBeenCalled();

    // batchRepo.findOne KHÔNG được gọi cho duplicate check (đã short-circuit)
    expect(batchRepo.findOne).not.toHaveBeenCalled();
  });

  // ── Test 3: _saveIdempotency called after success ─────────────────────────

  it('should save idempotency cache after successful createBatch', async () => {
    const dataSource = buildMockDataSource({ idempotencyRow: null });
    const batchRepo = buildBatchRepo(null);
    const service = buildService(dataSource, batchRepo);

    // Spy on private _saveIdempotency via bracket notation
    const saveSpy = jest.spyOn(service as any, '_saveIdempotency');

    await service.createBatch(makeCreateDto(), 'idem-key-new-001');

    // _saveIdempotency phải được gọi với đúng key + endpoint
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      'idem-key-new-001',
      'POST /orders/batches',
      expect.any(Object),
    );
  });

  it('should NOT save idempotency when no idempotencyKey provided', async () => {
    const dataSource = buildMockDataSource({ idempotencyRow: null });
    const batchRepo = buildBatchRepo(null);
    const service = buildService(dataSource, batchRepo);

    const saveSpy = jest.spyOn(service as any, '_saveIdempotency');

    await service.createBatch(makeCreateDto()); // no key

    expect(saveSpy).not.toHaveBeenCalled();
  });

  // ── Test 4: Console.warn khi M7_TRANSACTION_SAFE=false ───────────────────

  it('should log warning when M7_TRANSACTION_SAFE=false', async () => {
    process.env.M7_TRANSACTION_SAFE = 'false';

    const dataSource = buildMockDataSource({ idempotencyRow: null });
    const batchRepo = buildBatchRepo(null);
    const service = buildService(dataSource, batchRepo);

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await service.createBatch(makeCreateDto());

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[BUG-03]'),
    );

    consoleSpy.mockRestore();
    delete process.env.M7_TRANSACTION_SAFE;
  });

  it('should NOT log warning when M7_TRANSACTION_SAFE=true (default)', async () => {
    process.env.M7_TRANSACTION_SAFE = 'true';

    const dataSource = buildMockDataSource({ idempotencyRow: null });
    const batchRepo = buildBatchRepo(null);
    const service = buildService(dataSource, batchRepo);

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await service.createBatch(makeCreateDto());

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  // ── Test 5: Duplicate batch (transport plan already has a batch) ──────────

  it('should throw ConflictException when batch already exists for transport plan', async () => {
    const dataSource = buildMockDataSource();
    // batchRepo.findOne trả về existing batch → duplicate check fails
    const existingBatch = new FakeOrderBatch();
    existingBatch.id = 'existing-001';
    existingBatch.batchCode = 'TO-EXISTING';
    const batchRepo = buildBatchRepo(existingBatch);

    const service = buildService(dataSource, batchRepo);

    await expect(service.createBatch(makeCreateDto())).rejects.toThrow(ConflictException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

});
