'use client';

import { useEffect, useState } from 'react';
import { ChartCard } from '@/components/shared/chart-card';
import { fetchHeatmap, type HeatmapRow } from '@/lib/api/demand';

function accColor(acc: number | null) {
  if (acc === null) return { bg: '#F1F5F9', text: '#94A3B8' };
  if (acc >= 70) return { bg: '#D1FAE5', text: '#065F46' };
  if (acc >= 40) return { bg: '#FEF3C7', text: '#92400E' };
  return { bg: '#FEE2E2', text: '#991B1B' };
}

export function AccuracyMatrixBubble() {
  const [rows, setRows] = useState<HeatmapRow[]>([]);
  const [tiers, setTiers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHeatmap().then(r => { setRows(r.rows); setTiers(r.tiers); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <ChartCard title="Accuracy Matrix — Segment × Volume Tier (I-17)" subtitle="Bubble size = SKU count · Color = accuracy level" height={220}>
      {loading ? (
        <div className="h-full flex items-center justify-center text-slate-400 text-sm">—</div>
      ) : (
        <div className="overflow-x-auto h-full flex items-center">
          <table className="mx-auto">
            <thead>
              <tr>
                <th className="px-2 py-1 text-[10px] text-slate-400"></th>
                {tiers.map(t => <th key={t} className="px-4 py-1 text-[10px] font-semibold uppercase text-slate-400 text-center">{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.segment}>
                  <td className="px-2 py-2 text-[11px] font-bold text-slate-600">Seg {row.segment}</td>
                  {tiers.map(t => {
                    const cell = row.tiers[t];
                    const acc = cell?.acc ?? null;
                    const count = cell?.count ?? 0;
                    const size = Math.max(28, Math.min(72, Math.sqrt(count + 1) * 5));
                    const c = accColor(acc);
                    return (
                      <td key={t} className="px-4 py-2 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className="rounded-full flex items-center justify-center font-bold text-xs"
                            style={{ width: size, height: size, backgroundColor: c.bg, color: c.text, fontSize: size < 40 ? 9 : 11 }}
                          >
                            {acc !== null ? `${acc.toFixed(0)}%` : '—'}
                          </div>
                          <p className="text-[9px] text-slate-400">{count} SKUs</p>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ChartCard>
  );
}
