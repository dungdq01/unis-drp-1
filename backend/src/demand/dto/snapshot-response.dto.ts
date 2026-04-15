import { ApiProperty } from '@nestjs/swagger';

export class SnapshotSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  demandBasis: string;

  @ApiProperty()
  totalLines: number;

  @ApiProperty()
  totalItems: number;

  @ApiProperty()
  totalLocations: number;

  @ApiProperty({ nullable: true })
  frozenAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ForecastSummaryItemDto {
  itemCode: string;
  segment: string;
  totalQty: number;
  lineCount: number;
}

export class ForecastCoverageDto {
  totalItems: number;
  itemsWithForecast: number;
  coveragePercent: number;
}
