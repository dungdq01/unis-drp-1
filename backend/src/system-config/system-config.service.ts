import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';
import { ConfigAuditLog } from './entities/config-audit-log.entity';
import { UpdateConfigsDto, UpdateToggleDto, AuditQueryDto } from './dto';

// ── Validation bounds ─────────────────────────────────────────────────────────

const BOUNDS: Record<string, (v: string) => void> = {
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
      throw new BadRequestException('lcnb mode không hợp lệ — phải là OFF | DETECT_ONLY | EXECUTE');
    }
  },
};

// ── Static RBAC matrix (Phase 1 — not stored in DB) ──────────────────────────

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

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SystemConfigService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(ConfigAuditLog)
    private readonly auditRepo: Repository<ConfigAuditLog>,
  ) {}

  // ── GET all ───────────────────────────────────────────────────────────────

  async getAll(group?: string): Promise<{ group: string; configs: object[] }[]> {
    const qb = this.configRepo.createQueryBuilder('c')
      .orderBy('c.configGroup').addOrderBy('c.configKey');
    if (group) qb.where('c.configGroup = :group', { group });
    const rows = await qb.getMany();
    return this._groupAndMask(rows);
  }

  // ── GET single group ──────────────────────────────────────────────────────

  async getByGroup(group: string): Promise<{ group: string; configs: object[] }> {
    const rows = await this.configRepo.find({
      where: { configGroup: group },
      order: { configKey: 'ASC' },
    });
    const grouped = this._groupAndMask(rows);
    return grouped[0] ?? { group, configs: [] };
  }

  // ── PATCH configs ─────────────────────────────────────────────────────────

  async updateConfigs(dto: UpdateConfigsDto): Promise<{ updated: number; auditIds: string[] }> {
    const updateMap = new Map<string, string>(dto.updates.map(u => [u.key, u.value]));

    for (const item of dto.updates) {
      const boundsCheck = BOUNDS[item.key];
      if (boundsCheck) boundsCheck(item.value);

      // Cross-key validation: stockout must be < overstock
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
        configKey:   item.key,
        oldValue,
        newValue:    item.value,
        changedBy:   dto.updatedBy,
        reason:      item.reason ?? null,
      });
      const saved = await this.auditRepo.save(audit);
      auditIds.push(saved.id);
    }

    return { updated: dto.updates.length, auditIds };
  }

  // ── GET toggles ───────────────────────────────────────────────────────────

  async getToggles(): Promise<object[]> {
    const rows = await this.configRepo.find({
      where: { configGroup: 'FEATURE_TOGGLE' },
      order: { configKey: 'ASC' },
    });
    return rows.map(r => ({
      key:         r.configKey,
      value:       r.configValue,
      description: r.description,
      updatedAt:   r.updatedAt,
    }));
  }

  // ── PATCH single toggle ───────────────────────────────────────────────────

  async updateToggle(key: string, dto: UpdateToggleDto): Promise<{ updated: boolean; auditId: string }> {
    const fullKey = key.startsWith('feature.') ? key : `feature.${key}`;
    const existing = await this.configRepo.findOne({
      where: { configGroup: 'FEATURE_TOGGLE', configKey: fullKey },
    });
    if (!existing) throw new NotFoundException(`Toggle key không tìm thấy: ${fullKey}`);

    const boundsCheck = BOUNDS[fullKey];
    if (boundsCheck) boundsCheck(dto.value);

    const oldValue = existing.configValue;
    existing.configValue = dto.value;
    existing.updatedBy   = dto.updatedBy;
    await this.configRepo.save(existing);

    const audit = this.auditRepo.create({
      configGroup: 'FEATURE_TOGGLE',
      configKey:   fullKey,
      oldValue,
      newValue:    dto.value,
      changedBy:   dto.updatedBy,
      reason:      dto.reason ?? null,
    });
    const saved = await this.auditRepo.save(audit);
    return { updated: true, auditId: saved.id };
  }

  // ── GET roles (static Phase 1 — no DB) ───────────────────────────────────

  getRoles(): object {
    return {
      note: 'Static Phase 1 — not configurable via UI',
      roles: STATIC_ROLES,
    };
  }

  // ── GET audit log ─────────────────────────────────────────────────────────

  async getAuditLog(query: AuditQueryDto): Promise<{ data: object[]; total: number; page: number; size: number }> {
    const page = query.page ?? 1;
    const size = query.size ?? 20;
    const [rows, total] = await this.auditRepo.findAndCount({
      order: { changedAt: 'DESC' },
      skip:  (page - 1) * size,
      take:  size,
    });
    return { data: rows, total, page, size };
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _groupAndMask(rows: SystemConfig[]): { group: string; configs: object[] }[] {
    const map = new Map<string, object[]>();
    for (const r of rows) {
      if (!map.has(r.configGroup)) map.set(r.configGroup, []);
      map.get(r.configGroup)!.push({
        key:         r.configKey,
        value:       r.isSensitive ? '***' : r.configValue,
        type:        r.valueType,
        isSensitive: r.isSensitive,
        description: r.description,
        updatedBy:   r.updatedBy,
        updatedAt:   r.updatedAt,
      });
    }
    return Array.from(map.entries()).map(([group, configs]) => ({ group, configs }));
  }

  // BUG-1 fix: _loadValue requires 2 params (configGroup + configKey)
  private async _loadValue(configGroup: string, configKey: string): Promise<string | null> {
    const row = await this.configRepo.findOne({ where: { configGroup, configKey } });
    return row?.configValue ?? null;
  }
}
