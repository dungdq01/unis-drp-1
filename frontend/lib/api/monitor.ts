const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(p: string) { return `${BASE_URL}/api/v1${p}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type KpiStatus     = 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'DISABLED' | 'N_A';
export type HstkClass     = 'STOCKOUT' | 'OK' | 'OVERSTOCK';

export interface KpiSnapshot {
  id: string;
  computedAt: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  kpiGroup: string;
  kpiCode: string;
  value: number;
  target: number | null;
  status: KpiStatus;
  itemCode: string | null;
  locationCode: string | null;
  note: string | null;
}

export interface MonitorAlert {
  id: string;
  alertType: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  itemCode: string | null;
  locationCode: string | null;
  isAcknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

export interface HstkRow {
  itemCode: string;
  itemName: string | null;
  locationCode: string;
  locationName: string | null;
  onHand: number;
  weeklyDemand: number;
  hstkWeeks: number;
  classification: HstkClass;
}

export interface HstkSummary { stockout: number; ok: number; overstock: number; avg_hstk: number; }
export interface PageMeta    { page: number; pageSize: number; total: number; totalPages: number; }

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchMonitorStats = () =>
  fetch(apiUrl('/monitor/stats'), { cache: 'no-store' }).then(r => handleRes<any>(r));

export const computeKpi = (computedBy?: string) =>
  fetch(apiUrl('/monitor/kpi/compute'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ computedBy }),
  }).then(r => handleRes<{ computed: number; alerts_generated: number }>(r));

export const fetchKpiSnapshots = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/monitor/kpi?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: KpiSnapshot[]; meta: PageMeta }>(r));
};

export const fetchHstk = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/monitor/hstk?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ summary: HstkSummary; data: HstkRow[]; meta: PageMeta }>(r));
};

export const fetchExecutionMetrics = () =>
  fetch(apiUrl('/monitor/execution'), { cache: 'no-store' }).then(r => handleRes<any>(r));

export const fetchAlerts = (params: Record<string, string | boolean | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/monitor/alerts?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: MonitorAlert[]; meta: PageMeta }>(r));
};

export const acknowledgeAlert = (id: string, acknowledgedBy?: string) =>
  fetch(apiUrl(`/monitor/alerts/${id}/acknowledge`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ acknowledgedBy }),
  }).then(r => handleRes<MonitorAlert>(r));
