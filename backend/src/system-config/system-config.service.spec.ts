import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { SystemConfig } from './entities/system-config.entity';
import { ConfigAuditLog } from './entities/config-audit-log.entity';
import { DataSource } from 'typeorm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockConfig = (
  group: string,
  key: string,
  value: string,
  sensitive = false,
): Partial<SystemConfig> => ({
  id: '1',
  configGroup: group,
  configKey: key,
  configValue: value,
  valueType: 'number',
  isSensitive: sensitive,
  description: null,
  updatedBy: 'test',
  updatedAt: new Date(),
  createdAt: new Date(),
});

const mockAudit = (id: string): Partial<ConfigAuditLog> => ({
  id,
  configGroup: 'FC_COMMIT',
  configKey: 'commit.hard_tolerance_pct',
  oldValue: '5',
  newValue: '10',
  changedBy: 'tester',
  changedAt: new Date(),
  reason: null,
});

// ─── Factory ───────────────────────────────────────────────────────────────────

function buildService(overrides: {
  configRepo?: Partial<Record<string, jest.Mock>>;
  auditRepo?: Partial<Record<string, jest.Mock>>;
  dsQuery?: jest.Mock;
}) {
  const configRepo = {
    createQueryBuilder: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    }),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation(async (e) => e),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    ...overrides.configRepo,
  };

  const auditRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    save: jest.fn().mockImplementation(async (e) => ({ ...e, id: 'audit-1' })),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    ...overrides.auditRepo,
  };

  const dataSource = {
    query: overrides.dsQuery ?? jest.fn().mockResolvedValue([]),
  };

  return { configRepo, auditRepo, dataSource };
}

async function createModule(
  configRepo: object,
  auditRepo: object,
  dataSource: object,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SystemConfigService,
      { provide: getRepositoryToken(SystemConfig), useValue: configRepo },
      { provide: getRepositoryToken(ConfigAuditLog), useValue: auditRepo },
      { provide: DataSource, useValue: dataSource },
    ],
  }).compile();

  return module.get<SystemConfigService>(SystemConfigService);
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe('SystemConfigService', () => {
  // ── updateConfigs: cross-field commit tolerances ──────────────────────────

  describe('updateConfigs() — cross-field commit.hard < firm < soft', () => {
    it('throws when hard >= firm (both in same payload)', async () => {
      // hard=20, firm=10 → 20 >= 10 → should throw
      const { configRepo, auditRepo, dataSource } = buildService({
        configRepo: {
          findOne: jest.fn().mockResolvedValue(
            mockConfig('FC_COMMIT', 'commit.hard_tolerance_pct', '5'),
          ),
        },
        dsQuery: jest.fn().mockResolvedValue([]),
      });

      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [
            { group: 'FC_COMMIT', key: 'commit.hard_tolerance_pct', value: '20' },
            { group: 'FC_COMMIT', key: 'commit.firm_tolerance_pct', value: '10' },
            { group: 'FC_COMMIT', key: 'commit.soft_tolerance_pct', value: '30' },
          ],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when firm >= soft (both in same payload)', async () => {
      const { configRepo, auditRepo, dataSource } = buildService({
        dsQuery: jest.fn().mockResolvedValue([]),
      });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [
            { group: 'FC_COMMIT', key: 'commit.hard_tolerance_pct', value: '5' },
            { group: 'FC_COMMIT', key: 'commit.firm_tolerance_pct', value: '30' },
            { group: 'FC_COMMIT', key: 'commit.soft_tolerance_pct', value: '20' },
          ],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes when hard(5) < firm(15) < soft(30)', async () => {
      const findOneMock = jest.fn().mockImplementation(({ where }) => {
        const map: Record<string, string> = {
          'commit.hard_tolerance_pct': '5',
          'commit.firm_tolerance_pct': '15',
          'commit.soft_tolerance_pct': '30',
        };
        return Promise.resolve(
          mockConfig('FC_COMMIT', where.configKey, map[where.configKey] ?? '5'),
        );
      });

      const { configRepo, auditRepo, dataSource } = buildService({
        configRepo: { findOne: findOneMock },
      });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      const result = await svc.updateConfigs({
        updates: [
          { group: 'FC_COMMIT', key: 'commit.hard_tolerance_pct', value: '5' },
          { group: 'FC_COMMIT', key: 'commit.firm_tolerance_pct', value: '15' },
          { group: 'FC_COMMIT', key: 'commit.soft_tolerance_pct', value: '30' },
        ],
        updatedBy: 'tester',
      });

      expect(result.updated).toBe(3);
      expect(result.auditIds).toHaveLength(3);
    });
  });

  // ── updateConfigs: cross-field gap_alert_day < gap_escalate_day ──────────

  describe('updateConfigs() — cross-field gap_alert_day < gap_escalate_day', () => {
    it('throws when alert_day >= escalate_day', async () => {
      const { configRepo, auditRepo, dataSource } = buildService({
        dsQuery: jest.fn().mockResolvedValue([]),
      });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [
            { group: 'FC_COMMIT', key: 'commit.gap_alert_day', value: '25' },
            { group: 'FC_COMMIT', key: 'commit.gap_escalate_day', value: '20' },
          ],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes when alert_day(20) < escalate_day(25)', async () => {
      const findOneMock = jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(mockConfig('FC_COMMIT', where.configKey, '20')),
      );
      const { configRepo, auditRepo, dataSource } = buildService({
        configRepo: { findOne: findOneMock },
      });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      const result = await svc.updateConfigs({
        updates: [
          { group: 'FC_COMMIT', key: 'commit.gap_alert_day', value: '20' },
          { group: 'FC_COMMIT', key: 'commit.gap_escalate_day', value: '25' },
        ],
        updatedBy: 'tester',
      });

      expect(result.updated).toBe(2);
    });
  });

  // ── updateConfigs: bounds check ──────────────────────────────────────────

  describe('updateConfigs() — bounds check (out-of-range)', () => {
    it('throws when lcnb.max_distance_km = 30 (below min 50)', async () => {
      const { configRepo, auditRepo, dataSource } = buildService({});
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [{ group: 'LCNB', key: 'lcnb.max_distance_km', value: '30' }],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when lcnb.max_distance_km = 3000 (above max 2000)', async () => {
      const { configRepo, auditRepo, dataSource } = buildService({});
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [{ group: 'LCNB', key: 'lcnb.max_distance_km', value: '3000' }],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when transport.min_fill_ratio = 1.5 (above 1)', async () => {
      const { configRepo, auditRepo, dataSource } = buildService({});
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [{ group: 'TRANSPORT', key: 'transport.min_fill_ratio', value: '1.5' }],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws when b2b.stage_prob has Confirmed != 100', async () => {
      const { configRepo, auditRepo, dataSource } = buildService({});
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [{
            group: 'B2B_PIPELINE',
            key: 'b2b.stage_prob',
            value: JSON.stringify({ Lead: 10, Qualified: 40, Proposal: 65, Committed: 85, Confirmed: 90, Lost: 0 }),
          }],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes lcnb.max_distance_km = 500 (valid)', async () => {
      const findOneMock = jest.fn().mockResolvedValue(
        mockConfig('LCNB', 'lcnb.max_distance_km', '200'),
      );
      const { configRepo, auditRepo, dataSource } = buildService({
        configRepo: { findOne: findOneMock },
      });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      const result = await svc.updateConfigs({
        updates: [{ group: 'LCNB', key: 'lcnb.max_distance_km', value: '500' }],
        updatedBy: 'tester',
      });

      expect(result.updated).toBe(1);
    });
  });

  // ── isEnabled: cache hit ─────────────────────────────────────────────────

  describe('isEnabled() — cache', () => {
    it('returns cached value and does NOT query DB on second call within TTL', async () => {
      const dsQuery = jest.fn().mockResolvedValue([{ enabled: true }]);
      const { configRepo, auditRepo, dataSource } = buildService({ dsQuery });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      // First call — cache miss → DB query
      const first = await svc.isEnabled('m11_demand_v2_enabled');
      expect(first).toBe(true);
      expect(dsQuery).toHaveBeenCalledTimes(1);

      // Second call — cache hit → NO DB query
      const second = await svc.isEnabled('m11_demand_v2_enabled');
      expect(second).toBe(true);
      expect(dsQuery).toHaveBeenCalledTimes(1); // still 1
    });

    it('returns false (env fallback) when flag not found in DB', async () => {
      const dsQuery = jest.fn().mockResolvedValue([]); // no row
      const { configRepo, auditRepo, dataSource } = buildService({ dsQuery });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      // No env var set → default false
      const result = await svc.isEnabled('nonexistent_flag');
      expect(result).toBe(false);
    });

    it('queries DB on cache miss (different key)', async () => {
      const dsQuery = jest.fn().mockResolvedValue([{ enabled: false }]);
      const { configRepo, auditRepo, dataSource } = buildService({ dsQuery });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await svc.isEnabled('flag_a');
      await svc.isEnabled('flag_b');

      // Two different keys → two DB queries
      expect(dsQuery).toHaveBeenCalledTimes(2);
    });
  });

  // ── updateFlag ────────────────────────────────────────────────────────────

  describe('updateFlag()', () => {
    it('throws NotFoundException when flag does not exist in DB', async () => {
      const dsQuery = jest.fn().mockResolvedValue([]); // UPDATE returns no rows
      const { configRepo, auditRepo, dataSource } = buildService({ dsQuery });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateFlag('nonexistent_flag', true, 'admin'),
      ).rejects.toThrow(NotFoundException);
    });

    it('invalidates cache after toggle so next isEnabled re-queries DB', async () => {
      // First: isEnabled returns true from DB
      // Then: updateFlag to false
      // Then: isEnabled should re-query (cache was cleared)
      const dsQuery = jest
        .fn()
        // 1st call: isEnabled → cache miss → DB returns true
        .mockResolvedValueOnce([{ enabled: true }])
        // 2nd call: updateFlag UPDATE → returns row
        .mockResolvedValueOnce([{ flag_name: 'm11_demand_v2_enabled' }])
        // 3rd call: isEnabled after flag cleared → DB returns false
        .mockResolvedValueOnce([{ enabled: false }]);

      const { configRepo, auditRepo, dataSource } = buildService({ dsQuery });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      const before = await svc.isEnabled('m11_demand_v2_enabled');
      expect(before).toBe(true);

      await svc.updateFlag('m11_demand_v2_enabled', false, 'admin');

      const after = await svc.isEnabled('m11_demand_v2_enabled');
      expect(after).toBe(false);

      // DB was queried 3 times (cache cleared by updateFlag)
      expect(dsQuery).toHaveBeenCalledTimes(3);
    });

    it('returns updated flag state on success', async () => {
      const dsQuery = jest.fn().mockResolvedValue([{ flag_name: 'm11_demand_v2_enabled' }]);
      const { configRepo, auditRepo, dataSource } = buildService({ dsQuery });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      const result = await svc.updateFlag('m11_demand_v2_enabled', true, 'admin');

      expect(result).toEqual({ flagName: 'm11_demand_v2_enabled', enabled: true });
    });

    it('writes audit log entry on toggle', async () => {
      const dsQuery = jest.fn().mockResolvedValue([{ flag_name: 'm11_demand_v2_enabled' }]);
      const auditSave = jest.fn().mockResolvedValue({ id: 'audit-99' });
      const auditCreate = jest.fn().mockImplementation((dto) => ({ ...dto }));
      const { configRepo, dataSource } = buildService({ dsQuery });

      const svc = await createModule(
        configRepo,
        { create: auditCreate, save: auditSave, findAndCount: jest.fn().mockResolvedValue([[], 0]) },
        dataSource,
      );

      await svc.updateFlag('m11_demand_v2_enabled', true, 'qa-engineer');

      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          configGroup: 'FEATURE_FLAG',
          configKey: 'm11_demand_v2_enabled',
          changedBy: 'qa-engineer',
          newValue: 'true',
          oldValue: 'false',
        }),
      );
      expect(auditSave).toHaveBeenCalled();
    });
  });

  // ── listFlags ─────────────────────────────────────────────────────────────

  describe('listFlags()', () => {
    it('returns mapped flag list ordered by name', async () => {
      const dbRows = [
        { flag_name: 'm11_demand_v2_enabled', enabled: false, description: 'M11', updated_at: new Date() },
        { flag_name: 'm12_saop_consensus_enabled', enabled: true, description: 'M12', updated_at: new Date() },
      ];
      const dsQuery = jest.fn().mockResolvedValue(dbRows);
      const { configRepo, auditRepo, dataSource } = buildService({ dsQuery });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      const flags = await svc.listFlags();

      expect(flags).toHaveLength(2);
      expect(flags[0]).toMatchObject({ flagName: 'm11_demand_v2_enabled', enabled: false });
      expect(flags[1]).toMatchObject({ flagName: 'm12_saop_consensus_enabled', enabled: true });
    });
  });

  // ── updateConfigs: NotFoundException when key missing ───────────────────

  describe('updateConfigs() — NotFoundException', () => {
    it('throws NotFoundException when config key does not exist in DB', async () => {
      const { configRepo, auditRepo, dataSource } = buildService({
        configRepo: {
          findOne: jest.fn().mockResolvedValue(null),
        },
      });
      const svc = await createModule(configRepo, auditRepo, dataSource);

      await expect(
        svc.updateConfigs({
          updates: [{ group: 'PLANNING', key: 'planning.max_stale_minutes', value: '60' }],
          updatedBy: 'tester',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
