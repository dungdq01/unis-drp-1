import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsIn, IsUUID } from 'class-validator';

export class UploadForecastDto {
  @ApiPropertyOptional({ description: 'Run ID to associate with' })
  @IsOptional()
  @IsString()
  runId?: string;

  @ApiPropertyOptional({ description: 'CSV format variant', default: 'DRP_EXPORT' })
  @IsOptional()
  @IsString()
  @IsIn(['DRP_EXPORT', 'SIMPLE', 'FULL'])
  format?: string = 'DRP_EXPORT';

  // G5: metadata
  @ApiPropertyOptional({ description: 'Human-readable snapshot name (dùng khi tạo snapshot mới)' })
  @IsOptional()
  @IsString()
  snapshotName?: string;

  @ApiPropertyOptional({ description: 'User creating this snapshot' })
  @IsOptional()
  @IsString()
  createdBy?: string;

  // BE-A1: upload vào DRAFT snapshot đã có thay vì tạo mới
  // Entity: demand_snapshot.snapshot_id UUID (PrimaryGeneratedColumn('uuid'))
  @ApiPropertyOptional({
    description: 'UUID của DRAFT snapshot đích. Nếu có → upload vào snapshot đó (replace lines). Nếu null → tạo snapshot mới.',
  })
  @IsOptional()
  @IsUUID()
  targetSnapshotId?: string;
}

export class UploadForecastResponseDto {
  snapshotId: string;
  status: string;
  totalRowsParsed: number;
  totalRowsImported: number;
  totalRowsFiltered: number;
  totalItems: number;
  totalLocations: number;
  filterSummary: {
    EXCLUDE: number;
    DORMANT_DISCONTINUED: number;
  };
  validationErrors: Array<{ row: number; column: string; error: string; value: string }>;
  skippedRows: number;
}
