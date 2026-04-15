'use client';

import { type SupplySnapshot, type FreshnessStatus } from '@/lib/api/supply';

interface Props {
  snapshot: SupplySnapshot | null;
  freshness: FreshnessStatus | null;
}

function fmt(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

export function SupplyKpiCards({ snapshot, freshness }: Props) {
  if (!snapshot) return null;

  const allocatable = Number(snapshot.totalAllocatableQty);
  const reserved = Number(snapshot.totalReservedQty);
  const inTransit = Number(snapshot.totalInTransitQty);
  const total = allocatable + reserved + inTransit || 1;

  const allocPct = Math.round((allocatable / total) * 100);
  const resPct   = Math.round((reserved   / total) * 100);
  const trPct    = Math.round((inTransit  / total) * 100);

  const freshnessOk  = freshness?.overallFreshness === 'PASS';
  const freshnessAge = freshness && freshness.overallFreshness !== 'NO_DATA'
    ? freshness.ageMinutes < 60
      ? `${freshness.ageMinutes} phút`
      : `${(freshness.ageMinutes / 60).toFixed(1)} giờ`
    : null;
  const staleCount = freshness?.staleLocations.length ?? 0;

  return (
    <div className="glass-card px-5 py-4">
      {/* ─── Snapshot label ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            {snapshot.snapshotName}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            snapshot.status === 'FROZEN' ? 'bg-blue-100 text-blue-600' :
            snapshot.status === 'DRAFT'  ? 'bg-amber-100 text-amber-600' :
                                           'bg-slate-100 text-slate-500'
          }`}>{snapshot.status}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
            snapshot.freshness === 'PASS' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-500'
          }`}>{snapshot.freshness}</span>
        </div>
        <span className="text-[10px] text-slate-400">
          {new Date(snapshot.captureAt).toLocaleString('vi-VN')}
        </span>
      </div>

      {/* ─── KPI row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100 rounded-xl overflow-hidden">

        {/* Allocatable */}
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Allocatable</p>
          <p className="text-2xl font-bold tabular-nums text-sky-600">{fmt(allocatable)}</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{snapshot.totalItems.toLocaleString()} items</span>
              <span>{snapshot.totalLocations} kho</span>
            </div>
            {/* mini bar — allocatable share */}
            <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-sky-400 rounded-full" style={{ width: `${allocPct}%` }} />
            </div>
          </div>
        </div>

        {/* Reserved */}
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Reserved</p>
          <p className="text-2xl font-bold tabular-nums text-amber-500">{fmt(reserved)}</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{resPct}% of total</span>
              <span>{snapshot.totalLines.toLocaleString()} lines</span>
            </div>
            <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.max(resPct, reserved > 0 ? 2 : 0)}%` }} />
            </div>
          </div>
        </div>

        {/* In-Transit */}
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">In-Transit</p>
          <p className="text-2xl font-bold tabular-nums text-violet-500">{fmt(inTransit)}</p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{trPct}% of total</span>
              <span>{snapshot.estimatedLinesCount} estimated</span>
            </div>
            <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.max(trPct, inTransit > 0 ? 2 : 0)}%` }} />
            </div>
          </div>
        </div>

        {/* Freshness */}
        <div className="bg-white px-4 py-3">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Freshness</p>
          <p className={`text-2xl font-bold ${freshnessOk ? 'text-emerald-500' : staleCount > 0 ? 'text-red-500' : 'text-slate-400'}`}>
            {freshness?.overallFreshness ?? '—'}
          </p>
          <div className="mt-2 space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>{freshnessAge ?? '—'} tuổi</span>
              {staleCount > 0
                ? <span className="text-red-400">{staleCount} kho stale</span>
                : <span className="text-emerald-400">all fresh</span>
              }
            </div>
            {/* freshness bar: green = fresh portion */}
            <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
              {freshness && freshness.overallFreshness !== 'NO_DATA' && (
                <div
                  className={`h-full rounded-full ${freshnessOk ? 'bg-emerald-400' : 'bg-red-400'}`}
                  style={{ width: freshnessOk ? '100%' : `${Math.max(10, 100 - (freshness.ageMinutes / freshness.thresholdMinutes) * 100)}%` }}
                />
              )}
            </div>
          </div>
        </div>

      </div>

      {/* ─── Stacked qty bar ────────────────────────────────────────────── */}
      {(allocatable + reserved + inTransit) > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-1 h-1.5 rounded-full overflow-hidden">
            <div className="h-full bg-sky-400"    style={{ width: `${allocPct}%` }} />
            <div className="h-full bg-amber-400"  style={{ width: `${resPct}%` }} />
            <div className="h-full bg-violet-400 flex-1" />
          </div>
          <div className="flex gap-4 mt-1.5">
            <Legend color="bg-sky-400"    label="Allocatable" />
            <Legend color="bg-amber-400"  label="Reserved" />
            <Legend color="bg-violet-400" label="In-Transit" />
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${color}`} />
      <span className="text-[10px] text-slate-400">{label}</span>
    </div>
  );
}
