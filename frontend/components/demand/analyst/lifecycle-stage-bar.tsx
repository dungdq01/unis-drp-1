'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import type { SkuStatusRow } from '@/lib/api/demand';

interface Props { statuses: SkuStatusRow[]; total: number }

const LIFECYCLE_COLORS: Record<string, string> = {
  ACT: '#3B82F6',
  NEW: '#A855F7',
  END: '#EF4444',
  Other: '#94A3B8',
};

export function LifecycleStageBar({ statuses, total }: Props) {
  const data = useMemo(() => statuses.map(s => ({
    name: s.status,
    count: s.count,
    pct: s.pct,
    color: LIFECYCLE_COLORS[s.status] ?? '#94A3B8',
  })), [statuses]);

  return (
    <ChartCard title="SKU Lifecycle Distribution (I-20)" subtitle={`${total.toLocaleString()} total SKUs by status`} height={200}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 50, bottom: 4 }}>
          <XAxis type="number" fontSize={10} />
          <YAxis type="category" dataKey="name" fontSize={10} width={45} />
          <Tooltip formatter={(v: any, _, p) => [`${v.toLocaleString()} (${p.payload?.pct ?? 0}%)`]} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
          <Bar dataKey="count" isAnimationActive={false} radius={[0, 3, 3, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
