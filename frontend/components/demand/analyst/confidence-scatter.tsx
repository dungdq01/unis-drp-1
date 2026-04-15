'use client';

import { useEffect, useState } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchScatter, type ScatterPoint } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

const SEG_COLORS: Record<string, string> = { A: COLORS.segA, B: COLORS.segB, C: COLORS.segC };

export function ConfidenceScatter() {
  // Use scatter data (model acc vs ma3 acc) as proxy for confidence vs accuracy
  const [data, setData] = useState<ScatterPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchScatter('t1').then(r => setData(r.points)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Use gain (model - ma3) as X axis (proxy for confidence advantage)
  const chartData = data.map(d => ({
    ...d,
    gain: d.modelAcc - d.ma3Acc, // CI proxy: larger gain = model more confident
  }));

  const bySegment = ['A', 'B', 'C'].map(seg => ({ seg, points: chartData.filter(d => d.segment === seg), color: SEG_COLORS[seg] ?? '#94A3B8' }));

  return (
    <ChartCard title="Model Confidence vs Accuracy (I-22)" subtitle="X = model gain over MA3 · Y = model accuracy · Should correlate positively" height={260}>
      {loading ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div> : (
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
            <XAxis dataKey="gain" name="Model Gain" type="number" fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}pp`} />
            <YAxis dataKey="modelAcc" name="Model Acc" type="number" domain={[0, 100]} fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}%`} />
            <ReferenceLine x={0} stroke={COLORS.axis} strokeDasharray="4 4" />
            <Tooltip content={({ payload }) => {
              if (!payload?.length) return null;
              const d = payload[0]?.payload as any;
              return <div className="bg-white border border-slate-200 rounded px-2 py-1 text-xs shadow"><p className="font-mono">{d.fsku}</p><p>Gain: {d.gain > 0 ? '+' : ''}{d.gain.toFixed(1)}pp · Acc: {d.modelAcc.toFixed(1)}%</p></div>;
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
