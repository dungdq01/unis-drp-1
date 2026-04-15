'use client';

import type { WorstPerformer } from '@/lib/api/demand';

const fmt = (n: number | null) =>
  n === null || n === undefined ? '—' :
  n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` :
  Math.round(n).toLocaleString();

interface Props {
  items: WorstPerformer[];
  total: number;
  threshold: number;
  onOverride?: (fsku: string) => void;
}

export function WorstPerformers({ items, total, threshold, onOverride }: Props) {
  return (
    <div className="glass-card overflow-hidden border-rose-200/50">
      <div className="px-5 py-4 border-b border-rose-200/30 bg-rose-50/20 flex items-center justify-between">
        <div>
          <p className="section-label text-rose-700">⚠ Worst Performers — Need Override</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {total.toLocaleString()} SKUs with accuracy &lt; {threshold}% AND actual &gt; 100 — review for T2/T3
          </p>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white/90 backdrop-blur">
            <tr className="border-b border-rose-200/30 text-left">
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">FSKU</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Seg</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Actual</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Model FC</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Model Acc</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">FC T2</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">FC T3</th>
              <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-400 text-sm">No worst performers 🎉</td></tr>
            )}
            {items.map(r => (
              <tr key={r.fsku} className="border-b border-rose-100/40 hover:bg-rose-50/30">
                <td className="px-5 py-2 font-mono text-xs">{r.fsku}</td>
                <td className="px-5 py-2 text-xs font-semibold">{r.segment || '—'}</td>
                <td className="px-5 py-2 text-right font-mono text-xs font-semibold">{fmt(r.actual)}</td>
                <td className="px-5 py-2 text-right font-mono text-xs text-rose-700">{fmt(r.modelForecast)}</td>
                <td className="px-5 py-2 text-right">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold bg-rose-100 text-rose-700">
                    {r.modelAccuracy.toFixed(1)}%
                  </span>
                </td>
                <td className="px-5 py-2 text-right font-mono text-xs">{fmt(r.forecastT2)}</td>
                <td className="px-5 py-2 text-right font-mono text-xs">{fmt(r.forecastT3)}</td>
                <td className="px-5 py-2 text-center">
                  {onOverride && (
                    <button
                      onClick={() => onOverride(r.fsku)}
                      className="rounded-md px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 border border-rose-200 transition-colors"
                    >
                      Override T2-T3
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
