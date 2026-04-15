const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? '') + '/api/v1';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMEOUT';
export type OrderStatus = 'AUTO_RELEASE' | 'NEEDS_APPROVAL' | 'RELEASED' | 'CANCELLED';
export type ExceptionSeverity = 'HIGH' | 'MEDIUM' | 'LOW';
export type ExceptionType =
  | 'PAB_NEGATIVE'
  | 'STOCKOUT_ALERT'
  | 'OVERSTOCK_ALERT'
  | 'FROZEN_ZONE_VIOLATION'
  | 'MISSING_SS'
  | 'NETTING_TIMEOUT';

export interface PlanRun {
  id: string;
  demandSnapshotId: string;
  supplySnapshotId: string;
  status: PlanRunStatus;
  combinationsProcessed: number;
  plannedOrdersCount: number;
  exceptionsCount: number;
  durationMs: number | null;
  configJson: Record<string, unknown> | null;
  createdBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  // from getPlanRun detail
  exceptionsByType?: Record<string, number>;
}

export interface PlannedOrder {
  id: string;
  planRunId: string;
  itemCode: string;
  locationCode: string;
  weekNumber: number;
  weekStartDate: string;
  beginningInventory: number | null;
  grossRequirement: number;
  scheduledReceipt: number;
  pabBefore: number;
  netRequirement: number;
  plannedOrderQty: number;
  pabAfter: number;
  safetyStock: number;
  hstk: number | null;
  frozenZoneFlag: boolean;
  status: OrderStatus;
  demandBasis: string;
  isEstimated: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

export interface DrpExceptionItem {
  id: string;
  planRunId: string;
  type: ExceptionType;
  severity: ExceptionSeverity;
  itemCode: string | null;
  locationCode: string | null;
  weekNumber: number | null;
  detailJson: Record<string, unknown> | null;
  message: string;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

export interface HstkSummary {
  totalCombinations: number;
  stockoutCount: number;
  stockoutPct: number;
  okCount: number;
  okPct: number;
  overstockCount: number;
  overstockPct: number;
}

export interface PaginatedMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginatedMeta;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function createDrpRun(payload: {
  demandSnapshotId: string;
  supplySnapshotId: number;
  horizonStart?: string;
  horizonWeeks?: number;
  frozenZone?: number;
  createdBy?: string;
}): Promise<PlanRun> {
  const res = await fetch(`${API_BASE}/drp/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listPlanRuns(page = 1, pageSize = 20): Promise<Paginated<PlanRun>> {
  const res = await fetch(`${API_BASE}/drp/run?page=${page}&pageSize=${pageSize}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPlanRun(id: string): Promise<PlanRun> {
  const res = await fetch(`${API_BASE}/drp/run/${id}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getPlannedOrders(
  planRunId: string,
  params: {
    page?: number;
    pageSize?: number;
    itemCode?: string;
    locationCode?: string;
    weekNumber?: number;
    status?: OrderStatus;
    frozenZoneFlag?: boolean;
  } = {},
): Promise<Paginated<PlannedOrder> & { summary?: Record<string, number> }> {
  const q = new URLSearchParams();
  if (params.page)          q.set('page', String(params.page));
  if (params.pageSize)      q.set('pageSize', String(params.pageSize));
  if (params.itemCode)      q.set('itemCode', params.itemCode);
  if (params.locationCode)  q.set('locationCode', params.locationCode);
  if (params.weekNumber)    q.set('weekNumber', String(params.weekNumber));
  if (params.status)        q.set('status', params.status);
  if (params.frozenZoneFlag !== undefined) q.set('frozenZoneFlag', String(params.frozenZoneFlag));

  const res = await fetch(`${API_BASE}/drp/run/${planRunId}/planned-orders?${q}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getNettingDetail(
  planRunId: string,
  itemCode: string,
  locationCode: string,
): Promise<PlannedOrder[]> {
  const res = await fetch(
    `${API_BASE}/drp/run/${planRunId}/netting-detail/${encodeURIComponent(itemCode)}/${encodeURIComponent(locationCode)}`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function approvePlannedOrder(
  id: string,
  approvedBy?: string,
): Promise<PlannedOrder> {
  const res = await fetch(`${API_BASE}/drp/planned-orders/${id}/approve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function cancelPlannedOrder(
  id: string,
  reason: string,
  cancelledBy?: string,
): Promise<PlannedOrder> {
  const res = await fetch(`${API_BASE}/drp/planned-orders/${id}/cancel`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason, cancelledBy }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getExceptions(
  planRunId: string,
  params: {
    page?: number;
    pageSize?: number;
    type?: ExceptionType;
    severity?: ExceptionSeverity;
    resolved?: boolean;
  } = {},
): Promise<Paginated<DrpExceptionItem>> {
  const q = new URLSearchParams();
  if (params.page)              q.set('page', String(params.page));
  if (params.pageSize)          q.set('pageSize', String(params.pageSize));
  if (params.type)              q.set('type', params.type);
  if (params.severity)          q.set('severity', params.severity);
  if (params.resolved !== undefined) q.set('resolved', String(params.resolved));

  const res = await fetch(`${API_BASE}/drp/run/${planRunId}/exceptions?${q}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function resolveException(
  runId: string,
  excId: string,
  resolutionNote: string,
  resolvedBy?: string,
): Promise<DrpExceptionItem> {
  const res = await fetch(`${API_BASE}/drp/run/${runId}/exceptions/${excId}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolutionNote, resolvedBy }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHstkSummary(planRunId: string): Promise<HstkSummary> {
  const res = await fetch(`${API_BASE}/drp/run/${planRunId}/hstk`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
