import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NmAtpService, AtpRunNotCompletedException } from './nm-atp.service';
import { AtpClassificationService } from './atp-classification.service';
import { UrgencyRankingService } from './urgency-ranking.service';
import { AllocationLcnbService } from '../allocation/allocation.lcnb.service';
import { FreshnessGateService } from '../data-sync/freshness-gate.service';
import { SystemConfigService } from '../system-config/system-config.service';

// ─── Mock builders ────────────────────────────────────────────────────────────

function buildDs(overrides: Record<string, unknown> = {}) {
  const ds: Record<string, unknown> = {
    transaction: jest.fn().mockImplementation((cb: (em: unknown) => Promise<unknown>) =>
      cb({ query: (ds as { query: Function }).query }),
    ),
    query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM atp_run') && sql.includes('allocation_run_id')) return [];
      if (sql.includes('INSERT INTO atp_run')) return [{ id: '701' }];
      if (sql.includes('FROM policy_run')) return [{ config_snapshot: { 'atp.staleness_threshold_hours': '24' } }];
      if (sql.includes('FROM system_config')) return [];
      if (sql.includes('allocation_leg leg')) return []; // _loadRequestedCells: no cells
      if (sql.includes('FROM supplier WHERE supplier_code')) return [{ id: '1', supplier_code: 'NM-MIKADO' }];
      if (sql.includes('FROM supplier WHERE id')) return [{ id: '1', supplier_code: 'NM-MIKADO' }];
      if (sql.includes('supply_snapshot_line')) return [];
      if (sql.includes('FROM channel')) return [];
      if (sql.includes('transport_lane')) return [];
      if (sql.includes('INSERT INTO atp_check')) return [];
      if (sql.includes('UPDATE atp_run')) return [];
      if (sql.includes('SELECT id::text, plan_run_id::text')) return [];
      return [];
    }),
    ...overrides,
  };
  return ds;
}

function buildAllocSvc(overrides = {}) {
  return {
    getAllocationResult: jest.fn().mockResolvedValue({
      allocationRunId: '42', planRunId: '10', policyRunId: '99',
      generatedAt: new Date(), results: new Map(),
    }),
    ...overrides,
  };
}

function buildFreshnessSvc(fresh = true) {
  return {
    checkAll: jest.fn().mockResolvedValue([
      { nmCode: 'NM-MIKADO', nmName: 'Mikado', status: fresh ? 'FRESH' : 'STALE', hoursSinceSync: fresh ? 1 : 30, lastSyncedAt: new Date() },
    ]),
  };
}

function buildSysCfg(enabled = true) {
  return { isEnabled: jest.fn().mockResolvedValue(enabled) };
}

async function build(
  ds = buildDs(),
  allocSvc = buildAllocSvc(),
  freshnessSvc = buildFreshnessSvc(),
  sysCfg = buildSysCfg(),
): Promise<NmAtpService> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      NmAtpService,
      AtpClassificationService,
      UrgencyRankingService,
      { provide: getDataSourceToken(), useValue: ds },
      { provide: AllocationLcnbService, useValue: allocSvc },
      { provide: FreshnessGateService, useValue: freshnessSvc },
      { provide: SystemConfigService, useValue: sysCfg },
    ],
  }).compile();
  return mod.get(NmAtpService);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NmAtpService', () => {
  describe('feature flag', () => {
    it('throws 503 when m26 flag off', async () => {
      const svc = await build(buildDs(), buildAllocSvc(), buildFreshnessSvc(), buildSysCfg(false));
      await expect(svc.run({ allocationRunId: '42' })).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('idempotent (R10)', () => {
    it('throws 409 ConflictException when atp_run exists without force', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM atp_run')) return [{ id: '700' }];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(svc.run({ allocationRunId: '42' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws BadRequest when forceRerunReason < 20 chars', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM atp_run')) return [{ id: '700' }];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(
        svc.run({ allocationRunId: '42', forceRerunReason: 'short' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('run happy path — 0 cells', () => {
    it('creates atp_run and completes with 0 cells when no allocation results', async () => {
      const svc = await build();
      const r = await svc.run({ allocationRunId: '42' });
      expect(r.status).toBe('COMPLETED');
      expect(r.totalCells).toBe(0);
      expect(r.passCount).toBe(0);
    });
  });

  describe('run with cells — PASS path', () => {
    it('classifies PASS when atp_qty >= requested', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM atp_run') && sql.includes('allocation_run_id')) return [];
          if (sql.includes('INSERT INTO atp_run')) return [{ id: '701' }];
          if (sql.includes('FROM policy_run')) return [{ config_snapshot: {} }];
          if (sql.includes('FROM system_config')) return [];
          if (sql.includes('allocation_leg leg')) {
            return [{ nm_id: '1', sku_id: '10', period_start: '2026-04-21', requested_qty: 500 }];
          }
          if (sql.includes('FROM supplier WHERE supplier_code')) return [{ id: '1', supplier_code: 'NM-MIKADO' }];
          if (sql.includes('FROM supplier WHERE id')) return [{ id: '1', supplier_code: 'NM-MIKADO' }];
          if (sql.includes('supply_snapshot_line')) return [{ nm_id: '1', sku_id: '10', atp_qty: 800, allocatable_qty: 800 }];
          if (sql.includes('FROM channel')) return [];
          if (sql.includes('transport_lane')) return [];
          if (sql.includes('INSERT INTO atp_check')) return [];
          if (sql.includes('UPDATE atp_run')) return [];
          return [];
        }),
      });
      const svc = await build(ds);
      const r = await svc.run({ allocationRunId: '42' });
      expect(r.status).toBe('COMPLETED');
      expect(r.passCount).toBe(1);
      expect(r.totalCells).toBe(1);
    });
  });

  describe('BLOCKED path (H1 CTO fix — stale ≠ FAIL)', () => {
    it('marks BLOCKED when NM data stale — semantics NOT FAIL', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id FROM atp_run') && sql.includes('allocation_run_id')) return [];
          if (sql.includes('INSERT INTO atp_run')) return [{ id: '701' }];
          if (sql.includes('FROM policy_run')) return [{ config_snapshot: {} }];
          if (sql.includes('FROM system_config')) return [];
          if (sql.includes('allocation_leg leg')) {
            return [{ nm_id: '1', sku_id: '10', period_start: '2026-04-21', requested_qty: 500 }];
          }
          if (sql.includes('FROM supplier WHERE supplier_code')) return [{ id: '1', supplier_code: 'NM-TOKO' }];
          if (sql.includes('FROM supplier WHERE id')) return [{ id: '1', supplier_code: 'NM-TOKO' }];
          if (sql.includes('supply_snapshot_line')) return [];
          if (sql.includes('FROM channel')) return [];
          if (sql.includes('transport_lane')) return [];
          if (sql.includes('INSERT INTO atp_check')) return [];
          if (sql.includes('UPDATE atp_run')) return [];
          return [];
        }),
      });
      // Freshness STALE
      const freshnessSvc = buildFreshnessSvc(false);
      const svc = await build(ds, buildAllocSvc(), freshnessSvc);
      const r = await svc.run({ allocationRunId: '42' });
      expect(r.status).toBe('COMPLETED');    // H2: run COMPLETED even with BLOCKED cells
      expect(r.blockedCount).toBe(1);
      expect(r.failCount).toBe(0);          // BLOCKED ≠ FAIL
    });
  });

  describe('getAtpResult (M27 contract — M2 sweep)', () => {
    it('throws NotFoundException when no atp_run exists', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id::text, plan_run_id::text')) return [];
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(svc.getAtpResult('42')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws AtpRunNotCompletedException when status = RUNNING', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id::text, plan_run_id::text')) {
            return [{ id: '701', plan_run_id: '10', status: 'RUNNING', completed_at: null }];
          }
          return [];
        }),
      });
      const svc = await build(ds);
      await expect(svc.getAtpResult('42')).rejects.toBeInstanceOf(AtpRunNotCompletedException);
    });

    it('returns AtpResultDto when COMPLETED', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('SELECT id::text, plan_run_id::text')) {
            return [{ id: '701', plan_run_id: '10', status: 'COMPLETED', completed_at: new Date() }];
          }
          if (sql.includes('FROM atp_check WHERE atp_run_id')) {
            return [{
              id: '1001', nm_id: '1', sku_id: '10', period_start: '2026-04-21',
              requested_qty: 500, atp_qty: 800, result: 'PASS', reason: null,
              is_atp_null_fallback: false, urgency_ranking: null,
            }];
          }
          return [];
        }),
      });
      const svc = await build(ds);
      const result = await svc.getAtpResult('42');
      expect(result.atpRunId).toBe('701');
      expect(result.checks.size).toBe(1);
      expect(result.checks.get('1|10|2026-04-21')?.result).toBe('PASS');
    });
  });
});

// ─── AtpClassificationService unit tests ─────────────────────────────────────

describe('AtpClassificationService', () => {
  const svc = new AtpClassificationService();

  it('BLOCKED when isFresh=false (H1: stale ≠ FAIL)', () => {
    const r = svc.classify({ atpQty: 1000, requestedQty: 500, isFresh: false });
    expect(r.result).toBe('BLOCKED');
    expect(r.reason).toBe('STALE_DATA');
  });

  it('PASS when atp >= requested', () => {
    const r = svc.classify({ atpQty: 1500, requestedQty: 1000, isFresh: true });
    expect(r.result).toBe('PASS');
    expect(r.reason).toBeNull();
  });

  it('PARTIAL when 0 < atp < requested', () => {
    const r = svc.classify({ atpQty: 600, requestedQty: 1000, isFresh: true });
    expect(r.result).toBe('PARTIAL');
    expect(r.reason).toBeNull();
  });

  it('FAIL when atp = 0 (declarative zero stock)', () => {
    const r = svc.classify({ atpQty: 0, requestedQty: 1000, isFresh: true });
    expect(r.result).toBe('FAIL');
    expect(r.reason).toBe('ZERO_STOCK');
  });

  it('atp_qty null fallback: classify() receives null directly → defensive FAIL branch + fallback flag', () => {
    // classify() itself still receives null here (unit test for the service method).
    // In production, _preloadAtpQtys() applies allocatable_qty fallback BEFORE classify() is called,
    // so classify() never sees null when real data flows through nm-atp.service.ts (BUG-2 fix).
    const r = svc.classify({ atpQty: null, requestedQty: 500, isFresh: true });
    expect(r.isAtpNullFallback).toBe(true);
    expect(r.result).toBe('FAIL'); // null hits defensive path — expected for direct classify() call
  });
});

// ─── UrgencyRankingService unit tests ────────────────────────────────────────

describe('UrgencyRankingService', () => {
  const svc = new UrgencyRankingService();

  it('US-2: CRITICAL (hstk < lt) sort first, waterfall alloc atp_qty', () => {
    const hstkMap = new Map([['CN-DN', 2], ['CN-BD', 8], ['CN-CT', 15]]);
    const ltMap = new Map([['CN-DN', 3], ['CN-BD', 2], ['CN-CT', 4]]);
    const recipients = [
      { cnId: 'CN-BD', cnCode: 'CN-BD', requestedQty: 700 },
      { cnId: 'CN-CT', cnCode: 'CN-CT', requestedQty: 500 },
      { cnId: 'CN-DN', cnCode: 'CN-DN', requestedQty: 800 },
    ];
    const result = svc.rank({ atpQty: 1500, recipients, hstkMap, ltMap });

    // CN-DN: HSTK=2 < LT=3 → CRITICAL → rank 1
    expect(result[0].cnCode).toBe('CN-DN');
    expect(result[0].isCritical).toBe(true);
    expect(result[0].atpAlloc).toBe(800);
    expect(result[0].unfulfilled).toBe(0);

    // CN-BD: HSTK=8 > LT=2 → not critical, hstk lower → rank 2
    expect(result[1].cnCode).toBe('CN-BD');
    expect(result[1].isCritical).toBe(false);
    expect(result[1].atpAlloc).toBe(700);

    // CN-CT: HSTK=15 → rank 3, remaining atp=0 → unfulfilled=500
    expect(result[2].cnCode).toBe('CN-CT');
    expect(result[2].atpAlloc).toBe(0);
    expect(result[2].unfulfilled).toBe(500);
  });

  it('US-5: is_critical TRUE when hstk < transit_lt_days (C3 fix — days not qty)', () => {
    const hstkMap = new Map([['CN-DN', 1]]);
    const ltMap = new Map([['CN-DN', 3]]);
    const result = svc.rank({
      atpQty: 500,
      recipients: [{ cnId: 'CN-DN', cnCode: 'CN-DN', requestedQty: 500 }],
      hstkMap,
      ltMap,
    });
    expect(result[0].isCritical).toBe(true);
    expect(result[0].hstkDays).toBe(1);
    expect(result[0].transitLtDays).toBe(3);
  });

  it('tie-break by cn_code ASC when hstk equal (M3 fix)', () => {
    const hstkMap = new Map([['CN-A', 5], ['CN-B', 5]]);
    const ltMap = new Map([['CN-A', 2], ['CN-B', 2]]);
    const result = svc.rank({
      atpQty: 1000,
      recipients: [
        { cnId: 'CN-B', cnCode: 'CN-B', requestedQty: 300 },
        { cnId: 'CN-A', cnCode: 'CN-A', requestedQty: 300 },
      ],
      hstkMap,
      ltMap,
    });
    expect(result[0].cnCode).toBe('CN-A');
    expect(result[1].cnCode).toBe('CN-B');
  });
});
