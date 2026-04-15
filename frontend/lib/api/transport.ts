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
