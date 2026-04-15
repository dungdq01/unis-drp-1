# MODULE 2: SUPPLY SNAPSHOT — BẢN IMPLEMENT HOÀN CHỈNH A→Z

**Date:** 2026-04-13 (v1.2 — Bug fixes: VARCHAR lengths, FK policy, header normalize)
**Author:** Tech Lead
**Mục đích:** Dev đọc file này → biết chính xác cần build gì, ở đâu, thứ tự nào
**BA Spec ref:** `docs/02-supply-snapshot.md` (SCP-UNIS-02 v1.0)

---

## ⚠️ UNIS CONSTRAINTS — ĐỌC TRƯỚC KHI CODE

```
1. KHÔNG có tenant_id: UNIS single-tenant — bỏ tất cả WHERE tenant_id = :x
   BA spec có tenant_id → BỎ HOÀN TOÀN

2. item_code VARCHAR (không phải item_id BIGINT):
   FK: item_code VARCHAR → item.item_code
   BA spec dùng item_id BIGINT → SỬA THÀNH item_code VARCHAR

3. location_code VARCHAR (không phải location_id BIGINT):
   FK: location_code VARCHAR → location.location_code
   BA spec dùng location_id BIGINT → SỬA THÀNH location_code VARCHAR

4. API prefix: /api/v1/supply/...
   Không có /api/v1/tenant/:id/supply/...

5. Tech stack:
   Backend:  NestJS 10 + TypeORM + PostgreSQL
   Frontend: Next.js 14 + TailwindCSS
   File:     src/supply/ (NestJS module mới, đăng ký trong app.module.ts)

6. supply_snapshot.id dùng BIGSERIAL (không phải UUID như demand_snapshot):
   - Giữ nguyên BIGINT Phase 1 — đơn giản hơn.
   - Module 4 (DRP) sẽ cần: demand_snapshot_id UUID + supply_snapshot_id BIGINT — ghi nhớ khi viết schema Module 4.
   - Nếu muốn đổi sang UUID: làm ở Module 4, không làm ngược lại ở Module 2.
```

---

## KIẾN TRÚC MODULE

```
Module 2 nhận input từ: Bravo ERP batch export (Excel/CSV)
Module 2 output cho:    Module 4 (DRP Netting) — supply_snapshot_line.allocatable_qty

Flow:
  [Bravo Export] → [Upload] → [Parse + Map] → [Upsert lot_attribute]
       → [Trigger Capture] → [Aggregate] → [Freshness Check]
       → [Create supply_snapshot] → [Freeze] → [DRP reads]

Page: /supply
  Tab 1: Snapshot Overview (danh sách snapshots + KPIs)
  Tab 2: Inventory Detail (matrix item × location)
```

---

## DATABASE SCHEMA

### Table: supply_snapshot

```sql
CREATE TABLE supply_snapshot (
    id                      BIGSERIAL PRIMARY KEY,
    snapshot_name           VARCHAR(200)    NOT NULL,
    status                  VARCHAR(20)     NOT NULL DEFAULT 'DRAFT',
      -- DRAFT | FROZEN | ARCHIVED
    freshness               VARCHAR(10)     NOT NULL DEFAULT 'PASS',
      -- PASS | STALE
    freshness_age_minutes   INT             NOT NULL DEFAULT 0,
    total_lines             INT             NOT NULL DEFAULT 0,
    total_items             INT             NOT NULL DEFAULT 0,
    total_locations         INT             NOT NULL DEFAULT 0,
    total_allocatable_qty   DECIMAL(18,2)   NOT NULL DEFAULT 0,
    total_reserved_qty      DECIMAL(18,2)   NOT NULL DEFAULT 0,
    total_in_transit_qty    DECIMAL(18,2)   NOT NULL DEFAULT 0,
    estimated_lines_count   INT             NOT NULL DEFAULT 0,
    stale_acknowledged      BOOLEAN         NOT NULL DEFAULT FALSE,
    stale_acknowledged_by   VARCHAR(100),    -- user ID/email
    stale_acknowledged_at   TIMESTAMP,
    stale_reason            TEXT,
    capture_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    frozen_at               TIMESTAMP,
    frozen_by               VARCHAR(100),
    created_by              VARCHAR(100),
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_supply_snapshot_status ON supply_snapshot(status);
CREATE INDEX idx_supply_snapshot_created_at ON supply_snapshot(created_at DESC);
```

### Table: supply_snapshot_line

```sql
CREATE TABLE supply_snapshot_line (
    id                  BIGSERIAL PRIMARY KEY,
    snapshot_id         BIGINT          NOT NULL REFERENCES supply_snapshot(id) ON DELETE CASCADE,
    item_code           VARCHAR(50)     NOT NULL REFERENCES item(item_code),       -- match item.item_code PK
    location_code       VARCHAR(20)     NOT NULL REFERENCES location(location_code), -- match location.location_code PK
    allocatable_qty     DECIMAL(15,2)   NOT NULL DEFAULT 0,
      -- = on_hand_qty - reserved_qty (hàng có thể dùng cho DRP)
    reserved_qty        DECIMAL(15,2)   NOT NULL DEFAULT 0,
    quarantine_qty      DECIMAL(15,2)   NOT NULL DEFAULT 0,
      -- UNIS Phase 1: luôn = 0
    in_transit_qty      DECIMAL(15,2)   NOT NULL DEFAULT 0,
    is_estimated        BOOLEAN         NOT NULL DEFAULT FALSE,
      -- TRUE = DISTRIBUTION source (lower confidence)
    oldest_sync_at      TIMESTAMP,
    freshness           VARCHAR(10)     NOT NULL DEFAULT 'PASS',
    override_qty        DECIMAL(15,2),
      -- Planner manual override, nullable
    override_reason     TEXT,
    override_by         VARCHAR(100),
    override_at         TIMESTAMP,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_supply_line_snapshot_item_loc
    ON supply_snapshot_line(snapshot_id, item_code, location_code);
CREATE INDEX idx_supply_line_snapshot_id ON supply_snapshot_line(snapshot_id);
CREATE INDEX idx_supply_line_item_code ON supply_snapshot_line(item_code);
CREATE INDEX idx_supply_line_location_code ON supply_snapshot_line(location_code);
```

### Table: lot_attribute (nguồn tồn kho từ Bravo)

```sql
CREATE TABLE lot_attribute (
    id              BIGSERIAL PRIMARY KEY,
    item_code       VARCHAR(50)     NOT NULL,   -- match item.item_code PK (VARCHAR 50) — NO FK: bravo upload validates in app layer
    location_code   VARCHAR(20)     NOT NULL,   -- match location.location_code PK (VARCHAR 20) — NO FK: same reason
    lot_number      VARCHAR(50)     NOT NULL DEFAULT 'DEFAULT',
    on_hand_qty     DECIMAL(15,2)   NOT NULL DEFAULT 0,
    reserved_qty    DECIMAL(15,2)   NOT NULL DEFAULT 0,
    quarantine_qty  DECIMAL(15,2)   NOT NULL DEFAULT 0,
    in_transit_qty  DECIMAL(15,2)   NOT NULL DEFAULT 0,
    quality_status  VARCHAR(20)     NOT NULL DEFAULT 'ALLOCATABLE',
      -- ALLOCATABLE | HOLD | REJECTED
    source_type     VARCHAR(20)     NOT NULL DEFAULT 'OEM',
      -- OEM (chắc chắn) | DISTRIBUTION (có thể thay đổi)
    last_sync_at    TIMESTAMP       NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_lot_attribute_pk
    ON lot_attribute(item_code, location_code, lot_number);
CREATE INDEX idx_lot_attribute_last_sync ON lot_attribute(last_sync_at);
```

---

## MIGRATION FILE

```
File: backend/src/supply/migrations/001_create_supply_tables.sql
(hoặc dùng TypeORM migration class nếu project đã setup migrations)
```

```sql
-- Migration: 001_create_supply_tables
-- Run: psql -d unis_scp -f 001_create_supply_tables.sql

BEGIN;

CREATE TABLE IF NOT EXISTS lot_attribute (
    id              BIGSERIAL PRIMARY KEY,
    item_code       VARCHAR(50)     NOT NULL,   -- match item.item_code PK
    location_code   VARCHAR(20)     NOT NULL,   -- match location.location_code PK
    lot_number      VARCHAR(50)     NOT NULL DEFAULT 'DEFAULT',
    on_hand_qty     DECIMAL(15,2)   NOT NULL DEFAULT 0,
    reserved_qty    DECIMAL(15,2)   NOT NULL DEFAULT 0,
    quarantine_qty  DECIMAL(15,2)   NOT NULL DEFAULT 0,
    in_transit_qty  DECIMAL(15,2)   NOT NULL DEFAULT 0,
    quality_status  VARCHAR(20)     NOT NULL DEFAULT 'ALLOCATABLE',
    source_type     VARCHAR(20)     NOT NULL DEFAULT 'OEM',
    last_sync_at    TIMESTAMP       NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_lot_attribute UNIQUE (item_code, location_code, lot_number)
);

CREATE TABLE IF NOT EXISTS supply_snapshot (
    id                      BIGSERIAL PRIMARY KEY,
    snapshot_name           VARCHAR(200)    NOT NULL,
    status                  VARCHAR(20)     NOT NULL DEFAULT 'DRAFT',
    freshness               VARCHAR(10)     NOT NULL DEFAULT 'PASS',
    freshness_age_minutes   INT             NOT NULL DEFAULT 0,
    total_lines             INT             NOT NULL DEFAULT 0,
    total_items             INT             NOT NULL DEFAULT 0,
    total_locations         INT             NOT NULL DEFAULT 0,
    total_allocatable_qty   DECIMAL(18,2)   NOT NULL DEFAULT 0,
    total_reserved_qty      DECIMAL(18,2)   NOT NULL DEFAULT 0,
    total_in_transit_qty    DECIMAL(18,2)   NOT NULL DEFAULT 0,
    estimated_lines_count   INT             NOT NULL DEFAULT 0,
    stale_acknowledged      BOOLEAN         NOT NULL DEFAULT FALSE,
    stale_acknowledged_by   VARCHAR(100),
    stale_acknowledged_at   TIMESTAMP,
    stale_reason            TEXT,
    capture_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    frozen_at               TIMESTAMP,
    frozen_by               VARCHAR(100),
    created_by              VARCHAR(100),
    created_at              TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supply_snapshot_line (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_id     BIGINT          NOT NULL REFERENCES supply_snapshot(id) ON DELETE CASCADE,
    item_code       VARCHAR(50)     NOT NULL,   -- match item.item_code PK
    location_code   VARCHAR(20)     NOT NULL,   -- match location.location_code PK
    allocatable_qty DECIMAL(15,2)   NOT NULL DEFAULT 0,
    reserved_qty    DECIMAL(15,2)   NOT NULL DEFAULT 0,
    quarantine_qty  DECIMAL(15,2)   NOT NULL DEFAULT 0,
    in_transit_qty  DECIMAL(15,2)   NOT NULL DEFAULT 0,
    is_estimated    BOOLEAN         NOT NULL DEFAULT FALSE,
    oldest_sync_at  TIMESTAMP,
    freshness       VARCHAR(10)     NOT NULL DEFAULT 'PASS',
    override_qty    DECIMAL(15,2),
    override_reason TEXT,
    override_by     VARCHAR(100),
    override_at     TIMESTAMP,
    created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_supply_line UNIQUE (snapshot_id, item_code, location_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_supply_snapshot_status ON supply_snapshot(status);
CREATE INDEX IF NOT EXISTS idx_supply_snapshot_created ON supply_snapshot(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_supply_line_snapshot ON supply_snapshot_line(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_supply_line_item ON supply_snapshot_line(item_code);
CREATE INDEX IF NOT EXISTS idx_supply_line_location ON supply_snapshot_line(location_code);
CREATE INDEX IF NOT EXISTS idx_lot_sync ON lot_attribute(last_sync_at);

COMMIT;
```

---

## BACKEND — NestJS Structure

```
src/supply/
├── supply.module.ts
├── supply.controller.ts       ← CRUD snapshots, freeze, stale
├── supply.service.ts          ← business logic: capture, aggregate, freshness
├── bravo.controller.ts        ← Bravo upload endpoint
├── bravo.service.ts           ← parse Excel/CSV, upsert lot_attribute
├── entities/
│   ├── supply-snapshot.entity.ts
│   ├── supply-snapshot-line.entity.ts
│   └── lot-attribute.entity.ts
└── dto/
    ├── capture-snapshot.dto.ts
    ├── acknowledge-stale.dto.ts
    ├── override-line.dto.ts
    └── bravo-upload.dto.ts
```

### supply.module.ts

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SupplyController } from './supply.controller';
import { SupplyService } from './supply.service';
import { BravoController } from './bravo.controller';
import { BravoService } from './bravo.service';
import { SupplySnapshot } from './entities/supply-snapshot.entity';
import { SupplySnapshotLine } from './entities/supply-snapshot-line.entity';
import { LotAttribute } from './entities/lot-attribute.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SupplySnapshot, SupplySnapshotLine, LotAttribute])],
  controllers: [SupplyController, BravoController],
  providers: [SupplyService, BravoService],
  exports: [SupplyService],  // export cho DRP module dùng
})
export class SupplyModule {}
```

### Đăng ký vào app.module.ts

```typescript
// src/app.module.ts
import { SupplyModule } from './supply/supply.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ... }),
    DemandModule,
    SupplyModule,   // ← THÊM DÒNG NÀY
  ],
})
export class AppModule {}
```

---

## ENTITIES

### supply-snapshot.entity.ts

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { SupplySnapshotLine } from './supply-snapshot-line.entity';

@Entity('supply_snapshot')
export class SupplySnapshot {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'snapshot_name', length: 200 })
  snapshotName: string;

  @Column({ length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'FROZEN' | 'ARCHIVED';

  @Column({ length: 10, default: 'PASS' })
  freshness: 'PASS' | 'STALE';

  @Column({ name: 'freshness_age_minutes', type: 'int', default: 0 })
  freshnessAgeMinutes: number;

  @Column({ name: 'total_lines', type: 'int', default: 0 })
  totalLines: number;

  @Column({ name: 'total_items', type: 'int', default: 0 })
  totalItems: number;

  @Column({ name: 'total_locations', type: 'int', default: 0 })
  totalLocations: number;

  @Column({ name: 'total_allocatable_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalAllocatableQty: number;

  @Column({ name: 'total_reserved_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalReservedQty: number;

  @Column({ name: 'total_in_transit_qty', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalInTransitQty: number;

  @Column({ name: 'estimated_lines_count', type: 'int', default: 0 })
  estimatedLinesCount: number;

  @Column({ name: 'stale_acknowledged', default: false })
  staleAcknowledged: boolean;

  @Column({ name: 'stale_acknowledged_by', nullable: true })
  staleAcknowledgedBy: string;

  @Column({ name: 'stale_acknowledged_at', type: 'timestamp', nullable: true })
  staleAcknowledgedAt: Date;

  @Column({ name: 'stale_reason', type: 'text', nullable: true })
  staleReason: string;

  @Column({ name: 'capture_at', type: 'timestamp', default: () => 'NOW()' })
  captureAt: Date;

  @Column({ name: 'frozen_at', type: 'timestamp', nullable: true })
  frozenAt: Date;

  @Column({ name: 'frozen_by', nullable: true })
  frozenBy: string;

  @Column({ name: 'created_by', nullable: true })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => SupplySnapshotLine, (line) => line.snapshot)
  lines: SupplySnapshotLine[];
}
```

### lot-attribute.entity.ts

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('lot_attribute')
export class LotAttribute {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'item_code', length: 50 })    // match item.item_code PK
  itemCode: string;

  @Column({ name: 'location_code', length: 20 }) // match location.location_code PK
  locationCode: string;

  @Column({ name: 'lot_number', length: 50, default: 'DEFAULT' })
  lotNumber: string;

  @Column({ name: 'on_hand_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  onHandQty: number;

  @Column({ name: 'reserved_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  reservedQty: number;

  @Column({ name: 'quarantine_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  quarantineQty: number;

  @Column({ name: 'in_transit_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  inTransitQty: number;

  @Column({ name: 'quality_status', length: 20, default: 'ALLOCATABLE' })
  qualityStatus: 'ALLOCATABLE' | 'HOLD' | 'REJECTED';

  @Column({ name: 'source_type', length: 20, default: 'OEM' })
  sourceType: 'OEM' | 'DISTRIBUTION';

  @Column({ name: 'last_sync_at', type: 'timestamp', default: () => 'NOW()' })
  lastSyncAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

---

### supply-snapshot-line.entity.ts

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { SupplySnapshot } from './supply-snapshot.entity';

@Entity('supply_snapshot_line')
export class SupplySnapshotLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'snapshot_id', type: 'bigint' })
  snapshotId: string;

  @ManyToOne(() => SupplySnapshot, (s) => s.lines)
  @JoinColumn({ name: 'snapshot_id' })
  snapshot: SupplySnapshot;

  @Column({ name: 'item_code', length: 50 })    // match item.item_code PK
  itemCode: string;

  @Column({ name: 'location_code', length: 20 }) // match location.location_code PK
  locationCode: string;

  @Column({ name: 'allocatable_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  allocatableQty: number;

  @Column({ name: 'reserved_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  reservedQty: number;

  @Column({ name: 'quarantine_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  quarantineQty: number;

  @Column({ name: 'in_transit_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  inTransitQty: number;

  @Column({ name: 'is_estimated', default: false })
  isEstimated: boolean;

  @Column({ name: 'oldest_sync_at', type: 'timestamp', nullable: true })
  oldestSyncAt: Date;

  @Column({ length: 10, default: 'PASS' })
  freshness: 'PASS' | 'STALE';

  @Column({ name: 'override_qty', type: 'decimal', precision: 15, scale: 2, nullable: true })
  overrideQty: number;

  @Column({ name: 'override_reason', type: 'text', nullable: true })
  overrideReason: string;

  @Column({ name: 'override_by', nullable: true })
  overrideBy: string;

  @Column({ name: 'override_at', type: 'timestamp', nullable: true })
  overrideAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

---

## BACKEND — SUPPLY SERVICE

### supply.service.ts — Key Methods

```typescript
// src/supply/supply.service.ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SupplySnapshot } from './entities/supply-snapshot.entity';
import { SupplySnapshotLine } from './entities/supply-snapshot-line.entity';
import { LotAttribute } from './entities/lot-attribute.entity';

const FRESHNESS_THRESHOLD_MINUTES = 240;  // UNIS: 4 giờ (Bravo batch mode)

@Injectable()
export class SupplyService {
  constructor(
    @InjectRepository(SupplySnapshot)
    private snapshotRepo: Repository<SupplySnapshot>,
    @InjectRepository(SupplySnapshotLine)
    private lineRepo: Repository<SupplySnapshotLine>,
    @InjectRepository(LotAttribute)
    private lotRepo: Repository<LotAttribute>,
    private dataSource: DataSource,
  ) {}

  // ── 1. CAPTURE SNAPSHOT ──────────────────────────────────────────────────

  async captureSnapshot(params: {
    snapshotName: string;
    includeInTransit?: boolean;
    autoFreeze?: boolean;
    createdBy?: string;
  }): Promise<SupplySnapshot> {

    // Step 1: Aggregate lot_attribute per item × location
    const rows: Array<{
      item_code: string;
      location_code: string;
      total_on_hand: string;
      total_reserved: string;
      total_quarantine: string;
      total_in_transit: string;
      oldest_sync: Date;
      has_estimated: boolean;
    }> = await this.dataSource.query(`
      SELECT
        la.item_code,
        la.location_code,
        SUM(la.on_hand_qty)      AS total_on_hand,
        SUM(la.reserved_qty)     AS total_reserved,
        SUM(la.quarantine_qty)   AS total_quarantine,
        SUM(la.in_transit_qty)   AS total_in_transit,
        MIN(la.last_sync_at)     AS oldest_sync,
        BOOL_OR(la.source_type = 'DISTRIBUTION') AS has_estimated
      FROM lot_attribute la
      WHERE la.quality_status = 'ALLOCATABLE'
      GROUP BY la.item_code, la.location_code
    `);

    if (rows.length === 0) throw new BadRequestException('No lot_attribute data found');

    // Step 2: Check freshness (based on oldest sync across ALL rows)
    // Note: dataSource.query() may return Date as string → always wrap with new Date()
    const oldestSync = rows.reduce((min, r) => {
      const d = new Date(r.oldest_sync);
      return d < min ? d : min;
    }, new Date(rows[0].oldest_sync));
    const ageMinutes = Math.floor((Date.now() - oldestSync.getTime()) / 60000);
    const freshness: 'PASS' | 'STALE' = ageMinutes <= FRESHNESS_THRESHOLD_MINUTES ? 'PASS' : 'STALE';

    // Step 3: Create snapshot header
    const snapshot = this.snapshotRepo.create({
      snapshotName: params.snapshotName,
      status: 'DRAFT',
      freshness,
      freshnessAgeMinutes: ageMinutes,
      createdBy: params.createdBy,
      captureAt: new Date(),
    });
    const saved = await this.snapshotRepo.save(snapshot);

    // Step 4: Build + insert lines (batch)
    let totalAllocatable = 0, totalReserved = 0, totalInTransit = 0, estimatedCount = 0;
    const lines = rows.map((r) => {
      const allocatable = Math.max(0, +r.total_on_hand - +r.total_reserved);
      const lineFreshness: 'PASS' | 'STALE' =
        Math.floor((Date.now() - new Date(r.oldest_sync).getTime()) / 60000) <= FRESHNESS_THRESHOLD_MINUTES
          ? 'PASS' : 'STALE';

      totalAllocatable += allocatable;
      totalReserved    += +r.total_reserved;
      totalInTransit   += params.includeInTransit ? +r.total_in_transit : 0;
      if (r.has_estimated) estimatedCount++;

      return this.lineRepo.create({
        snapshotId: saved.id,
        itemCode: r.item_code,
        locationCode: r.location_code,
        allocatableQty: allocatable,
        reservedQty: +r.total_reserved,
        quarantineQty: 0,   // UNIS Phase 1: always 0
        inTransitQty: params.includeInTransit ? +r.total_in_transit : 0,
        isEstimated: r.has_estimated,
        oldestSyncAt: r.oldest_sync,
        freshness: lineFreshness,
      });
    });

    // Batch insert in chunks of 500 — wrapped in transaction to avoid partial state
    await this.dataSource.transaction(async (em) => {
      for (let i = 0; i < lines.length; i += 500) {
        await em.save(lines.slice(i, i + 500));
      }
    });

    // Step 5: Update header totals
    await this.snapshotRepo.update(saved.id, {
      totalLines: rows.length,
      totalItems: new Set(rows.map(r => r.item_code)).size,
      totalLocations: new Set(rows.map(r => r.location_code)).size,
      totalAllocatableQty: totalAllocatable,
      totalReservedQty: totalReserved,
      totalInTransitQty: totalInTransit,
      estimatedLinesCount: estimatedCount,
    });

    if (params.autoFreeze) await this.freezeSnapshot(saved.id, params.createdBy);

    return this.snapshotRepo.findOne({ where: { id: saved.id } });
  }

  // ── 2. FREEZE ────────────────────────────────────────────────────────────

  async freezeSnapshot(id: string, frozenBy?: string): Promise<SupplySnapshot> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`Snapshot ${id} not found`);
    if (snapshot.status !== 'DRAFT') throw new BadRequestException('Only DRAFT snapshots can be frozen');
    if (snapshot.freshness === 'STALE' && !snapshot.staleAcknowledged) {
      throw new BadRequestException('STALE snapshot must be acknowledged before freezing');
    }

    await this.snapshotRepo.update(id, {
      status: 'FROZEN',
      frozenAt: new Date(),
      frozenBy: frozenBy,
    });
    return this.snapshotRepo.findOne({ where: { id } });
  }

  // ── 3. ACKNOWLEDGE STALE ─────────────────────────────────────────────────

  async acknowledgeStale(id: string, reason: string, userId?: string): Promise<SupplySnapshot> {
    const snapshot = await this.snapshotRepo.findOne({ where: { id } });
    if (!snapshot) throw new NotFoundException(`Snapshot ${id} not found`);
    if (snapshot.freshness !== 'STALE') throw new BadRequestException('Snapshot is not STALE');

    await this.snapshotRepo.update(id, {
      staleAcknowledged: true,
      staleAcknowledgedBy: userId,
      staleAcknowledgedAt: new Date(),
      staleReason: reason,
    });
    return this.snapshotRepo.findOne({ where: { id } });
  }

  // ── 4. OVERRIDE LINE ─────────────────────────────────────────────────────

  // Policy: override được phép trên cả DRAFT và FROZEN snapshot.
  // Lý do: FROZEN = DRP đã dùng bộ số này rồi, planner vẫn cần sửa nếu kiểm kho thấy sai.
  // DRP Module 4 luôn dùng COALESCE(override_qty, allocatable_qty) nên override bất kỳ lúc nào cũng đúng.
  async overrideLine(lineId: string, qty: number, reason: string, userId?: string): Promise<SupplySnapshotLine> {
    const line = await this.lineRepo.findOne({ where: { id: lineId } });
    if (!line) throw new NotFoundException(`Line ${lineId} not found`);

    await this.lineRepo.update(lineId, {
      overrideQty: qty,
      overrideReason: reason,
      overrideBy: userId,
      overrideAt: new Date(),
    });
    return this.lineRepo.findOne({ where: { id: lineId } });
  }

  // ── 5. FRESHNESS STATUS ──────────────────────────────────────────────────

  async getFreshnessStatus(): Promise<{
    overallFreshness: string;
    oldestSync: Date;
    newestSync: Date;
    ageMinutes: number;
    thresholdMinutes: number;
    staleLocations: string[];
  }> {
    const result = await this.dataSource.query(`
      SELECT
        MIN(last_sync_at) AS oldest_sync,
        MAX(last_sync_at) AS newest_sync
      FROM lot_attribute
      WHERE quality_status = 'ALLOCATABLE'
    `);

    const oldest = result[0]?.oldest_sync;
    if (!oldest) return {
      overallFreshness: 'NO_DATA', oldestSync: null, newestSync: null,
      ageMinutes: 0, thresholdMinutes: FRESHNESS_THRESHOLD_MINUTES, staleLocations: [],
    };

    const ageMinutes = Math.floor((Date.now() - new Date(oldest).getTime()) / 60000);
    const staleRows = await this.dataSource.query(`
      SELECT DISTINCT location_code
      FROM lot_attribute
      WHERE last_sync_at < NOW() - INTERVAL '${FRESHNESS_THRESHOLD_MINUTES} minutes'
    `);

    return {
      overallFreshness: ageMinutes <= FRESHNESS_THRESHOLD_MINUTES ? 'PASS' : 'STALE',
      oldestSync: oldest,
      newestSync: result[0].newest_sync,
      ageMinutes,
      thresholdMinutes: FRESHNESS_THRESHOLD_MINUTES,
      staleLocations: staleRows.map((r: any) => r.location_code),
    };
  }

  // ── 6. LIST + GET ────────────────────────────────────────────────────────

  async listSnapshots(): Promise<SupplySnapshot[]> {
    return this.snapshotRepo.find({
      order: { createdAt: 'DESC' },
      take: 30,
    });
  }

  async getSnapshot(id: string): Promise<SupplySnapshot> {
    const s = await this.snapshotRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException(`Snapshot ${id} not found`);
    return s;
  }

  async getSnapshotLines(id: string, params: {
    itemCode?: string;
    locationCode?: string;
    isEstimated?: boolean;
    freshness?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = params.page ?? 1;
    const pageSize = Math.min(params.pageSize ?? 50, 500);
    const skip = (page - 1) * pageSize;

    const qb = this.lineRepo.createQueryBuilder('l')
      .where('l.snapshot_id = :id', { id });
    if (params.itemCode) qb.andWhere('l.item_code ILIKE :item', { item: `%${params.itemCode}%` });
    if (params.locationCode) qb.andWhere('l.location_code = :loc', { loc: params.locationCode });
    if (params.isEstimated !== undefined) qb.andWhere('l.is_estimated = :est', { est: params.isEstimated });
    if (params.freshness) qb.andWhere('l.freshness = :fr', { fr: params.freshness });

    const [data, total] = await qb.skip(skip).take(pageSize)
      .orderBy('l.allocatable_qty', 'DESC').getManyAndCount();

    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }
}
```

---

## BACKEND — SUPPLY CONTROLLER

### supply.controller.ts

**DTO cho getLines (dùng class-validator):**

```typescript
// src/supply/dto/get-lines-query.dto.ts
import { IsOptional, IsString, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class GetLinesQueryDto {
  @IsOptional() @IsString()
  itemCode?: string;

  @IsOptional() @IsString()
  locationCode?: string;

  @IsOptional() @Transform(({ value }) => value === 'true')  @IsBoolean()
  isEstimated?: boolean;

  @IsOptional() @IsString()
  freshness?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  pageSize?: number = 50;
}
```

```typescript
// src/supply/supply.controller.ts
import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { SupplyService } from './supply.service';
import { GetLinesQueryDto } from './dto/get-lines-query.dto';

@Controller('api/v1/supply')
export class SupplyController {
  constructor(private readonly supplyService: SupplyService) {}

  // GET  /api/v1/supply/freshness/status
  @Get('freshness/status')
  getFreshnessStatus() {
    return this.supplyService.getFreshnessStatus();
  }

  // GET  /api/v1/supply/snapshot
  @Get('snapshot')
  listSnapshots() {
    return this.supplyService.listSnapshots();
  }

  // POST /api/v1/supply/snapshot/capture
  @Post('snapshot/capture')
  captureSnapshot(@Body() body: {
    snapshot_name: string;
    include_in_transit?: boolean;
    auto_freeze?: boolean;
  }) {
    return this.supplyService.captureSnapshot({
      snapshotName: body.snapshot_name,
      includeInTransit: body.include_in_transit ?? true,
      autoFreeze: body.auto_freeze ?? false,
    });
  }

  // GET  /api/v1/supply/snapshot/:id
  @Get('snapshot/:id')
  getSnapshot(@Param('id') id: string) {
    return this.supplyService.getSnapshot(id);
  }

  // GET  /api/v1/supply/snapshot/:id/lines
  @Get('snapshot/:id/lines')
  getLines(@Param('id') id: string, @Query() q: GetLinesQueryDto) {
    return this.supplyService.getSnapshotLines(id, {
      itemCode: q.itemCode,
      locationCode: q.locationCode,
      isEstimated: q.isEstimated,
      freshness: q.freshness,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 50,
    });
  }

  // POST /api/v1/supply/snapshot/:id/freeze
  @Post('snapshot/:id/freeze')
  freeze(@Param('id') id: string, @Body() body: { frozen_by?: string }) {
    return this.supplyService.freezeSnapshot(id, body.frozen_by);
  }

  // POST /api/v1/supply/snapshot/:id/acknowledge-stale
  @Post('snapshot/:id/acknowledge-stale')
  acknowledgeStale(
    @Param('id') id: string,
    @Body() body: { reason: string; user_id?: string },
  ) {
    return this.supplyService.acknowledgeStale(id, body.reason, body.user_id);
  }

  // POST /api/v1/supply/snapshot/:id/lines/:lineId/override
  @Post('snapshot/:id/lines/:lineId/override')
  overrideLine(
    @Param('lineId') lineId: string,
    @Body() body: { override_qty: number; reason: string; user_id?: string },
  ) {
    return this.supplyService.overrideLine(lineId, body.override_qty, body.reason, body.user_id);
  }
}
```

---

## BACKEND — BRAVO SERVICE + CONTROLLER

### bravo.service.ts — Upload + Parse

```typescript
// src/supply/bravo.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { LotAttribute } from './entities/lot-attribute.entity';
import * as XLSX from 'xlsx';  // npm install xlsx

@Injectable()
export class BravoService {
  constructor(
    @InjectRepository(LotAttribute)
    private lotRepo: Repository<LotAttribute>,
    private dataSource: DataSource,
  ) {}

  async processUpload(fileBuffer: Buffer): Promise<{
    rowsParsed: number;
    rowsUpdated: number;
    rowsInserted: number;
    rowsSkipped: number;
    unmappedItems: string[];
    unmappedLocations: string[];
    syncTimestamp: Date;
  }> {
    // Parse Excel/CSV
    const wb = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // Normalize header keys to lowercase để tránh case sensitivity (Sku vs SKU vs sku)
    const rawRowsRaw: any[] = XLSX.utils.sheet_to_json(sheet);
    const rawRows: any[] = rawRowsRaw.map(row =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]))
    );

    if (!rawRows.length) throw new BadRequestException('File rỗng hoặc không đọc được');

    // Map column names từ Bravo format → internal
    // ⚠️ UNIS ACTUAL FILE: All_Inventory.csv columns:
    //   branch_code       → location_code  (direct match, already zero-padded 3 digits)
    //   Sku               → item_code      (item_code without color suffix — direct match to item master)
    //   bravo_sku         → KHÔNG dùng    (có đuôi màu VD: 12.L1.3030.3002, không match item master)
    //   invqty            → on_hand_qty
    //   da_dat            → reserved_qty  (KHÔNG có trong file → default 0, Phase 1)
    //   dang_van_chuyen   → in_transit_qty (KHÔNG có trong file → default 0, Phase 1)
    // BA spec columns (ma_kho, ma_hang, ton_thuc_te) kept as fallback for future Bravo format change
    const unmappedItems: Set<string> = new Set();
    const unmappedLocations: Set<string> = new Set();
    let updated = 0, inserted = 0, skipped = 0;

    // Validate items + locations exist in master data
    // Headers already lowercased: 'Sku' → 'sku', 'branch_code' stays 'branch_code'
    const allItemCodes: string[] = [...new Set(rawRows.map(r => String(r['sku'] || r['ma_hang'] || r['item_code'] || '').trim()))];
    const allLocCodes: string[] = [...new Set(rawRows.map(r => String(r['branch_code'] || r['ma_kho'] || r['location_code'] || '').trim()))];

    const validItems: Set<string> = new Set(
      (await this.dataSource.query(
        `SELECT item_code FROM item WHERE item_code = ANY($1)`, [allItemCodes]
      )).map((r: any) => r.item_code)
    );
    const validLocs: Set<string> = new Set(
      (await this.dataSource.query(
        `SELECT location_code FROM location WHERE location_code = ANY($1)`, [allLocCodes]
      )).map((r: any) => r.location_code)
    );

    for (const row of rawRows) {
      const itemCode     = String(row['sku'] || row['ma_hang'] || row['item_code'] || '').trim();
      const locationCode = String(row['branch_code'] || row['ma_kho'] || row['location_code'] || '').trim();
      const onHand       = parseFloat(row['invqty'] ?? row['ton_thuc_te'] ?? 0) || 0;
      const reserved     = parseFloat(row['da_dat'] ?? row['reserved_qty'] ?? 0) || 0;
      const inTransit    = parseFloat(row['dang_van_chuyen'] ?? row['in_transit_qty'] ?? 0) || 0;

      if (!validItems.has(itemCode)) { unmappedItems.add(itemCode); skipped++; continue; }
      if (!validLocs.has(locationCode)) { unmappedLocations.add(locationCode); skipped++; continue; }

      // UPSERT into lot_attribute
      const result = await this.dataSource.query(`
        INSERT INTO lot_attribute
          (item_code, location_code, lot_number, on_hand_qty, reserved_qty, in_transit_qty, last_sync_at, updated_at)
        VALUES ($1, $2, 'BRAVO', $3, $4, $5, NOW(), NOW())
        ON CONFLICT (item_code, location_code, lot_number)
        DO UPDATE SET
          on_hand_qty   = EXCLUDED.on_hand_qty,
          reserved_qty  = EXCLUDED.reserved_qty,
          in_transit_qty = EXCLUDED.in_transit_qty,
          last_sync_at  = NOW(),
          updated_at    = NOW()
        RETURNING (xmax = 0) AS inserted
      `, [itemCode, locationCode, onHand, reserved, inTransit]);

      if (result[0]?.inserted) inserted++; else updated++;
    }

    return {
      rowsParsed: rawRows.length,
      rowsUpdated: updated,
      rowsInserted: inserted,
      rowsSkipped: skipped,
      unmappedItems: [...unmappedItems].slice(0, 50),
      unmappedLocations: [...unmappedLocations].slice(0, 50),
      syncTimestamp: new Date(),
    };
  }
}
```

### bravo.controller.ts

```typescript
// src/supply/bravo.controller.ts
import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BravoService } from './bravo.service';

@Controller('api/v1/supply/bravo')
export class BravoController {
  constructor(private readonly bravoService: BravoService) {}

  // POST /api/v1/supply/bravo/upload
  // Content-Type: multipart/form-data, field: file
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    return this.bravoService.processUpload(file.buffer);
  }
}
```

**Cài thêm:** `npm install xlsx` trong backend.

---

## API ENDPOINTS — TỔNG HỢP

| Method | Path | Mô tả |
|--------|------|-------|
| `GET` | `/api/v1/supply/freshness/status` | Check freshness lot_attribute |
| `GET` | `/api/v1/supply/snapshot` | Danh sách snapshots (30 gần nhất) |
| `POST` | `/api/v1/supply/snapshot/capture` | Tạo snapshot mới từ lot_attribute |
| `GET` | `/api/v1/supply/snapshot/:id` | Chi tiết 1 snapshot |
| `GET` | `/api/v1/supply/snapshot/:id/lines` | Lines (paged, filterable) |
| `POST` | `/api/v1/supply/snapshot/:id/freeze` | Freeze snapshot |
| `POST` | `/api/v1/supply/snapshot/:id/acknowledge-stale` | Xác nhận data cũ |
| `POST` | `/api/v1/supply/snapshot/:id/lines/:lineId/override` | Override 1 line |
| `POST` | `/api/v1/supply/bravo/upload` | Upload Bravo file |

---

## FRONTEND — DASHBOARD /supply

### Kiến trúc trang

```
/supply (page.tsx)
  ├── Header: "02 Supply Snapshot" + [Capture] [Upload] buttons
  ├── Freshness Widget (top bar — always visible)
  ├── Stale Warning Banner (conditional)
  ├── KPI Cards (4 cards)
  ├── Tab 1: Snapshot List
  └── Tab 2: Inventory Detail (inventory matrix item × location)
```

### UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│  02  Supply Snapshot         [Capture Now]  [Upload Bravo]     │
│  Freshness: ✅ PASS — Data 3.5 giờ trước (next: 02:00 AM)     │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │Allocatable│  │ Reserved │  │In-Transit│  │Freshness │      │
│  │ 2,850K   │  │  450K   │  │  320K   │  │ ✅ PASS  │      │
│  │units     │  │ units   │  │ units   │  │180 min   │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
├────────────────────────────────────────────────────────────────┤
│  [Snapshot List]  [Inventory Detail]                           │
│                                                                │
│  TAB 1: Snapshot List                                          │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Name    │Status│Fresh│Lines│Items│Alloc.│CapAt│  Actions│  │
│  │Tồn 13/4 │FROZEN│PASS │4830 │1419 │2.85M │02:45│ [View]  │  │
│  │Tồn 12/4 │FROZEN│PASS │4810 │1415 │2.80M │02:43│ [View]  │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  TAB 2: Inventory Detail (when snapshot selected)             │
│  Filters: [Item search] [Location] [Estimated ▼] [Freshness ▼]│
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Item Code    │ Location │Alloc.│Reserved│In-Trans│Fresh  │  │
│  │ 41.L1.UGC3600│ HCM-NM-01│ 500 │  100  │  50   │ ✅    │  │
│  │ 41.L1.UGC3600│ HN-CN-007│  80 │   20  │   0   │ ✅    │  │
│  └─────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Stale Warning Banner

```
┌────────────────────────────────────────────────────────────────┐
│ ⚠️ Dữ liệu tồn kho cũ 320 phút (threshold: 240 phút).        │
│    Data từ: 2026-04-13 02:00 · Oldest: WH-HCM-001              │
│    [Acknowledge và tiếp tục]  [Capture lại]  [Override thủ công]│
└────────────────────────────────────────────────────────────────┘
```

### FE Components List

| # | Component | File | Mô tả |
|---|-----------|------|-------|
| S-1 | `FreshnessWidget` | `supply/freshness-widget.tsx` | Top bar: age + PASS/STALE |
| S-2 | `StaleWarningBanner` | `supply/stale-warning-banner.tsx` | Red banner + 3 action buttons |
| S-3 | `SupplyKpiCards` | `supply/supply-kpi-cards.tsx` | 4 cards: Allocatable/Reserved/In-Transit/Freshness |
| S-4 | `SnapshotListTable` | `supply/snapshot-list-table.tsx` | Danh sách snapshots, actions |
| S-5 | `CaptureDialog` | `supply/capture-dialog.tsx` | Confirm + name input + auto_freeze toggle |
| S-6 | `BravoUploadDialog` | `supply/bravo-upload-dialog.tsx` | File upload + preview unmapped |
| S-7 | `InventoryLinesTable` | `supply/inventory-lines-table.tsx` | Lines table: search/filter/paginate |
| S-8 | `LineOverrideDialog` | `supply/line-override-dialog.tsx` | Override qty + reason |
| S-9 | `SnapshotDetailPanel` | `supply/snapshot-detail-panel.tsx` | Summary của 1 snapshot (dùng khi click View) |

### API calls (lib/api/supply.ts)

```typescript
// frontend/lib/api/supply.ts
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function fetchFreshnessStatus() {
  const res = await fetch(`${API}/api/v1/supply/freshness/status`);
  return res.json();
}

export async function fetchSnapshots() {
  const res = await fetch(`${API}/api/v1/supply/snapshot`);
  return res.json();
}

export async function captureSnapshot(body: {
  snapshot_name: string;
  include_in_transit?: boolean;
  auto_freeze?: boolean;
}) {
  const res = await fetch(`${API}/api/v1/supply/snapshot/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function freezeSnapshot(id: string) {
  const res = await fetch(`${API}/api/v1/supply/snapshot/${id}/freeze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return res.json();
}

export async function acknowledgeStale(id: string, reason: string) {
  const res = await fetch(`${API}/api/v1/supply/snapshot/${id}/acknowledge-stale`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return res.json();
}

export async function overrideLine(snapshotId: string, lineId: string, overrideQty: number, reason: string) {
  const res = await fetch(`${API}/api/v1/supply/snapshot/${snapshotId}/lines/${lineId}/override`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ override_qty: overrideQty, reason }),
  });
  return res.json();
}

export async function fetchSnapshotLines(id: string, params: Record<string, string | number | boolean | undefined>) {
  const q = new URLSearchParams(Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ));
  const res = await fetch(`${API}/api/v1/supply/snapshot/${id}/lines?${q}`);
  return res.json();
}

export async function uploadBravo(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${API}/api/v1/supply/bravo/upload`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

---

## EXECUTION ORDER

```
PHASE 1 — Database + Backend Core (Day 1):
  [ ] Chạy migration: 001_create_supply_tables.sql
  [ ] Tạo folder src/supply/ + các files
  [ ] Implement entities: supply-snapshot, supply-snapshot-line, lot-attribute
  [ ] Implement supply.module.ts
  [ ] Đăng ký SupplyModule vào app.module.ts
  [ ] npm install xlsx (trong backend)

PHASE 2 — Backend Services (Day 2):
  [ ] supply.service.ts:
      - captureSnapshot() (aggregate lot_attribute → insert lines)
      - freezeSnapshot() (validate + update status)
      - acknowledgeStale() (validate + update flag)
      - overrideLine() (update override_qty)
      - getFreshnessStatus() (query MIN/MAX last_sync_at)
      - listSnapshots() / getSnapshot() / getSnapshotLines()
  [ ] supply.controller.ts: 8 endpoints wired
  [ ] Test với Postman/curl (không cần data thật, có thể INSERT manual vào lot_attribute)

PHASE 3 — Bravo Upload (Day 3):
  [ ] bravo.service.ts:
      - Parse Excel (XLSX library)
      - Validate item_code + location_code vs master data
      - UPSERT lot_attribute
  [ ] bravo.controller.ts: POST /bravo/upload
  [ ] Test với file Excel mẫu (tạo file test 10 rows)

PHASE 4 — Frontend (Day 4-5):
  [ ] Tạo lib/api/supply.ts (9 functions)
  [ ] Viết page.tsx /supply (replace ModuleShell placeholder)
  [ ] S-1 FreshnessWidget: poll /freshness/status mỗi 5 phút
  [ ] S-2 StaleWarningBanner: conditional, show khi freshness=STALE
  [ ] S-3 SupplyKpiCards: 4 KPI từ active snapshot
  [ ] S-4 SnapshotListTable: list + freeze + view actions
  [ ] S-5 CaptureDialog: name input + submit
  [ ] S-6 BravoUploadDialog: file pick + upload + show result
  [ ] S-7 InventoryLinesTable: server-side paged, filter
  [ ] S-8 LineOverrideDialog: override qty + reason
  [ ] S-9 SnapshotDetailPanel: click View → show detail

PHASE 5 — Integration + Polish (Day 6):
  [ ] End-to-end test: Upload Bravo → Capture → Freeze → View Lines
  [ ] Stale flow: tạo lot_attribute cũ → capture → see banner → acknowledge
  [ ] Override flow: click line → override → check DRP query uses override_qty
  [ ] Skeleton loading cho tất cả sections
  [ ] Error states (toast notifications)
  [ ] Verify với AC-01 → AC-12
```

---

## ACCEPTANCE CRITERIA CHECKLIST

```
PHASE 1 — Migration + Backend
  [ ] AC-DB-1: 3 tables tạo đúng schema (lot_attribute, supply_snapshot, supply_snapshot_line)
  [ ] AC-DB-2: Unique constraint (item_code, location_code, lot_number) hoạt động (upsert không duplicate)
  [ ] AC-DB-3: FK supply_snapshot_line → supply_snapshot CASCADE DELETE hoạt động

PHASE 2 — Service Logic
  [ ] AC-SVC-1: captureSnapshot() aggregate đúng allocatable = on_hand - reserved
  [ ] AC-SVC-2: captureSnapshot() đặt freshness=STALE khi oldest_sync > 240 min
  [ ] AC-SVC-3: captureSnapshot() tạo đúng line per item × location (kể cả qty=0)
  [ ] AC-SVC-4: freezeSnapshot() reject nếu status ≠ DRAFT
  [ ] AC-SVC-5: freezeSnapshot() reject nếu freshness=STALE + staleAcknowledged=false
  [ ] AC-SVC-6: acknowledgeStale() chỉ update khi freshness=STALE
  [ ] AC-SVC-7: overrideLine() ghi đúng override_qty, reason, timestamp

PHASE 3 — Bravo Upload
  [ ] AC-BRV-1: Upload Excel → upsert lot_attribute thành công
  [ ] AC-BRV-2: Unmapped items/locations được report (không throw error)
  [ ] AC-BRV-3: last_sync_at được update = NOW() sau upload
  [ ] AC-BRV-4: Re-upload cùng file → update (không duplicate) — upsert ON CONFLICT

PHASE 4 — Frontend
  [ ] AC-FE-1: FreshnessWidget hiển thị đúng age + màu (green/yellow/red)
  [ ] AC-FE-2: StaleWarningBanner hiển thị khi freshness=STALE, ẩn khi PASS
  [ ] AC-FE-3: 3 action buttons trong banner hoạt động (Acknowledge / Capture / Override)
  [ ] AC-FE-4: SnapshotListTable render đúng status/freshness badge
  [ ] AC-FE-5: CaptureDialog → POST /snapshot/capture → list refresh
  [ ] AC-FE-6: BravoUploadDialog → POST /bravo/upload → show result stats
  [ ] AC-FE-7: InventoryLinesTable: search item_code filter, pagination đúng
  [ ] AC-FE-8: LineOverrideDialog → POST /lines/:id/override → line refresh
  [ ] AC-FE-9: Freeze button → POST /freeze → status badge đổi thành FROZEN

PHASE 5 — Business Flow (End-to-end)
  [ ] AC-E2E-1: Happy path: Upload Bravo → Capture (PASS) → Freeze → Lines visible
  [ ] AC-E2E-2: Stale path: lot_attribute cũ → Capture (STALE) → Banner → Acknowledge → Freeze OK
  [ ] AC-E2E-3: DRP query: SELECT allocatable_qty FROM supply_snapshot_line WHERE snapshot_id=:frozenId
                → sử dụng COALESCE(override_qty, allocatable_qty) cho DRP logic
```

---

## DEPENDENCY + INSTALL

```bash
# Backend — cài thêm
cd unis/backend
npm install xlsx          # parse Excel/CSV từ Bravo

# Đã có sẵn trong package.json (không cần cài):
# @nestjs/platform-express, @nestjs/typeorm, typeorm, pg, class-validator, class-transformer

# Frontend — không cần cài thêm
# Module 2 KHÔNG dùng chart library (không có chart nào trong spec)
# TailwindCSS đủ cho các badge/progress indicator
```

---

## BIZ RULE REMINDERS (tóm tắt nhanh cho dev)

```
BR-01: FRESHNESS_THRESHOLD = 240 phút (4 giờ) — UNIS Bravo batch mode
BR-02: Chỉ 2 bucket: ALLOCATABLE (on_hand - reserved) + RESERVED
        quarantine_qty = 0 LUÔN LUÔN (UNIS Phase 1)
BR-03: is_estimated = true nếu source_type = 'DISTRIBUTION' — flag cho DRP
BR-04: STALE → KHÔNG freeze được nếu chưa acknowledge
BR-05: in_transit_qty: capture nếu include_in_transit=true, nhưng DRP chỉ dùng nếu có ETA
BR-06: Zero qty lines VẪN tạo (DRP cần biết "0 tồn" vs "không có data")
BR-07: DRP query dùng: COALESCE(override_qty, allocatable_qty) — override takes priority
```

---

*MODULE-2-FULL-IMPLEMENT.md | Tech Lead | v1.1 | 2026-04-13*
*Scope: Backend NestJS (supply.module, service, controller, bravo) + Frontend (9 components, lib/api/supply.ts)*
*Ref: BA Spec docs/02-supply-snapshot.md (SCP-UNIS-02 v1.0)*
