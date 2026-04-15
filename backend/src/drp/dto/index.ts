import { IsString, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../common/pagination.dto';

export class CreateDrpRunDto {
  @ApiProperty({ description: 'UUID của demand_snapshot (phải FROZEN)' })
  @IsString()
  demandSnapshotId: string;

  @ApiProperty({ description: 'ID (BIGINT) của supply_snapshot (phải FROZEN)' })
  @IsInt()
  @Type(() => Number)
  supplySnapshotId: number;

  @ApiPropertyOptional({ description: 'Ngày bắt đầu horizon ISO string (default: demand_snapshot.horizon_start)' })
  @IsOptional()
  @IsString()
  horizonStart?: string;

  @ApiPropertyOptional({ description: 'Số tuần horizon (default: 12, range: 4–24)' })
  @IsOptional()
  @IsInt()
  @Min(4)
  @Max(24)
  @Type(() => Number)
  horizonWeeks?: number;

  @ApiPropertyOptional({ description: 'Frozen zone (số tuần đầu cần planner duyệt, default: 2, range: 0–8)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(8)
  @Type(() => Number)
  frozenZone?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class GetPlannedOrdersQueryDto extends PaginationDto {
  planRunId?: string; // injected from route param

  @ApiPropertyOptional() @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Type(() => Number)
  weekNumber?: number;

  @ApiPropertyOptional({ enum: ['AUTO_RELEASE', 'NEEDS_APPROVAL', 'RELEASED', 'CANCELLED'] })
  @IsOptional() @IsString()
  status?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() @Type(() => Boolean)
  frozenZoneFlag?: boolean;
}

export class GetExceptionsQueryDto extends PaginationDto {
  planRunId?: string; // injected from route param

  @ApiPropertyOptional({ enum: ['PAB_NEGATIVE','STOCKOUT_ALERT','OVERSTOCK_ALERT','FROZEN_ZONE_VIOLATION','MISSING_SS','NETTING_TIMEOUT'] })
  @IsOptional() @IsString()
  type?: string;

  @ApiPropertyOptional({ enum: ['HIGH', 'MEDIUM', 'LOW'] })
  @IsOptional() @IsString()
  severity?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() @Type(() => Boolean)
  resolved?: boolean;
}

export class ResolveExceptionDto {
  @ApiProperty()
  @IsString()
  resolutionNote: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  resolvedBy?: string;
}

export class ApprovePlannedOrderDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  approvedBy?: string;
}

export class CancelPlannedOrderDto {
  @ApiProperty()
  @IsString()
  reason: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  cancelledBy?: string;
}
