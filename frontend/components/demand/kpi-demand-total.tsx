'use client';

interface Props { totalDemand: number; totalPeriods: number }

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : String(Math.round(n));

export function KpiDemandTotal({ totalDemand, totalPeriods }: Props) {
  return (
    <div className="kpi-card">
      <p className="section-label mb-1">Total Demand</p>
      <p className="metric-value text-2xl">{fmt(totalDemand)}</p>
      <p className="text-[11px] text-slate-400 mt-1">
        across {totalPeriods} month{totalPeriods !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
