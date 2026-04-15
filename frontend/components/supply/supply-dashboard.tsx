'use client';

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { fetchSnapshotStats, type SupplySnapshot, type FreshnessStatus, type SnapshotStats } from '@/lib/api/supply';

interface Props {
  snapshots: SupplySnapshot[];
  freshness: FreshnessStatus | null;
}

const STATUS_COLOR: Record<string, { bg: string; text: string; bar: string }> = {
  DRAFT:    { bg: 'bg-amber-100',  text: 'text-amber-700',  bar: 'bg-amber-400' },
  FROZEN:   { bg: 'bg-blue-100',   text: 'text-blue-700',   bar: 'bg-blue-500'  },
  ARCHIVED: { bg: 'bg-slate-100',  text: 'text-slate-500',  bar: 'bg-slate-300' },
};

export function SupplyDashboard({ snapshots, freshness }: Props) {
  const latestSnapshot = snapshots[0] ?? null;
  const [stats, setStats] = useState<SnapshotStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (!latestSnapshot) return;
    setStatsLoading(true);
    fetchSnapshotStats(latestSnapshot.id)
      .then(setStats)
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false));
  }, [latestSnapshot?.id]);

  // Status counts
  const statusCounts = snapshots.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const totalSnaps = snapshots.length;
  const frozenCount = statusCounts['FROZEN'] ?? 0;
  const draftCount = statusCounts['DRAFT'] ?? 0;
  const archivedCount = statusCounts['ARCHIVED'] ?? 0;

  // Max qty for location bar scaling
  const maxQty = stats?.qtyByLocation[0]?.allocatableQty ?? 1;

  return (
    <div className="space-y-4">

      {/* ─── Row 1: KPI tiles ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Snapshots" value={totalSnaps} color="slate" />
        <KpiTile label="Frozen" value={frozenCount} color="blue" />
        <KpiTile label="Locations" value={latestSnapshot?.totalLocations ?? '—'} color="emerald" />
        <KpiTile label="Items" value={latestSnapshot ? latestSnapshot.totalItems.toLocaleString() : '—'} color="violet" />
      </div>

      {/* ─── Row 2: Status breakdown + Qty by Location ──────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Snapshot Status Breakdown */}
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Snapshot Status Breakdown</p>
          <div className="space-y-2.5">
            {(['DRAFT', 'FROZEN', 'ARCHIVED'] as const).map((status) => {
              const count = statusCounts[status] ?? 0;
              const pct = totalSnaps > 0 ? Math.round((count / totalSnaps) * 100) : 0;
              const c = STATUS_COLOR[status];
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${c.bar}`} />
                  <span className="text-xs font-medium text-slate-600 w-16">{status}</span>
                  {/* Bar */}
                  <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${c.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums font-semibold text-slate-700 w-4 text-right">{count}</span>
                  <span className="text-xs text-slate-400 w-8 text-right">{pct > 0 ? `${pct}%` : ''}</span>
                </div>
              );
            })}
          </div>

          {/* Freshness sub-section */}
          {freshness && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Freshness Lot Attribute</p>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                  freshness.overallFreshness === 'PASS' ? 'bg-green-100 text-green-700' :
                  freshness.overallFreshness === 'STALE' ? 'bg-red-100 text-red-700' :
                  'bg-slate-100 text-slate-500'
                }`}>{freshness.overallFreshness}</span>
                <span className="text-xs text-slate-500">{freshness.ageMinutes} phút · ngưỡng {freshness.thresholdMinutes} phút</span>
                {freshness.staleLocations.length > 0 && (
                  <span className="text-xs text-red-500 font-medium">{freshness.staleLocations.length} kho stale</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Quantity by Location top 15 */}
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Quantity by Location — Top 15
            {latestSnapshot && <span className="ml-2 text-slate-400 font-normal normal-case">(snapshot: {latestSnapshot.snapshotName})</span>}
          </p>
          {statsLoading ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-xs animate-pulse">Đang tải...</div>
          ) : stats && stats.qtyByLocation.length > 0 ? (
            <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
              {stats.qtyByLocation.map((row, i) => {
                const barPct = (row.allocatableQty / maxQty) * 100;
                return (
                  <div key={row.locationCode} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-500 w-4 text-right flex-shrink-0">{i + 1}</span>
                    <span className="text-xs font-mono font-semibold text-slate-700 w-10 flex-shrink-0">{row.locationCode}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-orange-400"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums text-slate-600 w-16 text-right flex-shrink-0">
                      {row.allocatableQty.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-400 w-12 text-right flex-shrink-0">
                      {row.lineCount} items
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty />
          )}
        </div>
      </div>

      {/* ─── Row 3: Stock breakdown + Source + Top Items ────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Items with zero/low/normal stock */}
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Stock Level Breakdown</p>
          {statsLoading ? (
            <div className="text-xs text-slate-400 animate-pulse">Đang tải...</div>
          ) : stats ? (
            <>
              <div className="space-y-3">
                <StockRow label="Zero stock" value={stats.stockBreakdown.zero} total={latestSnapshot?.totalLines ?? 1} color="bg-red-400" textColor="text-red-600" />
                <StockRow label="Low stock (1–10)" value={stats.stockBreakdown.low} total={latestSnapshot?.totalLines ?? 1} color="bg-amber-400" textColor="text-amber-600" />
                <StockRow label="Normal (>10)" value={stats.stockBreakdown.normal} total={latestSnapshot?.totalLines ?? 1} color="bg-emerald-400" textColor="text-emerald-600" />
              </div>
              {/* Mini donut substitute — horizontal stack */}
              <div className="mt-4 h-2 rounded-full overflow-hidden flex">
                {stats.stockBreakdown.zero + stats.stockBreakdown.low + stats.stockBreakdown.normal > 0 && (() => {
                  const total = stats.stockBreakdown.zero + stats.stockBreakdown.low + stats.stockBreakdown.normal;
                  return (
                    <>
                      <div className="bg-red-400 h-full" style={{ width: `${(stats.stockBreakdown.zero / total) * 100}%` }} />
                      <div className="bg-amber-400 h-full" style={{ width: `${(stats.stockBreakdown.low / total) * 100}%` }} />
                      <div className="bg-emerald-400 h-full flex-1" />
                    </>
                  );
                })()}
              </div>
            </>
          ) : <Empty />}
        </div>

        {/* Estimated vs OEM */}
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Estimated vs OEM</p>
          {statsLoading ? (
            <div className="text-xs text-slate-400 animate-pulse">Đang tải...</div>
          ) : stats ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-500 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-700">OEM</span>
                </div>
                <span className="text-lg font-bold tabular-nums text-slate-800">{stats.sourceBreakdown.oem.toLocaleString()}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm bg-violet-400 flex-shrink-0" />
                  <span className="text-sm font-medium text-slate-700">Estimated</span>
                </div>
                <span className="text-lg font-bold tabular-nums text-slate-800">{stats.sourceBreakdown.estimated.toLocaleString()}</span>
              </div>
              {/* Bar */}
              {stats.sourceBreakdown.oem + stats.sourceBreakdown.estimated > 0 && (
                <div className="h-2 rounded-full overflow-hidden flex mt-1">
                  <div
                    className="bg-blue-500 h-full"
                    style={{ width: `${(stats.sourceBreakdown.oem / (stats.sourceBreakdown.oem + stats.sourceBreakdown.estimated)) * 100}%` }}
                  />
                  <div className="bg-violet-400 h-full flex-1" />
                </div>
              )}
            </div>
          ) : <Empty />}
        </div>

        {/* Top 10 Items by Qty */}
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Top 10 Items by Qty</p>
          {statsLoading ? (
            <div className="text-xs text-slate-400 animate-pulse">Đang tải...</div>
          ) : stats && stats.topItems.length > 0 ? (
            <div className="space-y-1.5">
              {stats.topItems.map((item, i) => {
                const maxItemQty = stats.topItems[0].allocatableQty;
                const pct = (item.allocatableQty / maxItemQty) * 100;
                return (
                  <div key={item.itemCode} className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 w-3 text-right flex-shrink-0">{i + 1}</span>
                    <span className="text-[10px] font-mono text-slate-600 w-28 truncate flex-shrink-0" title={item.itemCode}>{item.itemCode}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                      <div className="h-full rounded-full bg-violet-400" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-[10px] tabular-nums text-slate-600 w-12 text-right flex-shrink-0">{item.allocatableQty.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          ) : <Empty />}
        </div>
      </div>

      {/* ─── Row 4: Qty by Location full bar chart ──────────────────────── */}
      {stats && stats.qtyByLocation.length > 0 && (
        <div className="glass-card p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Allocatable Qty by Location (Top 15)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats.qtyByLocation} margin={{ top: 4, right: 16, bottom: 8, left: 8 }}>
              <XAxis dataKey="locationCode" tick={{ fontSize: 10, fontFamily: 'monospace' }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)} />
              <Tooltip
                formatter={(v: unknown): [string, string] => [Number(v).toLocaleString(), 'Alloc Qty']}
                labelFormatter={(l) => `Kho ${l}`}
              />
              <Bar dataKey="allocatableQty" radius={[3, 3, 0, 0]} maxBarSize={40}>
                {stats.qtyByLocation.map((_, i) => (
                  <Cell key={i} fill={i === 0 ? '#f97316' : '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiTile({ label, value, color }: { label: string; value: number | string; color: string }) {
  const palette: Record<string, string> = {
    slate:   'from-slate-50   to-slate-100   border-slate-200   text-slate-700',
    blue:    'from-blue-50    to-blue-100    border-blue-200    text-blue-700',
    emerald: 'from-emerald-50 to-emerald-100 border-emerald-200 text-emerald-700',
    violet:  'from-violet-50  to-violet-100  border-violet-200  text-violet-700',
  };
  return (
    <div className={`rounded-xl border p-4 bg-gradient-to-br ${palette[color] ?? palette.slate}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-60 mb-1">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  );
}

function StockRow({ label, value, total, color, textColor }: {
  label: string; value: number; total: number; color: string; textColor: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className={`w-2 h-2 rounded-sm flex-shrink-0 ${color}`} />
      <span className="text-xs text-slate-600 flex-1">{label}</span>
      <span className={`text-xs font-bold tabular-nums ${textColor} w-10 text-right`}>{value.toLocaleString()}</span>
      <span className="text-[10px] text-slate-400 w-8 text-right">{pct > 0 ? `${pct}%` : '0%'}</span>
    </div>
  );
}

function Empty() {
  return <div className="flex items-center justify-center h-20 text-slate-300 text-xs">Chưa có dữ liệu</div>;
}
