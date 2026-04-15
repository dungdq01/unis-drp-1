import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AccuracyService } from './accuracy.service';
import { AccuracySkuQueryDto, WorstPerformersDto } from './dto/accuracy-query.dto';

@Controller('demand/accuracy')
@ApiTags('demand-accuracy')
export class AccuracyController {
  constructor(private readonly svc: AccuracyService) {}

  @Get('overview')
  @ApiOperation({ summary: 'R1+R2: Tab 1 overview metrics (pure accuracy+item, no branch data)' })
  getOverview() {
    return this.svc.getOverview();
  }

  @Get('summary')
  @ApiOperation({ summary: 'BE-A1: Accuracy summary (byMonth + byTier + kpi)' })
  getSummary() {
    return this.svc.getSummary();
  }

  @Get('skus')
  @ApiOperation({ summary: 'BE-A2: SKU accuracy table (paginated, filterable)' })
  getSkus(@Query() dto: AccuracySkuQueryDto) {
    return this.svc.getSkus(dto);
  }

  @Get('worst')
  @ApiOperation({ summary: 'BE-A3: Worst performers (acc < threshold, actual > minActual)' })
  getWorst(@Query() dto: WorstPerformersDto) {
    return this.svc.getWorst(dto);
  }

  @Get('trend')
  @ApiOperation({ summary: 'BE-NEW-1: Per-month forecast + actual + confidence band' })
  getTrend() {
    return this.svc.getTrend();
  }

  @Get('sku-trend')
  @ApiOperation({ summary: 'BE-NEW-2: Single SKU T10→T3 trend for sparkline' })
  getSkuTrend(@Query('fsku') fsku: string) {
    return this.svc.getSkuTrend(fsku);
  }

  @Get('pareto')
  @ApiOperation({ summary: 'I-2: Cumulative demand % by SKU rank (Pareto chart data)' })
  getPareto() {
    return this.svc.getPareto();
  }

  @Get('scatter')
  @ApiOperation({ summary: 'I-3: Model vs MA3 accuracy per SKU (scatter plot data)' })
  getScatter(@Query('month') month?: string) {
    return this.svc.getScatter(month || 't1');
  }

  @Get('heatmap')
  @ApiOperation({ summary: 'I-4: Accuracy by segment × volume tier (heatmap data)' })
  getHeatmap() {
    return this.svc.getHeatmap();
  }

  @Get('volatility')
  @ApiOperation({ summary: 'I-5: CV distribution histogram (volatility data)' })
  getVolatility() {
    return this.svc.getVolatility();
  }

  @Get('compare')
  @ApiOperation({ summary: 'I-10: Period vs period comparison per SKU' })
  getCompare(
    @Query('month1') month1?: string,
    @Query('month2') month2?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.getCompare(month1 || 't12', month2 || 't1', Number(page) || 1, Number(pageSize) || 50);
  }

  @Get('error-distribution')
  @ApiOperation({ summary: 'I-11 (Tab 3): MAPE histogram + percentiles + tail SKUs' })
  getErrorDistribution(@Query('month') month?: string, @Query('segment') segment?: string) {
    return this.svc.getErrorDistribution(month || 't1', segment);
  }

  @Get('bias')
  @ApiOperation({ summary: 'I-13 (Tab 3): Bias analysis grouped by segment|month|branch' })
  getBias(@Query('groupBy') groupBy?: string, @Query('month') month?: string) {
    return this.svc.getBias(groupBy || 'segment', month || 't1');
  }

  @Get('bias-heatmap')
  @ApiOperation({ summary: 'I-14 (Tab 3): Bias heatmap by branch × segment' })
  getBiasHeatmap(@Query('month') month?: string) {
    return this.svc.getBiasHeatmap(month || 't1');
  }

  @Get('cohort')
  @ApiOperation({ summary: 'I-19 (Tab 3): Accuracy by SKU age cohort' })
  getCohort(@Query('month') month?: string) {
    return this.svc.getCohort(month || 't1');
  }

  @Get('ci-calibration')
  @ApiOperation({ summary: 'I-21 (Tab 3): CI coverage rate calibration check' })
  getCiCalibration() {
    return this.svc.getCiCalibration();
  }

  @Get('seasonality')
  @ApiOperation({ summary: 'I-16 (Tab 3): Monthly seasonal index' })
  getSeasonality() {
    return this.svc.getSeasonality();
  }
}
