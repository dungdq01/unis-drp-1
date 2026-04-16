supplier table hiện tại dùng supplier_code VARCHAR làm PK.
Spec M00 yêu cầu id BIGINT BIGSERIAL.
Resolution Sprint 1: sku_nm_mapping.nm_id sẽ join với supplier.id nếu tồn tại,
hoặc join với supplier.supplier_code nếu chưa migrate.
BE3 cần handle cả 2 case khi build SkuNmMapping service.
DA1 phải plan migration supplier PK trước Sprint 2.

--- TECHNICAL NOTES (DA1 added 2026-04-16) ---

Hệ quả:
- sku_nm_mapping.nm_id (BIGINT) KHÔNG có FK constraint tới supplier vì supplier không có cột id.
- hub_nm_assignment.nm_id (BIGINT) tương tự, KHÔNG có FK constraint.
- Các bảng trên đã được tạo với nm_id BIGINT NOT NULL nhưng thiếu REFERENCES supplier(id).

Khi nào resolve:
- Sprint 2: DA1 thêm cột id BIGSERIAL vào supplier (backfill), sau đó thêm FK constraint vào sku_nm_mapping và hub_nm_assignment.
- Trước Sprint 2: BE3 phải query supplier bằng supplier_code, sau đó map thủ công ra nm_id (nếu cần).

Deviation phát sinh do:
- supplier table được tạo bởi migration M1-M7 cũ dùng supplier_code VARCHAR làm PK.
- M00 spec thiết kế supplier với id BIGSERIAL nhưng rollback không thể thay đổi PK bảng đang có data.
