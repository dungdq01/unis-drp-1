'use client';

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, LabelList,
} from 'recharts';
import type { InsightsSummaryData, BranchBreakdown } from '@/lib/api/demand';
import { COLORS, comboColor } from '@/lib/chart-colors';
import { ChartCard } from '@/components/shared/chart-card';

interface Props {
  insights: InsightsSummaryData | null;
  topBranches: BranchBreakdown[];
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000 ? `${(n / 1_000).toFixed(0)}K`
  : Math.round(n).toLocaleString();

const segColor: Record<string, string> = { A: COLORS.segA, B: COLORS.segB, C: COLORS.segC };

function PeriodBarChart({ data }: { data: InsightsSummaryData['byPeriod'] }) {
  return (
    <ChartCard title="Demand by Period" subtitle="SUM forecast qty per tháng · 🧧 Tết highlight" height={260}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
          <defs>
            <linearGradient id="periodGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.9} />
              <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0.5} />
            </linearGradient>
            <linearGradient id="tetGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.warning} stopOpacity={0.9} />
              <stop offset="100%" stopColor={COLORS.warning} stopOpacity={0.5} />
            </linearGradient>
          </defs>
          <XAxis dataKey="period" stroke={COLORS.axis} fontSize={11} />
          <YAxis tickFormatter={fmt} stroke={COLORS.axis} fontSize={11} />
          <Tooltip
            formatter={(v: any) => [fmt(Number(v)), 'Total Qty']}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Bar dataKey="totalQty" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.tetFlag ? 'url(#tetGrad)' : 'url(#periodGrad)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function SegmentPie({ data }: { data: InsightsSummaryData['bySegment'] }) {
  return (
    <ChartCard title="Demand by Segment" subtitle="Phân khúc A/B/C theo tổng qty" height={260}>
      <div className="grid grid-cols-2 h-full gap-3 items-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="totalQty" nameKey="segment" cx="50%" cy="50%" innerRadius={40} outerRadius={75} stroke="none" isAnimationActive={false}>
              {data.map((d, i) => <Cell key={i} fill={segColor[d.segment] ?? COLORS.other} />)}
              <LabelList dataKey="pct" position="outside" formatter={(v: any) => `${Number(v).toFixed(0)}%`} fontSize={10} />
            </Pie>
            <Tooltip
              formatter={(v: any, _n: any, p: any) => [fmt(Number(v)), `Segment ${p?.payload?.segment}`]}
              contentStyle={{ fontSize: 12, borderRadius: 6 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1.5 text-xs">
          {data.map(s => (
            <div key={s.segment} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: segColor[s.segment] ?? COLORS.other }} />
              <span className="font-semibold w-5">{s.segment}</span>
              <span className="font-mono text-slate-600">{fmt(s.totalQty)}</span>
              <span className="font-mono text-slate-400 ml-auto">{s.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </ChartCard>
  );
}

function TopBranchesBar({ data }: { data: BranchBreakdown[] }) {
  const top = data.slice(0, 10);
  return (
    <ChartCard title="Top 10 Branches" subtitle="Xếp theo tổng demand T1" height={260}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="branchGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.5} />
              <stop offset="100%" stopColor={COLORS.primary} stopOpacity={1} />
            </linearGradient>
          </defs>
          <XAxis type="number" tickFormatter={fmt} fontSize={10} stroke={COLORS.axis} />
          <YAxis type="category" dataKey="locationCode" width={80} fontSize={10} stroke={COLORS.axis} />
          <Tooltip
            formatter={(v: any) => [fmt(Number(v)), 'Total Qty']}
            labelFormatter={(l: any) => `Branch ${l}`}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Bar dataKey="totalQty" fill="url(#branchGrad)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function ComboMixBar({ data }: { data: InsightsSummaryData['byComboClass'] }) {
  const top = data.slice(0, 6);
  return (
    <ChartCard title="Demand Pattern Mix" subtitle="Phân loại combo class — % SKUs" height={260}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={top} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
          <XAxis type="number" tickFormatter={(v: any) => `${v}%`} fontSize={10} stroke={COLORS.axis} />
          <YAxis type="category" dataKey="comboClass" width={140} fontSize={10} stroke={COLORS.axis} />
          <Tooltip
            formatter={(v: any, _n: any, p: any) => [`${Number(v).toFixed(1)}% (${p?.payload?.itemCount} items)`, 'Share']}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Bar dataKey="pct" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {top.map((d, i) => <Cell key={i} fill={comboColor(d.comboClass)} />)}
            <LabelList dataKey="pct" position="right" formatter={(v: any) => `${Number(v).toFixed(1)}%`} fontSize={10} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function InsightsSummary({ insights, topBranches }: Props) {
  if (!insights) {
    return <div className="glass-card p-10 text-center text-sm text-slate-400">Loading insights…</div>;
  }
  return (
    <div className="space-y-4">
      {/* R7: Row 3 = 3 charts side-by-side [Period 1/3][Segment 1/3][Combo 1/3] */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PeriodBarChart data={insights.byPeriod} />
        <SegmentPie data={insights.bySegment} />
        <ComboMixBar data={insights.byComboClass} />
      </div>
      {/* Top Branches — full-width horizontal bar (needs space for 10 branch labels) */}
      <TopBranchesBar data={topBranches} />
    </div>
  );
}
