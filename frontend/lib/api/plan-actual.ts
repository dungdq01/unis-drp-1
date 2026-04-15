const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(p: string) { return `${BASE_URL}/api/v1${p}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type ComparisonType = 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL' | 'UPLOAD_COMPARE';
export type PacStatus      = 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'N_A';

export interface SnapshotVersion {
  snapshotId:   string;
  snapshotName: string | null;
  createdAt:    string;
  label:        string;
}

export interface PlanActualRow {
  id:                string;
  comparisonType:    ComparisonType;
  periodStart:       string;
  periodEnd:         string;
  periodType:        string;
  itemCode:          string;
  locationCode:      string;
  snapshotIdBase:    string;
  snapshotIdCompare: string | null;
  planQty:           number;
  actualQty:         number | null;
  varianceQty:       number | null;
  variancePct:       number | null;
  fillRateProxy:     number | null;
  status:            PacStatus;
  computedAt:        string;
}

export interface PacSummary {
  forecast_version: {
    avg_variance_pct: number;
    avg_bias:         number;
    warning_count:    number;
    critical_count:   number;
    last_computed_at: string | null;
  };
  forecast_vs_actual: {
    avg_fill_rate_proxy: number;
    avg_variance_pct:    number;
    warning_count:       number;
    critical_count:      number;
    mape_status:         string;
    mape_note:           string;
    last_computed_at:    string | null;
  };
}

export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number; }

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchVersions = () =>
  fetch(apiUrl('/plan-actual/versions'), { cache: 'no-store' })
    .then(r => handleRes<{ data: SnapshotVersion[] }>(r));

export const computeComparison = (body: {
  comparisonType: ComparisonType;
  snapshotIdBase: string;
  snapshotIdCompare?: string;
  computedBy?: string;
}) =>
  fetch(apiUrl('/plan-actual/compute'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => handleRes<{ computed: number; warnings: number; criticals: number }>(r));

export const fetchPacSummary = () =>
  fetch(apiUrl('/plan-actual/summary'), { cache: 'no-store' })
    .then(r => handleRes<PacSummary>(r));

export const fetchComparisons = (params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/plan-actual/comparison?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: PlanActualRow[]; meta: PageMeta }>(r));
};

// ─── Upload Dataset ───────────────────────────────────────────────────────────

export interface UploadedDataset {
  datasetId:   string;
  name:        string;
  type:        'FORECAST' | 'ACTUAL';
  rowCount:    number;
  createdAt:   string;
  createdBy:   string | null;
}

export const fetchUploads = (type?: 'FORECAST' | 'ACTUAL') => {
  const q = type ? `?type=${type}` : '';
  return fetch(apiUrl(`/plan-actual/uploads${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: UploadedDataset[] }>(r));
};

export const uploadDataset = (file: File, name: string, type: 'FORECAST' | 'ACTUAL', createdBy?: string) => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('name', name);
  fd.append('type', type);
  if (createdBy) fd.append('createdBy', createdBy);
  return fetch(apiUrl('/plan-actual/upload'), { method: 'POST', body: fd })
    .then(r => handleRes<{ datasetId: string; rowCount: number; skippedRows: number; errors: string[] }>(r));
};

export const computeUploadCompare = (body: {
  uploadBaseId:    string;
  uploadCompareId: string;
  computedBy?:     string;
}) =>
  fetch(apiUrl('/plan-actual/compute'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, comparisonType: 'UPLOAD_COMPARE' }),
  }).then(r => handleRes<{ computed: number; warnings: number; criticals: number }>(r));

export const exportPacCsv = async (params: Record<string, string> = {}): Promise<void> => {
  const q = new URLSearchParams(params);
  const res = await fetch(apiUrl(`/plan-actual/export?${q}`));
  if (!res.ok) throw new Error(`Export failed: ${await res.text()}`);
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? 'plan_actual.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};
