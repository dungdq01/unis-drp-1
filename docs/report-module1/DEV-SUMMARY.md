# MODULE 1 — DEV SUMMARY (Tất cả việc cần làm)

**Date:** 2026-04-13 (v3 — Tab structure + Chart fix)  
**From:** Tech Lead  
**Status:** 13 items FIXED. Tab structure sai → cần redesign. Charts thiếu.

---

## CONTEXT

Module 1 (Demand Ingestion) hoạt động end-to-end:
- Python parse DRP CSV → ghi DB (70,620 rows, 12 columns)
- NestJS 15+ endpoints trả data
- Next.js render: KPI, matrix, coverage, filters, upload, override, branches, alerts
- Accuracy data loaded: 1,660 rows in `demand_accuracy` table
- 13 bug/feature items: **ALL FIXED & VERIFIED**

---

## PHẦN 1: 13 ITEMS — ALL CLOSED (không liệt kê lại)

---

## PHẦN 2: TAB STRUCTURE — CẦN SỬA LẠI

### Hiện tại (SAI)

```
[Branch Forecast]  [Forecast Accuracy]
     Tab 1               Tab 2
```

Sai vì: Accuracy tách riêng → planner phải nhảy qua lại giữa forecast data và accuracy.
Forecast tổng (overview) không có tab riêng.

### Đúng phải là

```
┌─────────────────────────────────────────────────────────────────┐
│ 01  Demand Ingestion                                            │
├─────────────────────────────────────────────────────────────────┤
│  [Tab 1: Forecast Overview]     [Tab 2: Branch Forecast]        │
│   (tổng SKU-level)              (chi nhánh × SKU)               │
└─────────────────────────────────────────────────────────────────┘
```

**Tab 1 = Forecast Overview (TỔNG)**
- Data source: `demand_accuracy` table (từ `full_accuracy_...csv`)
- Nội dung: forecast tổng + actual + accuracy — TẤT CẢ TRONG 1 TAB
- Accuracy KHÔNG phải tab riêng → nó nằm trong overview

**Tab 2 = Branch Forecast (CHI NHÁNH)**
- Data source: `demand_snapshot_line` + `demand_forecast_detail` (từ `drp_export_...csv`)
- Nội dung: forecast per branch, insights, matrix, upload/override

---

## PHẦN 3: TAB 1 — FORECAST OVERVIEW (CẦN BUILD LẠI)

### Data source

```
full_accuracy_T10_T11_T12_T1_forecast_T2_T3.csv → demand_accuracy table (1,660 SKUs)
Columns: actual T10→T1, forecast T12→T3, accuracy%, model vs MA3, WMA backtest
```

### Layout chi tiết

```
TAB 1: FORECAST OVERVIEW
═══════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────┐
│  KPI CARDS (4)                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │Model Acc │  │ MA3 Acc  │  │ Gain     │  │SKUs Eval │       │
│  │  54.2%   │  │  43.3%   │  │ +10.9%   │  │  1,104   │       │
│  │ T1 LIVE  │  │ baseline │  │ vs MA3   │  │ has actual│       │
│  │ 🟢 green │  │ ⚪ gray  │  │ 🟢 green │  │          │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FORECAST vs ACTUAL — BY MONTH                                  │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                                                       │      │
│  │   ▐▐▐▐  ← Forecast (blue)                           │      │
│  │   ████  ← Actual (green, nếu có)                    │      │
│  │                                                       │      │
│  │    T10     T11     T12★    T1★     T2      T3        │      │
│  │   ▐████  ▐████  ▐▐████  ▐▐████  ▐▐      ▐▐         │      │
│  │                                   (pending) (pending) │      │
│  │                                                       │      │
│  │  ★ = model outperforms MA3                            │      │
│  │  T2/T3 = forecast only (chưa có actual)               │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  ACCURACY TABLE — BY MONTH                                      │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Month │ SKUs │ Model │ MA3   │ Gain  │ Gain Bar     │      │
│  ├───────┼──────┼───────┼───────┼───────┼──────────────┤      │
│  │ T10   │1,171 │ 33.5% │ 33.5% │   —   │              │      │
│  │ T11   │1,195 │ 38.9% │ 38.9% │   —   │              │      │
│  │ T12 ★ │1,180 │ 46.9% │ 42.1% │ +4.8% │ ████         │      │
│  │ T1 🔴 │1,104 │ 54.2% │ 43.3% │+10.9% │ █████████    │      │
│  │ T2    │  —   │  fc   │  —    │  —    │ pending      │      │
│  │ T3    │  —   │  fc   │  —    │  —    │ pending      │      │
│  └──────────────────────────────────────────────────────┘      │
│  ★ = backtest  🔴 = LIVE result                                 │
│                                                                 │
│  ACCURACY BY VOLUME TIER                                        │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Tier     │ SKUs │ Model │ MA3   │ Gain │ Gain Bar   │      │
│  ├──────────┼──────┼───────┼───────┼──────┼────────────┤      │
│  │ Top 20   │  20  │ 80.8% │ 77.3% │+3.5% │ ███        │      │
│  │ Top 50   │  50  │ 78.0% │ 70.2% │+7.8% │ ██████     │      │
│  │ Top 100  │ 100  │ 74.9% │ 69.3% │+5.6% │ █████      │      │
│  │ Top 200  │ 200  │ 72.0% │ 67.1% │+4.9% │ ████       │      │
│  │ Top 500  │ 500  │ 65.6% │ 60.5% │+5.1% │ ████       │      │
│  │ All      │1,104 │ 54.2% │ 43.3% │+10.9%│ █████████  │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  SKU ACCURACY TABLE (paginated, filterable)                     │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ Filters: [Month ▼T1] [Segment ▼All] [Winner ▼All]   │      │
│  │ Sort:    [▼ Actual desc]                              │      │
│  ├──────────────────────────────────────────────────────┤      │
│  │ FSKU        │ Seg │Actual │Model │ MA3  │Acc% │Win  │      │
│  │ UGC3600  A  │  A  │61,346 │46,222│  —   │75.3%│MODEL│      │
│  │ UGC3602  A  │  A  │39,602 │34,000│  —   │85.9%│MODEL│      │
│  │ M5190    A  │  A  │37,763 │40,445│  —   │92.9%│MODEL│      │
│  │ ...                                                   │      │
│  │                              Page 1/24  [< >]         │      │
│  └──────────────────────────────────────────────────────┘      │
│                                                                 │
│  ⚠ WORST PERFORMERS (cần review)                                │
│  ┌──────────────────────────────────────────────────────┐      │
│  │ SKUs where model accuracy < 20% AND actual > 100     │      │
│  │ FSKU       │ Actual │ Model │ Acc%  │ FC T2 │ FC T3  │      │
│  │ XXX-001    │   800  │    50 │  2.1% │   80  │   90   │      │
│  │ → Planner nên review & override forecast T2-T3       │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### Charts BẮT BUỘC (dev hiện chỉ render tables — THIẾU)

```
PHẢI CÓ CHARTS (dùng CSS Tailwind bars — KHÔNG thêm recharts):

  1. Forecast vs Actual BAR CHART (by month)
     - 2 bars per month: blue=forecast, green=actual
     - T2/T3: chỉ forecast bar (dashed border, no actual)
     - Tet months (T1,T2,T3): highlight background
     
     Cách implement bằng CSS:
       <div className="flex items-end gap-1 h-32">
         <div style={{ height: `${forecastPct}%` }} className="w-8 bg-sky-400 rounded-t" />
         <div style={{ height: `${actualPct}%` }} className="w-8 bg-emerald-400 rounded-t" />
       </div>

  2. Gain HORIZONTAL BARS (in accuracy tables)
     - Green bar proportional to gain %
     - Max gain = full width
     
       <div className="w-full bg-gray-100 rounded h-2">
         <div style={{ width: `${gain / maxGain * 100}%` }} className="h-2 bg-green-500 rounded" />
       </div>

  3. Accuracy % COLOR CODING
     - ≥70% = green text
     - 40-70% = yellow text
     - <40% = red text
     
  KHÔNG CẦN recharts, chart.js, hoặc bất kỳ chart library nào.
  Tailwind CSS bars đủ cho tất cả charts trong spec.
```

---

## PHẦN 4: TAB 2 — BRANCH FORECAST (ĐÃ CÓ — giữ nguyên + nhỏ sửa)

### Giữ nguyên

```
TAB 2: BRANCH FORECAST
  Data source: drp_export → demand_snapshot_line + demand_forecast_detail
  ├── KPI: Coverage 59%, Total Demand 6.7M, Tet uplift, Overrides
  ├── Insights: byPeriod, bySegment, byComboClass, tetImpact
  ├── Branch breakdown: 54 branches, demand per branch
  ├── Forecast matrix: FSKU × month pivot (branch-aggregated)
  ├── Quality: confidence spread, alerts, zero-forecast items
  └── Upload CSV / Override / Freeze / Export
```

### Sửa nhỏ

```
  [ ] Bỏ KPI card "Acc. Proxy" (không chính xác, Tab 1 đã có real accuracy)
  [ ] Thay bằng KPI card link sang Tab 1: "Model Acc 54.2% → View Detail"
```

---

## PHẦN 5: DATA ARCHITECTURE (giữ nguyên)

### 2 file = 2 tab = 2 pipeline

```
full_accuracy CSV ──→ load_accuracy_to_db.py ──→ demand_accuracy (DB)
                                              ──→ BE accuracy endpoints
                                              ──→ Tab 1 (Forecast Overview)

drp_export CSV ──→ step1_demand.py ──→ demand_snapshot_line (DB)
                                   ──→ demand_forecast_detail (DB)
                                   ──→ BE demand/insights endpoints
                                   ──→ Tab 2 (Branch Forecast)
```

---

## PHẦN 6: BUGS ĐÃ FIX BỞI TECH LEAD (trong lần review này)

### accuracy.service.ts — 2 bugs column không tồn tại

```
Bug 1: colsForMonth() referenced ma3_t10, ma3_t11, acc_ma3_t10, acc_ma3_t11
       → KHÔNG có trong DB schema
       → Fix: dùng wma_t10/wma_t11 (WMA ≡ MA3 cho T10/T11 per docs)

Bug 2: getSummary() UNION query referenced acc_ma3_t10
       → Fix: đổi thành acc_wma_t10

Đã fix trực tiếp trong code. Dev restart BE là OK.
```

### load_accuracy_to_db.py — unicode crash

```
Bug: print() dùng → (arrow) → crash trên Windows cp1252
Fix: đổi → thành ->
Đã fix trực tiếp trong code.
```

---

## PHẦN 7: CHECKLIST — Dev cần làm

### MUST (Tab structure + Charts)

```
FE restructure:
  [ ] Đổi tab names: "Branch Forecast" → "Forecast Overview" | "Forecast Accuracy" → "Branch Forecast"
  [ ] Tab 1 (Forecast Overview): move accuracy content here + thêm forecast vs actual
  [ ] Tab 2 (Branch Forecast): giữ nguyên content hiện tại (KPI, insights, matrix, branches)
  [ ] Bỏ KPI "Acc. Proxy" trong Tab 2, thay bằng link sang Tab 1

FE charts (trong Tab 1):
  [ ] Forecast vs Actual bar chart (2 bars per month, T2/T3 dashed)
  [ ] Gain horizontal bars trong accuracy-by-month table
  [ ] Gain horizontal bars trong accuracy-by-tier table
  [ ] Accuracy % color coding (green ≥70, yellow 40-70, red <40)
  [ ] Worst performers red badges

FE charts dùng CSS bars:
  <div style={{ height: `${pct}%` }} className="w-8 bg-sky-400 rounded-t" />
  <div style={{ width: `${gainPct}%` }} className="h-2 bg-green-500 rounded" />
  KHÔNG thêm recharts/chart.js.
```

### SHOULD (trước UAT)

```
  [ ] Click SKU row → detail: T10→T3 mini timeline
  [ ] Export accuracy data CSV
  [ ] Highlight CAIO-modified SKUs (is_modified badge)
```

### BE — đã build, cần verify sau restart

```
  [ ] GET /demand/accuracy/summary → verify data matches ACCURACY_REPORT_DOCS.md
  [ ] GET /demand/accuracy/skus?month=t1 → verify pagination + filter
  [ ] GET /demand/accuracy/worst?month=t1&threshold=20 → verify results
```

---

## PHẦN 8: ACCEPTANCE CRITERIA

```
Tab structure:
  [ ] Tab 1 = "Forecast Overview" (tổng, accuracy embedded)
  [ ] Tab 2 = "Branch Forecast" (chi nhánh)
  [ ] Accuracy KHÔNG phải tab riêng

Tab 1 content:
  [ ] KPI: Model 54.2%, MA3 43.3%, Gain +10.9%, SKUs 1,104
  [ ] Bar chart: forecast vs actual by month (6 months)
  [ ] Accuracy by month table: T10→T3, gain bars, LIVE badge on T1
  [ ] Accuracy by tier table: Top 20→All, gain bars
  [ ] SKU table: paginated, filter month/segment/winner, sort
  [ ] Worst performers: acc <20%, actual >100, red badges
  [ ] Data matches ACCURACY_REPORT_DOCS.md numbers exactly:
      T12: FINAL 46.9% vs MA3 42.1%
      T1:  FINAL 54.2% vs MA3 43.3%
      Top 20 T1: 80.8%

Tab 2 content:
  [ ] Giữ nguyên hoạt động hiện tại
  [ ] KPI "Acc. Proxy" → thay bằng link "Model Acc 54.2% →"
```

---

## REFERENCE FILES

| File | Nội dung |
|------|----------|
| `docs/01-demand-ingestion.md` | Full spec Module 1 |
| `docs/report-module1/MODULE-1-REVIEW.md` | Bug tracker (all closed) |
| `docs/report-module1/DEMAND-INSIGHTS-SPEC.md` | Spec insight endpoints |
| `docs/report-module1/ACCURACY-DASHBOARD-SPEC.md` | Spec accuracy endpoints + components |
| `data/demand-forecast/ACCURACY_REPORT_DOCS.md` | Accuracy methodology + KPIs |
| `data/demand-forecast/full_accuracy_...csv` | Overview data (1,660 SKUs) |
| `data/demand-forecast/drp_export_...csv` | Branch data (84K rows) |

---

*DEV-SUMMARY.md | Tech Lead | v3.0 | 2026-04-13*
*v3.0: Tab structure redesign (Overview+Branch thay vì Branch+Accuracy), chart requirements, TL bug fixes*
