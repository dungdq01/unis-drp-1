# UNIS DRP — Architecture Proposal

**Version:** 1.1 | **Date:** 2026-04-13  
**Author:** Tech Lead — Smartlog AI Division  
**Status:** DRAFT v1.1 — 7 Gaps Fixed, Pending Team Review  
**Reviewers:** PM, BA, FE Lead, Data Engineer, DevOps  
**Changelog:** v1.0 → v1.1: Fix port conflict, auth moved to Phase 2, Python integration redesign, Bravo scope clarified, approval 2-step, policy CRUD, supply 4-bucket model

---

## 1. Bối cảnh & Lý do tách codebase

### 1.1 Hiện trạng

Hệ thống SCP/DRP hiện tại (PRJ-SCP-001) được thiết kế **multi-tenant** phục vụ 3 khách hàng: Mondelez (FMCG), TTC Agris (Nông sản), UNIS (Vật liệu xây dựng). Kiến trúc sử dụng Python FastAPI monolith, Kafka event bus, Redis cache, Plugin pattern cho tenant isolation.

### 1.2 Vấn đề

| # | Vấn đề | Impact |
|---|--------|--------|
| 1 | UNIS là **vật liệu xây dựng** — domain khác biệt cơ bản so với FMCG/Nông sản | Logic FEFO, BOM, shelf-life không áp dụng |
| 2 | UNIS cần **variant matching** (màu/size gạch) — không tồn tại ở MDLZ/TTC | Plugin pattern không đủ flexible |
| 3 | UNIS đi **UAT trước** — cần iterate nhanh, không ảnh hưởng tenant khác | Risk khi deploy shared codebase |
| 4 | Codebase cũ quá phức tạp cho 1 tenant: Kafka, Redis, RLS, Plugin registry | Over-engineering cho single-tenant |
| 5 | Backend folder `/unis/backend/` hiện **rỗng** — cơ hội build đúng từ đầu | Không có legacy debt |

### 1.3 Quyết định

> **Build codebase UNIS độc lập.** Giữ lại 8-step pipeline framework + coding standards.  
> Bỏ: multi-tenant, Kafka, Redis, Plugin pattern, RLS.  
> Đơn giản hóa tối đa, phù hợp đặc thù ngành vật liệu xây dựng.

---

## 2. Tech Stack

### 2.1 Stack Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     UNIS DRP System                          │
├──────────────┬──────────────────┬───────────────────────────┤
│  DATA Layer  │    API Layer     │        WEB Layer           │
│  Python 3.12 │    NestJS 10     │      Next.js 14            │
│              │    TypeScript    │      React + Tailwind       │
│  pandas      │    TypeORM       │      shadcn/ui + Lucide     │
│  statsforecast│   PostgreSQL    │      TypeScript             │
├──────────────┴──────────────────┴───────────────────────────┤
│                     PostgreSQL 16                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Lý do chọn từng tech

| Layer | Tech | Lý do |
|-------|------|-------|
| **DATA** | Python 3.12 | Hệ sinh thái ML/forecast mạnh nhất (statsforecast, pandas, numpy). Xử lý CSV/Excel native. |
| **API** | NestJS (TypeScript) | Layered architecture built-in (Module → Controller → Service → Repository). Decorator-based, type-safe. Cộng đồng lớn. |
| **ORM** | TypeORM | NestJS native integration, migration support, repository pattern. |
| **DB** | PostgreSQL 16 | Proven cho supply chain data. JSON support, window functions cho DRP calc. |
| **WEB** | Next.js 14 | App Router, Server Components cho data-heavy tables. Đã có shell FE sẵn. |
| **UI** | shadcn/ui + Tailwind + Lucide | Copy-paste components, không vendor lock. Consistent design system. |

### 2.3 Những gì KHÔNG dùng (so với codebase cũ)

| Bỏ | Lý do |
|----|-------|
| Kafka | Single-tenant, không cần event bus. Pipeline chạy sequential. |
| Redis | Không cần cache/dedup. DB query đủ nhanh cho 2,412 items. |
| RLS (Row-Level Security) | Single-tenant — không cần tenant isolation. |
| Plugin pattern | 1 tenant = logic viết trực tiếp, không abstract. |
| Celery | NestJS Bull queue nếu cần async (Phase 2). Giai đoạn đầu sync đủ. |
| FastAPI | Thay bằng NestJS. Python chỉ xử lý data. |
| Microservices | Monolith modular — 1 NestJS app, chia module rõ ràng. |

---

## 3. Kiến trúc tổng thể

### 3.1 System Architecture

```
                    ┌──────────────────────────────┐
                    │       UNIS DRP System         │
                    └──────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
   ┌─────────────┐      ┌────────────────┐      ┌──────────────┐
   │ DATA Layer  │      │  API Layer     │      │  WEB Layer   │
   │ (Python)    │      │  (NestJS)      │      │  (Next.js)   │
   │             │      │                │      │              │
   │ - Forecast  │      │ - REST API     │      │ - Dashboard  │
   │ - ETL/Clean │ ───▶ │ - 8 modules    │ ◀── │ - 8 screens  │
   │ - Seed DB   │  DB  │ - Validation   │ HTTP │ - Tables     │
   │ - Batch run │      │ - Business     │      │ - Charts     │
   └─────────────┘      └────────────────┘      └──────────────┘
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  ▼
                         ┌────────────────┐
                         │  PostgreSQL 16 │
                         │                │
                         │ - Master data  │
                         │ - Pipeline     │
                         │ - Orders       │
                         │ - Audit log    │
                         └────────────────┘
```

### 3.2 Data Flow — Cách 3 layers giao tiếp

```
Phase 1: DATA PROCESSING (Python — batch/scheduled)
═══════════════════════════════════════════════════
  CSV/Excel ──▶ Python scripts ──▶ PostgreSQL tables
  
  Cụ thể:
  - Import master data (items, branches, warehouses, RTM rules)
  - Import forecast CSV → demand_snapshot + demand_lines
  - Import inventory CSV → supply_snapshot + supply_lines
  - Compute safety stock → policy tables
  - Run DRP netting → drp_plan + drp_lines + exceptions
  - Run allocation → allocation_run + allocation_results
  - Generate transport plans → transport_plan + trips
  
  Output: Data nằm trong PostgreSQL, sẵn sàng cho API đọc.


Phase 2: API SERVING (NestJS — always running)
═══════════════════════════════════════════════
  Next.js ──HTTP──▶ NestJS ──TypeORM──▶ PostgreSQL
  
  Cụ thể:
  - CRUD operations (list, detail, create, update)
  - Trigger pipeline steps (POST /api/pipeline/trigger/:step)
  - Business validation (approve, reject, submit orders)
  - Aggregation queries (KPIs, summaries, comparisons)
  
  NestJS KHÔNG chạy heavy computation.
  NestJS ghi signal vào pipeline_steps table → Python worker pickup & execute (xem §3.3).


Phase 3: UI RENDERING (Next.js — always running)
═══════════════════════════════════════════════════
  Browser ──▶ Next.js ──fetch──▶ NestJS API
  
  Cụ thể:
  - Server Components: fetch data at build/request time
  - Client Components: interactive tables, forms, charts
  - No direct DB access — always through API
```

### 3.3 Python ↔ NestJS Integration

> **⚠️ Design Decision (v1.1):** KHÔNG dùng `child_process.exec()` để gọi Python.
> Lý do: error handling phức tạp, process leak, Windows path issues, no timeout.

```
Phương án chính: DB-based coordination (Signal Table Pattern)
═══════════════════════════════════════════════════════════════

  ┌──────────┐        ┌──────────────┐        ┌──────────────┐
  │ Next.js  │──HTTP─▶│   NestJS     │──SQL──▶│ PostgreSQL   │
  │ (UI)     │        │   (API)      │        │              │
  └──────────┘        └──────────────┘        │ pipeline_runs│
                                               │ status=TRIG  │
                                               └──────┬───────┘
                                                      │
  ┌──────────┐                                        │ poll
  │ Python   │◀───────────────────────────────────────┘
  │ Worker   │  reads TRIGGERED → runs step → writes COMPLETED
  └──────────┘

  Flow chi tiết:
  1. User click "Run DRP" trên UI
  2. Next.js → POST /api/pipeline/trigger/drp
  3. NestJS INSERT pipeline_steps SET status='TRIGGERED', step='drp'
  4. NestJS return 202 { runId, status: 'TRIGGERED' }
  5. Python worker (chạy liên tục hoặc cron) poll pipeline_steps WHERE status='TRIGGERED'
  6. Python pickup → status='RUNNING' → execute step4_drp.py → status='COMPLETED'/'FAILED'
  7. UI poll GET /api/pipeline/status → NestJS đọc pipeline_steps → hiển thị progress

  Ưu điểm:
  ✅ Không process leak (Python là process riêng)
  ✅ Error handling rõ ràng (status + error_message column)
  ✅ Cross-platform (không depend Windows/Linux path)
  ✅ Timeout tự nhiên (Python tự handle, ghi status='TIMEOUT')
  ✅ Restart-safe (Python re-poll khi start lại)


Phương án batch: Cron nightly (song song)
════════════════════════════════════════════
  
  Cron 23:00 ICT → python data/pipelines/run_all.py
       │
       ▼
  Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7 → Step 8
       │         │         │         │
       ▼         ▼         ▼         ▼
  Write results to PostgreSQL at each step
  Update pipeline_steps status at each step
       │
       ▼
  Next morning: NestJS API serves fresh data → Next.js displays

  Cả 2 phương án chạy song song:
  - Nightly batch: auto run full pipeline
  - UI trigger: manual re-run step cụ thể khi cần
```

---

## 4. Folder Structure

```
unis/
│
├── data/                           ← PYTHON LAYER
│   ├── pipelines/                  ← 8 step scripts
│   │   ├── step1_demand.py         ← Forecast CSV → demand tables
│   │   ├── step2_supply.py         ← Inventory CSV → supply tables
│   │   ├── step3_policy.py         ← SS computation → policy tables
│   │   ├── step4_drp.py            ← DRP netting (PAB, planned orders)
│   │   ├── step5_allocation.py     ← RTM matching, ABC fair-share
│   │   ├── step6_transport.py      ← Container packing, trip planning
│   │   ├── step7_execution.py      ← Draft orders generation
│   │   ├── step8_monitor.py        ← KPI computation, alert detection
│   │   └── run_all.py              ← Sequential pipeline runner
│   │
│   ├── processors/                 ← Reusable data functions
│   │   ├── csv_loader.py           ← CSV/Excel → DataFrame
│   │   ├── validator.py            ← Data quality checks
│   │   ├── forecast.py             ← Holt-Winters, Croston-SBA
│   │   └── safety_stock.py         ← SS formula (variance-based)
│   │
│   ├── config.py                   ← DB connection, UNIS constants
│   ├── db.py                       ← SQLAlchemy engine (write to PG)
│   └── requirements.txt            ← pandas, sqlalchemy, statsforecast, psycopg2
│
├── backend/                        ← NESTJS API LAYER
│   ├── src/
│   │   ├── app.module.ts           ← Root module (imports all 8 + master + pipeline)
│   │   ├── main.ts                 ← Bootstrap (port 3001, CORS, validation pipe)
│   │   │
│   │   ├── common/                 ← Cross-cutting concerns
│   │   │   ├── config/
│   │   │   │   └── database.config.ts     ← TypeORM PG connection
│   │   │   ├── dto/
│   │   │   │   ├── pagination.dto.ts      ← page, pageSize, total
│   │   │   │   └── api-response.dto.ts    ← { data, pagination, meta }
│   │   │   ├── filters/
│   │   │   │   └── http-exception.filter.ts  ← Error code mapping
│   │   │   ├── interceptors/
│   │   │   │   ├── logging.interceptor.ts    ← Request/response log
│   │   │   │   └── transform.interceptor.ts  ← Wrap response format
│   │   │   └── constants/
│   │   │       ├── error-codes.ts         ← UNIS-ERR-001 → UNIS-ERR-050
│   │   │       └── pipeline.ts            ← Step names, statuses
│   │   │
│   │   └── modules/                ← 1 module = 1 pipeline step
│   │       ├── demand/             ← Step 1
│   │       │   ├── demand.module.ts
│   │       │   ├── demand.controller.ts    ← 5 endpoints
│   │       │   ├── demand.service.ts       ← Business logic
│   │       │   ├── demand.repository.ts    ← TypeORM queries
│   │       │   ├── dto/
│   │       │   │   ├── create-snapshot.dto.ts
│   │       │   │   ├── snapshot-response.dto.ts
│   │       │   │   └── forecast-query.dto.ts
│   │       │   └── entities/
│   │       │       ├── demand-snapshot.entity.ts
│   │       │       └── demand-line.entity.ts
│   │       │
│   │       ├── supply/             ← Step 2 (same structure)
│   │       ├── policy/             ← Step 3
│   │       ├── drp/                ← Step 4
│   │       ├── allocation/         ← Step 5
│   │       ├── transport/          ← Step 6
│   │       ├── execution/          ← Step 7
│   │       ├── monitor/            ← Step 8
│   │       │
│   │       ├── master-data/        ← Supporting: Items, Branches, Warehouses, RTM
│   │       │   ├── master-data.module.ts
│   │       │   ├── items.controller.ts
│   │       │   ├── branches.controller.ts
│   │       │   ├── warehouses.controller.ts
│   │       │   ├── rtm-rules.controller.ts
│   │       │   ├── master-data.service.ts
│   │       │   ├── master-data.repository.ts
│   │       │   └── entities/
│   │       │       ├── item.entity.ts
│   │       │       ├── branch.entity.ts
│   │       │       ├── warehouse.entity.ts
│   │       │       └── rtm-rule.entity.ts
│   │       │
│   │       └── pipeline/           ← Orchestration
│   │           ├── pipeline.module.ts
│   │           ├── pipeline.controller.ts  ← GET status, POST trigger
│   │           └── pipeline.service.ts     ← exec Python, track status
│   │
│   ├── test/                       ← Jest test files
│   │   ├── demand/
│   │   ├── supply/
│   │   └── ...
│   │
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── nest-cli.json
│   └── .env                        ← DB_HOST, DB_PORT, DB_NAME, PYTHON_PATH
│
├── frontend/                       ← NEXT.JS WEB LAYER (đã có shell)
│   ├── app/                        ← App Router (existing)
│   │   ├── layout.tsx              ← Root layout (sidebar + pipeline bar)
│   │   ├── page.tsx                ← Dashboard
│   │   ├── demand/page.tsx         ← Step 1 screen
│   │   ├── supply/page.tsx         ← Step 2
│   │   ├── policy/page.tsx         ← Step 3
│   │   ├── drp/page.tsx            ← Step 4
│   │   ├── allocation/page.tsx     ← Step 5
│   │   ├── transport/page.tsx      ← Step 6
│   │   ├── execution/page.tsx      ← Step 7
│   │   ├── monitor/page.tsx        ← Step 8
│   │   ├── plan-actual/page.tsx    ← Plan vs Actual
│   │   └── config/page.tsx         ← System config
│   │
│   ├── components/                 ← (existing + new)
│   │   ├── shared/                 ← Cross-page components
│   │   │   ├── data-table.tsx      ← Generic table (TanStack)
│   │   │   ├── kpi-card.tsx        ← Metric display card
│   │   │   ├── status-badge.tsx    ← Pipeline status badge
│   │   │   ├── exception-badge.tsx ← Alert severity badge
│   │   │   └── chart-wrapper.tsx   ← Recharts wrapper
│   │   ├── demand/                 ← Step-specific components
│   │   ├── drp/
│   │   ├── allocation/
│   │   └── execution/
│   │
│   ├── lib/
│   │   ├── api-client.ts           ← Typed fetch → NestJS API
│   │   ├── utils.ts                ← (existing)
│   │   └── constants.ts            ← Step names, colors, routes
│   │
│   ├── types/                      ← Shared TypeScript types
│   │   ├── demand.ts
│   │   ├── supply.ts
│   │   ├── drp.ts
│   │   ├── allocation.ts
│   │   ├── execution.ts
│   │   └── common.ts               ← Pagination, ApiResponse
│   │
│   ├── package.json                ← (existing)
│   ├── next.config.mjs             ← (existing)
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
├── database/                       ← DB SCHEMA & MIGRATIONS
│   ├── migrations/
│   │   ├── 001_master_data.sql     ← items, branches, warehouses, rtm_rules
│   │   ├── 002_demand.sql          ← demand_snapshot, demand_lines
│   │   ├── 003_supply.sql          ← supply_snapshot, supply_lines
│   │   ├── 004_policy.sql          ← policy, safety_stock, abc_classification
│   │   ├── 005_drp.sql             ← drp_run, drp_lines, drp_exceptions
│   │   ├── 006_allocation.sql      ← allocation_run, allocation_results
│   │   ├── 007_transport.sql       ← transport_plan, trips
│   │   ├── 008_execution.sql       ← orders, order_lines, approval_log
│   │   ├── 009_monitor.sql         ← kpi_snapshot, alerts
│   │   └── 010_pipeline.sql        ← pipeline_run, pipeline_step_status
│   │
│   ├── seeds/                      ← Initial data (from output/)
│   │   ├── seed_items.sql
│   │   ├── seed_branches.sql
│   │   ├── seed_warehouses.sql
│   │   └── seed_rtm_rules.sql
│   │
│   └── schema.md                   ← ERD documentation
│
├── docs/                           ← (existing — giữ nguyên)
│   ├── ARCHITECTURE-PROPOSAL.md    ← FILE NÀY
│   ├── README.md
│   ├── 01-demand-ingestion.md
│   ├── 02-supply-snapshot.md
│   ├── 03-inventory-policy.md
│   ├── 04-drp-netting.md
│   ├── 05-allocation-engine.md
│   ├── 06-transport-planning.md
│   ├── 07-execution-bridge.md
│   └── 08-monitor-learn.md
│
├── docker-compose.yml              ← PostgreSQL 16 + pgAdmin
├── .env.example                    ← Template environment variables
├── Makefile                        ← Common commands
└── README.md                       ← (existing — update)
```

---

## 5. Database Design

### 5.1 Table Overview (10 migrations, ~25 tables)

```
MASTER DATA (migration 001)
├── items              ← 2,412 SKUs (item_code PK, name, unit, abc_class, variant_group)
├── branches           ← 68 chi nhánh (branch_code PK, name, region, channel)
├── warehouses         ← 18 kho (wh_code PK, name, type, location)
├── rtm_rules          ← 108,028 routing rules (item → branch → warehouse → priority)
└── suppliers          ← 56 nhà cung cấp / nơi kéo

DEMAND — Step 1 (migration 002)
├── demand_snapshots   ← Freeze points (id, created_at, status, period, total_lines)
└── demand_lines       ← Forecast per item × branch × period (qty, basis, source)

SUPPLY — Step 2 (migration 003)
├── lot_attribute      ← Raw inventory lots từ Bravo/CSV (on_hand_qty, reserved_qty,
│                          in_transit_qty, source_type OEM/DISTRIBUTION, last_sync_at)
├── supply_snapshots   ← Freeze point metadata (status, freshness_age_minutes)
└── supply_snapshot_lines ← Aggregated per item × location (4 computed fields):
                              allocatable_qty  ← on_hand - reserved (sẵn dùng cho DRP)
                              reserved_qty     ← đã commit cho đơn confirmed
                              in_transit_qty   ← đang vận chuyển
                              is_estimated     ← true nếu DISTRIBUTION source

POLICY — Step 3 (migration 004)
├── policies           ← Policy definitions (id, type, status: DRAFT/ACTIVE)
├── safety_stocks      ← SS per item × branch (ss_qty, csl_pct, z_score, formula_params)
└── abc_classifications ← Item ABC class (from forecast segment)

DRP — Step 4 (migration 005)
├── drp_runs              ← Netting run metadata (id, snapshot_ids, status, started_at)
├── drp_lines             ← PAB per item × branch × week (gross_req, scheduled_receipt, pab, planned_order)
├── planned_order_release ← DRP output consumed by Step 5 Allocation
│                             (sku_id, dest_location_id, qty_planned, need_date, priority, specs_id)
└── drp_exceptions        ← PAB negative, shortage alerts

ALLOCATION — Step 5 (migration 006)
├── allocation_runs    ← Run metadata
└── allocation_results ← Allocated qty per item × branch × source (layer_matched, exception_code)

TRANSPORT — Step 6 (migration 007)
├── transport_plans    ← Plan per allocation run
└── transport_trips    ← Trip details (route, weight, container, carrier)

EXECUTION — Step 7 (migration 008)
├── draft_orders       ← Orders (id, trip_id FK, status ENUM 6-state Phase1-3, created_by)
│                         Phase 4+: extend to 7-state SFTP workflow
├── draft_order_lines  ← Line per item (qty_original, qty_adjusted, unit, locked, adjust_reason)
└── approval_log       ← Append-only: action, actor, reason, timestamp, before_status, after_status

MONITOR — Step 8 (migration 009)
├── kpi_snapshots      ← Point-in-time KPIs (hstk, fill_rate, exception_count, date)
└── alerts             ← Active alerts (severity, type, item, branch, resolved_at)

PIPELINE — Orchestration (migration 010)
├── pipeline_runs      ← Full pipeline execution (id, trigger, status, started_at, completed_at)
└── pipeline_steps     ← Per-step status within a run (step, status, started_at, output_summary)
```

### 5.2 Key Entity Relationships

```
items ──┬── demand_lines (item_code FK)
        ├── supply_lines (item_code FK)
        ├── safety_stocks (item_code FK)
        ├── drp_lines (item_code FK)
        ├── allocation_results (item_code FK)
        └── order_lines (item_code FK)

branches ──┬── demand_lines (branch_code FK)
           ├── supply_lines (location_code FK)
           ├── safety_stocks (branch_code FK)
           ├── drp_lines (branch_code FK)
           └── orders (branch_code FK)

rtm_rules ── allocation_results (matched via item + branch → source lookup)

drp_runs ── allocation_runs (allocation reads DRP planned orders)

allocation_runs ── transport_plans (transport reads allocation results)

transport_plans ── orders (execution creates orders from transport-grouped allocations)
```

### 5.3 UNIS-Specific DB Design Decisions

| Decision | Choice | Lý do |
|----------|--------|-------|
| Primary key cho items | `item_code` (VARCHAR) | 100% match với forecast FSKU. Không dùng UUID. |
| Không có `tenant_id` | Single-tenant | Bỏ column, bỏ RLS, bỏ index composite. Đơn giản hơn. |
| Không partition | Data volume < 500K rows | RTM 108K rows — PostgreSQL xử lý tốt không cần partition. |
| `variant_group` trên items | VARCHAR nullable | UNIS-specific: group gạch cùng mã nhưng khác màu/size. |
| Order state machine | ENUM column | DRAFT → SUBMITTED → CN_APPROVED → MGR_APPROVED → POSTED / REJECTED. 2-step approval: branch_head approve SO, sc_manager approve PO/TO. Đơn giản hơn codebase cũ (14 states → 6 states). |
| Audit via `approval_log` | Separate table | Mọi action trên orders đều ghi log (ai, lúc nào, lý do). |
| Timestamp convention | `timestamptz` (UTC) | Display ICT (UTC+7) ở frontend. |

---

## 6. API Design

### 6.1 Conventions

```
NestJS API:   http://localhost:3001/api/v1  ← Backend API (D-MD-04: versioned from start)
Next.js FE:   http://localhost:3000        ← Frontend (proxy /api/v1 → :3001/api/v1)
Versioning:   /api/v1/ — versioned từ đầu. Align với step docs 01-08.
Format:       JSON
Pagination:   ?page=1&pageSize=50
Sort:         ?sort=created_at&order=desc
Search:       ?search=keyword (full-text trên name fields)

⚠️ Port assignment:
  - NestJS API  = 3001 (backend/src/main.ts)
  - Next.js FE  = 3000 (frontend/next.config.mjs rewrites /api → localhost:3001)
  - PostgreSQL  = 5432 (docker-compose.yml)
  - pgAdmin     = 5050 (docker-compose.yml)
```

### 6.2 Standard Response Format

```typescript
// Success (list)
{
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 234,
    "totalPages": 5
  }
}

// Success (single)
{
  "data": { ... }
}

// Error
{
  "error": {
    "code": "UNIS-ERR-010",
    "message": "DRP run failed: no demand snapshot found",
    "detail": { "snapshotId": "..." }
  }
}
```

### 6.3 Full Endpoint List (38 endpoints)

#### Master Data (8 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/master/items` | List items (paginated, search, filter by ABC) |
| `GET` | `/api/master/items/:code` | Item detail |
| `GET` | `/api/master/branches` | List branches (paginated, filter by region) |
| `GET` | `/api/master/branches/:code` | Branch detail |
| `GET` | `/api/master/warehouses` | List warehouses |
| `GET` | `/api/master/warehouses/:code` | Warehouse detail |
| `GET` | `/api/master/rtm-rules` | List RTM rules (filter by item, branch) |
| `GET` | `/api/master/stats` | Summary: item count, branch count, RTM count |

#### Step 1 — Demand (5 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/demand/snapshots` | List snapshots |
| `POST` | `/api/demand/snapshots` | Freeze new snapshot |
| `GET` | `/api/demand/snapshots/:id` | Snapshot detail + lines |
| `POST` | `/api/demand/forecast/upload` | Upload forecast CSV |
| `GET` | `/api/demand/forecast/summary` | Forecast summary (item × period aggregation) |

#### Step 2 — Supply (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/supply/snapshots` | List supply snapshots |
| `POST` | `/api/supply/snapshots` | Capture inventory snapshot |
| `GET` | `/api/supply/snapshots/:id` | Snapshot detail + lines |

#### Step 3 — Policy (9 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/policy` | List policies (filter by type, status) |
| `POST` | `/api/policy` | Create policy (DRAFT) |
| `GET` | `/api/policy/:id` | Policy detail |
| `PUT` | `/api/policy/:id` | Update policy (DRAFT only) |
| `DELETE` | `/api/policy/:id` | Delete policy (DRAFT only) |
| `PUT` | `/api/policy/:id/activate` | Activate (DRAFT → ACTIVE) |
| `PUT` | `/api/policy/:id/deactivate` | Deactivate (ACTIVE → DRAFT) |
| `POST` | `/api/policy/ss-compute` | Trigger Safety Stock computation |
| `GET` | `/api/policy/classifications` | ABC classification view (A/B/C counts, thresholds) |

#### Step 4 — DRP (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/drp/run` | Trigger DRP netting |
| `GET` | `/api/drp/runs/:id` | Run status + DRP lines (paginated) |
| `GET` | `/api/drp/runs/:id/exceptions` | Exception list |

#### Step 5 — Allocation (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/allocation/run` | Trigger allocation |
| `GET` | `/api/allocation/runs/:id` | Results (paginated) |
| `GET` | `/api/allocation/recommendations` | Buyer recommendation list |

#### Step 6 — Transport (2 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/transport/plans` | Create transport plan |
| `GET` | `/api/transport/plans/:id` | Plan detail + trips |

#### Step 7 — Execution (7 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/execution/orders` | List orders (filter by status, type, branch) |
| `GET` | `/api/execution/orders/:id` | Order detail + lines + approval history |
| `POST` | `/api/execution/orders` | Create draft orders from allocation |
| `PUT` | `/api/execution/orders/:id/submit` | Submit for CN branch approval |
| `PUT` | `/api/execution/orders/:id/approve-branch` | Branch head approves SO (→ CN_APPROVED) |
| `PUT` | `/api/execution/orders/:id/approve-manager` | SC Manager approves PO/TO (→ MGR_APPROVED → POSTED) |
| `PUT` | `/api/execution/orders/:id/reject` | Reject order (FINAL — no escalation) |

> **Order State Machine (v1.1 — 2-step approval):**
> ```
> DRAFT → SUBMITTED → CN_APPROVED → MGR_APPROVED → POSTED
>              ↓              ↓
>          REJECTED       REJECTED
>          (FINAL)        (FINAL)
> ```
> - `branch_head` chỉ approve SO của branch mình (requires auth Phase 2)
> - `sc_manager` approve PO/TO toàn hệ thống
> - Rejection ở cả 2 level đều FINAL, không escalation

#### Step 8 — Monitor (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/monitor/kpis` | Current KPI metrics |
| `GET` | `/api/monitor/alerts` | Active alerts |
| `GET` | `/api/monitor/plan-vs-actual` | Plan vs Actual comparison |

#### Pipeline Orchestration (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/pipeline/status` | Current pipeline status (8 steps) |
| `POST` | `/api/pipeline/trigger/:step` | Trigger specific step |
| `GET` | `/api/pipeline/runs/:id` | Pipeline run detail |

---

## 7. UNIS Business Configuration (Hardcoded Constants)

Thay vì plugin pattern, UNIS config là constants trong code:

```typescript
// backend/src/common/constants/unis-config.ts

export const UNIS_CONFIG = {
  // Planning
  PLANNING_HORIZON_WEEKS: 12,
  FROZEN_ZONE_WEEKS: 2,
  LOT_SIZING: 'L4L',                    // Lot-for-Lot (exact qty)
  DEMAND_BASIS: 'MAX_FORECAST_PO',       // max(forecast, confirmed PO)
  PLANNING_CYCLE: '23:00',              // Nightly cutoff ICT

  // Safety Stock
  SAFETY_STOCK: {
    A: { CSL: 0.975, Z: 1.96 },
    B: { CSL: 0.95,  Z: 1.65 },
    C: { CSL: 0.90,  Z: 1.28 },
    LEAD_TIME_AVG_DAYS: 5,
    LEAD_TIME_STD_DAYS: 2,
  },

  // Allocation
  FEFO_ENABLED: false,                   // Building materials: no expiry
  SPECS_MATCHING: 'VARIANT',             // Color/size matching
  LCNB_MODE: 'DETECT_ONLY',             // Phase 4: EXECUTE
  ABC_WEIGHTS: { A: 2.0, B: 1.5, C: 1.0 },

  // Transport
  MAX_CONTAINER_WEIGHT_KG: 28_000,
  CARRIER_PREFERENCE: 'BEST_SLA',
  CONSOLIDATION: false,                  // Per-project delivery

  // Execution
  CN_APPROVAL_REQUIRED: true,            // ALL orders require CN_WH approval
  POST_APPROVAL_EDIT: true,              // Allowed but triggers RE_APPROVE (FR29, EX-003)
  RE_APPROVE_REQUIRED: true,             // Post-approval edit → status reset PENDING_APPROVAL
  REJECTION_FINAL: false,               // CN can re-submit rejected orders (EX-005 — unlimited)
  QTY_ADJUST_DIRECTION: 'DECREASE_ONLY',// CN chỉ giảm qty, không tăng (EX-004)

  // Monitor
  HSTK_THRESHOLDS: {
    RED: 1.5,                            // < 1.5 weeks = stockout alert
    YELLOW: 3.0,                         // 1.5–3.0 = normal
    GREEN: 3.0,                          // > 3.0 = overstock alert
  },

  // Data
  FRESHNESS_THRESHOLD_MINUTES: 240,      // 4h batch sync
  PAB_NEGATIVE_HANDLING: 'RAISE_EXCEPTION',
} as const;
```

---

## 8. Coding Rules (Đơn giản hóa cho UNIS)

### 8.1 Giữ nguyên từ codebase cũ

| # | Rule | Áp dụng |
|---|------|---------|
| R3 | Folder structure chuẩn | 3 layers: data/ backend/ frontend/ |
| R6 | File size limits | Code < 500L, Controller < 200L, Test < 400L, Component < 200L |
| R7 | Naming conventions | snake_case (Python, DB), camelCase (TypeScript) |
| R8 | Layered architecture | Controller → Service → Repository (NestJS enforces) |
| R9 | Test-first | Write `.spec.ts` before implementation |
| R10 | Error codes | `UNIS-ERR-XXX` format, không throw raw string |
| R11 | Idempotency | DB upsert (ON CONFLICT), unique constraints |
| R14 | Config externalization | `.env` file, no hardcoded values |
| R15 | Structured logging | NestJS Logger service, JSON format |
| R16 | FE component rules | 1 file = 1 component, shadcn pattern, < 200L |

### 8.2 Bỏ (không áp dụng)

| # | Rule | Lý do bỏ |
|---|------|----------|
| R1-R2 | H1-H5 context loading | 1 project, không cần multi-layer context protocol |
| R4 | Plugin pattern | Single-tenant, logic viết trực tiếp |
| R12 | Multi-tenant safety | Không tenant_id, không RLS |
| R13 | No cross-module import | Cho phép import giữa modules trong NestJS (via DI) |
| R18 | SQL tenant_id handling | Không có tenant_id |

### 8.3 Mới (thêm cho UNIS)

| # | Rule | Nội dung |
|---|------|---------|
| U1 | **Python ↔ DB contract** | Python scripts PHẢI dùng cùng table schema với TypeORM entities. Thay đổi schema = update cả 2. |
| U2 | **Migration-first** | Mọi DB change phải có migration SQL trong `database/migrations/`. Không ALTER trực tiếp. |
| U3 | **API-first FE** | Frontend KHÔNG đọc DB trực tiếp. Mọi data qua NestJS API. |
| U4 | **Step dependency** | Pipeline steps chạy sequential. Step N đọc output Step N-1 từ DB. Không skip step. |
| U5 | **Vietnamese comments** | Code comment = English. Business rule comment (tại sao) = Vietnamese OK. |
| U6 | **No tenant_id** | Step docs (01-08) còn `tenant_id` từ multi-tenant codebase. Dev PHẢI xóa khi implement — UNIS là single-tenant. |
| U7 | **emit_event = NestJS EventEmitter2** | Các step docs dùng `emit_event()`. Trong UNIS implement bằng `EventEmitter2` (built-in NestJS). Không dùng Kafka hay external bus. |

---

## 9. Development Plan (Phases)

### Phase 1 — Foundation (Week 1-2)

```
✅ Mục tiêu: Chạy được pipeline Step 1-4 end-to-end

Tasks:
  [ ] Setup docker-compose (PostgreSQL + pgAdmin)
  [ ] Run migrations 001-005
  [ ] Seed master data (items, branches, warehouses, RTM)
  [ ] NestJS scaffold (app.module, common/, master-data module)
  [ ] Python Step 1: demand ingestion → DB
  [ ] Python Step 2: supply snapshot → DB
  [ ] Python Step 3: safety stock compute → DB
  [ ] Python Step 4: DRP netting → DB
  [ ] NestJS modules: demand, supply, policy, drp (read from DB)
  [ ] Frontend: connect demand + drp pages to API (real data)

Deliverable: Dashboard shows DRP results from real UNIS forecast data.
```

### Phase 2 — Allocation, Orders & Auth (Week 3-4)

```
✅ Mục tiêu: Step 5-7 hoạt động + basic authentication

Tasks:
  [ ] Run migrations 006-008
  [ ] Python Step 5: allocation engine
  [ ] Python Step 6: transport planning
  [ ] Python Step 7: draft orders generation
  [ ] NestJS modules: allocation, transport, execution
  [ ] Frontend: allocation results, order list, 2-step approve/reject flow
  [ ] Order state machine (DRAFT → SUBMITTED → CN_APPROVED → MGR_APPROVED → POSTED / REJECTED)
  
  ⚠️ AUTH (moved from Phase 4 — required for approval flow):
  [ ] JWT middleware (NestJS Guard) — decode token, extract role + branch
  [ ] 4 roles: planner, branch_head, sc_manager, admin
  [ ] Role-based endpoint protection:
      - branch_head: chỉ approve-branch orders thuộc branch mình
      - sc_manager: approve-manager PO/TO toàn hệ thống
      - planner: trigger pipeline, create orders
      - admin: all access
  [ ] Frontend: role-header middleware (simple — không cần OAuth, chỉ cần
      role selector dropdown cho UAT, Phase 4 mới làm full login)

Deliverable: Full order workflow with role-based approval.
```

### Phase 3 — Monitor & Polish (Week 5-6)

```
✅ Mục tiêu: Dashboard hoàn chỉnh, sẵn sàng demo

Tasks:
  [ ] Run migration 009-010
  [ ] Python Step 8: KPI computation, alert detection
  [ ] NestJS module: monitor, pipeline orchestration
  [ ] Frontend: KPI dashboard, alerts, plan-vs-actual, charts
  [ ] Pipeline trigger từ UI (POST /api/pipeline/trigger/:step)
  [ ] End-to-end test: CSV upload → 8 steps → orders → KPIs

Deliverable: Production-ready demo system.
```

### Phase 4 — ERP & Production (Backlog)

```
⏳ Khi cần:
  [ ] Bravo ERP integration — SFTP adapter (push SO/TO/PO, pull demand signal)
  [ ] Full OAuth 2.0 login (replace UAT role-selector)
  [ ] Real-time updates (SSE/WebSocket)
  [ ] LCNB EXECUTE mode
  [ ] LightGBM forecast model
  [ ] Mobile approval (responsive UI)
  [ ] CI/CD pipeline
```

### Bravo ERP Scope Clarification (v1.1)

```
⚠️ QUAN TRỌNG — Rõ ràng scope Bravo qua từng phase:

Phase 1-3 (Week 1-6): CSV ONLY — KHÔNG có Bravo integration
  - Step 1 Demand:  Upload forecast CSV thủ công (không pull từ Bravo)
  - Step 2 Supply:  Upload inventory CSV thủ công (không pull từ Bravo)
  - Step 7 Execution: Export orders CSV → gửi email/download
                       (KHÔNG auto-push SO/TO/PO → Bravo)

Phase 4 (Backlog): Bravo SFTP Adapter
  - Pull: demand signal + inventory snapshot từ Bravo via SFTP
  - Push: SO/TO/PO CSV → Bravo SFTP endpoint
  - Requires: Bravo SFTP credentials từ UNIS IT (blocker B3)

BA/PM note: Phase 1-3 deliverable = offline CSV workflow.
Không assume Bravo sync có từ đầu.
```

---

## 10. Risk & Mitigation

| # | Risk | Impact | Mitigation |
|---|------|--------|------------|
| 1 | Python ↔ NestJS schema drift | Data corruption, API errors | Rule U1: shared schema. Migration-first (U2). |
| 2 | DRP computation timeout (108K RTM rules) | Slow pipeline | Python optimize: vectorized pandas, batch INSERT. Monitor P95. |
| 3 | Frontend over-fetching large datasets | Slow UI | Server-side pagination (50 items default). Virtual table for >100 rows. |
| 4 | No auth Phase 1 = anyone can trigger pipeline | Data integrity | Phase 1: internal network only. Phase 2: JWT + RBAC guard. |
| 5 | Single point of failure (no Kafka) | Step failure blocks pipeline | Pipeline runner logs per-step status. Manual re-trigger via API. |
| 6 | CSV format changes from UNIS IT | Import failures | Validator layer in Python. Schema check before processing. |
| 7 | Supply bucket mismatch (3 vs 4) | Data display sai trên FE | Align supply_lines schema: 4-bucket model (oem/transit/buffer/committed). |
| 8 | UAT assume Bravo sync có từ đầu | Scope creep, unmet expectations | Clarified: Phase 1-3 = CSV only. Bravo SFTP = Phase 4. |
| 9 | branch_head approve PO branch khác | Authorization violation | 2-step approval + JWT role guard enforce branch scope (Phase 2). |

---

## 11. Decision Log

| # | Decision | Choice | Alternative Considered | Rationale |
|---|----------|--------|----------------------|-----------|
| D1 | API framework | NestJS | Express, Fastify | Structured modules, DI, TypeScript-first, layered by design |
| D2 | ORM | TypeORM | Prisma, Knex | NestJS native integration, migration support, repository pattern |
| D3 | Python ↔ API communication | DB signal table pattern | child_process.exec, REST between Python↔NestJS | No process leak, cross-platform, restart-safe. Python polls pipeline_steps table. |
| D4 | Authentication | Phase 1 skip, **Phase 2 basic JWT** | Full OAuth, Phase 4 defer | 2-step approval requires role distinction. UAT uses role-selector dropdown (not full login). |
| D5 | Message queue | None | Kafka, BullMQ | 2,412 items = small dataset. Sequential pipeline sufficient. |
| D6 | Caching | None | Redis | DB queries < 100ms for this data volume. Add Redis if P95 > 500ms. |
| D7 | Deployment | Docker Compose | K8s | Dev/UAT phase. K8s when going production. |
| D8 | DB migration tool | Raw SQL files | TypeORM migrations, Alembic | Both Python and NestJS read same DB. SQL = source of truth. |
| D9 | Order states | 6 states, 2-step approval | 5 states (v1.0), 14 states (old codebase) | DRAFT→SUBMITTED→CN_APPROVED→MGR_APPROVED→POSTED/REJECTED. branch_head + sc_manager distinct. |
| D10 | Item PK | `item_code` (VARCHAR) | UUID | 100% match với forecast FSKU. Human-readable. No join complexity. |
| D11 | Supply buckets | 4-bucket model | 3-field (on_hand/in_transit/reserved) | Align with TerraX/user-flow: OEM, Transit, Buffer, Committed. |
| D12 | Bravo ERP timing | Phase 4 (CSV fallback Phase 1-3) | Phase 1 integration | SFTP credentials blocked (B3). CSV workflow sufficient for UAT. |
| D13 | Port assignment | API=3001, FE=3000 | Both on 3001 | Avoid conflict. Next.js proxy /api → :3001. |

---

## 12. Team Review Checklist

Mỗi reviewer đánh dấu phần mình chịu trách nhiệm:

### PM Review
```
[ ] Scope phù hợp với timeline UNIS UAT
[ ] Phase 1-3 deliverables rõ ràng
[ ] Risk matrix đầy đủ
[ ] Không over-engineering
```

### BA Review
```
[ ] 38 API endpoints cover 44 business rules
[ ] Order state machine 2-step: CN_APPROVED → MGR_APPROVED
[ ] UNIS config constants đúng (SS, HSTK, planning params)
[ ] Supply 4-bucket model align với TerraX (OEM/Transit/Buffer/Committed)
[ ] Bravo scope rõ: Phase 1-3 = CSV only, Phase 4 = SFTP
[ ] Policy CRUD đủ (create, update, delete, activate, deactivate)
```

### FE Lead Review
```
[ ] Next.js 14 + shadcn + Tailwind = confirmed
[ ] Component structure scalable
[ ] API response format dễ consume
[ ] 8 step screens + dashboard = đủ scope
```

### Data Engineer Review
```
[ ] Python pipeline structure hợp lý
[ ] DB schema cover đủ 8 steps
[ ] Migration order đúng (FK dependencies)
[ ] Seed data strategy OK (CSV → SQL)
```

### DevOps Review
```
[ ] Docker Compose đủ cho dev/UAT
[ ] Environment variables rõ ràng
[ ] No vendor lock-in
[ ] Path to production deployment clear
```

---

## Signatures

| Role | Name | Status | Date |
|------|------|--------|------|
| Tech Lead | _____________ | [ ] Approved | ___/___/2026 |
| PM | _____________ | [ ] Approved | ___/___/2026 |
| BA | _____________ | [ ] Approved | ___/___/2026 |
| FE Lead | _____________ | [ ] Approved | ___/___/2026 |
| Data Engineer | _____________ | [ ] Approved | ___/___/2026 |
| DevOps | _____________ | [ ] Approved | ___/___/2026 |

---

*ARCHITECTURE-PROPOSAL.md — UNIS DRP Standalone | v1.2 | 2026-04-13*
*v1.1 fixes: #1 Port conflict, #2 Auth→Phase 2, #3 DB signal pattern, #4 Bravo scope, #5 2-step approval, #6 Policy CRUD, #7 Supply 4-bucket*
*v1.2 fixes: #8 POST_APPROVAL_EDIT=true+RE_APPROVE, #9 REJECTION_FINAL=false (re-submit allowed), #10 lot_attribute+planned_order_release in DB schema, #11 U6 tenant_id cleanup rule, #12 U7 emit_event=EventEmitter2*
*Review deadline: 2026-04-15 (2 business days)*
