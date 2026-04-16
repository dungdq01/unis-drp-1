import { UrgencyRankEntry } from '../entities/atp-check.entity';
import { atpCellKey } from '../../common/atp-utils';

// ─── Run DTOs ─────────────────────────────────────────────────────────────────

export interface RunAtpOptions {
  allocationRunId: string;
  createdBy?: string;
  forceRerunReason?: string;
}

export interface RunAtpResult {
  atpRunId: string;
  status: string;
  totalCells: number;
  passCount: number;
  partialCount: number;
  failCount: number;
  blockedCount: number;
  criticalCount: number;
  durationMs: number;
}

// ─── M27 contract (M2 sweep — keyed by allocationRunId) ──────────────────────

export interface AtpCheckDto {
  checkId: string;
  nmId: string;
  skuId: string;
  periodStart: string;
  requestedQty: number;
  atpQty: number | null;
  result: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';
  reason: string | null;
  isAtpNullFallback: boolean;
  urgencyRanking: UrgencyRankEntry[] | null;
}

export interface AtpResultDto {
  atpRunId: string;
  allocationRunId: string;
  planRunId: string;
  generatedAt: Date;
  /** key = atpCellKey(nmId, skuId, weekStart) — same helper as M27 consumer */
  checks: Map<string, AtpCheckDto>;
}

export { atpCellKey };
