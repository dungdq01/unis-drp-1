import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InsightsService } from './insights.service';
import { AccuracyService } from './accuracy.service';
import { InsightsPaginationDto } from './dto/insights-query.dto';

@Controller('demand/forecast')
@ApiTags('demand-insights')
export class InsightsController {
  constructor(
    private readonly insightsService: InsightsService,
    private readonly accuracyService: AccuracyService,
  ) {}

  @Get('sku-status')
  @ApiOperation({ summary: 'BE-NEW-3: SKU status distribution (ACT/END/NEW/Other) for donut' })
  getSkuStatus() {
    return this.accuracyService.getSkuStatus();
  }

  @Get('insights')
  @ApiOperation({ summary: 'BE-I1: Demand insights summary (period/segment/combo/tet)' })
  getInsights(@Query('snapshotId') snapshotId?: string) {
    return this.insightsService.getInsights(snapshotId);
  }

  @Get('quality')
  @ApiOperation({ summary: 'BE-I2: Forecast quality (confidence + accuracy proxy)' })
  getQuality(@Query('snapshotId') snapshotId?: string) {
    return this.insightsService.getQuality(snapshotId);
  }

  @Get('alerts')
  @ApiOperation({ summary: 'BE-I3: Zero forecast alerts (items with history but forecast=0)' })
  getAlerts(@Query() dto: InsightsPaginationDto) {
    return this.insightsService.getAlerts(dto.snapshotId, dto.page, dto.pageSize);
  }

  @Get('branches')
  @ApiOperation({ summary: 'BE-I4: Branch breakdown + byArchetype summary' })
  getBranches(@Query() dto: InsightsPaginationDto) {
    return this.insightsService.getBranches(dto.snapshotId, dto.page, dto.pageSize);
  }

  @Get('branch-summary')
  @ApiOperation({ summary: 'R9: Per-branch drill-down — header + byPeriod + bySegment + top 10 SKUs' })
  getBranchSummary(
    @Query('locationCode') locationCode: string,
    @Query('snapshotId') snapshotId?: string,
  ) {
    return this.insightsService.getBranchSummary(snapshotId, locationCode);
  }

  @Get('branch-heatmap')
  @ApiOperation({ summary: 'I-6: Branch × period demand heatmap' })
  getBranchHeatmap(@Query('snapshotId') snapshotId?: string) {
    return this.insightsService.getBranchHeatmap(snapshotId);
  }

  @Get('branch-pivot')
  @ApiOperation({ summary: 'R3: FSKU × Branch pivot by period (paginated)' })
  getBranchPivot(
    @Query('snapshotId') snapshotId?: string,
    @Query('locationCode') locationCode?: string,
    @Query('itemCode') itemCode?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.insightsService.getBranchPivot(
      snapshotId,
      locationCode,
      Number(page) || 1,
      Number(pageSize) || 25,
      itemCode,
    );
  }
}
