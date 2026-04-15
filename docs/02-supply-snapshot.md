# Module Spec — Step 2: Supply Snapshot — Chụp tồn kho

> **Module ID:** SCP-UNIS-02
> **Version:** 1.1
> **Last Updated:** 2026-04-13
> **Owner:** R-BA (Requirements Business Analyst)
> **Status:** REVIEWED
> **Changelog v1.1:** Bỏ `tenant_id` (single-tenant), đổi `item_id BIGINT` → `item_code VARCHAR`, `location_id BIGINT` → `location_code VARCHAR` theo UNIS constraints (D-MD-01, D-MD-02, D-MD-03)

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ tất cả `tenant_id` trong SQL/Python — UNIS single-tenant (`D-MD-03`)
> - **Item PK:** `item_code VARCHAR FK → item.item_code`. Không dùng `item_id BIGINT` (`D-MD-01`)
> - **Location PK:** `location_code VARCHAR FK → location.location_code` (`D-MD-02`)
> - **API path:** Dùng `/api/v1/` prefix (`D-MD-04`)
> - **Schema ref:** Xem `00-master-data.md` — đặc biệt `lot_attribute` table definition

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

Trước khi tính kế hoạch phân phối, hệ thống cần biết **hiện tại đang có bao nhiêu hàng ở đâu**.
Module này "chụp ảnh" toàn bộ tồn kho tại tất cả nhà máy và chi nhánh vào một thời điểm cụ thể,
sau đó đóng băng để làm đầu vào cho DRP.

> **Tại sao không lấy số tồn kho real-time?** Bravo ERP của UNIS chỉ xuất data theo batch
> (thường 2:00 AM hàng đêm). Hệ thống chấp nhận data tối đa 4 tiếng tuổi — nếu cũ hơn
> sẽ cảnh báo Kế hoạch viên trước khi cho phép chạy DRP.

**Người dùng chính:** Kế hoạch viên (sc_planner)

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **Kế hoạch viên** | Upload file tồn kho từ Bravo, kiểm tra độ tươi data, freeze snapshot |
| **Thủ kho / Kế toán kho** | Xuất file tồn kho từ Bravo ERP (thao tác ngoài hệ thống SCP) |
| **SC Manager** | Xem tổng quan tồn kho toàn hệ thống |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là Kế hoạch viên**, tôi muốn **upload file tồn kho từ Bravo** để hệ thống biết số hàng hiện có | File được parse, mapping kho + mã hàng thành công, tạo snapshot với tổng số |
| US-02 | **Là Kế hoạch viên**, tôi muốn **kiểm tra độ tươi data** (data mới nhất từ khi nào) trước khi chạy DRP | Hệ thống hiện "Data cập nhật lúc 02:15 - 3.5 tiếng trước" — màu xanh nếu < 4 tiếng |
| US-03 | **Là Kế hoạch viên**, tôi muốn **xem tồn kho theo item × kho** để phát hiện kho nào đang thiếu/thừa | Bảng hiển thị allocatable_qty, reserved_qty, in_transit_qty per item × location |
| US-04 | **Là Kế hoạch viên**, tôi muốn **freeze snapshot** để DRP dùng bộ số tồn kho này | Snapshot FROZEN, DRP được phép đọc |
| US-05 | **Là Kế hoạch viên**, tôi muốn **xác nhận tiếp tục kể cả khi data hơi cũ** (STALE) nếu không có lựa chọn khác | Hệ thống cho phép override STALE với lý do xác nhận — ghi log |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Data Bravo mới, upload bình thường (Happy Path)

```
1. 2:30 AM: Bravo export xong → Kế hoạch viên có file "TonKho_13042026.xlsx"
2. Upload vào SCP → parse 4,830 dòng (tồn kho per lot × kho)
3. Hệ thống kiểm tra: "Data mới nhất: 02:15 (3.5 tiếng trước) — PASS ✅"
4. Kế hoạch viên xem bảng tồn kho, không thấy bất thường
5. Bấm "Freeze" → sẵn sàng cho DRP
```

#### ❌ Kịch bản 2 — Data Bravo quá cũ (Sad Path)

```
1. Kế hoạch viên upload → hệ thống kiểm tra: "Data cũ nhất: 18 tiếng trước — STALE ⚠️"
2. Hệ thống hiện cảnh báo đỏ: "Tồn kho tại WH-HN-001 chưa cập nhật từ hôm qua"
3. Kế hoạch viên có 2 lựa chọn:
   (a) Liên hệ Bravo admin → xuất lại file mới → upload lại
   (b) Chấp nhận STALE: nhập lý do "Hệ thống Bravo bảo trì" → freeze với flag STALE
4. DRP chạy được nhưng kết quả có tag "⚠️ Tồn kho có thể không chính xác"
```

#### ⚠️ Kịch bản 3 — Mã kho không khớp (Sad Path)

```
1. Upload file → hệ thống map mã kho: "WH-HN-01" không tìm thấy trong master data
2. Cảnh báo: "3 mã kho không nhận ra: WH-HN-01, WH-DN-02, NM-001"
3. Kế hoạch viên kiểm tra: Bravo đổi mã kho tháng này
4. IT admin cập nhật mapping trong master data → upload lại
```

---

### 0.4 Thuật ngữ

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **Tồn kho khả dụng (Allocatable)** | Hàng có thể dùng cho đơn mới = Tồn thực tế − Đã đặt trước |
| **Tồn đặt trước (Reserved)** | Hàng đã cam kết cho đơn hàng confirmed, chưa xuất kho |
| **Hàng đang vận chuyển (In-transit)** | Hàng rời kho nguồn nhưng chưa đến kho đích |
| **Data STALE** | Data tồn kho quá cũ (> 4 tiếng) — vẫn dùng được nhưng có rủi ro |
| **Snapshot FROZEN** | Bản chụp tồn kho đã khóa — DRP mới được phép dùng |
| **OEM / DISTRIBUTION** | OEM: hàng sản xuất riêng cho UNIS (chắc chắn hơn). Distribution: chia sẻ với khách khác (có thể bị điều chỉnh) |

---

## 1. Mục đích (Purpose)

Capture snapshot tồn kho tại thời điểm nhất định — bao gồm TẤT CẢ nhà máy (NM) và
chi nhánh (CN) trong hệ thống UNIS.

Dữ liệu tồn kho là **input quan trọng nhất cho DRP netting** (Step 4):
- Tồn kho = beginning inventory (PAB week 0)
- Không có tồn kho chính xác → DRP tính sai net requirements → over/under stock

**Nguyên tắc cốt lõi:** Snapshot phải phản ánh tồn kho THỰC TẾ tại thời điểm capture.
Nếu dữ liệu quá cũ (STALE) → planner phải xử lý trước khi chạy DRP.

---

## 2. UNIS Context (Đặc thù UNIS)

### 2.1. Hệ thống hiện tại
- UNIS dùng **Bravo ERP** quản lý kho
- Bravo KHÔNG có API real-time → chỉ export Excel/CSV batch
- Tồn kho sync từ Bravo → SCP theo batch mode (thường nightly)
- Độ trễ data: 4-24 giờ tùy thời điểm

### 2.2. So sánh với MDLZ benchmark

| Config | UNIS | MDLZ | Ghi chú |
|--------|------|------|---------|
| Freshness threshold | **240 min** | 60 min | UNIS chấp nhận data cũ hơn |
| Sync mode | BATCH | REAL_TIME | Bravo limitation |
| Sync frequency | Nightly | Every 15 min | |
| Bucket types | 2 (ALLOCATABLE + RESERVED) | 4 | Đơn giản hơn |
| QUARANTINE | OFF | ON | UNIS không track quarantine riêng |
| SOFT_RESERVED | OFF | ON | UNIS không dùng soft reserve |

### 2.3. Cấu trúc kho UNIS
- **Nhà máy (NM):** 5-8 NM sản xuất, mỗi NM có kho thành phẩm
- **Chi nhánh (CN):** 69 CN bán hàng trực tiếp
- **Kho trung chuyển:** 2-3 hub (HCM, HN, ĐN)

### 2.4. Loại inventory theo nguồn gốc

| Loại | Mô tả | Confidence | Flag |
|------|--------|------------|------|
| **OEM** | NM sản xuất riêng cho UNIS | HIGH | `is_estimated = false` |
| **DISTRIBUTION** | NM sản xuất chung, chia cho nhiều khách | LOWER | `is_estimated = true` |

Distribution inventory có thể bị điều chỉnh bởi NM bất kỳ lúc nào →
SCP cần flag `is_estimated` để planner biết data ít tin cậy hơn.

---

## 3. Dữ liệu đầu vào (Input Data)

### 3.1. Source: lot_attribute table (SCP internal)

| Column | Type | Mô tả |
|--------|------|--------|
| `item_code` | VARCHAR(100) FK | → item.item_code |
| `location_code` | VARCHAR(50) FK | → location.location_code |
| `lot_number` | VARCHAR(50) | Mã lô hàng |
| `on_hand_qty` | DECIMAL(15,2) | Tồn kho thực tế (physical) |
| `reserved_qty` | DECIMAL(15,2) | Đã đặt trước cho đơn hàng |
| `quarantine_qty` | DECIMAL(15,2) | Hàng cách ly (UNIS: luôn = 0) |
| `in_transit_qty` | DECIMAL(15,2) | Đang vận chuyển (chưa nhập kho) |
| `quality_status` | ENUM | ALLOCATABLE / HOLD / REJECTED |
| `expiry_date` | DATE | Ngày hết hạn (nếu có) |
| `last_sync_at` | TIMESTAMP | Thời điểm sync gần nhất từ Bravo |
| `source_type` | VARCHAR(20) | OEM / DISTRIBUTION |

### 3.2. Source: Bravo ERP Export (Excel/CSV)

File tồn kho export từ Bravo chứa:

| Column | Mô tả |
|--------|--------|
| `ma_kho` | Mã kho (map → location.code) |
| `ma_hang` | Mã hàng (map → item.canonical_id) |
| `ton_thuc_te` | Tồn kho thực tế |
| `da_dat` | Đã đặt hàng (reserved) |
| `dang_van_chuyen` | Đang vận chuyển |
| `ngay_xuat` | Ngày export file |

### 3.3. Freshness Config

```yaml
unis_supply_config:
  freshness_threshold_minutes: 240    # 4 giờ
  sync_mode: BATCH
  sync_schedule: "0 2 * * *"          # 2:00 AM daily
  stale_action: WARN                   # WARN / BLOCK
  bucket_types:
    - ALLOCATABLE                      # on_hand - reserved
    - RESERVED                         # reserved_qty
  quarantine_enabled: false
  soft_reserved_enabled: false
```

---

## 4. Logic xử lý (Processing Logic)

### 4.1. Snapshot Creation Flow

```
[Trigger] → [Query lot_attribute] → [Aggregate] → [Check Freshness] → [Create Snapshot] → [Freeze]
```

### 4.2. Step-by-step Processing

**Step 4.2.1: Trigger**
Snapshot có thể được trigger bởi:
- **Manual:** Planner click "Capture Snapshot" trên UI
- **Automatic:** Trước khi DRP run (Step 4 auto-trigger nếu chưa có snapshot mới)
- **Scheduled:** Sau mỗi Bravo sync (2:00 AM + 30 min buffer = 2:30 AM)

**Step 4.2.2: Query Inventory Data**
```sql
SELECT
    la.item_code,
    la.location_code,
    SUM(la.on_hand_qty) AS total_on_hand,
    SUM(la.reserved_qty) AS total_reserved,
    SUM(la.quarantine_qty) AS total_quarantine,
    SUM(la.in_transit_qty) AS total_in_transit,
    MIN(la.last_sync_at) AS oldest_sync,
    MAX(la.last_sync_at) AS newest_sync,
    BOOL_OR(la.source_type = 'DISTRIBUTION') AS has_estimated
FROM lot_attribute la
WHERE la.quality_status = 'ALLOCATABLE'
GROUP BY la.item_code, la.location_code
```

**Lưu ý:** Chỉ lấy `quality_status = 'ALLOCATABLE'`. HOLD và REJECTED không tham gia DRP.

**Step 4.2.3: Aggregate per Item × Location**
```python
for row in query_results:
    allocatable_qty = row.total_on_hand - row.total_reserved
    reserved_qty = row.total_reserved
    quarantine_qty = 0          # UNIS: always 0
    in_transit_qty = row.total_in_transit
    is_estimated = row.has_estimated
```

**Business logic:**
- `allocatable_qty` = hàng có thể dùng cho DRP (on_hand - reserved)
- `reserved_qty` = hàng đã commit cho đơn hàng cụ thể
- `in_transit_qty` = hàng đang vận chuyển, có thể tính vào scheduled receipts

**Step 4.2.4: Check Freshness**
```python
def check_freshness(oldest_sync_at, threshold_minutes=240):
    """
    Kiểm tra data có đủ mới không.
    UNIS threshold = 240 min (4 giờ).
    """
    age_minutes = (now() - oldest_sync_at).total_minutes()

    if age_minutes <= threshold_minutes:
        return 'PASS', age_minutes
    else:
        return 'STALE', age_minutes
```

**Khi STALE:**
- Snapshot vẫn tạo được nhưng đánh dấu `freshness = STALE`
- Warning hiển thị trên UI: "Dữ liệu tồn kho cũ {X} phút. Khuyến nghị re-sync."
- Planner PHẢI xác nhận (acknowledge) trước khi DRP chạy với data STALE
- Config `stale_action = WARN` (không block, chỉ cảnh báo)

**Step 4.2.5: Create Supply Snapshot**
```sql
INSERT INTO supply_snapshot (
    snapshot_name, status, freshness,
    freshness_age_minutes, total_lines, total_items,
    total_locations, total_allocatable_qty,
    total_reserved_qty, total_in_transit_qty,
    capture_at, created_by, created_at
) VALUES (
    :name, 'DRAFT', :freshness_status,
    :age_minutes, :line_count, :item_count,
    :location_count, :sum_allocatable,
    :sum_reserved, :sum_in_transit,
    NOW(), :user_id, NOW()
)
```

**Step 4.2.6: Create Snapshot Lines**
```sql
INSERT INTO supply_snapshot_line (
    snapshot_id, item_code, location_code,
    allocatable_qty, reserved_qty, quarantine_qty,
    in_transit_qty, is_estimated,
    oldest_sync_at, freshness
) VALUES (...)
-- Batch insert per item × location
```

**Step 4.2.7: Freeze Snapshot**
- Planner reviews → confirms → freeze
- `UPDATE supply_snapshot SET status='FROZEN', frozen_at=NOW()`
- Hoặc auto-freeze nếu triggered by DRP run (no manual review)

### 4.3. Bravo Import Flow

```
[Bravo Export Excel] → [Planner uploads] → [Parse] → [Map IDs] → [Upsert lot_attribute] → [Trigger Snapshot]
```

**Mapping:**
- `ma_kho` → `location.location_code`
- `ma_hang` → `item.item_code`

**Upsert logic:**
```sql
INSERT INTO lot_attribute (item_code, location_code, lot_number, on_hand_qty, reserved_qty, in_transit_qty, last_sync_at)
VALUES (:item_code, :loc_code, 'BRAVO', :on_hand, :reserved, :transit, NOW())
ON CONFLICT (item_code, location_code, lot_number)
DO UPDATE SET
    on_hand_qty = EXCLUDED.on_hand_qty,
    reserved_qty = EXCLUDED.reserved_qty,
    in_transit_qty = EXCLUDED.in_transit_qty,
    last_sync_at = NOW()
```

### 4.4. Stale Override Flow
```python
def handle_stale_snapshot(snapshot_id, planner_action):
    """
    Khi snapshot STALE, planner có 3 lựa chọn:
    """
    if planner_action == 'ACKNOWLEDGE':
        # Chấp nhận data cũ → proceed
        mark_acknowledged(snapshot_id)
        return allow_drp_run()

    elif planner_action == 'RE_CAPTURE':
        # Trigger Bravo re-sync + new snapshot
        trigger_bravo_sync()
        wait_for_sync()
        return create_new_snapshot()

    elif planner_action == 'MANUAL_OVERRIDE':
        # Planner tự nhập tồn kho
        return open_override_dialog()
```

---

## 5. Dữ liệu đầu ra (Output Data)

### 5.1. supply_snapshot

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | Auto-increment |
| `snapshot_name` | VARCHAR(200) | Tên snapshot |
| `status` | ENUM | DRAFT / FROZEN / ARCHIVED |
| `freshness` | ENUM | PASS / STALE |
| `freshness_age_minutes` | INT | Tuổi data tính bằng phút |
| `total_lines` | INT | Tổng số dòng |
| `total_items` | INT | Số items unique |
| `total_locations` | INT | Số locations unique |
| `total_allocatable_qty` | DECIMAL(18,2) | Tổng tồn khả dụng |
| `total_reserved_qty` | DECIMAL(18,2) | Tổng đã đặt |
| `total_in_transit_qty` | DECIMAL(18,2) | Tổng đang vận chuyển |
| `stale_acknowledged` | BOOLEAN | Planner đã xác nhận STALE |
| `stale_acknowledged_by` | BIGINT FK | User xác nhận |
| `capture_at` | TIMESTAMP | Thời điểm capture |
| `frozen_at` | TIMESTAMP | Thời điểm freeze |
| `frozen_by` | BIGINT FK | User freeze |
| `created_by` | BIGINT FK | User tạo |
| `created_at` | TIMESTAMP | Thời điểm tạo |

### 5.2. supply_snapshot_line

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | Auto-increment |
| `snapshot_id` | BIGINT FK | → supply_snapshot |
| `item_code` | VARCHAR(100) FK | → item.item_code |
| `location_code` | VARCHAR(50) FK | → location.location_code |
| `allocatable_qty` | DECIMAL(15,2) | on_hand - reserved |
| `reserved_qty` | DECIMAL(15,2) | Đã đặt trước |
| `quarantine_qty` | DECIMAL(15,2) | Cách ly (UNIS: 0) |
| `in_transit_qty` | DECIMAL(15,2) | Đang vận chuyển |
| `is_estimated` | BOOLEAN | True nếu DISTRIBUTION source |
| `oldest_sync_at` | TIMESTAMP | Sync cũ nhất cho item×loc |
| `freshness` | ENUM | PASS / STALE (line-level) |
| `override_qty` | DECIMAL(15,2) | Planner manual override (nullable) |
| `override_reason` | TEXT | Lý do override |
| `override_by` | BIGINT FK | User override |

**Composite Unique:** (snapshot_id, item_code, location_code)

---

## 6. API Endpoints

### 6.1. POST /api/v1/supply/snapshot/capture

**Mô tả:** Trigger snapshot capture từ lot_attribute data hiện tại

**Request:**
```json
{
  "snapshot_name": "Tồn kho 11/04/2026",
  "include_in_transit": true,
  "auto_freeze": false
}
```

**Response (201):**
```json
{
  "snapshot_id": 15,
  "status": "DRAFT",
  "freshness": "PASS",
  "freshness_age_minutes": 180,
  "total_lines": 4830,
  "total_items": 1419,
  "total_locations": 74,
  "total_allocatable_qty": 2850000,
  "estimated_lines_count": 320,
  "capture_duration_ms": 3500
}
```

### 6.2. GET /api/v1/supply/snapshot/{id}

**Mô tả:** Get snapshot detail

**Response:**
```json
{
  "id": 15,
  "snapshot_name": "Tồn kho 11/04/2026",
  "status": "FROZEN",
  "freshness": "PASS",
  "freshness_age_minutes": 180,
  "total_lines": 4830,
  "total_allocatable_qty": 2850000,
  "total_reserved_qty": 450000,
  "total_in_transit_qty": 320000,
  "capture_at": "2026-04-11T08:00:00Z",
  "frozen_at": "2026-04-11T08:05:00Z"
}
```

### 6.3. GET /api/v1/supply/snapshot/{id}/lines

**Mô tả:** Get snapshot lines with filtering

**Query params:**
- `item_code` / `location_code` (optional filter)
- `is_estimated` (optional: true/false)
- `freshness` (optional: PASS/STALE)
- `min_qty` / `max_qty` (optional range filter)
- `page`, `page_size`

### 6.4. POST /api/v1/supply/snapshot/{id}/freeze

**Mô tả:** Freeze snapshot

**Preconditions:**
- Status = DRAFT
- If freshness = STALE → phải acknowledge trước

### 6.5. POST /api/v1/supply/snapshot/{id}/acknowledge-stale

**Mô tả:** Planner xác nhận chấp nhận data STALE

**Request:**
```json
{
  "reason": "Bravo đang maintenance, data 6 giờ trước vẫn acceptable"
}
```

### 6.6. POST /api/v1/supply/snapshot/{id}/lines/{line_id}/override

**Mô tả:** Planner override tồn kho cho 1 line

**Request:**
```json
{
  "override_qty": 500,
  "reason": "Kiểm kho thực tế sáng nay = 500, Bravo chưa cập nhật"
}
```

### 6.7. POST /api/v1/supply/bravo/upload

**Mô tả:** Upload Bravo inventory export file

**Request:**
```
Content-Type: multipart/form-data
file: <Excel/CSV file from Bravo>
```

**Response (200):**
```json
{
  "rows_parsed": 5200,
  "rows_updated": 4900,
  "rows_inserted": 280,
  "rows_skipped": 20,
  "unmapped_items": ["MA-HANG-999", "MA-HANG-888"],
  "unmapped_locations": [],
  "sync_timestamp": "2026-04-11T02:30:00Z"
}
```

### 6.8. GET /api/v1/supply/freshness/status

**Mô tả:** Check freshness status của lot_attribute data

**Response:**
```json
{
  "overall_freshness": "PASS",
  "oldest_sync": "2026-04-11T02:00:00Z",
  "newest_sync": "2026-04-11T02:15:00Z",
  "age_minutes": 180,
  "threshold_minutes": 240,
  "stale_locations": [],
  "next_scheduled_sync": "2026-04-12T02:00:00Z"
}
```

---

## 7. Business Rules (UNIS-specific)

### BR-01: Freshness Threshold = 240 phút
- Data tồn kho cũ hơn 240 phút (4 giờ) → đánh dấu STALE
- So sánh: MDLZ = 60 phút (WMS real-time), UNIS = 240 phút (Bravo batch)
- Lý do: Bravo ERP sync nightly → data luôn có delay vài giờ
- Future: nếu UNIS nâng cấp WMS → giảm threshold

> **Lưu ý:** SCP system có 2 loại freshness check:
> 1. **Freshness Gate** (pre-pipeline, SCP default = 60 min): WMS/ERP data sync kiểm tra trước khi pipeline chạy
> 2. **Supply Snapshot Freshness** (UNIS = 240 min): Bravo batch data kiểm tra trước DRP
>
> UNIS override Freshness Gate lên 240 min vì Bravo batch mode (không real-time WMS sync).
> Config: `UNISSupplyPlugin.freshness_threshold_minutes() = 240`

### BR-02: 2 Bucket Types Only
- **ALLOCATABLE:** `on_hand_qty - reserved_qty` — hàng sẵn sàng cho DRP
- **RESERVED:** `reserved_qty` — hàng đã commit cho đơn hàng confirmed
- **QUARANTINE = OFF:** UNIS không track quarantine riêng trong SCP
- **SOFT_RESERVED = OFF:** UNIS không dùng soft reservation
- Đơn giản hơn MDLZ (4 buckets) → giảm complexity nhưng giảm visibility

> **SCP Schema:** `supply_snapshot_line` table có 6 qty columns hỗ trợ 4 bucket types:
> - `allocatable_qty` → ALLOCATABLE (available for DRP/allocation)
> - `reserved_qty` → RESERVED (đã commit cho orders)
> - `quarantine_qty` → QUARANTINE (quality hold)
> - `soft_reserved_qty` → SOFT_RESERVED (tentative reservation)
> - `in_transit_qty` → IN_TRANSIT (pipeline stock)
> - `scheduled_receipt_qty` → SCHEDULED (expected receipts)
>
> **UNIS Phase 1:** Chỉ dùng ALLOCATABLE + RESERVED.
> QUARANTINE=0, SOFT_RESERVED=0 (fields populated but always zero).
> Phase 2: enable quarantine tracking khi UNIS implement quality control process.

### BR-03: OEM vs DISTRIBUTION Confidence
- **OEM inventory** (NM sản xuất riêng cho UNIS):
  - `is_estimated = false`
  - High confidence — số liệu chính xác
  - NM report trực tiếp cho UNIS
- **DISTRIBUTION inventory** (NM sản xuất chung):
  - `is_estimated = true`
  - Lower confidence — NM có thể reallocate bất kỳ lúc nào
  - Planner cần review kỹ trước DRP
  - UI hiển thị icon cảnh báo cho estimated lines

### BR-04: STALE Handling — Mandatory Action
- Khi snapshot `freshness = STALE`:
  - DRP (Step 4) KHÔNG TỰ ĐỘNG chạy
  - Planner PHẢI chọn 1 trong 3:
    1. **Acknowledge:** chấp nhận → DRP chạy với data cũ
    2. **Re-capture:** trigger Bravo re-sync → new snapshot
    3. **Manual override:** planner tự nhập tồn kho
  - Action được log vào `stale_action_log` (audit trail)

### BR-05: In-Transit Handling
- `in_transit_qty` = hàng đang vận chuyển từ NM → CN
- Trong DRP: in-transit → scheduled_receipts (nếu có ETA)
- Nếu KHÔNG có ETA → in-transit KHÔNG tham gia DRP
- UNIS hiện tại: in-transit tracking = LIMITED (Bravo thiếu data vận chuyển chi tiết)

### BR-06: Zero Inventory Lines
- Item × location có `allocatable_qty = 0` VẪN tạo snapshot line
- Mục đích: DRP cần biết "không có tồn kho" vs "không có data"
- Chỉ skip khi item không tồn tại trong lot_attribute

### BR-07: Snapshot Retention
- Giữ tối đa 30 snapshots gần nhất
- Snapshots cũ hơn 90 ngày → auto archive
- Archived snapshots: read-only, không dùng cho DRP

---

## 8. Cross-Module References

### 8.1. OUTPUT → Step 4 (DRP Netting)
```
supply_snapshot_line.allocatable_qty → PAB(week 0) = beginning inventory
supply_snapshot_line.in_transit_qty → scheduled_receipts (nếu có ETA)

DRP query:
SELECT
    ssl.allocatable_qty AS beginning_inventory,
    ssl.in_transit_qty AS pipeline_stock,
    ssl.is_estimated
FROM supply_snapshot_line ssl
WHERE ssl.snapshot_id = :frozen_supply_snapshot_id
  AND ssl.item_code = :item_code
  AND ssl.location_code = :location_code
```

**Lưu ý:** Nếu `is_estimated = true` → DRP vẫn chạy nhưng flag
planned orders là `confidence = LOW`.

### 8.2. OUTPUT → Step 5 (Allocation)
```
lot_attribute (live data) → available lots cho allocation
supply_snapshot_line → reference cho allocation baseline

Allocation dùng lot_attribute TRỰC TIẾP (real-time-ish),
KHÔNG dùng snapshot (snapshot = point-in-time cho DRP).
```

### 8.3. INPUT from Bravo ERP
```
Nightly batch upload:
  Bravo export (2:00 AM) → file server → SCP import job (2:30 AM)
  → upsert lot_attribute → auto-trigger snapshot capture (2:45 AM)

Manual upload:
  Planner download Bravo export → upload qua UI → same processing
```

### 8.4. OUTPUT → Step 8 (Monitor)
```
supply_snapshot_line.allocatable_qty → inventory level monitoring
Khi allocatable_qty < safety_stock → STOCKOUT alert
Khi allocatable_qty > 3× forecast demand → OVERSTOCK alert
```

---

## 9. Giao diện người dùng (UI Requirements)

### 9.1. Snapshot Dashboard
- **Summary cards:**
  - Tổng tồn kho allocatable (số lớn + trend arrow)
  - Tổng reserved
  - Tổng in-transit
  - Freshness status badge (PASS = green, STALE = red)
  - Freshness age: "Data cập nhật {X} phút trước"

### 9.2. Snapshot List Table

| Column | Mô tả |
|--------|--------|
| Name | Tên snapshot |
| Status | DRAFT / FROZEN / ARCHIVED (badge) |
| Freshness | PASS / STALE (badge) |
| Lines | Số dòng |
| Items | Số items |
| Locations | Số locations |
| Allocatable Qty | Tổng |
| Estimated Lines | Số lines có is_estimated = true |
| Captured At | Thời điểm capture |
| Frozen At | Thời điểm freeze |
| Actions | Freeze / Archive / View Details |

### 9.3. Snapshot Detail View
- **Inventory matrix:** rows = items, columns = locations
- **Cell value:** allocatable_qty
- **Cell color:**
  - Xanh: qty > safety stock
  - Vàng: qty > 0 nhưng < safety stock
  - Đỏ: qty = 0
  - Viền nét đứt: `is_estimated = true` (estimated data)
- **Filters:** location type (NM/CN/HUB), is_estimated, freshness

### 9.4. Stale Warning Banner
- Khi freshness = STALE → banner đỏ ở top:
  ```
  ⚠ Dữ liệu tồn kho cũ {X} phút (threshold: 240 phút).
  [Acknowledge] [Re-capture] [Manual Override]
  ```
- Banner không ẩn được — phải action

### 9.5. Bravo Upload Screen
1. Upload button (Excel/CSV)
2. Preview: hiển thị mapped vs unmapped items/locations
3. Confirm import
4. Result summary: updated / inserted / skipped / errors

### 9.6. Line Override Dialog
- Trigger: click line trong detail view
- Fields:
  - Current allocatable_qty (read-only)
  - Override qty (input)
  - Reason (required textarea)
- Save → update override_qty on line

### 9.7. Freshness Monitor Widget
- Mini widget on sidebar / header
- Shows: "Bravo sync: {time} ago"
- Color: green (< 240 min), yellow (200-240 min), red (> 240 min)
- Click → link to freshness status API detail

---

## 10. Acceptance Criteria

### AC-01: Snapshot Capture — Happy Path
```gherkin
GIVEN lot_attribute has data for 1,419 items × 74 locations
  AND last_sync_at = 180 minutes ago (< 240 threshold)
WHEN planner triggers snapshot capture
THEN supply_snapshot is created with status = DRAFT
  AND freshness = PASS
  AND total_lines = 4,830 (item × location combinations with data)
  AND capture_duration < 10 seconds
```

### AC-02: Freshness Check — STALE
```gherkin
GIVEN lot_attribute.last_sync_at = 300 minutes ago (> 240 threshold)
WHEN snapshot is captured
THEN supply_snapshot.freshness = STALE
  AND freshness_age_minutes = 300
  AND UI shows stale warning banner
```

### AC-03: STALE Acknowledge
```gherkin
GIVEN supply_snapshot with freshness = STALE
WHEN planner clicks Acknowledge with reason "Bravo maintenance"
THEN stale_acknowledged = true
  AND DRP can proceed with this snapshot
  AND action is logged with user + reason + timestamp
```

### AC-04: Allocatable Calculation
```gherkin
GIVEN item X at location Y has on_hand_qty = 1000 and reserved_qty = 300
WHEN snapshot captures this item × location
THEN supply_snapshot_line.allocatable_qty = 700
  AND supply_snapshot_line.reserved_qty = 300
```

### AC-05: Estimated Flag
```gherkin
GIVEN item X has lot from DISTRIBUTION source
WHEN snapshot captures this item
THEN supply_snapshot_line.is_estimated = true
  AND UI shows estimated icon on this line
```

### AC-06: Bravo Upload
```gherkin
GIVEN Bravo export Excel with 5,200 rows
WHEN planner uploads file
THEN lot_attribute is updated (upsert)
  AND unmapped items are reported
  AND last_sync_at is updated to NOW()
  AND new snapshot can be captured with fresh data
```

### AC-07: Zero Inventory Included
```gherkin
GIVEN item X at location Y has on_hand_qty = 0 and reserved_qty = 0
WHEN snapshot captures
THEN a snapshot line IS created with allocatable_qty = 0
  AND DRP knows this location has zero stock (vs no data)
```

### AC-08: Freeze Snapshot
```gherkin
GIVEN DRAFT snapshot with freshness = PASS
WHEN planner freezes snapshot
THEN status = FROZEN, frozen_at set
  AND no further modifications allowed
```

### AC-09: STALE Block DRP
```gherkin
GIVEN FROZEN snapshot with freshness = STALE and stale_acknowledged = false
WHEN DRP (Step 4) attempts to use this snapshot
THEN DRP returns error "Supply snapshot STALE - acknowledge required"
  AND DRP does NOT run
```

### AC-10: Line Override
```gherkin
GIVEN snapshot line with allocatable_qty = 500
WHEN planner overrides to 800 with reason "Kiểm kho thực tế"
THEN override_qty = 800
  AND DRP uses COALESCE(override_qty, allocatable_qty) = 800
  AND override is logged with user + reason
```

### AC-11: Bravo Nightly Sync
```gherkin
GIVEN scheduled sync at 2:00 AM
WHEN Bravo export is available
THEN SCP auto-imports at 2:30 AM
  AND auto-captures snapshot at 2:45 AM
  AND snapshot freshness = PASS (age < 60 min)
```

### AC-12: Snapshot Retention
```gherkin
GIVEN 35 snapshots exist
WHEN retention job runs
THEN oldest 5 snapshots are archived
  AND archived snapshots are read-only
```

---

> **Ghi chú cuối:**
> Supply Snapshot là "bức ảnh tồn kho" tại thời điểm nhất định. Chất lượng DRP
> phụ thuộc trực tiếp vào độ chính xác của snapshot. Với UNIS dùng Bravo batch mode,
> freshness luôn là concern lớn nhất — planner cần được train để hiểu impact
> của data STALE lên DRP output.
