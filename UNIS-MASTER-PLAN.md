# UNIS Execution Core — Master Plan & Team Checklist
**Tenant:** UNIS (Công Ty Cổ Phần Tập Đoàn UNIS)  
**Tenant UUID:** `00000000-0000-0000-0000-000000000003`  
**Pipeline Ref:** `pipeline/pipeline_execution_core.md` v1.1  
**Forecast Data:** `drp_export_dec25_q1_2026.csv` (84K rows) + `Forecast_30032026.csv`  
**Status:** `IN_PROGRESS — Dev Team Review Session`  
**Last Updated:** 2026-04-12

---

## 📋 Executive Summary — 8-Step Status Matrix

| Step | Module | UNIS Plugin | Status | Blocker | Owner |
|---|---|---|---|---|---|
| **Step 1** | Demand Ingestion | ✅ `UNISDemandPlugin` | 🟡 **PARTIAL** | Forecast API not wired to CSV | DE + BE |
| **Step 2** | Supply Snapshot | ✅ `UNISSupplyPlugin` | 🟡 **PARTIAL** | Branch/Factory inventory CSV missing | DE |
| **Step 3** | Inventory Policy | ✅ `UNISPolicyPlugin` | 🟡 **PARTIAL** | RTM rules not seeded, ABC not classified | DE + DA |
| **Step 4** | DRP Netting | ✅ `UNISDRPPlugin` | 🔴 **BLOCKED** | Needs Step 1+2+3 complete | BE |
| **Step 5** | Allocation | ✅ `UNISAllocationPlugin` | 🔴 **BLOCKED** | Needs Step 4 output + RTM rules | BE |
| **Step 6** | Transport Planning | ✅ `UNISTransportPlugin` | 🔴 **BLOCKED** | Needs Step 5 + carrier data | BE + DA |
| **Step 7** | Execution Bridge | ✅ `UNISExecutionPlugin` | 🔴 **BLOCKED** | Bravo SFTP + CN_WH account | BE + OPS |
| **Step 8** | Monitor & Learn | ✅ `UNISMonitorPlugin` | 🟡 **PARTIAL** | KPI targets configured, drift loop needs data | BE |

**Legend:** ✅ Done · 🟡 Partial/In-Progress · 🔴 Blocked · ⬜ Not Started

---

## 🏗️ Pre-Conditions — Must Complete Before ANY Step

### PC-01: Master Data Seeded (BLOCKING ALL STEPS)
- [ ] **PC-01a** — Item masterdata seeded (status=ACT only, ~N SKUs confirmed by BA)
- [ ] **PC-01b** — Location masterdata seeded: Warehouse (NM) + Branch (CN)
  - Verify 6 suspicious rows: `000, 067, 070, 093, 111, 222` — real CN hay phantom?
- [ ] **PC-01c** — `Nơi kéo` (RTM rules) seeded — resolve duplicates: FICO/HOAN MY/MIKADO
- [x] **PC-01d** — ~~Bravo SKU vs Item Code~~ → **RESOLVED: `item_code` is primary key** (100% match with forecast FSKU). `bravo_sku` stored as `external_sku` for ERP mapping.
- [ ] **PC-01e** — `#N/A` fields in Item CSV — re-export or handle NULL confirmed

### PC-02: UNIS Tenant Config Verified
- [ ] **PC-02a** — UNIS UUID `00000000-0000-0000-0000-000000000003` verified in DB
- [ ] **PC-02b** — All 8 UNIS plugins registered at startup via `register_all_plugins()`
- [ ] **PC-02c** — Feature toggles: `FEFO.enabled=OFF`, `RTM.enabled=ON`, `LCNB.mode=DETECT_ONLY`
- [ ] **PC-02d** — Planning cycle config: `horizon=12 weeks`, `freshness_threshold=240 min`

### PC-03: Environment Ready
- [ ] **PC-03a** — PostgreSQL schema migrated (all 36 DDL tables deployed)
- [ ] ~~**PC-03b**~~ — ~~Redis running~~ → **Phase 2.** Phase 1 = DB direct queries, no Redis cache
- [ ] ~~**PC-03c**~~ — ~~Kafka broker reachable~~ → **Phase 2.** Phase 1 = manual API triggers, no Kafka
- [ ] **PC-03d** — SFTP server accessible for Bravo integration smoke test

---

## Step 1 — Demand Ingestion
> **UNIS Config:** `confirmed_order_cutoff_days=90`, `demand_basis=MAX_FORECAST_PO`, 12-month horizon

### 1A. Data Preparation (DE Owner)
- [ ] **1A-01** — Confirm format `Forecast_30032026.csv` (wide: fsku × period) maps to `demand_snapshot_line` schema
- [ ] **1A-02** — Confirm `drp_export_dec25_q1_2026.csv` (long: 22 cols) — which to use as primary import source?
  - `Forecast_30032026.csv` → Aggregated (total company) → **Step 1 seed data**
  - `drp_export_dec25_q1_2026.csv` → Branch-level → **Step 1 seed + Step 4/5 demand lines**
- [ ] **1A-03** — Map `fsku_id` → `item_id` in system (confirm join key với BA)
- [ ] **1A-03b** — Cross-check `fsku_id` match rate vs `bravo_sku` in Item masterdata — **target ≥ 95% match** *(CRITICAL — if < 80%, demand lines become orphans → DRP fails)*
- [ ] **1A-04** — Filter out `EXCLUDE` rows (`model_config_id=EXCLUDE`, `combo_class=DORMANT_DISCONTINUED`)
- [ ] **1A-05** — Filter out zero-forecast rows OR keep for downstream dormant detection?
- [ ] **1A-06** — Handle `tet_flag=Y` — map to promotion calendar / seasonal adjustment in Step 1

### 1B. API / Endpoint Design (BE Owner)
- [ ] **1B-01** — `POST /api/v1/demand/forecast/upload` — bulk import from CSV
  - Inputs: `tenant_id`, `run_id`, `file`, `format=detailed|summary`
  - Output: `upload_id`, `rows_validated`, `errors` ⚠️ **NEW ENDPOINT**
- [ ] **1B-02** — `GET /api/v1/demand/forecast/summary` — aggregated view (from `Forecast_30032026.csv`)
- [ ] **1B-03** — `GET /api/v1/demand/forecast/detail` — branch-level (from `drp_export_dec25_q1_2026.csv`)
- [ ] **1B-04** — `POST /api/v1/demand/forecast/{run_id}/freeze` — snapshot freeze for DRP
- [ ] **1B-05** — Wire `UNISDemandPlugin.adjust_forecast()` — hiện đang no-op, có cần UNIS-specific logic?
- [ ] **1B-06** — `forecast_version` tracking: label = `W9_20260406`, source = `ALGORITHM_EXPORT`

### 1C. Database Schema (BE/DE Owner)
- [ ] **1C-01** — Table `demand_forecast_detail` — create if not exists:
  ```sql
  run_id, forecast_date, branch_id, branch_name, region, fsku_id,
  segment, model_config_id, forecast_qty, reconciled_qty, scale_factor,
  tet_flag, combo_class, branch_archetype,
  confidence_lower, confidence_upper,
  qty_sold_12m_avg, qty_sold_3m_avg, panel_months, last_nonzero_month, data_cutoff
  ```
- [ ] **1C-02** — Index: `(tenant_id, run_id, branch_id, fsku_id, forecast_date)` for DRP join
- [ ] **1C-03** — Validate `sku_name` empty in CSV — enrich from Item masterdata JOIN

### 1D. Validation Gate (DA Owner)
- [ ] **1D-01** — Cross-check fsku_id in forecast vs Item masterdata — unmatched rate < 5%?
- [ ] **1D-02** — Total forecast qty sanity check (per period, per region)
- [ ] **1D-03** — Verify `run_id=W9_20260406` is latest — no overlap with previous runs
- [ ] **1D-04** — `combo_class` distribution: % ACTIVE vs DORMANT vs COLD_START documented

---

## Step 2 — Supply Snapshot
> **UNIS Config:** `freshness_threshold=240 min`, `buckets=[ALLOCATABLE, RESERVED]`, `wms_sync=BATCH`

### 2A. Data Preparation (DE Owner)
- [ ] **2A-01** — Branch inventory CSV: `[Template] Upload Branch_Inventory - Sheet1.csv` — **chờ UNIS IT** *(BLOCKER)*
  - Required: `branch_id`, `fsku_id`, `on_hand_qty`, `reserved_qty`, `snapshot_date`
  - Coverage: 73 CN × active SKUs
- [ ] **2A-02** — Factory/NM inventory CSV: `[Template] Upload Factory_Inventory - Sheet1.csv` — **chờ UNIS IT** *(BLOCKER)*
  - Required: `warehouse_id`, `fsku_id`, `on_hand_qty`, `snapshot_date`
- [ ] **2A-03** — Reconcile Branch CSV với Branch masterdata: mọi `branch_id` phải có trong Location table
- [ ] **2A-04** — Verify snapshot date (`data_cutoff=2025-11`) — là cutoff của forecast, inventory snapshot cần đồng bộ

### 2B. API / Service (BE Owner)
- [ ] **2B-01** — `POST /api/v1/supply/snapshot` — trigger snapshot capture (BATCH mode) ⚠️ **NEW ENDPOINT — or use existing** `POST /supply/snapshot`
- [ ] **2B-02** — `GET /api/v1/supply/snapshots/{snapshot_id}` — check detail + bucket summary; `GET /api/v1/supply/freshness` — freshness gate
- [ ] **2B-03** — Verify `UNISSupplyPlugin.freshness_threshold_minutes()=240` → plan run BLOCKED if > 4h
- [ ] **2B-04** — Bucket mapping: `ALLOCATABLE=on_hand - reserved`, `RESERVED=reserved_qty`
  - QUARANTINE=OFF, SOFT_RESERVED=OFF (UNIS config)
- [ ] **2B-05** — `supersede_previous()` call — đảm bảo chỉ 1 FROZEN snapshot tại 1 thời điểm

### 2C. Validation Gate (DA Owner)
- [ ] **2C-01** — Coverage check: % SKUs in Item masterdata có supply snapshot record
- [ ] **2C-02** — Negative on-hand detection — alert nếu `on_hand_qty < 0`
- [ ] **2C-03** — Cross-check: Warehouse inventory + Branch inventory vs total known stock

---

## Step 3 — Inventory Policy
> **UNIS Config:** `ss_method=STATISTICAL`, `service_level=0.95`, `abc_recalc=SEMI_ANNUAL`

### 3A. Data Preparation (DA Owner)
- [ ] **3A-01** — Sales history (12 months) — ~~**chờ UNIS IT**~~ *(DOWNGRADED: `qty_sold_12m_avg` + `qty_sold_3m_avg` from DRP export available as proxy)*
  - Full sales CSV nice-to-have for detailed SS computation, but NOT blocking UAT
  - Proxy data from `drp_export_dec25_q1_2026.csv` columns: `qty_sold_12m_avg`, `qty_sold_3m_avg`
- [ ] **3A-02** — Note: `qty_sold_12m_avg` và `qty_sold_3m_avg` đã có trong `drp_export_dec25_q1_2026.csv`
  - → Có thể dùng làm proxy SS input trong khi chờ full sales history

### 3B. RTM Rules Seeding (DE + BA Owner)
- [ ] **3B-01** — Draft RTM rules từ `Nơi kéo` masterdata: `Branch → Warehouse mapping`
  - Priority 1: NM gần nhất (địa lý)
  - Priority 2: NM thứ hai (fallback)
  - Resolve: FICO / HOAN MY / MIKADO duplicates — cùng 1 entity hay khác?
- [ ] **3B-02** — Seed RTM rules vào `rtm_rule` table với `tenant_id=UNIS`
- [ ] **3B-03** — Verify RTM lookup query works: `SELECT * FROM rtm_rule WHERE tenant_id=:tid AND item_id=:iid ORDER BY priority` (Phase 1 = DB direct, no Redis cache)
- [ ] **3B-04** — Test RTM lookup: mỗi CN phải có ít nhất 1 RTM route về NM

### 3C. ABC Classification (DA Owner)
- [ ] **3C-01** — Use `segment` (A/B/C) from `drp_export_dec25_q1_2026.csv` as PRIMARY ABC source (already classified by forecast team). Cross-check vs computed ABC from `qty_sold_12m_avg` only if discrepancy > 10%
- [ ] **3C-02** — Cross-check CHỈ KHI discrepancy > 10%: segment DRP vs computed ABC từ `qty_sold_12m_avg`. Nếu match > 90% → dùng DRP segment, không cần tính lại
- [ ] **3C-03** — Seed `item_classification` table với UNIS tenant

### 3D. Safety Stock Computation (DA/BE Owner)
- [ ] **3D-01** — Compute SS per SKU × Location using STATISTICAL method:
  ```
  SS = z(0.95) × σ_demand × √lead_time + z(0.95) × μ_demand × σ_lead_time
  ```
  - Use `qty_sold_12m_avg`, `qty_sold_3m_avg` từ forecast CSV as proxy input
- [ ] **3D-02** — `POST /api/v1/policies/safety-stock/compute` — trigger batch SS computation via `UNISPolicyPlugin`
- [ ] **3D-03** — Write SS results to `item_classification` table (Phase 1 = DB direct, no Redis)
- [ ] **3D-04** — Verify: SS > 0 for all A-class items at all CN locations

### 3E. Policy Lifecycle (BE Owner)
- [ ] **3E-01** — Create UNIS policy bundle: `Draft → Validate → Simulate → Approve → Active`
- [ ] **3E-02** — Policy types enabled: `RTM, CLASSIFICATION, PLANNING_CYCLE, INVENTORY, DISPATCH_PRODUCTIVITY, INVENTORY_SEGREGATION`
- [ ] **3E-03** — Dry-run MANDATORY trước khi promote policy to ACTIVE

---

## Step 4 — DRP Netting
> **UNIS Config:** `lot_sizing=L4L`, `horizon=12 weeks`, `frozen_zone=2 weeks`, `bom_explosion=False`

### 4A. Pre-Conditions Check (BE Owner)
- [ ] **4A-01** — ✅ Step 1 complete: `DemandSnapshot` FROZEN exists for UNIS tenant
- [ ] **4A-02** — ✅ Step 2 complete: `SupplySnapshot` FROZEN exists for UNIS tenant
- [ ] **4A-03** — ✅ Step 3 complete: SS targets in DB (`item_classification.ss_target`) for UNIS items × locations
- [ ] **4A-04** — Verify `planning_cycle` record exists: `cutoff_time=23:00`, `granularity=WEEKLY`

### 4B. DRP Run (BE Owner)
- [ ] **4B-01** — `POST /api/v1/drp/run` with `demand_snapshot_id` + `supply_snapshot_id`
- [ ] **4B-02** — Verify DRP formula: `PAB(t) = PAB(t-1) + ScheduledReceipts(t) - GrossRequirements(t)`
- [ ] **4B-03** — L4L lot sizing: `PlannedOrderRelease = exact_qty` (no FOQ/POQ for UNIS)
- [ ] **4B-04** — BOM explosion: `bom_explosion_enabled=False` → skip for building materials
- [ ] **4B-05** — Timeout handling: 30s hard limit → TIMEOUT flag → return partial + last-good plan fallback
- [ ] **4B-06** — Exception handling: negative PAB → `RAISE_EXCEPTION` (UNIS default) → flag for Planner

### 4C. Output Validation (DA Owner)
- [ ] **4C-01** — Count `planned_order_release` rows vs expected (active SKUs × CN locations × horizon)
- [ ] **4C-02** — Verify no past-due planned releases (`EC-N01: PAST_DUE flag`)
- [ ] **4C-03** — Verify frozen zone: no auto-changes trong 2 tuần đầu
- [ ] **4C-04** — Spot-check: high-volume SKUs (A-class) có planned orders aligned với forecast qty?

---

## Step 5 — Allocation (6-Layer Constraint Stack)
> **UNIS Config:** `FEFO=OFF`, `specs=VARIANT`, `LCNB=DETECT_ONLY`, `ABC_weight_A=2.0`

### 5A. Pre-Conditions Check (BE Owner)
- [ ] **5A-01** — ✅ Step 4 complete: `PlannedOrderRelease` exists
- [ ] **5A-02** — RTM rules in PostgreSQL (Phase 1 = DB direct; Phase 2 = Redis cache + PG fallback)
- [ ] **5A-03** — `lot_attribute` table seeded (for variant/spec matching)

### 5B. 6-Layer Verification (BE Owner)
- [ ] **5B-01** — **Layer 1 — RTM Source Selection:** test với 1 CN × 1 SKU
  - Priority 1: NM gần nhất → check available → Priority 2 (fallback) → `REQUEST_SUPPLY`
- [ ] **5B-02** — **Layer 2 — Quality/SpecsID:** `specs_id_mode=VARIANT` (color/size matching)
  - Test: variant matching hoạt động đúng (không reject do spec mismatch nếu variant match)
- [ ] **5B-03** — **Layer 3 — FEFO/LEFO:** `FEFO.enabled=False` → **skip Layer 3** for UNIS
  - Verify: không có FEFO logic chạy, `fefo_min_shelf_life_pct=0.0`
- [ ] **5B-04** — **Layer 4 — Quantity + ABC Priority:** fair-share với `weight_A=2.0, weight_B=1.5, weight_C=1.0` *(UNIS only overrides A=2.0; B/C inherit base defaults 1.5/1.0)*
- [ ] **5B-05** — **Layer 5 — Safety Stock Guard:** `post_allocation_stock >= ss_target`
  - Test: SS breach → reduce qty → alert `SHORTAGE`
- [ ] **5B-06** — **Layer 6 — LCNB `DETECT_ONLY`:** scan sibling CN → create recommendation ONLY (no actual transfer)
  - Test: sibling CN có excess → `recommendation` object created, no draft TO created
  - Verify: `LATERAL_EXHAUSTED` code when all siblings excess=0 → create PO to NM

### 5C. Concurrency & Saga (BE Owner)
- [ ] **5C-01** — Optimistic locking: test concurrent reservation trên same lot
  - Expected: first committer wins, second retries with next source
- [ ] **5C-02** — Reservation TTL: `SOFT_RESERVED` timeout 5 min (configurable)
- [ ] **5C-03** — Saga rollback: test mid-layer failure → toàn bộ allocation line rolled back

### 5D. Dispatch Productivity Check (BE Owner)
- [ ] **5D-01** — UNIS config: `dispatch_default_pallet_per_day=800`, `peak_multiplier=1.3`
- [ ] **5D-02** — Test: `allocated_pallets_today > 800` → SPLIT excess to D+1
- [ ] **5D-03** — Every split logged với `original_plan + reason`

### 5E. Buyer Decision Gate (BE + UX Owner)
- [ ] **5E-01** — `Recommendation` object generated sau allocation: source, rationale, confidence, exceptions
- [ ] **5E-02** — UI: Buyer có thể APPROVE / OVERRIDE / ESCALATE
- [ ] **5E-03** — Override → reason code + audit log
- [ ] **5E-04** — Exception severity CRITICAL → human review required trước Step 7

### 5F. Output Validation (DA Owner)
- [ ] **5F-01** — `allocation_result` rows: mỗi `planned_order_release` → 1 allocation result
- [ ] **5F-02** — ALLOCATED rate target: > 80% lines ALLOCATED (không phải SHORTAGE/NO_SOURCE)
- [ ] **5F-03** — LCNB recommendations: verify recommendations table populated đúng

---

## Step 6 — Transport Planning
> **UNIS Config:** `carrier=BEST_SLA`, `consolidation=False`, `vehicles=[FLATBED, CRANE_TRUCK]`, `CO2=OFF`

### 6A. Data Requirements (DE + DA Owner)
- [ ] **6A-01** — `vehicle_frame` table seeded: `FLATBED (25T)`, `CRANE_TRUCK (15T)` per UNIS config
- [ ] **6A-02** — `carrier_rate` table seeded: carrier rates per route (NM → CN lanes)
  - Verify `valid_to` dates — không dùng expired rates
- [ ] **6A-03** — `lane` table seeded: origin → destination pairs với `distance_km`, `lead_time_days`
  - Coverage: tất cả `Nơi kéo` pairs (NM → CN branches)

### 6B. Transport Run (BE Owner)
- [ ] **6B-01** — `POST /api/v1/transport/plan` triggered sau Allocation complete
- [ ] **6B-02** — **SE1 Vehicle Sizing:** greedy fill FLATBED first → CRANE_TRUCK for remainder
- [ ] **6B-03** — **SE2 Carrier Selection:** `BEST_SLA` → sort carriers by `historical_otd_pct` DESC
- [ ] **6B-04** — **SE3 Consolidation:** `consolidation_enabled=False` → skip consolidation (per-project delivery)
- [ ] **6B-05** — `arrival_date = departure_date + lead_time_days` from lane
- [ ] **6B-06** — CO2: `sustainability_target_score=0.0` → CO2 tracking OFF for UNIS

### 6C. Pipeline Stock (BE Owner)
- [ ] **6C-01** — `pipeline_stock` records created per trip (v3.6 requirement)
- [ ] **6C-02** — FK integrity: `trip_id` → `transport_plan_trip` valid

### 6D. Output Validation (DA Owner)
- [ ] **6D-01** — All allocation results có corresponding transport trip
- [ ] **6D-02** — No expired carrier rates used (`EC-T02: RATE_EXPIRED`)
- [ ] **6D-03** — Vehicle utilization: spot-check (nhỏ hơn tải tối đa)
- [ ] **6D-04** — Lane coverage: mọi `origin → dest` pair có trong carrier_rate table

---

## Step 7 — Execution Bridge (Bravo ERP)
> **UNIS Config:** `erp=BRAVO`, `approval_chain=[CN_WH]`, `post_approval_edit=False`, `sandbox=development only`

### 7A. CN_WH Approval Account Setup (OPS Owner) — ✅ RESOLVED
- [x] **7A-01** — Create CN_WH user accounts — ✅ 3 accounts seeded (cn_hcm, cn_mttng, cn_tnb)
- [x] **7A-02** — Assign role `CN_WH` — ✅ Done in `seed_unis_cn_accounts.py`
- [ ] **7A-03** — Verify CN_WH can see only own branch orders (runtime test needed)

### 7B. Draft Order Creation (BE Owner)
- [ ] **7B-01** — `POST /api/v1/orders/draft` từ Transport Plan trips
- [ ] **7B-02** — Order type mapping: `PROCUREMENT` trip → `PO`, `TRANSFER` trip → `TO`
- [ ] **7B-03** — Idempotency key: `tenant_id:trip_id:order_type` — test duplicate prevention
- [ ] **7B-04** — Status: `DRAFT` — visible to CN_WH for review
- [ ] **7B-05** — `GET /api/v1/orders/drafts` — list draft orders for CN_WH approval queue ⚠️ **NEW ENDPOINT — FE already calls this (P0-08e fix)**

### 7C. Approval Workflow (BE Owner)
- [ ] **7C-01** — `UNIS: ALL orders require CN_WH approval` — `requires_approval(any_type)=True`
  > ✅ **FIXED 2026-04-12**: `execution_bridge/plugins/unis.py` updated `approval_role()="CN_WH"`, `approval_chain=["CN_WH"]`
- [ ] **7C-02** — `post_approval_edit_allowed=False` — strict, no edit after CN_WH approval
- [ ] **7C-03** — Post-approval edit attempt → **must return 403 Forbidden** (UNIS: `post_approval_edit_allowed=False`). Verify NO re-approval path exists.
- [ ] **7C-04** — `AdjustmentReport` logged on any change

### 7D. Bravo SFTP Integration (BE + OPS Owner) — BLOCKER
- [ ] **7D-01** — SFTP smoke test: connect to Bravo SFTP server (credentials from UNIS IT)
- [ ] **7D-02** — Test file push: send sample batch file, verify receipt
- [ ] **7D-03** — `STATUS_STAGED → STATUS_POSTED` transition — manual operator retry available
  - Code reference: `src/execution_bridge/constants.py` lines 62-71
- [ ] **7D-04** — ERP timeout: `BRAVO=8s` per order → retry 3× exponential backoff (1s, 4s, 16s)
- [ ] **7D-05** — After max retry → `MANUAL_POSTING` alert → operator action required

### 7E. Supplier Collaboration (Parallel Track) (BE Owner)
- [ ] **7E-01** — After ERP posting (status=SENT): notify NM/supplier via configured channel
- [ ] **7E-02** — `CommitmentObject`: `committed_qty`, `committed_date`, `response_sla_state`
- [ ] **7E-03** — UNIS SLA: `po_overdue_days=10` (longer lead times than default 7 days)
- [ ] **7E-04** — PO_OVERDUE alert triggers sau 10 ngày không có CONFIRMED

---

## Step 8 — Monitor & Learn
> **UNIS Config:** `drift_threshold=20%`, `kpi[FILL_RATE]=92%`, `kpi[OTIF]=90%`, `po_overdue_days=10`, `closed_loop=True`

### 8A. KPI Dashboard (BE + UX Owner)
- [ ] **8A-01** — KPI targets seeded cho UNIS:
  | KPI | Target |
  |---|---|
  | MAPE | ≤ 25% |
  | Override Rate | ≤ 25% |
  | Fill Rate | ≥ 92% |
  | OTIF | ≥ 90% |
  | Inventory Turns | ≥ 6.0 |
- [ ] **8A-02** — KPI dashboard shows UNIS tenant data (filtered by tenant_id)
- [ ] **8A-03** — `kpi_link` table populated với UNIS-specific KPI definitions

### 8B. Drift Detection (BE Owner)
- [ ] **8B-01** — `drift_threshold=20%` (building materials more volatile than default 15%)
- [ ] **8B-02** — 4-week rolling MAPE computed per `model_config_id`
- [ ] **8B-03** — `psi_threshold=0.30` for feature drift tolerance
- [ ] **8B-04** — FORECAST_DRIFT alert → trigger Planner review
- [ ] **8B-05** — Auto-fallback: MAPE > 20% → Holt-Winters fallback triggered

### 8C. PO Lifecycle Tracking (BE Owner)
- [ ] **8C-01** — PO state transitions tracked via DB (Phase 1 = no Kafka; Phase 2 = `po.state_changed` topic)
- [ ] **8C-02** — `shipment_milestone` created per state transition
- [ ] **8C-03** — PO_OVERDUE: PO in SENT > 10 days → alert Buyer (UNIS override: 10 days not 7)
- [ ] **8C-04** — SHIPMENT_LATE: past ETA → alert Control Tower

### 8D. Closed-Loop Feedback (BE Owner)
- [ ] **8D-01** — `fc_ss_closed_loop_enabled=True` — verify feedback signal wired
- [ ] **8D-02** — ETA slip → re-trigger Step 4 DRP netting (incremental replan)
- [ ] **8D-03** — Override patterns → improve RTMRule priorities (Step 5 input)
- [ ] **8D-04** — Forecast vs actual delta → retrain / adjust forecast model (Step 1 input)

### 8E. Alert Fatigue Prevention
- [ ] **8E-01** — Debounce: alert only after ETA stable > 30 min (`EC-M01`)
- [ ] **8E-02** — War room trigger criteria verified for UNIS (thresholds may differ)

---

## 🗄️ Data Loading Checklist (DE — All Steps)

### Phase 1: Clean Masterdata (No Waiting Required)
| Task | File | Status | Owner |
|---|---|---|---|
| Load Warehouse | `[Masterdata] Warehouse - Sheet1.csv` | ⬜ TODO | DE |
| Load Branch (filter phantom CNs) | `[Masterdata] Branch - Sheet1.csv` | ⬜ TODO | DE |
| Load Item (status=ACT only) | `[Masterdata] Item - Sheet1.csv` | ⬜ TODO | DE |
| Load Nơi kéo / RTM draft | `[Masterdata] Nơi kéo - Sheet1.csv` | ⬜ TODO | DE |

### Phase 2: Forecast Import (Available Now)
| Task | File | Status | Owner |
|---|---|---|---|
| Import aggregated forecast | `Forecast_30032026.csv` | ⬜ TODO | DE |
| Import branch-level forecast | `drp_export_dec25_q1_2026.csv` | ⬜ TODO | DE |
| Create demand_snapshot FROZEN | Via API or seed script | ⬜ TODO | DE+BE |
| Validate FSKU↔bravo_sku match | Cross-join both files | ⬜ TODO | DA |

### Phase 3: Waiting for UNIS IT
| Task | File | Status | ETA |
|---|---|---|---|
| Branch inventory snapshot | `[Template] Upload Branch_Inventory.csv` | 🔴 PENDING | UNIS IT |
| Factory inventory snapshot | `[Template] Upload Factory_Inventory.csv` | 🔴 PENDING | UNIS IT |
| Sales history (12 months) | `[Template] Sales data.csv` | 🔴 PENDING | UNIS IT |

### Validation Gate (Before Any DRP Run)
- [ ] **DG-01** — Item count: expected > 0 active SKUs in `item` table
- [ ] **DG-02** — Location count: Branch + Warehouse count matches masterdata
- [ ] **DG-03** — RTM rules: ≥ 1 rule per CN branch
- [ ] **DG-04** — Demand snapshot: at least 1 FROZEN snapshot with > 0 lines
- [ ] **DG-05** — Supply snapshot: at least 1 FROZEN snapshot with > 0 lines
- [ ] **DG-06** — SS values: A-class items at all CN locations have `ss_target > 0` in `item_classification` table

---

## 🌐 API Endpoint Checklist (Summary)

| Method | Endpoint | Purpose | Step | Owner | Status |
|---|---|---|---|---|---|
| `POST` | `/demand/forecast/upload` | Bulk import forecast CSV | 1 | BE | ⬜ NEW |
| `GET` | `/demand/forecast/summary` | Aggregated view | 1 | BE | ⬜ NEW |
| `GET` | `/demand/forecast/detail` | Branch-level view | 1 | BE | ⬜ NEW |
| `POST` | `/demand/forecast/{run_id}/freeze` | Snapshot freeze | 1 | BE | ⬜ NEW |
| `POST` | `/demand/snapshot` | Create demand snapshot | 1 | BE | ✅ exists |
| `POST` | `/supply/snapshot` | Capture supply snapshot | 2 | BE | ✅ exists |
| `GET` | `/supply/snapshots/{snapshot_id}` | Snapshot detail | 2 | BE | ✅ exists |
| `GET` | `/supply/freshness` | Check freshness | 2 | BE | ✅ exists |
| `POST` | `/policies/safety-stock/compute` | Batch SS computation | 3 | BE | ✅ exists |
| `POST` | `/policies` | Create policy | 3 | BE | ✅ exists |
| `POST` | `/drp/run` | Run DRP netting | 4 | BE | ✅ exists |
| `POST` | `/allocation/run` | Run allocation | 5 | BE | ✅ exists |
| `POST` | `/transport/plan` | Create transport plan | 6 | BE | ✅ exists |
| `GET` | `/orders/drafts` | List draft orders for CN_WH review | 7 | BE | ⬜ **NEW** |
| `POST` | `/orders/draft` | Create draft orders | 7 | BE | ✅ exists |
| `POST` | `/orders/{order_id}/approve` | CN_WH approve order | 7 | BE | ✅ exists |
| `GET` | `/monitor/kpis` | KPI dashboard | 8 | BE | ✅ exists |
| `GET` | `/monitor/alerts` | Active alerts | 8 | BE | ✅ exists |

---

## 🧪 End-to-End Test Scenarios (UAT)

### TC-01: Full Pipeline Happy Path (A-class SKU)
```
1. Upload forecast → DemandSnapshot FROZEN
2. Upload branch inventory → SupplySnapshot FROZEN
3. Trigger DRP → PlannedOrder created
4. Run Allocation (L1-L6) → ALLOCATED result
5. Create TransportPlan → Trip FLATBED/CRANE created
6. Create DraftOrder (PO/TO) → status=DRAFT
7. CN_WH approves → status=APPROVED → Bravo SFTP push
8. Monitor KPI → FILL_RATE updated
```

### TC-02: Shortage Scenario (Demand > Supply)
```
1. Seed: forecast_qty=1000, on_hand=300
2. Run pipeline → Layer 4 fair-share, Layer 5 SS guard
3. Expected: SHORTAGE exception, SS protected, partial ALLOCATED
4. Buyer receives Recommendation → ESCALATE to SC Manager
```

### TC-03: LCNB DETECT_ONLY (Sibling CN Transfer)
```
1. CN-A demand > supply from NM
2. CN-B has excess inventory
3. Layer 6 LCNB DETECT_ONLY → creates Recommendation (not actual TO)
4. Buyer reviews: APPROVE → manual TO creation
```

### TC-04: Dormant SKU Filtering (from Forecast CSV)
```
1. `combo_class=DORMANT_DISCONTINUED` + `forecast_qty=0`
2. Expected: filtered from DRP netting (no PlannedOrder)
3. Verify: active demand line count excludes dormant SKUs
```

### TC-05: Tết Flag Handling (Jan-Mar 2026)
```
1. `tet_flag=Y` rows in forecast (2026-01, 02, 03)
2. Verify: seasonal demand captured in DemandSnapshot
3. DRP: higher planned orders for Tết months
4. Transport: higher trip volume for Jan batch
```

### TC-06: Bravo ERP Retry (Step 7 Failure Simulation)
```
1. Simulate SFTP timeout
2. Verify: 3× retry exponential backoff (1s, 4s, 16s)
3. After max retry → MANUAL_POSTING alert
4. Operator: STATUS_STAGED → STATUS_POSTED (manual)
```

### TC-07: Variant Matching (UNIS-Specific)
```
1. Seed: 2 items same item_code, different variant (color: 68414 vs 68416)
2. Demand for variant 68414 only
3. Run Allocation → Layer 2 specs_id_mode=VARIANT
4. Expected: only variant 68414 allocated, 68416 NOT substituted
5. Verify: no cross-variant allocation (UNIS strict matching)
```

---

## 👥 Owner Matrix — Team Assignment

| Area | Dev | Responsibility |
|---|---|---|
| **DE** (Data Engineer) | - | Steps 1A, 2A, 3A, data loading, validation gates |
| **BE** (Backend) | - | Steps 1B-1C, 2B, 3B-3E, 4B, 5B-5E, 6B-6C, 7B-7E, 8A-8D |
| **DA** (Data Analyst) | - | Steps 1D, 2C, 3C-3D, 4C, 5F, 6D, RTM rules draft |
| **UX/FE** | - | Buyer Decision Gate UI (Step 5E), KPI dashboard (Step 8A) |
| **OPS** | - | CN_WH account setup (Step 7A), Bravo SFTP (Step 7D) |
| **BA** | - | Business rule confirmations (bravo_sku, item status, RTM semantics) |

---

## 🚨 Blocking Issues — Action Required NOW

| ID | Issue | Blocking | Owner | Deadline |
|---|---|---|---|---|
| **B1** | Branch inventory CSV chưa có | Steps 2, 4, 5 | UNIS IT | ASAP |
| **B2** | Factory inventory CSV chưa có | Steps 2, 4, 5 | UNIS IT | ASAP |
| ~~**B3**~~ | ~~Primary key: bravo_sku vs item_code~~ → **RESOLVED: `item_code` is PK** | Steps 1, 3, 5 | UNIS BA | Done |
| ~~B4~~ | ~~CN_WH approver account~~ | — | — | ✅ **DONE** — 3 accounts seeded |
| **B5** | Bravo SFTP smoke test chưa pass | Step 7 | OPS + BE | UAT Day -3 |
| **B6** | ~~Sales history chưa có~~ → proxy available from DRP export | Step 3 SS | ~~UNIS IT~~ DE | ✅ **DOWNGRADED** |
| **B7** | RTM duplicates chưa resolve | Step 3, 5 | UNIS BA | UAT Day -3 |

---

## 📅 Recommended Timeline

| Day | Milestone | Steps |
|---|---|---|
| **D-7** | Master data clean + seeded (Warehouse, Branch, Item) | PC-01 |
| **D-6** | Forecast data imported, DemandSnapshot FROZEN | Step 1 |
| **D-5** | RTM rules draft seeded, ABC classified | Step 3 partial |
| **D-4** | Branch/Factory inventory received + seeded → SupplySnapshot FROZEN | Step 2 |
| **D-3** | SS computed, DRP triggered → PlannedOrders generated | Steps 3D, 4 |
| **D-2** | Allocation run → Transport plan → DraftOrders created | Steps 5, 6, 7A-7D |
| **D-1** | CN_WH approval UAT test, Bravo SFTP push test, Monitor KPI check + FE smoke test all screens | Steps 7, 8 |
| **D-0** | UAT Day 1: TC-01 → TC-07 full run | All steps |

---

## 📎 Reference Files

| File | Location | Purpose |
|---|---|---|
| Pipeline spec | `pipeline/pipeline_execution_core.md` | 8-step definition |
| Data loading guide | `unis/UNIS-DATA-LOADING-GUIDE.md` | DE/DA technical guide |
| UAT roadmap | `unis/UNIS-UAT-ROADMAP.md` | Test cases + timeline |
| Data requirements | `unis/docs-require.md` | Questions for UNIS BA/IT |
| Forecast (aggregated) | `unis/Forecast_30032026.csv` | Step 1 seed |
| Forecast (branch-level) | `unis/drp_export_dec25_q1_2026.csv` | Step 1 + DRP detail |
| Branch masterdata | `unis/[Masterdata] Branch - Sheet1.csv` | Step 2 source |
| Item masterdata | `unis/[Masterdata] Item - Sheet1.csv` | Steps 1-5 source |
| RTM masterdata | `unis/[Masterdata] Nơi kéo - Sheet1.csv` | Step 3+5 RTM rules |
| Warehouse masterdata | `unis/[Masterdata] Warehouse - Sheet1.csv` | Step 2 source |

---

*Generated: 2026-04-12 · SCP Team Internal · Review Session Document*  
*Source: `pipeline/pipeline_execution_core.md` v1.1 + UNIS plugin inspection + Forecast CSV analysis*
