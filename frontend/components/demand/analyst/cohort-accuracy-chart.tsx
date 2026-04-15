'use client';

import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchCohort, type CohortRow } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

const COHORT_COLORS = [COLORS.primary, COLORS.secondary, COLORS.accent, COLORS.warning];
const MONTHS = ['t10', 't11', 't12', 't1'];

export function CohortAccuracyChart() {
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCohort('t1').then(r => setCohorts(r.cohorts)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Pivot: X = month, Y = accuracy per cohort
  const chartData = MONTHS.map(m => {
    const point: Record<string, any> = { month: m.toUpperCase() };
    cohorts.forEach(c => { point[c.label] = c.months[m] ?? null; });
    return point;
  });

  return (
    <ChartCard title="Cohort Accuracy (I-19)" subtitle="Accuracy by SKU data maturity · More months = better forecast" height={260}>
      {loading ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div> : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 20, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="month" fontSize={10} stroke={COLORS.axis} />
            <YAxis fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}%`} domain={[0, 100]} />
            <Tooltip formatter={(v: any) => v !== null ? `${Number(v).toFixed(1)}%` : '—'} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
            {cohorts.map((c, i) => (
              <Line key={c.label} type="monotone" dataKey={c.label} stroke={COHORT_COLORS[i] ?? '#94A3B8'} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
