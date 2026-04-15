import { IsOptional, IsString, IsIn, IsInt, Min, Max, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

// ── Compute KPI ───────────────────────────────────────────────────────────────
export class ComputeKpiDto {
  @ApiPropertyOptional({ example: 'planner' })
  @IsOptional() @IsString()
  computedBy?: string;
}

// ── List KPI Snapshots ────────────────────────────────────────────────────────
export class ListKpiQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  periodType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  kpiGroup?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  kpiCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

// ── HSTK Query ────────────────────────────────────────────────────────────────
export class HstkQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional({ enum: ['STOCKOUT', 'OK', 'OVERSTOCK'] })
  @IsOptional() @IsIn(['STOCKOUT', 'OK', 'OVERSTOCK'])
  classification?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}

// ── List Alerts ───────────────────────────────────────────────────────────────
export class ListAlertsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  severity?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  alertType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  acknowledged?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number;
}

// ── Acknowledge Alert ─────────────────────────────────────────────────────────
export class AcknowledgeAlertDto {
  @ApiPropertyOptional({ example: 'planner' })
  @IsOptional() @IsString()
  acknowledgedBy?: string;
}
