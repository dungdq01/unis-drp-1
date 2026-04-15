'use client';

import { ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import type { AccuracySummary } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

interface Props { accuracy: AccuracySummary | null }

export function AccuracyTrendChart({ accuracy }: Props) {
  if (!accuracy) return null;
  const data = accuracy.byMonth.filter(m => !m.pending && m.finalAcc !== null).map(m => ({
    month: m.month,
    model: m.finalAcc,
    ma3: m.ma3Acc,
    gain: m.finalAcc !== null && m.ma3Acc !== null ? m.finalAcc - m.ma3Acc : 0,
  }));

  return (
    <ChartCard title="Accuracy Trend — Rolling (I-15)" subtitle="Model vs MA3 · Gain annotated at each point" height={260}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 16, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="month" fontSize={10} stroke={COLORS.axis} />
          <YAxis fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}%`} domain={[0, 100]} />
          <Tooltip formatter={(v: any, name: any) => [`${Number(v).toFixed(1)}%`, String(name) === 'model' ? 'Model' : 'MA3']} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
          <ReferenceLine y={50} stroke={COLORS.grid} strokeDasharray="4 4" />
          <Area type="monotone" dataKey="gain" fill="#10B98122" stroke="none" isAnimationActive={false} />
          <Line type="monotone" dataKey="ma3" name="MA3" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="model" name="Model" stroke={COLORS.secondary} strokeWidth={2.5} dot={{ r: 4, fill: COLORS.secondary, stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false}
            label={{ position: 'top', fontSize: 9, formatter: (v: any) => v ? `+${(v - (data.find(d => d.model === v)?.ma3 ?? v)).toFixed(1)}pp` : '' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
