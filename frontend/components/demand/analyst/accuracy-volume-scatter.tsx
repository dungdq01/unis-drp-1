'use client';

import { useEffect, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchScatter, type ScatterPoint } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

const SEG_COLORS: Record<string, string> = { A: COLORS.segA, B: COLORS.segB, C: COLORS.segC };

export function AccuracyVolumeScatter() {
  const [data, setData] = useState<ScatterPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchScatter('t1').then(r => setData(r.points)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const bySegment = ['A', 'B', 'C'].map(seg => ({ seg, points: data.filter(d => d.segment === seg), color: SEG_COLORS[seg] ?? '#94A3B8' }));

  return (
    <ChartCard title="Accuracy vs Demand Volume (I-18)" subtitle="X = actual demand · Y = model accuracy · Color = segment" height={260}>
      {loading ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div> : (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
            <XAxis dataKey="actual" name="Demand" type="number" fontSize={10} stroke={COLORS.axis} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} scale="log" domain={['auto', 'auto']} />
            <YAxis dataKey="modelAcc" name="Accuracy" type="number" domain={[0, 100]} fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}%`} />
            <Tooltip content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as ScatterPoint;
              return <div className="bg-white border border-slate-200 rounded px-2 py-1 text-xs shadow"><p className="font-mono">{d.fsku}</p><p>Vol: {d.actual.toLocaleString()} · Acc: {d.modelAcc.toFixed(1)}%</p></div>;
            }} />
            {bySegment.map(({ seg, points, color }) => (
              <Scatter key={seg} name={`Seg ${seg}`} data={points} fill={color} fillOpacity={0.5} r={2.5} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
