'use client';

import { cn } from '@/lib/utils';
import type { Snapshot } from '@/lib/api/demand';

interface SnapshotTableProps {
  snapshots: Snapshot[];
  onSelect: (id: string) => void;
  onFreeze: (id: string) => void;
  onDelete?: (id: string) => void;
  onArchive?: (id: string) => void;
}

export function SnapshotTable({ snapshots, onSelect, onFreeze, onDelete, onArchive }: SnapshotTableProps) {
  const statusBadge = (status: string) => {
    if (status === 'FROZEN') return 'badge-sky';
    if (status === 'ARCHIVED') return 'bg-slate-200 text-slate-600';
    return 'badge-amber';
  };
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)]">
        <p className="section-label">Snapshots</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Name / Run ID</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 text-right">Scale</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Horizon</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Created by</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Frozen At</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-slate-400 text-sm">
                  No snapshots yet
                </td>
              </tr>
            )}
            {snapshots.map((s) => (
              <tr
                key={s.id}
                className="border-b border-[rgba(148,173,215,0.08)] hover:bg-sky-50/30 transition-colors"
              >
                <td className="px-5 py-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-700 font-medium truncate max-w-[220px]" title={s.snapshotName || ''}>
                      {s.snapshotName || '—'}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">{s.runId || s.id.slice(0, 8)}</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide',
                      statusBadge(s.status)
                    )}
                  >
                    {s.status}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <div className="flex flex-col items-end text-[10px] font-mono leading-tight text-slate-600">
                    <span className="text-slate-700 font-semibold">{s.totalLines.toLocaleString()} lines</span>
                    <span className="text-slate-400">{s.totalItems.toLocaleString()} items · {(s.totalLocations ?? 0)} locs</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-slate-500 whitespace-nowrap">
                  {s.horizonStart && s.horizonEnd
                    ? `${String(s.horizonStart).slice(0, 7)} → ${String(s.horizonEnd).slice(0, 7)}`
                    : '—'}
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  <div className="flex flex-col">
                    <span>{s.createdBy || '—'}</span>
                    <span className="text-[10px] text-slate-400">{new Date(s.createdAt).toLocaleDateString('vi-VN')}</span>
                  </div>
                </td>
                <td className="px-5 py-3 text-xs text-slate-500">
                  {s.status === 'FROZEN' && s.frozenAt
                    ? new Date(s.frozenAt).toLocaleDateString('vi-VN')
                    : '—'}
                </td>
                <td className="px-5 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => onSelect(s.id)}
                      className="rounded-md px-2.5 py-1 text-[11px] font-medium text-sky-600 hover:bg-sky-50 border border-sky-200 transition-colors"
                    >
                      View
                    </button>
                    {s.status === 'DRAFT' && s.totalLines > 0 && (
                      <button
                        onClick={() => onFreeze(s.id)}
                        className="rounded-md px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-50 border border-amber-200 transition-colors"
                      >
                        Freeze
                      </button>
                    )}
                    {s.status === 'DRAFT' && onDelete && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete snapshot ${s.runId ?? s.id.slice(0,8)}? Lines will be removed.`)) onDelete(s.id);
                        }}
                        className="rounded-md px-2.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 border border-rose-200 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                    {s.status === 'FROZEN' && onArchive && (
                      <button
                        onClick={() => {
                          if (confirm(`Archive snapshot ${s.runId ?? s.id.slice(0,8)}?`)) onArchive(s.id);
                        }}
                        className="rounded-md px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 border border-slate-300 transition-colors"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
