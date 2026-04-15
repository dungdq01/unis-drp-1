# Module 6 — Transport Planning: Dev Spec
> **Dành cho:** Dev team  
> **Dựa trên:** MODULE-6-FULL-IMPLEMENT.md (đã được Tech Lead & PM review)  
> **Ngày:** 2026-04-15  
> **Status:** READY FOR DEVELOPMENT

---

## 1. Tổng quan nhiệm vụ

Module 6 nhận output từ **Allocation Run (M5)** và tạo kế hoạch vận chuyển hàng từ kho về chi nhánh.

```
allocation_result (ALLOCATED/PARTIAL)
  → Group by route (sourceLocation → destLocation)
  → FFD Bin-pack vào xe FLATBED (đọc capacity từ DB)
  → Chọn carrier BEST_SLA (OTD% cao nhất)
  → Tính cost = distance × rate × vehicle.cost_multiplier  [đọc từ DB, không hardcode]
  → Tính ETA = departure + lane.lead_time_days
  → Lưu: transport_plan + transport_trip + transport_trip_line
```

**Không có gì hard-code.** Vehicle capacity, cost multiplier, distance, rate — tất cả đọc từ DB. DA config qua UI/CSV.

---

## 2. Thứ tự làm việc (quan trọng)

```
Bước 1 — DA chạy migrations (PHẢI LÀM TRƯỚC)
  ├─ 001_item_weight_migration.sql  → thêm item.weight_per_unit_kg
  └─ 002_create_transport_tables.sql → tạo 6 bảng mới + seed vehicle_type

Bước 2 — BE implement transport module

Bước 3 — DA seed carrier + lane (PHẢI CÓ TRƯỚC KHI TEST createPlan)

Bước 4 — FE implement transport page

Bước 5 — E2E test
```

> ⚠️ **createPlan sẽ throw 400** nếu còn item nào `weight_per_unit_kg = 0`. DA phải seed đủ trước.

---

## 3. Migrations (DA chạy)

### `backend/src/transport/migrations/001_item_weight_migration.sql`

```sql
-- Thêm cột weight_per_unit_kg vào item table
ALTER TABLE item ADD COLUMN IF NOT EXISTS weight_per_unit_kg DECIMAL(10,2) NOT NULL DEFAULT 0;

-- DA xem item_code + category thực tế rồi tự viết UPDATE theo đúng pattern:
-- SELECT DISTINCT category, item_code FROM item LIMIT 100;
-- Ví dụ:
--   UPDATE item SET weight_per_unit_kg = 1200 WHERE category = 'GACH_60X60';
--   UPDATE item SET weight_per_unit_kg = 1000 WHERE category = 'GACH_30X60';
-- Không được dùng LIKE '%60x60%' — item_code UNIS không có format đó.
```

### `backend/src/transport/migrations/002_create_transport_tables.sql`

Tạo 6 bảng: `vehicle_type`, `carrier`, `transport_lane`, `transport_plan`, `transport_trip`, `transport_trip_line`.

Xem SQL đầy đủ tại **MODULE-6-FULL-IMPLEMENT.md Section 2**.

Key points:
- `vehicle_type` được seed sẵn 2 rows: FLATBED (25T, ×1.0) và CRANE_TRUCK (15T, ×1.3)
- `transport_plan.allocation_run_id` có UNIQUE constraint — 1 run = 1 plan
- `transport_trip_line.allocation_result_id` FK → `allocation_result(id)`
- `transport_plan.allocation_run_id` FK → `allocation_run(id)`

---

## 4. Cấu trúc thư mục BE cần tạo

```
backend/src/transport/
  ├── entities/
  │   ├── vehicle-type.entity.ts
  │   ├── carrier.entity.ts
  │   ├── transport-lane.entity.ts
  │   ├── transport-plan.entity.ts
  │   ├── transport-trip.entity.ts
  │   └── transport-trip-line.entity.ts
  ├── dto/
  │   └── index.ts
  ├── migrations/
  │   ├── 001_item_weight_migration.sql
  │   └── 002_create_transport_tables.sql
  ├── transport.config.ts
  ├── transport.service.ts
  ├── transport.controller.ts
  └── transport.module.ts
```

Code đầy đủ cho tất cả files: xem **MODULE-6-FULL-IMPLEMENT.md Section 3–8**.

---

## 5. API Endpoints (13 endpoints)

### Plans
| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/transport/eligible-runs` | Danh sách allocation_run COMPLETED chưa có plan — dùng cho FE dropdown |
| `POST` | `/transport/plans` | Tạo transport plan từ allocationRunId |
| `GET` | `/transport/plans` | Danh sách plans (paginated) |
| `GET` | `/transport/plans/:id` | Chi tiết 1 plan |
| `POST` | `/transport/plans/:id/confirm` | Confirm plan (DRAFT → CONFIRMED) |

### Trips
| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/transport/plans/:id/trips` | Danh sách trips (filter: vehicle, carrier, route, status) |
| `GET` | `/transport/trips/:id/lines` | Chi tiết items trong trip |
| `PATCH` | `/transport/trips/:id` | Override carrier / departure date |

### Carriers
| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/transport/carriers` | Danh sách carriers |
| `POST` | `/transport/carriers` | Upsert carrier (by carrier_code) |
| `DELETE` | `/transport/carriers/:id` | Soft-delete (is_active=false) |
| `POST` | `/transport/carriers/upload` | Upload CSV/Excel |

### Lanes
| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/transport/lanes` | Danh sách lanes (paginated) |
| `POST` | `/transport/lanes` | Upsert lane (by source+dest) |
| `DELETE` | `/transport/lanes/:id` | Soft-delete |
| `POST` | `/transport/lanes/upload` | Upload CSV/Excel |

> **Prefix:** controller dùng `@Controller('transport')`, app route là `/api/v1/transport/...`

---

## 6. Business logic quan trọng — dev PHẢI hiểu

### 6.1 createPlan — validation chain
```
1. allocation_run tồn tại? → 404
2. allocation_run.status = COMPLETED? → 409
3. transport_plan đã tồn tại cho run này? → 409 (UNIQUE)
4. Có allocation_result ALLOCATED/PARTIAL với qty > 0? → 400 nếu empty
5. item.weight_per_unit_kg = 0 còn tồn tại? → 400 với danh sách item_code
```

### 6.2 Vehicle config — đọc từ DB, không hardcode
```typescript
// ĐÚNG
const vehicleMap = await this._loadVehicleMap(); // SELECT FROM vehicle_type WHERE is_active=true
const capacity = vehicleMap.get('FLATBED').capacityKg; // = 25000 (từ DB)

// SAI — không được làm
const capacity = 25000; // hardcode
```

Nếu `vehicle_type` table trống → fallback về `UNIS_TRANSPORT_CONFIG.vehicleFallback` (chỉ để an toàn, không phải normal flow).

### 6.3 FFD Bin-pack — chỉ dùng FLATBED
Phase 1: **chỉ dùng FLATBED** cho bin-pack. Khi trip đầy → mở FLATBED mới.  
CRANE_TRUCK **không** dùng cho auto bin-pack — chỉ dùng khi Planner override thủ công qua `PATCH /trips/:id`.

```typescript
// Logic đúng
if (currentTrip.totalWeightKg + item.weightKg <= FLATBED_CAP) {
  // fit
} else {
  trips.push(currentTrip);
  currentTrip = startTrip('FLATBED'); // luôn FLATBED, không phải CRANE_TRUCK
  // add item vào trip mới
}
```

### 6.4 Lane miss → NO_CARRIER + exception_note, không fake cost
```typescript
const hasLane = !!lane;
const costVnd = hasLane ? distanceKm * ratePerKm * vehicleCfg.costMultiplier : 0;
const tripStatus = !hasLane ? 'NO_CARRIER' : !carrierCode ? 'NO_CARRIER' : 'PLANNED';
const exceptionNote = !hasLane
  ? `NO_LANE: transport_lane chưa setup cho route ${laneKey}`
  : !carrierCode ? `NO_CARRIER: không có carrier serve lane ${laneKey}`
  : null;
```

Không được dùng `distanceKm = 0, rate = 15000` fallback khi lane chưa có.

### 6.5 Carrier selection — BEST_SLA
```
Lấy danh sách carrier_codes từ lane.carrier_codes (comma-separated)
Filter: carrier.supported_vehicles chứa vehicleTypeCode
Sort: carrier.historical_otd_pct DESC
Chọn đầu tiên. Nếu empty → null (NO_CARRIER)
```

---

## 7. app.module.ts — thêm TransportModule

```typescript
import { TransportModule } from './transport/transport.module';

@Module({
  imports: [
    // ... existing modules
    TransportModule,
  ],
})
export class AppModule {}
```

---

## 8. common/errors.ts — thêm 4 error codes

```typescript
TRANSPORT_PLAN_NOT_FOUND:  { code: 'UNIS-ERR-014', msg: 'Transport plan not found', status: 404 },
TRANSPORT_PLAN_NOT_DRAFT:  { code: 'UNIS-ERR-015', msg: 'Transport plan is not DRAFT', status: 409 },
TRANSPORT_TRIP_NOT_FOUND:  { code: 'UNIS-ERR-016', msg: 'Transport trip not found', status: 404 },
ALLOC_RUN_NOT_COMPLETED:   { code: 'UNIS-ERR-017', msg: 'Allocation run is not COMPLETED', status: 409 },
```

---

## 9. Frontend — `lib/api/transport.ts`

Types và API functions đầy đủ: xem **MODULE-6-FULL-IMPLEMENT.md Section 10**.

---

## 10. Frontend — `app/transport/page.tsx` (4 tabs)

| Tab | Nội dung |
|-----|---------|
| **Plans** | KPI cards (trips, weight, cost) + danh sách plans + "Create Plan" button → dropdown `eligible-runs` |
| **Trips** | Table với filter (vehicle, carrier, route, status) + carrier override inline |
| **Carriers** | Table + form add/edit + CSV upload dropzone |
| **Lanes** | Table + form add/edit + CSV upload dropzone |

**Trip detail:** expand row → drawer hiển thị trip lines (item_code, qty, weight_kg).

---

## 11. CSV upload format

### Carrier CSV
```
carrier_code | carrier_name | contact_phone | historical_otd_pct | supported_vehicles | note
CARRIER-A    | Vận tải A   | 0909123456    | 0.94               | FLATBED,CRANE_TRUCK |
```

### Lane CSV
```
source_location_code | dest_location_code | distance_km | lead_time_days | rate_vnd_per_km | carrier_codes | note
WH-001               | CN-001             | 110         | 2              | 15000           | CARRIER-A,CARRIER-B |
```

> Lane gợi ý: DA auto-generate từ `SELECT DISTINCT warehouse_code AS source, branch_code AS dest FROM rtm_rule WHERE is_active=true`

---

## 12. Task Checklist

### DA (TRƯỚC khi dev test)
- [ ] **DA-P1** Chạy `001_item_weight_migration.sql` — xem item_code thực tế, tự viết UPDATE theo category
- [ ] **DA-P2** Chạy `002_create_transport_tables.sql`
- [ ] **DA-P3** Verify: `SELECT code, capacity_kg, cost_multiplier FROM vehicle_type` — phải có 2 rows
- [ ] **DA-1** Seed ≥3 carriers (CSV upload hoặc SQL)
- [ ] **DA-2** Seed lanes từ RTM rules (CSV upload)
- [ ] **DA-3** Verify: tất cả item trong `allocation_result` có `weight_per_unit_kg > 0`

### Backend
- [ ] **BE-1** Tạo `src/transport/` với đầy đủ cấu trúc
- [ ] **BE-2** Tạo 6 entity files (copy từ FULL-IMPLEMENT.md Section 3)
- [ ] **BE-3** Tạo `transport.config.ts`
- [ ] **BE-4** Tạo `dto/index.ts`
- [ ] **BE-5** Tạo `transport.service.ts` — chú ý 6.1–6.5 ở trên
- [ ] **BE-6** Tạo `transport.controller.ts`
- [ ] **BE-7** Tạo `transport.module.ts` + import MulterModule
- [ ] **BE-8** Register TransportModule trong `app.module.ts`
- [ ] **BE-9** Thêm UNIS-ERR-014..017 vào `common/errors.ts`
- [ ] **BE-10** `npm run build` — 0 TS errors
- [ ] **BE-11** Swagger test: `POST /transport/plans` với allocationRunId hợp lệ
- [ ] **BE-12** Verify: vehicle config đọc từ DB (thay capacity_kg trong DB → thấy effect)
- [ ] **BE-13** Verify: trip status `NO_CARRIER` + exception_note khi lane chưa setup

### Frontend
- [ ] **FE-1** Tạo `lib/api/transport.ts`
- [ ] **FE-2** Tạo `app/transport/page.tsx` — 4 tabs
- [ ] **FE-3** Tab Plans: KPI + list + Create Plan với eligible-runs dropdown
- [ ] **FE-4** Tab Trips: table + filters + carrier override
- [ ] **FE-5** Tab Carriers: table + form + CSV upload
- [ ] **FE-6** Tab Lanes: table + form + CSV upload
- [ ] **FE-7** Trip lines drawer

---

## 13. Known Issues (Phase 1, chấp nhận)

| ID | Vấn đề | Xử lý Phase 1 | Phase 2 |
|----|--------|---------------|---------|
| N1 | `carrier_codes` lưu comma-separated (không normalize) | Chấp nhận | Join table `lane_carrier` |
| N2 | Consolidation OFF — 1 run = 1 plan (UNIQUE) | Chấp nhận | Bỏ UNIQUE nếu bật consolidation |
| N3 | departure_date = today + 1 ngày, không check lịch nghỉ | Chấp nhận | Working calendar |
| N4 | CRANE_TRUCK chỉ dùng qua manual override | Chấp nhận | Xác định business rule với UNIS |

---

*Spec này là tài liệu chính thức cho dev. Mọi thắc mắc về business logic → hỏi Tech Lead trước khi tự quyết định.*
