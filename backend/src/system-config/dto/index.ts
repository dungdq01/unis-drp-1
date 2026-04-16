import { IsString, IsNotEmpty, IsOptional, IsIn, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ListConfigQueryDto {
  @IsOptional()
  @IsIn([
    // Legacy groups (M1-M10 existing)
    'PLANNING_CYCLE', 'PLUGIN_PARAMS', 'FEATURE_TOGGLE', 'BRAVO_ADAPTER', 'MASKING',
    // M10 new groups (Sprint 1)
    'PLANNING', 'LCNB', 'TRUST_SCORE', 'CN_ADJUST', 'TRANSPORT', 'FC_COMMIT', 'B2B_PIPELINE',
  ])
  group?: string;
}

export class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  size?: number = 20;
}

export class ConfigUpdateItemDto {
  @IsString() @IsNotEmpty()
  group: string;

  @IsString() @IsNotEmpty()
  key: string;

  @IsString() @IsNotEmpty()
  value: string;

  @IsOptional() @IsString()
  reason?: string;
}

export class UpdateConfigsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConfigUpdateItemDto)
  updates: ConfigUpdateItemDto[];

  @IsString() @IsNotEmpty()
  updatedBy: string;
}

export class UpdateToggleDto {
  @IsString() @IsNotEmpty()
  value: string;

  @IsString() @IsNotEmpty()
  updatedBy: string;

  @IsOptional() @IsString()
  reason?: string;
}
