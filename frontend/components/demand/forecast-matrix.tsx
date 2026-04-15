'use client';
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import type { PivotRow } from '@/lib/api/demand';

interface ForecastMatrixProps {
  data: PivotRow[];
  loading: boolean;
  onCellClick?: (cell: { itemCode: string; segment: string; period: string; qty: number; snapshotId?: string }) => void;
}

const SEG_BADGE: Record<string, string> = {
  A: 'badge-emerald',
  B: 'badge-sky',
  C: 'bg-slate-100 text-slate-600 border border-slate-200',
};

// G7: Tet season detection (Jan-Mar)
const isTetPeriod = (period: string) => {
  const month = parseInt(period.split('-')[1]);
  return month >= 1 && month <= 3;
};

// FE-T4: Severity color coding
function cellColor(qty: number, avg: number): string {
  if (qty === 0 && avg > 0) return 'bg-red-50 text-red-700';        // RED: missing forecast
  if (avg > 0 && qty > 2 * avg) return 'bg-orange-50 text-orange-700'; // ORANGE: overforecast
  return '';
}

export function ForecastMatrix({ data, loading, onCellClick }: ForecastMatrixProps) {
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Get all unique periods from data
  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const row of data) {
      for (const p of Object.keys(row.periods || {})) set.add(p);
    }
    return Array.from(set).sort();
  }, [data]);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => sortDir === 'desc' ? b.total - a.total : a.total - b.total);
  }, [data, sortDir]);

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[rgba(148,173,215,0.12)]">
        <p className="section-label">Forecast Matrix</p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">{data.length} items</span>
          <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="text-[11px] text-sky-500 hover:text-sky-700">
            Sort {sortDir === 'desc' ? '\u2193' : '\u2191'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 rounded-full border-2 border-sky-200 border-t-sky-500 animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-5 py-10 text-center text-slate-400 text-sm">No forecast data</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sticky left-0 bg-white/90 backdrop-blur-sm">Item Code</th>
                <th className="px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Seg</th>
                {periods.map(p => (
                  <th key={p} className="px-3 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right min-w-[80px]">{p}</th>
                ))}
                <th className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-800 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.itemCode + '-' + r.segment}
                  className="border-b border-[rgba(148,173,215,0.06)] hover:bg-sky-50/30 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-slate-700 sticky left-0 bg-white/90 backdrop-blur-sm">{r.itemCode}</td>
                  <td className="px-3 py-2">
                    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold', SEG_BADGE[r.segment] || SEG_BADGE.C)}>
                      {r.segment}
                    </span>
                  </td>
                  {periods.map(p => {
                    const qty = r.periods?.[p] || 0;
                    const color = cellColor(qty, r.qtySold12mAvg || 0);
                    return (
                      <td key={p}
                        className={cn('px-3 py-2 text-right font-mono text-xs cursor-pointer hover:bg-sky-50/50 transition-colors', color)}
                        onClick={() => onCellClick?.({ itemCode: r.itemCode, segment: r.segment, period: p, qty })}
                      >
                        {qty > 0 ? qty.toLocaleString() : <span className="text-slate-300">{'\u2014'}</span>}
                        {isTetPeriod(p) && qty > 0 && (
                          <span className="ml-1 text-[8px] text-red-400" title="Tet season">{'\uD83E\uDDE7'}</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-slate-800">
                    {r.total.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
