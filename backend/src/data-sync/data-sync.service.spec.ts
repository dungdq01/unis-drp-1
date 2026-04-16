import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSyncService } from './data-sync.service';
import { FreshnessGateService } from './freshness-gate.service';
import { SyncLog } from './entities/sync-log.entity';
import { DrpOverrideLog } from './entities/drp-override-log.entity';
import { SupplySnapshot } from '../supply/entities/supply-snapshot.entity';
import { DataSource } from 'typeorm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_CSV = Buffer.from(
  'sku_code,sku_name,uom,available_qty,atp_qty,last_updated\n' +
  'SKU-001,Product A,m2,100.0,80.0,2026-04-16\n' +
  'SKU-002,Product B,m2,50.5,40.0,2026-04-16\n',
);

const MISSING_HEADER_CSV = Buffer.from(
  'sku_code,sku_name,uom,available_qty\n' + // missing atp_qty
  'SKU-001,Product A,m2,100.0\n',
);

const BAD_QTY_CSV = Buffer.from(
  'sku_code,sku_name,uom,available_qty,atp_qty\n' +
  'SKU-001,Product A,m2,-5,80\n',
);

const EMPTY_SKU_CSV = Buffer.from(
  'sku_code,sku_name,uom,available_qty,atp_qty\n' +
  ',Product A,m2,100,80\n',
);

const mockSupplierActive = [{ supplier_code: 'NM-001', supplier_name: 'Mikado' }];
const mockSupplierNone: never[] = [];

// ─── Factory ──────────────────────────────────────────────────────────────────

async function buildModule(overrides: {
  dsQuery?: jest.Mock;
  syncLogSave?: jest.Mock;
  overrideSave?: jest.Mock;
  snapshotSave?: jest.Mock;
  freshnessCheck?: jest.Mock;
  freshnessCheckAll?: jest.Mock;
  syncLogFind?: jest.Mock;
}): Promise<DataSyncService> {
  const syncLogRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    save: overrides.syncLogSave ?? jest.fn().mockImplementation(async (e) => ({ ...e, id: 'log-1' })),
    createQueryBuilder: jest.fn().mockReturnValue({
      orderBy: jest.fn().mockReturnThis(),
      where:   jest.fn().mockReturnThis(),
      skip:    jest.fn().mockReturnThis(),
      take:    jest.fn().mockReturnThis(),
      getManyAndCount: overrides.syncLogFind ?? jest.fn().mockResolvedValue([[], 0]),
    }),
  };

  const overrideRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    save: overrides.overrideSave ?? jest.fn().mockImplementation(async (e) => ({ ...e, id: 'ov-1' })),
  };

  const snapshotRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    save: overrides.snapshotSave ?? jest.fn().mockImplementation(async (e) => ({ ...e, id: 'snap-1' })),
  };

  // DataSource: default returns active supplier
  const dsQuery = overrides.dsQuery ?? jest.fn().mockResolvedValue(mockSupplierActive);

  const ds = {
    query: dsQuery,
    transaction: jest.fn().mockImplementation(async (cb) => {
      const em = {
        create: jest.fn().mockImplementation((_, dto) => ({ ...dto })),
        save: jest.fn().mockImplementation(async (_, e) => ({ ...e, id: 'mock-id' })),
      };
      return cb(em);
    }),
  };

  const freshnessSvc = {
    check: overrides.freshnessCheck ?? jest.fn().mockResolvedValue({
      canRun: true, staleNms: [], freshCount: 2, staleCount: 0, missingCount: 0, thresholdMinutes: 1440,
    }),
    checkAll: overrides.freshnessCheckAll ?? jest.fn().mockResolvedValue([]),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      DataSyncService,
      { provide: getRepositoryToken(SyncLog), useValue: syncLogRepo },
      { provide: getRepositoryToken(DrpOverrideLog), useValue: overrideRepo },
      { provide: getRepositoryToken(SupplySnapshot), useValue: snapshotRepo },
      { provide: DataSource, useValue: ds },
      { provide: FreshnessGateService, useValue: freshnessSvc },
    ],
  }).compile();

  const svc = module.get<DataSyncService>(DataSyncService);
  return svc;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DataSyncService', () => {
  // ── uploadNmCsv ───────────────────────────────────────────────────────────

  describe('uploadNmCsv()', () => {
    it('throws NotFoundException when NM not found or inactive', async () => {
      const svc = await buildModule({
        dsQuery: jest.fn().mockResolvedValue(mockSupplierNone),
      });
      await expect(svc.uploadNmCsv('NM-999', VALID_CSV, 'user1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when CSV header missing atp_qty', async () => {
      const svc = await buildModule({});
      await expect(svc.uploadNmCsv('NM-001', MISSING_HEADER_CSV, 'user1')).rejects.toThrow(BadRequestException);
    });

    it('error message includes template download link on header mismatch', async () => {
      const svc = await buildModule({});
      await expect(svc.uploadNmCsv('NM-001', MISSING_HEADER_CSV, 'user1')).rejects.toThrow(
        /template.*NM-001/i,
      );
    });

    it('throws BadRequestException when available_qty is negative', async () => {
      const svc = await buildModule({});
      await expect(svc.uploadNmCsv('NM-001', BAD_QTY_CSV, 'user1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when sku_code is empty', async () => {
      const svc = await buildModule({});
      await expect(svc.uploadNmCsv('NM-001', EMPTY_SKU_CSV, 'user1')).rejects.toThrow(BadRequestException);
    });

    it('happy path: returns snapshotId, rowsImported=2, syncLogId', async () => {
      const svc = await buildModule({});
      const result = await svc.uploadNmCsv('NM-001', VALID_CSV, 'user1');
      expect(result.rowsImported).toBe(2);
      expect(result.snapshotId).toBeDefined();
      expect(result.syncLogId).toBeDefined();
    });

    it('throws BadRequestException for empty CSV', async () => {
      const svc = await buildModule({});
      const emptyCsv = Buffer.from('sku_code,available_qty,atp_qty\n');
      await expect(svc.uploadNmCsv('NM-001', emptyCsv, 'user1')).rejects.toThrow(BadRequestException);
    });
  });

  // ── generateTemplate ──────────────────────────────────────────────────────

  describe('generateTemplate()', () => {
    it('throws NotFoundException when NM not found', async () => {
      const svc = await buildModule({
        dsQuery: jest.fn().mockResolvedValue(mockSupplierNone),
      });
      await expect(svc.generateTemplate('NM-999')).rejects.toThrow(NotFoundException);
    });

    it('returns CSV with correct headers', async () => {
      const dsQuery = jest.fn()
        .mockResolvedValueOnce(mockSupplierActive) // _requireActiveSupplier
        .mockResolvedValueOnce([                   // SKU query
          { sku_code: 'SKU-001', sku_name: 'Product A', uom: 'm2' },
        ]);
      const svc = await buildModule({ dsQuery });
      const { csv } = await svc.generateTemplate('NM-001');
      expect(csv.startsWith('sku_code,sku_name,uom,available_qty,atp_qty,last_updated')).toBe(true);
      expect(csv).toContain('SKU-001');
    });

    it('returns filename with nmCode and date', async () => {
      const dsQuery = jest.fn()
        .mockResolvedValueOnce(mockSupplierActive)
        .mockResolvedValueOnce([]);
      const svc = await buildModule({ dsQuery });
      const { filename } = await svc.generateTemplate('NM-001');
      expect(filename).toMatch(/template_nm_NM-001_\d{4}-\d{2}-\d{2}\.csv/);
    });
  });

  // ── getDashboard ──────────────────────────────────────────────────────────

  describe('getDashboard()', () => {
    it('returns nms list and checkedAt timestamp', async () => {
      const nms = [
        { nmCode: 'NM-001', nmName: 'Mikado', lastSyncedAt: new Date(), hoursSinceSync: 2, status: 'FRESH' as const },
        { nmCode: 'NM-002', nmName: 'Acme', lastSyncedAt: null, hoursSinceSync: null, status: 'MISSING' as const },
      ];
      const svc = await buildModule({ freshnessCheckAll: jest.fn().mockResolvedValue(nms) });
      const result = await svc.getDashboard();
      expect(result.nms).toHaveLength(2);
      expect(result.nms[0].status).toBe('FRESH');
      expect(result.nms[1].status).toBe('MISSING');
      expect(result.checkedAt).toBeInstanceOf(Date);
    });
  });

  // ── gateCheck ─────────────────────────────────────────────────────────────

  describe('gateCheck()', () => {
    it('returns canRun=true when all NMs fresh', async () => {
      const svc = await buildModule({});
      const result = await svc.gateCheck();
      expect(result.canRun).toBe(true);
      expect(result.staleNms).toHaveLength(0);
    });

    it('returns canRun=false when NMs are stale', async () => {
      const svc = await buildModule({
        freshnessCheck: jest.fn().mockResolvedValue({
          canRun: false,
          staleNms: [{ nmCode: 'NM-001', nmName: 'Mikado', hoursSinceSync: 30, status: 'STALE' }],
          freshCount: 0, staleCount: 1, missingCount: 0, thresholdMinutes: 1440,
          checkedAt: new Date(),
        }),
      });
      const result = await svc.gateCheck();
      expect(result.canRun).toBe(false);
      expect(result.staleNms[0].nmCode).toBe('NM-001');
    });
  });

  // ── runSyncAll ────────────────────────────────────────────────────────────

  describe('runSyncAll()', () => {
    it('creates sync_log for each active NM', async () => {
      const save = jest.fn()
        .mockResolvedValueOnce({ id: 'l1' })
        .mockResolvedValueOnce({ id: 'l2' });

      const dsQuery = jest.fn().mockResolvedValue([
        { supplier_code: 'NM-001' },
        { supplier_code: 'NM-002' },
      ]);

      const svc = await buildModule({ dsQuery, syncLogSave: save });
      const result = await svc.runSyncAll('CRON_06', null);

      expect(result.triggered).toBe(2);
      expect(result.logs).toHaveLength(2);
    });

    it('tolerant: 1 NM fails → others still log (no throw)', async () => {
      let callCount = 0;
      const save = jest.fn().mockImplementation(async (log) => {
        callCount++;
        if (callCount === 1) throw new Error('DB timeout');
        return { id: `l${callCount}` };
      });

      const dsQuery = jest.fn().mockResolvedValue([
        { supplier_code: 'NM-001' },
        { supplier_code: 'NM-002' },
      ]);

      const svc = await buildModule({ dsQuery, syncLogSave: save });
      // Should NOT throw even though first NM failed
      const result = await svc.runSyncAll('CRON_14', null);
      expect(result.triggered).toBe(2);
      expect(result.logs).toHaveLength(2); // both logged (fail + success)
    });
  });

  // ── triggerSyncOne ────────────────────────────────────────────────────────

  describe('triggerSyncOne()', () => {
    it('throws NotFoundException when NM not active', async () => {
      const svc = await buildModule({
        dsQuery: jest.fn().mockResolvedValue([]),
      });
      await expect(svc.triggerSyncOne('NM-999', 'admin')).rejects.toThrow(NotFoundException);
    });

    it('creates sync_log with MANUAL trigger source', async () => {
      const save = jest.fn().mockResolvedValue({ id: 'log-x', triggerSource: 'MANUAL', nmCode: 'NM-001' });
      const svc = await buildModule({ syncLogSave: save });
      const log = await svc.triggerSyncOne('NM-001', 'sc-manager');
      expect(log.triggerSource).toBe('MANUAL');
    });
  });

  // ── override ──────────────────────────────────────────────────────────────

  describe('override()', () => {
    it('throws BadRequestException when reason < 20 chars', async () => {
      const svc = await buildModule({});
      await expect(svc.override({ reason: 'too short', approvedBy: 'admin' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('saves override log with stale NM snapshot', async () => {
      const overrideSave = jest.fn().mockImplementation(async (e) => ({ ...e, id: 'ov-1' }));
      const svc = await buildModule({
        overrideSave,
        freshnessCheck: jest.fn().mockResolvedValue({
          canRun: false,
          staleNms: [{ nmCode: 'NM-001', nmName: 'Mikado', hoursSinceSync: 30, status: 'STALE' }],
          freshCount: 0, staleCount: 1, missingCount: 0, thresholdMinutes: 1440,
          checkedAt: new Date(),
        }),
      });

      const result = await svc.override({
        reason: 'NM Mikado đang bảo trì, dùng data cũ acceptable',
        approvedBy: 'sc-manager-01',
      });

      expect(overrideSave).toHaveBeenCalledWith(
        expect.objectContaining({
          overrideReason: expect.stringContaining('Mikado'),
          approvedBy: 'sc-manager-01',
          staleNms: expect.arrayContaining([
            expect.objectContaining({ nmCode: 'NM-001' }),
          ]),
        }),
      );
      expect(result.id).toBe('ov-1');
    });
  });

  // ── getHistory ────────────────────────────────────────────────────────────

  describe('getHistory()', () => {
    it('returns paginated sync_log data', async () => {
      const mockLogs = [
        { id: '1', nmCode: 'NM-001', status: 'SUCCESS', rowsImported: 50 },
      ];
      const svc = await buildModule({
        syncLogFind: jest.fn().mockResolvedValue([mockLogs, 1]),
      });

      const result = await svc.getHistory({ page: 1, pageSize: 10 });
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });
  });
});
