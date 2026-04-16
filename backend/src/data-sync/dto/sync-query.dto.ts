import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SyncHistoryQueryDto {
  @IsOptional()
  @IsString()
  nmCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;
}

export class OverrideDto {
  @IsString()
  reason: string;

  @IsString()
  approvedBy: string;

  @IsOptional()
  @IsString()
  planRunId?: string;
}
