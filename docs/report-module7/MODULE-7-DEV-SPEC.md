# Module 7 — Order Bridge: Dev Spec
> **Dành cho:** Dev team  
> **Dựa trên:** MODULE-7-FULL-IMPLEMENT.md v1.0 (đã Tech Lead review + cross-validate DB)  
> **Ngày:** 2026-04-15  
> **Status:** READY FOR DEVELOPMENT

---

## 1. Tổng quan nhiệm vụ

Module 7 nhận Transport Plan đã **CONFIRMED** từ M6, tạo Order Batch + các Order Lines, đi qua approval flow, rồi export CSV cho ERP Bravo.

```
transport_plan (CONFIRMED)
  → createBatch()  → order_batch (DRAFT) + order_line[] (ACTIVE)
  → submitBatch()  → SUBMITTED
  → approveBatch() → APPROVED
  → exportCsv()    → EXPORTED + file download CSV (UTF-8 BOM)
  → (REJECTED ở bước SUBMITTED → về DRAFT, submit lại)
```

**Phase 1 scope:** TO (Transfer Order) only. Không có auth/JWT. Không có SFTP. ERP ref ghi thủ công.

---

## 2. Data Dependencies — đọc kỹ trước khi code

### 2.1 Input từ M6 (transport module)

Service `_loadTripLines()` join 4 tables:

```sql
FROM transport_trip_line ttl
JOIN transport_trip tt   ON tt.id = ttl.transport_trip_id
JOIN transport_plan tp   ON tp.id = tt.transport_plan_id
LEFT JOIN item i         ON i.item_code = ttl.item_code
WHERE tp.id = $1::bigint
  AND tt.status = 'PLANNED'   -- bỏ qua trip NO_CARRIER
```

| Field lấy | Từ bảng | Cột thực tế |
|-----------|---------|-------------|
| item_code | transport_trip_line | item_code VARCHAR(50) |
| item_name | item | item_name VARCHAR(500) — snapshot lúc generate |
| base_uom | item | base_uom VARCHAR(20) DEFAULT 'M2' |
| qty | transport_trip_line | allocated_qty DECIMAL |
| source/dest location | transport_trip | source_location_code, dest_location_code VARCHAR(20) |
| departure_date, eta_date | transport_trip | DATE |
| carrier_code | transport_trip | VARCHAR(20) |
| allocationResultId | transport_trip_line | allocation_result_id BIGINT |

> **Tất cả FK đều là BIGINT hoặc VARCHAR — không có UUID.** Đây là điểm khác với spec gốc BA (đã được fix trong FULL-IMPLEMENT.md).

### 2.2 Prerequisite từ DA

DA phải chạy trước khi dev test:
- `transport_plan.status = 'CONFIRMED'` (ít nhất 1 plan)
- `transport_trip.status = 'PLANNED'` (có ít nhất 1 trip với lines)

```sql
-- DA verify
SELECT tt.status, COUNT(ttl.id) AS lines
FROM transport_trip tt
JOIN transport_trip_line ttl ON ttl.transport_trip_id = tt.id
WHERE tt.transport_plan_id = 1
GROUP BY tt.status;
-- Kỳ vọng: PLANNED | N lines
```

---

## 3. DB Schema — chạy migration

### `backend/src/orders/migrations/001_create_order_tables.sql`

Tạo 3 objects:

1. **`order_batch`** — header của 1 batch (1 plan = 1 batch, UNIQUE)
2. **`order_batch_seq`** — counter theo tháng để generate `batch_code` không bị race condition
3. **`order_line`** — 1 dòng = 1 item × 1 route từ 1 trip

Key constraints cần nhớ:
- `order_batch.transport_plan_id` → UNIQUE + FK → `transport_plan(id)`
- `order_line.order_no` → UNIQUE (format: `TO-YYYYMM-XXXX-L0001`)
- `order_line.transport_trip_id` → FK → `transport_trip(id)` (nullable)
- `order_line.allocation_result_id` → FK → `allocation_result(id)` (nullable)

SQL đầy đủ: xem **MODULE-7-FULL-IMPLEMENT.md Section 2**.

---

## 4. Cấu trúc thư mục BE cần tạo

```
backend/src/orders/
  ├── entities/
  │   ├── order-batch.entity.ts
  │   └── order-line.entity.ts
  ├── dto/
  │   └── index.ts
  ├── migrations/
  │   └── 001_create_order_tables.sql
  ├── order.config.ts
  ├── order.service.ts
  ├── order.controller.ts
  └── order.module.ts
```

Code đầy đủ: **MODULE-7-FULL-IMPLEMENT.md Section 3–8**.

---

## 5. API Endpoints (13 endpoints)

### Batches

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/orders/stats` | KPI dashboard: count by status, total_lines, total_qty |
| `POST` | `/orders/batches` | Generate batch từ `transportPlanId` (CONFIRMED) |
| `GET` | `/orders/batches` | List batches (filter: status, paginated) |
| `GET` | `/orders/batches/:id` | Detail 1 batch |
| `POST` | `/orders/batches/:id/submit` | DRAFT → SUBMITTED |
| `POST` | `/orders/batches/:id/approve` | SUBMITTED → APPROVED |
| `POST` | `/orders/batches/:id/reject` | SUBMITTED → DRAFT (rejectReason bắt buộc) |
| `DELETE` | `/orders/batches/:id` | Cancel (không cancel được EXPORTED) |
| `POST` | `/orders/batches/:id/export` | APPROVED → EXPORTED + trả file CSV |

### Lines

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/orders/batches/:id/lines` | List lines (filter: item, location, status) |
| `PATCH` | `/orders/lines/:id` | Update: unit_price, erp_ref, note, cancel line |

> **Prefix:** controller dùng `@Controller('orders')` → route đầy đủ `/api/v1/orders/...`

---

## 6. Business logic quan trọng — dev PHẢI hiểu

### 6.1 Validation chain khi createBatch

```
1. transport_plan tồn tại? → 404
2. transport_plan.status = 'CONFIRMED'? → 409
3. Đã có order_batch cho plan này? → 409 (UNIQUE)
4. Có trip_line nào với trip.status='PLANNED'? → 400 nếu empty
   (trip NO_CARRIER bị bỏ qua — chỉ PLANNED trip được tạo order)
```

### 6.2 batch_code generation — dùng upsert sequence, không dùng MAX()+1

```sql
-- ĐÚNG — đảm bảo không race condition
INSERT INTO order_batch_seq (month_key, last_seq)
VALUES ($1, 1)
ON CONFLICT (month_key) DO UPDATE
  SET last_seq = order_batch_seq.last_seq + 1
RETURNING last_seq;
-- Kết quả: TO-202604-0001, TO-202604-0002, ...

-- SAI — race condition nếu 2 request cùng lúc
SELECT MAX(last_seq) FROM order_batch_seq WHERE month_key = '202604';
```

### 6.3 State machine — valid transitions

```
DRAFT      → SUBMITTED  : submitBatch()   (phải có ≥1 ACTIVE line)
SUBMITTED  → APPROVED   : approveBatch()
SUBMITTED  → DRAFT      : rejectBatch()   (rejectReason bắt buộc, reset submittedBy/At)
APPROVED   → EXPORTED   : exportCsv()     (tự động khi gọi export endpoint)
ANY (trừ EXPORTED, CANCELLED) → CANCELLED : cancelBatch()
```

**Không có transition ngược từ EXPORTED.** Nếu cần sửa sau export → ghi `erp_ref` qua PATCH.

### 6.4 updateLine — business rules

```typescript
// Cancel line: chỉ khi batch còn DRAFT hoặc SUBMITTED
if (dto.status === 'CANCELLED') {
  const batch = await _getBatch(line.orderBatchId);
  if (!['DRAFT', 'SUBMITTED'].includes(batch.status)) → 409
}

// unitPriceVnd: cập nhật bất kỳ lúc nào (kể cả sau EXPORTED — Phase 1 để trống)
// erpRef: cập nhật bất kỳ lúc nào (sau EXPORTED Planner điền tay số chứng từ ERP)
```

### 6.5 exportCsv — UTF-8 BOM bắt buộc

```typescript
const csvText = '\uFEFF' + [header, ...rows].join('\n');
// '\uFEFF' = BOM — bắt buộc để Excel Windows đọc tiếng Việt đúng
// Thiếu BOM → tiếng Việt bị lỗi khi mở bằng Excel
```

Response headers:
```
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="orders_TO-202604-0001_20260415.csv"
```

### 6.6 item_name snapshot — không join lại sau

`order_line.item_name` được copy từ `item.item_name` tại thời điểm `createBatch()`. Nếu sau này item master thay đổi tên, order line vẫn giữ nguyên tên cũ. Đây là intentional — audit trail.

---

## 7. app.module.ts — thêm OrderModule

```typescript
import { OrderModule } from './orders/order.module';

@Module({
  imports: [
    // ... existing modules
    OrderModule,
  ],
})
export class AppModule {}
```

---

## 8. common/errors.ts — thêm 7 error codes

```typescript
ORDER_BATCH_NOT_FOUND:      { code: 'UNIS-ERR-018', msg: 'Order batch not found',               status: 404 },
ORDER_BATCH_WRONG_STATUS:   { code: 'UNIS-ERR-019', msg: 'Order batch status không hợp lệ',     status: 409 },
ORDER_LINE_NOT_FOUND:       { code: 'UNIS-ERR-020', msg: 'Order line not found',                status: 404 },
ORDER_PLAN_NOT_CONFIRMED:   { code: 'UNIS-ERR-021', msg: 'Transport plan chưa CONFIRMED',        status: 409 },
ORDER_BATCH_DUPLICATE:      { code: 'UNIS-ERR-022', msg: 'Order batch đã tồn tại cho plan này', status: 409 },
ORDER_REJECT_REASON_EMPTY:  { code: 'UNIS-ERR-023', msg: 'Lý do reject không được để trống',    status: 400 },
ORDER_EXPORT_NOT_APPROVED:  { code: 'UNIS-ERR-024', msg: 'Chỉ APPROVED batch mới export được',  status: 409 },
```

---

## 9. CSV Export — 16 cột cố định

| # | Column | Ví dụ |
|---|--------|-------|
| 1 | order_no | `TO-202604-0001-L0001` |
| 2 | order_type | `TO` |
| 3 | batch_code | `TO-202604-0001` |
| 4 | source_location_code | `001` |
| 5 | dest_location_code | `014` |
| 6 | item_code | `40.L1.3060.UGC3600` |
| 7 | item_name | `"Gạch 30x60 UGC3600 L1"` (double-quoted nếu có dấu phẩy) |
| 8 | base_uom | `M2` |
| 9 | qty | `918.00` |
| 10 | unit_price_vnd | `0` (Phase 1) |
| 11 | total_value_vnd | `0` (Phase 1) |
| 12 | departure_date | `2026-04-16` |
| 13 | eta_date | `2026-04-17` |
| 14 | carrier_code | `VTA-001` |
| 15 | erp_ref | (trống Phase 1) |
| 16 | status | `ACTIVE` |

---

## 10. Frontend — `app/execution/page.tsx` (đã có folder)

> Folder `frontend/app/execution/` đã tồn tại (có `page.tsx` cũ). Dev overwrite file đó.

**4 thành phần chính:**

| Thành phần | Mô tả |
|------------|-------|
| **KPI row** | 5 cards: Total / Draft / Submitted / Approved / Exported |
| **Left panel** | Create form (dropdown CONFIRMED plans chưa có batch) + batch history list |
| **Right panel — Action bar** | Submit / Approve / Reject / Export / Cancel tùy theo status hiện tại |
| **Lines table** | Paginated, filter item/location, inline edit erpRef khi EXPORTED |

**Reject flow:** khi click Reject → hiện modal input `rejectReason` (bắt buộc không để trống trước khi submit).

**Export button:** gọi `exportBatchCsv()` → tự trigger download file, batch chuyển EXPORTED. Không reload page thủ công — fetch lại batch detail sau khi export.

FE API types + functions đầy đủ: **MODULE-7-FULL-IMPLEMENT.md Section 10**.

---

## 11. Task Checklist

### DA (TRƯỚC khi test)
- [ ] **DA-1** Verify có `transport_plan.status = 'CONFIRMED'`
- [ ] **DA-2** Verify `transport_trip.status = 'PLANNED'` và có lines

### Backend
- [ ] **BE-1** Tạo `src/orders/` với đủ cấu trúc
- [ ] **BE-2** Tạo 2 entities: `order-batch.entity.ts`, `order-line.entity.ts`
- [ ] **BE-3** Chạy `001_create_order_tables.sql` (3 tables: order_batch, order_batch_seq, order_line)
- [ ] **BE-4** Thêm UNIS-ERR-018..024 vào `common/errors.ts`
- [ ] **BE-5** Tạo `order.config.ts`
- [ ] **BE-6** Tạo `dto/index.ts`
- [ ] **BE-7** Tạo `order.service.ts` — chú ý §6.1–6.5 ở trên
- [ ] **BE-8** Tạo `order.controller.ts`
- [ ] **BE-9** Tạo `order.module.ts`
- [ ] **BE-10** Register `OrderModule` trong `app.module.ts`
- [ ] **BE-11** `npm run build` — 0 TS errors
- [ ] **BE-12** Swagger: `POST /orders/batches` với planId CONFIRMED → batch tạo thành công
- [ ] **BE-13** Verify `order_line.item_name` có data (snapshot từ item table)
- [ ] **BE-14** Full flow: Create → Submit → Approve → Export → download file CSV
- [ ] **BE-15** Reject flow: Submit → Reject (có reason) → batch về DRAFT → Submit lại

### Frontend
- [ ] **FE-1** Tạo `lib/api/order.ts`
- [ ] **FE-2** Overwrite `app/execution/page.tsx` — 4 thành phần
- [ ] **FE-3** KPI row + Create form + batch history
- [ ] **FE-4** Action bar đúng theo status (Submit khi DRAFT, Approve/Reject khi SUBMITTED, Export khi APPROVED)
- [ ] **FE-5** Reject modal với rejectReason bắt buộc
- [ ] **FE-6** Lines table + filter + pagination
- [ ] **FE-7** Export button → file download + batch refresh

### QA
- [ ] **QA-1** E2E happy path: Confirm plan → Create batch → Submit → Approve → Export CSV
- [ ] **QA-2** Reject flow: Submit → Reject (có reason) → DRAFT → Submit lại → Approve
- [ ] **QA-3** Cancel: DRAFT/SUBMITTED/APPROVED OK → EXPORTED → 409
- [ ] **QA-4** Duplicate: tạo batch 2 lần cùng plan → 409
- [ ] **QA-5** Empty: plan không có PLANNED trips → 400
- [ ] **QA-6** CSV: mở bằng Excel → UTF-8 BOM đúng, tiếng Việt đúng, 16 columns đúng thứ tự
- [ ] **QA-7** Cancel line: APPROVED → 409; DRAFT → OK
- [ ] **QA-8** erpRef: ghi sau EXPORTED → 200 OK

---

## 12. Phase 2 — OUT OF SCOPE Phase 1

| Feature | Lý do defer |
|---------|------------|
| SO / PO order types | Cần customer/supplier master chưa có |
| JWT auth guard | Cần IAM service — Phase 1 dùng `approvedBy: string` free-text |
| 2-tier approval (CN_WH + SC_MANAGER states) | Phase 1 no-auth → 1 approve step |
| ERP webhook callback tự động ghi erp_ref | Cần ERP endpoint |
| unit_price từ price list | Cần pricing table |
| SFTP auto-push | Phase 4 của BA spec |

---

*Spec này là tài liệu chính thức cho dev. Mọi thắc mắc → hỏi Tech Lead trước khi tự quyết định.*