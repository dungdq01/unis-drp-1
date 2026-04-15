'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchSeasonality, type SeasonalIndex } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

export function SeasonalityChart() {
  const [indices, setIndices] = useState<SeasonalIndex[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSeasonality().then(r => setIndices(r.indices)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const peak = indices.length > 0 ? indices.reduce((a, b) => b.index > a.index ? b : a) : null;

  return (
    <ChartCard title="Seasonal Index (I-16)" subtitle={`Monthly demand factor · ${peak ? `Peak: ${peak.label} (${peak.index}×)` : ''}`} height={220}>
      {loading ? (
        <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={indices} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="label" fontSize={10} stroke={COLORS.axis} />
            <YAxis fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}×`} />
            <Tooltip formatter={(v: any) => [`${Number(v).toFixed(2)}×`, 'Seasonal Index']} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            <ReferenceLine y={1.0} stroke={COLORS.axis} strokeDasharray="4 4" label={{ value: 'baseline', fontSize: 9 }} />
            <Bar dataKey="index" radius={[3,3,0,0]} isAnimationActive={false}>
              {indices.map((it, i) => <Cell key={i} fill={it.index >= 1.1 ? '#F97316' : it.index <= 0.9 ? '#3B82F6' : '#10B981'} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
