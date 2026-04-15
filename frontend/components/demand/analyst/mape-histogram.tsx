'use client';

import { useCallback, useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchErrorDistribution, type ErrorDistBin, type TailSKU } from '@/lib/api/demand';
import { COLORS } from '@/lib/chart-colors';

const BIN_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#F97316', '#EF4444', '#991B1B'];

export function MapeHistogram() {
  const [bins, setBins] = useState<ErrorDistBin[]>([]);
  const [percentiles, setPercentiles] = useState<Record<string, number>>({});
  const [tailSKUs, setTailSKUs] = useState<TailSKU[]>([]);
  const [mean, setMean] = useState(0);
  const [stdDev, setStdDev] = useState(0);
  const [total, setTotal] = useState(0);
  const [month, setMonth] = useState('t1');
  const [loading, setLoading] = useState(true);

  const load = useCallback((m: string) => {
    setLoading(true);
    fetchErrorDistribution(m)
      .then(r => { setBins(r.bins); setPercentiles(r.percentiles); setTailSKUs(r.tailSKUs); setMean(r.mean); setStdDev(r.stdDev); setTotal(r.total); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  return (
    <ChartCard
      title="MAPE / Error Distribution (I-11)"
      subtitle={`${total} SKUs · Mean ${mean.toFixed(1)}% ± ${stdDev.toFixed(1)}% · Median ${percentiles.p50?.toFixed(1) ?? '—'}%`}
      height={280}
    >
      <div className="flex items-center gap-2 mb-2">
        <select value={month} onChange={e => { setMonth(e.target.value); }} className="rounded border border-slate-200 px-2 py-0.5 text-xs">
          <option value="t1">T1 Live</option><option value="t12">T12</option>
        </select>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 h-[calc(100%-32px)]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={bins} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
            <XAxis dataKey="range" fontSize={10} stroke={COLORS.axis} />
            <YAxis fontSize={10} stroke={COLORS.axis} />
            <Tooltip formatter={(v: any, _, p) => [`${v} SKUs (${p.payload?.pct ?? 0}%)`]} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
            {bins.length > 0 && (() => {
              const meanBin = bins.find(b => {
                const parts = b.range.replace(/%/g, '').split('-').map(Number);
                return parts.length === 2 && mean >= parts[0] && mean < parts[1];
              }) ?? bins[Math.min(Math.floor(mean / 10), bins.length - 1)];
              return meanBin ? <ReferenceLine x={meanBin.range} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: `μ ${mean.toFixed(0)}%`, fontSize: 9, fill: '#94A3B8', position: 'top' }} /> : null;
            })()}
            <Bar dataKey="count" radius={[3,3,0,0]} isAnimationActive={false}>
              {bins.map((_, i) => <Cell key={i} fill={BIN_COLORS[i] ?? '#94A3B8'} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="flex flex-col justify-start gap-1.5 min-w-[130px] pt-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Percentiles</p>
          {[10, 25, 50, 75, 90].map(p => (
            <div key={p} className="flex justify-between text-[11px]">
              <span className="text-slate-500">P{p}</span>
              <span className="font-semibold text-slate-700">{percentiles[`p${p}`]?.toFixed(1) ?? '—'}%</span>
            </div>
          ))}
          {tailSKUs.length > 0 && (
            <div className="border-t border-slate-200 pt-2 mt-1">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-rose-600 mb-1">Tail (MAPE&gt;80%)</p>
              {tailSKUs.slice(0, 3).map(s => (
                <p key={s.fsku} className="text-[10px] text-slate-600 font-mono truncate">{s.fsku}: {s.mape.toFixed(0)}%</p>
              ))}
              {tailSKUs.length > 3 && <p className="text-[10px] text-slate-400">+{tailSKUs.length - 3} more</p>}
            </div>
          )}
        </div>
      </div>
    </ChartCard>
  );
}
