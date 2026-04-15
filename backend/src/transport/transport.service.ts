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
  sourceLocationCode: string;
  destLocationCode: string;
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
    @InjectRepository(TransportPlan)     private readonly planRepo: Repository<TransportPlan>,
    @InjectRepository(TransportTrip)     private readonly tripRepo: Repository<TransportTrip>,
    @InjectRepository(TransportTripLine) private readonly lineRepo: Repository<TransportTripLine>,
    @InjectRepository(Carrier)           private readonly carrierRepo: Repository<Carrier>,
    @InjectRepository(TransportLane)     private readonly laneRepo: Repository<TransportLane>,
    private readonly dataSource: DataSource,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // PLAN: CREATE
  // ═══════════════════════════════════════════════════════════════════════════

  async createPlan(dto: CreateTransportPlanDto): Promise<TransportPlan> {
    const [runRow]: { status: string }[] = await this.dataSource.query(
      `SELECT status FROM allocation_run WHERE id = $1::bigint`,
      [dto.allocationRunId],
    );
    if (!runRow) throw new NotFoundException(`allocation_run ${dto.allocationRunId} not found`);
    if (!['COMPLETED', 'PARTIAL'].includes(runRow.status))
      throw new ConflictException(`allocation_run status=${runRow.status}, cần COMPLETED hoặc PARTIAL`);

    const existing = await this.planRepo.findOne({ where: { allocationRunId: dto.allocationRunId } });
    if (existing) throw new ConflictException(`Transport plan đã tồn tại (id=${existing.id})`);

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

    if (UNIS_TRANSPORT_CONFIG.blockOnMissingWeight) {
      const missing = allocRows.filter(r => r.weightPerUnit === 0).map(r => r.itemCode);
      const uniqueMissing = [...new Set(missing)];
      if (uniqueMissing.length > 0)
        throw new BadRequestException(
          `${uniqueMissing.length} item(s) chưa có weight_per_unit_kg: ${uniqueMissing.slice(0, 5).join(', ')}${uniqueMissing.length > 5 ? '...' : ''}. DA cần seed item.weight_per_unit_kg trước khi tạo transport plan.`,
        );
    }

    const [vehicleMap, laneMap, carrierMap] = await Promise.all([
      this._loadVehicleMap(),
      this._loadLaneMap(),
      this._loadCarrierMap(),
    ]);

    const trips = this._buildTrips(allocRows, vehicleMap);

    const plan = await this.planRepo.save(
      this.planRepo.create({
        allocationRunId: dto.allocationRunId,
        status: 'DRAFT',
        createdBy: dto.createdBy ?? null,
      }),
    );

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

      const hasLane = !!lane;
      const vehicleCfg = vehicleMap.get(trip.vehicleTypeCode)
        ?? UNIS_TRANSPORT_CONFIG.vehicleFallback[trip.vehicleTypeCode];
      const distanceKm   = lane?.distanceKm ?? 0;
      const ratePerKm    = lane?.rateVndPerKm ?? 0;
      const leadTimeDays = lane?.leadTimeDays ?? 1;
      const costVnd = hasLane ? distanceKm * ratePerKm * vehicleCfg.costMultiplier : 0;

      const etaDate = new Date(departureDate);
      etaDate.setDate(departureDate.getDate() + leadTimeDays);
      const etaDateStr = etaDate.toISOString().split('T')[0];

      const laneCarrierCodes = (lane?.carrierCodes ?? '')
        .split(',').map(c => c.trim()).filter(Boolean);
      const carrierCode = this._selectBestCarrier(laneCarrierCodes, trip.vehicleTypeCode, carrierMap);

      const tripStatus = !hasLane ? 'NO_CARRIER'
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

    await this.planRepo.update(plan.id, {
      totalTrips: savedTripIds.length,
      totalWeightKg: Math.round(totalWeightKg * 100) / 100,
      totalCostVnd: Math.round(totalCostVnd),
    });

    return this.planRepo.findOne({ where: { id: plan.id } }) as Promise<TransportPlan>;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CORE ENGINE
  // ═══════════════════════════════════════════════════════════════════════════

  private _buildTrips(
    results: AllocResult[],
    vehicleMap: Map<string, { capacityKg: number; costMultiplier: number }>,
  ): TripDraft[] {
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

      const weighted = items.map(r => ({
        ...r,
        weightKg: r.allocatedQty * r.weightPerUnit,
      })).sort((a, b) => b.weightKg - a.weightKg);

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
          currentTrip.totalWeightKg += item.weightKg;
          currentTrip.totalPallets  += Math.ceil(item.weightKg / 1200);
          currentTrip.lines.push({
            allocationResultId: item.id,
            itemCode: item.itemCode,
            allocatedQty: item.allocatedQty,
            weightKg: item.weightKg,
          });
        } else {
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

  async getEligibleRuns(): Promise<{ id: string; planRunId: string; completedAt: Date; totalDemandLines: number; totalAllocated: number }[]> {
    return this.dataSource.query(`
      SELECT ar.id::text, ar.plan_run_id::text AS "planRunId",
             ar.completed_at AS "completedAt",
             ar.total_demand_lines AS "totalDemandLines",
             ar.total_allocated    AS "totalAllocated"
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
    const trip = await this.tripRepo.findOne({ where: { id: tripId } });
    if (!trip) throw new NotFoundException(`transport_trip ${tripId} not found`);
    return this.lineRepo.find({
      where: { transportTripId: tripId },
      order: { weightKg: 'DESC' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TRIP UPDATE
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
          historicalOtdPct: row['historical_otd_pct'] ? parseFloat(row['historical_otd_pct'] as string) : undefined,
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
          distanceKm: parseFloat(row['distance_km'] as string ?? '0'),
          leadTimeDays: parseInt(row['lead_time_days'] as string ?? '1', 10),
          rateVndPerKm: parseFloat(row['rate_vnd_per_km'] as string ?? '15000'),
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
  // CSV PARSER
  // ═══════════════════════════════════════════════════════════════════════════

  private _parseCsv(buffer: Buffer): Record<string, unknown>[] {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: '' });
  }
}
