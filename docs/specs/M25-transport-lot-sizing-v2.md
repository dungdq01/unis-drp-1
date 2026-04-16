# M25 — Transport Lot Sizing v2

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 6-7
> **Owner:** BE2 · **DA:** DA1 · **FE:** FE1
> **Status:** 🟡 EXTEND M6 (giữ trip schema, thêm hold-or-ship + top-up + multi-drop)
> **PRD:** §F2-B5 Transport Lot Sizing · **Flow:** 2 (Daily DRP, 23:45)
> **Domain:** D6 Transport
> **Feature flag:** `m25_transport_v2_enabled`
> **Folder (Rule 3):** `backend/src/transport/` (EXTEND — file mới `transport.lot-sizing.service.ts`)
> **Changelog v1.1 (post-review):** Fix C1 (held trip immutable, không append từ run mới), C2 (top-up tạo leg mới với source_type='TOP_UP_NEXT_WEEK', không mutate alloc cũ), C3 (line-to-stop mapping qua `transport_trip_line.stop_id`), C4 (held inventory reservation `reserved_for_transport`), C5 (pipeline chốt: raw → consolidate → fill → hold), C6 (NO_CARRIER block trước COMPLETED), M1-M4 medium.
> **Changelog v1.2 (CTO review):** Fix C1 (reservation đặt ở supply_snapshot_line line-level, không header), C2 (top-up query đổi cn_id → location_code đúng schema), H1 (allocation_leg top-up ownership boundary), H2 (forecast_week_offset freeze tại suggested_at), H3 (multi-drop grouping source Phase 1 chốt), H4 (hold-extend semantics chốt), H5 (exception precedence matrix), M1-M4 medium.

---

## 1. Tại sao làm bài này

M6 hiện chỉ tạo trip raw từ allocation: 1 dest CN = 1 trip. Container chở 40-50% fill bay đi vẫn phát hiện thường xuyên. Hậu quả:
- Cost/m² cao 30-40% so với benchmark
- 1 ngày 3-4 trips cùng tuyến Bắc thay vì 1 trip multi-drop
- Không có cách nào "chờ thêm 1 ngày để gom đầy"

M25 thêm 3 thứ:
1. **Hold-or-ship logic** — fill < 60% và CN HSTK > LT + buffer → HOLD 1-2 ngày chờ gom
2. **Top-up suggestion** — container chưa đầy → suggest items khác có thể ghép (forecast tuần sau, demand thấp ưu tiên)
3. **Multi-drop consolidation** — gộp nhiều CN cùng tuyến vào 1 trip với stop sequence

Container packing (pallet+tấn limit) đã có ở M6 ✅, multi-drop schema có ✅, LT+HSTK data có ✅ — chỉ thiếu logic quyết định.

---

## 2. Scope

### ✅ Thêm
- `transport_trip` extend: `fill_ratio`, `hold_decision`, `hold_until_date`, `hold_reason`, `held_at`
- Bảng mới `transport_trip_stop` (multi-drop sequence)
- Bảng mới `top_up_suggestion` (per held trip)
- Lot sizing service: compute fill_ratio + hold-or-ship decision
- Top-up suggestion service: query forecast + demand thấp items
- Multi-drop consolidation service: gộp trip cùng tuyến
- Hold release cron (mỗi sáng 06:00 VN check holds expire)
- Service `getTransportPlan(transportPlanId)` export cho M27 inject

### ❌ Không đụng
- M6 transport_trip core schema (chỉ ALTER ADD column)
- Carrier matching logic M6 (giữ nguyên)
- Vehicle type max_pallets/max_weight (đã có)
- M27 PO Review — M25 chỉ tạo trip, M27 xử lý PO
- Tracking GPS / driver app — Phase 2

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | M25 chạy ngay sau M24 (chuỗi 23:45 VN). Trigger qua `M24Service.getAllocationResult()` callback event | Sequence |
| **R2** | **Fill ratio:** `fill_ratio = MAX(total_pallets / vehicle.max_pallets, total_weight_kg / vehicle.max_weight_kg)`. Lấy max vì container có thể full pallet hoặc full tấn trước | 2D constraint |
| **R3** | **Hold decision logic:**<br>• `fill_ratio >= min_fill_ratio` (M10 default 0.6) → SHIP<br>• `fill_ratio < min_fill_ratio` AND `recipient_hstk_days > LT + buffer` → HOLD<br>• `fill_ratio < min_fill_ratio` AND `recipient_hstk_days <= LT + buffer` → SHIP (CN sắp stockout, không hold được) | Core logic |
| **R4** | **Hold max days** (M10 `transport.hold_max_days`, default 2): trip HOLD quá 2 ngày → force SHIP dù fill thấp + alert | Anti-stuck |
| **R5** | **Hold buffer** (M10 `transport.hold_buffer_days`, default 1): điều kiện HOLD = `hstk_days > LT + buffer`. Buffer là margin an toàn nếu hold thêm 1-2 ngày | Safety |
| **R6** | **Top-up suggestion** chỉ chạy khi trip HOLD: query forecast tuần tới cho cùng dest CN, suggest items có demand sắp đến mà fit được vào container còn trống | Optimize fill |
| **R7** | **Top-up acceptance**: SC Manager review + accept top-up → adjust trip + alloc_result + leg. Reject → giữ HOLD chờ cron release | Manual approval |
| **R8** | **Multi-drop consolidation**: cùng `source` + cùng tuyến (`route_id` từ M00 transport_lane.route_group hoặc cluster theo region) → gộp 1 trip với stop sequence | Reduce trips count |
| **R9** | **Stop sequence**: optimize order theo distance từ source (greedy nearest neighbor Phase 1; Phase 2 TSP optimal) | Multi-drop |
| **R10** | **Held release cron**: mỗi sáng 06:00 VN check trips status='HELD' và `hold_until_date <= today` → re-evaluate (fill có thể đã đủ ≥60% nhờ **top-up accept** trong khoảng hold, KHÔNG phải từ M24 run mới — held trip immutable, xem §4c) → SHIP hoặc continue HOLD trong cap | Daily check |
| **R11** | **Policy snapshot pin** (Rule 14): M25 reuse `policy_run_id` từ M24/M23. Configs đọc từ snapshot, KHÔNG runtime M10 | Hard rule |
| **R12** | **Idempotent**: 1 transport_plan per allocation_run. Re-run → 409 trừ khi force | Avoid duplicate |
| **R13** | **[C6 fix] NO_CARRIER hard gate** — `transport_plan.status` không được set 'COMPLETED' nếu còn bất kỳ trip status='NO_CARRIER' hoặc `carrier_code IS NULL`. `getTransportPlan()` reject với `TransportPlanIncompleteException` nếu unresolved carrier exists. SC Manager phải resolve manually (assign carrier hoặc cancel trip) trước khi M27 generate PO. | Block downstream |
| **R14** | **[C4 fix] Reservation invariant** — mọi trip status IN ('PLANNED', 'HELD') phải có `reserved_for_transport` trên supply_snapshot tương ứng. Cron daily 04:00 VN reconcile: alert nếu reservation drift > 1% | Anti double-allocation |
| **R15** | **[M3] M6 prerequisite** — M25 chỉ correct khi M6 vehicle assignment + bin-packing baseline đã đúng. BE2 verify Sprint 5 Day 1: vehicle_type lookup, fill computation per trip M6 cũ chạy đúng trên staging. Nếu M6 có drift → fix M6 trước, KHÔNG bypass trong M25. | Hard dependency |

---

## 4. Pipeline Order (C5 fix — chốt thứ tự)

**Pipeline duy nhất, không đổi order:**

```
Step 1: RAW BUILD từ allocation
        - 1 trip per (source, dest) raw từ allocation_leg
        - Trip lines = aggregated allocation results

Step 2: MULTI-DROP CONSOLIDATION (gộp TRƯỚC khi quyết hold)
        - Group trips by source + region_group
        - Pack vào vehicle theo nearest-neighbor greedy (M1 fix — xem §5)
        - Output: trips multi-drop với stops[] + line.stop_id mapping

Step 3: COMPUTE AGGREGATED FILL
        - fill_ratio per consolidated trip
        - Đảm bảo fill phản ánh sau consolidation, không phải raw

Step 4: HOLD DECISION (per consolidated trip, dùng MIN HSTK across stops)
        - effective_hstk_days = MIN(stops.recipient_hstk_days)
          (conservative: lấy stop có HSTK thấp nhất — nếu 1 CN sắp stockout, không hold cả trip)
        - Áp dụng decision tree §4b
```

### §4b — Hold-or-Ship Decision Tree (sau consolidation)

```
Per consolidated trip:

1. Compute fill_ratio = max(pallets_pct, weight_pct)  // sau consolidation
2. If fill_ratio >= 0.6:
     decision = SHIP
3. Else (fill < 60%):
     effective_hstk = MIN(stop.recipient_hstk_days for stop in trip.stops)
     lt_days = MAX(stop.lt_days for stop in trip.stops)  // worst case ETA
     buffer = M10 transport.hold_buffer_days

     If effective_hstk > (lt_days + buffer):
       → all stops safe to hold (CN nào cũng có buffer)
       decision = HOLD
       hold_until_date = today + min(hold_max_days, effective_hstk - lt_days - buffer)
       generate top_up_suggestions cho dest gần nhất hoặc multi-dest fit
     Else:
       → ít nhất 1 stop sắp stockout, không hold được
       decision = FORCE_SHIP_LOW_FILL
       alert M8: "Trip xx ship với fill X%, stop CN-Y HSTK Z ngày < threshold"
```

**Edge case:** trip HELD đã 2 ngày → force SHIP next morning cron 06:00 + alert.

### §4c — Held trip immutability (C1 fix)

**Held trip KHÔNG được append items từ run mới:**
- Run M24 hôm sau tạo allocation_run mới + transport_plan mới + trips mới hoàn toàn
- Held trip cũ chỉ thay đổi qua: (a) top-up accept (xem C2 fix §6b), (b) hold expire force ship, (c) SC Manager manual cancel
- **Lý do:** giữ allocation lineage clean — 1 trip thuộc đúng 1 allocation_run

**Cron 06:00 re-evaluate KHÔNG gom thêm items, chỉ:**
- Check `hold_until_date <= today` → SHIP nếu fill đã đủ qua top-up; FORCE_SHIP nếu hết hold_max_days
- Re-evaluate effective_hstk (CN có thể đã consume nhanh hơn dự kiến → cần force ship sớm)

---

## 5. Multi-drop Stop Sequence Algorithm (M1 fix — chốt 1 thuật toán)

**Nearest-neighbor greedy** (KHÔNG phải sort-from-source):

```
Input: source_location, list dest CNs với distance matrix CN×CN

current = source
remaining = [dest_cn_1, dest_cn_2, ...]
sequence = []
while remaining not empty:
  next_stop = argmin(distance(current, c) for c in remaining)
  sequence.push(next_stop)
  current = next_stop
  remaining.remove(next_stop)
```

Khác với "sort dest by distance from source ASC" — nearest-neighbor chọn next stop từ stop hiện tại, tránh zigzag. Phase 1 đủ tốt cho ≤10 stops/trip. Phase 2 TSP optimal nếu cần.

---

## 6. Top-up Suggestion Algorithm (Phase 1)

> **CTO C2 fix:** schema thật `demand_snapshot_line` dùng `location_code` (CN code VARCHAR), KHÔNG có `cn_id` BIGINT. Service phải lookup CN code từ `channel.cn_code` qua `primary_dest_cn_id`.

```
Input: held_trip với fill_ratio, primary_dest_cn_id, source_location, remaining_capacity, suggested_at=NOW()

0. Resolve dest_location_code từ primary_dest_cn_id: SELECT cn_code FROM channel WHERE id = primary_dest_cn_id
1. Query forecast cho dest_location_code, period_start = next_monday:
   SELECT item_code, COALESCE(reconciled_qty, qty) AS forecast_qty
   FROM demand_snapshot_line
   WHERE location_code = $dest_location_code AND period_start = $next_monday
2. Filter (M3 fix grain rõ):
   - Items có forecast_qty > 0
   - Items CHƯA được allocated cho cell (location_code, item_code, period_start=next_monday)
     (check qua allocation_leg JOIN allocation_result WHERE result.dest_location_code=X AND item_code=Y AND period_start=next_monday)
   - Items có supply_snapshot_line.allocatable_qty - reserved_qty - reserved_for_transport - in_transit_qty
     >= requested_qty AT source_location (C4 line-level reservation)
3. Sort priority:
   - Forecast_qty cao trước
   - Items có sigma cao (biến động → ship sớm an toàn)
4. Greedy fill đến khi reach max_pallets/max_weight
5. Output: top_up_suggestion rows kèm:
   - source_period_start = next_monday
   - suggested_at = NOW()  (H2 freeze cho forecast_week_offset)
   - forecast_week_offset = weeksBetween(suggested_at, source_period_start)  (H2 fix: KHÔNG dùng departure_date — có thể đổi)
```

### §6b — Top-up accept: ownership boundary chốt rõ (C2 + H1 fix)

**Vấn đề H1 (CTO):** allocation_result immutable sau COMPLETED. Top-up tạo leg mới — leg này thuộc allocation_run nào? `allocation_result_id` reference cái gì? Không thể orphan, không thể mutate row cũ.

**Decision (chốt H1):** Top-up tạo **`allocation_result` MỚI** trong **cùng allocation_run hiện tại** với flag `is_top_up=TRUE` phân biệt rõ:

```
Khi SC Manager accept top-up:

1. KHÔNG sửa allocation_result/allocation_leg cũ (immutable invariant)

2. INSERT allocation_result MỚI với:
   - allocation_run_id = current_run_id   ← CÙNG run, KHÔNG tạo run mới
   - cn_id = trip.primary_dest_cn_id
   - sku_id = topup item
   - qty_allocated = topup_qty
   - is_top_up = TRUE                     ← NEW column (M24 cross-link)
   - source_top_up_id = top_up_suggestion.id   ← NEW FK
   - source_period_start = next_monday    ← NEW column nullable
   - status = 'TOP_UP_FILL'               ← NEW status mới phân biệt

3. INSERT allocation_leg với:
   - allocation_result_id = NEW result.id (vừa tạo Step 2)
   - source_type = 'TOP_UP_NEXT_WEEK'
   - source_period_start = next_monday
   - source_entity_id = source_location lookup id (Hub hoặc NM)
   - allocated_qty = topup_qty

4. Reserve inventory line-level (C1+C4):
   UPDATE supply_snapshot_line SET reserved_for_transport += topup_qty
   WHERE location_code = trip.source_location_code AND item_code = topup.item_code

5. INSERT transport_trip_line với:
   - top_up_suggestion_id link
   - stop_id (multi-drop dest)
   - source_allocation_leg_id link new leg (Step 3)

6. Update trip totals + recompute fill_ratio

7. Audit log TOP_UP_ACCEPTED:
   { trip_id, suggestion_id, new_result_id, new_leg_id, qty, source_period_start, by }
```

**Tóm tắt ownership semantics (chốt H1):**

| Aspect | Decision |
|--------|----------|
| Result row mới hay sửa cũ? | **MỚI** — `is_top_up=TRUE`, `status='TOP_UP_FILL'` |
| Thuộc allocation_run nào? | **Cùng run hiện tại** (KHÔNG tạo run mới) |
| Old result rows | **Immutable** — invariant không vỡ |
| Leg reference | `allocation_result_id = new result.id` (KHÔNG orphan) |
| M27 PO trace | rows `is_top_up=TRUE` → PO line `is_top_up=TRUE + source_period_start` (R16) |
| M28 audit query | `WHERE is_top_up=TRUE` để track ship-ahead pattern |

**Allocation_result extend (cross-link cập nhật M24):**
- `is_top_up BOOLEAN DEFAULT FALSE`
- `source_top_up_id BIGINT NULL FK top_up_suggestion`
- `source_period_start DATE NULL`
- `status` ENUM mở rộng thêm `'TOP_UP_FILL'`

**Phase 2:** ML-based recommendation — predict items có thể demand spike.

---

## 6. User Stories (Acceptance)

### US-1: Trip đầy → ship ngay
**Given** Trip CN-BD: pallets=18/20 (90%), weight=8t/10t. **When** evaluate. **Then** decision=SHIP, status=PLANNED. M27 nhận trip.

### US-2: Trip thấp + CN có buffer → hold
**Given** Trip CN-DN: fill=45%, HSTK=10 ngày, LT=2 ngày, buffer=1. **When** evaluate. **Then** decision=HOLD, hold_until_date=today+2 (capped by hold_max_days). Trip status='HELD'. Top-up generated.

### US-3: Trip thấp + CN sắp stockout → ship dù fill thấp
**Given** Trip CN-CT: fill=40%, HSTK=2 ngày, LT=2 ngày, buffer=1. **When** evaluate. HSTK 2 < LT+buffer (3). **Then** decision=SHIP, low_fill_warning=TRUE. Alert SC Manager.

### US-4: Hold expire → cron release **(C1 fix — KHÔNG gom từ run mới)**
**Given** Trip held 2 ngày, hold_until_date=hôm nay. **When** cron 06:00 fire. **Then** re-evaluate:
- Nếu fill đã ≥ 60% (do **top-up accept** trong 2 ngày qua, KHÔNG phải allocation cycle mới) → SHIP
- Nếu vẫn thấp + còn trong hold_max_days → continue HOLD
- Nếu hết hold_max_days → FORCE_SHIP_TIMEOUT với alert "Held 2 ngày, force ship"

Trips từ allocation_run hôm sau là **transport_plan riêng**, KHÔNG merge vào held trip cũ.

### US-5: Top-up suggestion accepted
**Given** Held trip CN-DN remaining 5 pallets/3t. Suggestion: SKU-X 3 pallets/2t, SKU-Y 2 pallets/1t. **When** SC Manager accept SKU-X only. **Then** trip pallets += 3, weight += 2t, allocation_leg insert +1 cho SKU-X, fill_ratio recompute. Trip có thể SHIP nếu đủ 60%.

### US-6: Multi-drop consolidation **(M1 fix wording)**
**Given** 3 trips cùng từ Hub-HCM: CN-BD (5 pallets), CN-CT (4 pallets), CN-VT (3 pallets). Cùng group (pairwise distance ≤ 200km). Vehicle max=20 pallets. **When** consolidation nearest-neighbor từ HCM. **Then** 1 trip với 3 stops sequence theo nearest-neighbor (KHÔNG sort-from-source asc): ví dụ HCM → BD (gần nhất từ HCM) → CT (gần nhất từ BD) → VT (gần nhất từ CT). Sequence cụ thể phụ thuộc distance matrix thực tế.

### US-7: Multi-drop split nếu vượt capacity
**Given** Tổng 25 pallets, vehicle max=20. **When** consolidation. **Then** 2 trips: trip-1 (BD+CT 9 pallets), trip-2 (VT 16 pallets nếu có thêm CN khác cùng tuyến). Algo greedy fit, ưu tiên fill cao.

### US-8: Force ship sau 2 ngày
**Given** Trip held 2 ngày, fill vẫn 45%. **When** cron 06:00 ngày 3. **Then** force SHIP, status=PLANNED, alert "Trip xx force shipped sau 2 ngày hold, fill=45%".

### US-9: Idempotent reject
**Given** transport_plan cho allocation_run=42 đã COMPLETED. **When** re-trigger M25. **Then** 409 "Transport plan đã tồn tại. Force re-run cần reason."

### US-10: M27 đọc plan
**Given** transport_plan.status='COMPLETED'. **When** M27 init. **Then** gọi `M25Service.getTransportPlan(planId)` → trả Map per trip với stops + items.

### US-11: Flag off → M6 fallback
**Given** M10 `m25_transport_v2_enabled=false`. **When** trigger. **Then** skip lot sizing logic, M6 cũ chạy: 1 dest = 1 trip không hold/top-up. Log warning.

### US-12: Hold không khả thi cho freight cụ thể
**Given** Trip vận chuyển hàng chậm degrade (e.g. cement 90 days expire). **When** evaluate hold. **Then** Phase 1 KHÔNG có expire check → vẫn hold theo rules. Phase 2 thêm `expiry_aware` flag. Note risk Phase 1.

### US-13: NO_CARRIER block COMPLETED **(C6 fix)**
**Given** transport_plan có 10 trips, 2 trip status='NO_CARRIER'. **When** thử set plan.status='COMPLETED'. **Then** reject với "Plan có 2 unresolved carrier trips. Resolve hoặc cancel trước khi complete." M27 gọi `getTransportPlan()` cũng reject với `TransportPlanIncompleteException`.

### US-14: Top-up accept với source_period_start audit **(C2 + M4 fix)**
**Given** Held trip CN-DN, top-up suggestion {SKU-X, 3 pallets, source_period_start=2026-04-27 (next week)}. **When** SC Manager accept. **Then**:
- Insert NEW `allocation_leg` với `source_type='TOP_UP_NEXT_WEEK', source_period_start=2026-04-27`
- KHÔNG sửa `allocation_result` của run hiện tại
- `supply_snapshot.reserved_for_transport += 3*pallet_size`
- `transport_trip_line` mới insert với `top_up_suggestion_id=Y, stop_id=Z`
- Audit log TOP_UP_ACCEPTED với forecast_week_offset=1

### US-15: Reservation invariant **(C4 fix)**
**Given** Trip A status='HELD' với 100m² SKU-X từ supply_snapshot S1. M24 cycle hôm sau chạy. **When** M24 load supply. **Then** `available_qty(S1) = qty - reserved_for_transport(100) - in_transit`. M24 KHÔNG alloc 100m² này lần nữa.

### US-16: Multi-drop line-to-stop mapping **(C3 fix)**
**Given** Trip multi-drop 3 stops: stop_1=CN-BD, stop_2=CN-CT, stop_3=CN-VT. **When** generate trip_lines. **Then** mỗi line có `stop_id` chỉ chính xác stop nào unload. Warehouse query `WHERE trip_id=X AND stop_id=stop_2` → list items unload tại CN-CT.

---

## 7. Data Contract

### `transport_trip` extend (giữ M6 schema)
| Field thêm | Mô tả |
|------------|-------|
| `fill_ratio` DECIMAL(5,4) | Computed `MAX(pallets_pct, weight_pct)` 0-1 |
| `hold_decision` VARCHAR(15) | `SHIP / HOLD / FORCE_SHIP_LOW_FILL / FORCE_SHIP_TIMEOUT` |
| `hold_until_date` DATE NULL | Khi HOLD |
| `hold_reason` TEXT NULL | "Fill 45%, CN HSTK 10d, holdable" hoặc "Force ship: CN stockout risk" |
| `held_at` TIMESTAMP NULL | Khi status → HELD |
| `is_multi_drop` BOOLEAN DEFAULT FALSE | Có nhiều stops |
| `stop_count` INT DEFAULT 1 | 1 = single-drop, 2+ = multi-drop |
| `policy_run_id` BIGINT NULL FK policy_run | Rule 14 reuse từ M24 |
| `status` ENUM extend | Thêm: `HELD` |

### `transport_trip_stop` (mới — multi-drop UNLOAD only Phase 1)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `trip_id` BIGINT FK transport_trip | |
| `stop_sequence` INT | 1, 2, 3, ... theo nearest-neighbor (§5) |
| `location_code` VARCHAR(20) FK location | CN dest (chỉ UNLOAD) |
| `pallets_at_stop` INT | Aggregated từ trip lines map vào stop này |
| `weight_kg_at_stop` DECIMAL(10,2) | Aggregated từ trip lines |
| `eta_at_stop` DATE NULL | ETA tới stop này |
| `arrived_at` TIMESTAMP NULL | Phase 2 GPS tracking |
| Composite UNIQUE | `(trip_id, stop_sequence)` |

> **M2 fix:** Phase 1 chỉ UNLOAD ở dest stops. Source location KHÔNG là 1 stop record (đã có ở `transport_trip.source_location_code`). KHÔNG có `action` ENUM. Phase 2 nếu cần multi-source pickup (LOAD ở nhiều source) → thêm `action ENUM('LOAD','UNLOAD')` + cho phép source stops.

### `transport_trip_line` extend (C3 fix — line-to-stop mapping)

| Field thêm | Mô tả |
|------------|-------|
| `stop_id` BIGINT NULL FK transport_trip_stop | Stop nào unload line này (NULL cho single-drop trips Phase 1) |
| `source_allocation_leg_id` BIGINT NULL FK allocation_leg | Trace line ngược về allocation source (lot, donor) |
| `top_up_suggestion_id` BIGINT NULL FK top_up_suggestion | Nếu line từ top-up accept (C2) thay vì allocation original |

> **Tại sao:** Multi-drop execution cần biết SKU nào unload ở stop nào. Warehouse + driver app dùng `WHERE trip_id=X AND stop_id=Y` → list items unload tại stop. M27 PO Review breakdown per stop.

### `supply_snapshot_line` reservation extend (C1 + C4 fix — line-level)

> **CTO C1 fix:** Reservation phải ở **line-level** (`supply_snapshot_line`), KHÔNG ở header. Lý do: reservation grain = (location_code × item_code), khớp với allocation grain. Header level không có item/location info.

| Bảng | Field thêm | Mô tả |
|------|------------|-------|
| `supply_snapshot_line` | `reserved_for_transport` DECIMAL(15,2) DEFAULT 0 | Qty đã reserve cho trips status='HELD' hoặc 'PLANNED' chưa DISPATCHED, per (location_code × item_code) |

**Available qty (M23/M24 cycle mới đọc):**
```
available_qty = supply_snapshot_line.allocatable_qty
              - supply_snapshot_line.reserved_qty       (existing column)
              - supply_snapshot_line.reserved_for_transport  (M25 NEW)
              - supply_snapshot_line.in_transit_qty
```

**Reservation lifecycle (per trip line):**
- Trip line CREATED (PLANNED hoặc HELD) → `UPDATE supply_snapshot_line SET reserved_for_transport += line.qty WHERE location_code = trip.source_location AND item_code = line.item_code`
- Trip DISPATCHED → reservation released: `reserved_for_transport -= qty`, đồng thời `allocatable_qty -= qty` (đã ship)
- Trip CANCELLED → `reserved_for_transport -= qty` (return to available pool)
- Top-up ACCEPTED → tăng reservation cho line mới thêm

> M23 spec đã update Step 5: load supply phải dùng `available_qty` công thức trên (line-level), KHÔNG dùng `qty` raw header.

**Cron reconcile (R14)** — daily 04:00 VN: query `SUM(line.qty) WHERE trip_id IN (PLANNED, HELD)` GROUP BY (location, item) → so với `supply_snapshot_line.reserved_for_transport`. Drift > 1% → alert.

### `top_up_suggestion` (mới — M4 fix audit fields)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `trip_id` BIGINT FK transport_trip | Trip đang HELD |
| `item_code` VARCHAR(50) FK sku | |
| `suggested_qty` DECIMAL(15,2) | |
| `estimated_pallets` INT | |
| `estimated_weight_kg` DECIMAL(10,2) | |
| `reason` VARCHAR(100) | "Forecast next week + low alloc" |
| `priority_score` INT | 1-100, sort suggestion |
| `status` VARCHAR(15) | `PENDING / ACCEPTED / REJECTED` |
| `reviewed_by`, `reviewed_at` | |
| `source_period_start` DATE NOT NULL | **M4 fix:** Tuần forecast gốc (Monday). KHÔNG = trip departure date. M27/M28 audit "ship sớm hơn forecast period bao nhiêu tuần". |
| `suggested_at` TIMESTAMP NOT NULL DEFAULT NOW() | **H2 fix:** Freeze thời điểm tạo suggestion để compute offset stable. KHÔNG dùng `trip.departure_date` (có thể đổi sau hold extend). |
| `forecast_week_offset` INT NOT NULL | Số tuần chênh = `weeksBetween(suggested_at, source_period_start)`. Compute 1 lần lúc tạo, immutable. Default 1 (next week). |
| `demand_source` VARCHAR(20) NOT NULL | `M11_FORECAST / M22_ADJUSTED / FC_RAW` — nguồn demand input |
| `created_at` | |

### API chính

```
# Run lifecycle (auto từ M24 callback)
POST  /api/v1/transport/v2/run?allocationRunId=     # Manual trigger nếu cần
GET   /api/v1/transport/v2/plans?status=&limit=     # List plans
GET   /api/v1/transport/v2/plans/:id                # Detail + summary stats

# Trip operations
GET   /api/v1/transport/v2/plans/:id/trips?status=  # List trips của plan
GET   /api/v1/transport/v2/trips/:id                # Trip detail + stops + top-up
GET   /api/v1/transport/v2/trips/:id/stops          # Stops sequence
POST  /api/v1/transport/v2/trips/:id/release        # SC Manager force release HELD trip
POST  /api/v1/transport/v2/trips/:id/hold-extend    # SC Manager extend hold (max 2 days vẫn áp dụng)

# Top-up
GET   /api/v1/transport/v2/trips/:id/top-up         # Suggestions cho trip HELD
POST  /api/v1/transport/v2/top-up/:suggestionId/accept
POST  /api/v1/transport/v2/top-up/:suggestionId/reject

# Internal (M27 inject)
# Method: M25Service.getTransportPlan(transportPlanId): TransportPlanDto
```

**Folder structure:**
```
backend/src/transport/
├── transport.service.ts                  ← M6 cũ (giữ làm fallback)
├── transport.lot-sizing.service.ts       ← M25 hold-or-ship
├── transport.multi-drop.service.ts       ← Consolidation + stop sequence
├── transport.top-up.service.ts           ← Suggestion engine
├── transport.controller.ts               ← M6 + M25 routes
└── entities/
    ├── transport-plan.entity.ts           ← giữ
    ├── transport-trip.entity.ts           ← extend
    ├── transport-trip-stop.entity.ts      ← mới
    └── top-up-suggestion.entity.ts        ← mới
```

---

## 8. Cron Schedule

| Cron | Schedule (VN) | Purpose |
|------|---------------|---------|
| **Held release** | `0 6 * * *` (06:00 VN) | Re-evaluate trips status='HELD' với hold_until_date <= today |
| **Force ship timeout** | trong cùng cron 06:00 | Trips held >= max_hold_days → force SHIP + alert |

Decorator: `@Cron(..., { timeZone: 'Asia/Ho_Chi_Minh' })`.

> KHÔNG cron riêng cho M25 main run — trigger qua M24 event sau allocation COMPLETED 23:30.

---

## 9. Non-functional

- Lot sizing run < **2 phút** cho 100 trips (sau M24 3 phút)
- Multi-drop consolidation < 30s (greedy algo)
- Top-up suggestion query < 1s per held trip
- Result query < 2s với pagination

---

## 10. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `transport_lane` LT_hub, distance | Multi-drop sort + LT for hold buffer |
| **M00** `vehicle_type` max_pallets/max_weight | Compute fill_ratio |
| **M00** `sku.weight_kg, sku.volume_m3` | Compute pallet count + weight |
| **M00 minor m1 fix** lane_type column | Filter HUB_TO_CN vs CN_TO_CN |
| **M10** configs | `transport.min_fill_ratio`, `transport.hold_max_days`, `transport.hold_buffer_days` |
| **M10** feature flag `m25_transport_v2_enabled` | Rollback |
| **M24** `getAllocationResult()` | Trip raw input từ allocation legs |
| **M24** policy_run_id (Rule 14 reuse) | Pin configs |
| **M11/M1** demand snapshot | Top-up forecast lookup |
| **M2/M21** supply_snapshot | Top-up availability check |
| **M8** HSTK calculation (existing) | Hold decision input (`recipient.HSTK`) |

| Feeds | Why |
|-------|-----|
| **M27 PO Review** | `getTransportPlan(planId)` → trip → order_batch generation |
| **M28 Feedback** | Stats: avg fill, hold rate, top-up acceptance, multi-drop savings |
| **M8 Alerts** | Force ship low-fill, hold timeout, multi-drop split warnings |

---

## 11. DoD

- [ ] `transport_trip` migration extend (8 columns + ENUM HELD) + .down.sql
- [ ] **[C3 fix]** `transport_trip_line` ALTER ADD `stop_id`, `source_allocation_leg_id`, `top_up_suggestion_id`
- [ ] **[C1 CTO fix]** `supply_snapshot_line` (LINE-LEVEL, không header) ALTER ADD `reserved_for_transport DECIMAL(15,2) DEFAULT 0`
- [ ] **[C4 fix]** Reservation lifecycle service per (location_code × item_code): trip line CREATED → reserve, DISPATCHED → release, CANCELLED → unreserve
- [ ] **[C4 fix]** Cron daily 04:00 reconcile reservation drift > 1% → alert
- [ ] **[H1 CTO fix]** Top-up tạo NEW `allocation_result` với `is_top_up=TRUE, status='TOP_UP_FILL'` trong cùng allocation_run (KHÔNG mutate row cũ, KHÔNG tạo run mới)
- [ ] **[H2 CTO fix]** `top_up_suggestion.suggested_at` freeze tại creation time. `forecast_week_offset = weeksBetween(suggested_at, source_period_start)` immutable
- [ ] **[H3 CTO fix]** Multi-drop grouping Phase 1 = pairwise distance ≤ 200km (union-find), KHÔNG dùng region_group/route_group (không tồn tại schema)
- [ ] **[H4 CTO fix]** Hold-extend hard cap tại `held_at + hold_max_days`. Reject 409 nếu đã đạt cap
- [ ] **[H5 CTO fix]** Single exception `TransportPlanIncompleteException` với matrix precedence (NOT_COMPLETED > NO_CARRIER > pass)
- [ ] **[M4 CTO fix]** `transport_trip.status` transition matrix đầy đủ + service `transitionTrip()` validate
- [ ] **[C6 fix]** NO_CARRIER hard gate: `transport_plan.markComplete()` reject nếu còn unresolved carrier
- [ ] **[C6 fix]** `getTransportPlan()` throw `TransportPlanIncompleteException` nếu còn NO_CARRIER trips
- [ ] **[C1 fix]** Held trip immutable enforcement: M25 service KHÔNG append items vào trip status='HELD' từ run mới (chỉ via top-up accept)
- [ ] **[C2 fix]** `allocation_leg.source_type` ENUM mở rộng thêm 'TOP_UP_NEXT_WEEK' (cập nhật M24 spec cross-link)
- [ ] **[C2 fix]** Top-up accept tạo NEW leg + reserve, KHÔNG mutate alloc_result cũ
- [ ] 2 tables mới: `transport_trip_stop` (composite UNIQUE seq, UNLOAD only Phase 1), `top_up_suggestion` (kèm source_period_start, forecast_week_offset, demand_source per M4)
- [ ] Lot sizing service — fill_ratio compute + hold decision tree (R3)
- [ ] Multi-drop consolidation service — gộp trips cùng tuyến + stop sequence
- [ ] Top-up suggestion service — query + priority score
- [ ] Top-up accept/reject endpoints với recompute fill
- [ ] Held release cron 06:00 VN với re-evaluate logic
- [ ] Force ship timeout (R4)
- [ ] Policy snapshot reuse từ M24 (R11)
- [ ] M24 callback event listener `@OnEvent('AllocationRunCompleted')`
- [ ] Idempotent run check (R12)
- [ ] `getTransportPlan(planId)` injectable cho M27
- [ ] Performance < 2 phút cho 100 trips
- [ ] FE: Transport plan list + trip table với hold/ship badges
- [ ] FE: Trip detail với stops sequence map view
- [ ] FE: Top-up review queue (held trips) với accept/reject
- [ ] FE: Held trips dashboard với hold_until countdown
- [ ] FE: Multi-drop visualization (route line trên map)
- [ ] Alert M8: force_ship_low_fill, hold_timeout, multi_drop_split
- [ ] Audit log: hold/release/top-up actions
- [ ] Feature flag wrapper — off → fallback M6 logic
- [ ] QA: 12 user stories pass

---

## 12. Out of Scope

- **GPS tracking + driver app** — Phase 2
- **POD (Proof of Delivery)** — Phase 2 (M27 will add)
- **Cost optimization** (cheapest carrier per route) — Phase 2 (Phase 1 dùng `estimated_cost_vnd` từ M6 simple)
- **Real-time route optimization** (TSP optimal) — Phase 1 greedy nearest neighbor đủ
- **Expiry-aware hold** (hàng hết hạn không được hold) — Phase 2
- **3D bin packing** (volume + shape) — Phase 1 chỉ pallets + weight
- **Carrier capacity reservation** — Phase 2
- **Backhaul optimization** — Phase 2
- **Multi-source consolidation** (1 trip lấy từ 2 sources) — Phase 2

---

## 13. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| min_fill_ratio 60% có quá thấp/cao? | Theo PRD F2-B5 default 60%. M10 config adjust được. Phase 1 review sau 1 tháng vận hành. |
| Hold max 2 ngày — sao không 3-5 ngày? | PRD spec 2 ngày. Buffer protection: CN HSTK consumed nhanh, hold lâu = stockout risk. M10 config adjust nếu cần. |
| Stop sequence Phase 1 greedy đủ chưa? | Yes. 50 CN × 5 stops avg = 250 stops/run. Greedy O(n²) = 62500 ops < 100ms. Phase 2 TSP optimal nếu cần (>100 stops). |
| Top-up Phase 1 simple priority đủ? | Yes. Sort theo demand desc + sigma desc + supply available. Phase 2 ML predict demand spike. |
| M24 fallback nếu không có data | Skip lot sizing layer. M6 raw build trip. Log warning. M27 vẫn xử lý được. |
| Multi-drop tuyến — định nghĩa thế nào? **(H3 CTO fix — chốt schema thật)** | **Phase 1 dùng heuristic distance-only:** group dest CNs có pairwise distance ≤ 200km (lookup `transport_lane.distance_km` lane_type='CN_TO_CN'). KHÔNG dùng `region_group`/`route_group` (KHÔNG tồn tại trong transport_lane schema thật). Phase 2 thêm `channel.region` lookup từ M00 (CN-BD/CN-DN/CN-CT = Nam, etc.) hoặc cluster ML. |
| Held trip có đếm vào allocated qty không? | Có. Allocation đã commit, chỉ chậm ship. KPI track: avg ship delay (held days). |
| Top-up acceptance của ai? | SC Manager. Phase 2 có thể auto-accept nếu top-up từ same SKU + score > threshold. |
| Hold extend manually có giới hạn? **(H4 CTO fix — chốt semantics)** | **Extend = dời `hold_until_date` thêm N ngày, NHƯNG hard cap tại `held_at + hold_max_days`** (KHÔNG bao giờ vượt). Behavior:<br>• `new_hold_until = min(current_hold_until + extend_days, held_at + hold_max_days)`<br>• Nếu `new_hold_until == current_hold_until` (đã đạt cap) → reject 409 "Trip đã đạt hard cap hold_max_days. Force ship hoặc cancel."<br>• Nếu trong khung còn → 200 OK, audit log HOLD_EXTENDED với delta_days |
| **[C1] Cross-cycle hold append?** | **KHÔNG.** Held trip immutable từ allocation_run khác. Chỉ thay đổi qua top-up (cùng run) hoặc force ship. Run mới = transport_plan mới. Lý do: lineage allocation phải clean. |
| **[C2] Top-up mutate alloc cũ?** | **KHÔNG.** Tạo NEW leg `source_type='TOP_UP_NEXT_WEEK'` với `source_period_start`. Allocation_result của run hiện tại immutable sau COMPLETED. |
| **[C3] Multi-drop line-to-stop?** | `transport_trip_line.stop_id` FK transport_trip_stop. Phase 1 single-drop trip → stop_id=NULL OK. Multi-drop bắt buộc set. |
| **[C4] Held inventory reservation?** | `supply_snapshot.reserved_for_transport` column. M23 load supply phải dùng `available = qty - reserved - in_transit`. Cron 04:00 reconcile drift. |
| **[C5] Pipeline order?** | RAW → CONSOLIDATE → FILL → HOLD. Fill computed sau consolidation. Hold dùng MIN(stops.HSTK), worst case ETA. |
| **[C6] NO_CARRIER block?** | Hard gate: plan KHÔNG complete được, M27 KHÔNG đọc được nếu còn unresolved. SC Manager resolve manually trước. |
| **[H5 CTO fix] `getTransportPlan()` exception precedence?** | **Chốt 1 exception duy nhất + matrix precedence** (loại bỏ 2 exception names mâu thuẫn):<br>`TransportPlanIncompleteException` extends BadRequestException với field `reasons[]`. Check theo precedence:<br>1. `plan.status NOT IN ('COMPLETED', 'COMPLETED_PARTIAL')` → throw với reason='NOT_COMPLETED'<br>2. EXISTS trip status='NO_CARRIER' OR carrier_code IS NULL → throw với reason='NO_CARRIER' + trip_ids[]<br>3. EXISTS trip status='HELD' → KHÔNG throw (held là intentional, M27 vẫn process trips PLANNED khác)<br>4. PASS → trả TransportPlanDto<br>**Exception cũ** `TransportPlanIncompleteException` + `TransportPlanIncompleteException` → consolidate thành 1 (deprecated, dev không dùng). |

---

## 14. Lưu ý cho dev

1. **`getTransportPlan(planId)` injectable** — M27 inject. Trả `TransportPlanDto`: `{ planId, allocationRunId, generatedAt, trips: TripDto[] }` với mỗi trip có `stops[], topUpAccepted[], holdInfo`. Throw `TransportPlanIncompleteException` nếu chưa COMPLETED.

2. **Hold decision pattern** — service method `decideHoldOrShip(trip, recipient)`:
   ```typescript
   const fillRatio = Math.max(
     trip.totalPallets / vehicle.maxPallets,
     trip.totalWeightKg / vehicle.maxWeightKg
   );
   if (fillRatio >= config.minFillRatio) return { decision: 'SHIP' };
   const hstkDays = await m8Service.getHstkDays(recipient.cnId);
   const ltDays = trip.leadTimeDays;
   if (hstkDays > ltDays + config.holdBufferDays) {
     const holdDays = Math.min(config.holdMaxDays, hstkDays - ltDays - config.holdBufferDays);
     return { decision: 'HOLD', holdUntilDate: addDays(today, holdDays) };
   }
   return { decision: 'FORCE_SHIP_LOW_FILL', alert: true };
   ```

3. **[M1 + H3 fix] Multi-drop consolidation algo** — chốt **nearest-neighbor greedy** với grouping distance-only Phase 1:
   ```
   // Step A — Group dests by pairwise distance ≤ 200km (H3 fix, KHÔNG dùng region_group)
   For each source_location:
     dests = collect all dest_location_codes from raw trips with same source
     groups = clusterByPairwiseDistance(dests, max_distance_km=200)
       // Algo: union-find — 2 dests cùng group nếu distance(A,B) ≤ 200km

   // Step B — Per group: nearest-neighbor sequence
   For each group:
     sequence = []
     current = source_location
     remaining = group.dests.slice()
     while remaining not empty:
       next = argmin(distance(current, d) for d in remaining)  ← từ CURRENT, KHÔNG từ source
       if vehicle.capacity not exceeded by adding next:
         sequence.push(next); remaining.remove(next); current = next
       else:
         finalize current trip with sequence; start new trip with current = source_location
   ```
   **Khác biệt với "sort-from-source ASC":** nearest-neighbor chọn next stop từ vị trí hiện tại (không zigzag). Sort-from-source chỉ sort 1 lần — sai khi có >2 stops.

   **Distance lookup:** preload `transport_lane WHERE lane_type='CN_TO_CN' AND distance_km ≤ 500` Map<"from|to", distance>. M00 m1 fix đã ALTER lane_type column.

4. **Top-up query optimization** — preload supply_snapshot grouped by source_location, demand_snapshot per cn next-week. Avoid N+1 query trong loop generate suggestions.

5. **Cron held release** — query `WHERE status='HELD' AND hold_until_date <= today`. Per trip:
   - Re-compute fill (do top-up accept trong khoảng hold — KHÔNG phải gom items từ allocation_run mới, vì held trip immutable §4c)
   - If fill >= 60% → SHIP
   - If held >= max_days → FORCE_SHIP + alert
   - Else → continue HOLD (rare, chỉ khi config thay đổi giữa chừng)

6. **Stop sequence ETA computation** — `eta_at_stop[i] = departure + Σ transit_lt[stop[0]→stop[i]]`. Lookup transport_lane per pair.

7. **Vehicle utilization tracking** — log per trip: `vehicle_type, fill_ratio, multi_drop_count`. M28 weekly KPI: avg fill, hold rate, multi-drop savings = (single_trip_count_baseline - actual_trips_count).

8. **M6 fallback flow** — khi flag off:
   - Skip lot sizing service
   - Call existing M6 `transport.service.ts` raw build
   - Trips status='PLANNED' direct (no HELD)
   - M27 vẫn nhận được trip data

9. **Folder Rule 3 check:** EXTEND `src/transport/`. File mới `transport.lot-sizing.service.ts`, `transport.multi-drop.service.ts`, `transport.top-up.service.ts`. KHÔNG tạo `src/transport-v2/` hoặc `src/lot-sizing/`.

10. **Audit log structure** — events: `TRIP_HELD, TRIP_RELEASED, HOLD_EXTENDED, TOP_UP_SUGGESTED, TOP_UP_ACCEPTED, TOP_UP_REJECTED, FORCE_SHIP_TIMEOUT, FORCE_SHIP_LOW_FILL, MULTI_DROP_CONSOLIDATED, TRIP_CANCELLED`. Ghi `trip_id, action, by, reason, snapshot_data` JSONB.

11. **[M4 CTO fix] `transport_trip.status` transition matrix đầy đủ:**

    | Từ | → Cho phép | Mandatory fields | Ghi chú |
    |----|-----------|------------------|---------|
    | `(none)` → PLANNED | Raw build từ allocation | source, dest, vehicle_type | Initial state |
    | PLANNED → HELD | Hold decision §4b | hold_until_date, hold_reason | Conditional fill < 60% + safe |
    | PLANNED → NO_CARRIER | M6 carrier matching fail | exception_note | M6 existing |
    | NO_CARRIER → PLANNED | SC Manager assign carrier manual | carrier_code | Resolve manually |
    | HELD → PLANNED | Cron release fill ≥ 60% sau top-up | (none) | Recompute fill |
    | HELD → CANCELLED | SC Manager cancel + reason | cancel_reason min 20 chars | Release reservation |
    | PLANNED → CANCELLED | SC Manager cancel + reason | cancel_reason | Release reservation |
    | PLANNED → DISPATCHED | M27 PO confirm + carrier ship | actual_departure_date | Existing M6 |
    | DISPATCHED → DELIVERED | CN nhận hàng | actual_arrival_date | Existing M6 |
    | DISPATCHED/DELIVERED → CANCELLED | KHÔNG allowed | — | Hàng đã trên đường |

    `hold_decision` (`SHIP / HOLD / FORCE_SHIP_LOW_FILL / FORCE_SHIP_TIMEOUT`) là **field riêng**, KHÔNG nằm trong `status` ENUM. Hold_decision lưu lý do, status lưu lifecycle.

    Service `transitionTrip(tripId, newStatus, fields)` validate matrix + mandatory fields. Vi phạm → `InvalidTripTransitionException` 409.

---

*M25 Transport Lot Sizing v2 Spec v1.2 — 2026-04-17 (CTO review fix: 2 critical + 5 high + 4 medium)*
