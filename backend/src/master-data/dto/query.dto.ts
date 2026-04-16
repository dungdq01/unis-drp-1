import { IsOptional, IsInt, Min, Max, IsString, IsBoolean } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class MasterDataQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  active?: boolean;
}

export class HubQueryDto extends MasterDataQueryDto {
  @IsOptional()
  @IsString()
  hubType?: string;
}

export class ChannelQueryDto extends MasterDataQueryDto {
  @IsOptional()
  @IsString()
  region?: string;
}

export class SupplierQueryDto extends MasterDataQueryDto {}

export class SkuQueryDto extends MasterDataQueryDto {
  @IsOptional()
  @IsString()
  productGroup?: string;
}

export class CustomerQueryDto extends MasterDataQueryDto {
  @IsOptional()
  @IsString()
  customerType?: 'B2B' | 'B2C';
}
