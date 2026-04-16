# M23 DRP Netting v2 — Module Report

> **Sprint:** 4 · **DA:** DA1 · **Status:** DONE
> **Zone:** EXTEND · **Depends on:** M21 (freshness gate), M22 (effective demand), M10 (config)
> **Consumed by:** M24 (getDrpResult), M25 (drp_cn_line read)

---

## BA Logic

### Pipeline (10 Steps)
1. **Freshness gate** — `FreshnessGateService.check()`, block if stale (forceOverrideReason to bypass)
2. **Idempotent daily check** — partial unique index `uq_plan_run_date_completed` (1 COMPLETED per day)
3. **Policy snapshot (Rule 14)** — immutable JSONB of system_config + sku_cn_mapping overrides + transport_lane LT
4. **Create plan_run** (status=RUNNING)
5. **Load M22 effective demand** — `cnAdjustSvc.getEffectiveDemand(weekStart)`, fallback FC raw if error
6. **Load supply** — on_hand + in_transit per CN x SKU (anti double-allocation: subtract reserved_for_transport)
7. **Compute SS** per CN x SKU → `ss_cn` table, formula: `z * sigma_final * sqrt(lt_hub_days)`
8. **Netting loop** — `netDemand = demand - onHand - inTransit + ssFinal` (NOT clamped, negative = OVER_STOCK)
9. **Variant suggestion** — supply-based proportional split, demand fallback, planner review if no history
10. **Finalize** plan_run (COMPLETED) with stats

### SS Formula
```
sigma_final = MAX(sigma_rolling_12w, sigma_seasonal)  // Phase 1: seasonal=null → use rolling
ss_base = z * sigma_final * sqrt(lt_hub_days)
ss_after_lcnb = ss_base * (1 - lcnb_reduction_pct / 100)
ss_floor = mean_demand_12w * min_ss_floor_pct          // Guard for sigma≈0
ss_final = MAX(0, ss_after_lcnb, ss_floor)
Override: OVERRIDE_EXPLICIT > OVERRIDE_Z > FORMULA
```

### Cron Schedule
| Time (VN) | Purpose |
|-----------|---------|
| 23:15 | Primary nightly DRP run |
| 23:30 | Retry (skip if RUNNING/COMPLETED today) |
| 02:00 | Retention cleanup (>90 days) |

### Status Transitions
`RUNNING → COMPLETED | FAILED | BLOCKED_STALE`
`BLOCKED_STALE → FORCE_OVERRIDDEN | CANCELLED`
`FORCE_OVERRIDDEN → COMPLETED | FAILED`

---

## DB Schema

### Migration V004
| Table | Purpose |
|-------|---------|
| `plan_run` (extended) | +policy_run_id, effective_demand_source, is_stale_override, run_date, is_force_rerun |
| `policy_run` (new) | Rule 14 immutable config + master data JSONB snapshot |
| `ss_cn` (new) | SS per CN x SKU per run (formula trace: sigma, z, lt, lcnb, source) |
| `drp_cn_line` (new) | Per-CN netting output: demand, supply, SS, net_demand, status, variant suggestion |

### Key Indexes
| Index | Purpose |
|-------|---------|
| `uq_plan_run_date_completed` | 1 COMPLETED run per day (force rerun excluded) |
| `uq_ss_cn (plan_run_id, cn_id, sku_id)` | No duplicate SS per cell |
| `uq_drp_cn_line (plan_run_id, cn_id, sku_id, period_start)` | No duplicate netting cells |
| `idx_drp_cn_line_m24` | M24 hot path read |

### Config Seeds (V004)
- `planning.min_ss_floor_pct` = 0.05
- `safety_stock.default_z_score` = 1.65
- `safety_stock.lcnb_reduction_pct` = 25
- `planning.snapshot_retention_days` = 90
- Feature flag: `m23_drp_netting_v2_enabled`

---

## API Endpoints

**Base:** `/api/v1/drp` · **Guard:** feature flag via service `_isEnabled()`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v2/run` | Manual trigger DRP v2 |
| POST | `/v2/run/force-stale-override` | Bypass freshness gate (reason >= 20 chars) |
| GET | `/v2/runs` | List v2 runs (paginated) |
| GET | `/v2/runs/:id/lines` | drp_cn_line (filter: cnId, skuId, status) |
| GET | `/v2/runs/:id/result` | **M24 contract** — full DrpResultDto (Map→Object) |
| GET | `/v2/runs/:id/policy-snapshot` | Rule 14 audit viewer |
| GET | `/v2/runs/:id/ss-summary?cnId=` | SS CN detail per cell |
| GET | `/v2/ss-preview?cnId=&skuId=` | Live SS preview (no persist) |

### M24 Contract: `DrpResultDto`
```typescript
{ planRunId, policyRunId, generatedAt,
  lines: Map<drpCellKey, DrpCellDto> }

DrpCellDto: { cnId, skuId, periodStart,
  effectiveDemand, effectiveDemandSource,
  onHand, inTransit, ssFinal, netDemand,
  status, variantSuggestion, plannerReviewRequired }

drpCellKey = "${cnId}|${skuId}|${periodStart}"  // common/drp-utils.ts
```

---

## FE

- Page: `app/drp/page.tsx` (existing — M23 v2 extends backend)
- API: `lib/api/drp.ts` (existing — v2 endpoints added by dev if needed)

---

## Test

- `drp.netting-v2.service.spec.ts` — 18 test cases
- Coverage: gate block/override (2), idempotent (2), M22 fallback (2), net demand compute (4), policy failure (1), getDrpResult (3), listV2Runs/listLines (2), variant suggestion (1), bulk insert (1)

---

## Source Files
| Layer | Path |
|-------|------|
| DrpNettingV2Service | `backend/src/drp/drp.netting-v2.service.ts` |
| DrpPolicyRunService | `backend/src/drp/drp.policy-run.service.ts` |
| DrpSsCnService | `backend/src/drp/drp.ss-cn.service.ts` |
| DrpVariantSuggestionService | `backend/src/drp/drp.variant-suggestion.service.ts` |
| Controller | `backend/src/drp/drp.controller.ts` |
| Module | `backend/src/drp/drp.module.ts` |
| Shared | `common/drp-utils.ts` (drpCellKey), `common/date-utils.ts` |
| Exports | `DrpService`, `DrpNettingV2Service` |
