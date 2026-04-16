# FLOW 2 — Logic & Data Flow Validation Report
**Date:** 2026-04-16  
**Scope:** M21 → M22 → M23 → M24 → M25 → M26 → M27 → M28 (Daily DRP Flow)  
**Reviewer:** Cascade AI  
**Base specs reviewed:** M21 v1.1, M22 v1.1, M23 v1.0.2, M24 v1.0.2, M25 v1.2, M26 v1.2, M27 v1.2, M28 v1.2  
**Related docs:** PRD-v2.0-MAPPING.md, GROUP-MODULE.md, IMPLEMENT-CHECKLIST.md

---

## 1. Resolved Issues (Fixed Before This Session)

| # | Issue | Evidence |
|---|-------|----------|
| R1 | `allocation_result` top-up fields thiếu (`is_top_up`, `source_top_up_id`, `source_period_start`) | Entity + V005 migration đều đã có |
| R2 | M23→M24 callback hook không được wiring | `onModuleInit` dùng `setPostCompletedHook` — đã confirmed |
| R3 | `max_transfer_pct` cap per-transfer thay vì cumulative per-donor | Đã fix + unit test `donorTransferred` map |
| R4 | `policy_run_id` chain M23→M24 | V005 migration thêm FK `allocation_run.policy_run_id` |

---

## 2. CRITICAL — Breaking Blockers

### GAP-1 🔴 M21 không persist `supply_snapshot_line` rows

**File:** `backend/src/data-sync/data-sync.service.ts` — `uploadNmCsv()` (line ~125–157)

**Vấn đề:**  
Service parse `atp_qty` từ CSV, validate xong, nhưng **không INSERT bất kỳ `SupplySnapshotLine` row nào**. Chỉ tạo `SupplySnapshot` header + `SyncLog`. `validRows` (bao gồm `atp_qty`, `available_qty`) hoàn toàn bị discard.

```typescript
// Hiện tại — thiếu đoạn insert lines
const savedSnapshot = await em.save(SupplySnapshot, snapshot);
const savedLog = await em.save(SyncLog, log);
return { snapshotId: savedSnapshot.id, rowsImported: validRows.length, syncLogId: savedLog.id };
// validRows chứa atp_qty + available_qty nhưng KHÔNG được persist!
```

**Fix cần làm:**
```typescript
// Cần thêm bulk insert supply_snapshot_line
const lines = validRows.map(r => em.create(SupplySnapshotLine, {
  snapshotId:     savedSnapshot.id,
  itemCode:       r.sku_code,
  locationCode:   nmCode,           // hoặc lookup location_code của NM
  allocatableQty: r.available_qty,
  atpQty:         r.atp_qty,        // ← cần thêm column (xem GAP-2)
}));
await em.save(SupplySnapshotLine, lines);
```

**Impact chain:**
- M23 DRP netting không có `on_hand_cn`, `in_transit_qty` → netting sai toàn bộ
- M26 ATP check không có `atp_qty` → ATP check không chạy được
- **Đây là blocker lớn nhất của toàn bộ Flow 2**

**Owner:** BE1 (M21) | **Sprint:** Sprint 3 HOTFIX

---

### GAP-2 🔴 `supply_snapshot_line.atp_qty` column không tồn tại

**File:** `backend/src/supply/entities/supply-snapshot-line.entity.ts`

**Vấn đề:**  
Entity không có `atp_qty` column. M26 spec §11b yêu cầu:
> "Migration: `supply_snapshot_line.atp_qty DECIMAL(15,2) NULL` — M21 ownership, Sprint 3"

Không tìm thấy migration nào thêm column này.

**Fix cần làm:**
1. Thêm column vào entity:
```typescript
@Column({ name: 'atp_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
atpQty: number | null;
```
2. Tạo migration `ALTER TABLE supply_snapshot_line ADD COLUMN IF NOT EXISTS atp_qty DECIMAL(15,2) NULL`

**Owner:** BE1 (M21) | **Sprint:** Sprint 3

---

### GAP-3 🔴 `supply_snapshot_line.reserved_for_transport` column không tồn tại

**File:** `backend/src/supply/entities/supply-snapshot-line.entity.ts`

**Vấn đề:**  
M25 spec §7 (C1+C4 fix) định nghĩa và ghi vào column `reserved_for_transport` tại line-level. M23 Step 5 phải đọc column này để tính:
```
available_qty = allocatable_qty - reserved_qty - reserved_for_transport - in_transit_qty
```
Column không tồn tại trong entity lẫn DB → công thức netting sai, runtime error khi M25 cố ghi.

**Fix cần làm:**
1. Entity: `@Column({ name: 'reserved_for_transport', type: 'decimal', precision: 15, scale: 2, default: 0 }) reservedForTransport: number;`
2. Migration: `ALTER TABLE supply_snapshot_line ADD COLUMN IF NOT EXISTS reserved_for_transport DECIMAL(15,2) NOT NULL DEFAULT 0`
3. CANCEL PO/TO (M27 R11 + H3) cần rollback column này tại level (location_code × item_code)

**Owner:** BE2 (M25 prerequisite) | **Sprint:** Sprint 6 prerequisite (phải xong trước M25 implement)

---

### GAP-4 🔴 `AllocationRunCompleted` event không được emit (M24→M26 trigger hoàn toàn thiếu)

**Grep result:** `AllocationRunCompleted` → 0 matches | `@OnEvent` → 0 matches | `EventEmitter` → 0 matches

**Vấn đề:**  
M26 spec DoD yêu cầu: `[ ] M24 callback event listener @OnEvent('AllocationRunCompleted')`. M24 không emit event này. M25 và M26 phải chạy **parallel** sau M24 hoàn thành, nhưng:
- M24→M25 trigger: không có `setPostCompletedHook` thứ 2 (chỉ có hook M23→M24)
- M24→M26 trigger: hoàn toàn không có cơ chế nào

Hiện tại M25 và M26 chỉ chạy được qua manual trigger.

**Fix cần làm (2 options):**

Option A — NestJS EventEmitter (khuyến nghị — đúng spec M26):
```typescript
// M24 — sau khi runV2() hoàn thành
this.eventEmitter.emit('allocation.run.completed', { allocationRunId, planRunId });

// M25 — listener
@OnEvent('allocation.run.completed')
async handleAllocationCompleted(payload: { allocationRunId: string }) { ... }

// M26 — listener
@OnEvent('allocation.run.completed')
async handleAllocationCompleted(payload: { allocationRunId: string }) { ... }
```

Option B — Dual hook injection (giống M23→M24):
```typescript
// M24
private _postM25Hook?: (runId: string) => Promise<void>;
private _postM26Hook?: (runId: string) => Promise<void>;
setPostM25Hook(fn) { this._postM25Hook = fn; }
setPostM26Hook(fn) { this._postM26Hook = fn; }
// Gọi cả 2 sau khi complete
```

**Owner:** BE2 (M24/M25/M26) | **Sprint:** Sprint 5-6

---

### GAP-5 🔴 `allocation_result.status` TypeScript union thiếu `'TOP_UP_FILL'`

**File:** `backend/src/allocation/entities/allocation-result.entity.ts:42-43`

```typescript
// Hiện tại — thiếu TOP_UP_FILL
status: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED' | 'FULL' | 'PARTIAL_STOCKOUT';
```

M25 §6b yêu cầu: khi M25 accept top-up → tạo row mới với `status = 'TOP_UP_FILL'`. Nếu giữ nguyên TS type hiện tại → compile-time error.

**Fix:**
```typescript
status: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED' | 'FULL' | 'PARTIAL_STOCKOUT' | 'TOP_UP_FILL';
```

**Owner:** BE2 (M24) | **Sprint:** Sprint 5-6 (trước khi M25 implement)

---

## 3. HIGH — Cross-Module Contract Gaps

### GAP-6 🟡 `sigma_history` table không tồn tại (M28→M23 feedback loop)

**Vấn đề:**  
M28 spec §6 định nghĩa bảng mới:
```
sigma_history(id, cn_id, sku_id, sigma_demand, sample_size, source, confidence, calculated_at, weekly_snapshot_id)
UNIQUE (cn_id, sku_id, calculated_at)
INDEX (cn_id, sku_id, calculated_at DESC)  -- M23 lookup latest
```

M28 weekly (Monday 06:00) ghi vào bảng này. M23 nightly sau đó phải đọc `sigma_history` để refresh `ss_cn` — thay vì recompute `σ_demand` từ đầu mỗi ngày.

Không có entity, migration, hoặc service nào cho `sigma_history` trong codebase.

**Impact:** Toàn bộ SS auto-adjust closed-loop là unimplemented. M23 sẽ dùng hard-coded `σ_demand` mãi mãi, không tự học từ actual data.

**Fix cần làm:**
1. M28 team tạo `sigma_history` entity + migration (Sprint 9)
2. M23 `SsCnService.refresh()` thêm lookup: `SELECT sigma_demand FROM sigma_history WHERE cn_id=$1 AND sku_id=$2 ORDER BY calculated_at DESC LIMIT 1`
3. Update M23 spec v1.0.3 để phản ánh dependency này

**Owner:** BE1 (M28 entity) + BE1 (M23 update) | **Sprint:** Sprint 9 (M28) + M23 spec update Sprint 4

---

### GAP-7 🟡 M25/M26 trigger mechanism hoàn toàn unimplemented

**Vấn đề:**
- M25 spec R1: "Trigger qua `M24Service.getAllocationResult()` callback event" — nhưng M24 không có mechanism gọi M25 sau COMPLETED
- `setPostCompletedHook` hiện chỉ dùng cho M23→M24, không có hook thứ 2 cho M24→M25
- M26 parallel trigger: hoàn toàn không có (xem GAP-4)

Kết quả: M25 và M26 là **isolated**, chỉ chạy được qua manual API call.

**Fix:** Xem GAP-4 Option A (EventEmitter) — 1 solution xử lý cả GAP-4 và GAP-7.

**Owner:** BE2 | **Sprint:** Sprint 5-6

---

### GAP-8 🟡 M23 spec v1.0.2 không phản ánh contract `sigma_history` từ M28

**Vấn đề:**  
M28 v1.2 H1 fix chốt 2 methods M28 cần từ M23:
1. `M23.SsCnService.computeSsCnFormula(input): number` — pure function (M28 dùng nội bộ)
2. M23 nightly cycle tự đọc `sigma_history` và gọi `SsCnService.refresh(plan_run_id)`

M23 spec v1.0.2 **không đề cập** `sigma_history` table, không định nghĩa `computeSsCnFormula()` signature, không mô tả `refresh()` method contract.

**Fix cần làm:**
- Update M23 spec thêm section "10b. M28 Closed-Loop Integration":
  - `computeSsCnFormula(cnId, skuId, sigmaNew): number` — public method
  - Nightly trigger thêm Step: "Đọc `sigma_history` latest per (cn_id, sku_id), nếu mới hơn `ss_cn.updated_at` → gọi refresh"

**Owner:** BA/BE1 (M23 spec update) | **Sprint:** Sprint 4

---

## 4. MEDIUM — Documentation & Contract Inconsistencies

### GAP-9 🟡 IMPLEMENT-CHECKLIST.md thiếu BLOCKED status cho M26

**File:** `docs/IMPLEMENT-CHECKLIST.md` — phần Sprint 5-6 M26

DoD trong checklist không đề cập trạng thái `BLOCKED` (phân biệt với `FAIL`). M26 v1.1/v1.2 bổ sung ngữ nghĩa:
- `FAIL` = NM supply thiếu thật sự
- `BLOCKED` = data stale (M21 freshness gate chưa pass)

Developer chỉ đọc checklist sẽ không biết cần implement 4 trạng thái ATP (PASS/PARTIAL/FAIL/BLOCKED).

**Fix:** BA update checklist DoD M26 thêm: `[ ] ATP classification 4 states: PASS/PARTIAL/FAIL/BLOCKED (BLOCKED = M21 stale, không phải supply fail)`

**Owner:** PM/BA | **Sprint:** Sprint 5

---

### GAP-10 🟡 `HonoringRateService.recompute()` thiếu `mode` parameter trong M26 spec

**Vấn đề:**  
M28 Step 6 gọi:
```typescript
M26.HonoringRateService.recompute(month, mode='weekly_rolling')
// hoặc
M26.HonoringRateService.recompute(month, mode='monthly_full')
```

M26 spec §14 note 6 + API chỉ định nghĩa:
```
POST /api/v1/nm-atp/honoring/recompute?month=
```
Không có `mode` parameter. Cross-spec gap: M28 spec định nghĩa contract nhưng M26 spec (owner) không phản ánh ngược.

**Fix:** M26 spec thêm overloaded method signature:
```typescript
recompute(month: string, mode: 'monthly_full' | 'weekly_rolling'): Promise<void>
// monthly_full: tạo row mới nm_honoring_rate(period_month)
// weekly_rolling: chỉ UPDATE rolling_3m_rate, KHÔNG tạo row mới
```

**Owner:** BE1 (M26 spec update) | **Sprint:** Sprint 9 (trước M28 implement)

---

### GAP-11 🟡 `getActualLtPerNmRoute(nmId, null, ...)` thiếu null-handling trong M27 spec

**Vấn đề:**  
M27 spec §14 note 2 định nghĩa query:
```sql
WHERE h.nm_id = $nm AND h.cn_id = $cn AND h.cn_received_date BETWEEN $from AND $to
```

M28 gọi với `cnId = null` để aggregate tất cả routes của NM:
```typescript
M27.getActualLtPerNmRoute(nm_id, null, week_start - 6months, week_start)
```

Query sẽ return empty set nếu `h.cn_id = NULL` (SQL NULL comparison). Cần thêm null guard.

**Fix trong M27:**
```typescript
if (cnId !== null) {
  qb.andWhere('h.cn_id = :cnId', { cnId });
}
// null = aggregate all routes for this NM
```

**Owner:** BE4 (M27) | **Sprint:** Sprint 8

---

### GAP-12 🟡 M22→M23 ID type translation không được spec

**Vấn đề:**
- M22 `getEffectiveDemand()` returns `Map<"cnId|skuId", adjusted_qty>` — integer BIGINT IDs
- M23 loads demand từ `demand_snapshot_line` dùng legacy `location_code` / `item_code` — VARCHAR

Không có spec nào mô tả translation layer (cn_code→cn_id lookup, sku_code→sku_id lookup) trong M23. Developer M23 cần tự lookup `channel.location_code` và `sku.sku_code` để match nhưng không có hướng dẫn.

**Fix:** M23 spec thêm note: "Khi inject M22 adjusted demand: translate `cnId → channel.location_code` qua `channel` table, `skuId → sku.sku_code` qua `sku` table trước khi merge vào netting cell."

**Owner:** BA/BE1 (M23 spec) | **Sprint:** Sprint 4

---

## 5. Summary Table

| GAP | Severity | Module Owner | Sprint Fix | Risk nếu bỏ qua |
|-----|----------|--------------|-----------|----------------|
| **GAP-1** M21 không persist snapshot_line | 🔴 Critical | BE1 (M21) | Sprint 3 HOTFIX | M23 + M26 hoàn toàn không có data |
| **GAP-2** `atp_qty` column thiếu | 🔴 Critical | BE1 (M21) | Sprint 3 | M26 ATP check fail |
| **GAP-3** `reserved_for_transport` thiếu | 🔴 Critical | BE2 (M25 prereq) | Sprint 6 | M23 netting sai + M25 crash |
| **GAP-4** `AllocationRunCompleted` không emit | 🔴 Critical | BE2 (M24/M26) | Sprint 5-6 | M26 không bao giờ trigger |
| **GAP-5** `status` enum thiếu `TOP_UP_FILL` | 🔴 Critical | BE2 (M24) | Sprint 5-6 | M25 type-error khi insert top-up |
| **GAP-6** `sigma_history` table chưa có | 🟡 High | BE1 (M28) | Sprint 9 + M23 | SS closed-loop không hoạt động |
| **GAP-7** M25/M26 trigger mechanism | 🟡 High | BE2 (M24/M25/M26) | Sprint 5-6 | M25/M26 isolated, manual only |
| **GAP-8** M23 spec thiếu M28 contract | 🟡 High | BA/BE1 (M23) | Sprint 4 | M23 dev không biết đọc sigma_history |
| **GAP-9** Checklist M26 thiếu BLOCKED | 🟡 Medium | PM/BA | Sprint 5 | Dev implement sai ATP states |
| **GAP-10** `recompute()` mode param gap | 🟡 Medium | BE1 (M26 spec) | Sprint 9 | M28→M26 call fail runtime |
| **GAP-11** `getActualLtPerNmRoute` null | 🟡 Medium | BE4 (M27) | Sprint 8 | M28 LT update trả empty |
| **GAP-12** M22→M23 ID translation | 🟡 Medium | BA/BE1 (M23) | Sprint 4 | M22 demand adjustment bị ignore |

---

## 6. Critical Path Fix Order

```
Sprint 3:  GAP-1 → GAP-2  (M21 data foundation — phải xong trước M23 chạy được)
Sprint 5:  GAP-5           (M24 TS type — phải xong trước M25 implement)
Sprint 5-6: GAP-4 + GAP-7  (Event trigger — phải xong trước M25/M26 integration test)
Sprint 6:  GAP-3           (reserved_for_transport — prerequisite cho M25 implementation)
Sprint 4:  GAP-8 + GAP-12  (Spec updates — phải xong trước M23 dev starts)
Sprint 8:  GAP-11          (M27 null-handling — trước M28 implement)
Sprint 9:  GAP-6 + GAP-10  (M28 cần cả 2 trước khi bắt đầu viết code)
Sprint 5:  GAP-9           (Checklist update — awareness cho M26 dev)
```

---

## 7. Overall Verdict

> **Flow 2 chưa sẵn sàng deploy staging.**  
> 5 Critical blockers, trong đó **GAP-1 là nghiêm trọng nhất**: M21 data-sync không lưu `supply_snapshot_line` rows — không fix thì M23 DRP netting và M26 ATP check đều không có data để chạy, kéo theo toàn bộ flow M23→M28 bị tê liệt.
