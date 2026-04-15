'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { fetchSkuTrend, type SkuTrendPoint } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

const fmt = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
};

/**
 * Mini timeline chart rendered inside expanded FSKU row.
 * Shows actual (dots) vs forecast (line) across T10-T3, with historical WMA.
 */
export function FskuSparkline({ fsku }: { fsku: string }) {
  const [data, setData] = useState<SkuTrendPoint[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchSkuTrend(fsku)
      .then(r => setData(r.months))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [fsku]);

  if (loading) return <p className="text-xs text-slate-400 py-4">Loading timeline…</p>;
  if (!data || data.length === 0) return <p className="text-xs text-slate-400 py-4">No trend data</p>;

  // Unify forecast column: use final if present else wma
  const merged = data.map(m => ({
    ...m,
    forecastUnified: m.forecast ?? m.wma,
  }));

  return (
    <div className="flex gap-4 items-center">
      <div className="flex-1" style={{ height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={merged} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <XAxis dataKey="month" stroke={COLORS.axis} fontSize={10} />
            <YAxis tickFormatter={fmt} stroke={COLORS.axis} fontSize={10} width={45} />
            <Tooltip
              formatter={(v: any, name: any) => [fmt(Number(v)), String(name)]}
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
            />
            <ReferenceLine x="T12" stroke="#cbd5e1" strokeDasharray="2 2" />
            <Line type="monotone" dataKey="forecastUnified" name="Forecast" stroke={COLORS.primary} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="actual" name="Actual" stroke={COLORS.secondary} strokeWidth={2} dot={{ r: 4, fill: COLORS.secondary }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs space-y-0.5 min-w-[140px]">
        <p><span className="font-semibold">FSKU:</span> <span className="font-mono">{fsku}</span></p>
        <p className="text-slate-500">WMA backtest: T10–T11</p>
        <p className="text-slate-500">Model forecast: T12–T3</p>
        <p className="text-slate-500">Pre-T12 pink line = pre-model era</p>
      </div>
    </div>
  );
}
