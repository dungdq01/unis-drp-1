# Module 8 — Monitor & Learn: BA Report

> **Ngày hoàn thành spec:** 2026-04-15
> **Trạng thái:** SPEC READY — chờ dev implement
> **Phụ thuộc:** Module 6 (supply_snapshot), Module 4 (demand_snapshot), Module 7 (order_batch / order_line)

---

## 1. Mục tiêu module

Module 8 là tầng quan sát cuối cùng của chuỗi Supply Chain Planning. Nó đọc kết quả từ tất cả các module trước và tổng hợp thành KPI dashboard + alert center để Planner và SC Manager ra quyết định kịp thời.

**Luồng chính:**
```
supply_snapshot (M6) ──┐
demand_snapshot (M4) ──┤──► POST /monitor/kpi/compute
order_batch     (M7) ──┤         │
plan_run        (M5) ──┘    kpi_snapshot[]  +  alert[]
                                  │
                              GET /monitor/hstk
                              GET /monitor/execution
                              GET /monitor/alerts
                              GET /monitor/stats
                                  │
                             Frontend /monitoring
```

---

## 2. Phạm vi Phase 1

| Trong scope (Phase 1) | Ngoài scope |
|----------------------|-------------|
| KPI on-demand compute (POST trigger) | Scheduled compute (pg_cron/Celery) → Phase 2 |
| HSTK, PO Overdue, Approval SLA, Cancel Rate, DRP Cycle Time, Data Completeness | MAPE, Fill Rate, OTIF, True Override Rate → BLOCKED Phase 2 (cần `actual_sales`) |
| Alert: STOCKOUT_RISK, OVERSTOCK, PO_OVERDUE | DEMAND_DRIFT, PSI, DISTRIBUTION_SHIFT → Phase 2 |
| Alert channel: SYSTEM only | EMAIL, ZALO → Phase 2 |
| Sustainability CO2 = DISABLED | CO2 tracking → Phase 3 |
| Acknowledge alert (manual) | SSE real-time push → Phase 3 |
| 2 tables: kpi_snapshot + alert | drift_detection_log, feedback_recommendation → Phase 2 |
| No auth (actor = free-text VARCHAR) | JWT guard → Phase 2 |

---

## 3. Business Rules (UNIS-specific)

### 3.1 HSTK (Hệ số tồn kho)

```
on_hand        = supply_snapshot_line.allocatable_qty
                 (latest supply_snapshot WHERE freshness = 'PASS')

monthly_demand = demand_snapshot_line.COALESCE(reconciled_qty, qty)
                 (latest demand_snapshot WHERE status = 'FROZEN',
                  period_start = first day of current month)

weekly_demand  = monthly_demand / 4.33   ← 4.33 = 52 tuần / 12 tháng

HSTK (weeks)   = on_hand / NULLIF(weekly_demand, 0)

Classification:
  HSTK < 1.5          → STOCKOUT   → alert CRITICAL
  1.5 ≤ HSTK ≤ 3.0   → OK         → no alert
  HSTK > 3.0          → OVERSTOCK  → alert WARNING

Edge cases:
  weekly_demand = 0   → HSTK = 999.0  (classified OVERSTOCK, alert WARNING)
  allocatable_qty = 0 → HSTK = 0.0   (classified STOCKOUT, alert CRITICAL)
```

> ⚠️ **Quan trọng:** Items với `allocatable_qty = 0` PHẢI được tính (không bị lọc ra). Đây là STOCKOUT nghiêm trọng nhất.

### 3.2 PO Overdue

```
Điều kiện: order_batch.status = 'SUBMITTED'
           AND submitted_at < NOW() - INTERVAL '10 days'

UNIS threshold = 10 ngày (không phải 7 ngày)
Alert severity = WARNING
```

### 3.3 Approval SLA

```
avg_hours = AVG(EXTRACT(EPOCH FROM (approved_at - submitted_at)) / 3600)
            WHERE approved_at IS NOT NULL
              AND submitted_at >= NOW() - INTERVAL '30 days'

Target = 48 hours
Status = WARNING nếu avg_hours > 48
```

### 3.4 Cancel Rate (proxy cho Override Rate Phase 1)

```
cancel_rate = COUNT(order_line WHERE status='CANCELLED') / COUNT(all order_line)

Target ≤ 0.25 (25%)
Status = WARNING nếu > 0.25

Lý do dùng proxy: order_line chưa có qty_original → không tính được
true override_rate = qty_adjusted / qty_original (Phase 2)
```

### 3.5 DRP Cycle Time

```
avg_hours = AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600)
            WHERE plan_run.status = 'COMPLETED'
              AND created_at >= NOW() - INTERVAL '30 days'

Chỉ informational, không có threshold Phase 1
```

### 3.6 Data Completeness (tổng hợp 3 nguồn)

```
completeness = item_ok/item_total × 0.4
             + location_ok/location_total × 0.4
             + branches_with_rtm/total_branches × 0.2

item_ok       = item có item_name NOT NULL AND base_uom NOT NULL
location_ok   = location có location_name NOT NULL AND location_type NOT NULL
branches_with_rtm = COUNT(DISTINCT branch_code) FROM rtm_rule
total_branches = COUNT(*) FROM location WHERE location_type = 'BRANCH'

Target = 0.9 (90%)
Status = WARNING nếu < 0.9
```

### 3.7 Alert Upsert (chống duplicate)

```
Khi generate alert:
  → Tìm existing alert cùng alert_type + item_code + location_code
    WHERE is_acknowledged = FALSE
  → Nếu đã có: UPDATE title/body, KHÔNG tạo mới (return 0)
  → Nếu chưa có: INSERT mới (return 1)

alerts_generated = số alert INSERT mới (không tính UPDATE)
```

---

## 4. DB Schema

### 4.1 Bảng `kpi_snapshot`

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| computed_at | TIMESTAMP DEFAULT NOW() | Thời điểm compute |
| period_type | VARCHAR(10) | DAILY / WEEKLY / MONTHLY |
| period_start | DATE | Ngày đầu period (Monday nếu WEEKLY) |
| period_end | DATE | Ngày cuối period (Sunday) |
| kpi_group | VARCHAR(30) | SERVICE / WORKING_CAPITAL / TRUST / DECISION_SPEED / AI_VALUE / SUSTAINABILITY / DATA_QUALITY |
| kpi_code | VARCHAR(50) | HSTK_AVG / HSTK / PO_OVERDUE_COUNT / APPROVAL_SLA_HOURS / CANCEL_RATE / DRP_CYCLE_TIME_HOURS / DATA_COMPLETENESS / CO2_TOTAL_KG / MAPE |
| value | DECIMAL(18,4) | Giá trị KPI |
| target | DECIMAL(18,4) NULL | Ngưỡng mục tiêu |
| status | VARCHAR(20) | ON_TARGET / WARNING / CRITICAL / DISABLED / N_A |
| item_code | VARCHAR(50) NULL | NULL = aggregate; non-null = per-SKU |
| location_code | VARCHAR(20) NULL | NULL = aggregate; non-null = per-CN |
| note | TEXT NULL | Ghi chú thêm (ví dụ: BLOCKED reason) |
| computed_by | VARCHAR(100) NULL | 'system' hoặc username |

**Indexes:** idx trên kpi_code, period_start+period_type, location_code, item_code, kpi_group.

### 4.2 Bảng `alert`

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| alert_type | VARCHAR(50) | STOCKOUT_RISK / OVERSTOCK / PO_OVERDUE / FILL_RATE_LOW / OVERRIDE_HIGH / MAPE_DEGRADED / SS_BREACH / DEMAND_DRIFT / DISTRIBUTION_SHIFT / ERP_SFTP_FAILED |
| severity | VARCHAR(10) | INFO / WARNING / CRITICAL |
| title | VARCHAR(255) | Tiêu đề ngắn |
| body | TEXT NULL | Nội dung chi tiết |
| item_code | VARCHAR(50) NULL | |
| location_code | VARCHAR(20) NULL | |
| ref_id | VARCHAR(100) NULL | order_batch.id, plan_run.id, ... |
| ref_type | VARCHAR(50) NULL | 'order_batch' / 'plan_run' / 'supply_snapshot' |
| channels_sent | VARCHAR(100) DEFAULT 'SYSTEM' | Phase 1: SYSTEM only |
| is_acknowledged | BOOLEAN DEFAULT FALSE | |
| acknowledged_by | VARCHAR(100) NULL | |
| acknowledged_at | TIMESTAMP NULL | |
| created_at | TIMESTAMP DEFAULT NOW() | |

**Indexes:** idx trên alert_type, severity, is_acknowledged, location_code, item_code, created_at DESC.

> **Phase 2 tables (chưa tạo):**
> - `drift_detection_log` — demand drift > 20%, PSI > 0.30 (cần `actual_sales`)
> - `feedback_recommendation` — 4 closed-loop feedback outputs

---

## 5. API Endpoints (7 endpoints)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/monitor/stats` | Dashboard summary: alert counts, HSTK overview, overdue batches |
| POST | `/api/v1/monitor/kpi/compute` | Trigger KPI compute on-demand → saves kpi_snapshot + generates alerts |
| GET | `/api/v1/monitor/kpi` | List kpi_snapshot history (filter group/code/location/item, paginated) |
| GET | `/api/v1/monitor/hstk` | HSTK per item × location (filter location/item/classification, paginated) |
| GET | `/api/v1/monitor/execution` | Execution metrics từ M7: overdue, SLA, cancel rate |
| GET | `/api/v1/monitor/alerts` | List alerts (filter severity/type/acknowledged/location, paginated) |
| PATCH | `/api/v1/monitor/alerts/:id/acknowledge` | Acknowledge 1 alert (set is_acknowledged=true) |

### 5.1 POST `/monitor/kpi/compute`

**Request body:**
```json
{ "computedBy": "planner" }
```

**Response:**
```json
{ "computed": 12, "alerts_generated": 3 }
```

**Logic:** Tính 8 KPI snapshots (HSTK_AVG + N per-row HSTK + PO_OVERDUE_COUNT + APPROVAL_SLA_HOURS + CANCEL_RATE + DRP_CYCLE_TIME_HOURS + DATA_COMPLETENESS + CO2_TOTAL_KG (DISABLED) + MAPE (N_A)) → bulk save → return count.

`computed` = số row kpi_snapshot tạo ra; `alerts_generated` = số alert INSERT mới (không tính upsert update).

### 5.2 GET `/monitor/hstk`

**Query params:**
| Param | Type | Mô tả |
|-------|------|-------|
| locationCode | string? | Filter exact location |
| itemCode | string? | Filter contains (partial match) |
| classification | STOCKOUT\|OK\|OVERSTOCK? | Filter by class |
| page | int default 1 | |
| pageSize | int default 50 max 200 | |

**Response:**
```json
{
  "summary": { "stockout": 3, "ok": 45, "overstock": 8, "avg_hstk": 2.41 },
  "data": [
    {
      "itemCode": "40.L1.3060.UGC3600",
      "itemName": "Gạch 30x60 UGC3600 L1",
      "locationCode": "014",
      "locationName": "Chi nhánh HCM",
      "onHand": 500,
      "weeklyDemand": 420.3,
      "hstkWeeks": 1.19,
      "classification": "STOCKOUT"
    }
  ],
  "meta": { "page": 1, "pageSize": 50, "total": 56, "totalPages": 2 }
}
```

> **Note:** `summary` luôn tính trên toàn bộ data (không bị filter), `data` là filtered + paginated.

### 5.3 GET `/monitor/execution`

**Response:**
```json
{
  "batch": {
    "overdue_count": 2,
    "draft_count": 5,
    "submitted_count": 3,
    "approved_count": 1,
    "exported_count": 12,
    "cancelled_count": 0,
    "avg_approval_sla_hours": 18.5,
    "avg_approval_sla_30d_hours": 16.2
  },
  "lines": {
    "total_lines": 450,
    "cancelled_lines": 12,
    "cancel_rate_pct": 2.67
  }
}
```

### 5.4 GET `/monitor/stats`

**Response:**
```json
{
  "alerts": {
    "critical_unacked": 2,
    "warning_unacked": 5,
    "total_unacked": 7,
    "last_7d_total": 15
  },
  "batches": {
    "overdue_batches": 1,
    "total_batches": 20,
    "avg_approval_sla_hours": 18.5
  },
  "hstk": {
    "hstk_stockout_count": 3,
    "hstk_overstock_count": 8,
    "hstk_avg": 2.41
  }
}
```

---

## 6. KPI Catalog (8 KPIs Phase 1)

| # | kpi_group | kpi_code | value ý nghĩa | target | status logic |
|---|-----------|----------|---------------|--------|--------------|
| 1 | WORKING_CAPITAL | HSTK_AVG | avg HSTK toàn kho (weeks) | — | CRITICAL nếu có ≥1 STOCKOUT row; WARNING nếu có ≥1 OVERSTOCK |
| 2 | WORKING_CAPITAL | HSTK | HSTK per item × location (weeks) | — | CRITICAL/<1.5; WARNING/>3.0; ON_TARGET |
| 3 | DECISION_SPEED | PO_OVERDUE_COUNT | số batch SUBMITTED > 10 ngày | 0 | WARNING nếu > 0 |
| 4 | DECISION_SPEED | APPROVAL_SLA_HOURS | avg giờ SUBMITTED→APPROVED (30d) | 48h | WARNING nếu > 48 |
| 5 | TRUST | CANCEL_RATE | tỷ lệ order_line bị cancel | 0.25 | WARNING nếu > 25% |
| 6 | DECISION_SPEED | DRP_CYCLE_TIME_HOURS | avg giờ 1 chu kỳ DRP (30d) | — | ON_TARGET (informational) |
| 7 | DATA_QUALITY | DATA_COMPLETENESS | score 0–1 (3 nguồn item/location/rtm) | 0.9 | WARNING nếu < 0.9 |
| 8 | SUSTAINABILITY | CO2_TOTAL_KG | 0 (disabled) | — | DISABLED |
| 9 | AI_VALUE | MAPE | 0 (blocked) | 25% | N_A |

---

## 7. Alert Catalog (Phase 1)

| alert_type | severity | Điều kiện trigger | item/location scope |
|------------|----------|-------------------|---------------------|
| STOCKOUT_RISK | CRITICAL | HSTK < 1.5 | per SKU × CN |
| OVERSTOCK | WARNING | HSTK > 3.0 | per SKU × CN |
| PO_OVERDUE | WARNING | batch SUBMITTED > 10 ngày | aggregate |

**Phase 2 alerts (chưa implement):**
FILL_RATE_LOW, OVERRIDE_HIGH, MAPE_DEGRADED, SS_BREACH, DEMAND_DRIFT, DISTRIBUTION_SHIFT, ERP_SFTP_FAILED

---

## 8. Error Codes

| Code | HTTP | Khi nào |
|------|------|---------|
| UNIS-ERR-025 | 404 | Alert not found (PATCH acknowledge) |
| UNIS-ERR-026 | 500 | KPI computation failed (unexpected error) |
| UNIS-ERR-027 | 422 | Không có supply_snapshot với freshness='PASS' |
| UNIS-ERR-028 | 422 | Không có demand_snapshot với status='FROZEN' |

---

## 9. Cấu trúc thư mục Backend

```
backend/src/monitor/
├── monitor.module.ts
├── monitor.controller.ts
├── monitor.service.ts
├── monitor.config.ts
├── dto/
│   └── index.ts
├── entities/
│   ├── kpi-snapshot.entity.ts
│   └── alert.entity.ts
└── migrations/
    └── 001_create_monitor_tables.sql
```

**Đăng ký module:** Thêm `MonitorModule` vào `imports[]` trong `app.module.ts`.

---

## 10. Frontend

### 10.1 API Client — `lib/api/monitor.ts`

**Types cần có:**
```
AlertSeverity    = 'INFO' | 'WARNING' | 'CRITICAL'
KpiStatus        = 'ON_TARGET' | 'WARNING' | 'CRITICAL' | 'DISABLED' | 'N_A'
HstkClass        = 'STOCKOUT' | 'OK' | 'OVERSTOCK'

KpiSnapshot      { id, computedAt, periodType, periodStart, periodEnd,
                   kpiGroup, kpiCode, value, target, status,
                   itemCode, locationCode, note }

MonitorAlert     { id, alertType, severity, title, body,
                   itemCode, locationCode, isAcknowledged,
                   acknowledgedBy, acknowledgedAt, createdAt }

HstkRow          { itemCode, itemName, locationCode, locationName,
                   onHand, weeklyDemand, hstkWeeks, classification }

HstkSummary      { stockout, ok, overstock, avg_hstk }
PageMeta         { page, pageSize, total, totalPages }
```

**7 API functions:**
```
fetchMonitorStats()                            → GET /monitor/stats
computeKpi(computedBy?)                        → POST /monitor/kpi/compute
fetchKpiSnapshots(params)                      → GET /monitor/kpi
fetchHstk(params)                              → GET /monitor/hstk
fetchExecutionMetrics()                        → GET /monitor/execution
fetchAlerts(params)                            → GET /monitor/alerts
acknowledgeAlert(id, acknowledgedBy?)          → PATCH /monitor/alerts/:id/acknowledge
```

### 10.2 Page — `app/monitoring/page.tsx`

**4 thành phần chính:**

| Thành phần | Nội dung |
|------------|----------|
| **KPI Summary Row** | 4 cards: Critical Alerts (đỏ), Warning Alerts (vàng), Avg HSTK (xanh/đỏ), Overdue Batches (cam) |
| **HSTK Table** | Summary pills (STOCKOUT/OK/OVERSTOCK count) + filter by classification + location + item; bảng có badge màu theo classification; sort mặc định hstkWeeks ASC |
| **Alert Center** | List alerts grouped by severity, unacked count badge; inline "Acknowledge" button; filter by severity / acknowledged |
| **Execution Panel** | Cards: Overdue count, Avg SLA hours, Cancel rate %; thêm "Compute KPI" button → toast hiển thị `computed: N, alerts_generated: M` |

**Nav:** Thêm link `/monitoring` vào sidebar với label "Monitor & Learn" (step 08).

**UX notes:**
- Sau khi click "Compute KPI" → refresh stats + alerts tự động
- Badge đỏ trên Alert Center nếu `total_unacked > 0`
- Classification badge: STOCKOUT = đỏ, OK = xanh, OVERSTOCK = vàng
- HSTK = 999.0 (zero demand) hiển thị "∞" hoặc "N/A" thay vì "999"

---

## 11. Task Checklist cho Dev

### Prerequisites (DA verify trước)

```
P1  Verify supply_snapshot có ≥1 row với freshness='PASS'
    SELECT id, freshness FROM supply_snapshot WHERE freshness='PASS' LIMIT 5;

P2  Verify demand_snapshot có ≥1 row với status='FROZEN'
    SELECT snapshot_id, status FROM demand_snapshot WHERE status='FROZEN' LIMIT 5;

P3  Verify demand_snapshot_line có rows với period_start = first day of current month
    SELECT COUNT(*) FROM demand_snapshot_line dsl
    JOIN demand_snapshot ds ON ds.snapshot_id = dsl.snapshot_id
    WHERE ds.status='FROZEN' AND dsl.period_start = date_trunc('month', CURRENT_DATE)::date;

P4  Verify supply_snapshot_line có allocatable_qty ≥ 0
    SELECT COUNT(*) FROM supply_snapshot_line ssl
    JOIN supply_snapshot ss ON ss.id = ssl.supply_snapshot_id
    WHERE ss.freshness='PASS';

P5  Verify plan_run table tồn tại (cho DRP_CYCLE_TIME)
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name='plan_run'
    );

P6  Verify rtm_rule table tồn tại (cho DATA_COMPLETENESS)
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name='rtm_rule'
    );
```

### Backend

```
BE-1   Tạo src/monitor/
BE-2   Tạo monitor.config.ts (threshold constants)
BE-3   Tạo entities/kpi-snapshot.entity.ts
BE-4   Tạo entities/alert.entity.ts
BE-5   Chạy migration 001_create_monitor_tables.sql
BE-6   Thêm UNIS-ERR-025..028 vào common/errors.ts
BE-7   Tạo dto/index.ts (5 DTOs)
BE-8   Tạo monitor.service.ts
BE-9   Tạo monitor.controller.ts
BE-10  Tạo monitor.module.ts
BE-11  Register MonitorModule trong app.module.ts
BE-12  npm run build — không có TS error
BE-13  Swagger: POST /monitor/kpi/compute → { computed: N, alerts_generated: M }
BE-14  Swagger: GET /monitor/hstk → summary + data rows
BE-15  Swagger: GET /monitor/execution → overdue_count, avg_approval_sla_hours
BE-16  Swagger: GET /monitor/alerts → list với severity filter
BE-17  Swagger: PATCH /monitor/alerts/:id/acknowledge → is_acknowledged = true
```

### Frontend

```
FE-1   Tạo lib/api/monitor.ts (types + 7 API functions)
FE-2   Tạo app/monitoring/page.tsx
FE-3   KPI Summary Row (4 cards)
FE-4   HSTK Table với classification badge + filter
FE-5   Alert Center với acknowledge inline
FE-6   Execution Panel (overdue, SLA, cancel rate)
FE-7   Compute KPI button → toast result
FE-8   Nav link /monitoring trong sidebar
```

### QA

```
QA-1  POST /monitor/kpi/compute → kpi_snapshot rows saved, STOCKOUT alerts generated
QA-2  GET /monitor/hstk → item với allocatable_qty=0 xuất hiện, classification=STOCKOUT
QA-3  GET /monitor/hstk → HSTK < 1.5 → STOCKOUT; HSTK > 3.0 → OVERSTOCK
QA-4  GET /monitor/hstk?classification=STOCKOUT → chỉ STOCKOUT rows
QA-5  Batch SUBMITTED > 10 ngày → PO_OVERDUE alert + overdue_count > 0
QA-6  PATCH acknowledge → is_acknowledged=true; re-compute không tạo duplicate alert
QA-7  kpi_snapshot có row MAPE với status=N_A, note chứa "BLOCKED"
QA-8  kpi_snapshot có row CO2_TOTAL_KG với status=DISABLED, value=0
QA-9  GET /monitor/stats → aggregated view đúng
QA-10 FE: Compute KPI button → toast "computed: N, alerts_generated: M"
QA-11 FE: Badge đỏ hiển thị nếu total_unacked > 0
QA-12 FE: HSTK = 999.0 hiển thị "∞" hoặc "N/A"
```

---

## 12. Giới hạn Phase 1 (Known Constraints)

| Giới hạn | Lý do | Phase 2 plan |
|----------|-------|-------------|
| MAPE = N_A | `actual_sales` chưa tồn tại | DA tạo bảng + ERP import pipeline |
| Fill Rate = N_A | Tương tự MAPE | Phase 2/3 |
| True Override Rate = N_A | M7 `order_line` thiếu `qty_original` | Phase 2: M7 schema change |
| Cancel Rate thay Override Rate | Proxy Phase 1 | Override rate sau khi có qty_original |
| CO2 = DISABLED | Chưa có data vehicle emissions | Phase 3 |
| Alert channel = SYSTEM only | Chưa có SMTP / Zalo OA | Phase 2: EMAIL + ZALO |
| No scheduled compute | Chưa có pg_cron/Celery | Phase 2: daily/weekly cron |
| HSTK = live query (không cache) | Phase 1 đơn giản | Phase 2: cache 5 phút Redis |
| No SSE real-time push | Phase 1 đơn giản | Phase 3: EventSource endpoint |
| Actor = free-text VARCHAR | Chưa có IAM | Phase 2: JWT guard |

---

## 13. Phase 2 / 3 Roadmap

| Feature | Dependency | Phase |
|---------|------------|-------|
| MAPE, WMAPE, Fill Rate | `actual_sales` table (DA + ERP) | 2 |
| True Override Rate | M7 `qty_original` field | 2 |
| Drift Detection (>20%) | `actual_sales` | 2 |
| PSI calculation | Distribution data nhiều kỳ | 2 |
| `drift_detection_log` table | Drift detection | 2 |
| `feedback_recommendation` table | 4 feedback loops | 2 |
| FC→SS feedback loop | MAPE ≥ 8 tuần + Celery | 2 |
| Override→RTM feedback loop | True override data | 2 |
| Supplier LT feedback loop | Actual delivery timestamp (M7) | 2 |
| EMAIL / ZALO integration | SMTP + Zalo OA API key | 2 |
| Scheduled KPI compute | pg_cron hoặc Celery worker | 2 |
| SSE real-time alert push | EventSource endpoint | 3 |
| Drift→Reforecast loop (auto) | CRITICAL drift threshold | 3 |
| SS auto-recalc | FC→SS loop AUTO_APPLY mode | 3 |
| HSTK trend chart | ≥ 4 tuần kpi_snapshot data | 3 |

---

*Module 8 spec hoàn thành. Tech Lead review: 2026-04-15.*