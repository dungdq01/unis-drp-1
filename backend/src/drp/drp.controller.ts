import {
  Controller, Post, Get, Patch, Param, Body, Query, Headers,
  HttpCode, HttpStatus, ParseIntPipe, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { DrpService } from './drp.service';
import { DrpNettingV2Service, V2RunOptions } from './drp.netting-v2.service';
import { DrpSsCnService } from './drp.ss-cn.service';
import {
  CreateDrpRunDto,
  GetPlannedOrdersQueryDto,
  GetExceptionsQueryDto,
  ResolveExceptionDto,
  ApprovePlannedOrderDto,
  CancelPlannedOrderDto,
} from './dto';

@ApiTags('DRP – Module 4')
@Controller('drp')
export class DrpController {
  constructor(
    private readonly drpService: DrpService,
    private readonly nettingV2Svc: DrpNettingV2Service,
    private readonly ssCnSvc: DrpSsCnService,
  ) {}

  // ── POST /drp/run ──────────────────────────────────────────────────────────
  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Tạo plan run mới và kick-off DRP netting (async)' })
  @ApiResponse({ status: 202, description: 'Plan run created; netting running in background' })
  @ApiResponse({ status: 400, description: 'Snapshot not FROZEN or validation error' })
  @ApiResponse({ status: 409, description: 'Duplicate run for same snapshot pair' })
  createRun(@Body() dto: CreateDrpRunDto) {
    return this.drpService.createAndRunDrp(dto);
  }

  // ── GET /drp/run ───────────────────────────────────────────────────────────
  @Get('run')
  @ApiOperation({ summary: 'Danh sách plan runs (mới nhất trước)' })
  listRuns(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.drpService.listPlanRuns(page, limit);
  }

  // ── GET /drp/run/:id ───────────────────────────────────────────────────────
  @Get('run/:id')
  @ApiOperation({ summary: 'Chi tiết một plan run' })
  @ApiParam({ name: 'id', description: 'plan_run.id (BIGINT as string)' })
  getRun(@Param('id') id: string) {
    return this.drpService.getPlanRun(id);
  }

  // ── GET /drp/run/:id/planned-orders ───────────────────────────────────────
  @Get('run/:id/planned-orders')
  @ApiOperation({ summary: 'Danh sách planned orders với filter + phân trang' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  getPlannedOrders(
    @Param('id') id: string,
    @Query() query: GetPlannedOrdersQueryDto,
  ) {
    query.planRunId = id;
    return this.drpService.getPlannedOrders(query);
  }

  // ── GET /drp/run/:id/netting-detail/:itemCode/:locationCode ───────────────
  @Get('run/:id/netting-detail/:itemCode/:locationCode')
  @ApiOperation({ summary: '12-week netting grid cho 1 SKU×Location' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  @ApiParam({ name: 'itemCode', description: 'item_code' })
  @ApiParam({ name: 'locationCode', description: 'location_code' })
  getNettingDetail(
    @Param('id') id: string,
    @Param('itemCode') itemCode: string,
    @Param('locationCode') locationCode: string,
  ) {
    return this.drpService.getNettingDetail(id, itemCode, locationCode);
  }

  // ── PATCH /drp/planned-orders/:id/approve ─────────────────────────────────
  @Patch('planned-orders/:id/approve')
  @ApiOperation({ summary: 'Approve planned order (NEEDS_APPROVAL → RELEASED)' })
  @ApiParam({ name: 'id', description: 'planned_order_release.id' })
  approvePlannedOrder(
    @Param('id') id: string,
    @Body() dto: ApprovePlannedOrderDto,
  ) {
    return this.drpService.approvePlannedOrder(id, dto);
  }

  // ── PATCH /drp/planned-orders/:id/cancel ──────────────────────────────────
  @Patch('planned-orders/:id/cancel')
  @ApiOperation({ summary: 'Cancel planned order (bất kỳ status → CANCELLED)' })
  @ApiParam({ name: 'id', description: 'planned_order_release.id' })
  cancelPlannedOrder(
    @Param('id') id: string,
    @Body() dto: CancelPlannedOrderDto,
  ) {
    return this.drpService.cancelPlannedOrder(id, dto);
  }

  // ── GET /drp/run/:id/exceptions ───────────────────────────────────────────
  @Get('run/:id/exceptions')
  @ApiOperation({ summary: 'Danh sách exceptions với filter (sort: HIGH→MEDIUM→LOW)' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  getExceptions(
    @Param('id') id: string,
    @Query() query: GetExceptionsQueryDto,
  ) {
    query.planRunId = id;
    return this.drpService.getExceptions(query);
  }

  // ── PATCH /drp/run/:runId/exceptions/:excId/resolve ───────────────────────
  @Patch('run/:runId/exceptions/:excId/resolve')
  @ApiOperation({ summary: 'Mark exception as resolved' })
  @ApiParam({ name: 'runId', description: 'plan_run.id' })
  @ApiParam({ name: 'excId', description: 'drp_exception.id' })
  resolveException(
    @Param('runId') runId: string,
    @Param('excId') excId: string,
    @Body() dto: ResolveExceptionDto,
  ) {
    return this.drpService.resolveException(runId, excId, dto);
  }

  // ── GET /drp/run/:id/hstk ─────────────────────────────────────────────────
  @Get('run/:id/hstk')
  @ApiOperation({ summary: 'HSTK summary: stockout + overstock alert counts & detail' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  getHstkSummary(@Param('id') id: string) {
    return this.drpService.getHstkSummary(id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // M23 — DRP Netting v2 routes
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * POST /drp/v2/run
   * Kick-off a manual DRP netting v2 run (also runs nightly at 23:15+23:30 VN).
   * Optional: forceOverrideReason + forceOverrideBy to bypass freshness gate
   * or re-run after a COMPLETED run for today.
   */
  @Post('v2/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M23] Trigger DRP netting v2 (manual)' })
  @ApiResponse({ status: 202, description: 'Run completed with stats' })
  @ApiResponse({ status: 400, description: 'Freshness gate blocked' })
  @ApiResponse({ status: 409, description: 'Already COMPLETED today — use forceOverrideReason' })
  runV2(
    @Body() body: { forceOverrideReason?: string },
    @Headers('x-user-id') userId?: string,
  ) {
    const opts: V2RunOptions = {
      createdBy: userId ?? 'MANUAL',
      forceOverrideReason: body?.forceOverrideReason,
      forceOverrideBy: userId,
    };
    return this.nettingV2Svc.runV2(opts);
  }

  /**
   * GET /drp/v2/runs
   * List v2 plan runs (runs that have a policy_run_id, newest first).
   */
  @Get('v2/runs')
  @ApiOperation({ summary: '[M23] List DRP v2 plan runs' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listV2Runs(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.nettingV2Svc.listV2Runs(page, limit);
  }

  /**
   * GET /drp/v2/runs/:id/lines
   * Paginated drp_cn_line for a plan run with optional CN/SKU/status filter.
   */
  @Get('v2/runs/:id/lines')
  @ApiOperation({ summary: '[M23] Get drp_cn_line for a plan run (M24 read path)' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  @ApiQuery({ name: 'cnId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'status', required: false, enum: ['NORMAL', 'OVER_STOCK', 'STOCKOUT_RISK'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listLines(
    @Param('id') id: string,
    @Query('cnId') cnId?: string,
    @Query('skuId') skuId?: string,
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 50,
  ) {
    return this.nettingV2Svc.listLines(id, { cnId, skuId, status, page, limit });
  }

  /**
   * POST /drp/v2/run/force-stale-override
   * G10 [spec §7] — SC Manager bypass freshness gate with mandatory reason (≥20 chars).
   */
  @Post('v2/run/force-stale-override')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M23] Force DRP run bypassing freshness gate' })
  @ApiResponse({ status: 202, description: 'Run completed with is_stale_override=true' })
  @ApiResponse({ status: 400, description: 'reasonText missing or <20 chars' })
  runV2ForceStale(
    @Body() body: { reasonText: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.reasonText || body.reasonText.length < 20) {
      throw new BadRequestException('reasonText bắt buộc và ≥ 20 ký tự cho force stale override');
    }
    return this.nettingV2Svc.runV2({
      createdBy: userId ?? 'MANUAL',
      forceOverrideReason: body.reasonText,
      forceOverrideBy: userId,
    });
  }

  /**
   * GET /drp/v2/runs/:id/policy-snapshot — audit Rule 14 snapshot.
   */
  @Get('v2/runs/:id/policy-snapshot')
  @ApiOperation({ summary: '[M23] Policy snapshot viewer (Rule 14 audit)' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  getPolicySnapshot(@Param('id') id: string) {
    return this.nettingV2Svc.getPolicySnapshot(id);
  }

  /**
   * GET /drp/v2/runs/:id/ss-summary?cnId=
   */
  @Get('v2/runs/:id/ss-summary')
  @ApiOperation({ summary: '[M23] SS CN summary per cell' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  @ApiQuery({ name: 'cnId', required: false })
  getSsSummary(@Param('id') id: string, @Query('cnId') cnId?: string) {
    return this.nettingV2Svc.getSsSummary(id, cnId);
  }

  /**
   * GET /drp/v2/ss-preview?cnId=&skuId= — live SS preview (không lưu).
   */
  @Get('v2/ss-preview')
  @ApiOperation({ summary: '[M23] Preview SS CN với config hiện tại (không persist)' })
  @ApiQuery({ name: 'cnId', required: true })
  @ApiQuery({ name: 'skuId', required: true })
  ssPreview(@Query('cnId') cnId: string, @Query('skuId') skuId: string) {
    if (!cnId || !skuId) {
      throw new BadRequestException('cnId và skuId bắt buộc');
    }
    return this.ssCnSvc.preview(cnId, skuId);
  }

  /**
   * GET /drp/v2/runs/:id/result
   * Full drp_cn_line result set for M24 injection (throws if not COMPLETED).
   * BUG-M23-5: service returns `lines: Map<...>` (M24 needs Map semantics when
   * injected), but JSON.stringify(Map) → {}. Convert to plain object for HTTP.
   */
  @Get('v2/runs/:id/result')
  @ApiOperation({ summary: '[M23→M24] Full netting result for a completed run' })
  @ApiParam({ name: 'id', description: 'plan_run.id' })
  @ApiResponse({ status: 200, description: 'DrpResultDto with lines as object keyed by drpCellKey' })
  @ApiResponse({ status: 400, description: 'Run not COMPLETED' })
  @ApiResponse({ status: 404, description: 'Run not found' })
  async getDrpResult(@Param('id') id: string) {
    const result = await this.nettingV2Svc.getDrpResult(id);
    return {
      planRunId:   result.planRunId,
      policyRunId: result.policyRunId,
      generatedAt: result.generatedAt,
      lines:       Object.fromEntries(result.lines),
    };
  }
}
