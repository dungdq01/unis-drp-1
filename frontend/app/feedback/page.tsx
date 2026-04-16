'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  getDashboard, listSnapshots, triggerRun, forceRerun,
  type DashboardResponse, type WeeklyKpiSnapshot,
} from '@/lib/api/feedback';

// ── KPI Card ──────────────────────────────────────────────────────────────

function KpiCard({
  label, value, prev, note, pending,
}: {
  label: string;
  value: number | null;
  prev?: number | null;
  note?: string;
  pending?: boolean;
}) {
  const formatted = value != null ? `${(value * 100).toFixed(1)}%` : '—';
  const trend = value != null && prev != null
    ? value > prev ? '↑' : value < prev ? '↓' : '→'
    : null;
  const trendColor = trend === '↑' ? 'text-green-600' : trend === '↓' ? 'text-red-600' : 'text-gray-400';

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className={`text-2xl font-bold ${pending ? 'text-gray-300' : 'text-gray-900'}`}>
          {pending ? 'N/A' : formatted}
        </span>
        {trend && <span className={`text-sm font-medium ${trendColor}`}>{trend}</span>}
      </div>
      {pending && (
        <p className="text-xs text-amber-500 mt-1">Pending actual_sales — Phase 2 unblock</p>
      )}
      {note && !pending && <p className="text-xs text-gray-400 mt-1">{note}</p>}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function FeedbackDashboardPage() {
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [snapshots, setSnapshots] = useState<WeeklyKpiSnapshot[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [tab, setTab]             = useState<'overview' | 'ss' | 'lt' | 'overrides'>('overview');
  const [runLoading, setRunLoading] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [showForceDialog, setShowForceDialog] = useState(false);
  const [drillDown, setDrillDown] = useState<unknown[] | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [dash, snaps] = await Promise.all([getDashboard(), listSnapshots(8)]);
      setDashboard(dash);
      setSnapshots(snaps);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRun = async () => {
    setRunLoading(true);
    try {
      await triggerRun();
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setRunLoading(false);
    }
  };

  const handleForceRerun = async () => {
    if (forceReason.length < 20) {
      alert('Reason phải ≥ 20 ký tự');
      return;
    }
    setRunLoading(true);
    try {
      await forceRerun(forceReason);
      setShowForceDialog(false);
      setForceReason('');
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setRunLoading(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-400">Loading M28 Dashboard…</div>;
  if (error)   return <div className="p-8 text-red-600">Error: {error}</div>;

  const cur  = dashboard?.current;
  const prev = dashboard?.previous;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">M28 — Feedback & Closed Loop</h1>
          {cur && (
            <p className="text-sm text-gray-500">
              Tuần {cur.week_start_date} · Status:{' '}
              <span className={
                cur.status === 'COMPLETED' ? 'text-green-600' :
                cur.status === 'COMPLETED_PARTIAL' ? 'text-amber-600' :
                cur.status === 'FAILED' ? 'text-red-600' : 'text-blue-600'
              }>
                {cur.status}
              </span>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRun}
            disabled={runLoading}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {runLoading ? 'Running…' : 'Run Now'}
          </button>
          <button
            onClick={() => setShowForceDialog(true)}
            className="px-4 py-2 border border-gray-300 text-sm rounded hover:bg-gray-50"
          >
            Force Rerun
          </button>
        </div>
      </div>

      {/* Alerts */}
      {dashboard?.alerts && dashboard.alerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-1">
          {dashboard.alerts.map((a, i) => (
            <p key={i} className="text-sm text-red-700">⚠ {a}</p>
          ))}
        </div>
      )}

      {/* COMPLETED_PARTIAL errors */}
      {cur?.step_errors && cur.step_errors.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-medium text-amber-800 mb-1">Step Errors (COMPLETED_PARTIAL):</p>
          {cur.step_errors.map((e, i) => (
            <p key={i} className="text-xs text-amber-700">{e.step}: {e.error}</p>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KpiCard
          label="FC MAPE"
          value={cur?.fc_mape_pct ?? null}
          prev={prev?.fc_mape_pct ?? null}
          pending={true}
        />
        <KpiCard
          label="Fill Rate"
          value={cur?.fill_rate_pct ?? null}
          prev={prev?.fill_rate_pct ?? null}
          note={cur?.fill_rate_pct != null && cur.fill_rate_pct < 0.85 ? '⚠ < 85%' : undefined}
        />
        <KpiCard
          label="LCNB Util"
          value={cur?.lcnb_util_pct ?? null}
          prev={prev?.lcnb_util_pct ?? null}
        />
        <KpiCard
          label="Transport Fill"
          value={cur?.transport_fill_avg ?? null}
          prev={prev?.transport_fill_avg ?? null}
        />
        <KpiCard
          label="System Accuracy"
          value={cur?.system_accuracy_pct ?? null}
          prev={prev?.system_accuracy_pct ?? null}
        />
        <KpiCard
          label="NM Honoring Avg"
          value={cur?.nm_honoring_avg_pct ?? null}
          prev={prev?.nm_honoring_avg_pct ?? null}
          note={cur?.nm_honoring_avg_pct != null && cur.nm_honoring_avg_pct < 0.80 ? '⚠ < 80%' : undefined}
        />
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-6 text-sm">
          {(['overview', 'ss', 'lt', 'overrides'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-2 font-medium ${tab === t ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t === 'overview' ? 'Run History' : t === 'ss' ? 'SS Adjustments' : t === 'lt' ? 'LT Drift' : 'Overrides'}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="pb-2 pr-4">Week</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 pr-4">Fill Rate</th>
                <th className="pb-2 pr-4">Accuracy</th>
                <th className="pb-2 pr-4">SS Adj</th>
                <th className="pb-2 pr-4">LT Updates</th>
                <th className="pb-2">Completed</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map(s => (
                <tr key={s.id} className="border-b hover:bg-gray-50">
                  <td className="py-2 pr-4 font-mono text-xs">{s.week_start_date}</td>
                  <td className="py-2 pr-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      s.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                      s.status === 'COMPLETED_PARTIAL' ? 'bg-amber-100 text-amber-700' :
                      s.status === 'FAILED' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                    }`}>{s.status}</span>
                  </td>
                  <td className="py-2 pr-4">{s.fill_rate_pct != null ? `${(s.fill_rate_pct * 100).toFixed(1)}%` : '—'}</td>
                  <td className="py-2 pr-4">{s.system_accuracy_pct != null ? `${(s.system_accuracy_pct * 100).toFixed(1)}%` : '—'}</td>
                  <td className="py-2 pr-4">{s.ss_adjustments_count}</td>
                  <td className="py-2 pr-4">{s.lt_updates_count}</td>
                  <td className="py-2 text-xs text-gray-400">{s.completed_at ? new Date(s.completed_at).toLocaleString('vi-VN') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'ss' && (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">SS Adjustment Log — 4 tuần gần nhất (từ snapshot hiện tại)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-4">Week</th>
                  <th className="pb-2 pr-4">CN</th>
                  <th className="pb-2 pr-4">SKU</th>
                  <th className="pb-2 pr-4">SS Old</th>
                  <th className="pb-2 pr-4">SS Applied</th>
                  <th className="pb-2 pr-4">Δ%</th>
                  <th className="pb-2">Capped</th>
                </tr>
              </thead>
              <tbody>
                {(dashboard?.ssAdjustmentHistory ?? []).map((r, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="py-1.5 pr-4 font-mono text-xs">{r.week_start_date}</td>
                    <td className="py-1.5 pr-4">{r.cn_id}</td>
                    <td className="py-1.5 pr-4">{r.sku_id}</td>
                    <td className="py-1.5 pr-4">{Number(r.ss_old).toFixed(0)}</td>
                    <td className="py-1.5 pr-4">{Number(r.ss_new_applied).toFixed(0)}</td>
                    <td className={`py-1.5 pr-4 font-medium ${Math.abs(Number(r.delta_pct)) > 20 ? 'text-amber-600' : 'text-gray-700'}`}>
                      {Number(r.delta_pct) >= 0 ? '+' : ''}{Number(r.delta_pct).toFixed(1)}%
                    </td>
                    <td className="py-1.5">
                      {r.is_capped && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs">CAPPED</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(dashboard?.ssAdjustmentHistory ?? []).length === 0 && (
              <p className="text-center text-gray-400 py-8 text-sm">Chưa có SS adjustment data</p>
            )}
          </div>
        </div>
      )}

      {tab === 'lt' && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="pb-2 pr-4">Route/NM</th>
                <th className="pb-2 pr-4">LT Old</th>
                <th className="pb-2 pr-4">LT Actual Avg</th>
                <th className="pb-2 pr-4">Δ%</th>
                <th className="pb-2 pr-4">Action</th>
                <th className="pb-2">Drift Count</th>
              </tr>
            </thead>
            <tbody>
              {(dashboard?.ltDriftTable ?? []).map((r, i) => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className="py-1.5 pr-4 font-mono text-xs">{r.entity_code}</td>
                  <td className="py-1.5 pr-4">{Number(r.lt_old_days).toFixed(1)}d</td>
                  <td className="py-1.5 pr-4">{Number(r.lt_actual_avg_days).toFixed(1)}d</td>
                  <td className={`py-1.5 pr-4 font-medium ${Number(r.drift_pct) > 30 ? 'text-red-600' : 'text-gray-700'}`}>
                    {Number(r.drift_pct) >= 0 ? '+' : ''}{Number(r.drift_pct).toFixed(1)}%
                  </td>
                  <td className="py-1.5 pr-4">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      r.action === 'APPLIED' ? 'bg-green-100 text-green-700' :
                      r.action === 'DRIFT_FORCE_APPLY' ? 'bg-orange-100 text-orange-700' :
                      'bg-red-100 text-red-700'
                    }`}>{r.action}</span>
                  </td>
                  <td className="py-1.5">
                    {r.drift_count_after > 0 && (
                      <span className={`px-1.5 py-0.5 rounded text-xs ${r.drift_count_after >= 3 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.drift_count_after}×
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {(dashboard?.ltDriftTable ?? []).length === 0 && (
                <tr><td colSpan={6} className="text-center text-gray-400 py-8">Chưa có LT drift data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'overrides' && (
        <div className="space-y-4">
          {dashboard?.overrideAnalysis ? (
            <>
              <div className="flex gap-6 text-sm text-gray-600">
                <span>Total edits: <strong>{dashboard.overrideAnalysis.total_edits}</strong></span>
                <span>Total POs: <strong>{dashboard.overrideAnalysis.total_pos}</strong></span>
                <span>System accuracy: <strong>
                  {dashboard.overrideAnalysis.system_accuracy_pct != null
                    ? `${(dashboard.overrideAnalysis.system_accuracy_pct * 100).toFixed(1)}%`
                    : '—'}
                </strong></span>
              </div>
              <div className="space-y-2">
                {(dashboard.overrideAnalysis.top_reasons ?? []).map((r, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-4">{i + 1}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-6 relative">
                      <div
                        className="bg-blue-500 h-6 rounded-full"
                        style={{ width: `${Math.min(r.pct, 100)}%` }}
                      />
                      <span className="absolute inset-0 flex items-center px-3 text-xs font-medium text-gray-800">
                        {r.reason}
                      </span>
                    </div>
                    <span className="text-xs text-gray-600 w-20 text-right">{r.count} ({r.pct.toFixed(1)}%)</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-center text-gray-400 py-8 text-sm">Chưa có override analysis cho tuần này</p>
          )}
        </div>
      )}

      {/* Force Rerun Dialog */}
      {showForceDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
            <h3 className="font-semibold mb-3">Force Rerun Weekly Pipeline</h3>
            <textarea
              value={forceReason}
              onChange={e => setForceReason(e.target.value)}
              placeholder="Lý do force rerun (≥ 20 ký tự)…"
              className="w-full border rounded p-2 text-sm h-20 resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">{forceReason.length}/20 chars minimum</p>
            <div className="flex gap-2 mt-4 justify-end">
              <button
                onClick={() => { setShowForceDialog(false); setForceReason(''); }}
                className="px-3 py-1.5 border rounded text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleForceRerun}
                disabled={forceReason.length < 20 || runLoading}
                className="px-3 py-1.5 bg-red-600 text-white rounded text-sm disabled:opacity-50"
              >
                {runLoading ? 'Running…' : 'Force Rerun'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
