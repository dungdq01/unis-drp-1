'use client';

import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchErrorDistribution } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

const SEG_COLORS = [COLORS.segA, COLORS.segB, COLORS.segC];

export function ErrorTailPie() {
  const [tailBySegment, setTailBySegment] = useState<{ name: string; value: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchErrorDistribution('t1')
      .then(r => {
        const seg: Record<string, number> = { A: 0, B: 0, C: 0 };
        r.tailSKUs.forEach(s => { const k = s.segment || 'C'; if (k in seg) seg[k]++; });
        setTailBySegment([
          { name: 'Seg A', value: seg.A },
          { name: 'Seg B', value: seg.B },
          { name: 'Seg C', value: seg.C },
        ].filter(s => s.value > 0));
        setTotal(r.tailSKUs.length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ChartCard title="Error Tail Breakdown (I-12)" subtitle={`${total} SKUs with MAPE > 80%`} height={220}>
      {loading ? (
        <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div>
      ) : total === 0 ? (
        <div className="h-full flex items-center justify-center text-emerald-600 text-sm font-semibold">✓ No extreme outliers</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={tailBySegment} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} isAnimationActive={false}>
              {tailBySegment.map((_, i) => <Cell key={i} fill={SEG_COLORS[i] ?? '#94A3B8'} />)}
            </Pie>
            <Tooltip formatter={(v: any, name: any) => [`${v} SKUs`, name]} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            <Legend iconSize={10} wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
