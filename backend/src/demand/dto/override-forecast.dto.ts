import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

export class OverrideForecastDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  snapshotId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  itemCode: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  locationCode: string;

  @ApiProperty({ description: 'Period start date (YYYY-MM-DD)' })
  @IsNotEmpty()
  @IsString()
  periodStart: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsNumber()
  newQty: number;

  @ApiProperty({ description: 'Reason is required for audit trail' })
  @IsNotEmpty()
  @IsString()
  reason: string;

  @ApiProperty({ description: 'Who is making this override (required — DDL NOT NULL)' })
  @IsNotEmpty()
  @IsString()
  overriddenBy: string;
}
