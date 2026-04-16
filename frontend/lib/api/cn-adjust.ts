const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AdjustStatus =
  | 'PENDING'
  | 'AUTO_APPROVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'FORCE_APPROVED'
  | 'EXPIRED';

export interface CnDemandAdjustment {
  id: string;
  cnId: string;
  skuId: string;
  periodDate: string;
  fcQty: number;
  adjustedQty: number;
  deltaPct: number;
  reasonCode: string;
  reasonText: string | null;
  status: AdjustStatus;
  submittedBy: string;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  actualQty: number | null;
  isAccurate: boolean | null;
  createdAt: string;
}

export interface ReasonCode {
  code: string;
  labelVi: string;
  isActive: boolean;
}

export interface TrustScore {
  cnId: string;
  score: number;
  totalAdjustments12w: number;
  accurateAdjustments12w: number;
  lastCalculatedAt: string | null;
  isGracePeriod: boolean;
}

export interface EffectiveDemandRow {
  cnId: string;
  skuId: string;
  adjustedQty: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Submit / Force ─────────────────────────────────────────────────────────

export interface SubmitAdjustmentPayload {
  cnId: string;
  skuId: string;
  periodDate: string;
  fcQty: number;
  adjustedQty: number;
  reasonCode: string;
  reasonText?: string;
  submittedBy: string;
}

export interface ForceSubmitPayload extends SubmitAdjustmentPayload {
  reasonText: string; // mandatory for force
}

export interface ReviewPayload {
  reviewedBy: string;
  reviewNote?: string;
}

// ─── API Functions ──────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `API error ${res.status}`);
  }
  return res.json();
}

/** POST /cn-adjust — CN submit adjustment */
export async function submitAdjustment(payload: SubmitAdjustmentPayload): Promise<CnDemandAdjustment> {
  return apiFetch('/cn-adjust', { method: 'POST', body: JSON.stringify(payload) });
}

/** POST /cn-adjust/force — SC Manager force submit */
export async function forceSubmitAdjustment(payload: ForceSubmitPayload): Promise<CnDemandAdjustment> {
  return apiFetch('/cn-adjust/force', { method: 'POST', body: JSON.stringify(payload) });
}

/** GET /cn-adjust/queue — PENDING queue */
export async function fetchQueue(): Promise<CnDemandAdjustment[]> {
  return apiFetch('/cn-adjust/queue');
}

/** GET /cn-adjust/history — SC Manager full history */
export async function fetchHistory(params: {
  cnId?: string;
  periodStart?: string;
  periodEnd?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<CnDemandAdjustment>> {
  const qs = new URLSearchParams();
  if (params.cnId)        qs.set('cnId',        params.cnId);
  if (params.periodStart) qs.set('periodStart',  params.periodStart);
  if (params.periodEnd)   qs.set('periodEnd',    params.periodEnd);
  if (params.page)        qs.set('page',         String(params.page));
  if (params.pageSize)    qs.set('pageSize',     String(params.pageSize));
  return apiFetch(`/cn-adjust/history?${qs}`);
}

/** GET /cn-adjust/my — CN own adjustments */
export async function fetchMyAdjustments(cnId: string, params: {
  periodStart?: string;
  periodEnd?: string;
  page?: number;
  pageSize?: number;
}): Promise<PaginatedResult<CnDemandAdjustment>> {
  const qs = new URLSearchParams({ cnId });
  if (params.periodStart) qs.set('periodStart', params.periodStart);
  if (params.periodEnd)   qs.set('periodEnd',   params.periodEnd);
  if (params.page)        qs.set('page',        String(params.page));
  if (params.pageSize)    qs.set('pageSize',    String(params.pageSize));
  return apiFetch(`/cn-adjust/my?${qs}`);
}

/** PATCH /cn-adjust/:id/approve */
export async function approveAdjustment(id: string, payload: ReviewPayload): Promise<CnDemandAdjustment> {
  return apiFetch(`/cn-adjust/${id}/approve`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** PATCH /cn-adjust/:id/reject */
export async function rejectAdjustment(id: string, payload: ReviewPayload): Promise<CnDemandAdjustment> {
  return apiFetch(`/cn-adjust/${id}/reject`, { method: 'PATCH', body: JSON.stringify(payload) });
}

/** GET /cn-adjust/trust — Trust scores */
export async function fetchTrustScores(): Promise<TrustScore[]> {
  return apiFetch('/cn-adjust/trust');
}

/** GET /cn-adjust/reason-codes */
export async function fetchReasonCodes(): Promise<ReasonCode[]> {
  return apiFetch('/cn-adjust/reason-codes');
}

/** GET /cn-adjust/effective-demand?weekStart= */
export async function fetchEffectiveDemand(weekStart: string): Promise<EffectiveDemandRow[]> {
  return apiFetch(`/cn-adjust/effective-demand?weekStart=${weekStart}`);
}
