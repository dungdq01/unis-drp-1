'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchBias, type BiasItem } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

export function BiasDivergingBar() {
  const [items, setItems] = useState<BiasItem[]>([]);
  const [groupBy, setGroupBy] = useState('segment');
  const [month, setMonth] = useState('t1');
  const [loading, setLoading] = useState(true);

  const load = useCallback((g: string, m: string) => {
    setLoading(true);
    fetchBias(g, m)
      .then(r => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(groupBy, month); }, [groupBy, month, load]);

  const verdict = items.length > 0
    ? items.every(i => i.bias > 5) ? 'System over-forecasts — inventory risk'
    : items.every(i => i.bias < -5) ? 'System under-forecasts — stockout risk'
    : 'Mixed bias — review by segment'
    : '';

  return (
    <ChartCard title="Bias Analysis (I-13)" subtitle="bias = (forecast − actual) / actual · Positive = over-forecast" height={260}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <select value={groupBy} onChange={e => setGroupBy(e.target.value)} className="rounded border border-slate-200 px-2 py-0.5 text-xs">
          <option value="segment">By Segment</option>
          <option value="month">By Month</option>
        </select>
        <select value={month} onChange={e => setMonth(e.target.value)} className="rounded border border-slate-200 px-2 py-0.5 text-xs">
          <option value="t1">T1</option><option value="t12">T12</option>
        </select>
        {verdict && <span className="text-[10px] text-amber-700 font-semibold">⚠ {verdict}</span>}
      </div>
      <div className="h-[calc(100%-40px)]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} layout="vertical" margin={{ top: 4, right: 40, left: 60, bottom: 4 }}>
            <XAxis type="number" fontSize={10} tickFormatter={v => `${v > 0 ? '+' : ''}${v}%`} stroke={COLORS.axis} />
            <YAxis type="category" dataKey="label" fontSize={10} width={55} />
            <Tooltip formatter={(v: any) => [`${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}%`, 'Bias']} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            <ReferenceLine x={0} stroke="#CBD5E1" strokeWidth={2} />
            <Bar dataKey="bias" isAnimationActive={false} radius={[0, 3, 3, 0]}>
              {items.map((it, i) => <Cell key={i} fill={it.bias > 0 ? '#F97316' : '#3B82F6'} fillOpacity={0.8} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
