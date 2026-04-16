const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(path: string) { return `${BASE_URL}/api/v1${path}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransportPlan {
  id: string; allocationRunId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  totalTrips: number; totalWeightKg: number; totalCostVnd: number;
  createdBy: string | null; confirmedBy: string | null;
  confirmedAt: string | null; createdAt: string;
}

export interface TransportTrip {
  id: string; transportPlanId: string;
  sourceLocationCode: string; destLocationCode: string;
  vehicleTypeCode: 'FLATBED' | 'CRANE_TRUCK';
  carrierCode: string | null;
  totalWeightKg: number; totalPallets: number; estimatedCostVnd: number;
  departureDate: string | null; etaDate: string | null; leadTimeDays: number;
  status: 'PLANNED' | 'NO_CARRIER' | 'DISPATCHED' | 'DELIVERED';
  exceptionNote: string | null;
}

export interface TransportTripLine {
  id: string; transportTripId: string; allocationResultId: string;
  itemCode: string; allocatedQty: number; weightKg: number;
}

export interface Carrier {
  id: string; carrierCode: string; carrierName: string;
  contactPhone: string | null; historicalOtdPct: number;
  supportedVehicles: string; isActive: boolean; note: string | null;
}

export interface TransportLane {
  id: string; sourceLocationCode: string; destLocationCode: string;
  distanceKm: number; leadTimeDays: number; rateVndPerKm: number;
  carrierCodes: string; isActive: boolean;
}

export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number; }

export interface EligibleRun {
  id: string;
  planRunId: string;
  completedAt: string;
  totalDemandLines: number;
  totalAllocated: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchEligibleRuns = () =>
  fetch(apiUrl('/transport/eligible-runs'), { cache: 'no-store' })
    .then(r => handleRes<EligibleRun[]>(r));

export const createTransportPlan = (allocationRunId: string, createdBy?: string) =>
  fetch(apiUrl('/transport/plans'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allocationRunId, createdBy }),
  }).then(r => handleRes<TransportPlan>(r));

export const fetchTransportPlans = (page = 1, pageSize = 20) =>
  fetch(apiUrl(`/transport/plans?page=${page}&pageSize=${pageSize}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: TransportPlan[]; meta: PageMeta }>(r));

export const fetchTransportPlan = (id: string) =>
  fetch(apiUrl(`/transport/plans/${id}`), { cache: 'no-store' })
    .then(r => handleRes<TransportPlan>(r));

export const fetchTrips = (planId: string, params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/transport/plans/${planId}/trips?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: TransportTrip[]; meta: PageMeta }>(r));
};

export const fetchTripLines = (tripId: string) =>
  fetch(apiUrl(`/transport/trips/${tripId}/lines`), { cache: 'no-store' })
    .then(r => handleRes<TransportTripLine[]>(r));

export const updateTrip = (tripId: string, body: { carrierCode?: string; departureDate?: string }) =>
  fetch(apiUrl(`/transport/trips/${tripId}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => handleRes<TransportTrip>(r));

export const confirmPlan = (planId: string, confirmedBy?: string) =>
  fetch(apiUrl(`/transport/plans/${planId}/confirm`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmedBy }),
  }).then(r => handleRes<TransportPlan>(r));

export const fetchCarriers = () =>
  fetch(apiUrl('/transport/carriers'), { cache: 'no-store' })
    .then(r => handleRes<Carrier[]>(r));

export const upsertCarrier = (body: Partial<Carrier>) =>
  fetch(apiUrl('/transport/carriers'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => handleRes<Carrier>(r));

export const deleteCarrier = (id: string) =>
  fetch(apiUrl(`/transport/carriers/${id}`), { method: 'DELETE' }).then(r => handleRes(r));

export const fetchLanes = (page = 1, pageSize = 50) =>
  fetch(apiUrl(`/transport/lanes?page=${page}&pageSize=${pageSize}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: TransportLane[]; meta: PageMeta }>(r));

export const upsertLane = (body: Partial<TransportLane>) =>
  fetch(apiUrl('/transport/lanes'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => handleRes<TransportLane>(r));

export const deleteLane = (id: string) =>
  fetch(apiUrl(`/transport/lanes/${id}`), { method: 'DELETE' }).then(r => handleRes(r));

export const uploadCarriersCsv = (file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return fetch(apiUrl('/transport/carriers/upload'), { method: 'POST', body: fd })
    .then(r => handleRes<{ upserted: number; errors: string[] }>(r));
};

export const uploadLanesCsv = (file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return fetch(apiUrl('/transport/lanes/upload'), { method: 'POST', body: fd })
    .then(r => handleRes<{ upserted: number; errors: string[] }>(r));
};

// ═══════════════════════════════════════════════════════════════════════════════
// M25 — Transport Lot Sizing v2 API
// ═══════════════════════════════════════════════════════════════════════════════

export type TripStatus = 'PLANNED' | 'HELD' | 'NO_CARRIER' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
export type HoldDecision = 'SHIP' | 'HOLD' | 'FORCE_SHIP_LOW_FILL' | 'FORCE_SHIP_TIMEOUT';
export type PlanStatusV2 = 'DRAFT' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_PARTIAL' | 'FAILED' | 'CANCELLED';
export type TopUpStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface TransportPlanV2 {
  id: string;
  allocationRunId: string | null;
  policyRunId: string | null;
  status: PlanStatusV2;
  totalTrips: number;
  heldTrips: number;
  multiDropTrips: number;
  avgFillRatio: number | null;
  isForceRerun: boolean;
  forceRerunReason: string | null;
  createdAt: string;
}

export interface TransportTripV2 {
  id: string;
  transportPlanId: string;
  sourceLocationCode: string;
  destLocationCode: string;
  status: TripStatus;
  carrierCode: string | null;
  vehicleTypeCode: string;
  totalPallets: number;
  totalWeightKg: number;
  fillRatio: number | null;
  holdDecision: HoldDecision | null;
  holdUntilDate: string | null;
  heldAt: string | null;
  isMultiDrop: boolean;
  stopCount: number;
}

export interface TripStop {
  id: string;
  tripId: string;
  stopSequence: number;
  locationCode: string;
  palletsAtStop: number;
  weightKgAtStop: number;
  etaAtStop: string | null;
}

export interface TopUpSuggestionV2 {
  id: string;
  tripId: string;
  itemCode: string;
  suggestedQty: number;
  estimatedPallets: number;
  estimatedWeightKg: number;
  reason: string | null;
  priorityScore: number;
  status: TopUpStatus;
  sourcePeriodStart: string;
  forecastWeekOffset: number;
  demandSource: string;
}

export interface TransportRunSummary {
  transportPlanId: string;
  status: string;
  totalTrips: number;
  heldTrips: number;
  multiDropTrips: number;
  avgFillRatio: number;
  durationMs: number;
}

function apiV1(path: string) {
  const base = process.env.NEXT_PUBLIC_API_URL ?? '';
  return `${base}/api/v1${path}`;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function runTransportV2(allocationRunId: string, userId?: string): Promise<TransportRunSummary> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  const r = await fetch(apiV1('/transport/v2/run'), {
    method: 'POST', headers: h, body: JSON.stringify({ allocationRunId }),
  });
  return handle<TransportRunSummary>(r);
}

export async function forceRerunTransportV2(allocationRunId: string, reason: string, userId?: string): Promise<TransportRunSummary> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  const r = await fetch(apiV1('/transport/v2/run/force-rerun'), {
    method: 'POST', headers: h, body: JSON.stringify({ allocationRunId, reason }),
  });
  return handle<TransportRunSummary>(r);
}

export async function listTransportPlansV2(opts: { status?: string; page?: number; limit?: number } = {}) {
  const qs = new URLSearchParams();
  if (opts.status) qs.set('status', opts.status);
  if (opts.page) qs.set('page', String(opts.page));
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  const r = await fetch(apiV1(`/transport/v2/plans${q ? `?${q}` : ''}`));
  return handle<{ data: TransportPlanV2[]; total: number; page: number; limit: number }>(r);
}

export async function getTransportPlanV2(id: string) {
  const r = await fetch(apiV1(`/transport/v2/plans/${id}`));
  return handle<{
    planId: string; allocationRunId: string | null; policyRunId: string | null;
    generatedAt: string; status: string; trips: unknown[];
  }>(r);
}

export async function listTripsV2(planId: string, status?: TripStatus) {
  const q = status ? `?status=${status}` : '';
  const r = await fetch(apiV1(`/transport/v2/plans/${planId}/trips${q}`));
  return handle<TransportTripV2[]>(r);
}

export async function getTripV2(id: string) {
  const r = await fetch(apiV1(`/transport/v2/trips/${id}`));
  return handle<TransportTripV2 & { stops: TripStop[]; lines: unknown[]; topUpSuggestions: TopUpSuggestionV2[] }>(r);
}

export async function releaseHeldTrip(id: string, userId?: string) {
  const h: Record<string, string> = {};
  if (userId) h['x-user-id'] = userId;
  const r = await fetch(apiV1(`/transport/v2/trips/${id}/release`), { method: 'POST', headers: h });
  return handle(r);
}

export async function extendHold(id: string, extendDays: number, userId?: string) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  const r = await fetch(apiV1(`/transport/v2/trips/${id}/hold-extend`), {
    method: 'POST', headers: h, body: JSON.stringify({ extendDays }),
  });
  return handle<{ newHoldUntil: string }>(r);
}

export async function cancelTrip(id: string, reason: string, userId?: string) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (userId) h['x-user-id'] = userId;
  const r = await fetch(apiV1(`/transport/v2/trips/${id}/cancel`), {
    method: 'POST', headers: h, body: JSON.stringify({ reason }),
  });
  return handle(r);
}

export async function listTopUpSuggestions(tripId: string) {
  const r = await fetch(apiV1(`/transport/v2/trips/${tripId}/top-up`));
  return handle<TopUpSuggestionV2[]>(r);
}

export async function acceptTopUp(suggestionId: string, userId?: string) {
  const h: Record<string, string> = {};
  if (userId) h['x-user-id'] = userId;
  const r = await fetch(apiV1(`/transport/v2/top-up/${suggestionId}/accept`), { method: 'POST', headers: h });
  return handle<{ newResultId: string; newLegId: string }>(r);
}

export async function rejectTopUp(suggestionId: string, userId?: string) {
  const h: Record<string, string> = {};
  if (userId) h['x-user-id'] = userId;
  const r = await fetch(apiV1(`/transport/v2/top-up/${suggestionId}/reject`), { method: 'POST', headers: h });
  return handle(r);
}
