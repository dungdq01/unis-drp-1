'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  fetchSnapshots,
  fetchForecastCoverage,
  exportForecastCsv,
  freezeSnapshot as apiFreezeSnapshot,
  deleteSnapshot as apiDeleteSnapshot,
  archiveSnapshot as apiArchiveSnapshot,
  uploadForecast,
  overrideForecast,
  fetchForecastInsights,
  fetchForecastQuality,
  fetchForecastAlerts,
  fetchBranchBreakdown,
  type Snapshot,
  type CoverageData,
  type InsightsSummaryData,
  type QualityData,
  type ZeroForecastAlert,
  type AlertSummary,
  type BranchBreakdown,
  type ArchetypeSummary,
} from '@/lib/api/demand';

// Tab 2 — new improvement components (I-6 to I-8, I-10)
import { BranchPerformanceRanking } from '@/components/demand/branch-performance-ranking';
import { SegmentMixBranch } from '@/components/demand/segment-mix-branch';
import { PeriodComparison } from '@/components/demand/period-comparison';

// Tab 3 — Analyst View (I-11 to I-22)
import { MapeHistogram } from '@/components/demand/analyst/mape-histogram';
import { ErrorTailPie } from '@/components/demand/analyst/error-tail-pie';
import { BiasDivergingBar } from '@/components/demand/analyst/bias-diverging-bar';
import { BiasHeatmap } from '@/components/demand/analyst/bias-heatmap';
import { AccuracyTrendChart } from '@/components/demand/analyst/accuracy-trend-chart';
import { SeasonalityChart } from '@/components/demand/analyst/seasonality-chart';
import { AccuracyMatrixBubble } from '@/components/demand/analyst/accuracy-matrix-bubble';
import { AccuracyVolumeScatter } from '@/components/demand/analyst/accuracy-volume-scatter';
import { CohortAccuracyChart } from '@/components/demand/analyst/cohort-accuracy-chart';
import { LifecycleStageBar } from '@/components/demand/analyst/lifecycle-stage-bar';
import { CiCalibrationChart } from '@/components/demand/analyst/ci-calibration-chart';
import { ConfidenceScatter } from '@/components/demand/analyst/confidence-scatter';
import { SnapshotTable } from '@/components/demand/snapshot-table';
import { CoverageGauge } from '@/components/demand/coverage-gauge';
import { UploadDialog } from '@/components/demand/upload-dialog';
import { CreateSnapshotDialog } from '@/components/demand/create-snapshot-dialog';
import { OverrideDialog, type OverrideCellData } from '@/components/demand/override-dialog';
import { OverrideHistoryModal } from '@/components/demand/override-history-modal';
import { InsightsSummary } from '@/components/demand/insights-summary';
import { QualityCard } from '@/components/demand/quality-card';
import { ZeroForecastTable } from '@/components/demand/zero-forecast-table';
import { BranchTable } from '@/components/demand/branch-table';
import { AccuracyByMonth } from '@/components/demand/accuracy-by-month';
import { AccuracyByTier } from '@/components/demand/accuracy-by-tier';
import { WorstPerformers } from '@/components/demand/worst-performers';
import { SkuStatusDonut } from '@/components/demand/sku-status-donut';
import { DataQualityGauges } from '@/components/demand/data-quality-gauges';
import { ForecastTrendChart } from '@/components/demand/forecast-trend-chart';
import { FskuAccuracyTable } from '@/components/demand/fsku-accuracy-table';
import { FskuBranchTable } from '@/components/demand/fsku-branch-table';
import { AutoInsightsBanner } from '@/components/demand/auto-insights-banner';
import { SkuPipelinePanel } from '@/components/demand/sku-pipeline-panel';
import { AccuracyComparisonPanel } from '@/components/demand/accuracy-comparison-panel';
import { KpiCardSkeleton, ChartSkeleton } from '@/components/shared/skeleton';
import {
  fetchAccuracySummary,
  fetchWorstPerformers,
  fetchAccuracyTrend,
  fetchSkuStatus,
  fetchAccuracyOverview,
  type AccuracySummary,
  type WorstPerformer,
  type TrendMonthPoint,
  type SkuStatusRow,
  type AccuracyMonth,
  type AccuracyOverview,
} from '@/lib/api/demand';

export default function DemandPage() {
  const searchParams = useSearchParams();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | undefined>(
    searchParams.get('snapshot') ?? undefined
  );
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateSnapshot, setShowCreateSnapshot] = useState(false);
  const [overrideLine, setOverrideLine] = useState<OverrideCellData | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItemCode, setHistoryItemCode] = useState<string | undefined>();
  const [drillSegment, setDrillSegment] = useState<string | undefined>();
  // Insights state (spec DEMAND-INSIGHTS-SPEC)
  // TL v3.0: Tab 1 = Forecast Overview (accuracy-driven), Tab 2 = Branch Forecast, Tab 3 = Analyst View.
  const [tab, setTab] = useState<'overview' | 'branch' | 'analyst'>('overview');
  const [analystLoaded, setAnalystLoaded] = useState(false);
  const [overview, setOverview] = useState<AccuracyOverview | null>(null);
  const [accuracy, setAccuracy] = useState<AccuracySummary | null>(null);
  const [worst, setWorst] = useState<WorstPerformer[]>([]);
  const [worstTotal, setWorstTotal] = useState(0);
  const [trend, setTrend] = useState<TrendMonthPoint[]>([]);
  const [skuStatus, setSkuStatus] = useState<{ statuses: SkuStatusRow[]; total: number } | null>(null);
  const [trendPeriodFilter, setTrendPeriodFilter] = useState<AccuracyMonth | undefined>(undefined);
  const [insights, setInsights] = useState<InsightsSummaryData | null>(null);
  const [quality, setQuality] = useState<QualityData | null>(null);
  const [alerts, setAlerts] = useState<ZeroForecastAlert[]>([]);
  const [alertSummary, setAlertSummary] = useState<AlertSummary | null>(null);
  const [branches, setBranches] = useState<BranchBreakdown[]>([]);
  const [byArchetype, setByArchetype] = useState<ArchetypeSummary[]>([]);

  const loadPivot = useCallback(async (_f: Record<string, string | undefined> = {}, _snapshotId?: string) => {
    // pivot fetch removed (FskuHeartbeatExplorer removed for performance)
  }, []);

  // R1: DATA ISOLATION — Tab 1 (Overview) ONLY calls accuracy+item endpoints;
  // Tab 2 (Branch) ONLY calls demand_snapshot_line/demand_forecast_detail endpoints.
  // Shared state: `snapshots` list (used by Tab 2 snapshot table).

  const loadOverviewData = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, acc, wst, trd, sts] = await Promise.all([
        fetchAccuracyOverview().catch(() => null),
        fetchAccuracySummary().catch(() => null),
        fetchWorstPerformers({ month: 't1', threshold: 20, minActual: 100, pageSize: 50 }).catch(() => null),
        fetchAccuracyTrend().catch(() => null),
        fetchSkuStatus().catch(() => null),
      ]);
      setOverview(ov);
      setAccuracy(acc);
      if (wst) { setWorst(wst.data); setWorstTotal(wst.meta.total); }
      if (trd) setTrend(trd.months);
      setSkuStatus(sts);
    } catch { /* keep state empty on error */ } finally {
      setLoading(false);
    }
  }, []);

  const loadBranchData = useCallback(async () => {
    setLoading(true);
    try {
      const [snaps, cov] = await Promise.all([
        fetchSnapshots(),
        fetchForecastCoverage(),
      ]);
      setSnapshots(snaps.data);
      setCoverage(cov);
      const snapshotId = selectedSnapshotId || snaps.data[0]?.id;
      if (!selectedSnapshotId && snapshotId) setSelectedSnapshotId(snapshotId);
      await loadPivot(filters, snapshotId);

      const [ins, qua, alr, brc] = await Promise.all([
        fetchForecastInsights(snapshotId).catch(() => null),
        fetchForecastQuality(snapshotId).catch(() => null),
        fetchForecastAlerts(snapshotId, 1, 20).catch(() => null),
        fetchBranchBreakdown(snapshotId, 1, 100).catch(() => null),
      ]);
      setInsights(ins);
      setQuality(qua);
      if (alr) { setAlerts(alr.data); setAlertSummary(alr.summary); }
      if (brc) { setBranches(brc.data); setByArchetype(brc.byArchetype); }
    } catch { /* keep state empty on error */ } finally {
      setLoading(false);
    }
  }, [filters, loadPivot, selectedSnapshotId]);

  // Fire only the relevant loader per tab (lazy-load, data isolation).
  // R10 cache guard: skip re-fetch when data already present — prevents white-flash on tab switch.
  useEffect(() => {
    if (tab === 'overview') {
      if (!overview || !accuracy) loadOverviewData();
    } else if (tab === 'branch') {
      if (snapshots.length === 0 || !insights) loadBranchData();
    } else if (tab === 'analyst') {
      // Self-fetching components; but AccuracyTrendChart + LifecycleStageBar need overview data
      if (!accuracy || !skuStatus) loadOverviewData();
      setAnalystLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Keep compat alias so existing handleFreeze/Delete/Archive keep working.
  const loadData = loadBranchData;

  const handleFreeze = async (id: string) => {
    await apiFreezeSnapshot(id);
    await loadData();
  };

  const handleDelete = async (id: string) => {
    await apiDeleteSnapshot(id);
    if (selectedSnapshotId === id) setSelectedSnapshotId(undefined);
    await loadData();
  };

  const handleArchive = async (id: string) => {
    await apiArchiveSnapshot(id);
    await loadData();
  };

  // G9: Coverage gauge drill-down — click a segment to filter pivot
  const handleSegmentDrill = (segment: string) => {
    setDrillSegment(segment);
    const newFilters = { ...filters, segment };
    setFilters(newFilters);
    loadPivot(newFilters, selectedSnapshotId);
  };

  const handleSelect = (id: string) => {
    setSelectedSnapshotId(id);
    loadPivot(filters, id);
  };

  const handleSnapshotCreated = async () => {
    setShowCreateSnapshot(false);
    await loadData();
  };

  const handleUpload = async (file: File, opts: { runId?: string; snapshotName?: string; targetSnapshotId?: string }) => {
    const result = await uploadForecast(file, opts);
    await loadData();
    return result;
  };

  const handleOverride = async (data: Parameters<typeof overrideForecast>[0]) => {
    await overrideForecast(data);
    await loadData();
  };

  const handleFilterChange = (f: Record<string, string | undefined>) => {
    setFilters(f);
    loadPivot(f, selectedSnapshotId);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-100">
            <span className="font-mono text-sm font-bold text-sky-600">01</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Demand Ingestion</h1>
            <p className="text-sm text-slate-500">Import Forecast &middot; Freeze Snapshot</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setHistoryItemCode(undefined); setHistoryOpen(true); }}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm transition-all"
          >
            History
          </button>
          <button
            onClick={() => exportForecastCsv(selectedSnapshotId)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-sky-600 bg-white border border-sky-200 hover:bg-sky-50 shadow-sm transition-all"
          >
            Export CSV
          </button>
          <button
            onClick={() => setShowCreateSnapshot(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm transition-all"
          >
            + New Snapshot
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-sky-500 to-blue-500 hover:from-sky-600 hover:to-blue-600 shadow-sm transition-all"
          >
            Upload CSV
          </button>
        </div>
      </div>

      {/* Tab switcher — TL v3.0: Overview primary, Branch secondary */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('overview')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'overview'
              ? 'text-sky-600 border-b-2 border-sky-500 -mb-px'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Forecast Overview
          {accuracy && (
            <span className="ml-2 px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700">
              {accuracy.kpi.modelAccT1.toFixed(1)}% T1
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('branch')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'branch'
              ? 'text-sky-600 border-b-2 border-sky-500 -mb-px'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Branch Forecast
        </button>
        {/* Analyst View tab hidden — too many charts cause lag; re-enable when needed */}
        {false && (
          <button
            onClick={() => setTab('analyst')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'analyst'
                ? 'text-sky-600 border-b-2 border-sky-500 -mb-px'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Analyst View
          </button>
        )}
      </div>

      {/* ═══ TAB 1 — FORECAST OVERVIEW (R1 data isolation: accuracy+item ONLY) ═══ */}
      {tab === 'overview' && loading && !overview && <>
        {/* R10 skeleton — shown only on first load to avoid white flash */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <KpiCardSkeleton key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <ChartSkeleton height={280} />
          <div className="lg:col-span-2"><ChartSkeleton height={280} /></div>
        </div>
        <ChartSkeleton height={360} />
      </>}

      {tab === 'overview' && (overview || !loading) && <>
        {/* I-9: Auto-insights banner (rule-based takeaways above KPIs) */}
        <AutoInsightsBanner overview={overview} accuracy={accuracy} worstTotal={worstTotal} />

        {/* Row 1+2 consolidated: 2 panels side-by-side.
            Left  = SKU Pipeline (Total → Active → Evaluated + Dormant + Coverage ring)
            Right = Model vs MA3 Accuracy (chart + Model/MA3/Gap big numbers) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <SkuPipelinePanel overview={overview} accuracy={accuracy} skuStatus={skuStatus} />
          <AccuracyComparisonPanel accuracy={accuracy} />
        </div>

        {/* Row 3: SKU Status Donut (1/3) + Data Quality Gauges (2/3) — R7 hierarchy */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1">
            <SkuStatusDonut statuses={skuStatus?.statuses ?? []} total={skuStatus?.total ?? 0} />
          </div>
          <div className="lg:col-span-2">
            <DataQualityGauges metrics={overview ? {
              forecastRate: overview.quality.forecastRate,
              sparsity: overview.quality.sparsity,
              dataMonths: overview.quality.dataMonths,
              segments: overview.quality.segmentsDistinct,
            } : null} />
          </div>
        </div>

        {/* Row 3: Forecast Trend (STAR feature) */}
        <ForecastTrendChart data={trend} onPeriodClick={(m) => {
          const map: Record<string, AccuracyMonth> = { T10: 't10', T11: 't11', T12: 't12', T1: 't1' };
          if (map[m]) setTrendPeriodFilter(map[m]);
        }} />

        {/* Row 4: Accuracy tables */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccuracyByMonth rows={accuracy?.byMonth ?? []} />
          <AccuracyByTier rows={accuracy?.byTier ?? []} />
        </div>

        {/* Row 5: FSKU Table — professional */}
        <FskuAccuracyTable forcedMonth={trendPeriodFilter} onMonthChange={setTrendPeriodFilter} />

        {/* Row 6: Worst Performers */}
        <WorstPerformers items={worst} total={worstTotal} threshold={20} />

      </>}

      {/* ═══ TAB 2 — BRANCH FORECAST ═══ */}
      {tab === 'branch' && <>
        {/* Row 1: Coverage only — 3 KPI còn lại (Total Demand, Forecast Accuracy link,
            Tết Items) đã bỏ vì thừa/trùng với Tab 1 và Auto-Insights banner */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <CoverageGauge coverage={coverage} onSegmentClick={handleSegmentDrill} activeSegment={drillSegment} />
        </div>

        {/* ── Row 2: Branch insights — charts (period/segment/branches/combo) ── */}
        <InsightsSummary insights={insights} topBranches={branches} />

        {/* I-7 to I-8: Branch analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BranchPerformanceRanking branches={branches} />
          <SegmentMixBranch branches={branches} />
        </div>

        {/* ── Row 3: FSKU × Branch DETAIL ── */}
        <div className="space-y-2">
          <div className="px-1">
            <h2 className="text-base font-semibold text-slate-800">Forecast chi tiết theo Chi nhánh</h2>
            <p className="text-xs text-slate-500">
              Chọn chi nhánh → xem demand từng FSKU. Click ▸ để xem <span className="font-semibold text-sky-700">xung nhịp</span> forecast.
            </p>
          </div>
          <FskuBranchTable
            snapshotId={selectedSnapshotId}
            branchOptions={branches.map(b => ({
              locationCode: b.locationCode,
              locationName: b.locationName || b.locationCode,
            }))}
          />
        </div>

        {/* ── Row 4: Branch breakdown (summary per branch) ── */}
        <BranchTable branches={branches} byArchetype={byArchetype} snapshotId={selectedSnapshotId} />

        {/* ── Row 5: Snapshot management ── */}
        <SnapshotTable
          snapshots={snapshots}
          onSelect={handleSelect}
          onFreeze={handleFreeze}
          onDelete={handleDelete}
          onArchive={handleArchive}
        />

        {/* ── Row 7: Quality + Alerts ── */}
        <QualityCard quality={quality} />
        <ZeroForecastTable alerts={alerts} summary={alertSummary} />

        {/* I-10: Period Comparison */}
        <PeriodComparison />
      </>}

      {/* ═══ TAB 3 — ANALYST VIEW (I-11 to I-22) ═══ */}
      {tab === 'analyst' && <>
        {/* Section A: Error Distribution */}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800 px-1">A — Error Distribution</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MapeHistogram />
            <ErrorTailPie />
          </div>
        </div>

        {/* Section B: Bias Analysis */}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800 px-1">B — Bias Analysis</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BiasDivergingBar />
            <BiasHeatmap />
          </div>
        </div>

        {/* Section C: Temporal */}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800 px-1">C — Temporal Accuracy</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AccuracyTrendChart accuracy={accuracy} />
            <SeasonalityChart />
          </div>
        </div>

        {/* Section D: Cross-Dimensional */}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800 px-1">D — Cross-Dimensional</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AccuracyMatrixBubble />
            <AccuracyVolumeScatter />
          </div>
        </div>

        {/* Section E: Cohort & Lifecycle */}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800 px-1">E — Cohort &amp; Lifecycle</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CohortAccuracyChart />
            <LifecycleStageBar statuses={skuStatus?.statuses ?? []} total={skuStatus?.total ?? 0} />
          </div>
        </div>

        {/* Section F: Diagnostics */}
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-800 px-1">F — Diagnostics</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <CiCalibrationChart />
            <ConfidenceScatter />
          </div>
        </div>
      </>}

      {/* Dialogs */}
      <CreateSnapshotDialog
        open={showCreateSnapshot}
        onClose={() => setShowCreateSnapshot(false)}
        onCreated={handleSnapshotCreated}
      />
      <UploadDialog
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onUpload={handleUpload}
        draftSnapshots={snapshots.filter(s => s.status === 'DRAFT')}
      />
      <OverrideDialog
        open={!!overrideLine}
        onClose={() => setOverrideLine(null)}
        line={overrideLine}
        onOverride={handleOverride}
      />
      <OverrideHistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        snapshotId={selectedSnapshotId}
        itemCode={historyItemCode}
      />
    </div>
  );
}
