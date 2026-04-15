'use client';

import type { TetImpact } from '@/lib/api/demand';

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : Math.round(n).toLocaleString();

export function TetImpactCard({ tetImpact }: { tetImpact: TetImpact | null }) {
  if (!tetImpact) return null;
  const { tetAvgQty, nonTetAvgQty, upliftPct, tetItemCount } = tetImpact;
  const max = Math.max(tetAvgQty, nonTetAvgQty, 1);
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="section-label">🧧 Tết Impact</p>
        <span className={`text-sm font-bold ${upliftPct > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
          {upliftPct > 0 ? '+' : ''}{upliftPct.toFixed(1)}% uplift
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="w-16 text-xs text-slate-500">Tết</span>
          <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden relative">
            <div className="h-full bg-gradient-to-r from-amber-400 to-rose-400" style={{ width: `${(tetAvgQty / max) * 100}%` }} />
            <span className="absolute inset-0 flex items-center px-2 text-[11px] font-mono text-slate-700">
              {fmt(tetAvgQty)} / month
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-16 text-xs text-slate-500">Non-Tết</span>
          <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden relative">
            <div className="h-full bg-gradient-to-r from-sky-400 to-blue-500" style={{ width: `${(nonTetAvgQty / max) * 100}%` }} />
            <span className="absolute inset-0 flex items-center px-2 text-[11px] font-mono text-slate-700">
              {fmt(nonTetAvgQty)} / month
            </span>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 mt-3">{tetItemCount.toLocaleString()} items affected</p>
    </div>
  );
}
