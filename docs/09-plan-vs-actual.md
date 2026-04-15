# Module 9 — Plan vs Actual: BA Spec

> **Ngày tạo spec:** 2026-04-15
> **Trạng thái:** SPEC — chờ dev implement
> **Phụ thuộc:** Module 1 (demand_snapshot), Module 4 (plan_run / planned_order_release), Module 7 (order_batch/order_line)
> **FR gốc:** FR-v3.2-005 — Forecast Version Compare + Forecast vs Actual (SCP Master v3.6)

---

## 1. Mục tiêu module

Module 9 so sánh **kế hoạch (plan)** với **thực tế (actual)** theo từng chu kỳ DRP run, giúp Planner và SC Manager đánh giá chất lượng dự báo và hiệu quả thực thi.

**3 khả năng cốt lõi:**

| Khả năng | Mô tả |
|----------|-------|
| **Forecast Version Compare** | So sánh 2 demand_snapshot FROZEN do user chọn: variance, bias per item × location × period |
| **Forecast vs Actual (Proxy)** | So sánh forecast (demand_snapshot) vs EXPORTED orders (proxy actual): fill_rate_proxy, variance |
| **Rolling 4-week Comparison** | Trailing window 4 tuần: plan qty vs actual proxy qty, trend theo tuần |

> **Phase 1 constraint:** `actual_sales` / `actual_shipment` table chưa tồn tại. Phase 1 implement:
> - ✅ Forecast Version Compare (user chọn 2 snapshot)
> - ✅ Forecast vs Actual **proxy** dùng EXPORTED `order_line` làm actual
> - ⬜ True MAPE / Fill Rate / OTIF → BLOCKED Phase 2

---

## 2. Phạm vi Phase 1 vs Phase 2

| Feature | Phase 1 | Phase 2 |
|---------|---------|---------|
| Forecast Version Compare (user chọn snapshot A vs B) | ✅ | ✅ |
| Forecast vs Actual proxy (EXPORTED orders) | ✅ | ✅ (cải thiện) |
| Rolling 4-week comparison | ✅ | ✅ |
| Variance / bias per item × location | ✅ | ✅ |
| Export comparison report CSV | ✅ | ✅ |
| True MAPE per item | ⬜ BLOCKED | ✅ |
| True Fill Rate (actual shipment / demand) | ⬜ BLOCKED | ✅ |
| OTIF tracking | ⬜ BLOCKED | ✅ |
| actual_sales / actual_shipment table | ⬜ DA must create | ✅ |

---

## 3. Định nghĩa nghiệp vụ

### 3.1 Hai loại so sánh — tách rõ

Module 9 có **2 comparison_type khác nhau, dùng 2 nguồn data khác nhau:**

| comparison_type | plan_qty source | actual_qty source | Mục đích |
|-----------------|----------------|-------------------|----------|
| `FORECAST_VERSION` | `demand_snapshot_line` (snapshot A) | `demand_snapshot_line` (snapshot B) | So sánh 2 phiên bản dự báo |
| `FORECAST_VS_ACTUAL` | `demand_snapshot_line` (FROZEN, monthly) | `order_line` EXPORTED (proxy) | Xem plan có được thực thi không |

> ⚠️ **Không trộn 2 loại này.** Mỗi compute request chỉ làm 1 loại. Service phải switch logic theo `comparison_type`.

---

### 3.2 FORECAST_VERSION — So sánh 2 forecast version

**User flow:** Planner vào UI → chọn snapshot A từ dropdown → chọn snapshot B → click Compute.

**Input:** `snapshotIdBase` và `snapshotIdCompare` do user truyền vào request — **không auto-pick bằng OFFSET**.

```sql
-- Base version (A): demand_snapshot_line WHERE snapshot_id = :snapshotIdBase
-- Compare version (B): demand_snapshot_line WHERE snapshot_id = :snapshotIdCompare

Per item_code × location_code × period_start:

  plan_qty   = dsl_base.COALESCE(reconciled_qty, qty)        -- snapshot A
  actual_qty = dsl_compare.COALESCE(reconciled_qty, qty)     -- snapshot B

  variance_qty = actual_qty - plan_qty
  variance_pct = variance_qty / NULLIF(plan_qty, 0) × 100
  bias         = variance_qty  (positive = B > A = upward revision)

Classification:
  |variance_pct| > 40%  → CRITICAL
  |variance_pct| > 20%  → WARNING
  else                  → ON_TARGET
```

**Bias aggregate (summary level):**
```
avg_bias_pct = AVG(variance_pct) across all rows
  positive avg_bias → B systematically forecasts higher than A
  negative avg_bias → B systematically forecasts lower than A
```

---

### 3.3 FORECAST_VS_ACTUAL (Phase 1 Proxy)

**Nguồn plan:** `demand_snapshot_line` FROZEN (monthly grain, unit = M2)
**Nguồn actual proxy:** `order_line` EXPORTED trong cùng period (unit = M2)

```
plan_qty (monthly) = demand_snapshot_line.COALESCE(reconciled_qty, qty)
                     WHERE snapshot_id = :snapshotIdBase (FROZEN)
                       AND period_start = first day of target month

actual_qty (monthly proxy) =
  SUM(order_line.qty)
  WHERE order_line.item_code = item_code
    AND order_line.status = 'ACTIVE'
    AND order_batch.status = 'EXPORTED'
    AND order_batch.exported_at >= period_start
    AND order_batch.exported_at <  period_start + 1 month

variance_qty    = actual_qty - plan_qty
variance_pct    = variance_qty / NULLIF(plan_qty, 0) × 100
fill_rate_proxy = COALESCE(actual_qty, 0) / NULLIF(plan_qty, 0)
```

**Rolling 4-week (weekly grain):**

demand_snapshot_line là MONTHLY — cần convert để join với weekly window:

```
weekly_plan_qty = plan_qty (monthly) / 4.33
                  ← 4.33 = 52/12, same divisor as HSTK in M8

Per week_start (Monday):
  weekly_actual_qty = SUM(order_line.qty)
    WHERE exported_at >= week_start
      AND exported_at <  week_start + 7 days
```

> **Ghi chú:** `fill_rate_proxy` là EXPORTED qty / forecast qty. Đây **không phải** true fill rate (cần actual delivery confirmation từ ERP). Phase 2 sẽ dùng `actual_shipment` table.

---

### 3.4 MAPE (Phase 2 — BLOCKED Phase 1)

```
MAPE = (1/n) × Σ |actual_qty - plan_qty| / NULLIF(actual_qty, 0) × 100

Phase 1: status = N_A
         note = "BLOCKED: actual_sales table chưa tồn tại. Implement Phase 2."
```

---

## 4. DB Schema — 1 bảng mới

### `plan_actual_comparison`

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| computed_at | TIMESTAMP DEFAULT NOW() | |
| comparison_type | VARCHAR(30) | `FORECAST_VERSION` / `FORECAST_VS_ACTUAL` |
| period_start | DATE | Ngày đầu period |
| period_end | DATE | Ngày cuối period |
| period_type | VARCHAR(10) | `WEEKLY` / `MONTHLY` |
| item_code | VARCHAR(50) NOT NULL | |
| location_code | VARCHAR(20) NOT NULL | |
| snapshot_id_base | VARCHAR(36) NOT NULL | UUID — demand_snapshot.snapshot_id (version A hoặc plan) |
| snapshot_id_compare | VARCHAR(36) NULL | UUID — demand_snapshot.snapshot_id (version B) — NULL cho FORECAST_VS_ACTUAL |
| plan_qty | DECIMAL(15,2) NOT NULL | |
| actual_qty | DECIMAL(15,2) NULL | NULL nếu không có proxy data trong period |
| variance_qty | DECIMAL(15,2) NULL | actual_qty - plan_qty |
| variance_pct | DECIMAL(10,4) NULL | % |
| fill_rate_proxy | DECIMAL(10,4) NULL | actual/plan — chỉ có ở FORECAST_VS_ACTUAL |
| status | VARCHAR(20) NOT NULL | `ON_TARGET` / `WARNING` / `CRITICAL` / `N_A` |
| computed_by | VARCHAR(100) NULL | |

**Indexes:** `item_code`, `location_code`, `period_start`, `comparison_type`, `computed_at DESC`.

---

## 5. API Endpoints (5 endpoints)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/plan-actual/versions` | List FROZEN demand_snapshot versions (cho dropdown UI) |
| POST | `/api/v1/plan-actual/compute` | Trigger compute, lưu vào `plan_actual_comparison` |
| GET | `/api/v1/plan-actual/summary` | Summary: avg variance, bias, fill rate proxy, MAPE status |
| GET | `/api/v1/plan-actual/comparison` | List rows (filter type/item/location/period/status, paginated) |
| GET | `/api/v1/plan-actual/export` | Download CSV report (UTF-8 BOM) |

### 5.1 GET `/plan-actual/versions`

Trả về danh sách FROZEN snapshots để user chọn trong dropdown.

**Response:**
```json
{
  "data": [
    { "snapshotId": "uuid-snap-002", "createdAt": "2026-04-15T08:00:00", "label": "Forecast Apr-2026 v2" },
    { "snapshotId": "uuid-snap-001", "createdAt": "2026-04-08T08:00:00", "label": "Forecast Apr-2026 v1" }
  ]
}
```

### 5.2 POST `/plan-actual/compute`

**Request body:**
```json
{
  "comparisonType": "FORECAST_VERSION",
  "snapshotIdBase": "uuid-snap-001",
  "snapshotIdCompare": "uuid-snap-002",
  "computedBy": "planner"
}
```

- `FORECAST_VERSION`: cả `snapshotIdBase` và `snapshotIdCompare` bắt buộc
- `FORECAST_VS_ACTUAL`: chỉ `snapshotIdBase` (FROZEN plan); `snapshotIdCompare` = null

**Response:**
```json
{
  "computed": 240,
  "warnings": 12,
  "criticals": 3,
  "comparison_type": "FORECAST_VERSION"
}
```

### 5.3 GET `/plan-actual/summary`

**Response:**
```json
{
  "forecast_version": {
    "avg_variance_pct": 8.5,
    "avg_bias_pct": -2.1,
    "warning_count": 12,
    "critical_count": 3,
    "last_computed_at": "2026-04-15T08:00:00"
  },
  "forecast_vs_actual": {
    "avg_fill_rate_proxy": 0.87,
    "avg_variance_pct": -13.2,
    "mape_status": "N_A",
    "mape_note": "BLOCKED: actual_sales table chưa tồn tại.",
    "last_computed_at": "2026-04-15T08:00:00"
  }
}
```

### 5.4 GET `/plan-actual/comparison`

**Query params:**
| Param | Type | |
|-------|------|-|
| comparisonType | `FORECAST_VERSION`\|`FORECAST_VS_ACTUAL`? | |
| itemCode | string? | partial match |
| locationCode | string? | exact |
| periodStart | date? | filter >= |
| status | `ON_TARGET`\|`WARNING`\|`CRITICAL`? | |
| page | int default 1 | |
| pageSize | int default 50 max 200 | |

---

## 6. Cấu trúc thư mục

```
backend/src/plan-actual/
├── plan-actual.module.ts
├── plan-actual.controller.ts
├── plan-actual.service.ts
├── dto/
│   └── index.ts
├── entities/
│   └── plan-actual-comparison.entity.ts
└── migrations/
    └── 001_create_plan_actual_tables.sql
```

---

## 7. Frontend — `app/plan-actual/page.tsx`

**4 thành phần:**

| Thành phần | Nội dung |
|------------|----------|
| **Summary Row** | 4 cards: Avg Variance %, Avg Bias %, Fill Rate Proxy, Critical Count |
| **Version Compare Panel** | Dropdown chọn snapshot A + snapshot B → Compute button → bảng item × location với variance badge. Chỉ khả dụng khi có ≥2 FROZEN snapshots |
| **Rolling 4-week Chart** | Line chart: weekly_plan_qty vs weekly_actual_proxy theo tuần. Chú thích rõ "Actual = EXPORTED orders (proxy)" |
| **Comparison Table** | Paginated, filter by type/status/item/location, badge ON_TARGET(xanh)/WARNING(vàng)/CRITICAL(đỏ), Export CSV button |

**UX notes:**
- Nếu chưa có data: hiển thị empty state + nút "Run First Comparison"
- MAPE card: hiển thị "N/A — Blocked Phase 2" với badge xám
- Fill rate proxy: hiển thị % với tooltip "Based on EXPORTED orders, not actual delivery"

**FE API file:** `lib/api/plan-actual.ts`

---

## 8. Task Checklist

### DA Prerequisites
```
P1  Verify demand_snapshot có ≥2 FROZEN rows (cần để compare versions)
    SELECT snapshot_id, created_at, status FROM demand_snapshot
    WHERE status='FROZEN' ORDER BY created_at DESC LIMIT 5;
    → Kỳ vọng: ≥2 rows

P2  Verify demand_snapshot_line có period_start = tháng hiện tại
    SELECT COUNT(*), MIN(qty), MAX(qty)
    FROM demand_snapshot_line dsl
    JOIN demand_snapshot ds ON ds.snapshot_id = dsl.snapshot_id
    WHERE ds.status = 'FROZEN'
      AND dsl.period_start = date_trunc('month', CURRENT_DATE)::date;
    → Kỳ vọng: > 0 rows

P3  Verify order_line có EXPORTED orders trong 4 tuần qua (cho proxy actual)
    SELECT COUNT(*) FROM order_line ol
    JOIN order_batch ob ON ob.id = ol.order_batch_id
    WHERE ob.status = 'EXPORTED'
      AND ob.exported_at >= NOW() - INTERVAL '28 days';
    → Kỳ vọng: > 0 rows
```

### Backend
```
BE-1  Tạo src/plan-actual/ với cấu trúc đầy đủ
BE-2  Chạy migration 001_create_plan_actual_tables.sql
BE-3  Tạo entity plan-actual-comparison.entity.ts
BE-4  Tạo dto/index.ts:
        ComputeDto    { comparisonType, snapshotIdBase, snapshotIdCompare?, computedBy? }
        ListQueryDto  { comparisonType?, itemCode?, locationCode?, periodStart?, status?, page?, pageSize? }
BE-5  Tạo plan-actual.service.ts:
        listVersions()        — SELECT FROZEN snapshots DESC
        computeComparison()   — switch(type) { FORECAST_VERSION | FORECAST_VS_ACTUAL }
        _computeForecastVersion()   — join 2 snapshot_line, calc variance
        _computeForecastVsActual()  — join snapshot_line + order_line EXPORTED
                                      convert monthly→weekly (÷4.33) cho rolling window
        getSummary()          — aggregate from latest compute per type
        listComparisons()     — paginated + filter
        exportCsv()           — UTF-8 BOM, 10 cột
BE-6  Tạo plan-actual.controller.ts (5 endpoints)
BE-7  Tạo plan-actual.module.ts
BE-8  Register PlanActualModule trong app.module.ts
```

### Frontend
```
FE-1  lib/api/plan-actual.ts (types + 5 API functions)
FE-2  app/plan-actual/page.tsx
FE-3  Summary Row (4 cards)
FE-4  Version Compare Panel (dropdown A + B + Compute)
FE-5  Rolling 4-week chart với chú thích proxy
FE-6  Comparison table với filter + badge + Export CSV
FE-7  Nav link /plan-actual trong sidebar (step 09)
```

### QA
```
QA-1  POST compute FORECAST_VERSION (snapshotIdBase=A, snapshotIdCompare=B) → rows saved
QA-2  GET comparison?status=CRITICAL → chỉ items |variance_pct| > 40%
QA-3  POST compute FORECAST_VERSION với snapshotIdCompare = null → 400 error
QA-4  avg_bias_pct < 0 → B forecasts lower than A (under-revision)
QA-5  POST compute FORECAST_VS_ACTUAL → fill_rate_proxy = actual_qty / plan_qty
QA-6  Rolling 4-week: weekly_plan_qty = monthly / 4.33 (verify tính toán)
QA-7  GET summary → mape_status = N_A, note chứa "BLOCKED"
QA-8  Export CSV → UTF-8 BOM, đủ cột item/location/type/plan/actual/variance/fill_rate
```

---

## 9. Phase 2 Roadmap

| Feature | Dependency |
|---------|------------|
| True MAPE / WMAPE | `actual_sales` table (DA + ERP import pipeline) |
| True Fill Rate | `actual_shipment` data từ ERP |
| OTIF tracking | Actual delivery timestamp |
| Forecast Bias trend (8-week rolling) | `actual_sales` ≥ 8 tuần |
| FC→SS feedback trigger (M8 closed-loop) | MAPE history + Policy Engine |

---

*Module 9 spec v2 — 2026-04-15*