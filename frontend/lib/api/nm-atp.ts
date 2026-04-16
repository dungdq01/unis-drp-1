const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(path: string) { return `${BASE_URL}/api/v1${path}`; }
async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AtpRun {
  id: string;
  allocationRunId: string;
  planRunId: string;
  policyRunId: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  totalCells: number;
  passCount: number;
  partialCount: number;
  failCount: number;
  blockedCount: number;
  criticalCount: number;
  isForceRerun: boolean;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
}

export interface UrgencyRankEntry {
  cnId: string;
  cnCode: string;
  hstkDays: number;
  transitLtDays: number;
  isCritical: boolean;
  requestedQty: number;
  atpAlloc: number;
  unfulfilled: number;
  rank: number;
}

export interface AtpCheck {
  id: string;
  atpRunId: string;
  nmId: string;
  skuId: string;
  periodStart: string;
  requestedQty: number;
  atpQty: number | null;
  result: 'PASS' | 'PARTIAL' | 'FAIL' | 'BLOCKED';
  reason: 'STALE_DATA' | 'ZERO_STOCK' | null;
  isAtpNullFallback: boolean;
  urgencyRanking: UrgencyRankEntry[] | null;
  checkedAt: string;
}

export interface NmHonoringRate {
  id: string;
  nmId: string;
  periodMonth: string;
  atpAtCheckTotal: number | null;
  requestedTotal: number | null;
  fulfilledTotal: number | null;
  rate: number | null;
  rolling3mRate: number | null;
  cellCount: number;
  partialCount: number;
  failCount: number;
  blockedCount: number;
  calculatedAt: string;
}

export interface HonoringLeaderboardEntry {
  supplierCode: string;
  supplierName: string;
  nmUnreliableBadge: boolean;
  rolling3mRate: number | null;
  lastMonthRate: number | null;
  periodMonth: string;
}

export interface AtpRunResult {
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

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Run lifecycle ────────────────────────────────────────────────────────────

export async function runAtpCheck(allocationRunId: string, userId?: string): Promise<AtpRunResult> {
  return handleRes(await fetch(apiUrl('/nm-atp/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify({ allocationRunId }),
  }));
}

export async function forceRerunAtpCheck(
  allocationRunId: string,
  forceRerunReason: string,
  userId?: string,
): Promise<AtpRunResult> {
  return handleRes(await fetch(apiUrl('/nm-atp/run/force-rerun'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify({ allocationRunId, forceRerunReason }),
  }));
}

export async function listAtpRuns(params: {
  status?: string;
  allocationRunId?: string;
  page?: number;
  limit?: number;
} = {}): Promise<PagedResult<AtpRun>> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.allocationRunId) q.set('allocationRunId', params.allocationRunId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  return handleRes(await fetch(apiUrl(`/nm-atp/runs?${q}`)));
}

export async function getAtpRunDetail(runId: string): Promise<AtpRun> {
  return handleRes(await fetch(apiUrl(`/nm-atp/runs/${runId}`)));
}

export async function listAtpChecks(
  runId: string,
  params: { nmId?: string; result?: string } = {},
): Promise<AtpCheck[]> {
  const q = new URLSearchParams();
  if (params.nmId) q.set('nmId', params.nmId);
  if (params.result) q.set('result', params.result);
  return handleRes(await fetch(apiUrl(`/nm-atp/runs/${runId}/checks?${q}`)));
}

export async function getCriticalRecipients(runId: string): Promise<AtpCheck[]> {
  return handleRes(await fetch(apiUrl(`/nm-atp/runs/${runId}/critical`)));
}

export async function getUrgencyDetail(runId: string, checkId: string): Promise<AtpCheck> {
  return handleRes(await fetch(apiUrl(`/nm-atp/runs/${runId}/urgency/${checkId}`)));
}

// ─── Honoring rate ────────────────────────────────────────────────────────────

export async function listHonoringRate(params: {
  nmId?: string;
  fromMonth?: string;
  toMonth?: string;
} = {}): Promise<NmHonoringRate[]> {
  const q = new URLSearchParams();
  if (params.nmId) q.set('nmId', params.nmId);
  if (params.fromMonth) q.set('fromMonth', params.fromMonth);
  if (params.toMonth) q.set('toMonth', params.toMonth);
  return handleRes(await fetch(apiUrl(`/nm-atp/honoring?${q}`)));
}

export async function getHonoringLeaderboard(): Promise<HonoringLeaderboardEntry[]> {
  return handleRes(await fetch(apiUrl('/nm-atp/honoring/leaderboard')));
}

export async function recomputeHonoringRate(month?: string): Promise<{ nmCount: number; unreliableCount: number }> {
  const q = month ? `?month=${month}` : '';
  return handleRes(await fetch(apiUrl(`/nm-atp/honoring/recompute${q}`), { method: 'POST' }));
}
