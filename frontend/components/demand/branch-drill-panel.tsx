'use client';

import { useEffect, useState } from 'react';
import { fetchBranchSummary, type BranchSummary } from '@/lib/api/demand';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { COLORS } from '@/lib/chart-colors';

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : Math.round(n).toLocaleString();

const segColor: Record<string, string> = { A: COLORS.segA, B: COLORS.segB, C: COLORS.segC };

/** R9: Branch row expand — header + byPeriod bar + bySegment + top 10 SKUs. */
export function BranchDrillPanel({ locationCode, snapshotId }: { locationCode: string; snapshotId?: string }) {
  const [data, setData] = useState<BranchSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchBranchSummary(locationCode, snapshotId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [locationCode, snapshotId]);

  if (loading) return <p className="text-xs text-slate-400 py-4">Loading {locationCode}…</p>;
  if (!data) return <p className="text-xs text-slate-400 py-4">No data for {locationCode}</p>;

  const maxPeriod = Math.max(...data.byPeriod.map(p => p.qty), 1);

  return (
    <div className="py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3 text-xs">
        <span className="font-mono font-bold text-slate-700">{data.header.locationCode}</span>
        <span className="text-slate-500">{data.header.locationName}</span>
        {data.header.region && <span className="text-slate-400 italic">{data.header.region}</span>}
        <span className="ml-auto text-slate-600">
          <span className="font-mono font-semibold">{fmt(data.header.totalQty)}</span> total ·
          <span className="font-mono ml-1">{data.header.itemCount}</span> SKUs
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* By Period bar */}
        <div className="glass-card p-3">
          <p className="section-label text-[10px] mb-2">Demand by Period</p>
          <div style={{ height: 120 }}>
            <ResponsiveContainer>
              <BarChart data={data.byPeriod} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <XAxis dataKey="period" fontSize={9} stroke={COLORS.axis} />
                <YAxis tickFormatter={fmt} fontSize={9} stroke={COLORS.axis} width={40} />
                <Tooltip formatter={(v: any) => [fmt(Number(v)), 'Qty']} contentStyle={{ fontSize: 11 }} />
                <Bar dataKey="qty" fill={COLORS.primary} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* By Segment */}
        <div className="glass-card p-3">
          <p className="section-label text-[10px] mb-2">By Segment</p>
          <div className="space-y-1.5">
            {data.bySegment.map(s => {
              const pct = (s.qty / (data.header.totalQty || 1)) * 100;
              return (
                <div key={s.segment} className="flex items-center gap-2 text-[11px]">
                  <span className="w-3 h-3 rounded" style={{ backgroundColor: segColor[s.segment] ?? COLORS.other }} />
                  <span className="font-semibold w-4">{s.segment}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                    <div className="h-full" style={{ width: `${pct}%`, backgroundColor: segColor[s.segment] ?? COLORS.other }} />
                  </div>
                  <span className="font-mono text-slate-600 w-14 text-right">{fmt(s.qty)}</span>
                  <span className="font-mono text-slate-400 w-10 text-right">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Top 10 SKUs */}
        <div className="glass-card p-3">
          <p className="section-label text-[10px] mb-2">Top 10 SKUs</p>
          <div className="space-y-0.5 text-[11px]">
            {data.topSkus.map((s, i) => (
              <div key={s.itemCode} className="flex items-center gap-2">
                <span className="text-slate-400 font-mono w-4 text-right">{i + 1}</span>
                <span className="font-mono truncate flex-1" title={s.itemCode}>{s.itemCode}</span>
                <span className="font-mono text-slate-600 w-12 text-right">{fmt(s.totalQty)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
