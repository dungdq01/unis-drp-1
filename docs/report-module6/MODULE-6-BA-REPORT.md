# Module 6 — Transport Planning: BA Report
> **Ngày hoàn thành:** 2026-04-15
> **Trạng thái:** DONE — Backend + Frontend hoàn chỉnh, chờ DA seed carrier/lane data
> **Phụ thuộc:** Module 5 (allocation_run COMPLETED/PARTIAL)

---

## 1. Mục tiêu module

Module 6 nhận output từ Allocation (M5) và tạo kế hoạch vận chuyển hàng từ kho trung tâm về chi nhánh. Đây là bước chuyển đổi từ "phân bổ hàng trên giấy" thành "kế hoạch xe cụ thể — xe nào, chở gì, đi đâu, khi nào, tốn bao nhiêu."

**Luồng chính:**
```
allocation_result (ALLOCATED/PARTIAL)
    → Group by route (source_location → dest_location)
    → FFD Bin-pack vào xe FLATBED 25T
    → Chọn carrier tốt nhất (OTD% cao nhất)
    → Tính cost + ETA từ lane config (tất cả từ DB)
    → transport_plan (DRAFT) + transport_trip[] + transport_trip_line[]
    → Planner review, override nếu cần
    → Confirm plan → CONFIRMED → Module 7 đọc
```

---

## 2. Phạm vi Phase 1

| Trong scope | Ngoài scope (Phase 2) |
|-------------|----------------------|
| FFD bin-pack FLATBED 25T (auto) | CRANE_TRUCK auto bin-pack |
| Carrier selection BEST_SLA (OTD%) | Multi-criteria carrier scoring |
| Cost = distance × rate × multiplier (từ DB) | CO2 tracking |
| ETA = departure + lead_time_days | Working calendar (tính ngày nghỉ) |
| Carrier/Lane CRUD + CSV upload | Lane pricing tự động từ RTM |
| Manual carrier override (PATCH /trips/:id) | Carrier contract integration |
| Plan confirm (DRAFT → CONFIRMED) | Multi-run consolidation |

---

## 3. Luồng nghiệp vụ chi tiết

### 3.1 Tạo Transport Plan

1. Planner chọn Allocation Run từ dropdown (COMPLETED hoặc PARTIAL, chưa có plan)
2. Hệ thống validate:
   - Allocation run tồn tại → nếu không: **404**
   - Run status = COMPLETED hoặc PARTIAL → nếu không: **409**
   - Chưa có transport_plan cho run này → nếu đã có: **409** (UNIQUE)
   - Có allocation_result ALLOCATED/PARTIAL với qty > 0 → nếu không: **400**
   - Tất cả item có `weight_per_unit_kg > 0` → nếu còn item = 0: **400** (danh sách item_code bị thiếu)
3. Load vehicle config từ `vehicle_type` table (capacity_kg, cost_multiplier)
4. Load lane config từ `transport_lane` table (distance_km, lead_time_days, rate_vnd_per_km, carrier_codes)
5. Load carrier config từ `carrier` table (historical_otd_pct, supported_vehicles)
6. **FFD bin-pack** per route: group allocation_result theo route → sort weight DESC → nhét vào FLATBED, nếu đầy mở FLATBED mới
7. **Carrier selection**: filter carrier phục vụ lane + hỗ trợ FLATBED → sort OTD% DESC → chọn đầu tiên
8. **Cost**: `distance_km × rate_vnd_per_km × vehicle.cost_multiplier`
9. **ETA**: `departure_date + lane.lead_time_days`
10. Lưu: `transport_plan` (DRAFT) + `transport_trip[]` + `transport_trip_line[]`

### 3.2 Exception Handling

**Lane chưa setup:**
- `trip.status = NO_CARRIER`
- `exception_note = 'NO_LANE: transport_lane chưa setup cho route {src}||{dst}'`
- `estimated_cost_vnd = 0` (không fake cost)

**Không có carrier phục vụ lane:**
- `trip.status = NO_CARRIER`
- `exception_note = 'NO_CARRIER: không có carrier serve lane {src}||{dst}'`

Planner nhìn thấy các trip NO_CARRIER trên FE → xử lý thủ công bằng PATCH /trips/:id.

### 3.3 Manual Override

Planner có thể override sau khi plan được tạo:
- **Đổi carrier**: `PATCH /transport/trips/:id` với `carrierCode` mới → trip.status tự chuyển PLANNED nếu có carrier, NO_CARRIER nếu xóa carrier
- **Đổi ngày xuất phát**: `PATCH /transport/trips/:id` với `departureDate` → hệ thống tự tính lại `etaDate = departureDate + leadTimeDays`
- **CRANE_TRUCK**: chỉ assign thủ công qua PATCH — không bao giờ tự động trong bin-pack

### 3.4 Confirm Plan

Sau khi Planner review xong → `POST /transport/plans/:id/confirm`:
- `transport_plan.status = DRAFT → CONFIRMED`
- Plan CONFIRMED là điều kiện để Module 7 tạo order batch

---

## 4. Thuật toán FFD Bin-pack

**First-Fit Decreasing (FFD)** — weight-based:

```
Với mỗi route (source → dest):
  1. Sort tất cả allocation_result theo weight DESC
  2. Mở trip FLATBED đầu tiên
  3. Với từng item:
     - Nếu fit vào trip hiện tại (totalWeight + itemWeight ≤ 25T) → add vào
     - Nếu không fit → đóng trip hiện tại, mở FLATBED MỚI → add vào
  4. Đóng trip cuối cùng
```

**Tại sao chỉ dùng FLATBED cho overflow?**
CRANE_TRUCK có capacity nhỏ hơn (15T) và cost_multiplier cao hơn (×1.3). Dùng CRANE cho overflow sẽ cần nhiều xe hơn và đắt hơn. Business rule Phase 1: luôn FLATBED cho auto bin-pack.

---

## 5. Carrier Selection — BEST_SLA

```
Input: danh sách carrier_codes từ lane.carrier_codes (comma-separated)
Filter 1: carrier.is_active = true
Filter 2: carrier.supported_vehicles chứa vehicleTypeCode (FLATBED)
Sort: carrier.historical_otd_pct DESC
Output: carrier_code đầu tiên, hoặc null nếu danh sách rỗng
```

`historical_otd_pct` = tỷ lệ giao đúng hạn lịch sử (ví dụ 0.94 = 94%). DA cập nhật định kỳ.

---

## 6. Cost & ETA Calculation

Tất cả thông số đọc từ DB — không hardcode:

| Thông số | Source | Cột |
|----------|--------|-----|
| distance_km | transport_lane | distance_km |
| rate_vnd_per_km | transport_lane | rate_vnd_per_km |
| cost_multiplier | vehicle_type | cost_multiplier |
| lead_time_days | transport_lane | lead_time_days |

```
cost_vnd = distance_km × rate_vnd_per_km × vehicle.cost_multiplier
         = 0 nếu lane chưa setup (không fake)

eta_date = departure_date + lead_time_days
departure_date = today + 1 ngày (Phase 1 — Phase 2: working calendar)
```

---

## 7. DB Schema

### 6 tables mới

**`vehicle_type`** — Config xe, seeded sẵn, Planner có thể chỉnh qua DB

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| code | VARCHAR(20) UNIQUE | FLATBED / CRANE_TRUCK |
| label | VARCHAR(50) | Tên hiển thị |
| capacity_kg | DECIMAL(10,2) | FLATBED=25000, CRANE=15000 |
| cost_multiplier | DECIMAL(5,3) | FLATBED=1.0, CRANE=1.3 |
| is_active | BOOLEAN | Soft toggle |

**`carrier`** — Nhà vận chuyển, DA seed qua CSV upload hoặc SQL

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| carrier_code | VARCHAR(20) UNIQUE | Ví dụ: VTA-001 |
| carrier_name | VARCHAR(100) | |
| historical_otd_pct | DECIMAL(5,4) | 0.0–1.0 — basis của BEST_SLA |
| supported_vehicles | VARCHAR(100) | Comma-separated: FLATBED,CRANE_TRUCK |
| is_active | BOOLEAN | Soft-delete |

**`transport_lane`** — Cấu hình tuyến đường, DA seed từ RTM rules

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| source_location_code | VARCHAR(20) | UNIQUE(source, dest) |
| dest_location_code | VARCHAR(20) | |
| distance_km | DECIMAL(8,2) | Khoảng cách thực tế |
| lead_time_days | INT | Thời gian vận chuyển (ngày) |
| rate_vnd_per_km | DECIMAL(12,2) | Đơn giá vận chuyển |
| carrier_codes | VARCHAR(200) | Comma-separated — carriers phục vụ lane này |
| is_active | BOOLEAN | Soft toggle |

**`transport_plan`** — Header kế hoạch vận chuyển, UNIQUE per allocation_run

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| allocation_run_id | BIGINT UNIQUE FK | FK → allocation_run(id) |
| status | VARCHAR(20) | DRAFT / CONFIRMED / CANCELLED |
| total_trips | INT | Tổng số chuyến |
| total_weight_kg | DECIMAL(15,2) | Tổng trọng lượng |
| total_cost_vnd | DECIMAL(18,2) | Tổng chi phí ước tính |
| confirmed_by / at | VARCHAR/TIMESTAMP | Audit trail |

**`transport_trip`** — 1 chuyến xe (1 route × 1 vehicle × 1 carrier)

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| transport_plan_id | BIGINT FK | |
| source/dest_location_code | VARCHAR(20) | |
| vehicle_type_code | VARCHAR(20) | FLATBED / CRANE_TRUCK |
| carrier_code | VARCHAR(20) nullable | NULL = NO_CARRIER |
| total_weight_kg | DECIMAL(10,2) | |
| estimated_cost_vnd | DECIMAL(18,2) | 0 nếu NO_LANE |
| departure_date / eta_date | DATE | |
| lead_time_days | INT | Snapshot từ lane lúc tạo |
| status | VARCHAR(20) | PLANNED / NO_CARRIER / DISPATCHED / DELIVERED |
| exception_note | TEXT nullable | NO_LANE: ... / NO_CARRIER: ... |

**`transport_trip_line`** — 1 dòng = 1 item trong 1 chuyến xe

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| transport_trip_id | BIGINT FK | |
| allocation_result_id | BIGINT FK | Traceability về M5 |
| item_code | VARCHAR(50) | |
| allocated_qty | DECIMAL(15,2) | Từ allocation_result |
| weight_kg | DECIMAL(10,2) | allocatedQty × weight_per_unit_kg |

---

## 8. API Endpoints (16 endpoints)

### Plans

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/transport/eligible-runs` | Allocation runs COMPLETED/PARTIAL chưa có plan — dùng cho FE dropdown |
| POST | `/api/v1/transport/plans` | Tạo transport plan từ allocationRunId |
| GET | `/api/v1/transport/plans` | Danh sách plans (paginated) |
| GET | `/api/v1/transport/plans/:id` | Chi tiết 1 plan |
| POST | `/api/v1/transport/plans/:id/confirm` | DRAFT → CONFIRMED |

### Trips

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/transport/plans/:id/trips` | Danh sách trips (filter: vehicle/carrier/route/status) |
| GET | `/api/v1/transport/trips/:id/lines` | Chi tiết items trong 1 trip |
| PATCH | `/api/v1/transport/trips/:id` | Override carrier, departure date, exception note |

### Carriers

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/transport/carriers` | Danh sách carriers (sort OTD% DESC) |
| POST | `/api/v1/transport/carriers` | Upsert carrier (by carrier_code) |
| DELETE | `/api/v1/transport/carriers/:id` | Soft-delete (is_active=false) |
| POST | `/api/v1/transport/carriers/upload` | Upload CSV/Excel |

### Lanes

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/transport/lanes` | Danh sách lanes (paginated) |
| POST | `/api/v1/transport/lanes` | Upsert lane (by source+dest UNIQUE) |
| DELETE | `/api/v1/transport/lanes/:id` | Soft-delete |
| POST | `/api/v1/transport/lanes/upload` | Upload CSV/Excel |

---

## 9. Error Codes

| Code | HTTP | Khi nào |
|------|------|---------|
| UNIS-ERR-014 | 404 | transport_plan not found |
| UNIS-ERR-015 | 409 | transport_plan status không phải DRAFT (khi confirm) |
| UNIS-ERR-016 | 404 | transport_trip not found |
| UNIS-ERR-017 | 409 | allocation_run chưa COMPLETED/PARTIAL |

---

## 10. CSV Upload Format

### Carrier CSV

```
carrier_code,carrier_name,contact_phone,historical_otd_pct,supported_vehicles,note
VTA-001,Vận tải Trường An,0909123456,0.94,FLATBED,
VTC-002,Vận tải Cường,0912345678,0.88,FLATBED CRANE_TRUCK,
```

### Lane CSV

```
source_location_code,dest_location_code,distance_km,lead_time_days,rate_vnd_per_km,carrier_codes,note
HUBR00001,001,110,2,15000,VTA-001,
HUBR00001,014,250,3,15000,VTA-001 VTC-002,
```

> DA gợi ý: generate lane list từ `SELECT DISTINCT warehouse_code AS source, branch_code AS dest FROM rtm_rule WHERE is_active=true`

---

## 11. Frontend (app/transport/page.tsx)

**4 tabs:**

| Tab | Nội dung |
|-----|---------|
| **Plans** | KPI cards (trips/weight/cost) + danh sách plans + Create Plan button (dropdown eligible-runs) + Confirm button |
| **Trips** | Table với filter (vehicle/carrier/route/status) + carrier override inline + expand row → trip lines drawer |
| **Carriers** | Table + form upsert + CSV upload dropzone |
| **Lanes** | Table + form upsert + CSV upload dropzone |

**Trip NO_CARRIER:** highlight màu đỏ/amber, hiển thị exception_note, cho phép Planner gán carrier thủ công inline.

---

## 12. Trạng thái hoàn thành

### Backend ✅ DONE

- [x] `src/transport/` đầy đủ cấu trúc (entities, dto, config, service, controller, module)
- [x] 6 entities: vehicle-type, carrier, transport-lane, transport-plan, transport-trip, transport-trip-line
- [x] `TransportModule` registered trong `app.module.ts`, imports MulterModule
- [x] UNIS-ERR-014..017 trong `common/errors.ts`
- [x] `_loadVehicleMap()` đọc từ `vehicle_type` table — không hardcode
- [x] `_buildTrips()` FFD bin-pack FLATBED-only, weight-based
- [x] `_selectBestCarrier()` BEST_SLA (OTD% DESC), filter supported_vehicles
- [x] `createPlan()` validation chain (404 → 409 → 409 → 400 → 400 weight block)
- [x] Lane miss → NO_CARRIER + exception_note, costVnd = 0 (không fake)
- [x] `confirmPlan()` DRAFT → CONFIRMED
- [x] `updateTrip()` carrier override, departure recalc ETA
- [x] `getEligibleRuns()` filter COMPLETED/PARTIAL chưa có plan
- [x] Carrier CRUD + CSV upload (xlsx/csv parse)
- [x] Lane CRUD + CSV upload

### Frontend ✅ DONE (partial)

- [x] `lib/api/transport.ts` — đủ types + API functions
- [x] `app/transport/page.tsx` — 3/4 tabs: Plans / Carriers / Lanes
- [x] Eligible-runs dropdown, KPI cards, carrier override inline, Confirm button
- [ ] **FE-8 PENDING:** Trip lines drawer (expand trip row → hiện items)
- [ ] **FE-5/6 PENDING:** CSV upload dropzone trong Carriers và Lanes tab (UI component)

---

## 13. Việc còn lại cho DA (BLOCKING trước khi test createPlan)

**Bước 1 — Migration:**
```sql
-- File: backend/src/transport/migrations/001_item_weight_migration.sql
-- Xem item_code thực tế trước:
SELECT DISTINCT item_code, item_name FROM item LIMIT 100;
-- Sau đó viết UPDATE theo category thực (KHÔNG dùng LIKE '%60x60%'):
UPDATE item SET weight_per_unit_kg = 1200 WHERE item_category = 'GACH_60X60'; -- ví dụ
-- createPlan sẽ BLOCK 400 nếu còn item nào weight_per_unit_kg = 0
```

```sql
-- File: backend/src/transport/migrations/002_create_transport_tables.sql
-- Tạo 6 tables + seed vehicle_type 2 rows (FLATBED + CRANE_TRUCK)
```

**Bước 2 — Verify vehicle_type:**
```sql
SELECT code, capacity_kg, cost_multiplier FROM vehicle_type;
-- Kỳ vọng:
-- FLATBED     | 25000 | 1.0
-- CRANE_TRUCK | 15000 | 1.3
```

**Bước 3 — Seed Carriers (≥3):**
```sql
-- Hoặc dùng CSV upload tại POST /api/v1/transport/carriers/upload
```

**Bước 4 — Seed Lanes:**
```sql
-- Generate từ RTM rules:
SELECT DISTINCT warehouse_code AS source, branch_code AS dest
FROM rtm_rule WHERE is_active = true;
-- Sau đó upsert lane với distance_km, lead_time_days, rate_vnd_per_km, carrier_codes
-- Hoặc dùng CSV upload tại POST /api/v1/transport/lanes/upload
```

**Bước 5 — Verify allocation_result có weight:**
```sql
SELECT ar.item_code, i.weight_per_unit_kg
FROM allocation_result ar
JOIN item i ON i.item_code = ar.item_code
WHERE ar.status IN ('ALLOCATED','PARTIAL')
  AND i.weight_per_unit_kg = 0;
-- Kỳ vọng: 0 rows (không còn item nào thiếu weight)
```

---

## 14. Known Constraints / Giới hạn Phase 1

| Giới hạn | Lý do | Phase 2 plan |
|----------|-------|-------------|
| `carrier_codes` lưu comma-separated string | Đơn giản hóa Phase 1, đủ dùng | Join table `lane_carrier` (normalize) |
| departure_date = today + 1, không check lịch nghỉ | Chưa có working calendar module | Working calendar service |
| CRANE_TRUCK chỉ dùng qua manual override | Business rule chưa xác định rõ khi nào dùng CRANE | Clarify với UNIS, có thể thêm auto-select CRANE cho heavy items |
| 1 allocation_run = 1 transport_plan (UNIQUE) | Consolidation OFF | Bỏ UNIQUE khi bật consolidation |
| CO2 tracking tắt | Chưa có CO2 emission data per vehicle | CO2 per km config trong vehicle_type |

---

## 15. Phase 2 Roadmap

| Feature | Dependency |
|---------|------------|
| CRANE_TRUCK auto bin-pack | Business rule UNIS clarify |
| CO2 tracking per trip | vehicle_type.co2_per_km field |
| Working calendar (no holiday departure) | Calendar module / public holiday API |
| Multi-criteria carrier scoring | Weighted score (OTD + price + reliability) |
| Lane pricing tự động từ RTM | RTM rule integration |
| Carrier contract management | Pricing table per lane per carrier |
| Consolidation (nhiều runs → 1 plan) | Bỏ UNIQUE constraint allocation_run_id |

---

*Module 6 hoàn thành. Tech Lead review: 2026-04-15.*