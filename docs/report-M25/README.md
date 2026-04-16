# M25 Transport Lot Sizing v2 — Module Report

> **Sprint:** 6 · **DA:** DA1 · **Status:** DONE
> **Zone:** EXTEND · **Depends on:** M24 (getAllocationResult), M10 (config), M00 (transport_lane, carrier, vehicle_type, sku, channel)
> **Consumed by:** M27 (getTransportPlan → PO generation)

---

## BA Logic

### Pipeline (9 Steps)
1. **Load M24 allocation result** — `AllocationLcnbService.getAllocationResult(allocationRunId)`
2. **Reuse policy snapshot** from M24/M23 (Rule 14 — no new snapshot)
3. **Create transport_plan** (status=RUNNING)
4. **RAW BUILD trips** — group allocation legs by (source, dest), resolve HUB code + SKU weight/pallet
5. **MULTI-DROP CONSOLIDATION** — union-find clustering (pairwise distance ≤ maxGroupDistanceKm), nearest-neighbor stop sequencing, bin-pack into vehicle capacity
6. **COMPUTE fill_ratio** — `MAX(pallets/maxPallets, weight/maxWeight)`
7. **HOLD DECISION** per trip (see Hold Logic below)
8. **PERSIST** trips + stops + lines; reserve `supply_snapshot_line.reserved_for_transport`
9. **FINALIZE** (COMPLETED or COMPLETED_PARTIAL if NO_CARRIER trips)

### Hold-or-Ship Decision (spec R3-R5)
| Condition | Decision | Action |
|-----------|----------|--------|
| `fill >= min_fill_ratio (0.6)` | SHIP | status = PLANNED |
| `fill < min_fill AND HSTK > LT + buffer` | HOLD | hold_until = MIN(holdMaxDays, HSTK-LT-buffer) |
| `fill < min_fill AND HSTK <= LT + buffer` | FORCE_SHIP_LOW_FILL | status = PLANNED (stockout risk) |
| Cap: `held_at + hold_max_days` reached | FORCE_SHIP_TIMEOUT | Cron 06:00 VN auto-releases |

### Top-Up Suggestion (spec §6)
- Generated for HELD trips: query next-week forecast at dest, filter unallocated items, check supply available at source (line-level), greedy-fill remaining vehicle capacity
- Accept flow (transaction): `top_up_suggestion → ACCEPTED` + INSERT `allocation_result` (is_top_up=TRUE) + `allocation_leg` (TOP_UP_NEXT_WEEK) + `transport_trip_line` + bump `reserved_for_transport`
- Reject: status → REJECTED

### Multi-Drop Consolidation (spec §5, H3)
- Phase 1: union-find on pairwise dest distance ≤ 200km (configurable)
- Within group: nearest-neighbor greedy sequence from source
- Bin-pack: split into multiple vehicles when capacity exceeded

### M27 Contract: `getTransportPlan(planId)` (spec §14.1)
- Returns `TransportPlanDto` with trips + stops + lines
- **H5 precedence gate**: NOT_COMPLETED → NO_CARRIER → pass
- NO_CARRIER throws `TransportPlanIncompleteException` — M27 must assign carrier first

### Cron
| Time (VN) | Purpose |
|-----------|---------|
| 06:00 | Held-release: fill improved → SHIP, cap reached → FORCE_SHIP_TIMEOUT |

### Idempotent & Force Rerun
- Partial unique index `uq_transport_plan_no_force` (1 plan per allocation_run, force rerun excluded)
- Force rerun: `reason >= 20 chars`, `is_force_rerun=TRUE`

---

## DB Schema

### Migration V006
| Change | Description |
|--------|-------------|
| `transport_trip` extend | +fill_ratio, hold_decision, hold_until_date, hold_reason, held_at, is_multi_drop, stop_count, policy_run_id, allocation_run_id, cancel_reason |
| `transport_plan` extend | +allocation_run_id, policy_run_id, is_force_rerun, force_rerun_reason, total_trips, held_trips, multi_drop_trips, avg_fill_ratio |
| `transport_trip_line` extend | +stop_id (FK trip_stop), source_allocation_leg_id, top_up_suggestion_id |
| `supply_snapshot_line` extend | +reserved_for_transport (anti double-allocation) |
| `transport_trip_stop` (new) | Multi-drop unload stops: trip_id, stop_sequence, location_code, pallets, weight, ETA |
| `top_up_suggestion` (new) | HELD trip top-up: item, qty, pallets, weight, priority, source_period_start, forecast_week_offset, demand_source |
| Cross-links | FK `allocation_result.source_top_up_id → top_up_suggestion`, `allocation_leg.origin_top_up_id → top_up_suggestion` |
| Feature flag | `m25_transport_v2_enabled` |
| Config seed | `transport.max_multidrop_distance_km = 200` (3 others owned by M10) |

### Key Indexes
| Index | Purpose |
|-------|---------|
| `uq_transport_plan_alloc_run` | 1 plan per allocation_run |
| `uq_transport_plan_no_force` | Excludes force reruns |
| `idx_trip_hold_release` | Cron 06:00 held-release hot path |
| `idx_supply_line_reserved_transport` | Reconcile reserved_for_transport |
| `uq_trip_stop_seq` | No duplicate stops per trip |
| `idx_top_up_trip_status` | Top-up query by trip + status |

---

## API Endpoints

**Base:** `/api/v1/transport` · **Guard:** `@FeatureFlag('m25_transport_v2_enabled')` on v2 methods

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/run` | Trigger lot sizing for allocation_run |
| POST | `/v2/run/force-rerun` | Force rerun (reason >= 20 chars) |
| GET | `/v2/plans?status=` | List transport plans |
| GET | `/v2/plans/:id` | Plan detail (M27 contract) |
| GET | `/v2/plans/:id/trips?status=` | List trips for plan |
| GET | `/v2/trips/:id` | Trip detail + stops + lines + top-ups |
| POST | `/v2/trips/:id/release` | Release HELD trip → PLANNED |
| POST | `/v2/trips/:id/hold-extend` | Extend hold (capped at hold_max_days) |
| POST | `/v2/trips/:id/cancel` | Cancel trip (reason >= 20 chars) + release reservation |
| GET | `/v2/trips/:id/top-up` | List top-up suggestions |
| POST | `/v2/top-up/:id/accept` | Accept top-up (transaction) |
| POST | `/v2/top-up/:id/reject` | Reject top-up |

### v1 Legacy (untouched)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/eligible-runs` | Allocation runs ready for transport |
| POST/GET | `/plans`, `/plans/:id` | CRUD transport plans |
| POST | `/plans/:id/confirm` | Confirm plan |
| GET | `/plans/:id/trips` | List trips |
| GET/PATCH | `/trips/:id`, `/trips/:id/lines` | Trip detail + override |
| CRUD | `/carriers`, `/lanes` | Master data (upsert + CSV upload) |

---

## FE

- Page: `app/transport/page.tsx` (existing — extended for v2)
- API: `lib/api/transport.ts` — v1 legacy (14 functions) + v2 (12 functions)
- v2 types: `TransportPlanV2`, `TransportTripV2`, `TripStop`, `TopUpSuggestionV2`, `TransportRunSummary`
- v2 functions: `runTransportV2`, `forceRerunTransportV2`, `listTransportPlansV2`, `getTransportPlanV2`, `listTripsV2`, `getTripV2`, `releaseHeldTrip`, `extendHold`, `cancelTrip`, `listTopUpSuggestions`, `acceptTopUp`, `rejectTopUp`
- Sidebar: D6 Transport > Transport Lot v2

---

## Test

- `transport.lot-sizing.service.spec.ts` — runV2 pipeline, feature flag gate, idempotent, force rerun, M24 load failure, COMPLETED_PARTIAL (NO_CARRIER), getTransportPlan (H5 precedence: NOT_COMPLETED > NO_CARRIER), held-release cron
- `transport.multi-drop.service.spec.ts` — computeFillRatio, single full trip, multi-drop nearest-neighbor sequence, capacity split into 2 vehicles, cluster threshold

---

## Deferred (Sprint 7)

| Item | Reason |
|------|--------|
| BUG-M25-5: v2 assign-carrier endpoint | SA design decision needed |
| BUG-M25-6: extract `_msUntilVN()` to common | Tech-debt, low priority |

---

## Source Files
| Layer | Path |
|-------|------|
| TransportLotSizingService | `backend/src/transport/transport.lot-sizing.service.ts` |
| TransportMultiDropService | `backend/src/transport/transport.multi-drop.service.ts` |
| TransportTopUpService | `backend/src/transport/transport.top-up.service.ts` |
| TransportService (v1) | `backend/src/transport/transport.service.ts` |
| Controller | `backend/src/transport/transport.controller.ts` |
| Module | `backend/src/transport/transport.module.ts` |
| Entities | `transport-trip-stop.entity.ts`, `top-up-suggestion.entity.ts` (new) + extended existing |
| Shared | `common/allocation-constants.ts` (HUB_VIRTUAL_ID), `common/date-utils.ts` (mondayOfStr) |
| Exports | `TransportService`, `TransportLotSizingService`, `TransportTopUpService` |
