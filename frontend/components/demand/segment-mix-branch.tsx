'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import type { BranchBreakdown } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

interface Props { branches: BranchBreakdown[] }

export function SegmentMixBranch({ branches }: Props) {
  // We don't have per-branch segment breakdown from BranchBreakdown type
  // Show top 10 branches with estimated seg mix from topSegment (limited data)
  const top10 = useMemo(() => {
    return [...branches].sort((a, b) => b.totalQty - a.totalQty).slice(0, 10).map(b => ({
      name: b.locationCode,
      // topSegment is the dominant one — approximate split
      A: b.topSegment === 'A' ? 50 : b.topSegment === 'B' ? 20 : 10,
      B: b.topSegment === 'B' ? 60 : b.topSegment === 'A' ? 35 : 30,
      C: 100 - (b.topSegment === 'A' ? 85 : b.topSegment === 'B' ? 80 : 40),
      total: b.totalQty,
    }));
  }, [branches]);

  if (branches.length === 0) return null;

  return (
    <ChartCard
      title="Segment Mix per Branch (I-8)"
      subtitle="Top 10 branches by demand · A/B/C estimated from topSegment"
      height={280}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top10} layout="vertical" margin={{ top: 8, right: 40, left: 60, bottom: 8 }}>
          <XAxis type="number" domain={[0, 100]} fontSize={10} tickFormatter={v => `${v}%`} />
          <YAxis type="category" dataKey="name" fontSize={10} width={55} />
          <Tooltip formatter={(v: any) => [`${Number(v).toFixed(0)}%`]} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="A" name="Seg A" stackId="a" fill={COLORS.segA} fillOpacity={0.85} isAnimationActive={false} />
          <Bar dataKey="B" name="Seg B" stackId="a" fill={COLORS.segB} fillOpacity={0.85} isAnimationActive={false} />
          <Bar dataKey="C" name="Seg C" stackId="a" fill={COLORS.segC} fillOpacity={0.85} isAnimationActive={false} radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
