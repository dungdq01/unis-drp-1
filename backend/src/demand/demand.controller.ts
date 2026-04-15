import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { DemandService } from './demand.service';
import { ListSnapshotsDto } from './dto/list-snapshots.dto';
import { FreezeSnapshotDto } from './dto/freeze-snapshot.dto';
import { UploadForecastDto } from './dto/upload-forecast.dto';
import { ForecastQueryDto } from './dto/forecast-query.dto';
import { OverrideForecastDto } from './dto/override-forecast.dto';
import { CreateSnapshotDto } from './dto/create-snapshot.dto';

@Controller('demand')
@ApiTags('demand')
export class DemandController {
  constructor(private readonly demandService: DemandService) {}

  // ── P1 Core ──────────────────────────────────────────────

  @Get('snapshots')
  @ApiOperation({ summary: 'List demand snapshots (paginated)' })
  listSnapshots(@Query() query: ListSnapshotsDto) {
    return this.demandService.listSnapshots(query);
  }

  @Post('snapshots')
  @ApiOperation({ summary: 'G10 / F1: Create empty DRAFT snapshot (spec §6.4)' })
  createSnapshot(@Body() dto: CreateSnapshotDto) {
    return this.demandService.createSnapshot(dto);
  }

  @Get('snapshots/:id')
  @ApiOperation({ summary: 'Get snapshot detail with lines' })
  getSnapshotDetail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page = 1,
    @Query('pageSize') pageSize = 20,
  ) {
    return this.demandService.getSnapshotDetail(id, Number(page) || 1, Number(pageSize) || 20);
  }

  @Delete('snapshots/:id')
  @ApiOperation({ summary: 'BE-T6: Delete DRAFT snapshot (cascade lines + logs)' })
  deleteSnapshot(@Param('id', ParseUUIDPipe) id: string) {
    return this.demandService.deleteSnapshot(id);
  }

  @Put('snapshots/:id/archive')
  @ApiOperation({ summary: 'BE-T7: Archive FROZEN snapshot → ARCHIVED' })
  archiveSnapshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('archivedBy') archivedBy?: string,
  ) {
    return this.demandService.archiveSnapshot(id, archivedBy);
  }

  @Post('snapshots/:id/freeze')
  @ApiOperation({ summary: 'Freeze a DRAFT snapshot' })
  freezeSnapshot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FreezeSnapshotDto,
  ) {
    return this.demandService.freezeSnapshot(id, dto);
  }

  // ── P2 Upload ────────────────────────────────────────────

  @Post('forecast/upload')
  @ApiOperation({ summary: 'Upload forecast CSV file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        runId: { type: 'string' },
        format: { type: 'string', enum: ['DRP_EXPORT', 'SIMPLE', 'FULL'] },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  uploadForecast(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadForecastDto,
  ) {
    return this.demandService.uploadForecast(file, dto);
  }

  // ── P3 Analytics ─────────────────────────────────────────

  @Get('forecast/summary')
  @ApiOperation({ summary: 'Forecast summary grouped by item/segment' })
  getForecastSummary(@Query() query: ForecastQueryDto) {
    return this.demandService.getForecastSummary(query);
  }

  @Get('forecast/coverage')
  @ApiOperation({ summary: 'Forecast coverage — % items with forecast' })
  getForecastCoverage(@Query('snapshotId') snapshotId?: string) {
    return this.demandService.getForecastCoverage(snapshotId);
  }

  @Get('forecast/detail')
  @ApiOperation({ summary: 'Branch-level forecast detail' })
  getForecastDetail(@Query() query: ForecastQueryDto) {
    return this.demandService.getForecastDetail(query);
  }

  // ── P3b Pivot ─────────────────────────────────────────────

  @Get('forecast/pivot')
  @ApiOperation({ summary: 'Forecast pivot table — FSKU × months' })
  async getForecastPivot(
    @Query('snapshotId') snapshotId?: string,
    @Query('segment') segment?: string,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 50,
  ) {
    // Default when param absent: +undefined = NaN, so coerce safely
    return this.demandService.getForecastPivot(snapshotId, segment, Number(page) || 1, Number(pageSize) || 50);
  }

  // ── P3c Export ───────────────────────────────────────────

  @Get('forecast/export')
  @ApiOperation({ summary: 'Export forecast as CSV' })
  async exportForecast(
    @Query('snapshotId') snapshotId: string,
    @Res() res: Response,
  ) {
    const csvData = await this.demandService.exportForecastCsv(snapshotId);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="forecast_${snapshotId?.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csvData);
  }

  // ── P4 Override ──────────────────────────────────────────

  @Post('forecast/override')
  @ApiOperation({ summary: 'Override forecast qty (DRAFT only)' })
  overrideForecast(@Body() dto: OverrideForecastDto) {
    return this.demandService.overrideForecast(dto);
  }

  @Get('overrides')
  @ApiOperation({ summary: 'Override audit trail' })
  async getOverrides(
    @Query('snapshotId') snapshotId?: string,
    @Query('itemCode') itemCode?: string,
    @Query('page') page: number = 1,
    @Query('pageSize') pageSize: number = 20,
  ) {
    return this.demandService.getOverrideHistory(snapshotId, itemCode, Number(page) || 1, Number(pageSize) || 20);
  }

  // ── BE-A2: Meta endpoints ─────────────────────────────────

  @Get('meta/locations')
  @ApiOperation({ summary: 'Distinct locations từ FROZEN demand snapshots (dùng cho filter UI)' })
  getMetaLocations() {
    return this.demandService.getMetaLocations();
  }
}
