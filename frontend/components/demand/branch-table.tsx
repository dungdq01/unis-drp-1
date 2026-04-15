'use client';

import { useState, useMemo, Fragment } from 'react';
import type { BranchBreakdown, ArchetypeSummary } from '@/lib/api/demand';
import { BranchDrillPanel } from './branch-drill-panel';

interface Props {
  branches: BranchBreakdown[];
  /** Kept optional for backward-compat with callers; archetype cards were removed */
  byArchetype?: ArchetypeSummary[];
  /** R9: When user expands a row the panel fetches /branch-summary. */
  snapshotId?: string;
  /** Optional click-only handler for external filter (unused when expand enabled). */
  onBranchClick?: (locationCode: string) => void;
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : Math.round(n).toLocaleString();

type SortKey = 'totalQty' | 'itemCount' | 'locationCode';

export function BranchTable({ branches, snapshotId, onBranchClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('totalQty');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (code: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(code)) next.delete(code); else next.add(code);
    return next;
  });
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const sorted = useMemo(() => {
    const arr = [...branches];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return dir === 'desc' ? bv - av : av - bv;
      return dir === 'desc' ? String(bv).localeCompare(String(av)) : String(av).localeCompare(String(bv));
    });
    return arr;
  }, [branches, sortKey, dir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setDir(dir === 'desc' ? 'asc' : 'desc');
    else { setSortKey(k); setDir('desc'); }
  };

  const sortArrow = (k: SortKey) => sortKey === k ? (dir === 'desc' ? ' ↓' : ' ↑') : '';

  return (
    <div className="space-y-3">
      {/* Archetype summary cards removed — redundant with Type column in table below */}

      {/* Branch table */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)]">
          <p className="section-label">Branch Breakdown</p>
          <p className="text-xs text-slate-500 mt-0.5">{branches.length} branches</p>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white/80 backdrop-blur">
              <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
                <th className="w-8 px-2 py-2"></th>
                <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 cursor-pointer" onClick={() => toggleSort('locationCode')}>
                  Branch{sortArrow('locationCode')}
                </th>
                <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Region</th>
                <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Type</th>
                <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right cursor-pointer" onClick={() => toggleSort('itemCount')}>
                  Items{sortArrow('itemCount')}
                </th>
                <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right cursor-pointer" onClick={() => toggleSort('totalQty')}>
                  Total{sortArrow('totalQty')}
                </th>
                <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Tết</th>
                <th className="px-5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Top Seg</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-8 text-center text-sm text-slate-400">No branches</td></tr>
              )}
              {sorted.map(b => {
                const isOpen = expanded.has(b.locationCode);
                return <Fragment key={b.locationCode}>
                <tr
                  className="border-b border-[rgba(148,173,215,0.08)] hover:bg-sky-50/40"
                >
                  <td className="w-8 px-2 py-2 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(b.locationCode); }}
                      className="w-5 h-5 rounded hover:bg-slate-100 text-slate-400 text-xs"
                      title={isOpen ? 'Collapse' : 'Drill down'}
                    >
                      {isOpen ? '▾' : '▸'}
                    </button>
                  </td>
                  <td onClick={() => onBranchClick?.(b.locationCode)} className={`px-5 py-2 font-mono text-xs text-slate-700 ${onBranchClick ? 'cursor-pointer' : ''}`} title={b.locationName}>{b.locationCode}</td>
                  <td className="px-5 py-2 text-xs text-slate-500">{b.region}</td>
                  <td className="px-5 py-2 text-xs text-slate-500">{b.branchArchetype}</td>
                  <td className="px-5 py-2 text-right font-mono text-xs">{b.itemCount.toLocaleString()}</td>
                  <td className="px-5 py-2 text-right font-mono text-xs font-semibold">{fmt(b.totalQty)}</td>
                  <td className="px-5 py-2 text-right font-mono text-xs text-amber-700">{fmt(b.tetQty)}</td>
                  <td className="px-5 py-2 font-semibold text-xs">{b.topSegment}</td>
                </tr>
                {isOpen && (
                  <tr key={`${b.locationCode}-exp`} className="bg-slate-50/50">
                    <td></td>
                    <td colSpan={7} className="px-5">
                      <BranchDrillPanel locationCode={b.locationCode} snapshotId={snapshotId} />
                    </td>
                  </tr>
                )}
                </Fragment>;
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
