# M24 — Allocation Engine LCNB v2

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 5-6
> **Owner:** BE2 · **DA:** DA1 · **FE:** FE1
> **Status:** 🟡 EXTEND M5 (giữ engine cơ bản, thêm LCNB layer)
> **PRD:** §F2-B4 Allocation · **Flow:** 2 (Daily DRP, 23:30)
> **Domain:** D5 Allocation
> **Feature flag:** `m24_allocation_lcnb_enabled`
> **Folder (Rule 3):** `backend/src/allocation/` (EXTEND — file mới `allocation.lcnb.service.ts`)

---

## 1. Tại sao làm bài này

M5 hiện chỉ alloc 1-source per result (đã fix BUG-02 thành multi-leg schema). Nhưng logic LCNB (lateral transfer giữa CN) vẫn chưa có. Hậu quả:
- Khi Hub thiếu hàng, CN-DN stockout dù CN-BD cách 50km còn dư 2000m²
- Manual emergency transfer mất 2-3 ngày, qua nhiều cấp duyệt
- Không có rule nào tự động ưu tiên CN gần hơn

M24 thêm **LCNB Engine** với 5 tính năng:
1. **NEAREST_FIRST priority** — donor CN gần nhất transfer trước
2. **FIFO lot ordering** — lấy lot cũ trước (chống tồn lâu, chống expire)
3. **Fair-share** khi Hub không đủ → chia tỷ lệ cho CN cần
4. **SS guard** — không alloc quá `donor.on_hand - donor.SS_cn`
5. **Variant match** — alloc theo variant tồn kho thực tế CN nhận

Output: `allocation_result` + `allocation_leg` (per-source breakdown đã có từ BUG-02).

---

## 2. Scope

### ✅ Thêm
- LCNB Engine service (`allocation.lcnb.service.ts`)
- Distance lookup từ M00 `transport_lane(lane_type='CN_TO_CN', distance_km)`
- Donor candidate detection: query M23 `drp_cn_line` WHERE status='OVER_STOCK'
- Allocation pipeline mới: Hub → LCNB → STOCKOUT_FLAG
- M23 `getDrpResult()` integration với fallback chain
- Variant match logic dựa supply_snapshot variant breakdown
- Service `getAllocationResult(allocationRunId)` export cho M25 inject

### ❌ Không đụng
- M5 `allocation.service.ts` core — giữ làm fallback khi flag off
- `allocation_result`, `allocation_leg` schema (đã fix BUG-02 v2)
- M5 basic Hub→CN waterfall — M24 wrap thêm LCNB layer trước STOCKOUT_FLAG
- Transport routing — M25
- PO generation — M27

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | M24 chạy ngay sau M23 hoàn tất (chuỗi 23:30 VN). Trigger qua `M23Service.getDrpResult()` | Sequence |
| **R2** | **Allocation pipeline:** (1) Hub pool → CN demand. (2) Hub thiếu → LCNB từ donor CN. (3) Vẫn thiếu → flag STOCKOUT, M27 PO Review xử lý | 3-tier waterfall |
| **R3** | **Donor candidates** = drp_cn_line status='OVER_STOCK' (từ M23). Sorted theo NEAREST_FIRST từ recipient CN | M23 contract |
| **R4** | **NEAREST_FIRST**: query `transport_lane(lane_type='CN_TO_CN', from=donor, to=recipient).distance_km`. Sort ASC. | M00 lane_type fix |
| **R5** | **Max LCNB distance** (M10 config `lcnb.max_distance_km`, default 500km) → quá xa → skip donor, fallback Hub pool re-pool hoặc STOCKOUT | Skip far donors |
| **R6** | **Min excess threshold** (M10 `lcnb.min_excess_threshold`, default 50 units) → donor có excess < 50 → skip (không kinh tế chuyển) | Avoid micro-transfer |
| **R7** | **Max transfer pct** (M10 `lcnb.max_transfer_pct`, default 80%) → donor giữ tối thiểu 20% buffer của excess | Donor protection |
| **R8** | **SS guard cứng**: `available_to_transfer = max(0, donor.on_hand - donor.ss_cn_final - donor.in_transit_reserved)`. KHÔNG bao giờ alloc vượt SS donor | Hard constraint |
| **R9** | **FIFO lot ordering**: trong cùng donor, alloc lot cũ trước (sort `lot_attribute.received_date ASC`). Ghi `fifo_rank` vào allocation_leg | Anti-aging |
| **R10** | **Fair-share** khi Hub pool < tổng demand: alloc theo tỷ lệ `recipient.demand / Σ all demands`. KHÔNG ưu tiên CN nào | Fairness Phase 1 |
| **R11** | **Variant match**: nếu recipient yêu cầu SKU base GA-300 với suggestion {A4: 400, B2: 200}, alloc lookup variant tồn donor → match A4/B2 trước, mismatch → fallback Planner manual M27 | Best-effort |
| **R12** | **Policy snapshot pin** (Rule 14): M24 đọc config từ `policy_run.config_snapshot` (pinned bởi M23), KHÔNG runtime M10. Đảm bảo M24 dùng cùng baseline với M23 | Hard rule |
| **R13** | **Idempotent**: 1 allocation_run per plan_run. Re-run cùng plan_run → reject 409 trừ khi force re-run với reason | Avoid duplicate |
| **R14** | **LCNB enabled flag** (M10 `lcnb.enabled`): nếu OFF → M24 skip LCNB layer, chỉ Hub→CN (giống M5 cũ) | Phase rollback |

---

## 4. Allocation Pipeline (per run)

```
Step 1: Validate (M23 plan_run COMPLETED, R13 idempotent, M10 flag check)
Step 2: Load policy_run snapshot (Rule 14 pin từ M23)
Step 3: Create allocation_run với plan_run_id + policy_run_id
Step 4: Load demand from M23 drp_cn_line (status IN NORMAL, STOCKOUT_RISK)
Step 5: Load donors from M23 drp_cn_line (status='OVER_STOCK')
Step 5.5 [C3 fix] Fair-share pre-compute (R10):
         For each SKU: if hub_available[sku] < Σ_CN(net_demand[cn][sku]):
           fair_share_quota[cn][sku] = hub_available[sku] × (net_demand[cn][sku] / Σ net_demand[sku])
         Else: fair_share_quota[cn][sku] = net_demand[cn][sku]  // Hub đủ → không cap
         Bắt buộc tính TRƯỜC khi loop per-cell — đảm bảo fairness (không thể re-distribute sau khi đã alloc)
Step 6: For each (CN, SKU) cell có net_demand > 0:
        a. Try Hub pool first — alloc_from_hub = min(fair_share_quota[cn][sku], hub_available[sku])
           - hub_available[sku] -= alloc_from_hub
           - Insert allocation_result + leg(source_type='HUB')
        b. remaining = net_demand - alloc_from_hub > 0? → Try LCNB
           - Sort donors by NEAREST_FIRST (R4)
           - Filter R5 (distance), R6 (min excess), R7 (max transfer pct), R8 (SS guard)
           - For each donor: alloc up to available_to_transfer
             - Insert leg(source_type='CN_REDIST', source_entity_id=donorCnId, distance_km)
             - Apply FIFO (R9): split by lot, fifo_rank
        c. Vẫn thiếu? → flag status='PARTIAL_STOCKOUT'
        d. Variant match (R11): alloc per variant proportional, mismatch → planner_review_required=TRUE
Step 7: Reconcile result.qty_allocated = SUM(legs.allocated_qty) (BUG-02 fix)
Step 8: allocation_run.status='COMPLETED' → trigger M25
```

**Run time target:** < 3 phút cho 25K cells (sau M23 5 phút).

---

## 5. User Stories (Acceptance)

### US-1: Happy Hub-only allocation
**Given** Hub có đủ hàng cho mọi CN demand. **When** M24 run. **Then** mỗi result có 1 leg `source_type='HUB'`. Không có LCNB legs.

### US-2: LCNB nearest priority
**Given** CN-DN cần GA-300 = 800m². Hub thiếu 300m². Donors: CN-BD excess 500m² distance 50km, CN-CT excess 600m² distance 200km. **When** M24 run. **Then** 500m² Hub + 300m² CN-BD (nearest first), CN-CT skip. 2 legs cho result CN-DN.

### US-3: Max distance skip
**Given** CN-DN cần 200m². Donor CN-HN distance 1500km (> 500km max). **When** M24 run. **Then** CN-HN skip dù còn excess. Result `STOCKOUT_RISK` flag, M27 review.

### US-4: SS guard
**Given** CN-BD on_hand=2000, SS=500, in_transit_reserved=200. Available_to_transfer = 2000-500-200=1300. CN-DN cần 1500. **When** alloc. **Then** chỉ lấy 1300 từ CN-BD. Còn 200 → next donor hoặc STOCKOUT.

### US-5: Min excess skip
**Given** CN-BT excess 30m² (< 50 min threshold). **When** evaluate donor. **Then** skip — không kinh tế chuyển.

### US-6: Max transfer pct
**Given** CN-CT excess 1000m² (max transfer 80% = 800m²). CN-DN cần 1500m². **When** alloc. **Then** lấy 800 từ CN-CT (giữ 200 buffer), tiếp donor next.

### US-7: FIFO lot
**Given** CN-BD donor 3 lots: Lot-A 200m² received 2026-03-01, Lot-B 300m² received 2026-04-01, Lot-C 100m² received 2026-04-15. CN-DN cần 400m². **When** alloc. **Then** Lot-A 200 (fifo_rank=1) + Lot-B 200 (fifo_rank=2). Lot-C giữ.

### US-8: Fair-share Hub thiếu
**Given** Hub có 600m² SKU-X. CN-DN cần 500, CN-BD cần 400, CN-CT cần 300 (total 1200). **When** Hub không đủ. **Then** alloc proportional: CN-DN=250, CN-BD=200, CN-CT=150 (theo tỷ lệ 5:4:3). Phần còn lại tìm LCNB.

### US-9: Variant match
**Given** CN-DN net GA-300 = 600m², variant suggestion {A4: 400, B2: 200}. Hub có A4=500, B2=100. **When** alloc. **Then** A4=400 (đủ), B2=100 (thiếu 100). Mismatch flag → `planner_review_required=TRUE`, suggestion variant alternative.

### US-10: Variant fallback Planner
**Given** US-9 thiếu B2. LCNB CN-CT có B2=200. **When** alloc. **Then** B2 100 từ CN-CT (sau khi qua R4-R8 checks). Nếu vẫn thiếu → suggestion C1 alternative (variant cùng SKU base) → Planner M27 quyết.

### US-11: STOCKOUT_RISK fallback
**Given** Hub + LCNB + variant fallback đều thiếu. **When** alloc. **Then** result.status='PARTIAL_STOCKOUT', alert M8, M27 PO Review tạo PO khẩn từ NM.

### US-12: LCNB flag off
**Given** M10 `lcnb.enabled=false`. **When** M24 run. **Then** skip LCNB layer hoàn toàn, chỉ Hub→CN (giống M5 cũ). Log "LCNB disabled, fallback Hub-only".

### US-13: Policy pin (Rule 14)
**Given** M23 plan_run pinned policy_run với `lcnb.max_distance=500`. SC Manager đổi config 500→300 lúc 23:35 (giữa M24 run). **When** M24 đọc. **Then** vẫn dùng 500 từ snapshot. Đổi mới áp dụng cycle sau.

### US-14: M23 chưa COMPLETED
**Given** M24 trigger 23:30 nhưng M23 status='RUNNING'. **When** call `getDrpResult()`. **Then** throw `PlanRunNotCompletedException`. M24 retry sau 30s, max 5 lần. Vẫn fail → fallback M5 cũ + alert.

### US-15: Idempotent reject
**Given** allocation_run cho plan_run_id=42 đã COMPLETED. **When** trigger M24 lại. **Then** 409 "Allocation đã chạy. Force re-run cần mandatory reason."

### US-16: M25 đọc kết quả
**Given** allocation_run.status='COMPLETED'. **When** M25 init. **Then** gọi `M24Service.getAllocationResult(allocationRunId)` → trả Map per (CN, SKU) với legs breakdown.

---

## 6. Data Contract

### `allocation_run` extend (giữ M5 schema)
| Field thêm | Mô tả |
|------------|-------|
| `plan_run_id` BIGINT FK plan_run | Link M23 source |
| `policy_run_id` BIGINT FK policy_run | Rule 14 pin (cùng với M23) |
| `lcnb_enabled` BOOLEAN | Snapshot từ policy_run lúc run |
| `total_legs_count` INT | Stats: total legs created |
| `lcnb_transfers_count` INT | Stats: legs với source_type='CN_REDIST' |
| `partial_stockout_count` INT | Cells với status='PARTIAL_STOCKOUT' |
| `is_force_rerun` BOOLEAN DEFAULT FALSE | |
| `force_rerun_reason` TEXT NULL | Mandatory khi force |
| `status` ENUM extend | Thêm: `BLOCKED_M23_NOT_READY` |

### `allocation_result` extend (giữ BUG-02 schema)
| Field thêm | Mô tả |
|------------|-------|
| `planner_review_required` BOOLEAN DEFAULT FALSE | True khi variant mismatch hoặc partial stockout |
| `review_reason` VARCHAR(50) NULL | `VARIANT_MISMATCH / PARTIAL_STOCKOUT / LCNB_FAR_DONOR` |
| `status` ENUM | `FULL / PARTIAL / PARTIAL_STOCKOUT / UNALLOCATED` |

### `allocation_leg` (giữ nguyên BUG-02 schema, đã có) + M25 cross-link extend
- Base columns: `allocation_result_id, source_type, source_entity_id, source_lot_id, allocated_qty, fifo_rank, distance_km`
- **[M25 C2 cross-link]** Thêm column nullable `source_period_start DATE NULL` — dùng cho top-up từ tuần forecast khác (xem M25 §6b)
- **[M25 C2 cross-link]** Thêm column nullable `origin_top_up_id BIGINT NULL FK top_up_suggestion` — audit link về suggestion gốc
- M24 dùng đầy đủ các fields:
  - `source_type='HUB'` → source_entity_id=`HUB_VIRTUAL_ID` (**constant = 0**, định nghĩa tại `common/allocation-constants.ts`). Phase 2: đổi thành hub_id thật khi M16 live. **[M7 fix]** — tránh magic number, mọi chỗ reference đều import constant này.
  - `source_type='CN_REDIST'` → source_entity_id=donorCnId, distance_km from transport_lane
  - `source_type='NM'` → reserved cho M27 PO Review (Phase 2)
  - **`source_type='TOP_UP_NEXT_WEEK'`** **[M25 C2 fix]** → leg created bởi M25 khi SC Manager accept top-up. Source là forecast period khác (`source_period_start` non-null). KHÔNG mutate alloc_result của run hiện tại — chỉ INSERT leg mới. M28 audit "ship sớm hơn forecast period bao nhiêu tuần".

### `allocation_leg` migration micro-update (M25 cross-link)

```sql
-- Cập nhật ENUM check (nếu schema dùng CHECK constraint thay TypeORM ENUM)
ALTER TABLE allocation_leg DROP CONSTRAINT IF EXISTS check_source_type;
ALTER TABLE allocation_leg ADD CONSTRAINT check_source_type
  CHECK (source_type IN ('HUB', 'CN_REDIST', 'NM', 'TOP_UP_NEXT_WEEK', 'UNKNOWN'));

-- Thêm columns cho top-up trace
ALTER TABLE allocation_leg ADD COLUMN IF NOT EXISTS source_period_start DATE NULL;
ALTER TABLE allocation_leg ADD COLUMN IF NOT EXISTS origin_top_up_id BIGINT NULL;
-- FK origin_top_up_id REFERENCES top_up_suggestion(id) — add sau khi M25 deploy xong table top_up_suggestion
```

### API chính

```
# Run lifecycle
POST  /api/v1/allocation/v2/run                       # Trigger từ M23 callback (cron + manual)
POST  /api/v1/allocation/v2/run/force-rerun           # Force rerun với reason
GET   /api/v1/allocation/v2/runs?planRunId=&limit=    # List runs
GET   /api/v1/allocation/v2/runs/:id                  # Detail + summary stats

# Result query
GET   /api/v1/allocation/v2/runs/:id/results?cnId=&status=  # allocation_result + nested legs
GET   /api/v1/allocation/v2/runs/:id/legs?sourceType=        # allocation_leg detail
GET   /api/v1/allocation/v2/runs/:id/lcnb-summary             # Stats: # transfers per CN pair, total km

# Review queue
GET   /api/v1/allocation/v2/runs/:id/review-required          # planner_review_required=TRUE rows

# Internal (M25 inject)
# Method: M24Service.getAllocationResult(allocationRunId): AllocationResultDto
```

**Folder structure:**
```
backend/src/allocation/
├── allocation.service.ts                ← M5 cũ (giữ làm fallback)
├── allocation.lcnb.service.ts           ← M24 LCNB engine
├── allocation.fair-share.service.ts     ← Fair-share helper
├── allocation.variant-match.service.ts  ← Variant match logic
├── allocation.controller.ts             ← Cả M5 + M24 routes
└── entities/
    ├── allocation-run.entity.ts          ← extend
    ├── allocation-result.entity.ts       ← extend
    └── allocation-leg.entity.ts          ← BUG-02 v2 (đã có)
```

---

## 7. Trigger & Cron

M24 KHÔNG có cron riêng. Trigger qua:

| Trigger | Source |
|---------|--------|
| **Auto** | M23 cron 23:15 → DRP COMPLETED → callback M24 service `triggerFromDrp(planRunId)` |
| **Manual** | SC Manager click "Run allocation" trên FE — chỉ dùng khi M23 manual rerun |
| **Retry** | Internal: nếu M23 chưa COMPLETED, retry 30s × 5 lần |

> Không cron `@Cron` riêng → tránh race condition với M23. M23 controller wrap dispatch event sau khi COMPLETED.

---

## 8. Non-functional

- Allocation run < **3 phút** cho 25K cells
- LCNB sort donors per (CN, SKU) < 100ms (cache distance lookup in-memory)
- Result query < 2s với pagination 100 rows + nested legs
- Bulk insert allocation_result + legs: chunk 500 (đã có pattern BUG-02)

---

## 9. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `transport_lane(lane_type='CN_TO_CN', distance_km)` | NEAREST_FIRST sort |
| **M00 minor m1 fix** lane_type column | Đã ALTER trong M00 Sprint 2 |
| **M10** policy_run snapshot configs (qua M23) | Rule 14 pin |
| **M10** feature flag `m24_allocation_lcnb_enabled` | Rollback |
| **M23** `getDrpResult(planRunId)` | Demand input + donor candidates |
| **M23** `policy_run` snapshot | Rule 14 pin reuse |
| **M2/M21** `supply_snapshot` per (CN, SKU) | on_hand + in_transit |
| **M2** `lot_attribute.received_date` | FIFO sort |

| Feeds | Why |
|-------|-----|
| **M25 Transport** | `getAllocationResult(allocationRunId)` injectable |
| **M27 PO Review** | review_required rows → manual review queue |
| **M28 Feedback** | LCNB stats: # transfers, distance avg, fairness metric |
| **M8 Alerts** | PARTIAL_STOCKOUT > 0, LCNB transfer > N km (cost alert) |

---

## 10. DoD

- [ ] `allocation_run` + `allocation_result` migration extend (7+3 columns) + .down.sql
- [ ] Reuse `allocation_leg` schema BUG-02 v2 (đã có, không tạo lại)
- [ ] **[C4 fix] Idempotent guard 2 tầng:** (1) Primary: partial UNIQUE INDEX `allocation_run(plan_run_id)` WHERE `is_force_rerun=FALSE` — ngăn 2 runs cho cùng 1 plan_run; (2) Secondary: UNIQUE `allocation_result(allocation_run_id, cn_id, sku_id)` — ngăn duplicate result rows trong 1 run
- [ ] LCNB engine service với 5 rules (R4-R8) đầy đủ
- [ ] Distance lookup preload in-memory từ transport_lane (CN×CN matrix)
- [ ] FIFO lot ordering qua join lot_attribute
- [ ] Fair-share service khi Hub thiếu
- [ ] Variant match service với fallback alternative
- [ ] Policy snapshot pin reuse từ M23 (R12)
- [ ] M23 fallback chain với 5x retry 30s + final fallback M5
- [ ] LCNB flag off → bypass to M5 logic (R14)
- [ ] Force rerun endpoint với mandatory reason min 20 chars
- [ ] `getAllocationResult(allocationRunId)` injectable cho M25
- [ ] Performance: < 3 phút cho 25K cells
- [ ] FE: Run history list + detail view với LCNB stats card
- [ ] FE: allocation_result table với expand drill-down legs
- [ ] FE: LCNB visualization (donor → recipient với distance + qty)
- [ ] FE: Review queue cho planner_review_required rows
- [ ] Alert M8: PARTIAL_STOCKOUT > 0, LCNB total km > threshold
- [ ] Audit log run + force_rerun
- [ ] Feature flag wrapper — off → 503; M23 callback skip M24, fallback M5

---

## 11. Out of Scope

- **Cost-optimal allocation** (transport cost minimization) — Phase 2
- **Multi-Hub physical allocation** — Phase 1 hub ảo gross mode
- **Real-time re-allocation** (intra-day) — Phase 1 chỉ daily 23:30
- **NM direct allocation** (skip Hub) — M27 emergency PO
- **ABC class priority weighting** (alloc A trước B,C) — Phase 2
- **CN priority business rule** (e.g. CN khu vực Nam ưu tiên hơn) — Phase 2
- **Alternative variant suggestion smart** (ML-based) — Phase 2
- **Reserve allocation** (book future weeks) — Phase 2

---

## 12. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| Performance 3 phút cho 25K cells khả thi? | Yes nếu: (1) preload distance matrix CN×CN 1 lần (~50²=2500 entries), (2) preload supply snapshot grouped by (CN, SKU), (3) compute in-memory với Map. BE2 spike Sprint 5 Day 1. |
| Fair-share Phase 1 simple proportional có đủ? | Yes Phase 1. Phase 2 weighted fair-share theo trust score / criticality / ABC class. |
| Variant fallback alternative — logic thế nào? | Phase 1: nếu A4 thiếu, suggest B2 nếu cùng SKU base + tồn kho có. Phase 2: ML model match variant gần nhất theo attrs. |
| Distance lookup miss (transport_lane chưa seed) | Skip donor đó + log warning. M00 Sprint 2 phải seed đủ NM×CN + CN×CN trong 500km (đã có note SUPPLIER-PK-DEVIATION). |
| Hub ảo Phase 1 over-allocation risk? | M24 enforce SS guard cứng (R8). Donor.on_hand được trừ dần trong run loop để không double-alloc cùng tồn kho. |
| FIFO khi không có lot_attribute data | Fallback: alloc tất cả theo donor.on_hand tổng, fifo_rank=NULL. Log warning. M28 cần backfill lot data Phase 2. |
| LCNB transfer cost? | Phase 1 KHÔNG track cost. Chỉ track distance + qty. Phase 2 tính `cost = qty × distance × cost_per_km` và optimize. |
| M23 retry 5 lần × 30s = 2.5 phút lock M24 | Acceptable Phase 1 (DRP run thường < 5 phút). Nếu fail → fallback M5 + alert SC Manager. |
| **[C4 fix]** Idempotent key? | **Primary guard:** partial UNIQUE INDEX `allocation_run(plan_run_id)` WHERE `is_force_rerun=FALSE`. **Secondary guard:** UNIQUE `allocation_result(allocation_run_id, cn_id, sku_id)`. Force rerun: `is_force_rerun=TRUE` + mandatory `force_rerun_reason` (min 20 chars) — không bị block bởi UNIQUE index. |

---

## 13. Lưu ý cho dev

1. **`getAllocationResult(allocationRunId)` injectable** — M25 inject trực tiếp. Trả `AllocationResultDto`: `{ allocationRunId, planRunId, generatedAt, results: Map<"cn_id|sku_id", AllocationCellDto> }` với mỗi cell có nested legs[]. Throw `AllocationRunNotCompletedException` nếu chưa COMPLETED.

2. **Policy snapshot reuse** — M24 KHÔNG tạo policy_run mới. Dùng `policy_run_id` từ M23 plan_run:
   ```typescript
   const planRun = await m23Service.getPlanRun(planRunId);
   const policySnapshot = await this.dataSource.query(
     `SELECT config_snapshot FROM policy_run WHERE id = $1`,
     [planRun.policyRunId]
   );
   const lcnbConfig = policySnapshot.config_snapshot.lcnb;  // {enabled, max_distance_km, ...}
   ```

3. **Distance matrix preload:**
   ```typescript
   const distanceMap = new Map<string, number>();
   const lanes = await this.dataSource.query(
     `SELECT from_location, to_location, distance_km
      FROM transport_lane
      WHERE lane_type='CN_TO_CN' AND distance_km <= $1`,
     [lcnbConfig.max_distance_km]
   );
   for (const l of lanes) distanceMap.set(`${l.from_location}|${l.to_location}`, l.distance_km);
   // Lookup O(1) trong loop chính
   ```

4. **Donor available tracking** — mỗi alloc trong loop trừ ngay donor's `on_hand_remaining`:
   ```typescript
   const donorRemaining = new Map<string, number>();
   // init from supply_snapshot
   for (const cell of cellsToAllocate) {
     for (const donor of sortedDonors) {
       const available = donorRemaining.get(donorKey) - donor.ssCnFinal - donor.inTransit;  // [M6 fix] Phase 1: inTransit = supply_snapshot.in_transit_qty. Phase 2: thêm reserved PO qty khi có bảng reservation
       const transferQty = Math.min(neededQty, available, donor.excessQty * 0.8);
       if (transferQty < lcnbConfig.min_excess_threshold) continue;
       donorRemaining.set(donorKey, donorRemaining.get(donorKey) - transferQty);
       // insert leg
     }
   }
   ```
   Critical: KHÔNG re-query DB per cell — preload + in-memory tracking.

5. **FIFO sort within donor:** `lot_attribute.received_date ASC`. Nếu không có lot data → fifo_rank=NULL, alloc theo total on_hand.

6. **[M5 fix] Variant match algorithm — loop level:**
   M24 loop ở level **SKU base** (1 row per CN×SKU base trong drp_cn_line). Variant split là post-process **sau** khi xác định `alloc_qty_base` xong ở Step 6a-6c.
   ```
   // Step 6d: post-process per (CN, SKU base)
   // alloc_qty_base đã tính xong từ Step 6a-6c
   variant_suggestion = drp_cn_line.variant_suggestion (JSONB từ M23)
   total_suggestion_qty = SUM(variant_suggestion.values)
   For each variant in suggestion:
     variant_alloc = alloc_qty_base × (suggestion_qty / total_suggestion_qty)
     try alloc from supply variant matching (Hub hoặc CN donor)
     if shortage:
       try LCNB donor variant matching
       if still shortage: planner_review_required=TRUE, review_reason='VARIANT_MISMATCH'
   ```

7. **M23 callback pattern** — M23 controller sau khi COMPLETED phát event `DrpRunCompletedEvent`. M24 service @OnEvent listener trigger run. Không dùng cron riêng để tránh race condition.

8. **Reuse `_bulkInsertLegs` từ BUG-02** — pattern đã có sẵn trong allocation.service.ts. M24 chỉ cần generate `legRows[]` đúng schema và gọi.

9. **Alert thresholds:**
   - PARTIAL_STOCKOUT count > 0 → severity WARNING
   - PARTIAL_STOCKOUT count > 5% total cells → severity CRITICAL
   - LCNB total km > 5000 km / run → cost alert (chuẩn bị Phase 2 cost optimization)

10. **Folder Rule 3 check:** EXTEND `src/allocation/`. File mới `allocation.lcnb.service.ts` (capability suffix lcnb). KHÔNG tạo `src/allocation-v2/` hoặc `src/lcnb/`.

---

*M24 Allocation Engine LCNB v2 Spec v1.0.1 — 2026-04-17 (micro-update: allocation_leg ENUM source_type thêm 'TOP_UP_NEXT_WEEK' + 2 columns audit per M25 C2 cross-link)*
