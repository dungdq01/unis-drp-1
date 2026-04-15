# Module Spec — Step 5: Allocation Engine

> **6-Layer Sequential Matching** — Ghép demand (planned orders từ DRP) với supply (lots tại kho)
> ADR Reference: ADR-v3-001 (Sequential Layer Architecture)

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ khỏi tất cả SQL/Python (`D-MD-03`)
> - **Item PK:** `item_code VARCHAR` thay `item_id BIGINT` (`D-MD-01`)
> - **Location PK:** `location_code VARCHAR` thay `location_id BIGINT` (`D-MD-02`)
> - **`allocation_run.tenant_id`** column: bỏ
> - **RTM lookup:** dùng bảng `rtm_rule` từ `00-master-data.md §6`, không dùng `location_relationship`

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

DRP đã cho biết "CN Đà Nẵng cần 500 thùng gạch 60x60 tuần tới". Nhưng **hàng đó ở kho nào?**
Allocation Engine trả lời câu hỏi này bằng cách ghép nhu cầu với kho hàng thực tế,
theo thứ tự ưu tiên từ 6 tiêu chí (layers):

```
Layer 1: Lấy từ kho gần nhất theo RTM rules (P1 trước)
Layer 2: Ghép đúng mã màu/kích thước (variant)
Layer 3: FEFO (hàng sắp hết hạn xuất trước) → TẮT cho gạch men (không hết hạn)
Layer 4: Ưu tiên theo ABC (A-class được fill trước khi thiếu hàng)
Layer 5: Giữ đủ Safety Stock — không lấy hàng nếu làm kho nguồn dưới SS
Layer 6: LCNB — phát hiện chi nhánh vay mượn hàng lẫn nhau (Phase 4)
```

> **Ví dụ thực tế:** CN Đà Nẵng cần 500 thùng. Kho WH-DN-001 còn 800 thùng, SS = 400.
> Hệ thống chỉ cấp 400 thùng (giữ lại 400 cho SS). Thiếu 100 → fallback P2 = NM-CENTRAL.

**Người dùng chính:** Kế hoạch viên (sc_planner)

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **Kế hoạch viên** | Trigger allocation run, review kết quả, xử lý partial allocation |
| **SC Manager** | Review các trường hợp không phân bổ được (exception) |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là Kế hoạch viên**, tôi muốn **chạy Allocation** sau DRP để biết hàng lấy từ kho nào | Allocation run hoàn thành, kết quả per item × source_wh × dest_branch |
| US-02 | **Là Kế hoạch viên**, tôi muốn **xem tỷ lệ fill rate** (bao nhiêu % demand được đáp ứng) để đánh giá kế hoạch | Summary: total demand vs total allocated, fill rate % per ABC class |
| US-03 | **Là Kế hoạch viên**, tôi muốn **xem partial allocation** — những đơn chỉ đáp ứng được 1 phần để biết cần xử lý gì | Danh sách items có allocated_qty < required_qty, kèm lý do (stockout P1, P2, P3) |
| US-04 | **Là Kế hoạch viên**, tôi muốn **xem phân bổ theo kho nguồn** để cân bằng tải giữa các kho | Bảng: WH → tổng xuất, tỷ lệ so với capacity |
| US-05 | **Là Kế hoạch viên**, tôi muốn **export allocation results** để gửi cho bộ phận vận tải (Step 6) | CSV/Excel với source → dest → item → qty |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Allocation đủ hàng (Happy Path)

```
1. DRP xong, 1,247 planned orders sẵn sàng
2. Kế hoạch viên bấm "Run Allocation"
3. Hệ thống chạy 6-layer matching: 45 giây
4. Kết quả: "1,189/1,247 orders ALLOCATED (95.3%), 58 PARTIAL"
5. Fill rate A-class: 98.2%, B-class: 94.1%, C-class: 88.5%
6. Kế hoạch viên xem 58 partial → 40 cái chỉ thiếu nhỏ (<10%) → chấp nhận
7. 18 cái thiếu nhiều → leo thang lên SC Manager
```

#### ❌ Kịch bản 2 — Kho P1 hết hàng, fallback P2 (Sad Path)

```
1. Allocation Layer 1: WH-DN-001 chỉ còn 200 thùng, cần 500 → partial
2. Layer 1 lấy 200 từ WH-DN-001 (giữ SS 400)
3. Thiếu 300 → fallback Layer 1 P2: NM-CENTRAL (xa hơn, lead time +2 ngày)
4. NM-CENTRAL còn 1,500 → lấy 300 từ đây
5. Kết quả: ALLOCATED từ 2 nguồn, CN được giao 500 thùng tổng
6. Planner thấy split source → confirm hoặc điều chỉnh thủ công
```

#### ⚠️ Kịch bản 3 — Variant không khớp (Sad Path)

```
1. CN Huế đặt 200 thùng GACH-60x60-A4 (màu A4)
2. Allocation Layer 2: WH-HN-001 còn 500 thùng GACH-60x60-B2 (màu B2)
3. Layer 2 từ chối — variant không match
4. Fallback: tìm kho khác có màu A4 → WH-DN-001 còn 150 → PARTIAL 150/200
5. Exception: "GACH-60x60-A4: thiếu 50 thùng, không có kho nào còn đủ màu A4"
```

---

### 0.4 Thuật ngữ

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **Allocation** | Phân bổ hàng từ kho → chi nhánh dựa trên nhu cầu từ DRP |
| **ALLOCATED** | Đã ghép đủ hàng cho đơn này |
| **PARTIAL** | Chỉ đáp ứng được một phần nhu cầu (do thiếu hàng tại tất cả kho nguồn) |
| **Fill Rate** | Tỷ lệ % demand được đáp ứng = allocated / required |
| **Variant** | Mã màu/kích thước của gạch — phải ghép đúng (không thể thay màu tùy tiện) |
| **LCNB** | Lateral Cross-Network Balancing — phát hiện CN vay mượn hàng lẫn nhau (Phase 4) |

---

## 1. Purpose

Allocation Engine nhận planned_order_release từ Step 4 (DRP Netting) và tìm cách ghép
với inventory lots tại các kho nguồn. UNIS sử dụng **6-layer sequential filter** — mỗi layer
loại dần các lots không phù hợp, KHÔNG chạy parallel.

**Tại sao sequential?** Mỗi layer phụ thuộc kết quả layer trước. Layer 1 chọn kho nguồn,
Layer 2 lọc variant, Layer 3 FEFO (disabled), Layer 4 phân bổ fair-share khi thiếu hàng,
Layer 5 bảo vệ safety stock, Layer 6 phát hiện hàng dư ở CN lân cận.

**Kết quả cuối:** allocation_result — danh sách (lot, qty, source→dest) sẵn sàng cho
Transport Planning (Step 6) và Execution Bridge (Step 7).

---

## 2. UNIS Context

| Dimension | UNIS Value | Giải thích |
|---|---|---|
| Sản phẩm | Gạch men, gạch ốp lát, bột trét | Không hết hạn → FEFO=OFF |
| Variant matching | specs_id_mode = VARIANT | Đuôi màu (A4, B2, C1) — khách yêu cầu CÙNG đuôi trong 1 đơn |
| Network | 68 CN + 19 kho + 56 NM | Multi-source, cần RTM rules rõ ràng |
| LCNB | DETECT_ONLY | Phase 1: chỉ gợi ý lateral transfer, không tự động |
| Concurrency | Optimistic locking | 3 retry × exponential backoff |
| Dispatch limit | 800 pallets/day | Giới hạn năng lực xếp hàng tại kho xuất |

**Đặc thù UNIS so với MDLZ:**
- FEFO hoàn toàn tắt (building materials không hết hạn)
- Variant matching là CRITICAL — sai đuôi màu = khách trả hàng
- LCNB chỉ detect, không auto-transfer (Phase 1 conservative)
- Dispatch limit cao hơn (800 vs MDLZ 500) do quy mô kho lớn

---

## 3. Input

### 3.1 Primary Input — Planned Orders (from Step 4)

```
Source: planned_order_release table
Trigger: plan_run.status = COMPLETED
```

| Field | Type | Description |
|---|---|---|
| planned_order_release_id | UUID | PK |
| plan_run_id | UUID | FK → plan_run |
| sku_id | UUID | FK → item master |
| dest_location_id | UUID | CN yêu cầu hàng |
| qty_planned | DECIMAL(15,2) | Số lượng cần (từ DRP netting) |
| need_date | DATE | Ngày CN cần nhận hàng |
| priority | INT | Từ DRP: urgency level |
| specs_id | VARCHAR | Variant code (vd: "GACH-MEN-60x60-A4") |

### 3.2 Supply Data (from Step 2)

```
Source: lot_attribute table (latest supply_snapshot)
```

| Field | Type | Description |
|---|---|---|
| lot_id | UUID | PK |
| sku_id | UUID | FK → item master |
| location_id | UUID | Kho chứa lot |
| qty_available | DECIMAL(15,2) | Số lượng khả dụng (chưa bị allocated) |
| specs_id | VARCHAR | Variant code of this lot |
| lot_status | ENUM | AVAILABLE, RESERVED, BLOCKED |

### 3.3 Policy Data (from Step 3)

| Source | Data | Usage |
|---|---|---|
| rtm_rule | source priorities per CN per SKU | Layer 1 |
| item_classification | ABC class (A/B/C) | Layer 4 |
| safety_stock | SS target per SKU per location | Layer 5 |

### 3.4 Configuration

```yaml
# allocation_config for UNIS tenant
fefo_enabled: false                    # Layer 3 OFF
specs_id_mode: VARIANT                 # Layer 2: match variant suffix
lcnb_mode: DETECT_ONLY                # Layer 6: recommend only
abc_weights:
  A: 2.0
  B: 1.5
  C: 1.0
dispatch_productivity_limit: 800       # pallets/day per source warehouse
optimistic_lock_retries: 3
backoff_ms: [100, 400, 1600]           # exponential backoff
```

---

## 4. Processing Logic — 6-Layer Sequential Filter

### Overview

```
planned_order_release (demand lines)
  │
  ▼
┌──────────────────────────────────────┐
│  Layer 1: RTM Source Selection        │  Chọn kho nguồn theo priority
│  candidate_lots = filter by rtm_rule  │
└──────────────┬───────────────────────┘
               │ lots from valid sources only
               ▼
┌──────────────────────────────────────┐
│  Layer 2: Quality/Variant Match       │  Match specs_id suffix
│  candidate_lots = filter by variant   │
└──────────────┬───────────────────────┘
               │ lots with matching variant only
               ▼
┌──────────────────────────────────────┐
│  Layer 3: FEFO (DISABLED for UNIS)    │  Skip — no expiry
│  Pass-through                         │
└──────────────┬───────────────────────┘
               │ unchanged
               ▼
┌──────────────────────────────────────┐
│  Layer 4: ABC Fair-Share              │  Shortage → ưu tiên A trước
│  weighted_allocation()                │
└──────────────┬───────────────────────┘
               │ allocated qty per demand line
               ▼
┌──────────────────────────────────────┐
│  Layer 5: Safety Stock Guard          │  post_alloc ≥ SS?
│  rollback if SS violated              │
└──────────────┬───────────────────────┘
               │ final allocation (SS-safe)
               ▼
┌──────────────────────────────────────┐
│  Layer 6: LCNB Detect                │  Scan sibling CN for surplus
│  recommendation_only                  │
└──────────────┬───────────────────────┘
               │
               ▼
         allocation_result
```

### Layer 1: RTM Source Selection

**Mục đích:** Xác định CN nào lấy hàng từ kho nào, theo thứ tự ưu tiên.

```python
# Pseudocode
for each demand_line in planned_order_release:
    rtm_rules = get_rtm_rules(demand_line.sku_id, demand_line.dest_location_id)
    # rtm_rules sorted by priority ASC (1 = primary, 2 = secondary, 3 = tertiary)

    for rule in rtm_rules:
        candidate_lots = lots.filter(
            sku_id=demand_line.sku_id,
            location_id=rule.source_location_id,
            status=AVAILABLE
        )
        if sum(candidate_lots.qty_available) >= demand_line.qty_planned:
            break  # đủ hàng từ source này
        else:
            continue  # thử source tiếp theo

    # Nếu không source nào đủ → partial allocation từ priority 1 trước
```

**Business rule:** Nếu source priority 1 có 70% qty, priority 2 có 30% → lấy cả 2.
Không skip priority 1 để lấy priority 2 dù priority 2 có nhiều hơn.

### Layer 2: Quality/Variant Match

**Mục đích:** Đảm bảo lot giao cho CN có đúng đuôi màu/kích thước khách yêu cầu.

```python
# UNIS: specs_id_mode = VARIANT
# specs_id format: "GACH-MEN-60x60-A4" → variant suffix = "A4"

for each candidate_lot:
    lot_variant = extract_variant_suffix(candidate_lot.specs_id)
    demand_variant = extract_variant_suffix(demand_line.specs_id)

    if lot_variant != demand_variant:
        candidate_lots.remove(candidate_lot)
```

**Tại sao variant matching critical cho UNIS:**
- Gạch men cùng model nhưng khác đuôi màu (A4 vs B2) → sắc độ khác nhau
- Khách hàng yêu cầu cùng đuôi trong 1 lô giao → trộn đuôi = trả hàng
- Đây là requirement đặc thù ngành vật liệu xây dựng

### Layer 3: FEFO (DISABLED)

```python
# UNIS: fefo_enabled = false
# Building materials không có expiry date
# Layer này pass-through, không lọc gì

if not config.fefo_enabled:
    pass  # no-op for UNIS
```

**Note:** Nếu UNIS mở rộng sang sản phẩm có hạn sử dụng (keo, sơn), cần enable FEFO.
Config đã có sẵn, chỉ cần `fefo_enabled: true`.

### Layer 4: ABC Fair-Share

**Mục đích:** Khi tổng supply < tổng demand, phân bổ theo trọng số ABC.

```python
# Chỉ trigger khi có SHORTAGE (total available < total demanded)
if total_available >= total_demanded:
    # Không shortage → allocate full qty cho mọi demand line
    pass
else:
    # Shortage → weighted fair-share
    weights = {"A": 2.0, "B": 1.5, "C": 1.0}

    for each demand_line:
        abc_class = get_abc_class(demand_line.sku_id, demand_line.dest_location_id)
        weight = weights[abc_class]
        demand_line.weighted_qty = demand_line.qty_planned * weight

    total_weighted = sum(all weighted_qty)

    for each demand_line:
        share = demand_line.weighted_qty / total_weighted
        allocated_qty = min(
            demand_line.qty_planned,
            total_available * share
        )
```

**Ví dụ UNIS:**
- CN Đà Nẵng cần 100 thùng gạch (SKU class A, weight 2.0)
- CN Huế cần 100 thùng gạch (SKU class C, weight 1.0)
- Kho chỉ có 150 thùng
- CN Đà Nẵng nhận: 150 × (200/300) = 100 (đủ)
- CN Huế nhận: 150 × (100/300) = 50 (thiếu 50)

### Layer 5: Safety Stock Guard

**Mục đích:** Sau khi allocate, kiểm tra kho nguồn còn ≥ SS target không.

```python
for each source_location:
    post_alloc_stock = current_stock - sum(allocated_from_this_location)

    if post_alloc_stock < safety_stock_target:
        # Cắt allocation: giảm qty để giữ SS
        excess = safety_stock_target - post_alloc_stock
        reduce_allocation(source_location, excess)
        # Giảm từ demand lines có priority thấp nhất trước (C → B → A)

        # Tạo exception
        create_exception(
            type="SS_BREACH_PREVENTED",
            source=source_location,
            shortfall=excess
        )
```

**UNIS rule:** SS target lấy từ Step 3 (inventory_policy). Nếu SS = 0 (chưa set),
layer này skip cho location đó.

### Layer 6: LCNB Detect (Lateral CN Balancing)

**Mục đích:** Phát hiện CN lân cận có hàng dư, gợi ý lateral transfer.

```python
# UNIS: lcnb_mode = DETECT_ONLY

for each demand_line with shortfall > 0:
    sibling_cns = get_sibling_cns(demand_line.dest_location_id)

    for cn in sibling_cns:
        surplus = cn.on_hand - cn.safety_stock - cn.committed
        if surplus > 0:
            create_recommendation(
                type="LCNB_LATERAL_TRANSFER",
                from_cn=cn,
                to_cn=demand_line.dest_location_id,
                sku=demand_line.sku_id,
                suggested_qty=min(surplus, demand_line.shortfall),
                action_required="BUYER_REVIEW"  # không tự động
            )
```

**Phase 1 (UNIS):** DETECT_ONLY — tạo recommendation cho buyer, KHÔNG tự động tạo
transfer order. Buyer review trên FE → nếu đồng ý → tạo manual transfer.

**Phase 2 (future):** AUTO_TRANSFER — hệ thống tự tạo transfer order nếu surplus > threshold.

---

## 5. Output

### 5.1 allocation_run

| Field | Type | Description |
|---|---|---|
| allocation_run_id | UUID | PK |
| plan_run_id | UUID | FK → plan_run (Step 4) |
| tenant_id | UUID | UNIS tenant |
| run_ts | TIMESTAMPTZ | Thời điểm chạy |
| status | ENUM | RUNNING, COMPLETED, PARTIAL, FAILED |
| total_demand_lines | INT | Tổng demand lines đầu vào |
| total_allocated | INT | Số lines được allocate đầy đủ |
| total_partial | INT | Số lines chỉ allocate 1 phần |
| total_unallocated | INT | Số lines không allocate được |
| config_snapshot | JSONB | Config tại thời điểm chạy |

### 5.2 allocation_result

| Field | Type | Description |
|---|---|---|
| allocation_result_id | UUID | PK |
| allocation_run_id | UUID | FK |
| planned_order_release_id | UUID | FK → demand line gốc |
| lot_id | UUID | FK → lot được chọn |
| source_location_id | UUID | Kho xuất |
| dest_location_id | UUID | CN nhận |
| sku_id | UUID | SKU |
| qty_allocated | DECIMAL(15,2) | Số lượng đã allocate |
| specs_id | VARCHAR | Variant code |
| layer_trace | JSONB | Log từng layer đã filter gì |
| status | ENUM | ALLOCATED, PARTIAL, FAILED |

### 5.3 recommendation (LCNB + buyer gate)

| Field | Type | Description |
|---|---|---|
| recommendation_id | UUID | PK |
| allocation_run_id | UUID | FK |
| type | ENUM | LCNB_LATERAL_TRANSFER, SS_OVERRIDE, MANUAL_SPLIT |
| from_location_id | UUID | Nguồn gợi ý |
| to_location_id | UUID | Đích gợi ý |
| sku_id | UUID | SKU |
| suggested_qty | DECIMAL(15,2) | Số lượng gợi ý |
| status | ENUM | PENDING, ACCEPTED, REJECTED, EXPIRED |
| decided_by | UUID | User đã quyết định |
| decided_at | TIMESTAMPTZ | Thời điểm quyết định |

---

## 6. API Endpoints

### 6.1 Run Allocation

```
POST /api/v1/allocation/run
Authorization: Bearer {token}
```

Request:
```json
{
  "plan_run_id": "uuid-of-drp-run",
  "config_override": {
    "dispatch_productivity_limit": 800
  }
}
```

Response:
```json
{
  "allocation_run_id": "uuid",
  "status": "RUNNING",
  "estimated_completion_s": 45
}
```

### 6.2 Get Allocation Results

```
GET /api/v1/allocation/run/{run_id}/results
  ?page=1&size=50
  &status=ALLOCATED,PARTIAL
  &dest_location_id={cn_id}
```

### 6.3 Get Recommendations

```
GET /api/v1/allocation/run/{run_id}/recommendations
  ?type=LCNB_LATERAL_TRANSFER
  &status=PENDING
```

### 6.4 Decide Recommendation

```
PUT /api/v1/allocation/recommendations/{rec_id}/decide
```

Request:
```json
{
  "decision": "ACCEPTED",
  "adjusted_qty": 50,
  "note": "CN Huế đồng ý nhận 50 thùng từ CN Đà Nẵng"
}
```

### 6.5 Retry Allocation (single demand line)

```
POST /api/v1/allocation/run/{run_id}/retry
```

Request:
```json
{
  "planned_order_release_ids": ["uuid1", "uuid2"],
  "reason": "lot_released_after_first_run"
}
```

---

## 7. Business Rules

| Rule ID | Rule | UNIS Value | Impact |
|---|---|---|---|
| AL-001 | FEFO enabled | **false** | Layer 3 skip, no expiry sorting |
| AL-002 | Variant match mode | **VARIANT** | Layer 2: match đuôi màu suffix |
| AL-003 | LCNB mode | **DETECT_ONLY** | Layer 6: recommend, không auto-transfer |
| AL-004 | ABC weights | A:2.0, B:1.5, C:1.0 | Layer 4: fair-share khi shortage |
| AL-005 | SS guard | post_alloc ≥ SS target | Layer 5: cắt allocation nếu vi phạm |
| AL-006 | Dispatch limit | 800 pallets/day | Giới hạn kho xuất: max 800 pallet/ngày |
| AL-007 | Concurrency | Optimistic lock, 3 retry | Backoff: 100ms, 400ms, 1600ms |
| AL-008 | Layer order | SEQUENTIAL only | Không parallel, không skip (trừ L3 disabled) |
| AL-009 | Partial allocation | Allowed | Nếu không đủ 100% → allocate phần có |
| AL-010 | RTM fallback | Priority cascade 1→2→3 | Nếu P1 thiếu, bổ sung từ P2, P3 |

### 7.x Branch Channel Isolation (UNIS-specific)

UNIS có 5 sales channels chạy song song qua cùng network CN:

| Channel Code | Tên | Corporation |
|---|---|---|
| UNIS | UNIS chính | 000 |
| UNIMAX | UNIMAX | 222 (LOTINA) |
| UNICHEMI | UNICHEMI | 000 |
| UNILUX | UNILUX | 222 (LOTINA) |
| LOTINA | LOTINA | 222 |

**Rules:**
- **Channel Isolation:** Allocation PHẢI tách riêng per channel. CN thuộc channel UNIS không được lấy hàng reserved cho UNIMAX.
- **Corporation Isolation:** LOTINA (corp=222) là entity riêng — inventory, orders, reporting tách biệt hoàn toàn.
- **RTM per Channel:** RTM rules cần gắn thêm `channel_code` filter. Branch code + channel code = unique routing key.
- **LCNB Cross-Channel:** LCNB DETECT_ONLY scan CHỈ trong cùng channel. CN UNIS chỉ scan CN UNIS khác, không scan UNIMAX CN.

**Impact trên 6 Layers:**
| Layer | Channel Impact |
|---|---|
| L1 RTM | Filter by channel_code before routing |
| L2 Variant | No change — variant matching per SKU |
| L3 FEFO | OFF — no impact |
| L4 ABC | ABC class computed per channel (volume khác nhau) |
| L5 SS Guard | SS per item × location × channel |
| L6 LCNB | Scan sibling CN TRONG CÙNG channel only |

### Concurrency Control (Optimistic Locking)

```
Scenario: 2 allocation runs cùng lúc tranh lot
1. Run A reads lot.qty_available = 100, version = 5
2. Run B reads lot.qty_available = 100, version = 5
3. Run A updates: qty_available = 60, version = 6 → SUCCESS
4. Run B updates: qty_available = 70, version = 6 → CONFLICT (expected version 5)
5. Run B retries after 100ms → reads version 6, qty_available = 60
6. Run B re-allocates with 60 available
```

Retry policy: 3 attempts × exponential backoff [100ms, 400ms, 1600ms].
Sau 3 lần fail → allocation_result.status = FAILED, exception raised.

---

## 8. Cross-Module Integration

### Inputs

| From | Data | Usage |
|---|---|---|
| Step 4 (DRP) | planned_order_release | Demand lines cần allocate |
| Step 2 (Supply) | lot_attribute | Available lots tại kho |
| Step 3 (Policy) | rtm_rule | Layer 1: source selection |
| Step 3 (Policy) | item_classification (ABC) | Layer 4: fair-share weights |
| Step 3 (Policy) | safety_stock | Layer 5: SS guard threshold |

### Outputs

| To | Data | Description |
|---|---|---|
| Step 6 (Transport) | allocation_result | Grouped by source→dest cho bin-packing |
| Step 7 (Execution) | allocation_result | Lot + qty cho draft order creation |
| Step 8 (Monitor) | allocation exceptions | SS breach, shortfall, LCNB recs |
| FE | recommendation | Buyer decision gate (LCNB, manual override) |

### Event Flow

```
Step 4 completes → trigger: allocation.run.requested
  → Allocation Engine runs 6 layers
  → emit: allocation.run.completed
    → Step 6 listens: start transport planning
    → Step 7 listens: prepare draft orders
    → Step 8 listens: log KPI metrics
```

---

## 9. UI Requirements

### 9.1 Allocation Dashboard

- **Summary cards:** Total allocated / Partial / Unallocated / Shortfall qty
- **Table:** allocation_results grouped by dest_location (CN)
  - Columns: CN, SKU, Variant, Qty Demanded, Qty Allocated, Source, Layer Trace
  - Filter by: CN, SKU, status, variant
  - Sort by: shortfall DESC (vấn đề trước)

### 9.2 Recommendation Panel

- Danh sách LCNB recommendations
- Mỗi recommendation: from_CN → to_CN, SKU, suggested qty
- Action buttons: Accept / Reject / Adjust Qty
- Status badge: PENDING (yellow), ACCEPTED (green), REJECTED (red), EXPIRED (grey)

### 9.3 Layer Trace View (Detail)

- Click vào 1 allocation result → expand layer trace
- Hiển thị từng layer đã filter gì, bao nhiêu lots bị loại
- Useful for: debug khi allocation không đúng ý

### 9.4 Dispatch Productivity Monitor

- Bar chart: pallets allocated per source warehouse per day
- Red line at 800 pallets (limit)
- Alert khi approaching limit (>90% = 720 pallets)

---

## 10. Acceptance Criteria

| AC ID | Criteria | Test Method |
|---|---|---|
| AC5-01 | 6 layers chạy SEQUENTIAL, không parallel | Unit test: mock layer timing, verify order |
| AC5-02 | FEFO layer skip khi fefo_enabled=false | Config test: set false, verify no-op |
| AC5-03 | Variant matching: lot A4 chỉ match demand A4 | Data test: mix variants, verify isolation |
| AC5-04 | ABC fair-share: A nhận nhiều hơn C khi shortage | Calc test: 3 CN (A,B,C), limited supply |
| AC5-05 | SS guard: allocation không làm stock < SS | Boundary test: stock = SS + 10, demand = 20 |
| AC5-06 | LCNB detect mode: tạo recommendation, KHÔNG auto-transfer | Integration test: verify no order created |
| AC5-07 | Optimistic lock retry: 3 attempts, exponential backoff | Concurrency test: 2 parallel runs |
| AC5-08 | Dispatch limit: max 800 pallets/day per source | Load test: demand > 800, verify cap |
| AC5-09 | Partial allocation: thiếu hàng → allocate phần có | Data test: supply < demand |
| AC5-10 | RTM priority cascade: P1 → P2 → P3 | Config test: P1 empty, verify P2 used |
| AC5-11 | Recommendation accept/reject workflow | E2E test: create rec → accept → verify |
| AC5-12 | Layer trace logged in allocation_result | Data test: verify layer_trace JSONB populated |

---

*Module Spec v1.0 — Step 5: Allocation Engine*
*Created: 2026-04-11 | R-BA for UNIS*
