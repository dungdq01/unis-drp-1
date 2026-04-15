# Module 6 Feedback — Deep Audit of M5 → M6 Handoff

## Scope
Tài liệu này audit sâu Module 6 (Transport Planning), tập trung vào:
- backend runtime (`transport.service`, controller, entities, migrations)
- frontend transport page
- spec/docs của Module 6
- handoff từ **Module 5 Allocation** sang **Module 6 Transport**
- ảnh hưởng downstream từ M6 sang Step 7 Orders

Mục tiêu là xác định:
- Module 6 consume gì thật sự từ M5
- runtime có khớp spec hay không
- có hidden logic gaps, contract mismatch, hoặc data fidelity loss nào không

## Executive Summary
Kết luận ngắn:

**Module 6 chạy được như một transport planning engine cơ bản, nhưng đang consume output từ Module 5 như thể đó là shipment-ready manifest, trong khi thực tế `allocation_result` chưa đủ fidelity cho execution-grade transport planning.**

Ngoài ra, runtime của M6 còn có drift khá rõ so với spec:
- spec mô tả logic `FLATBED → CRANE_TRUCK`
- spec mô tả manual trip override từ FE
- spec mô tả dữ liệu input/output giàu hơn (lot/spec fidelity)

Nhưng runtime hiện tại:
- chủ yếu build trip kiểu `FLATBED`
- FE chưa expose trip override thật sự
- `transport_trip_line` không mang lot/spec detail

Vì vậy, M6 hiện **usable ở mức planning demo / planning scaffold**, nhưng **chưa đủ chặt để làm transport execution bridge đáng tin cậy cho downstream modules**.

## Authoritative Runtime Flow
### M5 → M6 actual runtime chain
`TransportService.createPlan()` đang làm:

1. Validate `allocation_run` tồn tại và status phù hợp
2. Load `allocation_result` với status `ALLOCATED` / `PARTIAL`
3. Join/lookup item weight, lane, carrier, vehicle config
4. Group lines theo route `(source_location_code, dest_location_code)`
5. Bin-pack thành `transport_trip`
6. Persist:
   - `transport_plan`
   - `transport_trip`
   - `transport_trip_line`

Nghĩa là runtime M6 hiện đang dựa vào:
- `allocation_run`
- `allocation_result`
- `item.weight_per_unit_kg`
- `transport_lane`
- `carrier`
- `vehicle_type`

Trong đó phần handoff cốt lõi từ M5 sang M6 là:
- **`allocation_result` được xem như nguồn shipment lines để tạo trip lines**

## Findings

### 1. M6 đang consume `allocation_result` như shipment-ready manifest, nhưng M5 output chưa đủ fidelity
M6 group theo:
- `sourceLocationCode`
- `destLocationCode`
- item/allocated qty

Điều này chỉ đúng nếu `allocation_result` đã là manifest chính xác cho execution.

Nhưng từ audit M5 trước đó:
- `allocation_result` chỉ giữ **một source đại diện**
- trong khi allocation logic có thể split qua nhiều source
- fidelity về source-leg thực tế không được persist đầy đủ

Hệ quả:
- M6 route grouping có thể sai
- trip generation có thể gom line vào sai source route
- cost/ETA/carrier selection có thể dựa trên source không phản ánh thực tế execution

Đây là **P0 handoff defect** giữa M5 và M6.

### 2. M6 tiếp tục mất lot-level / variant-level fidelity
Spec M6 kỳ vọng input/output giàu hơn, ví dụ:
- lot-level detail
- SKU/spec/variant fidelity
- trip detail đủ để trace shipment chính xác

Nhưng runtime `transport_trip_line` chỉ giữ:
- `transportTripId`
- `allocationResultId`
- `itemCode`
- `allocatedQty`
- `weightKg`

Không có:
- lot
- variant/spec code
- source leg granularity
- planned-order level identity

Hệ quả:
- M6 tạo trip lines ở mức summary, không phải manifest execution-grade
- nếu kho/ERP cần lot-aware dispatch thì chain bị đứt ngay từ đây
- Step 7 chỉ còn có thể kéo theo `allocationResultId`, không đủ để tái lập detail đã mất

### 3. Runtime M6 không thật sự implement logic `FLATBED → CRANE_TRUCK` như spec mô tả
Spec và dev-implementation note của M6 mô tả:
- FFD bin-pack
- ưu tiên `FLATBED`
- có `CRANE_TRUCK` cho trường hợp phù hợp / phần còn lại

Nhưng runtime `_buildTrips()` hiện chủ yếu:
- khởi tạo `FLATBED`
- khi overflow thì mở trip mới cũng theo `FLATBED`
- không có nhánh auto-allocation rõ ràng sang `CRANE_TRUCK`

Hệ quả:
- engine thực tế nhỏ hơn spec
- `CRANE_TRUCK` tồn tại trong config/schema nhưng chưa là first-class runtime path
- acceptance logic theo spec có nguy cơ pass docs nhưng fail behavior thật

Đây là **logic drift quan trọng** của riêng Module 6.

### 4. `confirmPlan()` không chặn `NO_CARRIER`, tạo leak sang Step 7
Runtime M6 cho phép plan chuyển `DRAFT → CONFIRMED` mà không block khi còn trip `NO_CARRIER`.

Trong khi Step 7 runtime chỉ đọc `transport_trip.status = 'PLANNED'`.

Hệ quả:
- một transport plan có thể `CONFIRMED` nhưng chưa execution-ready toàn bộ
- Step 7 sẽ chỉ absorb phần `PLANNED`
- phần `NO_CARRIER` bị bỏ qua mà không fail hard

Đây là **P0 integration leak** M6→M7.

### 5. `NO_CARRIER` đang che phủ hai loại lỗi khác nhau
Runtime gán `NO_CARRIER` cho cả hai case:
- route chưa có lane
- có lane nhưng không có carrier phục vụ lane

Chỉ `exception_note` mới nói rõ nguyên nhân.

Hệ quả:
- business status bị mơ hồ
- UI/analytics khó tách vấn đề config lane với vấn đề carrier coverage
- planner phải đọc text note thay vì dùng state rõ ràng

Đây là semantic weakness ở status model.

### 6. M6 phụ thuộc mạnh vào master data ngoài M5 nhưng readiness contract chưa được làm rõ
M6 cần:
- `item.weight_per_unit_kg`
- lane setup
- carrier setup
- vehicle config

Nếu thiếu:
- createPlan có thể block vì weight = 0
- hoặc degrade thành `NO_CARRIER`

Hệ quả:
- `allocation_run COMPLETED` không có nghĩa Module 6 ready chạy
- readiness M5→M6 đang phụ thuộc cả vào data contract ngoài chain allocation
- nếu team chỉ nhìn status run của M5 sẽ đánh giá sai readiness của M6

Đây là **contract gap về prerequisites**.

### 7. FE chưa expose trip override/edit flow dù backend và spec đều có
Spec M6 và dev note nói có:
- manual carrier override
- trip edit flow

Backend có endpoint `PATCH /transport/trips/:id`.

Nhưng FE transport page hiện:
- không gọi `updateTrip()`
- không có UI edit carrier / departure date / override trip
- chủ yếu chỉ list plans/trips/lines

Hệ quả:
- feature backend có nhưng business user không dùng được từ UI
- planner không thể xử lý exception trực tiếp trên FE như spec hứa
- làm nặng thêm risk `NO_CARRIER` vì không có remediation path rõ ràng trên UI

Đây là **API/UI mismatch rõ ràng**.

### 8. Runtime status model của M6 lệch khá xa spec
Spec gốc mô tả plan/trip lifecycle giàu hơn.

Runtime hiện tại lại có:
- plan: `DRAFT`, `CONFIRMED`, `CANCELLED`
- trip: `PLANNED`, `NO_CARRIER`, `DISPATCHED`, `DELIVERED`

Trong khi spec/business prose ở vài chỗ kỳ vọng states như:
- `EXECUTING`, `COMPLETED`
- hoặc flow execution sâu hơn

Hệ quả:
- docs/runtime không đồng bộ
- downstream modules có thể build sai assumption nếu tin docs thay vì runtime

### 9. `transport_trip_line` là summary line, không phải shipment leg line
M6 hiện tạo line theo allocated result đã group/packed vào trip.

Nhưng vì input từ M5 đã summary-heavy, `transport_trip_line` cũng mang bản chất summary:
- không có serial/lot
- không có source split fidelity
- không có trace đủ sâu để audit physical move

Hệ quả:
- tên bảng là “trip line” nhưng semantics gần với “planned transport aggregate line” hơn
- cần nói rõ để tránh downstream hiểu nhầm đây là execution manifest

### 10. Runtime logic của M6 đang gắn chặt với assumption “consolidation OFF”, nhưng assumption này chưa được bảo vệ bằng invariant mạnh
Spec nói:
- consolidation OFF
- một allocation run → một transport plan

Runtime enforce một phần qua:
- `transport_plan.allocation_run_id` unique

Nhưng không có invariant business-level sâu hơn để giải thích:
- nếu run có nhiều route / nhiều exception / nhiều partially feasible legs thì plan vẫn được confirm thế nào
- plan completeness được đánh giá ra sao

Hệ quả:
- system chạy được nhưng chưa encode rõ định nghĩa “plan complete / ready for execution”
- điều này lộ ra rõ nhất khi plan có cả `PLANNED` lẫn `NO_CARRIER`

### 11. M6 hiện là planning engine, chưa phải execution-safe transport layer
Nếu nhìn theo runtime object và validations, M6 hiện làm tốt ở các việc:
- grouping route
- tính weight
- chọn carrier tốt nhất nếu data đủ
- estimate cost/ETA
- tạo trip lines để review

Nhưng M6 chưa bảo đảm tốt các thứ execution-safe như:
- all trips carrier-covered before confirm
- lot/spec fidelity cho dispatch
- UI remediation cho exception trips
- invariant rõ ràng trước khi handoff sang orders

Nói cách khác, M6 hiện gần với:

**Transport Planning Draft Generator**

hơn là:

**Transport Execution-Ready Bridge**

## What M6 Actually Is Today
Runtime hiện tại thực chất là:
- nhận `allocation_result`
- group theo route
- estimate tải xe / carrier / cost / ETA
- tạo plan + trip + trip lines để review
- cho confirm plan

Nhưng confirm ở đây **không đồng nghĩa hoàn toàn execution-ready**, vì:
- có thể còn `NO_CARRIER`
- có thể thiếu fidelity về source split / lot detail
- có thể thiếu UI path để override exception

## Downstream Impact
### To Module 7 Orders
- Step 7 chỉ đọc `PLANNED` trips
- plan confirmed nhưng chưa full-covered có thể bị absorb một phần
- execution batch có nguy cơ thiếu hàng mà không fail cứng

### To business process
- planner có thể tin rằng confirmed plan là đủ để generate orders toàn bộ
- thực tế system chỉ move được phần “healthy” của plan

### To audit/traceability
- mất source-leg fidelity từ M5
- mất lot/spec fidelity ở M6
- downstream khó audit shipment thật sự

## Priority Recommendations
### P0
- Không cho `confirmPlan()` thành công nếu còn bất kỳ trip `NO_CARRIER`
- Hoặc ít nhất phải có explicit partial-confirm semantics riêng

### P0
- Chốt lại contract M5→M6:
  - nếu M6 cần shipment-ready input, M5 phải emit source legs thực sự
  - nếu M5 chỉ emit allocation summary, M6 phải được document là planning-only layer

### P1
- Đồng bộ runtime với spec về vehicle logic:
  - hoặc implement `CRANE_TRUCK` path thật
  - hoặc sửa docs cho đúng runtime

### P1
- Expose trip override flow trên FE để planner có remediation path

### P1
- Tách rõ statuses cho:
  - thiếu lane
  - thiếu carrier

### P1
- Làm rõ readiness contract:
  - `allocation_run COMPLETED` chưa chắc `transport-ready`
  - cần master-data completeness check riêng cho M6

### P2
- Nếu Step 7/ERP cần lot-aware execution, phải nâng `transport_trip_line` data model để giữ được lot/spec fidelity

## Final Conclusion
Module 6 hiện **có thể tạo transport plan hợp lý ở mức planning**, nhưng **chưa đủ chặt để được xem là execution-grade transport bridge**.

Vấn đề gốc không chỉ là thiếu vài field hay vài nút UI.
Vấn đề gốc là:
- M6 đang consume `allocation_result` như thể M5 đã output shipment-ready detail
- trong khi thực tế output đó còn bị summary hóa và mất fidelity
- rồi lại cho phép `CONFIRMED` plan đi tiếp dù còn exception trips

Do đó, nếu team coi runtime hiện tại là **Phase 1 planning layer**, thì docs cần nói rõ như vậy.
Nếu không, thì đây là một **integration and domain-model drift đáng kể** giữa M5, M6 và M7.
