'use client';

type Winner = 'MODEL' | 'MA3' | 'TIE';

export function WinnerIcon({ winner, withLabel = true }: { winner: Winner; withLabel?: boolean }) {
  const cfg = {
    MODEL: { dot: 'bg-emerald-500', color: 'text-emerald-700', bg: 'bg-emerald-100', label: 'MODEL' },
    MA3:   { dot: 'bg-rose-500',    color: 'text-rose-700',    bg: 'bg-rose-100',    label: 'MA3' },
    TIE:   { dot: 'bg-slate-400',   color: 'text-slate-600',   bg: 'bg-slate-100',   label: 'TIE' },
  }[winner];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${cfg.bg} ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {withLabel && cfg.label}
    </span>
  );
}
