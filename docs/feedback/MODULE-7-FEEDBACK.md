# Module 7 Feedback — Deep Audit of M6 → M7 Handoff

## Scope
Tài liệu này audit sâu chain:
- **Module 6**: `transport_plan` / `transport_trip` / `transport_trip_line`
- **Module 7**: `order_batch` / `order_line`

Mục tiêu là xác định:
- M7 đang consume gì thật sự từ M6
- runtime hiện có khớp spec Step 7 hay không
- có handoff leak nào từ M6 sang M7 làm sai execution semantics không

## Executive Summary
Kết luận ngắn:

**Runtime hiện tại của Module 7 không phải là “Execution Bridge” theo nghĩa BA spec, mà là một “batch generation + approval + CSV export tool”.**

Điểm nghiêm trọng nhất không nằm ở syntax/API nhỏ, mà ở chỗ:

- Spec Step 7 kỳ vọng **order-level approval** theo từng chuyến / từng CN
- Runtime hiện tại lại tạo **1 `order_batch` cho toàn bộ `transport_plan`**
- rồi approve/reject ở **batch level**, không phải order level

Hệ quả là handoff từ M6 sang M7 đang bị đổi nghĩa:

**`transport_trip` đáng lẽ là đơn vị nghiệp vụ để tạo draft order, nhưng runtime lại flatten toàn bộ trip lines thành một batch duy nhất.**

Điều này làm vỡ logic CN approval, reject/re-submit, partial exception handling, và khả năng downstream ERP/audit.

## Authoritative Runtime Flow
### M6 → M7 actual runtime chain
`OrderService.createBatch()` đang làm:

1. Check `transport_plan.status = 'CONFIRMED'`
2. Load `transport_trip_line` join `transport_trip`
3. Chỉ lấy `tt.status = 'PLANNED'`
4. Flatten tất cả lines thành `order_line`
5. Tạo **1** `order_batch` cho toàn bộ `transport_plan`

Nghĩa là M7 runtime hiện tại dựa vào:
- `transport_plan` (status gate)
- `transport_trip_line` (line source)
- `transport_trip` (route/carrier/date metadata)

nhưng **không tạo order header per trip**.

## Findings

### 1. `transport_trip` không còn là business object ở M7; nó bị flatten thành line source
Spec Step 7 mô tả:
- tạo draft orders từ transport trips
- mỗi order gắn với trip/route/destination cụ thể
- CN duyệt order của chi nhánh mình

Nhưng runtime hiện tại:
- `order_batch.transport_plan_id` là header duy nhất
- `order_line.transport_trip_id` chỉ là reference ở line
- không có entity/order header nào đại diện cho từng trip

Hệ quả:
- trip không còn là đơn vị approval
- chỉ còn batch header + nhiều order lines
- semantics “trip → draft order” bị collapse thành “plan → batch → lines”

Đây là **semantic mismatch lớn nhất** của M7.

### 2. Approval đang ở batch-level, không phải order-level hay CN-level như spec
Spec Step 7 kỳ vọng:
- CN duyệt đơn của chi nhánh mình
- có `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, re-submit loop
- branch-specific approval

Runtime hiện tại chỉ có batch statuses:
- `DRAFT`
- `SUBMITTED`
- `APPROVED`
- `EXPORTED`
- `CANCELLED`

Và action flow là:
- submit **batch**
- approve **batch**
- reject **batch**

Không có:
- CN approval theo branch
- per-order approval state
- multi-actor approval chain
- order-level reject/re-submit

Hệ quả:
- 1 batch có thể chứa nhiều destination branches, nhưng chỉ có 1 quyết định approve/reject chung
- nếu 1 CN có vấn đề, runtime không có chỗ represent chuyện “branch A reject, branch B approve”

Đây là **P0 business-model mismatch**.

### 3. Một `transport_plan` có thể chứa nhiều route/CN, nhưng M7 gộp hết vào 1 batch duy nhất
`order_batch.transport_plan_id` có UNIQUE constraint.
`createBatch()` generate đúng 1 batch / 1 plan.

Trong khi M6 `transport_plan` có thể chứa:
- nhiều `transport_trip`
- nhiều source→dest pairs
- nhiều CN nhận khác nhau

Hệ quả:
- M7 không thể xử lý approval hoặc exception theo từng trip/branch
- mọi thứ bị gom vào 1 container nghiệp vụ quá lớn
- reject hoặc cancel có xu hướng trở thành coarse-grained hơn business cần

### 4. M7 âm thầm bỏ toàn bộ trips `NO_CARRIER` từ M6 thay vì chặn handoff
`_loadTripLines()` chỉ lấy:
- `tt.status = 'PLANNED'`

Tức là nếu M6 có `transport_plan` đã `CONFIRMED` nhưng còn trips `NO_CARRIER`, M7 sẽ:
- vẫn tạo batch thành công
- chỉ lấy phần `PLANNED`
- bỏ phần `NO_CARRIER`

Không có hard-stop nào bảo đảm:
- confirmed plan phải execution-ready toàn bộ
- hoặc phải fail nếu còn route chưa assign carrier

Hệ quả:
- handoff M6→M7 là **partial by omission**
- data loss xảy ra dưới dạng “không tạo line”, không phải error rõ ràng
- user có thể tưởng cả plan đã đi vào execution, nhưng thực ra chỉ một phần

Đây là **P0 integration leak**.

### 5. Runtime không hỗ trợ FR29: CN giảm qty trước duyệt
Spec Step 7 yêu cầu rõ:
- `qty_original`
- `qty_adjusted`
- CN chỉ được giảm, không được tăng
- reason bắt buộc
- adjustment log bắt buộc

Runtime hiện tại:
- `order_line` chỉ có 1 field `qty`
- `UpdateOrderLineDto` không cho sửa qty
- `updateLine()` chỉ hỗ trợ:
  - `unitPriceVnd`
  - `erpRef`
  - `note`
  - `status`

Hệ quả:
- workflow quan trọng nhất của Step 7 BA chưa tồn tại
- CN approval semantics không thể thực hiện được trên runtime hiện hành
- M7 hiện chưa phải execution bridge theo business meaning

### 6. Không có `qty_original`, `qty_adjusted`, `adjust_reason`, `adjusted_by`, `adjusted_at`
Migration order tables cũng ghi rõ phần này để Phase 2.

Nhưng vì thiếu các field này, runtime không thể:
- track chỉnh sửa qty
- audit ai sửa, sửa khi nào, vì sao
- support re-approval after change
- tính đúng override metrics cho Step 8

Thực tế `monitor.service.ts` cũng xác nhận điều này bằng note:
- override_rate đang dùng proxy `cancel_rate`
- true override_rate cần `qty_original` ở Phase 2

Hệ quả:
- M7 không chỉ thiếu UI; nó thiếu cả **data model nền tảng** để thực hiện workflow spec

### 7. `AdjustmentReport` và `approval log` trong spec hoàn toàn không tồn tại trong runtime
Spec yêu cầu:
- approval history timeline
- adjustment report first-class object
- reject/re-submit audit

Runtime hiện tại không có:
- bảng adjustment report
- bảng approval log
- event log nội bộ cho order lifecycle

Hệ quả:
- không có audit trail đúng nghĩa cho quyết định execution
- khó support Step 8 monitor đúng theo spec sau này
- mất traceability khi order bị thay đổi hoặc bị từ chối

### 8. Step 7 spec nói auto-create + auto-submit pending approval, runtime thì manual create batch
Spec event flow mô tả:
- Step 6 confirm plan
- create draft orders
- auto-submit → pending approval

Runtime hiện tại:
- user vào `/execution`
- chọn `Transport Plan (CONFIRMED)` từ dropdown
- bấm `Generate Batch`
- batch tạo ra ở trạng thái `DRAFT`
- rồi user lại bấm `Submit for Approval`

Hệ quả:
- event-driven handoff Step 6→7 chưa tồn tại
- runtime đang là manual operations console, không phải bridge tự động như BA mô tả

Đây là **process drift**, không nhất thiết là bug nếu team cố ý phase-down, nhưng phải được ghi rõ.

### 9. FE execution page load tất cả `CONFIRMED` plans, không lọc “eligible plans chưa có batch”
FE execution page gọi `fetchTransportPlans()` rồi filter `status === 'CONFIRMED'`.

Nó **không** filter thêm:
- plan chưa có `order_batch`

Trong khi backend `createBatch()` có duplicate check và `order_batch.transport_plan_id` là UNIQUE.

Hệ quả:
- dropdown vẫn có thể cho chọn plan đã có batch
- user bấm generate rồi nhận 409 duplicate
- UX chưa clean và không phản ánh đúng eligible state

Đây là M6→M7 FE contract gap.

### 10. `createBatch()` không có transaction boundary, có risk orphan batch + blocked retry
`createBatch()` hiện làm tuần tự:
- generate batch code
- save batch header
- bulk save lines theo chunks
- update totals

Nhưng không thấy:
- transaction
- rollback nếu save line fail giữa chừng

Hệ quả xấu nhất:
- batch header đã được tạo
- một phần line insert fail
- plan bị khóa bởi UNIQUE `transport_plan_id`
- retry createBatch sẽ bị duplicate conflict

Tức là một lỗi giữa chừng có thể để lại **partial persistent state** và chặn recovery đơn giản.

Đây là **operational integrity risk** mức cao.

### 11. `cancelBatch()` không cascade semantic xuống lines
Khi cancel batch:
- batch.status → `CANCELLED`
- lines không tự đổi trạng thái

Hệ quả:
- batch có thể `CANCELLED` nhưng lines vẫn `ACTIVE`
- semantics dữ liệu trở nên lẫn lộn
- các consumer downstream phải tự suy luận rằng line active trong cancelled batch thực ra không còn hiệu lực

### 12. `erpRef` có thể bị sửa ở mọi giai đoạn, không bị guard theo status
FE cho phép inline edit `erpRef` trên lines.
Backend `updateLine()` cũng không guard `erpRef` theo batch status.

Hệ quả:
- có thể ghi ERP ref trước cả khi export hoặc approve
- lifecycle của ERP synchronization không được bảo vệ chặt
- field `erp_ref` hiện giống free-form metadata hơn là posting outcome được kiểm soát

### 13. M7 tiếp tục mất lot/variant fidelity từ M6/M5
Spec Step 7 kỳ vọng order line có:
- `lot_id`
- `specs_id`
- variant info

Runtime `order_line` chỉ lưu:
- `itemCode`
- `qty`
- `transportTripId`
- `allocationResultId`

Không có:
- lot
- variant/spec code
- qty_original vs adjusted

Do M6 đã mất lot detail trước đó, M7 cũng không thể khôi phục.

Hệ quả:
- execution layer không có đủ detail nếu ERP/kho cần lot-aware dispatch
- traceability M5→M6→M7 tiếp tục bị suy giảm

### 14. UI/runtime role semantics lệch BA
Spec nói:
- CN_WH duyệt
- SC Manager duyệt lần 2
- planner re-submit

Runtime FE hiện hardcode chủ yếu các actor string kiểu:
- `planner`
- `manager`

Không có:
- branch-specific CN view
- filter theo `dest_location_code`
- phân quyền/role-aware actions ở UI
- order inbox cho từng chi nhánh

Hệ quả:
- UI phản ánh workflow nội bộ đơn giản hóa, không phản ánh execution governance thật của business

## What M7 Actually Is Today
Runtime hiện tại thực chất là:

- chọn 1 `transport_plan CONFIRMED`
- flatten tất cả `PLANNED transport_trip_line`
- tạo 1 `order_batch`
- duyệt batch ở 1 cấp đơn giản
- export CSV thủ công
- ghi `erpRef` thủ công

Tức là nó giống một:

**Batch Export Console for Transfer Orders**

hơn là một:

**Execution Bridge with branch approval workflow**

## Downstream Impact
### To business process
- CN approval workflow không tồn tại như spec
- reject/re-submit chỉ có ở batch level
- không có adjustment trail

### To data/audit
- không lưu được original vs adjusted qty
- không có approval timeline đúng nghĩa
- không có order-level state machine

### To M6→M7 handoff quality
- M6 confirmed plan không đồng nghĩa M7 execution-ready toàn bộ
- trips `NO_CARRIER` có thể bị rơi khỏi M7 silently
- trip-level object bị flatten mất semantics

### To Step 8 monitor
- monitor không thể đo đúng override/edit behavior
- chỉ có proxy metrics thay vì true execution adjustment metrics

## Priority Recommendations
### P0
- Chặn `createBatch()` nếu transport plan còn bất kỳ trip `NO_CARRIER`
- Không cho M7 absorb partial plan silently

### P0
- Quyết định lại domain model Step 7:
  - nếu business cần approval theo trip/CN, phải có **order header per trip/destination**
  - không thể chỉ dùng 1 batch header cho cả plan

### P0
- Bọc `createBatch()` trong transaction để tránh orphan batch/partial line insert

### P1
- Tạo eligible endpoint cho M7 create form:
  - `CONFIRMED transport plans` chưa có batch
  - ideally chỉ plans execution-ready

### P1
- Nếu giữ Phase 1 đơn giản hóa, phải update docs/spec rõ:
  - chưa có CN approval thật
  - chưa có qty adjustment
  - chưa có order-level workflow
  - chưa có adjustment log

### P1
- Tách rõ two levels:
  - `order_batch` = export container
  - `execution_order` / `draft_order` = approval object

### P2
- Guard `erpRef` theo lifecycle status
- Đồng bộ batch cancel semantics xuống lines hoặc document rõ invariants

## Final Conclusion
Module 7 hiện đang **consume được dữ liệu từ M6**, nhưng **consume theo một abstraction đã bị đơn giản hóa quá mạnh**.

Vấn đề không chỉ là thiếu vài endpoint hay vài field.
Vấn đề gốc là:

- Spec Step 7 được thiết kế quanh **order-level execution workflow**
- Runtime hiện tại lại được dựng quanh **batch-level export workflow**

Do đó, handoff M6→M7 hiện tại:
- chạy được về mặt kỹ thuật
- nhưng chưa đại diện đúng quy trình execution mà tài liệu nghiệp vụ mô tả

Nếu team xem runtime hiện tại là Phase 1 tối giản, cần nói rõ điều đó trong docs.
Nếu không, thì đây là một **domain-model drift nghiêm trọng** giữa Step 6 và Step 7.
