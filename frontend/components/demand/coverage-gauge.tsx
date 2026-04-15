'use client';

import type { CoverageData } from '@/lib/api/demand';

interface CoverageGaugeProps {
  coverage: CoverageData | null;
  /** G9: drill-down click handler — filter pivot by segment */
  onSegmentClick?: (segment: string) => void;
  activeSegment?: string;
}

const gaugeColor = (pct: number) => {
  if (pct >= 90) return { start: '#22c55e', end: '#16a34a' };  // green
  if (pct >= 70) return { start: '#eab308', end: '#ca8a04' };  // yellow
  return { start: '#ef4444', end: '#dc2626' };                  // red
};

function Ring({ pct }: { pct: number }) {
  const r = 40;
  const circ = 2 * Math.PI * r;
  const offset = circ - (pct / 100) * circ;
  const colors = gaugeColor(pct);

  return (
    <svg width="96" height="96" className="mx-auto">
      <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(148,173,215,0.15)" strokeWidth="8" />
      <circle
        cx="48"
        cy="48"
        r={r}
        fill="none"
        stroke="url(#gaugeGrad)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={offset}
        transform="rotate(-90 48 48)"
        className="transition-all duration-700"
      />
      <defs>
        <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={colors.start} />
          <stop offset="100%" stopColor={colors.end} />
        </linearGradient>
      </defs>
      <text x="48" y="48" textAnchor="middle" dominantBaseline="central" className="fill-slate-800 text-lg font-bold" style={{ fontFamily: 'Inter, monospace' }}>
        {pct.toFixed(0)}%
      </text>
    </svg>
  );
}

function SegmentBar({ label, pct, color, onClick, active }: { label: string; pct: number; color: string; onClick?: () => void; active?: boolean }) {
  const row = (
    <div className={`flex items-center gap-2 ${onClick ? 'cursor-pointer hover:opacity-80' : ''} ${active ? 'ring-2 ring-sky-400 ring-offset-1 rounded-md px-1 -mx-1' : ''}`}>
      <span className="text-[11px] font-semibold text-slate-500 w-4">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[11px] font-mono text-slate-500 w-10 text-right">{pct.toFixed(0)}%</span>
    </div>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="w-full text-left" title={active ? 'Click to clear filter' : `Filter by segment ${label}`}>{row}</button>
    : row;
}

export function CoverageGauge({ coverage, onSegmentClick, activeSegment }: CoverageGaugeProps) {
  if (!coverage) {
    return (
      <div className="kpi-card flex flex-col gap-3 items-center justify-center min-h-[180px]">
        <p className="section-label">Coverage</p>
        <Ring pct={0} />
        <p className="text-[11px] text-slate-400">Loading...</p>
      </div>
    );
  }

  const seg = coverage.bySegment || {};
  const segA = seg['A'] || seg['a'];
  const segB = seg['B'] || seg['b'];
  const segC = seg['C'] || seg['c'];

  return (
    <div className="kpi-card flex flex-col gap-3">
      <p className="section-label">Coverage</p>
      <Ring pct={coverage.coveragePct ?? 0} />
      <div className="text-center text-[11px] text-slate-500">
        {(coverage.withForecast ?? 0).toLocaleString()} / {(coverage.totalItems ?? 0).toLocaleString()} items
      </div>
      <div className="flex flex-col gap-1.5 mt-1">
        {/* G12: spec colors — A=blue, B=yellow, C=gray */}
        <SegmentBar label="A" pct={segA?.pct ?? 0} color="bg-blue-500" onClick={onSegmentClick ? () => onSegmentClick(activeSegment === 'A' ? '' : 'A') : undefined} active={activeSegment === 'A'} />
        <SegmentBar label="B" pct={segB?.pct ?? 0} color="bg-yellow-400" onClick={onSegmentClick ? () => onSegmentClick(activeSegment === 'B' ? '' : 'B') : undefined} active={activeSegment === 'B'} />
        <SegmentBar label="C" pct={segC?.pct ?? 0} color="bg-gray-400" onClick={onSegmentClick ? () => onSegmentClick(activeSegment === 'C' ? '' : 'C') : undefined} active={activeSegment === 'C'} />
      </div>
    </div>
  );
}
