export const UNIS_TRANSPORT_CONFIG = {
  vehicleFallback: {
    FLATBED:     { capacityKg: 25000, costMultiplier: 1.0 },
    CRANE_TRUCK: { capacityKg: 15000, costMultiplier: 1.3 },
  } as Record<string, { capacityKg: number; costMultiplier: number }>,

  blockOnMissingWeight: true,

  consolidation: false,
  co2Tracking: false,
  carrierSelectionMode: 'BEST_SLA' as const,
  departureDaysFromToday: 1,
  insertChunkSize: 500,
} as const;
