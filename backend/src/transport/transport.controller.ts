import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query, Headers,
  HttpCode, HttpStatus, UploadedFile, UseInterceptors, ParseIntPipe,
  BadRequestException, UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { TransportService } from './transport.service';
import { TransportLotSizingService } from './transport.lot-sizing.service';
import { TransportTopUpService } from './transport.top-up.service';
import {
  CreateTransportPlanDto, GetTripsQueryDto, UpdateTripDto,
  ConfirmPlanDto, UpsertCarrierDto, UpsertLaneDto,
} from './dto';
import { FeatureFlag } from '../master-data/feature-flag.decorator';
import { FeatureFlagGuard } from '../master-data/master-data.controller';

@ApiTags('transport')
@Controller('transport')
@UseGuards(FeatureFlagGuard)  // class-level no-op for untagged v1 methods
export class TransportController {
  constructor(
    private readonly svc: TransportService,
    private readonly lotSizingSvc: TransportLotSizingService,
    private readonly topUpSvc: TransportTopUpService,
  ) {}

  // ── Eligible runs ──────────────────────────────────────────────────────────

  @Get('eligible-runs')
  @ApiOperation({ summary: 'Danh sách allocation_run COMPLETED chưa có transport_plan' })
  getEligibleRuns() {
    return this.svc.getEligibleRuns();
  }

  // ── Plans ──────────────────────────────────────────────────────────────────

  @Post('plans')
  @ApiOperation({ summary: 'Create transport plan from allocation_run_id' })
  createPlan(@Body() dto: CreateTransportPlanDto) {
    return this.svc.createPlan(dto);
  }

  @Get('plans')
  @ApiOperation({ summary: 'List transport plans' })
  listPlans(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 20,
  ) {
    return this.svc.listPlans(page, pageSize);
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get transport plan detail' })
  getPlan(@Param('id') id: string) {
    return this.svc.getPlan(id);
  }

  @Post('plans/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm transport plan (DRAFT → CONFIRMED)' })
  confirmPlan(@Param('id') id: string, @Body() dto: ConfirmPlanDto) {
    return this.svc.confirmPlan(id, dto);
  }

  // ── Trips ──────────────────────────────────────────────────────────────────

  @Get('plans/:id/trips')
  @ApiOperation({ summary: 'List trips for a transport plan' })
  getTrips(@Param('id') id: string, @Query() query: GetTripsQueryDto) {
    return this.svc.getTrips(id, query);
  }

  @Get('trips/:id/lines')
  @ApiOperation({ summary: 'Get trip lines' })
  getTripLines(@Param('id') id: string) {
    return this.svc.getTripLines(id);
  }

  @Patch('trips/:id')
  @ApiOperation({ summary: 'Override carrier / departure date for a trip' })
  updateTrip(@Param('id') id: string, @Body() dto: UpdateTripDto) {
    return this.svc.updateTrip(id, dto);
  }

  // ── Carriers ───────────────────────────────────────────────────────────────

  @Get('carriers')
  @ApiOperation({ summary: 'List all active carriers' })
  listCarriers() { return this.svc.listCarriers(); }

  @Post('carriers')
  @ApiOperation({ summary: 'Create or update carrier (upsert by carrier_code)' })
  upsertCarrier(@Body() dto: UpsertCarrierDto) {
    return this.svc.upsertCarrier(dto);
  }

  @Delete('carriers/:id')
  @ApiOperation({ summary: 'Soft-delete carrier' })
  deleteCarrier(@Param('id') id: string) {
    return this.svc.deleteCarrier(id);
  }

  @Post('carriers/upload')
  @ApiOperation({ summary: 'Upload carriers from CSV/Excel' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadCarriers(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    return this.svc.uploadCarriersCsv(file.buffer);
  }

  // ── Lanes ──────────────────────────────────────────────────────────────────

  @Get('lanes')
  @ApiOperation({ summary: 'List transport lanes (paginated)' })
  listLanes(
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize = 50,
  ) {
    return this.svc.listLanes(page, pageSize);
  }

  @Post('lanes')
  @ApiOperation({ summary: 'Create or update lane (upsert by source+dest)' })
  upsertLane(@Body() dto: UpsertLaneDto) {
    return this.svc.upsertLane(dto);
  }

  @Delete('lanes/:id')
  @ApiOperation({ summary: 'Soft-delete lane' })
  deleteLane(@Param('id') id: string) {
    return this.svc.deleteLane(id);
  }

  @Post('lanes/upload')
  @ApiOperation({ summary: 'Upload lanes from CSV/Excel' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadLanes(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    return this.svc.uploadLanesCsv(file.buffer);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // M25 — Transport Lot Sizing v2 routes
  // ══════════════════════════════════════════════════════════════════════════

  @FeatureFlag('m25_transport_v2_enabled')
  @Post('v2/run')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M25] Trigger transport lot sizing for an allocation_run' })
  runV2(
    @Body() body: { allocationRunId: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.allocationRunId) throw new BadRequestException('allocationRunId is required');
    return this.lotSizingSvc.runV2({
      allocationRunId: body.allocationRunId,
      createdBy: userId ?? 'MANUAL',
    });
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Post('v2/run/force-rerun')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: '[M25] Force rerun with reason (≥20 chars)' })
  forceRerunV2(
    @Body() body: { allocationRunId: string; reason: string },
    @Headers('x-user-id') userId?: string,
  ) {
    if (!body?.allocationRunId) throw new BadRequestException('allocationRunId required');
    if (!body?.reason || body.reason.length < 20) {
      throw new BadRequestException('reason must be ≥ 20 chars');
    }
    return this.lotSizingSvc.runV2({
      allocationRunId: body.allocationRunId,
      createdBy: userId ?? 'MANUAL',
      forceRerunReason: body.reason,
    });
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Get('v2/plans')
  listV2Plans(
    @Query('status') status?: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.lotSizingSvc.listPlans({ status, page, limit });
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Get('v2/plans/:id')
  @ApiParam({ name: 'id', description: 'transport_plan.id' })
  getV2Plan(@Param('id') id: string) {
    return this.lotSizingSvc.getTransportPlan(id);
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Get('v2/plans/:id/trips')
  listV2Trips(
    @Param('id') id: string,
    @Query('status') status?: string,
  ) {
    return this.lotSizingSvc.listTrips(id, { status });
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Get('v2/trips/:id')
  getV2Trip(@Param('id') id: string) {
    return this.lotSizingSvc.getTripDetail(id);
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Post('v2/trips/:id/release')
  @HttpCode(HttpStatus.ACCEPTED)
  releaseTrip(
    @Param('id') id: string,
    @Headers('x-user-id') userId: string = 'MANUAL',
  ) {
    return this.lotSizingSvc.releaseHeldTrip(id, userId);
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Post('v2/trips/:id/hold-extend')
  @HttpCode(HttpStatus.ACCEPTED)
  extendHold(
    @Param('id') id: string,
    @Body() body: { extendDays: number },
    @Headers('x-user-id') userId: string = 'MANUAL',
  ) {
    if (!body?.extendDays || body.extendDays < 1) {
      throw new BadRequestException('extendDays must be ≥ 1');
    }
    return this.lotSizingSvc.extendHold(id, body.extendDays, userId);
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Post('v2/trips/:id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  cancelTrip(
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Headers('x-user-id') userId: string = 'MANUAL',
  ) {
    if (!body?.reason || body.reason.length < 20) {
      throw new BadRequestException('reason must be ≥ 20 chars');
    }
    return this.lotSizingSvc.cancelTrip(id, body.reason, userId);
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Get('v2/trips/:id/top-up')
  getTopUps(@Param('id') id: string) {
    return this.lotSizingSvc.listTopUps(id);
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Post('v2/top-up/:suggestionId/accept')
  @HttpCode(HttpStatus.ACCEPTED)
  acceptTopUp(
    @Param('suggestionId') id: string,
    @Headers('x-user-id') userId: string = 'MANUAL',
  ) {
    return this.topUpSvc.accept(id, userId);
  }

  @FeatureFlag('m25_transport_v2_enabled')
  @Post('v2/top-up/:suggestionId/reject')
  @HttpCode(HttpStatus.ACCEPTED)
  rejectTopUp(
    @Param('suggestionId') id: string,
    @Headers('x-user-id') userId: string = 'MANUAL',
  ) {
    return this.topUpSvc.reject(id, userId);
  }
}
