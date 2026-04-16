# M00 Master Data Platform — Tech Debt Registry

> **Version:** 1.0 · **Date:** 2026-04-16
> **Owner:** Tech Lead M00
> **Review cycle:** Đầu mỗi sprint planning

---

## Tổng quan

| Priority | Count | Sprint Target |
|----------|-------|--------------|
| CRITICAL (blocker cho Sprint 3) | 1 | Sprint 2 |
| HIGH | 2 | Sprint 2 |
| MEDIUM | 3 | Sprint 2-3 |
| LOW | 2 | Sprint 3+ |

---

## TD-01 — Supplier BIGSERIAL PK Migration

| Field | Value |
|-------|-------|
| **ID** | TD-01 |
| **Priority** | CRITICAL |
| **Sprint Target** | Sprint 2 (BLOCKER trước Sprint 3) |
| **Owner** | DA1 + BE3 |
| **Effort estimate** | 3-4 ngày (migration + test + rollback plan) |
| **Linked issue** | Issue-7, Spec deviation §4 |

**Mô tả:**

Bảng `supplier` hiện dùng `supplier_code VARCHAR(30)` làm PRIMARY KEY thay vì `BIGSERIAL id` như spec yêu cầu. Hậu quả:
- `sku_nm_mapping.nm_id` = 0 placeholder (không phải FK thực)
- `hub_nm_assignment.nm_id` = 0 placeholder
- Controller routes dùng `/:code` (string) thay vì `/:id` (number)
- Downstream modules M21/M22/M23/M28 không thể join qua `nm_id` foreign key

**Steps Sprint 2:**
1. `ALTER TABLE supplier ADD COLUMN id BIGSERIAL`
2. `ALTER TABLE supplier ALTER COLUMN id SET NOT NULL`
3. Backfill `sku_nm_mapping.nm_id` từ `nm_code → supplier.id`
4. Backfill `hub_nm_assignment.nm_id` từ `nm_code → supplier.id`
5. `ALTER TABLE sku_nm_mapping ADD CONSTRAINT fk_nm FOREIGN KEY(nm_id) REFERENCES supplier(id)`
6. `ALTER TABLE supplier DROP CONSTRAINT supplier_pkey, ADD PRIMARY KEY(id)`
7. Update TypeORM entities + service để dùng numeric id
8. Regression test tất cả supplier endpoints

Chi tiết đầy đủ: [M00-supplier-pk-deviation.md](./M00-supplier-pk-deviation.md)

---

## TD-02 — M10 SystemConfigService Integration

| Field | Value |
|-------|-------|
| **ID** | TD-02 |
| **Priority** | HIGH |
| **Sprint Target** | Sprint 2 |
| **Owner** | BE3 (M10 team cung cấp interface) |
| **Effort estimate** | 1 ngày sau khi M10 deploy |
| **Linked issue** | Spec C4, `feature-flag.service.ts` comment |

**Mô tả:**

`FeatureFlagService` hiện là stub:
```typescript
// Fallback khi M10 chưa có:
// 1. DB: SELECT enabled FROM feature_flag WHERE key = $1
// 2. Env: process.env['M00_MASTER_DATA_ENABLED'] !== 'false'
```

**Vấn đề:**
- Operator không có UI để toggle flag `m00_master_data_enabled`
- Không có toggle UI → không thể disable module an toàn khi có bug production
- `feature_flag` table do M10 tạo — M00 không own table này

**Action Sprint 2:**
1. Khi M10 deploy và `feature_flag` table tồn tại → verify DB lookup path works
2. Inject M10 `SystemConfigService` vào `FeatureFlagGuard` thay cho `FeatureFlagService`
3. Test QA-18: feature flag off → tất cả M00 endpoints trả 503

---

## TD-03 — Customer CRUD Incomplete

| Field | Value |
|-------|-------|
| **ID** | TD-03 |
| **Priority** | HIGH |
| **Sprint Target** | Sprint 2 |
| **Owner** | BE3 + FE2 |
| **Effort estimate** | 2 ngày BE + 1 ngày FE |
| **Linked issue** | Issue-6, module.ts comment |

**Mô tả:**

`Customer` entity và `customer` table đã tồn tại và registered trong module, nhưng:
- `MasterDataService` không có `customerRepo` injected
- Không có `createCustomer`, `listCustomers`, `getCustomer`, `updateCustomer` methods
- Không có controller routes cho `/customers/*`
- FE không có Customer tab
- `customer_cn` mapping table cũng chưa có service methods

**Action Sprint 2:**
```typescript
// Cần thêm vào MasterDataService constructor:
@InjectRepository(Customer)
private readonly customerRepo: Repository<Customer>,

// Cần implement:
async createCustomer(dto: CreateCustomerDto, userId: string): Promise<Customer>
async listCustomers(query: CustomerQueryDto): Promise<PaginatedResponse<Customer>>
async getCustomer(id: string): Promise<Customer>
async updateCustomer(id: string, dto: UpdateCustomerDto, userId: string): Promise<Customer>
async deactivateCustomer(id: string, userId: string): Promise<void>
```

---

## TD-04 — Frontend hardcoded BASE URL

| Field | Value |
|-------|-------|
| **ID** | TD-04 |
| **Priority** | MEDIUM |
| **Sprint Target** | Sprint 2 |
| **Owner** | FE2 |
| **Effort estimate** | 0.5 ngày |
| **Linked issue** | `frontend/lib/api/master-data.ts` line 1 |

**Mô tả:**

```typescript
const BASE = 'http://localhost:3002/api/v1/master-data';
```

URL backend hardcoded → không deploy được lên staging/production mà không sửa code.

**Action:**
```typescript
const BASE = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3002'}/api/v1/master-data`;
```

---

## TD-05 — transport_lane Extension Deferred

| Field | Value |
|-------|-------|
| **ID** | TD-05 |
| **Priority** | MEDIUM |
| **Sprint Target** | Sprint 3 (trước M21 kick-off) |
| **Owner** | DA1 + BE3 |
| **Effort estimate** | 1 ngày |
| **Linked issue** | Spec §1 Out-of-scope note, M6 dependency |

**Mô tả:**

Spec M00 yêu cầu extend `transport_lane` table (M6) với `transit_lt_days` và `lane_type`. Bị defer vì M6 migration phải deploy trước. Migration file có precondition check:
```sql
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='transport_lane') THEN
  RAISE EXCEPTION 'M6 transport_lane table required. Deploy M6 migrations first.';
```

**Action Sprint 3:**
1. Confirm M6 deployed
2. Run `ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS transit_lt_days INT`
3. Run `ALTER TABLE transport_lane ADD COLUMN IF NOT EXISTS lane_type VARCHAR(20)`
4. Update transport_lane entity + relevant services

---

## TD-06 — Integration Tests Thiếu

| Field | Value |
|-------|-------|
| **ID** | TD-06 |
| **Priority** | MEDIUM |
| **Sprint Target** | Sprint 2 |
| **Owner** | QA Lead |
| **Effort estimate** | 3-4 ngày |
| **Linked issue** | QA-18 to QA-25 |

**Mô tả:**

Hiện chỉ có 16 unit tests (mocked). Không có:
- E2E tests với real PostgreSQL
- Integration tests cho import/export flow
- Channel/Hub CRUD unit tests riêng
- SKU-CN mapping upsert tests
- Audit log content verification

**Action Sprint 2:**
- Setup PostgreSQL test container (Docker) cho integration tests
- Viết E2E spec file: `master-data.e2e-spec.ts`
- Cover QA-18 through QA-25 từ spec

---

## TD-07 — Audit Log Không Có Retention Policy

| Field | Value |
|-------|-------|
| **ID** | TD-07 |
| **Priority** | LOW |
| **Sprint Target** | Sprint 3 hoặc trước go-live |
| **Owner** | DA1 |
| **Effort estimate** | 1 ngày |

**Mô tả:**

`master_data_audit_log` không có:
- Retention policy (bao lâu giữ log?)
- Partition strategy (table sẽ grow unbounded)
- Archive/purge job

**Action:**
- Thêm PostgreSQL table partitioning by `changed_at` (monthly)
- Hoặc implement background job purge records > 1 năm

---

## TD-08 — `nm_code` Redundancy trong sku_nm_mapping

| Field | Value |
|-------|-------|
| **ID** | TD-08 |
| **Priority** | LOW (giải quyết sau TD-01) |
| **Sprint Target** | Sprint 2 (sau TD-01 hoàn thành) |
| **Owner** | DA1 + BE3 |
| **Effort estimate** | 0.5 ngày |

**Mô tả:**

Sau khi TD-01 (Supplier PK migration) hoàn thành, cột `nm_code VARCHAR` trong `sku_nm_mapping` sẽ trở thành redundant vì `nm_id BIGINT` sẽ là real FK. Có thể giữ `nm_code` như denormalized lookup field (tốt cho query performance) hoặc xóa bỏ.

**Decision:** Đề xuất GIỮ `nm_code` như denormalized field — tránh join trong list queries, nhất quán với pattern hiện tại. Chỉ cần đảm bảo sync khi update supplier code (nếu có).

---

## Summary Dashboard

| TD | Mô tả ngắn | Priority | Owner | Sprint |
|----|------------|----------|-------|--------|
| TD-01 | Supplier BIGSERIAL migration | CRITICAL | DA1+BE3 | S2 |
| TD-02 | M10 FeatureFlag integration | HIGH | BE3 | S2 |
| TD-03 | Customer CRUD | HIGH | BE3+FE2 | S2 |
| TD-04 | FE hardcoded BASE URL | MEDIUM | FE2 | S2 |
| TD-05 | transport_lane extension | MEDIUM | DA1+BE3 | S3 |
| TD-06 | Integration tests | MEDIUM | QA Lead | S2 |
| TD-07 | Audit log retention | LOW | DA1 | S3+ |
| TD-08 | nm_code redundancy cleanup | LOW | DA1+BE3 | S2 (post TD-01) |
