'use client';

import { useEffect, useState, useMemo } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchPareto, type ParetoItem } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

export function ParetoChart() {
  const [items, setItems] = useState<ParetoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPareto()
      .then(r => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  // Sample every N items for chart readability (max 80 points)
  const data = useMemo(() => {
    if (items.length === 0) return [];
    const step = Math.max(1, Math.floor(items.length / 80));
    return items.filter((_, i) => i % step === 0 || i === items.length - 1).map(it => ({
      rank: it.rank,
      pct: it.cumulativePct,
      demand: it.demand,
    }));
  }, [items]);

  // Compute summary stats
  const pct20 = items.find(i => i.cumulativePct >= 20)?.rank;
  const pct80 = items.find(i => i.cumulativePct >= 80)?.rank;
  const total = items.length;

  if (loading) return (
    <ChartCard title="Demand Concentration (Pareto)" subtitle="Loading…" height={280}>
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div>
    </ChartCard>
  );

  return (
    <ChartCard
      title="Demand Concentration (Pareto)"
      subtitle={`${total} SKUs · ${pct20 ?? '—'} SKUs = 20% of demand · ${pct80 ?? '—'} SKUs = 80% of demand`}
      height={280}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 h-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="rank" fontSize={10} stroke={COLORS.axis} label={{ value: 'SKU rank', position: 'insideBottom', offset: -2, fontSize: 10 }} />
            <YAxis fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}%`} domain={[0, 100]} />
            <Tooltip
              formatter={((v: unknown, name: string): [string, string] => [
                name === 'pct' ? `${Number(v).toFixed(1)}% cumulative` : Number(v).toLocaleString(),
                name === 'pct' ? 'Cumulative demand %' : 'Demand',
              ]) as never}
              contentStyle={{ fontSize: 11, borderRadius: 6 }}
            />
            <ReferenceLine y={80} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: '80%', fontSize: 9, fill: '#F59E0B' }} />
            <ReferenceLine y={20} stroke="#10B981" strokeDasharray="4 4" label={{ value: '20%', fontSize: 9, fill: '#10B981' }} />
            <Line
              type="monotone" dataKey="pct" name="Cumulative %"
              stroke={COLORS.primary} strokeWidth={2.5}
              dot={false} isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        {/* Right panel */}
        <div className="flex flex-col justify-center gap-3 min-w-[130px] px-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">20% of demand</p>
            <p className="text-2xl font-bold text-emerald-600">{pct20 ?? '—'}<span className="text-sm font-normal text-slate-400"> SKUs</span></p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-700">80% of demand</p>
            <p className="text-2xl font-bold text-amber-600">{pct80 ?? '—'}<span className="text-sm font-normal text-slate-400"> SKUs</span></p>
          </div>
          <div className="border-t border-slate-200 pt-2">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Total SKUs</p>
            <p className="text-xl font-bold text-slate-700">{total.toLocaleString()}</p>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
