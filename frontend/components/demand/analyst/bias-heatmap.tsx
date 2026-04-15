'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchBiasHeatmap, type BiasHeatmapRow } from '@/lib/api/demand';

function biasCell(v: number | null) {
  if (v === null) return 'bg-slate-50 text-slate-400';
  if (v > 20) return 'bg-orange-300 text-orange-900';
  if (v > 10) return 'bg-orange-100 text-orange-800';
  if (v > -5 && v <= 5) return 'bg-white text-slate-700';
  if (v < -10) return 'bg-blue-300 text-blue-900';
  if (v < -5) return 'bg-blue-100 text-blue-800';
  return 'bg-slate-50 text-slate-600';
}

const fmtBias = (v: number | null) => v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

export function BiasHeatmap() {
  const [rows, setRows] = useState<BiasHeatmapRow[]>([]);
  const [month, setMonth] = useState('t1');
  const [loading, setLoading] = useState(true);

  const load = useCallback((m: string) => {
    setLoading(true);
    fetchBiasHeatmap(m)
      .then(r => setRows(r.rows))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-3">
        <div>
          <p className="section-label">Bias Heatmap — Branch × Segment (I-14)</p>
          <p className="text-xs text-slate-500 mt-0.5">Orange = over-forecast · Blue = under-forecast</p>
        </div>
        <div className="ml-auto">
          <select value={month} onChange={e => setMonth(e.target.value)} className="rounded border border-slate-200 px-2 py-1 text-xs">
            <option value="t1">T1</option><option value="t12">T12</option>
          </select>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        {loading ? (
          <div className="h-24 flex items-center justify-center text-slate-400 text-sm">Loading…</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white/90 backdrop-blur">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase text-slate-400">Branch</th>
                <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-blue-700">Seg A</th>
                <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-amber-700">Seg B</th>
                <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-slate-500">Seg C</th>
                <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase text-slate-400">Avg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.branchCode} className="border-b border-slate-50">
                  <td className="px-4 py-1.5">
                    <p className="font-mono text-slate-700">{r.branchCode}</p>
                    <p className="text-[9px] text-slate-400 truncate">{r.branchName}</p>
                  </td>
                  {[r.segA, r.segB, r.segC, r.avg].map((v, i) => (
                    <td key={i} className="px-3 py-1.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${biasCell(v)}`}>{fmtBias(v)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
