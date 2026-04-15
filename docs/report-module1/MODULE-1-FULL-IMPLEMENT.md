# MODULE 1: DEMAND — BẢN IMPLEMENT HOÀN CHỈNH A→Z

**Date:** 2026-04-13 (v2.1 — Post-review bug fixes)  
**Author:** Tech Lead  
**Mục đích:** Dev đọc file này → biết chính xác cần build gì, ở đâu, thứ tự nào

---

## 🔴 BUGS TỪ REVIEW v2.0 — FIX NGAY

### BUG-R1 (CRITICAL): Tab 1 đang dùng data của Tab 2

```
page.tsx Tab 1 (lines 253-311) GỌI SAI endpoints:

  Line 270: CoverageGauge    ← coverage từ fetchForecastCoverage() → demand_snapshot_line = BRANCH DATA
  Line 274: Dormant count     ← quality từ fetchForecastQuality() → demand_forecast_detail = BRANCH DATA  
  Line 286: DataQualityGauges ← quality + coverage + insights = TẤT CẢ TỪ BRANCH DATA

FIX: Tab 1 CHỈ được dùng:
  ✅ fetchAccuracySummary()     → demand_accuracy table
  ✅ fetchAccuracyTrend()       → demand_accuracy table
  ✅ fetchAccuracySkus()        → demand_accuracy table
  ✅ fetchAccuracyWorst()       → demand_accuracy table
  ✅ fetchSkuStatus()           → item table

  ❌ KHÔNG GỌI trong Tab 1:
  fetchForecastInsights()    → demand_snapshot_line (branch)
  fetchForecastQuality()     → demand_forecast_detail (branch)
  fetchForecastCoverage()    → demand_snapshot_line (branch)
  fetchBranchBreakdown()     → demand_snapshot_line (branch)
  fetchForecastAlerts()      → demand_forecast_detail (branch)

CÁCH FIX:
  1. Tách fetch: Tab 1 fetch riêng, Tab 2 fetch riêng (lazy load khi switch tab)
  2. CoverageGauge trong Tab 1: tính từ demand_accuracy (items có forecast / total items)
     KHÔNG dùng fetchForecastCoverage()
  3. DataQualityGauges: tính từ demand_accuracy data (confidence, forecast rate, etc.)
     KHÔNG dùng quality/coverage/insights từ branch endpoints
  4. Dormant count Tab 1: lấy từ accuracy.alerts.dormant (đã đúng source)
```

### BUG-R2 (HIGH): DataQualityGauges hardcode + sai source

```
page.tsx line 289: dataMonths: 31  ← HARDCODED
page.tsx line 290: segments tính từ insights.bySegment (branch data)

FIX:
  - dataMonths: query MAX(panel_months) từ demand_forecast_detail HOẶC 
    tính từ demand_accuracy (có actual T10-T1 = 4 months actual + 2 forecast = 6 months)
  - segments: count distinct segment từ demand_accuracy HOẶC item table
  - forecastRate: items_with_forecast / total_items từ demand_accuracy
  - sparsity: tính từ demand_accuracy data
```

### BUG-R3 (HIGH): FskuBranchTable gọi /forecast/detail — data không aggregated

```
fsku-branch-table.tsx line 53: fetch /demand/forecast/detail
  → trả raw rows từ demand_forecast_detail (1 row per item × branch × period)
  → Không group by branch

FIX: dùng /demand/forecast/pivot (đã có, group by item × period)
     HOẶC tạo endpoint mới /demand/forecast/branch-detail 
     group by item_code, location_code, SUM(qty) per period
```

### BUG-R4 (MEDIUM): Dead code — forecast-vs-actual-chart.tsx

```
File tồn tại nhưng KHÔNG import/render ở đâu trong page.tsx.
forecast-trend-chart.tsx đang render thay.

FIX: Xóa forecast-vs-actual-chart.tsx HOẶC merge vào forecast-trend-chart.tsx
```

### BUG-R5 (MEDIUM): Tab 1 thiếu FSKU forecast list (chỉ có accuracy table)

```
Tab 1 có FskuAccuracyTable → show accuracy per SKU
Nhưng THIẾU: forecast values (final_t12, final_t1, final_t2, final_t3)

FIX: FskuAccuracyTable nên show CẢ forecast + actual + accuracy:
  FSKU | Seg | FC T12 | Act T12 | Acc T12 | FC T1 | Act T1 | Acc T1 | FC T2 | FC T3
  
  Data đã có trong demand_accuracy table — chỉ cần thêm columns vào table
```

---

## ⚠ CRITICAL NOTES — ĐỌC TRƯỚC KHI CODE

```
1. DATA KHÔNG TRỘN: Tab 1 (overview) và Tab 2 (branch) dùng DATA KHÁC NHAU.
   Dev ĐANG implement sai — đưa data forecast overview sang tab branch.
   Tab 1 dùng NHIỀU nguồn (không chỉ 1 table):
     - SKU Status donut     → item table (2,012 items, GROUP BY status)
     - Accuracy metrics     → demand_accuracy table (1,660 SKUs)
     - Forecast trend qty   → demand_snapshot_line (aggregated per period)
     - Confidence band      → demand_snapshot_line (SUM confidence_lower/upper per period)
   Tab 2 = demand_snapshot_line + demand_forecast_detail (70K rows per branch)
   KHÔNG query lẫn Tab 1 ↔ Tab 2.

2. DASHBOARD ≠ CHỈ SO SÁNH MA3. MA3 comparison chỉ là 1 khía cạnh nhỏ.
   Dashboard phải TỔNG HỢP: trạng thái SKU, chất lượng dữ liệu, forecast trend,
   segment breakdown, dormant detection, confidence, seasonal pattern...

3. FSKU TABLE phải CHUYÊN NGHIỆP: phân trang server-side, sort multi-column,
   filter combo, search text, export, column resize. Không chấp nhận table đơn giản.

4. CHARTS phải ĐẸP + ĐA DẠNG + KHOA HỌC:
   - Donut chart (trạng thái SKU)
   - Gauge charts (chất lượng dữ liệu)
   - Line/Area chart (forecast trend xung nhịp từng mã)
   - Bar chart (so sánh periods, segments)
   - Horizontal bars (ranking, distribution)
   - Color palette: đa dạng, gradient, dark/light mode ready

5. Chart library: dùng RECHARTS (thêm vào package.json — ~200KB gzipped, worth it
   cho chất lượng dashboard). CSS bars chỉ cho simple progress indicators.
   ⚠ Override quyết định cũ trong DEMAND-INSIGHTS-SPEC.md ("no recharts").
   MODULE-1-FULL-IMPLEMENT.md (v2) là tài liệu MỚI NHẤT — dev follow file này.
```

---

## KIẾN TRÚC TRANG /demand

```
┌─────────────────────────────────────────────────────────────┐
│ 01  Demand Ingestion           [History] [Export] [Upload]  │
├─────────────────────────────────────────────────────────────┤
│  [Tab 1: Forecast Overview]     [Tab 2: Branch Forecast]    │
└─────────────────────────────────────────────────────────────┘

TAB 1 = Forecast TỔNG (SKU-level)
  → Tổng quan: trạng thái, chất lượng, accuracy, trend, alerts
  → Data: demand_accuracy (1,660 SKUs) + demand_snapshot_line (aggregated)

TAB 2 = Forecast CHI NHÁNH (SKU × branch)
  → Chi tiết per branch: demand, matrix, insights, upload/override
  → Data: demand_snapshot_line + demand_forecast_detail (70K rows)
```

---

## TAB 1: FORECAST OVERVIEW

### Row 1: KPI Cards (8 cards, 2 rows × 4)

```
┌──────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Total    │  │ Active   │  │ Coverage │  │ Dormant  │    │
│  │ SKUs     │  │ SKUs     │  │          │  │          │    │
│  │  1,660   │  │  1,419   │  │  85.5%   │  │   241    │    │
│  │ in system│  │ has fc>0 │  │ ◐ gauge  │  │ ⚠ needs  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ Model    │  │ MA3      │  │ Model    │  │Periods   │    │
│  │ Accuracy │  │ Baseline │  │ Gain     │  │          │    │
│  │  54.2%   │  │  43.3%   │  │ +10.9%   │  │ 4 months │    │
│  │ T1 LIVE🔴│  │          │  │ 🟢 green │  │ Dec→Mar  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└──────────────────────────────────────────────────────────────┘

Mỗi KPI card design:
  - Background: gradient subtle (white → gray-50)
  - Value: text-3xl font-bold
  - Label: text-xs uppercase tracking-wide text-slate-500
  - Subtitle: text-xs text-slate-400
  - Color accent: left border 3px (blue/green/yellow/red per context)
  - Hover: shadow-md transition
```

### Row 2: Tổng quan (2 panels)

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  TRẠNG THÁI SKU              │  │  CHẤT LƯỢNG DỮ LIỆU         │
│  (Donut Chart)               │  │  (4 Gauge Charts)            │
│                              │  │                              │
│      ┌─────────┐            │  │  ┌────────┐  ┌────────┐     │
│      │  60%    │            │  │  │ 85.2%  │  │ 60.0%  │     │
│      │  ACT    │            │  │  │FORECAST│  │SPARSITY│     │
│      └─────────┘            │  │  │ RATE   │  │        │     │
│                              │  │  │  Tốt   │  │  TB    │     │
│  ● ACT    1,203  59.8%      │  │  └────────┘  └────────┘     │
│  ● END      773  38.4%      │  │  ┌────────┐  ┌────────┐     │
│  ● NEW        1   0.0%      │  │  │31 tháng│  │   4    │     │
│  ● Khác      35   1.7%      │  │  │DỮ LIỆU│  │PHÂN KHÚC│    │
│                              │  │  │  Đủ    │  │  OK    │     │
│  Donut colors:               │  │  └────────┘  └────────┘     │
│  ACT=#3B82F6 (blue)          │  │                              │
│  END=#EF4444 (red)           │  │  Gauge: arc SVG, gradient   │
│  NEW=#A855F7 (purple)        │  │  Tốt=green, TB=yellow       │
│  Khác=#94A3B8 (gray)         │  │  Yếu=red                    │
└──────────────────────────────┘  └──────────────────────────────┘

Donut chart: Recharts <PieChart> với innerRadius=60 outerRadius=80
  Center text: "60% ACT" 
  Legend bên phải: color dot + label + count + pct

Gauge charts: SVG arc (180°)
  - Forecast Rate: items_with_forecast / total_items
  - Sparsity: % items có ≥3 months data
  - Dữ liệu: panel_months avg (từ demand_forecast_detail)
  - Phân khúc: count distinct segments (A/B/C + combo classes)
  
  Badge dưới gauge: "Tốt" (green), "TB" (yellow), "Yếu" (red)
```

### Row 3: Forecast Trend (full width — STAR FEATURE)

```
┌──────────────────────────────────────────────────────────────┐
│  FORECAST TREND — XUNG NHỊP DỰ BÁO                          │
│                                                              │
│  Recharts <ComposedChart>:                                   │
│  - Area: forecast qty (gradient blue fill, opacity 0.3)      │
│  - Line: actual qty (solid green, dot markers)               │
│  - Bar: confidence range (error bar style)                   │
│                                                              │
│    Qty                                                       │
│   300K ┤                     ╭─╮                             │
│        │              ╭─────╯  ╰──╮                          │
│   200K ┤    ╭────────╯             ╰────╮                    │
│        │───╯  ░░░░░░░░░░░░░░░░░░░░░░░░  ╰──                │
│   100K ┤     ░░░░░ forecast area ░░░░░░░                     │
│        │     ● actual (green dots)                           │
│      0 ┤────T10────T11────T12────T1────T2────T3──            │
│                                        ⬆ pending            │
│                                                              │
│  Interactive:                                                │
│  - Hover: tooltip shows forecast + actual + accuracy + CI    │
│  - Click period: filter SKU table below by that period       │
│  - T2/T3: dashed line (no actual yet)                        │
│                                                              │
│  Colors:                                                     │
│  - Forecast area: #3B82F6 → #93C5FD (gradient)              │
│  - Actual line: #10B981 (emerald)                            │
│  - Confidence band: #E2E8F0 (gray, semi-transparent)         │
│  - Tet months background: #FEF3C7 (amber-50, subtle)         │
└──────────────────────────────────────────────────────────────┘

Implementation: Recharts ComposedChart
  <ComposedChart data={monthlyData}>
    <defs>
      <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.05}/>
      </linearGradient>
    </defs>
    <Area dataKey="forecast" fill="url(#forecastGrad)" stroke="#3B82F6" />
    <Line dataKey="actual" stroke="#10B981" strokeWidth={2} dot={{ r: 4 }} />
    <Tooltip content={<CustomTooltip />} />
  </ComposedChart>
```

### Row 4: Accuracy (2 panels + gain bars)

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  ACCURACY BY MONTH           │  │  ACCURACY BY VOLUME TIER     │
│                              │  │                              │
│  Month│SKUs│Model│MA3 │Gain  │  │  Tier   │Model│MA3 │Gain    │
│  ─────┼────┼─────┼────┼───── │  │  ───────┼─────┼────┼─────── │
│  T10  │1171│33.5%│33.5│ —    │  │  Top 20 │80.8%│77.3│████ +3 │
│  T11  │1195│38.9%│38.9│ —    │  │  Top 50 │78.0%│70.2│██████+8│
│  T12★ │1180│46.9%│42.1│████+5│  │  Top100 │74.9%│69.3│█████ +6│
│  T1🔴 │1104│54.2%│43.3│████+11│ │  Top200 │72.0%│67.1│████ +5 │
│  T2   │ —  │ fc  │ —  │ —    │  │  Top500 │65.6%│60.5│████ +5 │
│  T3   │ —  │ fc  │ —  │ —    │  │  All    │54.2%│43.3│████+11 │
│                              │  │                              │
│  Gain bar: Recharts inline   │  │  Gain bar: Recharts inline   │
│  BarChart mini, green fill   │  │  Horizontal BarChart         │
│                              │  │                              │
│  ★ = backtest result         │  │  Color: gradient green       │
│  🔴 = LIVE (real accuracy)   │  │  #10B981 → #34D399           │
│                              │  │                              │
│  Row highlight:              │  │  Hover: tooltip with detail  │
│  T12/T1 = bg-blue-50 border │  │                              │
│  T2/T3 = bg-gray-50 italic  │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
```

### Row 5: FSKU Table (full width — PHẢI CHUYÊN NGHIỆP)

```
┌──────────────────────────────────────────────────────────────┐
│  DANH SÁCH FSKU — FORECAST & ACCURACY                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ 🔍 Search FSKU...    [Month ▼T1] [Seg ▼All] [Win ▼All] │ │
│  │ Sort: [▼ Actual desc]  Showing 1,104 SKUs   [Export ⬇]  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │ FSKU          │Seg│ Actual │ Model  │ MA3    │Acc% │Win ││
│  ├───────────────┼───┼────────┼────────┼────────┼─────┼────┤│
│  │ 40.L1.UGC3600 │ A │ 61,346 │ 46,222 │    —   │75.3%│ 🟢││
│  │ 40.L1.UGC3602 │ A │ 39,602 │ 34,000 │    —   │85.9%│ 🟢││
│  │ 41.L1.M5190   │ A │ 37,763 │ 40,445 │    —   │92.9%│ 🟢││
│  │ 41.L1.UT55200 │ A │ 30,875 │ 30,900 │    —   │99.9%│ 🟢││
│  │ 41.L1.U3305   │ A │ 25,818 │ 25,800 │    —   │99.9%│ 🟢││
│  │ ...           │   │        │        │        │     │    ││
│  ├──────────────────────────────────────────────────────────┤│
│  │ ◀ 1  2  3  4  5 ... 24 ▶   │ 50/page ▼ │ 1,104 total  ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  Table features (BẮT BUỘC):                                  │
│  - Server-side pagination (pageSize: 25/50/100)              │
│  - Sort: click column header → ASC/DESC toggle               │
│  - Search: debounce 300ms, search by FSKU code               │
│  - Filter combos: month + segment + winner                   │
│  - Row colors: green tint = MODEL wins, red tint = MA3 wins  │
│  - Click row → expand: mini sparkline T10→T3                 │
│  - Export filtered data as CSV                               │
│  - Sticky header khi scroll                                  │
│  - Number formatting: thousands separator                    │
│  - Accuracy color: ≥70% green, 40-70% yellow, <40% red      │
│  - Segment badge: A=blue, B=yellow, C=gray                   │
│  - Winner icon: 🟢 MODEL  🔴 MA3  ⚪ TIE                    │
└──────────────────────────────────────────────────────────────┘
```

### Row 6: Worst Performers + FSKU Sparkline

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  ⚠ WORST PERFORMERS          │  │  FSKU SPARKLINE (click row)  │
│  (collapsible, default open)  │  │                              │
│                              │  │  FSKU: 40.L1.3060.UGC3600    │
│  47 SKUs need review         │  │                              │
│  acc < 20% AND actual > 100  │  │  Qty                         │
│                              │  │  60K ┤     ╭─╮              │
│  FSKU    │Act │Acc%│FC T2│T3 │  │      │  ╭──╯ ╰──╮           │
│  XXX-001 │ 800│2.1%│  80│ 90│  │  40K ┤──╯        ╰──╮       │
│  XXX-002 │ 500│5.0%│  60│ 70│  │      │               ╰──     │
│  ...     │    │    │    │   │  │  20K ┤                       │
│                              │  │    0 ┤──T10─T11─T12─T1─T2─T3│
│  "Override T2-T3" button     │  │                              │
│  → opens Override dialog     │  │  ── forecast (blue line)     │
│                              │  │  ●  actual (green dots)      │
│  Badge colors:               │  │  ░░ confidence band (gray)   │
│  acc<10% = bg-red-100        │  │                              │
│  acc 10-20% = bg-orange-100  │  │  Recharts <LineChart> mini   │
└──────────────────────────────┘  └──────────────────────────────┘
```

---

## TAB 2: BRANCH FORECAST

### Row 1: KPI Cards (4)

```
┌──────────────────────────────────────────────────────────────┐
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │Coverage  │  │Total     │  │Tet Impact│  │Overrides │    │
│  │  59%     │  │Demand    │  │ -6.1%    │  │ 0 edits  │    │
│  │ ◐ gauge  │  │ 6.7M     │  │vs overall│  │          │    │
│  │ A/B/C bar│  │ 4 months │  │          │  │          │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
│                                                              │
│  Bỏ "Acc. Proxy" KPI — đã có real accuracy trong Tab 1      │
└──────────────────────────────────────────────────────────────┘
```

### Row 2: Snapshot Table (giữ nguyên)

### Row 3: Branch Insights (2×2 grid — THÊM CHARTS)

```
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  DEMAND BY PERIOD            │  │  DEMAND BY SEGMENT           │
│  (Recharts BarChart)         │  │  (Recharts PieChart donut)   │
│                              │  │                              │
│  Vertical bars per month     │  │    ┌──────────┐             │
│  Color: Tet=orange,          │  │    │  B 55%   │             │
│         non-Tet=blue         │  │    └──────────┘             │
│  Hover: tooltip with qty     │  │  A=25% ● blue              │
│                              │  │  B=55% ● emerald           │
│  Recharts <BarChart>         │  │  C=20% ● amber             │
│  fill gradient per bar       │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘
┌──────────────────────────────┐  ┌──────────────────────────────┐
│  TOP 10 BRANCHES             │  │  DEMAND PATTERN MIX          │
│  (Recharts Horizontal Bar)   │  │  (Recharts Horizontal Bar)   │
│                              │  │                              │
│  Tiền Giang  ██████████ 395K │  │  DORMANT_SEAS ████████ 23%  │
│  Vĩnh Long   ████████  318K │  │  COLD_START   ███████  21%  │
│  An Giang    ███████   285K │  │  LUMPY        ██████   16%  │
│  ...                         │  │  ERRATIC      █████    16%  │
│                              │  │  INTERMITTENT ████     12%  │
│  Color gradient:             │  │  SMOOTH       ████     12%  │
│  #3B82F6 → #93C5FD          │  │                              │
│  Hover: tooltip              │  │  Color palette: 6 distinct  │
└──────────────────────────────┘  └──────────────────────────────┘
```

### Row 4-8: Giữ nguyên (Quality, Alerts, Tet, Filter, Matrix, Branches)

### Row cuối: FSKU Table PER BRANCH (PHẢI CÓ)

```
┌──────────────────────────────────────────────────────────────┐
│  DANH SÁCH FSKU — BRANCH LEVEL                               │
│                                                              │
│  Tương tự SKU table Tab 1 nhưng data từ demand_snapshot_line │
│  Thêm column: Branch Code, Branch Name                       │
│                                                              │
│  🔍 Search...  [Branch ▼All] [Seg ▼All] [Period ▼All]       │
│                                                              │
│  FSKU       │Branch│Seg│ Dec  │ Jan  │ Feb  │ Mar  │ Total  │
│  UGC3600    │ 073  │ A │1,838 │3,388 │3,465 │2,900 │11,591 │
│  UGC3600    │ 015  │ A │  920 │1,200 │1,100 │1,050 │ 4,270 │
│  ...        │      │   │      │      │      │      │       │
│                                                              │
│  Same features: pagination, sort, search, export, sticky     │
└──────────────────────────────────────────────────────────────┘
```

---

## CHART LIBRARY + COLOR PALETTE

### Thêm Recharts

```bash
cd unis/frontend
npm install recharts
```

### Charts cần dùng

| Chart Type | Recharts Component | Dùng ở đâu |
|------------|-------------------|------------|
| Donut | `<PieChart>` + `innerRadius` | Trạng thái SKU (Tab 1 Row 2) |
| Gauge (arc) | SVG custom (không cần recharts) | Chất lượng dữ liệu (Tab 1 Row 2) |
| Area + Line | `<ComposedChart>` + `<Area>` + `<Line>` | Forecast Trend (Tab 1 Row 3) |
| Vertical Bar | `<BarChart>` | Demand by Period (Tab 2) |
| Horizontal Bar | `<BarChart layout="vertical">` | Top Branches, Pattern Mix, Gain bars |
| Pie/Donut | `<PieChart>` | Demand by Segment (Tab 2) |
| Sparkline | `<LineChart>` mini (no axis) | FSKU detail expand (Tab 1 Row 6) |

### Color Palette (UNIS brand + data viz)

```typescript
// lib/chart-colors.ts

export const COLORS = {
  // Primary
  primary:    '#3B82F6',  // blue-500
  secondary:  '#10B981',  // emerald-500
  accent:     '#8B5CF6',  // violet-500
  warning:    '#F59E0B',  // amber-500
  danger:     '#EF4444',  // red-500

  // Segments
  segA:       '#3B82F6',  // blue — high priority
  segB:       '#F59E0B',  // amber — medium
  segC:       '#94A3B8',  // gray — low

  // SKU Status
  active:     '#3B82F6',  // blue
  ended:      '#EF4444',  // red
  newItem:    '#A855F7',  // purple
  other:      '#94A3B8',  // gray

  // Combo Class (6 distinct colors)
  dormantSeasonal: '#8B5CF6',  // violet
  coldStart:       '#EC4899',  // pink
  lumpy:           '#F59E0B',  // amber
  erratic:         '#EF4444',  // red
  intermittent:    '#06B6D4',  // cyan
  smooth:          '#10B981',  // emerald

  // Accuracy
  accGood:    '#10B981',  // ≥70%
  accMedium:  '#F59E0B',  // 40-70%
  accBad:     '#EF4444',  // <40%

  // Chart gradients
  forecastFill:   ['#3B82F6', '#93C5FD'],  // blue gradient
  actualFill:     ['#10B981', '#6EE7B7'],  // green gradient
  confidenceFill: '#E2E8F0',              // gray band

  // Winner
  modelWin:   '#10B981',  // green
  ma3Win:     '#EF4444',  // red
  tie:        '#94A3B8',  // gray
};
```

### Dark mode ready

```typescript
// Tất cả chart components nhận optional prop: theme?: 'light' | 'dark'
// Dark mode: swap background, text colors, reduce opacity
// Card background: light=white, dark=#1E293B (slate-800)
// Text: light=slate-700, dark=slate-200
// Grid lines: light=#E2E8F0, dark=#334155
```

---

## FE COMPONENTS — DANH SÁCH ĐẦY ĐỦ

### Tab 1 Components (BUILD MỚI)

| # | Component | File | Lines | Recharts? |
|---|-----------|------|-------|-----------|
| T1-1 | AccuracyKpiCards | `accuracy-kpi-cards.tsx` | ~80 | No |
| T1-2 | SkuStatusDonut | `sku-status-donut.tsx` | ~100 | Yes — PieChart |
| T1-3 | DataQualityGauges | `data-quality-gauges.tsx` | ~120 | No — SVG custom |
| T1-4 | ForecastTrendChart | `forecast-trend-chart.tsx` | ~150 | Yes — ComposedChart |
| T1-5 | AccuracyByMonth | `accuracy-by-month.tsx` | ~100 | Yes — inline BarChart |
| T1-6 | AccuracyByTier | `accuracy-by-tier.tsx` | ~100 | Yes — horizontal BarChart |
| T1-7 | FskuAccuracyTable | `fsku-accuracy-table.tsx` | ~200 | No (table + pagination) |
| T1-8 | WorstPerformers | `worst-performers.tsx` | ~100 | No |
| T1-9 | FskuSparkline | `fsku-sparkline.tsx` | ~80 | Yes — mini LineChart |

### Tab 2 Components (SỬA — THÊM RECHARTS)

| # | Component | Sửa gì |
|---|-----------|--------|
| T2-1 | InsightsSummary | Thêm Recharts: BarChart (period), PieChart (segment), Horizontal Bar (branches, combo) |
| T2-2 | FskuBranchTable | **MỚI** — FSKU table per branch (giống T1-7 nhưng thêm branch column) |

### Shared Components

| # | Component | File | Dùng bởi |
|---|-----------|------|----------|
| S-1 | ChartCard | `chart-card.tsx` | Wrapper: title + subtitle + chart content |
| S-2 | GainBar | `gain-bar.tsx` | Inline gain indicator (Recharts mini bar) |
| S-3 | AccuracyBadge | `accuracy-badge.tsx` | Color-coded accuracy % |
| S-4 | WinnerIcon | `winner-icon.tsx` | 🟢 MODEL / 🔴 MA3 / ⚪ TIE |
| S-5 | DataTable | `data-table.tsx` | Reusable: pagination + sort + search + export |

---

## BE ENDPOINTS — ĐÃ BUILD (16 total, không cần thêm)

### Tab 1 cần thêm data cho charts mới

```
BE-NEW-1: GET /demand/accuracy/trend
  → Returns: per-month forecast + actual + confidence for sparkline/trend chart
  
  Response:
  {
    "months": [
      {
        "month": "T10",
        "forecast": 280000,     // SUM of all forecast
        "actual": 265000,       // SUM of all actual
        "confLower": 240000,    // SUM confidence_lower — từ demand_snapshot_line
        "confUpper": 320000,    // SUM confidence_upper — từ demand_snapshot_line
        "skus": 1171
      },
      ...
    ]
  }
  
  Implementation: 2 queries (JOIN hoặc separate + merge):
    -- actual/forecast: query demand_accuracy, SUM per month columns
    --   SUM(actual_t10) → T10 actual, SUM(final_fc_t12) → T12 forecast, v.v.
    -- confLower/confUpper: query demand_snapshot_line
    --   SELECT period_start,
    --          SUM(confidence_lower) as confLower,
    --          SUM(confidence_upper) as confUpper
    --   FROM demand_snapshot_line
    --   WHERE snapshot_id = :latestFrozenSnapshotId
    --   GROUP BY period_start
    -- Nếu demand_snapshot_line chưa có data cho T10/T11: confLower/confUpper = null (acceptable)

BE-NEW-2: GET /demand/accuracy/sku-trend?fsku=40.L1.3060.UGC3600
  → Returns: single SKU T10→T3 data for sparkline
  
  Response:
  {
    "fsku": "40.L1.3060.UGC3600",
    "months": [
      { "month": "T10", "actual": 5200, "forecast": null, "wma": 4800 },
      { "month": "T11", "actual": 4900, "forecast": null, "wma": 5000 },
      { "month": "T12", "actual": 61346, "forecast": 46222, "ma3": null },
      { "month": "T1",  "actual": 58000, "forecast": 42600, "ma3": null },
      { "month": "T2",  "actual": null,  "forecast": 39000, "ma3": null },
      { "month": "T3",  "actual": null,  "forecast": 45000, "ma3": null }
    ]
  }

BE-NEW-3: GET /demand/forecast/sku-status
  → Returns: SKU status distribution (ACT/END/NEW/Other)
  
  Response:
  {
    "statuses": [
      { "status": "ACT", "count": 1203, "pct": 59.8 },
      { "status": "END", "count": 773,  "pct": 38.4 },
      { "status": "NEW", "count": 1,    "pct": 0.0 },
      { "status": "Other", "count": 35, "pct": 1.7 }
    ],
    "total": 2012
  }
  
  Implementation: query item table GROUP BY status
```

---

## EXECUTION ORDER

```
PHASE 1 — Setup + Shared (Day 1):
  [ ] npm install recharts
  [ ] Create lib/chart-colors.ts (color palette)
  [ ] Create shared components: S-1 ChartCard, S-2 GainBar, S-3 AccuracyBadge,
      S-4 WinnerIcon, S-5 DataTable (reusable pagination+sort+search+export)
  [ ] BE: 3 new endpoints (trend, sku-trend, sku-status)

PHASE 2 — Tab 1 components (Day 2-3):
  [ ] T1-1: AccuracyKpiCards
  [ ] T1-2: SkuStatusDonut (Recharts PieChart)
  [ ] T1-3: DataQualityGauges (SVG arc)
  [ ] T1-4: ForecastTrendChart (Recharts ComposedChart — STAR feature)
  [ ] T1-5: AccuracyByMonth (table + Recharts gain bars)
  [ ] T1-6: AccuracyByTier (table + Recharts horizontal bars)
  [ ] T1-7: FskuAccuracyTable (DataTable with all features)
  [ ] T1-8: WorstPerformers
  [ ] T1-9: FskuSparkline (mini LineChart on row expand)

PHASE 3 — Tab 2 upgrade (Day 4):
  [ ] T2-1: InsightsSummary → thêm Recharts (BarChart, PieChart, HorizontalBar)
  [ ] T2-2: FskuBranchTable (DataTable with branch column)
  [ ] Bỏ Acc. Proxy KPI

PHASE 4 — Integration + Polish (Day 5):
  [ ] Tab switcher: wire cả 2 tabs
  [ ] Loading skeletons per section
  [ ] Error states with retry
  [ ] Responsive: 2-col → 1-col mobile
  [ ] Dark mode support (optional)
  [ ] Final verify: all ACs pass
```

---

## ACCEPTANCE CRITERIA

### Dashboard Quality

```
[ ] AC-1: Dashboard mang tính TỔNG HỢP — không chỉ accuracy comparison
[ ] AC-2: Trạng thái SKU donut chart hiển thị (ACT/END/NEW/Other)
[ ] AC-3: Chất lượng dữ liệu 4 gauge charts hiển thị
[ ] AC-4: Forecast trend area+line chart interactive (hover tooltip)
[ ] AC-5: Click period trên trend chart → filter SKU table
```

### Charts

```
[ ] AC-6: Recharts installed, tất cả charts render
[ ] AC-7: Donut chart: center text, legend, 4 colors
[ ] AC-8: Trend chart: area gradient, actual line+dots, confidence band
[ ] AC-9: Bar charts: vertical (period), horizontal (branches, pattern, gain)
[ ] AC-10: Sparkline: mini chart khi expand SKU row
[ ] AC-11: Color palette consistent (COLORS object)
[ ] AC-12: Tet months highlighted (amber background)
```

### FSKU Tables

```
[ ] AC-13: Tab 1 SKU table: pagination (25/50/100), sort all columns, search FSKU
[ ] AC-14: Tab 2 FSKU table: same features + branch column
[ ] AC-15: Server-side pagination (không load all data client-side)
[ ] AC-16: Export filtered data as CSV
[ ] AC-17: Sticky header khi scroll
[ ] AC-18: Row color: green=MODEL wins, red=MA3 wins
[ ] AC-19: Click row → expand sparkline
[ ] AC-20: Number formatting: thousands separator
```

### Tab Structure

```
[ ] AC-21: Tab 1 = "Forecast Overview" (tổng + accuracy embedded)
[ ] AC-22: Tab 2 = "Branch Forecast" (chi nhánh + branch insights)
[ ] AC-23: Data KHÔNG trộn giữa 2 tabs
[ ] AC-24: Tab 2 giữ nguyên tất cả features hiện tại
[ ] AC-25: Acc. Proxy KPI bỏ khỏi Tab 2
```

---

---

## 🚀 IMPROVE DASHBOARD — Data Analyst Level (Phase tiếp theo)

> Dashboard hiện tại vẫn là **developer dashboard** — show data có gì thì render.
> Cần nâng lên **Data Analyst dashboard** — tổng hợp, so sánh, insight-driven, giúp ra quyết định.
> Không phải bug — là improvement. Implement sau khi R1-R11 close.

### Nguyên tắc

```
1. Dashboard phải TRẢ LỜI CÂU HỎI, không chỉ show số
2. Mỗi chart/card phải có INSIGHT đi kèm (không chỉ data)
3. So sánh > Tuyệt đối (so sánh giữa segments, branches, periods — không chỉ show 1 con số)
4. Drill-down: tổng quan → chi tiết → từng SKU (3 levels)
5. Color = meaning (không dùng màu random — xanh=tốt, đỏ=cần hành động, vàng=theo dõi)
```

### Tab 1 Improvements: FORECAST OVERVIEW

#### I-1: Forecast Health Score (thay KPI cards đơn giản)

```
Thay 8 KPI cards rời rạc → 1 HEALTH SCORE tổng hợp:

  ┌──────────────────────────────────────────┐
  │  FORECAST HEALTH SCORE: 72/100  🟡       │
  │  ████████████████░░░░░░░░                │
  │                                          │
  │  Breakdown:                              │
  │  Coverage:  93%  ████████████░  (25pts)   │
  │  Accuracy:  54%  ██████████░░░  (20pts)   │
  │  Stability: 68%  ███████████░░  (15pts)   │
  │  Freshness: 100% █████████████  (10pts)   │
  │                                          │
  │  ⚠ Kéo xuống vì: 241 dormant, 47 worst  │
  └──────────────────────────────────────────┘

Formula:
  coverage_score = min(coveragePct / 95 * 25, 25)
  accuracy_score = min(modelAccT1 / 70 * 20, 20)  
  stability_score = (1 - dormantCount/totalItems) * 15
  freshness_score = dataAge < 7d ? 10 : dataAge < 30d ? 5 : 0
  TOTAL = sum (max 100)
```

#### I-2: Demand Concentration — Pareto Chart

```
  ┌──────────────────────────────────────────┐
  │  DEMAND CONCENTRATION (Pareto)           │
  │                                          │
  │  100%│              ●●●●●●●●●●●●●●●●●   │
  │      │         ●●●●●                    │
  │   80%│     ●●●●                         │
  │      │   ●●           ← 20% SKU = 78%  │
  │   60%│  ●●               demand         │
  │      │ ●●                               │
  │   40%│ ●                                │
  │      │●                                 │
  │   20%│●                                 │
  │      │                                  │
  │    0%├───20%───40%───60%───80%───100%   │
  │      Items (ranked by demand)            │
  │                                          │
  │  Top 20 SKUs: 45% tổng demand           │
  │  Top 100 SKUs: 78% tổng demand          │
  │  Bottom 500 SKUs: 3% tổng demand        │
  └──────────────────────────────────────────┘

Recharts: <ComposedChart>
  <Bar> = individual SKU demand (sorted desc)
  <Line> = cumulative % (Pareto curve)
  
Insight auto-gen:
  "Top {N} SKUs ({pct}% of catalog) generate {demandPct}% of total demand.
   Focus accuracy improvement on these {N} items for maximum impact."
```

#### I-3: Model vs MA3 — Scatter Plot with Quadrants

```
  ┌──────────────────────────────────────────┐
  │  MODEL vs MA3 ACCURACY (per SKU)         │
  │                                          │
  │  Model│  II: Model wins      I: Both good│
  │  100% │  (focus here)        (maintain)  │
  │       │     ●  ●●  ●                    │
  │       │   ●  ●●●●●  ●                   │
  │   50% │─ ─ ─●●●●●●●●─ ─ ─ ─ ─ ─ ─ ─ ─│
  │       │  ●   ●●●●● ●                    │
  │       │  III: Both bad    IV: MA3 wins   │
  │     0%│  (review needed)  (model issue)  │
  │       └────────────────────────────────  │
  │        0%        50%       100%   MA3    │
  │                                          │
  │  Diagonal = equal performance            │
  │  Above = Model better, Below = MA3 better│
  │                                          │
  │  Quadrant I:   340 SKUs (maintain)       │
  │  Quadrant II:  520 SKUs (model winning)  │
  │  Quadrant III: 180 SKUs (review needed)  │
  │  Quadrant IV:   64 SKUs (model losing)   │
  └──────────────────────────────────────────┘

Recharts: <ScatterChart>
  X = MA3 accuracy, Y = Model accuracy
  Color by segment (A=blue, B=amber, C=gray)
  Size by actual volume
  Reference line: diagonal (y=x)
  Click dot → show SKU detail
```

#### I-4: Accuracy Heatmap — Segment × Volume Tier

```
  ┌──────────────────────────────────────────┐
  │  ACCURACY HEATMAP                        │
  │                                          │
  │        │ Top20 │ Top100│ Top500│ Tail    │
  │  ──────┼───────┼───────┼───────┼──────── │
  │  Seg A │ 92.1% │ 81.3% │ 68.5% │ 45.2%  │
  │        │ 🟢    │ 🟢    │ 🟡    │ 🔴     │
  │  Seg B │ 78.5% │ 72.1% │ 58.3% │ 38.7%  │
  │        │ 🟢    │ 🟢    │ 🟡    │ 🔴     │
  │  Seg C │ 65.2% │ 55.8% │ 42.1% │ 28.3%  │
  │        │ 🟡    │ 🟡    │ 🔴    │ 🔴     │
  │                                          │
  │  Color: ≥70%=green, 40-70%=yellow, <40%=red
  │                                          │
  │  Insight: "Segment A Top-100 đạt 81% — tập trung
  │  cải thiện Segment C Tail (28%) cho impact lớn nhất"
  └──────────────────────────────────────────┘

Recharts: custom grid with colored cells
Hoặc: simple HTML table with bg-color per cell
```

#### I-5: Forecast Volatility — CV Distribution

```
  ┌──────────────────────────────────────────┐
  │  FORECAST VOLATILITY (Coefficient of Variation)
  │                                          │
  │  CV = std(forecast across months) / mean │
  │                                          │
  │  ▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐                       │
  │  ▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐                    │
  │  ▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐                 │
  │  ▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐             │
  │  0%──────25%──────50%──────75%──────100% │
  │  Stable    Medium    Volatile    Extreme  │
  │                                          │
  │  Stable (CV<25%):     620 SKUs (37%)     │
  │  Medium (25-50%):     480 SKUs (29%)     │
  │  Volatile (50-75%):   350 SKUs (21%)     │
  │  Extreme (CV>75%):    210 SKUs (13%)     │
  │                                          │
  │  ⚠ 210 extreme SKUs → consider safety stock increase
  └──────────────────────────────────────────┘

Recharts: <BarChart> histogram
  bins: 0-25%, 25-50%, 50-75%, 75-100%, >100%
  Color gradient: green → yellow → orange → red
```

### Tab 2 Improvements: BRANCH FORECAST

#### I-6: Branch Comparison — Heatmap (branch × period)

```
  ┌──────────────────────────────────────────┐
  │  BRANCH × PERIOD HEATMAP                 │
  │                                          │
  │  Branch      │ Dec  │ Jan  │ Feb  │ Mar  │
  │  ────────────┼──────┼──────┼──────┼───── │
  │  Tiền Giang  │██████│█████ │████  │██████│
  │  Vĩnh Long   │█████ │████  │███   │█████ │
  │  An Giang    │████  │████  │███   │█████ │
  │  Bình Dương  │███   │███   │██    │████  │
  │  ...         │      │      │      │      │
  │                                          │
  │  Color intensity = demand volume         │
  │  Click cell → filter FSKU table          │
  └──────────────────────────────────────────┘

Recharts: custom heatmap (grid of colored rectangles)
```

#### I-7: Branch Performance Ranking — Forecast vs Capacity

```
  ┌──────────────────────────────────────────┐
  │  TOP / BOTTOM BRANCHES                   │
  │                                          │
  │  🔥 Highest Demand          ⚠ Declining  │
  │  1. Tiền Giang    395K     1. Branch X   │
  │  2. Vĩnh Long     318K       -15% MoM   │
  │  3. An Giang      285K     2. Branch Y   │
  │                               -12% MoM   │
  │  📈 Fastest Growing         🆕 New       │
  │  1. Branch Z +25%          1. Branch W   │
  │  2. Branch A +18%            (< 3 months)│
  └──────────────────────────────────────────┘

4 quadrants: High demand, Growing, Declining, New
Data: compare period-over-period growth rate
```

#### I-8: Segment × Branch Cross-Analysis

```
  ┌──────────────────────────────────────────┐
  │  SEGMENT MIX PER BRANCH                  │
  │                                          │
  │  Tiền Giang:  [A ████ 35%] [B ██████ 54%] [C ██ 11%]
  │  Vĩnh Long:   [A ███ 28%]  [B ████████ 62%] [C █ 10%]
  │  An Giang:    [A ██ 22%]   [B ███████ 58%]  [C ███ 20%]
  │  ...                                     │
  │                                          │
  │  Insight: "Tiền Giang has highest Seg-A  │
  │  concentration (35%) — prioritize A-class │
  │  accuracy at this branch"                │
  └──────────────────────────────────────────┘

Recharts: <BarChart> stacked horizontal
  Per branch: A + B + C stacked bar
  Sorted by total demand
```

### Shared Improvements

#### I-9: Auto-Generated Insights (text summaries)

```
Mỗi chart section có 1-2 dòng insight tự động:

  "Model accuracy T1 (54.2%) vượt MA3 +10.9% — cải thiện tốt nhất ở Top 50 SKUs (+7.8%).
   577 SKUs có forecast = 0 nhưng có lịch sử bán — cần review trước khi chạy DRP."

  "Branch Tiền Giang chiếm 11.8% tổng demand nhưng 35% là Seg-A.
   Nếu accuracy tại branch này dưới 70% → ảnh hưởng lớn đến allocation."

Implementation:
  - BE: thêm field `insights: string[]` trong response mỗi endpoint
  - Logic: simple rule-based (không cần AI):
    if modelAcc > ma3Acc + 5: "Model significantly outperforms MA3"
    if topBranch.pct > 15: "Branch X dominates demand — concentrate accuracy"
    if dormant > 200: "High dormant count — review exclusion criteria"
```

#### I-10: Comparison Mode — Period vs Period

```
Dropdown: [Compare: T12 vs T1 ▼]

Shows delta per SKU:
  FSKU      │ T12 Forecast │ T1 Forecast │ Change │ T12 Acc │ T1 Acc │ Acc Change
  UGC3600   │    46,222    │   42,600    │  -7.8% │  75.3%  │ 73.5%  │  -1.8%
  ...

Highlight: improving SKUs (green), degrading (red), stable (gray)
```

### BE Endpoints cần thêm (cho Improve Dashboard)

```
GET /demand/accuracy/pareto
  → Cumulative demand % by SKU rank
  → Response: [{ rank: 1, fsku, demand, cumulativePct }, ...]

GET /demand/accuracy/scatter
  → Model acc vs MA3 acc per SKU (for scatter plot)
  → Response: [{ fsku, segment, actual, modelAcc, ma3Acc }, ...]

GET /demand/accuracy/heatmap?dimension=segment_x_tier
  → Cross-tabulation accuracy by segment × volume tier
  → Response: { rows: [{ segment, tiers: { top20: 92.1, top100: 81.3, ... } }] }

GET /demand/accuracy/volatility
  → CV distribution histogram
  → Response: { bins: [{ range: '0-25%', count: 620, pct: 37 }, ...] }

GET /demand/forecast/branch-heatmap?snapshot_id=X
  → Branch × period demand matrix
  → Response: { branches: [{ code, name, periods: { dec: 53K, jan: 44K, ... } }] }

GET /demand/accuracy/compare?month1=t12&month2=t1
  → Period comparison per SKU
  → Response: [{ fsku, fc1, fc2, changePct, acc1, acc2, accChange }, ...]
```

### Execution Order (Improve Dashboard)

```
Phase 1 — High Impact (3 days):
  [ ] I-1: Health Score (composite KPI — replace 8 cards with 1 score + breakdown)
  [ ] I-2: Pareto Chart (demand concentration — ComposedChart bar+line)
  [ ] I-9: Auto-generated insights text (rule-based, mỗi section)

Phase 2 — Deep Analysis (3 days):
  [ ] I-3: Scatter Plot model vs MA3 (ScatterChart)
  [ ] I-4: Accuracy Heatmap segment × tier (colored grid)
  [ ] I-5: Volatility histogram (BarChart)

Phase 3 — Branch Deep-dive (2 days):
  [ ] I-6: Branch × Period heatmap
  [ ] I-7: Branch performance ranking (top/bottom/growing/new)
  [ ] I-8: Segment mix per branch (stacked bar)

Phase 4 — Interactive (2 days):
  [ ] I-10: Comparison mode (period vs period)
  [ ] Click-through: chart → filter table → SKU detail

BE: 6 endpoints mới (parallel with FE Phase 1-3)
```

---

---

## 🔬 TAB 3: ANALYST VIEW — Deep Analytics Dashboard

> Tab dành riêng cho **Data Analyst**. Mục tiêu: trả lời câu hỏi sâu về **chất lượng forecast**, **bias hệ thống**, **động lực thời gian**, và **tương quan đa chiều**.  
> Implement SAU khi Tab 1 + Tab 2 hoàn chỉnh và I-1→I-10 pass.

```
Tab 3 layout (6 sections, scroll):
  Section A: Error Distribution   — MAPE histogram, percentiles, tail SKUs
  Section B: Bias Analysis        — over/under forecast by segment/month/branch
  Section C: Temporal Dynamics    — accuracy trend rolling, seasonality decomposition
  Section D: Cross-Dimensional    — multi-axis accuracy matrix, volume scatter
  Section E: Cohort Analysis      — new vs established SKUs, lifecycle stage
  Section F: Model Diagnostics    — CI calibration, confidence vs accuracy
```

---

### Section A: Error Distribution

#### I-11: MAPE Histogram + Percentile Box

```
┌──────────────────────────────────────────────────────────────┐
│  ERROR DISTRIBUTION — T1 (Live Month)          [T10|T11|T1 ▼]│
│                                                              │
│  Count  histogram (bins 0-10%, 10-20% ... >100%)            │
│  300 │     ██                  Percentiles:                  │
│  200 │   ████████              P25:  18.4%                   │
│  100 │ ██████████████          P50:  38.7%  ← median         │
│    0 ┤─0──20──40──60──80─100→ P90:  89.1%                   │
│                                                              │
│  Normal fit: mean=46.3%, σ=31.2%                             │
│  Outliers (MAPE>100%): 47 SKUs (4.3%) → link to worst table │
│  Filter: [Seg A/B/C] [Top100/All]                            │
└──────────────────────────────────────────────────────────────┘
Recharts: <BarChart> histogram + <ReferenceLine> mean/median
Second panel: BoxPlot custom SVG (P10/P25/P50/P75/P90)
```

#### I-12: Error Tail Breakdown (MAPE > 80%)

```
┌──────────────────────────────────────────────────────────────┐
│  ERROR TAIL — 89 SKUs (MAPE > 80%)                           │
│  By Segment:              By Combo Class:                    │
│  Seg C: ██████████ 58%    LUMPY:      ██████████ 52%        │
│  Seg B: ████ 22%          ERRATIC:    ████ 21%              │
│  Seg A: ███ 20%           COLD_START: ████ 18%              │
│                                                              │
│  Pattern: 67% are Seg-C LUMPY, volume < 500 units            │
│  ⚠ "Xem xét chuyển Seg-C LUMPY về MA3 hoặc loại khỏi DRP"  │
└──────────────────────────────────────────────────────────────┘
Recharts: 2× <PieChart> side by side (segment + combo class)
```

---

### Section B: Bias Analysis

#### I-13: Over/Under Forecast — Diverging Bar

```
┌──────────────────────────────────────────────────────────────┐
│  BIAS ANALYSIS  bias = (forecast - actual) / actual          │
│  Positive = over-forecast | Negative = under-forecast        │
│                                                              │
│  By Segment (T1):         By Month:                          │
│  Seg A │ ──●── +4.2%      T10 │●─── -8.3% (Tet missed)     │
│  Seg B │ ────● +12.8%     T11 │──●── +2.1%                  │
│  Seg C │ ────────● +24.1% T12 │───● +5.8%                   │
│                            T1  │──────● +14.5%               │
│  Verdict: system OVER-FORECAST Seg B/C at T1                 │
│  → Nguy cơ tồn kho dư nếu không có override                 │
└──────────────────────────────────────────────────────────────┘
Recharts: <BarChart layout="vertical"> center at 0
  Over = orange (#F97316), Under = blue (#3B82F6)
```

#### I-14: Bias Heatmap — Segment × Branch

```
┌──────────────────────────────────────────────────────────────┐
│  BIAS HEATMAP: Branch × Segment (T1)                         │
│            │ Seg A │ Seg B │ Seg C │  Avg   │               │
│  T.Giang   │  +3%  │ +11%  │ +28%  │ +14%   │               │
│  V.Long    │  -2%  │  +8%  │ +19%  │  +8%   │               │
│  An Giang  │  +5%  │ +15%  │ +33%  │ +18%   │               │
│                                                              │
│  Color: dark-orange = heavy over | white = neutral | blue = under
│  Click cell → drill to FSKU list for that cell               │
└──────────────────────────────────────────────────────────────┘
Implementation: HTML grid table, dynamic bg-color per bias range
  >20%: bg-orange-300 | 10-20%: bg-orange-100 | ±5%: bg-white
  <-5%: bg-blue-100 | <-20%: bg-blue-300
```

---

### Section C: Temporal Dynamics

#### I-15: Accuracy Trend — Rolling Monthly (Model vs MA3)

```
┌──────────────────────────────────────────────────────────────┐
│  ACCURACY TREND — Model vs MA3 (Rolling)                     │
│  %    ── Model   ··· MA3                                     │
│  70% │                           ●──● (Model)               │
│  50% │               ●───●  ···────── (MA3)                 │
│  40% │  ●───●───●───●                                        │
│      ┤──T10────T11────T12────T1────T2(fc)──T3(fc)──          │
│                                                              │
│  Gain trend: T10:+0pp  T11:+0pp  T12:+4.8pp  T1:+10.9pp    │
│  Annotation: delta label at each Model point "+10.9pp"       │
│  T2/T3 extrapolated: dashed + lighter opacity                │
└──────────────────────────────────────────────────────────────┘
Recharts: <ComposedChart>
  <Line> Model acc (solid blue) | <Line> MA3 acc (dashed gray)
  <Area> fill between = green tint when Model > MA3
  Toggle button: [T12 only | T1 only | All months]
```

#### I-16: Seasonality Index — Monthly Factors

```
┌──────────────────────────────────────────────────────────────┐
│  SEASONAL INDEX per Month                                    │
│  Jan(T1): 1.42 🔥  Feb: 0.95  Mar: 0.87  ...  Dec: 1.18    │
│                                                              │
│  Bars above 1.0 = peak (orange) | below 1.0 = trough (blue) │
│  Reference line at 1.0 (neutral)                             │
│                                                              │
│  Insight: "T1 seasonal index 1.42 — forecast cần cao hơn     │
│  trend 42%. Model đang under-compensate T1 Tet effect."     │
└──────────────────────────────────────────────────────────────┘
Recharts: <BarChart> 12 months X axis
  Fill: index>1.0 → orange, <1.0 → blue
  <ReferenceLine y={1.0}> dashed
```

---

### Section D: Cross-Dimensional Breakdown

#### I-17: Accuracy Matrix — Segment × Volume Tier (Bubble)

```
┌──────────────────────────────────────────────────────────────┐
│  ACCURACY MATRIX: Segment × Volume Tier                      │
│          Top20   Top100  Top500   Tail                       │
│  Seg A   ⬤92%   ●81%    ●68%    ○45%  bubble size=SKU count │
│  Seg B   ⬤79%   ●72%    ●58%    ○39%                        │
│  Seg C   ⬤65%   ●56%    ●42%    ○28%                        │
│                                                              │
│  Color: segment color (A=blue, B=amber, C=gray)              │
│  Click bubble → filter FSKU list for that cell               │
└──────────────────────────────────────────────────────────────┘
Recharts: <ScatterChart>
  <XAxis> categorical: Top20/Top100/Top500/Tail
  <Scatter> per segment, r = sqrt(count) * 3
  Tooltip: SKU count, avg accuracy, avg actual volume
```

#### I-18: Accuracy vs Volume — Log Scale Scatter

```
┌──────────────────────────────────────────────────────────────┐
│  ACCURACY vs DEMAND VOLUME (log scale X)                     │
│  Acc%│ ●●●●●●●●●●●●●●●●●●●●  (Seg A — large dots)          │
│  70% │     ●●●●●●●●●●●        (Seg B — medium)              │
│  40% │  ●●●●●●●               (Seg C — small)               │
│      ┤──10──100──1K──10K──100K── Volume (log)                │
│                                                              │
│  Trend line: accuracy increases with volume (R²=0.67)        │
│  Above trend = green | Below trend = red                     │
│  Outliers below trend → flag for manual review               │
└──────────────────────────────────────────────────────────────┘
Recharts: <ScatterChart> scale="log" on X
  <ReferenceLine> trend line (regression logX→Y)
  Color: above trend=green, below=red | Size by segment tier
```

---

### Section E: Cohort Analysis

#### I-19: New vs Established SKU Performance

```
┌──────────────────────────────────────────────────────────────┐
│  COHORT ACCURACY — By SKU Age           [T12 | T1 ▼]        │
│  Cohort              │Count│ T10  │ T11  │ T12  │ T1   │    │
│  New (<6m)           │  45 │  —   │  —   │ 31.2%│ 28.7%│    │
│  Growing (6-12m)     │ 180 │38.1% │41.2% │48.3% │52.1% │    │
│  Mature (1-2y)       │ 620 │35.4% │39.8% │48.7% │55.3% │    │
│  Established (>2y)   │ 815 │32.8% │37.5% │47.1% │56.9% │    │
│                                                              │
│  Model Gain over MA3 by cohort (T1):                         │
│  New: +1.2pp | Growing: +7.8pp | Mature: +10.2pp | Est: +12.1pp
│  → Model improves significantly with more history data       │
└──────────────────────────────────────────────────────────────┘
Recharts: <LineChart> multi-series (1 line per cohort, 4 colors)
  X = month T10→T1 | Y = accuracy %
  Separate horizontal <BarChart> for gain per cohort (green)
```

#### I-20: SKU Lifecycle Stage Distribution

```
┌──────────────────────────────────────────────────────────────┐
│  SKU LIFECYCLE STAGE                                         │
│  LAUNCH      ████  45  (2.7%)  NEW + growing demand         │
│  GROWTH      ██████████ 180 (10.8%)  consistent increase    │
│  MATURITY    ███████████████ 620 (37.3%)  stable plateau    │
│  SATURATION  ████████████████████ 815 (49.0%)  slight ↓    │
│  DECLINE     ████ 112 (6.7%)  END items                     │
│                                                              │
│  Colors: LAUNCH=purple | GROWTH=emerald | MATURITY=blue     │
│          SATURATION=amber | DECLINE=red                      │
│  Tooltip: count, % total, avg accuracy for that stage       │
└──────────────────────────────────────────────────────────────┘
Classification logic (computed client-side from demand_accuracy data):
  LAUNCH:      status=NEW OR qty_growth > 50%/month
  GROWTH:      qty_trend_slope > 5%/month (3+ months)
  MATURITY:    qty stable ±10% across months
  SATURATION:  slight decline <-5% or flat
  DECLINE:     qty_trend < -15%/month OR status=END
Recharts: <BarChart layout="vertical"> horizontal bars, color per stage
```

---

### Section F: Model Diagnostics

#### I-21: Confidence Interval Calibration Check

```
┌──────────────────────────────────────────────────────────────┐
│  CI CALIBRATION — Coverage Rate vs Target                    │
│                                                              │
│  CI Target │ Expected │ Actual Coverage │ Status             │
│  60% CI    │  60%     │  74.2%          │ ⚠ Over-conservative│
│  80% CI    │  80%     │  81.8%          │ ✅ Well-calibrated  │
│  90% CI    │  90%     │  93.1%          │ ✅                  │
│  95% CI    │  95%     │  97.2%          │ ✅                  │
│                                                              │
│  By Segment (80% CI):                                        │
│  Seg A: 87.3% (slightly conservative)                        │
│  Seg B: 78.5% ✅                                             │
│  Seg C: 65.1% ⚠ CI too narrow — increase width ~20%        │
│  → Ảnh hưởng safety stock tính từ CI bounds                 │
└──────────────────────────────────────────────────────────────┘
Recharts: <BarChart> grouped (target vs actual per CI level)
  Reference diagonal line (perfect calibration)
  Deviation bars highlighted orange when gap > 5pp
```

#### I-22: Confidence Width vs Accuracy Correlation

```
┌──────────────────────────────────────────────────────────────┐
│  CONFIDENCE vs ACCURACY (Should correlate positively)        │
│  Acc%│ ● ●●●●●●● ●   (narrow CI → expect high accuracy)     │
│  70% │   ●●●●●●●●●●                                         │
│  40% │     ●●●●●●                                           │
│      ┤── CI width: narrow ────────────────── wide ──         │
│                                                              │
│  Actual correlation r = 0.42 (expected ≥ 0.60)              │
│  Seg C: narrow CI but low accuracy → MODEL OVERCONFIDENT    │
│  Action: widen Seg-C CI or re-train uncertainty estimation   │
└──────────────────────────────────────────────────────────────┘
Recharts: <ScatterChart>
  X = (confUpper-confLower)/forecast (normalized CI width)
  Y = accuracy % | Color by segment
  <ReferenceLine> trend line | r² shown in header
```

---

### BE Endpoints cần thêm (Tab 3 Analyst View)

```
GET /demand/accuracy/error-distribution?month=t1&segment=all
  → MAPE histogram + percentiles + tail SKUs
  → Response: {
      bins: [{ range: '0-10%', count: 45, pct: 4.1 }, ...],
      percentiles: { p10, p25, p50, p75, p90, p95 },
      tailSKUs: [{ fsku, mape, segment, comboClass, actual }],
      mean: 46.3, stdDev: 31.2
    }

GET /demand/accuracy/bias?groupBy=segment|month|branch&month=t1
  → Bias (forecast-actual)/actual aggregated by dimension
  → Response: {
      items: [{ dimension, label, bias, count, avgActual }]
    }

GET /demand/accuracy/bias-heatmap?month=t1
  → bias cross-tabulated branch × segment
  → Response: {
      rows: [{ branchCode, branchName, segA, segB, segC, avg }]
    }

GET /demand/accuracy/cohort?month=t1
  → accuracy by SKU age cohort
  → Response: {
      cohorts: [{ label, count, months: { t10, t11, t12, t1 }, gainVsMA3 }]
    }

GET /demand/accuracy/ci-calibration
  → CI coverage rate per CI level + by segment
  → Response: {
      levels: [{ target: 80, actualCoverage: 81.8 }],
      bySegment: [{ segment, coverage80 }]
    }

GET /demand/accuracy/seasonality
  → Monthly seasonal index (12 months rolling history)
  → Response: {
      indices: [{ month: 'Jan', index: 1.42, label: 'T1' }, ...]
    }
```

---

### FE Components (Tab 3)

| # | Component | File | Recharts? |
|---|-----------|------|-----------|
| A1 | MapeHistogram | `analyst/mape-histogram.tsx` | Yes — BarChart |
| A2 | ErrorTailPie | `analyst/error-tail-pie.tsx` | Yes — 2× PieChart |
| B1 | BiasDivergingBar | `analyst/bias-diverging-bar.tsx` | Yes — horizontal BarChart |
| B2 | BiasHeatmap | `analyst/bias-heatmap.tsx` | No — HTML grid + CSS |
| C1 | AccuracyTrendChart | `analyst/accuracy-trend-chart.tsx` | Yes — ComposedChart |
| C2 | SeasonalityChart | `analyst/seasonality-chart.tsx` | Yes — BarChart |
| D1 | AccuracyMatrixBubble | `analyst/accuracy-matrix-bubble.tsx` | Yes — ScatterChart |
| D2 | AccuracyVolumeScatter | `analyst/accuracy-volume-scatter.tsx` | Yes — ScatterChart |
| E1 | CohortAccuracyChart | `analyst/cohort-accuracy-chart.tsx` | Yes — LineChart |
| E2 | LifecycleStageBar | `analyst/lifecycle-stage-bar.tsx` | Yes — BarChart |
| F1 | CiCalibrationChart | `analyst/ci-calibration-chart.tsx` | Yes — BarChart grouped |
| F2 | ConfidenceScatter | `analyst/confidence-scatter.tsx` | Yes — ScatterChart |

All components placed under `components/demand/analyst/` subfolder.

---

### Execution Order (Tab 3 Analyst View)

```
Phase A — Error & Bias (3 days):
  [ ] BE: error-distribution + bias + bias-heatmap endpoints
  [ ] A1: MapeHistogram (I-11)
  [ ] A2: ErrorTailPie (I-12)
  [ ] B1: BiasDivergingBar (I-13)
  [ ] B2: BiasHeatmap (I-14)

Phase B — Temporal & Cross-Dim (3 days):
  [ ] BE: seasonality + cohort endpoints
  [ ] C1: AccuracyTrendChart (I-15)
  [ ] C2: SeasonalityChart (I-16)
  [ ] D1: AccuracyMatrixBubble (I-17)
  [ ] D2: AccuracyVolumeScatter (I-18)

Phase C — Cohort & Diagnostics (2 days):
  [ ] BE: ci-calibration endpoint
  [ ] E1: CohortAccuracyChart (I-19)
  [ ] E2: LifecycleStageBar (I-20)
  [ ] F1: CiCalibrationChart (I-21)
  [ ] F2: ConfidenceScatter (I-22)

Phase D — Integration (1 day):
  [ ] Wire Tab 3 into page.tsx (lazy load, skeleton)
  [ ] Click-through: chart cell → filter FSKU drill list
  [ ] Export analyst report (CSV / PDF summary)

Total: ~9 days | 12 components | 6 BE endpoints
```

---

*MODULE-1-FULL-IMPLEMENT.md | Tech Lead | v2.3 | 2026-04-13*
*v2.0: Dashboard upgrade — Recharts, charts, tables, color palette*
*v2.1: Post-review bug fixes R1-R5*
*v2.2: Improve Dashboard — Data Analyst level (I-1 → I-10, 6 BE endpoints)*
*v2.3: Tab 3 Analyst View — Error dist, Bias, Temporal, Cross-dim, Cohort, Model diag (I-11 → I-22, 6 BE endpoints, 12 FE components)*
