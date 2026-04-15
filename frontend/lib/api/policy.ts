const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PolicyRun {
  id: string;
  runName: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  demandSnapshotId: string;
  totalCombinations: number;
  combinationsDone: number;
  activatedBy: string | null;
  activatedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AbcClassification {
  id: string;
  itemCode: string;
  abcClass: 'A' | 'B' | 'C';
  source: string;
  snapshotId: string;
  internalClass: 'A' | 'B' | 'C';
  discrepancyFlag: boolean;
  effectiveDate: string;
}

export interface SsTarget {
  id: string;
  itemCode: string;
  locationCode: string;
  policyRunId: string;
  abcClass: 'A' | 'B' | 'C';
  cslTarget: string;
  zScore: string;
  leadTimeDays: number;
  sigmaDemand: string;
  sigmaLt: string;
  adu: string;
  ssFormula: string;
  ssDosCap: string;
  ssFinal: number;
  dosTarget: number;
  sigmaSource: string;
  lcnbMode: string;
  lcnbFlag: boolean;
  overrideSs: number | null;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
  snapshotId: string;
  createdAt: string;
}

export interface SsSummary {
  totalCombinations: number;
  avgSsByClass: Record<string, number>; // { A: avgSs, B: avgSs, C: avgSs }
  lcnbFlaggedCount: number;
}

export interface RtmRule {
  id: string;
  branchCode: string;
  warehouseCode: string;
  itemCode: string | null;
  priority: 1 | 2 | 3;
  transportDays: number;
  transportMode: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function apiUrl(path: string): string {
  return `${BASE_URL}/api/v1${path}`;
}

// ─── Policy Runs ──────────────────────────────────────────────────────────────

export async function fetchPolicyRuns(): Promise<PolicyRun[]> {
  const res = await fetch(apiUrl('/policy/runs'), { cache: 'no-store' });
  return handleResponse<PolicyRun[]>(res);
}

export async function fetchPolicyRun(id: string): Promise<PolicyRun> {
  const res = await fetch(apiUrl(`/policy/runs/${id}`), { cache: 'no-store' });
  return handleResponse<PolicyRun>(res);
}

export async function createPolicyRun(body: {
  runName: string;
  demandSnapshotId: string;
  createdBy?: string;
}): Promise<{ runId: string; status: string; totalCombinations: number }> {
  const res = await fetch(apiUrl('/policy/runs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function activatePolicyRun(id: string, activatedBy: string): Promise<PolicyRun> {
  const res = await fetch(apiUrl(`/policy/runs/${id}/activate`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activatedBy }),
  });
  return handleResponse<PolicyRun>(res);
}

// ─── ABC Classification ───────────────────────────────────────────────────────

export async function importAbcFromSnapshot(demandSnapshotId: string): Promise<{ imported: number; discrepancies: number }> {
  const res = await fetch(apiUrl('/policy/abc/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ demandSnapshotId }),
  });
  return handleResponse(res);
}

export async function fetchAbcClassifications(params: {
  snapshotId?: string;
  abcClass?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ data: AbcClassification[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.snapshotId) query.set('snapshotId', params.snapshotId);
  if (params.abcClass) query.set('abcClass', params.abcClass);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const res = await fetch(`${apiUrl('/policy/abc/classifications')}?${query}`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function fetchAbcDiscrepancies(snapshotId: string): Promise<AbcClassification[]> {
  const res = await fetch(`${apiUrl('/policy/abc/discrepancies')}?snapshotId=${snapshotId}`, { cache: 'no-store' });
  return handleResponse(res);
}

// ─── Safety Stock ─────────────────────────────────────────────────────────────

export async function fetchSsTargets(params: {
  policyRunId?: string;
  abcClass?: string;
  itemCode?: string;
  locationCode?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<{ data: SsTarget[]; meta: PageMeta }> {
  const query = new URLSearchParams();
  if (params.policyRunId) query.set('policyRunId', params.policyRunId);
  if (params.abcClass) query.set('abcClass', params.abcClass);
  if (params.itemCode) query.set('itemCode', params.itemCode);
  if (params.locationCode) query.set('locationCode', params.locationCode);
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const res = await fetch(`${apiUrl('/policy/safety-stock/targets')}?${query}`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function fetchSsSummary(): Promise<SsSummary> {
  const res = await fetch(apiUrl('/policy/safety-stock/summary'), { cache: 'no-store' });
  return handleResponse(res);
}

export async function overrideSsTarget(
  itemCode: string,
  locationCode: string,
  body: { overrideSs: number; overrideReason: string; overrideBy: string },
): Promise<SsTarget> {
  const res = await fetch(apiUrl(`/policy/safety-stock/targets/${itemCode}/${locationCode}/override`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    // BE DTO uses `reason` + `userId` (not overrideReason/overrideBy)
    body: JSON.stringify({ overrideSs: body.overrideSs, reason: body.overrideReason, userId: body.overrideBy }),
  });
  return handleResponse(res);
}

// ─── RTM Rules ────────────────────────────────────────────────────────────────

export async function fetchRtmRoutes(params: {
  branchCode?: string;
  priority?: number;
  page?: number;
  pageSize?: number;
} = {}): Promise<RtmRule[]> {
  const query = new URLSearchParams();
  if (params.branchCode) query.set('branchCode', params.branchCode);
  if (params.priority !== undefined) query.set('priority', String(params.priority));
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  const res = await fetch(`${apiUrl('/policy/rtm/routes')}?${query}`, { cache: 'no-store' });
  return handleResponse(res);
}

export async function createRtmRoute(body: {
  branchCode: string;
  warehouseCode: string;
  priority: 1 | 2 | 3;
  transportDays?: number;
}): Promise<RtmRule> {
  const res = await fetch(apiUrl('/policy/rtm/routes'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return handleResponse(res);
}

export async function deactivateRtmRoute(id: string): Promise<RtmRule> {
  const res = await fetch(apiUrl(`/policy/rtm/routes/${id}`), { method: 'DELETE' });
  return handleResponse(res);
}
