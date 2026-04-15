'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchCompare, type CompareRow } from '@/lib/api/demand';

const fmt = (n: number | null) => n == null ? '—' : n >= 1000 ? `${(n/1000).toFixed(0)}K` : Math.round(n).toLocaleString();
const fmtPct = (n: number | null) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

export function PeriodComparison() {
  const [month1, setMonth1] = useState('t12');
  const [month2, setMonth2] = useState('t1');
  const [data, setData] = useState<CompareRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetchCompare(month1, month2, page, 25)
      .then(r => { setData(r.data); setTotal(r.meta.total); })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [month1, month2, page]);

  useEffect(() => { load(); }, [load]);

  const monthLabel: Record<string, string> = { t10: 'T10', t11: 'T11', t12: 'T12', t1: 'T1' };

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-3 flex-wrap">
        <p className="section-label">Comparison Mode (I-10)</p>
        <select value={month1} onChange={e => { setMonth1(e.target.value); setPage(1); }}
          className="rounded border border-slate-200 px-2 py-1 text-xs">
          <option value="t10">T10</option><option value="t11">T11</option>
          <option value="t12">T12</option><option value="t1">T1</option>
        </select>
        <span className="text-slate-400 text-sm">vs</span>
        <select value={month2} onChange={e => { setMonth2(e.target.value); setPage(1); }}
          className="rounded border border-slate-200 px-2 py-1 text-xs">
          <option value="t11">T11</option><option value="t12">T12</option>
          <option value="t1">T1</option>
        </select>
        <span className="text-xs text-slate-400 ml-auto">{total.toLocaleString()} rows</span>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto relative">
        {loading && <div className="absolute inset-0 bg-white/60 flex items-center justify-center z-10 text-sm text-slate-400">Loading…</div>}
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white/90 backdrop-blur">
            <tr className="border-b border-[rgba(148,173,215,0.12)]">
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase text-slate-400">FSKU</th>
              <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-slate-400">Seg</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-400">FC {monthLabel[month1]}</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-400">Acc {monthLabel[month1]}</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-400">FC {monthLabel[month2]}</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-400">Acc {monthLabel[month2]}</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-400">FC Δ</th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase text-slate-400">Acc Δ</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 && !loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No data</td></tr>
            )}
            {data.map(r => {
              const improving = r.accChange !== null && r.accChange > 0;
              const degrading = r.accChange !== null && r.accChange < 0;
              return (
                <tr key={r.fsku} className={`border-b border-[rgba(148,173,215,0.06)] ${improving ? 'bg-emerald-50/30' : degrading ? 'bg-rose-50/20' : ''}`}>
                  <td className="px-4 py-1.5 font-mono text-slate-700">{r.fsku}</td>
                  <td className="px-3 py-1.5 text-center">
                    <span className={`px-1 rounded text-[10px] font-bold ${r.segment === 'A' ? 'bg-blue-100 text-blue-700' : r.segment === 'B' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                      {r.segment ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-sky-700">{fmt(r.fc1)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.acc1 !== null ? `${r.acc1.toFixed(1)}%` : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-sky-700">{fmt(r.fc2)}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.acc2 !== null ? `${r.acc2.toFixed(1)}%` : '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${r.changePct !== null && r.changePct > 0 ? 'text-emerald-600' : r.changePct !== null && r.changePct < 0 ? 'text-rose-600' : 'text-slate-400'}`}>{fmtPct(r.changePct)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-bold ${improving ? 'text-emerald-600' : degrading ? 'text-rose-600' : 'text-slate-400'}`}>{fmtPct(r.accChange)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-5 py-2 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between text-xs">
        <span className="text-slate-500">Page {page} · {total} total</span>
        <div className="flex gap-1">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">◀</button>
          <button onClick={() => setPage(p => p + 1)} disabled={data.length < 25}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">▶</button>
        </div>
      </div>
    </div>
  );
}
