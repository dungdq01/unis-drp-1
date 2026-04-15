# Module Spec — Step 4: DRP Netting — Tính nhu cầu ròng

> **Module ID:** SCP-UNIS-04
> **Version:** 1.0
> **Last Updated:** 2026-04-11
> **Owner:** R-BA (Requirements Business Analyst)
> **Status:** DRAFT

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ tất cả `tenant_id` trong SQL/Python — kể cả `run_drp_batch(tenant_id, ...)` (`D-MD-03`)
> - **Item PK:** `item_code VARCHAR` thay `item_id BIGINT` (`D-MD-01`)
> - **Location PK:** `location_code VARCHAR` thay `location_id BIGINT` (`D-MD-02`)
> - **`plan_run.tenant_id`** column: bỏ — UNIS single-tenant
> - **Output `planned_order_release`:** xem schema đầy đủ trong `00-master-data.md §6.4`

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

DRP Netting là **"trái tim"** của toàn bộ hệ thống. Module này nhận forecast (Step 1),
tồn kho (Step 2), safety stock (Step 3) rồi tính ra: **"Cần đặt bao nhiêu hàng, từ đâu, vào tuần nào?"**

Hệ thống tính 12 tuần liên tiếp cho mỗi mặt hàng tại mỗi chi nhánh:
- Tuần này bán bao nhiêu? (từ forecast)
- Hiện có bao nhiêu? (từ tồn kho)
- Đang chờ nhận thêm không? (hàng đang vận chuyển)
- Cần đặt thêm không để không hết hàng?

> **Ví dụ thực tế:** CN Hà Nội có 1,200 thùng gạch, dự báo tuần 3 bán 500, đang chờ 300 thùng về,
> Safety Stock là 450. Hệ thống tính: tuần 3 sẽ hết → cần đặt 450 thùng thêm.

**Người dùng chính:** Kế hoạch viên (sc_planner)

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **Kế hoạch viên** | Trigger DRP run, review kết quả, xử lý exceptions, duyệt planned orders |
| **SC Manager** | Review exceptions nghiêm trọng (stockout nhiều CN), phê duyệt kế hoạch tổng |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là Kế hoạch viên**, tôi muốn **chạy DRP** sau khi đã có đủ forecast + tồn kho frozen để có kế hoạch đặt hàng | DRP run hoàn thành < 60 giây, tạo ra danh sách planned orders |
| US-02 | **Là Kế hoạch viên**, tôi muốn **xem bảng PAB 12 tuần** cho từng mặt hàng × chi nhánh để hiểu tại sao hệ thống đề xuất đặt hàng vào tuần đó | Netting grid hiển thị GR, SR, PAB, NR, PO theo từng tuần |
| US-03 | **Là Kế hoạch viên**, tôi muốn **xem danh sách exceptions** (tồn kho dự kiến < 0, hoặc thiếu hàng) để xử lý ưu tiên | Exception dashboard: stockout, overstock, PAB negative với link drill-down |
| US-04 | **Là Kế hoạch viên**, tôi muốn **so sánh 2 lần chạy DRP** (trước và sau khi override forecast) để thấy sự khác biệt | Compare view: diff highlighted, tổng delta planned orders |
| US-05 | **Là Kế hoạch viên**, tôi muốn **export planned orders ra Excel** để báo cáo và lưu trữ | CSV/Excel export với filter hiện tại |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Run DRP thành công (Happy Path)

```
1. Kế hoạch viên vào Step 4: Forecast FROZEN ✅, Supply FROZEN ✅, SS ACTIVE ✅
2. Bấm "Run DRP" → chọn 2 snapshots phù hợp
3. Hệ thống xử lý 84,764 combinations trong 45 giây
4. Kết quả: "1,247 planned orders, 38 exceptions (12 stockout, 26 overstock)"
5. Kế hoạch viên click vào exceptions → xem từng trường hợp → ghi note xử lý
6. Export CSV planned orders → gửi cho Allocation (Step 5 tự động đọc)
```

#### ❌ Kịch bản 2 — DRP phát hiện stockout nghiêm trọng (Sad Path)

```
1. DRP chạy xong → exception: "CN-HN-015: GACH-60x60-A4 sẽ hết hàng tuần 2 (PAB = -300)"
2. Tuần 2 nằm trong frozen zone → hệ thống KHÔNG tự động tạo planned order
3. Kế hoạch viên phải xử lý thủ công:
   (a) Liên hệ kho → xuất khẩn từ kho dự phòng
   (b) Hoặc chấp nhận shortage → ghi note lý do
4. Tuần 3 trở đi → planned order tự động bù đắp
```

#### ⚠️ Kịch bản 3 — DRP run timeout (Sad Path)

```
1. DRP run quá 60 giây → hệ thống báo TIMEOUT, lưu kết quả từng phần
2. Alert: "DRP timed out sau 60s. Đã xử lý 67,400/84,764 combinations"
3. Kế hoạch viên có thể: dùng kết quả từng phần (có warning) hoặc re-run với phạm vi nhỏ hơn
```

---

### 0.4 Thuật ngữ

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **DRP (Distribution Requirements Planning)** | Tính toán nhu cầu bổ sung hàng cho toàn hệ thống phân phối |
| **PAB (Projected Available Balance)** | Tồn kho dự kiến = Tồn hiện có + Hàng sắp về − Dự báo bán |
| **Net Requirement (NR)** | Lượng hàng còn thiếu sau khi tính PAB (chỉ khi PAB < Safety Stock) |
| **Planned Order (PO)** | Đề xuất đặt hàng từ hệ thống — chưa phải đơn thật, cần confirm |
| **Scheduled Receipt (SR)** | Hàng đã đặt, đang trên đường về — tính vào PAB |
| **Frozen Zone** | 2 tuần đầu: DRP không tự thay đổi, mọi can thiệp phải thủ công |
| **HSTK** | Hệ Số Tồn Kho = tồn hiện có / (dự báo bán mỗi tuần) — đơn vị: tuần |

---

## 1. Mục đích (Purpose)

DRP Netting là **core algorithm** của toàn bộ SCP — tính toán:

1. **PAB (Projected Available Balance):** Tồn kho dự kiến qua từng tuần
2. **Net Requirements:** Nhu cầu ròng (sau khi trừ tồn kho hiện có)
3. **Planned Orders:** Đơn hàng kế hoạch cần thực hiện

Output là danh sách planned orders — input cho Allocation (Step 5) và
Replenishment execution.

**Tại sao gọi "netting"?**
"Netting" = tính ròng = Gross Requirement - Available Inventory.
Chỉ khi nhu cầu ròng > 0 mới cần đặt hàng bổ sung.

**UNIS context:**
- 1,419 active items × 74 locations × 12 weeks = ~1.26M calculations
- Thực tế: ~84,764 forecast rows (không phải mọi item ở mọi location)
- DRP run time target: < 60 seconds

---

## 2. UNIS Context (Đặc thù UNIS)

### 2.1. DRP Configuration (UNIS-specific)

| Config | Value | Mô tả |
|--------|-------|--------|
| `lot_sizing` | **L4L** (Lot-for-Lot) | Đặt đúng qty cần, không làm tròn |
| `horizon` | **12 weeks** | Lập kế hoạch 12 tuần tới |
| `frozen_zone` | **2 weeks** | 2 tuần đầu: không auto-change |
| `bom_explosion` | **false** | Vật liệu xây dựng — không có BOM tree |
| `pab_negative_handling` | **RAISE_EXCEPTION** | PAB < 0 → exception (không silent) |
| `netting_timeout` | **60 seconds** | Max processing time |
| `demand_basis` | **MAX_FORECAST_PO** | max(forecast, confirmed_PO) |
| `sr_include_in_transit` | **true** | Hàng đang vận chuyển = scheduled receipt |

### 2.2. So sánh với MDLZ benchmark

| Feature | UNIS | MDLZ | Ghi chú |
|---------|------|------|---------|
| Lot sizing | L4L | Fixed Period | UNIS đơn giản hơn |
| BOM | No | Yes (2-3 levels) | UNIS không sản xuất |
| Horizon | 12 weeks | 16 weeks | |
| Frozen zone | 2 weeks | 4 weeks | UNIS linh hoạt hơn |
| MOQ | No | Yes | UNIS không có minimum order qty |
| Multi-echelon | No (single) | Yes (2 echelon) | UNIS chạy flat netting |

### 2.3. HSTK — KPI chính của UNIS

**HSTK = Hệ Số Tồn Kho (Weeks of Stock)**

```
HSTK = on_hand_qty / (forecast_demand_weekly)
     = on_hand_qty / (forecast_demand_monthly / 4.33)
```

| HSTK Range | Status | Color | Mô tả |
|------------|--------|-------|--------|
| < 1.5 tuần | **STOCKOUT** | Red | Sắp hết hàng — urgent |
| 1.5 - 3.0 tuần | **OK** | Yellow | Tồn kho hợp lý |
| > 3.0 tuần | **OVERSTOCK** | Green | Tồn quá nhiều — tie up vốn |

**Lưu ý:** HSTK là KPI báo cáo, KHÔNG phải trigger cho DRP.
DRP dùng SS (Safety Stock) làm trigger. HSTK dùng cho monitoring (Step 8).

---

## 3. Dữ liệu đầu vào (Input Data)

### 3.1. Ba nguồn INPUT BẮT BUỘC

DRP **KHÔNG THỂ CHẠY** nếu thiếu bất kỳ source nào:

| # | Source | From | Table | Status required |
|---|--------|------|-------|----------------|
| 1 | **Demand** (Gross Requirements) | Step 1 | `demand_snapshot_line` | FROZEN |
| 2 | **Supply** (Beginning Inventory) | Step 2 | `supply_snapshot_line` | FROZEN |
| 3 | **Safety Stock** targets | Step 3 | `safety_stock_target` | Calculated |

### 3.2. Source 1: Demand Snapshot (Step 1)

```sql
SELECT
    dsl.item_id,
    dsl.location_id,
    dsl.period_start,
    COALESCE(dsl.reconciled_qty, dsl.forecast_qty) AS gross_requirement,
    dsl.segment,
    dsl.tet_flag
FROM demand_snapshot_line dsl
WHERE dsl.snapshot_id = :demand_snapshot_id  -- MUST be FROZEN
```

**Conversion:** Monthly forecast → weekly gross requirement
```python
def monthly_to_weekly(monthly_qty, period_start):
    """
    Chia forecast tháng thành 4-5 tuần (tùy tháng).
    Phân bổ đều — UNIS không dùng weekly pattern (chưa đủ data).
    """
    weeks_in_month = count_weeks(period_start)  # 4 or 5
    return monthly_qty / weeks_in_month
```

### 3.3. Source 2: Supply Snapshot (Step 2)

```sql
SELECT
    ssl.item_id,
    ssl.location_id,
    COALESCE(ssl.override_qty, ssl.allocatable_qty) AS beginning_inventory,
    ssl.in_transit_qty,
    ssl.is_estimated
FROM supply_snapshot_line ssl
WHERE ssl.snapshot_id = :supply_snapshot_id  -- MUST be FROZEN
```

### 3.4. Source 3: Safety Stock (Step 3)

```sql
SELECT
    sst.item_id,
    sst.location_id,
    sst.ss_final AS safety_stock
FROM safety_stock_target sst
WHERE sst.tenant_id = :tenant_id
  AND sst.effective_date <= CURRENT_DATE
ORDER BY sst.effective_date DESC
-- Lấy SS target mới nhất
```

### 3.5. Scheduled Receipts (Pipeline Stock)

```sql
SELECT
    po.item_id,
    po.destination_location_id AS location_id,
    po.expected_receipt_week,
    po.qty AS scheduled_receipt_qty
FROM purchase_order po
WHERE po.tenant_id = :tenant_id
  AND po.status IN ('CONFIRMED', 'IN_TRANSIT')
  AND po.expected_receipt_week BETWEEN :week_start AND :week_end
```

**UNIS lưu ý:** Scheduled receipts bao gồm:
- Confirmed POs chưa nhận
- In-transit shipments (nếu có ETA)
- KHÔNG bao gồm planned orders từ DRP run trước (tránh double-count)

---

## 4. Logic xử lý (Processing Logic)

### 4.1. DRP Netting Algorithm — Core

```python
def drp_netting(item_id, location_id, params):
    """
    Core DRP netting algorithm cho 1 item × 1 location × 12 weeks.

    Variables:
    - GR: Gross Requirement (demand forecast)
    - SR: Scheduled Receipt (POs in transit / confirmed)
    - PAB: Projected Available Balance
    - NR: Net Requirement
    - PO: Planned Order
    - SS: Safety Stock
    """

    # === SETUP ===
    horizon = 12  # weeks
    SS = params.safety_stock                    # From Step 3
    beginning_inventory = params.beginning_inv  # From Step 2

    # PAB(week 0) = beginning inventory
    PAB_prev = beginning_inventory

    planned_orders = []
    exceptions = []

    # === NETTING LOOP ===
    for week in range(1, horizon + 1):

        # 1. Get Gross Requirement for this week
        GR = get_gross_requirement(item_id, location_id, week)

        # 2. Get Scheduled Receipts for this week
        SR = get_scheduled_receipts(item_id, location_id, week)

        # 3. Calculate PAB
        PAB = PAB_prev + SR - GR

        # 4. Check against Safety Stock
        if PAB < SS:
            # Net Requirement exists
            NR = SS - PAB

            # Lot sizing = L4L (exact quantity)
            PO = NR

            # Update PAB with planned order
            PAB = PAB + PO

            planned_orders.append(PlannedOrder(
                item_id=item_id,
                location_id=location_id,
                week=week,
                gross_requirement=GR,
                scheduled_receipt=SR,
                pab_before=PAB_prev + SR - GR,
                net_requirement=NR,
                planned_order_qty=PO,
                pab_after=PAB
            ))
        else:
            NR = 0
            PO = 0

        # 5. Exception handling
        if PAB < 0:
            if params.pab_negative_handling == 'RAISE_EXCEPTION':
                exceptions.append(DRPException(
                    type='PAB_NEGATIVE',
                    item_id=item_id,
                    location_id=location_id,
                    week=week,
                    pab_value=PAB - PO,  # PAB before planned order
                    message=f'PAB negative at week {week}: {PAB - PO}'
                ))

        # 6. HSTK calculation (monitoring, not trigger)
        weekly_demand = GR if GR > 0 else 1  # Avoid division by zero
        hstk = PAB / weekly_demand

        if hstk < 1.5:
            exceptions.append(DRPException(
                type='STOCKOUT_ALERT',
                severity='HIGH',
                item_id=item_id,
                location_id=location_id,
                week=week,
                hstk=hstk,
                message=f'HSTK = {hstk:.1f} weeks (< 1.5 threshold)'
            ))
        elif hstk > 3.0:
            exceptions.append(DRPException(
                type='OVERSTOCK_ALERT',
                severity='LOW',
                item_id=item_id,
                location_id=location_id,
                week=week,
                hstk=hstk,
                message=f'HSTK = {hstk:.1f} weeks (> 3.0 threshold)'
            ))

        # 7. Frozen zone check
        if week <= params.frozen_zone and PO > 0:
            exceptions.append(DRPException(
                type='FROZEN_ZONE_VIOLATION',
                severity='MEDIUM',
                item_id=item_id,
                location_id=location_id,
                week=week,
                message=f'Planned order in frozen zone (week {week})'
            ))

        # Move to next week
        PAB_prev = PAB

    return planned_orders, exceptions
```

### 4.2. Demand Basis — MAX_FORECAST_PO

```python
def get_gross_requirement(item_id, location_id, week):
    """
    UNIS demand_basis = MAX_FORECAST_PO:
    Lấy giá trị LỚN HƠN giữa forecast và confirmed PO.
    """
    forecast_qty = get_forecast_weekly(item_id, location_id, week)
    confirmed_po_qty = get_confirmed_po_qty(item_id, location_id, week)

    if confirmed_po_qty is None:
        return forecast_qty

    # Check cutoff (90 days)
    po_age = get_po_age_days(item_id, location_id, week)
    if po_age > 90:
        return forecast_qty

    return max(forecast_qty, confirmed_po_qty)
```

### 4.3. Lot Sizing — L4L (Lot-for-Lot)

```python
def lot_sizing_l4l(net_requirement):
    """
    Lot-for-Lot: planned order qty = EXACTLY net requirement.
    Không làm tròn, không MOQ, không fixed period grouping.

    UNIS chọn L4L vì:
    - Vật liệu xây dựng: đặt hàng linh hoạt
    - Không có MOQ constraint từ NM
    - Tránh overstock (inventory = cash)
    """
    return net_requirement  # Exact qty
```

### 4.4. Frozen Zone Logic

```python
def apply_frozen_zone(planned_orders, frozen_zone=2):
    """
    Frozen zone = 2 tuần đầu tiên.
    Planned orders trong frozen zone:
    - Vẫn tính (để biết nhu cầu)
    - NHƯNG flag là FROZEN_ZONE → planner phải approve manually
    - Không auto-release
    """
    for po in planned_orders:
        if po.week <= frozen_zone:
            po.status = 'NEEDS_APPROVAL'
            po.frozen_zone_flag = True
        else:
            po.status = 'AUTO_RELEASE'
            po.frozen_zone_flag = False

    return planned_orders
```

### 4.5. Batch DRP Run (Full System)

```python
def run_drp_batch(tenant_id, demand_snapshot_id, supply_snapshot_id):
    """
    Chạy DRP cho TOÀN BỘ item × location combinations.
    """
    start_time = time.now()

    # 1. Validate inputs
    demand_snap = validate_snapshot(demand_snapshot_id, 'DEMAND', 'FROZEN')
    supply_snap = validate_snapshot(supply_snapshot_id, 'SUPPLY', 'FROZEN')

    if supply_snap.freshness == 'STALE' and not supply_snap.stale_acknowledged:
        raise DRPError('Supply snapshot STALE - acknowledge required')

    # 2. Create plan run
    plan_run = create_plan_run(
        tenant_id=tenant_id,
        demand_snapshot_id=demand_snapshot_id,
        supply_snapshot_id=supply_snapshot_id,
        status='RUNNING'
    )

    # 3. Get all item × location combinations from demand
    combinations = get_demand_combinations(demand_snapshot_id)

    total_planned_orders = 0
    total_exceptions = 0
    all_planned_orders = []
    all_exceptions = []

    # 4. Netting loop
    for item_id, location_id in combinations:
        # Get SS target
        ss = get_safety_stock(item_id, location_id)
        if ss is None:
            all_exceptions.append(DRPException(
                type='MISSING_SS',
                item_id=item_id,
                location_id=location_id,
                message='No safety stock target found'
            ))
            ss = 0  # Fallback: SS=0 → still run but no safety buffer

        # Get beginning inventory
        beginning_inv = get_beginning_inventory(supply_snapshot_id, item_id, location_id)
        if beginning_inv is None:
            beginning_inv = 0  # No inventory record → assume zero

        # Run netting
        params = NettingParams(
            safety_stock=ss,
            beginning_inv=beginning_inv,
            frozen_zone=2,
            pab_negative_handling='RAISE_EXCEPTION'
        )

        try:
            orders, exceptions = drp_netting(item_id, location_id, params)
            all_planned_orders.extend(orders)
            all_exceptions.extend(exceptions)
            total_planned_orders += len(orders)
            total_exceptions += len(exceptions)
        except TimeoutError:
            all_exceptions.append(DRPException(
                type='NETTING_TIMEOUT',
                item_id=item_id,
                location_id=location_id,
                message='Netting timeout for single item×location'
            ))

    # 5. Apply frozen zone
    all_planned_orders = apply_frozen_zone(all_planned_orders)

    # 6. Save results
    batch_save_planned_orders(plan_run.id, all_planned_orders)
    batch_save_exceptions(plan_run.id, all_exceptions)

    # 7. Update plan run
    duration_ms = (time.now() - start_time).total_milliseconds()
    update_plan_run(
        plan_run_id=plan_run.id,
        status='COMPLETED',
        planned_orders_count=total_planned_orders,
        exceptions_count=total_exceptions,
        duration_ms=duration_ms,
        combinations_processed=len(combinations)
    )

    # 8. Check timeout
    if duration_ms > 60000:  # 60 seconds
        log_warning(f'DRP run exceeded timeout: {duration_ms}ms')

    return plan_run
```

### 4.6. DRP Netting Example — Worked

**Item: Xi măng PCB40 (A-class), Location: CN HCM-Q1**

| Input | Value |
|-------|-------|
| Beginning Inventory | 1,200 units |
| Safety Stock (SS) | 450 units |
| Monthly Forecast | 2,000 units (= 500/week) |
| Scheduled Receipt week 2 | 300 units |

**Netting Table:**

| Week | GR | SR | PAB | PAB < SS? | NR | PO | PAB (final) | HSTK |
|------|-----|-----|-----|-----------|-----|-----|------------|------|
| 0 | - | - | 1,200 | No | - | - | 1,200 | 2.4 |
| 1 | 500 | 0 | 700 | No | 0 | 0 | 700 | 1.4 |
| 2 | 500 | 300 | 500 | No | 0 | 0 | 500 | 1.0 |
| 3 | 500 | 0 | 0 | YES | 450 | 450 | 450 | 0.9 |
| 4 | 500 | 0 | -50 | YES | 500 | 500 | 450 | 0.9 |
| 5 | 500 | 0 | -50 | YES | 500 | 500 | 450 | 0.9 |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

**Kết quả:**
- Week 1-2: PAB > SS → không cần đặt hàng
- Week 2: HSTK = 1.0 → STOCKOUT alert (< 1.5)
- Week 3+: PAB < SS → planned orders mỗi tuần
- Week 3: NR = 450 - 0 = 450 (SS - PAB before PO)
- Week 4+: NR = 450 - (-50) = 500

### 4.7. PAB Negative Handling

```python
def handle_pab_negative(pab_value, item_id, location_id, week, mode):
    """
    UNIS config: pab_negative_handling = RAISE_EXCEPTION

    Khi PAB < 0 (trước planned order):
    - Nghĩa là KHÔNG ĐỦ HÀNG ngay cả khi planned order = 0
    - Planned order phải bù cả phần âm + SS
    - Exception raised cho planner review
    """
    if pab_value < 0 and mode == 'RAISE_EXCEPTION':
        return DRPException(
            type='PAB_NEGATIVE',
            severity='HIGH',
            item_id=item_id,
            location_id=location_id,
            week=week,
            pab_value=pab_value,
            message=f'Inventory deficit: need {abs(pab_value)} units immediately'
        )
```

---

## 5. Dữ liệu đầu ra (Output Data)

### 5.1. plan_run

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | Auto-increment |
| `tenant_id` | BIGINT FK | |
| `demand_snapshot_id` | BIGINT FK | → demand_snapshot (FROZEN) |
| `supply_snapshot_id` | BIGINT FK | → supply_snapshot (FROZEN) |
| `status` | ENUM | RUNNING / COMPLETED / FAILED / TIMEOUT |
| `planned_orders_count` | INT | Tổng số planned orders |
| `exceptions_count` | INT | Tổng số exceptions |
| `combinations_processed` | INT | Số item×location đã xử lý |
| `duration_ms` | INT | Thời gian chạy (ms) |
| `config_json` | JSONB | DRP config used for this run |
| `started_at` | TIMESTAMP | |
| `completed_at` | TIMESTAMP | |
| `created_by` | BIGINT FK | User trigger |

### 5.2. planned_order_release

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | |
| `plan_run_id` | BIGINT FK | → plan_run |
| `item_id` | BIGINT FK | → item |
| `location_id` | BIGINT FK | → location (destination) |
| `week_number` | INT | Tuần nào (1-12) |
| `week_start_date` | DATE | Ngày đầu tuần |
| `gross_requirement` | DECIMAL(15,2) | GR for this week |
| `scheduled_receipt` | DECIMAL(15,2) | SR for this week |
| `pab_before` | DECIMAL(15,2) | PAB trước planned order |
| `net_requirement` | DECIMAL(15,2) | NR = SS - PAB (when PAB < SS) |
| `planned_order_qty` | DECIMAL(15,2) | PO qty (= NR for L4L) |
| `pab_after` | DECIMAL(15,2) | PAB sau planned order |
| `safety_stock` | DECIMAL(15,2) | SS used |
| `hstk` | DECIMAL(5,2) | HSTK at this week |
| `frozen_zone_flag` | BOOLEAN | True nếu week <= frozen_zone |
| `status` | ENUM | AUTO_RELEASE / NEEDS_APPROVAL / RELEASED / CANCELLED |
| `demand_basis` | VARCHAR(20) | FORECAST / CONFIRMED_PO / MAX_FORECAST_PO |
| `is_estimated` | BOOLEAN | True nếu supply data là estimated |

**Composite Unique:** (plan_run_id, item_id, location_id, week_number)

### 5.3. drp_exception

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | |
| `plan_run_id` | BIGINT FK | → plan_run |
| `type` | VARCHAR(50) | PAB_NEGATIVE / STOCKOUT_ALERT / OVERSTOCK_ALERT / FROZEN_ZONE / MISSING_SS / TIMEOUT |
| `severity` | ENUM | HIGH / MEDIUM / LOW |
| `item_id` | BIGINT FK | |
| `location_id` | BIGINT FK | |
| `week_number` | INT | |
| `detail_json` | JSONB | Exception details |
| `message` | TEXT | Human-readable message |
| `resolved` | BOOLEAN | Planner đã xử lý chưa |
| `resolved_by` | BIGINT FK | |
| `resolved_at` | TIMESTAMP | |
| `resolution_note` | TEXT | |
| `created_at` | TIMESTAMP | |

### 5.4. drp_netting_detail (Optional — full trace)

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | |
| `plan_run_id` | BIGINT FK | |
| `item_id` | BIGINT FK | |
| `location_id` | BIGINT FK | |
| `week_number` | INT | |
| `gross_requirement` | DECIMAL(15,2) | |
| `scheduled_receipt` | DECIMAL(15,2) | |
| `pab` | DECIMAL(15,2) | |
| `net_requirement` | DECIMAL(15,2) | |
| `planned_order` | DECIMAL(15,2) | |
| `safety_stock` | DECIMAL(15,2) | |
| `hstk` | DECIMAL(5,2) | |

**Mục đích:** Full audit trail cho mỗi tuần — debug và compliance.

---

## 6. API Endpoints

### 6.1. POST /api/v1/drp/run

**Mô tả:** Trigger DRP netting run

**Request:**
```json
{
  "demand_snapshot_id": 42,
  "supply_snapshot_id": 15,
  "scope": "ALL",
  "config_overrides": {
    "frozen_zone": 2,
    "horizon": 12,
    "lot_sizing": "L4L"
  }
}
```

**Response (202 Accepted):**
```json
{
  "plan_run_id": 7,
  "status": "RUNNING",
  "combinations_to_process": 4830,
  "estimated_duration_seconds": 45
}
```

**Error Responses:**
- 400: Missing required snapshots
- 409: Snapshot not FROZEN
- 409: Supply snapshot STALE and not acknowledged
- 422: No demand data in snapshot

### 6.2. GET /api/v1/drp/run/{id}

**Mô tả:** Get DRP run status and summary

**Response:**
```json
{
  "id": 7,
  "status": "COMPLETED",
  "demand_snapshot_id": 42,
  "supply_snapshot_id": 15,
  "planned_orders_count": 12450,
  "exceptions_count": 340,
  "exceptions_by_type": {
    "STOCKOUT_ALERT": 185,
    "OVERSTOCK_ALERT": 95,
    "FROZEN_ZONE_VIOLATION": 42,
    "PAB_NEGATIVE": 15,
    "MISSING_SS": 3
  },
  "combinations_processed": 4830,
  "duration_ms": 38500,
  "started_at": "2026-04-11T10:00:00Z",
  "completed_at": "2026-04-11T10:00:38Z"
}
```

### 6.3. GET /api/v1/drp/run/{id}/planned-orders

**Mô tả:** List planned orders from DRP run

**Query params:**
- `item_id`, `location_id` (filter)
- `week_number` (filter)
- `status` (AUTO_RELEASE / NEEDS_APPROVAL)
- `frozen_zone_flag` (true/false)
- `min_qty`, `max_qty`
- `sort_by` (week, qty, item)
- `page`, `page_size`

**Response:**
```json
{
  "data": [
    {
      "id": 12345,
      "item_id": 42,
      "item_name": "Xi măng PCB40",
      "location_id": 15,
      "location_name": "CN HCM-Q1",
      "week_number": 3,
      "week_start_date": "2026-04-28",
      "gross_requirement": 500,
      "scheduled_receipt": 0,
      "pab_before": 0,
      "net_requirement": 450,
      "planned_order_qty": 450,
      "pab_after": 450,
      "safety_stock": 450,
      "hstk": 0.9,
      "frozen_zone_flag": false,
      "status": "AUTO_RELEASE"
    }
  ],
  "pagination": { "page": 1, "total_pages": 125 },
  "summary": {
    "total_planned_qty": 580000,
    "total_orders": 12450,
    "auto_release": 12200,
    "needs_approval": 250
  }
}
```

### 6.4. GET /api/v1/drp/run/{id}/exceptions

**Mô tả:** List exceptions from DRP run

**Query params:** `type`, `severity`, `resolved` (true/false), `page`, `page_size`

**Response:**
```json
{
  "data": [
    {
      "id": 501,
      "type": "STOCKOUT_ALERT",
      "severity": "HIGH",
      "item_id": 42,
      "item_name": "Xi măng PCB40",
      "location_id": 15,
      "location_name": "CN HCM-Q1",
      "week_number": 2,
      "message": "HSTK = 1.0 weeks (< 1.5 threshold)",
      "detail": { "hstk": 1.0, "pab": 500, "weekly_demand": 500 },
      "resolved": false
    }
  ]
}
```

### 6.5. POST /api/v1/drp/run/{id}/exceptions/{exc_id}/resolve

**Mô tả:** Planner resolve exception

**Request:**
```json
{
  "resolution_note": "Đã liên hệ NM tăng đơn hàng tuần sau"
}
```

### 6.6. GET /api/v1/drp/run/{id}/netting-detail/{item_id}/{location_id}

**Mô tả:** Full netting trace cho 1 item × location (12 weeks)

**Response:**
```json
{
  "item_id": 42,
  "location_id": 15,
  "safety_stock": 450,
  "beginning_inventory": 1200,
  "weeks": [
    {
      "week": 1, "gr": 500, "sr": 0,
      "pab": 700, "nr": 0, "po": 0, "hstk": 1.4
    },
    {
      "week": 2, "gr": 500, "sr": 300,
      "pab": 500, "nr": 0, "po": 0, "hstk": 1.0
    },
    {
      "week": 3, "gr": 500, "sr": 0,
      "pab": 450, "nr": 450, "po": 450, "hstk": 0.9
    }
  ]
}
```

### 6.7. POST /api/v1/drp/planned-orders/{id}/approve

**Mô tả:** Approve planned order trong frozen zone

**Request:**
```json
{
  "action": "APPROVE",
  "note": "Urgent replenishment needed"
}
```

### 6.8. POST /api/v1/drp/planned-orders/{id}/cancel

**Mô tả:** Cancel planned order

**Request:**
```json
{
  "reason": "NM báo không có hàng tuần này"
}
```

### 6.9. GET /api/v1/drp/hstk/summary

**Mô tả:** HSTK summary across all items × locations

**Response:**
```json
{
  "total_combinations": 4830,
  "stockout_count": 185,
  "stockout_pct": 3.8,
  "ok_count": 4550,
  "ok_pct": 94.2,
  "overstock_count": 95,
  "overstock_pct": 2.0,
  "by_segment": {
    "A": { "stockout": 12, "ok": 148, "overstock": 8 },
    "B": { "stockout": 120, "ok": 3800, "overstock": 60 },
    "C": { "stockout": 53, "ok": 602, "overstock": 27 }
  }
}
```

### 6.10. GET /api/v1/drp/run/{id}/export

**Mô tả:** Export DRP results to CSV/Excel

**Query params:** `format` (csv/xlsx), `include_detail` (true/false)

---

## 7. Business Rules (UNIS-specific)

### BR-01: Lot Sizing = L4L
- Planned order qty = EXACTLY net requirement
- Không làm tròn lên (no rounding)
- Không có MOQ (Minimum Order Quantity)
- Không có fixed period grouping
- Lý do: vật liệu xây dựng — đặt linh hoạt, NM không đặt MOQ

### BR-02: Horizon = 12 Weeks
- DRP tính 12 tuần tới (~ 3 tháng)
- Phù hợp với forecast horizon 4 tháng từ team thuật toán
- Tuần 1-2: frozen zone
- Tuần 3-12: auto-release eligible

### BR-03: Frozen Zone = 2 Weeks
- 2 tuần đầu: planned orders KHÔNG tự động release
- Lý do: thay đổi ngắn hạn gây confusion cho NM/logistics
- Planner phải manually approve planned orders trong frozen zone
- Sau frozen zone: auto-release OK

### BR-04: BOM Explosion = False
- UNIS phân phối vật liệu xây dựng — KHÔNG sản xuất
- Không có Bill of Materials (BOM)
- DRP chạy flat (single level), không explode components
- So sánh: MDLZ có BOM 2-3 levels (raw materials → intermediates → finished goods)

### BR-05: PAB Negative = RAISE_EXCEPTION
- Khi PAB < 0 trước planned order → EXCEPTION
- Nghĩa là demand > available inventory + scheduled receipts
- Planned order sẽ bù phần thiếu + SS
- Exception hiển thị cho planner review

### BR-06: Netting Timeout = 60 Seconds
- Max processing time cho full DRP run
- UNIS: 84K forecast rows → target < 60s
- Nếu timeout → partial results saved + exception logged
- Planner có thể re-run with subset (filter by segment/location)

### BR-07: Demand Basis MAX_FORECAST_PO
- Gross requirement = MAX(forecast_qty, confirmed_po_qty)
- Cutoff: chỉ xét PO trong 90 ngày
- Đảm bảo không bỏ sót nhu cầu thực tế (confirmed orders)

### BR-08: HSTK Thresholds
- < 1.5 weeks: STOCKOUT alert (RED) — immediate action needed
- 1.5 - 3.0 weeks: OK (YELLOW) — healthy range
- > 3.0 weeks: OVERSTOCK alert (GREEN) — reduce inventory
- HSTK = monitoring KPI, KHÔNG trigger DRP (SS triggers DRP)

### BR-09: Supply Snapshot Freshness Gate
- DRP KHÔNG chạy nếu supply snapshot STALE + not acknowledged
- Planner PHẢI acknowledge STALE trước khi DRP run
- Đảm bảo planner aware rằng inventory data có thể không chính xác

### BR-10: Estimated Inventory Flag
- Planned orders based on `is_estimated = true` supply data → flag `is_estimated` trên PO
- Planner biết confidence level của planned order

---

## 8. Cross-Module References

### 8.1. INPUT from Step 1 (Demand Ingestion)
```
demand_snapshot_line (FROZEN) → gross_requirements per item × location × period

Query:
SELECT COALESCE(reconciled_qty, forecast_qty) AS gross_requirement
FROM demand_snapshot_line
WHERE snapshot_id = :demand_snapshot_id

Monthly → Weekly conversion: forecast_qty / weeks_in_month
```

### 8.2. INPUT from Step 2 (Supply Snapshot)
```
supply_snapshot_line (FROZEN) → beginning_inventory per item × location

Query:
SELECT COALESCE(override_qty, allocatable_qty) AS beginning_inventory
FROM supply_snapshot_line
WHERE snapshot_id = :supply_snapshot_id

Also: in_transit_qty → scheduled_receipts (nếu có ETA)
```

### 8.3. INPUT from Step 3 (Inventory Policy)
```
safety_stock_target → SS per item × location

Query:
SELECT ss_final FROM safety_stock_target
WHERE item_id = :item_id AND location_id = :location_id

DRP dùng SS làm threshold: IF PAB < SS THEN NR = SS - PAB
```

### 8.4. OUTPUT → Step 5 (Allocation)
```
planned_order_release → demand lines cho allocation

Allocation nhận planned orders WHERE status = AUTO_RELEASE
→ phân bổ hàng từ warehouse theo RTM rules (Step 3)
→ convert thành actual transfer/purchase orders
```

### 8.5. OUTPUT → Step 8 (Monitor)
```
drp_exception → exceptions dashboard
- STOCKOUT_ALERT: items cần replenish urgent
- OVERSTOCK_ALERT: items cần giảm tồn
- PAB_NEGATIVE: severe deficit
- FROZEN_ZONE_VIOLATION: cần planner approval

planned_order_release → tracking planned vs actual
- So sánh planned orders vs actual POs executed
- Deviation → alert planner
```

### 8.6. DRP Re-run Triggers
```
Khi nào cần re-run DRP:
1. New demand snapshot (Step 1) uploaded + frozen
2. New supply snapshot (Step 2) captured + frozen
3. Safety stock recalculated (Step 3)
4. Planner override demand hoặc supply
5. Significant exception from Step 8 (drift alert)

Re-run tạo plan_run MỚI (không overwrite plan_run cũ).
Planner có thể compare 2 plan_runs (before vs after).
```

---

## 9. Giao diện người dùng (UI Requirements)

### 9.1. DRP Run Dashboard
- **Run button:** "Run DRP" → chọn demand + supply snapshots
- **Progress indicator:** processing X/4830 combinations
- **Run history table:**

| Run ID | Status | Demand Snap | Supply Snap | Orders | Exceptions | Duration | Date |
|--------|--------|-------------|-------------|--------|------------|----------|------|

### 9.2. Netting Grid (per Item × Location)
- **12-column table:** 1 column per week
- **Rows:** GR, SR, PAB, NR, PO
- **Color coding:**
  - PAB < SS → red cell
  - PAB < 0 → dark red cell
  - PO > 0 → blue cell (planned order)
  - Frozen zone columns → gray overlay
- **Interactive:** click PO cell → approve/cancel dialog

**Ví dụ visual:**

```
                | W1    | W2    | W3    | W4    | ...
                | FROZEN| FROZEN|       |       |
GR              | 500   | 500   | 500   | 500   |
SR              | 0     | 300   | 0     | 0     |
PAB (before PO) | 700   | 500   | 0     | -50   |
NR              | 0     | 0     | 450   | 500   |
PO              | 0     | 0     | 450   | 500   |
PAB (after PO)  | 700   | 500   | 450   | 450   |
HSTK            | 1.4   | 1.0   | 0.9   | 0.9   |
```

### 9.3. Planned Orders Table
- **Columns:** Item | Location | Week | Qty | Status | Frozen? | HSTK | Actions
- **Filters:** status, frozen_zone, segment, location, week range
- **Bulk actions:** Approve all (frozen zone), Export CSV
- **Sort:** by week (urgent first), by qty desc, by segment

### 9.4. Exception Dashboard
- **Summary cards:** Stockout (red), Overstock (green), PAB Negative (dark red), Frozen Zone (gray)
- **Exception list:** sortable, filterable table
- **Resolve action:** click → enter resolution note
- **Drill-down:** click exception → netting grid for that item × location

### 9.5. HSTK Heatmap
- **Matrix:** rows = items (grouped by segment), columns = locations
- **Cell color:**
  - Red (< 1.5 weeks) — stockout risk
  - Yellow (1.5-3.0) — OK
  - Green (> 3.0) — overstock
- **Filters:** segment, location type
- **Click cell → netting detail for that item × location**

### 9.6. Compare Runs
- **Side-by-side view:** Run A vs Run B
- **Diff highlighting:** cells that changed between runs
- **Summary:** +/- planned orders, +/- exceptions
- **Use case:** "What changed after demand override?"

### 9.7. Export Options
- **CSV export:** planned orders, exceptions, netting detail
- **Excel export:** formatted workbook with multiple sheets
- **Filter-aware:** export respects current filters

---

## 10. Acceptance Criteria

### AC-01: DRP Run — Happy Path
```gherkin
GIVEN FROZEN demand snapshot (84,764 lines) and FROZEN supply snapshot
  AND safety stock targets calculated for all active items
WHEN planner triggers DRP run
THEN plan_run is created with status = COMPLETED
  AND all item × location combinations processed
  AND duration_ms < 60,000 (60 seconds)
```

### AC-02: PAB Calculation
```gherkin
GIVEN item X at location Y with beginning_inventory = 1200, SS = 450
  AND weekly forecast = 500, scheduled_receipt week 2 = 300
WHEN DRP runs
THEN PAB(week 1) = 1200 - 500 = 700
  AND PAB(week 2) = 700 + 300 - 500 = 500
  AND PAB(week 3) before PO = 500 - 500 = 0 (< SS)
  AND NR(week 3) = 450 - 0 = 450
  AND PO(week 3) = 450
  AND PAB(week 3) after PO = 0 + 450 = 450
```

### AC-03: Net Requirement Only When PAB < SS
```gherkin
GIVEN PAB(week) = 600 and SS = 450
WHEN DRP calculates
THEN NR = 0 and PO = 0 (PAB > SS → no order needed)
```

### AC-04: L4L Lot Sizing
```gherkin
GIVEN NR = 327.5 units
WHEN lot sizing applied
THEN PO = 327.5 (exact, no rounding, no MOQ)
```

### AC-05: Frozen Zone Flag
```gherkin
GIVEN planned order in week 1 (within frozen_zone = 2)
WHEN order created
THEN status = NEEDS_APPROVAL
  AND frozen_zone_flag = true
  AND order NOT auto-released
```

### AC-06: Frozen Zone — Week 3+
```gherkin
GIVEN planned order in week 3 (outside frozen_zone = 2)
WHEN order created
THEN status = AUTO_RELEASE
  AND frozen_zone_flag = false
```

### AC-07: PAB Negative Exception
```gherkin
GIVEN PAB(week) = -50 (before planned order)
  AND pab_negative_handling = RAISE_EXCEPTION
WHEN DRP calculates
THEN exception created with type = PAB_NEGATIVE
  AND PO covers deficit: NR = SS - (-50) = SS + 50
```

### AC-08: HSTK Alerts
```gherkin
GIVEN PAB(week) = 500 and weekly demand = 500
THEN HSTK = 1.0 (< 1.5)
  AND STOCKOUT_ALERT exception created

GIVEN PAB(week) = 2000 and weekly demand = 500
THEN HSTK = 4.0 (> 3.0)
  AND OVERSTOCK_ALERT exception created
```

### AC-09: STALE Supply Gate
```gherkin
GIVEN supply snapshot with freshness = STALE and stale_acknowledged = false
WHEN DRP run triggered
THEN DRP returns 409 error "Supply snapshot STALE - acknowledge required"
  AND DRP does NOT execute
```

### AC-10: Demand Basis MAX_FORECAST_PO
```gherkin
GIVEN forecast = 200, confirmed_PO = 350, PO age = 45 days
WHEN gross requirement calculated
THEN GR = 350 (max of forecast, PO)

GIVEN forecast = 200, confirmed_PO = 350, PO age = 120 days (> 90 cutoff)
WHEN gross requirement calculated
THEN GR = 200 (PO too old, use forecast only)
```

### AC-11: Missing Safety Stock Handling
```gherkin
GIVEN item X has no safety_stock_target record
WHEN DRP runs for item X
THEN SS defaults to 0
  AND MISSING_SS exception created
  AND DRP still produces planned orders (when PAB < 0)
```

### AC-12: Performance — 60 Second Target
```gherkin
GIVEN 84,764 forecast rows across 4,830 item × location combinations
WHEN full DRP run executed
THEN duration_ms < 60,000
  AND all combinations processed
  AND no TIMEOUT exceptions
```

### AC-13: Compare Runs
```gherkin
GIVEN two completed DRP runs (before and after demand override)
WHEN planner compares runs
THEN diff shows which planned orders changed (qty, status)
  AND summary shows +/- orders and +/- exceptions
```

---

> **Ghi chú cuối:**
> DRP Netting là "trái tim" của SCP — biến forecast + inventory + SS thành
> actionable planned orders. Với UNIS config đơn giản (L4L, no BOM, no MOQ),
> algorithm straightforward nhưng volume lớn (84K rows). Performance optimization
> và exception handling là 2 focus areas chính.
>
> **Pipeline tổng quan:**
> Step 1 (Forecast) → Step 2 (Inventory) → Step 3 (SS + RTM) → **Step 4 (DRP)** → Step 5 (Allocation)
