# M12 — S&OP Consensus

> **Ngày:** 2026-04-17 · **Phase:** 2 · **Sprint:** 7-8
> **Owner:** BE3 · **DA:** DA2 · **FE:** FE2
> **Status:** 🔴 NEW — folder mới `src/saop-consensus/`
> **PRD:** §F1-B2 S&OP Consensus · **Flow:** 1 (Monthly Booking, Day 3-10)
> **Domain:** D2 Demand Planning
> **Feature flag:** `m12_saop_consensus_enabled`
> **Folder (Rule 3):** `backend/src/saop-consensus/` (NEW, không bọc v2/)

---

## 1. Tại sao làm bài này

Hiện UNIS làm S&OP thủ công qua Excel + email + meeting → số FC thay đổi liên tục mỗi ngày → NM commitment không ổn định, CN không tin số → DRP nightly chạy trên data sai.

M12 chuẩn hóa monthly cycle:
1. **2-tier adjust** — SC Manager adjust cấp Tổng, CN Manager adjust cấp CN của mình
2. **Variance reconciliation** — gap Tổng vs Σ(CN) > ±10% phải được giải thích trước khi lock
3. **Deadline cứng** — Day 3 input, Day 5 reconcile, Day 7 lock manual, Day 10 auto-lock fallback
4. **FVA tracking** — đo human adjustment có cải thiện FC không (Phase 2 unlock khi có actual_sales)
5. **Output: Locked Demand** → input cho M13 Production Lot Sizing + M14 Commitment

---

## 2. Scope

### ✅ Thêm (NEW module)
- 4 bảng mới: `saop_cycle`, `saop_adjustment`, `saop_deadline`, `fva_log`
- Workflow state machine cho cycle (DRAFT → OPEN → REVIEWING → RECONCILING → APPROVED → LOCKED)
- 2-tier adjust API + RBAC scope
- Variance computation real-time (Tổng vs Σ CN)
- Deadline cron daily check + reminder + Day 10 auto-lock
- FVA tracking schema (Phase 1 stub, Phase 2 unblock với M28)
- Service `getLockedDemand(cycleMonth)` export cho M13 + M14 inject

### ❌ Không đụng
- M11 demand snapshot — M12 đọc qua `M11Service.getAggregatedDemand()`
- B2B editable — M12 reuse `M11Service.updateB2BDeal()` (sync về M11)
- Statistical FC engine — không build, chỉ consume
- Real-time collab editing FULL (cursor + presence) — Phase 2 (Phase 1 dùng optimistic locking + last-edited badge)

---

## 3. Business Rules

| ID | Rule | Note |
|----|------|------|
| **R1** | 1 cycle = 1 tháng (period_month = YYYY-MM-01). Mở cycle mới = Day 1. | SC Manager hoặc cron auto-open Day 1 |
| **R2** | **Review focus M+1, M+2, M+3** (3 tháng gần). Data hiển thị 12 tháng nhưng chỉ adjust 3 tháng | Configurable horizon |
| **R3** | Variance Tổng vs Σ(CN) > ±10% (M10 config) → **highlight đỏ**, SC Manager phải nhập explanation trước lock | Hard gate |
| **R4** | Variance AOP (Finance budget) vs Σ(CN) > ±10% → highlight đỏ, SC Manager giải thích | Phase 2 nếu có AOP source |
| **R5** | RBAC: Sales/CN Manager scope own CN; SC Manager full + sole lock authority; Finance view-only | Same convention M11/M22 |
| **R6** | Day 7 SC Manager lock manual. Day 10 chưa lock → cron auto-lock với fallback v0 (FC raw từ M11) + alert | Deadline gate |
| **R7** | LOCKED cycle = immutable. Không edit. M13/M14 đọc snapshot này. Reopen = SC Manager với mandatory reason + audit | Lock authority |
| **R8** | B2B edit tại M12 → call `M11Service.updateB2BDeal()` → M11 recompute weighted demand → M12 refresh aggregate | Single source of truth ở M11 |
| **R9** | Mọi adjustment phải có `reason_text` non-empty. Optimistic lock với `version` column → conflict nếu 2 user cùng edit cell | Audit + concurrency |
| **R10** | FVA Phase 1 stub: `fva_pct = NULL` cho đến khi M28 backfill `actual_sales` 30-60 ngày sau cycle close | Phase 2 unblock |

---

## 4. Workflow State Machine

```
[Day 1]   SC Manager open     →  DRAFT      (chưa có adjustment nào)
[Day 1-3] CN/Sales nhập       →  OPEN       (>= 1 adjustment)
[Day 3-5] Bottom-up complete  →  REVIEWING  (SC Manager bắt đầu review)
[Day 5-7] SC reconcile        →  RECONCILING (variance được explain)
[Day 7]   SC Manager lock     →  APPROVED → LOCKED
[Day 10]  Cron auto-lock      →  LOCKED (fallback FC v0 nếu chưa APPROVED)
```

**Transitions:**

| From | To | Trigger | Actor |
|------|-----|---------|-------|
| (none) | DRAFT | Open cycle | SC Manager (or cron Day 1) |
| DRAFT | OPEN | First adjustment submitted | Auto |
| OPEN | REVIEWING | SC Manager click "Start review" | SC Manager |
| REVIEWING | RECONCILING | Variance > 10% detected, explanation pending | Auto |
| RECONCILING | APPROVED | All variance explained | SC Manager |
| APPROVED | LOCKED | Lock manual button | SC Manager |
| Any | LOCKED | Cron Day 10 23:59 | SYSTEM |
| LOCKED | DRAFT | Reopen với mandatory reason (rare) | SC Manager only |

**Versions (logical, derived từ adjustment history):**
- v0 = FC raw từ M11 (snapshot lúc open cycle)
- v1 = sau Sales/CN adjust
- v2 = sau SC Manager reconcile
- v3 = LOCKED final

---

## 5. FVA — Forecast Value-Add (Phase 2 ready)

**Định nghĩa:** Đo human adjustment có cải thiện accuracy không.

```
FVA = (|fc_before - actual| - |fc_after - actual|) / actual × 100

FVA > 0 → adjustment cải thiện (giảm error)
FVA < 0 → adjustment làm tệ hơn (cần training)
FVA ≈ 0 → adjustment không tác dụng
```

**Phase 1:** Schema `fva_log` ready, `fc_before/fc_after` được ghi khi cycle LOCKED. `actual` + `fva_pct` = NULL chờ M28 backfill 30-60 ngày sau.

**Phase 2:** M28 cron backfill actual_sales → compute fva_pct → dashboard hiển thị FVA per user/CN/SKU.

---

## 6. User Stories (Acceptance)

### US-1: SC Manager mở cycle mới
**Given** Day 1 tháng 5/2026, không có cycle 2026-05. **When** SC Manager click "Open S&OP cycle". **Then** insert `saop_cycle (period_month=2026-05-01, status=DRAFT)`, snapshot FC raw từ M11 vào `saop_adjustment` với `original_qty`, seed 4 deadlines.

### US-2: CN Manager adjust FC CN của mình
**As CN-BD Manager**, mở `/saop/2026-05` → tab "Cấp CN" → cell GA-300 M+1 = 500m². **When** edit thành 580m² + reason "nhà thầu mới". **Then** insert `saop_adjustment` (cn_id=BD, sku_id=GA-300, level=CN, original=500, adjusted=580, reason). Cycle status DRAFT → OPEN.

### US-3: SC Manager adjust cấp Tổng
**As SC Manager**, mở tab "Cấp Tổng" → GA-300 M+1 = 8.000m². **When** giảm 800m² (loại deal Phú Thịnh probability thấp) + reason. **Then** adjustment ghi với level=TOTAL, cn_id=NULL.

### US-4: Variance reconcile
**Given** Top-down GA-300 M+1 = 7.200m² adjusted, Σ(CN GA-300 M+1) = 6.500m² (gap -9.7%). **When** SC Manager mở variance view. **Then** highlight VÀNG (gần ngưỡng). Khi gap > 10% → ĐỎ, button Lock disabled cho đến khi SC Manager nhập explanation.

### US-5: SC Manager redistribute
**As SC Manager**, redistribute: tăng CN-BD 650→700, giảm CN-HN 500→450 cho GA-300 M+1. **Save** → 2 adjustments insert. Σ(CN) không đổi. Variance Tổng vs Σ(CN) cập nhật real-time.

### US-6: Day 7 lock
**Given** Day 7, status APPROVED, mọi variance explained. **When** SC Manager click "Lock cycle". **Then** status → LOCKED, locked_at + locked_by ghi. Mọi adjustment endpoint từ giờ trả 409 "Cycle locked". M13/M14 trigger consume.

### US-7: Day 10 auto-lock fallback
**Given** Day 10 23:59, cycle status vẫn OPEN/REVIEWING. **When** cron fire. **Then** status → LOCKED với `locked_by='SYSTEM_AUTO'`. Final demand = v0 raw từ M11 (rollback adjustments). Alert SC Manager + Planner: "Cycle 2026-05 auto-locked do quá deadline. Data dùng FC raw."

### US-8: Sales scope
**As Sales CN-DN**, mở `/saop` → chỉ thấy/edit cells của CN-DN. Tab "Cấp Tổng" disabled. KHÔNG thấy CN khác.

### US-9: Optimistic lock conflict
**Given** SC Manager A đang edit GA-300 M+1, version=3. **When** SC Manager B cũng edit cell đó từ tab khác và save trước. **Then** A nhận 409 "Conflict — cell đã thay đổi by user B. Refresh và edit lại." (Phase 1 mvp; Phase 2 real-time presence.)

### US-10: M13 đọc locked demand
**Given** Cycle 2026-05 status=LOCKED. **When** M13 trigger Day 10. **Then** gọi `M12Service.getLockedDemand('2026-05')` → trả Map per cấp. M13 dùng để tính booking.

---

## 7. Data Contract

### `saop_cycle` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `period_month` DATE UNIQUE | YYYY-MM-01 |
| `status` VARCHAR(20) | DRAFT / OPEN / REVIEWING / RECONCILING / APPROVED / LOCKED |
| `opened_by`, `opened_at` | Audit |
| `locked_by`, `locked_at` | Khi LOCKED. `locked_by='SYSTEM_AUTO'` nếu Day 10 cron |
| `lock_reason` TEXT NULL | Mandatory khi reopen |
| `created_at`, `updated_at` | |

### `saop_adjustment` (mới)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `cycle_id` BIGINT FK saop_cycle | |
| `level` VARCHAR(10) | TOTAL / CN |
| `cn_id` BIGINT NULL FK channel | NULL khi level=TOTAL |
| `sku_id` BIGINT FK sku | |
| `period_offset` INT | 1=M+1, 2=M+2, 3=M+3 (chỉ 3 tháng review) |
| `original_qty` DECIMAL(15,2) | Snapshot từ M11 lúc open |
| `adjusted_qty` DECIMAL(15,2) | User input |
| `delta_pct` DECIMAL(7,4) | Tính sẵn |
| `reason_text` TEXT NOT NULL | Mandatory non-empty (R9) |
| `adjusted_by` VARCHAR(100) | userId |
| `adjusted_at` TIMESTAMP | |
| `version` INT NOT NULL DEFAULT 1 | Optimistic lock counter |
| Composite UNIQUE | `(cycle_id, level, cn_id, sku_id, period_offset)` — 1 row per cell, update qua version increment |

### `saop_deadline` (mới)
| Field | Mô tả |
|-------|-------|
| `cycle_id` FK | |
| `milestone` VARCHAR(10) | DAY3 / DAY5 / DAY7 / DAY10 |
| `due_date` DATE | Compute từ period_month + offset |
| `completed_at` TIMESTAMP NULL | Khi đạt status tương ứng |
| `reminder_sent_at` TIMESTAMP NULL | Cron mark sau khi alert |
| Composite PK | `(cycle_id, milestone)` |

### `fva_log` (mới — Phase 2 backfill)
| Field | Mô tả |
|-------|-------|
| `id` BIGSERIAL | |
| `cycle_id` FK | |
| `cn_id` BIGINT NULL | NULL = TOTAL level |
| `sku_id` FK | |
| `period_offset` INT | |
| `fc_before` DECIMAL(15,2) | v0 raw từ M11 |
| `fc_after` DECIMAL(15,2) | LOCKED final |
| `actual_qty` DECIMAL(15,2) NULL | Backfill từ M28 |
| `fva_pct` DECIMAL(7,4) NULL | Compute khi actual có |
| `adjusted_by` VARCHAR(100) | Who made the adjustment |

### API chính

```
# Cycle lifecycle
POST   /api/v1/saop/cycle/open?month=2026-05         # SC Manager open
POST   /api/v1/saop/cycle/:id/lock                    # SC Manager lock manual
POST   /api/v1/saop/cycle/:id/reopen                  # SC Manager reopen + reason
GET    /api/v1/saop/cycle?month=2026-05               # Get cycle status
GET    /api/v1/saop/cycle/:id/timeline                # Deadlines + status history

# Adjustment
PATCH  /api/v1/saop/cycle/:id/adjust                  # Body: { level, cnId?, skuId, periodOffset, adjustedQty, reasonText, version }
GET    /api/v1/saop/cycle/:id/adjustments?cnId=&level=  # List với RBAC scope
GET    /api/v1/saop/cycle/:id/variance                 # Per SKU: TOTAL vs Σ(CN), color band
POST   /api/v1/saop/cycle/:id/variance/:skuId/explain  # SC Manager nhập explanation cho variance > 10%

# B2B (proxy về M11)
PATCH  /api/v1/saop/cycle/:id/b2b/:dealId             # Calls M11Service.updateB2BDeal()

# FVA (Phase 2 ready)
GET    /api/v1/saop/fva?month=&cnId=&userId=          # Dashboard, Phase 1 trả NULL nếu chưa có actual

# Internal (M13/M14 inject)
# Method: M12Service.getLockedDemand(periodMonth: string): LockedDemandDto
```

**Folder structure:**
```
backend/src/saop-consensus/
├── saop-consensus.module.ts
├── saop-consensus.controller.ts
├── saop-cycle.service.ts                ← lifecycle + lock
├── saop-adjustment.service.ts           ← adjust với optimistic lock
├── saop-variance.service.ts             ← compute variance + explain
├── saop-deadline.service.ts             ← cron + reminder
├── saop-fva.service.ts                  ← Phase 2 backfill
├── dto/
└── entities/
```

---

## 8. Cron Schedules

| Cron | Schedule (VN) | Purpose |
|------|---------------|---------|
| **Auto-open** | `0 7 1 * *` (Day 1, 07:00 VN) | Open cycle tháng mới nếu chưa có |
| **Deadline reminder** | `0 9 * * *` (mỗi ngày 09:00) | Check deadlines DAY3/5/7 sắp tới → alert assigned actors |
| **Day 10 auto-lock** | `59 23 * * *` (mỗi ngày 23:59) | Check cycle nào quá Day 10 chưa LOCKED → force lock fallback v0 |

Decorator: `@Cron(..., { timeZone: 'Asia/Ho_Chi_Minh' })`.

---

## 9. Non-functional

- Aggregate 50 CN × 500 SKU × 3 tháng load < 5s (NFR-F1B2-001)
- Variance computation real-time per SKU < 1s
- Adjustment save với optimistic lock < 500ms
- FVA query (khi Phase 2 active) per cycle < 10s

---

## 10. Dependencies

| Depends on | Why |
|-----------|-----|
| **M00** `channel`, `sku` | FK lookup |
| **M10** config `consistency_threshold_pct` (10%), `saop.deadline.day3/5/7/10` | Tuning |
| **M10** feature flag `m12_saop_consensus_enabled` | Rollback |
| **M11** `getAggregatedDemand(month)` | Snapshot v0 lúc open cycle |
| **M11** `updateB2BDeal(id, ...)` | B2B sync (R8) |
| **M28** (Phase 2) `actual_sales` | FVA backfill |

| Feeds | Why |
|-------|-----|
| **M13** Production Lot Sizing | `getLockedDemand(month)` → input booking |
| **M14** FC Commitment | Same locked demand → tách commitment tiers |
| **M9** Plan vs Actual | Phase 2 FVA dashboard tích hợp |
| **M8** Alerts | Day 10 auto-lock alert, variance > 10% alert |

---

## 11. RBAC Matrix

| Role | View | Edit Tổng | Edit CN | Reconcile/Lock | B2B edit |
|------|------|-----------|---------|----------------|----------|
| Sales (CN-X) | Own CN | ❌ | Own CN cells | ❌ | Own deals |
| CN Manager (CN-X) | Own CN + Tổng aggregate | ❌ | Own CN cells | ❌ | Own deals |
| SC Manager | All | ✅ | All CN | ✅ Sole authority | All deals |
| Finance | All | ❌ | ❌ | ❌ | ❌ View-only |
| Planner | All | ❌ | ❌ | ❌ | View |
| SYSTEM (cron) | — | — | — | Day 10 force lock only | — |

Phase 1: header `X-User-Role` + `X-CN-Code` (free text). Phase 2: JWT.

---

## 12. DoD

- [ ] 4 tables migration + .down.sql + composite UNIQUE constraint trên `saop_adjustment`
- [ ] Workflow state machine implementation (transition validation, reject invalid moves)
- [ ] Cycle lifecycle endpoints (open/lock/reopen) với RBAC + audit
- [ ] Adjust endpoint với optimistic lock (`version` increment, conflict detection)
- [ ] Variance computation service real-time
- [ ] Variance explanation gate — block lock nếu chưa explain
- [ ] B2B proxy endpoint → call M11Service.updateB2BDeal()
- [ ] FVA service Phase 1 stub (write fc_before/fc_after khi LOCKED)
- [ ] 3 cron jobs (auto-open, reminder, Day 10 auto-lock) với timezone VN
- [ ] `getLockedDemand(periodMonth)` injectable cho M13/M14
- [ ] FE: Timeline bar Day 3/5/7/10 với badge status
- [ ] FE: 2 tabs (Tổng + CN) inline edit với optimistic lock
- [ ] FE: Variance indicator (yellow >5%, red >10%)
- [ ] FE: Lock button + confirmation + variance gate
- [ ] FE: RBAC scope hide unauthorized cells
- [ ] FE: "Last edited by X 30s ago" badge per cell (Phase 1 polling 30s — KHÔNG phải WebSocket)
- [ ] Alert integration M8: variance >10%, Day 10 auto-lock, lock-without-review
- [ ] Audit log mọi action (open/adjust/lock/reopen/explain)
- [ ] Feature flag wrapper — off → 503; M13 fallback đọc M11 raw
- [ ] QA: 10 user stories pass

---

## 13. Out of Scope

- **Statistical FC engine** — M11 nhận từ ngoài, M12 chỉ adjust
- **NM commitment generation** — M14
- **Real-time WebSocket collab editing FULL** — Phase 2 (Phase 1: optimistic lock + 30s polling badge)
- **Video meeting / chat tích hợp** — chỉ data pack
- **Multi-currency** — chỉ VND
- **Multi-tenant** — single tenant Phase 1
- **AOP/Finance budget integration** — Phase 2 nếu có nguồn AOP
- **Mobile app** — Phase 2

---

## 14. Risk & Decisions chốt

| Vấn đề | Decision |
|--------|----------|
| Real-time collab editing có khả thi Sprint 7-8? | **KHÔNG.** Phase 1 dùng optimistic lock + 30s polling badge "last edited by X". WebSocket Phase 2. Tránh over-engineering. |
| Variance threshold 10% — đúng? | Theo PRD §F1-B2 BR-003. M10 config có thể adjust sau review Phase 1. |
| Auto-lock Day 10 fallback v0 — risk gì? | **Risk:** team không kịp adjust → FC raw có thể sai → DRP M+1 lệch lớn. **Mitigation:** alert sớm Day 5/7/9. Day 10 force lock + alert ĐỎ Planner+SC Manager+CFO. SC Manager có thể reopen sau với mandatory reason. |
| Optimistic lock conflict — UX thế nào? | Phase 1: 409 + message "Refresh và edit lại". Phase 2 real-time presence để tránh conflict ngay từ đầu. |
| B2B edit ở M11 hay M12? | **Edit được ở cả 2** (R8). Source of truth = M11. M12 endpoint là proxy → M11Service. Tránh duplicate logic. |
| FVA chưa có actual → hiển thị thế nào? | Badge xám "Pending Phase 2" trong dashboard. Schema sẵn, không hiển thị 0% gây hiểu nhầm. |
| Reopen LOCKED cycle có cho phép? | **Có** nhưng strict: SC Manager only + mandatory reason text + audit. M13/M14 đã consume sẽ KHÔNG re-trigger automatically (manual rerun). Use case rare: phát hiện sai số nghiêm trọng sau khi NM commit. |
| Composite UNIQUE allow update? | **Có.** Update qua version increment. INSERT mới với cùng key sẽ conflict — service-layer phải dùng UPDATE WHERE version=$old. |

---

## 15. Lưu ý cho dev

1. **`getLockedDemand(periodMonth)` injectable** — M13/M14 inject trực tiếp. Trả `LockedDemandDto`: `{ cycleId, periodMonth, totalLevel: Map<sku_id, qty[3]>, cnLevel: Map<{cn_id, sku_group}, qty[3]> }`. Throw `CycleNotLockedException` nếu chưa LOCKED → M13/M14 fallback M11 raw.

2. **Optimistic lock** trong adjust endpoint:
   ```
   UPDATE saop_adjustment
   SET adjusted_qty=$new, version=version+1, adjusted_by=$user, adjusted_at=NOW()
   WHERE cycle_id=$id AND level=$lvl AND cn_id IS NOT DISTINCT FROM $cn AND sku_id=$sku AND period_offset=$offset
     AND version=$expectedVersion
   ```
   Nếu rowCount=0 → 409 conflict.

3. **State machine guard** — service method `transitionCycle(id, targetStatus)` validate transition trong bảng decisions. Reject invalid (e.g. LOCKED → DRAFT chỉ qua reopen flow).

4. **Variance explanation gate** — service `canLock(cycleId)` check: tất cả cells variance > 10% phải có explanation. Endpoint lock gọi check này trước.

5. **B2B proxy** — controller endpoint `PATCH /saop/cycle/:id/b2b/:dealId` chỉ wrap call `M11Service.updateB2BDeal()` + audit log. KHÔNG duplicate B2B logic ở M12.

6. **Cron Day 10 auto-lock** — chạy 23:59 VN. Trước khi force lock, check `cycle.status NOT IN ('LOCKED', 'APPROVED')`. Audit `locked_by='SYSTEM_AUTO'` để dashboard filter dễ.

7. **Folder Rule 3 check:** Đây là NEW module → tạo `src/saop-consensus/` (kebab-case). KHÔNG đặt vào `src/demand/saop/` (sai domain — D2 nhưng entity hoàn toàn mới, không extend M11/M1).

8. **FVA Phase 2 trigger** — khi M28 backfill actual_sales, gọi `SaopFvaService.computeFva(cycleId)` → UPDATE `fva_log.actual_qty + fva_pct`. Phase 1 method này tồn tại nhưng chỉ log "Pending actual_sales".

9. **Period offset:** Lưu `period_offset` (1/2/3) thay vì absolute date để FE compute date từ `cycle.period_month + offset` → cleaner queries, cycle dùng lại được logic.

---

*M12 S&OP Consensus Spec v1.0 — 2026-04-17*
