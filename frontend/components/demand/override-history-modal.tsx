'use client';

import { useEffect, useState } from 'react';
import { fetchOverrideHistory, type OverrideLog } from '@/lib/api/demand';

interface Props {
  open: boolean;
  onClose: () => void;
  snapshotId?: string;
  itemCode?: string;
}

/**
 * FE-T9: Override history modal. Shows audit trail of reconciled_qty changes
 * for a snapshot (optionally filtered by itemCode).
 */
export function OverrideHistoryModal({ open, onClose, snapshotId, itemCode }: Props) {
  const [logs, setLogs] = useState<OverrideLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchOverrideHistory({ snapshotId, itemCode, page: 1 })
      .then(r => setLogs(r.data))
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [open, snapshotId, itemCode]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
      <div className="glass-card w-full max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)] flex items-center justify-between">
          <div>
            <p className="section-label">Override History</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {itemCode ? `Item: ${itemCode}` : 'All overrides'} {snapshotId ? `· Snapshot ${snapshotId.slice(0, 8)}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
        </div>
        <div className="overflow-auto flex-1">
          {loading ? (
            <p className="p-10 text-center text-sm text-slate-400">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="p-10 text-center text-sm text-slate-400">No overrides yet</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white/80 backdrop-blur">
                <tr className="border-b border-[rgba(148,173,215,0.12)] text-left">
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">When</th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Item</th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Loc</th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Period</th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">Old</th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 text-right">New</th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">By</th>
                  <th className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Reason</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-b border-[rgba(148,173,215,0.08)]">
                    <td className="px-4 py-2 text-xs text-slate-500">{new Date(l.createdAt).toLocaleString('vi-VN')}</td>
                    <td className="px-4 py-2 font-mono text-xs">{l.itemCode}</td>
                    <td className="px-4 py-2 font-mono text-xs">{l.locationCode}</td>
                    <td className="px-4 py-2 text-xs">{String(l.periodStart).slice(0, 10)}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-slate-600">{Number(l.oldQty).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-sky-700 font-semibold">{Number(l.newQty).toLocaleString()}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{l.overriddenBy}</td>
                    <td className="px-4 py-2 text-xs text-slate-500 max-w-[200px] truncate" title={l.reason}>{l.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
