# Module 3 Feedback — Inventory Policy

## Scope
Review Module 3 gồm các phần:
- ABC classification import / cross-check
- Safety Stock calculation và policy run lifecycle
- SS override
- RTM rule management / resolution
- contract với Demand (M1), Supply (M2), DRP (M4), Allocation (M5)
- mức độ khớp giữa backend, frontend và `docs/03-inventory-policy.md`

## Overall Assessment
Module 3 có nền tảng tốt ở chỗ:
- đã tách thành module riêng ở backend/frontend
- có khái niệm `policy_run` với lifecycle `DRAFT / ACTIVE / ARCHIVED`
- có công thức SS tương đối rõ ràng
- downstream DRP / Allocation đã bắt đầu đọc `safety_stock_target`
- RTM đã có CRUD cơ bản

Tuy nhiên đây là module điều khiển trực tiếp ngưỡng planning và routing. Sau khi review kỹ code hiện tại, Module 3 vẫn còn một số rủi ro lớn về:
- tính đúng của input SS
- tính ổn định của `ACTIVE` policy contract
- khả năng audit / reproducibility
- độ khớp giữa UI và spec product

## Key Findings

### 1. `createPolicyRun()` không đảm bảo ABC đã được import cho đúng snapshot trước khi tính SS
`createPolicyRun()` chỉ tạo run rồi gọi `calculateAllSafetyStocks(...)`.
Không có bước nào đảm bảo rằng:
- `item_abc_classification` đã tồn tại cho `demandSnapshotId` đó
- ABC trong bảng classification đúng là của snapshot đang được dùng để tính run

Trong `calculateAllSafetyStocks()`, nếu không tìm thấy ABC record thì code default về `C`:
- `const abcClass = abcMap.get(item_code) ?? 'C'`

Hệ quả:
- nếu planner quên import ABC trước, nhiều item sẽ silently thành `C`
- CSL / z-score / DOS cap bị thấp hơn thực tế
- Safety Stock có thể bị under-protect
- downstream DRP / Allocation nhận policy sai nhưng hệ thống không báo lỗi rõ

Đây là issue P0 vì nó ảnh hưởng trực tiếp đến output policy.

### 2. ADU đang tính ở level `item`, không phải `item × location` như spec mô tả
`loadAduMap()` hiện aggregate:
- `SUM(qty_sold_12m_avg)`
- `GROUP BY item_code`

Tức là mọi location của cùng một item sẽ dùng chung một ADU toàn network.
Trong khi spec và business wording của Module 3 đang nói nhiều lần theo `item × location` / `item × branch`.

Hệ quả:
- SS ở location demand thấp có thể bị inflate vì dùng ADU tổng mạng lưới
- SS ở location demand cao có thể bị understate nếu pattern phân bổ lệch
- công thức `SS = z × √(LT × σ² + ADU² × σ²_LT)` mất meaning tại local location
- DRP threshold không còn phản ánh đúng mức buffer của từng node

Đây là root-cause logic gap quan trọng nhất của phần Safety Stock.

### 3. Scope của active combinations đang bám `latest FROZEN supply snapshot`, không bám snapshot context của policy run
`calculateAllSafetyStocks()` lấy combinations từ:
- snapshot supply `FROZEN` mới nhất toàn hệ thống

Nó không lưu hoặc ràng buộc với:
- supply snapshot nào được review cùng policy run
- bối cảnh snapshot nào planner muốn dùng khi tính policy

Điều này tạo ra lệch context:
- demand snapshot của run là A
- nhưng active item-location combinations lại lấy từ supply snapshot B mới nhất
- nếu supply changed giữa các lần run thì tập combinations thay đổi mà user không kiểm soát rõ

Spec của Module 3 chủ yếu nói output policy phụ thuộc Demand + master config, trong khi implementation hiện tại lại để Supply quyết định tập combination. Nếu business muốn vậy thì cần document rõ; nếu không, đây là logic coupling nguy hiểm giữa M2 và M3.

### 4. `policy_run` chưa khóa chặt reproducibility cho downstream vì DRP/Allocation luôn đọc `ACTIVE` hiện tại
Module 3 có `policy_run_id` trong `safety_stock_target`, nhưng downstream hiện không bind theo run đã được chọn/lưu trong plan run.

Hiện tại:
- DRP bulk load `safety_stock_target` bằng `WHERE pr.status = 'ACTIVE'`
- Allocation cũng load SS bằng `WHERE pr.status = 'ACTIVE'`

Hệ quả:
- cùng một demand/supply snapshot pair có thể cho netting/allocation khác nhau nếu `ACTIVE` policy đổi sau đó
- khó audit lại “run này đã dùng policy nào”
- plan reproducibility phụ thuộc trạng thái hệ thống hiện tại, không phụ thuộc run context lịch sử

Đây là architectural gap nghiêm trọng vì policy là planning baseline, không nên bị đọc kiểu “latest active at query time” nếu cần trace chuẩn.

### 5. ABC used by Allocation không bám `ACTIVE` policy run mà bám classification mới nhất theo `effective_date`
Trong `allocation.service.ts`, ABC được load bằng:
- `SELECT DISTINCT ON (item_code) ... ORDER BY effective_date DESC`

Query này không join với `policy_run` hay snapshot của policy đang active.
Kết quả là:
- Allocation ABC priority có thể lấy classification mới hơn / khác snapshot
- trong khi SS lại lấy từ `ACTIVE` policy run
- cùng một allocation run có thể dùng SS từ policy A nhưng ABC priority từ classification B

Đây là mismatch rất đáng chú ý giữa 2 output cốt lõi của Module 3.

### 6. `activatePolicyRun()` không kiểm tra run đã tính xong / đủ dữ liệu trước khi activate
Frontend chỉ hiện nút `Activate` khi progress đạt 100%, nhưng backend không enforce mạnh điều đó.
`activatePolicyRun()` chỉ check:
- run phải là `DRAFT`

Nó không check:
- `combinationsDone === totalCombinations`
- totalCombinations > 0
- run có thực sự có records trong `safety_stock_target`
- calculation có fail giữa chừng hay không

Vì `createPolicyRun()` là fire-and-forget và lỗi chỉ bị `console.error`, một run hỏng một phần vẫn có thể bị activate nếu UI hoặc API gọi trực tiếp.

### 7. Async calculation failure không được phản ánh vào run status
`createPolicyRun()` trigger background calculation và nếu lỗi thì chỉ:
- `console.error(...)`

Không có:
- status `FAILED`
- error_message / failure_reason
- UI signal rằng run đã crash

Hệ quả:
- planner không biết run thất bại hay đang pending mãi
- DRAFT run lỗi trông giống DRAFT run chưa activate
- audit và troubleshooting rất khó

### 8. Insert SS targets dùng `orIgnore()` có thể che mất dữ liệu sai / stale data nếu run bị rerun
Trong batch insert SS targets, code dùng `.orIgnore()`.
Điều này tránh duplicate crash, nhưng cũng có nghĩa:
- nếu một batch insert partial rồi rerun lại cùng `policy_run_id`
- các record cũ sẽ bị giữ nguyên
- các record mới bị bỏ qua hoặc không recompute đúng

Nếu không có cơ chế clear old targets hoặc upsert deterministic, dữ liệu run có thể trở nên nửa cũ nửa mới.

### 9. `overrideSsTarget()` có thể override nhầm `DRAFT` thay vì `ACTIVE`
Override query hiện tìm record ở cả `ACTIVE` và `DRAFT`, rồi:
- `ORDER BY pr.status DESC  -- ACTIVE first`

Nhưng sort text theo `DESC` không đảm bảo `ACTIVE` luôn đứng trước `DRAFT` theo semantics business.
Nếu DB collation/order khác kỳ vọng, override có thể chạm vào DRAFT record.

Ngay cả khi ACTIVE hiện đứng trước thật, cách này vẫn mong manh.
Đây là bug tiềm ẩn rất nguy hiểm vì planner nghĩ đang sửa policy dùng bởi DRP nhưng thực ra có thể đang sửa run khác.

### 10. `archivePolicyRun()` có thể để hệ thống không còn `ACTIVE` policy nào
Backend cho phép archive một run mà không check:
- đó có phải `ACTIVE` run duy nhất không
- archive xong system còn policy nào để DRP/Allocation dùng không

Hệ quả:
- DRP sẽ fallback `SS = 0` và chỉ raise `MISSING_SS`
- Allocation cũng có thể đọc map rỗng
- production planning có thể tiếp tục chạy với trạng thái degraded nhưng không có hard stop

Nếu business cho phép “không có active policy”, cần explicit governance hơn. Nếu không, đây là gap control lớn.

### 11. FE archive policy run đang gọi sai path API
Frontend archive action đang gọi:
```text
/api/policy/runs/:id/archive
```
trong khi API client và backend controller dùng prefix:
```text
/api/v1/policy/...
```

Nếu không có proxy route riêng ở Next app, nút archive trên UI sẽ fail thực tế.
Đây là bug FE/BE contract khá rõ.

### 12. FE không expose compare / detail / history flow như spec yêu cầu
Spec muốn có:
- side-by-side compare SS cũ vs mới trước activate
- calculation detail / breakdown per item × location
- history của SS calculations

Nhưng UI hiện tại mới có:
- list policy runs
- table SS targets
- override dialog đơn giản
- ABC table cơ bản
- RTM table CRUD cơ bản

Thiếu hẳn:
- compare impact trước activate
- drill-down calculation breakdown
- historical trace để review run quality

Điều này làm workflow “manager review trước activate” gần như chưa thành hình.

### 13. FE KPI/summary có số hardcode và label gây hiểu sai
Ở `page.tsx` có card:
- `ABC Items` với subtext `A: 255 · B/C from import`

Đây là text hardcode, không phản ánh dữ liệu thật.
Ngoài ra card:
- `Avg SS (days)`

thực tế đang tính trung bình từ `avgSsByClass`, vốn là SS theo unit quantity, không phải days.

Hệ quả:
- KPI semantics sai
- planner dễ hiểu nhầm metric đang xem

### 14. `fetchSsSummary()` không bám run đang chọn, nhưng table lại bám `activeRunId`
FE load summary bằng endpoint global `fetchSsSummary()`:
- summary luôn đọc `ACTIVE` run hiện tại từ backend

Trong khi table `fetchSsTargets()` lại truyền `policyRunId: activeRunId`.
Điều này tạo mismatch:
- user chọn DRAFT run A để review
- SS table hiển thị run A
- nhưng summary cards lại hiển thị ACTIVE run B

Đây là đúng kiểu scope bug giống Module 2: selected context và global current state bị trộn vào nhau.

### 15. FE `activeRunId` không thực sự là “ACTIVE run”, mà là “active or latest selected run”
State tên là `activeRunId`, nhưng `loadRuns()` set:
- ACTIVE run nếu có
- nếu không thì latest run

Sau đó nhiều UI label dùng `activeRun` để hiển thị như thể đó là current authoritative policy.
Điều này gây mơ hồ giữa:
- run user đang chọn để review
- run ACTIVE thật sự đang được downstream dùng

### 16. ABC tab chưa bám snapshot context rõ ràng
`fetchAbcClassifications()` ở FE không truyền `snapshotId` theo run đang chọn hay snapshot đã import gần nhất.
Kết quả là ABC table dễ trở thành “global pool” của mọi classification records.

Với module có nhiều snapshot/runs, thiếu context này sẽ làm:
- user không biết đang review ABC của snapshot nào
- discrepancy list không gắn rõ với policy run cụ thể

### 17. ABC discrepancy logic trong code chưa đúng ngưỡng spec
Spec mô tả discrepancy chỉ được flag khi:
- forecast segment khác internal class
- **và** discrepancy > 10%

Nhưng code hiện flag đơn giản khi:
- `internalClass !== abcClass`

Không có bước tính volume discrepancy > 10%.
Hệ quả:
- số discrepancy bị inflate
- alert mất ý nghĩa business
- planner khó phân biệt mismatch đáng kể với mismatch nhỏ

### 18. SS fallback `fc_error` hiện gần như luôn rơi về fallback proxy, nhưng UI/docs không làm rõ rõ ràng cho user
Theo implementation notes, `demand_accuracy` hiện chỉ có 2 usable points nên Phase 1 gần như luôn dùng:
- `qty_sold_3m_avg × 0.30`

Tuy nhiên product semantics trong spec và UI vẫn nhấn mạnh nhiều về `fc_error` based sigma.
Điều này không sai hoàn toàn về roadmap, nhưng nếu không làm rõ ở UI/report:
- planner dễ tin rằng SS đang bám forecast error history thật
- trong khi phần lớn đang chạy bằng proxy

### 19. RTM edit flow ở FE có thể fail vì deactivate + recreate đụng unique constraint
FE không có endpoint update RTM, nên edit đang làm workaround:
- deactivate old rule
- create new rule với cùng `branchCode + warehouseCode`

Nhưng bảng `rtm_rule` có unique:
- `(branch_code, warehouse_code)`

Nếu deactivate chỉ set `is_active = false` mà record vẫn tồn tại, create mới cùng pair có thể bị DB reject do unique constraint.
Tức là edit flow UI hiện có khả năng không chạy được thực tế.

### 20. RTM product flow còn thiếu nhiều capability so với spec
Spec muốn có:
- resolution preview cho `item × branch`
- bulk import CSV
- map view
- manual routing handling cho C-class

Hiện UI mới có:
- list/filter/edit/add/deactivate rule

Không có:
- route resolve preview
- bulk import
- compare routing strategy theo ABC
- workflow cho `manual routing` của C-class

### 21. RTM data contract trên FE đang chứa field không có trong entity hiện tại
`frontend/lib/api/policy.ts` định nghĩa `RtmRule` có:
- `itemCode`
- `transportMode`

Nhưng entity backend hiện tại không có các field này.
FE đang fallback hiển thị `All` hoặc `ROAD`, nên UI có vẻ chạy được, nhưng contract đang lỏng và không authoritative.

### 22. Controller chưa có auth/role guard rõ ràng cho các action policy-sensitive
Controller hiện chưa thấy guard/permission layer rõ cho các action như:
- create policy run
- activate policy
- override SS
- create/deactivate RTM

Trong khi spec mô tả rõ vai trò planner vs manager vs IT admin.
Nếu chưa có access control, workflow approval trong Module 3 mới chỉ là UI convention, chưa phải policy governance thật.

## What Works Well

### 1. `policy_run` là abstraction đúng hướng
Việc tách khái niệm run và targets là hướng tốt hơn nhiều so với ghi đè policy trực tiếp.
Nó mở đường cho:
- review trước activate
- archive lifecycle
- audit theo từng lần tính

### 2. Downstream đã có integration point thực sự với Module 3
DRP và Allocation đã bắt đầu đọc:
- `safety_stock_target`
- `item_abc_classification`
- `rtm_rule`

Tức là Module 3 không chỉ là màn hình hiển thị mà đã nằm trong execution path thực tế.

### 3. SS formula và config constants tương đối rõ ràng
Các constant như:
- z-score theo ABC
- DOS targets
- LT variability
- sigma fallback

đã được tách tương đối rõ, giúp việc review logic dễ hơn.

## Business Impact

### Impact to planners / managers
- Có thể activate policy mà không thực sự review đủ impact
- Có thể hiểu sai run nào đang được dùng ở summary vs table
- ABC discrepancy dễ bị over-alert
- RTM edit/archive actions có thể fail hoặc không đúng như UI hứa hẹn
- khó audit vì thiếu compare / detail / history flow

### Impact to DRP / Allocation
- SS thresholds có thể sai do ADU dùng ở wrong scope
- thiếu trace policy-run-specific → reproducibility kém
- Allocation có thể dùng ABC khác context với SS
- nếu mất ACTIVE policy thì DRP có thể chạy với `SS = 0`

## Recommendation Notes for Dev Team

### Priority P0
- Bắt buộc ràng buộc `policy_run` với một bộ ABC/classification snapshot hợp lệ trước khi tính SS
- Không cho silent default toàn bộ về `C` nếu chưa import ABC đầy đủ

### Priority P0
- Quyết định rõ scope của SS:
  - nếu theo `item × location` thì ADU/sigma phải tính đúng level đó
  - nếu theo `item` toàn mạng lưới thì docs/UI/downstream phải ghi rõ và nhất quán

### Priority P0
- DRP và Allocation phải trace policy theo `policy_run_id` cố định của plan run / allocation run
- Không nên luôn đọc `ACTIVE` tại thời điểm query nếu cần reproducibility

### Priority P0
- Backend `activatePolicyRun()` phải validate:
  - calculation complete
  - data exists
  - run không failed / partial
- Bổ sung trạng thái `FAILED` hoặc error field cho async calculation

### Priority P1
- Sửa discrepancy logic để đúng spec `> 10%`, không chỉ khác class là flag
- Làm rõ ở UI/report khi sigma đang dùng fallback thay vì `fc_error` thật

### Priority P1
- Sửa override selection để luôn target đúng record intended by business
- Không chọn theo `ORDER BY pr.status DESC` mơ hồ

### Priority P1
- Đồng bộ FE summary với run đang chọn
- Tách rõ:
  - selected run
  - ACTIVE run đang có hiệu lực downstream

### Priority P1
- Hoàn thiện governance flow theo spec:
  - compare old vs new
  - calculation breakdown detail
  - history/audit per run
  - role-based approval

### Priority P1
- Sửa FE archive policy API path
- Rà soát toàn bộ FE/BE contract cho RTM edit và archive actions

### Priority P2
- Bổ sung RTM resolution preview và bulk import nếu product thực sự cần đúng spec
- Làm rõ workflow cho `manual routing` của C-class

## Suggested Product Direction
Một hướng ổn định hơn cho Module 3 là:

1. Freeze demand snapshot
2. Import ABC cho chính snapshot đó và validate coverage
3. Tạo `policy_run` gắn chặt với snapshot / config version / combination scope rõ ràng
4. Tính SS với inputs đúng level business
5. Manager review compare + detail breakdown
6. Activate policy run
7. Khi DRP / Allocation chạy, chúng lưu và dùng `policy_run_id` cố định
8. Mọi override sau đó phải có audit rõ và không phá trace của run lịch sử

## Verdict
Module 3 đã có khung kỹ thuật khá mạnh và gần đến mức có thể dùng làm policy engine thật.
Tuy nhiên hiện còn 4 nhóm rủi ro lớn cần ưu tiên cao:
- tính đúng của SS input đang chưa chắc, đặc biệt ở ABC coverage và ADU scope
- downstream chưa bind chặt với `policy_run_id`, làm giảm reproducibility
- approval / compare / audit flow mới ở mức rất sơ khai
- FE/BE contract còn vài lỗi thực dụng khiến UI hành xử sai hoặc thiếu so với spec

Nếu chưa xử lý các điểm này, Module 3 có thể tạo và hiển thị policy được, nhưng chưa đủ chặt để trở thành policy baseline đáng tin cậy cho DRP và Allocation ở production.

---

Prepared for dev review only. No code changes applied in this feedback.
