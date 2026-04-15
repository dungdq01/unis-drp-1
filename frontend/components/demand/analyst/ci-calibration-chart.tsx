'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchCiCalibration, type CiLevel, type CiSegment } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

export function CiCalibrationChart() {
  const [levels, setLevels] = useState<CiLevel[]>([]);
  const [bySegment, setBySegment] = useState<CiSegment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCiCalibration()
      .then(r => { setLevels(r.levels); setBySegment(r.bySegment); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const segData = bySegment.map(s => ({
    name: `Seg ${s.segment}`,
    actual: s.coverage80,
    target: 80,
    color: (s.coverage80 ?? 0) >= 75 ? COLORS.secondary : COLORS.warning,
  }));

  return (
    <ChartCard title="CI Calibration (I-21)" subtitle="Expected vs actual CI coverage rate by segment" height={220}>
      {loading ? <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div> : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 h-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={segData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
              <XAxis dataKey="name" fontSize={10} stroke={COLORS.axis} />
              <YAxis fontSize={10} stroke={COLORS.axis} tickFormatter={v => `${v}%`} domain={[0, 100]} />
              <Tooltip formatter={(v: any) => v !== null ? `${Number(v).toFixed(1)}%` : '—'} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
              <ReferenceLine y={80} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: '80% target', fontSize: 9, fill: '#F59E0B' }} />
              <Bar dataKey="actual" name="Actual Coverage" isAnimationActive={false} radius={[3,3,0,0]}>
                {segData.map((d, i) => <Cell key={i} fill={d.color} fillOpacity={0.85} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex flex-col justify-center gap-2 min-w-[120px]">
            {levels.map(l => (
              <div key={l.target} className="text-center">
                <p className="text-[10px] text-slate-400">{l.target}% CI target</p>
                <p className={`text-xl font-bold ${(l.actualCoverage ?? 0) >= l.target - 5 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {l.actualCoverage !== null ? `${l.actualCoverage.toFixed(1)}%` : '—'}
                </p>
                <p className="text-[9px] text-slate-400">actual coverage</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </ChartCard>
  );
}
