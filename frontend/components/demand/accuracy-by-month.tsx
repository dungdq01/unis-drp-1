'use client';

import type { AccuracyMonthRow } from '@/lib/api/demand';
import { ChartCard } from '@/components/shared/chart-card';
import { AccuracyBadge } from '@/components/shared/accuracy-badge';
import { GainBar } from '@/components/shared/gain-bar';

export function AccuracyByMonth({ rows }: { rows: AccuracyMonthRow[] }) {
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.gain)), 0.1);

  return (
    <ChartCard
      title="Accuracy by Month"
      subtitle="★ backtest (có actual) · 🔴 LIVE (T1) · T2/T3 pending actuals"
    >
      <div className="overflow-x-auto -mx-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Month</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">SKUs</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">FINAL</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">MA3</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Gain</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right" title="Weighted MAPE: Σ|F-A| / ΣA">WMAPE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.month}
                  className={`border-b border-[rgba(148,173,215,0.08)] ${
                    r.pending ? 'bg-slate-50/50 italic text-slate-500'
                    : r.highlight ? 'bg-sky-50/40 border-l-2 border-sky-400'
                    : ''
                  }`}>
                <td className="px-4 py-2 font-semibold text-xs">
                  {r.highlight && <span className="text-sky-600">★ </span>}
                  {r.month}
                  {r.live && <span className="ml-2 px-1.5 py-0.5 text-[9px] font-bold rounded bg-emerald-100 text-emerald-700">🔴 LIVE</span>}
                  {r.pending && <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-slate-100 text-slate-500">PENDING</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {r.pending ? '—' : r.skus.toLocaleString()}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.pending ? <span className="text-xs text-slate-400">forecast only</span> : <AccuracyBadge pct={r.finalAcc} />}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.ma3Acc !== null ? <AccuracyBadge pct={r.ma3Acc} /> : <span className="text-xs text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2">
                  {r.pending ? (
                    <span className="text-xs text-slate-400">awaiting actuals</span>
                  ) : (
                    <GainBar gain={r.gain} maxAbs={maxAbs} />
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">
                  {r.wmape !== null ? `${r.wmape.toFixed(1)}%` : <span className="text-slate-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
