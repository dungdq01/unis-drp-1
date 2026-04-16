import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  TransportLotSizingService,
  TransportPlanIncompleteException,
} from './transport.lot-sizing.service';
import { TransportMultiDropService } from './transport.multi-drop.service';
import { TransportTopUpService } from './transport.top-up.service';
import { AllocationLcnbService } from '../allocation/allocation.lcnb.service';
import { SystemConfigService } from '../system-config/system-config.service';

function buildDs(overrides: Record<string, unknown> = {}) {
  const ds: Record<string, unknown> = {
    transaction: jest.fn().mockImplementation((cb: (em: unknown) => Promise<unknown>) =>
      cb({ query: (ds as { query: Function }).query }),
    ),
    query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM transport_plan') && sql.includes('allocation_run_id')) return [];
      if (sql.includes('INSERT INTO transport_plan')) return [{ id: '501' }];
      if (sql.includes('FROM policy_run')) return [{ config_snapshot: { 'transport.min_fill_ratio': '0.6' } }];
      if (sql.includes('FROM channel WHERE channel_code LIKE')) return [{ channel_code: 'HUB_HCM' }];
      if (sql.includes('FROM channel')) return [];
      if (sql.includes('FROM sku')) return [];
      if (sql.includes('FROM vehicle_type')) return [{ max_pallets: 20, max_weight_kg: 10000 }];
      if (sql.includes('FROM transport_lane')) return [{ carrier_code: 'VTL', lead_time_days: 1, source_location_code: 'HUB_HCM', dest_location_code: 'BD', distance_km: 50 }];
      if (sql.includes('INSERT INTO transport_trip')) return [{ id: '1001' }];
      if (sql.includes('INSERT INTO transport_trip_stop')) return [{ id: 'S1' }];
      if (sql.includes('INSERT INTO transport_trip_line')) return [];
      if (sql.includes('UPDATE supply_snapshot_line')) return [];
      if (sql.includes('UPDATE transport_plan')) return [];
      if (sql.includes('UPDATE transport_trip')) return [];
      if (sql.includes('SELECT id::text, allocation_run_id::text')) {
        return [{ id: '501', allocation_run_id: '42', policy_run_id: '99', status: 'COMPLETED', created_at: new Date() }];
      }
      if (sql.includes('FROM transport_trip') && sql.includes("NO_CARRIER")) return [];
      if (sql.includes('SELECT id::text, source_location_code')) return [];
      return [];
    }),
    ...overrides,
  };
  return ds;
}

function buildAllocSvc(overrides = {}) {
  return {
    getAllocationResult: jest.fn().mockResolvedValue({
      allocationRunId: '42',
      planRunId: '10',
      policyRunId: '99',
      generatedAt: new Date(),
      results: new Map(),
    }),
    ...overrides,
  };
}

function buildSysCfg(enabled = true) {
  return { isEnabled: jest.fn().mockResolvedValue(enabled) };
}

function buildTopUpSvc(overrides = {}) {
  return {
    generate: jest.fn().mockResolvedValue([]),
    accept: jest.fn(),
    reject: jest.fn(),
    ...overrides,
  };
}

async function build(
  ds = buildDs(),
  allocSvc = buildAllocSvc(),
  sysCfg = buildSysCfg(),
  topUpSvc = buildTopUpSvc(),
): Promise<TransportLotSizingService> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      TransportLotSizingService,
      TransportMultiDropService,
      { provide: getDataSourceToken(), useValue: ds },
      { provide: AllocationLcnbService, useValue: allocSvc },
      { provide: TransportTopUpService, useValue: topUpSvc },
      { provide: SystemConfigService, useValue: sysCfg },
    ],
  }).compile();
  return mod.get(TransportLotSizingService);
}

describe('TransportLotSizingService', () => {
  describe('feature flag', () => {
    it('throws 503 when m25 flag is off', async () => {
      const svc = await build(buildDs(), buildAllocSvc(), buildSysCfg(false));
      await expect(svc.runV2({ allocationRunId: '42' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('idempotent', () => {
    it('throws ConflictException if transport_plan exists without force', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM transport_plan')) return [{ id: '999' }];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(svc.runV2({ allocationRunId: '42' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects short force rerun reason', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM transport_plan')) return [{ id: '999' }];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(
        svc.runV2({ allocationRunId: '42', forceRerunReason: 'too short' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('runV2 happy path', () => {
    it('creates plan and completes with 0 trips when no allocation results', async () => {
      const svc = await build();
      const r = await svc.runV2({ allocationRunId: '42' });
      expect(r.status).toBe('COMPLETED');
      expect(r.totalTrips).toBe(0);
    });

    it('COMPLETED_PARTIAL when no transport_lane carrier found (NO_CARRIER path)', async () => {
      // Provide 1 allocation cell so _buildRawTrips produces 1 raw trip → _persistTrips runs
      const cell = {
        cnId: 'CN1', skuId: 'SKU1', periodStart: '2026-04-21',
        qtyRequired: 100, qtyAllocated: 100,
        status: 'FULL', plannerReviewRequired: false, reviewReason: null,
        legs: [{ legId: 'L1', allocationResultId: 'R1', sourceType: 'HUB', sourceEntityId: 'HUB_VIRTUAL',
                  sourceLotId: null, allocatedQty: 100, fifoRank: null, distanceKm: null }],
        variantBreakdown: {}, isTopUp: false, sourceTopUpId: null, sourcePeriodStart: null,
      };
      const allocSvc = buildAllocSvc({
        getAllocationResult: jest.fn().mockResolvedValue({
          allocationRunId: '42', planRunId: '10', policyRunId: '99',
          generatedAt: new Date(),
          results: new Map([['CN1|SKU1|2026-04-21', cell]]),
        }),
      });
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM transport_plan') && sql.includes('allocation_run_id')) return [];
          if (sql.includes('INSERT INTO transport_plan')) return [{ id: '501' }];
          if (sql.includes('FROM policy_run')) return [{ config_snapshot: { 'transport.min_fill_ratio': '0.6' } }];
          if (sql.includes('FROM channel WHERE channel_code LIKE')) return [{ channel_code: 'HUB_HCM' }];
          if (sql.includes('FROM channel')) return [{ id: 'CN1', channel_code: 'STORE_A' }];
          if (sql.includes('FROM sku')) return [{ id: 'SKU1', sku_code: 'PROD-A', weight_kg: 10, pallet_size: 10 }];
          if (sql.includes('FROM vehicle_type')) return [{ max_pallets: 20, max_weight_kg: 10000 }];
          if (sql.includes('FROM transport_lane') && sql.includes('carrier_code')) return []; // no carrier → NO_CARRIER
          if (sql.includes('FROM transport_lane')) return [{ source: 'HUB_HCM', dest: 'STORE_A', distance_km: 50, source_location_code: 'HUB_HCM', dest_location_code: 'STORE_A' }];
          if (sql.includes('INSERT INTO transport_trip')) return [{ id: '1001' }];
          if (sql.includes('INSERT INTO transport_trip_line')) return [];
          if (sql.includes('UPDATE supply_snapshot_line')) return [];
          if (sql.includes('UPDATE transport_plan')) return [];
          if (sql.includes('FROM system_config')) return [];
          return [];
        }),
      });
      const svc = await build(ds, allocSvc);
      const r = await svc.runV2({ allocationRunId: '42' });
      expect(r.status).toBe('COMPLETED_PARTIAL');
      expect(r.totalTrips).toBe(1);
    });
  });

  describe('getTransportPlan (H5 precedence)', () => {
    it('throws NOT_COMPLETED when plan is RUNNING', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id::text, allocation_run_id::text'))
            return [{ id: '501', allocation_run_id: '42', policy_run_id: '99', status: 'RUNNING', created_at: new Date() }];
          return [];
        }),
      });
      const svc = await build(ds);
      try {
        await svc.getTransportPlan('501');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(TransportPlanIncompleteException);
        expect((err as TransportPlanIncompleteException).reasons[0].code).toBe('NOT_COMPLETED');
      }
    });

    it('throws NO_CARRIER when plan has NO_CARRIER trip (C6)', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id::text, allocation_run_id::text'))
            return [{ id: '501', allocation_run_id: '42', policy_run_id: '99', status: 'COMPLETED_PARTIAL', created_at: new Date() }];
          if (sql.includes('FROM transport_trip') && sql.includes("NO_CARRIER")) {
            return [{ id: '1001' }];
          }
          return [];
        }),
      });
      const svc = await build(ds);
      try {
        await svc.getTransportPlan('501');
        fail('should throw');
      } catch (err) {
        expect((err as TransportPlanIncompleteException).reasons[0].code).toBe('NO_CARRIER');
      }
    });

    it('NOT_COMPLETED precedence wins over NO_CARRIER', async () => {
      // Plan is DRAFT + has NO_CARRIER trips → should throw NOT_COMPLETED first
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id::text, allocation_run_id::text'))
            return [{ id: '501', allocation_run_id: '42', policy_run_id: '99', status: 'DRAFT', created_at: new Date() }];
          if (sql.includes("NO_CARRIER")) return [{ id: '1001' }];
          return [];
        }),
      });
      const svc = await build(ds);
      try {
        await svc.getTransportPlan('501');
        fail('should throw');
      } catch (err) {
        expect((err as TransportPlanIncompleteException).reasons[0].code).toBe('NOT_COMPLETED');
      }
    });

    it('throws NotFound for unknown plan', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id::text, allocation_run_id::text')) return [];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(svc.getTransportPlan('999')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('extendHold (H4 hard cap)', () => {
    it('rejects 409 when hold already at hard cap', async () => {
      const heldAt = new Date(Date.now() - 2 * 86_400_000); // 2 days ago
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT held_at, hold_until_date')) {
            const capIso = new Date(heldAt.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
            return [{ held_at: heldAt, hold_until_date: capIso, status: 'HELD' }];
          }
          if (sql.includes('SELECT config_value FROM system_config')) return [{ config_value: '2' }];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(svc.extendHold('1001', 1, 'user')).rejects.toBeInstanceOf(ConflictException);
    });

    it('extends when within cap', async () => {
      const heldAt = new Date(Date.now() - 86_400_000); // 1 day ago
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT held_at, hold_until_date')) {
            const currentIso = new Date(heldAt.getTime()).toISOString().slice(0, 10);
            return [{ held_at: heldAt, hold_until_date: currentIso, status: 'HELD' }];
          }
          if (sql.includes('SELECT config_value FROM system_config')) return [{ config_value: '2' }];
          return [];
        }),
      });
      const svc = await build(ds);
      const r = await svc.extendHold('1001', 1, 'user');
      expect(r.newHoldUntil).toBeDefined();
    });

    it('rejects extend on non-HELD trip', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT held_at, hold_until_date')) {
            return [{ held_at: null, hold_until_date: null, status: 'PLANNED' }];
          }
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(svc.extendHold('1001', 1, 'user')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cancelTrip', () => {
    it('rejects short reason', async () => {
      const svc = await build();
      await expect(svc.cancelTrip('1001', 'short', 'user')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when trip already DISPATCHED/DELIVERED', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT status FROM transport_trip')) return [{ status: 'DISPATCHED' }];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(
        svc.cancelTrip('1001', 'cancel reason with more than twenty characters', 'user'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('runHeldRelease cron (R10)', () => {
    it('releases trips where fill >= minFill', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM policy_run')) return [];
          if (sql.includes("config_key LIKE 'transport.%'")) {
            return [
              { config_key: 'transport.min_fill_ratio', config_value: '0.6' },
              { config_key: 'transport.hold_max_days',  config_value: '2' },
            ];
          }
          if (sql.includes(`status = 'HELD'`)) {
            return [{ id: '1001', fill_ratio: 0.7, held_at: new Date(), hold_until_date: '2026-04-18' }];
          }
          return [];
        }),
      });
      const svc = await build(ds);
      const r = await svc.runHeldRelease();
      expect(r.released).toBe(1);
      expect(r.forced).toBe(0);
    });

    it('force ships trips past hold_max_days', async () => {
      const oldHeld = new Date(Date.now() - 3 * 86_400_000); // 3 days ago
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM policy_run')) return [];
          if (sql.includes(`config_key LIKE 'transport.%'`)) {
            return [
              { config_key: 'transport.min_fill_ratio', config_value: '0.6' },
              { config_key: 'transport.hold_max_days',  config_value: '2' },
            ];
          }
          if (sql.includes(`status = 'HELD'`)) {
            return [{ id: '1001', fill_ratio: 0.4, held_at: oldHeld, hold_until_date: '2026-04-16' }];
          }
          return [];
        }),
      });
      const svc = await build(ds);
      const r = await svc.runHeldRelease();
      expect(r.forced).toBe(1);
    });
  });
});
