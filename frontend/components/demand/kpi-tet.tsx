'use client';

interface Props { tetItemCount: number; upliftPct: number }

export function KpiTet({ tetItemCount, upliftPct }: Props) {
  return (
    <div className="kpi-card">
      <p className="section-label mb-1">Tết Items</p>
      <p className="metric-value text-2xl">{tetItemCount.toLocaleString()}</p>
      <p className={`text-[11px] mt-1 font-medium ${upliftPct > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
        {upliftPct > 0 ? '+' : ''}{upliftPct.toFixed(1)}% vs non-Tết
      </p>
    </div>
  );
}
