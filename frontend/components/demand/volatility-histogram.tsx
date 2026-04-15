'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchVolatility, type VolatilityBin } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

export function VolatilityHistogram() {
  const [bins, setBins] = useState<VolatilityBin[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVolatility()
      .then(r => { setBins(r.bins); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const extreme = bins.find(b => b.range === '>100%');

  if (loading) return (
    <ChartCard title="Forecast Volatility (CV)" subtitle="Loading…" height={240}>
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div>
    </ChartCard>
  );

  return (
    <ChartCard
      title="Forecast Volatility (CV Distribution)"
      subtitle={`${total} SKUs · CV = stddev / mean across T10-T1 actuals`}
      height={240}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 h-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="label" fontSize={10} stroke={COLORS.axis} />
            <YAxis fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}`} />
            <Tooltip
              formatter={(v: any, _: any, props: any) => [`${v} SKUs (${props.payload?.pct ?? 0}%)`, 'Count']}
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {bins.map((b, i) => <Cell key={i} fill={b.color} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        {/* Summary */}
        <div className="flex flex-col justify-center gap-2 min-w-[120px] px-2">
          {bins.map(b => (
            <div key={b.range} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
              <div className="flex-1">
                <p className="text-[10px] font-semibold text-slate-600">{b.label}</p>
                <p className="text-[9px] text-slate-400">{b.pct}%</p>
              </div>
              <span className="text-[11px] font-bold text-slate-700">{b.count}</span>
            </div>
          ))}
          {extreme && extreme.count > 0 && (
            <p className="text-[10px] text-amber-700 border-t border-amber-100 pt-1.5 mt-1">
              ⚠ {extreme.count} extreme CV — consider safety stock
            </p>
          )}
        </div>
      </div>
    </ChartCard>
  );
}
