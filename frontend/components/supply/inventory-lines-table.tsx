'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  fetchSnapshotLines, fetchGroupedByItem, fetchGroupedByLocation, overrideLine,
  type SupplySnapshotLine, type SnapshotLinesMeta,
  type GroupedItemRow, type GroupedLocationRow,
} from '@/lib/api/supply';
import { LineOverrideDialog } from './line-override-dialog';

interface Props { snapshotId: string }

type ViewMode = 'byItem' | 'byLocation' | 'flat';

// ─── Shared helpers ────────────────────────────────────────────────────────────

function FreshBadge({ stale }: { stale: boolean }) {
  return stale
    ? <span title="STALE" className="text-amber-400 text-xs">⚠</span>
    : <span title="PASS" className="text-emerald-400 text-xs">✓</span>;
}

function QtyCell({ value, override }: { value: number; override?: number | null }) {
  if (override != null)
    return <span className="font-bold text-sky-600 tabular-nums text-xs">{override.toLocaleString()}</span>;
  return <span className="font-semibold text-slate-800 tabular-nums text-xs">{value.toLocaleString()}</span>;
}

function Pagination({ meta, page, onPage, loading }: {
  meta: SnapshotLinesMeta; page: number; onPage: (p: number) => void; loading: boolean;
}) {
  return (
    <div className="px-4 py-2.5 border-t border-[rgba(148,173,215,0.12)] flex items-center justify-between flex-shrink-0">
      <span className="text-xs text-slate-500">
        {meta.page} / {meta.totalPages} trang · {meta.total.toLocaleString()} tổng
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1 || loading}
          className="rounded px-3 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40">Prev</button>
        <button onClick={() => onPage(Math.min(meta.totalPages, page + 1))} disabled={page >= meta.totalPages || loading}
          className="rounded px-3 py-1 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

// ─── Expandable detail rows (lines for a specific item or location) ────────────

function DetailLines({
  snapshotId, filter, onOverrideClick,
}: {
  snapshotId: string;
  filter: { itemCode?: string; locationCode?: string };
  onOverrideClick: (line: SupplySnapshotLine) => void;
}) {
  const [lines, setLines] = useState<SupplySnapshotLine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchSnapshotLines(snapshotId, { ...filter, pageSize: 200 })
      .then((r) => setLines(r.data))
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  }, [snapshotId, filter.itemCode, filter.locationCode]);

  if (loading) return (
    <tr><td colSpan={6} className="pl-10 py-2 text-xs text-slate-400 animate-pulse">Đang tải...</td></tr>
  );

  return (
    <>
      {lines.map((line) => (
        <tr key={line.id} className="border-b border-[rgba(148,173,215,0.05)] hover:bg-sky-50/10 transition-colors">
          <td className="pl-10 pr-4 py-1.5 font-mono text-xs text-slate-600">
            {filter.itemCode ? line.locationCode : line.itemCode}
          </td>
          <td className="px-4 py-1.5 text-right">
            <QtyCell value={Number(line.allocatableQty)} override={line.overrideQty != null ? Number(line.overrideQty) : null} />
          </td>
          <td className="px-4 py-1.5 text-right tabular-nums text-xs text-slate-500">{Number(line.reservedQty).toLocaleString()}</td>
          <td className="px-4 py-1.5 text-right tabular-nums text-xs text-slate-500">{Number(line.inTransitQty).toLocaleString()}</td>
          <td className="px-4 py-1.5 text-center"><FreshBadge stale={line.freshness === 'STALE'} /></td>
          <td className="px-4 py-1.5 text-center">
            <button onClick={(e) => { e.stopPropagation(); onOverrideClick(line); }}
              className="rounded px-2 py-0.5 text-xs font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 border border-sky-200">
              Override
            </button>
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── By Item view ──────────────────────────────────────────────────────────────

function ByItemView({ snapshotId, onOverrideClick, search }: {
  snapshotId: string;
  onOverrideClick: (line: SupplySnapshotLine) => void;
  search: string;
}) {
  const [rows, setRows] = useState<GroupedItemRow[]>([]);
  const [meta, setMeta] = useState<SnapshotLinesMeta>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (code: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(code) ? next.delete(code) : next.add(code);
    return next;
  });

  const load = useCallback((p: number, q: string) => {
    setLoading(true);
    fetchGroupedByItem(snapshotId, { page: p, pageSize: 50, itemCode: q || undefined })
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [snapshotId]);

  useEffect(() => { setPage(1); load(1, search); }, [search, load]);
  useEffect(() => { load(page, search); }, [page]);

  return (
    <>
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] bg-slate-50/60">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Item Code</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Alloc. Qty</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Reserved</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">In-Transit</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Fresh</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wide w-24">Kho</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400 animate-pulse">Đang tải...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">Không có dữ liệu</td></tr>
            ) : rows.map((row) => (
              <React.Fragment key={row.itemCode}>
                {/* Group header */}
                <tr
                  onClick={() => toggle(row.itemCode)}
                  className="cursor-pointer bg-amber-50/50 hover:bg-amber-100/60 border-b border-[rgba(148,173,215,0.12)] select-none transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-[10px] w-3">{expanded.has(row.itemCode) ? '▼' : '▶'}</span>
                      <span className="font-semibold text-sm text-slate-800 font-mono">{row.itemCode}</span>
                      <span className="text-xs text-slate-400">· {row.locationCount} kho</span>
                      {row.hasOverride && <span className="text-[10px] text-sky-500">✏</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-sm text-slate-800">
                    {row.allocatableQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-500">{row.reservedQty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-500">{row.inTransitQty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-center"><FreshBadge stale={row.hasStale} /></td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{row.locationCount}</span>
                  </td>
                </tr>
                {/* Detail lines */}
                {expanded.has(row.itemCode) && (
                  <DetailLines
                    snapshotId={snapshotId}
                    filter={{ itemCode: row.itemCode }}
                    onOverrideClick={onOverrideClick}
                  />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination meta={meta} page={page} onPage={setPage} loading={loading} />
    </>
  );
}

// ─── By Location view ──────────────────────────────────────────────────────────

function ByLocationView({ snapshotId, onOverrideClick, search }: {
  snapshotId: string;
  onOverrideClick: (line: SupplySnapshotLine) => void;
  search: string;
}) {
  const [rows, setRows] = useState<GroupedLocationRow[]>([]);
  const [meta, setMeta] = useState<SnapshotLinesMeta>({ page: 1, pageSize: 50, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (code: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(code) ? next.delete(code) : next.add(code);
    return next;
  });

  const load = useCallback((p: number, q: string) => {
    setLoading(true);
    fetchGroupedByLocation(snapshotId, { page: p, pageSize: 50, locationCode: q || undefined })
      .then((r) => { setRows(r.data); setMeta(r.meta); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [snapshotId]);

  useEffect(() => { setPage(1); load(1, search); }, [search, load]);
  useEffect(() => { load(page, search); }, [page]);

  return (
    <>
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] bg-slate-50/60">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Mã Kho</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Alloc. Qty</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Reserved</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">In-Transit</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Fresh</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wide w-24">Items</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400 animate-pulse">Đang tải...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-sm text-slate-400">Không có dữ liệu</td></tr>
            ) : rows.map((row) => (
              <React.Fragment key={row.locationCode}>
                <tr
                  onClick={() => toggle(row.locationCode)}
                  className="cursor-pointer bg-sky-50/50 hover:bg-sky-100/60 border-b border-[rgba(148,173,215,0.12)] select-none transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 text-[10px] w-3">{expanded.has(row.locationCode) ? '▼' : '▶'}</span>
                      <span className="font-semibold text-sm text-slate-800 font-mono">{row.locationCode}</span>
                      {row.locationName && (
                        <span className="text-xs text-slate-500 truncate max-w-xs" title={row.locationName}>
                          — {row.locationName}
                        </span>
                      )}
                      <span className="text-xs text-slate-400 flex-shrink-0">· {row.itemCount} mã hàng</span>
                      {row.hasOverride && <span className="text-[10px] text-sky-500 flex-shrink-0">✏</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-sm text-slate-800">
                    {row.allocatableQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-500">{row.reservedQty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-500">{row.inTransitQty.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-center"><FreshBadge stale={row.hasStale} /></td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{row.itemCount}</span>
                  </td>
                </tr>
                {expanded.has(row.locationCode) && (
                  <DetailLines
                    snapshotId={snapshotId}
                    filter={{ locationCode: row.locationCode }}
                    onOverrideClick={onOverrideClick}
                  />
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination meta={meta} page={page} onPage={setPage} loading={loading} />
    </>
  );
}

// ─── Flat view ─────────────────────────────────────────────────────────────────

function FlatView({ snapshotId, onOverrideClick }: {
  snapshotId: string;
  onOverrideClick: (line: SupplySnapshotLine) => void;
}) {
  const [lines, setLines] = useState<SupplySnapshotLine[]>([]);
  const [meta, setMeta] = useState<SnapshotLinesMeta>({ page: 1, pageSize: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [itemCode, setItemCode] = useState('');
  const [locCode, setLocCode] = useState('');
  const [freshness, setFreshness] = useState<'all' | 'PASS' | 'STALE'>('all');
  const itemRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dItem, setDItem] = useState('');
  const [dLoc,  setDLoc]  = useState('');

  const load = useCallback((p: number, di: string, dl: string, fr: string) => {
    setLoading(true);
    fetchSnapshotLines(snapshotId, {
      page: p, pageSize: 20,
      itemCode: di || undefined,
      locationCode: dl || undefined,
      freshness: fr !== 'all' ? fr as any : undefined,
    })
      .then((r) => { setLines(r.data); setMeta(r.meta); })
      .catch(() => setLines([]))
      .finally(() => setLoading(false));
  }, [snapshotId]);

  useEffect(() => { load(page, dItem, dLoc, freshness); }, [page, dItem, dLoc, freshness, load]);

  const debounce = (ref: React.MutableRefObject<any>, setter: (v: string) => void, v: string) => {
    if (ref.current) clearTimeout(ref.current);
    ref.current = setTimeout(() => { setter(v); setPage(1); }, 300);
  };

  return (
    <>
      {/* Flat-specific filters */}
      <div className="px-4 py-2 border-b border-[rgba(148,173,215,0.10)] flex gap-2 flex-wrap items-center">
        <input type="text" placeholder="Mã hàng..." value={itemCode}
          onChange={(e) => { setItemCode(e.target.value); debounce(itemRef, setDItem, e.target.value); }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs w-36 focus:outline-none focus:ring-2 focus:ring-sky-300" />
        <input type="text" placeholder="Mã kho..." value={locCode}
          onChange={(e) => { setLocCode(e.target.value); debounce(locRef, setDLoc, e.target.value); }}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-sky-300" />
        <select value={freshness} onChange={(e) => { setFreshness(e.target.value as any); setPage(1); }}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-300">
          <option value="all">Freshness: All</option>
          <option value="PASS">PASS</option>
          <option value="STALE">STALE</option>
        </select>
        {loading && <span className="text-xs text-slate-400 animate-pulse">Đang tải...</span>}
      </div>
      <div className="overflow-x-auto flex-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] bg-slate-50/60">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Item Code</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Kho</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Alloc. Qty</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Reserved</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">In-Transit</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Fresh</th>
              <th className="px-4 py-2 text-center text-xs font-medium text-slate-500 uppercase tracking-wide">Override</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && !loading ? (
              <tr><td colSpan={7} className="py-10 text-center text-sm text-slate-400">Không có dữ liệu</td></tr>
            ) : lines.map((line) => (
              <tr key={line.id} className="border-b border-[rgba(148,173,215,0.06)] hover:bg-sky-50/20 transition-colors">
                <td className="px-4 py-2 font-mono text-xs text-slate-700">{line.itemCode}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">{line.locationCode}</td>
                <td className="px-4 py-2 text-right">
                  <QtyCell value={Number(line.allocatableQty)} override={line.overrideQty != null ? Number(line.overrideQty) : null} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">{Number(line.reservedQty).toLocaleString()}</td>
                <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-500">{Number(line.inTransitQty).toLocaleString()}</td>
                <td className="px-4 py-2 text-center"><FreshBadge stale={line.freshness === 'STALE'} /></td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => onOverrideClick(line)}
                    className="rounded px-2 py-0.5 text-xs font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 border border-sky-200">
                    Override
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination meta={meta} page={page} onPage={setPage} loading={loading} />
    </>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function InventoryLinesTable({ snapshotId }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('byItem');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedLine, setSelectedLine] = useState<SupplySnapshotLine | null>(null);
  const [showOverride, setShowOverride] = useState(false);

  const handleSearchChange = (v: string) => {
    setSearchInput(v);
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => setSearch(v), 300);
  };

  const handleOverride = async (lineId: string, qty: number, reason: string) => {
    await overrideLine(lineId, qty, reason);
    // Reload handled by child re-mount or user refresh
  };

  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    setSearch('');
    setSearchInput('');
  };

  return (
    <div className="glass-card overflow-hidden flex flex-col h-full">

      {/* ─── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-2.5 border-b border-[rgba(148,173,215,0.15)] flex items-center gap-2 flex-wrap">
        {/* Search — context-aware label */}
        <input
          type="text"
          placeholder={viewMode === 'byItem' ? 'Tìm mã hàng...' : viewMode === 'byLocation' ? 'Tìm mã kho...' : 'Tìm...'}
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400 w-40"
        />

        {/* View toggle */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 bg-slate-50">
          {([
            { mode: 'byItem' as ViewMode, label: 'By Item' },
            { mode: 'byLocation' as ViewMode, label: 'By Kho' },
            { mode: 'flat' as ViewMode, label: 'Flat' },
          ]).map(({ mode, label }) => (
            <button key={mode} onClick={() => handleViewChange(mode)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                viewMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Content ──────────────────────────────────────────────────────── */}
      {viewMode === 'byItem' && (
        <ByItemView key={snapshotId + '-item'} snapshotId={snapshotId} onOverrideClick={(l) => { setSelectedLine(l); setShowOverride(true); }} search={search} />
      )}
      {viewMode === 'byLocation' && (
        <ByLocationView key={snapshotId + '-loc'} snapshotId={snapshotId} onOverrideClick={(l) => { setSelectedLine(l); setShowOverride(true); }} search={search} />
      )}
      {viewMode === 'flat' && (
        <FlatView key={snapshotId + '-flat'} snapshotId={snapshotId} onOverrideClick={(l) => { setSelectedLine(l); setShowOverride(true); }} />
      )}

      <LineOverrideDialog
        open={showOverride}
        line={selectedLine}
        onClose={() => { setShowOverride(false); setSelectedLine(null); }}
        onOverride={handleOverride}
      />
    </div>
  );
}
