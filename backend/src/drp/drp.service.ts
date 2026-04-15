import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, ObjectLiteral } from 'typeorm';
import { PlanRun } from './entities/plan-run.entity';
import { PlannedOrderRelease } from './entities/planned-order-release.entity';
import { DrpException } from './entities/drp-exception.entity';
import { DRP_CONFIG } from './drp-config';
import {
  CreateDrpRunDto, GetPlannedOrdersQueryDto, GetExceptionsQueryDto,
  ResolveExceptionDto, ApprovePlannedOrderDto, CancelPlannedOrderDto,
} from './dto';

// ─────────────────────────────────────────────────────────────────────────────
// BE-6a: Pure helper functions (no DB, fully testable in isolation)
// ─────────────────────────────────────────────────────────────────────────────

/** Count ISO weeks (Mondays) in a month — used to split monthly GR into weekly */
function countWeeksInMonth(periodStart: Date): number {
  const year  = periodStart.getFullYear();
  const month = periodStart.getMonth();
  const days  = new Date(year, month + 1, 0).getDate();
  return Math.round(days / 7); // 4 or 5
}

/** Week start date for week w (1-indexed from horizonStart) */
function getWeekStartDate(horizonStart: Date, weekNumber: number): Date {
  const d = new Date(horizonStart);
  d.setDate(d.getDate() + (weekNumber - 1) * 7);
  return d;
}

/** Build Map<weekNumber, weeklyGR> from monthly demand rows for one combo */
function buildWeeklyDemandMap(
  monthlyRows: { period_start: Date; qty: number }[],
  horizonStart: Date,
  horizonWeeks: number,
): Map<number, number> {
  const map = new Map<number, number>();

  for (let w = 1; w <= horizonWeeks; w++) {
    const weekStart = getWeekStartDate(horizonStart, w);

    const match = monthlyRows.find(r => {
      const ps = new Date(r.period_start);
      return weekStart.getMonth() === ps.getMonth() &&
             weekStart.getFullYear() === ps.getFullYear();
    });

    if (!match) { map.set(w, 0); continue; }
    const weeks = countWeeksInMonth(new Date(match.period_start));
    map.set(w, match.qty / weeks);
  }

  return map;
}

interface NettingInput {
  itemCode: string;
  locationCode: string;
  beginningInventory: number;
  scheduledReceipts: Map<number, number>;
  weeklyDemand: Map<number, number>;
  safetyStock: number;
  isEstimated: boolean;
}

interface WeekResult {
  week: number;
  weekStartDate: Date;
  gr: number;
  sr: number;
  pabBefore: number;
  nr: number;
  po: number;
  pabAfter: number;
  hstk: number | null;
  frozenZone: boolean;
  status: 'AUTO_RELEASE' | 'NEEDS_APPROVAL';
}

interface NettingException {
  type: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  week: number;
  message: string;
  detail: Record<string, unknown>;
}

/** Core DRP netting for 1 item × 1 location — pure, no side effects */
function runNetting(
  input: NettingInput,
  horizonStart: Date,
): { weeks: WeekResult[]; exceptions: NettingException[] } {
  const { HORIZON_WEEKS, FROZEN_ZONE, HSTK_STOCKOUT_THRESHOLD, HSTK_OVERSTOCK_THRESHOLD } = DRP_CONFIG;
  const weeks: WeekResult[] = [];
  const exceptions: NettingException[] = [];
  let pabPrev = input.beginningInventory;

  for (let w = 1; w <= HORIZON_WEEKS; w++) {
    const gr = input.weeklyDemand.get(w) ?? 0;
    const sr = input.scheduledReceipts.get(w) ?? 0;

    // 1. PAB before planned order
    const pabRaw = pabPrev + sr - gr;

    // 2. Net requirement & planned order (L4L)
    let nr = 0;
    let po = 0;
    let pabAfter = pabRaw;

    if (pabRaw < input.safetyStock) {
      nr = input.safetyStock - pabRaw;
      po = nr;
      pabAfter = pabRaw + po; // = safetyStock (L4L invariant)
    }

    // 3. PAB_NEGATIVE exception (before PO)
    if (pabRaw < 0) {
      exceptions.push({
        type: 'PAB_NEGATIVE',
        severity: 'HIGH',
        week: w,
        message: `PAB âm tại tuần ${w}: ${pabRaw.toFixed(0)} units (trước khi đặt hàng)`,
        detail: { pabBefore: pabRaw, gr, sr, pabAfter, safetyStock: input.safetyStock },
      });
    }

    // 4. HSTK alerts — ONLY when gr > 0 (hstk is meaningless when no demand)
    let hstk: number | null = null;
    if (gr > 0) {
      hstk = pabAfter / gr;
      if (hstk < HSTK_STOCKOUT_THRESHOLD) {
        exceptions.push({
          type: 'STOCKOUT_ALERT',
          severity: 'HIGH',
          week: w,
          message: `HSTK = ${hstk.toFixed(1)} tuần (< ${HSTK_STOCKOUT_THRESHOLD} ngưỡng stockout)`,
          detail: { hstk, pabAfter, weeklyDemand: gr },
        });
      } else if (hstk > HSTK_OVERSTOCK_THRESHOLD) {
        exceptions.push({
          type: 'OVERSTOCK_ALERT',
          severity: 'LOW',
          week: w,
          message: `HSTK = ${hstk.toFixed(1)} tuần (> ${HSTK_OVERSTOCK_THRESHOLD} ngưỡng overstock)`,
          detail: { hstk, pabAfter, weeklyDemand: gr },
        });
      }
    }

    // 5. Frozen zone
    const frozenZone = w <= FROZEN_ZONE;
    const status: WeekResult['status'] = (frozenZone && po > 0) ? 'NEEDS_APPROVAL' : 'AUTO_RELEASE';

    if (frozenZone && po > 0) {
      exceptions.push({
        type: 'FROZEN_ZONE_VIOLATION',
        severity: 'MEDIUM',
        week: w,
        message: `Planned order tuần ${w} trong frozen zone — cần planner duyệt`,
        detail: { po, nr, weekNumber: w },
      });
    }

    weeks.push({
      week: w,
      weekStartDate: getWeekStartDate(horizonStart, w),
      gr, sr, pabBefore: pabRaw, nr, po, pabAfter,
      hstk,
      frozenZone,
      status,
    });

    pabPrev = pabAfter;
  }

  return { weeks, exceptions };
}

// ─────────────────────────────────────────────────────────────────────────────
// BE-6b: Pre-load helpers (bulk queries — no N+1)
// ─────────────────────────────────────────────────────────────────────────────

async function loadInventoryMap(
  supplySnapshotId: number,
  dataSource: DataSource,
): Promise<Map<string, { qty: number; isEstimated: boolean }>> {
  const rows: {
    item_code: string;
    location_code: string;
    allocatable_qty: string;
    override_qty: string | null;
    is_estimated: boolean;
  }[] = await dataSource.query(`
    SELECT item_code, location_code,
           allocatable_qty, override_qty, is_estimated
    FROM supply_snapshot_line
    WHERE snapshot_id = $1::bigint
  `, [supplySnapshotId]);

  const map = new Map<string, { qty: number; isEstimated: boolean }>();
  for (const r of rows) {
    const qty = parseFloat(r.override_qty ?? r.allocatable_qty ?? '0');
    map.set(`${r.item_code}||${r.location_code}`, { qty, isEstimated: r.is_estimated });
  }
  return map;
}

/** Phase 1: assign all in_transit_qty to week 1 (no ETA available) */
async function loadScheduledReceiptMap(
  supplySnapshotId: number,
  dataSource: DataSource,
): Promise<Map<string, number>> {
  const rows: { item_code: string; location_code: string; in_transit_qty: string }[] =
    await dataSource.query(`
      SELECT item_code, location_code, in_transit_qty
      FROM supply_snapshot_line
      WHERE snapshot_id = $1::bigint AND in_transit_qty > 0
    `, [supplySnapshotId]);

  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(`${r.item_code}||${r.location_code}||1`, parseFloat(r.in_transit_qty));
  }
  return map;
}

async function loadWeeklyDemandMap(
  demandSnapshotId: string,
  horizonStart: Date,
  horizonWeeks: number,
  dataSource: DataSource,
): Promise<Map<string, Map<number, number>>> {
  const rows: {
    item_code: string;
    location_code: string;
    qty: string;
    period_start: string;
  }[] = await dataSource.query(`
    SELECT item_code, location_code,
           COALESCE(reconciled_qty, qty)::text AS qty,
           period_start
    FROM demand_snapshot_line
    WHERE snapshot_id = $1
      AND COALESCE(reconciled_qty, qty) > 0
    ORDER BY item_code, location_code, period_start
  `, [demandSnapshotId]);

  const grouped = new Map<string, { period_start: Date; qty: number }[]>();
  for (const r of rows) {
    const key = `${r.item_code}||${r.location_code}`;
    const arr = grouped.get(key) ?? [];
    arr.push({ period_start: new Date(r.period_start), qty: parseFloat(r.qty) });
    grouped.set(key, arr);
  }

  const result = new Map<string, Map<number, number>>();
  for (const [key, monthlyRows] of grouped) {
    result.set(key, buildWeeklyDemandMap(monthlyRows, horizonStart, horizonWeeks));
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// BE-6c: DrpService
// ─────────────────────────────────────────────────────────────────────────────

@Injectable()
export class DrpService {
  constructor(
    @InjectRepository(PlanRun)             private readonly planRunRepo: Repository<PlanRun>,
    @InjectRepository(PlannedOrderRelease) private readonly porRepo: Repository<PlannedOrderRelease>,
    @InjectRepository(DrpException)        private readonly excRepo: Repository<DrpException>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK 1 — CREATE & TRIGGER
  // ═══════════════════════════════════════════════════════════════════════════

  async createAndRunDrp(dto: CreateDrpRunDto): Promise<{
    planRunId: string; status: string; combinationsToProcess: number;
  }> {
    // Guard: reject if RUNNING/COMPLETED already exists for same snapshot pair
    const existing = await this.dataSource.query(`
      SELECT id, status FROM plan_run
      WHERE demand_snapshot_id = $1 AND supply_snapshot_id = $2
        AND status IN ('RUNNING', 'COMPLETED')
      LIMIT 1
    `, [dto.demandSnapshotId, dto.supplySnapshotId]);
    if (existing[0]) {
      throw new ConflictException(
        `Plan run #${existing[0].id} (${existing[0].status}) đã tồn tại cho snapshot pair này. Dùng run đó hoặc chọn snapshot khác.`,
      );
    }

    // Validate demand snapshot FROZEN
    const demandSnap = await this.dataSource.query(`
      SELECT snapshot_id, status, horizon_start FROM demand_snapshot WHERE snapshot_id = $1
    `, [dto.demandSnapshotId]);
    if (!demandSnap[0]) throw new NotFoundException('Demand snapshot not found');
    if (demandSnap[0].status !== 'FROZEN')
      throw new BadRequestException(`Demand snapshot chưa FROZEN (hiện: ${demandSnap[0].status})`);

    // Validate supply snapshot FROZEN + stale gate (read stale_acknowledged from DB, NOT from DTO)
    const supplySnap = await this.dataSource.query(`
      SELECT id, status, freshness, stale_acknowledged FROM supply_snapshot WHERE id = $1
    `, [dto.supplySnapshotId]);
    if (!supplySnap[0]) throw new NotFoundException('Supply snapshot not found');
    if (supplySnap[0].status !== 'FROZEN')
      throw new BadRequestException(`Supply snapshot chưa FROZEN (hiện: ${supplySnap[0].status})`);
    if (supplySnap[0].freshness === 'STALE' && !supplySnap[0].stale_acknowledged)
      throw new ConflictException('Supply snapshot STALE — cần acknowledge ở Module 2 trước khi chạy DRP');

    // Count combinations using COALESCE(reconciled_qty, qty)
    const countRes = await this.dataSource.query(`
      SELECT COUNT(DISTINCT item_code || '||' || location_code) AS cnt
      FROM demand_snapshot_line
      WHERE snapshot_id = $1 AND COALESCE(reconciled_qty, qty) > 0
    `, [dto.demandSnapshotId]);
    const combinationsToProcess = parseInt(countRes[0]?.cnt ?? '0');

    // horizonStart: user input → demand snapshot's horizon_start → fallback today
    let horizonStart: Date;
    if (dto.horizonStart) {
      horizonStart = new Date(dto.horizonStart);
    } else {
      const snapStart = demandSnap[0].horizon_start;
      horizonStart = snapStart ? new Date(snapStart) : new Date();
    }

    // User-configurable params — override DRP_CONFIG defaults
    const horizonWeeks = dto.horizonWeeks ?? DRP_CONFIG.HORIZON_WEEKS;
    const frozenZone   = dto.frozenZone   ?? DRP_CONFIG.FROZEN_ZONE;

    const run = this.planRunRepo.create({
      demandSnapshotId: dto.demandSnapshotId,
      supplySnapshotId: String(dto.supplySnapshotId),
      status: 'RUNNING',
      combinationsProcessed: combinationsToProcess,
      configJson: {
        horizonWeeks,
        frozenZone,
        lotSizing:   DRP_CONFIG.LOT_SIZING,
        demandBasis: DRP_CONFIG.DEMAND_BASIS,
        horizonStart: horizonStart.toISOString(),
      },
      createdBy: dto.createdBy ?? null,
      startedAt: new Date(),
    });
    const saved = await this.planRunRepo.save(run);

    // Fire-and-forget (non-blocking — FE polls for status)
    this.calculateDrpBatch(saved.id, dto.demandSnapshotId, dto.supplySnapshotId, horizonStart, horizonWeeks, frozenZone)
      .catch(err => {
        console.error(`[PlanRun ${saved.id}] DRP failed:`, err.message);
        this.planRunRepo.update(saved.id, { status: 'FAILED', completedAt: new Date() });
      });

    return { planRunId: saved.id, status: 'RUNNING', combinationsToProcess };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK 1b — BATCH CALCULATION (private, called fire-and-forget)
  // ═══════════════════════════════════════════════════════════════════════════

  private async calculateDrpBatch(
    planRunId: string,
    demandSnapshotId: string,
    supplySnapshotId: number,
    horizonStart: Date,
    horizonWeeks: number,
    frozenZone: number,
  ): Promise<void> {
    const startTime = Date.now();

    // Get all combinations (COALESCE to catch planner overrides)
    const combinations: { item_code: string; location_code: string }[] =
      await this.dataSource.query(`
        SELECT DISTINCT item_code, location_code
        FROM demand_snapshot_line
        WHERE snapshot_id = $1 AND COALESCE(reconciled_qty, qty) > 0
        ORDER BY item_code, location_code
      `, [demandSnapshotId]);

    // Pre-load all data in parallel (3 queries, no N+1)
    const [inventoryMap, srMap, weeklyDemandMap] = await Promise.all([
      loadInventoryMap(supplySnapshotId, this.dataSource),
      loadScheduledReceiptMap(supplySnapshotId, this.dataSource),
      loadWeeklyDemandMap(demandSnapshotId, horizonStart, horizonWeeks, this.dataSource),
    ]);

    // SS bulk pre-load — 1 query via raw SQL JOIN (avoids N+1 vs getSsFinal() per combo)
    const ssRows: { item_code: string; location_code: string; ss_final: number; override_ss: number | null }[] =
      await this.dataSource.query(`
        SELECT sst.item_code, sst.location_code, sst.ss_final, sst.override_ss
        FROM safety_stock_target sst
        INNER JOIN policy_run pr ON pr.id = sst.policy_run_id
        WHERE pr.status = 'ACTIVE'
      `);
    const ssMap = new Map<string, number>();
    for (const r of ssRows) {
      ssMap.set(`${r.item_code}||${r.location_code}`, r.override_ss ?? r.ss_final);
    }

    const allOrders: Partial<PlannedOrderRelease>[] = [];
    const allExceptions: Partial<DrpException>[] = [];

    // Netting loop
    for (const { item_code, location_code } of combinations) {
      const comboKey = `${item_code}||${location_code}`;

      // Safety stock — default 0 if no ACTIVE policy run (raise MISSING_SS exception)
      const ss = ssMap.get(comboKey) ?? 0;
      if (!ssMap.has(comboKey)) {
        allExceptions.push({
          planRunId,
          type: 'MISSING_SS',
          severity: 'MEDIUM',
          itemCode: item_code,
          locationCode: location_code,
          weekNumber: null,
          message: `Không có safety stock target cho ${item_code} @ ${location_code}`,
          detailJson: { note: 'SS = 0, DRP vẫn chạy nhưng không có safety buffer' },
        });
      }

      const invData = inventoryMap.get(comboKey);
      const beginningInventory = invData?.qty ?? 0;
      const isEstimated = invData?.isEstimated ?? false;

      // Build scheduled receipts map for this combo
      const scheduledReceipts = new Map<number, number>();
      for (let w = 1; w <= DRP_CONFIG.HORIZON_WEEKS; w++) {
        const qty = srMap.get(`${comboKey}||${w}`) ?? 0;
        if (qty > 0) scheduledReceipts.set(w, qty);
      }

      const weeklyDemand = weeklyDemandMap.get(comboKey) ?? new Map();

      // Skip if no demand and no inventory
      if (weeklyDemand.size === 0 && beginningInventory === 0) continue;

      const { weeks, exceptions } = runNetting(
        { itemCode: item_code, locationCode: location_code, beginningInventory,
          scheduledReceipts, weeklyDemand, safetyStock: ss, isEstimated },
        horizonStart,
      );

      // Save ALL 12 weeks (including PO=0) — required for full netting trace
      for (const w of weeks) {
        allOrders.push({
          planRunId,
          itemCode: item_code,
          locationCode: location_code,
          weekNumber: w.week,
          weekStartDate: w.weekStartDate,
          // beginningInventory only on week 1; weeks 2–12 = null
          beginningInventory: w.week === 1 ? beginningInventory : null,
          grossRequirement:  Math.round(w.gr       * 100) / 100,
          scheduledReceipt:  Math.round(w.sr       * 100) / 100,
          pabBefore:         Math.round(w.pabBefore * 100) / 100,
          netRequirement:    Math.round(w.nr       * 100) / 100,
          plannedOrderQty:   Math.round(w.po       * 100) / 100,
          pabAfter:          Math.round(w.pabAfter  * 100) / 100,
          safetyStock: ss,
          hstk: w.hstk !== null ? Math.round(w.hstk * 100) / 100 : null,
          frozenZoneFlag: w.frozenZone,
          status: w.po > 0 ? w.status : 'AUTO_RELEASE',
          demandBasis: 'MAX_FORECAST_PO',
          isEstimated,
        });
      }

      for (const exc of exceptions) {
        allExceptions.push({
          planRunId,
          type: exc.type,
          severity: exc.severity,
          itemCode: item_code,
          locationCode: location_code,
          weekNumber: exc.week,
          message: exc.message,
          detailJson: exc.detail,
        });
      }
    }

    // Batch save
    await this.batchSave(this.porRepo, allOrders, DRP_CONFIG.BATCH_SIZE);
    await this.batchSave(this.excRepo, allExceptions, DRP_CONFIG.BATCH_SIZE);

    const durationMs = Date.now() - startTime;

    await this.planRunRepo.update(planRunId, {
      status: durationMs > DRP_CONFIG.TIMEOUT_MS ? 'TIMEOUT' : 'COMPLETED',
      plannedOrdersCount: allOrders.length,
      exceptionsCount: allExceptions.length,
      durationMs,
      completedAt: new Date(),
    });

    if (durationMs > DRP_CONFIG.TIMEOUT_MS) {
      console.warn(`[PlanRun ${planRunId}] DRP timeout: ${durationMs}ms > 60s`);
    }
  }

  /** Generic batch insert — safe because guard prevents re-run on same planRunId */
  private async batchSave<T extends ObjectLiteral>(repo: Repository<T>, items: Partial<T>[], batchSize: number) {
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await repo.createQueryBuilder()
        .insert().into(repo.target)
        .values(batch as T[])
        .orIgnore()
        .execute();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK 2 — READ PLAN RUNS
  // ═══════════════════════════════════════════════════════════════════════════

  async listPlanRuns(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await this.planRunRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });
    return { data, meta: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async getPlanRun(id: string) {
    const run = await this.planRunRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`Plan run ${id} not found`);

    const breakdown: { type: string; cnt: string }[] = await this.dataSource.query(`
      SELECT type, COUNT(*) AS cnt FROM drp_exception
      WHERE plan_run_id = $1 GROUP BY type
    `, [id]);

    const exceptionsByType: Record<string, number> = {};
    for (const r of breakdown) exceptionsByType[r.type] = parseInt(r.cnt);

    return { ...run, exceptionsByType };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK 3 — PLANNED ORDERS
  // ═══════════════════════════════════════════════════════════════════════════

  async getPlannedOrders(query: GetPlannedOrdersQueryDto) {
    const { planRunId, itemCode, locationCode, weekNumber, status,
            frozenZoneFlag, page = 1, pageSize = 50 } = query;
    const skip = (page - 1) * pageSize;

    const qb = this.porRepo.createQueryBuilder('por');
    qb.where('por.plan_run_id = :planRunId', { planRunId });
    if (itemCode)     qb.andWhere('por.item_code ILIKE :ic', { ic: `%${itemCode}%` });
    if (locationCode) qb.andWhere('por.location_code ILIKE :lc', { lc: `%${locationCode}%` });
    if (weekNumber)   qb.andWhere('por.week_number = :wn', { wn: weekNumber });
    if (status)       qb.andWhere('por.status = :status', { status });
    if (frozenZoneFlag !== undefined)
      qb.andWhere('por.frozen_zone_flag = :fz', { fz: frozenZoneFlag });

    qb.orderBy('por.week_number', 'ASC').addOrderBy('por.item_code', 'ASC').skip(skip).take(pageSize);
    const [data, total] = await qb.getManyAndCount();

    const summaryRes = await this.dataSource.query(`
      SELECT
        SUM(planned_order_qty) AS total_qty,
        COUNT(*) FILTER (WHERE planned_order_qty > 0) AS total_orders,
        COUNT(*) FILTER (WHERE status = 'AUTO_RELEASE' AND planned_order_qty > 0) AS auto_release,
        COUNT(*) FILTER (WHERE status = 'NEEDS_APPROVAL') AS needs_approval
      FROM planned_order_release WHERE plan_run_id = $1
    `, [planRunId]);
    const s = summaryRes[0] ?? {};

    return {
      data,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      summary: {
        totalPlannedQty:  parseFloat(s.total_qty      ?? '0'),
        totalOrders:      parseInt(s.total_orders     ?? '0'),
        autoRelease:      parseInt(s.auto_release      ?? '0'),
        needsApproval:    parseInt(s.needs_approval    ?? '0'),
      },
    };
  }

  async getNettingDetail(planRunId: string, itemCode: string, locationCode: string) {
    const weeks = await this.porRepo.find({
      where: { planRunId, itemCode, locationCode },
      order: { weekNumber: 'ASC' },
    });

    if (weeks.length === 0)
      throw new NotFoundException(`Không có netting data cho ${itemCode} @ ${locationCode} trong run ${planRunId}`);

    // Return entities directly — FE consumes PlannedOrderRelease field names
    return weeks;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK 4 — EXCEPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async getExceptions(query: GetExceptionsQueryDto) {
    const { planRunId, type, severity, resolved, page = 1, pageSize = 50 } = query;
    const skip = (page - 1) * pageSize;

    const qb = this.excRepo.createQueryBuilder('exc');
    qb.where('exc.plan_run_id = :planRunId', { planRunId });
    if (type)     qb.andWhere('exc.type = :type', { type });
    if (severity) qb.andWhere('exc.severity = :severity', { severity });
    if (resolved !== undefined) qb.andWhere('exc.resolved = :resolved', { resolved });

    // TypeORM does not support CASE in orderBy → sort in-memory after fetch
    qb.orderBy('exc.created_at', 'ASC').skip(skip).take(pageSize);
    const [data, total] = await qb.getManyAndCount();

    const severityOrder: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };
    data.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async resolveException(planRunId: string, excId: string, dto: ResolveExceptionDto) {
    const exc = await this.excRepo.findOne({ where: { id: excId } });
    if (!exc) throw new NotFoundException(`Exception ${excId} not found`);
    if (exc.planRunId !== planRunId)
      throw new BadRequestException(`Exception ${excId} không thuộc plan run ${planRunId}`);
    if (exc.resolved) throw new BadRequestException(`Exception ${excId} đã được resolve rồi`);

    exc.resolved = true;
    exc.resolvedBy = dto.resolvedBy ?? null;
    exc.resolvedAt = new Date();
    exc.resolutionNote = dto.resolutionNote;
    return this.excRepo.save(exc);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK 5 — APPROVE / CANCEL
  // ═══════════════════════════════════════════════════════════════════════════

  async approvePlannedOrder(id: string, dto: ApprovePlannedOrderDto) {
    const order = await this.porRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Planned order ${id} not found`);
    if (order.status !== 'NEEDS_APPROVAL')
      throw new BadRequestException(`Order ${id} status là ${order.status}, không phải NEEDS_APPROVAL`);

    order.status = 'RELEASED';
    order.approvedBy = dto.approvedBy ?? null;
    order.approvedAt = new Date();
    return this.porRepo.save(order);
  }

  async cancelPlannedOrder(id: string, dto: CancelPlannedOrderDto) {
    const order = await this.porRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Planned order ${id} not found`);
    if (['RELEASED', 'CANCELLED'].includes(order.status))
      throw new BadRequestException(`Order ${id} status ${order.status} không thể cancel`);

    order.status = 'CANCELLED';
    order.cancelledBy = dto.cancelledBy ?? null;
    order.cancelledAt = new Date();
    order.cancelReason = dto.reason;
    return this.porRepo.save(order);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TASK 6 — HSTK SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  async getHstkSummary(planRunId: string) {
    const rows: { type: string; cnt: string }[] = await this.dataSource.query(`
      SELECT type, COUNT(*) AS cnt
      FROM drp_exception
      WHERE plan_run_id = $1
        AND type IN ('STOCKOUT_ALERT', 'OVERSTOCK_ALERT')
      GROUP BY type
    `, [planRunId]);

    // Use combinations_processed from plan_run (accurate, no re-count needed)
    const runRes = await this.dataSource.query(`
      SELECT combinations_processed FROM plan_run WHERE id = $1
    `, [planRunId]);
    const total = parseInt(runRes[0]?.combinations_processed ?? '0');

    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.type] = parseInt(r.cnt);

    const stockout  = byType['STOCKOUT_ALERT']  ?? 0;
    const overstock = byType['OVERSTOCK_ALERT'] ?? 0;
    const ok        = Math.max(0, total - stockout - overstock);

    return {
      totalCombinations: total,
      stockoutCount:  stockout,
      stockoutPct:    total > 0 ? Math.round(stockout  / total * 1000) / 10 : 0,
      okCount:        ok,
      okPct:          total > 0 ? Math.round(ok        / total * 1000) / 10 : 0,
      overstockCount: overstock,
      overstockPct:   total > 0 ? Math.round(overstock / total * 1000) / 10 : 0,
    };
  }
}
