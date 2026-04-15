'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  fetchAccuracySkus,
  type AccuracySkuRow,
  type AccuracyMonth,
  type AccuracyWinner,
  type AccuracySort,
} from '@/lib/api/demand';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { AccuracyBadge } from '@/components/shared/accuracy-badge';
import { FskuSparkline } from './fsku-sparkline';

const fmt = (n: number | null) =>
  n === null || n === undefined ? '—' :
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` :
  n >= 1_000 ? `${(n / 1_000).toFixed(0)}K` :
  Math.round(n).toLocaleString();

const segmentBadge = (seg: string | null) => {
  if (!seg) return '—';
  const color = seg === 'A' ? 'bg-blue-100 text-blue-700'
              : seg === 'B' ? 'bg-amber-100 text-amber-700'
              : 'bg-slate-100 text-slate-600';
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${color}`}>{seg}</span>;
};

interface Props {
  /** Optional month lock from parent (e.g. trend chart click). */
  forcedMonth?: AccuracyMonth;
  onMonthChange?: (m: AccuracyMonth) => void;
}

export function FskuAccuracyTable({ forcedMonth, onMonthChange }: Props) {
  const [month, setMonth] = useState<AccuracyMonth>(forcedMonth ?? 't1');
  const [segment, setSegment] = useState<string>('');
  const [winner, setWinner] = useState<AccuracyWinner>('ALL');
  const [sortKey, setSortKey] = useState<string>('actual');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [data, setData] = useState<AccuracySkuRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (forcedMonth) setMonth(forcedMonth); }, [forcedMonth]);

  // Map sortKey+dir → BE's AccuracySort enum
  const backendSort: AccuracySort = useMemo(() => {
    if (sortKey === 'actual') return 'actual_desc';
    if (sortKey === 'gain') return 'gain_desc';
    if (sortKey === 'modelAccuracy') return sortDir === 'asc' ? 'accuracy_asc' : 'accuracy_desc';
    return 'actual_desc';
  }, [sortKey, sortDir]);

  useEffect(() => {
    setLoading(true);
    fetchAccuracySkus({ month, segment: segment || undefined, winner, sort: backendSort, page, pageSize })
      .then(r => {
        // Client-side filter by FSKU search (BE doesn't support search yet)
        const filtered = q ? r.data.filter(x => x.fsku.toLowerCase().includes(q.toLowerCase())) : r.data;
        setData(filtered);
        setTotal(q ? filtered.length : r.meta.total);
      })
      .catch(() => { setData([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [month, segment, winner, backendSort, page, pageSize, q]);

  const handleSearchChange = useCallback((s: string) => { setQ(s); setPage(1); }, []);
  const handleSortChange = useCallback((s: { key: string; dir: 'asc' | 'desc' } | null) => {
    if (s === null) { setSortKey('actual'); setSortDir('desc'); }
    else { setSortKey(s.key); setSortDir(s.dir); }
    setPage(1);
  }, []);
  const handlePageSizeChange = useCallback((s: number) => { setPageSize(s); setPage(1); }, []);

  const handleExport = () => {
    // Trigger server export if available, fallback to quick CSV of loaded page
    const header = 'fsku,segment,actualT10,actualT11,fcT12,actualT12,accT12,fcT1,actualT1,accT1,fcT2,fcT3,ma3Forecast,ma3Accuracy,winner,gain\n';
    const body = data.map(r =>
      [r.fsku, r.segment ?? '',
       r.actualT10 ?? '', r.actualT11 ?? '',
       r.fcT12 ?? '', r.actualT12 ?? '', r.accT12 ?? '',
       r.fcT1 ?? '',  r.actualT1 ?? '',  r.accT1 ?? '',
       r.fcT2 ?? '',  r.fcT3 ?? '',
       r.ma3Forecast ?? '', r.ma3Accuracy, r.winner, r.gain].join(',')
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fsku-accuracy-${month}-p${page}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // R5: full horizon — planner sees FC + Actual + Acc for T12/T1 backtests, plus live T2/T3 forecasts.
  const columns: DataTableColumn<AccuracySkuRow>[] = [
    { key: 'fsku', header: 'FSKU', sortKey: 'fsku',
      render: r => <span className="font-mono text-xs">{r.fsku}</span> },
    { key: 'segment', header: 'Seg', width: '50px', render: r => segmentBadge(r.segment) },
    // R8: historical actuals T10/T11 (WMA baseline era — planner sees the track record)
    { key: 'actualT10', header: 'Act T10', className: 'text-right',
      render: r => <span className="font-mono text-xs text-slate-500">{fmt(r.actualT10)}</span> },
    { key: 'actualT11', header: 'Act T11', className: 'text-right',
      render: r => <span className="font-mono text-xs text-slate-500">{fmt(r.actualT11)}</span> },
    // T12 block (backtest)
    { key: 'fcT12', header: 'FC T12', className: 'text-right',
      render: r => <span className="font-mono text-xs text-sky-700">{fmt(r.fcT12)}</span> },
    { key: 'actualT12', header: 'Act T12', className: 'text-right',
      render: r => <span className="font-mono text-xs">{fmt(r.actualT12)}</span> },
    { key: 'accT12', header: 'Acc T12', className: 'text-right',
      render: r => <AccuracyBadge pct={r.accT12} /> },
    // T1 block (LIVE)
    { key: 'fcT1', header: 'FC T1', className: 'text-right',
      render: r => <span className="font-mono text-xs text-sky-700">{fmt(r.fcT1)}</span> },
    { key: 'actualT1', header: 'Act T1', className: 'text-right', sortKey: 'actual',
      render: r => <span className="font-mono text-xs font-semibold">{fmt(r.actualT1)}</span> },
    { key: 'accT1', header: 'Acc T1', className: 'text-right', sortKey: 'modelAccuracy',
      render: r => <AccuracyBadge pct={r.accT1} /> },
    // Forecast-only horizon
    { key: 'fcT2', header: 'FC T2', className: 'text-right',
      render: r => <span className="font-mono text-xs text-slate-500 italic">{fmt(r.fcT2)}</span> },
    { key: 'fcT3', header: 'FC T3', className: 'text-right',
      render: r => <span className="font-mono text-xs text-slate-500 italic">{fmt(r.fcT3)}</span> },
    // QA-5: Winner column removed — row tint (rowClassName) encodes winner already.
    // Leaves one less column → less horizontal scroll on narrow screens.
  ];

  const toolbar = (
    <>
      <select value={month} onChange={e => { const m = e.target.value as AccuracyMonth; setMonth(m); setPage(1); onMonthChange?.(m); }}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs">
        <option value="t1">T1 LIVE</option>
        <option value="t12">T12</option>
        <option value="t11">T11</option>
        <option value="t10">T10</option>
      </select>
      <select value={segment} onChange={e => { setSegment(e.target.value); setPage(1); }}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs">
        <option value="">All seg</option>
        <option value="A">A</option><option value="B">B</option><option value="C">C</option>
      </select>
      <select value={winner} onChange={e => { setWinner(e.target.value as AccuracyWinner); setPage(1); }}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-xs">
        <option value="ALL">All winners</option>
        <option value="MODEL">🟢 Model</option>
        <option value="MA3">🔴 MA3</option>
      </select>
    </>
  );

  return (
    <DataTable<AccuracySkuRow>
      columns={columns}
      rows={data}
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={handlePageSizeChange}
      sort={{ key: sortKey, dir: sortDir }}
      onSortChange={handleSortChange}
      onSearchChange={handleSearchChange}
      searchPlaceholder="Search FSKU code…"
      toolbar={toolbar}
      onExport={handleExport}
      loading={loading}
      rowKey={r => r.fsku}
      rowClassName={r => r.winner === 'MODEL'
        ? 'hover:bg-emerald-50/40 border-l-2 border-l-emerald-300/70'
        : 'hover:bg-rose-50/30 border-l-2 border-l-rose-300/60'}
      renderExpanded={r => <FskuSparkline fsku={r.fsku} />}
    />
  );
}
