# UNIS SCP v2.0 — Implementation Checklist

> **Ngày tạo:** 2026-04-15
> **Phiên bản PRD:** v2.0
> **Trạng thái hệ thống:** 8 module GoLive, data thật
> **Nhân sự:** 4 BE · 2 DA · 2 DevOps · 2 FE

---

## Pipeline Execution v2.0 — Tổng thể 2 Flow

### Flow 1 — Monthly S&OP Booking (chạy theo chu kỳ tháng)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FLOW 1 — MONTHLY CYCLE (Day 1 → Day 30)             │
└─────────────────────────────────────────────────────────────────────────────┘

  [Day 1-3]              [Day 3-7]             [Day 7-10]           [Day 10-15]
  ┌────────────┐         ┌────────────┐        ┌────────────┐       ┌────────────┐
  │    M11     │         │    M12     │        │    M13     │       │    M14     │
  │  Demand    │────────▶│   S&OP     │───────▶│ Production │──────▶│ Commitment │
  │  Aggregate │         │ Consensus  │        │ Lot Sizing │       │  Mgmt 3-Tier│
  │            │         │            │        │            │       │            │
  │ • FC Tổng  │         │ • SC adjust│        │ • Hub net  │       │ • Hard ±5% │
  │ • FC CN    │         │ • CN adjust│        │ • SS Hub   │       │ • Firm ±15%│
  │ • B2B pipe │         │ • FVA track│        │ • MOQ round│       │ • Soft ±30%│
  │ (6 stages) │         │ • Lock Day10│        │ • Booking  │       │            │
  └─────┬──────┘         └─────┬──────┘        └─────┬──────┘       └─────┬──────┘
        │                      │                     │                     │
        └──────────────────────┴─────────────────────┴─────────────────────┘
                                          │
                                          ▼
  [Day 15-20]           [Day 20-25]           [Day 25-28]           [Day 28-30]
  ┌────────────┐         ┌────────────┐        ┌────────────┐       ┌────────────┐
  │    M15     │         │    M16     │        │    M17     │       │   → F2     │
  │ NM Response│         │  Hub ảo    │        │  Gap &     │       │  Nightly   │
  │ & Negotiate│────────▶│  Virtual   │───────▶│  Scenario  │──────▶│  Input     │
  │            │         │  Inventory │        │  Simulator │       │            │
  │ • Accept   │         │            │        │            │       │ hub_virtual│
  │ • Partial  │         │ virtual =  │        │ Day 20 >15%│       │ feeds M23  │
  │ • Reject   │         │ committed  │        │ Day 25 >10%│       │ next month │
  │ • SLA 3d/5d│         │  - Σ SS_cn │        │ Day 28 auto│       │            │
  └────────────┘         └────────────┘        └────────────┘       └────────────┘
```

### Flow 2 — Daily DRP (chạy hàng đêm 23:00)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLOW 2 — NIGHTLY DRP PIPELINE (23:00 → 06:00)            │
└─────────────────────────────────────────────────────────────────────────────┘

  [18:00 CUTOFF]        [23:00 START]          [23:15]               [23:30]
  ┌────────────┐         ┌────────────┐        ┌────────────┐       ┌────────────┐
  │    M21     │         │    M22     │        │    M23     │       │    M24     │
  │ Data Sync  │────────▶│  CN Demand │───────▶│ DRP Netting│──────▶│ Allocation │
  │ Freshness  │         │ Adjustment │        │ + SS CN v2 │       │ LCNB v2    │
  │            │         │            │        │            │       │            │
  │ • NM upload│         │ • Submit   │        │ • Per-CN   │       │ • NEAREST  │
  │ • 24h gate │         │   ±30%     │        │ • σ dynamic│       │ • FIFO     │
  │ • 2x/day   │         │ • Trust    │        │ • LT_hub   │       │ • Fair-shr │
  │ • NM tmpl  │         │ • Auto-apv │        │ • Seasonal │       │ • SS guard │
  │            │         │   > 85%    │        │ • Variant  │       │ • Variant  │
  └─────┬──────┘         └─────┬──────┘        └─────┬──────┘       └─────┬──────┘
        │                      │                     │                     │
    (freshness)            (cutoff 18:00)      (from M16 Hub ảo)    (from M00)
        │                                                                  │
        └──────────────── block nếu data stale ─────────────────────────────┘

                                          │
                                          ▼
  [23:45]               [00:00]              [05:00]               [06:00]
  ┌────────────┐         ┌────────────┐        ┌────────────┐       ┌────────────┐
  │    M25     │         │    M26     │        │    M27     │       │    M28     │
  │ Transport  │         │  NM ATP    │        │ PO Review  │       │ Feedback   │
  │ Lot Sizing │────────▶│   Check    │───────▶│ & Confirm  │──────▶│ Closed Loop│
  │            │         │            │        │ (REBUILD)  │       │            │
  │ • Container│         │ • PASS     │        │ • Draft    │       │ • SS auto  │
  │ • Hold/Ship│         │ • PARTIAL  │        │ • Review   │       │ • LT update│
  │ • Top-up   │         │ • FAIL     │        │ • Override │       │ • Override │
  │ • Multi-drp│         │ • Urgency  │        │ • Tracking │       │   analysis │
  │ • LT-aware │         │   (HSTK ↓) │        │ • PO overdu│       │ • KPI wkly │
  └────────────┘         └─────┬──────┘        └─────┬──────┘       └─────┬──────┘
                               │                     │                    │
                           (honoring %)         (SENT to NM)          (→ M00 update
                                                                       NM lead_time)
                                                                          │
                                                                          ▼
                                                                    [NEXT CYCLE]
                                                                    M22 trust score
                                                                    M23 SS refresh
                                                                    M11 FC MAPE
```

### Cross-Flow Integration Points

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         M00 MASTER DATA (Foundation)                         │
│  SKU · CN · NM · Hub · Mappings · Configs (M10)                             │
└──────────────────────────────────────────────────────────────────────────────┘
            ▲                                                    ▲
            │                                                    │
   ┌────────┴─────────┐                               ┌──────────┴──────────┐
   │     FLOW 1       │                               │       FLOW 2        │
   │   (Monthly)      │                               │      (Daily)        │
   │                  │                               │                     │
   │ Outputs:         │      ◀─── hub_virtual ───▶    │ Outputs:            │
   │ • booking_plan   │      (M16 ──feeds──▶ M23)     │ • po_header         │
   │ • commitment     │                               │ • to_header         │
   │ • hub_virtual    │      ◀─── SS_cn refresh ──▶   │ • allocation_line   │
   │ • B2B deals      │      (M28 ──updates──▶ M23)   │ • transport_trip    │
   │                  │                               │                     │
   │                  │      ◀─── LT actual ──────▶   │                     │
   │                  │      (M28 ──updates──▶ M00)   │                     │
   └──────────────────┘                               └─────────────────────┘
                                      │
                                      ▼
                    ┌──────────────────────────────────────┐
                    │       M08 / M28 — Monitor & KPI      │
                    │  FC MAPE · Trust Score · Honoring %  │
                    │  SS Accuracy · FVA · Override Top 5  │
                    └──────────────────────────────────────┘
```

### Data Flow Timeline (1 tháng typical)

```
Day:  01 ──── 05 ──── 10 ──── 15 ──── 20 ──── 25 ──── 28 ──── 30
      │        │        │        │        │        │        │
Flow1:├─M11────┼─M12────┤        │        │        │        │
      │   FC   │  S&OP  ├─M13────┤        │        │        │
      │ upload │ review │Lot size├─M14────┤        │        │
      │        │        │        │ Commit ├─M15────┤        │
      │        │    Lock│        │        │NM resp ├─M16────┤
      │        │   Day10│        │        │        │Hub ảo  ├─M17─┤
      │        │        │        │        │        │        │ Gap │
      │        │        │        │        │        │        │     │
Flow2:▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽▽
      ▽  M21→M22→M23→M24→M25→M26→M27→M28 (nightly every day, 23:00)
      ▽  feeds from M16 hub_virtual starting Day 20                   ▽
      ▽  feeds back to M11 next month via M28 SS/LT/trust refresh     ▽

End of month: M28 aggregates KPI → M11 next cycle begins Day 1
```

---

## Phân công nhân sự tổng quan

| Vai trò | Người | Trách nhiệm chính |
|---------|-------|-------------------|
| **BE1** | — | Flow 2 core: M21, M22, M23 |
| **BE2** | — | Flow 2 engine: M24, M25, M26 |
| **BE3** | — | Foundation M00 + Flow 1: M11, M12, M13 |
| **BE4** | — | Flow 1: M14, M15, M16, M17 + M27 REBUILD |
| **DA1** | — | Data model design, migration scripts, seeding |
| **DA2** | — | KPI metrics, analytics queries, reporting |
| **DevOps1** | — | CI/CD pipeline, staging env, DB migration workflow |
| **DevOps2** | — | Infra scaling, cron scheduler, alerting infra |
| **FE1** | — | Flow 2 UI: M21-M28 screens |
| **FE2** | — | Flow 1 UI: M11-M17 screens + M00 Master Data |

---

## Nguyên tắc thực thi

1. **Không xóa code cũ** — REBUILD module chạy song song folder mới, deprecate sau khi stable
2. **Migration incremental** — mỗi ticket chỉ 1 migration file, rollback phải test trước
3. **API versioning** — endpoint mới dùng `/v2/` prefix, không break `/v1/` đang GoLive
4. **Feature flag** — mọi feature mới bọc trong config flag, tắt được ngay nếu lỗi production
5. **Definition of Done (DoD)** — mỗi task phải có: unit test + integration test + Swagger doc + DA review schema

---

## Song song hay tuần tự?

```
Phase 0.0  ─────────────────────────────── (toàn team, 1 sprint)
Phase 0    ──────────────────────────────── (BE3+DA1, 2 sprint)
                                              ↓
           ┌─ Phase 1 (Flow 2) ─ BE1+BE2+FE1 ──────────── 5 sprint ─┐
           └─ Phase 2 (Flow 1) ─ BE3+BE4+FE2 ── bắt đầu sprint 4 ──┘
```

**Khả thi song song từ Sprint 4** — Flow 1 M11 (Demand Aggregation) không phụ thuộc Flow 2,
chỉ cần M00 Foundation xong. BE3+FE2 có thể bắt đầu M11+M12 trong khi BE1+BE2 đang làm M23-M26.

---

## PHASE 0.0 — Bug Fix (Sprint 0 · Toàn team · ~1 tuần)

> Unblock production bugs trước khi build mới. Ưu tiên cao nhất.

### BUG-01 · M02 Supply — `is_estimated` logic bị mất (không phải thiếu column)
**Owner:** BE1 · **DA:** DA1

> **Clarification:** Column `is_estimated` đã tồn tại trong schema. Vấn đề là **service logic không propagate** đúng `source_type` → `is_estimated`. Không cần migration schema.

- [ ] Đọc `supply.service.ts` → method `captureSnapshot()`
- [ ] Trace source_type: từ `lot_attribute` (hoặc bảng tương đương) khi build supply_snapshot_line
- [ ] Sửa logic: `is_estimated = (source_type === 'DISTRIBUTION')` hoặc rule tương đương theo business
- [ ] Đảm bảo NM upload trực tiếp → `is_estimated = false`, fallback/distribution → `is_estimated = true`
- [ ] Expose field trong API response GET `/supply/snapshots` (verify đã có, không ẩn đi)
- [ ] Unit test: captureSnapshot với source_type=NM_UPLOAD → `is_estimated = false`
- [ ] Unit test: captureSnapshot với source_type=DISTRIBUTION → `is_estimated = true`
- [ ] Backfill (optional): script re-run captureSnapshot cho snapshots gần đây để fix data hiện tại
- [ ] DA1 review: verify query phân biệt được estimated vs actual sau fix

### BUG-02 · M05 Allocation — multi-source flatten (cần bảng mới `allocation_leg`)
**Owner:** BE2 · **DA:** DA1

> **Clarification:** Bảng thực tế là `allocation_result` (không phải `allocation_line`). Thêm column vào 1 row KHÔNG giải quyết được multi-source — 1 demand line cần N rows (1 per source). Phải **tạo bảng con `allocation_leg`**.

- [ ] Đọc `allocation/` module, xác định chính xác schema `allocation_result`
- [ ] **DA1: thiết kế bảng mới** `allocation_leg`:
  - [ ] Columns: `id`, `allocation_result_id FK`, `source_type ENUM(HUB,NM,CN_REDIST)`, `source_entity_id`, `source_lot_id`, `allocated_qty`, `fifo_rank`, `distance_km`
  - [ ] Relationship: 1 `allocation_result` has many `allocation_leg`
  - [ ] Migration V001-B (chạy trước build mới)
- [ ] Sửa allocation engine: mỗi khi allocate từ source, insert 1 row vào `allocation_leg`
- [ ] `allocation_result.total_qty` = `Σ allocation_leg.allocated_qty` (compute hoặc trigger)
- [ ] Backfill data cũ: best-effort — đánh dấu leg = 'UNKNOWN' cho records trước fix
- [ ] Unit test: 1 demand 100 units từ 2 NM (60+40) → 1 `allocation_result` + 2 `allocation_leg`
- [ ] Unit test: LCNB fallback hub → CN redist → tạo 2 leg rows
- [ ] Kiểm tra FE: bảng allocation render drill-down leg per result
- [ ] DA1 review: aggregate query per-source vẫn chính xác

### BUG-03 · M07 Order Bridge — `createBatch` transaction safety
**Owner:** BE4 · **DA:** DA1

- [ ] Đọc `order-bridge/` module, xác định `createBatch` service method
- [ ] Audit: liệt kê tất cả DB writes trong 1 createBatch call
- [ ] Bọc toàn bộ writes trong `dataSource.transaction(async manager => { ... })`
- [ ] Test rollback: simulate fail ở giữa batch → confirm không có partial write
- [ ] Thêm idempotency key per batch để tránh duplicate nếu retry
- [ ] Unit test: mock DB fail ở line N → rollback toàn bộ
- [ ] Integration test: batch 100 lines, fail line 50 → 0 lines committed
- [ ] DA1 review: check data integrity sau fix

**Phase 0.0 DoD:**
- [ ] 3 bugs deployed lên staging
- [ ] DA1+DA2 verify data integrity trên staging DB
- [ ] DevOps1 deploy hotfix lên production với zero downtime
- [ ] Monitor 24h sau deploy, không có regression

---

## PHASE 0 — Foundation (Sprint 1-2 · BE3 + DA1 + DevOps1)

> Không có Foundation → không module nào chạy được.
> Flow 1 và Flow 2 đều phụ thuộc M00.

### M00 · Master Data Platform
**Owner:** BE3 · **DA:** DA1 · **FE:** FE2

#### Sprint 1 — DB Schema & Core CRUD

- [ ] **DA1: thiết kế schema** (phải xong trước khi BE code)
  - [ ] Table `sku` — id, code, name, unit, variants JSON, category, active
  - [ ] Table `sku_variant` — id, sku_id, variant_code, name, attrs JSON
  - [ ] Table `channel` (CN) — id, code, name, region, address, lat, lng, active
  - [ ] Table `supplier` (NM) — id, code, name, contact, lead_time_days, active
  - [ ] Table `hub` — id, code, name, lat, lng, capacity
  - [ ] Table `sku_nm_mapping` — sku_id, nm_id, moq, priority (single-source mapping)
  - [ ] Table `sku_cn_mapping` — sku_id, cn_id, ss_override, z_override
  - [ ] **Extend table `transport_lane`** (đã có trong M6) — thêm `transit_lt_days DECIMAL(5,2)`, `lane_type ENUM(NM_TO_CN, NM_TO_HUB, HUB_TO_CN, CN_TO_CN)` để support LCNB + M28 LT auto-update
  - [ ] Seed `transport_lane` cho tất cả combinations NM×CN và CN×CN trong phạm vi LCNB (default 500km)
  - [ ] Review quan hệ FK, index
  - [ ] Migration script V001

- [ ] **BE3: NestJS module `master-data/`**
  - [ ] `sku.entity.ts`, `channel.entity.ts`, `supplier.entity.ts`, `hub.entity.ts`
  - [ ] CRUD endpoints: GET/POST/PUT/DELETE cho mỗi entity
  - [ ] GET với pagination + filter (search by code/name)
  - [ ] Validation DTO với class-validator
  - [ ] Soft delete (active flag, không xóa thật)
  - [ ] Swagger decorators đầy đủ

- [ ] **BE3: Referential integrity service**
  - [ ] Validate SKU-NM mapping: 1 SKU chỉ map 1 NM active (single-source rule)
  - [ ] Validate CN phải có lat/lng (cho LCNB distance calculation sau)
  - [ ] Validate NM lead_time_days > 0
  - [ ] Error response chuẩn với error code

#### Sprint 2 — Import, Quality Dashboard, FE

- [ ] **BE3: Bulk import**
  - [ ] POST `/master-data/import/sku` — CSV template + validation
  - [ ] POST `/master-data/import/channels` — CSV
  - [ ] POST `/master-data/import/suppliers` — CSV
  - [ ] Import preview (dry-run mode: validate nhưng không commit)
  - [ ] Import log: success count, error rows với line number + reason

- [ ] **BE3: NM upload template generator**
  - [ ] GET `/master-data/suppliers/:id/upload-template` → generate Excel/CSV với SKU list của NM đó
  - [ ] Template có header: sku_code, available_qty, atp_qty, last_updated

- [ ] **DA2: Data quality dashboard queries**
  - [ ] SKU không có NM mapping
  - [ ] CN không có lat/lng
  - [ ] NM không có SKU mapping
  - [ ] SKU chưa từng có supply snapshot trong 30 ngày

- [ ] **BE3: Data quality API**
  - [ ] GET `/master-data/quality` → trả về 4 metrics từ DA2 queries

- [ ] **FE2: Master Data screens**
  - [ ] SKU list + form CRUD
  - [ ] CN list + form + map view (lat/lng)
  - [ ] NM list + form + lead time config
  - [ ] Bulk import UI với preview table
  - [ ] Data quality dashboard widget

### M10 · Policy Platform — Extended
**Owner:** BE3 · **DA:** DA1

- [ ] Audit M10 hiện tại: liệt kê 30 configs đang có
- [ ] Thêm configs nhóm LCNB: `lcnb_enabled`, `lcnb_max_distance_km`, `lcnb_fifo_enabled`
- [ ] Thêm configs nhóm Trust Score: `trust_score_window_weeks`, `trust_score_auto_approve_threshold`
- [ ] Thêm configs nhóm Transport: `min_fill_ratio`, `hold_days`, `max_hold_days`
- [ ] Thêm configs nhóm B2B: `b2b_hard_tolerance_pct`, `b2b_firm_tolerance_pct`, `b2b_soft_tolerance_pct`
- [ ] Thêm configs nhóm Cutoff: `cn_adjustment_cutoff_time`, `drp_run_time`
- [ ] Migration: seed default values cho tất cả configs mới
- [ ] Unit test: load config → trả về đúng giá trị default
- [ ] FE2: Config screen bổ sung tab/section cho nhóm configs mới

**Phase 0 DoD:**
- [ ] M00 + M10 deployed staging
- [ ] DA1 verify schema migrations clean
- [ ] FE2 import thử 50 SKU + 10 CN + 5 NM thành công
- [ ] DevOps1 setup migration workflow (alembic/typeorm migration auto-run on deploy)

---

## PHASE 1 — Flow 2: Daily DRP (Sprint 3-7)

> Nâng cấp nightly DRP đang chạy production.
> **Parallel với Phase 2 từ Sprint 4.**

### M21 · Data Sync & Freshness Gate
**Owner:** BE1 · **FE:** FE1 · **DA:** DA1

- [ ] **DB:**
  - [ ] Thêm `nm_id FK` vào `supply_snapshot` (hiện tại không có)
  - [ ] Thêm `synced_at TIMESTAMP`, `source ENUM('nm_upload','manual','estimated')`
  - [ ] Table `sync_log` — id, nm_id, triggered_by, status, rows_imported, error_msg, created_at
  - [ ] Migration V002

- [ ] **BE1: Freshness gate service**
  - [ ] `FreshnessService.check(nm_id)` → true nếu last sync < 24h
  - [ ] `FreshnessService.checkAll()` → map nm_id → {fresh, hours_since_sync}
  - [ ] Middleware guard: block DRP run nếu bất kỳ NM nào stale (configurable threshold)

- [ ] **BE1: NM upload per-template**
  - [ ] POST `/supply/upload/:nm_id` — chỉ nhận file format từ NM template của M00
  - [ ] Validate header match template của NM đó
  - [ ] Cập nhật `synced_at` sau upload thành công

- [ ] **BE1: Manual sync trigger**
  - [ ] POST `/supply/sync/trigger/:nm_id` — SC Manager trigger manually
  - [ ] POST `/supply/sync/trigger-all` — sync tất cả NM

- [ ] **BE1: Sync schedule**
  - [ ] DevOps2 setup cron: 2x/day (06:00 + 14:00) gọi sync-all
  - [ ] Log kết quả vào `sync_log`

- [ ] **FE1: Sync dashboard**
  - [ ] Bảng NM × last_sync × status (Fresh/Stale/Missing)
  - [ ] Button trigger manual sync per NM
  - [ ] Alert badge nếu có NM stale trước DRP run

### M22 · CN Demand Adjustment & Trust Score
**Owner:** BE1 · **FE:** FE1 · **DA:** DA2

- [ ] **DB:**
  - [ ] Table `cn_demand_adjustment` — id, cn_id, sku_id, period_date, original_qty, adjusted_qty, delta_pct, reason_code, status ENUM(PENDING/APPROVED/REJECTED/AUTO_APPROVED), submitted_by, reviewed_by, created_at
  - [ ] Table `trust_score` — cn_id, sku_id, score DECIMAL(5,2), window_weeks, last_calculated_at
  - [ ] Table `reason_code` — id, code, label (lookup table)
  - [ ] Migration V003

- [ ] **BE1: Adjustment service**
  - [ ] POST `/cn-adjustment` — CN submit adjustment với reason_code
  - [ ] Validate: delta_pct trong ±30% tolerance (configurable từ M10)
  - [ ] Validate: submitted trước cutoff 18:00 (configurable từ M10)
  - [ ] GET `/cn-adjustment?cn_id=&period=` — list adjustments

- [ ] **BE1: Trust Score engine**
  - [ ] `TrustScoreService.calculate(cn_id, sku_id)` — rolling 12 tuần, so sánh adjusted vs actual
  - [ ] Cron: recalculate trust score weekly (Thứ 2 00:00)
  - [ ] Store vào `trust_score` table

- [ ] **BE1: Auto-approve logic**
  - [ ] Khi submit adjustment: nếu `trust_score >= threshold` (default 85%) → auto-approve
  - [ ] Nếu không → status = PENDING, notify SC Manager

- [ ] **BE1: SC Manager review**
  - [ ] GET `/cn-adjustment/pending` — list pending adjustments
  - [ ] PATCH `/cn-adjustment/:id/approve` hoặc `/reject`

- [ ] **DA2: Trust score analytics query**
  - [ ] Top CN có trust score thấp nhất
  - [ ] Trend trust score theo tuần

- [ ] **FE1: CN Adjustment screen**
  - [ ] Form submit adjustment với reason dropdown
  - [ ] Status badge PENDING / APPROVED / AUTO-APPROVED
  - [ ] SC Manager review queue

### M23 · DRP Netting v2 + Safety Stock CN
**Owner:** BE1 · **DA:** DA1 + DA2

> **Phức tạp nhất trong Flow 2. Dành 1.5 sprint.**

- [ ] **DB:**
  - [ ] Table `ss_cn` — cn_id, sku_id, z_value, sigma_demand, lt_hub_days, ss_qty, calculated_at, **policy_run_id FK** (pin baseline)
  - [ ] Thêm `per_cn_netting` JSONB vào `drp_run` hoặc tách table `drp_cn_line`
  - [ ] **CRITICAL — Baseline Drift Fix:** thêm `policy_run_id FK` vào `plan_run` (và `drp_run`) để pin policy snapshot tại thời điểm chạy
  - [ ] Tạo `policy_run` snapshot table (nếu chưa có) — chứa snapshot full policy configs + ss_cn + z values tại 1 thời điểm
  - [ ] Migration V004

- [ ] **BE1: Policy pin logic (Baseline Drift Fix)**
  - [ ] Khi trigger DRP run: tạo `policy_run` snapshot FIRST, lưu id
  - [ ] Toàn bộ DRP netting + SS_cn compute đọc từ `policy_run` đã pin, KHÔNG đọc ACTIVE policy
  - [ ] Lý do: nếu admin đổi config giữa chừng, DRP run không drift
  - [ ] Unit test: trigger DRP → change config → DRP vẫn dùng policy snapshot ban đầu
  - [ ] DA1 review: verify mọi query analytics join qua `policy_run_id` để reproduce lịch sử

- [ ] **DA1: Design netting algorithm per CN**
  - [ ] Formula: `net_req_cn = demand_adj - (stock_cn - ss_cn) + transit_inbound_cn`
  - [ ] Xác định source của mỗi input field từ table nào

- [ ] **BE1: SS CN engine**
  - [ ] `SsCnService.calculate(cn_id, sku_id)` → z × σ_demand × √LT_hub
  - [ ] σ_demand: tính từ 12 tuần actuals (DA2 cung cấp query)
  - [ ] LT_hub: lấy từ `supplier.lead_time_days` qua sku_nm_mapping
  - [ ] z: lấy từ `sku_cn_mapping.z_override` hoặc default từ M10 config
  - [ ] LCNB SS reduction: nếu `lcnb_enabled` → SS_cn × (1 - lcnb_factor)

- [ ] **BE1: Seasonal sigma** *(Phase 1.5 — sau khi base done)*
  - [ ] σ seasonal: so sánh same-period-last-year (2 năm data)
  - [ ] Fallback về rolling sigma nếu không đủ data

- [ ] **BE1: Per-CN DRP netting**
  - [ ] Sửa DRP engine: loop qua từng CN, tính net_req per CN per SKU
  - [ ] Output: `drp_cn_line` với cn_id, sku_id, net_req, suggested_po_qty
  - [ ] Aggregate lên Hub level: `total_hub_req = Σ(net_req_cn)`

- [ ] **BE1: Variant breakdown suggestion**
  - [ ] Dựa vào `stock_cn` per variant → suggest variant mix trong PO
  - [ ] Rule: ưu tiên variant đang thấp nhất relative to SS

- [ ] **DA2: DRP analytics**
  - [ ] Query: CN nào có net_req > 0 mà stock > SS (over-stock detect)
  - [ ] Query: CN nào sẽ stock-out trước LT_hub nếu không PO

- [ ] Unit test: netting với 3 CN, 2 SKU → verify per-CN output
- [ ] Integration test: full DRP run với seed data

### M24 · Allocation Engine v2 (LCNB)
**Owner:** BE2 · **DA:** DA1

- [ ] **DB:**
  - [ ] Thêm `distance_km` vào `sku_cn_mapping` hoặc compute từ lat/lng
  - [ ] Thêm `allocation_method ENUM('BASIC','LCNB')` vào `allocation_run`
  - [ ] Thêm `nm_id`, `lot_id`, `fifo_rank`, `distance_km` vào `allocation_line`
  - [ ] Migration V005

- [ ] **BE2: Distance calculator**
  - [ ] `DistanceService.hubToCn(hub_id, cn_id)` — Haversine formula từ lat/lng
  - [ ] Cache distances vào DB hoặc Redis (không recalculate mỗi lần)

- [ ] **BE2: LCNB allocation engine**
  - [ ] Bước 1: Sort available lots by FIFO (earliest lot first)
  - [ ] Bước 2: Sort CN by distance ASC (NEAREST_FIRST)
  - [ ] Bước 3: Filter NM lots có distance ≤ max_distance_km (từ M10 config)
  - [ ] Bước 4: Allocate lot → CN, skip nếu CN đã có stock > SS_cn (SS guard)
  - [ ] Bước 5: Nếu hub không đủ → fair-share (proportional to net_req)
  - [ ] Bước 6: Variant match — allocate lot variant phù hợp với CN variant demand

- [ ] **BE2: Feature flag**
  - [ ] Nếu `lcnb_enabled = false` → fallback basic allocation (M5 cũ)
  - [ ] Log method used trong `allocation_run.allocation_method`

- [ ] Unit test: 3 NM lots + 5 CN → verify NEAREST_FIRST order
- [ ] Unit test: hub insufficient → fair-share proportional
- [ ] Unit test: SS guard → CN đã đủ không nhận thêm
- [ ] Unit test: FIFO → lot cũ nhất được allocate trước

### M25 · Transport Lot Sizing v2
**Owner:** BE2 · **FE:** FE1 · **DA:** DA2

- [ ] **DB:**
  - [ ] Thêm `fill_ratio DECIMAL(5,2)`, `hold_decision ENUM('SHIP','HOLD','TOPUP')` vào `transport_trip`
  - [ ] Thêm `hold_until DATE`, `hold_reason` vào `transport_trip`
  - [ ] Migration V006

- [ ] **BE2: Container packing service**
  - [ ] `PackingService.pack(trip_id)` — tính tổng pallet + tổng tấn
  - [ ] So sánh với vehicle capacity (từ M6 vehicle table)
  - [ ] Output: `fill_ratio = total_loaded / capacity`

- [ ] **BE2: Hold-or-ship decision**
  - [ ] Nếu `fill_ratio < min_fill_ratio` (default 60% từ M10 config):
    - Kiểm tra HSTK của CN đích: nếu HSTK > LT_hub + buffer_days → HOLD
    - Else → SHIP (urgent)
  - [ ] Hold duration: tối đa `max_hold_days` từ M10 config
  - [ ] Set `hold_until = today + hold_days`

- [ ] **BE2: Top-up suggestion**
  - [ ] Nếu HOLD: tìm CN khác có net_req > 0 trong route có thể thêm vào trip
  - [ ] Output: list suggested top-up CN + qty
  - [ ] SC Manager xem xét và confirm top-up (không auto)

- [ ] **DA2: Transport efficiency metrics**
  - [ ] Average fill ratio per route per month
  - [ ] % trips held vs shipped per NM

- [ ] **FE1: Transport screen updates**
  - [ ] Badge SHIP / HOLD / TOP-UP trên mỗi trip
  - [ ] Hold confirmation dialog với `hold_until` date
  - [ ] Top-up suggestion panel

### M26 · NM ATP Check & Urgency Ranking
**Owner:** BE2 · **DA:** DA2

- [ ] **DB:**
  - [ ] Table `atp_check` — run_id, nm_id, sku_id, requested_qty, atp_qty, result ENUM(PASS/PARTIAL/FAIL), checked_at
  - [ ] Table `nm_honoring_rate` — nm_id, period_month, requested_total, fulfilled_total, rate DECIMAL(5,2)
  - [ ] Migration V007

- [ ] **BE2: ATP check service**
  - [ ] `AtpService.check(nm_id, sku_id, requested_qty)` → PASS / PARTIAL / FAIL
  - [ ] PASS: atp_qty >= requested_qty
  - [ ] PARTIAL: 0 < atp_qty < requested_qty
  - [ ] FAIL: atp_qty = 0 hoặc NM data stale (từ M21 freshness gate)

- [ ] **BE2: Urgency ranking**
  - [ ] Khi PARTIAL: rank CN nhận hàng ưu tiên bằng HSTK ASC (thấp nhất được trước)
  - [ ] CN có HSTK < SS_cn → priority = CRITICAL

- [ ] **BE2: NM honoring rate**
  - [ ] Cron monthly: tính `fulfilled / requested` per NM
  - [ ] Lưu vào `nm_honoring_rate`
  - [ ] Expose trong M00 NM profile page

- [ ] Unit test: requested=100, atp=60 → PARTIAL + urgency rank 5 CN
- [ ] Unit test: NM data stale → FAIL regardless of atp_qty

### M27 · PO Review & Confirm (REBUILD)
**Owner:** BE4 · **FE:** FE1 · **DA:** DA1

> **REBUILD — tạo folder mới `po-review/`, chạy song song `order-bridge/`**
> Deprecate `order-bridge/` sau khi M27 stable.

- [ ] **DA1: Domain model mới**
  - [ ] Table `po_header` — id, nm_id, run_id, status ENUM(DRAFT/REVIEW/CONFIRMED/SENT/DELIVERED/CANCELLED), total_qty, created_at
  - [ ] Table `po_line` — id, po_header_id, sku_id, variant_id, requested_qty, confirmed_qty, unit_price
  - [ ] Table `to_header` — id, cn_id, trip_id, status ENUM(DRAFT/CONFIRMED/IN_TRANSIT/DELIVERED/CANCELLED)
  - [ ] Table `to_line` — id, to_header_id, sku_id, variant_id, qty
  - [ ] Table `po_edit_log` — id, po_header_id, field_changed, old_value, new_value, reason, changed_by, changed_at
  - [ ] Table `po_tracking` — po_header_id, vehicle_no, driver_name, carrier, eta, current_status
  - [ ] **Không dùng** `order_batch` / `order_batch_line` của M07 cho flow mới
  - [ ] Migration V008

- [ ] **BE4: PO workflow**
  - [ ] DRP run tạo PO với status DRAFT tự động
  - [ ] GET `/po?status=DRAFT` — SC Planner xem list PO cần review
  - [ ] PATCH `/po/:id/confirm` — confirm PO sau review
  - [ ] PATCH `/po/:id/lines/:line_id` — Planner override qty + mandatory reason
  - [ ] Mọi override ghi vào `po_edit_log`
  - [ ] POST `/po/:id/send` — gửi PO cho NM (status → SENT)

- [ ] **BE4: TO workflow**
  - [ ] TO tạo tự động từ allocation run
  - [ ] GET `/to?status=DRAFT` — xem list TO
  - [ ] PATCH `/to/:id/confirm`
  - [ ] Lifecycle: DRAFT → CONFIRMED → IN_TRANSIT → DELIVERED

- [ ] **BE4: PO Tracking**
  - [ ] PATCH `/po/:id/tracking` — cập nhật vehicle, driver, ETA
  - [ ] GET `/po/:id/tracking` — tracking status

- [ ] **BE4: PO Overdue alert**
  - [ ] Cron daily: check PO SENT mà ETA đã qua → alert
  - [ ] POST vào alert system (M8)

- [ ] **FE1: PO Review screen**
  - [ ] Tab PO và tab TO riêng biệt
  - [ ] List với filter status + NM + date
  - [ ] Inline edit qty với mandatory reason dialog
  - [ ] Edit log history per PO
  - [ ] Tracking panel với ETA + status

### M28 · Feedback & Closed Loop
**Owner:** BE1 · **DA:** DA2

- [ ] **DB:**
  - [ ] Table `ss_adjustment_log` — cn_id, sku_id, old_ss, new_ss, trigger ENUM(AUTO/MANUAL), calculated_at
  - [ ] Table `lt_actual_log` — nm_id, sku_id, po_id, promised_lt_days, actual_lt_days, recorded_at
  - [ ] Table `override_analysis` — period_week, reason_code, count, top_flag
  - [ ] Migration V009

- [ ] **BE1: SS auto-adjust (weekly)**
  - [ ] Cron Thứ 2: recalculate σ_demand từ 12 tuần actuals mới nhất
  - [ ] Nếu |new_ss - old_ss| > threshold → update `ss_cn`, log vào `ss_adjustment_log`
  - [ ] Gửi alert nếu SS tăng đáng kể (>20%)

- [ ] **BE1: Transit LT auto-update**
  - [ ] Khi PO status → DELIVERED: tính `actual_lt = delivery_date - sent_date`
  - [ ] Update `supplier.lead_time_days` = rolling average 6 tháng
  - [ ] Log vào `lt_actual_log`

- [ ] **BE1: Override analysis**
  - [ ] Weekly: aggregate `po_edit_log` → top 5 reason_code
  - [ ] Store vào `override_analysis`

- [ ] **DA2: Weekly KPI report queries**
  - [ ] FC MAPE per CN per SKU (nếu actual_sales có)
  - [ ] Trust score trend per CN
  - [ ] NM honoring rate (từ M26)
  - [ ] SS accuracy: actual stockout vs predicted

- [ ] **BE1: KPI endpoints**
  - [ ] GET `/feedback/weekly-kpi?week=` → summary report
  - [ ] GET `/feedback/override-analysis?week=` → top reasons
  - [ ] GET `/feedback/lt-accuracy?nm_id=` → LT promised vs actual

**Phase 1 DoD (Flow 2 complete):**
- [ ] M21-M28 deployed staging
- [ ] Full DRP run test: từ NM upload → allocation → transport → PO confirm
- [ ] DA2 verify KPI metrics accurate
- [ ] Load test: DRP run với 50 SKU × 20 CN × 5 NM < 30s
- [ ] DevOps2: cron scheduler cho DRP 23:00 + SS recalc Thứ 2 + LT sync daily
- [ ] DevOps1: rollback plan nếu M27 lỗi production (fallback về M07)

---

## PHASE 2 — Flow 1: Monthly S&OP Booking (Sprint 4-9)

> Bắt đầu song song từ Sprint 4 khi Phase 0 (M00) xong.
> **BE3+BE4+FE2.**

### M11 · Demand Aggregation v2
**Owner:** BE3 · **FE:** FE2 · **DA:** DA2

- [ ] **DB:**
  - [ ] Thêm `level ENUM('TOTAL','CN')` vào `demand_snapshot`
  - [ ] Thêm `cn_id FK` (nullable — NULL cho level TOTAL)
  - [ ] Thêm `horizon_months INT DEFAULT 12`
  - [ ] Table `b2b_deal` — id, cn_id, sku_id, stage ENUM(PROSPECT/QUALIFIED/PROPOSAL/NEGOTIATION/COMMITMENT/CLOSED), probability_pct, expected_qty, expected_date, created_at
  - [ ] Migration V010

- [ ] **BE3: 2-level FC upload**
  - [ ] POST `/demand/upload/total` — FC cấp Tổng (12 tháng)
  - [ ] POST `/demand/upload/cn` — FC cấp Chi nhánh (per CN, 12 tháng)
  - [ ] Consistency check: Σ(CN forecasts) vs Total ± 10% tolerance → warning nếu vượt

- [ ] **BE3: B2B pipeline**
  - [ ] CRUD endpoints cho `b2b_deal`
  - [ ] Stage transition: validate chỉ forward (không backward)
  - [ ] `WeightedDemandService.calculate(sku_id, month)`:
    - Lấy tất cả deals có `expected_date` trong tháng
    - `weighted_demand += expected_qty × probability_pct`
    - Cộng vào FC CN tương ứng

- [ ] **FE2: Demand Aggregation screen**
  - [ ] Upload panel: tab Total + tab Per-CN
  - [ ] Consistency check result table (CN vs Total variance %)
  - [ ] B2B pipeline kanban board (6 stages)
  - [ ] Weighted demand preview

### M12 · S&OP Consensus
**Owner:** BE3 · **FE:** FE2 · **DA:** DA2

- [ ] **DB:**
  - [ ] Table `saop_cycle` — id, period_month, status ENUM(OPEN/LOCKED), locked_at, locked_by
  - [ ] Table `saop_adjustment` — id, cycle_id, cn_id, sku_id, level ENUM(TOTAL/CN), original_qty, adjusted_qty, adjusted_by, adjusted_at
  - [ ] Table `fva_log` — cycle_id, cn_id, sku_id, fc_before, fc_after, actual (filled later), fva_pct
  - [ ] Table `saop_deadline` — cycle_id, milestone ENUM(DAY3/DAY5/DAY7/DAY10), due_date, completed_at
  - [ ] Migration V011

- [ ] **BE3: S&OP workflow**
  - [ ] POST `/saop/cycle/open` — SC Manager mở cycle tháng mới
  - [ ] PATCH `/saop/cycle/:id/adjust` — SC Manager điều chỉnh FC Tổng
  - [ ] PATCH `/saop/cn-adjust/:id` — CN Manager điều chỉnh FC CN của mình
  - [ ] POST `/saop/cycle/:id/lock` — lock cycle, không cho chỉnh nữa
  - [ ] Variance reconciliation: tự động compute khi SC Manager adjust

- [ ] **BE3: Deadlines**
  - [ ] Seed deadlines khi open cycle: Day 3/5/7/10 từ config M10
  - [ ] Cron: gửi reminder khi deadline đến

- [ ] **BE3: FVA tracking**
  - [ ] Sau khi actuals có (cuối tháng): `fva = (|fc_before - actual| - |fc_after - actual|) / actual`
  - [ ] Positive FVA → adjustment cải thiện accuracy

- [ ] **FE2: S&OP screen**
  - [ ] Timeline bar: Day 3→5→7→10 với status badge
  - [ ] FC table 12 tháng × CN với inline edit
  - [ ] Variance indicator (CN vs Total %)
  - [ ] Lock button + confirmation modal

### M13 · Production Lot Sizing & Hub Booking
**Owner:** BE3 · **DA:** DA1

- [ ] **DB:**
  - [ ] Table `hub_snapshot` — hub_id, sku_id, stock_qty, inbound_qty, snapshot_date
  - [ ] Table `ss_hub` — hub_id, sku_id, z_value, sigma_demand, lt_hub_days, ss_qty, calculated_at
  - [ ] Table `booking_plan` — id, nm_id, sku_id, month, requested_qty, moq, rounded_qty, status ENUM(DRAFT/CONFIRMED)
  - [ ] Migration V012

- [ ] **BE3: Hub netting**
  - [ ] `HubNettingService.calculate(sku_id, month)`:
    - `hub_available = Σ(stock_cn) + hub_inbound - Σ(ss_cn)`
    - `hub_net_req = monthly_fc - hub_available`

- [ ] **BE3: SS Hub formula**
  - [ ] `SsHubService.calculate(hub_id, sku_id)` → z × σ_demand × √LT_hub
  - [ ] σ_demand tính từ 12 tháng demand history

- [ ] **BE3: MOQ check + booking suggestion**
  - [ ] Lấy MOQ từ `sku_nm_mapping.moq`
  - [ ] Round up: `booking_qty = ceil(hub_net_req / moq) × moq`
  - [ ] Generate `booking_plan` per NM per SKU per month

- [ ] **FE2: Booking plan screen**
  - [ ] Table: NM × SKU × month với suggested qty
  - [ ] MOQ indicator
  - [ ] SC Manager confirm booking plan

### M14 · FC Commitment Management
**Owner:** BE4 · **FE:** FE2 · **DA:** DA2

- [ ] **DB:**
  - [ ] Table `fc_commitment` — id, booking_plan_id, nm_id, sku_id, month, tier ENUM(HARD/FIRM/SOFT), committed_qty, tolerance_pct, status, version
  - [ ] Table `commitment_penalty` — id, commitment_id, violation_pct, penalty_amount, assessed_at
  - [ ] Migration V013

- [ ] **BE4: Commitment service**
  - [ ] POST `/commitment` — SC Manager tạo commitment từ booking plan
  - [ ] Tier tolerance từ M10 config (Hard ±5%, Firm ±15%, Soft ±30%)
  - [ ] Version history: mỗi update tạo version mới, không overwrite

- [ ] **BE4: Penalty tracking**
  - [ ] Khi NM deliver: compare actual vs committed
  - [ ] Nếu vượt tolerance → ghi `commitment_penalty`
  - [ ] DA2: penalty report per NM per quarter

- [ ] **FE2: Commitment screen**
  - [ ] Matrix: NM × SKU × tháng với tier dropdown
  - [ ] Version history panel
  - [ ] Penalty alert badge

### M15 · NM Response & Negotiation
**Owner:** BE4 · **FE:** FE2

- [ ] **DB:**
  - [ ] Table `nm_response` — id, commitment_id, nm_id, response ENUM(ACCEPT/PARTIAL/REJECT), confirmed_qty, notes, responded_at
  - [ ] Table `negotiation_round` — id, commitment_id, round_no, initiated_by, proposed_qty, counter_qty, status, created_at
  - [ ] Migration V014

- [ ] **BE4: Response workflow**
  - [ ] POST `/nm-response` — NM submit response (Phase 1: email/CSV upload; Phase 2: portal)
  - [ ] SLA cron: Day+3 reminder, Day+5 escalate alert
  - [ ] Nếu PARTIAL: auto-create negotiation_round

- [ ] **BE4: Negotiation**
  - [ ] POST `/negotiation/:id/counter` — SC Manager counter-propose
  - [ ] Max 3 rounds, sau đó escalate

- [ ] **FE2: NM Response screen**
  - [ ] List commitment + response status
  - [ ] SLA countdown badge
  - [ ] Negotiation thread view

### M16 · Hub ảo Virtual Inventory
**Owner:** BE4 · **DA:** DA1

- [ ] **DB:**
  - [ ] Table `hub_virtual` — hub_id, sku_id, nm_committed_qty, sigma_cn_ss, virtual_available_qty, calculated_at
  - [ ] Migration V015

- [ ] **BE4: Hub ảo calculation**
  - [ ] `HubVirtualService.calculate(sku_id)`:
    - `virtual_available = Σ(nm_committed) - Σ(ss_cn per CN)`
  - [ ] Recalculate khi: NM confirm thay đổi (M15) hoặc SS CN thay đổi (M28)
  - [ ] Expose: GET `/hub-virtual?sku_id=`

- [ ] **BE4: Wire vào Flow 2 nightly DRP**
  - [ ] M23 DRP netting đọc `hub_virtual.virtual_available_qty` thay vì hub_snapshot khi có

- [ ] **FE2: Hub ảo widget** trong S&OP dashboard

### M17 · Commitment Gap & Scenario Simulator
**Owner:** BE4 · **FE:** FE2 · **DA:** DA2

- [ ] **DB:**
  - [ ] Table `commitment_gap` — id, nm_id, sku_id, month, committed_qty, demand_qty, gap_qty, gap_pct, alert_level ENUM(OK/WARN/CRITICAL/AUTO), checked_at
  - [ ] Migration V016

- [ ] **BE4: Gap monitor**
  - [ ] Cron daily từ Day 15: check gap per SKU per NM
  - [ ] Day 20: alert nếu gap > 15%
  - [ ] Day 25: alert nếu gap > 10%
  - [ ] Day 28: auto-action flag (SC Manager must act)

- [ ] **BE4: 4-scenario simulator** *(Phase 2 baseline, AI Phase 3)*
  - [ ] Scenario A: Giữ nguyên → project stock-out risk
  - [ ] Scenario B: Increase PO từ NM khác
  - [ ] Scenario C: Giảm allocation cho CN thấp priority
  - [ ] Scenario D: Emergency spot buy
  - [ ] Mỗi scenario output: cost_impact, stockout_risk_pct, lead_time_days

- [ ] **FE2: Gap dashboard**
  - [ ] Heatmap: NM × SKU × tháng với gap %
  - [ ] Alert timeline Day 20/25/28
  - [ ] Scenario comparison table (4 columns)

**Phase 2 DoD (Flow 1 complete):**
- [ ] M11-M17 deployed staging
- [ ] Full S&OP cycle test: upload FC → S&OP review → lock → booking plan → commitment → NM response
- [ ] DA2 verify FVA calculation
- [ ] FE2 end-to-end test với SC Manager + CN Manager roles
- [ ] DevOps1: cron scheduler Day 20/25/28 gap alerts

---

## PHASE 3 — Intelligence & Automation (Sprint 10+)

> Sau khi Flow 1 + Flow 2 stable.

- [ ] **FC MAPE trong M09** — unblock khi actual_sales từ ERP có
- [ ] **AI scenario recommendation (M17)** — LLM suggest best action per scenario
- [ ] **Collaborative real-time editing (M12)** — WebSocket S&OP consensus
- [ ] **NM Portal Phase 2 (M15)** — NM app / API trực tiếp
- [ ] **POD Proof of Delivery (M27)** — photo upload, driver app
- [ ] **Merge M8 + M28** — unified Monitor & Feedback module — **chỉ merge sau khi cả 2 stable ≥ 1 tháng production, no critical incidents**

---

## DevOps Checklist (chạy song song mọi phase)

### DevOps1 — CI/CD & Migrations
- [ ] Setup migration workflow: TypeORM migrations auto-run on deploy
- [ ] Staging environment mirror production DB (anonymized)
- [ ] PR gate: migration file required nếu có schema change
- [ ] Rollback playbook: mỗi migration có `down()` method tested
- [ ] API versioning: `/v1/` giữ nguyên, `/v2/` cho endpoints mới
- [ ] **Feature Flag infrastructure (Sprint 0-1 — CRITICAL)**
  - [ ] Chọn lib: Unleash / LaunchDarkly OSS / hoặc custom config table `feature_flag`
  - [ ] Service `FeatureFlagService.isEnabled(key, context)` — context có user, tenant, env
  - [ ] Admin UI bật/tắt flag realtime (không cần redeploy)
  - [ ] Seed flags tối thiểu: `lcnb_enabled`, `m27_po_rebuild_enabled`, `m22_auto_approve_enabled`, `m16_hub_virtual_feeds_drp`
  - [ ] Mọi module mới MUST bọc trong flag check → rollback ngay nếu incident

### DevOps2 — Infra & Scheduling
- [ ] Cron scheduler setup (BullMQ / pg_cron):
  - [ ] DRP nightly: 23:00 hàng ngày
  - [ ] NM sync: 06:00 + 14:00 hàng ngày
  - [ ] Trust score: Thứ 2 00:00 weekly
  - [ ] SS recalculate: Thứ 2 01:00 weekly
  - [ ] Gap monitor: daily từ ngày 15 hàng tháng
  - [ ] SLA reminder: daily check
- [ ] Alert infra: webhook → Slack/email cho CRITICAL alerts
- [ ] DB performance: index audit sau mỗi migration
- [ ] Load test baseline: DRP run < 30s cho 50 SKU × 20 CN × 5 NM

---

## DA Checklist (xuyên suốt các phase)

### DA1 — Schema & Data Integrity
- [ ] Tất cả FK có ON DELETE strategy rõ ràng (RESTRICT / SET NULL / CASCADE)
- [ ] Tất cả decimal fields có precision phù hợp (qty: DECIMAL(12,3), price: DECIMAL(15,2))
- [ ] Audit log convention: mọi critical table có `created_at`, `updated_at`, `created_by`
- [ ] Seed data cho staging: 50 SKU, 20 CN, 5 NM, 6 tháng history
- [ ] Seed `rtm_rule` (M24 LCNB dependency) — rule priority per region/SKU category
- [ ] Seed `transport_lane` với `transit_lt_days` cho tất cả NM×CN + CN×CN trong 500km radius

### DA2 — Analytics & Reporting
- [ ] Weekly KPI report template (FC MAPE, trust score, honoring rate, SS accuracy)
- [ ] Monthly S&OP report (FVA, commitment compliance, booking vs actual)
- [ ] Data dictionary: mọi table/column có description

---

## Sprint Plan tổng quan

| Sprint | Flow 2 (BE1+BE2+FE1) | Flow 1 (BE3+BE4+FE2) | DA | DevOps |
|--------|----------------------|----------------------|----|--------|
| **Sprint 0** | BUG-01, BUG-02, BUG-03 | BUG-03 | Schema audit | Staging env |
| **Sprint 1** | — | M00 schema + CRUD | M00 schema | Migration workflow |
| **Sprint 2** | M21 Data Sync | M00 import + FE + M10 extend | Seed data | Cron infra |
| **Sprint 3** | M22 CN Adjustment | M11 Demand Aggregation v2 | Trust score query | API versioning |
| **Sprint 4** | M23 DRP Netting v2 | M12 S&OP Consensus | FVA query | Load test baseline |
| **Sprint 5** | M24 Allocation LCNB | M13 Lot Sizing | Hub netting query | Gap alert cron |
| **Sprint 6** | M25 Transport v2 + M26 ATP | M14 Commitment | Penalty query | SLA cron |
| **Sprint 7** | **M27 PO REBUILD (part 1: domain model + PO workflow)** | M15 NM Response | Override analysis query | Rollback playbook |
| **Sprint 8** | **M27 PO REBUILD (part 2: TO workflow + tracking + deprecate M7)** | M16 Hub ảo | Schema review M27 | — |
| **Sprint 9** | M28 Feedback & Closed Loop | M17 Gap & Scenario | KPI weekly report | Prod deploy Flow 2 |
| **Sprint 10** | Flow 2 QA + hotfix | Flow 1 QA + staging | S&OP report | Prod deploy Flow 1 |

> **Lưu ý Sprint 7-8:** M27 là REBUILD — 6 bảng mới + PO/TO workflow + edit log + tracking. Tách 2 sprint để BE4 tập trung, không over-allocate sang M15.

---

*IMPLEMENT-CHECKLIST.md — UNIS SCP v2.0 — 2026-04-15*
