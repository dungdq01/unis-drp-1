# TerraX DRP — Data Flow

> **Version:** 1.0 | **Date:** 2026-04-07
> **Source:** Derived from `architecture.md`, `API-DOCS.md`, `business-rules.md`
> **Purpose:** Mô tả luồng dữ liệu từ nguồn đầu vào → qua các lớp xử lý → đến đầu ra cuối cùng. Dùng cho dev backend, DBA, và QA kiểm tra tính toàn vẹn dữ liệu.

---

## Mục lục

1. [Tổng quan Data Flow](#1-tổng-quan-data-flow)
2. [Master Data — Từ Excel đến PostgreSQL](#2-master-data--từ-excel-đến-postgresql)
3. [Inventory Data — Từ Excel đến DB (Idempotent)](#3-inventory-data--từ-excel-đến-db-idempotent)
4. [DRP Compute — Từ DB đến DRP Results](#4-drp-compute--từ-db-đến-drp-results)
5. [Pull Order — Từ DRP Result đến Approved Order](#5-pull-order--từ-drp-result-đến-approved-order)
6. [Audit Trail — Mọi mutation đều được ghi](#6-audit-trail--mọi-mutation-đều-được-ghi)
7. [Data Model Relationships](#7-data-model-relationships)
8. [Data Validation Rules](#8-data-validation-rules)
9. [Data Lifecycle — Vòng đời dữ liệu](#9-data-lifecycle--vòng-đời-dữ-liệu)

---

## 1. Tổng quan Data Flow

```mermaid
flowchart LR
    subgraph INPUT["📥 Nguồn đầu vào"]
        EXCEL_MD["Excel Master Data\n(sku, branches,\npattern_ratios)"]
        EXCEL_INV["Excel Inventory\n(sku × branch × color)"]
        ERP["ERP Bravo API\n(Phase 2 — future)"]
    end

    subgraph INGEST["🔄 Ingestion Layer"]
        ADAPTER["ExcelIngestionAdapter\n/ BravoAPIAdapter"]
        VALIDATE["Column Validation\n+ Type Coercion"]
        IDEM["Idempotency Check\nSHA-256 key"]
    end

    subgraph DB["💾 PostgreSQL"]
        T_SKU["sku"]
        T_BRANCH["branches"]
        T_PATTERN["pattern_ratios"]
        T_INV["inventory"]
        T_DRP_JOB["drp_jobs"]
        T_DRP_RES["drp_results"]
        T_PULL["pull_orders\n+ pull_order_items"]
        T_PO["purchase_orders"]
        T_AUDIT["audit_log\n(append-only)"]
    end

    subgraph COMPUTE["⚙️ DRP Engine (Celery)"]
        ENGINE["compute_sku_branch()\n5000 × 70 × 13"]
    end

    subgraph OUTPUT["📤 Đầu ra"]
        WORKBENCH["DRP Workbench\n13-week table"]
        ALERTS["STOCKOUT /\nOVERSTOCK Alerts"]
        ORDERS["Pull Orders /\nPurchase Orders"]
        KPI["KPI Dashboard"]
    end

    EXCEL_MD --> ADAPTER
    EXCEL_INV --> ADAPTER
    ERP -.->|Phase 2| ADAPTER
    ADAPTER --> VALIDATE
    VALIDATE --> IDEM
    IDEM --> T_SKU & T_BRANCH & T_PATTERN
    IDEM --> T_INV

    T_SKU & T_BRANCH & T_INV --> ENGINE
    ENGINE --> T_DRP_RES
    ENGINE --> T_DRP_JOB

    T_DRP_RES --> WORKBENCH
    T_DRP_RES --> ALERTS
    T_DRP_RES --> ORDERS
    T_DRP_JOB & T_PULL & T_PO --> KPI
    T_AUDIT --> KPI

    style T_AUDIT fill:#fff3cd
    style ENGINE fill:#d1ecf1
```

---

## 2. Master Data — Từ Excel đến PostgreSQL

### Input Format

| Sheet | Cột bắt buộc | Cột tùy chọn |
|-------|-------------|--------------|
| `sku` | `sku_code`, `sku_name`, `pattern_group`, `pattern_role`, `demand_mean`, `demand_std`, `unit`, `weight_kg` | — |
| `branches` | `code`, `name`, `type` (NM/CN), `region`, `lead_days` | — |
| `pattern_ratios` | `pattern_group`, `factory_code`, `main_qty`, `border_qty`, `point_qty`, `effective_date` | — |

### Upload Pipeline — 3 Sheet Song Song

```mermaid
flowchart TD
    START["POST /api/v1/master-data/upload\nFile: master_data.xlsx"] --> PARSE["ExcelIngestionAdapter\nopenpyxl read_workbook()\nExtract 3 sheets"]

    PARSE --> S1["Sheet: sku"] & S2["Sheet: branches"] & S3["Sheet: pattern_ratios"]

    S1 --> V1{"Validate sku:\n✓ required cols?\n✓ pattern_role ∈ {main, border, point}\n✓ demand_mean / demand_std / weight_kg\n  → cưỡng chế NUMERIC"}
    S2 --> V2{"Validate branches:\n✓ required cols?\n✓ type ∈ {NM, CN}\n✓ lead_days → INTEGER\n✓ region không rỗng"}
    S3 --> V3{"Validate pattern_ratios:\n✓ required cols?\n✓ effective_date → DATE\n✓ main_qty / border_qty / point_qty > 0\n✓ factory_code khớp branches.code"}

    V1 -->|"Lỗi"| ERR["errors[]\n{ row, field, message }\n→ Response 422\nKhông ghi gì vào DB"]
    V2 -->|"Lỗi"| ERR
    V3 -->|"Lỗi"| ERR

    V1 -->|"OK"| U1["UPSERT sku\nON CONFLICT (sku_code) DO UPDATE\nSET sku_name, pattern_group, pattern_role,\n    demand_mean, demand_std, weight_kg,\n    updated_at = now()"]
    V2 -->|"OK"| U2["UPSERT branches\nON CONFLICT (code) DO UPDATE\nSET name, type, region, lead_days,\n    updated_at = now()"]
    V3 -->|"OK"| U3["INSERT pattern_ratios\n(append-only — không update bản cũ)\nON CONFLICT (pattern_group, factory_id, effective_date)\nDO NOTHING"]

    U1 & U2 & U3 --> AUDIT["AuditMiddleware\nINSERT audit_log\nmodule=master_data, action=uploaded\nrecords_created, records_skipped"]
    AUDIT --> RESP["Response 200\n{ records_created: N, records_skipped: M, errors: [] }"]

    style ERR fill:#f8d7da
    style U1 fill:#d4edda
    style U2 fill:#d4edda
    style U3 fill:#d4edda
    style AUDIT fill:#fff3cd
```

### Pattern Ratio Versioning — Append-only theo `effective_date`

> **Rule:** Mỗi lần tỷ lệ bộ mẫu thay đổi (theo NM, theo tháng) → upload bản mới với `effective_date` mới. DRP Engine luôn lấy bản gần nhất có `effective_date <= today`.

```mermaid
flowchart LR
    subgraph TABLE["pattern_ratios table (cùng pattern_group + factory NM-A)"]
        direction TB
        R1["effective_date: 2026-01-01\nmain:border:point = 10:1:1"]
        R2["effective_date: 2026-04-01\nmain:border:point = 8:1:1"]
        R3["effective_date: 2026-07-01\nmain:border:point = 6:1:2"]
    end

    TODAY["today = 2026-04-07"] --> QUERY
    TABLE --> QUERY["SELECT *\nWHERE effective_date <= today\nORDER BY effective_date DESC\nLIMIT 1"]

    QUERY --> RESULT["Sử dụng: 8:1:1\n(bản 2026-04-01)\n\nBản 2026-07-01 chưa có hiệu lực"]
    QUERY --> SKIP["Bỏ qua: 2026-07-01\n(effective_date > today)"]

    style RESULT fill:#d4edda
    style SKIP fill:#f8d7da
    style R2 fill:#d4edda
    style R3 fill:#fff3cd
```

---

## 3. Inventory Data — Từ Excel đến DB (Idempotent)

### Idempotency Design

```mermaid
flowchart TD
    A["Row từ Excel:\nsku_code=GAC-001\nbranch_code=CN-HCM\ncolor_code=W01\ndate=2026-04-07"] --> B

    B["Tính idempotency_key:\nSHA256('GAC-001:CN-HCM:W01:2026-04-07')"]
    B --> C["= 'a3f9b2...' (64 char hex)"]

    C --> D{SELECT FROM inventory\nWHERE idempotency_key = 'a3f9b2...'}
    D -->|Row tồn tại| E["SKIP row\nrecords_skipped++\nKhông ghi đè dữ liệu cũ"]
    D -->|Không tồn tại| F["INSERT inventory:\n{ sku_id (lookup), branch_id (lookup),\ncolor_code, quantity, inv_type,\nsource='excel', idempotency_key,\nrecorded_at=now() }"]

    F --> G["UNIQUE constraint đảm bảo\nkhông có duplicate ở DB level"]
    E --> H["Response: { records_created, records_skipped, errors }"]
    G --> H
```

### Inventory Data Fields

| Field | Type | Source | Note |
|-------|------|--------|------|
| `sku_id` | UUID FK | Lookup by `sku_code` | Lỗi nếu sku_code không tồn tại |
| `branch_id` | UUID FK | Lookup by `branch_code` | Lỗi nếu branch_code không tồn tại |
| `quantity` | NUMERIC | Excel column | Giá trị >= 0 |
| `inv_type` | VARCHAR | Excel column | `oem` hoặc `distribution` |
| `color_code` | VARCHAR | Excel column | Màu gốm |
| `is_factory_empty` | BOOLEAN | Manual flag | `PATCH /inventory/:id/factory-empty` |
| `idempotency_key` | VARCHAR UNIQUE | SHA-256 computed | Prevent duplicate sync |
| `source` | VARCHAR | Set by adapter | `excel` \| `bravo_api` |
| `recorded_at` | TIMESTAMP | `now()` | Thời điểm ghi nhận |

### FR08 — Phân biệt Tồn OEM và Tồn Phân phối (prd.md §Ràng buộc Tồn Nhà máy)

| Loại tồn | `inv_type` | Định nghĩa | Độ tin cậy |
|----------|-----------|------------|------------|
| **Tồn OEM** | `oem` | UNIS đặt NM sản xuất riêng | Số chính xác — NM cung cấp đủ visibility |
| **Tồn Phân phối** | `distribution` | NM sản xuất cho nhiều bên | Số ước tính — NM không cung cấp số thật cho UNIS |

**Rule:** UI phải hiển thị badge phân biệt rõ 2 loại ("Chính xác" vs "Ước tính"). Khi NM hết hàng OEM → Planner xác nhận thủ công `is_factory_empty = true` — hệ thống không tự động hủy đơn (FR10).

---

## 4. DRP Compute — Từ DB đến DRP Results

### Data Read Phase

```mermaid
flowchart TD
    TRIGGER["POST /drp/compute\ntriggered_by = user_id"] --> JOB["INSERT drp_jobs\n{ status='queued', triggered_by }"]
    JOB --> CELERY["Celery task: drp_compute(job_id)"]

    CELERY --> READ1["SELECT * FROM sku\n(all active SKUs — 5000)"]
    CELERY --> READ2["SELECT * FROM branches\nWHERE type='CN'\n(all distribution branches — ~70)"]
    CELERY --> READ3["SELECT * FROM inventory\nWHERE branch_id IN (all CN branches)\nJOIN sku\nLatest recorded_at per (sku_id, branch_id)"]

    READ1 & READ2 & READ3 --> PAIR["Cross join: 5000 SKU × 70 CN\n= 350,000 pairs\nFor each pair → compute_sku_branch()"]
```

### Compute Phase (Per SKU × Branch Pair)

```mermaid
flowchart TD
    IN["Input values:\nsku.demand_mean (μ)\nsku.demand_std (σ)\nbranch.lead_days\nbranch_inventory.quantity (Q0)"] --> W0["Tuần 0:\nbegin_stock = Q0"]

    W0 --> LOOP["Loop w = 0..12"]
    LOOP --> F1["forecast_demand = μ"]
    F1 --> F2["safety_stock = 1.65 × σ × √(lead_days/7)"]
    F2 --> F3["net_demand = max(0, μ + safety - begin_stock)"]
    F3 --> F4["hstk = begin_stock / μ\n(= 99 nếu μ = 0)"]
    F4 --> F5{hstk value}
    F5 -->|"< 1.5"| ACT_PULL["action='PULL'\nsuggested_qty = net_demand"]
    F5 -->|"1.5–3.0"| ACT_OK["action='OK'\nsuggested_qty = 0"]
    F5 -->|"> 3.0"| ACT_OVER["action='OVERSTOCK'\nsuggested_qty = 0"]
    ACT_PULL & ACT_OK & ACT_OVER --> F6

    F6["lead_time_weeks = ceil(lead_days/7)\nplanned_receipt = results[w-lead_time_weeks].suggested_qty\n  IF w >= lead_time_weeks\n  AND results[w-lead_time_weeks].action == 'PULL'\n  ELSE 0"]
    F6 --> F7["end_stock = begin_stock - μ + planned_receipt"]
    F7 --> STORE["Append result row:\n{ week, begin, forecast, safety, net,\nhstk, action, suggested, planned_receipt, end }"]
    STORE --> NEXT{w < 12?}
    NEXT -->|Có| LOOP
    NEXT -->|Không| INSERT["bulk INSERT drp_results\n(13 rows per pair)"]

    style ACT_PULL fill:#f8d7da
    style ACT_OK fill:#fff3cd
    style ACT_OVER fill:#d4edda
```

### Write Phase

```mermaid
flowchart TD
    A["350,000 result rows computed"] --> B["bulk INSERT drp_results\n(batch size 1000 rows)"]
    B --> C["UPDATE drp_jobs\nSET status='done'\nSET completed_at=now()"]
    C --> D["SET Redis key:\njob:{job_id}:status = 'done'"]
    D --> E["NotificationService:\nKiểm tra có SKU action=PULL\nvới hstk < threshold → trigger alert"]
```

### DRP Results Schema

| Field | Type | Mô tả |
|-------|------|--------|
| `job_id` | UUID FK | Link về drp_jobs |
| `sku_id` | UUID FK | SKU được tính |
| `branch_id` | UUID FK | CN được tính |
| `week` | INTEGER (0-12) | Tuần trong 13-week horizon |
| `begin_stock` | NUMERIC | Tồn đầu tuần |
| `forecast_demand` | NUMERIC | = `sku.demand_mean` |
| `safety_stock` | NUMERIC | 1.65 × σ × √(L/7) |
| `net_demand` | NUMERIC | max(0, forecast + safety - begin) |
| `hstk` | NUMERIC | begin / forecast |
| `action` | VARCHAR | `PULL` \| `OK` \| `OVERSTOCK` |
| `suggested_qty` | NUMERIC | net_demand nếu PULL, else 0 |
| `planned_receipt` | NUMERIC | Nhận hàng dự kiến từ lệnh trước |
| `end_stock` | NUMERIC | begin - forecast + planned_receipt |

---

## 5. Pull Order — Từ DRP Result đến Approved Order

### Data Transformation Pipeline

```mermaid
flowchart TD
    SRC["drp_results\naction='PULL', week=0\nsorted hstk ASC"] --> SUGG["GET /drp/suggestions\nResponse: DRPTableResponse\n(suggested_qty per SKU per branch)"]

    SUGG --> CONSOL["POST /consolidate-pattern\n{ items: [{ sku_id, qty }],\nsource_factory_id, dest_branch_id }"]

    CONSOL --> ENRICH["Enrichment steps:"]
    ENRICH --> E0["FR24 — Factory available qty (Planner/TCU/BOD only):\nfactory_available_qty = tồn_thực − đơn_ghim − PO_đã_duyệt − bể_vỡ\nẨn với cn_head tại response level"]
    ENRICH --> E1["FR14 — Pattern expand:\nborder_qty = round(body × ratio.border / ratio.main)\npoint_qty = round(body × ratio.point / ratio.main)"]
    ENRICH --> E2["FR15 — Soft commitment:\nadjusted_qty = max(0, suggested_qty - cn_current_stock)"]
    ENRICH --> E3["FR16 — Color selection:\n1st: color với qty > 0 tại CN\n2nd: color mới nhất tại NM (recorded_at DESC)"]
    ENRICH --> E4["FR17 — Container bin-pack:\nGreedy fill containers 28,000kg max\nMin 1 container"]
    ENRICH --> E5["FR33 — PO reference (nếu có PO hiện có):\nPull Order link tới PO để track:\nđã kéo bao nhiêu / còn lại so với cam kết PO"]

    E1 & E2 & E3 & E4 --> MODAL["ContainerSuggestionResponse\n→ ContainerPlanModal (FE)"]

    MODAL --> CREATE["POST /orders/pull\n→ INSERT pull_orders { status='draft' }\n→ INSERT pull_order_items ×N"]
    CREATE --> SUBMIT["POST /submit\n→ UPDATE status = 'pending_cn'"]
    SUBMIT --> CN_APPROVE["POST /approve-cn\n→ UPDATE status = 'pending_tcu'\n(cn_head can PATCH item qty before approving)"]
    CN_APPROVE --> TCU_APPROVE["POST /approve-tcu\n→ UPDATE status = 'approved'"]

    TCU_APPROVE --> FINAL["pull_orders.status = 'approved'\npull_order_items.adjusted_qty FINAL"]
```

### Order Item Data Flow

| Stage | `suggested_qty` | `adjusted_qty` | Actor | Source |
|-------|----------------|----------------|-------|--------|
| From DRP | `net_demand` | = `suggested_qty` | — | drp_results |
| After consolidate (FR15) | unchanged | `max(0, suggested - cn_stock)` | System | Backend service |
| After CN adjustment (FR29) | unchanged | User input | `cn_head` | `PATCH /items/:id` |
| After TCU adjustment (FR32) | unchanged | User input + reason | `vpt_head` | `PATCH /items/:id` |
| Approved | unchanged | **Final value** | — | Locked |

---

## 6. Audit Trail — Mọi mutation đều được ghi

Mọi request `POST`/`PATCH`/`DELETE` đi qua `AuditMiddleware` → tự động INSERT vào `audit_log`.

```mermaid
flowchart LR
    REQ["HTTP Request\nPOST/PATCH/DELETE"] --> MW["AuditMiddleware\n(chạy sau JWT auth)"]
    MW --> BEFORE["Đọc state BEFORE từ DB\n(nếu là update/delete)"]
    BEFORE --> HANDLER["Route Handler\nThực hiện mutation"]
    HANDLER --> AFTER["Đọc state AFTER từ DB"]
    AFTER --> INSERT["INSERT audit_log\n{ actor_id (từ JWT),\nmodule, action,\nentity_type, entity_id,\nbefore_value JSONB,\nafter_value JSONB,\nip_address,\ncreated_at=now() }"]
    INSERT --> RESP["Response → Client"]
```

### Audit Log Schema

| Field | Ví dụ | Note |
|-------|-------|------|
| `actor_id` | `uuid-user-123` | Từ JWT token |
| `module` | `orders` \| `master_data` \| `inventory` \| `drp` | |
| `action` | `POST` \| `PATCH` \| `DELETE` | HTTP method |
| `entity_type` | `pull_order` \| `sku` \| `inventory` | |
| `entity_id` | `uuid-order-456` | |
| `before_value` | `{"status": "draft"}` | JSONB — null nếu CREATE |
| `after_value` | `{"status": "pending_cn"}` | JSONB |
| `ip_address` | `10.0.0.42` | |
| `created_at` | `2026-04-07T10:30:00` | |

> ⚠️ **Append-only constraint:** Không có `UPDATE` hoặc `DELETE` nào được phép trên bảng `audit_log` ở DB level. Enforced bằng PostgreSQL trigger hoặc revoke privilege.

---

## 7. Data Model Relationships

```mermaid
erDiagram
    users {
        UUID id PK
        VARCHAR username UK
        VARCHAR hashed_password
        VARCHAR role
        UUID branch_id FK
        BOOLEAN is_active
    }

    sku {
        UUID id PK
        VARCHAR sku_code UK
        VARCHAR sku_name
        VARCHAR pattern_group
        VARCHAR pattern_role
        NUMERIC demand_mean
        NUMERIC demand_std
        VARCHAR unit
        NUMERIC weight_kg
    }

    branches {
        UUID id PK
        VARCHAR code UK
        VARCHAR name
        VARCHAR type
        VARCHAR region
        INTEGER lead_days
    }

    pattern_ratios {
        UUID id PK
        VARCHAR pattern_group
        UUID main_sku_id FK
        NUMERIC border_qty
        NUMERIC point_qty
        NUMERIC main_qty
        DATE effective_date
        UUID factory_id FK
    }

    inventory {
        UUID id PK
        UUID sku_id FK
        UUID branch_id FK
        NUMERIC quantity
        VARCHAR inv_type
        VARCHAR color_code
        BOOLEAN is_factory_empty
        VARCHAR idempotency_key UK
        VARCHAR source
        TIMESTAMP recorded_at
    }

    drp_jobs {
        UUID id PK
        VARCHAR status
        UUID triggered_by FK
        TIMESTAMP started_at
        TIMESTAMP completed_at
        TEXT error_message
    }

    drp_results {
        UUID id PK
        UUID job_id FK
        UUID sku_id FK
        UUID branch_id FK
        INTEGER week
        NUMERIC hstk
        VARCHAR action
        NUMERIC suggested_qty
        NUMERIC end_stock
    }

    pull_orders {
        UUID id PK
        VARCHAR status
        UUID created_by FK
        UUID source_factory_id FK
        UUID dest_branch_id FK
        UUID drp_job_id FK
        TEXT reject_reason
    }

    pull_order_items {
        UUID id PK
        UUID order_id FK
        UUID sku_id FK
        VARCHAR color_code
        NUMERIC suggested_qty
        NUMERIC adjusted_qty
        TEXT adjustment_reason
    }

    purchase_orders {
        UUID id PK
        VARCHAR status
        UUID created_by FK
        UUID factory_id FK
        TEXT reject_reason
    }

    audit_log {
        UUID id PK
        UUID actor_id FK
        VARCHAR module
        VARCHAR action
        VARCHAR entity_type
        UUID entity_id
        JSONB before_value
        JSONB after_value
        VARCHAR ip_address
        TIMESTAMP created_at
    }

    users ||--o{ pull_orders : "created_by"
    users ||--o{ drp_jobs : "triggered_by"
    users ||--o{ audit_log : "actor_id"
    branches ||--o{ users : "branch_id"
    branches ||--o{ inventory : "branch_id"
    branches ||--o{ drp_results : "branch_id"
    branches ||--o{ pull_orders : "source / dest"
    sku ||--o{ inventory : "sku_id"
    sku ||--o{ drp_results : "sku_id"
    sku ||--o{ pull_order_items : "sku_id"
    sku ||--o{ pattern_ratios : "main_sku_id"
    drp_jobs ||--o{ drp_results : "job_id"
    drp_jobs ||--o{ pull_orders : "drp_job_id"
    pull_orders ||--o{ pull_order_items : "order_id"
```

---

## 8. Data Validation Rules

### Master Data

| Rule | Field | Constraint |
|------|-------|-----------|
| `pattern_role` chỉ 3 giá trị | `sku.pattern_role` | `IN ('main', 'border', 'point')` |
| `branch.type` chỉ NM/CN | `branches.type` | `IN ('NM', 'CN')` |
| `demand_mean >= 0` | `sku.demand_mean` | `CHECK demand_mean >= 0` |
| `lead_days > 0` | `branches.lead_days` | `CHECK lead_days > 0` |
| `effective_date` là ngày hợp lệ | `pattern_ratios.effective_date` | `DATE format YYYY-MM-DD` |
| Pattern ratio: lấy bản mới nhất | `pattern_ratios` | `effective_date <= today ORDER BY DESC LIMIT 1` |

### Inventory

| Rule | Detail |
|------|--------|
| `inv_type` | `IN ('oem', 'distribution')` |
| `quantity >= 0` | Không có tồn kho âm |
| `idempotency_key` UNIQUE | Ngăn duplicate insert tuyệt đối |
| `sku_code` phải tồn tại | Foreign key check → error nếu không match |
| `branch_code` phải tồn tại | Foreign key check → error nếu không match |

### Pull Order

| Rule | Detail |
|------|--------|
| Status machine | Chỉ được chuyển theo thứ tự: draft→pending_cn→pending_tcu→approved |
| `reject_reason` bắt buộc | `len(reject_reason.strip()) > 0` khi reject |
| CN rejection FINAL | Không thể undo, không thể escalate (FR30) |
| `adjusted_qty >= 0` | Không cho phép qty âm khi CN adjust |
| `cn_head` scoping | `branch_id` trong JWT phải match `dest_branch_id` của order |

### DRP Algorithm

| Rule | Detail |
|------|--------|
| `hstk = 99` khi `demand_mean = 0` | Tránh chia cho 0 |
| Pattern ratio NOT applied to forecast | `forecast_demand = sku.demand_mean` — ratio chỉ dùng khi tạo Pull Order |
| `safety_stock` dựa trên `lead_days` | North: 14 days → 2 weeks; South: 3 days → 0.43 weeks |
| `planned_receipt` lookback | Chỉ nhận hàng từ tuần có action=PULL, cách `lead_time_weeks` tuần |

---

## 9. Data Lifecycle — Vòng đời dữ liệu

```mermaid
gantt
    title Vòng đời dữ liệu trong 1 chu kỳ kế hoạch (2 tuần)
    dateFormat YYYY-MM-DD
    axisFormat %d/%m

    section Master Data
    Upload + validate SKU/Branch/Pattern   :md1, 2026-04-07, 1d
    Hiệu lực đến hết kỳ                   :md2, after md1, 13d

    section Inventory
    Upload snapshot inventory             :inv1, 2026-04-07, 1d
    Idempotency key lock (1 ngày)         :inv2, after inv1, 1d

    section DRP Jobs
    Job queued → running → done           :drp1, 2026-04-08, 1h
    drp_results lưu 13 tuần              :drp2, after drp1, 13d

    section Pull Orders
    Draft → Submit → CN Approve           :po1, 2026-04-08, 3d
    TCU Approve → FINAL                   :po2, after po1, 2d

    section Audit Log
    Ghi nhận toàn bộ — Vĩnh viễn          :audit, 2026-04-07, 20d
```

### Retention Policy (đề xuất)

| Table | Giữ bao lâu | Lý do |
|-------|------------|-------|
| `drp_results` | 3 tháng (90 ngày) | Phân tích xu hướng HSTK |
| `drp_jobs` | 3 tháng | Tracking job history |
| `inventory` | Vĩnh viễn | Source of truth + idempotency |
| `pull_orders` + items | Vĩnh viễn | Compliance + truy xuất |
| `purchase_orders` | Vĩnh viễn | Compliance |
| `audit_log` | Vĩnh viễn, append-only | Immutable — không xóa |
| `sku` / `branches` | Vĩnh viễn | Master data |

### Data Dependencies (thứ tự cần thiết khi init)

```
1. branches (cần trước inventory, trước pull_orders)
2. sku (cần trước inventory, trước drp_results, trước pull_order_items)
3. users (cần trước drp_jobs, trước pull_orders, trước audit_log)
4. pattern_ratios (cần sau sku + branches)
5. inventory (cần sau sku + branches)
6. drp_jobs + drp_results (cần sau sku + branches + inventory)
7. pull_orders + pull_order_items (cần sau drp_results + branches + sku + users)
8. purchase_orders (cần sau users + branches)
```

---

*data-flow.md v1.1 — TerraX DRP Production | 2026-04-07 | Validated against prd.md + epics.md + HANDOVER-DEV.md*
