import { IsString, IsOptional, IsIn, IsBoolean, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PaginationDto } from '../../common/pagination.dto';

export class CreatePolicyRunDto {
  @ApiProperty()
  @IsString()
  runName: string;

  @ApiProperty()
  @IsString()
  demandSnapshotId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  createdBy?: string;
}

export class ImportAbcDto {
  @ApiProperty()
  @IsString()
  demandSnapshotId: string;
}

export class GetSsTargetsQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  policyRunId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  itemCode?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ enum: ['A', 'B', 'C'] })
  @IsOptional() @IsIn(['A', 'B', 'C'])
  abcClass?: 'A' | 'B' | 'C';

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  lcnbFlag?: boolean;
}

export class OverrideSsDto {
  @ApiProperty()
  @IsInt() @Min(0)
  @Type(() => Number)
  overrideSs: number;

  @ApiProperty()
  @IsString()
  reason: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  userId?: string;
}

export class CreateRtmRouteDto {
  @ApiProperty()
  @IsString()
  branchCode: string;

  @ApiProperty()
  @IsString()
  warehouseCode: string;

  @ApiProperty()
  @IsInt() @Min(1) @Max(3)
  @Type(() => Number)
  priority: 1 | 2 | 3;

  @ApiProperty()
  @IsInt() @Min(0)
  @Type(() => Number)
  transportDays: number;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number)
  transportCost?: number;

  @ApiPropertyOptional()
  @IsOptional() @Type(() => Number)
  minOrderQty?: number;
}

export class ActivatePolicyRunDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  activatedBy?: string;
}

export class GetAbcQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  snapshotId?: string;

  @ApiPropertyOptional({ enum: ['A', 'B', 'C'] })
  @IsOptional() @IsIn(['A', 'B', 'C'])
  abcClass?: 'A' | 'B' | 'C';

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  discrepancyFlag?: boolean;
}

export class GetRtmQueryDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString()
  branchCode?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  warehouseCode?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(1) @Max(3) @Type(() => Number)
  priority?: 1 | 2 | 3;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean() @Type(() => Boolean)
  isActive?: boolean;
}
