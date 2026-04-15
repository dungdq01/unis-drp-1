# Module 4 Feedback — DRP Netting

## Scope
Review Module 4 tập trung vào vai trò giao thoa giữa:
- Module 1: Demand Snapshot
- Module 2: Supply Snapshot
- Module 3: Inventory Policy / Safety Stock / RTM
- Module 5: Allocation downstream

Phạm vi review gồm:
- backend `backend/src/drp/*`
- frontend `frontend/app/drp/*`, `frontend/lib/api/drp.ts`
- BA spec `docs/04-drp-netting.md`
- dev docs `docs/report-module4/*`
- call-site integration ở `allocation.service.ts`, cùng đối chiếu với M2/M3 code đã review trước đó

## Overall Assessment
Module 4 có structure khá rõ và là một trong những module execution mạnh nhất hiện tại:
- có `plan_run`
- có async batch DRP
- có bảng `planned_order_release` và `drp_exception`
- có UI cho run / planned orders / exceptions / netting grid
- đã nối được với Demand, Supply và Safety Stock

Tuy nhiên vì đây là nơi hội tụ của M1/2/3, một số mismatch hiện tại là rất đáng chú ý. Các issue lớn nhất nằm ở:
- contract re-run theo snapshot/policy
- độ đúng của `demand_basis`
- semantics của run config và metrics
- contract sang Allocation
- độ khớp giữa spec và implementation/UI

## Key Findings

### 1. DRP re-run semantics đang chặn sai use case business khi Module 3 thay đổi policy
`createAndRunDrp()` chặn tạo run mới nếu đã có `RUNNING` hoặc `COMPLETED` cho cùng cặp:
- `demand_snapshot_id`
- `supply_snapshot_id`

Trong khi spec nói rõ cần re-run khi:
- có policy/safety stock recalculated
- planner override demand hoặc supply
- có significant drift/exception

Vấn đề là `plan_run` hiện không lưu `policy_run_id`, nhưng duplicate guard lại chỉ nhìn demand + supply snapshot pair.
Kết quả:
- nếu Step 3 đổi `ACTIVE` policy nhưng snapshots vẫn giữ nguyên, DRP không cho tạo run mới
- planner không thể chạy lại để phản ánh policy mới
- đây là mismatch nghiêm trọng tại giao điểm M3 → M4

Đây là issue P0.

### 2. `plan_run` không trace `policy_run_id`, nên DRP không reproducible theo Module 3
DRP preload safety stock bằng query:
- `JOIN policy_run pr ON pr.id = sst.policy_run_id`
- `WHERE pr.status = 'ACTIVE'`

Nhưng `plan_run` chỉ lưu:
- demand snapshot
- supply snapshot
- config_json

Không lưu:
- `policy_run_id`
- thời điểm policy snapshot được bind
- version của SS/override set được dùng trong lần run đó

Hệ quả:
- cùng một snapshot pair có thể sinh kế hoạch khác nếu `ACTIVE` policy đổi theo thời gian
- sau này khó audit “run #X đã dùng policy nào”
- M4 đang kế thừa trực tiếp risk reproducibility của M3

Đây là architectural gap trọng yếu giữa M3 và M4.

### 3. `MAX_FORECAST_PO` gần như chưa được implement thật
Spec Module 4 mô tả `demand_basis = MAX_FORECAST_PO`:
- lấy max giữa forecast và confirmed PO
- có cutoff 90 ngày cho PO cũ

Nhưng implementation thực tế của DRP chỉ đọc:
- `COALESCE(reconciled_qty, qty)` từ `demand_snapshot_line`
- rồi chia monthly → weekly

Không có đoạn nào:
- join confirmed PO source
- check cutoff 90 ngày
- tính `max(forecast, confirmed_po)`

Trong dev doc còn có chỗ đồng nhất `COALESCE(reconciled_qty, qty)` với `MAX_FORECAST_PO`, nhưng đó chỉ là planner override demand, không phải confirmed customer orders.

Hệ quả:
- semantics demand basis giữa spec và code đang lệch đáng kể
- output DRP có thể under-plan nếu confirmed demand chưa được phản ánh trong snapshot
- UI vẫn ghi `demandBasis = MAX_FORECAST_PO`, tạo cảm giác hệ thống đang chạy đúng rule dù thực tế chưa có nguồn dữ liệu PO tương ứng

Đây là issue P0/P1 tùy business readiness của source confirmed PO.

### 4. `horizonWeeks` và `frozenZone` là config “ảo” — UI cho nhập nhưng core logic không thực sự dùng
`CreateDrpRunDto` cho phép truyền:
- `horizonWeeks`
- `frozenZone`

UI cũng cho planner nhập hai giá trị này.
Nhưng core logic lại vẫn dùng hằng số global:
- `runNetting()` lấy `DRP_CONFIG.HORIZON_WEEKS` và `DRP_CONFIG.FROZEN_ZONE`
- vòng build scheduled receipts cũng loop theo `DRP_CONFIG.HORIZON_WEEKS`

Tức là:
- giá trị người dùng nhập được lưu vào `config_json`
- nhưng không điều khiển logic tính thực tế

Đây là mismatch FE/BE contract rất rõ.
Hệ quả:
- user tin rằng đang chạy horizon 8 tuần hoặc frozen zone 4 tuần
- nhưng kết quả vẫn là 12 tuần / frozen zone mặc định
- audit log trong `config_json` cũng trở nên misleading

Đây là issue P0 vì nó làm config run không đáng tin.

### 5. `TIMEOUT` semantics chưa đúng spec và exception `NETTING_TIMEOUT` không bao giờ được tạo
Spec nói:
- nếu timeout > 60s thì partial results saved
- có warning rõ
- có thể có `NETTING_TIMEOUT` exception

Implementation hiện tại:
- chạy xong toàn bộ batch rồi mới check `durationMs > TIMEOUT_MS`
- nếu quá 60s thì mark whole run `TIMEOUT`
- không stop giữa chừng
- không lưu partial progress thực sự
- không tạo `NETTING_TIMEOUT` exception nào cả

Ngoài ra enum exception vẫn expose `NETTING_TIMEOUT`, nhưng code không phát sinh loại này.

Hệ quả:
- `TIMEOUT` hiện chỉ là label “hoàn thành chậm”, không phải timeout theo semantics nghiệp vụ
- planner có thể hiểu sai mức độ tin cậy của output
- docs/API/UI đang over-promise so với implementation

### 6. `plannedOrdersCount` đang đếm toàn bộ row netting, không phải số planned orders thực sự
Service save `ALL 12 weeks` cho mỗi combo vào `planned_order_release`, kể cả `planned_order_qty = 0`.
Nhưng khi update `plan_run`, code set:
- `plannedOrdersCount: allOrders.length`

Tức là metric này thực chất là:
- số dòng netting trace đã lưu
không phải:
- số planned orders có `planned_order_qty > 0`

Trong khi các label UI và spec đều hiểu `planned orders` là số lệnh đề xuất thật.

Hệ quả:
- KPI run dashboard bị inflate nặng
- compare run / capacity review có thể sai nhận thức
- cùng một combo luôn tạo 12 rows, nên metric lệch bản chất nghiệp vụ

Đây là issue P1 rất rõ về data semantics.

### 7. HSTK summary đang dùng số exception theo tuần, không phải số combination duy nhất
`getHstkSummary()` lấy:
- count exception `STOCKOUT_ALERT`
- count exception `OVERSTOCK_ALERT`

Rồi so với:
- `totalCombinations = plan_run.combinations_processed`

Nhưng 1 combo có thể sinh nhiều stockout/overstock alert ở nhiều tuần.
Vì vậy:
- `stockoutCount` hiện là số exception rows
- không phải số combo bị stockout
- `ok = total - stockout - overstock` có thể âm, phải `Math.max(0, ...)`

Điều này làm:
- stockoutPct / overstockPct không còn là tỷ lệ combination đúng nghĩa
- HSTK KPI dễ bị hiểu sai ở dashboard

Đây là bug logic/reporting quan trọng của M4 monitoring.

### 8. Contract M4 → M5 đang lệch: Allocation code đọc cả `NEEDS_APPROVAL`
Spec M4 và docs M5 đều nói Allocation chỉ nên nhận:
- `AUTO_RELEASE`
- `RELEASED`

Nhưng `allocation.service.ts` hiện query `planned_order_release` với:
- `status IN ('AUTO_RELEASE', 'RELEASED', 'NEEDS_APPROVAL')`

Hệ quả:
- Allocation có thể lấy cả demand lines vẫn còn trong frozen zone, chưa được planner approve
- bypass logic approval của Module 4
- làm hỏng contract giữa M4 và M5

Đây là một trong những issue integration nghiêm trọng nhất của Step 4 → Step 5.

### 9. Scheduled receipts từ Module 2 đang bị dồn hết vào week 1
DRP load scheduled receipts từ `supply_snapshot_line.in_transit_qty`, nhưng Phase 1 implementation gán toàn bộ vào:
- week 1

Điều này đã được note trong dev doc, nhưng vẫn là một data risk lớn so với BA spec “nếu có ETA thì phân bổ đúng tuần”.

Hệ quả:
- nếu hàng in-transit thực ra về ở week 2/3, DRP sẽ overstate availability ở tuần 1
- PAB early weeks bị optimistic giả tạo
- có thể suppress planned order hoặc suppress stockout alert sai

Đây là limitation đã biết, nhưng cần được nêu là risk đầu vào M2 → M4 chứ không nên xem như “đúng spec”.

### 10. DRP currently không dùng RTM trực tiếp, nhưng UI/docs dễ khiến người đọc hiểu Module 3 vào đầy đủ cả SS+RTM
Về logic execution hiện tại, M4 chỉ dùng từ M3:
- Safety Stock (`safety_stock_target`)

M4 không dùng trực tiếp:
- `rtm_rule`
- `resolveRtm`

RTM thực chất được dùng mạnh hơn ở Allocation (M5).
Điều này không hẳn là bug, nhưng docs/UI cần làm rõ hơn để tránh hiểu lầm “Step 4 đang dùng đầy đủ Step 3”.

### 11. Progress indicator theo spec chưa được implement thật
Spec muốn có progress indicator kiểu:
- processing X/Y combinations

Hiện tại `plan_run` chỉ lưu:
- `combinations_processed` ngay từ đầu bằng total combinations

Nó không được update incremental trong batch run.
UI chỉ có:
- status `RUNNING`
- polling list runs

Không có progress thực.
Vì vậy:
- user không biết run đang xử lý được bao nhiêu
- TIMEOUT/slow run khó chẩn đoán
- run dashboard chưa đạt mức visibility mà spec mô tả

### 12. UI/Backend thiếu compare run và export, dù spec yêu cầu rõ
Spec nêu các capability:
- compare 2 runs
- export CSV/Excel
- diff changed orders/exceptions

Nhưng code hiện không có:
- API compare
- API export
- UI compare
- UI export

Đây là gap product khá lớn, đặc biệt vì DRP là module mà compare before/after override rất quan trọng.

### 13. UI thay `HSTK Heatmap` bằng `Netting Grid`, nhưng chưa có heatmap theo spec
Spec yêu cầu:
- matrix items × locations cho HSTK
- click cell để xem detail

UI hiện có:
- tab `Netting Grid` cho lookup thủ công 1 item × location
- HSTK summary cards tổng quát

Không có:
- heatmap matrix
- browse by segment/location
- click-through từ cell risk

Đây là gap coverage giữa spec và FE implementation.

### 14. Exception dashboard chưa có drill-down workflow đúng spec
Spec muốn:
- click exception → netting grid cho combo đó

UI hiện tại chỉ có:
- filter
- resolve note
- bảng list

Không có:
- click row để mở grid tự động
- deep link sang tab netting với prefilled item/location

Điều này làm workflow xử lý exception bị rời rạc hơn thiết kế ban đầu.

### 15. Planned Orders tab chưa có bulk approve/export/sort capabilities như spec
Spec muốn:
- bulk approve frozen zone
- export CSV
- sort by urgency/qty/segment

UI hiện chỉ có:
- filter cơ bản
- approve/cancel từng dòng
- pagination

Thiếu các action quản trị quan trọng cho planner khi volume lớn.

### 16. FE `createDrpRun()` type contract đang sai so với response backend
Backend `POST /drp/run` trả về:
- `planRunId`
- `status`
- `combinationsToProcess`

Nhưng FE `createDrpRun()` lại type return là `PlanRun`.
UI có workaround bằng cách reload list runs, nhưng contract type vẫn sai.

Đây là bug nhỏ hơn, nhưng là dấu hiệu FE/BE contract chưa sạch.

### 17. FE `listPlanRuns()` truyền `pageSize`, controller lại đọc `limit`
FE gọi:
- `GET /drp/run?page=1&pageSize=20`

Controller lại đọc query param:
- `page`
- `limit`

Nên `pageSize` hiện có khả năng bị bỏ qua và backend rơi về default `limit = 20`.
Đây không phải bug nghiêm trọng ngay lúc này vì default trùng nhau, nhưng contract đang lệch.

### 18. `getExceptions()` sort severity sau khi paginate, nên thứ tự toàn cục có thể sai
Service currently:
- query DB với order `created_at ASC`
- `skip/take`
- rồi sort in-memory theo severity trên page data vừa lấy

Hệ quả:
- page 1 không chắc chứa các exception severity cao nhất toàn bộ run
- thứ tự HIGH → MEDIUM → LOW chỉ đúng trong page hiện tại, không đúng global order

Đây là issue logic nhỏ nhưng ảnh hưởng dashboard exception khi volume lớn.

### 19. `orIgnore()` trong batch save có thể che partial insert problems
Cả planned orders và exceptions đều insert batch với `.orIgnore()`.
Nếu có trường hợp batch rerun, duplicate hay save partial không đồng nhất:
- hệ thống có thể im lặng bỏ qua rows
- không fail rõ để planner/dev biết run đã inconsistent

Với module execution/audit như DRP, silent ignore là pattern khá rủi ro.

### 20. `drp_netting_detail` được define trong docs/migration guide nhưng runtime flow thực tế không dùng
Implementation hiện reuse `planned_order_release` để hiển thị netting detail 12 tuần.
Điều này không sai hoàn toàn, nhưng tạo mismatch với docs/implementation guide vốn nói có table trace riêng.

Nếu team quyết định không dùng `drp_netting_detail`, nên chuẩn hóa docs để tránh cảm giác module đã có full audit-table riêng dù runtime chưa dựa vào đó.

## Cross-Module Risk Summary

### M1 → M4
- demand basis trong spec mạnh hơn implementation hiện tại
- planner override qua `reconciled_qty` có được dùng, nhưng confirmed PO basis chưa có
- monthly→weekly conversion đang đơn giản hóa và chưa có weekly pattern

### M2 → M4
- stale gate của supply snapshot đã implement đúng hướng
- `override_qty` và `is_estimated` được propagate tốt
- nhưng `in_transit_qty` bị gán hết vào week 1, tạo risk distortion ở early weeks

### M3 → M4
- M4 phụ thuộc trực tiếp vào `ACTIVE` policy run nhưng không lưu `policy_run_id`
- DRP không thể re-run cùng snapshot pair sau khi policy đổi
- reproducibility/audit theo policy baseline chưa đạt

### M4 → M5
- contract status hiện lệch nghiêm trọng vì Allocation đang đọc cả `NEEDS_APPROVAL`
- frozen zone approval barrier bị xuyên thủng

## What Works Well

### 1. Core PAB / NR / L4L logic khá sạch
Phần `runNetting()` đã bọc core logic tương đối dễ hiểu:
- PAB before
- net requirement khi `PAB < SS`
- L4L exact qty
- frozen zone flagging
- exception generation

### 2. DRP đã dùng snapshot discipline tương đối đúng
M4 có các guard tốt ở đầu run:
- demand snapshot phải `FROZEN`
- supply snapshot phải `FROZEN`
- stale supply phải được acknowledge

Đây là điểm giao thoa tốt với M1/M2.

### 3. UI DRP đã vượt mức “placeholder”
So với nhiều module khác, M4 FE đã có workflow thật:
- run history
- planned orders table
- exceptions review
- netting lookup 12 tuần

Tức là module đã usable ở mức investigation/manual review, dù chưa full theo spec.

## Recommendations for Dev Team

### Priority P0
- Cho phép re-run cùng demand/supply snapshot pair khi policy run thay đổi hoặc data bị override
- Hoặc lưu `policy_run_id` vào `plan_run` và dùng uniqueness logic theo bộ baseline thực sự

### Priority P0
- Lưu `policy_run_id` vào `plan_run.config_json` hoặc cột riêng, và bind DRP run với policy baseline cố định
- Downstream audit phải trả lời được: run này dùng policy nào

### Priority P0
- Sửa contract M4 → M5 để Allocation chỉ lấy:
  - `AUTO_RELEASE`
  - `RELEASED`
- Không lấy `NEEDS_APPROVAL`

### Priority P0
- Nếu UI cho planner nhập `horizonWeeks` / `frozenZone`, backend phải dùng thật trong runtime
- Nếu chưa hỗ trợ, bỏ option khỏi UI để tránh misleading

### Priority P1
- Quyết định lại `demand_basis`:
  - hoặc implement `MAX_FORECAST_PO` thật với confirmed PO source + 90-day cutoff
  - hoặc rename rule/docs/UI cho đúng implementation hiện tại

### Priority P1
- Sửa `plannedOrdersCount` để đếm đúng số row có `planned_order_qty > 0`
- Tách riêng metric `nettingRowsCount` nếu cần audit full 12-week trace

### Priority P1
- Sửa `getHstkSummary()` để tính theo unique item×location combos, không phải exception rows

### Priority P1
- Làm rõ timeout semantics:
  - timeout thật có cắt sớm hay không
  - partial results có được save/control không
  - `NETTING_TIMEOUT` có sinh exception hay không

### Priority P1
- Nếu chưa có ETA thật từ Module 2, UI/report nên note rõ scheduled receipts week-1 assumption là approximation

### Priority P2
- Thêm compare runs
- Thêm export CSV/Excel
- Thêm drill-down từ exception → netting grid
- Thêm HSTK heatmap đúng spec
- Thêm bulk approve ở frozen zone

## Verdict
Module 4 hiện là module execution tương đối mạnh và đã nối được đầy đủ với M1/M2/M3 ở mức kỹ thuật cơ bản.

Tuy nhiên để trở thành “trái tim planning” đúng nghĩa như spec mô tả, cần xử lý gấp các vấn đề sau:
- **re-run baseline** chưa đúng vì không gắn với `policy_run_id`
- **demand basis** chưa khớp `MAX_FORECAST_PO`
- **runtime config** đang misleading
- **HSTK / planned order metrics** chưa đúng semantics
- **contract sang Allocation** đang leak `NEEDS_APPROVAL`

Nếu chưa sửa các điểm này, DRP vẫn có thể chạy và cho ra kết quả, nhưng tính tin cậy của output planning và contract với Module 5 vẫn còn rủi ro đáng kể.

---

Prepared for dev review only. No code changes applied in this feedback.
