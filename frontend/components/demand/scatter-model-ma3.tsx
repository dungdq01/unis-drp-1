'use client';

import { useEffect, useState, useCallback } from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchScatter, type ScatterPoint } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

const SEG_COLORS: Record<string, string> = { A: COLORS.segA, B: COLORS.segB, C: COLORS.segC };

export function ScatterModelMa3() {
  const [data, setData] = useState<ScatterPoint[]>([]);
  const [quadrants, setQuadrants] = useState<Record<string, number>>({});
  const [month, setMonth] = useState('t1');
  const [loading, setLoading] = useState(true);

  const load = useCallback((m: string) => {
    setLoading(true);
    fetchScatter(m)
      .then(r => { setData(r.points); setQuadrants(r.quadrants); })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const bySegment = ['A', 'B', 'C'].map(seg => ({
    seg,
    points: data.filter(d => d.segment === seg),
    color: SEG_COLORS[seg] ?? '#94A3B8',
  }));

  return (
    <ChartCard
      title="Model vs MA3 Accuracy — Per SKU"
      subtitle={`${data.length} SKUs · Diagonal = equal performance · Above = Model wins`}
      height={300}
      action={
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="rounded border border-slate-200 px-2 py-0.5 text-xs"
        >
          <option value="t1">T1 Live</option>
          <option value="t12">T12</option>
        </select>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-3 h-full">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} />
            <XAxis dataKey="ma3Acc" name="MA3 Acc" type="number" domain={[0, 100]} fontSize={10} stroke={COLORS.axis} label={{ value: 'MA3 Acc %', position: 'insideBottom', offset: -2, fontSize: 10 }} />
            <YAxis dataKey="modelAcc" name="Model Acc" type="number" domain={[0, 100]} fontSize={10} stroke={COLORS.axis} label={{ value: 'Model Acc %', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10 }} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ payload }) => {
                if (!payload?.length) return null;
                const d = payload[0]?.payload as ScatterPoint;
                if (!d) return null;
                return (
                  <div className="bg-white border border-slate-200 rounded px-2 py-1.5 text-xs shadow">
                    <p className="font-mono font-semibold">{d.fsku}</p>
                    <p>Model: <strong>{d.modelAcc.toFixed(1)}%</strong></p>
                    <p>MA3: <strong>{d.ma3Acc.toFixed(1)}%</strong></p>
                    <p className={d.modelAcc >= d.ma3Acc ? 'text-emerald-600' : 'text-rose-600'}>
                      {d.modelAcc >= d.ma3Acc ? '▲ Model wins' : '▼ MA3 wins'}
                    </p>
                  </div>
                );
              }}
            />
            {/* Diagonal reference line (equal performance) */}
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 100, y: 100 }]} stroke="#CBD5E1" strokeDasharray="4 4" />
            <ReferenceLine x={50} stroke="#E2E8F0" />
            <ReferenceLine y={50} stroke="#E2E8F0" />
            {bySegment.map(({ seg, points, color }) => (
              <Scatter
                key={seg}
                name={`Seg ${seg}`}
                data={points}
                fill={color}
                fillOpacity={0.6}
                r={3}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
        {/* Quadrant summary */}
        <div className="flex flex-col justify-center gap-2 min-w-[130px]">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">Quadrants</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-[11px] text-slate-600">Both good</span>
              <span className="ml-auto text-[11px] font-bold text-emerald-600">{quadrants.q1BothGood ?? 0}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
              <span className="text-[11px] text-slate-600">Model wins</span>
              <span className="ml-auto text-[11px] font-bold text-blue-600">{quadrants.q2ModelWins ?? 0}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
              <span className="text-[11px] text-slate-600">MA3 wins</span>
              <span className="ml-auto text-[11px] font-bold text-rose-600">{quadrants.q4Ma3Wins ?? 0}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
              <span className="text-[11px] text-slate-600">Both bad</span>
              <span className="ml-auto text-[11px] font-bold text-slate-500">{quadrants.q3BothBad ?? 0}</span>
            </div>
          </div>
          <div className="border-t border-slate-200 pt-2 mt-1 space-y-0.5">
            {['A', 'B', 'C'].map(s => (
              <div key={s} className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: SEG_COLORS[s] }} />
                <span className="text-[10px] text-slate-500">Seg {s}: {data.filter(d => d.segment === s).length}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
