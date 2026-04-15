import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsInt, Min, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export type AccuracyMonth = 't10' | 't11' | 't12' | 't1';
export type WinnerFilter = 'MODEL' | 'MA3' | 'ALL';
export type SortKey = 'actual_desc' | 'accuracy_asc' | 'accuracy_desc' | 'gain_desc';

export class AccuracySkuQueryDto {
  @ApiPropertyOptional({ enum: ['t10', 't11', 't12', 't1'], default: 't1' })
  @IsOptional()
  @IsIn(['t10', 't11', 't12', 't1'])
  month: AccuracyMonth = 't1';

  @ApiPropertyOptional({ description: 'Segment A/B/C' })
  @IsOptional()
  @IsString()
  segment?: string;

  @ApiPropertyOptional({ enum: ['MODEL', 'MA3', 'ALL'], default: 'ALL' })
  @IsOptional()
  @IsIn(['MODEL', 'MA3', 'ALL'])
  winner: WinnerFilter = 'ALL';

  @ApiPropertyOptional({ enum: ['actual_desc', 'accuracy_asc', 'accuracy_desc', 'gain_desc'], default: 'actual_desc' })
  @IsOptional()
  @IsIn(['actual_desc', 'accuracy_asc', 'accuracy_desc', 'gain_desc'])
  sort: SortKey = 'actual_desc';

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize: number = 50;
}

export class WorstPerformersDto {
  @ApiPropertyOptional({ enum: ['t12', 't1'], default: 't1' })
  @IsOptional()
  @IsIn(['t12', 't1'])
  month: 't12' | 't1' = 't1';

  @ApiPropertyOptional({ default: 20, description: 'Max accuracy % to be considered "worst"' })
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  threshold: number = 20;

  @ApiPropertyOptional({ default: 100, description: 'Min actual volume (skip dormant)' })
  @Type(() => Number)
  @IsOptional()
  @IsNumber()
  minActual: number = 100;

  @ApiPropertyOptional({ default: 50 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize: number = 50;
}
