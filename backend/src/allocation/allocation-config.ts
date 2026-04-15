export const UNIS_ALLOCATION_CONFIG = {
  fefoEnabled: false,
  variantMatchEnabled: false,   // Phase 2: khi lot_attribute có specs_id

  abcWeights: { A: 2.0, B: 1.5, C: 1.0 } as Record<string, number>,

  ssGuardEnabled: true,         // L5: bật SS guard (Sprint 4)

  lcnbMode: 'DETECT_ONLY' as const,  // L6: recommend only, không auto-transfer
  lcnbSurplusThreshold: 1,

  dispatchLimit: 800,           // warning-only Phase 1

  insertChunkSize: 200,

  allocateWeekNumbers: [1],
} as const;
