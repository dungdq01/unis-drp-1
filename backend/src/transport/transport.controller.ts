import {
  Controller, Get, Post, Patch, Delete, Param, Body, Query,
  HttpCode, HttpStatus, UploadedFile, UseInterceptors, ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { TransportService } from './transport.service';
import {
  CreateTransportPlanDto, GetTripsQueryDto, UpdateTripDto,
  ConfirmPlanDto, UpsertCarrierDto, UpsertLaneDto,
} from './dto';

@ApiTags('transport')
@Controller('transport')
export class TransportController {
  constructor(private readonly svc: TransportService) {}

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
}
