# M22 CN Demand Adjustment & Trust Score — Module Report

> **Sprint:** 3 · **DA:** DA2 · **Status:** DONE
> **Zone:** EXTEND · **Depends on:** M10 (config), M00 (channel, sku)
> **Consumed by:** M23 (getEffectiveDemand), M28 (trust score backfill)

---

## BA Logic

### CN Demand Adjustment Flow
1. **CN submit** `POST /cn-adjust` — before cutoff 18:00 VN
2. System computes `delta_pct = (adjusted - fc) / fc * 100`
3. **Trust score lookup** for the CN (lazy-create default 100 if first time)
4. **Effective tolerance**: base `cn_adjust.tolerance_pct` (30%), reduced to 15% if trust < 60%
5. **Auto-approve** if `|delta| <= tolerance AND trust >= 85%` → `AUTO_APPROVED`
6. **Pending** if `|delta| > tolerance` OR `trust < 85%` → `PENDING` (SC Manager queue)
7. **reason_text mandatory** when `|delta| > tolerance`
8. **Re-submit**: transaction expires old ACTIVE row → insert new (partial unique index guard)

### Force Submit (SC Manager)
- Bypasses cutoff, `reason_text >= 20 chars`, status = `FORCE_APPROVED`

### Cutoff Cron (18:05 VN daily)
- Expires all `PENDING` rows for current week (`period_date = mondayOfStr(vnToday)`)

### Trust Score
- Recalculated weekly (Monday 06:00 VN cron)
- Formula: `(accurate_adjustments_12w / total_adjustments_12w) * 100`
- Accurate = `|adjusted - actual| / actual <= 20%`
- Phase 1: grace period (no actual_qty data yet → score=100)
- Phase 2: M28 backfills `actual_qty` + `is_accurate`

### M23 Integration
- `getEffectiveDemand(weekStart)` returns `Map<"cnId|skuId", adjusted_qty>`
- M23 fallback: key not found → use FC raw
- weekStart auto-normalized to Monday via `mondayOfStr()`

---

## DB Schema

### Migration V003
| Table | Purpose |
|-------|---------|
| `reason_code` | Lookup (6 seeds: NEW_PROJECT, PROJECT_DELAY, COMPETITOR_PROMO, OWN_PROMO, WEATHER, OTHER) |
| `trust_score` | Per-CN score (FK channel.id), grace period flag |
| `cn_adjust_audit_log` | Action audit (SUBMIT, APPROVE, REJECT, FORCE, EXPIRE) |
| `cn_demand_adjustment` | Core table — FK channel, sku, reason_code |

### Key Indexes
| Index | Purpose |
|-------|---------|
| `uq_active_adj (cn_id, sku_id, period_date) WHERE status IN (active)` | 1 active per CN x SKU x week |
| `idx_cn_adj_period_status WHERE status IN (approved)` | M23 hot path |

---

## API Endpoints

**Base:** `/api/v1/cn-adjust` · **Guard:** `@FeatureFlag('m22_cn_demand_adjust_enabled')`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | CN submit adjustment |
| POST | `/force` | SC Manager force (bypass cutoff) |
| GET | `/queue` | PENDING review queue |
| GET | `/my?cnId=` | CN own adjustments |
| GET | `/history` | All history (SC Manager) |
| PATCH | `/:id/approve` | Approve PENDING |
| PATCH | `/:id/reject` | Reject PENDING |
| GET | `/trust` | Trust scores all CNs |
| GET | `/effective-demand?weekStart=` | M23 demand map (also FE audit) |
| GET | `/reason-codes` | FE dropdown |

---

## FE

- Page: `app/cn-demand-adjust/page.tsx`
- API: `lib/api/cn-adjust.ts`
- 3 tabs: Review Queue (approve/reject) | History (paginated + status badges) | Trust Scores (card grid)
- Submit Adjustment modal with reason code dropdown
- Sidebar: D2 Demand Planning > CN Demand Adjust (isNew badge)

---

## Test

- `cn-adjust.service.spec.ts` — 20 test cases
- Coverage: cutoff (2), tolerance + auto-approve (5), reason_code (1), force (2), approve (3), reject (1), getEffectiveDemand (2), expirePendingCutoff (2), mondayOf normalization (1), getReasonCodes (1)

---

## Source Files
| Layer | Path |
|-------|------|
| CnAdjustService | `backend/src/cn-adjust/cn-adjust.service.ts` |
| TrustScoreService | `backend/src/cn-adjust/trust-score.service.ts` |
| Controller | `backend/src/cn-adjust/cn-adjust.controller.ts` |
| Module | `backend/src/cn-adjust/cn-adjust.module.ts` |
| Shared | `common/date-utils.ts` (mondayOf, isPastCutoffVN) |
| Exports | `CnAdjustService` (M23), `TrustScoreService` |
