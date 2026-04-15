'use client';

import { ChartCard } from '@/components/shared/chart-card';
import type { AccuracyOverview, AccuracySummary, SkuStatusRow } from '@/lib/api/demand';

const fmt = (n: number) => n.toLocaleString();

interface Props {
  overview: AccuracyOverview | null;
  accuracy: AccuracySummary | null;
  skuStatus: { statuses: SkuStatusRow[]; total: number } | null;
}

function Ring({ pct, color = '#6366F1', size = 80, label }: { pct: number; color?: string; size?: number; label: string }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg width={size} height={size}>
          <circle cx={size/2} cy={size/2} r={r} stroke="#F3F4F6" strokeWidth="8" fill="none" />
          <circle
            cx={size/2} cy={size/2} r={r}
            stroke={color} strokeWidth="8" fill="none"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={off}
            transform={`rotate(-90 ${size/2} ${size/2})`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-base font-bold text-slate-800">{pct.toFixed(1)}%</span>
        </div>
      </div>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 mt-1">{label}</p>
    </div>
  );
}

/**
 * Consolidates 4 SKU-count KPIs + Coverage into a single funnel panel.
 * - Horizontal bars: Total → Active → Evaluated (show drop-off %)
 * - Dormant highlighted as inverse (red bar from right)
 * - Coverage ring on right side
 */
export function SkuPipelinePanel({ overview, accuracy, skuStatus }: Props) {
  if (!overview) {
    return (
      <ChartCard title="SKU Pipeline" subtitle="Loading…" height={240}>
        <div className="h-full flex items-center justify-center text-sm text-slate-400">—</div>
      </ChartCard>
    );
  }

  const total = overview.kpi.totalItems;
  const active = overview.kpi.activeItems;
  const evaluated = accuracy?.kpi.skusEvaluated ?? 0;
  const dormant = overview.kpi.dormantCount;
  const coverage = overview.kpi.coveragePercent;

  // For status breakdown hint (top 3 non-zero)
  const statusBreakdown = (skuStatus?.statuses ?? [])
    .filter(s => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const steps = [
    {
      label: 'Total SKUs',
      sub: 'in item master',
      value: total,
      pct: 100,
      color: '#3B82F6',
      extra: statusBreakdown.length > 0
        ? statusBreakdown.map(s => `${s.status} ${s.pct.toFixed(0)}%`).join(' · ')
        : undefined,
    },
    {
      label: 'Active SKUs',
      sub: 'status = ACT',
      value: active,
      pct: total > 0 ? (active / total) * 100 : 0,
      color: '#10B981',
    },
    {
      label: 'SKUs Evaluated',
      sub: 'has actual T1 data',
      value: evaluated,
      pct: total > 0 ? (evaluated / total) * 100 : 0,
      color: '#8B5CF6',
    },
  ];

  return (
    <ChartCard
      title="SKU Pipeline"
      subtitle={`${fmt(total)} → ${fmt(active)} → ${fmt(evaluated)} · ${dormant} dormant`}
      height={260}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 h-full items-center">
        {/* Funnel bars */}
        <div className="space-y-2.5">
          {steps.map((s, i) => (
            <div key={s.label} className="group">
              <div className="flex items-baseline justify-between mb-0.5">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  {s.label}
                </span>
                <span className="text-[10px] text-slate-400">
                  {s.extra ?? s.sub}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-6 bg-slate-100 rounded-md overflow-hidden relative">
                  <div
                    className="h-full rounded-md transition-all"
                    style={{ width: `${s.pct}%`, backgroundColor: s.color, opacity: 0.85 }}
                  />
                  <div className="absolute inset-0 flex items-center px-2">
                    <span className="text-xs font-bold text-white mix-blend-plus-lighter drop-shadow" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.2)' }}>
                      {fmt(s.value)}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold w-12 text-right" style={{ color: s.color }}>
                  {s.pct.toFixed(1)}%
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className="h-2 flex items-center pl-2 -mt-1">
                  <span className="text-[9px] text-slate-300">↓ drop {(steps[i].pct - steps[i + 1].pct).toFixed(1)}%</span>
                </div>
              )}
            </div>
          ))}

          {/* Dormant strip */}
          <div className="flex items-center gap-2 pt-1 mt-1 border-t border-amber-200/40">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 w-20">
              ⚠ Dormant
            </span>
            <div className="flex-1 h-3 bg-slate-100 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 to-amber-500"
                style={{ width: `${total > 0 ? (dormant / total) * 100 : 0}%` }}
              />
            </div>
            <span className="font-mono text-xs font-semibold text-amber-700 w-12 text-right">
              {fmt(dormant)}
            </span>
            <span className="text-[9px] text-slate-400 w-16">
              zero T10-T1
            </span>
          </div>
        </div>

        {/* Coverage ring (right side) */}
        <div className="flex items-center justify-center px-2">
          <Ring pct={coverage} color="#6366F1" label="Coverage" size={90} />
        </div>
      </div>
    </ChartCard>
  );
}
