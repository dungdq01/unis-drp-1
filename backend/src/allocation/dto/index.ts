import { IsString, IsOptional, IsIn, IsNumber, IsArray, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAllocationRunDto {
  @IsString()
  planRunId: string;

  @IsOptional()
  @IsString()
  supplySnapshotId?: string;

  @IsOptional()
  @IsString()
  createdBy?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  dispatchLimitOverride?: number;
}

export class GetResultsQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 50;

  @IsOptional()
  @IsIn(['ALLOCATED', 'PARTIAL', 'UNALLOCATED'])
  status?: 'ALLOCATED' | 'PARTIAL' | 'UNALLOCATED';

  @IsOptional()
  @IsString()
  itemCode?: string;

  @IsOptional()
  @IsString()
  destLocationCode?: string;

  @IsOptional()
  @IsString()
  sourceLocationCode?: string;

  @IsOptional()
  @IsIn(['A', 'B', 'C'])
  abcClass?: 'A' | 'B' | 'C';
}

export class GetRecommendationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 50;

  @IsOptional()
  @IsIn(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'])
  status?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
}

export class DecideRecommendationDto {
  @IsIn(['ACCEPTED', 'REJECTED'])
  decision: 'ACCEPTED' | 'REJECTED';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  adjustedQty?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  decidedBy?: string;
}

export class RetryAllocationDto {
  @IsArray()
  @IsString({ each: true })
  plannedOrderReleaseIds: string[];

  @IsOptional()
  @IsString()
  reason?: string;
}
