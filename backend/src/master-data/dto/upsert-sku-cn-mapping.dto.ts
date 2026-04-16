import { IsString, IsOptional, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertSkuCnMappingDto {
  @IsString()
  skuId: string;

  @IsString()
  cnId: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  ssOverride?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  zOverride?: number;

  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;

  @IsOptional()
  @IsString()
  updatedBy?: string;
}

export class PatchSkuCnMappingDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  ssOverride?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  zOverride?: number;

  @IsOptional()
  @IsBoolean()
  isCritical?: boolean;

  @IsOptional()
  @IsString()
  updatedBy?: string;
}

export class QuerySkuCnMappingDto {
  @IsOptional()
  @IsString()
  skuId?: string;

  @IsOptional()
  @IsString()
  cnId?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  pageSize?: number = 20;
}
