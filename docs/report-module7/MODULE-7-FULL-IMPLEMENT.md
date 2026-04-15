# Module 7 — Order Bridge: Full Implementation Guide

> **Version:** 1.0 | **Date:** 2026-04-15
> **Stack:** NestJS 10 · TypeORM · PostgreSQL · Next.js 14
> **Port BE:** 3002 | **Prefix:** `/orders`
> **Depends on:** Module 6 (transport_plan CONFIRMED, transport_trip, transport_trip_line)

---

## 0. Tổng quan

Order Bridge nhận output từ Transport Planning (M6) và tạo lệnh xuất kho / lệnh chuyển hàng (Transfer Order) để đẩy sang ERP:

```
transport_plan (status = CONFIRMED)
       │
       ▼
  Step 1: Generate order_batch (1 plan = 1 batch)
       │  batch_code = TO-YYYYMM-XXXX (auto-sequence)
       ▼
  Step 2: Flatten transport_trip_line → order_line
       │  order_type = TO (Transfer Order) — Phase 1
       │  order_no   = {batch_code}-L{seq}
       ▼
  Step 3: Approval flow
       │  DRAFT → SUBMITTED → APPROVED
       │                   ↓ REJECTED → DRAFT
       ▼
  Step 4: Export CSV (ERP-compatible)
       │  trigger: APPROVED → EXPORTED
       ▼
  ERP nhận file → ghi erp_ref vào từng order_line
```

---

## 1. UNIS Constraints

```
1. PK types — tất cả BIGSERIAL (BIGINT), KHÔNG dùng UUID.

2. Location / Item keys — VARCHAR, không phải UUID:
   - source_location_code  VARCHAR(20)  — từ location.location_code
   - dest_location_code    VARCHAR(20)
   - item_code             VARCHAR(50)  — từ item.item_code

3. NO tenant_id — bỏ khỏi tất cả bảng.

4. Location types thực tế (từ DB):
   - WAREHOUSE  — kho trung tâm (HUBR00001..N)
   - BRANCH     — chi nhánh/đại lý (001..N)

5. Order type — Phase 1: chỉ TO (Transfer Order).
   - SO (Sales Order) / PO (Purchase Order) → Phase 2.
   - TO = mọi chuyển động giữa locations (WAREHOUSE→BRANCH, BRANCH→BRANCH, BRANCH→BRANCH self).
   - Self-fulfillment (source = dest): vẫn tạo TO, ERP xử lý như Pick Order nội bộ.

6. Auth — Phase 1: KHÔNG có JWT/middleware auth.
   - submitted_by, approved_by, exported_by là VARCHAR(100) truyền từ request body.
   - Phase 2: thêm JWT guard sau khi tích hợp IAM.

7. State machine (order_batch.status):
   DRAFT → SUBMITTED → APPROVED → EXPORTED
                     ↓ (reject)
                   DRAFT  (lines giữ nguyên, có thể edit)
   APPROVED → CANCELLED (chỉ trước khi EXPORTED)
   EXPORTED → không thể cancel

8. Consolidation — OFF:
   - 1 transport_plan_id = 1 order_batch (UNIQUE constraint).
   - Không merge nhiều plan vào 1 batch.

9. ERP ref — Phase 1: ghi thủ công bằng PATCH /orders/lines/:id.
   Phase 2: webhook/API callback từ ERP tự điền.

10. CSV export format — cố định 16 cột (xem §11).
    - UTF-8 BOM để Excel mở đúng tiếng Việt.
    - Tên file: orders_{batch_code}_{YYYYMMDD}.csv
```

---

## 2. DB Schema

### Migration: `001_create_order_tables.sql`

```sql
BEGIN;

-- ── order_batch ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_batch (
    id                  BIGSERIAL    PRIMARY KEY,
    transport_plan_id   BIGINT       NOT NULL UNIQUE REFERENCES transport_plan(id),
    batch_code          VARCHAR(30)  NOT NULL UNIQUE,
      -- format: TO-YYYYMM-XXXX, e.g. TO-202604-0001
    status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
      -- DRAFT | SUBMITTED | APPROVED | EXPORTED | CANCELLED
    total_lines         INT          NOT NULL DEFAULT 0,
    total_qty           DECIMAL(18,2) NOT NULL DEFAULT 0,
    total_value_vnd     DECIMAL(18,2) NOT NULL DEFAULT 0,
      -- sum of order_line.total_value_vnd
    submitted_by        VARCHAR(100),
    submitted_at        TIMESTAMP,
    approved_by         VARCHAR(100),
    approved_at         TIMESTAMP,
    rejected_by         VARCHAR(100),
    rejected_at         TIMESTAMP,
    reject_reason       TEXT,
    exported_by         VARCHAR(100),
    exported_at         TIMESTAMP,
    note                TEXT,
    created_by          VARCHAR(100),
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_batch_plan   ON order_batch(transport_plan_id);
CREATE INDEX IF NOT EXISTS idx_order_batch_status ON order_batch(status);
CREATE INDEX IF NOT EXISTS idx_order_batch_code   ON order_batch(batch_code);

-- ── order_batch_seq (counter per YYYYMM) ─────────────────────────────────────
-- Dùng để generate batch_code TO-YYYYMM-XXXX mà không bị race condition.
CREATE TABLE IF NOT EXISTS order_batch_seq (
    month_key   CHAR(6)  NOT NULL PRIMARY KEY,
      -- e.g. '202604'
    last_seq    INT      NOT NULL DEFAULT 0
);

-- ── order_line ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_line (
    id                      BIGSERIAL    PRIMARY KEY,
    order_batch_id          BIGINT       NOT NULL REFERENCES order_batch(id),
    order_no                VARCHAR(40)  NOT NULL UNIQUE,
      -- format: {batch_code}-L{seq 4-digit}, e.g. TO-202604-0001-L0001
    order_type              VARCHAR(10)  NOT NULL DEFAULT 'TO',
      -- TO | SO | PO (Phase 1: TO only)
    source_location_code    VARCHAR(20)  NOT NULL,
    dest_location_code      VARCHAR(20)  NOT NULL,
    item_code               VARCHAR(50)  NOT NULL,
    item_name               VARCHAR(500),
      -- snapshot từ item.item_name lúc generate, không join lại sau
    base_uom                VARCHAR(20)  NOT NULL DEFAULT 'M2',
    qty                     DECIMAL(15,2) NOT NULL DEFAULT 0,
    unit_price_vnd          DECIMAL(15,2) NOT NULL DEFAULT 0,
      -- Phase 1: để 0, DA nhập sau; Phase 2: từ price list
    total_value_vnd         DECIMAL(18,2) NOT NULL DEFAULT 0,
      -- = qty × unit_price_vnd
    departure_date          DATE,
      -- copy từ transport_trip.departure_date
    eta_date                DATE,
    carrier_code            VARCHAR(20),
    transport_trip_id       BIGINT       REFERENCES transport_trip(id),
    allocation_result_id    BIGINT       REFERENCES allocation_result(id),
    status                  VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
      -- ACTIVE | CANCELLED
    erp_ref                 VARCHAR(50),
      -- ERP document number sau khi sync (Phase 1: ghi thủ công)
    note                    TEXT,
    created_at              TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_line_batch  ON order_line(order_batch_id);
CREATE INDEX IF NOT EXISTS idx_order_line_item   ON order_line(item_code);
CREATE INDEX IF NOT EXISTS idx_order_line_source ON order_line(source_location_code);
CREATE INDEX IF NOT EXISTS idx_order_line_dest   ON order_line(dest_location_code);
CREATE INDEX IF NOT EXISTS idx_order_line_status ON order_line(status);
CREATE INDEX IF NOT EXISTS idx_order_line_erp    ON order_line(erp_ref) WHERE erp_ref IS NOT NULL;

COMMIT;
```

---

## 3. Entities

### `entities/order-batch.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('order_batch')
export class OrderBatch {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transport_plan_id', type: 'bigint', unique: true })
  transportPlanId: string;

  @Column({ name: 'batch_code', type: 'varchar', length: 30, unique: true })
  batchCode: string;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'EXPORTED' | 'CANCELLED';

  @Column({ name: 'total_lines', type: 'int', default: 0 })
  totalLines: number;

  @Column({ name: 'total_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalQty: number;

  @Column({ name: 'total_value_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalValueVnd: number;

  @Column({ name: 'submitted_by', type: 'varchar', length: 100, nullable: true, default: null })
  submittedBy: string | null;

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true, default: null })
  submittedAt: Date | null;

  @Column({ name: 'approved_by', type: 'varchar', length: 100, nullable: true, default: null })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamp', nullable: true, default: null })
  approvedAt: Date | null;

  @Column({ name: 'rejected_by', type: 'varchar', length: 100, nullable: true, default: null })
  rejectedBy: string | null;

  @Column({ name: 'rejected_at', type: 'timestamp', nullable: true, default: null })
  rejectedAt: Date | null;

  @Column({ name: 'reject_reason', type: 'text', nullable: true, default: null })
  rejectReason: string | null;

  @Column({ name: 'exported_by', type: 'varchar', length: 100, nullable: true, default: null })
  exportedBy: string | null;

  @Column({ name: 'exported_at', type: 'timestamp', nullable: true, default: null })
  exportedAt: Date | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### `entities/order-line.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('order_line')
export class OrderLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'order_batch_id', type: 'bigint' })
  orderBatchId: string;

  @Column({ name: 'order_no', type: 'varchar', length: 40, unique: true })
  orderNo: string;

  @Column({ name: 'order_type', type: 'varchar', length: 10, default: 'TO' })
  orderType: 'TO' | 'SO' | 'PO';

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'item_name', type: 'varchar', length: 500, nullable: true, default: null })
  itemName: string | null;

  @Column({ name: 'base_uom', type: 'varchar', length: 20, default: 'M2' })
  baseUom: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  qty: number;

  @Column({ name: 'unit_price_vnd', type: 'decimal', precision: 15, scale: 2, default: 0 })
  unitPriceVnd: number;

  @Column({ name: 'total_value_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalValueVnd: number;

  @Column({ name: 'departure_date', type: 'date', nullable: true, default: null })
  departureDate: string | null;

  @Column({ name: 'eta_date', type: 'date', nullable: true, default: null })
  etaDate: string | null;

  @Column({ name: 'carrier_code', type: 'varchar', length: 20, nullable: true, default: null })
  carrierCode: string | null;

  @Column({ name: 'transport_trip_id', type: 'bigint', nullable: true, default: null })
  transportTripId: string | null;

  @Column({ name: 'allocation_result_id', type: 'bigint', nullable: true, default: null })
  allocationResultId: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: 'ACTIVE' | 'CANCELLED';

  @Column({ name: 'erp_ref', type: 'varchar', length: 50, nullable: true, default: null })
  erpRef: string | null;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

---

## 4. Config

### `order.config.ts`

```typescript
export const UNIS_ORDER_CONFIG = {
  // Phase 1: chỉ tạo TO. SO/PO thêm ở Phase 2 khi có customer/supplier master.
  enabledOrderTypes: ['TO'] as const,

  // Batch code format: TO-{YYYYMM}-{seq 4-digit zero-padded}
  batchCodePrefix: 'TO',

  // Order line numbering: {batch_code}-L{seq 4-digit}
  // e.g. TO-202604-0001-L0001
  lineSeqPad: 4,

  // CSV export: UTF-8 BOM để Excel đọc tiếng Việt đúng
  csvBom: true,

  // Tên file export: orders_{batch_code}_{YYYYMMDD}.csv
  csvFilenamePattern: 'orders_{batchCode}_{date}.csv',

  // Chunk size khi bulk insert order_line
  insertChunkSize: 500,

  // Phase 1: không check duplicate erp_ref (ERP có thể trả nhiều ref cho 1 line)
  allowDuplicateErpRef: true,
} as const;
```

---

## 5. DTOs

### `dto/index.ts`

```typescript
import { IsString, IsOptional, IsIn, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto';

// ── POST /orders/batches ───────────────────────────────────────────────────────
export class CreateOrderBatchDto {
  @IsString()
  transportPlanId: string;

  @IsOptional() @IsString()
  createdBy?: string;

  @IsOptional() @IsString()
  note?: string;
}

// ── GET /orders/batches ────────────────────────────────────────────────────────
export class ListBatchesQueryDto extends PaginationDto {
  @IsOptional() @IsIn(['DRAFT', 'SUBMITTED', 'APPROVED', 'EXPORTED', 'CANCELLED'])
  status?: string;
}

// ── GET /orders/batches/:id/lines ──────────────────────────────────────────────
export class ListLinesQueryDto extends PaginationDto {
  @IsOptional() @IsString()
  itemCode?: string;

  @IsOptional() @IsString()
  sourceLocationCode?: string;

  @IsOptional() @IsString()
  destLocationCode?: string;

  @IsOptional() @IsIn(['ACTIVE', 'CANCELLED'])
  status?: string;

  @IsOptional() @IsIn(['TO', 'SO', 'PO'])
  orderType?: string;
}

// ── POST /orders/batches/:id/submit ───────────────────────────────────────────
export class SubmitBatchDto {
  @IsOptional() @IsString()
  submittedBy?: string;

  @IsOptional() @IsString()
  note?: string;
}

// ── POST /orders/batches/:id/approve ──────────────────────────────────────────
export class ApproveBatchDto {
  @IsOptional() @IsString()
  approvedBy?: string;

  @IsOptional() @IsString()
  note?: string;
}

// ── POST /orders/batches/:id/reject ───────────────────────────────────────────
export class RejectBatchDto {
  @IsOptional() @IsString()
  rejectedBy?: string;

  @IsString()
  rejectReason: string;
  // [BIZ] rejectReason bắt buộc — không cho phép reject không ghi lý do
}

// ── PATCH /orders/lines/:id ────────────────────────────────────────────────────
// Cho phép: cập nhật unit_price, erp_ref, note, cancel line
export class UpdateOrderLineDto {
  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  unitPriceVnd?: number;

  @IsOptional() @IsString()
  erpRef?: string;

  @IsOptional() @IsString()
  note?: string;

  @IsOptional() @IsIn(['ACTIVE', 'CANCELLED'])
  status?: 'ACTIVE' | 'CANCELLED';
  // [BIZ] Cancel line chỉ khi batch.status IN (DRAFT, SUBMITTED)
  // APPROVED/EXPORTED: không cancel line đơn lẻ
}
```

---

## 6. Service

### `order.service.ts`

```typescript
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
    const [planRow]: { status: string }[] = await this.dataSource.query(
      `SELECT status FROM transport_plan WHERE id = $1::bigint`,
      [dto.transportPlanId],
    );
    if (!planRow)
      throw new NotFoundException(`transport_plan ${dto.transportPlanId} not found`);
    if (planRow.status !== 'CONFIRMED')
      throw new ConflictException(`transport_plan status=${planRow.status}. Chỉ CONFIRMED plan mới tạo được order batch.`);

    // 2. Duplicate check
    const existing = await this.batchRepo.findOne({ where: { transportPlanId: dto.transportPlanId } });
    if (existing)
      throw new ConflictException(`Order batch đã tồn tại cho plan này (batch_id=${existing.id}, code=${existing.batchCode})`);

    // 3. Load trip lines
    const tripLines = await this._loadTripLines(dto.transportPlanId);
    if (tripLines.length === 0)
      throw new BadRequestException('Không có trip lines nào để tạo order. Kiểm tra transport_trip status=PLANNED.');

    // 4. Generate batch_code (transactional sequence)
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
      const totalValue = Number(tl.qty) * 0; // unit_price = 0 Phase 1
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
        totalValueVnd: totalValue,
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

    // Validate: phải có ít nhất 1 ACTIVE line
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
    // Reset submit fields để có thể submit lại
    batch.submittedBy = null;
    batch.submittedAt = null;
    return this.batchRepo.save(batch);
  }

  async cancelBatch(id: string, cancelledBy?: string): Promise<OrderBatch> {
    const batch = await this._getBatch(id);
    if (batch.status === 'EXPORTED')
      throw new ConflictException(`Batch đã EXPORTED — không thể cancel.`);
    if (batch.status === 'CANCELLED')
      throw new ConflictException(`Batch đã CANCELLED.`);

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

    // Load all ACTIVE lines
    const lines = await this.lineRepo.find({
      where: { orderBatchId: id, status: 'ACTIVE' },
      order: { orderNo: 'ASC' },
    });

    // Build CSV
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

    if (query.itemCode)          qb.andWhere('l.item_code ILIKE :ic', { ic: `%${query.itemCode}%` });
    if (query.sourceLocationCode) qb.andWhere('l.source_location_code ILIKE :src', { src: `%${query.sourceLocationCode}%` });
    if (query.destLocationCode)   qb.andWhere('l.dest_location_code ILIKE :dst', { dst: `%${query.destLocationCode}%` });
    if (query.status)             qb.andWhere('l.status = :st', { st: query.status });
    if (query.orderType)          qb.andWhere('l.order_type = :ot', { ot: query.orderType });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async updateLine(lineId: string, dto: UpdateOrderLineDto): Promise<OrderLine> {
    const line = await this.lineRepo.findOne({ where: { id: lineId } });
    if (!line) throw new NotFoundException(`order_line ${lineId} not found`);

    // Business rule: cancel line chỉ khi batch còn DRAFT/SUBMITTED
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

    // Recalc batch totalValueVnd nếu có thay đổi price/cancel
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
   * Tạo batch_code dạng TO-YYYYMM-XXXX, đảm bảo unique và sequential
   * bằng cách lock row trong order_batch_seq.
   */
  private async _nextBatchCode(): Promise<string> {
    const monthKey = new Date().toISOString().slice(0, 7).replace('-', ''); // '202604'

    const result = await this.dataSource.query(`
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
   * Load tất cả trip lines từ transport_plan, chỉ lấy trip status=PLANNED.
   * Bỏ qua trip status=NO_CARRIER (không có carrier → không export ERP).
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
```

---

## 7. Controller

### `order.controller.ts`

```typescript
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  Res, HttpCode, HttpStatus, ParseIntPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrderService } from './order.service';
import {
  CreateOrderBatchDto, ListBatchesQueryDto, ListLinesQueryDto,
  SubmitBatchDto, ApproveBatchDto, RejectBatchDto, UpdateOrderLineDto,
} from './dto';

@ApiTags('orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly svc: OrderService) {}

  // ── Stats (dashboard KPI) ────────────────────────────────────────────────

  @Get('stats')
  @ApiOperation({ summary: 'Tổng quan order batches (KPI dashboard)' })
  getStats() { return this.svc.getStats(); }

  // ── Batches ───────────────────────────────────────────────────────────────

  @Post('batches')
  @ApiOperation({ summary: 'Generate order batch từ transport_plan_id (CONFIRMED)' })
  createBatch(@Body() dto: CreateOrderBatchDto) {
    return this.svc.createBatch(dto);
  }

  @Get('batches')
  @ApiOperation({ summary: 'List order batches (paginated, filter by status)' })
  listBatches(@Query() query: ListBatchesQueryDto) {
    return this.svc.listBatches(query);
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Get order batch detail' })
  getBatch(@Param('id') id: string) {
    return this.svc.getBatch(id);
  }

  // ── Approval flow ─────────────────────────────────────────────────────────

  @Post('batches/:id/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit batch: DRAFT → SUBMITTED (gửi duyệt)' })
  submitBatch(@Param('id') id: string, @Body() dto: SubmitBatchDto) {
    return this.svc.submitBatch(id, dto);
  }

  @Post('batches/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve batch: SUBMITTED → APPROVED' })
  approveBatch(@Param('id') id: string, @Body() dto: ApproveBatchDto) {
    return this.svc.approveBatch(id, dto);
  }

  @Post('batches/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject batch: SUBMITTED → DRAFT (kèm lý do)' })
  rejectBatch(@Param('id') id: string, @Body() dto: RejectBatchDto) {
    return this.svc.rejectBatch(id, dto);
  }

  @Delete('batches/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel batch (không thể cancel sau EXPORTED)' })
  cancelBatch(
    @Param('id') id: string,
    @Query('cancelledBy') cancelledBy?: string,
  ) {
    return this.svc.cancelBatch(id, cancelledBy);
  }

  // ── Lines ─────────────────────────────────────────────────────────────────

  @Get('batches/:id/lines')
  @ApiOperation({ summary: 'List order lines (paginated, filter by item/location/status)' })
  listLines(@Param('id') id: string, @Query() query: ListLinesQueryDto) {
    return this.svc.listLines(id, query);
  }

  @Patch('lines/:id')
  @ApiOperation({ summary: 'Update order line: unit_price, erp_ref, note, cancel' })
  updateLine(@Param('id') id: string, @Body() dto: UpdateOrderLineDto) {
    return this.svc.updateLine(id, dto);
  }

  // ── Export CSV ────────────────────────────────────────────────────────────

  @Post('batches/:id/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export batch → CSV (APPROVED → EXPORTED)' })
  async exportCsv(
    @Param('id') id: string,
    @Query('exportedBy') exportedBy: string | undefined,
    @Res() res: Response,
  ) {
    const { filename, content } = await this.svc.exportCsv(id, exportedBy);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }
}
```

---

## 8. Module

### `order.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderBatch } from './entities/order-batch.entity';
import { OrderLine } from './entities/order-line.entity';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderBatch, OrderLine]),
  ],
  providers: [OrderService],
  controllers: [OrderController],
  exports: [OrderService],
})
export class OrderModule {}
```

> **NOTE:** Register `OrderModule` trong `app.module.ts`. Không cần MulterModule (không có file upload).

---

## 9. UNIS Errors mới (thêm vào `common/errors.ts`)

```typescript
ORDER_BATCH_NOT_FOUND:      { code: 'UNIS-ERR-018', msg: 'Order batch not found',                 status: 404 },
ORDER_BATCH_WRONG_STATUS:   { code: 'UNIS-ERR-019', msg: 'Order batch status không hợp lệ',       status: 409 },
ORDER_LINE_NOT_FOUND:       { code: 'UNIS-ERR-020', msg: 'Order line not found',                  status: 404 },
ORDER_PLAN_NOT_CONFIRMED:   { code: 'UNIS-ERR-021', msg: 'Transport plan chưa CONFIRMED',          status: 409 },
ORDER_BATCH_DUPLICATE:      { code: 'UNIS-ERR-022', msg: 'Order batch đã tồn tại cho plan này',   status: 409 },
ORDER_REJECT_REASON_EMPTY:  { code: 'UNIS-ERR-023', msg: 'Lý do reject không được để trống',      status: 400 },
ORDER_EXPORT_NOT_APPROVED:  { code: 'UNIS-ERR-024', msg: 'Chỉ APPROVED batch mới export được',    status: 409 },
```

---

## 10. Frontend — `lib/api/order.ts`

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(p: string) { return `${BASE_URL}/api/v1${p}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'EXPORTED' | 'CANCELLED';
export type LineStatus  = 'ACTIVE' | 'CANCELLED';
export type OrderType   = 'TO' | 'SO' | 'PO';

export interface OrderBatch {
  id: string;
  transportPlanId: string;
  batchCode: string;
  status: BatchStatus;
  totalLines: number;
  totalQty: number;
  totalValueVnd: number;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
  exportedBy: string | null;
  exportedAt: string | null;
  createdBy: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLine {
  id: string;
  orderBatchId: string;
  orderNo: string;
  orderType: OrderType;
  sourceLocationCode: string;
  destLocationCode: string;
  itemCode: string;
  itemName: string | null;
  baseUom: string;
  qty: number;
  unitPriceVnd: number;
  totalValueVnd: number;
  departureDate: string | null;
  etaDate: string | null;
  carrierCode: string | null;
  transportTripId: string | null;
  allocationResultId: string | null;
  status: LineStatus;
  erpRef: string | null;
  note: string | null;
  createdAt: string;
}

export interface OrderStats {
  total_batches: string;
  draft: string;
  submitted: string;
  approved: string;
  exported: string;
  cancelled: string;
  total_lines: string;
  total_qty: string;
  total_value_vnd: string;
}

export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number; }

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchOrderStats = () =>
  fetch(apiUrl('/orders/stats'), { cache: 'no-store' })
    .then(r => handleRes<OrderStats>(r));

export const createOrderBatch = (transportPlanId: string, createdBy?: string) =>
  fetch(apiUrl('/orders/batches'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transportPlanId, createdBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const fetchOrderBatches = (page = 1, pageSize = 20, status?: string) => {
  const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) q.set('status', status);
  return fetch(apiUrl(`/orders/batches?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: OrderBatch[]; meta: PageMeta }>(r));
};

export const fetchOrderBatch = (id: string) =>
  fetch(apiUrl(`/orders/batches/${id}`), { cache: 'no-store' })
    .then(r => handleRes<OrderBatch>(r));

export const fetchOrderLines = (batchId: string, params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/orders/batches/${batchId}/lines?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: OrderLine[]; meta: PageMeta }>(r));
};

export const submitBatch = (id: string, submittedBy?: string) =>
  fetch(apiUrl(`/orders/batches/${id}/submit`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submittedBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const approveBatch = (id: string, approvedBy?: string) =>
  fetch(apiUrl(`/orders/batches/${id}/approve`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvedBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const rejectBatch = (id: string, rejectReason: string, rejectedBy?: string) =>
  fetch(apiUrl(`/orders/batches/${id}/reject`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rejectReason, rejectedBy }),
  }).then(r => handleRes<OrderBatch>(r));

export const cancelBatch = (id: string, cancelledBy?: string) => {
  const q = cancelledBy ? `?cancelledBy=${encodeURIComponent(cancelledBy)}` : '';
  return fetch(apiUrl(`/orders/batches/${id}${q}`), { method: 'DELETE' })
    .then(r => handleRes<OrderBatch>(r));
};

export const updateOrderLine = (lineId: string, body: {
  unitPriceVnd?: number; erpRef?: string; note?: string; status?: LineStatus;
}) =>
  fetch(apiUrl(`/orders/lines/${lineId}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => handleRes<OrderLine>(r));

export const exportBatchCsv = async (id: string, exportedBy?: string): Promise<void> => {
  const q = exportedBy ? `?exportedBy=${encodeURIComponent(exportedBy)}` : '';
  const res = await fetch(apiUrl(`/orders/batches/${id}/export${q}`), { method: 'POST' });
  if (!res.ok) { const t = await res.text(); throw new Error(`Export failed: ${t}`); }
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition') ?? '';
  const filenameMatch = cd.match(/filename="([^"]+)"/);
  const filename = filenameMatch?.[1] ?? `orders_${id}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};
```

---

## 11. CSV Export Format

### Columns (16 cố định — đúng thứ tự)

| # | Column | Source | Example |
|---|--------|--------|---------|
| 1 | `order_no` | order_line.order_no | `TO-202604-0001-L0001` |
| 2 | `order_type` | order_line.order_type | `TO` |
| 3 | `batch_code` | order_batch.batch_code | `TO-202604-0001` |
| 4 | `source_location_code` | order_line | `001` |
| 5 | `dest_location_code` | order_line | `014` |
| 6 | `item_code` | order_line | `40.L1.3060.UGC3600` |
| 7 | `item_name` | snapshot lúc generate | `Gạch 30x60 UGC3600 L1` |
| 8 | `base_uom` | item.base_uom | `M2` |
| 9 | `qty` | order_line.qty | `918.00` |
| 10 | `unit_price_vnd` | 0 Phase 1, nhập tay Phase 2 | `0` |
| 11 | `total_value_vnd` | qty × price | `0` |
| 12 | `departure_date` | trip.departure_date | `2026-04-16` |
| 13 | `eta_date` | trip.eta_date | `2026-04-17` |
| 14 | `carrier_code` | trip.carrier_code | `VTA-001` |
| 15 | `erp_ref` | ghi thủ công Phase 1 | (trống) |
| 16 | `status` | order_line.status | `ACTIVE` |

### Notes
- Encoding: **UTF-8 BOM** (`\uFEFF`) — bắt buộc để Excel Windows đọc đúng.
- Delimiter: `,` (comma).
- `item_name` wrap double-quote nếu có dấu phẩy/quote.
- File download qua browser `<a>` tag (FE tự trigger, không cần server-sent stream).

---

## 12. State Machine Detail

```
                    ┌─────────────────────────────────────────────┐
                    │              order_batch.status              │
                    └─────────────────────────────────────────────┘

  createBatch()          submitBatch()       approveBatch()     exportCsv()
  ────────────           ─────────────       ──────────────     ───────────
     DRAFT    ──────────▶  SUBMITTED  ──────▶  APPROVED  ──────▶  EXPORTED
               (validate:              (manager            (marks batch,
               ≥1 ACTIVE line)          approves)           downloads CSV)
                    │
                    │ rejectBatch() → reason bắt buộc
                    ▼
                  DRAFT  (reset submittedBy/At, giữ nguyên lines)

  cancelBatch() có thể dùng từ: DRAFT | SUBMITTED | APPROVED
  cancelBatch() KHÔNG thể dùng từ: EXPORTED

  updateLine():
    - unitPriceVnd: any status
    - erpRef, note: any status
    - status=CANCELLED: chỉ khi batch IN (DRAFT, SUBMITTED)
```

---

## 13. Task Checklist

### Prerequisites

```
P1  [ ] transport_plan #1 cần CONFIRM trước (PATCH /transport/plans/1/confirm)
P2  [ ] Verify trip status = PLANNED (không phải NO_CARRIER) — có trip lines mới tạo được order
```

### Backend

```
BE-1  [ ] Tạo src/orders/
BE-2  [ ] Tạo 2 entity files: order-batch, order-line
BE-3  [ ] Chạy migration 001_create_order_tables.sql
BE-4  [ ] Thêm UNIS-ERR-018..024 vào common/errors.ts
BE-5  [ ] Tạo order.config.ts
BE-6  [ ] Tạo dto/index.ts
BE-7  [ ] Tạo order.service.ts
BE-8  [ ] Tạo order.controller.ts
BE-9  [ ] Tạo order.module.ts
BE-10 [ ] Register OrderModule trong app.module.ts
BE-11 [ ] npm run build — không có TS error
BE-12 [ ] Swagger test: POST /orders/batches với transportPlanId hợp lệ (CONFIRMED)
BE-13 [ ] Verify: GET /orders/batches/:id/lines trả đúng item_name (snapshot)
BE-14 [ ] Verify: POST /orders/batches/:id/export download CSV, batch → EXPORTED
BE-15 [ ] Verify: POST /orders/batches/:id/reject kèm rejectReason → batch về DRAFT
```

### Frontend

```
FE-1  [ ] Tạo lib/api/order.ts
FE-2  [ ] Tạo app/execution/page.tsx (hoặc app/order-bridge/page.tsx)
FE-3  [ ] KPI row: total_batches, draft, submitted, approved, exported
FE-4  [ ] Batch list (history sidebar) + Create form (dropdown CONFIRMED plans)
FE-5  [ ] Batch detail: approval action bar (Submit / Approve / Reject / Export)
FE-6  [ ] Reject modal: input rejectReason (bắt buộc)
FE-7  [ ] Lines table: paginated, filter item/location
FE-8  [ ] Export button → trigger file download via exportBatchCsv()
FE-9  [ ] PATCH line: inline edit erpRef field khi batch = EXPORTED
```

### QA

```
QA-1  [ ] E2E: Confirm plan → Create batch → Submit → Approve → Export CSV
QA-2  [ ] Reject flow: Submit → Reject (có reason) → về DRAFT → Submit lại → Approve
QA-3  [ ] Cancel: DRAFT cancel → 409 nếu EXPORTED
QA-4  [ ] Duplicate: tạo batch 2 lần cùng plan → 409 ConflictException
QA-5  [ ] Empty batch: plan không có PLANNED trips → 400 BadRequestException
QA-6  [ ] CSV: mở file bằng Excel → check UTF-8 BOM, tiếng Việt đúng, 16 columns
QA-7  [ ] Cancel line: cancel 1 line khi APPROVED → 409; khi DRAFT → OK
QA-8  [ ] updateLine erpRef: ghi erp_ref thủ công sau export → 200 OK
```

---

## 14. DA Tasks (không cần code)

```sql
-- Confirm transport_plan để tạo được order batch
UPDATE transport_plan SET status = 'CONFIRMED', confirmed_by = 'planner', confirmed_at = NOW()
WHERE id = 1;

-- Verify: trip lines tồn tại và có PLANNED status
SELECT tt.status, COUNT(ttl.id) AS lines
FROM transport_trip tt
JOIN transport_trip_line ttl ON ttl.transport_trip_id = tt.id
WHERE tt.transport_plan_id = 1
GROUP BY tt.status;
-- Kết quả mong đợi: PLANNED | 45+ lines
```

---

## 15. Phase 2 Scope (OUT OF SCOPE Phase 1)

| Feature | Lý do defer |
|---------|------------|
| SO (Sales Order) | Cần customer master + price list — chưa có trong schema |
| PO (Purchase Order) | Cần supplier + procurement flow |
| JWT auth guard | Cần IAM service integration |
| ERP webhook callback | Cần ERP endpoint đăng ký |
| unit_price từ price list | Cần product pricing table |
| Partial export (chọn line) | Complexity cao, Phase 1 export all |
| Reopen EXPORTED batch | Business approval chưa defined |
| 2-tier approval (CN_APPROVED + MGR_APPROVED states) | Phase 1 no-auth → 1 approve step; Phase 2 tách CN_WH approve + SC_MANAGER approve theo BA spec §4.1 |
