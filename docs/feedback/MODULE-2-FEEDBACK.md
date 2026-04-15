# Module 2 Feedback — Supply Snapshot

## Scope
Review logic của Module 2: Bravo upload / manual inventory entry / supply snapshot capture / freshness / freeze / override / khả năng cung cấp input đúng cho DRP.

## Overall Assessment
Module 2 đã có nền tảng tốt hơn Module 1 ở một số điểm:
- Có flow upload Bravo và manual entry
- Có capture snapshot từ `lot_attribute`
- Có freshness check và stale acknowledge
- Có freeze gate trước khi DRP chạy
- Có grouped views theo item / location
- DRP đã đọc `override_qty` từ `supply_snapshot_line`

Tuy nhiên đây vẫn là module rất nhạy cảm vì nó là đầu vào trực tiếp cho DRP. Hiện tại có một số gap và bug quan trọng có thể làm sai inventory baseline, sai confidence flag, hoặc làm planner hiểu sai snapshot đang xem.

## Key Findings

### 1. `is_estimated` đang bị mất trong flow capture snapshot
Đây là issue nghiêm trọng nhất của Module 2.

Spec mô tả rất rõ phân biệt:
- OEM → `is_estimated = false`
- DISTRIBUTION → `is_estimated = true`

Nhưng implementation hiện tại trong `supply.service.ts` khi capture snapshot đang:
- aggregate từ `lot_attribute`
- không lấy `source_type`
- set `isEstimated: false` cho toàn bộ lines
- set `estimatedLinesCount: 0` ở snapshot header

Hệ quả:
- `supply_snapshot_line.is_estimated` gần như vô nghĩa
- dashboard “Estimated vs OEM” bị sai
- `estimated_lines_count` bị sai
- DRP downstream luôn nhận `isEstimated = false`
- các confidence flag cho planned orders không phản ánh đúng thực tế

### 2. Bravo upload có ghi `source_type`, nhưng snapshot không carry forward đúng
`bravo.service.ts` có parse và upsert `source_type` vào `lot_attribute`.
Nhưng bước capture snapshot lại không propagate field này sang `supply_snapshot_line`.

Điều này tạo ra data contract bị đứt giữa:
- Bravo import
- Supply snapshot
- DRP confidence logic

### 3. Override sau khi freeze làm suy yếu ý nghĩa “frozen snapshot”
Hiện tại backend cho phép override line trên cả:
- `DRAFT`
- `FROZEN`

Điều này mâu thuẫn với ý nghĩa thông thường của snapshot freeze và cũng không đồng nhất với acceptance criteria kiểu “freeze xong thì không còn sửa được”.

Về mặt planning control, đây là rủi ro lớn:
- cùng một `supply_snapshot_id` có thể cho ra input khác nhau trước và sau override
- giảm khả năng audit / reproducibility của plan run
- khó giải thích vì sao cùng một snapshot đã FROZEN nhưng DRP result có thể thay đổi ở lần chạy sau

Nếu business thực sự cần sửa sau freeze thì nên coi đó là một workflow riêng có audit rõ, thay vì sửa trực tiếp trên snapshot frozen.

### 4. Override line không refresh UI đúng cách, dễ làm user tưởng chưa cập nhật
Ở frontend `inventory-lines-table.tsx`, sau khi gọi `overrideLine(...)` có comment:
- reload handled by child re-mount or user refresh

Nhưng thực tế không có refresh chắc chắn ngay sau override.
Kết quả là:
- line table có thể chưa đổi ngay
- grouped rows chưa cập nhật ngay
- planner không chắc override đã apply hay chưa

Đây là bug UX rõ ràng ở thao tác nhạy cảm nhất của module.

### 5. Snapshot header totals không được recompute sau override
DRP đã dùng `COALESCE(override_qty, allocatable_qty)` khi đọc supply lines.
Một số query dashboard/stat cũng dùng `COALESCE`.
Nhưng snapshot header như:
- `total_allocatable_qty`
- các KPI trong detail panel / header

không được cập nhật lại sau override line.

Kết quả có thể xảy ra tình trạng:
- inventory lines đã đổi
- DRP input thực tế đã đổi
- nhưng snapshot summary vẫn hiển thị số cũ

Đây là mismatch rất nguy hiểm vì planner có thể tin vào tổng số trên header trong khi DRP đang dùng số khác.

### 6. FE đang trộn “live freshness” với “snapshot freshness”
Ở frontend có hai khái niệm khác nhau:
- freshness của snapshot đã capture (`snapshot.freshness`, `snapshot.freshnessAgeMinutes`)
- freshness live hiện tại của `lot_attribute`

Nhưng `SupplyKpiCards` lại dùng `freshness` live để hiển thị card Freshness, trong khi card này nằm chung với dữ liệu của snapshot đang chọn.
Điều này có thể gây hiểu sai:
- user đang xem snapshot lịch sử / frozen
- nhưng freshness card lại phản ánh live data hiện tại, không phải freshness của snapshot đó

Đây là vấn đề scope/context của UI.

### 7. Dashboard đang bám snapshot mới nhất, không bám snapshot đang chọn
`SupplyDashboard` hiện fetch stats cho `latestSnapshot = snapshots[0]`, không dùng snapshot mà user đang select.

Hệ quả:
- user chọn snapshot A để review
- nhưng dashboard vẫn hiển thị stats của snapshot mới nhất B
- rất dễ dẫn đến đọc sai số liệu

Đây là issue quan trọng vì Module 2 là module review-baseline trước DRP.

### 8. Archive mới có backend nhưng gần như chưa hoàn thiện ở product flow
Backend có `archiveSnapshot()` và endpoint archive.
Nhưng hiện tại:
- frontend chưa expose action archive
- không có `archived_at` / `archived_by` riêng
- code đang reuse `frozenBy` cho `archivedBy`
- không thấy retention job auto archive snapshots cũ

Kết quả là logic archive tồn tại nửa vời, không đủ audit và không đúng semantics.

### 9. Thiếu scheduled / automatic flow như spec mô tả
Spec mô tả các trigger:
- scheduled sau Bravo sync
- auto-trigger trước DRP nếu chưa có snapshot mới
- retention / archive theo thời gian

Nhưng trong code hiện chưa thấy:
- cron/scheduler cho supply snapshot
- retention job
- auto-capture orchestration sau import Bravo

Hiện tại product vẫn thiên về thao tác manual nhiều hơn là supply pipeline hoàn chỉnh.

### 10. Stale handling chưa có audit trail đúng mức
Hiện tại acknowledge stale chỉ update trực tiếp trên snapshot header:
- `stale_acknowledged`
- `stale_reason`
- `stale_acknowledged_by`
- `stale_acknowledged_at`

Nhưng spec/product direction nói đến stale action logging rõ ràng hơn.
Chưa thấy:
- bảng log riêng cho stale actions
- phân biệt action type: acknowledge / recapture / manual override
- lịch sử hành động đầy đủ để audit

Với một module làm baseline cho DRP, thiếu audit trail này là điểm yếu đáng chú ý.

### 11. Upload Bravo chưa có preview-before-commit như spec mong muốn
UI upload hiện hỗ trợ:
- chọn file
- upload luôn
- xem kết quả sau khi import

Nhưng chưa có bước preview mapped/unmapped rồi mới confirm import.
Vì vậy nếu file mapping sai:
- user chỉ biết sau khi dữ liệu đã được upsert vào `lot_attribute`
- chưa có lớp “review trước khi ghi”

### 12. Logic normalize item code từ Bravo còn rủi ro
`bravo.service.ts` có logic derive item code từ `bravo_sku`, nhưng việc strip suffix hiện khá heuristic.
Ví dụ code đang chỉ strip một suffix rất hẹp ở cuối chuỗi.
Nếu Bravo SKU có biến thể phức tạp hơn, rất dễ xảy ra:
- tách sai item base code
- không map được vào master item
- split stock sai giữa nhiều mã gần giống nhau

Vì inventory là dữ liệu nền, sai mapping ở đây sẽ tác động trực tiếp đến snapshot.

### 13. Model `in_transit_qty` chưa đủ giàu để hỗ trợ DRP đúng semantics
Module 2 chỉ lưu `in_transit_qty` ở mức scalar trên `supply_snapshot_line`.
Nhưng downstream DRP muốn xử lý scheduled receipts theo tuần hoặc theo ETA.

Hiện tại Module 4 đang phải giả định toàn bộ `in_transit_qty` về week 1.
Điều này tạo ra risk lớn:
- nếu không có ETA thật, scheduled receipt có thể bị đặt sai tuần
- netting sẽ quá lạc quan ở tuần đầu

Nói cách khác, output contract của Module 2 chưa đủ để mô hình hóa in-transit đúng chuẩn planning.

### 14. UI chưa làm rõ estimated lines ở level line / review grid
Estimated inventory là một business concept quan trọng của UNIS.
Nhưng hiện tại UI line table chưa làm rõ tốt:
- line nào là estimated
- filter theo estimated chưa rõ trong main review flow
- grouped/detail views chưa nhấn mạnh confidence thấp trên từng line

Planner rất khó review đúng nếu estimated inventory chỉ xuất hiện ở aggregate cards.

### 15. Thiếu auth guard / access control rõ ràng ở controller
Controller hiện không thấy auth/role guards.
Với module có thể:
- upload inventory
- freeze snapshot
- acknowledge stale
- override số tồn

thì việc chưa khóa permission rõ ràng là một rủi ro hệ thống.

### 16. STALE banner có thể acknowledge nhầm snapshot
Đây là bug orchestration khá nghiêm trọng ở `frontend/app/supply/page.tsx`.

UI đang hiển thị banner theo `latestDraft`:
- lấy snapshot DRAFT mới nhất trong list
- nếu snapshot này STALE thì hiện banner

Nhưng action acknowledge lại lấy target theo:
- `selectedSnapshotId ?? latestDraft?.id`

Điều này tạo ra case rất nguy hiểm:
- banner đang cảnh báo snapshot A
- nhưng user đang chọn snapshot B
- bấm acknowledge có thể update snapshot B thay vì A

Về mặt nghiệp vụ, đây là lỗi làm sai audit trail và sai planner intent.

### 17. Manual entry đang bypass page orchestration nên UI tổng thể không refresh đúng
Trong `BravoUploadDialog`, flow file upload đi qua parent `onUpload`, nên page có reload:
- `freshness`
- `snapshots`

Nhưng manual entry lại gọi thẳng `manualBravoEntry(...)` ở dialog, không đi qua parent page orchestration.
Kết quả sau khi nhập thủ công:
- `lot_attribute` đã thay đổi
- nhưng `FreshnessWidget` / KPI / snapshot list của page không được reload ngay
- user có thể nhìn thấy data cũ cho đến khi refresh tay

Đây là mismatch rõ giữa hai flow cùng mục tiêu cập nhật inventory source.

### 18. Manual entry chưa cho nhập `source_type`, làm mất khả năng tạo estimated inventory đúng nghĩa
Manual row model có field `source_type`, nhưng UI hiện không expose field này cho user.
Kết quả là manual entry gần như luôn rơi về default `OEM`.

Hệ quả:
- planner không thể nhập inventory kiểu `DISTRIBUTION`
- manual flow không thể tạo estimated source đúng business semantics
- ngay cả khi backend/supporting schema có field này, FE đang khóa mất khả năng dùng

Điểm này đặc biệt quan trọng vì spec xem OEM vs DISTRIBUTION là business signal cốt lõi.

### 19. Selection state của snapshot không ổn định sau các lần reload dữ liệu
`loadSnapshots()` trong `page.tsx` đang được `useCallback` với dependency bị suppress, nên nó giữ closure cũ của `selectedSnapshotId`.

Hệ quả thực tế:
- user chọn snapshot khác để review
- sau upload / capture / freeze và reload list
- page có thể tự nhảy về snapshot mới nhất hoặc snapshot theo state cũ ban đầu

Đây là bug UX/state quan trọng vì review snapshot trong Module 2 cần bám rất chặt context đang chọn.

### 20. Nút `Override thủ công` trên stale banner đang gây hiểu nhầm so với flow thực tế
Spec mô tả stale flow có lựa chọn manual override / manual inventory adjustment rõ ràng.
Nhưng hiện tại nút `Override thủ công` trên `StaleWarningBanner` chỉ làm:
- chuyển tab sang `detail`

Nó không:
- mở manual inventory entry
- mở line override dialog
- chỉ ra snapshot/line nào cần chỉnh

Vì vậy CTA này hiện mang tính hình thức, không thực sự dẫn user vào một workflow hoàn chỉnh.

### 21. UI coverage vẫn thiếu so với spec ở snapshot list/detail level
Theo spec, snapshot list nên làm rõ thêm:
- `Estimated Lines`
- `Frozen At`
- action `Archive`

Nhưng UI hiện tại chủ yếu mới có:
- `View`
- `Freeze`
- status/freshness badge cơ bản

Điều này làm cho một số capability đã có trong spec hoặc BE chưa thật sự xuất hiện đầy đủ ở user-facing workflow.

## What Works Well

### 1. Capture theo location đã có hỗ trợ thực tế
So với Demand module, Supply module đã tiến xa hơn ở điểm này:
- FE có chọn location checklist
- BE nhận `locationCodes`
- snapshot có thể scope theo location

Đây là hướng đúng cho nghiệp vụ planning.

### 2. Capture header + lines đã được bọc transaction
Phần tạo snapshot header và insert lines trong `captureSnapshot()` đã có transaction.
Điểm này tốt và giảm rủi ro orphan snapshot.

### 3. DRP đã có stale gate và đọc `override_qty`
Ở downstream, DRP đã:
- chặn snapshot chưa freeze
- chặn snapshot STALE chưa acknowledge
- dùng `override_qty` nếu có

Đây là integration point đúng hướng.

## Business Impact

### Impact to planners
- Có thể bị hiểu nhầm về snapshot nào đang được xem trên dashboard/KPI
- Có thể acknowledge nhầm snapshot do stale banner không bám đúng target action
- Có thể override thành công nhưng UI chưa phản ánh rõ
- Sau manual entry vẫn có thể thấy freshness / summary cũ cho đến khi refresh lại
- Không nhìn rõ estimated inventory ở line-level
- Khó audit vì snapshot frozen vẫn bị sửa trực tiếp

### Impact to DRP
- `is_estimated` sai → confidence của plan run sai
- `in_transit_qty` không có ETA → scheduled receipt dễ bị đặt sai tuần
- snapshot summary có thể lệch với actual line data sau override
- reproducibility của plan run suy giảm nếu frozen snapshot tiếp tục bị chỉnh trực tiếp

## Recommendation Notes for Dev Team

### Priority P0
- Sửa flow capture để propagate đúng `source_type` → `is_estimated`
- Tính đúng `estimated_lines_count`
- Rà soát toàn bộ contract Module 2 → Module 4 cho `is_estimated`

### Priority P0
- Chốt lại policy của `FROZEN` snapshot:
  - hoặc thật sự immutable
  - hoặc cho phép điều chỉnh nhưng phải qua workflow/audit khác rõ ràng

### Priority P0
- Đồng bộ UI summary với actual planning input sau override
- Sau override phải refresh line table, grouped views, stats và các summary liên quan

### Priority P1
- Tách bạch rõ snapshot freshness vs live lot freshness trên UI
- Dashboard phải bám snapshot đang chọn, không chỉ snapshot mới nhất
- Giữ ổn định selected snapshot sau các action reload dữ liệu
- Sửa stale banner để action luôn bám đúng snapshot đang được cảnh báo

### Priority P1
- Hoàn thiện archive semantics:
  - có action ở FE
  - có `archived_at` / `archived_by`
  - không reuse `frozenBy`
  - có retention job nếu product yêu cầu

### Priority P1
- Cải thiện Bravo import review flow: preview mapped/unmapped trước khi commit
- Rà soát logic normalize item code từ Bravo để tránh split/mis-map stock
- Đồng bộ orchestration giữa file upload và manual entry để cả hai cùng refresh page state đúng cách
- Nếu giữ manual entry, cần expose `source_type` hoặc quy định rõ manual flow không hỗ trợ estimated inventory

### Priority P2
- Làm rõ estimated lines ở line-level UI
- Bổ sung filter/review tốt hơn cho estimated inventory
- Sửa CTA `Override thủ công` trên stale banner để đi vào workflow thực sự dùng được
- Rà soát auth guards / role-based access cho các action nhạy cảm

## Suggested Product Direction
Một hướng ổn định hơn cho Module 2 là:

1. Bravo import → validate/mapping preview
2. Upsert `lot_attribute`
3. Capture snapshot có carry-forward đầy đủ các confidence flags
4. Planner review snapshot đúng scope đang chọn
5. Freeze snapshot theo semantics rõ ràng
6. Nếu cần chỉnh sau freeze thì tạo revision / derived snapshot / audited adjustment flow
7. DRP chỉ đọc từ snapshot có contract ổn định và reproducible

## Verdict
Module 2 có nền móng tốt và đã gần hơn một planning module thực thụ so với Module 1.
Tuy nhiên hiện còn 4 rủi ro rất lớn cần ưu tiên cao:
- `is_estimated` đang bị mất trong snapshot
- semantics của `FROZEN` chưa chặt
- UI đang lệch scope giữa live data và selected snapshot
- contract `in_transit` cho DRP còn quá đơn giản

Ngoài ra, review FE chi tiết còn cho thấy một nhóm vấn đề orchestration đáng chú ý:
- stale banner có thể action sai snapshot
- manual entry và file upload không đồng bộ về refresh state
- selected snapshot context chưa được giữ ổn định sau reload

Nếu chưa xử lý các điểm này, Module 2 vẫn có thể chạy được về mặt chức năng, nhưng chưa đủ an toàn để làm inventory baseline đáng tin cậy cho DRP ở production.

---

Prepared for dev review only. No code changes applied in this feedback.
