# M00 Master Data Platform — QA Test Cases

> **Version:** 1.0 · **Date:** 2026-04-16 · **Author:** BA Review
> **Ref Spec:** M00-master-data-platform.md v1.2
> **Total:** 35 test cases (QA-1 → QA-35)
> **Status:** QA-1→QA-25 từ DoD spec · QA-26→QA-35 BA-added (BLOCK-2 review)

---

## Happy Path (QA-1 → QA-10)

| # | Test | Input | Expected | Priority |
|---|------|-------|----------|----------|
| QA-1 | POST SKU không có nmId | Body thiếu field `nm_id` | 400 validation error | P0 |
| QA-2 | POST SKU với nmId không tồn tại | `nm_id` trỏ đến supplier không có trong DB | 404 `MD_NM_NOT_FOUND` | P0 |
| QA-3 | POST SKU với sku_code duplicate | `sku_code` đã tồn tại trong DB | 409 `MD_SKU_CODE_DUPLICATE` | P0 |
| QA-4 | POST variant không có sku_id | Body thiếu field `sku_id` | 400 validation error | P0 |
| QA-5 | POST variant với variant_code duplicate | Cùng `(sku_id, variant_code)` đã tồn tại | 409 `MD_VARIANT_CODE_DUP` | P0 |
| QA-6 | POST channel không có lat/lng | Body thiếu `latitude` hoặc `longitude` | 400 validation error | P1 |
| QA-7 | DELETE supplier đang có active SKU | Supplier đang được reference bởi active SKU-NM mapping | 409 `MD_SUPPLIER_IN_USE` | P0 |
| QA-8 | Import CSV 501 rows | File CSV 501 rows | 413 `MD_IMPORT_TOO_MANY` | P1 |
| QA-9 | Import CSV với header sai | CSV thiếu cột bắt buộc hoặc header không khớp | 400 `MD_IMPORT_INVALID_HEADER` | P1 |
| QA-10 | Import dry-run 100 rows (80 valid, 20 invalid) | `dryRun=true`, file 100 rows có 20 lỗi | Preview: `validRows=80`, `errorRows=20`, không ghi DB | P0 |

---

## Business Rule Tests (QA-11 → QA-20)

| # | Test | Input | Expected | Priority |
|---|------|-------|----------|----------|
| QA-11 | Import commit 80 valid rows | `dryRun=false`, 80 rows valid | 80 rows inserted, audit log 80 entries | P0 |
| QA-12 | GET supplier upload-template | `GET /supplier/:id/upload-template` với NM có SKU | Response: CSV file chứa SKU list của NM đó | P1 |
| QA-13 | GET /quality metrics | DB có test data đầy đủ | 4 metrics trả về đúng: orphan_sku_count, orphan_cn_count, inactive_sku_count, no_hub_cn_count | P1 |
| QA-14 | Soft delete SKU | `DELETE /sku/:id`, sau đó `GET /sku?activeOnly=true` | `active=false` trong DB; SKU không xuất hiện trong list | P0 |
| QA-15 | Audit log ghi đúng | Bất kỳ CRUD action | Audit log có đúng: `action`, `changed_fields` (diff format), `changed_by` | P0 |
| QA-16 | Partial unique index SKU-NM | Tạo 2 mapping `sku_nm_mapping` với cùng `sku_id`, cả 2 `active=true` | 409 conflict — partial unique index block | P0 |
| QA-17 | Update NM lead_time_days | PATCH supplier với `lead_time_days` thay đổi | Audit log có diff: `{leadTimeDays: [old_value, new_value]}` | P1 |
| QA-18 | Feature flag off → endpoint trả 503 | Disable flag `m00_master_data_enabled`, gọi bất kỳ endpoint | 503 Service Unavailable (không phải 404) | P0 |
| QA-19 | POST lt-override không có reason | `POST /supplier/:id/lt-override` thiếu field `reason` | 400 `MD_LT_OVERRIDE_REASON` | P1 |
| QA-20 | M28 autoUpdateLt delta 35% lần 1-2 | Trigger `autoUpdateLt` với delta 35%, thực hiện lần 1 và 2 | Alert WARNING gửi, lead_time KHÔNG thay đổi | P1 |

---

## Import Tests (QA-21 → QA-25)

| # | Test | Input | Expected | Priority |
|---|------|-------|----------|----------|
| QA-21 | M28 autoUpdateLt delta 35% lần 3 | Trigger `autoUpdateLt` với delta 35%, lần thứ 3 liên tiếp | Force update lead_time + alert INFO + audit log ghi | P1 |
| QA-22 | Import CSV atomic — fail row 50 | `dryRun=false`, 100 rows valid về validation, row 50 fail ở DB layer (FK violation) | 0 rows committed (rollback toàn bộ), response có error message | P0 |
| QA-23 | POST change-nm không có reason | `POST /sku/:id/change-nm` thiếu field `reason` | 400 validation error | P1 |
| QA-24 | 2 SKU cùng variant_code khác sku_id | POST 2 variant với cùng `variant_code` nhưng `sku_id` khác nhau | 201 thành công — constraint cho phép (C2 fix: unique chỉ trên `(sku_id, variant_code)`) | P0 |
| QA-25 | 2 variant cùng (sku_id, variant_code) | POST 2 variant với cùng `sku_id` và cùng `variant_code` | 409 `MD_VARIANT_CODE_DUP` (C2 composite unique) | P0 |

---

## BA-added Tests (QA-26 → QA-35)

> Các test case này được thêm từ BA review session BLOCK-2. Một số case yêu cầu fix cụ thể (ghi chú trong cột Expected).

| # | Test | Input | Expected | Priority |
|---|------|-------|----------|----------|
| QA-26 | Import SKU không có cột `nm_id` | CSV import entity type `SKU`, header không có cột `nm_id` | 400 — validation phase catch missing required column trước khi hit DB | P0 |
| QA-27 | Import SKU với `nm_id` là NM `active=false` | CSV row có `nm_id` trỏ đến supplier tồn tại nhưng `active=false` | Row-level error: `MD_NM_INACTIVE` — row không được insert, các row khác tiếp tục validate | P0 |
| QA-28 | Tạo 2 `customer_cn` is_primary=true cùng customer | POST 2 customer_cn records: cùng `customer_id`, cả 2 `is_primary=true` | 409 conflict — sau khi NTH-1 fix được apply (unique partial index trên `is_primary=true`) | P1 |
| QA-29 | PATCH SKU đã soft-delete | PATCH `/sku/:id` với `id` là SKU đang `active=false` | 404 Not Found — deactivated entity không cho sửa | P0 |
| QA-30 | GET sku?activeOnly=false | `GET /sku?activeOnly=false` trên DB có cả active và deactivated SKU | Trả về TẤT CẢ SKU (kể cả deactivated); pagination count đúng (total = active + deactivated) | P1 |
| QA-31 | GET /quality khi chưa có supply snapshot | Gọi `GET /master-data/quality` trên DB chưa có dữ liệu supply snapshot (M28 chưa chạy) | Metric `coverage_rate` = total active SKU count (hoặc N/A), không throw 500 | P1 |
| QA-32 | Feature flag false — service inject vẫn hoạt động | Disable `m00_master_data_enabled`; gọi HTTP endpoint; đồng thời gọi internal service method trực tiếp (không qua HTTP) | HTTP endpoint: 403 Forbidden; Internal service inject: hoạt động bình thường (flag chỉ guard controller) | P1 |
| QA-33 | Import 500 rows có 2 rows trùng sku_code | CSV 500 rows, rows 10 và 250 có cùng `sku_code` | Validation phase (Phase 1) catch duplicate trong batch — không hit DB; response có error cả 2 dòng | P0 |
| QA-34 | PATCH change-nm với NM mới = NM cũ | `POST /sku/:id/change-nm` với `new_nm_id` = NM hiện tại của SKU | 200 OK (no-op); audit log ghi action `NOOP` với note rõ lý do | P2 |
| QA-35 | Migration M00 khi transport_lane chưa tồn tại | Chạy migration `20260417_m00_create_master_data_tables.up.sql` trên DB chưa có bảng `transport_lane` | Migration `RAISE EXCEPTION` ngay ở precondition check; toàn bộ transaction rollback clean, không có table nào được tạo | P0 |

---

## Traceability Matrix

| QA Range | Nguồn | Spec Section |
|----------|-------|-------------|
| QA-1 → QA-25 | DoD spec v1.2 (R6 fix: 18→25) | §15 DoD |
| QA-26 | BA review — import validation | §6.4, §6.4.1 |
| QA-27 | BA review — inactive NM guard | §6.2, §0 (soft delete rule) |
| QA-28 | BA review — NTH-1 fix (is_primary unique) | §3 (customer_cn table) |
| QA-29 | BA review — soft-delete PATCH guard | §0 (soft delete rule) |
| QA-30 | BA review — activeOnly=false pagination | §6.1, §5 API |
| QA-31 | BA review — /quality resilience no M28 data | §6.6, §10 |
| QA-32 | BA review — feature flag scope (controller only) | §4 FeatureFlag, §11 |
| QA-33 | BA review — in-batch duplicate SKU code | §6.4 (Phase 1 validate) |
| QA-34 | BA review — change-nm no-op + audit NOOP | §6.3, §8 audit |
| QA-35 | BA review — migration precondition rollback | §3 (migration SQL) |

---

## Definition of Done — QA Gate

- [ ] QA-1 → QA-25: tất cả pass trước khi merge to `main`
- [ ] QA-26 → QA-35 (BA-added): pass trước Sprint Review
- [ ] QA-28 blocked cho đến khi NTH-1 fix được merge
- [ ] QA-32 cần confirm với BE3: feature flag guard chỉ ở controller layer, không wrap service
