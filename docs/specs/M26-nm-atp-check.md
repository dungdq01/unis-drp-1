# M26 — NM ATP Check & Urgency Ranking

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 5-7 (parallel với M24/M25, BE2)
> **Owner:** BE2 · **DA:** DA2 · **FE:** FE1
> **Status:** 🔴 NEW — folder mới `src/nm-atp/`
> **PRD:** §F2-B6 NM ATP Check · **Flow:** 2 (Daily DRP, ~00:00 sau M24)
> **Domain:** D3 Supply Intake (cùng M21)
> **Feature flag:** `m26_nm_atp_enabled`
> **Folder (Rule 3):** `backend/src/nm-atp/` (NEW, kebab-case)
> **Changelog v1.1 (CTO review):** Fix C1 (NM lineage qua sku_nm_mapping), C2 (ATP source line-level supply_snapshot_line), C3 (CRITICAL formula HSTK<LT đúng PRD), C4 (honoring formula = actual/ATP_at_check không phải actual/requested), H1 (STALE→BLOCKED không FAIL), H2 (status matrix bổ sung BLOCKED_STALE), H3 (threshold <80%/3 months đúng PRD), H4 (M21 service contract bổ sung), H5 (API input contract), H6 (ATP_NULL_FALLBACK split warning_flag), H7 (top-up cross-link clarify), M1-M4 medium.

---

## 1. Tại sao làm bài này

Hôm nay khi M27 generate PO gửi NM, không có gate kiểm tra NM thật sự có đủ hàng (ATP — Available To Promise) hay không. Hậu quả:
- Gửi PO 5000m² SKU-X cho Mikado, Mikado chỉ có 3000m² → PO bị partial fulfilled muộn → CN-DN stockout
- Không có cách nào ưu tiên CN nào nhận hàng trước khi NM thiếu (PARTIAL scenario)
- Không track NM honoring rate → SC Manager không biết NM nào reliable

M26 thêm:
1. **ATP Gate** trước M27 — PASS/PARTIAL/FAIL check per NM × SKU × week
2. **Urgency Ranking** khi PARTIAL — CN có HSTK thấp nhất được ưu tiên nhận hàng
3. **NM Honoring Rate** tracking — `fulfilled / atp_at_check` rolling 3 months (đúng PRD F2-B6/F2-B8) để evaluate NM performance
4. **Freshness gate inject** từ M21 — NM data stale → tự động **BLOCKED** (semantics khác FAIL — chưa được phép kết luận, không đồng nghĩa NM không có hàng)

---

## 2. Scope

### ✅ Thêm
- 2 bảng mới: `atp_check`, `nm_honoring_rate`
- ATP service: PASS/PARTIAL/FAIL classification + urgency ranking
- Honoring rate cron monthly (1st of month)
- M24 callback event listener (`AllocationRunCompleted` → trigger ATP check parallel với M25)
- Service `getAtpResult(allocationRunId)` export cho M27 inject (M2 fix — match idempotency primary key)
- M00 supplier profile expose honoring_rate column

### ❌ Không đụng
- M2/M21 supply_snapshot — chỉ READ, ATP qty đọc từ NM upload
- M27 PO logic — M26 chỉ output gate, M27 quyết generate PO hay block
- Auto-negotiate với NM — Phase 2 (Phase 1 manual SC Manager)
- ATP forecast (NM future capacity) — Phase 2

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | M26 chạy **parallel** với M25 sau M24 COMPLETED. Cả 2 cùng đọc M24 output, không phụ thuộc nhau. M27 chờ cả 2 done | Parallel |
| **R2** | **ATP classification (H1 CTO fix — split STALE thành BLOCKED):** <br>• PASS: `atp_qty >= requested_qty` (NM đủ hàng)<br>• PARTIAL: `0 < atp_qty < requested_qty` (NM thiếu, có 1 phần)<br>• FAIL: `atp_qty = 0` (NM thực sự không có hàng — declarative)<br>• **BLOCKED**: M21 freshness fail (data stale, chưa được phép kết luận) — semantics khác FAIL | Core formula |
| **R3** | **Freshness gate inject** (M21): nếu NM `last_synced_at` > threshold → result='BLOCKED' với reason='STALE_DATA' bất kể atp_qty. M27 KHÔNG release PO cho cells BLOCKED. Sync NM trước. | Hard gate (BLOCKED, KHÔNG FAIL) |
| **R4** | **Urgency ranking khi PARTIAL** — sort recipients (CN cần hàng từ NM này) theo `recipient.HSTK days_supply` ASC. CN HSTK thấp nhất nhận trước | Stockout-first |
| **R5** | **CRITICAL flag (C3 CTO fix — đúng PRD F2-B6):** CN có `hstk_days < transit_lt_days_from_NM` → priority='CRITICAL'. Lý do: nếu HSTK còn ít hơn transit LT thì CN sẽ stockout TRƯỚC khi NM kịp giao → cần ưu tiên cao nhất. **KHÔNG so HSTK (days) với SS_cn (qty)** — sai dimension. | Emergency |
| **R6** | **Allocation cap khi PARTIAL:** waterfall theo urgency rank, total alloc = `atp_qty`. CN xếp sau atp_qty không nhận → flag `unfulfilled_qty` cho M27 emergency PO khác | Fair-stockout-first |
| **R7** | **NM Honoring Rate (C4 CTO fix — đúng PRD F2-B6/F2-B8):** `rate = SUM(actual_delivered) / SUM(atp_at_check_time) × 100` per NM. **KHÔNG dùng SUM(requested)** — sẽ phạt NM vì requested cao mà không phải vì NM thất hứa. Đo theo điều NM đã promise tại ATP check (atp_qty cell tương ứng PASS/PARTIAL).<br>Rolling **3 months** (theo PRD), tính weekly từ M28 (snapshot vào nm_honoring_rate). | Performance metric |
| **R8** | **Honoring threshold alert (H3 CTO fix — đúng PRD):** rate < 80% rolling 3 months → flag NM unreliable + alert WARNING. KHÔNG dùng 70%/50% monthly (lệch PRD). | NM evaluation |
| **R9** | **Policy snapshot pin** (Rule 14): M26 reuse `policy_run_id` từ M24/M23. Configs (e.g. ATP threshold) đọc từ snapshot | Hard rule |
| **R10** | **Idempotent**: 1 atp_run per allocation_run. Re-run → 409 trừ khi force | Avoid duplicate |
| **R11** | **ATP qty source (C2 CTO fix)**: Phase 1 = `supply_snapshot_line.atp_qty` LINE-LEVEL (NM upload qua M21 template, column ssl.atp_qty). Phase 2: real-time NM Portal API. Nếu `ssl.atp_qty IS NULL` → fallback `ssl.allocatable_qty` + flag `is_atp_null_fallback=TRUE` (warning, không reason) | Data source |
| **R13** | **Top-up cross-link (H7 CTO fix — clarify ownership)**: M25 top-up tạo NEW `allocation_result` với `is_top_up=TRUE` trong CÙNG allocation_run (xem M25 §6b H1 fix). M26 scan từ `getAllocationResult(allocationRunId)` — sẽ bao gồm cả top-up rows. ATP cell cho top-up: `period_start = allocation_result.source_period_start` (không phải run period). M27 đọc atp_check theo period này để generate PO line `is_top_up=TRUE`. | Top-up scope |

---

## 4. ATP Pipeline

```
Step 1: Validate (M24 allocation_run COMPLETED, R10 idempotent, M10 flag check)
Step 2: Reuse policy_run_id từ M24 (Rule 14 pin)
Step 3: Create atp_run với allocation_run_id + policy_run_id
Step 4: Load requested per (NM, SKU, week) — **C1 fix: NM lineage qua sku_nm_mapping**
        Vì M24 hiện tại source_type='HUB' dùng HUB_VIRTUAL_ID=0 (không có NM lineage trực tiếp),
        và source_type='NM' reserved Phase 2 → M26 phải resolve NM qua single-source mapping (M00):

        SELECT m.nm_id, leg.sku_id, result.period_start, SUM(leg.allocated_qty) AS requested_qty
        FROM allocation_leg leg
        JOIN allocation_result result ON result.id = leg.allocation_result_id
        JOIN sku_nm_mapping m ON m.sku_id = leg.sku_id AND m.active = TRUE   -- single-source
        WHERE leg.allocation_run_id = $aId
          AND leg.source_type IN ('HUB', 'NM', 'TOP_UP_NEXT_WEEK')           -- M1 fix SQL syntax + H7 include top-up
          AND result.is_top_up IS NOT TRUE OR (result.is_top_up = TRUE AND ...)  -- top-up cells dùng source_period_start
        GROUP BY m.nm_id, leg.sku_id, result.period_start;

        -- LCNB CN_REDIST skip (R12): trao đổi nội bộ không cần NM ATP
        -- Top-up legs (TOP_UP_NEXT_WEEK): period_start = source_period_start (M25 cross-link)

Step 5: For each (NM, SKU, week) cell:
        a. **H1 fix — Check M21 freshness**: NM stale → result='BLOCKED', reason='STALE_DATA', skip M27
           (KHÔNG phải FAIL vì FAIL = NM thực sự không có hàng;
            BLOCKED = chưa được phép kết luận vì data stale → M27 không release PO)
        b. **C2 fix — Load atp_qty từ LINE-LEVEL** (supply_snapshot_line):
           SELECT atp_qty FROM supply_snapshot_line ssl
           JOIN supply_snapshot ss ON ss.id = ssl.snapshot_id
           WHERE ssl.location_code = (SELECT factory_code FROM supplier WHERE id = $nm_id)
             AND ssl.item_code = (SELECT sku_code FROM sku WHERE id = $sku_id)
             AND ss.captured_at = (SELECT MAX(captured_at) FROM supply_snapshot WHERE nm_id = $nm_id)
           -- ATP qty là column ssl.atp_qty (NEW từ M21 NM upload template)
           -- Phase 1 nếu ssl.atp_qty IS NULL → fallback ssl.allocatable_qty + warning_flag (H6)
        c. Classify (R2):
           - atp_qty >= requested → PASS
           - 0 < atp_qty < requested → PARTIAL
           - atp_qty = 0 → FAIL, reason='ZERO_STOCK'
        d. INSERT atp_check row
Step 6: For PARTIAL cells: compute urgency ranking
        - List recipient CNs (từ allocation_leg JOIN allocation_result cho cell này)
        - For each CN: lookup HSTK days từ M8 service + transit_lt_days từ transport_lane(NM_TO_CN)
        - Mark CRITICAL nếu hstk_days < transit_lt_days (C3 fix — đúng PRD F2-B6)
        - Sort theo (is_critical DESC, hstk_days ASC, cn_code ASC tie-break — M3 fix)
        - Waterfall alloc atp_qty → recipients theo rank đến hết
        - Save urgency_rank JSONB vào atp_check
Step 7: atp_run.status='COMPLETED' → notify M27 (run vẫn COMPLETED dù có cells BLOCKED — H2 fix)
```

**Run time target:** < 1 phút cho 5 NM × 500 SKU × 4 weeks = 10K cells.

---

## 5. Urgency Ranking Algorithm

```
Input: PARTIAL cell (NM, SKU, week, atp_qty, list_recipients[])

transit_lt_nm_to_cn = lookup transport_lane WHERE lane_type='NM_TO_CN' from=NM, to=CN

For each recipient_cn in list_recipients:
  hstk_days = m8Service.getHstkDays(cn_id, sku_id)  // days_supply
  lt_days = transit_lt_nm_to_cn[cn_id]              // C3 fix: LT days, không SS_cn qty
  is_critical = hstk_days < lt_days                 // C3 fix: stockout TRƯỚC khi NM kịp giao

Sort recipients by:
  1. is_critical DESC (CRITICAL trước)
  2. hstk_days ASC (thấp nhất trước)
  3. cn_code ASC (M3 fix tie-break: alphabetical, deterministic Phase 1)

Waterfall:
  remaining = atp_qty
  for recipient in sorted_recipients:
    alloc = min(recipient.requested_qty, remaining)
    recipient.atp_alloc = alloc
    recipient.unfulfilled = recipient.requested_qty - alloc
    remaining -= alloc
    if remaining <= 0: break

Output: urgency_ranking JSONB =
  [{cn_id, hstk_days, transit_lt_days, is_critical, requested_qty, atp_alloc, unfulfilled, rank}]
```

**Phase 2:** Multi-criteria ranking (HSTK + customer tier + ABC class). Phase 1 đơn giản hóa: HSTK ASC.

---

## 6. User Stories (Acceptance)

### US-1: Happy PASS
**Given** M24 alloc 1000m² SKU-X từ NM Mikado tuần W17. Mikado atp_qty=1500. **When** ATP check. **Then** result='PASS', M27 generate PO bình thường 1000m².

### US-2: PARTIAL với urgency rank **(C3 sweep — CRITICAL = HSTK<LT)**
**Given** M24 alloc 2000m² SKU-X từ Mikado, breakdown: CN-DN 800 (HSTK=2d, transit_lt=3d → CRITICAL), CN-BD 700 (HSTK=8d, transit_lt=2d), CN-CT 500 (HSTK=15d, transit_lt=4d). Mikado atp_qty=1500. **When** ATP check.
**Then** result='PARTIAL', urgency_ranking sort theo (is_critical DESC, hstk_days ASC, cn_code ASC):
- CN-DN (HSTK=2d < LT=3d → CRITICAL) → atp_alloc=800, unfulfilled=0
- CN-BD (HSTK=8d, not critical) → atp_alloc=700, unfulfilled=0
- CN-CT (HSTK=15d, not critical) → atp_alloc=0 (atp đã hết), unfulfilled=500

### US-3: BLOCKED — stale data **(H1 sweep — split khỏi FAIL)**
**Given** NM Toko `last_synced_at` 30h trước. Requested 500m² SKU-Y. **When** ATP check.
**Then** result='**BLOCKED**' (KHÔNG phải FAIL), reason='STALE_DATA', atp_qty NULL. M27 block PO release + alert SC Manager "Sync NM Toko trước khi PO". Khác semantics FAIL: BLOCKED = chưa được phép kết luận; FAIL = NM thực sự không có hàng.

### US-4: FAIL — zero stock
**Given** Mikado atp_qty=0 cho SKU-Z. **When** check. **Then** result='FAIL', reason='ZERO_STOCK'. M27 block + alert.

### US-5: CRITICAL flag **(C3 sweep — đúng dimension)**
**Given** PARTIAL với CN-DN HSTK=1d, transit_lt_NM_to_DN=3d. **When** rank. **Then** is_critical=TRUE (HSTK 1d < LT 3d → stockout TRƯỚC khi NM giao kịp), alert M8: "CN-DN SKU-X stockout imminent (HSTK 1d < transit LT 3d), atp partial". KHÔNG dùng SS_cn (sai dimension qty vs days).

### US-6: Honoring rate compute **(C4 sweep — đúng PRD: actual / ATP_at_check)**
**Given** Tháng 4/2026 cells PASS+PARTIAL của Mikado: tổng `atp_at_check_time` = 45000m² (NM đã promise), `actual_delivered` = 42000m². Requested gốc 50000m² (KHÔNG dùng làm denominator). **When** cron compute (Phase 2). **Then** insert `nm_honoring_rate(Mikado, 2026-04, atp_at_check_total=45000, fulfilled_total=42000, rate=42000/45000=0.933)`. Phase 1 cron chạy nhưng skip compute với `fulfilled_total=NULL, rate=NULL` (chờ M27 actual data).

### US-7: Honoring threshold alert **(H3 sweep — <80% rolling 3 months)**
**Given** Phú Mỹ rolling 3 months honoring = 75% (< 80% threshold PRD). **When** cron compute. **Then** alert M8 WARNING: "Phú Mỹ honoring 75% rolling 3 months (<80%). SC Manager review NM contract." Đồng thời `supplier.nm_unreliable_badge=TRUE`. KHÔNG dùng threshold <70%/<50% monthly (lệch PRD).

### US-8: M00 profile expose honoring
**As SC Manager**, mở `/master-data/supplier/Mikado` → thấy section "Performance" với honoring rate 12 tháng gần nhất + trend chart.

### US-9: Idempotent reject
**Given** atp_run cho allocation_run=42 đã COMPLETED. **When** re-trigger. **Then** 409 "ATP đã chạy. Force re-run cần reason."

### US-10: M27 đọc ATP **(M2 sweep — allocationRunId key)**
**Given** atp_run.status='COMPLETED'. **When** M27 init. **Then** gọi `M26Service.getAtpResult(allocationRunId)` → trả Map per (NM, SKU, week) với result + urgency_ranking. M27 generate PO chỉ cho cells **PASS** hoặc **PARTIAL** (theo urgency_ranking atp_alloc). Skip cả **FAIL** (NM zero stock) và **BLOCKED** (stale data, semantics khác — alert sync NM trước).

### US-11: Atp_qty NULL fallback **(C2 + H6 sweep — line-level + warning flag riêng)**
**Given** `supply_snapshot_line.atp_qty IS NULL` cho NM-X SKU-Y (NM chưa upload qua M21 template với atp column). **When** check. **Then** fallback dùng `ssl.allocatable_qty` + flag `is_atp_null_fallback=TRUE` (warning, KHÔNG đổi reason). result vẫn classify PASS/PARTIAL/FAIL bình thường. M28 backlog: track % cells với fallback flag → push NM upload đúng.

### US-12: LCNB không cần ATP check
**Given** allocation_leg source_type='CN_REDIST' (CN-A → CN-B redistribution). **When** ATP scan. **Then** skip — không cần NM ATP cho redistribution nội bộ. ATP chỉ apply cho HUB hoặc NM source.

### US-13: Top-up leg cũng cần ATP
**Given** M25 top-up accept tạo leg `source_type='TOP_UP_NEXT_WEEK'` từ NM stock. **When** ATP scan run kế tiếp (top-up belong to next week period). **Then** ATP check cho cell tương ứng tuần forecast của top-up. M25 source_period_start là input.

---

## 7. Data Contract

### `atp_check` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `atp_run_id` BIGINT FK atp_run | Pin per run |
| `allocation_run_id` BIGINT FK allocation_run | Source run |
| `plan_run_id` BIGINT FK plan_run | Trace ngược DRP |
| `policy_run_id` BIGINT FK policy_run | Rule 14 reuse |
| `nm_id` BIGINT FK supplier | |
| `sku_id` BIGINT FK sku | |
| `period_start` DATE | Monday của tuần (cùng convention M22/M23) |
| `requested_qty` DECIMAL(15,2) | Aggregated từ allocation_leg HUB+NM |
| `atp_qty` DECIMAL(15,2) NULL | NM available qty từ `supply_snapshot_line.atp_qty` (line-level C2 fix); NULL khi BLOCKED (stale data, không thể đọc) hoặc FAIL ZERO_STOCK |
| `result` VARCHAR(15) | `PASS / PARTIAL / FAIL / BLOCKED` (H1 fix: BLOCKED tách khỏi FAIL) |
| `reason` VARCHAR(50) NULL | **H6 CTO fix — chỉ failure reason**: `STALE_DATA` (BLOCKED) / `ZERO_STOCK` (FAIL). KHÔNG dùng cho fallback warning. |
| `is_atp_null_fallback` BOOLEAN DEFAULT FALSE | **H6 fix — split warning flag riêng:** TRUE khi atp_qty NULL fallback dùng allocatable_qty. Có thể TRUE cùng PASS/PARTIAL — không conflict reason. |
| `urgency_ranking` JSONB NULL | Chỉ set khi PARTIAL — array {cn_id, hstk_days, is_critical, requested_qty, atp_alloc, unfulfilled, rank} |
| `checked_at` TIMESTAMP DEFAULT NOW() | |
| Composite UNIQUE | `(atp_run_id, nm_id, sku_id, period_start)` (idempotent secondary) |

### `atp_run` (mới — wrapper, tương tự allocation_run pattern)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `allocation_run_id` BIGINT FK | Source M24 run |
| `plan_run_id` BIGINT FK plan_run | Trace |
| `policy_run_id` BIGINT FK policy_run | Rule 14 reuse |
| `status` VARCHAR(20) | `RUNNING / COMPLETED / FAILED` (H2 fix — bỏ BLOCKED_STALE ở run-level, BLOCKED là cell-level result. Run vẫn COMPLETED dù có cells BLOCKED) |
| `total_cells` INT | Stats |
| `pass_count`, `partial_count`, `fail_count`, `blocked_count` | Stats per result (H2 fix thêm blocked_count) |
| `critical_count` INT | Recipients flagged CRITICAL |
| `is_force_rerun` BOOLEAN DEFAULT FALSE | |
| `force_rerun_reason` TEXT NULL | Mandatory min 20 chars khi force |
| `created_by` VARCHAR(100) | userId hoặc 'SYSTEM_NIGHTLY' |
| `created_at`, `completed_at` | |
| Partial UNIQUE | `(allocation_run_id) WHERE is_force_rerun=FALSE` (idempotent primary) |

### `nm_honoring_rate` (mới — monthly metric, **C4 sweep — đúng PRD**)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `nm_id` BIGINT FK supplier | |
| `period_month` DATE | YYYY-MM-01 |
| `atp_at_check_total` DECIMAL(15,2) | **C4 fix:** Σ atp_qty TẠI THỜI ĐIỂM check (PASS+PARTIAL cells) — đây là điều NM đã promise. KHÔNG dùng requested_qty. |
| `requested_total` DECIMAL(15,2) | Σ requested gốc — chỉ tracking cho dashboard, KHÔNG dùng compute rate |
| `fulfilled_total` DECIMAL(15,2) NULL | Σ actual delivered từ M27 PO RECEIVED. NULL Phase 1 (chưa có data). |
| `rate` DECIMAL(5,4) NULL | **C4 fix: `fulfilled_total / atp_at_check_total`** (đúng PRD F2-B6/F2-B8). NULL Phase 1. |
| `rolling_3m_rate` DECIMAL(5,4) NULL | **H3 fix:** Rolling 3 months để compare với threshold 80% PRD |
| `cell_count` INT | Số ATP cells trong tháng |
| `partial_count`, `fail_count`, `blocked_count` | Stats (H2 fix thêm blocked_count) |
| `calculated_at` TIMESTAMP | Cron timestamp |
| Composite UNIQUE | `(nm_id, period_month)` |

### API chính

```
# ATP check lifecycle (H5 CTO fix — input contract đầy đủ)
POST  /api/v1/nm-atp/run                              # Body: {allocationRunId: string} — manual trigger
                                                      # Auto trigger qua M24 event listener
POST  /api/v1/nm-atp/run/force-rerun                  # Body: {allocationRunId: string, forceRerunReason: string min 20 chars}
GET   /api/v1/nm-atp/runs?limit=&status=&allocationRunId=  # List runs
GET   /api/v1/nm-atp/runs/:id                         # Detail + summary stats

# Result query
GET   /api/v1/nm-atp/runs/:id/checks?nmId=&result=    # List atp_check rows
GET   /api/v1/nm-atp/runs/:id/critical                # CRITICAL recipients only
GET   /api/v1/nm-atp/runs/:id/urgency/:checkId        # Urgency ranking detail per cell

# Honoring rate
GET   /api/v1/nm-atp/honoring?nmId=&fromMonth=&toMonth=  # Trend chart
GET   /api/v1/nm-atp/honoring/leaderboard               # NM ranking by rate
POST  /api/v1/nm-atp/honoring/recompute?month=          # Manual recompute (audit)

# Internal (M27 inject) — M2 CTO fix: dùng allocationRunId đúng với idempotency primary key
# Method: M26Service.getAtpResult(allocationRunId): AtpResultDto
# (planRunId vẫn lookup được từ atp_run.plan_run_id nhưng KHÔNG dùng làm API key)
```

**Folder structure:**
```
backend/src/nm-atp/
├── nm-atp.module.ts
├── nm-atp.controller.ts
├── nm-atp.service.ts                ← lifecycle + run trigger
├── atp-classification.service.ts    ← PASS/PARTIAL/FAIL logic
├── urgency-ranking.service.ts       ← HSTK-based ranking
├── honoring-rate.service.ts         ← Monthly cron + compute
├── dto/
└── entities/
    ├── atp-run.entity.ts
    ├── atp-check.entity.ts
    └── nm-honoring-rate.entity.ts
```

---

## 8. Cron & Trigger

| Trigger | Schedule (VN) | Purpose |
|---------|---------------|---------|
| **Auto run** | M24 event `AllocationRunCompleted` | Trigger ATP check ngay sau alloc done (~00:00) |
| **Manual** | SC Manager click | Standalone trigger nếu cần |
| **Honoring rate** | `0 6 1 * *` (Day 1 of month, 06:00 VN) | **M4 CTO fix — Phase scoping rõ:**<br>• Phase 1 cron CHẠY nhưng skip compute với log "Pending M27 actual_delivered data" (nm_honoring_rate insert NULL fulfilled_total)<br>• Phase 2 cron compute đầy đủ khi M27 PO RECEIVED data có. M28 weekly cũng gọi recompute để rolling 3 months. |

> KHÔNG cron riêng cho main run — event-driven sau M24 (parallel với M25). Tránh race condition.

---

## 9. Non-functional

- ATP check < **1 phút** cho 10K cells
- Urgency ranking compute < 100ms per PARTIAL cell
- Honoring rate cron < 30s cho 50 NMs × 12 months
- Result query < 2s với pagination

---

## 10. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `supplier`, `sku` | FK lookup, NM list |
| **M00** `supplier.honoring_rate` column (Phase 1 expose) | Display rate trên profile |
| **M10** policy_run snapshot configs | `atp.staleness_threshold_hours`, `atp.honoring_warning_threshold` |
| **M10** feature flag `m26_nm_atp_enabled` | Rollback |
| **M21** `FreshnessGateService.checkAll()` (existing) preload Map<nm_id, fresh> | Stale gate (R3, H4 fix — đúng API M21 hiện có) |
| **M24** `getAllocationResult(runId)` + `AllocationRunCompleted` event | Source requested per cell |
| **M23** `SsCnService.getSsCn(cn, sku, planRunId)` | CRITICAL flag check (R5) |
| **M2/M21** `supply_snapshot_line.atp_qty` (LINE-LEVEL, **C2/H4 fix**) | ATP source data — yêu cầu migration mới (xem §11 prerequisites) |
| **M8** `getHstkDays(cn, sku)` | Urgency ranking input |
| **M27** (Phase 2) PO actual_delivered | Honoring rate fulfilled_total |
| **M28** (Phase 2) actual delivery feedback | Honoring rate refresh |

| Feeds | Why |
|-------|-----|
| **M27 PO Review** | `getAtpResult(allocationRunId)` (M2 fix) → block **BLOCKED** + **FAIL** cells (H1 split), generate PO chỉ cells PASS+PARTIAL theo urgency_ranking |
| **M28** | Stats: ATP fail rate per NM, urgency frequency, honoring trend |
| **M8 Alerts** | CRITICAL recipients, FAIL cells, low honoring rate |
| **M00 Supplier profile** | Display honoring_rate trend |

---

## 11. DoD

- [ ] 3 tables migration + .down.sql: `atp_run`, `atp_check`, `nm_honoring_rate`
- [ ] Idempotent 2-tier UNIQUE: partial UNIQUE `atp_run(allocation_run_id) WHERE is_force_rerun=FALSE` + composite UNIQUE `atp_check(atp_run_id, nm_id, sku_id, period_start)`
- [ ] ATP classification service (R2) với edge cases
- [ ] M21 freshness gate inject cho R3 (stale → **BLOCKED**, H1 sweep) qua `checkAll()` preload (H4)
- [ ] Urgency ranking service per PARTIAL cell (R4-R6)
- [ ] CRITICAL flag với M23 SS_cn lookup (R5)
- [ ] Honoring rate cron 1st of month VN (R7)
- [ ] Honoring threshold alert (R8 H3 sweep): rate < 80% rolling 3 months → WARNING + nm_unreliable_badge=TRUE. KHÔNG dùng <70%/<50% monthly.
- [ ] Policy snapshot pin reuse từ M24 (R9)
- [ ] M24 callback event listener `@OnEvent('AllocationRunCompleted')`
- [ ] Idempotent run check (R10)
- [ ] ATP qty NULL fallback (R11) + warning + tracking flag
- [ ] LCNB skip (R12 — chỉ scan HUB/NM source legs, không CN_REDIST)
- [ ] Top-up leg ATP scan với source_period_start (R13/M25 cross-link)
- [ ] Force rerun endpoint với mandatory reason min 20 chars
- [ ] `getAtpResult(allocationRunId)` injectable cho M27 (M2 sweep — match idempotency primary key)
- [ ] Helper shared `atpCellKey(nmId, skuId, weekStart)` ở `common/atp-utils.ts`
- [ ] Performance < 1 phút cho 10K cells
- [ ] FE: ATP run history list + detail
- [ ] FE: PARTIAL drilldown với urgency ranking table per cell
- [ ] FE: CRITICAL recipients dashboard
- [ ] FE: Honoring rate trend chart per NM (12 months)
- [ ] FE: NM leaderboard sorted by honoring rate
- [ ] FE: Integration M00 supplier profile section "Performance"
- [ ] Alert M8: CRITICAL recipients, FAIL cells, low honoring
- [ ] Audit log run + force_rerun + honoring recompute manual
- [ ] Feature flag wrapper — off → 503; M27 fallback skip ATP check (treat all as PASS với warning)
- [ ] QA: 13 user stories pass

---

## 11b. Prerequisites — Schema migrations cross-module (CTO H4 fix)

> **Quan trọng:** M26 phụ thuộc 4 schema changes ở module khác, **KHÔNG được giả định đã tồn tại**. BE2 verify Sprint 5 Day 1, escalate nếu thiếu.

| Schema change | Module owner | Sprint phải xong | Lý do |
|---------------|--------------|------------------|-------|
| `supply_snapshot_line.atp_qty DECIMAL(15,2) NULL` | M21 (extend M2) | Sprint 3 (cùng M21 deploy) | C2/H4 fix — ATP source line-level. M21 NM upload template đã có cột `atp_qty` ở CSV nhưng entity `SupplySnapshotLine` hiện chỉ có `allocatable_qty/reserved_qty/quarantine_qty/in_transit_qty`. **CẦN ALTER TABLE thêm column.** |
| `transport_lane.lane_type='NM_TO_CN'` rows seeded | M00 minor m1 fix | Sprint 2 | C3 fix — transit_lt_days lookup cho urgency CRITICAL. M00 SUPPLIER-PK-DEVIATION đã note seed transport_lane cho NM×CN. |
| `M21 FreshnessGateService.checkAll()` return Map shape | M21 | Sprint 3 | H4 fix — verify return shape. Nếu chỉ trả boolean → request M21 enhance. |
| `po_line.actual_received_qty` (M27 RECEIVED data) | M27 | Sprint 8 (Phase 2 unblock) | C4 fix — honoring fulfilled_total source. Phase 1 cron skip với NULL nếu chưa có. |

**M26 BE2 Sprint 5 Day 1 action:**
1. Verify `supply_snapshot_line.atp_qty` đã ALTER → nếu chưa, escalate cross-team M21
2. Verify `transport_lane` seed có rows lane_type='NM_TO_CN' đủ cho NM×CN
3. Verify M21 `checkAll()` return shape match contract
4. Note Phase 1 honoring NULL acceptable, Phase 2 trigger khi M27 stable

---

## 12. Out of Scope

- **NM Portal real-time API** — Phase 2 (Phase 1 dùng `supply_snapshot_line.atp_qty` LINE-LEVEL từ NM upload qua M21 template)
- **ATP forecast** (NM future capacity) — Phase 2
- **Auto-negotiate với NM** khi PARTIAL — Phase 2 (Phase 1 SC Manager manual)
- **Multi-criteria urgency** (HSTK + customer tier + ABC) — Phase 2 (Phase 1 chỉ HSTK)
- **Reserve ATP** (book NM capacity ahead) — Phase 2
- **NM substitution** (Mikado FAIL → switch sang Toko same SKU) — Phase 2 (đụng M00 single-source rule)
- **Auto-reduce alloc** khi PARTIAL — Phase 1 chỉ flag; M27 quyết tự cut hoặc emergency PO

---

## 13. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| ATP qty NULL trong supply_snapshot Phase 1? | Fallback dùng `qty` raw + warning. Tracking `is_atp_null_fallback=TRUE`. M28 backlog: % NMs thiếu ATP column → push NM upload đúng. |
| **[M4 CTO fix]** Honoring rate Phase 1 — cron có chạy không? | **Cron CÓ chạy mỗi tháng** (infrastructure ready), nhưng compute logic skip khi `actual_delivered` data chưa có (M27 chưa stable). Insert row `nm_honoring_rate` với `fulfilled_total=NULL, rate=NULL, calculated_at=NOW()` + log "Pending M27/M28 actual data". Phase 2 unblock auto khi M27 RECEIVED data có. KHÔNG bypass cron — tránh dev quên enable Phase 2. |
| Stale gate có cho force override? | Phase 1 KHÔNG. ATP stale = **BLOCKED** cứng (H1 sweep — không phải FAIL). SC Manager phải sync NM trước. Force override chỉ ở M21 level (toàn DRP run), không per ATP cell. |
| LCNB CN_REDIST có cần ATP? | KHÔNG. Redistribution nội bộ CN-A → CN-B không cần NM ATP. M26 skip source_type='CN_REDIST'. |
| Multiple SKU base cùng request 1 NM — atp shared? | Phase 1 ATP per (NM, SKU, week) độc lập. Phase 2 nếu NM có shared capacity (resource pooling) → cần model riêng. |
| Race condition M25 + M26 cùng run sau M24 done? | OK — 2 modules đọc M24 output read-only, không conflict. M27 chờ cả 2 done qua AND condition. |
| Urgency rank conflict — 2 CN cùng HSTK = 1d? | Tie-break: ABC class A trước (Phase 2). Phase 1: alphabetical cn_code (deterministic). |
| Top-up leg (source_period_start ≠ run period) — ATP cell gì? | ATP cell nhóm theo `period_start` của leg (= source_period_start cho top-up). Cross-week ATP — M27 audit phân biệt. |

---

## 14. Lưu ý cho dev

1. **`getAtpResult(allocationRunId)` injectable** (M2 sweep) — M27 inject. Trả `AtpResultDto`: `{ atpRunId, planRunId, allocationRunId, generatedAt, checks: Map<atpCellKey, AtpCheckDto> }`. Throw `AtpRunNotCompletedException` nếu chưa COMPLETED → M27 wait/retry.

2. **Helper `atpCellKey()` shared** ở `common/atp-utils.ts`:
   ```typescript
   export const atpCellKey = (nmId: string, skuId: string, weekStart: string) =>
     `${nmId}|${skuId}|${weekStart}`;
   ```
   Cả M26 builder + M27 consumer phải dùng helper này (giống M23 `drpCellKey()` pattern).

3. **Policy snapshot reuse từ M24:**
   ```typescript
   const allocationRun = await m24Service.getAllocationRun(allocationRunId);
   const policySnapshot = await dataSource.query(
     `SELECT config_snapshot FROM policy_run WHERE id = $1`,
     [allocationRun.policyRunId]
   );
   const atpConfig = policySnapshot.config_snapshot.atp;
   ```

4. **[H4 CTO fix] M21 freshness gate inject — đúng contract M21 hiện tại:**
   M21 spec hiện export `FreshnessService` với `check()` và `checkAll()` (không có per-NM API).
   M26 phải:
   - **Hoặc** preload `checkAll()` 1 lần đầu run → `Map<nm_id, isFresh>` lookup O(1) per cell
   - **Hoặc** request M21 thêm method `checkOne(nmId): Promise<{fresh: boolean, hours_since_sync: number}>` (preferred, cùng pattern với M22 R7 grace check)
   ```typescript
   // Cách preferred — preload Map đầu run:
   const freshnessMap = await m21Service.checkAll();  // existing M21 API
   for (const cell of atpCells) {
     const fresh = freshnessMap.get(cell.nmId)?.fresh ?? false;
     if (!fresh) {
       insertAtpCheck({ result: 'BLOCKED', reason: 'STALE_DATA', atp_qty: null });  // H1 fix: BLOCKED
       continue;
     }
     // tiếp continue ATP qty lookup
   }
   ```
   **Action item:** BE2 verify M21 contract Sprint 5 Day 1. Nếu M21 chưa có `checkAll()` → escalate cross-team contract.

5. **Urgency ranking O(n log n) per cell:**
   - For each PARTIAL cell: gather recipients, lookup HSTK + transit_lt_NM_to_CN (preload Map từ transport_lane lane_type='NM_TO_CN'), sort theo (is_critical DESC, hstk_days ASC, cn_code ASC), waterfall
   - Preload HSTK Map 1 lần đầu run cho tất cả CN involved
   - **C3 sweep — KHÔNG dùng SS_cn**: dimension qty không so được với days. CRITICAL = hstk_days < transit_lt_days.

6. **[C4 sweep] Honoring rate compute** (cron 1st of month — Phase 2 unblock):
   ```sql
   INSERT INTO nm_honoring_rate (
     nm_id, period_month, atp_at_check_total, requested_total, fulfilled_total, rate, rolling_3m_rate
   )
   SELECT
     a.nm_id,
     DATE_TRUNC('month', NOW() - INTERVAL '1 month')::DATE AS period_month,
     SUM(a.atp_qty) AS atp_at_check_total,         -- C4 fix: dùng atp_qty NM đã promise
     SUM(a.requested_qty) AS requested_total,       -- chỉ để tracking dashboard
     COALESCE(SUM(p.actual_received_qty), 0) AS fulfilled,   -- M27 PO RECEIVED
     CASE WHEN SUM(a.atp_qty) > 0
       THEN COALESCE(SUM(p.actual_received_qty), 0)::DECIMAL / SUM(a.atp_qty)  -- C4 fix
       ELSE NULL END AS rate,
     -- rolling_3m_rate computed sau từ subquery 3 months
     ... AS rolling_3m_rate
   FROM atp_check a
   LEFT JOIN po_line p ON p.nm_id = a.nm_id AND p.sku_id = a.sku_id
     AND p.delivered_at BETWEEN start_of_month AND end_of_month
   WHERE a.checked_at BETWEEN start_of_month AND end_of_month
     AND a.result IN ('PASS', 'PARTIAL')           -- chỉ count cells có promise (KHÔNG BLOCKED/FAIL)
   GROUP BY a.nm_id
   ON CONFLICT (nm_id, period_month) DO UPDATE SET ...;
   ```
   Phase 1: `actual_received_qty` từ M27 chưa ready → cron INSERT row với `fulfilled_total=NULL, rate=NULL` + log "Pending M27 PO RECEIVED data" (M4 fix — KHÔNG bypass cron).

7. **M00 supplier profile integration:** thêm endpoint `/master-data/supplier/:id/honoring-trend` (M26 expose) → M00 FE component fetch và render chart.

8. **Status transition matrix:**
   | Từ | → Cho phép | Ghi chú |
   |----|-----------|---------|
   | RUNNING | COMPLETED, FAILED | Normal |
   | COMPLETED | (terminal) | Force re-run = atp_run mới |
   | FAILED | (terminal, retry = atp_run mới) | |

9. **Folder Rule 3 check:** NEW module → `src/nm-atp/` (kebab-case). KHÔNG đặt vào `src/supply/` (đó là M2/M21). KHÔNG bọc `v2/`.

10. **Cross-spec readiness:** M27 spec (sắp viết) sẽ định nghĩa rõ block FAIL → ngừng generate PO + alert. Tôi note để consistent khi viết M27.

---

*M26 NM ATP Check & Urgency Ranking Spec v1.2 — 2026-04-17 (CTO sweep — clean self-contradictions: US/SQL/DoD/Dependencies/Risk/dev notes đồng bộ với head-of-file fixes; thêm §11b Prerequisites cross-module schema)*
