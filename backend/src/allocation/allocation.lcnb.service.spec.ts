import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException, ServiceUnavailableException, BadRequestException } from '@nestjs/common';
import {
  AllocationLcnbService,
  AllocationRunNotCompletedException,
} from './allocation.lcnb.service';
import { AllocationFairShareService } from './allocation.fair-share.service';
import { AllocationVariantMatchService } from './allocation.variant-match.service';
import { DrpNettingV2Service, DrpResultDto, DrpCellDto } from '../drp/drp.netting-v2.service';
import { SystemConfigService } from '../system-config/system-config.service';

// ─── Fixtures ───────────────────────────────────────────────────────────────

function buildCell(p: Partial<DrpCellDto>): DrpCellDto {
  return {
    cnId: '1', skuId: '10', periodStart: '2026-04-14',
    effectiveDemand: 100, effectiveDemandSource: 'FC_RAW',
    onHand: 0, inTransit: 0, ssFinal: 0,
    netDemand: 100, status: 'NORMAL',
    variantSuggestion: null,
    plannerReviewRequired: false, reviewReason: null,
    ...p,
  };
}

function buildDrp(lines: DrpCellDto[]): DrpResultDto {
  const map = new Map<string, DrpCellDto>();
  for (const l of lines) map.set(`${l.cnId}|${l.skuId}|${l.periodStart}`, l);
  return { planRunId: '42', policyRunId: '99', generatedAt: new Date(), lines: map };
}

function buildDs(overrides: Record<string, unknown> = {}) {
  const insertedResultIds = { i: 1 };
  const ds: Record<string, unknown> = {
    transaction: jest.fn().mockImplementation((cb: (em: unknown) => Promise<unknown>) =>
      cb({ query: (ds as { query: Function }).query }),
    ),
    query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM allocation_run')) return [];
      if (sql.includes('SELECT pr.policy_run_id'))
        return [{ policy_run_id: '99', config_snapshot: { 'lcnb.enabled': 'true', 'lcnb.max_distance_km': '500' } }];
      if (sql.includes('INSERT INTO allocation_run')) return [{ id: '1001' }];
      if (sql.includes('transport_lane')) return [];
      if (sql.includes('INSERT INTO allocation_result')) return [];
      // Natural-key lookup after INSERT (M1 fix)
      if (sql.includes('SELECT id::text, cn_id::text, sku_id::text, period_start::text')) {
        return [{ id: String(insertedResultIds.i++), cn_id: '1', sku_id: '10', period_start: '2026-04-14' }];
      }
      if (sql.includes('INSERT INTO allocation_leg')) return [];
      if (sql.includes('UPDATE allocation_result')) return [];
      if (sql.includes('UPDATE allocation_run')) return [];
      return [];
    }),
    ...overrides,
  };
  return ds;
}

async function build(
  drpResult: DrpResultDto = buildDrp([]),
  dsOverrides: Record<string, unknown> = {},
  flagEnabled = true,
): Promise<AllocationLcnbService> {
  const drpSvc = { getDrpResult: jest.fn().mockResolvedValue(drpResult) };
  const sysCfg = { isEnabled: jest.fn().mockResolvedValue(flagEnabled) };
  const ds = buildDs(dsOverrides);
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      AllocationLcnbService,
      AllocationFairShareService,
      AllocationVariantMatchService,
      { provide: getDataSourceToken(), useValue: ds },
      { provide: DrpNettingV2Service, useValue: drpSvc },
      { provide: SystemConfigService, useValue: sysCfg },
    ],
  }).compile();
  return mod.get(AllocationLcnbService);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('AllocationLcnbService', () => {
  describe('feature flag', () => {
    it('throws 503 when m24 flag is off', async () => {
      const svc = await build(buildDrp([]), {}, false);
      await expect(svc.runV2({ planRunId: '42' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('idempotent guard', () => {
    it('throws Conflict when allocation_run already exists and no forceRerunReason', async () => {
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM allocation_run')) return [{ id: '999' }];
          return [];
        }),
      };
      const svc = await build(buildDrp([]), ds);
      await expect(svc.runV2({ planRunId: '42' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects forceRerunReason shorter than 20 chars', async () => {
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM allocation_run')) return [{ id: '999' }];
          return [];
        }),
      };
      const svc = await build(buildDrp([]), ds);
      await expect(
        svc.runV2({ planRunId: '42', forceRerunReason: 'too short' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('US-1 happy Hub-only allocation', () => {
    it('processes a cell end-to-end (Phase 1 hub=0 → stockout without donor)', async () => {
      // C1 round-2 fix: hub pool = 0 in Phase 1 (M23 already consumed onHand).
      // Without a donor, this cell falls through to PARTIAL_STOCKOUT — that's
      // correct behavior; the old test's "hub = Σ onHand" assumption was wrong.
      const cell = buildCell({ cnId: '1', skuId: '10', netDemand: 100, onHand: 500 });
      const svc = await build(buildDrp([cell]));
      const r = await svc.runV2({ planRunId: '42' });
      expect(r.totalDemandLines).toBe(1);
      expect(r.status).toBe('COMPLETED');
      // No hub, no donor → all demand flags stockout
      expect(r.partialStockout).toBeGreaterThanOrEqual(1);
    });
  });

  describe('US-11 partial stockout when hub + LCNB both short', () => {
    it('flags partial_stockout when need exceeds hub and no donors', async () => {
      const cell = buildCell({ cnId: '1', skuId: '10', netDemand: 100, onHand: 30 });
      const svc = await build(buildDrp([cell]));
      const r = await svc.runV2({ planRunId: '42' });
      expect(r.partialStockout).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getAllocationResult', () => {
    it('throws NotFound for unknown id', async () => {
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, plan_run_id')) return [];
          return [];
        }),
      };
      const svc = await build(buildDrp([]), ds);
      await expect(svc.getAllocationResult('999')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws AllocationRunNotCompletedException when not COMPLETED', async () => {
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, plan_run_id'))
            return [{ id: '1001', plan_run_id: '42', policy_run_id: '99', status: 'RUNNING', completed_at: null }];
          return [];
        }),
      };
      const svc = await build(buildDrp([]), ds);
      await expect(svc.getAllocationResult('1001')).rejects.toBeInstanceOf(AllocationRunNotCompletedException);
    });

    it('returns Map keyed by cnId|skuId|periodStart with nested legs (H1 fix)', async () => {
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, plan_run_id'))
            return [{ id: '1001', plan_run_id: '42', policy_run_id: '99', status: 'COMPLETED', completed_at: new Date() }];
          if (sql.includes('FROM allocation_result ar'))
            return [
              {
                result_id: '1', cn_id: '1', sku_id: '10', period_start: '2026-04-14',
                qty_required: 100, qty_allocated: 80,
                status: 'PARTIAL', planner_review_required: false, review_reason: null,
                variant_breakdown: null,
                is_top_up: false, source_top_up_id: null, source_period_start: null,
                leg_source_type: 'HUB', leg_source_entity_id: '0',
                leg_source_lot_id: null, leg_allocated_qty: 80,
                leg_fifo_rank: null, leg_distance_km: null,
              },
            ];
          return [];
        }),
      };
      const svc = await build(buildDrp([]), ds);
      const result = await svc.getAllocationResult('1001');
      expect(result.allocationRunId).toBe('1001');
      expect(result.results.size).toBe(1);
      const cell = result.results.get('1|10|2026-04-14');
      expect(cell?.periodStart).toBe('2026-04-14');
      expect(cell?.legs).toHaveLength(1);
      expect(cell?.legs[0].sourceType).toBe('HUB');
      // Top-up cross-module contract round-trip (M25/M26/M27)
      expect(cell?.isTopUp).toBe(false);
      expect(cell?.sourceTopUpId).toBeNull();
      expect(cell?.sourcePeriodStart).toBeNull();
    });
  });

  describe('H1 fix — R7 max_transfer_pct enforced cumulatively', () => {
    it('a single donor cannot transfer more than excess × maxTransferPct across all recipients', async () => {
      // excess=100, pct=0.8 → cap=80. Two recipients each need 60.
      // Without the fix: total transfer = 100 (bug). With fix: ≤ 80.
      const donor = buildCell({
        cnId: 'DONOR', skuId: 'X', periodStart: '2026-04-14',
        netDemand: -100, onHand: 200, status: 'OVER_STOCK',
      });
      const r1 = buildCell({
        cnId: 'R1', skuId: 'X', periodStart: '2026-04-14',
        netDemand: 60, onHand: 0, status: 'STOCKOUT_RISK',
      });
      const r2 = buildCell({
        cnId: 'R2', skuId: 'X', periodStart: '2026-04-14',
        netDemand: 60, onHand: 0, status: 'STOCKOUT_RISK',
      });
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM allocation_run')) return [];
          if (sql.includes('SELECT pr.policy_run_id'))
            return [{ policy_run_id: '99', config_snapshot: {
              'lcnb.enabled': 'true', 'lcnb.max_distance_km': '500',
              'lcnb.max_transfer_pct': '0.8', 'lcnb.min_excess_threshold': '1',
            } }];
          if (sql.includes('INSERT INTO allocation_run')) return [{ id: '1003' }];
          if (sql.includes('FROM sku')) return [{ id: 'X', sku_code: 'SKU-X' }];
          if (sql.includes('FROM channel')) return [
            { id: 'DONOR', channel_code: 'DONOR' },
            { id: 'R1', channel_code: 'R1' },
            { id: 'R2', channel_code: 'R2' },
          ];
          if (sql.includes('transport_lane')) return [
            { from_cn: 'DONOR', to_cn: 'R1', distance_km: 50 },
            { from_cn: 'DONOR', to_cn: 'R2', distance_km: 60 },
          ];
          if (sql.includes('SELECT id::text, cn_id::text, sku_id::text, period_start::text'))
            return [
              { id: '1', cn_id: 'R1', sku_id: 'X', period_start: '2026-04-14' },
              { id: '2', cn_id: 'R2', sku_id: 'X', period_start: '2026-04-14' },
            ];
          return [];
        }),
      };
      const svc = await build(buildDrp([donor, r1, r2]), ds);
      const r = await svc.runV2({ planRunId: '42' });
      expect(r.totalAllocatedQty).toBeLessThanOrEqual(80.01);
      expect(r.partialStockout).toBeGreaterThanOrEqual(1);
    });
  });

  describe('C2 fix — Hub pool excludes donor cells', () => {
    it('does not double-count OVER_STOCK donor as hub capacity', async () => {
      // CN-BD is OVER_STOCK donor (netDemand=-500, onHand=800). CN-DN needs 200.
      // Old code: hubBySku['X'] = 800 (from donor) + 0 (from recipient) → hub hat enough fake.
      // New code: hubBySkuWeek excludes donor → hub=0, forces LCNB path.
      const donor = buildCell({
        cnId: 'BD', skuId: 'X', netDemand: -500, onHand: 800, status: 'OVER_STOCK',
      });
      const recipient = buildCell({
        cnId: 'DN', skuId: 'X', netDemand: 200, onHand: 0, status: 'NORMAL',
      });
      const svc = await build(buildDrp([donor, recipient]));
      const r = await svc.runV2({ planRunId: '42' });
      // Hub is 0 (donor excluded) → allocation falls through to LCNB (or stockout if no distance).
      // We don't mock transport_lane so distance map is empty → LCNB skip → stockout.
      expect(r.partialStockout).toBeGreaterThanOrEqual(1);
    });
  });

  describe('H4 — BLOCKED_M23_NOT_READY persistence', () => {
    it('persists BLOCKED_M23_NOT_READY row when M23 retry exhausted', async () => {
      const drpSvc = {
        getDrpResult: jest.fn().mockRejectedValue(new Error('plan_run is RUNNING — not COMPLETED')),
      };
      const sysCfg = { isEnabled: jest.fn().mockResolvedValue(true) };
      let insertedStatus: string | null = null;
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
          if (sql.includes("status, lcnb_enabled, created_by") && sql.includes('BLOCKED_M23_NOT_READY')) {
            insertedStatus = 'BLOCKED_M23_NOT_READY';
            return [];
          }
          return [];
        }),
      };
      // Shorten retry to keep test fast — override delay by monkey-patching service private
      const mod: TestingModule = await Test.createTestingModule({
        providers: [
          AllocationLcnbService,
          AllocationFairShareService,
          AllocationVariantMatchService,
          { provide: getDataSourceToken(), useValue: ds },
          { provide: DrpNettingV2Service, useValue: drpSvc },
          { provide: SystemConfigService, useValue: sysCfg },
        ],
      }).compile();
      const svc = mod.get(AllocationLcnbService);
      // Patch retry delay to 1ms
      (svc as unknown as { _fetchDrpWithRetry: Function })._fetchDrpWithRetry =
        async function (planRunId: string) {
          try {
            return await drpSvc.getDrpResult(planRunId);
          } catch (err) {
            throw err;
          }
        };
      await expect(svc.runV2({ planRunId: '42' })).rejects.toThrow();
      expect(insertedStatus).toBe('BLOCKED_M23_NOT_READY');
    }, 10000);
  });

  describe('US-12 LCNB flag off bypass', () => {
    it('skips LCNB layer when lcnb.enabled=false in policy snapshot', async () => {
      const ds = {
        transaction: jest.fn(),
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM allocation_run')) return [];
          if (sql.includes('SELECT pr.policy_run_id'))
            return [{ policy_run_id: '99', config_snapshot: { 'lcnb.enabled': 'false' } }];
          if (sql.includes('INSERT INTO allocation_run')) return [{ id: '1002' }];
          if (sql.includes('INSERT INTO allocation_result')) return [{ id: '1' }];
          return [];
        }),
      };
      const donor = buildCell({ cnId: '2', skuId: '10', netDemand: -500, status: 'OVER_STOCK' });
      const recipient = buildCell({ cnId: '1', skuId: '10', netDemand: 100, onHand: 0 });
      const svc = await build(buildDrp([donor, recipient]), ds);
      const r = await svc.runV2({ planRunId: '42' });
      // With LCNB off and hub=0, allocation is stockout
      expect(r.lcnbTransfers).toBe(0);
    });
  });
});
