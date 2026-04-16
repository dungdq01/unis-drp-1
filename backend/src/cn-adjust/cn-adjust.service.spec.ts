import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CnAdjustService } from './cn-adjust.service';
import { TrustScoreService } from './trust-score.service';
import { CnDemandAdjustment } from './entities/cn-demand-adjustment.entity';
import { CnAdjustAuditLog } from './entities/cn-adjust-audit-log.entity';
import { ReasonCode } from './entities/reason-code.entity';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RC_OTHER: ReasonCode = {
  code: 'OTHER', labelVi: 'Lý do khác', isActive: true, createdAt: new Date(),
};

const mockAdj = (overrides: Partial<CnDemandAdjustment> = {}): CnDemandAdjustment => ({
  id: '1', cnId: '10', skuId: '20',
  periodDate: '2026-04-20', fcQty: 1000, adjustedQty: 1100,
  deltaPct: 10, reasonCode: 'OTHER', reasonText: null,
  status: 'PENDING', submittedBy: 'cn-user', submittedAt: new Date(),
  reviewedBy: null, reviewedAt: null, reviewNote: null,
  actualQty: null, isAccurate: null, createdAt: new Date(),
  ...overrides,
});

// ─── Factory ──────────────────────────────────────────────────────────────────

async function buildSvc(opts: {
  cutoffPast?: boolean;
  tolerance?: number;
  autoApproveThreshold?: number;
  trustScore?: number;
  reasonFound?: ReasonCode | null;
  adjFindOne?: CnDemandAdjustment | null;
  adjSave?: jest.Mock;
  auditSave?: jest.Mock;
  dsQuery?: jest.Mock;
  qbResult?: [CnDemandAdjustment[], number];
}): Promise<CnAdjustService> {
  // Default: before cutoff (12:00 VN), tolerance=30, autoApprove=85, trust=100
  const cutoffPast = opts.cutoffPast ?? false;

  // dsQuery sequence: cutoff → tolerance → autoApprove → expire-old → insert
  const dsQuery = opts.dsQuery ?? jest.fn()
    .mockResolvedValueOnce([{ config_value: cutoffPast ? '"08:00"' : '"23:59"' }]) // cutoff
    .mockResolvedValueOnce([{ config_value: String(opts.tolerance ?? 30) }])       // tolerance
    .mockResolvedValueOnce([{ config_value: String(opts.autoApproveThreshold ?? 85) }]) // autoApprove
    .mockResolvedValue([]);                                                         // subsequent queries

  const adjRepo = {
    findOne: jest.fn().mockResolvedValue(opts.adjFindOne ?? null),
    find:    jest.fn().mockResolvedValue([]),
    save:    opts.adjSave ?? jest.fn().mockImplementation(async (e) => ({ ...e, id: '99' })),
    create:  jest.fn().mockImplementation((dto) => ({ ...dto })),
    createQueryBuilder: jest.fn().mockReturnValue({
      where:     jest.fn().mockReturnThis(),
      andWhere:  jest.fn().mockReturnThis(),
      orderBy:   jest.fn().mockReturnThis(),
      skip:      jest.fn().mockReturnThis(),
      take:      jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue(opts.qbResult ?? [[], 0]),
    }),
  };

  const auditRepo = {
    create: jest.fn().mockImplementation((dto) => ({ ...dto })),
    save: opts.auditSave ?? jest.fn().mockResolvedValue({ id: 'a1' }),
  };

  const reasonRepo = {
    findOne: jest.fn().mockResolvedValue(opts.reasonFound !== undefined ? opts.reasonFound : RC_OTHER),
    find:    jest.fn().mockResolvedValue([RC_OTHER]),
  };

  const trustSvc = {
    getForCn: jest.fn().mockResolvedValue({ score: opts.trustScore ?? 100, isGracePeriod: true }),
    getAll:   jest.fn().mockResolvedValue([]),
    recalculateAll: jest.fn().mockResolvedValue({ updated: 0 }),
  };

  const ds = {
    query: dsQuery,
    transaction: jest.fn().mockImplementation(async (cb) => {
      const em = {
        query:  jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation((_, dto) => ({ ...dto })),
        save:   jest.fn().mockImplementation(async (_, e) => ({ ...e, id: 'tx-id' })),
      };
      return cb(em);
    }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CnAdjustService,
      { provide: getRepositoryToken(CnDemandAdjustment), useValue: adjRepo },
      { provide: getRepositoryToken(CnAdjustAuditLog),   useValue: auditRepo },
      { provide: getRepositoryToken(ReasonCode),         useValue: reasonRepo },
      { provide: DataSource,                             useValue: ds },
      { provide: TrustScoreService,                      useValue: trustSvc },
    ],
  }).compile();

  return module.get<CnAdjustService>(CnAdjustService);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CnAdjustService', () => {
  // ── submitAdjustment: cutoff ──────────────────────────────────────────────

  describe('submitAdjustment() — cutoff', () => {
    it('throws BadRequestException after cutoff (08:00 config, tested at "current time")', async () => {
      // Simulate cutoff in past by setting cutoff to "00:00" (always past)
      const dsQuery = jest.fn()
        .mockResolvedValueOnce([{ config_value: '"00:00"' }]); // cutoff = 00:00 → always past
      const svc = await buildSvc({ dsQuery });

      await expect(svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1100,
        reasonCode: 'OTHER', submittedBy: 'cn-user',
      })).rejects.toThrow(BadRequestException);
    });

    it('allows submit before cutoff (cutoff = 23:59)', async () => {
      const svc = await buildSvc({ cutoffPast: false });
      const result = await svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1100,
        reasonCode: 'OTHER', submittedBy: 'cn-user',
      });
      expect(result).toBeDefined();
    });
  });

  // ── submitAdjustment: tolerance + auto-approve ────────────────────────────

  describe('submitAdjustment() — tolerance + auto-approve logic', () => {
    it('AUTO_APPROVED when within tolerance AND trust >= 85', async () => {
      const svc = await buildSvc({ trustScore: 92, tolerance: 30 });
      const result = await svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1200, // +20% within 30%
        reasonCode: 'OTHER', submittedBy: 'cn-user',
      });
      expect(result.status).toBe('AUTO_APPROVED');
    });

    it('PENDING when within tolerance but trust < 85', async () => {
      const svc = await buildSvc({ trustScore: 70, tolerance: 30 });
      const result = await svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1200,
        reasonCode: 'OTHER', submittedBy: 'cn-user',
      });
      expect(result.status).toBe('PENDING');
    });

    it('PENDING when delta vượt tolerance (regardless of trust)', async () => {
      const svc = await buildSvc({ trustScore: 95, tolerance: 30 });
      const result = await svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1450, // +45% > 30%
        reasonCode: 'OTHER', reasonText: 'reason text phải đủ 20 chars yeah',
        submittedBy: 'cn-user',
      });
      expect(result.status).toBe('PENDING');
    });

    it('throws BadRequestException khi vượt tolerance nhưng không có reason_text (M4 fix)', async () => {
      const svc = await buildSvc({ trustScore: 95, tolerance: 30 });
      await expect(svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1450, // +45% > 30%
        reasonCode: 'OTHER',
        submittedBy: 'cn-user',
        // no reasonText
      })).rejects.toThrow(BadRequestException);
    });

    it('effective tolerance = 15% when trust < 60 (R8)', async () => {
      const svc = await buildSvc({ trustScore: 55, tolerance: 30 });
      // +20% — within 30% but > 15% (effective)
      await expect(svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1200,
        reasonCode: 'OTHER',
        submittedBy: 'cn-user',
      })).rejects.toThrow(/reason_text bắt buộc/);
    });
  });

  // ── submitAdjustment: reason_code validation ──────────────────────────────

  describe('submitAdjustment() — reason_code', () => {
    it('throws BadRequestException when reason_code not found', async () => {
      const dsQuery = jest.fn()
        .mockResolvedValueOnce([{ config_value: '"23:59"' }]);
      const svc = await buildSvc({ dsQuery, reasonFound: null });
      await expect(svc.submitAdjustment({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1100,
        reasonCode: 'INVALID_CODE', submittedBy: 'cn-user',
      })).rejects.toThrow(BadRequestException);
    });
  });

  // ── forceSubmit ───────────────────────────────────────────────────────────

  describe('forceSubmit()', () => {
    it('throws when reasonText < 20 chars', async () => {
      const svc = await buildSvc({});
      await expect(svc.forceSubmit({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1100,
        reasonCode: 'OTHER', reasonText: 'short',
        submittedBy: 'sc-manager',
      }, 'sc-manager')).rejects.toThrow(BadRequestException);
    });

    it('creates FORCE_APPROVED regardless of cutoff', async () => {
      // Even with cutoff=00:00 (past), force bypasses it
      const svc = await buildSvc({ cutoffPast: true });
      const result = await svc.forceSubmit({
        cnId: '10', skuId: '20', periodDate: '2026-04-16',
        fcQty: 1000, adjustedQty: 1100,
        reasonCode: 'OTHER',
        reasonText: 'SC Manager force: NM đang bảo trì hệ thống',
        submittedBy: 'sc-manager',
      }, 'sc-manager');
      expect(result.status).toBe('FORCE_APPROVED');
    });
  });

  // ── approve / reject ──────────────────────────────────────────────────────

  describe('approve()', () => {
    it('changes status to APPROVED and saves reviewedBy', async () => {
      const pendingAdj = mockAdj({ status: 'PENDING' });
      const save = jest.fn().mockImplementation(async (e) => ({ ...e }));
      const svc = await buildSvc({ adjFindOne: pendingAdj, adjSave: save });
      const result = await svc.approve('1', { reviewedBy: 'sc-manager', reviewNote: 'OK' });
      expect(result.status).toBe('APPROVED');
      expect(result.reviewedBy).toBe('sc-manager');
    });

    it('throws BadRequestException when status is not PENDING', async () => {
      const svc = await buildSvc({ adjFindOne: mockAdj({ status: 'APPROVED' }) });
      await expect(svc.approve('1', { reviewedBy: 'sc-mgr' })).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when adjustment not found', async () => {
      const svc = await buildSvc({ adjFindOne: null });
      await expect(svc.approve('999', { reviewedBy: 'sc-mgr' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('reject()', () => {
    it('changes status to REJECTED with reviewNote', async () => {
      const pendingAdj = mockAdj({ status: 'PENDING' });
      const save = jest.fn().mockImplementation(async (e) => ({ ...e }));
      const svc = await buildSvc({ adjFindOne: pendingAdj, adjSave: save });
      const result = await svc.reject('1', { reviewedBy: 'sc-mgr', reviewNote: 'Không hợp lý' });
      expect(result.status).toBe('REJECTED');
      expect(result.reviewNote).toBe('Không hợp lý');
    });
  });

  // ── getEffectiveDemand ────────────────────────────────────────────────────

  describe('getEffectiveDemand()', () => {
    it('returns Map keyed by cnId|skuId', async () => {
      const dsQuery = jest.fn().mockResolvedValue([
        { cn_id: '10', sku_id: '20', adjusted_qty: '1200' },
        { cn_id: '11', sku_id: '21', adjusted_qty: '800' },
      ]);
      const svc = await buildSvc({ dsQuery });
      const map = await svc.getEffectiveDemand('2026-04-20');
      expect(map.get('10|20')).toBe(1200);
      expect(map.get('11|21')).toBe(800);
      expect(map.size).toBe(2);
    });

    it('returns empty Map when no approved adjustments', async () => {
      const dsQuery = jest.fn().mockResolvedValue([]);
      const svc = await buildSvc({ dsQuery });
      const map = await svc.getEffectiveDemand('2026-04-20');
      expect(map.size).toBe(0);
    });
  });

  // ── expirePendingCutoff ───────────────────────────────────────────────────

  describe('expirePendingCutoff()', () => {
    it('returns count of expired rows', async () => {
      const dsQuery = jest.fn().mockResolvedValue([
        { id: '1', cn_id: '10', sku_id: '20' },
        { id: '2', cn_id: '11', sku_id: '21' },
      ]);
      const svc = await buildSvc({ dsQuery });
      const result = await svc.expirePendingCutoff();
      expect(result.expired).toBe(2);
    });

    it('returns 0 when no PENDING adjustments today', async () => {
      const dsQuery = jest.fn().mockResolvedValue([]);
      const svc = await buildSvc({ dsQuery });
      const result = await svc.expirePendingCutoff();
      expect(result.expired).toBe(0);
    });
  });

  // ── period_date normalization ─────────────────────────────────────────────

  describe('period_date normalization (mondayOf)', () => {
    it('normalizes any day of week to Monday', async () => {
      // 2026-04-16 is Thursday → normalized to 2026-04-13 (Monday)
      let capturedPeriodDate: string | undefined;
      const ds = {
        query: jest.fn()
          .mockResolvedValueOnce([{ config_value: '"23:59"' }])  // cutoff
          .mockResolvedValueOnce([{ config_value: '30' }])        // tolerance
          .mockResolvedValueOnce([{ config_value: '85' }]),       // autoApprove
        transaction: jest.fn().mockImplementation(async (cb) => {
          const em = {
            query:  jest.fn().mockResolvedValue([]),
            create: jest.fn().mockImplementation((_, dto) => {
              capturedPeriodDate = dto.periodDate;
              return { ...dto };
            }),
            save: jest.fn().mockImplementation(async (_, e) => ({ ...e, id: 'x' })),
          };
          return cb(em);
        }),
      };
      const svc = await buildSvc({ dsQuery: ds.query });
      // Patch the dataSource
      (svc as any).dataSource = ds;

      await svc.submitAdjustment({
        cnId: '10', skuId: '20',
        periodDate: '2026-04-16',  // Thursday
        fcQty: 1000, adjustedQty: 1050,
        reasonCode: 'OTHER', submittedBy: 'cn-user',
      });

      expect(capturedPeriodDate).toBe('2026-04-13'); // Monday of that week
    });
  });

  // ── getReasonCodes ────────────────────────────────────────────────────────

  describe('getReasonCodes()', () => {
    it('returns active reason codes', async () => {
      const svc = await buildSvc({});
      const codes = await svc.getReasonCodes();
      expect(codes).toHaveLength(1);
      expect(codes[0].code).toBe('OTHER');
    });
  });
});
