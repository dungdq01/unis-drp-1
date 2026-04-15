'use client';

import type { AccuracyKpi } from '@/lib/api/demand';

export function AccuracyKpiCards({ kpi }: { kpi: AccuracyKpi | null }) {
  if (!kpi) return null;
  const gainColor = kpi.gainT1 >= 0 ? 'text-emerald-600' : 'text-rose-600';
  const gainBorder = kpi.gainT1 >= 0 ? 'border-emerald-500' : 'border-rose-500';
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
      <div className="kpi-card border-l-[3px] border-emerald-500 py-4">
        <p className="section-label mb-1">Model Acc · T1 LIVE</p>
        <p className="metric-value text-3xl font-bold leading-tight text-emerald-600">{kpi.modelAccT1.toFixed(1)}%</p>
        <p className="text-[11px] text-slate-400 mt-1">FINAL model forecast</p>
      </div>
      <div className="kpi-card border-l-[3px] border-slate-400 py-4">
        <p className="section-label mb-1">MA3 Baseline</p>
        <p className="metric-value text-3xl font-bold leading-tight text-slate-700">{kpi.ma3AccT1.toFixed(1)}%</p>
        <p className="text-[11px] text-slate-400 mt-1">3-month moving avg</p>
      </div>
      <div className={`kpi-card border-l-[3px] ${gainBorder} py-4`}>
        <p className="section-label mb-1">Model Gain</p>
        <p className={`metric-value text-3xl font-bold leading-tight ${gainColor}`}>
          {kpi.gainT1 >= 0 ? '+' : ''}{kpi.gainT1.toFixed(1)}%
        </p>
        <p className="text-[11px] text-slate-400 mt-1">vs MA3 baseline</p>
      </div>
      <div className="kpi-card border-l-[3px] border-sky-500 py-4">
        <p className="section-label mb-1">SKUs Evaluated</p>
        <p className="metric-value text-3xl font-bold leading-tight">{kpi.skusEvaluated.toLocaleString()}</p>
        <p className="text-[11px] text-slate-400 mt-1">with actual T1 data</p>
      </div>
    </div>
  );
}
