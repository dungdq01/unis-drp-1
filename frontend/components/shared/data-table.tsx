'use client';

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react';

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  /** How to render the cell. Return `null` to use default `row[key]` render. */
  render?: (row: T) => ReactNode;
  /** Sort key sent to server; omit = not sortable. */
  sortKey?: string;
  /** th/td extra className (alignment etc.). */
  className?: string;
  /** Header width hint (css class or px). */
  width?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  /** Total row count (server-side total, not `rows.length`). */
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** Current sort: `sortKey` + direction — optional server-side sort. */
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSortChange?: (sort: { key: string; dir: 'asc' | 'desc' } | null) => void;
  /** Text search input — debounced 300ms before fire. */
  onSearchChange?: (q: string) => void;
  searchPlaceholder?: string;
  /** Extra toolbar slot (filters etc.) */
  toolbar?: ReactNode;
  /** Export button → fires callback with current filter set. */
  onExport?: () => void;
  /** Loading overlay */
  loading?: boolean;
  /** Row key for React */
  rowKey: (row: T) => string;
  /** Optional row expansion: return content or null for no expand */
  renderExpanded?: (row: T) => ReactNode;
  /** Optional row className (e.g. for winner color) */
  rowClassName?: (row: T) => string;
  pageSizeOptions?: number[];
}

/**
 * Professional reusable data table. Server-side pagination + sort + search.
 * Spec: MODULE-1-FULL-IMPLEMENT §Row 5 (Tab 1 FSKU Table).
 */
export function DataTable<T>({
  columns, rows, total, page, pageSize,
  onPageChange, onPageSizeChange,
  sort, onSortChange,
  onSearchChange, searchPlaceholder = 'Search…',
  toolbar, onExport, loading = false,
  rowKey, renderExpanded, rowClassName,
  pageSizeOptions = [25, 50, 100],
}: DataTableProps<T>) {
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  // Stable ref to latest onSearchChange — avoids firing the debounce on every re-render
  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => { onSearchChangeRef.current = onSearchChange; });

  // Debounced search: 300ms — only fires when `q` changes, not when callback identity changes
  useEffect(() => {
    if (!onSearchChangeRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChangeRef.current?.(q), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const handleSort = (col: DataTableColumn<T>) => {
    if (!col.sortKey || !onSortChange) return;
    if (sort?.key === col.sortKey) {
      // toggle
      onSortChange(sort.dir === 'desc' ? { key: col.sortKey, dir: 'asc' } : null);
    } else {
      onSortChange({ key: col.sortKey, dir: 'desc' });
    }
  };

  const sortArrow = (col: DataTableColumn<T>) => {
    if (!col.sortKey) return '';
    if (sort?.key !== col.sortKey) return col.sortKey ? ' ↕' : '';
    return sort.dir === 'desc' ? ' ↓' : ' ↑';
  };

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Jump page number list: 1...current±2...total
  const pagesToShow = useMemo(() => {
    const max = totalPages;
    if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
    const arr: (number | '…')[] = [1];
    const start = Math.max(2, page - 2);
    const end = Math.min(max - 1, page + 2);
    if (start > 2) arr.push('…');
    for (let i = start; i <= end; i++) arr.push(i);
    if (end < max - 1) arr.push('…');
    arr.push(max);
    return arr;
  }, [page, totalPages]);

  return (
    <div className="glass-card overflow-hidden">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-3 flex-wrap">
        {onSearchChange && (
          <div className="relative">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8 pr-3 py-1.5 rounded-md border border-slate-200 text-sm w-56"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          </div>
        )}
        {toolbar}
        <div className="flex-1" />
        <span className="text-xs text-slate-500">{total.toLocaleString()} rows</span>
        {onExport && (
          <button
            onClick={onExport}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-sky-700 border border-sky-200 hover:bg-sky-50"
          >
            Export CSV ⬇
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto relative">
        {loading && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-10">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        )}
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white/95 backdrop-blur z-10">
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              {renderExpanded && <th className="w-8 px-2 py-2"></th>}
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 ${col.className ?? ''} ${col.sortKey ? 'cursor-pointer select-none hover:text-slate-600' : ''}`}
                  style={col.width ? { width: col.width } : undefined}
                  onClick={() => col.sortKey && handleSort(col)}
                >
                  {col.header}{sortArrow(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={columns.length + (renderExpanded ? 1 : 0)} className="px-4 py-10 text-center text-sm text-slate-400">
                  No data
                </td>
              </tr>
            )}
            {rows.map(row => {
              const k = rowKey(row);
              const isOpen = expanded.has(k);
              const rowCls = rowClassName?.(row) ?? '';
              return (
                <>
                  <tr key={k} className={`border-b border-[rgba(148,173,215,0.08)] ${rowCls}`}>
                    {renderExpanded && (
                      <td className="w-8 px-2 py-2 text-center">
                        <button
                          onClick={() => toggleExpand(k)}
                          className="w-5 h-5 rounded hover:bg-slate-100 text-slate-400 text-xs"
                        >
                          {isOpen ? '▾' : '▸'}
                        </button>
                      </td>
                    )}
                    {columns.map(col => (
                      <td key={col.key} className={`px-4 py-2 ${col.className ?? ''}`}>
                        {col.render ? col.render(row) : String((row as any)[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                  {renderExpanded && isOpen && (
                    <tr key={`${k}-exp`} className="bg-slate-50/50">
                      <td></td>
                      <td colSpan={columns.length} className="px-4 py-3">
                        {renderExpanded(row)}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-5 py-2 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between text-xs flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">
            Page {page} / {totalPages} · {total.toLocaleString()} total
          </span>
          {onPageSizeChange && (
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="ml-2 rounded border border-slate-200 px-2 py-0.5"
            >
              {pageSizeOptions.map(o => <option key={o} value={o}>{o}/page</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >◀</button>
          {pagesToShow.map((p, i) =>
            p === '…' ? (
              <span key={`e${i}`} className="px-1 text-slate-400">…</span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                className={`min-w-[28px] px-2 py-1 rounded border ${p === page ? 'bg-sky-500 text-white border-sky-500' : 'border-slate-200 hover:bg-slate-50'}`}
              >{p}</button>
            )
          )}
          <button
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
          >▶</button>
        </div>
      </div>
    </div>
  );
}
