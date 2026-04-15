'use client';

import { LineChart, Line, ResponsiveContainer } from 'recharts';
import type { ReactNode } from 'react';

const fmt = (n: number | null | undefined) => {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString();
};

interface CardShellProps {
  label: string;
  valueNode: ReactNode;
  subtitle?: ReactNode;
  accent?: 'sky' | 'emerald' | 'indigo' | 'amber' | 'slate' | 'rose' | 'violet';
  vizNode: ReactNode;
}

const ACCENT_BORDER: Record<NonNullable<CardShellProps['accent']>, string> = {
  sky:     'border-sky-500',
  emerald: 'border-emerald-500',
  indigo:  'border-indigo-500',
  amber:   'border-amber-500',
  slate:   'border-slate-400',
  rose:    'border-rose-500',
  violet:  'border-violet-500',
};

function CardShell({ label, valueNode, subtitle, accent = 'sky', vizNode }: CardShellProps) {
  return (
    <div className={`kpi-card border-l-[3px] ${ACCENT_BORDER[accent]} py-3 px-4`}>
      <p className="section-label mb-0.5 text-[10px]">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="leading-tight text-2xl font-bold">{valueNode}</div>
          {subtitle && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="flex-shrink-0">{vizNode}</div>
      </div>
    </div>
  );
}

/* ── Ring gauge (circular progress) ── */

interface RingProps { pct: number; color?: string; size?: number }
function Ring({ pct, color = '#3B82F6', size = 54 }: RingProps) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#E2E8F0" strokeWidth="6" fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke={color} strokeWidth="6" fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/* ── Stacked breakdown mini-bar ── */

interface BreakdownSegment { label: string; value: number; color: string }
function StackedBar({ segments, height = 8 }: { segments: BreakdownSegment[]; height?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="space-y-0.5">
      <div className="flex rounded overflow-hidden bg-slate-100" style={{ height, width: 90 }}>
        {segments.map((s, i) => (
          <div
            key={i}
            title={`${s.label}: ${s.value.toLocaleString()}`}
            style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }}
          />
        ))}
      </div>
      <div className="flex gap-1 text-[8px] font-semibold">
        {segments.map((s, i) => (
          <span key={i} style={{ color: s.color }} title={s.label}>
            {s.label} {((s.value / total) * 100).toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Mini sparkline ── */

function Sparkline({ data, color = '#3B82F6', width = 90, height = 40 }: {
  data: { x: string | number; y: number }[]; color?: string; width?: number; height?: number;
}) {
  return (
    <div style={{ width, height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <Line type="monotone" dataKey="y" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── Public card variants ── */

export function KpiBreakdownCard({ label, value, subtitle, accent, segments }: {
  label: string; value: number; subtitle?: ReactNode; accent?: CardShellProps['accent']; segments: BreakdownSegment[];
}) {
  return (
    <CardShell
      label={label}
      accent={accent}
      valueNode={<span>{value.toLocaleString()}</span>}
      subtitle={subtitle}
      vizNode={<StackedBar segments={segments} />}
    />
  );
}

export function KpiRingCard({ label, value, pct, subtitle, accent, color }: {
  label: string; value: string; pct: number; subtitle?: ReactNode;
  accent?: CardShellProps['accent']; color?: string;
}) {
  return (
    <CardShell
      label={label}
      accent={accent}
      valueNode={<span>{value}</span>}
      subtitle={subtitle}
      vizNode={<Ring pct={pct} color={color} />}
    />
  );
}

export function KpiSparklineCard({ label, value, data, subtitle, accent, color }: {
  label: string; value: string; data: { x: string | number; y: number }[];
  subtitle?: ReactNode; accent?: CardShellProps['accent']; color?: string;
}) {
  return (
    <CardShell
      label={label}
      accent={accent}
      valueNode={<span>{value}</span>}
      subtitle={subtitle}
      vizNode={<Sparkline data={data} color={color} />}
    />
  );
}

/* ── Comparison card (two bars side-by-side for Model vs MA3) ── */

export function KpiCompareCard({ label, value, subtitle, accent, a, b }: {
  label: string; value: string; subtitle?: ReactNode; accent?: CardShellProps['accent'];
  a: { label: string; value: number; color: string };
  b: { label: string; value: number; color: string };
}) {
  const max = Math.max(a.value, b.value, 1);
  return (
    <CardShell
      label={label}
      accent={accent}
      valueNode={<span>{value}</span>}
      subtitle={subtitle}
      vizNode={
        <div className="flex items-end gap-1" style={{ height: 44 }}>
          {[a, b].map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5">
              <div className="w-4 rounded-t" style={{
                height: `${(s.value / max) * 36}px`,
                backgroundColor: s.color,
                minHeight: 2,
              }} title={`${s.label}: ${s.value}%`} />
              <span className="text-[8px] font-semibold" style={{ color: s.color }}>{s.label}</span>
            </div>
          ))}
        </div>
      }
    />
  );
}
