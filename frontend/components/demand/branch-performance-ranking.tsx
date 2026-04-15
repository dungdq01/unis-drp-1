'use client';

import type { BranchBreakdown } from '@/lib/api/demand';

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : Math.round(n).toLocaleString();

interface Props { branches: BranchBreakdown[] }

export function BranchPerformanceRanking({ branches }: Props) {
  if (!branches || branches.length === 0) return null;

  const sorted = [...branches].sort((a, b) => b.totalQty - a.totalQty);
  const top5 = sorted.slice(0, 5);
  const bottom5 = sorted.slice(-5).reverse();
  const totalDemand = sorted.reduce((s, b) => s + b.totalQty, 0) || 1;

  return (
    <div className="glass-card p-5">
      <div className="mb-4">
        <p className="section-label">Branch Performance Ranking (I-7)</p>
        <p className="text-xs text-slate-500 mt-0.5">{branches.length} branches · sorted by total demand</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 5 */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700 mb-2">🔥 Highest Demand</p>
          <div className="space-y-2">
            {top5.map((b, i) => {
              const pct = (b.totalQty / totalDemand) * 100;
              return (
                <div key={b.locationCode}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-mono text-slate-700">{i + 1}. {b.locationCode}</span>
                    <span className="text-xs font-semibold text-emerald-700">{fmt(b.totalQty)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[9px] text-slate-400 mt-0.5">{pct.toFixed(1)}% of total · {b.region}</p>
                </div>
              );
            })}
          </div>
        </div>
        {/* Bottom 5 */}
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-rose-700 mb-2">⚠ Lowest Demand</p>
          <div className="space-y-2">
            {bottom5.map((b, i) => {
              const pct = (b.totalQty / totalDemand) * 100;
              return (
                <div key={b.locationCode}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-mono text-slate-700">{i + 1}. {b.locationCode}</span>
                    <span className="text-xs font-semibold text-rose-700">{fmt(b.totalQty)}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-rose-300 rounded-full" style={{ width: `${Math.max(2, pct * 20)}%` }} />
                  </div>
                  <p className="text-[9px] text-slate-400 mt-0.5">{pct.toFixed(2)}% of total · {b.region}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
