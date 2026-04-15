# MODULE 1: DEMAND INGESTION — Tech Lead Review & Dev Tasks

**Date:** 2026-04-13 (UPDATED — Round 4 Dashboard Review)  
**Reviewer:** Tech Lead  
**Status:** Round 1-3 bugs ALL FIXED. Round 4: **5 bugs mới từ Dashboard v2 review**  
**Ref:** `01-demand-ingestion.md`, `MODULE-1-FULL-IMPLEMENT.md`, `ACCURACY-DASHBOARD-SPEC.md`

---

## 1. Current State

### What's DONE

| Layer | Delivered | Verified |
|-------|-----------|----------|
| DB | 001 + 002 migrations, 10 tables | FK + indexes OK |
| Data | step1_demand.py, 70,620 rows loaded | Counts verified |
| API | 8 endpoints, 18 TS files, 0 compile errors | 5 runtime bugs fixed |
| FE | 8 files, 6 components | Renders real data |

### What's showing on UI now (AFTER all G1-G12 fixes — Round 3)

```
Coverage: % từ item table, drill-down click segment → filter pivot (G9 fixed)
Snapshots: list, freeze, Delete (DRAFT), Archive (FROZEN→ARCHIVED) hoạt động
Forecast Matrix: PIVOT TABLE FSKU×months, severity color, Tet badge Jan-Mar
Upload CSV: filter exclude_flag + DORMANT_DISCONTINUED đúng spec (G2 fixed)
Override: dialog có locationCode input + period từ cell, submit OK (G6 fixed)
Segment bars: A=blue/B=yellow/C=gray đúng spec (G12 fixed)
Override history modal: bấm History → xem audit trail (FE-T9 fixed)
Snapshot metadata: snapshot_name, sourceType, horizon, createdBy lưu được (G5 fixed)
```

### AC Checklist Reality

| AC | Mô tả | Status | Ghi chú |
|----|-------|--------|---------|
| AC-01 | Upload 84K rows → snapshot created | ✅ | G2 fixed — exclude_flag + DORMANT_DISCONTINUED đúng spec |
| AC-02 | Invalid rows → validation_errors | ✅ | G3+G4 fixed |
| AC-03 | Excluded rows filtered | ✅ | G2 fixed — excludeFlagIdx + fallback model_config_id |
| AC-04 | fsku_id maps to item_code | ✅ | G3 fixed |
| AC-05 | Freeze → FROZEN, immutable | ✅ | OK |
| AC-06 | Override → log created | ✅ | G6 fixed |
| AC-07 | MAX_FORECAST_PO demand basis | ⚠️ | Flag stored nhưng actual MAX(forecast, PO) logic chưa chạy |
| AC-08 | Coverage = 85.5%, A=100% | ✅ | BUG-9 fixed |
| AC-09 | Tet flag badge displays | ✅ | G7 fixed — isTetPeriod() Jan-Mar |
| AC-10 | 84K rows < 120s | ⚠️ | Chưa test thực tế |

### What SHOULD show (per spec §9)

```
Coverage gauge: color-coded (green/yellow/red) + A/B/C segment mini-gauges
Snapshot table: full columns (locations, horizon, createdBy, frozenAt, actions)
Forecast Matrix: PIVOT TABLE (rows=FSKU, cols=months, cells=qty, color=severity)
Upload: drag-drop CSV → preview → validate → confirm
Override: click cell → edit qty + reason
Export: download CSV
```

---

## 2. Bug Fixes Completed (5/5)

| Bug | File | Fix | Verified |
|-----|------|-----|----------|
| BE-1 | demand-forecast-detail.entity.ts | Rewritten — 22 columns match DDL | YES |
| BE-2 | demand-override-log.entity.ts:5 | PK `log_id` → `override_id` | YES |
| BE-3 | demand-override-log.entity.ts:32 | `overriddenBy` optional → required | YES |
| BE-4 | demand.service.ts:262 | Validate overriddenBy not empty → UNIS-ERR-009 | YES |
| BE-5 | demand.service.ts:284 | Wrong error → new UNIS-ERR-010 LINE_NOT_FOUND | YES |

**Minor still open:** `override-forecast.dto.ts:35` — `overriddenBy` still `@IsOptional()` in DTO (service catches it, but DTO should match). Non-blocking.

---

## 2.1 Critical Bugs — Round 1 (2026-04-13) — ĐÃ FIX ✅

**Status:** Tất cả 7 bugs đã được dev fix — verified qua code inspection

| Bug | Severity | File đã fix | Fix đã apply | Verified |
|-----|----------|-------------|--------------|----------|
| **BUG-6** | 🔴 CRITICAL | `demand.service.ts:109-123` | `isDrpFormat` detection + correct header mapping | ✅ FIXED |
| **BUG-7** | 🔴 CRITICAL | `frontend/lib/api/demand.ts:54-62` | `OverrideDto` updated — đủ 7 fields match BE | ✅ FIXED |
| **BUG-8** | 🔴 CRITICAL | `app/demand/page.tsx:155-161` | `onCellClick` truyền xuống `ForecastMatrix` | ✅ FIXED |
| **BUG-9** | 🟡 HIGH | `demand.service.ts:239-241` | Query `SELECT COUNT(*) FROM item` thay snapshot_line | ✅ FIXED |
| **M1** | 🟡 MEDIUM | `demand.service.ts:256-282` | `bySegment` computed + returned đủ A/B/C | ✅ FIXED |
| **M2** | 🟡 MEDIUM | `filter-bar.tsx:51-54` | FilterBar có tet_flag dropdown — **filter có, badge chưa có** | ⚠️ PARTIAL |
| **M3** | ⚪ LOW | `forecast-matrix.tsx:75` | Key đổi thành `r.itemCode + '-' + r.segment` | ✅ FIXED |

---

## 2.2 Spec-Gap Bugs — Round 2 (2026-04-13) — ĐÃ FIX ✅

**Source:** Cross-check `01-demand-ingestion.md` vs implementation  
**Last verified:** 2026-04-13 Round 3

### Critical — Blocking AC

| ID | Severity | Fix Status | Evidence |
|----|----------|-----------|----------|
| **G1** | 🔴 | ✅ FIXED | `002b` migration + entity + service — 5 cột OK |
| **G2** | 🔴 | ✅ FIXED | `demand.service.ts:197-238` — `excludeFlagIdx` + fallback `model_config_id`, bỏ `&& qty===0` gate |
| **G3** | 🔴 | ✅ FIXED | `demand.service.ts:210-218` — pre-load validItems/validLocations, per-row FK error |
| **G4** | 🟡 | ✅ FIXED | `demand.service.ts:304-318` — filterSummary, validationErrors[] đủ spec |
| **G5** | 🟡 | ✅ FIXED | `002c` migration + entity — snapshot_name, source_type, forecast_file_name, horizon_start/end, created_by |
| **G6** | 🟡 | ✅ FIXED | `override-dialog.tsx` — locationCode input + periodStart từ cell click |

### Medium — Spec mismatch

| ID | Severity | Fix Status | Evidence |
|----|----------|-----------|----------|
| **G7** | 🟡 | ✅ FIXED | `forecast-matrix.tsx:18-22` — `isTetPeriod()` Jan-Mar, hiện 🧇 badge |
| **G8** | 🟡 | ✅ FIXED | `002c` migration — UPDATE SUPERSEDED→ARCHIVED + DROP/ADD constraint; entity comment cập nhật |
| **G9** | 🟡 | ✅ FIXED | `page.tsx` — `handleSegmentDrill()` → `CoverageGauge onSegmentClick` → filter pivot |
| **G10** | 🟡 | ✅ FIXED | `demand.controller.ts:39-43` — `@Post('snapshot')` + `createSnapshot()` service |

### Low — Nice to have

| ID | Fix Status | Issue |
|----|-----------|-------|
| **G11** | ❌ TODO | Summary endpoint thiếu `group_by location/period` — không blocking UAT |
| **G12** | ✅ FIXED | `coverage-gauge.tsx:93-95` — A=`bg-blue-500`, B=`bg-yellow-400`, C=`bg-gray-400` |

---

## 3. Feature Gap Analysis — 10 Items (UPDATED)

### Summary: Who owns each gap?

| # | Feature | Status | Ghi chú |
|---|---------|--------|----------|
| F1 | Pivot table (FSKU × months) | ✅ DONE | BE-T1 + FE-T3 implemented |
| F2 | Severity color (RED/ORANGE) | ✅ DONE | FE-T4 `cellColor()` implemented |
| F3 | Filters (combo_class, archetype, tet) | ✅ DONE | BE-T2 + FE-T5 FilterBar implemented |
| F4 | Upload dialog | ✅ DONE | FE-T1 fixed + BUG-6 fixed |
| F5 | Override dialog trigger | ✅ DONE | FE-T2 + G6 fixed — locationCode input + period từ cell |
| F6 | Snapshot table missing columns | ⚠️ PARTIAL | G5 DB+BE fixed, FE chưa hiển thị snapshotName/horizon/createdBy |
| F7 | Archive/Export/Delete actions | ✅ DONE | Export + Archive (BE-T7 + FE-T10) + Delete (BE-T6) đều hoạt động |
| F8 | Coverage gauge color + segments | ✅ DONE | BE-T3 + FE-T7 + drill-down (G9) |
| F9 | Export CSV | ✅ DONE | BE-T4 + FE-T8 implemented |
| F10 | Override history list | ✅ DONE | BE-T5 + FE-T9 — `OverrideHistoryModal` wired vào page.tsx |

---

## 4. Dev Tasks — Backend

### DONE ✅ (verified in code)

| Task | Status | Ghi chú |
|------|--------|----------|
| BE-T1: Pivot endpoint | ✅ | `GET /demand/forecast/pivot` — FSKU×months + qtySold12mAvg |
| BE-T2: 3 filter params | ✅ | `comboClass`, `branchArchetype`, `tetFlag` trong ForecastQueryDto |
| BE-T3: Coverage + bySegment | ✅ | `getForecastCoverage()` trả đủ totalItems + bySegment |
| BE-T4: Export CSV | ✅ | `GET /demand/forecast/export` — stream CSV response |
| BE-T5: Override history | ✅ | `GET /demand/overrides` — query demand_override_log |
| BE-T6: Delete snapshot | ✅ | `DELETE /demand/snapshots/:id` — DRAFT only, cascade |
| BE-T7: Archive snapshot | ✅ | `PUT /demand/snapshots/:id/archive` — FROZEN→ARCHIVED |
| G10: POST /demand/snapshot | ✅ | `POST /demand/snapshot` — `createSnapshot()` service |

### TODO ❌

| Task | Priority | Ghi chú |
|------|----------|----------|
| G11: Summary group_by location/period | LOW | Không blocking UAT |

---

## 6. Dev Tasks — Frontend

### DONE ✅ (verified in code)

| Task | Status | Ghi chú |
|------|--------|----------|
| FE-T1: UploadDialog | ✅ | Renders, drag-drop, preview, confirm |
| FE-T2: OverrideDialog trigger | ✅ | `onCellClick` wired, locationCode input + period từ cell (G6 fixed) |
| FE-T3: Pivot table | ✅ | Pivot FSKU×months, dynamic period columns |
| FE-T4: Severity color | ✅ | `cellColor()` RED/ORANGE logic |
| FE-T5: Filter bar | ✅ | segment, comboClass, tetFlag dropdowns |
| FE-T7: Coverage gauge color | ✅ | `gaugeColor()` green/yellow/red + A/B/C bars + drill-down (G9) |
| FE-T8: Export CSV | ✅ | Button calls `exportForecastCsv()` |
| FE-T9: Override history modal | ✅ | `OverrideHistoryModal` — import + wired trong page.tsx |
| FE-T10: Delete + Archive buttons | ✅ | SnapshotTable — `onDelete`/`onArchive` props + UI buttons |

### TODO ❌

| Task | Priority | Ghi chú |
|------|----------|----------|
| FE-T6: Snapshot table metadata cols | LOW | G5 DB+BE done, FE chưa render `snapshotName`, `horizonStart/End`, `createdBy` |

---

## 7. Execution Order (v3.2 — ALL PHASES DONE)

```
Phase 0 — CRITICAL BUG FIXES — ĐÃ DONE ✅
  [x] BUG-6 [x] BUG-7 [x] BUG-8 [x] BUG-9 [x] M1 [x] M3

Phase 1 — SPEC-GAP BUG FIXES — ĐÃ DONE ✅
  [x] G1 [x] G2 [x] G3 [x] G4 [x] G6

Phase 2 — MEDIUM SPEC GAPS — ĐÃ DONE ✅
  [x] G5 [x] G7 [x] G8 [x] G9 [x] G10

Phase 3 — Nice to have — ĐÃ DONE ✅
  [x] BE-T6 [x] BE-T7 [x] FE-T9 [x] FE-T10 [x] G12

Còn lại (LOW — không blocking UAT):
  [ ] G11: Summary group_by location/period
  [ ] FE-T6: Hiển thị snapshotName/horizon/createdBy trong Snapshot table
  [ ] AC-07: MAX(forecast, PO) actual business logic
  [ ] AC-10: Performance test 84K rows < 120s
```

---

## 8. Acceptance Check (Round 3 — verified)

```
[x] Pivot table shows FSKU × months with real data
[x] RED cells for forecast=0 + sales history > 0
[x] ORANGE cells for forecast > 2× avg
[x] Filter by segment + combo_class + tet_flag works
[x] Upload CSV → preview → validate → DRAFT snapshot created (exclude_flag filter đúng spec)
[x] Click cell → override dialog → edit qty + reason → saved
[x] Freeze → FROZEN → immutable
[x] Coverage gauge: green/yellow/red + A/B/C breakdown + drill-down click
[x] Export CSV downloads file
[x] Override history shows audit trail (OverrideHistoryModal)
[x] Delete DRAFT / Archive FROZEN hoạt động
[ ] Snapshot table: snapshotName/horizon/createdBy chưa hiển thị (FE-T6 pending)
[ ] AC-07: MAX(forecast, PO) business logic chưa chạy
[ ] AC-10: Performance test 84K < 120s chưa thực hiện
```

---

---

## 9. Round 4 — Dashboard v2.0 Review (2026-04-13 PM)

**Context:** Dev implement MODULE-1-FULL-IMPLEMENT.md v2.0 (Tab structure + Recharts + Accuracy Dashboard). TL review phát hiện 5 bugs.

### R1 (CRITICAL): Tab 1 dùng data của Tab 2 — DATA TRỘN

```
Status: ❌ CHƯA FIX

page.tsx Tab 1 (Forecast Overview) đang gọi SAI endpoints:

  Line 270: CoverageGauge     ← fetchForecastCoverage() → demand_snapshot_line = BRANCH data
  Line 274: Dormant count      ← fetchForecastQuality() → demand_forecast_detail = BRANCH data
  Line 286-291: DataQualityGauges ← quality + coverage + insights = TẤT CẢ từ BRANCH endpoints

Spec yêu cầu:
  Tab 1 (Overview) CHỈ dùng: demand_accuracy table + item table
  Tab 2 (Branch)   CHỈ dùng: demand_snapshot_line + demand_forecast_detail

Fix cần làm:
  1. Tách fetch per tab (lazy load khi switch)
  2. Tab 1 endpoints: fetchAccuracySummary, fetchAccuracyTrend, fetchAccuracySkus,
     fetchAccuracyWorst, fetchSkuStatus — TẤT CẢ từ demand_accuracy + item table
  3. Tab 1 KHÔNG gọi: fetchForecastInsights, fetchForecastQuality,
     fetchForecastCoverage, fetchBranchBreakdown, fetchForecastAlerts
  4. CoverageGauge Tab 1: tính từ demand_accuracy (items có forecast / total)
  5. DataQualityGauges: tính từ demand_accuracy data
  6. Dormant count Tab 1: lấy từ accuracy.alerts.dormant
```

### R2 (HIGH): DataQualityGauges hardcode + sai source

```
Status: ❌ CHƯA FIX

page.tsx line 289: dataMonths: 31 ← HARDCODED — không từ data thực
page.tsx line 290: segments ← tính từ insights.bySegment (BRANCH data)

Fix:
  - dataMonths: từ demand_accuracy (actual T10-T1 = 4 months, forecast T2-T3 = 6 total)
    HOẶC query demand_forecast_detail MAX(panel_months)
  - segments: count distinct segment từ item table
  - forecastRate: items_with_forecast / total_items từ demand_accuracy
  - sparsity: items có ≥3 months data / total items
```

### R3 (HIGH): FskuBranchTable gọi /forecast/detail — raw, không aggregated

```
Status: ❌ CHƯA FIX

fsku-branch-table.tsx line 53: fetch /demand/forecast/detail
  → trả raw rows 1:1 từ demand_forecast_detail (per item × branch × period)
  → Không group by, không aggregate

Fix: dùng /demand/forecast/pivot (group by item × period, đã có)
  HOẶC endpoint mới /demand/forecast/branch-detail:
    GROUP BY item_code, location_code
    SUM(qty) per period → pivot structure
```

### R4 (MEDIUM): Dead code — forecast-vs-actual-chart.tsx

```
Status: ❌ CHƯA FIX

File forecast-vs-actual-chart.tsx tồn tại nhưng KHÔNG import/render trong page.tsx.
Page dùng forecast-trend-chart.tsx thay thế.

Fix: Xóa forecast-vs-actual-chart.tsx (hoặc merge logic vào forecast-trend-chart.tsx)
```

### R5 (MEDIUM): Tab 1 SKU table thiếu forecast values

```
Status: ❌ CHƯA FIX

FskuAccuracyTable chỉ show: FSKU, Segment, Actual, Model Acc%, MA3 Acc%, Winner, Gain
Thiếu: forecast values (final_fc_t12, final_fc_t1, final_fc_t2, final_fc_t3)

Planner cần thấy CẢ forecast qty + actual qty + accuracy cùng lúc.

Fix: Thêm columns vào FskuAccuracyTable:
  FSKU │ Seg │ FC T12 │ Act T12 │ Acc T12 │ FC T1 │ Act T1 │ Acc T1 │ FC T2 │ FC T3
  Data đã có trong demand_accuracy table — chỉ cần thêm columns + update BE response
```

### R6 (HIGH): Tab 2 Branch Forecast — FSKU table chưa phân trang

```
Status: ❌ CHƯA FIX

Tab 2 FskuBranchTable hiện load raw data không phân trang.
70,620 rows demand_snapshot_line — nếu render hết → browser lag / crash.

Fix:
  - Server-side pagination: page + pageSize params
  - Default pageSize=50, options: 25/50/100
  - Sort server-side (ORDER BY qty DESC, item_code ASC)
  - Search server-side (WHERE item_code ILIKE '%keyword%')
```

### R7 (MEDIUM): Layout charts + summary chưa đẹp, chưa smart

```
Status: ❌ CHƯA FIX

Vấn đề:
  - Charts xếp đều nhau, không highlight section quan trọng
  - Summary cards + charts cùng kích thước → không phân cấp visual
  - Thiếu spacing, section dividers, visual hierarchy
  - Charts nhỏ quá hoặc to quá, không responsive tốt

Fix — Layout principles:
  1. KPI cards: row ngang, compact, left border color accent
  2. STAR charts (trend, donut): chiếm full width hoặc 2/3 width — NỔI BẬT
  3. Supporting charts (segment pie, combo bars): 1/3 width, bên cạnh star chart
  4. Tables: full width, clear section header + divider
  5. Spacing: gap-6 giữa sections, gap-4 trong grid
  6. Section headers: text-lg font-semibold + subtle bottom border
  7. Card design: rounded-xl, shadow-sm, hover:shadow-md transition
  8. Grid responsive: lg:grid-cols-3 cho charts, md:grid-cols-2, sm:grid-cols-1

Cụ thể Tab 1:
  Row 1: 4+4 KPI cards (nhỏ gọn, informative)
  Row 2: [Donut 1/3 width] + [Quality Gauges 2/3 width] ← donut nổi bật bên trái
  Row 3: [Trend chart FULL WIDTH] ← star feature, chiếm nhiều không gian
  Row 4: [Accuracy Month 1/2] + [Accuracy Tier 1/2]
  Row 5: [FSKU Table FULL WIDTH]
  Row 6: [Worst Performers FULL WIDTH, collapsible]

Cụ thể Tab 2:
  Row 1: 4 KPI cards
  Row 2: Snapshot table (full width, compact)
  Row 3: [Demand by Period 1/3] + [Demand by Segment 1/3] + [Pattern Mix 1/3]
  Row 4: [Top 10 Branches 1/2] + [Quality/Confidence 1/2]
  Row 5: [Alerts + Tet side by side]
  Row 6: Filter bar
  Row 7: Forecast Matrix (full width)
  Row 8: Branch Breakdown (full width)
  Row 9: FSKU × Branch Table (full width, paginated)
```

### 3 BE Endpoints mới (đã build, cần verify)

```
Endpoint                              | Mục đích                     | Status
GET /demand/accuracy/trend            | Forecast+actual per month    | ✅ Built, cần verify data
GET /demand/accuracy/sku-trend?fsku=X | Single SKU T10→T3 sparkline  | ✅ Built, cần verify
GET /demand/forecast/sku-status       | SKU status donut (ACT/END/NEW)| ✅ Built, verified OK

Verify cần:
  [ ] /accuracy/trend: confLower/confUpper có data (hiện null cho T10/T11)
  [ ] /accuracy/sku-trend: trả đúng 6 months data per FSKU
  [ ] Cả 3 endpoints: response format match spec trong MODULE-1-FULL-IMPLEMENT.md
```

### R8 (HIGH): Chưa có list forecast chi tiết — CẢ 2 tab

```
Status: ❌ CHƯA FIX

Tab 1 (Overview):
  - Có FskuAccuracyTable → show accuracy per SKU
  - THIẾU: bảng forecast chi tiết per SKU = forecast T12, T1, T2, T3 + actual T10, T11, T12, T1
  - Planner cần 1 bảng nhìn xuyên suốt: "FSKU X dự báo bao nhiêu, thực tế bao nhiêu, sai lệch bao nhiêu"
  
Tab 2 (Branch):
  - Có ForecastMatrix (pivot FSKU × month) → nhưng đây là aggregated, không detail per row
  - FskuBranchTable gọi /forecast/detail raw → không paginated (R6)
  - THIẾU: bảng forecast chi tiết per FSKU × branch = branch nào bán bao nhiêu, forecast bao nhiêu

Fix Tab 1:
  - Merge FskuAccuracyTable + forecast values vào 1 bảng duy nhất:
    FSKU │ Seg │ Act T10 │ Act T11 │ Act T12 │ FC T12 │ Acc T12 │ Act T1 │ FC T1 │ Acc T1 │ FC T2 │ FC T3
  - Data: demand_accuracy table (đã có tất cả columns)
  - Pagination server-side, sort, search, export

Fix Tab 2:
  - Bảng FSKU × Branch chi tiết:
    FSKU │ Branch │ Branch Name │ Dec │ Jan │ Feb │ Mar │ Total
  - Data: demand_snapshot_line GROUP BY item_code, location_code
  - JOIN location for branch name
  - Pagination server-side (70K rows PHẢI server-side)
  - Filter: branch dropdown, segment, search FSKU
```

### R9 (HIGH): Chưa có summary forecast theo từng chi nhánh

```
Status: ❌ CHƯA FIX

Tab 2 có BranchTable (54 branches, total qty, top segment) → nhưng chỉ là 1 bảng đơn giản.
THIẾU: summary per branch = khi click 1 branch → thấy:
  - Forecast trend (4 months) cho branch đó
  - Top FSKUs tại branch đó
  - Segment breakdown tại branch đó
  - So sánh branch này vs average

Có 2 cách implement:

Option A — Click branch → expand row (inline detail):
  Row: CN Tiền Giang │ 542 items │ 395K total
  [Click expand ▼]
  ├── Forecast: Dec 100K → Jan 95K → Feb 80K → Mar 120K
  ├── Top 5 FSKUs: UGC3600 (45K), M5190 (30K), ...
  └── Segments: A 40% │ B 45% │ C 15%

Option B — Click branch → modal/drawer:
  Drawer slide-in từ phải, full detail per branch
  
Option A đơn giản hơn, recommend cho Phase 1.

BE cần:
  GET /demand/forecast/branch-summary?snapshot_id=X&location_code=073
  → Returns: periodBreakdown[], topFskus[], segmentBreakdown
  
  Data source: demand_snapshot_line WHERE location_code = :loc GROUP BY period / item
```

### R10 (CRITICAL): Tốc độ load chart UI lag — cần tối ưu GẤP

```
Status: ❌ CHƯA FIX

Hiện tại page.tsx load 8+ API calls parallel khi mount:
  fetchSnapshots + fetchForecastCoverage + fetchForecastInsights + fetchForecastQuality + 
  fetchForecastAlerts + fetchBranchBreakdown + fetchAccuracySummary + fetchAccuracyTrend + ...

Vấn đề:
  1. TẤT CẢ fetch cùng lúc kể cả tab chưa active → waste bandwidth
  2. Recharts render 5+ charts đồng thời → main thread block → UI jank
  3. Không có loading skeleton → white flash
  4. Không cache → mỗi lần switch tab fetch lại

Fix — Performance optimization:

  A. LAZY FETCH per tab:
    - Tab 1 active → chỉ fetch Tab 1 data (accuracy + sku-status + trend)
    - Tab 2 active → chỉ fetch Tab 2 data (insights + quality + branches + pivot)
    - Switch tab → fetch nếu chưa có, dùng cache nếu có
    
    const [tab1Data, setTab1Data] = useState(null);
    const [tab2Data, setTab2Data] = useState(null);
    
    useEffect(() => {
      if (tab === 'overview' && !tab1Data) loadTab1();
      if (tab === 'branch' && !tab2Data) loadTab2();
    }, [tab]);

  B. LAZY RENDER charts:
    - Dùng React.lazy() + Suspense cho Recharts components
    - Hoặc: IntersectionObserver → chỉ render chart khi visible in viewport
    
    const LazyTrendChart = React.lazy(() => import('./forecast-trend-chart'));
    <Suspense fallback={<ChartSkeleton />}>
      <LazyTrendChart data={trend} />
    </Suspense>

  C. SKELETON loading:
    - Mỗi section có skeleton placeholder khi loading
    - KPI: shimmer boxes
    - Charts: gray placeholder với dimensions đúng
    - Tables: row shimmer

  D. DATA CACHE:
    - FROZEN snapshot = immutable → cache aggressively
    - demand_accuracy = static → cache 5 phút
    - useSWR hoặc simple useState cache
    
  E. RECHARTS optimization:
    - isAnimationActive={false} cho initial render (bật animation khi hover only)
    - ResponsiveContainer: set explicit width/height thay vì auto-calculate
    - Reduce data points: nếu > 1000 rows → sample/aggregate trước khi chart
```

### R11 (HIGH): Branch chỉ hiển thị MÃ CODE — không có TÊN CHI NHÁNH

```
Status: ❌ CHƯA FIX

FskuBranchTable hiện show: "073", "116", "015" — KHÔNG AI HIỂU đây là branch nào.
BranchTable (top 10) có tên nhưng FskuBranchTable THIẾU.
Branch filter cũng chỉ nhập code — khó dùng.

Vấn đề gốc:
  1. BE /forecast/branch-pivot response KHÔNG trả locationName
  2. FE column "Branch" width=90px, chỉ render code

Fix BE:
  /forecast/branch-pivot response thêm field locationName:
    {
      "itemCode": "UGC3600",
      "locationCode": "073",
      "locationName": "Chi nhánh Tiền Giang",    ← THÊM
      "segment": "A",
      "periods": {...},
      "total": 17992
    }
  
  Implementation: JOIN location table trong query
    LEFT JOIN location loc ON l.location_code = loc.location_code
    → MAX(loc.location_name) AS "locationName"

Fix FE:
  1. FskuBranchTable thêm column "Chi nhánh" (tên đầy đủ):
     { key: 'locationName', header: 'Chi nhánh', 
       render: r => <span className="text-xs">{r.locationName}</span> }
  
  2. Column order: FSKU | Mã CN | Chi nhánh | Seg | Dec | Jan | Feb | Mar | Total
     "Mã CN" = locationCode (nhỏ, font-mono)
     "Chi nhánh" = locationName (tên đầy đủ, normal font)
  
  3. Branch filter: đổi từ text input → dropdown select với tên:
     <select>
       <option value="">Tất cả chi nhánh</option>
       <option value="073">073 — Chi nhánh Tiền Giang</option>
       <option value="015">015 — Chi nhánh Vĩnh Long</option>
       ...
     </select>
  
  4. BranchTable (top 10) + BranchBreakdown: CŨNG hiển thị tên đầy đủ
     Không viết tắt. "CHI NHÁNH TIỀN GIANG" không viết thành "CN-TG"

Áp dụng cho TẤT CẢ nơi hiển thị branch:
  - FskuBranchTable (FSKU × branch detail)
  - BranchTable (top 10 ranking)
  - Branch breakdown (54 branches)
  - Branch filter dropdown
  - Forecast matrix (nếu có branch column)
  - Export CSV (thêm column locationName)
```

### Round 4 Summary (FINAL — v4.3)

```
ĐÃ FIX ✅ (verified):
  [x] R1: Data separation per tab (lazy fetch)
  [x] R2: DataQualityGauges từ /accuracy/overview
  [x] R3: Branch table dùng /branch-pivot aggregated
  [x] R5: FSKU accuracy table có forecast values (FC T12→T3)
  [x] R6: Branch table server-side pagination
  [x] R8: Forecast detail tables cả 2 tab

CHƯA FIX ❌:
  [ ] R4: Xóa dead code forecast-vs-actual-chart.tsx
  [ ] R9: BE endpoint /branch-summary → 404 (chưa implement)
  [ ] R10: Performance — thiếu React.lazy, skeleton loading, animation disable
  [ ] R11: Branch hiển thị MÃ CODE không tên — BE thiếu locationName, FE thiếu column

CŨNG CẦN:
  [ ] R7: Layout visual quality (cần xem browser)

BE CẦN THÊM:
  [ ] /forecast/branch-summary — periodBreakdown + topFskus per branch (R9)
  [ ] /forecast/branch-pivot — thêm locationName trong response (R11)

Còn lại từ Round 3 (LOW):
  [ ] G11, FE-T6, AC-07, AC-10
```

---

## 10. Acceptance Check (Round 4 — FINAL v4.3)

```
Round 1-3 (ALL PASS):
  [x] Pivot, severity color, filters, upload, override, freeze, coverage, export, history

Round 4 — FIXED ✅:
  [x] Tab 1 data ONLY from demand_accuracy + item
  [x] Tab 2 data ONLY from demand_snapshot_line + demand_forecast_detail
  [x] DataQualityGauges: from /accuracy/overview (no hardcode)
  [x] FSKU table Tab 1: forecast values + accuracy merged
  [x] FSKU table Tab 2: server-side pagination via /branch-pivot

Round 4 — PENDING ❌:
  [ ] Branch names hiển thị đầy đủ (KHÔNG viết tắt, KHÔNG chỉ code)
  [ ] Branch filter = dropdown với tên (không text input code)
  [ ] /branch-summary endpoint hoạt động (click branch → detail)
  [ ] React.lazy + skeleton loading cho charts
  [ ] No dead code files
  [ ] Layout visual hierarchy on browser
    [ ] Lazy render charts (React.lazy hoặc IntersectionObserver)
    [ ] Skeleton loading states
    [ ] Page load → first paint < 1s, all data < 3s
    [ ] Switch tab → data hiện ngay nếu đã cache

  Cleanup:
    [ ] No dead code files
    [ ] No hardcoded values
    [ ] 3 BE endpoints verified
```

---

*MODULE-1-REVIEW.md | Tech Lead Review | v4.2 | 2026-04-13*
*v4.0: Round 4 — R1-R5 (data mixing, charts)*
*v4.1: Added R6 (pagination), R7 (layout)*
*v4.2: Added R8 (forecast detail tables), R9 (branch summary), R10 (performance optimization)*
