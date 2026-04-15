# Module Spec — Step 3: Inventory Policy — Safety Stock + ABC + RTM

> **Module ID:** SCP-UNIS-03
> **Version:** 1.0
> **Last Updated:** 2026-04-11
> **Owner:** R-BA (Requirements Business Analyst)
> **Status:** DRAFT

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ tất cả `tenant_id` trong SQL/Python (`D-MD-03`)
> - **Item PK:** `item_code VARCHAR` — thay `item_id BIGINT` (`D-MD-01`)
> - **Location PK:** `location_code VARCHAR` — thay `location_id BIGINT` (`D-MD-02`)
> - **`location_relationship`** trong §4C.3 = `rtm_rule` trong `00-master-data.md` (đã rename)
> - **`tenant_config`** không tồn tại — dùng `UNIS_CONFIG` constants trong `unis-config.ts`

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

Module này trả lời 3 câu hỏi quan trọng của SC Planning:
1. **Phân loại hàng:** Hàng nào quan trọng nhất? (ABC: A = top 20% doanh thu)
2. **Tồn kho an toàn:** Mỗi mặt hàng tại mỗi kho cần giữ tối thiểu bao nhiêu để không hết hàng?
3. **Lấy hàng từ đâu:** Chi nhánh X lấy hàng từ kho/nhà máy nào, theo thứ tự ưu tiên nào?

> **Tại sao quan trọng?** Safety Stock quá thấp → hết hàng, mất doanh thu.
> Safety Stock quá cao → vốn chết, chiếm diện tích kho. Module này tìm điểm **cân bằng tối ưu**.

**Người dùng chính:** Kế hoạch viên (sc_planner) + SC Manager (duyệt policy)

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **Kế hoạch viên** | Xem SS targets, điều chỉnh nếu cần, kích hoạt policy mới |
| **SC Manager** | Duyệt policy thay đổi trước khi áp dụng vào DRP |
| **IT Admin** | Cập nhật RTM rules khi thêm kho mới / thay đổi tuyến |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là Kế hoạch viên**, tôi muốn **xem Safety Stock cho từng mặt hàng × chi nhánh** để biết cần giữ bao nhiêu hàng tối thiểu | Bảng hiển thị ss_qty, service level target (CSL%), lead time sử dụng |
| US-02 | **Là Kế hoạch viên**, tôi muốn **hệ thống tự tính lại Safety Stock** sau khi có forecast mới để số luôn cập nhật | Trigger "Recalculate SS" → batch compute ~4,800 combinations < 30 giây |
| US-03 | **Là SC Manager**, tôi muốn **duyệt policy mới** trước khi nó ảnh hưởng đến DRP | Policy ở trạng thái DRAFT cho đến khi manager ACTIVATE |
| US-04 | **Là Kế hoạch viên**, tôi muốn **xem RTM rules** (chi nhánh X lấy hàng từ kho nào) để kiểm tra routing hợp lý | Bảng RTM: branch → source P1/P2/P3, lead time tương ứng |
| US-05 | **Là SC Manager**, tôi muốn **so sánh SS cũ vs mới** trước khi activate để hiểu impact | Side-by-side: SS_old vs SS_new, delta%, affected items count |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Tính lại Safety Stock sau forecast mới (Happy Path)

```
1. Kế hoạch viên vừa freeze forecast tháng 4 (Step 1 xong)
2. Vào Step 3 → bấm "Recalculate Safety Stock"
3. Hệ thống tính: ~4,800 item × location combinations, 25 giây
4. Kết quả DRAFT: "A-class: trung bình 450 thùng, B-class: 280 thùng, C-class: 120 thùng"
5. SC Manager review → thấy item GACH-60x60-A4 tại CN-HN-001 SS tăng mạnh (vì Tết)
6. Manager xác nhận logic → bấm "Activate Policy"
7. DRP (Step 4) sẽ dùng SS mới trong lần chạy tiếp theo
```

#### ❌ Kịch bản 2 — SS tính ra bất thường do thiếu lead time (Sad Path)

```
1. Recalculate SS → hệ thống cảnh báo: "15 items thiếu lead_time_days tại 3 kho mới"
2. SS cho các items này dùng default 5 ngày (có thể không chính xác)
3. Kế hoạch viên liên hệ logistics team → lấy lead time thực tế
4. IT admin cập nhật item_location_config → recalculate lại
```

#### ⚠️ Kịch bản 3 — RTM rule sai sau khi mở kho mới (Sad Path)

```
1. UNIS mở kho mới WH-VT-001 (Vũng Tàu)
2. 12 chi nhánh phía Nam nên lấy hàng từ kho mới này thay vì HUB-HCM (gần hơn)
3. IT admin thêm RTM rules mới: 12 CN × P1 = WH-VT-001
4. Allocation (Step 5) lần sau tự động ưu tiên kho Vũng Tàu
```

---

### 0.4 Thuật ngữ

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **Safety Stock (SS)** | Lượng tồn tối thiểu cần giữ để phòng trường hợp demand tăng đột biến hoặc giao hàng trễ |
| **Service Level (CSL)** | Xác suất không hết hàng: A-class = 97.5%, B = 95%, C = 90% |
| **ABC Classification** | A = hàng quan trọng nhất (top 20% doanh thu), B = trung bình, C = ít quan trọng |
| **RTM (Route-to-Market)** | Quy tắc: chi nhánh X lấy hàng từ kho/NM nào, ưu tiên P1 → P2 → P3 |
| **Lead Time** | Số ngày từ lúc đặt hàng đến lúc nhận hàng (NM: 3-7 ngày, Hub→CN: 1-3 ngày) |
| **Policy DRAFT / ACTIVE** | DRAFT = đang tính toán, chưa áp dụng. ACTIVE = DRP đang dùng bộ số này |

---

## 1. Mục đích (Purpose)

Module Inventory Policy bao gồm **3 sub-modules** tính toán các thông số quan trọng
nhất cho Supply Chain Planning:

| Sub-module | Mô tả | Output dùng ở đâu |
|------------|--------|-------------------|
| **A) ABC Classification** | Phân loại items A/B/C theo volume | SS targets, RTM rules, Allocation priority |
| **B) Safety Stock** | Tính tồn kho an toàn per item × location | DRP netting (Step 4) — net requirement threshold |
| **C) RTM Rules** | Routing: CN lấy hàng từ kho nào | Allocation (Step 5) — warehouse selection |

Đây là module **TÍNH TOÁN quan trọng nhất** — output ảnh hưởng trực tiếp đến:
- DRP: SS quyết định khi nào cần đặt hàng
- Allocation: RTM quyết định phân bổ hàng từ đâu
- Service level: SS quá thấp → stockout, quá cao → overstock + vốn chết

---

## 2. UNIS Context (Đặc thù UNIS)

### 2.1. ABC — Dùng từ team thuật toán
- UNIS **KHÔNG tự tính** ABC trong SCP
- ABC segment do team thuật toán gán sẵn trong forecast CSV (`segment` column)
- SCP chỉ import và cross-check
- Cross-check trigger: khi discrepancy > 10% so với SCP internal calculation

### 2.2. Safety Stock — Đặc biệt quan trọng cho UNIS
- UNIS là ngành vật liệu xây dựng — lead time dài (3-7 ngày tùy NM)
- Demand volatility cao (DORMANT_SEASONAL 42%, ERRATIC 14%)
- Tết season tạo demand spike → SS cần buffer thêm
- Xem chi tiết: `UNIS_Safety_Stock_Analysis.md`

### 2.3. RTM — Đơn giản hơn FMCG
- UNIS: 69 CN → 5-8 NM/Hub
- Routing đơn giản: P1 (primary) → P2 (fallback) → P3 (HCM hub)
- Không có cross-docking phức tạp
- C-class items: manual routing (không auto)

---

## 3. Dữ liệu đầu vào (Input Data)

### 3.1. Input cho ABC Classification

| Source | Column | Mô tả |
|--------|--------|--------|
| demand_snapshot_line (Step 1) | `segment` | ABC từ forecast team: A/B/C |
| demand_forecast_detail (Step 1) | `qty_sold_12m_avg` | Doanh số TB 12 tháng |
| demand_forecast_detail (Step 1) | `qty_sold_3m_avg` | Doanh số TB 3 tháng |
| item table | `item_id`, `canonical_id` | Master item data |

### 3.2. Input cho Safety Stock

| Source | Column | Mô tả |
|--------|--------|--------|
| demand_forecast_detail (Step 1) | `qty_sold_12m_avg` | → ADU calculation |
| demand_forecast_detail (Step 1) | `qty_sold_3m_avg` | → σ_demand proxy |
| demand_snapshot_line (Step 1) | `segment` | → CSL target (z-score) |
| demand_snapshot_line (Step 1) | `forecast_qty` | → demand per period |
| item_location_config | `lead_time_days` | UNIS: 3-7 ngày tùy NM |
| item_location_config | `lead_time_variability` | Default: LT × 0.20 |
| tenant_config | `sigma_source` | = 'fc_error' (PRD v3.6 FR-002) |
| tenant_config | `lcnb_mode` | = 'DETECT_ONLY' (chưa EXECUTE) |
| Step 8 output | `mape_actual` | Forecast error → fc_error sigma |

### 3.3. Input cho RTM Rules

| Source | Column | Mô tả |
|--------|--------|--------|
| location table | `location_id`, `location_type` | NM/CN/HUB |
| location_relationship | `branch_id`, `warehouse_id`, `priority` | Mapping CN→kho |
| demand_snapshot_line | `segment` | ABC → routing level |
| geography / region config | `region`, `zone` | Phân vùng địa lý |

---

## 4. Logic xử lý (Processing Logic)

### 4A. ABC Classification

#### 4A.1. Import ABC từ Forecast Team
```python
def import_abc_from_forecast(snapshot_id):
    """
    ABC segment đã có sẵn trong forecast CSV.
    SCP import trực tiếp, KHÔNG tính lại.
    """
    segments = query("""
        SELECT DISTINCT item_id, segment
        FROM demand_snapshot_line
        WHERE snapshot_id = :snapshot_id
    """)

    for row in segments:
        upsert_item_classification(
            item_id=row.item_id,
            abc_class=row.segment,
            source='FORECAST_TEAM',
            snapshot_id=snapshot_id
        )
```

#### 4A.2. ABC Distribution (UNIS actual)

| Class | Tiêu chí | Số items | Tỷ lệ | Mô tả |
|-------|----------|----------|--------|--------|
| **A** | Top 20% volume | 168 | 10.6% | High-value, high-volume items |
| **B** | Next 30% volume | 1,097 | 69.2% | Medium-value items |
| **C** | Bottom 50% volume | 317 | 20.0% | Low-value, low-volume items |
| **Total** | | **1,582** | | (excluding 78 unclassified) |

**Lưu ý:** Tổng 1,660 FSKUs - 241 dormant = 1,419 active. Nhưng chỉ 1,582 có
segment assignment (37 items thiếu data → unclassified → treat as C).

#### 4A.3. Cross-check Logic
```python
def cross_check_abc(item_id, forecast_segment, internal_calc_segment):
    """
    Cross-check ABC từ forecast team vs SCP internal calculation.
    Chỉ trigger khi discrepancy > 10%.
    """
    if forecast_segment != internal_calc_segment:
        discrepancy = calculate_volume_discrepancy(item_id)
        if discrepancy > 0.10:  # > 10%
            create_alert(
                type='ABC_DISCREPANCY',
                item_id=item_id,
                forecast_class=forecast_segment,
                internal_class=internal_calc_segment,
                discrepancy_pct=discrepancy
            )
            # Vẫn dùng forecast_segment (team thuật toán = source of truth)
            return forecast_segment
    return forecast_segment
```

#### 4A.4. Internal ABC Calculation (reference only)
```python
def calculate_abc_internal(items_with_volume):
    """
    SCP internal calculation — chỉ dùng cho cross-check.
    Source of truth vẫn là forecast team.
    """
    # Sort by annual volume descending
    sorted_items = sorted(items_with_volume, key=lambda x: x.annual_volume, reverse=True)
    total_volume = sum(i.annual_volume for i in sorted_items)

    cumulative = 0
    for item in sorted_items:
        cumulative += item.annual_volume
        pct = cumulative / total_volume

        if pct <= 0.20:
            item.internal_class = 'A'
        elif pct <= 0.50:
            item.internal_class = 'B'
        else:
            item.internal_class = 'C'

    return sorted_items
```

---

### 4B. Safety Stock Computation

#### 4B.1. Core Formula

```
SS = z(CSL) × √(LT × σ²_demand + ADU² × σ²_LT)
```

**Giải thích từng thành phần:**

| Ký hiệu | Tên | Công thức | UNIS value |
|----------|-----|-----------|------------|
| `z(CSL)` | Z-score theo Cycle Service Level | Lookup table | A=1.96, B=1.645, C=1.282 |
| `CSL` | Cycle Service Level target | Per ABC class | A=97.5%, B=95%, C=90% |
| `LT` | Lead Time (ngày) | item_location_config | 3-7 ngày tùy NM |
| `σ_demand` | Demand standard deviation | **fc_error based** | Xem 4B.2 |
| `ADU` | Average Daily Usage | qty_sold_12m_avg / 365 | Per item |
| `σ_LT` | Lead Time variability | LT × 0.20 (default) | 20% of LT |

#### 4B.2. Sigma Source — fc_error (QUAN TRỌNG)

Per PRD v3.6 FR-002: `sigma_source = 'fc_error'`

**UNIS KHÔNG dùng σ_demand trực tiếp.** Thay vào đó:

```python
def calculate_sigma_demand(item_id, location_id):
    """
    sigma_source = 'fc_error':
    σ_demand = forecast_error_std, KHÔNG phải demand volatility.

    Nếu chưa có forecast error history (new item / first run):
    → fallback: qty_sold_3m_avg × 0.30 (proxy)
    """
    fc_errors = get_forecast_errors(item_id, location_id, months=6)

    if len(fc_errors) >= 3:
        # Đủ data → dùng forecast error std
        sigma = std(fc_errors)  # standard deviation of (forecast - actual)
    else:
        # Fallback: proxy từ 3-month avg × 30%
        qty_3m = get_qty_sold_3m_avg(item_id, location_id)
        sigma = qty_3m * 0.30

    return sigma
```

**Tại sao fc_error?**
- σ_demand đo volatility của demand → có thể overestimate SS cho seasonal items
- fc_error đo accuracy của forecast → SS chỉ cần buffer cho phần forecast SAI
- Kết quả: SS thấp hơn, inventory lean hơn, nhưng đòi hỏi forecast phải tốt

#### 4B.3. Z-Score Lookup Table

| ABC Class | CSL Target | z-score | Mô tả |
|-----------|-----------|---------|--------|
| A | 97.5% | 1.96 | Items quan trọng nhất — SS cao |
| B | 95.0% | 1.645 | Medium priority |
| C | 90.0% | 1.282 | Low priority — SS thấp |

#### 4B.4. Days of Supply (DOS) Targets

| ABC Class | DOS Target | Mô tả |
|-----------|-----------|--------|
| A | 14 ngày | 2 tuần tồn kho |
| B | 21 ngày | 3 tuần tồn kho |
| C | 30 ngày | ~1 tháng tồn kho |

DOS dùng để **cap** SS: `SS = min(SS_formula, ADU × DOS_target)`
Tránh trường hợp formula tính ra SS quá lớn (ví dụ item có σ cao).

#### 4B.5. LCNB Factor (Lost Case Net Benefit)

```python
def apply_lcnb_factor(ss_base, lcnb_mode='DETECT_ONLY', lcnb_factor=-0.25):
    """
    LCNB: giảm SS khi cost of carrying > cost of stockout.
    
    UNIS hiện tại: lcnb_mode = DETECT_ONLY
    → Chỉ phát hiện items NÊN giảm SS, KHÔNG tự động giảm.
    → Planner review → quyết định có giảm không.
    
    Khi chuyển sang EXECUTE mode:
    → SS tự động giảm 25% cho items flagged.
    """
    if lcnb_mode == 'EXECUTE':
        return ss_base * (1 + lcnb_factor)  # = SS × 0.75
    elif lcnb_mode == 'DETECT_ONLY':
        flag_for_review(ss_base, lcnb_factor)
        return ss_base  # Không giảm
    else:
        return ss_base
```

#### 4B.6. Full SS Calculation Pipeline

```python
def calculate_safety_stock(item_id, location_id, config):
    """
    Full Safety Stock calculation cho 1 item × 1 location.
    """
    # 1. Get inputs
    segment = get_abc_class(item_id)
    z_score = Z_SCORES[segment]          # A=1.96, B=1.645, C=1.282
    dos_target = DOS_TARGETS[segment]    # A=14, B=21, C=30

    lt = get_lead_time(item_id, location_id)             # 3-7 days
    sigma_lt = lt * config.lt_variability_pct             # LT × 0.20
    qty_12m_avg = get_qty_sold_12m_avg(item_id, location_id)
    adu = qty_12m_avg / 365                               # Average Daily Usage

    # 2. Calculate σ_demand (fc_error based)
    sigma_demand = calculate_sigma_demand(item_id, location_id)

    # 3. Core formula
    ss_formula = z_score * math.sqrt(
        lt * (sigma_demand ** 2) + (adu ** 2) * (sigma_lt ** 2)
    )

    # 4. DOS cap
    ss_dos_cap = adu * dos_target
    ss = min(ss_formula, ss_dos_cap)

    # 5. LCNB factor
    ss = apply_lcnb_factor(ss, config.lcnb_mode)

    # 6. Round up to nearest integer
    ss = math.ceil(ss)

    # 7. Minimum SS (tránh SS = 0 cho active items)
    if adu > 0 and ss < 1:
        ss = 1

    return SafetyStockResult(
        item_id=item_id,
        location_id=location_id,
        segment=segment,
        z_score=z_score,
        lead_time=lt,
        sigma_demand=sigma_demand,
        sigma_lt=sigma_lt,
        adu=adu,
        ss_formula=ss_formula,
        ss_dos_cap=ss_dos_cap,
        ss_final=ss,
        lcnb_mode=config.lcnb_mode
    )
```

#### 4B.7. Batch Calculation

```python
def calculate_all_safety_stocks(tenant_id, snapshot_id):
    """
    Batch calculation cho tất cả item × location.
    UNIS: ~1,419 items × 74 locations = ~105,000 combinations.
    Nhưng chỉ có ~4,800 active combinations (không phải mọi item ở mọi location).
    """
    active_combinations = get_active_item_locations(tenant_id, snapshot_id)

    results = []
    for item_id, location_id in active_combinations:
        result = calculate_safety_stock(item_id, location_id, config)
        results.append(result)

    batch_save_safety_stocks(results)
    return len(results)
```

---

### 4C. RTM Rules (Route-to-Market)

#### 4C.1. Routing Hierarchy

```
CN (Chi nhánh) → P1 (Primary Warehouse) → P2 (Fallback) → P3 (HCM Hub)
```

**Mỗi CN có tối đa 3 nguồn cung (prioritized):**

| Priority | Tên | Mô tả | Ví dụ |
|----------|-----|--------|-------|
| P1 | Primary | Kho gần nhất, ưu tiên cao nhất | NM Bình Dương → CN HCM |
| P2 | Fallback | Kho backup nếu P1 hết hàng | NM Hải Phòng → CN HN |
| P3 | Hub | Hub trung tâm (last resort) | HCM Hub → tất cả CN miền Nam |

#### 4C.2. RTM by ABC Class

| ABC Class | Routing Strategy | Mô tả |
|-----------|-----------------|--------|
| **A** | Full cascade P1→P2→P3 | High-value items: cascade qua tất cả sources |
| **B** | P1 only | Medium items: chỉ lấy từ primary warehouse |
| **C** | Manual routing | Low-value: không auto-route, planner quyết định |

#### 4C.3. Data Model — location_relationship

```sql
CREATE TABLE location_relationship (
    id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    branch_id BIGINT NOT NULL REFERENCES location(id),
    warehouse_id BIGINT NOT NULL REFERENCES location(id),
    priority INT NOT NULL,  -- 1=P1, 2=P2, 3=P3
    is_active BOOLEAN DEFAULT true,
    transport_days INT,     -- Thời gian vận chuyển (ngày)
    transport_cost DECIMAL(10,2),  -- Chi phí vận chuyển
    min_order_qty DECIMAL(15,2),   -- Đơn hàng tối thiểu
    created_at TIMESTAMP,
    updated_at TIMESTAMP,

    UNIQUE (tenant_id, branch_id, warehouse_id)
);
```

#### 4C.4. RTM Resolution Logic

```python
def resolve_rtm(item_id, branch_id, abc_class):
    """
    Tìm warehouse(s) để cung cấp item cho branch.
    """
    if abc_class == 'A':
        # Full cascade: P1 → P2 → P3
        warehouses = get_warehouses(branch_id, max_priority=3)
    elif abc_class == 'B':
        # P1 only
        warehouses = get_warehouses(branch_id, max_priority=1)
    elif abc_class == 'C':
        # Manual — return empty, planner decides
        warehouses = []
        flag_for_manual_routing(item_id, branch_id)
    else:
        # Unclassified → treat as C
        warehouses = []

    return warehouses


def get_warehouses(branch_id, max_priority):
    return query("""
        SELECT warehouse_id, priority, transport_days, transport_cost
        FROM location_relationship
        WHERE branch_id = :branch_id
          AND priority <= :max_priority
          AND is_active = true
        ORDER BY priority ASC
    """)
```

#### 4C.5. RTM Configuration (UNIS)

```yaml
unis_rtm_config:
  cascade_enabled: true
  max_cascade_depth: 3        # P1, P2, P3
  auto_route_classes: ['A', 'B']
  manual_route_classes: ['C']
  hub_location_code: 'HCM-HUB'
  fallback_to_hub: true       # A-class items always have HCM-HUB as P3
  cross_region_allowed: true  # Cho phép lấy hàng cross-region cho A-class
```

---

## 5. Dữ liệu đầu ra (Output Data)

### 5.1. item_abc_classification

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | |
| `tenant_id` | BIGINT FK | |
| `item_id` | BIGINT FK | → item table |
| `abc_class` | CHAR(1) | A / B / C |
| `source` | VARCHAR(30) | FORECAST_TEAM / INTERNAL_CALC |
| `snapshot_id` | BIGINT FK | Snapshot gốc |
| `annual_volume` | DECIMAL(18,2) | Volume dùng để classify |
| `volume_pct` | DECIMAL(5,4) | % of total volume |
| `cumulative_pct` | DECIMAL(5,4) | Cumulative % |
| `internal_class` | CHAR(1) | SCP internal calc (cross-check) |
| `discrepancy_flag` | BOOLEAN | True nếu forecast ≠ internal > 10% |
| `effective_date` | DATE | Ngày áp dụng |
| `created_at` | TIMESTAMP | |

### 5.2. safety_stock_target

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | |
| `tenant_id` | BIGINT FK | |
| `item_id` | BIGINT FK | → item table |
| `location_id` | BIGINT FK | → location table |
| `abc_class` | CHAR(1) | A/B/C |
| `csl_target` | DECIMAL(5,4) | 0.975 / 0.95 / 0.90 |
| `z_score` | DECIMAL(4,3) | 1.96 / 1.645 / 1.282 |
| `lead_time_days` | INT | 3-7 |
| `sigma_demand` | DECIMAL(15,4) | σ from fc_error |
| `sigma_lt` | DECIMAL(10,4) | LT variability |
| `adu` | DECIMAL(15,4) | Average Daily Usage |
| `ss_formula` | DECIMAL(15,2) | Raw formula output |
| `ss_dos_cap` | DECIMAL(15,2) | DOS cap value |
| `ss_final` | INT | Final SS (rounded up) |
| `dos_target` | INT | 14/21/30 days |
| `lcnb_mode` | VARCHAR(20) | DETECT_ONLY / EXECUTE |
| `lcnb_flag` | BOOLEAN | True = should reduce SS |
| `sigma_source` | VARCHAR(20) | fc_error / demand_vol |
| `effective_date` | DATE | |
| `created_at` | TIMESTAMP | |
| `snapshot_id` | BIGINT FK | Demand snapshot used |

**Composite Unique:** (tenant_id, item_id, location_id, effective_date)

### 5.3. location_relationship (RTM)
Xem schema ở section 4C.3.

### 5.4. rtm_resolution_log

| Column | Type | Mô tả |
|--------|------|--------|
| `id` | BIGINT PK | |
| `item_id` | BIGINT FK | |
| `branch_id` | BIGINT FK | CN |
| `abc_class` | CHAR(1) | |
| `resolved_warehouses` | JSONB | [{warehouse_id, priority, transport_days}] |
| `routing_strategy` | VARCHAR(20) | FULL_CASCADE / P1_ONLY / MANUAL |
| `resolved_at` | TIMESTAMP | |

---

## 6. API Endpoints

### 6.1. ABC Classification APIs

#### GET /api/v1/inventory/abc/classification
**Mô tả:** Danh sách ABC classification

**Query params:** `segment` (A/B/C), `discrepancy_flag`, `page`, `page_size`

**Response:**
```json
{
  "data": [
    {
      "item_id": 42,
      "canonical_id": "FSKU-001",
      "item_name": "Xi măng PCB40",
      "abc_class": "A",
      "source": "FORECAST_TEAM",
      "annual_volume": 125000,
      "volume_pct": 0.0312,
      "internal_class": "A",
      "discrepancy_flag": false
    }
  ],
  "summary": {
    "A": 168, "B": 1097, "C": 317, "unclassified": 37
  }
}
```

#### POST /api/v1/inventory/abc/cross-check
**Mô tả:** Trigger cross-check giữa forecast team ABC vs internal calc

#### GET /api/v1/inventory/abc/discrepancies
**Mô tả:** List items có discrepancy > 10%

### 6.2. Safety Stock APIs

#### POST /api/v1/inventory/safety-stock/calculate
**Mô tả:** Trigger batch SS calculation

**Request:**
```json
{
  "demand_snapshot_id": 42,
  "scope": "ALL",
  "recalculate_existing": false
}
```

**Response (202 Accepted):**
```json
{
  "job_id": "ss-calc-20260411-001",
  "status": "PROCESSING",
  "total_combinations": 4830,
  "estimated_duration_seconds": 30
}
```

#### GET /api/v1/inventory/safety-stock/targets
**Mô tả:** List SS targets

**Query params:** `item_id`, `location_id`, `abc_class`, `page`, `page_size`

**Response:**
```json
{
  "data": [
    {
      "item_id": 42,
      "location_id": 15,
      "abc_class": "A",
      "ss_final": 450,
      "adu": 34.2,
      "lead_time_days": 5,
      "sigma_demand": 12.5,
      "dos_target": 14,
      "lcnb_flag": false
    }
  ]
}
```

#### GET /api/v1/inventory/safety-stock/{item_id}/{location_id}/breakdown
**Mô tả:** Chi tiết tính toán SS cho 1 item × location

**Response:**
```json
{
  "item_id": 42,
  "location_id": 15,
  "abc_class": "A",
  "z_score": 1.96,
  "csl_target": 0.975,
  "lead_time_days": 5,
  "sigma_demand": 12.5,
  "sigma_lt": 1.0,
  "adu": 34.2,
  "ss_formula": 487.3,
  "ss_dos_cap": 478.8,
  "ss_final": 479,
  "dos_target": 14,
  "sigma_source": "fc_error",
  "lcnb_mode": "DETECT_ONLY",
  "lcnb_flag": false,
  "calculation_steps": [
    "z(CSL) = 1.96 (A-class, CSL=97.5%)",
    "LT = 5 days",
    "σ_demand = 12.5 (fc_error, 6 months history)",
    "ADU = 34.2 (12m avg / 365)",
    "σ_LT = 1.0 (LT × 0.20)",
    "SS_formula = 1.96 × √(5 × 12.5² + 34.2² × 1.0²) = 487.3",
    "SS_dos_cap = 34.2 × 14 = 478.8",
    "SS_final = min(487.3, 478.8) = 479 (rounded up)"
  ]
}
```

#### POST /api/v1/inventory/safety-stock/{item_id}/{location_id}/override
**Mô tả:** Planner override SS target

**Request:**
```json
{
  "override_ss": 600,
  "reason": "Khách hàng lớn báo tăng đơn dự kiến Q2"
}
```

### 6.3. RTM APIs

#### GET /api/v1/inventory/rtm/routes
**Mô tả:** List RTM routing configuration

**Query params:** `branch_id`, `warehouse_id`, `priority`, `is_active`

#### POST /api/v1/inventory/rtm/routes
**Mô tả:** Create/update RTM route

**Request:**
```json
{
  "branch_id": 15,
  "warehouse_id": 3,
  "priority": 1,
  "transport_days": 4,
  "transport_cost": 150000,
  "min_order_qty": 100
}
```

#### GET /api/v1/inventory/rtm/resolve/{item_id}/{branch_id}
**Mô tả:** Resolve RTM cho 1 item × branch (xem sẽ lấy hàng từ đâu)

**Response:**
```json
{
  "item_id": 42,
  "branch_id": 15,
  "abc_class": "A",
  "routing_strategy": "FULL_CASCADE",
  "warehouses": [
    { "warehouse_id": 3, "name": "NM Bình Dương", "priority": 1, "transport_days": 3 },
    { "warehouse_id": 7, "name": "NM Hải Phòng", "priority": 2, "transport_days": 5 },
    { "warehouse_id": 1, "name": "HCM Hub", "priority": 3, "transport_days": 2 }
  ]
}
```

---

## 7. Business Rules (UNIS-specific)

### BR-01: ABC Source = Forecast Team
- SCP import ABC từ forecast CSV, KHÔNG tự tính
- Cross-check chỉ khi discrepancy > 10%
- Nếu discrepancy → alert planner, KHÔNG tự sửa
- Forecast team ABC = source of truth

### BR-02: Safety Stock Formula — fc_error
- `sigma_source = 'fc_error'` per PRD v3.6 FR-002
- KHÔNG dùng σ_demand (demand volatility)
- Fallback khi thiếu fc_error data: `qty_sold_3m_avg × 0.30`
- Fallback áp dụng cho: new items, cold-start items, items < 3 months history

### BR-03: CSL by ABC
- A = 97.5% (z=1.96) — service level cao nhất
- B = 95.0% (z=1.645)
- C = 90.0% (z=1.282) — chấp nhận stockout nhiều hơn

### BR-04: DOS Cap
- A = 14 ngày, B = 21 ngày, C = 30 ngày
- SS không được vượt quá `ADU × DOS_target`
- Tránh SS quá lớn cho items có σ cao (ví dụ ERRATIC class)

### BR-05: LCNB = DETECT_ONLY
- Hiện tại UNIS chạy DETECT_ONLY → chỉ flag, không tự giảm SS
- Khi planner muốn giảm → manual override
- Dự kiến chuyển EXECUTE sau khi đủ confidence (Phase 2+)
- EXECUTE sẽ giảm SS 25% cho flagged items

### BR-06: Lead Time Variability = 20%
- Default: `σ_LT = LT × 0.20`
- UNIS có thể customize per NM nếu có data
- NM gần (Bình Dương → HCM): LT=3, σ_LT=0.6
- NM xa (Hải Phòng → HCM): LT=7, σ_LT=1.4

### BR-07: RTM — A Full Cascade, B P1 Only, C Manual
- A items quan trọng nhất → cascade qua tất cả 3 levels
- B items → chỉ lấy từ primary warehouse (cost-effective)
- C items → planner quyết định manually (không đáng auto-route)

### BR-08: Minimum SS = 1
- Active items (ADU > 0) phải có SS >= 1
- Tránh trường hợp formula tính ra SS = 0 cho items có demand

### BR-09: Tết Season — Không điều chỉnh SS
- Tết demand đã được phản ánh trong forecast (tet_flag=Y)
- SS formula dùng fc_error → nếu Tết forecast accurate → SS không tăng
- Nếu Tết forecast inaccurate → fc_error tăng → SS tự động tăng (self-correcting)

---

## 8. Cross-Module References

### 8.1. OUTPUT → Step 4 (DRP Netting)
```
safety_stock_target.ss_final → DRP dùng làm threshold cho net requirements

DRP logic:
IF PAB(week) < ss_final:
    net_requirement = ss_final - PAB(week)
    create planned_order

Query:
SELECT ss_final
FROM safety_stock_target
WHERE item_id = :item_id AND location_id = :location_id
ORDER BY effective_date DESC LIMIT 1
```

### 8.2. OUTPUT → Step 5 (Allocation)
```
RTM rules → Allocation Layer 1 (Routing): CN lấy hàng từ kho nào
ABC class → Allocation Layer 4 (Priority): A-class items ưu tiên allocate trước
SS targets → Allocation Layer 5 (Balance): giữ SS tại warehouse khi allocate
```

### 8.3. INPUT from Step 1 (Demand Ingestion)
```
demand_snapshot_line.segment → ABC class
demand_forecast_detail.qty_sold_12m_avg → ADU
demand_forecast_detail.qty_sold_3m_avg → σ_demand fallback
```

### 8.4. INPUT/OUTPUT ↔ Step 8 (Monitor)
```
INPUT from Step 8:
- Forecast error (MAPE) → fc_error sigma → SS recalculation
- Nếu MAPE giảm → σ_demand giảm → SS giảm (tự nhiên)
- Nếu MAPE tăng → σ_demand tăng → SS tăng (bảo vệ service level)

FC→SS feedback loop:
  forecast improve → fc_error decrease → SS decrease → inventory decrease → cost decrease
  forecast worsen → fc_error increase → SS increase → inventory increase → service protected
```

---

## 9. Giao diện người dùng (UI Requirements)

### 9.1. ABC Dashboard
- **Pareto chart:** X = items (cumulative), Y = volume (cumulative)
  - A zone: blue, B zone: yellow, C zone: gray
- **Summary cards:** A={168 items}, B={1,097}, C={317}, Unclassified={37}
- **Discrepancy alert list:** items có forecast ABC ≠ internal ABC > 10%

### 9.2. Safety Stock Table
- **Matrix view:** rows = items, columns = locations
- **Cell value:** SS final (hover → breakdown tooltip)
- **Color coding:**
  - Green: current inventory > SS → healthy
  - Yellow: current inventory 50-100% of SS → warning
  - Red: current inventory < 50% of SS → critical
- **Filters:** ABC class, location, LCNB flag
- **Sort:** by SS qty, by ADU, by segment

### 9.3. SS Calculation Detail (per item × location)
- **Panel hiển thị tất cả calculation steps:**
  - Input values (z, LT, σ_demand, ADU, σ_LT)
  - Formula breakdown (step-by-step)
  - SS_formula, SS_dos_cap, SS_final
  - LCNB flag status
- **Override button:** planner có thể override SS final
- **History:** danh sách SS calculations lịch sử

### 9.4. RTM Configuration Screen
- **Map view:** hiển thị CN → Warehouse connections trên bản đồ Việt Nam
  - P1 = solid line (green)
  - P2 = dashed line (yellow)
  - P3 = dotted line (gray)
- **Table view:** CN | P1 Warehouse | P2 Warehouse | P3 Warehouse | Transport Days
- **Edit:** click row → edit dialog
- **Bulk import:** upload RTM config CSV

### 9.5. RTM Resolution Preview
- **Input:** chọn item + branch
- **Output:** hiển thị cascade path (P1→P2→P3) với:
  - Warehouse name, available qty, transport days, transport cost
  - A/B/C routing strategy applied

---

## 10. Acceptance Criteria

### AC-01: ABC Import
```gherkin
GIVEN forecast CSV with segment column (A/B/C)
WHEN imported via Step 1
THEN item_abc_classification has 1,582 records
  AND A=168, B=1097, C=317
  AND source = FORECAST_TEAM
```

### AC-02: ABC Cross-check
```gherkin
GIVEN item X has forecast_segment = 'A'
  AND internal calculation says 'B' with discrepancy = 15%
WHEN cross-check runs
THEN discrepancy_flag = true
  AND alert created for planner
  AND abc_class remains 'A' (forecast team = source of truth)
```

### AC-03: Safety Stock — A-class Item
```gherkin
GIVEN item A-class with LT=5, qty_12m_avg=12,500, fc_error_std=12.5
WHEN SS calculated
THEN z_score = 1.96
  AND ADU = 12500/365 = 34.2
  AND σ_LT = 5 × 0.20 = 1.0
  AND SS_formula = 1.96 × √(5 × 12.5² + 34.2² × 1.0²) = ~87
  AND SS_dos_cap = 34.2 × 14 = 479
  AND SS_final = min(87, 479) = 87
```

### AC-04: Safety Stock — fc_error Fallback
```gherkin
GIVEN new item with < 3 months forecast error history
  AND qty_sold_3m_avg = 500
WHEN SS calculated
THEN sigma_demand = 500 × 0.30 = 150 (fallback proxy)
  AND sigma_source logged as 'fc_error_fallback'
```

### AC-05: DOS Cap Applied
```gherkin
GIVEN item with very high σ_demand (volatile)
  AND SS_formula = 2000, ADU = 50, dos_target = 14
WHEN SS calculated
THEN ss_dos_cap = 50 × 14 = 700
  AND ss_final = min(2000, 700) = 700 (capped)
```

### AC-06: LCNB Detect Only
```gherkin
GIVEN lcnb_mode = DETECT_ONLY
  AND item flagged for LCNB reduction
WHEN SS calculated
THEN ss_final = ss_base (KHÔNG giảm)
  AND lcnb_flag = true (flagged for review)
```

### AC-07: RTM — A-class Full Cascade
```gherkin
GIVEN A-class item at CN HCM
  AND RTM: P1=NM Bình Dương, P2=NM Hải Phòng, P3=HCM Hub
WHEN RTM resolved
THEN routing_strategy = FULL_CASCADE
  AND 3 warehouses returned in priority order
```

### AC-08: RTM — B-class P1 Only
```gherkin
GIVEN B-class item at CN HCM
WHEN RTM resolved
THEN routing_strategy = P1_ONLY
  AND 1 warehouse returned (P1 only)
```

### AC-09: RTM — C-class Manual
```gherkin
GIVEN C-class item at CN HCM
WHEN RTM resolved
THEN routing_strategy = MANUAL
  AND 0 warehouses returned
  AND item flagged for manual routing
```

### AC-10: Batch SS Calculation Performance
```gherkin
GIVEN 4,830 active item × location combinations
WHEN batch SS calculation triggered
THEN all 4,830 targets calculated
  AND total duration < 60 seconds
  AND all results saved to safety_stock_target
```

### AC-11: SS Override
```gherkin
GIVEN calculated SS = 87 for item X at location Y
WHEN planner overrides to 120 with reason "Dự kiến demand tăng"
THEN ss_final = 120 (override value)
  AND override logged with user + reason + timestamp
  AND DRP uses 120 as SS target
```

### AC-12: FC→SS Feedback Loop
```gherkin
GIVEN item had MAPE = 30% → σ_demand = 15.0 → SS = 87
WHEN new MAPE data shows MAPE improved to 20% → σ_demand = 10.0
  AND SS recalculated
THEN new SS < 87 (SS decreases as forecast improves)
```

---

> **Ghi chú cuối:**
> Module Inventory Policy là "bộ não" của SCP — tính toán SS sai sẽ dẫn đến
> stockout (SS quá thấp) hoặc overstock (SS quá cao). Với UNIS dùng fc_error
> làm sigma source, chất lượng forecast từ team thuật toán ảnh hưởng TRỰC TIẾP
> đến SS quality. FC→SS feedback loop (Step 8) là cơ chế self-correcting quan trọng.
