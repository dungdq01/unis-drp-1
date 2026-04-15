# PHASE 2 DEV RULES — UNIS SCP v2.0
**Version:** 1.2 | **Date:** 2026-04-16
**Authority:** Tech Lead / SA
**Áp dụng cho:** Toàn bộ team (BE, FE, DA) khi code phase mới (M11-M28)

> ⚠️ Đọc file này TRƯỚC KHI viết bất kỳ dòng code nào cho v2.0.
> Vi phạm rule = PR bị reject, phải rewrite.

---

## TL;DR — 5 điều cần nhớ nhất

```
1. EXTEND modules: code trong folder domain cũ (demand/, allocation/...) — file mới, tên theo capability
2. NEW/REBUILD modules: folder mới đặt thẳng vào src/ theo tên domain, KHÔNG bọc trong v2/
3. API: versioning ở route level — /api/demand/v2/aggregate, KHÔNG phải folder level
4. Trước khi code bất kỳ module nào → đọc đúng PRD section + đúng Flow
5. Không thấy domain name trong folder/file? Bạn đang đặt nhầm chỗ
```

---

## RULE 1 — Zone Classification (Bắt buộc nhớ)

### PROTECTED Zone — M1 → M10 (Core Engines)
Những folder này là **core engine** phục vụ M11-M28. Chúng tiếp tục chạy ở backend.

```
backend/src/
├── demand/          ← M1 core — PROTECTED
├── supply/          ← M2 core — PROTECTED
├── policy/          ← M3+M4 core — PROTECTED
├── allocation/      ← M5 core — PROTECTED
├── transport/       ← M6 core — PROTECTED
├── orders/          ← M7 core — PROTECTED (rebuild sang M27, nhưng chưa xóa)
├── monitor/         ← M8+M9 — PROTECTED (giữ nguyên, không đổi)
├── system-config/   ← M10 core — PROTECTED
├── drp/             ← M3-M4 engine — PROTECTED
└── plan-actual/     ← cross-module — PROTECTED
```

**Được làm với PROTECTED zone:**
- ✅ Fix bug đã liệt kê trong `docs/IMPLEMENT-CHECKLIST.md`
- ✅ Thêm DB column mới (migration), không xóa column cũ
- ✅ Thêm method service MỚI (không sửa method đang dùng)
- ✅ Expose thêm data qua existing service cho v2 dùng

**KHÔNG được làm với PROTECTED zone:**
- ❌ Đổi tên hoặc xóa bảng, column đang có
- ❌ Thay đổi behavior của endpoint /api/v1/...
- ❌ Đổi tên file, class, method đang có
- ❌ Add feature mới vào — làm feature mới thì code theo RULE 3
- ❌ Xóa bất kỳ dòng code nào trừ khi đó là bug fix

### BUILD Zone — M00, M11-M28 (New Phase)
Code mới theo cấu trúc domain (xem RULE 3 để đầy đủ). Tóm tắt:

```
backend/src/
│  EXTEND (thêm file vào folder domain cũ)
├── demand/          ← M1 có sẵn + thêm demand.aggregate.service.ts (M11)
├── supply/          ← M2 có sẵn + thêm supply.sync.service.ts (M21)
├── drp/             ← M3+M4 có sẵn + thêm drp.netting.service.ts (M23)
├── allocation/      ← M5 có sẵn + thêm allocation.lcnb.service.ts (M24)
├── transport/       ← M6 có sẵn + thêm transport.lot.service.ts (M25)
│
│  NEW/REBUILD (folder mới thẳng trong src/)
├── master-data/     ← M00
├── saop-consensus/  ← M12  | commitment/     ← M14
├── nm-negotiate/    ← M15  | hub-virtual/    ← M16
├── gap-simulator/   ← M17  | cn-demand-adjust/ ← M22
├── nm-atp/          ← M26  | po-review/      ← M27 (REBUILD)
└── feedback/        ← M28
```

> Xem RULE 3 để biết chi tiết folder + file naming cho từng loại.

---

## RULE 2 — Folder Structure (Mỗi module v2)

Mỗi module NEW/REBUILD trong `backend/src/{module}/` phải có cấu trúc sau. EXTEND module thêm file tương ứng vào folder cũ:

```
{module}/
├── {module}.module.ts           ← NestJS Module declaration
├── {module}.controller.ts       ← Routes only, no business logic
├── {module}.controller.spec.ts  ← Integration test (encourage)
├── {module}.service.ts          ← Business logic only, no DB direct
├── {module}.service.spec.ts     ← Unit test (REQUIRED)
├── {module}.repository.ts       ← DB queries only, no business logic
├── dto/
│   ├── create-{entity}.dto.ts
│   └── update-{entity}.dto.ts
├── entities/
│   └── {entity}.entity.ts      ← TypeORM entity
└── constants.ts                 ← Module-level constants
```

**NestJS Layer rules:**
| File | Được làm | Không được làm |
|---|---|---|
| `controller.ts` | Validate input, gọi service, return response | Query DB trực tiếp, business logic |
| `service.ts` | Business logic, orchestrate, gọi repo | Raw SQL, gọi HTTP trực tiếp |
| `repository.ts` | TypeORM queries, raw SQL nếu phức tạp | Business logic |
| `dto/` | Class-validator decorators, transform | Không có logic |
| `entities/` | TypeORM decorators, column defs | Không có logic |

---

## RULE 3 — Folder Strategy: EXTEND vs REBUILD vs NEW

Không có `v2/` wrapper. 1 codebase, tên folder theo **domain**, git history là nguồn lịch sử.

### Toàn bộ cấu trúc backend (18 folders, không có v2/ wrapper)

```
backend/src/
│
│  — EXTEND: module v2 thêm vào folder domain cũ —
├── demand/                 ← M1 core + M11 aggregate v2
│   ├── demand.service.ts              ← M1 logic (giữ nguyên)
│   ├── demand.aggregate.service.ts    ← M11 logic (file mới, tên capability)
│   ├── demand.controller.ts           ← cả /v1 + /v2 routes
│   └── entities/
│       ├── demand-snapshot.entity.ts  ← extend thêm column
│       └── b2b-deal.entity.ts         ← entity mới M11
│
├── supply/                 ← M2 core + M21 data sync v2
│   ├── supply.service.ts
│   ├── supply.sync.service.ts         ← M21 logic (tên capability)
│   └── supply.freshness.guard.ts      ← M21 freshness gate
│
├── drp/                    ← M3+M4 core + M23 netting v2
│   ├── drp.service.ts
│   └── drp.netting.service.ts         ← M23 logic
│
├── allocation/             ← M5 core + M24 LCNB v2
│   ├── allocation.service.ts
│   ├── allocation.lcnb.service.ts     ← M24 LCNB engine
│   └── entities/
│       ├── allocation-result.entity.ts
│       └── allocation-leg.entity.ts   ← bảng mới (BUG-02 fix)
│
├── transport/              ← M6 core + M25 lot sizing v2
│   ├── transport.service.ts
│   └── transport.lot.service.ts       ← M25 logic
│
├── system-config/          ← M10 (EXTEND in-place)
├── monitor/                ← M8 (KEEP — không đổi)
├── plan-actual/            ← M9 (KEEP — không đổi)
│
│  — NEW / REBUILD: folder mới theo tên domain (không bọc v2/) —
├── master-data/            ← M00 (NEW)
├── saop-consensus/         ← M12 (NEW)
├── prod-lot-sizing/        ← M13 (NEW)
├── commitment/             ← M14 (NEW)
├── nm-negotiate/           ← M15 (NEW)
├── hub-virtual/            ← M16 (NEW)
├── gap-simulator/          ← M17 (NEW)
├── cn-demand-adjust/       ← M22 (NEW)
├── nm-atp/                 ← M26 (NEW)
├── po-review/              ← M27 (REBUILD — M7 orders/ deprecated)
└── feedback/               ← M28 (NEW)
```

### File naming trong EXTEND folder

```typescript
// ✅ ĐÚNG — tên theo capability, không suffix "v2"
// backend/src/allocation/allocation.lcnb.service.ts
export class AllocationLcnbService { ... }   // LCNB = tên capability M24

// ✅ ĐÚNG — route mới trong controller cũ
// backend/src/demand/demand.controller.ts
@Get('aggregate')             // → /api/demand/aggregate   (M11)
@Get('snapshot')              // → /api/demand/snapshot    (M1)

// ❌ SAI — suffix v2 trong tên file
demand.v2.service.ts          // KHÔNG — tên theo capability, không theo version
allocation-v2.service.ts      // KHÔNG

// ❌ SAI — sửa method cũ thay vì thêm file mới
async getSnapshot(version?: string) {
  if (version === 'v2') { ... }  // FORBIDDEN
}
```

### API endpoint convention

```
EXTEND: /api/{domain}/{capability}   vd: /api/demand/aggregate, /api/allocation/lcnb/run
NEW:    /api/{domain}/{action}        vd: /api/saop-consensus/lock, /api/po-review/confirm
```

> Versioning chỉ ở API route khi cần backward compat: `/api/demand/v2/aggregate`.
> Không bao giờ versioning ở folder level.

---

## RULE 4 — Flow Reference (Check trước khi code)

Mỗi module thuộc 1 trong 2 Flow hoặc Cross-flow. Phải biết mình đang code Flow nào.

### Flow 1 — Monthly S&OP (chạy theo chu kỳ tháng, Day 1→Day 30)
| Module | PRD Ref | Trigger | Input từ |
|--------|---------|---------|---------|
| **M11** Demand Aggregate v2 | F1-B1 | Day 1-3 | Sales upload, B2B pipeline |
| **M12** S&OP Consensus | F1-B2 | Day 3-10 | M11 output |
| **M13** Production Lot Sizing | F1-B3 | Day 7-10 | M12 locked |
| **M14** FC Commitment 3-tier | F1-B4 | Day 10-15 | M13 booking |
| **M15** NM Response & Negotiate | F1-B5 | Day 15-20 | M14 sent to NM |
| **M16** Hub ảo Virtual Inventory | F1-B6 | Day 20-25 | M15 confirmed |
| **M17** Gap & Scenario Simulator | F1-B7 | Day 25-28 | M16 virtual stock |

### Flow 2 — Daily DRP (chạy hàng đêm, 23:00 → 06:00)
| Module | PRD Ref | Trigger | Input từ |
|--------|---------|---------|---------|
| **M21** Data Sync & Freshness | F2-B1 | 18:00 cutoff | NM upload template |
| **M22** CN Demand Adjust | F2-B2 | 18:00 cutoff | CN portal (submit trước cutoff) |
| **M23** DRP Netting v2 | F2-B3 | 23:15 | M21 + M22 adjusted demand + M16 Hub ảo |
| **M24** Allocation LCNB v2 | F2-B4 | 23:30 | M23 net demand |
| **M25** Transport Lot Sizing | F2-B5 | 23:45 | M24 allocation |
| **M26** NM ATP Check | F2-B6 | 00:00 | M25 transport plan |
| **M27** PO Review & Confirm | F2-B7 | 00:00–05:00 | M26 ATP result + M25 transport (user review window) |
| **M28** Feedback Closed Loop | F2-B8 | 06:00 | M27 confirmed PO |

### Cross-flow (phục vụ cả 2 Flow)
| Module | Role |
|--------|------|
| **M00** Foundation | Master data, không thuộc flow nào |
| **M8+M9** Monitor | Quan sát cả 2 flow |

**Checklist trước khi code module:**
```
[ ] Tôi đang code module nào? M__
[ ] Module này thuộc Flow 1 / Flow 2 / Cross?
[ ] PRD section tương ứng: F_-B_ → đã đọc chưa?
[ ] Input của module này đến từ module nào?
[ ] Output của module này đi về module nào?
[ ] Đã check IMPLEMENT-CHECKLIST.md xem task này ở sprint nào?
```

---

## RULE 5 — M1-M10 Touch Rules (Chi tiết)

### Khi nào được chạm vào code cũ?

**Case 1: Bug fix đã approve**
- Tìm bug trong `docs/IMPLEMENT-CHECKLIST.md` section "Critical Bug Fixes"
- Bug phải có ID (BUG-01, BUG-02...) và đã được assign
- Fix MINIMAL — chỉ fix dòng lỗi, không refactor xung quanh

**Case 2: Thêm DB column cho v2 cần**
```sql
-- ✅ ĐÚNG — thêm column mới (ví dụ: demand_snapshot cần level + cn scope)
ALTER TABLE demand_snapshot ADD COLUMN level VARCHAR(10) DEFAULT 'TOTAL';
ALTER TABLE demand_snapshot ADD COLUMN cn_id UUID NULL;

-- ❌ SAI — đổi tên column cũ (break backward compat)
ALTER TABLE demand_snapshot RENAME COLUMN forecast_qty TO fc_qty_v1;

-- ❌ SAI — thêm field vào bảng không đúng domain
-- B2B stage là entity riêng, KHÔNG thêm vào demand_snapshot
ALTER TABLE demand_snapshot ADD COLUMN b2b_stage INT;  -- WRONG TABLE
```

**Case 3: Expose thêm method từ service cũ cho v2 gọi**
```typescript
// ✅ ĐÚNG — thêm method MỚI vào service cũ
// Trong demand.service.ts (PROTECTED)
async getSnapshotForV2(planId: string): Promise<SnapshotV2DTO> { ... }
// Method cũ không đổi

// ❌ SAI — sửa method cũ để serve cả v2
async getSnapshot(planId: string, version?: string) {  // FORBIDDEN
  if (version === 'v2') { ... }  // if/else version = red flag
}
```

---

## RULE 6 — Frontend Rules

### App pages — cùng pattern với backend: domain folder, không v2/ wrapper

```
frontend/app/
│  — EXTEND: thêm page/route mới vào folder domain cũ —
├── demand/               ← M1 pages + M11 pages
│   ├── page.tsx          ← M1 dashboard (giữ nguyên)
│   └── aggregate/        ← M11 new page (thêm vào)
│       └── page.tsx
├── supply/               ← M2 pages + M21 pages
├── allocation/           ← M5 pages + M24 pages
├── drp/                  ← M3+M4 pages + M23 pages
├── transport/            ← M6 pages + M25 pages
├── system-config/        ← M10
├── monitor/              ← M8 (giữ nguyên)
├── plan-actual/          ← M9 (giữ nguyên)
│
│  — NEW / REBUILD: folder mới theo domain —
├── master-data/          ← M00
├── saop-consensus/       ← M12
├── commitment/           ← M14
├── nm-negotiate/         ← M15
├── hub-virtual/          ← M16
├── gap-simulator/        ← M17
├── cn-demand-adjust/     ← M22
├── nm-atp/               ← M26
├── po-review/            ← M27
└── feedback/             ← M28
```

### Components — FE path map (bám vào cấu trúc hiện tại)

```
frontend/components/
│  — EXTEND: thêm component mới vào folder domain cũ —
├── demand/               ← M1 components (57 files hiện có) + M11 mới
│   ├── [existing M1 components]         ← giữ nguyên
│   ├── b2b-pipeline-panel.tsx           ← M11 B2B pipeline
│   ├── saop-lock-badge.tsx              ← M11/M12 lock indicator
│   └── demand-aggregate-table.tsx       ← M11 aggregate view
│
├── supply/               ← M2 components (10 files) + M21 mới
│   ├── [existing M2 components]
│   ├── freshness-gate-badge.tsx         ← M21
│   └── nm-sync-status.tsx              ← M21
│
├── allocation/           ← M5 components + M24 LCNB mới
│   ├── allocation-lcnb-panel.tsx        ← M24
│   └── allocation-leg-table.tsx         ← M24 (BUG-02)
│
├── shared/               ← cross-module shared (6 files hiện có)
│   ├── [existing shared]
│   ├── policy-run-badge.tsx             ← M23/M24/M25 baseline pin indicator
│   └── feature-gate.tsx                ← feature flag wrapper component
│
│  — NEW: folder mới theo domain —
├── saop-consensus/       ← M12
├── commitment/           ← M14
├── nm-negotiate/         ← M15
├── hub-virtual/          ← M16
├── gap-simulator/        ← M17
├── cn-demand-adjust/     ← M22
├── nm-atp/               ← M26
├── po-review/            ← M27
└── feedback/             ← M28
```

### Gọi API từ FE

```typescript
// ✅ ĐÚNG — EXTEND module: gọi đúng domain endpoint
const res = await fetch('/api/demand/aggregate');    // M11
const res = await fetch('/api/allocation/lcnb/run'); // M24

// ✅ ĐÚNG — NEW module
const res = await fetch('/api/saop-consensus/lock'); // M12
const res = await fetch('/api/po-review/confirm');   // M27

// ❌ SAI — gọi sai domain
const res = await fetch('/api/v2/demand-aggregate/snapshot');  // v2/ không tồn tại
```

---

## RULE 7 — Data Pipeline (Python)

Không có `v2/` wrapper. Chia theo flow subfolder, tên file rõ module:

```
data/pipelines/
├── step1_demand.py                  ← M1 legacy — PROTECTED
├── load_demand_to_db.py             ← OLD — PROTECTED
├── load_accuracy_to_db.py           ← OLD — PROTECTED
├── flow1/                           ← Monthly S&OP pipelines
│   ├── m11_demand_aggregate.py
│   ├── m12_saop_consensus.py
│   ├── m13_prod_lot_sizing.py
│   └── ...
└── flow2/                           ← Daily DRP pipelines
    ├── m21_data_sync.py
    ├── m22_cn_adjust.py
    ├── m23_drp_netting.py
    ├── m24_allocation_lcnb.py
    └── ...
```

### File naming
```
{flow}/{module-number}_{short-name}.py    ← không có prefix f{n}_
Ví dụ:
  flow1/m11_demand_aggregate.py
  flow2/m21_data_sync.py
  flow2/m23_drp_netting.py
```

---

## RULE 8 — Database Migration Rules

### Naming convention cho migration mới
```
Format: {timestamp}_{module}_{action}.sql

Ví dụ:
  20260416_m00_create_master_data_tables.sql
  20260416_m11_add_b2b_columns_to_demand.sql
  20260416_m24_create_allocation_leg_table.sql
```

### Migration safety rules
```sql
-- ✅ ĐÚNG — schema migration trong transaction
BEGIN;
CREATE TABLE allocation_leg ( ... );
ALTER TABLE demand_snapshot ADD COLUMN source_type VARCHAR(20) DEFAULT 'MANUAL';
COMMIT;

-- ✅ ĐÚNG — concurrent index (không block production)
-- QUAN TRỌNG: CONCURRENTLY không chạy được trong transaction block
CREATE INDEX CONCURRENTLY idx_alloc_leg_plan_id ON allocation_leg(plan_id);

-- ❌ FORBIDDEN — xóa bảng cũ
DROP TABLE demand_snapshot;  -- NEVER

-- ❌ FORBIDDEN — đổi tên column cũ
ALTER TABLE supply_snapshot RENAME COLUMN qty TO qty_v1;  -- NEVER

-- ❌ FORBIDDEN — thay đổi constraint cũ (thêm NOT NULL vào column đang NULL)
ALTER TABLE orders ALTER COLUMN status SET NOT NULL;  -- breaks existing data

-- ❌ FORBIDDEN — CREATE INDEX CONCURRENTLY bên trong BEGIN/COMMIT
BEGIN;
CREATE INDEX CONCURRENTLY idx_x ON table_x(col);  -- ERROR: có thể fail
COMMIT;
```

### Data backfill (tách khỏi migration)
```
Backfill logic KHÔNG được viết trong .up.sql — tạo script riêng:

database/
├── migrations/           ← schema DDL only (CREATE/ALTER)
└── backfills/            ← data transform/seed scripts
    └── 20260416_m24_backfill_allocation_leg.ts
```
```typescript
// backfills/20260416_m24_backfill_allocation_leg.ts
// Chạy SAU migration, có checkpoint, idempotent
const BATCH_SIZE = 1000;
let offset = 0;
while (true) {
  const rows = await db.query(
    'SELECT * FROM allocation_result WHERE migrated = false LIMIT $1 OFFSET $2',
    [BATCH_SIZE, offset]
  );
  if (rows.length === 0) break;
  await db.query('INSERT INTO allocation_leg (...) SELECT ... FROM ...', rows);
  await db.query('UPDATE allocation_result SET migrated = true WHERE id = ANY($1)', [rows.map(r => r.id)]);
  offset += BATCH_SIZE;
}
```

### Rollback script (bắt buộc)
Mỗi migration `.up.sql` **PHẢI có file `.down.sql` đi kèm**:
```
20260416_m24_create_allocation_leg.up.sql
20260416_m24_create_allocation_leg.down.sql  ← REQUIRED
```
```sql
-- .down.sql — reverses the .up.sql
DROP TABLE IF EXISTS allocation_leg;
ALTER TABLE demand_snapshot DROP COLUMN IF EXISTS level;
```
PR thiếu `.down.sql` = SOFT BLOCKER.

---

## RULE 9 — Module-to-Domain Quick Lookup

Khi nhận task, xác định ngay domain và module:

| Từ khoá task | Domain | Module | Flow |
|---|---|---|---|
| master data, SKU, CN, NM mapping | D1 Foundation | M00 | Cross |
| forecast, S&OP, B2B, CN adjust demand | D2 Demand | M11/M12/M22 | F1/F2 |
| NM upload, freshness, sync | D3 Supply Intake | M21 | F2 |
| safety stock, DRP netting, replenishment | D4 Replenishment | M23 | F2 |
| allocation, LCNB, NEAREST, fair-share | D5 Allocation | M24 | F2 |
| container, lot sizing, transport plan | D6 Transport | M25 | F2 |
| PO, order confirm, execution | D7 Order Mgmt | M27 | F2 |
| production booking, hub, commitment | D8 Production | M13-M17 | F1 |
| alert, monitor, exception | D9 Monitoring | M8+M9 | Cross |
| feedback, closed loop, accuracy | D10 Intelligence | M28 | Cross |
| ATP check, NM honoring | D3 Supply Intake | M26 | F2 |
| gap analysis, scenario, simulator | D8 Production | M17 | F1 |

---

## RULE 10 — Pre-Coding Checklist (Bắt buộc trước khi code)

```
Bước 1 — Xác định module:
  [ ] Task này thuộc module nào? (xem RULE 9)
  [ ] Module thuộc Flow nào? (Flow 1 / Flow 2 / Cross)
  [ ] Module thuộc PROTECTED zone hay BUILD zone?

Bước 2 — Đọc spec:
  [ ] Đọc PRD section tương ứng trong UNIS-SCP-v2.0-FULL-PRD.md
  [ ] Đọc task trong IMPLEMENT-CHECKLIST.md (sprint nào, owner nào)
  [ ] Check GROUP-MODULE.md xem module này status gì (NEW/EXTEND/KEEP)

Bước 3 — Xác nhận folder (theo loại module):
  [ ] EXTEND? → thêm file mới (tên theo capability) vào folder domain cũ
  [ ] NEW/REBUILD? → tạo folder mới theo tên domain, thẳng trong src/ (không v2/ wrapper)
  [ ] File tên theo capability, KHÔNG suffix v2 (demand.aggregate.service.ts ✅, demand.v2.service.ts ❌)
  [ ] FE component: vào đúng folder domain trong components/{domain}/
  [ ] FE page: vào đúng folder domain trong app/{domain}/
  [ ] Migration file: đặt trong database/ với tên đúng format + có .down.sql

Bước 4 — Nếu cần chạm PROTECTED zone:
  [ ] Bug này có trong IMPLEMENT-CHECKLIST.md "Critical Bug Fixes" không?
  [ ] Đã báo Tech Lead / SA chưa?
  [ ] Fix MINIMAL — chỉ dòng cần fix, không refactor xung quanh

Nếu bất kỳ checkbox nào không tick được → DỪNG, hỏi SA trước khi code.
```

---

## RULE 11 — PR Blocker Checklist

PR sẽ bị **reject ngay** nếu có bất kỳ vi phạm nào dưới đây:

```
🔴 HARD BLOCKERS (auto-reject, không discuss):
  [ ] Tạo src/v2/ wrapper folder (bất kỳ module nào)
  [ ] File tên suffix .v2.* (demand.v2.service.ts — dùng tên capability thay thế)
  [ ] Sửa method/endpoint cũ để serve module mới (if/else version trong code cũ)
  [ ] EXTEND module tạo folder riêng thay vì thêm vào folder domain cũ
  [ ] DROP TABLE hoặc RENAME COLUMN trên bảng cũ trong migration
  [ ] Không có policy_run_id pin trong M23/M24/M25 run (xem RULE 14)

🟡 SOFT BLOCKERS (cần giải thích, có thể negotiate):
  [ ] Endpoint v2 chưa bọc FeatureFlagService (xem RULE 13)
  [ ] Migration .up.sql không có .down.sql đi kèm
  [ ] API response format v2 không có field mà PRD yêu cầu
  [ ] Controller có business logic (phải để trong service)
  [ ] Magic number/string không có constants file
  [ ] Thiếu {module}.service.spec.ts
```

---

## RULE 12 — Naming Quick Reference

| Thứ | Convention | Ví dụ |
|---|---|---|
| Backend folder (NEW/REBUILD) | `kebab-case`, tên domain | `po-review/`, `saop-consensus/`, `master-data/` |
| NestJS file (EXTEND) | `{domain}.{capability}.{type}.ts` | `allocation.lcnb.service.ts`, `demand.aggregate.service.ts` |
| NestJS file (NEW) | `{module}.{type}.ts` | `po-review.service.ts`, `saop-consensus.controller.ts` |
| NestJS class | `PascalCase` | `AllocationLcnbService` |
| DTO class | `{Action}{Entity}Dto` | `CreateAllocationDto` |
| Entity class | `PascalCase` | `AllocationLeg` |
| DB table (bảng mới) | `snake_case`, tên nghiệp vụ rõ | `allocation_leg`, `nm_atp_result`, `po_header` |
| DB column | `snake_case` | `plan_run_id`, `created_at` |
| API endpoint (EXTEND) | `/api/{domain}/{capability}` | `/api/demand/aggregate`, `/api/allocation/lcnb/run` |
| API endpoint (EXTEND + backward compat) | `/api/{domain}/v2/{capability}` | `/api/demand/v2/snapshot` (chỉ khi cần giữ /v1 song song) |
| API endpoint (NEW/REBUILD) | `/api/{domain}/{action}` | `/api/po-review/confirm`, `/api/saop-consensus/lock` |
| Frontend folder | `kebab-case` | `cn-demand-adjust/` |
| React component | `PascalCase` | `AllocationTable.tsx` |
| Python pipeline | `f{flow}_m{num}_{name}.py` | `f2_m24_allocation_lcnb.py` |
| Migration | `{date}_{module}_{action}.sql` | `20260416_m24_create_alloc_leg.sql` |

> **DB table naming:** KHÔNG dùng prefix `v2_`. Đặt tên theo nghiệp vụ rõ ràng.
> Nếu cần namespace tách biệt hard, dùng PostgreSQL schema: `CREATE SCHEMA scp_v2` → bảng nằm trong `scp_v2.po_header`, `scp_v2.nm_atp_result`.
> FK giữa schema cũ và mới: `scp_v2.allocation_leg.allocation_result_id → public.allocation_result.id` — chấp nhận được.
> Mặc định: tất cả bảng trong schema `public`, tên nghiệp vụ, không prefix.

---

## RULE 13 — Feature Flag (Bắt buộc cho mọi endpoint v2)

Mọi endpoint hoặc service của module v2 PHẢI bọc qua `FeatureFlagService` trước khi enable production.

```typescript
// ✅ ĐÚNG — endpoint v2 có feature flag (controller tên theo domain, không prefix v2/)
@Controller('po-review')
export class PoReviewController {
  constructor(
    private readonly service: PoReviewService,
    private readonly flags: FeatureFlagService,
  ) {}

  @Post('confirm')
  async confirm(@Body() dto: ConfirmPoDto) {
    if (!await this.flags.isEnabled('m27_po_rebuild_enabled')) {
      throw new ServiceUnavailableException('M27 chưa bật — liên hệ DevOps');
    }
    return this.service.confirm(dto);
  }
}

// ❌ SAI — không có flag, deploy thẳng ra prod
@Post('confirm')
async confirm(@Body() dto: ConfirmPoDto) {
  return this.service.confirm(dto);  // RISK: module chưa test đủ
}
```

**Flag key convention:** `m{num}_{short_name}_enabled`

| Module | Flag key |
|---|---|
| M12 | `m12_saop_consensus_enabled` |
| M22 | `m22_cn_demand_adjust_enabled` |
| M23 | `m23_drp_netting_v2_enabled` |
| M24 | `m24_allocation_lcnb_enabled` |
| M27 | `m27_po_rebuild_enabled` |
| M28 | `m28_feedback_loop_enabled` |

> Flag config lưu trong `system_config` table (M10 domain) hoặc `.env` khi dev local.
> DevOps1 là owner của feature flag infrastructure (Sprint 0-1).

---

## RULE 13b — Frontend Feature Gate (Bắt buộc cho page v2)

Mọi page/route của module v2 trên FE PHẢI bọc qua `<FeatureGate>`, fallback về UI legacy nếu flag tắt.

```tsx
// ✅ ĐÚNG — page v2 có FeatureGate + fallback
// frontend/app/po-review/page.tsx
export default function PoReviewPage() {
  return (
    <FeatureGate
      flag="m27_po_rebuild_enabled"
      fallback={<LegacyOrderPage />}   // ← UI cũ m7 khi flag tắt
    >
      <PoReviewV2Page />               // ← UI mới M27
    </FeatureGate>
  );
}

// components/shared/feature-gate.tsx
function FeatureGate({
  flag,
  fallback,
  children,
}: { flag: string; fallback?: ReactNode; children: ReactNode }) {
  const enabled = useFeatureFlag(flag);  // reads from system_config via API
  if (!enabled) return fallback ?? null;
  return <>{children}</>;
}

// ❌ SAI — page v2 không có gate, bồ tống ra prod dù BE chưa ready
export default function PoReviewPage() {
  return <PoReviewV2Page />;  // RISK: BE flag off nhưng FE vẫn render
}
```

**Rule:**
- Page v2 của module EXTEND: `<FeatureGate>` required nếu route mới có thể truy cập từ sidebar
- Page v2 của module NEW/REBUILD: `<FeatureGate>` required, fallback phải có (không được fallback null)
- `useFeatureFlag` hook gọi `/api/system-config/flags` — cache 60s, không hardcode

---

## RULE 14 — Policy Snapshot Pin (Baseline Drift Prevention)

Mọi module thuộc **DRP chain Flow 2** (M23, M24, M25) khi bắt đầu run PHẢI:

```typescript
// ✅ ĐÚNG — pin policy_run_id trước khi compute
async runDrpNetting(planRunId: string): Promise<NettingResult> {
  // Bước 1: tạo policy snapshot TRƯỚC
  const policyRun = await this.policyRepo.createSnapshot(planRunId);

  // Bước 2: lưu pin vào plan_run
  await this.planRunRepo.update(planRunId, {
    policy_run_id: policyRun.id,
  });

  // Bước 3: đọc config từ snapshot, KHÔNG đọc active policy
  const config = await this.policyRepo.getFromSnapshot(policyRun.id);

  // Bước 4: compute
  return this.compute(config, ...);
}

// ❌ SAI — đọc active policy runtime (drift risk)
async runDrpNetting(planRunId: string) {
  const config = await this.policyRepo.getActive();  // FORBIDDEN
  // Nếu policy thay đổi giữa M23→M24→M25, kết quả không consistent
}
```

**Tại sao:** Nếu policy thay đổi giữa các bước M23→M24→M25 trong cùng 1 DRP run, kết quả sẽ không nhất quán (baseline drift). Pin policy_run_id đảm bảo cả chain dùng cùng 1 snapshot config.

**PR rule:** Module M23, M24, M25 không có `policy_run_id` pin = **HARD BLOCKER**.

---

## RULE 15 — Test Coverage Thresholds

### Backend

| Loại test | Target | Scope | Tool |
|---|---|---|---|
| Unit test | ≥ 70% coverage | Service + Repository (mỗi module) | Jest |
| Integration test | 100% endpoints v2 | Mọi endpoint trong RULE 4 table | Jest + Supertest |
| E2E (DRP chain) | Bắt buộc | M23 → M24 → M25 full run | Jest |
| Performance | < 5 phút | DRP chain cho 10K SKU | k6 / Artillery |

```typescript
// ✅ Unit test bắt buộc — {module}.service.spec.ts
describe('DrpNettingService', () => {
  it('should pin policy_run_id before compute', async () => { ... });
  it('should block if supply freshness gate fails', async () => { ... });
  it('should use cn-adjusted demand when trust > 85%', async () => { ... });
});

// ✅ Integration test bắt buộc — {module}.controller.spec.ts
describe('POST /drp/netting/run', () => {
  it('returns 200 with plan_run_id', async () => { ... });
  it('returns 422 when supply data stale', async () => { ... });
});

// ✅ E2E DRP chain test — tests/e2e/drp-chain.spec.ts
it('DRP chain M23→M24→M25 completes for 10K SKU in < 5 min', async () => {
  const start = Date.now();
  await runM23(); await runM24(); await runM25();
  expect(Date.now() - start).toBeLessThan(5 * 60 * 1000);
});
```

### Frontend

| Loại test | Target | Tool |
|---|---|---|
| Component test | Mọi component trong components/{domain}/ mới | React Testing Library |
| FeatureGate test | Flag on và flag off phải test cả 2 cases | RTL |

```tsx
// ✅ FeatureGate test — test flag on và flag off
it('shows v2 page when flag enabled', () => {
  mockFlag('m27_po_rebuild_enabled', true);
  render(<PoReviewPage />);
  expect(screen.getByTestId('po-review-v2')).toBeInTheDocument();
});

it('falls back to legacy when flag disabled', () => {
  mockFlag('m27_po_rebuild_enabled', false);
  render(<PoReviewPage />);
  expect(screen.getByTestId('legacy-order-page')).toBeInTheDocument();
});
```

---

*PHASE2-DEV-RULES.md — UNIS SCP v2.0 | v1.3 | 2026-04-16*
*Đọc cùng với: `rules/CODING-RULES.md` · `docs/IMPLEMENT-CHECKLIST.md` · `docs/GROUP-MODULE.md` · `UNIS-SCP-v2.0-FULL-PRD.md`*
