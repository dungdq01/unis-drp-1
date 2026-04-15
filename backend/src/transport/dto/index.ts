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

// ── POST /transport/carriers ───────────────────────────────────────────────
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

// ── POST /transport/lanes ──────────────────────────────────────────────────
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
