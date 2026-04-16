# M27 PO/TO Review & Confirm — Code Review Report

**Reviewed files:**
- `po-review.service.ts`
- `po-transition.service.ts`
- `po-edit.service.ts`
- `po-overdue.service.ts`
- `po-review.controller.ts`
- `po-review.module.ts`
- `po-review.service.spec.ts`
- `migrations/V008_m27_po_review.up.sql`

---

## 🔴 CRITICAL BUGS

### BUG-1: `_nextPoNumber()` INSERT fake `po_run` row → crash on any run with ≥ 2 PO groups

**Location:** `po-review.service.ts:621-633`

```ts
private async _nextPoNumber(yearMonth: string): Promise<string> {
  const rows: Array<{ next_val: number }> = await this.dataSource.query(
    `INSERT INTO po_run (allocation_run_id, status, created_by)
       VALUES (0, 'COMPLETED', 'SEQ_INTERNAL')
       RETURNING 1 AS next_val`,  // simplified: use po_header count
  );
  // Real approach: use sequence or MAX(id) from po_header
  const seq: Array<{ n: number }> = await this.dataSource.query(
    `SELECT COALESCE(MAX(id), 0) + 1 AS n FROM po_header`,
  );
```

**Issues:**
1. **Crash on 2nd PO group:** `_nextPoNumber()` called once per PO group. First call inserts `po_run(allocation_run_id=0, is_force_rerun=FALSE)`. Second call violates `uq_po_run_primary` UNIQUE index → **SQL error**. Any allocation run with ≥ 2 NM×CN groups crashes.

2. **Unused INSERT:** `rows` created but never used — only `seq` query is actually used. Copy-paste error.

3. **Invalid RETURNING:** PostgreSQL doesn't allow `RETURNING 1 AS next_val` without selecting from the table.

**Fix:** Remove the INSERT entirely. Use proper sequence (`CREATE SEQUENCE po_number_seq`) or `SELECT nextval()` as per Sprint 0 BUG-03 pattern in spec.

---

## 🟡 HIGH PRIORITY ISSUES

### H1: `MAX(id)+1` sequence not race-safe → duplicate `po_number`

**Location:** `po-review.service.ts:628-632`

```ts
const seq: Array<{ n: number }> = await this.dataSource.query(
  `SELECT COALESCE(MAX(id), 0) + 1 AS n FROM po_header`,
);
const n = String(seq[0].n).padStart(5, '0');
return `PO-${yearMonth}-${n}`;
```

Two concurrent generate runs (retry or double-click) → both read same `MAX(id)` → same `po_number` → UNIQUE constraint violation on `po_header.po_number`. Spec requires "table-based seq, idempotent inside tx — pattern Sprint 0 BUG-03". **Need `CREATE SEQUENCE po_number_seq` or `SELECT nextval()`.**

---

### H2: Missing `PATCH /po/:id/tracking` and `PATCH /to/:id/tracking` endpoints

Spec API (§7) defines:
```
PATCH /api/v1/po-review/po/:id/tracking  # Update vehicle/driver/etc
PATCH /api/v1/po-review/to/:id/tracking
```

Controller doesn't have these endpoints and `po-tracking.service.ts` doesn't exist. Tracking fields are only updated via `SHIPPED` transition — Planners cannot update `driver_name`, `driver_phone`, `actual_eta_date` after SHIPPED without re-transitioning.

---

### H3: M25/M26 not wired to AND correlation callbacks → auto-trigger doesn't work

**Location:** `po-review.service.ts:467-491`

```ts
async onM25TransportCompleted(...): Promise<void> { ... }
async onM26AtpCompleted(...): Promise<void> { ... }
```

These methods are implemented and have REST endpoints (`POST /event/m25-done`, `POST /event/m26-done`). But `transport.lot-sizing.service.ts` and `nm-atp.service.ts` **don't inject `PoReviewService` and don't call these methods**. M27 generate can only be triggered manually via `POST /po-review/run`. Spec R1 requires event-driven AND condition.

---

### H4: `_rollbackReservation()` uses `ss.status = 'FROZEN'` which may fail

**Location:** `po-transition.service.ts:316-329`

```sql
UPDATE supply_snapshot_line
SET reserved_for_transport = GREATEST(0, reserved_for_transport - $1)
WHERE item_code = $2
  AND snapshot_id = (
    SELECT ssl_inner.snapshot_id FROM supply_snapshot_line ssl_inner
    JOIN supply_snapshot ss ON ss.id = ssl_inner.snapshot_id
    WHERE ssl_inner.item_code = $2
      AND ss.nm_code = $3
      AND ss.status = 'FROZEN'    ← potential error
```

Does `supply_snapshot` have a `status` column? V002 migration only shows ADD `nm_code`, `source`. If `status` doesn't exist, query crashes with `column "status" does not exist`. (Same issue noted in `NOTE-M26.md`.) **Must verify before staging.**

---

### H5: `_rollbackReservation()` uses `'HUB_VIRTUAL'` as `nm_code` for HUB source

**Location:** `po-transition.service.ts:304-306`

```ts
if (leg.source_type === 'HUB') {
  locationCode = 'HUB_VIRTUAL';
}
```

Rollback query uses `ss.nm_code = 'HUB_VIRTUAL'`. But `supply_snapshot.nm_code` stores factory/supplier codes (`'NM-MIKADO'`), not `'HUB_VIRTUAL'`. **HUB source cancel reservation will silently skip (no snapshot found)** → `reserved_for_transport` remains allocated.

---

## 🟡 MEDIUM TECH DEBT

| # | Issue | File |
|---|-------|------|
| M1 | `po_line INSERT ... ON CONFLICT DO NOTHING` — silently drops duplicate leg without warning | `po-review.service.ts` L298–311 |
| M2 | `transitionPo()` idempotency: `return idem[0].result_json` inside transaction callback → outer function ignores cached value, still returns new `{id, status}`. Works but confusing pattern | `po-transition.service.ts` L73–98 |
| M3 | Missing tests: no tests for PARTIAL clamp (US-3), top-up trace (US-15), TO lifecycle (US-11), idempotency retry (US-8), `getActualLtPerNmRoute()` | `po-review.service.spec.ts` |
| M4 | `po-tracking.service.ts`, `entities/`, `dto/` don't exist in folder — spec requires full folder structure | Folder structure |

---

## 🟢 POSITIVE OBSERVATIONS

1. **Comprehensive migration:** `V008_m27_po_review.up.sql` correctly implements all required tables, indexes, and feature flags
2. **Event correlation logic:** `po_run_pending` table and `_checkAndTrigger()` properly implement AND condition for M25/M26 completion
3. **ATP gating logic:** Correctly handles BLOCKED (skip), FAIL (skip), PARTIAL (clamp) scenarios
4. **Edit validation:** Proper R7 (mandatory reason) and R8 (ATP validation, SKU belongs to NM) implementation
5. **State transitions:** Correct transition matrix and mandatory field validation (R9, R10, R11)
6. **Unit test coverage:** Good coverage for core scenarios including feature flag, idempotency, NO_CARRIER blocking, ATP results
7. **M28 contracts:** `getPoFulfillment()` provides per-line granularity needed for honoring rate backfill
8. **Overdue cron:** Proper daily 09:00 VN scheduling with configurable days

---

## 📋 RECOMMENDED ACTIONS

### Immediate (Blocker)
1. **Fix BUG-1:** Remove INSERT from `_nextPoNumber()` and implement proper sequence
2. **Fix H1:** Replace `MAX(id)+1` with race-safe sequence generation
3. **Verify H4:** Check if `supply_snapshot.status` column exists; if not, update query

### High Priority
4. **Add H2 endpoints:** Implement `PATCH /po/:id/tracking` and `PATCH /to/:id/tracking`
5. **Wire H3 callbacks:** Inject `PoReviewService` in M25/M26 modules and call event methods
6. **Fix H5 HUB mapping:** Use correct `nm_code` for HUB source in rollback

### Medium Priority
7. **Add M1 logging:** Log warning when duplicate legs are skipped
8. **Clean M2 pattern:** Simplify idempotency return pattern
9. **Expand M3 tests:** Add missing test scenarios
10. **Complete M4 structure:** Add missing service/entity files

---

## 🎯 VERDICT

**M27 is NOT ready for staging** due to:
- **BUG-1** will crash any real allocation run with multiple PO groups
- **H1** will cause duplicate PO numbers under concurrent load
- **H4** may crash reservation rollback depending on schema
- **H3** means auto-trigger doesn't work (manual only)

**Priority:** Fix BUG-1 and H1 first, then address H2-H5 before staging deployment.

---

*Generated: 2025-04-16*  
*Reviewer: Cascade AI Assistant*
