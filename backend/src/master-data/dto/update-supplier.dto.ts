import { IsString, IsOptional, IsNumber, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Only fields that exist in the actual supplier table (M1-M10 schema).
 * Columns: supplier_code (PK), supplier_name, lead_time_days, region, factory_code, status, created_at, lt_drift_count, lt_drift_last_at
 */
export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  supplierName?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  leadTimeDays?: number | null;

  @IsOptional()
  @IsString()
  region?: string | null;

  @IsOptional()
  @IsString()
  factoryCode?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}
