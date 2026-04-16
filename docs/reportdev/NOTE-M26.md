m2 — supply_snapshot.nm_code có tồn tại không?
Verdict: BUG THẬT — nhưng severity LOW, không block staging.

Đã verify migration V002_m21_supply_snapshot_extend.up.sql line 16:


ALTER TABLE supply_snapshot
  ADD COLUMN IF NOT EXISTS nm_code VARCHAR(30) NULL,
→ nm_code có tồn tại trong schema thật — M21 migration đã ADD column này.

Tuy nhiên, có một vấn đề khác trong query _preloadAtpQtys():


JOIN supply_snapshot ss ON ss.nm_code = s.supplier_code
AND ss.captured_at = (
  SELECT MAX(captured_at) FROM supply_snapshot ss2
  WHERE ss2.nm_code = s.supplier_code AND ss2.status = 'FROZEN'
)
Vấn đề: migration V002 thêm nm_code nhưng không có column status trên supply_snapshot. Xem lại migration — không thấy status VARCHAR được ADD. Column source có (NM_UPLOAD/LEGACY/...) nhưng không phải status. Filter ss2.status = 'FROZEN' sẽ fail với column "status" does not exist.

Action cần làm: BE2 verify supply_snapshot có column status không. Nếu không có thì đổi filter thành ss2.source = 'NM_UPLOAD' hoặc bỏ status filter và chỉ lấy MAX(captured_at) không điều kiện. Cần clarify trước khi deploy staging.

