# M26 NM ATP Check — Code Review Report

**Date:** 2026-04-16
**Reviewer:** Cascade AI
**Scope:** `backend/src/nm-atp/`
**Files reviewed:**
- `nm-atp.service.ts`
- `atp-classification.service.ts`
- `urgency-ranking.service.ts`
- `honoring-rate.service.ts`
- `nm-atp.controller.ts`
- `nm-atp.module.ts`
- `nm-atp.service.spec.ts`
- `entities/atp-run.entity.ts`, `atp-check.entity.ts`, `nm-honoring-rate.entity.ts`
- `migrations/V007_m26_nm_atp_check.up.sql`

---

## 🔴 CRITICAL — Phải fix trước staging

---

### BUG-1: `leg.sku_id` không tồn tại trên bảng `allocation_leg` — SQL crash mọi ATP run có data

**File:** `nm-atp.service.ts` — `_loadRequestedCells()` (line ~376) và `_loadCellRecipients()` (line ~517)

**Root cause:**
Schema `allocation_leg` (từ migration `005_fix_allocation_leg_schema.sql`) không có column `sku_id`:

```sql
CREATE TABLE allocation_leg (
  id                    BIGSERIAL PRIMARY KEY,
  allocation_result_id  BIGINT NOT NULL REFERENCES allocation_result(id) ON DELETE CASCADE,
  source_type           VARCHAR(20) NOT NULL,
  source_entity_id      BIGINT NOT NULL DEFAULT 0,
  source_lot_id         VARCHAR(50) NULL,
  allocated_qty         DECIMAL(15,2) NOT NULL,
  fifo_rank             INT NULL,
  distance_km           DECIMAL(10,2) NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

V005 migration (`V005_m24_allocation_lcnb.up.sql`) chỉ ADD `source_period_start` và `origin_top_up_id` — không ADD `sku_id`.

**Lỗi trong code:**

```typescript
// _loadRequestedCells() — nm-atp.service.ts
`SELECT
   m.nm_id::text,
   leg.sku_id::text,                          -- ← column không tồn tại
   ...
 FROM allocation_leg leg
 JOIN sku_nm_mapping m ON m.sku_id = leg.sku_id   -- ← column không tồn tại
 WHERE ...
 GROUP BY m.nm_id, leg.sku_id, ...`          -- ← column không tồn tại

// _loadCellRecipients() — nm-atp.service.ts
`JOIN sku_nm_mapping m ON m.sku_id = leg.sku_id   -- ← column không tồn tại
 WHERE ...
   AND leg.sku_id = $3`                           -- ← column không tồn tại
```

**Hậu quả:** PostgreSQL throw `column "leg.sku_id" does not exist` → toàn bộ ATP run crash tại Step 4 → `atp_run` set status `FAILED` → M27 không nhận được ATP data → không generate được PO.

**Fix cần làm:**
Đổi `leg.sku_id` → `ar.sku_id` ở tất cả các chỗ (`allocation_result` có column `sku_id`):

```typescript
// _loadRequestedCells() — sửa
`SELECT
   m.nm_id::text,
   ar.sku_id::text,                           -- ← fix
   ...
 FROM allocation_leg leg
 JOIN allocation_result ar ON ar.id = leg.allocation_result_id
 JOIN sku_nm_mapping m ON m.sku_id = ar.sku_id   -- ← fix
 WHERE ar.allocation_run_id = $1
   AND leg.source_type IN ('HUB', 'NM', 'TOP_UP_NEXT_WEEK')
 GROUP BY m.nm_id, ar.sku_id, ...`            -- ← fix

// _loadCellRecipients() — sửa
`JOIN sku_nm_mapping m ON m.sku_id = ar.sku_id   -- ← fix
 WHERE ...
   AND ar.sku_id = $3`                            -- ← fix
```

---

### BUG-2: `isAtpNullFallback ? null : atpQty` bỏ qua fallback value — NM Phase 1 bị FAIL toàn bộ

**File:** `nm-atp.service.ts` — main `run()` loop (line ~136)

**Root cause:**
`_preloadAtpQtys()` đã áp dụng fallback đúng spec (khi `atp_qty IS NULL` → dùng `allocatable_qty`):

```typescript
// _preloadAtpQtys() — đúng
const isAtpNullFallback = r.atp_qty === null || r.atp_qty === undefined;
const atpQty = isAtpNullFallback ? Number(r.allocatable_qty ?? 0) : Number(r.atp_qty);
map.set(key, { atpQty, isAtpNullFallback });
```

Nhưng khi gọi `classificationSvc.classify()`, code lại **huỷ fallback value và pass `null`**:

```typescript
// run() loop — sai
const classified = this.classificationSvc.classify({
  atpQty: isAtpNullFallback ? null : atpQty,   // ← bug: bỏ allocatable_qty fallback
  requestedQty: Number(cell.requested_qty),
  isFresh,
});
```

`AtpClassificationService.classify()` nhận `null` → hit defensive path → trả `FAIL`:

```typescript
if (effectiveAtpQty === null || effectiveAtpQty === undefined) {
  return { result: 'FAIL', reason: 'ZERO_STOCK', isAtpNullFallback, effectiveAtpQty: null };
}
```

**Hậu quả:**
- Mọi NM Phase 1 chưa upload `atp_qty` → `is_atp_null_fallback=true` → toàn bộ SKU của NM đó = `FAIL`
- Spec H6 yêu cầu: fallback to `allocatable_qty`, set warning flag, **classification continues normally**
- M27 nhận `FAIL` thay vì `PASS/PARTIAL` → block PO generation cho toàn bộ Phase 1 NMs

**Fix cần làm:**

```typescript
// Đúng: pass already-fallback-applied atpQty thẳng vào classify
const classified = this.classificationSvc.classify({
  atpQty,    // ← đã có allocatable_qty fallback từ _preloadAtpQtys()
  requestedQty: Number(cell.requested_qty),
  isFresh,
});
```

**Lưu ý unit test:** Test `nm-atp.service.spec.ts` line 271-277 đang xác nhận behavior **sai** này (expect FAIL khi atpQty=null). Cần update test sau khi fix:

```typescript
// Test hiện tại — xác nhận wrong behavior
it('atp_qty null fallback sets isAtpNullFallback=true, still classifies', () => {
  const r = svc.classify({ atpQty: null, requestedQty: 500, isFresh: true });
  expect(r.result).toBe('FAIL');   // ← sẽ cần đổi sau khi fix BUG-2
});
```

---

## 🟡 HIGH — Fix trước production

---

### H1: Cron honoring-rate fires sai tháng (-1 tháng sớm)

**File:** `honoring-rate.service.ts` — `_msUntilFirstOfMonth()` (line ~199)

**Root cause:**

```typescript
const vnNow = new Date(nowMs + 7 * 60 * 60 * 1000);
let month = vnNow.getUTCMonth() + 1; // comment "advance to next month"
if (month > 12) { month = 1; year++; }
const fire = new Date(Date.UTC(year, month - 1, 1, 6 - 7, 0, 0, 0));
```

Trace với tháng April 2026:
- `getUTCMonth() = 3` (April, 0-indexed)
- `month = 3 + 1 = 4` → tương đương April (1-indexed), **không** phải May
- Cron fires ngày **1 April** thay vì **1 May**

Ngoài ra, `msUntilVN` được import nhưng **không dùng** — dead import.

**Fix:**

```typescript
let month = vnNow.getUTCMonth() + 2; // +1 convert 0→1-indexed, +1 advance to NEXT month
```

---

### H2: `_loadCellRecipients()` không handle top-up period — urgency ranking trống cho PARTIAL top-up cells

**File:** `nm-atp.service.ts` — `_loadCellRecipients()` (line ~524)

**Root cause:**
`_loadRequestedCells()` đã adjust period đúng: `CASE WHEN ar.is_top_up = TRUE THEN ar.source_period_start ELSE ar.period_start END`.

Nhưng `_loadCellRecipients()` filter cứng `ar.period_start = $4` (không adjust cho top-up):

```typescript
WHERE ar.allocation_run_id = $1
  AND m.nm_id = $2
  AND leg.sku_id = $3
  AND ar.period_start = $4   // ← top-up cell: $4 = source_period_start ≠ ar.period_start
```

**Hậu quả:** PARTIAL top-up cells → `recipients = []` → `urgency_ranking = null` → SC Manager không thấy CN priority → không thể ưu tiên phân phối đúng.

**Fix:**

```sql
AND (
  CASE WHEN ar.is_top_up = TRUE THEN ar.source_period_start ELSE ar.period_start END
) = $4
```

---

### H3: `getAtpResult()` filter `is_force_rerun = FALSE` — M27 nhận ATP data cũ sau force rerun

**File:** `nm-atp.service.ts` — `getAtpResult()` (line ~237)

**Root cause:**

```typescript
`SELECT id::text, plan_run_id::text, status, completed_at
 FROM atp_run
 WHERE allocation_run_id = $1
   AND is_force_rerun = FALSE   -- ← excludes force reruns
 ORDER BY created_at DESC LIMIT 1`
```

Sau khi planner force rerun M26 (với `forceRerunReason`), `getAtpResult()` vẫn trả về atp_run cũ (non-force). M27 sẽ dùng ATP data cũ/stale để generate PO — đi ngược mục đích của force rerun.

**Fix:** Bỏ filter `is_force_rerun = FALSE`, luôn lấy `created_at DESC`:

```sql
SELECT id::text, plan_run_id::text, status, completed_at
FROM atp_run
WHERE allocation_run_id = $1
ORDER BY created_at DESC LIMIT 1
```

---

## 🟡 MEDIUM — Tech-debt, fix trong sprint tiếp theo

| # | File | Vấn đề | Ghi chú |
|---|------|---------|---------|
| M1 | `nm-atp.service.ts` | `_preloadHstk()` hardcode 10 days cho tất cả CN | Phase 1 placeholder — urgency ranking kém chính xác |
| M2 | `honoring-rate.service.ts` | `import { msUntilVN }` nhưng không dùng | Dead import, cần xoá |
| M3 | `honoring-rate.service.ts` | `_checkPhase2DataAvailable()` catch mọi exception (kể cả DB error) | Có thể che connection errors, chỉ nên catch schema-not-found |
| M4 | `nm-atp.service.spec.ts` | Test line 271-277 xác nhận wrong behavior của BUG-2 | Cần update sau khi fix BUG-2 |

---

## Verdict

| # | Severity | Vấn đề | Impact |
|---|----------|---------|--------|
| BUG-1 | 🔴 Critical | `leg.sku_id` không tồn tại → SQL crash | Mọi ATP run thất bại |
| BUG-2 | 🔴 Critical | Fallback `allocatable_qty` bị huỷ khi gọi classify | Toàn bộ NM Phase 1 → FAIL → M27 blocked |
| H1 | 🟡 High | Cron honoring-rate sai tháng | Rate compute sai timing 1 tháng |
| H2 | 🟡 High | Urgency ranking trống cho PARTIAL top-up | SC Manager mất visibility top-up priority |
| H3 | 🟡 High | `getAtpResult()` bỏ qua force reruns | M27 dùng ATP data cũ sau force rerun |
| M1–M4 | 🟡 Medium | HSTK hardcode, dead import, error masking, test sai | Tech-debt |

> **2 critical bugs (BUG-1 + BUG-2) khiến M26 không hoạt động với dữ liệu thật.**
> BUG-1 → SQL error ngay Step 4. BUG-2 → toàn bộ NM Phase 1 FAIL → M27 không generate được PO.
> **Yêu cầu fix cả 2 trước khi deploy staging.**

---

*Prepared by Cascade AI — for dev review only. No code changes applied.*
