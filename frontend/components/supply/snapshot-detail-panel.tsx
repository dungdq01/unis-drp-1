'use client';

import { type SupplySnapshot } from '@/lib/api/supply';

interface Props {
  snapshot: SupplySnapshot | null;
}

function formatQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function StatusBadge({ status }: { status: SupplySnapshot['status'] }) {
  const map: Record<SupplySnapshot['status'], string> = {
    DRAFT: 'bg-slate-100 text-slate-600 border-slate-200',
    FROZEN: 'bg-blue-100 text-blue-700 border-blue-200',
    ARCHIVED: 'bg-gray-100 text-gray-500 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold border ${map[status]}`}>
      {status}
    </span>
  );
}

interface MetricRowProps { label: string; value: React.ReactNode }
function MetricRow({ label, value }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-xs font-semibold text-slate-800 tabular-nums">{value}</span>
    </div>
  );
}

export function SnapshotDetailPanel({ snapshot }: Props) {
  if (!snapshot) {
    return (
      <div className="glass-card flex items-center justify-center py-16">
        <p className="text-sm text-slate-400">Chọn snapshot để xem chi tiết</p>
      </div>
    );
  }

  return (
    <div className="glass-card px-5 py-4 space-y-4 h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{snapshot.snapshotName}</h3>
          <p className="text-xs text-slate-400 mt-0.5">Captured: {formatDate(snapshot.captureAt)}</p>
        </div>
        <StatusBadge status={snapshot.status} />
      </div>

      {/* KPI Grid */}
      <div className="rounded-xl bg-slate-50/60 border border-slate-100 px-3 py-2 space-y-0.5">
        <MetricRow label="Lines" value={snapshot.totalLines.toLocaleString()} />
        <MetricRow label="Items" value={snapshot.totalItems.toLocaleString()} />
        <MetricRow label="Locations" value={snapshot.totalLocations.toLocaleString()} />
        <MetricRow label="Allocatable Qty" value={formatQty(snapshot.totalAllocatableQty)} />
        <MetricRow label="Reserved Qty" value={formatQty(snapshot.totalReservedQty)} />
        <MetricRow label="In-Transit Qty" value={formatQty(snapshot.totalInTransitQty)} />
        <MetricRow label="Estimated Lines" value={snapshot.estimatedLinesCount.toLocaleString()} />
      </div>

      {/* Freshness */}
      <div className={`rounded-lg px-3 py-2 text-xs ${snapshot.freshness === 'PASS' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-amber-50 border border-amber-200 text-amber-700'}`}>
        <span className="font-semibold">Freshness: {snapshot.freshness}</span>
        {' — '}
        <span>{snapshot.freshnessAgeMinutes} phút (threshold: 240 phút)</span>
      </div>

      {/* Stale acknowledged */}
      {snapshot.staleAcknowledged && (
        <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-700">
          ✅ STALE đã xác nhận{snapshot.staleReason ? `: ${snapshot.staleReason}` : ''}
        </div>
      )}

      {/* Frozen */}
      {snapshot.frozenAt && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
          🔒 Frozen lúc {formatDate(snapshot.frozenAt)}
          {snapshot.frozenBy ? ` bởi ${snapshot.frozenBy}` : ''}
        </div>
      )}
    </div>
  );
}
