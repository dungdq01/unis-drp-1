'use client';

import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  /** Height in px for chart body. Omit for auto. */
  height?: number;
  className?: string;
  children: ReactNode;
}

/**
 * Shared chart wrapper: glass-card + title + subtitle + optional action slot.
 * All Recharts must be wrapped in ResponsiveContainer inside this.
 */
export function ChartCard({ title, subtitle, action, height, className = '', children }: Props) {
  return (
    <div className={`glass-card overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-[rgba(148,173,215,0.15)] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="section-label">{title}</p>
          {subtitle && <div className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</div>}
        </div>
        {action}
      </div>
      <div className="p-4" style={height ? { height } : undefined}>{children}</div>
    </div>
  );
}
