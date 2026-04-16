const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(path: string) { return `${BASE_URL}/api/v1/feedback${path}`; }

// ── Types ──────────────────────────────────────────────────────────────────

export interface WeeklyKpiSnapshot {
  id: string;
  weekStartDate: string;
  status: 'RUNNING' | 'COMPLETED' | 'COMPLETED_PARTIAL' | 'FAILED';
  stepErrors: Array<{ step: string; error: string }> | null;
  fcMapePct: number | null;
  fillRatePct: number | null;
  lcnbUtilPct: number | null;
  transportFillAvg: number | null;
  systemAccuracyPct: number | null;
  nmHonoringAvgPct: number | null;
  totalPoCount: number;
  editedPoCount: number;
  totalToCount: number;
  ssAdjustmentsCount: number;
  ltUpdatesCount: number;
  isForceRerun: boolean;
  createdAt: string;
  completedAt: string | null;
}

export interface DashboardResponse {
  current: WeeklyKpiSnapshot | null;
  previous: WeeklyKpiSnapshot | null;
  alerts: string[];
  overrideAnalysis: {
    topReasons: Array<{ reason: string; count: number; pct: number }>;
    totalEdits: number;
    totalPos: number;
    totalTos: number;
    systemAccuracyPct: number | null;
    fieldBreakdown: Record<string, number> | null;
  } | null;
  ssAdjustmentHistory: Array<{
    cnId: string; skuId: string; ssOld: number; ssNewApplied: number;
    deltaPct: number; isCapped: boolean; weekStartDate: string;
  }>;
  ltDriftTable: Array<{
    entityCode: string; ltOldDays: number; ltActualAvgDays: number;
    driftPct: number; action: string; driftCountAfter: number; weekStartDate: string;
  }>;
}

// ── API calls ──────────────────────────────────────────────────────────────

export async function getDashboard(week?: string): Promise<DashboardResponse> {
  const q = week ? `?week=${week}` : '';
  const res = await fetch(apiUrl(`/dashboard${q}`));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listSnapshots(limit = 20): Promise<WeeklyKpiSnapshot[]> {
  const res = await fetch(apiUrl(`/snapshots?limit=${limit}`));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function triggerRun(weekStart?: string): Promise<{ snapshotId: string; status: string }> {
  const res = await fetch(apiUrl('/run'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function forceRerun(
  forceRerunReason: string,
  weekStart?: string,
): Promise<{ snapshotId: string; status: string }> {
  const res = await fetch(apiUrl('/run/force-rerun'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekStart, forceRerunReason }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getSsAdjustments(params: {
  cnId?: string; skuId?: string; fromWeek?: string; toWeek?: string;
}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  const res = await fetch(apiUrl(`/ss-adjustments?${q}`));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getLtUpdates(params: { nmCode?: string; fromDate?: string; toDate?: string }) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  const res = await fetch(apiUrl(`/lt-updates?${q}`));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getDrillDown(metric: string, cnId?: string, skuId?: string) {
  const q = new URLSearchParams({ metric, ...(cnId && { cnId }), ...(skuId && { skuId }) });
  const res = await fetch(apiUrl(`/dashboard/drill-down?${q}`));
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
