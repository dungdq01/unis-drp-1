# MODULE 1 — Demand Ingestion & Forecast Dashboard
## Business Analysis Report

**Project**: UNIS Supply Chain Planning System (SCP)  
**Module**: Module 1 — Demand Ingestion & Forecast Accuracy  
**Status**: ✅ DONE — Ready to hand off to Module 2  
**Last updated**: 2026-04-13  
**Audience**: Developer, BA, Product Manager, QA  

---

## 1. MỤC TIÊU MODULE

Module 1 giải quyết bài toán:

> **"Làm thế nào để Planner biết forecast đang tốt hay không, và branch nào/FSKU nào cần chú ý?"**

Cụ thể:
- **Ingestion**: Import file CSV forecast từ hệ thống DRP (hoặc manual upload) → lưu vào snapshot
- **Lifecycle**: Quản lý trạng thái snapshot (DRAFT → FROZEN → ARCHIVED) để lock dữ liệu cho planning
- **Accuracy Dashboard**: So sánh forecast vs actual T10→T3, chấm điểm model, phát hiện SKU yếu
- **Branch Forecast**: Breakdown demand theo chi nhánh, period, phân khúc A/B/C
- **Analyst View**: Phân tích sâu lỗi, bias, cohort, seasonality cho Data Analyst

---

## 2. KIẾN TRÚC TỔNG QUAN

```
┌────────────────────────────────────────────────────────────┐
│  Frontend — Next.js 14 App Router (/app/demand/page.tsx)   │
│                                                            │
│  Tab 1: Forecast Overview   Tab 2: Branch   Tab 3: Analyst │
└────────────────────┬───────────────────────────────────────┘
                     │ REST API (JSON)
┌────────────────────▼───────────────────────────────────────┐
│  Backend — NestJS                                          │
│  ├── DemandController       /demand/*                      │
│  ├── AccuracyController     /demand/accuracy/*             │
│  └── InsightsController     /demand/forecast/*             │
└────────────────────┬───────────────────────────────────────┘
                     │ TypeORM
┌────────────────────▼───────────────────────────────────────┐
│  PostgreSQL                                                │
│  ├── demand_snapshot          Snapshot header              │
│  ├── demand_snapshot_line     Forecast lines per FSKU      │
│  ├── demand_forecast_detail   Raw DRP export (22 cols)     │
│  ├── demand_accuracy          Backtest data T10→T3         │
│  └── demand_override_log      Audit trail for overrides    │
└────────────────────────────────────────────────────────────┘
```

**Data Isolation Rule (quan trọng)**:
- Tab 1 (Accuracy) CHỈ đọc từ `demand_accuracy` + `item` table
- Tab 2 (Branch) CHỈ đọc từ `demand_snapshot_line` + `demand_forecast_detail`
- Hai data source này KHÔNG cross query nhau → tránh confusion về số liệu

---

## 3. DATABASE SCHEMA

### 3.1 `demand_snapshot` — Snapshot Header

Mỗi lần upload CSV hoặc tạo thủ công tạo ra 1 snapshot. Snapshot là "phiên bản forecast" để planning.

| Column | Type | Mô tả |
|---|---|---|
| `snapshot_id` | UUID (PK) | ID chính |
| `run_id` | VARCHAR | Tham chiếu DRP run (optional) |
| `snapshot_name` | VARCHAR | Tên do user đặt |
| `source_type` | VARCHAR | `CSV_UPLOAD` / `MANUAL` / `DRP_EXPORT` |
| `forecast_file_name` | VARCHAR | Tên file gốc khi upload |
| `horizon_start` | DATE | Ngày bắt đầu horizon forecast |
| `horizon_end` | DATE | Ngày kết thúc horizon forecast |
| `status` | VARCHAR | `DRAFT` → `FROZEN` → `ARCHIVED` |
| `demand_basis` | VARCHAR | `MAX_FORECAST_PO` (default) |
| `total_lines` | INT | Số dòng trong snapshot |
| `total_items` | INT | Số FSKU phân biệt |
| `total_locations` | INT | Số chi nhánh phân biệt |
| `frozen_at` | TIMESTAMPTZ | Thời điểm freeze |
| `frozen_by` | VARCHAR | Ai freeze |
| `notes` | TEXT | Ghi chú thêm |
| `created_at` | TIMESTAMPTZ | Auto |
| `updated_at` | TIMESTAMPTZ | Auto |

**Business rule**: Chỉ DRAFT mới sửa được. FROZEN = đã khóa cho planning. ARCHIVED = lưu trữ, không dùng nữa.

---

### 3.2 `demand_snapshot_line` — Forecast Lines

Mỗi dòng = 1 FSKU × 1 chi nhánh × 1 period.

| Column | Type | Mô tả |
|---|---|---|
| `line_id` | UUID (PK) | ID dòng |
| `snapshot_id` | UUID (FK) | Thuộc snapshot nào |
| `item_code` | VARCHAR | Mã FSKU |
| `location_code` | VARCHAR | Mã chi nhánh |
| `period_start` | DATE | Đầu tháng forecast (YYYY-MM-01) |
| `qty` | DECIMAL(15,2) | Số lượng forecast |
| `reconciled_qty` | DECIMAL(15,2) | Số lượng sau reconcile (optional) |
| `segment` | CHAR(1) | `A` / `B` / `C` |
| `combo_class` | VARCHAR | Phân loại combo (vd: DORMANT_DISCONTINUED) |
| `branch_archetype` | VARCHAR | Loại chi nhánh |
| `tet_flag` | CHAR(1) | `Y` nếu là tháng Tết |
| `confidence_lower` | DECIMAL(15,2) | CI lower bound |
| `confidence_upper` | DECIMAL(15,2) | CI upper bound |
| `created_at` | TIMESTAMPTZ | Auto |

---

### 3.3 `demand_forecast_detail` — Raw DRP Export (22 cột)

Bảng này chứa dữ liệu thô từ hệ thống DRP (22 cột gốc), không qua xử lý nhiều. Dùng để:
- Hiển thị Branch Forecast pivot
- Tính insights (byPeriod, bySegment, TET impact)
- Tính quality metrics

| Column | Type | Mô tả |
|---|---|---|
| `detail_id` | UUID (PK) | ID |
| `snapshot_id` | UUID (FK) | Thuộc snapshot (optional) |
| `run_id` | VARCHAR | DRP run ID |
| `fsku_id` | VARCHAR | Full SKU ID |
| `item_code` | VARCHAR | Mã item |
| `location_code` | VARCHAR | Mã chi nhánh |
| `branch_name` | VARCHAR | Tên chi nhánh (có thể chứa Unicode escape, cần decode) |
| `region` | VARCHAR | Vùng |
| `segment` | CHAR(1) | A/B/C |
| `forecast_qty` | DECIMAL(15,2) | Số lượng forecast từ model |
| `reconciled_qty` | DECIMAL(15,2) | Sau reconcile |
| `tet_flag` | CHAR(1) | Tết flag |
| `combo_class` | VARCHAR | Combo classification |
| `branch_archetype` | VARCHAR | Loại chi nhánh |
| `confidence_lower` / `confidence_upper` | DECIMAL(15,2) | CI bounds |
| `qty_sold_12m_avg` | DECIMAL(15,2) | Trung bình 12 tháng |
| `qty_sold_3m_avg` | DECIMAL(15,2) | Trung bình 3 tháng |
| `panel_months` | INT | Số tháng dữ liệu (0-4) |
| `last_nonzero_month` | VARCHAR | Tháng có doanh số cuối cùng |
| `created_at` | TIMESTAMPTZ | Auto |

**Lưu ý F6**: `branch_name` đôi khi chứa `\uXXXX` Unicode escapes từ DRP — backend tự decode khi trả về.

---

### 3.4 `demand_accuracy` — Backtest Data

Bảng riêng biệt chứa kết quả backtest của mô hình. KHÔNG liên quan đến snapshot_line.

Horizon 6 tháng: T10, T11, T12 (backtest), T1 (LIVE), T2, T3 (forecast ahead).

| Column | Type | Mô tả |
|---|---|---|
| `id` | BIGINT (PK) | ID |
| `fsku` | VARCHAR(50) | Mã FSKU |
| `actual_t10` / `actual_t11` / `actual_t12` / `actual_t1` | DECIMAL | Actual demand từng tháng |
| `final_fc_t12` / `final_fc_t1` / `final_fc_t2` / `final_fc_t3` | DECIMAL | Forecast từ FINAL model |
| `ma3_fc_t12` / `ma3_fc_t1` | DECIMAL | Forecast từ MA3 (moving average 3 tháng) |
| `acc_final_t12` / `acc_final_t1` | DECIMAL(5,2) | Accuracy % của FINAL model |
| `acc_ma3_t12` / `acc_ma3_t1` | DECIMAL(5,2) | Accuracy % của MA3 |
| `wma_t10` / `wma_t11` | DECIMAL | WMA forecast (legacy, trước T12) |
| `acc_wma_t10` / `acc_wma_t11` | DECIMAL(5,2) | Accuracy % của WMA |
| `is_modified` | BOOLEAN | Planner đã override chưa |
| `created_at` | TIMESTAMPTZ | Auto |

**Quy ước tháng**:
- T10 = 2025-10, T11 = 2025-11, T12 = 2025-12
- T1 = 2026-01 (LIVE — tháng vừa đóng, có actual)
- T2 = 2026-02, T3 = 2026-03 (forecast-only, chưa có actual)

---

### 3.5 `demand_override_log` — Audit Trail

Mọi thay đổi thủ công của Planner đều được ghi lại.

| Column | Type | Mô tả |
|---|---|---|
| `override_id` | UUID (PK) | ID |
| `snapshot_id` | UUID | Snapshot bị sửa |
| `line_id` | UUID | Dòng bị sửa |
| `item_code` | VARCHAR | FSKU |
| `location_code` | VARCHAR | Chi nhánh |
| `period_start` | DATE | Period được sửa |
| `old_qty` | DECIMAL(15,2) | Số cũ |
| `new_qty` | DECIMAL(15,2) | Số mới |
| `reason` | TEXT | Lý do override |
| `overridden_by` | VARCHAR NOT NULL | Người sửa |
| `created_at` | TIMESTAMPTZ | Thời điểm |

---

## 4. API ENDPOINTS

### 4.1 DemandController — `/demand`

Quản lý snapshot lifecycle + upload + override.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/demand/snapshots` | Danh sách snapshots (paginated) |
| `POST` | `/demand/snapshots` | Tạo snapshot DRAFT rỗng |
| `GET` | `/demand/snapshots/:id` | Chi tiết snapshot + lines (paginated) |
| `POST` | `/demand/snapshots/:id/freeze` | Freeze: DRAFT → FROZEN |
| `DELETE` | `/demand/snapshots/:id` | Xóa DRAFT snapshot (cascade lines + logs) |
| `PUT` | `/demand/snapshots/:id/archive` | Archive: FROZEN → ARCHIVED |
| `POST` | `/demand/forecast/upload` | Upload file CSV forecast (multipart, max 50MB) |
| `GET` | `/demand/forecast/summary` | Tổng hợp demand theo groupBy (item, segment, location, period) |
| `GET` | `/demand/forecast/coverage` | Tỷ lệ % items có forecast theo segment |
| `GET` | `/demand/forecast/detail` | Branch-level detail (paginated) |
| `GET` | `/demand/forecast/pivot` | FSKU × Period pivot table (paginated) |
| `GET` | `/demand/forecast/export` | Export CSV (tải xuống) |
| `POST` | `/demand/forecast/override` | Override qty thủ công (chỉ DRAFT) |
| `GET` | `/demand/overrides` | Lịch sử override (paginated) |

**Query params hay dùng**:
- `snapshotId` — lọc theo snapshot
- `page`, `pageSize` — phân trang
- `segment` — lọc A/B/C
- `itemCode` — tìm FSKU cụ thể
- `locationCode` — tìm chi nhánh

---

### 4.2 AccuracyController — `/demand/accuracy`

Tab 1 data — toàn bộ đọc từ `demand_accuracy`.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/demand/accuracy/overview` | KPI tổng: totalItems, coveragePercent, dormantCount, quality metrics |
| `GET` | `/demand/accuracy/summary` | byMonth + byTier + KPI cards (model acc, MA3 acc, gain) |
| `GET` | `/demand/accuracy/skus` | Bảng SKU accuracy chi tiết (paginated, filter, sort) |
| `GET` | `/demand/accuracy/worst` | Danh sách SKU worst performers (acc < threshold) |
| `GET` | `/demand/accuracy/trend` | Time series T10→T3 (forecast, actual, CI bands) |
| `GET` | `/demand/accuracy/sku-trend` | Trend của 1 FSKU cụ thể (sparkline data) |
| `GET` | `/demand/accuracy/pareto` | Cumulative demand % theo SKU rank |
| `GET` | `/demand/accuracy/scatter` | Model vs MA3 accuracy scatter points + quadrant counts |
| `GET` | `/demand/accuracy/heatmap` | Accuracy grid: Segment × Volume Tier |
| `GET` | `/demand/accuracy/volatility` | CV histogram (coefficient of variation) |
| `GET` | `/demand/accuracy/compare` | So sánh 2 tháng: fc, actual, accuracy, change% |
| `GET` | `/demand/accuracy/error-distribution` | MAPE histogram + percentiles + tail SKUs |
| `GET` | `/demand/accuracy/bias` | Bias phân tích theo segment/month/branch |
| `GET` | `/demand/accuracy/bias-heatmap` | Bias grid: Branch × Segment |
| `GET` | `/demand/accuracy/cohort` | Accuracy theo nhóm tuổi SKU (panel months) |
| `GET` | `/demand/accuracy/ci-calibration` | Kiểm tra CI coverage rate (target 80%) |
| `GET` | `/demand/accuracy/seasonality` | Seasonal index theo tháng |

**Query params hay dùng**:
- `month` — `t1` | `t12` | `t11` | `t10`
- `segment` — `A` | `B` | `C` (bỏ trống = tất cả)
- `winner` — `MODEL` | `MA3` | `ALL`
- `sort` — `actual_desc` | `accuracy_asc` | `accuracy_desc` | `gain_desc`
- `page`, `pageSize`

---

### 4.3 InsightsController — `/demand/forecast`

Tab 2 data — đọc từ `demand_snapshot_line` + `demand_forecast_detail`.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/demand/forecast/sku-status` | Phân phối trạng thái SKU: ACT/END/NEW/Other |
| `GET` | `/demand/forecast/insights` | Tổng hợp: byPeriod, bySegment, byComboClass, TET impact |
| `GET` | `/demand/forecast/quality` | Chất lượng forecast: CI spread, alerts, accuracy proxy |
| `GET` | `/demand/forecast/alerts` | Zero forecast alerts (items có history nhưng forecast = 0) |
| `GET` | `/demand/forecast/branches` | Breakdown theo chi nhánh (archetype, qty, segment) |
| `GET` | `/demand/forecast/branch-summary` | Drill-down 1 chi nhánh (byPeriod, bySegment, top SKUs) |
| `GET` | `/demand/forecast/branch-heatmap` | Branch × Period demand heatmap |
| `GET` | `/demand/forecast/branch-pivot` | FSKU × Branch × Period pivot (paginated) |

---

## 5. TÍNH NĂNG CHÍNH (FEATURE LIST)

### Tab 1 — Forecast Overview

| ID | Tính năng | Component | Mô tả ngắn |
|---|---|---|---|
| — | Auto-insights Banner | `auto-insights-banner` | Câu nhận xét tự động dựa trên rule (model thắng? coverage OK?) |
| — | SKU Pipeline Panel | `sku-pipeline-panel` | Tổng SKUs → Active → Evaluated + Coverage ring |
| — | Accuracy Comparison | `accuracy-comparison-panel` | Model vs MA3: big numbers + bar gain |
| — | SKU Status Donut | `sku-status-donut` | Biểu đồ tròn ACT/END/NEW/Other |
| — | Data Quality Gauges | `data-quality-gauges` | 4 gauge: forecast rate, sparsity, data months, segments |
| — | Forecast Trend Chart | `forecast-trend-chart` | Line chart T10→T3 với CI bands, click để lọc bảng bên dưới |
| — | Accuracy by Month | `accuracy-by-month` | Bar chart accuracy từng tháng (model + MA3) |
| — | Accuracy by Tier | `accuracy-by-tier` | Accuracy theo nhóm volume (Top 20/50/100/200/500) |
| — | FSKU Accuracy Table | `fsku-accuracy-table` | Bảng chi tiết toàn bộ SKU, filter/sort, expand → sparkline |
| — | Worst Performers | `worst-performers` | Danh sách SKU tệ nhất (acc < 20%, actual > 100) |
| I-2 | Pareto Chart | `pareto-chart` | 80/20 rule: bao nhiêu SKU = 80% demand |
| I-3 | Scatter Model vs MA3 | `scatter-model-ma3` | 4 quadrant: model thắng/thua/cùng tốt/cùng tệ |
| I-4 | Accuracy Heatmap | `accuracy-heatmap` | Grid Segment × Volume Tier, màu xanh/vàng/đỏ |
| I-5 | Volatility Histogram | `volatility-histogram` | Phân phối CV: SKU nào volatile, SKU nào stable |

### Tab 2 — Branch Forecast

| ID | Tính năng | Component | Mô tả ngắn |
|---|---|---|---|
| — | Coverage Gauge | `coverage-gauge` | Gauge % items có forecast, drill theo segment |
| — | Insights Summary | `insights-summary` | byPeriod/bySegment/byComboClass + TET uplift |
| — | FSKU × Branch Table | `fsku-branch-table` | Pivot FSKU × Branch × Period, expand → heartbeat chart |
| — | Branch Breakdown | `branch-table` | Bảng chi nhánh, sort, expand → drill panel |
| — | Branch Drill Panel | `branch-drill-panel` | R9: byPeriod + bySegment + top 10 SKU của chi nhánh |
| — | FSKU Heartbeat Explorer | `fsku-heartbeat-explorer` | Tìm FSKU, xem xung nhịp forecast toàn snapshot |
| — | Quality Card | `quality-card` | CI spread + accuracy proxy + cảnh báo |
| — | Zero Forecast Alerts | `zero-forecast-table` | Items có lịch sử nhưng forecast = 0 (CRITICAL/HIGH/MEDIUM) |
| — | Snapshot Table | `snapshot-table` | Quản lý snapshots, freeze/delete/archive |
| I-6 | Branch Period Heatmap | `branch-period-heatmap` | Heatmap Branch × Period, màu intensity theo qty |
| I-7 | Branch Performance Ranking | `branch-performance-ranking` | Top 5 / Bottom 5 branches |
| I-8 | Segment Mix by Branch | `segment-mix-branch` | Stacked bar A/B/C per branch |
| I-10 | Period Comparison | `period-comparison` | So sánh T12 vs T1: FC Δ và Acc Δ |

### Tab 3 — Analyst View

| ID | Tính năng | Component | Section |
|---|---|---|---|
| I-11 | MAPE Histogram | `analyst/mape-histogram` | A — Error Distribution |
| I-12 | Error Tail Pie | `analyst/error-tail-pie` | A — Error Distribution |
| I-13 | Bias Diverging Bar | `analyst/bias-diverging-bar` | B — Bias Analysis |
| I-14 | Bias Heatmap | `analyst/bias-heatmap` | B — Bias Analysis |
| I-15 | Accuracy Trend Chart | `analyst/accuracy-trend-chart` | C — Temporal Accuracy |
| I-16 | Seasonality Chart | `analyst/seasonality-chart` | C — Temporal Accuracy |
| I-17 | Accuracy Matrix Bubble | `analyst/accuracy-matrix-bubble` | D — Cross-Dimensional |
| I-18 | Accuracy Volume Scatter | `analyst/accuracy-volume-scatter` | D — Cross-Dimensional |
| I-19 | Cohort Accuracy Chart | `analyst/cohort-accuracy-chart` | E — Cohort & Lifecycle |
| I-20 | Lifecycle Stage Bar | `analyst/lifecycle-stage-bar` | E — Cohort & Lifecycle |
| I-21 | CI Calibration Chart | `analyst/ci-calibration-chart` | F — Diagnostics |
| I-22 | Confidence Scatter | `analyst/confidence-scatter` | F — Diagnostics |

---

## 6. BUSINESS RULES QUAN TRỌNG

### 6.1 Snapshot Lifecycle
```
DRAFT  ──[freeze]──►  FROZEN  ──[archive]──►  ARCHIVED
  │
  └──[delete]──► (xóa cả lines + override_log)
```
- **DRAFT**: Planner có thể edit, override, xóa
- **FROZEN**: Immutable — đã lock cho planning cycle
- **ARCHIVED**: Read-only lưu trữ, không dùng nữa
- Không thể nhảy ngược (FROZEN → DRAFT không được)

### 6.2 CSV Upload Logic
Format auto-detect theo cột header:
- **DRP_EXPORT**: Có cột `fsku_id`, `forecast_qty`, `forecast_date` (22 cột)
- **FULL**: Có `confidence_lower`, `tet_flag`, `combo_class`
- **SIMPLE**: Chỉ `item_code`, `qty`, `period_start`

Filter trước khi lưu:
1. Bỏ rows có `exclude_flag = 'EXCLUDE'`
2. Bỏ rows có `combo_class = 'DORMANT_DISCONTINUED'`
3. Validate FK: item_code phải tồn tại trong `item` table, location_code trong `location` table
4. Nếu > 10% rows invalid → reject toàn bộ file

### 6.3 Accuracy Model — Ai thắng?
```
Winner = (acc_final_t1 >= acc_ma3_t1) ? 'MODEL' : 'MA3'
Gain   = acc_final_t1 - acc_ma3_t1   (pp — percentage points)
```
- Horizon T10/T11: chỉ có WMA (không có FINAL model)
- Horizon T12/T1: có cả FINAL + MA3 → so sánh được
- Horizon T2/T3: forecast-only (chưa có actual)

### 6.4 WMAPE Formula
```
WMAPE = SUM(|forecast - actual|) / SUM(actual) × 100
```
Dùng weighted để tránh SKU nhỏ có MAPE cao kéo lệch số tổng.

### 6.5 TET Impact Detection
```sql
tet_flag = 'Y'
-- hoặc fallback:
EXTRACT(MONTH FROM period_start) IN (1, 2, 3)  -- Jan/Feb/Mar
```
Uplift = `(tetAvgQty - overallAvg) / overallAvg × 100`
> Baseline dùng overall average (không chỉ non-TET) để tránh overstating uplift.

### 6.6 CI Calibration Target
Confidence Interval phải bao phủ actual **80% số lần**. Nếu < 80% → CI quá hẹp. Nếu > 95% → CI quá rộng (không informative).

### 6.7 Zero Forecast Alert Severity
| Severity | Điều kiện |
|---|---|
| CRITICAL | `qty_sold_12m_avg > 500` và `forecast_qty = 0` |
| HIGH | `qty_sold_12m_avg > 100` và `forecast_qty = 0` |
| MEDIUM | `qty_sold_12m_avg > 0` và `forecast_qty = 0` |

---

## 7. LUỒNG NGHIỆP VỤ (USER FLOW)

### Flow 1: Planner Import Forecast Mới
```
1. Nhận file CSV từ Data Science team
2. Vào /demand → Upload CSV
3. Hệ thống tạo DRAFT snapshot, validate, filter
4. Planner review snapshot → xem Coverage Gauge, Alerts
5. Nếu có Zero Forecast Alert → escalate hoặc override thủ công
6. Freeze snapshot → lock cho planning
7. Planning team dùng snapshot này để ra PO
```

### Flow 2: Planner Review Accuracy
```
1. Vào Tab 1 — Forecast Overview
2. Xem Auto-Insights Banner: model có thắng không? coverage OK chưa?
3. Check Forecast Trend Chart: trend going up/down?
4. Xem FSKU Accuracy Table: lọc segment A, sort by actual DESC
5. Click expand ▸ → xem sparkline từng SKU
6. Xem Worst Performers: SKU nào acc < 20%
7. Export CSV → gửi cho DS team review
```

### Flow 3: Analyst Deep Dive
```
1. Vào Tab 3 — Analyst View
2. Section A (Error): xem MAPE distribution, có SKU tail nào không?
3. Section B (Bias): model có xu hướng over/under-forecast không?
4. Section C (Temporal): accuracy tháng nào tệ nhất?
5. Section D (Cross-Dim): volume ảnh hưởng accuracy thế nào?
6. Section E (Cohort): SKU mới (< 3 tháng) accuracy có khác SKU cũ?
7. Section F (Diagnostics): CI có calibrated đúng không?
```

### Flow 4: Branch Manager Review
```
1. Vào Tab 2 — Branch Forecast
2. Xem Branch Breakdown Table → sort theo totalQty DESC
3. Click ▸ expand branch → xem byPeriod + bySegment + top SKUs
4. Xem FSKU × Branch Table → filter theo locationCode
5. Click ▸ expand SKU → xem heartbeat chart (demand xung nhịp theo period)
6. Xem Branch Period Heatmap → tháng nào demand cao?
```

---

## 8. FILE STRUCTURE (FRONTEND)

```
frontend/
├── app/
│   └── demand/
│       └── page.tsx                 ← Entry point, 3 tabs
│
├── components/demand/
│   ├── [Tab 1 — Accuracy]
│   │   ├── auto-insights-banner.tsx
│   │   ├── sku-pipeline-panel.tsx
│   │   ├── accuracy-comparison-panel.tsx
│   │   ├── forecast-trend-chart.tsx
│   │   ├── forecast-health-score.tsx (built, hidden)
│   │   ├── accuracy-by-month.tsx
│   │   ├── accuracy-by-tier.tsx
│   │   ├── fsku-accuracy-table.tsx
│   │   ├── fsku-sparkline.tsx
│   │   ├── worst-performers.tsx
│   │   ├── sku-status-donut.tsx
│   │   ├── data-quality-gauges.tsx
│   │   ├── pareto-chart.tsx          (I-2)
│   │   ├── scatter-model-ma3.tsx     (I-3)
│   │   ├── accuracy-heatmap.tsx      (I-4)
│   │   └── volatility-histogram.tsx  (I-5)
│   │
│   ├── [Tab 2 — Branch]
│   │   ├── coverage-gauge.tsx
│   │   ├── insights-summary.tsx
│   │   ├── fsku-branch-table.tsx
│   │   ├── fsku-branch-heartbeat.tsx
│   │   ├── fsku-heartbeat-explorer.tsx
│   │   ├── branch-table.tsx
│   │   ├── branch-drill-panel.tsx
│   │   ├── quality-card.tsx
│   │   ├── zero-forecast-table.tsx
│   │   ├── snapshot-table.tsx
│   │   ├── branch-period-heatmap.tsx  (I-6)
│   │   ├── branch-performance-ranking.tsx (I-7)
│   │   ├── segment-mix-branch.tsx     (I-8)
│   │   └── period-comparison.tsx      (I-10)
│   │
│   ├── [Dialogs]
│   │   ├── upload-dialog.tsx
│   │   ├── override-dialog.tsx
│   │   └── override-history-modal.tsx
│   │
│   └── analyst/                      (Tab 3 — I-11 to I-22)
│       ├── mape-histogram.tsx
│       ├── error-tail-pie.tsx
│       ├── bias-diverging-bar.tsx
│       ├── bias-heatmap.tsx
│       ├── accuracy-trend-chart.tsx
│       ├── seasonality-chart.tsx
│       ├── accuracy-matrix-bubble.tsx
│       ├── accuracy-volume-scatter.tsx
│       ├── cohort-accuracy-chart.tsx
│       ├── lifecycle-stage-bar.tsx
│       ├── ci-calibration-chart.tsx
│       └── confidence-scatter.tsx
│
└── lib/api/
    └── demand.ts                     ← Tất cả API functions + types
```

---

## 9. FILE STRUCTURE (BACKEND)

```
backend/src/demand/
├── controllers/
│   ├── demand.controller.ts         ← /demand/* endpoints
│   ├── accuracy.controller.ts       ← /demand/accuracy/* endpoints
│   └── insights.controller.ts       ← /demand/forecast/* endpoints
│
├── services/
│   ├── demand.service.ts            ← Snapshot CRUD + upload + override
│   ├── accuracy.service.ts          ← Backtest analytics (demand_accuracy)
│   └── insights.service.ts          ← Branch insights (snapshot_line + detail)
│
├── entities/
│   ├── demand-snapshot.entity.ts
│   ├── demand-snapshot-line.entity.ts
│   ├── demand-forecast-detail.entity.ts
│   ├── demand-accuracy.entity.ts
│   └── demand-override-log.entity.ts
│
└── demand.module.ts
```

---

## 10. SHARED COMPONENTS

| Component | Path | Dùng ở đâu |
|---|---|---|
| `DataTable<T>` | `components/shared/data-table.tsx` | Tất cả bảng dữ liệu có pagination + sort + search |
| `ChartCard` | `components/shared/chart-card.tsx` | Wrapper cho mọi chart (title, subtitle, height, action slot) |
| `AccuracyBadge` | `components/shared/accuracy-badge.tsx` | Badge màu cho accuracy % (green/yellow/red) |
| `KpiCardSkeleton` | `components/shared/skeleton.tsx` | Loading skeleton cho KPI cards |
| `ChartSkeleton` | `components/shared/skeleton.tsx` | Loading skeleton cho charts |

**DataTable features**:
- Server-side pagination (page, pageSize)
- Server-side sort (sortKey, dir)
- Debounced search (300ms)
- Row expansion (▸ toggle)
- Row color via `rowClassName` prop
- Export CSV button
- Loading overlay

---

## 11. KNOWN LIMITATIONS & TECH DEBT

| # | Vấn đề | Mức độ | Ghi chú |
|---|---|---|---|
| L1 | `branch_name` chứa Unicode escapes từ DRP | Low | Đã có decode logic, edge cases vẫn có thể xảy ra |
| L2 | Tab 3 analyst components tự fetch (không share state với Tab 1) | Low | Chấp nhận được vì analyst flow khác planner flow |
| L3 | Volatility dùng T10-T1 actuals — chỉ 4 điểm dữ liệu | Medium | Kết quả CV có thể không đại diện với SKU ít data |
| L4 | `SegmentMixBranch` estimate A/B/C từ `topSegment` (không có actual per-branch seg breakdown) | Low | Approximate, ghi note trong subtitle |
| L5 | `ConfidenceScatter` dùng gain làm CI proxy | Low | Actual CI bounds không có ở level SKU trong accuracy table |
| L6 | BE search cho FSKU accuracy table là client-side filter | Medium | Nên move lên BE khi data > 5K rows |

---

## 12. CHECKLIST DONE MODULE 1

### Backend
- [x] DemandController: snapshot CRUD, upload, override, export
- [x] AccuracyController: overview, summary, skus, worst, trend, sku-trend
- [x] AccuracyController: pareto, scatter, heatmap, volatility, compare
- [x] AccuracyController: error-distribution, bias, bias-heatmap, cohort, ci-calibration, seasonality
- [x] InsightsController: sku-status, insights, quality, alerts, branches, branch-summary
- [x] InsightsController: branch-heatmap, branch-pivot

### Frontend
- [x] Tab 1: Auto-Insights, SKU Pipeline, Accuracy Comparison, Forecast Trend
- [x] Tab 1: Accuracy by Month/Tier, FSKU Accuracy Table, Worst Performers
- [x] Tab 1: Data Quality Gauges, SKU Status Donut
- [x] Tab 1 (I-2 to I-5): Pareto, Scatter, Heatmap, Volatility Histogram
- [x] Tab 2: Coverage Gauge, Insights Summary, FSKU×Branch Table, Branch Table
- [x] Tab 2: Branch Drill Panel, FSKU Heartbeat Explorer, Quality Card, Zero Alert Table
- [x] Tab 2: Snapshot Table, Upload/Override/History Dialogs
- [x] Tab 2 (I-6 to I-8, I-10): Branch Heatmap, Ranking, Segment Mix, Period Comparison
- [x] Tab 3 (I-11 to I-22): 12 analyst components (Error/Bias/Temporal/Cross-Dim/Cohort/Diagnostics)

### Bugs Fixed
- [x] Pagination reset bug: debounce stable ref pattern + useCallback trong parent tables
- [x] Branch name Unicode decode (F6)
- [x] TET uplift baseline formula (B5)
- [x] Upload filter logic: exclude_flag thay vì model_config_id (G2)

---

*Report này được viết sau khi Module 1 hoàn thành. Module 2 tiếp theo sẽ xây dựng trên nền dữ liệu forecast đã freeze từ Module 1.*
