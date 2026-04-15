# End-to-End Baseline Drift Review — Module 3 → Module 4 → Module 5

## Purpose
Tài liệu này không review từng module riêng lẻ, mà trace **một chain baseline duy nhất** xuyên suốt:

- **M3 Policy** tạo baseline policy nào
- **M4 DRP** thực sự bind vào baseline nào khi netting
- **M5 Allocation** có còn dùng cùng baseline đó hay đã drift sang baseline khác

Mục tiêu là trả lời câu hỏi vận hành quan trọng nhất:

**Một allocation run hiện tại có thật sự là downstream execution của đúng policy + demand + supply baseline đã tạo ra DRP plan hay không?**

## Executive Verdict
Câu trả lời hiện tại là: **không hoàn toàn**.

Baseline chain hiện bị đứt ở nhiều điểm:

- M4 chỉ pin được `demand_snapshot_id` và `supply_snapshot_id`, nhưng **không pin `policy_run_id`**
- M5 chỉ pin được `plan_run_id`, nhưng khi chạy lại **reload live/current inputs**
- SS, ABC, RTM, supply ở M5 **không còn guaranteed** là cùng baseline đã tạo ra DRP output

Nói ngắn gọn:

**M4 là plan trên snapshot + current active policy tại thời điểm chạy. M5 lại là allocation trên plan output + live/current policy/runtime data tại thời điểm khác.**

Đó chính là baseline drift xuyên module.

---

## 1. Baseline chain đáng lẽ phải là gì

## 1.1 M3 — Policy baseline
Theo spec/dev doc, M3 là nơi tạo baseline policy cho downstream:

- `policy_run`
  - có `status = DRAFT | ACTIVE | ARCHIVED`
  - có `demand_snapshot_id`
- `item_abc_classification`
  - ABC theo `snapshot_id`
- `safety_stock_target`
  - gắn `policy_run_id`
  - có cả `snapshot_id`
  - là output chính cho DRP
- `rtm_rule`
  - routing rules cho Allocation

Baseline kỳ vọng từ M3 là:
- một `policy_run` cụ thể
- được activate tại một thời điểm cụ thể
- downstream có thể nói rõ: **run này dùng policy baseline nào**

## 1.2 M4 — DRP baseline
M4 tạo `plan_run` với:
- `demand_snapshot_id`
- `supply_snapshot_id`

Nếu chain chặt, `plan_run` cũng nên bind hoặc ít nhất trace được:
- `policy_run_id` đã dùng để load SS

Sau đó `planned_order_release` trở thành demand contract cho M5.

## 1.3 M5 — Allocation baseline
Nếu M5 là execution trung thực của M4 plan, Allocation nên chạy trên:
- demand lines từ đúng `plan_run`
- đúng subset status đã release
- đúng supply baseline tương ứng với `plan_run.supply_snapshot_id`
- đúng policy baseline đã ảnh hưởng tới DRP run đó

Hiểu đơn giản:

`allocation_run` lý tưởng phải là:
- `plan_run_id = X`
- `supply baseline = same as X`
- `policy baseline = same as X`

Hiện tại hệ thống chưa làm được điều này.

---

## 2. Runtime chain thực tế trong code

## 2.1 M3 runtime baseline thực tế
### Safety Stock
M3 activate một policy bằng cách chuyển `policy_run.status = 'ACTIVE'` và archive cái ACTIVE cũ.

Cả M3 API lẫn downstream lookups đều có pattern:
- `JOIN policy_run pr ON pr.id = sst.policy_run_id`
- `WHERE pr.status = 'ACTIVE'`

Điều này có nghĩa:
- runtime thường không resolve theo một `policy_run_id` explicit
- mà resolve theo **ACTIVE hiện tại**

### ABC
ABC được import vào `item_abc_classification` theo `snapshot_id`.

Tuy nhiên downstream không phải lúc nào cũng lookup theo snapshot đó:
- `PolicyService.resolveRtm()` còn join `policy_run pr ON pr.demand_snapshot_id = iac.snapshot_id WHERE pr.status = 'ACTIVE'`
- nhưng Allocation thì không làm vậy

### RTM
`rtm_rule` là live master data:
- không gắn `policy_run_id`
- có `is_active`
- được sửa trực tiếp

Tức là bản thân RTM đã là **mutable live baseline**, không phải run-versioned baseline.

---

## 2.2 M4 runtime baseline thực tế
### Demand and Supply are pinned
`plan_run` pin:
- `demand_snapshot_id`
- `supply_snapshot_id`

Đây là phần baseline chắc nhất của M4.

### Policy is not pinned
Khi DRP load safety stock, code query:
- `safety_stock_target`
- join `policy_run`
- `WHERE pr.status = 'ACTIVE'`

Tức là tại thời điểm DRP chạy, M4 dùng:
- **ACTIVE policy hiện tại**
- không lưu lại `policy_run_id` vào `plan_run`

### ABC lineage does not actually enter DRP runtime
Spec/dev doc có nói M3 output ABC có thể downstream sang DRP/priority semantics.
Nhưng trong backend `src/drp` hiện không có lookup `item_abc_classification` hay `abc_class` nào.

Điều này cho thấy:
- ABC lineage từ M3 sang M4 thực tế **không tồn tại ở runtime**
- M4 chỉ thực sự consume phần SS của M3

### DRP output stores numeric SS, but not policy identity
`planned_order_release` có field `safety_stock`.
Đây là dấu vết tốt vì nó preserve số SS đã dùng tại thời điểm netting.

Nhưng output không có:
- `policy_run_id`
- `abc snapshot baseline`
- `rtm baseline`

Nghĩa là ta biết **con số SS đã dùng**, nhưng không biết chắc **nó đến từ policy run nào** nếu cần audit/replay.

---

## 2.3 M5 runtime baseline thực tế
### Only `plan_run_id` is pinned
`allocation_run` chỉ có:
- `plan_run_id`
- `config_snapshot`

Không có cột riêng cho:
- `policy_run_id`
- `supply_snapshot_id`

### Demand contract from M4 is already breached in runtime
Current runtime query đang load `planned_order_release` với:
- `status IN ('AUTO_RELEASE', 'RELEASED', 'NEEDS_APPROVAL')`

Trong khi M4/M5 docs đều mô tả Allocation chỉ nên lấy:
- `AUTO_RELEASE`
- `RELEASED`

Điểm drift này không chỉ là baseline drift, mà là **approval-state drift**:
- M5 đang kéo cả demand chưa release chính thức

### Supply baseline is replaced by live inventory
Dù DTO có `supplySnapshotId`, engine thực tế load supply từ:
- `lot_attribute`
- live runtime
- không có snapshot FK
- không filter theo `plan_run.supply_snapshot_id`

Điều này làm baseline supply bị thay thế hoàn toàn:
- M4 dùng frozen supply snapshot
- M5 dùng live inventory tại thời điểm allocation run

### SS baseline is replaced by current ACTIVE policy
M5 không dùng `planned_order_release.safety_stock` đã được M4 tính xong.
Thay vào đó, `_loadSsMap()` query lại:
- `safety_stock_target`
- join `policy_run`
- `WHERE pr.status = 'ACTIVE'`

Nghĩa là:
- M4 có thể net bằng policy A
- M5 guard stock lại bằng policy B nếu ACTIVE đã đổi

### ABC baseline is replaced by latest effective row
M5 load ABC bằng query:
- `SELECT DISTINCT ON (item_code) ... FROM item_abc_classification`
- `ORDER BY item_code, effective_date DESC`

Nó không join `policy_run`, không bind `snapshot_id`, không bind `plan_run`.

Đây là drift mạnh nhất ở phần ABC:
- cùng một DRP plan
- Allocation chạy hôm nay và 2 ngày sau
- có thể ra `abc_class` khác nếu bảng ABC vừa import mới

### RTM is live active master, not run-versioned baseline
M5 load RTM bằng:
- `SELECT branch_code, warehouse_code, priority FROM rtm_rule WHERE is_active = true`

Không có:
- `policy_run_id`
- `effective snapshot`
- route snapshot per allocation run

Điều này có nghĩa:
- chỉ cần master RTM đổi sau khi DRP xong
- Allocation run sau đó sẽ follow route mới, dù DRP plan cũ sinh ra trong context route cũ

---

## 3. Drift points theo từng handoff

## 3.1 Drift tại M3 → M4
### Drift A — `policy_run_id` không được pin vào `plan_run`
M4 chỉ lưu `demand_snapshot_id` và `supply_snapshot_id`.
Khi load SS, nó dùng `policy_run ACTIVE` tại thời điểm chạy.

Hệ quả:
- không reconstruct được DRP run đã dùng policy run nào
- re-run cùng snapshot pair nhưng sau khi activate policy mới có thể ra kết quả khác

### Drift B — ABC lineage bị đứt trước khi vào M4 runtime
Spec có nhắc downstream ABC usage, nhưng code M4 không consume ABC.

Hệ quả:
- chain M3→M4 trên nhánh ABC hiện là **spec lineage**, không phải runtime lineage
- team dễ tưởng M4 đang dựa trên cùng policy richness như spec, nhưng thực ra không

### Drift C — M4 chỉ pin số SS, không pin identity của policy baseline
`planned_order_release.safety_stock` giúp biết numeric threshold đã dùng.
Nhưng thiếu `policy_run_id` nên audit trail vẫn chưa đủ mạnh.

---

## 3.2 Drift tại M4 → M5
### Drift D — Approval-state drift
M4 tạo planned orders với semantics rõ:
- `NEEDS_APPROVAL` = frozen zone, chưa downstream hóa
- `RELEASED` = planner đã approve
- `AUTO_RELEASE` = releasable

Nhưng M5 runtime lại đọc cả `NEEDS_APPROVAL`.

Hệ quả:
- boundary control của M4 bị thủng
- M5 allocate cho order chưa được release

### Drift E — Supply baseline drift
M4 chạy trên `supply_snapshot_id` frozen.
M5 chạy trên `lot_attribute` live.

Hệ quả:
- same `plan_run` không còn tương ứng với same available stock context
- allocation result biến động theo thời điểm chạy, không phải theo plan run baseline

### Drift F — Safety Stock baseline drift
M4 netting dùng SS của ACTIVE policy tại thời điểm DRP run.
M5 SS guard lại query ACTIVE policy tại thời điểm allocation run.

Hệ quả:
- cùng một demand line từ `planned_order_release`
- M4 nói cần hàng vì threshold = A
- M5 có thể chặn/không chặn theo threshold = B

### Drift G — ABC baseline drift
M5 reload ABC theo `latest effective_date`, không theo policy baseline.

Hệ quả:
- fill-rate by class, allocation priority, reporting by class đều có thể không còn cùng baseline với M3/M4 context ban đầu

### Drift H — RTM baseline drift
RTM không versioned theo run.
M5 luôn lấy `rtm_rule.is_active = true` hiện tại.

Hệ quả:
- route/network assumption có thể đổi sau khi DRP plan đã được sinh
- Allocation result phản ánh route mới, không phản ánh route context cũ của plan

### Drift I — `supplySnapshotId` là dead trace, không phải executed baseline
M5 DTO/dev doc cho thấy có `supplySnapshotId` và còn lưu vào `config_snapshot`.
Nhưng engine không dùng nó để load supply.

Hệ quả:
- system trông như đang trace snapshot baseline
- runtime thực ra không execute theo baseline đó
- rất dễ gây hiểu nhầm trong audit/debug

---

## 4. Chain summary in one sentence per module

- **M3:** tạo policy artifacts, nhưng downstream chủ yếu resolve theo `ACTIVE hiện tại`, riêng RTM còn là live master không versioned
- **M4:** pin demand/supply snapshot khá tốt, nhưng consume policy theo `ACTIVE hiện tại` và không lưu `policy_run_id`
- **M5:** chỉ pin `plan_run_id`, sau đó reload live/current supply + live/current policy artifacts, nên drift mạnh nhất xảy ra ở đây

---

## 5. What is still stable in the current chain

Dù chain bị drift, vẫn có 3 điểm tương đối ổn:

### 5.1 `plan_run` pin được demand/supply snapshot của DRP
Đây là anchor tốt nhất hiện nay trong chain.

### 5.2 `planned_order_release.safety_stock` preserve numeric SS used by DRP
Ít nhất có thể biết DRP đã net với SS nào ở từng row.

### 5.3 `plan_run_id` giúp M5 bám được đúng DRP output set
Dù baseline supply/policy bị drift, M5 vẫn đang allocate trên đúng tập demand rows của một DRP run cụ thể.

---

## 6. Recommended target model

## 6.1 Minimum viable fix
Nếu chưa muốn redesign lớn, tối thiểu nên làm:

- thêm `policy_run_id` vào `plan_run`
- propagate `policy_run_id` vào `allocation_run`
- M5 chỉ load demand với `AUTO_RELEASE`, `RELEASED`
- M5 dùng **exact same policy baseline** để load SS/ABC
- nếu chưa snapshot hóa RTM, phải ghi rõ RTM là live-master assumption

## 6.2 Stronger end-to-end baseline model
Model tốt hơn nên là:

- `policy_run_id` pinned on `plan_run`
- `allocation_run` lưu:
  - `plan_run_id`
  - `policy_run_id`
  - `supply_snapshot_id` hoặc `live_supply_mode`
- M5 phải chọn một trong hai mode rõ ràng:
  - **Replay mode:** allocate theo exact same frozen baseline as planning
  - **Re-optimization mode:** allocate theo live inventory/current policy

Hiện tại hệ thống đang ở trạng thái lưng chừng:
- API/docs có dấu hiệu của replay mode
- runtime lại chạy giống re-optimization mode
- nhưng UI/spec chưa nói rõ điều đó

---

## 7. Final conclusion
Chuỗi M3→M4→M5 hiện không phải là một baseline chain khép kín.

Nó đang vận hành như sau:

1. M3 tạo policy artifacts
2. M4 dùng **ACTIVE policy hiện tại** để net trên frozen demand/supply snapshot
3. M5 lấy output demand từ M4 nhưng lại combine với **live supply + current policy artifacts**

Vì vậy, Allocation hiện tại không thể được xem là downstream execution hoàn toàn trung thực của DRP plan.

Mệnh đề đúng hơn phải là:

**Allocation là bước tái-diễn giải DRP demand bằng baseline runtime hiện tại, không phải baseline planning gốc.**

Nếu team chấp nhận điều này như một design choice, docs/UI phải nói rõ.
Nếu team không chấp nhận, đây là cross-module issue ưu tiên rất cao cần sửa.
