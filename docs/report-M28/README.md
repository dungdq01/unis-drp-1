# M28 Feedback & Closed Loop — Module Report

> **Sprint:** 9 · **DA:** DA2 · **Status:** DONE
> **Zone:** EXTEND (D10 Intelligence) · **Type:** Closed-loop — writes back to D1/D2/D3/D4
> **Depends on:** M27 (getPoFulfillment, getActualLtPerNmRoute), M22 (TrustScoreService), M23 (DrpSsCnService), M26 (HonoringRateService), M00 (autoUpdateLt), M10 (config)

---

## BA Logic

### Pipeline (9 Steps, try/catch per step → COMPLETED_PARTIAL)
1. **Create weekly_kpi_snapshot** (RUNNING)
2. **Reserved** (snapshot setup)
3. **SS Auto-Adjust** — recompute σ_demand 12w rolling, cap ±50% (R12), alert if >20% (R2)
4. **LT Auto-Update** — rolling 6M avg from M27 PO tracking, drift gate ±30% (R3), force after 3x blocked
5. **Trust Refresh** — M22 `TrustScoreService.recalculateAll()`
6. **Honoring Backfill** — M26 `HonoringRateService.computeMonthly()`
7. **Override Analysis** — top 5 PO/TO edit reasons from `po_edit_log`
8. **KPI Snapshot** — fill_rate, lcnb_util, transport_fill, nm_honoring, system_accuracy
9. **Fill Rate Alert** — 2 consecutive weeks below threshold → WARNING (Phase 2: M8 delivery)

### Feedback Loops (D10 → D1/D2/D3/D4)

| Loop | From | To | Mechanism |
|------|------|----|-----------|
| **SS refresh** | M28 sigma_history | D4 M23 ss_cn | M28 publishes σ weekly → M23 nightly reads latest per (cn,sku) |
| **LT update** | M28 lt_actual_log | D1 M00 supplier.lead_time_days | M28 → `MasterDataService.autoUpdateLt()` |
| **LT route** | M28 lt_actual_log | D1 M00 transport_lane.transit_lt_days | M28 → `MasterDataService.updateTransitLt()` |
| **Trust score** | M28 trust_refresh | D2 M22 trust_score | M28 → `TrustScoreService.recalculateAll()` |
| **Honoring rate** | M28 honoring_backfill | D3 M26 nm_honoring_rate | M28 → `HonoringRateService.computeMonthly()` |

### SS Auto-Adjust Rules
- σ recompute: 12-week rolling from M9 actual (Phase 1 fallback: demand_snapshot FC proxy)
- SS formula: reuse `DrpSsCnService.computeSsCnFormula()` (pure, no DB write)
- R12: cap delta at ±50% per cycle
- R2: alert when delta > 20%
- **sigma_history** (H1 v1.2): M28 publishes, M23 reads — single source of truth

### LT Auto-Update Rules (R3 drift gate)
- Source: `PoReviewService.getActualLtPerNmRoute()` rolling 6 months
- `delta ≤ 30%` → APPLIED via M00
- `delta > 30%` → DRIFT_BLOCKED, increment `lt_drift_count`
- `drift_count ≥ 3` consecutive → DRIFT_FORCE_APPLY
- Min sample: 5 POs before applying

### Cron
- Monday 06:00 VN — weekly pipeline (setTimeout recursion)
- Same-day handling for Monday morning edge case

---

## DB Schema

### Migration V009 (5 tables + 2 transport_lane columns)
| Table | Purpose |
|-------|---------|
| `weekly_kpi_snapshot` | Pipeline run + KPI cache (1 per week, partial unique) |
| `sigma_history` | σ_demand per (cn, sku) — M28 → M23 bridge (H1 v1.2) |
| `ss_adjustment_log` | SS adjust audit: old/new/capped, delta_pct, trigger type |
| `lt_actual_log` | LT rolling-avg audit: entity_type (SUPPLIER/TRANSPORT_LANE), drift tracking |
| `override_analysis` | Top 5 PO/TO edit reasons per week |
| `transport_lane` extend | +lt_drift_count, +lt_drift_last_at |

### Key Indexes
| Index | Purpose |
|-------|---------|
| `uq_weekly_snapshot_week` | 1 non-force snapshot per week |
| `uq_sigma_history_cn_sku_at` | σ versioning per (cn, sku, timestamp) |
| `idx_sigma_history_lookup` | M23 nightly: latest σ per (cn, sku) DESC |
| `uq_override_analysis_snapshot` | 1 analysis per snapshot |

### Seeds
- Feature flag: `m28_feedback_loop_enabled`
- Config (FEEDBACK group): `ss_adjust_alert_threshold_pct=20`, `ss_adjust_cap_pct=50`, `fill_rate_alert_threshold=0.85`, `lt_drift_gate_pct=30`, `lt_min_sample_size=5`, `snapshot_retention_weeks=104`

---

## API Endpoints

**Base:** `/api/v1/feedback` · **Guard:** `@UseGuards(FeatureFlagGuard)` + `@FeatureFlag('m28_feedback_loop_enabled')`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/run` | Manual trigger weekly pipeline |
| POST | `/run/force-rerun` | Force rerun (reason ≥ 20 chars) |
| GET | `/snapshots?limit=` | List weekly KPI snapshots |
| GET | `/snapshots/:id` | Snapshot detail + all KPI |
| GET | `/ss-adjustments?cnId=&skuId=&fromWeek=&toWeek=` | SS adjustment log |
| GET | `/lt-updates?nmCode=&fromDate=&toDate=` | LT actual log |
| GET | `/overrides?week=` | Override analysis top reasons |
| GET | `/dashboard?week=` | SC Manager dashboard: 6 KPI + trends + alerts |
| GET | `/dashboard/drill-down?metric=&cnId=&skuId=` | Per-metric drill-down |
| POST | `/recompute/ss?cnId=&skuId=` | Manual single-cell SS recompute |
| POST | `/recompute/lt?nmCode=` | Manual single-NM LT recompute |

---

## FE

- Page: `app/feedback/page.tsx`
- API: `lib/api/feedback.ts` — 7 functions (dashboard, snapshots, ssAdjustments, ltUpdates, drillDown, triggerRun, forceRerun)
- Types: `WeeklyKpiSnapshot`, `DashboardResponse`
- Sidebar: D10 Intelligence > Feedback Loop (isNew badge)

---

## Test

- `feedback.service.spec.ts` — 9 test cases
- Coverage: pipeline run, idempotent, force rerun, COMPLETED_PARTIAL on step failure, cron scheduling, SS cap, LT drift gate

---

## Source Files
| Layer | Path |
|-------|------|
| FeedbackService (orchestrator) | `backend/src/feedback/feedback.service.ts` |
| SsAutoAdjustService | `backend/src/feedback/ss-auto-adjust.service.ts` |
| LtAutoUpdateService | `backend/src/feedback/lt-auto-update.service.ts` |
| TrustRefreshService | `backend/src/feedback/trust-refresh.service.ts` |
| HonoringBackfillService | `backend/src/feedback/honoring-backfill.service.ts` |
| OverrideAnalysisService | `backend/src/feedback/override-analysis.service.ts` |
| KpiSnapshotService | `backend/src/feedback/kpi-snapshot.service.ts` |
| DashboardService | `backend/src/feedback/dashboard.service.ts` |
| Controller | `backend/src/feedback/feedback.controller.ts` |
| Module | `backend/src/feedback/feedback.module.ts` |
| Exports | `FeedbackService` |
