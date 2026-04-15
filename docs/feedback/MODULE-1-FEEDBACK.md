# Module 1 Feedback — Demand

## Scope
Review logic của Module 1: Demand Snapshot / Upload / Freeze / Override / khả năng dùng downstream cho Policy và DRP.

## Overall Assessment
Module 1 đã có khung chức năng cơ bản:
- Tạo snapshot DRAFT
- Upload CSV vào snapshot mới hoặc DRAFT hiện có
- Freeze snapshot
- Override forecast ở mức dòng
- Export / history / analytics cơ bản

Tuy nhiên hiện tại module này vẫn còn một số vấn đề logic quan trọng, đặc biệt ở phần snapshot strategy và dữ liệu đầu ra cho module downstream.

## Key Findings

### 1. Snapshot logic hiện tại là “all-in”, chưa hỗ trợ scoped snapshot
Hiện tại snapshot demand đang được tạo theo kiểu import toàn bộ dữ liệu CSV vào một snapshot duy nhất.

Hệ thống chưa có cơ chế tạo snapshot thủ công theo phạm vi nghiệp vụ như:
- theo kho / branch / location
- theo item code / nhóm item
- theo segment
- theo khoảng thời gian cụ thể để cắt snapshot con

Điều này làm cho planner không thể tạo các snapshot chuyên biệt cho từng vùng hoặc từng tập SKU để review / freeze / chạy DRP riêng.

### 2. Create Snapshot hiện chỉ tạo “vỏ snapshot”, chưa hỗ trợ logic chọn phạm vi dữ liệu
`CreateSnapshotDto` hiện chỉ lưu metadata như:
- `snapshotName`
- `horizonStart`
- `horizonEnd`
- `createdBy`
- `notes`

Nhưng các field này không tham gia vào việc chọn dữ liệu cho snapshot.
Nói cách khác, “manual snapshot” hiện chỉ là DRAFT rỗng, không phải snapshot có logic scope theo business filter.

### 3. Thiếu workflow “slice snapshot” từ snapshot master
Sau khi upload full demand, hệ thống chưa có endpoint hoặc UI để:
- clone từ snapshot nguồn
- lọc theo location / item / segment / horizon
- tạo snapshot con phục vụ từng planner/team

Đây là gap đáng chú ý trong quy trình thực tế.

### 4. Upload CSV chưa có cơ chế filter-on-upload
Upload hiện hỗ trợ:
- tạo snapshot mới
- upload vào DRAFT có sẵn

Nhưng không hỗ trợ filter dữ liệu ngay khi import theo:
- location
- item code
- segment
- period range

Kết quả là dữ liệu sau upload luôn là full-set.

### 5. Dữ liệu `demand_forecast_detail` chưa được populate trong flow upload
Đây là vấn đề ảnh hưởng downstream.

Flow upload hiện bulk insert vào `demand_snapshot_line`, nhưng chưa thấy populate đầy đủ sang `demand_forecast_detail`.
Trong khi đó Module 3 Policy đang dùng `demand_forecast_detail` để tính:
- ADU
- internal ABC ranking
- các metric nền cho safety stock

Nếu bảng này không được ghi đúng theo snapshot, các module sau có thể tính sai.

### 6. CSV parsing hiện còn thô
Logic parse hiện dùng split bằng dấu phẩy ở mức dòng.
Cách này có rủi ro cao nếu CSV có field chứa dấu phẩy trong text hoặc format phức tạp hơn.
Điều này có thể gây lệch cột và import sai dữ liệu.

### 7. Delete snapshot chưa thấy transaction bao quanh toàn bộ cascade logic
Việc xóa snapshot đang gồm nhiều bước xóa con trước rồi mới xóa cha.
Nếu fail giữa chừng thì có rủi ro để lại trạng thái dữ liệu dở dang.

### 8. FE chưa phản ánh rõ lỗi khi freeze / delete / archive
Ở phía UI, các action chính vẫn thiếu error handling rõ ràng cho user.
Nếu BE trả lỗi thì trải nghiệm hiện tại chưa đủ minh bạch.

### 9. Export / coverage còn có nguy cơ lệch scope so với snapshot đang chọn
Một số hành vi FE hiện tại chưa bám chặt snapshot context đang active.
Điều này dễ gây hiểu nhầm khi user nghĩ mình đang xem dữ liệu của một snapshot cụ thể.

## Business Impact

### Impact to planners
- Không thể làm việc theo vùng / kho / nhóm item
- Không thể tạo snapshot con để review thủ công
- Snapshot đang quá lớn và mang tính “national all-in”

### Impact to downstream modules
- Policy có nguy cơ tính sai nếu thiếu `demand_forecast_detail`
- DRP phụ thuộc vào snapshot đã freeze, nên nếu snapshot không được chia scope hợp lý thì planner khó vận hành theo từng luồng nghiệp vụ

## Recommendation Notes for Dev Team

### Priority P0
- Rà soát lại flow upload để đảm bảo dữ liệu cần thiết được persist đầy đủ cho downstream, đặc biệt là `demand_forecast_detail`
- Xem lại chiến lược snapshot: hiện tại mới chỉ hỗ trợ full snapshot, chưa hỗ trợ scoped snapshot

### Priority P1
- Bổ sung một trong hai hướng:
  - filter-on-upload
  - slice snapshot từ snapshot nguồn

### Priority P1
- Cải thiện parser CSV để tránh lỗi với quoted fields
- Bao transaction cho delete cascade

### Priority P2
- Cải thiện FE error handling cho freeze / delete / archive
- Làm rõ UI state theo snapshot đang chọn

## Suggested Product Direction
Nếu nghiệp vụ thực tế cần planner làm việc theo từng kho / vùng / nhóm hàng, thì module Demand nên hỗ trợ một workflow như sau:

1. Upload full demand làm snapshot master
2. Từ snapshot master, tạo snapshot con theo filter nghiệp vụ
3. Planner review / override / freeze trên snapshot con
4. Module downstream chạy trên snapshot đã được scope đúng

## Verdict
Module 1 chạy được ở mức nền tảng, nhưng logic snapshot hiện tại còn thiên về ingest toàn cục hơn là hỗ trợ planning workflow thực tế.

Điểm cần lưu ý lớn nhất:
- snapshot đang all-in
- chưa có scoped snapshot
- downstream data contract cần được rà soát kỹ

---

Prepared for dev review only. No code changes applied in this feedback.
