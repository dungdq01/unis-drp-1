'use client';

import { COLORS } from '@/lib/chart-colors';

interface Props {
  /** Gain in percentage points (e.g. 10.9 for +10.9%) */
  gain: number;
  /** Max absolute gain across dataset — used to normalize width */
  maxAbs: number;
  /** Minimum bar width in px for readability */
  minWidth?: number;
}

/**
 * Inline gain bar — CSS-only (no Recharts needed for such a small visual).
 * Green when positive, red when negative, gray when ~0.
 */
export function GainBar({ gain, maxAbs, minWidth = 60 }: Props) {
  if (!gain || Math.abs(gain) < 0.05) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const pct = Math.min(Math.abs(gain) / Math.max(maxAbs, 0.1), 1) * 100;
  const bg = gain >= 0 ? COLORS.accGood : COLORS.accBad;
  const txt = gain >= 0 ? 'text-emerald-700' : 'text-rose-700';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden" style={{ minWidth }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: bg }} />
      </div>
      <span className={`text-xs font-mono font-semibold w-14 text-right ${txt}`}>
        {gain >= 0 ? '+' : ''}{gain.toFixed(1)}%
      </span>
    </div>
  );
}
