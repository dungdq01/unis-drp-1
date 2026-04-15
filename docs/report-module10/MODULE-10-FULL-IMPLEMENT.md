# Module 10 — Policy Platform (System Config): Full Implementation Guide

> **Ngày tạo:** 2026-04-15
> **Spec gốc:** `docs/10-policy-platform.md` v2
> **Stack:** NestJS + TypeORM + PostgreSQL + Next.js 14
> **Backend module:** `src/system-config/` (KHÔNG phải `src/policy/` — M3 đã dùng)
> **API prefix:** `/api/v1/system-config`
> **FE route:** `/policy` (giữ sidebar entry hiện tại)

---

## §0 — UNIS Constraints (đọc trước khi code)

| Constraint | Giá trị | Lý do |
|------------|---------|-------|
| PK tất cả tables | `BIGSERIAL` | Consistent với toàn project |
| Naming conflict M3 | `src/system-config/` ONLY | `src/policy/` đã có Safety Stock/RTM |
| is_sensitive masking | GET trả `"***"` nếu `is_sensitive = true` | Bravo credentials Phase 2 |
| RBAC matrix | Hardcoded trong service, KHÔNG lưu DB | Static Phase 1 |
| Validation bounds | Check trong service trước `save()` | Tránh invalid config phá engine |
| Seed data | 30 rows UNIS defaults (ON CONFLICT DO NOTHING) | Idempotent re-run |
| CSL A default | 0.975 (97.5%, z=1.96) | Plugin code — không phải doc value 95% |
| po_overdue_days | 10 ngày | UNIS-specific, không phải 7 |
| horizon_weeks | 12 | UNIS (TerraX dùng 13) |

---

## §1 — Migration SQL

### File: `src/system-config/migrations/001_create_system_config_tables.sql`

```sql
-- ============================================================
-- Module 10: System Config tables
-- ============================================================

CREATE TABLE IF NOT EXISTS system_config (
  id            BIGSERIAL     PRIMARY KEY,
  config_group  VARCHAR(50)   NOT NULL,
  config_key    VARCHAR(100)  NOT NULL,
  config_value  TEXT          NOT NULL,
  value_type    VARCHAR(20)   NOT NULL DEFAULT 'STRING',  -- STRING | NUMBER | BOOLEAN | JSON
  description   TEXT          NULL,
  is_sensitive  BOOLEAN       NOT NULL DEFAULT FALSE,
  updated_by    VARCHAR(100)  NULL,
  updated_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_system_config_group_key UNIQUE (config_group, config_key)
);

CREATE INDEX idx_system_config_group ON system_config (config_group);

-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS config_audit_log (
  id            BIGSERIAL     PRIMARY KEY,
  config_group  VARCHAR(50)   NOT NULL,
  config_key    VARCHAR(100)  NOT NULL,
  old_value     TEXT          NULL,    -- NULL = lần đầu set
  new_value     TEXT          NOT NULL,
  changed_by    VARCHAR(100)  NOT NULL,
  changed_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  reason        TEXT          NULL
);

CREATE INDEX idx_audit_log_key       ON config_audit_log (config_group, config_key);
CREATE INDEX idx_audit_log_changed_at ON config_audit_log (changed_at DESC);
```

### File: `src/system-config/migrations/002_seed_unis_defaults.sql`

```sql
-- UNIS default values — idempotent (ON CONFLICT DO NOTHING)
INSERT INTO system_config (config_group, config_key, config_value, value_type, description, is_sensitive)
VALUES
  -- PLANNING_CYCLE (6 rows)
  ('PLANNING_CYCLE', 'planning.cutoff_time',             '"23:00"',           'STRING',  'Nightly DRP cutoff (ICT)',                     false),
  ('PLANNING_CYCLE', 'planning.timezone',                '"Asia/Ho_Chi_Minh"','STRING',  'Timezone',                                     false),
  ('PLANNING_CYCLE', 'planning.horizon_weeks',           '12',                'NUMBER',  'DRP planning horizon (weeks)',                 false),
  ('PLANNING_CYCLE', 'planning.max_stale_minutes',       '240',               'NUMBER',  'Bravo batch mode — max data age before block', false),
  ('PLANNING_CYCLE', 'planning.cadence',                 '"NIGHTLY"',         'STRING',  'Run frequency',                               false),
  ('PLANNING_CYCLE', 'planning.force_override_allowed',  'true',              'BOOLEAN', 'Allow planner to bypass stale gate with audit',false),

  -- PLUGIN_PARAMS (11 rows)
  ('PLUGIN_PARAMS', 'plugin.csl_class_a',                '0.975',             'NUMBER',  'CSL Class A = 97.5% (z=1.96)',                false),
  ('PLUGIN_PARAMS', 'plugin.csl_class_b',                '0.95',              'NUMBER',  'CSL Class B = 95% (z=1.65)',                  false),
  ('PLUGIN_PARAMS', 'plugin.csl_class_c',                '0.90',              'NUMBER',  'CSL Class C = 90% (z=1.28)',                  false),
  ('PLUGIN_PARAMS', 'plugin.hstk_stockout_threshold',    '1.5',               'NUMBER',  'HSTK < 1.5w = STOCKOUT CRITICAL',             false),
  ('PLUGIN_PARAMS', 'plugin.hstk_overstock_threshold',   '3.0',               'NUMBER',  'HSTK > 3.0w = OVERSTOCK WARNING',             false),
  ('PLUGIN_PARAMS', 'plugin.lcnb_mode',                  '"DETECT_ONLY"',     'STRING',  'Lateral transfer: OFF/DETECT_ONLY/EXECUTE',   false),
  ('PLUGIN_PARAMS', 'plugin.lcnb_factor',                '0.25',              'NUMBER',  'SS reduction when EXECUTE mode (Phase 4)',    false),
  ('PLUGIN_PARAMS', 'plugin.horizon_weeks',              '12',                'NUMBER',  'DRP horizon used by engine',                  false),
  ('PLUGIN_PARAMS', 'plugin.lot_sizing',                 '"L4L"',             'STRING',  'Lot sizing method: L4L/MOQ',                  false),
  ('PLUGIN_PARAMS', 'plugin.planning_mode',              '"PUSH"',            'STRING',  'PUSH or PULL',                                false),
  ('PLUGIN_PARAMS', 'plugin.po_overdue_days',            '10',                'NUMBER',  'UNIS PO overdue threshold (not 7)',           false),

  -- FEATURE_TOGGLE (8 rows)
  ('FEATURE_TOGGLE', 'feature.lcnb.enabled',             '"DETECT_ONLY"',     'STRING',  'OFF/DETECT_ONLY/EXECUTE',                     false),
  ('FEATURE_TOGGLE', 'feature.adjustment_report.enabled','true',              'BOOLEAN', 'AdjustmentReport Phase 2',                    false),
  ('FEATURE_TOGGLE', 'feature.co2_tracking.enabled',     'false',             'BOOLEAN', 'CO2 module — Phase 3',                        false),
  ('FEATURE_TOGGLE', 'feature.mape_tracking.enabled',    'false',             'BOOLEAN', 'BLOCKED: actual_sales table pending',         false),
  ('FEATURE_TOGGLE', 'feature.email_alerts.enabled',     'false',             'BOOLEAN', 'SMTP email alerts — Phase 2',                 false),
  ('FEATURE_TOGGLE', 'feature.zalo_alerts.enabled',      'false',             'BOOLEAN', 'Zalo OA alerts — Phase 2',                    false),
  ('FEATURE_TOGGLE', 'feature.scheduled_kpi.enabled',    'false',             'BOOLEAN', 'pg_cron daily KPI — Phase 2',                false),
  ('FEATURE_TOGGLE', 'feature.bravo_sftp_push.enabled',  'false',             'BOOLEAN', 'Auto CSV push to Bravo — Phase 2',           false),

  -- BRAVO_ADAPTER (5 rows)
  ('BRAVO_ADAPTER', 'bravo.erp_target',                  '"BRAVO"',           'STRING',  'ERP system name',                             false),
  ('BRAVO_ADAPTER', 'bravo.timeout_seconds',             '8',                 'NUMBER',  'Per call timeout (seconds)',                  false),
  ('BRAVO_ADAPTER', 'bravo.retry_count',                 '3',                 'NUMBER',  'Max retry attempts',                          false),
  ('BRAVO_ADAPTER', 'bravo.retry_backoff',               '[1,4,16]',          'JSON',    'Exponential backoff (seconds)',                false),
  ('BRAVO_ADAPTER', 'bravo.failure_state',               '"MANUAL_POSTING"',  'STRING',  'Action on failure: MANUAL_POSTING alert',     false)

ON CONFLICT (config_group, config_key) DO NOTHING;
```

---

## §2 — Entities

### `src/system-config/entities/system-config.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('system_config')
export class SystemConfig {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;  // Issue-2 fix: string consistent với M1-M9 BIGSERIAL convention

  @Column({ name: 'config_group', length: 50 })
  configGroup: string;

  @Column({ name: 'config_key', length: 100 })
  configKey: string;

  @Column({ name: 'config_value', type: 'text' })
  configValue: string;

  @Column({ name: 'value_type', length: 20, default: 'STRING' })
  valueType: string;  // STRING | NUMBER | BOOLEAN | JSON

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_sensitive', default: false })
  isSensitive: boolean;

  @Column({ name: 'updated_by', length: 100, nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### `src/system-config/entities/config-audit-log.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('config_audit_log')
export class ConfigAuditLog {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;  // Issue-2 fix: string consistent với M1-M9 BIGSERIAL convention

  @Column({ name: 'config_group', length: 50 })
  configGroup: string;

  @Column({ name: 'config_key', length: 100 })
  configKey: string;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue: string | null;

  @Column({ name: 'new_value', type: 'text' })
  newValue: string;

  @Column({ name: 'changed_by', length: 100 })
  changedBy: string;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt: Date;

  @Column({ type: 'text', nullable: true })
  reason: string | null;
}
```

---

## §3 — DTOs

### `src/system-config/dto/index.ts`

```typescript
import { IsString, IsNotEmpty, IsOptional, IsIn, IsNumberString, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

// ── Query ──────────────────────────────────────────────────────────

export class ListConfigQueryDto {
  @IsOptional()
  @IsIn(['PLANNING_CYCLE', 'PLUGIN_PARAMS', 'FEATURE_TOGGLE', 'BRAVO_ADAPTER', 'MASKING'])
  group?: string;
}

export class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  size?: number = 20;
}

// ── Update ─────────────────────────────────────────────────────────

export class ConfigUpdateItemDto {
  @IsString()
  @IsNotEmpty()
  group: string;

  @IsString()
  @IsNotEmpty()
  key: string;

  @IsString()
  @IsNotEmpty()
  value: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateConfigsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigUpdateItemDto)
  updates: ConfigUpdateItemDto[];

  @IsString()
  @IsNotEmpty()
  updatedBy: string;
}

// ── Toggle ─────────────────────────────────────────────────────────

export class UpdateToggleDto {
  @IsString()
  @IsNotEmpty()
  value: string;

  @IsString()
  @IsNotEmpty()
  updatedBy: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
```

---

## §4 — Service

### `src/system-config/system-config.service.ts`

```typescript
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';
import { ConfigAuditLog } from './entities/config-audit-log.entity';
import { UpdateConfigsDto, UpdateToggleDto, AuditQueryDto } from './dto';

// ── Validation bounds table ────────────────────────────────────────
// validateBound() checks these rules before saving
const BOUNDS: Record<string, (value: string, allUpdates?: Map<string, string>) => void> = {
  'plugin.csl_class_a': (v) => {
    const n = Number(v);
    if (isNaN(n) || n <= 0 || n > 1) throw new BadRequestException('CSL phải trong khoảng (0, 1]');
  },
  'plugin.csl_class_b': (v) => {
    const n = Number(v);
    if (isNaN(n) || n <= 0 || n > 1) throw new BadRequestException('CSL phải trong khoảng (0, 1]');
  },
  'plugin.csl_class_c': (v) => {
    const n = Number(v);
    if (isNaN(n) || n <= 0 || n > 1) throw new BadRequestException('CSL phải trong khoảng (0, 1]');
  },
  'plugin.lcnb_factor': (v) => {
    const n = Number(v);
    if (isNaN(n) || n < 0 || n > 1) throw new BadRequestException('lcnb_factor phải trong [0, 1]');
  },
  'plugin.horizon_weeks': (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 52) throw new BadRequestException('horizon_weeks phải trong [1, 52]');
  },
  'plugin.po_overdue_days': (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new BadRequestException('po_overdue_days phải trong [1, 365]');
  },
  'planning.max_stale_minutes': (v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 1440) throw new BadRequestException('max_stale_minutes phải trong [1, 1440]');
  },
  'feature.lcnb.enabled': (v) => {
    const raw = v.replace(/^"|"$/g, '');
    if (!['OFF', 'DETECT_ONLY', 'EXECUTE'].includes(raw)) {
      throw new BadRequestException("lcnb mode không hợp lệ — phải là OFF | DETECT_ONLY | EXECUTE");
    }
  },
};

// Static RBAC matrix — Phase 1 (not stored in DB)
const STATIC_ROLES = [
  {
    role: 'SC_MANAGER',
    scope: 'TENANT_WIDE',
    permissions: ['approve_orders', 'trigger_drp', 'edit_config', 'view_all'],
    masking: 'NONE',
  },
  {
    role: 'CN_WH',
    scope: 'LOCATION_SCOPED',
    permissions: ['approve_orders_own_branch', 'view_own_branch_stock'],
    masking: 'NM_STOCK | PRICES | OTHER_BRANCHES',
  },
  {
    role: 'FORECAST_EDITOR',
    scope: 'TENANT_WIDE',
    permissions: ['upload_forecast_csv', 'freeze_snapshot', 'unfreeze_snapshot'],
    masking: 'NONE',
  },
  {
    role: 'DATA_MANAGER',
    scope: 'TENANT_WIDE',
    permissions: ['upload_master_data', 'upload_supply_snapshot'],
    masking: 'NONE',
  },
];

@Injectable()
export class SystemConfigService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(ConfigAuditLog)
    private readonly auditRepo: Repository<ConfigAuditLog>,
  ) {}

  // ── GET all (optional group filter) ───────────────────────────────

  async getAll(group?: string): Promise<{ group: string; configs: object[] }[]> {
    const qb = this.configRepo.createQueryBuilder('c').orderBy('c.configGroup').addOrderBy('c.configKey');
    if (group) qb.where('c.configGroup = :group', { group });

    const rows = await qb.getMany();
    return this._groupAndMask(rows);
  }

  // ── GET single group ──────────────────────────────────────────────

  async getByGroup(group: string): Promise<{ group: string; configs: object[] }> {
    const rows = await this.configRepo.find({
      where: { configGroup: group },
      order: { configKey: 'ASC' },
    });
    const grouped = this._groupAndMask(rows);
    return grouped[0] ?? { group, configs: [] };
  }

  // ── PATCH configs ─────────────────────────────────────────────────

  async updateConfigs(dto: UpdateConfigsDto): Promise<{ updated: number; auditIds: string[] }> {
    // 1. Build update map for cross-key validation (stockout vs overstock)
    const updateMap = new Map<string, string>(dto.updates.map(u => [u.key, u.value]));

    // 2. Validate each update
    for (const item of dto.updates) {
      const boundsCheck = BOUNDS[item.key];
      if (boundsCheck) boundsCheck(item.value, updateMap);

      // Cross-key: stockout must be < overstock
      // BUG-1 fix: _loadValue nhận cả configGroup — configKey không unique toàn table
      if (item.key === 'plugin.hstk_stockout_threshold') {
        const overstockVal = updateMap.get('plugin.hstk_overstock_threshold')
          ?? (await this._loadValue('PLUGIN_PARAMS', 'plugin.hstk_overstock_threshold'));
        if (overstockVal && Number(item.value) >= Number(overstockVal)) {
          throw new BadRequestException('stockout_threshold phải < overstock_threshold');
        }
      }
      if (item.key === 'plugin.hstk_overstock_threshold') {
        const stockoutVal = updateMap.get('plugin.hstk_stockout_threshold')
          ?? (await this._loadValue('PLUGIN_PARAMS', 'plugin.hstk_stockout_threshold'));
        if (stockoutVal && Number(item.value) <= Number(stockoutVal)) {
          throw new BadRequestException('overstock_threshold phải > stockout_threshold');
        }
      }
    }

    // 3. Apply updates
    const auditIds: string[] = [];
    for (const item of dto.updates) {
      const existing = await this.configRepo.findOne({
        where: { configGroup: item.group, configKey: item.key },
      });
      if (!existing) throw new NotFoundException(`Config key không tìm thấy: ${item.group}/${item.key}`);

      const oldValue = existing.configValue;
      existing.configValue = item.value;
      existing.updatedBy = dto.updatedBy;
      await this.configRepo.save(existing);

      const audit = this.auditRepo.create({
        configGroup: item.group,
        configKey: item.key,
        oldValue,
        newValue: item.value,
        changedBy: dto.updatedBy,
        reason: item.reason ?? null,
      });
      const saved = await this.auditRepo.save(audit);
      auditIds.push(saved.id);  // Issue-2 fix: id is string, no Number() cast needed
    }

    return { updated: dto.updates.length, auditIds };
  }

  // ── GET toggles ───────────────────────────────────────────────────

  async getToggles(): Promise<object[]> {
    const rows = await this.configRepo.find({
      where: { configGroup: 'FEATURE_TOGGLE' },
      order: { configKey: 'ASC' },
    });
    return rows.map(r => ({
      key: r.configKey,
      value: r.configValue,
      description: r.description,
      updatedAt: r.updatedAt,
    }));
  }

  // ── PATCH single toggle ───────────────────────────────────────────

  async updateToggle(key: string, dto: UpdateToggleDto): Promise<{ updated: boolean; auditId: string }> {
    const fullKey = key.startsWith('feature.') ? key : `feature.${key}`;
    const existing = await this.configRepo.findOne({
      where: { configGroup: 'FEATURE_TOGGLE', configKey: fullKey },
    });
    if (!existing) throw new NotFoundException(`Toggle key không tìm thấy: ${fullKey}`);

    // Validate lcnb toggle
    const boundsCheck = BOUNDS[fullKey];
    if (boundsCheck) boundsCheck(dto.value);

    const oldValue = existing.configValue;
    existing.configValue = dto.value;
    existing.updatedBy = dto.updatedBy;
    await this.configRepo.save(existing);

    const audit = this.auditRepo.create({
      configGroup: 'FEATURE_TOGGLE',
      configKey: fullKey,
      oldValue,
      newValue: dto.value,
      changedBy: dto.updatedBy,
      reason: dto.reason ?? null,
    });
    const saved = await this.auditRepo.save(audit);

    return { updated: true, auditId: saved.id };  // Issue-2 fix: id is string
  }

  // ── GET roles (static Phase 1) ────────────────────────────────────

  getRoles(): object {
    return {
      note: 'Static Phase 1 — not configurable via UI',
      roles: STATIC_ROLES,
    };
  }

  // ── GET audit log ─────────────────────────────────────────────────

  async getAuditLog(query: AuditQueryDto): Promise<{ data: object[]; total: number; page: number; size: number }> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const [rows, total] = await this.auditRepo.findAndCount({
      order: { changedAt: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { data: rows, total, page, size };
  }

  // ── Private helpers ───────────────────────────────────────────────

  private _groupAndMask(rows: SystemConfig[]): { group: string; configs: object[] }[] {
    const map = new Map<string, object[]>();
    for (const r of rows) {
      if (!map.has(r.configGroup)) map.set(r.configGroup, []);
      map.get(r.configGroup)!.push({
        key: r.configKey,
        value: r.isSensitive ? '***' : r.configValue,
        type: r.valueType,
        isSensitive: r.isSensitive,
        description: r.description,
        updatedBy: r.updatedBy,
        updatedAt: r.updatedAt,
      });
    }
    return Array.from(map.entries()).map(([group, configs]) => ({ group, configs }));
  }

  // BUG-1 fix: added configGroup param — configKey is only unique within (configGroup, configKey)
  private async _loadValue(configGroup: string, configKey: string): Promise<string | null> {
    const row = await this.configRepo.findOne({ where: { configGroup, configKey } });
    return row?.configValue ?? null;
  }
}
```

---

## §5 — Controller

### `src/system-config/system-config.controller.ts`

```typescript
import { Controller, Get, Patch, Param, Query, Body } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { ListConfigQueryDto, UpdateConfigsDto, UpdateToggleDto, AuditQueryDto } from './dto';

@Controller('system-config')
export class SystemConfigController {
  constructor(private readonly svc: SystemConfigService) {}

  // GET /api/v1/system-config?group=PLANNING_CYCLE
  @Get()
  getAll(@Query() q: ListConfigQueryDto) {
    return this.svc.getAll(q.group);
  }

  // GET /api/v1/system-config/roles  ← MUST be before /:group to avoid route conflict
  @Get('roles')
  getRoles() {
    return this.svc.getRoles();
  }

  // GET /api/v1/system-config/toggles
  @Get('toggles')
  getToggles() {
    return this.svc.getToggles();
  }

  // GET /api/v1/system-config/audit
  @Get('audit')
  getAudit(@Query() q: AuditQueryDto) {
    return this.svc.getAuditLog(q);
  }

  // GET /api/v1/system-config/:group
  @Get(':group')
  getByGroup(@Param('group') group: string) {
    return this.svc.getByGroup(group.toUpperCase());
  }

  // PATCH /api/v1/system-config
  @Patch()
  updateConfigs(@Body() dto: UpdateConfigsDto) {
    return this.svc.updateConfigs(dto);
  }

  // PATCH /api/v1/system-config/toggles/:key
  @Patch('toggles/:key')
  updateToggle(@Param('key') key: string, @Body() dto: UpdateToggleDto) {
    return this.svc.updateToggle(key, dto);
  }
}
```

> **QUAN TRỌNG:** Route order — `@Get('roles')`, `@Get('toggles')`, `@Get('audit')` phải đặt TRƯỚC `@Get(':group')` để NestJS không nhầm lẫn `roles` là group name.

---

## §6 — Module

### `src/system-config/system-config.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemConfig } from './entities/system-config.entity';
import { ConfigAuditLog } from './entities/config-audit-log.entity';
import { SystemConfigService } from './system-config.service';
import { SystemConfigController } from './system-config.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SystemConfig, ConfigAuditLog])],
  controllers: [SystemConfigController],
  providers: [SystemConfigService],
  exports: [SystemConfigService],   // Các module khác (M8 Monitor, M4 DRP) có thể inject để đọc config
})
export class SystemConfigModule {}
```

### Register trong `app.module.ts`

```typescript
// Thêm vào imports array:
import { SystemConfigModule } from './system-config/system-config.module';

@Module({
  imports: [
    // ... existing modules ...
    SystemConfigModule,
  ],
})
export class AppModule {}
```

---

## §7 — Error Codes mới

Thêm vào `src/common/errors.ts`:

```typescript
// Module 10 — System Config
SYSTEM_CONFIG_NOT_FOUND:   { code: 'UNIS-ERR-032', msg: 'Config key not found',                     status: 404 },
SYSTEM_CONFIG_BOUND_ERROR: { code: 'UNIS-ERR-033', msg: 'Config value ngoài giới hạn cho phép',     status: 400 },
TOGGLE_KEY_NOT_FOUND:      { code: 'UNIS-ERR-034', msg: 'Feature toggle key not found',             status: 404 },
```

> Errors UNIS-ERR-032..034 tiếp nối UNIS-ERR-031 của Module 9.

---

## §8 — Frontend API Layer

### `src/lib/api/system-config.ts`

```typescript
const BASE = '/api/v1/system-config';

// ── Types ──────────────────────────────────────────────────────────

export type ConfigGroup = 'PLANNING_CYCLE' | 'PLUGIN_PARAMS' | 'FEATURE_TOGGLE' | 'BRAVO_ADAPTER' | 'MASKING';
export type ValueType = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';

export interface ConfigItem {
  key: string;
  value: string;   // "***" nếu is_sensitive
  type: ValueType;
  isSensitive: boolean;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ConfigGroupResponse {
  group: ConfigGroup;
  configs: ConfigItem[];
}

export interface ToggleItem {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string;
}

export interface RoleItem {
  role: string;
  scope: string;
  permissions: string[];
  masking: string;
}

export interface AuditLogItem {
  id: string;  // Issue-2 fix: BIGSERIAL → string (consistent với toàn project)
  configGroup: string;
  configKey: string;
  oldValue: string | null;
  newValue: string;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

export interface UpdateItem {
  group: ConfigGroup;
  key: string;
  value: string;
  reason?: string;
}

// ── API Functions ──────────────────────────────────────────────────

export async function fetchAllConfigs(group?: ConfigGroup): Promise<ConfigGroupResponse[]> {
  const url = group ? `${BASE}?group=${group}` : BASE;
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchConfigGroup(group: ConfigGroup): Promise<ConfigGroupResponse> {
  const res = await fetch(`${BASE}/${group}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateConfigs(
  updates: UpdateItem[],
  updatedBy: string,
): Promise<{ updated: number; auditIds: string[] }> {
  const res = await fetch(BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates, updatedBy }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchToggles(): Promise<ToggleItem[]> {
  const res = await fetch(`${BASE}/toggles`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateToggle(
  key: string,
  value: string,
  updatedBy: string,
  reason?: string,
): Promise<{ updated: boolean; auditId: string }> {
  const res = await fetch(`${BASE}/toggles/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, updatedBy, reason }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchRoles(): Promise<{ note: string; roles: RoleItem[] }> {
  const res = await fetch(`${BASE}/roles`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function fetchAuditLog(
  page = 1,
  size = 20,
): Promise<{ data: AuditLogItem[]; total: number; page: number; size: number }> {
  const res = await fetch(`${BASE}/audit?page=${page}&size=${size}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

---

## §9 — Frontend Page

### `src/app/policy/page.tsx`

```tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  fetchConfigGroup, fetchToggles, fetchRoles, fetchAuditLog,
  updateConfigs, updateToggle,
  ConfigItem, ToggleItem, RoleItem, AuditLogItem, ConfigGroup,
} from '@/lib/api/system-config';

// ── Tab keys ──────────────────────────────────────────────────────
type Tab = 'planning' | 'plugin' | 'toggles' | 'system';

// ── Phase badge mapping for disabled toggles ──────────────────────
const TOGGLE_PHASE: Record<string, string> = {
  'feature.adjustment_report.enabled': 'Phase 2',
  'feature.co2_tracking.enabled':      'Phase 3',
  'feature.mape_tracking.enabled':     'BLOCKED',
  'feature.email_alerts.enabled':      'Phase 2',
  'feature.zalo_alerts.enabled':       'Phase 2',
  'feature.scheduled_kpi.enabled':     'Phase 2',
  'feature.bravo_sftp_push.enabled':   'Phase 2',
};

// ── Editable config keys per tab ─────────────────────────────────
const PLANNING_EDITABLE = ['planning.cutoff_time', 'planning.horizon_weeks', 'planning.max_stale_minutes', 'planning.force_override_allowed'];
const PLUGIN_EDITABLE   = ['plugin.csl_class_a', 'plugin.csl_class_b', 'plugin.csl_class_c',
                           'plugin.hstk_stockout_threshold', 'plugin.hstk_overstock_threshold',
                           'plugin.po_overdue_days', 'plugin.lcnb_mode', 'plugin.lcnb_factor', 'plugin.horizon_weeks'];
const LCNB_MODES        = ['"OFF"', '"DETECT_ONLY"', '"EXECUTE"'];

export default function PolicyPage() {
  const [tab, setTab] = useState<Tab>('planning');

  // Planning Cycle
  const [planningConfigs, setPlanningConfigs] = useState<ConfigItem[]>([]);
  const [planningEdits, setPlanningEdits]     = useState<Record<string, string>>({});
  const [planningActor, setPlanningActor]     = useState('');

  // Plugin Params
  const [pluginConfigs, setPluginConfigs]   = useState<ConfigItem[]>([]);
  const [pluginEdits, setPluginEdits]       = useState<Record<string, string>>({});
  const [pluginActor, setPluginActor]       = useState('');

  // Toggles
  const [toggles, setToggles]         = useState<ToggleItem[]>([]);
  const [toggleActor, setToggleActor] = useState('');

  // System Info
  const [bravoConfigs, setBravoConfigs] = useState<ConfigItem[]>([]);
  const [roles, setRoles]               = useState<RoleItem[]>([]);
  const [rolesNote, setRolesNote]       = useState('');
  const [auditLogs, setAuditLogs]       = useState<AuditLogItem[]>([]);
  const [auditTotal, setAuditTotal]     = useState(0);
  const [auditPage, setAuditPage]       = useState(1);

  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  // ── Load data on tab change ─────────────────────────────────────
  useEffect(() => {
    setError(null);
    if (tab === 'planning') loadPlanning();
    if (tab === 'plugin')   loadPlugin();
    if (tab === 'toggles')  loadToggles();
    if (tab === 'system')   loadSystem();
  }, [tab]);

  const loadPlanning = async () => {
    const res = await fetchConfigGroup('PLANNING_CYCLE');
    setPlanningConfigs(res.configs);
    setPlanningEdits(Object.fromEntries(res.configs.map(c => [c.key, c.value])));
  };

  const loadPlugin = async () => {
    const res = await fetchConfigGroup('PLUGIN_PARAMS');
    setPluginConfigs(res.configs);
    setPluginEdits(Object.fromEntries(res.configs.map(c => [c.key, c.value])));
  };

  const loadToggles = async () => {
    setToggles(await fetchToggles());
  };

  const loadSystem = useCallback(async () => {
    const [bravoRes, rolesRes, auditRes] = await Promise.all([
      fetchConfigGroup('BRAVO_ADAPTER'),
      fetchRoles(),
      fetchAuditLog(auditPage),
    ]);
    setBravoConfigs(bravoRes.configs);
    setRoles(rolesRes.roles);
    setRolesNote(rolesRes.note);
    setAuditLogs(auditRes.data);
    setAuditTotal(auditRes.total);
  }, [auditPage]);

  // BUG-3 fix: add loadSystem to deps — loadSystem is useCallback([auditPage]),
  // so its reference changes when auditPage changes; React strict mode warns if omitted.
  useEffect(() => {
    if (tab === 'system') loadSystem();
  }, [auditPage, loadSystem]);

  // ── Helpers ─────────────────────────────────────────────────────
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleSaveConfigs = async (
    group: ConfigGroup,
    edits: Record<string, string>,
    editableKeys: string[],
    originalConfigs: ConfigItem[],
    actor: string,
  ) => {
    if (!actor.trim()) { setError('Nhập tên người thay đổi'); return; }
    const updates = editableKeys
      .filter(k => {
        const original = originalConfigs.find(c => c.key === k)?.value;
        return edits[k] !== undefined && edits[k] !== original;
      })
      .map(k => ({ group, key: k, value: edits[k] }));
    if (!updates.length) { showToast('Không có thay đổi'); return; }

    if (!confirm('Bạn đang thay đổi config hệ thống. Tiếp tục?')) return;
    setSaving(true);
    try {
      await updateConfigs(updates, actor);
      showToast('Config updated');
      tab === 'planning' ? loadPlanning() : loadPlugin();
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleChange = async (key: string, newValue: string) => {
    if (!toggleActor.trim()) { setError('Nhập tên người thay đổi'); return; }
    try {
      await updateToggle(key, newValue, toggleActor);
      showToast(`Toggle ${key} updated`);
      loadToggles();
    } catch (e: any) {
      setError(e.message);
    }
  };

  // ── Render ───────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Policy Platform</h1>
      <p className="text-gray-500 text-sm mb-6">System configuration — control plane</p>

      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow z-50">
          {toast}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4">
          {error}
        </div>
      )}

      {/* Tab nav */}
      <div className="flex gap-2 mb-6 border-b">
        {(['planning', 'plugin', 'toggles', 'system'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'planning' ? 'Planning Cycle' : t === 'plugin' ? 'Plugin Params' : t === 'toggles' ? 'Feature Toggles' : 'System Info'}
          </button>
        ))}
      </div>

      {/* ── TAB: Planning Cycle ─────────────────────────────────── */}
      {tab === 'planning' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Planning Cycle</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 border">Key</th>
                <th className="px-3 py-2 border">Value</th>
                <th className="px-3 py-2 border">Description</th>
              </tr>
            </thead>
            <tbody>
              {planningConfigs.map(c => (
                <tr key={c.key} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 border font-mono text-xs">{c.key}</td>
                  <td className="px-3 py-2 border">
                    {PLANNING_EDITABLE.includes(c.key) ? (
                      c.isSensitive ? (
                        <span className="text-gray-400" title="Sensitive — không hiển thị">••••••••</span>
                      ) : (
                        <input
                          className="border rounded px-2 py-1 text-sm w-full"
                          value={planningEdits[c.key] ?? c.value}
                          onChange={e => setPlanningEdits(p => ({ ...p, [c.key]: e.target.value }))}
                        />
                      )
                    ) : (
                      <span className="font-mono text-xs">{c.value}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 border text-gray-500 text-xs">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-4">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Người thay đổi (SC_MANAGER)"
              value={planningActor}
              onChange={e => setPlanningActor(e.target.value)}
            />
            <button
              disabled={saving}
              onClick={() => handleSaveConfigs('PLANNING_CYCLE', planningEdits, PLANNING_EDITABLE, planningConfigs, planningActor)}
              className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: Plugin Params ──────────────────────────────────── */}
      {tab === 'plugin' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Plugin Parameters</h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-3 py-2 border">Key</th>
                <th className="px-3 py-2 border">Value</th>
                <th className="px-3 py-2 border">Description</th>
              </tr>
            </thead>
            <tbody>
              {pluginConfigs.map(c => (
                <tr key={c.key} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 border font-mono text-xs">{c.key}</td>
                  <td className="px-3 py-2 border">
                    {PLUGIN_EDITABLE.includes(c.key) ? (
                      c.key === 'plugin.lcnb_mode' ? (
                        <select
                          className="border rounded px-2 py-1 text-sm"
                          value={pluginEdits[c.key] ?? c.value}
                          onChange={e => setPluginEdits(p => ({ ...p, [c.key]: e.target.value }))}
                        >
                          {LCNB_MODES.map(m => (
                            <option key={m} value={m}>{m.replace(/"/g, '')}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="border rounded px-2 py-1 text-sm w-32"
                          value={pluginEdits[c.key] ?? c.value}
                          onChange={e => setPluginEdits(p => ({ ...p, [c.key]: e.target.value }))}
                        />
                      )
                    ) : (
                      <span className="font-mono text-xs">{c.value}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 border text-gray-500 text-xs">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-4">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Người thay đổi (SC_MANAGER)"
              value={pluginActor}
              onChange={e => setPluginActor(e.target.value)}
            />
            <button
              disabled={saving}
              onClick={() => handleSaveConfigs('PLUGIN_PARAMS', pluginEdits, PLUGIN_EDITABLE, pluginConfigs, pluginActor)}
              className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── TAB: Feature Toggles ────────────────────────────────── */}
      {tab === 'toggles' && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Feature Toggles</h2>
          <div className="mb-3">
            <input
              className="border rounded px-2 py-1 text-sm"
              placeholder="Người thay đổi (SC_MANAGER)"
              value={toggleActor}
              onChange={e => setToggleActor(e.target.value)}
            />
          </div>
          <div className="space-y-3">
            {toggles.map(t => {
              const phase = TOGGLE_PHASE[t.key];
              const isLcnb = t.key === 'feature.lcnb.enabled';
              const isDisabled = !!phase;
              return (
                <div key={t.key} className="flex items-center justify-between border rounded p-3">
                  <div>
                    <span className="font-mono text-sm">{t.key}</span>
                    {phase && (
                      <span className={`ml-2 px-1.5 py-0.5 text-xs rounded ${
                        phase === 'BLOCKED' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {phase}
                      </span>
                    )}
                    <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
                  </div>
                  <div>
                    {isLcnb ? (
                      <select
                        disabled={isDisabled}
                        className="border rounded px-2 py-1 text-sm disabled:opacity-50"
                        value={t.value}
                        onChange={e => handleToggleChange(t.key, e.target.value)}
                      >
                        {LCNB_MODES.map(m => <option key={m} value={m}>{m.replace(/"/g, '')}</option>)}
                      </select>
                    ) : (
                      <button
                        disabled={isDisabled}
                        onClick={() => handleToggleChange(t.key, t.value === 'true' ? 'false' : 'true')}
                        className={`relative inline-flex h-6 w-11 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                          t.value === 'true' ? 'bg-blue-600' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                          t.value === 'true' ? 'translate-x-5' : 'translate-x-0.5'
                        }`} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── TAB: System Info ────────────────────────────────────── */}
      {tab === 'system' && (
        <div className="space-y-8">
          {/* Bravo Adapter */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Bravo ERP Adapter</h2>
            <p className="text-xs text-gray-500 mb-2">Read-only Phase 1</p>
            <table className="w-full text-sm border-collapse">
              <tbody>
                {bravoConfigs.map(c => (
                  <tr key={c.key} className="border-t">
                    <td className="px-3 py-2 border font-mono text-xs w-56">{c.key}</td>
                    <td className="px-3 py-2 border">{c.isSensitive ? <span className="text-gray-400">••••••••</span> : <span className="font-mono text-xs">{c.value}</span>}</td>
                    <td className="px-3 py-2 border text-gray-500 text-xs">{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* RBAC */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <h2 className="text-lg font-semibold">RBAC Role Matrix</h2>
              <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">Static — Phase 1</span>
            </div>
            {rolesNote && <p className="text-xs text-gray-500 mb-2 italic">{rolesNote}</p>}
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 border text-left">Role</th>
                  <th className="px-3 py-2 border text-left">Scope</th>
                  <th className="px-3 py-2 border text-left">Permissions</th>
                  <th className="px-3 py-2 border text-left">Masking</th>
                </tr>
              </thead>
              <tbody>
                {roles.map(r => (
                  <tr key={r.role} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 border font-mono text-sm font-semibold">{r.role}</td>
                    <td className="px-3 py-2 border text-xs">{r.scope}</td>
                    <td className="px-3 py-2 border text-xs">{r.permissions.join(', ')}</td>
                    <td className="px-3 py-2 border text-xs">{r.masking === 'NONE' ? <span className="text-green-600">NONE</span> : <span className="text-orange-600">{r.masking}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Audit Log */}
          <section>
            <h2 className="text-lg font-semibold mb-3">Config Change Audit Log</h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-3 py-2 border text-left">Time</th>
                  <th className="px-3 py-2 border text-left">Key</th>
                  <th className="px-3 py-2 border text-left">Old</th>
                  <th className="px-3 py-2 border text-left">New</th>
                  <th className="px-3 py-2 border text-left">By</th>
                  <th className="px-3 py-2 border text-left">Reason</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-sm">Chưa có thay đổi</td></tr>
                ) : auditLogs.map(a => (
                  <tr key={a.id} className="border-t hover:bg-gray-50">
                    <td className="px-3 py-2 border text-xs">{new Date(a.changedAt).toLocaleString('vi-VN')}</td>
                    <td className="px-3 py-2 border font-mono text-xs">{a.configGroup}/{a.configKey}</td>
                    <td className="px-3 py-2 border text-xs text-gray-500">{a.oldValue ?? '—'}</td>
                    <td className="px-3 py-2 border text-xs font-semibold">{a.newValue}</td>
                    <td className="px-3 py-2 border text-xs">{a.changedBy}</td>
                    <td className="px-3 py-2 border text-xs text-gray-500">{a.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}
            <div className="flex items-center gap-2 mt-3 text-sm">
              <button
                disabled={auditPage <= 1}
                onClick={() => setAuditPage(p => p - 1)}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >Prev</button>
              <span>Page {auditPage} / {Math.max(1, Math.ceil(auditTotal / 20))}</span>
              <button
                disabled={auditPage >= Math.ceil(auditTotal / 20)}
                onClick={() => setAuditPage(p => p + 1)}
                className="px-3 py-1 border rounded disabled:opacity-40"
              >Next</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
```

---

## §10 — Task Checklist

### Backend
```
BE-1  [ ] Tạo thư mục src/system-config/ (KHÔNG phải src/policy/)
BE-2  [ ] Chạy migration 001_create_system_config_tables.sql
BE-3  [ ] Chạy seed 002_seed_unis_defaults.sql (30 rows)
BE-4  [ ] Tạo entities/system-config.entity.ts
BE-5  [ ] Tạo entities/config-audit-log.entity.ts
BE-6  [ ] Tạo dto/index.ts (ListConfigQueryDto, UpdateConfigsDto, UpdateToggleDto, AuditQueryDto)
BE-7  [ ] Tạo system-config.service.ts (getAll, getByGroup, updateConfigs, getToggles, updateToggle, getRoles, getAuditLog)
BE-8  [ ] Tạo system-config.controller.ts (7 endpoints — route order: roles/toggles/audit TRƯỚC :group)
BE-9  [ ] Tạo system-config.module.ts
BE-10 [ ] Register SystemConfigModule trong app.module.ts
BE-11 [ ] Thêm UNIS-ERR-032..034 vào src/common/errors.ts
```

### Frontend
```
FE-1  [ ] Tạo src/lib/api/system-config.ts (types + 7 functions)
FE-2  [ ] Tạo src/app/policy/page.tsx (4 tabs)
FE-3  [ ] Planning Cycle tab — inline edit, actor field, Save button
FE-4  [ ] Plugin Params tab — inline edit + LCNB dropdown
FE-5  [ ] Feature Toggles tab — switches + phase badges (disabled)
FE-6  [ ] System Info tab — Bravo read-only + RBAC static + Audit log paginated
FE-7  [ ] Verify sidebar /policy entry đã có (không cần thêm)
```

### QA
```
QA-1  [ ] GET /system-config/PLANNING_CYCLE → 6 configs, values = UNIS defaults
QA-2  [ ] PATCH plugin.csl_class_a = 1.5 → 400 "CSL phải trong khoảng (0, 1]"
QA-3  [ ] PATCH plugin.hstk_stockout = 4.0 khi overstock = 3.0 → 400 "stockout < overstock"
QA-4  [ ] PATCH plugin.csl_class_a = 0.975 → config_audit_log có row (old/new/changed_by)
QA-5  [ ] GET /system-config → is_sensitive=true fields → "***"
QA-6  [ ] GET /system-config/toggles → feature.lcnb.enabled = "DETECT_ONLY"
QA-7  [ ] PATCH toggles/feature.co2_tracking.enabled value="true" → saved + audit logged
QA-8  [ ] GET /system-config/roles → 4 roles, CN_WH masking = "NM_STOCK | PRICES | OTHER_BRANCHES"
QA-9  [ ] GET /system-config/audit → DESC order, old_value/new_value correct
QA-10 [ ] FE: Phase 2 toggle disabled → không thể click, badge hiển thị đúng phase
QA-11 [ ] Route conflict check: GET /system-config/roles không bị nhầm với GET /:group
QA-12 [ ] Seed idempotent: chạy 002 2 lần → không duplicate rows
```

---

## §11 — Lưu ý quan trọng cho Dev

1. **Route order trong Controller:** `@Get('roles')`, `@Get('toggles')`, `@Get('audit')` phải đặt TRƯỚC `@Get(':group')` — NestJS match theo thứ tự khai báo.

2. **is_sensitive masking:** Logic mask trong `_groupAndMask()` — chỉ ảnh hưởng GET response, KHÔNG ảnh hưởng DB value. PATCH vẫn nhận giá trị thật.

3. **Cross-key validation:** `updateConfigs()` phải load current DB value của key kia khi batch update không bao gồm cả hai key stockout/overstock cùng lúc.

4. **STATIC_ROLES không DB:** `getRoles()` return hardcoded object, không có `await`, không có DB query. Phase 2 sẽ tạo `rbac_role_config` table.

5. **Seed SQL** dùng `ON CONFLICT (config_group, config_key) DO NOTHING` — chạy lại migration không ghi đè giá trị đã thay đổi bởi admin.

6. **`app.module.ts` exports:** `SystemConfigService` được export để Module 8 (Monitor) và Module 4 (DRP) có thể inject và đọc `plugin.hstk_stockout_threshold`, `plugin.csl_class_a`, v.v.

7. **FE route `/policy`:** Giữ nguyên — sidebar đã có. Backend module tên `system-config` nhưng FE page vẫn ở `/policy`.

8. **[BUG-1 fix] `_loadValue(configGroup, configKey)`:** configKey KHÔNG unique toàn table — chỉ unique trong `(config_group, config_key)`. Truyền cả 2 param để tránh lấy nhầm row nếu sau này có 2 group share cùng tên key.

9. **[BUG-3 fix] `useEffect` deps:** `loadSystem` là `useCallback([auditPage])` — reference thay đổi khi `auditPage` thay đổi. Phải đưa `loadSystem` vào deps của `useEffect` để avoid stale closure warning trong React strict mode.

10. **[Issue-2 fix] `id: string` cho cả 2 entities + tất cả return types:** BIGSERIAL TypeORM trả string khi `type: 'bigint'`. Dùng `string` consistent với M1–M9. Không dùng `Number(saved.id)` cast.

---

*Module 10 Full Implementation Guide v2 (post-review fix) — 2026-04-15*
