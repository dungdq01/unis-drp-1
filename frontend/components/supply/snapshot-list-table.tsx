'use client';

import { type SupplySnapshot } from '@/lib/api/supply';

interface Props {
  snapshots: SupplySnapshot[];
  onSelect: (id: string) => void;
  onFreeze: (id: string) => void;
  selectedId?: string;
}

function StatusBadge({ status }: { status: SupplySnapshot['status'] }) {
  const map: Record<SupplySnapshot['status'], string> = {
    DRAFT: 'bg-slate-100 text-slate-600 border-slate-200',
    FROZEN: 'bg-blue-100 text-blue-700 border-blue-200',
    ARCHIVED: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${map[status]}`}>
      {status}
    </span>
  );
}

function FreshnessBadge({ freshness }: { freshness: 'PASS' | 'STALE' }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${
        freshness === 'PASS'
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
          : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}
    >
      {freshness === 'PASS' ? '✅ PASS' : '⚠️ STALE'}
    </span>
  );
}

function formatQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SnapshotListTable({ snapshots, onSelect, onFreeze, selectedId }: Props) {
  const canFreeze = (s: SupplySnapshot) =>
    s.status === 'DRAFT' && (s.freshness === 'PASS' || s.staleAcknowledged);

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)] flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Snapshot List</h2>
          <p className="text-xs text-slate-500">{snapshots.length} snapshots</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[rgba(148,173,215,0.12)] bg-slate-50/50">
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Name</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Status</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Freshness</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Lines</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Items</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-slate-500 uppercase tracking-wide">Alloc. Qty</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Captured At</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-400">
                  Chưa có snapshot nào
                </td>
              </tr>
            )}
            {snapshots.map((s) => (
              <tr
                key={s.id}
                className={`border-b border-[rgba(148,173,215,0.08)] hover:bg-sky-50/30 transition-colors ${
                  selectedId === s.id ? 'bg-sky-50 border-l-2 border-l-sky-500' : ''
                }`}
              >
                <td className="px-4 py-2.5">
                  <span className="text-sm font-medium text-slate-800">{s.snapshotName}</span>
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={s.status} />
                </td>
                <td className="px-4 py-2.5">
                  <FreshnessBadge freshness={s.freshness} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{s.totalLines.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{s.totalItems.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-800">{formatQty(s.totalAllocatableQty)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(s.captureAt)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => onSelect(s.id)}
                      className="rounded px-2.5 py-1 text-xs font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 border border-sky-200 transition-colors"
                    >
                      View
                    </button>
                    {canFreeze(s) && (
                      <button
                        onClick={() => onFreeze(s.id)}
                        className="rounded px-2.5 py-1 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
                      >
                        Freeze
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
