# Module Spec — Step 8: Monitor & Learn

> **KPI + Drift Detection + Closed-Loop Feedback** — Theo dõi hiệu quả hệ thống,
> phát hiện drift, alerts, và TRẢ KẾT QUẢ VỀ cho các step trước
> Module này KHÔNG chỉ là dashboard — nó ĐÓNG VÒNG FEEDBACK

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ khỏi `kpi_snapshot` và tất cả SQL (`D-MD-03`)
> - **Item PK:** `item_code VARCHAR` (`D-MD-01`) | **Location PK:** `location_code VARCHAR` (`D-MD-02`)
> - **`kpi_snapshot.tenant_id`** column: bỏ
> - **KPI targets:** Fill Rate ≥ 92%, OTIF ≥ 90%, MAPE (từ team thuật toán) — không tự tính

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

Sau khi hệ thống đã chạy vài tuần/tháng, câu hỏi quan trọng là:
**"Kế hoạch có đúng không? Hàng có giao đúng hẹn không? Forecast có sát thực tế không?"**

Module này đo lường liên tục 3 nhóm chỉ số:
1. **Service Level** — HSTK (bao nhiêu tuần tồn kho), Fill Rate (% đơn được đáp ứng đủ), OTIF (giao đúng hạn)
2. **Forecast Quality** — MAPE (forecast sai bao nhiêu % so với thực bán)
3. **Alerts** — cảnh báo tự động khi có CN sắp hết hàng, đơn quá hạn, forecast lệch nhiều

> **Tính năng đặc biệt — Closed-loop:** Khi hệ thống phát hiện MAPE tháng này tốt hơn,
> tự động tính lại Safety Stock thấp hơn (forecast chính xác hơn → cần buffer ít hơn →
> tiết kiệm vốn). Kết quả được TRẢ VỀ cho Step 3 tự động.

**Người dùng chính:** SC Manager + Kế hoạch viên

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **SC Manager** | Theo dõi dashboard KPI tổng hợp, xử lý alerts nghiêm trọng |
| **Kế hoạch viên** | Xem alerts chi tiết, drill-down vào item/CN cụ thể, ghi note xử lý |
| **Team thuật toán** | Nhận báo cáo MAPE để cải thiện model (export từ hệ thống) |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là SC Manager**, tôi muốn **xem dashboard KPI tổng hợp** mỗi sáng để biết hệ thống đang ở đâu | Dashboard: HSTK, Fill Rate, OTIF, MAPE — màu đèn giao thông xanh/vàng/đỏ |
| US-02 | **Là Kế hoạch viên**, tôi muốn **nhận alert ngay khi CN sắp hết hàng** (HSTK < 1.5 tuần) để kịp đặt hàng khẩn | Alert hiện trên dashboard + notification trong hệ thống |
| US-03 | **Là SC Manager**, tôi muốn **so sánh Plan vs Actual** (kế hoạch bán vs thực tế bán) để đánh giá độ chính xác | Bảng: planned qty vs actual qty, delta%, trend chart |
| US-04 | **Là Kế hoạch viên**, tôi muốn **xem MAPE theo từng sản phẩm** để biết item nào khó dự báo nhất | Bảng MAPE: item × tháng, sort theo error cao nhất |
| US-05 | **Là SC Manager**, tôi muốn **xem hệ thống tự đề xuất giảm Safety Stock** khi forecast cải thiện | Notification: "MAPE giảm → SS có thể giảm 15% → tiết kiệm X tỷ VND vốn lưu động" |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Dashboard bình thường (Happy Path)

```
1. SC Manager mở dashboard 8:00 sáng thứ Hai
2. Fill Rate: 94.2% ✅ (target 92%)
3. OTIF: 91.5% ✅ (target 90%)
4. HSTK tổng: 2.3 tuần (yellow — OK)
5. Alerts: 3 CN HSTK < 1.5 tuần (đỏ)
6. SC Manager click → xem 3 CN đó → Kế hoạch viên đã ghi note "đã đặt hàng khẩn"
7. Không cần action thêm → đóng dashboard
```

#### ❌ Kịch bản 2 — Phát hiện Forecast Drift (Sad Path)

```
1. Hệ thống so sánh forecast tháng 3 vs actual tháng 3
2. MAPE item GACH-80x80: 45% (target < 20%) — cờ đỏ
3. Alert: "Forecast drift detected: GACH-80x80 dự báo cao hơn thực bán 45%"
4. SC Manager xem → phát hiện: khách hàng dự án lớn đã trì hoãn
5. Action: Yêu cầu team thuật toán cập nhật forecast
6. Kế hoạch viên upload forecast mới → re-run DRP với số mới
```

#### ⚠️ Kịch bản 3 — Hệ thống đề xuất giảm Safety Stock (Closed-loop)

```
1. Tháng 4: MAPE tổng giảm từ 22% → 15% (team thuật toán cải thiện model)
2. Hệ thống tự tính: với MAPE thấp hơn → SS có thể giảm ~18%
3. Notification cho SC Manager: "Đề xuất giảm SS: tiết kiệm ~3.2 tỷ VND vốn lưu động"
4. SC Manager review → approve
5. Step 3 (Safety Stock) tự cập nhật → DRP lần sau dùng SS mới thấp hơn
```

---

### 0.4 Thuật ngữ

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **HSTK (Hệ Số Tồn Kho)** | Số tuần tồn kho = tồn hiện có ÷ doanh số TB mỗi tuần. < 1.5 = nguy hiểm |
| **Fill Rate** | % đơn hàng được giao đủ số lượng theo yêu cầu. Target UNIS ≥ 92% |
| **OTIF** | On-Time In-Full — % đơn giao đúng hạn VÀ đủ số. Target ≥ 90% |
| **MAPE** | Mean Absolute Percentage Error — % sai lệch trung bình của forecast. Thấp = tốt |
| **Forecast Drift** | Forecast bắt đầu sai nhiều hơn so với thực tế — cần re-forecast |
| **Closed-loop** | Kết quả từ Step 8 tự động feedback cải thiện Step 1 (forecast) và Step 3 (SS) |
| **Alert** | Cảnh báo tự động khi KPI vượt ngưỡng — hiện trong hệ thống + gửi thông báo |

---

## 1. Purpose

Monitor & Learn thu thập dữ liệu từ toàn bộ pipeline (Step 1-7) để:

1. **Đo KPI** — 7 nhóm KPI theo dõi service level, working capital, trust, AI accuracy
2. **Phát hiện drift** — khi thực tế lệch quá ngưỡng so với forecast/plan
3. **Alerts** — thông báo real-time qua SSE, Email, Zalo
4. **Closed-loop feedback** — TRẢ KẾT QUẢ VỀ Step 1 (re-forecast), Step 3 (SS recalc),
   Step 5 (RTM adjustment)

**Tại sao closed-loop quan trọng?**
Nếu chỉ có dashboard mà không feedback → hệ thống không tự cải thiện.
Ví dụ: MAPE giảm 5%+ → SS có thể giảm → giải phóng vốn tồn kho.
Ví dụ: CN override 40% đơn → RTM rules cần điều chỉnh.

---

## 2. UNIS Context

| Dimension | UNIS Value | Giải thích |
|---|---|---|
| Drift threshold | 20% | Cao hơn MDLZ (15%) — building materials biến động mạnh |
| PSI threshold | 0.30 | Population Stability Index |
| PO overdue days | 10 ngày | Dài hơn MDLZ (7 ngày) |
| Alert channels | SSE, EMAIL, ZALO | Zalo = phổ biến tại VN |
| Override rate target | ≤25% | CN sửa ≤25% đơn là acceptable |
| Fill rate target | ≥92% | Service level |
| Inventory turns target | ≥6.0 | Working capital efficiency |
| MAPE target | ≤25% | Forecast accuracy |
| CO2 tracking | OFF | Sustainability score = 0 |
| HSTK | UNIS-specific KPI | Ngày tồn kho = on_hand / avg_daily_sales |

**HSTK (Hệ số tồn kho) — KPI đặc thù UNIS:**
- Đây là metric chính mà UNIS dùng để đánh giá tồn kho
- Tính bằng tuần: on_hand / avg_weekly_sales
- Khác với standard "Days of Inventory" — UNIS đo bằng tuần

---

## 3. Input

### 3.1 From Step 1 (Demand/Forecast)

| Data | Usage |
|---|---|
| demand_snapshot + demand_snapshot_line | Forecast values cho MAPE calculation |
| actual_sales (external) | Actual values cho MAPE calculation |

### 3.2 From Step 4 (DRP)

| Data | Usage |
|---|---|
| plan_run | DRP execution metrics |
| plan_run exceptions | Netting failures, unfulfilled demand |

### 3.3 From Step 5 (Allocation)

| Data | Usage |
|---|---|
| allocation_run | Allocation success/failure rates |
| allocation exceptions | Shortfalls, SS breaches, LCNB recommendations |

### 3.4 From Step 7 (Execution)

| Data | Usage |
|---|---|
| draft_order + state changes | Order lifecycle: approval SLA, overdue |
| draft_order_line adjustments | CN override tracking (qty changes) |
| erp_posting_log | ERP integration health |

### 3.5 From Supply Data

| Data | Usage |
|---|---|
| current inventory levels | HSTK calculation, stockout detection |
| lot_attribute | Inventory freshness, variant distribution |

---

## 4. Processing Logic

### 4.1 KPI Calculation — 7 Groups

#### Group 1: SERVICE

```python
# Fill Rate = sum(qty_fulfilled) / sum(qty_demanded)
def calc_fill_rate(period):
    fulfilled = sum(order_lines.qty_adjusted for orders where status=CONFIRMED)
    demanded = sum(planned_order_release.qty_planned)
    fill_rate = fulfilled / demanded
    # Target: ≥ 92%
    return fill_rate

# Stockout Days = count days where on_hand < min_threshold per SKU-location
def calc_stockout_days(period, sku, location):
    days = count(
        daily_inventory.on_hand < safety_stock
        for date in period
    )
    return days
```

#### Group 2: WORKING_CAPITAL

```python
# Inventory Turns = COGS / avg_inventory_value
def calc_inventory_turns(period):
    cogs = sum(sales_qty * unit_cost for period)
    avg_inventory = mean(daily_inventory_value for period)
    turns = cogs / avg_inventory
    # Target: ≥ 6.0
    return turns

# HSTK (UNIS-specific) = on_hand / avg_weekly_sales
def calc_hstk(sku, location):
    on_hand = current_inventory(sku, location)
    avg_weekly_sales = mean(weekly_sales[-12:])  # 12 tuần gần nhất
    hstk_weeks = on_hand / avg_weekly_sales if avg_weekly_sales > 0 else float('inf')
    return hstk_weeks
```

**HSTK Thresholds:**

```
HSTK < 1.5 weeks  →  STOCKOUT    (critical alert, prioritize replenishment)
HSTK 1.5 - 3.0    →  OK          (healthy range)
HSTK > 3.0 weeks  →  OVERSTOCK   (review needed, may reduce next order)
```

#### Group 3: TRUST

```python
# Override Rate = count(orders with CN adjustment) / count(total orders)
def calc_override_rate(period):
    adjusted = count(
        orders where any(line.qty_adjusted != line.qty_original)
    )
    total = count(all orders in period)
    override_rate = adjusted / total
    # Target: ≤ 25%
    return override_rate
```

#### Group 4: DECISION_SPEED

```python
# Cycle Time = avg time from DRP run start to order CONFIRMED
def calc_cycle_time(period):
    cycles = [
        order.confirmed_at - plan_run.started_at
        for orders in period
    ]
    return mean(cycles)

# Approval SLA = avg time from PENDING_APPROVAL to APPROVED/REJECTED
def calc_approval_sla(period):
    approvals = [
        order.approved_at - order.pending_at
        for orders where status in (APPROVED, REJECTED)
    ]
    return mean(approvals)
```

#### Group 5: AI_VALUE

```python
# MAPE = mean(|actual - forecast| / actual) * 100
def calc_mape(period, granularity="SKU-CN-WEEK"):
    errors = []
    for (sku, cn, week) in combinations:
        forecast = demand_snapshot_line.qty
        actual = actual_sales.qty
        if actual > 0:
            errors.append(abs(actual - forecast) / actual)
    mape = mean(errors) * 100
    # Target: ≤ 25%
    return mape

# Weighted MAPE (WMAPE) — cho UNIS dùng thêm
def calc_wmape(period):
    sum_abs_error = sum(|actual - forecast|)
    sum_actual = sum(actual)
    wmape = sum_abs_error / sum_actual * 100
    return wmape
```

#### Group 6: SUSTAINABILITY (OFF for UNIS)

```python
# UNIS: co2_tracking = OFF
def calc_sustainability():
    return {
        "co2_total_kg": 0,
        "sustainability_score": 0,
        "status": "DISABLED"
    }
```

#### Group 7: DATA_QUALITY

```python
# Completeness = % fields populated across key tables
def calc_data_completeness():
    tables = ["item_master", "location", "rtm_rule", "lane", "carrier"]
    for table in tables:
        total_fields = count(required_fields)
        populated = count(non_null_fields)
        completeness = populated / total_fields
    return avg(completeness for all tables)

# Accuracy = % records passing validation rules
def calc_data_accuracy():
    checks = [
        check_sku_has_variant(),     # UNIS: mọi gạch phải có specs_id
        check_location_has_rtm(),    # Mọi CN có ít nhất 1 RTM rule
        check_lane_has_rate(),       # Mọi lane có rate
        check_ss_positive(),         # SS ≥ 0
    ]
    accuracy = sum(passed) / sum(total) for all checks
    return accuracy
```

### 4.2 Drift Detection

```python
# Phát hiện khi thực tế lệch quá ngưỡng so với forecast/plan

def detect_drift(period):
    alerts = []

    # Demand drift: actual vs forecast
    for (sku, cn) in active_combinations:
        forecast = get_forecast(sku, cn, period)
        actual = get_actual_sales(sku, cn, period)

        if forecast > 0:
            drift_pct = abs(actual - forecast) / forecast * 100

            if drift_pct > 20:  # UNIS threshold = 20%
                alerts.append(Alert(
                    type="DEMAND_DRIFT",
                    sku=sku, cn=cn,
                    drift_pct=drift_pct,
                    forecast=forecast, actual=actual,
                    severity="WARNING" if drift_pct <= 40 else "CRITICAL"
                ))

    # PSI (Population Stability Index) — distribution shift
    psi = calc_psi(forecast_distribution, actual_distribution)
    if psi > 0.30:  # UNIS threshold
        alerts.append(Alert(
            type="DISTRIBUTION_SHIFT",
            psi_value=psi,
            severity="CRITICAL"
        ))

    return alerts


def calc_psi(expected, actual):
    """Population Stability Index — đo mức thay đổi phân phối"""
    psi = 0
    for bucket in buckets:
        e_pct = expected[bucket] / sum(expected)
        a_pct = actual[bucket] / sum(actual)
        if e_pct > 0 and a_pct > 0:
            psi += (a_pct - e_pct) * ln(a_pct / e_pct)
    return psi
```

### 4.3 Alert System

```python
# Alert channels for UNIS: SSE + EMAIL + ZALO
ALERT_CHANNELS = ["SSE", "EMAIL", "ZALO"]

def send_alert(alert):
    # SSE: real-time push to FE
    sse_push(alert)

    # EMAIL: to relevant stakeholders
    if alert.severity in ("WARNING", "CRITICAL"):
        email_send(
            to=get_stakeholders(alert.type),
            subject=f"[SCP Alert] {alert.type} — {alert.severity}",
            body=format_alert_email(alert)
        )

    # ZALO: to CN managers (Vietnamese popular messaging)
    if alert.severity == "CRITICAL":
        zalo_notify(
            to=get_cn_managers(alert.cn),
            message=format_alert_zalo(alert)
        )
```

**Alert Types:**

| Type | Trigger | Severity | Channels |
|---|---|---|---|
| DEMAND_DRIFT | drift > 20% | WARNING/CRITICAL | SSE, EMAIL |
| DISTRIBUTION_SHIFT | PSI > 0.30 | CRITICAL | SSE, EMAIL, ZALO |
| STOCKOUT_RISK | HSTK < 1.5 weeks | CRITICAL | SSE, EMAIL, ZALO |
| OVERSTOCK | HSTK > 3.0 weeks | WARNING | SSE, EMAIL |
| PO_OVERDUE | Pending > 10 days | WARNING | SSE, EMAIL, ZALO |
| FILL_RATE_LOW | Fill rate < 92% | WARNING | SSE, EMAIL |
| OVERRIDE_HIGH | Override rate > 25% | WARNING | SSE, EMAIL |
| ERP_SFTP_FAILED | SFTP upload fail | CRITICAL | SSE, EMAIL, ZALO |
| MAPE_DEGRADED | MAPE > 25% | WARNING | SSE, EMAIL |
| SS_BREACH | Allocation violated SS | WARNING | SSE |

### 4.4 Closed-Loop Feedback (CRITICAL)

**Đây là phần quan trọng nhất — biến Monitor từ passive dashboard thành active system.**

#### Loop 1: FC → SS (Forecast Accuracy → Safety Stock)

```python
# Weekly Celery task
def fc_ss_feedback_loop():
    """Khi MAPE cải thiện ≥5% → SS có thể giảm → giải phóng vốn"""

    current_mape = calc_mape(last_4_weeks)
    previous_mape = calc_mape(prev_4_weeks)
    improvement = previous_mape - current_mape

    if improvement >= 5.0:  # 5% improvement threshold
        # Recommend SS reduction
        for (sku, location) in active_combinations:
            current_ss = get_safety_stock(sku, location)
            reduction_factor = min(improvement / 100, 0.15)  # max 15% reduction
            suggested_ss = current_ss * (1 - reduction_factor)

            create_recommendation(
                type="SS_REDUCTION",
                sku=sku, location=location,
                current_ss=current_ss,
                suggested_ss=suggested_ss,
                reason=f"MAPE improved {improvement:.1f}%",
                action="AUTO_APPLY"  # or "PLANNER_REVIEW"
            )

        # Trigger DRP re-run with new SS
        emit_event("ss.updated", trigger="fc_ss_loop")
        # → Step 4 picks up new SS → recalculates PAB
```

#### Loop 2: Override Patterns → RTM Adjustment

```python
# Weekly Celery task
def override_rtm_feedback_loop():
    """Khi CN consistently override RTM source → adjust rules"""

    for cn in active_cns:
        overrides = get_overrides(cn, last_4_weeks)
        total_orders = get_total_orders(cn, last_4_weeks)
        override_rate = len(overrides) / total_orders

        if override_rate > 0.25:  # > 25% override
            # Analyze patterns: which source CN prefers?
            preferred_sources = analyze_override_patterns(overrides)

            create_recommendation(
                type="RTM_ADJUSTMENT",
                cn=cn,
                current_rtm=get_rtm_rules(cn),
                suggested_rtm=preferred_sources,
                override_rate=override_rate,
                action="PLANNER_REVIEW"  # RTM changes always reviewed
            )
```

#### Loop 3: Supplier Reliability → Lead Time Variance → SS Recalc

```python
# Monthly Celery task
def supplier_lt_feedback_loop():
    """Khi NM giao hàng chậm consistently → tăng LT variance → SS tăng"""

    for nm in active_nha_may:
        actual_lt = get_actual_lead_times(nm, last_12_weeks)
        configured_lt = get_configured_lead_time(nm)

        lt_mean = mean(actual_lt)
        lt_std = std(actual_lt)

        if lt_mean > configured_lt * 1.2:  # actual LT > 20% over config
            create_recommendation(
                type="LT_UPDATE",
                source=nm,
                configured_lt=configured_lt,
                actual_lt_mean=lt_mean,
                actual_lt_std=lt_std,
                suggested_lt=ceil(lt_mean),
                action="PLANNER_REVIEW"
            )

            # SS recalc needed (SS depends on LT variance)
            emit_event("lt.variance.updated", source=nm)
            # → Step 3 picks up → recalculates SS
```

#### Loop 4: Drift Detection → Re-forecast Trigger

```python
# Continuous (triggered by drift detection)
def drift_reforecast_loop(drift_alert):
    """Khi drift detected → alert planner → trigger re-forecast"""

    if drift_alert.severity == "CRITICAL":
        # Auto-notify planner
        send_alert(Alert(
            type="REFORECAST_RECOMMENDED",
            reason=f"Demand drift {drift_alert.drift_pct:.0f}% detected",
            affected_skus=drift_alert.affected_skus,
            channels=["SSE", "EMAIL", "ZALO"]
        ))

        # Tạo recommendation cho planner
        create_recommendation(
            type="REFORECAST_TRIGGER",
            affected_skus=drift_alert.affected_skus,
            affected_cns=drift_alert.affected_cns,
            drift_pct=drift_alert.drift_pct,
            action="PLANNER_REVIEW"  # planner quyết định re-import forecast
        )
        # → Planner re-imports forecast (Step 1) → cascade to Step 3, 4, 5
```

---

## 5. Output

### 5.1 kpi_snapshot

| Field | Type | Description |
|---|---|---|
| kpi_snapshot_id | UUID | PK |
| tenant_id | UUID | UNIS tenant |
| period_type | ENUM | DAILY, WEEKLY, MONTHLY |
| period_start | DATE | |
| period_end | DATE | |
| kpi_group | ENUM | SERVICE, WORKING_CAPITAL, TRUST, ... |
| kpi_code | VARCHAR | FILL_RATE, HSTK, OVERRIDE_RATE, ... |
| value | DECIMAL | Giá trị KPI |
| target | DECIMAL | Target value |
| status | ENUM | ON_TARGET, WARNING, CRITICAL |
| dimension_sku | UUID | Optional: per-SKU breakdown |
| dimension_location | UUID | Optional: per-location breakdown |

### 5.2 drift_detection_log

| Field | Type | Description |
|---|---|---|
| drift_id | UUID | PK |
| detected_at | TIMESTAMPTZ | |
| drift_type | ENUM | DEMAND_DRIFT, DISTRIBUTION_SHIFT |
| sku_id | UUID | Affected SKU |
| location_id | UUID | Affected location |
| drift_pct | DECIMAL | % lệch |
| psi_value | DECIMAL | PSI score (nếu applicable) |
| severity | ENUM | WARNING, CRITICAL |
| action_taken | VARCHAR | Alert sent, reforecast triggered, etc. |

### 5.3 alert

| Field | Type | Description |
|---|---|---|
| alert_id | UUID | PK |
| alert_type | VARCHAR | DEMAND_DRIFT, STOCKOUT_RISK, etc. |
| severity | ENUM | INFO, WARNING, CRITICAL |
| title | VARCHAR | Short description |
| body | TEXT | Detail |
| channels_sent | ARRAY | ["SSE", "EMAIL", "ZALO"] |
| acknowledged_by | UUID | User who acknowledged |
| acknowledged_at | TIMESTAMPTZ | |

### 5.4 feedback_recommendation

| Field | Type | Description |
|---|---|---|
| recommendation_id | UUID | PK |
| loop_type | ENUM | FC_SS, OVERRIDE_RTM, SUPPLIER_LT, DRIFT_REFORECAST |
| target_module | VARCHAR | Step 1, Step 3, Step 5 |
| current_value | JSONB | Current config/value |
| suggested_value | JSONB | Recommended change |
| reason | TEXT | Why this change |
| action | ENUM | AUTO_APPLY, PLANNER_REVIEW |
| status | ENUM | PENDING, APPLIED, REJECTED |
| applied_at | TIMESTAMPTZ | |

---

## 6. API Endpoints

### 6.1 Get KPI Dashboard

```
GET /api/v1/monitor/kpi
  ?period_type=WEEKLY
  &period_start=2026-04-01
  &kpi_group=SERVICE,WORKING_CAPITAL
  &location_id={cn_id}
```

Response:
```json
{
  "period": "2026-W14",
  "kpis": [
    {
      "kpi_code": "FILL_RATE",
      "value": 0.94,
      "target": 0.92,
      "status": "ON_TARGET",
      "trend": "IMPROVING"
    },
    {
      "kpi_code": "HSTK",
      "value": 2.1,
      "target_min": 1.5,
      "target_max": 3.0,
      "status": "OK",
      "classification": "HEALTHY"
    }
  ]
}
```

### 6.2 Get HSTK Detail

```
GET /api/v1/monitor/hstk
  ?location_id={cn_id}
  &sku_id={sku_id}
  &include_history=true
```

Response:
```json
{
  "sku": "GACH-MEN-60x60",
  "location": "CN Đà Nẵng",
  "hstk_weeks": 1.2,
  "classification": "STOCKOUT",
  "on_hand": 120,
  "avg_weekly_sales": 100,
  "history": [
    {"week": "W12", "hstk": 2.5},
    {"week": "W13", "hstk": 1.8},
    {"week": "W14", "hstk": 1.2}
  ]
}
```

### 6.3 Get Alerts

```
GET /api/v1/monitor/alerts
  ?severity=CRITICAL,WARNING
  &acknowledged=false
  &page=1&size=20
```

### 6.4 Acknowledge Alert

```
POST /api/v1/monitor/alerts/{alert_id}/acknowledge
```

### 6.5 Get Drift Detection

```
GET /api/v1/monitor/drift
  ?period=LAST_4_WEEKS
  &severity=CRITICAL
```

### 6.6 Get Feedback Recommendations

```
GET /api/v1/monitor/feedback/recommendations
  ?loop_type=FC_SS,OVERRIDE_RTM
  &status=PENDING
```

### 6.7 Apply/Reject Feedback Recommendation

```
PUT /api/v1/monitor/feedback/recommendations/{rec_id}
```

Request:
```json
{
  "action": "APPLY",
  "note": "Đồng ý giảm SS 10% vì MAPE đã cải thiện 7%"
}
```

### 6.8 Get Override Analysis

```
GET /api/v1/monitor/overrides
  ?location_id={cn_id}
  &period=LAST_4_WEEKS
```

Response:
```json
{
  "location": "CN Đà Nẵng",
  "total_orders": 45,
  "overridden_orders": 8,
  "override_rate": 0.178,
  "target": 0.25,
  "status": "ON_TARGET",
  "patterns": [
    {
      "pattern": "qty_reduction_avg_15pct",
      "frequency": 5,
      "likely_reason": "Warehouse capacity constraint"
    }
  ]
}
```

---

## 7. Business Rules

| Rule ID | Rule | UNIS Value | Impact |
|---|---|---|---|
| MO-001 | Drift threshold | **20%** | Higher than MDLZ (15%) — materials volatile |
| MO-002 | PSI threshold | **0.30** | Distribution shift detection |
| MO-003 | PO overdue days | **10 ngày** | Longer than MDLZ (7) |
| MO-004 | Alert channels | SSE, EMAIL, ZALO | Zalo popular in VN |
| MO-005 | Override rate target | **≤25%** | Trust metric |
| MO-006 | Fill rate target | **≥92%** | Service level |
| MO-007 | Inventory turns target | **≥6.0** | Working capital |
| MO-008 | MAPE target | **≤25%** | Forecast accuracy |
| MO-009 | CO2 tracking | **OFF** | sustainability_score = 0 |
| MO-010 | HSTK stockout threshold | **< 1.5 weeks** | Critical alert |
| MO-011 | HSTK overstock threshold | **> 3.0 weeks** | Review needed |
| MO-012 | FC→SS loop trigger | MAPE improve ≥5% | SS auto-reduce recommendation |
| MO-013 | Override→RTM loop | Weekly Celery | Analyze patterns, suggest RTM changes |
| MO-014 | Supplier LT loop | Monthly Celery | LT variance → SS recalc |
| MO-015 | Drift→Reforecast loop | On drift detect | Alert planner → re-import forecast |

### HSTK Classification Rules

```
┌──────────────────────────────────────────────────────────┐
│  HSTK (Hệ số tồn kho) — tuần                            │
│                                                           │
│  < 1.5 weeks  →  STOCKOUT     Critical alert             │
│                   Ưu tiên replenishment ngay              │
│                   Notify CN + planner qua ZALO            │
│                                                           │
│  1.5 - 3.0    →  OK           Healthy range              │
│                   Không action, continue monitoring       │
│                                                           │
│  > 3.0 weeks  →  OVERSTOCK    Review needed              │
│                   Giảm next order, kiểm tra demand        │
│                   Có thể là slow-moving SKU               │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Cross-Module Integration

### Inputs

| From | Data | Usage |
|---|---|---|
| Step 1 (Demand) | demand_snapshot_line | Forecast values for MAPE |
| Step 4 (DRP) | plan_run exceptions | Netting issues |
| Step 5 (Allocation) | allocation exceptions | Shortfalls, SS breaches |
| Step 7 (Execution) | order lifecycle events | Approval SLA, overdue, override |
| External | actual_sales | MAPE calculation |
| Step 2 (Supply) | current inventory | HSTK, stockout detection |

### Outputs (Closed-Loop)

| To | Data | Trigger |
|---|---|---|
| Step 1 (Demand) | Drift alert → re-forecast | DEMAND_DRIFT critical |
| Step 3 (Policy) | FC→SS loop → SS recalc | MAPE improve ≥5% |
| Step 3 (Policy) | LT variance → SS update | Supplier LT drift |
| Step 5 (Allocation) | Override patterns → RTM adjust | Override rate > 25% |
| FE | KPI dashboard + alerts | Continuous SSE |

### Event Flow

```
Continuous monitoring:
  → KPI calculated (daily/weekly) → kpi_snapshot stored
  → Drift detection (daily) → drift_detection_log
  → Alerts triggered → SSE + EMAIL + ZALO

Weekly feedback loops:
  → FC→SS loop (Celery) → SS recommendation → Step 3
  → Override→RTM loop (Celery) → RTM recommendation → Step 5

Monthly feedback loops:
  → Supplier LT loop (Celery) → LT update → Step 3

On-demand:
  → Drift critical → reforecast recommendation → Step 1
```

---

## 9. UI Requirements

### 9.1 KPI Dashboard (Main Screen)

- **7 KPI group cards** — mỗi card hiển thị giá trị, target, status badge
  - SERVICE: Fill Rate gauge (green ≥92%, yellow 85-92%, red <85%)
  - WORKING_CAPITAL: Inventory Turns + HSTK summary
  - TRUST: Override Rate (lower is better)
  - DECISION_SPEED: Cycle Time + Approval SLA
  - AI_VALUE: MAPE gauge
  - SUSTAINABILITY: Disabled badge
  - DATA_QUALITY: Completeness + Accuracy %
- **Period selector:** Daily / Weekly / Monthly
- **Filter:** by location (CN), by SKU group

### 9.2 HSTK Heatmap (UNIS Specific)

- **Matrix view:** rows = CN, columns = SKU groups
- **Cell color:**
  - Red (< 1.5 weeks): stockout risk
  - Yellow (1.5 - 3.0): OK
  - Green (> 3.0): overstock
- **Click cell** → drill-down to SKU-CN detail + history chart
- **Export:** Excel for UNIS management review

### 9.3 Alert Center

- **Real-time feed:** newest alerts on top (SSE push)
- **Filter:** by type, severity, acknowledged/unacknowledged
- **Action:** Acknowledge, Snooze, Escalate
- **Badge:** unacknowledged count on nav bar

### 9.4 Drift Analysis

- **Chart:** Forecast vs Actual per SKU-CN (line chart, overlaid)
- **Drift scatter:** X = forecast, Y = actual, color = drift severity
- **PSI trend:** weekly PSI values, threshold line at 0.30

### 9.5 Feedback Loop Dashboard

- **Active recommendations:** list with status (PENDING, APPLIED, REJECTED)
- **Loop performance:**
  - FC→SS: how many SS reductions applied, impact on inventory value
  - Override→RTM: how many RTM rules adjusted, override rate trend
  - Supplier LT: lead time accuracy improvement
- **Action buttons:** Apply / Reject per recommendation

### 9.6 Override Analysis

- **Table:** CN, Override Rate, Trend (arrow up/down), # overrides
- **Drill-down:** which SKUs are consistently overridden, common patterns
- **Recommendation panel:** suggested RTM changes from Loop 2

---

## 10. Acceptance Criteria

| AC ID | Criteria | Test Method |
|---|---|---|
| AC8-01 | Fill Rate calculated correctly (fulfilled/demanded) | Calc test: known data |
| AC8-02 | HSTK = on_hand / avg_weekly_sales | Calc test: known data |
| AC8-03 | HSTK < 1.5 → STOCKOUT classification + critical alert | Threshold test |
| AC8-04 | HSTK > 3.0 → OVERSTOCK classification + warning alert | Threshold test |
| AC8-05 | Drift detected when actual/forecast diverge > 20% | Calc test: 25% drift |
| AC8-06 | PSI > 0.30 triggers DISTRIBUTION_SHIFT alert | Statistical test |
| AC8-07 | Alerts sent to SSE + EMAIL + ZALO (CRITICAL) | Integration test |
| AC8-08 | FC→SS loop: MAPE improve 5% → SS reduction recommended | Feedback test |
| AC8-09 | Override→RTM loop: override > 25% → RTM adjustment suggested | Pattern test |
| AC8-10 | Supplier LT loop: actual LT > 20% over config → LT update | Data test |
| AC8-11 | Drift critical → reforecast recommendation created | Event test |
| AC8-12 | KPI dashboard loads with all 7 groups | E2E test |
| AC8-13 | PO overdue alert at 10 days (not 7) | Config test |
| AC8-14 | CO2/sustainability = disabled, score = 0 | Config test |
| AC8-15 | Override rate calculation includes CN qty adjustments (FR29) | Calc test |
| AC8-16 | Feedback recommendations: apply/reject workflow | E2E test |

---

*Module Spec v1.0 — Step 8: Monitor & Learn*
*Created: 2026-04-11 | R-BA for UNIS*
