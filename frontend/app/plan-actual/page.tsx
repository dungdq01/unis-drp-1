'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchVersions, computeComparison, fetchPacSummary, fetchComparisons, exportPacCsv,
  fetchUploads, uploadDataset, computeUploadCompare,
  type SnapshotVersion, type PlanActualRow, type PacSummary, type PageMeta, type UploadedDataset,
} from '@/lib/api/plan-actual';

// ─── Upload Panel ─────────────────────────────────────────────────────────────

function UploadPanel({ onComputed }: { onComputed: () => void }) {
  const [forecasts, setForecasts]   = useState<UploadedDataset[]>([]);
  const [actuals, setActuals]       = useState<UploadedDataset[]>([]);
  const [uploading, setUploading]   = useState(false);
  const [computing, setComputing]   = useState(false);
  const [toast, setToast]           = useState<string | null>(null);
  const [selForecast, setSelForecast] = useState('');
  const [selActual, setSelActual]     = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<'FORECAST' | 'ACTUAL'>('FORECAST');
  const [uploadName, setUploadName] = useState('');

  const show = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 4000); };

  const loadUploads = useCallback(async () => {
    try {
      const [fRes, aRes] = await Promise.all([fetchUploads('FORECAST'), fetchUploads('ACTUAL')]);
      setForecasts(fRes.data);
      setActuals(aRes.data);
    } catch {}
  }, []);

  useEffect(() => { loadUploads(); }, [loadUploads]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { show('⚠️ Chưa chọn file'); return; }
    if (!uploadName.trim()) { show('⚠️ Nhập tên dataset'); return; }
    setUploading(true);
    try {
      const r = await uploadDataset(file, uploadName.trim(), uploadType, 'planner');
      show(`✅ Upload OK — ${r.rowCount} rows${r.skippedRows ? `, bỏ qua ${r.skippedRows}` : ''}`);
      if (fileRef.current) fileRef.current.value = '';
      setUploadName('');
      await loadUploads();
    } catch (e: any) { show(`❌ ${e.message}`); }
    finally { setUploading(false); }
  };

  const handleCompute = async () => {
    if (!selForecast || !selActual) { show('⚠️ Chọn cả Forecast và Actual dataset'); return; }
    setComputing(true);
    try {
      const r = await computeUploadCompare({ uploadBaseId: selForecast, uploadCompareId: selActual, computedBy: 'planner' });
      show(`✅ Computed ${r.computed} rows — Warnings: ${r.warnings}, Criticals: ${r.criticals}`);
      onComputed();
    } catch (e: any) { show(`❌ ${e.message}`); }
    finally { setComputing(false); }
  };

  return (
    <div className="glass-card p-5 space-y-4">
      {toast && (
        <div className="fixed top-4 right-4 z-50 glass-card px-4 py-3 text-sm text-slate-700 shadow-lg max-w-sm">{toast}</div>
      )}
      <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Upload & Compare (CSV)</p>

      {/* Upload row */}
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Loại</label>
          <select
            value={uploadType}
            onChange={e => setUploadType(e.target.value as 'FORECAST' | 'ACTUAL')}
            className="rounded border border-slate-200 px-2 py-1.5 text-xs bg-white"
          >
            <option value="FORECAST">FORECAST</option>
            <option value="ACTUAL">ACTUAL</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Tên dataset</label>
          <input
            value={uploadName}
            onChange={e => setUploadName(e.target.value)}
            placeholder="VD: Forecast April 2026"
            className="rounded border border-slate-200 px-2 py-1.5 text-xs w-52"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">File CSV</label>
          <input ref={fileRef} type="file" accept=".csv" className="text-xs" />
        </div>
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="rounded-md bg-emerald-600 text-white px-4 py-2 text-xs font-medium hover:bg-emerald-700 disabled:opacity-40 self-end"
        >
          {uploading ? '⏳ Uploading…' : '⬆ Upload'}
        </button>
      </div>

      <p className="text-[10px] text-slate-400">
        Cột CSV bắt buộc: <span className="font-mono">item_code, location_code, period_start, qty, demand_type, segment</span>
      </p>

      {/* Compare row */}
      <div className="flex flex-wrap gap-2 items-end border-t border-slate-100 pt-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Forecast dataset (Base)</label>
          <select
            value={selForecast}
            onChange={e => setSelForecast(e.target.value)}
            className="rounded border border-slate-200 px-2 py-1.5 text-xs min-w-[200px] bg-white"
          >
            <option value="">-- Chọn --</option>
            {forecasts.map(d => (
              <option key={d.datasetId} value={d.datasetId}>{d.name} ({d.rowCount} rows)</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500">Actual dataset (Compare)</label>
          <select
            value={selActual}
            onChange={e => setSelActual(e.target.value)}
            className="rounded border border-slate-200 px-2 py-1.5 text-xs min-w-[200px] bg-white"
          >
            <option value="">-- Chọn --</option>
            {actuals.map(d => (
              <option key={d.datasetId} value={d.datasetId}>{d.name} ({d.rowCount} rows)</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleCompute}
          disabled={computing}
          className="rounded-md bg-violet-600 text-white px-4 py-2 text-xs font-medium hover:bg-violet-700 disabled:opacity-40 self-end"
        >
          {computing ? '⏳ Computing…' : '⚡ Upload Compare'}
        </button>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPct  = (v: number | null | undefined) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%`;

const fmtQty  = (v: number | null | undefined) =>
  v == null ? '—' : Number(v).toLocaleString('vi-VN', { maximumFractionDigits: 1 });

const fmtRate = (v: number | null | undefined) =>
  v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`;

const STATUS_CLS: Record<string, string> = {
  ON_TARGET: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  WARNING:   'bg-amber-50   text-amber-700   border-amber-200',
  CRITICAL:  'bg-red-50     text-red-700     border-red-200',
  N_A:       'bg-slate-50   text-slate-500   border-slate-200',
};

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

// ─── Summary Card ─────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color }: {
  label: string; value: string; sub: string; color: 'green' | 'amber' | 'red' | 'slate';
}) {
  const colors = {
    green: 'text-emerald-700',
    amber: 'text-amber-600',
    red:   'text-red-600',
    slate: 'text-slate-400',
  };
  return (
    <div className="kpi-card">
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${colors[color]}`}>{value}</p>
      <p className="text-[10px] text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanActualPage() {
  const [summary, setSummary]   = useState<PacSummary | null>(null);
  const [versions, setVersions] = useState<SnapshotVersion[]>([]);
  const [rows, setRows]         = useState<PlanActualRow[]>([]);
  const [meta, setMeta]         = useState<PageMeta | null>(null);
  const [loading, setLoading]   = useState(false);
  const [toast, setToast]       = useState<string | null>(null);

  // Compare state
  const [snapA, setSnapA]       = useState('');
  const [snapB, setSnapB]       = useState('');
  const [computing, setComputing] = useState(false);

  // Filter state
  const [filterType, setFilterType]     = useState('');
  const [filterItem, setFilterItem]     = useState('');
  const [filterLoc, setFilterLoc]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [page, setPage]                 = useState(1);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadSummary = useCallback(async () => {
    try { setSummary(await fetchPacSummary()); } catch {}
  }, []);

  const loadVersions = useCallback(async () => {
    try { const r = await fetchVersions(); setVersions(r.data); } catch {}
  }, []);

  const loadRows = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: p, pageSize: 50 };
      if (filterType)   params.comparisonType = filterType;
      if (filterItem)   params.itemCode       = filterItem;
      if (filterLoc)    params.locationCode   = filterLoc;
      if (filterStatus) params.status         = filterStatus;
      const r = await fetchComparisons(params);
      setRows(r.data); setMeta(r.meta); setPage(p);
    } catch { setRows([]); }
    finally { setLoading(false); }
  }, [filterType, filterItem, filterLoc, filterStatus]);

  useEffect(() => { loadSummary(); loadVersions(); loadRows(1); }, []);

  const handleCompute = async (type: 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL') => {
    if (type === 'FORECAST_VERSION' && (!snapA || !snapB)) {
      showToast('⚠️ Vui lòng chọn cả 2 snapshot để so sánh'); return;
    }
    if (type === 'FORECAST_VS_ACTUAL' && !snapA) {
      showToast('⚠️ Vui lòng chọn snapshot (plan)'); return;
    }
    setComputing(true);
    try {
      const r = await computeComparison({
        comparisonType:    type,
        snapshotIdBase:    snapA,
        snapshotIdCompare: type === 'FORECAST_VERSION' ? snapB : undefined,
        computedBy:        'planner',
      });
      showToast(`✅ Computed ${r.computed} rows — Warnings: ${r.warnings}, Criticals: ${r.criticals}`);
      await Promise.all([loadSummary(), loadRows(1)]);
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally { setComputing(false); }
  };

  const handleExport = async () => {
    try {
      const params: Record<string, string> = {};
      if (filterType)   params.comparisonType = filterType;
      if (filterStatus) params.status         = filterStatus;
      if (filterItem)   params.itemCode       = filterItem;
      await exportPacCsv(params);
    } catch (e: any) { showToast(`❌ Export lỗi: ${e.message}`); }
  };

  const fvAvgAbs = Math.abs(summary?.forecast_version?.avg_variance_pct ?? 0);
  const fvaRate  = summary?.forecast_vs_actual?.avg_fill_rate_proxy ?? 1;

  return (
    <div className="flex flex-col h-full min-h-0 p-5 gap-4 overflow-auto">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 glass-card px-4 py-3 text-sm text-slate-700 shadow-lg max-w-sm">
          {toast}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 border border-violet-100">
          <span className="font-mono text-[13px] font-bold text-violet-700">09</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Plan vs Actual</h1>
          <p className="text-xs text-slate-500">Forecast Version Compare · Forecast vs Actual · Variance Analysis</p>
        </div>
      </div>

      {/* ── Summary Row ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Avg Variance (FV)"
          value={fmtPct(summary?.forecast_version?.avg_variance_pct)}
          sub={`Bias: ${fmtPct(summary?.forecast_version?.avg_bias)}`}
          color={fvAvgAbs > 20 ? 'amber' : 'green'}
        />
        <KpiCard
          label="Critical Items (FV)"
          value={String(summary?.forecast_version?.critical_count ?? '—')}
          sub={`Warnings: ${summary?.forecast_version?.warning_count ?? '—'}`}
          color={(summary?.forecast_version?.critical_count ?? 0) > 0 ? 'red' : 'green'}
        />
        <KpiCard
          label="Fill Rate Proxy (FvA)"
          value={fmtRate(summary?.forecast_vs_actual?.avg_fill_rate_proxy)}
          sub="EXPORTED / Forecast (proxy)"
          color={fvaRate < 0.9 ? 'amber' : 'green'}
        />
        <KpiCard
          label="MAPE"
          value="N/A"
          sub="BLOCKED — Phase 2"
          color="slate"
        />
      </div>

      {/* ── Version Compare Panel ────────────────────────────────────────────── */}
      <div className="glass-card p-5 space-y-4">
        <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">So sánh Forecast Versions / Forecast vs Actual</p>

        <div className="flex flex-wrap gap-3 items-end">
          {/* Snapshot A */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Version A (Base / Plan)</label>
            <select
              value={snapA}
              onChange={e => setSnapA(e.target.value)}
              className="rounded border border-slate-200 px-3 py-2 text-xs min-w-[220px] bg-white"
            >
              <option value="">-- Chọn snapshot --</option>
              {versions.map(v => (
                <option key={v.snapshotId} value={v.snapshotId}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Snapshot B */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-500">Version B (Compare) — chỉ dùng cho FV</label>
            <select
              value={snapB}
              onChange={e => setSnapB(e.target.value)}
              className="rounded border border-slate-200 px-3 py-2 text-xs min-w-[220px] bg-white"
            >
              <option value="">-- Chọn snapshot --</option>
              {versions.map(v => (
                <option key={v.snapshotId} value={v.snapshotId}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={() => handleCompute('FORECAST_VERSION')}
              disabled={computing}
              className="rounded-md bg-violet-600 text-white px-4 py-2 text-xs font-medium hover:bg-violet-700 disabled:opacity-40"
            >
              {computing ? '⏳ Computing…' : '⚡ FV Compare (A vs B)'}
            </button>
            <button
              onClick={() => handleCompute('FORECAST_VS_ACTUAL')}
              disabled={computing}
              className="rounded-md bg-sky-600 text-white px-4 py-2 text-xs font-medium hover:bg-sky-700 disabled:opacity-40"
            >
              {computing ? '⏳ Computing…' : '📊 Forecast vs Actual'}
            </button>
          </div>
        </div>

        {versions.length < 2 && (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded border border-amber-200">
            ⚠️ Cần ≥ 2 FROZEN snapshots cho Forecast Version Compare. Hiện có {versions.length} snapshot.
          </p>
        )}
      </div>

      {/* ── Upload & Compare Panel ──────────────────────────────────────────── */}
      <UploadPanel onComputed={() => { loadSummary(); loadRows(1); }} />

      {/* ── Filter + Table ───────────────────────────────────────────────────── */}
      <div className="glass-card p-5 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={filterType}
            onChange={e => { setFilterType(e.target.value); loadRows(1); }}
            className="rounded border border-slate-200 px-2 py-1 text-xs bg-white"
          >
            <option value="">All types</option>
            <option value="FORECAST_VERSION">Forecast Version</option>
            <option value="FORECAST_VS_ACTUAL">Forecast vs Actual</option>
            <option value="UPLOAD_COMPARE">Upload Compare</option>
          </select>
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); loadRows(1); }}
            className="rounded border border-slate-200 px-2 py-1 text-xs bg-white"
          >
            <option value="">All status</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="WARNING">WARNING</option>
            <option value="ON_TARGET">ON_TARGET</option>
            <option value="N_A">N_A</option>
          </select>
          <input
            placeholder="Item code..."
            value={filterItem}
            onChange={e => setFilterItem(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadRows(1)}
            className="rounded border border-slate-200 px-2 py-1 text-xs w-44"
          />
          <input
            placeholder="Location..."
            value={filterLoc}
            onChange={e => setFilterLoc(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && loadRows(1)}
            className="rounded border border-slate-200 px-2 py-1 text-xs w-28"
          />
          <button
            onClick={() => loadRows(1)}
            className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
          >
            Filter
          </button>
          <div className="flex-1" />
          <button
            onClick={handleExport}
            className="rounded border border-violet-200 text-violet-700 bg-violet-50 px-3 py-1 text-xs hover:bg-violet-100"
          >
            ⬇ Export CSV
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto relative">
          {loading && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
              <p className="text-xs text-slate-400">Loading…</p>
            </div>
          )}
          {rows.length === 0 && !loading ? (
            <p className="text-center text-xs text-slate-400 py-10">
              Chưa có data — chọn snapshots và click ⚡ để compute lần đầu.
            </p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2 text-right">Plan</th>
                  <th className="px-3 py-2 text-right">Actual</th>
                  <th className="px-3 py-2 text-right">Variance</th>
                  <th className="px-3 py-2 text-right">Var%</th>
                  <th className="px-3 py-2 text-right">Fill Rate</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <span className={`text-[10px] font-mono ${r.comparisonType === 'FORECAST_VERSION' ? 'text-violet-600' : r.comparisonType === 'UPLOAD_COMPARE' ? 'text-emerald-600' : 'text-sky-600'}`}>
                        {r.comparisonType === 'FORECAST_VERSION' ? 'FV' : r.comparisonType === 'UPLOAD_COMPARE' ? 'UC' : 'FvA'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-600">{r.periodStart}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">{r.itemCode}</td>
                    <td className="px-3 py-2">{r.locationCode}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtQty(r.planQty)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmtQty(r.actualQty)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${Number(r.varianceQty) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {fmtQty(r.varianceQty)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${Number(r.variancePct) < 0 ? 'text-red-600' : Number(r.variancePct) > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {fmtPct(r.variancePct)}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtRate(r.fillRateProxy)}</td>
                    <td className="px-3 py-2">
                      <Pill label={r.status} cls={STATUS_CLS[r.status] ?? STATUS_CLS.N_A} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {meta && meta.totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-slate-400">
              {meta.total} rows · Page {meta.page}/{meta.totalPages}
            </p>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => loadRows(page - 1)}
                className="rounded border px-2 py-1 text-xs disabled:opacity-40 hover:bg-slate-50"
              >
                ←
              </button>
              <button
                disabled={page >= meta.totalPages}
                onClick={() => loadRows(page + 1)}
                className="rounded border px-2 py-1 text-xs disabled:opacity-40 hover:bg-slate-50"
              >
                →
              </button>
            </div>
          </div>
        )}

        {/* MAPE note */}
        {summary?.forecast_vs_actual?.mape_note && (
          <p className="text-[10px] text-slate-400 border-t border-slate-100 pt-2">
            📌 {summary.forecast_vs_actual.mape_note}
          </p>
        )}
      </div>
    </div>
  );
}
