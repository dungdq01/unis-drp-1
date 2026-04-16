import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SystemConfig } from './entities/system-config.entity';
import { ConfigAuditLog } from './entities/config-audit-log.entity';
import { UpdateConfigsDto, UpdateToggleDto, AuditQueryDto } from './dto';

// ── Helpers ───────────────────────────────────────────────────────────────────

const pct = (key: string) => (v: string) => {
  const n = Number(v);
  if (isNaN(n) || n < 0 || n > 100) throw new BadRequestException(`${key} phải trong [0, 100]`);
};
const intRange = (key: string, min: number, max: number) => (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new BadRequestException(`${key} phải là số nguyên trong [${min}, ${max}]`);
};
const numRange = (key: string, min: number, max: number) => (v: string) => {
  const n = Number(v);
  if (isNaN(n) || n < min || n > max)
    throw new BadRequestException(`${key} phải trong [${min}, ${max}]`);
};

// ── Validation bounds ─────────────────────────────────────────────────────────

const BOUNDS: Record<string, (v: string) => void> = {
  // ── Phase 1 (existing) ────────────────────────────────────────────────────
  'plugin.csl_class_a': numRange('csl_class_a', 0, 1),
  'plugin.csl_class_b': numRange('csl_class_b', 0, 1),
  'plugin.csl_class_c': numRange('csl_class_c', 0, 1),
  'plugin.lcnb_factor': numRange('lcnb_factor', 0, 1),
  'plugin.horizon_weeks': intRange('horizon_weeks', 1, 52),
  'plugin.po_overdue_days': intRange('po_overdue_days', 1, 365),
  'feature.lcnb.enabled': (v) => {
    const raw = v.replace(/^"|"$/g, '');
    if (!['OFF', 'DETECT_ONLY', 'EXECUTE'].includes(raw))
      throw new BadRequestException('lcnb mode không hợp lệ — phải là OFF | DETECT_ONLY | EXECUTE');
  },

  // ── M10 PLANNING ──────────────────────────────────────────────────────────
  'planning.max_stale_minutes': intRange('planning.max_stale_minutes', 1, 1440),
  'planning.force_override_allowed': (v) => {
    if (!['true', 'false'].includes(v)) throw new BadRequestException('force_override_allowed phải là true hoặc false');
  },

  // ── M10 LCNB ─────────────────────────────────────────────────────────────
  'lcnb.enabled': (v) => {
    const raw = v.replace(/^"|"$/g, '');
    if (!['OFF', 'DETECT_ONLY', 'EXECUTE'].includes(raw))
      throw new BadRequestException('lcnb.enabled phải là OFF | DETECT_ONLY | EXECUTE');
  },
  'lcnb.max_distance_km':      numRange('lcnb.max_distance_km', 50, 2000),
  'lcnb.min_excess_threshold': numRange('lcnb.min_excess_threshold', 1, 10000),
  'lcnb.max_transfer_pct':     pct('lcnb.max_transfer_pct'),
  'lcnb.ss_reduction_pct':     pct('lcnb.ss_reduction_pct'),
  'lcnb.fifo_enabled': (v) => {
    if (!['true', 'false'].includes(v)) throw new BadRequestException('lcnb.fifo_enabled phải là true hoặc false');
  },

  // ── M10 TRUST SCORE ───────────────────────────────────────────────────────
  'trust.window_weeks':                 intRange('trust.window_weeks', 1, 52),
  'trust.accuracy_threshold_pct':       pct('trust.accuracy_threshold_pct'),
  'trust.auto_approve_threshold_pct':   pct('trust.auto_approve_threshold_pct'),
  'trust.reduce_tolerance_threshold_pct': pct('trust.reduce_tolerance_threshold_pct'),

  // ── M10 CN ADJUSTMENT ─────────────────────────────────────────────────────
  'cn_adjust.tolerance_pct': pct('cn_adjust.tolerance_pct'),
  'cn_adjust.cutoff_time': (v) => {
    const raw = v.replace(/^"|"$/g, '');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw))
      throw new BadRequestException('cn_adjust.cutoff_time phải đúng định dạng HH:MM (24h)');
  },
  'cn_adjust.reason_codes': (v) => {
    try {
      const arr = JSON.parse(v);
      if (!Array.isArray(arr) || arr.some((x) => typeof x !== 'string'))
        throw new Error();
    } catch {
      throw new BadRequestException('cn_adjust.reason_codes phải là JSON array of strings');
    }
  },

  // ── M10 TRANSPORT ─────────────────────────────────────────────────────────
  'transport.min_fill_ratio':  numRange('transport.min_fill_ratio', 0, 1),
  'transport.hold_max_days':   intRange('transport.hold_max_days', 0, 14),
  'transport.hold_buffer_days': intRange('transport.hold_buffer_days', 0, 7),

  // ── M10 FC COMMITMENT (với cross-field — handled in service) ──────────────
  'commit.hard_tolerance_pct':   pct('commit.hard_tolerance_pct'),
  'commit.firm_tolerance_pct':   pct('commit.firm_tolerance_pct'),
  'commit.soft_tolerance_pct':   pct('commit.soft_tolerance_pct'),
  'commit.gap_alert_day':        intRange('commit.gap_alert_day', 1, 28),
  'commit.gap_alert_pct':        pct('commit.gap_alert_pct'),
  'commit.gap_escalate_day':     intRange('commit.gap_escalate_day', 1, 31),
  'commit.gap_escalate_pct':     pct('commit.gap_escalate_pct'),

  // ── M10 B2B PIPELINE ──────────────────────────────────────────────────────
  'b2b.stage_prob': (v) => {
    let obj: Record<string, number>;
    try { obj = JSON.parse(v); } catch {
      throw new BadRequestException('b2b.stage_prob phải là JSON object');
    }
    const required = ['Lead', 'Qualified', 'Proposal', 'Committed', 'Confirmed', 'Lost'];
    for (const k of required) {
      if (!(k in obj)) throw new BadRequestException(`b2b.stage_prob thiếu key: ${k}`);
      const n = Number(obj[k]);
      if (isNaN(n) || n < 0 || n > 100)
        throw new BadRequestException(`b2b.stage_prob.${k} phải trong [0, 100]`);
    }
    if (obj['Confirmed'] !== 100) throw new BadRequestException('b2b.stage_prob.Confirmed phải = 100');
    if (obj['Lost'] !== 0) throw new BadRequestException('b2b.stage_prob.Lost phải = 0');
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

interface FlagCacheEntry { enabled: boolean; expiresAt: number }
const FLAG_TTL_MS = 30_000;

@Injectable()
export class SystemConfigService {
  /** Instance-level cache — each service instance has its own (test-isolation safe). */
  private readonly flagCache = new Map<string, FlagCacheEntry>();

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
    @InjectRepository(ConfigAuditLog)
    private readonly auditRepo: Repository<ConfigAuditLog>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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

      // ── Cross-field: stockout < overstock ────────────────────────────────
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

      // ── Cross-field M10: commit.hard < firm < soft ────────────────────────
      const getCommit = async (key: string) =>
        Number(updateMap.get(key) ?? (await this._loadValue('FC_COMMIT', key)) ?? '0');

      if (['commit.hard_tolerance_pct', 'commit.firm_tolerance_pct', 'commit.soft_tolerance_pct'].includes(item.key)) {
        const hard = await getCommit('commit.hard_tolerance_pct');
        const firm = await getCommit('commit.firm_tolerance_pct');
        const soft = await getCommit('commit.soft_tolerance_pct');
        if (hard >= firm) throw new BadRequestException('commit.hard_tolerance_pct phải < firm_tolerance_pct');
        if (firm >= soft) throw new BadRequestException('commit.firm_tolerance_pct phải < soft_tolerance_pct');
      }

      // ── Cross-field M10: gap_alert_day < gap_escalate_day ────────────────
      if (['commit.gap_alert_day', 'commit.gap_escalate_day'].includes(item.key)) {
        const alertDay = Number(updateMap.get('commit.gap_alert_day') ?? (await this._loadValue('FC_COMMIT', 'commit.gap_alert_day')) ?? '0');
        const escalateDay = Number(updateMap.get('commit.gap_escalate_day') ?? (await this._loadValue('FC_COMMIT', 'commit.gap_escalate_day')) ?? '0');
        if (alertDay >= escalateDay) throw new BadRequestException('commit.gap_alert_day phải < gap_escalate_day');
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

  // ── Get single config value ───────────────────────────────────────────────

  async getValue(key: string): Promise<string | null> {
    const rows = await this.dataSource.query<{ config_value: string }[]>(
      `SELECT config_value FROM system_config WHERE config_key = $1 LIMIT 1`,
      [key],
    );
    return rows[0]?.config_value ?? null;
  }

  // ── Feature flag: isEnabled (TTL 30s cache) ───────────────────────────────

  async isEnabled(flagKey: string): Promise<boolean> {
    const cached = this.flagCache.get(flagKey);
    if (cached && cached.expiresAt > Date.now()) return cached.enabled;

    const row = await this.dataSource.query<{ enabled: boolean }[]>(
      `SELECT enabled FROM feature_flag WHERE flag_name = $1 LIMIT 1`,
      [flagKey],
    );
    const enabled = row.length > 0 ? row[0].enabled : (process.env[`FF_${flagKey.toUpperCase()}`] === 'true');
    this.flagCache.set(flagKey, { enabled, expiresAt: Date.now() + FLAG_TTL_MS });
    return enabled;
  }

  // ── Feature flag: listFlags ───────────────────────────────────────────────

  async listFlags(): Promise<{ flagName: string; enabled: boolean; description: string; updatedAt: Date }[]> {
    const rows = await this.dataSource.query<{ flag_name: string; enabled: boolean; description: string; updated_at: Date }[]>(
      `SELECT flag_name, enabled, description, updated_at FROM feature_flag ORDER BY flag_name ASC`,
    );
    return rows.map(r => ({
      flagName:    r.flag_name,
      enabled:     r.enabled,
      description: r.description,
      updatedAt:   r.updated_at,
    }));
  }

  // ── Feature flag: updateFlag ──────────────────────────────────────────────

  async updateFlag(flagKey: string, enabled: boolean, updatedBy: string): Promise<{ flagName: string; enabled: boolean }> {
    const result = await this.dataSource.query<{ flag_name: string }[]>(
      `UPDATE feature_flag SET enabled = $1, updated_at = NOW(), updated_by = $2
       WHERE flag_name = $3 RETURNING flag_name`,
      [enabled, updatedBy, flagKey],
    );
    if (result.length === 0) throw new NotFoundException(`Feature flag không tìm thấy: ${flagKey}`);

    // Invalidate cache
    this.flagCache.delete(flagKey);

    // Audit entry in config_audit_log
    const audit = this.auditRepo.create({
      configGroup: 'FEATURE_FLAG',
      configKey:   flagKey,
      oldValue:    String(!enabled),
      newValue:    String(enabled),
      changedBy:   updatedBy,
      reason:      `Feature flag toggled via API`,
    });
    await this.auditRepo.save(audit);

    return { flagName: flagKey, enabled };
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
