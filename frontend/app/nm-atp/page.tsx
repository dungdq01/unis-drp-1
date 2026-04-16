'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  runAtpCheck,
  forceRerunAtpCheck,
  listAtpRuns,
  listAtpChecks,
  getCriticalRecipients,
  getHonoringLeaderboard,
  type AtpRun,
  type AtpCheck,
  type HonoringLeaderboardEntry,
} from '@/lib/api/nm-atp';

// ─── Badges ───────────────────────────────────────────────────────────────────

function AtpResultBadge({ result }: { result: AtpCheck['result'] }) {
  const map: Record<string, string> = {
    PASS:    'bg-green-100 text-green-700',
    PARTIAL: 'bg-amber-100 text-amber-700',
    FAIL:    'bg-red-100 text-red-700',
    BLOCKED: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${map[result] ?? ''}`}>
      {result}
    </span>
  );
}

function RunStatusBadge({ status }: { status: AtpRun['status'] }) {
  const map: Record<string, string> = {
    RUNNING:   'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED:    'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${map[status] ?? ''}`}>
      {status}
    </span>
  );
}

// ─── Tab 1: ATP Check Results ─────────────────────────────────────────────────

function AtpChecksTab() {
  const [runs, setRuns] = useState<AtpRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<AtpRun | null>(null);
  const [checks, setChecks] = useState<AtpCheck[]>([]);
  const [filterResult, setFilterResult] = useState('');
  const [allocationRunId, setAllocationRunId] = useState('');
  const [loading, setLoading] = useState(false);
  const [runLoading, setRunLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAtpRuns({ limit: 20 });
      setRuns(res.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const selectRun = async (run: AtpRun) => {
    setSelectedRun(run);
    setChecks([]);
    setFilterResult('');
    try {
      const data = await listAtpChecks(run.id);
      setChecks(data);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const triggerRun = async () => {
    if (!allocationRunId.trim()) return;
    setRunLoading(true);
    setError(null);
    try {
      await runAtpCheck(allocationRunId.trim());
      await loadRuns();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunLoading(false);
    }
  };

  const filtered = filterResult ? checks.filter((c) => c.result === filterResult) : checks;

  return (
    <div className="space-y-4">
      {/* Trigger */}
      <div className="flex gap-2 items-center">
        <input
          className="border rounded px-3 py-1.5 text-sm flex-1 max-w-xs"
          placeholder="Allocation Run ID"
          value={allocationRunId}
          onChange={(e) => setAllocationRunId(e.target.value)}
        />
        <button
          onClick={triggerRun}
          disabled={runLoading || !allocationRunId.trim()}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded disabled:opacity-50"
        >
          {runLoading ? 'Running…' : 'Run ATP Check'}
        </button>
        <button onClick={loadRuns} className="px-3 py-1.5 border text-sm rounded">Refresh</button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-12 gap-4">
        {/* Run list */}
        <div className="col-span-4 border rounded overflow-auto max-h-[420px]">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-2 py-2 text-left">Run ID</th>
                <th className="px-2 py-2 text-left">Status</th>
                <th className="px-2 py-2 text-right">Cells</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={3} className="px-2 py-4 text-center text-slate-400">Loading…</td></tr>
              )}
              {runs.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => selectRun(r)}
                  className={`cursor-pointer border-t hover:bg-slate-50 ${selectedRun?.id === r.id ? 'bg-blue-50' : ''}`}
                >
                  <td className="px-2 py-1.5 font-mono">#{r.id}</td>
                  <td className="px-2 py-1.5"><RunStatusBadge status={r.status} /></td>
                  <td className="px-2 py-1.5 text-right">{r.totalCells}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Check cells */}
        <div className="col-span-8">
          {selectedRun && (
            <>
              <div className="flex gap-2 mb-2 items-center">
                <span className="text-xs text-slate-500">Filter:</span>
                {['', 'PASS', 'PARTIAL', 'FAIL', 'BLOCKED'].map((r) => (
                  <button
                    key={r}
                    onClick={() => setFilterResult(r)}
                    className={`px-2 py-0.5 text-[10px] rounded border ${filterResult === r ? 'bg-slate-700 text-white border-slate-700' : 'border-slate-300'}`}
                  >
                    {r || 'ALL'}
                  </button>
                ))}
                <span className="ml-auto text-xs text-slate-400">
                  PASS {selectedRun.passCount} · PARTIAL {selectedRun.partialCount} · FAIL {selectedRun.failCount} · BLOCKED {selectedRun.blockedCount}
                </span>
              </div>
              <div className="border rounded overflow-auto max-h-[380px]">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="px-2 py-2 text-left">NM</th>
                      <th className="px-2 py-2 text-left">SKU</th>
                      <th className="px-2 py-2 text-left">Period</th>
                      <th className="px-2 py-2 text-right">Requested</th>
                      <th className="px-2 py-2 text-right">ATP Qty</th>
                      <th className="px-2 py-2 text-center">Result</th>
                      <th className="px-2 py-2 text-center">Fallback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((c) => (
                      <tr key={c.id} className="border-t hover:bg-slate-50">
                        <td className="px-2 py-1.5 font-mono">{c.nmId}</td>
                        <td className="px-2 py-1.5 font-mono">{c.skuId}</td>
                        <td className="px-2 py-1.5">{c.periodStart}</td>
                        <td className="px-2 py-1.5 text-right">{c.requestedQty.toLocaleString()}</td>
                        <td className="px-2 py-1.5 text-right">{c.atpQty?.toLocaleString() ?? '—'}</td>
                        <td className="px-2 py-1.5 text-center"><AtpResultBadge result={c.result} /></td>
                        <td className="px-2 py-1.5 text-center">{c.isAtpNullFallback ? '⚠' : ''}</td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-400">No cells</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!selectedRun && (
            <p className="text-slate-400 text-sm text-center mt-12">Select a run to view cells</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab 2: Critical Recipients ───────────────────────────────────────────────

function CriticalTab() {
  const [runId, setRunId] = useState('');
  const [cells, setCells] = useState<AtpCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!runId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getCriticalRecipients(runId.trim());
      setCells(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <input
          className="border rounded px-3 py-1.5 text-sm flex-1 max-w-xs"
          placeholder="ATP Run ID"
          value={runId}
          onChange={(e) => setRunId(e.target.value)}
        />
        <button
          onClick={load}
          disabled={loading || !runId.trim()}
          className="px-3 py-1.5 bg-red-600 text-white text-sm rounded disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load Critical'}
        </button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="border rounded overflow-auto max-h-[480px]">
        <table className="w-full text-xs">
          <thead className="bg-red-50 sticky top-0">
            <tr>
              <th className="px-2 py-2 text-left">NM</th>
              <th className="px-2 py-2 text-left">SKU</th>
              <th className="px-2 py-2 text-left">Period</th>
              <th className="px-2 py-2 text-right">Requested</th>
              <th className="px-2 py-2 text-right">ATP Qty</th>
              <th className="px-2 py-2 text-left">Critical CNs</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => {
              const criticalCns = (c.urgencyRanking ?? []).filter((e) => e.isCritical);
              return (
                <tr key={c.id} className="border-t hover:bg-red-50">
                  <td className="px-2 py-1.5 font-mono">{c.nmId}</td>
                  <td className="px-2 py-1.5 font-mono">{c.skuId}</td>
                  <td className="px-2 py-1.5">{c.periodStart}</td>
                  <td className="px-2 py-1.5 text-right">{c.requestedQty.toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right">{c.atpQty?.toLocaleString() ?? '—'}</td>
                  <td className="px-2 py-1.5">
                    {criticalCns.map((e) => (
                      <span key={e.cnId} className="inline-flex items-center gap-1 mr-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px]">
                        {e.cnCode} <span className="text-red-400">HSTK={e.hstkDays}d</span>
                      </span>
                    ))}
                    {criticalCns.length === 0 && <span className="text-slate-400">—</span>}
                  </td>
                </tr>
              );
            })}
            {cells.length === 0 && (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400">No critical cells</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Tab 3: NM Honoring Leaderboard ──────────────────────────────────────────

function HonoringTab() {
  const [entries, setEntries] = useState<HonoringLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getHonoringLeaderboard();
      setEntries(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const fmt = (v: number | null) =>
    v === null ? '—' : `${(v * 100).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">Rolling 3-month honoring rate. Badge ⚠ = below 80% threshold.</p>
        <button onClick={load} className="px-3 py-1.5 border text-sm rounded">Refresh</button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="border rounded overflow-auto max-h-[480px]">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">NM Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-center">Badge</th>
              <th className="px-3 py-2 text-right">Rolling 3M</th>
              <th className="px-3 py-2 text-right">Last Month</th>
              <th className="px-3 py-2 text-left">Period</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">Loading…</td></tr>
            )}
            {entries.map((e) => (
              <tr key={e.supplierCode} className="border-t hover:bg-slate-50">
                <td className="px-3 py-1.5 font-mono font-medium">{e.supplierCode}</td>
                <td className="px-3 py-1.5">{e.supplierName}</td>
                <td className="px-3 py-1.5 text-center">
                  {e.nmUnreliableBadge
                    ? <span className="text-amber-600 font-bold" title="Unreliable — rolling 3M < 80%">⚠ Unreliable</span>
                    : <span className="text-green-600">✓</span>
                  }
                </td>
                <td className={`px-3 py-1.5 text-right font-medium ${
                  e.rolling3mRate !== null && e.rolling3mRate < 0.8 ? 'text-red-600' : 'text-green-700'
                }`}>
                  {fmt(e.rolling3mRate)}
                </td>
                <td className="px-3 py-1.5 text-right">{fmt(e.lastMonthRate)}</td>
                <td className="px-3 py-1.5 text-slate-500">{e.periodMonth}</td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'checks',    label: 'ATP Check Results' },
  { id: 'critical',  label: 'Critical Recipients' },
  { id: 'honoring',  label: 'NM Honoring Leaderboard' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function NmAtpPage() {
  const [tab, setTab] = useState<TabId>('checks');

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold">NM ATP Check</h1>
        <p className="text-sm text-slate-500 mt-0.5">M26 · Available-to-Promise per (NM, SKU, week) · Urgency ranking for PARTIAL cells</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div>
        {tab === 'checks'   && <AtpChecksTab />}
        {tab === 'critical' && <CriticalTab />}
        {tab === 'honoring' && <HonoringTab />}
      </div>
    </div>
  );
}
