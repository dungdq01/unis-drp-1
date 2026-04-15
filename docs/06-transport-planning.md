# Module Spec — Step 6: Transport Planning

> **Bin-pack + Carrier Selection** — Nhóm allocation results thành trips (chuyến xe),
> chọn xe + carrier, tính cost + ETA

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ khỏi `transport_plan` table và tất cả SQL (`D-MD-03`)
> - **Item PK:** `item_code VARCHAR` (`D-MD-01`) | **Location PK:** `location_code VARCHAR` (`D-MD-02`)
> - **`transport_plan.tenant_id`** column: bỏ
> - **Weight limit:** 28,000 kg (FLATBED 25T + buffer). Xem `UNIS_CONFIG.MAX_CONTAINER_WEIGHT_KG`

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

Allocation đã xác định "WH Đà Nẵng giao 500 thùng cho CN Huế". Bây giờ cần trả lời:
**Dùng xe nào? Xe tải bao nhiêu tấn? Hãng vận chuyển nào? Mấy ngày tới nơi? Chi phí là bao nhiêu?**

Module này tự động nhóm hàng vào các chuyến xe (xếp tối ưu theo trọng lượng),
chọn nhà vận chuyển tốt nhất (theo lịch sử giao đúng hẹn), và tính ETA.

> **UNIS đặc thù:** Gạch men rất nặng (1 pallet ~1 tấn). Giới hạn là trọng lượng, không phải
> thể tích. Chỉ dùng 2 loại xe: FLATBED 25T (xe tải phẳng) và CRANE_TRUCK 15T (xe cẩu).

**Người dùng chính:** Kế hoạch viên + Bộ phận Logistics

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **Kế hoạch viên** | Xem kế hoạch vận chuyển, xác nhận plan |
| **Logistics coordinator** | Điều chỉnh carrier nếu cần, confirm kế hoạch cho nhà vận chuyển |
| **Nhà vận chuyển** | Nhận kế hoạch (export CSV/email) — không dùng hệ thống trực tiếp |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là Kế hoạch viên**, tôi muốn **hệ thống tự nhóm hàng thành các chuyến xe** để tiết kiệm thời gian lập kế hoạch | Trips được tạo tự động, mỗi trip có: xe, carrier, route, trọng lượng, ETA |
| US-02 | **Là Logistics coordinator**, tôi muốn **xem danh sách chuyến xe** theo ngày xuất để kiểm tra tải xe hợp lý | Bảng trips: ngày, route, tải (X/25T), carrier, ETA |
| US-03 | **Là Logistics coordinator**, tôi muốn **thay đổi carrier** cho 1 chuyến nếu carrier được chọn không available | Có thể override carrier từ dropdown, system tính lại ETA |
| US-04 | **Là Kế hoạch viên**, tôi muốn **xem tổng chi phí vận chuyển** của kế hoạch này | Cost summary: total VND, cost/thùng, breakdown by route |
| US-05 | **Là Logistics coordinator**, tôi muốn **xác nhận (confirm) kế hoạch** để chuyển sang Step 7 tạo đơn hàng | Transport plan → CONFIRMED, Step 7 tự động đọc và tạo draft orders |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Nhóm xe thành công (Happy Path)

```
1. Allocation xong, 1,189 items đã phân bổ từ 8 kho → 68 CN
2. Kế hoạch viên bấm "Create Transport Plan"
3. Hệ thống nhóm theo route: WH-DN-001 → CN-Huế: 12 items, 18.5 tấn
4. Xếp xe: 1 FLATBED 25T (đủ tải, không cần 2 xe)
5. Carrier selection: "CARRIER-A" OTD lịch sử 94% → chọn tự động
6. ETA: 13/04 + 2 ngày = 15/04
7. Logistics review bảng trips → OK → Confirm Plan
8. Step 7 tự động tạo draft orders từ các trips này
```

#### ❌ Kịch bản 2 — Hàng quá nặng, phải tách 2 xe (Sad Path)

```
1. Route WH-HCM → CN-Cần Thơ: 32 items, 31 tấn (vượt 25T)
2. Hệ thống tự tách: Xe 1: 19 tấn (FLATBED), Xe 2: 12 tấn (CRANE_TRUCK)
3. Logistics thấy Xe 2 CRANE_TRUCK → CN Cần Thơ không có cẩu → cần sửa
4. Override: Xe 2 đổi sang FLATBED → confirm
```

#### ⚠️ Kịch bản 3 — Carrier hết xe (Sad Path)

```
1. Hệ thống chọn CARRIER-A cho 5 chuyến vào ngày 14/04
2. Logistics gọi điện: CARRIER-A chỉ có 3 xe hôm đó
3. 2 chuyến còn lại → override sang CARRIER-B (OTD 89%)
4. ETA bị đẩy thêm 1 ngày cho 2 chuyến này
5. Kế hoạch viên được thông báo → update CN liên quan
```

---

### 0.4 Thuật ngữ

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **Transport Plan** | Kế hoạch vận chuyển tổng thể cho 1 lần allocation |
| **Trip (Chuyến xe)** | 1 xe chạy từ kho A → CN B, chở 1 số lượng hàng cụ thể |
| **FLATBED** | Xe tải phẳng 25T — dùng khi CN có forklift dỡ hàng |
| **CRANE_TRUCK** | Xe tải có cẩu 15T — dùng khi CN không có forklift, phải dùng cẩu |
| **OTD (On-Time Delivery)** | Tỷ lệ % giao hàng đúng hẹn của carrier — cơ sở chọn nhà vận chuyển |
| **ETA** | Estimated Time of Arrival — ngày dự kiến hàng đến CN |
| **Bin-packing** | Thuật toán xếp hàng vào xe tối ưu (tương tự xếp đồ vào hộp) |

---

## 1. Purpose

Transport Planning nhận allocation_results từ Step 5 và nhóm thành các chuyến xe (trips).
Mỗi trip = 1 xe chạy từ kho nguồn → CN đích. Module xử lý:

1. **Grouping:** Gom allocation results theo cặp source→dest
2. **Bin-packing:** FFD algorithm để xếp hàng vào xe tối ưu
3. **Carrier selection:** Chọn nhà vận chuyển theo SLA tốt nhất
4. **Cost calculation:** rate × distance
5. **ETA estimation:** departure + lead time

**UNIS đặc thù:**
- consolidation = OFF → mỗi allocation batch = 1 trip (không gom nhiều batch vào 1 xe)
- Chỉ 2 loại xe: FLATBED (25T) và CRANE_TRUCK (15T)
- CO2 tracking OFF (sustainability_score = 0)
- Gạch men nặng → weight-limited chứ không volume-limited

---

## 2. UNIS Context

| Dimension | UNIS Value | Giải thích |
|---|---|---|
| Vehicle types | FLATBED (25T), CRANE_TRUCK (15T) | Gạch nặng, cần xe tải lớn |
| Consolidation | OFF | 1 batch allocation = 1 trip |
| Carrier selection | BEST_SLA | Sort by historical OTD% DESC |
| CO2 tracking | OFF | sustainability_score = 0 |
| Cost model | rate_vnd × distance_km | Đơn giản, theo km |
| ETA model | departure_date + lead_time_days | Theo lane (source→dest pair) |

**Tại sao consolidation OFF cho UNIS?**
- Gạch men đóng pallet nặng, 1 xe FLATBED 25T thường chở đủ 1 batch
- Gom nhiều batch → phức tạp loading/unloading, tăng risk vỡ hàng
- Phase 1: đơn giản hóa, Phase 2 có thể bật consolidation

**FLATBED vs CRANE_TRUCK:**
- FLATBED 25T: dùng cho gạch men đóng pallet tiêu chuẩn, forklift dỡ
- CRANE_TRUCK 15T: dùng cho hàng cồng kềnh hoặc CN không có forklift, cần cẩu dỡ

---

## 3. Input

### 3.1 Primary Input — Allocation Results (from Step 5)

```
Source: allocation_result table
Filter: status IN (ALLOCATED, PARTIAL)
```

| Field | Type | Description |
|---|---|---|
| allocation_result_id | UUID | PK |
| source_location_id | UUID | Kho xuất |
| dest_location_id | UUID | CN nhận |
| sku_id | UUID | SKU |
| qty_allocated | DECIMAL(15,2) | Số lượng đã allocate |
| lot_id | UUID | Lot cụ thể |
| specs_id | VARCHAR | Variant code |

### 3.2 Configuration Data

#### vehicle_frame

| Field | Type | Description |
|---|---|---|
| vehicle_type | ENUM | FLATBED, CRANE_TRUCK |
| capacity_kg | DECIMAL | 25000, 15000 |
| capacity_pallet | INT | Max pallets |
| cost_multiplier | DECIMAL | 1.0 for FLATBED, 1.3 for CRANE |

#### carrier

| Field | Type | Description |
|---|---|---|
| carrier_id | UUID | PK |
| carrier_name | VARCHAR | Tên nhà vận chuyển |
| historical_otd_pct | DECIMAL | % giao đúng hạn (lịch sử) |
| vehicle_types | ARRAY | Loại xe carrier có |
| active | BOOLEAN | Còn hoạt động |

#### lane

| Field | Type | Description |
|---|---|---|
| lane_id | UUID | PK |
| source_location_id | UUID | Kho xuất |
| dest_location_id | UUID | CN nhận |
| distance_km | DECIMAL | Khoảng cách |
| lead_time_days | INT | Thời gian vận chuyển |
| rate_vnd_per_km | DECIMAL | Đơn giá VND/km |

---

## 4. Processing Logic

### 4.1 Step 1: Group by Route

```python
# Group allocation results by (source_location → dest_location)
route_groups = {}
for result in allocation_results:
    key = (result.source_location_id, result.dest_location_id)
    route_groups.setdefault(key, []).append(result)
```

**UNIS consolidation=OFF:** Mỗi allocation_run tạo 1 batch per route.
Không gom kết quả từ nhiều allocation_run khác nhau vào cùng 1 trip.

### 4.2 Step 2: FFD Bin-Pack

```python
# First-Fit Decreasing bin-packing
# Ưu tiên FLATBED (25T) trước, CRANE cho remainder

def bin_pack(items, route_key):
    # Sort items by weight DESC (FFD)
    items.sort(key=lambda x: x.weight_kg, reverse=True)

    trips = []
    current_trip = new_trip(vehicle_type="FLATBED", capacity=25000)

    for item in items:
        if current_trip.remaining_capacity >= item.weight_kg:
            current_trip.add(item)
        else:
            trips.append(current_trip)
            # Thử FLATBED mới trước
            if item.weight_kg <= 25000:
                current_trip = new_trip("FLATBED", 25000)
            else:
                current_trip = new_trip("CRANE_TRUCK", 15000)
            current_trip.add(item)

    trips.append(current_trip)
    return trips
```

**Gạch men weight calculation:**
- 1 pallet gạch 60x60 ≈ 1,200 kg
- 1 xe FLATBED 25T ≈ 20 pallets
- 1 xe CRANE 15T ≈ 12 pallets

### 4.3 Step 3: Carrier Selection (BEST_SLA)

```python
# UNIS: carrier_selection_mode = BEST_SLA

def select_carrier(trip, lane):
    eligible_carriers = carriers.filter(
        active=True,
        vehicle_types__contains=trip.vehicle_type,
        serves_lane=lane
    )

    # Sort by historical on-time delivery percentage DESC
    eligible_carriers.sort(key=lambda c: c.historical_otd_pct, reverse=True)

    if not eligible_carriers:
        trip.carrier = None
        trip.status = "NO_CARRIER"
        create_exception("NO_CARRIER_AVAILABLE", lane=lane)
        return

    trip.carrier = eligible_carriers[0]  # best SLA
```

**Fallback:** Nếu không có carrier nào cho lane → exception, planner assign thủ công.

### 4.4 Step 4: Cost Calculation

```python
def calc_cost(trip, lane):
    base_cost = lane.rate_vnd_per_km * lane.distance_km
    vehicle_multiplier = trip.vehicle_type.cost_multiplier  # 1.0 FLATBED, 1.3 CRANE
    trip.estimated_cost_vnd = base_cost * vehicle_multiplier
```

**Ví dụ UNIS:**
- Lane: Kho Bình Dương → CN Đà Nẵng = 850 km
- Rate: 15,000 VND/km
- FLATBED: 850 × 15,000 × 1.0 = 12,750,000 VND
- CRANE: 850 × 15,000 × 1.3 = 16,575,000 VND

### 4.5 Step 5: ETA Calculation

```python
def calc_eta(trip, lane):
    trip.departure_date = next_available_dispatch_date(trip.source_location)
    trip.eta = trip.departure_date + timedelta(days=lane.lead_time_days)
```

**UNIS lead times (typical):**
- Kho NM → Hub: 1-2 ngày
- Hub → CN (cùng vùng): 1-2 ngày
- Hub → CN (khác vùng): 3-5 ngày
- NM → CN (direct): 3-7 ngày

### 4.6 Step 6: Sustainability (OFF for UNIS)

```python
# UNIS: co2_tracking = OFF
trip.co2_kg = 0
trip.sustainability_score = 0
# Phase 2 nếu cần: co2_kg = distance_km * emission_factor * weight_kg
```

---

## 5. Output

### 5.1 transport_plan

| Field | Type | Description |
|---|---|---|
| transport_plan_id | UUID | PK |
| allocation_run_id | UUID | FK → allocation_run |
| tenant_id | UUID | UNIS tenant |
| created_at | TIMESTAMPTZ | Thời điểm tạo |
| status | ENUM | DRAFT, CONFIRMED, EXECUTING, COMPLETED |
| total_trips | INT | Tổng số chuyến xe |
| total_cost_vnd | DECIMAL | Tổng chi phí ước tính |

### 5.2 transport_plan_trip

| Field | Type | Description |
|---|---|---|
| trip_id | UUID | PK |
| transport_plan_id | UUID | FK |
| source_location_id | UUID | Kho xuất |
| dest_location_id | UUID | CN nhận |
| vehicle_type | ENUM | FLATBED, CRANE_TRUCK |
| carrier_id | UUID | FK → carrier |
| total_weight_kg | DECIMAL | Tổng trọng lượng |
| total_pallets | INT | Tổng số pallet |
| estimated_cost_vnd | DECIMAL | Chi phí ước tính |
| departure_date | DATE | Ngày xuất phát |
| eta | DATE | Ngày dự kiến đến |
| co2_kg | DECIMAL | 0 for UNIS |
| status | ENUM | PLANNED, DISPATCHED, IN_TRANSIT, DELIVERED |

### 5.3 transport_plan_trip_line

| Field | Type | Description |
|---|---|---|
| trip_line_id | UUID | PK |
| trip_id | UUID | FK → trip |
| allocation_result_id | UUID | FK → allocation_result |
| sku_id | UUID | SKU |
| lot_id | UUID | Lot |
| qty | DECIMAL(15,2) | Số lượng trên chuyến xe |
| weight_kg | DECIMAL | Trọng lượng |

---

## 6. API Endpoints

### 6.1 Create Transport Plan

```
POST /api/v1/transport/plan
Authorization: Bearer {token}
```

Request:
```json
{
  "allocation_run_id": "uuid-of-allocation-run"
}
```

Response:
```json
{
  "transport_plan_id": "uuid",
  "status": "DRAFT",
  "total_trips": 12,
  "total_cost_vnd": 185000000
}
```

### 6.2 Get Transport Plan

```
GET /api/v1/transport/plan/{plan_id}
  ?include=trips,trip_lines
```

### 6.3 Get Trips

```
GET /api/v1/transport/plan/{plan_id}/trips
  ?page=1&size=20
  &vehicle_type=FLATBED
  &dest_location_id={cn_id}
  &status=PLANNED
```

### 6.4 Update Trip (manual carrier change)

```
PUT /api/v1/transport/trips/{trip_id}
```

Request:
```json
{
  "carrier_id": "new-carrier-uuid",
  "departure_date": "2026-04-15",
  "note": "Carrier A không có xe, đổi sang Carrier B"
}
```

### 6.5 Confirm Transport Plan

```
POST /api/v1/transport/plan/{plan_id}/confirm
```

Confirm plan → trips chuyển PLANNED → ready for Step 7 (draft order creation).

---

## 7. Business Rules

| Rule ID | Rule | UNIS Value | Impact |
|---|---|---|---|
| TP-001 | Consolidation | **OFF** | 1 allocation batch = 1 trip set |
| TP-002 | Vehicle priority | **FLATBED first** | FFD: fill 25T trước, CRANE cho remainder |
| TP-003 | Carrier selection | **BEST_SLA** | Sort by historical_otd_pct DESC |
| TP-004 | Cost formula | rate_vnd × distance_km × vehicle_multiplier | Simple km-based |
| TP-005 | ETA formula | departure_date + lead_time_days | Per lane config |
| TP-006 | CO2 tracking | **OFF** | sustainability_score = 0 |
| TP-007 | FLATBED capacity | 25,000 kg | ~20 pallets gạch |
| TP-008 | CRANE capacity | 15,000 kg | ~12 pallets gạch |
| TP-009 | CRANE multiplier | 1.3x | 30% premium do cẩu |
| TP-010 | No-carrier fallback | Exception + manual assign | Planner chọn carrier thủ công |

### Weight Conversion (UNIS Products)

| Product | Pallet Weight (kg) | FLATBED (pallets) | CRANE (pallets) |
|---|---|---|---|
| Gạch men 60x60 | 1,200 | 20 | 12 |
| Gạch men 30x60 | 1,000 | 25 | 15 |
| Gạch ốp lát 30x30 | 900 | 27 | 16 |
| Bột trét | 800 | 31 | 18 |

---

## 8. Cross-Module Integration

### Inputs

| From | Data | Usage |
|---|---|---|
| Step 5 (Allocation) | allocation_result | Items to transport, grouped by route |
| Config | vehicle_frame | Vehicle types + capacity |
| Config | carrier | Carrier list + OTD history |
| Config | lane | Distance, lead time, rate per route |

### Outputs

| To | Data | Description |
|---|---|---|
| Step 7 (Execution) | transport_plan_trip | Trips → draft orders |
| Step 8 (Monitor) | trip metrics | Cost, ETA accuracy, carrier performance |

### Event Flow

```
Step 5 completes → allocation.run.completed
  → Transport Planning triggered
  → emit: transport.plan.created (status=DRAFT)
  → Planner reviews on FE
  → emit: transport.plan.confirmed
    → Step 7 listens: create draft orders from confirmed trips
```

---

## 9. UI Requirements

### 9.1 Transport Plan Overview

- **Summary cards:** Total trips, Total cost VND, Avg cost/trip, Total weight
- **Map view (optional Phase 2):** Source → Dest routes on Vietnam map
- **Status bar:** DRAFT / CONFIRMED / EXECUTING / COMPLETED

### 9.2 Trip List Table

| Column | Description |
|---|---|
| Trip ID | Short code |
| Route | Source → Dest (tên kho → tên CN) |
| Vehicle | FLATBED / CRANE_TRUCK |
| Carrier | Tên nhà vận chuyển + OTD% badge |
| Weight | Total kg + pallet count |
| Cost | VND formatted |
| Departure | Date |
| ETA | Date + days remaining |
| Status | Badge (PLANNED, DISPATCHED, IN_TRANSIT, DELIVERED) |

- Filter by: vehicle type, carrier, destination, status
- Sort by: departure date, cost, weight

### 9.3 Trip Detail

- Line items: SKU, Lot, Variant, Qty, Weight
- Carrier info: name, OTD%, contact
- Cost breakdown: base rate × distance × multiplier
- Timeline: departure → estimated arrival

### 9.4 Cost Summary

- Bar chart: cost per route (top 10 most expensive routes)
- Pie chart: FLATBED vs CRANE cost split
- Trend: weekly transport cost

---

## 10. Acceptance Criteria

| AC ID | Criteria | Test Method |
|---|---|---|
| AC6-01 | Group allocation results by (source→dest) correctly | Data test: multi-route allocations |
| AC6-02 | FFD bin-pack: FLATBED filled first before CRANE | Algorithm test: items > 25T |
| AC6-03 | Carrier selection: highest OTD% chosen | Config test: 3 carriers, verify top selected |
| AC6-04 | Cost = rate × distance × vehicle multiplier | Calc test: known lane + rate |
| AC6-05 | ETA = departure + lead_time_days | Calc test: known lane |
| AC6-06 | Consolidation OFF: no cross-batch trip merging | Integration test: 2 runs, verify separate trips |
| AC6-07 | CO2 = 0 for UNIS | Config test: verify sustainability OFF |
| AC6-08 | No-carrier exception raised when no carrier available | Edge test: lane with no carrier |
| AC6-09 | FLATBED capacity 25T not exceeded | Boundary test: 25,001 kg input |
| AC6-10 | Transport plan confirm triggers Step 7 | Event test: verify draft order creation |
| AC6-11 | Manual carrier change via API | E2E test: PUT trip → verify carrier updated |
| AC6-12 | Trip line items match allocation results | Data integrity test: sum qty matches |

---

*Module Spec v1.0 — Step 6: Transport Planning*
*Created: 2026-04-11 | R-BA for UNIS*
