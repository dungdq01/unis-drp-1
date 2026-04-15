# FORECAST ACCURACY DASHBOARD — Feature Spec

**Date:** 2026-04-13  
**Author:** Tech Lead  
**Priority:** HIGH — Thay thế accuracyProxy (fake MAPE) bằng real accuracy data  
**Data source:** `summary_accuracy_FINAL_vs_MA3.csv` (1,660 SKUs) + `full_accuracy_T10_T11_T12_T1_forecast_T2_T3.csv` (1,660 SKUs)  
**Ref:** `ACCURACY_REPORT_DOCS.md`

---

## Vấn đề

Trang Demand hiện dùng **accuracy proxy** (forecast vs 12m avg) — không chính xác, avg = 99.4%.

Giờ có **real accuracy data**: actual sales T10-T1, forecast accuracy per SKU, FINAL model vs MA3 baseline. Data này nên thay thế proxy và trở thành phần quan trọng nhất của demand insights.

---

## Data Summary

| File | Rows | Content |
|------|------|---------|
| `summary_accuracy_FINAL_vs_MA3.csv` | 1,660 SKUs | Actual T10-T1, Forecast T12-T3, Accuracy %, MA3 benchmark |
| `full_accuracy_T10_T11_T12_T1_forecast_T2_T3.csv` | 1,660 SKUs | Full detail: WMA backtest T10-T11, CAIO flag, all accuracy metrics |

### Key metrics from data

```
T12 (backtest): FINAL 46.9% vs MA3 42.1% → Model wins +4.8%
T1 (LIVE):      FINAL 54.2% vs MA3 43.3% → Model wins +10.9%

Top 20 SKUs T12: 93.6% accuracy (model) vs 66.8% (MA3)
Top 20 SKUs T1:  80.8% accuracy (model) vs 77.3% (MA3)

SKUs with actual T12: 1,180
SKUs with actual T1:  1,104
SKUs with forecast only (T2-T3): 1,660
```

---

## Target UI

```
Thêm vào trang /demand — TAB mới hoặc SECTION mới bên dưới insights:

┌─────────────────────────────────────────────────────────────┐
│  FORECAST ACCURACY                                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  KPI Cards (4)                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │Model Acc │ │MA3 Acc   │ │Model Gain│ │SKUs Eval │      │
│  │ 54.2%    │ │ 43.3%    │ │ +10.9%   │ │ 1,104    │      │
│  │ T1 LIVE  │ │ baseline │ │ vs MA3   │ │ has actual│      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ── ACCURACY BY MONTH ────────────────────────────────────  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Month    │ SKUs │ FINAL │ MA3   │ Gain  │ WMAPE     │  │
│  ├──────────┼──────┼───────┼───────┼───────┼───────────┤  │
│  │ T10      │1,171 │ 33.5% │ 33.5% │   —   │ 42.4%     │  │
│  │ T11      │1,195 │ 38.9% │ 38.9% │   —   │ 50.2%     │  │
│  │ T12 ★    │1,180 │ 46.9% │ 42.1% │ +4.8% │ 68.6%     │  │
│  │ T1 ★LIVE │1,104 │ 54.2% │ 43.3% │+10.9% │ 68.0%     │  │
│  │ T2       │  —   │  fc   │  —    │  —    │ pending   │  │
│  │ T3       │  —   │  fc   │  —    │  —    │ pending   │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ── ACCURACY BY VOLUME TIER ──────────────────────────────  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Tier      │ SKUs │ FINAL │ MA3   │ Gain             │  │
│  ├───────────┼──────┼───────┼───────┼──────────────────┤  │
│  │ Top 20    │  20  │ 80.8% │ 77.3% │ +3.5% ███       │  │
│  │ Top 50    │  50  │ 78.0% │ 70.2% │ +7.8% █████     │  │
│  │ Top 100   │ 100  │ 74.9% │ 69.3% │ +5.6% ████      │  │
│  │ Top 200   │ 200  │ 72.0% │ 67.1% │ +4.9% ███       │  │
│  │ Top 500   │ 500  │ 65.6% │ 60.5% │ +5.1% ████      │  │
│  │ All       │1,104 │ 54.2% │ 43.3% │+10.9% ████████  │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ── MODEL vs MA3 SCATTER ─────────────────────────────────  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         100%|          ·    ·                        │  │
│  │  Model     |     ·  · ·  · ·                        │  │
│  │  Accuracy  |   ·  ···  ·····                        │  │
│  │            |  · ·····•·····                         │  │
│  │          0%|___·__·_·___·____                       │  │
│  │            0%       50%     100%                     │  │
│  │                MA3 Accuracy                          │  │
│  │  ● Above diagonal = Model wins                       │  │
│  │  ○ Below diagonal = MA3 wins                         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ── SKU ACCURACY TABLE ───────────────────────────────────  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ FSKU        │ Actual │ Model │ MA3  │ Acc%  │Winner │  │
│  │ UGC3600  A  │ 61,346 │46,222 │  —   │ 75.3% │ MODEL │  │
│  │ UGC3602  A  │ 39,602 │34,000 │  —   │ 85.9% │ MODEL │  │
│  │ M5190    A  │ 37,763 │40,445 │  —   │ 92.9% │ MODEL │  │
│  │ UT552001 A  │ 30,875 │30,900 │  —   │ 99.9% │ MODEL │  │
│  │ ...                                                  │  │
│  │ Filters: [Month ▼] [Segment ▼] [Winner ▼]           │  │
│  │ Sort: by actual desc | by accuracy | by gain         │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  ── WORST PERFORMERS ─────────────────────────────────────  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ SKUs where model accuracy < 20% AND actual > 100     │  │
│  │ → Cần review/override cho T2-T3 forecast              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### DATA Layer — Import accuracy CSV vào DB

#### DB Migration: `003_demand_accuracy.sql`

```sql
CREATE TABLE demand_accuracy (
    id              BIGSERIAL PRIMARY KEY,
    fsku            VARCHAR(50) NOT NULL,
    
    -- Actuals
    actual_t10      DECIMAL(15,2),
    actual_t11      DECIMAL(15,2),
    actual_t12      DECIMAL(15,2),
    actual_t1       DECIMAL(15,2),
    
    -- Model forecast
    final_fc_t12    DECIMAL(15,2),
    final_fc_t1     DECIMAL(15,2),
    final_fc_t2     DECIMAL(15,2),
    final_fc_t3     DECIMAL(15,2),
    
    -- MA3 baseline
    ma3_fc_t12      DECIMAL(15,2),
    ma3_fc_t1       DECIMAL(15,2),
    
    -- Accuracy %
    acc_final_t12   DECIMAL(5,2),
    acc_ma3_t12     DECIMAL(5,2),
    acc_final_t1    DECIMAL(5,2),
    acc_ma3_t1      DECIMAL(5,2),
    
    -- WMA backtest (full file)
    wma_t10         DECIMAL(15,2),
    wma_t11         DECIMAL(15,2),
    acc_wma_t10     DECIMAL(5,2),
    acc_wma_t11     DECIMAL(5,2),
    
    -- Metadata
    is_modified     BOOLEAN DEFAULT false,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT fk_accuracy_item FOREIGN KEY (fsku) REFERENCES item(item_code)
);

CREATE INDEX idx_acc_fsku ON demand_accuracy(fsku);
CREATE INDEX idx_acc_final_t1 ON demand_accuracy(acc_final_t1);
```

#### Python: `load_accuracy_to_db.py`

```
Input: summary_accuracy_FINAL_vs_MA3.csv + full_accuracy (JOIN on fsku)
Output: INSERT into demand_accuracy table
Strip "%" from accuracy columns, parse to decimal
Handle blank = NULL
```

---

### BE Layer — 3 Endpoints

#### BE-A1: Accuracy Summary

```
GET /api/v1/demand/accuracy/summary

Response:
{
  "byMonth": [
    { "month": "T10", "skus": 1171, "finalAcc": 33.5, "ma3Acc": 33.5, "gain": 0, "wmape": 42.4 },
    { "month": "T11", "skus": 1195, "finalAcc": 38.9, "ma3Acc": 38.9, "gain": 0, "wmape": 50.2 },
    { "month": "T12", "skus": 1180, "finalAcc": 46.9, "ma3Acc": 42.1, "gain": 4.8, "wmape": 68.6, "highlight": true },
    { "month": "T1",  "skus": 1104, "finalAcc": 54.2, "ma3Acc": 43.3, "gain": 10.9, "wmape": 68.0, "highlight": true, "live": true }
  ],
  "byTier": [
    { "tier": "Top 20",  "skus": 20,   "finalAcc": 80.8, "ma3Acc": 77.3, "gain": 3.5 },
    { "tier": "Top 50",  "skus": 50,   "finalAcc": 78.0, "ma3Acc": 70.2, "gain": 7.8 },
    { "tier": "Top 100", "skus": 100,  "finalAcc": 74.9, "ma3Acc": 69.3, "gain": 5.6 },
    { "tier": "Top 200", "skus": 200,  "finalAcc": 72.0, "ma3Acc": 67.1, "gain": 4.9 },
    { "tier": "Top 500", "skus": 500,  "finalAcc": 65.6, "ma3Acc": 60.5, "gain": 5.1 },
    { "tier": "All",     "skus": 1104, "finalAcc": 54.2, "ma3Acc": 43.3, "gain": 10.9 }
  ],
  "kpi": {
    "modelAccT1": 54.2,
    "ma3AccT1": 43.3,
    "gainT1": 10.9,
    "skusEvaluated": 1104,
    "modelAccT12": 46.9,
    "gainT12": 4.8
  }
}

Implementation:
  byMonth: Query from DB (KHÔNG hardcode — khi actual T2 về, chỉ cần INSERT row mới):
    SELECT
      AVG(acc_final_t1) as finalAcc, AVG(acc_ma3_t1) as ma3Acc,
      COUNT(*) FILTER (WHERE acc_final_t1 IS NOT NULL) as skus
    FROM demand_accuracy
    -- tương tự cho t10/t11/t12
    -- wmape = phải tính từ raw data, có thể hardcode sau khi verify vs ACCURACY_REPORT_DOCS.md
  byTier: query demand_accuracy ORDER BY actual_t1 DESC,
    compute accuracy per tier slice (Top 20, 50, 100, 200, 500, All)
  kpi: derive from byMonth (latest LIVE month)
```

#### BE-A2: SKU Accuracy Table (paginated)

```
GET /api/v1/demand/accuracy/skus?month=t1&page=1&pageSize=50&sort=actual_desc&segment=A&winner=model

Response:
{
  "data": [
    {
      "fsku": "40.L1.3060.UGC3600",
      "segment": "A",
      "actual": 61346,
      "modelForecast": 46222,
      "ma3Forecast": null,
      "modelAccuracy": 75.3,
      "ma3Accuracy": null,
      "winner": "MODEL",
      "gain": null,
      "isModified": false
    }
  ],
  "meta": { "page": 1, "pageSize": 50, "total": 1180 }
}

Implementation:
  Query demand_accuracy da
  LEFT JOIN item_location_config ilc ON da.fsku = ilc.item_code
    -- demand_accuracy không lưu segment trực tiếp
    -- item table không có abc_class → phải qua item_location_config
    -- Nếu 1 fsku có nhiều location → lấy MIN(abc_class) hoặc most common:
    --   SELECT item_code, MODE() WITHIN GROUP (ORDER BY abc_class) as segment
    --   FROM item_location_config GROUP BY item_code → sub-query / CTE
  month param selects which columns to return (t10/t11/t12/t1)
  winner = modelAcc > ma3Acc ? "MODEL" : "MA3"
  sort options: actual_desc, accuracy_asc, accuracy_desc, gain_desc
  filter: segment (A/B/C), winner (MODEL/MA3/ALL)
```

#### BE-A3: Worst Performers (needs attention)

```
GET /api/v1/demand/accuracy/worst?month=t1&threshold=20&minActual=100&pageSize=20

Response:
{
  "data": [
    {
      "fsku": "...",
      "segment": "B",
      "actual": 500,
      "modelForecast": 50,
      "modelAccuracy": 2.1,
      "ma3Accuracy": 15.0,
      "forecastT2": 80,
      "forecastT3": 90,
      "action": "REVIEW_NEEDED"
    }
  ],
  "meta": { "total": 47 }
}

Implementation:
  WHERE acc_final_{month} < threshold AND actual_{month} > minActual
  ORDER BY acc_final_{month} ASC
  Include forecast T2/T3 so planner can decide to override
```

---

### FE Layer — Components

#### FE-A1: `components/demand/accuracy-kpi-cards.tsx`

```
4 cards: Model Acc (T1), MA3 Acc, Gain, SKUs Evaluated
Color: Model > MA3 → green gain, else red
```

#### FE-A2: `components/demand/accuracy-by-month.tsx`

```
Table: Month, SKUs, FINAL, MA3, Gain, WMAPE
Highlight rows T12 + T1 (has actual)
T2/T3 rows greyed out (pending actual)
Gain column: green bar width proportional to gain %
```

#### FE-A3: `components/demand/accuracy-by-tier.tsx`

```
Table: Tier, SKUs, FINAL, MA3, Gain
Gain column: horizontal bar (green)
Largest gain highlighted
```

#### FE-A4: `components/demand/accuracy-sku-table.tsx`

```
Paginated table: FSKU, Segment, Actual, Model FC, MA3 FC, Acc%, Winner
Filters: month dropdown, segment, winner (model/ma3)
Sort: by actual, by accuracy, by gain
Color: green row = model wins, red row = MA3 wins
Click row → show T10-T3 timeline for that SKU (Phase 4 — optional, không blocking launch)
```

#### FE-A5: `components/demand/worst-performers.tsx`

```
Alert-style table: SKUs with acc < 20% and actual > 100
Red badges, show forecast T2/T3
Action: "Override T2-T3" button → link to override dialog
```

---

## Integration with existing page

### Option A: Tab trên trang /demand (khuyến nghị)

```
/demand page tabs:
  [Forecast Data] [Accuracy] 

Tab 1 (existing): Insights + Matrix + Branches
Tab 2 (new):      Accuracy dashboard
```

### Option B: Separate page /demand/accuracy

```
Sidebar thêm item: "Forecast Accuracy" dưới "Demand Ingestion"
```

---

## Replaces accuracy proxy

Sau khi implement, thay thế trong insights:

```
KPI card "Acc. Proxy 0.0%" → "Model Acc 54.2% (T1 LIVE)"
Quality section "accuracyProxy" → link to Accuracy tab
Remove proxy formula — dùng real accuracy data
```

---

## Execution Order

```
Phase 1 — Data (1 day):
  [ ] Create migration 003_demand_accuracy.sql
  [ ] Write load_accuracy_to_db.py (parse CSV → INSERT)
  [ ] Run loader → verify 1,660 rows in demand_accuracy

Phase 2 — BE (1 day):
  [ ] BE-A1: GET /accuracy/summary
  [ ] BE-A2: GET /accuracy/skus (paginated + filter + sort)
  [ ] BE-A3: GET /accuracy/worst

Phase 3 — FE (2 days):
  [ ] FE-A1: KPI cards
  [ ] FE-A2: Accuracy by month table
  [ ] FE-A3: Accuracy by tier table + gain bars
  [ ] FE-A4: SKU accuracy table (paginated)
  [ ] FE-A5: Worst performers alert
  [ ] Tab/page integration
  [ ] Replace accuracy proxy KPI card

Phase 4 — Polish:
  [ ] Click SKU → timeline chart (T10→T3)
  [ ] Export accuracy report as CSV
  [ ] Highlight CAIO-modified SKUs (is_modified flag)
```

---

## Acceptance Criteria

```
[ ] AC-A1: KPI shows "Model 54.2% T1" (not proxy 99.4%)
[ ] AC-A2: By-month table: 6 rows (T10-T3), T12/T1 highlighted, gain shown
[ ] AC-A3: By-tier table: 6 tiers, Top 20 = 80.8%, gain bars
[ ] AC-A4: SKU table: 1,104+ rows for T1, paginated, filterable
[ ] AC-A5: Worst performers: SKUs with acc<20% + actual>100 listed
[ ] AC-A6: Filter by month (T10/T11/T12/T1) switches data correctly
[ ] AC-A7: Filter by winner (MODEL/MA3) works
[ ] AC-A8: Sort by actual/accuracy/gain works
[ ] AC-A9: Accuracy proxy KPI replaced with real data
[ ] AC-A10: Data matches ACCURACY_REPORT_DOCS.md numbers exactly
```

---

*ACCURACY-DASHBOARD-SPEC.md | Tech Lead | 2026-04-13*
