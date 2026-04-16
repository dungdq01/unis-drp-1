import { IsString, IsOptional, IsNumber, Min } from 'class-validator';

export class UpdateSkuDto {
  @IsOptional()
  @IsString()
  skuName?: string;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @IsString()
  productGroup?: string;

  // Allow updating nm mapping
  @IsOptional()
  @IsString()
  nmCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  moq?: number;
}
