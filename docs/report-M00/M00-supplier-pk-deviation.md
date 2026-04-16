# M00 — Supplier PK Deviation: Phân tích & Migration Plan

> **Version:** 1.0 · **Date:** 2026-04-16
> **Author:** RVA (Release Verification Analyst)
> **Priority:** CRITICAL — Phải giải quyết Sprint 2 trước khi Sprint 3 (M21/M22/M23) kick-off
> **Linked Tech Debt:** TD-01

---

## 1. Vấn đề là gì?

### 1.1 Spec yêu cầu

Theo `M00-master-data-platform.md` §0 Constraints:

> **PK tất cả tables: `BIGSERIAL`** — Consistent với M1-M10

Nghĩa là `supplier` table phải có:
```sql
CREATE TABLE supplier (
  id BIGSERIAL PRIMARY KEY,
  nm_code VARCHAR(30) NOT NULL UNIQUE,
  ...
);
```

Và `sku_nm_mapping` phải có:
```sql
CREATE TABLE sku_nm_mapping (
  nm_id BIGINT NOT NULL REFERENCES supplier(id),
  ...
);
```

### 1.2 Thực tế hiện tại

Bảng `supplier` được kế thừa từ M1-M10 với schema:
```sql
CREATE TABLE supplier (
  supplier_code VARCHAR(30) PRIMARY KEY,  -- VARCHAR PK, không phải BIGSERIAL
  supplier_name VARCHAR(200) NOT NULL,
  lead_time_days INT,
  region VARCHAR(50),
  factory_code VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  lt_drift_count INT NOT NULL DEFAULT 0,
  lt_drift_last_at TIMESTAMP
);
```

Hậu quả trong `sku_nm_mapping` (actual migration):
```sql
CREATE TABLE sku_nm_mapping (
  id BIGSERIAL PRIMARY KEY,
  sku_id BIGINT NOT NULL REFERENCES sku(id) ON DELETE CASCADE,
  nm_id BIGINT NOT NULL DEFAULT 0,   -- PLACEHOLDER! Không phải real FK
  nm_code VARCHAR(30) DEFAULT NULL,  -- Đây mới là reference thực
  moq DECIMAL(15,2) NOT NULL DEFAULT 0,
  ...
);
```

Và trong `hub_nm_assignment`:
```sql
CREATE TABLE hub_nm_assignment (
  hub_id BIGINT NOT NULL REFERENCES hub(id) ON DELETE CASCADE,
  nm_id BIGINT NOT NULL DEFAULT 0,   -- PLACEHOLDER!
  ...
);
```

### 1.3 Workaround hiện tại trong Service

```typescript
// master-data.service.ts — createSku()
const mapping = em.create(SkuNmMapping, {
  skuId: savedSku.id,
  nmId: '0',          // <-- Placeholder, không phải real FK
  nmCode: supplier.supplierCode,  // <-- Reference thực
  moq: dto.moq ?? 0,
  ...
});
```

---

## 2. Impact Assessment

### 2.1 Impact Trực tiếp (M00 Sprint 1)

| Hệ quả | Severity | Hiện tại workaround? |
|--------|----------|---------------------|
| `sku_nm_mapping.nm_id = 0` — không có referential integrity | HIGH | Dùng `nm_code` |
| `hub_nm_assignment.nm_id = 0` — tương tự | HIGH | Không có workaround |
| Controller routes dùng `/:code` string thay vì `/:id` number | MEDIUM | Đã implement đúng pattern |
| TypeORM Supplier entity không có `id` field | MEDIUM | Dùng `supplierCode` làm PK |
| `DELETE /suppliers/:id` không implement (không có CRUD create) | LOW | Spec: import via CSV only |

### 2.2 Impact Downstream (Sprint 3+)

| Module | Vấn đề | Severity |
|--------|--------|----------|
| **M21 — MRP / Purchase Order** | Query `JOIN sku_nm_mapping ON nm_id = supplier.id` sẽ fail (nm_id = 0) | CRITICAL |
| **M22 — Allocation Engine** | Tính toán allocation cần supplier → SKU linkage qua FK | CRITICAL |
| **M23 — Transport Planning** | `hub_nm_assignment` join `supplier` — nm_id = 0 → no rows | HIGH |
| **M28 — Feedback Loop** | Auto-update `honoring_rate`, `lt_sigma` cần identify supplier by id | HIGH |
| **All modules** | Bất kỳ query nào dùng `WHERE nm_id = supplier.id` sẽ miss data | HIGH |

### 2.3 Ví dụ Query bị ảnh hưởng

M21 sẽ cần query như sau:
```sql
-- Dự kiến M21 query — SẼ FAIL với nm_id = 0:
SELECT s.sku_code, sup.supplier_name, sup.lead_time_days
FROM sku s
JOIN sku_nm_mapping m ON s.id = m.sku_id AND m.active = TRUE
JOIN supplier sup ON m.nm_id = sup.id  -- <-- JOIN này fail: 0 không match bất kỳ supplier.id nào
WHERE s.active = TRUE;

-- Workaround tạm thời (dùng nm_code):
SELECT s.sku_code, sup.supplier_name, sup.lead_time_days
FROM sku s
JOIN sku_nm_mapping m ON s.id = m.sku_id AND m.active = TRUE
JOIN supplier sup ON m.nm_code = sup.supplier_code  -- <-- Phải dùng VARCHAR join
WHERE s.active = TRUE;
```

VARCHAR join hoạt động nhưng:
- Không có index tốt bằng BIGINT FK
- Không có referential integrity
- Inconsistent với tất cả module khác

---

## 3. Sprint 2 Migration Plan

### 3.1 Prerequisites

- [ ] Backup production database trước khi bắt đầu
- [ ] Staging environment với data copy đầy đủ
- [ ] Rollback script sẵn sàng
- [ ] Maintenance window thông báo (migration có ALTER TABLE → lock)

### 3.2 Migration Steps (Ordered)

**File name:** `20260422_m00_supplier_pk_bigserial.up.sql`

```sql
BEGIN;

-- ─── STEP 1: Add BIGSERIAL id column to supplier ─────────────────────
ALTER TABLE supplier ADD COLUMN IF NOT EXISTS id BIGSERIAL;
-- Note: BIGSERIAL creates sequence automatically; rows get auto-incremented id

-- ─── STEP 2: Drop old nm_id placeholder default ──────────────────────
-- Remove DEFAULT 0 từ nm_id trước khi backfill
ALTER TABLE sku_nm_mapping ALTER COLUMN nm_id DROP DEFAULT;
ALTER TABLE hub_nm_assignment ALTER COLUMN nm_id DROP DEFAULT;

-- ─── STEP 3: Backfill nm_id in sku_nm_mapping ────────────────────────
UPDATE sku_nm_mapping m
SET nm_id = s.id
FROM supplier s
WHERE m.nm_code = s.supplier_code
  AND m.nm_id = 0;

-- Safety check: no orphan rows
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sku_nm_mapping WHERE nm_id = 0) THEN
    RAISE EXCEPTION 'sku_nm_mapping còn rows với nm_id = 0 — backfill failed';
  END IF;
END $$;

-- ─── STEP 4: Backfill nm_id in hub_nm_assignment ─────────────────────
-- hub_nm_assignment không có nm_code column — cần business logic riêng
-- TBD: Cần DA confirm mapping rule Hub→Supplier
-- Tạm thời: hub_nm_assignment cần nm_code column thêm vào trước

-- ─── STEP 5: Add FK constraint sku_nm_mapping → supplier.id ──────────
ALTER TABLE sku_nm_mapping
  ADD CONSTRAINT fk_sku_nm_supplier
  FOREIGN KEY (nm_id) REFERENCES supplier(id)
  ON DELETE RESTRICT;  -- không cho xóa supplier khi còn SKU mapping

-- ─── STEP 6: Swap supplier primary key ───────────────────────────────
-- Drop old PK
ALTER TABLE supplier DROP CONSTRAINT supplier_pkey;
-- Add new PK on id
ALTER TABLE supplier ADD PRIMARY KEY (id);
-- Keep supplier_code UNIQUE (business identifier)
ALTER TABLE supplier ADD CONSTRAINT uq_supplier_code UNIQUE (supplier_code);

-- ─── STEP 7: Rename columns cho nhất quán với spec ───────────────────
-- Optional: rename supplier_code → nm_code, supplier_name → nm_name
-- RISK: Cần update TypeORM entity + service + controller nếu rename
-- Decision: Giữ nguyên tên hiện tại (supplier_code, supplier_name) để minimize risk
-- Document as accepted inconsistency với spec

COMMIT;
```

### 3.3 TypeORM Entity Changes (sau migration)

```typescript
// entities/supplier.entity.ts — sau migration
@Entity('supplier')
export class Supplier {
  @PrimaryGeneratedColumn('increment')  // thay vì @PrimaryColumn
  id: string;

  @Column({ name: 'supplier_code', unique: true })
  supplierCode: string;

  // ... rest unchanged
}

// entities/sku-nm-mapping.entity.ts — sau migration
@Entity('sku_nm_mapping')
export class SkuNmMapping {
  // ...
  @Column({ name: 'nm_id' })
  nmId: string;  // Bây giờ là real BIGINT FK

  @Column({ name: 'nm_code', nullable: true })
  nmCode: string | null;  // Giữ như denormalized field (TD-08)
  // ...
}
```

### 3.4 Service Changes (sau migration)

```typescript
// master-data.service.ts — createSku() sau migration
const mapping = em.create(SkuNmMapping, {
  skuId: savedSku.id,
  nmId: supplier.id,        // <-- Real FK, không còn '0'
  nmCode: supplier.supplierCode,  // Giữ denormalized
  moq: dto.moq ?? 0,
  ...
});
```

### 3.5 Controller Changes (sau migration)

```typescript
// Supplier routes: giữ /:code pattern hay đổi sang /:id?
// Recommendation: GIỮ /:code pattern vì:
// 1. Operator nhớ code dễ hơn numeric id
// 2. M21/M22 đã biết supplier_code từ ERP
// 3. Breaking change nếu đổi — FE phải update

// KHÔNG thay đổi: GET /suppliers/:code, PATCH /suppliers/:code
// Chỉ thay đổi internal queries dùng id
```

### 3.6 Rollback Plan

```sql
-- Rollback script: 20260422_m00_supplier_pk_bigserial.down.sql
BEGIN;

-- Remove FK constraint
ALTER TABLE sku_nm_mapping DROP CONSTRAINT IF EXISTS fk_sku_nm_supplier;

-- Restore nm_id = 0 for all rows
UPDATE sku_nm_mapping SET nm_id = 0;
ALTER TABLE sku_nm_mapping ALTER COLUMN nm_id SET DEFAULT 0;

-- Restore supplier PK
ALTER TABLE supplier DROP CONSTRAINT IF EXISTS supplier_pkey;
ALTER TABLE supplier DROP CONSTRAINT IF EXISTS uq_supplier_code;
ALTER TABLE supplier ADD PRIMARY KEY (supplier_code);

-- Remove id column
ALTER TABLE supplier DROP COLUMN IF EXISTS id;

COMMIT;
```

---

## 4. Verification Checklist (Sprint 2)

### Database

- [ ] `supplier.id` column tồn tại, type BIGINT NOT NULL
- [ ] `supplier.id` là PRIMARY KEY
- [ ] `supplier.supplier_code` có UNIQUE constraint
- [ ] `sku_nm_mapping.nm_id` là BIGINT FK → `supplier.id` (không có constraint violation)
- [ ] Không còn rows nào có `sku_nm_mapping.nm_id = 0`
- [ ] `hub_nm_assignment.nm_id` backfilled hoặc có migration plan riêng

### Backend

- [ ] `Supplier` entity có `@PrimaryGeneratedColumn('increment') id`
- [ ] `createSku()` dùng `supplier.id` thay vì `'0'`
- [ ] `changeSkuNm()` dùng `supplier.id`
- [ ] Unit tests vẫn pass sau entity changes
- [ ] Integration test: create SKU → verify nm_id matches supplier.id

### Downstream Compatibility

- [ ] `GET /suppliers/:code` vẫn hoạt động (không đổi)
- [ ] `PATCH /suppliers/:code` vẫn hoạt động
- [ ] `POST /suppliers/:code/lt-override` vẫn hoạt động
- [ ] M21 prototype query với `JOIN supplier ON nm_id = supplier.id` — verify returns data

---

## 5. Communication Plan

| Stakeholder | Cần thông báo | Nội dung |
|-------------|--------------|---------|
| M21/M22/M23 BE dev | Trước Sprint 2 start | "nm_id sẽ là real FK sau Sprint 2 — đừng hardcode workaround nm_code join" |
| M28 team | Trước Sprint 2 start | "supplier.id sẽ available — dùng id cho feedback loop updates" |
| FE2 | Sau migration | "supplier API không thay đổi — supplier_code vẫn là identifier trong URL" |
| QA Lead | Sprint 2 start | "TD-01 migration cần full regression test supplier endpoints + M21 integration" |

---

## 6. Timeline Estimate

| Task | Effort | Who | Day |
|------|--------|-----|-----|
| Write migration SQL + rollback | 1 ngày | DA1 | Sprint 2 Day 1 |
| Test migration trên staging (copy data) | 1 ngày | DA1 + BE3 | Sprint 2 Day 2 |
| Update TypeORM entities + service | 0.5 ngày | BE3 | Sprint 2 Day 2 |
| Update + run unit tests | 0.5 ngày | BE3 | Sprint 2 Day 3 |
| Integration test (real DB) | 1 ngày | QA Lead | Sprint 2 Day 3-4 |
| Production migration (maintenance window) | 2 giờ | DA1 | Sprint 2 Day 5 |
| Post-migration verification | 0.5 ngày | QA Lead | Sprint 2 Day 5 |

**Total:** ~4 ngày elapsed time nếu không có issues.

> **Dependency:** M21/M22/M23 KHÔNG được start development trước khi TD-01 complete và verified.
