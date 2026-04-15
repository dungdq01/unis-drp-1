'use client';

interface Props { avgPct: number; bySegment: Record<string, number> }

const colorFor = (pct: number) =>
  pct < 15 ? 'text-emerald-600' : pct <= 25 ? 'text-amber-600' : 'text-rose-600';

export function KpiAccuracyProxy({ avgPct, bySegment }: Props) {
  const tooltip = 'Chênh lệch forecast vs avg 12 tháng. True MAPE cần actual sales (Module 8).';
  const segs = ['A', 'B', 'C'].map(s => `${s}:${(bySegment[s] ?? 0).toFixed(0)}%`).join(' · ');
  return (
    <div className="kpi-card" title={tooltip}>
      <p className="section-label mb-1">Acc. Proxy <span className="text-slate-300 font-normal">(ⓘ)</span></p>
      <p className={`metric-value text-2xl ${colorFor(avgPct)}`}>{avgPct.toFixed(1)}%</p>
      <p className="text-[11px] text-slate-400 mt-1">{segs}</p>
    </div>
  );
}
