const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(path: string) { return `${BASE_URL}/api/v1${path}`; }
async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PoRun {
  id: string;
  allocationRunId: string;
  transportPlanId: string | null;
  atpRunId: string | null;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'BLOCKED_INCOMPLETE';
  totalPoCount: number;
  totalToCount: number;
  skippedAtpFailCount: number;
  skippedAtpBlockedCount: number;
  clampedAtpPartialCount: number;
  variantReviewCount: number;
  topUpCount: number;
  isForceRerun: boolean;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export type PoStatus = 'DRAFT' | 'CONFIRMED' | 'SHIPPED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED';

export interface PoHeader {
  id: string;
  poRunId: string;
  poNumber: string;
  nmId: string;
  cnId: string;
  status: PoStatus;
  totalQty: number;
  requestedEta: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  // from tracking join
  vehicleNo: string | null;
  carrierCode: string | null;
  actualEtaDate: string | null;
  nmShipDate: string | null;
}

export interface PoLine {
  id: string;
  poHeaderId: string;
  skuId: string;
  variantCode: string | null;
  requestedQty: number;
  confirmedQty: number;
  actualReceivedQty: number | null;
  sourceAllocationLegId: string | null;
  isTopUp: boolean;
  sourcePeriodStart: string | null;
  requiresVariantReview: boolean;
  qtyExceedsAtp: boolean;
  deliveryIncomplete: boolean;
  deliveryNote: string | null;
  status: 'ACTIVE' | 'CANCELLED';
}

export interface PoEditLog {
  id: string;
  poHeaderId: string;
  poLineId: string | null;
  fieldChanged: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
  changedBy: string;
  changedAt: string;
}

export interface ToHeader {
  id: string;
  poRunId: string;
  toNumber: string;
  donorCnId: string;
  receiverCnId: string;
  status: PoStatus;
  totalQty: number;
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface PagedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ─── Run lifecycle ────────────────────────────────────────────────────────────

export async function triggerPoRun(
  allocationRunId: string, transportPlanId: string, atpRunId: string, userId?: string,
): Promise<{ poRunId: string; status: string; totalPoCount: number; totalToCount: number }> {
  return handleRes(await fetch(apiUrl('/po-review/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify({ allocationRunId, transportPlanId, atpRunId }),
  }));
}

export async function listPoRuns(params: { status?: string; allocationRunId?: string; page?: number; limit?: number } = {}): Promise<PagedResult<PoRun>> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.allocationRunId) q.set('allocationRunId', params.allocationRunId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  return handleRes(await fetch(apiUrl(`/po-review/runs?${q}`)));
}

// ─── PO ──────────────────────────────────────────────────────────────────────

export async function listPo(params: {
  status?: string; nmId?: string; cnId?: string; poRunId?: string; page?: number; limit?: number;
} = {}): Promise<PagedResult<PoHeader>> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.nmId) q.set('nmId', params.nmId);
  if (params.cnId) q.set('cnId', params.cnId);
  if (params.poRunId) q.set('poRunId', params.poRunId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  return handleRes(await fetch(apiUrl(`/po-review/po?${q}`)));
}

export async function getPoDetail(poId: string): Promise<PoHeader & { lines: PoLine[]; editLog: PoEditLog[] }> {
  return handleRes(await fetch(apiUrl(`/po-review/po/${poId}`)));
}

export async function editPoLine(
  poId: string, lineId: string,
  body: { confirmedQty?: number; variantCode?: string; reason: string },
  userId?: string,
): Promise<{ lineId: string; warning?: string }> {
  return handleRes(await fetch(apiUrl(`/po-review/po/${poId}/lines/${lineId}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify(body),
  }));
}

export async function confirmPo(poId: string, idempotencyKey: string, userId?: string): Promise<{ id: string; status: string }> {
  return handleRes(await fetch(apiUrl(`/po-review/po/${poId}/confirm`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'idempotency-key': idempotencyKey,
      ...(userId ? { 'x-user-id': userId } : {}),
    },
  }));
}

export async function cancelPo(poId: string, cancelReason: string, userId?: string): Promise<{ id: string; status: string }> {
  return handleRes(await fetch(apiUrl(`/po-review/po/${poId}/cancel`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify({ cancelReason }),
  }));
}

export async function transitionPo(
  poId: string,
  body: {
    toStatus: 'SHIPPED' | 'RECEIVED' | 'CLOSED';
    vehicleNo?: string; carrierCode?: string; containerNo?: string; shipDate?: string;
    actualReceivedQty?: number; receiveDate?: string; note?: string;
  },
  userId?: string,
): Promise<{ id: string; status: string }> {
  return handleRes(await fetch(apiUrl(`/po-review/po/${poId}/transition`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify(body),
  }));
}

// ─── TO ──────────────────────────────────────────────────────────────────────

export async function listTo(params: { status?: string; donorCnId?: string; receiverCnId?: string; page?: number; limit?: number } = {}): Promise<PagedResult<ToHeader>> {
  const q = new URLSearchParams();
  if (params.status) q.set('status', params.status);
  if (params.donorCnId) q.set('donorCnId', params.donorCnId);
  if (params.receiverCnId) q.set('receiverCnId', params.receiverCnId);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  return handleRes(await fetch(apiUrl(`/po-review/to?${q}`)));
}

export async function getToDetail(toId: string): Promise<ToHeader & { lines: unknown[]; editLog: unknown[] }> {
  return handleRes(await fetch(apiUrl(`/po-review/to/${toId}`)));
}

export async function confirmTo(toId: string, idempotencyKey: string, userId?: string): Promise<{ id: string; status: string }> {
  return handleRes(await fetch(apiUrl(`/po-review/to/${toId}/confirm`), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'idempotency-key': idempotencyKey,
      ...(userId ? { 'x-user-id': userId } : {}),
    },
  }));
}

export async function cancelTo(toId: string, cancelReason: string, userId?: string): Promise<{ id: string; status: string }> {
  return handleRes(await fetch(apiUrl(`/po-review/to/${toId}/cancel`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: JSON.stringify({ cancelReason }),
  }));
}
