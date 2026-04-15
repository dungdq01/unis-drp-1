import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PolicyRun } from './entities/policy-run.entity';
import { ItemAbcClassification } from './entities/item-abc-classification.entity';
import { SafetyStockTarget } from './entities/safety-stock-target.entity';
import { RtmRule } from './entities/rtm-rule.entity';
import { ItemLocationConfig } from './entities/item-location-config.entity';
import { UNIS_CONFIG, CSL_TARGETS } from './unis-config';
import {
  CreatePolicyRunDto, ImportAbcDto, GetSsTargetsQueryDto,
  OverrideSsDto, CreateRtmRouteDto, ActivatePolicyRunDto, GetAbcQueryDto, GetRtmQueryDto,
} from './dto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SigmaResult { sigma: number; source: 'fc_error' | 'fallback' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function paginate<T>(data: T[], total: number, page: number, pageSize: number) {
  return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PolicyService {
  constructor(
    @InjectRepository(PolicyRun)        private readonly policyRunRepo: Repository<PolicyRun>,
    @InjectRepository(ItemAbcClassification) private readonly abcRepo: Repository<ItemAbcClassification>,
    @InjectRepository(SafetyStockTarget) private readonly sstRepo: Repository<SafetyStockTarget>,
    @InjectRepository(RtmRule)          private readonly rtmRepo: Repository<RtmRule>,
    @InjectRepository(ItemLocationConfig) private readonly ilcRepo: Repository<ItemLocationConfig>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // BE TASK 2 — ABC IMPORT
  // ═══════════════════════════════════════════════════════════════════════════

  /** Pre-compute internal ABC ranking for all items in snapshot (1 query) */
  private async buildAbcRankMap(snapshotId: string): Promise<Map<string, 'A' | 'B' | 'C'>> {
    const rows: { item_code: string; annual_volume: string }[] = await this.dataSource.query(`
      SELECT item_code, SUM(qty_sold_12m_avg)::text AS annual_volume
      FROM demand_forecast_detail
      WHERE snapshot_id = $1
      GROUP BY item_code
      ORDER BY SUM(qty_sold_12m_avg) DESC
    `, [snapshotId]);

    const totalVolume = rows.reduce((s, r) => s + parseFloat(r.annual_volume), 0);
    const map = new Map<string, 'A' | 'B' | 'C'>();
    if (totalVolume === 0) return map;

    let cumulative = 0;
    for (const row of rows) {
      cumulative += parseFloat(row.annual_volume);
      const pct = cumulative / totalVolume;
      map.set(row.item_code, pct <= 0.20 ? 'A' : pct <= 0.50 ? 'B' : 'C');
    }
    return map;
  }

  /** Debug helper — single item internal ABC */
  async calcInternalAbc(itemCode: string, snapshotId: string): Promise<'A' | 'B' | 'C' | null> {
    const rankMap = await this.buildAbcRankMap(snapshotId);
    return rankMap.get(itemCode) ?? null;
  }

  /** Import ABC from demand_snapshot_line.segment → item_abc_classification */
  async importAbcFromSnapshot(dto: ImportAbcDto): Promise<{ imported: number; discrepancies: number }> {
    const { demandSnapshotId } = dto;

    const segments: { item_code: string; segment: string }[] = await this.dataSource.query(`
      SELECT DISTINCT item_code, segment
      FROM demand_snapshot_line
      WHERE snapshot_id = $1 AND segment IS NOT NULL
    `, [demandSnapshotId]);

    if (segments.length === 0) throw new BadRequestException('No segment data found for snapshot');

    const rankMap = await this.buildAbcRankMap(demandSnapshotId);

    let discrepancies = 0;
    await this.dataSource.transaction(async (em) => {
      for (const row of segments) {
        const abcClass = (['A', 'B', 'C'].includes(row.segment) ? row.segment : 'C') as 'A' | 'B' | 'C';
        const internalClass = rankMap.get(row.item_code) ?? null;
        const discrepancy = internalClass !== null && internalClass !== abcClass;
        if (discrepancy) discrepancies++;

        await em.query(`
          INSERT INTO item_abc_classification
            (item_code, abc_class, source, snapshot_id, internal_class, discrepancy_flag, effective_date)
          VALUES ($1, $2, 'FORECAST_TEAM', $3, $4, $5, CURRENT_DATE)
          ON CONFLICT (item_code, snapshot_id)
          DO UPDATE SET
            abc_class = EXCLUDED.abc_class,
            internal_class = EXCLUDED.internal_class,
            discrepancy_flag = EXCLUDED.discrepancy_flag,
            updated_at = NOW()
        `, [row.item_code, abcClass, demandSnapshotId, internalClass, discrepancy]);
      }
    });

    return { imported: segments.length, discrepancies };
  }

  async getAbcClassifications(query: GetAbcQueryDto) {
    const { page = 1, pageSize = 50, snapshotId, abcClass, discrepancyFlag } = query;
    const skip = (page - 1) * pageSize;

    const qb = this.abcRepo.createQueryBuilder('abc');
    if (snapshotId) qb.andWhere('abc.snapshot_id = :snapshotId', { snapshotId });
    if (abcClass) qb.andWhere('abc.abc_class = :abcClass', { abcClass });
    if (discrepancyFlag !== undefined) qb.andWhere('abc.discrepancy_flag = :flag', { flag: discrepancyFlag });

    qb.orderBy('abc.item_code', 'ASC').skip(skip).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, pageSize);
  }

  async getAbcDiscrepancies(snapshotId: string) {
    return this.abcRepo.find({
      where: { snapshotId, discrepancyFlag: true },
      order: { itemCode: 'ASC' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BE TASK 3 — POLICY RUN + SAFETY STOCK
  // ═══════════════════════════════════════════════════════════════════════════

  /** Pre-load ABC map for batch */
  private async loadAbcMap(snapshotId: string): Promise<Map<string, 'A' | 'B' | 'C'>> {
    const rows: { item_code: string; abc_class: string }[] = await this.dataSource.query(`
      SELECT item_code, abc_class FROM item_abc_classification WHERE snapshot_id = $1
    `, [snapshotId]);
    return new Map(rows.map(r => [r.item_code, r.abc_class as 'A' | 'B' | 'C']));
  }

  /** Pre-load lead time config map */
  private async loadLtConfigMap(
    combs: { item_code: string; location_code: string }[],
  ): Promise<Map<string, { lt: number; variability: number }>> {
    if (combs.length === 0) return new Map();
    const keys = combs.map(c => `${c.item_code}||${c.location_code}`);
    const rows: { item_code: string; location_code: string; lead_time_days: number }[] =
      await this.dataSource.query(`
        SELECT item_code, location_code, lead_time_days
        FROM item_location_config
        WHERE (item_code || '||' || location_code) = ANY($1)
      `, [keys]);
    const map = new Map<string, { lt: number; variability: number }>();
    for (const r of rows) {
      map.set(`${r.item_code}||${r.location_code}`, {
        lt: r.lead_time_days,
        variability: UNIS_CONFIG.LT_VARIABILITY_PCT,
      });
    }
    return map;
  }

  /** Pre-load ADU map (item-level) */
  private async loadAduMap(snapshotId: string): Promise<Map<string, number>> {
    const rows: { item_code: string; qty_12m: string }[] = await this.dataSource.query(`
      SELECT item_code, SUM(qty_sold_12m_avg)::text AS qty_12m
      FROM demand_forecast_detail
      WHERE snapshot_id = $1
      GROUP BY item_code
    `, [snapshotId]);
    return new Map(rows.map(r => [r.item_code, parseFloat(r.qty_12m) / 365]));
  }

  /** Pre-load sigma map (fc_error or fallback, branch-level) */
  private async loadSigmaMap(
    snapshotId: string,
    combs: { item_code: string; location_code: string }[],
  ): Promise<Map<string, SigmaResult>> {
    const map = new Map<string, SigmaResult>();
    if (combs.length === 0) return map;

    // Step 1: fc_error from demand_accuracy (T12 + T1 — Phase 1 always fallback, ready for Phase 2)
    const fcErrorMap = new Map<string, number[]>();
    try {
      const fcRows: { fsku: string; error_abs: string }[] = await this.dataSource.query(`
        SELECT fsku, ABS(fc_t12 - actual_t12) AS error_abs
        FROM demand_accuracy
        WHERE actual_t12 IS NOT NULL AND fc_t12 IS NOT NULL AND actual_t12 > 0
        UNION ALL
        SELECT fsku, ABS(fc_t1 - actual_t1)
        FROM demand_accuracy
        WHERE actual_t1 IS NOT NULL AND fc_t1 IS NOT NULL AND actual_t1 > 0
      `);
      for (const r of fcRows) {
        const arr = fcErrorMap.get(r.fsku) ?? [];
        arr.push(parseFloat(r.error_abs));
        fcErrorMap.set(r.fsku, arr);
      }
    } catch { /* demand_accuracy unavailable → all fallback */ }

    // Step 2: fallback qty_sold_3m_avg per item × location
    const itemCodes = [...new Set(combs.map(c => c.item_code))];
    const locationCodes = [...new Set(combs.map(c => c.location_code))];
    const fallbackRows: { item_code: string; location_code: string; qty_3m: string }[] =
      await this.dataSource.query(`
        SELECT item_code, location_code, COALESCE(qty_sold_3m_avg, 0)::text AS qty_3m
        FROM demand_forecast_detail
        WHERE snapshot_id = $1
          AND item_code = ANY($2)
          AND location_code = ANY($3)
      `, [snapshotId, itemCodes, locationCodes]);
    const fallbackMap = new Map<string, number>();
    for (const r of fallbackRows) {
      fallbackMap.set(`${r.item_code}||${r.location_code}`, parseFloat(r.qty_3m));
    }

    // Step 3: build sigma per combination
    for (const { item_code, location_code } of combs) {
      const errors = fcErrorMap.get(item_code) ?? [];
      if (errors.length >= 3) {
        const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
        const variance = errors.reduce((s, v) => s + (v - mean) ** 2, 0) / errors.length;
        map.set(`${item_code}||${location_code}`, { sigma: Math.sqrt(variance), source: 'fc_error' });
      } else {
        const qty3m = fallbackMap.get(`${item_code}||${location_code}`) ?? 0;
        map.set(`${item_code}||${location_code}`, {
          sigma: qty3m * UNIS_CONFIG.SIGMA_FALLBACK_PCT,
          source: 'fallback',
        });
      }
    }
    return map;
  }

  /** Batch calculate all Safety Stocks (~100K combinations) */
  async calculateAllSafetyStocks(policyRunId: string, snapshotId: string): Promise<number> {
    // Get active combinations from LATEST FROZEN snapshot
    const activeCombs: { item_code: string; location_code: string }[] =
      await this.dataSource.query(`
        SELECT DISTINCT ssl.item_code, ssl.location_code
        FROM supply_snapshot_line ssl
        WHERE ssl.snapshot_id = (
          SELECT id FROM supply_snapshot
          WHERE status = 'FROZEN'
          ORDER BY capture_at DESC
          LIMIT 1
        )
        ORDER BY ssl.item_code, ssl.location_code
      `);

    await this.policyRunRepo.update(policyRunId, { totalCombinations: activeCombs.length, combinationsDone: 0 });

    // Pre-load all data in 4 queries (not N+1)
    const [abcMap, ltConfigMap, aduMap, sigmaMap] = await Promise.all([
      this.loadAbcMap(snapshotId),
      this.loadLtConfigMap(activeCombs),
      this.loadAduMap(snapshotId),
      this.loadSigmaMap(snapshotId, activeCombs),
    ]);

    const results: Partial<SafetyStockTarget>[] = [];
    let done = 0;

    const flush = async () => {
      if (results.length === 0) return;
      await this.dataSource.transaction(async (em) => {
        await em.createQueryBuilder()
          .insert().into(SafetyStockTarget)
          .values(results as SafetyStockTarget[])
          .orIgnore()
          .execute();
      });
      results.length = 0;
    };

    for (const { item_code, location_code } of activeCombs) {
      const abcClass = abcMap.get(item_code) ?? 'C';
      const ltCfg    = ltConfigMap.get(`${item_code}||${location_code}`);
      const lt       = ltCfg?.lt ?? 5;
      const ltVar    = ltCfg?.variability ?? UNIS_CONFIG.LT_VARIABILITY_PCT;
      const sigmaLt  = lt * ltVar;
      const adu      = aduMap.get(item_code) ?? 0;
      const sigmaData = sigmaMap.get(`${item_code}||${location_code}`) ?? { sigma: 0, source: 'fallback' as const };

      const zScore    = UNIS_CONFIG.Z_SCORES[abcClass];
      const dosTarget = UNIS_CONFIG.DOS_TARGETS[abcClass];
      const cslTarget = CSL_TARGETS[abcClass];

      const ssFormula = zScore * Math.sqrt(lt * sigmaData.sigma ** 2 + adu ** 2 * sigmaLt ** 2);
      const ssDosCap  = adu * dosTarget;
      const lcnbFlag  = ssFormula > 0 && ssDosCap > 0 && ssFormula > ssDosCap * 1.5;

      let ssFinal = Math.ceil(Math.min(ssFormula, ssDosCap));
      if (adu > 0 && ssFinal < 1) ssFinal = 1;

      results.push({
        itemCode: item_code,
        locationCode: location_code,
        policyRunId,
        abcClass,
        cslTarget,
        zScore,
        leadTimeDays: lt,
        sigmaDemand: Math.round(sigmaData.sigma * 10000) / 10000,
        sigmaLt: Math.round(sigmaLt * 10000) / 10000,
        adu: Math.round(adu * 10000) / 10000,
        ssFormula: Math.round(ssFormula * 100) / 100,
        ssDosCap: Math.round(ssDosCap * 100) / 100,
        ssFinal,
        dosTarget,
        sigmaSource: sigmaData.source,
        lcnbMode: UNIS_CONFIG.LCNB_MODE,
        lcnbFlag,
        snapshotId,
      });

      done++;
      if (results.length >= UNIS_CONFIG.SS_BATCH_SIZE) {
        await flush();
        await this.policyRunRepo.update(policyRunId, { combinationsDone: done });
      }
    }

    await flush();
    await this.policyRunRepo.update(policyRunId, { combinationsDone: done, status: 'DRAFT' });
    return done;
  }

  /** Create policy run and trigger SS calculation (fire-and-forget) */
  async createPolicyRun(dto: CreatePolicyRunDto) {
    const run = this.policyRunRepo.create({
      runName: dto.runName,
      demandSnapshotId: dto.demandSnapshotId,
      createdBy: dto.createdBy ?? null,
      status: 'DRAFT',
    });
    const saved = await this.policyRunRepo.save(run);

    // Trigger async (non-blocking)
    this.calculateAllSafetyStocks(saved.id, dto.demandSnapshotId).catch(err =>
      console.error(`[PolicyRun ${saved.id}] SS calculation failed:`, err.message),
    );

    return { runId: saved.id, status: 'PROCESSING', totalCombinations: 0 };
  }

  async listPolicyRuns() {
    return this.policyRunRepo.find({ order: { createdAt: 'DESC' }, take: 20 });
  }

  async getPolicyRun(id: string) {
    const run = await this.policyRunRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`Policy run ${id} not found`);
    return run;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BE TASK 4 — ACTIVATE POLICY RUN
  // ═══════════════════════════════════════════════════════════════════════════

  async activatePolicyRun(id: string, dto: ActivatePolicyRunDto) {
    const run = await this.getPolicyRun(id);
    if (run.status !== 'DRAFT') throw new BadRequestException(`Run ${id} is not DRAFT (current: ${run.status})`);

    // Archive current ACTIVE run (if any)
    await this.policyRunRepo
      .createQueryBuilder()
      .update()
      .set({ status: 'ARCHIVED' })
      .where('status = :status', { status: 'ACTIVE' })
      .execute();

    // Activate this run
    run.status = 'ACTIVE';
    run.activatedBy = dto.activatedBy ?? null;
    run.activatedAt = new Date();
    return this.policyRunRepo.save(run);
  }

  async archivePolicyRun(id: string) {
    const run = await this.getPolicyRun(id);
    run.status = 'ARCHIVED';
    return this.policyRunRepo.save(run);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BE TASK 5 — SS TARGETS READ
  // ═══════════════════════════════════════════════════════════════════════════

  async getSsTargets(query: GetSsTargetsQueryDto) {
    const { page = 1, pageSize = 50, policyRunId, itemCode, locationCode, abcClass, lcnbFlag } = query;
    const skip = (page - 1) * pageSize;

    const qb = this.sstRepo.createQueryBuilder('sst');

    if (policyRunId) {
      qb.andWhere('sst.policy_run_id = :policyRunId', { policyRunId });
    } else {
      // Default: ACTIVE policy run — use subquery to avoid TypeORM cross-join issue
      qb.andWhere(`sst.policy_run_id = (
        SELECT id FROM policy_run WHERE status = 'ACTIVE' LIMIT 1
      )`);
    }
    if (itemCode) qb.andWhere('sst.item_code ILIKE :itemCode', { itemCode: `%${itemCode}%` });
    if (locationCode) qb.andWhere('sst.location_code ILIKE :locationCode', { locationCode: `%${locationCode}%` });
    if (abcClass) qb.andWhere('sst.abc_class = :abcClass', { abcClass });
    if (lcnbFlag !== undefined) qb.andWhere('sst.lcnb_flag = :lcnbFlag', { lcnbFlag });

    qb.orderBy('sst.item_code', 'ASC').addOrderBy('sst.location_code', 'ASC').skip(skip).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, page, pageSize);
  }

  async getSsTarget(itemCode: string, locationCode: string) {
    const row = await this.dataSource.query(`
      SELECT sst.*, pr.run_name, pr.status AS run_status
      FROM safety_stock_target sst
      INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
      WHERE pr.status = 'ACTIVE'
        AND sst.item_code = $1
        AND sst.location_code = $2
      LIMIT 1
    `, [itemCode, locationCode]);

    if (!row[0]) throw new NotFoundException(`No SS target for ${itemCode} @ ${locationCode}`);

    const r = row[0];
    const effectiveSs = r.override_ss ?? r.ss_final;
    const calculationSteps = [
      `ABC class: ${r.abc_class} → z-score: ${r.z_score}, CSL: ${(parseFloat(r.csl_target) * 100).toFixed(1)}%`,
      `Lead time: ${r.lead_time_days} days, LT variability: ${(parseFloat(r.sigma_lt) / r.lead_time_days * 100).toFixed(0)}%`,
      `ADU (avg daily usage): ${parseFloat(r.adu).toFixed(4)}`,
      `σ_demand (${r.sigma_source}): ${parseFloat(r.sigma_demand).toFixed(4)}`,
      `σ_LT = LT × variability = ${parseFloat(r.sigma_lt).toFixed(4)}`,
      `SS_formula = ${r.z_score} × √(${r.lead_time_days} × ${parseFloat(r.sigma_demand).toFixed(2)}² + ${parseFloat(r.adu).toFixed(2)}² × ${parseFloat(r.sigma_lt).toFixed(2)}²) = ${parseFloat(r.ss_formula).toFixed(2)}`,
      `DOS cap = ADU × ${r.dos_target}d = ${parseFloat(r.adu).toFixed(4)} × ${r.dos_target} = ${parseFloat(r.ss_dos_cap).toFixed(2)}`,
      `SS = min(${parseFloat(r.ss_formula).toFixed(2)}, ${parseFloat(r.ss_dos_cap).toFixed(2)}) → ceil → ${r.ss_final}`,
      r.override_ss !== null ? `⚠️ Override applied: ${r.override_ss} (reason: ${r.override_reason}) by ${r.override_by}` : null,
      `Effective SS: ${effectiveSs}`,
    ].filter(Boolean);

    return { ...r, effectiveSs, calculationSteps };
  }

  async getSsSummary() {
    const [byClass, lcnbCount, totalCount] = await Promise.all([
      this.dataSource.query(`
        SELECT sst.abc_class, AVG(sst.ss_final)::numeric(10,2) AS avg_ss, COUNT(*) AS cnt
        FROM safety_stock_target sst
        INNER JOIN policy_run pr ON pr.id = sst.policy_run_id AND pr.status = 'ACTIVE'
        GROUP BY sst.abc_class
        ORDER BY sst.abc_class
      `),
      this.dataSource.query(`
        SELECT COUNT(*) AS cnt
        FROM safety_stock_target sst
        INNER JOIN policy_run pr ON pr.id = sst.policy_run_id AND pr.status = 'ACTIVE'
        WHERE sst.lcnb_flag = TRUE
      `),
      this.dataSource.query(`
        SELECT COUNT(*) AS cnt
        FROM safety_stock_target sst
        INNER JOIN policy_run pr ON pr.id = sst.policy_run_id AND pr.status = 'ACTIVE'
      `),
    ]);

    const avgSsByClass: Record<string, number> = {};
    for (const r of byClass) avgSsByClass[r.abc_class] = parseFloat(r.avg_ss);

    return {
      avgSsByClass,
      lcnbFlaggedCount: parseInt(lcnbCount[0]?.cnt ?? '0'),
      totalCombinations: parseInt(totalCount[0]?.cnt ?? '0'),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BE TASK 6 — SS OVERRIDE
  // ═══════════════════════════════════════════════════════════════════════════

  async overrideSsTarget(itemCode: string, locationCode: string, dto: OverrideSsDto) {
    // Find in ACTIVE or DRAFT run
    const row: { id: string; policy_run_id: string; run_status: string }[] = await this.dataSource.query(`
      SELECT sst.id, sst.policy_run_id, pr.status AS run_status
      FROM safety_stock_target sst
      INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
      WHERE pr.status IN ('ACTIVE', 'DRAFT')
        AND sst.item_code = $1
        AND sst.location_code = $2
      ORDER BY pr.status DESC  -- ACTIVE first
      LIMIT 1
    `, [itemCode, locationCode]);

    if (!row[0]) throw new NotFoundException(`No editable SS target for ${itemCode} @ ${locationCode}`);

    await this.sstRepo.update(row[0].id, {
      overrideSs: dto.overrideSs,
      overrideReason: dto.reason,
      overrideBy: dto.userId ?? null,
      overrideAt: new Date(),
    });

    return this.sstRepo.findOne({ where: { id: row[0].id } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BE TASK 7 — RTM ROUTES
  // ═══════════════════════════════════════════════════════════════════════════

  async getRtmRoutes(query: GetRtmQueryDto) {
    const qb = this.rtmRepo.createQueryBuilder('r');
    if (query.branchCode) qb.andWhere('r.branch_code = :bc', { bc: query.branchCode });
    if (query.warehouseCode) qb.andWhere('r.warehouse_code = :wc', { wc: query.warehouseCode });
    if (query.priority) qb.andWhere('r.priority = :p', { p: query.priority });
    if (query.isActive !== undefined) qb.andWhere('r.is_active = :ia', { ia: query.isActive });
    qb.orderBy('r.branch_code', 'ASC').addOrderBy('r.priority', 'ASC');
    return qb.getMany();
  }

  async createRtmRoute(dto: CreateRtmRouteDto) {
    const rule = this.rtmRepo.create({
      branchCode: dto.branchCode,
      warehouseCode: dto.warehouseCode,
      priority: dto.priority,
      transportDays: dto.transportDays ?? 3,
      transportCost: dto.transportCost ?? null,
      minOrderQty: dto.minOrderQty ?? null,
      isActive: true,
    });
    return this.rtmRepo.save(rule);
  }

  async deactivateRtmRoute(id: string) {
    const rule = await this.rtmRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException(`RTM rule ${id} not found`);
    rule.isActive = false;
    return this.rtmRepo.save(rule);
  }

  async resolveRtm(itemCode: string, branchCode: string) {
    // Get ABC class from item_abc_classification (ACTIVE policy run's snapshot)
    // ABC is item-level, not location-level — do NOT lookup via safety_stock_target
    const abcRow: { abc_class: string }[] = await this.dataSource.query(`
      SELECT iac.abc_class
      FROM item_abc_classification iac
      INNER JOIN policy_run pr ON pr.demand_snapshot_id = iac.snapshot_id
      WHERE pr.status = 'ACTIVE'
        AND iac.item_code = $1
      LIMIT 1
    `, [itemCode]);

    const abcClass = (abcRow[0]?.abc_class ?? 'C') as 'A' | 'B' | 'C';

    // C-class = manual routing
    if (abcClass === 'C') return { abcClass, routes: [], note: 'C-class: manual routing' };

    const maxPriority = abcClass === 'A' ? 3 : 1;

    const routes = await this.rtmRepo.find({
      where: { branchCode, isActive: true },
      order: { priority: 'ASC' },
    });

    return {
      abcClass,
      routes: routes
        .filter(r => r.priority <= maxPriority)
        .map(r => ({ warehouseCode: r.warehouseCode, priority: r.priority, transportDays: r.transportDays })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MODULE 4 INTERFACE — getSsFinal()
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * DRP Module 4 uses this to get effective SS for netting.
   * Returns COALESCE(override_ss, ss_final) from ACTIVE policy run.
   * Returns 0 if no record (new item / no active policy).
   */
  async getSsFinal(itemCode: string, locationCode: string): Promise<number> {
    const row: { ss_final: number; override_ss: number | null }[] = await this.dataSource.query(`
      SELECT sst.ss_final, sst.override_ss
      FROM safety_stock_target sst
      INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
      WHERE pr.status = 'ACTIVE'
        AND sst.item_code = $1
        AND sst.location_code = $2
      LIMIT 1
    `, [itemCode, locationCode]);

    if (!row[0]) return 0;
    return row[0].override_ss ?? row[0].ss_final;
  }
}
