export const UNIS_MONITOR_CONFIG = {
  hstk: {
    stockoutThreshold: 1.5,   // weeks — CRITICAL alert
    overstockThreshold: 3.0,  // weeks — WARNING alert
  },
  drift: {
    demandDriftPct: 20,        // % — WARNING/CRITICAL (Phase 2)
    psiThreshold: 0.30,        // CRITICAL (Phase 2)
    criticalMultiplier: 40,    // drift > 40% → CRITICAL (Phase 2)
  },
  service: {
    fillRateTarget: 0.92,      // 92% (Phase 2)
    otifTarget: 0.90,          // 90% (Phase 2)
  },
  workingCapital: {
    inventoryTurnsTarget: 6.0, // (Phase 2)
  },
  trust: {
    overrideRateTarget: 0.25,  // ≤ 25% — Phase 1: proxy = cancel_rate
  },
  aiValue: {
    mapeTarget: 25,            // % (Phase 2/3 — blocked: actual_sales)
  },
  execution: {
    poOverdueDays: 10,         // UNIS threshold = 10 ngày (not 7)
    approvalSlaHours: 48,      // hours target
  },
  dataQuality: {
    completenessTarget: 0.9,   // 90%
  },
} as const;
