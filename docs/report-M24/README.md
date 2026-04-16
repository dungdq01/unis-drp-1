# M24 Allocation Engine LCNB v2 — Module Report

> **Sprint:** 5 · **DA:** DA1 · **Status:** DONE
> **Zone:** EXTEND · **Depends on:** M23 (getDrpResult), M10 (config), M00 (channel, sku, transport_lane)
> **Consumed by:** M25 (getAllocationResult), M27 (planner review)

---

## BA Logic

### 3-Tier Waterfall (per CN x SKU x Week)
1. **Hub pool** — fair-share capped allocation from virtual hub inventory (Phase 1: hub=0, M16 not live)
2. **LCNB lateral** — CN_REDIST from OVER_STOCK donors, NEAREST_FIRST sort by distance_km
3. **STOCKOUT flag** — remaining need unmet → `PARTIAL_STOCKOUT` or `UNALLOCATED`

### LCNB Rules (from M10 policy snapshot)
| Rule | Config Key | Default | Logic |
|------|-----------|---------|-------|
| R4 | — | — | Sort donors NEAREST_FIRST (distance_km ASC) |
| R5 | `lcnb.max_distance_km` | 500 | Skip donor if distance > max |
| R6 | `lcnb.min_excess_threshold` | 50 | Skip donor if excess < threshold |
| R7 | `lcnb.max_transfer_pct` | 0.80 | Cap transfer at % of donor excess |
| Mode | `lcnb.enabled` | DETECT_ONLY | 3-state: OFF / DETECT_ONLY / EXECUTE |

### Fair-Share Pre-compute
- Per (sku, week) grain: if `hub_available < total_demand`, quota = `hub * (cn_demand / total)`
- Prevents first-come CN from starving others

### Variant Match Post-process
- Splits allocated base qty across M23 variant_suggestion proportionally
- Flags `VARIANT_MISMATCH` + `planner_review_required` when base < suggestion total

### Status Values
| Status | Meaning |
|--------|---------|
| `FULL` | qtyAllocated >= netDemand |
| `PARTIAL` | 0 < allocated < demand (hub partial) |
| `PARTIAL_STOCKOUT` | LCNB couldn't fill remaining |
| `UNALLOCATED` | zero allocated |

### Idempotent & Force Rerun
- Partial unique index `uq_alloc_run_plan_run` (excludes force reruns)
- Force rerun: `reason >= 20 chars`, `is_force_rerun=TRUE`
- M23 retry: `_fetchDrpWithRetry()` 5 attempts x 30s (race condition guard)

---

## DB Schema

### Migration V005
| Change | Description |
|--------|-------------|
| `allocation_run` extend | +policy_run_id, lcnb_enabled, total_legs_count, lcnb_transfers_count, partial_stockout_count, is_force_rerun |
| `allocation_result` extend | +cn_id, sku_id, period_start, planner_review_required, review_reason, variant_breakdown (JSONB) |
| `allocation_result` relax | planned_order_id DROP NOT NULL (M24 rows from drp_cn_line, not planned_order_release) |
| `allocation_leg` extend | +source_period_start, origin_top_up_id (M25 cross-link), CHECK adds TOP_UP_NEXT_WEEK |
| Feature flag | `m24_allocation_lcnb_enabled` |

### Key Indexes
| Index | Purpose |
|-------|---------|
| `uq_alloc_run_plan_run` | 1 allocation per plan_run (force rerun excluded) |
| `uq_alloc_result_cell` | No duplicate (run, cn, sku, period) |
| `idx_alloc_leg_run` | M25 leg iteration hot path |

---

## API Endpoints

**Base:** `/api/v1/allocation` · **Guard:** `@FeatureFlag('m24_allocation_lcnb_enabled')` on v2 methods

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/run` | Trigger LCNB allocation for plan_run |
| POST | `/v2/run/force-rerun` | Force rerun (reason >= 20 chars) |
| GET | `/v2/runs?planRunId=` | List allocation runs |
| GET | `/v2/runs/:id` | Run detail + stats |
| GET | `/v2/runs/:id/results?cnId=&status=` | Paginated allocation_result |
| GET | `/v2/runs/:id/legs?sourceType=` | Paginated allocation_leg |
| GET | `/v2/runs/:id/lcnb-summary` | Donor → recipient transfer summary |
| GET | `/v2/runs/:id/review-required` | Rows needing planner review |
| GET | `/v2/runs/:id/result` | **M25 contract** — AllocationResultDto (Map→Object) |

### M25 Contract: `AllocationResultDto`
```typescript
{ allocationRunId, planRunId, policyRunId, generatedAt,
  results: Map<allocCellKey, AllocationCellDto> }

AllocationCellDto: { cnId, skuId, periodStart,
  qtyRequired, qtyAllocated, status,
  plannerReviewRequired, reviewReason,
  legs: AllocationLegDto[], variantBreakdown }

AllocationLegDto: { sourceType, sourceEntityId,
  sourceLotId, allocatedQty, fifoRank, distanceKm }

allocCellKey = "${cnId}|${skuId}|${periodStart}"  // matches drpCellKey grain
```

---

## FE

- Page: `app/allocation/page.tsx` (26KB — full allocation UI)
- API: `lib/api/allocation.ts` — v1 legacy (9 functions) + v2 LCNB (9 functions)
- v2 types: `AllocationV2Run`, `AllocationV2Result`, `AllocationV2Leg`, `LcnbSummaryRow`
- Sidebar: D5 Allocation > Allocation LCNB

---

## Test

- `allocation.lcnb.service.spec.ts` — gate, idempotent, M22 fallback, LCNB waterfall, force rerun
- `allocation.fair-share.service.spec.ts` — quota computation, hub shortfall
- `allocation.variant-match.service.spec.ts` — proportional split, VARIANT_MISMATCH flag
- `allocation.service.spec.ts` — legacy v1 engine

---

## Source Files
| Layer | Path |
|-------|------|
| AllocationLcnbService | `backend/src/allocation/allocation.lcnb.service.ts` |
| AllocationFairShareService | `backend/src/allocation/allocation.fair-share.service.ts` |
| AllocationVariantMatchService | `backend/src/allocation/allocation.variant-match.service.ts` |
| AllocationService (v1 legacy) | `backend/src/allocation/allocation.service.ts` |
| Controller | `backend/src/allocation/allocation.controller.ts` |
| Module | `backend/src/allocation/allocation.module.ts` |
| Shared | `common/allocation-constants.ts` (HUB_VIRTUAL_ID, LegSourceType) |
| Exports | `AllocationService`, `AllocationLcnbService` |
