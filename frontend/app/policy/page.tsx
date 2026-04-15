'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  fetchPolicyRuns, createPolicyRun, activatePolicyRun,
  fetchSsSummary, fetchSsTargets, overrideSsTarget,
  fetchAbcClassifications,
  type PolicyRun, type SsTarget, type AbcClassification, type SsSummary,
} from '@/lib/api/policy';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  ACTIVE:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  DRAFT:    'bg-amber-50   text-amber-700   border-amber-200',
  ARCHIVED: 'bg-slate-50   text-slate-500   border-slate-200',
};

function Pill({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function KpiCard({ label, value, sub, color }: {
  label: string; value: string; sub: string; color: 'green' | 'amber' | 'red' | 'slate';
}) {
  const colors = { green: 'text-emerald-700', amber: 'text-amber-600', red: 'text-red-600', slate: 'text-slate-400' };
  return (
    <div className="kpi-card">
      <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${colors[color]}`}>{value}</p>
      <p className="text-[10px] text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'runs' | 'abc' | 'ss';

export default function PolicyPage() {
  const [tab, setTab]     = useState<Tab>('runs');
  const [toast, setToast] = useState<string | null>(null);

  // Policy Runs
  const [runs, setRuns]               = useState<PolicyRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [newRunName, setNewRunName]   = useState('');
  const [newSnapId, setNewSnapId]     = useState('');
  const [creating, setCreating]       = useState(false);

  // Summary
  const [summary, setSummary] = useState<SsSummary | null>(null);

  // SS Targets
  const [ssRows, setSsRows]     = useState<SsTarget[]>([]);
  const [ssLoading, setSsLoading] = useState(false);
  const [ssPage, setSsPage]     = useState(1);
  const [ssMeta, setSsMeta]     = useState<{ total: number; totalPages: number } | null>(null);
  const [ssFilterRun, setSsFilterRun]     = useState('');
  const [ssFilterClass, setSsFilterClass] = useState('');

  // ABC
  const [abcRows, setAbcRows]       = useState<AbcClassification[]>([]);
  const [abcLoading, setAbcLoading] = useState(false);
  const [abcFilterClass, setAbcFilterClass] = useState('');

  // Override modal
  const [overrideRow, setOverrideRow]       = useState<SsTarget | null>(null);
  const [overrideSsVal, setOverrideSsVal]   = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overriding, setOverriding]         = useState(false);

  const show = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  // ── Loaders ──────────────────────────────────────────────────────────────

  const loadRuns = useCallback(async () => {
    setRunsLoading(true);
    try { setRuns(await fetchPolicyRuns()); } catch (e: any) { show(`❌ ${e.message}`); }
    finally { setRunsLoading(false); }
  }, []);

  const loadSummary = useCallback(async () => {
    try { setSummary(await fetchSsSummary()); } catch {}
  }, []);

  const loadSs = useCallback(async (p = 1) => {
    setSsLoading(true);
    try {
      const r = await fetchSsTargets({
        page: p, pageSize: 50,
        policyRunId: ssFilterRun   || undefined,
        abcClass:    ssFilterClass || undefined,
      });
      setSsRows(r.data); setSsMeta(r.meta); setSsPage(p);
    } catch (e: any) { show(`❌ ${e.message}`); }
    finally { setSsLoading(false); }
  }, [ssFilterRun, ssFilterClass]);

  const loadAbc = useCallback(async () => {
    setAbcLoading(true);
    try {
      const r = await fetchAbcClassifications({ page: 1, pageSize: 100, abcClass: abcFilterClass || undefined });
      setAbcRows(r.data);
    } catch (e: any) { show(`❌ ${e.message}`); }
    finally { setAbcLoading(false); }
  }, [abcFilterClass]);

  useEffect(() => { loadRuns(); loadSummary(); }, [loadRuns, loadSummary]);

  useEffect(() => {
    if (tab === 'ss')  loadSs(1);
    if (tab === 'abc') loadAbc();
  }, [tab, loadSs, loadAbc]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    if (!newRunName.trim() || !newSnapId.trim()) { show('⚠️ Nhập đủ Run Name và Snapshot ID'); return; }
    setCreating(true);
    try {
      const r = await createPolicyRun({ runName: newRunName.trim(), demandSnapshotId: newSnapId.trim(), createdBy: 'planner' });
      show(`✅ Tạo run OK — ${r.totalCombinations} combinations`);
      setNewRunName(''); setNewSnapId(''); loadRuns();
    } catch (e: any) { show(`❌ ${e.message}`); }
    finally { setCreating(false); }
  };

  const handleActivate = async (id: string) => {
    try { await activatePolicyRun(id, 'planner'); show('✅ Run ACTIVE'); loadRuns(); }
    catch (e: any) { show(`❌ ${e.message}`); }
  };

  const handleOverride = async () => {
    if (!overrideRow) return;
    const val = parseFloat(overrideSsVal);
    if (isNaN(val) || val < 0) { show('⚠️ Override SS phải là số ≥ 0'); return; }
    setOverriding(true);
    try {
      await overrideSsTarget(overrideRow.itemCode, overrideRow.locationCode, {
        overrideSs: val, overrideReason: overrideReason.trim() || 'Manual override', overrideBy: 'planner',
      });
      show('✅ Override saved'); setOverrideRow(null); loadSs(ssPage);
    } catch (e: any) { show(`❌ ${e.message}`); }
    finally { setOverriding(false); }
  };

  const activeRun = runs.find(r => r.status === 'ACTIVE');

  return (
    <div className="flex flex-col h-full min-h-0 p-5 gap-4 overflow-auto">

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 glass-card px-4 py-3 text-sm text-slate-700 shadow-lg max-w-sm">{toast}</div>
      )}

      {/* Override Modal */}
      {overrideRow && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30">
          <div className="glass-card w-96 p-6 space-y-4">
            <p className="font-semibold text-slate-800">Override Safety Stock</p>
            <p className="text-xs text-slate-500">{overrideRow.itemCode} × {overrideRow.locationCode}</p>
            <div className="space-y-2">
              <label className="text-xs text-slate-500 block">Override SS (weeks)</label>
              <input value={overrideSsVal} onChange={e => setOverrideSsVal(e.target.value)}
                type="number" min="0" placeholder={String(overrideRow.ssFinal)}
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm" />
              <label className="text-xs text-slate-500 block">Reason</label>
              <input value={overrideReason} onChange={e => setOverrideReason(e.target.value)}
                placeholder="Lý do override..."
                className="w-full rounded border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setOverrideRow(null)} className="rounded border px-4 py-2 text-xs hover:bg-slate-50">Huỷ</button>
              <button onClick={handleOverride} disabled={overriding}
                className="rounded-md bg-violet-600 text-white px-4 py-2 text-xs font-medium hover:bg-violet-700 disabled:opacity-40">
                {overriding ? 'Saving…' : 'Save Override'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 border border-blue-100">
          <span className="font-mono text-[13px] font-bold text-blue-700">03</span>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-800">Inventory &amp; Policy</h1>
          <p className="text-xs text-slate-500">Safety Stock · ABC Classification · FEFO · HSTK · RTM</p>
        </div>
        {activeRun && (
          <span className="ml-auto text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full font-medium">
            Active: {activeRun.runName}
          </span>
        )}
      </div>

      {/* ── KPI Row ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Combinations" value={summary ? String(summary.totalCombinations) : '—'} sub="Item × Location" color="slate" />
        <KpiCard label="Avg SS — Class A" value={summary ? `${(summary.avgSsByClass?.A ?? 0).toFixed(1)} wks` : '—'} sub="Safety stock weeks" color="green" />
        <KpiCard label="Avg SS — Class B" value={summary ? `${(summary.avgSsByClass?.B ?? 0).toFixed(1)} wks` : '—'} sub="Safety stock weeks" color="amber" />
        <KpiCard label="LCNB Flagged" value={summary ? String(summary.lcnbFlaggedCount) : '—'} sub="Low-coverage network bias" color={(summary?.lcnbFlaggedCount ?? 0) > 0 ? 'amber' : 'green'} />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['runs', 'abc', 'ss'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-500 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'runs' ? 'Policy Runs' : t === 'abc' ? 'ABC Classification' : 'Safety Stock Targets'}
          </button>
        ))}
      </div>

      {/* ══ TAB: RUNS ════════════════════════════════════════════════════════ */}
      {tab === 'runs' && (
        <div className="glass-card p-5 space-y-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Run Name</label>
              <input value={newRunName} onChange={e => setNewRunName(e.target.value)}
                placeholder="VD: Policy Run Apr 2026"
                className="rounded border border-slate-200 px-3 py-1.5 text-xs w-52" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Demand Snapshot ID</label>
              <input value={newSnapId} onChange={e => setNewSnapId(e.target.value)}
                placeholder="UUID..."
                className="rounded border border-slate-200 px-3 py-1.5 text-xs w-72 font-mono" />
            </div>
            <button onClick={handleCreate} disabled={creating}
              className="rounded-md bg-blue-600 text-white px-4 py-2 text-xs font-medium hover:bg-blue-700 disabled:opacity-40 self-end">
              {creating ? '⏳ Creating…' : '+ New Run'}
            </button>
            <button onClick={loadRuns} className="rounded border border-slate-200 px-3 py-2 text-xs hover:bg-slate-50 self-end">↻</button>
          </div>

          <div className="overflow-x-auto">
            {runsLoading ? (
              <p className="text-xs text-slate-400 py-6 text-center">Loading…</p>
            ) : runs.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Chưa có Policy Run nào</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="px-3 py-2">Run Name</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Combinations</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Activated By</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {runs.map(r => (
                    <tr
                      key={r.id}
                      className="hover:bg-blue-50/40 cursor-pointer"
                      onClick={() => { setSsFilterRun(r.id); setTab('ss'); }}
                      title="Click để xem Safety Stock targets của run này"
                    >
                      <td className="px-3 py-2 font-medium text-blue-700 hover:underline">{r.runName}</td>
                      <td className="px-3 py-2"><Pill label={r.status} cls={STATUS_CLS[r.status] ?? STATUS_CLS.ARCHIVED} /></td>
                      <td className="px-3 py-2 font-mono">{r.combinationsDone}/{r.totalCombinations}</td>
                      <td className="px-3 py-2 text-slate-500">{r.createdAt?.slice(0, 10)}</td>
                      <td className="px-3 py-2 text-slate-500">{r.activatedBy ?? '—'}</td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        {r.status === 'DRAFT' && (
                          <button onClick={() => handleActivate(r.id)}
                            className="rounded border border-emerald-200 text-emerald-700 bg-emerald-50 px-2 py-1 text-[10px] hover:bg-emerald-100">
                            Activate
                          </button>
                        )}
                        <button
                          onClick={() => { setSsFilterRun(r.id); setTab('ss'); }}
                          className="ml-1 rounded border border-blue-200 text-blue-600 bg-blue-50 px-2 py-1 text-[10px] hover:bg-blue-100"
                        >
                          View SS →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: ABC ════════════════════════════════════════════════════════ */}
      {tab === 'abc' && (
        <div className="glass-card p-5 space-y-3">
          <div className="flex gap-2 items-center">
            <select value={abcFilterClass} onChange={e => setAbcFilterClass(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-xs bg-white">
              <option value="">All classes</option>
              <option value="A">A</option><option value="B">B</option><option value="C">C</option>
            </select>
            <button onClick={loadAbc} className="rounded border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50">Filter</button>
          </div>
          <div className="overflow-x-auto">
            {abcLoading ? (
              <p className="text-xs text-slate-400 py-6 text-center">Loading…</p>
            ) : abcRows.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">Chưa có ABC data</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="px-3 py-2">Item Code</th>
                    <th className="px-3 py-2">ABC Class</th>
                    <th className="px-3 py-2">Internal Class</th>
                    <th className="px-3 py-2">Source</th>
                    <th className="px-3 py-2">Discrepancy</th>
                    <th className="px-3 py-2">Effective Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {abcRows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 font-mono text-[11px]">{r.itemCode}</td>
                      <td className="px-3 py-2 font-bold">
                        <span className={r.abcClass === 'A' ? 'text-emerald-700' : r.abcClass === 'B' ? 'text-amber-600' : 'text-slate-500'}>
                          {r.abcClass}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">{r.internalClass}</td>
                      <td className="px-3 py-2 text-slate-500">{r.source}</td>
                      <td className="px-3 py-2">{r.discrepancyFlag ? <span className="text-red-600 font-medium">⚠️ YES</span> : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-slate-500">{r.effectiveDate?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══ TAB: SS TARGETS ══════════════════════════════════════════════════ */}
      {tab === 'ss' && (
        <div className="glass-card p-5 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <input value={ssFilterRun} onChange={e => setSsFilterRun(e.target.value)}
              placeholder="Policy Run ID..." className="rounded border border-slate-200 px-2 py-1 text-xs w-64 font-mono" />
            <select value={ssFilterClass} onChange={e => setSsFilterClass(e.target.value)}
              className="rounded border border-slate-200 px-2 py-1 text-xs bg-white">
              <option value="">All classes</option>
              <option value="A">A</option><option value="B">B</option><option value="C">C</option>
            </select>
            <button onClick={() => loadSs(1)} className="rounded border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50">Filter</button>
            {ssFilterRun && (
              <>
                <span className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-1 font-mono max-w-[200px] truncate">
                  {runs.find(r => r.id === ssFilterRun)?.runName ?? ssFilterRun.slice(0, 8) + '…'}
                </span>
                <button
                  onClick={() => { setSsFilterRun(''); setSsFilterClass(''); }}
                  className="text-xs text-slate-400 hover:text-slate-700"
                  title="Xoá filter"
                >
                  ✕ Clear
                </button>
              </>
            )}
          </div>

          <div className="overflow-x-auto relative">
            {ssLoading && (
              <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10">
                <p className="text-xs text-slate-400">Loading…</p>
              </div>
            )}
            {ssRows.length === 0 && !ssLoading ? (
              <p className="text-xs text-slate-400 py-6 text-center">Chưa có Safety Stock targets</p>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2">ABC</th>
                    <th className="px-3 py-2 text-right">CSL</th>
                    <th className="px-3 py-2 text-right">SS Final</th>
                    <th className="px-3 py-2 text-right">DOS Target</th>
                    <th className="px-3 py-2">LCNB</th>
                    <th className="px-3 py-2">Override</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {ssRows.map(r => (
                    <tr key={r.id} className="hover:bg-slate-50/50">
                      <td className="px-3 py-2 font-mono text-[11px]">{r.itemCode}</td>
                      <td className="px-3 py-2">{r.locationCode}</td>
                      <td className="px-3 py-2 font-bold">
                        <span className={r.abcClass === 'A' ? 'text-emerald-700' : r.abcClass === 'B' ? 'text-amber-600' : 'text-slate-500'}>
                          {r.abcClass}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{(parseFloat(r.cslTarget) * 100).toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{r.ssFinal}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.dosTarget}</td>
                      <td className="px-3 py-2">
                        {r.lcnbFlag ? <span className="text-amber-600 font-medium">⚠️ {r.lcnbMode}</span> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.overrideSs != null ? <span className="text-violet-700 font-mono">{r.overrideSs}</span> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button onClick={() => { setOverrideRow(r); setOverrideSsVal(''); setOverrideReason(''); }}
                          className="rounded border border-slate-200 px-2 py-1 text-[10px] hover:bg-slate-50">
                          Override
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {ssMeta && ssMeta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-slate-400">{ssMeta.total} rows · Page {ssPage}/{ssMeta.totalPages}</p>
              <div className="flex gap-1">
                <button disabled={ssPage <= 1} onClick={() => loadSs(ssPage - 1)}
                  className="rounded border px-2 py-1 text-xs disabled:opacity-40 hover:bg-slate-50">←</button>
                <button disabled={ssPage >= ssMeta.totalPages} onClick={() => loadSs(ssPage + 1)}
                  className="rounded border px-2 py-1 text-xs disabled:opacity-40 hover:bg-slate-50">→</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
