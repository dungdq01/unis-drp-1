import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FreezeSnapshotDto {
  @ApiPropertyOptional({ description: 'User who froze the snapshot' })
  @IsOptional()
  @IsString()
  frozenBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
