export const DRP_CONFIG = {
  HORIZON_WEEKS:   12,
  FROZEN_ZONE:      2,   // weeks 1–2: NEEDS_APPROVAL
  LOT_SIZING:    'L4L' as const,
  BOM_EXPLOSION: false,
  DEMAND_BASIS:  'MAX_FORECAST_PO' as const,
  PO_CUTOFF_DAYS:  90,
  PAB_NEGATIVE_MODE: 'RAISE_EXCEPTION' as const,
  TIMEOUT_MS:    60_000,

  // Lead Time note: NOT used in DRP netting.
  // LT is already embedded in SS (Module 3). Module 5 uses RTM.transport_days.
  // DRP only uses SS as the threshold trigger.

  // HSTK thresholds — monitoring only, NOT DRP trigger
  HSTK_STOCKOUT_THRESHOLD:  1.5,  // < 1.5 weeks → STOCKOUT_ALERT (HIGH)
  HSTK_OVERSTOCK_THRESHOLD: 3.0,  // > 3.0 weeks → OVERSTOCK_ALERT (LOW)

  BATCH_SIZE: 500,
} as const;
