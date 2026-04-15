import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class GetLinesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by item_code (partial match)' })
  @IsOptional()
  @IsString()
  itemCode?: string;

  @ApiPropertyOptional({ description: 'Filter by location_code (partial match)' })
  @IsOptional()
  @IsString()
  locationCode?: string;

  @ApiPropertyOptional({ enum: ['PASS', 'STALE'], description: 'Filter by freshness status' })
  @IsOptional()
  @IsIn(['PASS', 'STALE'])
  freshness?: 'PASS' | 'STALE';

  @ApiPropertyOptional({ enum: ['oem', 'estimated'], description: 'Filter by source type: oem=is_estimated false, estimated=is_estimated true' })
  @IsOptional()
  @IsIn(['oem', 'estimated'])
  estimated?: 'oem' | 'estimated';
}
