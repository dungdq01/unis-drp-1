# Module 6 — Transport Planning: Full Implementation Guide

> **Version:** 1.2 | **Date:** 2026-04-15
> **Stack:** NestJS 10 · TypeORM · PostgreSQL · Next.js 14
> **Port BE:** 3002 | **Prefix:** `/transport`
> **Depends on:** Module 0 (item, location), Module 5 (allocation_result, allocation_run)

---

## 0. Tổng quan

Transport Planning nhận output từ Allocation (M5) và tạo kế hoạch vận chuyển:

```
allocation_result (status ALLOCATED/PARTIAL)
       │
       ▼
  Step 1: Group by (sourceLocation → locationCode)
       │
       ▼
  Step 2: FFD Bin-pack (FLATBED 25T only — CRANE_TRUCK via manual override)
       │  weight = allocatedQty × item.weight_per_unit_kg
       ▼
  Step 3: Carrier Selection (BEST_SLA: historical_otd_pct DESC)
       │
       ▼
  Step 4: Cost = lane.rate_vnd_per_km × lane.distance_km × vehicle.cost_multiplier
       ▼
  Step 5: ETA = departure_date + lane.lead_time_days
       ▼
  transport_plan + transport_trip + transport_trip_line
```

---

## 1. UNIS Constraints

```
1. PK types:
   - vehicle_type.id           → BIGSERIAL (BIGINT)
   - carrier.id                → BIGSERIAL (BIGINT)
   - transport_lane.id         → BIGSERIAL (BIGINT)
   - transport_plan.id         → BIGSERIAL (BIGINT)
   - transport_trip.id         → BIGSERIAL (BIGINT)
   - transport_trip_line.id    → BIGSERIAL (BIGINT)

2. Item/Location keys: VARCHAR (không phải UUID)
   - item_code VARCHAR(50)
   - location_code VARCHAR(20)
   - source_location_code, dest_location_code VARCHAR(20)

3. NO tenant_id — bỏ khỏi tất cả tables (D-MD-03)

4. Weight source: item.weight_per_unit_kg (thêm bằng migration)
   - Nếu item.weight_per_unit_kg = 0 → createPlan BLOCK (throw 400), không có silent fallback
   - DA phải seed weight trước khi BE test createPlan

5. Vehicle types: chỉ 2 loại
   - FLATBED: capacity_kg = 25000, cost_multiplier = 1.0
   - CRANE_TRUCK: capacity_kg = 15000, cost_multiplier = 1.3

6. Bin-pack: FFD (First-Fit Decreasing), weight-based
   - Chỉ dùng FLATBED (25T) cho auto bin-pack
   - CRANE_TRUCK chỉ dùng qua logistics override thủ công (PATCH /trips/:id)
   - CO2 = 0 (OFF Phase 1)

7. Carrier + Lane: dual-entry
   - CSV upload (parse xlsx/csv) + Manual CRUD API

8. Consolidation: OFF
   - 1 allocation_run_id = 1 transport_plan
   - Không gom nhiều runs vào 1 plan

9. Carrier selection: BEST_SLA = sort by historical_otd_pct DESC
   - Nếu không có carrier nào serve lane → trip.status = NO_CARRIER

10. Confirm flow:
    - transport_plan: DRAFT → CONFIRMED
    - transport_trip: PLANNED → (Step 7 sẽ xử lý)
    - Chỉ CONFIRMED plan mới được Step 7 đọc
```

---

## 2. DB Schema

### Migration: `001_item_weight_migration.sql`

```sql
-- Thêm weight_per_unit_kg vào item table (nếu chưa có)
ALTER TABLE item ADD COLUMN IF NOT EXISTS weight_per_unit_kg DECIMAL(10,2) NOT NULL DEFAULT 0;

-- ⚠️ [DA REQUIRED — KHÔNG tự đoán pattern]
-- Pattern LIKE '%60x60%' KHÔNG hoạt động với item_code thực tế của UNIS
-- (item_code format thực: TILE-ABC-001, không chứa kích thước trong code).
--
-- DA phải:
-- 1. Chạy query xem thực tế: SELECT DISTINCT item_code, item_name FROM item LIMIT 100;
-- 2. Xác định cột phân loại (item_category, item_group, item_name) để map weight
-- 3. Viết UPDATE theo category thực, ví dụ:
--    UPDATE item SET weight_per_unit_kg = 1200 WHERE item_category = 'GACH_60X60';
--    UPDATE item SET weight_per_unit_kg = 1000 WHERE item_category = 'GACH_30X60';
--    ...
--
-- Hoặc DA upload file CSV riêng: item_code, weight_per_unit_kg
-- rồi dùng COPY hoặc upsert script.
--
-- createPlan sẽ BLOCK (throw 400) nếu còn item nào weight_per_unit_kg = 0.
-- Không có fallback silent.
```

### Migration: `002_create_transport_tables.sql`

```sql
BEGIN;

-- ── vehicle_type ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_type (
    id               BIGSERIAL    PRIMARY KEY,
    code             VARCHAR(20)  NOT NULL UNIQUE,
      -- FLATBED | CRANE_TRUCK
    label            VARCHAR(50)  NOT NULL,
    capacity_kg      DECIMAL(10,2) NOT NULL,
    capacity_pallets INT          NOT NULL DEFAULT 0,
    cost_multiplier  DECIMAL(5,3) NOT NULL DEFAULT 1.0,
    is_active        BOOLEAN      NOT NULL DEFAULT true,
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

INSERT INTO vehicle_type (code, label, capacity_kg, capacity_pallets, cost_multiplier)
VALUES
  ('FLATBED',     'Xe tải phẳng 25T', 25000, 20, 1.0),
  ('CRANE_TRUCK', 'Xe cẩu 15T',       15000, 12, 1.3)
ON CONFLICT (code) DO NOTHING;

-- ── carrier ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carrier (
    id                   BIGSERIAL    PRIMARY KEY,
    carrier_code         VARCHAR(20)  NOT NULL UNIQUE,
    carrier_name         VARCHAR(100) NOT NULL,
    contact_phone        VARCHAR(20),
    historical_otd_pct   DECIMAL(5,4) NOT NULL DEFAULT 0.9,
      -- e.g. 0.94 = 94%
    supported_vehicles   VARCHAR(100) NOT NULL DEFAULT 'FLATBED,CRANE_TRUCK',
      -- comma-separated vehicle codes
    is_active            BOOLEAN      NOT NULL DEFAULT true,
    note                 TEXT,
    created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carrier_active ON carrier(is_active);

-- ── transport_lane ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_lane (
    id                   BIGSERIAL    PRIMARY KEY,
    source_location_code VARCHAR(20)  NOT NULL,
    dest_location_code   VARCHAR(20)  NOT NULL,
    distance_km          DECIMAL(8,2) NOT NULL DEFAULT 0,
    lead_time_days       INT          NOT NULL DEFAULT 1,
    rate_vnd_per_km      DECIMAL(12,2) NOT NULL DEFAULT 15000,
    carrier_codes        VARCHAR(200) NOT NULL DEFAULT '',
      -- comma-separated carrier_code list cho lane này
    is_active            BOOLEAN      NOT NULL DEFAULT true,
    note                 TEXT,
    created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE(source_location_code, dest_location_code)
);

CREATE INDEX IF NOT EXISTS idx_lane_source ON transport_lane(source_location_code);
CREATE INDEX IF NOT EXISTS idx_lane_dest   ON transport_lane(dest_location_code);

-- ── transport_plan ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_plan (
    id                  BIGSERIAL    PRIMARY KEY,
    allocation_run_id   BIGINT       NOT NULL UNIQUE REFERENCES allocation_run(id),
    status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
      -- DRAFT | CONFIRMED | CANCELLED
    total_trips         INT          NOT NULL DEFAULT 0,
    total_weight_kg     DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_cost_vnd      DECIMAL(18,2) NOT NULL DEFAULT 0,
    created_by          VARCHAR(100),
    confirmed_by        VARCHAR(100),
    confirmed_at        TIMESTAMP,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_plan_run ON transport_plan(allocation_run_id);
CREATE INDEX IF NOT EXISTS idx_transport_plan_status ON transport_plan(status);

-- ── transport_trip ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_trip (
    id                    BIGSERIAL    PRIMARY KEY,
    transport_plan_id     BIGINT       NOT NULL REFERENCES transport_plan(id),
    source_location_code  VARCHAR(20)  NOT NULL,
    dest_location_code    VARCHAR(20)  NOT NULL,
    vehicle_type_code     VARCHAR(20)  NOT NULL,
      -- FLATBED | CRANE_TRUCK
    carrier_code          VARCHAR(20),
      -- NULL = NO_CARRIER exception
    total_weight_kg       DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_pallets         INT          NOT NULL DEFAULT 0,
    estimated_cost_vnd    DECIMAL(18,2) NOT NULL DEFAULT 0,
    departure_date        DATE,
    eta_date              DATE,
    lead_time_days        INT          NOT NULL DEFAULT 1,
    status                VARCHAR(20)  NOT NULL DEFAULT 'PLANNED',
      -- PLANNED | NO_CARRIER | DISPATCHED | DELIVERED
    exception_note        TEXT,
    created_at            TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_plan   ON transport_trip(transport_plan_id);
CREATE INDEX IF NOT EXISTS idx_trip_route  ON transport_trip(source_location_code, dest_location_code);
CREATE INDEX IF NOT EXISTS idx_trip_status ON transport_trip(status);

-- ── transport_trip_line ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_trip_line (
    id                    BIGSERIAL    PRIMARY KEY,
    transport_trip_id     BIGINT       NOT NULL REFERENCES transport_trip(id),
    allocation_result_id  BIGINT       NOT NULL REFERENCES allocation_result(id),
    item_code             VARCHAR(50)  NOT NULL,
    allocated_qty         DECIMAL(15,2) NOT NULL DEFAULT 0,
    weight_kg             DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_line_trip ON transport_trip_line(transport_trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_line_alloc ON transport_trip_line(allocation_result_id);

COMMIT;
```

---

## 3. Entities

### `entities/vehicle-type.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('vehicle_type')
export class VehicleType {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  code: 'FLATBED' | 'CRANE_TRUCK';

  @Column({ type: 'varchar', length: 50 })
  label: string;

  @Column({ name: 'capacity_kg', type: 'decimal', precision: 10, scale: 2 })
  capacityKg: number;

  @Column({ name: 'capacity_pallets', type: 'int', default: 0 })
  capacityPallets: number;

  @Column({ name: 'cost_multiplier', type: 'decimal', precision: 5, scale: 3, default: 1.0 })
  costMultiplier: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### `entities/carrier.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('carrier')
export class Carrier {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'carrier_code', type: 'varchar', length: 20, unique: true })
  carrierCode: string;

  @Column({ name: 'carrier_name', type: 'varchar', length: 100 })
  carrierName: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true, default: null })
  contactPhone: string | null;

  @Column({ name: 'historical_otd_pct', type: 'decimal', precision: 5, scale: 4, default: 0.9 })
  historicalOtdPct: number;

  @Column({ name: 'supported_vehicles', type: 'varchar', length: 100, default: 'FLATBED,CRANE_TRUCK' })
  supportedVehicles: string; // comma-separated

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### `entities/transport-lane.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('transport_lane')
export class TransportLane {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'distance_km', type: 'decimal', precision: 8, scale: 2, default: 0 })
  distanceKm: number;

  @Column({ name: 'lead_time_days', type: 'int', default: 1 })
  leadTimeDays: number;

  @Column({ name: 'rate_vnd_per_km', type: 'decimal', precision: 12, scale: 2, default: 15000 })
  rateVndPerKm: number;

  @Column({ name: 'carrier_codes', type: 'varchar', length: 200, default: '' })
  carrierCodes: string; // comma-separated

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true, default: null })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### `entities/transport-plan.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('transport_plan')
export class TransportPlan {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'allocation_run_id', type: 'bigint', unique: true })
  allocationRunId: string;

  @Column({ type: 'varchar', length: 20, default: 'DRAFT' })
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

  @Column({ name: 'total_trips', type: 'int', default: 0 })
  totalTrips: number;

  @Column({ name: 'total_weight_kg', type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalWeightKg: number;

  @Column({ name: 'total_cost_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  totalCostVnd: number;

  @Column({ name: 'created_by', type: 'varchar', length: 100, nullable: true, default: null })
  createdBy: string | null;

  @Column({ name: 'confirmed_by', type: 'varchar', length: 100, nullable: true, default: null })
  confirmedBy: string | null;

  @Column({ name: 'confirmed_at', type: 'timestamp', nullable: true, default: null })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

### `entities/transport-trip.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('transport_trip')
export class TransportTrip {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transport_plan_id', type: 'bigint' })
  transportPlanId: string;

  @Column({ name: 'source_location_code', type: 'varchar', length: 20 })
  sourceLocationCode: string;

  @Column({ name: 'dest_location_code', type: 'varchar', length: 20 })
  destLocationCode: string;

  @Column({ name: 'vehicle_type_code', type: 'varchar', length: 20 })
  vehicleTypeCode: 'FLATBED' | 'CRANE_TRUCK';

  @Column({ name: 'carrier_code', type: 'varchar', length: 20, nullable: true, default: null })
  carrierCode: string | null;

  @Column({ name: 'total_weight_kg', type: 'decimal', precision: 10, scale: 2, default: 0 })
  totalWeightKg: number;

  @Column({ name: 'total_pallets', type: 'int', default: 0 })
  totalPallets: number;

  @Column({ name: 'estimated_cost_vnd', type: 'decimal', precision: 18, scale: 2, default: 0 })
  estimatedCostVnd: number;

  @Column({ name: 'departure_date', type: 'date', nullable: true, default: null })
  departureDate: string | null;

  @Column({ name: 'eta_date', type: 'date', nullable: true, default: null })
  etaDate: string | null;

  @Column({ name: 'lead_time_days', type: 'int', default: 1 })
  leadTimeDays: number;

  @Column({ type: 'varchar', length: 20, default: 'PLANNED' })
  status: 'PLANNED' | 'NO_CARRIER' | 'DISPATCHED' | 'DELIVERED';

  @Column({ name: 'exception_note', type: 'text', nullable: true, default: null })
  exceptionNote: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
```

### `entities/transport-trip-line.entity.ts`

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('transport_trip_line')
export class TransportTripLine {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'transport_trip_id', type: 'bigint' })
  transportTripId: string;

  @Column({ name: 'allocation_result_id', type: 'bigint' })
  allocationResultId: string;

  @Column({ name: 'item_code', type: 'varchar', length: 50 })
  itemCode: string;

  @Column({ name: 'allocated_qty', type: 'decimal', precision: 15, scale: 2, default: 0 })
  allocatedQty: number;

  @Column({ name: 'weight_kg', type: 'decimal', precision: 10, scale: 2, default: 0 })
  weightKg: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

---

## 4. Config

### `transport.config.ts`

```typescript
export const UNIS_TRANSPORT_CONFIG = {
  // [FIX] vehicle capacity/cost KHÔNG hard-code ở đây nữa.
  // Service đọc từ vehicle_type table qua _loadVehicleMap() khi createPlan.
  // Config bên dưới chỉ là FALLBACK an toàn nếu DB chưa seed (không nên xảy ra).
  vehicleFallback: {
    FLATBED:     { capacityKg: 25000, costMultiplier: 1.0 },
    CRANE_TRUCK: { capacityKg: 15000, costMultiplier: 1.3 },
  } as Record<string, { capacityKg: number; costMultiplier: number }>,

  // [FIX] weight = 0 → BLOCK createPlan, không dùng fallback silent
  // DA phải seed item.weight_per_unit_kg trước. Xem section DA Tasks.
  blockOnMissingWeight: true,

  consolidation: false,         // OFF Phase 1
  co2Tracking: false,           // OFF Phase 1
  carrierSelectionMode: 'BEST_SLA' as const,
  departureDaysFromToday: 1,    // departure = today + 1 ngày (Phase 2: working calendar)
  insertChunkSize: 500,
} as const;
```

---

## 5. DTOs

### `dto/index.ts`

```typescript
import { IsString, IsOptional, IsNumber, IsIn, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto';

// ── POST /transport/plans ──────────────────────────────────────────────────
export class CreateTransportPlanDto {
  @IsString()
  allocationRunId: string;

  @IsOptional() @IsString()
  createdBy?: string;
}

// ── GET /transport/plans/:id/trips ─────────────────────────────────────────
export class GetTripsQueryDto extends PaginationDto {
  @IsOptional() @IsString()
  sourceLocationCode?: string;

  @IsOptional() @IsString()
  destLocationCode?: string;

  @IsOptional() @IsIn(['FLATBED', 'CRANE_TRUCK'])
  vehicleTypeCode?: string;

  @IsOptional() @IsString()
  carrierCode?: string;

  @IsOptional() @IsIn(['PLANNED', 'NO_CARRIER', 'DISPATCHED', 'DELIVERED'])
  status?: string;
}

// ── PATCH /transport/trips/:id ─────────────────────────────────────────────
export class UpdateTripDto {
  @IsOptional() @IsString()
  carrierCode?: string;

  @IsOptional() @IsDateString()
  departureDate?: string;

  @IsOptional() @IsString()
  exceptionNote?: string;
}

// ── POST /transport/plans/:id/confirm ──────────────────────────────────────
export class ConfirmPlanDto {
  @IsOptional() @IsString()
  confirmedBy?: string;
}

// ── POST /transport/carriers (Manual CRUD) ─────────────────────────────────
export class UpsertCarrierDto {
  @IsString()
  carrierCode: string;

  @IsString()
  carrierName: string;

  @IsOptional() @IsString()
  contactPhone?: string;

  @IsOptional() @IsNumber() @Min(0) @Type(() => Number)
  historicalOtdPct?: number;

  @IsOptional() @IsString()
  supportedVehicles?: string;

  @IsOptional() @IsString()
  note?: string;
}

// ── POST /transport/lanes (Manual CRUD) ────────────────────────────────────
export class UpsertLaneDto {
  @IsString()
  sourceLocationCode: string;

  @IsString()
  destLocationCode: string;

  @IsNumber() @Min(0) @Type(() => Number)
  distanceKm: number;

  @IsNumber() @Min(1) @Type(() => Number)
  leadTimeDays: number;

  @IsNumber() @Min(0) @Type(() => Number)
  rateVndPerKm: number;

  @IsOptional() @IsString()
  carrierCodes?: string;

  @IsOptional() @IsString()
  note?: string;
}
```

---

## 6. Service

### `transport.service.ts`

```typescript
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import { TransportPlan } from './entities/transport-plan.entity';
import { TransportTrip } from './entities/transport-trip.entity';
import { TransportTripLine } from './entities/transport-trip-line.entity';
import { Carrier } from './entities/carrier.entity';
import { TransportLane } from './entities/transport-lane.entity';
import { UNIS_TRANSPORT_CONFIG } from './transport.config';
import {
  CreateTransportPlanDto, GetTripsQueryDto, UpdateTripDto,
  ConfirmPlanDto, UpsertCarrierDto, UpsertLaneDto,
} from './dto';

// ─── Internal types ───────────────────────────────────────────────────────────

interface AllocResult {
  id: string;
  itemCode: string;
  sourceLocationCode: string;   // = allocation_result.source_location_code
  destLocationCode: string;     // = allocation_result.dest_location_code
  allocatedQty: number;
  weightPerUnit: number;
}

interface TripDraft {
  sourceLocationCode: string;
  destLocationCode: string;
  vehicleTypeCode: 'FLATBED' | 'CRANE_TRUCK';
  totalWeightKg: number;
  totalPallets: number;
  lines: { allocationResultId: string; itemCode: string; allocatedQty: number; weightKg: number }[];
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class TransportService {
  constructor(
    @InjectRepository(TransportPlan)   private readonly planRepo: Repository<TransportPlan>,
    @InjectRepository(TransportTrip)   private readonly tripRepo: Repository<TransportTrip>,
    @InjectRepository(TransportTripLine) private readonly lineRepo: Repository<TransportTripLine>,
    @InjectRepository(Carrier)         private readonly carrierRepo: Repository<Carrier>,
    @InjectRepository(TransportLane)   private readonly laneRepo: Repository<TransportLane>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN: CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  async createPlan(dto: CreateTransportPlanDto): Promise<TransportPlan> {
    // Validate allocation_run exists + COMPLETED
    const [runRow]: { status: string }[] = await this.dataSource.query(
      `SELECT status FROM allocation_run WHERE id = $1::bigint`,
      [dto.allocationRunId],
    );
    if (!runRow) throw new NotFoundException(`allocation_run ${dto.allocationRunId} not found`);
    if (!['COMPLETED', 'PARTIAL'].includes(runRow.status))
      throw new ConflictException(`allocation_run status=${runRow.status}, cần COMPLETED hoặc PARTIAL`);

    // Check không duplicate
    const existing = await this.planRepo.findOne({ where: { allocationRunId: dto.allocationRunId } });
    if (existing) throw new ConflictException(`Transport plan đã tồn tại (id=${existing.id})`);

    // Load allocation results: ALLOCATED + PARTIAL, có sourceLocation
    const allocRows: AllocResult[] = await this.dataSource.query(`
      SELECT
        ar.id::text,
        ar.item_code                AS "itemCode",
        ar.source_location_code     AS "sourceLocationCode",
        ar.dest_location_code       AS "destLocationCode",
        ar.qty_allocated::float     AS "allocatedQty",
        COALESCE(i.weight_per_unit_kg, 0)::float AS "weightPerUnit"
      FROM allocation_result ar
      LEFT JOIN item i ON i.item_code = ar.item_code
      WHERE ar.allocation_run_id = $1::bigint
        AND ar.status IN ('ALLOCATED','PARTIAL')
        AND ar.source_location_code IS NOT NULL
        AND ar.qty_allocated > 0
    `, [dto.allocationRunId]);

    if (allocRows.length === 0)
      throw new BadRequestException('Không có allocation results nào để lập kế hoạch vận chuyển');

    // [FIX] Block nếu có item chưa được seed weight
    if (UNIS_TRANSPORT_CONFIG.blockOnMissingWeight) {
      const missing = allocRows.filter(r => r.weightPerUnit === 0).map(r => r.itemCode);
      const uniqueMissing = [...new Set(missing)];
      if (uniqueMissing.length > 0)
        throw new BadRequestException(
          `${uniqueMissing.length} item(s) chưa có weight_per_unit_kg: ${uniqueMissing.slice(0, 5).join(', ')}${uniqueMissing.length > 5 ? '...' : ''}. DA cần seed item.weight_per_unit_kg trước khi tạo transport plan.`,
        );
    }

    // Load vehicle config từ DB + lanes + carriers
    const [vehicleMap, laneMap, carrierMap] = await Promise.all([
      this._loadVehicleMap(),
      this._loadLaneMap(),
      this._loadCarrierMap(),
    ]);

    // FFD bin-pack per route (dùng vehicle config từ DB)
    const trips = this._buildTrips(allocRows, vehicleMap);

    // Create plan header
    const plan = await this.planRepo.save(
      this.planRepo.create({
        allocationRunId: dto.allocationRunId,
        status: 'DRAFT',
        createdBy: dto.createdBy ?? null,
      }),
    );

    // Enrich trips with lane + carrier + cost + ETA, then persist
    const today = new Date();
    const departureDate = new Date(today);
    departureDate.setDate(today.getDate() + UNIS_TRANSPORT_CONFIG.departureDaysFromToday);
    const departureDateStr = departureDate.toISOString().split('T')[0];

    let totalWeightKg = 0;
    let totalCostVnd = 0;
    const savedTripIds: string[] = [];

    for (const trip of trips) {
      const laneKey = `${trip.sourceLocationCode}||${trip.destLocationCode}`;
      const lane = laneMap.get(laneKey);

      // [FIX] Không dùng fallback silent nếu lane chưa setup → status = NO_LANE
      const hasLane = !!lane;
      const vehicleCfg = vehicleMap.get(trip.vehicleTypeCode)
        ?? UNIS_TRANSPORT_CONFIG.vehicleFallback[trip.vehicleTypeCode];
      const distanceKm   = lane?.distanceKm ?? 0;
      const ratePerKm    = lane?.rateVndPerKm ?? 0;
      const leadTimeDays = lane?.leadTimeDays ?? 1;
      // costVnd = 0 nếu không có lane (không fake cost = distance × fallback_rate)
      const costVnd = hasLane ? distanceKm * ratePerKm * vehicleCfg.costMultiplier : 0;

      // ETA
      const etaDate = new Date(departureDate);
      etaDate.setDate(departureDate.getDate() + leadTimeDays);
      const etaDateStr = etaDate.toISOString().split('T')[0];

      // Carrier selection: BEST_SLA among carriers serving this lane
      const laneCarrierCodes = (lane?.carrierCodes ?? '')
        .split(',').map(c => c.trim()).filter(Boolean);
      const carrierCode = this._selectBestCarrier(laneCarrierCodes, trip.vehicleTypeCode, carrierMap);

      // Trip status: NO_LANE > NO_CARRIER > PLANNED
      const tripStatus = !hasLane ? 'NO_CARRIER'  // reuse NO_CARRIER status, note phân biệt
        : !carrierCode ? 'NO_CARRIER'
        : 'PLANNED';
      const exceptionNote = !hasLane
        ? `NO_LANE: transport_lane chưa được setup cho route ${laneKey}`
        : !carrierCode
        ? `NO_CARRIER: không có carrier nào serve lane ${laneKey}`
        : null;

      const savedTrip = await this.tripRepo.save(
        this.tripRepo.create({
          transportPlanId: plan.id,
          sourceLocationCode: trip.sourceLocationCode,
          destLocationCode: trip.destLocationCode,
          vehicleTypeCode: trip.vehicleTypeCode,
          carrierCode: carrierCode,
          totalWeightKg: trip.totalWeightKg,
          totalPallets: trip.totalPallets,
          estimatedCostVnd: costVnd,
          departureDate: departureDateStr,
          etaDate: etaDateStr,
          leadTimeDays,
          status: tripStatus,
          exceptionNote,
        }),
      );

      // Bulk insert trip lines
      const CHUNK = UNIS_TRANSPORT_CONFIG.insertChunkSize;
      for (let i = 0; i < trip.lines.length; i += CHUNK) {
        await this.lineRepo.save(
          trip.lines.slice(i, i + CHUNK).map(l =>
            this.lineRepo.create({
              transportTripId: savedTrip.id,
              allocationResultId: l.allocationResultId,
              itemCode: l.itemCode,
              allocatedQty: l.allocatedQty,
              weightKg: l.weightKg,
            }),
          ),
        );
      }

      totalWeightKg += trip.totalWeightKg;
      totalCostVnd  += costVnd;
      savedTripIds.push(savedTrip.id);
    }

    // Update plan totals
    await this.planRepo.update(plan.id, {
      totalTrips: savedTripIds.length,
      totalWeightKg: Math.round(totalWeightKg * 100) / 100,
      totalCostVnd: Math.round(totalCostVnd),
    });

    return this.planRepo.findOne({ where: { id: plan.id } });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  private _buildTrips(
    results: AllocResult[],
    vehicleMap: Map<string, { capacityKg: number; costMultiplier: number }>,
  ): TripDraft[] {
    // Group by route (source → dest)
    const routeMap = new Map<string, AllocResult[]>();
    for (const r of results) {
      const key = `${r.sourceLocationCode}||${r.destLocationCode}`;
      const list = routeMap.get(key) ?? [];
      list.push(r);
      routeMap.set(key, list);
    }

    const trips: TripDraft[] = [];

    for (const [key, items] of routeMap) {
      const [src, dst] = key.split('||');

      // FFD: sort by weight DESC
      const weighted = items.map(r => ({
        ...r,
        weightKg: r.allocatedQty * r.weightPerUnit, // weightPerUnit > 0 guaranteed by createPlan block
      })).sort((a, b) => b.weightKg - a.weightKg);

      // FFD Bin-pack: luôn dùng FLATBED (25T).
      // CRANE_TRUCK (15T) KHÔNG được dùng cho overflow — vì CRANE nhỏ hơn FLATBED,
      // dùng CRANE cho overflow sẽ cần nhiều xe hơn và đắt hơn 1.3x.
      // Business rule UNIS Phase 1: chỉ dùng FLATBED cho bin-pack.
      // CRANE_TRUCK chỉ dùng khi logistics override thủ công (PATCH /trips/:id).
      // → nextType luôn là FLATBED khi overflow.
      const FLATBED_CAP = vehicleMap.get('FLATBED')?.capacityKg
        ?? UNIS_TRANSPORT_CONFIG.vehicleFallback['FLATBED'].capacityKg;

      let currentTrip: TripDraft | null = null;

      const startTrip = (vehicleType: 'FLATBED' | 'CRANE_TRUCK'): TripDraft => ({
        sourceLocationCode: src,
        destLocationCode: dst,
        vehicleTypeCode: vehicleType,
        totalWeightKg: 0,
        totalPallets: 0,
        lines: [],
      });

      for (const item of weighted) {
        if (!currentTrip) currentTrip = startTrip('FLATBED');

        if (currentTrip.totalWeightKg + item.weightKg <= FLATBED_CAP) {
          // Fit in current FLATBED trip
          currentTrip.totalWeightKg += item.weightKg;
          currentTrip.totalPallets  += Math.ceil(item.weightKg / 1200);
          currentTrip.lines.push({
            allocationResultId: item.id,
            itemCode: item.itemCode,
            allocatedQty: item.allocatedQty,
            weightKg: item.weightKg,
          });
        } else {
          // Close current trip, always open new FLATBED
          trips.push(currentTrip);
          currentTrip = startTrip('FLATBED');
          currentTrip.totalWeightKg += item.weightKg;
          currentTrip.totalPallets  += Math.ceil(item.weightKg / 1200);
          currentTrip.lines.push({
            allocationResultId: item.id,
            itemCode: item.itemCode,
            allocatedQty: item.allocatedQty,
            weightKg: item.weightKg,
          });
        }
      }

      if (currentTrip && currentTrip.lines.length > 0) trips.push(currentTrip);
    }

    return trips;
  }

  private _selectBestCarrier(
    laneCarrierCodes: string[],
    vehicleType: string,
    carrierMap: Map<string, { otdPct: number; vehicles: string }>,
  ): string | null {
    const eligible = laneCarrierCodes
      .map(code => ({ code, ...(carrierMap.get(code) ?? { otdPct: 0, vehicles: '' }) }))
      .filter(c => c.vehicles.split(',').map(v => v.trim()).includes(vehicleType))
      .sort((a, b) => b.otdPct - a.otdPct);
    return eligible[0]?.code ?? null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATA LOADERS
  // ═══════════════════════════════════════════════════════════════════════════

  // [FIX] Đọc vehicle config từ DB (vehicle_type table) thay vì hard-code
  private async _loadVehicleMap(): Promise<Map<string, { capacityKg: number; costMultiplier: number }>> {
    const rows: { code: string; capacity_kg: string; cost_multiplier: string }[] =
      await this.dataSource.query(
        `SELECT code, capacity_kg, cost_multiplier FROM vehicle_type WHERE is_active = true`,
      );
    const map = new Map<string, { capacityKg: number; costMultiplier: number }>();
    for (const r of rows) {
      map.set(r.code, {
        capacityKg: parseFloat(r.capacity_kg),
        costMultiplier: parseFloat(r.cost_multiplier),
      });
    }
    // Nếu DB chưa seed, fallback về config
    if (map.size === 0) {
      for (const [code, cfg] of Object.entries(UNIS_TRANSPORT_CONFIG.vehicleFallback)) {
        map.set(code, cfg);
      }
    }
    return map;
  }

  private async _loadLaneMap(): Promise<Map<string, { distanceKm: number; leadTimeDays: number; rateVndPerKm: number; carrierCodes: string }>> {
    const rows: { source: string; dest: string; distance_km: string; lead_time_days: number; rate_vnd_per_km: string; carrier_codes: string }[] =
      await this.dataSource.query(
        `SELECT source_location_code AS source, dest_location_code AS dest,
                distance_km, lead_time_days, rate_vnd_per_km, carrier_codes
         FROM transport_lane WHERE is_active = true`,
      );
    const map = new Map<string, any>();
    for (const r of rows) {
      map.set(`${r.source}||${r.dest}`, {
        distanceKm: parseFloat(r.distance_km),
        leadTimeDays: r.lead_time_days,
        rateVndPerKm: parseFloat(r.rate_vnd_per_km),
        carrierCodes: r.carrier_codes,
      });
    }
    return map;
  }

  private async _loadCarrierMap(): Promise<Map<string, { otdPct: number; vehicles: string }>> {
    const rows: { carrier_code: string; historical_otd_pct: string; supported_vehicles: string }[] =
      await this.dataSource.query(
        `SELECT carrier_code, historical_otd_pct, supported_vehicles FROM carrier WHERE is_active = true`,
      );
    const map = new Map<string, any>();
    for (const r of rows) {
      map.set(r.carrier_code, {
        otdPct: parseFloat(r.historical_otd_pct),
        vehicles: r.supported_vehicles,
      });
    }
    return map;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READ
  // ═══════════════════════════════════════════════════════════════════════════

  // allocation_run COMPLETED chưa có transport_plan — dùng cho FE dropdown
  async getEligibleRuns(): Promise<{ id: string; planRunId: string; completedAt: Date; totalOrders: number }[]> {
    // total_allocated = column thực trong allocation_run (verified vs entity)
    return this.dataSource.query(`
      SELECT ar.id::text, ar.plan_run_id::text AS "planRunId",
             ar.completed_at AS "completedAt", ar.total_allocated AS "totalOrders"
      FROM allocation_run ar
      WHERE ar.status IN ('COMPLETED', 'PARTIAL')
        AND NOT EXISTS (
          SELECT 1 FROM transport_plan tp WHERE tp.allocation_run_id = ar.id
        )
      ORDER BY ar.completed_at DESC
      LIMIT 50
    `);
  }

  async listPlans(page: number, pageSize: number) {
    const [data, total] = await this.planRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getPlan(id: string): Promise<TransportPlan> {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`transport_plan ${id} not found`);
    return plan;
  }

  async getTrips(planId: string, query: GetTripsQueryDto) {
    await this.getPlan(planId);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 200);

    const qb = this.tripRepo.createQueryBuilder('t')
      .where('t.transport_plan_id = :planId', { planId })
      .orderBy('t.source_location_code').addOrderBy('t.dest_location_code');

    if (query.vehicleTypeCode) qb.andWhere('t.vehicle_type_code = :vt', { vt: query.vehicleTypeCode });
    if (query.carrierCode)    qb.andWhere('t.carrier_code = :cc', { cc: query.carrierCode });
    if (query.sourceLocationCode) qb.andWhere('t.source_location_code ILIKE :src', { src: `%${query.sourceLocationCode}%` });
    if (query.destLocationCode)   qb.andWhere('t.dest_location_code ILIKE :dst', { dst: `%${query.destLocationCode}%` });
    if (query.status)         qb.andWhere('t.status = :st', { st: query.status });

    qb.skip((page - 1) * pageSize).take(pageSize);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async getTripLines(tripId: string) {
    const lines = await this.lineRepo.find({
      where: { transportTripId: tripId },
      order: { weightKg: 'DESC' },
    });
    return lines;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIP UPDATE (manual carrier change)
  // ═══════════════════════════════════════════════════════════════════════════

  async updateTrip(tripId: string, dto: UpdateTripDto): Promise<TransportTrip> {
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException(`transport_trip ${tripId} not found`);

    if (dto.carrierCode !== undefined) {
      trip.carrierCode = dto.carrierCode;
      trip.status = dto.carrierCode ? 'PLANNED' : 'NO_CARRIER';
    }
    if (dto.departureDate !== undefined) {
      trip.departureDate = dto.departureDate;
      // Recalc ETA
      const dep = new Date(dto.departureDate);
      dep.setDate(dep.getDate() + trip.leadTimeDays);
      trip.etaDate = dep.toISOString().split('T')[0];
    }
    if (dto.exceptionNote !== undefined) trip.exceptionNote = dto.exceptionNote;

    return this.tripRepo.save(trip);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRM
  // ═══════════════════════════════════════════════════════════════════════════

  async confirmPlan(planId: string, dto: ConfirmPlanDto): Promise<TransportPlan> {
    const plan = await this.getPlan(planId);
    if (plan.status !== 'DRAFT')
      throw new ConflictException(`Transport plan status=${plan.status}, chỉ DRAFT mới confirm được`);

    plan.status = 'CONFIRMED';
    plan.confirmedBy = dto.confirmedBy ?? null;
    plan.confirmedAt = new Date();
    return this.planRepo.save(plan);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CARRIER CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async listCarriers() {
    return this.carrierRepo.find({ order: { historicalOtdPct: 'DESC' } });
  }

  async upsertCarrier(dto: UpsertCarrierDto): Promise<Carrier> {
    const existing = await this.carrierRepo.findOne({ where: { carrierCode: dto.carrierCode } });
    if (existing) {
      Object.assign(existing, {
        carrierName: dto.carrierName,
        contactPhone: dto.contactPhone ?? existing.contactPhone,
        historicalOtdPct: dto.historicalOtdPct ?? existing.historicalOtdPct,
        supportedVehicles: dto.supportedVehicles ?? existing.supportedVehicles,
        note: dto.note ?? existing.note,
      });
      return this.carrierRepo.save(existing);
    }
    return this.carrierRepo.save(this.carrierRepo.create({
      carrierCode: dto.carrierCode,
      carrierName: dto.carrierName,
      contactPhone: dto.contactPhone ?? null,
      historicalOtdPct: dto.historicalOtdPct ?? 0.9,
      supportedVehicles: dto.supportedVehicles ?? 'FLATBED,CRANE_TRUCK',
      note: dto.note ?? null,
    }));
  }

  async deleteCarrier(id: string) {
    const c = await this.carrierRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`carrier ${id} not found`);
    await this.carrierRepo.update(id, { isActive: false });
    return { success: true };
  }

  async uploadCarriersCsv(buffer: Buffer): Promise<{ upserted: number; errors: string[] }> {
    const rows = this._parseCsv(buffer);
    const errors: string[] = [];
    let upserted = 0;

    for (const [i, row] of rows.entries()) {
      const code = (row['carrier_code'] ?? '').toString().trim();
      const name = (row['carrier_name'] ?? '').toString().trim();
      if (!code || !name) { errors.push(`Row ${i + 2}: thiếu carrier_code hoặc carrier_name`); continue; }
      try {
        await this.upsertCarrier({
          carrierCode: code,
          carrierName: name,
          contactPhone: row['contact_phone']?.toString().trim() || undefined,
          historicalOtdPct: row['historical_otd_pct'] ? parseFloat(row['historical_otd_pct']) : undefined,
          supportedVehicles: row['supported_vehicles']?.toString().trim() || undefined,
          note: row['note']?.toString().trim() || undefined,
        });
        upserted++;
      } catch (e) {
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    }
    return { upserted, errors };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LANE CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  async listLanes(page = 1, pageSize = 50) {
    const [data, total] = await this.laneRepo.findAndCount({
      order: { sourceLocationCode: 'ASC', destLocationCode: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { data, meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async upsertLane(dto: UpsertLaneDto): Promise<TransportLane> {
    const existing = await this.laneRepo.findOne({
      where: { sourceLocationCode: dto.sourceLocationCode, destLocationCode: dto.destLocationCode },
    });
    if (existing) {
      Object.assign(existing, {
        distanceKm: dto.distanceKm,
        leadTimeDays: dto.leadTimeDays,
        rateVndPerKm: dto.rateVndPerKm,
        carrierCodes: dto.carrierCodes ?? existing.carrierCodes,
        note: dto.note ?? existing.note,
      });
      return this.laneRepo.save(existing);
    }
    return this.laneRepo.save(this.laneRepo.create({
      sourceLocationCode: dto.sourceLocationCode,
      destLocationCode: dto.destLocationCode,
      distanceKm: dto.distanceKm,
      leadTimeDays: dto.leadTimeDays,
      rateVndPerKm: dto.rateVndPerKm,
      carrierCodes: dto.carrierCodes ?? '',
      note: dto.note ?? null,
    }));
  }

  async deleteLane(id: string) {
    const l = await this.laneRepo.findOne({ where: { id } });
    if (!l) throw new NotFoundException(`transport_lane ${id} not found`);
    await this.laneRepo.update(id, { isActive: false });
    return { success: true };
  }

  async uploadLanesCsv(buffer: Buffer): Promise<{ upserted: number; errors: string[] }> {
    const rows = this._parseCsv(buffer);
    const errors: string[] = [];
    let upserted = 0;

    for (const [i, row] of rows.entries()) {
      const src = (row['source_location_code'] ?? '').toString().trim();
      const dst = (row['dest_location_code'] ?? '').toString().trim();
      if (!src || !dst) { errors.push(`Row ${i + 2}: thiếu source/dest location_code`); continue; }
      try {
        await this.upsertLane({
          sourceLocationCode: src,
          destLocationCode: dst,
          distanceKm: parseFloat(row['distance_km'] ?? '0'),
          leadTimeDays: parseInt(row['lead_time_days'] ?? '1', 10),
          rateVndPerKm: parseFloat(row['rate_vnd_per_km'] ?? '15000'),
          carrierCodes: row['carrier_codes']?.toString().trim() || undefined,
          note: row['note']?.toString().trim() || undefined,
        });
        upserted++;
      } catch (e) {
        errors.push(`Row ${i + 2}: ${e.message}`);
      }
    }
    return { upserted, errors };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CSV PARSER (xlsx-based, reuse Module 2 pattern)
  // ═══════════════════════════════════════════════════════════════════════════

  private _parseCsv(buffer: Buffer): Record<string, unknown>[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
}
```

---

## 7. Controller

### `transport.controller.ts`

```typescript
import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  HttpCode, HttpStatus, UploadedFile, UseInterceptors, ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { TransportService } from './transport.service';
import {
  CreateTransportPlanDto, GetTripsQueryDto, UpdateTripDto,
  ConfirmPlanDto, UpsertCarrierDto, UpsertLaneDto,
} from './dto';

@ApiTags('transport')
@Controller('transport')
export class TransportController {
  constructor(private readonly svc: TransportService) {}

  // ── Eligible runs (cho FE dropdown "chọn allocation run để tạo plan") ────────

  @Get('eligible-runs')
  @ApiOperation({ summary: 'Danh sách allocation_run COMPLETED chưa có transport_plan' })
  getEligibleRuns() {
    return this.svc.getEligibleRuns();
  }

  // ── Plans ──────────────────────────────────────────────────────────────────

  @Post('plans')
  @ApiOperation({ summary: 'Create transport plan from allocation_run_id' })
  createPlan(@Body() dto: CreateTransportPlanDto) {
    return this.svc.createPlan(dto);
  }

  @Get('plans')
  @ApiOperation({ summary: 'List transport plans' })
  listPlans(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20,
  ) {
    return this.svc.listPlans(page, pageSize);
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get transport plan detail' })
  getPlan(@Param('id') id: string) {
    return this.svc.getPlan(id);
  }

  @Post('plans/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm transport plan (DRAFT → CONFIRMED)' })
  confirmPlan(@Param('id') id: string, @Body() dto: ConfirmPlanDto) {
    return this.svc.confirmPlan(id, dto);
  }

  // ── Trips ──────────────────────────────────────────────────────────────────

  @Get('plans/:id/trips')
  @ApiOperation({ summary: 'List trips for a transport plan (with filters)' })
  getTrips(@Param('id') id: string, @Query() query: GetTripsQueryDto) {
    return this.svc.getTrips(id, query);
  }

  @Get('trips/:id/lines')
  @ApiOperation({ summary: 'Get trip lines (allocation items on this trip)' })
  getTripLines(@Param('id') id: string) {
    return this.svc.getTripLines(id);
  }

  @Patch('trips/:id')
  @ApiOperation({ summary: 'Override carrier / departure date for a trip' })
  updateTrip(@Param('id') id: string, @Body() dto: UpdateTripDto) {
    return this.svc.updateTrip(id, dto);
  }

  // ── Carriers ───────────────────────────────────────────────────────────────

  @Get('carriers')
  @ApiOperation({ summary: 'List all active carriers' })
  listCarriers() { return this.svc.listCarriers(); }

  @Post('carriers')
  @ApiOperation({ summary: 'Create or update carrier (upsert by carrier_code)' })
  upsertCarrier(@Body() dto: UpsertCarrierDto) {
    return this.svc.upsertCarrier(dto);
  }

  @Delete('carriers/:id')
  @ApiOperation({ summary: 'Soft-delete carrier (is_active = false)' })
  deleteCarrier(@Param('id') id: string) {
    return this.svc.deleteCarrier(id);
  }

  @Post('carriers/upload')
  @ApiOperation({ summary: 'Upload carriers from CSV/Excel' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadCarriers(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    return this.svc.uploadCarriersCsv(file.buffer);
  }

  // ── Lanes ──────────────────────────────────────────────────────────────────

  @Get('lanes')
  @ApiOperation({ summary: 'List transport lanes (paginated)' })
  listLanes(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 50,
  ) {
    return this.svc.listLanes(page, pageSize);
  }

  @Post('lanes')
  @ApiOperation({ summary: 'Create or update lane (upsert by source+dest)' })
  upsertLane(@Body() dto: UpsertLaneDto) {
    return this.svc.upsertLane(dto);
  }

  @Delete('lanes/:id')
  @ApiOperation({ summary: 'Soft-delete lane' })
  deleteLane(@Param('id') id: string) {
    return this.svc.deleteLane(id);
  }

  @Post('lanes/upload')
  @ApiOperation({ summary: 'Upload lanes from CSV/Excel' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadLanes(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    return this.svc.uploadLanesCsv(file.buffer);
  }
}
```

---

## 8. Module

### `transport.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { TransportPlan } from './entities/transport-plan.entity';
import { TransportTrip } from './entities/transport-trip.entity';
import { TransportTripLine } from './entities/transport-trip-line.entity';
import { Carrier } from './entities/carrier.entity';
import { TransportLane } from './entities/transport-lane.entity';
import { VehicleType } from './entities/vehicle-type.entity';
import { TransportService } from './transport.service';
import { TransportController } from './transport.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TransportPlan, TransportTrip, TransportTripLine,
      Carrier, TransportLane, VehicleType,
    ]),
    MulterModule.register({ limits: { fileSize: 50 * 1024 * 1024 } }),
  ],
  providers: [TransportService],
  controllers: [TransportController],
  exports: [TransportService],
})
export class TransportModule {}
```

> **NOTE:** Register `TransportModule` trong `app.module.ts`. Thêm `multipart/form-data` support — đảm bảo `@nestjs/platform-express` đã install.

---

## 9. UNIS Errors mới (thêm vào `common/errors.ts`)

```typescript
// Thêm vào UNIS_ERR object:
TRANSPORT_PLAN_NOT_FOUND:  { code: 'UNIS-ERR-014', msg: 'Transport plan not found', status: 404 },
TRANSPORT_PLAN_NOT_DRAFT:  { code: 'UNIS-ERR-015', msg: 'Transport plan is not DRAFT', status: 409 },
TRANSPORT_TRIP_NOT_FOUND:  { code: 'UNIS-ERR-016', msg: 'Transport trip not found', status: 404 },
ALLOC_RUN_NOT_COMPLETED:   { code: 'UNIS-ERR-017', msg: 'Allocation run is not COMPLETED', status: 409 },
```

---

## 10. Frontend — `lib/api/transport.ts`

```typescript
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
function apiUrl(path: string) { return `${BASE_URL}/api/v1${path}`; }

async function handleRes<T>(res: Response): Promise<T> {
  if (!res.ok) { const t = await res.text().catch(() => res.statusText); throw new Error(`API ${res.status}: ${t}`); }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TransportPlan {
  id: string; allocationRunId: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
  totalTrips: number; totalWeightKg: number; totalCostVnd: number;
  createdBy: string | null; confirmedBy: string | null;
  confirmedAt: string | null; createdAt: string;
}

export interface TransportTrip {
  id: string; transportPlanId: string;
  sourceLocationCode: string; destLocationCode: string;
  vehicleTypeCode: 'FLATBED' | 'CRANE_TRUCK';
  carrierCode: string | null;
  totalWeightKg: number; totalPallets: number; estimatedCostVnd: number;
  departureDate: string | null; etaDate: string | null; leadTimeDays: number;
  status: 'PLANNED' | 'NO_CARRIER' | 'DISPATCHED' | 'DELIVERED';
  exceptionNote: string | null;
}

export interface TransportTripLine {
  id: string; transportTripId: string; allocationResultId: string;
  itemCode: string; allocatedQty: number; weightKg: number;
}

export interface Carrier {
  id: string; carrierCode: string; carrierName: string;
  contactPhone: string | null; historicalOtdPct: number;
  supportedVehicles: string; isActive: boolean; note: string | null;
}

export interface TransportLane {
  id: string; sourceLocationCode: string; destLocationCode: string;
  distanceKm: number; leadTimeDays: number; rateVndPerKm: number;
  carrierCodes: string; isActive: boolean;
}

export interface PageMeta { page: number; pageSize: number; total: number; totalPages: number; }

export interface EligibleRun {
  id: string;
  planRunId: string;
  completedAt: string;
  totalOrders: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const fetchEligibleRuns = () =>
  fetch(apiUrl('/transport/eligible-runs'), { cache: 'no-store' })
    .then(r => handleRes<EligibleRun[]>(r));

export const createTransportPlan = (allocationRunId: string, createdBy?: string) =>
  fetch(apiUrl('/transport/plans'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allocationRunId, createdBy }),
  }).then(r => handleRes<TransportPlan>(r));

export const fetchTransportPlans = (page = 1, pageSize = 20) =>
  fetch(apiUrl(`/transport/plans?page=${page}&pageSize=${pageSize}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: TransportPlan[]; meta: PageMeta }>(r));

export const fetchTransportPlan = (id: string) =>
  fetch(apiUrl(`/transport/plans/${id}`), { cache: 'no-store' })
    .then(r => handleRes<TransportPlan>(r));

export const fetchTrips = (planId: string, params: Record<string, string | number> = {}) => {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetch(apiUrl(`/transport/plans/${planId}/trips?${q}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: TransportTrip[]; meta: PageMeta }>(r));
};

export const fetchTripLines = (tripId: string) =>
  fetch(apiUrl(`/transport/trips/${tripId}/lines`), { cache: 'no-store' })
    .then(r => handleRes<TransportTripLine[]>(r));

export const updateTrip = (tripId: string, body: { carrierCode?: string; departureDate?: string }) =>
  fetch(apiUrl(`/transport/trips/${tripId}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => handleRes<TransportTrip>(r));

export const confirmPlan = (planId: string, confirmedBy?: string) =>
  fetch(apiUrl(`/transport/plans/${planId}/confirm`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmedBy }),
  }).then(r => handleRes<TransportPlan>(r));

export const fetchCarriers = () =>
  fetch(apiUrl('/transport/carriers'), { cache: 'no-store' })
    .then(r => handleRes<Carrier[]>(r));

export const upsertCarrier = (body: Partial<Carrier>) =>
  fetch(apiUrl('/transport/carriers'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => handleRes<Carrier>(r));

export const deleteCarrier = (id: string) =>
  fetch(apiUrl(`/transport/carriers/${id}`), { method: 'DELETE' }).then(r => handleRes(r));

export const fetchLanes = (page = 1, pageSize = 50) =>
  fetch(apiUrl(`/transport/lanes?page=${page}&pageSize=${pageSize}`), { cache: 'no-store' })
    .then(r => handleRes<{ data: TransportLane[]; meta: PageMeta }>(r));

export const upsertLane = (body: Partial<TransportLane>) =>
  fetch(apiUrl('/transport/lanes'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => handleRes<TransportLane>(r));

export const deleteLane = (id: string) =>
  fetch(apiUrl(`/transport/lanes/${id}`), { method: 'DELETE' }).then(r => handleRes(r));

export const uploadCarriersCsv = (file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return fetch(apiUrl('/transport/carriers/upload'), { method: 'POST', body: fd })
    .then(r => handleRes<{ upserted: number; errors: string[] }>(r));
};

export const uploadLanesCsv = (file: File) => {
  const fd = new FormData(); fd.append('file', file);
  return fetch(apiUrl('/transport/lanes/upload'), { method: 'POST', body: fd })
    .then(r => handleRes<{ upserted: number; errors: string[] }>(r));
};
```

---

## 11. CSV Upload Format

### Carrier CSV columns

```
carrier_code | carrier_name | contact_phone | historical_otd_pct | supported_vehicles | note
CARRIER-A    | Vận tải A   | 0909123456    | 0.94               | FLATBED,CRANE_TRUCK |
```

### Lane CSV columns

```
source_location_code | dest_location_code | distance_km | lead_time_days | rate_vnd_per_km | carrier_codes | note
WH-DN-001            | CN-HUE-001         | 110         | 2              | 15000           | CARRIER-A,CARRIER-B |
```

---

## 12. Task Checklist

### Prerequisites

```
P1  [ ] Chạy migration 001_item_weight_migration.sql — thêm weight_per_unit_kg + seed
P2  [ ] Verify: item.weight_per_unit_kg > 0 cho các items trong allocation_result
```

### Backend

```
BE-1  [ ] Tạo src/transport/
BE-2  [ ] Tạo 6 entity files (vehicle-type, carrier, transport-lane, transport-plan, transport-trip, transport-trip-line)
BE-3  [ ] Chạy migration 002_create_transport_tables.sql (vehicle_type đã seeded 2 rows)
BE-4  [ ] Thêm UNIS_ERR-014..017 vào common/errors.ts
BE-5  [ ] Tạo transport.config.ts
BE-6  [ ] Tạo dto/index.ts
BE-7  [ ] Tạo transport.service.ts
BE-8  [ ] Tạo transport.controller.ts
BE-9  [ ] Tạo transport.module.ts — import MulterModule
BE-10 [ ] Register TransportModule trong app.module.ts
BE-11 [ ] Verify: npm run build không có TS error
BE-12 [ ] Swagger test: POST /transport/plans với allocationRunId hợp lệ
BE-13 [ ] Verify: GET /transport/plans/:id/trips trả đúng vehicle_type_code
BE-14 [ ] Test PATCH /transport/trips/:id (override carrier)
BE-15 [ ] Test POST /transport/plans/:id/confirm
BE-16 [ ] Test POST /transport/carriers/upload (upload CSV)
BE-17 [ ] Test POST /transport/lanes/upload (upload CSV)
```

### Frontend

```
FE-1  [ ] Tạo lib/api/transport.ts
FE-2  [ ] Rebuild app/transport/page.tsx — 4 tabs: Plans | Trips | Carriers | Lanes
FE-3  [ ] Tab Plans: list + KPI cards (trips, weight, cost) + "Create Plan" button
FE-4  [ ] Tab Trips: table + filters (vehicle, carrier, route, status) + carrier override
FE-5  [ ] Tab Carriers: table + manual form add/edit + CSV upload dropzone
FE-6  [ ] Tab Lanes: table + manual form add/edit + CSV upload dropzone
FE-7  [ ] Confirm Plan button → POST /transport/plans/:id/confirm
FE-8  [ ] Trip lines drawer: expand row → hiển thị item detail + weight
```

### Data

```
DA-1  [ ] Seed carrier: ít nhất 3 carriers mẫu (dùng CSV upload hoặc SQL)
DA-2  [ ] Seed lane: các routes chính từ RTM rules (source WH → dest branch)
         Gợi ý: auto-generate từ SELECT DISTINCT warehouse_code, branch_code FROM rtm_rule WHERE is_active=true
```

---

## 13. Known Issues & Notes

| ID | Issue | Trạng thái |
|---|---|---|
| ~~NOTE-1~~ | ~~`weight_per_unit_kg` = 0 → fallback silent~~ | ✅ Fixed v1.1: `createPlan` block 400 nếu còn item weight=0 |
| ~~NOTE-4~~ | ~~Vehicle config hard-code trong `UNIS_TRANSPORT_CONFIG`~~ | ✅ Fixed v1.1: `_loadVehicleMap()` đọc từ `vehicle_type` table |
| NOTE-2 | `carrier_codes` trên lane lưu comma-separated (không normalize) | Phase 2: tách thành join table `lane_carrier` |
| NOTE-3 | Consolidation OFF: mỗi `allocation_run` chỉ có 1 `transport_plan` (UNIQUE constraint) | Phase 2: bỏ UNIQUE nếu bật consolidation |
| NOTE-5 | Departure date = today + 1 ngày (config-only, không check lịch nghỉ) | Phase 2: thêm working calendar |
| NOTE-6 | CRANE_TRUCK không được dùng trong auto bin-pack — chỉ dùng qua logistics override (PATCH /trips/:id) | Đây là business decision UNIS Phase 1 — document rõ cho logistics team |
| NOTE-7 | `migration 001` seed script bị xóa vì pattern LIKE sai với item_code thực tế | DA viết lại theo item_category thực trong DB |

---

*MODULE-6-FULL-IMPLEMENT.md v1.2 — UNIS Transport Planning*
*Created: 2026-04-15 | Updated: 2026-04-15*
*Changes v1.1: Fix FFD CRANE_TRUCK logic, vehicle config từ DB, block missing weight, NO_LANE exception, eligible-runs endpoint, seed script warning*
*Changes v1.2: BUG-1 planned_orders_count→total_orders, BUG-2 remove dead defaultWeightKg fallback, BUG-3 sync PARTIAL status giữa createPlan+getEligibleRuns, DOC-1/2 §0+§1 align với code, FE EligibleRun type + fetchEligibleRuns()*
