import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for /forecast/alerts and /forecast/branches (paginated).
 * Pattern per feedback_nestjs_query_params.md — @Type numeric coercion avoids NaN.
 */
export class InsightsPaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  snapshotId?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize: number = 20;
}
