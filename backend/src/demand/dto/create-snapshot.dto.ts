import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsDateString } from 'class-validator';

/**
 * G10: Create empty DRAFT snapshot (no CSV upload).
 * Spec 01-demand-ingestion.md §6.4 — POST /api/v1/demand/snapshot
 */
export class CreateSnapshotDto {
  @ApiProperty({ description: 'Human-readable name' })
  @IsNotEmpty()
  @IsString()
  snapshotName: string;

  @ApiPropertyOptional({ description: 'Run ID (e.g. W9_20260406)' })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiPropertyOptional({ description: 'Planning horizon start (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  horizonStart?: string;

  @ApiPropertyOptional({ description: 'Planning horizon end (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  horizonEnd?: string;

  @ApiPropertyOptional({ description: 'User creating the snapshot' })
  @IsOptional()
  @IsString()
  createdBy?: string;

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}
