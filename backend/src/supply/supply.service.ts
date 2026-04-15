import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SupplySnapshot } from './entities/supply-snapshot.entity';
import { SupplySnapshotLine } from './entities/supply-snapshot-line.entity';
import { LotAttribute } from './entities/lot-attribute.entity';
import { GetLinesQueryDto } from './dto/get-lines-query.dto';
import { paginate, skipTake } from '../common/pagination.util';
import { PaginatedResponse } from '../common/pagination.dto';

const STALE_THRESHOLD_MINUTES = 240;
const BATCH_CHUNK = 500;

export interface CaptureSnapshotDto {
  snapshotName: string;
  includeInTransit?: boolean;
  autoFreeze?: boolean;
  createdBy?: string;
  locationCodes?: string[];   // Phase B: filter by location (undefined = tất cả)
}

export interface FreshnessStatus {
  overallFreshness: 'PASS' | 'STALE' | 'NO_DATA';
  oldestSync: Date | null;
  newestSync: Date | null;
  ageMinutes: number;
  thresholdMinutes: number;
  staleLocations: string[];
}

@Injectable()
export class SupplyService {
  constructor(
    @InjectRepository(SupplySnapshot)
    private readonly snapshotRepo: Repository<SupplySnapshot>,
    @InjectRepository(SupplySnapshotLine)
    private readonly lineRepo: Repository<SupplySnapshotLine>,
    @InjectRepository(LotAttribute)
    private readonly lotRepo: Repository<LotAttribute>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Capture Snapshot ───────────────────────────────────────────────────────

  async captureSnapshot(dto: CaptureSnapshotDto): Promise<SupplySnapshot> {
    const { snapshotName, includeInTransit = true, autoFreeze = false, createdBy, locationCodes } = dto;

    // Aggregate lot_attribute into per-(item_code, location_code) lines
    const hasLocationFilter = locationCodes && locationCodes.length > 0;
    const aggregated: {
      item_code: string;
      location_code: string;
      allocatable_qty: string;
      reserved_qty: string;
      quarantine_qty: string;
      in_transit_qty: string;
      oldest_sync_at: Date | null;
    }[] = await this.dataSource.query(
      `SELECT
         item_code,
         location_code,
         GREATEST(0, SUM(on_hand_qty) - SUM(reserved_qty))::numeric(15,2)  AS allocatable_qty,
         SUM(reserved_qty)::numeric(15,2)                                   AS reserved_qty,
         SUM(quarantine_qty)::numeric(15,2)                                 AS quarantine_qty,
         ${includeInTransit ? 'SUM(in_transit_qty)' : '0'}::numeric(15,2)  AS in_transit_qty,
         MIN(last_sync_at)                                                  AS oldest_sync_at
       FROM lot_attribute
       WHERE quality_status = 'ALLOCATABLE'
         ${hasLocationFilter ? 'AND location_code = ANY($1)' : ''}
       GROUP BY item_code, location_code`,
      hasLocationFilter ? [locationCodes] : [],
    );

    if (aggregated.length === 0) {
      throw new BadRequestException('No allocatable lot_attribute records found to snapshot');
    }

    const now = new Date();

    // Compute freshness per line
    const linesData = aggregated.map((row) => {
      const oldestSyncAt = row.oldest_sync_at ? new Date(row.oldest_sync_at) : null;
      let freshness: 'PASS' | 'STALE' = 'PASS';
      if (oldestSyncAt) {
        const ageMs = now.getTime() - oldestSyncAt.getTime();
        const ageMin = ageMs / 60000;
        if (ageMin > STALE_THRESHOLD_MINUTES) {
          freshness = 'STALE';
        }
      } else {
        freshness = 'STALE';
      }
      return {
        itemCode: row.item_code,
        locationCode: row.location_code,
        allocatableQty: parseFloat(row.allocatable_qty),
        reservedQty: parseFloat(row.reserved_qty),
        quarantineQty: parseFloat(row.quarantine_qty),
        inTransitQty: parseFloat(row.in_transit_qty),
        oldestSyncAt,
        freshness,
        isEstimated: false,
      };
    });

    // Snapshot-level aggregates
    const totalLines = linesData.length;
    const totalItems = new Set(linesData.map((l) => l.itemCode)).size;
    const totalLocations = new Set(linesData.map((l) => l.locationCode)).size;
    const totalAllocatableQty = linesData.reduce((s, l) => s + l.allocatableQty, 0);
    const totalReservedQty = linesData.reduce((s, l) => s + l.reservedQty, 0);
    const totalInTransitQty = linesData.reduce((s, l) => s + l.inTransitQty, 0);
    const staleLines = linesData.filter((l) => l.freshness === 'STALE').length;
    const snapshotFreshness: 'PASS' | 'STALE' = staleLines > 0 ? 'STALE' : 'PASS';

    // Oldest sync for snapshot-level age
    const oldestSync = linesData
      .map((l) => l.oldestSyncAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    const freshnessAgeMinutes = oldestSync
      ? Math.floor((now.getTime() - oldestSync.getTime()) / 60000)
      : 0;

    // Persist snapshot header + lines inside a single transaction
    // If any chunk fails → full rollback → no orphan snapshot header
    const savedId = await this.dataSource.transaction(async (em) => {
      // 1. Insert snapshot header
      const snapshot = em.create(SupplySnapshot, {
        snapshotName,
        status: 'DRAFT',
        freshness: snapshotFreshness,
        freshnessAgeMinutes,
        totalLines,
        totalItems,
        totalLocations,
        totalAllocatableQty,
        totalReservedQty,
        totalInTransitQty,
        estimatedLinesCount: 0,
        staleAcknowledged: false,
        captureAt: now,
        createdBy: createdBy ?? undefined,
      });
      const savedSnap = await em.save(SupplySnapshot, snapshot) as SupplySnapshot;

      // 2. Batch-insert lines in chunks of BATCH_CHUNK
      for (let start = 0; start < linesData.length; start += BATCH_CHUNK) {
        const chunk = linesData.slice(start, start + BATCH_CHUNK);
        const lineEntities = chunk.map((l) => {
          const line = new SupplySnapshotLine();
          line.snapshotId = savedSnap.id;
          line.itemCode = l.itemCode;
          line.locationCode = l.locationCode;
          line.allocatableQty = l.allocatableQty;
          line.reservedQty = l.reservedQty;
          line.quarantineQty = l.quarantineQty;
          line.inTransitQty = l.inTransitQty;
          line.oldestSyncAt = l.oldestSyncAt ?? null;
          line.freshness = l.freshness;
          line.isEstimated = l.isEstimated;
          return line;
        });
        await em.save(SupplySnapshotLine, lineEntities);
      }

      return savedSnap.id;
    });

    if (autoFreeze) {
      return this.freezeSnapshot(savedId, createdBy);
    }

    return this.snapshotRepo.findOne({ where: { id: savedId } }) as Promise<SupplySnapshot>;
  }

  // ─── Freeze Snapshot ────────────────────────────────────────────────────────

  async freezeSnapshot(id: string, frozenBy?: string): Promise<SupplySnapshot> {
    const snapshot = await this.findSnapshotOrFail(id);

    if (snapshot.status === 'FROZEN') {
      throw new BadRequestException(`Snapshot ${id} is already FROZEN`);
    }
    if (snapshot.status === 'ARCHIVED') {
      throw new BadRequestException(`Snapshot ${id} is ARCHIVED and cannot be frozen`);
    }
    if (snapshot.freshness === 'STALE' && !snapshot.staleAcknowledged) {
      throw new BadRequestException(
        `Snapshot ${id} is STALE — acknowledge stale data before freezing`,
      );
    }

    snapshot.status = 'FROZEN';
    snapshot.frozenAt = new Date();
    if (frozenBy) snapshot.frozenBy = frozenBy;

    return this.snapshotRepo.save(snapshot);
  }

  // ─── Archive Snapshot ───────────────────────────────────────────────────────

  async archiveSnapshot(id: string, archivedBy?: string): Promise<SupplySnapshot> {
    const snapshot = await this.findSnapshotOrFail(id);
    if (snapshot.status === 'DRAFT') {
      throw new BadRequestException(`Snapshot ${id} is DRAFT — freeze first before archiving`);
    }
    if (snapshot.status === 'ARCHIVED') {
      throw new BadRequestException(`Snapshot ${id} is already ARCHIVED`);
    }
    snapshot.status = 'ARCHIVED';
    if (archivedBy) snapshot.frozenBy = archivedBy; // reuse field for audit
    return this.snapshotRepo.save(snapshot);
  }

  // ─── Acknowledge Stale ──────────────────────────────────────────────────────

  async acknowledgeStale(id: string, reason: string, userId?: string): Promise<SupplySnapshot> {
    const snapshot = await this.findSnapshotOrFail(id);

    if (snapshot.freshness !== 'STALE') {
      throw new BadRequestException(`Snapshot ${id} freshness is PASS — no acknowledgment needed`);
    }

    snapshot.staleAcknowledged = true;
    if (userId) snapshot.staleAcknowledgedBy = userId;
    snapshot.staleAcknowledgedAt = new Date();
    snapshot.staleReason = reason;

    return this.snapshotRepo.save(snapshot);
  }

  // ─── Override Line ──────────────────────────────────────────────────────────

  async overrideLine(
    lineId: string,
    qty: number,
    reason: string,
    userId?: string,
  ): Promise<SupplySnapshotLine> {
    const line = await this.lineRepo.findOne({
      where: { id: lineId },
      relations: ['snapshot'],
    });

    if (!line) {
      throw new NotFoundException(`Snapshot line ${lineId} not found`);
    }

    const allowedStatuses: ('DRAFT' | 'FROZEN')[] = ['DRAFT', 'FROZEN'];
    if (!allowedStatuses.includes(line.snapshot.status as any)) {
      throw new BadRequestException(
        `Cannot override line on snapshot with status '${line.snapshot.status}'`,
      );
    }

    if (qty < 0) {
      throw new BadRequestException('Override qty must be >= 0');
    }

    line.overrideQty = qty;
    line.overrideReason = reason;
    if (userId) line.overrideBy = userId;
    line.overrideAt = new Date();

    return this.lineRepo.save(line);
  }

  // ─── Freshness Status ────────────────────────────────────────────────────────

  async getFreshnessStatus(): Promise<FreshnessStatus> {
    const aggResult: { oldest_sync_at: Date | null; newest_sync_at: Date | null; total_lines: string }[] =
      await this.dataSource.query(
        `SELECT MIN(last_sync_at) AS oldest_sync_at,
                MAX(last_sync_at) AS newest_sync_at,
                COUNT(*) AS total_lines
         FROM lot_attribute WHERE quality_status = 'ALLOCATABLE'`,
      );

    const agg = aggResult[0];
    const totalLines = parseInt(agg.total_lines ?? '0', 10);

    if (totalLines === 0) {
      return {
        overallFreshness: 'NO_DATA',
        oldestSync: null,
        newestSync: null,
        ageMinutes: 0,
        thresholdMinutes: STALE_THRESHOLD_MINUTES,
        staleLocations: [],
      };
    }

    const oldestSync = agg.oldest_sync_at ? new Date(agg.oldest_sync_at) : null;
    const newestSync = agg.newest_sync_at ? new Date(agg.newest_sync_at) : null;
    const ageMinutes = oldestSync
      ? Math.floor((Date.now() - oldestSync.getTime()) / 60000)
      : 0;

    // Collect stale location_codes (those where last_sync_at is beyond threshold)
    const staleRows: { location_code: string }[] = await this.dataSource.query(
      `SELECT DISTINCT location_code FROM lot_attribute
       WHERE quality_status = 'ALLOCATABLE'
         AND EXTRACT(EPOCH FROM (NOW() - last_sync_at)) / 60 > $1`,
      [STALE_THRESHOLD_MINUTES],
    );

    const staleLocations = staleRows.map((r) => r.location_code);
    const overallFreshness: 'PASS' | 'STALE' = staleLocations.length > 0 ? 'STALE' : 'PASS';

    return {
      overallFreshness,
      oldestSync,
      newestSync,
      ageMinutes,
      thresholdMinutes: STALE_THRESHOLD_MINUTES,
      staleLocations,
    };
  }

  // ─── List Snapshots ──────────────────────────────────────────────────────────

  async listSnapshots(): Promise<SupplySnapshot[]> {
    return this.snapshotRepo.find({
      order: { captureAt: 'DESC' },
      take: 30,
    });
  }

  // ─── Get Snapshot ────────────────────────────────────────────────────────────

  async getSnapshot(id: string): Promise<SupplySnapshot> {
    return this.findSnapshotOrFail(id);
  }

  // ─── Get Snapshot Lines (paginated) ─────────────────────────────────────────

  async getSnapshotLines(
    id: string,
    params: GetLinesQueryDto,
  ): Promise<PaginatedResponse<SupplySnapshotLine>> {
    // Ensure snapshot exists
    await this.findSnapshotOrFail(id);

    const { page, pageSize, itemCode, locationCode, freshness, estimated } = params;
    const { skip, take } = skipTake(page, pageSize);

    const qb = this.lineRepo
      .createQueryBuilder('line')
      .where('line.snapshot_id = :id', { id });

    if (itemCode) {
      qb.andWhere('line.item_code ILIKE :itemCode', { itemCode: `%${itemCode}%` });
    }

    if (locationCode) {
      qb.andWhere('line.location_code ILIKE :locationCode', { locationCode: `%${locationCode}%` });
    }

    if (freshness) {
      qb.andWhere('line.freshness = :freshness', { freshness });
    }

    if (estimated === 'oem') {
      qb.andWhere('line.is_estimated = false');
    } else if (estimated === 'estimated') {
      qb.andWhere('line.is_estimated = true');
    }

    qb.orderBy('line.item_code', 'ASC').addOrderBy('line.location_code', 'ASC');
    qb.skip(skip).take(take);

    const [data, total] = await qb.getManyAndCount();

    return paginate(data, total, page, pageSize);
  }

  // ─── Grouped views (server-side aggregation) ─────────────────────────────────

  async getGroupedByItem(
    id: string,
    params: { page: number; pageSize: number; itemCode?: string },
  ) {
    await this.findSnapshotOrFail(id);
    const { page, pageSize, itemCode } = params;
    const offset = (page - 1) * pageSize;

    const where = itemCode ? `AND item_code ILIKE $3` : '';
    const args: any[] = itemCode ? [id, pageSize, `%${itemCode}%`] : [id, pageSize];

    const rows: any[] = await this.dataSource.query(
      `SELECT
         item_code                                                               AS "itemCode",
         COUNT(DISTINCT location_code)                                          AS "locationCount",
         SUM(COALESCE(override_qty, allocatable_qty))::numeric(15,2)           AS "allocatableQty",
         SUM(reserved_qty)::numeric(15,2)                                      AS "reservedQty",
         SUM(in_transit_qty)::numeric(15,2)                                    AS "inTransitQty",
         BOOL_OR(freshness = 'STALE')                                          AS "hasStale",
         BOOL_OR(override_qty IS NOT NULL)                                     AS "hasOverride"
       FROM supply_snapshot_line
       WHERE snapshot_id = $1 ${where}
       GROUP BY item_code
       ORDER BY item_code ASC
       LIMIT $2 OFFSET ${offset}`,
      args,
    );

    const countArgs: any[] = itemCode ? [id, `%${itemCode}%`] : [id];
    const countWhere = itemCode ? `AND item_code ILIKE $2` : '';
    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT item_code) AS total FROM supply_snapshot_line WHERE snapshot_id = $1 ${countWhere}`,
      countArgs,
    );
    const total = parseInt(countRows[0].total, 10);

    return {
      data: rows.map((r) => ({
        itemCode: r.itemCode,
        locationCount: parseInt(r.locationCount, 10),
        allocatableQty: parseFloat(r.allocatableQty),
        reservedQty: parseFloat(r.reservedQty),
        inTransitQty: parseFloat(r.inTransitQty),
        hasStale: r.hasStale,
        hasOverride: r.hasOverride,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getGroupedByLocation(
    id: string,
    params: { page: number; pageSize: number; locationCode?: string },
  ) {
    await this.findSnapshotOrFail(id);
    const { page, pageSize, locationCode } = params;
    const offset = (page - 1) * pageSize;

    const where = locationCode ? `AND location_code ILIKE $3` : '';
    const args: any[] = locationCode ? [id, pageSize, `%${locationCode}%`] : [id, pageSize];

    const rows: any[] = await this.dataSource.query(
      `SELECT
         l.location_code                                                        AS "locationCode",
         loc.location_name                                                      AS "locationName",
         COUNT(DISTINCT l.item_code)                                            AS "itemCount",
         SUM(COALESCE(l.override_qty, l.allocatable_qty))::numeric(15,2)       AS "allocatableQty",
         SUM(l.reserved_qty)::numeric(15,2)                                    AS "reservedQty",
         SUM(l.in_transit_qty)::numeric(15,2)                                  AS "inTransitQty",
         BOOL_OR(l.freshness = 'STALE')                                        AS "hasStale",
         BOOL_OR(l.override_qty IS NOT NULL)                                   AS "hasOverride"
       FROM supply_snapshot_line l
       LEFT JOIN location loc ON loc.location_code = l.location_code
       WHERE l.snapshot_id = $1 ${where}
       GROUP BY l.location_code, loc.location_name
       ORDER BY l.location_code ASC
       LIMIT $2 OFFSET ${offset}`,
      args,
    );

    const countArgs: any[] = locationCode ? [id, `%${locationCode}%`] : [id];
    const countWhere = locationCode ? `AND location_code ILIKE $2` : '';
    const countRows: any[] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT location_code) AS total FROM supply_snapshot_line WHERE snapshot_id = $1 ${countWhere}`,
      countArgs,
    );
    const total = parseInt(countRows[0].total, 10);

    return {
      data: rows.map((r) => ({
        locationCode: r.locationCode,
        locationName: r.locationName ?? null,
        itemCount: parseInt(r.itemCount, 10),
        allocatableQty: parseFloat(r.allocatableQty),
        reservedQty: parseFloat(r.reservedQty),
        inTransitQty: parseFloat(r.inTransitQty),
        hasStale: r.hasStale,
        hasOverride: r.hasOverride,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  // ─── Snapshot Stats ──────────────────────────────────────────────────────────

  async getSnapshotStats(id: string): Promise<{
    qtyByLocation: { locationCode: string; allocatableQty: number; lineCount: number }[];
    stockBreakdown: { zero: number; low: number; normal: number };
    sourceBreakdown: { oem: number; estimated: number };
    topItems: { itemCode: string; allocatableQty: number }[];
  }> {
    await this.findSnapshotOrFail(id);

    const [qtyByLocRaw, stockRaw, sourceRaw, topItemsRaw] = await Promise.all([
      // Top 15 locations by total allocatable qty
      this.dataSource.query(
        `SELECT location_code AS "locationCode",
                SUM(COALESCE(override_qty, allocatable_qty))::numeric(15,2) AS "allocatableQty",
                COUNT(*) AS "lineCount"
         FROM supply_snapshot_line
         WHERE snapshot_id = $1
         GROUP BY location_code
         ORDER BY "allocatableQty" DESC
         LIMIT 15`,
        [id],
      ),
      // Stock breakdown: zero / low (>0 and <=10) / normal (>10)
      this.dataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE COALESCE(override_qty, allocatable_qty) = 0)  AS zero,
           COUNT(*) FILTER (WHERE COALESCE(override_qty, allocatable_qty) > 0
                              AND COALESCE(override_qty, allocatable_qty) <= 10) AS low,
           COUNT(*) FILTER (WHERE COALESCE(override_qty, allocatable_qty) > 10)  AS normal
         FROM supply_snapshot_line
         WHERE snapshot_id = $1`,
        [id],
      ),
      // Source breakdown: estimated vs OEM lines
      this.dataSource.query(
        `SELECT
           COUNT(*) FILTER (WHERE is_estimated = false) AS oem,
           COUNT(*) FILTER (WHERE is_estimated = true)  AS estimated
         FROM supply_snapshot_line
         WHERE snapshot_id = $1`,
        [id],
      ),
      // Top 10 items by total allocatable qty
      this.dataSource.query(
        `SELECT item_code AS "itemCode",
                SUM(COALESCE(override_qty, allocatable_qty))::numeric(15,2) AS "allocatableQty"
         FROM supply_snapshot_line
         WHERE snapshot_id = $1
         GROUP BY item_code
         ORDER BY "allocatableQty" DESC
         LIMIT 10`,
        [id],
      ),
    ]);

    const stock = stockRaw[0];
    const src = sourceRaw[0];

    return {
      qtyByLocation: qtyByLocRaw.map((r: any) => ({
        locationCode: r.locationCode,
        allocatableQty: parseFloat(r.allocatableQty),
        lineCount: parseInt(r.lineCount, 10),
      })),
      stockBreakdown: {
        zero: parseInt(stock.zero, 10),
        low: parseInt(stock.low, 10),
        normal: parseInt(stock.normal, 10),
      },
      sourceBreakdown: {
        oem: parseInt(src.oem, 10),
        estimated: parseInt(src.estimated, 10),
      },
      topItems: topItemsRaw.map((r: any) => ({
        itemCode: r.itemCode,
        allocatableQty: parseFloat(r.allocatableQty),
      })),
    };
  }

  // ─── BE-A3: Meta — distinct locations từ lot_attribute ───────────────────────

  async getMetaLocations(): Promise<{ locations: Array<{ locationCode: string; itemCount: number; totalAllocatable: number }> }> {
    const rows = await this.dataSource.query(`
      SELECT
        location_code        AS "locationCode",
        COUNT(DISTINCT item_code)::int                         AS "itemCount",
        COALESCE(SUM(GREATEST(0, on_hand_qty - reserved_qty)), 0)::numeric(15,2) AS "totalAllocatable"
      FROM lot_attribute
      WHERE quality_status = 'ALLOCATABLE'
      GROUP BY location_code
      ORDER BY location_code
    `);
    return { locations: rows };
  }

  // ─── BE-A4: Meta — items thuộc location filter ────────────────────────────────

  async getMetaItems(locationCodes?: string[]): Promise<{ items: Array<{ itemCode: string; locationCount: number; totalAllocatable: number }> }> {
    const rows = await this.dataSource.query(`
      SELECT
        item_code            AS "itemCode",
        COUNT(DISTINCT location_code)::int                     AS "locationCount",
        COALESCE(SUM(GREATEST(0, on_hand_qty - reserved_qty)), 0)::numeric(15,2) AS "totalAllocatable"
      FROM lot_attribute
      WHERE quality_status = 'ALLOCATABLE'
        AND ($1::text[] IS NULL OR location_code = ANY($1::text[]))
      GROUP BY item_code
      ORDER BY item_code
    `, [locationCodes && locationCodes.length > 0 ? locationCodes : null]);
    return { items: rows };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async findSnapshotOrFail(id: string): Promise<SupplySnapshot> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) {
      throw new NotFoundException(`Snapshot ${id} not found`);
    }
    return snapshot;
  }
}
