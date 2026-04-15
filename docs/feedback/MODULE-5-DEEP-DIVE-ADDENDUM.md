# Module 5 Deep Dive Addendum

## Purpose
Tài liệu này bổ sung cho:
- `MODULE-5-FEEDBACK.md`
- `M3-M4-M5-BASELINE-DRIFT.md`

Mục tiêu ở đây là **đi sâu hơn vào bản thân Module 5**, ngoài chuyện baseline drift, để tìm các vấn đề về:
- output fidelity
- run semantics
- API/schema drift
- downstream readiness cho Step 6

Tài liệu này **không lặp lại toàn bộ findings cũ**. Nó tập trung vào những điểm mới phát hiện khi audit kỹ service, DTO, entity, migration, FE client, và UI page.

## Executive Summary
Module 5 hiện không chỉ có vấn đề về upstream baseline.
Nó còn có một vấn đề nội tại quan trọng hơn:

**Engine có thể ra quyết định allocation nhiều nguồn, nhưng data model/output hiện tại không biểu diễn trung thực được quyết định đó.**

Hệ quả là:
- kết quả xem trên UI có thể chỉ phản ánh một phần của allocation logic
- Step 6 Transport khó dùng output này như một shipment plan đáng tin cậy
- một số API/state/schema của M5 đang lệch nhau đáng kể

## Additional Findings

### 1. `allocation_result` không biểu diễn được multi-source allocation thực tế
Trong `_allocate()`:
- engine có thể lấy hàng theo waterfall qua nhiều RTM priorities
- `remaining` giảm dần qua nhiều source
- `totalAllocated` là tổng qua tất cả source đã dùng

Nhưng `Decision` chỉ giữ:
- `sourceLocationCode`
- `sourcePriority`

và cả hai chỉ lấy từ **source đầu tiên** (`primarySource`, `primaryPriority`).

`_bulkInsert()` sau đó chỉ insert **1 row / demand line** vào `allocation_result`.

Hệ quả:
- nếu demand line được split giữa P1 và P2, DB chỉ lưu 1 source đầu tiên
- UI results không biết phần còn lại đến từ nguồn nào
- downstream Step 6 không thể dựng chính xác lane/vehicle plan từ output hiện tại

Đây là issue nghiêm trọng nhất bên trong M5.

### 2. Output đang mất hoàn toàn lot-level fidelity dù source data là `lot_attribute`
Supply loader aggregate `lot_attribute` thành:
- `item_code × location_code`
- quantity tổng

Không còn lot granularity trong engine.
Sau đó `allocation_result.lot_number` luôn được insert là `'LOT_ATTR'`.

Hệ quả:
- field `lot_number` chỉ là placeholder, không có giá trị nghiệp vụ thực
- Step 5 thực tế đang allocate theo source aggregate, không phải per lot
- bất kỳ downstream nào tưởng có lot-level detail sẽ bị hiểu sai

Nếu business thật sự chỉ cần aggregated source-level allocation thì field này nên đổi semantics. Nếu cần per-lot planning thì runtime hiện chưa đạt.

### 3. `FAILED` đang bị dùng sai nghĩa: business failure bị trộn với system failure
Sau khi engine chạy xong, `runStatus` được set như sau:
- `COMPLETED` nếu không có partial/unallocated
- `FAILED` nếu `totalAllocated === 0 && totalPartial === 0`
- `PARTIAL` cho còn lại

Điều này có nghĩa:
- một run có thể chạy thành công về mặt kỹ thuật
- có insert results đầy đủ
- nhưng vì toàn bộ lines bị `UNALLOCATED`, run vẫn bị mark `FAILED`

Trong khi `FAILED` ở lifecycle bình thường nên ám chỉ:
- engine crash
- query fail
- DB error
- exception runtime

Hệ quả:
- planner và FE khó phân biệt “engine hỏng” với “network không đủ stock/không có RTM rule”
- `FAILED` trở thành status mơ hồ
- các workflow downstream có thể xử lý sai run đã hoàn thành nhưng kết quả xấu

Đây là issue semantic rất lớn.

### 4. API summary contract đang lệch giữa backend và frontend type
Backend `getSummary()` trả về shape:
- `run`
- `byClass`
- `bySource`

Nhưng frontend client `fetchAllocationSummary()` lại khai báo type:
- `runId`
- `fillRateOverall`
- `fillRateByClass`
- `topSources`

Đây là contract mismatch rõ ràng.

Hiện tại FE page chưa dùng endpoint này nên bug chưa nổ. Nhưng nếu bắt đầu dùng summary API đúng theo type hiện tại, UI sẽ break hoặc parse sai.

Đây là latent integration bug trong chính M5.

### 5. `RetryAllocationDto` tồn tại nhưng không có endpoint/runtime tương ứng
DTO có `RetryAllocationDto` với:
- `plannedOrderReleaseIds`
- `reason`

Spec Module 5 cũng mô tả `POST /allocation/run/{run_id}/retry`.

Nhưng controller hiện không có route retry.
Service cũng không có logic retry selective line.

Hệ quả:
- API contract/documentation đang hứa hẹn một capability mà runtime không có
- dev/frontend dễ hiểu nhầm là feature đã sẵn sàng

Đây là issue completeness / contract drift.

### 6. `supplySnapshotId` vẫn là dead input ở API level
`CreateAllocationRunDto` còn giữ `supplySnapshotId`.
Nhưng service `createRun()` hoàn toàn không dùng field này.
FE cũng không cho user nhập field này.

Hệ quả:
- API surface đang rộng hơn actual behavior
- team có thể tưởng M5 hỗ trợ allocate theo snapshot override, nhưng không phải
- field này hiện là dead contract

### 7. Status model có nhiều trạng thái “chết” hoặc không bao giờ được emit
Có ít nhất 3 trạng thái đáng ngờ:

- `allocation_run.status` type/FE hỗ trợ `QUEUED`
- service không bao giờ set `QUEUED`, chỉ `RUNNING`, `COMPLETED`, `PARTIAL`, `FAILED`
- `allocation_recommendation.status` có `EXPIRED`
- service không bao giờ set `EXPIRED`
- spec/dev doc có nhiều ngữ nghĩa status phong phú hơn runtime thực tế

Hệ quả:
- status model trở nên khó tin cậy
- UI/polling/analytics có thể chuẩn bị cho state không bao giờ xảy ra
- sau này dev dễ thêm logic dựa trên các state “ảo” này và gây drift tiếp

### 8. LCNB recommendation workflow hiện chỉ đổi trạng thái recommendation, không làm thay đổi execution state nào
`decideRecommendation()` chỉ:
- đổi `status`
- ghi `decidedBy`, `decidedAt`, `note`
- optional chỉnh `suggestedQty`

Nó **không**:
- update `allocation_result`
- tạo transfer request
- tạo event/task cho Step 6/7
- trigger recompute sau buyer decision

Hệ quả:
- Accept recommendation gần như chỉ là thao tác ghi nhận thủ công
- không có link rõ giữa recommendation decision và execution downstream
- business user có thể tưởng “Accept” sẽ có tác động vận hành, nhưng runtime không làm gì thêm

Với Phase 1 DETECT_ONLY thì điều này có thể chấp nhận, nhưng phải được làm rất rõ trong UI/docs.

### 9. `allocation_recommendation` thiếu FK DB-level về `allocation_run`
Migration `003_add_recommendation.sql` tạo bảng `allocation_recommendation` với `allocation_run_id BIGINT NOT NULL`, nhưng không có `REFERENCES allocation_run(id)`.

Hệ quả:
- có thể tạo orphan recommendations nếu data bị lệch hoặc cleanup thủ công
- integrity của recommendation history yếu hơn allocation_result

Đây là issue DB integrity mức trung bình nhưng nên fix sớm.

### 10. Migration story của Module 5 đang drift khá mạnh, có rủi ro vận hành
Có ít nhất 2 migration tạo schema allocation khác nhau:
- `001_create_allocation_tables.sql`
- `002_recreate_clean.sql`

`001` có schema cũ:
- `total_orders`, `allocated_count`, `location_code`, `source_location`, `required_qty`, `allocated_qty`, ...

Trong khi runtime entity/service hiện dùng schema mới:
- `total_demand_lines`, `total_allocated`, `dest_location_code`, `source_location_code`, `qty_required`, `qty_allocated`, `config_snapshot`, `error_message`, ...

Nếu DA/chuyển giao chạy nhầm file cũ hoặc đọc sai migration order, backend hiện tại có thể không tương thích DB schema.

Dù `002` có `DROP TABLE` và recreate lại, việc tồn tại song song hai schema story như vậy là một operational risk thật sự.

### 11. Output naming đang đánh lừa downstream về mức độ chi tiết
Một số field gợi ý độ chính xác cao hơn thực tế:
- `lotNumber` gợi ý per-lot allocation, nhưng đang là placeholder
- `sourceLocationCode` gợi ý single-source truth, trong khi allocation có thể multi-source
- `sourcePriority` gợi ý route thực thi cuối cùng, nhưng thực ra chỉ phản ánh source đầu tiên

Hệ quả:
- consumer của `allocation_result` rất dễ hiểu nhầm output là shipment-ready
- càng nguy hiểm nếu Step 6 dùng trực tiếp bảng này để group route/cost/ETA

### 12. UI hiện chưa expose được lý do allocation một cách đủ sâu dù backend có `layerTrace`
Backend lưu `layerTrace` khá hữu ích.
Nhưng FE results table hiện chỉ show:
- item
- branch
- source
- required / allocated / fill / priority / status

Không có drill-down rõ cho:
- vì sao `UNALLOCATED`
- bị block ở RTM hay SS hay no stock
- có split nguồn hay không

Hệ quả:
- planner phải suy đoán nguyên nhân từ status tổng quát
- một điểm mạnh của backend trace hiện chưa được chuyển hóa thành UX giá trị

Đây không phải bug backend, nhưng là missed observability opportunity.

## Downstream Impact to Step 6
Finding số 1 và 2 có ảnh hưởng trực tiếp tới Module 6 Transport:

Nếu Step 6 cần lập chuyến theo:
- source → dest
- item
- qty
- lane
- vehicle grouping

thì output Step 5 hiện chưa đủ mạnh vì:
- mất split-by-source detail khi demand line lấy từ nhiều nơi
- mất lot detail hoàn toàn
- recommendation acceptance cũng không tạo execution artifact nào

Nói cách khác:

**`allocation_result` hiện giống một “line outcome summary” hơn là một “shipment-ready allocation manifest”.**

## Recommended Priorities

### P0
- Thay đổi data model để hỗ trợ **1 demand line → nhiều allocation legs**
- Không gói toàn bộ quyết định vào 1 row `allocation_result`
- Nếu cần, thêm bảng kiểu `allocation_leg` hoặc đổi hẳn result granularity

### P0
- Tách bạch `FAILED` (system failure) với `UNALLOCATED_ALL` / `COMPLETED_ZERO_FILL` (business outcome)

### P1
- Chuẩn hóa lại API contracts:
  - summary response shape
  - retry endpoint có thật hoặc bỏ khỏi docs/DTO
  - loại bỏ dead states / dead fields nếu chưa dùng

### P1
- Quyết định rõ output Step 5 là:
  - aggregated planning summary
  - hay shipment-ready manifest cho Step 6

### P1
- Nếu vẫn giữ `allocation_recommendation`, thêm FK integrity và làm rõ Accept/Reject có tác động gì downstream

### P2
- Nâng UI để show `layerTrace`/reason codes cho partial/unallocated lines
- Giúp planner debug nhanh hơn mà không phải đọc DB

## Final Conclusion
Sau vòng audit sâu hơn, có thể kết luận:

Module 5 hiện không chỉ drift với upstream baseline, mà còn có **output-model drift với chính allocation logic của nó**.

Cụ thể:
- engine có thể allocate đa nguồn
- nhưng persistence/UI lại chỉ biểu diễn như thể một line có một source duy nhất
- recommendation workflow có tồn tại nhưng chưa nối vào execution
- một số API/schema/status hiện vẫn ở trạng thái “nửa feature, nửa placeholder”

Vì vậy, trước khi xem M5 là đầu vào ổn định cho Step 6, team nên xác nhận lại một câu hỏi nền tảng:

**Step 5 đang muốn tạo “allocation decision summary” hay “transport-ready execution manifest”?**

Hiện tại nó nằm ở giữa hai trạng thái đó.
