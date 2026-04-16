import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSupplierDto {
  @IsString()
  nmCode: string;

  @IsString()
  nmName: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  capacityMonthly?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  productionCycleD?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  leadTimeDays?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  ltSigma?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  priceTier1?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  priceTier2?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(1)
  honoringRate?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  @Max(100)
  relationshipScore?: number;
}
