/**
 * M26 — Shared ATP cell key helper.
 * Pattern mirrors drpCellKey (M23) and allocCellKey (M24) — 3-part grain.
 *
 * M26 builder + M27 consumer MUST import this helper.
 * Direct string interpolation in consumer code is a bug.
 */
export function atpCellKey(nmId: string, skuId: string, weekStart: string): string {
  return `${nmId}|${skuId}|${weekStart}`;
}

/**
 * ATP result enum — 4 states per H1 CTO fix.
 * BLOCKED ≠ FAIL: BLOCKED = chưa được phép kết luận (stale data).
 *                 FAIL    = NM thực sự không có hàng (declarative).
 */
export const ATP_RESULTS = ['PASS', 'PARTIAL', 'FAIL', 'BLOCKED'] as const;
export type AtpResult = typeof ATP_RESULTS[number];
