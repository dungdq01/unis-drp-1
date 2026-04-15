'use client';

import { useMemo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { ChartCard } from '@/components/shared/chart-card';
import { COLORS } from '@/lib/chart-colors';
import type { AccuracySummary } from '@/lib/api/demand';

/**
 * Consolidates Model Acc + MA3 Baseline + Gain into ONE comparative chart.
 * - Two lines (Model emerald, MA3 slate) across T10-T1
 * - Shaded area = gain (positive) or loss (negative)
 * - Inline big-number KPIs at top right: 54.2% · 43.3% · +10.9%
 */
export function AccuracyComparisonPanel({ accuracy }: { accuracy: AccuracySummary | null }) {
  const data = useMemo(() => {
    if (!accuracy) return [];
    return accuracy.byMonth
      .filter(m => !m.pending)
      .map(m => ({
        month: m.month,
        model: m.finalAcc ?? null,
        ma3: m.ma3Acc ?? null,
        gainPos: m.finalAcc != null && m.ma3Acc != null && m.finalAcc >= m.ma3Acc
          ? m.finalAcc - m.ma3Acc : 0,
      }));
  }, [accuracy]);

  if (!accuracy || data.length === 0) {
    return (
      <ChartCard title="Model vs MA3 Accuracy" subtitle="Loading…" height={260}>
        <div className="h-full flex items-center justify-center text-sm text-slate-400">—</div>
      </ChartCard>
    );
  }

  const kpi = accuracy.kpi;
  const gainPositive = kpi.gainT1 >= 0;
  const gainColor = gainPositive ? COLORS.secondary : COLORS.danger;

  return (
    <ChartCard
      title="Model vs MA3 Accuracy"
      subtitle={`${kpi.skusEvaluated.toLocaleString()} SKUs evaluated · T10 → T1`}
      height={260}
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 h-full">
        {/* Left: chart */}
        <div className="min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gainArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.secondary} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.secondary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.grid} vertical={false} />
              <XAxis dataKey="month" fontSize={11} stroke={COLORS.axis} />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                fontSize={11} stroke={COLORS.axis} width={40}
                domain={[0, 100]}
              />
              <Tooltip
                formatter={(v: any, name: any) => [
                  v == null ? '—' : `${Number(v).toFixed(1)}%`,
                  String(name) === 'model' ? 'Model' : String(name) === 'ma3' ? 'MA3' : String(name),
                ]}
                contentStyle={{ fontSize: 11, borderRadius: 6 }}
              />
              <ReferenceLine y={50} stroke={COLORS.grid} strokeDasharray="4 4" />
              {/* Gain area (Model minus MA3, only when positive) */}
              <Area type="monotone" dataKey="gainPos" stroke="none" fill="url(#gainArea)" isAnimationActive={false} />
              {/* MA3 baseline (slate) */}
              <Line
                type="monotone" dataKey="ma3" name="MA3"
                stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 3"
                dot={{ r: 3, fill: '#94A3B8' }}
                connectNulls={false} isAnimationActive={false}
              />
              {/* Model (emerald) */}
              <Line
                type="monotone" dataKey="model" name="Model"
                stroke={COLORS.secondary} strokeWidth={2.5}
                dot={{ r: 4, fill: COLORS.secondary, stroke: '#fff', strokeWidth: 2 }}
                connectNulls={false} isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Right: big numbers stack */}
        <div className="flex flex-col justify-center gap-3 min-w-[140px] px-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-emerald-700">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />
              Model · T1 LIVE
            </p>
            <p className="text-3xl font-bold leading-tight text-emerald-600">
              {kpi.modelAccT1.toFixed(1)}%
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-400 mr-1" />
              MA3 Baseline
            </p>
            <p className="text-2xl font-semibold leading-tight text-slate-700">
              {kpi.ma3AccT1.toFixed(1)}%
            </p>
          </div>
          <div className="border-t border-slate-200 pt-2">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">Gap</p>
            <p className="text-2xl font-bold leading-tight" style={{ color: gainColor }}>
              {gainPositive ? '+' : ''}{kpi.gainT1.toFixed(1)}%
            </p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {gainPositive ? '✓ model wins' : '⚠ model trails'}
            </p>
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
