# Module 4 — DRP Netting Engine
## Báo cáo Triển khai & Nghiệm thu

**Dự án:** UNIS Supply Chain Planning System (TerraX Demo)
**Module:** 4 — Distribution Requirements Planning (DRP) Netting
**Phiên bản báo cáo:** 1.0
**Ngày hoàn tất:** 2026-04-14
**Người lập báo cáo:** Tech Lead / AI Architect

---

## 1. Tổng quan Module

Module 4 là **trung tâm tính toán** của toàn bộ hệ thống Supply Chain Planning. Sau khi dữ liệu nhu cầu (Module 1) và tồn kho (Module 2) đã được đóng băng (FROZEN), Module 4 thực hiện thuật toán **DRP Netting** để tính ra:

- **Cần đặt hàng bao nhiêu** (Planned Order Qty) cho từng mặt hàng, từng chi nhánh, từng tuần
- **Tuần nào có rủi ro** thiếu hàng hoặc tồn kho quá mức
- **Lệnh nào cần phê duyệt** trước khi phát hành (frozen zone)

Kết quả của Module 4 là đầu vào trực tiếp cho **Module 5 (Allocation)** và là cơ sở để Planner ra quyết định đặt hàng.

---

## 2. Phạm vi triển khai

### 2.1 Những gì đã hoàn thành

| Hạng mục | Chi tiết | Trạng thái |
|----------|----------|------------|
| Thuật toán DRP Netting | PAB formula, L4L lot sizing, 12 tuần horizon | ✅ Hoàn tất |
| Xử lý Safety Stock | Đọc từ ACTIVE Policy Run (Module 3) | ✅ Hoàn tất |
| Frozen Zone logic | Tuần 1-2: NEEDS_APPROVAL, Tuần 3-12: AUTO_RELEASE | ✅ Hoàn tất |
| Exception Engine | 6 loại exception, phân loại HIGH/MEDIUM/LOW | ✅ Hoàn tất |
| HSTK Analysis | Stockout < 1.5 tuần, Overstock > 3.0 tuần | ✅ Hoàn tất |
| API Backend | 10 endpoints đầy đủ | ✅ Hoàn tất |
| Giao diện Frontend | 4 tabs: Runs / Orders / Exceptions / Netting Grid | ✅ Hoàn tất |
| E2E Test | 7 bước kiểm thử, toàn bộ PASS | ✅ Hoàn tất |

### 2.2 Những gì nằm ngoài phạm vi Phase 1

| Hạng mục | Lý do defer | Kế hoạch |
|----------|-------------|----------|
| Tích hợp Demand Forecast API | API service chưa sẵn sàng | Phase 2 |
| Multi-echelon DRP (phân phối nhiều tầng) | Ngoài scope TerraX demo | Backlog |
| Auto re-run khi snapshot thay đổi | Cần event-driven architecture | Phase 3 |

---

## 3. Quy trình nghiệp vụ

### 3.1 Luồng chính

```
Planner chọn:
  ├─ Demand Snapshot (FROZEN)   ← Module 1
  └─ Supply Snapshot (FROZEN)   ← Module 2
            │
            ▼
    Hệ thống kiểm tra:
    • Cả 2 snapshot đã FROZEN chưa?
    • Tồn kho có bị STALE và chưa xác nhận không?
    • Đã có Plan Run cho cặp snapshot này chưa? (tránh chạy trùng)
            │
            ▼
    DRP Netting chạy ngầm (~36 giây cho 8,109 combo)
            │
            ▼
    Kết quả:
    ├─ 97,308 Planned Order rows (12 tuần × 8,109 SKU×Location)
    ├─ Exception list (cảnh báo cần xử lý)
    └─ HSTK summary (tỷ lệ stockout / overstock)
```

### 3.2 Công thức tính toán cốt lõi

Hệ thống sử dụng phương pháp **Lot-for-Lot (L4L)** — đặt đúng bằng lượng thiếu, không dư:

```
PAB(t) = PAB(t-1) + Hàng đang về(t) - Nhu cầu(t)
Nếu PAB < Safety Stock → Cần đặt thêm = Safety Stock - PAB
Lệnh đặt hàng = Lượng cần đặt thêm (L4L)
```

Ưu điểm L4L cho UNIS (phân phối): không bị tồn dư do lô hàng lớn, phản ánh đúng nhu cầu thực.

---

## 4. Kết quả kiểm thử E2E

Kiểm thử trên môi trường `localhost:3002` với dữ liệu thực của UNIS.

### 4.1 Thông số Plan Run #1

| Chỉ số | Kết quả |
|--------|---------|
| Demand Snapshot | DRP Forecast Q1-2026 Full (FROZEN) |
| Supply Snapshot | SS-2026-04-14 Clean (ID: 16, FROZEN) |
| Số SKU × Location (combos) | 8,109 |
| Số Planned Order rows | 97,308 (12 tuần × 8,109 combos) |
| Thời gian xử lý | 36.1 giây |
| Trạng thái | COMPLETED ✅ |

### 4.2 Kết quả kiểm thử từng bước

| Bước | Nội dung kiểm tra | Kết quả mong đợi | Thực tế | Đánh giá |
|------|-------------------|-----------------|---------|----------|
| 1 | Tạo Plan Run trùng lặp | 409 Conflict | 409 ✅ | **PASS** |
| 2 | Danh sách Plan Runs | status=COMPLETED, đủ số liệu | Chính xác ✅ | **PASS** |
| 3 | Chi tiết Plan Run | Exception breakdown | MISSING_SS:626, FROZEN:203 | **PASS** |
| 4 | Planned Orders | 203 lệnh NEEDS_APPROVAL, logic PAB đúng | Chính xác ✅ | **PASS** |
| 5 | Netting Detail | 12 tuần đầy đủ, tồn đầu kỳ đúng | Chính xác ✅ | **PASS** |
| 6 | Exception list | Sort HIGH → MEDIUM → LOW | Đúng thứ tự ✅ | **PASS** |
| 7 | HSTK Summary | Tỷ lệ stockout/overstock | stockout:0%, ok:100% ✅ | **PASS** |

**Tổng kết: 7/7 PASS ✅**

### 4.3 Phân tích Exception

Tổng: **829 exceptions** trong Plan Run #1.

| Loại Exception | Số lượng | Mức độ | Ý nghĩa |
|----------------|----------|--------|---------|
| MISSING_SS | 626 | MEDIUM | 626 combos không có Safety Stock trong ACTIVE Policy Run |
| FROZEN_ZONE_VIOLATION | 203 | MEDIUM | 203 lệnh đặt hàng rơi vào tuần 1-2 (frozen zone), cần Planner phê duyệt |
| STOCKOUT_ALERT | 0 | HIGH | Không có combo nào bị thiếu hàng |
| OVERSTOCK_ALERT | 0 | LOW | Không có combo nào tồn kho quá mức |
| PAB_NEGATIVE | 0 | HIGH | Không có trường hợp tồn kho âm |

---

## 5. Điểm cần lưu ý sau triển khai

### 5.1 Vấn đề cần theo dõi — MISSING_SS (626 combos)

**Tình trạng:** 626 trong số 8,109 combos không có Safety Stock trong Policy Run hiện tại (Module 3). Hệ thống xử lý bằng cách dùng SS=0 và ghi nhận exception MISSING_SS.

**Tác động thực tế:** Các items này không có safety buffer — nếu nhu cầu biến động, hệ thống sẽ không cảnh báo sớm.

**Hành động đề xuất:** DA hoặc Planner chạy lại Policy Run để tính đủ SS cho toàn bộ 8,109 combos.

### 5.2 Tồn đọng từ các module trước (chưa xử lý)

| Người thực hiện | Hành động cần làm | Từ module |
|----------------|-------------------|-----------|
| DA | `UPDATE policy_run SET status='ACTIVE' WHERE id=2` | Module 3 |
| DA | Freeze supply_snapshot id=16, archive id=10-15 | Module 2 |
| DA | ALTER TABLE VARCHAR lengths (lot_attribute, supply_snapshot_line) | Module 2 |
| UNIS IT | Cập nhật item master: 1,306 Bravo SKUs chưa map | Module 2 |

---

## 6. Các cải tiến kỹ thuật đáng chú ý

Trong quá trình triển khai, team đã phát hiện và xử lý các vấn đề kỹ thuật sau:

| Vấn đề | Giải pháp | Tác động |
|--------|-----------|---------|
| N+1 query problem (8,109 combos × 12 tuần) | Pre-load toàn bộ data vào Maps trước, zero DB query trong vòng lặp | Giảm từ ~97K queries xuống 3 queries |
| reconciled_qty bị bỏ sót | Dùng `COALESCE(reconciled_qty, qty)` — ưu tiên số liệu Planner đã override | Đảm bảo accuracy khi Planner điều chỉnh forecast |
| stale_acknowledged kiểm tra sai nguồn | Đọc từ DB (Module 2 đã set) thay vì từ request body | Đúng business rule: Module 2 là nơi acknowledge |
| Exception sort không hoạt động | Sort in-memory thay vì ORDER BY CASE trong SQL | HIGH luôn hiện trước MEDIUM trước LOW |

---

## 7. Giao diện người dùng

Module 4 Frontend có **4 tabs**:

| Tab | Chức năng |
|-----|-----------|
| **Plan Runs** | Danh sách các lần chạy DRP, trạng thái, số liệu tổng hợp. Auto-refresh khi đang RUNNING. |
| **Planned Orders** | Bảng lệnh đặt hàng với filter (item, location, tuần, status). Approve / Cancel từng lệnh. |
| **Exceptions** | Danh sách cảnh báo, phân loại theo mức độ. Resolve exception với ghi chú. |
| **Netting Grid** | Bảng 12 tuần chi tiết cho 1 SKU × Location: tồn kho, nhu cầu, lệnh đặt hàng. |

---

## 8. Phụ thuộc & Tích hợp

```
Module 1 (Demand Snapshot)  ──┐
                               ├──► Module 4 (DRP Netting) ──► Module 5 (Allocation)
Module 2 (Supply Snapshot)  ──┘         ▲
                                         │
Module 3 (Safety Stock Policy) ──────────┘
```

Module 4 **đọc** từ Module 1, 2, 3. **Không ghi** ngược lại các module trước. Kết quả của Module 4 là input cho Module 5.

---

## 9. Định nghĩa thuật ngữ

| Thuật ngữ | Giải thích |
|-----------|------------|
| PAB (Projected Available Balance) | Tồn kho dự kiến cuối tuần, sau khi trừ nhu cầu và cộng hàng về |
| GR (Gross Requirement) | Tổng nhu cầu trong tuần (từ demand snapshot) |
| SR (Scheduled Receipt) | Hàng đang trên đường về, dự kiến nhận trong tuần |
| NR (Net Requirement) | Lượng còn thiếu so với safety stock |
| PO (Planned Order Qty) | Lượng cần đặt hàng (= NR theo L4L) |
| SS (Safety Stock) | Mức tồn kho tối thiểu cần duy trì |
| HSTK | Tuần tồn kho = PAB / nhu cầu trung bình — đo lường rủi ro stockout/overstock |
| Frozen Zone | Tuần 1-2: lệnh đặt hàng cần Planner phê duyệt trước khi phát hành |
| L4L (Lot-for-Lot) | Phương pháp lô hàng: đặt đúng bằng lượng thiếu, không đặt dư |

---

*Báo cáo này phản ánh trạng thái hệ thống tại ngày 2026-04-14. Mọi thay đổi sau ngày này cần được cập nhật vào phiên bản báo cáo tiếp theo.*
