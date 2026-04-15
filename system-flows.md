# TerraX DRP — System Flows

> **Version:** 1.0 | **Date:** 2026-04-07
> **Source:** Derived from `architecture.md`, `API-DOCS.md`, `FRONTEND-DOCS.md`
> **Purpose:** Reference cho dev, QA, và architect để hiểu luồng kỹ thuật chi tiết của toàn hệ thống.

---

## Mục lục

1. [Kiến trúc tổng thể](#1-kiến-trúc-tổng-thể)
2. [Authentication Flow](#2-authentication-flow)
3. [Data Ingestion Flow](#3-data-ingestion-flow)
4. [DRP Engine — Async Compute Flow](#4-drp-engine--async-compute-flow)
5. [Pull Order — Tạo và Approval Flow](#5-pull-order--tạo-và-approval-flow)
6. [Purchase Order Flow](#6-purchase-order-flow)
7. [RBAC — Phân quyền theo Role](#7-rbac--phân-quyền-theo-role)
8. [DRP Algorithm — Logic cốt lõi](#8-drp-algorithm--logic-cốt-lõi)

---

## 1. Kiến trúc tổng thể

Hệ thống gồm 6 lớp độc lập: Frontend → Nginx → FastAPI (+ Middleware) → Celery Worker → PostgreSQL + Redis.

```mermaid
graph TB
    subgraph CLIENT["🖥️ Browser — Next.js 14"]
        FE_AUTH["middleware.ts\nAuth Guard"]
        FE_PAGES["Pages / Components"]
        FE_API["lib/api-client.ts\nHTTP wrapper"]
    end

    subgraph NGINX["🔀 Nginx :80/:443\nReverse Proxy + SSL"]
    end

    subgraph BACKEND["⚙️ FastAPI :8000"]
        MW_CORS["CORS Middleware"]
        MW_JWT["JWT Auth Middleware"]
        MW_AUDIT["Audit Log Middleware"]
        ROUTES["Route Handlers\nauth · master-data · inventory\ndrp · orders · kpi · alerts"]
        SERVICES["Services\nDRPEngine · OrderService\nIngestionAdapter · NotificationService"]
    end

    subgraph ASYNC["🔄 Celery Worker (2 processes)"]
        TASK["drp_compute.delay(job_id)"]
        ENGINE["DRPEngine.compute_sku_branch()\n5000 SKU × 70 branch × 13 tuần"]
    end

    subgraph DATA["💾 Data Layer"]
        PG[("PostgreSQL :5432\n11 tables\nACID + Row-level locking")]
        REDIS[("Redis :6379\nCelery Broker\n+ Job Status Cache\n+ Session Cache")]
    end

    FE_PAGES --> FE_API
    FE_API -->|HTTPS /api/v1/*| NGINX
    NGINX --> MW_CORS
    MW_CORS --> MW_JWT
    MW_JWT --> MW_AUDIT
    MW_AUDIT --> ROUTES
    ROUTES --> SERVICES
    SERVICES -->|async SQLAlchemy| PG
    ROUTES -->|dispatch job| REDIS
    REDIS -->|Celery consume| TASK
    TASK --> ENGINE
    ENGINE -->|bulk INSERT drp_results| PG
    ENGINE -->|UPDATE job status| REDIS
    FE_PAGES -->|poll 2s| FE_API

    style PG fill:#336791,color:#fff
    style REDIS fill:#DC382D,color:#fff
```

**Docker Compose services:**

| Service | Port | Role |
|---------|------|------|
| `nginx` | 80/443 | Reverse proxy, SSL termination |
| `frontend` | 3000 | Next.js (SSR + Client components) |
| `backend` | 8000 | FastAPI, 2 workers |
| `worker` | — | Celery worker, 2 processes |
| `postgres` | 5432 | Primary database |
| `redis` | 6379 | Broker + cache |

---

## 2. Authentication Flow

**Middleware chain:** `Next.js middleware.ts` (client) → `JWT Middleware` (server)

```mermaid
sequenceDiagram
    actor User
    participant FE_MW as middleware.ts (Next.js)
    participant FE as Frontend Page
    participant BE as FastAPI /auth
    participant DB as PostgreSQL

    User->>FE_MW: Truy cập bất kỳ route /(app)/*
    FE_MW->>FE_MW: Đọc cookie "token"
    alt Token không tồn tại hoặc expired
        FE_MW-->>User: redirect → /login
        User->>FE: Nhập username + password
        FE->>BE: POST /api/v1/auth/login\n{ username, password }
        BE->>DB: SELECT user WHERE username=? AND is_active=true
        DB-->>BE: User record { role, branch_id, hashed_password }
        BE->>BE: bcrypt.verify(password, hashed_password)
        alt Password đúng
            BE->>BE: JWT.encode({ user_id, role, branch_id }, secret, exp=8h)
            BE-->>FE: 200 { access_token, user: { id, role, branch_id } }
            FE->>FE: setCookie("token", access_token, maxAge=24h)
            FE-->>User: redirect → /dashboard
        else Password sai / tài khoản disabled
            BE-->>FE: 401 | 403
            FE-->>User: Hiện lỗi "Sai thông tin đăng nhập"
        end
    else Token hợp lệ
        FE_MW->>FE_MW: JWT.decode(token) → extract role, branch_id
        FE_MW-->>FE: Allow render page
    end

    Note over FE,BE: Mọi request tiếp theo đính kèm<br/>Authorization: Bearer <token>
```

**Refresh token:**

```mermaid
sequenceDiagram
    participant FE as api-client.ts
    participant BE as FastAPI /auth/refresh

    FE->>BE: POST /api/v1/auth/refresh\nAuthorization: Bearer <current_token>
    BE->>BE: Verify token chưa blacklisted
    BE-->>FE: 200 { access_token, user }
    FE->>FE: setCookie("token", new_access_token)
```

**Quy tắc RBAC tại backend:** Mọi protected route dùng `@require_permission("permission_name")` decorator. Token không có quyền → `403 Forbidden`.

---

## 3. Data Ingestion Flow

### 3A. Master Data Upload

**Actor:** `vpt_planner` | **File:** `.xlsx` với 3 sheets: `sku`, `branches`, `pattern_ratios`

```mermaid
flowchart TD
    A["vpt_planner chọn file .xlsx"] --> B["POST /api/v1/master-data/upload\nmultipart/form-data"]
    B --> C["JWT Middleware\n→ verify upload_master_data permission"]
    C --> D["ExcelIngestionAdapter.ingest(file)"]
    D --> D1["1. openpyxl đọc sheet 'sku'\n   validate required columns"]
    D --> D2["2. openpyxl đọc sheet 'branches'\n   validate type IN NM,CN"]
    D --> D3["3. openpyxl đọc sheet 'pattern_ratios'\n   validate effective_date format"]
    D1 & D2 & D3 --> E["Normalize → SkuRecord[] / BranchRecord[] / PatternRatioRecord[]"]
    E --> F["PostgreSQL\nbulk UPSERT:\n- sku ON CONFLICT sku_code DO UPDATE\n- branches ON CONFLICT code DO UPDATE\n- pattern_ratios INSERT (new effective_date)"]
    F --> G["Audit Middleware\nINSERT audit_log\nmodule=master_data, action=uploaded"]
    G --> H["Response 200\n{ records_created, records_skipped, errors: [] }"]

    style D fill:#fff3cd
    style F fill:#d4edda
```

### 3B. Inventory Upload

**Actor:** `vpt_planner` | **Header bắt buộc:** `Idempotency-Key`

```mermaid
flowchart TD
    A["vpt_planner chọn file inventory.xlsx"] --> B["POST /api/v1/inventory/upload\n+ Header: Idempotency-Key: <sha256-string>"]
    B --> C["Verify upload_inventory permission"]
    C --> D["ExcelIngestionAdapter.ingest(file)\nColumns: sku_code, branch_code,\ncolor_code, quantity, inv_type"]
    D --> E["Với mỗi row:\nidempotency_key = SHA256(sku_code:branch_code:color_code:date)"]
    E --> F{idempotency_key\nđã tồn tại trong DB?}
    F -->|Có| G["Skip row\nrecords_skipped++"]
    F -->|Không| H["INSERT inventory\n{ sku_id, branch_id, color_code,\nquantity, inv_type, source='excel',\nidempotency_key, recorded_at=now() }"]
    H --> I["Audit log: inventory.uploaded"]
    G & I --> J["Response 200\n{ records_created, records_skipped, errors }"]

    style F fill:#fff3cd
    style G fill:#f8d7da
    style H fill:#d4edda
```

### 3C. Adapter Pattern — Extensibility

```mermaid
classDiagram
    class DataIngestionService {
        <<abstract>>
        +ingest(source) IngestResult
    }
    class ExcelIngestionAdapter {
        +ingest(file: UploadFile) IngestResult
        -parse_xlsx(file)
        -validate_columns(df)
        -map_to_records(df)
    }
    class BravoAPIAdapter {
        <<Phase 2 — stub>>
        +ingest(credentials: ERPCredentials) IngestResult
        -auth_bravo()
        -fetch_inventory()
        -handle_idempotency()
    }
    class IngestionRouter {
        +route(source_type, source) IngestResult
    }

    DataIngestionService <|-- ExcelIngestionAdapter
    DataIngestionService <|-- BravoAPIAdapter
    IngestionRouter --> DataIngestionService
```

> **Rule:** Business logic không bao giờ biết nguồn dữ liệu là Excel hay ERP. Chỉ adapter biết.

---

## 4. DRP Engine — Async Compute Flow

**Actor:** `vpt_planner` hoặc `vpt_head` | **Cơ chế:** Celery + Redis (async job)

```mermaid
sequenceDiagram
    actor Planner as vpt_planner
    participant FE as Frontend /planning
    participant BE as FastAPI /drp
    participant REDIS as Redis (Broker + Cache)
    participant WORKER as Celery Worker
    participant DB as PostgreSQL

    Planner->>FE: Click "Chạy DRP"
    FE->>BE: POST /api/v1/drp/compute\n(trigger_drp permission)
    BE->>DB: INSERT drp_jobs { status='queued', triggered_by=user_id }
    BE->>REDIS: drp_compute.delay(job_id)
    BE-->>FE: 200 { job_id: "uuid" }

    FE->>FE: Bắt đầu polling mỗi 2 giây
    loop Poll until status = done | failed
        FE->>BE: GET /api/v1/drp/result/{job_id}
        BE->>REDIS: GET job:{job_id}:status
        BE-->>FE: { status: 'queued' | 'running' }
    end

    WORKER->>DB: UPDATE drp_jobs SET status='running', started_at=now()
    WORKER->>DB: SELECT sku, inventory, branches (all active records)
    WORKER->>WORKER: Với mỗi (sku × branch) pair:<br/>compute_sku_branch(sku, branch, inventory, weeks=13)
    Note over WORKER: 5000 SKU × 70 CN = 350,000 rows<br/>Target < 5 giây
    WORKER->>DB: bulk INSERT drp_results (13 rows mỗi pair)
    WORKER->>REDIS: SET job:{job_id}:status = 'done'
    WORKER->>DB: UPDATE drp_jobs SET status='done', completed_at=now()

    FE->>BE: GET /drp/result/{job_id} → status='done'
    FE->>BE: GET /drp/result/{job_id}/summary
    BE-->>FE: { stockout_count, ok_count, overstock_count, total_skus, total_branches }
    FE->>BE: GET /drp/result/{job_id}/table?page=1&page_size=50
    BE-->>FE: Paginated rows → render DRPWorkbench (13-week table)
```

**Page load optimization:**

```mermaid
flowchart LR
    A["User vào /planning"] --> B["GET /drp/latest"]
    B --> C{Job tồn tại?}
    C -->|404 — chưa có job| D["Hiện nút 'Chạy DRP lần đầu'"]
    C -->|status = done| E["Render DRPWorkbench ngay\nKhông cần recompute"]
    C -->|status = running/queued| F["Resume polling từ job_id đó"]
```

---

## 5. Pull Order — Tạo và Approval Flow

### 5A. State Machine

```mermaid
stateDiagram-v2
    [*] --> draft : POST /orders/pull\n(vpt_planner)
    draft --> pending_cn : POST /submit\n(vpt_planner)
    pending_cn --> pending_tcu : POST /approve-cn\n(cn_head)
    pending_cn --> rejected : POST /reject\n(cn_head)\nrequired: reject_reason
    pending_tcu --> approved : POST /approve-tcu\n(vpt_head)
    pending_tcu --> rejected : POST /reject\n(vpt_head)\nrequired: reject_reason
    approved --> [*]
    rejected --> [*]

    note right of pending_cn
        CN rejection = ABSOLUTE
        Không có auto-pass
        Không có escalation (FR30)
    end note
```

### 5B. Pull Order Creation — Sprint 2 Flow (FR14-FR17)

```mermaid
flowchart TD
    A["vpt_planner vào /planning/orders"] --> B["GET /drp/suggestions?action=PULL\n→ hiện bảng PULL items, sort HSTK ASC"]
    B --> C["User chọn checkbox các SKU cần lệnh"]
    C --> D["User chọn:\n- Source Factory (NM)\n- Dest Branch (CN)"]
    D --> E["Click 'Xem kế hoạch bộ mẫu'"]
    E --> F["POST /orders/pull/consolidate-pattern\n{ items, source_factory_id, dest_branch_id }"]

    F --> G["Backend áp dụng FR14-FR17:\nFR14: border_qty = round(body × ratio.border/ratio.main)\nFR15: adjusted_qty = max(0, suggested - cn_current_stock)\nFR16: color_code priority = CN stock → NM latest\nFR17: Greedy bin-pack containers (max 28,000kg)"]

    G --> H["Response: ContainerSuggestionResponse\n{ containers, total_qty, total_kg }"]
    H --> I["ContainerPlanModal mở\nHiện: bộ mẫu đầy đủ, qty điều chỉnh,\nmàu sắc, container groups + utilization bar"]

    I --> J{User review}
    J -->|Hủy| K["Đóng modal, giữ selection"]
    J -->|Xác nhận| L["POST /orders/pull\n{ items: consolidated_items, source_factory_id, dest_branch_id, drp_job_id }"]
    L --> M["Response: PullOrder { status: 'draft' }"]
    M --> N["User click Submit"]
    N --> O["POST /orders/pull/{id}/submit\n→ status: pending_cn"]
    O --> P["NotificationService\ngửi email → cn_head của dest_branch"]

    style G fill:#fff3cd
    style I fill:#d1ecf1
```

**Business rules bổ sung tại bước tạo Pull Order:**

| Rule | FR | Detail |
|------|----|--------|
| Factory available qty | FR24 | `factory_available_qty = tồn_thực − đơn_ghim − PO_đã_duyệt − bể_vỡ` — hiển thị cho planner/vpt_head/bod, ẩn với cn_head |
| Planner adjust individual SKU | FR21 | Planner có thể sửa qty từng SKU tự do — các SKU còn lại trong cùng bộ mẫu **giữ nguyên**, không tự tính lại |
| PO reference | FR33 | Nếu có PO hiện có → Pull Order tham chiếu PO đó để theo dõi: đã kéo / còn lại so với cam kết |

### 5C. CN Head Approval — FR28, FR29, FR30

```mermaid
flowchart TD
    A["cn_head vào /approvals/cn"] --> B["GET /orders/pull?order_status=pending_cn\n(auto-scoped to own branch_id)"]
    B --> C["Hiện danh sách Pull Orders chờ duyệt"]
    C --> D{cn_head review từng order}

    D -->|Muốn điều chỉnh qty| E["PATCH /orders/pull/{id}/items/{item_id}\n{ adjusted_qty, adjustment_reason }\n(Sprint 3: UI inline edit — BE endpoint đã có)"]
    E --> D

    D -->|Approve| F["POST /orders/pull/{id}/approve-cn\n→ status: pending_tcu"]
    F --> G["NotificationService → vpt_head"]

    D -->|Reject| H["Modal nhập reject_reason\n(bắt buộc, không được rỗng)"]
    H --> I["POST /orders/pull/{id}/reject\n{ new_status: 'rejected', reject_reason }"]
    I --> J["status: rejected — FINAL\nKhông thể undo"]

    style J fill:#f8d7da
    style F fill:#d4edda
```

### 5D. TCU Final Approval — FR31, FR32, FR33

```mermaid
flowchart TD
    A["vpt_head vào /approvals/tcu"] --> B["GET /orders/pull?order_status=pending_tcu\n(toàn bộ branches — không scoped)"]
    B --> C["Danh sách Pull Orders đã qua CN\nHighlight lệnh bất thường (SL > 40% avg 4 tuần)"]
    C --> D{TCU review}

    D -->|Xem chi tiết| E["Xem: factory_available_qty, unit_price\nCN head notes, adjusted_qty\nPO reference: đã kéo / còn lại (FR33)"]

    D -->|Bulk approve bình thường| F["Multi-select checkbox\n→ POST /approve-tcu (bulk)\n→ status: approved ✅"]

    D -->|Điều chỉnh SL trước khi duyệt (FR32)| G["Inline edit qty + nhập lý do bắt buộc\nAudit log: before/after + reason"]
    G --> F

    D -->|Reject| H["Nhập reject_reason\n→ POST /reject\n→ status: rejected ❌ (FINAL)"]

    F --> I["Audit log: actor=vpt_head, action=order.final_approved"]
    H --> I

    style F fill:#d4edda
    style H fill:#f8d7da
```

> **FR32:** TCU không chỉ approve/reject — có thể **điều chỉnh số lượng** Pull Order Items trước khi duyệt cuối. Audit log ghi trước/sau + lý do.

---

## 6. Purchase Order Flow

> **PO = "Cam kết mềm" (FR23, prd.md §Phân loại Chứng từ):** PO là tín hiệu để NM lên kế hoạch sản xuất — **không phải cam kết pháp lý**, không phát sinh công nợ. NM tham chiếu PO để sắp xếp lịch; không ràng buộc bên nào. Khác với Pull Order là kéo thật hàng vật lý.

### State Machine

```mermaid
stateDiagram-v2
    [*] --> draft_po : POST /orders/po\n(vpt_planner)\n{ factory_id }
    draft_po --> pending_tcu_po : POST /approve\n(vpt_head — lần 1)
    draft_po --> rejected_po : POST /reject\n(vpt_head)
    pending_tcu_po --> approved_po : POST /approve\n(vpt_head — lần 2)
    pending_tcu_po --> rejected_po : POST /reject\n(vpt_head)
    approved_po --> [*]
    rejected_po --> [*]

    note right of pending_tcu_po
        Two-step: gọi /approve 2 lần
        Lần 1: draft_po → pending_tcu_po
        Lần 2: pending_tcu_po → approved_po
    end note
```

---

## 7. RBAC — Phân quyền theo Role

```mermaid
graph TD
    subgraph ROLES["👥 Roles"]
        P["vpt_planner\n(Kế hoạch viên)"]
        CN["cn_head\n(Trưởng Chi Nhánh)"]
        TCU["vpt_head\n(Trưởng TCU)"]
        BOD["bod\n(Ban Giám Đốc)"]
    end

    subgraph PERMISSIONS["🔐 Permissions → Endpoints"]
        A1["upload_master_data\nPOST /master-data/upload\nPATCH /pattern-ratios/:id"]
        A2["upload_inventory\nPOST /inventory/upload\nPATCH /inventory/:id/factory-empty"]
        A3["trigger_drp\nPOST /drp/compute"]
        A4["create_pull_order\nPOST /orders/pull\nPOST /orders/pull/consolidate-pattern\nGET /drp/suggestions"]
        A5["create_po\nPOST /orders/po"]
        A6["approve_cn\nPOST /orders/pull/:id/approve-cn\nPOST /orders/pull/:id/reject\nPATCH /orders/pull/:id/items/:item_id"]
        A7["approve_tcu\nPOST /orders/pull/:id/approve-tcu\nPOST /orders/po/:id/approve\nPOST /orders/po/:id/reject"]
        A8["view_kpi\nGET /kpi/*\nGET /audit"]
        A9["export_import\nBOD only"]
        A10["view_factory_inventory\nview_price\nFiltered at response level"]
    end

    P -->|✅| A1
    P -->|✅| A2
    P -->|✅| A3
    P -->|✅| A4
    P -->|✅| A5
    CN -->|✅| A6
    TCU -->|✅| A3
    TCU -->|✅| A7
    TCU -->|✅| A8
    TCU -->|✅| A10
    BOD -->|✅| A8
    BOD -->|✅| A9
    BOD -->|✅| A10

    style A6 fill:#fff3cd
    style A7 fill:#d1ecf1
    style A9 fill:#f8d7da
```

**Critical RBAC rules:**

| Rule | Detail |
|------|--------|
| `cn_head` scoping | Auto-filter theo `branch_id` trên mọi `/orders/pull` và `/inventory` endpoints |
| `cn_head` blind | Không thấy `factory_available_qty` và `unit_price` — backend filter at response level |
| `vpt_head` approve-tcu | Không thể approve lệnh ở `pending_cn` — phải qua CN trước |
| Token vô hiệu | `403 Forbidden` — không redirect, không leak data |

---

## 8. DRP Algorithm — Logic cốt lõi

> **Status: FROZEN** — Đã verify ở demo phase. Không được thay đổi logic.
> **File:** `backend/app/services/drp_engine.py::compute_sku_branch()`

```mermaid
flowchart TD
    IN["Input:\nsku { demand_mean, demand_std }\nbranch { lead_days }\nbranch_inventory { quantity }"] --> INIT

    INIT["lead_time_weeks = ceil(lead_days / 7)\nresults = []"]

    INIT --> LOOP["Vòng lặp w = 0 → 12 (13 tuần)"]

    LOOP --> W0{w == 0?}
    W0 -->|Có| BS0["begin_stock = inventory.quantity"]
    W0 -->|Không| BSN["begin_stock = results[w-1].end_stock"]

    BS0 & BSN --> CALC

    CALC["forecast_demand = sku.demand_mean\nsafety_stock = 1.65 × demand_std × √(lead_days/7)\nnet_demand = max(0, forecast + safety - begin)\nhstk = begin / forecast  (99 nếu forecast=0)"]

    CALC --> THRESH{hstk threshold}
    THRESH -->|"< 1.5"| PULL["action = 'PULL'\nsuggested_qty = net_demand\n🔴 Display: STOCKOUT"]
    THRESH -->|"1.5 – 3.0"| OK["action = 'OK'\nsuggested_qty = 0\n🟡 Display: Bình thường"]
    THRESH -->|"> 3.0"| OVER["action = 'OVERSTOCK'\nsuggested_qty = 0\n🟢 Display: Dư tồn"]

    PULL & OK & OVER --> RECEIPT

    RECEIPT{"w >= lead_time_weeks\nVÀ\nresults[w - lead_time_weeks].action == 'PULL'?"}
    RECEIPT -->|Có| PR["planned_receipt = results[w - lead_time_weeks].suggested_qty"]
    RECEIPT -->|Không| PR0["planned_receipt = 0"]

    PR & PR0 --> END["end_stock = begin - forecast + planned_receipt"]
    END --> APPEND["results.append({ week, begin, forecast, safety, net,\nhstk, action, suggested, planned_receipt, end })"]
    APPEND --> NEXT{w < 12?}
    NEXT -->|Có| LOOP
    NEXT -->|Không| OUT["Return results (13 rows)\nbulk INSERT drp_results"]

    style PULL fill:#f8d7da
    style OK fill:#fff3cd
    style OVER fill:#d4edda
```

**HSTK Display Rules (bất biến — áp dụng mọi nơi trên FE):**

| DB `action` | Display Label | Badge Color | CSS Var |
|-------------|--------------|-------------|------|
| `PULL` | **STOCKOUT** | 🔴 Red | `var(--color-red)` |
| `OK` | **Bình thường** | 🟡 Yellow | `var(--color-yellow)` |
| `OVERSTOCK` | **Dư tồn** | 🟢 Green | `var(--color-green)` |

> ⚠️ **Threshold conflict note:** `epics.md` coverage map và `HANDOVER-DEV.md` Phase 2 table ghi OVERSTOCK `> 4 tuần`. Tuy nhiên **4 nguồn khác đồng thuận `> 3.0`** (`prd.md FR35`, `epics.md FR list`, `epics.md Story 3.3`, `architecture.md`). Production sử dụng `> 3.0` — đây là giá trị chính xác. Giá trị `> 4` là lỗi trong coverage map.

> ⚠️ **Forbidden pattern:** Không bao giờ render raw `action` string ("PULL"/"OK"/"OVERSTOCK") trực tiếp ra UI. Luôn dùng `<HSTKBadge action={action} hstk={hstk} />`.

**Pattern Consolidation (CHỈ khi tạo Pull Order — không áp dụng cho forecast):**

```python
border_qty = round(body_qty * ratio.border_qty / ratio.main_qty)
point_qty  = round(body_qty * ratio.point_qty  / ratio.main_qty)
```

---

*system-flows.md v1.1 — TerraX DRP Production | 2026-04-07 | Validated against prd.md + epics.md + HANDOVER-DEV.md*
