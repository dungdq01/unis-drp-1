import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../common/pagination.dto';

export class ListSnapshotsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by status (DRAFT, FROZEN)' })
  @IsOptional()
  @IsString()
  status?: string;
}
