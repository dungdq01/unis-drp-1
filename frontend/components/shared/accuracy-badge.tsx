'use client';

interface Props {
  pct: number | null | undefined;
  compact?: boolean;
}

/**
 * Color-coded accuracy pill: ≥70% emerald, 40–70% amber, <40% rose.
 */
export function AccuracyBadge({ pct, compact = false }: Props) {
  if (pct == null) return <span className="text-xs text-slate-400">—</span>;
  const cls = pct >= 70 ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
           : pct >= 40 ? 'bg-amber-100 text-amber-700 border-amber-200'
           : 'bg-rose-100 text-rose-700 border-rose-200';
  const label = `${pct.toFixed(1)}%`;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 ${compact ? 'py-0' : 'py-0.5'} text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}
