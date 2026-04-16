import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  ValidateNested,
  IsObject,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSkuVariantDto {
  @IsString()
  variantCode: string;

  @IsString()
  variantSuffix: string;

  @IsOptional()
  @IsString()
  variantName?: string;

  @IsOptional()
  @IsObject()
  attrs?: object;
}

export class CreateSkuDto {
  @IsString()
  skuCode: string;

  @IsString()
  skuName: string;

  @IsOptional()
  @IsString()
  uom?: string;

  @IsOptional()
  @IsString()
  productGroup?: string;

  // nm_code của supplier (single-source mapping)
  @IsString()
  nmCode: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  moq?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSkuVariantDto)
  variants?: CreateSkuVariantDto[];
}
