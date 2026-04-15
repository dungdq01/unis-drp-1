# MODULE 2 — Supply Snapshot & Inventory Ingestion
## Business Analysis Report

**Project**: UNIS Supply Chain Planning System (SCP)  
**Module**: Module 2 — Supply Snapshot & Bravo Inventory Ingestion  
**Status**: ✅ DONE — Ready to hand off to Module 3  
**Last updated**: 2026-04-14  
**Audience**: Developer, BA, Product Manager, QA  

---

## 1. MỤC TIÊU MODULE

Module 2 giải quyết bài toán:

> **"Làm thế nào để Planner biết tồn kho thực tế tại từng chi nhánh / nhà máy là bao nhiêu, và số liệu đó có còn đáng tin không?"**

Cụ thể:
- **Ingestion**: Nhận file Excel từ Bravo ERP (batch export nightly) → parse, validate, upsert vào `lot_attribute`
- **Snapshot**: Tổng hợp `lot_attribute` theo item × location → tạo `supply_snapshot` để lưu trạng thái tồn kho tại 1 thời điểm
- **Freshness Gate**: Kiểm tra độ tươi của dữ liệu — nếu > 240 phút (UNIS Bravo batch threshold) → STALE, phải acknowledge trước khi freeze
- **Lifecycle**: DRAFT → FROZEN (cho DRP dùng) với STALE gate chặn nếu chưa xác nhận
- **Override**: Planner có thể điều chỉnh thủ công qty tại 1 line cụ thể (DRAFT hoặc FROZEN đều được)

---

## 2. KIẾN TRÚC TỔNG QUAN

```
┌────────────────────────────────────────────────────────────┐
│  Frontend — Next.js 14 (/app/supply/page.tsx)              │
│                                                            │
│  Tab 1: Snapshot Overview     Tab 2: Inventory Detail      │
└────────────────────┬───────────────────────────────────────┘
                     │ REST API (JSON)
┌────────────────────▼───────────────────────────────────────┐
│  Backend — NestJS                                          │
│  ├── SupplyController    /supply/*                         │
│  └── BravoController     /supply/bravo/*                   │
└────────────────────┬───────────────────────────────────────┘
                     │ TypeORM / raw SQL
┌────────────────────▼───────────────────────────────────────┐
│  PostgreSQL                                                │
│  ├── lot_attribute          Raw inventory từ Bravo         │
│  ├── supply_snapshot        Snapshot header (DRAFT/FROZEN) │
│  └── supply_snapshot_line   Aggregated per item × location │
└────────────────────────────────────────────────────────────┘
```

**Data Flow chính**:
```
[Bravo ERP Excel]
     │ POST /supply/bravo/upload
     ▼
[lot_attribute]  ← upsert, ON CONFLICT (item, location, lot)
     │ POST /supply/snapshots  (trigger capture)
     ▼
[supply_snapshot_line]  ← aggregate: SUM(on_hand) - SUM(reserved) per item × location
     │ PATCH /supply/snapshots/:id/freeze
     ▼
[supply_snapshot FROZEN]  ← Module 4 DRP đọc từ đây
```

**Freshness Rule (UNIS đặc thù)**:
- UNIS dùng Bravo ERP batch mode — sync chạy ban đêm, không real-time
- Threshold: **240 phút** (4 giờ) — nếu `last_sync_at` cũ hơn 240 phút → STALE
- SCP default là 60 phút (cho WMS real-time) → UNIS override lên 240 phút
- STALE không block capture, nhưng block freeze cho đến khi Planner acknowledge

---

## 3. DATABASE SCHEMA

### 3.1 `lot_attribute` — Raw Inventory từ Bravo

Mỗi dòng = 1 lot cụ thể của 1 SKU tại 1 địa điểm. Đây là bảng nguồn gốc — không có FK về master data (validate ở app layer).

| Column | Type | Mô tả |
|---|---|---|
| `id` | BIGSERIAL (PK) | Auto ID |
| `item_code` | VARCHAR(50) | Mã SKU — phải khớp `item.item_code` |
| `location_code` | VARCHAR(20) | Mã kho/chi nhánh — phải khớp `location.location_code` |
| `lot_number` | VARCHAR(50) | Số lot, mặc định `'BRAVO'` khi upload từ Bravo |
| `on_hand_qty` | DECIMAL(15,2) | Tồn thực tế trong kho |
| `reserved_qty` | DECIMAL(15,2) | Đã cam kết / đã đặt, chưa xuất |
| `quarantine_qty` | DECIMAL(15,2) | Đang kiểm tra chất lượng, tạm giữ |
| `in_transit_qty` | DECIMAL(15,2) | Hàng đang trên đường vận chuyển |
| `quality_status` | VARCHAR(20) | `ALLOCATABLE` / `HOLD` / `REJECTED` |
| `source_type` | VARCHAR(20) | `OEM` (chắc chắn) / `DISTRIBUTION` (ước tính) |
| `last_sync_at` | TIMESTAMP | Thời điểm Bravo cập nhật record này |
| `created_at` | TIMESTAMP | Auto |
| `updated_at` | TIMESTAMP | Auto |

**Unique constraint**: `(item_code, location_code, lot_number)` — upsert an toàn khi Bravo upload lại.

**Lưu ý quan trọng**:
- `allocatable_qty = GREATEST(0, on_hand_qty - reserved_qty)` — tính khi capture, không lưu ở đây
- `quality_status = 'ALLOCATABLE'` → DRP mới tính. HOLD/REJECTED → bỏ qua
- Không có FK ràng buộc → bravo.service.ts validate item_code và location_code trước khi insert

---

### 3.2 `supply_snapshot` — Snapshot Header

Mỗi lần capture tạo ra 1 snapshot. Snapshot là "ảnh chụp tồn kho" tại 1 thời điểm để planning.

| Column | Type | Mô tả |
|---|---|---|
| `id` | BIGSERIAL (PK) | ID snapshot (BIGINT, không phải UUID như Module 1) |
| `snapshot_name` | VARCHAR(200) | Tên do user đặt hoặc auto-generate |
| `status` | VARCHAR(20) | `DRAFT` → `FROZEN` → `ARCHIVED` |
| `freshness` | VARCHAR(10) | `PASS` / `STALE` — tính từ oldest `last_sync_at` |
| `freshness_age_minutes` | INT | Tuổi dữ liệu tính bằng phút tại thời điểm capture |
| `total_lines` | INT | Tổng số dòng item × location |
| `total_items` | INT | Số SKU phân biệt |
| `total_locations` | INT | Số địa điểm phân biệt |
| `total_allocatable_qty` | DECIMAL(18,2) | Tổng qty có thể phân bổ |
| `total_reserved_qty` | DECIMAL(18,2) | Tổng qty đã cam kết |
| `total_in_transit_qty` | DECIMAL(18,2) | Tổng qty đang trên đường |
| `estimated_lines_count` | INT | Số dòng có `is_estimated = TRUE` (DISTRIBUTION source) |
| `stale_acknowledged` | BOOLEAN | Planner đã xác nhận STALE chưa |
| `stale_acknowledged_by` | VARCHAR(100) | Ai xác nhận |
| `stale_acknowledged_at` | TIMESTAMP | Khi nào xác nhận |
| `stale_reason` | TEXT | Lý do chấp nhận STALE |
| `capture_at` | TIMESTAMP | Thời điểm chạy aggregate |
| `frozen_at` | TIMESTAMP | Thời điểm freeze |
| `frozen_by` | VARCHAR(100) | Ai freeze |
| `created_by` | VARCHAR(100) | Ai trigger capture |
| `created_at` | TIMESTAMP | Auto |
| `updated_at` | TIMESTAMP | Auto |

**Business rule**: Chỉ DRAFT mới sửa được. FROZEN = locked cho DRP. ARCHIVED = lưu trữ.

---

### 3.3 `supply_snapshot_line` — Inventory per Item × Location

Mỗi dòng = 1 SKU × 1 địa điểm trong snapshot. Đây là dữ liệu DRP sẽ đọc.

| Column | Type | Mô tả |
|---|---|---|
| `id` | BIGSERIAL (PK) | Auto ID |
| `snapshot_id` | BIGINT (FK) | Thuộc snapshot nào (CASCADE DELETE) |
| `item_code` | VARCHAR(50) | FK → `item.item_code` |
| `location_code` | VARCHAR(20) | FK → `location.location_code` |
| `allocatable_qty` | DECIMAL(15,2) | `= GREATEST(0, SUM(on_hand) - SUM(reserved))` — DRP dùng cái này |
| `reserved_qty` | DECIMAL(15,2) | Tổng reserved tại location |
| `quarantine_qty` | DECIMAL(15,2) | Phase 1 luôn = 0 |
| `in_transit_qty` | DECIMAL(15,2) | Tổng in-transit (nếu `includeInTransit = true`) |
| `is_estimated` | BOOLEAN | `TRUE` nếu source_type = DISTRIBUTION (độ tin cậy thấp hơn) |
| `oldest_sync_at` | TIMESTAMP | Thời điểm sync cũ nhất trong các lot của line này |
| `freshness` | VARCHAR(10) | `PASS` / `STALE` per line |
| `override_qty` | DECIMAL(15,2) | Planner override thủ công (nullable) |
| `override_reason` | TEXT | Lý do override |
| `override_by` | VARCHAR(100) | Ai override |
| `override_at` | TIMESTAMP | Khi nào override |
| `created_at` | TIMESTAMP | Auto |

**DRP đọc**: `COALESCE(override_qty, allocatable_qty)` — override của Planner luôn ưu tiên hơn.

---

## 4. API ENDPOINTS

### 4.1 SupplyController — `/supply`

Quản lý snapshot lifecycle và đọc data.

| Method | Endpoint | Mô tả |
|---|---|---|
| `GET` | `/supply/freshness` | Kiểm tra độ tươi hiện tại của `lot_attribute` |
| `GET` | `/supply/snapshots` | Danh sách 30 snapshots gần nhất (DESC by capture_at) |
| `POST` | `/supply/snapshots` | Capture snapshot mới từ `lot_attribute` |
| `GET` | `/supply/snapshots/:id` | Chi tiết 1 snapshot |
| `PATCH` | `/supply/snapshots/:id/freeze` | Freeze: DRAFT → FROZEN |
| `PATCH` | `/supply/snapshots/:id/acknowledge-stale` | Planner xác nhận chấp nhận STALE |
| `GET` | `/supply/snapshots/:id/lines` | Danh sách lines (paginated + filter) |
| `PATCH` | `/supply/lines/:lineId/override` | Override qty 1 line cụ thể |

**Query params cho `/lines`** (dùng `GetLinesQueryDto extends PaginationDto`):
- `page`, `pageSize`
- `itemCode` — tìm SKU cụ thể
- `locationCode` — tìm địa điểm cụ thể
- `freshness` — `PASS` / `STALE`

---

### 4.2 BravoController — `/supply/bravo`

Upload và nhập tay dữ liệu tồn kho từ Bravo ERP.

| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/supply/bravo/upload` | Upload file Excel/CSV từ Bravo ERP (multipart) |
| `POST` | `/supply/bravo/manual` | Nhập tay danh sách rows (JSON body) |

**Response từ upload/manual**:
```json
{
  "rowsParsed": 311372,
  "rowsInserted": 45210,
  "rowsUpdated": 266162,
  "rowsSkipped": 0,
  "unmappedItems": [],
  "unmappedLocations": [],
  "syncTimestamp": "2026-04-14T00:04:55.102Z"
}
```

---

## 5. TÍNH NĂNG CHÍNH

### Tab 1 — Snapshot Overview

| Tính năng | Mô tả |
|---|---|
| **Freshness Status Bar** | Hiển thị `overallFreshness` (PASS/STALE), tuổi dữ liệu (phút), so sánh với threshold 240 phút |
| **Snapshot List** | Bảng 30 snapshots gần nhất: tên, status, freshness, total lines/items/locations, capture_at |
| **Capture Button** | Trigger POST /supply/snapshots — nhập tên snapshot, chọn includeInTransit |
| **Freeze Button** | PATCH /freeze — disabled nếu STALE chưa acknowledge |
| **Acknowledge Stale** | Modal xác nhận khi freshness = STALE, nhập lý do → unlock Freeze button |
| **Snapshot KPI Cards** | 4 cards: Total Lines, Total Items, Total Locations, Total Allocatable Qty |

### Tab 2 — Inventory Detail

| Tính năng | Mô tả |
|---|---|
| **Lines Table** | Paginated, filter by itemCode + locationCode, hiển thị allocatable/reserved/in-transit |
| **Freshness Badge** | Per-line badge PASS (xanh) / STALE (vàng) dựa trên `oldest_sync_at` |
| **Estimated Badge** | Badge "Est." khi `is_estimated = TRUE` (DISTRIBUTION source) |
| **Override Inline** | Click vào line → nhập override_qty + reason → PATCH /supply/lines/:id/override |
| **Override Visual** | Line có override hiển thị qty gạch chân + override_qty bên cạnh |
| **Bravo Upload Panel** | Upload file Excel từ Bravo → hiển thị kết quả (inserted/updated/skipped/unmapped) |

---

## 6. BUSINESS RULES QUAN TRỌNG

### 6.1 Snapshot Lifecycle

```
DRAFT  ──[freeze]──►  FROZEN  ──[archive]──►  ARCHIVED
  │         ▲
  │    [acknowledge stale]  ← bắt buộc nếu freshness = STALE
  │
  └──(xóa cascade lines)
```
- **DRAFT**: Có thể override lines, acknowledge stale, bị xóa
- **FROZEN**: Immutable — locked cho DRP Module 4. Override vẫn được (Planner cần điều chỉnh sau khi freeze)
- **ARCHIVED**: Read-only

### 6.2 Freshness Calculation

```
ageMinutes = (NOW() - MIN(last_sync_at)) / 60
freshness  = ageMinutes > 240 ? 'STALE' : 'PASS'
```

- **Per-snapshot**: dùng oldest `last_sync_at` trong tất cả lines → "chain yếu nhất"
- **Per-line**: dựa trên oldest lot trong combination (item × location)
- **Global `/freshness`**: dựa trên toàn bộ `lot_attribute` WHERE quality_status = 'ALLOCATABLE'

**Tại sao 240 phút?** Bravo ERP của UNIS chạy batch sync nightly, không real-time. 4 giờ = đủ buffer để Planner capture snapshot trước khi data cũ quá 1 chu kỳ planning.

### 6.3 Capture Aggregation

Khi POST /supply/snapshots, hệ thống aggregate `lot_attribute`:

```sql
SELECT
  item_code,
  location_code,
  GREATEST(0, SUM(on_hand_qty) - SUM(reserved_qty)) AS allocatable_qty,
  SUM(reserved_qty)   AS reserved_qty,
  SUM(quarantine_qty) AS quarantine_qty,
  SUM(in_transit_qty) AS in_transit_qty,   -- nếu includeInTransit = true
  MIN(last_sync_at)   AS oldest_sync_at
FROM lot_attribute
WHERE quality_status = 'ALLOCATABLE'
GROUP BY item_code, location_code
```

- `allocatable_qty` không âm (`GREATEST(0, ...)`) — tránh edge case reserved > on_hand
- Chỉ lấy `ALLOCATABLE` lots — HOLD/REJECTED không tham gia planning
- Toàn bộ insert vào `supply_snapshot_line` trong 1 transaction

### 6.4 Bravo Upload — Header Normalization

Bravo ERP export có thể có header không nhất quán (`Sku`, `SKU`, `sku`, `Ma_Hang`). Backend normalize trước khi parse:

```
Header row → lowercase().trim() → map to canonical field names
```

Mapping canonical:
| Bravo column | Canonical | Ghi chú |
|---|---|---|
| `ma_kho` / `branch_code` / `location_code` | `location_code` | Zero-pad nếu là số thuần (8 → "008") |
| `sku` / `item_code` / `ma_hang` | `item_code` | Ưu tiên `sku` (base code) |
| `bravo_sku` (nếu không có `sku`) | `item_code` | Strip color suffix: `12.L1.3030.3002.8` → `12.L1.3030.3002` |
| `invqty` / `ton_thuc_te` / `on_hand_qty` | `on_hand_qty` | |
| `da_dat` / `reserved_qty` | `reserved_qty` | Default 0 |
| `dang_van_chuyen` / `in_transit_qty` | `in_transit_qty` | Default 0 |

### 6.5 Bravo Upload — Validation & Skip Logic

```
Với mỗi row:
  1. item_code, location_code phải tồn tại trong master tables
  2. Nếu không tồn tại → ghi vào unmappedItems[] / unmappedLocations[] → skip row
  3. Rows hợp lệ → batch upsert 500 rows/lần
  4. ON CONFLICT (item_code, location_code, lot_number) DO UPDATE
```

- Không crash khi gặp item mới — chỉ skip và báo cáo
- `unmappedItems[]` trong response để DA/IT xử lý thêm

### 6.6 Override Policy

Override được phép trên cả **DRAFT** lẫn **FROZEN** snapshot:

- **Lý do**: Planner có thể phát hiện sai sót SAU khi đã freeze (ví dụ: 1 chi nhánh báo số tồn kho sai)
- **DRP đọc**: `COALESCE(override_qty, allocatable_qty)` — override luôn được ưu tiên
- **Audit**: `override_by`, `override_reason`, `override_at` được lưu đầy đủ

**KHÔNG cho phép** override trên ARCHIVED snapshot.

### 6.7 Source Type — OEM vs DISTRIBUTION

| `source_type` | `is_estimated` | Ý nghĩa | Ví dụ |
|---|---|---|---|
| `OEM` | FALSE | UNIS đặt NM sản xuất riêng — số chính xác | Tồn kho tại nhà máy UNIS ký hợp đồng |
| `DISTRIBUTION` | TRUE | NM sản xuất cho nhiều bên — số ước tính | Tồn kho NM phân phối chung |

Planner thấy badge "Est." trên lines có `is_estimated = TRUE` để đánh giá độ tin cậy.

---

## 7. LUỒNG NGHIỆP VỤ (USER FLOW)

### Flow 1: Import Tồn Kho Từ Bravo (Happy Path)

```
1. Bravo ERP chạy batch export nightly → file Excel
2. Planner vào /supply → Tab 1: Snapshot Overview
3. Kiểm tra Freshness Status: "PASS — 35 phút trước"
4. Click "Upload Bravo File" → chọn file → hệ thống parse + upsert lot_attribute
5. Kết quả: 311,372 rows parsed, 266,162 updated, 45,210 inserted
6. Click "Capture Snapshot" → nhập tên "SS-2026-04-14" → POST /supply/snapshots
7. Kết quả snapshot: 4,579 items, 68 locations, 311,372 lines, freshness PASS
8. Review Tab 2: kiểm tra các lines có bất thường không
9. Click "Freeze" → supply_snapshot.status = FROZEN
10. Module 4 DRP có thể đọc snapshot này
```

### Flow 2: Xử Lý Khi Dữ Liệu STALE (Sad Path)

```
1. Planner capture snapshot lúc 11:00 sáng
2. Bravo sync gần nhất là 6:00 tối hôm trước → 300 phút → STALE
3. Hệ thống tạo snapshot với freshness = STALE
4. Freeze button bị disable: "Cần xác nhận dữ liệu STALE trước"
5. Planner kiểm tra với logistics: "Data delay do hệ thống Bravo, chấp nhận"
6. Click "Acknowledge Stale" → nhập lý do → stale_acknowledged = TRUE
7. Freeze button enabled → Click "Freeze" → FROZEN
```

### Flow 3: Override Thủ Công Sau Khi Freeze

```
1. Snapshot đã FROZEN, nhưng chi nhánh Đà Nẵng báo số tồn sai
2. Planner vào Tab 2 → tìm item_code + location_code của Đà Nẵng
3. Click dòng → nhập override_qty = 500, reason = "Đính chính từ chi nhánh ĐN"
4. PATCH /supply/lines/:id/override → line hiển thị override badge
5. DRP Module 4 sẽ đọc 500 thay vì 320 (allocatable gốc)
```

---

## 8. FILE STRUCTURE (BACKEND)

```
backend/src/supply/
├── supply.controller.ts       ← /supply/* endpoints (snapshot lifecycle + lines)
├── supply.service.ts          ← Business logic: capture, freeze, acknowledge, override
├── bravo.controller.ts        ← /supply/bravo/* endpoints (upload + manual)
├── bravo.service.ts           ← Parse Excel, normalize header, validate, upsert lot_attribute
├── supply.module.ts           ← NestJS module, đăng ký vào app.module.ts
│
├── entities/
│   ├── lot-attribute.entity.ts
│   ├── supply-snapshot.entity.ts
│   └── supply-snapshot-line.entity.ts
│
├── dto/
│   └── get-lines-query.dto.ts  ← extends PaginationDto (không dùng @Query rời rạc)
│
└── migrations/
    └── 001_create_supply_tables.sql
```

---

## 9. FILE STRUCTURE (FRONTEND)

```
frontend/
├── app/
│   └── supply/
│       └── page.tsx                  ← Entry point, 2 tabs
│
├── components/supply/
│   ├── [Tab 1 — Snapshot Overview]
│   │   ├── freshness-status-bar.tsx  ← PASS/STALE badge + tuổi dữ liệu
│   │   ├── snapshot-list.tsx         ← Bảng snapshots + actions
│   │   ├── snapshot-kpi-cards.tsx    ← 4 KPI cards
│   │   ├── capture-dialog.tsx        ← Modal tạo snapshot mới
│   │   └── acknowledge-stale-dialog.tsx ← Modal xác nhận STALE
│   │
│   └── [Tab 2 — Inventory Detail]
│       ├── snapshot-lines-table.tsx  ← Paginated lines + filter
│       ├── override-drawer.tsx       ← Slide-in panel override qty
│       └── bravo-upload-panel.tsx    ← Upload file + hiển thị kết quả
│
└── lib/api/
    └── supply.ts                     ← Tất cả API functions + types
```

---

## 10. INTEGRATION VỚI CÁC MODULE KHÁC

### Module 2 nhận từ Module 1

| Data | Source | Mô tả |
|---|---|---|
| `item.item_code` | `item` table (Module 1 seed) | Validate item_code khi upload Bravo |
| `location.location_code` | `location` table (Module 1 seed) | Validate location_code khi upload Bravo |
| `demand_snapshot_line.segment` | Module 1 forecast | Module 3 sẽ đọc ABC từ đây |

### Module 2 cung cấp cho Module 3

| Data | Table | Mô tả |
|---|---|---|
| Item × location combinations | `supply_snapshot_line` (FROZEN) | Module 3 dùng để xác định scope tính Safety Stock (~4,800 combinations) |
| Allocatable qty per location | `supply_snapshot_line.allocatable_qty` | Module 3 seed `item_location_config` từ đây |

### Module 2 cung cấp cho Module 4 (DRP)

| Data | Table | Mô tả |
|---|---|---|
| Tồn kho per item × location | `supply_snapshot_line.allocatable_qty` | DRP đọc `COALESCE(override_qty, allocatable_qty)` làm `begin_stock` tuần 0 |
| Snapshot ID | `supply_snapshot.id` (BIGINT) | DRP job liên kết `supply_snapshot_id` — cần nhớ type BIGINT (khác Module 1 UUID) |

---

## 11. KNOWN LIMITATIONS & TECH DEBT

| # | Vấn đề | Mức độ | Ghi chú |
|---|---|---|---|
| L1 | `quarantine_qty` Phase 1 luôn = 0 | Low | Bravo export chưa có cột quarantine riêng. Phase 2: thêm signal từ NM quality hold |
| L2 | Không có SOFT_RESERVED bucket | Low | BA spec đề cập 4 buckets (ALLOCATABLE/RESERVED/QUARANTINE/SOFT_RESERVED). Phase 1 chỉ có 2 loại thực tế |
| L3 | Override chỉ lưu giá trị cuối, không có audit trail chi tiết | Medium | Cần audit log riêng cho override history (tương tự `demand_override_log` ở Module 1) |
| L4 | Không có tự động recompute snapshot totals sau override | Low | Sau khi override line, `total_allocatable_qty` trên snapshot header không tự cập nhật. Chỉ ảnh hưởng display, DRP vẫn đọc đúng từ line level |
| L5 | `unmappedItems` trong upload response không được lưu vào DB | Medium | Hiện chỉ trả về trong response. Nên lưu vào alert table để Planner theo dõi theo thời gian |

---

## 12. CHECKLIST DONE MODULE 2

### Database
- [x] `lot_attribute` — VARCHAR(50) item_code, VARCHAR(20) location_code, UNIQUE(item, loc, lot)
- [x] `supply_snapshot` — BIGSERIAL PK, DRAFT/FROZEN/ARCHIVED, freshness/stale fields
- [x] `supply_snapshot_line` — FK CASCADE từ snapshot, UNIQUE(snapshot, item, loc)

### Backend
- [x] SupplyController: GET freshness, GET/POST snapshots, GET snapshot/:id, PATCH freeze
- [x] SupplyController: PATCH acknowledge-stale, GET lines (GetLinesQueryDto), PATCH override
- [x] BravoController: POST upload (multipart Excel), POST manual (JSON rows)
- [x] BravoService: header normalization (lowercase + trim), column mapping, zero-pad location
- [x] BravoService: validate item_code + location_code vs master tables, skip unmapped
- [x] BravoService: batch upsert 500 rows/chunk, ON CONFLICT update
- [x] SupplyService: captureSnapshot() — aggregate lot_attribute trong transaction
- [x] SupplyService: freshness check per line + per snapshot
- [x] SupplyService: STALE gate block freeze khi chưa acknowledge
- [x] SupplyService: overrideLine() — cho phép DRAFT và FROZEN
- [x] App.module.ts: đăng ký SupplyModule

### Bugs Fixed
- [x] VARCHAR lengths sai sau migration: DA chạy 4 ALTER TABLE để sửa item_code, location_code
- [x] `bravo_sku` vs `sku` priority: sửa để dùng `sku` (base code) làm `item_code`
- [x] `autoSeedItems()` tạo items với empty item_name: bỏ logic này, dùng validate-and-skip
- [x] `totalLocations` = 3 (chỉ 3 location): root cause là base sku collapse — fix bằng correct column priority

### Verified (Production Data)
- [x] Snapshot id=16 (SS-2026-04-14 Clean): 100,309 lines · 1,685 items · 68 locations
- [x] Snapshot id=13 (SS-2026-04-14 Bravo Full): 311,372 lines · 4,579 items · 68 locations
- [x] GET /freshness: overallFreshness=PASS, thresholdMinutes=240 ✅
- [x] PATCH /acknowledge-stale → staleAcknowledged=true ✅
- [x] PATCH /freeze → status=FROZEN, frozenAt set ✅
- [x] PATCH /lines/:id/override → overrideQty=500, overrideBy set ✅
- [x] POST /bravo/upload → 10 endpoints Swagger registered ✅

---

*Report này được viết sau khi Module 2 hoàn thành. Module 3 tiếp theo sẽ xây dựng Safety Stock và RTM Rules trên nền snapshot đã freeze từ Module 2.*
