# Module Spec — Step 0: Master Data Foundation

> **Module ID:** SCP-UNIS-00
> **Version:** 1.0
> **Last Updated:** 2026-04-13
> **Owner:** R-BA + Tech Lead
> **Status:** APPROVED — Foundation for ALL steps

> ⚠️ **Đọc file này TRƯỚC KHI implement bất kỳ step nào.**
> File này giải quyết 4 conflicts giữa architecture proposal và step docs 01-08.

---

## Mục lục

1. [UNIS Master Data Context](#1-unis-master-data-context)
2. [Design Decisions — Conflict Resolution](#2-design-decisions--conflict-resolution)
3. [item Table](#3-item-table)
4. [location Table (Unified)](#4-location-table-unified)
5. [supplier Table](#5-supplier-table)
6. [rtm_rule Table](#6-rtm_rule-table)
7. [item_location_config Table](#7-item_location_config-table)
8. [planning_cycle Table](#8-planning_cycle-table)
9. [Migration SQL — migration 001](#9-migration-sql--migration-001)
10. [Seed Data Guide](#10-seed-data-guide)
11. [API Endpoints](#11-api-endpoints)
12. [Cross-Module Usage](#12-cross-module-usage)
13. [Acceptance Criteria](#13-acceptance-criteria)

---

## 1. UNIS Master Data Context

| Entity | Count | Mô tả |
|--------|-------|--------|
| **Items (FSKUs)** | 2,412 total / 1,419 active | Gạch men, gạch ốp lát, bột trét, phụ kiện |
| **Chi nhánh (CN)** | 68 | Điểm bán hàng — nhận hàng từ kho |
| **Kho (WH/Hub)** | 19 | Trung tâm phân phối — xuất hàng cho CN |
| **Nhà máy (NM/Factory)** | 5–8 | Sản xuất hàng, cũng là kho thành phẩm |
| **Suppliers** | 56 | Nhà cung cấp / nguồn nhập hàng |
| **RTM Rules** | 108,028 | Routing: item × branch → warehouse priority |

**Item phân loại:**
- **Active:** 1,419 FSKUs có forecast > 0 → đưa vào DRP
- **Dormant:** 241 FSKUs forecast = 0 toàn bộ → exclude khỏi DRP, giữ trong master data
- **Discontinued:** một số items ngừng kinh doanh → `is_active = false`

**Variant (đặc thù gạch men):**
- Cùng 1 mã gạch nhưng khác đuôi màu: A4, B2, C1, ...
- Ví dụ: `GACH-60x60` có variants `GACH-60x60-A4`, `GACH-60x60-B2`
- `variant_group` = mã gốc không có đuôi màu
- Allocation PHẢI ghép đúng variant trong cùng 1 đơn hàng (EX: xem 05-allocation-engine.md)

---

## 2. Design Decisions — Conflict Resolution

> Các quyết định dưới đây **giải quyết mâu thuẫn** giữa architecture proposal và step docs 01-08.
> Dev PHẢI follow section này, không follow conflicting parts trong các docs khác.

### D-MD-01: Item Primary Key = `item_code VARCHAR`

**Vấn đề:** Architecture proposal dùng `item_code VARCHAR` làm PK trực tiếp (D10).
Step docs 01-08 dùng `id BIGINT AUTO_INCREMENT` làm PK + `canonical_id VARCHAR` là natural key.

**Quyết định:** `item_code VARCHAR(50) PRIMARY KEY`

**Lý do:**
- 100% match với `fsku_id` trong forecast CSV — không cần join extra để map
- Human-readable trong logs và debug
- 2,412 items — không cần surrogate key để optimize
- Xem D10 trong ARCHITECTURE-PROPOSAL.md

**Migration:** Các step docs SQL có `WHERE canonical_id = :fsku_id` → đọc là `WHERE item_code = :fsku_id`.
FK trong step docs là `item_id BIGINT FK` → trong UNIS implement là `item_code VARCHAR FK → item.item_code`.

---

### D-MD-02: Unified `location` Table (không tách `branches` + `warehouses`)

**Vấn đề:** Step docs 01-08 dùng unified `location` table với `location_type` ENUM.
Architecture proposal §5.1 có `branches`, `warehouses`, `suppliers` tách riêng.

**Quyết định:** Dùng unified `location` table.

**Lý do:**
- Step docs 01-08 đã viết theo unified model — refactor sẽ tốn nhiều effort
- RTM rules cần join item × source_location × dest_location — unified simpler hơn
- `location_type` ENUM đủ để phân biệt: BRANCH / WAREHOUSE / FACTORY / HUB

**Migration 001 sẽ tạo bảng `location`, KHÔNG tạo `branches`/`warehouses` riêng.**

---

### D-MD-03: No `tenant_id` trong bất kỳ table nào

**Vấn đề:** Step docs 01-08 còn SQL với `WHERE tenant_id = :tenant_id` từ multi-tenant codebase cũ.

**Quyết định:** UNIS là single-tenant — KHÔNG có `tenant_id` column trong bất kỳ bảng nào.

**Rule U6** trong ARCHITECTURE-PROPOSAL.md: Dev PHẢI xóa mọi `tenant_id` reference khi implement.
SQL trong step docs nếu có `tenant_id` → bỏ điều kiện đó đi.

---

### D-MD-04: API Path = `/api/v1/`

**Vấn đề:** Step docs dùng `/api/v1/`, architecture proposal §6.1 nói "không version URL".

**Quyết định:** Dùng `/api/v1/` theo step docs.

**Lý do:** Future-proof, và tất cả 8 step docs đã viết sẵn theo `/api/v1/`.
Architecture proposal đã được update ở version tiếp theo.

---

## 3. item Table

### Schema

```sql
CREATE TABLE item (
    item_code           VARCHAR(50)     PRIMARY KEY,    -- D-MD-01: PK trực tiếp = fsku_id
    item_name           VARCHAR(200)    NOT NULL,
    item_name_short     VARCHAR(100),
    unit_of_measure     VARCHAR(20)     NOT NULL DEFAULT 'THUNG',  -- THUNG/BAO/M2/KG
    product_line        VARCHAR(100),                   -- Gạch men / Gạch ốp / Bột trét
    variant_group       VARCHAR(50),                    -- Mã gốc không đuôi màu (nullable)
    variant_suffix      VARCHAR(20),                    -- Đuôi màu: A4, B2, C1 (nullable)
    weight_kg_per_unit  DECIMAL(10,3)   DEFAULT 0,      -- Trọng lượng 1 đơn vị (kg)
    abc_class           CHAR(1),                        -- A/B/C — import từ forecast CSV
    combo_class         VARCHAR(50),                    -- SMOOTH/LUMPY/ERRATIC/DORMANT_SEASONAL
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    is_dormant          BOOLEAN         NOT NULL DEFAULT FALSE,  -- forecast = 0 toàn bộ
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_item_variant_group ON item(variant_group) WHERE variant_group IS NOT NULL;
CREATE INDEX idx_item_abc_class ON item(abc_class);
CREATE INDEX idx_item_is_active ON item(is_active);
```

### Columns chi tiết

| Column | Type | Required | Mô tả |
|--------|------|----------|--------|
| `item_code` | VARCHAR(50) PK | YES | = `fsku_id` trong forecast CSV. Ví dụ: `GACH-MEN-60x60-A4` |
| `item_name` | VARCHAR(200) | YES | Tên đầy đủ. Ví dụ: "Gạch men 60x60 màu A4" |
| `unit_of_measure` | VARCHAR(20) | YES | THUNG / BAO / M2 / KG / VIEN |
| `variant_group` | VARCHAR(50) | NO | Nullable. = `item_code` bỏ đuôi màu. Ví dụ: `GACH-MEN-60x60` |
| `variant_suffix` | VARCHAR(20) | NO | Nullable. Đuôi màu: `A4`, `B2`, `C1` |
| `weight_kg_per_unit` | DECIMAL(10,3) | YES | Dùng cho transport weight calculation (Step 6) |
| `abc_class` | CHAR(1) | NO | Import từ forecast CSV. NULL nếu chưa có forecast. |
| `combo_class` | VARCHAR(50) | NO | Import từ forecast CSV |
| `is_active` | BOOLEAN | YES | false = ngừng kinh doanh |
| `is_dormant` | BOOLEAN | YES | true = forecast = 0, loại khỏi DRP nhưng còn trong master |

### Mapping từ forecast CSV

```python
# fsku_id trong CSV → item_code trong DB (1:1 mapping)
# Không cần bảng mapping trung gian

item_code = row['fsku_id']          # trực tiếp
abc_class = row['segment']          # A/B/C
combo_class = row['combo_class']
```

---

## 4. location Table (Unified)

### Schema

```sql
CREATE TYPE location_type_enum AS ENUM (
    'BRANCH',       -- Chi nhánh bán hàng (68 CN)
    'WAREHOUSE',    -- Kho phân phối (19 kho)
    'FACTORY',      -- Nhà máy sản xuất + kho thành phẩm (5-8 NM)
    'HUB'           -- Trung tâm hub logistics (nếu có)
);

CREATE TABLE location (
    location_code       VARCHAR(20)         PRIMARY KEY,
    location_name       VARCHAR(200)        NOT NULL,
    location_type       location_type_enum  NOT NULL,
    region              VARCHAR(50),        -- Miền: NORTH / CENTRAL / SOUTH
    province            VARCHAR(100),       -- Tỉnh/thành phố
    channel             VARCHAR(50),        -- Kênh phân phối: URBAN/RURAL/SEMI_URBAN
    parent_location_code VARCHAR(20)        REFERENCES location(location_code),  -- Hub của branch
    is_active           BOOLEAN             NOT NULL DEFAULT TRUE,
    latitude            DECIMAL(10,7),
    longitude           DECIMAL(10,7),
    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_location_type ON location(location_type);
CREATE INDEX idx_location_region ON location(region);
CREATE INDEX idx_location_is_active ON location(is_active);
```

### location_type phân biệt rõ

| Type | Count | Mô tả | Role trong SCP |
|------|-------|--------|----------------|
| `BRANCH` | 68 | Chi nhánh bán hàng | Nhận hàng, CN_WH duyệt đơn |
| `WAREHOUSE` | 19 | Kho phân phối (Hub) | Trung gian, tổng hợp hàng |
| `FACTORY` | 5–8 | Nhà máy + kho thành phẩm | Nguồn hàng gốc trong RTM |
| `HUB` | ~3 | Hub logistics HCM/HN/DN | P3 fallback trong RTM |

### Mapping từ step docs

```
Tất cả step docs dùng:
  location_id   → trong UNIS = location_code VARCHAR FK (không phải BIGINT)
  location_type = 'BRANCH'/'WAREHOUSE'/'FACTORY'/'HUB'
```

---

## 5. supplier Table

```sql
CREATE TABLE supplier (
    supplier_code       VARCHAR(20)     PRIMARY KEY,
    supplier_name       VARCHAR(200)    NOT NULL,
    supplier_type       VARCHAR(50),    -- FACTORY / DISTRIBUTOR / IMPORTER
    contact_email       VARCHAR(200),
    lead_time_days_avg  INT             DEFAULT 5,   -- Lead time trung bình
    lead_time_days_std  INT             DEFAULT 2,   -- Độ lệch chuẩn lead time
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
```

---

## 6. rtm_rule Table

Route-to-Market rules: xác định nguồn hàng ưu tiên cho từng item × branch combo.

### Schema

```sql
CREATE TABLE rtm_rule (
    id                  BIGSERIAL       PRIMARY KEY,
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    dest_location_code  VARCHAR(20)     NOT NULL REFERENCES location(location_code),  -- CN nhận
    source_location_code VARCHAR(20)   NOT NULL REFERENCES location(location_code),  -- WH/NM xuất
    priority            INT             NOT NULL,       -- 1 = primary, 2 = fallback, 3 = last resort
    lead_time_days      INT             NOT NULL,       -- LT từ source → dest (ngày)
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    effective_date      DATE            DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_rtm_rule UNIQUE (item_code, dest_location_code, source_location_code)
);

-- Indexes — critical for allocation performance (108K rows)
CREATE INDEX idx_rtm_item_dest ON rtm_rule(item_code, dest_location_code) WHERE is_active = TRUE;
CREATE INDEX idx_rtm_source ON rtm_rule(source_location_code) WHERE is_active = TRUE;
```

### RTM Priority logic (UNIS 3-tier)

```
Priority 1 (P1): Kho gần nhất / NM chính của CN đó
Priority 2 (P2): Kho/NM thay thế trong vùng
Priority 3 (P3): Hub HCM (fallback cuối cùng cho toàn hệ thống)

Rule: Allocation (Step 5) Layer 1 dùng P1 trước, nếu stockout dùng P2, rồi P3.
C-class items: manual routing — không có auto RTM rule, planner tự quyết.
```

### Ví dụ data

```sql
-- item GACH-MEN-60x60-A4, branch CN-HN-001
-- P1: kho Hà Nội WH-HN-001 (2 ngày)
-- P2: nhà máy NM-NORTH-001 (5 ngày)
-- P3: hub HCM HUB-HCM-001 (7 ngày)
INSERT INTO rtm_rule (item_code, dest_location_code, source_location_code, priority, lead_time_days)
VALUES
  ('GACH-MEN-60x60-A4', 'CN-HN-001', 'WH-HN-001', 1, 2),
  ('GACH-MEN-60x60-A4', 'CN-HN-001', 'NM-NORTH-001', 2, 5),
  ('GACH-MEN-60x60-A4', 'CN-HN-001', 'HUB-HCM-001', 3, 7);
```

---

## 7. item_location_config Table

Cấu hình per item × location cho DRP và Safety Stock. Referenced trong 03-inventory-policy.md.

```sql
CREATE TABLE item_location_config (
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),
    location_code       VARCHAR(20)     NOT NULL REFERENCES location(location_code),
    lead_time_days      INT             NOT NULL DEFAULT 5,   -- Lead time thực tế item này tại loc này
    lead_time_variability DECIMAL(4,2)  NOT NULL DEFAULT 0.20, -- σ(LT)/avg(LT) = 20%
    min_order_qty       DECIMAL(15,2)   DEFAULT 0,
    max_order_qty       DECIMAL(15,2),
    reorder_point       DECIMAL(15,2),  -- Tính bởi Step 3, update mỗi cycle
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    PRIMARY KEY (item_code, location_code)
);
```

**Note:** Nếu `item_location_config` row không tồn tại cho item × location, Step 3 dùng default:
- `lead_time_days` = lấy từ `rtm_rule.lead_time_days` với priority = 1
- `lead_time_variability` = 0.20 (20%)

---

## 8. planning_cycle Table

Cấu hình pipeline trigger. Referenced trong 01-demand-ingestion.md.

```sql
CREATE TABLE planning_cycle (
    id                          SERIAL      PRIMARY KEY,
    cycle_name                  VARCHAR(100) NOT NULL DEFAULT 'UNIS_NIGHTLY',
    cutoff_time                 TIME        NOT NULL DEFAULT '23:00:00',
    cutoff_buffer_minutes       INT         NOT NULL DEFAULT 30,
    run_frequency               VARCHAR(20) NOT NULL DEFAULT 'NIGHTLY',
    horizon_weeks               INT         NOT NULL DEFAULT 12,
    frozen_zone_weeks           INT         NOT NULL DEFAULT 2,
    granularity                 VARCHAR(20) NOT NULL DEFAULT 'WEEKLY',
    timezone                    VARCHAR(50) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    freshness_threshold_minutes INT         NOT NULL DEFAULT 240,
    is_active                   BOOLEAN     NOT NULL DEFAULT TRUE,
    last_run_at                 TIMESTAMPTZ,
    next_run_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed ngay khi tạo DB
INSERT INTO planning_cycle (cycle_name) VALUES ('UNIS_NIGHTLY');
```

---

## 9. Migration SQL — migration 001

```sql
-- File: database/migrations/001_master_data.sql
-- Run order: FIRST — tất cả migrations sau đều phụ thuộc vào file này

-- 1. Enums
CREATE TYPE location_type_enum AS ENUM ('BRANCH', 'WAREHOUSE', 'FACTORY', 'HUB');

-- 2. item
CREATE TABLE item ( ... );  -- xem §3

-- 3. location
CREATE TABLE location ( ... );  -- xem §4

-- 4. supplier
CREATE TABLE supplier ( ... );  -- xem §5

-- 5. rtm_rule
CREATE TABLE rtm_rule ( ... );  -- xem §6

-- 6. item_location_config
CREATE TABLE item_location_config ( ... );  -- xem §7

-- 7. planning_cycle
CREATE TABLE planning_cycle ( ... );  -- xem §8
INSERT INTO planning_cycle (cycle_name) VALUES ('UNIS_NIGHTLY');

-- 8. import_error_log (dùng cho tất cả steps khi import CSV)
CREATE TABLE import_error_log (
    id              BIGSERIAL   PRIMARY KEY,
    step_name       VARCHAR(50) NOT NULL,   -- 'demand_ingestion', 'supply_snapshot', etc.
    run_id          BIGINT,                 -- FK tùy step (nullable)
    row_number      INT,
    raw_value       TEXT,
    error_type      VARCHAR(100),           -- 'ITEM_NOT_FOUND', 'LOCATION_NOT_FOUND', etc.
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 10. Seed Data Guide

### Thứ tự seed (quan trọng — FK constraints)

```
1. location   (không có FK phụ thuộc)
2. supplier   (không có FK phụ thuộc)
3. item       (không có FK phụ thuộc)
4. rtm_rule   (FK → item + location)
5. item_location_config  (FK → item + location)
6. planning_cycle  (không có FK)
```

### Format file seed

```
database/seeds/
├── seed_location.csv      ← location_code, location_name, location_type, region, province
├── seed_item.csv          ← item_code, item_name, unit_of_measure, variant_group, weight_kg_per_unit
├── seed_supplier.csv      ← supplier_code, supplier_name, lead_time_days_avg
├── seed_rtm_rules.csv     ← item_code, dest_location_code, source_location_code, priority, lead_time_days
└── seed_item_loc_config.csv ← item_code, location_code, lead_time_days
```

### Python seed script

```python
# data/seeds/load_master_data.py

import pandas as pd
from sqlalchemy import create_engine, text

engine = create_engine(DB_URL)

SEED_ORDER = [
    ('location', 'seeds/seed_location.csv'),
    ('supplier', 'seeds/seed_supplier.csv'),
    ('item', 'seeds/seed_item.csv'),
    ('rtm_rule', 'seeds/seed_rtm_rules.csv'),
    ('item_location_config', 'seeds/seed_item_loc_config.csv'),
]

for table, file in SEED_ORDER:
    df = pd.read_csv(file)
    df.to_sql(table, engine, if_exists='append', index=False)
    print(f"✅ {table}: {len(df)} rows seeded")
```

---

## 11. API Endpoints

Base path: `/api/v1/master`

### 11.1 Items

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/master/items` | List items (page, search, filter by abc_class, is_active) |
| `GET` | `/api/v1/master/items/:item_code` | Item detail |
| `GET` | `/api/v1/master/items/:item_code/variants` | Tất cả variants cùng variant_group |
| `POST` | `/api/v1/master/items/import` | Bulk import từ CSV |
| `GET` | `/api/v1/master/items/stats` | Tổng: active, dormant, ABC counts |

**GET /api/v1/master/items — Response:**
```json
{
  "data": [
    {
      "item_code": "GACH-MEN-60x60-A4",
      "item_name": "Gạch men 60x60 màu A4",
      "unit_of_measure": "THUNG",
      "variant_group": "GACH-MEN-60x60",
      "variant_suffix": "A4",
      "abc_class": "A",
      "combo_class": "SMOOTH",
      "weight_kg_per_unit": 18.500,
      "is_active": true,
      "is_dormant": false
    }
  ],
  "pagination": { "page": 1, "pageSize": 50, "total": 1419, "totalPages": 29 }
}
```

### 11.2 Locations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/master/locations` | List locations (filter by type, region) |
| `GET` | `/api/v1/master/locations/:location_code` | Location detail |
| `GET` | `/api/v1/master/locations/branches` | Shortcut: list BRANCH type only |
| `GET` | `/api/v1/master/locations/warehouses` | Shortcut: list WAREHOUSE + FACTORY + HUB |

### 11.3 RTM Rules

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/master/rtm-rules` | List RTM rules (filter by item_code, dest, source) |
| `GET` | `/api/v1/master/rtm-rules/item/:item_code` | All routes for 1 item |
| `POST` | `/api/v1/master/rtm-rules/import` | Bulk import CSV (108K rows) |

### 11.4 Stats

```
GET /api/v1/master/stats

Response:
{
  "items": { "total": 2412, "active": 1419, "dormant": 241, "discontinued": 752 },
  "locations": { "total": 95, "branches": 68, "warehouses": 19, "factories": 6, "hubs": 2 },
  "suppliers": { "total": 56 },
  "rtm_rules": { "total": 108028, "active": 107234 }
}
```

---

## 12. Cross-Module Usage

| Step | Dùng gì | Cụ thể |
|------|---------|--------|
| Step 1 | `item.item_code` | Map `fsku_id` → `item_code` khi import forecast |
| Step 1 | `location.location_code` | Map `branch_code` → `location_code` (type=BRANCH) |
| Step 2 | `location.location_code` | Map kho inventory |
| Step 2 | `item.item_code` | Map mã hàng tồn kho |
| Step 3 | `item.abc_class` | CSL targets cho Safety Stock |
| Step 3 | `rtm_rule.lead_time_days` | Input cho SS formula |
| Step 3 | `item_location_config` | Lead time per item × location |
| Step 4 | `item_location_config` | Lead time cho PAB calc |
| Step 4 | `planning_cycle` | Horizon, frozen zone config |
| Step 5 | `rtm_rule` | 108K rules cho Layer 1 routing |
| Step 5 | `item.variant_group` | Variant matching trong allocation |
| Step 6 | `item.weight_kg_per_unit` | Container weight calc |
| Step 6 | `location` | Source/dest cho trip routing |
| Step 7 | `location` | Branch scope cho CN approval |
| Step 8 | `item.abc_class` | KPI breakdown by ABC |

---

## 13. Acceptance Criteria

| AC ID | Criteria | Test |
|-------|---------|------|
| AC0-01 | Seed 2,412 items từ CSV không lỗi | `SELECT COUNT(*) FROM item` = 2412 |
| AC0-02 | Seed 68 branches, 19 WH, 6 NM | `SELECT location_type, COUNT(*) FROM location GROUP BY 1` |
| AC0-03 | Seed 108,028 RTM rules | `SELECT COUNT(*) FROM rtm_rule` = 108028 |
| AC0-04 | item_code FK constraint hoạt động | INSERT rtm_rule với item_code không tồn tại → 23503 FK error |
| AC0-05 | Variant group query trả đúng | GET /items/GACH-MEN-60x60-A4/variants → tất cả đuôi màu cùng group |
| AC0-06 | planning_cycle seed = 1 row | `SELECT COUNT(*) FROM planning_cycle` = 1 |
| AC0-07 | No tenant_id trong bất kỳ table nào | `SELECT column_name FROM information_schema.columns WHERE column_name = 'tenant_id'` → 0 rows |
| AC0-08 | Stats API trả đúng counts | GET /api/v1/master/stats → numbers match seed |
| AC0-09 | RTM lookup < 50ms cho 1 item × branch | EXPLAIN ANALYZE SELECT * FROM rtm_rule WHERE item_code=X AND dest_location_code=Y |
| AC0-10 | Import CSV 2,412 items < 10s | Python seed script timing |

---

*00-master-data.md — UNIS SCP Foundation | v1.0 | 2026-04-13*
*Resolves: D-MD-01 (item PK), D-MD-02 (unified location), D-MD-03 (no tenant_id), D-MD-04 (API path)*
*Must be completed before any Step 1-8 implementation begins.*
