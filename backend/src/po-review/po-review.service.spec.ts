import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PoReviewService } from './po-review.service';
import { PoEditService } from './po-edit.service';
import { PoTransitionService, InvalidTransitionException } from './po-transition.service';
import { TransportLotSizingService, TransportPlanIncompleteException } from '../transport/transport.lot-sizing.service';
import { NmAtpService } from '../nm-atp/nm-atp.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { atpCellKey } from '../common/atp-utils';

// ─── Mock builders ────────────────────────────────────────────────────────────

function buildDs(overrides: Record<string, unknown> = {}) {
  const ds: Record<string, unknown> = {
    transaction: jest.fn().mockImplementation((cb: (em: unknown) => Promise<unknown>) =>
      cb({ query: (ds as { query: Function }).query }),
    ),
    query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM po_run') && sql.includes('is_force_rerun = FALSE')) return [];
      if (sql.includes('INSERT INTO po_run') && sql.includes('BLOCKED_INCOMPLETE')) return [{ id: '901' }];
      if (sql.includes('INSERT INTO po_run') && sql.includes('RUNNING')) return [{ id: '901' }];
      if (sql.includes('FROM allocation_run')) return [{ policy_run_id: '99', plan_run_id: '10' }];
      if (sql.includes('FROM allocation_leg')) return [];  // no legs → 0 PO/TO
      if (sql.includes('UPDATE po_run')) return [];
      if (sql.includes('FROM system_config')) return [{ config_value: 'true' }];
      if (sql.includes('COALESCE(MAX(id)') && sql.includes('po_header')) return [{ n: 1 }];
      if (sql.includes('COALESCE(MAX(id)') && sql.includes('to_header')) return [{ n: 1 }];
      return [];
    }),
    ...overrides,
  };
  return ds;
}

function buildTransportSvc(opts: { noCarrier?: boolean; notFound?: boolean } = {}) {
  return {
    getTransportPlan: jest.fn().mockImplementation(async (planId: string) => {
      if (opts.notFound) throw new NotFoundException(`transport_plan #${planId} not found`);
      if (opts.noCarrier) {
        throw new TransportPlanIncompleteException(
          [{ code: 'NO_CARRIER', detail: { trip_ids: ['501'] } }],
          planId,
        );
      }
      return { planId, allocationRunId: '42', status: 'COMPLETED', trips: [] };
    }),
  };
}

function buildAtpSvc(opts: { incomplete?: boolean; checks?: Map<string, any> } = {}) {
  return {
    getAtpResult: jest.fn().mockImplementation(async (allocationRunId: string) => {
      if (opts.incomplete) throw new BadRequestException('ATP run not COMPLETED');
      return {
        atpRunId: '801',
        allocationRunId,
        planRunId: '10',
        generatedAt: new Date(),
        checks: opts.checks ?? new Map(),
      };
    }),
  };
}

function buildSysCfg(enabled = true) {
  return { isEnabled: jest.fn().mockResolvedValue(enabled) };
}

async function buildSvc(
  ds = buildDs(),
  transportSvc = buildTransportSvc(),
  atpSvc = buildAtpSvc(),
  sysCfg = buildSysCfg(),
): Promise<PoReviewService> {
  const mod: TestingModule = await Test.createTestingModule({
    providers: [
      PoReviewService,
      { provide: getDataSourceToken(), useValue: ds },
      { provide: TransportLotSizingService, useValue: transportSvc },
      { provide: NmAtpService, useValue: atpSvc },
      { provide: SystemConfigService, useValue: sysCfg },
    ],
  }).compile();
  return mod.get(PoReviewService);
}

// ─── PoReviewService tests ────────────────────────────────────────────────────

describe('PoReviewService', () => {
  describe('feature flag', () => {
    it('throws 503 when m27 flag off', async () => {
      const svc = await buildSvc(buildDs(), buildTransportSvc(), buildAtpSvc(), buildSysCfg(false));
      await expect(svc.generate({ allocationRunId: '42', transportPlanId: '50', atpRunId: '80' }))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('idempotent (R13)', () => {
    it('throws 409 when po_run exists without forceRerunReason', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM po_run') && sql.includes('is_force_rerun = FALSE')) return [{ id: '900' }];
          if (sql.includes('FROM system_config')) return [{ config_value: 'true' }];
          return [];
        }),
      });
      const svc = await buildSvc(ds);
      await expect(svc.generate({ allocationRunId: '42', transportPlanId: '50', atpRunId: '80' }))
        .rejects.toBeInstanceOf(ConflictException);
    });

    it('throws BadRequest when forceRerunReason < 20 chars', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM po_run') && sql.includes('is_force_rerun = FALSE')) return [{ id: '900' }];
          if (sql.includes('FROM system_config')) return [{ config_value: 'true' }];
          return [];
        }),
      });
      const svc = await buildSvc(ds);
      await expect(svc.generate({ allocationRunId: '42', transportPlanId: '50', atpRunId: '80', forceRerunReason: 'short' }))
        .rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('US-4: NO_CARRIER blocks entire run (R3)', () => {
    it('creates BLOCKED_INCOMPLETE po_run and throws 503', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM po_run') && sql.includes('is_force_rerun = FALSE')) return [];
          if (sql.includes('INSERT INTO po_run') && sql.includes('BLOCKED_INCOMPLETE')) return [{ id: '902' }];
          if (sql.includes('FROM system_config')) return [{ config_value: 'true' }];
          return [];
        }),
      });
      const svc = await buildSvc(ds, buildTransportSvc({ noCarrier: true }));
      await expect(svc.generate({ allocationRunId: '42', transportPlanId: '50', atpRunId: '80' }))
        .rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('happy path — 0 legs', () => {
    it('generates COMPLETED with 0 PO and 0 TO when no allocation legs', async () => {
      const svc = await buildSvc();
      const r = await svc.generate({ allocationRunId: '42', transportPlanId: '50', atpRunId: '80' });
      expect(r.status).toBe('COMPLETED');
      expect(r.totalPoCount).toBe(0);
      expect(r.totalToCount).toBe(0);
    });
  });

  describe('US-2: ATP BLOCKED skip cell (H1 — not FAIL)', () => {
    it('skips cell with BLOCKED result, does NOT block run, increments skippedAtpBlockedCount', async () => {
      const atpChecks = new Map([
        [atpCellKey('10', '20', '2026-04-21'), {
          result: 'BLOCKED', reason: 'STALE_DATA', atpQty: null, urgencyRanking: null,
        }],
      ]);
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM po_run') && sql.includes('is_force_rerun = FALSE')) return [];
          if (sql.includes('INSERT INTO po_run') && sql.includes('RUNNING')) return [{ id: '901' }];
          if (sql.includes('FROM allocation_run')) return [{ policy_run_id: '99', plan_run_id: '10' }];
          if (sql.includes('FROM system_config')) return [{ config_value: 'true' }];
          if (sql.includes('FROM allocation_leg')) return [{
            leg_id: '1', source_type: 'NM', source_entity_id: '0',
            source_period_start: null, cn_id: '5', sku_id: '20',
            is_top_up: false, effective_period: '2026-04-21',
            allocated_qty: 500, resolved_nm_id: '10', planner_review_required: false,
          }];
          if (sql.includes('UPDATE po_run')) return [];
          if (sql.includes('COALESCE(MAX(id)') && sql.includes('po_header')) return [{ n: 1 }];
          return [];
        }),
      });
      const svc = await buildSvc(ds, buildTransportSvc(), buildAtpSvc({ checks: atpChecks }));
      const r = await svc.generate({ allocationRunId: '42', transportPlanId: '50', atpRunId: '80' });
      expect(r.status).toBe('COMPLETED');
      expect(r.skippedAtpBlockedCount).toBe(1);
      expect(r.totalPoCount).toBe(0);  // cell skipped
    });
  });

  describe('US-2b: ATP FAIL skip cell', () => {
    it('skips cell with FAIL result, increments skippedAtpFailCount, run still COMPLETED', async () => {
      const atpChecks = new Map([
        [atpCellKey('10', '20', '2026-04-21'), {
          result: 'FAIL', reason: 'ZERO_STOCK', atpQty: 0, urgencyRanking: null,
        }],
      ]);
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM po_run') && sql.includes('is_force_rerun = FALSE')) return [];
          if (sql.includes('INSERT INTO po_run') && sql.includes('RUNNING')) return [{ id: '901' }];
          if (sql.includes('FROM allocation_run')) return [{ policy_run_id: '99', plan_run_id: '10' }];
          if (sql.includes('FROM system_config')) return [{ config_value: 'true' }];
          if (sql.includes('FROM allocation_leg')) return [{
            leg_id: '1', source_type: 'NM', source_entity_id: '0',
            source_period_start: null, cn_id: '5', sku_id: '20',
            is_top_up: false, effective_period: '2026-04-21',
            allocated_qty: 500, resolved_nm_id: '10', planner_review_required: false,
          }];
          if (sql.includes('UPDATE po_run')) return [];
          if (sql.includes('COALESCE(MAX(id)') && sql.includes('po_header')) return [{ n: 1 }];
          return [];
        }),
      });
      const svc = await buildSvc(ds, buildTransportSvc(), buildAtpSvc({ checks: atpChecks }));
      const r = await svc.generate({ allocationRunId: '42', transportPlanId: '50', atpRunId: '80' });
      expect(r.status).toBe('COMPLETED');
      expect(r.skippedAtpFailCount).toBe(1);
      expect(r.totalPoCount).toBe(0);
    });
  });

  describe('getPoFulfillment (M28 contract — H4 per-line)', () => {
    it('throws NotFoundException when PO not found', async () => {
      const ds = buildDs({
        query: jest.fn().mockResolvedValue([]),
      });
      const svc = await buildSvc(ds);
      await expect(svc.getPoFulfillment('999')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns per-line array for M28 honoring rate backfill', async () => {
      const ds = buildDs({
        query: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM po_header') && sql.includes('po_tracking')) {
            return [{ id: '1', po_number: 'PO-202604-00001', nm_id: '10', cn_id: '5', status: 'CLOSED',
              confirmed_at: new Date(), cancelled_at: null,
              nm_ship_date: new Date(), cn_received_date: new Date(), lt_actual_days: 2 }];
          }
          if (sql.includes('FROM po_line')) {
            return [
              { id: '101', sku_id: '20', variant_code: null, source_period_start: '2026-04-21',
                requested_qty: 500, confirmed_qty: 500, actual_received_qty: 490,
                is_top_up: false, delivery_incomplete: true, delivery_note: 'hư 10m²' },
            ];
          }
          return [];
        }),
      });
      const svc = await buildSvc(ds);
      const result = await svc.getPoFulfillment('1');
      expect(result.poId).toBe('1');
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0].actualReceivedQty).toBe(490);
      expect(result.lines[0].deliveryIncomplete).toBe(true);
      expect(result.ltActualDays).toBe(2);
    });
  });
});

// ─── PoTransitionService tests ─────────────────────────────────────────────────

describe('PoTransitionService', () => {
  function buildTransDs(poStatus: string, overrides: Record<string, unknown> = {}) {
    const ds: Record<string, unknown> = {
      transaction: jest.fn().mockImplementation((cb: (em: unknown) => Promise<unknown>) =>
        cb({
          query: jest.fn().mockImplementation(async (sql: string) => {
            if (sql.includes('FROM po_header')) return [{ id: '1', status: poStatus, nm_id: '10', cn_id: '5' }];
            if (sql.includes('FROM idempotency_log')) return [];
            if (sql.includes('SUM(confirmed_qty)')) return [{ confirmed_qty: 100 }];
            return [];
          }),
        }),
      ),
      query: jest.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM po_header')) return [{ id: '1', status: poStatus, nm_id: '10', cn_id: '5' }];
        return [];
      }),
      ...overrides,
    };
    return ds;
  }

  async function buildTransSvc(ds: unknown): Promise<PoTransitionService> {
    const mod = await Test.createTestingModule({
      providers: [
        PoTransitionService,
        { provide: getDataSourceToken(), useValue: ds },
      ],
    }).compile();
    return mod.get(PoTransitionService);
  }

  it('DRAFT → CONFIRMED succeeds', async () => {
    const ds = buildTransDs('DRAFT');
    const svc = await buildTransSvc(ds);
    const r = await svc.transitionPo('1', { toStatus: 'CONFIRMED', changedBy: 'user1' });
    expect(r.status).toBe('CONFIRMED');
  });

  it('DRAFT → SHIPPED throws InvalidTransitionException', async () => {
    const ds = buildTransDs('DRAFT');
    const svc = await buildTransSvc(ds);
    await expect(svc.transitionPo('1', { toStatus: 'SHIPPED', vehicleNo: 'X', carrierCode: 'C', containerNo: 'N' }))
      .rejects.toBeInstanceOf(InvalidTransitionException);
  });

  it('SHIPPED → CANCELLED throws BadRequest (R11 — cannot cancel after shipped)', async () => {
    const ds = buildTransDs('SHIPPED');
    const svc = await buildTransSvc(ds);
    await expect(svc.transitionPo('1', { toStatus: 'CANCELLED', cancelReason: 'reason reason reason reason reason' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('CONFIRMED → CANCELLED requires reason ≥ 20 chars', async () => {
    const ds = buildTransDs('CONFIRMED');
    const svc = await buildTransSvc(ds);
    await expect(svc.transitionPo('1', { toStatus: 'CANCELLED', cancelReason: 'short' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('CONFIRMED → SHIPPED requires vehicle_no, carrier_code, container_no (R9)', async () => {
    const ds = buildTransDs('CONFIRMED');
    const svc = await buildTransSvc(ds);
    await expect(svc.transitionPo('1', { toStatus: 'SHIPPED' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('SHIPPED → RECEIVED without note when incomplete throws BadRequest (R10)', async () => {
    const ds = buildTransDs('SHIPPED');
    const svc = await buildTransSvc(ds);
    // actual < confirmed (50 < 100) → note mandatory
    await expect(svc.transitionPo('1', { toStatus: 'RECEIVED', actualReceivedQty: 50 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFoundException for unknown PO', async () => {
    const ds = buildTransDs('DRAFT', {
      query: jest.fn().mockResolvedValue([]),
    });
    const svc = await buildTransSvc(ds);
    await expect(svc.transitionPo('999', { toStatus: 'CONFIRMED' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
