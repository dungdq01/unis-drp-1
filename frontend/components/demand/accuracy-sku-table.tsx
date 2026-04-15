'use client';

import { useEffect, useState } from 'react';
import {
  fetchAccuracySkus,
  type AccuracySkuRow,
  type AccuracyMonth,
  type AccuracyWinner,
  type AccuracySort,
} from '@/lib/api/demand';

const fmt = (n: number | null) =>
  n === null || n === undefined ? '—' :
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` :
  n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` :
  Math.round(n).toLocaleString();

/** Spec color coding: ≥70% green, 40-70% yellow, <40% red */
const accColor = (pct: number) =>
  pct >= 70 ? 'text-emerald-700' : pct >= 40 ? 'text-amber-600' : 'text-rose-600';

export function AccuracySkuTable() {
  const [month, setMonth] = useState<AccuracyMonth>('t1');
  const [segment, setSegment] = useState<string>('');
  const [winner, setWinner] = useState<AccuracyWinner>('ALL');
  const [sort, setSort] = useState<AccuracySort>('actual_desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AccuracySkuRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 20;

  useEffect(() => {
    setLoading(true);
    fetchAccuracySkus({ month, segment: segment || undefined, winner, sort, page, pageSize })
      .then(r => { setData(r.data); setTotal(r.meta.total); })
      .catch(() => { setData([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [month, segment, winner, sort, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)]">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="section-label">SKU Accuracy Detail</p>
            <p className="text-xs text-slate-500 mt-0.5">{total.toLocaleString()} SKUs</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <select value={month} onChange={e => { setMonth(e.target.value as AccuracyMonth); setPage(1); }}
                    className="rounded-md border border-slate-200 px-2 py-1">
              <option value="t1">T1 (LIVE)</option>
              <option value="t12">T12</option>
              <option value="t11">T11</option>
              <option value="t10">T10</option>
            </select>
            <select value={segment} onChange={e => { setSegment(e.target.value); setPage(1); }}
                    className="rounded-md border border-slate-200 px-2 py-1">
              <option value="">All segments</option>
              <option value="A">A</option><option value="B">B</option><option value="C">C</option>
            </select>
            <select value={winner} onChange={e => { setWinner(e.target.value as AccuracyWinner); setPage(1); }}
                    className="rounded-md border border-slate-200 px-2 py-1">
              <option value="ALL">All winners</option>
              <option value="MODEL">Model wins</option>
              <option value="MA3">MA3 wins</option>
            </select>
            <select value={sort} onChange={e => setSort(e.target.value as AccuracySort)}
                    className="rounded-md border border-slate-200 px-2 py-1">
              <option value="actual_desc">Sort: Actual ↓</option>
              <option value="accuracy_desc">Accuracy ↓</option>
              <option value="accuracy_asc">Accuracy ↑</option>
              <option value="gain_desc">Gain ↓</option>
            </select>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white/80 backdrop-blur">
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">FSKU</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Seg</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Actual</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Model FC</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">MA3 FC</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Model Acc</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">MA3 Acc</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Winner</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">Loading…</td></tr>}
            {!loading && data.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400">No SKUs</td></tr>
            )}
            {!loading && data.map(r => (
              <tr key={r.fsku} className={`border-b border-[rgba(148,173,215,0.08)] ${r.winner === 'MODEL' ? 'hover:bg-emerald-50/30' : 'hover:bg-rose-50/20'}`}>
                <td className="px-5 py-2 font-mono text-xs">{r.fsku}</td>
                <td className="px-5 py-2 text-xs font-semibold">{r.segment || '—'}</td>
                <td className="px-5 py-2 text-right font-mono text-xs">{fmt(r.actual)}</td>
                <td className="px-5 py-2 text-right font-mono text-xs">{fmt(r.modelForecast)}</td>
                <td className="px-5 py-2 text-right font-mono text-xs text-slate-500">{fmt(r.ma3Forecast)}</td>
                <td className={`px-5 py-2 text-right font-mono text-xs font-semibold ${accColor(r.modelAccuracy)}`}>{r.modelAccuracy.toFixed(1)}%</td>
                <td className={`px-5 py-2 text-right font-mono text-xs ${accColor(r.ma3Accuracy)}`}>{r.ma3Accuracy.toFixed(1)}%</td>
                <td className="px-5 py-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    r.winner === 'MODEL' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                  }`}>
                    {r.winner}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination */}
      <div className="px-5 py-2 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between text-xs">
        <span className="text-slate-500">Page {page} / {totalPages}</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">← Prev</button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                  className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40">Next →</button>
        </div>
      </div>
    </div>
  );
}
