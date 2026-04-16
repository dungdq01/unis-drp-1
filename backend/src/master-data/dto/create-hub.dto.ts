import { IsString, IsOptional, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateHubDto {
  @IsString()
  hubCode: string;

  @IsString()
  hubName: string;

  @IsOptional()
  @IsString()
  @IsIn(['VIRTUAL', 'PHYSICAL'])
  hubType?: 'VIRTUAL' | 'PHYSICAL';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  capacity?: number;
}

export class UpdateHubDto {
  @IsOptional()
  @IsString()
  hubName?: string;

  @IsOptional()
  @IsString()
  @IsIn(['VIRTUAL', 'PHYSICAL'])
  hubType?: 'VIRTUAL' | 'PHYSICAL';

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  lng?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  capacity?: number;
}
