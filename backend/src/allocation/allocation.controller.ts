import {
  Controller, Post, Get, Patch, Param, Body, Query, Headers,
  HttpCode, HttpStatus, ParseIntPipe, BadRequestException, UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AllocationService } from './allocation.service';
import { AllocationLcnbService } from './allocation.lcnb.service';
import { FeatureFlag } from '../master-data/feature-flag.decorator';
import { FeatureFlagGuard } from '../master-data/master-data.controller';
import {
  CreateAllocationRunDto, GetResultsQueryDto,
  GetRecommendationsQueryDto, DecideRecommendationDto,
} from './dto';

@ApiTags('Allocation – Module 5 / M24')
@Controller('allocation')
// BUG-M24-4 fix: class-level guard is no-op for methods without @FeatureFlag
// (guard returns true when no metadata). M24 v2 methods below opt in via
// their own @FeatureFlag('m24_allocation_lcnb_enabled'). v1 legacy routes
// untouched.
@UseGuards(FeatureFlagGuard)
export class AllocationController {
  constructor(
    private readonly allocationService: AllocationService,
    private readonly lcnbSvc: AllocationLcnbService,
  ) {}

  /** POST /api/v1/allocation/run — async fire-and-forget (202) */
  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  createRun(@Body() dto: CreateAllocationRunDto) {
    return this.allocationService.createRun(dto);
  }

  /** GET /api/v1/allocation/runs */
  @Get('runs')
  listRuns(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20,
  ) {
    return this.allocationService.listRuns(page, pageSize);
  }

  /** GET /api/v1/allocation/runs/:id */
  @Get('runs/:id')
  getRun(@Param('id') id: string) {
    return this.allocationService.getRun(id);
  }

  /** GET /api/v1/allocation/runs/:id/summary */
  @Get('runs/:id/summary')
  getSummary(@Param('id') id: string) {
    return this.allocationService.getSummary(id);
  }

  /** GET /api/v1/allocation/runs/:id/results */
  @Get('runs/:id/results')
  getResults(@Param('id') id: string, @Query() query: GetResultsQueryDto) {
    return this.allocationService.getResults(id, query);
  }

  /** GET /api/v1/allocation/runs/:id/recommendations */
  @Get('runs/:id/recommendations')
  getRecommendations(@Param('id') id: string, @Query() query: GetRecommendationsQueryDto) {
    return this.allocationService.getRecommendations(id, query);
  }

  /** PATCH /api/v1/allocation/recommendations/:id/decide */
  @Patch('recommendations/:id/decide')
  decideRecommendation(@Param('id') id: string, @Body() dto: DecideRecommendationDto) {
    return this.allocationService.decideRecommendation(id, dto);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // M24 — Allocation Engine LCNB v2 routes
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /api/v1/allocation/v2/run
   * Trigger LCNB allocation for a completed M23 plan_run.
   */
  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Post('v2/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M24] Trigger allocation v2 (LCNB) for a DRP plan_run' })
  @ApiResponse({ status: 202, description: 'Run completed with stats' })
  @ApiResponse({ status: 409, description: 'Allocation already run for this plan_run' })
  @ApiResponse({ status: 503, description: 'Feature flag disabled' })
  runV2(
    @Body() body: { planRunId: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.planRunId) {
      throw new BadRequestException('planRunId is required');
    }
    return this.lcnbSvc.runV2({ planRunId: body.planRunId, createdBy: userId ?? 'MANUAL' });
  }

  /**
   * POST /api/v1/allocation/v2/run/force-rerun
   * SC Manager force rerun allocation with mandatory reason (≥20 chars).
   */
  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Post('v2/run/force-rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M24] Force rerun with mandatory reason' })
  forceRerun(
    @Body() body: { planRunId: string; reason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.planRunId) throw new BadRequestException('planRunId is required');
    if (!body?.reason || body.reason.length < 20) {
      throw new BadRequestException('reason must be ≥ 20 chars for force rerun');
    }
    return this.lcnbSvc.runV2({
      planRunId: body.planRunId,
      createdBy: userId ?? 'MANUAL',
      forceRerunReason: body.reason,
    });
  }

  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Get('v2/runs')
  @ApiOperation({ summary: '[M24] List allocation_run (newest first)' })
  @ApiQuery({ name: 'planRunId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listV2Runs(
    @Query('planRunId') planRunId?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.lcnbSvc.listRuns(planRunId, page, limit);
  }

  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Get('v2/runs/:id')
  @ApiOperation({ summary: '[M24] allocation_run detail + summary stats' })
  @ApiParam({ name: 'id', description: 'allocation_run.id' })
  getV2Run(@Param('id') id: string) {
    return this.lcnbSvc.getRun(id);
  }

  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Get('v2/runs/:id/legs')
  @ApiOperation({ summary: '[M24] allocation_leg detail (paginated)' })
  @ApiParam({ name: 'id', description: 'allocation_run.id' })
  @ApiQuery({ name: 'sourceType', required: false, enum: ['HUB', 'CN_REDIST', 'NM', 'TOP_UP_NEXT_WEEK'] })
  listV2Legs(
    @Param('id') id: string,
    @Query('sourceType') sourceType?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 100,
  ) {
    return this.lcnbSvc.listLegs(id, { sourceType, page, limit });
  }

  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Get('v2/runs/:id/results')
  @ApiOperation({ summary: '[M24] Paginated allocation_result with filter' })
  @ApiParam({ name: 'id', description: 'allocation_run.id' })
  @ApiQuery({ name: 'cnId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['FULL', 'PARTIAL', 'PARTIAL_STOCKOUT', 'UNALLOCATED'] })
  listV2Results(
    @Param('id') id: string,
    @Query('cnId') cnId?: string,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    return this.lcnbSvc.listResults(id, { cnId, status, page, limit });
  }

  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Get('v2/runs/:id/lcnb-summary')
  @ApiOperation({ summary: '[M24] LCNB donor→recipient transfer summary' })
  @ApiParam({ name: 'id', description: 'allocation_run.id' })
  lcnbSummary(@Param('id') id: string) {
    return this.lcnbSvc.getLcnbSummary(id);
  }

  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Get('v2/runs/:id/review-required')
  @ApiOperation({ summary: '[M24] Rows flagged planner_review_required' })
  @ApiParam({ name: 'id', description: 'allocation_run.id' })
  reviewRequired(@Param('id') id: string) {
    return this.lcnbSvc.getReviewRequired(id);
  }

  /**
   * GET /api/v1/allocation/v2/runs/:id/result
   * M24→M25 full result for injection (Map serialized to object).
   */
  @FeatureFlag('m24_allocation_lcnb_enabled')
  @Get('v2/runs/:id/result')
  @ApiOperation({ summary: '[M24→M25] Full allocation result for M25 inject' })
  @ApiParam({ name: 'id', description: 'allocation_run.id' })
  async getAllocationResult(@Param('id') id: string) {
    const result = await this.lcnbSvc.getAllocationResult(id);
    return {
      allocationRunId: result.allocationRunId,
      planRunId:       result.planRunId,
      policyRunId:     result.policyRunId,
      generatedAt:     result.generatedAt,
      results:         Object.fromEntries(result.results),
    };
  }
}
