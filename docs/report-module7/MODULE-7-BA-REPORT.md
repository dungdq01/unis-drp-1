# Module 7 — Order Bridge: BA Report
> **Ngày hoàn thành:** 2026-04-15  
> **Trạng thái:** DONE — Backend + Frontend hoàn chỉnh, chờ DA seed data  
> **Phụ thuộc:** Module 6 (transport_plan CONFIRMED)

---

## 1. Mục tiêu module

Module 7 là cầu nối cuối cùng trong chuỗi Supply Chain Planning, chuyển đổi kết quả Transport Planning (M6) thành Transfer Order (TO) chuẩn ERP và xuất file CSV để nạp vào hệ thống Bravo.

**Luồng chính:**
```
transport_plan (CONFIRMED)
    → Generate order_batch + order_line[]    [Planner]
    → Submit for approval                    [Planner]
    → Approve / Reject                       [SC Manager]
    → Export CSV → ERP Bravo                 [SC Manager]
    → Ghi ERP ref số chứng từ               [Planner]
```

---

## 2. Phạm vi Phase 1

| Trong scope | Ngoài scope (Phase 2) |
|-------------|----------------------|
| Transfer Order (TO) | Sales Order (SO), Purchase Order (PO) |
| Approval 1 bước (Submit → Approve) | 2-tier approval (CN_WH + SC_MANAGER) |
| Export CSV thủ công (download) | SFTP auto-push sang ERP |
| ERP ref ghi thủ công | Webhook tự động nhận erp_ref từ ERP |
| unit_price = 0 (Phase 1) | unit_price từ bảng giá |
| No auth (actor free-text) | JWT guard + role-based access |

---

## 3. Luồng nghiệp vụ chi tiết

### 3.1 Generate Batch

1. Planner chọn Transport Plan có status `CONFIRMED` từ dropdown
2. Hệ thống validate:
   - Plan tồn tại → nếu không: **404**
   - Plan status = CONFIRMED → nếu không: **409**
   - Chưa có batch cho plan này → nếu đã có: **409** (UNIQUE)
   - Có ít nhất 1 trip line với trip.status = PLANNED → nếu không: **400**
3. Sinh `batch_code` tự động (atomic, không race condition): `TO-202604-0001`
4. Tạo `order_batch` header (status = DRAFT)
5. Flatten tất cả `transport_trip_line` của các PLANNED trips → tạo `order_line[]`
   - Mỗi line có `order_no` = `{batch_code}-L{seq4}`, ví dụ `TO-202604-0001-L0001`
   - `item_name` được **snapshot** từ item master tại thời điểm generate (audit trail)
   - Các trip có status = `NO_CARRIER` bị bỏ qua

### 3.2 Approval Flow

```
DRAFT ──[Submit]──► SUBMITTED ──[Approve]──► APPROVED ──[Export]──► EXPORTED
                        │
                     [Reject]
                        │
                        ▼
                      DRAFT   ← rejectReason bắt buộc, submittedBy/At được reset
```

- **Submit:** Planner submit → batch sang SUBMITTED (phải có ≥1 ACTIVE line)
- **Approve:** SC Manager approve → batch sang APPROVED
- **Reject:** SC Manager reject kèm lý do bắt buộc → batch trở về DRAFT để Planner chỉnh sửa
- **Cancel:** Hủy batch ở bất kỳ status nào trừ EXPORTED và CANCELLED

### 3.3 Export CSV

- Chỉ APPROVED batch mới export được
- File CSV 16 cột chuẩn ERP Bravo, UTF-8 BOM (đảm bảo Excel Windows đọc tiếng Việt đúng)
- Tên file: `orders_{batch_code}_{YYYYMMDD}.csv`
- Sau khi download → batch tự chuyển sang EXPORTED
- Sau EXPORTED: Planner điền `erp_ref` (số chứng từ ERP) thủ công vào từng line

---

## 4. Dữ liệu đầu vào / đầu ra

### 4.1 Input từ Module 6

| Field | Source table | Cột thực tế |
|-------|-------------|-------------|
| item_code | transport_trip_line | item_code VARCHAR(50) |
| item_name | item | item_name (snapshot) |
| base_uom | item | base_uom DEFAULT 'M2' |
| qty | transport_trip_line | allocated_qty DECIMAL |
| source/dest location | transport_trip | source_location_code, dest_location_code VARCHAR(20) |
| departure_date, eta_date | transport_trip | DATE |
| carrier_code | transport_trip | VARCHAR(20) |
| allocation_result_id | transport_trip_line | BIGINT (nullable) |

### 4.2 Output: CSV 16 cột

| # | Column | Ví dụ |
|---|--------|-------|
| 1 | order_no | `TO-202604-0001-L0001` |
| 2 | order_type | `TO` |
| 3 | batch_code | `TO-202604-0001` |
| 4 | source_location_code | `001` |
| 5 | dest_location_code | `014` |
| 6 | item_code | `40.L1.3060.UGC3600` |
| 7 | item_name | `"Gạch 30x60 UGC3600 L1"` |
| 8 | base_uom | `M2` |
| 9 | qty | `918.00` |
| 10 | unit_price_vnd | `0` (Phase 1) |
| 11 | total_value_vnd | `0` (Phase 1) |
| 12 | departure_date | `2026-04-16` |
| 13 | eta_date | `2026-04-17` |
| 14 | carrier_code | `VTA-001` |
| 15 | erp_ref | *(trống Phase 1, điền sau)* |
| 16 | status | `ACTIVE` |

---

## 5. DB Schema

### 3 tables mới

**`order_batch`** — Header của 1 batch (1 transport_plan = 1 batch, UNIQUE constraint)

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| transport_plan_id | BIGINT UNIQUE FK | FK → transport_plan(id) |
| batch_code | VARCHAR(30) UNIQUE | TO-YYYYMM-XXXX |
| status | VARCHAR(20) | DRAFT/SUBMITTED/APPROVED/EXPORTED/CANCELLED |
| total_lines | INT | Tổng số lines ACTIVE |
| total_qty | DECIMAL(18,2) | Tổng qty |
| total_value_vnd | DECIMAL(18,2) | Tổng giá trị (Phase 1 = 0) |
| submitted_by/at | VARCHAR/TIMESTAMP | Audit trail |
| approved_by/at | VARCHAR/TIMESTAMP | Audit trail |
| rejected_by/at + reason | VARCHAR/TIMESTAMP/TEXT | Audit trail |
| exported_by/at | VARCHAR/TIMESTAMP | Audit trail |
| created_by | VARCHAR(100) | Actor free-text |

**`order_batch_seq`** — Counter theo tháng, tránh race condition

| Column | Type | Ghi chú |
|--------|------|---------|
| month_key | CHAR(6) PK | Ví dụ: '202604' |
| last_seq | INT | Tăng dần bằng atomic upsert |

**`order_line`** — 1 dòng = 1 item × 1 route từ 1 trip

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| order_batch_id | BIGINT FK | FK → order_batch(id) |
| order_no | VARCHAR(40) UNIQUE | {batch_code}-L{seq4} |
| order_type | VARCHAR(10) | TO (Phase 1) |
| source/dest_location_code | VARCHAR(20) | |
| item_code | VARCHAR(50) | |
| item_name | VARCHAR(500) | Snapshot tại generate time |
| base_uom | VARCHAR(20) | DEFAULT 'M2' |
| qty | DECIMAL(15,2) | |
| unit_price_vnd | DECIMAL(15,2) | Phase 1: 0 |
| total_value_vnd | DECIMAL(18,2) | qty × unit_price |
| departure_date / eta_date | DATE | Copy từ transport_trip |
| carrier_code | VARCHAR(20) | |
| transport_trip_id | BIGINT nullable FK | Traceability |
| allocation_result_id | BIGINT nullable FK | Traceability |
| status | VARCHAR(20) | ACTIVE / CANCELLED |
| erp_ref | VARCHAR(50) | Điền sau khi export sang ERP |

---

## 6. API Endpoints (11 endpoints)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/orders/stats` | KPI dashboard: count by status, total_lines, total_qty |
| POST | `/api/v1/orders/batches` | Generate batch từ transportPlanId (CONFIRMED) |
| GET | `/api/v1/orders/batches` | List batches (filter status, paginated) |
| GET | `/api/v1/orders/batches/:id` | Detail 1 batch |
| POST | `/api/v1/orders/batches/:id/submit` | DRAFT → SUBMITTED |
| POST | `/api/v1/orders/batches/:id/approve` | SUBMITTED → APPROVED |
| POST | `/api/v1/orders/batches/:id/reject` | SUBMITTED → DRAFT (rejectReason bắt buộc) |
| DELETE | `/api/v1/orders/batches/:id` | Cancel (không cancel được EXPORTED) |
| POST | `/api/v1/orders/batches/:id/export` | APPROVED → EXPORTED + download CSV |
| GET | `/api/v1/orders/batches/:id/lines` | List lines (filter item/location/status, paginated) |
| PATCH | `/api/v1/orders/lines/:id` | Update: unit_price, erp_ref, note, cancel line |

---

## 7. Error Codes

| Code | HTTP | Khi nào |
|------|------|---------|
| UNIS-ERR-018 | 404 | order_batch not found |
| UNIS-ERR-019 | 409 | order_batch status không hợp lệ cho action |
| UNIS-ERR-020 | 404 | order_line not found |
| UNIS-ERR-021 | 409 | Transport plan chưa CONFIRMED |
| UNIS-ERR-022 | 409 | Order batch đã tồn tại cho plan này |
| UNIS-ERR-023 | 400 | Lý do reject không được để trống |
| UNIS-ERR-024 | 409 | Chỉ APPROVED batch mới export được |

---

## 8. Frontend (app/execution/page.tsx)

**4 thành phần:**

| Thành phần | Mô tả |
|------------|-------|
| KPI Row | 5 cards: Total / Draft / Submitted / Approved / Exported |
| Left panel — Create form | Dropdown CONFIRMED plans chưa có batch + Generate button |
| Left panel — Batch history | Danh sách batches, filter theo status, pagination |
| Right panel — Detail + Actions | Action bar theo status + Batch KPI pills + Reject reason box |
| Right panel — Lines table | Paginated, inline erpRef edit (onBlur save), cancel line button |

**Reject flow:** click Reject → modal nhập rejectReason (bắt buộc, validate trước khi submit)

**Export flow:** click Export CSV → trigger browser download → batch refresh tự động → hiển thị EXPORTED state

---

## 9. Trạng thái hoàn thành

### Backend ✅ DONE

- [x] `src/orders/` đầy đủ cấu trúc (entities, dto, config, service, controller, module)
- [x] `OrderModule` registered trong `app.module.ts`
- [x] UNIS-ERR-018..024 trong `common/errors.ts`
- [x] Validation chain `createBatch()` đúng thứ tự (404 → 409 → 409 → 400)
- [x] `_nextBatchCode()` atomic upsert — không race condition
- [x] `_loadTripLines()` join 4 tables, filter `tt.status = 'PLANNED'`
- [x] `item_name` snapshot tại generate time
- [x] `submitBatch()` check ≥1 ACTIVE line
- [x] `rejectBatch()` reset submittedBy/At, lưu rejectReason
- [x] `exportCsv()` UTF-8 BOM, 16 cột đúng thứ tự, mark EXPORTED sau file build
- [x] `updateLine()` cancel chỉ khi batch DRAFT/SUBMITTED, `_recalcBatchValue()` sau update

### Frontend ✅ DONE

- [x] `lib/api/order.ts` — đủ types + 11 API functions
- [x] `app/execution/page.tsx` — 549 lines, đầy đủ 4 thành phần
- [x] RejectModal với mandatory rejectReason validation
- [x] LinesPanel: pagination, inline erpRef edit onBlur, cancel line
- [x] Action bar đúng theo status (Submit/Approve+Reject/Export)
- [x] Export trigger file download + batch auto-refresh

---

## 10. Việc còn lại cho DA (BLOCKING trước khi test)

**Bước 1 — Chạy migration:**
```sql
-- Chạy file: backend/src/orders/migrations/001_create_order_tables.sql
-- Tạo 3 tables: order_batch, order_batch_seq, order_line
```

**Bước 2 — Verify prerequisite data:**
```sql
-- Cần có ít nhất 1 transport_plan CONFIRMED với PLANNED trips và lines
SELECT tp.id, tp.status, COUNT(ttl.id) AS lines
FROM transport_plan tp
JOIN transport_trip tt ON tt.transport_plan_id = tp.id
JOIN transport_trip_line ttl ON ttl.transport_trip_id = tt.id
WHERE tp.status = 'CONFIRMED' AND tt.status = 'PLANNED'
GROUP BY tp.id, tp.status;
-- Kỳ vọng: ít nhất 1 row với lines > 0
```

---

## 11. Known Constraints / Giới hạn Phase 1

| Giới hạn | Lý do | Phase 2 plan |
|----------|-------|-------------|
| unit_price = 0 | Chưa có bảng giá | Tích hợp price list module |
| erp_ref ghi thủ công | Chưa có ERP webhook | API callback từ Bravo |
| Actor là free-text VARCHAR | Chưa có IAM | JWT guard + user lookup |
| 1 approve bước | Đơn giản hóa Phase 1 | 2-tier: CN_WH + SC_MANAGER |
| CSV download thủ công | Phase 1 scope | SFTP auto-push |
| Chỉ Transfer Order (TO) | SO/PO cần customer/supplier master | Sau khi có master data |

---

## 12. Phase 2 Roadmap

| Feature | Dependency |
|---------|------------|
| SO (Sales Order) | Customer master |
| PO (Purchase Order) | Supplier master |
| JWT auth + role guard | IAM service |
| 2-tier approval | Role mapping (CN_WH, SC_MANAGER) |
| ERP webhook → auto erp_ref | Bravo API endpoint |
| unit_price từ price list | Pricing table |
| SFTP auto-push CSV | SFTP server config + cron job |

---

*Module 7 hoàn thành. Tech Lead review: 2026-04-15.*