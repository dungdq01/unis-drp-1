const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

function apiUrl(path: string) {
  return `${BASE_URL}/api/v1${path}`;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AllocationRun {
  id: string;
  planRunId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  totalDemandLines: number;
  totalAllocated: number;
  totalPartial: number;
  totalUnallocated: number;
  fillRateOverall: number | null;
  fillRateA: number | null;
  fillRateB: number | null;
  fillRateC: number | null;
  configSnapshot: Record<string, unknown> | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AllocationResult {
  id: string;
  allocationRunId: string;
  plannedOrderId: string;
  itemCode: string;
  destLocationCode: string;
  sourceLocationCode: string | null;
  lotNumber: string;
  qtyRequired: number;
  qtyAllocated: number;
  fillRate: number | null;
  abcClass: 'A' | 'B' | 'C' | null;
  sourcePriority: number;
  status: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED';
  layerTrace: Record<string, unknown>;
  weekNumber: number;
  createdAt: string;
}

export interface AllocationRecommendation {
  id: string;
  allocationRunId: string;
  type: 'LCNB_LATERAL_TRANSFER';
  fromLocationCode: string;
  toLocationCode: string;
  itemCode: string;
  suggestedQty: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface AllocationSummary {
  runId: string;
  fillRateOverall: number | null;
  fillRateByClass: { A: number | null; B: number | null; C: number | null };
  topSources: { sourceLocationCode: string; totalAllocated: number }[];
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export async function createAllocationRun(planRunId: string, createdBy?: string): Promise<AllocationRun> {
  const res = await fetch(apiUrl('/allocation/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planRunId, createdBy }),
  });
  return handleResponse<AllocationRun>(res);
}

export async function fetchAllocationRuns(page = 1, pageSize = 20): Promise<{ data: AllocationRun[]; meta: PageMeta }> {
  const res = await fetch(apiUrl(`/allocation/runs?page=${page}&pageSize=${pageSize}`), { cache: 'no-store' });
  return handleResponse(res);
}

export async function fetchAllocationRun(id: string): Promise<AllocationRun> {
  const res = await fetch(apiUrl(`/allocation/runs/${id}`), { cache: 'no-store' });
  return handleResponse<AllocationRun>(res);
}

export async function fetchAllocationResults(
  id: string,
  params: {
    page?: number;
    pageSize?: number;
    status?: string;
    itemCode?: string;
    destLocationCode?: string;
    sourceLocationCode?: string;
    abcClass?: string;
  } = {},
): Promise<{ data: AllocationResult[]; meta: PageMeta }> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.status) q.set('status', params.status);
  if (params.itemCode) q.set('itemCode', params.itemCode);
  if (params.destLocationCode) q.set('destLocationCode', params.destLocationCode);
  if (params.sourceLocationCode) q.set('sourceLocationCode', params.sourceLocationCode);
  if (params.abcClass) q.set('abcClass', params.abcClass);
  const res = await fetch(`${apiUrl(`/allocation/runs/${id}/results`)}?${q}`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function fetchAllocationSummary(id: string): Promise<AllocationSummary> {
  const res = await fetch(apiUrl(`/allocation/runs/${id}/summary`), { cache: 'no-store' });
  return handleResponse<AllocationSummary>(res);
}

export async function fetchAllocationRecommendations(
  id: string,
  params: { page?: number; pageSize?: number; status?: string } = {},
): Promise<{ data: AllocationRecommendation[]; meta: PageMeta }> {
  const q = new URLSearchParams();
  if (params.page) q.set('page', String(params.page));
  if (params.pageSize) q.set('pageSize', String(params.pageSize));
  if (params.status) q.set('status', params.status);
  const res = await fetch(`${apiUrl(`/allocation/runs/${id}/recommendations`)}?${q}`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function decideAllocationRecommendation(
  recId: string,
  decision: 'ACCEPTED' | 'REJECTED',
  opts: { adjustedQty?: number; note?: string; decidedBy?: string } = {},
): Promise<AllocationRecommendation> {
  const res = await fetch(apiUrl(`/allocation/recommendations/${recId}/decide`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, ...opts }),
  });
  return handleResponse<AllocationRecommendation>(res);
}

// ═══════════════════════════════════════════════════════════════════════════════
// M24 — Allocation Engine LCNB v2 API
// ═══════════════════════════════════════════════════════════════════════════════

export type LegSourceType = 'HUB' | 'CN_REDIST' | 'NM' | 'TOP_UP_NEXT_WEEK' | 'UNKNOWN';
export type AllocV2ResultStatus = 'FULL' | 'PARTIAL' | 'PARTIAL_STOCKOUT' | 'UNALLOCATED' | 'ALLOCATED';

export interface AllocationV2Run {
  id: string;
  planRunId: string;
  policyRunId: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'BLOCKED_M23_NOT_READY';
  lcnbEnabled: boolean;
  totalDemandLines: number;
  totalAllocated: number;
  totalLegsCount: number;
  lcnbTransfersCount: number;
  partialStockoutCount: number;
  isForceRerun: boolean;
  forceRerunReason: string | null;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AllocationV2Result {
  id: string;
  allocationRunId: string;
  cnId: string | null;
  skuId: string | null;
  periodStart: string | null;
  itemCode: string;
  destLocationCode: string;
  qtyRequired: number;
  qtyAllocated: number;
  status: AllocV2ResultStatus;
  plannerReviewRequired: boolean;
  reviewReason: string | null;
  variantBreakdown: Record<string, number> | null;
  // Top-up cross-module contract (M25/M26/M27)
  isTopUp: boolean;
  sourceTopUpId: string | null;
  sourcePeriodStart: string | null;
}

export interface AllocationV2Leg {
  id: string;
  allocationResultId: string;
  sourceType: LegSourceType;
  sourceEntityId: string;
  sourceLotId: string | null;
  allocatedQty: number;
  fifoRank: number | null;
  distanceKm: number | null;
  sourcePeriodStart: string | null;
  originTopUpId: string | null;
  recipientCnId?: string;
  skuId?: string;
  periodStart?: string;
}

export interface AllocationV2RunSummary {
  allocationRunId: string;
  status: string;
  totalDemandLines: number;
  totalAllocatedQty: number;
  fullAllocatedCount: number;
  totalLegs: number;
  lcnbTransfers: number;
  partialStockout: number;
  durationMs: number;
}

export interface LcnbSummaryRow {
  donor_cn_id: string;
  recipient_cn_id: string;
  transfer_count: number;
  total_qty: number;
  avg_distance_km: number;
  total_km: number;
}

/** POST /allocation/v2/run */
export async function runAllocationV2(planRunId: string, userId?: string): Promise<AllocationV2RunSummary> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  const res = await fetch(apiUrl('/allocation/v2/run'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ planRunId }),
  });
  return handleResponse<AllocationV2RunSummary>(res);
}

/** POST /allocation/v2/run/force-rerun */
export async function forceRerunAllocationV2(
  planRunId: string,
  reason: string,
  userId?: string,
): Promise<AllocationV2RunSummary> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) headers['x-user-id'] = userId;
  const res = await fetch(apiUrl('/allocation/v2/run/force-rerun'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ planRunId, reason }),
  });
  return handleResponse<AllocationV2RunSummary>(res);
}

/** GET /allocation/v2/runs?planRunId=&page=&limit= */
export async function listAllocationV2Runs(opts: {
  planRunId?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ data: AllocationV2Run[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams();
  if (opts.planRunId) params.set('planRunId', opts.planRunId);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(apiUrl(`/allocation/v2/runs${qs ? `?${qs}` : ''}`));
  return handleResponse(res);
}

/** GET /allocation/v2/runs/:id */
export async function getAllocationV2Run(id: string): Promise<AllocationV2Run> {
  const res = await fetch(apiUrl(`/allocation/v2/runs/${id}`));
  return handleResponse<AllocationV2Run>(res);
}

/** GET /allocation/v2/runs/:id/legs?sourceType=&page=&limit= */
export async function listAllocationV2Legs(
  runId: string,
  opts: { sourceType?: LegSourceType; page?: number; limit?: number } = {},
): Promise<{ data: AllocationV2Leg[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams();
  if (opts.sourceType) params.set('sourceType', opts.sourceType);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(apiUrl(`/allocation/v2/runs/${runId}/legs${qs ? `?${qs}` : ''}`));
  return handleResponse(res);
}

/** GET /allocation/v2/runs/:id/results?cnId=&status=&page=&limit= */
export async function listAllocationV2Results(
  runId: string,
  opts: { cnId?: string; status?: AllocV2ResultStatus; page?: number; limit?: number } = {},
): Promise<{ data: AllocationV2Result[]; total: number; page: number; limit: number }> {
  const params = new URLSearchParams();
  if (opts.cnId) params.set('cnId', opts.cnId);
  if (opts.status) params.set('status', opts.status);
  if (opts.page) params.set('page', String(opts.page));
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const res = await fetch(apiUrl(`/allocation/v2/runs/${runId}/results${qs ? `?${qs}` : ''}`));
  return handleResponse(res);
}

/** GET /allocation/v2/runs/:id/lcnb-summary */
export async function getLcnbSummary(runId: string): Promise<LcnbSummaryRow[]> {
  const res = await fetch(apiUrl(`/allocation/v2/runs/${runId}/lcnb-summary`));
  return handleResponse<LcnbSummaryRow[]>(res);
}

/** GET /allocation/v2/runs/:id/review-required */
export async function getReviewRequired(runId: string): Promise<AllocationV2Result[]> {
  const res = await fetch(apiUrl(`/allocation/v2/runs/${runId}/review-required`));
  return handleResponse<AllocationV2Result[]>(res);
}

/** GET /allocation/v2/runs/:id/result — M24→M25 contract (lines as object keyed by drpCellKey) */
export async function getAllocationV2FullResult(runId: string): Promise<{
  allocationRunId: string;
  planRunId: string;
  policyRunId: string | null;
  generatedAt: string;
  results: Record<string, AllocationV2Result & { legs: AllocationV2Leg[] }>;
}> {
  const res = await fetch(apiUrl(`/allocation/v2/runs/${runId}/result`));
  return handleResponse(res);
}
