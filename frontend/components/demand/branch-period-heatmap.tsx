'use client';

import { useEffect, useState } from 'react';
import { fetchBranchHeatmap, type BranchHeatmapRow } from '@/lib/api/demand';

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : Math.round(n).toLocaleString();

interface Props { snapshotId?: string }

export function BranchPeriodHeatmap({ snapshotId }: Props) {
  const [branches, setBranches] = useState<BranchHeatmapRow[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchBranchHeatmap(snapshotId)
      .then(r => { setBranches(r.branches); setPeriods(r.periods); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [snapshotId]);

  if (loading) return (
    <div className="glass-card p-5">
      <p className="section-label">Branch × Period Heatmap</p>
      <div className="h-24 flex items-center justify-center text-slate-400 text-sm mt-4">Loading…</div>
    </div>
  );

  if (branches.length === 0) return null;

  // Compute per-period max for color scaling
  const maxByPeriod: Record<string, number> = {};
  for (const p of periods) {
    maxByPeriod[p] = Math.max(...branches.map(b => b.periods[p] ?? 0), 1);
  }

  const cellBg = (val: number, max: number) => {
    const pct = Math.min(1, val / max);
    const opacity = 0.08 + pct * 0.75;
    return `rgba(14, 165, 233, ${opacity.toFixed(2)})`;
  };

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)]">
        <p className="section-label">Branch × Period Heatmap (I-6)</p>
        <p className="text-xs text-slate-500 mt-0.5">Color intensity = demand volume · Top {branches.length} branches</p>
      </div>
      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white/90 backdrop-blur">
            <tr className="border-b border-[rgba(148,173,215,0.12)]">
              <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400 min-w-[160px]">Branch</th>
              {periods.map(p => (
                <th key={p} className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400 min-w-[80px]">{p}</th>
              ))}
              <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</th>
            </tr>
          </thead>
          <tbody>
            {branches.map(b => (
              <tr key={b.branchCode} className="border-b border-[rgba(148,173,215,0.06)]">
                <td className="px-4 py-1.5">
                  <p className="font-mono text-xs text-slate-700">{b.branchCode}</p>
                  <p className="text-[10px] text-slate-400 truncate max-w-[140px]">{b.branchName}</p>
                </td>
                {periods.map(p => {
                  const val = b.periods[p] ?? 0;
                  return (
                    <td key={p} className="px-3 py-1.5 text-right font-mono"
                      style={{ backgroundColor: cellBg(val, maxByPeriod[p]) }}>
                      {val > 0 ? fmt(val) : '—'}
                    </td>
                  );
                })}
                <td className="px-3 py-1.5 text-right font-mono font-semibold text-sky-700">{fmt(b.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
