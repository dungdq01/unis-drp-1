# M26 NM ATP Check & Urgency Ranking — Module Report

> **Sprint:** 5-7 · **DA:** DA1 · **Status:** DONE
> **Zone:** BUILD · **Depends on:** M24 (getAllocationResult), M21 (FreshnessGateService), M10 (config)
> **Consumed by:** M27 (getAtpResult → PO generation gate)

---

## BA Logic

### Pipeline (8 Steps)
1. **Validate**: M24 COMPLETED, feature flag check, R10 idempotent guard
2. **Policy snapshot pin** (Rule 14)
3. **Create atp_run** (RUNNING)
4. **Load requested qty** per (NM, SKU, week) via `sku_nm_mapping` (C1 fix: single-source NM lineage)
5. **Preload**: freshness map (M21), NM supply ATP qtys (line-level), transport lane LT, HSTK, CN codes
6. **Classify** each cell: PASS / PARTIAL / FAIL / BLOCKED
7. **Urgency ranking** for PARTIAL cells (R4-R6)
8. **Finalize** atp_run COMPLETED (H2 fix: run status ≠ BLOCKED — BLOCKED is cell-level only)

### Classification Matrix (R2/H1/H6 CTO fixes)
| Condition | Result | Reason |
|-----------|--------|--------|
| NM data stale | **BLOCKED** | STALE_DATA |
| `atp >= requested` | **PASS** | — |
| `0 < atp < requested` | **PARTIAL** | — |
| `atp = 0` | **FAIL** | ZERO_STOCK |

- **BLOCKED ≠ FAIL** (H1 fix): BLOCKED = cannot conclude (stale), FAIL = NM declares zero stock
- **is_atp_null_fallback** (H6 fix): warning flag when `atp_qty IS NULL` → fallback to `allocatable_qty`. Independent of result classification

### Urgency Ranking (PARTIAL cells only, R4-R6, C3)
- Sort: `is_critical DESC → hstk_days ASC → cn_code ASC` (deterministic)
- **CRITICAL** = `hstk_days < transit_lt_days` (C3 fix: days dimension, NOT SS qty)
- Waterfall: alloc ATP to recipients by rank until exhausted

### NM Honoring Rate (R7/R8/H3/C4)
- Formula: `rate = fulfilled_total / atp_at_check_total` (C4 fix: denominator = NM promise, NOT requested)
- `rolling_3m_rate < 0.80 → nm_unreliable_badge = TRUE` on supplier table
- Phase 1: rate=NULL (M27 `po_line.actual_received_qty` not available yet)
- Phase 2: auto-computes when M27 data present (try/catch guard)
- Cron: 1st of month 06:00 VN

### ATP Data Source (C2 fix)
- ATP qty from `supply_snapshot_line.atp_qty` (line-level, NM upload)
- NULL fallback: `allocatable_qty` + `is_atp_null_fallback=TRUE` flag
- Latest snapshot: `COALESCE(synced_at, captured_at)` to handle both M21 NM upload and legacy rows

---

## DB Schema

### Migration V007
| Table | Purpose |
|-------|---------|
| `supply_snapshot_line` extend | +atp_qty (NM upload ATP column) |
| `supplier` extend | +nm_unreliable_badge (rolling 3M < 80%) |
| `atp_run` (new) | Wrapper per allocation_run: status, stats, force rerun |
| `atp_check` (new) | Per (NM, SKU, week) result: PASS/PARTIAL/FAIL/BLOCKED + urgency JSONB |
| `nm_honoring_rate` (new) | Monthly metric: rate, rolling_3m_rate, cell counts |
| Feature flag | `m26_nm_atp_enabled` |
| Config seeds | `atp.staleness_threshold_hours=24`, `atp.honoring_warning_threshold=0.80` |

### Key Indexes
| Index | Purpose |
|-------|---------|
| `uq_atp_run_no_force` | 1 atp_run per allocation_run (force rerun excluded) |
| `uq_atp_check_cell` | No duplicate (run, nm, sku, period) |
| `idx_atp_check_result` | Filter by result type |
| `uq_nm_honoring_rate` | 1 rate per (nm, month) |

---

## API Endpoints

**Base:** `/api/v1/nm-atp` · **Guard:** `@UseGuards(FeatureFlagGuard)` + `@FeatureFlag('m26_nm_atp_enabled')`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/run` | Trigger ATP check for allocation_run |
| POST | `/run/force-rerun` | Force rerun (reason >= 20 chars) |
| GET | `/runs?status=&allocationRunId=` | List ATP runs |
| GET | `/runs/:id` | Run detail |
| GET | `/runs/:id/checks?nmId=&result=` | List ATP check cells |
| GET | `/runs/:id/critical` | CRITICAL recipient cells (HSTK < transit_LT) |
| GET | `/runs/:id/urgency/:checkId` | Urgency ranking detail for PARTIAL cell |
| GET | `/honoring?nmId=&fromMonth=&toMonth=` | NM honoring rate trend |
| GET | `/honoring/leaderboard` | NM leaderboard by rolling 3M rate |
| POST | `/honoring/recompute?month=` | Manual honoring rate recompute |

### M27 Contract: `getAtpResult(allocationRunId)`
```typescript
AtpResultDto {
  atpRunId, allocationRunId, planRunId, generatedAt,
  checks: Map<atpCellKey, AtpCheckDto>
}
AtpCheckDto { checkId, nmId, skuId, periodStart,
  requestedQty, atpQty, result, reason,
  isAtpNullFallback, urgencyRanking }

atpCellKey = "${nmId}|${skuId}|${weekStart}"  // common/atp-utils.ts
```

---

## FE

- Page: `app/nm-atp/page.tsx`
- API: `lib/api/nm-atp.ts` — 11 functions
- 3 tabs: ATP Check Results (run list + cell filter PASS/PARTIAL/FAIL/BLOCKED + fallback warning) | Critical Recipients (HSTK < transit_LT) | NM Honoring Leaderboard (rolling 3M rate + badge)
- Types: `AtpRun`, `AtpCheck`, `UrgencyRankEntry`, `NmHonoringRate`, `HonoringLeaderboardEntry`
- Sidebar: D3 Supply Intake > NM ATP Check (isNew badge)

---

## Test

- `nm-atp.service.spec.ts` — run pipeline, idempotent, force rerun, classification, urgency ranking, M24 load

---

## Deferred

| Item | Reason |
|------|--------|
| M26-4: `po_line` table (honoring rate Phase 2) | M27 not yet built. Phase 1 try/catch guard safe. M27 must create `po_line` with `nm_id`, `actual_received_qty`, `delivered_at` |

---

## Source Files
| Layer | Path |
|-------|------|
| NmAtpService | `backend/src/nm-atp/nm-atp.service.ts` |
| AtpClassificationService | `backend/src/nm-atp/atp-classification.service.ts` |
| UrgencyRankingService | `backend/src/nm-atp/urgency-ranking.service.ts` |
| HonoringRateService | `backend/src/nm-atp/honoring-rate.service.ts` |
| Controller | `backend/src/nm-atp/nm-atp.controller.ts` |
| Module | `backend/src/nm-atp/nm-atp.module.ts` |
| Shared | `common/atp-utils.ts` (atpCellKey, AtpResult type) |
| Exports | `NmAtpService` (M27 consumer) |
