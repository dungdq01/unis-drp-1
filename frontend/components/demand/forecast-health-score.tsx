'use client';

import type { AccuracyOverview, AccuracySummary } from '@/lib/api/demand';

interface Props {
  overview: AccuracyOverview | null;
  accuracy: AccuracySummary | null;
  worstTotal: number;
}

function ScoreBar({ label, value, maxPts, color }: { label: string; value: number; maxPts: number; color: string }) {
  const pct = Math.min(100, (value / maxPts) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-slate-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11px] font-semibold text-slate-700 w-14 text-right">{value.toFixed(1)}/{maxPts}pts</span>
    </div>
  );
}

export function ForecastHealthScore({ overview, accuracy, worstTotal }: Props) {
  if (!overview || !accuracy) return null;

  const { kpi } = overview;
  const accKpi = accuracy.kpi;

  // Scoring formula from spec
  const coverageScore = Math.min(25, (kpi.coveragePercent / 95) * 25);
  const accuracyScore = Math.min(20, (accKpi.modelAccT1 / 70) * 20);
  const stabilityScore = kpi.dormantCount != null && kpi.totalItems > 0
    ? Math.max(0, (1 - kpi.dormantCount / kpi.totalItems) * 15) : 15;
  const freshnessScore = 10; // data loaded = fresh
  const total = Math.round(coverageScore + accuracyScore + stabilityScore + freshnessScore);

  const scoreColor = total >= 80 ? '#10B981' : total >= 60 ? '#F59E0B' : '#EF4444';
  const scoreEmoji = total >= 80 ? '🟢' : total >= 60 ? '🟡' : '🔴';

  const issues: string[] = [];
  if (kpi.dormantCount > 100) issues.push(`${kpi.dormantCount} dormant SKUs`);
  if (worstTotal > 0) issues.push(`${worstTotal} SKUs acc < 20%`);
  if (accKpi.gainT1 < 0) issues.push('Model trails MA3 at T1');

  return (
    <div className="glass-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="section-label">Forecast Health Score</p>
          <p className="text-xs text-slate-400 mt-0.5">Composite — coverage × accuracy × stability × freshness</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-black leading-none" style={{ color: scoreColor }}>
            {total}<span className="text-xl font-semibold text-slate-400">/100</span>
          </p>
          <p className="text-sm mt-0.5">{scoreEmoji} {total >= 80 ? 'Healthy' : total >= 60 ? 'Fair' : 'Needs Action'}</p>
        </div>
      </div>

      {/* Overall bar */}
      <div className="mb-4">
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${total}%`, background: `linear-gradient(90deg, ${scoreColor}88, ${scoreColor})` }}
          />
        </div>
      </div>

      {/* Breakdown */}
      <div className="space-y-2 mb-4">
        <ScoreBar label="Coverage" value={coverageScore} maxPts={25} color="#3B82F6" />
        <ScoreBar label="Accuracy" value={accuracyScore} maxPts={20} color="#10B981" />
        <ScoreBar label="Stability" value={stabilityScore} maxPts={15} color="#8B5CF6" />
        <ScoreBar label="Freshness" value={freshnessScore} maxPts={10} color="#F59E0B" />
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <div className="border-t border-amber-100 pt-3">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 mb-1">Score deductions:</p>
          {issues.map(i => (
            <p key={i} className="text-[11px] text-amber-700">⚠ {i}</p>
          ))}
        </div>
      )}
    </div>
  );
}
