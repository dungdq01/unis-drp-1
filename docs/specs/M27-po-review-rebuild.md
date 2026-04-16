# M27 — PO/TO Review & Confirm (REBUILD)

> **Ngày:** 2026-04-17 · **Phase:** 1 · **Sprint:** 7-8
> **Owner:** BE4 · **DA:** DA1 · **FE:** FE1
> **Status:** 🔴 REBUILD M7 (folder mới `src/po-review/`, M7 deprecate sau ≥ 1 tháng stable)
> **PRD:** §F2-B7 PO Review & Confirm · **Flow:** 2 (Daily DRP, 00:00-05:00 review window)
> **Domain:** D7 Order Management
> **Feature flag:** `m27_po_rebuild_enabled`
> **Folder (Rule 3):** `backend/src/po-review/` (NEW, kebab-case — KHÔNG đặt vào `src/orders/` của M7)
> **Changelog v1.1 (CTO review):** Fix C1 (NM resolution qua sku_nm_mapping cho HUB source), C2 (Step 4 SQL JOIN allocation_result đúng schema), C3 (period_start preserve contract), H1 (stale→BLOCKED sweep từ M26 v1.2), H2 (bỏ BLOCKED_ATP status — chỉ NO_CARRIER block toàn run), H3 (rollback line-level), H4 (getPoFulfillment per-line), H5 (UNIQUE NULL coalesce), M1-M3 medium.
> **Changelog v1.2 (CTO sweep round 2):** Fix H1 (top-up fields contract — formalize M24 v1.0.2 prerequisite §10b), M1 (sweep US-12 + Dependencies + DoD bỏ supply_snapshot.reserved_for_transport — chỉ line-level), M2 (US-1 timing sạch lại — single statement).

---

## 1. Tại sao làm bài này

M7 (Order Bridge) hiện tại có domain model sai căn bản:
- 1 bảng `order_batch` flat — không phân biệt PO (NM→CN) vs TO (CN→CN), 2 nghiệp vụ khác nhau
- Không có `po_edit_log` → mọi Planner override mất audit
- Không có lifecycle 5 states formal — chỉ DRAFT/EXPORTED đơn giản
- Không có tracking fields (vehicle/driver/NVT/ETA actual)
- Không có `po_tracking` riêng để follow-up
- Không có gate ATP/NO_CARRIER → có thể release PO sai

→ KHÔNG thể "vá" bằng ALTER. Phải REBUILD domain model.

M27 là **human decision point** — hệ thống M21→M26 gợi ý, Planner review/edit/confirm chính thức tạo PO + TO.

---

## 2. Scope

### ✅ Thêm (NEW module folder)
- 6 bảng mới: `po_header`, `po_line`, `to_header`, `to_line`, `po_edit_log`, `po_tracking` (+ TO equivalent `to_tracking`)
- PO lifecycle 5 states: DRAFT → CONFIRMED → SHIPPED → RECEIVED → CLOSED (+ CANCELLED)
- TO lifecycle 5 states: DRAFT → CONFIRMED → SHIPPED → RECEIVED → CLOSED (+ CANCELLED) — tách riêng
- Hard gates: ATP (M26) + NO_CARRIER (M25) + variant_review (M24) trước confirm
- Edit log với mandatory reason mọi override
- Idempotency-key cho confirm endpoint (reuse pattern Sprint 0 BUG-03)
- Cron PO_OVERDUE alert daily
- Service `getPoFulfillment(poId)` export cho M28 inject (actual_delivered tracking)

### ❌ Không đụng
- M7 `order_batch`/`order_line` schema — read-only legacy, chạy song song
- M7 controllers giữ nguyên cho backward compat
- ERP integration (Bravo) — Phase 1 stub, Phase 2 thật
- NM portal direct API — Phase 2

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | M27 chạy sau M25 + M26 cả 2 done. Wait AND condition (event-driven). | Sequence |
| **R2** | **Hard gate ATP** (H1 sweep từ M26 v1.2): cell ATP `result='FAIL'` (NM zero stock) → SKIP cell + alert "Cancel demand hoặc emergency PO". Cell ATP `result='BLOCKED'` (stale data, semantics khác FAIL) → SKIP cell + alert "Sync NM trước khi PO". Cell PARTIAL → generate PO theo `urgency_ranking.atp_alloc` (clamp qty). Cell PASS → full qty. **ATP cell skip KHÔNG block toàn run** (H2 fix). | Skip per-cell |
| **R3** | **Hard gate NO_CARRIER** (M25 v1.2 cross-link): `transport_plan` còn trip status='NO_CARRIER' hoặc `getTransportPlan()` throw `TransportPlanIncompleteException` (M25 H5 fix — exception name chuẩn) → **block** toàn bộ M27 run. SC Manager resolve carrier trước. **Đây là gate duy nhất block toàn run.** | Block incomplete |
| **R4** | **Hard gate variant_review** (M24 cross-link): cell `planner_review_required=TRUE` → mark PO/TO line `requires_variant_review=TRUE`, default status='DRAFT' đến khi Planner review. | Soft warning (không block) |
| **R5** | **PO per NM × CN granularity** (BR-F2B7-004): 1 PO = 1 NM → 1 CN. Multi-CN cùng NM → tạo nhiều PO riêng. Multi-drop transport (M25) gom shipping nhưng PO vẫn riêng. | Granularity |
| **R6** | **TO per donor CN × receiver CN**: source `allocation_leg.source_type='CN_REDIST'` → tạo TO riêng. PO và TO **không gộp** vào cùng workflow. | PO/TO separation |
| **R7** | **Edit before CONFIRMED**: Planner free edit (qty, add/remove SKU, swap variant). Mọi edit ghi `po_edit_log` với mandatory reason. Sau CONFIRMED → block edit (cancel + recreate nếu cần). | Workflow |
| **R8** | **Validation khi edit qty** (FR-F2B7-003): qty edit > NM ATP → warning "vượt tồn NM, xem M26"; qty=0 → soft delete dòng; SKU không thuộc NM (M00 sku_nm_mapping) → reject. | Edit guards |
| **R9** | **CONFIRMED → SHIPPED gate** (BR-F2B7-009): NM phải nhập Số xe + NVT + Số container trước khi chuyển SHIPPED. Thiếu 1 trong 3 → reject. | Mandatory tracking |
| **R10** | **SHIPPED → RECEIVED gate** (BR-F2B7-010): CN Manager nhập `actual_received_qty`. Nếu < `confirmed_qty` → flag `DELIVERY_INCOMPLETE`, mandatory note (thiếu/hư hỏng). | Reconciliation |
| **R11** | **CANCELLED**: chỉ cho phép trước SHIPPED. Mandatory cancel reason min 20 chars. Audit. Reservation từ M25 release ngược về **`supply_snapshot_line.reserved_for_transport` (LINE-LEVEL, H3 fix — đúng grain M25 v1.2)** per (location_code × item_code), KHÔNG header level. | Cleanup |
| **R12** | **PO_OVERDUE alert**: PO CONFIRMED quá `po.overdue_days` (M10 config, default 7) chưa SHIPPED → cron daily 09:00 VN gửi alert M8 + dashboard flag. | Follow-up |
| **R13** | **Idempotency-key on confirm**: header `Idempotency-Key` reuse pattern Sprint 0 BUG-03 + bảng `idempotency_log`. Retry cùng key → return cached result, KHÔNG tạo duplicate PO/TO. | Anti-duplicate |
| **R14** | **Policy snapshot pin** (Rule 14): M27 reuse `policy_run_id` từ M24/M23. Configs (e.g. po.overdue_days, validation thresholds) đọc từ snapshot. | Hard rule |
| **R15** | **Source allocation_leg trace**: mỗi `po_line` / `to_line` reference `source_allocation_leg_id` để audit ngược về DRP/allocation/transport chain. Cross-link M25 trip lines via `transport_trip_line.source_allocation_leg_id`. | Lineage |
| **R16** | **Top-up legs (M25 C2)**: nếu line từ `allocation_leg.source_type='TOP_UP_NEXT_WEEK'` → mark PO line `is_top_up=TRUE` + lưu `source_period_start`. UI tooltip "Ship sớm hơn forecast period 1 tuần". M28 audit. | Top-up trace |

---

## 4. Pipeline (per run)

```
Step 1: Validate
   - M25 transport_plan.status='COMPLETED' (no NO_CARRIER) — R3 block
   - M26 atp_run.status='COMPLETED' — block nếu chưa
   - M27 idempotent: not exists po_run for allocation_run_id (force rerun cần reason)

Step 2: Reuse policy_run_id từ M24 (Rule 14 pin)
Step 3: Create po_run với plan_run_id + allocation_run_id + transport_plan_id + atp_run_id

Step 4: Generate Draft PO/TO from sources (C1+C2+C3 fix — đúng schema thật):

   -- allocation_leg KHÔNG có allocation_run_id (C2 fix), phải JOIN allocation_result
   -- HUB source dùng HUB_VIRTUAL_ID=0 (M24), KHÔNG có NM lineage trực tiếp (C1 fix)
   -- → resolve NM qua sku_nm_mapping single-source (M00)
   -- period_start lấy từ allocation_result hoặc result.is_top_up=TRUE thì source_period_start (C3)

   SELECT
     leg.id AS leg_id,
     leg.source_type,
     leg.source_entity_id,
     leg.source_period_start,                    -- TOP_UP_NEXT_WEEK case (C3 + M25 H1 cross-link)
     result.cn_id, result.sku_id,
     result.is_top_up, result.source_top_up_id,
     COALESCE(result.source_period_start, result.period_start) AS effective_period,  -- C3
     leg.allocated_qty,
     m.nm_id AS resolved_nm_id                   -- C1 fix: lookup qua single-source mapping
   FROM allocation_leg leg
   JOIN allocation_result result ON result.id = leg.allocation_result_id
   LEFT JOIN sku_nm_mapping m ON m.sku_id = result.sku_id AND m.active = TRUE
   WHERE result.allocation_run_id = $aId         -- C2 fix: lọc qua result, không leg
     AND leg.source_type IN ('HUB', 'NM', 'TOP_UP_NEXT_WEEK', 'CN_REDIST');

   For each row:
     IF source_type IN ('HUB', 'NM', 'TOP_UP_NEXT_WEEK'):
       → PO candidate (resolved_nm_id → cn_id)
       → group key = (resolved_nm_id, cn_id, effective_period, is_top_up)
     ELIF source_type = 'CN_REDIST':
       → TO candidate (source_entity_id donor CN → cn_id receiver)
       → group key = (donor_cn_id, cn_id, effective_period)

Step 5: Apply M26 ATP gate per (resolved_nm_id, sku_id, effective_period) — H1 sweep BLOCKED:
   atp = atpResult.checks.get(atpCellKey(resolved_nm_id, sku_id, effective_period))

   IF atp.result = 'BLOCKED':                    -- H1 fix: BLOCKED khác FAIL semantically
     SKIP cell, alert SC Manager "Sync NM trước khi PO" (KHÔNG phải zero-stock),
     log skipped_due_atp_blocked
   IF atp.result = 'FAIL':                       -- NM thực sự zero-stock
     SKIP cell, alert SC Manager "NM zero stock, cancel demand hoặc emergency PO",
     log skipped_due_atp_fail
   IF atp.result = 'PARTIAL':
     clamp qty = atp.urgency_ranking[cn_id].atp_alloc, log clamped_due_atp_partial
   IF atp.result = 'PASS':
     qty = full allocated_qty

Step 6: Group into PO headers (per NM × CN, R5) and TO headers (per donor × receiver, R6)
   - Generate po_number / to_number (table-based seq, idempotent inside tx)
   - Insert po_header + po_line[] (bulk chunk 500)
   - Insert to_header + to_line[] (bulk chunk 500)
   - Mark `requires_variant_review=TRUE` cho lines từ cell có planner_review_required (R4)
   - Mark `is_top_up=TRUE` cho lines từ TOP_UP_NEXT_WEEK source (R16)
   - Link source_allocation_leg_id (R15)

Step 7: Status DRAFT, chờ Planner review trong window 00:00-05:00 VN

Step 8: po_run.status='COMPLETED' (KHÔNG auto-confirm) → notify Planner
```

**Confirm phase (Planner action, manual sau Step 8):**
```
Per PO/TO:
  Planner review → optional edit (R7+R8 gates) → confirm
  → idempotency check (R13)
  → Wrap transaction:
       UPDATE status DRAFT → CONFIRMED
       INSERT po_edit_log nếu có edit
       INSERT po_tracking row stub
       Stub ERP sync (Phase 2: real call)
  → Save idempotency_log
  → Audit
```

**Run time target:** < 2 phút generate Draft PO/TO cho 100 cells.

---

## 5. State Machines

### PO Lifecycle (5 states + CANCELLED)

```
DRAFT ──(Planner confirm + idempotency-key)──▶ CONFIRMED
                                                 │
                       (NM nhập số xe+NVT+cont)  ▼
                                              SHIPPED
                                                 │
                       (CN nhập actual_qty)     ▼
                                              RECEIVED
                                                 │
                                  (Planner)    ▼
                                              CLOSED

  DRAFT/CONFIRMED ──(Planner cancel + reason)──▶ CANCELLED
  SHIPPED+ → CANCELLED: KHÔNG allowed (đã trên đường)
```

### TO Lifecycle (5 states + CANCELLED)

```
DRAFT ──(Planner confirm)──▶ CONFIRMED
                              │
        (CN donor nhập)       ▼
                            SHIPPED
                              │
        (CN receiver nhập)    ▼
                            RECEIVED
                              │
                              ▼
                            CLOSED

  DRAFT/CONFIRMED ──(Planner cancel + reason)──▶ CANCELLED
```

**Transition matrix (validate trong service `transitionPo()`/`transitionTo()`):**

| Từ | → Cho phép | Mandatory fields |
|----|-----------|------------------|
| DRAFT | CONFIRMED, CANCELLED | confirmed: idempotency-key |
| CONFIRMED | SHIPPED, CANCELLED | shipped: vehicle_no, carrier, container_no, ship_date |
| SHIPPED | RECEIVED | actual_received_qty, receive_date, note nếu < confirmed |
| RECEIVED | CLOSED | (no extra) |
| CLOSED | (terminal) | — |
| CANCELLED | (terminal) | cancel_reason min 20 chars |

Vi phạm transition → `InvalidTransitionException` 409.

---

## 6. User Stories (Acceptance)

### US-1: Generate Draft PO+TO sau M25+M26 **(M2 sweep — timing nhất quán)**
**Given** M25 transport_plan COMPLETED (no NO_CARRIER) AND M26 atp_run COMPLETED. **When** M27 trigger ~00:30 VN (event-driven sau cả 2 done — KHÔNG cron riêng). **Then** Insert po_run + po_header + po_line + to_header + to_line, status DRAFT. Planner review window 00:30 → 05:00 VN (manual confirm, không auto).

### US-2: M26 ATP BLOCKED skip cell **(H1 sweep — split khỏi FAIL theo M26 v1.2)**
**Given** Cell Mikado×SKU-X×W17 atp.result='**BLOCKED**' reason='STALE_DATA' (NM data stale 30h). **When** Step 5 generate. **Then** SKIP cell, log `skipped_due_atp_blocked`, alert SC Manager: "Skipped Mikado SKU-X W17 — sync NM trước khi PO" (KHÔNG nói "zero stock"). M27 run vẫn complete với cells khác. Skip semantically khác FAIL: BLOCKED = chưa được phép kết luận; FAIL = NM thực sự zero.

### US-2b: M26 ATP FAIL skip cell
**Given** Cell Mikado×SKU-Y×W17 atp.result='FAIL' reason='ZERO_STOCK' (Mikado atp_qty=0). **When** Step 5. **Then** SKIP cell, log `skipped_due_atp_fail`, alert SC Manager: "NM Mikado zero stock SKU-Y, cancel demand hoặc emergency PO". M27 run vẫn complete.

### US-3: M26 PARTIAL clamp qty
**Given** Cell Mikado×SKU-Y atp_result='PARTIAL', urgency_ranking: CN-DN atp_alloc=800, CN-BD atp_alloc=700, CN-CT atp_alloc=0. **When** generate. **Then** Tạo 2 PO: Mikado→DN qty=800, Mikado→BD qty=700. KHÔNG tạo PO Mikado→CT (urgency rank atp_alloc=0). Log `clamped_due_atp_partial`.

### US-4: M25 NO_CARRIER block toàn run
**Given** transport_plan có 2 trips status='NO_CARRIER'. **When** M27 trigger. **Then** `getTransportPlan()` throw `TransportPlanIncompleteException`. M27 run.status='BLOCKED_INCOMPLETE'. Alert SC Manager: "Resolve carrier cho 2 trips trước khi M27 chạy".

### US-5: Planner review + edit qty
**Given** Draft PO Mikado→CN-BD GA-300 qty=93m². Planner biết CN-BD vừa nhận đơn lớn. **When** edit qty 93→150 + reason "đơn hàng mới". **Then** validation: 150 vs ATP Mikado SKU-X (giả sử ATP=200 → OK). Insert po_edit_log {field='qty', old=93, new=150, reason, by, at}. PO line update.

### US-6: Edit qty vượt ATP warning
**Given** Planner edit qty 100→500. ATP Mikado SKU-X = 250. **When** save. **Then** warning "Qty 500 > ATP 250. Confirm anyway?" Nếu Planner confirm → save với flag `qty_exceeds_atp=TRUE` + audit log. SC Manager review.

### US-7: Edit add SKU
**Given** Planner add GA-400 vào PO Mikado (SKU không có trong draft gốc). **When** save. **Then** validate M00 sku_nm_mapping: GA-400 thuộc Mikado? → Yes (ví dụ) → add line. Check ATP Mikado×GA-400. Insert edit_log "added_sku".

### US-8: Confirm với idempotency-key
**Given** Planner click Confirm PO-001. **When** POST `/po-review/po/:id/confirm` với header `Idempotency-Key: uuid-A`. **Then** check idempotency_log: chưa có → execute confirm (DRAFT → CONFIRMED), insert tracking stub, save idempotency_log key=uuid-A. Retry cùng key → return cached result PO-001, KHÔNG tạo duplicate.

### US-9: SHIPPED gate mandatory tracking
**Given** PO-001 status=CONFIRMED. NM Mikado nhập tracking. **When** PATCH `/po/:id/transition` body {to_status: 'SHIPPED', vehicle_no: '51A-12345', carrier_code: 'CARR01', container_no: 'CON-9999'}. **Then** validate 3 fields có đủ → transition OK. Nếu thiếu container_no → reject "Số container bắt buộc khi SHIPPED".

### US-10: RECEIVED với delivery incomplete
**Given** PO confirmed_qty=100m², SHIPPED. CN-BD nhập actual_received=95m². **When** transition RECEIVED. **Then** validate note non-empty (mandatory khi < confirmed). Flag `delivery_incomplete=TRUE`. Alert M8: "PO-001 nhận thiếu 5m², note: 'hư 5m² do mưa'".

### US-11: TO lifecycle
**Given** TO-005 từ M24 LCNB CN-BD→CN-DN. **When** Planner confirm. **Then** TO status DRAFT → CONFIRMED. CN-BD donor manager nhận notification, sau đó nhập số xe → SHIPPED. CN-DN nhận → input actual_qty → RECEIVED → CLOSED.

### US-12: CANCELLED rollback reservation **(M1 sweep — line-level đúng M25 C1)**
**Given** PO-002 CONFIRMED, `supply_snapshot_line.reserved_for_transport` có 100m² SKU-X tại location_code 'WH-MIK' (line-level). **When** Planner cancel + reason "NM thông báo không ship được". **Then** PO status → CANCELLED. UPDATE `supply_snapshot_line SET reserved_for_transport -= 100 WHERE location_code='WH-MIK' AND item_code='SKU-X'` (line-level grain, KHÔNG header). Audit log + alert SC Manager.

### US-13: PO_OVERDUE alert
**Given** PO-003 CONFIRMED 8 ngày trước (overdue_days=7), chưa SHIPPED. **When** cron daily 09:00. **Then** alert M8 "PO-003 Mikado→CN-DN: 8 ngày chưa ship, follow-up NM".

### US-14: Variant review required
**Given** Cell từ M24 có `planner_review_required=TRUE, review_reason='VARIANT_MISMATCH'`. **When** generate PO line. **Then** mark line `requires_variant_review=TRUE`. UI hiển thị badge vàng. Planner phải review variant trước khi confirm PO.

### US-15: Top-up trace
**Given** PO line từ allocation_leg `source_type='TOP_UP_NEXT_WEEK', source_period_start=2026-04-27`. **When** generate. **Then** PO line `is_top_up=TRUE, source_period_start=2026-04-27`. UI tooltip "Ship sớm 1 tuần so với forecast (next week W18 → ship W17)". M28 audit "ship-ahead weeks".

### US-16: M28 đọc fulfillment
**Given** PO closed với actual_received_qty. **When** M28 cron compute honoring. **Then** `M27Service.getPoFulfillment(poId)` trả `{poId, nm_id, cn_id, status, lt_actual_days, lines: [{sku_id, period_start, confirmed_qty, actual_received_qty, ...}]}` — **PER-LINE array** (H4 fix). M28 iterate `lines[]` để backfill `nm_honoring_rate.fulfilled_total` per (nm, sku, week) — KHÔNG aggregate header.

### US-17: M7 vs M27 coexist
**Given** M7 vẫn chạy song song. **When** Planner mở `/orders` (M7 cũ) và `/po-review` (M27 mới). **Then** 2 UI tách biệt, data riêng. M27 flag off → fallback M7 export. Sau ≥ 1 tháng M27 stable, M7 deprecate (Sprint 15+).

---

## 7. Data Contract

### `po_run` (mới — wrapper)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `plan_run_id` BIGINT FK | Trace DRP |
| `allocation_run_id` BIGINT FK | Trace alloc |
| `transport_plan_id` BIGINT FK | Trace transport |
| `atp_run_id` BIGINT FK | Trace ATP |
| `policy_run_id` BIGINT FK | Rule 14 reuse |
| `status` VARCHAR(20) | RUNNING / COMPLETED / FAILED / BLOCKED_INCOMPLETE (H2 fix — bỏ BLOCKED_ATP. ATP FAIL/BLOCKED chỉ skip cell, KHÔNG block toàn run. Chỉ NO_CARRIER hard block run.) |
| `total_po_count`, `total_to_count` | Stats |
| `skipped_atp_fail_count`, `skipped_atp_blocked_count`, `clamped_atp_partial_count`, `variant_review_count`, `top_up_count` | Stats (H1+H2 fix — tách BLOCKED khỏi FAIL count) |
| `is_force_rerun` BOOLEAN DEFAULT FALSE | |
| `force_rerun_reason` TEXT NULL | Min 20 chars khi force |
| Partial UNIQUE | `(allocation_run_id) WHERE is_force_rerun=FALSE` (idempotent primary) |
| `created_by`, `created_at`, `completed_at` | |

### `po_header` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `po_run_id` BIGINT FK | |
| `po_number` VARCHAR(50) UNIQUE | Format `PO-YYYYMM-NNNNN` |
| `nm_id` BIGINT FK supplier | |
| `cn_id` BIGINT FK channel | Receiver |
| `status` VARCHAR(20) | DRAFT/CONFIRMED/SHIPPED/RECEIVED/CLOSED/CANCELLED |
| `total_qty` DECIMAL(15,2) | Σ confirmed_qty lines |
| `total_value_vnd` DECIMAL(18,2) DEFAULT 0 | Phase 1: 0 |
| `requested_eta` DATE | From M25 trip eta |
| `confirmed_at`, `confirmed_by` | Khi DRAFT → CONFIRMED |
| `cancelled_at`, `cancelled_by`, `cancel_reason` | Khi CANCELLED |
| `created_at`, `updated_at` | |

### `po_line` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `po_header_id` BIGINT FK | |
| `sku_id` BIGINT FK | |
| `variant_code` VARCHAR(60) NULL | NULL nếu chưa break variant |
| `requested_qty` DECIMAL(15,2) | M27 system suggest gốc |
| `confirmed_qty` DECIMAL(15,2) | Sau Planner edit |
| `actual_received_qty` DECIMAL(15,2) NULL | CN nhập khi RECEIVED |
| `unit_price_vnd` DECIMAL(15,2) DEFAULT 0 | Phase 1: 0 |
| `source_allocation_leg_id` BIGINT NULL FK allocation_leg | R15 lineage |
| `is_top_up` BOOLEAN DEFAULT FALSE | R16 |
| `source_period_start` DATE NULL | Khi is_top_up=TRUE |
| `requires_variant_review` BOOLEAN DEFAULT FALSE | R4 |
| `qty_exceeds_atp` BOOLEAN DEFAULT FALSE | Khi Planner override > ATP |
| `delivery_incomplete` BOOLEAN DEFAULT FALSE | actual < confirmed |
| `delivery_note` TEXT NULL | Mandatory khi delivery_incomplete |
| `status` VARCHAR(20) DEFAULT 'ACTIVE' | ACTIVE / CANCELLED (soft delete khi qty=0) |
| Composite UNIQUE | **H5 CTO fix:** `(po_header_id, sku_id, COALESCE(variant_code, ''))` qua expression index — vì PG `NULL != NULL` cho phép duplicate base-SKU lines. SQL: `CREATE UNIQUE INDEX uq_po_line ON po_line(po_header_id, sku_id, COALESCE(variant_code, ''));` |

### `to_header` + `to_line` (mới — tương tự, swap nm_id → donor_cn_id, cn_id → receiver_cn_id)

### `po_edit_log` (mới — R7 audit)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `po_header_id` BIGINT FK | |
| `po_line_id` BIGINT NULL FK | NULL khi edit header level |
| `field_changed` VARCHAR(50) | `qty / variant / sku_added / sku_removed / cancel` |
| `old_value` TEXT NULL | JSON serialize |
| `new_value` TEXT NULL | JSON serialize |
| `reason` TEXT NOT NULL | Mandatory non-empty |
| `changed_by` VARCHAR(100) | userId |
| `changed_at` TIMESTAMP DEFAULT NOW() | |

> `to_edit_log` tương tự cho TO.

### `po_tracking` (mới)
| Field | Mô tả |
|-------|-------|
| `po_header_id` BIGINT PK FK | 1-1 với po_header |
| `vehicle_no` VARCHAR(20) NULL | Mandatory khi SHIPPED |
| `carrier_code` VARCHAR(20) NULL FK carrier | Mandatory khi SHIPPED |
| `container_no` VARCHAR(30) NULL | Mandatory khi SHIPPED |
| `driver_name` VARCHAR(100) NULL | Optional |
| `driver_phone` VARCHAR(20) NULL | Optional |
| `nm_ship_date` DATE NULL | Khi NM ship |
| `actual_eta_date` DATE NULL | Recompute = nm_ship_date + transit_lt_days |
| `cn_received_date` DATE NULL | Khi CN nhận |
| `lt_actual_days` INT NULL | Computed = received - ship |
| `updated_by`, `updated_at` | |

> `to_tracking` tương tự, donor CN nhập SHIPPED, receiver CN nhập RECEIVED.

### API chính

```
# Generate run lifecycle
POST  /api/v1/po-review/run                          # Trigger từ M25+M26 callback (event)
POST  /api/v1/po-review/run/force-rerun              # Force với reason
GET   /api/v1/po-review/runs?limit=&status=          # List runs
GET   /api/v1/po-review/runs/:id                     # Detail + summary stats

# PO operations
GET   /api/v1/po-review/po?status=&nmId=&cnId=       # List with filters
GET   /api/v1/po-review/po/:id                       # Detail + lines + edit_log + tracking
PATCH /api/v1/po-review/po/:id/lines/:lineId         # Edit line qty/variant
POST  /api/v1/po-review/po/:id/lines                 # Add new line
DELETE /api/v1/po-review/po/:id/lines/:lineId        # Soft delete (qty→0)
POST  /api/v1/po-review/po/:id/confirm               # Confirm DRAFT→CONFIRMED, header Idempotency-Key
POST  /api/v1/po-review/po/:id/cancel                # Cancel + reason
PATCH /api/v1/po-review/po/:id/transition            # SHIPPED/RECEIVED/CLOSED transitions
PATCH /api/v1/po-review/po/:id/tracking              # Update vehicle/driver/etc
GET   /api/v1/po-review/po/:id/edit-log              # Audit history

# TO operations (parallel structure)
GET   /api/v1/po-review/to?status=&donorCnId=&receiverCnId=
GET   /api/v1/po-review/to/:id
PATCH /api/v1/po-review/to/:id/lines/:lineId
POST  /api/v1/po-review/to/:id/confirm               # Idempotency-Key
POST  /api/v1/po-review/to/:id/cancel
PATCH /api/v1/po-review/to/:id/transition
PATCH /api/v1/po-review/to/:id/tracking

# Internal (M28 inject)
# Method: M27Service.getPoFulfillment(poId): PoFulfillmentDto
# Method: M27Service.getActualLtPerNmRoute(nmId, cnId, fromDate, toDate): number[]
```

**Folder structure:**
```
backend/src/po-review/
├── po-review.module.ts
├── po-review.controller.ts            ← PO endpoints
├── to-review.controller.ts            ← TO endpoints
├── po-review.service.ts               ← lifecycle + run trigger
├── po-edit.service.ts                 ← edit + validation + audit log
├── po-transition.service.ts           ← state machine PO + TO
├── po-tracking.service.ts             ← vehicle/driver/ETA fields
├── po-overdue.service.ts              ← cron alert
├── dto/
└── entities/
    ├── po-run.entity.ts
    ├── po-header.entity.ts
    ├── po-line.entity.ts
    ├── to-header.entity.ts
    ├── to-line.entity.ts
    ├── po-edit-log.entity.ts
    ├── to-edit-log.entity.ts
    ├── po-tracking.entity.ts
    └── to-tracking.entity.ts
```

---

## 8. Cron & Trigger

| Trigger | Schedule (VN) | Purpose |
|---------|---------------|---------|
| **Auto generate** | Event AND condition: `M25 TransportPlanCompleted` AND `M26 AtpRunCompleted` | Trigger generate Draft PO/TO |
| **PO_OVERDUE alert** | `0 9 * * *` (09:00 VN daily) | PO CONFIRMED quá overdue_days chưa SHIPPED → alert |
| **TO_OVERDUE alert** | Cùng cron 09:00 | TO CONFIRMED quá overdue chưa SHIPPED |

> KHÔNG cron riêng cho main run — event-driven AND.

---

## 9. Non-functional

- Generate Draft < **2 phút** cho 100 cells (po_header + po_line + to)
- Confirm endpoint < 1s với idempotency check
- Edit qty với validation < 500ms
- Tracking update < 300ms
- PO/TO list query với pagination < 2s

---

## 10. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `supplier`, `channel`, `sku`, `sku_nm_mapping`, `carrier` | FK + validate edit (R8) |
| **M10** policy_run snapshot configs | `po.overdue_days`, validation thresholds |
| **M10** feature flag `m27_po_rebuild_enabled` | Rollback to M7 |
| **M21** freshness gate (transitive qua M26) | Stale → ATP **BLOCKED** (H1 sweep, không phải FAIL) |
| **M23** plan_run + policy_run | Trace lineage |
| **M24** `getAllocationResult()` + `allocation_leg` (cả TOP_UP_NEXT_WEEK source) | Source PO/TO generation |
| **M25** `getTransportPlan()` + NO_CARRIER hard gate (R3) + transport_trip_line.source_allocation_leg_id | Carrier+ETA + lineage |
| **M26** `getAtpResult(allocationRunId)` (M2 fix M26) + ATP gate (R2) | Skip BLOCKED + FAIL, clamp PARTIAL theo urgency_ranking |
| **Sprint 0 BUG-03** `idempotency_log` table | R13 reuse |
| **M2/M21** `supply_snapshot_line.reserved_for_transport` LINE-LEVEL (M25 C1 v1.2) | CANCEL release reservation (R11 + H3) per (location_code × item_code) |

| Feeds | Why |
|-------|-----|
| **M28 Feedback** | `getPoFulfillment(poId)` → SS auto-adjust + LT auto-update + override analysis |
| **M26 honoring rate** | Phase 2 backfill `actual_delivered` cho honoring rate (cross-link) |
| **M00 supplier** | Update `lead_time_days` rolling từ `lt_actual_days` (Phase 2 qua M28) |
| **M16 Hub ảo** (Phase 2) | PO RECEIVED → giảm Hub pool |
| **F1-B7 Commitment gap** (Phase 2) | Released vs committed tracking |
| **M8 Alerts** | PO_OVERDUE, SHIPMENT_LATE, DELIVERY_INCOMPLETE, BLOCKED_INCOMPLETE/ATP |
| **ERP (Bravo)** | Phase 2 PO sync after CONFIRMED |

---

## 11. DoD

- [ ] 9 tables migration + .down.sql: `po_run, po_header, po_line, to_header, to_line, po_edit_log, to_edit_log, po_tracking, to_tracking`
- [ ] Composite UNIQUE `po_line(po_header_id, sku_id, variant_code)` + tương tự to_line
- [ ] Partial UNIQUE `po_run(allocation_run_id) WHERE is_force_rerun=FALSE` (idempotent primary)
- [ ] PO/TO number generator (table-based seq, idempotent inside tx — pattern Sprint 0 BUG-03)
- [ ] Hard gate ATP service inject M26 (R2 H1 sweep) — skip BLOCKED + FAIL (semantics khác), clamp PARTIAL theo urgency_ranking.atp_alloc
- [ ] Hard gate NO_CARRIER service inject M25 (R3) — block toàn run
- [ ] Soft gate variant_review (R4) — mark line, không block
- [ ] State machine PO + TO với transition matrix (5 + CANCELLED)
- [ ] Mandatory fields per transition (R9 SHIPPED, R10 RECEIVED)
- [ ] Edit endpoints với validation (R7 R8) + mandatory reason → po_edit_log
- [ ] Idempotency-key middleware reuse Sprint 0 BUG-03 (R13)
- [ ] CANCEL rollback reservation về `supply_snapshot_line` LINE-LEVEL per (location_code × item_code) (R11 + H3, M27 v1.2 sweep)
- [ ] PO/TO source_allocation_leg_id link (R15)
- [ ] Top-up flag + source_period_start trace (R16)
- [ ] Cron PO_OVERDUE 09:00 VN (R12)
- [ ] Policy snapshot pin reuse từ M24 (R14)
- [ ] M25+M26 event AND wait listener
- [ ] `getPoFulfillment(poId)` injectable cho M28
- [ ] `getActualLtPerNmRoute()` injectable cho M28 LT update
- [ ] Performance < 2 phút generate Draft 100 cells
- [ ] FE: Tab PO + Tab TO tách riêng
- [ ] FE: Draft PO list với badge ATP status, source, ETA
- [ ] FE: Inline edit qty với mandatory reason dialog
- [ ] FE: Confirm dialog với idempotency-key auto-generate UUID
- [ ] FE: Tracking panel với vehicle/driver/eta fields
- [ ] FE: Edit log timeline per PO/TO
- [ ] FE: Variant review badge + dialog
- [ ] FE: Top-up tooltip "Ship sớm X tuần"
- [ ] FE: PO/TO history table với filter status/NM/CN/date
- [ ] FE: Export CSV
- [ ] Alert M8: BLOCKED_*, PO_OVERDUE, DELIVERY_INCOMPLETE, SHIPMENT_LATE
- [ ] Audit log mọi action
- [ ] Feature flag wrapper — off → fallback M7 logic (export endpoint M7)
- [ ] Transition coexist plan với M7 (sidebar 2 menu items, deprecate badge sau Sprint 14+)
- [ ] QA: 17 user stories pass

---

## 11b. Prerequisites — Cross-module contracts (CTO H1 v1.2)

> **Quan trọng:** M27 phụ thuộc 5 contract changes ở module khác. BE4 verify Sprint 7 Day 1, escalate nếu chưa formalize.

| Contract | Module owner | Sprint phải xong | Lý do |
|----------|--------------|------------------|-------|
| **`allocation_result.is_top_up BOOLEAN, source_top_up_id BIGINT, source_period_start DATE` + status enum `'TOP_UP_FILL'`** | M24 v1.0.2 | Sprint 5-6 (M24 close) | **H1 CTO v1.2 fix:** M27 Step 4 query đọc 3 fields này từ M24. Spec M24 v1.0.2 đã ALTER, nhưng dev verify code thực tế trước Sprint 7. |
| **`allocation_leg.source_type='TOP_UP_NEXT_WEEK'` + `source_period_start` + `origin_top_up_id`** | M24 v1.0.2 | Sprint 5-6 | M25 H1 cross-link — top-up tạo NEW result + leg trong cùng allocation_run |
| **`getTransportPlan()` throw `TransportPlanIncompleteException` + precedence** | M25 v1.2 | Sprint 6-7 | H5 M25 fix — single exception name. M27 R3 catch chuẩn |
| **`getAtpResult(allocationRunId)` Map keyed by `atpCellKey()`** | M26 v1.2 | Sprint 5-7 | M2 M26 fix — match idempotency primary key |
| **`supply_snapshot_line.reserved_for_transport`** | M21 + M25 | Sprint 3 + 6-7 | C1 M25 — line-level reservation rollback |

**M27 BE4 Sprint 7 Day 1 action:**
1. Verify allocation_result + allocation_leg M24 v1.0.2 columns deployed staging
2. Verify M25 + M26 services injectable + return contract đúng version
3. Verify line-level reservation column ALTER xong M21
4. Pair check với BE2 (M25/M26 owner) confirm cross-link contracts

---

## 12. Out of Scope

- **ERP integration thật (Bravo SFTP/API)** — Phase 2 (Phase 1 stub)
- **NM Portal direct API** — Phase 2 (Phase 1 NM nhập tracking qua web)
- **Multi-currency** — chỉ VND
- **PO contract/terms management** — thuộc Procurement system
- **Penalty financial calc** — Phase 2 (M14 commitment penalty trigger flag)
- **POD photo upload + driver app** — Phase 2 (Phase 1 chỉ form input)
- **Real-time GPS tracking** — Phase 2
- **Auto-cancel PO khi ATP changed sau confirm** — Phase 1 manual SC Manager
- **Multi-line PO consolidation** (gộp 2 PO same NM thành 1) — Phase 2

---

## 13. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| M27 vs M7 coexist conflict? | Folder + endpoint riêng. Feature flag rollback. M7 read-only sau M27 stable. Sprint 15+ deprecate code. Data M7 KHÔNG migrate sang M27 (giữ readonly tra cứu lịch sử). |
| Generate Draft auto-confirm hay manual? | **Manual.** Theo BR-F2B7-001 (human decision point). Auto chỉ generate DRAFT, Planner manual confirm. Window 00:30-05:00 VN. |
| ATP FAIL/BLOCKED skip vs block run? | Skip cell + alert. Run vẫn complete với cells khác. Block toàn run chỉ khi NO_CARRIER (M25 R3). Lý do: NM stale 1 SKU không nên block 99 SKU khác. |
| **[M1 CTO fix] Event AND correlation?** | Correlation key = `allocationRunId`. Pending state lưu trong bảng `po_run_pending(allocation_run_id PK, m25_done BOOLEAN, m26_done BOOLEAN)`. Listener 2 events update tương ứng. Khi cả 2 = TRUE → trigger M27 generate. Race-safe: ON CONFLICT UPDATE. Cleanup row sau khi trigger. |
| **[M2 CTO fix] Edit add SKU không có trong allocation?** | Validate qua M00 `sku_nm_mapping` (SKU thuộc NM) + check ATP từ `M26.getAtpResult(allocationRunId)` cho cell tương ứng. Nếu cell ATP không tồn tại trong run → trigger ad-hoc ATP check `M26.checkSingleCell(nm, sku, week)` (preferred) hoặc warning "ATP chưa scan, Planner responsibility" + flag `qty_exceeds_atp=TRUE`. SC Manager review. |
| Edit qty vượt ATP — block hay warning? | Warning + flag `qty_exceeds_atp=TRUE`. Planner có thể override (responsibility). Audit log + SC Manager review weekly. |
| TO confirm cũng cần idempotency-key? | Yes. Cùng pattern PO. UUID per confirm action. |
| CANCELLED sau SHIPPED? | KHÔNG. Hàng đã trên đường — phải qua RECEIVED rồi return process (out of scope Phase 1). |
| Multi-CN cùng NM gộp 1 PO? | KHÔNG (R5/BR-F2B7-004). Multi-drop transport gom shipping nhưng PO vẫn riêng per CN. Lý do: track per CN delivery, kế toán per CN. |
| Variant review block confirm? | Soft warning Phase 1. Planner có thể confirm khi đã đánh giá. UI hiển thị badge nổi bật. Phase 2 nếu cần hard block, add config. |
| PO number format? | `PO-YYYYMM-NNNNN` (5 digit seq monthly reset). TO: `TO-YYYYMM-NNNNN`. Table seq + reset cron monthly (giống M7 BUG-03 pattern). |
| ERP duplicate khi retry? | Idempotency-key + ERP-side check (Phase 2). Phase 1 stub: idempotency_log đủ. |
| LT actual update từ PO closed? | Yes. M28 cron weekly đọc po_tracking.lt_actual_days, rolling avg → update supplier.lead_time_days. M27 expose `getActualLtPerNmRoute()`. |

---

## 14. Lưu ý cho dev

1. **[H4 CTO fix] `getPoFulfillment(poId)` injectable — PER-LINE granularity** (1 PO có nhiều SKU lines):
   ```typescript
   {
     poId, poNumber, nm_id, cn_id, status,
     confirmed_at, shipped_at, received_at, closed_at,
     lt_actual_days,            // header-level: po_tracking.cn_received_date - nm_ship_date
     lines: [                   // ARRAY per po_line — H4 fix
       {
         lineId, sku_id, variant_code,
         period_start,           // per-line vì top-up có period khác
         requested_qty, confirmed_qty, actual_received_qty,
         is_top_up, source_period_start,
         delivery_incomplete, delivery_note
       }
     ]
   }
   ```
   M28 honoring/fill-rate consumer iterate `lines[]` để aggregate đúng per (NM, SKU, week), KHÔNG lấy aggregate header. Vì 1 PO có thể có 5 SKUs → 5 entries cho M28 honoring backfill.

2. **M28 `getActualLtPerNmRoute(nmId, cnId, from, to)` injectable**:
   ```sql
   SELECT lt_actual_days FROM po_tracking pt
   JOIN po_header h ON h.id = pt.po_header_id
   WHERE h.nm_id = $nm AND h.cn_id = $cn
     AND pt.cn_received_date BETWEEN $from AND $to
     AND pt.lt_actual_days IS NOT NULL
   ```
   Trả array để M28 compute rolling avg → update `supplier.lead_time_days`.

3. **Idempotency-key reuse Sprint 0 pattern:**
   ```typescript
   @Post(':id/confirm')
   confirm(
     @Param('id') poId: string,
     @Body() dto: ConfirmPoDto,
     @Headers('idempotency-key') key?: string,
   ) {
     return this.svc.confirm(poId, dto, key);
   }
   ```
   Service check `idempotency_log` trước/sau giống M7 BUG-03 fix.

4. **Hard gates wrap trong service `validateRunPrerequisites()`:**
   ```typescript
   async generate(allocationRunId) {
     const transportPlan = await m25.getTransportPlan(planId);  // throws if NO_CARRIER
     const atpResult = await m26.getAtpResult(planRunId);       // throws if ATP run not done
     // proceed Step 4 generate
   }
   ```

5. **State machine validate** trong `transitionPo()`:
   ```typescript
   const matrix = { DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['SHIPPED', 'CANCELLED'], ... };
   if (!matrix[currentStatus]?.includes(targetStatus))
     throw new InvalidTransitionException();
   // check mandatory fields per transition
   ```

6. **[H3 CTO fix] CANCEL rollback reservation — LINE-LEVEL (đúng grain M25 v1.2):**
   ```typescript
   tx.transaction(async em => {
     // Per po_line: lookup source allocation_leg → source location + item
     for (const line of poLines) {
       const leg = await em.findOne(AllocationLeg, { where: { id: line.sourceAllocationLegId } });
       const sourceLocationCode = ...;  // resolve từ leg.source_entity_id (HUB_VIRTUAL_ID hoặc donor CN)
       await em.query(
         `UPDATE supply_snapshot_line
          SET reserved_for_transport = reserved_for_transport - $1
          WHERE location_code = $2 AND item_code = $3
            AND snapshot_id = (SELECT id FROM supply_snapshot WHERE ... latest)`,
         [line.confirmedQty, sourceLocationCode, line.skuCode]
       );
     }
     UPDATE po_header SET status='CANCELLED', cancelled_at, cancel_reason;
     INSERT po_edit_log;
   });
   ```
   KHÔNG dùng `supply_snapshot.reserved_for_transport` (header level — KHÔNG tồn tại theo M25 C1 fix). Reservation grain phải khớp (location × item) với M25 reserve lifecycle.

7. **Bulk insert Draft PO** chunk 500 (pattern M9/M22/M23/M25). 100 cells × ~3 lines/cell = 300 rows OK 1 chunk.

8. **PO_OVERDUE cron compute**:
   ```sql
   SELECT id, po_number FROM po_header
   WHERE status='CONFIRMED'
     AND confirmed_at < NOW() - INTERVAL '$overdue_days days'
   ```
   For each → alert M8.

9. **Edit log JSONB serialize old/new** — đơn giản: `JSON.stringify({qty: 93})`. M28 audit query parse.

10. **M7 fallback path** khi flag off:
    - Skip generate M27
    - Trigger M7 export (existing endpoint)
    - Sidebar 2 menu items với badge "v1 (legacy)" cho M7

11. **Folder Rule 3 check:** REBUILD = NEW folder `src/po-review/` (kebab-case). KHÔNG đụng `src/orders/` (M7). KHÔNG bọc `v2/`.

12. **TO controllers tách riêng** `to-review.controller.ts` để FE Tab PO/TO clean. KHÔNG gộp endpoint `/po-review/{po,to}/...` chung route.

13. **Validation edit qty FE-side preview** trước call BE — preview ATP check qua endpoint `/po-review/po/:id/lines/:lineId/preview-edit` (no save) để Planner thấy warning trước.

---

*M27 PO/TO Review & Confirm (REBUILD) Spec v1.2 — 2026-04-17 (CTO sweep round 2: 1 high + 2 medium clean — top-up M24 prerequisite, supply_snapshot_line sweep, US-1 timing)*
