# MODULE 1: DEMAND INGESTION — Task Checklist

**Pre-condition:** Phase 0 Foundation DONE (DB running, master data seeded, NestJS boots, FE connects)  
**Ref docs:** `01-demand-ingestion.md`, `00-master-data.md`, `ARCHITECTURE-PROPOSAL.md`  
**Timeline:** 1 week

---

## Phase 0 Checklist (Foundation — trước khi bắt đầu Module 1)

```
DevOps:
  [ ] docker-compose.yml chạy được (PostgreSQL 16 + pgAdmin)
  [ ] .env.example có đủ DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD

Database:
  [ ] Chạy migration 001_master_data.sql thành công
  [ ] 6 master tables tồn tại (item, location, supplier, rtm_rule, item_location_config, planning_cycle)

Data:
  [ ] Seed master data: 2,412 items + 143 locations + 56 suppliers + 108,028 RTM rules
  [ ] Verify counts: SELECT COUNT(*) FROM item / location / rtm_rule

Backend:
  [ ] NestJS scaffold boots trên port 3001
  [ ] Master data module: GET /api/v1/master/items trả data
  [ ] GET /api/v1/master/stats trả đúng counts

Frontend:
  [ ] Next.js chạy trên port 3000
  [ ] Proxy /api/v1 → localhost:3001 hoạt động
  [ ] Sidebar + Pipeline bar hiển thị đúng

→ ALL checked? Bắt đầu Module 1.
```

---

## Module 1 Tasks

### DATABASE

```
[ ] Tạo file database/migrations/002_demand.sql
[ ] 4 tables: demand_snapshot, demand_snapshot_line, demand_forecast_detail, demand_override_log
[ ] FK constraints đến item(item_code) + location(location_code)
[ ] Unique constraint: (snapshot_id, item_code, location_code, period_start)
[ ] Indexes trên snapshot_id, item_code, location_code, period_start
[ ] Chạy migration thành công
[ ] Verify: 4 tables tồn tại, FK hoạt động
```

### DATA (Python)

```
[ ] Tạo file data/pipelines/step1_demand.py
[ ] Đọc CSV forecast (2 loại: branch-level 84K rows + aggregate 1,660 rows)
[ ] Validate required columns: fsku_id, branch_code, forecast_date, forecast_qty
[ ] Filter: loại rows combo_class IN ('EXCLUDE','DORMANT_DISCONTINUED') + 241 dormant FSKUs (all-zero forecast)
[ ] Map: fsku_id → item_code, branch_code → location_code (skip unmapped, log errors)
[ ] Tính demand_basis (BR-01): nếu có confirmed PO ≤ 90 ngày → MAX(forecast_qty, po_qty), else forecast_qty
[ ] Tạo demand_snapshot record (status=DRAFT)
[ ] Bulk insert demand_snapshot_line (batch 1000)
[ ] Bulk insert demand_forecast_detail (raw JSON)
[ ] Log unmapped/invalid rows vào import_error_log
[ ] Test: chạy với Forecast_30032026.csv → verify counts
[ ] Test: chạy với drp_export_dec25_q1_2026.csv → 84,764 rows imported, <120s
```

### API (NestJS)

```
Module scaffold:
  [ ] demand.module.ts + register trong app.module
  [ ] Entities: DemandSnapshot, DemandSnapshotLine, DemandForecastDetail, DemandOverrideLog
  [ ] DTOs: upload, freeze, query, override, response

Endpoints (theo priority):
  P1 — Core:
    [ ] GET  /api/v1/demand/snapshots — list (paginated)
    [ ] GET  /api/v1/demand/snapshots/:id — detail + lines (paginated)
    [ ] POST /api/v1/demand/snapshots/:id/freeze — DRAFT → FROZEN

  P2 — Upload:
    [ ] POST /api/v1/demand/forecast/upload — CSV upload

  P3 — Analytics:
    [ ] GET  /api/v1/demand/forecast/summary — group by item/location/segment
    [ ] GET  /api/v1/demand/forecast/coverage — % items with forecast
    [ ] GET  /api/v1/demand/forecast/detail — branch-level detail

  P4 — Override:
    [ ] POST /api/v1/demand/forecast/override — edit qty (DRAFT only, reason required)

Business rules:
  [ ] Freeze chỉ khi status=DRAFT + totalLines > 0
  [ ] Override chỉ khi snapshot DRAFT
  [ ] Override reason bắt buộc (không empty)
  [ ] FROZEN snapshot trả 409 khi freeze/override lại

Error codes:
  [ ] UNIS-ERR-001: Snapshot not DRAFT (409)
  [ ] UNIS-ERR-002: Snapshot empty (400)
  [ ] UNIS-ERR-003: Cannot override FROZEN (409)
  [ ] UNIS-ERR-004: Invalid CSV format (400)
  [ ] UNIS-ERR-005: File too large >50MB (413)
  [ ] UNIS-ERR-006: >10% rows invalid (422)
  [ ] UNIS-ERR-007: Snapshot not found (404)
  [ ] UNIS-ERR-008: Override reason required (400)
```

### WEB (Next.js)

```
Components:
  [ ] components/demand/snapshot-table.tsx — list snapshots, status badge, actions
  [ ] components/demand/forecast-matrix.tsx — pivot table FSKU × months
  [ ] components/demand/coverage-gauge.tsx — circular gauge + ABC breakdown
  [ ] components/demand/upload-dialog.tsx — drag-drop CSV, preview, confirm
  [ ] components/demand/override-dialog.tsx — edit qty + reason
  [ ] components/demand/freeze-button.tsx — confirm dialog

Page:
  [ ] app/demand/page.tsx — replace placeholder với real content
  [ ] KPI cards: Total Items, Total Lines, Coverage %
  [ ] Snapshot table: list từ API, status badge (DRAFT=yellow, FROZEN=blue)
  [ ] Click snapshot → forecast matrix load (paginated)
  [ ] Freeze button → confirm → call API → refresh
  [ ] Coverage gauge hiển thị đúng (A:100%, B:92%, C:60%)
  [ ] Tet flag badge trên forecast matrix
  [ ] Upload CSV flow: select file → preview → confirm → DRAFT created

API client:
  [ ] frontend/lib/api-client.ts — thêm demand endpoints
```

### INTEGRATION & VERIFY

```
End-to-end:
  [ ] Python insert data → API returns data → FE displays data
  [ ] Upload CSV → snapshot DRAFT → freeze → FROZEN → immutable
  [ ] Coverage gauge shows 85.5%
  [ ] Large file 84K rows < 120s processing

Acceptance Criteria (from 01-demand-ingestion.md §10):
  [ ] AC-01: Upload 84K rows → snapshot created
  [ ] AC-02: Invalid rows → validation_errors in response
  [ ] AC-03: Excluded rows filtered correctly
  [ ] AC-04: fsku_id maps to item_code
  [ ] AC-05: Freeze → FROZEN, immutable
  [ ] AC-06: Override → reconciled_qty updated + log created
  [ ] AC-07: MAX_FORECAST_PO logic (demand_basis = MAX(forecast, PO ≤90d), implement trong Python step, verify ở đây)
  [ ] AC-08: Coverage = 85.5%, A=100%
  [ ] AC-09: Tet flag badge displays
  [ ] AC-10: 84K rows < 120s, < 512MB memory
```

---

## Done Criteria — Module 1 Sign-off

```
[ ] 4 DB tables created + FK + indexes
[ ] Python script processes both CSV files correctly
[ ] 8 API endpoints working with pagination
[ ] Demand page shows real data (snapshots, matrix, coverage)
[ ] Freeze flow works end-to-end
[ ] Error codes UNIS-ERR-001→008 implemented
[ ] AC-01→AC-10 verified (AC-07 deferred)

→ PROCEED TO MODULE 2 (Supply Snapshot)
```

---

*MODULE-1-ROADMAP.md | UNIS DRP | 2026-04-13*
