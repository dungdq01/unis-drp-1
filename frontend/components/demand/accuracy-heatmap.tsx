'use client';

import { useEffect, useState } from 'react';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchHeatmap, type HeatmapRow } from '@/lib/api/demand';

function accColor(acc: number | null): string {
  if (acc === null) return 'bg-slate-100 text-slate-400';
  if (acc >= 70) return 'bg-emerald-100 text-emerald-800';
  if (acc >= 40) return 'bg-amber-100 text-amber-800';
  return 'bg-rose-100 text-rose-800';
}

const SEG_COLOR: Record<string, string> = { A: 'text-blue-700', B: 'text-amber-700', C: 'text-slate-600' };

export function AccuracyHeatmap() {
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHeatmap()
      .then(r => { setRows(r.rows); setTiers(r.tiers); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <ChartCard title="Accuracy Heatmap" subtitle="Segment × Volume Tier" height={200}>
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div>
    </ChartCard>
  );

  return (
    <ChartCard title="Accuracy Heatmap" subtitle="Segment × Volume Tier · Green ≥70% · Yellow 40-70% · Red <40%" height={200}>
      <div className="overflow-x-auto h-full">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-1.5 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Segment</th>
              {tiers.map(t => (
                <th key={t} className="py-1.5 px-3 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">{t}</th>
              ))}
              <th className="py-1.5 px-3 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.segment} className="border-b border-slate-100">
                <td className={`py-2 px-3 font-bold text-sm ${SEG_COLOR[row.segment] ?? ''}`}>Seg {row.segment}</td>
                {tiers.map(t => {
                  const cell = row.tiers[t];
                  return (
                    <td key={t} className="py-2 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${accColor(cell?.acc ?? null)}`}>
                        {cell?.acc !== null && cell?.acc !== undefined ? `${cell.acc.toFixed(1)}%` : '—'}
                      </span>
                      {cell?.count != null && cell.count > 0 && (
                        <p className="text-[9px] text-slate-400 mt-0.5">{cell.count} SKUs</p>
                      )}
                    </td>
                  );
                })}
                <td className="py-2 px-3 text-right text-xs text-slate-500">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
