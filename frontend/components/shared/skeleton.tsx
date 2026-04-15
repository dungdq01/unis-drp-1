'use client';

/**
 * Lightweight skeleton placeholders — used while data fetching.
 * Pure CSS (Tailwind animate-pulse), no library dependency.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-slate-200/60 animate-pulse rounded ${className}`} />;
}

/** Skeleton tuned for KPI cards (Row 1/2 layout). */
export function KpiCardSkeleton() {
  return (
    <div className="kpi-card py-4">
      <Skeleton className="h-3 w-16 mb-2" />
      <Skeleton className="h-8 w-24 mb-2" />
      <Skeleton className="h-2 w-20" />
    </div>
  );
}

/** Skeleton for chart cards (square-ish block). */
export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)]">
        <Skeleton className="h-3 w-32 mb-2" />
        <Skeleton className="h-2 w-48" />
      </div>
      <div className="p-4" style={{ height }}>
        <Skeleton className="w-full h-full" />
      </div>
    </div>
  );
}

/** Skeleton row for data table. */
export function TableRowSkeleton({ cols = 8 }: { cols?: number }) {
  return (
    <tr className="border-b border-[rgba(148,173,215,0.08)]">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-2"><Skeleton className="h-3 w-full" /></td>
      ))}
    </tr>
  );
}
