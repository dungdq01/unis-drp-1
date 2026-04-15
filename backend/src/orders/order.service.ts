import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { OrderBatch } from './entities/order-batch.entity';
import { OrderLine } from './entities/order-line.entity';
import { UNIS_ORDER_CONFIG } from './order.config';
import {
  CreateOrderBatchDto, ListBatchesQueryDto, ListLinesQueryDto,
  SubmitBatchDto, ApproveBatchDto, RejectBatchDto, UpdateOrderLineDto,
} from './dto';

// ─── Internal types ───────────────────────────────────────────────────────────

interface TripLineRow {
  tripLineId: string;
  tripId: string;
  allocationResultId: string;
  itemCode: string;
  itemName: string | null;
  baseUom: string;
  qty: number;
  sourceLocationCode: string;
  destLocationCode: string;
  departureDate: string | null;
  etaDate: string | null;
  carrierCode: string | null;
}

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderBatch) private readonly batchRepo: Repository<OrderBatch>,
    @InjectRepository(OrderLine)  private readonly lineRepo:  Repository<OrderLine>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH: CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  async createBatch(dto: CreateOrderBatchDto): Promise<OrderBatch> {
    // 1. Validate transport_plan tồn tại và đã CONFIRMED
    const planRows: { status: string }[] = await this.dataSource.query(
      `SELECT status FROM transport_plan WHERE id = $1::bigint`,
      [dto.transportPlanId],
    );
    if (!planRows.length)
      throw new NotFoundException(`transport_plan ${dto.transportPlanId} not found`);
    if (planRows[0].status !== 'CONFIRMED')
      throw new ConflictException(`transport_plan status=${planRows[0].status}. Chỉ CONFIRMED plan mới tạo được order batch.`);

    // 2. Duplicate check
    const existing = await this.batchRepo.findOne({ where: { transportPlanId: dto.transportPlanId } });
    if (existing)
      throw new ConflictException(`Order batch đã tồn tại cho plan này (batch_id=${existing.id}, code=${existing.batchCode})`);

    // 3. Load trip lines (chỉ PLANNED trips)
    const tripLines = await this._loadTripLines(dto.transportPlanId);
    if (tripLines.length === 0)
      throw new BadRequestException('Không có trip lines nào để tạo order. Kiểm tra transport_trip status=PLANNED.');

    // 4. Generate batch_code (atomic sequence, no race condition)
    const batchCode = await this._nextBatchCode();

    // 5. Create batch header
    const batch = await this.batchRepo.save(
      this.batchRepo.create({
        transportPlanId: dto.transportPlanId,
        batchCode,
        status: 'DRAFT',
        createdBy: dto.createdBy ?? null,
        note: dto.note ?? null,
      }),
    );

    // 6. Bulk insert order lines
    const lines = tripLines.map((tl, idx) => {
      const seq = String(idx + 1).padStart(UNIS_ORDER_CONFIG.lineSeqPad, '0');
      return this.lineRepo.create({
        orderBatchId: batch.id,
        orderNo: `${batchCode}-L${seq}`,
        orderType: 'TO',
        sourceLocationCode: tl.sourceLocationCode,
        destLocationCode: tl.destLocationCode,
        itemCode: tl.itemCode,
        itemName: tl.itemName,
        baseUom: tl.baseUom ?? 'M2',
        qty: tl.qty,
        unitPriceVnd: 0,
        totalValueVnd: 0, // Phase 1: price = 0
        departureDate: tl.departureDate,
        etaDate: tl.etaDate,
        carrierCode: tl.carrierCode,
        transportTripId: tl.tripId,
        allocationResultId: tl.allocationResultId,
        status: 'ACTIVE',
      });
    });

    const CHUNK = UNIS_ORDER_CONFIG.insertChunkSize;
    for (let i = 0; i < lines.length; i += CHUNK) {
      await this.lineRepo.save(lines.slice(i, i + CHUNK));
    }

    // 7. Update batch totals
    const totalQty = tripLines.reduce((s, l) => s + Number(l.qty), 0);
    await this.batchRepo.update(batch.id, {
      totalLines: lines.length,
      totalQty: Math.round(totalQty * 100) / 100,
      totalValueVnd: 0,
    });

    return this.batchRepo.findOne({ where: { id: batch.id } }) as Promise<OrderBatch>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // APPROVAL FLOW
  // ═══════════════════════════════════════════════════════════════════════════

  async submitBatch(id: string, dto: SubmitBatchDto): Promise<OrderBatch> {
    const batch = await this._getBatch(id);
    if (batch.status !== 'DRAFT')
      throw new ConflictException(`Batch status=${batch.status}. Chỉ DRAFT mới submit được.`);

    const activeCount = await this.lineRepo.count({ where: { orderBatchId: id, status: 'ACTIVE' } });
    if (activeCount === 0)
      throw new BadRequestException('Không có order line ACTIVE nào. Không thể submit batch rỗng.');

    batch.status = 'SUBMITTED';
    batch.submittedBy = dto.submittedBy ?? null;
    batch.submittedAt = new Date();
    if (dto.note) batch.note = dto.note;
    return this.batchRepo.save(batch);
  }

  async approveBatch(id: string, dto: ApproveBatchDto): Promise<OrderBatch> {
    const batch = await this._getBatch(id);
    if (batch.status !== 'SUBMITTED')
      throw new ConflictException(`Batch status=${batch.status}. Chỉ SUBMITTED mới approve được.`);

    batch.status = 'APPROVED';
    batch.approvedBy = dto.approvedBy ?? null;
    batch.approvedAt = new Date();
    if (dto.note) batch.note = dto.note;
    return this.batchRepo.save(batch);
  }

  async rejectBatch(id: string, dto: RejectBatchDto): Promise<OrderBatch> {
    const batch = await this._getBatch(id);
    if (batch.status !== 'SUBMITTED')
      throw new ConflictException(`Batch status=${batch.status}. Chỉ SUBMITTED mới reject được.`);

    batch.status = 'DRAFT';
    batch.rejectedBy = dto.rejectedBy ?? null;
    batch.rejectedAt = new Date();
    batch.rejectReason = dto.rejectReason;
    // Reset submit fields để submit lại được
    batch.submittedBy = null;
    batch.submittedAt = null;
    return this.batchRepo.save(batch);
  }

  async cancelBatch(id: string, cancelledBy?: string): Promise<OrderBatch> {
    const batch = await this._getBatch(id);
    if (batch.status === 'EXPORTED')
      throw new ConflictException('Batch đã EXPORTED — không thể cancel.');
    if (batch.status === 'CANCELLED')
      throw new ConflictException('Batch đã CANCELLED.');

    batch.status = 'CANCELLED';
    batch.note = `Cancelled by ${cancelledBy ?? 'system'} at ${new Date().toISOString()}`;
    return this.batchRepo.save(batch);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT CSV
  // ═══════════════════════════════════════════════════════════════════════════

  async exportCsv(id: string, exportedBy?: string): Promise<{ filename: string; content: Buffer }> {
    const batch = await this._getBatch(id);
    if (batch.status !== 'APPROVED')
      throw new ConflictException(`Batch status=${batch.status}. Chỉ APPROVED mới export được.`);

    const lines = await this.lineRepo.find({
      where: { orderBatchId: id, status: 'ACTIVE' },
      order: { orderNo: 'ASC' },
    });

    const header = [
      'order_no', 'order_type', 'batch_code',
      'source_location_code', 'dest_location_code',
      'item_code', 'item_name', 'base_uom',
      'qty', 'unit_price_vnd', 'total_value_vnd',
      'departure_date', 'eta_date',
      'carrier_code', 'erp_ref', 'status',
    ].join(',');

    const rows = lines.map(l => [
      l.orderNo,
      l.orderType,
      batch.batchCode,
      l.sourceLocationCode,
      l.destLocationCode,
      l.itemCode,
      `"${(l.itemName ?? '').replace(/"/g, '""')}"`,
      l.baseUom,
      l.qty,
      l.unitPriceVnd,
      l.totalValueVnd,
      l.departureDate ?? '',
      l.etaDate ?? '',
      l.carrierCode ?? '',
      l.erpRef ?? '',
      l.status,
    ].join(','));

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `orders_${batch.batchCode}_${dateStr}.csv`;

    // UTF-8 BOM + header + rows
    const csvText = '\uFEFF' + [header, ...rows].join('\n');
    const content = Buffer.from(csvText, 'utf8');

    // Mark batch as EXPORTED
    await this.batchRepo.update(id, {
      status: 'EXPORTED',
      exportedBy: exportedBy ?? null,
      exportedAt: new Date(),
    });

    return { filename, content };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ
  // ═══════════════════════════════════════════════════════════════════════════

  async listBatches(query: ListBatchesQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);

    const qb = this.batchRepo.createQueryBuilder('b').orderBy('b.created_at', 'DESC');
    if (query.status) qb.andWhere('b.status = :st', { st: query.status });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getBatch(id: string): Promise<OrderBatch> {
    return this._getBatch(id);
  }

  async listLines(batchId: string, query: ListLinesQueryDto) {
    await this._getBatch(batchId);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 50, 200);

    const qb = this.lineRepo.createQueryBuilder('l')
      .where('l.order_batch_id = :bid', { bid: batchId })
      .orderBy('l.order_no', 'ASC');

    if (query.itemCode)           qb.andWhere('l.item_code ILIKE :ic',  { ic: `%${query.itemCode}%` });
    if (query.sourceLocationCode) qb.andWhere('l.source_location_code ILIKE :src', { src: `%${query.sourceLocationCode}%` });
    if (query.destLocationCode)   qb.andWhere('l.dest_location_code ILIKE :dst',   { dst: `%${query.destLocationCode}%` });
    if (query.status)             qb.andWhere('l.status = :st',         { st: query.status });
    if (query.orderType)          qb.andWhere('l.order_type = :ot',     { ot: query.orderType });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async updateLine(lineId: string, dto: UpdateOrderLineDto): Promise<OrderLine> {
    const line = await this.lineRepo.findOne({ where: { id: lineId } });
    if (!line) throw new NotFoundException(`order_line ${lineId} not found`);

    // [BIZ] Cancel line chỉ khi batch còn DRAFT/SUBMITTED
    if (dto.status === 'CANCELLED') {
      const batch = await this._getBatch(line.orderBatchId);
      if (!['DRAFT', 'SUBMITTED'].includes(batch.status))
        throw new ConflictException(`Batch status=${batch.status}. Chỉ DRAFT/SUBMITTED mới cancel line được.`);
    }

    if (dto.unitPriceVnd !== undefined) {
      line.unitPriceVnd = dto.unitPriceVnd;
      line.totalValueVnd = Math.round(Number(line.qty) * dto.unitPriceVnd * 100) / 100;
    }
    if (dto.erpRef  !== undefined) line.erpRef  = dto.erpRef;
    if (dto.note    !== undefined) line.note    = dto.note;
    if (dto.status  !== undefined) line.status  = dto.status;

    const saved = await this.lineRepo.save(line);

    if (dto.unitPriceVnd !== undefined || dto.status !== undefined) {
      await this._recalcBatchValue(line.orderBatchId);
    }

    return saved;
  }

  async getStats(): Promise<object> {
    const [stats] = await this.dataSource.query(`
      SELECT
        COUNT(*)                                     AS total_batches,
        COUNT(*) FILTER (WHERE status = 'DRAFT')     AS draft,
        COUNT(*) FILTER (WHERE status = 'SUBMITTED') AS submitted,
        COUNT(*) FILTER (WHERE status = 'APPROVED')  AS approved,
        COUNT(*) FILTER (WHERE status = 'EXPORTED')  AS exported,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
        COALESCE(SUM(total_lines),0)                 AS total_lines,
        COALESCE(SUM(total_qty),0)                   AS total_qty,
        COALESCE(SUM(total_value_vnd),0)             AS total_value_vnd
      FROM order_batch
    `);
    return stats;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _getBatch(id: string): Promise<OrderBatch> {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) throw new NotFoundException(`order_batch ${id} not found`);
    return batch;
  }

  /**
   * Atomic batch_code generation: TO-YYYYMM-XXXX
   * ON CONFLICT upsert ensures no race condition under concurrent requests.
   */
  private async _nextBatchCode(): Promise<string> {
    const monthKey = new Date().toISOString().slice(0, 7).replace('-', ''); // '202604'

    const result: { last_seq: number }[] = await this.dataSource.query(`
      INSERT INTO order_batch_seq (month_key, last_seq)
      VALUES ($1, 1)
      ON CONFLICT (month_key) DO UPDATE
        SET last_seq = order_batch_seq.last_seq + 1
      RETURNING last_seq
    `, [monthKey]);

    const seq = String(result[0].last_seq).padStart(4, '0');
    return `${UNIS_ORDER_CONFIG.batchCodePrefix}-${monthKey}-${seq}`;
  }

  /**
   * Load all trip lines từ transport_plan.
   * Chỉ lấy trips có status=PLANNED — bỏ qua NO_CARRIER trips.
   */
  private async _loadTripLines(transportPlanId: string): Promise<TripLineRow[]> {
    return this.dataSource.query(`
      SELECT
        ttl.id::text                    AS "tripLineId",
        ttl.transport_trip_id::text     AS "tripId",
        ttl.allocation_result_id::text  AS "allocationResultId",
        ttl.item_code                   AS "itemCode",
        i.item_name                     AS "itemName",
        COALESCE(i.base_uom, 'M2')      AS "baseUom",
        ttl.allocated_qty::float        AS "qty",
        tt.source_location_code         AS "sourceLocationCode",
        tt.dest_location_code           AS "destLocationCode",
        tt.departure_date::text         AS "departureDate",
        tt.eta_date::text               AS "etaDate",
        tt.carrier_code                 AS "carrierCode"
      FROM transport_trip_line ttl
      JOIN transport_trip tt   ON tt.id = ttl.transport_trip_id
      JOIN transport_plan tp   ON tp.id = tt.transport_plan_id
      LEFT JOIN item i         ON i.item_code = ttl.item_code
      WHERE tp.id = $1::bigint
        AND tt.status = 'PLANNED'
      ORDER BY tt.source_location_code, tt.dest_location_code, ttl.item_code
    `, [transportPlanId]);
  }

  private async _recalcBatchValue(batchId: string): Promise<void> {
    await this.dataSource.query(`
      UPDATE order_batch SET
        total_value_vnd = (
          SELECT COALESCE(SUM(total_value_vnd), 0)
          FROM order_line
          WHERE order_batch_id = $1::bigint AND status = 'ACTIVE'
        ),
        total_lines = (
          SELECT COUNT(*) FROM order_line
          WHERE order_batch_id = $1::bigint AND status = 'ACTIVE'
        ),
        updated_at = NOW()
      WHERE id = $1::bigint
    `, [batchId]);
  }
}
