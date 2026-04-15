# Module Spec — Step 1: Demand Ingestion — Import Forecast

> **Module ID:** SCP-UNIS-01
> **Version:** 1.0
> **Last Updated:** 2026-04-11
> **Owner:** R-BA (Requirements Business Analyst)
> **Status:** DRAFT

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ tất cả `tenant_id` trong SQL/Python — UNIS single-tenant (`D-MD-03`)
> - **Item PK:** Dùng `item_code VARCHAR` thay `id BIGINT`. `canonical_id` = `item_code` (`D-MD-01`)
> - **Location PK:** Dùng `location_code VARCHAR` thay `id BIGINT`. `code` = `location_code` (`D-MD-02`)
> - **API path:** Dùng `/api/v1/` prefix (`D-MD-04`)
> - **Schema ref:** Xem `00-master-data.md` cho tất cả table definitions

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

Mỗi tháng, team thuật toán UNIS chạy model dự báo và gửi file Excel/CSV cho Kế hoạch viên.
Kế hoạch viên upload file này vào hệ thống, kiểm tra, điều chỉnh nếu cần, rồi **"đóng băng"**
(freeze) để làm đầu vào cho bước tính toán kế hoạch phân phối (DRP).

> **Tại sao phải freeze?** Để toàn bộ pipeline từ Step 1 → Step 8 dùng **cùng một bộ số**,
> không bị thay đổi giữa chừng. Khi cần cập nhật → tạo phiên bản mới, không xóa bản cũ.

**Người dùng chính:** Kế hoạch viên (sc_planner)

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **Kế hoạch viên** | Upload file, review, override (sửa số nếu cần), freeze snapshot |
| **Team thuật toán** | Cung cấp file CSV (không dùng hệ thống trực tiếp) |
| **SC Manager** | Xem báo cáo coverage, không cần thao tác thường xuyên |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là Kế hoạch viên**, tôi muốn **upload file forecast CSV** để hệ thống có dữ liệu dự báo cho tháng tới | File được parse, validated, tạo DRAFT snapshot, hiển thị summary (tổng dòng, lỗi nếu có) |
| US-02 | **Là Kế hoạch viên**, tôi muốn **xem bảng forecast theo FSKU × tháng** để phát hiện số bất thường trước khi chạy DRP | Bảng pivot hiển thị đúng, có màu cảnh báo cho items forecast = 0 nhưng có lịch sử bán |
| US-03 | **Là Kế hoạch viên**, tôi muốn **sửa một số forecast cụ thể** (override) vì khách lớn đã báo thêm đơn | Sửa được qty, phải nhập lý do, hệ thống lưu lại lịch sử sửa (ai sửa, bao nhiêu, khi nào) |
| US-04 | **Là Kế hoạch viên**, tôi muốn **freeze snapshot** khi đã review xong để DRP dùng bộ số này | Snapshot chuyển sang FROZEN, không ai sửa được nữa, DRP được phép đọc |
| US-05 | **Là Kế hoạch viên**, tôi muốn **xem coverage** — bao nhiêu % items có forecast | Gauge hiển thị X/1,660 items có forecast, breakdown theo A/B/C |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Upload thành công (Happy Path)

```
1. Kế hoạch viên nhận file "Forecast_April2026.csv" từ team thuật toán
2. Vào màn hình Step 1 → kéo thả file vào upload zone
3. Hệ thống xử lý trong ~30 giây → hiển thị preview:
   "Đã đọc 84,764 dòng | 1,419 items | 68 chi nhánh | 241 items dormant (loại tự động)"
4. Kế hoạch viên xem bảng pivot → thấy số FSKU-XYZ tháng 4 = 0 (nghi ngờ thiếu)
5. Override: sửa từ 0 → 300 thùng, nhập lý do "Dự án Vinhomes xác nhận"
6. Bấm "Freeze Snapshot" → hệ thống khóa, sẵn sàng cho Step 2 → DRP
```

#### ❌ Kịch bản 2 — File có branch code không nhận ra (Sad Path)

```
1. Upload file → hệ thống xử lý
2. Thông báo lỗi: "12 dòng có branch_code không tồn tại: [CN-999, CN-000, ...]"
3. Hệ thống tạo DRAFT snapshot (không dừng) nhưng đánh dấu 12 dòng là lỗi
4. Kế hoạch viên có 2 lựa chọn:
   (a) Chấp nhận: freeze bỏ qua 12 dòng lỗi (ghi log)
   (b) Sửa file và upload lại
```

#### ⚠️ Kịch bản 3 — Forecast cũ, chưa có file tháng mới (Sad Path)

```
1. Kế hoạch viên vào hệ thống, bấm "Run DRP"
2. Hệ thống từ chối: "Demand snapshot chưa có — cần upload forecast tháng 4/2026 trước"
3. Kế hoạch viên liên hệ team thuật toán → nhận file → upload
→ DRP chỉ chạy sau khi có FROZEN snapshot
```

---

### 0.4 Thuật ngữ (cho BA dùng khi gặp stakeholder)

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **FSKU** | Mã sản phẩm trong hệ thống forecast (= mã hàng trong SCP) |
| **Forecast Snapshot** | "Bản chụp" dữ liệu dự báo tại 1 thời điểm — như save file |
| **FROZEN** | Snapshot đã khóa, không sửa được — DRP mới được phép đọc |
| **Dormant item** | Sản phẩm có forecast = 0 toàn bộ — loại khỏi kế hoạch tự động |
| **Override** | Kế hoạch viên sửa tay 1 con số forecast — có log lịch sử |
| **Coverage** | % items có forecast trong tổng số items đang hoạt động |

---

## 1. Mục đích (Purpose)

Import dữ liệu dự báo (forecast) từ team thuật toán UNIS vào hệ thống SCP.
Đây là bước ĐẦU TIÊN trong pipeline — không có forecast thì không có DRP.

Hệ thống hỗ trợ **2 loại forecast file**:

| Loại | File mẫu | Rows | Mô tả |
|-------|----------|------|--------|
| **Forecast tổng thể** | `Forecast_30032026.csv` | 1,660 FSKUs × 4 tháng | Forecast gộp toàn hệ thống, dùng cho planning tổng |
| **Forecast chi nhánh** | `drp_export_dec25_q1_2026.csv` | 84,764 rows | 69 CN × 22 columns, chi tiết đến từng branch |

Forecast chi nhánh là input CHÍNH cho DRP netting (Step 4).
Forecast tổng thể dùng cho dashboard summary và cross-check.

**Quan trọng:** UNIS KHÔNG dùng external Forecast API. Toàn bộ forecast được
team thuật toán tính offline (Python/R models) rồi export CSV → planner upload vào SCP.

---

## 2. UNIS Context (Đặc thù UNIS)

### 2.1. Quy trình hiện tại
- Team thuật toán UNIS chạy model hàng tháng (monthly cycle)
- Output: CSV files gửi qua shared folder / email
- Planner download → review → upload vào SCP
- Không có API integration giữa model engine và SCP

### 2.2. Đặc thù ngành vật liệu xây dựng
- **Tính mùa vụ:** Tết (tháng 1-3) demand tăng đột biến do xây dựng trước Tết
- **Tết flag:** `tet_flag=Y` đánh dấu các tháng chịu ảnh hưởng Tết
- **Dormant items:** 241 FSKUs có forecast = 0 toàn bộ → loại khỏi DRP
- **FSKU diversity:** 1,660 FSKUs across nhiều product line (xi măng, thép, gạch, v.v.)

### 2.3. Phân loại combo_class
Team thuật toán phân loại demand pattern của từng FSKU:

| combo_class | Tỷ lệ | Mô tả |
|-------------|--------|--------|
| DORMANT_SEASONAL | 42% | Sản phẩm mùa vụ, có period không bán |
| ERRATIC | 14% | Demand không ổn định, khó dự báo |
| COLD_START | 13% | Sản phẩm mới, ít data lịch sử |
| SMOOTH | 18% | Demand ổn định |
| LUMPY | 8% | Demand lớn nhưng không đều |
| Khác | 5% | Các pattern còn lại |

### 2.4. Segment phân loại (ABC)
- **A:** Top 20% volume — 168 items
- **B:** Next 30% volume — 1,097 items
- **C:** Bottom 50% volume — 317 items
- Segment do team thuật toán gán sẵn trong CSV, SCP KHÔNG tự tính

---

## 3. Dữ liệu đầu vào (Input Data)

### 3.1. CSV Schema — Forecast chi nhánh (22 columns)

| # | Column | Type | Required | Mô tả |
|---|--------|------|----------|--------|
| 1 | `fsku_id` | VARCHAR(50) | YES | Mã FSKU (= `item_code` trong SCP) |
| 2 | `branch_code` | VARCHAR(20) | YES | Mã chi nhánh (69 CN) |
| 3 | `branch_name` | VARCHAR(100) | NO | Tên chi nhánh |
| 4 | `branch_archetype` | VARCHAR(30) | YES | Phân loại CN: URBAN/RURAL/SEMI_URBAN |
| 5 | `forecast_date` | DATE | YES | Tháng dự báo (YYYY-MM-DD, ngày 1 của tháng) |
| 6 | `forecast_qty` | DECIMAL(15,2) | YES | Số lượng dự báo (units) |
| 7 | `reconciled_qty` | DECIMAL(15,2) | NO | Số lượng sau reconcile (nếu có adjustment) |
| 8 | `segment` | CHAR(1) | YES | Phân loại ABC: A/B/C |
| 9 | `model_config_id` | VARCHAR(50) | NO | ID config của model đã dùng |
| 10 | `combo_class` | VARCHAR(50) | YES | Demand pattern classification |
| 11 | `confidence_lower` | DECIMAL(15,2) | NO | Confidence interval — lower bound |
| 12 | `confidence_upper` | DECIMAL(15,2) | NO | Confidence interval — upper bound |
| 13 | `qty_sold_12m_avg` | DECIMAL(15,2) | YES | Trung bình bán 12 tháng gần nhất |
| 14 | `qty_sold_3m_avg` | DECIMAL(15,2) | YES | Trung bình bán 3 tháng gần nhất |
| 15 | `tet_flag` | CHAR(1) | YES | Y/N — tháng có ảnh hưởng Tết |
| 16 | `forecast_method` | VARCHAR(30) | NO | Algorithm used (ETS/ARIMA/ML/etc.) |
| 17 | `mape_historical` | DECIMAL(5,2) | NO | MAPE lịch sử của model cho item này |
| 18 | `qty_sold_same_month_ly` | DECIMAL(15,2) | NO | Doanh số cùng tháng năm trước |
| 19 | `promo_flag` | CHAR(1) | NO | Y/N — tháng có khuyến mãi |
| 20 | `new_product_flag` | CHAR(1) | NO | Y/N — sản phẩm mới < 6 tháng |
| 21 | `exclude_flag` | VARCHAR(30) | NO | EXCLUDE / DORMANT_DISCONTINUED / null |
| 22 | `notes` | TEXT | NO | Ghi chú từ team thuật toán |

### 3.2. CSV Schema — Forecast tổng thể

| Column | Type | Mô tả |
|--------|------|--------|
| `fsku_id` | VARCHAR(50) | Mã FSKU |
| `forecast_date` | DATE | Tháng dự báo |
| `forecast_qty` | DECIMAL(15,2) | Tổng forecast toàn hệ thống |
| `segment` | CHAR(1) | ABC |
| `combo_class` | VARCHAR(50) | Demand pattern |

### 3.3. Mapping Requirements
- `fsku_id` trong CSV → match với `canonical_id` trong bảng `item`
- Nếu `fsku_id` không tìm thấy trong `item` table → log warning, skip row
- `branch_code` → match với `location.code` WHERE `location_type = 'BRANCH'`

---

## 4. Logic xử lý (Processing Logic)

### 4.0 Pipeline Trigger — PlanningCycle

UNIS pipeline chạy nightly vào 23:00 ICT (cấu hình trong `planning_cycle` table).

| Config | Value | Mô tả |
|---|---|---|
| cutoff_time | 23:00 ICT | Thời điểm pipeline bắt đầu |
| cutoff_buffer_minutes | 30 | Buffer 30 phút trước cutoff |
| run_frequency | NIGHTLY | Chạy hàng đêm |
| horizon_weeks | 12 | 12 tuần planning horizon |
| granularity | WEEKLY | Kế hoạch theo tuần |
| timezone | Asia/Ho_Chi_Minh | ICT timezone |
| freshness_threshold_minutes | 240 | Supply data phải mới hơn 4 giờ |

**Pre-conditions trước khi Step 1 chạy:**
1. ✅ PlanningCycle record exists for UNIS tenant
2. ✅ Current time ≥ cutoff_time (23:00)
3. ✅ Freshness Gate PASS — WMS/ERP data sync mới hơn 240 min
4. ✅ Forecast data uploaded (demand_forecast_detail > 0 rows)

**Reference:** `planning_cycle` table, FR-v3-016 (cutoff config)

### 4.1. Upload Flow

```
[CSV File] → [Parse & Validate] → [Filter] → [Map IDs] → [Create Snapshot] → [Load Lines] → [Freeze]
```

### 4.2. Step-by-step Processing

**Step 4.2.1: Parse CSV**
- Detect encoding (UTF-8 / UTF-8 BOM / Windows-1252)
- Parse headers → validate required columns exist
- Parse rows → type validation per column schema
- Output: List<RawForecastRow>

**Step 4.2.2: Validate**
- Required field check: reject rows missing `fsku_id`, `branch_code`, `forecast_date`, `forecast_qty`
- Data type check: `forecast_qty` >= 0, `segment` IN ('A','B','C')
- Date range check: `forecast_date` within expected planning horizon
- Duplicate check: unique constraint on (fsku_id, branch_code, forecast_date)
- Output: ValidatedRows + ValidationErrors[]

**Step 4.2.3: Filter**
- LOẠI BỎ rows WHERE `exclude_flag` IN ('EXCLUDE', 'DORMANT_DISCONTINUED')
- LOẠI BỎ rows WHERE `combo_class` = 'DORMANT_DISCONTINUED'
- Log: "Filtered {N} rows: {reasons}"
- 241 FSKUs dormant (all-zero forecast) → loại toàn bộ rows của các FSKUs này

**Step 4.2.4: Map IDs**
```sql
-- Map fsku_id → item_id
SELECT id AS item_id, canonical_id AS fsku_id
FROM item
WHERE tenant_id = :tenant_id
  AND canonical_id = :fsku_id
  AND is_active = true

-- Map branch_code → location_id
SELECT id AS location_id, code AS branch_code
FROM location
WHERE tenant_id = :tenant_id
  AND code = :branch_code
  AND location_type = 'BRANCH'
```
- Unmapped items/branches → log to `import_error_log`, skip row

**Step 4.2.5: Create Snapshot**
```sql
INSERT INTO demand_snapshot (
    tenant_id, snapshot_name, status, source_type,
    forecast_file_name, total_lines, total_items,
    total_locations, horizon_start, horizon_end,
    created_by, created_at
) VALUES (
    :tenant_id, 'DRP Forecast Q1-2026', 'DRAFT', 'CSV_UPLOAD',
    :file_name, :line_count, :item_count,
    :location_count, :min_date, :max_date,
    :user_id, NOW()
)
```

**Step 4.2.6: Load Snapshot Lines**
```sql
INSERT INTO demand_snapshot_line (
    snapshot_id, item_id, location_id, period_start,
    forecast_qty, reconciled_qty, segment, combo_class,
    branch_archetype, confidence_lower, confidence_upper,
    tet_flag
) VALUES (...)
-- Batch insert: 1000 rows per batch
```

**Step 4.2.7: Load Full Detail**
```sql
INSERT INTO demand_forecast_detail (
    snapshot_id, item_id, location_id, period_start,
    -- all 22 columns from CSV stored as-is
    raw_data_json
) VALUES (...)
```

**Step 4.2.8: Freeze Snapshot**
- Planner reviews → confirms → triggers freeze
- `UPDATE demand_snapshot SET status='FROZEN', frozen_at=NOW(), frozen_by=:user_id`
- FROZEN snapshot = immutable, không ai sửa được (trừ override flow riêng)

### 4.3. Override Flow
- Planner có thể override forecast qty TRƯỚC KHI freeze
- Override ghi vào `demand_override_log` (who, when, old_qty, new_qty, reason)
- `reconciled_qty` = overridden value, `forecast_qty` = original
- DRP sử dụng `COALESCE(reconciled_qty, forecast_qty)` làm gross requirement

### 4.4. Demand Basis Logic
```python
def get_demand_basis(forecast_qty, confirmed_po_qty, cutoff_days=90):
    """
    UNIS rule: demand_basis = MAX_FORECAST_PO
    Lấy giá trị LỚN HƠN giữa forecast và confirmed PO trong 90 ngày.
    """
    if confirmed_po_qty is None or po_age > cutoff_days:
        return forecast_qty
    return max(forecast_qty, confirmed_po_qty)
```

---

## 5. Dữ liệu đầu ra (Output Data)

### 5.1. demand_snapshot

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | Auto-increment |
| `tenant_id` | BIGINT FK | Tenant = UNIS |
| `snapshot_name` | VARCHAR(200) | Tên do planner đặt |
| `status` | ENUM | DRAFT / FROZEN / ARCHIVED |
| `source_type` | VARCHAR(30) | CSV_UPLOAD |
| `forecast_file_name` | VARCHAR(500) | Tên file gốc |
| `total_lines` | INT | Tổng số dòng imported |
| `total_items` | INT | Số FSKUs unique |
| `total_locations` | INT | Số CN unique |
| `horizon_start` | DATE | Tháng bắt đầu forecast |
| `horizon_end` | DATE | Tháng kết thúc forecast |
| `frozen_at` | TIMESTAMP | Thời điểm freeze |
| `frozen_by` | BIGINT FK | User freeze |
| `created_by` | BIGINT FK | User tạo |
| `created_at` | TIMESTAMP | Thời điểm tạo |

### 5.2. demand_snapshot_line

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | Auto-increment |
| `snapshot_id` | BIGINT FK | → demand_snapshot |
| `item_id` | BIGINT FK | → item table |
| `location_id` | BIGINT FK | → location table |
| `period_start` | DATE | Ngày đầu tháng |
| `forecast_qty` | DECIMAL(15,2) | Forecast gốc |
| `reconciled_qty` | DECIMAL(15,2) | Forecast sau override (nullable) |
| `segment` | CHAR(1) | A/B/C |
| `combo_class` | VARCHAR(50) | Demand pattern class |
| `branch_archetype` | VARCHAR(30) | URBAN/RURAL/SEMI_URBAN |
| `confidence_lower` | DECIMAL(15,2) | CI lower |
| `confidence_upper` | DECIMAL(15,2) | CI upper |
| `tet_flag` | CHAR(1) | Y/N |

**Composite Unique:** (snapshot_id, item_id, location_id, period_start)

### 5.3. demand_forecast_detail

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | Auto-increment |
| `snapshot_id` | BIGINT FK | → demand_snapshot |
| `item_id` | BIGINT FK | → item table |
| `location_id` | BIGINT FK | → location table |
| `period_start` | DATE | Ngày đầu tháng |
| `raw_data_json` | JSONB | Full 22-column data as JSON |
| `qty_sold_12m_avg` | DECIMAL(15,2) | Indexed for SS calculation |
| `qty_sold_3m_avg` | DECIMAL(15,2) | Indexed for SS calculation |
| `mape_historical` | DECIMAL(5,2) | Indexed for monitoring |

### 5.4. demand_override_log

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | |
| `snapshot_line_id` | BIGINT FK | → demand_snapshot_line |
| `old_qty` | DECIMAL(15,2) | Giá trị cũ |
| `new_qty` | DECIMAL(15,2) | Giá trị mới |
| `reason` | TEXT | Lý do (bắt buộc) |
| `overridden_by` | BIGINT FK | User thực hiện |
| `overridden_at` | TIMESTAMP | Thời điểm |

---

## 6. API Endpoints

### 6.1. POST /api/v1/demand/forecast/upload

**Mô tả:** Bulk import forecast CSV file

**Request:**
```
Content-Type: multipart/form-data

file: <CSV file>
snapshot_name: "DRP Forecast Q1-2026"
forecast_type: "BRANCH" | "AGGREGATE"
```

**Response (201 Created):**
```json
{
  "snapshot_id": 42,
  "status": "DRAFT",
  "total_rows_parsed": 84764,
  "total_rows_imported": 82103,
  "total_rows_filtered": 2661,
  "total_items": 1419,
  "total_locations": 69,
  "validation_errors": [
    { "row": 1523, "column": "fsku_id", "error": "ITEM_NOT_FOUND", "value": "FSKU-9999" }
  ],
  "filter_summary": {
    "EXCLUDE": 850,
    "DORMANT_DISCONTINUED": 1811
  }
}
```

**Error Responses:**
- 400: Invalid CSV format / missing required columns
- 413: File too large (max 50MB)
- 422: > 10% rows have validation errors

### 6.2. GET /api/v1/demand/forecast/summary

**Mô tả:** Aggregated forecast view (tổng theo item hoặc location)

**Query params:**
- `snapshot_id` (required)
- `group_by`: `item` | `location` | `segment` | `period`
- `segment`: filter by A/B/C
- `page`, `page_size`

**Response:**
```json
{
  "data": [
    {
      "group_key": "A",
      "total_forecast_qty": 1250000,
      "item_count": 168,
      "location_count": 69,
      "avg_confidence_range": 15.2
    }
  ],
  "pagination": { "page": 1, "total_pages": 1 }
}
```

### 6.3. GET /api/v1/demand/forecast/detail

**Mô tả:** Branch-level forecast detail

**Query params:**
- `snapshot_id` (required)
- `item_id` / `fsku_id` (optional)
- `location_id` / `branch_code` (optional)
- `period_start` (optional)
- `page`, `page_size`

### 6.4. POST /api/v1/demand/snapshot

**Mô tả:** Create empty snapshot (manual, không qua upload)

**Request body:**
```json
{
  "snapshot_name": "Manual Forecast April 2026",
  "horizon_start": "2026-04-01",
  "horizon_end": "2026-07-31"
}
```

### 6.5. POST /api/v1/demand/snapshot/{id}/freeze

**Mô tả:** Freeze snapshot — sau freeze không sửa được

**Preconditions:**
- Snapshot status = DRAFT
- Snapshot có ít nhất 1 line
- User có role PLANNER hoặc MANAGER

**Response (200):**
```json
{
  "snapshot_id": 42,
  "status": "FROZEN",
  "frozen_at": "2026-04-11T10:30:00Z",
  "frozen_by": "planner@unis.vn",
  "total_lines": 82103
}
```

### 6.6. GET /api/v1/demand/forecast/coverage

**Mô tả:** Thống kê coverage — bao nhiêu items có forecast

**Response:**
```json
{
  "total_active_items": 1660,
  "items_with_forecast": 1419,
  "items_without_forecast": 241,
  "coverage_pct": 85.5,
  "by_segment": {
    "A": { "total": 168, "covered": 168, "pct": 100.0 },
    "B": { "total": 1097, "covered": 1015, "pct": 92.5 },
    "C": { "total": 395, "covered": 236, "pct": 59.7 }
  }
}
```

### 6.7. GET /api/v1/demand/forecast/export

**Mô tả:** Export forecast data ra CSV

**Query params:** `snapshot_id`, `format` (csv/xlsx)

### 6.8. POST /api/v1/demand/forecast/override

**Mô tả:** Planner điều chỉnh forecast qty

**Request:**
```json
{
  "snapshot_line_id": 12345,
  "new_qty": 500.0,
  "reason": "Khách hàng lớn báo tăng đơn hàng Q2"
}
```

**Business rule:** `reason` bắt buộc (không được để trống).

---

## 7. Business Rules (UNIS-specific)

### BR-01: Demand Basis = MAX_FORECAST_PO
Khi có cả forecast và confirmed PO cho cùng item × location × period:
- Lấy giá trị LỚN HƠN
- Cutoff: chỉ xét PO trong vòng 90 ngày
- Nếu PO > 90 ngày → bỏ qua, chỉ dùng forecast

### BR-02: Tết Flag Handling
- Rows có `tet_flag=Y` (tháng 1-3/2026): demand cao hơn bình thường
- SCP KHÔNG điều chỉnh forecast — giữ nguyên giá trị từ team thuật toán
- Tết flag dùng cho reporting và alerting (hiển thị badge trên UI)

### BR-03: Dormant Item Exclusion
- 241 FSKUs có forecast = 0 cho TẤT CẢ periods → auto-exclude khỏi DRP
- Exclude tại thời điểm import (filter step)
- Nếu item từ dormant → có forecast > 0 trong file mới → tự động include lại

### BR-04: No External Forecast API
- UNIS dùng CSV upload ONLY
- Không gọi external forecast service
- Không có real-time forecast refresh
- Monthly batch cycle: team thuật toán chạy model → export CSV → planner upload

### BR-05: Combo Class Tracking
- `combo_class` lưu nguyên từ CSV, KHÔNG tính lại
- Dùng cho reporting và phân tích accuracy
- DORMANT_SEASONAL (42%) — cần đặc biệt chú ý khi forecast = 0 (có thể chỉ là off-season)

### BR-06: Snapshot Immutability
- FROZEN snapshot KHÔNG được sửa
- Muốn sửa → tạo snapshot MỚI (version mới)
- Override chỉ hoạt động khi status = DRAFT

### BR-07: File Size Limit
- Max CSV: 50MB
- Max rows: 200,000
- Timeout upload processing: 120 seconds

---

## 8. Cross-Module References

### 8.1. OUTPUT → Step 4 (DRP Netting)
```
demand_snapshot_line.forecast_qty → DRP gross_requirements
demand_snapshot_line.reconciled_qty → override gross_requirements (nếu có)

DRP query:
SELECT COALESCE(dsl.reconciled_qty, dsl.forecast_qty) AS gross_requirement
FROM demand_snapshot_line dsl
WHERE dsl.snapshot_id = :frozen_snapshot_id
  AND dsl.item_id = :item_id
  AND dsl.location_id = :location_id
  AND dsl.period_start = :week_start
```

### 8.2. OUTPUT → Step 8 (Monitor)
```
demand_snapshot_line.forecast_qty → so sánh với actual sales → tính MAPE
demand_forecast_detail.mape_historical → baseline MAPE từ team thuật toán
```

### 8.3. INPUT from Step 8 (Monitor)
```
Khi Step 8 phát hiện forecast drift (actual vs forecast lệch > threshold):
→ Alert planner
→ Planner có thể:
   (a) Override qty trong current DRAFT snapshot
   (b) Yêu cầu team thuật toán re-forecast → upload CSV mới
```

### 8.4. OUTPUT → Step 3 (Inventory Policy)
```
demand_forecast_detail.qty_sold_12m_avg → ADU cho Safety Stock calc
demand_forecast_detail.qty_sold_3m_avg → σ_demand proxy
demand_snapshot_line.segment → ABC classification cross-check
```

---

## 9. Giao diện người dùng (UI Requirements)

### 9.1. Forecast Matrix Table
- **Layout:** Pivot table — rows = FSKU, columns = months
- **Cells:** forecast_qty (hover → confidence interval)
- **Color coding by segment:**
  - A = blue background
  - B = yellow background
  - C = gray background
- **Color coding by severity:**
  - Forecast = 0 nhưng có sales history → red (possible miss)
  - Forecast > 2× historical avg → orange (possible overforecast)
  - Normal → white
- **Filters:** segment, combo_class, branch_archetype, tet_flag
- **Sort:** by FSKU, by forecast_qty desc, by segment

### 9.2. Forecast Coverage Gauge
- **Circular gauge:** X/Y items có forecast (e.g., 1419/1660 = 85.5%)
- **Color:** Green > 90%, Yellow 70-90%, Red < 70%
- **Breakdown by segment:** 3 mini gauges cho A/B/C
- **Click → drill down** danh sách items không có forecast

### 9.3. Upload CSV Flow
1. **Upload button** — drag & drop hoặc click chọn file
2. **Preview table** — hiển thị 20 rows đầu tiên
3. **Validation summary:**
   - Total rows parsed
   - Rows passed / failed / filtered
   - List of errors (expandable)
4. **Confirm import** → tạo DRAFT snapshot
5. **Progress bar** cho large files (84K+ rows)

### 9.4. Snapshot List Table
| Column | Mô tả |
|--------|--------|
| Snapshot Name | Tên |
| Status | DRAFT / FROZEN / ARCHIVED (badge color) |
| Lines Count | Số dòng |
| Items | Số FSKUs unique |
| Locations | Số CN |
| Horizon | Start → End date |
| Created By | User |
| Created At | Datetime |
| Frozen At | Datetime (nếu FROZEN) |
| Actions | Freeze / Archive / Export / Delete (draft only) |

### 9.5. Override Dialog
- **Trigger:** Click vào cell trong Forecast Matrix
- **Fields:**
  - Current qty (read-only)
  - New qty (input, >= 0)
  - Reason (textarea, REQUIRED — cannot be empty)
- **Save** → update reconciled_qty, log to override_log
- **History** button → danh sách overrides cho cell này

### 9.6. Export CSV Button
- Download current view (filtered) as CSV
- Include all columns hoặc selected columns
- File name: `forecast_export_{snapshot_name}_{date}.csv`

---

## 10. Acceptance Criteria

### AC-01: CSV Upload — Happy Path
```gherkin
GIVEN planner uploads valid forecast CSV (84,764 rows)
WHEN system processes the file
THEN a DRAFT snapshot is created
  AND total_rows_imported >= 82,000 (after filtering)
  AND total_items = 1,419 (excluding 241 dormant)
  AND total_locations = 69
  AND processing time < 120 seconds
```

### AC-02: CSV Upload — Validation Errors
```gherkin
GIVEN CSV has rows with invalid data (missing fsku_id, negative qty)
WHEN system processes the file
THEN invalid rows are rejected with specific error messages
  AND valid rows are still imported
  AND validation_errors array contains all errors with row number + column + reason
```

### AC-03: Filter Excluded Items
```gherkin
GIVEN CSV contains rows with exclude_flag = 'EXCLUDE' or 'DORMANT_DISCONTINUED'
WHEN system processes the file
THEN these rows are NOT imported into demand_snapshot_line
  AND filter_summary shows count per exclusion reason
```

### AC-04: FSKU Mapping
```gherkin
GIVEN CSV has fsku_id = 'FSKU-ABC123'
  AND item table has canonical_id = 'FSKU-ABC123' with id = 42
WHEN system maps IDs
THEN demand_snapshot_line.item_id = 42
```

### AC-05: Snapshot Freeze
```gherkin
GIVEN DRAFT snapshot with 82,103 lines
WHEN planner clicks Freeze
THEN snapshot.status = 'FROZEN'
  AND snapshot.frozen_at = current timestamp
  AND no further edits allowed (API returns 409 Conflict)
```

### AC-06: Override Flow
```gherkin
GIVEN DRAFT snapshot with line forecast_qty = 300
WHEN planner overrides to 500 with reason "Đơn hàng lớn Q2"
THEN demand_snapshot_line.reconciled_qty = 500
  AND demand_snapshot_line.forecast_qty = 300 (unchanged)
  AND demand_override_log has entry with old=300, new=500, reason
```

### AC-07: Demand Basis MAX_FORECAST_PO
```gherkin
GIVEN item X at location Y has forecast_qty = 200 and confirmed_po_qty = 350
  AND PO age = 45 days (< 90 day cutoff)
WHEN DRP queries demand basis
THEN gross_requirement = 350 (max of 200, 350)
```

### AC-08: Coverage Statistics
```gherkin
GIVEN 1,660 active FSKUs and 1,419 have forecast > 0
WHEN planner views coverage
THEN coverage gauge shows 85.5%
  AND segment A shows 100% coverage
```

### AC-09: Tết Flag Display
```gherkin
GIVEN rows with tet_flag = 'Y' for Jan-Mar 2026
WHEN displayed in Forecast Matrix
THEN these cells show a Tết badge/icon
  AND filter by tet_flag is available
```

### AC-10: Large File Performance
```gherkin
GIVEN CSV with 84,764 rows
WHEN uploaded and processed
THEN total processing time < 120 seconds
  AND memory usage < 512MB
  AND no timeout errors
```

---

> **Ghi chú cuối:**
> Module này là ENTRY POINT của toàn bộ SCP pipeline. Nếu forecast data không chính xác
> hoặc không đầy đủ, toàn bộ downstream (DRP, Allocation, Replenishment) sẽ bị ảnh hưởng.
> Cần đặc biệt chú ý validation và coverage tracking.
