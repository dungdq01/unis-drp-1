# M27 PO/TO Review & Confirm — Module Report

> **Sprint:** 7-8 · **DA:** DA1 · **Status:** DONE · **Type:** REBUILD (M7 deprecated)
> **Zone:** BUILD · **Depends on:** M25 (getTransportPlan), M26 (getAtpResult), M24 (allocation_run), M10 (config)
> **Consumed by:** M28 (getPoFulfillment, getActualLtPerNmRoute)

---

## BA Logic

### AND Correlation Gate (M1 CTO fix)
- `po_run_pending` table: row created when M25 OR M26 completes for an allocation_run
- M27 auto-triggers **only when both `m25_done=TRUE` AND `m26_done=TRUE`**
- Manual trigger also available via `POST /po-review/run`

### Pipeline (8 Steps)
1. **Hard gate — NO_CARRIER** (R3): if transport_plan has NO_CARRIER trips → `BLOCKED_INCOMPLETE`, blocks entire run
2. **Hard gate — M26 ATP** completed: loads `AtpResultDto` from M26
3. **Policy pin** (Rule 14) from M24 allocation_run
4. **Load allocation legs** with NM resolution via `sku_nm_mapping` (C1/C2/C3)
5. **ATP gate per cell**: BLOCKED → skip, FAIL → skip, PARTIAL → clamp to urgency `atp_alloc` (H1+H2)
6. **Group + insert** PO headers/lines (HUB/NM legs) + TO headers/lines (CN_REDIST legs)
7. **Status DRAFT** — planner review window 00:30-05:00 VN
8. **Finalize** po_run COMPLETED

### PO/TO Separation (R5/R6)
| Source Type | Document | Granularity |
|-------------|----------|-------------|
| HUB / NM / TOP_UP_NEXT_WEEK | **PO** (Purchase Order) | 1 PO = 1 NM → 1 CN |
| CN_REDIST | **TO** (Transfer Order) | 1 TO = 1 donor CN → 1 receiver CN |

### ATP Gate Rules (H1+H2 CTO)
| ATP Result | M27 Action |
|------------|------------|
| PASS | Full qty → PO line |
| PARTIAL | Clamp qty to `urgencyRanking.atpAlloc` per CN |
| FAIL | Skip cell (NM zero stock) |
| BLOCKED | Skip cell (stale data, sync NM first) |

### PO Lifecycle (State Machine)
```
DRAFT → CONFIRMED → SHIPPED → RECEIVED → CLOSED
DRAFT → CANCELLED
CONFIRMED → CANCELLED
```
- CONFIRM: idempotency-key header (R13)
- CANCEL: mandatory reason ≥ 20 chars (R11)
- SHIPPED: requires vehicle_no + carrier_code + container_no (R9)
- RECEIVED: actual_received_qty per line (R10, feeds M28)

### PO Number Format
- PO: `PO-YYYYMM-NNNNN` (PostgreSQL sequence `po_number_seq`, race-safe)
- TO: `TO-YYYYMM-NNNNN` (PostgreSQL sequence `to_number_seq`)

### Edit Audit (R7/R8)
- Every PO/TO line edit writes `po_edit_log` / `to_edit_log`
- Fields: field_changed, old_value, new_value, **mandatory reason**, changed_by
- Duplicate SKU lines: `ON CONFLICT DO UPDATE SET requested_qty += EXCLUDED`

### Overdue Check (R12)
- Cron 09:00 VN: PO CONFIRMED > `po.overdue_days` (7) without SHIPPED → PO_OVERDUE alert
- Manual trigger: `POST /po-review/po/check-overdue`

---

## DB Schema

### Migration V008 (10 tables + 2 sequences)
| Table | Purpose |
|-------|---------|
| `po_run_pending` | AND correlation gate (M25 + M26 event) |
| `po_run` | Run wrapper: status, stats, force rerun |
| `po_header` | PO per NM × CN (DRAFT→CONFIRMED→SHIPPED→RECEIVED→CLOSED) |
| `po_line` | Line per SKU: qty, variant, lineage, top-up flag, variant review |
| `to_header` | TO per donor × receiver CN |
| `to_line` | Line per SKU |
| `po_edit_log` | PO mandatory audit |
| `to_edit_log` | TO mandatory audit |
| `po_tracking` | Vehicle/carrier/ETA (1:1 with po_header) |
| `to_tracking` | Same for TO |
| `po_number_seq` | Atomic PO number counter |
| `to_number_seq` | Atomic TO number counter |

### Key Indexes
| Index | Purpose |
|-------|---------|
| `uq_po_run_primary` | 1 po_run per allocation_run (force rerun excluded) |
| `uq_po_line` | UNIQUE (header, sku, COALESCE(variant, '')) — NULL-safe |
| `uq_to_line` | Same for TO |

### Seeds
- Feature flag: `m27_po_rebuild_enabled` (in `feature_flag` table)
- Config: `po.overdue_days = 7` (group: ORDER)

---

## API Endpoints

### PO Controller — `/api/v1/po-review` · Guard: `@FeatureFlag('m27_po_rebuild_enabled')`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/run` | Trigger PO/TO generation (allocationRunId + transportPlanId + atpRunId) |
| POST | `/run/force-rerun` | Force rerun (reason ≥ 20 chars) |
| GET | `/runs` | List PO runs |
| POST | `/event/m25-done` | M25 event callback |
| POST | `/event/m26-done` | M26 event callback |
| GET | `/po?status=&nmId=&cnId=` | List PO headers |
| GET | `/po/:id` | PO detail + lines + edit log + tracking |
| GET | `/po/:id/edit-log` | PO audit log |
| PATCH | `/po/:id/lines/:lineId` | Edit PO line (mandatory reason) |
| POST | `/po/:id/lines` | Add SKU line to DRAFT PO |
| DELETE | `/po/:id/lines/:lineId` | Soft-delete PO line |
| POST | `/po/:id/confirm` | DRAFT → CONFIRMED (idempotency-key) |
| POST | `/po/:id/cancel` | Cancel PO (reason ≥ 20 chars) |
| PATCH | `/po/:id/transition` | SHIPPED / RECEIVED / CLOSED |
| POST | `/po/check-overdue` | Manual overdue check |
| GET | `/po/:id/tracking` | PO tracking detail |
| PATCH | `/po/:id/tracking` | Update tracking fields |
| GET | `/po/:id/fulfillment` | **M28 contract** — per-line fulfillment data |

### TO Controller — `/api/v1/po-review/to` · Guard: `@FeatureFlag('m27_po_rebuild_enabled')`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List TO headers |
| GET | `/:id` | TO detail + lines + edit log + tracking |
| POST | `/:id/confirm` | Confirm TO |
| POST | `/:id/cancel` | Cancel TO |
| GET | `/:id/tracking` | TO tracking |
| PATCH | `/:id/tracking` | Update TO tracking |
| PATCH | `/:id/transition` | SHIPPED / RECEIVED / CLOSED |

### M28 Contracts
```typescript
getPoFulfillment(poId): PoFulfillmentDto  // per-line: requested, confirmed, actual_received
getActualLtPerNmRoute(nmId, cnId, from, to): number[]  // rolling actual LT days
```

---

## FE

- Page: `app/po-review/page.tsx`
- API: `lib/api/po-review.ts` — 12 functions
- Types: `PoRun`, `PoHeader`, `PoLine`, `PoEditLog`, `ToHeader`, `ToLine`
- Sidebar: D7 Order Management > PO Review (isNew badge)

---

## Test

- `po-review.service.spec.ts` — 16 test cases
- Coverage: generate pipeline, AND correlation, ATP gate (BLOCKED/FAIL/PARTIAL clamp), NO_CARRIER block, idempotent, force rerun, PO number sequence, TO separation, fulfillment contract

---

## Deferred

| Item | Reason |
|------|--------|
| M27-3: skip counter for missing NM mapping | Low priority, warning log exists |

---

## Source Files
| Layer | Path |
|-------|------|
| PoReviewService | `backend/src/po-review/po-review.service.ts` |
| PoEditService | `backend/src/po-review/po-edit.service.ts` |
| PoTransitionService | `backend/src/po-review/po-transition.service.ts` |
| PoOverdueService | `backend/src/po-review/po-overdue.service.ts` |
| PoTrackingService | `backend/src/po-review/po-tracking.service.ts` |
| PoReviewController | `backend/src/po-review/po-review.controller.ts` |
| ToReviewController | `backend/src/po-review/to-review.controller.ts` |
| Module | `backend/src/po-review/po-review.module.ts` |
| Shared | `common/atp-utils.ts` (atpCellKey — M26 contract key) |
| Exports | `PoReviewService` (M28 consumer) |
