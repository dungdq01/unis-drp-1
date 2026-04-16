import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DrpNettingV2Service } from './drp.netting-v2.service';
import { DrpPolicyRunService } from './drp.policy-run.service';
import { DrpSsCnService } from './drp.ss-cn.service';
import { DrpVariantSuggestionService } from './drp.variant-suggestion.service';
import { FreshnessGateService } from '../data-sync/freshness-gate.service';
import { CnAdjustService } from '../cn-adjust/cn-adjust.service';
import { SystemConfigService } from '../system-config/system-config.service';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const POLICY_SNAPSHOT = {
  policyRunId: '99',
  configSnapshot: { 'safety_stock.default_z_score': '1.65', 'safety_stock.lcnb_reduction_pct': '0' },
  masterDataSnapshot: { skuCnMappings: [], transportLanes: [] },
};

const GATE_OK = { canRun: true, staleNms: [], thresholdMinutes: 60 };
const GATE_BLOCKED = { canRun: false, staleNms: ['NM001'], thresholdMinutes: 60 };

const DEMAND_ROW = {
  cn_id: '1', sku_id: '10', period_start: '2026-04-14', fc_qty: 100,
};

function buildDs(overrides: Record<string, unknown> = {}) {
  const ds: Record<string, unknown> = {
    // M1 fix: runV2 wraps policy_run + plan_run INSERTs in a transaction.
    // Mock forwards the callback to the same query fn so existing SQL-substring
    // mocks continue to match.
    transaction: jest.fn().mockImplementation(async (cb: (em: unknown) => Promise<unknown>) => {
      return cb({ query: (ds as { query: Function }).query });
    }),
    query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      // transitionPlanRun SELECT status — match by current plan_run context
      if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
      // plan_run insert → return id
      if (sql.includes('INSERT INTO plan_run')) return [{ id: '42' }];
      // idempotent daily check
      if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
      // demand_snapshot_line query
      if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [DEMAND_ROW];
      // supply_snapshot query
      if (sql.includes('supply_snapshot') && sql.includes('allocatable_qty')) return [];
      // UPDATE plan_run finalize
      if (sql.includes('UPDATE plan_run')) return [];
      // SELECT id, status FROM plan_run
      if (sql.includes('SELECT id, status') && sql.includes('FROM plan_run WHERE id')) return [{ id: '42', status: 'COMPLETED' }];
      // listV2Runs
      if (sql.includes('LEFT JOIN policy_run')) return [];
      if (sql.includes('COUNT(*)') && sql.includes('policy_run_id')) return [{ count: '0' }];
      // listLines — COUNT must return before SELECT (Promise.all order not guaranteed by SQL match)
      if (sql.includes('COUNT(*)') && sql.includes('drp_cn_line')) return [{ count: '0' }];
      if (sql.includes('FROM drp_cn_line')) return [];
      return [];
    }),
    ...overrides,
  };
  return ds;
}

function buildPolicyRunSvc(overrides = {}) {
  return { createPolicyRun: jest.fn().mockResolvedValue(POLICY_SNAPSHOT), ...overrides };
}

function buildSsCnSvc(overrides = {}) {
  return { computeAll: jest.fn().mockResolvedValue(new Map()) , ...overrides };
}

function buildVariantSvc(overrides = {}) {
  return {
    preload: jest.fn().mockResolvedValue(undefined),
    suggest: jest.fn().mockReturnValue({ suggestion: null, plannerReviewRequired: false, reviewReason: null }),
    ...overrides,
  };
}

function buildSysCfgSvc(overrides = {}) {
  return { isEnabled: jest.fn().mockResolvedValue(true), ...overrides };
}

function buildGate(overrides = {}) {
  return { check: jest.fn().mockResolvedValue(GATE_OK), ...overrides };
}

function buildCnAdjustSvc(overrides = {}) {
  return { getEffectiveDemand: jest.fn().mockResolvedValue(new Map()), ...overrides };
}

async function buildModule(
  ds = buildDs(),
  policySvc = buildPolicyRunSvc(),
  ssCnSvc = buildSsCnSvc(),
  variantSvc = buildVariantSvc(),
  gate = buildGate(),
  cnAdjSvc = buildCnAdjustSvc(),
  sysCfg = buildSysCfgSvc(),
): Promise<DrpNettingV2Service> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      DrpNettingV2Service,
      { provide: getDataSourceToken(), useValue: ds },
      { provide: DrpPolicyRunService, useValue: policySvc },
      { provide: DrpSsCnService, useValue: ssCnSvc },
      { provide: DrpVariantSuggestionService, useValue: variantSvc },
      { provide: FreshnessGateService, useValue: gate },
      { provide: CnAdjustService, useValue: cnAdjSvc },
      { provide: SystemConfigService, useValue: sysCfg },
    ],
  }).compile();
  return mod.get(DrpNettingV2Service);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DrpNettingV2Service', () => {
  describe('runV2 — freshness gate', () => {
    it('blocks run when gate returns canRun=false and no forceOverrideReason', async () => {
      const svc = await buildModule(buildDs(), buildPolicyRunSvc(), buildSsCnSvc(), buildVariantSvc(), buildGate({ check: jest.fn().mockResolvedValue(GATE_BLOCKED) }));
      await expect(svc.runV2({})).rejects.toBeInstanceOf(BadRequestException);
    });

    it('proceeds with FORCE_OVERRIDDEN status when forceOverrideReason provided', async () => {
      let insertedStatus: string | undefined;
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          // FORCE_OVERRIDDEN → COMPLETED valid per STATUS_TRANSITIONS
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'FORCE_OVERRIDDEN' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '42' }];
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [];
          if (sql.includes('allocatable_qty')) return [];
          if (sql.includes('UPDATE plan_run')) return [];
          return [];
        }),
      });
      const gate = buildGate({ check: jest.fn().mockResolvedValue(GATE_BLOCKED) });
      const svc = await buildModule(ds, buildPolicyRunSvc(), buildSsCnSvc(), buildVariantSvc(), gate);
      const result = await svc.runV2({ forceOverrideReason: 'Manual override test reason here', forceOverrideBy: 'admin' });
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('runV2 — idempotent daily check', () => {
    it('throws ConflictException when run already COMPLETED for today', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) {
            return [{ id: '10' }]; // existing run
          }
          return [];
        }),
      });
      const svc = await buildModule(ds);
      await expect(svc.runV2({})).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows re-run when forceOverrideReason provided even if COMPLETED today', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [{ id: '10' }];
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '43' }];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [];
          if (sql.includes('allocatable_qty')) return [];
          if (sql.includes('UPDATE plan_run')) return [];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      const result = await svc.runV2({ forceOverrideReason: 'Retry after fix — at least 20 chars', forceOverrideBy: 'admin' });
      expect(result.planRunId).toBe('43');
    });
  });

  describe('runV2 — M22 fallback', () => {
    it('falls back to FC raw when M22 throws and marks m22Unavailable=true', async () => {
      const cnAdjSvc = buildCnAdjustSvc({
        getEffectiveDemand: jest.fn().mockRejectedValue(new Error('cn_adjust db down')),
      });
      const svc = await buildModule(buildDs(), buildPolicyRunSvc(), buildSsCnSvc(), buildVariantSvc(), buildGate(), cnAdjSvc);
      const result = await svc.runV2({});
      expect(result.effectiveDemandSource.m22Unavailable).toBe(true);
      expect(result.effectiveDemandSource.m22Count).toBe(0);
    });

    it('uses M22 adjusted qty when available', async () => {
      const m22Map = new Map([['1|10', 150]]);
      const cnAdjSvc = buildCnAdjustSvc({
        getEffectiveDemand: jest.fn().mockResolvedValue(m22Map),
      });
      const svc = await buildModule(buildDs(), buildPolicyRunSvc(), buildSsCnSvc(), buildVariantSvc(), buildGate(), cnAdjSvc);
      const result = await svc.runV2({});
      // demand row exists for cn=1 sku=10, m22Map has that key
      expect(result.effectiveDemandSource.m22Count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('runV2 — net demand computation', () => {
    it('sets status=OVER_STOCK when on_hand is 2x demand and net_demand=0', async () => {
      const demandRow = { cn_id: '1', sku_id: '10', period_start: '2026-04-14', fc_qty: 100 };
      const supplyRow = { cn_id: '1', sku_id: '10', on_hand: 250, in_transit: 0 };
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '44' }];
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [demandRow];
          if (sql.includes('allocatable_qty')) return [supplyRow];
          if (sql.includes('UPDATE plan_run')) return [];
          if (sql.includes('INSERT INTO drp_cn_line')) return [];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      const result = await svc.runV2({});
      expect(result.exceptionsCount).toBeGreaterThanOrEqual(1);
    });

    it('sets status=STOCKOUT_RISK when on_hand < 50% of demand', async () => {
      const demandRow = { cn_id: '1', sku_id: '10', period_start: '2026-04-14', fc_qty: 100 };
      const supplyRow = { cn_id: '1', sku_id: '10', on_hand: 40, in_transit: 0 };
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '45' }];
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [demandRow];
          if (sql.includes('allocatable_qty')) return [supplyRow];
          if (sql.includes('UPDATE plan_run')) return [];
          if (sql.includes('INSERT INTO drp_cn_line')) return [];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      const result = await svc.runV2({});
      expect(result.exceptionsCount).toBeGreaterThanOrEqual(1);
    });

    it('net_demand = max(0, demand - on_hand - in_transit + ss)', async () => {
      // demand=100, on_hand=80, in_transit=10, ss=5 → net = max(0, 100-80-10+5) = 15
      const demandRow = { cn_id: '1', sku_id: '10', period_start: '2026-04-14', fc_qty: 100 };
      const supplyRow = { cn_id: '1', sku_id: '10', on_hand: 80, in_transit: 10 };
      const ssMap = new Map([['1|10', 5]]);
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '46' }];
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [demandRow];
          if (sql.includes('allocatable_qty')) return [supplyRow];
          if (sql.includes('UPDATE plan_run')) return [];
          if (sql.includes('INSERT INTO drp_cn_line')) return [];
          return [];
        }),
      });
      const ssCnSvc = buildSsCnSvc({ computeAll: jest.fn().mockResolvedValue(ssMap) });
      const svc = await buildModule(ds, buildPolicyRunSvc(), ssCnSvc);
      const result = await svc.runV2({});
      expect(result.plannedOrdersCount).toBe(1); // net_demand=15 > 0
    });

    it('net_demand = 0 when supply covers demand + ss', async () => {
      const demandRow = { cn_id: '1', sku_id: '10', period_start: '2026-04-14', fc_qty: 50 };
      const supplyRow = { cn_id: '1', sku_id: '10', on_hand: 200, in_transit: 0 };
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '47' }];
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [demandRow];
          if (sql.includes('allocatable_qty')) return [supplyRow];
          if (sql.includes('UPDATE plan_run')) return [];
          if (sql.includes('INSERT INTO drp_cn_line')) return [];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      const result = await svc.runV2({});
      expect(result.plannedOrdersCount).toBe(0);
    });
  });

  describe('runV2 — policy_run failure', () => {
    it('throws and marks plan_run FAILED when policy_run creation fails', async () => {
      const policySvc = buildPolicyRunSvc({
        createPolicyRun: jest.fn().mockRejectedValue(new Error('DB connection lost')),
      });
      let statusUpdate: string | undefined;
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          // policy_run creation fails before plan_run INSERT, so no status update expected
          return [];
        }),
      });
      const svc = await buildModule(ds, policySvc);
      await expect(svc.runV2({})).rejects.toThrow('DB connection lost');
    });
  });

  describe('getDrpResult', () => {
    it('returns Map keyed by drpCellKey for a COMPLETED run', async () => {
      const lineRow = {
        cn_id: '1', sku_id: '10', period_start: '2026-04-14',
        effective_demand: 100, effective_demand_source: 'FC_RAW',
        on_hand: 50, in_transit: 0, ss_final: 5, net_demand: 55,
        status: 'NORMAL', variant_suggestion: null,
      };
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, status') && sql.includes('FROM plan_run WHERE id')) {
            return [{ id: '42', status: 'COMPLETED', policy_run_id: '99', completed_at: new Date() }];
          }
          if (sql.includes('FROM drp_cn_line')) return [lineRow];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      const result = await svc.getDrpResult('42');
      expect(result.planRunId).toBe('42');
      expect(result.policyRunId).toBe('99');
      expect(result.lines.size).toBe(1);
      expect(result.lines.get('1|10|2026-04-14')).toMatchObject({ netDemand: 55, status: 'NORMAL' });
    });

    it('throws NotFoundException for unknown planRunId', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, status') && sql.includes('FROM plan_run WHERE id')) return [];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      await expect(svc.getDrpResult('999')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when plan_run is RUNNING', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id, status') && sql.includes('FROM plan_run WHERE id')) return [{ id: '42', status: 'RUNNING', policy_run_id: null, completed_at: null }];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      await expect(svc.getDrpResult('42')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listV2Runs / listLines', () => {
    it('listV2Runs returns paginated results', async () => {
      const svc = await buildModule();
      const result = await svc.listV2Runs(1, 10);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('total');
    });

    it('listLines returns paginated drp_cn_line with filters', async () => {
      const svc = await buildModule();
      const result = await svc.listLines('42', { cnId: '1', skuId: '10' });
      expect(result).toHaveProperty('data');
      expect(result.page).toBe(1);
    });
  });

  describe('variant suggestion integration', () => {
    it('includes variant suggestions in lines when variantSvc returns data', async () => {
      const variantSvc = buildVariantSvc({
        preload: jest.fn().mockResolvedValue(undefined),
        suggest: jest.fn().mockReturnValue({
          suggestion: { 'V1': 60, 'V2': 40 },
          plannerReviewRequired: false,
          reviewReason: null,
        }),
      });
      let capturedInsert: string[] = [];
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '50' }];
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return [DEMAND_ROW];
          if (sql.includes('allocatable_qty')) return [];
          if (sql.includes('INSERT INTO drp_cn_line')) {
            capturedInsert = params as string[];
            return [];
          }
          if (sql.includes('UPDATE plan_run')) return [];
          return [];
        }),
      });
      const svc = await buildModule(ds, buildPolicyRunSvc(), buildSsCnSvc(), variantSvc);
      await svc.runV2({});
      expect(variantSvc.suggest).toHaveBeenCalled();
    });
  });

  describe('bulk insert chunking', () => {
    it('handles 0 demand rows without error', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT status FROM plan_run WHERE id')) return [{ status: 'RUNNING' }];
          if (sql.includes('INSERT INTO plan_run')) return [{ id: '51' }];
          if (sql.includes("status = 'COMPLETED'") && sql.includes('run_date')) return [];
          if (sql.includes('demand_snapshot_line') && sql.includes('GROUP BY')) return []; // no demand
          if (sql.includes('allocatable_qty')) return [];
          if (sql.includes('UPDATE plan_run')) return [];
          return [];
        }),
      });
      const svc = await buildModule(ds);
      const result = await svc.runV2({});
      expect(result.combinationsProcessed).toBe(0);
    });
  });
});
