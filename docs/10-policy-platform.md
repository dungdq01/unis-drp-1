# Module 10 — Policy Platform: BA Spec

> **Ngày tạo spec:** 2026-04-15
> **Trạng thái:** SPEC — chờ dev implement
> **Phụ thuộc:** Tất cả modules (1–9 đọc config từ đây)
> **FR gốc:** FR-v3.2-008 (Tenant Feature Toggle), FR-v3.2-009 (Mobile Masking), SCP Master v3.6 §10

---

## 0. Naming — Tránh conflict với M3 PolicyModule

> ⚠️ **CRITICAL:** `backend/src/policy/` đã tồn tại (Module 3 — Safety Stock, RTM Rules, ABC classification).
> Module 10 **PHẢI dùng tên khác:**

```
backend/src/system-config/          ← tên module mới
├── system-config.module.ts
├── system-config.controller.ts
├── system-config.service.ts
├── system-config.seed.ts
├── dto/
│   └── index.ts
├── entities/
│   ├── system-config.entity.ts
│   └── config-audit-log.entity.ts
└── migrations/
    ├── 001_create_system_config_tables.sql
    └── 002_seed_unis_defaults.sql
```

**API prefix:** `/api/v1/system-config/...`
**App registration:** `SystemConfigModule` trong `app.module.ts`

---

## 1. Mục tiêu module

Module 10 là **control plane** của toàn hệ thống UNIS — quản lý tất cả cấu hình vận hành mà không cần deploy lại code.

**5 nhóm cấu hình:**

| Nhóm | config_group | Nội dung |
|------|-------------|----------|
| **PlanningCycle** | `PLANNING_CYCLE` | Cutoff=23:00 ICT, cadence=NIGHTLY, horizon=12w, max_stale=240min |
| **UNIS Plugin Params** | `PLUGIN_PARAMS` | CSL A/B/C, LCNB mode, HSTK thresholds, PO overdue days |
| **Feature Toggles** | `FEATURE_TOGGLE` | Bật/tắt 8 capabilities per Phase |
| **Bravo ERP Adapter** | `BRAVO_ADAPTER` | Timeout, retry, field mapping, failure state |
| **Mobile Masking Info** | `MASKING` | Read-only Phase 1 — xem rule CN_WH masking |

> **RBAC Role Matrix:** Static hardcoded Phase 1 (không lưu DB) — xem §3.4. Không configurable Phase 1.

---

## 2. Phạm vi Phase 1 vs Phase 2

| Feature | Phase 1 | Phase 2 |
|---------|---------|---------|
| Xem tất cả config (GET) | ✅ | ✅ |
| Sửa config qua UI (PATCH) với validation bounds | ✅ SC_MANAGER only | ✅ |
| Audit trail mọi thay đổi | ✅ | ✅ |
| is_sensitive → mask value trong GET | ✅ | ✅ |
| Feature Toggles bật/tắt | ✅ | ✅ |
| RBAC role matrix view (static) | ✅ read-only | ✅ |
| RBAC configurable qua UI | ⬜ | ✅ |
| Mobile Masking view | ✅ read-only | ✅ |
| Mobile Masking edit qua UI | ⬜ | ✅ |
| Dry run trước publish | ⬜ | ✅ |
| Policy lifecycle (draft → approve → active) | ⬜ (save = active) | ✅ |
| Diff view old vs new | ⬜ | ✅ |
| Bravo adapter test connection | ⬜ | ✅ |

---

## 3. Cấu hình chi tiết

### 3.1 PlanningCycle Config

```
UNIS values:
  planning.cutoff_time       = "23:00"              ← nightly DRP trigger
  planning.timezone          = "Asia/Ho_Chi_Minh"
  planning.cadence           = "NIGHTLY"
  planning.horizon_weeks     = 12                   ← SCP 12w (TerraX 13w)
  planning.max_stale_minutes = 240                  ← Bravo batch mode (not real-time WMS)
  planning.force_override_allowed = "true"          ← Planner có thể bypass với audit log
```

### 3.2 UNIS Plugin Params

```
Safety Stock CSL:
  plugin.csl_class_a = 0.975   (z = 1.96) ← CHỐT: giữ plugin (97.5%), không dùng doc (95%)
  plugin.csl_class_b = 0.95    (z = 1.65)
  plugin.csl_class_c = 0.90    (z = 1.28)

HSTK:
  plugin.hstk_stockout_threshold  = 1.5   (weeks)
  plugin.hstk_overstock_threshold = 3.0   (weeks)

LCNB (Lateral Transfer):
  plugin.lcnb_mode   = "DETECT_ONLY"   ← Phase 1; Phase 4 → EXECUTE
  plugin.lcnb_factor = 0.25            ← SS reduction 25% khi EXECUTE

DRP:
  plugin.horizon_weeks  = 12
  plugin.lot_sizing     = "L4L"    (Lot-for-Lot)
  plugin.planning_mode  = "PUSH"

Execution:
  plugin.po_overdue_days = 10    ← UNIS = 10 ngày (không phải 7)
```

### 3.3 Feature Toggles

| Toggle Key | Default | Phase | Mô tả |
|------------|---------|-------|-------|
| `feature.lcnb.enabled` | `DETECT_ONLY` | Phase 1 | OFF / DETECT_ONLY / EXECUTE |
| `feature.adjustment_report.enabled` | `true` | Phase 2 | AdjustmentReport object |
| `feature.co2_tracking.enabled` | `false` | Phase 3 | CO2 module |
| `feature.mape_tracking.enabled` | `false` | BLOCKED | Cần actual_sales |
| `feature.email_alerts.enabled` | `false` | Phase 2 | SMTP integration |
| `feature.zalo_alerts.enabled` | `false` | Phase 2 | Zalo OA API |
| `feature.scheduled_kpi.enabled` | `false` | Phase 2 | pg_cron daily KPI |
| `feature.bravo_sftp_push.enabled` | `false` | Phase 2 | Auto CSV push to ERP |

### 3.4 RBAC Role Matrix (Static Phase 1 — không configurable)

> **Note Phase 1:** Hardcoded trong service `getRoles()`. Không lưu vào DB. Không edit qua UI.
> Phase 2 sẽ tạo `rbac_role_config` table và cho phép edit.

| Role | Scope | Quyền chính |
|------|-------|-------------|
| `SC_MANAGER` | Tenant-wide | Approve/reject orders toàn bộ branches, trigger DRP, edit config, xem tất cả |
| `CN_WH` | Location-scoped (own branch_id) | Approve transfer orders của branch mình; không thấy NM stock/price/other branches |
| `FORECAST_EDITOR` | Tenant-wide | Upload forecast CSV, freeze/unfreeze snapshot |
| `DATA_MANAGER` | Tenant-wide | Upload master data, supply snapshot |

**Mobile Masking — CN_WH không được thấy:**
- `supply_snapshot.qty` tại `location.type = 'WAREHOUSE'` (tồn NM)
- Giá / cost bất kỳ item nào
- Tồn kho của branches khác (ngoài own branch)
- LCNB lateral transfer excess của CN khác

**Default-deny:** Nếu masking config thiếu → mask TẤT CẢ sensitive fields.

### 3.5 Bravo ERP Adapter Config

```
bravo.erp_target      = "BRAVO"
bravo.timeout_seconds = 8
bravo.retry_count     = 3
bravo.retry_backoff   = [1, 4, 16]     (exponential seconds)
bravo.failure_state   = "MANUAL_POSTING"

Field mapping (SCP → Bravo):
  order_type      → MA_LOAI_CHUNG_TU
  item_code       → MA_HANG
  source_location → MA_KHO_XUAT
  dest_location   → MA_KHO_NHAP
  qty             → SO_LUONG
  base_uom        → DON_VI_TINH
  departure_date  → NGAY_GIAO
  erp_ref         → GHI_CHU_1   (idempotency key)
```

---

## 4. DB Schema — 2 bảng

### `system_config`

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| config_group | VARCHAR(50) NOT NULL | `PLANNING_CYCLE` / `PLUGIN_PARAMS` / `FEATURE_TOGGLE` / `BRAVO_ADAPTER` / `MASKING` |
| config_key | VARCHAR(100) NOT NULL | Ví dụ: `planning.cutoff_time` |
| config_value | TEXT NOT NULL | JSON hoặc scalar string |
| value_type | VARCHAR(20) NOT NULL | `STRING` / `NUMBER` / `BOOLEAN` / `JSON` |
| description | TEXT NULL | Giải thích config này làm gì |
| is_sensitive | BOOLEAN NOT NULL DEFAULT FALSE | Nếu TRUE → GET trả `"***"` thay vì giá trị thật |
| updated_by | VARCHAR(100) NULL | |
| updated_at | TIMESTAMP NOT NULL DEFAULT NOW() | |
| created_at | TIMESTAMP NOT NULL DEFAULT NOW() | |

**UNIQUE constraint:** `(config_group, config_key)`.

### `config_audit_log`

| Column | Type | Ghi chú |
|--------|------|---------|
| id | BIGSERIAL PK | |
| config_group | VARCHAR(50) NOT NULL | |
| config_key | VARCHAR(100) NOT NULL | |
| old_value | TEXT NULL | NULL khi là lần đầu set |
| new_value | TEXT NOT NULL | |
| changed_by | VARCHAR(100) NOT NULL | |
| changed_at | TIMESTAMP NOT NULL DEFAULT NOW() | |
| reason | TEXT NULL | Optional lý do thay đổi |

---

## 5. Validation Bounds per config_key

Service `updateConfigs()` phải validate trước khi save:

| config_key | Rule | Error nếu vi phạm |
|------------|------|-------------------|
| `plugin.csl_class_a/b/c` | 0 < value ≤ 1.0 | "CSL phải trong khoảng (0, 1]" |
| `plugin.hstk_stockout_threshold` | > 0 AND < `plugin.hstk_overstock_threshold` | "stockout_threshold phải < overstock_threshold" |
| `plugin.hstk_overstock_threshold` | > `plugin.hstk_stockout_threshold` | "overstock_threshold phải > stockout_threshold" |
| `plugin.horizon_weeks` | 1 ≤ value ≤ 52 | "horizon_weeks phải trong [1, 52]" |
| `plugin.po_overdue_days` | 1 ≤ value ≤ 365 | "po_overdue_days phải trong [1, 365]" |
| `planning.max_stale_minutes` | 1 ≤ value ≤ 1440 | "max_stale_minutes phải trong [1, 1440]" |
| `plugin.lcnb_factor` | 0 ≤ value ≤ 1.0 | "lcnb_factor phải trong [0, 1]" |
| `feature.lcnb.enabled` | IN ('OFF', 'DETECT_ONLY', 'EXECUTE') | "lcnb mode không hợp lệ" |

---

## 6. is_sensitive Masking Logic

Trong `getConfigByGroup()` và `getAll()`:

```typescript
// Service: mask sensitive values in response
configs.map(c => ({
  ...c,
  config_value: c.is_sensitive ? '***' : c.config_value,
}))
```

Các keys hiện tại đặt `is_sensitive = true` (nếu sau này thêm credentials):
- Bất kỳ key nào chứa `password`, `api_key`, `secret`, `token` trong tên

Phase 1: tất cả UNIS defaults đều `is_sensitive = false`. Logic mask sẵn sàng cho Phase 2 khi Bravo credentials được thêm.

---

## 7. API Endpoints (7 endpoints)

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/v1/system-config` | List tất cả configs (filter by group) |
| GET | `/api/v1/system-config/:group` | Configs của 1 group |
| PATCH | `/api/v1/system-config` | Update 1+ config keys (validate bounds + mask + audit) |
| GET | `/api/v1/system-config/toggles` | List feature toggles + trạng thái |
| PATCH | `/api/v1/system-config/toggles/:key` | Bật/tắt 1 feature toggle |
| GET | `/api/v1/system-config/roles` | RBAC role matrix (static) |
| GET | `/api/v1/system-config/audit` | Config change history (paginated) |

### 7.1 GET `/system-config/PLANNING_CYCLE`

**Response:**
```json
{
  "group": "PLANNING_CYCLE",
  "configs": [
    { "key": "planning.cutoff_time", "value": "23:00", "type": "STRING", "isSensitive": false, "updatedAt": "..." },
    { "key": "planning.horizon_weeks", "value": "12", "type": "NUMBER", "isSensitive": false }
  ]
}
```

### 7.2 PATCH `/system-config`

**Request:**
```json
{
  "updates": [
    {
      "group": "PLUGIN_PARAMS",
      "key": "plugin.csl_class_a",
      "value": "0.975",
      "reason": "Giữ 97.5% CSL A-class theo quyết định BA 2026-04-15"
    }
  ],
  "updatedBy": "sc_manager"
}
```

**Validation:** Server check bounds trước khi save. Nếu fail → 400 kèm message.

**Response:**
```json
{ "updated": 1, "auditIds": [42] }
```

### 7.3 GET `/system-config/roles`

**Response:**
```json
{
  "note": "Static Phase 1 — not configurable via UI",
  "roles": [
    {
      "role": "SC_MANAGER",
      "scope": "TENANT_WIDE",
      "permissions": ["approve_orders", "trigger_drp", "edit_config", "view_all"],
      "masking": "NONE"
    },
    {
      "role": "CN_WH",
      "scope": "LOCATION_SCOPED",
      "permissions": ["approve_orders_own_branch", "view_own_branch_stock"],
      "masking": "NM_STOCK | PRICES | OTHER_BRANCHES"
    }
  ]
}
```

---

## 8. Seed Data mặc định (UNIS)

File `002_seed_unis_defaults.sql`:

```sql
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive)
VALUES
  -- PLANNING_CYCLE
  ('PLANNING_CYCLE', 'planning.cutoff_time',            '"23:00"',          'STRING',  'Nightly DRP cutoff (ICT)',                    false),
  ('PLANNING_CYCLE', 'planning.timezone',               '"Asia/Ho_Chi_Minh"','STRING', 'Timezone',                                    false),
  ('PLANNING_CYCLE', 'planning.horizon_weeks',          '12',               'NUMBER',  'DRP planning horizon (weeks)',                false),
  ('PLANNING_CYCLE', 'planning.max_stale_minutes',      '240',              'NUMBER',  'Bravo batch mode — max data age before block',false),
  ('PLANNING_CYCLE', 'planning.cadence',                '"NIGHTLY"',        'STRING',  'Run frequency',                              false),
  ('PLANNING_CYCLE', 'planning.force_override_allowed', 'true',             'BOOLEAN', 'Allow planner to bypass stale gate with audit',false),

  -- PLUGIN_PARAMS
  ('PLUGIN_PARAMS', 'plugin.csl_class_a',               '0.975',            'NUMBER',  'CSL Class A = 97.5% (z=1.96)',               false),
  ('PLUGIN_PARAMS', 'plugin.csl_class_b',               '0.95',             'NUMBER',  'CSL Class B = 95% (z=1.65)',                 false),
  ('PLUGIN_PARAMS', 'plugin.csl_class_c',               '0.90',             'NUMBER',  'CSL Class C = 90% (z=1.28)',                 false),
  ('PLUGIN_PARAMS', 'plugin.hstk_stockout_threshold',   '1.5',              'NUMBER',  'HSTK < 1.5w = STOCKOUT CRITICAL',            false),
  ('PLUGIN_PARAMS', 'plugin.hstk_overstock_threshold',  '3.0',              'NUMBER',  'HSTK > 3.0w = OVERSTOCK WARNING',            false),
  ('PLUGIN_PARAMS', 'plugin.lcnb_mode',                 '"DETECT_ONLY"',    'STRING',  'Lateral transfer mode: OFF/DETECT_ONLY/EXECUTE',false),
  ('PLUGIN_PARAMS', 'plugin.lcnb_factor',               '0.25',             'NUMBER',  'SS reduction % when EXECUTE mode (Phase 4)', false),
  ('PLUGIN_PARAMS', 'plugin.horizon_weeks',             '12',               'NUMBER',  'DRP horizon used by engine',                 false),
  ('PLUGIN_PARAMS', 'plugin.lot_sizing',                '"L4L"',            'STRING',  'Lot sizing method: L4L/MOQ',                 false),
  ('PLUGIN_PARAMS', 'plugin.planning_mode',             '"PUSH"',           'STRING',  'PUSH or PULL',                               false),
  ('PLUGIN_PARAMS', 'plugin.po_overdue_days',           '10',               'NUMBER',  'UNIS PO overdue threshold (not 7)',          false),

  -- FEATURE_TOGGLE
  ('FEATURE_TOGGLE', 'feature.lcnb.enabled',            '"DETECT_ONLY"',    'STRING',  'OFF/DETECT_ONLY/EXECUTE',                    false),
  ('FEATURE_TOGGLE', 'feature.adjustment_report.enabled','true',            'BOOLEAN', 'AdjustmentReport Phase 2',                   false),
  ('FEATURE_TOGGLE', 'feature.co2_tracking.enabled',    'false',            'BOOLEAN', 'CO2 module — Phase 3',                       false),
  ('FEATURE_TOGGLE', 'feature.mape_tracking.enabled',   'false',            'BOOLEAN', 'BLOCKED: actual_sales table pending',        false),
  ('FEATURE_TOGGLE', 'feature.email_alerts.enabled',    'false',            'BOOLEAN', 'SMTP email alerts — Phase 2',                false),
  ('FEATURE_TOGGLE', 'feature.zalo_alerts.enabled',     'false',            'BOOLEAN', 'Zalo OA alerts — Phase 2',                   false),
  ('FEATURE_TOGGLE', 'feature.scheduled_kpi.enabled',   'false',            'BOOLEAN', 'pg_cron daily KPI — Phase 2',               false),
  ('FEATURE_TOGGLE', 'feature.bravo_sftp_push.enabled', 'false',            'BOOLEAN', 'Auto CSV push to Bravo — Phase 2',          false),

  -- BRAVO_ADAPTER
  ('BRAVO_ADAPTER', 'bravo.erp_target',                 '"BRAVO"',          'STRING',  'ERP system name',                            false),
  ('BRAVO_ADAPTER', 'bravo.timeout_seconds',            '8',                'NUMBER',  'Per call timeout (seconds)',                 false),
  ('BRAVO_ADAPTER', 'bravo.retry_count',                '3',                'NUMBER',  'Max retry attempts',                         false),
  ('BRAVO_ADAPTER', 'bravo.retry_backoff',              '[1,4,16]',         'JSON',    'Exponential backoff (seconds)',               false),
  ('BRAVO_ADAPTER', 'bravo.failure_state',              '"MANUAL_POSTING"', 'STRING',  'Action on failure: MANUAL_POSTING alert',    false)

ON CONFLICT (config_group, config_key) DO NOTHING;
```

---

## 9. Frontend — `app/policy/page.tsx`

> FE route giữ `/policy` (đã có sidebar). Module backend đổi tên nhưng FE page path không cần đổi.

**4 tabs:**

| Tab | Nội dung |
|-----|----------|
| **Planning Cycle** | Cards: cutoff, timezone, horizon, max_stale. Inline edit (SC_MANAGER). |
| **Plugin Params** | CSL A/B/C, HSTK thresholds, LCNB dropdown, po_overdue_days. Inline edit. |
| **Feature Toggles** | Toggle switches per feature. Disabled + badge "Phase 2/3/BLOCKED" cho features chưa khả dụng. |
| **System Info** | Bravo config (read-only), RBAC table static (read-only + note "Phase 1"), Config audit log paginated. |

**UX notes:**
- SC_MANAGER: thấy nút Edit/Save. Phase 1: free-text actor field.
- Save flow: confirm dialog "Bạn đang thay đổi config hệ thống. Tiếp tục?" → PATCH → toast "Config updated" → reload tab
- is_sensitive value `"***"`: hiển thị `••••••••` với tooltip "Sensitive — không hiển thị"
- RBAC table: badge nhỏ "Static — Phase 1" bên cạnh tiêu đề

---

## 10. Task Checklist

### Backend
```
BE-1  Tạo src/system-config/ (KHÔNG phải src/policy/ — đã có M3)
BE-2  Chạy migration 001_create_system_config_tables.sql
BE-3  Chạy seed 002_seed_unis_defaults.sql
BE-4  Tạo entities: system-config.entity.ts, config-audit-log.entity.ts
BE-5  Tạo dto/index.ts (UpdateConfigDto với validation, ListConfigQueryDto, ToggleDto)
BE-6  Tạo system-config.service.ts:
        getAll(group?)          — filter + mask is_sensitive
        getByGroup(group)       — single group
        updateConfigs(dto)      — validate bounds → save → write audit log
        getToggles()            — filter group=FEATURE_TOGGLE
        updateToggle(key, val)  — validate allowed values → save → audit
        getRoles()              — return static RBAC matrix (no DB)
        getAuditLog(page, size) — paginated DESC
BE-7  Tạo system-config.controller.ts (7 endpoints, prefix = 'system-config')
BE-8  Tạo system-config.module.ts (export SystemConfigModule)
BE-9  Register SystemConfigModule trong app.module.ts
```

### Frontend
```
FE-1  lib/api/system-config.ts (types + 7 API functions, URL = /system-config/...)
FE-2  app/policy/page.tsx (4 tabs — route giữ /policy)
FE-3  Planning Cycle tab với inline edit
FE-4  Plugin Params tab với inline edit + LCNB dropdown
FE-5  Feature Toggles tab (switches + phase badges)
FE-6  System Info tab (Bravo read-only + RBAC static table + audit log)
FE-7  Sidebar nav đã có /policy (step 10) — verify không cần thêm
```

### QA
```
QA-1  GET /system-config/PLANNING_CYCLE → 6 configs, values = UNIS defaults
QA-2  PATCH plugin.csl_class_a = 1.5 → 400 "CSL phải trong khoảng (0, 1]"
QA-3  PATCH plugin.hstk_stockout = 4.0 khi overstock = 3.0 → 400 "stockout < overstock"
QA-4  PATCH plugin.csl_class_a = 0.975 → config_audit_log có row mới (old/new/changed_by)
QA-5  GET /system-config → is_sensitive=true fields trả về "***"
QA-6  GET /system-config/toggles → feature.lcnb.enabled = DETECT_ONLY
QA-7  PATCH toggles/feature.co2_tracking.enabled value="true" → saved, audit logged
QA-8  GET /system-config/roles → 4 roles, CN_WH masking rules đúng
QA-9  GET /system-config/audit → DESC order, old_value/new_value đúng
QA-10 FE: disabled toggle Phase 2 → không thể click, badge hiển thị
```

---

## 11. Giới hạn Phase 1

| Giới hạn | Lý do | Phase 2 plan |
|----------|-------|-------------|
| Save = active ngay (không draft/approve) | Đơn giản hóa | Policy lifecycle full |
| Không có dry-run | Phase 1 scope | Dry run trước publish |
| Không có diff view | Phase 1 scope | Diff view old vs new |
| Mobile masking: view-only | Phase 1 scope | Edit masking policy qua UI |
| RBAC static hardcoded | Phase 1 scope | `rbac_role_config` table + UI |
| Bravo: config xem, không test connection | Phase 1 scope | Test connection button |
| No JWT (actor = free-text) | Phase 1 scope | JWT SC_MANAGER guard |

---

*Module 10 spec v2 — 2026-04-15*
