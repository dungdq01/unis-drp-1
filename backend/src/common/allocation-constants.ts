/**
 * M24 spec §6 [M7 fix] — Shared allocation constants.
 *
 * HUB_VIRTUAL_ID: source_entity_id placeholder for source_type='HUB' legs.
 * Phase 1 uses 0 (hub ảo). Phase 2 will point to real hub entity ID when
 * M16 Hub ảo physical inventory lives.
 *
 * All M23/M24/M25 code MUST import this constant — any raw `0` literal in a
 * source_entity_id context is a bug (invisible when grepping for "HUB").
 */
export const HUB_VIRTUAL_ID = '0';

/**
 * M24 allocation_leg.source_type enum values (also enforced by CHECK constraint
 * in V005 migration — see allocation_leg schema).
 */
export const LEG_SOURCE_TYPES = [
  'HUB',
  'CN_REDIST',
  'NM',
  'TOP_UP_NEXT_WEEK', // M25 C2 cross-link
  'UNKNOWN',
] as const;

export type LegSourceType = typeof LEG_SOURCE_TYPES[number];
