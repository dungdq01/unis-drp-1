# Module 5 Feedback — Allocation Engine

## Scope
Review Module 5 tập trung vào câu hỏi: **Allocation đang tiêu thụ sai gì từ Module 4 và Module 3**.

Phạm vi review gồm:
- backend `backend/src/allocation/*`
- frontend `frontend/app/allocation/*`, `frontend/lib/api/allocation.ts`
- BA spec `docs/05-allocation-engine.md`
- dev doc `docs/report-module5/MODULE-5-FULL-IMPLEMENT.md`
- đối chiếu call-sites và contract từ:
  - Module 4 DRP (`planned_order_release`, `plan_run`)
  - Module 3 Policy (`rtm_rule`, `safety_stock_target`, `item_abc_classification`, `policy_run`)

## Overall Assessment
Module 5 đã có skeleton backend/frontend khá đầy đủ:
- có `allocation_run`
- có engine waterfall RTM → SS guard → LCNB detect
- có run history, results, recommendations UI
- có output cho Module 6

Nhưng nếu nhìn từ góc độ integration, Module 5 hiện đang **consume input từ M4/M3 theo cách chưa ổn định baseline**.

Vấn đề cốt lõi không nằm ở việc code không chạy, mà nằm ở chỗ:
- Allocation không thực sự bám theo đúng baseline của DRP run
- Allocation không bind chặt vào policy baseline của Step 3
- một số contract M4→M5 trong docs đã đúng, nhưng runtime code vẫn đang lệch

Nói ngắn gọn: **Module 5 đang allocate trên dữ liệu “current/live/current-active”, thay vì allocate trên dữ liệu “the exact baseline that produced this DRP plan”.**

## Key Findings

### 1. Allocation runtime đang consume sai status từ Module 4: lấy cả `NEEDS_APPROVAL`
Runtime code ở `allocation.service.ts` load demand lines bằng query:
- `status IN ('AUTO_RELEASE', 'RELEASED', 'NEEDS_APPROVAL')`

Trong khi:
- spec Module 4 nói Allocation chỉ nên nhận planned orders đã releasable
- dev doc Module 5 cũng ghi `status IN ('AUTO_RELEASE', 'RELEASED')`

Hệ quả:
- planned orders còn nằm trong frozen zone, chưa được planner approve, vẫn có thể bị Allocation lấy xuống
- boundary approval của Module 4 bị xuyên thủng
- Step 5 có thể downstream hóa những order lẽ ra còn chờ quyết định planner

Đây là mismatch nghiêm trọng nhất của contract M4 → M5.

### 2. Allocation không bind vào `supply_snapshot_id` của DRP run, dù DTO và config giả vờ có hỗ trợ
`CreateAllocationRunDto` có `supplySnapshotId`.
Dev doc Module 5 cũng mô tả:
- default lấy `supply_snapshot_id` từ `plan_run`
- có thể override bằng `supplySnapshotId`

Nhưng runtime engine thực tế:
- không dùng snapshot này để load supply
- `_loadSupplyMap()` đọc trực tiếp từ `lot_attribute` live
- không có snapshot filter nào

Tức là:
- `supplySnapshotId` chỉ được nhận và có thể lưu vào `configSnapshot`
- nhưng allocation logic không dùng nó

Hệ quả:
- Module 5 không allocate trên cùng supply baseline mà Module 4 dùng để tạo plan
- cùng một `plan_run` có thể cho kết quả allocation khác nhau theo thời điểm chạy, dù không đổi DRP output
- planner rất khó audit: “Allocation run này đã dùng đúng snapshot nào?”

Đây là issue P0 về reproducibility M4→M5.

### 3. Vì đọc `lot_attribute` live, Allocation có thể mâu thuẫn trực tiếp với DRP run vừa được duyệt
DRP Step 4 dựa trên:
- `supply_snapshot` frozen
- stale gate / stale acknowledgment

Nhưng Allocation Step 5 lại đọc:
- `lot_attribute` live runtime
- không check freeze state
- không check stale acknowledgment

Hệ quả:
- supply baseline giữa M4 và M5 bị drift ngay khi inventory live thay đổi
- một planned order hợp lệ ở thời điểm DRP run có thể bị đánh giá khác ở Allocation chỉ vì live lot thay đổi sau đó
- planner không biết đây là do planning drift hay do logic allocation

Đây là cross-step inconsistency rất lớn.

### 4. `plan_run.status = TIMEOUT` từ Module 4 không được Module 5 chấp nhận, dù dữ liệu có thể đã được save đầy đủ
Allocation `createRun()` chỉ cho chạy nếu `plan_run.status === 'COMPLETED'`.
Trong khi DRP hiện tại có behavior:
- vẫn chạy xong full batch
- rồi nếu lâu hơn 60s mới mark `TIMEOUT`

Tức là trong thực tế hiện tại, `TIMEOUT` ở M4 không hẳn đồng nghĩa “partial/incomplete data”.
Nhưng Module 5 lại block tuyệt đối.

Hệ quả:
- nếu DRP run bị mark `TIMEOUT` nhưng thực ra đã persist đủ results, Allocation vẫn không thể chạy
- contract status giữa M4 và M5 đang lệch semantics

Đây là issue P1 về workflow continuity.

### 5. Module 5 không consume đủ contract demand mà spec Step 5 yêu cầu từ Module 4
Spec Step 5 mô tả demand input từ DRP có các thuộc tính kiểu:
- need date
- priority / urgency
- variant / specs id

Nhưng `planned_order_release` runtime hiện Module 5 chỉ dùng:
- `item_code`
- `location_code`
- `planned_order_qty`
- `week_number`

Không có / không dùng:
- `specs_id`
- `need_date`
- priority từ DRP

Hệ quả:
- Layer 2 variant matching không thể chạy đúng như spec
- planner không có urgency semantics thực sự ngoài `week_number`
- Allocation chỉ đang consume một bản demand contract đã bị rút gọn mạnh so với BA design

Đây không phải bug đơn lẻ, mà là **contract thiếu trường** giữa M4 và M5.

### 6. Layer 2 Variant Match về thực tế đang bị tắt hoàn toàn vì contract M4/M2 không cung cấp đủ dữ liệu
Spec Module 5 coi variant matching là critical cho UNIS.
Nhưng implementation Phase 1 hiện:
- `lot_attribute` không có `specs_id`
- `planned_order_release` cũng không cung cấp `specs_id`
- config `variantMatchEnabled = false`
- trace ghi rõ `variant SKIPPED`

Hệ quả:
- Allocation không thể bảo đảm “đúng đuôi màu” như BA spec kỳ vọng
- đây là rủi ro business rất lớn nếu nghiệp vụ thật sự cần giữ same variant suffix

Về bản chất, Module 5 không consume được data contract variant từ cả upstream demand lẫn supply.

### 7. ABC từ Module 3 đang bị consume sai baseline: lấy `latest effective_date`, không bind với active policy hay plan run
`_loadDemands()` ở Allocation load ABC bằng query:
- `SELECT DISTINCT ON (item_code) ... FROM item_abc_classification ... ORDER BY effective_date DESC`

Nó **không**:
- join `policy_run`
- không bind với `ACTIVE` policy run
- không bind với `plan_run.demand_snapshot_id`

Điều này khác với `PolicyService.resolveRtm()` vốn ít nhất còn join `policy_run` theo active demand snapshot.

Hệ quả:
- Allocation có thể dùng ABC mới nhất trong bảng, dù DRP plan được sinh ra từ baseline policy khác
- fair-share/fill-rate by class có thể lệch khỏi M3 baseline thực sự
- same plan run, different day, same code => vẫn có thể ra class mapping khác nếu ABC import mới được ghi vào bảng

Đây là issue P0/P1 của M3 → M5.

### 8. ABC currently là item-level only, nhưng Allocation dùng nó như một policy priority driver cho từng demand line
`item_abc_classification` entity chỉ có:
- `item_code`
- `snapshot_id`
- `abc_class`
- không có `location_code`

Allocation apply class này cho demand line tại từng destination branch.
Điều này chỉ đúng nếu business chấp nhận ABC item-level toàn mạng.

Nếu Step 3 thực tế cần ABC gắn với context location/channel hoặc policy run cụ thể, thì Module 5 đang simplify quá mạnh.

Đây là rủi ro semantic, đặc biệt khi docs Step 5 mô tả fair-share theo nhu cầu branch-level.

### 9. Safety Stock guard từ Module 3 cũng không bind theo policy baseline của DRP run
`_loadSsMap()` query:
- `safety_stock_target`
- join `policy_run`
- lấy `pr.status = 'ACTIVE'`
- dùng `DISTINCT ON ... ORDER BY pr.created_at DESC`

Nó không bind với:
- policy baseline đã được DRP run sử dụng
- policy run nào gắn với lần planning này

Hệ quả:
- DRP có thể được tính bằng policy A
- Allocation SS guard lại dùng policy B nếu active policy vừa đổi
- cùng một order từ M4 có thể bị Allocation cắt/không cắt khác hoàn toàn

Đây là issue baseline drift cực kỳ rõ giữa M3 → M4 → M5.

### 10. Self-fulfillment đang bypass hoàn toàn Safety Stock guard
Runtime allocation code có logic:
- nếu `sourceLocationCode === destLocationCode` thì `ss = 0`
- tức là self-fulfillment không bị SS guard

Spec Allocation không mô tả rõ exception này như một business rule chính thức.
Nếu Option C self-sourcing là có thật, đây vẫn là quyết định nghiệp vụ lớn cần được nói rõ.

Hệ quả:
- branch tự cấp cho chính mình có thể bị consume xuống dưới SS target
- cùng một SS policy từ M3 được áp dụng khác nhau tùy route shape
- làm semantics “SS là ngưỡng bảo vệ location” không còn nhất quán

Đây là issue P1 trong cách Module 5 consume SS từ M3.

### 11. RTM từ Module 3 đang bị consume theo bản đơn giản nhất: chỉ `branch_code → warehouse_code`, bỏ qua item specificity
`_loadRtmMap()` load tất cả rules với:
- `branch_code`
- `warehouse_code`
- `priority`

Nó không dùng:
- `item_code` trong `rtm_rule` nếu tương lai có item-specific routing
- không dùng `transport_days`
- không dùng `transport_mode`

Hiện tại docs implement nói DB đang mostly `item_code = NULL`, nên code chạy được.
Nhưng contract-wise, Allocation đang hard-code RTM thành rule theo branch בלבד, không thật sự sẵn sàng cho item-specific routing của M3.

### 12. Channel isolation theo spec Step 5 hiện không được consume từ Module 3
Spec Step 5 có phần rất rõ về:
- channel isolation
- corporation isolation
- RTM per channel
- LCNB chỉ scan trong cùng channel

Nhưng implementation hiện tại:
- không có `channel_code` trong routing key
- không filter RTM theo channel
- không filter SS theo channel
- không filter supply/LCNB theo channel
- dev doc còn ghi thẳng `Channel isolation: OFF`

Hệ quả:
- nếu business thật sự vận hành multi-channel trên cùng network, Allocation có thể cross-use inventory/routing sai boundary
- đây là gap nghiêm trọng giữa Step 3 policy design và Step 5 execution

### 13. Layer 4 “ABC Fair-Share” trong spec chưa được implement đúng nghĩa, dù vẫn consume ABC class
Spec mô tả shortage allocation theo weighted fair-share:
- A: 2.0
- B: 1.5
- C: 1.0

Nhưng runtime hiện chỉ:
- ghi note `class=... mode=FCFS`
- fill-rate by class ở cuối run
- không có batch shortage redistribution theo weighted share

Tức là Module 5 đang **consume ABC chỉ để annotate và report**, chứ chưa consume nó như allocation policy thật.

Đây là mismatch lớn giữa M3 policy intent và M5 execution.

### 14. Dispatch limit từ config chỉ là warning, không phải constraint thực thi
Spec Step 5 nói dispatch limit là capacity guard.
Runtime hiện:
- chỉ ghi warning vào `layerTrace` nếu vượt `dispatchLimit`
- không block allocation

Dù đây không trực tiếp là M4/M3 contract, nó làm output của Module 5 ít đáng tin cậy hơn khi planner tưởng đã tôn trọng policy/capacity rules.

### 15. `supplySnapshotId` và `planRunId` xuất hiện ở API/DTO/UI nhưng FE không truyền cho user một mental model đúng
FE page allocation:
- list tất cả `planRuns`
- không filter trước theo `COMPLETED`
- user có thể chọn run `RUNNING`, `FAILED`, `TIMEOUT`
- đến lúc trigger thì backend mới từ chối

Ngoài ra FE không cho thấy Allocation sẽ:
- dùng live supply chứ không phải snapshot baseline
- không cho thấy policy baseline nào đang bị SS/ABC/RTM consume

Đây là UI contract gap, làm planner khó hiểu vì sao allocation result khác plan baseline.

### 16. `supplySnapshotId` trong DTO/backend hiện là dead parameter
DTO có `supplySnapshotId`, dev doc mô tả nó, config snapshot cũng lưu nó.
Nhưng actual engine không dùng parameter này vào bất kỳ loader nào.

Đây là dấu hiệu design drift:
- hệ thống “trông như” hỗ trợ allocate theo snapshot
- nhưng runtime thực ra không hỗ trợ

Về audit và debugging, dead parameter kiểu này rất nguy hiểm vì đánh lừa người dùng và dev team.

### 17. Allocation đang duplicate raw SQL policy lookup thay vì đi qua một abstraction/baseline chung
Module 5 tự query:
- ABC từ `item_abc_classification`
- SS từ `safety_stock_target + policy_run ACTIVE`
- RTM từ `rtm_rule`

Nó không dùng một policy baseline abstraction thống nhất.
Hệ quả:
- mỗi module tự định nghĩa “current policy” theo cách riêng
- M4 và M5 có thể cùng phụ thuộc Step 3 nhưng resolve data hơi khác nhau
- team rất dễ sinh drift giữa DRP, Allocation, và Policy UI

Đây là architectural smell ở giao điểm M3 với downstream modules.

## Cross-Module Risk Summary

### M4 → M5
- Allocation đang lấy cả `NEEDS_APPROVAL`, sai release contract
- Allocation không bind vào exact `supply_snapshot_id` của plan run
- Allocation chỉ consume demand contract rút gọn, thiếu `specs_id`, `need_date`, priority
- `TIMEOUT` run từ DRP có thể bị block dù dữ liệu thực tế vẫn usable

### M3 → M5
- SS đang lấy từ `ACTIVE` policy hiện tại, không bind với policy baseline mà DRP đã dùng
- ABC đang lấy theo latest effective date, còn lỏng hơn cả DRP/Policy resolve logic
- RTM hiện chỉ consume branch-level route đơn giản, chưa consume item/channel semantics
- ABC fair-share chưa thực thi đúng nghĩa dù có consume class

### M2 / live supply → M5
- Allocation dùng `lot_attribute` live thay vì snapshot baseline
- stale/frozen discipline của upstream không còn hiệu lực ở Step 5
- LCNB và allocation result vì vậy có thể drift mạnh theo thời điểm run

## What Works Well

### 1. Cấu trúc engine rõ, dễ trace
`allocation.service.ts` tổ chức theo các loader + `_allocate()` + bulk insert khá rõ ràng. `layerTrace` giúp debug được quyết định allocation.

### 2. SS guard và LCNB detect đã có khung thực thi
Dù baseline chưa ổn, Module 5 ít nhất đã có cơ chế:
- bảo vệ stock ở source
- detect lateral transfer recommendation
- report fill rate theo class

### 3. UI Module 5 đã usable ở mức vận hành cơ bản
Có:
- trigger run
- polling
- results table
- recommendation decision

Tức là module này không còn là placeholder.

## Recommendations for Dev Team

### Priority P0
- Sửa `_loadDemands()` để **chỉ** consume:
  - `AUTO_RELEASE`
  - `RELEASED`
- Không consume `NEEDS_APPROVAL`

### Priority P0
- Quyết định rõ Allocation có phải chạy trên **snapshot baseline** hay không
- Nếu có, `_loadSupplyMap()` phải bind theo snapshot hoặc một persisted supply baseline
- Nếu không, docs/UI phải nói rõ Step 5 chạy trên live inventory, không phải snapshot used by DRP

### Priority P0
- Lưu hoặc derive `policy_run_id` baseline cho `allocation_run`
- SS/ABC/RTM lookup phải bind với cùng baseline đó
- Không dùng “latest ACTIVE / latest effective” một cách ngầm định

### Priority P1
- Sửa ABC load để bind với active policy baseline hoặc demand snapshot baseline rõ ràng
- Tránh `DISTINCT ON item_code ORDER BY effective_date DESC` nếu không chứng minh được nó đại diện đúng policy hiện hành

### Priority P1
- Quyết định rõ rule self-fulfillment có bypass SS guard hay không
- Nếu có, phải ghi thành business rule chính thức trong spec/docs/UI

### Priority P1
- Nếu `TIMEOUT` của DRP vẫn có output usable, Allocation nên có rule chấp nhận có kiểm soát
- Nếu không chấp nhận, DRP phải đổi semantics `TIMEOUT` cho đúng “not safe for downstream”

### Priority P1
- Hoặc bổ sung fields cần thiết vào contract M4→M5:
  - `specs_id`
  - `need_date`
  - urgency/priority
- Hoặc sửa spec Step 5 để chấp nhận Phase 1 chỉ allocate theo item-location-week

### Priority P2
- Chuẩn hóa Policy abstraction dùng chung cho M4/M5
- Thêm khả năng show baseline ở UI Allocation:
  - source plan run
  - source supply snapshot / live mode
  - source policy run / active policy
- Thêm channel isolation nếu business thực sự cần multi-channel separation

## Verdict
Module 5 hiện **chạy được**, nhưng đang có một vấn đề nền tảng:

**Nó không allocate trên cùng baseline đã sinh ra kế hoạch.**

Cụ thể:
- từ M4, nó đang consume sai status release và không bám theo exact supply baseline
- từ M3, nó đang consume ABC/SS/RTM theo kiểu “latest/current-active”, không bind chặt vào policy baseline

Vì vậy, kết quả Allocation hiện tại có thể hợp lý về mặt cục bộ, nhưng chưa đủ mạnh để nói rằng nó là downstream execution đáng tin cậy của DRP plan.

Nếu chưa xử lý các điểm này, team sẽ rất khó trả lời các câu hỏi vận hành quan trọng như:
- “Vì sao DRP nói có plan nhưng Allocation lại không ra giống?”
- “Allocation này đang dùng policy nào?”
- “Run này có còn đúng với snapshot đã freeze hay không?”

---

Prepared for dev review only. No code changes applied in this feedback.
