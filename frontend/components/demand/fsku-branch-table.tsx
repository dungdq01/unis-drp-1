'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { fetchBranchPivot, type BranchPivotRow } from '@/lib/api/demand';
import { FskuBranchHeartbeat } from './fsku-branch-heartbeat';

const fmt = (n: number | null | undefined) =>
  n == null ? '—' :
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
  snapshotId?: string;
  /** Dropdown list of branches (pre-fetched from /forecast/branches endpoint). */
  branchOptions?: { locationCode: string; locationName: string }[];
}

/**
 * R11 + Task 2: FSKU × Branch detail table.
 * - Branch dropdown filter (R11)
 * - locationName column (R11)
 * - Row expand → heartbeat chart visualizing forecast qty across periods (Task 3)
 */
export function FskuBranchTable({ snapshotId, branchOptions = [] }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [branch, setBranch] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<BranchPivotRow[]>([]);
  const [periods, setPeriods] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchBranchPivot({
      snapshotId,
      locationCode: branch || undefined,
      itemCode: q || undefined,
      page, pageSize,
    })
      .then(r => { setRows(r.data); setPeriods(r.periods); setTotal(r.meta.total); })
      .catch(() => { setRows([]); setPeriods([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [snapshotId, branch, q, page, pageSize]);

  const handleSearchChange = useCallback((s: string) => { setQ(s); setPage(1); }, []);
  const handlePageSizeChange = useCallback((s: number) => { setPageSize(s); setPage(1); }, []);

  const handleExport = () => {
    const header = ['itemCode', 'locationCode', 'locationName', 'segment', ...periods, 'total'].join(',') + '\n';
    const body = rows.map(r =>
      [r.itemCode, r.locationCode, `"${r.locationName}"`, r.segment ?? '',
       ...periods.map(p => r.periods[p] ?? ''), r.total].join(',')
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `fsku-branch-pivot-p${page}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const periodCols: DataTableColumn<BranchPivotRow>[] = useMemo(() => periods.map(p => ({
    key: `p_${p}`,
    header: p,
    className: 'text-right',
    render: (r: BranchPivotRow) => <span className="font-mono text-xs">{fmt(r.periods[p] ?? 0)}</span>,
  })), [periods]);

  const columns: DataTableColumn<BranchPivotRow>[] = [
    { key: 'itemCode', header: 'FSKU',
      render: r => <span className="font-mono text-xs">{r.itemCode}</span> },
    { key: 'locationCode', header: 'Branch', width: '80px',
      render: r => <span className="font-mono text-xs text-slate-600">{r.locationCode}</span> },
    { key: 'locationName', header: 'Chi nhánh',
      render: r => <span className="text-xs text-slate-700 truncate max-w-[180px] inline-block" title={r.locationName}>{r.locationName}</span> },
    { key: 'segment', header: 'Seg', width: '50px', render: r => segmentBadge(r.segment) },
    ...periodCols,
    { key: 'total', header: 'Total', className: 'text-right',
      render: r => <span className="font-mono text-xs font-semibold text-sky-700">{fmt(r.total)}</span> },
  ];

  const toolbar = (
    <>
      {branchOptions.length > 0 ? (
        <select
          value={branch}
          onChange={e => { setBranch(e.target.value); setPage(1); }}
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs min-w-[160px]"
        >
          <option value="">All branches ({branchOptions.length})</option>
          {branchOptions.map(b => (
            <option key={b.locationCode} value={b.locationCode}>
              {b.locationCode} — {b.locationName.slice(0, 30)}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={branch}
          onChange={e => { setBranch(e.target.value); setPage(1); }}
          placeholder="Branch code…"
          className="rounded-md border border-slate-200 px-2 py-1.5 text-xs w-28"
        />
      )}
    </>
  );

  return (
    <DataTable<BranchPivotRow>
      columns={columns}
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={handlePageSizeChange}
      onSearchChange={handleSearchChange}
      searchPlaceholder="Search FSKU…"
      toolbar={toolbar}
      onExport={handleExport}
      loading={loading}
      rowKey={r => `${r.itemCode}-${r.locationCode}`}
      renderExpanded={r => (
        <FskuBranchHeartbeat
          fsku={r.itemCode}
          locationCode={r.locationCode}
          locationName={r.locationName}
          segment={r.segment}
          periods={periods}
          periodQty={r.periods}
          total={r.total}
        />
      )}
    />
  );
}
