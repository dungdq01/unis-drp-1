/**
 * Chart color palette — UNIS SCP brand + data viz semantics.
 * Ref: MODULE-1-FULL-IMPLEMENT.md §Color Palette.
 * All Recharts components should import `COLORS` from this file.
 */

export const COLORS = {
  // Primary
  primary:   '#3B82F6', // blue-500
  secondary: '#10B981', // emerald-500
  accent:    '#8B5CF6', // violet-500
  warning:   '#F59E0B', // amber-500
  danger:    '#EF4444', // red-500

  // Segments A/B/C
  segA: '#3B82F6',
  segB: '#F59E0B',
  segC: '#94A3B8',

  // SKU Status (spec §Tab 1 Row 2)
  active:  '#3B82F6',
  ended:   '#EF4444',
  newItem: '#A855F7',
  other:   '#94A3B8',

  // Combo Class (6 distinct)
  dormantSeasonal: '#8B5CF6',
  coldStart:       '#EC4899',
  lumpy:           '#F59E0B',
  erratic:         '#EF4444',
  intermittent:    '#06B6D4',
  smooth:          '#10B981',

  // Accuracy buckets
  accGood:   '#10B981', // ≥70%
  accMedium: '#F59E0B', // 40–70%
  accBad:    '#EF4444', // <40%

  // Forecast chart gradients
  forecastFill:   ['#3B82F6', '#93C5FD'] as const,
  actualFill:     ['#10B981', '#6EE7B7'] as const,
  confidenceFill: '#E2E8F0',

  // Winner
  modelWin: '#10B981',
  ma3Win:   '#EF4444',
  tie:      '#94A3B8',

  // Grid
  grid:        '#E2E8F0',
  axis:        '#94A3B8',
  tooltipBg:   '#FFFFFF',
  tooltipText: '#1E293B',
};

/** Map accuracy % → color bucket */
export function accColor(pct: number | null | undefined): string {
  if (pct == null) return COLORS.other;
  if (pct >= 70) return COLORS.accGood;
  if (pct >= 40) return COLORS.accMedium;
  return COLORS.accBad;
}

/** Map combo class string → color (case-insensitive contains match) */
export function comboColor(cls: string | null | undefined): string {
  if (!cls) return COLORS.other;
  const s = cls.toUpperCase();
  if (s.includes('DORMANT')) return COLORS.dormantSeasonal;
  if (s.includes('COLD')) return COLORS.coldStart;
  if (s.includes('LUMPY')) return COLORS.lumpy;
  if (s.includes('ERRATIC')) return COLORS.erratic;
  if (s.includes('INTERMITTENT')) return COLORS.intermittent;
  if (s.includes('SMOOTH')) return COLORS.smooth;
  return COLORS.other;
}

/** Map SKU status → color */
export function statusColor(status: string | null | undefined): string {
  if (!status) return COLORS.other;
  const s = status.toUpperCase();
  if (s === 'ACT' || s === 'ACTIVE') return COLORS.active;
  if (s.startsWith('END')) return COLORS.ended;
  if (s === 'NEW') return COLORS.newItem;
  return COLORS.other;
}
