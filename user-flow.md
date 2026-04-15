# UNIS SCP — User Flow

> **Version:** 2.0 | **Date:** 2026-04-13
> **Source:** `UNIS-TERRAX-MAPPING.md`, `data-flow.md`, `system-flows.md`, `SCP v3.6`
> **Purpose:** Mô tả hành trình từng role người dùng qua 8-step SCP pipeline — dùng cho UX review, QA test case, onboarding.
> **Migrated from:** TerraX DRP user-flow v1.0

---

## Mục lục

1. [Tổng quan 8-step SCP Pipeline](#1-tổng-quan-8-step-scp-pipeline)
2. [Roles và quyền truy cập](#2-roles-và-quyền-truy-cập)
3. [User Flow — sc_planner (Kế hoạch viên SC)](#3-user-flow--sc_planner-kế-hoạch-viên-sc)
4. [User Flow — branch_head (Trưởng Chi Nhánh)](#4-user-flow--branch_head-trưởng-chi-nhánh)
5. [User Flow — sc_manager (Trưởng bộ phận SCM)](#5-user-flow--sc_manager-trưởng-bộ-phận-scm)
6. [User Flow — bod (Ban Giám Đốc)](#6-user-flow--bod-ban-giám-đốc)
7. [Happy Path — Luồng hoàn chỉnh 1 PlanningCycle](#7-happy-path--luồng-hoàn-chỉnh-1-planningcycle)
8. [Error & Edge Case Flows](#8-error--edge-case-flows)

---

## 1. Tổng quan 8-step SCP Pipeline

| Step | Module | Route | Trigger | Output |
|------|--------|-------|---------|--------|
| **S1** | Demand Ingestion | `/demand` | PlanningCycle (23:00 ICT) hoặc manual | `demand_signal[]` đã clean, Freshness Gate PASS |
| **S2** | Supply Snapshot | `/supply` | Sau S1 PASS | `inventory_snapshot` (4-bucket: OEM/Transit/Buffer/Committed) |
| **S3** | Inventory & Policy | `/policy` | Sau S2 | `safety_stock`, `reorder_point`, ABC/XYZ class per SKU |
| **S4** | DRP Netting | `/drp` | Sau S3 | `net_requirement[]`, lot-sized pull suggestions |
| **S5** | Allocation Engine | `/allocation` | Sau S4 | `allocation_plan` (6-layer: VIP→OEM→RDC→SS→Excess→Backlog) |
| **S6** | Transport Planning | `/transport` | Sau S5 | `shipment_plan` (vehicle + carrier assignment) |
| **S7** | Order Bridge | `/execution` | Manual trigger sau S6 approved | SO/TO/PO pushed → Bravo ERP |
| **S8** | Monitor & Learn | `/monitor` | Continuous / post-cycle | KPI drift, MAPE, Fill Rate, OTIF alert |

> **PlanningCycle:** chạy tự động 23:00 ICT hàng ngày → S1→S2→S3→S4 pipeline auto. S5-S7 yêu cầu human-in-the-loop approval.

---

## 2. Roles và quyền truy cập

| Route | sc_planner | branch_head | sc_manager | bod |
|-------|:----------:|:-----------:|:----------:|:---:|
| `/` (Exception Dashboard) | ✅ | ✅ (branch-scoped) | ✅ full | ✅ full |
| `/demand` | ✅ + trigger | ✅ view | ✅ + override | ✅ view |
| `/supply` | ✅ + upload | ✅ own branch | ✅ full | ✅ view |
| `/policy` | ✅ + edit SS | ✅ view | ✅ + approve | ✅ view |
| `/drp` | ✅ + trigger | ✅ view | ✅ + trigger | ✅ view |
| `/allocation` | ✅ + adjust | ✅ view own layer | ✅ + approve | ✅ view |
| `/transport` | ✅ + plan | ❌ | ✅ + approve | ✅ view |
| `/execution` | ✅ + submit | ✅ approve SO | ✅ approve PO/TO | ✅ view |
| `/monitor` | ✅ view | ✅ view (branch) | ✅ full | ✅ full |
| `/plan-actual` | ✅ view | ✅ view (branch) | ✅ full | ✅ full |
| `/config` | ❌ | ❌ | ✅ edit | ✅ view |

> **Note:** `branch_head` chỉ thấy dữ liệu scoped theo `branch_id` của mình. Không thấy `factory_available_qty`, `unit_price`, cross-branch allocation detail.

---

## 3. User Flow — sc_planner (Kế hoạch viên SC)

Role trung tâm — điều hành toàn bộ 8 bước SCP pipeline hàng ngày.

### 3A. Luồng sáng sớm — Kiểm tra PlanningCycle

```mermaid
flowchart TD
    START(["sc_planner đăng nhập"]) --> DASH["Exception Dashboard /\nXem: Fill Rate / OTIF / MAPE / Exceptions"]

    DASH --> CYCLE_CHECK{PlanningCycle chạy lúc 23:00?}
    CYCLE_CHECK -->|PASS — Freshness < 240 min| S1_OK["S1 Demand OK\nXem /demand: demand_signal count"]
    CYCLE_CHECK -->|FAIL / Stale data| MANUAL_TRIGGER["Click 'Re-run Demand Ingestion'\nPOST /api/scp/demand/trigger\nFreshness Gate sẽ validate lại"]
    MANUAL_TRIGGER --> FRESH_CHECK{Freshness Gate}
    FRESH_CHECK -->|> 240 min| ALERT_STALE["⚠️ Warning: Stale data\nBáo IT sync Bravo ERP\nHoặc upload Excel fallback"]
    FRESH_CHECK -->|≤ 240 min| S1_OK

    S1_OK --> S2["S2 Supply Snapshot /supply\nXem 4-bucket inventory:\nOEM / Transit / Buffer / Committed"]
    S2 --> S2_CHECK{Dữ liệu đủ?}
    S2_CHECK -->|Thiếu| S2_UPLOAD["Upload Excel tồn kho\nPOST /api/scp/supply/upload\n+ Idempotency-Key header"]
    S2_UPLOAD --> S2
    S2_CHECK -->|OK| S3["S3 Inventory & Policy /policy\nKiểm tra Safety Stock, ABC class\nEdit policy nếu cần"]
    S3 --> PIPELINE["→ Tiến hành S4 DRP Netting"]
```

### 3B. Luồng chạy DRP Netting (S4)

```mermaid
flowchart TD
    A["Vào /drp"] --> B{Có DRPJob done từ PlanningCycle?}
    B -->|Có| C["Xem DRP Netting table\nSKU × Branch × 13 tuần"]
    B -->|Muốn re-run| D["Click 'Chạy DRP'\nPOST /api/scp/drp/compute → { job_id }"]
    D --> E["Polling job status mỗi 2s\nGET /api/scp/drp/jobs/{job_id}"]
    E --> F{Status?}
    F -->|queued / running| E
    F -->|failed| ERR["Hiện error_message\nXem logs → báo dev"]
    F -->|done| C

    C --> FILTER["Filter: Branch / Action / SKU / ABC class"]
    FILTER --> TABLE["Xem columns:\nbegin_stock · forecast · safety_stock\nnet_req · lot_sized_qty · HSTK · action"]
    TABLE --> ACTION_REVIEW{Review actions}
    ACTION_REVIEW -->|PULL items| ALLOC["→ S5 Allocation Engine"]
    ACTION_REVIEW -->|OVERSTOCK items| POLICY["→ Về /policy điều chỉnh reorder point"]
    ACTION_REVIEW -->|Inline adjust| ADJUST["PATCH /api/scp/drp/rows/{id}\nadjusted_qty + adjustment_reason\nAudit log ghi nhận"]
    ADJUST --> TABLE
```

### 3C. Luồng Allocation Engine (S5)

```mermaid
flowchart TD
    A["Vào /allocation\nXem allocation_plan từ S4"] --> B["6-Layer waterfall:\nL1 VIP → L2 OEM → L3 RDC\n→ L4 Safety Stock → L5 Excess → L6 Backlog"]
    B --> C{Review allocation}
    C -->|Override layer qty| D["Click cell → nhập adjusted_qty\nPATCH /api/scp/allocation/items/{id}\n+ lý do bắt buộc"]
    D --> C
    C -->|Approve plan| E["POST /api/scp/allocation/approve\n→ allocation_status: approved"]
    E --> F["→ S6 Transport Planning"]
    C -->|Reject plan| G["Post comment\n→ re-trigger DRP (về S4)"]
```

### 3D. Luồng Transport Planning → Order Bridge (S6 → S7)

```mermaid
flowchart TD
    A["Vào /transport\nXem shipment_plan"] --> B["Assign: Vehicle / Carrier / ETA\nPer allocation line"]
    B --> C["Xem container utilization\n(weight kg, volume m³)"]
    C --> D{Utilization OK?}
    D -->|> 95% or > 28T| WARN["⚠️ Warning: vượt trọng tải\nSplit hoặc re-allocate"]
    WARN --> B
    D -->|OK| E["Submit transport plan\nPOST /api/scp/transport/submit"]
    E --> F["Vào /execution (Order Bridge)\nXem: SO / TO / PO draft"]
    F --> G["Review orders trước khi push ERP"]
    G --> H{sc_manager approve?}
    H -->|Approved| I["POST /api/scp/execution/push-erp\n→ Bravo ERP sync\nSO/TO/PO tạo trong Bravo"]
    H -->|Reject| J["Ghi reject_reason\n→ back to /allocation"]
    I --> K["Monitor: /monitor\nXem OTIF, Fill Rate sau execution"]
```

---

## 4. User Flow — branch_head (Trưởng Chi Nhánh)

`branch_head` xem kết quả allocation cho branch mình và duyệt SO trước khi push ERP.

```mermaid
flowchart TD
    START(["branch_head đăng nhập"]) --> DASH["Exception Dashboard /\nXem KPI scoped by branch_id:\nFill Rate branch / STOCKOUT alerts"]

    DASH --> SUPPLY["Supply Snapshot /supply\n(chỉ thấy tồn kho branch mình)\nOEM / Transit / Buffer"]

    SUPPLY --> ALLOC_VIEW["Allocation View /allocation\nXem allocation_plan cho branch mình:\nL1-L6 layers, qty assigned, ETA"]

    ALLOC_VIEW --> REVIEW{Review allocation}
    REVIEW -->|Chấp nhận| WAIT["Chờ sc_planner submit\nTransport + Order Bridge"]
    REVIEW -->|Cần điều chỉnh| COMMENT["Ghi comment / request\n→ sc_planner nhận notification"]

    WAIT --> SO_REVIEW["Vào /execution\nXem SO draft cho branch mình\n(SO = Sales Order giao hàng cho CN)"]

    SO_REVIEW --> SO_APPROVE{Duyệt SO?}
    SO_APPROVE -->|Approve| SO_OK["POST /api/scp/execution/so/{id}/approve\n→ SO ready to push Bravo"]
    SO_APPROVE -->|Reject| SO_REJECT["Nhập reject_reason (bắt buộc)\n→ FINAL — không undo\n→ sc_planner tạo lại"]

    SO_OK --> MONITOR["Monitor /monitor\nXem Fill Rate, OTIF sau delivery\nScoped by branch_id"]
    SO_REJECT --> HISTORY["Xem /plan-actual\nAudit log + variance report"]

    style SO_OK fill:#d4edda
    style SO_REJECT fill:#f8d7da
```

**Constraints quan trọng với `branch_head`:**

- Data luôn scoped theo `branch_id` — không thấy cross-branch info
- Không thấy `factory_available_qty`, `unit_price`, allocation của branch khác
- SO rejection là FINAL — không escalate, sc_planner phải tạo lại
- Không có quyền trigger PlanningCycle hay DRP

---

## 5. User Flow — sc_manager (Trưởng bộ phận SCM)

`sc_manager` là người duyệt cuối toàn pipeline — xem đầy đủ inventory, approve PO/TO/SO, và quản lý Policy Platform.

```mermaid
flowchart TD
    START(["sc_manager đăng nhập"]) --> DASH["Exception Dashboard /\nXem đầy đủ KPI hệ thống:\nFill Rate / OTIF / MAPE / SLA duyệt"]

    DASH --> PIPELINE_CHECK["Kiểm tra pipeline status bar\nS1-S8 completed / active / pending"]

    PIPELINE_CHECK --> ALLOC_APPROVE["S5: Allocation approval\n/allocation\nXem full 6-layer plan + factory_available_qty"]
    ALLOC_APPROVE --> A_REVIEW{Review}
    A_REVIEW -->|Override qty| A_ADJUST["Inline adjust + lý do\nAudit log: before/after"]
    A_ADJUST --> A_REVIEW
    A_REVIEW -->|Approve| A_OK["POST /api/scp/allocation/approve\n→ unlock S6 Transport"]
    A_REVIEW -->|Reject| A_REJ["Reject + comment → sc_planner re-plan"]

    A_OK --> TRANSPORT_APP["S6: Transport review /transport\nXem vehicle assignment + weight kg"]
    TRANSPORT_APP --> T_OK["Approve shipment plan"]

    T_OK --> ORDER_APPROVE["S7: Order Bridge /execution\nXem TO/PO draft\nTO: chuyển nội bộ kho → kho\nPO: đặt hàng nhà máy"]
    ORDER_APPROVE --> O_REVIEW{Bulk approve?}
    O_REVIEW -->|Approve all| PUSH["POST /api/scp/execution/push-erp\n→ Bravo ERP: SO + TO + PO created"]
    O_REVIEW -->|Selective| SEL["Tick từng order\nAdjust qty + lý do nếu cần"]
    SEL --> PUSH
    O_REVIEW -->|Reject| O_REJ["reject_reason → FINAL\nsc_planner re-plan từ S5"]

    PUSH --> MONITOR["S8: Monitor /monitor\nXem KPI drift post-execution\nHSTK trend, MAPE delta, OTIF"]
    MONITOR --> PLAN_ACTUAL["/plan-actual\nVersion diff: plan vs actual\nAdjustmentReport"]
    PLAN_ACTUAL --> CONFIG["Config /config\nPolicy Platform: chỉnh 27 policy types\nABC thresholds, SS formula, FEFO toggle"]

    style PUSH fill:#d4edda
    style O_REJ fill:#f8d7da
    style A_REJ fill:#f8d7da
```

---

## 6. User Flow — bod (Ban Giám Đốc)

`bod` view-only trên toàn pipeline. Có thêm quyền export JSON snapshot.

```mermaid
flowchart TD
    START(["bod đăng nhập"]) --> DASH["Exception Dashboard /\nXem đầy đủ KPI:\nFill Rate / OTIF / MAPE / Exceptions count"]

    DASH --> PIPELINE["Xem pipeline bar S1-S8\nStatus: completed / active / pending\n(view only — không trigger)"]

    PIPELINE --> ALLOC_VIEW["Allocation /allocation\nXem 6-layer plan toàn hệ thống\n(view only)"]

    ALLOC_VIEW --> EXEC_VIEW["Order Bridge /execution\nXem SO/TO/PO đã push Bravo\nTracking: submitted / synced / error"]

    EXEC_VIEW --> MONITOR_VIEW["Monitor /monitor\nKPI trend: Fill Rate T-4 → T0\nOTIF, MAPE, Drift alert history"]

    MONITOR_VIEW --> PLAN_ACTUAL["/plan-actual\nPlan vs Actual version diff\nCycle-over-cycle comparison"]

    PLAN_ACTUAL --> EXPORT["Export JSON Snapshot\nGET /api/scp/export/snapshot\nPermission: export_import (BOD only)"]

    EXPORT --> CONFIG_VIEW["Config /config\nXem 27 policy types\n(view only — không edit)"]
```

---

## 7. Happy Path — Luồng hoàn chỉnh 1 PlanningCycle

Một chu kỳ kế hoạch hoàn chỉnh từ S1 Demand Ingestion → S7 Order Bridge push ERP:

```mermaid
sequenceDiagram
    actor P as sc_planner
    actor BH as branch_head
    actor M as sc_manager
    participant SYS as UNIS SCP
    participant ERP as Bravo ERP

    rect rgb(240, 248, 255)
        Note over P,SYS: S1 — Demand Ingestion (23:00 ICT auto)
        SYS->>ERP: Pull demand signal từ Bravo
        SYS->>SYS: Freshness Gate: age ≤ 240 min?
        SYS-->>P: Exception Dashboard: S1 PASS / FAIL
    end

    rect rgb(255, 248, 240)
        Note over P,SYS: S2 — Supply Snapshot
        SYS->>ERP: Pull inventory (OEM/Transit/Buffer/Committed)
        P->>SYS: (Nếu cần) Upload Excel fallback
        SYS-->>P: inventory_snapshot confirmed
    end

    rect rgb(240, 255, 248)
        Note over P,SYS: S3+S4 — Policy & DRP Netting
        P->>SYS: Review safety_stock, reorder_point /policy
        P->>SYS: POST /api/scp/drp/compute
        SYS->>SYS: Compute net_req × lot_size × 13W per SKU×Branch
        SYS-->>P: DRP table: HSTK badges, action=PULL/HOLD/OVERSTOCK
    end

    rect rgb(248, 240, 255)
        Note over P,M,SYS: S5 — Allocation Engine
        P->>SYS: Review 6-layer allocation plan /allocation
        P->>SYS: Adjust qty nếu cần + lý do
        M->>SYS: POST /api/scp/allocation/approve ✅
    end

    rect rgb(255, 252, 240)
        Note over P,SYS: S6 — Transport Planning
        P->>SYS: Assign vehicle / carrier / ETA /transport
        P->>SYS: POST /api/scp/transport/submit
    end

    rect rgb(240, 255, 240)
        Note over P,BH,M,SYS: S7 — Order Bridge
        P->>SYS: Generate SO/TO/PO draft /execution
        BH->>SYS: POST /api/scp/execution/so/{id}/approve (SO)
        M->>SYS: POST /api/scp/execution/push-erp (TO+PO)
        SYS->>ERP: Push SO + TO + PO → Bravo
        ERP-->>SYS: sync_status: success
        SYS->>SYS: Audit log: actor + timestamp + before/after
    end

    rect rgb(255, 240, 240)
        Note over P,M,SYS: S8 — Monitor & Learn
        SYS->>SYS: Compute KPI: Fill Rate, OTIF, MAPE drift
        M->>SYS: Review /monitor — xem exceptions
        P->>SYS: /plan-actual — so sánh plan vs actual
        M->>SYS: /config — điều chỉnh policy cho cycle tiếp
    end
```

---

## 8. Error & Edge Case Flows

### 8A. Freshness Gate FAIL (S1)

```mermaid
flowchart LR
    A["S1 Demand Ingestion chạy\nPlanningCycle 23:00"] --> B{Freshness Gate}
    B -->|age > 240 min| C["⚠️ Alert: demand_signal stale\nException Dashboard: S1 WARN"]
    C --> D{sc_planner action}
    D -->|Bravo sync lỗi| E["Báo IT: check Bravo API connector\nRetry sau khi sync OK"]
    D -->|Manual override| F["Upload Excel fallback\nPOST /api/scp/demand/upload\n+ force_override=true"]
    F --> G["Freshness Gate re-check\nNếu PASS → pipeline tiếp tục"]
    B -->|age ≤ 240 min| OK["PASS → S2 Supply Snapshot"]
```

### 8B. Order Bridge bị Reject

```mermaid
flowchart LR
    A["SO/TO/PO status = rejected"] --> B{Rejected bởi?}
    B -->|branch_head SO reject| C["FINAL — không undo\nsc_planner đọc reject_reason\nRe-plan từ S5 Allocation"]
    B -->|sc_manager PO/TO reject| D["FINAL — không undo\nsc_planner re-plan\nAudit log ghi nhận"]
    C & D --> E["/plan-actual\nAudit: before={pending}, after={rejected}\n+ reject_reason + actor + timestamp"]
```

### 8C. Supply Upload Duplicate

```mermaid
flowchart LR
    A["POST /api/scp/supply/upload\nvới Idempotency-Key đã dùng"] --> B["Key trùng trong inventory_snapshot"]
    B --> C["records_skipped++\nKhông tạo duplicate"]
    C --> D["Response 200\n{ created: 0, skipped: N, errors: [] }\nHệ thống an toàn"]
```

### 8D. DRP Job Failed (S4)

```mermaid
flowchart LR
    A["GET /api/scp/drp/jobs/{id}\nstatus = failed"] --> B["Hiện error_message\nXem error_code"]
    B --> C{Nguyên nhân}
    C -->|No supply snapshot| D["S2 chưa xong\nChờ / trigger S2 trước"]
    C -->|Policy config lỗi| E["Vào /config\nKiểm tra SS formula, ABC threshold"]
    C -->|Algorithm error| F["Báo dev: job_id + error_message + stack_trace"]
    D & E --> G["Retry DRP: POST /api/scp/drp/compute"]
```

### 8E. Bravo ERP Push Failed (S7)

```mermaid
flowchart LR
    A["POST /api/scp/execution/push-erp\nsync_status = error"] --> B{Error type}
    B -->|Auth expired| C["Bravo token expired\nIT re-auth connector\nRetry push"]
    B -->|Duplicate order| D["Order đã tồn tại trong Bravo\nCheck idempotency_key\nSkip hoặc force-update"]
    B -->|Validation fail| E["Bravo field mismatch\nXem error_detail\nSửa mapping /config"]
    C & D & E --> F["POST /api/scp/execution/retry-push\n→ Audit log: retry_count++"]
```

### 8F. User không đủ quyền

```mermaid
flowchart LR
    A["User gọi route/endpoint\nkhông có permission"] --> B["Backend:\n@require_permission check fails"]
    B --> C["Response 403\n{ detail: 'Không có quyền', code: 'ERR_FORBIDDEN' }"]
    C --> D["Frontend: Toast error\nKhông redirect, không leak data\nKhông hiện UI element liên quan"]
```

---

*user-flow.md v2.0 — UNIS SCP | 2026-04-13 | Migrated from TerraX DRP v1.1 | Aligned with SCP v3.6 + UNIS-TERRAX-MAPPING.md v1.3*
