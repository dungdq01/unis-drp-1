# M28 — Feedback & Closed Loop

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 9 (cuối Flow 2)
> **Owner:** BE1 · **DA:** DA2 · **FE:** FE1
> **Status:** 🔴 NEW — folder mới `src/feedback/`
> **PRD:** §F2-B8 Feedback & Closed Loop · **Flow:** 2 (Weekly Monday 06:00 VN)
> **Domain:** D10 Intelligence (cross-cutting feedback về D1/D2/D3/D4)
> **Feature flag:** `m28_feedback_loop_enabled`
> **Folder (Rule 3):** `backend/src/feedback/` (NEW, kebab-case)
> **Changelog v1.1 (CTO review):** Fix C1 (honoring formula đúng PRD theo M26 v1.2: actual/atp_at_check rolling 3m, threshold <80%), C2 (σ_demand source = demand-side thật, không supply_snapshot), C3 (write-back qua owner service consistency), H1 (M23 computeSsCnFormula contract formalize), H2 (transport_lane.transit_lt_days prerequisite), H3 (status COMPLETED_PARTIAL sync), H4 (M26 monthly vs M28 weekly coordination), M1-M3 medium.
> **Changelog v1.2 (CTO sweep round 2):** Fix H1 (SS write-back chốt: compute-only + persist sigma_history → M23 next cycle dùng), H2 (chốt 2 method names tách bạch: compute pure vs refresh write-back), M1 (Step 6 honoring sync mode parameter), M2 (sweep US-7 wording direct UPDATE), M3 (chốt source precedence Phase 1 demand-side).

---

## 1. Tại sao làm bài này

Sau khi M21→M27 chạy hoàn chỉnh, hệ thống **đóng vòng tròn**: data thực tế (PO delivered, actual LT, actual sales) phải feedback ngược về master data + parameters để cycle sau chính xác hơn.

Hôm nay UNIS không có closed loop:
- SS tính 1 lần khi setup, không update theo thực tế → buffer sai (kẹt vốn hoặc stockout)
- Transit LT config tay → DRP tính sai khi NM thực tế nhanh/chậm hơn
- Planner override liên tục mà không có ai phân tích → system suggestion không cải thiện
- Trust score CN không có metric thực để measure

M28 chạy **weekly Monday 06:00 VN** sau khi tuần trước close, làm 5 việc:
1. **SS auto-adjust** — recompute σ_demand từ actual → persist `sigma_history` (KHÔNG ghi `ss_cn` trực tiếp). M23 cycle nightly tiếp theo đọc sigma mới và tự refresh `ss_cn`.
2. **Transit LT auto-update** — actual delivery LT → rolling avg → update `supplier.lead_time_days` (M00) + `transport_lane.transit_lt_days`
3. **Trust score refresh** — CN adjusted vs actual → update `trust_score` (M22 cycle sau dùng)
4. **NM honoring rate compute** — backfill `nm_honoring_rate.fulfilled_total` (M26 cross-link)
5. **Override analysis** — top 5 reasons Planner edit PO/TO → dashboard

Plus: Weekly KPI dashboard (FC MAPE, fill rate, LCNB util, transport fill, system accuracy).

---

## 2. Scope

### ✅ Thêm
- 4 bảng mới: `ss_adjustment_log`, `lt_actual_log`, `override_analysis`, `weekly_kpi_snapshot`
- Closed-loop services: `SsAutoAdjustService`, `LtAutoUpdateService`, `TrustRefreshService`, `HonoringBackfillService`, `OverrideAnalysisService`
- Weekly KPI snapshot service + dashboard
- Cron weekly Monday 06:00 VN
- Feedback dashboard FE
- M00/M22/M23/M26 write-back qua existing services (KHÔNG mutate trực tiếp)

### ❌ Không đụng
- M27 PO/TO data — chỉ READ qua `getPoFulfillment()`
- M22/M23/M00 schemas — chỉ UPDATE qua existing service methods (autoUpdateLt, refreshTrustScore...)
- Statistical/ML model — Phase 1 dùng simple rolling avg + σ. Phase 2 ML
- Real-time feedback (intra-day) — Phase 1 weekly cadence

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | M28 cron weekly Monday 06:00 VN — sau khi tuần trước (Mon-Sun) đã close hoàn toàn. Đảm bảo PO/TO RECEIVED data đầy đủ | Cadence (BR-F2B8-001) |
| **R2** | **SS auto-adjust weekly (H1+H2 CTO v1.2 chốt rõ ownership):** <br>• Step A — Recompute `σ_demand_new` từ M9 actual (Phase 1 fallback `demand_snapshot.qty` proxy theo M3 precedence) 12w rolling<br>• Step B — Compute `ss_new` qua `M23.SsCnService.computeSsCnFormula(input)` — **pure function, KHÔNG ghi DB**<br>• Step C — Compare delta: \|ss_new - ss_old\| / ss_old > 20% → log alert WARNING; > 50% → cap (R12)<br>• Step D — **Persist** `sigma_demand_new` vào bảng `sigma_history(cn_id, sku_id, sigma, calculated_at, plan_run_id)` (NEW table — single source of truth)<br>• Step E — Insert `ss_adjustment_log` (audit only, KHÔNG tính plan run)<br>• **KHÔNG ghi `ss_cn` trực tiếp.** M23 cycle nightly tiếp theo (D+1) sẽ đọc sigma_history mới nhất qua `M23.SsCnService.refresh()` (write-back service riêng) và tự tạo `ss_cn` row mới với sigma cập nhật.<br>• 2 methods M23 expose tách bạch: `computeSsCnFormula(input): number` (pure, M28 dùng) vs `refresh(plan_run_id)` (write `ss_cn`, M23 nightly dùng) | Auto loop |
| **R3** | **LT auto-update** weekly với safety gate (M00 §11.3 reuse):<br>• `lt_actual_avg` = rolling 6 tháng từ `po_tracking.lt_actual_days`<br>• Delta > 30% → KHÔNG auto-apply, increment `supplier.lt_drift_count`<br>• Drift count ≥ 3 lần liên tiếp → force apply + alert<br>• Delta ≤ 30% → auto-apply ngay, reset drift counter | Safety gate |
| **R4** | **Trust score refresh** (M22 R7 grace unblock): <br>• Khi đủ 12w actual_sales data per CN → set `trust_score.is_grace_period=FALSE`<br>• Compute `score = accurate / total × 100` từ `cn_demand_adjustment.actual_qty + is_accurate`<br>• Backfill `actual_qty` và `is_accurate` cho rows tuần trước | Phase 2 unblock |
| **R5** | **Honoring rate backfill (C1 CTO sweep — đúng M26 v1.2 + PRD)**: <br>• Compute `fulfilled_total = Σ(po_line.actual_received_qty WHERE delivered tuần trước, status RECEIVED/CLOSED)` per NM<br>• Compute `atp_at_check_total = Σ(atp_check.atp_qty WHERE result IN PASS/PARTIAL, cùng period)` — denominator đúng PRD<br>• `rate = fulfilled / atp_at_check_total` — KHÔNG dùng requested_total<br>• `rolling_3m_rate` = aggregate 3 months gần nhất<br>• Threshold alert: **<80% rolling 3 months** → flag `supplier.nm_unreliable_badge=TRUE` + WARNING (đúng PRD, KHÔNG <70%/<50% monthly)<br>• Gọi `M26.HonoringRateService.recompute()` thay vì write trực tiếp (R11 ownership) | Cross-link M26 v1.2 |
| **R6** | **Override analysis** (BR-F2B8-007): aggregate `po_edit_log` 7 ngày qua, top 5 reasons by frequency. Manual review only — KHÔNG auto-adjust suggestion rules | Human review |
| **R7** | **FC MAPE Phase 2 only** — yêu cầu actual_sales table. Phase 1 stub cron compute = NULL với log "Pending Phase 2 actual_sales source" | Phase gate |
| **R8** | **Fill rate < 85% liên tục 2 tuần** (BR-F2B8-004) → alert SC Manager review allocation rules + NM perf | Guard rail |
| **R9** | **NM honoring < 80% over 12 weeks** (BR-F2B8-005) → flag NM unreliable badge cho M26 ATP UI display | NM trust |
| **R10** | **Idempotent run**: 1 weekly_kpi_snapshot per (week_start_date). Re-run cùng tuần → 409 trừ khi force re-run với reason | Avoid duplicate |
| **R11** | **NO write-back trực tiếp DB (H2 CTO v1.2 chốt method names)** — M28 gọi existing services:<br>• `M00.SupplierService.autoUpdateLt(nmId, lt, actor)` — write supplier.lead_time_days<br>• `M00.LaneService.updateTransitLt(nmCode, cnCode, lt, actor)` — write transport_lane.transit_lt_days<br>• `M22.TrustService.refresh(cnId, weekStart)` — write trust_score<br>• `M26.HonoringRateService.recompute(month, mode)` — write nm_honoring_rate<br>• `M23.SsCnService.computeSsCnFormula(input): number` — **pure compute only** (M28 dùng cho SS audit + persist sigma_history)<br>• M23 KHÔNG có method `recompute` cho M28 — M23 nightly cycle tự đọc sigma_history và refresh ss_cn (xem H1) | Separation of concerns |
| **R12** | **Drift safety cap**: SS adjustment per cycle ≤ 50% (không tăng/giảm > 50% trong 1 tuần). Vượt → cap + alert "SS GA-300 muốn tăng 80%, cap 50%, review thủ công" | Stability |

---

## 4. Pipeline (weekly cron)

```
Monday 06:00 VN — week_start = previous Monday (today - 7 days)

Step 1: Validate (R10 idempotent, M10 flag check)
Step 2: Create weekly_kpi_snapshot(week_start) status='RUNNING'

Step 3: SS Auto-Adjust (R2, R12 cap, H1+H2 v1.2 chốt write strategy)
   For each (cn, sku) có drp_cn_line tuần trước:
     -- Demand-side σ source theo precedence Phase 1 (M3 sweep):
     --   1. M9.plan_actual_comparison.actual_qty (preferred — actual data nếu có)
     --   2. demand_snapshot.qty (fallback — FC proxy nếu actual chưa có)
     σ_new = recompute σ_demand 12w rolling từ source theo precedence
     ss_new = M23.SsCnService.computeSsCnFormula(cn, sku, σ_new, ...)  -- PURE function, KHÔNG ghi DB
     ss_old = SELECT ss_final FROM ss_cn WHERE plan_run_id = latest
     delta_pct = |ss_new - ss_old| / ss_old × 100
     IF delta_pct > 50: cap ss_new = ss_old × (1 ± 0.5), log capped=TRUE
     IF delta_pct > 20: log + alert WARNING
     INSERT ss_adjustment_log {cn, sku, ss_old, ss_new, delta_pct, capped, calculated_at}
     INSERT sigma_history {cn_id, sku_id, sigma=σ_new, calculated_at, source='M28_AUTO_WEEKLY'}
     -- KHÔNG ghi ss_cn trực tiếp. M23 nightly D+1 đọc sigma_history mới nhất qua
     --   M23.SsCnService.refresh(plan_run_id) (write service riêng, M23 owner) → tự ghi ss_cn row mới.

Step 4: LT Auto-Update (R3 safety gate qua M00)
   For each (nm_id):
     lt_actuals = M27.getActualLtPerNmRoute(nm_id, null, week_start - 6 months, week_start)
     lt_avg = mean(lt_actuals)
     M00.SupplierService.autoUpdateLt(nm_id, lt_avg, 'M28_AUTO')
       // M00 service tự xử lý drift gate >30% + counter (M00 §11.3)
     INSERT lt_actual_log {nm_id, old_lt, new_lt, sample_size, drift_pct, action, calculated_at}
   
   For each (route NM×CN) tương tự:
     transit_lt_actual_avg = mean từ po_tracking.lt_actual_days
     M00.LaneService.updateTransitLt(nmCode, cnCode, lt_avg, 'M28_AUTO')   -- C3 CTO fix: gọi service, KHÔNG UPDATE trực tiếp
     -- M00.LaneService nội bộ tự handle audit + drift gate + write transport_lane

Step 5: Trust Score Refresh (R4)
   For each cn_id:
     Backfill cn_demand_adjustment.actual_qty WHERE actual_qty IS NULL AND week<=week_start
       (Phase 1: dùng demand_snapshot proxy nếu chưa có actual_sales)
     Compute is_accurate per row: |adj - actual|/actual <= 20%
     M22.TrustService.refresh(cn_id, week_start)
       // M22 service compute score + update trust_score, set is_grace_period=FALSE nếu đủ 12w
     
Step 6: NM Honoring Backfill (R5, M1 sweep — sync mode parameter coordination)
   M26.HonoringRateService.recompute(week_start.month, mode='weekly_rolling')
     // mode='weekly_rolling' = M28 weekly upsert rolling_3m_rate (KHÔNG tạo row mới)
     // mode='monthly_full' = M26 monthly cron Day 1 (tạo row period_month mới + initial compute)
     // M28 weekly chỉ refresh rolling, không duplicate logic monthly

Step 7: Override Analysis (R6)
   rows = SELECT field_changed, reason, COUNT(*) FROM po_edit_log
          WHERE changed_at BETWEEN week_start AND week_end GROUP BY ... ORDER BY count DESC LIMIT 5
   INSERT override_analysis {week_start, top_reasons[], total_edits, system_accuracy_pct}

Step 8: KPI Snapshot (R7 stub MAPE)
   Compute weekly metrics:
     fc_mape: NULL Phase 1 (note "Pending actual_sales")
     fill_rate: SUM(actual_received) / SUM(confirmed_qty) từ M27 PO RECEIVED
     lcnb_util: COUNT(legs source_type='CN_REDIST') / total legs
     transport_fill_avg: AVG(transport_trip.fill_ratio)
     system_accuracy: 1 - (edited_po_count / total_po_count)
     nm_honoring_avg: AVG(nm_honoring_rate.rate) tuần này
   UPDATE weekly_kpi_snapshot status='COMPLETED' với metrics

Step 9: Trigger alerts (R8 fill_rate, R9 NM unreliable)
```

**Run time target:** < 2 phút toàn network (NFR-F2B8-002).

---

## 5. User Stories (Acceptance)

### US-1: Cron weekly Monday 06:00 VN
**Given** Monday 06:00 VN. **When** cron fire. **Then** create `weekly_kpi_snapshot(week_start = previous Monday)`, run pipeline 9 steps, complete < 2 phút.

### US-2: SS auto-adjust delta nhỏ
**Given** CN-BD GA-300 SS old=500, σ_new computed → SS new=480 (delta -4%). **When** Step 3. **Then** log `ss_adjustment_log` với delta_pct=4, capped=FALSE. KHÔNG alert (< 20% threshold).

### US-3: SS adjust delta lớn → alert
**Given** SS old=500, σ_new spike → SS new=750 (delta +50%). **When** Step 3. **Then** cap ss_new=500×1.5=750 (đúng cap), alert WARNING "SS GA-300 CN-BD tăng 50%, đạt cap, review thủ công". Log capped=TRUE.

### US-4: SS adjust vượt cap
**Given** SS old=500, σ extreme → SS new tính ra 900 (delta +80%). **When** compute. **Then** cap ss_new = 500×1.5 = 750, log delta_actual=80%, alert "SS muốn tăng 80% nhưng đã cap 50%".

### US-5: LT auto-update OK
**Given** NM Mikado config_lt=2.0 ngày. Actual 30 PO 6 tháng qua avg=2.2 ngày (delta 10%). **When** Step 4. **Then** call `M00.autoUpdateLt(Mikado, 2.2)`. M00 service apply (delta < 30%), update supplier.lead_time_days=2.2, audit log, reset drift counter.

### US-6: LT drift cảnh báo + counter
**Given** NM Mikado config_lt=2.0, actual avg=3.0 (delta +50% > 30%). **When** Step 4. **Then** M00 service KHÔNG auto-apply, increment `supplier.lt_drift_count`, alert WARNING. Lần thứ 3 drift liên tiếp → force apply + alert INFO (M00 §11.3).

### US-7: Transit LT route auto-update **(M2 sweep — qua owner service)**
**Given** Route Mikado→CN-BD config 2 ngày. Actual 15 PO avg 2.5 ngày. **When** Step 4. **Then** call `M00.LaneService.updateTransitLt('Mikado', 'CN-BD', 2.5, 'M28_AUTO')` — M00 service nội bộ tự handle audit + ghi `transport_lane.transit_lt_days=2.5`. M28 KHÔNG UPDATE trực tiếp. INSERT lt_actual_log audit.

### US-8: Trust refresh — 12w grace unblock
**Given** CN-BD đã có 12 tuần actual_sales backfilled. trust_score.is_grace_period=TRUE. **When** Step 5. **Then** compute score=85% (90 accurate / 105 total), call `M22.TrustService.refresh(BD)` → set is_grace_period=FALSE, score=85.

### US-9: Trust refresh chưa đủ data
**Given** CN-DN mới 6w actual. **When** refresh. **Then** keep is_grace_period=TRUE, log "Insufficient actual data, skip refresh".

### US-10: Honoring backfill
**Given** Tháng 4 cells PASS+PARTIAL của Mikado: tổng `atp_at_check_total=45000m²` (NM đã promise), `actual_received=42000m²` từ M27 PO RECEIVED. **When** Step 6. **Then** call `M26.HonoringRateService.recompute(2026-04)`. M26 update `nm_honoring_rate(Mikado, 2026-04, atp_at_check_total=45000, fulfilled_total=42000, rate=42000/45000=0.933)`. Tính `rolling_3m_rate` 3 tháng gần nhất; nếu <80% → M26 alert WARNING + `supplier.nm_unreliable_badge=TRUE` (C1 sweep — đúng PRD, KHÔNG threshold <70%/<50%).

### US-11: Override analysis top 5
**Given** Tuần trước 50 PO, Planner edit 12 PO với reasons: "Đơn mới"×5, "CN đủ"×3, "NM thiếu"×2, "Other"×2. **When** Step 7. **Then** insert override_analysis với top_reasons array sorted, total_edits=12, system_accuracy=1-12/50=76%.

### US-12: Fill rate < 85% alert
**Given** Tuần này fill_rate=82%, tuần trước 80%. **When** Step 9 check. **Then** alert SC Manager (BR-F2B8-004): "Fill rate 2 tuần liên tục < 85%, review allocation".

### US-13: NM honoring <80% over 12w
**Given** Phú Mỹ avg honoring 12 tuần = 75%. **When** Step 9. **Then** flag `supplier.nm_unreliable_badge=TRUE`. M26 ATP UI hiển thị badge cảnh báo Phase 1.

### US-14: Idempotent reject
**Given** weekly_kpi_snapshot(week_start=2026-04-13) đã COMPLETED. **When** trigger lại. **Then** 409 "Đã chạy weekly cho tuần này. Force rerun cần reason."

### US-15: Force rerun
**Given** Bug fix sau weekly run. **When** SC Manager click "Force rerun" + reason "M27 actual_received bị thiếu cho 5 PO, đã backfill manual". **Then** create snapshot mới với is_force_rerun=TRUE, force_rerun_reason. Override analysis recompute.

### US-16: Dashboard SC Manager view
**As SC Manager**, mở `/feedback/dashboard`. **Then** thấy:
- 6 KPI cards: FC MAPE (NULL Phase 1 với note), Fill Rate, LCNB Util, Transport Fill, System Accuracy, NM Honoring Avg
- Trend tuần trước vs tuần này (↑↓ arrow)
- Top 5 override reasons table
- SS adjustment log (last 4 weeks) chart
- LT drift table per NM

### US-17: Dashboard drill-down
**As SC Manager**, click "Fill rate detail". **Then** drill xuống per-CN×SKU table với cells highlighted (chronic shortage). Click cell → timeline 12 tuần actual vs planned.

### US-18: FC MAPE Phase 1 stub
**Given** Phase 1, không có actual_sales table. **When** Step 8. **Then** fc_mape=NULL trong snapshot. Dashboard hiển thị "Pending actual_sales — Phase 2 unblock". KHÔNG hiển thị 0% gây hiểu nhầm.

---

## 6. Data Contract

### `weekly_kpi_snapshot` (mới — wrapper run + KPI cache)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `week_start_date` DATE NOT NULL | Monday của tuần được measure |
| `status` VARCHAR(20) | RUNNING / COMPLETED / **COMPLETED_PARTIAL** / FAILED (H3 CTO fix — sync với pipeline rule "1 step fail không kill toàn run") |
| `step_errors` JSONB NULL | Array `[{step: 'SS_AUTO_ADJUST', error: '...'}]` khi status=COMPLETED_PARTIAL |
| `fc_mape_pct` DECIMAL(7,4) NULL | Phase 1: NULL |
| `fill_rate_pct` DECIMAL(7,4) NULL | Σ actual / Σ confirmed |
| `lcnb_util_pct` DECIMAL(7,4) NULL | CN_REDIST legs / total legs |
| `transport_fill_avg` DECIMAL(5,4) NULL | Avg trip fill_ratio |
| `system_accuracy_pct` DECIMAL(7,4) NULL | 1 - (edited / total PO) |
| `nm_honoring_avg_pct` DECIMAL(7,4) NULL | Avg rate tuần |
| `total_po_count`, `edited_po_count`, `total_to_count` | Stats |
| `ss_adjustments_count`, `lt_updates_count` | Stats |
| `is_force_rerun` BOOLEAN DEFAULT FALSE | |
| `force_rerun_reason` TEXT NULL | Min 20 chars khi force |
| `created_by`, `created_at`, `completed_at` | |
| Partial UNIQUE | `(week_start_date) WHERE is_force_rerun=FALSE` |

### `sigma_history` (mới — H1 v1.2 single source of truth cho σ rolling)
> M28 weekly persist sigma_demand mới. M23 nightly đọc latest cho mỗi (cn, sku) để refresh ss_cn. Tránh M28 ghi ss_cn trực tiếp (vi phạm Rule 14 ownership).

| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `cn_id` BIGINT FK channel | |
| `sku_id` BIGINT FK sku | |
| `sigma_demand` DECIMAL(15,4) | σ rolling 12w |
| `sample_size` INT | Số weeks contributing |
| `source` VARCHAR(20) | `M28_AUTO_WEEKLY / M28_MANUAL_RECOMPUTE / SEED` |
| `confidence` VARCHAR(10) | `HIGH` (actual data) / `LOW` (FC proxy Phase 1) |
| `calculated_at` TIMESTAMP | |
| `weekly_snapshot_id` BIGINT NULL FK | Trace M28 run |
| Composite UNIQUE | `(cn_id, sku_id, calculated_at)` |
| Index | `(cn_id, sku_id, calculated_at DESC)` cho M23 lookup latest |

### `ss_adjustment_log` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `weekly_snapshot_id` BIGINT FK | Trace run |
| `cn_id` BIGINT FK channel | |
| `sku_id` BIGINT FK sku | |
| `ss_old` DECIMAL(15,2) | Trước adjust |
| `ss_new_uncapped` DECIMAL(15,2) | Computed gốc |
| `ss_new_applied` DECIMAL(15,2) | Sau cap (R12 50%) |
| `delta_pct` DECIMAL(7,4) | (new - old) / old × 100 |
| `is_capped` BOOLEAN DEFAULT FALSE | True nếu vượt 50% cap |
| `trigger` VARCHAR(20) DEFAULT 'AUTO_WEEKLY' | AUTO_WEEKLY / MANUAL_REFRESH |
| `sigma_old`, `sigma_new` DECIMAL(15,4) | Snapshot σ trước/sau |
| `calculated_at` TIMESTAMP | |

### `lt_actual_log` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `weekly_snapshot_id` BIGINT FK | |
| `entity_type` VARCHAR(20) | `SUPPLIER` / `TRANSPORT_LANE` |
| `entity_id` BIGINT | nm_id hoặc lane_id |
| `route_label` VARCHAR(100) | E.g. "Mikado→CN-BD" |
| `lt_old_days` DECIMAL(5,2) | Config trước update |
| `lt_actual_avg_days` DECIMAL(5,2) | Rolling avg 6 months |
| `lt_new_days` DECIMAL(5,2) NULL | Sau apply (NULL nếu drift gate block) |
| `sample_size` INT | Số PO/TO contributing |
| `drift_pct` DECIMAL(7,4) | (actual - old) / old × 100 |
| `action` VARCHAR(20) | `APPLIED / DRIFT_BLOCKED / DRIFT_FORCE_APPLY` |
| `drift_count_after` INT | Counter sau update (M00 supplier.lt_drift_count) |
| `calculated_at` TIMESTAMP | |

### `override_analysis` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `weekly_snapshot_id` BIGINT FK | |
| `week_start_date` DATE | |
| `top_reasons` JSONB | Array `[{reason, count, pct}]` top 5 |
| `total_edits` INT | Σ po_edit_log + to_edit_log tuần này |
| `total_pos` INT | Σ po_header tuần này |
| `total_tos` INT | Σ to_header |
| `system_accuracy_pct` DECIMAL(7,4) | 1 - edits/total |
| `field_breakdown` JSONB | `{qty: 8, sku_added: 3, sku_removed: 1}` |
| `created_at` | |

### API chính

```
# Run lifecycle
POST  /api/v1/feedback/run                              # Manual trigger (cron tự fire)
POST  /api/v1/feedback/run/force-rerun                  # Force với reason
GET   /api/v1/feedback/snapshots?limit=                 # List weekly snapshots
GET   /api/v1/feedback/snapshots/:id                    # Detail + all KPI

# Closed-loop logs
GET   /api/v1/feedback/ss-adjustments?cnId=&skuId=&fromWeek=&toWeek=
GET   /api/v1/feedback/lt-updates?nmId=&fromDate=&toDate=
GET   /api/v1/feedback/overrides?week=                  # Top reasons cho 1 tuần

# Dashboard
GET   /api/v1/feedback/dashboard?week=                  # All KPI + trends + alerts
GET   /api/v1/feedback/dashboard/drill-down?metric=fill_rate&cnId=&skuId=

# Manual recompute (audit/debug)
POST  /api/v1/feedback/recompute/ss?cnId=&skuId=        # Single cell recompute
POST  /api/v1/feedback/recompute/lt?nmId=               # Single NM
```

**Folder structure:**
```
backend/src/feedback/
├── feedback.module.ts
├── feedback.controller.ts
├── feedback.service.ts                   ← lifecycle + cron orchestration
├── ss-auto-adjust.service.ts             ← Step 3 SS recompute + cap
├── lt-auto-update.service.ts             ← Step 4 LT rolling → M00
├── trust-refresh.service.ts              ← Step 5 → M22 backfill
├── honoring-backfill.service.ts          ← Step 6 → M26 recompute
├── override-analysis.service.ts          ← Step 7 top 5 reasons
├── kpi-snapshot.service.ts               ← Step 8 metrics aggregation
├── dashboard.service.ts                  ← Read-side query
├── dto/
└── entities/
    ├── weekly-kpi-snapshot.entity.ts
    ├── ss-adjustment-log.entity.ts
    ├── lt-actual-log.entity.ts
    └── override-analysis.entity.ts
```

---

## 7. Cron Schedule

| Cron | Schedule (VN) | Purpose |
|------|---------------|---------|
| **Weekly closed loop** | `0 6 * * 1` (Monday 06:00 VN) | Main pipeline 9 steps |
| **Honoring rate** | **H4 CTO fix — coordination chốt:**<br>• **M26 monthly cron Day 1 06:00 VN** = source of truth cho `nm_honoring_rate(period_month)` row mới (compute lần đầu cho tháng vừa kết thúc).<br>• **M28 weekly Step 6** = upsert incremental — recompute `rolling_3m_rate` cho 3 tháng gần nhất (M26 monthly không update rolling). M28 KHÔNG tạo row mới, chỉ UPDATE rolling_3m_rate.<br>• Race-safe: cùng gọi `M26.HonoringRateService.recompute(month, mode='monthly_full' \| 'weekly_rolling')` với mode parameter.<br>• Source of truth row level = M26 monthly. Source rolling_3m = M28 weekly. KHÔNG duplicate logic. | Coordination |

Decorator: `@Cron(..., { timeZone: 'Asia/Ho_Chi_Minh' })`.

---

## 8. Non-functional

- Weekly closed loop < **2 phút** toàn network (NFR-F2B8-002)
- Dashboard load < 3s (NFR-F2B8-001)
- Override analysis query < 10s (NFR-F2B8-004)
- LT update per route < 5s (NFR-F2B8-003)
- SS adjustment 25K cells < 60s

---

## 9. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `SupplierService.autoUpdateLt()`, `LaneService.updateLt()` | LT write-back qua existing service (R11) |
| **M00** `supplier.lt_drift_count` column | Drift counter (M00 §11.3) |
| **M10** policy snapshot configs | `feedback.ss_adjust_alert_threshold_pct=20`, `feedback.ss_adjust_cap_pct=50`, `feedback.fill_rate_alert_threshold=0.85` |
| **M10** feature flag `m28_feedback_loop_enabled` | Rollback |
| **M22** `TrustService.refresh(cnId)`, `cn_demand_adjustment.actual_qty` backfill | Trust score (R4) |
| **M23** `SsCnService.computeSsCnFormula(input): number` PURE | SS compute (R2) — M28 chỉ dùng để tính, KHÔNG ghi |
| **M23** `SsCnService.refresh(plan_run_id)` (write-back service) | M23 nightly tự dùng để đọc sigma_history mới và write ss_cn — M28 KHÔNG gọi |
| **M23** `ss_cn` table read latest | SS old comparison Step 3 |
| **M28** `sigma_history` table (NEW H1) | Single source of truth σ_demand qua M28 → M23 nightly đọc |
| **M26** `HonoringRateService.recompute(month)` | Honoring backfill (R5) |
| **M27** `getPoFulfillment(poId)`, `getActualLtPerNmRoute()`, `po_edit_log` | Actual data input |
| **M27** `po_tracking.lt_actual_days` | LT computation |
| **M9** `plan_actual_comparison.actual_qty` (Phase 1 fallback demand_snapshot.qty FC proxy) | **C2 CTO fix:** σ_demand source DEMAND-side (KHÔNG supply_snapshot — sai logic). Phase 1 dùng FC làm proxy nếu chưa có actual_sales. Phase 2 unblock với actual_sales table. |
| **M2/M21** `supply_snapshot_line` (line-level inventory) | Read-only cho fill_rate metric |
| **M9** `plan_actual_comparison` | Phase 2 FC MAPE source |
| **(Phase 2)** `actual_sales` table | FC MAPE + accurate trust score |

| Feeds | Why |
|-------|-----|
| **M00** `supplier.lead_time_days, lt_sigma, honoring_rate, nm_unreliable_badge` | Write-back qua service |
| **M00** `transport_lane.transit_lt_days, lt_sigma, last_actual_lt, last_updated_by_m28` | Write-back |
| **M22** `trust_score.score, total/accurate counters, is_grace_period` | Refresh |
| **M23** Next plan_run dùng σ mới (qua sigma_new từ M28 → SS recompute) | SS adjust loop |
| **M26** `nm_honoring_rate.fulfilled_total, rate` | Backfill |
| **M11** Phase 2 FC MAPE → SS Hub formula adjust (cross-flow F1) | Phase 2 |
| **M8 Alerts** | SS_DRIFT_HIGH, LT_DRIFT_BLOCKED, FILL_RATE_LOW, NM_UNRELIABLE, SYSTEM_ACCURACY_LOW |

---

## 10. DoD

- [ ] 4 tables migration + .down.sql
- [ ] Composite UNIQUE constraints (1 snapshot per week)
- [ ] Idempotent guard partial UNIQUE
- [ ] Pipeline 9 steps service `feedback.service.ts` orchestration với try/catch per step (1 step fail không kill toàn run)
- [ ] SS auto-adjust với cap 50% (R12) + alert threshold 20% (R2)
- [ ] **[H1 v1.2]** Bảng mới `sigma_history` (composite UNIQUE + index DESC for M23 lookup)
- [ ] **[H1 v1.2]** Step 3 persist `sigma_history`, KHÔNG ghi `ss_cn` trực tiếp
- [ ] **[H1 v1.2]** M23 cross-link verify: M23 nightly có method `SsCnService.refresh(plan_run_id)` đọc sigma_history mới nhất + write ss_cn
- [ ] **[H2 v1.2]** Verify M23 expose 2 methods tách bạch: `computeSsCnFormula()` PURE vs `refresh()` write-back
- [ ] **[M3 v1.2]** Step 3 implement source precedence: M9 actual → demand_snapshot FC fallback. Set `confidence='HIGH'/'LOW'` vào sigma_history
- [ ] LT auto-update gọi M00 services (R11 separation of concerns)
- [ ] Trust refresh gọi M22 service + backfill actual_qty từ Phase 1 fallback
- [ ] Honoring backfill gọi M26 service
- [ ] Override analysis aggregate top 5 reasons
- [ ] KPI snapshot compute đầy đủ (Phase 1: fc_mape NULL với note)
- [ ] Cron Monday 06:00 VN với timezone explicit
- [ ] Force rerun endpoint với mandatory reason min 20 chars
- [ ] Dashboard endpoint với trend computation
- [ ] FE: `/feedback/dashboard` 6 KPI cards với trend arrow
- [ ] FE: SS adjustment log table chart 12 weeks
- [ ] FE: LT drift table per NM với drift_count_after badge
- [ ] FE: Override analysis top 5 reasons bar chart
- [ ] FE: Drill-down per (CN, SKU) timeline
- [ ] FE: Phase 1 badges "Pending Phase 2" cho FC MAPE + grace period notes
- [ ] Alert M8: 6 alert types (SS_DRIFT, LT_DRIFT, FILL_RATE, NM_UNRELIABLE, SYSTEM_ACCURACY, FC_MAPE Phase 2)
- [ ] Audit log run + force_rerun + manual recompute
- [ ] Performance < 2 phút weekly run
- [ ] Feature flag wrapper — off → cron skip với log "M28 disabled"
- [ ] QA: 18 user stories pass

---

## 10b. Prerequisites — Cross-module contracts (CTO H1+H2 fix)

> **Quan trọng:** M28 phụ thuộc 4 contract changes ở module khác. BE1 verify Sprint 9 Day 1, escalate nếu chưa formalize.

| Contract | Module owner | Sprint phải xong | Lý do |
|----------|--------------|------------------|-------|
| **`M23.SsCnService.computeSsCnFormula(input): number`** — PURE function, KHÔNG side effect, KHÔNG ghi DB | M23 | Sprint 5 (M23 close) | **H1+H2 CTO v1.2 fix:** M28 Step 3 chỉ dùng pure compute — KHÔNG ghi ss_cn. M28 persist `sigma_history` thay thế. |
| **`M23.SsCnService.refresh(plan_run_id)`** — write-back service, đọc sigma_history mới nhất + tạo ss_cn row mới | M23 | Sprint 5 (M23 close) | **H2 CTO v1.2:** M23 nightly cycle gọi (KHÔNG M28 gọi). Tách bạch ownership: M28 publish sigma → M23 consume + write ss_cn |
| **M28 NEW table `sigma_history`** với index DESC for M23 lookup latest | M28 | Sprint 9 (M28 close) | **H1 v1.2:** Single source of truth σ_demand giữa M28 publisher + M23 consumer. |
| **`M00.LaneService.updateTransitLt(nmCode, cnCode, lt, actor)`** — gọi service, KHÔNG UPDATE trực tiếp | M00 | Sprint 2 (M00 close) | **C3 CTO fix:** Write-back ownership. M00 service nội bộ handle audit + drift gate. |
| **`transport_lane.transit_lt_days` + `lt_sigma` + `last_updated_by_m28` columns** | M00 m1 fix | Sprint 2 | **H2 CTO fix:** Schema thật transport_lane hiện có `lead_time_days`, KHÔNG có `transit_lt_days`. M00 minor m1 fix Sprint 2 đã ALTER thêm columns. M28 verify trước Sprint 9. |
| **`M9.PlanActualComparisonService.getActualVsPlanned(week, cn, sku)` hoặc query trực tiếp `plan_actual_comparison.actual_qty`** | M9 | Đã có | **C2 CTO fix:** σ_demand source DEMAND-side. Phase 1 fallback `demand_snapshot.qty` nếu chưa có actual. |
| **`M22.TrustService.refresh(cnId, weekStart)`** | M22 | Sprint 4 (M22 close) | R11 ownership write-back trust_score. |
| **`M26.HonoringRateService.recompute(month)`** | M26 | Sprint 7 (M26 close) | R11 ownership write-back nm_honoring_rate. |

**M28 BE1 Sprint 9 Day 1 action:**
1. Verify `M23.SsCnService.computeSsCnFormula()` pure public method exists
2. Verify `M00.LaneService.updateTransitLt()` exists; nếu thiếu → request M00 add (cùng pattern `autoUpdateLt`)
3. Verify `transport_lane.transit_lt_days` column tồn tại
4. Verify M22 + M26 service methods callable

---

## 11. Out of Scope

- **Real-time feedback** (intra-day) — Phase 1 weekly only
- **ML-based anomaly detection** trên KPI — Phase 2
- **Auto-tune M10 configs** dựa KPI — Phase 1 manual SC Manager review
- **Cross-tenant benchmark** — single tenant
- **Email/Slack notification** integration — Phase 2 (Phase 1 in-app M8 alerts)
- **Predictive forecasting** từ feedback — Phase 2
- **A/B testing rules** (test config A vs B) — Phase 2
- **Auto-promote NM** dựa honoring rate — Phase 1 chỉ flag, SC Manager quyết
- **Auto-deactivate trust < threshold CN** — Phase 1 chỉ alert

---

## 12. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| FC MAPE Phase 1 không có actual_sales — hiển thị thế nào? | NULL với badge xám "Pending actual_sales — Phase 2 unblock". KHÔNG hiển thị 0% gây nhầm. |
| SS adjust cap 50% — quá lỏng/chặt? | Theo PRD F2-B8 không có spec rõ, dùng 50% Phase 1 conservative. M10 config adjust được sau review 1 tháng. |
| Trust grace period unblock điều kiện? | Đủ 12 weeks actual data per CN. Phase 1 fallback dùng demand_snapshot. Phase 2 unblock thật khi actual_sales. |
| LT drift counter reset khi nào? | Khi delta ≤ 30% lần kế tiếp (auto-apply). Reset = 0 trong M00 service (M00 §11.3 logic). |
| Override analysis include TO edits? | Yes. Aggregate cả po_edit_log + to_edit_log. Phân biệt qua field `edit_type` trong analysis JSONB. |
| Honoring rate compute trigger từ M28 hay M26 cron? | M26 có cron riêng monthly Day 1. M28 weekly gọi `M26.recompute()` để backfill weekly. KHÔNG conflict. |
| Recompute single cell manual có giới hạn? | Phase 1 không giới hạn. Audit log mọi manual recompute. SC Manager dùng cẩn thận. |
| KPI history giữ bao lâu? | weekly_kpi_snapshot retention 2 năm (104 snapshots). Sau đó archive. M10 config `feedback.snapshot_retention_weeks=104`. |
| **[M1 CTO note] system_accuracy_pct là proxy header-level** | Phase 1 = `1 - (po_count_with_any_edit / total_po_count)`. KHÔNG weight theo số fields edited (1 PO edit 1 field = 1 PO edit 10 fields). Đây là proxy thô. Phase 2 weighted theo edit_field_count nếu cần. |
| **[M2 CTO] Dashboard drill-down data sources** | Per metric:<br>• Fill rate per CN×SKU: `po_line` JOIN `po_header` GROUP BY (cn, sku, week)<br>• Shortage timeline: `atp_check WHERE result='PARTIAL'` per (nm, sku, week)<br>• Adjustments history: `cn_demand_adjustment` audit log<br>• Override pattern: `po_edit_log + to_edit_log` GROUP BY reason<br>FE query qua endpoints `/feedback/dashboard/drill-down?metric=&cnId=&skuId=` — BE precompute 1 lần. |
| **[M3 CTO sweep round 2] Phase 1 source precedence cho σ_demand — chốt single rule** | **Precedence (deterministic, không lẫn):**<br>1. **Preferred:** `M9.plan_actual_comparison.actual_qty` (FORECAST_VS_ACTUAL type, last 12w) — DEMAND-side actual data từ M9<br>2. **Fallback:** `demand_snapshot.qty` (FC proxy) khi #1 không có data đủ 4w trong 12w window<br>3. **NEVER:** `actual_sales` Phase 1 chưa tồn tại (Phase 2 sẽ thêm precedence #1 trên cùng)<br>**Confidence flag:** Source #1 → `confidence='HIGH'` ghi vào sigma_history. Source #2 → `confidence='LOW'` + log alert "FC proxy used, low confidence". M23 nightly đọc sigma có thể skip nếu confidence='LOW' và delta lớn. |
| Step fail giữa pipeline (e.g. Step 4 LT crash) — toàn run rollback? | KHÔNG. Try/catch per step, log step status, continue next steps. Snapshot status='COMPLETED_PARTIAL' với errors[]. SC Manager review. |
| M28 disabled flag — closed loop ngừng → SS không update → DRP sai dần? | Yes, accepted risk. Alert "M28 disabled, manual SS review required". M10 monitor flag state. |
| Race condition: M28 weekly run trùng M23 nightly run cùng giờ? | M28 06:00 Monday, M23 23:15 nightly. Không trùng giờ. Nếu manual trigger trùng → M28 đọc snapshot M23 mới nhất, không conflict. |

---

## 13. Lưu ý cho dev

1. **Orchestration pattern** — `FeedbackService.runWeekly()` gọi 9 step services tuần tự, mỗi step wrap try/catch:
   ```typescript
   const errors = [];
   try { await ssAutoAdjust.run(snapshotId); } catch (e) { errors.push({step: 'SS', error: e.message}); }
   try { await ltAutoUpdate.run(snapshotId); } catch (e) { errors.push({step: 'LT', error: e.message}); }
   // ... 9 steps
   if (errors.length === 0) snapshot.status = 'COMPLETED';
   else snapshot.status = 'COMPLETED_PARTIAL';
   ```

2. **Separation of concerns (R11)** — M28 KHÔNG sửa trực tiếp `supplier.lead_time_days`, `trust_score`, `nm_honoring_rate`. Gọi service owner:
   - `M00.SupplierService.autoUpdateLt(nmId, newLt, 'M28_AUTO')`
   - `M22.TrustService.refresh(cnId, weekStart)`
   - `M26.HonoringRateService.recompute(month)`
   Lý do: business logic + audit + drift counter ở module owner. M28 chỉ trigger.

3. **σ_demand recompute** — query 12 weeks actual qua M9 `plan_actual_comparison.actual_qty` hoặc Phase 1 fallback `demand_snapshot.qty`. Aggregate STDDEV SQL:
   ```sql
   SELECT cn_id, sku_id, STDDEV(qty) AS sigma
   FROM (SELECT cn_id, sku_id, week_start, COALESCE(actual_qty, planned_qty) AS qty FROM ...)
   GROUP BY cn_id, sku_id;
   ```

4. **SS recompute reuse M23 service:**
   ```typescript
   const ssNew = await m23SsCnService.computeSsCnFormula({
     cnId, skuId, sigmaDemand: sigmaNew, ltHubDays: ..., zUsed: ..., lcnbReductionPct: ...,
   });
   // Compare with ss_cn latest, log delta
   ```
   M23 method `computeSsCnFormula()` phải pure function (KHÔNG ghi DB), trả về số. Đảm bảo M28 call được không side-effect.

5. **LT actual rolling 6 months:**
   ```typescript
   const ltActuals = await m27Service.getActualLtPerNmRoute(nmId, null, today.minus(6 months), today);
   const avg = ltActuals.reduce((a, b) => a + b, 0) / ltActuals.length;
   if (ltActuals.length >= 5) {  // min sample size
     await m00SupplierService.autoUpdateLt(nmId, avg, 'M28_AUTO');
   }
   ```
   Min sample size 5 PO để tránh outlier dominate.

6. **Override analysis SQL:**
   ```sql
   SELECT reason, COUNT(*) AS cnt
   FROM (
     SELECT reason FROM po_edit_log WHERE changed_at BETWEEN $start AND $end
     UNION ALL
     SELECT reason FROM to_edit_log WHERE changed_at BETWEEN $start AND $end
   )
   GROUP BY reason ORDER BY cnt DESC LIMIT 5;
   ```

7. **KPI snapshot Step 8 — dùng raw SQL aggregate, không loop service:**
   ```sql
   -- fill_rate
   SELECT SUM(actual_received_qty) / NULLIF(SUM(confirmed_qty), 0) AS rate
   FROM po_line WHERE po_header_id IN (SELECT id FROM po_header WHERE confirmed_at BETWEEN ...);
   -- system_accuracy
   SELECT 1 - (COUNT(DISTINCT po_header_id) FILTER (WHERE TRUE) FROM po_edit_log) /
              NULLIF((SELECT COUNT(*) FROM po_header), 0) AS pct
   ```

8. **Folder Rule 3 check:** NEW module → `src/feedback/` (kebab-case). KHÔNG đặt vào `src/monitor/` (M8 — đó là alerts). KHÔNG bọc `v2/`.

9. **Status transition matrix:**
   | Từ | → Cho phép | Ghi chú |
   |----|-----------|---------|
   | RUNNING | COMPLETED, COMPLETED_PARTIAL, FAILED | Normal |
   | COMPLETED/PARTIAL | (terminal) | Force rerun = snapshot mới |
   | FAILED | (retry = snapshot mới) | |

10. **M9 cross-link:** M9 `plan_actual_comparison` cho FORECAST_VS_ACTUAL Phase 1 dùng EXPORTED order_line proxy. M28 có thể đọc M9 để compute fill_rate alternative source. Phase 2 actual_sales unblock chính xác hơn.

11. **Trigger flag check** đầu cron — nếu flag off → log "M28 disabled" và return. Tránh chạy half-pipeline.

12. **Dashboard caching** — `weekly_kpi_snapshot` đã là cached results. Dashboard query trực tiếp table này, KHÔNG recompute on-the-fly.

---

*M28 Feedback & Closed Loop Spec v1.2 — 2026-04-17 (CTO sweep round 2: 2 high + 3 medium clean — SS write-back chốt qua sigma_history table mới + 2 method names tách bạch + Step 6 mode + US-7 wording + source precedence)*
