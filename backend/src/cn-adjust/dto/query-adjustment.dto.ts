import { IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class AdjustHistoryQueryDto {
  @IsOptional() @IsString()
  cnId?: string;

  @IsOptional() @IsDateString()
  periodStart?: string;

  @IsOptional() @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize: number = 20;
}
