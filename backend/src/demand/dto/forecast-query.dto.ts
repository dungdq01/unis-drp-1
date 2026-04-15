import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class ForecastQueryDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  snapshotId?: string;

  @ApiPropertyOptional({ description: 'Filter by segment (A, B, C)' })
  @IsOptional()
  @IsString()
  segment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  itemCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  locationCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  comboClass?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  branchArchetype?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  tetFlag?: string;

  /** G11: summary group_by — comma-separated, subset of item,segment,location,period */
  @ApiPropertyOptional({ description: 'Comma-separated dimensions: item,segment,location,period' })
  @IsOptional()
  @IsString()
  groupBy?: string;
}
