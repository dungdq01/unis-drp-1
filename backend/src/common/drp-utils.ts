/**
 * M23 spec §14.1 [C2 fix] — Shared DRP cell key helper.
 *
 * Key format: "${cnId}|${skuId}|${periodStart}"
 * - cnId: BIGINT as string
 * - skuId: BIGINT as string
 * - periodStart: Monday of planning week, YYYY-MM-DD
 *
 * Both M23 builder (drp.netting-v2.service) and M24 consumer MUST use this
 * helper — Map.get() returns undefined silently on mismatched keys, which
 * would masquerade as "no adjustment" and corrupt allocation output.
 */
export function drpCellKey(cnId: string, skuId: string, periodStart: string): string {
  return `${cnId}|${skuId}|${periodStart}`;
}

/** Parse a drpCellKey back into its components (for debugging / audit). */
export function parseDrpCellKey(
  key: string,
): { cnId: string; skuId: string; periodStart: string } | null {
  const parts = key.split('|');
  if (parts.length !== 3) return null;
  return { cnId: parts[0], skuId: parts[1], periodStart: parts[2] };
}
