# DEMAND INSIGHTS — Feature Spec for Dev

**Date:** 2026-04-13  
**Author:** Tech Lead  
**Priority:** HIGH — Planner không ra quyết định được nếu chỉ thấy bảng số thô  
**Pre-req:** Module 1 core DONE (upload, freeze, matrix, override working) + **G2 fix (dormant filter)** trước khi dormant count chính xác  
**Ref:** `01-demand-ingestion.md`, data columns trong `demand_snapshot_line` + `demand_forecast_detail`

---

## Vấn đề

Trang Demand hiện tại là **data upload tool** — upload CSV, xem bảng số, freeze.  
Planner thiếu hoàn toàn **forecast insight** để ra quyết định:

- Tổng demand Q1-2026 là bao nhiêu?
- Branch nào demand cao nhất? Branch nào = 0?
- Forecast tháng nào cao nhất? Trend tăng hay giảm?
- Segment A chiếm bao nhiêu % tổng demand?
- Forecast có đáng tin không? Confidence bao nhiêu?
- Item nào forecast = 0 nhưng 3 tháng trước bán 500 units?
- Tet tháng demand tăng bao nhiêu %?

**Data ĐÃ CÓ trong DB** — chỉ thiếu API aggregate + FE components.

---

## Target UI Layout

```
Trang /demand sau khi thêm insights:

┌─────────────────────────────────────────────────────────────┐
│ 01  Demand Ingestion                    [Export] [Upload]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  KPI CARDS (row 1 — mở rộng từ 4 → 6)                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │Coverage │ │Total    │ │Acc.Proxy│ │Tet Items│         │
│  │ 85.5%   │ │Demand   │ │ 18.2%   │ │ 423     │         │
│  │ ◐ gauge │ │1.2M units│ │ ⚠ >15% │ │ 3 months│         │
│  ├─────────┤ ├─────────┤ ├─────────┤ ├─────────┤         │
│  │Snapshots│ │FSKUs    │ │Confidence│ │Overrides│         │
│  │ 1 frozen│ │ 1,571   │ │ ±12.3%  │ │ 0 edits │         │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│                                                             │
│  Snapshot Table                                   [as-is]  │
│                                                             │
│  ── SECTION A: FORECAST SUMMARY ──────────────────────────  │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │ Demand by Period     │  │ Demand by Segment    │        │
│  │ ▐ Dec: 280K         │  │    ┌───┐             │        │
│  │ ▐▐ Jan: 350K  ← Tet │  │ A: │███│ 62%         │        │
│  │ ▐▐ Feb: 340K  ← Tet │  │ B: │██ │ 28%         │        │
│  │ ▐ Mar: 250K         │  │ C: │█  │ 10%         │        │
│  └──────────────────────┘  └──────────────────────┘        │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │ Top 10 Branches      │  │ Demand Pattern Mix   │        │
│  │ 1. CN-HCM   45,200  │  │ SMOOTH        18%    │        │
│  │ 2. CN-HN    38,100  │  │ DORMANT_SEAS  42%    │        │
│  │ 3. CN-DN    22,800  │  │ ERRATIC       14%    │        │
│  │ ...                  │  │ COLD_START    13%    │        │
│  └──────────────────────┘  │ LUMPY          8%    │        │
│                            │ Other          5%    │        │
│                            └──────────────────────┘        │
│                                                             │
│  ── SECTION B: FORECAST QUALITY ──────────────────────────  │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │ Confidence Spread    │  │ Accuracy Alerts      │        │
│  │                      │  │                      │        │
│  │ Avg range: ±12.3%   │  │ ⚠ 23 items MAPE>30% │        │
│  │ Tight (<5%):   320  │  │ ⚠ 241 items dormant  │        │
│  │ Medium (5-20%): 890  │  │ ⚠ 18 items no hist  │        │
│  │ Wide (>20%):    361  │  │ ✓ 1,289 items OK    │        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                             │
│  ── SECTION C: ALERTS & EXCEPTIONS ───────────────────────  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Zero Forecast Alert                                   │  │
│  │ FSKU        │ Segment │ 12m Avg │ 3m Avg │ Status    │  │
│  │ GACH-OP-30  │ C       │ 450     │ 380    │ 🔴 MISS  │  │
│  │ BOT-XM-10   │ B       │ 1,200   │ 900    │ 🔴 MISS  │  │
│  │ ... (items forecast=0 but has sales history)          │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Tet Impact                                            │  │
│  │ Tet months (Jan-Mar): avg 340K/month                  │  │
│  │ Non-Tet months (Dec): avg 280K/month                  │  │
│  │ Tet uplift: +21.4%                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                             │
│  Filter Bar                                       [as-is]  │
│  Forecast Matrix (pivot)                          [as-is]  │
│                                                             │
│  ── SECTION D: BRANCH BREAKDOWN ──────────────────────────  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Branch        │ Region │ Type  │ Items│ Total Qty    │  │
│  │ CN-HCM-001    │ South  │ URBAN │  820 │ 45,200      │  │
│  │ CN-HN-002     │ North  │ URBAN │  780 │ 38,100      │  │
│  │ CN-DN-003     │ Central│ URBAN │  650 │ 22,800      │  │
│  │ CN-BDG-010    │ South  │ RURAL │  120 │  3,400      │  │
│  │ ...           │        │       │      │              │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## BE: 4 New Endpoints

### BE-I1: Forecast Summary Stats

```
GET /api/v1/demand/forecast/insights?snapshot_id=X

Mục đích: Aggregate stats cho toàn bộ snapshot — 1 call, FE render tất cả cards + charts

Response:
{
  // Period breakdown (for bar chart)
  "byPeriod": [
    { "period": "2025-12", "totalQty": 280000, "itemCount": 1200, "tetFlag": false },
    { "period": "2026-01", "totalQty": 350000, "itemCount": 1350, "tetFlag": true },
    { "period": "2026-02", "totalQty": 340000, "itemCount": 1340, "tetFlag": true },
    { "period": "2026-03", "totalQty": 250000, "itemCount": 1280, "tetFlag": false }
  ],

  // Segment breakdown (for pie chart)
  "bySegment": [
    { "segment": "A", "totalQty": 756000, "itemCount": 168, "pct": 62.0 },
    { "segment": "B", "totalQty": 341000, "itemCount": 1097, "pct": 28.0 },
    { "segment": "C", "totalQty": 123000, "itemCount": 306, "pct": 10.0 }
  ],

  // Combo class distribution (for horizontal bar)
  "byComboClass": [
    { "comboClass": "DORMANT_SEASONAL", "itemCount": 660, "pct": 42.0 },
    { "comboClass": "SMOOTH", "itemCount": 283, "pct": 18.0 },
    { "comboClass": "ERRATIC", "itemCount": 220, "pct": 14.0 },
    { "comboClass": "COLD_START", "itemCount": 204, "pct": 13.0 },
    { "comboClass": "LUMPY", "itemCount": 126, "pct": 8.0 },
    { "comboClass": "OTHER", "itemCount": 78, "pct": 5.0 }
  ],

  // Tet impact
  "tetImpact": {
    "tetAvgQty": 340000,
    "nonTetAvgQty": 280000,
    "upliftPct": 21.4,
    "tetItemCount": 423
  },

  // Totals
  "totalDemand": 1220000,
  "totalItems": 1571,
  "totalPeriods": 4,
  "overrideCount": 0
}

Implementation:
  -- Dùng CTE để tránh multiple round-trips (performance: 84K rows, 4+ GROUP BY)
  WITH base AS (
    SELECT * FROM demand_snapshot_line WHERE snapshot_id = :sid
  ),
  detail AS (
    SELECT * FROM demand_forecast_detail WHERE snapshot_id = :sid
  )
  SELECT ... (sub-queries from CTEs)
  
  GROUP BY period_start       → byPeriod
  GROUP BY segment            → bySegment
  GROUP BY combo_class        → byComboClass (từ detail)
  WHERE tet_flag = 'Y'/'N'   → tetImpact
  COUNT demand_override_log   → overrideCount
  
  Note: Khi snapshot FROZEN → có thể cache kết quả (data immutable)
```

### BE-I2: Forecast Quality Stats

```
GET /api/v1/demand/forecast/quality?snapshot_id=X

Mục đích: Đánh giá chất lượng forecast — confidence, accuracy indicators

Response:
{
  // Confidence spread analysis
  "confidence": {
    "avgSpreadPct": 12.3,
    "tight": { "count": 320, "label": "<5% spread" },
    "medium": { "count": 890, "label": "5-20% spread" },
    "wide": { "count": 361, "label": ">20% spread" }
  },

  // Accuracy alerts (items with potential issues)
  "alerts": {
    "highAccProxy": { "count": 23, "label": "Items where |forecast - 12m_avg| / 12m_avg > 30%" },
    "dormant": { "count": 241, "label": "Items with zero forecast (all periods)" },
    "noHistory": { "count": 18, "label": "Items with no sales history (cold start)" },
    "ok": { "count": 1289, "label": "Items with acceptable forecast quality" }
  },  // ⚠ Sau khi ACCURACY-DASHBOARD-SPEC done → thay bằng real accuracy từ demand_accuracy table

  // Forecast Accuracy Proxy (NOT true MAPE — true MAPE cần actual sales từ Module 8)
  // Proxy: |forecast_qty - qty_sold_12m_avg| / qty_sold_12m_avg
  "accuracyProxy": {
    "avgPct": 18.2,
    "medianPct": 14.5,
    "bySegment": {
      "A": 12.1,
      "B": 19.8,
      "C": 28.5
    }
  }
}

Implementation:
  Query demand_forecast_detail WHERE snapshot_id = :sid:
  - confidence_lower, confidence_upper → compute spread = (upper-lower)/forecast_qty
  - qty_sold_12m_avg = 0 AND forecast_qty > 0 → noHistory
  - All forecast_qty = 0 across periods GROUP BY item → dormant
    (⚠ Prerequisite: G2 fix phải DONE trước — nếu chưa fix, dormant count sẽ bao gồm
       cả rows lẽ ra bị filter từ bước upload, dẫn đến dormant count sai)
  - |forecast_qty - qty_sold_12m_avg| / qty_sold_12m_avg → accuracy proxy
  
  Label trong UI: "Forecast Accuracy Proxy" kèm tooltip:
    "Tính toán dựa trên chênh lệch forecast vs. avg 12 tháng. MAPE thực sự cần dữ liệu actual sales (Module 8)."  
```

### BE-I3: Zero Forecast Alerts (items at risk)

```
GET /api/v1/demand/forecast/alerts?snapshot_id=X&page=1&pageSize=20

Mục đích: List items có forecast = 0 nhưng có lịch sử bán hàng (potential misses)

Response:
{
  "data": [
    {
      "itemCode": "GACH-OP-30",
      "segment": "C",
      "comboClass": "DORMANT_SEASONAL",
      "qtySold12mAvg": 450.00,
      "qtySold3mAvg": 380.00,
      "forecastQty": 0,
      "periodsWithZero": 4,
      "severity": "HIGH"
    },
    {
      "itemCode": "BOT-XM-10",
      "segment": "B",
      "comboClass": "ERRATIC",
      "qtySold12mAvg": 1200.00,
      "qtySold3mAvg": 900.00,
      "forecastQty": 0,
      "periodsWithZero": 4,
      "severity": "CRITICAL"
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 47 },
  "summary": {
    "totalAlerts": 47,
    "critical": 12,
    "high": 18,
    "medium": 17
  }
}

Implementation:
  Query demand_forecast_detail WHERE snapshot_id = :sid
    AND forecast_qty = 0
    AND qty_sold_12m_avg > 0
  
  Severity logic:
    CRITICAL: segment = 'A' AND qty_sold_12m_avg > 1000
    HIGH:     segment IN ('A','B') AND qty_sold_12m_avg > 500
    MEDIUM:   everything else
  
  ORDER BY severity ASC, qty_sold_12m_avg DESC
```

### BE-I4: Branch Breakdown

```
GET /api/v1/demand/forecast/branches?snapshot_id=X&page=1&pageSize=50

Mục đích: Demand per branch — planner thấy branch nào cần ưu tiên

Response:
{
  "data": [
    {
      "locationCode": "CN-HCM-001",
      "locationName": "Chi nhánh HCM",
      "region": "South",
      "branchArchetype": "URBAN",
      "itemCount": 820,
      "totalQty": 45200,
      "topSegment": "A",
      "tetQty": 28000,
      "nonTetQty": 17200
    }
  ],
  "meta": { "page": 1, "pageSize": 50, "total": 68 },
  "byArchetype": [
    { "archetype": "URBAN", "branchCount": 22, "totalQty": 680000 },
    { "archetype": "RURAL", "branchCount": 38, "totalQty": 420000 },
    { "archetype": "SEMI_URBAN", "branchCount": 8, "totalQty": 120000 }
  ]
}

Implementation:
  Query demand_snapshot_line WHERE snapshot_id = :sid
    GROUP BY location_code
    
  JOIN location table for name, region
  
  JOIN demand_forecast_detail for branch_archetype (or snapshot_line if stored)
  
  Sub-query: SUM(qty) WHERE tet_flag='Y' → tetQty
  
  byArchetype: GROUP BY branch_archetype, COUNT(DISTINCT location_code), SUM(qty)
```

---

## FE: 8 New Components

### FE-I1: `components/demand/insights-summary.tsx`

```
Props: { insights: InsightsSummaryData }

Renders Section A — 4 cards in 2×2 grid:
  1. Demand by Period (bar chart — vertical bars, Tet months highlighted)
  2. Demand by Segment (horizontal bar — A/B/C with % label)
  3. Top 10 Branches (ranked list — location name + qty)
  4. Demand Pattern Mix (horizontal bar — combo_class distribution)

Chart library: ⚠ SUPERSEDED — xem MODULE-1-FULL-IMPLEMENT.md v2 (mới nhất).
  Quyết định mới: dùng RECHARTS (~200KB gzipped) cho dashboard quality.
  CSS Tailwind bars chỉ dùng cho simple progress indicators (gain bars nhỏ trong table).

Size: < 200 lines
```

### FE-I2: `components/demand/quality-card.tsx`

```
Props: { quality: QualityData }

Renders Section B — 2 cards side by side:
  1. Confidence Spread:
     - Avg spread %
     - 3 horizontal bars: tight / medium / wide (count + %)
  2. Accuracy Alerts:
     - 4 rows: highAccProxy (⚠), dormant (⚠), noHistory (⚠), ok (✓)
     - Count + label per row
     - Color: red for critical, yellow for warning, green for ok
     - Dormant count: ⚠ chỉ chính xác sau khi G2 (dormant filter) được fix

Size: < 150 lines
```

### FE-I3: `components/demand/zero-forecast-table.tsx`

```
Props: { alerts: ZeroForecastAlert[], summary: AlertSummary }

Renders Section C (top half) — table:
  Columns: FSKU, Segment, 12m Avg, 3m Avg, Periods Zero, Severity
  ("Last Active" bị xóa — lastNonzeroMonth không có trong Module 1 data)
  Severity badge: CRITICAL=red, HIGH=orange, MEDIUM=yellow
  
  Header: "⚠ {total} items with zero forecast but sales history"
  
  Sortable by severity, qty_sold_12m_avg

Size: < 120 lines
```

### FE-I4: `components/demand/tet-impact-card.tsx`

```
Props: { tetImpact: TetImpactData }

Renders Section C (bottom half) — compact card:
  - Tet avg: X/month
  - Non-Tet avg: Y/month  
  - Uplift: +Z%
  - Bar comparison (2 horizontal bars: Tet vs Non-Tet)
  - Item count affected

Size: < 80 lines
```

### FE-I5: `components/demand/branch-table.tsx`

```
Props: { branches: BranchBreakdown[], byArchetype: ArchetypeSummary[] }

Renders Section D:
  Top: 3 summary cards for URBAN / RURAL / SEMI_URBAN (count + total qty)
  
  Table columns: Branch, Region, Type, Items, Total Qty, Tet Qty
  Sortable by total qty (default desc)
  Click row → filter matrix by that branch (optional enhancement)

Size: < 150 lines
```

### FE-I6: `components/demand/kpi-demand-total.tsx`

```
Props: { totalDemand: number, totalPeriods: number, trend: 'up'|'down'|'flat' }

Replaces current "Total Lines" KPI card with more useful:
  - Total Demand: 1.2M units (formatted)
  - Subtitle: "across {periods} months"
  - Trend arrow icon

Size: < 40 lines
```

### FE-I7: `components/demand/kpi-accuracy-proxy.tsx`

```
⚠ DEPRECATED sau khi ACCURACY-DASHBOARD-SPEC.md implement xong.
  → Replace bằng FE-A1 (accuracy-kpi-cards.tsx) hiển thị "54.2% T1 LIVE" từ /accuracy/summary
  → Component này chỉ là placeholder trong thời gian chờ ACCURACY-DASHBOARD

Props: { avgPct: number, bySegment: Record<string, number> }

KPI card tạm thời:
  - Label: "Forecast Accuracy Proxy" (không dùng "MAPE" — dễ gây nhầm)
  - Value: 18.2%
  - Tooltip: "Chênh lệch forecast vs avg 12 tháng. Sẽ được thay bằng real accuracy (ACCURACY-DASHBOARD)."
  - Color: green <15%, yellow 15-25%, red >25%
  - Subtitle: "A: 12% B: 20% C: 29%"

Size: < 40 lines
```

### FE-I8: `components/demand/kpi-tet.tsx`

```
Props: { tetItemCount: number, upliftPct: number }

New KPI card:
  - Tet Items: 423
  - Subtitle: "+21.4% vs non-Tet"
  - Icon: lunar new year or calendar

Size: < 40 lines
```

---

## FE: Updated Page Layout

### `app/demand/page.tsx` — thêm sections

```typescript
// New data fetching
const [insights, setInsights] = useState<InsightsSummaryData | null>(null);
const [quality, setQuality] = useState<QualityData | null>(null);
const [alerts, setAlerts] = useState<ZeroForecastAlert[]>([]);
const [branches, setBranches] = useState<BranchBreakdown[]>([]);

// In loadData():
const [insightsRes, qualityRes, alertsRes, branchesRes] = await Promise.all([
  fetchForecastInsights(snapshotId),
  fetchForecastQuality(snapshotId),
  fetchForecastAlerts(snapshotId),
  fetchBranchBreakdown(snapshotId),
]);

// Render order:
return (
  <div>
    {/* Header + Upload */}
    {/* KPI Cards (6) — row 1: Coverage, TotalDemand, AvgMAPE, TetItems */}
    {/*                  row 2: Snapshots, FSKUs, Confidence, Overrides  */}
    {/* Snapshot Table */}
    
    {/* NEW: Section A — Forecast Summary */}
    <InsightsSummary insights={insights} />
    
    {/* NEW: Section B — Forecast Quality */}
    <QualityCard quality={quality} />
    
    {/* NEW: Section C — Alerts */}
    <ZeroForecastTable alerts={alerts} summary={alertsSummary} />
    <TetImpactCard tetImpact={insights?.tetImpact} />
    
    {/* Filter Bar + Forecast Matrix (existing) */}
    <FilterBar />
    <ForecastMatrix />
    
    {/* NEW: Section D — Branch Breakdown */}
    <BranchTable branches={branches} byArchetype={insights?.byArchetype} />
    
    {/* Dialogs (existing) */}
    <UploadDialog />
    <OverrideDialog />
  </div>
);
```

---

## API Client Updates

### `lib/api/demand.ts` — thêm 4 functions + types

```typescript
// Types
export interface InsightsSummaryData {
  byPeriod: { period: string; totalQty: number; itemCount: number; tetFlag: boolean }[];
  bySegment: { segment: string; totalQty: number; itemCount: number; pct: number }[];
  byComboClass: { comboClass: string; itemCount: number; pct: number }[];
  tetImpact: { tetAvgQty: number; nonTetAvgQty: number; upliftPct: number; tetItemCount: number };
  totalDemand: number;
  totalItems: number;
  totalPeriods: number;
  overrideCount: number;
}

export interface QualityData {
  confidence: {
    avgSpreadPct: number;
    tight: { count: number };
    medium: { count: number };
    wide: { count: number };
  };
  alerts: {
    highAccProxy: { count: number };  // items where proxy deviation > 30%
    dormant: { count: number };
    noHistory: { count: number };
    ok: { count: number };
  };
  // Forecast Accuracy Proxy — NOT true MAPE (cần Module 8 cho actual sales)
  accuracyProxy: {
    avgPct: number;
    medianPct: number;
    bySegment: Record<string, number>;
  };
}

export interface ZeroForecastAlert {
  itemCode: string;
  segment: string;
  comboClass: string;
  qtySold12mAvg: number;
  qtySold3mAvg: number;           // available in demand_forecast_detail
  forecastQty: number;
  periodsWithZero: number;        // count of periods where forecast=0 (replaces lastNonzeroMonth — not derivable from Module 1)
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
}

export interface BranchBreakdown {
  locationCode: string;
  locationName: string;
  region: string;
  branchArchetype: string;
  itemCount: number;
  totalQty: number;
  topSegment: string;
  tetQty: number;
  nonTetQty: number;
}

// Functions
export async function fetchForecastInsights(snapshotId?: string): Promise<InsightsSummaryData> {
  const params = snapshotId ? `?snapshot_id=${snapshotId}` : '';
  const res = await fetch(`${API_BASE}/demand/forecast/insights${params}`);
  return res.json();
}

export async function fetchForecastQuality(snapshotId?: string): Promise<QualityData> { ... }

export async function fetchForecastAlerts(snapshotId?: string, page = 1): Promise<{ data: ZeroForecastAlert[]; summary: any; meta: any }> { ... }

export async function fetchBranchBreakdown(snapshotId?: string, page = 1): Promise<{ data: BranchBreakdown[]; byArchetype: any[]; meta: any }> { ... }
```

---

## Execution Order

```
Phase 1 — BE builds 4 endpoints (2-3 days):
  [ ] BE-I1: GET /demand/forecast/insights (heaviest — multiple aggregations)
  [ ] BE-I2: GET /demand/forecast/quality
  [ ] BE-I3: GET /demand/forecast/alerts
  [ ] BE-I4: GET /demand/forecast/branches

Phase 2 — FE builds 8 components (2-3 days, after BE):
  [ ] FE-I1: insights-summary.tsx (charts — largest component)
  [ ] FE-I2: quality-card.tsx
  [ ] FE-I3: zero-forecast-table.tsx
  [ ] FE-I4: tet-impact-card.tsx
  [ ] FE-I5: branch-table.tsx
  [ ] FE-I6: kpi-demand-total.tsx
  [ ] FE-I7: kpi-mape.tsx
  [ ] FE-I8: kpi-tet.tsx

Phase 3 — Wire + Polish (1 day):
  [ ] Update page.tsx: fetch 4 APIs, render 4 sections
  [ ] Update lib/api/demand.ts: 4 functions + types
  [ ] Loading states cho mỗi section
  [ ] Error states nếu API fail
  [ ] Verify số liệu với CSV gốc
```

---

## Acceptance Criteria

```
[ ] AC-I1: Demand by Period chart shows 4 bars (Dec, Jan, Feb, Mar), Tet months highlighted
[ ] AC-I2: Demand by Segment pie/bar shows A/B/C with % và total qty
[ ] AC-I3: Top 10 branches ranked by demand descending
[ ] AC-I4: Combo class distribution shows 6 categories with %
[ ] AC-I5: Tet uplift % calculated correctly (Tet avg / Non-Tet avg - 1)
[ ] AC-I6: Confidence spread: avg %, tight/medium/wide counts
[ ] AC-I7: Zero forecast table lists items with forecast=0 AND qty_sold_12m_avg > 0
[ ] AC-I8: Severity badge: CRITICAL (A + avg>1000), HIGH (A/B + avg>500), MEDIUM (rest)
[ ] AC-I9: Branch table shows all 68 branches with demand, region, archetype
[ ] AC-I10: Accuracy Proxy card shows avg % với color coding (green<15, yellow<25, red>25) + tooltip giải thích đây không phải true MAPE
[ ] AC-I11: Total Demand KPI shows sum across all periods (formatted: 1.2M)
[ ] AC-I12: All 4 API calls complete < 2 seconds total
```

---

*DEMAND-INSIGHTS-SPEC.md | Tech Lead | 2026-04-13*
*v1.1 2026-04-13: Xóa lastNonzeroMonth (không derivable từ M1 data) → thay periodsWithZero; Đổi MAPE → Forecast Accuracy Proxy; Thêm prerequisite G2 fix; Thay recharts → CSS Tailwind bars; Thêm CTE performance note cho BE-I1*
*Đọc cùng: MODULE-1-REVIEW.md, 01-demand-ingestion.md*
