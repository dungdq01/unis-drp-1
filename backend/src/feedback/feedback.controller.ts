import {
  Controller, Get, Post, Query, Param, Body, Headers,
  HttpCode, HttpStatus, BadRequestException, UseGuards, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { FeedbackService } from './feedback.service';
import { DashboardService } from './dashboard.service';
import { FeatureFlag } from '../master-data/feature-flag.decorator';
import { FeatureFlagGuard } from '../master-data/master-data.controller';

@ApiTags('feedback')
@Controller('feedback')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m28_feedback_loop_enabled')
export class FeedbackController {
  constructor(
    private readonly svc: FeedbackService,
    private readonly dashboardSvc: DashboardService,
  ) {}

  // ── Run lifecycle ─────────────────────────────────────────────────────────

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M28] Manual trigger weekly feedback pipeline' })
  run(
    @Body() body: { weekStart?: string },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.svc.runWeekly({ weekStart: body?.weekStart, createdBy: userId ?? 'MANUAL' });
  }

  @Post('run/force-rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M28] Force re-run with reason (≥ 20 chars)' })
  forceRerun(
    @Body() body: { weekStart?: string; forceRerunReason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.forceRerunReason || body.forceRerunReason.length < 20) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }
    return this.svc.runWeekly({
      weekStart: body.weekStart,
      forceRerunReason: body.forceRerunReason,
      createdBy: userId ?? 'MANUAL',
    });
  }

  @Get('snapshots')
  @ApiOperation({ summary: '[M28] List weekly KPI snapshots' })
  @ApiQuery({ name: 'limit', required: false })
  listSnapshots(@Query('limit', new ParseIntPipe({ optional: true })) limit = 20) {
    return this.svc.listSnapshots(limit);
  }

  @Get('snapshots/:id')
  @ApiOperation({ summary: '[M28] Weekly snapshot detail + all KPI' })
  getSnapshot(@Param('id') id: string) {
    return this.svc.getSnapshot(id);
  }

  // ── Closed-loop logs ──────────────────────────────────────────────────────

  @Get('ss-adjustments')
  @ApiOperation({ summary: '[M28] SS adjustment log (filterable)' })
  @ApiQuery({ name: 'cnId',     required: false })
  @ApiQuery({ name: 'skuId',    required: false })
  @ApiQuery({ name: 'fromWeek', required: false })
  @ApiQuery({ name: 'toWeek',   required: false })
  getSsAdjustments(
    @Query('cnId')     cnId?: string,
    @Query('skuId')    skuId?: string,
    @Query('fromWeek') fromWeek?: string,
    @Query('toWeek')   toWeek?: string,
  ) {
    return this.dashboardSvc.getSsAdjustments(cnId, skuId, fromWeek, toWeek);
  }

  @Get('lt-updates')
  @ApiOperation({ summary: '[M28] LT actual log (filterable by NM)' })
  @ApiQuery({ name: 'nmCode',   required: false })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate',   required: false })
  getLtUpdates(
    @Query('nmCode')   nmCode?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate')   toDate?: string,
  ) {
    return this.dashboardSvc.getLtUpdates(nmCode, fromDate, toDate);
  }

  @Get('overrides')
  @ApiOperation({ summary: '[M28] Override analysis top reasons per week' })
  @ApiQuery({ name: 'week', required: false })
  getOverrides(@Query('week') week?: string) {
    return this.dashboardSvc.getOverrides(week);
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  @Get('dashboard')
  @ApiOperation({ summary: '[M28] SC Manager dashboard: 6 KPI cards + trends + alerts' })
  @ApiQuery({ name: 'week', required: false })
  getDashboard(@Query('week') week?: string) {
    return this.dashboardSvc.getDashboard(week);
  }

  @Get('dashboard/drill-down')
  @ApiOperation({ summary: '[M28] Dashboard drill-down per metric/CN/SKU' })
  @ApiQuery({ name: 'metric', required: true })
  @ApiQuery({ name: 'cnId',   required: false })
  @ApiQuery({ name: 'skuId',  required: false })
  getDrillDown(
    @Query('metric') metric: string,
    @Query('cnId')   cnId?: string,
    @Query('skuId')  skuId?: string,
  ) {
    return this.dashboardSvc.getDrillDown(metric, cnId, skuId);
  }

  // ── Manual recompute ──────────────────────────────────────────────────────

  @Post('recompute/ss')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M28] Manual single-cell SS recompute (audit/debug)' })
  @ApiQuery({ name: 'cnId',  required: true })
  @ApiQuery({ name: 'skuId', required: true })
  recomputeSs(@Query('cnId') cnId: string, @Query('skuId') skuId: string) {
    return this.svc.recomputeSs(cnId, skuId);
  }

  @Post('recompute/lt')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M28] Manual single-NM LT recompute (audit/debug)' })
  @ApiQuery({ name: 'nmCode', required: true })
  recomputeLt(@Query('nmCode') nmCode: string) {
    return this.svc.recomputeLt(nmCode);
  }
}
