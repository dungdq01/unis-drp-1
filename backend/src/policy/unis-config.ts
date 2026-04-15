export const UNIS_CONFIG = {
  Z_SCORES: {
    A: 1.96,
    B: 1.645,
    C: 1.282,
  },
  DOS_TARGETS: {
    A: 14,
    B: 21,
    C: 30,
  },
  LT_VARIABILITY_PCT: 0.20,
  SIGMA_SOURCE: 'fc_error' as const,
  SIGMA_FALLBACK_PCT: 0.30,
  LCNB_MODE: 'DETECT_ONLY' as const,
  LCNB_FACTOR: -0.25,
  ABC_DISCREPANCY_THRESHOLD: 0.10,
  SS_BATCH_SIZE: 100,
} as const;

export const CSL_TARGETS = { A: 0.975, B: 0.95, C: 0.90 } as const;
