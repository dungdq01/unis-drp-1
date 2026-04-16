import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AllocationRun } from './entities/allocation-run.entity';
import { AllocationResult } from './entities/allocation-result.entity';
import { AllocationLeg } from './entities/allocation-leg.entity';
import { AllocationRecommendation } from './entities/allocation-recommendation.entity';
import { UNIS_ALLOCATION_CONFIG } from './allocation-config';
import {
  CreateAllocationRunDto, GetResultsQueryDto,
  GetRecommendationsQueryDto, DecideRecommendationDto,
} from './dto';
import { throwUnisError, UNIS_ERR } from '../common/errors';

// ─── Internal types ───────────────────────────────────────────────────────────

interface DemandLine {
  porId: string;
  itemCode: string;
  destLocationCode: string;
  qtyRequired: number;
  weekNumber: number;
  abcClass: 'A' | 'B' | 'C';
}

interface RtmRule {
  sourceLocationCode: string;
  priority: number;
}

interface DecisionLeg {
  sourceType: string;         // 'HUB' | 'NM' | 'CN_REDIST'
  sourceLocationCode: string; // giữ để map source_entity_id sau, Phase 1 = 0
  qty: number;
  priority: number;
}

interface Decision {
  porId: string;
  itemCode: string;
  sourceLocationCode: string; // primary (first) source
  destLocationCode: string;
  qtyRequired: number;
  qtyAllocated: number;
  abcClass: 'A' | 'B' | 'C';
  sourcePriority: number;
  weekNumber: number;
  layerTrace: Record<string, unknown>;
  legs: DecisionLeg[]; // BUG-02: per-source breakdown
}

// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class AllocationService {
  constructor(
    @InjectRepository(AllocationRun)
    private readonly runRepo: Repository<AllocationRun>,
    @InjectRepository(AllocationResult)
    private readonly resultRepo: Repository<AllocationResult>,
    @InjectRepository(AllocationLeg)
    private readonly legRepo: Repository<AllocationLeg>,
    @InjectRepository(AllocationRecommendation)
    private readonly recRepo: Repository<AllocationRecommendation>,
    private readonly dataSource: DataSource,
  ) {}

  // ── POST /allocation/run ──────────────────────────────────────────────────

  async createRun(dto: CreateAllocationRunDto): Promise<AllocationRun> {
    const [planRunRow] = await this.dataSource.query(
      `SELECT id, status FROM plan_run WHERE id = $1::bigint`,
      [dto.planRunId],
    );
    if (!planRunRow) throwUnisError(UNIS_ERR.PLAN_RUN_NOT_FOUND);
    if (planRunRow.status !== 'COMPLETED') throwUnisError(UNIS_ERR.PLAN_RUN_NOT_COMPLETED);

    // Check không có run RUNNING cho plan_run này
    const [running] = await this.dataSource.query(
      `SELECT id FROM allocation_run WHERE plan_run_id = $1::bigint AND status = 'RUNNING' LIMIT 1`,
      [dto.planRunId],
    );
    if (running) throw new ConflictException(`Allocation run #${running.id} đang chạy`);

    const dispatchLimit = dto.dispatchLimitOverride ?? UNIS_ALLOCATION_CONFIG.dispatchLimit;

    const run = this.runRepo.create({
      planRunId: dto.planRunId,
      status: 'RUNNING',
      createdBy: dto.createdBy ?? null,
      configSnapshot: { ...UNIS_ALLOCATION_CONFIG, dispatchLimit },
      startedAt: new Date(),
    });
    const saved = await this.runRepo.save(run);

    this._runEngine(saved.id, dto.planRunId, dispatchLimit).catch(async (err) => {
      console.error(`[AllocationRun ${saved.id}] FAILED:`, err.message);
      await this.runRepo.update(saved.id, {
        status: 'FAILED',
        errorMessage: err.message,
        completedAt: new Date(),
      });
    });

    return saved;
  }

  // ── Core engine ───────────────────────────────────────────────────────────

  private async _runEngine(runId: string, planRunId: string, dispatchLimit: number): Promise<void> {
    const t0 = Date.now();

    // A. Load demand
    const demands = await this._loadDemands(planRunId);
    await this.runRepo.update(runId, { totalDemandLines: demands.length });

    if (demands.length === 0) {
      await this.runRepo.update(runId, {
        status: 'COMPLETED', completedAt: new Date(), durationMs: Date.now() - t0,
        fillRateOverall: 1,
      });
      return;
    }

    // B. Pre-load maps (zero N+1)
    const rtmMap    = await this._loadRtmMap();
    const supplyMap = await this._loadSupplyMap();
    const ssMap     = await this._loadSsMap(demands);
    const dispatchUsage = new Map<string, number>();

    // C. Allocate each demand line (L1→L5)
    const decisions: Decision[] = demands.map((d) =>
      this._allocate(d, rtmMap, supplyMap, ssMap, dispatchUsage, dispatchLimit),
    );

    // D. Bulk insert results
    await this._bulkInsert(runId, decisions);

    // E. L6 LCNB — detect lateral transfer opportunities from partials
    if (UNIS_ALLOCATION_CONFIG.lcnbMode === 'DETECT_ONLY') {
      const partials = decisions.filter((d) => d.qtyAllocated < d.qtyRequired);
      const recs = this._detectLcnb(partials, supplyMap, ssMap);
      if (recs.length > 0) await this._bulkInsertRecommendations(runId, recs);
    }

    // F. Stats
    const totalAllocated = decisions.filter((d) => d.qtyAllocated >= d.qtyRequired).length;
    const totalPartial   = decisions.filter((d) => d.qtyAllocated > 0 && d.qtyAllocated < d.qtyRequired).length;
    const totalUnalloc   = decisions.filter((d) => d.qtyAllocated === 0).length;

    const totReq   = decisions.reduce((s, d) => s + d.qtyRequired, 0);
    const totAlloc = decisions.reduce((s, d) => s + d.qtyAllocated, 0);
    const fillOverall = totReq > 0 ? Math.round((totAlloc / totReq) * 10000) / 10000 : 1;
    const fillByClass = this._fillByClass(decisions);

    const runStatus = totalUnalloc === 0 && totalPartial === 0 ? 'COMPLETED'
      : totalAllocated === 0 && totalPartial === 0 ? 'FAILED'
      : 'PARTIAL';

    await this.runRepo.update(runId, {
      status: runStatus,
      totalAllocated, totalPartial, totalUnallocated: totalUnalloc,
      fillRateOverall: fillOverall,
      fillRateA: fillByClass.A, fillRateB: fillByClass.B, fillRateC: fillByClass.C,
      completedAt: new Date(),
      durationMs: Date.now() - t0,
    });
  }

  // ── L1 → L5 for one demand line ───────────────────────────────────────────

  private _allocate(
    demand: DemandLine,
    rtmMap: Map<string, RtmRule[]>,
    supplyMap: Map<string, { qty: number }>,
    ssMap: Map<string, number>,
    dispatchUsage: Map<string, number>,
    dispatchLimit: number,
  ): Decision {
    const trace: Record<string, unknown> = {};
    let remaining = demand.qtyRequired;
    let totalAllocated = 0;
    let primarySource = '';
    let primaryPriority = 1;

    // L1: RTM source selection
    const rules = (rtmMap.get(demand.destLocationCode) ?? []).sort((a, b) => a.priority - b.priority);
    trace['L1_rules'] = rules.map((r) => `${r.sourceLocationCode}(P${r.priority})`);

    if (rules.length === 0) {
      trace['L1_result'] = 'NO_RTM_RULE';
      trace['final'] = { status: 'UNALLOCATED', reason: 'no RTM rule' };
      return this._unallocated(demand, trace);
    }

    // L2: Quality — supplyMap pre-filtered ALLOCATABLE
    trace['L2_quality'] = 'pre-filtered ALLOCATABLE';

    // L3: FEFO disabled
    trace['L3_fefo'] = 'DISABLED (gạch men không hết hạn)';

    // L4: ABC note (FCFS Phase 1)
    trace['L4_abc'] = `class=${demand.abcClass} mode=FCFS`;

    // Waterfall: accumulate across RTM priorities + L5 SS Guard
    const legs: DecisionLeg[] = []; // BUG-02: track per-source breakdown

    for (const rule of rules) {
      if (remaining <= 0) break;

      const key = `${demand.itemCode}||${rule.sourceLocationCode}`;
      const supply = supplyMap.get(key);

      if (!supply || supply.qty <= 0) {
        trace[`P${rule.priority}_${rule.sourceLocationCode}`] = 'NO_STOCK';
        continue;
      }

      // L5: Safety Stock Guard
      // Skip khi source = dest (Option C self-fulfillment — branch tự cấp cho chính mình,
      // SS guard chỉ áp dụng khi HUB xuất cho nhiều CN khác)
      const isSelfFulfillment = rule.sourceLocationCode === demand.destLocationCode;
      const ss = isSelfFulfillment ? 0 : (ssMap.get(key) ?? 0);
      const available = Math.max(0, supply.qty - ss);
      if (available <= 0) {
        trace[`P${rule.priority}_${rule.sourceLocationCode}`] = `SS_BLOCKED(ss=${ss},stock=${supply.qty})`;
        continue;
      }

      // Dispatch limit — warning only, không block
      const dispatched = dispatchUsage.get(rule.sourceLocationCode) ?? 0;
      if (dispatched >= dispatchLimit) {
        trace[`P${rule.priority}_dispatch_warn`] = `${dispatched}>=${dispatchLimit}`;
      }

      const take = Math.min(remaining, available);
      supply.qty -= take;
      remaining -= take;
      totalAllocated += take;
      dispatchUsage.set(rule.sourceLocationCode, dispatched + take);

      trace[`P${rule.priority}_${rule.sourceLocationCode}`] = `take=${take} ss=${ss} rem=${remaining}`;

      // BUG-02: record leg for this source
      // Phase 1: tất cả đều là HUB vì allocation từ warehouse → branch
      legs.push({ sourceType: 'HUB', sourceLocationCode: rule.sourceLocationCode, qty: take, priority: rule.priority });

      if (!primarySource) {
        primarySource = rule.sourceLocationCode;
        primaryPriority = rule.priority;
      }
    }

    const status = totalAllocated >= demand.qtyRequired ? 'ALLOCATED'
      : totalAllocated > 0 ? 'PARTIAL' : 'UNALLOCATED';
    trace['final'] = { status, totalAllocated, remaining };

    return {
      porId: demand.porId,
      itemCode: demand.itemCode,
      sourceLocationCode: primarySource,
      destLocationCode: demand.destLocationCode,
      qtyRequired: demand.qtyRequired,
      qtyAllocated: totalAllocated,
      abcClass: demand.abcClass,
      sourcePriority: primaryPriority,
      weekNumber: demand.weekNumber,
      layerTrace: trace,
      legs,
    };
  }

  private _unallocated(demand: DemandLine, layerTrace: Record<string, unknown>): Decision {
    return {
      porId: demand.porId, itemCode: demand.itemCode,
      sourceLocationCode: '', destLocationCode: demand.destLocationCode,
      qtyRequired: demand.qtyRequired, qtyAllocated: 0,
      abcClass: demand.abcClass, sourcePriority: 0,
      weekNumber: demand.weekNumber, layerTrace,
      legs: [], // UNALLOCATED — no legs
    };
  }

  // ── L6 LCNB Detect ───────────────────────────────────────────────────────

  private _detectLcnb(
    partials: Decision[],
    supplyMap: Map<string, { qty: number }>,
    ssMap: Map<string, number>,
  ): { fromLocationCode: string; toLocationCode: string; itemCode: string; suggestedQty: number; note: string }[] {
    const recs: { fromLocationCode: string; toLocationCode: string; itemCode: string; suggestedQty: number; note: string }[] = [];

    for (const demand of partials) {
      const shortfall = demand.qtyRequired - demand.qtyAllocated;
      if (shortfall <= 0) continue;

      for (const [key, supply] of supplyMap.entries()) {
        const [kItem, kLoc] = key.split('||');
        if (kItem !== demand.itemCode) continue;
        if (kLoc === demand.destLocationCode) continue;
        if (supply.qty <= 0) continue;

        const ss = ssMap.get(key) ?? 0;
        const surplus = supply.qty - ss;
        if (surplus >= UNIS_ALLOCATION_CONFIG.lcnbSurplusThreshold) {
          recs.push({
            fromLocationCode: kLoc,
            toLocationCode: demand.destLocationCode,
            itemCode: demand.itemCode,
            suggestedQty: Math.min(surplus, shortfall),
            note: `surplus=${surplus.toFixed(0)} ss=${ss}`,
          });
          break; // 1 rec per partial line
        }
      }
    }
    return recs;
  }

  // ── Data loaders ──────────────────────────────────────────────────────────

  private async _loadDemands(planRunId: string): Promise<DemandLine[]> {
    const rows: { id: string; item_code: string; location_code: string; planned_order_qty: string; week_number: number }[] =
      await this.dataSource.query(
        `SELECT id, item_code, location_code, planned_order_qty, week_number
         FROM planned_order_release
         WHERE plan_run_id = $1::bigint
           AND week_number = ANY($2)
           AND planned_order_qty > 0
           AND status IN ('AUTO_RELEASE', 'RELEASED', 'NEEDS_APPROVAL')
         ORDER BY item_code, location_code`,
        [planRunId, UNIS_ALLOCATION_CONFIG.allocateWeekNumbers],
      );

    if (rows.length === 0) return [];

    const itemCodes = [...new Set(rows.map((r) => r.item_code))];
    const abcRows: { item_code: string; abc_class: string }[] = await this.dataSource.query(
      `SELECT DISTINCT ON (item_code) item_code, abc_class
       FROM item_abc_classification
       WHERE item_code = ANY($1)
       ORDER BY item_code, effective_date DESC`,
      [itemCodes],
    );
    const abcMap = new Map(abcRows.map((r) => [r.item_code, r.abc_class as 'A' | 'B' | 'C']));

    return rows.map((r) => ({
      porId: r.id,
      itemCode: r.item_code,
      destLocationCode: r.location_code,
      qtyRequired: parseFloat(r.planned_order_qty),
      weekNumber: r.week_number,
      abcClass: abcMap.get(r.item_code) ?? 'C',
    }));
  }

  private async _loadRtmMap(): Promise<Map<string, RtmRule[]>> {
    const rows: { branch_code: string; warehouse_code: string; priority: number }[] =
      await this.dataSource.query(
        `SELECT branch_code, warehouse_code, priority FROM rtm_rule WHERE is_active = true`,
      );
    const map = new Map<string, RtmRule[]>();
    for (const r of rows) {
      const list = map.get(r.branch_code) ?? [];
      list.push({ sourceLocationCode: r.warehouse_code, priority: r.priority });
      map.set(r.branch_code, list);
    }
    return map;
  }

  private async _loadSupplyMap(): Promise<Map<string, { qty: number }>> {
    const rows: { item_code: string; location_code: string; qty: string }[] =
      await this.dataSource.query(
        `SELECT item_code, location_code,
                GREATEST(0, SUM(on_hand_qty) - SUM(reserved_qty) - SUM(quarantine_qty))::text AS qty
         FROM lot_attribute
         WHERE quality_status = 'ALLOCATABLE'
         GROUP BY item_code, location_code
         HAVING GREATEST(0, SUM(on_hand_qty) - SUM(reserved_qty) - SUM(quarantine_qty)) > 0`,
      );
    const map = new Map<string, { qty: number }>();
    for (const r of rows) {
      map.set(`${r.item_code}||${r.location_code}`, { qty: parseFloat(r.qty) });
    }
    return map;
  }

  private async _loadSsMap(demands: DemandLine[]): Promise<Map<string, number>> {
    const itemCodes = [...new Set(demands.map((d) => d.itemCode))];
    if (itemCodes.length === 0) return new Map();

    // Join safety_stock_target với policy_run ACTIVE để lấy SS hiện tại
    // Lấy policy_run ACTIVE mới nhất (tránh duplicate khi có nhiều ACTIVE runs)
    const rows: { item_code: string; location_code: string; ss_final: string; override_ss: string | null }[] =
      await this.dataSource.query(
        `SELECT DISTINCT ON (sst.item_code, sst.location_code)
                sst.item_code, sst.location_code, sst.ss_final, sst.override_ss
         FROM safety_stock_target sst
         INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
         WHERE pr.status = 'ACTIVE'
           AND sst.item_code = ANY($1)
         ORDER BY sst.item_code, sst.location_code, pr.created_at DESC`,
        [itemCodes],
      );

    const map = new Map<string, number>();
    for (const r of rows) {
      const ss = r.override_ss !== null ? parseFloat(r.override_ss) : parseFloat(r.ss_final);
      map.set(`${r.item_code}||${r.location_code}`, ss);
    }
    return map;
  }

  // ── Bulk insert helpers ───────────────────────────────────────────────────

  private async _bulkInsert(runId: string, decisions: Decision[]): Promise<void> {
    const CHUNK = UNIS_ALLOCATION_CONFIG.insertChunkSize;
    for (let i = 0; i < decisions.length; i += CHUNK) {
      const chunk = decisions.slice(i, i + CHUNK);
      const ph: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      for (const d of chunk) {
        const fillRate = d.qtyRequired > 0 ? Math.round((d.qtyAllocated / d.qtyRequired) * 10000) / 10000 : 0;
        const status = d.qtyAllocated >= d.qtyRequired ? 'ALLOCATED'
          : d.qtyAllocated > 0 ? 'PARTIAL' : 'UNALLOCATED';

        ph.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
        params.push(
          runId, d.porId, d.itemCode,
          d.sourceLocationCode || null, d.destLocationCode, 'LOT_ATTR',
          d.qtyRequired, d.qtyAllocated, fillRate,
          d.abcClass, d.sourcePriority, status,
          JSON.stringify(d.layerTrace), d.weekNumber,
        );
      }

      // BUG-02: RETURNING id so we can insert allocation_leg rows
      const inserted: { id: string }[] = await this.dataSource.query(
        `INSERT INTO allocation_result
           (allocation_run_id, planned_order_id, item_code,
            source_location_code, dest_location_code, lot_number,
            qty_required, qty_allocated, fill_rate,
            abc_class, source_priority, status, layer_trace, week_number)
         VALUES ${ph.join(', ')}
         RETURNING id`,
        params,
      );

      // Insert legs for each result that has multi-source breakdown
      const legRows: { resultId: string; leg: DecisionLeg }[] = [];
      for (let j = 0; j < chunk.length; j++) {
        const resultId = inserted[j].id;
        for (const leg of chunk[j].legs) {
          legRows.push({ resultId, leg });
        }
      }

      if (legRows.length > 0) {
        await this._bulkInsertLegs(legRows);
      }

      // BE1-3b: recompute qty_allocated = SUM(legs) để đảm bảo tính nhất quán
      const resultIds = inserted.map((r) => r.id);
      if (resultIds.length > 0) {
        await this.dataSource.query(
          `UPDATE allocation_result ar
           SET qty_allocated = (
             SELECT COALESCE(SUM(al.allocated_qty), 0)
             FROM allocation_leg al
             WHERE al.allocation_result_id = ar.id
           )
           WHERE ar.id = ANY($1::bigint[])`,
          [resultIds],
        );
      }
    }
  }

  private async _bulkInsertLegs(
    rows: { resultId: string; leg: DecisionLeg }[],
  ): Promise<void> {
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const ph = chunk.map((_, j) => {
        const b = j * 6 + 1;
        return `($${b},$${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`;
      });
      const params = chunk.flatMap(({ resultId, leg }) => [
        resultId,          // $1 allocation_result_id
        leg.sourceType,    // $2 source_type  ('HUB' | 'NM' | 'CN_REDIST')
        0,                 // $3 source_entity_id — Phase 1: always 0
        leg.qty,           // $4 allocated_qty
        null,              // $5 fifo_rank — Phase 1: NULL
        null,              // $6 distance_km — Phase 1: NULL
      ]);
      await this.dataSource.query(
        `INSERT INTO allocation_leg
           (allocation_result_id, source_type, source_entity_id, allocated_qty, fifo_rank, distance_km)
         VALUES ${ph.join(', ')}`,
        params,
      );
    }
  }

  private async _bulkInsertRecommendations(
    runId: string,
    recs: { fromLocationCode: string; toLocationCode: string; itemCode: string; suggestedQty: number; note: string }[],
  ): Promise<void> {
    if (recs.length === 0) return;
    const CHUNK = 200;
    for (let i = 0; i < recs.length; i += CHUNK) {
      const chunk = recs.slice(i, i + CHUNK);
      const ph = chunk.map((_, j) => {
        const b = j * 6 + 1;
        return `($${b},$${b+1},$${b+2},$${b+3},$${b+4},$${b+5})`;
      });
      const params = chunk.flatMap((r) => [
        runId, r.fromLocationCode, r.toLocationCode,
        r.itemCode, r.suggestedQty, r.note,
      ]);
      await this.dataSource.query(
        `INSERT INTO allocation_recommendation
           (allocation_run_id, from_location_code, to_location_code, item_code, suggested_qty, note)
         VALUES ${ph.join(', ')}`,
        params,
      );
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _fillByClass(decisions: Decision[]) {
    const compute = (cls: 'A' | 'B' | 'C') => {
      const s = decisions.filter((d) => d.abcClass === cls);
      if (s.length === 0) return null;
      const req   = s.reduce((a, d) => a + d.qtyRequired, 0);
      const alloc = s.reduce((a, d) => a + d.qtyAllocated, 0);
      return req > 0 ? Math.round((alloc / req) * 10000) / 10000 : 1;
    };
    return { A: compute('A'), B: compute('B'), C: compute('C') };
  }

  // ── GET endpoints ─────────────────────────────────────────────────────────

  async listRuns(page: number, pageSize: number) {
    const [data, total] = await this.runRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getRun(id: string): Promise<AllocationRun> {
    const run = await this.runRepo.findOneBy({ id });
    if (!run) throwUnisError(UNIS_ERR.ALLOCATION_RUN_NOT_FOUND);
    return run;
  }

  async getResults(id: string, query: GetResultsQueryDto) {
    const run = await this.runRepo.findOneBy({ id });
    if (!run) throwUnisError(UNIS_ERR.ALLOCATION_RUN_NOT_FOUND);

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const qb = this.resultRepo.createQueryBuilder('r')
      .where('r.allocation_run_id = :id', { id })
      .orderBy('r.fill_rate', 'ASC')
      .addOrderBy('r.qty_required', 'DESC');

    if (query.status)             qb.andWhere('r.status = :s', { s: query.status });
    if (query.itemCode)           qb.andWhere('r.item_code ILIKE :ic', { ic: `%${query.itemCode}%` });
    if (query.destLocationCode)   qb.andWhere('r.dest_location_code = :dlc', { dlc: query.destLocationCode });
    if (query.sourceLocationCode) qb.andWhere('r.source_location_code = :slc', { slc: query.sourceLocationCode });
    if (query.abcClass)           qb.andWhere('r.abc_class = :abc', { abc: query.abcClass });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    const meta = { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };

    // ?includelegs=true — join legs per result row
    if (query.includeLegs) {
      const resultIds = data.map((r) => r.id);
      const legs: any[] = resultIds.length > 0
        ? await this.dataSource.query(
            `SELECT * FROM allocation_leg WHERE allocation_result_id = ANY($1::bigint[])`,
            [resultIds],
          )
        : [];

      const legMap = new Map<string, any[]>();
      for (const leg of legs) {
        const list = legMap.get(leg.allocation_result_id) ?? [];
        list.push(leg);
        legMap.set(leg.allocation_result_id, list);
      }

      return { data: data.map((r) => ({ ...r, legs: legMap.get(r.id) ?? [] })), meta };
    }

    return { data, meta };
  }

  async getSummary(id: string) {
    const run = await this.getRun(id);
    const byClass: { abc_class: string; total: string; allocated: string; required: string }[] =
      await this.dataSource.query(
        `SELECT abc_class, COUNT(*) AS total,
                SUM(qty_allocated) AS allocated, SUM(qty_required) AS required
         FROM allocation_result
         WHERE allocation_run_id = $1::bigint
         GROUP BY abc_class ORDER BY abc_class`,
        [id],
      );
    const bySource: { source_location_code: string; total_allocated: string; lines: string }[] =
      await this.dataSource.query(
        `SELECT source_location_code, SUM(qty_allocated) AS total_allocated, COUNT(*) AS lines
         FROM allocation_result
         WHERE allocation_run_id = $1::bigint AND source_location_code IS NOT NULL
         GROUP BY source_location_code ORDER BY SUM(qty_allocated) DESC LIMIT 20`,
        [id],
      );
    return {
      run,
      byClass: byClass.map((r) => ({
        abcClass: r.abc_class,
        lines: parseInt(r.total),
        fillRate: parseFloat(r.required) > 0
          ? Math.round((parseFloat(r.allocated) / parseFloat(r.required)) * 10000) / 10000 : 1,
        totalAllocated: parseFloat(r.allocated),
        totalRequired: parseFloat(r.required),
      })),
      bySource: bySource.map((r) => ({
        sourceLocationCode: r.source_location_code,
        totalAllocated: parseFloat(r.total_allocated),
        lines: parseInt(r.lines),
      })),
    };
  }

  async getRecommendations(runId: string, query: GetRecommendationsQueryDto) {
    const run = await this.runRepo.findOneBy({ id: runId });
    if (!run) throwUnisError(UNIS_ERR.ALLOCATION_RUN_NOT_FOUND);

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const qb = this.recRepo.createQueryBuilder('rec')
      .where('rec.allocation_run_id = :runId', { runId })
      .orderBy('rec.suggested_qty', 'DESC');

    if (query.status) qb.andWhere('rec.status = :status', { status: query.status });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async decideRecommendation(recId: string, dto: DecideRecommendationDto) {
    const rec = await this.recRepo.findOneBy({ id: recId });
    if (!rec) throw new NotFoundException(`recommendation ${recId} not found`);
    if (rec.status !== 'PENDING')
      throw new ConflictException(`recommendation ${recId} already decided: ${rec.status}`);

    rec.status = dto.decision;
    rec.decidedBy = dto.decidedBy ?? null;
    rec.decidedAt = new Date();
    rec.note = dto.note ?? null;
    if (dto.adjustedQty !== undefined) rec.suggestedQty = dto.adjustedQty;
    return this.recRepo.save(rec);
  }
}
