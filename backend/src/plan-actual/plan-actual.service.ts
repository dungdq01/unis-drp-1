import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { parse as csvParse } from 'csv-parse/sync';
import { PlanActualComparison } from './entities/plan-actual-comparison.entity';
import { PacUploadedDataset } from './entities/pac-uploaded-dataset.entity';
import { PacUploadedLine } from './entities/pac-uploaded-line.entity';
import { ComputeDto, ListComparisonQueryDto, UploadDatasetDto } from './dto';
import { throwUnisError, UNIS_ERR } from '../common/errors';

// ─── Constants ────────────────────────────────────────────────────────────────

const WARNING_THRESHOLD  = 20;   // |variance_pct| > 20% → WARNING
const CRITICAL_THRESHOLD = 40;   // |variance_pct| > 40% → CRITICAL
const INSERT_CHUNK_SIZE  = 500;  // Avoid PostgreSQL 65535 param limit

// ─── Internal types ───────────────────────────────────────────────────────────

interface SnapshotLine {
  itemCode: string;
  locationCode: string;
  periodStart: string;
  qty: number;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class PlanActualService {
  constructor(
    @InjectRepository(PlanActualComparison)
    private readonly repo: Repository<PlanActualComparison>,
    @InjectRepository(PacUploadedDataset)
    private readonly dsRepo: Repository<PacUploadedDataset>,
    @InjectRepository(PacUploadedLine)
    private readonly lineRepo: Repository<PacUploadedLine>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST VERSIONS (dropdown cho UI)
  // ═══════════════════════════════════════════════════════════════════════════

  async listVersions(): Promise<object> {
    const rows = await this.dataSource.query(`
      SELECT
        snapshot_id   AS "snapshotId",
        snapshot_name AS "snapshotName",
        created_at    AS "createdAt",
        COALESCE(snapshot_name, 'Snapshot ' || TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI')) AS label
      FROM demand_snapshot
      WHERE status = 'FROZEN'
      ORDER BY created_at DESC
    `);
    return { data: rows };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTE (dispatcher)
  // ═══════════════════════════════════════════════════════════════════════════

  async computeComparison(dto: ComputeDto): Promise<object> {
    if (dto.comparisonType === 'FORECAST_VERSION') {
      if (!dto.snapshotIdCompare) {
        throw new BadRequestException('snapshotIdCompare is required for FORECAST_VERSION');
      }
      return this._computeForecastVersion(dto);
    }
    if (dto.comparisonType === 'UPLOAD_COMPARE') {
      if (!dto.uploadBaseId || !dto.uploadCompareId) {
        throw new BadRequestException('uploadBaseId and uploadCompareId are required for UPLOAD_COMPARE');
      }
      return this._computeUploadCompare(dto);
    }
    return this._computeForecastVsActual(dto);
  }

  // ── FORECAST_VERSION ──────────────────────────────────────────────────────

  private async _computeForecastVersion(dto: ComputeDto): Promise<object> {
    const [baseLines, compareLines] = await Promise.all([
      this._loadSnapshotLines(dto.snapshotIdBase!),
      this._loadSnapshotLines(dto.snapshotIdCompare!),
    ]);

    const compareMap = new Map<string, number>();
    for (const l of compareLines) {
      compareMap.set(`${l.itemCode}|${l.locationCode}|${l.periodStart}`, l.qty);
    }

    const snapshots: Partial<PlanActualComparison>[] = [];

    for (const base of baseLines) {
      const compareQty = compareMap.get(`${base.itemCode}|${base.locationCode}|${base.periodStart}`) ?? 0;
      const planQty    = base.qty;
      const actualQty  = compareQty;

      const varianceQty = actualQty - planQty;
      const variancePct = planQty !== 0
        ? Math.round((varianceQty / planQty) * 10000) / 100
        : null;

      const absPct = variancePct != null ? Math.abs(variancePct) : 0;
      const status = variancePct == null ? 'N_A'
                   : absPct > CRITICAL_THRESHOLD ? 'CRITICAL'
                   : absPct > WARNING_THRESHOLD  ? 'WARNING'
                   : 'ON_TARGET';

      snapshots.push({
        comparisonType:    'FORECAST_VERSION',
        periodStart:       base.periodStart,
        periodEnd:         this._monthEnd(base.periodStart),
        periodType:        'MONTHLY',
        itemCode:          base.itemCode,
        locationCode:      base.locationCode,
        snapshotIdBase:    dto.snapshotIdBase,
        snapshotIdCompare: dto.snapshotIdCompare,
        planQty,
        actualQty,
        varianceQty,
        variancePct,
        fillRateProxy:     null,
        status,
        computedBy:        dto.computedBy ?? 'system',
      });
    }

    await this._saveChunked(snapshots);

    const warnings  = snapshots.filter(r => r.status === 'WARNING').length;
    const criticals = snapshots.filter(r => r.status === 'CRITICAL').length;
    return { computed: snapshots.length, warnings, criticals, comparison_type: 'FORECAST_VERSION' };
  }

  // ── FORECAST_VS_ACTUAL ────────────────────────────────────────────────────

  private async _computeForecastVsActual(dto: ComputeDto): Promise<object> {
    // Validate snapshot exists AND is FROZEN
    const snap = await this.dataSource.query(
      `SELECT snapshot_id FROM demand_snapshot WHERE snapshot_id = $1 AND status = 'FROZEN'`,
      [dto.snapshotIdBase],
    );
    if (!snap.length) throwUnisError(UNIS_ERR.PLAN_ACTUAL_SNAPSHOT_NOT_VALID);

    const planLines = await this._loadSnapshotLines(dto.snapshotIdBase!);

    if (!planLines.length) {
      return { computed: 0, warnings: 0, criticals: 0, comparison_type: 'FORECAST_VS_ACTUAL' };
    }

    // Collect all unique periods to scope the actual proxy query
    const periods = [...new Set(planLines.map(l => l.periodStart))].sort();
    const rangeStart = periods[0];
    const rangeEnd   = this._monthEnd(periods[periods.length - 1]);

    // Load actual proxy: EXPORTED order_line aggregated by item × dest_location × month
    const actualRows: { itemCode: string; locationCode: string; periodMonth: string; totalQty: string }[] =
      await this.dataSource.query(`
        SELECT
          ol.item_code                                        AS "itemCode",
          ol.dest_location_code                               AS "locationCode",
          date_trunc('month', ob.exported_at)::date::text     AS "periodMonth",
          SUM(ol.qty)::text                                   AS "totalQty"
        FROM order_line ol
        JOIN order_batch ob ON ob.id = ol.order_batch_id
        WHERE ol.status = 'ACTIVE'
          AND ob.status = 'EXPORTED'
          AND ob.exported_at >= $1::date
          AND ob.exported_at <  $2::date + INTERVAL '1 day'
        GROUP BY ol.item_code, ol.dest_location_code, date_trunc('month', ob.exported_at)
      `, [rangeStart, rangeEnd]);

    const actualMap = new Map<string, number>();
    for (const r of actualRows) {
      actualMap.set(`${r.itemCode}|${r.locationCode}|${r.periodMonth}`, Number(r.totalQty));
    }

    const snapshots: Partial<PlanActualComparison>[] = [];

    for (const plan of planLines) {
      const planQty   = plan.qty;
      const actualQty = actualMap.get(`${plan.itemCode}|${plan.locationCode}|${plan.periodStart}`) ?? null;

      const varianceQty = actualQty != null ? actualQty - planQty : null;
      const variancePct = planQty !== 0 && varianceQty != null
        ? Math.round((varianceQty / planQty) * 10000) / 100
        : null;
      const fillRateProxy = planQty > 0 && actualQty != null
        ? Math.round((actualQty / planQty) * 10000) / 10000
        : null;

      const absPct = variancePct != null ? Math.abs(variancePct) : 0;
      const status = variancePct == null ? 'N_A'
                   : absPct > CRITICAL_THRESHOLD ? 'CRITICAL'
                   : absPct > WARNING_THRESHOLD  ? 'WARNING'
                   : 'ON_TARGET';

      snapshots.push({
        comparisonType:    'FORECAST_VS_ACTUAL',
        periodStart:       plan.periodStart,
        periodEnd:         this._monthEnd(plan.periodStart),
        periodType:        'MONTHLY',
        itemCode:          plan.itemCode,
        locationCode:      plan.locationCode,
        snapshotIdBase:    dto.snapshotIdBase,
        snapshotIdCompare: null,
        planQty,
        actualQty,
        varianceQty,
        variancePct,
        fillRateProxy,
        status,
        computedBy:        dto.computedBy ?? 'system',
      });
    }

    await this._saveChunked(snapshots);

    const warnings  = snapshots.filter(r => r.status === 'WARNING').length;
    const criticals = snapshots.filter(r => r.status === 'CRITICAL').length;
    return { computed: snapshots.length, warnings, criticals, comparison_type: 'FORECAST_VS_ACTUAL' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════

  async getSummary(): Promise<object> {
    const [fv] = await this.dataSource.query(`
      SELECT
        ROUND(AVG(variance_pct)::numeric, 2)        AS avg_variance_pct,
        ROUND(AVG(variance_qty)::numeric, 2)        AS avg_bias,
        COUNT(*) FILTER (WHERE status = 'WARNING')  AS warning_count,
        COUNT(*) FILTER (WHERE status = 'CRITICAL') AS critical_count,
        MAX(computed_at)                            AS last_computed_at
      FROM plan_actual_comparison
      WHERE comparison_type = 'FORECAST_VERSION'
        AND computed_at = (
          SELECT MAX(computed_at) FROM plan_actual_comparison
          WHERE comparison_type = 'FORECAST_VERSION'
        )
    `);

    const [fva] = await this.dataSource.query(`
      SELECT
        ROUND(AVG(fill_rate_proxy)::numeric, 4)     AS avg_fill_rate_proxy,
        ROUND(AVG(variance_pct)::numeric, 2)        AS avg_variance_pct,
        COUNT(*) FILTER (WHERE status = 'WARNING')  AS warning_count,
        COUNT(*) FILTER (WHERE status = 'CRITICAL') AS critical_count,
        MAX(computed_at)                            AS last_computed_at
      FROM plan_actual_comparison
      WHERE comparison_type = 'FORECAST_VS_ACTUAL'
        AND computed_at = (
          SELECT MAX(computed_at) FROM plan_actual_comparison
          WHERE comparison_type = 'FORECAST_VS_ACTUAL'
        )
    `);

    return {
      forecast_version: {
        avg_variance_pct: Number(fv?.avg_variance_pct  ?? 0),
        avg_bias:         Number(fv?.avg_bias          ?? 0),
        warning_count:    Number(fv?.warning_count     ?? 0),
        critical_count:   Number(fv?.critical_count    ?? 0),
        last_computed_at: fv?.last_computed_at ?? null,
      },
      forecast_vs_actual: {
        avg_fill_rate_proxy: Number(fva?.avg_fill_rate_proxy ?? 0),
        avg_variance_pct:    Number(fva?.avg_variance_pct   ?? 0),
        warning_count:       Number(fva?.warning_count      ?? 0),
        critical_count:      Number(fva?.critical_count     ?? 0),
        mape_status:         'N_A',
        mape_note:           'BLOCKED: actual_sales table chưa tồn tại. Implement Phase 2.',
        last_computed_at:    fva?.last_computed_at ?? null,
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST COMPARISONS
  // ═══════════════════════════════════════════════════════════════════════════

  async listComparisons(query: ListComparisonQueryDto) {
    const page     = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const qb = this.repo.createQueryBuilder('p').orderBy('p.computed_at', 'DESC');

    if (query.comparisonType) qb.andWhere('p.comparison_type = :t',  { t: query.comparisonType });
    if (query.itemCode)       qb.andWhere('p.item_code ILIKE :ic',   { ic: `%${query.itemCode}%` });
    if (query.locationCode)   qb.andWhere('p.location_code = :lc',   { lc: query.locationCode });
    if (query.periodStart)    qb.andWhere('p.period_start >= :ps',   { ps: query.periodStart });
    if (query.status)         qb.andWhere('p.status = :s',           { s: query.status });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT CSV
  // ═══════════════════════════════════════════════════════════════════════════

  async exportCsv(query: ListComparisonQueryDto): Promise<Buffer> {
    const qb = this.repo.createQueryBuilder('p').orderBy('p.computed_at', 'DESC');
    if (query.comparisonType) qb.andWhere('p.comparison_type = :t',  { t: query.comparisonType });
    if (query.itemCode)       qb.andWhere('p.item_code ILIKE :ic',   { ic: `%${query.itemCode}%` });
    if (query.locationCode)   qb.andWhere('p.location_code = :lc',   { lc: query.locationCode });
    if (query.status)         qb.andWhere('p.status = :s',           { s: query.status });

    const rows = await qb.getMany();

    const headers = [
      'comparison_type', 'period_start', 'period_end', 'item_code', 'location_code',
      'plan_qty', 'actual_qty', 'variance_qty', 'variance_pct', 'fill_rate_proxy', 'status',
    ];

    const lines = rows.map(r => [
      r.comparisonType, r.periodStart, r.periodEnd, r.itemCode, r.locationCode,
      r.planQty ?? '', r.actualQty ?? '', r.varianceQty ?? '',
      r.variancePct ?? '', r.fillRateProxy ?? '', r.status,
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

    const csv = '\uFEFF' + [headers.join(','), ...lines].join('\r\n');
    return Buffer.from(csv, 'utf-8');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD DATASET
  // ═══════════════════════════════════════════════════════════════════════════

  async uploadDataset(file: Express.Multer.File, dto: UploadDatasetDto): Promise<object> {
    const raw: Buffer = file.buffer;
    let records: Record<string, string>[];

    try {
      records = csvParse(raw, { columns: true, skip_empty_lines: true, trim: true });
    } catch {
      throw new BadRequestException('CSV không hợp lệ — kiểm tra encoding và header');
    }

    const required = ['item_code', 'location_code', 'period_start', 'qty'];
    const headers  = Object.keys(records[0] ?? {});
    const missing  = required.filter(h => !headers.includes(h));
    if (missing.length) {
      throw new BadRequestException(`CSV thiếu cột: ${missing.join(', ')}`);
    }

    // Save dataset metadata first
    const dataset = await this.dsRepo.save({
      name:      dto.name,
      type:      dto.type,
      rowCount:  0,
      createdBy: dto.createdBy ?? null,
    });

    // Parse and bulk-insert lines in chunks
    const lines: Partial<PacUploadedLine>[] = [];
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const qty = parseFloat(r.qty);
      if (isNaN(qty)) {
        errors.push(`Row ${i + 2}: qty không hợp lệ ("${r.qty}")`);
        continue;
      }
      if (!r.item_code || !r.location_code || !r.period_start) {
        errors.push(`Row ${i + 2}: thiếu item_code/location_code/period_start`);
        continue;
      }
      lines.push({
        datasetId:    dataset.datasetId,
        itemCode:     r.item_code.trim(),
        locationCode: r.location_code.trim(),
        periodStart:  r.period_start.trim(),
        qty,
      });
    }

    // Chunk insert
    for (let i = 0; i < lines.length; i += INSERT_CHUNK_SIZE) {
      await this.lineRepo.save(lines.slice(i, i + INSERT_CHUNK_SIZE) as PacUploadedLine[]);
    }

    // Update row count
    await this.dsRepo.update(dataset.datasetId, { rowCount: lines.length });

    return {
      datasetId:   dataset.datasetId,
      name:        dataset.name,
      type:        dataset.type,
      rowCount:    lines.length,
      skippedRows: records.length - lines.length,
      errors:      errors.slice(0, 20),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIST UPLOADS
  // ═══════════════════════════════════════════════════════════════════════════

  async listUploads(type?: string): Promise<object> {
    const qb = this.dsRepo.createQueryBuilder('d').orderBy('d.created_at', 'DESC');
    if (type) qb.where('d.type = :type', { type });
    const data = await qb.getMany();
    return { data };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD_COMPARE compute
  // ═══════════════════════════════════════════════════════════════════════════

  private async _computeUploadCompare(dto: ComputeDto): Promise<object> {
    const [baseLines, compareLines] = await Promise.all([
      this._loadUploadLines(dto.uploadBaseId!),
      this._loadUploadLines(dto.uploadCompareId!),
    ]);

    if (!baseLines.length) {
      throw new BadRequestException('Base dataset rỗng hoặc không tồn tại');
    }

    const compareMap = new Map<string, number>();
    for (const l of compareLines) {
      compareMap.set(`${l.itemCode}|${l.locationCode}|${l.periodStart}`, l.qty);
    }

    const snapshots: Partial<PlanActualComparison>[] = [];

    for (const base of baseLines) {
      const compareQty = compareMap.get(`${base.itemCode}|${base.locationCode}|${base.periodStart}`) ?? null;
      const planQty    = base.qty;
      const actualQty  = compareQty;

      const varianceQty = actualQty != null ? actualQty - planQty : null;
      const variancePct = planQty !== 0 && varianceQty != null
        ? Math.round((varianceQty / planQty) * 10000) / 100
        : null;

      const absPct = variancePct != null ? Math.abs(variancePct) : 0;
      const status = variancePct == null ? 'N_A'
                   : absPct > CRITICAL_THRESHOLD ? 'CRITICAL'
                   : absPct > WARNING_THRESHOLD  ? 'WARNING'
                   : 'ON_TARGET';

      snapshots.push({
        comparisonType:    'UPLOAD_COMPARE',
        periodStart:       base.periodStart,
        periodEnd:         this._monthEnd(base.periodStart),
        periodType:        'MONTHLY',
        itemCode:          base.itemCode,
        locationCode:      base.locationCode,
        snapshotIdBase:    dto.uploadBaseId!,
        snapshotIdCompare: dto.uploadCompareId,
        planQty,
        actualQty,
        varianceQty,
        variancePct,
        fillRateProxy:     planQty > 0 && actualQty != null
                             ? Math.round((actualQty / planQty) * 10000) / 10000
                             : null,
        status,
        computedBy:        dto.computedBy ?? 'system',
      });
    }

    await this._saveChunked(snapshots);

    const warnings  = snapshots.filter(r => r.status === 'WARNING').length;
    const criticals = snapshots.filter(r => r.status === 'CRITICAL').length;
    return { computed: snapshots.length, warnings, criticals, comparison_type: 'UPLOAD_COMPARE' };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _saveChunked(snapshots: Partial<PlanActualComparison>[]): Promise<void> {
    for (let i = 0; i < snapshots.length; i += INSERT_CHUNK_SIZE) {
      await this.repo.save(snapshots.slice(i, i + INSERT_CHUNK_SIZE) as PlanActualComparison[]);
    }
  }

  // Load ALL lines of snapshot — no CURRENT_DATE filter (BUG-1 fix per spec)
  private async _loadSnapshotLines(snapshotId: string): Promise<SnapshotLine[]> {
    return this.dataSource.query(`
      SELECT
        dsl.item_code                              AS "itemCode",
        dsl.location_code                          AS "locationCode",
        dsl.period_start::text                     AS "periodStart",
        COALESCE(dsl.reconciled_qty, dsl.qty)::float AS qty
      FROM demand_snapshot_line dsl
      WHERE dsl.snapshot_id = $1
      ORDER BY dsl.period_start, dsl.item_code, dsl.location_code
    `, [snapshotId]);
  }

  private async _loadUploadLines(datasetId: string): Promise<SnapshotLine[]> {
    const rows = await this.lineRepo.find({
      where: { datasetId },
      order: { periodStart: 'ASC', itemCode: 'ASC', locationCode: 'ASC' },
    });
    return rows.map(r => ({
      itemCode:     r.itemCode,
      locationCode: r.locationCode,
      periodStart:  typeof r.periodStart === 'string' ? r.periodStart : (r.periodStart as Date).toISOString().slice(0, 10),
      qty:          Number(r.qty),
    }));
  }

  private _monthEnd(isoDate: string): string {
    const d   = new Date(isoDate);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return end.toISOString().slice(0, 10);
  }
}
