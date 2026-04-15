'use client';

import { ChartCard } from '@/components/shared/chart-card';

interface GaugeMetric {
  label: string;
  value: number;       // 0-100 display value
  displayValue: string; // formatted display (e.g. "85.2%", "31 tháng")
  threshold: { good: number; medium: number }; // e.g. good=80, medium=50
}

interface Props {
  metrics: {
    /** @deprecated — duplicates Row 1 Coverage KPI. Kept in type for compat, not rendered. */
    forecastRate?: number;
    sparsity: number;       // % SKUs with ≥3 months data
    dataMonths: number;     // avg actual months per item (0-4)
    segments: number;       // count distinct segments
  } | null;
}

function classify(value: number, t: { good: number; medium: number }): { label: string; color: string } {
  if (value >= t.good) return { label: 'Tốt', color: '#10B981' };
  if (value >= t.medium) return { label: 'TB', color: '#F59E0B' };
  return { label: 'Yếu', color: '#EF4444' };
}

function Gauge({ m }: { m: GaugeMetric }) {
  const radius = 50;
  const circ = Math.PI * radius; // half circle
  const pct = Math.max(0, Math.min(100, m.value));
  const offset = circ - (pct / 100) * circ;
  const { label, color } = classify(pct, m.threshold);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="120" height="70" viewBox="0 0 120 70">
        {/* Track */}
        <path d={`M 10 60 A ${radius} ${radius} 0 0 1 110 60`}
              fill="none" stroke="#E2E8F0" strokeWidth="10" strokeLinecap="round" />
        {/* Value arc */}
        <path d={`M 10 60 A ${radius} ${radius} 0 0 1 110 60`}
              fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
              strokeDasharray={circ} strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <p className="text-base font-bold text-slate-800 -mt-4">{m.displayValue}</p>
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{m.label}</p>
      <span className="inline-block rounded-full px-2 py-0.5 text-[9px] font-bold"
            style={{ backgroundColor: color + '22', color }}>
        {label}
      </span>
    </div>
  );
}

export function DataQualityGauges({ metrics }: Props) {
  if (!metrics) {
    return (
      <ChartCard title="Chất lượng dữ liệu" height={280}>
        <div className="h-full flex items-center justify-center text-sm text-slate-400">Loading…</div>
      </ChartCard>
    );
  }
  // QA-1: 3 gauges only — dropped "Forecast Rate" (duplicate of Row 1 Coverage KPI).
  const { sparsity, dataMonths, segments } = metrics;
  const monthsPct = Math.min((dataMonths / 4) * 100, 100);
  const segPct = Math.min((segments / 3) * 100, 100);
  const items: GaugeMetric[] = [
    {
      label: 'Sparsity',
      value: sparsity,
      displayValue: `${sparsity.toFixed(1)}%`,
      threshold: { good: 70, medium: 40 },
    },
    {
      label: 'Actuals avg',
      value: monthsPct,
      displayValue: `${dataMonths.toFixed(1)} / 4`,
      threshold: { good: 75, medium: 50 },
    },
    {
      label: 'Segments',
      value: segPct,
      displayValue: `${segments} / 3`,
      threshold: { good: 100, medium: 66 },
    },
  ];
  return (
    <ChartCard title="Chất lượng dữ liệu" subtitle="3 chỉ số đánh giá input data" height={280}>
      <div className="grid grid-cols-3 gap-3 h-full">
        {items.map(m => <Gauge key={m.label} m={m} />)}
      </div>
    </ChartCard>
  );
}
