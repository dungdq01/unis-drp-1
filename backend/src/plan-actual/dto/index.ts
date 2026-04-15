import { IsOptional, IsString, IsIn, IsInt, Min, Max, IsNotEmpty, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class ComputeDto {
  @IsIn(['FORECAST_VERSION', 'FORECAST_VS_ACTUAL', 'UPLOAD_COMPARE'])
  comparisonType: 'FORECAST_VERSION' | 'FORECAST_VS_ACTUAL' | 'UPLOAD_COMPARE';

  /** Required for FORECAST_VERSION and FORECAST_VS_ACTUAL */
  @IsOptional() @IsString()
  snapshotIdBase?: string;

  /** Required for FORECAST_VERSION */
  @IsOptional() @IsString()
  snapshotIdCompare?: string;

  /** Required for UPLOAD_COMPARE — UUID of FORECAST dataset */
  @IsOptional() @IsUUID()
  uploadBaseId?: string;

  /** Required for UPLOAD_COMPARE — UUID of ACTUAL dataset */
  @IsOptional() @IsUUID()
  uploadCompareId?: string;

  @IsOptional() @IsString()
  computedBy?: string;
}

export class ListComparisonQueryDto {
  @IsOptional() @IsIn(['FORECAST_VERSION', 'FORECAST_VS_ACTUAL', 'UPLOAD_COMPARE'])
  comparisonType?: string;

  @IsOptional() @IsString()
  itemCode?: string;

  @IsOptional() @IsString()
  locationCode?: string;

  @IsOptional() @IsString()
  periodStart?: string;

  @IsOptional() @IsIn(['ON_TARGET', 'WARNING', 'CRITICAL', 'N_A'])
  status?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize?: number;
}

export class UploadDatasetDto {
  @IsString() @IsNotEmpty()
  name: string;

  @IsIn(['FORECAST', 'ACTUAL'])
  type: 'FORECAST' | 'ACTUAL';

  @IsOptional() @IsString()
  createdBy?: string;
}
