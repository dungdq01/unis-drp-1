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
