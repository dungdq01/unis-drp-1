import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, Headers,
  HttpCode, HttpStatus, BadRequestException, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PoReviewService } from './po-review.service';
import { PoEditService } from './po-edit.service';
import { PoTransitionService } from './po-transition.service';
import { PoOverdueService } from './po-overdue.service';
import { PoTrackingService } from './po-tracking.service';
import { FeatureFlag } from '../master-data/feature-flag.decorator';
import { FeatureFlagGuard } from '../master-data/master-data.controller';

@ApiTags('po-review')
@Controller('po-review')
@UseGuards(FeatureFlagGuard)
@FeatureFlag('m27_po_rebuild_enabled')
export class PoReviewController {
  constructor(
    private readonly svc: PoReviewService,
    private readonly editSvc: PoEditService,
    private readonly transitionSvc: PoTransitionService,
    private readonly overdueSvc: PoOverdueService,
    private readonly trackingSvc: PoTrackingService,
  ) {}

  // ── Run lifecycle ──────────────────────────────────────────────────────────

  @Post('run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M27] Trigger PO/TO generation (after M25+M26 both done)' })
  run(
    @Body() body: { allocationRunId: string; transportPlanId: string; atpRunId: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.allocationRunId) throw new BadRequestException('allocationRunId required');
    if (!body?.transportPlanId) throw new BadRequestException('transportPlanId required');
    if (!body?.atpRunId) throw new BadRequestException('atpRunId required');
    return this.svc.generate({
      allocationRunId: body.allocationRunId,
      transportPlanId: body.transportPlanId,
      atpRunId: body.atpRunId,
      createdBy: userId ?? 'MANUAL',
    });
  }

  @Post('run/force-rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M27] Force re-run with reason (≥ 20 chars)' })
  forceRerun(
    @Body() body: { allocationRunId: string; transportPlanId: string; atpRunId: string; forceRerunReason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.forceRerunReason || body.forceRerunReason.length < 20) {
      throw new BadRequestException('forceRerunReason must be ≥ 20 chars');
    }
    return this.svc.generate({
      allocationRunId: body.allocationRunId,
      transportPlanId: body.transportPlanId,
      atpRunId: body.atpRunId,
      forceRerunReason: body.forceRerunReason,
      createdBy: userId ?? 'MANUAL',
    });
  }

  @Get('runs')
  @ApiOperation({ summary: '[M27] List PO runs' })
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

  // ── Event callbacks (M25/M26 AND correlation) ──────────────────────────────

  @Post('event/m25-done')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[M27] M25 event callback — transport plan completed' })
  onM25Done(@Body() body: { allocationRunId: string; transportPlanId: string }) {
    return this.svc.onM25TransportCompleted(body.allocationRunId, body.transportPlanId);
  }

  @Post('event/m26-done')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '[M27] M26 event callback — ATP run completed' })
  onM26Done(@Body() body: { allocationRunId: string; atpRunId: string }) {
    return this.svc.onM26AtpCompleted(body.allocationRunId, body.atpRunId);
  }

  // ── PO CRUD ───────────────────────────────────────────────────────────────

  @Get('po')
  @ApiOperation({ summary: '[M27] List PO headers' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'nmId', required: false })
  @ApiQuery({ name: 'cnId', required: false })
  @ApiQuery({ name: 'poRunId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  listPo(
    @Query('status') status?: string,
    @Query('nmId') nmId?: string,
    @Query('cnId') cnId?: string,
    @Query('poRunId') poRunId?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.svc.listPo({ status, nmId, cnId, poRunId, page, limit });
  }

  @Get('po/:id')
  @ApiOperation({ summary: '[M27] PO detail + lines + edit log + tracking' })
  getPoDetail(@Param('id') id: string) {
    return this.svc.getPoDetail(id);
  }

  @Get('po/:id/edit-log')
  @ApiOperation({ summary: '[M27] PO audit log' })
  getPoEditLog(@Param('id') id: string) {
    return this.svc['dataSource'].query(
      `SELECT * FROM po_edit_log WHERE po_header_id = $1 ORDER BY changed_at DESC`, [id],
    );
  }

  // ── PO line edits ─────────────────────────────────────────────────────────

  @Patch('po/:id/lines/:lineId')
  @ApiOperation({ summary: '[M27] Edit PO line qty/variant (R7/R8, mandatory reason)' })
  editLine(
    @Param('id') poId: string,
    @Param('lineId') lineId: string,
    @Body() body: { confirmedQty?: number; variantCode?: string; reason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.editSvc.editLine(poId, lineId, { ...body, changedBy: userId });
  }

  @Post('po/:id/lines')
  @ApiOperation({ summary: '[M27] Add SKU line to DRAFT PO (R7/R8 NM validate)' })
  addLine(
    @Param('id') poId: string,
    @Body() body: { skuId: string; qty: number; variantCode?: string; reason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.editSvc.addLine(poId, { ...body, changedBy: userId });
  }

  @Delete('po/:id/lines/:lineId')
  @ApiOperation({ summary: '[M27] Soft-delete PO line (qty=0, mandatory reason)' })
  deleteLine(
    @Param('id') poId: string,
    @Param('lineId') lineId: string,
    @Body() body: { reason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.editSvc.deleteLine(poId, lineId, body.reason, userId);
  }

  // ── PO lifecycle transitions ───────────────────────────────────────────────

  @Post('po/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[M27] Confirm PO: DRAFT → CONFIRMED (R13 idempotency-key)' })
  confirmPo(
    @Param('id') id: string,
    @Headers('idempotency-key') idemKey?: string,
    @Headers('x-user-id') userId?: string,
  ) {
    return this.transitionSvc.transitionPo(id, {
      toStatus: 'CONFIRMED', idempotencyKey: idemKey, changedBy: userId,
    });
  }

  @Post('po/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[M27] Cancel PO: DRAFT/CONFIRMED → CANCELLED (R11, reason ≥ 20 chars)' })
  cancelPo(
    @Param('id') id: string,
    @Body() body: { cancelReason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.transitionSvc.transitionPo(id, {
      toStatus: 'CANCELLED', cancelReason: body.cancelReason, changedBy: userId,
    });
  }

  @Patch('po/:id/transition')
  @ApiOperation({ summary: '[M27] PO state transitions: SHIPPED/RECEIVED/CLOSED (R9/R10 fields)' })
  transitionPo(
    @Param('id') id: string,
    @Body() body: {
      toStatus: 'SHIPPED' | 'RECEIVED' | 'CLOSED';
      vehicleNo?: string; carrierCode?: string; containerNo?: string; shipDate?: string;
      actualReceivedQty?: number; receiveDate?: string; note?: string;
    },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.transitionSvc.transitionPo(id, { ...body, changedBy: userId });
  }

  // ── Overdue manual check ───────────────────────────────────────────────────

  @Post('po/check-overdue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '[M27] Manual trigger overdue check (normally cron 09:00 VN)' })
  checkOverdue() {
    return this.overdueSvc.checkOverdue();
  }

  // ── Tracking (H2 fix) ─────────────────────────────────────────────────────

  @Get('po/:id/tracking')
  @ApiOperation({ summary: '[M27] Get PO tracking (vehicle/driver/ETA)' })
  getPoTracking(@Param('id') id: string) {
    return this.trackingSvc.getPoTracking(id);
  }

  @Patch('po/:id/tracking')
  @ApiOperation({ summary: '[M27] Update PO tracking fields (driver/ETA etc after SHIPPED)' })
  updatePoTracking(
    @Param('id') id: string,
    @Body() body: {
      vehicleNo?: string; carrierCode?: string; containerNo?: string;
      driverName?: string; driverPhone?: string;
      nmShipDate?: string; actualEtaDate?: string;
    },
    @Headers('x-user-id') userId?: string,
  ) {
    return this.trackingSvc.updatePoTracking(id, { ...body, updatedBy: userId });
  }

  // ── M28 injectable ────────────────────────────────────────────────────────

  @Get('po/:id/fulfillment')
  @ApiOperation({ summary: '[M27→M28] Per-line fulfillment data for honoring rate (H4)' })
  getPoFulfillment(@Param('id') id: string) {
    return this.svc.getPoFulfillment(id);
  }
}
