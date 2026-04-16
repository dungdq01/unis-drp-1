import { Test, TestingModule } from '@nestjs/testing';
import { FreshnessGateService } from './freshness-gate.service';
import { DataSource } from 'typeorm';

// ─── Factory ──────────────────────────────────────────────────────────────────

async function buildGate(options: {
  dbRows?: object[];
  thresholdMinutes?: number;
}): Promise<FreshnessGateService> {
  const nowMinus = (hours: number) => new Date(Date.now() - hours * 3600_000);

  const defaultRows = options.dbRows ?? [
    { nm_code: 'NM-001', nm_name: 'Mikado', last_synced_at: nowMinus(2) },    // FRESH
    { nm_code: 'NM-002', nm_name: 'Acme', last_synced_at: nowMinus(30) },     // STALE
    { nm_code: 'NM-003', nm_name: 'Delta', last_synced_at: null },             // MISSING
  ];

  const threshold = options.thresholdMinutes ?? 1440;

  const ds = {
    query: jest.fn()
      .mockResolvedValueOnce([{ config_value: String(threshold) }]) // _getThresholdMinutes
      .mockResolvedValueOnce(defaultRows),                           // _queryFreshness
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FreshnessGateService,
      { provide: DataSource, useValue: ds },
    ],
  }).compile();

  return module.get<FreshnessGateService>(FreshnessGateService);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FreshnessGateService', () => {
  describe('check()', () => {
    it('canRun=false when any NM is stale or missing', async () => {
      const svc = await buildGate({});
      const result = await svc.check();
      expect(result.canRun).toBe(false);
      expect(result.staleNms.length).toBeGreaterThan(0);
    });

    it('canRun=true when all NMs are fresh', async () => {
      const svc = await buildGate({
        dbRows: [
          { nm_code: 'NM-001', nm_name: 'Mikado', last_synced_at: new Date(Date.now() - 60 * 60_000) }, // 1h
          { nm_code: 'NM-002', nm_name: 'Acme', last_synced_at: new Date(Date.now() - 2 * 60 * 60_000) }, // 2h
        ],
      });
      const result = await svc.check();
      expect(result.canRun).toBe(true);
      expect(result.staleNms).toHaveLength(0);
      expect(result.freshCount).toBe(2);
    });

    it('MISSING NMs are included in staleNms (canRun=false)', async () => {
      const svc = await buildGate({
        dbRows: [{ nm_code: 'NM-001', nm_name: 'Mikado', last_synced_at: null }],
      });
      const result = await svc.check();
      expect(result.canRun).toBe(false);
      expect(result.staleNms[0].status).toBe('MISSING');
      expect(result.missingCount).toBe(1);
    });

    it('uses threshold from system_config planning.max_stale_minutes', async () => {
      // threshold = 60 min, NM synced 2h ago → STALE
      const svc = await buildGate({
        dbRows: [{ nm_code: 'NM-001', nm_name: 'Mikado', last_synced_at: new Date(Date.now() - 2 * 3600_000) }],
        thresholdMinutes: 60,
      });
      const result = await svc.check();
      expect(result.canRun).toBe(false);
      expect(result.staleNms[0].status).toBe('STALE');
      expect(result.thresholdMinutes).toBe(60);
    });

    it('returns checkedAt as Date', async () => {
      const svc = await buildGate({
        dbRows: [{ nm_code: 'NM-001', nm_name: 'Mikado', last_synced_at: new Date() }],
      });
      const result = await svc.check();
      expect(result.checkedAt).toBeInstanceOf(Date);
    });
  });

  describe('checkAll()', () => {
    it('returns all NMs with correct status classification', async () => {
      const ds = {
        query: jest.fn()
          .mockResolvedValueOnce([{ config_value: '1440' }])
          .mockResolvedValueOnce([
            { nm_code: 'NM-001', nm_name: 'A', last_synced_at: new Date(Date.now() - 1 * 3600_000) },
            { nm_code: 'NM-002', nm_name: 'B', last_synced_at: new Date(Date.now() - 25 * 3600_000) },
            { nm_code: 'NM-003', nm_name: 'C', last_synced_at: null },
          ]),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FreshnessGateService,
          { provide: DataSource, useValue: ds },
        ],
      }).compile();

      const svc = module.get<FreshnessGateService>(FreshnessGateService);
      const results = await svc.checkAll();

      expect(results).toHaveLength(3);
      expect(results.find(r => r.nmCode === 'NM-001')?.status).toBe('FRESH');
      expect(results.find(r => r.nmCode === 'NM-002')?.status).toBe('STALE');
      expect(results.find(r => r.nmCode === 'NM-003')?.status).toBe('MISSING');
    });

    it('hoursSinceSync is null for MISSING NMs', async () => {
      const ds = {
        query: jest.fn()
          .mockResolvedValueOnce([{ config_value: '1440' }])
          .mockResolvedValueOnce([
            { nm_code: 'NM-001', nm_name: 'A', last_synced_at: null },
          ]),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          FreshnessGateService,
          { provide: DataSource, useValue: ds },
        ],
      }).compile();

      const svc = module.get<FreshnessGateService>(FreshnessGateService);
      const results = await svc.checkAll();
      expect(results[0].hoursSinceSync).toBeNull();
    });
  });
});
