import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConflictException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { SsAutoAdjustService } from './ss-auto-adjust.service';
import { LtAutoUpdateService } from './lt-auto-update.service';
import { TrustRefreshService } from './trust-refresh.service';
import { HonoringBackfillService } from './honoring-backfill.service';
import { OverrideAnalysisService } from './override-analysis.service';
import { KpiSnapshotService } from './kpi-snapshot.service';
import { SystemConfigService } from '../system-config/system-config.service';

const mockQuery = jest.fn();
const ds = { query: mockQuery };

const makeService = async () => {
  const ssAutoAdjust   = { run: jest.fn().mockResolvedValue({ adjustedCount: 2, cappedCount: 0 }) };
  const ltAutoUpdate   = { run: jest.fn().mockResolvedValue({ updatedCount: 1 }) };
  const trustRefresh   = { run: jest.fn().mockResolvedValue({ refreshedCount: 3 }) };
  const honoringBackfill = { run: jest.fn().mockResolvedValue({ nmCount: 2, unreliableCount: 0 }) };
  const overrideAnalysis = { run: jest.fn().mockResolvedValue({ totalEdits: 5 }) };
  const kpiSnapshot    = { run: jest.fn().mockResolvedValue({ fillRatePct: 0.9, systemAccuracyPct: 0.8, nmHonoringAvgPct: 0.92 }) };
  const systemConfig   = { isEnabled: jest.fn().mockResolvedValue(true), getValue: jest.fn().mockResolvedValue('20') };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FeedbackService,
      { provide: getDataSourceToken(), useValue: ds },
      { provide: SsAutoAdjustService,   useValue: ssAutoAdjust },
      { provide: LtAutoUpdateService,   useValue: ltAutoUpdate },
      { provide: TrustRefreshService,   useValue: trustRefresh },
      { provide: HonoringBackfillService, useValue: honoringBackfill },
      { provide: OverrideAnalysisService, useValue: overrideAnalysis },
      { provide: KpiSnapshotService,    useValue: kpiSnapshot },
      { provide: SystemConfigService,   useValue: systemConfig },
    ],
  }).compile();

  const svc = module.get(FeedbackService);
  return { svc, ssAutoAdjust, ltAutoUpdate, trustRefresh, honoringBackfill, overrideAnalysis, kpiSnapshot, systemConfig };
};

describe('FeedbackService', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  // US-14: Idempotent reject
  it('throws 409 if snapshot already exists for week (R10)', async () => {
    const { svc } = await makeService();
    mockQuery
      .mockResolvedValueOnce([{ id: '1', status: 'COMPLETED' }]); // existing check
    await expect(svc.runWeekly({ weekStart: '2026-04-13' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  // US-15: Force rerun with reason
  it('allows force rerun with valid reason', async () => {
    const { svc } = await makeService();
    mockQuery
      .mockResolvedValueOnce([{ id: '99' }])     // INSERT snapshot
      .mockResolvedValueOnce([])                  // UPDATE finalize
      .mockResolvedValue([]);
    const result = await svc.runWeekly({
      weekStart: '2026-04-13',
      forceRerunReason: 'M27 actual_received bị thiếu cho 5 PO, backfill manual',
    });
    expect(result.status).toBe('COMPLETED');
  });

  // Force rerun bad reason
  it('throws 400 if forceRerunReason < 20 chars', async () => {
    const { svc } = await makeService();
    await expect(svc.runWeekly({ forceRerunReason: 'too short' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  // Feature flag disabled
  it('throws 503 if m28 feature flag disabled', async () => {
    const { svc, systemConfig } = await makeService();
    systemConfig.isEnabled.mockResolvedValue(false);
    await expect(svc.runWeekly()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  // US-1: Happy path — 9 steps complete
  it('runs 9 steps and returns COMPLETED when all pass', async () => {
    const { svc } = await makeService();
    mockQuery
      .mockResolvedValueOnce([])           // existing check (none)
      .mockResolvedValueOnce([{ id: '5' }]) // INSERT snapshot
      .mockResolvedValueOnce([])           // UPDATE finalize
      .mockResolvedValue([]);
    const result = await svc.runWeekly({ weekStart: '2026-04-13' });
    expect(result.status).toBe('COMPLETED');
  });

  // Step fail → COMPLETED_PARTIAL
  it('returns COMPLETED_PARTIAL when 1 step throws', async () => {
    const { svc, ssAutoAdjust } = await makeService();
    ssAutoAdjust.run.mockRejectedValue(new Error('sigma query timeout'));
    mockQuery
      .mockResolvedValueOnce([])           // existing check
      .mockResolvedValueOnce([{ id: '6' }]) // INSERT
      .mockResolvedValueOnce([])           // UPDATE finalize
      .mockResolvedValue([]);
    const result = await svc.runWeekly({ weekStart: '2026-04-13' });
    expect(result.status).toBe('COMPLETED_PARTIAL');
  });

  // US-2: SS delta small → no cap
  it('SsAutoAdjustService.run called with snapshotId and weekStart', async () => {
    const { svc, ssAutoAdjust } = await makeService();
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '7' }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    await svc.runWeekly({ weekStart: '2026-04-13' });
    expect(ssAutoAdjust.run).toHaveBeenCalledWith('7', '2026-04-13');
  });

  // US-5: LT update — service called
  it('LtAutoUpdateService.run called', async () => {
    const { svc, ltAutoUpdate } = await makeService();
    mockQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '8' }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    await svc.runWeekly({ weekStart: '2026-04-13' });
    expect(ltAutoUpdate.run).toHaveBeenCalled();
  });

  // listSnapshots
  it('listSnapshots queries weekly_kpi_snapshot', async () => {
    const { svc } = await makeService();
    mockQuery.mockResolvedValueOnce([{ id: '1', week_start_date: '2026-04-13', status: 'COMPLETED' }]);
    const rows = await svc.listSnapshots(5);
    expect(rows).toHaveLength(1);
  });
});
