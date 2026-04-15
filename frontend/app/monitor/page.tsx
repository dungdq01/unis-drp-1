'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  fetchMonitorStats, computeKpi, fetchHstk, fetchExecutionMetrics,
  fetchAlerts, acknowledgeAlert,
  type HstkRow, type HstkSummary, type MonitorAlert,
} from '@/lib/api/monitor';

// ─── helpers ─────────────────────────────────────────────────────────────────

const n  = (v: number | string | null | undefined, dec = 0) =>
  v == null ? '—' : Number(v).toLocaleString('vi-VN', { minimumFractionDigits: dec, maximumFractionDigits: dec });

const fmtHstk = (v: number) => v >= 999 ? '∞' : v.toFixed(2);

const HSTK_CLS: Record<string, string> = {
  STOCKOUT: 'bg-red-50 text-red-700 border-red-200',
  OK:       'bg-green-50 text-green-700 border-green-200',
  OVERSTOCK:'bg-amber-50 text-amber-700 border-amber-200',
};

const SEV_CLS: Record<string, string> = {
  CRITICAL: 'bg-red-50 text-red-700 border-red-200',
  WARNING:  'bg-amber-50 text-amber-700 border-amber-200',
  INFO:     'bg-blue-50 text-blue-700 border-blue-200',
};

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

// ─── HSTK Table ──────────────────────────────────────────────────────────────

function HstkTable() {
  const [summary, setSummary]   = useState<HstkSummary | null>(null);
  const [rows, setRows]         = useState<HstkRow[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [filter, setFilter]     = useState<'ALL' | 'STOCKOUT' | 'OK' | 'OVERSTOCK'>('ALL');
  const [locFilter, setLocFilter] = useState('');
  const [loading, setLoading]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, pageSize: 50 };
      if (filter !== 'ALL')  params.classification = filter;
      if (locFilter.trim()) params.locationCode    = locFilter.trim();
      const r = await fetchHstk(params);
      setSummary(r.summary);
      setRows(r.data);
      setTotal(r.meta.total);
    } finally { setLoading(false); }
  }, [page, filter, locFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="glass-card overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">HSTK — Hệ Số Tồn Kho</span>
        {summary && (
          <div className="flex gap-2 ml-2">
            <Pill label={`STOCKOUT ${summary.stockout}`} cls="bg-red-50 text-red-700 border-red-200" />
            <Pill label={`OK ${summary.ok}`}             cls="bg-green-50 text-green-700 border-green-200" />
            <Pill label={`OVERSTOCK ${summary.overstock}`} cls="bg-amber-50 text-amber-700 border-amber-200" />
            <span className="text-xs text-slate-500 ml-1">avg {summary ? fmtHstk(summary.avg_hstk) : '—'} wks</span>
          </div>
        )}
        <div className="flex-1" />
        {/* Filters */}
        <input
          className="rounded border border-slate-200 px-2 py-1 text-xs w-28"
          placeholder="Location…"
          value={locFilter}
          onChange={e => { setLocFilter(e.target.value); setPage(1); }}
        />
        <select
          className="rounded border border-slate-200 px-2 py-1 text-xs"
          value={filter}
          onChange={e => { setFilter(e.target.value as any); setPage(1); }}
        >
          <option value="ALL">All</option>
          <option value="STOCKOUT">STOCKOUT</option>
          <option value="OK">OK</option>
          <option value="OVERSTOCK">OVERSTOCK</option>
        </select>
        <span className="text-xs text-slate-400">{total.toLocaleString()} rows</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
            <p className="text-xs text-slate-400">Loading…</p>
          </div>
        )}
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              {['Item Code', 'Item Name', 'Location', 'On Hand', 'Weekly Demand', 'HSTK (wks)', 'Class'].map(h => (
                <th key={h} className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No data</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.itemCode}-${r.locationCode}-${i}`} className="border-b border-[rgba(148,173,215,0.08)]">
                <td className="px-3 py-2 font-mono text-[10px] text-slate-700">{r.itemCode}</td>
                <td className="px-3 py-2 text-slate-600 max-w-[160px] truncate" title={r.itemName ?? ''}>{r.itemName ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-600">{r.locationCode}</td>
                <td className="px-3 py-2 text-right font-mono">{n(r.onHand)}</td>
                <td className="px-3 py-2 text-right font-mono">{n(r.weeklyDemand, 1)}</td>
                <td className={`px-3 py-2 text-right font-mono font-bold ${r.classification === 'STOCKOUT' ? 'text-red-600' : r.classification === 'OVERSTOCK' ? 'text-amber-600' : 'text-green-700'}`}>
                  {fmtHstk(r.hstkWeeks)}
                </td>
                <td className="px-3 py-2">
                  <Pill label={r.classification} cls={HSTK_CLS[r.classification]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-5 py-2 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between text-xs">
          <span className="text-slate-500">Page {page} / {totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">◀</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">▶</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Alert Center ─────────────────────────────────────────────────────────────

function AlertCenter({ onAck }: { onAck: () => void }) {
  const [alerts, setAlerts]   = useState<MonitorAlert[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [sevFilter, setSev]   = useState('');
  const [showAcked, setShowAcked] = useState(false);
  const [acking, setAcking]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | boolean | number> = { page, pageSize: 20 };
      if (sevFilter)  params.severity     = sevFilter;
      if (!showAcked) params.acknowledged = false;
      const r = await fetchAlerts(params);
      setAlerts(r.data);
      setTotal(r.meta.total);
    } finally { setLoading(false); }
  }, [page, sevFilter, showAcked]);

  useEffect(() => { load(); }, [load]);

  const handleAck = async (id: string) => {
    setAcking(id);
    try {
      await acknowledgeAlert(id, 'planner');
      await load();
      onAck();
    } finally { setAcking(null); }
  };

  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-3 flex-wrap">
        <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Alert Center</span>
        {total > 0 && !showAcked && (
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold">{total > 99 ? '99+' : total}</span>
        )}
        <div className="flex-1" />
        <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" checked={showAcked} onChange={e => { setShowAcked(e.target.checked); setPage(1); }} />
          Show acknowledged
        </label>
        <select
          className="rounded border border-slate-200 px-2 py-1 text-xs"
          value={sevFilter}
          onChange={e => { setSev(e.target.value); setPage(1); }}
        >
          <option value="">All severity</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="WARNING">WARNING</option>
          <option value="INFO">INFO</option>
        </select>
      </div>

      <div className="divide-y divide-[rgba(148,173,215,0.08)] max-h-[360px] overflow-y-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
            <p className="text-xs text-slate-400">Loading…</p>
          </div>
        )}
        {alerts.length === 0 && !loading && (
          <p className="px-5 py-8 text-center text-xs text-slate-400">No alerts</p>
        )}
        {alerts.map(a => (
          <div key={a.id} className={`px-5 py-3 flex items-start gap-3 ${a.isAcknowledged ? 'opacity-50' : ''}`}>
            <Pill label={a.severity} cls={SEV_CLS[a.severity]} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-700 leading-snug">{a.title}</p>
              {a.body && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{a.body}</p>}
              <p className="text-[10px] text-slate-400 mt-0.5">
                {a.alertType} · {a.createdAt.slice(0, 16).replace('T', ' ')}
                {a.isAcknowledged && a.acknowledgedBy && ` · acked by ${a.acknowledgedBy}`}
              </p>
            </div>
            {!a.isAcknowledged && (
              <button
                onClick={() => handleAck(a.id)}
                disabled={acking === a.id}
                className="text-[10px] text-violet-600 border border-violet-200 rounded px-2 py-0.5 hover:bg-violet-50 disabled:opacity-40 whitespace-nowrap"
              >
                {acking === a.id ? '…' : 'Acknowledge'}
              </button>
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="px-5 py-2 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between text-xs">
          <span className="text-slate-500">Page {page} / {totalPages} · {total} alerts</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">◀</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">▶</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MonitorPage() {
  const [stats, setStats]     = useState<any>(null);
  const [exec, setExec]       = useState<any>(null);
  const [computing, setComputing] = useState(false);
  const [toast, setToast]     = useState('');
  const [alertsKey, setAlertsKey] = useState(0);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  };

  const loadStats = useCallback(async () => {
    const [s, e] = await Promise.all([
      fetchMonitorStats().catch(() => null),
      fetchExecutionMetrics().catch(() => null),
    ]);
    if (s) setStats(s);
    if (e) setExec(e);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleCompute = async () => {
    setComputing(true);
    try {
      const r = await computeKpi('planner');
      showToast(`✅ Computed ${r.computed} KPI snapshots — ${r.alerts_generated} new alerts generated`);
      await loadStats();
      setAlertsKey(k => k + 1);
    } catch (e: any) {
      showToast(`❌ ${e.message}`);
    } finally { setComputing(false); }
  };

  const totalUnacked = Number(stats?.alerts?.total_unacked ?? 0);

  return (
    <div className="flex flex-col h-full min-h-0 p-5 gap-4 overflow-auto">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 glass-card px-4 py-3 text-sm text-slate-700 shadow-lg max-w-sm">
          {toast}
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 border border-violet-100">
            <span className="font-mono text-[13px] font-bold text-violet-700">08</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Monitor & Learn</h1>
            <p className="text-xs text-slate-500">KPI Dashboard · Alert Center · HSTK · Execution Metrics</p>
          </div>
        </div>
        <button
          onClick={handleCompute}
          disabled={computing}
          className="rounded-md bg-violet-600 text-white px-4 py-2 text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center gap-2"
        >
          {computing ? '⏳ Computing…' : '⚡ Compute KPI'}
        </button>
      </div>

      {/* ── KPI Summary Row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="kpi-card">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Critical Alerts</p>
          <p className={`text-2xl font-bold font-mono ${Number(stats?.alerts?.critical_unacked) > 0 ? 'text-red-600' : 'text-slate-700'}`}>
            {stats?.alerts?.critical_unacked ?? '—'}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">unacknowledged</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Warning Alerts</p>
          <p className={`text-2xl font-bold font-mono ${Number(stats?.alerts?.warning_unacked) > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
            {stats?.alerts?.warning_unacked ?? '—'}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">unacknowledged</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Avg HSTK</p>
          <p className={`text-2xl font-bold font-mono ${stats?.hstk?.hstk_stockout_count > 0 ? 'text-red-600' : 'text-green-700'}`}>
            {stats?.hstk?.hstk_avg != null ? fmtHstk(Number(stats.hstk.hstk_avg)) : '—'}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">weeks · {stats?.hstk?.hstk_stockout_count ?? 0} stockout</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">Overdue Batches</p>
          <p className={`text-2xl font-bold font-mono ${Number(stats?.batches?.overdue_batches) > 0 ? 'text-orange-600' : 'text-slate-700'}`}>
            {stats?.batches?.overdue_batches ?? '—'}
          </p>
          <p className="text-[10px] text-slate-400 mt-1">&gt; 10 ngày SUBMITTED</p>
        </div>
      </div>

      {/* ── Execution Panel ─────────────────────────────────────────────────── */}
      {exec && (
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">Execution Metrics (M7)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              { label: 'Overdue',   val: exec.batch?.overdue_count ?? '—',  cls: Number(exec.batch?.overdue_count) > 0 ? 'text-orange-600' : '' },
              { label: 'Avg SLA',   val: exec.batch?.avg_approval_sla_hours != null ? `${Number(exec.batch.avg_approval_sla_hours).toFixed(1)}h` : '—', cls: Number(exec.batch?.avg_approval_sla_hours) > 48 ? 'text-amber-600' : '' },
              { label: 'Cancel Rate', val: exec.lines?.cancel_rate_pct != null ? `${Number(exec.lines.cancel_rate_pct).toFixed(1)}%` : '—', cls: Number(exec.lines?.cancel_rate_pct) > 25 ? 'text-amber-600' : '' },
              { label: 'Total Batches', val: exec.batch?.draft_count != null ? String(Number(exec.batch.draft_count) + Number(exec.batch.submitted_count) + Number(exec.batch.approved_count) + Number(exec.batch.exported_count)) : '—', cls: '' },
              { label: 'Total Lines', val: n(exec.lines?.total_lines), cls: '' },
            ].map(k => (
              <div key={k.label} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">{k.label}</p>
                <p className={`text-base font-bold font-mono mt-0.5 ${k.cls || 'text-slate-700'}`}>{k.val}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── HSTK + Alerts side by side ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <HstkTable />
        <AlertCenter key={alertsKey} onAck={loadStats} />
      </div>
    </div>
  );
}
