import {
  Controller, Post, Get, Patch, Param, Body, Query,
  HttpCode, HttpStatus, ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { DrpService } from './drp.service';
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
  constructor(private readonly drpService: DrpService) {}

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
}
