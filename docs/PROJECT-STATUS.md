# UNIS Supply Chain Planning System — Project Status

> **Last updated:** 2026-04-15
> **Phase 1: COMPLETE** — 8/8 modules implemented & QA-passed

---

## Pipeline Overview

```
[M1 Demand] → [M2 Supply] → [M3 Policy] → [M4 DRP]
                                               ↓
                                        [M5 Allocation]
                                               ↓
                                        [M6 Transport]
                                               ↓
                                        [M7 Execution]
                                               ↓
                                        [M8 Monitor] ──→ feedback → M1/M3/M5
```

---

## Module Status

| # | Module | Step | BE | FE | DB | QA | Status |
|---|--------|------|----|----|----|-----|--------|
| M1 | Demand & Forecast | `demand` | ✅ | ✅ | ✅ | ✅ | **DONE** |
| M2 | Supply Snapshot | `supply` | ✅ | ✅ | ✅ | ✅ | **DONE** |
| M3 | Safety Stock / Policy | `policy` | ✅ | ✅ | ✅ | ✅ | **DONE** |
| M4 | DRP Netting | `drp` | ✅ | ✅ | ✅ | ✅ | **DONE** |
| M5 | Allocation Engine | `allocation` | ✅ | ✅ | ✅ | ✅ | **DONE** |
| M6 | Transport Planning | `transport` | ✅ | ✅ | ✅ | ✅ | **DONE** |
| M7 | Order Bridge (Execution) | `orders` | ✅ | ✅ | ✅ | ✅ | **DONE** |
| M8 | Monitor & Learn | `monitor` | ✅ | ✅ | ✅ | ✅ | **DONE** |

---

## Backend — Modules Registered (`app.module.ts`)

```
DemandModule, SupplyModule, PolicyModule, DrpModule,
AllocationModule, TransportModule, OrderModule, MonitorModule
```

---

## Database — Tables

| Migration | Tables |
|-----------|--------|
| `001_master_data.sql` | `item`, `location`, `supplier`, `rtm_rule`, `item_location_config`, `planning_cycle` |
| `002_demand.sql` | `demand_snapshot`, `demand_snapshot_line`, `demand_forecast_detail`, `demand_override_log` |
| `002b/002c` | Alter demand tables (columns + status enum) |
| `003_demand_accuracy.sql` | `demand_accuracy` |
| M2 (via service) | `supply_snapshot`, `supply_snapshot_line`, `lot_attribute` |
| M3 (via service) | `policy_run`, `safety_stock_target`, `item_abc_classification`, `item_location_config` (shared) |
| M4 (`drp/migrations/`) | `plan_run`, `planned_order_release`, `drp_exception` |
| M5 (via service) | `allocation_run`, `allocation_result`, `allocation_exception`, `allocation_recommendation` |
| M6 (`transport/migrations/`) | `vehicle_type`, `carrier`, `transport_lane`, `transport_plan`, `transport_trip`, `transport_trip_line` |
| M7 (DB created by DA) | `order_batch`, `order_line`, `order_batch_seq` |
| M8 (DB created by DA) | `kpi_snapshot`, `alert` |

**Total tables: ~30**

---

## API Endpoints Summary

| Controller | Prefix | Key Endpoints |
|------------|--------|---------------|
| `DemandController` | `/demand` | Snapshot CRUD, freeze, override, CSV upload |
| `AccuracyController` | `/demand/accuracy` | Accuracy dashboard per FSKU |
| `InsightsController` | `/demand/forecast` | Demand insights (paginated) |
| `SupplyController` | `/supply` | Snapshot CRUD, capture, freeze, freshness |
| `BravoController` | `/supply/bravo` | Manual entry + XLSX upload |
| `PolicyController` | `/policy` | Policy runs, SS targets, ABC classification, RTM rules |
| `DrpController` | `/drp` | Plan runs, planned orders, DRP exceptions |
| `AllocationController` | `/allocation` | Allocation runs, results, exceptions, recommendations |
| `TransportController` | `/transport` | Plans, trips, carriers, lanes, FFD engine |
| `OrderController` | `/orders` | Batch CRUD, submit/approve/reject/cancel, export CSV |
| `MonitorController` | `/monitor` | KPI compute, HSTK, alerts, execution metrics, stats |

**Swagger:** `localhost:3002/api`

---

## Frontend Pages (Next.js)

| Route | Module | Key Features |
|-------|--------|--------------|
| `/demand` | M1 | Snapshot list, freeze, override, accuracy dashboard |
| `/supply` | M2 | Freshness widget, snapshot detail, Bravo upload |
| `/policy` | M3 | ABC classification, SS targets, RTM rules |
| `/drp` | M4 | Plan run trigger, planned orders, exceptions |
| `/allocation` | M5 | Allocation runs, results, recommendations |
| `/transport` | M6 | Plans, trips, carriers, lanes (4 tabs) |
| `/execution` | M7 | Order batches, approval flow, export CSV |
| `/monitoring` | M8 | KPI dashboard, HSTK table, alert center |

**Sidebar:** 8 nav entries, step 01–08.

---

## UNIS Error Codes

| Code | Description |
|------|-------------|
| `UNIS-ERR-001..009` | Demand & Snapshot errors |
| `UNIS-ERR-010` | Demand line not found |
| `UNIS-ERR-011..013` | Plan run / Allocation run errors |
| `UNIS-ERR-014..017` | Transport errors |
| `UNIS-ERR-018..024` | Order batch / line errors |
| `UNIS-ERR-025..028` | Monitor / Alert errors |

**Total: 28 error codes** — `src/common/errors.ts`

---

## UNIS Business Constants

| Constant | Value | Module |
|----------|-------|--------|
| Fill Rate target | ≥ 92% | M8 |
| OTIF target | ≥ 90% | M8 |
| HSTK stockout threshold | < 1.5 weeks | M8 |
| HSTK overstock threshold | > 3.0 weeks | M8 |
| Demand drift threshold | > 20% | M8 |
| PSI threshold | > 0.30 | M8 |
| Override rate target | ≤ 25% | M8 |
| MAPE target | ≤ 25% | M8 |
| Inventory turns target | ≥ 6.0 | M8 |
| PO overdue threshold | 10 days | M8 |
| CO2 tracking | OFF (= 0) | M8 |
| FFD vehicle: Flatbed | 25T | M6 |
| FFD vehicle: Crane truck | 15T | M6 |
| Insert chunk size | 100 | M7 |
| Order batch code prefix | `TO-YYYYMM-XXXX` | M7 |

---

## UNIS Constraints (codebase-wide)

```
1. PKs       — BIGSERIAL (BIGINT), không UUID (ngoại lệ: demand tables dùng UUID — legacy)
2. Item FK   — item_code VARCHAR(50)
3. Location FK — location_code VARCHAR(20)
4. No tenant_id — bỏ khỏi tất cả tables và queries
5. No JWT Phase 1 — user identity truyền qua body field (createdBy, approvedBy…)
6. synchronize: false — TypeORM không tự alter schema
7. Template literal trong SQL — không dùng. Mọi user input phải qua parameterized queries
```

---

## Implementation Docs

| Module | Spec | Location |
|--------|------|----------|
| M1 | MODULE-1-FULL-IMPLEMENT.md | `docs/report-module1/` |
| M2 | MODULE-2-FULL-IMPLEMENT.md | `docs/report-module2/` |
| M3 | MODULE-3-FULL-IMPLEMENT.md | `docs/report-module3/` |
| M4 | MODULE-4-FULL-IMPLEMENT.md | `docs/report-module4/` |
| M5 | MODULE-5-FULL-IMPLEMENT.md | `docs/report-module5/` |
| M6 | MODULE-6-FULL-IMPLEMENT.md | `docs/report-module6/` |
| M7 | _(inline spec, no dedicated file)_ | — |
| M8 | MODULE-8-FULL-IMPLEMENT.md | `docs/report-module8/` |

---

## Phase 2 — Backlog (blocked items)

| Item | Blocker | Owner |
|------|---------|-------|
| MAPE, Fill Rate, OTIF calculation | `actual_sales` table không tồn tại | DA — tạo table + ERP import |
| True Override Rate | `order_line` thiếu `qty_original` | BE — M7 schema change |
| Drift detection (> 20%), PSI > 0.30 | Cần `actual_sales` + multi-period history | DA + BE |
| FC→SS feedback loop (Celery weekly) | Cần MAPE history ≥ 8 tuần | Phase 2 |
| Override→RTM feedback loop | Cần true override data | Phase 2 |
| Supplier LT feedback loop | Cần actual delivery timestamp | Phase 2 |
| `drift_detection_log` table | Phụ thuộc actual_sales | Phase 2 |
| `feedback_recommendation` table | Phụ thuộc loops trên | Phase 2 |
| EMAIL integration | Cần SMTP config + template service | Phase 2 |
| ZALO integration | Cần Zalo OA API key | Phase 2 |
| SSE real-time push | Cần EventSource endpoint | Phase 3 |
| Scheduled KPI compute (pg_cron) | Cần pg_cron extension | Phase 3 |
| HSTK trend history chart | Cần ≥ 4 weeks kpi_snapshot data | Phase 3 |

---

## QA Summary — Phase 1

| Module | QA Cases | Result |
|--------|----------|--------|
| M1 | CSV upload, freeze, override, accuracy | ✅ All passed |
| M2 | Capture, Bravo upload, freeze, freshness | ✅ All passed |
| M3 | Policy run, SS calc, ABC, RTM CRUD | ✅ All passed |
| M4 | DRP run, planned orders, exceptions | ✅ All passed |
| M5 | Allocation run, results, recommendations | ✅ All passed |
| M6 | Transport plan, FFD engine, carrier override | ✅ All passed |
| M7 | Batch CRUD, submit/approve/reject/export, overdue | ✅ All passed |
| M8 | KPI compute, HSTK, alerts, execution metrics | ✅ All passed |

---

*Generated: 2026-04-15 | UNIS SCP Phase 1 Complete*
