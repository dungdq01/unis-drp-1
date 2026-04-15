'use client';

import type { AccuracyTierRow } from '@/lib/api/demand';
import { ChartCard } from '@/components/shared/chart-card';
import { AccuracyBadge } from '@/components/shared/accuracy-badge';
import { GainBar } from '@/components/shared/gain-bar';

export function AccuracyByTier({ rows }: { rows: AccuracyTierRow[] }) {
  const maxAbs = Math.max(...rows.map(r => Math.abs(r.gain)), 0.1);
  const bestIdx = rows.reduce((best, r, i, arr) => r.gain > arr[best].gain ? i : best, 0);

  return (
    <ChartCard title="Accuracy by Volume Tier" subtitle="Xếp theo tổng actual T1 giảm dần">
      <div className="overflow-x-auto -mx-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Tier</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">SKUs</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">FINAL</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">MA3</th>
              <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Gain</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.tier} className={`border-b border-[rgba(148,173,215,0.08)] ${i === bestIdx ? 'bg-emerald-50/40' : ''}`}>
                <td className="px-4 py-2 font-semibold text-xs">
                  {i === bestIdx && '⭐ '}{r.tier}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">{r.skus.toLocaleString()}</td>
                <td className="px-4 py-2 text-right"><AccuracyBadge pct={r.finalAcc} /></td>
                <td className="px-4 py-2 text-right"><AccuracyBadge pct={r.ma3Acc} /></td>
                <td className="px-4 py-2"><GainBar gain={r.gain} maxAbs={maxAbs} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
