# Module Spec — Step 7: Execution Bridge

> **CN Approval + Bravo ERP Integration** — Tạo draft orders từ transport trips,
> CN duyệt, đẩy Bravo ERP qua SFTP batch CSV
> Module phức tạp nhất: state machine + approval workflow + ERP saga

> ⚠️ **UNIS Implementation Notes — đọc trước khi code:**
> - **No `tenant_id`:** Bỏ khỏi `draft_order`, `erp_posting_log` và tất cả SQL (`D-MD-03`)
> - **Item PK:** `item_code VARCHAR` (`D-MD-01`) | **Location PK:** `location_code VARCHAR` (`D-MD-02`)
> - **State machine Phase 1-3:** 6 states (DRAFT→SUBMITTED→CN_APPROVED→MGR_APPROVED→POSTED/REJECTED). 7-state SFTP workflow là Phase 4.
> - **REJECTION_FINAL = false:** CN có thể re-submit sau khi bị reject (EX-005, unlimited)
> - **POST_APPROVAL_EDIT = true:** Sửa qty sau approve → reset về PENDING_APPROVAL (EX-003)
> - **Bravo SFTP:** Phase 4. Phase 1-3: export CSV thủ công, không auto-push

---

## 0. BA Summary

### 0.1 Mô tả nghiệp vụ (Dành cho Business Stakeholder)

Transport plan đã confirm. Bây giờ cần **tạo đơn hàng chính thức** và gửi lên Bravo ERP
để kho thực sự xuất hàng. Nhưng trước đó, **CN (Chi nhánh) phải duyệt**.

Quy trình:
```
Hệ thống tự tạo draft orders từ các chuyến xe
  → CN_WH xem đơn, có thể sửa giảm số lượng nếu thực tế kho không cần nhiều
  → CN_WH duyệt → SC Manager duyệt lần cuối
  → Hệ thống export CSV → gửi Bravo ERP (Phase 4: tự động qua SFTP)
```

> **Tại sao CN phải duyệt?** CN là người trực tiếp quản lý kho chi nhánh, biết rõ thực tế
> hơn hệ thống (VD: khách hủy đơn lớn, kho đang sửa chữa). CN có quyền giảm qty nhưng
> **không được tăng** (vì allocation đã tính max từ kho nguồn).

**Người dùng chính:** CN_WH (người duyệt tại chi nhánh) + SC Manager

| Vai trò | Làm gì trong module này |
|---------|------------------------|
| **CN_WH** | Xem danh sách đơn chờ duyệt, điều chỉnh qty (giảm only), duyệt hoặc từ chối |
| **SC Manager** | Duyệt lần 2 (MGR_APPROVED) → đơn được phép post lên ERP |
| **Kế hoạch viên** | Xem trạng thái đơn, re-submit nếu bị từ chối |
| **Bravo ERP** | Nhận file CSV từ SCP → xử lý xuất kho (Phase 4) |

---

### 0.2 User Stories

| # | User Story | Điều kiện done |
|---|-----------|----------------|
| US-01 | **Là CN_WH**, tôi muốn **xem danh sách đơn hàng cần duyệt của chi nhánh tôi** để không bỏ sót | Danh sách filtered theo branch, badge đếm số đơn pending |
| US-02 | **Là CN_WH**, tôi muốn **giảm số lượng trong đơn** nếu chi nhánh không cần nhiều vậy | Có thể sửa qty_adjusted ≤ qty_original, bắt buộc nhập lý do |
| US-03 | **Là CN_WH**, tôi muốn **từ chối đơn** kèm lý do nếu không phù hợp | Đơn chuyển sang REJECTED, hệ thống thông báo Kế hoạch viên |
| US-04 | **Là Kế hoạch viên**, tôi muốn **re-submit đơn bị từ chối** sau khi đã điều chỉnh | Đơn quay về PENDING_APPROVAL, CN review lại (không giới hạn số lần) |
| US-05 | **Là SC Manager**, tôi muốn **duyệt lần cuối** danh sách đơn đã qua CN để approve chính thức | Đơn → MGR_APPROVED → hệ thống export CSV cho Bravo |
| US-06 | **Là Kế hoạch viên**, tôi muốn **xem lịch sử duyệt** của từng đơn (ai sửa, ai duyệt, khi nào) để audit | Approval log: timeline với actor, action, before/after qty |

---

### 0.3 Kịch bản nghiệp vụ

#### ✅ Kịch bản 1 — Duyệt đơn thành công (Happy Path)

```
1. Transport plan confirmed → hệ thống tự tạo 45 draft orders
2. CN_WH Hà Nội đăng nhập → thấy 8 đơn chờ duyệt (badge đỏ "8")
3. Click vào đơn #001: "500 thùng GACH-60x60-A4, giao 15/04"
4. CN_WH thấy hợp lý → bấm "Duyệt" → đơn → CN_APPROVED
5. SC Manager duyệt batch cuối ngày → 45 đơn → MGR_APPROVED
6. Hệ thống export CSV → (Phase 1-3: Kế hoạch viên download, gửi email Bravo)
```

#### ❌ Kịch bản 2 — CN từ chối, Kế hoạch viên re-submit (Sad Path)

```
1. CN_WH Đà Nẵng xem đơn: "300 thùng GACH-80x80-B2, giao 16/04"
2. CN từ chối: "Kho đang sửa chữa, không nhận hàng ngày 16/04, nhập lý do"
3. Đơn → REJECTED, Kế hoạch viên nhận thông báo
4. Kế hoạch viên điều chỉnh: đổi ngày giao 18/04
5. Re-submit → đơn quay về PENDING_APPROVAL
6. CN_WH Đà Nẵng duyệt lần 2 → CN_APPROVED
```

#### ⚠️ Kịch bản 3 — CN sửa giảm số lượng (Sad Path)

```
1. Đơn: "200 thùng GACH-60x60-A4"
2. CN_WH xem: kho hiện đang có 180 thùng từ đơn cũ chưa bán hết
3. CN sửa: 200 → 100 thùng, lý do "Tồn kho thực tế đang cao"
4. Duyệt → đơn với qty_adjusted = 100 (qty_original giữ nguyên = 200)
5. Hệ thống ghi log: ai sửa, bao giờ, từ bao nhiêu → bao nhiêu
```

---

### 0.4 Thuật ngữ

| Thuật ngữ | Giải thích dễ hiểu |
|-----------|-------------------|
| **Draft Order** | Đơn hàng nháp — do hệ thống tạo tự động từ kế hoạch vận chuyển |
| **CN_WH** | Người quản lý kho tại chi nhánh — người duyệt đơn đầu tiên |
| **PENDING_APPROVAL** | Đơn đang chờ CN duyệt |
| **CN_APPROVED** | CN đã duyệt, đang chờ SC Manager duyệt lần 2 |
| **REJECTED** | CN từ chối đơn — Kế hoạch viên cần xử lý và re-submit |
| **MGR_APPROVED / POSTED** | SC Manager đã duyệt — đơn sẵn sàng gửi lên Bravo ERP |
| **qty_original / qty_adjusted** | Qty gốc từ hệ thống / Qty sau khi CN điều chỉnh (chỉ giảm được) |

---

## 1. Purpose

Execution Bridge là cầu nối giữa hệ thống planning (Step 1-6) và thực thi (ERP + kho).
Module này:

1. **Tạo draft orders** từ transport_plan_trip (Step 6)
2. **CN approval workflow** — CN bắt buộc duyệt MỌI đơn, có thể sửa qty trước duyệt
3. **Bravo ERP posting** — xuất CSV qua SFTP (Bravo không có API)
4. **State machine** — theo dõi trạng thái đơn từ DRAFT → CONFIRMED

**Tại sao phức tạp nhất?**
- State machine có 7 states + transitions
- Approval workflow: CN có quyền sửa qty TRƯỚC khi duyệt (FR29)
- ERP integration qua SFTP (batch, không real-time) → cần saga pattern
- Compensation logic nếu SFTP fail

---

## 2. UNIS Context

| Dimension | UNIS Value | Giải thích |
|---|---|---|
| Approval chain | ["CN_WH"] | CN kho duyệt mọi đơn, không auto-pass |
| Pre-approval edit | **Allowed** (FR29) | CN sửa qty trước khi duyệt |
| Post-approval edit | **Allowed + Re-approve** | Sửa qty sau duyệt → status reset PENDING_APPROVAL |
| ERP system | Bravo | SFTP batch CSV upload |
| ERP protocol | SFTP | Không có REST API |
| PO overdue | 10 ngày | Dài hơn MDLZ (7 ngày) — building materials |
| Batch frequency | Daily | Collect approved orders → batch CSV → SFTP |

**So sánh với MDLZ:**
- MDLZ: auto-pass cho một số loại đơn → UNIS: CN duyệt MỌI đơn
- MDLZ: SAP API real-time → UNIS: Bravo SFTP batch
- MDLZ: PO overdue 7 ngày → UNIS: 10 ngày (lead time dài hơn)
- MDLZ: post_approval_edit có thể true → UNIS: Allowed + re-approve required

---

## 3. Input

### 3.1 Primary Input — Transport Plan Trips (from Step 6)

```
Source: transport_plan_trip table
Filter: transport_plan.status = CONFIRMED
```

| Field | Type | Description |
|---|---|---|
| trip_id | UUID | PK |
| source_location_id | UUID | Kho xuất |
| dest_location_id | UUID | CN nhận |
| vehicle_type | ENUM | FLATBED, CRANE_TRUCK |
| carrier_id | UUID | Nhà vận chuyển |
| departure_date | DATE | Ngày xuất phát |
| eta | DATE | Ngày dự kiến đến |

### 3.2 Allocation Results (from Step 5)

```
Source: allocation_result table (via trip_line → allocation_result)
```

| Field | Type | Description |
|---|---|---|
| allocation_result_id | UUID | PK |
| lot_id | UUID | Lot cụ thể |
| sku_id | UUID | SKU |
| qty_allocated | DECIMAL(15,2) | Số lượng |
| specs_id | VARCHAR | Variant code |

### 3.3 User Input — Approval

| Field | Type | Description |
|---|---|---|
| approved_by | UUID | CN_WH user |
| decision | ENUM | APPROVED, REJECTED |
| adjusted_lines | ARRAY | Lines CN sửa qty (FR29) |
| reject_reason | VARCHAR | Lý do reject (nếu reject) |

---

## 4. Processing Logic

### 4.1 State Machine

```
                    ┌──────────┐
                    │  DRAFT   │  ← Hệ thống tạo từ transport trip
                    └────┬─────┘
                         │ submit_for_approval()
                         ▼
                    ┌──────────────────┐
                    │ PENDING_APPROVAL │  ← CN_WH review + có thể sửa qty
                    └────┬────────┬────┘
                         │        │
                 approve()│        │ reject()
                         ▼        ▼
                    ┌─────────┐  ┌──────────┐
                    │ APPROVED│  │ REJECTED │  ← CN reject → có thể re-submit
                    └────┬────┘  └────┬─────┘
                         │            │ re_submit() (optional)
                         │            └──→ PENDING_APPROVAL
                         │
                    post_erp()
                         ▼
                    ┌─────────┐
                    │ POSTING │  ← Đang chuẩn bị CSV
                    └────┬────┘
                         │ collect_batch()
                         ▼
                    ┌─────────┐
                    │ STAGED  │  ← CSV ready, chờ SFTP upload
                    └────┬────┘
                         │ sftp_upload()
                         ▼
                    ┌─────────┐
                    │ POSTED  │  ← CSV đã upload lên Bravo SFTP
                    └────┬────┘
                         │ bravo_confirm() (manual or auto-check)
                         ▼
                    ┌───────────┐
                    │ CONFIRMED │  ← Bravo đã xử lý, đơn hoàn tất
                    └───────────┘
```

### State Transition Rules

| From | To | Trigger | Actor | Conditions |
|---|---|---|---|---|
| DRAFT | PENDING_APPROVAL | Auto after creation | System | Trip confirmed |
| PENDING_APPROVAL | APPROVED | CN approves | CN_WH | qty_adjusted ≤ qty_original |
| PENDING_APPROVAL | REJECTED | CN rejects | CN_WH | reject_reason required |
| REJECTED | PENDING_APPROVAL | Re-submit | Planner/System | qty may be re-adjusted |
| APPROVED | POSTING | Auto/scheduled | System | Daily batch trigger |
| POSTING | STAGED | Batch collected | System | CSV generated |
| STAGED | POSTED | SFTP upload success | System | File delivered |
| POSTED | CONFIRMED | Bravo processes | System/Manual | ERP acknowledgement |

### 4.2 Draft Order Creation

```python
def create_draft_orders(transport_plan):
    for trip in transport_plan.trips:
        order = DraftOrder(
            trip_id=trip.trip_id,
            source_location_id=trip.source_location_id,
            dest_location_id=trip.dest_location_id,
            departure_date=trip.departure_date,
            eta=trip.eta,
            status="DRAFT"
        )

        for trip_line in trip.lines:
            order_line = DraftOrderLine(
                sku_id=trip_line.sku_id,
                lot_id=trip_line.lot_id,
                specs_id=trip_line.specs_id,
                qty_original=trip_line.qty,
                qty_adjusted=trip_line.qty,  # CN có thể sửa sau
                unit="THUNG"  # đơn vị tính UNIS
            )
            order.lines.append(order_line)

        order.status = "PENDING_APPROVAL"
        emit_event("order.pending_approval", order)
```

### 4.3 CN Approval Workflow (FR29)

```python
# FR29: CN có thể sửa qty TRƯỚC khi duyệt
def cn_edit_line(order_id, line_id, new_qty, user):
    assert order.status == "PENDING_APPROVAL"
    assert user.role == "CN_WH"
    assert new_qty <= line.qty_original  # chỉ giảm, không tăng
    assert new_qty >= 0

    line.qty_adjusted = new_qty
    line.adjusted_by = user.id
    line.adjusted_at = now()
    line.adjust_reason = "required"  # CN phải ghi lý do

    # Log adjustment for Step 8 (override tracking)
    log_adjustment(order_id, line_id, line.qty_original, new_qty, user)


def cn_approve(order_id, user):
    assert order.status == "PENDING_APPROVAL"
    assert user.role == "CN_WH"

    order.status = "APPROVED"
    order.approved_by = user.id
    order.approved_at = now()

    # Post-approval edit: ALLOWED but requires re-approval
    # If planner edits qty after CN approved:
    #   1. order.status resets to PENDING_APPROVAL
    #   2. CN must re-approve
    #   3. AdjustmentReport logged with old_qty, new_qty, reason

    emit_event("order.approved", order)


def cn_reject(order_id, user, reason):
    assert order.status == "PENDING_APPROVAL"
    assert user.role == "CN_WH"
    assert reason is not None  # bắt buộc ghi lý do

    order.status = "REJECTED"
    order.rejected_by = user.id
    order.rejected_at = now()
    order.reject_reason = reason

    emit_event("order.rejected", order)
```

**Re-submit flow:** Planner có thể re-submit order bị reject. Order quay lại
PENDING_APPROVAL, CN review lại. Không giới hạn số lần re-submit.

### 4.4 Bravo ERP Integration (SFTP Batch CSV)

```python
# Daily batch process: collect approved orders → generate CSV → SFTP upload

def post_erp_batch():
    """Chạy daily (scheduled Celery task)"""

    # Step 1: Collect approved orders
    approved_orders = DraftOrder.filter(status="APPROVED")
    for order in approved_orders:
        order.status = "POSTING"

    # Step 2: Generate CSV
    csv_rows = []
    for order in approved_orders:
        for line in order.lines:
            csv_rows.append({
                "LOAI_CHUNG_TU": "PXK",         # Phiếu xuất kho
                "MA_HANG": line.sku_code,         # Mã hàng Bravo
                "KHO_XUAT": order.source_code,    # Mã kho xuất Bravo
                "KHO_NHAP": order.dest_code,      # Mã kho nhập (CN) Bravo
                "SO_LUONG": line.qty_adjusted,     # Số lượng (qty sau CN sửa)
                "DON_VI_TINH": line.unit,          # Đơn vị tính
                "NGAY_CHUNG_TU": order.approved_at.strftime("%d/%m/%Y"),
                "SO_CHUNG_TU": order.order_code,   # Mã đơn hệ thống
                "GHI_CHU": f"SCP-{order.order_id[:8]}"  # Reference back
            })

    csv_file = generate_csv(csv_rows, filename=f"SCP_PXK_{today}.csv")

    for order in approved_orders:
        order.status = "STAGED"

    # Step 3: SFTP Upload
    try:
        sftp_upload(csv_file, remote_path="/bravo/import/")
        for order in approved_orders:
            order.status = "POSTED"
            order.posted_at = now()
            log_erp_posting(order, status="SUCCESS", file=csv_file.name)

    except SFTPError as e:
        # Compensation: rollback status
        for order in approved_orders:
            order.status = "APPROVED"  # rollback to APPROVED for retry
            log_erp_posting(order, status="FAILED", error=str(e))

        create_alert(
            type="ERP_SFTP_FAILED",
            severity="CRITICAL",
            message=f"SFTP upload failed: {e}",
            channels=["SSE", "EMAIL", "ZALO"]
        )
```

### Bravo CSV Format

```csv
LOAI_CHUNG_TU,MA_HANG,KHO_XUAT,KHO_NHAP,SO_LUONG,DON_VI_TINH,NGAY_CHUNG_TU,SO_CHUNG_TU,GHI_CHU
PXK,GACH60-A4,KBD01,CNDN01,500,THUNG,11/04/2026,ORD-20260411-001,SCP-abc12345
PXK,GACH30-B2,KBD01,CNDN01,300,THUNG,11/04/2026,ORD-20260411-001,SCP-abc12345
PXK,BOT-TRET,KBD01,CNHUE01,200,BAO,11/04/2026,ORD-20260411-002,SCP-def67890
```

### 4.5 Saga Pattern

```
┌─────────────────────────────────────────────────────┐
│  SAGA: Order → Bravo ERP                             │
│                                                       │
│  Step 1: Reserve lot (mark qty as committed)          │
│    ↓ success                                          │
│  Step 2: Generate CSV                                 │
│    ↓ success                                          │
│  Step 3: SFTP Upload                                  │
│    ↓ success → POSTED                                 │
│    ↓ fail → COMPENSATE:                               │
│       - Release lot reservation                       │
│       - Rollback order status to APPROVED             │
│       - Alert planner                                 │
│       - Retry next batch cycle                        │
│                                                       │
│  Step 4: Bravo confirmation (async)                   │
│    ↓ success → CONFIRMED                              │
│    ↓ fail → COMPENSATE:                               │
│       - Mark order as POSTING_ERROR                   │
│       - Alert + manual resolution                     │
└─────────────────────────────────────────────────────┘
```

---

## 5. Output

### 5.1 draft_order

| Field | Type | Description |
|---|---|---|
| order_id | UUID | PK |
| order_code | VARCHAR | Human-readable code (ORD-YYYYMMDD-NNN) |
| trip_id | UUID | FK → transport_plan_trip |
| source_location_id | UUID | Kho xuất |
| dest_location_id | UUID | CN nhận |
| departure_date | DATE | Ngày xuất hàng |
| eta | DATE | Ngày dự kiến đến |
| status | ENUM | DRAFT → ... → CONFIRMED |
| approved_by | UUID | CN_WH user |
| approved_at | TIMESTAMPTZ | |
| rejected_by | UUID | CN_WH user (nếu reject) |
| reject_reason | VARCHAR | Lý do reject |
| posted_at | TIMESTAMPTZ | Thời điểm SFTP upload |
| confirmed_at | TIMESTAMPTZ | Bravo xác nhận |

### 5.2 draft_order_line

| Field | Type | Description |
|---|---|---|
| line_id | UUID | PK |
| order_id | UUID | FK |
| sku_id | UUID | SKU |
| lot_id | UUID | Lot cụ thể |
| specs_id | VARCHAR | Variant code |
| qty_original | DECIMAL(15,2) | Qty từ allocation |
| qty_adjusted | DECIMAL(15,2) | Qty sau CN sửa (FR29) |
| unit | VARCHAR | Đơn vị tính (THUNG, BAO, etc.) |
| locked | BOOLEAN | True during POSTING/STAGED/POSTED/CONFIRMED only (pre-approval + post-approval edit allowed — post-approval triggers re-approve) |
| adjusted_by | UUID | CN user đã sửa |
| adjust_reason | VARCHAR | Lý do sửa |

### 5.3 erp_posting_log

| Field | Type | Description |
|---|---|---|
| log_id | UUID | PK |
| order_id | UUID | FK |
| batch_id | VARCHAR | Batch identifier |
| csv_filename | VARCHAR | Tên file CSV |
| sftp_status | ENUM | SUCCESS, FAILED, PENDING |
| sftp_timestamp | TIMESTAMPTZ | |
| bravo_status | ENUM | PENDING, PROCESSED, ERROR |
| error_message | TEXT | Chi tiết lỗi (nếu có) |
| retry_count | INT | Số lần retry |

### 5.4 adjustment_report (First-Class SCP Object)

| Column | Type | Description |
|---|---|---|
| report_id | UUID | PK |
| tenant_id | UUID | UNIS tenant |
| draft_order_id | UUID | FK → draft_order |
| line_id | UUID | FK → draft_order_line |
| adjustment_type | VARCHAR | QTY_CHANGE, DATE_CHANGE, SOURCE_CHANGE |
| old_qty | FLOAT | Qty trước khi sửa |
| new_qty | FLOAT | Qty sau khi sửa |
| old_date | DATE | (optional) |
| new_date | DATE | (optional) |
| reason | TEXT | Lý do sửa (bắt buộc) |
| actor_id | VARCHAR | User thực hiện sửa |
| actor_role | VARCHAR | Role (CN_WH, PLANNER, SC_MANAGER) |
| requires_re_approval | BOOLEAN | True nếu sửa sau duyệt |
| re_approved_by | VARCHAR | CN đã duyệt lại (NULL nếu chưa) |
| re_approved_at | TIMESTAMP | Thời điểm duyệt lại |
| created_at | TIMESTAMP | |

---

## 6. API Endpoints

### 6.1 Get Orders (for CN approval)

```
GET /api/v1/orders
  ?status=PENDING_APPROVAL
  &dest_location_id={cn_id}
  &page=1&size=20
```

### 6.2 Get Order Detail

```
GET /api/v1/orders/{order_id}
  ?include=lines,trip,erp_log
```

### 6.3 Edit Order Line (FR29 — pre-approval)

```
PUT /api/v1/orders/{order_id}/lines/{line_id}
Authorization: Bearer {token} (role: CN_WH)
```

Request:
```json
{
  "qty_adjusted": 450,
  "adjust_reason": "Kho CN không đủ chỗ chứa 500, giảm còn 450"
}
```

Response:
```json
{
  "line_id": "uuid",
  "qty_original": 500,
  "qty_adjusted": 450,
  "adjusted_by": "cn-user-uuid",
  "status": "success"
}
```

**Validation:**
- `order.status == PENDING_APPROVAL` (otherwise 409 Conflict)
- `qty_adjusted <= qty_original` (cannot increase)
- `qty_adjusted >= 0`
- `user.role == CN_WH`

### 6.4 Approve Order

```
POST /api/v1/orders/{order_id}/approve
Authorization: Bearer {token} (role: CN_WH)
```

Request:
```json
{
  "note": "Đã kiểm tra, đồng ý nhận hàng"
}
```

### 6.5 Reject Order

```
POST /api/v1/orders/{order_id}/reject
Authorization: Bearer {token} (role: CN_WH)
```

Request:
```json
{
  "reason": "CN đang đầy kho, không nhận thêm tuần này"
}
```

### 6.6 Re-submit Rejected Order

```
POST /api/v1/orders/{order_id}/resubmit
Authorization: Bearer {token} (role: PLANNER)
```

### 6.7 Get ERP Posting Status

```
GET /api/v1/erp/posting-log
  ?batch_id={batch_id}
  &status=FAILED
```

### 6.8 Retry ERP Posting

```
POST /api/v1/erp/retry
```

Request:
```json
{
  "order_ids": ["uuid1", "uuid2"]
}
```

---

## 7. Business Rules

| Rule ID | Rule | UNIS Value | Impact |
|---|---|---|---|
| EX-001 | Approval chain | ["CN_WH"] | CN bắt buộc duyệt mọi đơn |
| EX-002 | Pre-approval edit | **Allowed** (FR29) | CN sửa qty trước duyệt |
| EX-003 | Post-approval edit | **Re-approve required** | Sửa qty sau duyệt → status reset về PENDING_APPROVAL, CN phải duyệt lại |
| EX-004 | Qty adjustment | Decrease only | CN chỉ giảm, không tăng qty |
| EX-005 | Reject re-submit | Unlimited | Không giới hạn số lần re-submit |
| EX-006 | ERP protocol | SFTP batch CSV | Daily batch, không real-time |
| EX-007 | CSV format | Bravo PXK columns | LOAI_CHUNG_TU, MA_HANG, KHO_XUAT, ... |
| EX-008 | PO overdue | 10 ngày | PENDING_APPROVAL > 10 ngày → alert |
| EX-009 | AdjustmentReport | Bắt buộc | Mọi thay đổi qty/date sau khi tạo đơn PHẢI có AdjustmentReport với reason |
| EX-010 | Batch frequency | Daily | 1 CSV per day containing all approved orders |
| EX-011 | Order code format | ORD-YYYYMMDD-NNN | Human-readable, sequential per day |
| EX-012 | Reject reason | Required | CN bắt buộc ghi lý do khi reject |

### PO Overdue Detection

```python
# Celery scheduled task: check daily
def detect_po_overdue():
    overdue_orders = DraftOrder.filter(
        status="PENDING_APPROVAL",
        created_at__lt=now() - timedelta(days=10)
    )

    for order in overdue_orders:
        create_alert(
            type="PO_OVERDUE",
            severity="WARNING",
            order_id=order.order_id,
            dest_cn=order.dest_location.name,
            days_pending=days_since(order.created_at),
            channels=["SSE", "EMAIL", "ZALO"]
        )
```

---

## 8. Cross-Module Integration

### Inputs

| From | Data | Usage |
|---|---|---|
| Step 6 (Transport) | transport_plan_trip | Trip → draft order creation |
| Step 5 (Allocation) | allocation_result | Lot + qty details for order lines |
| Config | approval_chain | Who approves (CN_WH) |
| Config | bravo_sftp_config | Host, port, path, credentials |

### Outputs

| To | Data | Description |
|---|---|---|
| Bravo ERP | CSV via SFTP | Phiếu xuất kho (PXK) |
| Step 8 (Monitor) | Order lifecycle events | State changes, approval SLA, overdue |
| Step 8 (Monitor) | CN adjustment logs | Override tracking (qty changes by CN) |

### Event Flow

```
Step 6 confirms plan → transport.plan.confirmed
  → Create draft orders → order.created
  → Auto-submit → order.pending_approval
  → CN reviews on FE
    → CN edits qty (optional) → order.line_adjusted
    → CN approves → order.approved
      → Daily batch → order.posting → order.staged → order.posted
        → Bravo confirms → order.confirmed
    → CN rejects → order.rejected
      → Planner re-submits → order.pending_approval (loop)
```

### Bravo SFTP Configuration

```yaml
bravo_sftp:
  host: "bravo-sftp.unis.vn"
  port: 22
  username: "scp_integration"
  key_path: "/secrets/bravo_sftp_key"
  remote_upload_path: "/bravo/import/"
  remote_archive_path: "/bravo/archive/"
  filename_pattern: "SCP_PXK_{date}.csv"
  encoding: "UTF-8"
  delimiter: ","
  retry_on_fail: true
  max_retries: 3
```

---

## 9. UI Requirements

### 9.1 Order List (CN View)

- **Tabs:** Pending Approval | Approved | Rejected | All
- **Table:**
  - Columns: Order Code, Route, Items Count, Total Qty, Status, Created, Actions
  - Actions: View Detail, Approve, Reject
- **Badge count:** Pending Approval (red badge with count)
- **Sort:** newest first (PENDING_APPROVAL ưu tiên)

### 9.2 Order Detail + Approval (CN View)

- **Header:** Order code, Route, Departure date, ETA
- **Line items table:**
  - Columns: SKU, Variant, Lot, Qty Original, Qty Adjusted, Unit
  - **Editable:** Qty Adjusted column (input field, pre-approval AND post-approval)
  - Post-approval edit: shows ⚠️ "Re-approval required" badge, reason mandatory
  - Reason field appears when qty is changed
- **Action buttons:**
  - "Duyệt" (Approve) — green, prominent
  - "Từ chối" (Reject) — red, requires reason modal
- **Approval history:** timeline of state changes

### 9.3 ERP Posting Dashboard (Admin/Planner View)

- **Batch list:** date, file, order count, status (SUCCESS/FAILED)
- **Failed batches:** retry button, error details
- **SFTP connection status:** green/red indicator
- **Posting log:** timeline per order (POSTING → STAGED → POSTED → CONFIRMED)

### 9.4 Overdue Alert Panel

- Orders pending > 10 days highlighted red
- Escalation info: which CN, how many days overdue
- Quick action: send reminder to CN via ZALO/EMAIL

---

## 10. Acceptance Criteria

| AC ID | Criteria | Test Method |
|---|---|---|
| AC7-01 | Draft order created from confirmed transport trip | Integration test |
| AC7-02 | State machine: all transitions valid, invalid rejected | State test: try invalid transition |
| AC7-03 | CN can edit qty BEFORE approval (FR29) | E2E test: edit → approve → verify |
| AC7-04 | Edit after approval → status resets to PENDING_APPROVAL, CN must re-approve | API: PUT after approve → status=PENDING_APPROVAL |
| AC7-05 | CN can only DECREASE qty, not increase | Validation test: new_qty > original → 400 |
| AC7-06 | Reject requires reason | API test: reject without reason → 400 |
| AC7-07 | Re-submit rejected order works | E2E test: reject → re-submit → pending |
| AC7-08 | Bravo CSV format correct (all required columns) | Unit test: verify CSV output |
| AC7-09 | SFTP upload success → status POSTED | Integration test with SFTP mock |
| AC7-10 | SFTP fail → saga compensation (rollback) | Failure test: mock SFTP error |
| AC7-11 | PO overdue alert at 10 days | Time test: create order, advance 10 days |
| AC7-12 | Daily batch collects all approved orders | Batch test: 5 orders approved, 1 CSV |
| AC7-13 | ERP posting log records all attempts | Data test: verify log entries |
| AC7-14 | Only CN_WH role can approve/reject | Auth test: other role → 403 |

---

*Module Spec v1.0 — Step 7: Execution Bridge*
*Created: 2026-04-11 | R-BA for UNIS*
