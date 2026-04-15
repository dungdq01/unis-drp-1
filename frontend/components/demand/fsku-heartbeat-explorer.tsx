'use client';

import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { COLORS } from '@/lib/chart-colors';
import { ChartCard } from '@/components/shared/chart-card';
import type { PivotRow } from '@/lib/api/demand';

const fmt = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
};

/** 8 distinct vivid colors — trading chart palette */
const LINE_COLORS = [
  '#10B981', // emerald
  '#3B82F6', // blue
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // violet
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#84CC16', // lime
];

const MAX_SELECT = 8;

interface Props {
  pivotData: PivotRow[];
}

/**
 * FSKU Heartbeat Explorer — Binance-style SKU picker.
 * Left: searchable list of ALL SKUs with total, selectable checkbox.
 * Right: multi-line chart for selected SKUs across all periods.
 * Max 8 selected for chart readability.
 */
export function FskuHeartbeatExplorer({ pivotData }: Props) {
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  const [selected, setSelected] = useState<string[]>([]);

  // Initial selection: top 3 by total when data first loads
  const sorted = useMemo(() =>
    [...(pivotData ?? [])].sort((a, b) => b.total - a.total),
    [pivotData],
  );

  // Default select top 3 once
  useMemo(() => {
    if (sorted.length > 0 && selected.length === 0) {
      setSelected(sorted.slice(0, 3).map(x => x.itemCode));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter(r => {
      if (segment && r.segment !== segment) return false;
      if (q && !r.itemCode.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sorted, search, segment]);

  const periodSet = useMemo(() => {
    const s = new Set<string>();
    for (const it of sorted) for (const p of Object.keys(it.periods)) s.add(p);
    return Array.from(s).sort();
  }, [sorted]);

  // Build chart data: one row per period, one key per selected SKU
  const chartData = useMemo(() => {
    const selEntries: Array<[string, PivotRow | undefined]> = selected.map(c =>
      [c, sorted.find(x => x.itemCode === c)]);
    return periodSet.map(p => {
      const row: Record<string, any> = { period: p };
      for (const [code, it] of selEntries) {
        row[code] = it?.periods[p] ?? 0;
      }
      return row;
    });
  }, [selected, periodSet, sorted]);

  const toggle = (code: string) => {
    setSelected(prev => {
      if (prev.includes(code)) return prev.filter(c => c !== code);
      if (prev.length >= MAX_SELECT) return prev; // ignore over-select
      return [...prev, code];
    });
  };

  const colorFor = (code: string) => {
    const i = selected.indexOf(code);
    return i < 0 ? '#CBD5E1' : LINE_COLORS[i % LINE_COLORS.length];
  };

  const segBadge = (s: string | null) => {
    if (!s) return null;
    const color = s === 'A' ? 'bg-blue-100 text-blue-700'
                : s === 'B' ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-600';
    return <span className={`inline-flex items-center rounded px-1 text-[9px] font-bold ${color}`}>{s}</span>;
  };

  return (
    <ChartCard
      title="Xung nhịp FSKU Explorer"
      subtitle={`Chọn tối đa ${MAX_SELECT} mã để so sánh · ${sorted.length.toLocaleString()} SKUs · ${periodSet.length} periods`}
      action={
        selected.length > 0 && (
          <button
            onClick={() => setSelected([])}
            className="text-[11px] text-rose-600 hover:text-rose-700 font-medium"
          >
            Xóa tất cả ({selected.length})
          </button>
        )
      }
      height={520}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 h-full">
        {/* LEFT: searchable list */}
        <div className="flex flex-col border border-amber-200/50 rounded-lg bg-white/70 overflow-hidden">
          {/* Filter bar */}
          <div className="p-2 border-b border-amber-200/50 bg-amber-50/50 space-y-2">
            <div className="relative">
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="🔍 Search FSKU…"
                className="w-full pl-7 pr-2 py-1.5 rounded-md border border-slate-200 text-xs bg-white"
              />
            </div>
            <div className="flex items-center gap-1">
              {['', 'A', 'B', 'C'].map(s => (
                <button
                  key={s || 'all'}
                  onClick={() => setSegment(s)}
                  className={`flex-1 px-2 py-1 text-[11px] font-semibold rounded transition-colors ${
                    segment === s
                      ? 'bg-amber-200 text-amber-900'
                      : 'bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {s || 'All'}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="p-4 text-center text-xs text-slate-400">No FSKU match</p>
            )}
            {filtered.map(it => {
              const isSel = selected.includes(it.itemCode);
              const isDisabled = !isSel && selected.length >= MAX_SELECT;
              const color = colorFor(it.itemCode);
              return (
                <button
                  key={it.itemCode}
                  onClick={() => toggle(it.itemCode)}
                  disabled={isDisabled}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 border-b border-slate-100 text-left transition-all ${
                    isSel
                      ? 'bg-emerald-50/80 border-l-[3px] border-l-emerald-500'
                      : isDisabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-amber-50/60 border-l-[3px] border-l-transparent'
                  }`}
                  title={isDisabled ? `Max ${MAX_SELECT} đã chọn` : (isSel ? 'Bỏ chọn' : 'Chọn để xem chart')}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: isSel ? color : '#CBD5E1' }}
                  />
                  <span className={`flex-1 font-mono text-[11px] truncate ${isSel ? 'text-emerald-700 font-semibold' : 'text-slate-700'}`} title={it.itemCode}>
                    {it.itemCode}
                  </span>
                  {segBadge(it.segment)}
                  <span className="font-mono text-[10px] text-slate-500 tabular-nums w-14 text-right">
                    {fmt(it.total)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Footer: selected chips */}
          {selected.length > 0 && (
            <div className="p-2 border-t border-amber-200/50 bg-amber-50/40">
              <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mb-1">
                ĐÃ CHỌN: {selected.length}/{MAX_SELECT}
              </p>
              <div className="flex flex-wrap gap-1">
                {selected.map(c => (
                  <span
                    key={c}
                    className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-mono border"
                    style={{ borderColor: colorFor(c) }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colorFor(c) }} />
                    {c.split('.').pop()}
                    <button onClick={() => toggle(c)} className="text-slate-400 hover:text-rose-500 -mr-0.5 ml-0.5">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: multi-line chart */}
        <div className="border border-amber-200/50 rounded-lg bg-white/70 p-3 min-h-[480px]">
          {selected.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              ← Chọn ít nhất 1 FSKU bên trái để xem xung nhịp
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#fde68a" vertical={false} />
                <XAxis dataKey="period" fontSize={11} stroke={COLORS.axis} />
                <YAxis tickFormatter={fmt} fontSize={11} stroke={COLORS.axis} width={50} />
                <Tooltip
                  formatter={(v: any, name: any) => [fmt(Number(v)), String(name)]}
                  contentStyle={{ fontSize: 11, borderRadius: 6, maxWidth: 260 }}
                />
                <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} iconType="line" />
                {selected.map(code => (
                  <Line
                    key={code}
                    type="monotone"
                    dataKey={code}
                    name={code}
                    stroke={colorFor(code)}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 6 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </ChartCard>
  );
}
