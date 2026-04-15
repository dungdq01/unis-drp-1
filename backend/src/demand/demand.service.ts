import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DemandSnapshot } from './entities/demand-snapshot.entity';
import { DemandSnapshotLine } from './entities/demand-snapshot-line.entity';
import { DemandForecastDetail } from './entities/demand-forecast-detail.entity';
import { DemandOverrideLog } from './entities/demand-override-log.entity';
import { ListSnapshotsDto } from './dto/list-snapshots.dto';
import { FreezeSnapshotDto } from './dto/freeze-snapshot.dto';
import { UploadForecastDto, UploadForecastResponseDto } from './dto/upload-forecast.dto';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { OverrideForecastDto } from './dto/override-forecast.dto';
import { ForecastCoverageDto } from './dto/snapshot-response.dto';
import { paginate, skipTake } from '../common/pagination.util';
import { UNIS_ERR, throwUnisError } from '../common/errors';

@Injectable()
export class DemandService {
  constructor(
    @InjectRepository(DemandSnapshot)
    private readonly snapshotRepo: Repository<DemandSnapshot>,
    @InjectRepository(DemandSnapshotLine)
    private readonly lineRepo: Repository<DemandSnapshotLine>,
    @InjectRepository(DemandForecastDetail)
    private readonly detailRepo: Repository<DemandForecastDetail>,
    @InjectRepository(DemandOverrideLog)
    private readonly overrideLogRepo: Repository<DemandOverrideLog>,
  ) {}

  // ── G10: Create empty snapshot (spec §6.4) ───────────────

  async createSnapshot(dto: CreateSnapshotDto) {
    const snapshot = this.snapshotRepo.create({
      snapshotName: dto.snapshotName,
      runId: dto.runId || undefined,
      status: 'DRAFT',
      sourceType: 'MANUAL',
      demandBasis: 'MAX_FORECAST_PO',
      horizonStart: dto.horizonStart ? new Date(dto.horizonStart) : undefined,
      horizonEnd: dto.horizonEnd ? new Date(dto.horizonEnd) : undefined,
      createdBy: dto.createdBy || undefined,
      notes: dto.notes || undefined,
    });
    return this.snapshotRepo.save(snapshot);
  }

  // ── P1: List Snapshots ───────────────────────────────────

  async listSnapshots(dto: ListSnapshotsDto) {
    const { page, pageSize, status } = dto;
    const where: any = {};
    if (status) where.status = status;

    const [data, total] = await this.snapshotRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...skipTake(page, pageSize),
    });

    return paginate(data, total, page, pageSize);
  }

  // ── P1: Snapshot Detail ──────────────────────────────────

  async getSnapshotDetail(id: string, page: number, pageSize: number) {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throwUnisError(UNIS_ERR.SNAPSHOT_NOT_FOUND);

    const [lines, total] = await this.lineRepo.findAndCount({
      where: { snapshotId: id },
      order: { itemCode: 'ASC', locationCode: 'ASC', periodStart: 'ASC' },
      ...skipTake(page, pageSize),
    });

    return {
      ...snapshot,
      lines: paginate(lines, total, page, pageSize),
    };
  }

  // ── P1: Freeze Snapshot ──────────────────────────────────

  async freezeSnapshot(id: string, dto: FreezeSnapshotDto) {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throwUnisError(UNIS_ERR.SNAPSHOT_NOT_FOUND);
    if (snapshot.status !== 'DRAFT') throwUnisError(UNIS_ERR.SNAPSHOT_NOT_DRAFT);
    if (snapshot.totalLines === 0) throwUnisError(UNIS_ERR.SNAPSHOT_EMPTY);

    snapshot.status = 'FROZEN';
    snapshot.frozenAt = new Date();
    snapshot.frozenBy = dto.frozenBy || undefined;
    if (dto.notes) snapshot.notes = dto.notes;

    return this.snapshotRepo.save(snapshot);
  }

  // ── BE-T6: Delete snapshot (DRAFT only) ─────────────────

  async deleteSnapshot(id: string) {
    const snap = await this.snapshotRepo.findOne({ where: { id } });
    if (!snap) throwUnisError(UNIS_ERR.SNAPSHOT_NOT_FOUND);
    if (snap.status !== 'DRAFT') {
      throwUnisError({
        code: 'UNIS-ERR-011',
        msg: `Only DRAFT snapshots can be deleted (current: ${snap.status})`,
        status: 400,
      });
    }
    // Cascade delete children first (no FK CASCADE declared in DDL)
    await this.overrideLogRepo.delete({ snapshotId: id });
    await this.lineRepo.delete({ snapshotId: id });
    await this.detailRepo.delete({ snapshotId: id });
    await this.snapshotRepo.delete({ id });
    return { deleted: true, id };
  }

  // ── BE-T7: Archive snapshot ─────────────────────────────

  async archiveSnapshot(id: string, archivedBy?: string) {
    const snap = await this.snapshotRepo.findOne({ where: { id } });
    if (!snap) throwUnisError(UNIS_ERR.SNAPSHOT_NOT_FOUND);
    if (snap.status === 'ARCHIVED') {
      return snap;
    }
    if (snap.status === 'DRAFT') {
      throwUnisError({
        code: 'UNIS-ERR-012',
        msg: 'Cannot archive DRAFT snapshot — freeze first or delete',
        status: 400,
      });
    }
    snap.status = 'ARCHIVED';
    if (archivedBy) {
      snap.notes = `${snap.notes ?? ''}\n[archived by ${archivedBy} @ ${new Date().toISOString()}]`.trim();
    }
    return this.snapshotRepo.save(snap);
  }

  // ── P2: Upload Forecast CSV ──────────────────────────────

  async uploadForecast(
    file: Express.Multer.File,
    dto: UploadForecastDto,
  ): Promise<UploadForecastResponseDto> {
    if (!file) throwUnisError(UNIS_ERR.INVALID_CSV);

    const content = file.buffer.toString('utf-8');
    const rows = content.split('\n').filter(r => r.trim());
    if (rows.length < 2) throwUnisError(UNIS_ERR.INVALID_CSV);

    const headers = rows[0].split(',').map(h => h.trim().toLowerCase());
    const dataRows = rows.slice(1);

    // BE-A1: resolve target snapshot — upload vào DRAFT có sẵn hoặc tạo mới
    let saved: DemandSnapshot;
    if (dto.targetSnapshotId) {
      const target = await this.snapshotRepo.findOne({ where: { id: dto.targetSnapshotId } });
      if (!target) throwUnisError(UNIS_ERR.SNAPSHOT_NOT_FOUND);
      if (target.status !== 'DRAFT') throwUnisError(UNIS_ERR.SNAPSHOT_NOT_DRAFT);
      // Replace existing lines
      await this.lineRepo.delete({ snapshotId: dto.targetSnapshotId });
      // Update filename info
      target.forecastFileName = file.originalname;
      target.sourceType = 'CSV_UPLOAD';
      if (dto.createdBy) target.createdBy = dto.createdBy;
      saved = await this.snapshotRepo.save(target);
    } else {
      // Create new snapshot (G5: persist metadata)
      const snapshot = this.snapshotRepo.create({
        runId: dto.runId || undefined,
        status: 'DRAFT',
        demandBasis: 'MAX_FORECAST_PO',
        snapshotName: dto.snapshotName || `Snapshot ${new Date().toISOString().slice(0, 10)}`,
        sourceType: 'CSV_UPLOAD',
        forecastFileName: file.originalname,
        createdBy: dto.createdBy || undefined,
      });
      saved = await this.snapshotRepo.save(snapshot);
    }

    const lines: Partial<DemandSnapshotLine>[] = [];
    const errors: Array<{ row: number; column: string; error: string; value: string }> = [];
    const itemSet = new Set<string>();
    const locationSet = new Set<string>();
    let filteredExclude = 0;
    let filteredDormant = 0;

    // Auto-detect CSV format
    const isDrpFormat = headers.includes('fsku_id') || headers.includes('forecast_qty');
    const isPipelineFormat = headers.includes('item_code') && headers.includes('period_start');

    const itemCodeIdx = isDrpFormat
      ? headers.indexOf('fsku_id')
      : headers.indexOf('item_code');
    const locationCodeIdx = isDrpFormat
      ? headers.indexOf('branch_code')
      : headers.indexOf('location_code');
    const periodIdx = isDrpFormat
      ? headers.indexOf('forecast_date')
      : headers.indexOf('period_start');
    const qtyIdx = isDrpFormat
      ? headers.indexOf('forecast_qty')
      : headers.indexOf('qty');

    if (itemCodeIdx === -1 || qtyIdx === -1) {
      throwUnisError(UNIS_ERR.INVALID_CSV);
    }

    // DRP format: indexes for filtering EXCLUDE rows
    // G2: Per spec §4.3 — filter bằng exclude_flag (không phải model_config_id)
    const excludeFlagIdx = headers.indexOf('exclude_flag');
    const modelConfigIdx = headers.indexOf('model_config_id'); // kept for backward compat
    const comboClassIdx = headers.indexOf('combo_class');
    const segmentIdx = headers.indexOf('segment');
    const demandTypeIdx = headers.indexOf('demand_type');
    const priorityIdx = headers.indexOf('priority');

    // DRP format: indexes for new columns
    const archetypeIdx = headers.indexOf('branch_archetype');
    const tetFlagIdx = headers.indexOf('tet_flag');
    const confLowerIdx = headers.indexOf('confidence_lower');
    const confUpperIdx = headers.indexOf('confidence_upper');

    // Pre-load valid IDs for FK validation
    const validItems = new Set<string>();
    const validLocations = new Set<string>();
    try {
      const itemRows = await this.snapshotRepo.manager.query('SELECT item_code FROM item');
      for (const r of itemRows) validItems.add(r.item_code);
      const locRows = await this.snapshotRepo.manager.query('SELECT location_code FROM location');
      for (const r of locRows) validLocations.add(r.location_code);
    } catch { /* table may not exist */ }

    for (let i = 0; i < dataRows.length; i++) {
      try {
        const cols = dataRows[i].split(',').map(c => c.trim());

        if (isDrpFormat) {
          // G2 FIX: Filter by exclude_flag column (per spec §4.3)
          // Fallback to model_config_id if exclude_flag absent (legacy CSV)
          const excludeFlag = excludeFlagIdx >= 0 ? cols[excludeFlagIdx]?.trim() : '';
          const modelCfg = modelConfigIdx >= 0 ? cols[modelConfigIdx]?.trim() : '';
          if (excludeFlag === 'EXCLUDE' || modelCfg === 'EXCLUDE') {
            filteredExclude++; continue;
          }

          // G2 FIX: DORMANT_DISCONTINUED filter — remove qty===0 gate (not in spec).
          // Spec §4.3: filter tất cả dormant regardless of qty.
          const comboClass = comboClassIdx >= 0 ? cols[comboClassIdx]?.trim() : '';
          if (comboClass === 'DORMANT_DISCONTINUED' || excludeFlag === 'DORMANT_DISCONTINUED') {
            filteredDormant++; continue;
          }
        }

        const itemCode = cols[itemCodeIdx];
        const locationCode = cols[locationCodeIdx];
        // Period: DRP uses "2025-12", pipeline uses "2025-12-01"
        let periodStart = cols[periodIdx]?.trim();
        if (periodStart && periodStart.length === 7) periodStart = periodStart + '-01';
        const qty = parseFloat(cols[qtyIdx]);

        if (!itemCode || !locationCode || !periodStart || isNaN(qty)) {
          errors.push({ row: i + 2, column: 'general', error: 'missing or invalid data', value: '' });
          continue;
        }

        // FK validation against master data
        if (validItems.size > 0 && !validItems.has(itemCode)) {
          errors.push({ row: i + 2, column: 'item_code', error: 'Item not found in master data', value: itemCode });
          continue;
        }
        if (locationCode && validLocations.size > 0 && !validLocations.has(locationCode)) {
          errors.push({ row: i + 2, column: 'location_code', error: 'Location not found in master data', value: locationCode });
          continue;
        }

        itemSet.add(itemCode);
        locationSet.add(locationCode);

        const comboClassVal = comboClassIdx >= 0 ? cols[comboClassIdx]?.trim() : undefined;

        lines.push({
          snapshotId: saved.id,
          itemCode,
          locationCode,
          periodStart: new Date(periodStart),
          qty,
          demandType: demandTypeIdx !== -1 ? cols[demandTypeIdx] || 'FORECAST' : 'FORECAST',
          segment: segmentIdx !== -1 ? cols[segmentIdx] || undefined : undefined,
          priority: priorityIdx !== -1 ? parseInt(cols[priorityIdx]) || 0 : 0,
          comboClass: comboClassVal || undefined,
          branchArchetype: archetypeIdx >= 0 ? cols[archetypeIdx]?.trim() || undefined : undefined,
          tetFlag: tetFlagIdx >= 0 ? cols[tetFlagIdx]?.trim() || undefined : undefined,
          confidenceLower: confLowerIdx >= 0 ? parseFloat(cols[confLowerIdx]) || undefined : undefined,
          confidenceUpper: confUpperIdx >= 0 ? parseFloat(cols[confUpperIdx]) || undefined : undefined,
        });
      } catch (e) {
        if (e instanceof Error && e.message.includes('UNIS-ERR')) throw e;
        errors.push({ row: i + 2, column: 'general', error: 'parse error', value: '' });
      }
    }

    // Validate error threshold (>10% invalid)
    const errorRate = errors.length / dataRows.length;
    if (errorRate > 0.1) {
      // Chỉ xoá snapshot nếu vừa tạo mới; nếu upload vào existing DRAFT thì giữ nguyên
      if (!dto.targetSnapshotId) await this.snapshotRepo.remove(saved);
      throwUnisError(UNIS_ERR.TOO_MANY_ERRORS);
    }

    // Bulk insert lines
    if (lines.length > 0) {
      await this.lineRepo
        .createQueryBuilder()
        .insert()
        .into(DemandSnapshotLine)
        .values(lines)
        .execute();
    }

    // Update snapshot stats + horizon (G5)
    saved.totalLines = lines.length;
    saved.totalItems = itemSet.size;
    saved.totalLocations = locationSet.size;
    if (lines.length > 0) {
      const periods = lines.map(l => (l.periodStart as Date).getTime());
      saved.horizonStart = new Date(Math.min(...periods));
      saved.horizonEnd = new Date(Math.max(...periods));
    }
    await this.snapshotRepo.save(saved);

    return {
      snapshotId: saved.id,
      status: 'DRAFT',
      totalRowsParsed: dataRows.length,
      totalRowsImported: lines.length,
      totalRowsFiltered: filteredExclude + filteredDormant,
      totalItems: itemSet.size,
      totalLocations: locationSet.size,
      filterSummary: {
        EXCLUDE: filteredExclude,
        DORMANT_DISCONTINUED: filteredDormant,
      },
      validationErrors: errors,
      skippedRows: errors.length,
    };
  }

  // ── P3: Forecast Summary ─────────────────────────────────

  async getForecastSummary(query: ForecastQueryDto) {
    // G11: dynamic groupBy (default: item+segment)
    const DIM_MAP: Record<string, { col: string; alias: string }> = {
      item: { col: 'l.item_code', alias: 'itemCode' },
      segment: { col: 'l.segment', alias: 'segment' },
      location: { col: 'l.location_code', alias: 'locationCode' },
      period: { col: 'l.period_start', alias: 'periodStart' },
    };
    const requested = (query.groupBy || 'item,segment')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => DIM_MAP[s]);
    const dims = requested.length > 0 ? requested : ['item', 'segment'];

    const qb = this.lineRepo
      .createQueryBuilder('l')
      .select('SUM(l.qty)', 'totalQty')
      .addSelect('COUNT(*)', 'lineCount');

    for (const d of dims) {
      qb.addSelect(DIM_MAP[d].col, DIM_MAP[d].alias);
      qb.addGroupBy(DIM_MAP[d].col);
    }
    qb.orderBy('"totalQty"', 'DESC');

    if (query.snapshotId) qb.andWhere('l.snapshot_id = :sid', { sid: query.snapshotId });
    if (query.segment) qb.andWhere('l.segment = :seg', { seg: query.segment });
    if (query.itemCode) qb.andWhere('l.item_code = :ic', { ic: query.itemCode });
    if (query.locationCode) qb.andWhere('l.location_code = :lc', { lc: query.locationCode });

    const { page, pageSize } = query;
    const total = await qb.getCount();
    qb.offset((page - 1) * pageSize).limit(pageSize);
    const data = await qb.getRawMany();

    return paginate(data, total, page, pageSize);
  }

  // ── P3: Forecast Coverage ────────────────────────────────

  async getForecastCoverage(snapshotId?: string): Promise<any> {
    // Total items from item table (master data)
    const totalResult = await this.snapshotRepo.manager.query(
      'SELECT COUNT(*) as cnt FROM item'
    );
    const totalItems = parseInt(totalResult[0]?.cnt) || 0;

    // Items with forecast in snapshot
    const lineQb = this.lineRepo
      .createQueryBuilder('l')
      .select('COUNT(DISTINCT l.item_code)', 'cnt');
    if (snapshotId) lineQb.where('l.snapshot_id = :sid', { sid: snapshotId });
    const { cnt } = await lineQb.getRawOne();
    const itemsWithForecast = parseInt(cnt) || 0;

    const coveragePercent = totalItems > 0
      ? Math.round((itemsWithForecast / totalItems) * 10000) / 100
      : 0;

    // M1: Segment breakdown
    const segQuery = this.lineRepo
      .createQueryBuilder('l')
      .select('l.segment', 'segment')
      .addSelect('COUNT(DISTINCT l.item_code)', 'covered');
    if (snapshotId) segQuery.where('l.snapshot_id = :sid', { sid: snapshotId });
    segQuery.groupBy('l.segment');
    const segRows = await segQuery.getRawMany();

    // Total per segment from demand_snapshot_line
    const segTotalQuery = await this.snapshotRepo.manager.query(`
      SELECT segment, COUNT(DISTINCT item_code) as total
      FROM demand_snapshot_line
      ${snapshotId ? 'WHERE snapshot_id = $1' : ''}
      GROUP BY segment
    `, snapshotId ? [snapshotId] : []);

    const bySegment: Record<string, any> = {};
    for (const row of segRows) {
      const seg = row.segment || 'Unknown';
      const covered = parseInt(row.covered) || 0;
      const totalSeg = segTotalQuery.find((s: any) => s.segment === seg);
      const total = parseInt(totalSeg?.total) || covered;
      bySegment[seg] = { total, covered, pct: total > 0 ? Math.round((covered / total) * 1000) / 10 : 0 };
    }

    return { totalItems, itemsWithForecast, coveragePercent, bySegment };
  }

  // ── P3: Forecast Detail ──────────────────────────────────

  async getForecastDetail(query: ForecastQueryDto) {
    const { page, pageSize } = query;
    const qb = this.detailRepo.createQueryBuilder('d');

    // Use correct DDL column names (matching entity mapped names)
    if (query.snapshotId) qb.andWhere('d.snapshot_id = :sid', { sid: query.snapshotId });
    if (query.segment) qb.andWhere('d.segment = :seg', { seg: query.segment });
    if (query.branchCode) qb.andWhere('d.branch_id = :bc', { bc: query.branchCode });
    if (query.itemCode) qb.andWhere('d.item_code = :ic', { ic: query.itemCode });
    if (query.locationCode) qb.andWhere('d.location_code = :lc', { lc: query.locationCode });
    if (query.comboClass) qb.andWhere('d.combo_class = :cc', { cc: query.comboClass });
    if (query.branchArchetype) qb.andWhere('d.branch_archetype = :ba', { ba: query.branchArchetype });
    if (query.tetFlag) qb.andWhere('d.tet_flag = :tf', { tf: query.tetFlag });

    qb.orderBy('d.item_code', 'ASC')
      .addOrderBy('d.branch_id', 'ASC')
      .addOrderBy('d.forecast_date', 'ASC');

    const total = await qb.getCount();
    qb.skip((page - 1) * pageSize).take(pageSize);
    const data = await qb.getMany();

    return paginate(data, total, page, pageSize);
  }

  // ── P3b: Forecast Pivot ──────────────────────────────────

  async getForecastPivot(snapshotId?: string, segment?: string, page = 1, pageSize = 50) {
    const qb = this.lineRepo
      .createQueryBuilder('l')
      .select('l.item_code', 'itemCode')
      .addSelect('l.segment', 'segment')
      .addSelect('l.period_start', 'periodStart')
      .addSelect('SUM(l.qty)', 'qty');

    if (snapshotId) qb.andWhere('l.snapshot_id = :sid', { sid: snapshotId });
    if (segment) qb.andWhere('l.segment = :seg', { seg: segment });

    qb.groupBy('l.item_code')
      .addGroupBy('l.segment')
      .addGroupBy('l.period_start')
      .orderBy('l.item_code', 'ASC');

    const rawRows = await qb.getRawMany();

    // Pivot — group by itemCode, create periods object
    const itemMap = new Map<string, {
      itemCode: string;
      segment: string;
      periods: Record<string, number>;
      total: number;
    }>();

    for (const row of rawRows) {
      const key = row.itemCode;
      let item = itemMap.get(key);
      if (!item) {
        item = { itemCode: key, segment: row.segment, periods: {}, total: 0 };
        itemMap.set(key, item);
      }
      const periodKey = row.periodStart instanceof Date
        ? `${row.periodStart.getFullYear()}-${String(row.periodStart.getMonth() + 1).padStart(2, '0')}`
        : String(row.periodStart).substring(0, 7);
      const qty = parseFloat(row.qty) || 0;
      item.periods[periodKey] = (item.periods[periodKey] || 0) + qty;
      item.total += qty;
    }

    // Sort by total desc, paginate
    const allItems = [...itemMap.values()].sort((a, b) => b.total - a.total);
    const total = allItems.length;
    const data = allItems.slice((page - 1) * pageSize, page * pageSize);

    // Get qtySold12mAvg from demand_forecast_detail for severity
    const itemCodes = data.map(d => d.itemCode);
    let avgMap: Record<string, number> = {};
    if (itemCodes.length > 0) {
      try {
        const avgRows = await this.detailRepo
          .createQueryBuilder('d')
          .select('d.item_code', 'itemCode')
          .addSelect('AVG(d.qty_sold_12m_avg)', 'avg')
          .where('d.item_code IN (:...codes)', { codes: itemCodes })
          .groupBy('d.item_code')
          .getRawMany();
        for (const r of avgRows) {
          avgMap[r.itemCode] = parseFloat(r.avg) || 0;
        }
      } catch { /* detail table may be empty */ }
    }

    return {
      data: data.map(d => ({
        ...d,
        qtySold12mAvg: avgMap[d.itemCode] || 0,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // ── P3c: Export Forecast CSV ────────────────────────────

  async exportForecastCsv(snapshotId?: string): Promise<string> {
    const qb = this.lineRepo.createQueryBuilder('l');
    if (snapshotId) qb.where('l.snapshot_id = :sid', { sid: snapshotId });
    qb.orderBy('l.item_code').addOrderBy('l.location_code').addOrderBy('l.period_start');
    const lines = await qb.getMany();

    const header = 'item_code,location_code,period_start,qty,reconciled_qty,segment,demand_type\n';
    const rows = lines.map(l =>
      `${l.itemCode},${l.locationCode},${l.periodStart},${l.qty},${l.reconciledQty ?? ''},${l.segment ?? ''},${l.demandType}`
    ).join('\n');
    return header + rows;
  }

  // ── P4: Override History ────────────────────────────────

  async getOverrideHistory(snapshotId?: string, itemCode?: string, page = 1, pageSize = 20) {
    const qb = this.overrideLogRepo.createQueryBuilder('o');
    if (snapshotId) qb.andWhere('o.snapshot_id = :sid', { sid: snapshotId });
    if (itemCode) qb.andWhere('o.item_code = :ic', { ic: itemCode });
    qb.orderBy('o.created_at', 'DESC');

    const [data, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return paginate(data, total, page, pageSize);
  }

  // ── P4: Override Forecast ────────────────────────────────

  async overrideForecast(dto: OverrideForecastDto) {
    // BE-4: Validate overriddenBy is required (NOT NULL in DB)
    if (!dto.reason || !dto.reason.trim()) throwUnisError(UNIS_ERR.REASON_REQUIRED);
    if (!dto.overriddenBy || !dto.overriddenBy.trim()) {
      throwUnisError({
        code: 'UNIS-ERR-009',
        msg: 'overriddenBy is required (who is making this override?)',
        status: 400,
      });
    }

    const snapshot = await this.snapshotRepo.findOne({ where: { id: dto.snapshotId } });
    if (!snapshot) throwUnisError(UNIS_ERR.SNAPSHOT_NOT_FOUND);
    if (snapshot.status !== 'DRAFT') throwUnisError(UNIS_ERR.CANNOT_OVERRIDE);

    // G6: If locationCode is 'ALL' or empty, find first matching line for that item+period
    const whereClause: any = {
      snapshotId: dto.snapshotId,
      itemCode: dto.itemCode,
      periodStart: new Date(dto.periodStart) as any,
    };
    if (dto.locationCode && dto.locationCode !== 'ALL') {
      whereClause.locationCode = dto.locationCode;
    }
    const line = await this.lineRepo.findOne({ where: whereClause });

    // BE-5: Correct error code for line not found
    if (!line) {
      throwUnisError({
        code: 'UNIS-ERR-010',
        msg: `Demand line not found: ${dto.itemCode} @ ${dto.locationCode} period ${dto.periodStart}`,
        status: 404,
      });
    }

    const oldQty = Number(line.reconciledQty ?? line.qty);

    // Log the override
    const log = this.overrideLogRepo.create({
      snapshotId: dto.snapshotId,
      lineId: line.id,
      itemCode: dto.itemCode,
      locationCode: line.locationCode,  // G6: use resolved location from found line
      periodStart: new Date(dto.periodStart),
      oldQty,
      newQty: dto.newQty,
      reason: dto.reason,
      overriddenBy: dto.overriddenBy,  // BE-3: NOT optional — required by DDL
    });
    await this.overrideLogRepo.save(log);

    // Update reconciled qty
    line.reconciledQty = dto.newQty;
    await this.lineRepo.save(line);

    return {
      lineId: line.id,
      itemCode: dto.itemCode,
      locationCode: line.locationCode,  // G6: return actual resolved location
      periodStart: dto.periodStart,
      oldQty,
      newQty: dto.newQty,
      reason: dto.reason,
    };
  }

  // ── BE-A2: Meta — distinct locations từ FROZEN snapshots ─────────────────

  async getMetaLocations(): Promise<{ locations: string[] }> {
    const rows = await this.lineRepo.manager.query(`
      SELECT DISTINCT l.location_code
      FROM demand_snapshot_line l
      JOIN demand_snapshot s ON s.snapshot_id = l.snapshot_id
      WHERE s.status = 'FROZEN'
      ORDER BY l.location_code
    `);
    return { locations: rows.map((r: any) => r.location_code) };
  }
}
