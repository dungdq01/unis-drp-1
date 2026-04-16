import {
  Controller, Get, Post, Param, Body, Query, Headers,
  HttpCode, HttpStatus, BadRequestException, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { NmAtpService } from './nm-atp.service';
import { HonoringRateService } from './honoring-rate.service';
import { FeatureFlag } from '../master-data/feature-flag.decorator';
import { FeatureFlagGuard } from '../master-data/master-data.controller';

@ApiTags('nm-atp')
@Controller('nm-atp')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m26_nm_atp_enabled')
export class NmAtpController {
  constructor(
    private readonly svc: NmAtpService,
    private readonly honoringSvc: HonoringRateService,
  ) {}

  // ── Run lifecycle ──────────────────────────────────────────────────────────

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M26] Trigger ATP check for an allocation_run' })
  run(
    @Body() body: { allocationRunId: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.allocationRunId) throw new BadRequestException('allocationRunId is required');
    return this.svc.run({ allocationRunId: body.allocationRunId, createdBy: userId ?? 'MANUAL' });
  }

  @Post('run/force-rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M26] Force re-run ATP check with reason (≥ 20 chars)' })
  forceRerun(
    @Body() body: { allocationRunId: string; forceRerunReason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.allocationRunId) throw new BadRequestException('allocationRunId required');
    if (!body?.forceRerunReason || body.forceRerunReason.length < 20) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }
    return this.svc.run({
      allocationRunId: body.allocationRunId,
      forceRerunReason: body.forceRerunReason,
      createdBy: userId ?? 'MANUAL',
    });
  }

  @Get('runs')
  @ApiOperation({ summary: '[M26] List ATP runs' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'allocationRunId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listRuns(
    @Query('status') status?: string,
    @Query('allocationRunId') allocationRunId?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.svc.listRuns({ status, allocationRunId, page, limit });
  }

  @Get('runs/:id')
  @ApiOperation({ summary: '[M26] Get ATP run detail' })
  getRunDetail(@Param('id') id: string) {
    return this.svc.getRunDetail(id);
  }

  @Get('runs/:id/checks')
  @ApiOperation({ summary: '[M26] List ATP check cells for a run' })
  @ApiQuery({ name: 'nmId', required: false })
  @ApiQuery({ name: 'result', required: false })
  listChecks(
    @Param('id') id: string,
    @Query('nmId') nmId?: string,
    @Query('result') result?: string,
  ) {
    return this.svc.listChecks(id, { nmId, result });
  }

  @Get('runs/:id/critical')
  @ApiOperation({ summary: '[M26] List CRITICAL recipient cells (HSTK < transit_LT)' })
  getCritical(@Param('id') id: string) {
    return this.svc.getCritical(id);
  }

  @Get('runs/:id/urgency/:checkId')
  @ApiOperation({ summary: '[M26] Urgency ranking detail for a PARTIAL ATP cell' })
  getUrgencyDetail(
    @Param('id') _runId: string,
    @Param('checkId') checkId: string,
  ) {
    return this.svc.getUrgencyDetail(checkId);
  }

  // ── Honoring rate ──────────────────────────────────────────────────────────

  @Get('honoring')
  @ApiOperation({ summary: '[M26] NM honoring rate trend' })
  @ApiQuery({ name: 'nmId', required: false })
  @ApiQuery({ name: 'fromMonth', required: false, description: 'YYYY-MM-01' })
  @ApiQuery({ name: 'toMonth', required: false })
  listHonoring(
    @Query('nmId') nmId?: string,
    @Query('fromMonth') fromMonth?: string,
    @Query('toMonth') toMonth?: string,
  ) {
    return this.svc.listHonoring({ nmId, fromMonth, toMonth });
  }

  @Get('honoring/leaderboard')
  @ApiOperation({ summary: '[M26] NM leaderboard sorted by honoring rate' })
  getHonoringLeaderboard() {
    return this.svc.getHonoringLeaderboard();
  }

  @Post('honoring/recompute')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M26] Manual honoring rate recompute for audit' })
  @ApiQuery({ name: 'month', required: false, description: 'YYYY-MM-01' })
  recomputeHonoring(@Query('month') month?: string) {
    return this.honoringSvc.computeMonthly(month);
  }
}
