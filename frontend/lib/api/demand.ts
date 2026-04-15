const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || '/api/v1';

/* ── Types ── */

export type SnapshotStatus = 'DRAFT' | 'FROZEN' | 'ARCHIVED';

export interface Snapshot {
  id: string;
  runId: string;
  status: SnapshotStatus;
  totalLines: number;
  totalItems: number;
  totalLocations?: number;
  frozenAt?: string | null;
  createdAt: string;
  // G5 metadata (F3)
  snapshotName?: string | null;
  sourceType?: string | null;
  forecastFileName?: string | null;
  horizonStart?: string | null;
  horizonEnd?: string | null;
  createdBy?: string | null;
}

export interface SnapshotLine {
  id: string;
  snapshotId: string;
  fskuId: string;
  locationId: string;
  forecastDate: string;
  forecastQty: number;
  segment: 'A' | 'B' | 'C';
}

export interface SummaryRow {
  itemCode: string;       // API returns itemCode (not fskuId)
  segment: 'A' | 'B' | 'C';
  totalQty: string;       // API returns string from SUM()
  lineCount: string;      // API returns string from COUNT()
}

export interface CoverageData {
  totalItems: number;
  itemsWithForecast: number;   // API field name
  withForecast: number;        // alias for FE compat
  withoutForecast: number;
  coveragePct: number;         // mapped from coveragePercent
  coveragePercent: number;     // API field name
  bySegment: Record<string, { total: number; covered: number; pct: number }>;
}

export interface DetailRow {
  fskuId: string;
  locationId: string;
  forecastDate: string;
  forecastQty: number;
  segment: 'A' | 'B' | 'C';
}

export interface OverrideDto {
  snapshotId: string;
  itemCode: string;
  locationCode: string;
  periodStart: string;
  newQty: number;
  reason: string;
  overriddenBy: string;
}

export interface PivotRow {
  itemCode: string;
  segment: string;
  qtySold12mAvg: number;
  periods: Record<string, number>;  // {"2025-12": 1838, "2026-01": 3388, ...}
  total: number;
}

export interface OverrideLog {
  id: string;
  snapshotId: string;
  itemCode: string;
  locationCode: string;
  periodStart: string;
  oldQty: number;
  newQty: number;
  reason: string;
  overriddenBy: string;
  createdAt: string;
}

export interface UploadResult {
  snapshotId: string;
  totalLines: number;
  errors: string[];
}

/* ── API Functions ── */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function fetchSnapshots(page = 1, pageSize = 10) {
  return request<{ data: Snapshot[]; pagination: unknown }>(
    `${API_BASE}/demand/snapshots?page=${page}&pageSize=${pageSize}`
  );
}

export async function fetchSnapshotDetail(
  id: string,
  page = 1,
  pageSize = 50
) {
  return request<{ snapshot: Snapshot; lines: SnapshotLine[]; pagination: unknown }>(
    `${API_BASE}/demand/snapshots/${id}?page=${page}&pageSize=${pageSize}`
  );
}

export async function freezeSnapshot(id: string) {
  return request<{ snapshot: Snapshot }>(
    `${API_BASE}/demand/snapshots/${id}/freeze`,
    { method: 'POST' }
  );
}

export async function deleteSnapshot(id: string) {
  return request<{ deleted: boolean; id: string }>(
    `${API_BASE}/demand/snapshots/${id}`,
    { method: 'DELETE' }
  );
}

export async function archiveSnapshot(id: string, archivedBy?: string) {
  return request<Snapshot>(
    `${API_BASE}/demand/snapshots/${id}/archive`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archivedBy: archivedBy ?? 'planner' }),
    }
  );
}

export async function fetchForecastSummary(params?: {
  page?: number;
  pageSize?: number;
  snapshotId?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
  if (params?.snapshotId) sp.set('snapshotId', params.snapshotId);
  const qs = sp.toString();
  return request<{ data: SummaryRow[]; pagination: unknown }>(
    `${API_BASE}/demand/forecast/summary${qs ? `?${qs}` : ''}`
  );
}

export async function fetchForecastCoverage(): Promise<CoverageData> {
  const raw = await request<any>(`${API_BASE}/demand/forecast/coverage`);
  // Map API field names to FE expected names
  return {
    ...raw,
    withForecast: raw.itemsWithForecast ?? raw.withForecast ?? 0,
    withoutForecast: (raw.totalItems ?? 0) - (raw.itemsWithForecast ?? raw.withForecast ?? 0),
    coveragePct: raw.coveragePercent ?? raw.coveragePct ?? 0,
    bySegment: raw.bySegment ?? {},
  };
}

export async function fetchForecastDetail(params?: {
  page?: number;
  pageSize?: number;
  fskuId?: string;
}) {
  const sp = new URLSearchParams();
  if (params?.page) sp.set('page', String(params.page));
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
  if (params?.fskuId) sp.set('fskuId', params.fskuId);
  const qs = sp.toString();
  return request<{ data: DetailRow[]; pagination: unknown }>(
    `${API_BASE}/demand/forecast/detail${qs ? `?${qs}` : ''}`
  );
}

// FE-A1: Tạo DRAFT snapshot rỗng thủ công
export async function createSnapshot(opts: {
  snapshotName: string;
  horizonStart?: string;
  horizonEnd?: string;
  notes?: string;
  createdBy?: string;
}): Promise<Snapshot> {
  return request<Snapshot>(`${API_BASE}/demand/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
}

export async function uploadForecast(
  file: File,
  opts: {
    runId?: string;
    snapshotName?: string;       // mode = tạo mới
    targetSnapshotId?: string;   // mode = upload vào DRAFT có sẵn
    createdBy?: string;
  } = {}
): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', file);
  if (opts.runId) form.append('runId', opts.runId);
  if (opts.snapshotName) form.append('snapshotName', opts.snapshotName);
  if (opts.targetSnapshotId) form.append('targetSnapshotId', opts.targetSnapshotId);
  if (opts.createdBy) form.append('createdBy', opts.createdBy);
  return request<UploadResult>(`${API_BASE}/demand/forecast/upload`, {
    method: 'POST',
    body: form,
  });
}

// FE-A2: Meta locations (filter UI)
export async function fetchDemandMetaLocations(): Promise<{ locations: string[] }> {
  return request<{ locations: string[] }>(`${API_BASE}/demand/meta/locations`);
}

export async function fetchForecastPivot(params?: {
  snapshotId?: string;
  segment?: string;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.snapshotId) sp.set('snapshotId', params.snapshotId);
  if (params?.segment) sp.set('segment', params.segment);
  if (params?.page) sp.set('page', String(params.page));
  if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
  const qs = sp.toString();
  return request<{ data: PivotRow[]; meta: unknown }>(
    `${API_BASE}/demand/forecast/pivot${qs ? `?${qs}` : ''}`
  );
}

export async function exportForecastCsv(snapshotId?: string) {
  const url = `${API_BASE}/demand/forecast/export${snapshotId ? '?snapshotId=' + snapshotId : ''}`;
  window.open(url, '_blank');
}

export async function fetchOverrideHistory(params?: {
  snapshotId?: string;
  itemCode?: string;
  page?: number;
}) {
  const sp = new URLSearchParams();
  if (params?.snapshotId) sp.set('snapshotId', params.snapshotId);
  if (params?.itemCode) sp.set('itemCode', params.itemCode);
  if (params?.page) sp.set('page', String(params.page));
  const qs = sp.toString();
  return request<{ data: OverrideLog[]; meta: unknown }>(
    `${API_BASE}/demand/overrides${qs ? `?${qs}` : ''}`
  );
}

/* ── Insights (spec DEMAND-INSIGHTS-SPEC.md) ── */

export interface PeriodBar { period: string; totalQty: number; itemCount: number; tetFlag: boolean }
export interface SegmentBar { segment: string; totalQty: number; itemCount: number; pct: number }
export interface ComboBar { comboClass: string; itemCount: number; pct: number }
export interface TetImpact { tetAvgQty: number; nonTetAvgQty: number; upliftPct: number; tetItemCount: number }

export interface InsightsSummaryData {
  byPeriod: PeriodBar[];
  bySegment: SegmentBar[];
  byComboClass: ComboBar[];
  tetImpact: TetImpact;
  totalDemand: number;
  totalItems: number;
  totalPeriods: number;
  overrideCount: number;
}

export interface QualityData {
  confidence: {
    avgSpreadPct: number;
    tight: { count: number; label: string };
    medium: { count: number; label: string };
    wide: { count: number; label: string };
  };
  alerts: {
    highAccProxy: { count: number; label: string };
    dormant: { count: number; label: string };
    noHistory: { count: number; label: string };
    ok: { count: number; label: string };
  };
  accuracyProxy: {
    avgPct: number;
    medianPct: number;
    bySegment: Record<string, number>;
  };
  dataMeta?: {
    panelMonthsAvg: number | null;
    combosDistinct: number;
    segmentsDistinct: number;
  };
}

export interface ZeroForecastAlert {
  itemCode: string;
  segment: string;
  comboClass: string;
  qtySold12mAvg: number;
  qtySold3mAvg: number;
  forecastQty: number;
  periodsWithZero: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

export interface AlertSummary { totalAlerts: number; critical: number; high: number; medium: number }

export interface BranchBreakdown {
  locationCode: string;
  locationName: string;
  region: string;
  branchArchetype: string;
  itemCount: number;
  totalQty: number;
  topSegment: string;
  tetQty: number;
  nonTetQty: number;
}
export interface ArchetypeSummary { archetype: string; branchCount: number; totalQty: number }

export async function fetchForecastInsights(snapshotId?: string) {
  const qs = snapshotId ? `?snapshotId=${snapshotId}` : '';
  return request<InsightsSummaryData>(`${API_BASE}/demand/forecast/insights${qs}`);
}

export async function fetchForecastQuality(snapshotId?: string) {
  const qs = snapshotId ? `?snapshotId=${snapshotId}` : '';
  return request<QualityData>(`${API_BASE}/demand/forecast/quality${qs}`);
}

export async function fetchForecastAlerts(snapshotId?: string, page = 1, pageSize = 20) {
  const sp = new URLSearchParams();
  if (snapshotId) sp.set('snapshotId', snapshotId);
  sp.set('page', String(page));
  sp.set('pageSize', String(pageSize));
  return request<{ data: ZeroForecastAlert[]; meta: unknown; summary: AlertSummary }>(
    `${API_BASE}/demand/forecast/alerts?${sp.toString()}`
  );
}

export async function fetchBranchBreakdown(snapshotId?: string, page = 1, pageSize = 50) {
  const sp = new URLSearchParams();
  if (snapshotId) sp.set('snapshotId', snapshotId);
  sp.set('page', String(page));
  sp.set('pageSize', String(pageSize));
  return request<{ data: BranchBreakdown[]; meta: unknown; byArchetype: ArchetypeSummary[] }>(
    `${API_BASE}/demand/forecast/branches?${sp.toString()}`
  );
}

/* ── Accuracy Dashboard (spec ACCURACY-DASHBOARD-SPEC.md) ── */

export type AccuracyMonth = 't10' | 't11' | 't12' | 't1';
export type AccuracyWinner = 'MODEL' | 'MA3' | 'ALL';
export type AccuracySort = 'actual_desc' | 'accuracy_asc' | 'accuracy_desc' | 'gain_desc';

export interface AccuracyMonthRow {
  month: string;
  skus: number;
  finalAcc: number | null;
  ma3Acc: number | null;
  gain: number;
  wmape: number | null;
  actualTotal: number | null;
  forecastTotal: number | null;
  highlight: boolean;
  live: boolean;
  pending: boolean;
}
export interface AccuracyTierRow {
  tier: string;
  skus: number;
  finalAcc: number;
  ma3Acc: number;
  gain: number;
}
export interface AccuracyKpi {
  modelAccT1: number;
  ma3AccT1: number;
  gainT1: number;
  skusEvaluated: number;
  modelAccT12: number;
  gainT12: number;
}
export interface AccuracySummary {
  byMonth: AccuracyMonthRow[];
  byTier: AccuracyTierRow[];
  kpi: AccuracyKpi;
}

export interface AccuracySkuRow {
  fsku: string;
  segment: string | null;
  actual: number | null;
  modelForecast: number | null;
  ma3Forecast: number | null;
  modelAccuracy: number;
  ma3Accuracy: number;
  winner: 'MODEL' | 'MA3';
  gain: number;
  isModified: boolean;
  // R5 + R8 — full horizon T10→T3
  actualT10: number | null;
  actualT11: number | null;
  actualT12: number | null;
  actualT1: number | null;
  fcT12: number | null;
  fcT1: number | null;
  fcT2: number | null;
  fcT3: number | null;
  accT12: number | null;
  accT1: number | null;
}

/* R1+R2: Tab 1 overview (data from demand_accuracy + item) */
export interface AccuracyOverview {
  kpi: {
    totalItems: number;
    activeItems: number;
    coveragePercent: number;
    dormantCount: number;
  };
  quality: {
    forecastRate: number;
    sparsity: number;
    dataMonths: number;
    segmentsDistinct: number;
  };
}

export async function fetchAccuracyOverview() {
  return request<AccuracyOverview>(`${API_BASE}/demand/accuracy/overview`);
}

/* R3: FSKU × Branch pivot (Tab 2) */
export interface BranchPivotRow {
  itemCode: string;
  locationCode: string;
  locationName: string;
  segment: string | null;
  periods: Record<string, number>;
  total: number;
}

/* R9: Branch row drill-down */
export interface BranchSummary {
  header: {
    locationCode: string;
    locationName: string;
    region: string | null;
    itemCount: number;
    totalQty: number;
  };
  byPeriod: { period: string; qty: number }[];
  bySegment: { segment: string; qty: number; items: number }[];
  topSkus: { itemCode: string; segment: string | null; totalQty: number }[];
}

export async function fetchBranchSummary(locationCode: string, snapshotId?: string) {
  const sp = new URLSearchParams({ locationCode });
  if (snapshotId) sp.set('snapshotId', snapshotId);
  return request<BranchSummary>(`${API_BASE}/demand/forecast/branch-summary?${sp.toString()}`);
}

export async function fetchBranchPivot(params: {
  snapshotId?: string;
  locationCode?: string;
  itemCode?: string;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  });
  return request<{
    data: BranchPivotRow[];
    periods: string[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`${API_BASE}/demand/forecast/branch-pivot${sp.toString() ? '?' + sp.toString() : ''}`);
}

export interface WorstPerformer {
  fsku: string;
  segment: string | null;
  actual: number | null;
  modelForecast: number | null;
  modelAccuracy: number;
  ma3Accuracy: number;
  forecastT2: number | null;
  forecastT3: number | null;
  action: 'REVIEW_NEEDED';
}

export async function fetchAccuracySummary() {
  return request<AccuracySummary>(`${API_BASE}/demand/accuracy/summary`);
}

export async function fetchAccuracySkus(params: {
  month?: AccuracyMonth;
  segment?: string;
  winner?: AccuracyWinner;
  sort?: AccuracySort;
  page?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  });
  return request<{ data: AccuracySkuRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }>(
    `${API_BASE}/demand/accuracy/skus?${sp.toString()}`
  );
}

/* ── TL v3.0 new endpoints ── */

export interface TrendMonthPoint {
  month: string;
  forecast: number | null;
  actual: number | null;
  skus: number;
  confLower: number | null;
  confUpper: number | null;
  pending: boolean;
}

export interface SkuTrendPoint {
  month: string;
  actual: number | null;
  forecast: number | null;
  wma: number | null;
  ma3: number | null;
}

export interface SkuStatusRow {
  status: string;
  count: number;
  pct: number;
}

export async function fetchAccuracyTrend() {
  return request<{ months: TrendMonthPoint[] }>(`${API_BASE}/demand/accuracy/trend`);
}

export async function fetchSkuTrend(fsku: string) {
  return request<{ fsku: string; months: SkuTrendPoint[] }>(
    `${API_BASE}/demand/accuracy/sku-trend?fsku=${encodeURIComponent(fsku)}`
  );
}

export async function fetchSkuStatus() {
  return request<{ statuses: SkuStatusRow[]; total: number }>(`${API_BASE}/demand/forecast/sku-status`);
}

export async function fetchWorstPerformers(params?: {
  month?: 't12' | 't1';
  threshold?: number;
  minActual?: number;
  pageSize?: number;
}) {
  const sp = new URLSearchParams();
  if (params) Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined) sp.set(k, String(v));
  });
  return request<{ data: WorstPerformer[]; meta: { total: number; threshold: number; minActual: number; month: string } }>(
    `${API_BASE}/demand/accuracy/worst${sp.toString() ? '?' + sp.toString() : ''}`
  );
}

export async function overrideForecast(data: OverrideDto) {
  return request<{ success: boolean; overrideId: string }>(
    `${API_BASE}/demand/forecast/override`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
}

/* ── I-1 to I-10 + Tab 3 Analyst Endpoints ── */

// I-2: Pareto
export interface ParetoItem {
  rank: number;
  fsku: string;
  demand: number;
  demandPct: number;
  cumulativePct: number;
}
export async function fetchPareto() {
  return request<{ items: ParetoItem[]; summary: Record<string, any> }>(`${API_BASE}/demand/accuracy/pareto`);
}

// I-3: Scatter
export interface ScatterPoint {
  fsku: string;
  segment: string;
  actual: number;
  modelAcc: number;
  ma3Acc: number;
}
export async function fetchScatter(month = 't1') {
  return request<{ points: ScatterPoint[]; quadrants: Record<string, number>; month: string }>(
    `${API_BASE}/demand/accuracy/scatter?month=${month}`
  );
}

// I-4: Heatmap
export interface HeatmapRow {
  segment: string;
  tiers: Record<string, { acc: number | null; count: number }>;
  total: number;
}
export async function fetchHeatmap() {
  return request<{ rows: HeatmapRow[]; tiers: string[] }>(`${API_BASE}/demand/accuracy/heatmap`);
}

// I-5: Volatility
export interface VolatilityBin {
  range: string;
  count: number;
  pct: number;
  label: string;
  color: string;
}
export async function fetchVolatility() {
  return request<{ bins: VolatilityBin[]; total: number }>(`${API_BASE}/demand/accuracy/volatility`);
}

// I-6: Branch heatmap
export interface BranchHeatmapRow {
  branchCode: string;
  branchName: string;
  periods: Record<string, number>;
  total: number;
}
export async function fetchBranchHeatmap(snapshotId?: string) {
  const qs = snapshotId ? `?snapshotId=${snapshotId}` : '';
  return request<{ branches: BranchHeatmapRow[]; periods: string[] }>(`${API_BASE}/demand/forecast/branch-heatmap${qs}`);
}

// I-10: Compare
export interface CompareRow {
  fsku: string;
  segment: string | null;
  fc1: number | null;
  actual1: number | null;
  acc1: number | null;
  fc2: number | null;
  actual2: number | null;
  acc2: number | null;
  changePct: number | null;
  accChange: number | null;
}
export async function fetchCompare(month1 = 't12', month2 = 't1', page = 1, pageSize = 50) {
  return request<{ data: CompareRow[]; meta: { page: number; pageSize: number; total: number; totalPages: number; month1: string; month2: string } }>(
    `${API_BASE}/demand/accuracy/compare?month1=${month1}&month2=${month2}&page=${page}&pageSize=${pageSize}`
  );
}

// Tab 3: Error distribution (I-11)
export interface ErrorDistBin { range: string; count: number; pct: number; min: number; max: number }
export interface TailSKU { fsku: string; mape: number; segment: string; actual: number }
export async function fetchErrorDistribution(month = 't1', segment?: string) {
  const sp = new URLSearchParams({ month });
  if (segment) sp.set('segment', segment);
  return request<{
    bins: ErrorDistBin[];
    percentiles: Record<string, number>;
    mean: number;
    stdDev: number;
    tailSKUs: TailSKU[];
    total: number;
    month: string;
  }>(`${API_BASE}/demand/accuracy/error-distribution?${sp.toString()}`);
}

// Tab 3: Bias (I-13)
export interface BiasItem { dimension: string; label: string; bias: number; count: number; avgActual: number }
export async function fetchBias(groupBy = 'segment', month = 't1') {
  return request<{ items: BiasItem[]; groupBy: string }>(
    `${API_BASE}/demand/accuracy/bias?groupBy=${groupBy}&month=${month}`
  );
}

// Tab 3: Bias heatmap (I-14)
export interface BiasHeatmapRow { branchCode: string; branchName: string; segA: number | null; segB: number | null; segC: number | null; avg: number | null }
export async function fetchBiasHeatmap(month = 't1') {
  return request<{ rows: BiasHeatmapRow[]; month: string }>(`${API_BASE}/demand/accuracy/bias-heatmap?month=${month}`);
}

// Tab 3: Cohort (I-19)
export interface CohortRow { label: string; count: number; months: Record<string, number | null>; gainVsMA3: number | null }
export async function fetchCohort(month = 't1') {
  return request<{ cohorts: CohortRow[]; month: string }>(`${API_BASE}/demand/accuracy/cohort?month=${month}`);
}

// Tab 3: CI Calibration (I-21)
export interface CiLevel { target: number; actualCoverage: number | null; total: number }
export interface CiSegment { segment: string; coverage80: number | null; total: number }
export async function fetchCiCalibration() {
  return request<{ levels: CiLevel[]; bySegment: CiSegment[] }>(`${API_BASE}/demand/accuracy/ci-calibration`);
}

// Tab 3: Seasonality (I-16)
export interface SeasonalIndex { month: string; label: string; index: number; actual: number }
export async function fetchSeasonality() {
  return request<{ indices: SeasonalIndex[]; overallAvg: number }>(`${API_BASE}/demand/accuracy/seasonality`);
}
