'use client';

import { AreaChart, Area, Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, ComposedChart, Line } from 'recharts';
import { COLORS } from '@/lib/chart-colors';

const fmt = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
};

interface Props {
  fsku: string;
  locationCode: string;
  locationName?: string;
  segment?: string | null;
  periods: string[];
  periodQty: Record<string, number>;
  total: number;
}

/**
 * "Xung nhịp" visual for a single (FSKU, Branch) pair — forecast qty over periods.
 * Trading-chart vibe: area fill + line + markers + reference avg, inline tooltip.
 */
export function FskuBranchHeartbeat({
  fsku, locationCode, locationName, segment, periods, periodQty, total,
}: Props) {
  const data = periods.map(p => ({
    period: p.slice(5), // "MM" portion
    periodFull: p,
    qty: periodQty[p] ?? 0,
  }));
  const avg = total / Math.max(periods.length, 1);
  const max = Math.max(...data.map(d => d.qty), 1);
  const peak = data.reduce((b, d) => d.qty > b.qty ? d : b, data[0] ?? { qty: 0, period: '', periodFull: '' });
  const trough = data.reduce((b, d) => d.qty < b.qty ? d : b, data[0] ?? { qty: 0, period: '', periodFull: '' });

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="font-mono font-bold text-slate-700">{fsku}</span>
        <span className="text-slate-300">@</span>
        <span className="font-mono text-sky-700">{locationCode}</span>
        {locationName && <span className="text-slate-500 truncate">{locationName}</span>}
        {segment && (
          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
            segment === 'A' ? 'bg-blue-100 text-blue-700'
            : segment === 'B' ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-600'
          }`}>Seg {segment}</span>
        )}
        <span className="ml-auto text-slate-500">
          Total <span className="font-mono font-semibold text-slate-700">{fmt(total)}</span>
          <span className="mx-2">·</span>
          Avg <span className="font-mono text-slate-700">{fmt(avg)}</span>
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Main heartbeat — area + line (trading chart style) */}
        <div className="lg:col-span-2 glass-card p-3">
          <p className="section-label text-[10px] mb-2">Xung nhịp forecast</p>
          <div style={{ height: 140 }}>
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`hb-${fsku}-${locationCode}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
                <XAxis dataKey="period" fontSize={10} stroke={COLORS.axis} />
                <YAxis tickFormatter={fmt} fontSize={10} stroke={COLORS.axis} width={42} />
                <Tooltip
                  formatter={(v: any) => [fmt(Number(v)), 'Qty']}
                  labelFormatter={(_l: any, p: any) => p?.[0]?.payload?.periodFull ?? ''}
                  contentStyle={{ fontSize: 11, borderRadius: 6 }}
                />
                <ReferenceLine y={avg} stroke={COLORS.warning} strokeDasharray="4 2" label={{ value: 'avg', fontSize: 9, fill: COLORS.warning, position: 'insideTopRight' }} />
                <Area type="monotone" dataKey="qty" stroke="none" fill={`url(#hb-${fsku}-${locationCode})`} isAnimationActive={false} />
                <Line type="monotone" dataKey="qty"
                      stroke={COLORS.primary} strokeWidth={2}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props;
                        const isPeak = payload?.period === peak?.period && data.length > 1;
                        const isTrough = payload?.period === trough?.period && data.length > 1;
                        const r = isPeak || isTrough ? 5 : 3;
                        const fill = isPeak ? COLORS.accGood : isTrough ? COLORS.accBad : COLORS.primary;
                        return <circle cx={cx} cy={cy} r={r} fill={fill} stroke="#fff" strokeWidth={1.5} />;
                      }}
                      isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Per-period bar breakdown */}
        <div className="glass-card p-3">
          <p className="section-label text-[10px] mb-2">Phân bổ theo tháng</p>
          <div className="space-y-1.5">
            {data.map(d => {
              const pct = (d.qty / max) * 100;
              const isPeak = d.period === peak?.period;
              const isTrough = d.period === trough?.period && data.length > 1 && peak?.period !== trough?.period;
              return (
                <div key={d.period} className="flex items-center gap-2 text-[11px]">
                  <span className="w-10 text-slate-500 font-mono">{d.periodFull}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isPeak ? COLORS.accGood : isTrough ? COLORS.accBad : COLORS.primary,
                      }}
                    />
                  </div>
                  <span className="font-mono text-slate-600 w-12 text-right">{fmt(d.qty)}</span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-slate-400 mt-2">
            🟢 peak {peak.period} · 🔴 trough {trough.period}
          </p>
        </div>
      </div>
    </div>
  );
}
