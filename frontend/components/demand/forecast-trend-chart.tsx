'use client';

import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, Legend,
} from 'recharts';
import { COLORS } from '@/lib/chart-colors';
import { ChartCard } from '@/components/shared/chart-card';
import type { TrendMonthPoint } from '@/lib/api/demand';

interface Props {
  data: TrendMonthPoint[];
  onPeriodClick?: (month: string) => void;
}

const fmt = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as TrendMonthPoint;
  if (!p) return null;
  const diff = p.actual != null && p.forecast ? p.actual - p.forecast : null;
  const acc = p.actual != null && p.actual > 0 && p.forecast
    ? (1 - Math.abs(p.actual - p.forecast) / p.actual) * 100
    : null;
  return (
    <div className="bg-white rounded-md shadow-lg border border-slate-200 p-3 text-xs">
      <p className="font-bold text-slate-800 mb-1">{label} {p.pending && <span className="ml-1 text-slate-400">(pending)</span>}</p>
      <div className="space-y-0.5">
        <p><span className="inline-block w-2 h-2 bg-sky-500 rounded-full mr-1" />Forecast: <span className="font-mono font-semibold">{fmt(p.forecast)}</span></p>
        <p><span className="inline-block w-2 h-2 bg-emerald-500 rounded-full mr-1" />Actual: <span className="font-mono font-semibold">{fmt(p.actual)}</span></p>
        {p.confLower != null && (
          <p className="text-slate-500">CI: [{fmt(p.confLower)}, {fmt(p.confUpper)}]</p>
        )}
        {acc != null && (
          <p className="text-slate-500">Accuracy: <span className="font-semibold">{acc.toFixed(1)}%</span>{diff != null && diff < 0 && ' (over-forecast)'}{diff != null && diff > 0 && ' (under-forecast)'}</p>
        )}
        <p className="text-slate-400 mt-1">SKUs: {p.skus.toLocaleString()}</p>
      </div>
    </div>
  );
}

export function ForecastTrendChart({ data, onPeriodClick }: Props) {
  if (!data || data.length === 0) {
    return <ChartCard title="Forecast Trend — Xung nhịp dự báo" height={360}><div className="h-full flex items-center justify-center text-sm text-slate-400">Loading…</div></ChartCard>;
  }
  // Band rendering: stacked areas add values → use (confLower, range) where range = confUpper - confLower.
  // Result: transparent from 0 → confLower, tinted from confLower → confLower+range = confUpper.
  const dataWithBand = data.map(d => ({
    ...d,
    confRange: d.confLower != null && d.confUpper != null ? Math.max(d.confUpper - d.confLower, 0) : null,
  }));
  return (
    <ChartCard
      title="Forecast Trend — Xung nhịp dự báo"
      subtitle="Area = forecast · Line = actual · CI band (dashed) khi có snapshot · Click tháng để filter SKU table"
      height={360}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={dataWithBand}
          margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
          onClick={(e: any) => {
            if (onPeriodClick && e?.activeLabel) onPeriodClick(String(e.activeLabel));
          }}
        >
          <defs>
            <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={COLORS.primary} stopOpacity={0.35} />
              <stop offset="95%" stopColor={COLORS.primary} stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="confGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#94A3B8" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#94A3B8" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          {/* Tết months highlight (T1/T2/T3 per ACCURACY_REPORT_DOCS horizon) */}
          <ReferenceArea x1="T1" x2="T3" fill="#FEF3C7" fillOpacity={0.4} />

          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
          <XAxis dataKey="month" stroke={COLORS.axis} fontSize={12} />
          <YAxis tickFormatter={fmt} stroke={COLORS.axis} fontSize={12} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />

          {/* Confidence band: confLower (transparent base) + confRange (tinted top), same stackId
             → visually fills [confLower, confUpper]. */}
          <Area type="monotone" dataKey="confLower" stackId="ci" fill="transparent" stroke="none" legendType="none" isAnimationActive={false} />
          <Area type="monotone" dataKey="confRange" stackId="ci" fill="url(#confGrad)" stroke="none" name="Confidence band" isAnimationActive={false} />

          <Area
            type="monotone"
            dataKey="forecast"
            fill="url(#forecastGrad)"
            stroke={COLORS.primary}
            strokeWidth={2}
            name="Forecast"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke={COLORS.secondary}
            strokeWidth={2.5}
            dot={{ r: 5, fill: COLORS.secondary, stroke: '#fff', strokeWidth: 2 }}
            name="Actual"
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
