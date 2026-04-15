'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { COLORS, statusColor } from '@/lib/chart-colors';
import { ChartCard } from '@/components/shared/chart-card';
import type { SkuStatusRow } from '@/lib/api/demand';

interface Props {
  statuses: SkuStatusRow[];
  total: number;
}

export function SkuStatusDonut({ statuses, total }: Props) {
  // QA-2: filter zero-count buckets — don't render "Other 0 0%" rows that
  // pollute legend + donut slice.
  const nonEmpty = (statuses ?? []).filter(s => s.count > 0);
  if (!nonEmpty.length) {
    return (
      <ChartCard title="Trạng thái SKU" height={280}>
        <div className="h-full flex items-center justify-center text-sm text-slate-400">Loading…</div>
      </ChartCard>
    );
  }

  const topStatus = [...nonEmpty].sort((a, b) => b.count - a.count)[0];
  const centerPct = topStatus ? topStatus.pct.toFixed(0) : '0';
  const centerLabel = topStatus?.status ?? '—';

  return (
    <ChartCard
      title="Trạng thái SKU"
      subtitle={<>Tổng <span className="font-semibold text-slate-700">{total.toLocaleString()}</span> SKUs trong hệ thống</>}
      height={280}
    >
      <div className="h-full grid grid-cols-2 gap-4 items-center">
        <div className="relative h-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={nonEmpty}
                dataKey="count"
                nameKey="status"
                cx="50%" cy="50%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
                stroke="none"
                isAnimationActive={false}
              >
                {nonEmpty.map((s, i) => (
                  <Cell key={i} fill={statusColor(s.status)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: any, _n: any, p: any) => [
                  `${Number(v).toLocaleString()} SKUs (${p?.payload?.pct ?? 0}%)`,
                  p?.payload?.status ?? '',
                ]}
                contentStyle={{ backgroundColor: COLORS.tooltipBg, borderRadius: 6, border: '1px solid ' + COLORS.grid, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-2xl font-bold text-slate-800">{centerPct}%</p>
            <p className="text-xs text-slate-500 uppercase tracking-wider">{centerLabel}</p>
          </div>
        </div>

        {/* Legend */}
        <div className="space-y-2">
          {nonEmpty.map(s => (
            <div key={s.status} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: statusColor(s.status) }} />
              <span className="font-semibold text-slate-700 w-12">{s.status}</span>
              <span className="font-mono text-slate-600">{s.count.toLocaleString()}</span>
              <span className="font-mono text-slate-400 ml-auto">{s.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}
