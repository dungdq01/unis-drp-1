'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  createAllocationRun,
  fetchAllocationRuns,
  fetchAllocationRun,
  fetchAllocationResults,
  fetchAllocationRecommendations,
  decideAllocationRecommendation,
  type AllocationRun,
  type AllocationResult,
  type AllocationRecommendation,
  type PageMeta,
} from '@/lib/api/allocation';
import { listPlanRuns, type PlanRun } from '@/lib/api/drp';

// ─── Status badge ─────────────────────────────────────────────────────────────

function RunStatusBadge({ status }: { status: AllocationRun['status'] }) {
  const map: Record<string, string> = {
    QUEUED:    'bg-slate-100 text-slate-600',
    RUNNING:   'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    PARTIAL:   'bg-amber-100 text-amber-700',
    FAILED:    'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status}
    </span>
  );
}

function ResultStatusBadge({ status }: { status: AllocationResult['status'] }) {
  const map: Record<string, string> = {
    ALLOCATED:   'bg-green-100 text-green-700',
    PARTIAL:     'bg-amber-100 text-amber-700',
    UNALLOCATED: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${map[status] ?? ''}`}>
      {status}
    </span>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function SummaryBar({ run, activeFilter, onFilter }: {
  run: AllocationRun;
  activeFilter: string;
  onFilter: (s: string) => void;
}) {
  const total = run.totalDemandLines || 1;
  const segments = [
    { key: 'ALLOCATED',   label: 'Allocated',   count: run.totalAllocated,   color: 'bg-green-500' },
    { key: 'PARTIAL',     label: 'Partial',      count: run.totalPartial,     color: 'bg-amber-400' },
    { key: 'UNALLOCATED', label: 'Unallocated',  count: run.totalUnallocated, color: 'bg-red-400'   },
  ];

  const fillPct = run.fillRateOverall != null ? `${(run.fillRateOverall * 100).toFixed(1)}%` : null;

  return (
    <div className="space-y-2">
      {/* fill rate by ABC class */}
      {(run.fillRateA != null || run.fillRateB != null || run.fillRateC != null) && (
        <div className="flex gap-3 text-xs text-slate-500">
          {run.fillRateA != null && <span>A: <span className="font-semibold text-slate-700">{(run.fillRateA * 100).toFixed(1)}%</span></span>}
          {run.fillRateB != null && <span>B: <span className="font-semibold text-slate-700">{(run.fillRateB * 100).toFixed(1)}%</span></span>}
          {run.fillRateC != null && <span>C: <span className="font-semibold text-slate-700">{(run.fillRateC * 100).toFixed(1)}%</span></span>}
        </div>
      )}
      {/* progress bar */}
      <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
        {segments.map(s => (
          <div
            key={s.key}
            className={`${s.color} transition-all`}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ))}
      </div>
      {/* filter pills */}
      <div className="flex gap-2 flex-wrap">
        {segments.map(s => (
          <button
            key={s.key}
            onClick={() => onFilter(activeFilter === s.key ? '' : s.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
              activeFilter === s.key
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full ${s.color}`} />
            {s.label}
            <span className="font-bold">{s.count.toLocaleString()}</span>
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400 self-center">
          Total: {run.totalDemandLines.toLocaleString()} lines
          {fillPct ? ` · ${fillPct} fill` : ''}
          {run.durationMs ? ` · ${run.durationMs}ms` : ''}
        </span>
      </div>
    </div>
  );
}

// ─── Results table ────────────────────────────────────────────────────────────

function ResultsTable({ runId, filterStatus }: { runId: string; filterStatus: string }) {
  const [results, setResults] = useState<AllocationResult[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [itemFilter, setItemFilter] = useState('');
  const [locFilter, setLocFilter] = useState('');

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const { data, meta: m } = await fetchAllocationResults(runId, {
        page: p,
        pageSize: 50,
        status: filterStatus || undefined,
        itemCode: itemFilter || undefined,
        destLocationCode: locFilter || undefined,
      });
      setResults(data);
      setMeta(m);
    } finally {
      setLoading(false);
    }
  }, [runId, filterStatus, itemFilter, locFilter]);

  useEffect(() => {
    setPage(1);
    load(1);
  }, [load]);

  const handlePage = (p: number) => { setPage(p); load(p); };

  return (
    <div className="glass-card space-y-3">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Filter item code..."
          value={itemFilter}
          onChange={e => setItemFilter(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(1)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-52 focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        <input
          type="text"
          placeholder="Filter branch..."
          value={locFilter}
          onChange={e => setLocFilter(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(1)}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        <button
          onClick={() => load(1)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500 text-white hover:bg-orange-600"
        >
          Search
        </button>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center text-slate-400 text-sm">Loading...</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-slate-500">
                  <th className="text-left py-2 px-2 font-medium">Wk</th>
                  <th className="text-left py-2 px-2 font-medium">Item</th>
                  <th className="text-left py-2 px-2 font-medium">ABC</th>
                  <th className="text-left py-2 px-2 font-medium">Branch</th>
                  <th className="text-left py-2 px-2 font-medium">Source</th>
                  <th className="text-right py-2 px-2 font-medium">Required</th>
                  <th className="text-right py-2 px-2 font-medium">Allocated</th>
                  <th className="text-right py-2 px-2 font-medium">Fill%</th>
                  <th className="text-center py-2 px-2 font-medium">Pri</th>
                  <th className="text-left py-2 px-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {results.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 group">
                    <td className="py-1.5 px-2 text-slate-400">W{r.weekNumber}</td>
                    <td className="py-1.5 px-2 font-mono text-slate-700 max-w-[200px] truncate" title={r.itemCode}>
                      {r.itemCode}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      {r.abcClass ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          r.abcClass === 'A' ? 'bg-red-100 text-red-600' :
                          r.abcClass === 'B' ? 'bg-amber-100 text-amber-600' :
                          'bg-slate-100 text-slate-600'
                        }`}>{r.abcClass}</span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-1.5 px-2 text-slate-600">{r.destLocationCode}</td>
                    <td className="py-1.5 px-2 text-slate-600">
                      {r.sourceLocationCode ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right text-slate-600">{Number(r.qtyRequired).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right font-medium text-slate-700">{Number(r.qtyAllocated).toLocaleString()}</td>
                    <td className="py-1.5 px-2 text-right text-slate-500">
                      {r.fillRate != null ? `${(r.fillRate * 100).toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-1.5 px-2 text-center text-slate-400">
                      {r.sourcePriority ?? '—'}
                    </td>
                    <td className="py-1.5 px-2">
                      <ResultStatusBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-400">{meta.total.toLocaleString()} rows</span>
              <div className="flex gap-1">
                <button
                  disabled={page <= 1}
                  onClick={() => handlePage(page - 1)}
                  className="px-2 py-1 rounded text-xs border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                >
                  &#8249;
                </button>
                <span className="px-3 py-1 text-xs text-slate-600">{page} / {meta.totalPages}</span>
                <button
                  disabled={page >= meta.totalPages}
                  onClick={() => handlePage(page + 1)}
                  className="px-2 py-1 rounded text-xs border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
                >
                  &#8250;
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── LCNB Recommendations panel ──────────────────────────────────────────────

function LcnbPanel({ runId }: { runId: string }) {
  const [recs, setRecs] = useState<AllocationRecommendation[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const { data, meta: m } = await fetchAllocationRecommendations(runId, { page: p, pageSize: 50 });
      setRecs(data);
      setMeta(m);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => { load(1); }, [load]);

  const decide = async (recId: string, decision: 'ACCEPTED' | 'REJECTED') => {
    setDeciding(recId);
    try {
      const updated = await decideAllocationRecommendation(recId, decision, { decidedBy: 'planner' });
      setRecs(prev => prev.map(r => r.id === updated.id ? updated : r));
    } finally {
      setDeciding(null);
    }
  };

  const statusColor = (s: AllocationRecommendation['status']) => ({
    PENDING:  'bg-amber-100 text-amber-700',
    ACCEPTED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
    EXPIRED:  'bg-slate-100 text-slate-500',
  }[s] ?? '');

  if (loading) return <div className="py-8 text-center text-slate-400 text-sm">Loading...</div>;

  if (recs.length === 0) return (
    <div className="glass-card py-8 text-center text-slate-400 text-sm">
      No LCNB recommendations for this run.
    </div>
  );

  return (
    <div className="glass-card space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">
          LCNB Lateral Transfer Recommendations
          {meta && <span className="ml-1 text-slate-400">({meta.total} total)</span>}
        </p>
        <span className="text-[10px] text-slate-400">DETECT_ONLY — buyer approval required</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-slate-500">
              <th className="text-left py-2 px-2 font-medium">Item</th>
              <th className="text-left py-2 px-2 font-medium">From</th>
              <th className="text-right py-2 px-2 font-medium">&#8594;</th>
              <th className="text-left py-2 px-2 font-medium">To</th>
              <th className="text-right py-2 px-2 font-medium">Suggested Qty</th>
              <th className="text-left py-2 px-2 font-medium">Note</th>
              <th className="text-left py-2 px-2 font-medium">Status</th>
              <th className="text-left py-2 px-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {recs.map(r => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="py-1.5 px-2 font-mono text-slate-700 max-w-[180px] truncate" title={r.itemCode}>
                  {r.itemCode}
                </td>
                <td className="py-1.5 px-2 text-slate-600 font-medium">{r.fromLocationCode}</td>
                <td className="py-1.5 px-2 text-slate-300 text-center">&#8594;</td>
                <td className="py-1.5 px-2 text-slate-600 font-medium">{r.toLocationCode}</td>
                <td className="py-1.5 px-2 text-right font-semibold text-slate-700">
                  {Number(r.suggestedQty).toLocaleString()}
                </td>
                <td className="py-1.5 px-2 text-slate-400 max-w-[160px] truncate" title={r.note ?? ''}>
                  {r.note ?? '—'}
                </td>
                <td className="py-1.5 px-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusColor(r.status)}`}>
                    {r.status}
                  </span>
                </td>
                <td className="py-1.5 px-2">
                  {r.status === 'PENDING' ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => decide(r.id, 'ACCEPTED')}
                        disabled={deciding === r.id}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-green-500 text-white hover:bg-green-600 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => decide(r.id, 'REJECTED')}
                        disabled={deciding === r.id}
                        className="px-2 py-0.5 rounded text-[10px] font-medium bg-red-400 text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  ) : (
                    <span className="text-slate-400 text-[10px]">
                      {r.decidedBy ? `by ${r.decidedBy}` : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-slate-400">{meta.total.toLocaleString()} rows</span>
          <div className="flex gap-1">
            <button
              disabled={page <= 1}
              onClick={() => { setPage(p => p - 1); load(page - 1); }}
              className="px-2 py-1 rounded text-xs border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >&#8249;</button>
            <span className="px-3 py-1 text-xs text-slate-600">{page} / {meta.totalPages}</span>
            <button
              disabled={page >= meta.totalPages}
              onClick={() => { setPage(p => p + 1); load(page + 1); }}
              className="px-2 py-1 rounded text-xs border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
            >&#8250;</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AllocationPage() {
  const [runs, setRuns] = useState<AllocationRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<AllocationRun | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [activeTab, setActiveTab] = useState<'results' | 'lcnb'>('results');
  const [planRuns, setPlanRuns] = useState<PlanRun[]>([]);
  const [selectedPlanRunId, setSelectedPlanRunId] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);

  const loadRuns = useCallback(async () => {
    const { data } = await fetchAllocationRuns(1, 20);
    setRuns(data);
    if (selectedRun) {
      const fresh = data.find(r => r.id === selectedRun.id);
      if (fresh) setSelectedRun(fresh);
    } else if (data.length > 0) {
      setSelectedRun(data[0]);
    }
    return data;
  }, [selectedRun]);

  useEffect(() => {
    loadRuns();
    listPlanRuns(1, 50)
      .then(({ data }) => {
        setPlanRuns(data);
        if (data.length > 0) setSelectedPlanRunId(data[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll while a run is QUEUED or RUNNING
  useEffect(() => {
    if (!selectedRun || (selectedRun.status !== 'QUEUED' && selectedRun.status !== 'RUNNING')) {
      setPolling(false);
      return;
    }
    setPolling(true);
    const interval = setInterval(async () => {
      const fresh = await fetchAllocationRun(selectedRun.id);
      setSelectedRun(fresh);
      setRuns(prev => prev.map(r => r.id === fresh.id ? fresh : r));
      if (fresh.status !== 'QUEUED' && fresh.status !== 'RUNNING') {
        clearInterval(interval);
        setPolling(false);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [selectedRun?.id, selectedRun?.status]);

  const handleTrigger = async () => {
    if (!selectedPlanRunId) return;
    setTriggering(true);
    setTriggerError(null);
    try {
      const run = await createAllocationRun(selectedPlanRunId, 'planner');
      setSelectedRun(run);
      setRuns(prev => [run, ...prev]);
    } catch (e) {
      setTriggerError(e instanceof Error ? e.message : 'Trigger failed');
    } finally {
      setTriggering(false);
    }
  };

  const fillPct = selectedRun?.fillRateOverall != null
    ? `${(selectedRun.fillRateOverall * 100).toFixed(1)}%`
    : null;

  const isDone = (s: AllocationRun['status']) => s === 'COMPLETED' || s === 'PARTIAL';

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100">
            <span className="font-mono text-sm font-bold text-violet-600">05</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Allocation Engine</h1>
            <p className="text-sm text-slate-500">L1 RTM · L2 Quality · L3 FEFO (OFF) — UNIS Phase 1</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedPlanRunId}
            onChange={e => setSelectedPlanRunId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            {planRuns.map(r => (
              <option key={r.id} value={r.id}>Plan Run #{r.id} — {r.status}</option>
            ))}
          </select>
          <button
            onClick={handleTrigger}
            disabled={triggering || !selectedPlanRunId}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 shadow-sm disabled:opacity-50 flex items-center gap-2"
          >
            {triggering && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
            )}
            Run Allocation
          </button>
        </div>
      </div>

      {triggerError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">{triggerError}</div>
      )}

      {/* KPI bar */}
      {selectedRun && (
        <div className="glass-card space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600">Run #{selectedRun.id}</span>
              <RunStatusBadge status={selectedRun.status} />
              {polling && (
                <span className="text-[10px] text-blue-500 animate-pulse">polling...</span>
              )}
            </div>
            {fillPct !== null && isDone(selectedRun.status) && (
              <span className="text-sm font-bold text-slate-700">{fillPct} fill rate</span>
            )}
          </div>

          {isDone(selectedRun.status) && (
            <SummaryBar run={selectedRun} activeFilter={filterStatus} onFilter={setFilterStatus} />
          )}

          {(selectedRun.status === 'QUEUED' || selectedRun.status === 'RUNNING') && (
            <div className="flex items-center gap-2 text-sm text-blue-600">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Allocation running...
            </div>
          )}

          {selectedRun.status === 'FAILED' && selectedRun.errorMessage && (
            <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
              {selectedRun.errorMessage}
            </div>
          )}
        </div>
      )}

      {/* Tab switcher + content */}
      {selectedRun && isDone(selectedRun.status) && (
        <div className="space-y-3">
          <div className="flex gap-1 border-b border-slate-200">
            {(['results', 'lcnb'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  activeTab === tab
                    ? 'border-violet-500 text-violet-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'results' ? 'Allocation Results' : 'LCNB Recommendations'}
              </button>
            ))}
          </div>

          {activeTab === 'results' && (
            <ResultsTable runId={selectedRun.id} filterStatus={filterStatus} />
          )}
          {activeTab === 'lcnb' && (
            <LcnbPanel runId={selectedRun.id} />
          )}
        </div>
      )}

      {/* Run history */}
      {runs.length > 1 && (
        <div className="glass-card">
          <p className="text-xs font-medium text-slate-600 mb-2">Run History</p>
          <div className="space-y-1">
            {runs.map(r => (
              <button
                key={r.id}
                onClick={() => { setSelectedRun(r); setFilterStatus(''); }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-left hover:bg-slate-50 transition-colors ${
                  selectedRun?.id === r.id ? 'bg-violet-50 border border-violet-100' : ''
                }`}
              >
                <span className="text-slate-400">#{r.id}</span>
                <span className="text-slate-600">Plan #{r.planRunId}</span>
                <RunStatusBadge status={r.status} />
                {isDone(r.status) && (
                  <span className="text-slate-500 ml-auto">
                    {r.totalAllocated}/{r.totalDemandLines}
                    {r.fillRateOverall != null ? ` · ${(r.fillRateOverall * 100).toFixed(1)}%` : ''}
                    {r.durationMs ? ` · ${r.durationMs}ms` : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
